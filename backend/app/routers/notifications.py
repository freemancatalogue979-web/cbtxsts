"""Notifications + staff announcements.

Anyone reads their own feed; admin, captain, coach and analyst can send
announcements to everyone, a role group, or a specific user. Assignment
reminders are fanned out here too (training router calls ``notify``).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db
from ..models import Notification, User, utcnow

router = APIRouter(prefix="/notifications", tags=["notifications"])

STAFF_ROLES = {"admin", "captain", "coach", "analyst"}
ROLE_SET = {"player", "captain", "coach", "analyst", "admin"}


def _out(n: Notification, actors: dict[int, User]) -> dict:
    actor = actors.get(n.actor_id) if n.actor_id else None
    return {
        "id": n.id,
        "kind": n.kind,
        "title": n.title,
        "body": n.body,
        "link": n.link,
        "from": actor.ign or actor.name if actor else "9 CLOVER",
        "read": n.read_at is not None,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


def notify(db: Session, actor: User | None, user_ids: list[int], kind: str,
           title: str, body: str, link: str = "") -> int:
    """Fan out one notification row per recipient (skipping the actor)."""
    actor_id = actor.id if actor else None
    ids = [i for i in dict.fromkeys(user_ids) if i != actor_id]
    if not ids:
        return 0
    existing = set(db.scalars(select(User.id).where(User.id.in_(ids), User.active.is_(True))))
    for uid in sorted(existing):
        db.add(Notification(user_id=uid, actor_id=actor_id, kind=kind,
                            title=title[:160], body=body, link=link))
    return len(existing)


@router.get("")
def list_mine(limit: int = 100, db: Session = Depends(get_db), user=Depends(get_current_user)):
    limit = max(1, min(200, limit))
    rows = db.scalars(
        select(Notification).where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc()).limit(limit)
    ).all()
    actor_ids = {n.actor_id for n in rows if n.actor_id}
    actors = {u.id: u for u in db.scalars(select(User).where(User.id.in_(actor_ids)))} if actor_ids else {}
    return [_out(n, actors) for n in rows]


@router.get("/unread-count")
def unread_count(db: Session = Depends(get_db), user=Depends(get_current_user)):
    n = db.scalar(
        select(func.count()).select_from(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
    )
    return {"count": n or 0}


@router.post("/{notification_id}/read")
def mark_read(notification_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    n = db.get(Notification, notification_id)
    if n is None or n.user_id != user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    if n.read_at is None:
        n.read_at = utcnow()
        db.commit()
    return {"ok": True, "unread": db.scalar(
        select(func.count()).select_from(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))) or 0}


@router.post("/read-all")
def read_all(db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = db.scalars(
        select(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
    ).all()
    for n in rows:
        n.read_at = utcnow()
    db.commit()
    return {"ok": True, "marked": len(rows)}


class SendIn(BaseModel):
    body: str = Field(min_length=1, max_length=600)
    audience: str = "all"          # all | role | user
    role: str | None = None        # when audience == role
    user_id: int | None = None     # when audience == user


@router.post("/send", status_code=201)
def send(payload: SendIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if user.role not in STAFF_ROLES:
        raise HTTPException(status_code=403, detail="Only admin, captain, coach or analyst can send announcements.")
    if payload.audience == "role":
        role = (payload.role or "").lower()
        if role not in ROLE_SET:
            raise HTTPException(status_code=422, detail="Unknown role group")
        ids = db.scalars(select(User.id).where(User.role == role, User.active.is_(True))).all()
    elif payload.audience == "user":
        if payload.user_id is None or db.get(User, payload.user_id) is None:
            raise HTTPException(status_code=422, detail="Unknown user")
        ids = [payload.user_id]
    else:
        ids = db.scalars(select(User.id).where(User.active.is_(True))).all()
    sent = notify(db, user, list(ids), "announcement", "Announcement", payload.body.strip())
    db.commit()
    return {"sent": sent}
