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
  window.matchMedia = (query) => ({matches: query.includes('min-width') ? !mobile : mobile});
  return dom;
}

for (const mobile of [false, true]) {
  const dom = browser(mobile);
  const expected = mobile ? 'grotesk' : 'courier';
  assert.equal(prefs.currentFont(), expected);
  prefs.applyFont(prefs.currentFont(), false);
  assert.equal(document.documentElement.dataset.font, expected);
  for (const property of ['--font-sans', '--font-display']) {
    assert.match(document.documentElement.style.getPropertyValue(property), mobile ? /^'Space Grotesk Variable'/ : /^Courier/);
  }
  assert.equal(window.localStorage.getItem('arena.font.v8'), null, 'boot must not persist a default');
  window.localStorage.setItem('arena.font.v7', 'unknown');
  assert.equal(prefs.currentFont(), expected);
  dom.window.close();
}

{
  const dom = browser();
  window.localStorage.setItem('arena.font.v7', 'dm-sans');
  assert.equal(prefs.currentFont(), 'courier', 'the old desktop DM Sans default must migrate to Courier');
  dom.window.close();
}
{
  const dom = browser(true);
  window.localStorage.setItem('arena.font.v7', 'dm-sans');
  assert.equal(prefs.currentFont(), 'grotesk', 'the old mobile DM Sans default must migrate to Space Grotesk');
  dom.window.close();
}

for (const font of prefs.FONTS) {
  const dom = browser();
  prefs.applyFont(font.id);
  assert.equal(prefs.currentFont(), font.id, `saved ${font.id} should win`);
  assert.equal(document.documentElement.dataset.font, font.id);
  dom.window.close();
}

for (const key of ['arena.font.v7', 'arena.font.v6', 'arena.font.v5', 'arena.font.v4']) {
  const dom = browser();
  window.localStorage.setItem(key, 'helvetica-oblique');
  assert.equal(prefs.currentFont(), 'helvetica-oblique');
  assert.equal(window.localStorage.getItem('arena.font.v8'), 'helvetica-oblique');
  prefs.applyFont('dm-sans');
  assert.equal(prefs.currentFont(), 'dm-sans');
  dom.window.close();
}

const dom = browser();
Object.defineProperty(window, 'localStorage', {get() { throw new Error('Storage disabled'); }});
assert.equal(prefs.currentFont(), 'courier');
assert.doesNotThrow(() => prefs.applyFont('dm-sans'));
dom.window.close();
console.log('Font checks passed: desktop/mobile defaults, CSS variables, saved choices, legacy migration and disabled storage.');

// The inline first-paint script must not paint the old desktop/mobile defaults.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const inline = html.match(/<script>([\s\S]*?)<\/script>/)[1];
for (const mobile of [false, true]) {
  for (const selected of [null, ...prefs.FONTS.map((font) => font.id)]) {
    const page = new JSDOM('<meta name="theme-color">', {url: 'https://example.test', runScripts: 'outside-only'});
    page.window.matchMedia = () => ({matches: mobile});
    if (selected) page.window.localStorage.setItem('arena.font.v8', selected);
    page.window.eval(inline);
    assert.equal(page.window.document.documentElement.dataset.font, selected || (mobile ? 'grotesk' : 'courier'));
    page.window.close();
  }
}
console.log('First-paint font checks passed for the default and every saved font.');
