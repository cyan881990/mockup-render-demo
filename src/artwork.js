'use strict';
/** Design template (JSON layers) -> SVG string. Deterministic: same options => same bytes. */
const { resolve, num, when } = require('./expr');

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const attr = (o) => Object.entries(o)
  .filter(([, v]) => v !== undefined && v !== null && v !== '')
  .map(([k, v]) => `${k}="${typeof v === 'number' ? +v.toFixed(3) : esc(v)}"`).join(' ');

class SvgBuilder {
  constructor(design, fonts) {
    this.design = design;
    this.fonts = fonts;
    this.defs = [];
    this.defKeys = new Set();
    this.body = [];
    this.warnings = [];
  }

  /** Multiply-tint filter for colourable art parts (grayscale PNG -> colour). */
  tintFilter(hex) {
    const id = `t${hex.replace(/[^0-9a-f]/gi, '').toLowerCase()}`;
    if (!this.defKeys.has(id)) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      this.defs.push(
        `<filter id="${id}" color-interpolation-filters="sRGB">` +
        `<feColorMatrix type="matrix" values="${r} 0 0 0 0  ${g} 0 0 0 0  ${b} 0 0 0 0  0 0 0 1 0"/></filter>`
      );
      this.defKeys.add(id);
    }
    return id;
  }

  tilePattern(src, size, opacity) {
    const id = `p${[...`${src}${size}${opacity}`].reduce((a, c) => (a * 33 + c.charCodeAt(0)) % 1e9, 7).toString(36)}`;
    if (!this.defKeys.has(id)) {
      this.defs.push(
        `<pattern id="${id}" width="${size}" height="${size}" patternUnits="userSpaceOnUse">` +
        `<image href="${esc(src)}" width="${size}" height="${size}" opacity="${opacity}"/></pattern>`
      );
      this.defKeys.add(id);
    }
    return id;
  }

  linearGradient(stops, angle = 90) {
    const key = `g${[...JSON.stringify(stops) + angle].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 1e9, 11).toString(36)}`;
    if (!this.defKeys.has(key)) {
      const rad = (angle * Math.PI) / 180;
      const x2 = (0.5 + Math.cos(rad) / 2).toFixed(4), y2 = (0.5 + Math.sin(rad) / 2).toFixed(4);
      const x1 = (0.5 - Math.cos(rad) / 2).toFixed(4), y1 = (0.5 - Math.sin(rad) / 2).toFixed(4);
      this.defs.push(
        `<linearGradient id="${key}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">` +
        stops.map((s) => `<stop offset="${s.at}" stop-color="${esc(s.color)}" stop-opacity="${s.opacity ?? 1}"/>`).join('') +
        `</linearGradient>`
      );
      this.defKeys.add(key);
    }
    return key;
  }

  paint(value, scope) {
    const v = resolve(value, scope);
    if (v && typeof v === 'object') {
      if (v.gradient) return `url(#${this.linearGradient(v.gradient, v.angle ?? 90)})`;
      if (v.tile) return `url(#${this.tilePattern(v.tile, v.size ?? 120, v.opacity ?? 1)})`;
    }
    return v;
  }

  /** Emit pre-flattened planner nodes (each carries its own scope). */
  emitNodes(nodes, out = this.body) {
    for (const n of nodes) {
      const fn = this[`l_${n.layer.type}`];
      if (fn) fn.call(this, n.layer, n.scope, out);
    }
    return out;
  }

  emit(layers, scope, out = this.body) {
    for (const layer of layers || []) {
      if (!when(layer.when, scope)) continue;
      this[`l_${layer.type}`]
        ? this[`l_${layer.type}`](layer, scope, out)
        : out.push(`<!-- unknown layer ${esc(layer.type)} -->`);
    }
    return out;
  }

  // ---- layer renderers ----------------------------------------------------
  l_rect(l, s, out) {
    out.push(`<rect ${attr({
      x: num(l.x, s), y: num(l.y, s), width: num(l.w, s), height: num(l.h, s),
      rx: l.rx !== undefined ? num(l.rx, s) : undefined,
      fill: this.paint(l.fill ?? 'none', s), 'fill-opacity': l.opacity !== undefined ? num(l.opacity, s, 1) : undefined,
      stroke: l.stroke ? resolve(l.stroke, s) : undefined,
      'stroke-width': l.strokeWidth ? num(l.strokeWidth, s) : undefined,
      transform: l.transform ? resolve(l.transform, s) : undefined,
    })}/>`);
  }

  l_ellipse(l, s, out) {
    out.push(`<ellipse ${attr({
      cx: num(l.cx, s), cy: num(l.cy, s), rx: num(l.rx, s), ry: num(l.ry ?? l.rx, s),
      fill: this.paint(l.fill ?? 'none', s), 'fill-opacity': l.opacity !== undefined ? num(l.opacity, s, 1) : undefined,
      stroke: l.stroke ? resolve(l.stroke, s) : undefined,
      'stroke-width': l.strokeWidth ? num(l.strokeWidth, s) : undefined,
      transform: l.transform ? resolve(l.transform, s) : undefined,
    })}/>`);
  }

  l_path(l, s, out) {
    out.push(`<path ${attr({
      d: resolve(l.d, s), fill: this.paint(l.fill ?? 'none', s),
      'fill-opacity': l.opacity !== undefined ? num(l.opacity, s, 1) : undefined,
      stroke: l.stroke ? resolve(l.stroke, s) : undefined,
      'stroke-width': l.strokeWidth ? num(l.strokeWidth, s) : undefined,
      'stroke-linecap': l.cap, 'stroke-linejoin': l.join,
      transform: l.transform ? resolve(l.transform, s) : undefined,
    })}/>`);
  }

  l_pattern(l, s, out) {
    const id = this.tilePattern(resolve(l.src, s), num(l.size, s, 120), num(l.opacity, s, 1));
    out.push(`<rect ${attr({
      x: num(l.x, s), y: num(l.y, s),
      width: num(l.w ?? '{{canvas.w}}', s), height: num(l.h ?? '{{canvas.h}}', s),
      fill: `url(#${id})`, transform: l.transform ? resolve(l.transform, s) : undefined,
    })}/>`);
  }

  l_image(l, s, out) {
    const src = resolve(l.src, s);
    const tint = l.tint ? resolve(l.tint, s) : null;
    out.push(`<image ${attr({
      href: src, x: num(l.x, s), y: num(l.y, s), width: num(l.w, s), height: num(l.h, s),
      preserveAspectRatio: l.fitMode || 'xMidYMid meet',
      opacity: l.opacity !== undefined ? num(l.opacity, s, 1) : undefined,
      filter: tint && tint !== 'none' ? `url(#${this.tintFilter(tint)})` : undefined,
      transform: l.transform ? resolve(l.transform, s) : undefined,
    })}/>`);
  }

  l_text(l, s, out) {
    let text = resolve(l.text, s);
    if (text === undefined || text === null) text = '';
    text = String(text).replace(/\s+/g, ' ').trim();
    if (!text && !l.keepEmpty) return;

    const requested = resolve(l.font, s) || 'default';
    const chosen = this.fonts.pick(requested, text);
    const fontId = chosen.id;
    const family = chosen.font ? chosen.font.family : 'sans-serif';
    if (chosen.fellBack) this.warnings.push(`font "${chosen.from}" lacks glyphs for "${text.slice(0, 24)}" — used "${fontId}"`);
    else if (chosen.uncovered) this.warnings.push(`no registered font covers "${text.slice(0, 24)}"`);
    let size = num(l.size, s, 48);
    const maxWidth = l.fit ? num(l.fit.maxWidth, s, 0) : 0;
    const upper = l.transformText === 'upper';
    if (upper) text = text.toUpperCase();

    let lines = [text];
    if (l.wrap) {
      const w = num(l.wrap.maxWidth ?? l.fit?.maxWidth, s, 0);
      lines = this.fonts.wrap(fontId, text, size, w, num(l.wrap.maxLines, s, 2));
      if (lines.length > 1) {
        // shrink so the widest wrapped line fits too
        const widest = Math.max(...lines.map((ln) => this.fonts.measure(fontId, ln, size)));
        if (w && widest > w) size = Math.max(num(l.fit?.minSize, s, 10), (w / widest) * size);
      }
    }
    if (maxWidth) {
      const widest = Math.max(...lines.map((ln) => this.fonts.measure(fontId, ln, size)));
      if (widest > maxWidth) size = Math.max(num(l.fit.minSize, s, 10), (maxWidth / widest) * size);
    }

    const m = this.fonts.metrics(fontId, size);
    const lineH = num(l.lineHeight, s, 0) || size * 1.1;
    const anchor = { left: 'start', center: 'middle', right: 'end' }[l.align || 'center'];
    const x = num(l.x, s);
    let y = num(l.y, s);
    if (l.baseline === 'middle') y += m.capHeight / 2 - ((lines.length - 1) * lineH) / 2;
    else if (l.baseline === 'top') y += m.ascent;

    const common = attr({
      x, 'font-family': family, 'font-size': +size.toFixed(2),
      'font-weight': l.weight || undefined, 'font-style': l.italic ? 'italic' : undefined,
      fill: this.paint(l.fill ?? '#000', s), 'text-anchor': anchor,
      'letter-spacing': l.letterSpacing ? num(l.letterSpacing, s) : undefined,
      stroke: l.stroke ? resolve(l.stroke, s) : undefined,
      'stroke-width': l.strokeWidth ? num(l.strokeWidth, s) : undefined,
      'paint-order': l.stroke ? 'stroke fill' : undefined,
      opacity: l.opacity !== undefined ? num(l.opacity, s, 1) : undefined,
      transform: l.transform ? resolve(l.transform, s) : undefined,
    });
    out.push(`<text ${common}>${lines
      .map((ln, i) => `<tspan x="${x.toFixed(2)}" y="${(y + i * lineH).toFixed(2)}">${esc(ln)}</tspan>`)
      .join('')}</text>`);
  }

  l_group(l, s, out) {
    const inner = this.emit(l.children, s, []);
    const a = attr({
      opacity: l.opacity !== undefined ? num(l.opacity, s, 1) : undefined,
      transform: l.transform ? resolve(l.transform, s) : undefined,
    });
    out.push(a ? `<g ${a}>${inner.join('')}</g>` : `<g>${inner.join('')}</g>`);
  }

  /** Lay a child template out once per item of a collection (family members, pets, ...). */
  l_repeat(l, s, out) {
    const items = resolve(l.over, s);
    if (!Array.isArray(items) || !items.length) return;
    const lay = l.layout || {};
    const n = items.length;
    const itemW = num(lay.itemW, s, 200);
    const itemH = num(lay.itemH, s, itemW);
    const maxWidth = num(lay.maxWidth, s, 0);
    let gap = lay.gap === 'auto' ? itemW * 0.12 : num(lay.gap, s, 0);
    let w = itemW, h = itemH;
    if (maxWidth && n * w + (n - 1) * gap > maxWidth) {
      const k = maxWidth / (n * w + (n - 1) * gap);          // shrink to fit the print area
      w *= k; h *= k; gap *= k;
    }
    const total = n * w + (n - 1) * gap;
    const centerX = num(lay.centerX, s, 0), baselineY = num(lay.baselineY, s, 0);
    const startX = centerX - total / 2;
    const as = l.as || 'slot';

    items.forEach((item, idx) => {
      const x = startX + idx * (w + gap);
      const stagger = lay.stagger ? num(lay.stagger, s, 0) * (idx % 2 === 0 ? -1 : 1) : 0;
      const slot = {
        ...item, idx, i: idx + 1, n,
        x, y: baselineY - h + stagger, w, h,
        cx: x + w / 2, cy: baselineY - h / 2 + stagger, bottom: baselineY + stagger,
      };
      this.emit(l.children, { ...s, [as]: slot }, out);
    });
  }

  build(scope, canvas) {
    this.emit(this.design.layers, scope);
    const bg = this.design.canvas.bg ? this.paint(this.design.canvas.bg, scope) : null;
    return '<?xml version="1.0" encoding="UTF-8"?>' +
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `width="${canvas.w}" height="${canvas.h}" viewBox="0 0 ${this.design.canvas.w} ${this.design.canvas.h}">` +
      (this.defs.length ? `<defs>${this.defs.join('')}</defs>` : '') +
      (bg && bg !== 'none' ? `<rect width="${this.design.canvas.w}" height="${this.design.canvas.h}" fill="${esc(bg)}"/>` : '') +
      this.body.join('') + '</svg>';
  }
}

/** Build the SVG for a design at a given raster size (whole design in one pass). */
function buildSvg(design, scope, fonts, outW, outH) {
  return new SvgBuilder(design, fonts).build(scope, { w: Math.round(outW), h: Math.round(outH) });
}

/** Build a transparent SVG containing only one band's vector nodes. */
function buildBandSvg(design, nodes, fonts, outW, outH, warningSink) {
  const b = new SvgBuilder(design, fonts);
  b.emitNodes(nodes);
  if (warningSink) for (const w of b.warnings) if (!warningSink.includes(w)) warningSink.push(w);
  return '<?xml version="1.0" encoding="UTF-8"?>' +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${Math.round(outW)}" height="${Math.round(outH)}" viewBox="0 0 ${design.canvas.w} ${design.canvas.h}">` +
    (b.defs.length ? `<defs>${b.defs.join('')}</defs>` : '') +
    b.body.join('') + '</svg>';
}

module.exports = { buildSvg, buildBandSvg, SvgBuilder, esc };
