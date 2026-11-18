/** Loads the real product page + product.js in a DOM and walks the stepped option flow. */
const { JSDOM } = require('jsdom');
const BASE = process.env.BASE || 'http://localhost:3000';
const PRODUCT = process.env.PRODUCT || 'grandkids-snowflake-ornament';

(async () => {
  const url = `${BASE}/?product=${PRODUCT}`;
  const html = await (await fetch(url)).text();
  const js = await (await fetch(`${BASE}/product.js`)).text();
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.error || e.message)));
  window.fetch = (u, o) => fetch(new URL(u, BASE), o);
  window.URL.createObjectURL = (b) => `blob:fake/${b.size}`;
  window.performance = globalThis.performance;
  try { window.eval(js); } catch (e) { errors.push('eval: ' + e.message); }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => window.document.querySelector(s);
  const $$ = (s) => [...window.document.querySelectorAll(s)];
  const click = (n) => n.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  let fails = 0;
  const check = (name, cond, extra = '') => {
    if (!cond) fails++;
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  };
  await wait(1800);

  const steps = $$('#opts .step');
  check('các bước được dựng', steps.length >= 3, `${steps.length} bước`);
  check('chỉ bước 1 mở sẵn', $$('#opts .step.open').length === 1,
    $('#opts .step.open .st')?.textContent);
  check('bước sau bị khoá', $$('#opts .step.locked').length === steps.length - 1,
    `${$$('#opts .step.locked').length} khoá`);
  check('option chưa đổ hết ra', $$('#opts .step:not(.open) fieldset').length === 0);

  // bấm một ô màu trong bước đang mở -> ảnh phải dựng lại
  const sw = $$('#opts .step.open .sw');
  check('bước 1 có ô màu', sw.length > 2, `${sw.length} ô`);
  const beforeUrl = window.location.search;
  click(sw[2]);
  await wait(900);
  check('chọn màu đổi URL', window.location.search !== beforeUrl,
    window.location.search.slice(1, 60));
  check('ảnh đã dựng', /^blob:/.test($('#hero').getAttribute('src') || ''));

  // Tiếp tục -> bước 2 mở, bước 1 đóng lại và hiện tóm tắt
  click($('#opts .step.open .next'));
  await wait(400);
  check('qua bước 2', $$('#opts .step')[1].classList.contains('open'),
    $('#opts .step.open .st')?.textContent);
  check('bước 1 thu gọn còn tóm tắt', ($$('#opts .step')[0].querySelector('.sv').textContent || '').length > 0,
    $$('#opts .step')[0].querySelector('.sv').textContent);
  check('bước 1 đánh dấu xong', $$('#opts .step')[0].querySelector('.sn').textContent === '✓');

  // chọn số thành viên rồi sang bước điền tên
  const counts = $$('#opts .step.open .steps button');
  if (counts.length) {
    click(counts[Math.min(3, counts.length - 1)]);
    await wait(700);
    click($('#opts .step.open .next'));
    await wait(400);
    const rows = $$('#opts .step.open .member');
    check('bước tên mở đúng số dòng', rows.length === Math.min(4, counts.length), `${rows.length} dòng`);
    const inp = $('#opts .step.open .member input');
    if (inp) {
      inp.value = 'Mía';
      inp.dispatchEvent(new window.Event('input', { bubbles: true }));
      await wait(700);
      check('tên vào URL', window.location.search.includes('M%C3%ADa'));
    }
  }

  // bấm lại tiêu đề bước 1 để mở ra sửa
  click($$('#opts .step')[0].querySelector('.sh'));
  await wait(300);
  check('mở lại bước đã xong để sửa', $$('#opts .step')[0].classList.contains('open'));

  check('không có lỗi JS', errors.length === 0, errors.join(' | '));
  console.log(fails ? `\n${fails} FAIL` : '\nTất cả bước OK');
  process.exit(fails ? 1 : 0);
})();
