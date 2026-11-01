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

You need **Python 3.11+** and **Node 18+** once. Then:

```bash
./start-arena.sh          # installs dependencies, starts API :9000 + web :9009 (survives SSH close)
./start-arena.sh status   # confirm both are running
./start-arena.sh logs     # follow logs (Ctrl+C only closes the viewer)
./start-arena.sh stop     # stop both
```

```bat
start-arena.bat           :: Windows — opens two terminals and your browser
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

## Aerena Esports and 9 Clover AI

The Esports page reads match data from the app's own database, not an Aerena
API from the browser. Team logos, when available, load directly from Aerena's
media host (without a referrer), so that host can see the viewer's IP. A backend
worker tries to discover the read-only actions used by
Aerena's public site, save its series/season/hero catalog, and refresh matches
in the latest dated season of each series. Changed match and detail observations
are retained with source timestamps and snapshots; source errors do not erase the
last successful data. A staff member (admin, captain or coach) can queue a full
refresh or load an older season; viewing a match can fetch its additional
player stats. Searching and AI analysis use saved public records only.

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

### Optional DeepSeek match analysis

Set `DEEPSEEK_API_KEY` in the **backend environment** (see
`backend/.env.example`); never put it in frontend variables, source control or
chat. With no key, provider failure, or an exhausted quota, the UI returns a
labelled facts-only summary rather than pretending to answer the question. A
submitted match question sends that explicit question and bounded saved public Aerena
match evidence to DeepSeek. Scene analysis uses at most the first eight matches
shown by the current filter, not a complete season. Neither path automatically
retrieves private Archive items, team boards, credentials or chat history; do not
put secrets or private notes in the question. Provider requests are limited by
`CLOVER_DEEPSEEK_DAILY_LIMIT` (default 20 per user per UTC day, range 1–100;
failed requests count). The key, provider access, quotas and outbound HTTPS to
`api.deepseek.com` must all work on the deployed backend.

Responses are interpretations, not recorded coach reasoning, and should be
checked against the linked source. They are not stored as verified facts, and
neither source refresh nor conversations automatically retrain the model. This
integration does **not** yet provide verified live Original/Advanced Server patch
feeds, a calibrated prediction model, or automatic team-specific draft
recommendations. It cannot establish why a decision was made without evidence.

## Tests

```bash
cd backend && CLOVER_AERENA_ENABLED=0 python -m unittest discover -s tests -v
cd ../frontend && npm run typecheck && npm run test:map && npm run test:esports && npm run build
```

The Aerena tests use fixtures and mocked provider responses; they do not call or
seed Aerena or DeepSeek. Run a separate authorized connectivity check and monitor
the in-app source status in the deployment environment.

---

*Every game teaches us something.*
