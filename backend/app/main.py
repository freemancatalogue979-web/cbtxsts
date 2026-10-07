"""9 CLOVER — Competitive Operations API (FastAPI entry point)."""
from __future__ import annotations

import logging

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import CORS_ALLOW_ORIGIN_REGEX, EXTRA_CORS_ORIGINS, TEAM_NAME, TEAM_TAGLINE
from .db import Base, SessionLocal, engine
from .routers import (
    admin,
    auth,
    bans,
    dashboard,
    drafts,
    events,
    heroes,
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
    users,
)
from .seed import seed_if_empty

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
)

api = APIRouter(prefix="/api")
for module in (auth, meta, dashboard, training, scrims, reviews, heroes, players,
               bans, events, strategy, drafts, admin, maps, users, map_guide, notifications, programs, files, tournaments):
    api.include_router(module.router)
app.include_router(api)


@app.get("/api/health")
def health():
    return {"ok": True, "team": TEAM_NAME, "tagline": TEAM_TAGLINE}


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if seed_if_empty(db):
            logger.info("Database seeded: accounts, heroes, settings (demo data skipped unless CLOVER_DEMO_DATA=1).")
