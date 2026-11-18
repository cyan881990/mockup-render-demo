'use strict';
/**
 * Layer planner.
 * Flattens a design (conditions, repeats, groups) into z-ordered nodes, classifies each as
 * a cached raster sprite or a vector/text node, then merges nodes into as few passes
 * ("bands") as z-order safely allows — two nodes may share a pass whenever nothing that
 * sits between them overlaps, which is the common case.
 */
const { resolve, num, when } = require('./expr');

const INF = { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 };
const box = (x, y, w, h) => ({ x0: x, y0: y, x1: x + w, y1: y + h });
const union = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const hits = (a, b) => !(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0);

/** Conservative bbox for a vector layer; unknown geometry yields INF (forces its own pass). */
function vectorBBox(layer, scope, fonts, canvas) {
  if (layer.transform) return INF;
  const pad = layer.strokeWidth ? num(layer.strokeWidth, scope, 0) / 2 + 1 : 1;
  switch (layer.type) {
    case 'rect':
      return box(num(layer.x, scope) - pad, num(layer.y, scope) - pad,
        num(layer.w, scope) + pad * 2, num(layer.h, scope) + pad * 2);
    case 'ellipse': {
      const cx = num(layer.cx, scope), cy = num(layer.cy, scope);
      const rx = num(layer.rx, scope) + pad, ry = num(layer.ry ?? layer.rx, scope) + pad;
      return box(cx - rx, cy - ry, rx * 2, ry * 2);
    }
    case 'path': {
      const d = String(resolve(layer.d, scope) || '');
      if (/[aA]/.test(d)) return INF;                        // arcs: control points don't bound them
      const nums = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
      if (!nums || nums.length < 2) return INF;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const x = parseFloat(nums[i]), y = parseFloat(nums[i + 1]);
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    }
    case 'text': {
      let text = resolve(layer.text, scope);
      if (text == null || text === '') return null;
      text = String(text).replace(/\s+/g, ' ').trim();
      if (layer.transformText === 'upper') text = text.toUpperCase();
      const fontId = fonts.pick(resolve(layer.font, scope) || 'default', text).id;
      let size = num(layer.size, scope, 48);
      const maxWidth = layer.fit ? num(layer.fit.maxWidth, scope, 0) : 0;
      const tracking = layer.letterSpacing ? num(layer.letterSpacing, scope, 0) : 0;
      let w = fonts.measure(fontId, text, size, tracking);
      if (maxWidth && w > maxWidth) { size = Math.max(num(layer.fit.minSize, scope, 10), (maxWidth / w) * size); w = maxWidth; }
      const lines = layer.wrap ? Math.max(1, num(layer.wrap.maxLines, scope, 2)) : 1;
      const m = fonts.metrics(fontId, size);
      const lineH = num(layer.lineHeight, scope, 0) || size * 1.1;
      const x = num(layer.x, scope), y = num(layer.y, scope);
      const anchor = layer.align || 'center';
      const left = anchor === 'center' ? x - w / 2 : anchor === 'right' ? x - w : x;
      const strokePad = layer.strokeWidth ? num(layer.strokeWidth, scope, 0) : 0;
      return {
        x0: left - strokePad - 2, y0: y - m.ascent - strokePad - 2,
        x1: left + w + strokePad + 2, y1: y + m.descent + (lines - 1) * lineH + strokePad + 2,
      };
    }
    default:
      return INF;
  }
}

/** Expand conditions / repeats / groups into a flat z-ordered node list. */
function flatten(layers, scope, fonts, canvas, out = []) {
  for (const layer of layers || []) {
    if (!when(layer.when, scope)) continue;

    if (layer.type === 'group') {
      if (layer.transform || layer.opacity !== undefined) {
        out.push({ kind: 'vector', layer, scope, bbox: INF });      // transformed group stays intact
      } else flatten(layer.children, scope, fonts, canvas, out);
      continue;
    }

    if (layer.type === 'repeat') {
      const items = resolve(layer.over, scope);
      if (!Array.isArray(items) || !items.length) continue;
      const lay = layer.layout || {};
      const n = items.length;
      const itemW = num(lay.itemW, scope, 200);
      const itemH = num(lay.itemH, scope, itemW);
      const maxWidth = num(lay.maxWidth, scope, 0);
      let gap = lay.gap === 'auto' ? itemW * 0.12 : num(lay.gap, scope, 0);
      let w = itemW, h = itemH;
      if (maxWidth && n * w + (n - 1) * gap > maxWidth) {
        const k = maxWidth / (n * w + (n - 1) * gap);
        w *= k; h *= k; gap *= k;
      }
      const total = n * w + (n - 1) * gap;
      const centerX = num(lay.centerX, scope, 0), baselineY = num(lay.baselineY, scope, 0);
      const startX = centerX - total / 2;
      const as = layer.as || 'slot';

      if (lay.mode === 'arc') {
        // rải đều trên một cung tròn — dùng cho mặt in tròn (ornament, đĩa, huy hiệu)
        const cx0 = num(lay.centerX, scope, canvas.w / 2);
        const cy0 = num(lay.centerY, scope, canvas.h / 2);
        const radius = num(lay.radius, scope, Math.min(canvas.w, canvas.h) * 0.33);
        const a0 = num(lay.startDeg, scope, 200) * Math.PI / 180;
        const a1 = num(lay.endDeg, scope, 340) * Math.PI / 180;
        // cung hẹp lại khi ít vật phẩm, để chúng không nằm thưa thớt
        const spanK = Math.min(1, (n - 1) / Math.max(1, num(lay.spreadAt, scope, 5) - 1));
        const mid = (a0 + a1) / 2;
        const lo = n === 1 ? mid : mid - (mid - a0) * spanK;
        const hi = n === 1 ? mid : mid + (a1 - mid) * spanK;
        items.forEach((item, idx) => {
          const t = n === 1 ? 0.5 : idx / (n - 1);
          const ang = lo + (hi - lo) * t;
          const cx = cx0 + Math.cos(ang) * radius;
          const cy = cy0 + Math.sin(ang) * radius;
          const slot = {
            ...item, idx, i: idx + 1, n, w, h,
            x: cx - w / 2, y: cy - h / 2, cx, cy, bottom: cy + h / 2,
            angle: ang * 180 / Math.PI,
          };
          flatten(layer.children, { ...scope, [as]: slot }, fonts, canvas, out);
        });
        continue;
      }

      items.forEach((item, idx) => {
        const x = startX + idx * (w + gap);
        const stagger = lay.stagger ? num(lay.stagger, scope, 0) * (idx % 2 === 0 ? -1 : 1) : 0;
        const slot = {
          ...item, idx, i: idx + 1, n, x, y: baselineY - h + stagger, w, h,
          cx: x + w / 2, cy: baselineY - h / 2 + stagger, bottom: baselineY + stagger,
        };
        flatten(layer.children, { ...scope, [as]: slot }, fonts, canvas, out);
      });
      continue;
    }

    if (layer.type === 'image' && !layer.transform) {
      const src = resolve(layer.src, scope);
      if (!src) continue;
      const x = num(layer.x, scope), y = num(layer.y, scope);
      const w = num(layer.w, scope), h = num(layer.h, scope);
      if (w <= 0 || h <= 0) continue;
      out.push({
        kind: 'raster', src, x, y, w, h,
        tint: layer.tint ? resolve(layer.tint, scope) : null,
        opacity: layer.opacity !== undefined ? num(layer.opacity, scope, 1) : 1,
        fitMode: layer.fitMode, flip: layer.flip,
        bbox: box(x, y, w, h),
      });
      continue;
    }

    if (layer.type === 'pattern' && !layer.transform) {
      const src = resolve(layer.src, scope);
      const size = num(layer.size, scope, 120);
      const rect = {
        x: num(layer.x, scope, 0), y: num(layer.y, scope, 0),
        w: num(layer.w ?? canvas.w, scope, canvas.w), h: num(layer.h ?? canvas.h, scope, canvas.h),
      };
      out.push({
        kind: 'tile', src, size, rect,
        tint: layer.tint ? resolve(layer.tint, scope) : null,
        opacity: layer.opacity !== undefined ? num(layer.opacity, scope, 1) : 1,
        bbox: box(rect.x, rect.y, rect.w, rect.h),
      });
      continue;
    }

    const bbox = vectorBBox(layer, scope, fonts, canvas);
    if (bbox === null) continue;                                   // empty text etc.
    out.push({ kind: 'vector', layer, scope, bbox });
  }
  return out;
}

/** Merge nodes into the fewest passes that still respect overlap-sensitive z-order. */
function band(nodes) {
  const bands = [];
  for (const node of nodes) {
    const kind = node.kind === 'vector' ? 'vector' : 'raster';
    let target = -1;
    for (let i = bands.length - 1; i >= 0; i--) {
      if (bands[i].kind === kind) { target = i; break; }
      if (hits(bands[i].bbox, node.bbox)) break;                   // something in between would be reordered
    }
    if (target >= 0) {
      bands[target].nodes.push(node);
      bands[target].bbox = union(bands[target].bbox, node.bbox);
    } else {
      bands.push({ kind, nodes: [node], bbox: node.bbox });
    }
  }
  return bands;
}

function plan(design, scope, fonts) {
  const nodes = flatten(design.layers, scope, fonts, design.canvas);
  return { nodes, bands: band(nodes) };
}

module.exports = { plan, flatten, band, vectorBBox, hits, INF };
