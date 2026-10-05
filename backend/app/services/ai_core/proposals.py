"""Staff review of AI proposals: approve (all, or selected items, optionally
edited) or reject. Approval re-validates every item with the same validators
the manual editors use, records versions and writes the audit log."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...models import Admin, AIProposal, Course, CourseTopic, Material, MaterialSection, Question
from ..course_bank import ensure_bank_quiz
from ..questions import AnswerValidationError, apply_question_fields, audit, record_version, validate_payload, validate_saved_question


class ProposalError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def public(p: AIProposal, *, full: bool = False) -> dict:
    out: dict[str, Any] = {
        "id": p.id, "kind": p.kind, "course_id": p.course_id, "title": p.title, "summary": p.summary, "status": p.status,
        "count": len((p.payload or {}).get("items") or []), "created_at": p.created_at.isoformat() if p.created_at else None,
        "decided_at": p.decided_at.isoformat() if p.decided_at else None, "result": p.result or {},
        "task_id": (p.payload or {}).get("task_id"),
    }
    if full:
        out["payload"] = p.payload or {}
    return out


def _items(p: AIProposal, selected: list[int] | None, edited: list[dict] | None) -> list[dict]:
    items = list((p.payload or {}).get("items") or [])
    if edited is not None:  # staff may send back the edited list (same order/indices)
        items = [e for e in edited if isinstance(e, dict)][: len(items) + 5]
    if selected is not None:
        wanted = {int(i) for i in selected if str(i).lstrip("-").isdigit()}
        items = [item for index, item in enumerate(items) if index in wanted]
    return items


def approve(db: Session, p: AIProposal, admin: Admin, *, selected: list[int] | None = None, edited: list[dict] | None = None, confirm: bool = False) -> dict:
    if p.status != "pending":
        raise ProposalError("This proposal was already decided.", 409)
    course = db.get(Course, p.course_id) if p.course_id else None
    if course is None:
        raise ProposalError("The course no longer exists.", 404)
    items = _items(p, selected, edited)
    if not items:
        raise ProposalError("Select at least one item to approve.", 422)
    if p.kind == "deletions" and not confirm:
        raise ProposalError(f"Deleting {len(items)} question(s) is permanent — confirm to continue.", 428)
    applier = {"topics": _apply_topics, "questions": _apply_questions, "classification": _apply_classification, "material_topics": _apply_material_topics,
               "edits": _apply_edits, "deletions": _apply_deletions, "material": _apply_material}.get(p.kind)
    if applier is None:
        raise ProposalError("Unknown proposal type.", 422)
    result = applier(db, course, items, admin)
    p.status = "approved"
    p.decided_by = admin.id
    p.decided_at = _now()
    p.result = result
    audit(db, actor=admin.email, action=f"ai_proposal.approve.{p.kind}", target_type="ai_proposal", target_id=p.id, detail={k: v for k, v in result.items() if k != "errors"})
    db.flush()
    return result


def reject(db: Session, p: AIProposal, admin: Admin, reason: str = "") -> None:
    if p.status != "pending":
        raise ProposalError("This proposal was already decided.", 409)
    p.status = "rejected"
    p.decided_by = admin.id
    p.decided_at = _now()
    p.result = {"reason": reason[:300]}
    audit(db, actor=admin.email, action="ai_proposal.reject", target_type="ai_proposal", target_id=p.id, detail={"reason": reason[:300]})
    db.flush()


# ----------------------------------------------------------------- appliers
def _apply_topics(db: Session, course: Course, items: list[dict], admin: Admin) -> dict:
    existing = {t.name.lower(): t for t in db.execute(select(CourseTopic).where(CourseTopic.course_id == course.id)).scalars()}
    position = (db.execute(select(func.max(CourseTopic.position)).where(CourseTopic.course_id == course.id)).scalar_one() or 0) + 1
    created, skipped = [], []
    for item in items:
        name = str(item.get("name") or "").strip()[:120]
        if not name:
            continue
        if name.lower() in existing:
            skipped.append(name)
            continue
        objectives = [str(o)[:200] for o in item.get("learning_objectives") or []][:8]
        description = str(item.get("description") or "").strip()
        if objectives and len(description) < 300:
            description = (description + (" Objectives: " if description else "Objectives: ") + "; ".join(objectives))
        topic = CourseTopic(course_id=course.id, name=name, description=description[:400], position=position)
        db.add(topic)
        existing[name.lower()] = topic
        position += 1
        created.append(name)
    db.flush()
    return {"created": len(created), "topics": created, "skipped_existing": skipped}


def _apply_questions(db: Session, course: Course, items: list[dict], admin: Admin) -> dict:
    bank = ensure_bank_quiz(db, course)
    position = (db.execute(select(func.max(Question.position)).where(Question.quiz_id == bank.id)).scalar_one() or 0) + 1
    created, errors = [], []
    fields = ("text", "option_a", "option_b", "option_c", "option_d", "correct", "explanation", "topic", "subtopic", "difficulty", "objective", "source")
    for index, item in enumerate(items):
        data = {k: item.get(k) for k in fields if item.get(k) not in (None, "")}
        data.update({"quiz_id": bank.id, "course_id": course.id, "question_type": "mcq"})
        data.setdefault("source", "AI draft (staff approved)")
        try:
            cleaned = validate_payload(data, require_answer=True)
        except AnswerValidationError as error:
            errors.append(f"#{index + 1}: {error.message}")
            continue
        except ValueError as error:
            errors.append(f"#{index + 1}: {error}")
            continue
        cleaned.pop("quiz_id", None)
        cleaned.pop("course_id", None)
        q = Question(quiz_id=bank.id, course_id=course.id, position=position, created_by=admin.email, updated_by=admin.email, exam_only=False, **cleaned)
        db.add(q)
        db.flush()
        validate_saved_question(q)
        record_version(db, q, note="Created from AI proposal", author=admin.email)
        position += 1
        created.append(q.id)
    return {"created": len(created), "question_ids": created, "errors": errors}


def _apply_classification(db: Session, course: Course, items: list[dict], admin: Admin) -> dict:
    updated, errors = [], []
    for item in items:
        q = db.get(Question, int(item.get("question_id") or 0))
        if q is None or q.course_id != course.id:
            errors.append(f"question {item.get('question_id')} not found in {course.code}")
            continue
        change = {k: v for k, v in (item.get("after") or {}).items() if k in {"topic", "subtopic", "difficulty", "objective"} and isinstance(v, str)}
        if not change:
            continue
        try:
            apply_question_fields(db, q, change, author=admin.email, note="AI classification (staff approved)")
        except (AnswerValidationError, ValueError) as error:
            errors.append(f"question {q.id}: {getattr(error, 'message', str(error))}")
            continue
        updated.append(q.id)
    return {"updated": len(updated), "question_ids": updated, "errors": errors}


def _apply_material_topics(db: Session, course: Course, items: list[dict], admin: Admin) -> dict:
    updated, errors = [], []
    for item in items:
        m = db.get(Material, int(item.get("material_id") or 0))
        if m is None or m.course_id != course.id:
            errors.append(f"material {item.get('material_id')} not found in {course.code}")
            continue
        topic = str(item.get("after") or "").strip()[:120]
        if not topic or topic == (m.topic or ""):
            continue
        m.topic = topic
        m.updated_at = _now()
        updated.append(m.id)
    db.flush()
    return {"updated": len(updated), "material_ids": updated, "errors": errors}


EDIT_FIELDS = ("text", "option_a", "option_b", "option_c", "option_d", "correct", "explanation", "topic", "subtopic", "difficulty", "objective")


def _apply_edits(db: Session, course: Course, items: list[dict], admin: Admin) -> dict:
    updated, errors = [], []
    for item in items:
        q = db.get(Question, int(item.get("question_id") or 0))
        if q is None or q.course_id != course.id:
            errors.append(f"question {item.get('question_id')} not found in {course.code}")
            continue
        change = {k: v for k, v in (item.get("after") or {}).items() if k in EDIT_FIELDS and isinstance(v, str) and v.strip()}
        if not change:
            continue
        try:
            apply_question_fields(db, q, change, author=admin.email, note="AI edit (staff approved)")
        except (AnswerValidationError, ValueError) as error:
            errors.append(f"question {q.id}: {getattr(error, 'message', str(error))}")
            continue
        updated.append(q.id)
    return {"updated": len(updated), "question_ids": updated, "errors": errors}


def _apply_deletions(db: Session, course: Course, items: list[dict], admin: Admin) -> dict:
    deleted, errors = [], []
    for item in items:
        q = db.get(Question, int(item.get("question_id") or 0))
        if q is None or q.course_id != course.id:
            errors.append(f"question {item.get('question_id')} not found in {course.code}")
            continue
        audit(db, actor=admin.email, action="question.delete", target_type="question", target_id=q.id,
              detail={"text": (q.text or "")[:120], "correct": q.correct, "via": "ai_proposal", "reason": str(item.get("reason") or "")[:200]})
        db.delete(q)
        deleted.append(int(item["question_id"]))
    db.flush()
    return {"deleted": len(deleted), "question_ids": deleted, "errors": errors}


def _apply_material(db: Session, course: Course, items: list[dict], admin: Admin) -> dict:
    """Each item is one complete material: title, topic, summary and sections
    of typed blocks. Saved published so students can read it straight away."""
    import json as _json

    from ..materials import record_version as record_material_version, sanitise_blocks

    created, errors = [], []
    for index, item in enumerate(items):
        title = str(item.get("title") or "").strip()[:200]
        sections = [s for s in item.get("sections") or [] if isinstance(s, dict)]
        if not title or not sections:
            errors.append(f"#{index + 1}: a material needs a title and at least one section")
            continue
        summary = [str(x).strip()[:300] for x in item.get("summary") or [] if str(x).strip()][:12]
        words = sum(len(str(b.get("text") or " ".join(map(str, b.get("items") or []))).split()) for s in sections for b in s.get("blocks") or [] if isinstance(b, dict))
        m = Material(course_id=course.id, title=title, kind="material", topic=str(item.get("topic") or "").strip()[:120],
                     description=str(item.get("description") or "").strip()[:500], difficulty="intermediate",
                     estimated_minutes=max(3, min(240, round(words / 180))), summary=_json.dumps(summary), tags=_json.dumps(["AI notes"]),
                     author=f"AI notes · approved by {admin.email}"[:120], status="published")
        db.add(m)
        db.flush()
        for pos, sec in enumerate(sections[:60], start=1):
            blocks = sanitise_blocks(sec.get("blocks") or [])
            if not blocks:
                continue
            sw = sum(len(str(b.get("text") or " ".join(map(str, b.get("items") or []))).split()) for b in blocks)
            db.add(MaterialSection(material_id=m.id, position=pos, title=str(sec.get("title") or f"Part {pos}")[:200],
                                   body=_json.dumps(blocks), estimated_minutes=max(1, round(sw / 180))))
        db.flush()
        record_material_version(db, m, note="Created from AI proposal", author=admin.email)
        created.append(m.id)
    return {"created": len(created), "material_ids": created, "errors": errors}
