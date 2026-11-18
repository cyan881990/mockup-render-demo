'use strict';
/**
 * Mockup asset store.
 * Decodes each mockup's photo + maps ONCE into raw buffers, per output width,
 * so a render never pays JPEG/PNG decode or resize cost.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { homographyFromUnitSquare, invert3, scaleQuad, quadBounds } = require('./geom');

const ASSET_DIR = path.join(__dirname, '..', 'assets');
const abs = (p) => (path.isAbsolute(p) ? p : path.join(ASSET_DIR, p));

/** Non-zero bounds of an 8-bit mask, so the blend loop touches as little as possible. */
function maskBounds(mask, W, H, pad = 1) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      if (mask[row + x] !== 0) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x0: 0, y0: 0, x1: -1, y1: -1 };
  return {
    x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - pad),
    x1: Math.min(W - 1, x1 + pad), y1: Math.min(H - 1, y1 + pad),
  };
}

const intersect = (a, b) => ({
  x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0),
  x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1),
});

class AssetStore {
  constructor({ widths = [400, 600, 800, 1000, 1200, 1600] } = {}) {
    this.widths = [...widths].sort((a, b) => a - b);
    this.bundles = new Map();   // `${mockupId}@${width}` -> bundle
    this.native = new Map();    // mockupId -> { W, H }
    this.loading = new Map();
  }

  /** Snap a requested width to the nearest prepared variant (never upscale past native). */
  snapWidth(mockup, requested) {
    const native = mockup.size[0];
    const allowed = this.widths.filter((w) => w <= native);
    if (!allowed.length) return native;
    if (!requested) return Math.min(native, mockup.previewWidth || allowed[allowed.length - 1]);
    for (const w of allowed) if (w >= requested) return w;
    return native;
  }

  key(mockupId, width) { return `${mockupId}@${width}`; }

  async get(mockup, width) {
    const k = this.key(mockup.id, width);
    const hit = this.bundles.get(k);
    if (hit) return hit;
    if (this.loading.has(k)) return this.loading.get(k);
    const p = this.build(mockup, width).then((b) => { this.bundles.set(k, b); this.loading.delete(k); return b; },
      (e) => { this.loading.delete(k); throw e; });
    this.loading.set(k, p);
    return p;
  }

  async build(mockup, width) {
    const t0 = process.hrtime.bigint();
    const nativeW = mockup.size[0], nativeH = mockup.size[1];
    const W = Math.round(width);
    const H = Math.round((nativeH / nativeW) * W);
    const scale = W / nativeW;

    const baseImg = sharp(abs(mockup.base)).resize(W, H, { fit: 'cover', fastShrinkOnLoad: true });
    const base = await baseImg.removeAlpha().raw().toBuffer();

    const loadGray = async (p) => {
      if (!p) return null;
      const f = abs(p);
      if (!fs.existsSync(f)) return null;
      const buf = await sharp(f).resize(W, H, { fit: 'cover' }).greyscale().removeAlpha().raw().toBuffer();
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
    };

    const [mask, light, disp] = await Promise.all([
      loadGray(mockup.mask), loadGray(mockup.light), loadGray(mockup.displaceMap),
    ]);

    let overlay = null;
    if (mockup.overlay && fs.existsSync(abs(mockup.overlay))) {
      overlay = await sharp(abs(mockup.overlay)).resize(W, H, { fit: 'cover' }).png().toBuffer();
    }

    const quad = scaleQuad(mockup.surface.points, scale);
    const Hm = homographyFromUnitSquare(quad);
    const Hinv = invert3(Hm);
    let bbox = quadBounds(quad, W, H, 2);
    if (mask) bbox = intersect(bbox, maskBounds(mask, W, H, 1));

    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const px = (bbox.x1 - bbox.x0 + 1) * (bbox.y1 - bbox.y0 + 1);
    console.log(`[assets] ${mockup.id}@${W} ready in ${ms.toFixed(0)}ms (print area ${px.toLocaleString()}px)`);

    return {
      id: mockup.id, W, H, scale, base, mask, light, disp, overlay,
      quad, mat: Hm, Hinv, bbox, mockup,
      // artwork raster size: enough to cover the printed area without oversampling
      artWidth: Math.min(mockup.artMaxWidth || 2400, Math.ceil(Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]) * (mockup.artOversample || 1.15))),
    };
  }

  /** Drop cached variants for a mockup (used when its definition or files change). */
  invalidate(mockupId) {
    for (const k of [...this.bundles.keys()]) if (k.startsWith(`${mockupId}@`)) this.bundles.delete(k);
  }

  clear() { this.bundles.clear(); }

  stats() {
    let bytes = 0;
    for (const b of this.bundles.values()) {
      bytes += b.base.length + (b.mask?.length || 0) + (b.light?.length || 0) + (b.disp?.length || 0);
    }
    return { variants: this.bundles.size, residentMB: +(bytes / 1048576).toFixed(1) };
  }
}

module.exports = { AssetStore, ASSET_DIR, abs };
