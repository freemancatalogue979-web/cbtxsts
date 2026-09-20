"""Arena shop — the marketplace, inventory and prestige currency.

Everything here is cosmetic. The router never accepts a price, a roll or a
balance from the client: it takes a *key* and the server decides what that costs,
whether the player may have it and what a chest contains.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_student
from ..events import dispatch, to_student
from ..models import Student
from ..serializers import student_profile
from ..services import shop

router = APIRouter(prefix="/shop", tags=["shop"])


class BuyIn(BaseModel):
    key: str


class EquipIn(BaseModel):
    key: str | None = None
    slot: str | None = None


class ChestIn(BaseModel):
    kind: str = "common"


def _paywall(error: shop.ShopError) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(error))


@router.get("")
def read_shop(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """The whole shop: catalogue, wallet, inventory, chests, deals and event."""
    return shop.shop_state(db, student)


@router.get("/item/{key}")
def read_item(key: str, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """The plaque for one item: rarity, release, owners, where it came from."""
    try:
        return shop.trophy_history(db, key, student)
    except shop.ShopError as error:
        raise _paywall(error) from error


@router.post("/buy")
async def buy(
    payload: BuyIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    try:
        receipt = shop.purchase(db, student, payload.key)
    except shop.ShopError as error:
        db.rollback()
        raise _paywall(error) from error
    db.commit()
    await dispatch([to_student(student.id, "shop_purchase", receipt)])
    return {"receipt": receipt, "profile": student_profile(db, student)}


@router.post("/equip")
async def equip(
    payload: EquipIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    try:
        slot = shop.set_equipped(db, student, payload.key, payload.slot)
    except shop.ShopError as error:
        db.rollback()
        raise _paywall(error) from error
    db.commit()
    await dispatch([to_student(student.id, "shop_equipped", {"slot": slot, "key": payload.key or ""})])
    return {"slot": slot, "equipped": shop.loadout_of(student), "profile": student_profile(db, student)}


@router.post("/chest")
async def open_chest(
    payload: ChestIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    try:
        reward = shop.open_chest(db, student, payload.kind)
    except shop.ShopError as error:
        db.rollback()
        raise _paywall(error) from error
    db.commit()
    await dispatch([to_student(student.id, "shop_chest", reward)])
    return {"reward": reward, "chests": shop.chest_counts(student), "profile": student_profile(db, student)}
