'use strict';
/**
 * Quét một trang sản phẩm đối thủ để lấy *cấu trúc option* (tên option, kiểu,
 * số lựa chọn, giới hạn ký tự) — phần chức năng, không phải hoạ tiết.
 * Ảnh và thiết kế của họ không được tải về hay dùng lại; bản đồ này chỉ để
 * dựng một template tương đương bằng kho hoạ tiết của mình.
 *
 * Hai nguồn:
 *   1. Shopify product JSON (<url>.js)  -> tiêu đề, loại, giá, biến thể giao hàng
 *   2. HTML đã render                   -> form cá nhân hoá (Teeinblue, Customily,
 *                                          Kickflip, hoặc form thuần của theme)
 */
const { parse } = require('node-html-parser');   // CJS, nhẹ — jsdom kéo theo gói ESM-only làm sập runtime

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ keys */
const KEY_RULES = [
  [/\bbackground|\bbg\b|backdrop/i, 'background'],
  [/number of|how many|quantity of (?:family )?members?|\bmembers?\b.*\bnumber\b/i, 'member'],
  [/family name|last name|surname|family\b/i, 'name'],
  [/sock|stocking/i, 'soc'],
  [/pet|dog|cat/i, 'pet'],
  [/year/i, 'year'],
  [/top line|headline|title|quote|text above|message/i, 'headline'],
  [/colou?r of (?:the )?(?:print|ink)|print colou?r|ink/i, 'ink'],
  [/skin|tone/i, 'skin'],
  [/hair/i, 'hair'],
  [/\bname\b/i, 'mname'],                     // "Enter Name" sau nhóm lặp
];

function keyFor(label, used) {
  for (const [re, key] of KEY_RULES) {
    if (re.test(label) && !used.has(key)) return key;
  }
  const slug = clean(label).toLowerCase()
    .replace(/^(choose|select|enter|add|pick|upload)\s+/i, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'opt';
  let k = slug, i = 2;
  while (used.has(k)) k = `${slug}${i++}`;
  return k;
}

/* ------------------------------------------------------- shopify product */
function parseShopify(json) {
  if (!json || !json.title) return null;
  return {
    platform: 'shopify',
    title: clean(json.title),
    handle: json.handle,
    vendor: clean(json.vendor),
    type: clean(json.type),
    tags: json.tags || [],
    price: json.price != null ? json.price / 100 : null,
    priceMax: json.price_max != null ? json.price_max / 100 : null,
    compareAt: json.compare_at_price != null ? json.compare_at_price / 100 : null,
    imageCount: (json.images || []).length,
    variantOptions: (json.options || []).map((o) => ({
      name: clean(o.name), values: (o.values || []).map(clean),
    })),
  };
}

/* ------------------------------------------------- personalization form */
/** Mỗi "ô option" = một nhãn + một vùng điều khiển. Hỗ trợ nhiều app khác nhau. */
const CLASS_HINTS = [
  'ant-form-item',            // Teeinblue
  'customily-option',         // Customily
  'kickflip-field',           // Kickflip
  'product-personalizer-field',
  'pf-field', 'ppcp-field', 'product-option', 'option-field',
];

const JUNK_CLASS = /jdgm|review|newsletter|footer|localization|shipping|quantity|search|cart-drawer|modal/i;
const JUNK_LABEL = /^(quantity|rating|review|display name|your name|email|sort by|country|shipping|name format|picture|show it off|password|subscribe)/i;

function optionBlocks(doc) {
  let blocks = doc.querySelectorAll('div,fieldset,li')
    .filter((el) => {
      const c = el.getAttribute('class') || '';
      return CLASS_HINTS.some((h) => c.includes(h));
    })
    // chỉ giữ khối ngoài cùng của mỗi option, bỏ các khối con cùng class
    .filter((el, _i, all) => !all.some((o) => o !== el && o.querySelectorAll('*').includes(el)));
  const fromApp = blocks.length > 0;
  if (!fromApp) {
    // không thấy app cá nhân hoá: chỉ dám lấy label nằm trong chính form thêm-giỏ
    const form = doc.querySelector('form[action*="/cart/add"]');
    blocks = form ? form.querySelectorAll('label').map((l) => l.closest('div') || l.closest('fieldset') || l) : [];
  }
  const kept = blocks.filter(Boolean).filter((el) => {
    let n = el, depth = 0;
    while (n && depth++ < 8) {                       // khối nằm trong widget đánh giá/newsletter thì bỏ
      if (JUNK_CLASS.test(n.getAttribute?.('class') || '')) return false;
      n = n.parentNode;
    }
    return true;
  });
  kept.fromApp = fromApp;
  return kept;
}

function labelOf(block) {
  const titled = block.querySelectorAll('label').find((x) => x.getAttribute('title'));
  const l = titled || block.querySelector('label') || block.querySelector('legend');
  return clean(l && (l.getAttribute('title') || l.text));
}

function swatchValues(block) {
  const imgs = block.querySelectorAll('img').filter((img) => {
    const p = img.closest('div');
    const c = `${p?.getAttribute('class') || ''} ${p?.parentNode?.getAttribute?.('class') || ''}`;
    return /swatch|image-item|option|thumb/i.test(c);
  });
  if (imgs.length >= 2) {
    return imgs.map((img, i) => ({
      index: i + 1,
      label: clean(img.getAttribute('alt') || img.closest('[title]')?.getAttribute('title')) || null,
      thumb: img.getAttribute('src') || null,      // chỉ ghi lại để đối chiếu, không tải về
    }));
  }
  const chips = block.querySelectorAll('*').filter((el) =>
    el.getAttribute('data-value') || el.getAttribute('data-swatch') || el.getAttribute('role') === 'radio');
  if (chips.length >= 2) {
    return chips.map((c, i) => ({
      index: i + 1,
      label: clean(c.getAttribute('title') || c.getAttribute('aria-label') || c.getAttribute('data-value')) || null,
      hex: (c.getAttribute('style') || '').match(/#[0-9a-f]{3,8}/i)?.[0] || null,
    }));
  }
  const sel = block.querySelector('select');
  if (sel) {
    const opts = sel.querySelectorAll('option').filter((o) => clean(o.text));
    if (opts.length >= 2) {
      return opts.map((o, i) => ({ index: i + 1, label: clean(o.text), value: o.getAttribute('value') || null }));
    }
  }
  const radios = block.querySelectorAll('input').filter((r) => r.getAttribute('type') === 'radio');
  if (radios.length >= 2) {
    return radios.map((r, i) => ({ index: i + 1, label: clean(r.getAttribute('value')) || `#${i + 1}`, value: r.getAttribute('value') }));
  }
  return null;
}

function parseForm(html, opts = {}) {
  const doc = parse(html, { blockTextElements: { script: false, style: false } });
  const used = new Set();
  const out = [];
  const variantValues = new Set();
  for (const vo of opts.variantOptions || []) {
    variantValues.add(String(vo.name || '').toLowerCase());
    for (const v of vo.values || []) variantValues.add(String(v).toLowerCase());
  }
  const blocks = optionBlocks(doc);
  out.fromApp = blocks.fromApp;
  for (const block of blocks) {
    const label = labelOf(block);
    if (!label || label.length > 80) continue;
    if (JUNK_LABEL.test(label)) continue;
    if (variantValues.has(label.toLowerCase())) continue;     // đây là biến thể giao hàng, không phải cá nhân hoá

    const input = block.querySelectorAll('input').find((i) => {
      const t = (i.getAttribute('type') || 'text').toLowerCase();
      return t === 'text' || t === 'search';
    }) || block.querySelector('textarea');
    const values = swatchValues(block);
    if (values && values.every((v) => variantValues.has(String(v.label || '').toLowerCase()))) continue;
    const cls = block.getAttribute('class') || '';
    const required = /required/i.test(cls)
      || block.querySelectorAll('*').some((e) => /required/i.test(e.getAttribute('class') || '') || e.getAttribute('required') != null);
    const hintEl = block.querySelectorAll('div,small,span').find((e) => /extra|help|hint/i.test(e.getAttribute('class') || ''));
    const hint = clean(hintEl?.text) || null;

    let entry = null;
    if (values && values.length >= 2) {
      const isCount = /number of|how many/i.test(label) || /template-select/.test(cls);
      entry = isCount
        ? { type: 'range', min: 1, max: values.length }
        : { type: 'swatch', count: values.length, values: values.slice(0, 40) };
    } else if (input) {
      entry = {
        type: 'text',
        maxLength: Number(input.getAttribute('maxlength')) || null,
        placeholder: clean(input.getAttribute('placeholder')) || null,
      };
    }
    if (!entry) continue;
    if (out.some((o) => o.label === label)) continue;

    const key = keyFor(label, used);
    used.add(key);
    out.push({ key, label, required, hint, ...entry });
  }
  return out;
}

/** Option nào đứng sau "số thành viên" và mang tính từng-người thì đánh dấu lặp. */
function markIndexed(options) {
  const counter = options.find((o) => o.type === 'range');
  if (!counter) return options;
  const after = options.indexOf(counter);
  return options.map((o, i) => {
    if (i <= after) return o;
    const perItem = /sock|stocking|^name$|enter name|each|per (?:member|person)/i.test(o.label)
      || ['soc', 'mname', 'skin', 'hair'].includes(o.key);
    return perItem
      ? { ...o, indexed: { by: counter.key, from: 1, max: counter.max } }
      : o;
  });
}

/* ------------------------------------------------------------------ scan */
async function scan(url, opts = {}) {
  const fetchText = opts.fetchText || (async (u) => (await fetch(u)).text());
  const clean_url = String(url).split('#')[0].replace(/\.js$/, '');
  const warnings = [];

  let product = null;
  try {
    const raw = await fetchText(`${clean_url}.js`);
    product = parseShopify(JSON.parse(raw));
  } catch { warnings.push('không đọc được product JSON — có thể không phải Shopify'); }

  let html = opts.html;
  if (!html) {
    try { html = await fetchText(clean_url); }
    catch (e) { warnings.push(`không tải được HTML: ${e.message}`); }
  }
  let personalization = [];
  if (html) {
    const parsed = parseForm(html, { variantOptions: product?.variantOptions });
    personalization = markIndexed(parsed);
    if (!parsed.fromApp) {
      warnings.push(personalization.length
        ? 'không nhận ra app cá nhân hoá — các option dưới đây lấy từ form thêm-giỏ, nên kiểm lại'
        : 'không thấy form cá nhân hoá: trang dựng bằng JS nên HTML thô không có. Đặt FIRECRAWL_API_KEY (hoặc gửi kèm html đã render) rồi quét lại');
    }
  }

  return {
    url: clean_url,
    scannedAt: new Date().toISOString(),
    product,
    personalization,
    warnings,
    note: 'Chỉ lấy cấu trúc option. Hoạ tiết, bố cục và câu chữ phải tự dựng.',
  };
}

module.exports = { scan, parseForm, parseShopify, markIndexed, keyFor };
