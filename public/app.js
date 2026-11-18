'use strict';
const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, v);
  }
  for (const kid of [].concat(kids)) n.append(kid);
  return n;
};

const state = { schema: null, mockup: null, params: new URLSearchParams(), handle: null, product: null };

/* ---------------------------------------------------------------- tabs */
document.querySelectorAll('nav button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('main section').forEach((s) => s.classList.add('hidden'));
  $(`#tab-${b.dataset.tab}`).classList.remove('hidden');
  if (b.dataset.tab === 'mockups') loadMockups();
  if (b.dataset.tab === 'designs') loadDesigns();
  if (b.dataset.tab === 'fonts') loadFonts();
  if (b.dataset.tab === 'metrics') loadMetrics();
});

/* ------------------------------------------------------------- rendering */
function buildUrl(extra = {}) {
  const q = new URLSearchParams(state.params);
  q.set('url', $('#url').value.split('?')[0]);
  q.set('w', $('#w').value);
  q.set('format', $('#format').value);
  q.set('q', $('#quality').value);
  if (state.mockup) q.set('mockup', state.mockup);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return `/render?${q}`;
}

function storefrontUrl() {
  const base = $('#url').value.split('?')[0];
  const q = new URLSearchParams(state.params);
  return `${base}?${q}`;
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const src = buildUrl();
  const t0 = performance.now();
  const res = await fetch(src);
  if (seq !== renderSeq) return;
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    $('#meta').innerHTML = `<span class="pill cold"><b>${res.status}</b> ${err.error || ''}</span>`;
    return;
  }
  const blob = await res.blob();
  if (seq !== renderSeq) return;
  const wall = performance.now() - t0;
  $('#out').src = URL.createObjectURL(blob);
  const tier = res.headers.get('x-render-tier') || '?';
  $('#meta').innerHTML = '';
  $('#meta').append(
    pill(tier === 'render' ? 'cold' : 'hot', tier === 'render' ? 'rendered' : `cache ${tier}`, ''),
    pill('', 'server', `${res.headers.get('x-render-ms')} ms`),
    pill('', 'round trip', `${wall.toFixed(0)} ms`),
    pill('', 'size', `${(blob.size / 1024).toFixed(0)} KB`),
    pill('', 'type', blob.type.replace('image/', '')),
  );
  $('#url').value = storefrontUrl();
}
const pill = (cls, label, value) => el('span', { class: `pill ${cls}` },
  [document.createTextNode(label + ' '), el('b', { text: value })]);

/* ---------------------------------------------------------- option panel */
async function resolve() {
  const base = $('#url').value;
  const r = await fetch(`/api/resolve?url=${encodeURIComponent(base)}${state.mockup ? `&mockup=${state.mockup}` : ''}`);
  const data = await r.json();
  if (!r.ok) {
    $('#optbody').innerHTML = `<div class="warn">${data.error}<br><small>${JSON.stringify(data.detail || {})}</small></div>`;
    $('#resolved').textContent = JSON.stringify(data, null, 2);
    return null;
  }
  state.schema = data.schema;
  state.product = data.product.id;
  state.mockup = state.mockup || data.mockup.id;
  // seed params from what the server actually resolved, so the UI and URL agree
  state.params = new URLSearchParams();
  for (const [k, v] of Object.entries(data.options)) if (v !== '' && v !== null) state.params.set(k, v);
  $('#resolved').textContent = JSON.stringify(
    { product: data.product, design: data.design, mockup: data.mockup, options: data.options, warnings: data.warnings }, null, 2);
  $('#warn').classList.toggle('hidden', !data.warnings?.length);
  $('#warn').textContent = (data.warnings || []).join(' · ');
  buildOptionUi(data);
  buildMockupThumbs(data.mockups);
  return data;
}

function setParam(k, v) { state.params.set(k, v); render(); }

function buildOptionUi(data) {
  const box = $('#optbody');
  box.innerHTML = '';
  for (const o of data.schema.options) {
    if (o.indexed) continue;
    box.append(optionField(o, state.params.get(o.key)));
  }
  // indexed options expand to one control per item (soc1..socN)
  for (const o of data.schema.options.filter((x) => x.indexed)) {
    const count = Number(state.params.get(o.indexed.by) || 0);
    if (!count) continue;
    const wrap = el('div', { class: 'field' }, [el('label', { text: `${o.label} ×${count}` })]);
    for (let i = 0; i < count; i++) {
      const key = `${o.key}${(o.indexed.from ?? 1) + i}`;
      wrap.append(o.values
        ? swatchRow(key, o.values, state.params.get(key))
        : el('input', { type: 'text', value: state.params.get(key) || '', placeholder: `${o.label} ${i + 1}`,
            style: 'margin-bottom:6px', oninput: (e) => setParam(key, e.target.value) }));
    }
    box.append(wrap);
  }
}

function optionField(o, value) {
  const f = el('div', { class: 'field' }, [el('label', { text: o.label || o.key })]);
  if (o.type === 'swatch' || o.type === 'enum') f.append(swatchRow(o.key, o.values, value));
  else if (o.type === 'range' || o.type === 'int') {
    const lab = f.querySelector('label');
    lab.textContent = `${o.label} — ${value}`;
    f.append(el('input', { type: 'range', min: o.min, max: o.max, value,
      oninput: (e) => { lab.textContent = `${o.label} — ${e.target.value}`; state.params.set(o.key, e.target.value); resolveDebounced(); } }));
  } else {
    f.append(el('input', { type: 'text', value: value ?? '', maxlength: o.maxLength || 40,
      oninput: (e) => setParam(o.key, e.target.value) }));
  }
  return f;
}

function swatchRow(key, values, current) {
  const row = el('div', { class: 'swatches' });
  for (const v of values) {
    const sw = el('div', {
      class: `sw${String(v.value) === String(current) ? ' on' : ''}${v.value === 'none' ? ' none' : ''}`,
      title: v.label || v.value,
      style: v.value === 'none' ? '' : `background:${v.hex || '#888'}`,
      onclick: () => { row.querySelectorAll('.sw').forEach((s) => s.classList.remove('on')); sw.classList.add('on'); setParam(key, v.value); },
    });
    row.append(sw);
  }
  return row;
}

let debounce;
function resolveDebounced() { clearTimeout(debounce); debounce = setTimeout(async () => { await resolve(); render(); }, 120); }

function buildMockupThumbs(mockups) {
  const box = $('#mockupThumbs');
  box.innerHTML = '';
  for (const m of mockups) {
    const q = new URLSearchParams(state.params);
    q.set('url', $('#url').value.split('?')[0]); q.set('mockup', m.id); q.set('w', 320); q.set('format', 'webp');
    const t = el('div', { class: `thumb${m.id === state.mockup ? ' on' : ''}`,
      onclick: () => { state.mockup = m.id; buildMockupThumbs(mockups); render(); } },
      [el('img', { src: `/render?${q}`, loading: 'lazy' }), el('span', { text: m.name })]);
    box.append(t);
  }
}

/* ------------------------------------------------------------- catalogues */
async function loadMockups() {
  const list = await (await fetch('/api/mockups')).json();
  const box = $('#mockupList'); box.innerHTML = '';
  for (const m of list) {
    box.append(el('div', { class: 'card' }, [
      el('h3', { text: m.name }),
      el('img', { src: `/assets/${m.base}`, style: 'width:100%;border-radius:8px;border:1px solid var(--line)' }),
      el('table', {}, [el('tbody', {}, [
        tr('id', m.id), tr('size', m.size.join(' × ')),
        tr('surface', `${m.surface.type}${m.surface.cylinder ? ` · cylinder ${m.surface.cylinder}` : ''}`),
        tr('maps', [m.mask && 'mask', m.light && 'light', m.displaceMap && 'displace'].filter(Boolean).join(', ') || '—'),
        tr('print quad', m.surface.points.map((p) => p.join(',')).join('  ')),
      ])]),
    ]));
  }
}
const tr = (k, v) => el('tr', {}, [el('th', { text: k }), el('td', {}, [el('code', { text: String(v) })])]);

async function loadDesigns() {
  const [designs, products] = await Promise.all([
    (await fetch('/api/designs')).json(), (await fetch('/api/products')).json()]);
  const box = $('#designList'); box.innerHTML = '';
  for (const d of designs) {
    const p = products.find((x) => x.designId === d.id);
    box.append(el('div', { class: 'card' }, [
      el('h3', { text: d.name }),
      p ? el('img', { src: `/artwork/${p.id}?w=600&format=png`,
        style: 'width:100%;border-radius:8px;border:1px solid var(--line);background:#222' }) : el('div'),
      el('table', {}, [el('tbody', {}, [
        tr('id', d.id), tr('canvas', `${d.canvas.w} × ${d.canvas.h}`),
        tr('layers', d.layers.length),
        tr('options', (d.options || []).map((o) => o.key + (o.indexed ? '{i}' : '')).join(', ')),
      ])]),
    ]));
  }
}

async function loadFonts() {
  const fonts = await (await fetch('/api/fonts')).json();
  const box = $('#fontList'); box.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = fonts.map((f) => `@font-face{font-family:"ff-${f.id}";src:url("/assets/fonts/${f.file}")}`).join('');
  document.head.append(style);
  const table = el('table', {}, [el('thead', {}, [el('tr', {}, [
    el('th', { text: 'id' }), el('th', { text: 'family' }), el('th', { text: 'file' }), el('th', { text: 'sample' })])])]);
  const body = el('tbody');
  for (const f of fonts) {
    body.append(el('tr', {}, [
      el('td', {}, [el('code', { text: f.id })]),
      el('td', { text: f.family }),
      el('td', {}, [el('code', { text: `${(f.bytes / 1024).toFixed(0)} KB` })]),
      el('td', {}, [el('div', { class: 'fontsample', style: `font-family:"ff-${f.id}"`, text: 'The Nguyễns · 2026' })]),
    ]));
  }
  table.append(body); box.append(table);
}

async function loadMetrics() {
  const m = await (await fetch('/metrics')).json();
  $('#metrics').textContent = JSON.stringify(m, null, 2);
  const cards = $('#metricCards'); cards.innerHTML = '';
  const add = (title, rows) => cards.append(el('div', { class: 'card' }, [el('h3', { text: title }),
    el('table', {}, [el('tbody', {}, rows.map(([k, v]) => tr(k, v)))])]));
  add('Latency', [['all p50', `${m.all.p50} ms`], ['all p95', `${m.all.p95} ms`],
    ['cold p50', `${m.coldRender.p50} ms`], ['cold p95', `${m.coldRender.p95} ms`]]);
  add('Cold breakdown', [['artwork', `${m.coldRender.avgArtwork} ms`], ['composite', `${m.coldRender.avgComposite} ms`],
    ['encode', `${m.coldRender.avgEncode} ms`], ['renders', m.coldRender.count]]);
  add('Cache', [['hit rate', `${m.cache.hitRate}%`], ['memory', `${m.cache.memoryMB} MB / ${m.cache.memoryEntries}`],
    ['disk hits', m.cache.hitDisk], ['coalesced', m.cache.coalesced]]);
  add('Resident', [['mockup variants', m.assets.variants], ['mockup MB', m.assets.residentMB],
    ['art parts', `${m.parts.entries} (${m.parts.hitRate}% hit)`], ['artwork rasters', `${m.artworkCache.entries} / ${m.artworkCache.mb} MB`]]);
  if (!$('#tab-metrics').classList.contains('hidden')) setTimeout(loadMetrics, 2000);
}

/* ------------------------------------------------------------------ boot */
$('#go').onclick = async () => { state.mockup = null; await resolve(); render(); };
$('#url').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#go').click(); });
$('#w').oninput = (e) => { $('#wlabel').textContent = e.target.value; render(); };
$('#format').onchange = render;
$('#quality').onchange = render;
(async () => { await resolve(); render(); })();
