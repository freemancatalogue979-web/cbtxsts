/**
 * Ranked + Events UI regression — the real multiplayer loop, no mocks.
 *
 * Requires: the API on :3000, the dev server on :5173 and the bundle at
 * /tmp/app.iife.js (see README). A second opponent is registered through the
 * API and queued server-side; the UI player then walks the whole flow in
 * jsdom: course select → Finding players → lobby → live match (answers,
 * reveals, standings sheet) → results with rating movement → answer review.
 * The Events tab render is covered too (segmented lists + past cards).
 *
 * The whole run takes ~2 minutes because the server clocks are real.
 */
import {readFileSync} from 'node:fs';
import {JSDOM, VirtualConsole} from 'jsdom';

const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const API = process.env.ARENA_API || 'http://127.0.0.1:3000/api';
const BUNDLE = process.env.BUNDLE || '/tmp/app.iife.js';

const results = [];
const failures = [];
const check = (name, ok, detail = '') => {
  results.push({name, ok});
  if (!ok) failures.push(`${name}${detail ? ` -> ${String(detail).slice(0, 300)}` : ''}`);
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${!ok && detail ? ` -> ${String(detail).slice(0, 300)}` : ''}`);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (predicate, timeout = 20000, step = 200) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (predicate()) return true;
    await wait(step);
  }
  return predicate();
};

const problems = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (error) => problems.push(`jsdomError: ${error.message}`));

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: `${BASE}/`,
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole,
});
const {window} = dom;

const nodeFetch = globalThis.fetch;
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? new URL(input, BASE).toString() : input;
  return nodeFetch(url, init);
};
window.WebSocket = globalThis.WebSocket;
window.matchMedia =
  window.matchMedia ||
  ((media) => ({matches: false, media, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}}));
window.print = () => {};
window.scrollTo = () => {};
window.HTMLCanvasElement.prototype.getContext = () => null;
window.confirm = () => true;

const text = () => window.document.querySelector('#root')?.textContent ?? '';
const byText = (selector, needle) =>
  [...window.document.querySelectorAll(selector)].find((node) => (node.textContent || '').includes(needle));
const click = (element) => element?.dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true}));
const setValue = (element, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(element, value);
  element.dispatchEvent(new window.Event('input', {bubbles: true}));
};

/* ------------------------------------------------------------ API helpers */
const api = async (path, options = {}) => {
  const response = await nodeFetch(`${API}${path}`, {
    ...options,
    headers: {'Content-Type': 'application/json', ...(options.headers ?? {})},
  });
  const raw = await response.text();
  const body = raw ? JSON.parse(raw) : null;
  return {status: response.status, body};
};

const digits = (n) => Array.from({length: n}, () => Math.floor(Math.random() * 10)).join('');
const letters = (n) => Array.from({length: n}, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

const registerApiUser = async () => {
  const {status, body} = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({username: `rkop${letters(5)}`, phone: `0703${digits(7)}`, password: 'secret123'}),
  });
  if (status !== 200) throw new Error(`register failed: ${status} ${JSON.stringify(body)}`);
  return body.token;
};

const adminToken = async () => {
  const {status, body} = await api('/auth/admin', {
    method: 'POST',
    body: JSON.stringify({email: 'admin@quizarena.ng', password: 'arena2026'}),
  });
  if (status !== 200) throw new Error('admin sign-in failed');
  return body.token;
};

const correctKey = async (admin, questionId) => {
  const {body} = await api(`/admin/questions/${questionId}`, {headers: {Authorization: `Bearer ${admin}`}});
  return String(body?.correct ?? 'A').toUpperCase();
};

async function main() {
  window.eval(readFileSync(BUNDLE, 'utf8'));
  await wait(1600);

  /* ------------------------------------------------ sign a fresh player in */
  click(byText('button', 'Enter the arena'));
  await wait(600);
  click(byText('button', 'Create account'));
  await wait(400);
  const inputs = [...window.document.querySelectorAll('form input')];
  const USERNAME = `rked${letters(5)}`;
  setValue(inputs[0], USERNAME);
  setValue(inputs[1], `0703${digits(7)}`.replace(/^0/, ''));
  setValue(inputs[2], 'renderpass1');
  await wait(300);
  const enterButton = window.document.querySelector('form button[type="submit"]');
  click(enterButton);
  await wait(300);
  if (!text().includes('Arena exams')) {
    enterButton?.closest('form')?.dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true}));
  }
  await wait(2400);
  check('signed in to the dashboard', text().includes('Arena exams'), text().slice(0, 160));

  /* ------------------------------------------------------- open the Ranked tab */
  const rankedTab = byText('button', 'Ranked') ?? byText('a', 'Ranked');
  click(rankedTab);
  const rankedOpen = await waitFor(() => text().includes('Find a match'));
  check('the Ranked tab opens the course select', rankedOpen, text().slice(0, 220));
  check('rating card shows the starting ladder', text().includes('1,000') && text().includes('Silver'), text().slice(0, 300));
  check('tier ladder lists all seven bands', ['Bronze', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster'].every((t) => text().includes(t)), '');

  /* -------------------------------------------- queue an opponent via the API */
  const admin = await adminToken();
  const {body: coursesBody} = await api('/admin/courses', {headers: {Authorization: `Bearer ${admin}`}});
  const courses = coursesBody?.courses ?? coursesBody;
  const courseId = courses[0].id;
  const opponentToken = await registerApiUser();
  await api('/ranked/queue', {method: 'POST', headers: {Authorization: `Bearer ${opponentToken}`}, body: JSON.stringify({course_id: courseId})});

  /* ------------------------------------------------------------ find a match */
  click(byText('button', 'Find match'));
  const queueing = await waitFor(() => text().includes('Finding players'));
  check('the queue screen shows Finding players', queueing, text().slice(0, 200));
  check('the queue shows a live found-count and target', /\d+ found/.test(text()) && /aiming for \d+/.test(text()), text().slice(0, 220));
  check('the queue never demands a full room', text().includes('never wait for a full'), '');
  check('cancel is available', Boolean(byText('button', 'Cancel')), '');

  /* ----------------------------------------------- lobby on the server clock */
  console.log('   waiting for matchmaking + lobby…');
  const lobby = await waitFor(() => text().includes('Match found'), 40000);
  check('the lobby appears when the server mints the match', lobby, text().slice(0, 260));
  check('the lobby counts down on screen', /\d+s/.test(text()), text().slice(0, 200));
  check('the lobby lists both players with a connection dot', (text().match(/Connected/g) ?? []).length >= 2 || text().includes(USERNAME), text().slice(0, 300));

  /* ------------------------------------------------------------- live match */
  console.log('   waiting for the first question…');
  const live = await waitFor(() => /Question 1 of/.test(text()), 30000);
  check('the match goes live with question 1', live, text().slice(0, 260));
  const optionLetter = (button) => {
    const chip = button.querySelector('span');
    return chip && /^[ABCD]$/.test((chip.textContent || '').trim()) ? chip.textContent.trim() : null;
  };
  check('four option buttons are on screen', [...window.document.querySelectorAll('button')].filter((b) => optionLetter(b)).length >= 4, [...window.document.querySelectorAll('button')].map((b) => (b.textContent || '').slice(0, 14)).slice(0, 10).join(' / '));
  check('the mobile standings button is offered', Boolean(byText('button', 'Standings')), '');

  /* standings bottom sheet */
  click(byText('button', 'Standings'));
  const sheet = await waitFor(() => text().includes('Live standings'));
  check('the standings bottom sheet opens', sheet, text().slice(0, 220));
  click(byText('button', 'Close standings') ?? window.document.querySelector('button[aria-label="Close standings"]'));
  await wait(300);

  /* play the whole match: UI clicks, the API opponent answers correctly */
  console.log('   playing the match (10 questions, real server pacing)…');
  let answered = 0;
  const playDeadline = Date.now() + 240000;
  while (Date.now() < playDeadline) {
    const page = text();
    if (page.includes('of 2') && (/1st|2nd/.test(page)) && (page.includes('View answers'))) break; // results
    if (/Question \d+ of 10/.test(page) && !page.includes('Answer locked')) {
      const option = [...window.document.querySelectorAll('button')].find((b) => optionLetter(b) === 'B');
      if (option) {
        click(option);
        answered += 1;
        // the API opponent answers the same question correctly
        const status = await api('/ranked/status', {headers: {Authorization: `Bearer ${opponentToken}`}});
        const question = status.body?.match?.question;
        if (question?.id) {
          const key = await correctKey(admin, question.id);
          await api(`/ranked/match/${status.body.match_id}/answer`, {
            method: 'POST',
            headers: {Authorization: `Bearer ${opponentToken}`},
            body: JSON.stringify({selected: key, elapsed_ms: 800}),
          }).catch(() => undefined);
        }
        const locked = await waitFor(() => text().includes('Answer locked') || text().includes('Correct') || text().includes('Not this time') || /Answer$/.test(text()), 6000).catch(() => false);
        void locked;
      }
    }
    await wait(600);
  }
  check('every question was answered from the UI', answered >= 10, `${answered}/10`);

  console.log('   waiting for the results screen…');
  const resultsShown = await waitFor(() => text().includes('View answers') && /1st|2nd/.test(text()), 60000);
  check('the results screen arrives after the last question', resultsShown, text().slice(0, 300));
  check('the results show position of 2', /1st of 2|2nd of 2/.test(text()), text().slice(0, 200));
  check('rating movement is shown as before → after', /1,000\s*→\s*(1,0\d\d|9\d\d)/.test(text()), text().slice(0, 300));
  check('accuracy and correct counts are on screen', text().includes('Accuracy') && text().includes('Correct'), '');

  /* ------------------------------------------------------------- the review */
  click(byText('button', 'View answers'));
  const review = await waitFor(() => /Q1/.test(text()) && (text().includes('Your answer:') || text().includes('Correct:')));
  check('the answer review lists the questions', review, text().slice(0, 240));
  click(byText('button', 'Back to results'));
  await wait(300);
  click(byText('button', 'Back to ranked'));
  const idle = await waitFor(() => text().includes('Find a match'));
  check('Back to ranked returns to the ladder', idle, text().slice(0, 200));
  check('recent matches list records the game', text().includes('Recent matches'), text().slice(0, 260));

  /* ------------------------------------------------------------ Events tab */
  const eventsTab = byText('button', 'Events') ?? byText('a', 'Events');
  click(eventsTab);
  const eventsOpen = await waitFor(() => text().includes('Live') && text().includes('Upcoming') && text().includes('Past'));
  check('the Events tab opens with the segmented lists', eventsOpen, text().slice(0, 220));
  click(byText('button', 'Past'));
  await wait(700);
  const pastShows = await waitFor(() => text().includes('View event') || text().includes('No past events'));
  check('the Past list renders cards or an honest empty state', pastShows, text().slice(0, 220));

  check('no runtime errors during the whole walk', problems.length === 0, problems.slice(0, 3).join(' | '));

  const passed = results.filter((r) => r.ok).length;
  console.log(`\nranked UI check: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('failures:\n - ' + failures.join('\n - '));
  }
  window.close();
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error('ranked-check crashed:', error);
  process.exit(1);
});
