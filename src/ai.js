'use strict';
/**
 * Nhờ model ngôn ngữ nghĩ phần "khác đi": tiêu đề, dòng chữ, bảng màu, chọn khuôn.
 * Cấu trúc option và bố cục vẫn do mình quyết định, nên model có trả về gì lạ
 * thì cũng không làm vỡ template — mọi trường đều được kiểm và có giá trị thay thế.
 *
 * Cần OPENAI_API_KEY. Không có key thì dùng biến thể tiền định sẵn, vẫn chạy.
 */
const PRESETS = [
  { suffix: 'Cosy Nights', headline: 'Merry & Bright', accentName: 'gold' },
  { suffix: 'Family Christmas', headline: 'Gather Together', accentName: 'cream' },
  { suffix: 'Holiday Home', headline: 'Joy To Our Home', accentName: 'gold' },
  { suffix: 'Winter Warmth', headline: 'Warmest Wishes', accentName: 'ice' },
];

const hex = (s) => (/^#[0-9a-f]{6}$/i.test(String(s)) ? String(s) : null);

/** Lọc đề xuất của model về đúng khuôn, bỏ mọi trường không hợp lệ. */
function sanitize(raw, pack) {
  const out = {};
  if (raw && typeof raw === 'object') {
    if (typeof raw.title === 'string' && raw.title.trim()) out.title = raw.title.trim().slice(0, 70);
    if (typeof raw.headline === 'string' && raw.headline.trim()) out.headline = raw.headline.trim().slice(0, 26);
    if (['banner', 'stack'].includes(raw.layout)) out.layout = raw.layout;
    if (Array.isArray(raw.backgrounds)) {
      const bgs = raw.backgrounds.map((b) => ({
        value: String(b?.value || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14),
        label: String(b?.label || '').slice(0, 24) || 'Colour',
        hex: hex(b?.hex), ink: hex(b?.ink), accent: hex(b?.accent),
      })).filter((b) => b.value && b.hex && b.ink && b.accent);
      if (bgs.length >= 3) out.backgrounds = bgs.slice(0, 8);
    }
  }
  return out;
}

async function propose({ scan, pack, productType, seed = 0 }) {
  const key = process.env.OPENAI_API_KEY;
  const preset = PRESETS[seed % PRESETS.length];
  const fallback = {
    title: `${scan?.product?.type || productType} — ${preset.suffix}`,
    headline: preset.headline,
  };
  if (!key) return { ...fallback, source: 'preset' };

  const prompt = [
    'Bạn đặt tên và chọn bảng màu cho một sản phẩm in theo yêu cầu.',
    `Loại sản phẩm: ${productType}.`,
    `Các tuỳ chọn khách sẽ điền: ${(scan?.personalization || []).map((o) => o.label).join(', ') || 'tên gia đình, số thành viên'}.`,
    'Trả về JSON đúng khuôn: {"title": string, "headline": string (<=26 ký tự, in hoa được),',
    '"layout": "banner"|"stack", "backgrounds": [{"value","label","hex","ink","accent"}] (4-6 màu nền,',
    'hex là mã #rrggbb; ink là màu chữ tương phản tốt trên nền đó; accent là màu nhấn ấm).',
    'Không mô tả, không giải thích, không nhắc tên thương hiệu nào.',
  ].join(' ');

  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5.2',
        input: prompt,
        text: { format: { type: 'json_object' } },
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
    const j = await res.json();
    const text = j.output_text
      || j.output?.flatMap((o) => (o.content || []).map((c) => c.text)).filter(Boolean).join('')
      || '';
    const clean = sanitize(JSON.parse(text), pack);
    return { ...fallback, ...clean, source: 'openai' };
  } catch (e) {
    return { ...fallback, source: 'preset', error: e.message };
  }
}

module.exports = { propose, sanitize, PRESETS };
