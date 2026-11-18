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
const { JSDOM } = require('jsdom');

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
function optionBlocks(doc) {
  const sel = [
    '.ant-form-item',                  // Teeinblue
    '[class*="customily-option"]',     // Customily
    '[class*="kickflip-field"]',       // Kickflip
    '.product-personalizer-field',     // Product Personalizer
    '.pf-field', '.ppcp-field',
  ].join(',');
  let blocks = [...doc.querySelectorAll(sel)];
  if (!blocks.length) {
    // form thuần của theme: lấy mọi label có control đi kèm trong form add-to-cart
    const form = doc.querySelector('form[action*="/cart/add"]') || doc.body;
    blocks = [...form.querySelectorAll('label')].map((l) => l.closest('div,fieldset,li') || l);
  }
  return blocks.filter(Boolean);
}

function labelOf(block) {
  const l = block.querySelector('label[title]') || block.querySelector('label, legend');
  return clean(l && (l.getAttribute('title') || l.textContent));
}

function swatchValues(block) {
  const imgs = [...block.querySelectorAll('.swatch-container img, .image-item img, [class*="swatch"] img')];
  if (imgs.length >= 2) {
    return imgs.map((img, i) => ({
      index: i + 1,
      label: clean(img.getAttribute('alt') || img.closest('[title]')?.getAttribute('title')) || null,
      thumb: img.getAttribute('src') || null,      // chỉ ghi lại để đối chiếu, không tải về
    }));
  }
  const chips = [...block.querySelectorAll('[data-value],[data-swatch],[role="radio"]')];
  if (chips.length >= 2) {
    return chips.map((c, i) => ({
      index: i + 1,
      label: clean(c.getAttribute('title') || c.getAttribute('aria-label') || c.getAttribute('data-value')) || null,
      hex: (c.getAttribute('style') || '').match(/#[0-9a-f]{3,8}/i)?.[0] || null,
    }));
  }
  const sel = block.querySelector('select');
  if (sel) {
    const opts = [...sel.querySelectorAll('option')].filter((o) => clean(o.textContent));
    if (opts.length >= 2) {
      return opts.map((o, i) => ({ index: i + 1, label: clean(o.textContent), value: o.value || null }));
    }
  }
  const radios = [...block.querySelectorAll('input[type=radio]')];
  if (radios.length >= 2) {
    return radios.map((r, i) => ({ index: i + 1, label: clean(r.getAttribute('value')) || `#${i + 1}`, value: r.value }));
  }
  return null;
}

function parseForm(html) {
  const doc = new JSDOM(html).window.document;
  const used = new Set();
  const out = [];
  for (const block of optionBlocks(doc)) {
    const label = labelOf(block);
    if (!label || label.length > 80) continue;
    if (/^(quantity|rating|review|display name|email|sort by|country|shipping)/i.test(label)) continue;

    const input = block.querySelector('input[type=text], input:not([type]), textarea');
    const values = swatchValues(block);
    const required = /required/i.test(block.className) || !!block.querySelector('.ant-form-item-required, [required]');
    const hint = clean(block.querySelector('.ant-form-item-extra, [class*="help"], small')?.textContent) || null;

    let entry = null;
    if (values && values.length >= 2) {
      const isCount = /number of|how many/i.test(label) || /template-select/.test(block.className);
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
    personalization = markIndexed(parseForm(html));
    if (!personalization.length) {
      warnings.push('không thấy form cá nhân hoá trong HTML — trang này dựng bằng JS, cần trình duyệt render (đặt FIRECRAWL_API_KEY hoặc truyền html sẵn)');
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
