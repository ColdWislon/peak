/**
 * Génère les ressources PWA iOS depuis public/favicon.svg :
 *   - public/icons/apple-touch-icon.png         (180×180, opaque #0b1020, coins droits)
 *   - public/icons/splash/demarrage-<l>x<h>.png (écrans de démarrage, portrait)
 * puis affiche les balises <link> correspondantes à coller dans index.html.
 *
 * Usage : node scripts/generate-ios-assets.mjs
 * Si la révision Chromium attendue par Playwright manque :
 *   CHROMIUM_PATH=/chemin/vers/chromium node scripts/generate-ios-assets.mjs
 */
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const BG = '#0b1020';

/** Tailles logiques (points CSS) et densités des iPhone visés, en portrait. */
const SPLASHES = [
  { w: 375, h: 667, dpr: 2 }, // SE 2/3, 8
  { w: 375, h: 812, dpr: 3 }, // X, XS, 11 Pro, 12/13 mini
  { w: 390, h: 844, dpr: 3 }, // 12, 13, 14
  { w: 393, h: 852, dpr: 3 }, // 14 Pro, 15, 15 Pro, 16
  { w: 402, h: 874, dpr: 3 }, // 16 Pro, 17, 17 Pro
  { w: 414, h: 896, dpr: 2 }, // XR, 11
  { w: 414, h: 896, dpr: 3 }, // XS Max, 11 Pro Max
  { w: 420, h: 912, dpr: 3 }, // Air
  { w: 428, h: 926, dpr: 3 }, // 12/13 Pro Max, 14 Plus
  { w: 430, h: 932, dpr: 3 }, // 14 Pro Max, 15 Plus/Pro Max, 16 Plus
  { w: 440, h: 956, dpr: 3 }, // 16 Pro Max, 17 Pro Max
];

const svg = await readFile('public/favicon.svg', 'utf8');

/** Page minimale : fond identique au SVG, logo centré à la taille demandée. */
const pageHtml = (logoPx) =>
  `<!doctype html><meta charset="utf-8"><style>` +
  `html,body{margin:0;height:100%;background:${BG};display:grid;place-items:center}` +
  `svg{width:${logoPx}px;height:${logoPx}px}</style>${svg}`;

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

// Icône tactile : SVG plein cadre — ses coins arrondis se fondent dans le fond identique
// (iOS compose du noir derrière la transparence et applique son propre masque d'angles).
const icon = await browser.newPage({ viewport: { width: 180, height: 180 } });
await icon.setContent(pageHtml(180));
await icon.screenshot({ path: 'public/icons/apple-touch-icon.png' });
await icon.close();

await mkdir('public/icons/splash', { recursive: true });
const links = [];
for (const { w, h, dpr } of SPLASHES) {
  const file = `demarrage-${w * dpr}x${h * dpr}.png`;
  const page = await browser.newPage({
    viewport: { width: w, height: h },
    deviceScaleFactor: dpr,
  });
  await page.setContent(pageHtml(Math.round(w * 0.3)));
  await page.screenshot({ path: `public/icons/splash/${file}` });
  await page.close();
  links.push(
    `    <link\n` +
      `      rel="apple-touch-startup-image"\n` +
      `      media="screen and (device-width: ${w}px) and (device-height: ${h}px) ` +
      `and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)"\n` +
      `      href="/icons/splash/${file}"\n` +
      `    />`,
  );
}
await browser.close();

console.log(`Icône tactile et ${SPLASHES.length} écrans de démarrage générés.`);
console.log('Balises à coller dans index.html :\n');
console.log(links.join('\n'));
