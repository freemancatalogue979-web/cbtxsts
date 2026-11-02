# ☘ 9 CLOVER — Competitive Training & Analysis Hub

*PLAY. REVIEW. ADAPT. DOMINATE.*

A private esports training, analysis, strategy and team-management platform for **9 CLOVER**
(IX CLOVER ☘︎). Dark premium dashboard, deep crimson accents, subtle clover green, Montserrat.

```
backend/    FastAPI + SQLAlchemy + SQLite          → http://localhost:9000  (docs at /docs)
frontend/   React 19 + Vite + Tailwind v4          → http://localhost:9009
```

**The loop:** PLAY → RECORD → REVIEW → IDENTIFY → TRAIN → APPLY → IMPROVE
**House rule:** *NO REVIEW, NO NEXT SCRIM* — booking a new scrim is blocked while a lost series has no filed match review.

---

## What it is

| Module | What it does |
| --- | --- |
| **Dashboard** | Current training block (Week · focus · progress), next activity with live countdown, upcoming events, recent results, team performance sheet (win rate, objective control, first-turtle, lord conversion, teamfight success, gold/kills/deaths @10), current team weakness with drills remaining |
| **Training Center** | Weekly focus blocks + every session stored: drills (role / objective / hero / team fight / rotation), macro, micro, mental, comms, scenario, draft, match review, tournament prep — with assigned players, results, scores and lessons learned |
| **Scrim Manager** | Book scrims (opponent, format BO1/BO3/BO5, server, lineup + subs, expected strategy), record per-game stat sheets and drafts, attach screenshots / replays / stats / VOD / stream links |
| **Match Review System** | The most important feature. 5+5 bans, lane picks both sides, match statistics, biggest mistakes, why it happened / what we should have done / who was involved / what we change, the lesson, and one action item with owner + deadline (open → in progress → resolved) |
| **Scrims Database** | Searchable history: filter by opponent / result, head-to-head records, series & game win rates, average duration / kills / deaths / objectives |
| **Hero Database** | Role, class, difficulty, meta status, tier, patch stats, internal 9 CLOVER rating, notes, counters, synergy, player specialists — 40+ heroes pre-loaded |
| **Player Hero Pools** | Comfort / meta / pocket / emergency picks per player with 0–10 confidence, games, win rate and coach notes |
| **Ban Board** | Standard bans (priority 1–3), opponent-specific bans with reasons, patch-specific bans |
| **Players & Development** | Roster cards, series form (last five), coach ratings and player self-reviews |
| **Strategy & Knowledge Base** | Playbook notes by category (macro, objective, teamfight, composition, opponent file, meta), pinned doctrine, squad-wide read access |
| **Draft Lab** | Saved pick/ban boards: 5+5 bans, lane picks both sides, status idea → testing → approved |
| **Calendar & Events** | Tournaments, scrims, training and review deadlines in one feed |
| **Esports** | Saved Aerena seasons and matches, source-reported team/player stats and ordered draft coverage when available, plus bounded evidence-based analysis |
| **9 CLOVER AI** | Private member chats, live web research, saved esports evidence, opt-in team boards and coaching context |

## Roles & permissions

| Capability | Admin | Captain | Coach | Player | Analyst |
| --- | :-: | :-: | :-: | :-: | :-: |
| Manage users, settings, heroes | ✅ | — | — | — | — |
| Training weeks & sessions | ✅ | ✅ | ✅ | view | view |
| Create / edit scrims | ✅ | ✅ | — | — | — |
| Upload results & evidence | ✅ | ✅ | — | — | — |
| File / edit match reviews | ✅ | ✅ | ✅ | — | ✅ |
| Rate players (development) | ✅ | — | ✅ | — | — |
| Self-review, own hero pool | ✅ | ✅ | ✅ | ✅ | ✅ |
| Strategy notes, ban board | ✅ | ✅ | ✅ | view | view |
| Draft boards | ✅ | ✅ | ✅ | view | view |

Enforced on the API, not just the UI.

## Quick start

The Linux launcher needs **Python 3.10+** with the `venv` module, network access
for dependency installation, and either Node.js **20.19+ (20.x)** or **22.12+**
with npm 9+. If Node/npm is missing or incompatible, it downloads a pinned,
SHA-256-verified official Node.js 22 runtime into `.arena-run/tools` (Linux
x86-64/ARM64 and macOS x64/ARM64). It does not modify system packages or require
sudo. Downloads need access to `nodejs.org`, npm's registry and PyPI. An
existing compatible Node/npm is reused. The local runtime is pinned rather than
automatically upgraded; keep the launcher and any system Node.js security-patched.

```bash
./start-arena.sh            # installs dependencies, starts API :9000 + web :9009 in background
./start-arena.sh status     # show actual service ports and process state
./start-arena.sh logs       # follow logs (Ctrl+C only closes the viewer)
./start-arena.sh restart    # check dependencies, then restart both
./start-arena.sh stop       # stop the background services
./start-arena.sh foreground # run both attached to the terminal (Ctrl+C stops them)
```

The background services survive SSH logout. On another device use
`http://<server-ip>:9009`; allow the port through your firewall if needed.
Override ports with, for example,
`API_PORT=9100 WEB_PORT=9109 ./start-arena.sh restart`; the web proxy follows
`API_PORT` unless `VITE_API_TARGET` is explicitly set. Use the same port
variables when starting again. For an internal
Node mirror, `CLOVER_NODE_DIST_BASE` can point to a mirror with the identical
official archives; their pinned checksums are still enforced.

On Ubuntu, if Python or `venv` is missing, install `python3`, `python3-venv`
and `python3-pip` with apt. If Node's download fails, allow access to
`nodejs.org` or install a compatible Node.js/npm and retry. The launcher reports
port conflicts and prints service logs if startup fails.

**These are development servers**, not a hardened production deployment. Before
public use, change the bootstrap credentials and signing secret, restrict access
to both ports, and provide HTTPS. Do not run the app as root in production.

```bat
start-arena.bat             :: Windows — opens two terminals and your browser
```

Or by hand:

```bash
# API (port 9000)
cd backend
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 9000 --reload --reload-dir app

# Web app (port 9009, proxies /api to :9000)
cd frontend
npm install
npm run dev -- --port 9009
```

**Windows note:** a virtualenv breaks if you move/rename the project folder (it embeds
absolute paths). Symptom: `Fatal error in launcher: Unable to create process...`.
`start-arena.bat` detects this and rebuilds automatically; by hand, delete
`backend\.venv` and recreate it with `py -3 -m venv backend\.venv`.

On first boot, the SQLite database creates the bootstrap admin, hero defaults and
team settings. Example roster accounts, scrims and other fictional operational
content are **opt-in**: set `CLOVER_DEMO_DATA=1` before the first startup to add
them. The bundled hero default values are not a verified live patch/meta feed.
Existing databases are not reseeded. Data-wipe actions in the app are admin-only.

The development bootstrap login defaults to `admin@9clover.gg` / `clover2026`.
Set `CLOVER_ADMIN_EMAIL`, `CLOVER_ADMIN_PASSWORD` and a strong `CLOVER_SECRET_KEY`
**before** exposing the application. Bootstrap credentials are used only when
the database is first created; changing them later does not change an existing
account. If example data is opted in, the example accounts use the same initial
password and must also be changed or removed before real use.

## 9 CLOVER AI — member workspace

Every signed-in member has a **9 CLOVER AI** tab, private conversations, rename,
delete, owner-only search across chat titles and messages, paginated older chats,
optional feedback, suggested prompts and source-context labels. A conversation
can be downloaded as plaintext JSON: the browser collects a consistent snapshot
in pages, up to 2,000 messages, and explicitly warns before a partial download if
there are more. The file remains on the device even after deleting the chat.
Search terms are sent in a request body rather than a URL to reduce exposure in
standard access logs; server operators and custom logging can still see app data.
The assistant is intended for general MLBB coaching, not just professional teams.
When a provider is not configured, fails or reaches its limit, a clearly
labelled **local facts-only snapshot** is shown instead of a fabricated answer.
A configured-key badge is not a provider connectivity check.

### Personal data and conversation privacy

- Profile/linked-account snapshot, the member's own recorded hero pool and their
  own recent scrim **assignments** are separate opt-ins, off by default. A
  substitute assignment is not proof the person played. The pool is manually
  entered, not a verified match history. The AI uses at most 25 pool entries and
  scans lineup/substitute IDs from at most 200 recent team scrims to find five
  assignments; only the member's matched scrim details are selected. Coach notes,
  other members' records and private Archive content are not automatically
  sent to the provider. Saved team boards are included only when attached and
  explicitly confirmed by the member.
- A linked profile uses cached name/level/rank; it is not asserted current. The
  linked role/server IDs are included only if the current question asks about
  them. Rone JWT/refresh tokens are never automatically selected. User-supplied
  text can still contain sensitive information, so **do not type secrets**.
- Members may write up to 12 private coaching notes (500 characters each) for
  strengths, focus areas, preferences and goals. Every note starts with sharing
  **off**; its owner may edit, delete or individually enable it. An enabled note
  can be sent with each future AI provider request independently of the profile
  switch. Notes are member-supplied claims, not verified performance or automatic
  learning from chat. Turning a note off stops direct inclusion, but earlier
  messages containing the same information may still be sent as chat history;
  switch off history or delete those chats as appropriate.
- The current question and, by default, up to eight recent messages (at most
  6,500 characters) are sent to the external AI provider when it is used. Recent
  history can be turned off separately. Enabling a personal category permits that data to
  be sent. Each answer shows the sources supplied to it, not a guarantee that
  every generated claim is supported. The model cannot run arbitrary SQL, shell
  commands or fetch arbitrary pages; the server may provide bounded search
  excerpts or a public MPL feed for qualifying questions.
- **Clear saved AI context** deletes the member's coaching notes and optional
  coaching goal, turns off all four context switches, and removes the current
  open chat's match and board selections. This affects future requests, not one
  already sent. It does not erase the underlying profile/pool/scrims or existing chats.
  Delete a chat from its header to remove its messages from the live database.
  Deletion cannot erase downloaded files, pre-existing backups or data already
  sent to a provider; consult its retention and commercial-use terms.
- Owner checks apply to AI conversations, search, exports and coaching notes
  (including admins); bearer authentication is required even for reads, and
  responses use `no-store`. This is application-level privacy: messages, coaching
  goals and notes are stored without AI-specific encryption at rest. Database/backup operators
  can access them, and existing admin functionality can reset a member's
  password. Restrict those powers, secure database volumes and backups, and use
  HTTPS. Feedback stays private to the conversation; it is not automatically
  published or used to train a model. No automatic chat-retention expiry exists.

### What knowledge is actually available

The assistant retrieves relevant hero names, lanes and skill names from the
bundled historical hero profiles and keyword-matched, approved community notes.
Hero snapshots are imported from [MLBBDex](https://mlbbdex.com/en/api-doc) /
Mobile Legends Wiki (CC BY-SA); the bundled source describes patch 2.2.16, but
its import date, server channel and current accuracy are not independently
verified. Seeded hero win/pick/ban rates, tiers and counters are **not** sent as
facts. There is no semantic search or live item database in this workspace.

Members can explicitly submit a question, correction, strategy, draft idea or
feedback to admins. Submissions disclose that approved notes can be visible to
all members and sent to the external AI provider. Admins must review and write a
note before publishing; questions and feedback are acknowledged rather than published as
facts. Exact duplicates are detected, but source URLs are not fetched or
fact-checked automatically. Members can withdraw a pending submission; admins
can remove individual published notes. Published notes may remain after an
account is deleted, so ask an admin to remove one if needed. Approval is human
review, not a claim of independent verification. Contributions and ratings do
not automatically retrain the model.

### Esports, team boards and live research in chat

For questions mentioning esports, tournaments, an MPL league, or a team acronym
and match/draft, the server can automatically match up to three **saved public
Aerena records** to the question. This is a small keyword-matched sample, not a
complete or necessarily current season; the source chips identify auto-selected
matches and show their saved dates. **Attach match** instead lets a member select
up to three saved Aerena matches explicitly; these override automatic selection.
The picker does not trigger a source refresh. Saved detail may be missing or
incomplete, and the source is community-compiled, not independently verified.

For an explicitly named MPL region (PH, ID, MY or KH) and schedule, standings or
playoff request, chat can also retrieve one public Rone feed. Only the allowlisted
region and feed are sent to Rone, not the member's question, chat or private
data. Responses are bounded, cached briefly and labelled with retrieval time.
The feed may not identify a season; a recent retrieval does not establish that
the data describes the current season. A failure does not fabricate data.

**Attach boards** lets a signed-in member select up to two saved Draft Lab boards
and two saved Map Lab boards that the member can already read, then explicitly
confirm sending their contents and notes to the external AI provider. The latest
saved versions, including changes made by others after selection, are included
with the next message only. Match and board selections clear when sending,
switching chats or reloading; reattach them for another message. Unsaved edits and
Archive content are excluded. Maps are sent as bounded structured tokens,
percentages, sampled paths, steps, chips and zones, not as an image; this does
not provide visual map recognition. Earlier chat history, backups or provider
logs can still retain what was shared. Turn off history when necessary.

The composer offers **Live web: Auto / Always / Off**. Auto searches freshness-
sensitive questions such as current patches, builds, ranked and esports. Always
searches each question; Off does not perform web searches. The default is Auto,
with the privacy and cost notice shown before sending. One bounded search uses
only the current question, optionally prefixed with "Mobile Legends"; it does
not append chat history, personal context, or attached boards. Search results are
untrusted, may be outdated, and are displayed as labelled HTTPS source links with
publication dates where available and retrieval dates. The server does not fetch
arbitrary result pages. Queries that appear to contain credentials are skipped,
but detection is not foolproof: **do not enter secrets**. Named public Rone MPL
lookups are separate from web search and can still happen with Web Off.

Search uses the configured server-side AI key and may be billed separately from
model calls. `CLOVER_AI_WEB_SEARCH=0` disables it server-wide;
`CLOVER_AI_WEB_DAILY_LIMIT` defaults to 10 attempts per member per UTC day
(range 0–100; failures count). The shared model-request budget is independent.
Search/provider access, billing and HTTPS connectivity have not been verified in
the development sandbox: an operator must test them from the deployment. A
configured-key badge is not a connectivity test. The app does not yet retrieve
personal account match history or tournament participation, provide a verified
Original/Advanced patch feed or run a prediction model or training pipeline.

The application presents provider-neutral labels and normalizes old assistant
messages, but this is not a secrecy boundary: server operators, source code and
public repository history can still reveal implementation details.

## Aerena Esports

The Esports page reads match data from the app's own database, not an Aerena
API from the browser. Team logos, when available, load directly from Aerena's
media host (without a referrer), so that host can see the viewer's IP. In the
separate Rone view, team logos, equipment icons and bracket images are likewise
loaded from Rone's public image hosts, which can see the viewer's IP. A backend
worker tries to discover the read-only actions used by
Aerena's public site, save its series/season/hero catalog, and refresh matches
in the latest dated season of each series. Changed match and detail observations
are retained with source timestamps and snapshots; source errors do not erase the
last successful data. A staff member (admin, captain or coach) can queue a full
refresh or load an older season; viewing a match can fetch its additional
player stats. Aerena-specific analysis uses saved public records only; member
chat can additionally use the explicitly named Rone feed and web search described
above.

- This is an **undocumented website integration**, not an official or stable
  Aerena API. Deployments may change the action IDs, format or access rules.
  Confirm that your planned automated and commercial use is permitted by Aerena;
  public availability alone is not a reuse licence. Respect their limits.
- Aerena independently compiles community data. A source verification flag is
  displayed when present, but is not independent verification. Coverage varies;
  the season-level match request is not proven to include every stage, and
  missing games, stats, heroes or drafts remain unknown. The app only shows a
  combined draft sequence where the source provides the full standard mapping.
- Set `CLOVER_AERENA_ENABLED=0` to disable sync. Default interval is two hours
  (`CLOVER_AERENA_SYNC_SECONDS`, minimum 300 seconds); failures retry after at
  most 15 minutes. The page reports last successful full sync and errors.
  This environment could not directly reach Aerena during development, so live
  ingestion must be verified from the actual host; mocked tests are not proof
  of provider connectivity or complete coverage.
- A persistent database, running backend worker, outbound HTTPS to Aerena,
  backups, storage monitoring and operational alerting are required. Snapshots
  grow over time; plan retention and storage. Multi-process workers share a DB
  lease, but a sleeping/serverless deployment will not run continuously. Do not
  claim 24/7 freshness without monitoring the actual service.

### AI provider and optional match analysis

Admins can save, update or remove an AI provider key in **Team Admin → AI provider**.
Use HTTPS (or local loopback for development), change the bootstrap admin
password and signing secret before exposure, and never put keys in chat or source
control. The key is encrypted in the database and the API never returns it; saving
a key does not verify it or provider access. Alternatively, set `CLOVER_AI_API_KEY`
in the backend environment (see `backend/.env.example`); a key saved in Team
Admin takes precedence. Removing it falls back to the environment key, if set.

The encryption key is separate from the database: set `CLOVER_CREDENTIAL_ENCRYPTION_KEY`
to the same Fernet key in every worker's secret manager, or let a single host
create `backend/data/credential-encryption.key` (owner-only permissions on POSIX;
on Windows, restrict the data directory's inherited ACL to the service account).
Keep the database and encryption key on persistent storage and back them up securely
and separately; losing or changing the encryption key locks existing saved
credentials until it is restored or a replacement API key is saved. Hosts or
processes that can read both the encryption key and database can decrypt it;
restrict server access. For multi-host deployments, use the same protected
environment key on every worker. Neither the database nor generated key belongs
in Git.

With no key, provider failure, or an exhausted quota, the UI returns a
labelled facts-only summary rather than pretending to answer the question. A
submitted match question sends that explicit question and bounded saved public
Aerena match evidence to the external AI provider. Scene analysis uses at most
the first eight matches shown by the current filter, not a complete season. Neither path automatically
retrieves private Archive items, team boards, credentials or chat history; do not
put secrets or private notes in the question. Provider requests are limited by
`CLOVER_AI_DAILY_LIMIT` (default 20 per user per UTC day, range 1–100;
failed requests count). This quota is shared by the member workspace and Esports
analysis. The key, provider access, quotas and outbound HTTPS must all work on
the deployed backend. `CLOVER_AI_MODEL` optionally overrides the default model.
Legacy environment variable names remain supported for existing deployments. The
admin credential endpoint is now provider-neutral; reload older browser tabs
after deploying the updated frontend and backend together.

Responses are interpretations, not recorded coach reasoning, and should be
checked against the linked source. They are not stored as verified facts, and
neither source refresh nor conversations automatically retrain the model. This
integration does **not** yet provide verified live Original/Advanced Server patch
feeds, a calibrated prediction model, or automatic team-specific draft
recommendations. It cannot establish why a decision was made without evidence.

## Tests

```bash
python3 -m unittest discover -s tests -p 'test_start_arena.py' -v
cd backend && CLOVER_AERENA_ENABLED=0 python -m unittest discover -s tests -v
cd ../frontend && npm run typecheck && npm run test:map && npm run test:esports && npm run test:ai && npm run test:focus && npm run build
```

The launcher tests use isolated fake runtimes and HTTP services; they do not
install system packages or touch the real app data. The Aerena and member-AI tests use fixtures and mocked provider responses; they do
not call or seed Aerena or an AI provider. AI tests cover owner isolation (including
admins), per-note and board consent, selected/automatic match evidence, bounded
web research and search quotas, Rone feeds, minimization, snapshot export,
review, provider failures, legacy branding and deletion. Team focus tests cover
settings permissions, dashboard visibility and drill target validation. Frontend
tests also cover match limits, source links and bounded export pagination. Run a separate
authorized connectivity check and monitor the in-app source status in the
deployment environment.

---

*Every game teaches us something.*
