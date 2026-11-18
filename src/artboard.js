'use strict';
/**
 * Executes a layer plan into a premultiplied RGBA raster.
 * Raster nodes come from the part cache (no PNG decode); vector bands go through resvg
 * with the font list only — never `resourcesDir`, which costs ~60ms per construction.
 */
const { Resvg } = require('@resvg/resvg-js');
const { plan } = require('./plan');
const { buildBandSvg } = require('./artwork');
const { canvas, blit, tile, overlayBand } = require('./raster');
const { resolve } = require('./expr');

async function renderArtboard(design, scope, fonts, parts, W, H, stats = {}) {
  const k = W / design.canvas.w;
  const p = plan(design, scope, fonts);
  stats.nodes = p.nodes.length;
  stats.bands = p.bands.length;
  stats.vectorPasses = p.bands.filter((b) => b.kind === 'vector').length;
  stats.warnings = [];

  let bg = design.canvas.bg ? resolve(design.canvas.bg, scope) : null;
  if (bg && typeof bg === 'object') bg = null;
  const out = canvas(W, H, bg);

  for (const band of p.bands) {
    if (band.kind === 'vector') {
      const svg = buildBandSvg(design, band.nodes, fonts, W, H, stats.warnings);
      const img = new Resvg(svg, {
        font: { fontFiles: fonts.files, loadSystemFonts: false, defaultFontFamily: design.defaultFontFamily || 'Outfit' },
        fitTo: { mode: 'width', value: Math.round(W) },
        logLevel: 'error',
      }).render();
      overlayBand(out, img.pixels);
      continue;
    }
    // raster nodes are independent -> fetch them in parallel, then blit in order
    const sprites = await Promise.all(band.nodes.map((n) => n.kind === 'tile'
      ? parts.get(n.src, n.size * k, n.size * k, n.tint, { fit: 'fill' })
      : parts.get(n.src, n.w * k, n.h * k, n.tint, { fit: n.fitMode === 'none' ? 'fill' : 'contain', flip: n.flip })));
    band.nodes.forEach((n, i) => {
      const s = sprites[i];
      if (n.kind === 'tile') {
        tile(out, W, H, s.data, s.w, s.h,
          { x: Math.round(n.rect.x * k), y: Math.round(n.rect.y * k), w: Math.round(n.rect.w * k), h: Math.round(n.rect.h * k) },
          n.opacity);
      } else {
        blit(out, W, H, s.data, s.w, s.h, n.x * k, n.y * k, n.opacity);
      }
    });
  }
  return { data: out, w: W, h: H };
}

module.exports = { renderArtboard };
