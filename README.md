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
| **9 CLOVER AI** | Private chats, owner-controlled taught memory, saveable research, saved esports evidence, opt-in boards and reviewed admin change proposals |

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
When a provider is not configured, fails or reaches its limit, saved details
are shown as a basic fallback rather than a fabricated generated answer.
A configured-key badge is not a provider connectivity check.

### Personal data and conversation privacy

- Profile/linked-account snapshot, saved MLBB account statistics, the member's
  own recorded hero pool and their own recent scrim **assignments** are separate
  opt-ins, off by default. A
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
- Separately enabling **My MLBB account statistics** allows a small, filtered,
  source-dated sample of your own saved account stats, frequent heroes and match
  records to be sent to the external AI provider for relevant questions. Login
  tokens, teammate identities and unrecognized fields are excluded. The upstream
  schema and coverage may be incomplete; empty records do not prove no games.
  Disconnecting or relinking removes your saved account snapshots and resets this
  consent. Disabling sharing cannot recall information already sent, included in
  chat history, or retained in backups or provider logs.
- **Taught memory** is a separate owner-private application store. By default,
  clear teachings such as “Remember this: ...” and “This is how X works: ...”
  can be saved automatically (up to 200 entries of 1,200 characters each).
  Ordinary conversation and a bare URL are not saved as facts; common credential
  patterns and obvious instruction-injection attempts are rejected, but detection
  is not foolproof. The chat confirms a save only after the database accepts it.
  The owner can inspect, delete individual or all memories, turn auto-learning off,
  and independently turn recall off under **Your context**. Disabling recall keeps
  entries stored. Keyword matching selects at most five relevant entries, capped
  at 4,000 characters; it is not semantic search, so relevant facts can be missed.
  Relevant saved memories may be sent to the external AI provider when recall is
  enabled. The store records the owner/author, topic, source, date, optional chat
  and message reference, and **unverified** status. Teachings are not promoted to
  shared community knowledge or independently fact-checked. Deleting a chat
  removes the references but does not delete the memory; delete that separately.
  This is application-owned retrieval, not a change to the underlying model weights.
- In **Sources & research**, a member can preview a search excerpt and explicitly
  **Save finding to memory**. The app saves the bounded, server-returned excerpt,
  source title and HTTPS URL, publication date if known, retrieval date, and
  unverified status; it does not save a model assertion as a verified fact or
  fetch the source page. Saving research is an explicit action and still works
  with auto-learning off; recall remains controlled by its separate switch.
  Bounded web excerpts are also retained with the private message until it is
  deleted. Source and memory content are untrusted evidence, never instructions.
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
- **Clear saved AI context** deletes the member's taught/research memories,
  coaching notes and optional coaching goal, turns off auto-learning, recall and
  all five context switches, and removes the current open chat's match and board
  selections. This affects future requests, not one already sent. It does not erase the underlying profile/pool/scrims or existing chats.
  Delete a chat from its header to remove its messages from the live database.
  Deletion cannot erase downloaded files, pre-existing backups or data already
  sent to a provider; consult its retention and commercial-use terms.
- Owner checks apply to AI conversations, search, exports, learned memories and
  coaching notes (including admins); bearer authentication is required even for
  reads, and responses use `no-store`. This is application-level privacy:
  messages, learned memories, coaching goals and notes are stored without
  AI-specific encryption at rest. Database/backup operators can access them, and existing admin functionality can reset a member's
  password. Restrict those powers, secure database volumes and backups, and use
  HTTPS. Feedback stays private to the conversation; it is not automatically
  published or used to train a model. No automatic chat-retention expiry exists.

### What knowledge is actually available

The assistant combines its general MLBB knowledge with relevant saved hero data,
private teachings, approved community notes and esports records. It retrieves
hero names, lanes, specialties and skill names from the bundled profiles even
when demo seeding is off, plus saved Rone skill descriptions where available.
Broad role questions can receive a bounded, unranked roster reference.
Hero snapshots are imported from [MLBBDex](https://mlbbdex.com/en/api-doc) /
Mobile Legends Wiki (CC BY-SA); the bundled source describes patch 2.2.16, but
its import date, server channel and current accuracy are not independently
verified. Seeded hero win/pick/ban rates, tiers and counters are **not** sent as
facts. Team-maintained equipment entries and patch labels are available as
explicitly unverified context; they are not an official live item or patch feed.
There is no semantic search in this workspace.

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

### Admin-reviewed platform changes

Only an **admin** can receive and confirm assistant platform-change proposals;
captains, coaches and other roles retain their existing manual permissions but do
not gain AI write privileges. An explicit request can produce one validated
proposal to create a Draft Lab board or strategy, create/update a hero, set the
team's default patch, change one attached draft board's patch, or add a team-maintained equipment entry. The AI cannot run
arbitrary code, shell commands or SQL. It may offer troubleshooting guidance, but
cannot inspect server logs or apply arbitrary fixes. The admin sees all proposed
fields (including current values when relevant), checks an explicit review box,
and confirms before a transactional, one-use change. Proposals expire after seven
days, may be discarded, and hero/patch changes are rejected if the target changed
since proposal. A durable admin-only action history records confirmed changes even
if the conversation is deleted; private prompts are not part of that history.

Drafts start as ideas. New hero ratings and rates use disclosed placeholders.
Patch labels and equipment descriptions are manually maintained, not verified
updates from Moonton. Team equipment can also be inspected by signed-in members
and created, edited or deleted manually by admins in **MLBB Intel → Equipment**,
separately from the community Rone feed. The app refreshes its displayed patch
metadata after a confirmed label change. The provider still needs to be configured
and reachable for model-generated proposals; a configured key alone does not prove
that. An unambiguous patch version supplied by an admin can instead produce a
reviewable proposal locally without a model or web request. The team default
changes the starting patch for **new** Draft Lab boards; it does not rewrite
existing boards. To update an existing board, attach it to the message. Board
patch and name are checked for intervening changes before confirmation.

### Esports, team boards and live research in chat

For questions mentioning esports, tournaments, an MPL league, or a team acronym
and match/draft, the server can automatically match up to three **saved public
Aerena records** to the question. This is a small keyword-matched sample, not a
complete or necessarily current season; the source chips identify auto-selected
matches and show their saved dates. **Attach match** instead lets a member select
up to three saved Aerena matches explicitly; these override automatic selection.
A pasted Aerena schedule or match URL is recognized as a reference to the saved
integration, not automatically fetched as a raw web page. A linked match ID is
used only if present locally. The picker does not trigger a source refresh.
For a specified MPL region and season meta/pick-ban question, the AI also receives
a bounded aggregate across the saved season, not just the selected examples.
Rates use complete 10-pick/10-ban drafts as their denominator; partial or missing
drafts, unknown hero names and truncation are reported separately. Stage filters
use saved stage labels. Explicit match attachments override this automatic season
aggregate. Saved detail may be missing or incomplete, and the source is
community-compiled, not independently verified.

For an explicitly named MPL region (PH, ID, MY or KH) and schedule, standings or
playoff request, chat can also retrieve one public Rone feed. Only the allowlisted
region and feed are sent to Rone, not the member's question, chat or private
data. Public Rone responses are bounded and saved in the database with retrieval
dates. The page and AI can use the same saved snapshot; stale data is
used immediately while a refresh is queued, and failures retain the last good
snapshot. Relevant saved hero skills and separately consented account records can
also queue a bounded refresh after the chat response. A cold miss may need an
initial upstream request. The feed may not identify a season; a recent retrieval does not establish that the data describes
the current season. A failure does not fabricate data.

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

The composer also has an opt-in **Think** button for deeper analysis, including
questions with explicitly attached matches or boards. It uses the stronger
reasoning model with maximum effort and a larger output budget; it can take
several minutes and incur higher provider charges, including for reasoning tokens.
The toggle applies to following messages until switched off or the page reloads.
The progress card shows actual preparation and provider-stream stages, not
fabricated percentages, and the final answer is asked to explain key factors
and trade-offs.
The app does not expose, store or replay raw internal reasoning; the provider's
own retention policy still applies. Local patch clarification/proposals bypass
the model and are not labelled as deep analysis. A provider failure or an exhausted
reasoning budget yields a clearly labelled local-facts fallback, not a silent
switch to a cheaper model. The separate embedded Esports analysis controls do
not currently use this chat toggle.

Long Think requests use stream keepalives and can continue after a browser
connection drops, so charges may continue even if the tab is closed. Reopen the
same conversation to see its progress and saved reply; the browser tab remembers
only the conversation ID in session storage, not the message or attachments.
There is no cancellation control yet. Processing is bounded to roughly eight
minutes plus connection/idle and lookup time, and a longer database lease prevents
overlapping messages in the same chat. A process restart can interrupt work.
Reverse proxies must allow streaming and have a read timeout longer than the
eight-second keepalive interval.

The composer offers **Web check: Auto / Always / Off**. The assistant uses its
MLBB knowledge and saved data first; Auto searches when asked for fresh information
or verification, not for ordinary meta, ranked, build or admin-edit questions.
Always searches each model-generated answer; local patch proposals do not use the
web. Off does not perform web searches. The default is Auto,
with the privacy and cost notice shown before sending. One bounded search uses
only the current question, optionally prefixed with "Mobile Legends"; it does
not append chat history, personal context, or attached boards. Search results are
untrusted, may be outdated, and are displayed as labelled HTTPS source links with
publication dates where available and retrieval dates. The server does not fetch
arbitrary result pages. Queries that appear to contain credentials are skipped,
but detection is not foolproof: **do not enter secrets**. Named public Rone MPL
and game-reference lookups are separate from web search and can still happen with
Web Off. Auto also searches when explicitly asked for patch notes or balance
changes, subject to the configured provider and availability.

Search uses the configured server-side AI key and may be billed separately from
model calls. `CLOVER_AI_WEB_SEARCH=0` disables it server-wide. The app imposes
no daily search or AI-request cap; usage attempts are still recorded, and provider
rate limits, service availability and billing still apply. Old daily-limit
environment settings no longer restrict use. Search/provider access, billing and HTTPS connectivity have not been verified in
the development sandbox: an operator must test them from the deployment. A
configured-key badge is not a connectivity test. Saved personal account data is
available to AI only with separate consent and only when a usable snapshot exists;
the source may not provide a complete match history. Tournament participation,
a verified Original/Advanced patch feed, a prediction model and an automatic
training pipeline are not connected.

The application presents provider-neutral labels and normalizes old assistant
messages, but this is not a secrecy boundary: server operators, source code and
public repository history can still reveal implementation details.

### Saved MLBB snapshots

Clover resolves named heroes (including aliases such as `xborg` → `X.Borg`)
against local profiles before loading relevant public Rone skills, aggregate
hero stats, equipment, battle spells, emblems and community build recommendations
when needed. Outbound hero identifiers come from the bundled public roster rather
than arbitrary team-created names; an unknown new hero may need a roster update.
It uses fixed game-reference endpoints only; the AI does not make separate Rone
player or account calls. Already-saved member account context still requires consent.
Community author/account fields are excluded from the AI's build evidence, and
source retrieval dates and stale/unavailable status are preserved. The Rone
game-version endpoint may list version labels without detailed MLBB balance notes;
its website's own release changelog is not a substitute for game patch notes.
Clover must not invent missing changes. Optional web checks can help find other
sources, but their claims require verification.

Chat can show local hero artwork, historical reference ratings, deterministic pick
charts, and bounded structured diagrams for plans or rotations. Model-supplied
remote images are not loaded, preventing hidden tracking requests; hero images
use the app's bundled art and existing Rone backup. Historical community profiles,
community build recommendations and aggregate statistics may be stale.

Public hero/reference and Rone esports responses are stored separately from the
team's editable hero annotations. Private My MLBB snapshots are scoped to the
linked account's owner, and account endpoints require a bearer session. Each
snapshot is limited to 2 MB; retention is capped at 600 public snapshots and 30
per linked account. Stale snapshots are shown immediately with their saved date
and refreshed in the background with cross-worker cooldowns. Failed or invalid
refreshes do not overwrite saved data. On a first visit, there may be no snapshot
and the initial request depends on the source. Account snapshots are stored in
the server database in plaintext, like the rest of the application's data; server
operators and backups may retain them. Disconnect/relink removes the active
account snapshots and consent from the database, not old backups or provider logs.

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
refresh or load an older season from Esports; viewing a match can fetch its
additional player stats. In Clover chat, any signed-in member can also request
bounded, read-only loading of a public season or missing match details through
the match picker. This does not grant permission to modify team data.

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

With no key or a provider failure, the UI returns a labelled facts-only summary
rather than pretending to generate an AI answer. The Esports page's separate
scene analysis uses at most the first eight saved matches shown by its filter,
not a complete season. Clover chat can instead analyze a chosen source week,
playoff stage, or up to 500 individual matches using the **Attach esports**
picker. Choose a source, MPL region, season (where available), and stage;
search is optional. Rone has separate regular-season and playoff feeds, and
individual selections may include matches from both. For example, ask “Rone MPL
ID playoffs, most picked heroes?” or “Aerena MPL PH season 18 week 1, most picked
heroes?” Select individual matches when asking about a specific playoff round.
Clover treats each match as a series and checks all available games in every
selected match, rather than only the first game or the open game tab. It loads
missing public details on demand, displays progress and reuses saved snapshots.
If a newer Aerena response is shorter and cannot be reconciled with a final
score, previously saved games are retained and marked potentially stale. Score
gaps, including games already scored in an ongoing series, are disclosed. A
short follow-up can reuse the public selection when chat history is enabled.
Public source requests contain only the selected source identifiers, not the
question, private boards, account credentials or chat history.

Pick counts are computed server-side for all available game numbers and across
the selected scope, independently of the model. Rankings include only complete
10-distinct-hero lineups; missing match IDs, incomplete games, score/detail gaps,
stale records, duplicate schedule entries and bounded-context omissions are
reported rather than guessed. Rone does not identify a season in its schedule
or playoff feed or provide verified bans or draft order, so historical seasons
cannot be inferred. Aerena playoff filters use its saved stage labels (playoff,
bracket, knockout or final), not guessed dates or match formats; unknown or
differently named stages can be missing. Regular-season final weeks and group
finals are not assumed to be playoffs. Aerena week filters use explicit source
week fields/labels or its source match-ID week label; unlabelled or conflicting
records are excluded and disclosed. A week or playoff stage with more than 500
listed matches must be narrowed to individual matches. The
500-match ceiling, 30-game-per-match source limit, bounded response/context
sizes and loading deadline are technical safeguards, not daily usage limits.
Very broad selections may retain a per-match game index and aggregate counts
instead of every game's full detail in the model context; Clover discloses this
and can analyze a narrower selection for individual game details. Complete-game
counts still cover the available selection even when player details or some tied
rankings are omitted. Public integrations may be unavailable or incomplete,
and neither source guarantees full
season coverage. Rone requests are cached, serialized across workers and subject
to retry cooldowns; Aerena requests use the existing shared worker. Review hosted
Rone terms, including attribution and commercial-use arrangements, before deployment.

The question and bounded public evidence are sent to the external AI provider
when a model is configured. Private Archive items and credentials are never
retrieved; board and personal context remain separately consent-controlled, and
chat history is used only if enabled. Do not put secrets or private notes in the
question. Usage accounting is shared by the member workspace and Esports
analysis, without an app-imposed daily request cap. Provider rate limits and
charges remain, so the operator should monitor usage and billing. The key,
provider access and outbound HTTPS must work on the deployed backend.
`CLOVER_AI_MODEL` optionally overrides the normal-chat model;
`CLOVER_AI_THINK_MODEL` separately overrides the stronger Think-mode model.
Think uses up to 32,768 output tokens for reasoning and the final answer. Legacy environment variable names remain
supported for existing deployments. The admin credential endpoint is now
provider-neutral; reload older browser tabs
after deploying the updated frontend and backend together.

Responses are interpretations, not recorded coach reasoning, and should be
checked against the linked source. They are not stored as verified facts, and
neither source refresh nor conversations automatically retrain the model. This
integration does **not** yet provide verified live Original/Advanced Server patch
feeds, a calibrated prediction model, or automatic team-specific draft
recommendations. It cannot establish why a decision was made without evidence.

## Theme and appearance

Each area of the hub has its own accent colour and an MLBB hero backdrop that
drifts behind the shell, so the app is not tied to one fixed palette. From
**Edit profile → Colour theme** members can follow the area automatically, pin
any of eight colours, turn the hero art off, or calm the motion. Choices are
saved per browser and applied before the first paint. Hero art is bundled in
`frontend/public/heroes`, and the wallpaper respects `prefers-reduced-motion`.
See [theme and appearance](docs/reference/theme.md).

## Fonts

The interface uses **Courier** by default (11px, weight 500, 0.1em tracking, all caps; bundled Courier Prime where the device has no Courier). Members can switch to **Montserrat** or the optional Corptic DEMO display font from **Edit profile → Text style**; the choice is saved per browser. Corptic DEMO is by Pandeka Foundry, and **the included demo is for personal, non-commercial use only** — obtain an appropriate license before commercial or corporate use. Numerals always use Montserrat, and glyphs missing from the demo use Montserrat or system fallbacks. See [font credits and licensing](docs/reference/fonts.md).

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
web research and uncapped concurrent usage accounting, Rone game-reference feeds,
minimization, snapshot export, private teaching/recall and deletion, research
attribution, complete-draft season aggregation, large source/week selections,
all-game pick counts, incomplete data, shared source-load leases, safe visuals
and Think integration, unseeded hero profiles, admin-only proposal review and concurrent
one-use application, provider failures and legacy branding.
Team focus tests cover settings permissions, dashboard visibility and drill target validation. Frontend
tests also cover match limits, source links and bounded export pagination. Run a separate
authorized connectivity check and monitor the in-app source status in the
deployment environment.

---

*Every game teaches us something.*
