"""Quiz Arena API — FastAPI + SQLite + websockets.

Run locally with::

    backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 3000 --reload
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import APP_NAME, APP_TAGLINE, CORS_ALLOW_ORIGIN_REGEX, EXTRA_CORS_ORIGINS, HOST, PORT
from .db import init_db, session_scope
from .routers import (
    admin,
    auth,
    chat,
    competitive,
    content,
    duels,
    exams,
    flashcards,
    game,
    insights,
    live,
    materials,
    practice,
    rooms,
    social,
    studio,
    study, shop,)
from .seed import seed_all
from .services.duel import expire_duels
from .services.exam import expire_overdue
from .events import dispatch
from .ws import hub

logger = logging.getLogger("arena")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s | %(message)s")

TICK_SECONDS = 5


async def game_ticker() -> None:
    """Server-side clocks: auto-submit expired exams and finish timed-out duels."""
    while True:
        try:
            await asyncio.sleep(TICK_SECONDS)
            with session_scope() as db:
                events = expire_overdue(db)
                events += expire_duels(db)
            if events:
                await dispatch(events)
        except asyncio.CancelledError:  # pragma: no cover
            raise
        except Exception as error:  # pragma: no cover - keep the loop alive
            logger.warning("game ticker error: %s", error)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with session_scope() as db:
        summary = seed_all(db)
    logger.info(
        "database ready | %s students, %s questions across %s quizzes",
        summary["students_total"],
        summary["questions"],
        summary["quizzes"],
    )
    ticker = asyncio.create_task(game_ticker())
    try:
        yield
    finally:
        ticker.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await ticker


app = FastAPI(
    title=APP_NAME,
    description=f"{APP_NAME} — {APP_TAGLINE} Real-time CBT, duels, leaderboards and prizes.",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=CORS_ALLOW_ORIGIN_REGEX,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", f"http://localhost:{PORT}", *EXTRA_CORS_ORIGINS],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    message = first.get("msg", "Invalid request payload")
    field = ".".join(str(part) for part in first.get("loc", [])[1:])
    return JSONResponse(status_code=422, content={"detail": f"{field}: {message}" if field else message})


# ---------------------------------------------------------------------------
# routes
# ---------------------------------------------------------------------------
API_PREFIX = "/api"
app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(auth.me_router, prefix=API_PREFIX)
app.include_router(content.router, prefix=API_PREFIX)
app.include_router(exams.router, prefix=API_PREFIX)
app.include_router(exams.results_router, prefix=API_PREFIX)
app.include_router(duels.router, prefix=API_PREFIX)
app.include_router(rooms.router, prefix=API_PREFIX)
app.include_router(social.router, prefix=API_PREFIX)
app.include_router(chat.router, prefix=API_PREFIX)
app.include_router(study.router, prefix=API_PREFIX)
app.include_router(admin.router, prefix=API_PREFIX)
app.include_router(studio.router, prefix=API_PREFIX)
app.include_router(flashcards.router, prefix=API_PREFIX)
app.include_router(practice.router, prefix=API_PREFIX)
app.include_router(competitive.router, prefix=API_PREFIX)
app.include_router(insights.router, prefix=API_PREFIX)
app.include_router(game.router, prefix=API_PREFIX)
app.include_router(game.study_router, prefix=API_PREFIX)
app.include_router(materials.router, prefix=API_PREFIX)
app.include_router(materials.admin_router, prefix=API_PREFIX)
app.include_router(shop.router, prefix=API_PREFIX)
app.include_router(live.router)  # websocket routes stay unprefixed: /ws/live, /ws/duel/{id}, /ws/room/{id}


@app.get("/")
def root() -> dict:
    return {
        "name": APP_NAME,
        "tagline": APP_TAGLINE,
        "version": app.version,
        "docs": "/docs",
        "health": "/api/health",
        "websocket": "/ws/live",
        "online": hub.online_count(),
    }


@app.get("/api/health")
def health() -> dict:
    with session_scope() as db:
        from sqlalchemy import func, select

        from .models import Student

        players = db.scalar(select(func.count(Student.id))) or 0
    return {"status": "ok", "players": int(players), "online": hub.online_count()}


def run() -> None:  # pragma: no cover - convenience entrypoint
    import uvicorn

    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=False)


if __name__ == "__main__":  # pragma: no cover
    run()
