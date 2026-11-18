"""9 CLOVER — Competitive Operations API (FastAPI entry point)."""
from __future__ import annotations

import logging

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import CORS_ALLOW_ORIGIN_REGEX, EXTRA_CORS_ORIGINS, TEAM_NAME, TEAM_TAGLINE
from .db import Base, SessionLocal, engine
from .routers import (
    admin,
    ai_tools,
    archive,
    solo_games,
    utility,
    clover_ai,
    auth,
    bans,
    dashboard,
    drafts,
    events,
    heroes,
    intel,
    items,
    esports,
    map_guide,
    maps,
    notifications,
    programs,
    tournaments,
    files,
    meta,
    players,
    reviews,
    scrims,
    strategy,
    training,
    trash,
    users,
)
from .seed import seed_if_empty
from . import hero_sync  # daily hero refresh; also registers its state table for create_all

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("clover")

app = FastAPI(title=f"{TEAM_NAME} — Competitive Operations API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=EXTRA_CORS_ORIGINS,
    allow_origin_regex=CORS_ALLOW_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Clover-Trash"],
)


class TrashReceipt:
    """Deletes move things to Trash; tell the app which trash ids a request made
    (X-Clover-Trash) so it can offer Undo. Plain ASGI so streaming is untouched."""

    def __init__(self, inner) -> None:
        self.inner = inner

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.inner(scope, receive, send)
            return
        from .trash import begin_request

        ids = begin_request()

        async def send_with_receipt(message):
            if message["type"] == "http.response.start" and ids and message.get("status", 500) < 400:
                headers = list(message.get("headers") or [])
                headers.append((b"x-clover-trash", ",".join(str(i) for i in ids).encode()))
                message = {**message, "headers": headers}
            await send(message)

        await self.inner(scope, receive, send_with_receipt)


app.add_middleware(TrashReceipt)

api = APIRouter(prefix="/api")
for module in (auth, meta, dashboard, training, scrims, reviews, heroes, players,
               bans, events, strategy, drafts, admin, maps, users, map_guide, notifications,
               programs, files, tournaments, intel, items, archive, esports, clover_ai, trash, ai_tools,
               solo_games, utility):
    api.include_router(module.router)
app.include_router(api)


@app.get("/api/health")
def health():
    return {"ok": True, "team": TEAM_NAME, "tagline": TEAM_TAGLINE}


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(engine)
    # SQLite is not migrated by create_all for existing tables; add newer columns by hand.
    with engine.begin() as conn:
        for stmt in (
            "ALTER TABLE intel_links ADD COLUMN level INTEGER",
            "ALTER TABLE intel_links ADD COLUMN rank_level INTEGER",
            "ALTER TABLE tournament_matches ADD COLUMN game_drafts TEXT DEFAULT '[]'",
            "ALTER TABLE scrim_games ADD COLUMN lineup TEXT DEFAULT '{}'",
            "ALTER TABLE scrim_games ADD COLUMN player_stats TEXT DEFAULT '{}'",
            "ALTER TABLE scrim_games ADD COLUMN enemy_stats TEXT DEFAULT '{}'",
            "ALTER TABLE clover_ai_settings ADD COLUMN share_games BOOLEAN NOT NULL DEFAULT 0",
        ):
            try:
                conn.exec_driver_sql(stmt)
            except Exception:
                pass  # column already exists
    with SessionLocal() as db:
        if seed_if_empty(db):
            logger.info("Database bootstrapped: admin, heroes and settings (example accounts/data require CLOVER_DEMO_DATA=1).")
    # This worker is read-only against Aerena and writes only its own public
    # esports tables. A database lease prevents duplicate refreshes per deployment.
    from .aerena_service import start_worker
    start_worker()
    # Daily hero database refresh from Rone (new heroes, win/pick/ban rates).
    hero_sync.start_worker()


@app.on_event("shutdown")
def shutdown() -> None:
    from .aerena_service import stop_worker
    stop_worker()
    hero_sync.stop_worker()
