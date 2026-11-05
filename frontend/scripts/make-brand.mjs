/**
 * Build the brand assets from their one source of truth.
 *
 * Two marks live in this app, and they are different things:
 *
 *   1. **The Neon Crown** — the logo. It is drawn by hand and lives in the
 *      repository root as a PNG (`Absolute Genesis Neon Crown Logo.png`). This
 *      script knocks the artwork's flat background out, crops the parts the app
 *      needs (the mark for the header, the full lockup for the splash) and
 *      writes the PNGs the platform asks for.
 *
 *   2. **The Genesis sigil** — `src/components/Logo.tsx` draws it. It stays the
 *      favicon and the fallback whenever the artwork is missing, so a machine
 *      without the source PNG still shows a mark rather than a broken image.
 *
 * Nothing here is a second, drifting copy: the crown comes from the artwork in
 * the repository, and the sigil is rebuilt from the component every time.
 *
 *   node scripts/make-brand.mjs
 *
 * Rasterising needs a browser. If one is not installed the PNGs are left alone
 * with a warning — the build must never fail because of an icon.
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
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

/**
 * Where the artwork lives. The first file that exists wins, so the logo can be
 * replaced by dropping a new PNG in the repository root.
 */
const CROWN_SOURCES = [
  process.env.AG_CROWN_SOURCE,
  resolve(ROOT, '..', 'Absolute Genesis Neon Crown Logo.png'),
  resolve(ROOT, '..', 'logo.png'),
  resolve(BRAND, 'ag-crown-source.png'),
];

/** The crop of the artwork that is the AG monogram with its crown. */
const CROWN_MARK = {x: 250, y: 30, w: 1080, h: 570};
/** The crop that is the whole lockup, wordmark and all. */
const CROWN_LOCKUP = {x: 0, y: 0, w: 1536, h: 1024};

/**
 * The files the crown is written out as.
 *
 * The artwork is photographic — spiky neon on black — so PNG is a poor fit:
 * the mark alone is 340KB as PNG and 60KB as WebP. The in-app logo is
 * therefore WebP; the app icons stay PNG, because launchers and the iOS home
 * screen are happier with it.
 */
const CROWN_FILES = [
  {file: 'ag-crown-mark.webp', width: 640},
  {file: 'ag-crown-lockup.webp', width: 720},
  {file: 'ag-crown-192.png', size: 192, inset: 0.86, plate: false},
  {file: 'ag-crown-512.png', size: 512, inset: 0.86, plate: false},
  {file: 'ag-crown-apple-touch-180.png', size: 180, inset: 0.8, plate: true},
  // Maskable icons are cropped to a circle on some launchers: the mark sits
  // well inside the safe zone, on the brand's own violet.
  {file: 'ag-crown-maskable-512.png', size: 512, inset: 0.58, plate: true},
];

/** The social card — the one image that has to survive every platform. */
const OG = {file: 'ag-crown-og.jpg', width: 1200, height: 630};

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

/* ---------------------------------------------------------------- the crown */

/** The artwork to build the logo from, if the repository has one. */
function findCrownSource() {
  for (const candidate of CROWN_SOURCES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Knock the artwork's flat background out and cut it into the parts the app
 * uses. Done in the browser because that is where the canvas lives.
 */
async function cutCrown(page, source) {
  const base64 = readFileSync(source).toString('base64');
  return page.evaluate(
    async ({base64, mark, lockup}) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + base64;
      await img.decode();
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d', {willReadFrequently: true});
      ctx.drawImage(img, 0, 0);
      const image = ctx.getImageData(0, 0, W, H);
      const pixels = image.data;

      /* The artwork sits on flat black. Flood it inwards from the border, so
         only the background goes and the dark parts of the artwork stay. */
      const THRESHOLD = 42;
      const background = new Uint8Array(W * H);
      const stack = [];
      const visit = (x, y) => {
        const index = y * W + x;
        if (background[index]) return;
        const at = index * 4;
        if (pixels[at] > THRESHOLD || pixels[at + 1] > THRESHOLD || pixels[at + 2] > THRESHOLD) return;
        background[index] = 1;
        stack.push(index);
      };
      for (let x = 0; x < W; x += 1) {
        visit(x, 0);
        visit(x, H - 1);
      }
      for (let y = 0; y < H; y += 1) {
        visit(0, y);
        visit(W - 1, y);
      }
      while (stack.length) {
        const index = stack.pop();
        const x = index % W;
        const y = (index / W) | 0;
        if (x > 0) visit(x - 1, y);
        if (x < W - 1) visit(x + 1, y);
        if (y > 0) visit(x, y - 1);
        if (y < H - 1) visit(x, y + 1);
      }
      for (let index = 0; index < W * H; index += 1) {
        if (background[index]) pixels[index * 4 + 3] = 0;
      }
      ctx.putImageData(image, 0, 0);

      const cut = (box, width, type = 'image/png', quality) => {
        const out = document.createElement('canvas');
        const height = Math.round((box.h / box.w) * width);
        out.width = width;
        out.height = height;
        const g = out.getContext('2d');
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        /* The crop is written in the artwork's own coordinates, but the source
           may not be exactly the size the crop was measured against. */
        const scale = W / 1536;
        const sx = box.x * scale;
        const sy = box.y * scale;
        const sw = box.w * scale;
        const sh = box.h * scale;
        g.drawImage(canvas, sx, sy, sw, sh, 0, 0, width, height);
        return out.toDataURL(type, quality);
      };

      return {
        mark: cut(mark, 640, 'image/webp', 0.92),
        markPng: cut(mark, 640),
        lockup: cut(lockup, 720, 'image/webp', 0.92),
      };
    },
    {base64, mark: CROWN_MARK, lockup: CROWN_LOCKUP},
  );
}

/** Write a data URL out as a PNG. */
function writePng(file, dataUrl) {
  writeFileSync(resolve(BRAND, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
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

    await buildCrown(browser);
  } finally {
    await browser.close();
  }
  return true;
}

/** Build the logo — the Neon Crown — from the artwork in the repository. */
async function buildCrown(browser) {
  const source = findCrownSource();
  if (!source) {
    console.warn('[brand] no crown artwork found — the vector sigil stays the logo.');
    return;
  }
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  const cut = await cutCrown(page, source);
  await page.close();

  writePng('ag-crown-mark.webp', cut.mark);
  writePng('ag-crown-lockup.webp', cut.lockup);
  console.log('[brand] ag-crown-mark.webp / ag-crown-lockup.webp written');

  for (const icon of CROWN_FILES) {
    if (!icon.size) continue;
    const shot = await browser.newPage({viewport: {width: icon.size, height: icon.size}, deviceScaleFactor: 1});
    const plate = icon.plate
      ? `<div style="position:absolute;inset:0;background:linear-gradient(160deg,#2a0f5e 0%,#120630 100%);display:grid;place-items:center">
           <img src="${cut.markPng}" style="width:${Math.round(icon.inset * 100)}%;height:auto"/>
         </div>`
      : `<div style="position:absolute;inset:0;display:grid;place-items:center">
           <img src="${cut.markPng}" style="width:${Math.round(icon.inset * 100)}%;height:auto"/>
         </div>`;
    await shot.setContent(
      `<!doctype html><html><body style="margin:0;width:${icon.size}px;height:${icon.size}px;overflow:hidden;background:${
        icon.plate ? '#150734' : 'transparent'
      }">${plate}</body></html>`,
    );
    await shot.waitForTimeout(120);
    await shot.screenshot({path: resolve(BRAND, icon.file), omitBackground: !icon.plate});
    await shot.close();
    console.log(`[brand] ${icon.file} (${icon.size}px)`);
  }

  /* The social card: the mark on the brand's violet, at the size every
     platform asks for. */
  const card = await browser.newPage({viewport: {width: OG.width, height: OG.height}, deviceScaleFactor: 1});
  await card.setContent(
    `<!doctype html><html><body style="margin:0;width:${OG.width}px;height:${OG.height}px;overflow:hidden;background:radial-gradient(60% 60% at 50% 40%,#2a0f5e 0%,#120630 55%,#08030f 100%);display:grid;place-items:center">
       <img src="${cut.markPng}" style="width:62%;height:auto"/>
     </body></html>`,
  );
  await card.waitForTimeout(150);
  const card64 = await card.screenshot({type: 'jpeg', quality: 88});
  await card.close();
  writeFileSync(resolve(BRAND, OG.file), card64);
  console.log(`[brand] ${OG.file} (${OG.width}x${OG.height})`);
}

/* -------------------------------------------------------------------- main */

mkdirSync(BRAND, {recursive: true});
const svg = await buildSvg();
writeFileSync(SIGIL, svg, 'utf8');
console.log('[brand] public/brand/ag-sigil.svg written');
await rasterise(svg);
