/**
 * Render check: boots the real production bundle inside jsdom against the live
 * API (http://localhost:5173 → proxied to FastAPI on :3000) and drives the UI
 * like a user would. Catches runtime errors a type check cannot see.
 *
 *   node scripts/render-check.mjs            # against the dev server
 *   BASE=http://localhost:4173 node scripts/render-check.mjs
 */
import {readFileSync} from 'node:fs';
import {JSDOM, VirtualConsole} from 'jsdom';

const BASE = process.env.BASE || 'http://localhost:5173';
const BUNDLE = process.env.BUNDLE || '/tmp/app.iife.js';
const PHONE = `070${Math.floor(10000000 + Math.random() * 89999999)}`;

const results = [];
const failures = [];
const check = (name, ok, detail = '') => {
  results.push({name, ok});
  if (!ok) failures.push(`${name}${detail ? ` -> ${String(detail).slice(0, 260)}` : ''}`);
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${!ok && detail ? ` -> ${String(detail).slice(0, 260)}` : ''}`);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Poll until the page says what we are waiting for — no fixed-time flake. */
const waitFor = async (predicate, timeout = 9000, step = 150) => {
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
window.HTMLElement.prototype.scrollIntoView = () => {};
window.HTMLCanvasElement.prototype.getContext = () => null; // confetti no-ops without canvas
window.confirm = () => { throw new Error('Native browser confirmation is forbidden; use the in-app yes/no modal.'); };

const text = () => window.document.querySelector('#root')?.textContent ?? '';
const byText = (selector, needle) =>
  [...window.document.querySelectorAll(selector)].find((node) => (node.textContent || '').includes(needle));
const setValue = (element, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(element, value);
  element.dispatchEvent(new window.Event('input', {bubbles: true}));
};
const click = (element) => element?.dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true}));

async function main() {
  window.eval(readFileSync(BUNDLE, 'utf8'));
  await wait(1600);

  check('app mounts on the branded landing page', text().includes('Absolute Genesis'), text().slice(0, 120));
  check('hero reel plays its first caption', text().includes('Small steps. Big progress.'), text().slice(0, 160));
  const heroFrames = [...window.document.querySelectorAll('.hero-reel img')];
  check('hero reel carries seven captioned frames', heroFrames.length === 7, `${heroFrames.length} frames`);
  check('landing shows live arena stats', text().includes('players') || text().includes('Players'), text().slice(0, 200));
  check('no render errors on boot', problems.length === 0, problems.slice(0, 3).join(' | '));

  /* ------------------------------------ step from the pitch into sign-in */
  click(byText('button', 'Enter the arena'));
  await wait(700);
  const idInput = window.document.querySelector('form input[autocomplete="username"]');
  const passInput = window.document.querySelector('form input[type="password"]');
  check('sign-in view opens with the credentials form', Boolean(idInput && passInput), text().slice(0, 160));

  // The roster is gone — every player registers their own secure account.
  click(byText('button', 'Create account'));
  await wait(400);
  const inputs = [...window.document.querySelectorAll('form input')];
  check('create-account tab collects username, phone and password', inputs.length >= 3, `${inputs.length} inputs`);
  const USERNAME = `render${Math.floor(Math.random() * 1000000)}`;
  setValue(inputs[0], USERNAME);
  setValue(inputs[1], PHONE.replace(/^0/, ''));
  setValue(inputs[2], 'renderpass1');
  if (inputs[3]) setValue(inputs[3], 'Render Rider');
  await wait(300);
  const enterButton = window.document.querySelector('form button[type="submit"]');
  click(enterButton);
  await wait(300);
  if (!text().includes('Arena exams')) {
    // jsdom does not always run form submission from a button click
    enterButton?.closest('form')?.dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true}));
  }
  await wait(2200);

  const loginError = [...window.document.querySelectorAll('p, span')].map((n) => n.textContent || '').find((t) => /valid|reach|Wrong|not|failed/i.test(t));
  check('signed in to the dashboard', text().includes('Arena exams'), loginError || text().slice(0, 200));
  check('welcome celebration or hero shown', /Level\s*1|Good (morning|afternoon|evening)/.test(text()), text().slice(0, 200));
  check('live socket connected', text().includes('Live sync on') || text().includes('online'), 'no live indicator');

  /* The header search is an icon button at every width — no "Jump to…" label and
     no ⌘K pill; the shortcut hint lives in the tooltip. */
  const quickJump = window.document.querySelector('button[aria-label="Quick jump"]');
  check(
    'header quick jump is an icon-only button',
    Boolean(quickJump) &&
      (quickJump.textContent || '').trim() === '' &&
      /\u2318K/.test(quickJump.getAttribute('title') || ''),
    quickJump
      ? `label \u201c${(quickJump.textContent || '').trim()}\u201d title \u201c${quickJump.getAttribute('title')}\u201d`
      : 'no quick jump button in the header',
  );

  /* The account menu wears the avatar in a true circle on phones — no asymmetric
     padding, so the ring can never stretch into a pill before the name appears. */
  const accountButton = window.document.querySelector('button[aria-label="Account menu"]');
  check(
    'the account ring is a circle on phones',
    Boolean(accountButton) &&
      accountButton.classList.contains('aspect-square') &&
      accountButton.classList.contains('p-1') &&
      !accountButton.classList.contains('py-1') &&
      !accountButton.classList.contains('pr-1'),
    accountButton ? accountButton.className : 'no account menu button',
  );

  /* The header is not a banner any more: no fill, no blur, no shadow strip
     across the top. The controls float on their own chips instead, so they stay
     readable while the world scrolls under them. */
  const shellHeader = window.document.querySelector('header');
  check(
    'the header is not a banner',
    Boolean(shellHeader) && shellHeader.classList.contains('sticky') && !/backdrop-blur|bg-ink-950/.test(shellHeader.className),
    shellHeader ? shellHeader.className : 'no header element',
  );
  const floatChips = [...window.document.querySelectorAll('.float-chip')];
  check('header controls float on their own chips', floatChips.length >= 5, `${floatChips.length} floating chips`);

  /* Daylight is the fresh-device default; saved choices are applied only when present. */
  check(
    'a fresh device boots in daylight',
    window.document.documentElement.dataset.skin === 'day',
    `skin is \u201c${window.document.documentElement.dataset.skin}\u201d`,
  );
  check('no errors during sign-in', problems.length === 0, problems.slice(0, 3).join(' | '));

  // dismiss any celebration overlay so it cannot block clicks
  const keepClimbing = byText('button', 'Keep climbing');
  if (keepClimbing) {
    click(keepClimbing);
    await wait(400);
  }

  /* ------------------------------------------------------- tab crawl */
  const tabs = ['World Map', 'Study Lab', 'Duels', 'Shop', 'Friends', 'Ranks', 'Prizes', 'Feed', 'Profile'];
  const tabIds = ['map', 'study', 'duels', 'shop', 'friends', 'ranks', 'prizes', 'feed', 'profile'];
  const expects = ['World map', 'Study Lab', 'Duel arena', 'Arena shop', 'Pick a friend', 'Leaderboards', 'Prize vault', 'Arena feed', 'Career stats'];
  for (let i = 0; i < tabs.length; i += 1) {
    const tabButton = byText('button', tabs[i]);
    check(`nav tab “${tabs[i]}” exists`, Boolean(tabButton));
    click(tabButton);
    await wait(1100);
    /* Every screen is a real location, which is what makes the device back
       button (and a refresh) land where the player was. */
    check(`“${tabs[i]}” is an addressable page`, window.location.hash === `#/${tabIds[i]}`, window.location.hash);
    check(`panel “${expects[i]}” renders`, text().includes(expects[i]), text().slice(0, 180));
    if (tabs[i] === 'World Map') {
      // The rank artwork is intentionally icon-only at this compact size; its
      // accessible label carries the season rank and level for assistive tech.
      const mapBadge = window.document.querySelector('.wm-hero .season-badge');
      check(
        'the world map HUD wears an accessible season badge',
        Boolean(mapBadge) && /level \d+/i.test(mapBadge.getAttribute('aria-label') || ''),
        mapBadge?.getAttribute('aria-label') || 'no season badge in the map HUD',
      );
    }
    check(`no errors on ${tabs[i]}`, problems.length === 0, problems.slice(0, 2).join(' | '));
  }

  /* ------------------------------------------------------------ back is back
     Every screen is a history entry, so the browser's own back (Android back
     button, iOS edge swipe, ⌘[ ) returns to the page the player came from —
     never to a fixed tab. */
  click(byText('button', 'Study Lab'));
  await wait(900);
  check('Standard Study Lab opens its study activity hub', text().includes('Study Lab') && text().includes('Flashcards') && text().includes('Match pairs'), text().slice(0, 220));
  click(byText('button', 'Flashcards'));
  check('Standard flashcards load a question card', await waitFor(() => /Card 1 of \d+/.test(text()) && text().includes('Tap to flip')), text().slice(0, 220));
  const flipPrompt = [...window.document.querySelectorAll('p')].find((node) => node.textContent?.includes('Tap to flip'));
  click(flipPrompt);
  check('Standard flashcard reveals its answer and explanation', await waitFor(() => text().includes('Knew it') && text().includes('Still learning')), text().slice(-260));
  click(byText('button', 'Knew it'));
  check('Standard flashcard grading advances the deck', await waitFor(() => /Card 2 of \d+/.test(text())), text().slice(0, 220));
  click(window.document.querySelector('button[aria-label="Back to Study Lab"]'));
  await wait(500);
  check('Standard flashcards return to the Study Lab hub', text().includes('Study Lab') && text().includes('Match pairs'), text().slice(0, 220));
  check('no errors in the Standard flashcard flow', problems.length === 0, problems.slice(-3).join(' | '));
  click(byText('button', 'Prizes'));
  await wait(900);
  check('two screens deep before going back', window.location.hash === '#/prizes', window.location.hash);
  window.history.back();
  await wait(900);
  check('back returns to the previous screen, not a fixed tab', window.location.hash === '#/study', window.location.hash);
  check('the previous screen is the one that renders', text().includes('Study Lab'), text().slice(0, 160));
  window.history.forward();
  await wait(900);
  check('forward walks the same trail', window.location.hash === '#/prizes', window.location.hash);

  /* ------------------------------------------------ the ladder reacts live */
  /* A fresh account starts on 25 welcome XP; the daily bonus pushes it past
     the level-2 threshold (46), so the rewards payload carries a season event.
     This is the whole climb pipeline: server grant -> store -> on screen. */
  click(byText('button', 'Play'));
  await wait(1000);
  const bonusButton = byText('button', 'Claim daily bonus');
  check('the hero offers the daily bonus', Boolean(bonusButton));
  if (bonusButton) {
    click(bonusButton);
    await wait(2200);
    const afterBonus = text();
    check(
      'a real XP grant moves the season ladder on screen',
      /Season Lv \d+/.test(afterBonus) || /season level \d+/i.test(afterBonus),
      afterBonus.slice(0, 220),
    );
    check('no errors while celebrating the climb', problems.length === 0, problems.slice(0, 2).join(' | '));
    const closeReward = byText('button', 'Keep climbing') || byText('button', 'Claim the new season');
    if (closeReward) {
      click(closeReward);
      await wait(500);
    }
  }

  /* ------------------------------------------- the month rolls over ------ */
  /* Put the calendar back a month in the app's own memory and sign in again:
     the arena should greet the new season and say what the last one ended on,
     instead of silently resetting the badge overnight. */
  const seenKey = Object.keys(window.localStorage).find((key) => key.endsWith('.season_seen'));
  check('the app remembers which season it greeted', Boolean(seenKey), Object.keys(window.localStorage).slice(0, 6).join(', '));
  if (seenKey) {
    click(window.document.querySelector('button[aria-label="Account menu"]'));
    await wait(500);
    click(byText('button', 'Sign out'));
    await wait(1200);
    check('signing out returns to the landing page', text().includes('Enter the arena'), text().slice(0, 120));
    // the cache shape is {at, v}; signing out cleared the scope, so write after it
    window.localStorage.setItem(seenKey, JSON.stringify({at: Date.now(), v: '1999-01'}));

    click(byText('button', 'Enter the arena'));
    await wait(800);
    const backId = window.document.querySelector('form input[autocomplete="username"]');
    const backPass = window.document.querySelector('form input[type="password"]');
    check('the sign-in form returns', Boolean(backId && backPass));
    if (backId && backPass) {
      setValue(backId, USERNAME);
      setValue(backPass, 'renderpass1');
      const backForm = backId.closest('form');
      click(backForm?.querySelector('button[type="submit"]'));
      await wait(400);
      backForm?.dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true}));
    }
    await wait(2200);

    // the greeting lands with the profile fetch — give it a moment rather than
    // guessing at a fixed delay
    let rolled = text();
    for (let i = 0; i < 10 && !(rolled.includes('NEW SEASON') || rolled.includes('has begun')); i += 1) {
      await wait(500);
      rolled = text();
    }
    check(
      'a new month greets the player with the season rollover',
      rolled.includes('NEW SEASON') || rolled.includes('has begun'),
      rolled.slice(0, 240),
    );
    const closeRoll = byText('button', 'Claim the new season');
    check('the rollover can be dismissed', Boolean(closeRoll));
    if (closeRoll) {
      click(closeRoll);
      await wait(600);
    }
    check('no errors on the rollover', problems.length === 0, problems.slice(0, 2).join(' | '));
  }

  /* ------------------------------------------------------ season ladder */
  click(byText('button', 'Ranks'));
  await wait(700);
  const seasonTab = byText('button', 'Season');
  check('the ranks tab offers a season view', Boolean(seasonTab));
  if (seasonTab) {
    click(seasonTab);
    await wait(2600);
    const body = text();
    check('the season panel names the month', /(January|February|March|April|May|June|July|August|September|October|November|December) 20\d\d/.test(body), body.slice(0, 200));
    check('the season panel shows the level track', body.includes('Level track'));
    check('the season panel lists the twelve ranks', body.includes('The twelve ranks') && body.includes('Celestial'));
    check('the season panel shows past seasons', body.includes('Past seasons'));
    check(
      'every rank badge is drawn',
      window.document.querySelectorAll('[data-rank]').length >= 12,
      String(window.document.querySelectorAll('[data-rank]').length),
    );
    check('no errors on the season panel', problems.length === 0, problems.slice(0, 2).join(' | '));
  }

  /* --------------------------------------------------------- open exam */
  click(byText('button', 'Play'));
  await wait(900);
  const startButton = byText('button', 'Start exam');
  check('an exam can be started from the catalogue', Boolean(startButton));
  if (startButton) {
    click(startButton);
    await waitFor(() => text().includes('Question 1 of'));
    const examReady = text().includes('Question 1 of') && text().includes('Navigator');
    check('exam engine renders with a timer', examReady, text().slice(0, 220));
    /* The attempt has its own address, so a refresh (or a phone locking) comes
       back to this exact paper instead of the home screen. */
    check('the exam has its own address', /^#\/exam\/\d+$/.test(window.location.hash), window.location.hash);

    /* ------------------------------------------------ reload mid-paper
       Boot the bundle again in a fresh window, on the same device storage and
       the same address — exactly what a reload looks like. The paper, its
       question and its clock must come back. */
    {
      const attempt = Number(window.location.hash.split('/')[2]);
      const reloaded = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
        url: `${BASE}/#/exam/${attempt}`,
        runScripts: 'outside-only',
        pretendToBeVisual: true,
        virtualConsole,
      });
      const rw = reloaded.window;
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (key) rw.localStorage.setItem(key, window.localStorage.getItem(key) ?? '');
      }
      rw.fetch = window.fetch;
      rw.WebSocket = globalThis.WebSocket;
      rw.matchMedia = window.matchMedia;
      rw.print = () => {};
      rw.scrollTo = () => {};
      rw.HTMLElement.prototype.scrollIntoView = () => {};
      rw.HTMLCanvasElement.prototype.getContext = () => null;
      rw.confirm = () => { throw new Error('Native browser confirmation is forbidden; use the in-app yes/no modal.'); };
      rw.eval(readFileSync(BUNDLE, 'utf8'));
      const restored = await waitFor(() => (rw.document.querySelector('#root')?.textContent ?? '').includes('Question 1 of'));
      const reloadText = rw.document.querySelector('#root')?.textContent ?? '';
      check('a reload mid-paper reopens the same attempt', restored, reloadText.slice(0, 200));
      rw.close();
    }
    check('exam hides the answer key', !/Correct answer|Why:/.test(text()), 'answer key leaked pre-submission');

    const option = window.document.querySelector('main ul li button');
    click(option);
    await wait(1200);
    check('answering autosaves without error', problems.length === 0, problems.slice(0, 2).join(' | '));

    click(byText('button', 'Exit'));
    await wait(700);
    click(byText('button', 'Dashboard') || byText('button', 'Play'));
    await wait(900);
    check('back on the dashboard with a resumable attempt', text().includes('Resume attempt') || text().includes('Arena exams'), text().slice(0, 160));
    check('leaving the exam returns to the tab it came from', window.location.hash === '#/play', window.location.hash);
  }

  /* ----------------------------------------------------------- friends */
  click(byText('button', 'Profile'));
  await wait(1200);
  check('profile shows badge collection', text().includes('Badge collection'), text().slice(0, 160));
  check('the character screen wears the season badge', text().includes('This season') && text().includes('Season badge'), text().slice(0, 200));
  check(
    'profile offers the music deck',
    text().includes('Arena Rock') && text().includes('Arcade Session') && text().includes('Music volume'),
    text().slice(0, 200),
  );
  check(
    'profile offers photo upload',
    Boolean(window.document.querySelector('button[aria-label="Upload a profile photo"]')),
    'camera button',
  );
  check('profile shows career stats', text().includes('Career stats'), text().slice(0, 160));
  check('no errors on profile', problems.length === 0, problems.slice(0, 2).join(' | '));

  /* ------------------------------------------------------- duel search */
  click(byText('button', 'Duels'));
  await wait(900);
  const newDuel = byText('button', 'New duel');
  check('duel lobby offers “New duel”', Boolean(newDuel));
  click(newDuel);
  await wait(700);
  check('challenge modal opens', text().includes('Start a duel'), text().slice(0, 160));
  const searchInput = [...window.document.querySelectorAll('input')].find((node) => (node.placeholder || '').includes('Name or phone'));
  if (searchInput) {
    // Register a searchable rival first — there is no seeded roster any more.
    await nodeFetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        username: `searchee${Math.floor(Math.random() * 1000000)}`,
        phone: `071${Math.floor(10000000 + Math.random() * 89999999)}`,
        password: 'searchpass1',
        display_name: 'Searchable Rival',
      }),
    });
    setValue(searchInput, 'Searchable Rival');
    await wait(900);
    check('player search returns results', window.document.querySelectorAll('[role="dialog"] ul li').length > 0, 'no search hits');
  }
  click(byText('button', 'Cancel'));
  await wait(400);

  /* ---------------------------------------------- public player profile */
  const profilePhone = `072${Math.floor(10000000 + Math.random() * 89999999)}`;
  const profileResponse = await nodeFetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      username: `profile${Math.floor(Math.random() * 1000000)}`,
      phone: profilePhone,
      password: 'profilepass1',
      display_name: 'Profile Showcase',
    }),
  });
  if (!profileResponse.ok) throw new Error(`cannot create profile showcase player: ${profileResponse.status}`);
  const profileSession = await profileResponse.json();
  const targetId = profileSession.profile.id;
  const countryResponse = await nodeFetch(`${BASE}/api/me`, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${profileSession.token}`},
    body: JSON.stringify({country: 'GB', avatar_hue: 285}),
  });
  check('public profile fixture has a country and avatar colour', countryResponse.ok, String(countryResponse.status));
  window.dispatchEvent(new window.CustomEvent('ag:player', {detail: {id: targetId}}));
  const profileDialog = () => window.document.querySelector('[role="dialog"][aria-label^="Public profile for"]');
  check(
    'selecting a player opens their public profile modal',
    await waitFor(() => Boolean(profileDialog()?.textContent?.includes('Profile Showcase'))),
    profileDialog()?.getAttribute('aria-label'),
  );
  const publicProfile = profileDialog();
  const profileText = publicProfile?.textContent ?? '';
  check('profile merges avatar, flag and equipped look in one scrollable card',
    Boolean(publicProfile?.querySelector('.card.overflow-y-auto')?.className.includes('max-h-')) &&
      publicProfile.querySelectorAll('.card').length === 1 && profileText.includes('PS') && profileText.includes('🇬🇧') && profileText.includes('Equipped') && profileText.includes('Classic theme'),
    profileText.slice(0, 240),
  );
  check('public profile shows season and ranked standing',
    Boolean(publicProfile?.querySelector('[aria-label="Current ranks"]')) && profileText.includes('Ranked ladder'),
    profileText.slice(0, 260),
  );
  check('public profile shows useful stats, achievements and history',
    Boolean(publicProfile?.querySelector('[aria-label="Player statistics"]')) &&
      Boolean(publicProfile?.querySelector('[aria-label="Achievements"]')) &&
      Boolean(publicProfile?.querySelector('[aria-label="Recent public history"]')) &&
      profileText.includes('Lifetime XP') && profileText.includes('No public achievements yet.') && profileText.includes('Their public highlights will appear as they play.'),
    profileText.slice(-360),
  );
  const profileButtons = [...(publicProfile?.querySelectorAll('button') ?? [])];
  check('public profile offers friend and duel actions',
    profileButtons.some((button) => (button.textContent || '').trim().endsWith('Add')) && profileButtons.some((button) => (button.textContent || '').includes('Challenge')),
    profileButtons.map((button) => (button.textContent || '').trim()).join(' · '),
  );
  click(profileButtons.find((button) => (button.textContent || '').trim().endsWith('Add')));
  check('friend action adds or requests the player and updates its label',
    await waitFor(() => /\b(?:Requested|Friends)\b/.test(profileDialog()?.textContent ?? '')),
    profileDialog()?.textContent?.slice(-160),
  );
  click([...((profileDialog()?.querySelectorAll('button')) ?? [])].find((button) => (button.textContent || '').includes('Challenge')));
  check('duel action sends the challenge and closes the profile',
    await waitFor(() => !profileDialog() && text().includes('Challenge sent')),
    text().slice(-220),
  );

  /* ------------------------------------------ Standard ↔ Pro study path */
  const moreButtons = [...window.document.querySelectorAll('button')].filter((button) => (button.textContent || '').trim() === 'More');
  click(moreButtons[moreButtons.length - 1]);
  check('Standard More menu offers Pro mode', await waitFor(() => Boolean(byText('button', 'Switch to Pro Mode'))), text().slice(-220));
  click(byText('button', 'Switch to Pro Mode'));
  check('switching to Pro keeps the signed-in app session',
    await waitFor(() => window.document.documentElement.dataset.mode === 'pro'),
    `mode=${window.document.documentElement.dataset.mode}`,
  );
  const proStudyIntro = byText('button', 'Build your study path');
  if (proStudyIntro) click(proStudyIntro);
  else click([...window.document.querySelectorAll('nav[aria-label="Pro navigation"] button')].find((button) => (button.textContent || '').trim() === 'Study'));
  check('Pro onboarding lands in the topic chooser',
    await waitFor(() => text().includes('Choose a topic to open its workspace')),
    text().slice(0, 260),
  );
  const proCatalogText = text();
  check('Pro Study lists only the supported English and Mathematics courses',
    proCatalogText.includes('ENG 101') && proCatalogText.includes('MTH 101') && !/\b(?:LAW|PHY|BIO|CS)\s*101\b|Chemistry|Physics|Biology|Computer Science/i.test(proCatalogText),
    proCatalogText.slice(0, 360),
  );
  const grammarChoice = [...window.document.querySelectorAll('button')].find((button) => button.classList.contains('pro-row-btn') && (button.textContent || '').includes('Grammar'));
  click(grammarChoice);
  check('ENG Grammar opens a topic workspace with standing and materials',
    await waitFor(() => text().includes('Key concepts') && text().includes('Your standing') && text().includes('ENG 101') && text().includes('Grammar')),
    text().slice(0, 360),
  );
  const workspaceTab = (label) => [...window.document.querySelectorAll('[role="tablist"][aria-label="Workspace"] [role="tab"]')]
    .find((button) => (button.textContent || '').includes(label));
  click(workspaceTab('Practice'));
  check('Pro topic practice presents a timed drill and mini-exam route',
    await waitFor(() => text().includes('Timed drill') && text().includes('Mini exam') && Boolean(byText('button', 'Start practice'))),
    text().slice(-340),
  );
  click(byText('button', 'Start practice'));
  check('Pro topic practice opens the server-backed question runner',
    await waitFor(() => text().includes('Question 1 of') && text().includes('End practice')),
    text().slice(-320),
  );
  click(byText('button', 'End practice'));
  check('Pro practice can safely exit an unanswered run',
    await waitFor(() => text().includes('New practice session')),
    text().slice(0, 260),
  );
  const proNavButton = (label) => [...window.document.querySelectorAll('nav[aria-label="Pro navigation"] button')]
    .find((button) => (button.textContent || '').trim() === label);
  click(proNavButton('Study'));
  check('Pro Study restores the focused topic after leaving practice',
    await waitFor(() => text().includes('Key concepts') && text().includes('Grammar')),
    text().slice(0, 300),
  );
  click(workspaceTab('Flashcards'));
  check('Pro topic flashcards link to the shared review workspace',
    await waitFor(() => text().includes('Review flashcards') && text().includes('Create with AI')),
    text().slice(-280),
  );
  click(byText('button', 'Review flashcards'));
  check('Pro flashcards library loads its review and deck views',
    await waitFor(() => text().includes("Today's reviews") && text().includes('Your decks')),
    text().slice(0, 320),
  );
  check('no errors in the Pro flashcards route', problems.length === 0, problems.slice(-3).join(' | '));
  click(proNavButton('Study'));
  await waitFor(() => text().includes('Key concepts') && text().includes('Grammar'));
  click(workspaceTab('Notes'));
  await waitFor(() => Boolean(window.document.querySelector('textarea[aria-label="Notes on Grammar"]')));
  const proNotes = window.document.querySelector('textarea[aria-label="Notes on Grammar"]');
  if (proNotes) {
    const textareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    textareaSetter.call(proNotes, 'Keep subject–verb agreement clear in every sentence.');
    proNotes.dispatchEvent(new window.Event('input', {bubbles: true}));
  }
  const cachedProNote = () => {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.endsWith('.pro.notes.grammar')) {
        try { return JSON.parse(window.localStorage.getItem(key) || '{}').v; } catch { return null; }
      }
    }
    return null;
  };
  check('Pro topic notes autosave privately on this device',
    await waitFor(() => cachedProNote() === 'Keep subject–verb agreement clear in every sentence.') && Boolean(proNotes),
    `textarea=${JSON.stringify(proNotes?.value)} cache=${JSON.stringify(cachedProNote())}`,
  );
  click(workspaceTab('Study'));
  check('leaving Pro Notes closes the editor cleanly',
    await waitFor(() => !window.document.querySelector('textarea[aria-label="Notes on Grammar"]')),
    `textarea still open: ${Boolean(window.document.querySelector('textarea[aria-label="Notes on Grammar"]'))}`,
  );
  click(workspaceTab('Notes'));
  const restoredNote = () => window.document.querySelector('textarea[aria-label="Notes on Grammar"]')?.value;
  check('Pro topic notes persist after switching workspace tabs',
    await waitFor(() => restoredNote() === 'Keep subject–verb agreement clear in every sentence.'),
    `value=${JSON.stringify(restoredNote())} cache=${JSON.stringify(cachedProNote())}`,
  );
  click(proNavButton('Materials'));
  check('Pro Materials opens with the library and topic-safe course scope',
    await waitFor(() => text().includes('Course reading with your highlights') && text().includes('Library')) &&
      !/\b(?:LAW|PHY|BIO|CS)\s*101\b|Chemistry|Physics|Biology|Computer Science/i.test(text()),
    text().slice(0, 340),
  );
  click(proNavButton('AI Assistant'));
  check('Pro AI Assistant keeps its chat list and composer visible',
    await waitFor(() => text().includes('AI Assistant') && Boolean(window.document.querySelector('input[aria-label="Search chats"]')) && Boolean(window.document.querySelector('textarea[aria-label="Message"]'))),
    text().slice(0, 360),
  );
  check('no errors across Pro Study, Materials and AI Assistant', problems.length === 0, problems.slice(-5).join(' | '));
  const standardButtons = [...window.document.querySelectorAll('button')].filter((button) => (button.textContent || '').trim() === 'Standard mode');
  click(standardButtons[standardButtons.length - 1]);
  check('switching back to Standard keeps the session and restores its AI Tutor view',
    await waitFor(() => window.document.documentElement.dataset.mode !== 'pro' && window.location.hash === '#/tutor' && text().includes('AI Tutor')),
    `mode=${window.document.documentElement.dataset.mode}; route=${window.location.hash}; ${text().slice(0, 220)}`,
  );
  click(byText('button', 'Study Lab'));
  check('Standard Study Lab remains available after returning from Pro',
    await waitFor(() => text().includes('Study Lab') && text().includes('Match pairs')),
    text().slice(0, 260),
  );

  /* ------------------------------------------------------ final report */
  const passed = results.filter((row) => row.ok).length;
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('failures:');
    failures.forEach((line) => console.log(` - ${line}`));
  }
  if (problems.length) {
    console.log('console problems:');
    problems.slice(0, 8).forEach((line) => console.log(` - ${line}`));
  }
  window.close();
  process.exit(failures.length || problems.length ? 1 : 0);
}

main().catch((error) => {
  console.error('render check crashed:', error);
  process.exit(2);
});
