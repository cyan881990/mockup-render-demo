'use strict';
/** Orchestrator: URL/options -> cached image bytes. */
const path = require('path');
const sharp = require('sharp');
const { Resvg } = require('@resvg/resvg-js');
const { LRUCache } = require('lru-cache');
const { renderArtboard } = require('./artboard');
const { PartStore } = require('./parts');
const { composite, premultiply, give } = require('./compose');
const { parseProductUrl, normalize, optionsHash } = require('./params');
const { ASSET_DIR } = require('./assets');

sharp.cache({ memory: 128, files: 0, items: 128 });
sharp.concurrency(Math.max(1, require('os').cpus().length));

/**
 * Two encoder profiles per format:
 *   live — what the waiting request gets (fast)
 *   max  — smaller file, produced in the background and swapped into the cache
 */
const FORMATS = {
  webp: { ext: 'webp', mime: 'image/webp',
    live: (q) => ({ quality: q, effort: 1 }),
    max: (q) => ({ quality: q, effort: 4, smartSubsample: true }) },
  jpeg: { ext: 'jpg', mime: 'image/jpeg',
    live: (q) => ({ quality: q, chromaSubsampling: '4:2:0' }),
    max: (q) => ({ quality: q, mozjpeg: true, progressive: true }) },
  png: { ext: 'png', mime: 'image/png',
    live: () => ({ compressionLevel: 3 }),
    max: () => ({ compressionLevel: 9, palette: true }) },
  avif: { ext: 'avif', mime: 'image/avif',
    live: (q) => ({ quality: q, effort: 0 }),
    max: (q) => ({ quality: q, effort: 4 }) },
};
FORMATS.jpg = FORMATS.jpeg;

const RESERVED = new Set(['url', 'product', 'handle', 'mockup', 'design', 'w', 'width',
  'format', 'fmt', 'q', 'quality', 'mode', 'fast', 'v', 'dpr']);

/** Bounded render concurrency: cache hits stay instant while a burst queues instead of thrashing. */
class Semaphore {
  constructor(n) { this.free = n; this.q = []; this.peak = 0; }
  async run(fn) {
    if (this.free <= 0) {
      this.peak = Math.max(this.peak, this.q.length + 1);
      await new Promise((r) => this.q.push(r));
    }
    this.free--;
    try { return await fn(); }
    finally { this.free++; const next = this.q.shift(); if (next) next(); }
  }
  get waiting() { return this.q.length; }
}

class RenderError extends Error {
  constructor(message, status = 400, detail) { super(message); this.status = status; this.detail = detail; }
}

class Renderer {
  constructor(registry, assets, cache, settings = {}) {
    this.registry = registry;
    this.assets = assets;
    this.cache = cache;
    this.settings = settings;
    // Raster artwork is reusable across every mockup of the same product.
    this.artCache = new LRUCache({
      maxSize: (settings.artworkCacheMB || 192) * 1024 * 1024,
      sizeCalculation: (v) => v.data.length,
    });
    this.parts = new PartStore({ cacheMB: settings.partCacheMB || 192 });
    this.gateSize = Number(settings.maxConcurrentRenders) > 0 ? Number(settings.maxConcurrentRenders) : require('os').cpus().length;
    this.gate = new Semaphore(Number(settings.maxConcurrentRenders) > 0 ? Number(settings.maxConcurrentRenders) : require('os').cpus().length);
    this.timings = [];
  }

  /** Resolve a request into product + design + mockup + validated options. */
  resolve(input = {}) {
    const fromUrl = input.url ? parseProductUrl(input.url) : { handle: null, query: {} };
    const merged = { ...fromUrl.query, ...(input.query || {}) };
    // render-control params must never be mistaken for design options
    const query = {};
    for (const [k, v] of Object.entries(merged)) if (!Renderer.RESERVED.has(k.toLowerCase())) query[k] = v;

    let product = null;
    if (input.product) product = this.registry.product(input.product);
    if (!product && fromUrl.handle) product = this.registry.matchHandle(fromUrl.handle);
    if (!product && input.handle) product = this.registry.matchHandle(input.handle);
    if (!product) {
      throw new RenderError('No product matched this URL/handle', 404,
        { handle: fromUrl.handle || input.handle || null, known: [...this.registry.products.keys()] });
    }

    const design = this.registry.design(product.designId);
    if (!design) throw new RenderError(`Design "${product.designId}" not found`, 500);

    const mockupId = input.mockup || query.mockup || product.defaultMockup || product.mockups?.[0];
    const mockup = this.registry.mockup(mockupId);
    if (!mockup) throw new RenderError(`Mockup "${mockupId}" not found`, 404, { available: product.mockups });

    const params = normalize(design, query, product.paramAliases || {});
    return { product, design, mockup, params, handle: fromUrl.handle };
  }

  scopeFor({ product, design, mockup, params }) {
    return {
      canvas: design.canvas,
      opt: params.opt,
      members: params.members,
      product: { id: product.id, title: product.title },
      mockup: { id: mockup.id, name: mockup.name },
      asset: design.assetBase || '',
    };
  }

  /** Rasterize the design to premultiplied RGBA (cached by design hash + options). */
  async artwork(design, scope, width, optionsKey) {
    const w = Math.round(width);
    const h = Math.max(1, Math.round((design.canvas.h / design.canvas.w) * w));
    const key = `${design.hash}|${optionsKey}|${w}`;
    const hit = this.artCache.get(key);
    if (hit) return { ...hit, cached: true };

    const t0 = process.hrtime.bigint();
    const stats = {};
    const board = await renderArtboard(design, scope, this.registry.fonts, this.parts, w, h, stats);
    const entry = { w: board.w, h: board.h, data: board.data, stats, warnings: stats.warnings || [] };
    this.artCache.set(key, entry);
    return { ...entry, cached: false, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
  }

  key(parts) {
    const crypto = require('crypto');
    return crypto.createHash('sha1').update(parts.join('\u0000')).digest('base64url').slice(0, 24);
  }

  /**
   * Main entry. input: { url|product, mockup, query, w, format, quality, mode }
   * mode: 'mockup' (default) | 'artwork' (flat print file)
   */
  async render(input = {}) {
    const started = process.hrtime.bigint();
    const resolved = this.resolve(input);
    const { product, design, mockup, params } = resolved;

    const fmtName = String(input.format || this.settings.defaultFormat || 'webp').toLowerCase();
    const fmt = FORMATS[fmtName] || FORMATS.webp;
    const quality = Math.min(100, Math.max(40, Number(input.quality) || this.settings.defaultQuality || 82));
    const fast = !!input.fast;
    const mode = input.mode === 'artwork' ? 'artwork' : 'mockup';

    const requested = Math.min(Number(input.w) || 0, this.settings.maxWidth || 2000);
    const width = mode === 'artwork'
      ? Math.min(design.canvas.w, requested || 1200)
      : this.assets.snapWidth(mockup, requested);

    const optionsKey = optionsHash(params.canonical);
    const cacheKey = this.key([
      mode, design.hash, mode === 'mockup' ? mockup.hash : '-', optionsKey, width, fmt.ext, quality, fast ? 'f' : 'q',
    ]);

    const t = { resolve: Number(process.hrtime.bigint() - started) / 1e6 };
    const entry = await this.cache.resolve(cacheKey, fmt.ext, () => this.gate.run(async () => {
      const tArt0 = process.hrtime.bigint();
      const scope = this.scopeFor(resolved);

      if (mode === 'artwork') {
        const art = await this.artwork(design, scope, width, optionsKey);
        t.artwork = Number(process.hrtime.bigint() - tArt0) / 1e6;
        const body = await sharp(art.data, { raw: { width: art.w, height: art.h, channels: 4, premultiplied: true } })
          .toFormat(fmt.ext === 'jpg' ? 'jpeg' : fmt.ext, fmt.live(quality))
          .toBuffer();
        t.encode = Number(process.hrtime.bigint() - tArt0) / 1e6 - t.artwork;
        return { body, contentType: fmt.mime };
      }

      const bundle = await this.assets.get(mockup, width);
      t.assets = Number(process.hrtime.bigint() - tArt0) / 1e6;

      const tA = process.hrtime.bigint();
      const art = await this.artwork(design, scope, bundle.artWidth, optionsKey);
      t.artwork = Number(process.hrtime.bigint() - tA) / 1e6;
      t.artworkCached = art.cached;
      this.lastArtWarnings = art.warnings;

      const tC = process.hrtime.bigint();
      const blend = mockup.blend || {};
      const out = composite(bundle, art, {
        opacity: blend.opacity ?? 1,
        lightStrength: blend.lightStrength ?? 1,
        bilinear: !fast,
        cylinder: mockup.surface.cylinder || 0,
        displace: mockup.displace || null,
        bleed: blend.bleed,
      });
      t.composite = Number(process.hrtime.bigint() - tC) / 1e6;

      const tE = process.hrtime.bigint();
      let pipe = sharp(out.data, { raw: { width: out.W, height: out.H, channels: 3 } });
      if (bundle.overlay) pipe = pipe.composite([{ input: bundle.overlay, blend: 'over' }]);
      const body = await pipe.toFormat(fmt.ext === 'jpg' ? 'jpeg' : fmt.ext, fmt.live(quality)).toBuffer();
      if (this.settings.optimizeInBackground === true) this.reoptimize(cacheKey, fmt, quality, out, bundle);
      give(out.data);                                   // reoptimize already took its own copy
      t.encode = Number(process.hrtime.bigint() - tE) / 1e6;
      return { body, contentType: fmt.mime };
    }));

    t.total = Number(process.hrtime.bigint() - started) / 1e6;
    this.record(t, entry.tier);

    return {
      body: entry.body,
      contentType: entry.contentType || fmt.mime,
      etag: entry.etag,
      tier: entry.tier,
      timings: t,
      meta: {
        product: product.id, design: design.id, mockup: mockup.id, mode,
        width, format: fmt.ext, quality,
        options: Object.fromEntries(params.canonical),
        warnings: [...params.warnings, ...(this.lastArtWarnings || [])],
        bytes: entry.body.length,
      },
    };
  }

  /** Re-encode a freshly rendered frame at max compression and swap it into the cache. */
  reoptimize(cacheKey, fmt, quality, out, bundle) {
    const copy = Buffer.from(out.data);
    setTimeout(async () => {
      try {
        let pipe = sharp(copy, { raw: { width: out.W, height: out.H, channels: 3 } });
        if (bundle.overlay) pipe = pipe.composite([{ input: bundle.overlay, blend: 'over' }]);
        const small = await pipe.toFormat(fmt.ext === 'jpg' ? 'jpeg' : fmt.ext, fmt.max(quality)).toBuffer();
        const current = this.cache.mem.get(cacheKey);
        if (!current || small.length < current.body.length) {
          await this.cache.set(cacheKey, fmt.ext, small, fmt.mime);
          this.cache.stats.optimized = (this.cache.stats.optimized || 0) + 1;
        }
      } catch (e) { /* best effort */ }
    }, 0).unref?.();
  }

  record(t, tier) {
    this.timings.push({ ...t, tier, at: Date.now() });
    if (this.timings.length > 500) this.timings.splice(0, this.timings.length - 500);
  }

  metrics() {
    const renders = this.timings.filter((x) => x.tier === 'render');
    const pick = (arr, p) => (arr.length ? +arr.sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))].toFixed(1) : 0);
    const totals = this.timings.map((x) => x.total);
    const renderTotals = renders.map((x) => x.total);
    return {
      samples: this.timings.length,
      all: { p50: pick([...totals], 0.5), p95: pick([...totals], 0.95) },
      coldRender: {
        count: renders.length,
        p50: pick([...renderTotals], 0.5), p95: pick([...renderTotals], 0.95),
        avgArtwork: +(renders.reduce((a, x) => a + (x.artwork || 0), 0) / (renders.length || 1)).toFixed(1),
        avgComposite: +(renders.reduce((a, x) => a + (x.composite || 0), 0) / (renders.length || 1)).toFixed(1),
        avgEncode: +(renders.reduce((a, x) => a + (x.encode || 0), 0) / (renders.length || 1)).toFixed(1),
      },
      cache: this.cache.info(),
      parts: this.parts.info(),
      concurrency: { inUse: this.gateSize - this.gate.free, limit: this.gateSize, queued: this.gate.waiting, peakQueue: this.gate.peak },
      assets: this.assets.stats(),
      artworkCache: { entries: this.artCache.size, mb: +(this.artCache.calculatedSize / 1048576).toFixed(1) },
    };
  }
}

Renderer.RESERVED = RESERVED;

module.exports = { Renderer, RenderError, FORMATS, RESERVED };
