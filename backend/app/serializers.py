"""Model -> JSON serializers.

Security rule enforced here: ``Question.correct`` and ``explanation`` are only
ever emitted when ``reveal=True`` (post-submission review or admin views). The
exam payload never ships the answer key to the browser.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Iterable

from sqlalchemy.orm import Session

from .game import level_progress, rank_suffix, tier_for_level
from .services.shop import cosmetic_ref as cosmetics_public
from .services import season as season_ladder
from .models import (
    Activity,
    utcnow,
    Attempt,
    Badge,
    Course,
    Duel,
    DuelParticipant,
    Notification,
    Prize,
    PrizeClaim,
    Question,
    Quiz,
    Student,
    StudentBadge,
)


def iso(value: datetime | date | None) -> str | None:
    """ISO-8601 with a trailing Z (all stored timestamps are naive UTC)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value.isoformat(timespec="seconds") + "Z"
    return value.isoformat()


def mask_phone(phone: str) -> str:
    if len(phone) < 7:
        return phone
    return f"{phone[:4]} *** {phone[-3:]}"


def initials(name: str) -> str:
    parts = [p for p in name.split() if p]
    return "".join(p[0] for p in parts[:2]).upper() or "?"


# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------
def student_public(student: Student, *, viewer_id: int | None = None, mask: bool = True) -> dict[str, Any]:
    is_self = viewer_id is not None and viewer_id == student.id
    progress = level_progress(student.xp)
    return {
        "id": student.id,
        "name": student.name,
        "initials": initials(student.name),
        "phone": student.phone if is_self or not mask else mask_phone(student.phone),
        "avatar_hue": student.avatar_hue,
        "has_photo": bool(student.photo),
        "cosmetics": cosmetics_public(student),
        "bio": student.bio,
        "status_text": student.status_text,
        "flair": student.flair,
        "level": progress["level"],
        "title": progress["title"],
        "tier": tier_for_level(progress["level"]),
        "xp": student.xp,
        "coins": student.coins,
        "streak": student.streak,
        "duels_won": student.duels_won,
        "duels_played": student.duels_played,
        "exams_taken": student.exams_taken,
        "best_percentage": round(student.best_percentage, 2),
    }


def student_profile(db: Session, student: Student) -> dict[str, Any]:
    progress = level_progress(student.xp)
    badges = db.query(StudentBadge).filter(StudentBadge.student_id == student.id).all()
    owned: list[dict[str, Any]] = []
    for row in badges:
        badge: Badge = row.badge
        owned.append(
            {
                "key": badge.key,
                "name": badge.name,
                "description": badge.description,
                "icon": badge.icon,
                "tier": badge.tier,
                "awarded_at": iso(row.awarded_at),
            }
        )
    accuracy = (student.correct_answers / student.questions_answered * 100) if student.questions_answered else 0.0
    win_rate = (student.duels_won / student.duels_played * 100) if student.duels_played else 0.0
    return {
        "id": student.id,
        "name": student.name,
        "initials": initials(student.name),
        "username": student.username,
        "phone": student.phone,
        "bio": student.bio,
        "status_text": student.status_text,
        "player_code": student.player_code,
        "flair": student.flair,
        "helper_points": student.helper_points,
        "streak_freezes": student.streak_freezes,
        "xp_boosted": bool(student.xp_boost_until and student.xp_boost_until > utcnow()),
        "reg_no": student.reg_no,
        "faculty": student.faculty,
        "campus": student.campus,
        "class_name": student.class_name,
        "level_name": student.level,
        "avatar_hue": student.avatar_hue,
        "has_photo": bool(student.photo),
        "xp": student.xp,
        "coins": student.coins,
        "diamonds": int(getattr(student, "diamonds", 0) or 0),
        "cosmetics": cosmetics_public(student),
        "weekly_xp": student.weekly_xp,
        "week_key": student.week_key,
        "streak": student.streak,
        "best_streak": student.best_streak,
        "last_active": iso(student.last_active),
        "progress": progress,
        "tier": tier_for_level(progress["level"]),
        "stats": {
            "exams_taken": student.exams_taken,
            "exams_won": student.exams_won,
            "best_percentage": round(student.best_percentage, 2),
            "duels_played": student.duels_played,
            "duels_won": student.duels_won,
            "duels_lost": student.duels_lost,
            "duel_win_rate": round(win_rate, 1),
            "correct_answers": student.correct_answers,
            "questions_answered": student.questions_answered,
            "accuracy": round(accuracy, 1),
            "best_run": student.best_run,
        },
        "badges": owned,
        # The season badge the player is wearing right now. Derived and
        # read-only: it cannot create a season row by being fetched.
        "season": season_ladder.badge_block(db, student),
        "created_at": iso(student.created_at),
    }


def leaderboard_row(student: Student, rank: int, *, value_key: str = "xp") -> dict[str, Any]:
    progress = level_progress(student.xp)
    return {
        "rank": rank,
        "rank_label": rank_suffix(rank),
        "id": student.id,
        "name": student.name,
        "initials": initials(student.name),
        "avatar_hue": student.avatar_hue,
        "has_photo": bool(student.photo),
        "cosmetics": cosmetics_public(student),
        "level": progress["level"],
        "title": progress["title"],
        "tier": tier_for_level(progress["level"]),
        "value": getattr(student, value_key, student.xp),
        "xp": student.xp,
        "coins": student.coins,
        "streak": student.streak,
        "duels_won": student.duels_won,
        "best_percentage": round(student.best_percentage, 2),
    }


# ---------------------------------------------------------------------------
# Content
# ---------------------------------------------------------------------------
def question_public(
    question: Question,
    *,
    reveal: bool = False,
    order: list[str] | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Player-facing question payload.

    ``order`` is the display order of the canonical option keys. Option
    shuffling never rewrites ``Question.correct`` — the payload always carries
    the authoritative answer, plus the display label it currently sits on.
    """
    from .services.questions import question_student_public

    return question_student_public(question, reveal=reveal, order=order, extra=extra)


def course_public(course: Course, *, quiz_count: int = 0) -> dict[str, Any]:
    return {
        "id": course.id,
        "code": course.code,
        "title": course.title,
        "description": course.description,
        "credit_units": course.credit_units,
        "semester": course.semester,
        "lecturer": course.lecturer,
        "accent": course.accent,
        "is_active": course.is_active,
        "quiz_count": quiz_count,
    }


def quiz_public(
    quiz: Quiz,
    *,
    reveal: bool = False,
    questions: bool = False,
    submission_count: int | None = None,
    my_attempt: Attempt | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": quiz.id,
        "title": quiz.title,
        "instructions": quiz.instructions,
        "duration_minutes": quiz.duration_minutes,
        "status": quiz.status,
        "scheduled_at": iso(quiz.scheduled_at),
        "end_at": iso(quiz.end_at),
        "shuffle_questions": quiz.shuffle_questions,
        "shuffle_options": bool(getattr(quiz, "shuffle_options", False)),
        "allow_duel": quiz.allow_duel,
        "rules": getattr(quiz, "rules", "") or "",
        "version_label": getattr(quiz, "version_label", "") or "",
        "per_question_seconds": int(getattr(quiz, "per_question_seconds", 0) or 0),
        "grace_seconds": int(getattr(quiz, "grace_seconds", 0) or 0),
        "auto_submit": bool(getattr(quiz, "auto_submit", True)),
        "calculator": bool(getattr(quiz, "calculator", False)),
        "review_before_submit": bool(getattr(quiz, "review_before_submit", True)),
        "max_attempts": int(getattr(quiz, "max_attempts", 1) or 0),
        "practice_mode": bool(getattr(quiz, "practice_mode", False)),
        "question_count": len([q for q in quiz.questions if getattr(q, "visible", True)]),
        "created_at": iso(quiz.created_at),
        "course": course_public(quiz.course) if quiz.course else None,
    }
    if submission_count is not None:
        payload["submission_count"] = submission_count
    if my_attempt is not None:
        payload["my_attempt"] = attempt_summary(my_attempt)
    if questions:
        payload["questions"] = [question_public(q, reveal=reveal) for q in quiz.questions]
    return payload


def _question_clock(attempt: Attempt, question: Question) -> dict[str, Any]:
    """Per-question countdown fields for the exam screen (server-stamped)."""
    from .services.exam import per_question_seconds, question_seconds_left

    budget = int(getattr(question, "time_limit_seconds", 0) or 0) or per_question_seconds(attempt)
    extra: dict[str, Any] = {"time_limit_seconds": budget}
    if budget:
        left = question_seconds_left(attempt, question)
        extra["seconds_left"] = budget if left is None else min(left, budget)
    return extra


def _attempt_order(attempt: Attempt, question: Question) -> list[str]:
    stored = (getattr(attempt, "option_orders", None) or {}).get(str(question.id))
    if stored:
        return [key for key in stored if key in question.options]
    return [key for key in ("A", "B", "C", "D") if (question.options.get(key) or "").strip()]


def _review_options(attempt: Attempt, question: Question) -> dict[str, str]:
    """Review options keyed by the display letter the player saw."""
    order = _attempt_order(attempt, question)
    payload = {("ABCD"[index] if index < 4 else key): (question.options.get(key) or "") for index, key in enumerate(order)}
    return {key: value for key, value in payload.items() if value}


def _label_for(attempt: Attempt, question: Question, canonical: str | None) -> str | None:
    order = _attempt_order(attempt, question)
    for position, key in enumerate(order):
        if key == canonical:
            return "ABCD"[position] if position < 4 else None
    return canonical or None


def attempt_summary(attempt: Attempt) -> dict[str, Any]:
    return {
        "id": attempt.id,
        "quiz_id": attempt.quiz_id,
        "status": attempt.status,
        "started_at": iso(attempt.started_at),
        "deadline_at": iso(attempt.deadline_at),
        "submitted_at": iso(attempt.submitted_at),
        "score": attempt.score,
        "percentage": round(attempt.percentage, 2),
        "grade": attempt.grade,
        "correct_count": attempt.correct_count,
        "wrong_count": attempt.wrong_count,
        "unanswered_count": attempt.unanswered_count,
        "submission_type": attempt.submission_type,
        "xp_awarded": attempt.xp_awarded,
        "coins_awarded": attempt.coins_awarded,
    }


def attempt_state(
    db: Session,
    attempt: Attempt,
    *,
    questions: list[Question],
    reveal: bool = False,
    rank: int | None = None,
    time_remaining: int = 0,
) -> dict[str, Any]:
    answers = {row.question_id: row for row in attempt.answers}
    payload = attempt_summary(attempt)
    payload.update(
        {
            "time_remaining": time_remaining,
            "rank": rank,
            "rank_label": rank_suffix(rank) if rank else None,
            "quiz": quiz_public(attempt.quiz),
            "option_shuffle": bool(getattr(attempt, "shuffle_options", False)),
            "per_question_seconds": int(getattr(attempt.quiz, "per_question_seconds", 0) or 0),
            "questions": [
                question_public(
                    q,
                    reveal=reveal,
                    order=_attempt_order(attempt, q),
                    extra=_question_clock(attempt, q),
                )
                for q in questions
            ],
            "answers": [
                {
                    "question_id": row.question_id,
                    "selected": row.selected,
                    "flagged": row.flagged,
                    "seconds_spent": round(row.seconds_spent, 1),
                    **({"is_correct": row.is_correct} if reveal else {}),
                }
                for row in answers.values()
            ],
            "review": (
                [
                    {
                        "question_id": q.id,
                        "text": q.text,
                        # Display order, not canonical order: the review must use
                        # the same A–D letters the player actually saw.
                        "options": _review_options(attempt, q),
                        "display_order": _attempt_order(attempt, q),
                        "correct": q.correct,
                        "correct_label": _label_for(attempt, q, q.correct),
                        "explanation": q.explanation,
                        "selected": answers[q.id].selected if q.id in answers else None,
                        "selected_label": _label_for(attempt, q, answers[q.id].selected) if q.id in answers else None,
                        "is_correct": bool(answers[q.id].is_correct) if q.id in answers else False,
                    }
                    for q in questions
                ]
                if reveal
                else []
            ),
        }
    )
    return payload


# ---------------------------------------------------------------------------
# Duels
# ---------------------------------------------------------------------------
def duel_participant(participant: DuelParticipant, *, viewer_id: int | None = None, reveal: bool = False) -> dict[str, Any]:
    student = participant.student
    payload = {
        "student_id": participant.student_id,
        "seat": participant.seat,
        "name": student.name if student else "Unknown",
        "initials": initials(student.name) if student else "?",
        "avatar_hue": student.avatar_hue if student else 265,
        "has_photo": bool(student.photo) if student else False,
        "cosmetics": cosmetics_public(student) if student else {},
        "level": level_progress(student.xp)["level"] if student else 1,
        "score": participant.score,
        "correct_count": participant.correct_count,
        "answered_count": participant.answered_count,
        "best_run": participant.best_run,
        "forfeited": participant.forfeited,
        "finished_at": iso(participant.finished_at),
        "is_you": viewer_id is not None and viewer_id == participant.student_id,
    }
    if reveal and student:
        payload["xp"] = student.xp
        payload["duels_won"] = student.duels_won
    return payload


def duel_public(
    duel: Duel,
    *,
    viewer_id: int | None = None,
    include_questions: bool = False,
    reveal: bool = False,
) -> dict[str, Any]:
    participants = [duel_participant(p, viewer_id=viewer_id, reveal=reveal) for p in duel.participants]
    payload: dict[str, Any] = {
        "id": duel.id,
        "code": duel.code,
        "topic": duel.topic,
        "quiz_id": duel.quiz_id,
        "course_id": duel.course_id,
        "status": duel.status,
        "question_count": duel.question_count,
        "stake_coins": duel.stake_coins,
        "time_limit_seconds": duel.time_limit_seconds,
        "visibility": getattr(duel, "visibility", "private") or "private",
        # Server-paced round clock — clients display these, never derive them.
        "round_index": int(getattr(duel, "round_index", -1)) if getattr(duel, "round_index", None) is not None else -1,
        "round_deadline": iso(getattr(duel, "round_deadline_at", None)) if getattr(duel, "round_deadline_at", None) else None,
        "round_opened": iso(getattr(duel, "round_opened_at", None)) if getattr(duel, "round_opened_at", None) else None,
        "server_now": iso(utcnow()),
        "mode": getattr(duel, "mode", "casual") or "casual",
        "best_of": int(getattr(duel, "best_of", 1) or 1),
        "series_id": getattr(duel, "series_id", "") or "",
        "game_index": int(getattr(duel, "game_index", 1) or 1),
        "rematch_of": getattr(duel, "rematch_of", None),
        "difficulty": getattr(duel, "difficulty", "") or "",
        "topic_filter": getattr(duel, "topic_filter", "") or "",
        "sudden_death": bool(getattr(duel, "sudden_death", False)),
        "tournament_id": getattr(duel, "tournament_id", None),
        "winner_id": duel.winner_id,
        "created_at": iso(duel.created_at),
        "started_at": iso(duel.started_at),
        "finished_at": iso(duel.finished_at),
        "expires_at": iso(duel.expires_at),
        "participants": participants,
        "is_yours": any(p["is_you"] for p in participants),
    }
    challenger = next((p for p in duel.participants if p.seat == "challenger"), None)
    if challenger is not None and challenger.student is not None:
        payload["challenger_name"] = challenger.student.name

    if include_questions:
        # Only the viewer's own selections are exposed; the answer key stays
        # hidden until the duel is finished (reveal=True).
        mine = {row.question_id: row for row in duel.answers if viewer_id is not None and row.student_id == viewer_id}
        payload["questions"] = [
            {
                **question_public(row.question, reveal=reveal),
                "order": row.position,
                "answered_by_you": row.question_id in mine,
                "my_selection": mine[row.question_id].selected if row.question_id in mine else None,
                "my_points": mine[row.question_id].points if row.question_id in mine else 0,
            }
            for row in duel.questions
        ]
        payload["my_answers"] = [
            {
                "question_id": row.question_id,
                "selected": row.selected,
                "is_correct": row.is_correct,
                "points": row.points,
                "elapsed_ms": row.elapsed_ms,
            }
            for row in mine.values()
        ]
    return payload


# ---------------------------------------------------------------------------
# Misc
# ---------------------------------------------------------------------------
def notification_public(item: Notification) -> dict[str, Any]:
    return {
        "id": item.id,
        "title": item.title,
        "message": item.message,
        "kind": item.kind,
        "target_course": item.target_course,
        "author": item.author,
        "is_pinned": item.is_pinned,
        "created_at": iso(item.created_at),
    }


def prize_public(prize: Prize, *, eligible: bool = False, claimed: bool = False) -> dict[str, Any]:
    return {
        "id": prize.id,
        "title": prize.title,
        "description": prize.description,
        "tier": prize.tier,
        "kind": prize.kind,
        "min_rank": prize.min_rank,
        "max_rank": prize.max_rank,
        "cost_coins": prize.cost_coins,
        "icon": prize.icon,
        "stock": prize.stock,
        "is_active": prize.is_active,
        "sort_order": prize.sort_order,
        "eligible": eligible,
        "claimed": claimed,
        "claims": len(prize.claims),
    }


def claim_public(claim: PrizeClaim) -> dict[str, Any]:
    return {
        "id": claim.id,
        "prize": prize_public(claim.prize),
        "student": student_public(claim.student),
        "status": claim.status,
        "note": claim.note,
        "created_at": iso(claim.created_at),
    }


def activity_public(activity: Activity) -> dict[str, Any]:
    return {
        "id": activity.id,
        "kind": activity.kind,
        "title": activity.title,
        "detail": activity.detail,
        "amount": activity.amount,
        "created_at": iso(activity.created_at),
    }


def badge_public(badge: Badge, *, owned: bool = False) -> dict[str, Any]:
    return {
        "key": badge.key,
        "name": badge.name,
        "description": badge.description,
        "icon": badge.icon,
        "tier": badge.tier,
        "xp_reward": badge.xp_reward,
        "coin_reward": badge.coin_reward,
        "owned": owned,
    }


def many(rows: Iterable[Any]) -> list[dict[str, Any]]:
    return list(rows)
