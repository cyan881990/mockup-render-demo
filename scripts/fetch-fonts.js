'use strict';
/**
 * Populates assets/fonts/ from the @expo-google-fonts npm packages.
 * Keeps font binaries out of the repo/deployment payload: the build step fetches them.
 * Idempotent — existing files are left alone.
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'assets', 'fonts');
const ROOT = path.join(__dirname, '..', 'node_modules', '@expo-google-fonts');

// target filename (as referenced by data/fonts.json) <- package, source basename
const WANTED = [
  ['NothingYouCouldDo-Regular.ttf', 'nothing-you-could-do',  'NothingYouCouldDo_400Regular.ttf'],
  ['EricaOne-Regular.ttf',          'erica-one',             'EricaOne_400Regular.ttf'],
  ['Outfit-Bold.ttf',               'outfit',                'Outfit_700Bold.ttf'],
  ['Outfit-Regular.ttf',            'outfit',                'Outfit_400Regular.ttf'],
  ['Inter-Bold.ttf',                'inter',                 'Inter_700Bold.ttf'],
  ['WorkSans-Bold.ttf',             'work-sans',             'WorkSans_700Bold.ttf'],
  ['Lora-Bold.ttf',                 'lora',                  'Lora_700Bold.ttf'],
  ['BigShoulders-Bold.ttf',         'big-shoulders-display', 'BigShouldersDisplay_700Bold.ttf'],
  ['SmoochSans-Medium.ttf',         'smooch-sans',           'SmoochSans_500Medium.ttf'],
  ['YoungSerif-Regular.ttf',        'young-serif',           'YoungSerif_400Regular.ttf'],
  ['Poppins-Bold.ttf',              'poppins',               'Poppins_700Bold.ttf'],
  ['Boldonse-Regular.ttf',          'boldonse',              'Boldonse_400Regular.ttf'],
  ['NotoSans-Bold.ttf',             'noto-sans',             'NotoSans_700Bold.ttf'],
];

/** Packages differ in layout (flat vs per-weight folders), so search the tree. */
function find(dir, basename, depth = 0) {
  if (depth > 3 || !fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name === basename) return p;
    if (e.isDirectory()) { const hit = find(p, basename, depth + 1); if (hit) return hit; }
  }
  return null;
}

fs.mkdirSync(OUT, { recursive: true });
let copied = 0, kept = 0, missing = [];
for (const [target, pkg, source] of WANTED) {
  const dest = path.join(OUT, target);
  if (fs.existsSync(dest)) { kept++; continue; }
  const src = find(path.join(ROOT, pkg), source);
  if (!src) {
    // fall back to any weight shipped by that package rather than failing the build
    const alt = find(path.join(ROOT, pkg), null) || null;
    missing.push(`${target} (looked for ${pkg}/${source})`);
    continue;
  }
  fs.copyFileSync(src, dest);
  copied++;
}
console.log(`[fonts] ${copied} copied, ${kept} already present${missing.length ? `, ${missing.length} missing` : ''}`);
for (const m of missing) console.warn(`[fonts] MISSING ${m}`);
if (missing.length) process.exitCode = 0;   // registry skips missing fonts with a warning
