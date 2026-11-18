"""Utility → Team match data (staff).

Browse scrims and tournament matches, pick a game, point at the uploaded evidence
(a scoreboard / result screenshot), read it into a full game sheet and — once a
person confirms — save it into the scrim or tournament with the same checks and
permissions as recording a game by hand.

* GET  /utility/matches   — matches to browse (newest first, ?q= opponent / name)
* POST /utility/read      — read one screenshot for one game (nothing saved)
* POST /utility/apply     — save the confirmed sheet into that game
"""
from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import hero_vision
from ..ai_scoreboard import IMAGE_EXT, ReadError, load_upload, read_scoreboard
from ..deps import can, get_current_user, get_db, require
from ..models import Hero, Scrim, Tournament, TournamentMatch, User, dumps, loads
from ..performance import clean_enemy_stats, clean_lineup, clean_player_stats, scrim_game_lineup
from ..schemas import GameIn
from . import scrims as scrims_router
from . import tournaments as tournaments_router

router = APIRouter(prefix="/utility", tags=["utility"])
LIST_LIMIT = 40


def can_fill(user: User) -> bool:
    return can.upload_results(user) or can.manage_scrims(user)


def _images(attachments: Any) -> list[dict]:
    out = []
    for a in attachments if isinstance(attachments, list) else []:
        url = str((a or {}).get("url") or "")
        ext = url.rsplit(".", 1)[-1].lower() if "." in url else ""
        if url.startswith("/api/files/") and ext in IMAGE_EXT:
            out.append({"url": url, "label": str(a.get("label") or "Screenshot")[:120]})
    return out


def _sheet_flags(player_stats: dict, enemy_stats: dict, draft: dict) -> dict:
    return {"has_stats": bool(player_stats), "has_enemy": bool(enemy_stats),
            "has_draft": tournaments_router.draft_has_content(draft)}


def scrim_row(s: Scrim, names: dict[int, str]) -> dict:
    games = []
    for g in sorted(s.games, key=lambda g: g.game_no):
        lineup, _ = scrim_game_lineup(s, g)
        ps = clean_player_stats(loads(g.player_stats or "{}", {}))
        es = clean_enemy_stats(loads(g.enemy_stats or "{}", {}))
        draft = loads(g.draft or "{}", {}) or {}
        games.append({"game_no": g.game_no, "game_id": g.id, "result": g.result,
                      "players": {ln: names.get(uid, "") for ln, uid in lineup.items()},
                      **_sheet_flags(ps, es, draft)})
    taken = {g["game_no"] for g in games}
    next_no = max(taken, default=0) + 1
    return {
        "key": f"scrim:{s.id}", "kind": "scrim", "id": s.id, "title": f"Scrim #{s.number} vs {s.opponent or 'TBD'}",
        "event": "Scrim", "opponent": s.opponent, "date": s.scrim_date.isoformat() if s.scrim_date else None,
        "status": s.status, "result": s.result or "", "score": [s.score_us or 0, s.score_them or 0], "format": s.format,
        "games": games, "slots": sorted(taken | {next_no}), "evidence": _images(loads(s.attachments, [])),
        "link": ["scrims", s.id],
    }


def match_row(m: TournamentMatch, names: dict[int, str], t_names: dict[int, str]) -> dict:
    saved = tournaments_router.match_games(m)
    games = [{"game_no": g["game_no"], "game_id": None, "result": tournaments_router.implied_result(m, g),
              "players": {ln: names.get(uid, "") for ln, uid in g["lineup"].items()},
              **_sheet_flags(clean_player_stats(g.get("player_stats")), clean_enemy_stats(g.get("enemy_stats")), g["draft"])}
             for g in saved]
    slots = list(range(1, tournaments_router.game_slots(m, saved) + 1))
    name = t_names.get(m.tournament_id, "Tournament")
    return {
        "key": f"tournament:{m.id}", "kind": "tournament", "id": m.id,
        "title": f"{name} · M{m.match_no} vs {m.opponent or 'TBD'}", "event": name + (f" · {m.stage}" if m.stage else ""),
        "opponent": m.opponent, "date": m.scheduled_date.isoformat() if m.scheduled_date else None, "status": m.status,
        "result": m.result or "", "score": [m.score_us or 0, m.score_them or 0], "format": m.format,
        "games": games, "slots": slots, "max_games": tournaments_router.max_games(m.format),
        "evidence": _images(loads(m.attachments, [])), "link": ["tournaments", m.tournament_id],
    }


def _names(db: Session) -> dict[int, str]:
    return {u.id: (u.ign or u.name) for u in db.scalars(select(User)).all()}


def _target(db: Session, kind: str, target_id: int):
    obj = db.get(Scrim if kind == "scrim" else TournamentMatch, target_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Match not found.")
    return obj


def _row(db: Session, obj) -> dict:
    names = _names(db)
    if isinstance(obj, Scrim):
        return scrim_row(obj, names)
    return match_row(obj, names, {t.id: t.name for t in db.scalars(select(Tournament)).all()})


@router.get("/matches")
def matches(q: Annotated[str | None, Query(max_length=80)] = None, kind: Literal["all", "scrim", "tournament"] = "all",
            db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[dict]:
    require(can_fill(user), "fill in match data")
    names = _names(db)
    needle = (q or "").strip().lower()
    rows: list[dict] = []
    if kind in {"all", "scrim"}:
        stmt = select(Scrim).where(Scrim.status != "cancelled").order_by(Scrim.scrim_date.desc().nullslast(), Scrim.number.desc())
        if needle:
            stmt = stmt.where(Scrim.opponent.ilike(f"%{needle}%"))
        rows += [scrim_row(s, names) for s in db.scalars(stmt.limit(LIST_LIMIT)).all()]
    if kind in {"all", "tournament"}:
        t_names = {t.id: t.name for t in db.scalars(select(Tournament)).all()}
        stmt = select(TournamentMatch).where(TournamentMatch.status != "cancelled").order_by(
            TournamentMatch.scheduled_date.desc().nullslast(), TournamentMatch.id.desc())
        found = db.scalars(stmt.limit(LIST_LIMIT * 3 if needle else LIST_LIMIT)).all()
        for m in found:
            row = match_row(m, names, t_names)
            if needle and needle not in row["title"].lower():
                continue
            rows.append(row)
    rows.sort(key=lambda r: (r["date"] or "", r["key"]), reverse=True)
    return rows[: LIST_LIMIT * 2]


class ReadIn(BaseModel):
    kind: Literal["scrim", "tournament"]
    id: int
    game_no: int = Field(ge=1, le=9)
    image_url: str = Field(min_length=1, max_length=300)


def _game_context(db: Session, obj, game_no: int) -> tuple[dict, dict, str]:
    """(lineup, draft, result) already known for this game — helps place every row."""
    if isinstance(obj, Scrim):
        game = next((g for g in obj.games if g.game_no == game_no), None)
        if game is not None:
            lineup, _ = scrim_game_lineup(obj, game)
            return lineup, loads(game.draft or "{}", {}) or {}, game.result or ""
        return clean_lineup(loads(obj.lineup or "{}", {})), {}, ""
    saved = tournaments_router.match_games(obj)
    game = next((g for g in saved if g["game_no"] == game_no), None)
    if game is not None:
        return game["lineup"], game["draft"], tournaments_router.implied_result(obj, game)
    previous = saved[-1]["lineup"] if saved else {}
    return previous, {}, ""


@router.post("/read")
def read(payload: ReadIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    require(can_fill(user), "read match evidence")
    obj = _target(db, payload.kind, payload.id)
    row = _row(db, obj)
    if payload.game_no not in row["slots"]:
        raise HTTPException(status_code=422, detail=(
            f"Game {payload.game_no} isn't open on this match. Pick one of games {', '.join(map(str, row['slots']))}"
            + (" or update the series score first." if payload.kind == "tournament" else ".")))
    lineup, draft, result = _game_context(db, obj, payload.game_no)
    try:
        sheet = read_scoreboard(db, user, image_url=payload.image_url, lineup=lineup, draft=draft,
                                opponent=row["opponent"] or "", result=result)
    except ReadError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    return {"target": row, "game_no": payload.game_no, "sheet": sheet}


class ApplyIn(BaseModel):
    kind: Literal["scrim", "tournament"]
    id: int
    game_no: int = Field(ge=1, le=9)
    result: str = ""
    duration_min: float | None = Field(default=None, ge=0, le=120)
    lineup: dict[str, int | None] = Field(default_factory=dict)
    draft: dict = Field(default_factory=dict)
    player_stats: dict[str, dict] = Field(default_factory=dict)
    enemy_stats: dict[str, dict] = Field(default_factory=dict)
    evidence_url: str = Field(default="", max_length=300)
    # confirmed heroes at their portrait spots on the evidence screenshot → the matcher learns them
    portraits: list["PortraitIn"] = Field(default_factory=list, max_length=10)


class PortraitIn(BaseModel):
    hero: str = Field(min_length=1, max_length=40)
    box: list[float] = Field(min_length=4, max_length=4)


ApplyIn.model_rebuild()


def learn_portraits(db: Session, url: str, portraits: list[PortraitIn]) -> int:
    """Save confirmed portraits (from our own copy of the screenshot). Never fails the save."""
    if not portraits or not url:
        return 0
    try:
        raw, _, _ = load_upload(url)
    except ReadError:
        return 0
    names = {hero_vision.slug(n): n for (n,) in db.execute(select(Hero.name)).all()}
    learned = 0
    for p in portraits:
        hero = names.get(hero_vision.slug(p.hero))
        if not hero:
            continue
        # already recognised confidently at this spot: nothing new to learn
        known = hero_vision.check_box(raw, p.box, list(names.values()))
        if known is not None and known.hero == hero and known.score >= hero_vision.BOX_ACCEPT[0]:
            continue
        learned += hero_vision.learn(raw, p.box, hero, list(names.values()))
    return learned


def _attach(obj, url: str, game_no: int) -> None:
    if not url.startswith("/api/files/"):
        return
    items = loads(obj.attachments, [])
    items = items if isinstance(items, list) else []
    if any((a or {}).get("url") == url for a in items):
        return
    items.append({"kind": "screenshot", "label": f"Game {game_no} scoreboard", "url": url})
    obj.attachments = dumps(items)


@router.post("/apply")
def apply(payload: ApplyIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    require(can_fill(user), "fill in match data")
    obj = _target(db, payload.kind, payload.id)
    result = payload.result.upper()
    if result not in {"WIN", "LOSS", ""}:
        raise HTTPException(status_code=422, detail="Result must be a win or a loss.")
    lineup = {k: v for k, v in payload.lineup.items() if v}
    if isinstance(obj, Scrim):
        game = next((g for g in obj.games if g.game_no == payload.game_no), None)
        if game is not None:
            patch: dict[str, Any] = {"result": result, "player_stats": payload.player_stats,
                                     "enemy_stats": payload.enemy_stats}
            if lineup:
                patch["lineup"] = lineup
            if tournaments_router.draft_has_content(payload.draft):
                patch["draft"] = payload.draft
            if payload.duration_min:
                patch["duration_min"] = payload.duration_min
            scrims_router.update_game(obj.id, game.id, scrims_router.GamePatch(**patch), db=db, user=user)
        else:
            scrims_router.add_game(obj.id, GameIn(game_no=payload.game_no, result=result,
                                                  duration_min=payload.duration_min or 0, draft=payload.draft,
                                                  lineup=lineup or None, player_stats=payload.player_stats,
                                                  enemy_stats=payload.enemy_stats), db=db, user=user)
        obj = db.get(Scrim, payload.id)
    else:
        tournaments_router.save_game_draft(obj.id, payload.game_no, tournaments_router.GameDraftIn(
            draft=payload.draft, result=result, lineup=lineup or None, player_stats=payload.player_stats,
            enemy_stats=payload.enemy_stats), db=db, user=user)
        obj = db.get(TournamentMatch, payload.id)
    _attach(obj, payload.evidence_url, payload.game_no)
    db.commit()
    db.refresh(obj)
    learned = learn_portraits(db, payload.evidence_url, payload.portraits)
    return {"ok": True, "target": _row(db, obj), "game_no": payload.game_no, "learned": learned}
