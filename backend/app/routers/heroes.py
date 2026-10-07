"""Hero / meta database."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import can, get_current_user, get_db, require
from ..models import BanEntry, Hero, HeroPoolEntry, dumps
from ..schemas import HeroIn, HeroPatch
from ..serializers import hero_out

router = APIRouter(prefix="/heroes", tags=["heroes"])


@router.get("")
@router.get("/")
def list_heroes(
    q: str | None = Query(default=None),
    role: str | None = Query(default=None),
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    stmt = select(Hero).order_by(Hero.role, Hero.clover_rating.desc())
    if q:
        stmt = stmt.where(Hero.name.ilike(f"%{q}%"))
    if role:
        stmt = stmt.where(Hero.role == role.upper())
    if status:
        stmt = stmt.where(Hero.meta_status == status.upper())
    return [hero_out(h) for h in db.scalars(stmt).all()]


@router.get("/{hero_id}")
def get_hero(hero_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    hero = db.get(Hero, hero_id)
    if hero is None:
        raise HTTPException(status_code=404, detail="Hero not found")

    entries = db.scalars(
        select(HeroPoolEntry).where(HeroPoolEntry.hero_id == hero.id)
        .order_by(HeroPoolEntry.confidence.desc())
    ).all()
    specialists = [{
        "user_id": e.user_id,
        "name": e.user.name if e.user else "",
        "ign": e.user.ign if e.user else "",
        "main_role": e.user.main_role if e.user else "",
        "category": e.category,
        "confidence": e.confidence,
        "games": e.games,
        "win_rate": round(100 * e.wins / e.games, 1) if e.games else None,
    } for e in entries]

    bans = db.scalars(select(BanEntry).where(BanEntry.hero_id == hero.id, BanEntry.active)).all()
    data = hero_out(hero)
    data["specialists"] = specialists
    data["on_ban_board"] = [
        {"scope": b.scope, "priority": b.priority, "opponent": b.opponent, "patch": b.patch, "reason": b.reason}
        for b in bans
    ]
    return data


@router.post("", status_code=201)
@router.post("/", status_code=201)
def create_hero(payload: HeroIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_heroes(user), "add heroes")
    if db.scalar(select(Hero).where(Hero.name == payload.name.strip())):
        raise HTTPException(status_code=409, detail="Hero already exists")
    hero = Hero(
        name=payload.name.strip(), role=payload.role.upper(), hero_class=payload.hero_class,
        difficulty=payload.difficulty, meta_status=payload.meta_status.upper(), tier=payload.tier.upper(),
        patch=payload.patch, win_rate=payload.win_rate, pick_rate=payload.pick_rate,
        ban_rate=payload.ban_rate, clover_rating=payload.clover_rating, notes=payload.notes,
        strong_against=dumps(payload.strong_against), weak_against=dumps(payload.weak_against),
        synergy=dumps(payload.synergy),
    )
    db.add(hero)
    db.commit()
    db.refresh(hero)
    return hero_out(hero)


@router.patch("/{hero_id}")
def update_hero(hero_id: int, payload: HeroPatch, db: Session = Depends(get_db),
                user=Depends(get_current_user)):
    hero = db.get(Hero, hero_id)
    if hero is None:
        raise HTTPException(status_code=404, detail="Hero not found")
    data = payload.model_dump(exclude_unset=True)
    # Admin owns structure; coach may annotate (notes, rating, counters).
    if not can.manage_heroes(user):
        coach_fields = {"notes", "clover_rating", "strong_against", "weak_against", "synergy",
                        "meta_status", "tier", "win_rate", "pick_rate", "ban_rate"}
        require(can.annotate_heroes(user) and not (set(data) - coach_fields), "edit those hero fields")
    if "role" in data and data["role"]:
        data["role"] = data["role"].upper()
    if "meta_status" in data and data["meta_status"]:
        data["meta_status"] = data["meta_status"].upper()
    if "tier" in data and data["tier"]:
        data["tier"] = data["tier"].upper()
    for f in ("strong_against", "weak_against", "synergy"):
        if f in data and data[f] is not None:
            data[f] = dumps(data[f])
    for key, value in data.items():
        setattr(hero, key, value)
    db.commit()
    db.refresh(hero)
    return hero_out(hero)


@router.delete("/{hero_id}", status_code=204)
def delete_hero(hero_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_heroes(user), "delete heroes")
    hero = db.get(Hero, hero_id)
    if hero is None:
        raise HTTPException(status_code=404, detail="Hero not found")
    db.delete(hero)
    db.commit()
    return None
