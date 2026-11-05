#!/usr/bin/env node
/**
 * Mobile visual audit. Requires the app to be running (`./start-arena.sh`).
 * Saves full-page evidence and fails on horizontal overflow or controls/cards
 * escaping the viewport. Run after any shell/card/admin CSS change.
 */
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const base = process.env.VISUAL_BASE_URL || 'http://127.0.0.1:5173';
const out = new URL('../test-results/visual/', import.meta.url);
const shot = (name) => fileURLToPath(new URL(name, out));
await mkdir(out, {recursive: true});

async function post(path, body) {
  const response = await fetch(`${base}${path}`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function studentSession() {
  try {
    return await post('/api/auth/register', {username: 'visualaudit', phone: '08030009991', password: 'visual-audit-pass', display_name: 'Visual Audit'});
  } catch {
    return post('/api/auth/student', {identifier: 'visualaudit', password: 'visual-audit-pass'});
  }
}

async function install(page, session, mode = 'pro', skin = 'day') {
  await page.addInitScript(({session, mode, skin}) => {
    localStorage.setItem('arena.token', session.token);
    localStorage.setItem('arena.role', session.role);
    localStorage.setItem(`arena.slot.${session.role}`, session.token);
    localStorage.setItem('arena.mode', mode);
    localStorage.setItem('arena.skin', skin);
    localStorage.setItem('arena.pro.onboarding.v1', 'done');
  }, {session, mode, skin});
}

async function assertContained(page, label) {
  await page.waitForTimeout(450);
  const result = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll('main section, main article, main table, [role="dialog"], .pro-card, .card')]
      .map((node) => ({node, rect: node.getBoundingClientRect()}))
      .filter(({rect}) => rect.width > 0 && (rect.left < -2 || rect.right > width + 2))
      .slice(0, 12)
      .map(({node, rect}) => ({tag: node.tagName, class: String(node.className).slice(0, 100), left: Math.round(rect.left), right: Math.round(rect.right), width}));
    return {pageWidth: document.documentElement.scrollWidth, viewport: width, offenders};
  });
  if (result.pageWidth > result.viewport + 2 || result.offenders.length) {
    throw new Error(`${label} overflows: ${JSON.stringify(result)}`);
  }
}

const browserOptions = {headless: true};
if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
  browserOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (process.env.PLAYWRIGHT_CHROMIUM_ARGS) {
    browserOptions.args = JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS);
  }
}
const browser = await chromium.launch(browserOptions);
try {
  const student = await studentSession();

  // A genuinely fresh install must start in daylight and select the shared default
  // font without persisting an automatic choice over the user's later pick.
  for (const viewport of [{name: 'fresh-phone', width: 390, height: 844}, {name: 'fresh-desktop', width: 1280, height: 800}]) {
    const page = await browser.newPage({viewport: {width: viewport.width, height: viewport.height}});
    await page.addInitScript(({session}) => {
      localStorage.setItem('arena.token', session.token);
      localStorage.setItem('arena.role', session.role);
      localStorage.setItem(`arena.slot.${session.role}`, session.token);
      localStorage.setItem('arena.mode', 'normal');
      localStorage.removeItem('arena.skin');
      localStorage.removeItem('arena.font.v7');
      localStorage.removeItem('arena.font.v6');
    }, {session: student});
    await page.goto(base, {waitUntil: 'networkidle'});
    const defaults = await page.evaluate(() => ({
      skin: document.documentElement.dataset.skin,
      font: document.documentElement.dataset.font,
      mode: document.documentElement.dataset.mode,
      storedFont: localStorage.getItem('arena.font.v7'),
    }));
    const expectedFont = 'arsenica-sans';
    if (defaults.skin !== 'day' || defaults.font !== expectedFont || defaults.storedFont !== null) {
      throw new Error(`${viewport.name} defaults are wrong: ${JSON.stringify(defaults)}`);
    }
    await page.close();
  }

  const pickedFontPage = await browser.newPage({viewport: {width: 390, height: 844}});
  await pickedFontPage.addInitScript(({session}) => {
    localStorage.setItem('arena.token', session.token);
    localStorage.setItem('arena.role', session.role);
    localStorage.setItem(`arena.slot.${session.role}`, session.token);
    localStorage.setItem('arena.font.v7', 'montserrat');
  }, {session: student});
  await pickedFontPage.goto(base, {waitUntil: 'networkidle'});
  const pickedFont = await pickedFontPage.evaluate(() => document.documentElement.dataset.font);
  if (pickedFont !== 'montserrat') throw new Error(`A player-selected font was overwritten: ${pickedFont}`);
  await pickedFontPage.close();

  for (const viewport of [{name: 'phone-320', width: 320, height: 720}, {name: 'phone-390', width: 390, height: 844}, {name: 'tablet', width: 768, height: 1024}]) {
    const page = await browser.newPage({viewport});
    await install(page, student);
    await page.goto(base, {waitUntil: 'networkidle'});
    await assertContained(page, `${viewport.name} dashboard`);
    await page.screenshot({path: shot(`${viewport.name}-pro-dashboard.png`), fullPage: true});

    for (const destination of ['Study', 'Exams', 'AI']) {
      const button = page.getByRole('button', {name: destination, exact: true}).last();
      if (await button.count()) {
        await button.click();
        await assertContained(page, `${viewport.name} ${destination}`);
        await page.screenshot({path: shot(`${viewport.name}-pro-${destination.toLowerCase()}.png`), fullPage: true});
      }
    }
    await page.close();
  }

  // Daylight regressions: custom gradient surfaces bypass the token remapping,
  // so exercise the Study Lab and World Map cards explicitly at phone width.
  for (const view of [
    {tab: 'study', name: 'Study Lab', marker: 'Training ground', surface: '.study-hero'},
    {tab: 'map', name: 'World map', marker: 'Expedition atlas', surface: '.wm-hero'},
  ]) {
    const dayPage = await browser.newPage({viewport: {width: 390, height: 844}});
    await install(dayPage, student, 'game', 'day');
    await dayPage.goto(`${base}/#/${view.tab}`, {waitUntil: 'networkidle'});
    await dayPage.getByText(view.marker, {exact: true}).waitFor({state: 'visible', timeout: 15_000});
    await assertContained(dayPage, `day ${view.name}`);
    const appearance = await dayPage.locator(view.surface).evaluate((node) => {
      const style = getComputedStyle(node);
      const title = node.querySelector('h1');
      return {
        skin: document.documentElement.dataset.skin,
        background: style.backgroundImage,
        titleColor: title ? getComputedStyle(title).color : '',
      };
    });
    if (appearance.skin !== 'day' || !appearance.background.includes('rgb(255, 255, 255)') || appearance.titleColor === 'rgb(255, 255, 255)') {
      throw new Error(`${view.name} did not render as readable daylight paper: ${JSON.stringify(appearance)}`);
    }
    await dayPage.screenshot({path: shot(`phone-390-day-${view.tab}.png`), fullPage: true});
    await dayPage.close();
  }

  // A stalled PWA bootstrap must release the splash instead of hanging forever.
  const bootPage = await browser.newPage({viewport: {width: 390, height: 844}});
  await bootPage.addInitScript(() => {
    const onlineFetch = window.fetch.bind(window);
    window.fetch = (input, init) => String(input).includes('/api/bootstrap') ? new Promise(() => {}) : onlineFetch(input, init);
  });
  await bootPage.goto(base, {waitUntil: 'domcontentloaded'});
  await bootPage.locator('.ag-splash').waitFor({state: 'hidden', timeout: 10_000});
  await bootPage.close();

  const admin = await post('/api/auth/admin', {email: process.env.CBT_ADMIN_EMAIL || 'admin@quizarena.ng', password: process.env.CBT_ADMIN_PASSWORD || 'arena2026'});
  const adminPage = await browser.newPage({viewport: {width: 390, height: 844}});
  await install(adminPage, admin, 'game');
  await adminPage.goto(base, {waitUntil: 'networkidle'});
  await adminPage.getByText('Command centre', {exact: true}).waitFor({state: 'visible', timeout: 15_000});
  await assertContained(adminPage, 'admin phone');
  await adminPage.screenshot({path: shot('phone-390-admin.png'), fullPage: true});
  await adminPage.close();

  console.log(`Visual audit passed. Screenshots: ${out.pathname}`);
} finally {
  await browser.close();
}
