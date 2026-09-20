"""Flashcards — decks, spaced repetition, mastery and review analytics.

Every card points at a real :class:`Question`, so the answer a player reveals is
exactly ``Question.correct`` — the same field exams, duels and practice use.
"""
from __future__ import annotations

import random
from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from .. import game
from ..db import get_db
from ..deps import require_student
from ..events import dispatch, to_student
from ..models import (
    Answer,
    FlashcardCard,
    FlashcardDeck,
    FlashcardReview,
    Question,
    Quiz,
    Student,
    StudentBadge,
    Badge,
    utcnow,
)
from ..schemas import FlashcardDeckIn, FlashcardGradeIn, FlashcardNoteIn
from ..serializers import iso, student_profile
from ..services.questions import answer_matches, question_student_public

router = APIRouter(prefix="/flashcards", tags=["flashcards"])

# SM-2 flavoured intervals (days) per grading button.
INTERVALS = {"again": 0.0, "hard": 0.6, "good": 2.0, "easy": 5.0}
EASE_DELTA = {"again": -0.25, "hard": -0.12, "good": 0.02, "easy": 0.14}
DAILY_GOAL = 20


def _today() -> date:
    return utcnow().date()


# ---------------------------------------------------------------------------
# Deck helpers
# ---------------------------------------------------------------------------
def _deck_stats(db: Session, deck: FlashcardDeck, student_id: int | None) -> dict[str, Any]:
    rows = db.scalars(
        select(FlashcardCard).where(
            FlashcardCard.deck_id == deck.id,
            FlashcardCard.student_id == student_id if student_id is not None else FlashcardCard.student_id.is_(None),
        )
    ).all()
    today = _today()
    total = len(rows)
    mastered = sum(1 for row in rows if row.state == "mastered")
    learning = sum(1 for row in rows if row.state == "learning")
    reviewing = sum(1 for row in rows if row.state == "reviewing")
    due = sum(1 for row in rows if row.due_on is None or row.due_on <= today)
    return {
        "total": total,
        "mastered": mastered,
        "learning": learning,
        "reviewing": reviewing,
        "new": total - mastered - learning - reviewing,
        "due": due,
        "bookmarked": sum(1 for row in rows if row.bookmarked),
        "mastery": round(mastered / total * 100, 1) if total else 0.0,
    }


def _ensure_personal_cards(db: Session, deck: FlashcardDeck, student: Student) -> None:
    """Materialise a system deck's cards per player the first time they open it."""
    if deck.owner_id is not None and deck.owner_id != student.id:
        return
    existing = db.scalar(
        select(func.count(FlashcardCard.id)).where(
            FlashcardCard.deck_id == deck.id, FlashcardCard.student_id == student.id
        )
    ) or 0
    if existing:
        return
    templates = db.scalars(
        select(FlashcardCard).where(FlashcardCard.deck_id == deck.id, FlashcardCard.student_id.is_(None))
    ).all()
    for template in templates:
        db.add(
            FlashcardCard(
                deck_id=deck.id,
                question_id=template.question_id,
                student_id=student.id,
                state="new",
                due_on=_today(),
            )
        )
    db.flush()


def _deck_public(deck: FlashcardDeck, stats: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": deck.id,
        "name": deck.name,
        "description": deck.description,
        "kind": deck.kind,
        "config": deck.config or {},
        "is_public": deck.is_public,
        "is_system": deck.owner_id is None,
        "created_at": iso(deck.created_at),
        "stats": stats,
    }


SYSTEM_DECKS: list[dict[str, Any]] = [
    {
        "name": "Daily review",
        "kind": "mixed",
        "description": "A smart mix from the whole bank — the arena default.",
        "config": {"limit": 30},
    },
    {
        "name": "Weak spots",
        "kind": "weakness",
        "description": "Questions the arena has seen you miss most.",
    },
    {
        "name": "Wrong answers",
        "kind": "wrong",
        "description": "Every question you have ever answered incorrectly.",
    },
    {
        "name": "Recently seen",
        "kind": "recent",
        "description": "The questions you met most recently in exams, duels and practice.",
    },
    {
        "name": "Bookmarked",
        "kind": "favorites",
        "description": "Cards you starred for later revision.",
    },
]


def _ensure_system_decks(db: Session) -> None:
    """Create the built-in arena decks the first time anyone opens flashcards."""
    existing = set(
        db.scalars(select(FlashcardDeck.name).where(FlashcardDeck.owner_id.is_(None))).all()
    )
    missing = [row for row in SYSTEM_DECKS if row["name"] not in existing]
    if not missing:
        return
    for row in missing:
        db.add(
            FlashcardDeck(
                owner_id=None,
                name=row["name"],
                description=row["description"],
                kind=row["kind"],
                config=row.get("config", {}),
                is_public=True,
            )
        )
    db.commit()


@router.get("")
def list_decks(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """Arena decks + the player's own decks, each with live mastery stats."""
    _ensure_system_decks(db)
    decks = db.scalars(
        select(FlashcardDeck)
        .where((FlashcardDeck.owner_id.is_(None)) | (FlashcardDeck.owner_id == student.id) | (FlashcardDeck.is_public.is_(True)))
        .order_by(FlashcardDeck.is_public.desc(), FlashcardDeck.id)
    ).all()
    reviews_today = db.scalar(
        select(func.count(FlashcardReview.id)).where(
            FlashcardReview.student_id == student.id, FlashcardReview.created_at >= _today_start()
        )
    ) or 0
    correct_today = db.scalar(
        select(func.count(FlashcardReview.id)).where(
            FlashcardReview.student_id == student.id,
            FlashcardReview.created_at >= _today_start(),
            FlashcardReview.grade.in_(["good", "easy"]),
        )
    ) or 0
    streak_days = db.scalar(
        select(func.count(func.distinct(func.date(FlashcardReview.created_at)))).where(
            FlashcardReview.student_id == student.id
        )
    ) or 0
    due_total = int(
        db.scalar(
            select(func.count(FlashcardCard.id)).where(
                FlashcardCard.student_id == student.id,
                (FlashcardCard.due_on.is_(None)) | (FlashcardCard.due_on <= _today()),
            )
        )
        or 0
    )
    total_cards = int(db.scalar(select(func.count(FlashcardCard.id)).where(FlashcardCard.student_id == student.id)) or 0)
    mastered = int(
        db.scalar(
            select(func.count(FlashcardCard.id)).where(
                FlashcardCard.student_id == student.id, FlashcardCard.state == "mastered"
            )
        )
        or 0
    )
    return {
        "decks": [_deck_public(deck, _deck_stats(db, deck, student.id)) for deck in decks],
        "progress": {
            "goal": DAILY_GOAL,
            "reviewed_today": int(reviews_today),
            "correct_today": int(correct_today),
            "goal_percent": round(min(100.0, reviews_today / DAILY_GOAL * 100), 1),
            "study_days": int(streak_days),
            "due_total": due_total,
            "total_cards": total_cards,
            "mastered": mastered,
            "mastery": round(mastered / total_cards * 100, 1) if total_cards else 0.0,
        },
    }


def _today_start():
    today = _today()
    return utcnow().replace(year=today.year, month=today.month, day=today.day, hour=0, minute=0, second=0, microsecond=0)


@router.post("")
def create_deck(
    payload: FlashcardDeckIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Create a custom deck, or auto-fill one from the bank (course/topic/…)."""
    deck = FlashcardDeck(
        owner_id=student.id,
        name=payload.name.strip(),
        description=payload.description[:300],
        kind=payload.kind,
        config=payload.config or {},
        is_public=payload.is_public,
    )
    db.add(deck)
    db.flush()
    _fill_deck(db, deck, student)
    db.commit()
    return _deck_public(deck, _deck_stats(db, deck, student.id))


def _fill_deck(db: Session, deck: FlashcardDeck, student: Student) -> int:
    config = deck.config or {}
    if deck.kind == "favorites":
        query = (
            select(Question)
            .join(FlashcardCard, FlashcardCard.question_id == Question.id)
            .where(FlashcardCard.student_id == student.id, FlashcardCard.bookmarked.is_(True))
        )
    elif deck.kind == "wrong":
        query = (
            select(Question)
            .join(Answer, Answer.question_id == Question.id)
            .join(Quiz, Quiz.id == Question.quiz_id)
            .where(Answer.is_correct.is_(False))
            .where(Quiz.attempts.any(student_id=student.id))
            .distinct()
        )
    elif deck.kind == "recent":
        query = (
            select(Question)
            .join(Answer, Answer.question_id == Question.id)
            .join(Quiz, Quiz.id == Question.quiz_id)
            .where(Quiz.attempts.any(student_id=student.id))
            .order_by(Answer.answered_at.desc())
            .limit(int(config.get("limit", 40) or 40))
        )
    else:
        query = select(Question).where(
            Question.status == "approved",
            Question.visible.is_(True),
            Question.flashcard_enabled.is_(True),
        )
        if config.get("question_ids"):
            # A material (or any caller) can hand over an exact question list.
            ids = [int(value) for value in config["question_ids"] if str(value).isdigit()][:300]
            if ids:
                query = query.where(Question.id.in_(ids))
        if config.get("course_id"):
            query = query.where(Question.course_id == int(config["course_id"]))
        if config.get("topic"):
            query = query.where(func.lower(Question.topic) == str(config["topic"]).lower())
        if config.get("subtopic"):
            query = query.where(func.lower(Question.subtopic) == str(config["subtopic"]).lower())
        if config.get("difficulty"):
            query = query.where(Question.difficulty == str(config["difficulty"]).lower())
        if config.get("quiz_id"):
            query = query.where(Question.quiz_id == int(config["quiz_id"]))
        query = query.limit(int(config.get("limit", 60) or 60))

    if deck.kind == "weakness":
        # Questions the player keeps missing, from the topics they are weakest in.
        query = (
            select(Question)
            .join(Answer, Answer.question_id == Question.id)
            .where(Answer.is_correct.is_(False))
            .order_by(Question.wrong_count.desc())
            .limit(60)
        )
    if deck.kind == "mixed":
        query = select(Question).where(Question.status == "approved", Question.visible.is_(True)).limit(60)

    questions = list(db.scalars(query).all())
    if not questions:
        return 0
    random.Random(deck.id).shuffle(questions)
    added = 0
    for question in questions:
        if not question.flashcard_enabled:
            continue
        db.add(
            FlashcardCard(
                deck_id=deck.id,
                question_id=question.id,
                student_id=student.id if deck.owner_id == student.id else None,
                due_on=_today(),
            )
        )
        added += 1
    db.flush()
    return added


@router.delete("/decks/{deck_id}")
def delete_deck(deck_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    deck = db.get(FlashcardDeck, deck_id)
    if deck is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deck not found.")
    if deck.owner_id not in (None, student.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "That deck belongs to another player.")
    if deck.owner_id is None:
        # System decks reset for this player instead of disappearing for everyone.
        for card in db.scalars(
            select(FlashcardCard).where(FlashcardCard.deck_id == deck.id, FlashcardCard.student_id == student.id)
        ).all():
            db.delete(card)
        db.commit()
        return {"ok": True, "reset": True}
    db.delete(deck)
    db.commit()
    return {"ok": True, "reset": False}


@router.get("/decks/{deck_id}")
def read_deck(
    deck_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
    due_only: bool = Query(False),
    bookmarked: bool = Query(False),
    mode: str = Query("q_to_a", pattern="^(q_to_a|a_to_q)$"),
    shuffle: bool = Query(True),
    limit: int = Query(60, ge=1, le=200),
) -> dict:
    deck = db.get(FlashcardDeck, deck_id)
    if deck is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deck not found.")
    if deck.owner_id is not None and deck.owner_id != student.id and not deck.is_public:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "That deck is private.")
    _ensure_personal_cards(db, deck, student)
    if deck.owner_id in (None, student.id):
        mine = db.scalar(
            select(func.count(FlashcardCard.id)).where(
                FlashcardCard.deck_id == deck.id, FlashcardCard.student_id == student.id
            )
        ) or 0
        if mine == 0:
            # A brand-new system deck has no templates yet: fill it, then
            # materialise this player's own copies of those templates.
            _fill_deck(db, deck, student)
            db.flush()
            _ensure_personal_cards(db, deck, student)
            db.flush()
    # Cards created above must be durable before the client grades them —
    # otherwise the id it just saw would be unknown on the next request.
    db.commit()

    stmt = select(FlashcardCard).where(FlashcardCard.deck_id == deck.id, FlashcardCard.student_id == student.id)
    if due_only:
        stmt = stmt.where((FlashcardCard.due_on.is_(None)) | (FlashcardCard.due_on <= _today()))
    if bookmarked:
        stmt = stmt.where(FlashcardCard.bookmarked.is_(True))
    cards = list(db.scalars(stmt).all())
    if shuffle:
        random.Random(deck.id).shuffle(cards)
    cards = cards[:limit]
    question_ids = [card.question_id for card in cards]
    questions = {
        row.id: row for row in db.scalars(select(Question).where(Question.id.in_(question_ids))).all()
    } if question_ids else {}

    today = _today()
    payload_cards = []
    for card in cards:
        question = questions.get(card.question_id)
        if question is None:
            continue
        revealed = question_student_public(question, reveal=True)
        payload_cards.append(
            {
                "card_id": card.id,
                "question_id": card.question_id,
                "state": card.state,
                "ease": round(card.ease, 2),
                "interval_days": card.interval_days,
                "reps": card.reps,
                "lapses": card.lapses,
                "streak": card.streak,
                "due_on": card.due_on.isoformat() if card.due_on else None,
                "due_now": card.due_on is None or card.due_on <= today,
                "bookmarked": card.bookmarked,
                "notes": card.notes,
                "last_grade": card.last_grade,
                "front": question.text if mode == "q_to_a" else (revealed["answer_text"][0] if revealed["answer_text"] else revealed["text"]),
                "back": (revealed["answer_text"][0] if revealed["answer_text"] else "") if mode == "q_to_a" else question.text,
                "explanation": revealed["explanation"],
                "options": revealed["options"],
                "correct": revealed["correct"],
                "correct_label": revealed["correct_label"],
                "answer_text": revealed["answer_text"],
                "difficulty": question.difficulty,
                "topic": question.topic,
                "source": question.source,
                "reference": question.reference,
                "hint": question.hint,
                "media": revealed["media"],
            }
        )
    return {
        "deck": _deck_public(deck, _deck_stats(db, deck, student.id)),
        "mode": mode,
        "cards": payload_cards,
        "next_due": _next_due(db, student.id),
    }


def _next_due(db: Session, student_id: int) -> dict[str, Any]:
    today = _today()
    tomorrow = today + timedelta(days=1)
    due_today = int(
        db.scalar(
            select(func.count(FlashcardCard.id)).where(
                FlashcardCard.student_id == student_id,
                (FlashcardCard.due_on.is_(None)) | (FlashcardCard.due_on <= today),
            )
        )
        or 0
    )
    due_tomorrow = int(
        db.scalar(
            select(func.count(FlashcardCard.id)).where(
                FlashcardCard.student_id == student_id, FlashcardCard.due_on == tomorrow
            )
        )
        or 0
    )
    return {"due_today": due_today, "due_tomorrow": due_tomorrow}


def _schedule(card: FlashcardCard, grade: str) -> None:
    today = _today()
    base = INTERVALS[grade]
    card.ease = max(1.3, min(3.2, (card.ease or 2.5) + EASE_DELTA[grade]))
    if grade == "again":
        card.interval_days = 0.0
        card.lapses += 1
        card.streak = 0
        card.state = "learning"
        card.due_on = today
    else:
        growth = base if card.reps == 0 else base * max(1.0, card.interval_days or base)
        card.interval_days = round(min(180.0, max(base, growth)), 2)
        card.streak += 1
        if card.interval_days >= 21 and card.streak >= 4:
            card.state = "mastered"
        elif card.interval_days >= 3:
            card.state = "reviewing"
        else:
            card.state = "learning"
        card.due_on = today + timedelta(days=max(1, int(round(card.interval_days))))
    card.reps += 1
    card.last_grade = grade
    card.last_reviewed_at = utcnow()


@router.post("/grade")
async def grade_card(
    payload: FlashcardGradeIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Grade one card: again / hard / good / easy — drives the SRS schedule."""
    card: FlashcardCard | None = None
    if payload.card_id:
        card = db.get(FlashcardCard, payload.card_id)
        if card is None or (card.student_id is not None and card.student_id != student.id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Card not found.")
    if card is None:
        card = db.scalar(
            select(FlashcardCard).where(
                FlashcardCard.student_id == student.id, FlashcardCard.question_id == payload.question_id
            )
        )
    question = db.get(Question, payload.question_id)
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found.")

    if card is None:
        card = FlashcardCard(
            deck_id=(db.scalars(select(FlashcardDeck.id).where(FlashcardDeck.owner_id == student.id)).first() or 0) or 0,
            question_id=question.id,
            student_id=student.id,
            due_on=_today(),
        )
        if not card.deck_id:
            raise HTTPException(status.HTTP_409_CONFLICT, "Create a deck first.")
        db.add(card)

    _schedule(card, payload.grade)
    db.add(
        FlashcardReview(
            student_id=student.id,
            deck_id=card.deck_id,
            question_id=question.id,
            grade=payload.grade,
            mode=payload.mode,
            elapsed_ms=max(0, int(payload.elapsed_ms or 0)),
        )
    )

    # XP: better grades pay more; the daily goal adds a bonus.
    xp_map = {"again": 1, "hard": 2, "good": 3, "easy": 4}
    xp = xp_map[payload.grade]
    reviews_today = int(
        db.scalar(
            select(func.count(FlashcardReview.id)).where(
                FlashcardReview.student_id == student.id, FlashcardReview.created_at >= _today_start()
            )
        )
        or 0
    ) + 1
    bonus = 0
    if reviews_today == DAILY_GOAL:
        bonus = 40
        xp += bonus
    rewards = game.grant(
        db,
        student,
        xp=xp,
        coins=1 if payload.grade in {"good", "easy"} else 0,
        kind="xp",
        title="Flashcards",
        detail=f"{payload.grade.title()} · {reviews_today}/{DAILY_GOAL} today",
    )
    # Flashcard badges.
    if reviews_today >= DAILY_GOAL:
        for key, name, desc in (
            ("card_shark", "Card Shark", "Review 500 flashcards"),
            ("daily_goal", "Daily Grind", "Hit the daily flashcard goal"),
        ):
            badge = db.scalar(select(Badge).where(Badge.key == key))
            if badge and not db.scalar(
                select(StudentBadge.id).where(StudentBadge.student_id == student.id, StudentBadge.badge_id == badge.id)
            ):
                if key == "daily_goal" or (
                    db.scalar(select(func.count(FlashcardReview.id)).where(FlashcardReview.student_id == student.id)) or 0
                ) >= 500:
                    db.add(StudentBadge(student_id=student.id, badge_id=badge.id))
                    game.award_xp(db, student, badge.xp_reward, events=rewards)
                    student.coins += badge.coin_reward
                    rewards.append({"type": "badge", "badge": {"key": badge.key, "name": badge.name, "description": desc}})

    if payload.grade in {"good", "easy"}:
        db.flush()
    profile = student_profile(db, student)
    db.commit()
    if rewards:
        await dispatch([to_student(student.id, "rewards", rewards)])
    return {
        "ok": True,
        "card": {
            "card_id": card.id,
            "state": card.state,
            "ease": round(card.ease, 2),
            "interval_days": card.interval_days,
            "due_on": card.due_on.isoformat() if card.due_on else None,
            "streak": card.streak,
            "reps": card.reps,
        },
        "due": _next_due(db, student.id),
        "rewards": rewards,
        "profile": profile,
        "goal_hit": reviews_today >= DAILY_GOAL,
        "bonus": bonus,
        "reviewed_today": reviews_today,
    }


@router.patch("/cards/{card_id}")
def update_card(
    card_id: int,
    payload: FlashcardNoteIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    card = db.get(FlashcardCard, card_id)
    if card is None or (card.student_id is not None and card.student_id != student.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Card not found.")
    if payload.bookmarked is not None:
        card.bookmarked = payload.bookmarked
    card.notes = payload.notes[:2000]
    db.commit()
    return {"ok": True, "bookmarked": card.bookmarked, "notes": card.notes}


@router.get("/stats")
def flashcard_stats(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    rows = db.execute(
        select(FlashcardReview.grade, func.count(FlashcardReview.id))
        .where(FlashcardReview.student_id == student.id)
        .group_by(FlashcardReview.grade)
    ).all()
    by_grade = {str(key): int(value) for key, value in rows}
    total = sum(by_grade.values())
    days = db.execute(
        select(func.date(FlashcardReview.created_at), func.count(FlashcardReview.id))
        .where(FlashcardReview.student_id == student.id)
        .group_by(func.date(FlashcardReview.created_at))
        .order_by(func.date(FlashcardReview.created_at).desc())
        .limit(30)
    ).all()
    states = db.execute(
        select(FlashcardCard.state, func.count(FlashcardCard.id))
        .where(FlashcardCard.student_id == student.id)
        .group_by(FlashcardCard.state)
    ).all()
    return {
        "total_reviews": total,
        "by_grade": by_grade,
        "by_state": {str(key): int(value) for key, value in states},
        "history": [{"day": str(day), "reviews": int(count)} for day, count in days],
        "accuracy": round((by_grade.get("good", 0) + by_grade.get("easy", 0)) / total * 100, 1) if total else 0.0,
        "streak_days": len(days),
        "next_due": _next_due(db, student.id),
    }


@router.get("/due")
def due_queue(
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
    limit: int = Query(30, ge=1, le=100),
) -> dict:
    """Due today / due tomorrow queues across every deck."""
    cards = db.scalars(
        select(FlashcardCard)
        .where(FlashcardCard.student_id == student.id)
        .order_by(FlashcardCard.due_on.asc().nullsfirst())
        .limit(limit)
    ).all()
    question_ids = [card.question_id for card in cards]
    questions = {
        row.id: row for row in db.scalars(select(Question).where(Question.id.in_(question_ids))).all()
    } if question_ids else {}
    tomorrow = _today() + timedelta(days=1)
    return {
        "due_today": [
            question_student_public(questions[card.question_id], reveal=True)
            for card in cards
            if questions.get(card.question_id) and (card.due_on is None or card.due_on <= _today())
        ],
        "due_tomorrow": [
            question_student_public(questions[card.question_id], reveal=True)
            for card in cards
            if questions.get(card.question_id) and card.due_on == tomorrow
        ],
        "counts": _next_due(db, student.id),
    }
