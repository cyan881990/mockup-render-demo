/** Quét fixture -> dựng SKU -> render thử: kiểm cả chuỗi không cần mạng. */
const fs = require('fs');
const path = require('path');
const { scan, parseForm, markIndexed } = require('../src/scan');
const { build } = require('../src/blueprint');
const { Registry } = require('../src/registry');
const { AssetStore } = require('../src/assets');
const { RenderCache } = require('../src/cache');
const { Renderer } = require('../src/render');

let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { c ? (pass++, console.log('PASS ', name, extra)) : (fail++, console.log('FAIL ', name, extra)); };

(async () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'test/fixtures/personalizer-antd.html'), 'utf8');
  const opts = markIndexed(parseForm(html));
  const by = Object.fromEntries(opts.map((o) => [o.key, o]));

  ok(opts.length === 5, 'quét ra 5 option', `— ${opts.map((o) => o.key).join(',')}`);
  ok(by.background?.type === 'swatch' && by.background.count === 5, 'nền: 5 lựa chọn');
  ok(by.name?.maxLength === 25, 'tên gia đình giới hạn 25 ký tự');
  ok(by.member?.type === 'range' && by.member.max === 10, 'số thành viên 1..10');
  ok(by.soc?.indexed?.by === 'member', 'màu tất lặp theo số thành viên');
  ok(by.mname?.indexed?.by === 'member', 'tên trên tất lặp theo số thành viên');

  const scanned = await scan('https://example.com/products/x', { html, fetchText: async () => { throw new Error('offline'); } });
  ok(scanned.warnings.length >= 1, 'cảnh báo khi không đọc được product JSON');

  const pack = JSON.parse(fs.readFileSync(path.join(root, 'data/artpacks.json'), 'utf8'))[0];
  const settings = JSON.parse(fs.readFileSync(path.join(root, 'data/settings.json'), 'utf8'));
  const reg = new Registry().loadAll();
  const r = new Renderer(reg, new AssetStore({ widths: settings.widths }),
    new RenderCache({ memoryMB: 32, diskEnabled: false }), settings);

  for (const [type, mockup] of [['runner-rug', 'rug-hallway'], ['mug', 'mug-desk'], ['tee', 'tee-flatlay']]) {
    const built = build(scanned, { pack, productType: type, title: `Test ${type}` });
    built.product.mockups = [mockup];
    reg.products.set(built.product.id, { ...built.product, hash: 't' });
    reg.designs.set(built.design.id, { ...built.design, hash: `t${Date.now()}${type}` });

    const keys = built.design.options.map((o) => o.key);
    ok(keys.includes('member') && keys.includes('name'), `${type}: giữ option đã quét`, `— ${keys.join(',')}`);
    const transparent = built.design.canvas.bg === 'transparent';
    ok(type === 'runner-rug' ? !transparent : transparent, `${type}: nền canvas đúng kiểu`);
    if (transparent) ok(keys.includes('ink') && !keys.includes('background'), `${type}: đổi màu nền thành màu mực`);

    const res = await r.render({ product: built.product.id, mockup, w: 900, format: 'jpeg' });
    ok(res.body.length > 20000, `${type}: render được trên ${mockup}`, `— ${Math.round(res.body.length / 1024)}KB, ${Math.round(res.timings.total)}ms`);
    ok(!(res.meta.warnings || []).some((w) => /missing|not found/i.test(w)), `${type}: không thiếu asset`);

    const many = await r.render({ product: built.product.id, mockup, query: { member: '6', name: 'Gia đình Trần' }, w: 700, format: 'jpeg' });
    ok(many.body.length > 10000, `${type}: 6 thành viên + tên tiếng Việt vẫn render`);
  }
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
