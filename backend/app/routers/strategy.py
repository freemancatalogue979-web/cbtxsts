"""Strategy planner + tactical knowledge base."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..deps import can, get_current_user, get_db, require
from ..models import StrategyNote, dumps
from ..schemas import StrategyIn, StrategyPatch
from ..serializers import strategy_out

router = APIRouter(prefix="/strategy", tags=["strategy"])


@router.get("")
@router.get("/")
def list_notes(
    q: str | None = Query(default=None),
    category: str | None = Query(default=None),
    opponent: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    stmt = select(StrategyNote).order_by(StrategyNote.pinned.desc(), StrategyNote.updated_at.desc())
    if category:
        stmt = stmt.where(StrategyNote.category == category.upper())
    if opponent:
        stmt = stmt.where(StrategyNote.opponent.ilike(f"%{opponent}%"))
    notes = db.scalars(stmt.limit(300)).all()
    if q:
        needle = q.lower()
        notes = [n for n in notes
                 if needle in n.title.lower() or needle in n.body.lower() or needle in (n.tags or "").lower()]
    return [strategy_out(n) for n in notes]


@router.post("", status_code=201)
@router.post("/", status_code=201)
def create_note(payload: StrategyIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_strategy(user), "edit strategies")
    note = StrategyNote(
        title=payload.title, category=payload.category.upper(), body=payload.body,
        tags=dumps(payload.tags), opponent=payload.opponent.strip(), patch=payload.patch.strip(),
        pinned=payload.pinned, author_id=user.id,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return strategy_out(note)


@router.patch("/{note_id}")
def update_note(note_id: int, payload: StrategyPatch, db: Session = Depends(get_db),
                user=Depends(get_current_user)):
    require(can.manage_strategy(user), "edit strategies")
    note = db.get(StrategyNote, note_id)
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    data = payload.model_dump(exclude_unset=True)
    if "category" in data and data["category"]:
        data["category"] = data["category"].upper()
    if "tags" in data and data["tags"] is not None:
        data["tags"] = dumps(data["tags"])
    for key, value in data.items():
        setattr(note, key, value)
    db.commit()
    db.refresh(note)
    return strategy_out(note)


@router.delete("/{note_id}", status_code=204)
def delete_note(note_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_strategy(user), "delete strategies")
    note = db.get(StrategyNote, note_id)
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    db.delete(note)
    db.commit()
    return None
