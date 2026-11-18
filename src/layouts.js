'use strict';
/**
 * Khuôn bố cục: nhận khổ canvas + gói hoạ tiết + danh sách option đã chuẩn hoá,
 * trả về mảng layer của thiết kế. Hoạ tiết đổi được, bố cục giữ nguyên nhịp,
 * nên mọi SKU sinh ra từ cùng một khuôn vẫn khác nhau nhưng không vỡ layout.
 */

const txt = (o) => ({ type: 'text', ...o });

/** Hàng vật phẩm theo số thành viên (tất, mũ len, hộp quà…). */
function itemRow(pack, { centerX, baselineY, itemW, maxWidth, stagger = 10, labelSize = 52, labelKey = 'mname' }) {
  const itemH = Math.round(itemW / pack.item.aspect);
  const children = [
    { type: 'image', src: pack.item.body, x: '{{slot.x}}', y: '{{slot.y}}', w: '{{slot.w}}', h: '{{slot.h}}', tint: '{{slot.color.hex}}' },
  ];
  if (pack.item.cuff) {
    children.push({ type: 'image', src: pack.item.cuff, x: '{{slot.x}}', y: '{{slot.y}}', w: '{{slot.w}}', h: '{{slot.h}}' });
  }
  if (labelKey) {
    children.push(txt({
      when: '{{slot.label}} != ', text: '{{slot.label}}', font: 'script', size: labelSize,
      x: `{{slot.x}} + {{slot.w}} * 0.52`, y: `{{slot.y}} + {{slot.h}} * ${pack.item.labelAt ?? 0.27}`,
      align: 'center', fill: '#4a372c', opacity: 0.95,
      fit: { maxWidth: '{{slot.w}} * 0.62', minSize: 16 },
    }));
  }
  return {
    type: 'repeat', over: '{{members}}', as: 'slot',
    layout: { mode: 'row', itemW, itemH, gap: 'auto', maxWidth, centerX, baselineY, stagger },
    children,
  };
}

/**
 * "banner" — khổ ngang dài (thảm chạy, banner, bảng tên):
 * viền lá trên suốt chiều ngang, hàng vật phẩm một bên, khối chữ bên kia.
 */
function banner({ canvas, pack, ink, accent, bg, has }) {
  const { w, h } = canvas;
  const itemW = Math.round(h * 0.27);
  const L = [];
  L.push({ type: 'pattern', src: 'snow.png', size: Math.round(h * 0.26), opacity: 0.1, w, h });
  L.push({ type: 'rect', x: 40, y: 40, w: w - 80, h: h - 80, rx: 26, fill: 'none', stroke: accent, strokeWidth: 6, opacity: 0.75 });
  L.push({ type: 'rect', x: 60, y: 60, w: w - 120, h: h - 120, rx: 18, fill: 'none', stroke: accent, strokeWidth: 2, opacity: 0.45 });

  if (pack.corner) {
    const cw = Math.round(h * 0.31);
    L.push({ type: 'image', src: pack.corner.src, x: w - cw - 20, y: h - cw - 40, w: cw, h: Math.round(cw / pack.corner.aspect), flip: 'x', opacity: 0.97 });
  }
  L.push(itemRow(pack, {
    centerX: Math.round(w * 0.29), baselineY: Math.round(h * 0.93),
    itemW, maxWidth: Math.round(w * 0.43), stagger: 11,
    labelSize: Math.round(itemW * 0.26), labelKey: has.mname ? 'mname' : null,
  }));
  if (has.pet) {
    const pw = Math.round(h * 0.29);
    L.push({ type: 'image', when: '{{opt.pet.value}} != none', src: '{{opt.pet.art}}.webp',
      x: Math.round(w * 0.43), y: Math.round(h * 0.93) - Math.round(pw * 1.62), w: pw, h: Math.round(pw * 1.62) });
  }
  const hw = Math.round(w * 1.037);
  L.push({ type: 'image', src: pack.header.src, x: Math.round((w - hw) / 2), y: -Math.round(h * 0.12), w: hw, h: Math.round(hw / pack.header.aspect) });

  const textX = Math.round(w * 0.73);
  if (has.headline) {
    L.push(txt({ text: '{{opt.headline}}', font: 'slab', size: Math.round(h * 0.07), x: textX, y: Math.round(h * 0.565),
      align: 'center', fill: accent, letterSpacing: 13, transformText: 'upper', fit: { maxWidth: Math.round(w * 0.36), minSize: 26 } }));
  }
  L.push(txt({ text: '{{opt.name}}', font: 'script', size: Math.round(h * 0.2), x: textX, y: Math.round(h * 0.77),
    align: 'center', fill: ink, fit: { maxWidth: Math.round(w * 0.375), minSize: 60 } }));
  if (has.year) {
    L.push(txt({ when: '{{opt.year}} != ', text: '{{opt.year}}', font: 'heading', size: Math.round(h * 0.048),
      x: textX, y: Math.round(h * 0.875), align: 'center', fill: accent, letterSpacing: 10, opacity: 0.9 }));
  }
  return L;
}

/**
 * "stack" — khổ đứng hoặc gần vuông (áo, cốc, gối, khung ảnh):
 * vòng lá cong trên đỉnh, dòng chữ lớn, hàng vật phẩm, tên gia đình dưới cùng.
 */
function stack({ canvas, pack, ink, accent, bg, has }) {
  const { w, h } = canvas;
  const tall = h / w >= 1.15;                      // áo, poster: rộng chỗ hơn cốc
  const arc = pack.headerArc || pack.header;
  const aw = Math.round(w * (tall ? 0.78 : 0.62));
  const itemW = Math.round(w * (tall ? 0.165 : 0.14));
  const L = [];
  L.push({ type: 'image', src: arc.src, x: Math.round((w - aw) / 2), y: Math.round(h * 0.03),
    w: aw, h: Math.round(aw / arc.aspect) });
  if (has.headline) {
    L.push(txt({ text: '{{opt.headline}}', font: 'slab', size: Math.round(w * 0.062),
      x: Math.round(w / 2), y: Math.round(h * (tall ? 0.37 : 0.40)), align: 'center', fill: ink,
      letterSpacing: 9, transformText: 'upper', fit: { maxWidth: Math.round(w * 0.86), minSize: 26 } }));
  }
  L.push(itemRow(pack, {
    centerX: Math.round(w / 2), baselineY: Math.round(h * (tall ? 0.80 : 0.845)), itemW,
    maxWidth: Math.round(w * 0.88), stagger: 12,
    labelSize: Math.round(itemW * 0.26), labelKey: has.mname ? 'mname' : null,
  }));
  L.push(txt({ text: '{{opt.name}}', font: 'script', size: Math.round(w * (tall ? 0.12 : 0.105)),
    x: Math.round(w / 2), y: Math.round(h * (tall ? 0.90 : 0.945)), align: 'center', fill: ink,
    fit: { maxWidth: Math.round(w * 0.88), minSize: 54 } }));
  if (has.year && tall) {
    L.push(txt({ when: '{{opt.year}} != ', text: '{{opt.year}}', font: 'heading', size: Math.round(w * 0.03),
      x: Math.round(w / 2), y: Math.round(h * 0.95), align: 'center', fill: accent, letterSpacing: 8, opacity: 0.9 }));
  }
  return L;
}

const LAYOUTS = { banner, stack };

/** Khổ nào thì hợp khuôn nào. */
function pickLayout(canvas) { return canvas.w / canvas.h >= 2 ? 'banner' : 'stack'; }

module.exports = { LAYOUTS, pickLayout, itemRow };
