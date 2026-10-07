"""Match review system — the most important feature.

NO REVIEW, NO NEXT SCRIM. After every lost competitive game the review is
mandatory; scrim booking is blocked until it exists.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import can, get_current_user, get_db, require
from ..models import MatchReview, Scrim, TournamentMatch, dumps, loads
from ..schemas import ReviewIn, ReviewPatch
from ..serializers import review_out

router = APIRouter(prefix="/reviews", tags=["reviews"])


@router.get("")
@router.get("/")
def list_reviews(
    status: str | None = Query(default=None),
    opponent: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    stmt = select(MatchReview).order_by(MatchReview.review_date.desc().nullslast(), MatchReview.id.desc())
    if status:
        stmt = stmt.where(MatchReview.status == status)
    if opponent:
        stmt = stmt.where(MatchReview.opponent.ilike(f"%{opponent}%"))
    return [review_out(r) for r in db.scalars(stmt.limit(300)).all()]


@router.get("/{review_id}")
def get_review(review_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    review = db.get(MatchReview, review_id)
    if review is None:
        raise HTTPException(status_code=404, detail="Review not found")
    return review_out(review)


@router.post("", status_code=201)
@router.post("/", status_code=201)
def create_review(payload: ReviewIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.create_review(user), "create match reviews")
    scrim = None
    if payload.scrim_id is not None:
        scrim = db.get(Scrim, payload.scrim_id)
        if scrim is None:
            raise HTTPException(status_code=404, detail="Scrim not found")
        if db.scalar(select(MatchReview).where(MatchReview.scrim_id == scrim.id)):
            raise HTTPException(status_code=409, detail="That scrim already has a review — edit it instead")
    tmatch = None
    if payload.tournament_match_id is not None:
        tmatch = db.get(TournamentMatch, payload.tournament_match_id)
        if tmatch is None:
            raise HTTPException(status_code=404, detail="Tournament match not found")
        if db.scalar(select(MatchReview).where(MatchReview.tournament_match_id == tmatch.id)):
            raise HTTPException(status_code=409, detail="That match already has a review — edit it instead")
    mandatory = bool(scrim and scrim.result == "LOSS")
    review = MatchReview(
        scrim_id=payload.scrim_id,
        tournament_match_id=payload.tournament_match_id,
        opponent=payload.opponent or (scrim.opponent if scrim else "") or (tmatch.opponent if tmatch else ""),
        review_date=payload.date or (scrim.scrim_date if scrim else None) or (tmatch.scheduled_date if tmatch else None),
        duration_min=payload.duration_min,
        result=(payload.result or (scrim.result if scrim else "") or (tmatch.result if tmatch else "LOSS")).upper(),
        player_ids=dumps(payload.player_ids),
        stats=dumps(payload.stats), draft=dumps(payload.draft),
        biggest_mistakes=dumps([m for m in payload.biggest_mistakes if str(m).strip()]),
        why_happened=payload.why_happened, should_have_done=payload.should_have_done,
        who_involved=payload.who_involved, what_change=payload.what_change,
        lesson=payload.lesson, action_item=payload.action_item,
        action_assignee_id=payload.action_assignee_id, action_deadline=payload.action_deadline,
        status=payload.status, mandatory=mandatory, created_by=user.id,
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    return review_out(review)


@router.patch("/{review_id}")
def update_review(review_id: int, payload: ReviewPatch, db: Session = Depends(get_db),
                  user=Depends(get_current_user)):
    require(can.create_review(user), "edit match reviews")
    review = db.get(MatchReview, review_id)
    if review is None:
        raise HTTPException(status_code=404, detail="Review not found")
    data = payload.model_dump(exclude_unset=True)
    if "date" in data:
        data["review_date"] = data.pop("date")
    if "result" in data and data["result"]:
        data["result"] = data["result"].upper()
    for json_field in ("player_ids", "stats", "draft", "biggest_mistakes"):
        if json_field in data and data[json_field] is not None:
            data[json_field] = dumps(data[json_field])
    for key, value in data.items():
        setattr(review, key, value)
    db.commit()
    db.refresh(review)
    return review_out(review)


@router.delete("/{review_id}", status_code=204)
def delete_review(review_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.create_review(user), "delete match reviews")
    review = db.get(MatchReview, review_id)
    if review is None:
        raise HTTPException(status_code=404, detail="Review not found")
    db.delete(review)
    db.commit()
    return None
