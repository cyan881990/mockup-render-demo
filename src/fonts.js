'use strict';
/**
 * Font registry.
 *  - owns the list of fonts the designs may use (managed server-side)
 *  - measures text exactly (fontkit) so artwork can auto-fit long names
 *  - hands resvg an explicit font file list so it never scans system fonts
 */
const fs = require('fs');
const path = require('path');
const fontkit = require('fontkit');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');

class FontRegistry {
  constructor() {
    this.byId = new Map();   // id -> { id, family, file, weight, style, label, kit }
    this.files = [];         // absolute paths handed to resvg
  }

  load(defs) {
    this.byId.clear();
    this.files = [];
    this._coverage = new Map();
    this.fallbackOrder = defs.filter((d) => d.fallbackPool !== false).map((d) => d.id);
    for (const def of defs) {
      const file = path.isAbsolute(def.file) ? def.file : path.join(FONT_DIR, def.file);
      if (!fs.existsSync(file)) { console.warn(`[fonts] missing file for "${def.id}": ${file}`); continue; }
      let kit = null;
      try { kit = fontkit.openSync(file); } catch (e) { console.warn(`[fonts] unreadable ${def.id}: ${e.message}`); }
      const family = def.family || (kit && kit.familyName) || def.id;
      this.byId.set(def.id, {
        id: def.id,
        label: def.label || family,
        family,
        file,
        weight: def.weight || (kit && kit.OS2 && kit.OS2.usWeightClass) || 400,
        style: def.style || 'normal',
        fallback: def.fallback || null,
        kit,
        bytes: fs.statSync(file).size,
      });
      this.files.push(file);
    }
    return this;
  }

  get(id) { return this.byId.get(id) || this.byId.get('default') || this.byId.values().next().value; }

  /** Does this font have a glyph for every character in `text`? (cached per font+string) */
  covers(id, text) {
    const f = this.get(id);
    if (!f || !f.kit || !text) return true;
    const key = `${id}\u0000${text}`;
    const memo = this._coverage || (this._coverage = new Map());
    if (memo.has(key)) return memo.get(key);
    let ok = true;
    for (const ch of String(text)) {
      const cp = ch.codePointAt(0);
      if (cp === 32 || cp === 10) continue;
      if (typeof f.kit.hasGlyphForCodePoint === 'function') {
        if (!f.kit.hasGlyphForCodePoint(cp)) { ok = false; break; }
      } else if (f.kit.glyphForCodePoint(cp).id === 0) { ok = false; break; }
    }
    if (memo.size > 5000) memo.clear();
    memo.set(key, ok);
    return ok;
  }

  /**
   * Choose the font actually used for a string: the requested one when it has the glyphs,
   * otherwise the first font in its fallback chain that does. Stops a Vietnamese name from
   * silently losing its diacritics behind a Latin-only display face.
   */
  pick(id, text) {
    const first = this.get(id);
    if (!text || this.covers(first?.id ?? id, text)) return { font: first, id: first?.id ?? id, fellBack: false };
    const chain = [...(first?.fallback || []), ...this.fallbackOrder];
    for (const next of chain) {
      if (next === first?.id) continue;
      if (this.byId.has(next) && this.covers(next, text)) {
        return { font: this.byId.get(next), id: next, fellBack: true, from: first?.id };
      }
    }
    return { font: first, id: first?.id ?? id, fellBack: false, uncovered: true };
  }
  list() {
    return [...this.byId.values()].map(({ kit, file, ...rest }) => ({ ...rest, file: path.basename(file) }));
  }

  /**
   * Width of `text` in px at `size`, using real glyph advances + kerning.
   * `tracking` là letter-spacing (px) — phải cộng vào, nếu không dòng chữ giãn
   * chữ sẽ rộng hơn khung cho phép và tràn ra ngoài mặt in.
   */
  measure(id, text, size, tracking = 0) {
    const f = this.get(id);
    if (!text) return 0;
    const n = [...String(text)].length;
    const extra = tracking ? tracking * Math.max(0, n - 1) : 0;
    if (!f || !f.kit) return n * size * 0.55 + extra;
    try {
      const run = f.kit.layout(String(text));
      return (run.advanceWidth / f.kit.unitsPerEm) * size + extra;
    } catch {
      return n * size * 0.55 + extra;
    }
  }

  /** Cap height / ascent info for vertical centring. */
  metrics(id, size) {
    const f = this.get(id);
    if (!f || !f.kit) return { ascent: size * 0.8, descent: size * 0.2, capHeight: size * 0.7 };
    const u = f.kit.unitsPerEm;
    return {
      ascent: (f.kit.ascent / u) * size,
      descent: (Math.abs(f.kit.descent) / u) * size,
      capHeight: ((f.kit.capHeight || f.kit.ascent * 0.72) / u) * size,
      lineGap: ((f.kit.lineGap || 0) / u) * size,
    };
  }

  /** Largest size <= maxSize that keeps `text` within maxWidth (and >= minSize). */
  fitSize(id, text, maxSize, maxWidth, minSize = 8, tracking = 0) {
    if (!maxWidth) return maxSize;
    const w = this.measure(id, text, maxSize, tracking);
    if (w <= maxWidth || w === 0) return maxSize;
    return Math.max(minSize, Math.floor((maxWidth / w) * maxSize * 100) / 100);
  }

  /** Greedy word wrap to `maxWidth`, honouring an explicit max line count. */
  wrap(id, text, size, maxWidth, maxLines = 4) {
    const words = String(text).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const lines = [];
    let cur = words[0];
    for (let i = 1; i < words.length; i++) {
      const next = `${cur} ${words[i]}`;
      if (this.measure(id, next, size) <= maxWidth || lines.length + 1 >= maxLines) cur = next;
      else { lines.push(cur); cur = words[i]; }
    }
    lines.push(cur);
    return lines.slice(0, maxLines);
  }
}

module.exports = { FontRegistry, FONT_DIR };
