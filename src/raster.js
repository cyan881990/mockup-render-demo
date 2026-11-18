'use strict';
/** Premultiplied-RGBA canvas ops: fill, blit, tile, and overlaying a resvg band. */

function canvas(w, h, bgHex) {
  const buf = Buffer.alloc(w * h * 4);
  if (bgHex && bgHex !== 'transparent' && bgHex !== 'none') {
    const r = parseInt(bgHex.slice(1, 3), 16), g = parseInt(bgHex.slice(3, 5), 16), b = parseInt(bgHex.slice(5, 7), 16);
    for (let i = 0; i < buf.length; i += 4) { buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255; }
  }
  return buf;
}

/** Source-over blit of a premultiplied RGBA sprite at integer (dx,dy). */
function blit(dst, dw, dh, src, sw, sh, dx, dy, opacity = 1) {
  dx = Math.round(dx); dy = Math.round(dy);
  const x0 = Math.max(0, dx), y0 = Math.max(0, dy);
  const x1 = Math.min(dw, dx + sw), y1 = Math.min(dh, dy + sh);
  if (x1 <= x0 || y1 <= y0) return;
  const op = opacity >= 1 ? 1 : Math.max(0, opacity);
  for (let y = y0; y < y1; y++) {
    let si = (((y - dy) * sw) + (x0 - dx)) << 2;
    let di = ((y * dw) + x0) << 2;
    for (let x = x0; x < x1; x++, si += 4, di += 4) {
      let a = src[si + 3];
      if (a === 0) continue;
      let r = src[si], g = src[si + 1], b = src[si + 2];
      if (op !== 1) { a *= op; r *= op; g *= op; b *= op; }
      if (a >= 255) { dst[di] = r; dst[di + 1] = g; dst[di + 2] = b; dst[di + 3] = 255; continue; }
      const inv = 1 - a / 255;
      dst[di] = r + dst[di] * inv;
      dst[di + 1] = g + dst[di + 1] * inv;
      dst[di + 2] = b + dst[di + 2] * inv;
      dst[di + 3] = a + dst[di + 3] * inv;
    }
  }
}

/** Repeat a sprite across a rect. */
function tile(dst, dw, dh, src, sw, sh, rect, opacity = 1) {
  const { x, y, w, h } = rect;
  for (let ty = y; ty < y + h; ty += sh) {
    for (let tx = x; tx < x + w; tx += sw) blit(dst, dw, dh, src, sw, sh, tx, ty, opacity);
  }
}

/** Overlay a full-canvas band coming from resvg (straight RGBA) onto a premultiplied canvas. */
function overlayBand(dst, band) {
  const n = dst.length;
  for (let i = 0; i < n; i += 4) {
    const a = band[i + 3];
    if (a === 0) continue;
    if (a === 255) { dst[i] = band[i]; dst[i + 1] = band[i + 1]; dst[i + 2] = band[i + 2]; dst[i + 3] = 255; continue; }
    const f = a / 255, inv = 1 - f;
    dst[i] = band[i] * f + dst[i] * inv;
    dst[i + 1] = band[i + 1] * f + dst[i + 1] * inv;
    dst[i + 2] = band[i + 2] * f + dst[i + 2] * inv;
    dst[i + 3] = a + dst[i + 3] * inv;
  }
}

module.exports = { canvas, blit, tile, overlayBand };
