"""Tactical map boards — Land of Dawn drawing + hero tokens."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db
from ..models import MapBoard, dumps, loads
from ..schemas import MapBoardIn, MapBoardPatch
from ..serializers import board_out

router = APIRouter(prefix="/maps", tags=["maps"])


@router.get("")
@router.get("/")
def list_boards(kind: str | None = None, db: Session = Depends(get_db), user=Depends(get_current_user)):
    stmt = select(MapBoard).order_by(MapBoard.updated_at.desc())
    if kind:
        stmt = stmt.where(MapBoard.kind == kind)
    boards = db.scalars(stmt).all()
    out = []
    for b in boards:
        d = board_out(b)
        d["token_count"] = len(loads(b.data).get("tokens", []))
        out.append(d)
    return out


@router.post("", status_code=201)
@router.post("/", status_code=201)
def create_board(payload: MapBoardIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    b = MapBoard(
        name=payload.name.strip(), kind=payload.kind or "strategy",
        opponent=payload.opponent or "", draft_id=payload.draft_id,
        data=dumps(payload.data or {"tokens": [], "paths": [], "text": []}),
        notes=payload.notes or "", author_id=user.id,
    )
    db.add(b)
    db.commit()
    db.refresh(b)
    return board_out(b)


@router.get("/{board_id}")
def get_board(board_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    b = db.get(MapBoard, board_id)
    if b is None:
        raise HTTPException(status_code=404, detail="Board not found")
    return board_out(b)


@router.patch("/{board_id}")
def update_board(board_id: int, payload: MapBoardPatch, db: Session = Depends(get_db), user=Depends(get_current_user)):
    b = db.get(MapBoard, board_id)
    if b is None:
        raise HTTPException(status_code=404, detail="Board not found")
    fields = payload.model_dump(exclude_unset=True)
    for k, v in fields.items():
        if k == "data" and v is not None:
            b.data = dumps(v)
        else:
            setattr(b, k, v)
    db.commit()
    db.refresh(b)
    return board_out(b)


@router.delete("/{board_id}", status_code=204)
def delete_board(board_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    b = db.get(MapBoard, board_id)
    if b is None:
        raise HTTPException(status_code=404, detail="Board not found")
    db.delete(b)
    db.commit()
