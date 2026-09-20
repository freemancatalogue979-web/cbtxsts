/**
 * Deep flow check: drives the real UI bundle in jsdom through a complete exam
 * submission, a live 1v1 duel against a second player (played over REST from
 * Node), and the admin console.
 *
 *   node scripts/flow-check.mjs
 */
import {readFileSync} from 'node:fs';
import {JSDOM, VirtualConsole} from 'jsdom';

const BASE = process.env.BASE || 'http://localhost:5173';
const API = process.env.API || 'http://localhost:3000';
const BUNDLE = process.env.BUNDLE || '/tmp/app.iife.js';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@quizarena.ng';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'arena2026';

const results = [];
const failures = [];
const check = (name, ok, detail = '') => {
  results.push({name, ok});
  if (!ok) failures.push(`${name}${detail ? ` -> ${String(detail).slice(0, 240)}` : ''}`);
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${!ok && detail ? ` -> ${String(detail).slice(0, 240)}` : ''}`);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const problems = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (error) => problems.push(`jsdomError: ${error.message}`));
virtualConsole.on('error', (...args) => problems.push(`console.error: ${args.map(String).join(' ')}`));

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: `${BASE}/`,
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole,
});
const {window} = dom;
const nodeFetch = globalThis.fetch;
window.fetch = (input, init) => nodeFetch(typeof input === 'string' ? new URL(input, BASE).toString() : input, init);
window.WebSocket = globalThis.WebSocket;
window.matchMedia =
  window.matchMedia ||
  ((media) => ({matches: false, media, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}}));
window.print = () => {};
window.scrollTo = () => {};
window.HTMLCanvasElement.prototype.getContext = () => null;
window.confirm = () => true;

const text = () => window.document.querySelector('#root')?.textContent ?? '';
const buttons = (needle) => [...window.document.querySelectorAll('button')].filter((node) => (node.textContent || '').includes(needle));
const byText = (selector, needle) => [...window.document.querySelectorAll(selector)].find((node) => (node.textContent || '').includes(needle));
const click = (element) => element?.dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true}));
const setInput = (element, value) => {
  const proto = element instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement : window.HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(element, value);
  element.dispatchEvent(new window.Event('input', {bubbles: true}));
};
const optionButtons = () =>
  [...window.document.querySelectorAll('main button')].filter((node) => /^[A-D]/.test((node.textContent || '').trim()) && !node.disabled);

/** Plain REST calls used to play the second side of a duel. */
async function apiCall(path, {method = 'GET', body, token} = {}) {
  const response = await nodeFetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? {Authorization: `Bearer ${token}`} : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  return {status: response.status, data: raw ? JSON.parse(raw) : null};
}

async function signInUi(phone) {
  // The landing page is the first view now; hop across to the sign-in screen.
  if (!window.document.querySelector('form input')) {
    click(byText('button', 'Enter the arena'));
    await wait(700);
  }
  // The roster is gone — every player registers a secure account (username + phone + password).
  click(byText('button', 'Create account'));
  await wait(400);
  const inputs = [...window.document.querySelectorAll('form input')];
  const username = `flow${Math.floor(Math.random() * 1000000)}`;
  setInput(inputs[0], username);
  setInput(inputs[1], phone.replace(/^0/, ''));
  setInput(inputs[2], 'flowpass1');
  if (inputs[3]) setInput(inputs[3], 'Flow Player');
  await wait(150);
  const enter = window.document.querySelector('form button[type="submit"]');
  click(enter);
  await wait(250);
  if (!text().includes('Arena exams')) {
    enter?.closest('form')?.dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true}));
  }
  await wait(2200);
  click(byText('button', 'Keep climbing'));
  await wait(400);
}

async function main() {
  const phoneA = `080${Math.floor(10000000 + Math.random() * 89999999)}`;
  const phoneB = `081${Math.floor(10000000 + Math.random() * 89999999)}`;

  window.eval(readFileSync(BUNDLE, 'utf8'));
  await wait(1600);
  await signInUi(phoneA);
  check('player A signed in through the UI', text().includes('Arena exams'), text().slice(0, 140));

  /* ------------------------------------------------- full exam run */
  const shortCard = [...window.document.querySelectorAll('main li')].find((node) => (node.textContent || '').includes('Blitz'));
  const startButton = [...(shortCard ?? window.document).querySelectorAll('button')].find((node) =>
    (node.textContent || '').includes('Start exam'),
  );
  check('an exam is available to start', Boolean(startButton), shortCard ? 'short exam' : 'first exam');
  click(startButton);
  await wait(2500);

  const headerLabel = [...window.document.querySelectorAll('span')]
    .map((node) => (node.textContent || '').trim())
    .find((label) => /^Question \d+ of \d+$/.test(label));
  const total = Number((headerLabel ?? '').split(' of ')[1] ?? 0);
  check('exam engine loaded its questions', total > 0, text().slice(0, 160));

  /* ------------------------------- phone thumb bar + navigator bottom sheet */
  const navToggle = window.document.querySelector('button[aria-label="Open the question navigator"]');
  check('phone thumb bar offers the navigator', Boolean(navToggle), navToggle ? 'found' : 'missing');
  click(navToggle);
  await wait(600);
  const sheet = window.document.querySelector('[aria-label="Question navigator"]');
  const sheetButtons = sheet ? [...sheet.querySelectorAll('button')].filter((node) => /^\d+$/.test((node.textContent || '').trim())) : [];
  check('navigator sheet lists every question', Boolean(sheet) && sheetButtons.length === total, `${sheetButtons.length}/${total}`);
  if (sheetButtons.length > 2) {
    click(sheetButtons[2]);
    await wait(600);
    const jumped = [...window.document.querySelectorAll('span')]
      .map((node) => (node.textContent || '').trim())
      .find((label) => /^Question \d+ of \d+$/.test(label));
    check(
      'tapping a number jumps there and closes the sheet',
      (jumped ?? '').startsWith('Question 3 of') && !window.document.querySelector('[aria-label="Question navigator"]'),
      jumped ?? 'no label',
    );
    // Walk back to question 1 so the answering loop below covers the whole paper.
    click(window.document.querySelector('button[aria-label="Open the question navigator"]'));
    await wait(500);
    const backSheet = window.document.querySelector('[aria-label="Question navigator"]');
    const firstButton = backSheet ? [...backSheet.querySelectorAll('button')].find((node) => (node.textContent || '').trim() === '1') : null;
    click(firstButton);
    await wait(500);
  }

  for (let i = 0; i < total; i += 1) {
    const options = optionButtons();
    click(options[0]);
    await wait(620);
    const next = byText('button', 'Next question');
    if (next) click(next);
    await wait(320);
  }
  const answeredLabel = [...window.document.querySelectorAll('span')]
    .map((node) => (node.textContent || '').trim())
    .find((label) => /^\d+ answered$/.test(label));
  const answeredNow = Number((answeredLabel ?? '0').split(' ')[0]);
  check('every question answered and autosaved', total > 0 && answeredNow === total, `${answeredNow}/${total}`);

  click(byText('button', 'Submit exam') || byText('button', 'Finish & submit'));
  await wait(500);
  check('submit confirmation appears', text().includes('Submit your exam?'), text().slice(0, 140));
  click(byText('button', 'Submit now'));
  await wait(3000);

  check('result slip renders', text().includes('Result slip'), text().slice(0, 180));
  check('result shows a grade', /Grade\s+[A-F]/.test(text()), text().match(/Grade\s*\w+/)?.[0] ?? '');
  check('result shows rewards', /\+\d+\s*XP|XP earned/.test(text()), '');
  check('answer review is present', text().includes('Answer review'), '');
  click(byText('button', 'Question 1'));
  await wait(600);
  check('review reveals the correct answer', text().includes('Why:') || /Correct/.test(text()), text().slice(0, 120));
  check('no errors through the exam flow', problems.length === 0, problems.slice(0, 2).join(' | '));

  /* ---------------------------------------- study lab: mind match mini game */
  click(byText('button', 'Dashboard')); // leave the result slip, back into the shell
  await wait(900);
  click(byText('button', 'Study'));
  await wait(1600);
  check('study lab hub advertises Mind Match', text().includes('Mind Match'), text().slice(0, 160));
  click(byText('button', 'Mind Match'));
  await wait(1200);
  const faceDown = () => [...window.document.querySelectorAll('button[aria-label="Face-down card"]')];
  check('mind match deals twelve face-down tiles', faceDown().length === 12, `${faceDown().length} tiles`);
  click(faceDown()[0]);
  await wait(150);
  check('tapping a tile flips it face-up', faceDown().length === 11, `${faceDown().length} still down`);
  click(faceDown()[0]);
  await wait(1000);
  check('flip counter advances after a pair attempt', text().includes('Flips: 1'), text().slice(0, 120));
  const labBack = [...window.document.querySelectorAll('main button')].find((node) => (node.textContent || '').trim() === 'Lab');
  click(labBack);
  await wait(700);
  check('back header returns to the study hub', text().includes('Daily challenge') && text().includes('Mind Match'), text().slice(0, 140));

  /* ---------------------------------------------------- live duel */
  click(byText('button', 'Dashboard'));
  await wait(900);
  click(byText('button', 'Duels'));
  await wait(1200);
  click(byText('button', 'New duel'));
  await wait(600);
  const courseChip = byText('button', 'LAW 421');
  check('duel creator offers course banks', Boolean(courseChip), text().slice(0, 160));
  click(courseChip);
  await wait(200);
  click(byText('button', 'Open to anyone'));
  await wait(300);
  click(byText('button', 'Publish open duel'));
  await wait(1600);

  const code = text().match(/Share code ([A-Z0-9]{6})/)?.[1];
  check('open duel published with a join code', Boolean(code), text().slice(0, 200));

  click(byText('button', 'Open waiting room') || byText('button', 'View duel'));
  await wait(1400);
  check('waiting room shows the code', text().includes('Challenge sent') && text().includes(code ?? '___'), text().slice(0, 160));

  // Player B joins over REST — the server pushes duel_start to A's socket.
  const bLogin = await apiCall('/api/auth/register', {
    method: 'POST',
    body: {username: `rival${Math.floor(Math.random() * 1000000)}`, phone: phoneB, password: 'rivalpass1', display_name: 'Rival Bot'},
  });
  check('rival signed in over REST', bLogin.status === 200, JSON.stringify(bLogin.data).slice(0, 120));
  const bToken = bLogin.data?.token;
  const joined = await apiCall(`/api/duels/join/${code}`, {method: 'POST', token: bToken});
  check('rival joined by code', joined.status === 200 && joined.data?.status === 'live', JSON.stringify(joined.data).slice(0, 160));

  await wait(2500);
  check('arena opened automatically for player A', text().includes('Live duel'), text().slice(0, 160));

  /* The question stage reads like a fight round: which round, what it is worth,
     how fast the answer still pays. */
  check('duel shows the round header', /Round \d+\/\d+/.test(text()), text().slice(0, 220));
  check('duel shows the points on the line', text().includes('pts on the line'), text().slice(0, 220));
  check('duel shows the live speed bonus', /Speed bonus (\+\d+|spent)/.test(text()), text().slice(0, 220));

  /* One click should raise the server's own verdict banner. */
  let verdict = '';
  {
    const options = optionButtons();
    if (options.length) {
      click(options[0]);
      for (let attempt = 0; attempt < 14 && !verdict; attempt += 1) {
        await wait(60);
        if (text().includes('Point won!')) verdict = 'Point won!';
        else if (text().includes('Not quite')) verdict = 'Not quite';
      }
    }
  }
  check('the duel shows the server verdict banner', Boolean(verdict), verdict || 'no verdict banner after an answer');

  const duelQuestions = joined.data?.question_count ?? 10;
  const duelIds = (joined.data?.questions ?? []).map((question) => question.id);

  // Both sides answer; B plays over REST while A clicks.
  const rival = (async () => {
    for (const questionId of duelIds) {
      const pick = ['A', 'B', 'C', 'D'][Math.floor(Math.random() * 4)];
      await apiCall(`/api/duels/${joined.data.id}/answer`, {
        method: 'POST',
        token: bToken,
        body: {question_id: questionId, selected: pick, elapsed_ms: 1500 + Math.floor(Math.random() * 4000)},
      });
      await wait(120);
    }
  })();

  const settled = () => /Victory!|Defeated|Dead heat/.test(text());
  for (let attempt = 0; attempt < duelQuestions * 4 && !settled(); attempt += 1) {
    const options = optionButtons();
    if (options.length) {
      click(options[Math.floor(Math.random() * options.length)]);
      await wait(1100);
    } else {
      await wait(450); // options are locked while an answer is in flight
    }
  }
  await rival;
  for (let attempt = 0; attempt < 20 && !settled(); attempt += 1) await wait(500);
  await wait(1200);

  check('duel finished and revealed a winner', settled(), text().slice(0, 200));
  check('duel shows the score breakdown', text().includes('Answer breakdown'), text().slice(0, 160));
  check('duel shows rewards earned', /XP earned/.test(text()), '');

  /* -------------------------------------------------- admin console */
  // Hard reset: re-evaluate the bundle in a fresh DOM with empty storage.
  const fresh = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: `${BASE}/`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const fw = fresh.window;
  fw.fetch = window.fetch;
  fw.WebSocket = globalThis.WebSocket;
  // jsdom's matchMedia always reports false, which hides the staff tab (the
  // console is desktop-only). This window stands in for a laptop, so answer
  // width queries honestly and everything else with the jsdom default.
  fw.matchMedia = (query) => {
    const real = window.matchMedia(query);
    return {...real, matches: /min-width/.test(query) ? true : real.matches};
  };
  fw.print = () => {};
  fw.scrollTo = () => {};
  fw.HTMLCanvasElement.prototype.getContext = () => null;
  fw.confirm = () => true;
  fw.eval(readFileSync(BUNDLE, 'utf8'));
  await wait(1600);

  const staffButton = [...fw.document.querySelectorAll('button')].find((node) => (node.textContent || '').includes('Staff'));
  click(staffButton);
  await wait(400);
  const emailInput = [...fw.document.querySelectorAll('input')].find((node) => node.type === 'email');
  const passwordInput = [...fw.document.querySelectorAll('input')].find((node) => node.type === 'password');
  check('staff sign-in form is reachable', Boolean(emailInput && passwordInput), fw.document.querySelector('#root')?.textContent.slice(0, 120) ?? '');
  setInput(passwordInput, ADMIN_PASSWORD);
  await wait(200);
  const unlock = [...fw.document.querySelectorAll('button')].find((node) => (node.textContent || '').includes('Unlock console'));
  click(unlock);
  await wait(2600);

  const adminText = fw.document.querySelector('#root')?.textContent ?? '';
  check('admin console loads', adminText.includes('Staff console'), adminText.slice(0, 160));
  check('overview shows live stats', adminText.includes('Top players') && adminText.includes('Quick actions'), adminText.slice(0, 160));

  const contentTab = [...fw.document.querySelectorAll('button')].find((node) => (node.textContent || '').includes('Courses & exams'));
  click(contentTab);
  await wait(1600);
  const contentText = fw.document.querySelector('#root')?.textContent ?? '';
  check('exam management lists quizzes', contentText.includes('Exams') && /questions/.test(contentText), contentText.slice(0, 180));

  // Open the bank of an exam that actually has questions — the seeded "coming soon"
  // exam is deliberately empty, and the segmented tab defaults to it.
  const examRows = [...fw.document.querySelectorAll('li')];
  const stockedRow = examRows.find((node) => {
    const match = (node.textContent || '').match(/(\d+)\s+questions/);
    return match && Number(match[1]) > 0 && [...node.querySelectorAll('button')].some((b) => (b.textContent || '').includes('Questions'));
  });
  const questionButton = stockedRow
    ? [...stockedRow.querySelectorAll('button')].find((node) => (node.textContent || '').includes('Questions'))
    : [...fw.document.querySelectorAll('button')].find((node) => (node.textContent || '').trim() === 'Questions');
  click(questionButton);
  await wait(1800);
  const questionText = fw.document.querySelector('#root')?.textContent ?? '';
  check(
    'question bank renders',
    questionText.includes('Import questions') && (questionText.includes('pts') || questionText.includes('No questions yet')),
    questionText.slice(0, 180),
  );

  const drawButton = [...fw.document.querySelectorAll('button')].find((node) => (node.textContent || '').includes('Draw from bank'));
  check('question bank offers draw-from-bank', Boolean(drawButton), drawButton ? 'found' : 'missing');
  click(drawButton);
  await wait(800);
  const drawText = fw.document.querySelector('#root')?.textContent ?? '';
  check(
    'draw modal explains the course bank',
    drawText.includes('Draw from Question Bank') && (drawText.includes('originals in bank') || drawText.includes('choose a course first')),
    drawText.slice(0, 180),
  );
  const cancelDraw = [...fw.document.querySelectorAll('button')].find((node) => (node.textContent || '').trim() === 'Cancel');
  click(cancelDraw);
  await wait(400);

  const playersTab = [...fw.document.querySelectorAll('button')].find((node) => (node.textContent || '').includes('Players'));
  click(playersTab);
  await wait(1600);
  const playersText = fw.document.querySelector('#root')?.textContent ?? '';
  check('player management lists the roster', playersText.includes('registered') && playersText.includes('Adjust'), playersText.slice(0, 180));

  const claimsTab = [...fw.document.querySelectorAll('button')].find((node) => (node.textContent || '').includes('Prize claims'));
  click(claimsTab);
  await wait(1500);
  const claimsText = fw.document.querySelector('#root')?.textContent ?? '';
  check('prize claims panel renders', claimsText.includes('Prize claims') || claimsText.includes('No claims yet'), claimsText.slice(0, 160));

  const settingsTab = [...fw.document.querySelectorAll('button')].find((node) => (node.textContent || '').trim() === 'Settings');
  click(settingsTab);
  await wait(1500);
  const settingsText = fw.document.querySelector('#root')?.textContent ?? '';
  check('settings panel renders', settingsText.includes('Grading scale') && settingsText.includes('Gameplay switches'), settingsText.slice(0, 160));

  const passed = results.filter((row) => row.ok).length;
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('failures:');
    failures.forEach((line) => console.log(` - ${line}`));
  }
  if (problems.length) {
    console.log('console problems:');
    problems.slice(0, 6).forEach((line) => console.log(` - ${line}`));
  }
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error('flow check crashed:', error);
  process.exit(2);
});
