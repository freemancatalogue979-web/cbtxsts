"""Materials: reading, progress, highlights, notes, bookmarks, discussion, self-test.

Player surface lives under ``/api/materials``; staff authoring under
``/api/admin/materials``. Both share the same validation and sanitisation, and
every reward is decided here on the server.
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_admin, require_student
from ..events import dispatch, to_student
from ..models import (
    Admin,
    ContentReport,
    Course,
    Material,
    MaterialBookmark,
    MaterialConfusion,
    MaterialFeedback,
    MaterialHighlight,
    MaterialNote,
    MaterialPost,
    MaterialProgress,
    MaterialQuestion,
    MaterialSection,
    MaterialVersion,
    Question,
    Student,
    StudyStreak,
    utcnow,
)
from ..schemas import (
    MaterialBookmarkIn,
    MaterialConfusionIn,
    MaterialFeedbackIn,
    MaterialHighlightIn,
    MaterialIn,
    MaterialNoteIn,
    MaterialNoteUpdate,
    MaterialPostIn,
    MaterialLinkQuestionsIn,
    MaterialProgressIn,
    MaterialSectionIn,
    SelfTestAnswerIn,
)
from ..serializers import question_public
from ..services import materials as engine

router = APIRouter(prefix="/materials", tags=["materials"])
admin_router = APIRouter(prefix="/admin/materials", tags=["materials-admin"])
# Original uploaded documents (download / open in a new tab). Separate prefix so
# it can never collide with /materials/{material_id}/... routes.
files_router = APIRouter(prefix="/material-files", tags=["materials"])


def _loads(raw: str | None, fallback: Any) -> Any:
    try:
        return json.loads(raw or "")
    except (TypeError, ValueError):
        return fallback


def _material_or_404(db: Session, material_id: int, *, published_only: bool = True) -> Material:
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material not found.")
    if published_only and material.status != "published":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material not found.")
    return material


def _sections(db: Session, material_id: int) -> list[MaterialSection]:
    return list(
        db.scalars(
            select(MaterialSection).where(MaterialSection.material_id == material_id).order_by(MaterialSection.position)
        ).all()
    )


def _course_name(db: Session, course_id: int | None) -> str:
    if not course_id:
        return ""
    course = db.get(Course, course_id)
    return course.title if course else ""


# ===========================================================================
# Player surface
# ===========================================================================
@router.get("")
def library(
    course_id: int | None = Query(None),
    topic: str = Query(""),
    search: str = Query(""),
    difficulty: str = Query(""),
    kind: str = Query("", pattern="^(|material|note)$"),
    limit: int = Query(40, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Published materials for the player's library, with their progress."""
    stmt = select(Material).where(Material.status == "published")
    if course_id:
        stmt = stmt.where(Material.course_id == course_id)
    if kind:
        stmt = stmt.where(Material.kind == kind)
    if topic:
        stmt = stmt.where(func.lower(Material.topic) == topic.lower())
    if difficulty:
        stmt = stmt.where(Material.difficulty == difficulty)
    if search.strip():
        needle = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Material.title).like(needle),
                func.lower(Material.description).like(needle),
                func.lower(Material.topic).like(needle),
                func.lower(Material.tags).like(needle),
            )
        )
    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = list(db.scalars(stmt.order_by(Material.updated_at.desc()).limit(limit).offset(offset)).all())

    progress_rows = {
        row.material_id: row
        for row in db.scalars(
            select(MaterialProgress).where(
                MaterialProgress.student_id == student.id,
                MaterialProgress.material_id.in_([row.id for row in rows] or [0]),
            )
        ).all()
    }
    items = []
    for material in rows:
        sections = _sections(db, material.id)
        payload = engine.material_public(material, sections=sections, full=False)
        payload["progress"] = engine.progress_public(progress_rows.get(material.id), len(sections))
        payload["course_title"] = _course_name(db, material.course_id)
        items.append(payload)

    topics = [
        {"topic": topic_name, "count": count}
        for topic_name, count in db.execute(
            select(Material.topic, func.count(Material.id))
            .where(Material.status == "published", Material.topic != "")
            .group_by(Material.topic)
            .order_by(func.count(Material.id).desc())
            .limit(30)
        ).all()
    ]
    return {"items": items, "total": total, "limit": limit, "offset": offset, "topics": topics}


@router.get("/mine")
def my_learning(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """MY LEARNING: continue reading, bookmarks, notes, confusions, completed."""
    progress_rows = list(
        db.scalars(
            select(MaterialProgress)
            .where(MaterialProgress.student_id == student.id)
            .order_by(MaterialProgress.updated_at.desc())
            .limit(60)
        ).all()
    )
    materials = {
        row.id: row
        for row in db.scalars(select(Material).where(Material.id.in_([p.material_id for p in progress_rows] or [0]))).all()
    }
    continue_reading = []
    completed = []
    for row in progress_rows:
        material = materials.get(row.material_id)
        if material is None or material.status != "published":
            continue
        sections = _sections(db, material.id)
        card = {
            "material_id": material.id,
            "title": material.title,
            "topic": material.topic,
            "icon": material.icon,
            "accent": material.accent,
            "estimated_minutes": material.estimated_minutes,
            "sections": len(sections),
            "progress": engine.progress_public(row, len(sections)),
            "course_title": _course_name(db, material.course_id),
        }
        (completed if row.status == "completed" else continue_reading).append(card)

    bookmarks = []
    for row in db.scalars(
        select(MaterialBookmark)
        .where(MaterialBookmark.student_id == student.id)
        .order_by(MaterialBookmark.created_at.desc())
        .limit(60)
    ).all():
        material = db.get(Material, row.material_id)
        if material is None:
            continue
        bookmarks.append(
            {
                "id": row.id,
                "material_id": row.material_id,
                "material_title": material.title,
                "section_id": row.section_id,
                "label": row.label,
                "snippet": row.snippet,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
        )

    notes = [
        {
            "id": row.id,
            "material_id": row.material_id,
            "material_title": (db.get(Material, row.material_id).title if db.get(Material, row.material_id) else ""),
            "section_id": row.section_id,
            "body": row.body,
            "quote": row.quote,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in db.scalars(
            select(MaterialNote)
            .where(MaterialNote.student_id == student.id)
            .order_by(MaterialNote.created_at.desc())
            .limit(80)
        ).all()
    ]

    confusions = [
        {
            "id": row.id,
            "material_id": row.material_id,
            "material_title": (db.get(Material, row.material_id).title if db.get(Material, row.material_id) else ""),
            "section_id": row.section_id,
            "quote": row.quote,
            "question": row.question,
            "status": row.status,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in db.scalars(
            select(MaterialConfusion)
            .where(MaterialConfusion.student_id == student.id)
            .order_by(MaterialConfusion.created_at.desc())
            .limit(80)
        ).all()
    ]

    highlights = [
        {
            "id": row.id,
            "material_id": row.material_id,
            "section_id": row.section_id,
            "text": row.text,
            "colour": row.colour,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in db.scalars(
            select(MaterialHighlight)
            .where(MaterialHighlight.student_id == student.id)
            .order_by(MaterialHighlight.created_at.desc())
            .limit(120)
        ).all()
    ]

    return {
        "continue_reading": continue_reading,
        "completed": completed,
        "bookmarks": bookmarks,
        "notes": notes,
        "confusions": confusions,
        "highlights": highlights,
        "streak": engine.streak_public(db, student.id),
    }


@router.get("/search")
def search_materials(
    q: str = Query(min_length=2),
    limit: int = Query(20, ge=1, le=60),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Search inside materials: title, description, section titles and section text."""
    needle = f"%{q.strip().lower()}%"
    matches: list[dict] = []
    materials = db.scalars(select(Material).where(Material.status == "published")).all()
    for material in materials:
        hits: list[dict] = []
        if q.lower() in (material.title or "").lower() or q.lower() in (material.topic or "").lower():
            hits.append({"section_id": None, "section_title": material.title, "snippet": material.description})
        for section in _sections(db, material.id):
            text = engine._blocks_text(_loads(section.body, []))
            if q.lower() in section.title.lower() or q.lower() in text.lower():
                index = text.lower().find(q.lower())
                snippet = text[max(0, index - 60) : index + 140].strip() if index >= 0 else text[:160]
                hits.append({"section_id": section.id, "section_title": section.title, "snippet": snippet})
        if hits:
            matches.append(
                {
                    "material_id": material.id,
                    "title": material.title,
                    "topic": material.topic,
                    "icon": material.icon,
                    "accent": material.accent,
                    "hits": hits[:6],
                }
            )
        if len(matches) >= limit:
            break
    return {"query": q, "results": matches}


@router.get("/glossary")
def glossary(topic: str = Query(""), db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """Every key term defined across published materials (optionally one topic)."""
    stmt = select(Material).where(Material.status == "published")
    if topic:
        stmt = stmt.where(func.lower(Material.topic) == topic.lower())
    terms: list[dict] = []
    seen: set[str] = set()
    for material in db.scalars(stmt.limit(80)).all():
        for section in _sections(db, material.id):
            for block in engine.sanitise_blocks(_loads(section.body, [])):
                if block.get("type") != "keyterm":
                    continue
                term = str(block.get("term") or "").strip()
                if not term or term.lower() in seen:
                    continue
                seen.add(term.lower())
                terms.append(
                    {
                        "term": term,
                        "meaning": block.get("meaning", ""),
                        "material_id": material.id,
                        "material_title": material.title,
                        "section_id": section.id,
                    }
                )
    terms.sort(key=lambda row: row["term"].lower())
    return {"terms": terms[:400]}


@router.get("/{material_id}/staff-notes")
def material_staff_notes(
    material_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)
) -> dict:
    """Published notes staff attached to this material (its Notes tab)."""
    _material_or_404(db, material_id)
    notes = db.scalars(
        select(Material)
        .where(Material.parent_id == material_id, Material.status == "published")
        .order_by(Material.updated_at.desc())
        .limit(100)
    ).all()
    return {"notes": [engine.material_public(row, sections=_sections(db, row.id), full=True) for row in notes]}


@router.get("/{material_id}")
def read_material(
    material_id: int,
    section: int | None = Query(None),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Open a material: sections, my progress, marks, notes, linked questions."""
    material = _material_or_404(db, material_id)
    sections = _sections(db, material_id)
    progress = engine.get_progress(db, material_id, student.id)
    material.views = (material.views or 0) + 1

    highlights = [
        {"id": row.id, "section_id": row.section_id, "text": row.text, "colour": row.colour}
        for row in db.scalars(
            select(MaterialHighlight).where(
                MaterialHighlight.student_id == student.id, MaterialHighlight.material_id == material_id
            )
        ).all()
    ]
    notes = [
        _note_public(row)
        for row in db.scalars(
            select(MaterialNote)
            .where(MaterialNote.student_id == student.id, MaterialNote.material_id == material_id)
            .order_by(MaterialNote.updated_at.desc(), MaterialNote.id.desc())
        ).all()
    ]
    bookmarks = [
        {"id": row.id, "section_id": row.section_id, "label": row.label, "snippet": row.snippet}
        for row in db.scalars(
            select(MaterialBookmark).where(
                MaterialBookmark.student_id == student.id, MaterialBookmark.material_id == material_id
            )
        ).all()
    ]
    linked = engine.material_questions(db, material)
    db.commit()

    payload = engine.material_public(material, sections=sections, full=True)
    payload["progress"] = engine.progress_public(progress, len(sections))
    payload["course_title"] = _course_name(db, material.course_id)
    payload["highlights"] = highlights
    payload["notes"] = notes
    payload["bookmarks"] = bookmarks
    payload["streak"] = engine.streak_public(db, student.id)
    payload["questions"] = {
        "linked": len(linked),
        "hard": sum(1 for row in linked if (row.difficulty or "").lower() == "hard"),
        "average_accuracy": round(
            (sum((row.correct_count or 0) / row.usage_count * 100 for row in linked if (row.usage_count or 0) > 0)
             / max(1, sum(1 for row in linked if (row.usage_count or 0) > 0))),
            1,
        )
        if linked
        else 0,
    }
    visited = set(_loads(progress.visited, [])) if progress else set()
    payload["sections"] = [
        {**section, "percent": 100 if section["id"] in visited else 0} for section in payload["sections"]
    ]
    if section:
        payload["focus_section"] = section
    return payload


@router.post("/{material_id}/progress")
async def save_progress(
    material_id: int,
    payload: MaterialProgressIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Advance reading progress. Rewards are idempotent and time-gated."""
    material = _material_or_404(db, material_id)
    sections = _sections(db, material_id)
    if not sections:
        raise HTTPException(status.HTTP_409_CONFLICT, "This material has no sections yet.")
    valid_ids = {row.id for row in sections}
    section_id = payload.section_id if payload.section_id in valid_ids else None
    progress = engine.ensure_progress(db, material, student.id)
    visited = [int(value) for value in _loads(progress.visited, []) if str(value).isdigit()]

    rewarded = [int(value) for value in _loads(progress.rewarded_sections, []) if str(value).isdigit()]
    rewards: list[dict] = []
    seconds = max(0, min(3_600, int(payload.seconds or 0)))

    # First open pays once, and only for a real material.
    if not progress.rewarded_start:
        progress.rewarded_start = True
        rewards.append(
            engine.award_study_xp(
                db, student, amount=engine.STUDY_XP["start"], reason="material", reason_key=f"material:start:{material.id}"
            )
        )

    if section_id and section_id not in visited:
        visited.append(section_id)
    if section_id and section_id not in rewarded and seconds >= engine.SECTION_REWARD_MIN_SECONDS:
        rewarded.append(section_id)
        rewards.append(
            engine.award_study_xp(
                db,
                student,
                amount=engine.STUDY_XP["section"],
                reason="section",
                reason_key=f"material:section:{material.id}:{section_id}",
            )
        )

    progress.visited = json.dumps(visited)
    progress.rewarded_sections = json.dumps(rewarded)
    progress.seconds_spent = (progress.seconds_spent or 0) + seconds
    if section_id:
        progress.last_section_id = section_id
        progress.last_section_position = next((row.position for row in sections if row.id == section_id), 1)
    done = len(visited)
    progress.percent = max(progress.percent or 0, min(100, round(done / max(1, len(sections)) * 100)))
    progress.updated_at = utcnow()

    # Meaningful completion: most sections visited (not "scrolled to the end").
    if progress.status != "completed" and done >= max(1, round(len(sections) * engine.COMPLETION_MIN_FRACTION)):
        progress.status = "completed"
        progress.percent = 100
        progress.completed_at = utcnow()
        material.completions = (material.completions or 0) + 1
        if not progress.rewarded_completion:
            progress.rewarded_completion = True
            rewards.append(
                engine.award_study_xp(
                    db,
                    student,
                    amount=engine.STUDY_XP["completion"],
                    reason="material",
                    reason_key=f"material:done:{material.id}",
                )
            )
        if engine.grant_bonus_playtime(
            db, student.id, seconds=engine.PLAYTIME_COMPLETION_BONUS, key=f"material:{material.id}:{engine.today()}"
        ):
            rewards.append({"type": "playtime", "amount": engine.PLAYTIME_COMPLETION_BONUS, "reason": "Material finished"})

    if seconds:
        engine.touch_streak(db, student.id, seconds)

    bank = engine.playtime_for(db, student.id)
    profile = None
    db.commit()
    from ..serializers import student_profile

    profile = student_profile(db, student)
    if rewards:
        # Emit the same reward shape the rest of the app celebrates (type/amount).
        events = [
            {"type": "xp", "amount": int(row.get("awarded") or row.get("amount") or 0), "reason": row.get("reason") or "study"}
            for row in rewards
            if int(row.get("awarded") or row.get("amount") or 0) > 0
        ]
        if events:
            await dispatch([to_student(student.id, "reward", {"rewards": events})])
    return {
        "progress": engine.progress_public(progress, len(sections)),
        "rewards": rewards,
        "playtime": engine._bank_view(bank),
        "streak": engine.streak_public(db, student.id),
        "profile": profile,
    }


@router.post("/{material_id}/feedback")
def feedback(
    material_id: int,
    payload: MaterialFeedbackIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    _material_or_404(db, material_id)
    row = db.scalar(
        select(MaterialFeedback).where(
            MaterialFeedback.material_id == material_id, MaterialFeedback.student_id == student.id
        )
    )
    if row is None:
        row = MaterialFeedback(material_id=material_id, student_id=student.id)
        db.add(row)
    row.verdict = payload.verdict if payload.verdict in {"yes", "somewhat", "no"} else "somewhat"
    row.comment = (payload.comment or "")[:400]
    db.commit()
    return {"ok": True, "verdict": row.verdict}


# ------------------------------------------------------------------ highlights
@router.post("/{material_id}/highlights")
def add_highlight(
    material_id: int,
    payload: MaterialHighlightIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    _material_or_404(db, material_id)
    text = engine.clean_text(payload.text, 2000)
    if len(text) < 3:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Select some text to highlight first.")
    colour = payload.colour if payload.colour in engine.HIGHLIGHT_COLOURS else "yellow"
    row = MaterialHighlight(
        material_id=material_id,
        section_id=payload.section_id,
        student_id=student.id,
        text=text,
        colour=colour,
        note=engine.clean_text(payload.note, 300),
    )
    db.add(row)
    db.commit()
    return {"id": row.id, "text": row.text, "colour": row.colour, "section_id": row.section_id}


@router.delete("/{material_id}/highlights/{highlight_id}")
def remove_highlight(
    material_id: int,
    highlight_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    row = db.get(MaterialHighlight, highlight_id)
    if row is None or row.student_id != student.id or row.material_id != material_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Highlight not found.")
    db.delete(row)
    db.commit()
    return {"ok": True}


# ----------------------------------------------------------------------- notes
# A player's own notes on a material (the reader's "My notes" tab): create,
# list, read, edit, delete. Undo is done by the client replaying the inverse.
def _note_public(row: MaterialNote) -> dict:
    return {
        "id": row.id,
        "section_id": row.section_id,
        "title": row.title or "",
        "body": row.body,
        "quote": row.quote,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": (row.updated_at or row.created_at).isoformat() if (row.updated_at or row.created_at) else None,
    }


def _my_note_or_404(db: Session, material_id: int, note_id: int, student: Student) -> MaterialNote:
    row = db.get(MaterialNote, note_id)
    if row is None or row.student_id != student.id or row.material_id != material_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found.")
    return row


@router.get("/{material_id}/notes")
def list_notes(material_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    _material_or_404(db, material_id)
    rows = db.scalars(
        select(MaterialNote)
        .where(MaterialNote.student_id == student.id, MaterialNote.material_id == material_id)
        .order_by(MaterialNote.updated_at.desc(), MaterialNote.id.desc())
    ).all()
    return {"notes": [_note_public(row) for row in rows]}


@router.get("/{material_id}/notes/{note_id}")
def read_note(material_id: int, note_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    return _note_public(_my_note_or_404(db, material_id, note_id, student))


@router.patch("/{material_id}/notes/{note_id}")
def edit_note(
    material_id: int,
    note_id: int,
    payload: MaterialNoteUpdate,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    row = _my_note_or_404(db, material_id, note_id, student)
    if payload.body is not None:
        body = engine.clean_text(payload.body, 20000)
        if not body:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A note can't be empty — delete it instead.")
        row.body = body
    if payload.title is not None:
        row.title = engine.clean_text(payload.title, 200)
    if "section_id" in payload.model_fields_set:
        row.section_id = payload.section_id
    row.updated_at = utcnow()
    db.commit()
    return _note_public(row)


@router.post("/{material_id}/notes")
def add_note(
    material_id: int,
    payload: MaterialNoteIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    _material_or_404(db, material_id)
    body = engine.clean_text(payload.body, 20000)
    if not body:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Write something in your note first.")
    now = utcnow()
    row = MaterialNote(
        material_id=material_id,
        section_id=payload.section_id,
        student_id=student.id,
        title=engine.clean_text(payload.title, 200),
        body=body,
        quote=engine.clean_text(payload.quote, 600),
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    return _note_public(row)


@router.delete("/{material_id}/notes/{note_id}")
def delete_note(
    material_id: int, note_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)
) -> dict:
    row = _my_note_or_404(db, material_id, note_id, student)
    db.delete(row)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------- bookmarks
@router.post("/{material_id}/bookmarks")
def add_bookmark(
    material_id: int,
    payload: MaterialBookmarkIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    _material_or_404(db, material_id)
    row = MaterialBookmark(
        material_id=material_id,
        section_id=payload.section_id,
        student_id=student.id,
        label=engine.clean_text(payload.label, 200),
        snippet=engine.clean_text(payload.snippet, 600),
        position=(payload.position or "")[:40],
    )
    db.add(row)
    db.commit()
    return {"id": row.id, "label": row.label, "section_id": row.section_id}


@router.delete("/{material_id}/bookmarks/{bookmark_id}")
def delete_bookmark(
    material_id: int, bookmark_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)
) -> dict:
    row = db.get(MaterialBookmark, bookmark_id)
    if row is None or row.student_id != student.id or row.material_id != material_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bookmark not found.")
    db.delete(row)
    db.commit()
    return {"ok": True}


# -------------------------------------------------------------------- confusion
@router.post("/{material_id}/confusions")
async def add_confusion(
    material_id: int,
    payload: MaterialConfusionIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """I DON'T UNDERSTAND — saved to the queue, optionally sent to friends/groups."""
    material = _material_or_404(db, material_id)
    question = engine.clean_text(payload.question, 600) or "Can someone explain this in simple terms?"
    row = MaterialConfusion(
        material_id=material_id,
        section_id=payload.section_id,
        student_id=student.id,
        quote=engine.clean_text(payload.quote, 800),
        question=question,
        shared_with=json.dumps([int(value) for value in (payload.friend_ids or []) if str(value).isdigit()][:20]),
        group_id=payload.group_id,
    )
    db.add(row)
    db.commit()

    shared = [int(value) for value in (payload.friend_ids or []) if str(value).isdigit()][:20]
    if shared:
        from ..models import ChatMessage

        for friend_id in shared:
            db.add(
                ChatMessage(
                    sender_id=student.id,
                    recipient_id=friend_id,
                    kind="text",
                    body=f"📚 “{question}”\n— {material.title}: {row.quote[:200]}",
                    meta=json.dumps({"material_id": material.id, "section_id": row.section_id}),
                )
            )
        db.commit()
        await dispatch([to_student(friend_id, "chat", {"sender_name": student.name, "kind": "text", "body": question, "sender_id": student.id, "id": 0}) for friend_id in shared])

    return {"id": row.id, "question": row.question, "shared_with": shared, "status": row.status}


@router.post("/{material_id}/confusions/{confusion_id}/resolve")
def resolve_confusion(
    material_id: int,
    confusion_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    row = db.get(MaterialConfusion, confusion_id)
    if row is None or row.student_id != student.id or row.material_id != material_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That question is not in your queue.")
    row.status = "resolved"
    reward = engine.award_study_xp(
        db, student, amount=engine.STUDY_XP["confusion_resolved"], reason="confusion", reason_key=f"confusion:{row.id}"
    )
    db.commit()
    return {"ok": True, "status": row.status, "reward": reward}


# ------------------------------------------------------------------- discussion
@router.get("/{material_id}/discussion")
def discussion(
    material_id: int,
    section_id: int | None = Query(None),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    _material_or_404(db, material_id)
    stmt = select(MaterialPost).where(MaterialPost.material_id == material_id)
    if section_id:
        stmt = stmt.where(MaterialPost.section_id == section_id)
    rows = list(db.scalars(stmt.order_by(MaterialPost.created_at.asc()).limit(200)).all())
    names = {row.id: row.name for row in db.scalars(select(Student)).all()}
    return {
        "posts": [
            {
                "id": row.id,
                "student_id": row.student_id,
                "name": names.get(row.student_id or 0, "Player"),
                "section_id": row.section_id,
                "parent_id": row.parent_id,
                "kind": row.kind,
                "body": row.body,
                "quote": row.quote,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ]
    }


@router.post("/{material_id}/discussion")
async def post_discussion(
    material_id: int,
    payload: MaterialPostIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    material = _material_or_404(db, material_id)
    if not material.allow_discussion:
        raise HTTPException(status.HTTP_409_CONFLICT, "Discussion is closed on this material.")
    body = engine.clean_text(payload.body, 1500)
    if not body:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Write your question or reply first.")
    row = MaterialPost(
        material_id=material_id,
        section_id=payload.section_id,
        student_id=student.id,
        parent_id=payload.parent_id,
        kind=payload.kind if payload.kind in {"question", "answer", "tip"} else "question",
        body=body,
        quote=engine.clean_text(payload.quote, 600),
    )
    db.add(row)
    # Answering someone else's question is what earns XP here.
    reward = {"awarded": 0}
    if payload.parent_id:
        parent = db.get(MaterialPost, payload.parent_id)
        if parent and parent.student_id and parent.student_id != student.id:
            reward = engine.award_study_xp(
                db,
                student,
                amount=engine.STUDY_XP["discussion"],
                reason="discussion",
                reason_key=f"discussion:{parent.id}:{student.id}",
            )
            await dispatch(
                [
                    to_student(
                        parent.student_id,
                        "notify",
                        {
                            "id": 0,
                            "kind": "help",
                            "title": f"{student.name} answered your question",
                            "message": body[:120],
                            "read": False,
                            "created_at": datetime.utcnow().isoformat() + "Z",
                        },
                    )
                ]
            )
    db.commit()
    return {"id": row.id, "body": row.body, "kind": row.kind, "reward": reward}


@router.post("/{material_id}/report")
def report_material(
    material_id: int,
    payload: MaterialFeedbackIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Report confusing / incorrect / outdated content to the moderation queue."""
    _material_or_404(db, material_id)
    report = ContentReport(
        kind="material",
        target_id=material_id,
        reporter_id=student.id,
        reason=(payload.comment or payload.verdict or "reported")[:400],
        status="open",
    )
    db.add(report)
    db.commit()
    return {"ok": True, "report_id": report.id}


@router.get("/{material_id}/exam-prep")
def exam_prep(material_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """Prepare for Exam: key terms, linked questions, flashcards and practice."""
    material = _material_or_404(db, material_id)
    sections = _sections(db, material_id)
    terms: list[dict] = []
    for section in sections:
        for block in engine.sanitise_blocks(_loads(section.body, [])):
            if block.get("type") == "keyterm" and block.get("term"):
                terms.append({"term": block["term"], "meaning": block.get("meaning", ""), "section_id": section.id})
    linked = engine.material_questions(db, material)
    return {
        "material_id": material.id,
        "title": material.title,
        "summary": engine.summary_points(material.summary),
        "key_terms": terms[:40],
        "sections": [{"id": row.id, "title": row.title, "position": row.position} for row in sections],
        "questions": {"count": len(linked), "pool": "material"},
        "flashcards": {"topic": material.topic, "count": max(0, len(linked))},
        "topics": [material.topic] if material.topic else [],
    }


# ===========================================================================
# Self-test: build a short quiz from the material's questions
# ===========================================================================
@router.post("/{material_id}/flashcards")
def material_flashcards(
    material_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)
) -> dict:
    """Make (or reuse) a flashcard deck for this material.

    The cards are the same ``Question`` rows the self-test grades against, so a
    card's answer and the exam key can never drift apart.
    """
    from ..models import FlashcardCard, FlashcardDeck

    material = _material_or_404(db, material_id)
    pool = engine.material_questions(db, material)
    if not pool:
        raise HTTPException(status.HTTP_409_CONFLICT, "No questions are linked to this material yet.")
    existing = next(
        (
            row
            for row in db.scalars(
                select(FlashcardDeck).where(FlashcardDeck.owner_id == student.id, FlashcardDeck.kind == "custom")
            ).all()
            if isinstance(row.config, dict) and row.config.get("material_id") == material.id
        ),
        None,
    )
    if existing is not None:
        deck = existing
    else:
        deck = FlashcardDeck(
            owner_id=student.id,
            name=f"{material.title[:100]} · flashcards",
            description=f"Made from the {material.title} material",
            kind="custom",
            config={"material_id": material.id, "question_ids": [row.id for row in pool], "limit": 60},
            is_public=False,
        )
        db.add(deck)
        db.flush()
        from .flashcards import _fill_deck

        _fill_deck(db, deck, student)
    db.commit()
    cards = int(db.scalar(select(func.count(FlashcardCard.id)).where(FlashcardCard.deck_id == deck.id)) or 0)
    return {"deck_id": deck.id, "name": deck.name, "cards": cards, "created": existing is None}


@router.post("/{material_id}/self-test")
def self_test(
    material_id: int,
    size: int = Query(5, ge=1, le=20),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """TEST MYSELF — a server-graded quiz drawn from this material's questions."""
    import random as _random

    material = _material_or_404(db, material_id)
    pool = engine.material_questions(db, material)
    if not pool:
        raise HTTPException(status.HTTP_409_CONFLICT, "No questions are linked to this material yet.")
    chosen = _random.sample(pool, k=min(size, len(pool)))
    return {
        "material_id": material.id,
        "title": material.title,
        "size": len(chosen),
        "questions": [question_public(row, reveal=False) for row in chosen],
        "answer_endpoint": f"/api/materials/{material_id}/self-test/answer",
    }


@router.post("/{material_id}/self-test/answer")
def self_test_answer(
    material_id: int,
    payload: SelfTestAnswerIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Grade one self-test answer server-side against ``Question.correct``.

    The key never leaves the server before the answer is in: ``is_correct`` is
    the verdict, ``correct`` the stored letter, exactly as the exam engine does.
    """
    from ..services.questions import AnswerValidationError, answer_matches, normalize_answer

    material = _material_or_404(db, material_id)
    question = db.get(Question, payload.question_id)
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found.")
    try:
        # Reject nonsense ("E", "5", "banana") instead of quietly marking it wrong.
        choice = normalize_answer(payload.choice, allow_multi=len(question.correct or "") > 1)
        # Grading is the shared primitive: Question.correct is the only key.
        is_right = answer_matches(question.correct, choice)
    except AnswerValidationError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, error.message) from error

    reward = {"awarded": 0}
    if is_right:
        reward = engine.award_study_xp(
            db,
            student,
            amount=1,
            reason="check",
            reason_key=f"selftest:{material.id}:{question.id}:{engine.today()}",
        )
    db.commit()
    return {
        "is_correct": is_right,
        "chosen": choice,
        "correct": question.correct,
        "explanation": question.explanation,
        "reward": reward,
        "playtime": engine._bank_view(engine.playtime_for(db, student.id)),
    }


# ===========================================================================
# Staff surface
# ===========================================================================
@admin_router.get("")
def admin_list(
    status_filter: str = Query("", alias="status"),
    course_id: int | None = Query(None),
    kind: str = Query("", pattern="^(|material|note)$"),
    topic: str = Query(""),
    q: str = Query(""),
    unassigned: bool = Query(False),
    parent_id: int | None = Query(None),
    limit: int = Query(40, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    conds = []
    if status_filter:
        conds.append(Material.status == status_filter)
    if course_id:
        conds.append(Material.course_id == course_id)
    if kind:
        conds.append(Material.kind == kind)
    if parent_id:
        conds.append(Material.parent_id == parent_id)
    if unassigned:
        # Materials saved before course scoping existed (course_id was never sent).
        conds.append(Material.course_id.is_(None))
    if topic.strip():
        conds.append(func.lower(Material.topic) == topic.strip().lower())
    if q.strip():
        needle = f"%{q.strip().lower()}%"
        conds.append(
            or_(
                func.lower(Material.title).like(needle),
                func.lower(Material.description).like(needle),
                func.lower(Material.topic).like(needle),
            )
        )

    def _filtered(stmt):
        for cond in conds:
            stmt = stmt.where(cond)
        return stmt

    # Stats span the whole filtered set (not just this page) via aggregates, so
    # the header counts stay honest while the list itself is server-paginated.
    total = int(db.scalar(_filtered(select(func.count(Material.id)))) or 0)

    def _count_status(value: str) -> int:
        return int(db.scalar(_filtered(select(func.count(Material.id))).where(Material.status == value)) or 0)

    def _sum(column) -> int:
        return int(db.scalar(_filtered(select(func.coalesce(func.sum(column), 0)))) or 0)

    rows = list(
        db.scalars(_filtered(select(Material)).order_by(Material.updated_at.desc()).limit(limit).offset(offset)).all()
    )
    reports = int(
        db.scalar(select(func.count(ContentReport.id)).where(ContentReport.kind == "material", ContentReport.status == "open")) or 0
    )
    confusions = int(db.scalar(select(func.count(MaterialConfusion.id))) or 0)
    parent_ids = {row.parent_id for row in rows if row.parent_id}
    parent_titles = (
        dict(db.execute(select(Material.id, Material.title).where(Material.id.in_(parent_ids))).all()) if parent_ids else {}
    )
    child_ids = [row.id for row in rows if (row.kind or "material") != "note"]
    note_counts = (
        dict(
            db.execute(
                select(Material.parent_id, func.count(Material.id)).where(Material.parent_id.in_(child_ids)).group_by(Material.parent_id)
            ).all()
        )
        if child_ids
        else {}
    )
    return {
        "items": [
            {
                **engine.material_public(row, sections=_sections(db, row.id), full=False),
                "parent_title": parent_titles.get(row.parent_id, "") if row.parent_id else "",
                "note_count": int(note_counts.get(row.id, 0)),
                "course_title": _course_name(db, row.course_id),
                "linked_questions": int(
                    db.scalar(select(func.count(MaterialQuestion.id)).where(MaterialQuestion.material_id == row.id)) or 0
                ),
                "confusions": int(
                    db.scalar(select(func.count(MaterialConfusion.id)).where(MaterialConfusion.material_id == row.id)) or 0
                ),
            }
            for row in rows
        ],
        "stats": {
            "total": total,
            "published": _count_status("published"),
            "drafts": _count_status("draft"),
            "archived": _count_status("archived"),
            "views": _sum(Material.views),
            "completions": _sum(Material.completions),
            "confusion_reports": confusions,
            "open_reports": reports,
        },
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@admin_router.get("/{material_id}")
def admin_read(material_id: int, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    material = _material_or_404(db, material_id, published_only=False)
    payload = engine.material_public(material, sections=_sections(db, material_id), full=True)
    payload["course_title"] = _course_name(db, material.course_id)
    payload["linked_question_ids"] = [
        row.question_id
        for row in db.scalars(select(MaterialQuestion).where(MaterialQuestion.material_id == material_id)).all()
    ]
    payload["stats"] = {
        "views": material.views or 0,
        "starts": material.starts or 0,
        "completions": material.completions or 0,
        "average_seconds": round(
            float(
                db.scalar(
                    select(func.avg(MaterialProgress.seconds_spent)).where(MaterialProgress.material_id == material_id)
                )
                or 0
            )
        ),
        "bookmarks": int(
            db.scalar(select(func.count(MaterialBookmark.id)).where(MaterialBookmark.material_id == material_id)) or 0
        ),
        "confusions": int(
            db.scalar(select(func.count(MaterialConfusion.id)).where(MaterialConfusion.material_id == material_id)) or 0
        ),
        "confusing_sections": [
            {"section_id": section_id, "count": count}
            for section_id, count in db.execute(
                select(MaterialConfusion.section_id, func.count(MaterialConfusion.id))
                .where(MaterialConfusion.material_id == material_id, MaterialConfusion.section_id.is_not(None))
                .group_by(MaterialConfusion.section_id)
                .order_by(func.count(MaterialConfusion.id).desc())
                .limit(5)
            ).all()
        ],
        "feedback": {
            verdict: int(count)
            for verdict, count in db.execute(
                select(MaterialFeedback.verdict, func.count(MaterialFeedback.id))
                .where(MaterialFeedback.material_id == material_id)
                .group_by(MaterialFeedback.verdict)
            ).all()
        },
    }
    return payload


def _apply_parent(db: Session, row: Material, parent_id: int) -> None:
    """Attach a note to one material of the same course (0 detaches it)."""
    if not parent_id:
        row.parent_id = None
        return
    parent = db.get(Material, parent_id)
    if parent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "The material this note belongs to was not found.")
    if (parent.kind or "material") == "note":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Notes can only belong to a material, not to another note.")
    if row.id and parent.id == row.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A material cannot contain itself.")
    if row.course_id and parent.course_id and row.course_id != parent.course_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A note must belong to a material of the same course.")
    row.kind = "note"
    row.course_id = parent.course_id or row.course_id
    row.parent_id = parent.id


def _apply_material(row: Material, payload: MaterialIn, *, partial: bool = False) -> None:
    """Copy a MaterialIn onto a row. ``partial`` (updates): course and status are
    only touched when the request actually sent them, so an update that omits
    them can never silently move or unpublish a material."""
    row.title = engine.clean_text(payload.title, 200)
    if not partial or "course_id" in payload.model_fields_set:
        row.course_id = payload.course_id
    row.quiz_id = payload.quiz_id
    row.topic = engine.clean_text(payload.topic, 120)
    row.subtopic = engine.clean_text(payload.subtopic, 120)
    row.description = engine.clean_text(payload.description, 500)
    row.difficulty = payload.difficulty if payload.difficulty in {"beginner", "intermediate", "advanced"} else "intermediate"
    row.estimated_minutes = max(1, min(600, int(payload.estimated_minutes or 10)))
    row.tags = json.dumps([engine.clean_text(tag, 40) for tag in (payload.tags or [])][:24])
    row.summary = json.dumps([engine.clean_text(point, 300) for point in (payload.summary or [])][:12])
    row.author = engine.clean_text(payload.author, 120)
    row.icon = (payload.icon or "book")[:40]
    row.accent = (payload.accent or "violet")[:16]
    row.allow_discussion = bool(payload.allow_discussion)
    if payload.kind in {"material", "note"}:
        row.kind = payload.kind
    if payload.link_url is not None:
        link = payload.link_url.strip()
        if link and not link.lower().startswith(("http://", "https://", "/")):
            link = "https://" + link
        row.link_url = link[:600]
    row.updated_at = utcnow()


@admin_router.post("", status_code=status.HTTP_201_CREATED)
def admin_create(
    payload: MaterialIn, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)
) -> dict:
    if not engine.clean_text(payload.title):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Give the material a title.")
    row = Material(status="draft")
    _apply_material(row, payload)
    if payload.parent_id:
        _apply_parent(db, row, payload.parent_id)
    if payload.status in {"draft", "published", "archived"}:
        row.status = payload.status
        if row.status == "published":
            row.published_at = utcnow()
    db.add(row)
    db.flush()
    # Persist every supplied section; a brand-new material always keeps at least
    # one so the editor is never empty.
    supplied = list(payload.sections or [])
    if not supplied:
        supplied = [MaterialSectionIn(title="Introduction")]
    for index, item in enumerate(supplied, start=1):
        db.add(
            MaterialSection(
                material_id=row.id,
                position=index,
                title=engine.clean_text(item.title, 200) or f"Section {index}",
                body=json.dumps(engine.sanitise_blocks(item.blocks)),
                estimated_minutes=max(1, min(120, int(item.estimated_minutes or 3))),
                check_enabled=bool(item.check_enabled),
            )
        )
    db.flush()
    engine.record_version(db, row, note="Created", author=admin.email)
    db.commit()
    return admin_read(row.id, db, admin)


# ---------------------------------------------------------------------------
# Import a document (Word / PDF / text / slides) as a material
# ---------------------------------------------------------------------------
def _material_files_dir():
    from ..config import DATA_DIR

    folder = DATA_DIR / "material_files"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


_SAFE_FILE = re.compile(r"^[a-f0-9]{32}-[a-z0-9._-]{1,120}$")


def _store_original(filename: str, data: bytes) -> str:
    """Keep the uploaded file so players can open the original; returns its URL."""
    import uuid

    stem = re.sub(r"[^a-z0-9._-]+", "-", (filename or "document").lower()).strip("-.") or "document"
    name = f"{uuid.uuid4().hex}-{stem[-120:]}"
    (_material_files_dir() / name).write_bytes(data)
    return f"/api/material-files/{name}"


def _read_upload(filename: str, data: bytes) -> dict:
    from ..services.material_import import DocumentError, read_document

    try:
        return read_document(filename, data)
    except DocumentError as error:
        raise HTTPException(error.status_code, error.message) from error


@admin_router.post("/import/preview")
async def admin_import_preview(file: UploadFile = File(...), admin: Admin = Depends(require_admin)) -> dict:
    """Read a document and show what would be created — nothing is saved."""
    draft = _read_upload(file.filename or "document", await file.read())
    return {
        **{key: value for key, value in draft.items() if key != "sections"},
        "sections": [
            {
                "title": section["title"],
                "words": section["words"],
                "blocks": len(section["blocks"]),
                "excerpt": next((b.get("text", "") for b in section["blocks"] if b.get("text")), "")[:160],
            }
            for section in draft["sections"]
        ],
    }


@admin_router.post("/import", status_code=status.HTTP_201_CREATED)
async def admin_import(
    file: UploadFile = File(...),
    course_id: int = Form(...),
    title: str = Form(""),
    topic: str = Form(""),
    description: str = Form(""),
    kind: str = Form("material"),
    status_value: str = Form("draft", alias="status"),
    keep_file: bool = Form(True),
    parent_id: int | None = Form(None),
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    """Create a material from an uploaded document. Staff only fill the basics
    (course, title, topic); the content is the document itself."""
    from ..models import Course as CourseModel
    from ..services.questions import audit

    if db.get(CourseModel, course_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Choose a course for this material.")
    filename = file.filename or "document"
    data = await file.read()
    draft = _read_upload(filename, data)
    kind = kind if kind in {"material", "note"} else "material"
    publish = status_value if status_value in {"draft", "published", "archived"} else "draft"
    link = _store_original(filename, data) if keep_file else ""
    payload = MaterialIn(
        title=(title.strip() or draft["title"])[:200],
        course_id=course_id,
        kind="note" if parent_id else kind,
        parent_id=parent_id or None,
        link_url=link,
        topic=topic.strip()[:120],
        description=(description.strip() or draft["description"])[:500],
        estimated_minutes=draft["estimated_minutes"],
        status=publish,
        sections=[
            MaterialSectionIn(title=section["title"], blocks=section["blocks"], estimated_minutes=section["estimated_minutes"])
            for section in draft["sections"]
        ],
    )
    created = admin_create(payload, db, admin)
    audit(
        db,
        actor=admin.email,
        action="material.import",
        target_type="material",
        target_id=int(created["id"]),
        detail={"file": filename[:200], "format": draft["format"], "words": draft["words"], "sections": len(draft["sections"])},
    )
    db.commit()
    return {**created, "import": {key: draft[key] for key in ("filename", "format", "pages", "words", "notes")}}


@files_router.get("/{name}")
def material_file(name: str) -> FileResponse:
    if not _SAFE_FILE.match(name or ""):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found.")
    path = _material_files_dir() / name
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found.")
    original = name.split("-", 1)[1]
    return FileResponse(path, filename=original, content_disposition_type="inline")


@admin_router.patch("/{material_id}")
def admin_update(
    material_id: int, payload: MaterialIn, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)
) -> dict:
    row = _material_or_404(db, material_id, published_only=False)
    previous_status = row.status
    was_published = row.status == "published"
    _apply_material(row, payload, partial=True)
    if payload.parent_id is not None:
        _apply_parent(db, row, payload.parent_id)
    elif row.parent_id:
        parent = db.get(Material, row.parent_id)
        if parent is not None and parent.course_id and row.course_id != parent.course_id:
            row.course_id = parent.course_id  # a note always lives in its material's course
    if "status" in payload.model_fields_set and payload.status in {"draft", "published", "archived"}:
        row.status = payload.status
    if payload.sections is not None:
        existing = {section.id: section for section in _sections(db, material_id)}
        keep: set[int] = set()
        for index, item in enumerate(payload.sections, start=1):
            body = json.dumps(engine.sanitise_blocks(item.blocks))
            if item.id and item.id in existing:
                section = existing[item.id]
                section.title = engine.clean_text(item.title, 200) or f"Section {index}"
                section.body = body
                section.position = index
                section.estimated_minutes = max(1, min(120, int(item.estimated_minutes or 3)))
                section.check_enabled = bool(item.check_enabled)
                section.updated_at = utcnow()
                keep.add(section.id)
            else:
                created = MaterialSection(
                    material_id=row.id,
                    position=index,
                    title=engine.clean_text(item.title, 200) or f"Section {index}",
                    body=body,
                    estimated_minutes=max(1, min(120, int(item.estimated_minutes or 3))),
                    check_enabled=bool(item.check_enabled),
                )
                db.add(created)
                db.flush()
                keep.add(created.id)
        for section_id, section in existing.items():
            if section_id not in keep:
                db.delete(section)

    changed_content = payload.sections is not None or True
    if was_published and changed_content:
        row.version = (row.version or 1) + 1
    if row.status == "published" and previous_status != "published":
        row.published_at = utcnow()
    engine.record_version(db, row, note=f"Saved by {admin.email}", author=admin.email)
    db.commit()
    return admin_read(row.id, db, admin)


@admin_router.delete("/{material_id}")
def admin_delete(material_id: int, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    row = _material_or_404(db, material_id, published_only=False)
    # A material's notes are kept (they stay in the course's Notes tab) — only detached.
    detached = 0
    for child in db.scalars(select(Material).where(Material.parent_id == row.id)).all():
        child.parent_id = None
        detached += 1
    db.delete(row)
    db.commit()
    return {"ok": True, "detached_notes": detached}


@admin_router.post("/{material_id}/duplicate")
def admin_duplicate(material_id: int, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    source = _material_or_404(db, material_id, published_only=False)
    clone = Material(
        course_id=source.course_id,
        quiz_id=source.quiz_id,
        title=f"{source.title} (copy)",
        kind=source.kind or "material",
        link_url=source.link_url or "",
        topic=source.topic,
        subtopic=source.subtopic,
        description=source.description,
        difficulty=source.difficulty,
        estimated_minutes=source.estimated_minutes,
        tags=source.tags,
        summary=source.summary,
        author=admin.email,
        status="draft",
        icon=source.icon,
        accent=source.accent,
        allow_discussion=source.allow_discussion,
    )
    db.add(clone)
    db.flush()
    for section in _sections(db, material_id):
        db.add(
            MaterialSection(
                material_id=clone.id,
                position=section.position,
                title=section.title,
                body=section.body,
                estimated_minutes=section.estimated_minutes,
                check_enabled=section.check_enabled,
            )
        )
    engine.record_version(db, clone, note="Duplicated", author=admin.email)
    db.commit()
    return admin_read(clone.id, db, admin)


@admin_router.post("/{material_id}/publish")
def admin_publish(
    material_id: int,
    publish: bool = Query(True),
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    row = _material_or_404(db, material_id, published_only=False)
    row.status = "published" if publish else "draft"
    if publish:
        row.published_at = utcnow()
    engine.record_version(db, row, note="Published" if publish else "Unpublished", author=admin.email)
    db.commit()
    # Tell readers who bookmarked it that the material changed (item 109).
    return {"ok": True, "status": row.status, "version": row.version}


@admin_router.get("/{material_id}/versions")
def admin_versions(
    material_id: int, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)
) -> dict:
    material = _material_or_404(db, material_id, published_only=False)
    rows = list(
        db.scalars(
            select(MaterialVersion)
            .where(MaterialVersion.material_id == material_id)
            .order_by(MaterialVersion.created_at.desc())
            .limit(50)
        ).all()
    )
    return {
        "material_id": material_id,
        "current_version": material.version or 1,
        "versions": [
            {
                "id": row.id,
                "version": row.version,
                "note": row.note,
                "author": row.author,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ],
    }


@admin_router.post("/{material_id}/versions/{version_id}/restore")
def admin_restore_version(
    material_id: int, version_id: int, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)
) -> dict:
    """Undo: bring back the content of an earlier snapshot. The restore itself is
    saved as a new version, so it can be undone too. Status stays as it is."""
    row = _material_or_404(db, material_id, published_only=False)
    version = db.get(MaterialVersion, version_id)
    if version is None or version.material_id != material_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found.")
    try:
        snap = json.loads(version.snapshot or "{}")
    except ValueError as error:
        raise HTTPException(status.HTTP_409_CONFLICT, "That version is too large to restore.") from error
    if not isinstance(snap, dict) or "sections" not in snap:
        raise HTTPException(status.HTTP_409_CONFLICT, "That version has no content to restore.")
    row.title = engine.clean_text(snap.get("title"), 200) or row.title
    for field, limit in (("topic", 120), ("subtopic", 120), ("description", 500), ("author", 120), ("link_url", 600)):
        if field in snap:
            setattr(row, field, str(snap.get(field) or "")[:limit])
    if snap.get("difficulty") in {"beginner", "intermediate", "advanced"}:
        row.difficulty = snap["difficulty"]
    if snap.get("estimated_minutes"):
        row.estimated_minutes = max(1, min(600, int(snap["estimated_minutes"])))
    if isinstance(snap.get("tags"), list):
        row.tags = json.dumps(snap["tags"][:24])
    if isinstance(snap.get("summary"), list):
        row.summary = json.dumps(snap["summary"][:12])
    # Sections: reuse existing rows by position so reader progress keeps pointing somewhere sensible.
    existing = _sections(db, material_id)
    wanted = [item for item in snap.get("sections") or [] if isinstance(item, dict)]
    for index, item in enumerate(wanted, start=1):
        body = json.dumps(engine.sanitise_blocks(item.get("blocks") or []))
        title = engine.clean_text(item.get("title"), 200) or f"Section {index}"
        minutes = max(1, min(120, int(item.get("estimated_minutes") or 3)))
        if index <= len(existing):
            section = existing[index - 1]
            section.title, section.body, section.position = title, body, index
            section.estimated_minutes, section.check_enabled = minutes, bool(item.get("check_enabled"))
            section.updated_at = utcnow()
        else:
            db.add(MaterialSection(material_id=row.id, position=index, title=title, body=body, estimated_minutes=minutes,
                                   check_enabled=bool(item.get("check_enabled"))))
    for section in existing[len(wanted):]:
        db.delete(section)
    if row.status == "published":
        row.version = (row.version or 1) + 1
    row.updated_at = utcnow()
    stamp = version.created_at.strftime("%d %b %H:%M") if version.created_at else f"#{version.id}"
    engine.record_version(db, row, note=f"Restored the version from {stamp}", author=admin.email)
    db.commit()
    return admin_read(row.id, db, admin)


@admin_router.post("/{material_id}/link-questions")
def admin_link_questions(
    material_id: int,
    payload: MaterialLinkQuestionsIn,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    material = _material_or_404(db, material_id, published_only=False)
    section_id = payload.section_id
    added = 0
    for question_id in payload.question_ids[:200]:
        if db.get(Question, question_id) is None:
            continue
        exists = db.scalar(
            select(MaterialQuestion.id).where(
                MaterialQuestion.material_id == material.id, MaterialQuestion.question_id == question_id
            )
        )
        if exists:
            continue
        db.add(MaterialQuestion(material_id=material.id, question_id=question_id, section_id=section_id))
        added += 1
    db.commit()
    return {"added": added, "material_id": material.id}


@admin_router.get("/{material_id}/analytics")
def admin_analytics(
    material_id: int, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)
) -> dict:
    """Where readers stop, what confuses them and how linked questions perform."""
    material = _material_or_404(db, material_id, published_only=False)
    sections = _sections(db, material_id)
    progress_rows = list(db.scalars(select(MaterialProgress).where(MaterialProgress.material_id == material_id)).all())
    linked = engine.material_questions(db, material)
    confusion_by_section = {
        section_id: count
        for section_id, count in db.execute(
            select(MaterialConfusion.section_id, func.count(MaterialConfusion.id))
            .where(MaterialConfusion.material_id == material_id)
            .group_by(MaterialConfusion.section_id)
        ).all()
        if section_id
    }
    return {
        "material": {"id": material.id, "title": material.title, "status": material.status, "version": material.version},
        "views": material.views or 0,
        "starts": material.starts or 0,
        "completions": material.completions or 0,
        "readers": len(progress_rows),
        "average_percent": round(sum(row.percent or 0 for row in progress_rows) / max(1, len(progress_rows)), 1),
        "average_seconds": round(sum(row.seconds_spent or 0 for row in progress_rows) / max(1, len(progress_rows))),
        "sections": [
            {
                "id": row.id,
                "position": row.position,
                "title": row.title,
                "reached": sum(1 for p in progress_rows if row.id in _loads(p.visited, [])),
                "confusions": confusion_by_section.get(row.id, 0),
            }
            for row in sections
        ],
        "most_confusing": sorted(
            [{"section_id": sid, "count": count} for sid, count in confusion_by_section.items()],
            key=lambda row: row["count"],
            reverse=True,
        )[:5],
        "questions": {
            "linked": len(linked),
            "accuracy": round(
                sum((row.correct_count or 0) / max(1, row.usage_count or 0) for row in linked) / max(1, len(linked)) * 100,
                1,
            )
            if linked
            else 0,
        },
    }
