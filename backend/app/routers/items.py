"""Team-maintained equipment. Public reference reads; admin-only writes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..models import User, utcnow
from ..platform_data import TeamEquipment
from ..platform_schemas import EquipmentIn, EquipmentPatch

router = APIRouter(prefix="/items", tags=["team-equipment"])


def item_admin(
    response: Response, authorization: str | None = Header(default=None), user: User = Depends(get_current_user)
) -> User:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(401, "Bearer sign-in required.")
    if user.role != "admin":
        raise HTTPException(403, "Only admins can edit team equipment.")
    response.headers["Cache-Control"] = "no-store"
    return user


def item_json(row: TeamEquipment) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "category": row.category,
        "description": row.description,
        "patch": row.patch,
        "source_url": row.source_url,
        "created_at": row.created_at.isoformat() + "Z",
        "updated_at": row.updated_at.isoformat() + "Z",
        "provenance": "Team-maintained; not an official or verified feed.",
    }


def duplicate(db: Session, name: str, except_id: int | None = None) -> bool:
    q = db.query(TeamEquipment.id).filter(func.lower(TeamEquipment.name) == name.lower())
    if except_id is not None:
        q = q.filter(TeamEquipment.id != except_id)
    return q.first() is not None


@router.get("")
def list_items(db: Session = Depends(get_db), _user: User = Depends(get_current_user)) -> list[dict]:
    return [item_json(row) for row in db.query(TeamEquipment).order_by(TeamEquipment.name).limit(500).all()]


@router.get("/{item_id}")
def get_item(item_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)) -> dict:
    row = db.get(TeamEquipment, item_id)
    if row is None:
        raise HTTPException(404, "Equipment record not found.")
    return item_json(row)


@router.post("", status_code=201)
def create_item(data: EquipmentIn, user: User = Depends(item_admin), db: Session = Depends(get_db)) -> dict:
    if duplicate(db, data.name):
        raise HTTPException(409, "An equipment record with that name already exists.")
    row = TeamEquipment(**data.model_dump(), created_by=user.id)
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An equipment record with that name already exists.") from None
    db.refresh(row)
    return item_json(row)


@router.patch("/{item_id}")
def update_item(
    item_id: int, data: EquipmentPatch, _user: User = Depends(item_admin), db: Session = Depends(get_db)
) -> dict:
    row = db.get(TeamEquipment, item_id)
    if row is None:
        raise HTTPException(404, "Equipment record not found.")
    changes = data.model_dump(exclude_unset=True)
    if any(value is None for value in changes.values()):
        raise HTTPException(422, "Equipment fields cannot be null.")
    merged = {key: getattr(row, key) for key in ("name", "category", "description", "patch", "source_url")}
    merged.update(changes)
    try:
        validated = EquipmentIn.model_validate(merged)
    except ValueError as exc:
        raise HTTPException(422, "Invalid equipment fields.") from exc
    if duplicate(db, validated.name, item_id):
        raise HTTPException(409, "An equipment record with that name already exists.")
    for key, value in validated.model_dump().items():
        setattr(row, key, value)
    row.updated_at = utcnow()
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An equipment record with that name already exists.") from None
    db.refresh(row)
    return item_json(row)


@router.delete("/{item_id}", status_code=204)
def delete_item(item_id: int, _user: User = Depends(item_admin), db: Session = Depends(get_db)) -> None:
    row = db.get(TeamEquipment, item_id)
    if row is None:
        raise HTTPException(404, "Equipment record not found.")
    db.delete(row)
    db.commit()
