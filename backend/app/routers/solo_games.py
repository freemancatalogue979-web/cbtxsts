"""A member's own solo games (Utility AI + Learning utility in 9 Clover AI).

* GET    /solo-games            — your games + stats (staff may pass ?user_id=)
* POST   /solo-games            — add one game by hand
* PATCH  /solo-games/{id}       — fix a game (owner or admin)
* DELETE /solo-games/{id}       — to Trash (owner or admin)
* POST   /solo-games/import     — the AI reads an uploaded file and adds your games
                                  (preview=true: read only, so heroes can be fixed first)
* POST   /solo-games/import/confirm — save the reviewed games (+ learn fixed hero portraits)
* POST   /solo-games/undo       — take back one import (to Trash)
* POST   /solo-games/coach      — AI coaching from your games

Your own games count straight away — no approval. They never change team
scrim/tournament stats.
"""
from __future__ import annotations

from datetime import date
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..ai_game_import import extract, resolve
from ..ai_scoreboard import ReadError
from ..ai_solo_coach import coach as ai_coach
from ..deps import get_current_user, get_db
from ..models import SoloGame, User
from ..solo_games import clean_game, fingerprint, game_out, hero_gaps, hero_names, solo_stats, user_games
from ..trash import send_to_trash
from .utility import PortraitIn, learn_portraits

router = APIRouter(prefix="/solo-games", tags=["solo-games"])
STAFF = {"admin", "captain", "coach", "analyst"}
LIST_LIMIT = 500


class SoloGameIn(BaseModel):
    played_on: date | str | None = None
    mode: str = Field(default="", max_length=30)
    hero: str = Field(default="", max_length=60)
    lane: str = Field(default="", max_length=10)
    result: str = Field(default="", max_length=8)
    duration_min: float | str | None = None
    kills: int | str | None = None
    deaths: int | str | None = None
    assists: int | str | None = None
    rating: float | str | None = None
    gold: int | str | None = None
    damage: int | str | None = None
    damage_taken: int | str | None = None
    turret_damage: int | str | None = None
    mvp: bool = False
    notes: str = Field(default="", max_length=400)


class ImportIn(BaseModel):
    file_url: str = Field(min_length=1, max_length=300)
    # read only: hand back the games to check (heroes can be changed), save with /import/confirm
    preview: bool = False


class ConfirmIn(BaseModel):
    file_url: str = Field(min_length=1, max_length=300)
    source: str = Field(default="screenshot", pattern="^(screenshot|document|sheet)$")
    games: list[SoloGameIn] = Field(default_factory=list, max_length=300)
    portraits: list[PortraitIn] = Field(default_factory=list, max_length=20)


class UndoIn(BaseModel):
    batch: str = Field(min_length=1, max_length=32)


class CoachIn(BaseModel):
    focus: str = Field(default="", max_length=300)


# Members see plain words: what went wrong and what to do, nothing about how files are read.
SERVICE_DOWN = "Reading files isn't available right now. Add your games by hand, or try again later."
SERVICE_BUSY = "Couldn't read that file right now. Try again in a minute, or add the games by hand."


def _ai_error(exc: ReadError) -> HTTPException:
    if exc.status == 503:
        return HTTPException(status_code=503, detail=SERVICE_DOWN)
    detail = str(exc)
    if exc.status >= 500 and "AI" in detail:
        detail = SERVICE_BUSY
    return HTTPException(status_code=exc.status, detail=detail)


def _owned(db: Session, game_id: int, user: User) -> SoloGame:
    row = db.get(SoloGame, game_id)
    if row is None or (row.user_id != user.id and user.role != "admin"):
        raise HTTPException(status_code=404, detail="Game not found.")
    return row


def _payload(user_id: int, db: Session) -> dict:
    games = user_games(db, user_id)
    owner = db.get(User, user_id)
    return {"user": {"id": owner.id, "name": owner.ign or owner.name, "lane": owner.main_role} if owner else None,
            "games": [game_out(g) for g in games[:LIST_LIMIT]], "total": len(games), "stats": solo_stats(games),
            "gaps": hero_gaps(db, owner, games) if owner else {"no_data": [], "not_playing": [], "lane_meta": []}}


@router.get("")
def list_games(user_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    target = user_id or user.id
    if target != user.id and user.role not in STAFF:
        raise HTTPException(status_code=403, detail="Only you and team staff can see your solo games.")
    if db.get(User, target) is None:
        raise HTTPException(status_code=404, detail="Player not found.")
    return _payload(target, db)


@router.post("", status_code=201)
def add_game(payload: SoloGameIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    game = clean_game(payload.model_dump(), hero_names(db))
    if game is None:
        raise HTTPException(status_code=422, detail="Add at least the hero and the result (or the K/D/A).")
    row = SoloGame(user_id=user.id, **game, source="manual", fingerprint=fingerprint(game))
    db.add(row)
    db.commit()
    db.refresh(row)
    return game_out(row)


@router.patch("/{game_id}")
def edit_game(game_id: int, payload: SoloGameIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = _owned(db, game_id, user)
    data = payload.model_dump(exclude_unset=True)
    merged = {**game_out(row), **data}
    game = clean_game(merged, hero_names(db))
    if game is None:
        raise HTTPException(status_code=422, detail="A game needs at least the hero and the result (or the K/D/A).")
    for key, value in game.items():
        setattr(row, key, value)
    row.fingerprint = fingerprint(game)
    db.commit()
    db.refresh(row)
    return game_out(row)


@router.delete("/{game_id}", status_code=204)
def delete_game(game_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = _owned(db, game_id, user)
    label = f"{row.hero or 'Game'} · {row.result.title() if row.result else '—'}" + (f" · {row.played_on}" if row.played_on else "")
    send_to_trash(db, [row], user=user, kind="solo_game", area="ai", label=label,
                  restricted=True, viewers=[row.user_id])
    db.delete(row)
    db.commit()


def _save(db: Session, user: User, games: list[dict], source: str, file: str) -> dict:
    known = {fp for (fp,) in db.query(SoloGame.fingerprint).filter(SoloGame.user_id == user.id).all()}
    batch = uuid4().hex
    added: list[SoloGame] = []
    duplicates = 0
    for game in games:
        game = {k: v for k, v in game.items() if k != "look"}
        fp = fingerprint(game)
        if fp in known:
            duplicates += 1
            continue
        known.add(fp)
        row = SoloGame(user_id=user.id, **game, source=source, source_file=f"/api/files/{file}",
                       batch=batch, fingerprint=fp)
        db.add(row)
        added.append(row)
    db.commit()
    checks: list[dict[str, Any]] = []
    if added:
        checks.append({"tone": "ok", "text": f"Added {len(added)} {'game' if len(added) == 1 else 'games'} to your record."})
    if duplicates:
        checks.append({"tone": "info", "text": f"{duplicates} {'game was' if duplicates == 1 else 'games were'} already "
                                               "in your record and skipped."})
    return {"batch": batch if added else None, "added": [game_out(r) for r in added], "duplicates": duplicates,
            "checks": checks}


@router.post("/import")
def import_file(payload: ImportIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        read = extract(db, user, payload.file_url)
    except ReadError as exc:
        raise _ai_error(exc) from exc
    base = {"file": read["file"], "source": read["source"], "read_directly": read["read_directly"]}
    # Anything that was read (not typed straight in a sheet) waits for the person to check it.
    if payload.preview and not read["read_directly"] and read["games"]:
        games = [{**g, "played_on": g["played_on"].isoformat() if g.get("played_on") else None} for g in read["games"]]
        return {**base, "preview": True, "games": games, "checks": read["checks"], "batch": None, "added": [],
                "duplicates": 0}
    saved = _save(db, user, read["games"], read["source"], read["file"])
    return {**base, "preview": False, **saved, "checks": saved["checks"][:1] + list(read["checks"]) + saved["checks"][1:]
            if saved["added"] else list(read["checks"]) + saved["checks"]}


@router.post("/import/confirm")
def confirm_import(payload: ConfirmIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        _, name, _ = resolve(payload.file_url)
    except ReadError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    heroes = hero_names(db)
    games = [g for g in (clean_game(item.model_dump(), heroes) for item in payload.games) if g]
    if not games:
        raise HTTPException(status_code=422, detail="Nothing to add — every game needs a hero and a result (or the K/D/A).")
    saved = _save(db, user, games, payload.source, name)
    learned = learn_portraits(db, f"/api/files/{name}", payload.portraits) if payload.source == "screenshot" else 0
    return {"file": name, "source": payload.source, "read_directly": False, "preview": False, **saved, "learned": learned}


@router.post("/undo")
def undo_import(payload: UndoIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.query(SoloGame).filter(SoloGame.user_id == user.id, SoloGame.batch == payload.batch).all()
    if not rows:
        raise HTTPException(status_code=404, detail="Nothing to undo — those games were already removed.")
    send_to_trash(db, rows, user=user, kind="solo_import", area="ai", restricted=True, viewers=[user.id],
                  label=f"{len(rows)} imported {'game' if len(rows) == 1 else 'games'}")
    for row in rows:
        db.delete(row)
    db.commit()
    return {"removed": len(rows)}


@router.post("/coach")
def coach(payload: CoachIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        return ai_coach(db, user, payload.focus)
    except ReadError as exc:
        raise _ai_error(exc) from exc
