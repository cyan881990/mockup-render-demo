'use strict';
/** Linear algebra + perspective mapping helpers (no deps, hot path friendly). */

/** Solve A x = b via Gaussian elimination with partial pivoting. n<=8. */
function solve(A, b, n) {
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) throw new Error('singular matrix in homography solve');
    if (piv !== col) { const t = M[piv]; M[piv] = M[col]; M[col] = t; }
    const d = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

/**
 * Homography mapping the unit square (0,0)-(1,1) onto an arbitrary quad.
 * quad = [[x,y] TL, TR, BR, BL]
 * returns row-major 3x3 [h0..h8] with h8 = 1
 */
function homographyFromUnitSquare(quad) {
  const src = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i], [x, y] = quad[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  const h = solve(A, b, 8);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Invert a row-major 3x3. */
function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('singular 3x3');
  const id = 1 / det;
  return [
    A * id, (c * h - b * i) * id, (b * f - c * e) * id,
    B * id, (a * i - c * g) * id, (c * d - a * f) * id,
    C * id, (b * g - a * h) * id, (a * e - b * d) * id,
  ];
}

/** Scale a quad (e.g. when rendering a mockup at a smaller width). */
const scaleQuad = (quad, s) => quad.map(([x, y]) => [x * s, y * s]);

/** Axis-aligned bounds of a quad, clamped to image and padded. */
function quadBounds(quad, W, H, pad = 2) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of quad) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return {
    x0: Math.max(0, Math.floor(x0) - pad), y0: Math.max(0, Math.floor(y0) - pad),
    x1: Math.min(W - 1, Math.ceil(x1) + pad), y1: Math.min(H - 1, Math.ceil(y1) + pad),
  };
}

/** Longest edge of the quad — used to pick the artwork raster resolution. */
function quadMaxEdge(quad) {
  let max = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = quad[i], [x2, y2] = quad[(i + 1) % 4];
    max = Math.max(max, Math.hypot(x2 - x1, y2 - y1));
  }
  return max;
}

module.exports = { homographyFromUnitSquare, invert3, scaleQuad, quadBounds, quadMaxEdge, solve };
