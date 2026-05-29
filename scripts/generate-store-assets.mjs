import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const out = path.join(root, 'store-assets');
await fs.mkdir(path.join(out, 'screenshots'), { recursive: true });
await fs.mkdir(path.join(out, 'promotional'), { recursive: true });

const burgundy = '#b1124a';
const ink = '#171717';
const muted = '#687385';
const cream = '#f7f4ee';
const card = '#ffffff';
const edge = '#e6dfd7';

function logo(x, y, s, color = burgundy) {
  const r = s / 4;
  return `
    <g transform="translate(${x} ${y})" fill="${color}">
      <circle cx="${s / 2}" cy="${r}" r="${r}"/>
      <circle cx="${r}" cy="${s * 0.62}" r="${r}"/>
      <circle cx="${s - r}" cy="${s * 0.62}" r="${r}"/>
      <path d="M${s / 2} ${s * 0.38} L${s * 0.72} ${s} L${s * 0.28} ${s} Z"/>
    </g>`;
}

function mannequin(cx, top, scale, suit = '#1d304d', shirt = '#f7f5f0', skin = '#c8a889') {
  return `
    <g transform="translate(${cx} ${top}) scale(${scale})">
      <ellipse cx="0" cy="30" rx="24" ry="28" fill="${skin}"/>
      <path d="M-24 66 C-58 92 -70 164 -72 270 L72 270 C70 164 58 92 24 66 Z" fill="${suit}"/>
      <path d="M-18 70 L0 140 L18 70 Z" fill="${shirt}"/>
      <path d="M0 95 L-9 176 L0 208 L9 176 Z" fill="#2e2230" opacity=".9"/>
      <path d="M-68 270 L-54 410 L-14 410 L-4 270 Z" fill="${suit}"/>
      <path d="M4 270 L14 410 L54 410 L68 270 Z" fill="${suit}"/>
      <path d="M-68 410 L-16 410" stroke="#111" stroke-width="10" stroke-linecap="round"/>
      <path d="M16 410 L68 410" stroke="#111" stroke-width="10" stroke-linecap="round"/>
      <path d="M-64 126 C-102 168 -104 244 -82 300" stroke="${suit}" stroke-width="34" stroke-linecap="round" fill="none"/>
      <path d="M64 126 C102 168 104 244 82 300" stroke="${suit}" stroke-width="34" stroke-linecap="round" fill="none"/>
      <path d="M-35 24 C-22 -18 20 -22 38 12 C24 2 -4 0 -20 16 C-28 22 -34 28 -35 24Z" fill="#171717"/>
    </g>`;
}

function cardSvg(x, y, w, h, brand, suit, crop = 'full') {
  const scale = crop === 'portrait' ? 0.72 : 0.58;
  const figureTop = crop === 'portrait' ? y + 2 : y + 14;
  const figureX = x + w / 2;
  return `
    <g transform="translate(${x} ${y})">
      <rect width="${w}" height="${h}" rx="18" fill="${card}" stroke="${edge}"/>
      <clipPath id="clip-${Math.round(x)}-${Math.round(y)}"><rect width="${w}" height="${h - 62}" rx="18"/></clipPath>
      <g clip-path="url(#clip-${Math.round(x)}-${Math.round(y)})">
        <rect width="${w}" height="${h - 62}" fill="#eef0ef"/>
        ${mannequin(figureX - x, figureTop - y, scale, suit)}
      </g>
      <rect y="${h - 62}" width="${w}" height="62" fill="#fff"/>
      <rect x="18" y="${h - 44}" width="${Math.max(72, brand.length * 10 + 28)}" height="28" rx="14" fill="#f3f0eb"/>
      <text x="32" y="${h - 25}" font-family="Inter, Arial" font-size="14" font-weight="600" fill="#475467">${brand}</text>
      <circle cx="${w - 72}" cy="${h - 30}" r="17" fill="#fff" stroke="#e9e4df"/>
      <path d="M${w - 78} ${h - 34}h9l-3-3m3 3-3 3" stroke="#475467" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${w - 32}" cy="${h - 30}" r="17" fill="#fff" stroke="#e9e4df"/>
      <path d="M${w - 37} ${h - 25}l10-10M${w - 27} ${h - 35}v7h-7" stroke="#111" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </g>`;
}

async function renderSvg(filename, width, height, body) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="${cream}"/>
    ${body}
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(out, filename));
}

await renderSvg('screenshots/01-dressing-room-grid-1280x800.png', 1280, 800, `
  ${logo(34, 34, 36)}
  <text x="86" y="62" font-family="Inter, Arial" font-size="24" font-weight="650" fill="${ink}">Dressing Room</text>
  <g transform="translate(32 112)">
    <rect width="78" height="38" rx="19" fill="#111"/><text x="22" y="25" font-family="Inter, Arial" font-size="14" font-weight="650" fill="#fff">All 18</text>
    <rect x="92" width="92" height="38" rx="19" fill="#fff" stroke="${edge}"/><text x="120" y="25" font-family="Inter, Arial" font-size="14" font-weight="600" fill="#475467">Zara 6</text>
    <rect x="198" width="108" height="38" rx="19" fill="#fff" stroke="${edge}"/><text x="226" y="25" font-family="Inter, Arial" font-size="14" font-weight="600" fill="#475467">Mango 7</text>
    <rect x="320" width="132" height="38" rx="19" fill="#fff" stroke="${edge}"/><text x="346" y="25" font-family="Inter, Arial" font-size="14" font-weight="600" fill="#475467">Suitsupply 5</text>
  </g>
  ${cardSvg(38, 190, 186, 308, 'Suitsupply', '#202b37', 'portrait')}
  ${cardSvg(248, 190, 186, 308, 'Zara', '#6f4f34')}
  ${cardSvg(458, 190, 186, 308, 'Mango', '#d7ceb8')}
  ${cardSvg(668, 190, 186, 308, 'Suitsupply', '#1d304d')}
  ${cardSvg(878, 190, 186, 308, 'Mango', '#536344')}
  ${cardSvg(1088, 190, 154, 308, 'Zara', '#222')}
  ${cardSvg(38, 528, 186, 228, 'Mango', '#b89a6b', 'portrait')}
  ${cardSvg(248, 528, 186, 228, 'Suitsupply', '#101827')}
  ${cardSvg(458, 528, 186, 228, 'Zara', '#777')}
  <circle cx="1232" cy="56" r="23" fill="#fff" stroke="${edge}"/>
  <path d="M1223 51l9-5 9 5-9 5-9-5Zm0 10 9 5 9-5" stroke="#475467" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
`);

await renderSvg('screenshots/02-shopping-page-tryon-1280x800.png', 1280, 800, `
  <rect x="0" y="0" width="1280" height="72" fill="#fff"/>
  <text x="48" y="45" font-family="Inter, Arial" font-size="22" font-weight="650" fill="${ink}">Shopping page</text>
  <text x="1000" y="45" font-family="Inter, Arial" font-size="15" fill="${muted}">native product page stays intact</text>
  <rect x="48" y="112" width="520" height="620" rx="24" fill="#ebeceb"/>
  ${mannequin(308, 176, 0.9, '#6b5644')}
  <rect x="84" y="150" width="120" height="38" rx="19" fill="${burgundy}"/>
  <text x="113" y="174" font-family="Inter, Arial" font-size="15" font-weight="650" fill="#fff">Try on</text>
  <rect x="640" y="112" width="520" height="620" rx="24" fill="#fff" stroke="${edge}"/>
  ${logo(684, 156, 34)}
  <text x="734" y="181" font-family="Inter, Arial" font-size="28" font-weight="650" fill="${ink}">Create a try-on</text>
  <text x="684" y="230" font-family="Inter, Arial" font-size="18" fill="${muted}">Paste your OpenAI key once, add your reference photo, and generate looks on product images.</text>
  <rect x="684" y="286" width="388" height="54" rx="16" fill="#f8faf9" stroke="#d9e0dc"/>
  <text x="708" y="320" font-family="Inter, Arial" font-size="16" fill="#777">sk-••••••••••••••••</text>
  <rect x="684" y="374" width="176" height="44" rx="14" fill="#111"/>
  <text x="722" y="402" font-family="Inter, Arial" font-size="16" font-weight="650" fill="#fff">Try on visible</text>
  <rect x="884" y="374" width="148" height="44" rx="14" fill="#f8faf9"/>
  <text x="922" y="402" font-family="Inter, Arial" font-size="16" font-weight="600" fill="#222">Saved looks</text>
  <path d="M580 420 C610 420 610 420 640 420" stroke="${burgundy}" stroke-width="4" fill="none" stroke-linecap="round" stroke-dasharray="8 10"/>
`);

await renderSvg('promotional/small-tile-440x280.png', 440, 280, `
  <rect x="0" y="0" width="440" height="280" fill="${cream}"/>
  ${logo(36, 36, 48)}
  <text x="100" y="70" font-family="Inter, Arial" font-size="30" font-weight="700" fill="${ink}">Dressing Room</text>
  <text x="40" y="122" font-family="Inter, Arial" font-size="18" fill="${muted}">AI try-ons on shopping pages</text>
  ${cardSvg(42, 152, 88, 108, 'Zara', '#6f4f34')}
  ${cardSvg(146, 136, 96, 124, 'Mango', '#536344')}
  ${cardSvg(262, 118, 116, 142, 'Suit', '#1d304d')}
`);

await renderSvg('promotional/marquee-1400x560.png', 1400, 560, `
  <rect width="1400" height="560" fill="${cream}"/>
  ${logo(72, 76, 64)}
  <text x="158" y="124" font-family="Inter, Arial" font-size="54" font-weight="750" fill="${ink}">Dressing Room</text>
  <text x="76" y="198" font-family="Inter, Arial" font-size="28" fill="${muted}">Create AI try-ons while you shop. Save looks in one clean room.</text>
  <rect x="76" y="260" width="230" height="58" rx="18" fill="#111"/>
  <text x="116" y="297" font-family="Inter, Arial" font-size="20" font-weight="700" fill="#fff">Try on visible</text>
  <rect x="332" y="260" width="190" height="58" rx="18" fill="#fff" stroke="${edge}"/>
  <text x="378" y="297" font-family="Inter, Arial" font-size="20" font-weight="650" fill="#222">Saved looks</text>
  ${cardSvg(730, 78, 178, 360, 'Mango', '#536344')}
  ${cardSvg(940, 58, 196, 398, 'Suitsupply', '#1d304d')}
  ${cardSvg(1170, 96, 158, 330, 'Zara', '#6f4f34')}
  <circle cx="1208" cy="420" r="34" fill="${burgundy}" opacity=".12"/>
`);

console.log('Generated Chrome Web Store assets in store-assets/.');
