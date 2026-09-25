"""Study Lab engine — weak-topic detection, learning paths, the mistake book.

Everything here reads data the rest of the arena already writes (PlayerMastery
is fed by exams, practice, duels and events), so a topic only shows up as
"weak" when there is real evidence behind it. One wrong answer never labels
anyone; a handful of right answers never "masters" a topic either.
"""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (
    Material,
    MaterialSection,
    PlayerMastery,
    Question,
    StudyMistake,
    StudyPath,
    utcnow,
)

# How much evidence we demand before judging a topic, and the accuracy bar.
MIN_EVIDENCE = 6
WEAK_ACCURACY = 0.6
MASTERED_ACCURACY = 0.9
MASTERED_EVIDENCE = 14

STAGE_ORDER = ["understand", "learn", "practice", "review", "again", "check", "mastered"]

STATE_LABELS = {
    "needs_study": "Needs study",
    "learning": "Learning",
    "practicing": "Practicing",
    "improving": "Improving",
    "strong": "Strong",
    "mastered": "Mastered",
}


# ---------------------------------------------------------------------------
# Hooks — called from every grading surface (exam, practice, duel, event…)
# ---------------------------------------------------------------------------
def record_mistake(db: Session, student_id: int, question: Question, *, selected: str, source: str) -> None:
    """File a wrong answer so the topic review + weakness score can see it.

    Repeated mistakes on the same question count double — that repetition is
    exactly the "they keep missing this" signal the recommendation needs.
    """
    topic = str(question.topic or "").strip()[:120]
    if not topic:
        return
    row = db.scalar(
        select(StudyMistake).where(StudyMistake.student_id == student_id, StudyMistake.question_id == question.id)
    )
    if row is None:
        row = StudyMistake(
            student_id=student_id,
            question_id=question.id,
            topic=topic,
            selected=(selected or "")[:8],
            correct_key=(question.correct or "")[:8],
            explanation=(question.explanation or "")[:1000],
            source=source,
        )
        db.add(row)
    else:
        row.hits = (row.hits or 0) + 1
        row.selected = (selected or "")[:8]
        row.correct_key = (question.correct or "")[:8]
        row.explanation = (question.explanation or "")[:1000]
        row.resolved = False
        row.last_at = utcnow()
    db.flush()


def resolve_mistake(db: Session, student_id: int, question_id: int) -> None:
    """A later correct answer retires the mistake from the review stack."""
    row = db.scalar(
        select(StudyMistake).where(StudyMistake.student_id == student_id, StudyMistake.question_id == question_id)
    )
    if row is not None and not row.resolved:
        row.resolved = True
        db.flush()


def topic_stats(db: Session, student_id: int) -> dict[str, dict[str, float]]:
    """Accuracy per topic from the mastery ledger, plus mistake pressure."""
    rows = db.scalars(
        select(PlayerMastery).where(PlayerMastery.student_id == student_id, PlayerMastery.scope_type == "topic")
    ).all()
    stats: dict[str, dict[str, float]] = {}
    for row in rows:
        accuracy = (row.correct / row.answered) if row.answered else 0.0
        stats[row.scope_key] = {
            "answered": int(row.answered or 0),
            "correct": int(row.correct or 0),
            "wrong": int(max(0, (row.answered or 0) - (row.correct or 0))),
            "accuracy": round(accuracy, 4),
            "mastery": float(row.mastery or 0.0),
        }
    # Mistake heat: how often a topic is missed, and how often *repeatedly*.
    heat = db.execute(
        select(StudyMistake.topic, func.count(StudyMistake.id), func.sum(func.max(StudyMistake.hits - 1, 0)))
        .where(StudyMistake.student_id == student_id, StudyMistake.resolved.is_(False))
        .group_by(StudyMistake.topic)
    ).all()
    for topic, open_count, repeat_count in heat:
        entry = stats.setdefault(
            topic, {"answered": 0, "correct": 0, "wrong": int(open_count or 0), "accuracy": 0.0, "mastery": 0.0}
        )
        entry["open_mistakes"] = int(open_count or 0)
        entry["repeat_mistakes"] = int(repeat_count or 0)
    return stats


def weakness(stats: dict[str, float]) -> float:
    """A 0-100 weakness score. Needs evidence; punishes repeats."""
    answered = int(stats.get("answered", 0))
    accuracy = float(stats.get("accuracy", 0.0))
    repeats = int(stats.get("repeat_mistakes", 0))
    opens = int(stats.get("open_mistakes", 0))
    if answered < MIN_EVIDENCE and opens < 2:
        return 0.0
    evidence = min(1.0, answered / 20.0) if answered else 0.15
    miss = 1.0 - accuracy
    return round(100 * min(1.0, evidence * (0.75 * miss + 0.15 * min(1.0, opens / 6) + 0.10 * min(1.0, repeats / 3))), 1)


def weak_topics(db: Session, student_id: int, limit: int = 6) -> list[dict]:
    stats = topic_stats(db, student_id)
    paths = {row.topic: row for row in db.scalars(select(StudyPath).where(StudyPath.student_id == student_id)).all()}
    scored = []
    for topic, values in stats.items():
        score = weakness(values)
        if score <= 0:
            continue
        scored.append((score, topic, values))
    scored.sort(key=lambda item: (-item[0], item[1]))
    out = []
    for score, topic, values in scored[:limit]:
        accuracy = values.get("accuracy", 0.0)
        answered = int(values.get("answered", 0))
        # A topic is only *labelled* weak with real evidence behind it —
        # otherwise it's just "keep practising" without the warning tone.
        proven = answered >= MIN_EVIDENCE and accuracy < WEAK_ACCURACY
        pool = int(
            db.scalar(
                select(func.count(Question.id)).where(
                    func.lower(Question.topic) == topic.lower(),
                    Question.status == "approved",
                    Question.visible.is_(True),
                )
            )
            or 0
        )
        path = paths.get(topic)
        out.append(
            {
                "topic": topic,
                "weak": bool(proven or int(values.get("repeat_mistakes", 0)) >= 2),
                "severity": score,
                "accuracy": round(accuracy * 100, 1),
                "answered": answered,
                "wrong": int(values.get("wrong", 0)),
                "open_mistakes": int(values.get("open_mistakes", 0)),
                "repeat_mistakes": int(values.get("repeat_mistakes", 0)),
                "pool": pool,
                "stage": path.stage if path else "understand",
                "state": state_of(topic, values, path),
            }
        )
    return out


def state_of(topic: str, values: dict[str, float], path: StudyPath | None) -> str:
    """Performance-based label — never cosmetic. `path` only nudges the
    in-between states; Strong/Mastered require the numbers to say so."""
    answered = int(values.get("answered", 0))
    accuracy = float(values.get("accuracy", 0.0))
    if path is not None and path.check_passed and accuracy >= WEAK_ACCURACY:
        return "mastered"
    if answered >= MASTERED_EVIDENCE and accuracy >= MASTERED_ACCURACY:
        return "mastered"
    if answered >= MASTERED_EVIDENCE and accuracy >= 0.8:
        return "strong"
    if answered >= MIN_EVIDENCE and accuracy >= WEAK_ACCURACY:
        return "improving"
    stage = path.stage if path else "understand"
    if stage in ("practice", "review", "again", "check"):
        return "practicing"
    if answered > 0 or stage in ("learn",):
        return "learning"
    return "needs_study"


def path_for(db: Session, student_id: int, topic: str, course_id: int | None = None) -> StudyPath:
    row = db.scalar(select(StudyPath).where(StudyPath.student_id == student_id, StudyPath.topic == topic))
    if row is None:
        row = StudyPath(student_id=student_id, topic=topic, course_id=course_id)
        db.add(row)
        db.flush()
    return row


def advance_stage(path: StudyPath, stage: str) -> None:
    """Stages only move forward; finishing a later stage implies the earlier ones."""
    if stage not in STAGE_ORDER or path.stage == "mastered":
        return
    if STAGE_ORDER.index(stage) > STAGE_ORDER.index(path.stage):
        path.stage = stage


def touch_practice_day(path: StudyPath) -> int:
    """Record today for the practice streak; returns current consecutive days."""
    today = utcnow().date().isoformat()
    days = [d for d in (path.practice_days or []) if str(d)]
    if today not in days:
        days.append(today)
        days = sorted(days)[-120:]
        path.practice_days = days
    streak = 0
    cursor = utcnow().date()
    seen = {str(d) for d in days}
    while cursor.isoformat() in seen:
        streak += 1
        cursor = cursor - timedelta(days=1)
    return streak


def topic_materials(db: Session, topic: str, course_id: int | None = None, limit: int = 4) -> list[dict]:
    stmt = select(Material).where(
        func.lower(Material.topic) == topic.lower(), Material.status == "published"
    )
    if course_id:
        stmt = stmt.where(Material.course_id == course_id)
    rows = list(db.scalars(stmt.order_by(Material.updated_at.desc()).limit(limit)).all())
    out = []
    for material in rows:
        sections = db.scalars(
            select(MaterialSection).where(MaterialSection.material_id == material.id).order_by(MaterialSection.position)
        ).all()
        out.append(
            {
                "id": material.id,
                "title": material.title,
                "topic": material.topic,
                "difficulty": material.difficulty,
                "estimated_minutes": material.estimated_minutes,
                "summary": material.summary if isinstance(material.summary, list) else [],
                "sections": [
                    {"id": s.id, "position": s.position, "title": s.title, "minutes": s.estimated_minutes}
                    for s in sections
                ],
            }
        )
    return out


def common_mistakes(db: Session, student_id: int, topic: str, limit: int = 3) -> list[dict]:
    rows = db.scalars(
        select(StudyMistake)
        .where(StudyMistake.student_id == student_id, StudyMistake.topic == topic, StudyMistake.resolved.is_(False))
        .order_by(StudyMistake.hits.desc(), StudyMistake.last_at.desc())
        .limit(limit)
    ).all()
    return [
        {
            "question_id": row.question_id,
            "selected": row.selected,
            "correct_key": row.correct_key,
            "hits": row.hits,
            "source": row.source,
        }
        for row in rows
    ]


def overview(db: Session, student_id: int) -> dict:
    stats = topic_stats(db, student_id)
    paths = {row.topic: row for row in db.scalars(select(StudyPath).where(StudyPath.student_id == student_id)).all()}
    weak = weak_topics(db, student_id)
    in_progress = []
    mastered = []
    for topic, path in paths.items():
        values = stats.get(topic, {})
        state = state_of(topic, values, path)
        entry = {
            "topic": topic,
            "stage": path.stage,
            "state": state,
            "state_label": STATE_LABELS.get(state, state),
            "accuracy": round(float(values.get("accuracy", 0.0)) * 100, 1),
            "answered": int(values.get("answered", 0)),
            "progress": int(path.practice_correct or 0),
            "check_passed": bool(path.check_passed),
            "updated_at": path.updated_at.isoformat() + "Z" if path.updated_at else None,
        }
        if state == "mastered":
            mastered.append(entry)
        elif path.stage != "understand" or path.understood:
            in_progress.append(entry)
    in_progress.sort(key=lambda item: item["updated_at"] or "", reverse=True)
    mastered.sort(key=lambda item: item["accuracy"], reverse=True)
    streak = 0
    days: set[str] = set()
    for path in paths.values():
        days.update(str(d) for d in (path.practice_days or []))
    if days:
        cursor = utcnow().date()
        if cursor.isoformat() not in days:
            cursor = cursor - timedelta(days=1)  # today not practiced yet doesn't break the streak
        while cursor.isoformat() in days:
            streak += 1
            cursor = cursor - timedelta(days=1)
    open_mistakes = int(
        db.scalar(
            select(func.count(StudyMistake.id)).where(
                StudyMistake.student_id == student_id, StudyMistake.resolved.is_(False)
            )
        )
        or 0
    )
    recommended = weak[0]["topic"] if weak else (in_progress[0]["topic"] if in_progress else None)
    return {
        "weak_topics": weak,
        "recommended": recommended,
        "in_progress": in_progress[:10],
        "mastered": mastered[:10],
        "topics_known": len(stats),
        "streak_days": streak,
        "open_mistakes": open_mistakes,
        "continue": in_progress[0] if in_progress else None,
        "server_now": utcnow().isoformat() + "Z",
    }
