"""Event / tournament manager + training calendar feed."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import can, get_current_user, get_db, require
from ..models import Event, Scrim, TrainingActivity
from ..schemas import EventIn, EventPatch
from ..serializers import event_out

router = APIRouter(prefix="/events", tags=["events"])


@router.get("")
@router.get("/")
def list_events(
    kind: str | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    stmt = select(Event).order_by(Event.event_date, Event.start_time)
    if kind:
        stmt = stmt.where(Event.kind == kind)
    if date_from:
        stmt = stmt.where(Event.event_date >= date_from)
    if date_to:
        stmt = stmt.where(Event.event_date <= date_to)
    return [event_out(e) for e in db.scalars(stmt.limit(400)).all()]


@router.get("/calendar")
def calendar(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Unified feed: events + scheduled scrims + training activities."""
    items = []
    for e in db.scalars(select(Event)).all():
        items.append({**event_out(e), "source": "event"})
    for s in db.scalars(select(Scrim).where(Scrim.status == "scheduled")).all():
        items.append({
            "id": f"scrim-{s.id}", "scrim_id": s.id,
            "title": f"Scrim #{s.number} vs {s.opponent} ({s.format})",
            "kind": "scrim", "source": "scrim",
            "date": s.scrim_date.isoformat() if s.scrim_date else None,
            "time": s.start_time, "end_time": "", "location": s.server,
            "description": s.notes, "link": "",
        })
    for a in db.scalars(select(TrainingActivity).where(TrainingActivity.status == "scheduled")).all():
        items.append({
            "id": f"activity-{a.id}", "activity_id": a.id,
            "title": a.title, "kind": "training", "source": "activity",
            "category": a.category,
            "date": a.activity_date.isoformat() if a.activity_date else None,
            "time": a.start_time, "end_time": "", "location": "",
            "description": a.description, "link": "",
        })
    items.sort(key=lambda i: (i["date"] or "9999", i["time"] or "99"))
    return items


@router.post("", status_code=201)
@router.post("/", status_code=201)
def create_event(payload: EventIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_events(user), "create events")
    event = Event(
        title=payload.title, kind=payload.kind, event_date=payload.date, start_time=payload.time,
        end_time=payload.end_time, location=payload.location, description=payload.description,
        link=payload.link, scrim_id=payload.scrim_id, created_by=user.id,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event_out(event)


@router.patch("/{event_id}")
def update_event(event_id: int, payload: EventPatch, db: Session = Depends(get_db),
                 user=Depends(get_current_user)):
    require(can.manage_events(user), "edit events")
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    data = payload.model_dump(exclude_unset=True)
    if "date" in data:
        data["event_date"] = data.pop("date")
    if "time" in data:
        data["start_time"] = data.pop("time")
    for key, value in data.items():
        setattr(event, key, value)
    db.commit()
    db.refresh(event)
    return event_out(event)


@router.delete("/{event_id}", status_code=204)
def delete_event(event_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_events(user), "delete events")
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    db.delete(event)
    db.commit()
    return None
