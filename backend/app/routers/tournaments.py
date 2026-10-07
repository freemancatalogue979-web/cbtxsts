"""Tournaments — named competitions with their own schedule, match drafts,
results and an optional review flag.

Parallel to scrims: Tournament → matches (stage/day, draft, result, evidence)
→ optional match review via the standard MatchReview flow. Unlike scrims a
tournament LOSS never blocks future booking — review is opt-in here.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import can, get_current_user, get_db, require
from ..models import MatchReview, Tournament, TournamentMatch, dumps, loads, utcnow
from ..serializers import review_out

router = APIRouter(prefix="/tournaments", tags=["tournaments"])


# --------------------------------------------------------------------------- #
# Serializers
# --------------------------------------------------------------------------- #
def match_out(m: TournamentMatch) -> dict:
    return {
        "id": m.id,
        "match_no": m.match_no,
        "stage": m.stage,
        "scheduled_date": m.scheduled_date.isoformat() if m.scheduled_date else None,
        "start_time": m.start_time,
        "opponent": m.opponent,
        "format": m.format,
        "status": m.status,
        "result": m.result,
        "score_us": m.score_us,
        "score_them": m.score_them,
        "notes": m.notes,
        "draft": loads(m.draft, {}),
        "attachments": loads(m.attachments),
        "review_queued": m.review_queued,
        "has_review": m.review is not None,
        "review_id": m.review.id if m.review else None,
    }


def tournament_out(t: Tournament, *, with_matches: bool = True) -> dict:
    matches = sorted(t.matches, key=lambda m: (m.scheduled_date or date.max, m.match_no))
    played = [m for m in matches if m.status == "played"]
    out = {
        "id": t.id,
        "name": t.name,
        "status": t.status,
        "review_queued": t.review_queued,
        "start_date": t.start_date.isoformat() if t.start_date else None,
        "end_date": t.end_date.isoformat() if t.end_date else None,
        "notes": t.notes,
        "match_count": len(matches),
        "played_count": len(played),
        "wins": sum(1 for m in played if m.result == "WIN"),
        "losses": sum(1 for m in played if m.result == "LOSS"),
        "review_pending": sum(1 for m in played if m.review_queued and m.review is None),
        "stages": sorted({m.stage for m in matches if m.stage}),
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }
    if with_matches:
        out["matches"] = [match_out(m) for m in matches]
    return out


def _get(db: Session, tournament_id: int) -> Tournament:
    t = db.get(Tournament, tournament_id)
    if t is None:
        raise HTTPException(status_code=404, detail="Tournament not found")
    return t


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class TournamentIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    status: str = "upcoming"
    review_queued: bool = False
    start_date: date | None = None
    end_date: date | None = None
    notes: str = ""


class TournamentPatch(BaseModel):
    name: str | None = None
    status: str | None = None
    review_queued: bool | None = None
    start_date: date | None = None
    end_date: date | None = None
    notes: str | None = None


class MatchIn(BaseModel):
    stage: str = ""
    scheduled_date: date | None = None
    start_time: str = ""
    opponent: str = Field(min_length=1, max_length=120)
    format: str = "BO3"
    review_queued: bool = False
    notes: str = ""


class MatchPatch(BaseModel):
    stage: str | None = None
    scheduled_date: date | None = None
    start_time: str | None = None
    opponent: str | None = None
    format: str | None = None
    status: str | None = None
    result: str | None = None
    score_us: int | None = None
    score_them: int | None = None
    notes: str | None = None
    draft: dict | None = None
    attachments: list[dict] | None = None
    review_queued: bool | None = None


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@router.get("")
def list_tournaments(db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = db.scalars(select(Tournament).order_by(Tournament.created_at.desc()).limit(200)).all()
    return [tournament_out(t, with_matches=False) for t in rows]


@router.get("/review-queue")
def review_queue(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Played matches flagged for review that have no review filed yet."""
    ms = db.scalars(
        select(TournamentMatch)
        .where(TournamentMatch.status == "played", TournamentMatch.review_queued.is_(True))
        .order_by(TournamentMatch.scheduled_date.desc().nullslast(), TournamentMatch.id.desc())
    ).all()
    out = []
    for m in ms:
        if m.review is not None:
            continue
        o = match_out(m)
        o["tournament_id"] = m.tournament_id
        o["tournament_name"] = m.tournament.name
        out.append(o)
    return out


@router.post("", status_code=201)
def create_tournament(payload: TournamentIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_scrims(user), "create tournaments")
    t = Tournament(name=payload.name.strip(), status="upcoming", review_queued=payload.review_queued,
                   start_date=payload.start_date, end_date=payload.end_date,
                   notes=payload.notes, created_by=user.id)
    db.add(t)
    db.commit()
    db.refresh(t)
    return tournament_out(t)


@router.get("/{tournament_id}")
def get_tournament(tournament_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    return tournament_out(_get(db, tournament_id))


@router.patch("/{tournament_id}")
def update_tournament(tournament_id: int, payload: TournamentPatch, db: Session = Depends(get_db),
                      user=Depends(get_current_user)):
    require(can.manage_scrims(user), "update tournaments")
    t = _get(db, tournament_id)
    data = payload.model_dump(exclude_unset=True)
    if (st := data.pop("status", None)) is not None and st in {"upcoming", "ongoing", "finished"}:
        t.status = st
    for k, v in data.items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return tournament_out(t)


@router.delete("/{tournament_id}", status_code=204)
def delete_tournament(tournament_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_scrims(user), "delete tournaments")
    db.delete(_get(db, tournament_id))
    db.commit()


# --------------------------------- matches --------------------------------- #
@router.post("/{tournament_id}/matches", status_code=201)
def add_match(tournament_id: int, payload: MatchIn, db: Session = Depends(get_db),
              user=Depends(get_current_user)):
    require(can.upload_results(user), "schedule tournament matches")
    t = _get(db, tournament_id)
    m = TournamentMatch(
        tournament_id=t.id,
        match_no=(max((x.match_no for x in t.matches), default=0) + 1),
        stage=payload.stage.strip(),
        scheduled_date=payload.scheduled_date,
        start_time=payload.start_time,
        opponent=payload.opponent.strip(),
        format=payload.format,
        review_queued=payload.review_queued,
        notes=payload.notes,
    )
    db.add(m)
    db.commit()
    db.refresh(t)
    return tournament_out(t)


def _get_match(db: Session, match_id: int) -> TournamentMatch:
    m = db.get(TournamentMatch, match_id)
    if m is None:
        raise HTTPException(status_code=404, detail="Match not found")
    return m


@router.patch("/matches/{match_id}")
def update_match(match_id: int, payload: MatchPatch, db: Session = Depends(get_db),
                 user=Depends(get_current_user)):
    require(can.upload_results(user), "update tournament matches")
    m = _get_match(db, match_id)
    data = payload.model_dump(exclude_unset=True)
    if (st := data.pop("status", None)) is not None and st in {"scheduled", "played", "cancelled"}:
        m.status = st
    if (rs := data.pop("result", None)) is not None:
        m.result = rs.upper() if rs.upper() in {"WIN", "LOSS", "DRAW"} else ""
    if (dr := data.pop("draft", None)) is not None:
        m.draft = dumps(dr)
    if (at := data.pop("attachments", None)) is not None:
        m.attachments = dumps(at)
    for k, v in data.items():
        setattr(m, k, v)
    db.commit()
    db.refresh(m)
    return tournament_out(m.tournament)


@router.delete("/matches/{match_id}", status_code=204)
def delete_match(match_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.upload_results(user), "delete tournament matches")
    db.delete(_get_match(db, match_id))
    db.commit()
