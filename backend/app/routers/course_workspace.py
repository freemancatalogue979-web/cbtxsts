"""Admin course workspace: Course → Topics → questions / notes / materials.

Everything here is scoped to ONE course so the admin never sees another
course's content mixed in:

* ``GET  /admin/courses/{id}/overview``    — the numbers for the course
  (bank size, exam-specific questions, exams, notes, materials, discussion)
* ``GET  /admin/courses/{id}/topics``      — curated topics merged with the
  topics already used by bank questions / notes / materials, with counts
* ``POST /admin/courses/{id}/topics``      — add a topic
* ``PATCH/DELETE /admin/course-topics/{id}``
* ``GET  /admin/courses/{id}/discussion``  — discussion across the course's
  materials and notes; ``DELETE /admin/course-discussion/{post_id}`` moderates
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Admin, Attempt, Course, CourseTopic, Material, MaterialPost, Question, Quiz, Student
from ..deps import require_admin
from ..services.course_bank import COURSE_RANDOM, bank_conditions, bank_count
from ..services.questions import audit

router = APIRouter(prefix="/admin", tags=["course-workspace"], dependencies=[Depends(require_admin)])


class TopicIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=400)
    position: int | None = None


class TopicPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=400)
    position: int | None = None


def _course(db: Session, course_id: int) -> Course:
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found.")
    return course


@router.get("/courses/{course_id}/overview")
def course_overview(course_id: int, db: Session = Depends(get_db)) -> dict:
    course = _course(db, course_id)
    exams = list(
        db.scalars(select(Quiz).where(Quiz.course_id == course_id, Quiz.is_bank.is_(False)).order_by(Quiz.id.desc())).all()
    )
    exam_ids = [quiz.id for quiz in exams] or [0]
    attempts = int(
        db.scalar(select(func.count(Attempt.id)).where(Attempt.quiz_id.in_(exam_ids), Attempt.status == "submitted")) or 0
    )
    by_difficulty = {
        str(level): int(count)
        for level, count in db.execute(
            select(Question.difficulty, func.count(Question.id)).where(bank_conditions(course_id)).group_by(Question.difficulty)
        ).all()
    }
    by_kind = {
        str(kind or "material"): int(count)
        for kind, count in db.execute(
            select(Material.kind, func.count(Material.id)).where(Material.course_id == course_id).group_by(Material.kind)
        ).all()
    }
    material_ids = list(db.scalars(select(Material.id).where(Material.course_id == course_id)).all()) or [0]
    posts = int(db.scalar(select(func.count(MaterialPost.id)).where(MaterialPost.material_id.in_(material_ids))) or 0)
    return {
        "course": {"id": course.id, "code": course.code, "title": course.title, "description": course.description,
                   "lecturer": course.lecturer, "semester": course.semester, "accent": course.accent,
                   "is_active": course.is_active},
        "bank": {
            "total": bank_count(db, course_id),
            "ready": bank_count(db, course_id, eligible_only=True),
            "by_difficulty": by_difficulty,
        },
        "exam_specific_questions": int(
            db.scalar(select(func.count(Question.id)).where(Question.course_id == course_id, Question.exam_only.is_(True))) or 0
        ),
        "exams": [
            {
                "id": quiz.id,
                "title": quiz.title,
                "status": quiz.status,
                "question_source": quiz.question_source if quiz.question_source == COURSE_RANDOM else "exam_specific",
                "draw_count": int(quiz.draw_count or 0),
            }
            for quiz in exams
        ],
        "submissions": attempts,
        "notes": by_kind.get("note", 0),
        "materials": by_kind.get("material", 0),
        "discussion_posts": posts,
        "topics": len(_topic_rows(db, course_id)),
    }


def _topic_rows(db: Session, course_id: int) -> list[dict]:
    curated = list(
        db.scalars(select(CourseTopic).where(CourseTopic.course_id == course_id).order_by(CourseTopic.position, CourseTopic.name)).all()
    )
    q_counts = {
        (name or "").strip().lower(): (name, int(count))
        for name, count in db.execute(
            select(Question.topic, func.count(Question.id))
            .where(bank_conditions(course_id), Question.topic != "")
            .group_by(Question.topic)
        ).all()
    }
    m_counts: dict[str, dict[str, int]] = {}
    m_names: dict[str, str] = {}
    for name, kind, count in db.execute(
        select(Material.topic, Material.kind, func.count(Material.id))
        .where(Material.course_id == course_id, Material.topic != "")
        .group_by(Material.topic, Material.kind)
    ).all():
        key = (name or "").strip().lower()
        m_names.setdefault(key, name)
        m_counts.setdefault(key, {})[str(kind or "material")] = int(count)

    rows: list[dict] = []
    seen: set[str] = set()
    for topic in curated:
        key = topic.name.strip().lower()
        seen.add(key)
        rows.append({
            "id": topic.id,
            "name": topic.name,
            "description": topic.description,
            "position": topic.position,
            "curated": True,
            "questions": q_counts.get(key, ("", 0))[1],
            "notes": m_counts.get(key, {}).get("note", 0),
            "materials": m_counts.get(key, {}).get("material", 0),
        })
    # Topics already in use by content but not curated yet still show up.
    discovered = {**{k: v[0] for k, v in q_counts.items()}, **m_names}
    for key, name in sorted(discovered.items(), key=lambda item: item[1].lower()):
        if key in seen or not key:
            continue
        rows.append({
            "id": None,
            "name": name,
            "description": "",
            "position": 10_000,
            "curated": False,
            "questions": q_counts.get(key, ("", 0))[1],
            "notes": m_counts.get(key, {}).get("note", 0),
            "materials": m_counts.get(key, {}).get("material", 0),
        })
    return rows


@router.get("/courses/{course_id}/topics")
def list_topics(course_id: int, db: Session = Depends(get_db)) -> dict:
    _course(db, course_id)
    return {"course_id": course_id, "topics": _topic_rows(db, course_id)}


@router.post("/courses/{course_id}/topics")
def create_topic(course_id: int, payload: TopicIn, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    _course(db, course_id)
    name = " ".join(payload.name.split())
    exists = db.scalar(
        select(CourseTopic).where(CourseTopic.course_id == course_id, func.lower(CourseTopic.name) == name.lower())
    )
    if exists is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This course already has a topic with that name.")
    position = payload.position
    if position is None:
        position = int(db.scalar(select(func.max(CourseTopic.position)).where(CourseTopic.course_id == course_id)) or 0) + 1
    topic = CourseTopic(course_id=course_id, name=name, description=payload.description.strip(), position=position)
    db.add(topic)
    db.flush()
    audit(db, actor=admin.email, action="course.topic.create", target_type="course", target_id=course_id, detail={"topic": name})
    db.commit()
    return {"ok": True, "topics": _topic_rows(db, course_id)}


@router.patch("/course-topics/{topic_id}")
def update_topic(topic_id: int, payload: TopicPatch, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    topic = db.get(CourseTopic, topic_id)
    if topic is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Topic not found.")
    if payload.name is not None:
        new_name = " ".join(payload.name.split())
        old_key = topic.name.strip().lower()
        if new_name.lower() != old_key:
            clash = db.scalar(
                select(CourseTopic).where(
                    CourseTopic.course_id == topic.course_id,
                    func.lower(CourseTopic.name) == new_name.lower(),
                    CourseTopic.id != topic.id,
                )
            )
            if clash is not None:
                raise HTTPException(status.HTTP_409_CONFLICT, "This course already has a topic with that name.")
            # Renaming a topic carries its content along (this course only).
            for row in db.scalars(
                select(Question).where(Question.course_id == topic.course_id, func.lower(Question.topic) == old_key)
            ).all():
                row.topic = new_name
            for row in db.scalars(
                select(Material).where(Material.course_id == topic.course_id, func.lower(Material.topic) == old_key)
            ).all():
                row.topic = new_name
        topic.name = new_name
    if payload.description is not None:
        topic.description = payload.description.strip()
    if payload.position is not None:
        topic.position = payload.position
    audit(db, actor=admin.email, action="course.topic.update", target_type="course", target_id=topic.course_id,
          detail={"topic": topic.name})
    db.commit()
    return {"ok": True, "topics": _topic_rows(db, topic.course_id)}


@router.delete("/course-topics/{topic_id}")
def delete_topic(topic_id: int, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    """Removes the curated entry only; questions/notes keep their topic label."""
    topic = db.get(CourseTopic, topic_id)
    if topic is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Topic not found.")
    course_id = topic.course_id
    db.delete(topic)
    audit(db, actor=admin.email, action="course.topic.delete", target_type="course", target_id=course_id,
          detail={"topic": topic.name})
    db.commit()
    return {"ok": True, "topics": _topic_rows(db, course_id)}


@router.get("/courses/{course_id}/discussion")
def course_discussion(
    course_id: int,
    limit: int = Query(60, ge=1, le=200),
    db: Session = Depends(get_db),
) -> dict:
    _course(db, course_id)
    materials = {
        row.id: row for row in db.scalars(select(Material).where(Material.course_id == course_id)).all()
    }
    if not materials:
        return {"posts": [], "total": 0}
    stmt = select(MaterialPost).where(MaterialPost.material_id.in_(list(materials)))
    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = list(db.scalars(stmt.order_by(MaterialPost.created_at.desc()).limit(limit)).all())
    student_ids = {row.student_id for row in rows if row.student_id}
    names = {
        sid: name for sid, name in db.execute(select(Student.id, Student.name).where(Student.id.in_(student_ids or {0}))).all()
    }
    return {
        "total": total,
        "posts": [
            {
                "id": row.id,
                "material_id": row.material_id,
                "material_title": materials[row.material_id].title,
                "material_kind": materials[row.material_id].kind or "material",
                "topic": materials[row.material_id].topic,
                "name": names.get(row.student_id or 0, "Player"),
                "kind": row.kind,
                "body": row.body,
                "parent_id": row.parent_id,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ],
    }


@router.delete("/course-discussion/{post_id}")
def delete_discussion_post(post_id: int, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    post = db.get(MaterialPost, post_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Post not found.")
    db.delete(post)
    audit(db, actor=admin.email, action="course.discussion.delete", target_type="material", target_id=post.material_id,
          detail={"post": post_id})
    db.commit()
    return {"ok": True}
