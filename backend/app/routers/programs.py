"""Training programs — the Training Center track system.

A program (what the team calls an *activity*: "EXP lane fundamentals",
"Team fight drills") is a container with its own week/task list.
Players are enrolled per program; progress is tracked per member per week,
independently per program.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import can, get_current_user, get_db, require
from ..models import ProgramWeek, TrainingProgram, User, WeekProgress, dumps, loads, utcnow
from ..serializers import ROLE_LABELS, avatar_url
from .notifications import notify

router = APIRouter(prefix="/programs", tags=["programs"])


# --------------------------------------------------------------------------- #
# Serializers
# --------------------------------------------------------------------------- #
def _user_refs(db: Session, ids: list[int]) -> list[dict]:
    if not ids:
        return []
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(ids)))}
    return [
        {"id": u.id, "ign": u.ign, "name": u.name, "main_role": u.main_role,
         "role": u.role, "role_label": ROLE_LABELS.get(u.role, u.role.title()),
         "avatar": avatar_url(u.id)}
        for i in ids if (u := users.get(i)) is not None
    ]


def _week_out(w: ProgramWeek) -> dict:
    return {
        "id": w.id,
        "number": w.number,
        "title": w.title,
        "description": w.description,
        "attachments": loads(w.attachments),
    }


def program_out(db: Session, p: TrainingProgram) -> dict:
    weeks = sorted(p.weeks, key=lambda w: w.number)
    enrolled = loads(p.enrolled_ids)
    done = 0
    total = len(weeks) * len(enrolled)
    for w in weeks:
        done += sum(1 for r in w.progress_rows if r.status == "done" and r.user_id in enrolled)
    return {
        "id": p.id,
        "name": p.name,
        "focus": p.focus,
        "description": p.description,
        "status": p.status,
        "enrolled_ids": enrolled,
        "enrolled": _user_refs(db, enrolled),
        "weeks": [_week_out(w) for w in weeks],
        "week_count": len(weeks),
        "completion": round(done * 100 / total) if total else 0,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


def program_detail(db: Session, p: TrainingProgram) -> dict:
    out = program_out(db, p)
    matrix: dict[str, dict[str, dict]] = {}
    for w in p.weeks:
        row: dict[str, dict] = {}
        by_user = {r.user_id: r for r in w.progress_rows}
        for uid in out["enrolled_ids"]:
            r = by_user.get(uid)
            row[str(uid)] = {
                "status": r.status if r else "pending",
                "completed_at": r.completed_at.isoformat() if r and r.completed_at else None,
                "notes": r.notes if r else "",
                "marked_by": r.marked_by if r else None,
            }
        matrix[str(w.id)] = row
    out["matrix"] = matrix
    return out


def _get(db: Session, program_id: int) -> TrainingProgram:
    p = db.get(TrainingProgram, program_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Program not found")
    return p


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class ProgramIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    focus: str = ""
    description: str = ""
    enrolled_ids: list[int] = []
    status: str = "active"


class ProgramPatch(BaseModel):
    name: str | None = None
    focus: str | None = None
    description: str | None = None
    enrolled_ids: list[int] | None = None
    status: str | None = None


class WeekIn(BaseModel):
    number: int | None = None
    title: str = Field(min_length=1, max_length=160)
    description: str = ""
    attachments: list[dict] = []


class WeekPatch(BaseModel):
    number: int | None = None
    title: str | None = None
    description: str | None = None
    attachments: list[dict] | None = None


class ProgressIn(BaseModel):
    user_id: int | None = None   # staff may set anyone; players set themselves
    status: str = Field(pattern="^(pending|done)$")
    notes: str = ""


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@router.get("")
def list_programs(db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = db.scalars(select(TrainingProgram).order_by(TrainingProgram.created_at.desc())).all()
    return [program_out(db, p) for p in rows]


@router.post("", status_code=201)
def create_program(payload: ProgramIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_training(user), "create programs")
    p = TrainingProgram(name=payload.name.strip(), focus=payload.focus.strip(),
                        description=payload.description, enrolled_ids=dumps(payload.enrolled_ids),
                        status="active", created_by=user.id)
    db.add(p)
    db.commit()
    db.refresh(p)
    notify(db, user, payload.enrolled_ids, "reminder",
           f"Enrolled: {p.name}",
           "You have been enrolled on a training program. Check Training Center for your week tasks.",
           f"#/training/programs/{p.id}")
    db.commit()
    return program_detail(db, p)


@router.get("/{program_id}")
def get_program(program_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    return program_detail(db, _get(db, program_id))


@router.patch("/{program_id}")
def update_program(program_id: int, payload: ProgramPatch, db: Session = Depends(get_db),
                   user=Depends(get_current_user)):
    require(can.manage_training(user), "update programs")
    p = _get(db, program_id)
    data = payload.model_dump(exclude_unset=True)
    prev = loads(p.enrolled_ids)
    new_ids = data.pop("enrolled_ids", None)
    if new_ids is not None:
        p.enrolled_ids = dumps(new_ids)
    if (st := data.pop("status", None)) is not None and st in {"active", "archived"}:
        p.status = st
    for k, v in data.items():
        setattr(p, k, v)
    db.commit()
    if new_ids is not None:
        added = [i for i in new_ids if i not in prev]
        notify(db, user, added, "reminder", f"Enrolled: {p.name}",
               "You have been enrolled on a training program. Check Training Center for your week tasks.",
               f"#/training/programs/{p.id}")
        db.commit()
    db.refresh(p)
    return program_detail(db, p)


@router.delete("/{program_id}", status_code=204)
def delete_program(program_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_training(user), "delete programs")
    db.delete(_get(db, program_id))
    db.commit()


# ------------------------------ weeks / tasks ------------------------------- #
@router.post("/{program_id}/weeks", status_code=201)
def add_week(program_id: int, payload: WeekIn, db: Session = Depends(get_db),
             user=Depends(get_current_user)):
    require(can.manage_training(user), "add weeks")
    p = _get(db, program_id)
    number = payload.number or (max((w.number for w in p.weeks), default=0) + 1)
    w = ProgramWeek(program_id=p.id, number=number, title=payload.title.strip(),
                    description=payload.description, attachments=dumps(payload.attachments))
    db.add(w)
    db.commit()
    notify(db, user, loads(p.enrolled_ids), "reminder",
           f"New task: {p.name} · Week {number}",
           f"{payload.title.strip()}. Open Training Center when you have done it.",
           f"#/training/programs/{p.id}")
    db.commit()
    db.refresh(w)
    return program_detail(db, p)


@router.patch("/weeks/{week_id}")
def update_week(week_id: int, payload: WeekPatch, db: Session = Depends(get_db),
                user=Depends(get_current_user)):
    require(can.manage_training(user), "edit weeks")
    w = db.get(ProgramWeek, week_id)
    if w is None:
        raise HTTPException(status_code=404, detail="Week not found")
    data = payload.model_dump(exclude_unset=True)
    if "attachments" in data and data["attachments"] is not None:
        data["attachments"] = dumps(data["attachments"])
    for k, v in data.items():
        setattr(w, k, v)
    db.commit()
    db.refresh(w)
    return program_detail(db, w.program)


@router.delete("/weeks/{week_id}", status_code=204)
def delete_week(week_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_training(user), "delete weeks")
    w = db.get(ProgramWeek, week_id)
    if w is None:
        raise HTTPException(status_code=404, detail="Week not found")
    db.delete(w)
    db.commit()


# --------------------------------- progress --------------------------------- #
@router.post("/weeks/{week_id}/progress")
def set_progress(week_id: int, payload: ProgressIn, db: Session = Depends(get_db),
                 user=Depends(get_current_user)):
    w = db.get(ProgramWeek, week_id)
    if w is None:
        raise HTTPException(status_code=404, detail="Week not found")
    target_id = payload.user_id or user.id
    if target_id != user.id:
        require(can.manage_training(user), "mark progress for other players")
    if target_id not in loads(w.program.enrolled_ids):
        raise HTTPException(status_code=422, detail="Player is not enrolled in this program")
    row = db.scalar(select(WeekProgress).where(
        WeekProgress.week_id == week_id, WeekProgress.user_id == target_id))
    if row is None:
        row = WeekProgress(week_id=week_id, user_id=target_id)
        db.add(row)
    row.status = payload.status
    row.notes = payload.notes
    row.marked_by = user.id
    row.completed_at = utcnow() if payload.status == "done" else None
    db.commit()
    db.refresh(w)
    return program_detail(db, w.program)
