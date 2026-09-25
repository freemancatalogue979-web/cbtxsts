"""Personal performance dashboard and the smart "what to study next" engine."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from .. import game
from ..db import get_db
from ..deps import require_student
from ..models import (
    Activity,
    Answer,
    Attempt,
    Course,
    Duel,
    DuelParticipant,
    FlashcardReview,
    PlayerMastery,
    PracticeRun,
    Question,
    Quiz,
    RushRun,
    Student,
    utcnow,
)
from ..serializers import iso

router = APIRouter(prefix="/arena", tags=["arena"])


def _answer_rows(db: Session, student_id: int, since: date | None = None) -> list[tuple]:
    stmt = (
        select(Answer, Question, Attempt, Quiz)
        .join(Question, Question.id == Answer.question_id)
        .join(Attempt, Attempt.id == Answer.attempt_id)
        .join(Quiz, Quiz.id == Attempt.quiz_id)
        .where(Attempt.student_id == student_id, Answer.selected.is_not(None))
    )
    if since:
        stmt = stmt.where(Answer.answered_at >= since)
    return list(db.execute(stmt).all())


@router.get("/analytics")
def analytics(
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
    days: int = Query(30, ge=7, le=180),
) -> dict:
    """The whole personal dashboard in one round trip."""
    since = utcnow() - timedelta(days=days)
    rows = _answer_rows(db, student.id, since=since)
    total = len(rows)
    correct = sum(1 for row in rows if row[0].is_correct)

    by_day: dict[str, dict[str, Any]] = {}
    for answer, question, attempt, quiz in rows:
        day = answer.answered_at.date().isoformat()
        entry = by_day.setdefault(day, {"day": day, "answered": 0, "correct": 0, "seconds": 0.0})
        entry["answered"] += 1
        entry["correct"] += 1 if answer.is_correct else 0
        entry["seconds"] += float(answer.seconds_spent or 0)
    timeline = []
    for day, entry in sorted(by_day.items()):
        timeline.append(
            {
                "day": day,
                "answered": entry["answered"],
                "accuracy": round(entry["correct"] / entry["answered"] * 100, 1) if entry["answered"] else 0.0,
                "average_seconds": round(entry["seconds"] / entry["answered"], 1) if entry["answered"] else 0.0,
            }
        )

    by_topic: dict[str, dict[str, int]] = {}
    by_difficulty: dict[str, dict[str, int]] = {}
    by_course: dict[str, dict[str, int]] = {}
    for answer, question, attempt, quiz in rows:
        topic = (question.topic or "Untagged").strip() or "Untagged"
        entry = by_topic.setdefault(topic, {"answered": 0, "correct": 0, "seconds": 0.0})
        entry["answered"] += 1
        entry["correct"] += 1 if answer.is_correct else 0
        entry["seconds"] += float(answer.seconds_spent or 0)
        level = question.difficulty or "medium"
        diff = by_difficulty.setdefault(level, {"answered": 0, "correct": 0})
        diff["answered"] += 1
        diff["correct"] += 1 if answer.is_correct else 0
        course = quiz.course.code if quiz.course else "General"
        c_entry = by_course.setdefault(course, {"answered": 0, "correct": 0})
        c_entry["answered"] += 1
        c_entry["correct"] += 1 if answer.is_correct else 0

    def _scored(source: dict[str, dict[str, int]]) -> list[dict[str, Any]]:
        out = []
        for key, entry in source.items():
            answered = entry["answered"]
            out.append(
                {
                    "key": key,
                    "answered": answered,
                    "correct": entry["correct"],
                    "accuracy": round(entry["correct"] / answered * 100, 1) if answered else 0.0,
                    "average_seconds": round(entry.get("seconds", 0) / answered, 1) if answered else 0.0,
                }
            )
        return sorted(out, key=lambda item: item["accuracy"])

    topics = _scored(by_topic)
    difficulties = _scored(by_difficulty)
    courses = _scored(by_course)

    attempts = db.scalars(
        select(Attempt).where(Attempt.student_id == student.id, Attempt.status == "submitted").order_by(Attempt.submitted_at.desc())
    ).all()
    exam_trend = [
        {
            "attempt_id": attempt.id,
            "quiz": attempt.quiz.title if attempt.quiz else "",
            "percentage": round(attempt.percentage, 1),
            "grade": attempt.grade,
            "submitted_at": iso(attempt.submitted_at),
        }
        for attempt in attempts[:20]
    ][::-1]

    duels = db.scalars(
        select(Duel).where(Duel.status == "finished", Duel.participants.any(student_id=student.id)).order_by(Duel.id.desc()).limit(50)
    ).all()
    duel_wins = sum(1 for duel in duels if duel.winner_id == student.id)

    flashcard_reviews = db.scalars(
        select(FlashcardReview).where(FlashcardReview.student_id == student.id, FlashcardReview.created_at >= since)
    ).all()
    practice_runs = db.scalars(
        select(PracticeRun).where(PracticeRun.student_id == student.id, PracticeRun.created_at >= since)
    ).all()
    rush_runs = db.scalars(select(RushRun).where(RushRun.student_id == student.id).order_by(RushRun.id.desc()).limit(30)).all()

    xp_history = [
        {"day": row.created_at.date().isoformat(), "amount": row.amount, "title": row.title}
        for row in db.scalars(
            select(Activity)
            .where(Activity.student_id == student.id, Activity.kind == "xp")
            .order_by(Activity.created_at.desc())
            .limit(60)
        ).all()
    ]
    coin_history = [
        {"day": row.created_at.date().isoformat(), "title": row.title}
        for row in db.scalars(
            select(Activity).where(Activity.student_id == student.id, Activity.kind == "coin").order_by(Activity.created_at.desc()).limit(30)
        ).all()
    ]
    rank_now = int(db.scalar(select(func.count(Student.id)).where(Student.xp > student.xp, Student.is_banned.is_(False))) or 0) + 1

    score_distribution = [
        {"band": "0-49", "count": sum(1 for row in attempts if row.percentage < 50)},
        {"band": "50-59", "count": sum(1 for row in attempts if 50 <= row.percentage < 60)},
        {"band": "60-69", "count": sum(1 for row in attempts if 60 <= row.percentage < 70)},
        {"band": "70-79", "count": sum(1 for row in attempts if 70 <= row.percentage < 80)},
        {"band": "80-89", "count": sum(1 for row in attempts if 80 <= row.percentage < 90)},
        {"band": "90-100", "count": sum(1 for row in attempts if row.percentage >= 90)},
    ]

    avg_seconds = (
        sum(float(row[0].seconds_spent or 0) for row in rows) / total if total else 0.0
    )
    return {
        "window_days": days,
        "overview": {
            "answered": total,
            "correct": correct,
            "accuracy": round(correct / total * 100, 1) if total else 0.0,
            "average_seconds": round(avg_seconds, 2),
            "questions_per_day": round(total / days, 1),
            "exams": len(attempts),
            "duels": len(duels),
            "duel_wins": duel_wins,
            "flashcards_reviewed": len(flashcard_reviews),
            "practice_runs": len(practice_runs),
            "best_streak": student.best_streak,
            "streak": student.streak,
            "level": game.level_from_xp(student.xp),
            "title": game.title_for_level(game.level_from_xp(student.xp)),
            "rank": rank_now,
            "best_percentage": round(student.best_percentage, 1),
        },
        "accuracy_over_time": timeline,
        "speed_over_time": timeline,
        "weakest_topics": [row for row in topics if row["answered"] >= 2][:6],
        "strongest_topics": sorted([row for row in topics if row["answered"] >= 2], key=lambda item: -item["accuracy"])[:6],
        "difficulty": difficulties,
        "courses": courses,
        "exam_trend": exam_trend,
        "score_distribution": score_distribution,
        "xp_history": xp_history,
        "coin_history": coin_history,
        "flashcards": {
            "reviews": len(flashcard_reviews),
            "accuracy": round(
                sum(1 for row in flashcard_reviews if row.grade in {"good", "easy"}) / max(len(flashcard_reviews), 1) * 100, 1
            ),
        },
        "practice": {
            "runs": len(practice_runs),
            "accuracy": round(
                sum(row.correct for row in practice_runs) / max(sum(row.total for row in practice_runs), 1) * 100, 1
            ),
            "best_streak": max((row.best_streak for row in practice_runs), default=0),
        },
        "rush": {
            "runs": len(rush_runs),
            "best": max((row.score for row in rush_runs), default=0),
        },
        "mastery_heatmap": [
            {"topic": row.scope_key, "mastery": row.mastery, "answered": row.answered}
            for row in db.scalars(
                select(PlayerMastery).where(PlayerMastery.student_id == student.id, PlayerMastery.scope_type == "topic")
            ).all()
        ],
    }


@router.get("/study-plan")
def study_plan(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """What to study next: data-driven recommendations with ready-made actions."""
    since = utcnow() - timedelta(days=45)
    rows = _answer_rows(db, student.id, since=since)
    topic_stats: dict[str, dict[str, int]] = {}
    for answer, question, attempt, quiz in rows:
        topic = (question.topic or "").strip()
        if not topic:
            continue
        entry = topic_stats.setdefault(topic, {"answered": 0, "correct": 0, "wrong": 0})
        entry["answered"] += 1
        if answer.is_correct:
            entry["correct"] += 1
        else:
            entry["wrong"] += 1

    mastery_rows = {
        row.scope_key: row
        for row in db.scalars(
            select(PlayerMastery).where(PlayerMastery.student_id == student.id, PlayerMastery.scope_type == "topic")
        ).all()
    }
    ranked = sorted(
        topic_stats.items(),
        key=lambda item: (item[1]["correct"] / max(item[1]["answered"], 1), -item[1]["answered"]),
    )
    weak = []
    for topic, stats in ranked[:5]:
        accuracy = stats["correct"] / max(stats["answered"], 1) * 100
        mastery = mastery_rows.get(topic)
        pool = int(db.scalar(select(func.count(Question.id)).where(func.lower(Question.topic) == topic.lower())) or 0)
        weak.append(
            {
                "topic": topic,
                "accuracy": round(accuracy, 1),
                "answered": stats["answered"],
                "wrong": stats["wrong"],
                "mastery": mastery.mastery if mastery else 0.0,
                "pool": pool,
                "actions": [
                    {"kind": "practice", "label": "Practise now", "mode": "weak", "topic": topic},
                    {"kind": "flashcards", "label": "Make a deck", "topic": topic},
                    {"kind": "duel", "label": "Duel on this topic", "topic": topic},
                ],
            }
        )

    weakest_difficulty = None
    difficulty_stats: dict[str, dict[str, int]] = {}
    for answer, question, attempt, quiz in rows:
        entry = difficulty_stats.setdefault(question.difficulty or "medium", {"answered": 0, "correct": 0})
        entry["answered"] += 1
        entry["correct"] += 1 if answer.is_correct else 0
    if difficulty_stats:
        weakest_difficulty = min(
            (
                {"key": key, "accuracy": round(value["correct"] / max(value["answered"], 1) * 100, 1)}
                for key, value in difficulty_stats.items()
            ),
            key=lambda item: item["accuracy"],
        )

    unseen = db.scalars(
        select(Question).where(Question.status == "approved", Question.visible.is_(True), Question.source_id.is_(None), Question.exam_only.is_(False)).order_by(Question.id).limit(200)
    ).all()
    answered_ids = {row[1].id for row in rows}
    fresh_topics: dict[str, int] = {}
    for question in unseen:
        if question.id in answered_ids or not question.topic:
            continue
        fresh_topics[question.topic] = fresh_topics.get(question.topic, 0) + 1

    return {
        "generated_at": iso(utcnow()),
        "weak_topics": weak,
        "weakest_difficulty": weakest_difficulty,
        "strongest_topic": ranked[-1][0] if ranked else None,
        "unseen_topics": [
            {"topic": topic, "count": count}
            for topic, count in sorted(fresh_topics.items(), key=lambda item: -item[1])[:6]
        ],
        "recommendations": _recommendations(weak, difficulty_stats, student),
        "daily_goal": {"questions": 15, "done_today": _answered_today(db, student.id)},
    }


def _answered_today(db: Session, student_id: int) -> int:
    start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    return int(db.scalar(select(func.count(Answer.id)).where(Answer.attempt_id.in_(select(Attempt.id).where(Attempt.student_id == student_id)), Answer.answered_at >= start)) or 0)


def _recommendations(weak: list[dict], difficulties: dict[str, dict[str, int]], student: Student) -> list[dict]:
    out: list[dict] = []
    if weak:
        top = weak[0]
        out.append(
            {
                "kind": "practice",
                "title": f"Practise {top['topic']}",
                "detail": f"You are at {top['accuracy']}% on this topic — a {top['pool'] or 'few'}-question drill will move it.",
                "cta": "Start weak-topic drill",
                "mode": "weak",
                "topic": top["topic"],
            }
        )
    if difficulties:
        level = min(difficulties.items(), key=lambda item: item[1]["correct"] / max(item[1]["answered"], 1))
        if level[0] != "hard":
            out.append(
                {
                    "kind": "practice",
                    "title": f"Step up to {level[0]} questions",
                    "detail": "Sharpen the band you are currently weakest in.",
                    "cta": "Practise this difficulty",
                    "mode": "mixed",
                    "difficulty": level[0],
                }
            )
    if student.streak >= 3:
        out.append(
            {
                "kind": "streak",
                "title": f"Keep your {student.streak}-day streak alive",
                "detail": "A five-question sprint today keeps the flame burning.",
                "cta": "Quick sprint",
                "mode": "sprint5",
            }
        )
    out.append(
        {
            "kind": "boss",
            "title": "Face the daily boss",
            "detail": "Boss battles mix speed and accuracy — the best all-round training there is.",
            "cta": "Enter boss battle",
            "mode": "daily_boss",
        }
    )
    return out[:4]


@router.get("/report/weekly")
def weekly_report(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    return _report(db, student, days=7, label="Weekly report")


@router.get("/report/monthly")
def monthly_report(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    return _report(db, student, days=30, label="Monthly report")


def _report(db: Session, student: Student, *, days: int, label: str) -> dict:
    since = utcnow() - timedelta(days=days)
    rows = _answer_rows(db, student.id, since=since)
    correct = sum(1 for row in rows if row[0].is_correct)
    attempts = db.scalars(
        select(Attempt).where(Attempt.student_id == student.id, Attempt.status == "submitted", Attempt.submitted_at >= since)
    ).all()
    duels = db.scalars(
        select(Duel).where(Duel.status == "finished", Duel.finished_at >= since, Duel.participants.any(student_id=student.id))
    ).all()
    practice = db.scalars(
        select(PracticeRun).where(PracticeRun.student_id == student.id, PracticeRun.created_at >= since)
    ).all()
    cards = db.scalars(
        select(FlashcardReview).where(FlashcardReview.student_id == student.id, FlashcardReview.created_at >= since)
    ).all()
    xp_gained = int(
        db.scalar(
            select(func.coalesce(func.sum(Activity.amount), 0)).where(
                Activity.student_id == student.id, Activity.kind == "xp", Activity.created_at >= since
            )
        )
        or 0
    )
    day_counts: dict[str, int] = {}
    for answer, *_ in rows:
        day = answer.answered_at.date().isoformat()
        day_counts[day] = day_counts.get(day, 0) + 1
    return {
        "label": label,
        "days": days,
        "answered": len(rows),
        "correct": correct,
        "accuracy": round(correct / len(rows) * 100, 1) if rows else 0.0,
        "exams": len(attempts),
        "duels": len(duels),
        "duel_wins": sum(1 for duel in duels if duel.winner_id == student.id),
        "practice_runs": len(practice),
        "flashcards": len(cards),
        "xp_gained": xp_gained,
        "active_days": len(day_counts),
        "best_day": max(day_counts.items(), key=lambda item: item[1]) if day_counts else None,
        "highlights": [
            f"{len(rows)} questions answered" if rows else "No questions answered yet",
            f"{len(attempts)} exam{'s' if len(attempts) != 1 else ''} submitted",
            f"{sum(1 for duel in duels if duel.winner_id == student.id)} duel wins",
            f"{xp_gained} XP earned",
        ],
    }


@router.get("/heatmap")
def heatmap(db: Session = Depends(get_db), student: Student = Depends(require_student), days: int = Query(90, ge=14, le=365)) -> dict:
    since = utcnow() - timedelta(days=days)
    rows = db.execute(
        select(Answer.answered_at, Answer.is_correct)
        .join(Attempt, Attempt.id == Answer.attempt_id)
        .where(Attempt.student_id == student.id, Answer.answered_at >= since)
    ).all()
    buckets: dict[str, dict[str, int]] = {}
    for answered_at, is_correct in rows:
        day = answered_at.date().isoformat()
        entry = buckets.setdefault(day, {"day": day, "answered": 0, "correct": 0})
        entry["answered"] += 1
        entry["correct"] += 1 if is_correct else 0
    return {
        "days": days,
        "data": [
            {**entry, "intensity": min(4, entry["answered"] // 5) if entry["answered"] else 0}
            for entry in sorted(buckets.values(), key=lambda item: item["day"])
        ],
    }
