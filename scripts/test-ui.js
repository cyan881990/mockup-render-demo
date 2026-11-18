/** Loads the real index.html + app.js in a DOM and drives it against the running server. */
const { JSDOM } = require('jsdom');
const BASE = process.env.BASE || 'http://localhost:3000';

(async () => {
  const html = await (await fetch(`${BASE}/lab`)).text();
  const appjs = await (await fetch(`${BASE}/app.js`)).text();
  const dom = new JSDOM(html, { url: `${BASE}/lab`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.error || e.message)));
  window.fetch = (u, o) => fetch(new URL(u, BASE), o);
  window.URL.createObjectURL = (b) => `blob:fake/${b.size}`;
  window.performance = globalThis.performance;
  try { window.eval(appjs); } catch (e) { errors.push('eval: ' + e.message); }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => window.document.querySelector(s);
  const $$ = (s) => [...window.document.querySelectorAll(s)];
  await wait(1500);

  const check = (name, cond, extra = '') =>
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);

  check('option swatches built', $$('#optbody .sw').length > 5, `${$$('#optbody .sw').length} swatches`);
  check('indexed soc controls built', $$('#optbody .field').length >= 6, `${$$('#optbody .field').length} fields`);
  check('resolved JSON shown', $('#resolved').textContent.includes('runner-rug'), '');
  check('image rendered', /^blob:/.test($('#out').getAttribute('src') || ''), $('#out').getAttribute('src'));
  check('meta pills', $$('#meta .pill').length >= 4, $('#meta').textContent.trim().replace(/\s+/g, ' '));
  check('mockup thumbs', $$('#mockupThumbs .thumb').length === 2, `${$$('#mockupThumbs .thumb').length}`);

  // click a swatch (change background) and confirm the URL + a re-render follow
  const before = $('#url').value;
  $$('#optbody .sw')[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(900);
  check('swatch click changes url', $('#url').value !== before, $('#url').value.split('?')[1]?.slice(0, 70));

  // switch mockup via thumbnail
  $$('#mockupThumbs .thumb')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(900);
  check('mockup switch re-renders', $('#meta').textContent.includes('ms'), '');

  // other tabs
  for (const tab of ['mockups', 'designs', 'fonts', 'metrics']) {
    $$(`nav button`).find((b) => b.dataset.tab === tab).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await wait(700);
  }
  check('mockups tab populated', $$('#mockupList .card').length >= 4, `${$$('#mockupList .card').length} cards`);
  check('designs tab populated', $$('#designList .card').length >= 3, `${$$('#designList .card').length} cards`);
  check('fonts tab populated', $$('#fontList tbody tr').length === 13, `${$$('#fontList tbody tr').length} rows`);
  check('metrics tab populated', $$('#metricCards .card').length === 4, '');
  check('no uncaught JS errors', errors.length === 0, errors.join(' | '));
  window.close();
  process.exit(0);
})();
