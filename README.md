# Quiz Arena

A real-time computer-based testing **and** quiz-competition platform: timed exams, live 1v1 duels,
XP, levels, streaks, coins, badges, leaderboards and a prize vault — for the UNN Faculty of Law
(or any institution you configure).

```
backend/    FastAPI + SQLAlchemy + SQLite + WebSockets   → http://localhost:3000
frontend/   React 19 + Vite + Tailwind v4 + Montserrat/Audiowide → http://localhost:5173
```

---

## Quick start

You need **Python 3.11+** and **Node 18+** installed once. Then:

```bash
./start-arena.sh          # macOS / Linux — installs both dependency sets, runs API + web app
```

```bat
start-arena.bat           :: Windows — same thing, opens two terminal windows and your browser
```

Both scripts are idempotent: they create `backend/.venv`, install `backend/requirements.txt` and
`frontend/package.json`, start the API on **:3000** and the web app on **:5173**, and the database
seeds itself on first boot. Stop them with `Ctrl+C` (or by closing the two Windows terminals).

Or run them separately:

```bash
# 1. API (port 3000)
cd backend
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 3000 --reload --reload-dir app

# 2. Web app (port 5173, proxies /api and /ws to :3000)
cd frontend
npm install
npm run dev
```

```bat
:: Windows, two terminals
cd backend
py -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\uvicorn app.main:app --host 0.0.0.0 --port 3000 --reload --reload-dir app

cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**.

* First boot creates `backend/data/arena.db` and seeds **content only**: **93 questions** across
  **4 exams**, **16 badges**, **9 prizes** and a few announcements. **No students are seeded** —
  every account is a real registration.
* The front face is a branded landing page (animated picture reel of the uploaded game splash art, live
  stats, current top five) wearing the uploaded **Quiz Arena crest** everywhere the brand appears —
  header, sign-in, favicon — with a game-HUD look (glossy coin/gem pills, gold XP bars, violet washes)
  guided by the brand theme board. The sign-in form lives on its own screen — on a phone they are
  strictly separate views with a button between them.
* Players **register once** (`POST /api/auth/register`) with a **unique username**, a **unique phone
  number** and a **password** (duplicates are rejected with 409), then sign in (`POST /api/auth/student`)
  with username-*or*-phone plus the password. `+234`, `00234` and bare 10-digit forms all resolve to the
  same account. New accounts join with 100 coins and 25 XP. Every player on the board is real.
* Staff console: **Staff** button in the landing header (or the Staff tab on the sign-in screen) →
  `admin@quizarena.ng` / `arena2026`.
  Change those with `CBT_ADMIN_EMAIL` / `CBT_ADMIN_PASSWORD` before deploying anywhere real.

Interactive API docs: **http://localhost:3000/docs**.

---

## What players get

| Area | Detail |
| --- | --- |
| **Exams** | Server-authoritative timer, autosave on every answer, flag for review, **resumable after a refresh, crash or leaving mid-paper** — the clock keeps running on the server. When staff activate an exam every signed-in player gets a live **compulsory-exam banner** with the closing countdown; once the window shuts the paper is **results only**, no retakes. Per-quiz deterministic question order, instant grading (A1–F), rank within the cohort, XP + coins + badge rewards. Correct answers are never sent to the browser before submission. |
| **Multiplayer rooms** | Quiz nights for **up to 15 players** over a dedicated WebSocket channel. The **host** picks the bank (one course or the whole arena), the length and the per-question clock, starts the run and paces it (reveal early, next question, kick); **guests** race the clock — points decay with speed, the scoreboard reorders live, every question reveals its answer and explanation to the whole room, and the **room chat** runs from lobby to final standings so players can talk, hype or ask about the question in front of them. Top three earn bonus XP and coins; everyone earns per correct answer. |
| **Ranked matches** | A dedicated **Ranked** tab: pick a course, hit **Find match** and the server matchmakes you with up to **15 players** (a match starts as soon as **2** are ready — the queue screen's found-count and growing target show the search expanding, and it never demands a full room). The **lobby counts down on the server clock** with every player's photo, rating, tier, level, connection dot and ready check, then everyone answers the **same questions on one shared window** — answers are graded server-side, standings reorder **live over WebSocket**, and a subtle activity feed notes only what matters ("Alex moved into 1st", "Daniel completed question 8"). Scoring is **accuracy-dominant**: 60 base points for a correct answer, at most 30 for speed, 10 per streak step — a correct click always beats a fast wrong one, and the formula lives only on the server. Results show your place (2nd of 8), score, accuracy and correct count with **rating movement (1,248 → 1,276 +28)** across seven tiers — Bronze, Silver, Gold, Platinum, Diamond, Master, Grandmaster — plus a ladder of top players, your neighbours, full answer review and one-tap **Play again**. On phones the in-match leaderboard is a bottom sheet that never covers the question. |
| **Arena events** | Staff-created, **no-cap** competitions with their own tab: upcoming cards count down on the **server's clock** (never the phone's) with the prize pool, entry requirement and player count; live events serve a fixed question order at each player's own pace — **join, leave and return with your progress intact** until the event ends, and closing the browser never pauses a timed one. The global leaderboard ships only the **top, your own row and your neighbours** (a 5,000-player event costs the same as a 50-player one), a lightweight activity line notes milestones only, and when the server finalizes, positions, placement-scaled rewards (XP, coins, diamonds, winner's badge) and results notifications land automatically. Past events keep your position, score, accuracy, rewards and a full answer review. |
| **Duels** | Live 1v1 over WebSocket. Challenge a friend by phone, publish an open duel with a 6-character join code, or hit **Quick match** — and pick the question source first: **one course's bank or a random mix**. Each question is a **round**: round counter, what it is worth, a draining **speed-bonus meter** (decays over 20s), a live **combo meter** (4 correct in a row), and the server's own verdict banner — **POINT WON!** with the points banked, or **NOT QUITE** — while the answer key stays hidden until the duel ends. Stakes are escrowed at start and paid to the winner; cancels refund. |
| **Progression** | XP → 60 levels (`125 × (L−1) × L`), titles from *Rookie* to *Arena Deity*, bronze/silver/gold/platinum tiers, daily streak bonus, 16 badges with one-off rewards. |
| **Leaderboards** | All-time, weekly (resets Monday), friends-only and duel-wins scopes, pushed live to every connected client when someone submits. |
| **Prizes** | Admin-configurable vault: rank-locked rewards (top 3, top 10…) and coin purchases, with stock limits and a claim workflow (pending → approved → delivered). |
| **Social** | Friends by phone or name, player search, public profiles, personal and global activity feeds, live presence. |
| **Friends & chat** | A dedicated Friends tab: who is online, instant-message threads (text + quick phrases, **swipe a bubble to quote-reply**), one-tap nudges, duel invitations and scheduled study plans sent **inside** the thread, unread badges and live delivery over the socket. |
| **Study Lab** | A whole tab of extra ways to study: the shared **daily challenge** (same five questions for everyone), **Blitz** (ten questions, 60 seconds), **Sudden Death** (one miss ends the run), self-grading **flashcards**, **ask-a-friend** help requests that pay tutor points for correct help, weekly **missions**, the **lucky spin**, a **coin shop** (streak freezes, 24h double XP, avatar flairs) and the new **Mind Match** mini game — twelve face-down tiles, pair every question with its answer, scored on flips and speed. All graded server-side. |
| **Custom Practice** | Play → **Practice**: pick a **course → topic → number of questions → duration** and start. The server draws **random unique questions** from that topic's bank (never more than exist — *"Only 15 questions are available for this topic"*), shuffles the question order per session and **shuffles each question's options** — the correct answer is bound to its option's canonical key, never to a display letter, so shuffling can never move it. The **timer is server-stamped** (`ends_at` on the run): refreshing restores the *same* paper — same questions, same order, same option shuffles, same progress — at the first unanswered question, and answers after 00:00 are refused server-side. Every answer gets an instant verdict with the **stored explanation**, and the finished run shows a full summary (score %, time used) plus a **review of every question** with your answer vs the right one. |
| **Signature question cards** | Questions never render as plain text: every question — exam papers, blitz, sudden death, daily challenge, flashcards, Mind Match tiles — sits in a unique gradient-framed card with a ghost question number, shine sweep, difficulty chip and a brand-gradient quote bar. |
| **Personal notifications** | Help requests, answers and nudges land in a personal inbox with live socket delivery; the bell merges them with announcements. Players carry a bio, a status line and a shareable 6-character player code for instant friend adds. |
| **Make it yours** | Three **modes** — **Game** (the full arena HUD), **Pro** (mascots and arcade chrome stripped for a clean professional surface) and **Fun** (bouncy mascots, wiggling titles, saturated glows) — six switchable themes (Arena, Ember, Ocean, Venom, Candy and a pure black-&-white **Mono**), a **font switcher** (**Quite Magical** hand-lettered default, Montserrat, Exo 2 classic, Space Grotesk, Orbitron display), three animated mascots (Bolt, Pixel, Goober) that react to how an exam is going and dance on the win screen, WebAudio sound effects with a master mute, and swipe up/down exam navigation. All device-local, applied before first paint. |
| **Background music** | Three uploaded tracks (**Arena Rock**, **Arcade Session**, **Sound Surfer**) played from `frontend/public/music`, with on/off, pause/resume, track switch and a volume slider in Profile → Make it yours plus a quick toggle in the header. Pause holds your place to the second, mute is a gain fade rather than a stop, and no two tracks ever sound at once; the generative synth only steps in when a device cannot play a file. It tries to autoplay; when the browser refuses, a floating **Start music** button waits for the first tap. |
| **Shell & navigation** | A floating HUD instead of a banner: the top bar has no strip, blur or shadow — every control carries its own chip and rides on top of the scrolling world, so nothing is covered and nothing disappears. **Every screen is a real page** (`#/study`, `#/exam/42`, `#/duel/7`): the in-page back button, the Android back button, the iOS edge swipe and the browser's back all land on the page you actually came from, and a refresh puts you back where you were — including mid-exam, on the same attempt. |
| **Fixed scale** | The arena renders at exactly the viewport it lands on: `maximum-scale=1` + `user-scalable=no`, `touch-action: pan-x pan-y` on the body, and a gesture guard for iOS Safari's `gesture*` events and desktop ctrl/cmd + wheel or `+`/`-` zoom. Pinch, double-tap and browser zoom are off on phones and desktops; panning, scrolling and every tap still work. |
| **Arena shop & inventory** | Split-tier economy with **Coins** (earned through questions, materials, daily quests, duels, streaks) for everyday cosmetics, and **Diamonds** (strictly earned from major milestones, long streaks, course completions, and rank promotions — never casually farmable, never convertible from coins) for ultra-rare trophies. Features an animated marketplace with rotating **featured shelves**, **daily deals** (live midnight countdown), the **Dark Academy** limited-time event, **earned mystery chests** (open for coins, XP, diamonds, or cosmetics), and the **Diamond Vault** (up to 25k diamonds for The Arena Founder). The **Inventory** tab lets players view their active loadout, equip 8 cosmetic slots (Avatar, Aura, Frame, Title, Theme, Chat, Duel, Answer), and inspect each item's **history plaque** (Rarity, Release Season, Total Owners count, and Obtained From provenance). Desktop views render at full viewport width with zero cut aspect ratios. |
| **Profile photos** | Upload your own picture (cropped square, downscaled to 256px in-browser, stored in the database — no file drops). It replaces your initials everywhere people see you: chat, friends, ranks, duels, feeds and your profile, with a one-tap remove. |

## What staff get

Courses, exams, questions (single **or** bulk paste-import), scheduling and status control.
Every question belongs to its course's **single question bank**; any exam carries a
**Draw from Question Bank** button — pick a number (10/20/50/70 or exact), and the system
randomly pulls that many questions from *that course only*, never repeating one already in
the exam. The correct answer may be given as a letter (**B**) *or as the option's actual
text* (**Savigny**) — the text is resolved to the option's canonical key on upload, so it
stays correct however options are later shuffled; an ambiguous or unknown answer is
rejected with a reason, never defaulted. Also: player management
(search, XP/coin adjustments, ban, delete), results with per-exam CSV export,
announcements that broadcast live to connected players, the prize vault, claim approvals, badge
statistics, and arena settings (institution, season, grading scale, gameplay switches).
Staff also create **arena events** from the console's *Arena events* section: name, description,
course (+ optional topics), start/end on the server clock, question count, timing mode (fixed
duration / timed per question / untimed), entry requirement, visibility, the reward stack
(XP, coins, diamonds, winner's badge) and the join/leave/leaderboard rules — with edit for
anything not finished and delete for anything not live.

---

## Architecture

### Backend (`backend/app`)

| Module | Role |
| --- | --- |
| `main.py` | App factory, CORS, lifespan (seed + the 5s game ticker that expires overdue attempts/duels and starts/finalizes events, plus the 1s ranked ticker that matchmakes and paces matches) |
| `config.py` | Environment-driven settings and gameplay tuning constants |
| `db.py` | SQLAlchemy engine/session (`SQLite` + WAL, foreign keys on) |
| `models.py` | 31 tables: students, admins, friendships, courses, quizzes, questions, attempts, answers, duels, duel participants/questions/answers, **rooms, room members/questions/answers/messages**, badges, student badges, prizes, prize claims, activities, notifications, chat messages, help requests, rush runs, daily-challenge results, mission claims, reactions, inbox notes, config, **ranked queue/matches/participants/answers/questions, arena events + participants/answers/questions, practice runs** |
| `security.py` | HMAC-signed JSON tokens (7-day TTL), phone normalisation (`+234` ↔ `0`), PBKDF2-SHA256 (240k) password hashing for staff **and** players |
| `game.py` | Level curve, titles, tiers, grading scale, XP/coin reward maths, badge rules |
| `services/exam.py` | Attempt lifecycle: start, autosave, expiry, grading, ranking, rewards |
| `services/duel.py` | Duel lifecycle: invite, open code, quick match, live scoring, finalisation, expiry |
| `services/room.py` | Room lifecycle: create, join-by-code (15-cap), host start/kick, per-question clocks with server-side auto-reveal, live standings, rewards, chat persistence |
| `services/ranked.py` | Matchmade matches: per-course queue (min 2, cap 15, 12s grace), server lobby countdown, shared question windows, accuracy-dominant scoring, multiplayer Elo + 7 configurable tiers, history/ladder payloads |
| `services/events.py` | Arena events: server-clock start/end, pre-registration, resume-safe progress, top+own+nearby leaderboards, cooldown-gated activity, finalize with placement-scaled rewards and notifications |
| `ws.py` | Connection hub with `live`, `duel:{id}`, `quizroom:{id}`, `ranked:{id}`, `event:{id}` and `admin` rooms plus presence tracking (incl. per-room student ids) |
| `events.py` | Event objects the services return; routers dispatch them **after** commit |
| `serializers.py` | The only place models become JSON — enforces the "never leak the answer key" rule |
| `routers/*` | 143 REST endpoints + 5 WebSocket endpoints (`/ws/live`, `/ws/duel/{id}`, `/ws/room/{id}`, `/ws/ranked/{id}`, `/ws/event/{id}`) |
| `seed.py`, `seed_data/` | Idempotent content-only seeding (question bank, badges, prizes) — never fabricates players |

Design rules that keep the game honest:

* Services never commit; routers commit and then dispatch events.
* All timestamps are naive UTC in SQLite and serialised with a trailing `Z`.
* `question_public(reveal=False)` strips `correct` and `explanation`; only submitted reviews,
  finished duels and admin views reveal them.
* Deadlines live on the server (`attempt.deadline_at`, `duel.expires_at`) — a stalled tab cannot
  buy time; the ticker finalises overdue attempts and duels.
* **Real data only** — seeding creates content, badges and prizes but fabricates no people and no
  progress: every account is a real registration starting at zero, leaderboards list only players
  who have actually played, and study-mode grading (rush windows, daily picks, missions, spins)
  is all server-side.

### Frontend (`frontend/src`)

| Path | Role |
| --- | --- |
| `App.tsx` | State-machine router (login → dashboard → exam/duel/room/result → admin) |
| `store/session.tsx` | Auth, live socket, presence, leaderboard cache, toasts, celebration queue |
| `lib/api.ts` | Typed REST client (token handling, error normalisation) |
| `lib/ws.ts` | Auto-reconnecting WebSocket client (token in query, heartbeat, duel rooms) |
| `lib/confetti.ts` | Dependency-free canvas confetti / coin rain (respects `prefers-reduced-motion`) |
| `components/` | Design-system primitives, brand mark, toasts, celebration overlay, app shell |
| `panels/` | Play · Study Lab · Duels · Friends · Ranks · Prizes · Feed · Profile |
| `views/` | Welcome → Landing/SignIn front face, Dashboard, Exam engine, Duel arena, Result slip, Admin console |
| `admin/` | Content, people/results/claims, broadcasts/prizes |

Design: deep ink background with red → purple → blue aurora glows (plus five alternate themes,
switched with one tap on the You tab), Exo 2 body + **Audiowide** display typography (italic wordmark), glass cards, SVG icon
set (lucide), a mobile bottom tab bar, selectable animated mascots, WebAudio sound effects, and
motion-driven transitions.
The Vite dev server proxies `/api`, `/live` and `/ws` to the backend so the browser only ever
talks to one origin.

## Music

The soundtrack is three uploaded tracks, shipped in `frontend/public/music/` and served from
`/music/<file>.mp3`:

| id | name | file | length |
| --- | --- | --- | --- |
| `rock` | Arena Rock | `alex-morgan-gaming-rock-545508.mp3` | 1:50 |
| `arcade` | Arcade Session | `alex-morgan-gaming-stream-arcade-session-578484.mp3` | 2:07 |
| `surfer` | Sound Surfer | `soundsurfer-gaming-331807.mp3` | 2:14 |

`frontend/src/lib/music.ts` plays them through one transport with two backends: an `<audio>`
element per file track (position-exact pause/resume, looped for the whole track) and a generative
synth that stands in only when a device cannot play the file — the arena is never silent, and the
three files stay the only music the deck offers. The rules the transport enforces:

* **Pause keeps your place.** A file element resumes from the sample it stopped on; the synth keeps
  its bar counter and re-anchors to "now + one breath".
* **Mute is not pause.** It fades the master bus and leaves playback running, so unmuting lands
  mid-phrase as if you never touched it.
* **A switch stops the old track dead.** Every playback generation owns a gain bus; a switch
  disconnects it, killing queued notes and sustained pads instantly.
* **A sleeping tab never catches up.** The scheduler re-anchors after a clock jump, so a background
  tab resumes with the next bar instead of dumping every bar it slept through (measured: 90 note
  starts piled on one instant before that guard existed, 0 after).

`node scripts/music-check.mjs` proves all four against a recording fake audio graph — 50 checks in
three suites: the uploaded files and the transport above, the synth fallback for a file the device
cannot play, and the no-media path.

## Seasons

A season is one calendar month (`YYYY-MM`, epoch 2025-09 = season #1), so the ladder resets
twelve times a year while lifetime XP, coins, mastery and trophies never do. Everything about it
lives in `backend/app/services/season.py`:

* **100 levels** on a public curve — level 1 is free, level 2 costs 46 XP, every level after costs
  a little more (level 50 sits at 16,366 XP, level 100 at 62,766).
* **12 rank badges** — bronze, silver, gold, platinum, diamond, master, grandmaster, elite,
  champion, legend, mythic, celestial — each with its own glyph and deep/bright palette that the
  frontend paints with (no image assets to ship).
* **XP is server-side only.** `game.grant()` writes the granted amount into the month's
  `SeasonStat` row; claiming a season reward passes `season=False`, so a payout can never push a
  player up the ladder.
* `GET /api/arena/season` returns the window, the player's standing (`me_season`), the full ladder,
  the hundred level thresholds and six months of history. The player's own badge also rides on the
  profile payload, so the hero, the account menu, the world-map HUD and the character screen can
  wear it.
* **One door for XP.** Every award goes through `game.award_xp()`: lifetime XP, this week's XP and
  the month's season XP move together. Badge payouts, the arcade, Study XP, materials and staff
  awards all land there, so the badge can never drift behind the XP bar. A negative staff
  correction is the one thing that touches lifetime XP alone — a season already played is not
  rewritten. The suite proves it: for an account created this month, lifetime XP and season XP are
  equal, and 90 XP of drift is exactly what the check caught before this was one door.
* **The ladder announces itself.** Every grant that climbs a level returns a `season_level` event
  alongside the XP (`game.grant` -> `season.record`), so the client can show the badge the moment it
  is earned. Crossing a rank opens the badge card; a plain level rides along in the reward toast.
  When a new month starts the first screen of the season says so, and says what the last one ended
  on, instead of the badge silently disappearing overnight.

---

## Testing

Six suites, all runnable against live servers:

```bash
# Backend: 145 end-to-end REST + WebSocket checks (auth, exams, duels, chat, study modes, bank draws, photos,
#         help requests, missions, shop, ranks, prizes, admin)
cd backend && ./.venv/bin/python scripts/smoke.py

# Frontend: 90 checks — boots the real bundle in jsdom, walks the landing page, every tab (including Shop),
#           the live season climb, the month rollover and the ladder
cd frontend && node scripts/render-check.mjs

# Backend: 105 checks — the answer contract, the world map, chat hold-to-act, the season
#          ladder, authoritative shop economy, diamond milestones, cosmetic catalog integrity,
#          and ownership verification
cd backend && ./.venv/bin/python tests/verify_arena.py

# Frontend: 42 checks — full exam submission (including the phone thumb bar and
# navigator sheet), the Mind Match mini game, a live duel against a second player
# driven over REST, and the admin console
cd frontend && node scripts/flow-check.mjs

# Frontend: static layout audit — fails if any screen cannot fit a 360px phone, if a
#           picker card loses its short phone copy, if any layer of the fixed-scale
#           viewport lock disappears, and the daylight guard — white type on the bright skin
cd frontend && node scripts/mobile-audit.mjs && node scripts/theme-audit.mjs

# Frontend: 50 audio-transport checks — boots the real music engine against a
#           recording fake AudioContext: pause keeps your place, resume continues
#           the phrase, a throttled tab never machine-guns the bars it missed,
#           mute is a gain fade that leaves the transport running, and switching
#           tracks disconnects the old generation so two tracks cannot mix
cd frontend && node scripts/music-check.mjs

# Practice system: 58 backend checks (catalog counts, size caps, random unique
#                  draws, shuffle-safe grading, refresh survival, the server
#                  clock, text-form answer uploads, legacy modes) plus 23 UI
#                  checks driving the real bundle through setup → run → verdict
#                  → refresh-resume → summary + review. The backend suite needs
#                  the same CBT_DATABASE_URL the server was started with.
cd backend && ARENA_API=http://127.0.0.1:3000/api .venv/bin/python scripts/verify_practice.py
cd ../frontend && node scripts/practice-check.mjs

# Ranked multiplayer: 39 backend checks (tier ladder, queue isolation per course,
#                     matchmaking min-2, lobby countdown, hidden answers, accuracy-
#                     dominant scoring, live standings, Elo zero-sum, history, ladder
#                     slices, double/foreign-answer guards) — needs the live ticker,
#                     i.e. a running server, and takes ~90s of real server pacing.
cd backend && ARENA_API=http://127.0.0.1:3000/api .venv/bin/python scripts/verify_ranked.py

# Arena events: 32 backend checks (admin creator round-trip, upcoming lobby, pre-
#               registration, server-clock start, resume-safe progress, entry
#               requirements, join rules, leaderboard slices, finalize with
#               placement-scaled rewards, history, review, notifications).
cd backend && ARENA_API=http://127.0.0.1:3000/api .venv/bin/python scripts/verify_events.py

# Frontend: 26 checks — the real multiplayer loop through the real bundle: sign in,
#           queue with a live API opponent, lobby countdown, ten questions answered
#           by clicking, standings bottom sheet, results with rating movement,
#           answer review, and the Events tab. Needs the API on :3000, the dev
#           server on :5173 and /tmp/app.iife.js; takes ~2 minutes of real pacing.
cd frontend && node scripts/ranked-check.mjs

# Layout arithmetic: computes the real rendered width of the AppShell header at
#                    every breakpoint from 320 to 1920px (student, staff and
#                    long-display-name variants) from the actual Quite Magical
#                    font metrics, so the desktop nav cannot overcrowd and no
#                    viewport can horizontally overflow. Needs fonttools + brotli.
cd frontend && python3 scripts/header-fit.py
```

Both frontend harnesses build the bundle first:

```bash
cd frontend && npx esbuild src/main.tsx --bundle --format=iife --outfile=/tmp/app.iife.js \
  --loader:.css=empty --loader:.webp=file --loader:.png=file --loader:.jpg=file \
  --loader:.jpeg=file --loader:.woff2=file --loader:.mp3=file \
  --jsx=automatic --target=es2022
```

Type checking and production build:

```bash
cd frontend && npm run typecheck && npm run build
```

---

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `CBT_PORT` / `CBT_HOST` | `3000` / `0.0.0.0` | API bind address |
| `CBT_DATABASE_URL` | `sqlite:///backend/data/arena.db` | Any SQLAlchemy URL (Postgres works) |
| `CBT_SECRET_KEY` | dev placeholder | Token signing key — **set this in production** |
| `CBT_TOKEN_TTL_HOURS` | `168` | Session lifetime |
| `CBT_ADMIN_EMAIL` / `CBT_ADMIN_PASSWORD` | `admin@quizarena.ng` / `arena2026` | Bootstrap staff account |
| `CBT_CORS_ORIGINS` / `CBT_CORS_REGEX` | localhost + `*.e2b.app` | Allowed browser origins |
| `VITE_API_TARGET` | `http://127.0.0.1:3000` | Where the dev server proxies |

See `backend/.env.example`.

---

## Notes on the migration

This repository previously held a client-side CBT app (localStorage + optional Firestore,
registration-number login, answers shipped to the browser). That implementation was removed and
its **data** was migrated into the database layer:

* `students.json` (356 records) → `students` table, each assigned a deterministic Nigerian phone
  number because login is now phone-based. Original names, reg numbers, levels and classes kept.
* `seedQuestions.json` (70 Constitutional Law questions) → `questions` table, attached to the
  *Constitutional Law Arena Exam*, plus three smaller exams built from the same bank.
* Firebase config, Firestore rules and the ~9 MB of duplicate logo imagery were deleted.

Nothing is stored in the browser except the session token; the database is the only source of truth.

---

## Font licensing note

The default UI typeface **Quite Magical** (by Misti's Fonts / Misti Hammers, 2018) ships as
`frontend/public/fonts/quite-magical.woff2` and is free for **personal use**; commercial use
requires a licence from the designer (mistifonts.com). If this project is deployed
commercially, buy the licence or swap the default in `frontend/src/lib/prefs.ts` — the font
switcher and the other four packs (Montserrat, Exo 2, Space Grotesk, Orbitron) are all
libre-licensed fallbacks that keep the app fully functional.
