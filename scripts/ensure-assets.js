'use strict';
/**
 * Build step: asset thật đã nằm trong repo, chỉ bù những thứ còn thiếu.
 * Giữ nguyên ảnh đã commit — KHÔNG chạy gen-assets.js đè lên.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const count = (dir, ext) => {
  try { return fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(ext)).length; }
  catch { return 0; }
};
const run = (file) => execFileSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });

const fonts = count('assets/fonts', '.ttf');
if (fonts < 5) { console.log(`[build] fonts: ${fonts} -> tải bổ sung`); run('fetch-fonts.js'); }
else console.log(`[build] fonts: ${fonts} đã có`);

const scenes = fs.existsSync(path.join(root, 'assets/mockups'))
  ? fs.readdirSync(path.join(root, 'assets/mockups')).length : 0;
const art = count('assets/art', '.webp') + count('assets/art', '.png');
if (scenes === 0 || art === 0) {
  console.log('[build] thiếu asset ảnh -> dựng bộ sinh tạm bằng gen-assets.js');
  run('gen-assets.js');
} else {
  console.log(`[build] asset: ${scenes} cảnh mockup, ${art} mảnh artwork — dùng bản trong repo`);
}
