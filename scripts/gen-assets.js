'use strict';
/**
 * Generates demo mockup photos + their mask / light / displacement maps, plus a few
 * artwork part PNGs. In production these come from a photographer + designer;
 * the engine only cares about the file shapes produced here.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'assets', 'mockups');
const ART = path.join(__dirname, '..', 'assets', 'art');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(ART, { recursive: true });

const svgBuf = (svg) => Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>${svg}`);
const write = async (name, svg, w, h, fmt = 'jpeg') => {
  const p = path.join(OUT, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let img = sharp(svgBuf(svg), { density: 96 }).resize(w, h);
  img = fmt === 'jpeg' ? img.jpeg({ quality: 92, mozjpeg: true }) : img.png({ compressionLevel: 9 });
  await img.toFile(p);
  return p;
};

const quadPath = (q) => `M${q.map(([x, y]) => `${x},${y}`).join('L')}Z`;

// ---------------------------------------------------------------- rug: hallway
const RUG_QUAD = [[280, 520], [1540, 470], [1660, 880], [200, 950]];

async function rugHallway() {
  const W = 1800, H = 1200;
  const planks = [];
  for (let i = 0; i < 26; i++) {
    const y = 430 + i * i * 1.45 + i * 6;
    if (y > H) break;
    planks.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y - 18}" stroke="#00000022" stroke-width="${1 + i * 0.12}"/>`);
  }
  for (let i = 0; i < 14; i++) {
    const x = i * 150 - 60;
    planks.push(`<line x1="${x}" y1="430" x2="${x - 180}" y2="${H}" stroke="#0000001a" stroke-width="1.6"/>`);
  }
  const scene = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#efe7dc"/><stop offset="1" stop-color="#ddd2c4"/></linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#b08c63"/><stop offset="0.45" stop-color="#9c7850"/><stop offset="1" stop-color="#7d5c3b"/></linearGradient>
    <radialGradient id="pool" cx="0.22" cy="0.3" r="0.6">
      <stop offset="0" stop-color="#fff6e0" stop-opacity="0.55"/><stop offset="1" stop-color="#fff6e0" stop-opacity="0"/></radialGradient>
    <radialGradient id="vig" cx="0.5" cy="0.45" r="0.75">
      <stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.38"/></radialGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="26"/></filter>
    <filter id="soft2"><feGaussianBlur stdDeviation="9"/></filter>
  </defs>
  <rect width="${W}" height="440" fill="url(#wall)"/>
  <rect y="400" width="${W}" height="44" fill="#f6f1e9"/>
  <rect y="400" width="${W}" height="8" fill="#cbbfae"/>
  <rect y="436" width="${W}" height="${H - 436}" fill="url(#floor)"/>
  <g>${planks.join('')}</g>
  <rect y="436" width="${W}" height="${H - 436}" fill="url(#pool)"/>
  <g opacity="0.5"><path d="M60,440 L240,${H} L700,${H} L430,440Z" fill="#fff4dc" opacity="0.35" filter="url(#soft)"/></g>
  <ellipse cx="1500" cy="300" rx="150" ry="190" fill="#4c6b52" opacity="0.85" filter="url(#soft2)"/>
  <rect x="1455" y="400" width="90" height="60" fill="#7a5c3f" opacity="0.9"/>
  <path d="${quadPath(RUG_QUAD.map(([x, y], i) => [x + (i < 2 ? 14 : 26), y + 26]))}" fill="#000" opacity="0.26" filter="url(#soft2)"/>
  <rect width="${W}" height="${H}" fill="url(#vig)"/>
</svg>`;
  await write('rug-hallway/base.jpg', scene, W, H);

  await write('rug-hallway/mask.png', `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#000"/>
    <path d="${quadPath(RUG_QUAD)}" fill="#fff"/></svg>`, W, H, 'png');

  const seams = [];
  for (let i = 1; i < 9; i++) {
    const t = i / 9;
    const x1 = 280 + (1540 - 280) * t, y1 = 520 + (470 - 520) * t;
    const x2 = 200 + (1660 - 200) * t, y2 = 950 + (880 - 950) * t;
    seams.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-opacity="0.10" stroke-width="3"/>`);
  }
  await write('rug-hallway/light.png', `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="lg" x1="0" y1="0" x2="1" y2="0.3">
        <stop offset="0" stop-color="#b4b4b4"/><stop offset="0.3" stop-color="#9a9a9a"/>
        <stop offset="0.75" stop-color="#7e7e7e"/><stop offset="1" stop-color="#6f6f6f"/></linearGradient>
      <radialGradient id="hl" cx="0.25" cy="0.35" r="0.5">
        <stop offset="0" stop-color="#fff" stop-opacity="0.75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      <filter id="b"><feGaussianBlur stdDeviation="14"/></filter>
    </defs>
    <rect width="${W}" height="${H}" fill="#808080"/>
    <g><path d="${quadPath(RUG_QUAD)}" fill="url(#lg)"/>
       <path d="${quadPath(RUG_QUAD)}" fill="url(#hl)"/>
       ${seams.join('')}
       <path d="${quadPath(RUG_QUAD)}" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="26" filter="url(#b)"/>
    </g></svg>`, W, H, 'png');

  await sharp({ create: { width: W, height: H, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 10 } } })
    .greyscale().blur(1.6).png().toFile(path.join(OUT, 'rug-hallway/displace.png'));
}

// ------------------------------------------------------------- rug: flat lay
const FLAT_QUAD = [[150, 300], [1650, 330], [1640, 830], [160, 800]];
async function rugFlat() {
  const W = 1800, H = 1120;
  await write('rug-flatlay/base.jpg', `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="#e9e3da"/><stop offset="1" stop-color="#d3cabd"/></linearGradient>
      <filter id="s"><feGaussianBlur stdDeviation="16"/></filter></defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <path d="${quadPath(FLAT_QUAD.map(([x, y]) => [x + 16, y + 22]))}" fill="#000" opacity="0.28" filter="url(#s)"/>
  </svg>`, W, H);
  await write('rug-flatlay/mask.png', `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#000"/><path d="${quadPath(FLAT_QUAD)}" fill="#fff"/></svg>`, W, H, 'png');
  await write('rug-flatlay/light.png', `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="0.2">
      <stop offset="0" stop-color="#9e9e9e"/><stop offset="0.5" stop-color="#8b8b8b"/><stop offset="1" stop-color="#7c7c7c"/></linearGradient>
      <filter id="b"><feGaussianBlur stdDeviation="10"/></filter></defs>
    <rect width="${W}" height="${H}" fill="#808080"/>
    <path d="${quadPath(FLAT_QUAD)}" fill="url(#lg)"/>
    <path d="${quadPath(FLAT_QUAD)}" fill="none" stroke="#000" stroke-opacity="0.3" stroke-width="18" filter="url(#b)"/></svg>`, W, H, 'png');
}

// ------------------------------------------------------------------ mug: desk
const MUG_QUAD = [[560, 360], [1000, 360], [1000, 700], [560, 700]];
async function mugDesk() {
  const W = 1600, H = 1100;
  await write('mug-desk/base.jpg', `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#efe9e1"/><stop offset="1" stop-color="#d8cfc3"/></linearGradient>
      <linearGradient id="desk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8e6b4a"/><stop offset="1" stop-color="#6d5038"/></linearGradient>
      <linearGradient id="cer" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#cfc8c0"/><stop offset="0.18" stop-color="#ffffff"/><stop offset="0.6" stop-color="#f3efea"/><stop offset="1" stop-color="#b8b0a7"/></linearGradient>
      <filter id="sh"><feGaussianBlur stdDeviation="14"/></filter>
    </defs>
    <rect width="${W}" height="760" fill="url(#bg)"/>
    <rect y="740" width="${W}" height="${H - 740}" fill="url(#desk)"/>
    <ellipse cx="800" cy="745" rx="300" ry="36" fill="#000" opacity="0.35" filter="url(#sh)"/>
    <path d="M1000,420 q120,0 120,95 q0,95 -120,95" fill="none" stroke="#efeae4" stroke-width="42"/>
    <path d="M1000,420 q120,0 120,95 q0,95 -120,95" fill="none" stroke="#00000018" stroke-width="42" stroke-dasharray="4 400"/>
    <rect x="555" y="330" width="450" height="400" rx="26" fill="url(#cer)"/>
    <ellipse cx="780" cy="334" rx="225" ry="34" fill="#efeae4"/>
    <ellipse cx="780" cy="334" rx="196" ry="26" fill="#6b5a4a" opacity="0.65"/>
    <ellipse cx="780" cy="726" rx="210" ry="26" fill="#000" opacity="0.12"/>
  </svg>`, W, H);
  await write('mug-desk/mask.png', `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#000"/>
    <rect x="${MUG_QUAD[0][0]}" y="${MUG_QUAD[0][1]}" width="${MUG_QUAD[1][0] - MUG_QUAD[0][0]}" height="${MUG_QUAD[2][1] - MUG_QUAD[0][1]}" rx="10" fill="#fff"/></svg>`, W, H, 'png');
  await write('mug-desk/light.png', `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="cyl" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#5e5e5e"/><stop offset="0.16" stop-color="#d8d8d8"/><stop offset="0.42" stop-color="#9c9c9c"/>
      <stop offset="0.78" stop-color="#7b7b7b"/><stop offset="1" stop-color="#545454"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="#808080"/>
    <rect x="${MUG_QUAD[0][0] - 10}" y="${MUG_QUAD[0][1] - 10}" width="${MUG_QUAD[1][0] - MUG_QUAD[0][0] + 20}" height="${MUG_QUAD[2][1] - MUG_QUAD[0][1] + 20}" fill="url(#cyl)"/></svg>`, W, H, 'png');
}

// ------------------------------------------------------------- tee: flat lay
const TEE_QUAD = [[545, 470], [945, 470], [950, 1000], [540, 1000]];
async function teeFlat() {
  const W = 1500, H = 1500;
  const wrinkles = [];
  for (let i = 0; i < 16; i++) {
    const x = 420 + Math.random() * 660, y = 420 + Math.random() * 640;
    wrinkles.push(`<path d="M${x},${y} q${30 + Math.random() * 70},${20 + Math.random() * 60} ${90 + Math.random() * 120},${-10 + Math.random() * 90}"
      fill="none" stroke="#000" stroke-opacity="${0.04 + Math.random() * 0.05}" stroke-width="${8 + Math.random() * 16}"/>`);
  }
  const shirt = `M480,330 L600,250 Q750,330 900,250 L1020,330 L1120,470 L1010,540 L995,1230 Q750,1265 505,1230 L490,540 L380,470 Z`;
  await write('tee-flatlay/base.jpg', `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#e7e2d9"/><stop offset="1" stop-color="#cdc5b8"/></linearGradient>
      <linearGradient id="fab" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#fdfdfc"/><stop offset="1" stop-color="#dedbd4"/></linearGradient>
      <filter id="sh"><feGaussianBlur stdDeviation="18"/></filter>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <path d="${shirt}" transform="translate(22,26)" fill="#000" opacity="0.3" filter="url(#sh)"/>
    <path d="${shirt}" fill="url(#fab)"/>
    <path d="M600,250 Q750,350 900,250 Q750,300 600,250Z" fill="#cfcbc3"/>
    ${wrinkles.join('')}
  </svg>`, W, H);
  await write('tee-flatlay/mask.png', `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#000"/><path d="${quadPath(TEE_QUAD)}" fill="#fff"/></svg>`, W, H, 'png');
  await write('tee-flatlay/light.png', `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><radialGradient id="r" cx="0.4" cy="0.3" r="0.8">
      <stop offset="0" stop-color="#a6a6a6"/><stop offset="1" stop-color="#6e6e6e"/></radialGradient>
      <filter id="bb"><feGaussianBlur stdDeviation="12"/></filter></defs>
    <rect width="${W}" height="${H}" fill="#808080"/>
    <path d="${quadPath(TEE_QUAD)}" fill="url(#r)"/>
    <g filter="url(#bb)">${wrinkles.join('').replace(/stroke-opacity="0\.0\d+"/g, 'stroke-opacity="0.22"')}</g></svg>`, W, H, 'png');
  await sharp({ create: { width: W, height: H, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 26 } } })
    .greyscale().blur(7).png().toFile(path.join(OUT, 'tee-flatlay/displace.png'));
}

// ------------------------------------------------------------- artwork parts
async function artParts() {
  const stocking = (d, name) => sharp(svgBuf(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="620" viewBox="0 0 400 620">${d}</svg>`
  )).png().toFile(path.join(ART, name));

  await stocking(`<path d="M120,120 L120,330 Q120,400 80,440 L50,470 Q10,510 40,555 Q70,600 130,580 L300,500 Q360,470 350,410 Q340,355 280,350 L240,348 L240,120Z" fill="#ffffff"/>`, 'stocking-body.png');
  await stocking(`<rect x="104" y="70" width="152" height="70" rx="24" fill="#ffffff"/>
    <circle cx="180" cy="46" r="20" fill="none" stroke="#ffffff" stroke-width="12"/>`, 'stocking-trim.png');
  await stocking(`<path d="M150,250 h160 M150,300 h160" stroke="#ffffff" stroke-width="18" stroke-linecap="round" fill="none"/>`, 'stocking-stripe.png');

  await sharp(svgBuf(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
    <g fill="#ffffff" opacity="0.9">
      <circle cx="40" cy="42" r="6"/><circle cx="128" cy="30" r="4"/><circle cx="168" cy="96" r="6.5"/>
      <circle cx="74" cy="120" r="4.5"/><circle cx="24" cy="160" r="5"/><circle cx="112" cy="172" r="4"/>
      <path d="M150,150 l0,22 M139,161 l22,0 M142,154 l16,16 M158,154 l-16,16" stroke="#fff" stroke-width="3"/>
      <path d="M62,58 l0,26 M49,71 l26,0 M53,62 l18,18 M71,62 l-18,18" stroke="#fff" stroke-width="3"/>
    </g></svg>`)).png().toFile(path.join(ART, 'snow.png'));

  await sharp(svgBuf(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">
    <g stroke="#ffffff" stroke-width="10" fill="none" opacity="0.75" stroke-linecap="round">
      <path d="M120,30 V210 M30,120 H210 M57,57 L183,183 M183,57 L57,183"/>
      <path d="M120,60 l-22,22 M120,60 l22,22 M120,180 l-22,-22 M120,180 l22,-22"/>
    </g></svg>`)).png().toFile(path.join(ART, 'flake.png'));

  await sharp(svgBuf(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="520" viewBox="0 0 420 520">
    <path d="M210,20 L300,170 L255,170 L340,310 L285,310 L390,470 L30,470 L135,310 L80,310 L165,170 L120,170Z" fill="#ffffff"/>
    <rect x="185" y="460" width="50" height="50" fill="#ffffff"/></svg>`)).png().toFile(path.join(ART, 'tree.png'));

  await sharp(svgBuf(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
    <circle cx="150" cy="118" r="62" fill="#fff"/>
    <path d="M150,180 q-78,0 -84,110 h168 q-6,-110 -84,-110Z" fill="#fff"/></svg>`)).png().toFile(path.join(ART, 'figure-adult.png'));

  await sharp(svgBuf(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
    <circle cx="150" cy="150" r="52" fill="#fff"/>
    <path d="M150,198 q-62,0 -68,92 h136 q-6,-92 -68,-92Z" fill="#fff"/></svg>`)).png().toFile(path.join(ART, 'figure-kid.png'));

  await sharp(svgBuf(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="260" viewBox="0 0 320 260">
    <ellipse cx="170" cy="170" rx="95" ry="62" fill="#fff"/><circle cx="70" cy="125" r="52" fill="#fff"/>
    <path d="M40,88 l-6,-42 l44,22Z M100,88 l6,-42 l-44,22Z" fill="#fff"/>
    <path d="M250,130 q40,-50 44,-8 q4,40 -34,58Z" fill="#fff"/></svg>`)).png().toFile(path.join(ART, 'pet-cat.png'));

  await sharp(svgBuf(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="260" viewBox="0 0 320 260">
    <ellipse cx="170" cy="175" rx="98" ry="60" fill="#fff"/><circle cx="72" cy="120" r="55" fill="#fff"/>
    <ellipse cx="38" cy="112" rx="20" ry="40" fill="#fff"/><path d="M255,145 q55,-30 40,20 q-10,34 -44,20Z" fill="#fff"/></svg>`)).png().toFile(path.join(ART, 'pet-dog.png'));
}

(async () => {
  await Promise.all([rugHallway(), rugFlat(), mugDesk(), teeFlat(), artParts()]);
  console.log('assets generated');
})().catch((e) => { console.error(e); process.exit(1); });
