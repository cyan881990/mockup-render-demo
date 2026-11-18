#!/usr/bin/env node
'use strict';
/**
 * Quét một trang sản phẩm rồi dựng SKU tương đương bằng kho hoạ tiết của mình.
 *
 *   node scripts/clone-sku.js <url> [--type runner-rug] [--pack xmas-knit]
 *        [--title "..."] [--headline "..."] [--layout banner|stack]
 *        [--html fixture.html] [--save] [--out dir]
 *
 * Mặc định chỉ render thử và in ra JSON; thêm --save mới ghi vào catalogue.
 */
const fs = require('fs');
const path = require('path');
const { scan } = require('../src/scan');
const { build } = require('../src/blueprint');
const { Registry } = require('../src/registry');
const { AssetStore } = require('../src/assets');
const { RenderCache } = require('../src/cache');
const { Renderer } = require('../src/render');
const { propose } = require('../src/ai');

const root = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? (argv[i + 1] ?? true) : d; };
const url = argv.find((a) => !a.startsWith('--') && (a.startsWith('http') || a.includes('/')));

/** Trang dựng bằng JS thì cần trình duyệt render; Firecrawl là đường tắt khi có key. */
async function fetchText(u) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (key && !u.endsWith('.js')) {
    const r = await fetch('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ url: u, formats: ['rawHtml'], waitFor: 6000, onlyMainContent: false }),
    });
    const j = await r.json();
    const html = j?.data?.rawHtml || j?.data?.html;
    if (html) return html;
  }
  const res = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; mockup-scanner/1.0)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

(async () => {
  const htmlFile = flag('html');
  const scanned = await scan(url || 'https://example.com/products/offline', {
    html: htmlFile ? fs.readFileSync(htmlFile, 'utf8') : undefined,
    fetchText: htmlFile ? async () => { throw new Error('offline'); } : fetchText,
  });
  for (const w of scanned.warnings) console.warn('  !', w);

  const packs = JSON.parse(fs.readFileSync(path.join(root, 'data/artpacks.json'), 'utf8'));
  const pack = packs.find((p) => p.id === (flag('pack') || packs[0].id));
  if (!pack) throw new Error(`không có gói hoạ tiết "${flag('pack')}"`);

  const mockups = JSON.parse(fs.readFileSync(path.join(root, 'data/mockups.json'), 'utf8'));
  const type = flag('type') || undefined;
  let ai = {};
  if (argv.includes('--ai')) {
    ai = await propose({ scan: scanned, pack, productType: type || 'poster', seed: Number(flag('seed', 0)) || 0 });
    console.log('  ý tưởng từ', ai.source, ai.error ? `(lỗi: ${ai.error})` : '', '->', ai.title, '/', ai.headline);
  }
  const built = build(scanned, {
    pack, productType: type, layout: flag('layout') || ai.layout || undefined,
    backgrounds: ai.backgrounds,
    title: flag('title') || ai.title || (scanned.product?.title ? `${scanned.product.title} (bản của mình)` : undefined),
    copy: { headline: flag('headline') || ai.headline || undefined },
  });
  const fit = mockups.filter((m) => (m.productTypes || []).includes(built.product.type)).map((m) => m.id);
  built.product.mockups = fit;
  built.product.defaultMockup = fit[0];

  console.log(JSON.stringify({
    scanned: {
      title: scanned.product?.title, type: scanned.product?.type,
      variants: scanned.product?.variantOptions,
      options: scanned.personalization.map((o) => `${o.key}:${o.type}${o.indexed ? '[]' : ''}${o.maxLength ? `(${o.maxLength})` : ''}${o.count ? `×${o.count}` : ''}`),
    },
    built: {
      product: built.product.id, type: built.product.type, mockups: fit,
      canvas: built.design.canvas, layout: built.design.source.layout,
      options: built.design.options.map((o) => o.key),
    },
  }, null, 1));

  if (!fit.length) { console.warn('  ! chưa có cảnh mockup nào cho loại này — render thử bị bỏ qua'); return; }

  // ghi tạm vào catalogue trong bộ nhớ để render thử
  const products = JSON.parse(fs.readFileSync(path.join(root, 'data/products.json'), 'utf8'));
  const designs = JSON.parse(fs.readFileSync(path.join(root, 'data/designs.json'), 'utf8'));
  const save = argv.includes('--save');
  const tmpP = products.concat(built.product);
  const tmpD = designs.concat(built.design);
  fs.writeFileSync('/tmp/_products.json', JSON.stringify(tmpP));
  fs.writeFileSync('/tmp/_designs.json', JSON.stringify(tmpD));

  const reg = new Registry().loadAll();
  reg.products.set(built.product.id, { ...built.product, hash: 'tmp' });
  reg.designs.set(built.design.id, { ...built.design, hash: 'tmp' + Date.now() });

  const settings = JSON.parse(fs.readFileSync(path.join(root, 'data/settings.json'), 'utf8'));
  const r = new Renderer(reg, new AssetStore({ widths: settings.widths }),
    new RenderCache({ memoryMB: 64, diskEnabled: false }), settings);
  const out = flag('out') || '/tmp/sku';
  fs.mkdirSync(out, { recursive: true });
  for (const m of fit) {
    const res = await r.render({ product: built.product.id, mockup: m, query: {}, w: 1200, format: 'jpeg', quality: 86 });
    fs.writeFileSync(path.join(out, `${built.product.id}-${m}.jpg`), res.body);
    console.log('  render', m, Math.round(res.timings.total) + 'ms');
  }
  const art = await r.render({ product: built.product.id, mode: 'artwork', w: 1600, format: 'png' });
  fs.writeFileSync(path.join(out, `${built.product.id}-artwork.png`), art.body);
  console.log('  ảnh in', path.join(out, `${built.product.id}-artwork.png`));

  if (save) {
    fs.writeFileSync(path.join(root, 'data/products.json'), JSON.stringify(tmpP, null, 1));
    fs.writeFileSync(path.join(root, 'data/designs.json'), JSON.stringify(tmpD, null, 1));
    console.log('  đã lưu vào catalogue:', built.product.id);
  } else {
    console.log('  (chưa lưu — thêm --save nếu muốn giữ)');
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
