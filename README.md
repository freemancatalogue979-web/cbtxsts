# ☘ 9 CLOVER — Competitive Training & Analysis Hub

*PLAY. REVIEW. ADAPT. DOMINATE.*

A private esports training, analysis, strategy and team-management platform for **9 CLOVER**
(IX CLOVER ☘︎). Dark premium dashboard, deep crimson accents, subtle clover green, Montserrat.

```
backend/    FastAPI + SQLAlchemy + SQLite          → http://localhost:3000  (docs at /docs)
frontend/   React 19 + Vite + Tailwind v4          → http://localhost:5173
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
./start-arena.sh          # installs dependencies, starts API :3000 + web :5173 (survives SSH close)
./start-arena.sh status   # confirm both are running
./start-arena.sh logs     # follow logs (Ctrl+C only closes the viewer)
./start-arena.sh stop     # stop both
```

```bat
start-arena.bat           :: Windows — opens two terminals and your browser
```

Or by hand:

```bash
# API (port 3000)
cd backend
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 3000 --reload --reload-dir app

# Web app (port 5173, proxies /api to :3000)
cd frontend
npm install
npm run dev
```

The SQLite database is created and **seeded on first boot** — roster, 40+ heroes,
a five-week training block (Week 04, *OBJECTIVE CONTROL*, 80%), 12 scrims with full
stat sheets, the Scrim #23 model review, the ban board, playbook notes, draft boards
and development entries. One loss (Scrim #31) is deliberately unreviewed so the
*NO REVIEW, NO NEXT SCRIM* rule is visible from the first login.

Delete `backend/data/clover.db` and restart the API to reset the world.

## Seeded accounts (password `clover2026` for all)

| Account | Role | Lane |
| --- | --- | --- |
| admin@9clover.gg (DRE) | Admin | — |
| captain@9clover.gg (KAZE) | Captain | ROAM |
| coach@9clover.gg (ICHIZU) | Coach | — |
| rinji@9clover.gg (RINJI) | Player | EXP |
| sora@9clover.gg (SORA) | Player | JUNGLE |
| mira@9clover.gg (MIRA) | Player | MID |
| tobi@9clover.gg (TOBI) | Player | GOLD |
| pip@9clover.gg (PIP) | Player (sub) | EXP |
| analyst@9clover.gg (NOX) | Analyst | — |

Change the bootstrap admin via `backend/.env` — see `backend/.env.example`
(`CLOVER_SECRET_KEY`, `CLOVER_ADMIN_EMAIL`, `CLOVER_ADMIN_PASSWORD`, …).

---

*Every game teaches us something.*
