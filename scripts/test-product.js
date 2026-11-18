/** Drives the real product page in a DOM against the running server. */
const { JSDOM } = require('jsdom');
const BASE = process.env.BASE || 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const html = await (await fetch(`${BASE}/product.html`)).text();
  const js = await (await fetch(`${BASE}/product.js`)).text();
  const dom = new JSDOM(html, { url: `${BASE}/product.html`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.error || e.message)));
  window.fetch = (u, o) => fetch(new URL(u, BASE), o);
  window.URL.createObjectURL = (b) => `blob:fake/${b.size}`;
  window.URL.revokeObjectURL = () => {};
  window.performance = globalThis.performance;
  window.navigator.clipboard = { writeText: async () => {} };
  try { window.eval(js); } catch (e) { errors.push('eval: ' + e.message); }

  const $ = (s) => window.document.querySelector(s);
  const $$ = (s) => [...window.document.querySelectorAll(s)];
  const ok = (n, c, x = '') => console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`);
  await wait(2000);

  ok('title loaded', /Runner Rug/i.test($('#title').textContent), $('#title').textContent);
  ok('variant buttons', $$('.variants button').length === 2);
  ok('option fieldsets', $$('#opts fieldset').length >= 5, `${$$('#opts fieldset').length}`);
  ok('background swatches', $$('#opts fieldset:nth-child(2) .sw').length === 6);
  ok('member steps 1..6', $$('.steps button').length === 6);
  ok('member rows match count', $$('.member').length === 3, `${$$('.member').length} rows`);
  ok('hero rendered', /^blob:/.test($('#hero').src || ''), $('#hero').src);
  ok('render stamp', /ms/.test($('#stamp').textContent), $('#stamp').textContent);
  ok('thumbs', $$('#thumbs button').length === 2);
  ok('url shown', $('#url').textContent.includes('/render?'), $('#url').textContent.slice(0, 80));

  // change member count 3 -> 5 and confirm rows + url follow
  $$('.steps button')[4].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(900);
  ok('member=5 adds rows', $$('.member').length === 5, `${$$('.member').length}`);
  ok('url carries member=5', window.location.search.includes('member=5'), window.location.search.slice(0, 90));

  // pick a background swatch
  const before = $('#url').textContent;
  $$('#opts fieldset:nth-child(2) .sw')[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(900);
  ok('swatch changes render url', $('#url').textContent !== before, $('#url').textContent.split('?')[1]?.slice(0, 70));

  // required-field validation
  const nameInput = $$('#opts .field input')[0];
  nameInput.value = ''; nameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(200);
  ok('empty name blocks cart', $('#add').disabled === true);
  nameInput.value = 'Gia đình Trần'; nameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(900);
  ok('valid name enables cart', $('#add').disabled === false);
  ok('vietnamese name in url', decodeURIComponent(window.location.search).includes('Trần'));

  // per-member colour
  const mini = $$('.member .mini .sw');
  if (mini.length) { mini[3].dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await wait(800); }
  ok('per-member colour applied', /soc1=/.test(window.location.search), window.location.search.match(/soc\d=\w+/g)?.slice(0, 3).join(' '));

  // quantity + price
  $('#qp').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  ok('qty price doubles', $('#price').textContent === '$79.90', $('#price').textContent);
  ok('no uncaught JS errors', errors.length === 0, errors.join(' | '));
  window.close(); process.exit(0);
})();
