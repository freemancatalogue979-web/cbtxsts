"""Student learning intelligence built only from server-graded evidence.

This is the shared decision layer for dashboards, adaptive practice and the AI
Tutor.  It deliberately does not ask a language model to invent mastery: every
score and recommendation is derived from persisted answers, Study Lab runs,
practice runs and the mistake ledger.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from math import exp
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Course, PlayerMastery, Question, Student, StudyMistake, StudyPath
from .ai_tutor import refresh_topic_progress

WEAK_BELOW = 60.0
DEVELOPING_BELOW = 75.0
MIN_EVIDENCE = 3


def _confidence(attempted: int) -> float:
    """Evidence confidence rises quickly, but never claims certainty."""
    if attempted <= 0:
        return 0.0
    return round(min(96.0, 100.0 * (1.0 - exp(-attempted / 8.0))), 1)


def _status(mastery: float, attempted: int) -> str:
    if attempted < MIN_EVIDENCE:
        return "emerging"
    if mastery < 40:
        return "critical"
    if mastery < WEAK_BELOW:
        return "weak"
    if mastery < DEVELOPING_BELOW:
        return "developing"
    return "mastered"


def _session(topic: str, mastery: float, confidence: float, pool: int) -> dict[str, Any]:
    # Students with lower mastery receive more teaching before independent work.
    review = 12 if mastery < 40 else 8
    guided = 12 if mastery < 60 else 8
    practice = 15
    assessment = 7
    total = review + guided + practice + assessment
    size = max(5, min(15, pool, 12 if mastery < 60 else 8)) if pool else 0
    return {
        "title": f"Repair {topic}",
        "topic": topic,
        "duration_minutes": total,
        "question_count": size,
        "adaptive": True,
        "steps": [
            {"kind": "concept_review", "label": "Concept review", "minutes": review},
            {"kind": "guided_examples", "label": "Guided examples", "minutes": guided},
            {"kind": "adaptive_practice", "label": "Targeted questions", "minutes": practice, "questions": size},
            {"kind": "reassessment", "label": "Mini reassessment", "minutes": assessment},
        ],
        "success": {"target_mastery": min(85, max(65, round(mastery + 15))), "minimum_questions": min(5, size)},
        "available": pool > 0,
        "reason": f"{round(mastery)}% mastery with {round(confidence)}% evidence confidence",
    }


def build_profile(db: Session, student: Student) -> dict[str, Any]:
    progress = refresh_topic_progress(db, student)
    courses = {row.id: row for row in db.scalars(select(Course)).all()}
    mastery_rows = {
        row.scope_key.lower(): row
        for row in db.scalars(
            select(PlayerMastery).where(PlayerMastery.student_id == student.id, PlayerMastery.scope_type == "topic")
        ).all()
    }

    pools = dict(
        db.execute(
            select(Question.topic, func.count(Question.id))
            .where(
                Question.status == "approved",
                Question.visible.is_(True),
                Question.practice_enabled.is_(True),
                Question.exam_only.is_(False),
                Question.source_id.is_(None),
                Question.topic != "",
            )
            .group_by(Question.topic)
        ).all()
    )

    mistake_rows = db.execute(
        select(StudyMistake, Question)
        .join(Question, Question.id == StudyMistake.question_id)
        .where(StudyMistake.student_id == student.id, StudyMistake.resolved.is_(False))
        .order_by(StudyMistake.hits.desc(), StudyMistake.last_at.desc())
    ).all()
    mistakes_by_topic: dict[str, list[tuple[StudyMistake, Question]]] = defaultdict(list)
    for mistake, question in mistake_rows:
        mistakes_by_topic[(mistake.topic or question.topic or "General").strip().lower()].append((mistake, question))

    paths = {
        row.topic.lower(): row
        for row in db.scalars(select(StudyPath).where(StudyPath.student_id == student.id)).all()
    }

    topics: list[dict[str, Any]] = []
    for row in progress:
        attempted = int(row.attempted or 0)
        confidence = _confidence(attempted)
        # Accuracy is the transparent student-facing score. PlayerMastery is
        # included as corroborating evidence, not allowed to silently replace it.
        raw_accuracy = float(row.accuracy or 0.0)
        ledger = mastery_rows.get((row.topic or "").lower())
        mastery = round((raw_accuracy * 0.7) + (float(ledger.mastery) * 0.3), 1) if ledger and ledger.answered else round(raw_accuracy, 1)
        status = _status(mastery, attempted)
        misses = mistakes_by_topic.get((row.topic or "").lower(), [])
        pattern_counts: Counter[str] = Counter()
        sources: Counter[str] = Counter()
        repeated = 0
        for mistake, question in misses:
            repeated += max(1, int(mistake.hits or 1))
            sources[mistake.source or "practice"] += 1
            label = (question.subtopic or question.objective or "").strip()
            if not label and isinstance(question.tags, list):
                label = next((str(tag).strip() for tag in question.tags if str(tag).strip()), "")
            pattern_counts[label or ("Hard-question reasoning" if question.difficulty == "hard" else "Concept application")] += max(1, int(mistake.hits or 1))
        patterns = [
            {"label": label, "count": count, "kind": "repeated_miss"}
            for label, count in pattern_counts.most_common(3)
        ]
        if not patterns and status in {"critical", "weak"}:
            patterns = [{"label": "Low topic accuracy", "count": max(1, attempted - int(row.correct or 0)), "kind": "accuracy"}]
        course = courses.get(row.course_id)
        pool = int(pools.get(row.topic, 0) or 0)
        path = paths.get((row.topic or "").lower())
        urgency = round((100 - mastery) * (0.45 + confidence / 180) + min(20, repeated * 2), 1)
        topics.append(
            {
                "topic": row.topic,
                "topic_id": row.topic_id,
                "course_id": row.course_id,
                "course": {"code": course.code, "title": course.title} if course else None,
                "mastery": mastery,
                "accuracy": raw_accuracy,
                "confidence": confidence,
                "status": status,
                "attempted": attempted,
                "correct": int(row.correct or 0),
                "incorrect": int(row.incorrect or 0),
                "last_evidence_at": row.last_attempted.isoformat() if row.last_attempted else None,
                "open_mistakes": len(misses),
                "repeated_misses": repeated,
                "error_patterns": patterns,
                "evidence_sources": dict(sources),
                "question_pool": pool,
                "study_stage": path.stage if path else "not_started",
                "urgency": urgency,
                "recommended_session": _session(row.topic, mastery, confidence, pool),
            }
        )

    topics.sort(key=lambda item: (-item["urgency"], item["mastery"], -item["attempted"]))
    actionable = [row for row in topics if row["attempted"] >= MIN_EVIDENCE and row["status"] in {"critical", "weak", "developing"}]
    primary = next((row for row in actionable if row["question_pool"] > 0), actionable[0] if actionable else None)
    total_attempted = sum(row["attempted"] for row in topics)
    weighted = sum(row["mastery"] * row["attempted"] for row in topics)
    overall = round(weighted / total_attempted, 1) if total_attempted else 0.0
    readiness = "ready" if overall >= 75 and not any(row["status"] == "critical" for row in topics) else "building" if overall >= 55 else "needs_attention"

    if primary:
        next_action = {
            "kind": "weakness_session",
            "title": primary["recommended_session"]["title"],
            "detail": f"{primary['mastery']:.0f}% mastery · {primary['open_mistakes']} open mistake{'s' if primary['open_mistakes'] != 1 else ''}",
            "topic": primary["topic"],
            "course_id": primary["course_id"],
            "session": primary["recommended_session"],
        }
    else:
        next_action = {
            "kind": "diagnostic",
            "title": "Build your learning profile",
            "detail": "Complete a short adaptive practice set so Genesis can find your highest-impact next step.",
            "topic": None,
            "course_id": None,
            "session": {"duration_minutes": 10, "question_count": 10, "available": True, "steps": []},
        }

    return {
        "version": 1,
        "student_id": student.id,
        "summary": {
            "overall_mastery": overall,
            "readiness": readiness,
            "topics_measured": len(topics),
            "mastered": sum(1 for row in topics if row["status"] == "mastered"),
            "developing": sum(1 for row in topics if row["status"] in {"developing", "emerging"}),
            "weak": sum(1 for row in topics if row["status"] in {"critical", "weak"}),
            "evidence_count": total_attempted,
        },
        "next_action": next_action,
        "topics": topics,
        "priority_topics": actionable[:6],
        "strong_topics": sorted([row for row in topics if row["status"] == "mastered"], key=lambda item: -item["mastery"])[:5],
        "methodology": {
            "mastery": "70% cross-surface accuracy plus 30% mastery ledger when both are available",
            "confidence": "evidence-volume curve capped below certainty",
            "minimum_evidence": MIN_EVIDENCE,
            "uses_ai_guessing": False,
        },
    }
