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

async function install(page, session, mode = 'pro') {
  await page.addInitScript(({session, mode}) => {
    localStorage.setItem('arena.token', session.token);
    localStorage.setItem('arena.role', session.role);
    localStorage.setItem(`arena.slot.${session.role}`, session.token);
    localStorage.setItem('arena.mode', mode);
    localStorage.setItem('arena.pro.onboarding.v1', 'done');
  }, {session, mode});
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

const browser = await chromium.launch({headless: true});
try {
  const student = await studentSession();
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

  const admin = await post('/api/auth/admin', {email: process.env.CBT_ADMIN_EMAIL || 'admin@quizarena.ng', password: process.env.CBT_ADMIN_PASSWORD || 'arena2026'});
  const adminPage = await browser.newPage({viewport: {width: 390, height: 844}});
  await install(adminPage, admin, 'game');
  await adminPage.goto(base, {waitUntil: 'networkidle'});
  await assertContained(adminPage, 'admin phone');
  await adminPage.screenshot({path: shot('phone-390-admin.png'), fullPage: true});
  await adminPage.close();

  console.log(`Visual audit passed. Screenshots: ${out.pathname}`);
} finally {
  await browser.close();
}
