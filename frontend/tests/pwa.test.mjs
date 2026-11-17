import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const manifest = JSON.parse(await read("../public/manifest.webmanifest"));
const html = await read("../index.html");
const worker = await read("../pwa/sw-template.js");
const vite = await read("../vite.config.ts");
const pwaSource = await read("../src/lib/pwa.ts");

async function pngSize(path) {
  const buf = await readFile(new URL(path, import.meta.url));
  assert.equal(buf.toString("ascii", 1, 4), "PNG", `${path} is a PNG`);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

async function webpSize(path) {
  const buf = await readFile(new URL(path, import.meta.url));
  assert.equal(buf.toString("ascii", 8, 12), "WEBP", `${path} is a WebP`);
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8 ") return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  if (chunk === "VP8L") { const b = buf.readUInt32LE(21); return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1]; }
  if (chunk === "VP8X") return [buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1];
  throw new Error(`unknown WebP chunk ${chunk}`);
}

test("the manifest makes the hub an installable, full-screen app", () => {
  assert.equal(manifest.short_name, "9 Clover");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.scope, "/");
  assert.ok(manifest.start_url.startsWith("/"), "start_url stays inside the scope");
  assert.equal(manifest.background_color, "#070a12", "launch splash matches the app's ink background");
  assert.equal(manifest.theme_color, "#070a12");
  for (const field of ["name", "short_name", "description"]) assert.doesNotMatch(manifest[field], /\b[A-Z]{3,}\b(?<!MLBB)/, `${field} is not shouted`);
});

test("icons are crisp at every launcher size, including maskable and monochrome", async () => {
  const want = [["any", 192], ["any", 512], ["maskable", 192], ["maskable", 512], ["monochrome", 512]];
  for (const [purpose, size] of want) {
    const icon = manifest.icons.find((i) => i.purpose === purpose && i.sizes === `${size}x${size}`);
    assert.ok(icon, `${purpose} ${size} icon listed`);
    assert.deepEqual(await pngSize(`../public${icon.src}`), [size, size], `${icon.src} is exactly ${size}px (no browser scaling)`);
  }
  assert.deepEqual(await pngSize("../public/brand/apple-touch-icon.png"), [180, 180]);
});

test("store-style screenshots match their declared sizes", async () => {
  assert.deepEqual(manifest.screenshots.map((s) => s.form_factor).sort(), ["narrow", "wide"]);
  for (const shot of manifest.screenshots) {
    const [w, h] = await webpSize(`../public${shot.src}`);
    assert.equal(`${w}x${h}`, shot.sizes, shot.src);
    assert.ok(shot.label);
  }
});

test("shortcuts open real sections of the hub", async () => {
  const nav = await read("../src/lib/nav.ts");
  for (const shortcut of manifest.shortcuts) {
    const id = shortcut.url.split("#/")[1];
    assert.match(nav, new RegExp(`id: "${id}"`), `${shortcut.name} → #/${id} exists`);
  }
});

test("index.html links the manifest and sets up the iOS home-screen app", () => {
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest" \/>/);
  const themes = [...html.matchAll(/name="theme-color" content="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(themes, [manifest.theme_color], "one theme colour, matching the manifest");
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /name="apple-mobile-web-app-status-bar-style" content="black-translucent"/);
  assert.match(html, /name="apple-mobile-web-app-title" content="9 Clover"/);
  assert.match(html, /viewport-fit=cover/);
});

test("the service worker never caches member data and waits for a tap to update", () => {
  assert.match(worker, /const PRIVATE = \/\^\\\/\(api\|live\|ws\)\(\\\/\|\$\)\/;/);
  assert.match(worker, /if \(PRIVATE\.test\(url\.pathname\)\) return;/);
  assert.match(worker, /if \(request\.method !== "GET"\) return;/);
  assert.match(worker, /if \(url\.origin !== self\.location\.origin\) return;/);
  // Activation is driven by the "Reload" button, never automatically on install.
  const install = worker.split('addEventListener("install"')[1].split("});")[0];
  assert.doesNotMatch(install, /skipWaiting/);
  assert.match(worker, /event\.data\.type === "SKIP_WAITING"\) self\.skipWaiting\(\)/);
  // Old caches (including ones from earlier apps on this origin) are removed.
  assert.match(worker, /if \(!KEEP\.has\(name\)\) await caches\.delete\(name\)/);
  assert.match(worker, /"__CLOVER_VERSION__"/);
  assert.match(worker, /__CLOVER_PRECACHE__/);
});

test("the build emits sw.js with this build's hashed files; dev never registers one", () => {
  assert.match(vite, /plugins: \[react\(\), tailwindcss\(\), cloverPwa\(\)\]/);
  assert.match(vite, /apply: 'build'/);
  assert.match(vite, /fileName: 'sw\.js'/);
  assert.match(pwaSource, /if \(!import\.meta\.env\.PROD\) \{\s*navigator\.serviceWorker\.getRegistrations\(\)\.then\(\(all\) => all\.forEach\(\(r\) => r\.unregister\(\)\)\)/);
  assert.match(pwaSource, /navigator\.serviceWorker\.register\("\/sw\.js", \{ scope: "\/" \}\)/);
});

test("iPhone and iPad Safari get Add to Home Screen steps; in-app browsers don't", async () => {
  const { outputText } = ts.transpileModule(pwaSource.replace(/import\.meta\.env\.PROD/g, "false"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  const { isIosSafari } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
  assert.equal(isIosSafari("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", 5), true);
  assert.equal(isIosSafari("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", 5), true, "iPadOS reports as a Mac with touch");
  assert.equal(isIosSafari("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", 0), false, "a real Mac");
  assert.equal(isIosSafari("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36", 5), false);
  assert.equal(isIosSafari("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 350.0", 5), false);
});

test("opening the app with no signal keeps the member signed in", async () => {
  const app = await read("../src/App.tsx");
  const boot = app.split("async function boot()")[1].split("boot();")[0];
  assert.doesNotMatch(boot, /setToken\(null\)/, "only the API client's 401 handling clears the session");
  assert.match(boot, /error instanceof ApiError && error\.status === 401/);
  assert.match(app, /window\.addEventListener\("online", retry\)/);
  assert.match(app, /You're still signed in/);
});

test("nginx always revalidates the worker, manifest and shell", async () => {
  const nginx = await readFile(new URL("../../deploy/setup-server.sh", import.meta.url), "utf8");
  assert.match(nginx, /location = \/sw\.js \{ add_header Cache-Control "no-cache";/);
  assert.match(nginx, /location = \/manifest\.webmanifest \{ default_type application\/manifest\+json; add_header Cache-Control "no-cache";/);
  assert.match(nginx, /location = \/index\.html \{ add_header Cache-Control "no-cache";/);
});
