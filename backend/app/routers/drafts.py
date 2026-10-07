"""Draft planner: saved draft boards (our/enemy bans + picks per lane)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import can, get_current_user, get_db, require
from ..models import DraftPlan, dumps, loads
from ..schemas import DraftIn, DraftPatch
from ..serializers import draft_out

router = APIRouter(prefix="/drafts", tags=["drafts"])


def _normalized_draft(raw: dict) -> dict:
    """Guarantee the board shape: 5+5 bans, lane-keyed picks both sides."""
    base = {"our_bans": [None] * 5, "enemy_bans": [None] * 5,
            "our_picks": {}, "enemy_picks": {}}
    if not isinstance(raw, dict):
        return base
    base["our_bans"] = (list(raw.get("our_bans") or []) + [None] * 5)[:5]
    base["enemy_bans"] = (list(raw.get("enemy_bans") or []) + [None] * 5)[:5]
    base["our_picks"] = dict(raw.get("our_picks") or {})
    base["enemy_picks"] = dict(raw.get("enemy_picks") or {})
    return base


@router.get("")
@router.get("/")
def list_drafts(
    opponent: str | None = Query(default=None),
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    stmt = select(DraftPlan).order_by(DraftPlan.updated_at.desc())
    if opponent:
        stmt = stmt.where(DraftPlan.opponent.ilike(f"%{opponent}%"))
    if status:
        stmt = stmt.where(DraftPlan.status == status)
    return [draft_out(d) for d in db.scalars(stmt.limit(200)).all()]


@router.get("/{draft_id}")
def get_draft(draft_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    draft = db.get(DraftPlan, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    return draft_out(draft)


@router.post("", status_code=201)
@router.post("/", status_code=201)
def create_draft(payload: DraftIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_drafts(user), "edit draft plans")
    draft = DraftPlan(
        name=payload.name, opponent=payload.opponent.strip(), patch=payload.patch.strip(),
        notes=payload.notes, draft=dumps(_normalized_draft(payload.draft)),
        status=payload.status, created_by=user.id,
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return draft_out(draft)


@router.patch("/{draft_id}")
def update_draft(draft_id: int, payload: DraftPatch, db: Session = Depends(get_db),
                 user=Depends(get_current_user)):
    require(can.manage_drafts(user), "edit draft plans")
    draft = db.get(DraftPlan, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    data = payload.model_dump(exclude_unset=True)
    if "draft" in data and data["draft"] is not None:
        data["draft"] = dumps(_normalized_draft(data["draft"]))
    for key, value in data.items():
        setattr(draft, key, value)
    db.commit()
    db.refresh(draft)
    return draft_out(draft)


@router.delete("/{draft_id}", status_code=204)
def delete_draft(draft_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_drafts(user), "delete draft plans")
    draft = db.get(DraftPlan, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    db.delete(draft)
    db.commit()
    return None
