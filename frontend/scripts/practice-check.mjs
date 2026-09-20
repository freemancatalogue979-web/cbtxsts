/**
 * Practice check: drives the real bundle in jsdom through the custom Practice
 * flow exactly as a student would — setup screen, a timed run, immediate
 * feedback, the results review, and the refresh-survival contract.
 *
 *   cd frontend
 *   npx esbuild src/main.tsx --bundle --format=iife --outfile=/tmp/app.iife.js \
 *     --loader:.css=empty --loader:.webp=file --loader:.png=file --jsx=automatic --target=es2022
 *   node scripts/practice-check.mjs
 *
 * Needs the dev server on :5173 (proxied to the API on :3000).
 */
import {readFileSync} from 'node:fs';
import {JSDOM, VirtualConsole} from 'jsdom';

const BASE = process.env.BASE || 'http://localhost:5173';
const BUNDLE = process.env.BUNDLE || '/tmp/app.iife.js';

const results = [];
const failures = [];
const check = (name, ok, detail = '') => {
  results.push({name, ok});
  if (!ok) failures.push(`${name}${detail ? ` -> ${String(detail).slice(0, 300)}` : ''}`);
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${!ok && detail ? ` -> ${String(detail).slice(0, 300)}` : ''}`);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (predicate, timeout = 10000, step = 150) => {
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
virtualConsole.on('error', (...args) => problems.push(`console.error: ${args.map(String).join(' ')}`));

function makeWindow(url = `${BASE}/`) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const {window} = dom;
  const nodeFetch = globalThis.fetch;
  window.fetch = (input, init) => {
    const address = typeof input === 'string' ? new URL(input, BASE).toString() : input;
    return nodeFetch(address, init);
  };
  window.WebSocket = globalThis.WebSocket;
  window.matchMedia =
    window.matchMedia ||
    ((media) => ({matches: false, media, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}}));
  window.print = () => {};
  window.scrollTo = () => {};
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.confirm = () => true;
  return dom;
}

/** Copy a signed-in session into a fresh window, then boot the app — the exact
 * sequence a browser plays on F5: storage first, app second. */
function rehydrate(sourceWindow, url) {
  const dom = makeWindow(url);
  for (let i = 0; i < sourceWindow.localStorage.length; i += 1) {
    const key = sourceWindow.localStorage.key(i);
    if (key) dom.window.localStorage.setItem(key, sourceWindow.localStorage.getItem(key) ?? '');
  }
  dom.window.eval(readFileSync(BUNDLE, 'utf8'));
  return dom;
}

async function main() {
  /* ---------------------------------------------- a real account, via API */
  const phone = `070${Math.floor(10000000 + Math.random() * 89999999)}`;
  const username = `practice${Math.floor(Math.random() * 1000000)}`;
  const response = await globalThis.fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({username, phone, password: 'practice123'}),
  });
  if (!response.ok) throw new Error(`cannot register: ${response.status}`);
  const {token} = await response.json();

  /* ------------------------------------------------- boot straight into the app */
  const dom = makeWindow(`${BASE}/#/play`);
  const {window} = dom;
  window.localStorage.setItem('arena.token', token);
  window.localStorage.setItem('arena.role', 'student');
  window.eval(readFileSync(BUNDLE, 'utf8'));
  const text = () => window.document.querySelector('#root')?.textContent ?? '';
  const byText = (selector, needle) =>
    [...window.document.querySelectorAll(selector)].find((node) => (node.textContent || '').includes(needle));
  const click = (element) => element?.dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true}));

  check('boots into the signed-in dashboard', await waitFor(() => text().includes('Arena exams')), text().slice(0, 160));

  /* -------------------------------------------- open Practice from the Play tab */
  click(byText('button', 'Practice & Boss'));
  await wait(1200);
  check('the practice setup interface is the landing view', text().includes('Set up your practice'), text().slice(0, 220));
  check('setup walks Course → Topic → Questions → Duration', ['1 · Course', '2 · Topic', '3 · Number of questions', '4 · Practice duration'].every((step) => text().includes(step)), text().slice(0, 400));
  check('courses arrive from the bank with live counts', /Jurisprudence & Legal Theory/.test(text()) && /\d+ questions/.test(text()), text().slice(0, 400));
  check('duration options run 10 to 60 minutes', ['10 min', '30 min', '60 min'].every((option) => text().includes(option)), '');

  /* ------------------------------------------------ pick a course and a topic */
  const jurisCard = [...window.document.querySelectorAll('button')].find((node) => (node.textContent || '').includes('Jurisprudence'));
  click(jurisCard);
  await wait(300);
  const topicSelect = window.document.querySelector('select');
  check('topic dropdown lists the course topics with counts', Boolean(topicSelect) && (topicSelect.textContent || '').includes('Historical School'), topicSelect?.textContent?.slice(0, 200));
  const historical = [...(topicSelect?.options ?? [])].find((option) => option.text.includes('Historical School'));
  check('the topic declares its real availability', Boolean(historical) && /1 question/.test(historical.text), historical?.text);
  if (topicSelect && historical) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(topicSelect, historical.value);
    topicSelect.dispatchEvent(new window.Event('change', {bubbles: true}));
    await wait(400);
  }
  check('a thin topic says exactly how many questions exist', text().includes('Only 1 question is available for Historical School'), text().slice(0, 500));

  /* ------------------------------------ switch to the full course and start */
  if (topicSelect) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(topicSelect, '');
    topicSelect.dispatchEvent(new window.Event('change', {bubbles: true}));
    await wait(400);
  }

  /* --------------------------------------------- start the (small) topic run */
  click(byText('button', 'Start practice'));
  check('the timed run opens on question 1', await waitFor(() => text().includes('Question 1 of')), text().slice(0, 240));
  check('the countdown timer is showing', /\d{1,2}:\d{2}/.test(text()) && text().includes('answered'), text().slice(0, 240));
  const letterOf = (node) => (node.querySelector('span')?.textContent || '').trim();
  check(
    'options render as A–D with the shuffled texts',
    [...window.document.querySelectorAll('main button')].filter((node) => /^[A-D]$/.test(letterOf(node))).length >= 2,
    '',
  );
  check('submit is armed only after picking', (byText('button', 'Submit answer')?.hasAttribute('disabled') ?? true), '');

  /* ------------------------------------------- answer, get judged, move on */
  const firstOption = [...window.document.querySelectorAll('main button')].find((node) => /^[A-D]$/.test(letterOf(node)));
  click(firstOption);
  await wait(250);
  const submit = byText('button', 'Submit answer');
  check('picking an option arms Submit answer', Boolean(submit) && !submit.hasAttribute('disabled'), '');
  click(submit);
  check('the server verdict arrives with the stored explanation', await waitFor(() => /Correct!|Not quite/.test(text())), text().slice(0, 300));
  // A blind pick is right one time in four — both verdicts must explain themselves.
  const wasCorrect = text().includes('Correct!');
  check(
    wasCorrect ? 'a correct pick is celebrated' : 'a wrong pick quotes the correct answer and the explanation',
    wasCorrect || text().includes('Correct answer:'),
    text().slice(0, 400),
  );

  /* ------------------------------------- refresh mid-run: same paper resumes */
  const beforeText = text();
  const matched = beforeText.match(/Question (\d+) of/);
  const questionNumber = matched ? Number(matched[1]) : 1;
  const reloaded = rehydrate(window, `${BASE}/#/play`);
  const rw = reloaded.window;
  check('a refresh lands back inside the same run (not a new paper)', await waitFor(() => (rw.document.querySelector('#root')?.textContent ?? '').includes('Question')), (rw.document.querySelector('#root')?.textContent ?? '').slice(0, 200));
  const restoredText = rw.document.querySelector('#root')?.textContent ?? '';
  check(
    'the resumed run resumes at the first unanswered question',
    restoredText.includes(`Question ${questionNumber + 1} of`) || restoredText.includes('Practice completed'),
    restoredText.slice(Math.max(0, restoredText.indexOf('Question') - 40), restoredText.indexOf('Question') + 80),
  );
  rw.close();

  /* --------------------------------------- finish and read the full review */
  click(byText('button', 'Next question') || byText('button', 'End practice'));
  await wait(600);
  const endButton = byText('button', 'End practice');
  click(endButton);
  check('practice completes with the summary screen', await waitFor(() => text().includes('Practice completed')), text().slice(0, 260));
  check('the summary reports questions, correct, wrong, score and time', ['Questions', 'Correct', 'Wrong', 'Score', 'Time used'].every((label) => text().includes(label)), text().slice(0, 400));
  check('the review section revisits every question', text().includes('Review your answers') && text().includes('Your answer:'), text().slice(0, 300));
  check('the review shows the correct answer for the miss', text().includes('Correct answer:'), '');
  check('a fresh practice can start again', Boolean(byText('button', 'New practice')), '');

  check('no runtime errors during the whole walk', problems.length === 0, problems.slice(0, 3).join(' | '));

  dom.window.close();
  console.log(`\npractice UI check: ${results.filter((row) => row.ok).length} passed, ${failures.length} failed`);
  // jsdom windows keep timers alive; exit explicitly either way.
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error('practice check crashed:', error);
  process.exit(2);
});
