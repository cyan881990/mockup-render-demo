'use strict';
/**
 * Bản đồ option (từ scan.js) -> sản phẩm + thiết kế của mình.
 * Giữ nguyên *cấu trúc* đã quét (có mấy option, kiểu gì, giới hạn bao nhiêu),
 * còn khổ in, bố cục, hoạ tiết, bảng màu và câu chữ đều lấy từ kho của mình.
 */
const crypto = require('crypto');
const { LAYOUTS, pickLayout } = require('./layouts');

const CANVAS = {
  'runner-rug': { w: 2400, h: 800 },
  'doormat': { w: 1800, h: 1200 },
  'mug': { w: 1400, h: 1080 },
  'tee': { w: 1200, h: 1590 },
  'pillow': { w: 1400, h: 1400 },
  'poster': { w: 1200, h: 1600 },
  'blanket': { w: 1600, h: 2000 },
  'ornament': { w: 1200, h: 1200 },
};

const TYPE_RULES = [
  [/runner\s*rug|table runner/i, 'runner-rug'],
  [/door\s*mat|doormat|rug|mat\b/i, 'doormat'],
  [/mug|tumbler|cup/i, 'mug'],
  [/t-?shirt|tee|hoodie|sweat/i, 'tee'],
  [/pillow|cushion/i, 'pillow'],
  [/blanket|throw/i, 'blanket'],
  [/ornament|bauble/i, 'ornament'],
  [/poster|canvas|print|frame/i, 'poster'],
];

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
const hash = (o) => crypto.createHash('sha1').update(JSON.stringify(o)).digest('base64url').slice(0, 10);

function productTypeOf(scan, override) {
  if (override) return override;
  const hay = [scan.product?.type, scan.product?.title, scan.url].filter(Boolean).join(' ');
  for (const [re, t] of TYPE_RULES) if (re.test(hay)) return t;
  return 'poster';
}

/** Option đã quét -> option của mình, lấy giới hạn của họ nhưng giá trị của mình. */
function mapOptions(scanned, pack, copy) {
  const out = [];
  const seen = new Set();
  for (const o of scanned) {
    if (seen.has(o.key)) continue;
    seen.add(o.key);
    const base = { key: o.key, label: o.label, type: o.type };
    if (o.indexed) base.indexed = { by: o.indexed.by, from: 1, max: Math.min(o.indexed.max || 6, 10) };

    if (o.type === 'range') {
      out.push({ ...base, type: 'range', min: 1, max: Math.min(o.max || 6, 10), default: Math.min(3, o.max || 3) });
    } else if (o.type === 'text') {
      const d = copy[o.key] ?? '';
      out.push({ ...base, type: 'text', maxLength: o.maxLength || 24, default: d, ...(o.key === 'headline' ? { upper: true } : {}) });
    } else if (o.key === 'background') {
      const vals = pack.backgrounds.slice(0, Math.max(3, Math.min(o.count || 6, pack.backgrounds.length)));
      out.push({ ...base, type: 'swatch', default: vals[0].value, values: vals });
    } else if (o.key === 'ink') {
      out.push({ ...base, type: 'swatch', default: pack.inks[0].value, values: pack.inks });
    } else if (o.key === 'pet') {
      out.push({ ...base, type: 'swatch', default: 'none', values: pack.pets });
    } else {
      const vals = pack.itemColours.slice(0, Math.max(4, Math.min(o.count || 8, pack.itemColours.length)));
      out.push({ ...base, type: 'swatch', as: 'color', allowCustomHex: true, default: vals[0].value, values: vals });
    }
  }
  return out;
}

const DEFAULT_COPY = {
  name: 'The Nguyens', headline: 'Merry Christmas', year: String(new Date().getFullYear()), mname: '',
};

/** Dựng {product, design} sẵn sàng nạp vào catalogue. */
function build(scanResult, opts = {}) {
  // bảng màu do AI đề xuất (đã lọc) ghi đè bảng màu của gói hoạ tiết
  const pack = opts.backgrounds && opts.backgrounds.length >= 3
    ? { ...opts.pack, backgrounds: opts.backgrounds }
    : opts.pack;
  if (!pack) throw new Error('thiếu gói hoạ tiết (artpack)');
  const type = productTypeOf(scanResult, opts.productType);
  const canvas = { ...(CANVAS[type] || CANVAS.poster), ...(opts.canvas || {}) };
  const copy = { ...DEFAULT_COPY, ...(opts.copy || {}) };

  let scanned = (scanResult.personalization || []).filter((o) => o.type);
  if (!scanned.length) {
    scanned = [
      { key: 'background', label: 'Background', type: 'swatch', count: 6 },
      { key: 'member', label: 'Family members', type: 'range', max: 6 },
      { key: 'name', label: 'Family name', type: 'text', maxLength: 20 },
      { key: 'soc', label: 'Item colour', type: 'swatch', count: 8, indexed: { by: 'member', max: 6 } },
      { key: 'mname', label: 'Name on item', type: 'text', maxLength: 10, indexed: { by: 'member', max: 6 } },
    ];
  }
  // khổ nào cũng cần một dòng chữ chính và năm, kể cả khi đối thủ không có
  if (!scanned.some((o) => o.key === 'headline')) {
    scanned.splice(1, 0, { key: 'headline', label: 'Top line', type: 'text', maxLength: 26 });
  }
  if (!scanned.some((o) => o.key === 'year')) {
    scanned.push({ key: 'year', label: 'Year', type: 'text', maxLength: 4 });
  }

  const transparent = ['mug', 'tee', 'ornament'].includes(type);
  // sản phẩm in trên nền vải/sứ trắng thì không có "màu nền" — đổi thành "màu mực",
  // nếu không chữ sẽ lấy màu sáng của bảng nền và mất hút trên nền trắng
  if (transparent) {
    scanned = scanned.map((o) => (o.key === 'background'
      ? { ...o, key: 'ink', label: 'Print colour', type: 'swatch', count: 4 }
      : o));
  }
  let options = mapOptions(scanned, pack, copy);
  if (transparent) options = options.filter((o, i) => options.findIndex((x) => x.key === o.key) === i);
  const has = Object.fromEntries(options.map((o) => [o.key, true]));
  const bgOpt = transparent ? null : options.find((o) => o.key === 'background');
  const inkOpt = options.find((o) => o.key === 'ink');
  if (!bgOpt && !inkOpt) options.unshift({ key: 'ink', label: 'Print colour', type: 'swatch', default: pack.inks[0].value, values: pack.inks });

  const ink = bgOpt ? '{{opt.background.ink}}' : '{{opt.ink.hex}}';
  const accent = bgOpt ? '{{opt.background.accent}}' : '{{opt.ink.accent}}';
  const layoutId = opts.layout || pickLayout(canvas);
  const layers = LAYOUTS[layoutId]({ canvas, pack, ink, accent, bg: !!bgOpt, has });

  const title = opts.title || `${copy.headline} — ${type.replace('-', ' ')}`;
  const id = opts.id || `${slug(title)}-${hash({ type, layoutId, t: Date.now() })}`.slice(0, 54);

  const design = {
    id: `design-${id}`,
    name: title,
    canvas: { w: canvas.w, h: canvas.h, bg: transparent ? 'transparent' : '{{opt.background.hex}}' },
    assetDir: 'art',
    defaultFontFamily: 'Outfit',
    source: { scannedFrom: scanResult.url || null, layout: layoutId, artPack: pack.id },
    options,
    layers,
  };
  const product = {
    id,
    title,
    handle: slug(title),
    type,
    designId: design.id,
    mockups: opts.mockups || [],
    defaultMockup: (opts.mockups || [])[0],
    match: { keywords: slug(title).split('-').filter((w) => w.length > 3).slice(0, 4) },
    paramAliases: { members: 'member', bg: 'background', familyname: 'name' },
  };
  return { product, design };
}

module.exports = { build, CANVAS, productTypeOf };
