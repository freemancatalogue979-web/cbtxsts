/**
 * Build the brand assets from the one source of truth.
 *
 * `src/components/Logo.tsx` draws the Genesis sigil. This script renders that
 * component to a standalone `public/brand/ag-sigil.svg`, then rasterises the
 * SVG into the PNG icons the platform asks for — favicon, PWA icons, the
 * maskable icon and the apple-touch icon.
 *
 * The icons are therefore never a second, drifting copy of the mark: they are
 * rebuilt from the component every time.
 *
 *   node scripts/make-brand.mjs
 *
 * Rasterising needs a browser. If one is not installed the PNGs are left
 * alone with a warning — the build must never fail because of an icon.
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

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

/* ------------------------------------------------------------------ the svg */

/** Load the sigil component straight from TypeScript, with no build step. */
async function loadSigil() {
  const source = readFileSync(resolve(ROOT, 'src/components/Logo.tsx'), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    fileName: 'Logo.tsx',
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  /* The transpiled module has to live on disk inside the project so Node can
     resolve `react/jsx-runtime` against this project's node_modules. */
  const cache = resolve(ROOT, 'node_modules/.brand-build');
  mkdirSync(cache, {recursive: true});
  const file = resolve(cache, 'Logo.mjs');
  writeFileSync(file, outputText, 'utf8');
  const module = await import(`file://${file}`);
  return module.GenesisCrest;
}

/**
 * React's `useId` gives ids like `:r0:`, which are legal in HTML but make a
 * broken `url(#:r0:)` reference once the markup is saved as a standalone SVG
 * file. Rename them to something a file can carry.
 */
function safeIds(markup) {
  const map = new Map();
  let count = 0;
  for (const match of markup.matchAll(/id="([^"]+)"/g)) {
    if (!map.has(match[1])) map.set(match[1], `g${count++}`);
  }
  return markup
    .replace(/url\(#([^)]+)\)/g, (whole, id) => (map.has(id) ? `url(#${map.get(id)})` : whole))
    .replace(/id="([^"]+)"/g, (whole, id) => (map.has(id) ? `id="${map.get(id)}"` : whole));
}

async function buildSvg() {
  const GenesisCrest = await loadSigil();
  /* Render it as an element, not by calling it — the component uses useId. */
  const markup = renderToStaticMarkup(createElement(GenesisCrest, {size: null}));
  const svg = markup
    .replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
    .replace(/\s(width|height|style|class)="[^"]*"/g, '')
    .replace('role="presentation"', '')
    .replace('aria-hidden="true"', '')
    .replace('focusable="false"', '');
  return `<?xml version="1.0" encoding="UTF-8"?>\n${safeIds(svg)}\n`;
}

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

mkdirSync(BRAND, {recursive: true});
const svg = await buildSvg();
writeFileSync(SIGIL, svg, 'utf8');
console.log('[brand] public/brand/ag-sigil.svg written');
await rasterise(svg);
