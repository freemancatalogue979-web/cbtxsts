"""Ban board: standard bans, opponent-specific bans, patch-specific bans."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import can, get_current_user, get_db, require
from ..models import BanEntry, Hero
from ..schemas import BanIn, BanPatch
from ..serializers import ban_out

router = APIRouter(prefix="/bans", tags=["bans"])


@router.get("")
@router.get("/")
def list_bans(
    scope: str | None = Query(default=None),
    opponent: str | None = Query(default=None),
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    stmt = select(BanEntry).order_by(BanEntry.scope, BanEntry.opponent, BanEntry.priority)
    if scope:
        stmt = stmt.where(BanEntry.scope == scope)
    if opponent:
        stmt = stmt.where(BanEntry.opponent.ilike(f"%{opponent}%"))
    if not include_inactive:
        stmt = stmt.where(BanEntry.active.is_(True))
    return [ban_out(b) for b in db.scalars(stmt).all()]


@router.post("", status_code=201)
@router.post("/", status_code=201)
def create_ban(payload: BanIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_bans(user), "edit the ban board")
    hero_name = payload.hero_name
    hero_id = payload.hero_id
    if hero_id and not hero_name:
        hero = db.get(Hero, hero_id)
        if hero:
            hero_name = hero.name
    if not hero_name.strip():
        raise HTTPException(status_code=422, detail="hero_name is required")
    entry = BanEntry(
        scope=payload.scope, priority=payload.priority, opponent=payload.opponent.strip(),
        patch=payload.patch.strip(), hero_id=hero_id, hero_name=hero_name.strip(),
        reason=payload.reason, active=payload.active,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return ban_out(entry)


@router.patch("/{ban_id}")
def update_ban(ban_id: int, payload: BanPatch, db: Session = Depends(get_db),
               user=Depends(get_current_user)):
    require(can.manage_bans(user), "edit the ban board")
    entry = db.get(BanEntry, ban_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Ban entry not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(entry, key, value)
    db.commit()
    db.refresh(entry)
    return ban_out(entry)


@router.delete("/{ban_id}", status_code=204)
def delete_ban(ban_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_bans(user), "edit the ban board")
    entry = db.get(BanEntry, ban_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Ban entry not found")
    db.delete(entry)
    db.commit()
    return None
