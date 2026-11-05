import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {JSDOM} from 'jsdom';

const source = readFileSync(new URL('../src/lib/prefs.ts', import.meta.url), 'utf8');
const {outputText} = ts.transpileModule(source, {
  compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022},
});
const prefs = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

function browser(mobile = false) {
  const dom = new JSDOM('', {url: 'https://example.test'});
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  window.matchMedia = () => ({matches: mobile});
  return dom;
}

for (const mobile of [false, true]) {
  const dom = browser(mobile);
  assert.equal(prefs.currentFont(), 'arsenica-sans');
  prefs.applyFont(prefs.currentFont(), false);
  assert.equal(document.documentElement.dataset.font, 'arsenica-sans');
  for (const property of ['--font-sans', '--font-display']) {
    assert.match(document.documentElement.style.getPropertyValue(property), /^'Arsenica Sans'/);
  }
  assert.equal(window.localStorage.getItem('arena.font.v7'), null, 'boot must not persist a default');
  window.localStorage.setItem('arena.font.v7', 'unknown');
  assert.equal(prefs.currentFont(), 'arsenica-sans');
  dom.window.close();
}

for (const font of prefs.FONTS) {
  const dom = browser();
  prefs.applyFont(font.id);
  assert.equal(prefs.currentFont(), font.id, `saved ${font.id} should win`);
  assert.equal(document.documentElement.dataset.font, font.id);
  dom.window.close();
}

for (const key of ['arena.font.v6', 'arena.font.v5', 'arena.font.v4']) {
  const dom = browser();
  window.localStorage.setItem(key, 'helvetica-oblique');
  assert.equal(prefs.currentFont(), 'helvetica-oblique');
  assert.equal(window.localStorage.getItem('arena.font.v7'), 'helvetica-oblique');
  prefs.applyFont('arsenica-sans');
  assert.equal(prefs.currentFont(), 'arsenica-sans');
  dom.window.close();
}

const dom = browser();
Object.defineProperty(window, 'localStorage', {get() { throw new Error('Storage disabled'); }});
assert.equal(prefs.currentFont(), 'arsenica-sans');
assert.doesNotThrow(() => prefs.applyFont('arsenica-sans'));
dom.window.close();
console.log('Font checks passed: desktop/mobile defaults, CSS variables, saved choices, legacy migration and disabled storage.');
