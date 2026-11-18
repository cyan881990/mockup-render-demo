'use strict';
/**
 * Server-side catalogue: products, mockups, designs, fonts.
 * JSON-file backed with hot reload; every design/mockup carries a content hash that
 * feeds the render cache key, so editing one design invalidates only its own images.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FontRegistry } = require('./fonts');

const DATA_DIR = path.join(__dirname, '..', 'data');
const hash = (o) => crypto.createHash('sha1').update(JSON.stringify(o)).digest('base64url').slice(0, 10);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) {
    if (e.code !== 'ENOENT') console.error(`[registry] ${path.basename(file)}: ${e.message}`);
    return fallback;
  }
}

class Registry {
  constructor(dataDir = DATA_DIR) {
    this.dir = dataDir;
    this.fonts = new FontRegistry();
    this.products = new Map();
    this.mockups = new Map();
    this.designs = new Map();
    this.handles = new Map();
    this.settings = {};
    this.version = '0';
    this.listeners = new Set();
  }

  file(kind) { return path.join(this.dir, `${kind}.json`); }

  loadAll() {
    this.settings = readJson(this.file('settings'), {});
    this.fonts.load(readJson(this.file('fonts'), []));

    this.designs.clear();
    for (const d of readJson(this.file('designs'), [])) {
      d.hash = hash(d);
      this.designs.set(d.id, d);
    }

    this.mockups.clear();
    for (const m of readJson(this.file('mockups'), [])) {
      m.hash = hash(m);
      this.mockups.set(m.id, m);
    }

    this.products.clear();
    this.handles.clear();
    for (const p of readJson(this.file('products'), [])) {
      p.hash = hash(p);
      this.products.set(p.id, p);
      for (const h of [p.handle, ...(p.handles || [])].filter(Boolean)) this.handles.set(h.toLowerCase(), p);
    }

    this.version = hash([...this.designs.keys()].concat([...this.mockups.keys()]).concat(this.version === '0' ? [] : []));
    this.emit();
    return this;
  }

  save(kind, items) {
    fs.writeFileSync(this.file(kind), JSON.stringify(items, null, 2));
    this.loadAll();
  }

  upsert(kind, item) {
    const list = readJson(this.file(kind), []);
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = { ...list[i], ...item }; else list.push(item);
    this.save(kind, list);
    return this.get(kind, item.id);
  }

  remove(kind, id) {
    const list = readJson(this.file(kind), []).filter((x) => x.id !== id);
    this.save(kind, list);
  }

  get(kind, id) {
    return ({ designs: this.designs, mockups: this.mockups, products: this.products })[kind]?.get(id);
  }

  design(id) { return this.designs.get(id); }
  mockup(id) { return this.mockups.get(id); }
  product(id) { return this.products.get(id) || this.handles.get(String(id || '').toLowerCase()); }

  /**
   * Find the product for a storefront handle.
   * Exact handle first, then a SKU token (xma011102...), then keyword overlap —
   * so new storefront slugs keep working without a config change.
   */
  matchHandle(handle) {
    if (!handle) return null;
    const h = String(handle).toLowerCase();
    const exact = this.handles.get(h);
    if (exact) return exact;

    for (const p of this.products.values()) {
      for (const sku of p.match?.sku || []) {
        if (h.includes(String(sku).toLowerCase())) return p;
      }
    }
    const tokens = new Set(h.split(/[^a-z0-9]+/).filter((t) => t.length > 2));
    let best = null, bestScore = 0;
    for (const p of this.products.values()) {
      const keys = (p.match?.keywords || []).map((k) => k.toLowerCase());
      if (!keys.length) continue;
      const score = keys.reduce((a, k) => a + (tokens.has(k) || h.includes(k) ? 1 : 0), 0) / keys.length;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return bestScore >= 0.6 ? best : null;
  }

  mockupsFor(product) {
    return (product.mockups || []).map((id) => this.mockups.get(id)).filter(Boolean);
  }

  /** Public option schema for a product — lets the storefront build the personalizer UI. */
  schema(product) {
    const design = this.design(product.designId);
    if (!design) return null;
    return {
      product: { id: product.id, handle: product.handle, title: product.title },
      design: { id: design.id, name: design.name, canvas: design.canvas },
      mockups: this.mockupsFor(product).map((m) => ({ id: m.id, name: m.name, size: m.size, default: m.id === (product.defaultMockup || product.mockups?.[0]) })),
      options: (design.options || []).map((o) => ({
        key: o.key, type: o.type, label: o.label, default: o.default,
        indexed: o.indexed ? { by: o.indexed.by, from: o.indexed.from ?? 1, max: o.indexed.max } : undefined,
        min: o.min, max: o.max, maxLength: o.maxLength,
        values: o.values?.map((v) => ({ value: v.value, label: v.label, hex: v.hex })),
      })),
    };
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) { try { fn(this); } catch (e) { console.error(e); } } }

  watch() {
    let t = null;
    try {
      fs.watch(this.dir, () => {
        clearTimeout(t);
        t = setTimeout(() => { console.log('[registry] config changed, reloading'); this.loadAll(); }, 150);
      });
    } catch (e) { console.warn(`[registry] watch unavailable: ${e.message}`); }
    return this;
  }
}

module.exports = { Registry, DATA_DIR };
