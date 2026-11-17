"""Trash: list, restore and (permanently) purge deleted items."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db
from ..models import TrashItem, User, loads
from .. import trash as bin_

router = APIRouter(prefix="/trash", tags=["trash"])


def _out(item: TrashItem, user: User, names: dict[int, str]) -> dict:
    return {
        "id": item.id,
        "kind": item.kind,
        "area": item.area,
        "label": item.label,
        "summary": item.summary,
        "target_id": item.target_id,
        "deleted_at": item.deleted_at.isoformat() + "Z" if item.deleted_at else None,
        "deleted_by": {"id": item.deleted_by, "name": names.get(item.deleted_by or 0, "Someone")} if item.deleted_by else None,
        "restricted": item.restricted,
        "rows": item.row_count,
        "files": len(loads(item.files, [])),
        "can_purge": bin_.can_purge(user, item),
    }


def _visible(db: Session, user: User) -> list[TrashItem]:
    rows = db.scalars(select(TrashItem).order_by(TrashItem.deleted_at.desc(), TrashItem.id.desc())).all()
    return [r for r in rows if bin_.can_see(user, r)]


def _get(db: Session, user: User, item_id: int) -> TrashItem:
    item = db.get(TrashItem, item_id)
    if item is None or not bin_.can_see(user, item):
        raise HTTPException(status_code=404, detail="Not in trash (already restored or deleted forever)")
    return item


@router.get("")
def list_trash(area: str | None = Query(default=None), q: str | None = Query(default=None),
               db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    names = {u.id: (u.ign or u.name) for u in db.scalars(select(User)).all()}
    items = _visible(db, user)
    areas: dict[str, int] = {}
    for it in items:
        areas[it.area] = areas.get(it.area, 0) + 1
    if area:
        items = [it for it in items if it.area == area]
    if q:
        needle = q.strip().lower()
        items = [it for it in items if needle in it.label.lower() or needle in it.summary.lower() or needle in it.kind]
    return {"items": [_out(it, user, names) for it in items[:500]], "areas": areas,
            "total": sum(areas.values())}


@router.post("/{item_id}/restore")
def restore_item(item_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return bin_.restore(db, _get(db, user, item_id))


@router.delete("/{item_id}", status_code=204)
def purge_item(item_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = _get(db, user, item_id)
    if not bin_.can_purge(user, item):
        raise HTTPException(status_code=403, detail="Only an admin can delete shared items forever")
    bin_.purge(db, item)
    db.commit()


@router.delete("")
def empty_trash(confirm: bool = Query(default=False), db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    """Delete forever everything in Trash the caller is allowed to purge."""
    if not confirm:
        raise HTTPException(status_code=422, detail="Confirmation required.")
    items = [it for it in _visible(db, user) if bin_.can_purge(user, it)]
    for it in items:
        bin_.purge(db, it)
    db.commit()
    return {"deleted": len(items)}


