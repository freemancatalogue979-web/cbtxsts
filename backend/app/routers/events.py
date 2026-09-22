"""Arena event endpoints: list, lobby, join/leave/resume, answers, leaderboard."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_student
from ..models import ArenaEvent, Student
from ..schemas import EventAnswerIn
from ..services import events as event_service
from ..services.events import EventError
from ..ws import hub

router = APIRouter(prefix="/events", tags=["events"])


def _event_or_404(db: Session, event_id: int) -> ArenaEvent:
    event = db.get(ArenaEvent, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found.")
    return event


def _connected_ids(event_id: int) -> set[int]:
    return hub.student_ids_in_room(f"event:{event_id}")


@router.get("")
def list_events(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    return event_service.events_list(db, student)


@router.get("/{event_id}")
def event_detail(
    event_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    event = _event_or_404(db, event_id)
    payload = event_service.event_public(db, event, student.id)
    participant = event_service.participant_for(db, event.id, student.id)
    return {
        "event": payload,
        "question": event_service.current_question(db, event, participant) if participant and event.status == "live" else None,
        "leaderboard": (
            event_service.leaderboard_payload(db, event, student.id, _connected_ids(event.id))
            if event.leaderboard_visible
            else None
        ),
    }


@router.post("/{event_id}/join")
def join(
    event_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    event = _event_or_404(db, event_id)
    try:
        participant = event_service.join_event(db, event, student)
    except EventError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    db.commit()
    return {
        "event": event_service.event_public(db, event, student.id),
        "question": event_service.current_question(db, event, participant) if event.status == "live" else None,
    }


@router.post("/{event_id}/leave")
def leave(
    event_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    event = _event_or_404(db, event_id)
    try:
        left = event_service.leave_event(db, event, student)
    except EventError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    db.commit()
    return {"left": left, "event": event_service.event_public(db, event, student.id)}


@router.post("/{event_id}/answer")
async def answer(
    event_id: int,
    payload: EventAnswerIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    event = _event_or_404(db, event_id)
    participant = event_service.participant_for(db, event.id, student.id)
    if participant is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Join the event first.")
    try:
        result = event_service.submit_answer(db, event, participant, payload.selected, payload.elapsed_ms)
    except EventError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    db.commit()
    room = f"event:{event.id}"
    # Leaderboard deltas go out on a cooldown, not per answer — big events
    # must not broadcast every single click to every single player.
    activity = event_service.activity_payload(db, event)
    if activity:
        await hub.broadcast("event_activity", {"items": activity}, room=room)
    if event.leaderboard_visible:
        await hub.broadcast(
            "event_leaderboard",
            event_service.leaderboard_payload(db, event, None, _connected_ids(event.id)),
            room=room,
        )
    return {
        "result": result,
        "leaderboard": (
            event_service.leaderboard_payload(db, event, student.id, _connected_ids(event.id))
            if event.leaderboard_visible
            else None
        ),
    }


@router.get("/history/me")
def event_history(
    limit: int = 10,
    offset: int = 0,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """My finished events, paginated — place, score, accuracy, rewards, date."""
    from datetime import timedelta, timezone

    from ..models import ArenaEvent, EventParticipant
    from ..services.events import event_public

    limit = max(1, min(int(limit or 10), 50))
    offset = max(0, int(offset or 0))
    rows = list(
        db.scalars(
            select(EventParticipant)
            .join(ArenaEvent, ArenaEvent.id == EventParticipant.event_id)
            .where(
                EventParticipant.student_id == student.id,
                ArenaEvent.status.in_(["finished", "cancelled"]),
            )
            .order_by(ArenaEvent.starts_at.desc())
            .limit(limit + 1)
            .offset(offset)
        ).all()
    )
    items = []
    for part in rows[:limit]:
        event = db.get(ArenaEvent, part.event_id)
        answered = int(part.answered or 0)
        items.append(
            {
                "event": event_public(db, event, student.id),
                "position": part.position,
                "score": part.score,
                "correct": part.correct_count,
                "wrong": part.wrong_count,
                "answered": answered,
                "accuracy": round(part.correct_count / answered * 100, 1) if answered else 0.0,
                "finished": bool(part.finished),
                "rewards": part.rewards or {},
                "finished_at": part.finished_at.isoformat() + "Z" if part.finished_at else None,
            }
        )
    return {
        "items": items,
        "total": int(db.scalar(
            select(func.count(EventParticipant.id))
            .join(ArenaEvent, ArenaEvent.id == EventParticipant.event_id)
            .where(
                EventParticipant.student_id == student.id,
                ArenaEvent.status.in_(["finished", "cancelled"]),
            )
        ) or 0),
        "limit": limit,
        "offset": offset,
        "has_more": len(rows) > limit,
    }


@router.get("/{event_id}/review")
def review(
    event_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    event = _event_or_404(db, event_id)
    if event_service.participant_for(db, event.id, student.id) is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You did not take part in this event.")
    if event.status != "finished":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This event has not finished yet.")
    return event_service.review_payload(db, event, student.id)
