"""Server-authoritative examination engine.

The browser never grades anything and never sees the answer key until an attempt
is submitted. Deadlines live on the server, so a paused laptop clock cannot buy
extra time. Services stay synchronous and return :class:`Event` lists; routers
commit and dispatch.

Answer integrity rules enforced here:

* grading always compares against :attr:`Question.correct`, never a letter the
  client sent;
* option shuffling only changes the *display* order — the submitted display
  letter is translated back to the canonical key before comparison;
* question statistics are updated for every graded answer.
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import game
from ..config import EXAM_GRACE_SECONDS
from ..events import Event, to_admins, to_everyone, to_student
from ..models import Answer, Attempt, Config, Question, Quiz, Student, utcnow
from .questions import (
    answer_matches,
    display_order,
    label_to_key,
    mastery_scope_update,
    register_question_attempt,
)
from .study_lab import record_mistake, resolve_mistake


class ExamError(Exception):
    """Raised for user-facing exam failures."""


def _grading_scale(db: Session) -> list[dict]:
    config = db.get(Config, 1)
    return (config.grading_scale if config and config.grading_scale else None) or game.DEFAULT_GRADING_SCALE


def question_order(db: Session, quiz: Quiz, student: Student, attempt: Attempt | None = None) -> list[Question]:
    """Shuffled per student, but stable across refreshes (seeded by quiz+student).

    Questions hidden by staff (``visible=False``) are skipped for fresh papers,
    but never yanked out from under an attempt that already answered them.
    """
    questions = list(
        db.scalars(
            select(Question).where(Question.quiz_id == quiz.id).order_by(Question.position, Question.id)
        ).all()
    )
    if attempt is not None:
        answered = {row.question_id for row in attempt.answers}
        questions = [row for row in questions if row.visible or row.id in answered]
    if quiz.shuffle_questions and questions:
        random.Random(f"{quiz.id}:{student.id}").shuffle(questions)
    return questions


def ensure_option_orders(db: Session, quiz: Quiz, questions: list[Question], attempt: Attempt) -> dict:
    """Build (once) the per-question display order for option shuffling."""
    if not quiz.shuffle_options:
        attempt.option_orders = {}
        return {}
    orders: dict[str, list[str]] = {str(key): list(value) for key, value in (attempt.option_orders or {}).items()}
    changed = False
    for question in questions:
        key = str(question.id)
        order = orders.get(key)
        if not order or sorted(order) != sorted([k for k in ("A", "B", "C", "D") if question.options.get(k)]):
            orders[key] = display_order(question, shuffle=True, seed=f"{attempt.id}:{attempt.student_id}")
            changed = True
    if changed:
        attempt.option_orders = orders
        db.flush()
    return orders


def order_for(attempt: Attempt, question: Question) -> list[str]:
    key = str(question.id)
    stored = (attempt.option_orders or {}).get(key)
    if stored:
        return list(stored)
    return [k for k in ("A", "B", "C", "D") if (question.options.get(k) or "").strip()]


def time_remaining(attempt: Attempt) -> int:
    if attempt.status != "in_progress":
        return 0
    return max(0, int((attempt.deadline_at - utcnow()).total_seconds()))


def grace_seconds(attempt: Attempt) -> int:
    quiz = attempt.quiz
    return int(getattr(quiz, "grace_seconds", 0) or 0) or EXAM_GRACE_SECONDS


def per_question_seconds(attempt: Attempt) -> int:
    """Per-question budget; 0 means the paper runs on one global clock."""
    return max(0, int(getattr(attempt.quiz, "per_question_seconds", 0) or 0))


def ensure_question_times(attempt: Attempt, questions: list[Question]) -> dict:
    """Stamp first-view time for every question the player has been shown.

    The per-question countdown is drawn from this server-side stamp, so
    refreshing the browser cannot buy extra time on a question.
    """
    if per_question_seconds(attempt) <= 0:
        return {}
    times: dict[str, str] = {}
    for key, value in (attempt.question_times or {}).items():
        if value:
            times[str(key)] = str(value)
    changed = False
    now = utcnow().isoformat()
    for question in questions:
        key = str(question.id)
        if key not in times:
            times[key] = now
            changed = True
    if changed:
        attempt.question_times = times
        db = Session.object_session(attempt)
        if db is not None:
            db.flush()
    return times


def question_seconds_left(attempt: Attempt, question: Question) -> int | None:
    """Seconds left on one question, or ``None`` when there is no per-question clock."""
    budget = per_question_seconds(attempt)
    if budget <= 0:
        return None
    stamp = (attempt.question_times or {}).get(str(question.id))
    if not stamp:
        return budget
    try:
        started = datetime.fromisoformat(str(stamp))
    except ValueError:
        return budget
    elapsed = (utcnow() - started).total_seconds()
    return int(max(0, budget - elapsed))


def finalize(db: Session, attempt: Attempt, submission_type: str) -> tuple[Attempt, list[Event]]:
    """Grade, rank, reward. Does not commit — the caller does."""
    if attempt.status == "submitted":
        return attempt, []

    questions = [row for row in attempt.quiz.questions if row.visible or row.id in {a.question_id for a in attempt.answers}]
    if not questions:
        questions = list(attempt.quiz.questions)
    total = len(questions)
    answers = {row.question_id: row for row in attempt.answers}

    correct = 0
    answered = 0
    for question in questions:
        row = answers.get(question.id)
        if row is None:
            continue
        # Authoritative grading: stored key vs stored key. The frontend only
        # ever displays; it can never decide correctness.
        row.is_correct = answer_matches(question.correct, row.selected)
        if row.selected:
            answered += 1
        if row.is_correct:
            correct += 1
    wrong = answered - correct
    percentage = round((correct / total * 100) if total else 0.0, 2)
    grade_row = game.calculate_grade(percentage, _grading_scale(db))

    attempt.correct_count = correct
    attempt.wrong_count = wrong
    attempt.unanswered_count = max(0, total - answered)
    attempt.score = correct
    attempt.percentage = percentage
    attempt.grade = grade_row["grade"]
    attempt.status = "submitted"
    attempt.submission_type = submission_type
    attempt.submitted_at = utcnow()
    attempt.time_remaining_seconds = 0
    db.flush()

    rank = rank_for(db, attempt)
    student = attempt.student
    xp, coins = game.exam_rewards(percentage, correct, total, rank)

    student.exams_taken += 1
    student.correct_answers += correct
    student.questions_answered += total
    student.best_percentage = max(student.best_percentage, percentage)
    best_run = 0
    current_run = 0
    for question in questions:
        row = answers.get(question.id)
        if row is not None and row.is_correct:
            current_run += 1
            best_run = max(best_run, current_run)
        else:
            current_run = 0
    student.best_run = max(student.best_run, best_run)
    if rank == 1:
        student.exams_won += 1

    # Mastery bands: topic + difficulty + course.
    for question in questions:
        row = answers.get(question.id)
        if row is None or not row.selected:
            continue
        hit = bool(row.is_correct)
        mastery_scope_update(db, student.id, scope_type="difficulty", scope_key=question.difficulty, correct=hit)
        if question.topic:
            mastery_scope_update(db, student.id, scope_type="topic", scope_key=question.topic, correct=hit)
        if question.subtopic:
            mastery_scope_update(db, student.id, scope_type="subtopic", scope_key=question.subtopic, correct=hit)
    if attempt.quiz.course is not None:
        mastery_scope_update(
            db,
            student.id,
            scope_type="course",
            scope_key=attempt.quiz.course.code,
            correct=correct >= total / 2 if total else False,
        )

    events: list[Event] = []
    rewards = game.grant(
        db,
        student,
        xp=xp,
        coins=coins,
        kind="exam",
        title=f"Exam submitted — {attempt.quiz.title}",
        detail=f"{correct}/{total} correct • {percentage}% • rank {rank}",
    )
    attempt.xp_awarded = xp
    attempt.coins_awarded = coins

    events.append(
        to_student(
            student.id,
            "exam_result",
            {
                "attempt_id": attempt.id,
                "quiz_id": attempt.quiz_id,
                "score": correct,
                "total": total,
                "percentage": percentage,
                "grade": attempt.grade,
                "passed": percentage >= float(getattr(attempt.quiz, "pass_score", 50) or 0),
                "pass_score": int(getattr(attempt.quiz, "pass_score", 50) or 0),
                "rank": rank,
                "rank_label": game.rank_suffix(rank),
                "xp": xp,
                "coins": coins,
                "rewards": rewards,
            },
        )
    )
    events.append(to_everyone("leaderboard", {"scope": "global", "rows": top_leaderboard(db, limit=10)}))
    events.append(
        to_admins(
            "exam_submitted",
            {
                "attempt_id": attempt.id,
                "quiz_id": attempt.quiz_id,
                "student_id": student.id,
                "student_name": student.name,
                "score": correct,
                "total": total,
                "percentage": percentage,
                "rank": rank,
            },
        )
    )
    return attempt, events


def open_attempt(db: Session, student: Student, quiz: Quiz) -> tuple[Attempt, list[Event]]:
    """Resume an in-progress attempt or start a fresh one."""
    if student.is_banned:
        raise ExamError("This account is not allowed to sit examinations.")
    if quiz.status != "active":
        raise ExamError(f"This examination is not open (status: {quiz.status}).")
    if not quiz.questions:
        raise ExamError("This examination has no questions yet.")

    existing = db.scalar(select(Attempt).where(Attempt.quiz_id == quiz.id, Attempt.student_id == student.id))
    now = utcnow()

    max_attempts = int(getattr(quiz, "max_attempts", 0) or 0)
    if existing is None and max_attempts:
        # 0 means unlimited; any other value caps how many times a student may sit.
        finished = int(
            db.scalar(
                select(func.count(Attempt.id)).where(
                    Attempt.quiz_id == quiz.id,
                    Attempt.student_id == student.id,
                    Attempt.status == "submitted",
                )
            )
            or 0
        )
        if finished >= max_attempts:
            raise ExamError("You have used every allowed attempt for this examination.")

    if quiz.end_at is not None and now > quiz.end_at and existing is None:
        raise ExamError("This examination's clock has finished — you can only view results now.")

    if existing and existing.status == "submitted":
        raise ExamError("You have already submitted this examination.")

    if existing and existing.status == "in_progress":
        if existing.deadline_at + timedelta(seconds=grace_seconds(existing)) < now:
            return finalize(db, existing, "expired")
        return existing, []

    duration = max(1, quiz.duration_minutes) * 60
    attempt = Attempt(
        quiz_id=quiz.id,
        student_id=student.id,
        status="in_progress",
        started_at=now,
        deadline_at=now + timedelta(seconds=duration),
        time_remaining_seconds=duration,
        flagged=[],
        option_orders={},
        shuffle_options=bool(getattr(quiz, "shuffle_options", False)),
    )
    db.add(attempt)
    db.flush()
    questions = question_order(db, quiz, student, attempt)
    ensure_option_orders(db, quiz, questions, attempt)
    ensure_question_times(attempt, questions)
    return attempt, []


def record_answer(
    db: Session,
    attempt: Attempt,
    *,
    question_id: int,
    selected: str | None,
    seconds_spent: float = 0.0,
    flagged: bool | None = None,
) -> tuple[Answer, list[Event]]:
    if attempt.status != "in_progress":
        raise ExamError("This examination is already closed.")
    if time_remaining(attempt) <= 0:
        raise ExamError("Time is up — submit your paper to see the result.")

    question = db.get(Question, question_id)
    if not question or question.quiz_id != attempt.quiz_id:
        raise ExamError("That question is not part of this examination.")

    # Per-question clock: refuse answers sent after this question's budget plus
    # the paper's grace. Autosave retries inside the grace still land.
    left = question_seconds_left(attempt, question)
    if left is not None and left <= 0:
        grace = int(getattr(attempt.quiz, "grace_seconds", 0) or 0)
        if grace <= 0 or left < -grace:
            raise ExamError("Time for this question has run out — move to the next one.")

    # Translate the display letter the player tapped into the canonical option
    # key. After option shuffling these differ — comparing the raw letter would
    # silently mark the right answer wrong.
    order = order_for(attempt, question)
    canonical = label_to_key(question, order, selected)

    row = db.scalar(select(Answer).where(Answer.attempt_id == attempt.id, Answer.question_id == question_id))
    is_new = row is None
    if row is None:
        row = Answer(attempt_id=attempt.id, question_id=question_id)
        db.add(row)

    previous = row.selected
    row.selected = canonical
    row.is_correct = answer_matches(question.correct, canonical)
    row.seconds_spent = max(float(row.seconds_spent or 0.0), float(seconds_spent or 0.0))
    row.answered_at = utcnow()
    if flagged is not None:
        row.flagged = flagged

    # Live question analytics: a question's counters move once per first answer,
    # so autosave replays and answer changes never inflate them.
    if is_new and canonical:
        register_question_attempt(db, question, correct=bool(row.is_correct), elapsed_ms=int(row.seconds_spent * 1000))
        mastery_scope_update(
            db,
            attempt.student_id,
            scope_type="difficulty",
            scope_key=question.difficulty,
            correct=bool(row.is_correct),
        )
        if question.topic:
            mastery_scope_update(
                db,
                attempt.student_id,
                scope_type="topic",
                scope_key=question.topic,
                correct=bool(row.is_correct),
            )
        if row.is_correct:
            resolve_mistake(db, attempt.student_id, question_id)
        else:
            record_mistake(db, attempt.student_id, question, selected=canonical, source="exam")
    elif previous != canonical:
        # Changing an answer only re-tallies this question's success/wrong split.
        if row.is_correct:
            question.correct_count = (question.correct_count or 0) + 1
            question.wrong_count = max(0, (question.wrong_count or 0) - 1)
        elif canonical:
            question.wrong_count = (question.wrong_count or 0) + 1
            question.correct_count = max(0, (question.correct_count or 0) - 1)
        if canonical:
            if row.is_correct:
                resolve_mistake(db, attempt.student_id, question_id)
            else:
                record_mistake(db, attempt.student_id, question, selected=canonical, source="exam")

    db.flush()
    attempt.flagged = sorted(a.question_id for a in attempt.answers if a.flagged)
    db.flush()

    answered = db.scalar(
        select(func.count(Answer.id)).where(Answer.attempt_id == attempt.id, Answer.selected.is_not(None))
    )
    events = [
        to_admins(
            "exam_progress",
            {
                "attempt_id": attempt.id,
                "quiz_id": attempt.quiz_id,
                "student_id": attempt.student_id,
                "answered": int(answered or 0),
                "total": len(attempt.quiz.questions),
                "time_remaining": time_remaining(attempt),
            },
        )
    ]
    return row, events


def rank_for(db: Session, attempt: Attempt) -> int:
    """1-based rank among submitted attempts for the same quiz."""
    better = db.scalar(
        select(func.count(Attempt.id)).where(
            Attempt.quiz_id == attempt.quiz_id,
            Attempt.status == "submitted",
            (Attempt.score > attempt.score)
            | ((Attempt.score == attempt.score) & (Attempt.submitted_at < attempt.submitted_at)),
        )
    )
    return int(better or 0) + 1


def top_leaderboard(db: Session, *, limit: int = 10) -> list[dict]:
    from ..serializers import leaderboard_row

    played = (Student.xp > 0) | (Student.exams_taken > 0) | (Student.duels_played > 0)
    students = db.scalars(
        select(Student)
        .where(Student.is_banned.is_(False), played)
        .order_by(Student.xp.desc(), Student.coins.desc())
        .limit(limit)
    ).all()
    return [leaderboard_row(student, index + 1) for index, student in enumerate(students)]


def quiz_leaderboard(db: Session, quiz_id: int) -> list[dict]:
    """Ranked submission sheet for one quiz."""
    from ..serializers import attempt_summary, student_public

    payload = []
    for row in game.ranked_attempts(db, quiz_id):
        attempt: Attempt = row["attempt"]
        payload.append(
            {
                "rank": row["rank"],
                "rank_label": game.rank_suffix(row["rank"]),
                "student": student_public(attempt.student, mask=True),
                "result": attempt_summary(attempt),
            }
        )
    return payload


def expire_overdue(db: Session) -> list[Event]:
    """Auto-submit attempts whose server deadline passed (background ticker)."""
    events: list[Event] = []
    cutoff = utcnow() - timedelta(seconds=EXAM_GRACE_SECONDS)
    stale = db.scalars(
        select(Attempt).where(Attempt.status == "in_progress", Attempt.deadline_at < cutoff)
    ).all()
    for attempt in stale:
        _, attempt_events = finalize(db, attempt, "expired")
        events.extend(attempt_events)
    if stale:
        db.commit()
    return events
