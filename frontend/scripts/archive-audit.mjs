#!/usr/bin/env node
/** Live regression audit. Uses throwaway accounts/rooms; run only on a test DB.
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE optionally points at a system Chromium.
 */
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const base = process.env.VISUAL_BASE_URL || 'http://127.0.0.1:5173';
const out = new URL('../test-results/archive/', import.meta.url);
await mkdir(out, {recursive: true});
const errors = [];
const options = {headless: true};
if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) options.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (process.env.PLAYWRIGHT_CHROMIUM_ARGS) options.args = JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS);
const browser = await chromium.launch(options);

async function api(path, session, body) {
  const res = await fetch(`${base}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {'content-type': 'application/json', ...(session ? {authorization: `Bearer ${session.token}`} : {})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  assert.ok(res.ok, `${path}: ${res.status} ${!res.ok ? await res.text() : ''}`);
  return res.json();
}
async function account(index) {
  const suffix = `${Date.now().toString().slice(-8)}${index}`;
  return api('/auth/register', null, {username: `arch${suffix}`, phone: `08${suffix}`, password: 'archive-check-pass', display_name: `Archive Player ${index}`});
}
async function pageFor(session, width = 390, height = 844, skin = 'day') {
  const page = await browser.newPage({viewport: {width, height}, serviceWorkers: 'block'});
  page.on('pageerror', (error) => errors.push(error.message));
  if (session) await page.addInitScript(({session, skin}) => {
    localStorage.setItem('arena.token', session.token);
    localStorage.setItem('arena.role', 'student');
    localStorage.setItem('arena.slot.student', session.token);
    localStorage.setItem('arena.mode', 'normal');
    localStorage.setItem('arena.skin', skin);
    localStorage.setItem('arena.music', 'off');
    localStorage.setItem('arena.sound', 'off');
  }, {session, skin});
  return page;
}
async function contained(page, label) {
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  assert.ok(widths[0] <= widths[1] + 2, `${label}: horizontal overflow ${widths}`);
}
async function shot(page, name) {
  await page.screenshot({path: fileURLToPath(new URL(`${name}.png`, out)), fullPage: true});
}
async function eventually(task, predicate, label, timeout = 10000) {
  const start = Date.now();
  do {
    const value = await task();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() - start < timeout);
  throw new Error(`Timed out: ${label}`);
}

try {
  const host = await account(1), guest = await account(2);
  // Profile stays contained and scrollable at phone/tablet/desktop widths.
  for (const [width, height] of [[320,720], [390,844], [768,1024], [1280,800]]) {
    for (const skin of ['day', 'night']) {
      const page = await pageFor(host, width, height, skin);
      await page.goto(base, {waitUntil: 'networkidle'});
      await page.evaluate((id) => window.dispatchEvent(new CustomEvent('ag:player', {detail: {id}})), guest.profile.id);
      const dialog = page.getByRole('dialog', {name: /Public profile/});
      await dialog.waitFor();
      await dialog.getByText('Overall rank', {exact: true}).waitFor();
      await contained(page, `profile ${width} ${skin}`);
      const card = dialog.locator('.profile-showcase');
      const scroll = await card.evaluate((node) => {
        const overflow = node.scrollHeight > node.clientHeight;
        node.scrollTop = node.scrollHeight;
        return {overflow, top: node.scrollTop, bottom: node.getBoundingClientRect().bottom, height: innerHeight};
      });
      assert.ok(scroll.bottom <= scroll.height + 2, 'profile extends below viewport');
      if (scroll.overflow) assert.ok(scroll.top > 0, 'profile cannot scroll');
      await card.evaluate((node) => { node.scrollTop = 0; });
      await page.screenshot({path: fileURLToPath(new URL(`profile-${width}-${skin}.png`, out))});
      await page.keyboard.press('Escape');
      assert.equal(await dialog.count(), 0, 'Escape should close the profile');
      await page.close();
    }
  }
  console.log('Profile: 8 viewport/skin combinations passed.');

  // Host + guest both recover their own private question, then the server
  // advances/finishes without a single host next/reveal action.
  const {room} = await api('/rooms', host, {title: 'Archive regression race', question_count: 3, per_question_seconds: 10});
  await api(`/rooms/join/${room.code}`, guest, {});
  const hostPage = await pageFor(host), guestPage = await pageFor(guest);
  await Promise.all([hostPage.goto(`${base}/#/room/${room.id}`), guestPage.goto(`${base}/#/room/${room.id}`)]);
  await hostPage.getByRole('button', {name: 'Start the room', exact: true}).click();
  await guestPage.getByLabel('Live race standings').waitFor();
  for (const action of ['next', 'reveal']) {
    const blocked = await fetch(`${base}/api/rooms/${room.id}/${action}`, {method: 'POST', headers: {authorization: `Bearer ${host.token}`}});
    assert.equal(blocked.status, 409, 'legacy host actions must not race automatic pacing');
  }
  assert.equal(await hostPage.getByRole('button', {name: /Next question|Reveal now|Skip \+ next/}).count(), 0);
  for (let round = 0; round < 3; round++) {
    const hs = await eventually(() => api(`/rooms/${room.id}`, host), (d) => d.question?.index === round && !d.reveal, `host round ${round}`);
    const gs = await eventually(() => api(`/rooms/${room.id}`, guest), (d) => d.question?.index === round && !d.reveal, `guest round ${round}`);
    assert.notEqual(hs.question.question.id, gs.question.question.id, 'private sets must differ');
    assert.equal(hs.question.question.correct, undefined, 'answer key leaked before reveal');
    await guestPage.getByText(gs.question.question.text, {exact: true}).waitFor();
    await Promise.all([api(`/rooms/${room.id}/answer`, host, {selected:'A',elapsed_ms:100}), api(`/rooms/${room.id}/answer`, guest, {selected:'A',elapsed_ms:100})]);
    await eventually(() => api(`/rooms/${room.id}`, guest), (d) => Boolean(d.reveal), 'reveal after everyone answers');
    if (round === 0) {
      await guestPage.reload();
      await guestPage.getByText(gs.question.question.text, {exact: true}).waitFor();
      await shot(guestPage, 'guest-race-recovery');
      await contained(guestPage, 'race');
    }
  }
  await eventually(() => api(`/rooms/${room.id}`, guest), (d) => d.room.status === 'finished' && d.finish, 'automatic finish');
  await guestPage.getByText('Final standings', {exact: true}).waitFor();
  await guestPage.reload();
  await guestPage.getByText('Final standings', {exact: true}).waitFor();
  await shot(guestPage, 'race-finished-reloaded');
  await hostPage.close(); await guestPage.close();
  console.log('Room: private questions, reload, automatic reveals/next/finish passed.');

  // Ranked feedback and the selection lock survive an actual browser reload.
  for (const player of [host, guest]) {
    await api('/ranked/lobby', player, {team_size: 1, course_id: null});
    await api('/ranked/lobby/ready', player, {ready: true});
  }
  await api('/ranked/lobby/find', host, {});
  const paired = await api('/ranked/lobby/find', guest, {});
  assert(paired.match_id, 'ranked opponents were not paired');
  const matchId = paired.match_id;
  const ranked = await eventually(() => api(`/ranked/team-match/${matchId}`, host), (d) => d.current, 'ranked countdown', 20000);
  const board = await api('/ranked/dashboard', host);
  assert.equal(board.active_match_id, matchId, 'launched lobby concealed active match');
  const rankedPage = await pageFor(host);
  await rankedPage.addInitScript(() => localStorage.setItem('arena.ranked.wing', 'teams'));
  await rankedPage.goto(`${base}/#/ranked`);
  const currentQuestion = ranked.current;
  await rankedPage.getByText(currentQuestion.text, {exact: true}).waitFor();
  const chosen = rankedPage.getByRole('button').filter({has: rankedPage.getByText(currentQuestion.options.A, {exact: true})});
  const answered = rankedPage.waitForResponse((response) => response.url().endsWith(`/team-match/${matchId}/answer`) && response.request().method() === 'POST');
  await chosen.click();
  const {result: feedback} = await (await answered).json();
  assert.equal(typeof feedback.correct, 'boolean');
  assert(feedback.correct_answer);
  const feedbackText = feedback.correct ? `Correct · +${feedback.points} pts` : `Key: ${feedback.correct_answer}`;
  await rankedPage.getByText(feedbackText, {exact: true}).waitFor();
  assert(await chosen.isDisabled(), 'ranked option did not lock');
  const recovered = await api(`/ranked/team-match/${matchId}`, host);
  assert.equal(recovered.you.round_result.selected, 'A');
  assert.equal(recovered.you.round_result.correct_answer, feedback.correct_answer);
  const opponent = await api(`/ranked/team-match/${matchId}`, guest);
  assert.equal(opponent.you.round_result, null, 'opponent received private feedback');
  await rankedPage.reload();
  await rankedPage.getByText(currentQuestion.text, {exact: true}).waitFor();
  await rankedPage.getByText(feedbackText, {exact: true}).waitFor();
  assert(await rankedPage.getByRole('button').filter({has: rankedPage.getByText(currentQuestion.options.A, {exact: true})}).isDisabled());
  await shot(rankedPage, 'ranked-private-feedback');
  await contained(rankedPage, 'ranked feedback');
  await rankedPage.close();
  console.log('Ranked teams: active-match reload, private feedback and selection lock passed.');

  assert.deepEqual(errors, [], `Browser errors: ${errors.join('; ')}`);
  console.log(`Archive browser audit passed. Screenshots: ${out.pathname}`);
} finally {
  await browser.close();
}
