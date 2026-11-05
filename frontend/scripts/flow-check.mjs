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
window.HTMLElement.prototype.scrollIntoView = () => {};
window.HTMLCanvasElement.prototype.getContext = () => null;
window.confirm = () => { throw new Error('native confirm must not be used'); };

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
  click(byText('button', 'Study Lab'));
  await wait(1600);
  check('Study Lab hub advertises the Match pairs activity', text().includes('Match pairs'), text().slice(0, 240));
  click(byText('button', 'Match pairs'));
  await wait(1200);
  const faceDown = () => [...window.document.querySelectorAll('button[aria-label="Face-down card"]')];
  check('mind match deals twelve face-down tiles', faceDown().length === 12, `${faceDown().length} tiles`);
  click(faceDown()[0]);
  await wait(150);
  check('tapping a tile flips it face-up', faceDown().length === 11, `${faceDown().length} still down`);
  click(faceDown()[0]);
  await wait(1000);
  check('flip counter advances after a pair attempt', text().includes('Flips: 1'), text().slice(0, 120));
  const labBack = window.document.querySelector('button[aria-label="Back to Study Lab"]');
  click(labBack);
  await wait(700);
  check('back header returns to the Study Lab hub', text().includes('Daily challenge') && text().includes('Match pairs'), text().slice(0, 180));

  /* ---------------------------------------------------- live duel */
  click(byText('button', 'Dashboard'));
  await wait(900);
  click(byText('button', 'Duels'));
  await wait(1200);
  click(byText('button', 'New duel'));
  await wait(600);
  const courseChip = byText('button', 'ENG 101');
  check(
    'duel creator shows only supported English and Mathematics banks',
    Boolean(courseChip) && text().includes('MTH 101') && ['LAW ', 'BIO ', 'PHY ', 'CS '].every((code) => !text().includes(code)),
    text().slice(0, 240),
  );
  click(courseChip);
  await wait(200);
  click(byText('button', 'Open to anyone'));
  await wait(300);
  click(byText('button', 'Publish open duel'));
  await wait(1600);

  const code = text().match(/Code\s*([A-Z0-9]{6})/)?.[1];
  check('open duel published with a join code', Boolean(code), text().slice(0, 240));

  click(byText('button', 'Open waiting room') || byText('button', 'View duel'));
  await wait(1400);
  check('waiting room shows the open seat and join code', text().includes('Waiting for an opponent') && text().includes(code ?? '___'), text().slice(0, 200));

  // Player B joins over REST — the server pushes duel_start to A's socket.
  const bLogin = await apiCall('/api/auth/register', {
    method: 'POST',
    body: {username: `rival${Math.floor(Math.random() * 1000000)}`, phone: phoneB, password: 'rivalpass1', display_name: 'Rival Bot'},
  });
  check('rival signed in over REST', bLogin.status === 200, JSON.stringify(bLogin.data).slice(0, 120));
  const bToken = bLogin.data?.token;
  const joined = await apiCall(`/api/duels/join/${code}`, {method: 'POST', token: bToken});
  check(
    'rival joined by code and received a private question set',
    joined.status === 200 && ['starting', 'live'].includes(joined.data?.status) && (joined.data?.questions?.length ?? 0) === joined.data?.question_count,
    JSON.stringify(joined.data).slice(0, 200),
  );

  const liveQuestion = await waitFor(() => text().includes('Round 1/'), 12000);
  check('the shared countdown opens the first live round for player A', liveQuestion, text().slice(0, 220));

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
  const duelRows = joined.data?.questions ?? [];
  let rivalError = '';

  // Both sides answer. B waits for each server-owned round before posting its
  // own separately dealt question, so it cannot race the countdown or answer
  // a future round early.
  const rival = (async () => {
    try {
      for (const [position, question] of duelRows.entries()) {
        let state = null;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const response = await apiCall(`/api/duels/${joined.data.id}`, {token: bToken});
          if (response.status !== 200) throw new Error(`state ${response.status}: ${JSON.stringify(response.data)}`);
          state = response.data;
          if (state.status === 'finished') return;
          if (state.status === 'live' && state.round_index === position) break;
          await wait(150);
        }
        if (!state || state.status !== 'live' || state.round_index !== position) {
          throw new Error(`round ${position + 1} never opened: ${JSON.stringify(state)}`);
        }
        const pick = ['A', 'B', 'C', 'D'][Math.floor(Math.random() * 4)];
        const answer = await apiCall(`/api/duels/${joined.data.id}/answer`, {
          method: 'POST',
          token: bToken,
          body: {question_id: question.id, selected: pick, elapsed_ms: 1500 + Math.floor(Math.random() * 4000)},
        });
        if (answer.status !== 200) throw new Error(`answer ${position + 1} ${answer.status}: ${JSON.stringify(answer.data)}`);
      }
    } catch (error) {
      rivalError = error instanceof Error ? error.message : String(error);
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
  check('REST rival answered each server-paced round', !rivalError && duelRows.length === duelQuestions, rivalError || `${duelRows.length}/${duelQuestions} questions`);
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
  fw.HTMLElement.prototype.scrollIntoView = () => {};
  fw.HTMLCanvasElement.prototype.getContext = () => null;
  fw.confirm = () => { throw new Error('native confirm must not be used'); };
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
  const adminMain = () => fw.document.querySelector('main')?.textContent ?? '';
  await waitFor(() => adminMain().includes('ENG 101') && adminMain().includes('MTH 101'));
  const courseListText = adminMain();
  check(
    'course management lists only the supported English and Mathematics courses',
    courseListText.includes('ENG 101') && courseListText.includes('MTH 101') && ['LAW ', 'BIO ', 'PHY ', 'CS '].every((code) => !courseListText.includes(code)),
    courseListText.slice(0, 300),
  );

  const examsPane = [...fw.document.querySelectorAll('main button')].find((node) => (node.textContent || '').trim() === 'Exams');
  click(examsPane);
  await waitFor(() => adminMain().includes('New exam') && adminMain().includes('per player'));
  const examText = adminMain();
  check('exam management lists the live English and Mathematics exams', examText.includes('New exam') && examText.includes('Random') && examText.includes('per player'), examText.slice(0, 360));

  const questionsPane = [...fw.document.querySelectorAll('main button')].find((node) => (node.textContent || '').trim() === 'Questions');
  click(questionsPane);
  await waitFor(() => adminMain().includes('Course question bank') && adminMain().includes('Add question'));
  const questionsMain = adminMain();
  check(
    'the supported course question bank renders with import and edit actions',
    questionsMain.includes('Course question bank') && questionsMain.includes('Add question') && questionsMain.includes('Import'),
    questionsMain.slice(0, 360),
  );

  const coursePicker = fw.document.querySelector('main button[aria-haspopup="listbox"]');
  click(coursePicker);
  await wait(300);
  const courseOptions = [...fw.document.querySelectorAll('[role="option"]')];
  const optionText = courseOptions.map((node) => node.textContent || '').join(' ');
  check(
    'admin course dropdown is a picker restricted to English and Mathematics',
    optionText.includes('ENG 101') && optionText.includes('MTH 101') && ['LAW ', 'BIO ', 'PHY ', 'CS '].every((code) => !optionText.includes(code)),
    optionText,
  );
  click(courseOptions.find((node) => (node.textContent || '').includes('ENG 101')));
  await wait(350);

  const importButton = [...fw.document.querySelectorAll('main button')].find((node) => (node.textContent || '').trim() === 'Import');
  check('course bank offers the import workflow', Boolean(importButton), '');
  click(importButton);
  await wait(350);
  const importDialog = fw.document.querySelector('[role="dialog"]');
  check(
    'import dialog states which supported course bank it will update',
    Boolean(importDialog) && (importDialog.textContent || '').includes('Import questions') && (importDialog.textContent || '').includes('ENG 101') && !(importDialog.textContent || '').includes('Supreme Court'),
    importDialog?.textContent?.slice(0, 300),
  );
  click([...fw.document.querySelectorAll('[role="dialog"] button')].find((node) => (node.textContent || '').trim() === 'Cancel'));
  await wait(300);

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
