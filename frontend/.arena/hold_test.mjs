/**
 * Emulate an iPhone, open a chat thread, hold a message bubble and observe
 * exactly which events fire — to find out why hold-for-options fails on phones.
 */
import {chromium, devices} from 'playwright';

const TOKEN = process.argv[2];
const URL = 'http://localhost:5173/#/friends';

const iphone = devices['iPhone 13'];

const browser = await chromium.launch({args: ['--no-sandbox']});
const context = await browser.newContext({
  ...iphone,
  locale: 'en-US',
});

await context.addInitScript((token) => {
  window.localStorage.setItem('arena.token', token);
  window.localStorage.setItem('arena.role', 'student');
}, TOKEN);

const page = await context.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[console.error]', msg.text().slice(0, 200));
});

await page.goto(URL, {waitUntil: 'domcontentloaded'});
await page.waitForTimeout(2500);
await page.screenshot({path: '/tmp/hold-01-landing.png'});

/* ------------------------------------------------- open the friend thread */
const friendRow = page.locator('button', {hasText: 'Hold Friend'}).first();
if (await friendRow.count()) {
  await friendRow.click();
  await page.waitForTimeout(1200);
}
await page.screenshot({path: '/tmp/hold-02-thread.png'});

/* Instrument every pointer/touch/context event on the message list. */
await page.evaluate(() => {
  const log = (window.__evtLog = []);
  const list = document.querySelector('[class*="overflow-y-auto"]');
  const target = list ?? document.body;
  const kinds = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'contextmenu'];
  for (const kind of kinds) {
    target.addEventListener(kind, (event) => {
      log.push(`${performance.now().toFixed(0)}ms ${kind}${kind === 'contextmenu' ? '' : ` (${event.clientX.toFixed(0)},${event.clientY.toFixed(0)})`}`);
      if (log.length > 300) log.shift();
    }, {capture: true, passive: false});
  }
});

/* Pick a bubble: a paragraph inside the scroll list that mentions "Hold-on-me". */
const bubble = page.locator('p', {hasText: 'Hold-on-me message'}).first();
const box = await bubble.boundingBox();
if (!box) {
  console.log('FATAL: no bubble found');
  console.log(await page.evaluate(() => document.body.innerText.slice(0, 800)));
  process.exit(2);
}
const x = box.x + box.width / 2;
const y = box.y + box.height / 2;
console.log('bubble at', x.toFixed(0), y.toFixed(0), box.width.toFixed(0) + 'x' + box.height.toFixed(0));

/* ------------------------------------------------------- TEST 1: pure hold */
await page.evaluate(() => (window.__evtLog.length = 0));
await page.mouse.move(x, y);
await page.mouse.down();
await page.waitForTimeout(900); // HOLD_MS is 460
const menuVisible = await page.locator('[role="menu"]').count();
console.log('TEST 1 (still hold 900ms): menu visible =', menuVisible > 0);
await page.screenshot({path: '/tmp/hold-03-after-hold.png'});
console.log('events:', (await page.evaluate(() => window.__evtLog)).join(' | '));
await page.mouse.up();
await page.waitForTimeout(400);

/* Close any menu that opened */
if (await page.locator('[role="menu"]').count()) {
  await page.tap('body');
  await page.waitForTimeout(300);
}

/* ------------------------------------------- TEST 2: hold with 2px jitter */
await page.evaluate(() => (window.__evtLog.length = 0));
await page.mouse.move(x, y);
await page.mouse.down();
for (let i = 1; i <= 8; i++) {
  await page.waitForTimeout(90);
  await page.mouse.move(x + (i % 2 === 0 ? 2 : -2), y + (i % 3 === 0 ? 2 : -1));
}
const menuVisible2 = await page.locator('[role="menu"]').count();
console.log('TEST 2 (jitter ±2px over 720ms): menu visible =', menuVisible2 > 0);
console.log('events:', (await page.evaluate(() => window.__evtLog)).join(' | '));
await page.mouse.up();
await page.waitForTimeout(400);
if (await page.locator('[role="menu"]').count()) {
  await page.tap('body');
  await page.waitForTimeout(300);
}

/* --------------------------------------------- TEST 3: native contextmenu */
await page.evaluate(() => (window.__evtLog.length = 0));
await bubble.dispatchEvent('contextmenu', {clientX: x, clientY: y});
await page.waitForTimeout(300);
const menuVisible3 = await page.locator('[role="menu"]').count();
console.log('TEST 3 (synthetic contextmenu): menu visible =', menuVisible3 > 0);
await page.screenshot({path: '/tmp/hold-04-after-contextmenu.png'});

await browser.close();
