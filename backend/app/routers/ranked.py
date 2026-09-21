"""Ranked multiplayer endpoints: queue, live matches, ratings, ladder."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_student
from ..events import dispatch
from ..models import RankedMatch, RankedParticipant, RankedQueue, Student, utcnow
from ..schemas import RankedAnswerIn, RankedQueueIn
from ..services import ranked as ranked_service
from ..services.ranked import RankedError, _iso
from ..ws import hub

router = APIRouter(prefix="/ranked", tags=["ranked"])


def _connected_ids(match_id: int) -> set[int]:
    return hub.student_ids_in_room(f"ranked:{match_id}")


def _participant_or_403(db: Session, match: RankedMatch, student: Student) -> RankedParticipant:
    participant = db.scalar(
        select(RankedParticipant).where(
            RankedParticipant.match_id == match.id, RankedParticipant.student_id == student.id
        )
    )
    if participant is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not in this match.")
    return participant


@router.get("/meta")
def meta() -> dict:
    return {
        "tiers": ranked_service.tiers_payload(),
        "match_size": ranked_service.MATCH_SIZE,
        "min_players": ranked_service.MIN_PLAYERS,
        "question_count": ranked_service.QUESTION_COUNT,
        "question_seconds": ranked_service.QUESTION_SECONDS,
        "base_points": ranked_service.BASE_POINTS,
        "speed_bonus": ranked_service.SPEED_BONUS,
        "streak_bonus": ranked_service.STREAK_BONUS,
        "queue_ladder": ranked_service.queue_ladder_payload(),
        "tier_rules": ranked_service.tier_rules_payload(),
    }


@router.get("/status")
def my_status(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    queue_row = db.scalar(select(RankedQueue).where(RankedQueue.student_id == student.id))
    active = ranked_service.active_match_for(db, student.id)
    course_id = queue_row.course_id if queue_row else None
    tier = ranked_service.tier_for(student.ranked_rating)
    if queue_row:
        # The ladder runs off the OLDEST waiter in the course, not the viewer.
        oldest = db.scalar(select(func.min(RankedQueue.joined_at)).where(RankedQueue.course_id == course_id))
        waited = (utcnow() - (oldest or queue_row.joined_at)).total_seconds()
    else:
        waited = 0.0
    return {
        "rating": student.ranked_rating,
        "tier": tier["key"],
        "tier_name": tier["name"],
        "played": student.ranked_played,
        "won": student.ranked_won,
        "in_queue": queue_row is not None,
        "queue_course_id": course_id,
        "waiting": ranked_service.waiting_count(db, course_id) if queue_row is not None else 0,
        "players_needed": ranked_service.players_needed(waited) if queue_row is not None else None,
        "queue_joined_at": _iso(queue_row.joined_at) if queue_row else None,
        # Everyone standing in this course's queue right now, so you can see
        # opponents arrive (name, face and rank) instead of just a counter.
        "queue_players": ranked_service.queue_players_payload(db, course_id) if queue_row is not None else [],
        "server_now": _iso(utcnow()),
        "match_id": active.id if active else None,
        "match": ranked_service.match_state(db, active, student.id, _connected_ids(active.id)) if active else None,
    }


@router.post("/queue")
async def join_queue(
    payload: RankedQueueIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    try:
        result = ranked_service.join_queue(db, student, payload.course_id)
    except RankedError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    db.commit()
    return result


@router.post("/queue/cancel")
def cancel_queue(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    cancelled = ranked_service.leave_queue(db, student)
    db.commit()
    return {"cancelled": cancelled}


@router.get("/match/{match_id}")
def match_detail(
    match_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    match = db.get(RankedMatch, match_id)
    if match is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Match not found.")
    _participant_or_403(db, match, student)
    return {"match": ranked_service.match_state(db, match, student.id, _connected_ids(match.id))}


@router.post("/match/{match_id}/answer")
async def answer_question(
    match_id: int,
    payload: RankedAnswerIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    match = db.get(RankedMatch, match_id)
    if match is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Match not found.")
    _participant_or_403(db, match, student)
    try:
        result, all_answered = ranked_service.submit_answer(db, match, student, payload.selected, payload.elapsed_ms)
        reveal_events, reveal = (
            ranked_service.close_if_all_answered(db, match, student) if all_answered else ([], None)
        )
        state = ranked_service.match_state(db, match, student.id, _connected_ids(match.id))
    except RankedError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    db.commit()
    room = f"ranked:{match.id}"
    await hub.broadcast(
        "ranked_answered",
        {
            "student_id": student.id,
            "locked": True,
            "standings": ranked_service.standings_payload(db, match, _connected_ids(match.id)),
            "server_now": _iso(utcnow()),
        },
        room=room,
    )
    if reveal_events:
        # Per-player reveals: everyone gets their OWN question's key, nobody
        # gets a rival's.
        await dispatch(reveal_events)
    return {"result": result, "all_answered": all_answered, "reveal": reveal, "match": state}


@router.post("/match/{match_id}/skip")
async def skip_question(
    match_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    match = db.get(RankedMatch, match_id)
    if match is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Match not found.")
    _participant_or_403(db, match, student)
    try:
        result, all_answered = ranked_service.skip_question(db, match, student)
        reveal_events, reveal = (
            ranked_service.close_if_all_answered(db, match, student) if all_answered else ([], None)
        )
        state = ranked_service.match_state(db, match, student.id, _connected_ids(match.id))
    except RankedError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    db.commit()
    room = f"ranked:{match.id}"
    await hub.broadcast(
        "ranked_answered",
        {
            "student_id": student.id,
            "locked": True,
            "skipped": True,
            "standings": ranked_service.standings_payload(db, match, _connected_ids(match.id)),
            "server_now": _iso(utcnow()),
        },
        room=room,
    )
    if reveal_events:
        # Per-player reveals: everyone gets their OWN question's key, nobody
        # gets a rival's — skipping closes the round exactly like answering.
        await dispatch(reveal_events)
    return {"result": result, "all_answered": all_answered, "reveal": reveal, "match": state}


@router.get("/match/{match_id}/review")
def match_review(
    match_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    match = db.get(RankedMatch, match_id)
    if match is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Match not found.")
    _participant_or_403(db, match, student)
    if match.status != "finished":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The match is still running.")
    return ranked_service.review_payload(db, match, student.id)


@router.get("/history")
def history(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    return {"history": ranked_service.history_payload(db, student)}


@router.get("/leaderboard")
def leaderboard(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    return ranked_service.leaderboard_payload(db, student)
