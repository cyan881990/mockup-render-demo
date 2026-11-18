'use strict';
/**
 * Three tiers in front of the renderer:
 *   L0  in-flight dedupe  — 500 simultaneous hits on a cold URL render once
 *   L1  memory LRU        — encoded image bytes, instant
 *   L2  disk              — survives restarts/deploys, still ~1ms
 * Plus HTTP: strong ETag + immutable Cache-Control so a CDN absorbs the rest.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { LRUCache } = require('lru-cache');

const CACHE_DIR = path.join(__dirname, '..', '.cache');

class RenderCache {
  constructor({ memoryMB = 256, diskEnabled = true, dir = CACHE_DIR } = {}) {
    this.mem = new LRUCache({
      maxSize: memoryMB * 1024 * 1024,
      sizeCalculation: (v) => v.body.length + 128,
      ttl: 0,
    });
    this.dir = dir;
    this.diskEnabled = diskEnabled;
    this.inflight = new Map();
    this.stats = { hitMem: 0, hitDisk: 0, miss: 0, coalesced: 0, stored: 0 };
    if (diskEnabled) fs.mkdirSync(dir, { recursive: true });
  }

  diskPath(key, ext) { return path.join(this.dir, key.slice(0, 2), `${key}.${ext}`); }

  async get(key, ext) {
    const m = this.mem.get(key);
    if (m) { this.stats.hitMem++; return { ...m, tier: 'memory' }; }
    if (this.diskEnabled) {
      try {
        const body = await fsp.readFile(this.diskPath(key, ext));
        const entry = { body, etag: `"${key}"`, contentType: null };
        this.mem.set(key, entry);
        this.stats.hitDisk++;
        return { ...entry, tier: 'disk' };
      } catch { /* cold */ }
    }
    return null;
  }

  async set(key, ext, body, contentType) {
    const entry = { body, etag: `"${key}"`, contentType };
    this.mem.set(key, entry);
    this.stats.stored++;
    if (this.diskEnabled) {
      const p = this.diskPath(key, ext);
      const tmp = `${p}.${process.pid}.${(this.seq = (this.seq || 0) + 1)}.tmp`;   // unique: live + background writes race
      fsp.mkdir(path.dirname(p), { recursive: true })
        .then(() => fsp.writeFile(tmp, body))
        .then(() => fsp.rename(tmp, p))
        .catch((e) => { fsp.rm(tmp, { force: true }).catch(() => {}); console.warn(`[cache] disk write failed: ${e.message}`); });
    }
    return entry;
  }

  /** Single-flight wrapper: identical concurrent keys share one render. */
  async resolve(key, ext, producer) {
    const hit = await this.get(key, ext);
    if (hit) return hit;
    const pending = this.inflight.get(key);
    if (pending) { this.stats.coalesced++; return pending; }
    this.stats.miss++;
    const p = (async () => {
      const { body, contentType } = await producer();
      const entry = await this.set(key, ext, body, contentType);
      return { ...entry, contentType, tier: 'render' };
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** Drop everything whose key carries a given prefix tag (design/mockup version). */
  purge(predicate) {
    let n = 0;
    for (const k of [...this.mem.keys()]) if (!predicate || predicate(k)) { this.mem.delete(k); n++; }
    return n;
  }

  async purgeDisk() {
    if (!this.diskEnabled) return 0;
    await fsp.rm(this.dir, { recursive: true, force: true });
    await fsp.mkdir(this.dir, { recursive: true });
    return 1;
  }

  info() {
    const total = this.stats.hitMem + this.stats.hitDisk + this.stats.miss + this.stats.coalesced;
    return {
      ...this.stats,
      hitRate: total ? +(((this.stats.hitMem + this.stats.hitDisk + this.stats.coalesced) / total) * 100).toFixed(1) : 0,
      memoryEntries: this.mem.size,
      memoryMB: +(this.mem.calculatedSize / 1048576).toFixed(1),
      inflight: this.inflight.size,
    };
  }
}

module.exports = { RenderCache, CACHE_DIR };
