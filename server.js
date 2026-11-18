'use strict';
/**
 * Dynamic mockup render server.
 *   GET /render?url=<storefront product url>          -> personalised mockup image
 *   GET /i/:product/:mockup.webp?...                  -> CDN-friendly path form
 *   GET /api/{products,mockups,designs,fonts,resolve} -> catalogue management
 */
const fs = require('fs');
const path = require('path');
const Fastify = require('fastify');

const { Registry } = require('./src/registry');
const { AssetStore } = require('./src/assets');
const { RenderCache } = require('./src/cache');
const { Renderer, RenderError, FORMATS } = require('./src/render');

const settings = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'settings.json'), 'utf8'));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

/** Serverless hosts give you a read-only bundle and a writable /tmp, and no long-lived process. */
const SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.SERVERLESS);
const CACHE_DIR = process.env.CACHE_DIR || (SERVERLESS ? '/tmp/mockup-cache' : undefined);
if (SERVERLESS) {
  settings.warmOnBoot = false;                      // every cold start would pay for it
  settings.widths = settings.serverlessWidths || settings.widths;
}

const registry = new Registry().loadAll();
if (!SERVERLESS) registry.watch();                  // no file writes to watch for on a read-only bundle
const assets = new AssetStore({ widths: settings.widths });
const cache = new RenderCache({
  memoryMB: settings.memoryCacheMB,
  diskEnabled: settings.diskCache !== false,
  ...(CACHE_DIR ? { dir: CACHE_DIR } : {}),
});
const renderer = new Renderer(registry, assets, cache, settings);

registry.onChange(() => { assets.clear(); cache.purge(); renderer.artCache.clear(); });

const app = Fastify({ logger: false, trustProxy: true });

app.addHook('onSend', async (req, reply, payload) => {
  reply.header('access-control-allow-origin', '*');
  reply.header('timing-allow-origin', '*');
  return payload;
});

// ---------------------------------------------------------------- image routes
function imageQuery(q) {
  return {
    url: q.url, product: q.product, handle: q.handle, mockup: q.mockup, design: q.design,
    w: q.w || q.width, format: q.format || q.fmt, quality: q.q || q.quality,
    mode: q.mode, fast: q.fast === '1',
    query: q,
  };
}

async function sendImage(req, reply, input) {
  try {
    const out = await renderer.render(input);
    const immutable = req.query.v !== undefined;
    reply
      .header('content-type', out.contentType)
      .header('etag', out.etag)
      .header('cache-control', immutable
        ? `public, max-age=${settings.cdnMaxAge || 31536000}, immutable`
        : `public, max-age=600, s-maxage=${settings.cdnMaxAge || 31536000}, stale-while-revalidate=86400`)
      .header('x-render-tier', out.tier)
      .header('x-render-ms', out.timings.total.toFixed(1))
      .header('vary', 'accept');
    if (req.headers['if-none-match'] === out.etag) return reply.code(304).send();
    return reply.send(out.body);
  } catch (e) {
    if (e instanceof RenderError) return reply.code(e.status).send({ error: e.message, detail: e.detail });
    req.log?.error?.(e);
    return reply.code(500).send({ error: e.message });
  }
}

app.get('/render', (req, reply) => sendImage(req, reply, imageQuery(req.query)));

app.get('/i/:product/:file', (req, reply) => {
  const m = /^(.+)\.(webp|jpg|jpeg|png|avif)$/i.exec(req.params.file);
  if (!m) return reply.code(404).send({ error: 'expected <mockup>.<ext>' });
  return sendImage(req, reply, {
    ...imageQuery(req.query), product: req.params.product, mockup: m[1], format: m[2].toLowerCase(),
  });
});

/** Flat print-ready artwork (no mockup). */
app.get('/artwork/:product', (req, reply) =>
  sendImage(req, reply, { ...imageQuery(req.query), product: req.params.product, mode: 'artwork' }));

// ------------------------------------------------------------------ catalogue
app.get('/api/products', async () => [...registry.products.values()].map((p) => ({
  ...p, schema: undefined,
  mockupDetails: registry.mockupsFor(p).map((m) => ({ id: m.id, name: m.name })),
})));
app.get('/api/mockups', async () => [...registry.mockups.values()]);
app.get('/api/designs', async () => [...registry.designs.values()]);
app.get('/api/fonts', async () => registry.fonts.list());
app.get('/api/settings', async () => settings);

app.get('/api/schema/:product', async (req, reply) => {
  const p = registry.product(req.params.product) || registry.matchHandle(req.params.product);
  if (!p) return reply.code(404).send({ error: 'unknown product' });
  return registry.schema(p);
});

/** Dry run: what would this URL render, with which normalised options? */
app.get('/api/resolve', async (req, reply) => {
  try {
    const r = renderer.resolve(imageQuery(req.query));
    return {
      handle: r.handle,
      product: { id: r.product.id, title: r.product.title, type: r.product.type },
      design: { id: r.design.id, name: r.design.name, canvas: r.design.canvas },
      mockup: { id: r.mockup.id, name: r.mockup.name, size: r.mockup.size },
      mockups: registry.mockupsFor(r.product).map((m) => ({ id: m.id, name: m.name })),
      options: Object.fromEntries(r.params.canonical),
      resolved: r.params.opt,
      members: r.params.members,
      warnings: r.params.warnings,
      schema: registry.schema(r.product),
    };
  } catch (e) {
    if (e instanceof RenderError) return reply.code(e.status).send({ error: e.message, detail: e.detail });
    throw e;
  }
});

for (const kind of ['products', 'mockups', 'designs']) {
  app.put(`/api/${kind}/:id`, async (req, reply) => {
    if (SERVERLESS) return reply.code(405).send({ error: 'read-only demo: catalogue edits need a writable filesystem (run locally or mount a volume)' });
    const item = { ...req.body, id: req.params.id };
    const saved = registry.upsert(kind, item);
    cache.purge();
    return reply.send(saved);
  });
  app.delete(`/api/${kind}/:id`, async (req, reply) => {
    if (SERVERLESS) return reply.code(405).send({ error: 'read-only demo: catalogue edits need a writable filesystem' });
    registry.remove(kind, req.params.id);
    cache.purge();
    return reply.send({ ok: true });
  });
}

// ------------------------------------------------------------------ ops routes
app.get('/healthz', async () => ({
  ok: true, uptime: process.uptime(), serverless: SERVERLESS,
  products: registry.products.size, mockups: registry.mockups.size, designs: registry.designs.size,
  fonts: registry.fonts.byId.size,
}));

app.get('/metrics', async () => renderer.metrics());

app.post('/api/cache/purge', async (req) => {
  const n = cache.purge();
  renderer.artCache.clear();
  if (req.query?.disk === '1') await cache.purgeDisk();
  return { purged: n, disk: req.query?.disk === '1' };
});

/** Pre-render the combinations a storefront hits first (collection grids, default variant). */
app.post('/api/warm', async (req) => {
  const jobs = req.body?.jobs || defaultWarmJobs();
  const t0 = Date.now();
  let ok = 0, failed = 0;
  const limit = 4;
  for (let i = 0; i < jobs.length; i += limit) {
    const slice = jobs.slice(i, i + limit);
    await Promise.all(slice.map(async (j) => {
      try { await renderer.render(j); ok++; } catch { failed++; }
    }));
  }
  return { jobs: jobs.length, ok, failed, ms: Date.now() - t0 };
});

function defaultWarmJobs() {
  const jobs = [];
  for (const p of registry.products.values()) {
    const design = registry.design(p.designId);
    if (!design) continue;
    const bgOpt = (design.options || []).find((o) => o.type === 'swatch' && !o.indexed);
    const values = bgOpt ? bgOpt.values.map((v) => v.value) : [null];
    for (const m of p.mockups || []) {
      for (const v of values.slice(0, 6)) {
        for (const w of [400, 800]) {
          jobs.push({ product: p.id, mockup: m, w, format: 'webp', query: bgOpt ? { [bgOpt.key]: v } : {} });
        }
      }
    }
  }
  return jobs;
}

// ---------------------------------------------------------------------- static
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };

function serveStatic(reply, root, rel, cacheControl = 'public, max-age=300') {
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return reply.code(404).send({ error: 'not found' });
  }
  return reply
    .header('content-type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream')
    .header('cache-control', cacheControl)
    .send(fs.createReadStream(file));
}

app.get('/', (req, reply) => serveStatic(reply, path.join(__dirname, 'public'), 'index.html', 'no-cache'));
app.get('/app.js', (req, reply) => serveStatic(reply, path.join(__dirname, 'public'), 'app.js', 'no-cache'));
app.get('/product.html', (req, reply) => serveStatic(reply, path.join(__dirname, 'public'), 'product.html', 'no-cache'));
app.get('/product.js', (req, reply) => serveStatic(reply, path.join(__dirname, 'public'), 'product.js', 'no-cache'));
app.get('/assets/*', (req, reply) => serveStatic(reply, path.join(__dirname, 'assets'), req.params['*'], 'public, max-age=3600'));

// ------------------------------------------------------------------- bootstrap
async function start() {
  await app.listen({ port: PORT, host: HOST });
  console.log(`\n  mockup render server  http://localhost:${PORT}`);
  console.log(`  ${registry.products.size} products · ${registry.mockups.size} mockups · ${registry.designs.size} designs · ${registry.fonts.byId.size} fonts\n`);
  if (settings.warmOnBoot) {
    const jobs = defaultWarmJobs();
    const t0 = Date.now();
    for (let i = 0; i < jobs.length; i += 4) {
      await Promise.all(jobs.slice(i, i + 4).map((j) => renderer.render(j).catch(() => {})));
    }
    console.log(`  warmed ${jobs.length} variants in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
}

if (require.main === module) start();

module.exports = { app, registry, renderer, assets, cache, settings, start, SERVERLESS };
