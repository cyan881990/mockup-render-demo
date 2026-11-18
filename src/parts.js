'use strict';
/**
 * Artwork part cache.
 * A design part (stocking, tree, snow tile ...) is decoded, tinted and scaled ONCE per
 * (file, size, tint) and kept as premultiplied RGBA, so repeat renders never touch a PNG decoder.
 */
const path = require('path');
const sharp = require('sharp');
const { LRUCache } = require('lru-cache');
const { premultiply } = require('./compose');
const { ASSET_DIR } = require('./assets');

const SNAP = 2; // round target sizes so near-identical sizes share one entry
const snap = (n) => Math.max(1, Math.round(n / SNAP) * SNAP);

class PartStore {
  constructor({ cacheMB = 192, dir = path.join(ASSET_DIR, 'art') } = {}) {
    this.dir = dir;
    this.cache = new LRUCache({ maxSize: cacheMB * 1024 * 1024, sizeCalculation: (v) => v.data.length });
    this.inflight = new Map();
    this.stats = { hit: 0, miss: 0 };
  }

  key(src, w, h, tint, flip) { return `${src}|${w}x${h}|${tint || '-'}|${flip || ''}`; }

  /** @returns {Promise<{data:Buffer,w:number,h:number}>} premultiplied RGBA */
  async get(src, width, height, tint = null, opts = {}) {
    const w = snap(width), h = snap(height);
    const k = this.key(src, w, h, tint, opts.flip);
    const hit = this.cache.get(k);
    if (hit) { this.stats.hit++; return hit; }
    const pending = this.inflight.get(k);
    if (pending) return pending;

    this.stats.miss++;
    const p = (async () => {
      let pipe = sharp(path.isAbsolute(src) ? src : path.join(this.dir, src))
        .resize(w, h, {
          fit: opts.fit || 'fill',
          kernel: 'lanczos3',
          background: { r: 0, g: 0, b: 0, alpha: 0 },   // contain-padding must be transparent
        });
      if (opts.flip === 'x') pipe = pipe.flop();
      if (tint) {
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(tint.slice(i, i + 2), 16) / 255);
        pipe = pipe.linear([r, g, b], [0, 0, 0]);      // per-channel multiply = clean tint
      }
      const { data, info } = await pipe.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const entry = { data: premultiply(data), w: info.width, h: info.height };
      this.cache.set(k, entry);
      return entry;
    })().finally(() => this.inflight.delete(k));
    this.inflight.set(k, p);
    return p;
  }

  info() {
    const total = this.stats.hit + this.stats.miss;
    return {
      entries: this.cache.size,
      mb: +(this.cache.calculatedSize / 1048576).toFixed(1),
      hitRate: total ? +((this.stats.hit / total) * 100).toFixed(1) : 0,
      ...this.stats,
    };
  }
}

module.exports = { PartStore };
