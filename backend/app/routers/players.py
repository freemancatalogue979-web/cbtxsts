"""Roster, hero pools and the player development tracker."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import ROLE_CAPTAIN, ROLE_PLAYER, can, get_current_user, get_db, require
from ..models import DevelopmentEntry, Hero, HeroPoolEntry, Scrim, User, dumps, loads
from ..schemas import DevIn, PoolIn, PoolPatch
from ..serializers import dev_out, pool_out, user_out

router = APIRouter(prefix="/players", tags=["players"])


def _scrim_form(db: Session, user_id: int) -> dict:
    """Series record + last-five form for one player (lineup/sub appearances)."""
    played = db.scalars(
        select(Scrim).where(Scrim.status == "played").order_by(Scrim.scrim_date.desc(), Scrim.number.desc())
    ).all()
    mine = []
    for s in played:
        ids = list(loads(s.lineup, {}).values()) + loads(s.substitutes)
        if user_id in ids:
            mine.append(s)
    wins = sum(1 for s in mine if s.result == "WIN")
    form = [s.result for s in mine[:5]]
    return {
        "series_played": len(mine),
        "series_won": wins,
        "series_lost": len(mine) - wins,
        "win_rate": round(100 * wins / len(mine), 1) if mine else None,
        "form": form,
        "recent": [{"scrim_id": s.id, "number": s.number, "opponent": s.opponent,
                    "result": s.result, "score_us": s.score_us, "score_them": s.score_them,
                    "date": s.scrim_date.isoformat() if s.scrim_date else None} for s in mine[:5]],
    }


@router.get("")
@router.get("/")
def roster(db: Session = Depends(get_db), user=Depends(get_current_user)):
    players = db.scalars(
        select(User).where(User.roster.is_(True), User.active.is_(True))
        .order_by(User.main_role, User.ign)
    ).all()
    out = []
    for p in players:
        row = user_out(p)
        row["scrim_stats"] = _scrim_form(db, p.id)
        conf = [e.confidence for e in p.pool]
        row["avg_confidence"] = round(sum(conf) / len(conf), 1) if conf else None
        out.append(row)
    return out


@router.get("/{user_id}")
def player_detail(user_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    player = db.get(User, user_id)
    if player is None:
        raise HTTPException(status_code=404, detail="Player not found")

    pool = db.scalars(
        select(HeroPoolEntry).where(HeroPoolEntry.user_id == player.id)
        .order_by(HeroPoolEntry.category, HeroPoolEntry.confidence.desc())
    ).all()
    pool_by_cat: dict[str, list] = {"comfort": [], "meta": [], "pocket": [], "emergency": []}
    for e in pool:
        pool_by_cat.setdefault(e.category, []).append(pool_out(e))

    entries = db.scalars(
        select(DevelopmentEntry).where(DevelopmentEntry.user_id == player.id)
        .order_by(DevelopmentEntry.entry_date.desc(), DevelopmentEntry.id.desc()).limit(50)
    ).all()
    names = {u.id: (u.ign or u.name) for u in db.scalars(select(User)).all()}

    ratings = [e.rating for e in entries if e.rating is not None]
    row = user_out(player)
    row.update({
        "scrim_stats": _scrim_form(db, player.id),
        "pool": pool_by_cat,
        "development": [dev_out(e, names) for e in entries],
        "avg_rating": round(sum(ratings) / len(ratings), 1) if ratings else None,
        "can_rate": can.rate_players(user),
        "is_self": user.id == player.id,
    })
    return row


# ---------------------------------------------------------------------------
# Hero pool
# ---------------------------------------------------------------------------
@router.post("/{user_id}/pool", status_code=201)
def add_pool_entry(user_id: int, payload: PoolIn, db: Session = Depends(get_db),
                   user=Depends(get_current_user)):
    player = db.get(User, user_id)
    hero = db.get(Hero, payload.hero_id)
    if player is None or hero is None:
        raise HTTPException(status_code=404, detail="Player or hero not found")
    # Coach/admin manage everything; players may maintain their own pool.
    require(can.rate_players(user) or user.id == user_id, "edit this hero pool")
    entry = HeroPoolEntry(
        user_id=user_id, hero_id=payload.hero_id, category=payload.category,
        confidence=payload.confidence, last_played=payload.last_played,
        games=payload.games, wins=payload.wins, losses=payload.losses,
        coach_notes=payload.coach_notes if can.rate_players(user) else "",
    )
    db.add(entry)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=409, detail="Hero already in that pool category")
    db.refresh(entry)
    return pool_out(entry)


@router.patch("/pool/{entry_id}")
def update_pool_entry(entry_id: int, payload: PoolPatch, db: Session = Depends(get_db),
                      user=Depends(get_current_user)):
    entry = db.get(HeroPoolEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Pool entry not found")
    require(can.rate_players(user) or user.id == entry.user_id, "edit this hero pool")
    data = payload.model_dump(exclude_unset=True)
    if "coach_notes" in data and not can.rate_players(user):
        data.pop("coach_notes")
    for key, value in data.items():
        setattr(entry, key, value)
    db.commit()
    db.refresh(entry)
    return pool_out(entry)


@router.delete("/pool/{entry_id}", status_code=204)
def delete_pool_entry(entry_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    entry = db.get(HeroPoolEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Pool entry not found")
    require(can.rate_players(user) or user.id == entry.user_id, "edit this hero pool")
    db.delete(entry)
    db.commit()
    return None


# ---------------------------------------------------------------------------
# Development tracker: coach ratings + player self-reviews
# ---------------------------------------------------------------------------
@router.post("/{user_id}/development", status_code=201)
def add_development(user_id: int, payload: DevIn, db: Session = Depends(get_db),
                    user=Depends(get_current_user)):
    player = db.get(User, user_id)
    if player is None:
        raise HTTPException(status_code=404, detail="Player not found")
    source = payload.source
    if source == "self":
        require(user.id == user_id, "submit a self-review for someone else")
    else:
        require(can.rate_players(user), "rate players")
        source = "coach"
    entry = DevelopmentEntry(
        user_id=user_id, entry_date=payload.date, source=source,
        category=payload.category.upper(), rating=payload.rating,
        notes=payload.notes, created_by=user.id,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return dev_out(entry, {user.id: user.ign or user.name})


@router.delete("/development/{entry_id}", status_code=204)
def delete_development(entry_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    entry = db.get(DevelopmentEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    staff = can.rate_players(user)
    require(staff or (entry.source == "self" and entry.created_by == user.id), "delete this entry")
    db.delete(entry)
    db.commit()
    return None
