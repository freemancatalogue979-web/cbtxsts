"""My AI Resources: the student's own generated content, stored in dedicated
tables and exposed through one small adapter so the app can treat every kind
the same way (list / open / rename / edit / duplicate / delete).

    flashcards -> ai_flashcard_decks + ai_flashcards (+ ai_flashcard_reviews)
    practice   -> ai_practice_sets + ai_generated_questions   (saved=True only)
    material   -> ai_generated_materials (material_type="study_material")
    notes      -> ai_generated_materials (material_type="notes")
    plan       -> ai_study_plans + ai_study_plan_items

Every query is scoped to the owner. Nothing here touches official content.
"""

from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (
    AIConversation,
    AIFlashcard,
    AIFlashcardDeck,
    AIGeneratedMaterial,
    AIGeneratedQuestion,
    AIPracticeSet,
    AISavedItem,
    AIStudyPlan,
    AIStudyPlanItem,
    Course,
    CourseTopic,
    Student,
)

KINDS = ("flashcards", "practice", "material", "notes", "plan")
SOURCE_TYPES = {"topic", "material", "conversation", "question", "upload", "text", "custom", "quiz", "progress"}
MAX_JSON = 300_000


class LibraryError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _s(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _iso(value: datetime | date | None) -> str | None:
    return value.isoformat() if value else None


def _topic_id(db: Session, course_id: int | None, topic: str) -> int | None:
    if not course_id or not topic:
        return None
    return db.execute(select(CourseTopic.id).where(CourseTopic.course_id == course_id, func.lower(CourseTopic.name) == topic.lower())).scalar_one_or_none()


def _valid_course(db: Session, value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and db.get(Course, value) is not None else None


# ------------------------------------------------------------- serialise
def deck_data(deck: AIFlashcardDeck) -> dict:
    return {
        "title": deck.title, "description": deck.description,
        "cards": [{"id": c.id, "front": c.front, "back": c.back, "topic": c.topic, "difficulty": c.difficulty, "next_review_at": _iso(c.next_review_at), "interval_days": c.interval_days} for c in deck.cards],
    }


def question_row(q: AIGeneratedQuestion) -> dict:
    return {
        "id": q.id, "type": q.question_type, "question": q.question, "options": q.options or [], "correct_answer": q.correct_answer,
        "explanation": q.explanation, "topic": q.topic, "difficulty": q.difficulty, "times_answered": q.times_answered,
        "times_correct": q.times_correct, "source_material_id": q.source_material_id,
    }


def practice_data(ps: AIPracticeSet) -> dict:
    return {"title": ps.title, "questions": [question_row(q) for q in ps.questions], "attempts": ps.attempts, "best_score": ps.best_score, "last_score": ps.last_score}


def plan_data(plan: AIStudyPlan) -> dict:
    days: dict[str, list] = {}
    for item in plan.items:
        days.setdefault(_iso(item.date) or "", []).append({"id": item.id, "topic": item.topic, "activity": item.activity, "duration": item.duration, "status": item.status, "completed": item.completed})
    items = list(plan.items)
    done = sum(1 for i in items if i.status == "completed")
    return {
        "title": plan.title, "overview": (plan.content or {}).get("overview", ""), "tips": (plan.content or {}).get("tips", []),
        "exam_date": _iso(plan.exam_date), "minutes_per_day": plan.minutes_per_day,
        "days": [{"date": d, "items": rows} for d, rows in sorted(days.items())],
        "progress": {"done": done, "total": len(items), "skipped": sum(1 for i in items if i.status == "skipped")},
    }


def row(kind: str, obj: Any, full: bool = False) -> dict:
    if kind == "flashcards":
        size, data = len(obj.cards), deck_data(obj) if full else None
        due = sum(1 for c in obj.cards if c.next_review_at is None or c.next_review_at <= datetime.utcnow())
        extra = {"due": due, "source_type": obj.source_type}
    elif kind == "practice":
        size, data = len(obj.questions), practice_data(obj) if full else None
        extra = {"attempts": obj.attempts, "best_score": obj.best_score, "source_type": obj.source_type}
    elif kind in ("material", "notes"):
        content = obj.content or {}
        size, data = len(content.get("sections") or []), content if full else None
        extra = {"source_type": obj.source_type}
    else:
        items = list(obj.items)
        size, data = len(items), plan_data(obj) if full else None
        extra = {"exam_date": _iso(obj.exam_date), "done": sum(1 for i in items if i.status == "completed")}
    out = {
        "id": obj.id, "key": f"{kind}:{obj.id}", "kind": kind, "title": obj.title, "course_id": obj.course_id,
        "topic": getattr(obj, "topic", ""), "items": size, "created_at": _iso(obj.created_at), "updated_at": _iso(obj.updated_at), **extra,
    }
    if full:
        out["data"] = data
    return out


# ------------------------------------------------------------------ query
def _model(kind: str):
    return {"flashcards": AIFlashcardDeck, "practice": AIPracticeSet, "material": AIGeneratedMaterial, "notes": AIGeneratedMaterial, "plan": AIStudyPlan}[kind]


def get_owned(db: Session, student: Student, kind: str, item_id: int, *, include_unsaved: bool = False):
    if kind not in KINDS:
        raise LibraryError("Unknown item type.", 422)
    obj = db.get(_model(kind), item_id)
    if obj is None or obj.user_id != student.id:
        raise LibraryError("Saved item not found.", 404)
    if kind in ("material", "notes") and (obj.deleted_at is not None or obj.material_type != ("notes" if kind == "notes" else "study_material")):
        raise LibraryError("Saved item not found.", 404)
    if kind == "practice" and not obj.saved and not include_unsaved:
        raise LibraryError("Saved item not found.", 404)
    return obj


def list_items(db: Session, student: Student, kind: str = "", q: str = "") -> list[dict]:
    kinds = [kind] if kind in KINDS else list(KINDS)
    out: list[dict] = []
    for k in kinds:
        model = _model(k)
        stmt = select(model).where(model.user_id == student.id)
        if k == "practice":
            stmt = stmt.where(AIPracticeSet.saved.is_(True))
        if k in ("material", "notes"):
            stmt = stmt.where(AIGeneratedMaterial.deleted_at.is_(None), AIGeneratedMaterial.material_type == ("notes" if k == "notes" else "study_material"))
        if k == "plan":
            stmt = stmt.where(AIStudyPlan.saved.is_(True))
        if q:
            stmt = stmt.where(func.lower(model.title).contains(q.lower()))
        for obj in db.execute(stmt.order_by(model.updated_at.desc()).limit(300)).scalars():
            out.append(row(k, obj))
    out.sort(key=lambda r: r["updated_at"] or "", reverse=True)
    return out


def counts(db: Session, student: Student) -> dict:
    now = datetime.utcnow()
    return {
        "flashcards": db.execute(select(func.count(AIFlashcardDeck.id)).where(AIFlashcardDeck.user_id == student.id)).scalar_one(),
        "cards_due": db.execute(
            select(func.count(AIFlashcard.id)).join(AIFlashcardDeck, AIFlashcardDeck.id == AIFlashcard.deck_id)
            .where(AIFlashcardDeck.user_id == student.id, (AIFlashcard.next_review_at.is_(None)) | (AIFlashcard.next_review_at <= now))
        ).scalar_one(),
        "practice": db.execute(select(func.count(AIPracticeSet.id)).where(AIPracticeSet.user_id == student.id, AIPracticeSet.saved.is_(True))).scalar_one(),
        "material": db.execute(select(func.count(AIGeneratedMaterial.id)).where(AIGeneratedMaterial.user_id == student.id, AIGeneratedMaterial.deleted_at.is_(None), AIGeneratedMaterial.material_type == "study_material")).scalar_one(),
        "notes": db.execute(select(func.count(AIGeneratedMaterial.id)).where(AIGeneratedMaterial.user_id == student.id, AIGeneratedMaterial.deleted_at.is_(None), AIGeneratedMaterial.material_type == "notes")).scalar_one(),
        "plan": db.execute(select(func.count(AIStudyPlan.id)).where(AIStudyPlan.user_id == student.id, AIStudyPlan.saved.is_(True))).scalar_one(),
    }


# ------------------------------------------------------------------- write
def _check_size(data: Any) -> None:
    if len(json.dumps(data, default=str)) > MAX_JSON:
        raise LibraryError("That is too large to save.", 413)


def _set_cards(deck: AIFlashcardDeck, cards: list) -> None:
    existing = {c.id: c for c in deck.cards}
    keep: list[AIFlashcard] = []
    for position, raw in enumerate(cards[:500]):
        if not isinstance(raw, dict):
            continue
        front, back = _s(raw.get("front"), 1000), _s(raw.get("back"), 2000)
        if not front or not back:
            continue
        card = existing.get(raw.get("id")) if isinstance(raw.get("id"), int) else None
        if card is None:
            card = AIFlashcard()
        card.position, card.front, card.back = position, front, back
        card.topic = _s(raw.get("topic"), 120) or deck.topic
        card.difficulty = raw.get("difficulty") if raw.get("difficulty") in {"easy", "medium", "hard"} else "medium"
        keep.append(card)
    if not keep:
        raise LibraryError("A deck needs at least one card with a front and a back.", 422)
    deck.cards[:] = keep


def _set_questions(ps: AIPracticeSet, questions: list, student_id: int) -> None:
    existing = {q.id: q for q in ps.questions}
    keep: list[AIGeneratedQuestion] = []
    for position, raw in enumerate(questions[:100]):
        if not isinstance(raw, dict) or not _s(raw.get("question"), 2000):
            continue
        q = existing.get(raw.get("id")) if isinstance(raw.get("id"), int) else None
        if q is None:
            q = AIGeneratedQuestion(user_id=student_id, course_id=ps.course_id, topic_id=ps.topic_id, source_material_id=ps.source_id if ps.source_type == "material" else None)
        q.position = position
        q.question_type = raw.get("type") if raw.get("type") in {"mcq", "true_false", "short_answer", "calculation", "scenario"} else "mcq"
        q.question = _s(raw.get("question"), 2000)
        q.options = [_s(o, 400) for o in (raw.get("options") or []) if _s(o, 400)][:6]
        q.correct_answer = _s(raw.get("correct_answer"), 1000)
        q.explanation = _s(raw.get("explanation"), 2000)
        q.topic = _s(raw.get("topic"), 120) or ps.topic
        q.difficulty = raw.get("difficulty") if raw.get("difficulty") in {"easy", "medium", "hard"} else "medium"
        keep.append(q)
    if not keep:
        raise LibraryError("A practice set needs at least one question.", 422)
    ps.questions[:] = keep


def _set_plan_items(plan: AIStudyPlan, days: list) -> None:
    existing = {i.id: i for i in plan.items}
    keep: list[AIStudyPlanItem] = []
    for day in days[:120]:
        if not isinstance(day, dict):
            continue
        try:
            when = date.fromisoformat(str(day.get("date"))[:10])
        except ValueError:
            when = None
        for position, raw in enumerate((day.get("items") or [])[:12]):
            if not isinstance(raw, dict) or not _s(raw.get("activity"), 300):
                continue
            item = existing.get(raw.get("id")) if isinstance(raw.get("id"), int) else None
            if item is None:
                item = AIStudyPlanItem()
            item.date, item.position = when, position
            item.topic, item.activity = _s(raw.get("topic"), 120), _s(raw.get("activity"), 300)
            try:
                item.duration = max(5, min(int(raw.get("duration") or 30), 480))
            except (TypeError, ValueError):
                item.duration = 30
            status = raw.get("status") if raw.get("status") in {"pending", "completed", "skipped"} else (item.status or "pending")
            item.status, item.completed = status, status == "completed"
            item.topic_id = _topic_id_from_plan(plan, item.topic)
            keep.append(item)
    if not keep:
        raise LibraryError("A study plan needs at least one activity.", 422)
    plan.items[:] = keep


_PLAN_TOPICS: dict[int, dict[str, int]] = {}


def _topic_id_from_plan(plan: AIStudyPlan, topic: str) -> int | None:
    return _PLAN_TOPICS.get(plan.course_id or 0, {}).get((topic or "").lower())


def create(db: Session, student: Student, payload: dict) -> dict:
    kind = str(payload.get("kind") or "")
    if kind not in KINDS:
        raise LibraryError("Unknown item type.", 422)
    data = payload.get("data") if isinstance(payload.get("data"), dict) else None
    course_id = _valid_course(db, payload.get("course_id"))
    topic = _s(payload.get("topic"), 120)
    title = _s(payload.get("title") or (data or {}).get("title"), 200)
    source_type = payload.get("source_type") if payload.get("source_type") in SOURCE_TYPES else "custom"
    source_id = payload.get("source_id") if isinstance(payload.get("source_id"), int) else None
    conv_id = payload.get("conversation_id") if isinstance(payload.get("conversation_id"), int) else None
    if conv_id:
        conv = db.get(AIConversation, conv_id)
        conv_id = conv.id if conv is not None and conv.user_id == student.id else None

    # practice generated earlier is already stored: saving just keeps it
    if kind == "practice" and isinstance(payload.get("set_id"), int):
        ps = get_owned(db, student, "practice", payload["set_id"], include_unsaved=True)
        ps.saved = True
        if title:
            ps.title = title
        if data and isinstance(data.get("questions"), list):
            _check_size(data)
            _set_questions(ps, data["questions"], student.id)
        db.commit()
        return row("practice", ps, full=True)
    if kind == "plan" and isinstance(payload.get("plan_id"), int):
        plan = get_owned(db, student, "plan", payload["plan_id"])
        plan.saved = True
        db.commit()
        return row("plan", plan, full=True)

    if data is None:
        raise LibraryError("Nothing to save.", 422)
    _check_size(data)
    topic_id = _topic_id(db, course_id, topic)
    if kind == "flashcards":
        obj = AIFlashcardDeck(user_id=student.id, course_id=course_id, topic_id=topic_id, topic=topic, title=title or "Flashcards", description=_s(data.get("description"), 500), source_type=source_type, source_id=source_id, conversation_id=conv_id)
        _set_cards(obj, data.get("cards") or [])
    elif kind == "practice":
        obj = AIPracticeSet(user_id=student.id, course_id=course_id, topic_id=topic_id, topic=topic, title=title or "Practice set", source_type=source_type, source_id=source_id, saved=True)
        _set_questions(obj, data.get("questions") or [], student.id)
    elif kind in ("material", "notes"):
        content = {k: v for k, v in data.items()}
        obj = AIGeneratedMaterial(user_id=student.id, course_id=course_id, topic_id=topic_id, topic=topic, conversation_id=conv_id, source_type=source_type, source_id=source_id, title=title or ("Notes" if kind == "notes" else "Study material"), content=content, material_type="notes" if kind == "notes" else "study_material")
    else:
        obj = new_plan(db, student, data, course_id=course_id, title=title, saved=True)
    db.add(obj)
    db.commit()
    return row(kind, obj, full=True)


def new_plan(db: Session, student: Student, data: dict, *, course_id: int | None, title: str = "", saved: bool = True) -> AIStudyPlan:
    try:
        exam_date = date.fromisoformat(str(data.get("exam_date") or "")[:10])
    except ValueError:
        exam_date = None
    try:
        minutes = max(10, min(int(data.get("minutes_per_day") or 60), 600))
    except (TypeError, ValueError):
        minutes = 60
    plan = AIStudyPlan(user_id=student.id, course_id=course_id, title=title or _s(data.get("title"), 200) or "Study plan", exam_date=exam_date, minutes_per_day=minutes, content={"overview": _s(data.get("overview"), 1500), "tips": [_s(t, 300) for t in (data.get("tips") or [])][:10]}, saved=saved)
    if course_id:
        _PLAN_TOPICS[course_id] = {t.name.lower(): t.id for t in db.execute(select(CourseTopic).where(CourseTopic.course_id == course_id)).scalars()}
    _set_plan_items(plan, data.get("days") or [])
    return plan


def update(db: Session, student: Student, kind: str, item_id: int, payload: dict) -> dict:
    obj = get_owned(db, student, kind, item_id)
    if "title" in payload:
        obj.title = _s(payload.get("title"), 200) or obj.title
    if "topic" in payload and hasattr(obj, "topic"):
        obj.topic = _s(payload.get("topic"), 120)
    data = payload.get("data") if isinstance(payload.get("data"), dict) else None
    if data is not None:
        _check_size(data)
        if kind == "flashcards":
            _set_cards(obj, data.get("cards") or [])
            if "description" in data:
                obj.description = _s(data.get("description"), 500)
        elif kind == "practice":
            _set_questions(obj, data.get("questions") or [], student.id)
        elif kind in ("material", "notes"):
            obj.content = dict(data)
        else:
            if obj.course_id:
                _PLAN_TOPICS[obj.course_id] = {t.name.lower(): t.id for t in db.execute(select(CourseTopic).where(CourseTopic.course_id == obj.course_id)).scalars()}
            _set_plan_items(obj, data.get("days") or [])
            obj.content = {**(obj.content or {}), "overview": _s(data.get("overview", (obj.content or {}).get("overview")), 1500)}
    obj.updated_at = datetime.utcnow()
    db.commit()
    return row(kind, obj, full=True)


def delete(db: Session, student: Student, kind: str, item_id: int) -> None:
    obj = get_owned(db, student, kind, item_id)
    if kind in ("material", "notes"):
        db.delete(obj)
    else:
        db.delete(obj)
    db.commit()


def duplicate(db: Session, student: Student, kind: str, item_id: int) -> dict:
    obj = get_owned(db, student, kind, item_id)
    full = row(kind, obj, full=True)
    data = full["data"]
    # strip ids so the copy gets fresh rows (and fresh review schedules)
    if kind == "flashcards":
        data = {**data, "cards": [{k: v for k, v in c.items() if k not in {"id", "next_review_at", "interval_days"}} for c in data["cards"]]}
    elif kind == "practice":
        data = {**data, "questions": [{k: v for k, v in q.items() if k not in {"id", "times_answered", "times_correct"}} for q in data["questions"]]}
    elif kind == "plan":
        data = {**data, "days": [{"date": d["date"], "items": [{k: v for k, v in i.items() if k not in {"id", "status", "completed"}} for i in d["items"]]} for d in data["days"]]}
    return create(db, student, {"kind": kind, "title": f"{obj.title} (copy)"[:200], "data": data, "course_id": obj.course_id, "topic": getattr(obj, "topic", ""), "source_type": getattr(obj, "source_type", "custom")})


# -------------------------------------------------------- legacy migration
def migrate_legacy_saved(db: Session) -> int:
    """v1 kept decks/sets/materials/notes/plans as JSON in ai_saved_items.
    Move them into the dedicated tables once (uploads stay where they are)."""
    moved = 0
    rows = db.execute(select(AISavedItem).where(AISavedItem.kind.in_(list(KINDS)))).scalars().all()
    for item in rows:
        student = db.get(Student, item.user_id)
        if student is None:
            continue
        data = dict(item.data or {})
        if item.kind == "plan" and "days" not in data:
            # v1 plans were Markdown text
            data = {"title": item.title, "overview": _s(data.get("text") or data.get("content"), 1500), "days": [{"date": item.created_at.date().isoformat(), "items": [{"topic": item.topic or "Plan", "activity": "Follow the plan overview", "duration": 30}]}]}
        try:
            create(db, student, {"kind": item.kind, "title": item.title, "data": data, "course_id": item.course_id, "topic": item.topic, "conversation_id": item.conversation_id})
        except LibraryError:
            continue
        db.delete(item)
        moved += 1
    db.commit()
    return moved
