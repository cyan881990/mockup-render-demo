'use strict';
/* Product page: options -> URL -> live mockup render. The URL is the single source of truth,
   so any state the shopper builds here is shareable and is exactly what the renderer receives. */

const $ = (s) => document.querySelector(s);
const el = (t, a = {}, k = []) => {
  const n = document.createElement(t);
  for (const [key, v] of Object.entries(a)) {
    if (key === 'class') n.className = v;
    else if (key === 'text') n.textContent = v;
    else if (key === 'html') n.innerHTML = v;
    else if (key.startsWith('on')) n.addEventListener(key.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(key, v);
  }
  for (const c of [].concat(k)) n.append(c);
  return n;
};

/* Nicer Vietnamese labels than the raw schema keys. */
const LABEL = {
  background: 'Màu nền', member: 'Số thành viên', name: 'Tên gia đình',
  headline: 'Dòng chữ trên', year: 'Năm', soc: 'Màu tất', mname: 'Tên trên tất',
  pet: 'Thú cưng', ink: 'Màu mực',
};
const SWATCH_VI = {
  red: 'Đỏ', green: 'Xanh lá', navy: 'Xanh navy', cream: 'Kem', charcoal: 'Than chì',
  burgundy: 'Đỏ mận', blue: 'Xanh dương', gold: 'Vàng đồng', pink: 'Hồng', plum: 'Mận',
  teal: 'Xanh ngọc', black: 'Đen', none: 'Không có', dog: 'Chó', cat: 'Mèo',
};
const REQUIRED = new Set(['name']);
const VARIANTS = [
  { id: 'single', name: 'Chỉ thảm chạy', price: 39.95, was: 69.95 },
  { id: 'set2', name: 'Bộ 2 món', price: 59.95, was: 99.95 },
];

const state = { product: null, schema: null, mockup: null, opt: {}, qty: 1, variant: 'single' };
let heroSeq = 0;

/* ---------------- URL <-> state ---------------- */
function readUrl() {
  const q = new URLSearchParams(location.search);
  const out = { product: q.get('product'), mockup: q.get('mockup'), opt: {} };
  for (const [k, v] of q) if (!['product', 'mockup', 'qty', 'variant'].includes(k)) out.opt[k] = v;
  if (q.get('qty')) state.qty = Math.max(1, Math.min(99, +q.get('qty') || 1));
  if (q.get('variant')) state.variant = q.get('variant');
  return out;
}
function writeUrl() {
  const q = new URLSearchParams();
  q.set('product', state.product);
  if (state.mockup) q.set('mockup', state.mockup);
  for (const [k, v] of Object.entries(state.opt)) if (v !== '' && v != null) q.set(k, v);
  if (state.qty > 1) q.set('qty', state.qty);
  if (state.variant !== 'single') q.set('variant', state.variant);
  history.replaceState(null, '', `${location.pathname}?${q}`);
}

/** The exact URL the render server is asked for. */
function renderUrl(w, mockup, format) {
  const q = new URLSearchParams();
  q.set('product', state.product);
  q.set('mockup', mockup || state.mockup);
  for (const [k, v] of Object.entries(state.opt)) if (v !== '' && v != null) q.set(k, v);
  q.set('w', w);
  if (format) q.set('format', format);
  return `/render?${q}`;
}

/* ---------------- preview ---------------- */
let timer = null;
function schedule() { clearTimeout(timer); timer = setTimeout(paint, 110); }

async function paint() {
  writeUrl();
  const url = renderUrl(1000);
  $('#url').textContent = location.origin + url;
  $('#openimg').href = url;
  $('#openart').href = renderUrl(1600, null, 'png').replace('/render?', `/artwork/${state.product}?`);

  const seq = ++heroSeq;
  const stage = $('#stage');
  stage.classList.add('busy');
  const t0 = performance.now();
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    if (seq !== heroSeq) return;                       // a newer choice won
    const old = $('#hero').src;
    $('#hero').src = URL.createObjectURL(blob);
    if (old.startsWith('blob:')) URL.revokeObjectURL(old);
    const tier = res.headers.get('x-render-tier');
    const ms = res.headers.get('x-render-ms');
    $('#stamp').textContent = tier === 'render'
      ? `dựng mới ${Math.round(performance.now() - t0)}ms`
      : `từ cache ${ms}ms · ${Math.round(performance.now() - t0)}ms tải`;
  } catch {
    $('#stamp').textContent = 'không tải được ảnh';
  } finally {
    if (seq === heroSeq) stage.classList.remove('busy');
  }
  paintThumbs();
}

function paintThumbs() {
  const box = $('#thumbs');
  box.innerHTML = '';
  for (const m of state.schema.mockups) {
    box.append(el('button', {
      type: 'button', class: m.id === state.mockup ? 'on' : '', title: m.name,
      onclick: () => { state.mockup = m.id; schedule(); },
    }, [el('img', { src: renderUrl(260, m.id), alt: m.name, loading: 'lazy' })]));
  }
  $('#galnote').textContent = `${state.schema.mockups.length} góc chụp · ảnh dựng lại theo từng lựa chọn của bạn`;
}

/* ---------------- option controls ---------------- */
function set(key, val) { state.opt[key] = val; schedule(); }

function swatchRow(key, values, current, size) {
  const row = el('div', { class: 'swatches' });
  for (const v of values) {
    const b = el('button', {
      type: 'button',
      class: `sw${String(v.value) === String(current) ? ' on' : ''}${v.value === 'none' ? ' none' : ''}`,
      style: v.value === 'none' ? '' : `background:${v.hex}`,
      title: SWATCH_VI[v.value] || v.label || v.value,
      'aria-label': SWATCH_VI[v.value] || v.label || v.value,
      onclick: () => {
        row.querySelectorAll('.sw').forEach((s) => s.classList.remove('on'));
        b.classList.add('on');
        set(key, v.value);
        const lab = row.parentElement.querySelector('.pick');
        if (lab) lab.textContent = SWATCH_VI[v.value] || v.label || v.value;
      },
    });
    if (size) { b.style.width = b.style.height = size; }
    row.append(b);
  }
  return row;
}

function legendFor(o, extra) {
  const txt = LABEL[o.key] || o.label || o.key;
  const bits = [el('span', { html: REQUIRED.has(o.key) ? `${txt} <span class="req">*</span>` : txt })];
  bits.push(el('span', { class: 'pick', text: extra || '' }));
  return el('legend', {}, bits);
}

function buildOptions() {
  const form = $('#opts');
  form.innerHTML = '';
  const s = state.schema;

  /* Style / variant — a storefront concern, not a render option */
  const vfs = el('fieldset');
  vfs.append(el('legend', {}, [el('span', { text: 'Kiểu' })]));
  const vrow = el('div', { class: 'variants' });
  for (const v of VARIANTS) {
    const b = el('button', {
      type: 'button', class: state.variant === v.id ? 'on' : '',
      onclick: () => { state.variant = v.id; buildOptions(); priceOut(); writeUrl(); },
    }, [el('span', { class: 'vn', text: v.name }), el('span', { class: 'vp', text: `$${v.price.toFixed(2)}` })]);
    vrow.append(b);
  }
  vfs.append(vrow); form.append(vfs);

  const simple = s.options.filter((o) => !o.indexed);
  const indexed = s.options.filter((o) => o.indexed);

  for (const o of simple) {
    const fs = el('fieldset');
    if (o.type === 'swatch' || o.type === 'enum') {
      const cur = state.opt[o.key];
      const hit = o.values.find((v) => String(v.value) === String(cur));
      fs.append(legendFor(o, SWATCH_VI[cur] || hit?.label || ''));
      fs.append(swatchRow(o.key, o.values, cur));
    } else if (o.type === 'range' || o.type === 'int') {
      fs.append(legendFor(o, String(state.opt[o.key] ?? o.default)));
      const row = el('div', { class: 'steps' });
      for (let i = o.min; i <= o.max; i++) {
        const b = el('button', {
          type: 'button', class: String(state.opt[o.key]) === String(i) ? 'on' : '', text: String(i),
          onclick: () => { state.opt[o.key] = i; buildOptions(); schedule(); },
        });
        row.append(b);
      }
      fs.append(row);
    } else {
      fs.append(legendFor(o));
      const wrap = el('div', { class: 'field' });
      const cnt = el('div', { class: 'cnt' });
      const inp = el('input', {
        type: 'text', value: state.opt[o.key] ?? '', maxlength: o.maxLength || 40,
        placeholder: o.default || '',
        oninput: (e) => {
          cnt.textContent = `${e.target.value.length}/${o.maxLength || 40}`;
          set(o.key, e.target.value);
          validate();
        },
      });
      cnt.textContent = `${(state.opt[o.key] ?? '').length}/${o.maxLength || 40}`;
      wrap.append(inp, cnt);
      fs.append(wrap);
    }
    form.append(fs);
  }

  /* per-member rows: one line each, name + colour together */
  if (indexed.length) {
    const count = Number(state.opt[indexed[0].indexed.by] ?? 0);
    const from = indexed[0].indexed.from ?? 1;
    const fs = el('fieldset');
    fs.append(el('legend', {}, [el('span', { text: 'Từng thành viên' }),
      el('span', { class: 'pick', text: `${count} chiếc tất` })]));
    const box = el('div', { class: 'members' });
    const textOpt = indexed.find((o) => o.type === 'text');
    const colorOpt = indexed.find((o) => o.values);
    for (let i = 0; i < count; i++) {
      const n = from + i;
      const row = el('div', { class: 'member' });
      row.append(el('div', { class: 'idx', text: String(n) }));
      if (textOpt) {
        row.append(el('input', {
          type: 'text', maxlength: textOpt.maxLength || 10, placeholder: `Tên ${n} (không bắt buộc)`,
          value: state.opt[`${textOpt.key}${n}`] ?? '',
          oninput: (e) => set(`${textOpt.key}${n}`, e.target.value),
        }));
      }
      if (colorOpt) {
        const mini = el('div', { class: 'mini' });
        mini.append(swatchRow(`${colorOpt.key}${n}`, colorOpt.values, state.opt[`${colorOpt.key}${n}`], '26px'));
        row.append(mini);
      }
      box.append(row);
    }
    fs.append(box);
    form.append(fs);
  }
}

/* ---------------- misc storefront bits ---------------- */
function priceOut() {
  const v = VARIANTS.find((x) => x.id === state.variant) || VARIANTS[0];
  $('#price').textContent = `$${(v.price * state.qty).toFixed(2)}`;
  $('#was').textContent = `$${(v.was * state.qty).toFixed(2)}`;
}
function validate() {
  const missing = [...REQUIRED].some((k) => !String(state.opt[k] ?? '').trim());
  $('#add').disabled = missing;
  $('#hint').classList.toggle('on', missing);
  return !missing;
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 2600);
}
function countdown() {
  const end = new Date(); end.setHours(23, 59, 59, 999);
  setInterval(() => {
    const d = Math.max(0, end - Date.now());
    const h = Math.floor(d / 3.6e6), m = Math.floor(d % 3.6e6 / 6e4), s = Math.floor(d % 6e4 / 1000);
    $('#count').textContent = `${h} giờ ${String(m).padStart(2, '0')} phút ${String(s).padStart(2, '0')} giây`;
  }, 1000);
  const eta = new Date(Date.now() + 9 * 864e5);
  $('#eta').textContent = `dự kiến ${eta.getDate()}/${eta.getMonth() + 1}`;
}

/* ---------------- boot ---------------- */
(async () => {
  const fromUrl = readUrl();
  const products = await (await fetch('/api/products')).json();
  state.product = fromUrl.product && products.some((p) => p.id === fromUrl.product)
    ? fromUrl.product : products[0].id;
  state.schema = await (await fetch(`/api/schema/${state.product}`)).json();

  /* seed every option from its default, then let the URL override */
  for (const o of state.schema.options) {
    if (o.indexed) {
      const max = o.indexed.max ?? 6, from = o.indexed.from ?? 1;
      for (let i = 0; i < max; i++) state.opt[`${o.key}${from + i}`] = o.default ?? '';
    } else state.opt[o.key] = o.default;
  }
  Object.assign(state.opt, fromUrl.opt);
  state.mockup = fromUrl.mockup || (state.schema.mockups.find((m) => m.default) || state.schema.mockups[0]).id;

  $('#title').textContent = state.schema.product.title;
  $('#crumb').textContent = state.schema.product.title;
  document.title = `${state.schema.product.title} — DemoStore`;

  buildOptions(); priceOut(); validate(); countdown(); paint();

  $('#qm').onclick = () => { state.qty = Math.max(1, state.qty - 1); $('#qv').textContent = state.qty; priceOut(); writeUrl(); };
  $('#qp').onclick = () => { state.qty = Math.min(99, state.qty + 1); $('#qv').textContent = state.qty; priceOut(); writeUrl(); };
  $('#qv').textContent = state.qty;
  $('#add').onclick = () => {
    if (!validate()) return;
    const v = VARIANTS.find((x) => x.id === state.variant);
    toast(`Đã thêm ${state.qty} × ${v.name} — $${(v.price * state.qty).toFixed(2)} (demo, chưa nối giỏ hàng thật)`);
  };
  $('#copy').onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); toast('Đã sao chép URL trang — mở ở máy khác sẽ ra đúng thiết kế này'); }
    catch { toast('Trình duyệt chặn clipboard — bạn copy thủ công từ thanh địa chỉ nhé'); }
  };
  document.querySelectorAll('.tabbar button').forEach((b) => b.onclick = () => {
    document.querySelectorAll('.tabbar button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('on', p.id === `p-${b.dataset.p}`));
  });
})();
