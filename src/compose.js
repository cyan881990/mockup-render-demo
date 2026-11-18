'use strict';
/**
 * Core pixel stage: warp the artwork onto the mockup's print surface and blend it
 * with the mockup's mask / light / displacement maps.
 *
 * Everything runs over raw buffers inside the print-area bounding box only, so the
 * cost scales with the printed region, not with the whole photo.
 */

/** Reusable output buffers — keeps GC quiet under load. */
const pool = new Map();
function take(size) {
  const bucket = pool.get(size);
  if (bucket && bucket.length) return bucket.pop();
  return Buffer.allocUnsafe(size);
}
function give(buf) {
  const bucket = pool.get(buf.length) || [];
  if (bucket.length < 8) { bucket.push(buf); pool.set(buf.length, bucket); }
}

/** Premultiply an RGBA artwork raster once so bilinear sampling can't bleed edges. */
function premultiply(rgba) {
  const n = rgba.length;
  const out = Buffer.allocUnsafe(n);
  for (let i = 0; i < n; i += 4) {
    const a = rgba[i + 3];
    if (a === 255) { out[i] = rgba[i]; out[i + 1] = rgba[i + 1]; out[i + 2] = rgba[i + 2]; out[i + 3] = 255; continue; }
    if (a === 0) { out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 0; continue; }
    const f = a / 255;
    out[i] = rgba[i] * f; out[i + 1] = rgba[i + 1] * f; out[i + 2] = rgba[i + 2] * f; out[i + 3] = a;
  }
  return out;
}

/**
 * @param {object} bundle  mockup bundle at the target width (see assets.js)
 * @param {{w:number,h:number,data:Buffer}} art  premultiplied RGBA artwork
 * @param {object} o       { opacity, lightStrength, bilinear, cylinder, displace }
 * @returns {{data:Buffer,W:number,H:number,channels:3}}
 */
function composite(bundle, art, o = {}) {
  const { W, H, base, mask, light, disp, Hinv, bbox } = bundle;
  const out = take(W * H * 3);
  base.copy(out);

  const aw = art.w, ah = art.h, A = art.data;
  const awm = aw - 1, ahm = ah - 1;
  const h0 = Hinv[0], h1 = Hinv[1], h2 = Hinv[2], h3 = Hinv[3], h4 = Hinv[4],
        h5 = Hinv[5], h6 = Hinv[6], h7 = Hinv[7], h8 = Hinv[8];

  const opacity = o.opacity ?? 1;
  const lightStrength = o.lightStrength ?? 1;
  const bilinear = o.bilinear !== false;
  const dx = o.displace ? (o.displace.x ?? 0) : 0;
  const dy = o.displace ? (o.displace.y ?? 0) : 0;
  const useDisp = !!(disp && (dx || dy));
  const cyl = o.cylinder && o.cylinder > 0 ? Math.min(0.999, o.cylinder) : 0;
  const cylK = cyl ? 1 / Math.asin(cyl) : 0;
  const bleed = o.bleed ?? 0.0015;     // nudge sampling inside the artwork edge

  const { x0, y0, x1, y1 } = bbox;
  for (let y = y0; y <= y1; y++) {
    let mi = y * W + x0;
    let oi = mi * 3;
    for (let x = x0; x <= x1; x++, mi++, oi += 3) {
      const mv = mask ? mask[mi] : 255;
      if (mv === 0) continue;

      let px = x + 0.5, py = y + 0.5;
      if (useDisp) { const d = (disp[mi] - 128) / 128; px += d * dx; py += d * dy; }

      const w = h6 * px + h7 * py + h8;
      if (w === 0) continue;
      let u = (h0 * px + h1 * py + h2) / w;
      let v = (h3 * px + h4 * py + h5) / w;
      if (u < -bleed || u > 1 + bleed || v < -bleed || v > 1 + bleed) continue;
      if (u < 0) u = 0; else if (u > 1) u = 1;
      if (v < 0) v = 0; else if (v > 1) v = 1;
      if (cyl) {
        const s = (u - 0.5) * 2 * cyl;
        u = 0.5 + Math.asin(s) * cylK * 0.5;
      }

      let r, g, b, a;
      const fx = u * awm, fy = v * ahm;
      if (bilinear) {
        const xi = fx | 0, yi = fy | 0;
        const xi1 = xi < awm ? xi + 1 : awm, yi1 = yi < ahm ? yi + 1 : ahm;
        const tx = fx - xi, ty = fy - yi;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        const i00 = (yi * aw + xi) << 2, i10 = (yi * aw + xi1) << 2,
              i01 = (yi1 * aw + xi) << 2, i11 = (yi1 * aw + xi1) << 2;
        r = A[i00] * w00 + A[i10] * w10 + A[i01] * w01 + A[i11] * w11;
        g = A[i00 + 1] * w00 + A[i10 + 1] * w10 + A[i01 + 1] * w01 + A[i11 + 1] * w11;
        b = A[i00 + 2] * w00 + A[i10 + 2] * w10 + A[i01 + 2] * w01 + A[i11 + 2] * w11;
        a = A[i00 + 3] * w00 + A[i10 + 3] * w10 + A[i01 + 3] * w01 + A[i11 + 3] * w11;
      } else {
        const i = (((fy + 0.5) | 0) * aw + ((fx + 0.5) | 0)) << 2;
        r = A[i]; g = A[i + 1]; b = A[i + 2]; a = A[i + 3];
      }
      if (a === 0) continue;

      if (light) {
        const f = 1 + ((light[mi] / 128) - 1) * lightStrength;
        r *= f; g *= f; b *= f;
      }

      // art is premultiplied; coverage = alpha * mask * opacity
      const cov = (a / 255) * (mv / 255) * opacity;
      const k = cov / (a / 255);                 // un-premultiply factor folded into the lerp
      const inv = 1 - cov;
      let nr = out[oi] * inv + r * k;
      let ng = out[oi + 1] * inv + g * k;
      let nb = out[oi + 2] * inv + b * k;
      out[oi] = nr > 255 ? 255 : nr;
      out[oi + 1] = ng > 255 ? 255 : ng;
      out[oi + 2] = nb > 255 ? 255 : nb;
    }
  }
  return { data: out, W, H, channels: 3 };
}

module.exports = { composite, premultiply, take, give };
