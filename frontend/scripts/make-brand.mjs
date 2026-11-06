/**
 * Rebuild the favicon and install icons from the dedicated sigil artwork.
 *
 * The visible product logo is the neon crown artwork in
 * public/brand/absolute-genesis-neon.webp. It is deliberately independent
 * from these small icons so running the brand build never replaces it.
 *
 *   node scripts/make-brand.mjs
 *
 * Rasterising needs a browser. If one is not installed the PNGs are left
 * alone with a warning — the build must never fail because of an icon.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BRAND = resolve(ROOT, 'public/brand');
const SIGIL = resolve(BRAND, 'ag-sigil.svg');

/** Every PNG the platform asks for, and how the sigil sits inside it. */
const ICONS = [
  {file: 'ag-logo-96.png', size: 96, inset: 0.88, plate: false},
  {file: 'ag-logo-256.png', size: 256, inset: 0.88, plate: false},
  {file: 'ag-icon-192.png', size: 192, inset: 0.88, plate: false},
  {file: 'ag-icon-512.png', size: 512, inset: 0.88, plate: false},
  {file: 'ag-apple-touch-180.png', size: 180, inset: 0.88, plate: false},
  // The maskable icon is cropped to a circle on some launchers, so the sigil
  // sits well inside the safe zone on its own plate.
  {file: 'ag-icon-maskable-512.png', size: 512, inset: 0.56, plate: true},
];

/* ----------------------------------------------------------------- the pngs */

async function rasterise(svg) {
  let chromium;
  try {
    ({chromium} = await import('playwright'));
  } catch {
    console.warn('[brand] playwright is not installed — the PNG icons were left as they are.');
    return false;
  }

  const options = {headless: true};
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
    options.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
    if (process.env.PLAYWRIGHT_CHROMIUM_ARGS) options.args = JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS);
  }

  let browser;
  try {
    browser = await chromium.launch(options);
  } catch (error) {
    console.warn(`[brand] no browser available (${error.message.split('\n')[0]}) — the PNG icons were left as they are.`);
    return false;
  }

  try {
    for (const icon of ICONS) {
      const page = await browser.newPage({viewport: {width: icon.size, height: icon.size}, deviceScaleFactor: 1});
      const inner = icon.plate
        ? `<div style="position:absolute;inset:0;background:linear-gradient(160deg,#2a0f5e 0%,#120630 100%);display:grid;place-items:center">
             <div style="width:${Math.round(icon.inset * 100)}%;height:${Math.round(icon.inset * 100)}%">${svg}</div>
           </div>`
        : `<div style="position:absolute;inset:0;display:grid;place-items:center">
             <div style="width:${Math.round(icon.inset * 100)}%;height:${Math.round(icon.inset * 100)}%">${svg}</div>
           </div>`;
      await page.setContent(
        `<!doctype html><html><body style="margin:0;width:${icon.size}px;height:${icon.size}px;overflow:hidden;background:${
          icon.plate ? '#150734' : 'transparent'
        }">${inner}</body></html>`,
      );
      await page.waitForTimeout(120);
      await page.screenshot({path: resolve(BRAND, icon.file), omitBackground: !icon.plate});
      await page.close();
      console.log(`[brand] ${icon.file} (${icon.size}px)`);
    }
  } finally {
    await browser.close();
  }
  return true;
}

/* -------------------------------------------------------------------- main */

const svg = readFileSync(SIGIL, 'utf8');
await rasterise(svg);
