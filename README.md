# Absolute Genesis

*A completely new beginning.*

A real-time computer-based testing **and** quiz-competition platform: timed exams, live 1v1 duels,
XP, levels, streaks, coins, badges, leaderboards and a prize vault — shipped with **ENG 101 Use of
English** and **MTH 101 Elementary Mathematics** (or any institution and courses you configure).

```
backend/    FastAPI + SQLAlchemy + SQLite + WebSockets   → http://localhost:3000
frontend/   React 19 + Vite + Tailwind v4 + Montserrat/Audiowide → http://localhost:5173
```

---

## Quick start

You need **Python 3.11+** and **Node 18+** installed once. Then:

```bash
./start-arena.sh          # Linux/VPS — installs dependencies and starts both in the background
./start-arena.sh status   # confirm that API and web are running
./start-arena.sh logs     # follow logs; Ctrl+C only closes the log viewer
./start-arena.sh restart  # restart after changing server configuration
./start-arena.sh stop     # stop both services
```

The Linux launcher uses independent `nohup`/`setsid` services, so the API and web app **keep
running after you close SSH or the terminal**. Runtime logs and PID files live in the ignored
`.arena-run/` directory. Use `./start-arena.sh foreground` when developing locally and you do want
both processes attached to the current terminal.

```bat
start-arena.bat           :: Windows — opens two terminal windows and your browser
```

Both launchers are idempotent: they create `backend/.venv`, install `backend/requirements.txt` and
`frontend/package.json`, start the API on **:3000** and the web app on **:5173**, and the database
seeds itself on first boot.

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

* First boot creates `backend/data/arena.db` and seeds **content only**: **2 courses** (ENG 101 Use of
  English, MTH 101 Elementary Mathematics) with **166 banked questions** (73 + 93), **4 exams** that
  draw from those banks, **16 badges**, **9 prizes** and a few announcements. **No students are
  seeded** — every account is a real registration. On every boot the seeder also deletes the retired
  law catalogue (`LAW 411`, `LAW 421`, `LAW 431`) — courses, banks, exams and attempts — from any
  database that still holds it.
* The front face is a branded landing page (animated picture reel of the uploaded game splash art, live
  stats, current top five) wearing the **Absolute Genesis crest** everywhere the brand appears —
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

### Mobile visual audit

After starting the app, install Playwright's browser once and run the automated phone/tablet audit:

```bash
cd frontend
npx playwright install chromium
npm run audit:visual
```

It checks Pro at 320px, 390px and tablet width plus the mobile staff console, fails on page/card
overflow, and writes full-page evidence to `frontend/test-results/visual/` (git-ignored). Run it after
changing cards, navigation, dialogs, typography or responsive CSS.

### Background work

Long material imports already run in a bounded worker pool and AI course jobs use their own durable
queue with progress, cancellation, cost ceilings and restart recovery. Server clocks also execute DB
work off the async request loop. `/api/health` reports queued/running AI work and active import jobs;
graceful shutdown now stops the import executor so a deploy does not leave orphaned workers.

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
| **Background music** | Three uploaded tracks (**Arena Rock**, **Arcade Session**, **Sound Surfer**) played from `frontend/public/music`, with on/off, pause/resume, track switch and a volume slider in Profile → Make it yours plus a quick toggle in the header. Pause holds your place to the second, mute is a gain fade rather than a stop, and no two tracks ever sound at once. Nothing else ever plays — there is no synth or fallback music. It tries to autoplay; when the browser refuses, a floating **Start music** button waits for the first tap. |
| **Shell & navigation** | A floating HUD instead of a banner: the top bar has no strip, blur or shadow — every control carries its own chip and rides on top of the scrolling world, so nothing is covered and nothing disappears. **Every screen is a real page** (`#/study`, `#/exam/42`, `#/duel/7`): the in-page back button, the Android back button, the iOS edge swipe and the browser's back all land on the page you actually came from, and a refresh puts you back where you were — including mid-exam, on the same attempt. |
| **Fixed scale** | The arena renders at exactly the viewport it lands on: `maximum-scale=1` + `user-scalable=no`, `touch-action: pan-x pan-y` on the body, and a gesture guard for iOS Safari's `gesture*` events and desktop ctrl/cmd + wheel or `+`/`-` zoom. Pinch, double-tap and browser zoom are off on phones and desktops; panning, scrolling and every tap still work. |
| **Arena shop & inventory** | Split-tier economy with **Coins** (earned through questions, materials, daily quests, duels, streaks) for everyday cosmetics, and **Diamonds** (strictly earned from major milestones, long streaks, course completions, and rank promotions — never casually farmable, never convertible from coins) for ultra-rare trophies. Features an animated marketplace with rotating **featured shelves**, **daily deals** (live midnight countdown), the **Dark Academy** limited-time event, **earned mystery chests** (open for coins, XP, diamonds, or cosmetics), and the **Diamond Vault** (up to 25k diamonds for The Arena Founder). The **Inventory** tab lets players view their active loadout, equip 8 cosmetic slots (Avatar, Aura, Frame, Title, Theme, Chat, Duel, Answer), and inspect each item's **history plaque** (Rarity, Release Season, Total Owners count, and Obtained From provenance). Desktop views render at full viewport width with zero cut aspect ratios. |
| **Profile photos** | Upload your own picture (cropped square, downscaled to 256px in-browser, stored in the database — no file drops). It replaces your initials everywhere people see you: chat, friends, ranks, duels, feeds and your profile, with a one-tap remove. |

## What staff get

Courses, exams, questions (single **or** bulk paste-import), scheduling and status control.

**Question banks and exams are three separate things:**

| concept | where it lives | example |
| --- | --- | --- |
| **Course question bank** | every course owns one bank (a hidden `is_bank` quiz); bank originals have `exam_only = false` and no `source_id` | 10,000 questions |
| **Questions per player** | `Quiz.draw_count` on a *Random from course* exam — never changes the bank | 40 |
| **Exam-specific questions** | rows owned by one exam with `exam_only = true`; never in the bank unless staff tick *Also add to the bank* | a fixed 30-question paper |

The exam builder's **Question source** picks one: **Random from course** (choose the course and
how many questions each player gets, optionally limited to topics and/or a difficulty mix that
must add up to the count) or **Exam-specific** (questions created, uploaded or imported for that
exam only). A random exam copies nothing — each player gets their own random draw from the
course bank when they start, stored on their attempt (`Attempt.question_ids`) so refresh and
grading use the same paper, and two players get different papers. The bank keeps topic and
difficulty on every question for distribution control. The admin *Courses & exams* area is
organised by course: each course opens a workspace with **Overview · Topics · Question bank ·
Notes · Materials · Discussion**, and nothing from one course shows up in another.

**Importing materials instead of typing them.** In a course's *Notes* or *Materials* tab,
**Import** takes one or more files — Word (`.docx`), PDF, text (`.txt`), Markdown, OpenDocument
(`.odt`), RTF, HTML or PowerPoint (`.pptx`), up to 20 MB each. The server reads each file and
shows what it found (name, word count, sections); staff only confirm the basics — the name
(pre-filled from the document), topic and whether to publish now — and the document becomes the
content. Word/ODT headings become sections, bullets and numbered lists stay lists, tables stay
tables, each slide becomes a section, and long documents are split into readable sections
without dropping a word. The original file is kept (optional) so players can open or download
it from the reader. Old `.doc`/`.ppt` files, scanned PDFs with no text and unsupported types are
refused with a reason (for example *"In Word choose File → Save As → .docx"*). The reader lives in
`backend/app/services/material_import.py` (standard library + `pypdf`, no extra dependencies);
uploaded originals are stored in `backend/data/material_files/` (git-ignored).

**Inside a material: sub-tabs, notes, undo.** Opening a material shows sub-tabs instead of one
long page: **Read** (what players see, including unsaved edits) · **Content** (sections and
blocks, with **Undo / Redo** of edits until you save) · **Notes** · **Details** (course, topic,
link, duplicate / archive / delete) · **History** (every save is a version: **Restore** any of
them, or **Undo last save**; a restore is saved as a new version, so it can be undone too) ·
**Insights** (linked questions and analytics). On phones the tabs wrap into a 3×2 grid. The
**Notes** tab lists notes that belong to that material (`materials.parent_id`) as compact cards
with Read, Edit, History and Delete, plus New note and Import; the last add, edit or delete can
be undone straight from a banner. The notes also appear in the course's Notes tab, marked
*in &lt;material&gt;*, and players get a **Lecturer notes** tab in the reader. Deleting a material keeps
its notes in the course. API: `parent_id` on create/update, `GET /api/admin/materials?parent_id=`,
`POST /api/admin/materials/{id}/versions/{version_id}/restore`, `GET /api/materials/{id}/staff-notes`.
**Players' own notes (reader → Notes tab).** While reading a material, players switch between
**Reading · Notes · Lecturer** (Lecturer appears when staff attached notes). In **Notes** a player
writes notes on what they learned (optional title, the text, and which section it is about),
opens and reads them, edits and deletes them, and can **Undo** the last add, edit or delete from
a banner. Notes are private to that player. The quick note box under the reading saves into the
same list. API (player token): `GET /api/materials/{id}/notes`, `POST …/notes`,
`GET|PATCH|DELETE …/notes/{note_id}`; a PATCH changes only the fields it is sent.
Updating a material without sending `status` or `course_id` now leaves them unchanged (previously
such a partial update fell back to *draft* and *no course*).
The correct answer may be given as a letter (**B**) *or as the option's actual
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

### Focus reading

The **Focus** button in the material reader opens the material full screen with nothing else on
screen: no navigation, bottom bar or music strip. The browser goes truly full screen where the
device allows it; elsewhere the reader still covers the whole page. A slim bar (exit, "Section x of
y", previous/next, text size S–XL) hides while you scroll down and returns when you scroll up.
Highlighting and *Mark as read* (with its rewards) still work. Esc or the exit button returns to
the same section.

### Writing help for materials

- **Bold key facts:** the reader automatically bolds numbers (dates, %, ranges, units, ₦ amounts),
  references (*Section 36(1)*, *Figure 2*), acronyms and the material's own key terms. Staff can
  bold anything else with `**double stars**`. Nothing is stored; it's done when the page is shown.
- **Fix spelling:** an offline checker (pyspellchecker plus a common-misspellings list). It keeps
  names, British spelling, course and topic words, codes and Latin phrases (*audi alteram partem*).
  "Sure" fixes come pre-ticked and the rest are for staff to check. Imports apply the sure fixes
  automatically (a checkbox turns this off). Every fix can be undone.
- **Make it easy to read:** Google Gemini (free) or DeepSeek (paid but very cheap) rewrites the chosen sections in one of three styles
  (*Easy to read*, *Fun to learn*, *Exam-ready*). Staff compare New and Original for each section,
  see warnings if a number or key term went missing, and pick which sections to use. Nothing
  reaches players until the material is saved.
  **Setup:** create a free key at <https://aistudio.google.com> (*Get API key*). The first time you
  run `start-arena.sh` / `start-arena.bat` it asks for the key once and saves it to `backend/.env`,
  which git ignores, so the key never reaches GitHub. You can also write `GEMINI_API_KEY=...` in
  that file yourself, or set it as an environment variable or secret on your host, then restart the API. Without a key the button explains the
  setup and everything else keeps working. On the free tier Google may use submitted text to
  improve its models, so don't send private student data.
  **DeepSeek instead:** create a key at <https://platform.deepseek.com> (*API keys*), add a small
  balance and set `DEEPSEEK_API_KEY=sk-...` in `backend/.env` (the start scripts detect `sk-` keys).
  When that key is set DeepSeek is used; `AI_PROVIDER=gemini|deepseek` forces one.
  **Or paste keys in the admin panel:** *AI Tutor → Models → API keys* has **Add key / Change key**
  for DeepSeek and Gemini (owner account only). Each new key is tried with a one-word test first — a key
  the provider refuses is not saved, so the working one stays — and is used from the very next AI
  request, **no restart**. Keys are stored only on the server in `backend/data/ai_keys.json`
  (git-ignored, owner-only file permissions), override the `.env` key while saved, and are only ever
  shown masked (`AQ.A…9Q2x`). **Remove** falls back to the `.env` key, if there is one.

### AI Tutor

Players get an **AI Tutor** tab ("Ask anything about what you're learning.") powered by DeepSeek
(`deepseek-flash`). The browser only talks to our API (`/api/tutor/*`); the key stays in
`backend/.env` (`DEEPSEEK_API_KEY=sk-...`) and only signed-in players can use it.

* **Streaming chats with memory** — answers stream in (server-sent events). Every chat is saved
  (`ai_conversations`, `ai_messages`); recent turns are sent verbatim and older ones are folded into
  a rolling summary, so long chats stay cheap and on-topic.
* **Context from where you came from** — "Ask AI Tutor" on the exam result review, practice and
  Study Lab feedback, and "Ask AI" / "Explain this" (selected text) in the material reader. The
  server loads the question, answer and explanation itself; only relevant material passages are
  attached (keyword retrieval, "chapter 4" → section 4). It never invents content that isn't there.
* **Quick actions** — explain, teach me (mini lesson), explain simply, example, notes, glossary,
  summarize (quick / detailed / revision), study plan, "what should I study?". "Why is my answer
  wrong?" answers in a fixed structure: what's tested → why yours fails → why the key fits →
  remember this → example.
* **Create with AI** — flashcards (5–50), practice questions (MCQ, true/false, short answer,
  calculation, scenario) played as a one-at-a-time AI Quiz with score and weak areas, and
  structured study material. Output is validated JSON; nothing is saved until the player taps
  Save (then edit, study, download, regenerate or delete from *My library*).
* **Uploads and photos** — players can upload their own PDF/DOCX/TXT notes (private, text only) and
  ask about them, or attach a photo of a question (PNG/JPG/WEBP/GIF, ≤ 4 MB; not stored).
* **Progress-aware** — study plans and "what am I getting wrong?" use real answer data
  (`student_topic_progress`, rebuilt from exam, practice and Study Lab answers) — never guesses.
* **Limits (staff → AI Tutor)** — enforced by the API, shown by the app: per-day (default 20),
  per-month (400), per-minute (10), answers at once (2), message length, answer length and chats per
  player. Usage and estimated cost are tracked in `ai_usage` / `ai_usage_events` and shown to staff.
* **Exam protection (server-decided)** — while a player has an exam open, staff choose one of
  `AI_DISABLED`, `CONCEPT_ONLY` (default; the live question is never sent to the AI), `HINT_ONLY`
  (question visible, answer withheld) or `FULL_ASSISTANCE`. The app cannot override it.
* **Tutor v2** — Stop really cancels on the server (the partial answer is kept); Regenerate / Simpler;
  👍👎 feedback with a reason; chats grouped by date, searchable, archivable; learning profile
  (style, level, language, goals) and a Socratic toggle; "make 12 flashcards…" opens the right tool.
* **My AI Resources** — notes, study materials, flashcard decks (spaced review: *I know* / *I don't
  know*), practice sets (results tracked per topic, "Try another", "Practice my mistakes") and
  day-by-day study plans (complete / skip / reschedule). Each can be opened, renamed, duplicated or
  deleted. AI practice questions are kept separate from the official bank and are never published.
* **Providers** — DeepSeek or Gemini behind one provider layer (`services/ai_providers.py`,
  prices in `AI_PRICING_CONFIG`); retries after 1/2/4 s; students only ever see "AI Tutor is
  temporarily unavailable. Please try again." while staff see the technical reason in Logs.
* **Staff → AI Tutor** — Overview, Settings, Usage (Today / Yesterday / 7 / 30 days / custom), Costs
  with a monthly budget cap, Users (disable, reset today's quota, custom quota — chat text is never
  shown), Conversations (titles only), Models (provider/model, connection test), Limits, Logs
  (no prompts or keys) and Features (switch individual tools off).
* **Migrations** — the API upgrades itself on start. `scripts/migrate_ai.py backup|upgrade|verify|downgrade`
  does it explicitly; each upgrade/downgrade takes a timestamped SQLite backup first.
* The tutor has no tools that touch SQL, files or the shell — context is gathered by fixed,
  permission-checked server code.

---

## Install as an app

Absolute Genesis installs like a normal app: home-screen icon, full screen, its own window on a computer, no app store.

- **Where the buttons are:** "Install app" in the landing header, an install banner on Home, the download icon in the top bar (tablet/desktop), an "Install app" tile in the Menu, and a card in Profile. Where the browser offers its prompt (Chrome, Edge, Samsung Internet, Opera on Android and desktop) one tap installs. Elsewhere the same buttons open steps for that exact browser (iPhone Safari → Share → Add to Home Screen, Firefox, Opera Mini → use Chrome).
- **HTTPS is required by every browser.** Installing works from an `https://` address, or from `http://localhost` on the same computer. A phone opening `http://192.168.x.x:5173` over Wi-Fi can never install (the app says so and explains why).
- **Phones while running it yourself:** run `start-arena.bat share` (Windows) or `./start-arena.sh share`. It starts both servers plus a free Cloudflare quick tunnel and prints a public `https://….trycloudflare.com` link; open that on the phone and tap Install app. (It uses `cloudflared` if installed, installs it with `winget` on Windows, else falls back to `npx cloudflared`; `ngrok http 5173` works too.) The link changes each run.
- **"Only a shortcut" on Android** means Chrome could not make a real app from that address: plain http, a local/Wi-Fi address, a page inside WhatsApp/Facebook's built-in browser or inside a preview frame, or a manifest blocked by a login page. The install sheet has an **Install check** that tests all of these on the phone itself and says which one failed.
- **For real students:** deploy the built site (`cd frontend && npm run build`, serve `dist/`) on any HTTPS host and proxy `/api`, `/ws` and `/live` to the API. The production build also keeps every opened screen for offline use.
- Works with the dev server too (`start-arena`): it registers the service worker in a dev mode that never caches dev files, so hot reload is unaffected.
- Manifest: `frontend/public/manifest.webmanifest` (icons, maskable icon, screenshots for Chrome's richer install sheet, and long-press shortcuts to Exams, Materials and Study Lab).

## Offline, low data and exam integrity

Built for players on weak or expensive networks.

- **Answers save on the phone first.** `frontend/src/lib/examSync.ts` keeps an outbox per attempt and delivers it in batches to `POST /api/exams/attempts/{id}/sync`, retrying when the network returns. Submitting offline queues the submission; the server accepts it within `EXAM_SYNC_GRACE_SECONDS` after the clock ends.
- **Exams reopen offline.** A saved copy of the paper (questions and the player's answers, never the answer key) lets a reload continue with no network. Signing in survives a dropped connection: only a rejected login (401) signs a player out.
- **Installable app.** See “Install as an app” above. `public/sw.js` caches the shell in production builds. The service worker keeps the app shell and every screen already opened; it never caches `/api`, websockets or music. Bump `VERSION` in `sw.js` to drop old caches.
- **Smaller first download.** Staff console, duels, groups, results and most tabs load on first open (`src/lib/lazy.ts`); first load is about 230 KB gzipped. Common tabs are fetched when idle, except on Data Saver or 2G. Slow devices get lighter effects (`src/lib/fx.ts`).
- **One device at a time.** A second phone must choose "Continue here" (takeover); the first phone then stops saving.
- **Integrity review, never auto-penalty.** Leaving the screen, time away, offline spells, copy/paste and device moves are recorded. Staff see a Review/Check chip, a "Needs review" filter and a timeline under Results. Scores are never changed.
- **Question stats.** Results → Question stats shows per-question difficulty, discrimination and option picks for an exam or the whole course, flagging likely wrong keys and weak distractors (from 5 submitted papers).
- **Shuffle answer options.** A builder switch (on by default) shows A–D in a different order per student; grading maps answers back.

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

`frontend/src/lib/music.ts` plays **only these three files**, one `<audio>` element per track
(position-exact pause/resume, looped). There is no generative synth, fallback track or hidden
background music: if a device cannot play a file, the music stays silent and says so. The player
picks which of the three plays (Profile → Make it yours). The rules the transport enforces:

* **Pause keeps your place.** A file element resumes from the second it stopped on.
* **Mute is not pause.** It fades the volume and leaves playback running.
* **A switch stops the old track dead.** No two tracks ever sound at once.
* **Only approved files.** Any track id other than `rock`, `arcade` or `surfer` is refused.

`node scripts/music-check.mjs` proves these (38 checks), including that no synth backend exists.

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

# Backend: course bank vs exam — a 2,000-question bank with a 40-question random
#          exam stays 2,000, each player gets a different random paper that
#          survives refresh and grades correctly, exam-specific questions never
#          leak into the bank, topic / difficulty-mix draws, over-pool rejected
cd backend && ./.venv/bin/python scripts/verify_course_bank.py

# Backend: material import — builds real .docx / .pdf / .pptx / .odt / .rtf / .html /
#          .md / .txt files in memory and checks sections, lists, tables, long-document
#          splitting, preview-saves-nothing, course scoping, original-file download,
#          player reading and every refusal (old .doc, unknown course, non-staff)
cd backend && ./.venv/bin/python scripts/verify_material_import.py

# Backend: notes inside a material — attach / list / detach, same-course and no-nesting rules,
#          partial updates keep status and course, version restore and undo-last-save,
#          delete keeps notes in the course, player "lecturer notes" shows published ones only
cd backend && ./.venv/bin/python scripts/verify_material_notes.py

# Backend: players' own notes — create / list / open / edit / delete, undo of each step,
#          empty notes refused, and notes stay private to the player who wrote them
cd backend && ./.venv/bin/python scripts/verify_player_notes.py

# Backend: writing help — spelling fixes (names, British spelling, Latin and numbers kept),
#          sure fixes on import, and the Gemini rewrite against a local mock (batches, kept
#          images, fact warnings, 429 and size limits). For the rewrite checks, start the API with
#          GEMINI_API_KEY=test-key GEMINI_API_BASE=http://127.0.0.1:3999/v1beta
cd backend && ./.venv/bin/python scripts/verify_writing_assist.py

# Backend: "Make it easy to read" as a background job (no proxy time limits: the editor polls
#          short requests), retries on 429/5xx, stops on key/balance errors, cancel; AI bold
#          tidying; PDF import drops running headers/footers/page numbers and merges documents
#          with more than 80 sections (no API server or internet needed)
cd backend && ./.venv/bin/python scripts/verify_rewrite_jobs.py

# Backend: imported notes keep their structure — sensible section names (chapters, "1.1 …",
#          "A. …", Title Case headings; no cover-page section, no "Part n"), and real numbering:
#          1. (a) a) i. (iv) A. I. with nesting and start numbers, from PDFs, text and Word
cd backend && ./.venv/bin/python scripts/verify_import_structure.py

# Backend: API keys pasted in the admin panel — refused keys aren't saved, good keys work on the
#          next request without a restart (DeepSeek + Gemini), masked everywhere, owner-only
cd backend && ./.venv/bin/python scripts/verify_ai_keys.py

# Backend: DeepSeek provider against a local mock (no internet or API server needed): model
#          fallback, thinking retry, key / balance / rate / busy errors, time limit
cd backend && ./.venv/bin/python scripts/verify_deepseek.py

# Backend: AI Tutor end to end (163 checks, incl. cross-user access, exam modes, malformed JSON,
#          prompt injection, provider down, Gemini, cancel, staff dashboards) — starts its own API on :3995 with a throw-away DB and a
#          mock DeepSeek on :3996: streaming, memory + summaries, question/material/upload context,
#          exam-safe mode, images, JSON generators, saved items, limits and staff usage
cd backend && ./.venv/bin/python scripts/verify_ai_tutor.py

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

# Frontend: 38 audio-transport checks — only the three approved files can play,
#           pause keeps your place, mute leaves the transport running, switching
#           tracks never lets two play at once, and there is no synth fallback
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
| `GEMINI_API_KEY` | unset | Free Google AI Studio key for *Make it easy to read* (optional) |
| `DEEPSEEK_API_KEY` | unset | DeepSeek key for the rewrite; used instead of Gemini when set |
| `DEEPSEEK_MODEL` | `deepseek-flash` | DeepSeek model to try first (falls back to `deepseek-v4-flash`, `deepseek-chat`) |
| `AI_PROVIDER` | `auto` | `gemini` or `deepseek` to force a provider |
| `TUTOR_MODEL` | DeepSeek model | Model the AI Tutor uses |
| `AI_ENABLED` / `AI_MODEL` | `true` / provider default | First-run defaults (staff can change them in the app) |
| `AI_DAILY_LIMIT` / `AI_MONTHLY_LIMIT` | `20` / `400` | Requests per student (first-run defaults) |
| `AI_MAX_MESSAGE_LENGTH` / `AI_MAX_RESPONSE_TOKENS` | `4000` / `1800` | Message characters / answer tokens |
| `AI_MONTHLY_BUDGET_USD` | `0` (no cap) | Stop AI requests past this estimated monthly cost |
| `AI_RETRY_BASE` | `1` s | Backoff base for provider retries (1, 2, 4 s) |
| `AI_PRICE_INPUT` / `_CACHED` / `_OUTPUT` | from `AI_PRICING_CONFIG` | Override prices (USD per 1M tokens) |
| `TUTOR_STREAM_TIMEOUT` | `45` s | Longest wait for the tutor's answer to start / continue |
| `TUTOR_MAX_UPLOAD_MB` | `10` | Largest document a player may upload to the tutor |
| `TUTOR_PRICE_INPUT` / `_CACHED` / `_OUTPUT` | `0.14` / `0.028` / `0.28` | USD per million tokens, for the cost estimate |
| `GEMINI_BUDGET` / `GEMINI_TIMEOUT` | `75` / `60` s | Most time one rewrite request may take in total / per Gemini call (keeps under proxy limits) |
| `GEMINI_MODEL` | `gemini-flash-latest` | Gemini model to try first (falls back to other Flash models) |
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
  *Constitutional Law Arena Exam*, plus three smaller exams built from the same bank. That law
  catalogue (and the law-class roster) has since been **retired and deleted**; the seeded banks are
  now `app/seed_data/english_questions.py` and `app/seed_data/maths_questions.py`.
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
