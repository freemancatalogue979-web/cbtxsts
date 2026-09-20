# Quiz Arena — frontend

React 19 + Vite 6 + Tailwind v4 + `motion`, Montserrat throughout, red → purple → blue arena theme.

```bash
npm install
npm run dev         # http://localhost:5173  (proxies /api, /live and /ws to :3000)
npm run typecheck   # tsc --noEmit (strict)
npm run build       # production bundle in dist/
```

The backend must be running on **localhost:3000** — see the root `README.md` or `../start-arena.sh`.
Point the proxy somewhere else with `VITE_API_TARGET=http://host:port npm run dev`.

## Layout

```
src/
  App.tsx                 state-machine router (no react-router)
  main.tsx                SessionProvider + ErrorBoundary
  index.css               design tokens (@theme), aurora background, keyframes, print styles
  lib/
    api.ts                typed REST client + token storage
    ws.ts                 auto-reconnecting socket (live channel, duel rooms, quiz-night rooms)
    types.ts              API response shapes
    format.ts             phone/time/number formatting, tier + grade styles
    confetti.ts           canvas confetti, coin rain, celebration bursts
    motion.ts             shared animation variants
    icons.ts              badge/prize icon slugs → lucide components
    nav.ts                tab model shared by desktop nav and mobile bottom bar
    sfx.ts                dependency-free WebAudio sound effects (tap, whoosh, correct, win, chat…)
    Brand.tsx             the uploaded crest (public/brand/logo.webp) as LogoMark/Wordmark
    music.ts              generative gaming soundtrack: 4 tracks (drums/bass/arps/pads),
                          volume + track prefs, autoplay-with-fallback state machine
    photos.ts             authenticated profile-photo fetcher with an object-URL cache + hook
    prefs.ts              theme + mode (game/pro/fun) + font pack + mascot + sound preferences,
                          persisted in localStorage and applied before first paint
  store/session.tsx       auth, presence, leaderboard cache, toasts, celebration queue
  components/             ui primitives, Brand mark, AppShell, Overlays, ErrorBoundary, Mascot rig
  panels/                 Play · Study Lab · Duels · Friends · Ranks · Prizes · Feed · Profile
  views/                  Welcome (Landing + SignIn) · Dashboard · Exam · Duel · Room · Result · Admin
  admin/                  ContentAdmin · PeopleAdmin · BroadcastAdmin
scripts/
  render-check.mjs        boots the real bundle in jsdom, walks landing, registration + every tab (45 checks)
  flow-check.mjs          registration + exam run + phone navigator, mind match, course duel,
                          live duel vs a REST rival, admin + bank-draw modal (38 checks)
  mobile-audit.mjs        static scan: nothing may be too wide for a 360px phone
```

## UI checks

```bash
npx esbuild src/main.tsx --bundle --format=iife --outfile=/tmp/app.iife.js \
  --loader:.css=empty --jsx=automatic --target=es2022
node scripts/render-check.mjs
node scripts/flow-check.mjs
node scripts/mobile-audit.mjs     # no bundle needed
```

They drive the actual production bundle inside jsdom against the live API, so they catch runtime
errors a type check cannot see (they found the phone-validator, duel-card and websocket-protocol
bugs during development).

## Mobile first

Most players sit an exam on a phone, so the small-screen layout is the designed one, not a
shrink-down:

| Area | Phone | `sm` and up |
| --- | --- | --- |
| Navigation | bottom tab bar, 56px targets, home-indicator inset | top pill nav |
| Exam | fixed thumb bar (prev · navigator · next) + bottom-sheet question grid | sticky navigator rail |
| Duel | one 46px scoreboard strip (you · VS · rival) | two full player plates |
| Modals | bottom sheets with a grab handle, `94dvh` cap | centred dialogs |
| Toasts | stacked above the tab bar, newest nearest the thumb | top-right column |
| Type | inputs are 16px so iOS never zooms; headings step down one size | full scale |

`src/lib/responsive.ts` (`useIsMobile`, `useSize`) drives the few decisions that need a real pixel
value — progress rings, avatars, the duel medal. Density itself lives in the CSS: a
`@media (max-width: 639px)` block in `index.css` tightens card radii, blur and scrollbars, and
`prefers-reduced-motion` disables every animation.

## Front face

`views/Welcome.tsx` owns the two pre-auth screens and slides between them:

* **Landing** (`views/Landing.tsx`) — branded head, then `components/HeroReel.tsx`: four captioned
  frames that cross-fade with a slow Ken Burns drift so the stills play like a short clip. Autoplay
  pauses on hidden tabs, pointer-down and `prefers-reduced-motion`; players can swipe or tap the
  progress dots. Below it: live stats, a swipeable feature rail and the season top five. On phones a
  sticky "Sign in & play" bar rises once the hero scrolls away.
* **SignIn** (`views/SignIn.tsx`) — the only place anyone authenticates. While a valid number is typed
  the card asks `POST /api/auth/lookup`; a rostered number is greeted by name with its level, coins and
  streak and the display-name field disappears, so a returning player is never asked to re-register.

The hero frames live in `public/arena/*.jpg` (served at `/arena/...`, copied into `dist/` at build).

## Fun layer

* **Themes** — six palettes (Arena, Ember, Ocean, Venom, Candy and a pure black-&-white Mono) switch
  at runtime: `data-theme` on
  `<html>` plus `--qa-*` custom properties bridged into Tailwind with `@theme inline`. A pre-paint
  script in `index.html` applies the saved theme before first render; the picker lives on the You tab.
* **Mascots** — `components/Mascot.tsx` rigs three original characters (Bolt, Pixel, Goober) on one
  SVG skeleton with five moods (idle, think, cheer, sad, dance). The exam header mascot reacts to your
  answers; the celebration overlay dances with whichever one you picked.
* **Question cards** — `components/QuestionCard.tsx` is the signature shell every question renders in:
  gradient hairline frame, ghost number, chip header and quote bar (exams **and** all study modes).
* **Music** — `lib/music.ts` synthesises a loud, tempo-locked gaming soundtrack: four tracks
  (Arena Pulse / Neon Drive / Focus Flow / Boss Battle) with kick-snare-hat drums, filtered bass and
  arps on a 16th-note grid, through a compressor. Volume slider + track picker + on/off in
  Profile → Make it yours, quick toggle in the header, and a floating **Start music** pill whenever
  the browser blocks autoplay.
* **Profile photos** — upload in Profile (canvas-cropped to 256px, stored in the DB); `lib/photos.ts`
  fetches them once through the bearer API and every `Avatar` swaps initials for the real face.
* **Sound** — `lib/sfx.ts` synthesises every cue with WebAudio (no audio files): taps, ticks, whooshes,
  correct/wrong stings, coin chimes, win/lose fanfares, chat pings. Unlocked on first pointer/key event,
  master mute on the You tab.
* **Swipe exams** — swipe down = next question, swipe up = previous; swiping past the last question
  opens the submit sheet. The navigator filters All / To-do / Flagged.
* **Friends & chat** — `panels/FriendsPanel.tsx`: presence-sorted friend list (with their status
  lines) and unread badges, IM threads (text + quick phrases), **swipe any bubble left to
  quote-reply** (hover → Reply on desktop), one-tap **nudges**, duel invitations (join straight from
  the message card) and scheduled study plans sent inside the thread. Delivery is live over the
  socket with echo-suppression and auto read-receipts when the thread is open.
* **Study Lab** — `panels/StudyPanel.tsx`: the shared daily challenge (same five questions for
  everyone), Blitz (10 questions / 60 seconds), Sudden Death (one miss ends the run), self-grading
  flashcards, **ask-a-friend** help requests that pay tutor points for correct help, six weekly
  missions, the once-a-day lucky spin and a coin shop (streak freezes, 24h double XP, avatar
  flairs) — every mode graded server-side, plus a personal analytics strip (accuracy, predicted
  grade, weakest course, tutor points).

## Rules of the house

* Never trust the client with the answer key — the API omits `correct`/`explanation` until review.
* Every screen is mobile-first: bottom tab bar, 44px+ tap targets, safe-area padding.
* Nothing may overflow sideways — `body` clips on the x axis and `mobile-audit.mjs` fails the build
  if a fixed width or a cramped grid sneaks in.
* No data lives in `localStorage` except the session token (`arena.token`, `arena.role`), the
  "announcements seen" timestamp and the three appearance prefs (`arena.theme`, `arena.mascot`,
  `arena.sound`).
* Animations respect `prefers-reduced-motion`; haptics (`src/lib/haptics.ts`) are opt-out the same way
  and no-op where `navigator.vibrate` is missing.
