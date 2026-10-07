"""Scrim manager + scrim results database.

House rule enforced here: NO REVIEW, NO NEXT SCRIM — booking a new scrim is
blocked while a played LOSS has no match review on file.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..deps import can, get_current_user, get_db, require
from ..models import Scrim, ScrimGame, dumps, loads
from ..schemas import GameIn, ScrimIn, ScrimPatch
from ..serializers import game_out, scrim_out

router = APIRouter(prefix="/scrims", tags=["scrims"])


def blocking_losses(db: Session) -> list[Scrim]:
    losses = db.scalars(
        select(Scrim).where(Scrim.status == "played", Scrim.result == "LOSS")
        .order_by(Scrim.scrim_date.desc())
    ).all()
    return [s for s in losses if s.review is None]


@router.get("")
@router.get("/")
def list_scrims(
    opponent: str | None = Query(default=None),
    result: str | None = Query(default=None),
    player_id: int | None = Query(default=None),
    hero: str | None = Query(default=None),
    status: str | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    stmt = select(Scrim).order_by(Scrim.scrim_date.desc().nullslast(), Scrim.number.desc())
    if opponent:
        stmt = stmt.where(Scrim.opponent.ilike(f"%{opponent}%"))
    if result:
        stmt = stmt.where(Scrim.result == result.upper())
    if status:
        stmt = stmt.where(Scrim.status == status)
    if date_from:
        stmt = stmt.where(Scrim.scrim_date >= date_from)
    if date_to:
        stmt = stmt.where(Scrim.scrim_date <= date_to)
    scrims = db.scalars(stmt.limit(500)).all()
    out = []
    for s in scrims:
        row = scrim_out(s, with_games=bool(hero))
        if player_id is not None:
            lineup_ids = list(row["lineup"].values()) + row["substitutes"]
            if player_id not in lineup_ids:
                continue
        if hero:
            needle = hero.lower()
            picks = []
            for g in row["games"]:
                draft = g["draft"] or {}
                for side in ("our_picks", "enemy_picks"):
                    picks += [str(v).lower() for v in (draft.get(side) or {}).values()]
                picks += [str(b).lower() for b in draft.get("our_bans") or []]
                picks += [str(b).lower() for b in draft.get("enemy_bans") or []]
            if needle not in picks:
                continue
            for g in row["games"]:
                g.pop("draft", None)
        out.append(row)
    return out


@router.get("/summary")
def scrims_summary(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Searchable-results overview: totals, opponent records, duration/KDA averages."""
    played = db.scalars(select(Scrim).where(Scrim.status == "played")).all()
    total = len(played)
    wins = sum(1 for s in played if s.result == "WIN")
    losses = total - wins

    opponents: dict[str, dict] = {}
    for s in played:
        rec = opponents.setdefault(s.opponent, {"opponent": s.opponent, "played": 0, "won": 0, "lost": 0})
        rec["played"] += 1
        rec["won" if s.result == "WIN" else "lost"] += 1
    records = sorted(opponents.values(), key=lambda r: (-r["played"], r["opponent"]))

    games = db.scalars(
        select(ScrimGame).join(Scrim, ScrimGame.scrim_id == Scrim.id).where(Scrim.status == "played")
    ).all()
    g_n = len(games)
    dur = kills = deaths = 0.0
    objectives = 0
    for g in games:
        st = loads(g.stats, {})
        dur += g.duration_min or 0
        kills += int(st.get("kills") or 0)
        deaths += int(st.get("deaths") or 0)
        objectives += int(st.get("turtles") or 0) + int(st.get("lords") or 0)
    game_wins = sum(1 for g in games if g.result == "WIN")

    return {
        "series": {"total": total, "wins": wins, "losses": losses,
                   "win_rate": round(100 * wins / total, 1) if total else None},
        "games": {"total": g_n, "wins": game_wins, "losses": g_n - game_wins,
                  "win_rate": round(100 * game_wins / g_n, 1) if g_n else None},
        "averages": {
            "duration_min": round(dur / g_n, 1) if g_n else None,
            "kills": round(kills / g_n, 1) if g_n else None,
            "deaths": round(deaths / g_n, 1) if g_n else None,
            "objectives": round(objectives / g_n, 1) if g_n else None,
        },
        "opponents": records,
        "blocking_losses": [scrim_out(s, with_games=False) for s in blocking_losses(db)],
    }


@router.get("/{scrim_id}")
def get_scrim(scrim_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    scrim = db.get(Scrim, scrim_id)
    if scrim is None:
        raise HTTPException(status_code=404, detail="Scrim not found")
    return scrim_out(scrim)


@router.post("", status_code=201)
@router.post("/", status_code=201)
def create_scrim(payload: ScrimIn, force: bool = Query(default=False),
                 db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_scrims(user), "create scrims")
    blocks = blocking_losses(db)
    if blocks and not (force and user.role == "admin"):
        raise HTTPException(
            status_code=409,
            detail={
                "rule": "NO REVIEW, NO NEXT SCRIM",
                "message": f"Scrim #{blocks[0].number} vs {blocks[0].opponent} was a LOSS and has no "
                           f"match review. File the review before booking the next scrim.",
                "blocking": [{"scrim_id": s.id, "number": s.number, "opponent": s.opponent,
                              "date": s.scrim_date.isoformat() if s.scrim_date else None}
                             for s in blocks],
            },
        )
    next_number = (db.scalar(select(func.max(Scrim.number))) or 0) + 1
    scrim = Scrim(
        number=next_number, opponent=payload.opponent.strip(), scrim_date=payload.date,
        start_time=payload.time, format=payload.format.upper(), server=payload.server,
        tournament_prep=payload.tournament_prep, lineup=dumps(payload.lineup),
        substitutes=dumps(payload.substitutes), notes=payload.notes,
        expected_strategy=payload.expected_strategy, status="scheduled", created_by=user.id,
    )
    db.add(scrim)
    db.commit()
    db.refresh(scrim)
    return scrim_out(scrim)


@router.patch("/{scrim_id}")
def update_scrim(scrim_id: int, payload: ScrimPatch, db: Session = Depends(get_db),
                 user=Depends(get_current_user)):
    scrim = db.get(Scrim, scrim_id)
    if scrim is None:
        raise HTTPException(status_code=404, detail="Scrim not found")
    data = payload.model_dump(exclude_unset=True)

    # Result columns only through the results-upload capability.
    result_fields = {"status", "result", "attachments"}
    if set(data) & result_fields and not set(data) - result_fields:
        require(can.upload_results(user) or can.manage_scrims(user), "upload scrim results")
    else:
        require(can.manage_scrims(user), "edit scrims")

    if "date" in data:
        data["scrim_date"] = data.pop("date")
    if "time" in data:
        data["start_time"] = data.pop("time")
    if "format" in data and data["format"]:
        data["format"] = data["format"].upper()
    if "result" in data and data["result"]:
        data["result"] = data["result"].upper()
    if "lineup" in data and data["lineup"] is not None:
        data["lineup"] = dumps(data["lineup"])
    if "substitutes" in data and data["substitutes"] is not None:
        data["substitutes"] = dumps(data["substitutes"])
    if "attachments" in data and data["attachments"] is not None:
        data["attachments"] = dumps(data["attachments"])

    if data.get("result") in {"WIN", "LOSS", "DRAW"}:
        data.setdefault("status", "played")
    for key, value in data.items():
        setattr(scrim, key, value)

    # Keep the series score in sync with recorded games.
    if scrim.games:
        scrim.score_us = sum(1 for g in scrim.games if g.result == "WIN")
        scrim.score_them = sum(1 for g in scrim.games if g.result == "LOSS")
        if not data.get("result") and (scrim.score_us or scrim.score_them):
            scrim.result = "WIN" if scrim.score_us > scrim.score_them else ("LOSS" if scrim.score_them > scrim.score_us else "")
            if scrim.result:
                scrim.status = "played"
    db.commit()
    db.refresh(scrim)
    return scrim_out(scrim)


@router.post("/{scrim_id}/games", status_code=201)
def add_game(scrim_id: int, payload: GameIn, db: Session = Depends(get_db),
             user=Depends(get_current_user)):
    require(can.upload_results(user) or can.manage_scrims(user), "record scrim games")
    scrim = db.get(Scrim, scrim_id)
    if scrim is None:
        raise HTTPException(status_code=404, detail="Scrim not found")
    result = payload.result.upper()
    if result not in {"WIN", "LOSS", ""}:
        raise HTTPException(status_code=422, detail="result must be WIN or LOSS")
    game = ScrimGame(scrim_id=scrim.id, game_no=payload.game_no, result=result,
                     duration_min=payload.duration_min,
                     stats=dumps(payload.stats), draft=dumps(payload.draft))
    db.add(game)
    us = sum(1 for g in scrim.games if g.result == "WIN") + (1 if result == "WIN" else 0)
    them = sum(1 for g in scrim.games if g.result == "LOSS") + (1 if result == "LOSS" else 0)
    scrim.score_us, scrim.score_them = us, them
    if us or them:
        scrim.result = "WIN" if us > them else "LOSS"
        scrim.status = "played"
    db.commit()
    db.refresh(game)
    return game_out(game)


@router.delete("/{scrim_id}/games/{game_id}", status_code=204)
def delete_game(scrim_id: int, game_id: int, db: Session = Depends(get_db),
                user=Depends(get_current_user)):
    require(can.upload_results(user) or can.manage_scrims(user), "edit scrim games")
    game = db.get(ScrimGame, game_id)
    if game is None or game.scrim_id != scrim_id:
        raise HTTPException(status_code=404, detail="Game not found")
    db.delete(game)
    db.commit()
    scrim = db.get(Scrim, scrim_id)
    if scrim:
        scrim.score_us = sum(1 for g in scrim.games if g.result == "WIN")
        scrim.score_them = sum(1 for g in scrim.games if g.result == "LOSS")
        db.commit()
    return None


@router.delete("/{scrim_id}", status_code=204)
def delete_scrim(scrim_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_scrims(user), "delete scrims")
    scrim = db.get(Scrim, scrim_id)
    if scrim is None:
        raise HTTPException(status_code=404, detail="Scrim not found")
    db.delete(scrim)
    db.commit()
    return None
