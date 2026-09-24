"""Examination endpoints: start, autosave answers, submit, review results."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_student
from ..events import dispatch
from ..game import rank_suffix
from ..models import Attempt, Quiz, Student
from ..schemas import AnswerIn, SubmitIn
from ..serializers import attempt_state, attempt_summary
from ..services import exam as exam_service
from ..services.exam import ExamError

router = APIRouter(prefix="/exams", tags=["exams"])


def _owned_attempt(db: Session, attempt_id: int, student: Student) -> Attempt:
    attempt = db.get(Attempt, attempt_id)
    if attempt is None or attempt.student_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attempt not found.")
    return attempt


async def _expire_if_needed(db: Session, attempt: Attempt) -> list:
    """Server-side auto submission when the clock has run out."""
    if attempt.status == "in_progress" and exam_service.time_remaining(attempt) <= 0:
        _, events = exam_service.finalize(db, attempt, "expired")
        db.commit()
        return events
    return []


@router.post("/{quiz_id}/start")
async def start_exam(quiz_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
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
        questions = exam_service.question_order(db, quiz, student)
        return attempt_state(db, attempt, questions=questions, reveal=True, rank=rank, time_remaining=0)

    questions = exam_service.question_order(db, quiz, student)
    exam_service.ensure_question_times(attempt, questions)
    db.commit()
    return attempt_state(
        db,
        attempt,
        questions=questions,
        reveal=False,
        time_remaining=exam_service.time_remaining(attempt),
    )


@router.get("/attempts/{attempt_id}")
async def read_attempt(attempt_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    attempt = _owned_attempt(db, attempt_id, student)
    events = await _expire_if_needed(db, attempt)
    if events:
        await dispatch(events)
    questions = exam_service.question_order(db, attempt.quiz, student)
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
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    attempt = _owned_attempt(db, attempt_id, student)
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
        "total": len(attempt.quiz.questions),
        "time_remaining": exam_service.time_remaining(attempt),
    }


@router.post("/attempts/{attempt_id}/submit")
async def submit_exam(
    attempt_id: int,
    payload: SubmitIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    attempt = _owned_attempt(db, attempt_id, student)
    if attempt.status == "submitted":
        questions = exam_service.question_order(db, attempt.quiz, student)
        return attempt_state(db, attempt, questions=questions, reveal=True, rank=exam_service.rank_for(db, attempt))

    try:
        attempt, events = exam_service.finalize(db, attempt, payload.submission_type)
        db.commit()
    except ExamError as error:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error

    await dispatch(events)
    questions = exam_service.question_order(db, attempt.quiz, student)
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


@router.get("/attempts/{attempt_id}/review")
def review_attempt(attempt_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    attempt = _owned_attempt(db, attempt_id, student)
    if attempt.status != "submitted":
        raise HTTPException(status.HTTP_409_CONFLICT, "Submit the paper before reviewing answers.")
    questions = exam_service.question_order(db, attempt.quiz, student)
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
            "total_questions": len(attempt.quiz.questions),
        }
        payload.append(row)
    return payload
