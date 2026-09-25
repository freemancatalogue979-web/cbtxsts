"""Course question banks and how exams draw from them.

The model this module enforces::

    COURSE
      └── QUESTION BANK            (hidden ``is_bank`` quiz; originals, exam_only=False)
            ├── Question 1
            └── ... Question 10,000

    EXAM
      ├── question_source = "course_random"
      │       └── draw_count = 40  → every player gets 40 random bank questions
      └── question_source = "exam_specific"
              └── the exam's own rows (exam_only=True) — never part of the bank

Three numbers that must never be confused:

* **bank size**      — how many questions the course bank holds (``bank_count``)
* **exam count**     — how many questions a player is served (``served_count``)
* **exam set size**  — how many exam-specific questions an exam owns
"""
from __future__ import annotations

import random
from typing import Iterable

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from ..models import Course, Question, Quiz

COURSE_RANDOM = "course_random"
EXAM_SPECIFIC = "exam_specific"
SOURCES = (COURSE_RANDOM, EXAM_SPECIFIC)

# One RNG for exam draws that is not seeded from anything a player controls.
_draw_rng = random.SystemRandom()


def bank_conditions(course_id: int | None = None):
    """SQL conditions for *course bank originals* (optionally one course).

    An original is a question that is not a drawn copy (``source_id`` NULL) and
    was not written for one exam only (``exam_only`` False).
    """
    conds = [Question.source_id.is_(None), Question.exam_only.is_(False)]
    if course_id is not None:
        conds.append(Question.course_id == course_id)
    return and_(*conds)


def eligible_conditions(course_id: int, topics: Iterable[str] | None = None):
    """Bank questions that may be served in an exam right now."""
    conds = [
        bank_conditions(course_id),
        Question.status == "approved",
        Question.visible.is_(True),
    ]
    wanted = [str(t).strip().lower() for t in (topics or []) if str(t).strip()]
    if wanted:
        conds.append(func.lower(Question.topic).in_(wanted))
    return and_(*conds)


def bank_count(db: Session, course_id: int, *, eligible_only: bool = False, topics: Iterable[str] | None = None) -> int:
    cond = eligible_conditions(course_id, topics) if eligible_only else bank_conditions(course_id)
    return int(db.scalar(select(func.count(Question.id)).where(cond)) or 0)


def bank_counts_by_course(db: Session) -> dict[int, int]:
    rows = db.execute(
        select(Question.course_id, func.count(Question.id)).where(bank_conditions()).group_by(Question.course_id)
    ).all()
    return {int(course_id): int(count) for course_id, count in rows if course_id is not None}


def exam_set(db: Session, quiz: Quiz, *, visible_only: bool = True) -> list[Question]:
    """The questions an exam owns itself (exam-specific set, or a legacy fixed paper)."""
    stmt = select(Question).where(Question.quiz_id == quiz.id)
    if visible_only:
        stmt = stmt.where(Question.visible.is_(True))
    return list(db.scalars(stmt.order_by(Question.position, Question.id)).all())


def is_random(quiz: Quiz) -> bool:
    return (getattr(quiz, "question_source", "") or EXAM_SPECIFIC) == COURSE_RANDOM and not quiz.is_bank


def served_count(db: Session, quiz: Quiz) -> int:
    """How many questions ONE player is served by this exam."""
    draw = int(getattr(quiz, "draw_count", 0) or 0)
    if is_random(quiz):
        return max(0, draw)
    owned = int(
        db.scalar(select(func.count(Question.id)).where(Question.quiz_id == quiz.id, Question.visible.is_(True))) or 0
    )
    return min(draw, owned) if draw > 0 else owned


def validate_exam_source(db: Session, quiz: Quiz) -> str | None:
    """Human-readable problem with an exam's question configuration, or None."""
    if quiz.is_bank:
        return None
    source = getattr(quiz, "question_source", EXAM_SPECIFIC) or EXAM_SPECIFIC
    draw = int(getattr(quiz, "draw_count", 0) or 0)
    if source == COURSE_RANDOM:
        if not quiz.course_id:
            return "Choose a course — random questions are drawn from that course's question bank."
        if draw < 1:
            return "Set how many questions each player should get (for example 40)."
        available = bank_count(db, quiz.course_id, eligible_only=True, topics=quiz.draw_topics or [])
        if available < draw:
            scope = "the selected topics" if quiz.draw_topics else "the course question bank"
            return (
                f"Not enough questions: this exam draws {draw} questions per player but {scope} only holds {available} approved "
                "questions. Add questions to the bank or lower the number to draw."
            )
        quota = {k: int(v or 0) for k, v in (getattr(quiz, "draw_difficulty", {}) or {}).items() if int(v or 0) > 0}
        if quota:
            if sum(quota.values()) != draw:
                return f"The difficulty mix adds up to {sum(quota.values())}, but the exam draws {draw}."
            for level, need in quota.items():
                have = int(
                    db.scalar(
                        select(func.count(Question.id)).where(
                            eligible_conditions(quiz.course_id, quiz.draw_topics or []), Question.difficulty == level
                        )
                    )
                    or 0
                )
                if have < need:
                    return f"The difficulty mix asks for {need} {level} questions but the bank only has {have}."
        return None
    owned = int(
        db.scalar(select(func.count(Question.id)).where(Question.quiz_id == quiz.id, Question.visible.is_(True))) or 0
    )
    if owned == 0:
        return "This exam has no exam-specific questions yet — add or import them first."
    if draw > owned:
        return f"The exam serves {draw} questions but only {owned} exam-specific questions exist."
    return None


def _dedupe_by_text(rows: list[Question]) -> list[Question]:
    seen: set[str] = set()
    out: list[Question] = []
    for row in rows:
        key = (row.text or "").strip().lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out


def draw_question_ids(db: Session, quiz: Quiz, *, rng: random.Random | None = None) -> list[int]:
    """Deal ONE player's paper. Called once, when the attempt starts.

    * course_random: a uniform random sample of ``draw_count`` eligible bank
      questions (respecting topic filter and optional difficulty quota). Never
      "the first 40" — every start is an independent draw.
    * exam_specific: the exam's own set — all of it, or a random subset when
      ``draw_count`` is smaller than the set — shuffled when the exam shuffles.
    """
    rng = rng or _draw_rng
    draw = int(getattr(quiz, "draw_count", 0) or 0)
    if is_random(quiz):
        # Pull ids + the two fields the draw needs, not full rows: a 10,000
        # question bank stays cheap to sample from.
        rows = db.execute(
            select(Question.id, Question.text, Question.difficulty).where(
                eligible_conditions(quiz.course_id, quiz.draw_topics or [])
            )
        ).all()
        seen: set[str] = set()
        pool: list[tuple[int, str]] = []
        for qid, text, difficulty in rows:
            key = (text or "").strip().lower()
            if key in seen:
                continue
            seen.add(key)
            pool.append((int(qid), (difficulty or "medium").lower()))
        quota = {k: int(v or 0) for k, v in (getattr(quiz, "draw_difficulty", {}) or {}).items() if int(v or 0) > 0}
        picks: list[int] = []
        if quota and sum(quota.values()) == draw:
            for level, need in quota.items():
                bucket = [qid for qid, diff in pool if diff == level]
                picks.extend(rng.sample(bucket, min(need, len(bucket))))
        if len(picks) < draw:
            remaining = [qid for qid, _ in pool if qid not in set(picks)]
            picks.extend(rng.sample(remaining, min(draw - len(picks), len(remaining))))
        rng.shuffle(picks)
        return picks

    owned = _dedupe_by_text(exam_set(db, quiz))
    ids = [row.id for row in owned]
    if 0 < draw < len(ids):
        ids = rng.sample(ids, draw)
    if quiz.shuffle_questions:
        rng.shuffle(ids)
    return ids


def ensure_bank_quiz(db: Session, course: Course) -> Quiz:
    quiz = db.scalar(select(Quiz).where(Quiz.course_id == course.id, Quiz.is_bank.is_(True)))
    if quiz is None:
        quiz = Quiz(
            title=f"{course.code or course.title} — question bank",
            course_id=course.id,
            instructions="Not an exam. The course question bank lives here; exams draw from it.",
            status="draft",
            is_bank=True,
            question_source=EXAM_SPECIFIC,
        )
        db.add(quiz)
        db.flush()
    return quiz


_COPY_FIELDS = (
    "text", "option_a", "option_b", "option_c", "option_d", "correct", "explanation", "points", "difficulty",
    "question_type", "topic", "subtopic", "objective", "source", "reference", "author", "hint", "admin_notes",
    "status", "visible", "flashcard_enabled", "duel_enabled", "practice_enabled", "time_limit_seconds",
)


def copy_into_bank(db: Session, question: Question, bank: Quiz, *, position: int, actor: str = "system") -> Question:
    """Create a bank original with the same content (and the same stored answer)."""
    data = {field: getattr(question, field) for field in _COPY_FIELDS}
    original = Question(
        quiz_id=bank.id,
        course_id=bank.course_id,
        position=position,
        tags=list(question.tags or []),
        media=dict(question.media or {}),
        content=dict(question.content or {}),
        exam_only=False,
        created_by=question.created_by or actor,
        updated_by=actor,
        **data,
    )
    db.add(original)
    db.flush()
    return original


def promote_legacy_exam_questions(db: Session) -> int:
    """One-time, idempotent migration to the course-centric model.

    Before this model existed, course questions often lived directly inside
    exam papers. For every such original (in a non-bank quiz with a course,
    not a drawn copy, not already exam-only) we give the course bank its own
    original and turn the exam row into a copy linked to it. The exam row keeps
    its id, so past attempts, answers, flags and mistakes stay intact, and the
    exam keeps serving exactly the paper it served before.
    """
    legacy = list(
        db.scalars(
            select(Question)
            .join(Quiz, Quiz.id == Question.quiz_id)
            .where(
                Quiz.is_bank.is_(False),
                Quiz.course_id.is_not(None),
                Question.source_id.is_(None),
                Question.exam_only.is_(False),
            )
            .order_by(Question.quiz_id, Question.position, Question.id)
        ).all()
    )
    if not legacy:
        return 0
    promoted = 0
    banks: dict[int, Quiz] = {}
    by_text: dict[int, dict[str, int]] = {}
    next_pos: dict[int, int] = {}
    for row in legacy:
        course_id = int(row.quiz.course_id)
        if course_id not in banks:
            course = db.get(Course, course_id)
            if course is None:
                continue
            bank = ensure_bank_quiz(db, course)
            banks[course_id] = bank
            by_text[course_id] = {
                (text or "").strip().lower(): qid
                for qid, text in db.execute(
                    select(Question.id, Question.text).where(bank_conditions(course_id), Question.quiz_id == bank.id)
                ).all()
            }
            next_pos[course_id] = int(
                db.scalar(select(func.max(Question.position)).where(Question.quiz_id == bank.id)) or 0
            ) + 1
        key = (row.text or "").strip().lower()
        original_id = by_text[course_id].get(key)
        if original_id is None:
            original = copy_into_bank(db, row, banks[course_id], position=next_pos[course_id])
            next_pos[course_id] += 1
            by_text[course_id][key] = original.id
            original_id = original.id
            promoted += 1
        row.course_id = course_id
        row.source_id = original_id
    db.flush()
    return promoted
