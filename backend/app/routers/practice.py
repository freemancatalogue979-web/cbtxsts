"""Practice modes, power-ups, combos and boss battles.

All runs are generated server-side and graded against ``Question.correct`` — the
browser sends *which display letter was tapped*, never a score. Scores, combos,
lives and boss damage are computed here, so a tampered client cannot award
itself XP.
"""
from __future__ import annotations

import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from .. import game
from ..db import get_db
from ..deps import require_student
from ..events import Event, dispatch, to_student
from ..models import (
    BossRun,
    CommunityBoss,
    Course,
    PracticeChallenge,
    PracticeRun,
    Question,
    Student,
    utcnow,
)
from ..schemas import BossAnswerIn, BossStartIn, PracticeAnswerIn, PracticeStartIn
from ..serializers import iso, question_public, student_profile
from ..services.questions import answer_matches, display_order, mastery_scope_update, register_question_attempt
from ..services import study_lab

router = APIRouter(prefix="/arena", tags=["arena"])

COMBO_STEPS = (1, 2, 3, 4, 5, 10)
MODES: dict[str, dict[str, Any]] = {
    "sprint5": {"label": "5-question sprint", "size": 5, "lives": 1, "seconds": 0, "xp": 4},
    "sprint10": {"label": "10-question sprint", "size": 10, "lives": 1, "seconds": 0, "xp": 5},
    "sprint20": {"label": "20-question sprint", "size": 20, "lives": 1, "seconds": 0, "xp": 5},
    "endless": {"label": "Endless", "size": 15, "lives": 0, "seconds": 0, "xp": 5},
    "one_life": {"label": "One life", "size": 20, "lives": 1, "seconds": 0, "xp": 7},
    "survival": {"label": "Survival", "size": 25, "lives": 3, "seconds": 0, "xp": 6},
    "time_attack": {"label": "Time attack", "size": 15, "lives": 0, "seconds": 120, "xp": 6},
    "speed": {"label": "Speed challenge", "size": 10, "lives": 0, "seconds": 60, "xp": 7},
    "accuracy": {"label": "Accuracy attack", "size": 15, "lives": 1, "seconds": 0, "xp": 7},
    "streak": {"label": "Perfect streak", "size": 20, "lives": 1, "seconds": 0, "xp": 8},
    "weak": {"label": "Weak-topic challenge", "size": 12, "lives": 2, "seconds": 0, "xp": 7},
    "hard": {"label": "Hard only", "size": 12, "lives": 2, "seconds": 0, "xp": 8},
    "warmup": {"label": "Easy warm-up", "size": 10, "lives": 3, "seconds": 0, "xp": 3},
    "mixed": {"label": "Mixed difficulty", "size": 15, "lives": 2, "seconds": 0, "xp": 6},
    "daily": {"label": "Daily challenge", "size": 5, "lives": 1, "seconds": 0, "xp": 9},
    "daily_perfect": {"label": "Daily perfect run", "size": 5, "lives": 1, "seconds": 0, "xp": 12},
}

POWERUPS = ("fifty", "reveal", "freeze", "shield", "second_chance", "double_xp", "streak_shield")

# ---------------------------------------------------------------------------
# Custom practice (Course → Topic → count → duration), the student-designed run.
# ---------------------------------------------------------------------------
CUSTOM_MODE = "custom"
CUSTOM_LABEL = "Custom practice"
CUSTOM_XP_PER_CORRECT = 5
# Duration options offered on the setup screen (minutes). The API accepts any
# whole minute between the bounds below, so other frontends stay welcome.
DURATION_CHOICES_MINUTES = (10, 20, 30, 40, 50, 60)
MIN_DURATION_SECONDS = 60
MAX_DURATION_SECONDS = 120 * 60
COUNT_CHOICES = (5, 10, 20, 30, 40, 50)
DEFAULT_CUSTOM_SIZE = 20


def _parse_iso(value: Any) -> datetime | None:
    """Payload timestamps as naive UTC — tolerant of a Z or +00:00 offset so a
    timestamp written by any client/tooling can never poison a comparison."""
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _run_expired(state: dict[str, Any]) -> bool:
    """True when a timed run's server-side ``ends_at`` has passed."""
    ends_at = _parse_iso(state.get("ends_at"))
    return ends_at is not None and utcnow() >= ends_at


def _combo_multiplier(combo: int) -> int:
    multiplier = 1
    for step in COMBO_STEPS:
        if combo + 1 >= step:
            multiplier = step
    return multiplier


def _pool(
    db: Session,
    *,
    course_id: int | None = None,
    quiz_id: int | None = None,
    topic: str = "",
    difficulty: str = "",
    adaptive_student: Student | None = None,
    adaptive: bool = True,
    strict: bool = False,
) -> list[Question]:
    """Practice-eligible questions for the requested scope.

    ``strict=True`` (custom practice) never widens the net: if the chosen
    course/topic has no questions the caller reports that precisely instead of
    silently substituting unrelated questions. Legacy arena modes keep the
    widen-the-net behaviour they were built on.
    """
    stmt = select(Question).where(
        Question.status == "approved",
        Question.visible.is_(True),
        Question.practice_enabled.is_(True),
    )
    if quiz_id:
        stmt = stmt.where(Question.quiz_id == quiz_id)
    elif course_id:
        stmt = stmt.where(Question.course_id == course_id, Question.source_id.is_(None), Question.exam_only.is_(False))
    else:
        stmt = stmt.where(Question.source_id.is_(None), Question.exam_only.is_(False))
    if topic:
        stmt = stmt.where(func.lower(Question.topic) == topic.lower())
    if difficulty:
        stmt = stmt.where(Question.difficulty == difficulty.lower())
    pool = list(db.scalars(stmt).all())
    if not pool and not strict:
        # Never leave a player with nothing to practise: widen the net.
        pool = list(
            db.scalars(
                select(Question)
                .where(Question.status == "approved", Question.visible.is_(True), Question.exam_only.is_(False))
                .limit(200)
            ).all()
        )
    return pool


def _adaptive_order(db: Session, pool: list[Question], student: Student, size: int, *, want_weak: bool) -> list[Question]:
    """The smart question engine: weigh accuracy, speed and topic weakness."""
    from ..models import PlayerMastery

    mastery = {
        (row.scope_type, row.scope_key.lower()): row.mastery
        for row in db.scalars(select(PlayerMastery).where(PlayerMastery.student_id == student.id)).all()
    }
    scored: list[tuple[float, Question]] = []
    for question in pool:
        weight = 1.0
        topic_mastery = mastery.get(("topic", (question.topic or "").lower()))
        if topic_mastery is not None:
            weight += (100 - topic_mastery) / 55  # weaker topics come up more often
        difficulty_mastery = mastery.get(("difficulty", question.difficulty))
        if difficulty_mastery is not None:
            weight += (100 - difficulty_mastery) / 80
        if question.usage_count:
            accuracy = question.correct_count / max(question.usage_count, 1)
            weight += (1 - accuracy) * 0.7
        if question.difficulty == "hard":
            weight += 0.25
        if want_weak:
            weight += (question.wrong_count or 0) / max(question.usage_count or 1, 1)
        weight += random.random() * 0.45
        scored.append((weight, question))
    scored.sort(key=lambda item: -item[0])
    return [question for _, question in scored[:size]]


def _srs_question_payload(question: Question, order: list[str]) -> dict:
    return question_public(question, reveal=False, order=order)


# ---------------------------------------------------------------------------
# Custom practice — Course → Topic → number of questions → duration
# ---------------------------------------------------------------------------
def _question_still_practicable(question: Question | None) -> bool:
    """A question only counts while it is still published for practice.

    Questions deleted or hidden by an administrator mid-session are dropped
    from the run instead of crashing it (the bank is the source of truth).
    """
    return bool(
        question is not None
        and question.status == "approved"
        and question.visible
        and question.practice_enabled
    )


def _run_payload(db: Session, challenge: PracticeChallenge, *, include_answers: bool = False) -> dict:
    """Serialise an open custom run — identical for start and resume.

    The per-question option order is regenerated from the deterministic seed
    ``practice:{token}:{question_id}``, so a refresh (or any other client) sees
    exactly the same paper: same questions, same order, same shuffled options.
    """
    state: dict[str, Any] = dict(challenge.payload or {})
    ids = [int(qid) for qid in (state.get("question_ids") or [])]
    questions = [db.get(Question, qid) for qid in ids]
    alive = [question for question in questions if _question_still_practicable(question)]
    if len(alive) != len(ids):
        # The bank changed under the run (question deleted/hidden) — shrink the
        # run to what still exists, never resurrect removed questions.
        ids = [question.id for question in alive]
        state["question_ids"] = ids
        challenge.payload = state
        db.commit()

    orders = {
        question.id: display_order(question, shuffle=True, seed=f"practice:{challenge.token}:{question.id}")
        for question in alive
    }
    answers: dict[str, Any] = dict(state.get("answers") or {})
    answered_ids = {int(key) for key in answers}
    current_index = next((position for position, qid in enumerate(ids) if qid not in answered_ids), len(ids))

    duration_seconds = int(state.get("duration_seconds") or state.get("seconds") or 0)
    course_id = state.get("course_id")
    course = db.get(Course, int(course_id)) if course_id else None
    payload: dict[str, Any] = {
        "token": challenge.token,
        "mode": challenge.mode,
        "label": CUSTOM_LABEL,
        "lives": 0,
        "seconds": duration_seconds,
        "duration_seconds": duration_seconds,
        "ends_at": iso(_parse_iso(state.get("ends_at"))),
        "started_at": iso(_parse_iso(state.get("started_at"))),
        "server_now": iso(utcnow()),
        "course": (
            {"id": course.id, "code": course.code, "title": course.title, "accent": course.accent}
            if course
            else None
        ),
        "topic": state.get("topic") or "",
        "requested_size": int(state.get("requested_size") or len(ids)),
        "xp_rate": CUSTOM_XP_PER_CORRECT,
        "target_score": 0,
        "powerups": state.get("powerups") or {},
        "questions": [_srs_question_payload(question, orders[question.id]) for question in alive],
        "index": current_index,
        "stats": {
            "answered": len(answered_ids),
            "correct": sum(1 for row in answers.values() if row.get("correct")),
            "wrong": sum(1 for row in answers.values() if not row.get("correct")),
            "remaining": max(0, len(ids) - len(answered_ids)),
        },
        "finished": len(ids) > 0 and len(answered_ids) >= len(ids),
    }
    if include_answers:
        payload["answers"] = [
            {
                "question_id": int(key),
                "selected": row.get("selected"),
                "correct": bool(row.get("correct")),
            }
            for key, row in answers.items()
        ]
    return payload


@router.get("/practice/catalog")
def practice_catalog(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """Courses → topics → how many practice questions each holds.

    Powers the setup screen; counts only questions a student may actually be
    asked in practice (approved, visible, practice-enabled, bank originals —
    never an exam's drawn copies), so the number offered is the number usable.
    """
    courses = db.scalars(select(Course).where(Course.is_active.is_(True)).order_by(Course.code)).all()
    rows = db.execute(
        select(Question.course_id, Question.topic, func.count(Question.id))
        .where(
            Question.status == "approved",
            Question.visible.is_(True),
            Question.practice_enabled.is_(True),
            Question.source_id.is_(None), Question.exam_only.is_(False),
            Question.course_id.is_not(None),
        )
        .group_by(Question.course_id, Question.topic)
    ).all()
    grouped: dict[int, dict[str, int]] = {}
    for course_id, topic, count in rows:
        key = (topic or "").strip()
        bucket = grouped.setdefault(int(course_id), {})
        bucket[key] = bucket.get(key, 0) + int(count)

    payload = []
    for course in courses:
        topics_raw = grouped.get(course.id, {})
        topics = [
            {
                # "" is the sentinel for untagged questions — the start endpoint
                # treats it as "every question in the course bank".
                "topic": key or "General",
                "key": key,
                "count": count,
            }
            for key, count in topics_raw.items()
        ]
        topics.sort(key=lambda row: (-row["count"], row["topic"].lower()))
        payload.append(
            {
                "id": course.id,
                "code": course.code,
                "title": course.title,
                "accent": course.accent,
                "available": sum(row["count"] for row in topics),
                "topics": topics,
            }
        )
    return {
        "courses": [row for row in payload if row["available"] > 0],
        "count_choices": list(COUNT_CHOICES),
        "duration_choices_minutes": list(DURATION_CHOICES_MINUTES),
    }


@router.get("/practice/active")
def practice_active(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """The caller's open custom run, if any — this is what survives a refresh.

    Returns the exact same paper the run started with (same question IDs in the
    same order, same per-question option shuffles) plus the answers already
    given, so the browser can restore the session instead of generating a new
    one. A timed-out run with answers comes back flagged ``expired`` so the
    client can finalise it and show the summary; a timed-out run with no
    answers is discarded — there is nothing to report.
    """
    challenge = db.scalar(
        select(PracticeChallenge)
        .where(
            PracticeChallenge.student_id == student.id,
            PracticeChallenge.status == "open",
            PracticeChallenge.mode == CUSTOM_MODE,
        )
        .order_by(PracticeChallenge.id.desc())
        .limit(1)
    )
    if challenge is None:
        return {"run": None, "expired": False}
    state: dict[str, Any] = dict(challenge.payload or {})
    if _run_expired(state):
        if state.get("answers"):
            return {"run": _run_payload(db, challenge, include_answers=True), "expired": True}
        challenge.status = "expired"
        challenge.finished_at = utcnow()
        db.commit()
        return {"run": None, "expired": False}
    if not state.get("question_ids"):
        # every question in the run was removed from the bank
        challenge.status = "expired"
        challenge.finished_at = utcnow()
        db.commit()
        return {"run": None, "expired": False}
    return {"run": _run_payload(db, challenge, include_answers=True), "expired": False}


@router.post("/practice/abandon")
def abandon_practice(
    token: str = Query(...),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Discard an open custom run without recording a result or rewards."""
    challenge = db.scalar(select(PracticeChallenge).where(PracticeChallenge.token == token))
    if challenge is None or challenge.student_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That run is no longer available.")
    if challenge.status == "open":
        challenge.status = "abandoned"
        challenge.finished_at = utcnow()
        db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Practice runs
# ---------------------------------------------------------------------------
@router.get("/practice/modes")
def practice_modes(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    best = dict(
        db.execute(
            select(PracticeRun.mode, func.max(PracticeRun.score)).where(PracticeRun.student_id == student.id).group_by(PracticeRun.mode)
        ).all()
    )
    played = dict(
        db.execute(
            select(PracticeRun.mode, func.count(PracticeRun.id)).where(PracticeRun.student_id == student.id).group_by(PracticeRun.mode)
        ).all()
    )
    return {
        "modes": [
            {
                "key": key,
                **value,
                "best": int(best.get(key, 0) or 0),
                "played": int(played.get(key, 0) or 0),
            }
            for key, value in MODES.items()
        ],
        "powerups": [
            {"key": "fifty", "name": "50/50", "icon": "scissors", "blurb": "Removes two wrong options."},
            {"key": "reveal", "name": "Reveal clue", "icon": "lightbulb", "blurb": "Shows the question hint."},
            {"key": "freeze", "name": "Time freeze", "icon": "snowflake", "blurb": "Stops the clock for 15 seconds."},
            {"key": "shield", "name": "Shield", "icon": "shield", "blurb": "Absorbs one wrong answer."},
            {"key": "second_chance", "name": "Second chance", "icon": "rotate-ccw", "blurb": "Retry one question."},
            {"key": "double_xp", "name": "Double XP", "icon": "zap", "blurb": "Doubles XP for this run."},
            {"key": "streak_shield", "name": "Streak shield", "icon": "flame", "blurb": "Protects your combo once."},
        ],
    }


@router.get("/practice/history")
def practice_history(
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
    limit: int = Query(30, ge=1, le=100),
) -> dict:
    rows = db.scalars(
        select(PracticeRun).where(PracticeRun.student_id == student.id).order_by(PracticeRun.id.desc()).limit(limit)
    ).all()
    totals = db.execute(
        select(
            func.count(PracticeRun.id),
            func.sum(PracticeRun.correct),
            func.sum(PracticeRun.total),
            func.max(PracticeRun.best_streak),
        ).where(PracticeRun.student_id == student.id)
    ).one()
    played, correct, total, best_streak = int(totals[0] or 0), int(totals[1] or 0), int(totals[2] or 0), int(totals[3] or 0)
    days = db.scalar(
        select(func.count(func.distinct(func.date(PracticeRun.created_at)))).where(PracticeRun.student_id == student.id)
    ) or 0
    return {
        "runs": [
            {
                "id": row.id,
                "mode": row.mode,
                "label": MODES.get(row.mode, {}).get("label", CUSTOM_LABEL if row.mode == CUSTOM_MODE else row.mode),
                "score": row.score,
                "correct": row.correct,
                "total": row.total,
                "best_streak": row.best_streak,
                "max_combo": row.max_combo,
                "perfect": row.perfect,
                "elapsed_ms": row.elapsed_ms,
                "created_at": iso(row.created_at),
            }
            for row in rows
        ],
        "stats": {
            "runs": played,
            "correct": correct,
            "total": total,
            "accuracy": round(correct / total * 100, 1) if total else 0.0,
            "best_streak": best_streak,
            "days_played": int(days),
        },
        "personal_bests": [
            {
                "mode": key,
                "best": int(
                    db.scalar(select(func.max(PracticeRun.score)).where(PracticeRun.student_id == student.id, PracticeRun.mode == key))
                    or 0
                ),
            }
            for key in MODES
        ],
    }


@router.post("/practice/start")
def start_practice(
    payload: PracticeStartIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    if payload.mode == CUSTOM_MODE:
        return _start_custom(payload, db, student)
    mode = payload.mode if payload.mode in MODES else "sprint10"
    config = MODES[mode]
    size = min(int(payload.size or config["size"]), 100)
    pool = _pool(
        db,
        course_id=payload.course_id,
        quiz_id=payload.quiz_id,
        topic=payload.topic,
        difficulty=payload.difficulty or ("hard" if mode == "hard" else "easy" if mode == "warmup" else ""),
    )
    if not pool:
        raise HTTPException(status.HTTP_409_CONFLICT, "No practice questions are available yet.")
    picks = _adaptive_order(db, pool, student, size, want_weak=mode in {"weak", "accuracy"})
    token = str(uuid.uuid4())
    lives = min(payload.lives, config["lives"]) if 0 < payload.lives < config["lives"] else config["lives"]
    seconds = payload.time_limit_seconds or config["seconds"]
    challenge = PracticeChallenge(
        token=token,
        student_id=student.id,
        mode=mode,
        payload={
            "question_ids": [row.id for row in picks],
            "index": 0,
            "score": 0,
            "correct": 0,
            "combo": 0,
            "max_combo": 0,
            "best_streak": 0,
            "lives": lives,
            "max_lives": int(config["lives"]),
            "lives_enabled": int(config["lives"]) > 0,
            "seconds": seconds,
            "target_score": payload.target_score,
            "powerups": {"fifty": 1, "reveal": 1, "freeze": 1, "shield": 1, "second_chance": 1, "double_xp": 1, "streak_shield": 1},
            "used": {},
            "answers": {},
            "topic": (payload.topic or "").strip()[:120],
            "started_at": iso(utcnow()),
        },
    )
    db.add(challenge)
    db.commit()

    orders = {row.id: display_order(row, shuffle=True, seed=f"practice:{token}:{row.id}") for row in picks}
    return {
        "token": token,
        "mode": mode,
        "label": config["label"],
        "lives": lives,
        "seconds": seconds,
        "xp_rate": config["xp"],
        "target_score": payload.target_score,
        "powerups": challenge.payload["powerups"],
        "questions": [_srs_question_payload(row, orders[row.id]) for row in picks],
    }


def _start_custom(payload: PracticeStartIn, db: Session, student: Student) -> dict:
    """Course → Topic → count → duration: the student-designed practice run.

    Questions are drawn with ``random.sample`` from the course/topic bank —
    distinct rows, random order — so a question can never repeat inside one
    session while every fresh run gets a new shuffle. The selected IDs and the
    server-side ``ends_at`` are stored on the challenge, which is what makes
    the session survive a refresh with the same paper and an honest clock.
    """
    if not payload.course_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a course to practise.")
    course = db.get(Course, payload.course_id)
    if course is None or not course.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That course is no longer available.")

    # One open custom run at a time: starting fresh quietly discards the old one.
    previous = db.scalar(
        select(PracticeChallenge).where(
            PracticeChallenge.student_id == student.id,
            PracticeChallenge.status == "open",
            PracticeChallenge.mode == CUSTOM_MODE,
        )
    )
    if previous is not None:
        previous.status = "abandoned"
        previous.finished_at = utcnow()

    topic = (payload.topic or "").strip()
    pool = _pool(db, course_id=course.id, topic=topic, strict=True)
    if not pool:
        scope = f" for {topic}" if topic else f" for {course.title}"
        raise HTTPException(status.HTTP_409_CONFLICT, f"No practice questions are available{scope} yet.")

    available = len(pool)
    requested = int(payload.size or 0)
    if requested <= 0:
        requested = min(DEFAULT_CUSTOM_SIZE, available)
    if requested > available:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Only {available} questions are available for this topic."
        )

    # Random unique selection + random order for this session only — the bank
    # itself is never reordered.
    picks = random.sample(pool, requested)

    duration_seconds = int(payload.time_limit_seconds or 0)
    if duration_seconds:
        duration_seconds = max(MIN_DURATION_SECONDS, min(MAX_DURATION_SECONDS, duration_seconds))
    now = utcnow()
    token = str(uuid.uuid4())
    challenge = PracticeChallenge(
        token=token,
        student_id=student.id,
        mode=CUSTOM_MODE,
        payload={
            "question_ids": [row.id for row in picks],
            "index": 0,
            "score": 0,
            "correct": 0,
            "combo": 0,
            "max_combo": 0,
            "best_streak": 0,
            "lives": 0,
            "max_lives": 0,
            "lives_enabled": False,
            "seconds": duration_seconds,
            "duration_seconds": duration_seconds,
            "ends_at": iso(now + timedelta(seconds=duration_seconds)) if duration_seconds else None,
            "started_at": iso(now),
            "course_id": course.id,
            "course_code": course.code,
            "course_title": course.title,
            "topic": topic,
            "requested_size": requested,
            "target_score": 0,
            "powerups": {},
            "used": {},
            "answers": {},
            "custom": True,
        },
    )
    db.add(challenge)
    db.commit()
    return _run_payload(db, challenge, include_answers=False)


def _label_for_order(order: list[str], canonical: str) -> str | None:
    for position, key in enumerate(order):
        if key == canonical:
            return "ABCD"[position] if position < 4 else None
    return None


def _challenge(db: Session, token: str, student: Student) -> PracticeChallenge:
    row = db.scalar(select(PracticeChallenge).where(PracticeChallenge.token == token))
    if row is None or row.student_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That run is no longer available.")
    if row.status != "open":
        raise HTTPException(status.HTTP_409_CONFLICT, "That run is already finished.")
    if row.created_at < utcnow() - timedelta(hours=6):
        row.status = "expired"
        db.commit()
        raise HTTPException(status.HTTP_409_CONFLICT, "That run expired — start a fresh one.")
    return row


@router.post("/practice/answer")
def answer_practice(
    payload: PracticeAnswerIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Grade one practice answer. Score, combo and lives are decided here."""
    challenge = _challenge(db, payload.token, student)
    state = dict(challenge.payload or {})
    ids = list(state.get("question_ids") or [])
    if payload.question_id not in ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That question is not part of this run.")
    # Server-side clock: once ends_at has passed no more answers are accepted,
    # whatever the browser's own timer thinks.
    if _run_expired(state):
        raise HTTPException(status.HTTP_409_CONFLICT, "Time is up — this practice run has ended.")
    # Custom runs answer each question exactly once.
    if state.get("custom") and str(payload.question_id) in (state.get("answers") or {}):
        raise HTTPException(status.HTTP_409_CONFLICT, "You have already answered that question.")
    question = db.get(Question, payload.question_id)
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found.")

    order = display_order(question, shuffle=True, seed=f"practice:{payload.token}:{question.id}")
    # Map the tapped display letter to the canonical key before grading.
    canonical = None
    if payload.selected:
        text = str(payload.selected).strip().upper()
        if text in order:
            position = "ABCD".find(text)
            canonical = order[position] if 0 <= position < len(order) else None
        elif text in {"A", "B", "C", "D"}:
            canonical = text
    correct = answer_matches(question.correct, canonical)

    lives = int(state.get("lives", 1) or 0)
    shield_used = False
    if not correct and lives > 0 and state["powerups"].get("shield", 0) > 0 and canonical:
        shield = state["powerups"].get("shield", 0)
        if shield and not state.get("shield_spent"):
            state["powerups"]["shield"] = shield - 1
            state["shield_spent"] = True
            shield_used = True

    combo = int(state.get("combo", 0))
    if correct:
        combo += 1
        state["combo"] = combo
        state["max_combo"] = max(int(state.get("max_combo", 0)), combo)
        state["best_streak"] = max(int(state.get("best_streak", 0)), combo)
        multiplier = _combo_multiplier(combo - 1)
        points = 100 * multiplier
        if payload.elapsed_ms and payload.elapsed_ms < 5000:
            points = int(points * 1.25)
        if payload.risk:
            points += points
        state["score"] = int(state.get("score", 0)) + points
        state["correct"] = int(state.get("correct", 0)) + 1
    else:
        if payload.risk:
            state["score"] = max(0, int(state.get("score", 0)) - 50)
        if not shield_used and state["powerups"].get("streak_shield", 0) > 0 and combo >= 3:
            state["powerups"]["streak_shield"] = state["powerups"]["streak_shield"] - 1
            state["streak_shield_spent"] = True
            combo = max(0, combo - 1)
        else:
            combo = 0
        state["combo"] = combo
        if lives > 0:
            lives -= 1
            state["lives"] = lives

    state.setdefault("answers", {})[str(question.id)] = {
        "selected": canonical,
        "correct": correct,
        "elapsed_ms": int(payload.elapsed_ms or 0),
    }
    register_question_attempt(db, question, correct=correct, elapsed_ms=int(payload.elapsed_ms or 0))
    mastery_scope_update(db, student.id, scope_type="difficulty", scope_key=question.difficulty, correct=correct)
    if question.topic:
        mastery_scope_update(db, student.id, scope_type="topic", scope_key=question.topic, correct=correct)
    if correct:
        study_lab.resolve_mistake(db, student.id, question.id)
    elif canonical:
        study_lab.record_mistake(db, student.id, question, selected=canonical, source="practice")

    index = ids.index(payload.question_id) + 1
    state["index"] = max(int(state.get("index", 0)), index)
    # Lives only end a run in modes that actually have lives; endless/time-attack
    # runs (lives = 0) must never be cut short by a wrong answer.
    lives_enabled = bool(state.get("lives_enabled", state.get("max_lives", 0)))
    finished = (
        (lives_enabled and lives <= 0)
        or index >= len(ids)
        or bool(state.get("target_score") and int(state.get("score", 0)) >= int(state["target_score"]))
    )
    challenge.payload = state
    if finished:
        challenge.status = "done"
        challenge.finished_at = utcnow()
    db.commit()
    return {
        "correct": correct,
        "canonical": canonical,
        "expected": question.correct,
        "expected_label": _label_for_order(order, question.correct),
        "picked_label": payload.selected,
        "explanation": question.explanation,
        "hint": getattr(question, "hint", "") or "",
        "score": int(state.get("score", 0)),
        "combo": combo,
        "multiplier": _combo_multiplier(combo - 1) if correct else 1,
        "lives": lives,
        "shield_used": shield_used,
        "index": index,
        "total": len(ids),
        "finished": finished,
        "powerups": state.get("powerups", {}),
        "elapsed": int(payload.elapsed_ms or 0),
    }


@router.post("/practice/powerup")
def use_powerup(
    token: str = Query(...),
    powerup: str = Query(...),
    question_id: int = Query(...),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Spend a power-up. The server decides what (if anything) the player sees."""
    challenge = _challenge(db, token, student)
    if powerup not in POWERUPS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown power-up.")
    state = dict(challenge.payload or {})
    pool = dict(state.get("powerups") or {})
    if pool.get(powerup, 0) <= 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "You are out of that power-up.")
    question = db.get(Question, question_id)
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found.")
    pool[powerup] = pool[powerup] - 1
    state["powerups"] = pool
    challenge.payload = state
    db.commit()

    order = display_order(question, shuffle=True, seed=f"practice:{token}:{question.id}")
    if powerup == "fifty":
        wrong = [key for key in order if key not in question.answer_keys]
        return {"ok": True, "hidden": wrong[:2], "powerups": pool}
    if powerup == "reveal":
        return {"ok": True, "hint": question.hint or question.explanation[:160], "powerups": pool}
    if powerup == "freeze":
        return {"ok": True, "freeze_seconds": 15, "powerups": pool}
    if powerup == "double_xp":
        return {"ok": True, "double_xp": True, "powerups": pool}
    if powerup == "second_chance":
        state.setdefault("answers", {}).pop(str(question.id), None)
        challenge.payload = state
        db.commit()
        return {"ok": True, "retry": True, "powerups": pool}
    return {"ok": True, "powerups": pool}


@router.post("/practice/finish")
async def finish_practice(
    token: str = Query(...),
    elapsed_ms: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    challenge = db.scalar(select(PracticeChallenge).where(PracticeChallenge.token == token))
    if challenge is None or challenge.student_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That run is no longer available.")
    if challenge.status == "done" and (challenge.payload or {}).get("finalised"):
        final = dict(challenge.payload)
        if final.get("summary"):
            return {"ok": True, "already": True, **final["summary"]}
        return {"ok": True, "already": True, "score": final.get("score", 0), "correct": final.get("correct", 0)}

    state = dict(challenge.payload or {})
    answer_map: dict[str, Any] = dict(state.get("answers") or {})
    custom = bool(state.get("custom")) or challenge.mode == CUSTOM_MODE
    # A custom run (or any timed run whose clock ran out) may be finished with
    # no answers — there is nothing to farm from a zero-score run.
    if not answer_map and not (custom or _run_expired(state)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Answer at least one question before finishing.")
    ids = [int(qid) for qid in (state.get("question_ids") or [])]
    correct = int(state.get("correct", 0) or sum(1 for row in answer_map.values() if row.get("correct")))
    total = len(ids) or len(answer_map)
    score = int(state.get("score", 0))
    mode = challenge.mode
    config = MODES.get(mode) or {"label": CUSTOM_LABEL, "xp": CUSTOM_XP_PER_CORRECT}
    perfect = total > 0 and correct == total and bool(answer_map)

    # --- time used: derived from the server-side window, not the client ------
    started = _parse_iso(state.get("started_at"))
    ends = _parse_iso(state.get("ends_at"))
    if started is not None:
        finish_time = min(utcnow(), ends) if ends is not None else utcnow()
        time_used_seconds = max(0, int((finish_time - started).total_seconds()))
    else:
        time_used_seconds = int(elapsed_ms or 0) // 1000

    # --- review: every question, the student's answer, the correct answer ---
    review: list[dict[str, Any]] = []
    for qid in ids:
        question = db.get(Question, qid)
        if question is None:
            continue
        order = display_order(question, shuffle=True, seed=f"practice:{challenge.token}:{qid}")
        entry = question_public(question, reveal=True, order=order)
        answered = answer_map.get(str(qid))
        chosen_label = None
        if answered and answered.get("selected") in order:
            chosen_label = "ABCD"[order.index(answered["selected"])]
        review.append(
            {
                "id": qid,
                "text": entry["text"],
                "topic": entry.get("topic") or "",
                "options": entry["options"],
                "chosen_label": chosen_label,
                "chosen_text": (question.options.get(answered.get("selected"), "") if answered else "") or None,
                "correct_label": entry.get("correct_label"),
                "correct_text": ", ".join(text for text in (entry.get("answer_text") or []) if text),
                "correct": bool(answered and answered.get("correct")),
                "answered": bool(answered),
                "explanation": entry.get("explanation") or "",
            }
        )

    xp_rate = int(config.get("xp", 5))
    xp = correct * xp_rate + (20 if perfect else 0)
    coins = correct * 2 + (25 if perfect else 0)
    if state.get("powerups_used", {}).get("double_xp"):
        xp *= 2
    if perfect:
        coins += 15
    rewards = game.grant(
        db,
        student,
        xp=xp,
        coins=coins,
        kind="xp",
        title=f"Practice — {config['label']}",
        detail=f"{correct}/{total} correct · {score} points",
    )
    run = PracticeRun(
        student_id=student.id,
        mode=mode,
        score=score,
        correct=correct,
        total=total,
        best_streak=int(state.get("best_streak", 0) or 0),
        max_combo=int(state.get("max_combo", 0) or 0),
        elapsed_ms=int(elapsed_ms or 0),
        perfect=perfect,
        usable=True,
        xp_awarded=xp,
        coins_awarded=coins,
    )
    db.add(run)
    # Study Lab keeps its ledger of every topic-run finished, so the learning
    # path reflects practice done outside the Lab too.
    topic_done = str(state.get("topic") or "").strip()
    if topic_done:
        path = study_lab.path_for(db, student.id, topic_done)
        path.practice_runs = int(path.practice_runs or 0) + 1
        path.practice_answered = int(path.practice_answered or 0) + int(total or 0)
        path.practice_correct = int(path.practice_correct or 0) + int(correct or 0)
        study_lab.touch_practice_day(path)
        if total and correct / max(1, total) >= 0.5:
            study_lab.advance_stage(path, "review")
        run.topic = topic_done[:120]
    challenge.status = "done"
    challenge.finished_at = utcnow()
    state["finalised"] = True
    state["correct"] = correct
    state["score"] = score
    summary = {
        "score": score,
        "correct": correct,
        "wrong": max(0, total - correct),
        "total": total,
        "perfect": perfect,
        "score_percent": round(correct / total * 100, 1) if total else 0.0,
        "time_used_seconds": time_used_seconds,
        "course": (
            {"id": state.get("course_id"), "code": state.get("course_code"), "title": state.get("course_title")}
            if state.get("course_id")
            else None
        ),
        "topic": state.get("topic") or "",
        "mode": mode,
        "label": config["label"],
        "max_combo": int(state.get("max_combo", 0) or 0),
        "best_streak": int(state.get("best_streak", 0) or 0),
        "review": review,
    }
    state["summary"] = summary
    challenge.payload = state
    db.flush()
    best = db.scalar(
        select(func.max(PracticeRun.score)).where(PracticeRun.student_id == student.id, PracticeRun.mode == mode)
    )
    db.commit()
    if rewards:
        await dispatch([to_student(student.id, "rewards", rewards)])
    return {
        "ok": True,
        **summary,
        "best": int(best or score),
        "new_best": int(best or score) <= score,
        "xp": xp,
        "coins": coins,
        "rewards": rewards,
        "profile": student_profile(db, student),
    }


# ---------------------------------------------------------------------------
# Boss battles
# ---------------------------------------------------------------------------
BOSSES: dict[str, dict[str, Any]] = {
    "boss_quiz": {"name": "The Proctor", "hp_per_question": 100, "lives": 0, "difficulty": ""},
    "final_boss": {"name": "Final Boss — Dean of Studies", "hp_per_question": 140, "lives": 3, "difficulty": "hard"},
    "daily_boss": {"name": "Daily Boss", "hp_per_question": 120, "lives": 3, "difficulty": "hard"},
    "weekly_boss": {"name": "Weekly Boss", "hp_per_question": 160, "lives": 3, "difficulty": "hard"},
    "community": {"name": "Community Boss — The Examiner", "hp_per_question": 60, "lives": 3, "difficulty": ""},
}


def _cycle_key(boss_key: str) -> str:
    today = utcnow().date()
    if boss_key == "weekly_boss":
        iso = today.isocalendar()
        return f"{iso[0]}-W{iso[1]:02d}"
    if boss_key == "community":
        iso = today.isocalendar()
        return f"{iso[0]}-W{iso[1]:02d}"
    return today.isoformat()


def _community_boss(db: Session, cycle: str) -> CommunityBoss:
    boss = db.scalar(select(CommunityBoss).where(CommunityBoss.cycle_key == cycle))
    if boss is None:
        boss = CommunityBoss(
            boss_key=f"examiner-{cycle}",
            name="The Examiner",
            hp_max=5000,
            cycle_key=cycle,
        )
        db.add(boss)
        db.flush()
    return boss


@router.get("/boss")
def boss_home(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    daily_cycle = _cycle_key("daily_boss")
    weekly_cycle = _cycle_key("weekly_boss")
    community = _community_boss(db, _cycle_key("community"))
    runs = db.scalars(
        select(BossRun).where(BossRun.student_id == student.id).order_by(BossRun.id.desc()).limit(12)
    ).all()
    daily_best = db.scalar(
        select(func.max(BossRun.damage)).where(
            BossRun.student_id == student.id, BossRun.boss_key == "daily_boss", BossRun.cycle_key == daily_cycle
        )
    )
    weekly_leaderboard = db.execute(
        select(Student.name, func.max(BossRun.damage))
        .join(BossRun, BossRun.student_id == Student.id)
        .where(BossRun.boss_key == "weekly_boss", BossRun.cycle_key == weekly_cycle)
        .group_by(Student.id)
        .order_by(func.max(BossRun.damage).desc())
        .limit(10)
    ).all()
    return {
        "bosses": [
            {
                "key": key,
                **value,
                "cycle": _cycle_key(key),
                "hp_per_question": value["hp_per_question"],
            }
            for key, value in BOSSES.items()
        ],
        "daily": {"cycle": daily_cycle, "best_damage": int(daily_best or 0)},
        "weekly": {
            "cycle": weekly_cycle,
            "leaderboard": [{"name": name, "damage": int(damage or 0)} for name, damage in weekly_leaderboard],
        },
        "community": {
            "name": community.name,
            "hp_max": community.hp_max,
            "damage_taken": community.damage_taken,
            "hp_left": max(0, community.hp_max - community.damage_taken),
            "contributions": community.contributions,
            "defeated": community.defeated_at is not None,
            "percent": round(min(100.0, community.damage_taken / max(community.hp_max, 1) * 100), 1),
        },
        "history": [
            {
                "id": row.id,
                "boss": row.boss_key,
                "damage": row.damage,
                "hp_max": row.hp_max,
                "result": row.result,
                "max_combo": row.max_combo,
                "crits": row.crits,
                "created_at": iso(row.created_at),
            }
            for row in runs
        ],
    }


@router.post("/boss/start")
def start_boss(
    payload: BossStartIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    config = BOSSES.get(payload.boss_key, BOSSES["boss_quiz"])
    cycle = _cycle_key(payload.boss_key)
    if payload.boss_key in {"daily_boss", "weekly_boss"}:
        existing = db.scalar(
            select(BossRun).where(
                BossRun.student_id == student.id,
                BossRun.boss_key == payload.boss_key,
                BossRun.cycle_key == cycle,
            )
        )
        if existing is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "You already faced this boss — come back next cycle.")
    difficulty = payload.difficulty or config["difficulty"]
    pool = _pool(db, course_id=payload.course_id, difficulty=difficulty)
    if not pool:
        raise HTTPException(status.HTTP_409_CONFLICT, "No boss questions are available yet.")
    size = min(int(payload.size or 10), len(pool))
    picks = _adaptive_order(db, pool, student, size, want_weak=True)
    hp_max = config["hp_per_question"] * len(picks)
    lives = payload.lives if 0 < payload.lives < int(config.get("lives", 0) or 0) else int(config.get("lives", 0) or 0)
    run = BossRun(
        student_id=student.id,
        boss_key=payload.boss_key,
        cycle_key=cycle,
        hp_max=hp_max,
        hp_left=hp_max,
        lives_left=lives or 0,
        total=len(picks),
    )
    db.add(run)
    db.commit()
    token = str(uuid.uuid4())
    # Reuse the challenge store so the question set is immutable server-side.
    db.add(
        PracticeChallenge(
            token=token,
            student_id=student.id,
            mode=f"boss:{payload.boss_key}",
            payload={"question_ids": [row.id for row in picks], "run_id": run.id},
        )
    )
    db.commit()
    orders = {row.id: display_order(row, shuffle=True, seed=f"boss:{run.id}:{row.id}") for row in picks}
    return {
        "run_id": run.id,
        "token": token,
        "boss": {"key": payload.boss_key, "name": config["name"], "hp_max": hp_max, "lives": lives},
        "questions": [_srs_question_payload(row, orders[row.id]) for row in picks],
    }


@router.post("/boss/answer")
async def answer_boss(
    payload: BossAnswerIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Answer one boss question: correct = damage, fast = critical hit."""
    run = db.get(BossRun, payload.run_id)
    if run is None or run.student_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Boss run not found.")
    if run.result == "win" or run.hp_left <= 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "That boss is already defeated.")
    question = db.get(Question, payload.question_id)
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found.")

    order = display_order(question, shuffle=True, seed=f"boss:{run.id}:{question.id}")
    canonical = None
    if payload.selected:
        text = str(payload.selected).strip().upper()
        if text in order:
            index = "ABCD".find(text)
            canonical = order[index] if 0 <= index < len(order) else None
        elif text in {"A", "B", "C", "D"}:
            canonical = text
    correct = answer_matches(question.correct, canonical)

    config = BOSSES.get(run.boss_key, BOSSES["boss_quiz"])
    # Lives only end a run for bosses that actually have a last-stand bar.
    lives_enabled = int(config.get("lives", 0) or 0) > 0
    combo = int(payload.combo or 0)
    crit = False
    damage = 0
    run.answered = (run.answered or 0) + 1
    if correct:
        combo += 1
        multiplier = _combo_multiplier(combo - 1)
        # Base damage comes from the boss profile — never from the client.
        damage = int(config.get("hp_per_question", 60)) * multiplier
        if payload.elapsed_ms and payload.elapsed_ms < 5000:
            crit = True
            damage = int(damage * 1.6)
        run.damage += damage
        run.hp_left = max(0, run.hp_left - damage)
        run.correct += 1
        run.max_combo = max(run.max_combo, combo)
        run.crits += 1 if crit else 0
    else:
        combo = 0
        if lives_enabled and (run.lives_left or 0) > 0:
            run.lives_left -= 1
        # The boss punishes a slip: it heals a little (never past full).
        run.hp_left = min(run.hp_max, run.hp_left + 40)

    register_question_attempt(db, question, correct=correct, elapsed_ms=int(payload.elapsed_ms or 0))
    mastery_scope_update(db, student.id, scope_type="difficulty", scope_key=question.difficulty, correct=correct)
    if question.topic:
        mastery_scope_update(db, student.id, scope_type="topic", scope_key=question.topic, correct=correct)
    if correct:
        study_lab.resolve_mistake(db, student.id, question.id)
    elif canonical:
        study_lab.record_mistake(db, student.id, question, selected=canonical, source="boss")

    won = run.hp_left <= 0
    # Lives only end a run when the boss actually has a last-stand bar.
    lost = lives_enabled and (run.lives_left or 0) <= 0
    exhausted = run.answered >= max(run.total, 1)
    if won or lost or exhausted:
        run.result = "win" if won else ("lose" if lost else "timeout")
        run.elapsed_ms = int(payload.elapsed_ms or 0)
        xp = int(run.damage / 4) + (150 if won else 25)
        coins = int(run.damage / 12) + (80 if won else 10)
        run.total = max(run.total, run.answered)
        run.xp_awarded = xp
        run.coins_awarded = coins
        rewards = game.grant(
            db,
            student,
            xp=xp,
            coins=coins,
            kind="xp",
            title=f"Boss {'defeated' if won else 'retreat'} — {BOSSES.get(run.boss_key, {}).get('name', 'Boss')}",
            detail=f"{run.damage} damage · {run.max_combo}x best combo",
        )
        if run.boss_key == "community":
            community = _community_boss(db, _cycle_key("community"))
            community.damage_taken += run.damage
            community.contributions += 1
            if community.damage_taken >= community.hp_max and community.defeated_at is None:
                community.defeated_at = utcnow()
        db.commit()
        if rewards:
            await dispatch([to_student(student.id, "rewards", rewards)])
        return {
            "correct": correct,
            "damage": damage,
            "crit": crit,
            "combo": combo,
            "hp_left": run.hp_left,
            "hp_max": run.hp_max,
            "lives": run.lives_left,
            "finished": True,
            "won": won,
            "answered": run.answered,
            "total": run.total,
            "rewards": rewards,
            "profile": student_profile(db, student),
        }

    db.commit()
    return {
        "correct": correct,
        "damage": damage,
        "crit": crit,
        "combo": combo,
        "hp_left": run.hp_left,
        "hp_max": run.hp_max,
        "lives": run.lives_left,
        "finished": False,
        "won": False,
        "expected": question.correct,
        "explanation": question.explanation,
    }


@router.post("/boss/abandon")
def abandon_boss(run_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    run = db.get(BossRun, run_id)
    if run is None or run.student_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Boss run not found.")
    if run.result not in {"win", "lose"}:
        run.result = "abandoned"
    db.commit()
    return {"ok": True}
