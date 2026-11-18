'use strict';
/**
 * Turns a storefront URL / query string into a validated, canonical option set.
 * Unknown params (utm_*, fbclid, ...) are dropped so they can never fragment the cache.
 */
const crypto = require('crypto');

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;
const normHex = (v) => {
  const m = HEX.exec(String(v).trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `#${h.toLowerCase()}`;
};

const cleanText = (v, maxLength = 24) => String(v)
  .replace(/[\u0000-\u001f\u007f<>]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, maxLength);

/** Parse a product URL (or bare query string) into { handle, query }. */
function parseProductUrl(input) {
  let handle = null;
  let query = {};
  if (!input) return { handle, query };
  const raw = String(input).trim();
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://x.invalid/${raw.replace(/^\/+/, '')}`);
    const m = /\/products\/([^/?#]+)/.exec(u.pathname) || /^\/([^/?#]+)$/.exec(u.pathname);
    if (m) handle = decodeURIComponent(m[1]);
    for (const [k, v] of u.searchParams) query[k] = v;
  } catch {
    const [p, q] = raw.split('?');
    const m = /\/products\/([^/?#]+)/.exec(p);
    if (m) handle = decodeURIComponent(m[1]);
    if (q) for (const [k, v] of new URLSearchParams(q)) query[k] = v;
  }
  return { handle, query };
}

/** Pick one value of a swatch/enum option, with alias + custom-hex support. */
function pickValue(opt, raw) {
  const values = opt.values || [];
  if (raw !== undefined && raw !== null && raw !== '') {
    const key = String(raw).trim().toLowerCase();
    const hit = values.find((v) =>
      String(v.value).toLowerCase() === key ||
      (v.aliases || []).some((a) => String(a).toLowerCase() === key));
    if (hit) return { ...hit, custom: false };
    if (opt.allowCustomHex) {
      const hex = normHex(raw);
      if (hex) return { value: hex, label: hex, hex, custom: true };
    }
  }
  const def = values.find((v) => String(v.value) === String(opt.default)) || values[0];
  return def ? { ...def, custom: false, fallback: true } : { value: '', label: '', hex: '#000000' };
}

/**
 * Normalize raw query against a design's option schema.
 * @returns {{opt:Object, members:Array, canonical:Array, warnings:Array}}
 */
function normalize(design, rawQuery = {}, aliases = {}) {
  const q = {};
  for (const [k, v] of Object.entries(rawQuery)) q[String(k).toLowerCase()] = v;
  for (const [from, to] of Object.entries(aliases)) {
    if (q[from.toLowerCase()] !== undefined && q[to.toLowerCase()] === undefined) q[to.toLowerCase()] = q[from.toLowerCase()];
  }

  const opt = {}, canonical = [], warnings = [];
  const simple = (design.options || []).filter((o) => !o.indexed);
  const indexed = (design.options || []).filter((o) => o.indexed);

  for (const o of simple) {
    const raw = q[o.key.toLowerCase()];
    let val;
    switch (o.type) {
      case 'range':
      case 'int': {
        const n = parseInt(raw, 10);
        const def = Number(o.default ?? o.min ?? 1);
        val = Number.isFinite(n) ? Math.min(Number(o.max ?? 99), Math.max(Number(o.min ?? 0), n)) : def;
        if (raw !== undefined && !Number.isFinite(n)) warnings.push(`${o.key}: not a number, using ${def}`);
        break;
      }
      case 'bool': {
        const s = String(raw ?? o.default ?? 'false').toLowerCase();
        val = s === '1' || s === 'true' || s === 'yes' || s === 'on';
        break;
      }
      case 'text': {
        const t = cleanText(raw ?? o.default ?? '', o.maxLength ?? 24);
        val = t || cleanText(o.default ?? '', o.maxLength ?? 24);
        if (o.upper) val = val.toUpperCase();
        break;
      }
      case 'color': {
        val = normHex(raw) || normHex(o.default) || '#000000';
        break;
      }
      default:
        val = pickValue(o, raw);
    }
    opt[o.key] = val;
    canonical.push([o.key, typeof val === 'object' && val !== null ? val.value : val]);
  }

  // indexed options: soc1..socN, name1..nameN — count driven by another option
  const members = [];
  for (const o of indexed) {
    const countKey = o.indexed.by;
    const count = Math.max(0, Math.min(Number(o.indexed.max ?? 20), Number(opt[countKey] ?? o.indexed.count ?? 0)));
    const from = Number(o.indexed.from ?? 1);
    const list = [];
    for (let i = 0; i < count; i++) {
      const idxKey = `${o.key}${from + i}`.toLowerCase();
      const raw = q[idxKey] !== undefined ? q[idxKey] : q[o.key.toLowerCase()];
      let val;
      if (o.type === 'text') val = cleanText(raw ?? o.default ?? '', o.maxLength ?? 18);
      else if (o.type === 'int' || o.type === 'range') {
        const n = parseInt(raw, 10);
        val = Number.isFinite(n) ? n : Number(o.default ?? 1);
      } else val = pickValue(o, raw);
      list.push(val);
      canonical.push([`${o.key}${from + i}`, typeof val === 'object' && val !== null ? val.value : val]);
      members[i] = { ...(members[i] || {}), i: from + i, idx: i, [o.as || o.key]: val };
    }
    opt[o.key] = list;
  }

  canonical.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { opt, members, canonical, warnings };
}

/** Short, stable cache token for a canonical option list + render settings. */
function optionsHash(canonical, extra = {}) {
  const s = canonical.map(([k, v]) => `${k}=${v}`).join('&') + '|' +
    Object.keys(extra).sort().map((k) => `${k}=${extra[k]}`).join('&');
  return crypto.createHash('sha1').update(s).digest('base64url').slice(0, 22);
}

module.exports = { parseProductUrl, normalize, optionsHash, cleanText, normHex, pickValue };
