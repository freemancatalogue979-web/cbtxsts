"""Training Center: weekly blocks + activities."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import can, get_current_user, get_db, require
from ..models import TrainingActivity, TrainingWeek, User, dumps
from ..schemas import ActivityIn, ActivityPatch, WeekIn, WeekPatch
from ..serializers import activity_out, avatar_url, week_out
from .notifications import notify

router = APIRouter(prefix="/training", tags=["training"])


def _attach_assigned(db: Session, rows):
    """Enrich activity dicts with assigned player refs (name/IGN/role/avatar)."""
    items = rows if isinstance(rows, list) else [rows]
    ids = {i for o in items for i in o.get("assigned_player_ids", [])}
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(ids)))} if ids else {}
    for o in items:
        o["assigned"] = [
            {"id": u.id, "ign": u.ign, "name": u.name, "main_role": u.main_role, "avatar": avatar_url(u.id)}
            for uid in o.get("assigned_player_ids", [])
            if (u := users.get(uid)) is not None
        ]
    return rows


def _remind_new_assignments(db: Session, actor, activity: TrainingActivity, prev_ids: list[int], new_ids: list[int]) -> None:
    added = [i for i in new_ids if i not in prev_ids]
    if not added:
        return
    when = f"{activity.activity_date.isoformat() if activity.activity_date else 'TBD'} {activity.start_time}".strip()
    notify(db, actor, added, "reminder",
           f"Assigned: {activity.title}",
           f"{when} · {activity.duration_min} min · {activity.category.replace('-', ' ').title()}.".strip(),
           "#/training")
    db.commit()


# ---------------------------------------------------------------------------
# Weekly blocks
# ---------------------------------------------------------------------------
@router.get("/weeks")
def list_weeks(db: Session = Depends(get_db), user=Depends(get_current_user)):
    weeks = db.scalars(select(TrainingWeek).order_by(TrainingWeek.number)).all()
    return [week_out(w) for w in weeks]


@router.get("/weeks/{week_id}")
def get_week(week_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    week = db.get(TrainingWeek, week_id)
    if week is None:
        raise HTTPException(status_code=404, detail="Week not found")
    return week_out(week, with_activities=True)


@router.post("/weeks", status_code=201)
def create_week(payload: WeekIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_training(user), "create training weeks")
    if db.scalar(select(TrainingWeek).where(TrainingWeek.number == payload.number)):
        raise HTTPException(status_code=409, detail=f"Week {payload.number} already exists")
    week = TrainingWeek(
        number=payload.number, focus=payload.focus.upper(), objective=payload.objective,
        performance_target=payload.performance_target, notes=payload.notes,
        start_date=payload.start_date, end_date=payload.end_date, status=payload.status,
        weakness_text=payload.weakness_text, weakness_drills_target=payload.weakness_drills_target,
    )
    db.add(week)
    db.commit()
    db.refresh(week)
    return week_out(week)


@router.patch("/weeks/{week_id}")
def update_week(week_id: int, payload: WeekPatch, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_training(user), "edit training weeks")
    week = db.get(TrainingWeek, week_id)
    if week is None:
        raise HTTPException(status_code=404, detail="Week not found")
    data = payload.model_dump(exclude_unset=True)
    if "focus" in data and data["focus"]:
        data["focus"] = data["focus"].upper()
    for key, value in data.items():
        setattr(week, key, value)
    db.commit()
    db.refresh(week)
    return week_out(week)


@router.delete("/weeks/{week_id}", status_code=204)
def delete_week(week_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_training(user), "delete training weeks")
    week = db.get(TrainingWeek, week_id)
    if week is None:
        raise HTTPException(status_code=404, detail="Week not found")
    db.query(TrainingActivity).filter(TrainingActivity.week_id == week_id).update({"week_id": None})
    db.delete(week)
    db.commit()
    return None


# ---------------------------------------------------------------------------
# Activities
# ---------------------------------------------------------------------------
@router.get("/activities")
def list_activities(
    week_id: int | None = Query(default=None),
    category: str | None = Query(default=None),
    status: str | None = Query(default=None),
    assigned_to: int | None = Query(default=None),
    upcoming_only: bool = Query(default=False),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    stmt = select(TrainingActivity).order_by(TrainingActivity.activity_date.desc().nullslast(),
                                             TrainingActivity.start_time.desc())
    if week_id is not None:
        stmt = stmt.where(TrainingActivity.week_id == week_id)
    if category:
        stmt = stmt.where(TrainingActivity.category == category.upper())
    if status:
        stmt = stmt.where(TrainingActivity.status == status)
    if upcoming_only:
        stmt = stmt.where(TrainingActivity.activity_date >= date.today(), TrainingActivity.status == "scheduled")
    activities = db.scalars(stmt.limit(400)).all()
    out = [activity_out(a) for a in activities]
    if assigned_to is not None:
        out = [a for a in out if assigned_to in a["assigned_player_ids"]]
    return _attach_assigned(db, out)


@router.post("/activities", status_code=201)
def create_activity(payload: ActivityIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_training(user), "create training activities")
    activity = TrainingActivity(
        week_id=payload.week_id, title=payload.title, description=payload.description,
        category=payload.category.upper(), activity_date=payload.date, start_time=payload.time,
        duration_min=payload.duration_min, coach_name=payload.coach_name,
        assigned_player_ids=dumps(payload.assigned_player_ids), required=payload.required,
        status=payload.status, notes=payload.notes, attachments=dumps(payload.attachments),
        result=payload.result, score=payload.score, lessons=payload.lessons, scrim_id=payload.scrim_id,
    )
    db.add(activity)
    db.commit()
    db.refresh(activity)
    _remind_new_assignments(db, user, activity, [], payload.assigned_player_ids or [])
    return _attach_assigned(db, activity_out(activity))


@router.get("/activities/{activity_id}")
def get_activity(activity_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    activity = db.get(TrainingActivity, activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    return _attach_assigned(db, activity_out(activity))


@router.patch("/activities/{activity_id}")
def update_activity(activity_id: int, payload: ActivityPatch, db: Session = Depends(get_db),
                    user=Depends(get_current_user)):
    activity = db.get(TrainingActivity, activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    data = payload.model_dump(exclude_unset=True)

    # Players may only file results/lessons on activities assigned to them
    # ("submit self-review / upload required information"); staff own the rest.
    if not can.manage_training(user):
        from ..models import loads

        allowed = {"status", "result", "lessons", "notes", "attachments", "score"}
        if set(data) - allowed or user.id not in loads(activity.assigned_player_ids):
            require(False, "edit this activity")
        if data.get("status") not in (None, "done", "in-progress"):
            require(False, "change activity status to that")

    if "category" in data and data["category"]:
        data["category"] = data["category"].upper()
    if "date" in data:
        data["activity_date"] = data.pop("date")
    if "time" in data:
        data["start_time"] = data.pop("time")
    from ..models import loads as _loads

    prev_ids = _loads(activity.assigned_player_ids)
    new_ids = data.get("assigned_player_ids")
    if "assigned_player_ids" in data and data["assigned_player_ids"] is not None:
        data["assigned_player_ids"] = dumps(data["assigned_player_ids"])
    if "attachments" in data and data["attachments"] is not None:
        data["attachments"] = dumps(data["attachments"])
    for key, value in data.items():
        setattr(activity, key, value)
    db.commit()
    db.refresh(activity)
    if new_ids is not None and can.manage_training(user):
        _remind_new_assignments(db, user, activity, prev_ids, new_ids)
    return _attach_assigned(db, activity_out(activity))


@router.delete("/activities/{activity_id}", status_code=204)
def delete_activity(activity_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_training(user), "delete training activities")
    activity = db.get(TrainingActivity, activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    db.delete(activity)
    db.commit()
    return None
