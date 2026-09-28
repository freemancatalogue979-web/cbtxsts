"""Examination endpoints: start, autosave answers, submit, review results."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_student
from ..events import dispatch, to_admins
from ..game import rank_suffix
from ..models import Attempt, Quiz, Student
from ..schemas import AnswerIn, ExamSyncIn, SubmitIn
from ..serializers import attempt_state, attempt_summary
from ..services import exam as exam_service
from ..services import exam_integrity as integrity
from ..services.exam import ExamError

router = APIRouter(prefix="/exams", tags=["exams"])


def _owned_attempt(db: Session, attempt_id: int, student: Student) -> Attempt:
    attempt = db.get(Attempt, attempt_id)
    if attempt is None or attempt.student_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attempt not found.")
    return attempt


DEVICE_CONFLICT = "This exam is open on another device. Continue here to move it to this device."
DEVICE_MOVED = "This exam was moved to another device, so this one is locked."


def _hold_device(db: Session, attempt: Attempt, device: str | None, *, takeover: bool = False, moved: bool = False) -> list:
    """Enforce one device per attempt; 423 when another device holds it.

    ``moved`` picks the message for saves from a device that lost the paper.
    Returns admin events to dispatch when a takeover happened.
    """
    try:
        switched = integrity.check_device(attempt, device, takeover=takeover)
    except integrity.DeviceConflict:
        raise HTTPException(status.HTTP_423_LOCKED, DEVICE_MOVED if moved else DEVICE_CONFLICT) from None
    if switched:
        db.commit()
        return [to_admins("exam_integrity", {"attempt_id": attempt.id, "quiz_id": attempt.quiz_id, "student_id": attempt.student_id, "summary": integrity.summary(attempt)})]
    return []


async def _expire_if_needed(db: Session, attempt: Attempt) -> list:
    """Server-side auto submission once the clock (plus the offline sync window) has run out."""
    if attempt.status == "in_progress" and exam_service.time_remaining(attempt) <= 0 and exam_service.past_sync_window(attempt):
        _, events = exam_service.finalize(db, attempt, "expired")
        db.commit()
        return events
    return []


@router.post("/{quiz_id}/start")
async def start_exam(
    quiz_id: int,
    takeover: bool = Query(False),
    device: str | None = Header(None, alias=integrity.DEVICE_HEADER),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    quiz = db.get(Quiz, quiz_id)
    if quiz is None or bool(getattr(quiz, "is_bank", False)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quiz not found.")
    try:
        attempt, events = exam_service.open_attempt(db, student, quiz)
        db.commit()
    except ExamError as error:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error

    if attempt.status == "submitted":
        await dispatch(events)
        rank = exam_service.rank_for(db, attempt)
        questions = exam_service.question_order(db, quiz, student, attempt)
        return attempt_state(db, attempt, questions=questions, reveal=True, rank=rank, time_remaining=0)

    switched = _hold_device(db, attempt, device, takeover=takeover)
    questions = exam_service.question_order(db, quiz, student, attempt)
    exam_service.ensure_question_times(attempt, questions)
    db.commit()
    if switched:
        await dispatch(switched)
    return attempt_state(
        db,
        attempt,
        questions=questions,
        reveal=False,
        time_remaining=exam_service.time_remaining(attempt),
    )


@router.get("/attempts/{attempt_id}")
async def read_attempt(
    attempt_id: int,
    takeover: bool = Query(False),
    device: str | None = Header(None, alias=integrity.DEVICE_HEADER),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    attempt = _owned_attempt(db, attempt_id, student)
    events = await _expire_if_needed(db, attempt)
    if events:
        await dispatch(events)
    switched = _hold_device(db, attempt, device, takeover=takeover)
    if switched:
        await dispatch(switched)
    questions = exam_service.question_order(db, attempt.quiz, student, attempt)
    if attempt.status == "in_progress":
        exam_service.ensure_question_times(attempt, questions)
        db.commit()
    submitted = attempt.status == "submitted"
    return attempt_state(
        db,
        attempt,
        questions=questions,
        reveal=submitted,
        rank=exam_service.rank_for(db, attempt) if submitted else None,
        time_remaining=exam_service.time_remaining(attempt),
    )


@router.post("/attempts/{attempt_id}/answer")
async def save_answer(
    attempt_id: int,
    payload: AnswerIn,
    device: str | None = Header(None, alias=integrity.DEVICE_HEADER),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    attempt = _owned_attempt(db, attempt_id, student)
    _hold_device(db, attempt, device, moved=True)
    expired = await _expire_if_needed(db, attempt)
    if expired:
        await dispatch(expired)
        raise HTTPException(status.HTTP_409_CONFLICT, "Time is up — your paper was submitted automatically.")
    try:
        _, events = exam_service.record_answer(
            db,
            attempt,
            question_id=payload.question_id,
            selected=payload.selected,
            seconds_spent=payload.seconds_spent,
            flagged=payload.flagged,
        )
        db.commit()
    except ExamError as error:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error

    await dispatch(events)
    return {
        "ok": True,
        "question_id": payload.question_id,
        "answered": len([a for a in attempt.answers if a.selected]),
        "total": exam_service.attempt_total(db, attempt),
        "time_remaining": exam_service.time_remaining(attempt),
    }


@router.post("/attempts/{attempt_id}/submit")
async def submit_exam(
    attempt_id: int,
    payload: SubmitIn,
    device: str | None = Header(None, alias=integrity.DEVICE_HEADER),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    attempt = _owned_attempt(db, attempt_id, student)
    if attempt.status != "submitted":
        _hold_device(db, attempt, device, moved=True)
    if attempt.status == "submitted":
        questions = exam_service.question_order(db, attempt.quiz, student, attempt)
        return attempt_state(db, attempt, questions=questions, reveal=True, rank=exam_service.rank_for(db, attempt))

    try:
        attempt, events = exam_service.finalize(db, attempt, payload.submission_type)
        db.commit()
    except ExamError as error:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error

    await dispatch(events)
    questions = exam_service.question_order(db, attempt.quiz, student, attempt)
    result = attempt_state(
        db,
        attempt,
        questions=questions,
        reveal=True,
        rank=exam_service.rank_for(db, attempt),
        time_remaining=0,
    )
    result["rewards"] = [event.data for event in events if event.event == "exam_result"][:1]
    result["leaderboard"] = exam_service.quiz_leaderboard(db, attempt.quiz_id)[:10]
    return result


@router.post("/attempts/{attempt_id}/sync")
async def sync_attempt(
    attempt_id: int,
    payload: ExamSyncIn,
    device: str | None = Header(None, alias=integrity.DEVICE_HEADER),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Deliver everything a phone queued — answers, integrity events and an
    optional submit — in one round trip. Built for weak and dropping networks:

    * each answer is applied independently; one refused answer (e.g. its
      per-question timer ran out) never sinks the rest of the batch;
    * answers queued offline still land up to ``EXAM_SYNC_GRACE_SECONDS`` after
      the deadline (the device itself stops accepting taps at 0:00);
    * replays are harmless: saving the same answer twice changes nothing, and a
      sync for an already-submitted paper just reports ``submitted``.
    """
    attempt = _owned_attempt(db, attempt_id, student)
    base = {"attempt_id": attempt.id, "accepted": [], "rejected": []}
    if attempt.status != "in_progress":
        return {**base, "ok": True, "status": attempt.status, "late": False, "time_remaining": 0}
    _hold_device(db, attempt, device, moved=True)

    if exam_service.past_sync_window(attempt):
        _, events = exam_service.finalize(db, attempt, "expired")
        db.commit()
        await dispatch(events)
        return {**base, "ok": True, "status": "submitted", "late": True, "time_remaining": 0,
                "rejected": [{"question_id": row.question_id, "reason": "late"} for row in payload.answers]}

    events: list = []
    accepted: list[int] = []
    rejected: list[dict] = []
    for row in payload.answers:
        try:
            # record_answer validates (closed, time, membership, per-question
            # clock) before it writes anything, so a refusal leaves no residue.
            _, answer_events = exam_service.record_answer(
                db,
                attempt,
                question_id=row.question_id,
                selected=row.selected,
                seconds_spent=row.seconds_spent,
                flagged=row.flagged,
                allow_sync_grace=True,
            )
            accepted.append(row.question_id)
            events = answer_events  # only the latest progress ping matters
        except ExamError as error:
            rejected.append({"question_id": row.question_id, "reason": str(error)})

    kept = integrity.record_client_events(attempt, [event.model_dump() for event in payload.events])
    if kept:
        events.append(to_admins("exam_integrity", {"attempt_id": attempt.id, "quiz_id": attempt.quiz_id, "student_id": attempt.student_id, "summary": integrity.summary(attempt)}))

    status_after = "in_progress"
    if payload.submit:
        try:
            _, finish_events = exam_service.finalize(db, attempt, payload.submit)
            events.extend(finish_events)
            status_after = "submitted"
        except ExamError as error:
            db.rollback()
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error
    db.commit()
    await dispatch(events)
    answered = len([a for a in attempt.answers if a.selected])
    return {
        **base,
        "ok": True,
        "status": status_after,
        "late": False,
        "accepted": accepted,
        "rejected": rejected,
        "answered": answered,
        "total": exam_service.attempt_total(db, attempt),
        "time_remaining": exam_service.time_remaining(attempt),
    }


@router.get("/attempts/{attempt_id}/review")
def review_attempt(attempt_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    attempt = _owned_attempt(db, attempt_id, student)
    if attempt.status != "submitted":
        raise HTTPException(status.HTTP_409_CONFLICT, "Submit the paper before reviewing answers.")
    questions = exam_service.question_order(db, attempt.quiz, student, attempt)
    result = attempt_state(db, attempt, questions=questions, reveal=True, rank=exam_service.rank_for(db, attempt))
    result["leaderboard"] = exam_service.quiz_leaderboard(db, attempt.quiz_id)
    return result


results_router = APIRouter(prefix="/results", tags=["results"])


@results_router.get("/me")
def my_results(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> list[dict]:
    attempts = db.scalars(
        select(Attempt)
        .where(Attempt.student_id == student.id, Attempt.status == "submitted")
        .order_by(Attempt.submitted_at.desc())
    ).all()
    payload = []
    for attempt in attempts:
        row = attempt_summary(attempt)
        rank = exam_service.rank_for(db, attempt)
        row["rank"] = rank
        row["rank_label"] = rank_suffix(rank)
        row["quiz"] = {
            "id": attempt.quiz.id,
            "title": attempt.quiz.title,
            "course": attempt.quiz.course.code if attempt.quiz.course else "",
            "course_title": attempt.quiz.course.title if attempt.quiz.course else "",
            "total_questions": exam_service.attempt_total(db, attempt),
        }
        payload.append(row)
    return payload
