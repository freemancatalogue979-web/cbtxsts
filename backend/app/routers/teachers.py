"""Teacher Network API — discovery, requests, relationships, studio, content, reviews.

Players use one account for both sides: anyone can find and request a teacher,
and a player whose application was approved also gets the Teacher Studio.
Every permission is decided here (via ``services.teachers``) — never in the UI.
"""
from __future__ import annotations

import logging

import json
import random
from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_student
from ..events import dispatch, to_student
from ..models import (
    ChatMessage,
    ContentReport,
    Course,
    GroupJoinRequest,
    Question,
    Quiz,
    Student,
    StudyGroup,
    StudyGroupMember,
    TeacherFile,
    TeacherMaterial,
    TeacherMaterialView,
    TeacherNote,
    TeacherProfile,
    TeacherQualification,
    TeacherQuiz,
    TeacherQuizAttempt,
    TeacherQuizQuestion,
    TeacherRequest,
    TeacherReview,
    TeacherShare,
    TeacherSpecialty,
    TeacherStudent,
    TeacherVerificationLog,
    UserBlock,
    utcnow,
)
from ..services import teachers as T
from ..services.group import log_activity

logger = logging.getLogger("arena.teachers")
router = APIRouter(prefix="/teachers", tags=["teachers"])


# ---------------------------------------------------------------------------
# Payloads
# ---------------------------------------------------------------------------
class SpecialtyIn(BaseModel):
    subject: str = Field(min_length=2, max_length=80)
    topics: list[str] = Field(default_factory=list, max_length=20)


class SlotIn(BaseModel):
    day: int = Field(ge=0, le=6)
    start: str = Field(pattern=r"^\d{2}:\d{2}$")
    end: str = Field(pattern=r"^\d{2}:\d{2}$")


class ProfileIn(BaseModel):
    headline: str = Field(default="", max_length=140)
    bio: str = Field(default="", max_length=3000)
    experience_years: int = Field(default=0, ge=0, le=60)
    experience: str = Field(default="", max_length=2000)
    institution: str = Field(default="", max_length=160)
    languages: list[str] = Field(default_factory=list, max_length=8)
    formats: Literal["one", "group", "both"] = "both"
    availability: list[SlotIn] = Field(default_factory=list, max_length=40)
    accepting: bool = True
    specialties: list[SpecialtyIn] = Field(default_factory=list, max_length=8)


class RequestIn(BaseModel):
    subject: str = Field(default="", max_length=80)
    topic: str = Field(default="", max_length=120)
    message: str = Field(min_length=10, max_length=1500)
    format: Literal["one", "group", "either"] = "either"
    preferred_time: str = Field(default="", max_length=160)


class DecisionIn(BaseModel):
    note: str = Field(default="", max_length=400)


class NoteIn(BaseModel):
    weak_areas: str = Field(default="", max_length=2000)
    progress: str = Field(default="", max_length=40)
    next_step: str = Field(default="", max_length=1000)
    body: str = Field(default="", max_length=6000)


class MaterialIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    description: str = Field(default="", max_length=2000)
    subject: str = Field(default="", max_length=80)
    topic: str = Field(default="", max_length=120)
    kind: Literal["file", "text", "link"] = "text"
    body: str = Field(default="", max_length=60000)
    link: str = Field(default="", max_length=500)
    file_id: int | None = None
    visibility: Literal["private", "students", "group", "public"] = "private"
    group_id: int | None = None


class ShareIn(BaseModel):
    student_ids: list[int] = Field(min_length=1, max_length=200)


class QuestionIn(BaseModel):
    id: int | None = None
    kind: Literal["mcq", "tf", "short", "numeric"] = "mcq"
    prompt: str = Field(min_length=3, max_length=4000)
    options: list[str] = Field(default_factory=list, max_length=6)
    answer: str = Field(default="", max_length=400)
    tolerance: float = Field(default=0.0, ge=0)
    explanation: str = Field(default="", max_length=4000)
    marks: int = Field(default=1, ge=1, le=20)
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    source_question_id: int | None = None


class QuizIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    description: str = Field(default="", max_length=2000)
    subject: str = Field(default="", max_length=80)
    topic: str = Field(default="", max_length=120)
    time_limit_minutes: int = Field(default=15, ge=0, le=300)
    pass_mark: int = Field(default=50, ge=0, le=100)
    visibility: Literal["private", "students", "group", "public"] = "students"
    group_id: int | None = None
    questions: list[QuestionIn] = Field(default_factory=list, max_length=150)


class BankImportIn(BaseModel):
    course_id: int
    topic: str = Field(default="", max_length=120)
    count: int = Field(default=10, ge=1, le=50)


class SubmitIn(BaseModel):
    answers: dict[str, Any] = Field(default_factory=dict)


class ReviewIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    body: str = Field(default="", max_length=2000)
    anonymous: bool = True


class ReviewResponseIn(BaseModel):
    response: str = Field(min_length=2, max_length=1500)


class ReportIn(BaseModel):
    kind: Literal["teacher", "teacher_student", "teacher_group", "teacher_material", "teacher_quiz", "teacher_review", "chat_message"]
    target_id: int
    reason: str = Field(min_length=5, max_length=400)


class GroupIn(BaseModel):
    name: str = Field(min_length=3, max_length=140)
    description: str = Field(default="", max_length=300)
    subject: str = Field(default="", max_length=80)
    topic: str = Field(default="", max_length=120)
    capacity: int = Field(default=30, ge=0, le=500)
    privacy: Literal["public", "request", "invite"] = "request"
    course_id: int | None = None


class GroupJoinIn(BaseModel):
    message: str = Field(default="", max_length=300)


class InviteIn(BaseModel):
    student_id: int


class TypingIn(BaseModel):
    to: int


# ---------------------------------------------------------------------------
# Serialisers
# ---------------------------------------------------------------------------
def _request_public(db: Session, row: TeacherRequest, *, for_teacher: bool) -> dict:
    profile = db.get(TeacherProfile, row.teacher_id)
    student = db.get(Student, row.student_id)
    return {
        "id": row.id,
        "teacher_id": row.teacher_id,
        "teacher": {"id": profile.id, "name": T.short_name(profile.student), "student_id": profile.student_id, "avatar_hue": profile.student.avatar_hue, "has_photo": bool(profile.student.photo), "verified": profile.verified} if profile else None,
        "student": T.person_chip(student) if for_teacher else {"id": row.student_id},
        "subject": row.subject,
        "topic": row.topic,
        "message": row.message,
        "format": row.format,
        "preferred_time": row.preferred_time,
        "status": row.status,
        "response_note": row.response_note,
        "created_at": T.iso(row.created_at),
        "responded_at": T.iso(row.responded_at),
    }


def _material_public(db: Session, row: TeacherMaterial, *, owner: bool = False) -> dict:
    file_row = db.get(TeacherFile, row.file_id) if row.file_id else None
    group = db.get(StudyGroup, row.group_id) if row.group_id else None
    payload = {
        "id": row.id,
        "teacher_id": row.teacher_id,
        "title": row.title,
        "description": row.description,
        "subject": row.subject,
        "topic": row.topic,
        "kind": row.kind,
        "link": row.link,
        "file": T.file_public(file_row),
        "visibility": row.visibility,
        "group": {"id": group.id, "name": group.name} if group else None,
        "created_at": T.iso(row.created_at),
        "updated_at": T.iso(row.updated_at),
    }
    if owner:
        unique = db.scalar(select(func.count(TeacherMaterialView.id)).where(TeacherMaterialView.material_id == row.id)) or 0
        payload["stats"] = {"views": row.views, "unique_viewers": int(unique), "downloads": row.downloads}
        payload["status"] = row.status
    return payload


def _quiz_summary(db: Session, quiz: TeacherQuiz, *, owner: bool = False, viewer: Student | None = None) -> dict:
    questions = db.scalars(select(TeacherQuizQuestion).where(TeacherQuizQuestion.quiz_id == quiz.id)).all()
    group = db.get(StudyGroup, quiz.group_id) if quiz.group_id else None
    payload: dict[str, Any] = {
        "id": quiz.id,
        "teacher_id": quiz.teacher_id,
        "title": quiz.title,
        "description": quiz.description,
        "subject": quiz.subject,
        "topic": quiz.topic,
        "time_limit_minutes": quiz.time_limit_minutes,
        "pass_mark": quiz.pass_mark,
        "visibility": quiz.visibility,
        "group": {"id": group.id, "name": group.name} if group else None,
        "status": quiz.status,
        "question_count": len(questions),
        "total_marks": sum(q.marks for q in questions),
        "created_at": T.iso(quiz.created_at),
        "published_at": T.iso(quiz.published_at),
    }
    if owner:
        attempts = db.scalars(select(TeacherQuizAttempt).where(TeacherQuizAttempt.quiz_id == quiz.id, TeacherQuizAttempt.status == "submitted")).all()
        students = {a.student_id for a in attempts}
        payload["stats"] = {
            "attempts": len(attempts),
            "students": len(students),
            "average": round(sum(a.percentage for a in attempts) / len(attempts), 1) if attempts else None,
            "pass_rate": round(sum(1 for a in attempts if a.passed) * 100 / len(attempts)) if attempts else None,
        }
    if viewer is not None:
        mine = db.scalars(
            select(TeacherQuizAttempt).where(TeacherQuizAttempt.quiz_id == quiz.id, TeacherQuizAttempt.student_id == viewer.id).order_by(TeacherQuizAttempt.id.desc())
        ).all()
        best = max((a.percentage for a in mine if a.status == "submitted"), default=None)
        payload["my_attempts"] = len([a for a in mine if a.status == "submitted"])
        payload["my_best"] = best
        payload["in_progress_id"] = next((a.id for a in mine if a.status == "in_progress"), None)
    return payload


def _question_full(q: TeacherQuizQuestion) -> dict:
    return {
        "id": q.id,
        "position": q.position,
        "kind": q.kind,
        "prompt": q.prompt,
        "options": q.options or [],
        "answer": q.answer,
        "tolerance": q.tolerance,
        "explanation": q.explanation,
        "marks": q.marks,
        "difficulty": q.difficulty,
        "source_question_id": q.source_question_id,
    }


def _question_for_student(q: TeacherQuizQuestion) -> dict:
    return {"id": q.id, "position": q.position, "kind": q.kind, "prompt": q.prompt, "options": q.options or [], "marks": q.marks}


def _review_public(db: Session, row: TeacherReview, *, viewer_id: int | None = None, staff: bool = False) -> dict:
    student = db.get(Student, row.student_id)
    show_name = staff or not row.anonymous
    return {
        "id": row.id,
        "teacher_id": row.teacher_id,
        "rating": row.rating,
        "body": row.body,
        "anonymous": row.anonymous,
        "author": (T.short_name(student) if show_name else "Anonymous student"),
        "author_id": row.student_id if staff else None,
        "is_mine": viewer_id == row.student_id,
        "editable": viewer_id == row.student_id and utcnow() - row.created_at < T.REVIEW_EDIT_WINDOW,
        "status": row.status,
        "teacher_response": row.teacher_response,
        "responded_at": T.iso(row.responded_at),
        "created_at": T.iso(row.created_at),
        "updated_at": T.iso(row.updated_at),
    }


def _group_public(db: Session, group: StudyGroup, viewer: Student | None) -> dict:
    members = int(db.scalar(select(func.count(StudyGroupMember.id)).where(StudyGroupMember.group_id == group.id, StudyGroupMember.role != "owner")) or 0)
    member = (
        db.scalar(select(StudyGroupMember).where(StudyGroupMember.group_id == group.id, StudyGroupMember.student_id == viewer.id)) if viewer else None
    )
    pending = (
        db.scalar(
            select(GroupJoinRequest.id).where(GroupJoinRequest.group_id == group.id, GroupJoinRequest.student_id == viewer.id, GroupJoinRequest.status == "pending")
        )
        if viewer
        else None
    )
    profile = db.get(TeacherProfile, group.teacher_id) if group.teacher_id else None
    return {
        "id": group.id,
        "name": group.name,
        "description": group.description,
        "subject": group.subject,
        "topic": group.topic,
        "privacy": group.privacy,
        "capacity": group.capacity,
        "members": members,
        "full": bool(group.capacity and members >= group.capacity),
        "teacher": {"id": profile.id, "name": T.short_name(profile.student), "verified": profile.verified, "student_id": profile.student_id} if profile else None,
        "is_member": member is not None,
        "my_role": member.role if member else None,
        "request_pending": bool(pending),
        # The join code doubles as an invite, so only members see it.
        "code": group.code if member is not None else None,
        "created_at": T.iso(group.created_at),
    }


def _profile_private(db: Session, profile: TeacherProfile) -> dict:
    specialties = db.scalars(select(TeacherSpecialty).where(TeacherSpecialty.teacher_id == profile.id)).all()
    quals = db.scalars(select(TeacherQualification).where(TeacherQualification.teacher_id == profile.id).order_by(TeacherQualification.id)).all()
    history = db.scalars(
        select(TeacherVerificationLog)
        .where(TeacherVerificationLog.teacher_id == profile.id, TeacherVerificationLog.action != "note")
        .order_by(TeacherVerificationLog.created_at.desc())
    ).all()
    return {
        "id": profile.id,
        "status": profile.status,
        "verified": profile.verified,
        "headline": profile.headline,
        "bio": profile.bio,
        "experience_years": profile.experience_years,
        "experience": profile.experience,
        "institution": profile.institution,
        "languages": profile.languages or [],
        "formats": profile.formats,
        "availability": profile.availability or [],
        "accepting": profile.accepting,
        "staff_message": profile.staff_message,
        "submitted_at": T.iso(profile.submitted_at),
        "approved_at": T.iso(profile.approved_at),
        "specialties": T.specialties_grouped(specialties),
        "qualifications": [
            {"id": q.id, "title": q.title, "institution": q.institution, "year": q.year, "status": q.status, "file": T.file_public(db.get(TeacherFile, q.file_id) if q.file_id else None)}
            for q in quals
        ],
        # Staff-facing notes stay private; the applicant sees the decision trail.
        "history": [{"action": h.action, "created_at": T.iso(h.created_at)} for h in history],
    }


def _require_relationship(db: Session, profile: TeacherProfile, student_id: int) -> TeacherStudent:
    rel = T.relationship_between(db, profile.id, student_id)
    if rel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This student isn't one of yours.")
    return rel


def _my_group(db: Session, profile: TeacherProfile, group_id: int) -> StudyGroup:
    group = db.get(StudyGroup, group_id)
    if group is None or group.teacher_id != profile.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found.")
    return group


def _group_member_count(db: Session, group_id: int) -> int:
    return int(db.scalar(select(func.count(StudyGroupMember.id)).where(StudyGroupMember.group_id == group_id, StudyGroupMember.role != "owner")) or 0)


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------
@router.get("/catalog")
def catalog(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    live_ids = select(TeacherProfile.id).where(TeacherProfile.status == "approved")
    popular = db.execute(
        select(func.coalesce(func.nullif(TeacherSpecialty.topic, ""), TeacherSpecialty.subject), func.count(TeacherSpecialty.id))
        .where(TeacherSpecialty.teacher_id.in_(live_ids))
        .group_by(func.coalesce(func.nullif(TeacherSpecialty.topic, ""), TeacherSpecialty.subject))
        .order_by(func.count(TeacherSpecialty.id).desc())
        .limit(10)
    ).all()
    chips = [name for name, _ in popular]
    for fallback in ["Algebra", "Geometry", "Use of English", "Comprehension", "Physics", "Chemistry", "Biology"]:
        if len(chips) >= 8:
            break
        if fallback not in chips:
            chips.append(fallback)
    return {
        "subjects": [{"subject": s, "topics": topics} for s, topics in T.SUBJECTS.items()],
        "languages": T.LANGUAGES,
        "popular": chips,
        "teacher_count": int(db.scalar(select(func.count(TeacherProfile.id)).where(TeacherProfile.status == "approved")) or 0),
    }


@router.get("")
def search_teachers(
    q: str = Query("", max_length=120),
    subject: str = Query("", max_length=80),
    topic: str = Query("", max_length=120),
    verified: bool = Query(False),
    min_rating: float = Query(0, ge=0, le=5),
    min_experience: int = Query(0, ge=0, le=60),
    format: str = Query("", max_length=8),
    language: str = Query("", max_length=40),
    available: bool = Query(False),
    sort: Literal["relevance", "rating", "experience", "students", "newest"] = "relevance",
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=50),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    profiles = db.scalars(select(TeacherProfile).where(TeacherProfile.status == "approved")).all()
    blocked = {
        row.blocked_id if row.blocker_id == student.id else row.blocker_id
        for row in db.scalars(select(UserBlock).where(or_(UserBlock.blocker_id == student.id, UserBlock.blocked_id == student.id))).all()
    }
    profiles = [p for p in profiles if p.student_id not in blocked]
    ids = [p.id for p in profiles]
    specs: dict[int, list[TeacherSpecialty]] = {}
    for row in db.scalars(select(TeacherSpecialty).where(TeacherSpecialty.teacher_id.in_(ids))).all() if ids else []:
        specs.setdefault(row.teacher_id, []).append(row)
    stats = T.stats_for(db, ids)

    needle = q.strip().lower()
    extra_text: dict[int, str] = {}
    if needle and ids:
        # Search reaches beyond the profile: qualifications, groups and public content.
        for row in db.scalars(select(TeacherQualification).where(TeacherQualification.teacher_id.in_(ids))).all():
            extra_text[row.teacher_id] = extra_text.get(row.teacher_id, "") + f" {row.title} {row.institution}"
        for row in db.scalars(select(StudyGroup).where(StudyGroup.teacher_id.in_(ids), StudyGroup.privacy != "invite")).all():
            extra_text[row.teacher_id] = extra_text.get(row.teacher_id, "") + f" {row.name} {row.subject} {row.topic}"
        for row in db.scalars(select(TeacherMaterial).where(TeacherMaterial.teacher_id.in_(ids), TeacherMaterial.visibility == "public", TeacherMaterial.status == "active")).all():
            extra_text[row.teacher_id] = extra_text.get(row.teacher_id, "") + f" {row.title} {row.topic}"
        for row in db.scalars(select(TeacherQuiz).where(TeacherQuiz.teacher_id.in_(ids), TeacherQuiz.visibility == "public", TeacherQuiz.status == "published")).all():
            extra_text[row.teacher_id] = extra_text.get(row.teacher_id, "") + f" {row.title} {row.topic}"

    results: list[tuple[float, TeacherProfile]] = []
    for profile in profiles:
        rows = specs.get(profile.id, [])
        st = stats[profile.id]
        if subject and not any(r.subject.lower() == subject.lower() for r in rows):
            continue
        if topic and not any(r.topic.lower() == topic.lower() for r in rows):
            continue
        if verified and not profile.verified:
            continue
        if min_rating and st["rating"] < min_rating:
            continue
        if min_experience and profile.experience_years < min_experience:
            continue
        if format in {"one", "group"} and profile.formats not in {format, "both"}:
            continue
        if language and language.lower() not in [l.lower() for l in (profile.languages or [])]:
            continue
        if available and T.availability_now(profile) != "available":
            continue
        score = 0.0
        if needle:
            name = (profile.student.name if profile.student else "").lower()
            spec_text = " ".join(f"{r.subject} {r.topic}" for r in rows).lower()
            hay_profile = f"{profile.headline} {profile.bio} {profile.institution}".lower()
            if needle in spec_text:
                score += 6
            if any(r.topic.lower() == needle or r.subject.lower() == needle for r in rows):
                score += 6
            if needle in name:
                score += 5
            if needle in hay_profile:
                score += 2
            if needle in extra_text.get(profile.id, "").lower():
                score += 1.5
            if score == 0:
                tokens = [t for t in needle.split() if len(t) > 2]
                blob = f"{name} {spec_text} {hay_profile} {extra_text.get(profile.id, '')}".lower()
                score += sum(1 for t in tokens if t in blob)
            if score == 0:
                continue
        # Reputation nudges ordering but never hides anyone.
        score += st["rating"] * 0.4 + min(st["review_count"], 50) * 0.02 + (0.5 if profile.verified else 0) + min(st["students_taught"], 100) * 0.01
        results.append((score, profile))

    keyers = {
        "relevance": lambda item: -item[0],
        "rating": lambda item: (-stats[item[1].id]["rating"], -stats[item[1].id]["review_count"]),
        "experience": lambda item: -item[1].experience_years,
        "students": lambda item: -stats[item[1].id]["students_taught"],
        "newest": lambda item: -(item[1].approved_at.timestamp() if item[1].approved_at else 0),
    }
    results.sort(key=keyers[sort])
    total = len(results)
    window = results[(page - 1) * size : page * size]
    return {
        "items": [T.teacher_card_safe(db, p, stats[p.id], specs.get(p.id, [])) for _, p in window],
        "total": total,
        "page": page,
        "pages": max(1, -(-total // size)),
    }


@router.get("/me/learning")
def my_learning(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """The student side: my teachers, my requests, things shared with me, my teacher groups."""
    T.expire_requests(db)
    db.commit()
    rels = db.scalars(select(TeacherStudent).where(TeacherStudent.student_id == student.id).order_by(TeacherStudent.last_activity_at.desc())).all()
    teacher_ids = [r.teacher_id for r in rels]
    stats = T.stats_for(db, teacher_ids)
    specs: dict[int, list[TeacherSpecialty]] = {}
    for row in db.scalars(select(TeacherSpecialty).where(TeacherSpecialty.teacher_id.in_(teacher_ids))).all() if teacher_ids else []:
        specs.setdefault(row.teacher_id, []).append(row)
    reviewed = {r.relationship_id for r in db.scalars(select(TeacherReview).where(TeacherReview.student_id == student.id)).all()}
    teachers = []
    for rel in rels:
        profile = db.get(TeacherProfile, rel.teacher_id)
        if profile is None:
            continue
        # One teacher's odd data must never blank the student's whole list.
        teachers.append(
            {
                "relationship": {"id": rel.id, "status": rel.status or "active", "subject": rel.subject or "", "topic": rel.topic or "", "started_at": T.iso(rel.started_at), "ended_at": T.iso(rel.ended_at)},
                "teacher": T.teacher_card_safe(db, profile, stats.get(profile.id, {}), specs.get(profile.id, [])),
                "can_review": rel.status == "completed" and rel.id not in reviewed,
                "reviewed": rel.id in reviewed,
            }
        )
    requests = db.scalars(select(TeacherRequest).where(TeacherRequest.student_id == student.id).order_by(TeacherRequest.created_at.desc()).limit(40)).all()

    # Content that reaches me through my teachers, their groups or direct shares.
    my_group_ids = [m.group_id for m in db.scalars(select(StudyGroupMember).where(StudyGroupMember.student_id == student.id)).all()]
    candidate_teachers = set(teacher_ids) | {
        g.teacher_id for g in db.scalars(select(StudyGroup).where(StudyGroup.id.in_(my_group_ids), StudyGroup.teacher_id.is_not(None))).all()
    } if my_group_ids or teacher_ids else set()
    shared_material_ids = {s.item_id for s in db.scalars(select(TeacherShare).where(TeacherShare.student_id == student.id, TeacherShare.kind == "material")).all()}
    shared_quiz_ids = {s.item_id for s in db.scalars(select(TeacherShare).where(TeacherShare.student_id == student.id, TeacherShare.kind == "quiz")).all()}
    materials = db.scalars(
        select(TeacherMaterial)
        .where(TeacherMaterial.status == "active", or_(TeacherMaterial.teacher_id.in_(list(candidate_teachers) or [-1]), TeacherMaterial.id.in_(list(shared_material_ids) or [-1])))
        .order_by(TeacherMaterial.created_at.desc())
        .limit(60)
    ).all()
    quizzes = db.scalars(
        select(TeacherQuiz)
        .where(TeacherQuiz.status == "published", or_(TeacherQuiz.teacher_id.in_(list(candidate_teachers) or [-1]), TeacherQuiz.id.in_(list(shared_quiz_ids) or [-1])))
        .order_by(TeacherQuiz.published_at.desc())
        .limit(60)
    ).all()
    groups = db.scalars(select(StudyGroup).where(StudyGroup.id.in_(my_group_ids or [-1]), StudyGroup.teacher_id.is_not(None))).all()
    teacher_names = {p.id: T.short_name(p.student) for p in db.scalars(select(TeacherProfile).where(TeacherProfile.id.in_(list({m.teacher_id for m in materials} | {q.teacher_id for q in quizzes}) or [-1]))).all()}
    return {
        "teachers": teachers,
        "requests": _each(requests, lambda r: _request_public(db, r, for_teacher=False), "request"),
        "materials": _each(materials, lambda m: {**_material_public(db, m), "teacher_name": teacher_names.get(m.teacher_id, "")} if T.can_view_material(db, m, student) else None, "material"),
        "quizzes": _each(quizzes, lambda q: {**_quiz_summary(db, q, viewer=student), "teacher_name": teacher_names.get(q.teacher_id, "")} if T.can_view_quiz(db, q, student) else None, "quiz"),
        "groups": _each(groups, lambda g: _group_public(db, g, student), "group"),
    }


def _each(rows, build, kind: str) -> list:
    """Build each item on its own; a broken item is logged and skipped, never fatal."""
    out = []
    for row in rows:
        try:
            item = build(row)
        except Exception:  # noqa: BLE001
            logger.exception("my_learning: skipped %s %s", kind, getattr(row, "id", "?"))
            continue
        if item is not None:
            out.append(item)
    return out


@router.get("/groups/discover")
def discover_groups(
    q: str = Query("", max_length=120),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    rows = db.scalars(
        select(StudyGroup).where(StudyGroup.teacher_id.is_not(None), StudyGroup.privacy.in_(["public", "request"])).order_by(StudyGroup.id.desc()).limit(200)
    ).all()
    live = {p.id for p in db.scalars(select(TeacherProfile).where(TeacherProfile.status == "approved")).all()}
    needle = q.strip().lower()
    items = []
    for group in rows:
        if group.teacher_id not in live:
            continue
        if needle and needle not in f"{group.name} {group.description} {group.subject} {group.topic}".lower():
            continue
        items.append(_group_public(db, group, student))
    return {"items": items[:60]}


@router.post("/groups/{group_id}/join")
async def join_teacher_group(group_id: int, payload: GroupJoinIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    group = db.get(StudyGroup, group_id)
    if group is None or not group.teacher_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found.")
    profile = T.live_teacher_or_404(db, group.teacher_id)
    if T.is_blocked(db, profile.student_id, student.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't join this group.")
    if db.scalar(select(StudyGroupMember.id).where(StudyGroupMember.group_id == group.id, StudyGroupMember.student_id == student.id)):
        return _group_public(db, group, student)
    if group.privacy == "invite":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This group is invite only. Ask the teacher for an invite.")
    if group.capacity and _group_member_count(db, group.id) >= group.capacity:
        raise HTTPException(status.HTTP_409_CONFLICT, "This group is full.")
    events = []
    if group.privacy == "request":
        existing = db.scalar(select(GroupJoinRequest).where(GroupJoinRequest.group_id == group.id, GroupJoinRequest.student_id == student.id, GroupJoinRequest.status == "pending"))
        if existing is None:
            T.limiter.check(f"gjoin:{student.id}", 10, 86400, "You've sent a lot of join requests today. Try again tomorrow.")
            db.add(GroupJoinRequest(group_id=group.id, student_id=student.id, message=T.clean(payload.message, 300)))
            events.append(T.notify(db, profile.student_id, f"New request to join {group.name}", f"{student.name} asked to join.", {"tab": "studio", "view": "groups", "group_id": group.id}))
            db.commit()
            await dispatch(events)
        return _group_public(db, group, student)
    db.add(StudyGroupMember(group_id=group.id, student_id=student.id, role="member"))
    db.flush()
    _, act = log_activity(db, group, kind="join", text=f"{T.first_name(student)} joined the group.", actor=student)
    events += act
    events.append(T.notify(db, profile.student_id, f"New member in {group.name}", f"{student.name} joined your group.", {"tab": "studio", "view": "groups", "group_id": group.id}))
    db.commit()
    await dispatch(events)
    return _group_public(db, group, student)


@router.post("/groups/{group_id}/join/cancel")
def cancel_group_join(group_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    rows = db.scalars(select(GroupJoinRequest).where(GroupJoinRequest.group_id == group_id, GroupJoinRequest.student_id == student.id, GroupJoinRequest.status == "pending")).all()
    for row in rows:
        row.status = "cancelled"
        row.decided_at = utcnow()
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Applying / my teacher profile
# ---------------------------------------------------------------------------
@router.get("/me/profile")
def my_profile(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.profile_for(db, student.id)
    return {"profile": _profile_private(db, profile) if profile else None}


def _ensure_profile(db: Session, student: Student) -> TeacherProfile:
    profile = T.profile_for(db, student.id)
    if profile is None:
        profile = TeacherProfile(student_id=student.id, status="draft", languages=["English"])
        db.add(profile)
        db.flush()
    return profile


@router.put("/me/profile")
def save_profile(payload: ProfileIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = _ensure_profile(db, student)
    if profile.status == "suspended":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your teacher account is suspended.")
    profile.headline = T.clean(payload.headline, 140)
    profile.bio = payload.bio.strip()[:3000]
    profile.experience_years = payload.experience_years
    profile.experience = payload.experience.strip()[:2000]
    profile.institution = T.clean(payload.institution, 160)
    profile.languages = [T.clean(l, 40) for l in payload.languages if l.strip()][:8]
    profile.formats = payload.formats
    profile.accepting = payload.accepting
    slots = []
    for slot in payload.availability:
        if slot.start < slot.end:
            slots.append({"day": slot.day, "start": slot.start, "end": slot.end})
    profile.availability = sorted(slots, key=lambda s: (s["day"], s["start"]))
    # Replace specialties wholesale — the form always sends the full set.
    for row in db.scalars(select(TeacherSpecialty).where(TeacherSpecialty.teacher_id == profile.id)).all():
        db.delete(row)
    db.flush()
    seen: set[tuple[str, str]] = set()
    for spec in payload.specialties:
        subject = T.clean(spec.subject, 80)
        topics = [T.clean(t, 120) for t in spec.topics if t.strip()] or [""]
        for topic in topics:
            key = (subject.lower(), topic.lower())
            if key in seen:
                continue
            seen.add(key)
            db.add(TeacherSpecialty(teacher_id=profile.id, subject=subject, topic=topic))
    db.commit()
    return {"profile": _profile_private(db, profile)}


@router.post("/me/submit")
async def submit_application(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.profile_for(db, student.id)
    if profile is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Save your application first.")
    if profile.status not in {"draft", "needs_info", "rejected"}:
        raise HTTPException(status.HTTP_409_CONFLICT, "This application has already been submitted.")
    problems = []
    if len(profile.headline.strip()) < 8:
        problems.append("a short headline")
    if len(profile.bio.strip()) < 60:
        problems.append("a bio of at least 60 characters")
    if not db.scalar(select(TeacherSpecialty.id).where(TeacherSpecialty.teacher_id == profile.id, TeacherSpecialty.topic != "")):
        problems.append("at least one subject with a topic")
    if not profile.languages:
        problems.append("a teaching language")
    if not db.scalar(select(TeacherQualification.id).where(TeacherQualification.teacher_id == profile.id)):
        problems.append("at least one qualification")
    if problems:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Add " + ", ".join(problems) + " before submitting.")
    profile.status = "pending"
    profile.submitted_at = utcnow()
    db.add(TeacherVerificationLog(teacher_id=profile.id, action="submitted", actor=student.name))
    db.commit()
    from ..events import to_admins

    await dispatch([to_admins("teacher_application", {"teacher_id": profile.id, "name": student.name})])
    return {"profile": _profile_private(db, profile)}


@router.post("/me/withdraw")
def withdraw_application(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.profile_for(db, student.id)
    if profile is None or profile.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, "There is no pending application to withdraw.")
    profile.status = "draft"
    db.add(TeacherVerificationLog(teacher_id=profile.id, action="withdrawn", actor=student.name))
    db.commit()
    return {"profile": _profile_private(db, profile)}


@router.post("/me/qualifications")
async def add_qualification(
    title: str = Form(..., min_length=2, max_length=160),
    institution: str = Form("", max_length=160),
    year: str = Form("", max_length=10),
    file: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    profile = _ensure_profile(db, student)
    if profile.status == "suspended":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your teacher account is suspended.")
    if db.scalar(select(func.count(TeacherQualification.id)).where(TeacherQualification.teacher_id == profile.id)) >= 12:
        raise HTTPException(status.HTTP_409_CONFLICT, "You can list up to 12 qualifications.")
    stored = await T.save_upload(db, file, student, "qualification") if file is not None and file.filename else None
    db.add(TeacherQualification(teacher_id=profile.id, title=T.clean(title, 160), institution=T.clean(institution, 160), year=T.clean(year, 10), file_id=stored.id if stored else None))
    db.commit()
    return {"profile": _profile_private(db, profile)}


@router.delete("/me/qualifications/{qualification_id}")
def delete_qualification(qualification_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.profile_for(db, student.id)
    row = db.get(TeacherQualification, qualification_id)
    if profile is None or row is None or row.teacher_id != profile.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Qualification not found.")
    db.delete(row)
    db.commit()
    return {"profile": _profile_private(db, profile)}


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------
@router.post("/files")
async def upload_file(
    purpose: Literal["material", "chat"] = Form("material"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    if purpose == "material":
        T.require_teacher(db, student)
    stored = await T.save_upload(db, file, student, purpose)
    db.commit()
    return T.file_public(stored)


@router.get("/files/{file_id}")
def download_file(file_id: int, download: bool = Query(False), db: Session = Depends(get_db), student: Student = Depends(require_student)):
    row = db.get(TeacherFile, file_id)
    if row is None or not T.can_download_file(db, row, student):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found.")
    if download and row.purpose == "material" and row.owner_id != student.id:
        for material in db.scalars(select(TeacherMaterial).where(TeacherMaterial.file_id == row.id)).all():
            material.downloads += 1
            view = db.scalar(select(TeacherMaterialView).where(TeacherMaterialView.material_id == material.id, TeacherMaterialView.student_id == student.id))
            if view:
                view.downloaded = True
        db.commit()
    path = T.file_path(row)
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found.")
    disposition = "attachment" if download else "inline"
    return FileResponse(path, media_type=row.mime, filename=row.name, content_disposition_type=disposition, headers={"Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff"})


# ---------------------------------------------------------------------------
# Requests (student side)
# ---------------------------------------------------------------------------
@router.post("/requests/{request_id}/cancel")
async def cancel_request(request_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    row = db.get(TeacherRequest, request_id)
    if row is None or row.student_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found.")
    if row.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only pending requests can be cancelled.")
    row.status = "cancelled"
    db.commit()
    return _request_public(db, row, for_teacher=False)


@router.post("/relationships/{relationship_id}/complete")
async def complete_relationship(relationship_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """Either side can mark the teaching as complete; this opens the review."""
    rel = db.get(TeacherStudent, relationship_id)
    profile = db.get(TeacherProfile, rel.teacher_id) if rel else None
    if rel is None or profile is None or student.id not in {rel.student_id, profile.student_id}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Relationship not found.")
    if rel.status != "active":
        raise HTTPException(status.HTTP_409_CONFLICT, "This teaching relationship is not active.")
    rel.status = "completed"
    rel.ended_at = utcnow()
    if rel.request_id:
        req = db.get(TeacherRequest, rel.request_id)
        if req and req.status == "accepted":
            req.status = "completed"
    events = []
    if student.id == profile.student_id:
        events.append(T.notify(db, rel.student_id, f"{T.short_name(profile.student)} marked your lessons complete", "How did it go? You can now leave a review.", {"tab": "teachers", "view": "mine", "review": rel.id}))
    else:
        events.append(T.notify(db, profile.student_id, f"{student.name} completed their lessons with you", "They can now leave a review.", {"tab": "studio", "view": "students", "student_id": student.id}))
    db.commit()
    await dispatch(events)
    return {"ok": True, "status": rel.status}


@router.post("/relationships/{relationship_id}/end")
def end_relationship(relationship_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    rel = db.get(TeacherStudent, relationship_id)
    profile = db.get(TeacherProfile, rel.teacher_id) if rel else None
    if rel is None or profile is None or student.id not in {rel.student_id, profile.student_id}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Relationship not found.")
    if rel.status == "active":
        rel.status = "ended"
        rel.ended_at = utcnow()
        db.commit()
    return {"ok": True, "status": rel.status}


# ---------------------------------------------------------------------------
# Reviews
# ---------------------------------------------------------------------------
@router.patch("/reviews/{review_id}")
def edit_review(review_id: int, payload: ReviewIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    row = db.get(TeacherReview, review_id)
    if row is None or row.student_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Review not found.")
    if utcnow() - row.created_at > T.REVIEW_EDIT_WINDOW:
        raise HTTPException(status.HTTP_409_CONFLICT, "Reviews can only be edited within 7 days.")
    spam = T.looks_like_spam(payload.body)
    if spam:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, spam)
    row.rating = payload.rating
    row.body = payload.body.strip()
    row.anonymous = payload.anonymous
    db.commit()
    return _review_public(db, row, viewer_id=student.id)


@router.post("/reviews/{review_id}/response")
def respond_review(review_id: int, payload: ReviewResponseIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    row = db.get(TeacherReview, review_id)
    if row is None or row.teacher_id != profile.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Review not found.")
    row.teacher_response = payload.response.strip()
    row.responded_at = utcnow()
    db.commit()
    return _review_public(db, row)


# ---------------------------------------------------------------------------
# Reports and blocks
# ---------------------------------------------------------------------------
@router.post("/report")
async def report(payload: ReportIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    T.limiter.check(f"report:{student.id}", 15, 3600, "You've sent several reports recently. Our team is on it.")
    duplicate = db.scalar(
        select(ContentReport.id).where(ContentReport.kind == payload.kind, ContentReport.target_id == payload.target_id, ContentReport.reporter_id == student.id, ContentReport.status == "open")
    )
    if duplicate:
        return {"ok": True, "duplicate": True}
    db.add(ContentReport(kind=payload.kind, target_id=payload.target_id, reporter_id=student.id, reason=payload.reason.strip()[:400]))
    db.commit()
    from ..events import to_admins

    await dispatch([to_admins("teacher_report", {"kind": payload.kind, "target_id": payload.target_id})])
    return {"ok": True}


@router.get("/blocks")
def list_blocks(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    rows = db.scalars(select(UserBlock).where(UserBlock.blocker_id == student.id)).all()
    return {"items": [{"id": r.blocked_id, **T.person_chip(db.get(Student, r.blocked_id)), "created_at": T.iso(r.created_at)} for r in rows]}


@router.post("/blocks/{player_id}")
def block_player(player_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    if player_id == student.id or db.get(Student, player_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Player not found.")
    if not db.scalar(select(UserBlock.id).where(UserBlock.blocker_id == student.id, UserBlock.blocked_id == player_id)):
        db.add(UserBlock(blocker_id=student.id, blocked_id=player_id))
        # Blocking closes any pending requests between the two of them.
        for profile_owner, learner in ((student.id, player_id), (player_id, student.id)):
            profile = T.profile_for(db, profile_owner)
            if profile:
                for req in db.scalars(select(TeacherRequest).where(TeacherRequest.teacher_id == profile.id, TeacherRequest.student_id == learner, TeacherRequest.status == "pending")).all():
                    req.status = "declined" if profile_owner == student.id else "cancelled"
                    req.responded_at = utcnow()
        db.commit()
    return {"ok": True, "blocked": True}


@router.delete("/blocks/{player_id}")
def unblock_player(player_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    for row in db.scalars(select(UserBlock).where(UserBlock.blocker_id == student.id, UserBlock.blocked_id == player_id)).all():
        db.delete(row)
    db.commit()
    return {"ok": True, "blocked": False}


@router.post("/typing")
async def typing(payload: TypingIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """Ephemeral "is typing…" signal; never stored."""
    T.limiter.check(f"typing:{student.id}", 40, 60, "Slow down.")
    from .chat import _can_talk

    if payload.to != student.id and _can_talk(db, student.id, payload.to):
        await dispatch([to_student(payload.to, "typing", {"from": student.id})])
    return {"ok": True}


# ---------------------------------------------------------------------------
# Messaging helpers — conversation list for the Messages screen
# ---------------------------------------------------------------------------
@router.get("/conversations")
def conversations(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    rows = db.scalars(
        select(ChatMessage)
        .where(or_(ChatMessage.sender_id == student.id, ChatMessage.recipient_id == student.id))
        .order_by(ChatMessage.created_at.desc())
        .limit(800)
    ).all()
    latest: dict[int, ChatMessage] = {}
    unread: dict[int, int] = {}
    for row in rows:
        other = row.recipient_id if row.sender_id == student.id else row.sender_id
        latest.setdefault(other, row)
        if row.recipient_id == student.id and row.read_at is None:
            unread[other] = unread.get(other, 0) + 1
    # Teaching contacts appear even before the first message.
    me_teacher = T.profile_for(db, student.id)
    roles: dict[int, str] = {}
    for rel in db.scalars(select(TeacherStudent).where(TeacherStudent.student_id == student.id, TeacherStudent.status.in_(["active", "completed"]))).all():
        profile = db.get(TeacherProfile, rel.teacher_id)
        if profile:
            roles[profile.student_id] = "teacher"
    if me_teacher:
        for rel in db.scalars(select(TeacherStudent).where(TeacherStudent.teacher_id == me_teacher.id, TeacherStudent.status.in_(["active", "completed"]))).all():
            roles.setdefault(rel.student_id, "student")
        for req in db.scalars(select(TeacherRequest).where(TeacherRequest.teacher_id == me_teacher.id, TeacherRequest.status == "pending")).all():
            roles.setdefault(req.student_id, "request")
    blocked = {r.blocked_id for r in db.scalars(select(UserBlock).where(UserBlock.blocker_id == student.id)).all()}
    items = []
    for other_id in list(dict.fromkeys(list(latest.keys()) + list(roles.keys()))):
        other = db.get(Student, other_id)
        if other is None:
            continue
        last = latest.get(other_id)
        preview = ""
        if last is not None:
            preview = "Message deleted" if last.deleted else (last.body or {"file": "Attachment", "material": "Shared a material", "tquiz": "Shared a quiz", "duel": "Duel invite", "quiz": "Quiz plan"}.get(last.kind, ""))
        items.append(
            {
                "with": T.person_chip(other),
                "role": roles.get(other_id, "friend"),
                "last": {"body": preview[:120], "mine": last.sender_id == student.id, "created_at": T.iso(last.created_at), "read": last.read_at is not None} if last else None,
                "unread": unread.get(other_id, 0),
                "blocked": other_id in blocked,
            }
        )
    items.sort(key=lambda item: item["last"]["created_at"] if item["last"] else "", reverse=True)
    return {"items": items}


# ---------------------------------------------------------------------------
# Content consumption (students)
# ---------------------------------------------------------------------------
@router.get("/materials/{material_id}")
def open_material(material_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    row = db.get(TeacherMaterial, material_id)
    if row is None or not T.can_view_material(db, row, student):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material not found.")
    profile = db.get(TeacherProfile, row.teacher_id)
    owner = profile is not None and profile.student_id == student.id
    if not owner:
        row.views += 1
        view = db.scalar(select(TeacherMaterialView).where(TeacherMaterialView.material_id == row.id, TeacherMaterialView.student_id == student.id))
        if view is None:
            db.add(TeacherMaterialView(material_id=row.id, student_id=student.id))
        else:
            view.viewed_at = utcnow()
        db.commit()
    payload = _material_public(db, row, owner=owner)
    payload["body"] = row.body
    payload["teacher"] = {"id": profile.id, "name": T.short_name(profile.student), "verified": profile.verified} if profile else None
    return payload


@router.get("/quizzes/{quiz_id}")
def quiz_info(quiz_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    quiz = db.get(TeacherQuiz, quiz_id)
    if quiz is None or not T.can_view_quiz(db, quiz, student):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quiz not found.")
    profile = db.get(TeacherProfile, quiz.teacher_id)
    payload = _quiz_summary(db, quiz, viewer=student)
    payload["teacher"] = {"id": profile.id, "name": T.short_name(profile.student), "verified": profile.verified} if profile else None
    attempts = db.scalars(
        select(TeacherQuizAttempt).where(TeacherQuizAttempt.quiz_id == quiz.id, TeacherQuizAttempt.student_id == student.id, TeacherQuizAttempt.status == "submitted").order_by(TeacherQuizAttempt.id.desc()).limit(10)
    ).all()
    payload["attempts"] = [{"id": a.id, "percentage": a.percentage, "passed": a.passed, "submitted_at": T.iso(a.submitted_at)} for a in attempts]
    return payload


def _attempt_payload(db: Session, attempt: TeacherQuizAttempt, quiz: TeacherQuiz, *, reveal: bool) -> dict:
    questions = db.scalars(select(TeacherQuizQuestion).where(TeacherQuizQuestion.quiz_id == quiz.id).order_by(TeacherQuizQuestion.position, TeacherQuizQuestion.id)).all()
    items = []
    for q in questions:
        item = _question_for_student(q)
        if reveal:
            given = (attempt.answers or {}).get(str(q.id))
            item.update({"given": given, "answer": q.answer, "explanation": q.explanation, "correct": T.grade_answer(q.kind, q.answer, q.tolerance, given)})
        items.append(item)
    remaining = None
    if attempt.deadline and attempt.status == "in_progress":
        remaining = max(0, int((attempt.deadline - utcnow()).total_seconds()))
    return {
        "id": attempt.id,
        "quiz": {"id": quiz.id, "title": quiz.title, "time_limit_minutes": quiz.time_limit_minutes, "pass_mark": quiz.pass_mark},
        "status": attempt.status,
        "questions": items,
        "answers": attempt.answers or {},
        "remaining_seconds": remaining,
        "score": attempt.score,
        "max_score": attempt.max_score,
        "percentage": attempt.percentage,
        "passed": attempt.passed,
        "submitted_at": T.iso(attempt.submitted_at),
    }


@router.post("/quizzes/{quiz_id}/start")
def start_quiz(quiz_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    quiz = db.get(TeacherQuiz, quiz_id)
    if quiz is None or quiz.status != "published" or not T.can_view_quiz(db, quiz, student):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quiz not found.")
    attempt = db.scalar(select(TeacherQuizAttempt).where(TeacherQuizAttempt.quiz_id == quiz.id, TeacherQuizAttempt.student_id == student.id, TeacherQuizAttempt.status == "in_progress"))
    if attempt is not None and attempt.deadline and attempt.deadline < utcnow():
        _grade_attempt(db, attempt, quiz)
        attempt = None
    if attempt is None:
        T.limiter.check(f"quizstart:{student.id}", 30, 3600, "Too many quiz attempts this hour.")
        deadline = utcnow() + timedelta(minutes=quiz.time_limit_minutes) if quiz.time_limit_minutes else None
        attempt = TeacherQuizAttempt(quiz_id=quiz.id, student_id=student.id, deadline=deadline, answers={})
        db.add(attempt)
    db.commit()
    return _attempt_payload(db, attempt, quiz, reveal=False)


def _grade_attempt(db: Session, attempt: TeacherQuizAttempt, quiz: TeacherQuiz) -> None:
    questions = db.scalars(select(TeacherQuizQuestion).where(TeacherQuizQuestion.quiz_id == quiz.id)).all()
    score = 0.0
    total = 0.0
    for q in questions:
        total += q.marks
        if T.grade_answer(q.kind, q.answer, q.tolerance, (attempt.answers or {}).get(str(q.id))):
            score += q.marks
    attempt.score = score
    attempt.max_score = total
    attempt.percentage = round(score * 100 / total, 1) if total else 0.0
    attempt.passed = attempt.percentage >= quiz.pass_mark
    attempt.status = "submitted"
    attempt.submitted_at = utcnow()


@router.post("/quizzes/attempts/{attempt_id}/save")
def save_answers(attempt_id: int, payload: SubmitIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    attempt = db.get(TeacherQuizAttempt, attempt_id)
    if attempt is None or attempt.student_id != student.id or attempt.status != "in_progress":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attempt not found.")
    if attempt.deadline and attempt.deadline < utcnow():
        raise HTTPException(status.HTTP_409_CONFLICT, "Time is up.")
    attempt.answers = {str(k): (str(v)[:400] if v is not None else None) for k, v in payload.answers.items()}
    db.commit()
    return {"ok": True}


@router.post("/quizzes/attempts/{attempt_id}/submit")
async def submit_quiz(attempt_id: int, payload: SubmitIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    attempt = db.get(TeacherQuizAttempt, attempt_id)
    if attempt is None or attempt.student_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attempt not found.")
    quiz = db.get(TeacherQuiz, attempt.quiz_id)
    if attempt.status == "in_progress":
        # Answers arriving after the deadline (plus a small grace) are ignored.
        if not attempt.deadline or utcnow() <= attempt.deadline + timedelta(seconds=10):
            attempt.answers = {str(k): (str(v)[:400] if v is not None else None) for k, v in payload.answers.items()}
        _grade_attempt(db, attempt, quiz)
        profile = db.get(TeacherProfile, quiz.teacher_id)
        events = []
        if profile and profile.student_id != student.id:
            events.append(T.notify(db, profile.student_id, f"{student.name} completed {quiz.title}", f"Scored {attempt.percentage:g}%.", {"tab": "studio", "view": "quizzes", "quiz_id": quiz.id}))
            rel = T.relationship_between(db, profile.id, student.id)
            if rel:
                rel.last_activity_at = utcnow()
        db.commit()
        await dispatch(events)
    return _attempt_payload(db, attempt, quiz, reveal=True)


@router.get("/quizzes/attempts/{attempt_id}")
def get_attempt(attempt_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    attempt = db.get(TeacherQuizAttempt, attempt_id)
    if attempt is None or attempt.student_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attempt not found.")
    quiz = db.get(TeacherQuiz, attempt.quiz_id)
    return _attempt_payload(db, attempt, quiz, reveal=attempt.status == "submitted")


# ---------------------------------------------------------------------------
# Teacher Studio
# ---------------------------------------------------------------------------
@router.get("/studio/overview")
def studio_overview(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    T.expire_requests(db)
    db.commit()
    stats = T.stats_for(db, [profile.id])[profile.id]
    pending = db.scalars(select(TeacherRequest).where(TeacherRequest.teacher_id == profile.id, TeacherRequest.status == "pending").order_by(TeacherRequest.created_at.desc())).all()
    my_student_ids = [r.student_id for r in db.scalars(select(TeacherStudent).where(TeacherStudent.teacher_id == profile.id)).all()]
    my_student_ids += [r.student_id for r in pending]
    unread = int(
        db.scalar(select(func.count(ChatMessage.id)).where(ChatMessage.recipient_id == student.id, ChatMessage.read_at.is_(None), ChatMessage.sender_id.in_(my_student_ids or [-1]))) or 0
    )
    group_ids = [g.id for g in db.scalars(select(StudyGroup).where(StudyGroup.teacher_id == profile.id)).all()]
    pending_joins = int(db.scalar(select(func.count(GroupJoinRequest.id)).where(GroupJoinRequest.group_id.in_(group_ids or [-1]), GroupJoinRequest.status == "pending")) or 0)

    # Recent activity, newest first, stitched from the things teachers care about.
    activity: list[dict] = []
    for req in db.scalars(select(TeacherRequest).where(TeacherRequest.teacher_id == profile.id).order_by(TeacherRequest.created_at.desc()).limit(8)).all():
        who = db.get(Student, req.student_id)
        activity.append({"kind": "request", "text": f"{who.name if who else 'A student'} asked for help with {req.topic or req.subject or 'a topic'}", "at": T.iso(req.created_at)})
    for att in db.scalars(
        select(TeacherQuizAttempt).join(TeacherQuiz, TeacherQuiz.id == TeacherQuizAttempt.quiz_id).where(TeacherQuiz.teacher_id == profile.id, TeacherQuizAttempt.status == "submitted").order_by(TeacherQuizAttempt.submitted_at.desc()).limit(8)
    ).all():
        who = db.get(Student, att.student_id)
        quiz = db.get(TeacherQuiz, att.quiz_id)
        activity.append({"kind": "quiz", "text": f"{who.name if who else 'A student'} scored {att.percentage:g}% on {quiz.title if quiz else 'a quiz'}", "at": T.iso(att.submitted_at)})
    for rev in db.scalars(select(TeacherReview).where(TeacherReview.teacher_id == profile.id).order_by(TeacherReview.created_at.desc()).limit(5)).all():
        activity.append({"kind": "review", "text": f"New {rev.rating}-star review", "at": T.iso(rev.created_at)})
    for view in db.scalars(
        select(TeacherMaterialView).join(TeacherMaterial, TeacherMaterial.id == TeacherMaterialView.material_id).where(TeacherMaterial.teacher_id == profile.id).order_by(TeacherMaterialView.viewed_at.desc()).limit(6)
    ).all():
        who = db.get(Student, view.student_id)
        material = db.get(TeacherMaterial, view.material_id)
        activity.append({"kind": "material", "text": f"{who.name if who else 'A student'} opened {material.title if material else 'a material'}", "at": T.iso(view.viewed_at)})
    for member in db.scalars(
        select(StudyGroupMember).where(StudyGroupMember.group_id.in_(group_ids or [-1]), StudyGroupMember.role != "owner").order_by(StudyGroupMember.joined_at.desc()).limit(6)
    ).all():
        who = db.get(Student, member.student_id)
        group = db.get(StudyGroup, member.group_id)
        activity.append({"kind": "group", "text": f"{who.name if who else 'A student'} joined {group.name if group else 'your group'}", "at": T.iso(member.joined_at)})
    activity.sort(key=lambda a: a["at"] or "", reverse=True)

    return {
        "profile": {"id": profile.id, "name": student.name, "short_name": T.short_name(student), "verified": profile.verified, "headline": profile.headline, "accepting": profile.accepting},
        "today": {"new_requests": len(pending), "active_students": stats["active_students"], "unread_messages": unread, "group_requests": pending_joins},
        "stats": stats,
        "badges": T.badges_for(profile, stats),
        "pending": [_request_public(db, r, for_teacher=True) for r in pending[:5]],
        "activity": activity[:14],
    }


@router.get("/studio/requests")
def studio_requests(state: str = Query("pending"), db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    T.expire_requests(db)
    db.commit()
    query = select(TeacherRequest).where(TeacherRequest.teacher_id == profile.id)
    if state != "all":
        query = query.where(TeacherRequest.status == state)
    rows = db.scalars(query.order_by(TeacherRequest.created_at.desc()).limit(100)).all()
    counts = dict(db.execute(select(TeacherRequest.status, func.count(TeacherRequest.id)).where(TeacherRequest.teacher_id == profile.id).group_by(TeacherRequest.status)).all())
    return {"items": [_request_public(db, r, for_teacher=True) for r in rows], "counts": counts}


@router.post("/studio/requests/{request_id}/{decision}")
async def decide_request(request_id: int, decision: Literal["accept", "decline"], payload: DecisionIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    row = db.get(TeacherRequest, request_id)
    if row is None or row.teacher_id != profile.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found.")
    T.expire_requests(db)
    if row.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, f"This request is already {row.status}.")
    row.response_note = T.clean(payload.note, 400)
    row.responded_at = utcnow()
    events = []
    if decision == "accept":
        row.status = "accepted"
        rel = T.relationship_between(db, profile.id, row.student_id)
        if rel is None:
            rel = TeacherStudent(teacher_id=profile.id, student_id=row.student_id, request_id=row.id, subject=row.subject, topic=row.topic)
            db.add(rel)
        else:
            rel.status = "active"
            rel.request_id = row.id
            rel.subject, rel.topic = row.subject, row.topic
            rel.started_at = utcnow()
            rel.ended_at = None
        rel.last_activity_at = utcnow()
        events.append(T.notify(db, row.student_id, f"{T.short_name(student)} accepted your request", row.response_note or "You can now message each other.", {"tab": "messages", "with": student.id}))
    else:
        row.status = "declined"
        events.append(T.notify(db, row.student_id, f"{T.short_name(student)} can't take your request", row.response_note or "Try another teacher for this topic.", {"tab": "teachers", "view": "mine"}))
    db.commit()
    await dispatch(events)
    return _request_public(db, row, for_teacher=True)


@router.get("/studio/students")
def studio_students(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    rels = db.scalars(select(TeacherStudent).where(TeacherStudent.teacher_id == profile.id).order_by(TeacherStudent.last_activity_at.desc())).all()
    quiz_ids = [q.id for q in db.scalars(select(TeacherQuiz).where(TeacherQuiz.teacher_id == profile.id)).all()]
    items = []
    for rel in rels:
        learner = db.get(Student, rel.student_id)
        attempts = db.scalars(
            select(TeacherQuizAttempt).where(TeacherQuizAttempt.student_id == rel.student_id, TeacherQuizAttempt.quiz_id.in_(quiz_ids or [-1]), TeacherQuizAttempt.status == "submitted")
        ).all()
        items.append(
            {
                "relationship": {"id": rel.id, "status": rel.status, "subject": rel.subject, "topic": rel.topic, "started_at": T.iso(rel.started_at)},
                "student": T.person_chip(learner),
                "progress": round(sum(a.percentage for a in attempts) / len(attempts)) if attempts else None,
                "quiz_attempts": len(attempts),
                "last_activity_at": T.iso(rel.last_activity_at),
            }
        )
    return {"items": items}


@router.get("/studio/students/{student_id}")
def studio_student(student_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    rel = _require_relationship(db, profile, student_id)
    learner = db.get(Student, student_id)
    quizzes = {q.id: q for q in db.scalars(select(TeacherQuiz).where(TeacherQuiz.teacher_id == profile.id)).all()}
    attempts = db.scalars(
        select(TeacherQuizAttempt).where(TeacherQuizAttempt.student_id == student_id, TeacherQuizAttempt.quiz_id.in_(list(quizzes) or [-1]), TeacherQuizAttempt.status == "submitted").order_by(TeacherQuizAttempt.submitted_at.desc())
    ).all()
    views = db.scalars(
        select(TeacherMaterialView).join(TeacherMaterial, TeacherMaterial.id == TeacherMaterialView.material_id).where(TeacherMaterial.teacher_id == profile.id, TeacherMaterialView.student_id == student_id).order_by(TeacherMaterialView.viewed_at.desc())
    ).all()
    note = db.scalar(select(TeacherNote).where(TeacherNote.teacher_id == profile.id, TeacherNote.student_id == student_id))
    groups = db.scalars(
        select(StudyGroup).join(StudyGroupMember, StudyGroupMember.group_id == StudyGroup.id).where(StudyGroup.teacher_id == profile.id, StudyGroupMember.student_id == student_id)
    ).all()
    requests = db.scalars(select(TeacherRequest).where(TeacherRequest.teacher_id == profile.id, TeacherRequest.student_id == student_id).order_by(TeacherRequest.created_at.desc())).all()
    return {
        "student": T.person_chip(learner),
        "relationship": {"id": rel.id, "status": rel.status, "subject": rel.subject, "topic": rel.topic, "started_at": T.iso(rel.started_at), "ended_at": T.iso(rel.ended_at)},
        "performance": {
            "attempts": len(attempts),
            "average": round(sum(a.percentage for a in attempts) / len(attempts), 1) if attempts else None,
            "passed": sum(1 for a in attempts if a.passed),
            "streak": learner.streak if learner else 0,
        },
        "attempts": [{"id": a.id, "quiz": quizzes[a.quiz_id].title if a.quiz_id in quizzes else "Quiz", "percentage": a.percentage, "passed": a.passed, "submitted_at": T.iso(a.submitted_at)} for a in attempts[:30]],
        "materials": [{"id": v.material_id, "title": (db.get(TeacherMaterial, v.material_id).title if db.get(TeacherMaterial, v.material_id) else "Material"), "downloaded": v.downloaded, "viewed_at": T.iso(v.viewed_at)} for v in views[:30]],
        "groups": [{"id": g.id, "name": g.name} for g in groups],
        "requests": [_request_public(db, r, for_teacher=True) for r in requests],
        # PRIVATE: teacher-only. This endpoint is guarded by require_teacher + relationship.
        "notes": {"weak_areas": note.weak_areas, "progress": note.progress, "next_step": note.next_step, "body": note.body, "updated_at": T.iso(note.updated_at)} if note else None,
    }


@router.put("/studio/students/{student_id}/notes")
def save_notes(student_id: int, payload: NoteIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    _require_relationship(db, profile, student_id)
    note = db.scalar(select(TeacherNote).where(TeacherNote.teacher_id == profile.id, TeacherNote.student_id == student_id))
    if note is None:
        note = TeacherNote(teacher_id=profile.id, student_id=student_id)
        db.add(note)
    note.weak_areas = payload.weak_areas.strip()
    note.progress = T.clean(payload.progress, 40)
    note.next_step = payload.next_step.strip()
    note.body = payload.body.strip()
    note.updated_at = utcnow()
    db.commit()
    return {"ok": True, "updated_at": T.iso(note.updated_at)}


# ----- materials -------------------------------------------------------------
def _validate_material_target(db: Session, profile: TeacherProfile, payload: MaterialIn) -> None:
    if payload.visibility == "group":
        if not payload.group_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a group for a group material.")
        _my_group(db, profile, payload.group_id)
    if payload.kind == "file":
        file_row = db.get(TeacherFile, payload.file_id) if payload.file_id else None
        if file_row is None or file_row.owner_id != profile.student_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Upload a file first.")
    if payload.kind == "link" and not payload.link.lower().startswith(("https://", "http://")):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Links must start with https://")
    if payload.kind == "text" and len(payload.body.strip()) < 10:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Write the material's text (at least a sentence).")


async def _announce_material(db: Session, profile: TeacherProfile, row: TeacherMaterial) -> list:
    events = []
    if row.visibility == "group" and row.group_id:
        group = db.get(StudyGroup, row.group_id)
        for member in db.scalars(select(StudyGroupMember).where(StudyGroupMember.group_id == row.group_id, StudyGroupMember.student_id != profile.student_id)).all():
            events.append(T.notify(db, member.student_id, f"New material in {group.name if group else 'your group'}", row.title, {"tab": "teachers", "view": "mine", "material_id": row.id}))
    elif row.visibility == "students":
        for rel in db.scalars(select(TeacherStudent).where(TeacherStudent.teacher_id == profile.id, TeacherStudent.status == "active")).all():
            events.append(T.notify(db, rel.student_id, f"{T.short_name(profile.student)} shared a new material", row.title, {"tab": "teachers", "view": "mine", "material_id": row.id}))
    return events


@router.get("/studio/materials")
def studio_materials(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    rows = db.scalars(select(TeacherMaterial).where(TeacherMaterial.teacher_id == profile.id, TeacherMaterial.status == "active").order_by(TeacherMaterial.updated_at.desc())).all()
    return {"items": [_material_public(db, r, owner=True) for r in rows]}


@router.post("/studio/materials")
async def create_material(payload: MaterialIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    _validate_material_target(db, profile, payload)
    row = TeacherMaterial(
        teacher_id=profile.id,
        title=T.clean(payload.title, 200),
        description=payload.description.strip(),
        subject=T.clean(payload.subject, 80),
        topic=T.clean(payload.topic, 120),
        kind=payload.kind,
        body=payload.body if payload.kind == "text" else "",
        link=payload.link.strip() if payload.kind == "link" else "",
        file_id=payload.file_id if payload.kind == "file" else None,
        visibility=payload.visibility,
        group_id=payload.group_id if payload.visibility == "group" else None,
    )
    db.add(row)
    db.flush()
    events = await _announce_material(db, profile, row)
    db.commit()
    await dispatch(events)
    return _material_public(db, row, owner=True)


@router.get("/studio/materials/{material_id}")
def studio_material(material_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    row = db.get(TeacherMaterial, material_id)
    if row is None or row.teacher_id != profile.id or row.status != "active":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material not found.")
    payload = _material_public(db, row, owner=True)
    payload["body"] = row.body
    return payload


@router.put("/studio/materials/{material_id}")
async def update_material(material_id: int, payload: MaterialIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    row = db.get(TeacherMaterial, material_id)
    if row is None or row.teacher_id != profile.id or row.status != "active":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material not found.")
    _validate_material_target(db, profile, payload)
    widened = payload.visibility != row.visibility or payload.group_id != row.group_id
    row.title = T.clean(payload.title, 200)
    row.description = payload.description.strip()
    row.subject = T.clean(payload.subject, 80)
    row.topic = T.clean(payload.topic, 120)
    row.kind = payload.kind
    row.body = payload.body if payload.kind == "text" else ""
    row.link = payload.link.strip() if payload.kind == "link" else ""
    row.file_id = payload.file_id if payload.kind == "file" else None  # replacing the file keeps the material
    row.visibility = payload.visibility
    row.group_id = payload.group_id if payload.visibility == "group" else None
    events = await _announce_material(db, profile, row) if widened else []
    db.commit()
    await dispatch(events)
    return _material_public(db, row, owner=True)


@router.delete("/studio/materials/{material_id}")
def delete_material(material_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    row = db.get(TeacherMaterial, material_id)
    if row is None or row.teacher_id != profile.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material not found.")
    db.delete(row)
    db.commit()
    return {"ok": True}


async def _share(db: Session, profile: TeacherProfile, kind: str, item_id: int, title: str, student_ids: list[int]) -> int:
    allowed = {r.student_id for r in db.scalars(select(TeacherStudent).where(TeacherStudent.teacher_id == profile.id, TeacherStudent.status.in_(["active", "completed"]))).all()}
    events = []
    count = 0
    for sid in set(student_ids):
        if sid not in allowed or T.is_blocked(db, profile.student_id, sid):
            continue
        if not db.scalar(select(TeacherShare.id).where(TeacherShare.kind == kind, TeacherShare.item_id == item_id, TeacherShare.student_id == sid)):
            db.add(TeacherShare(kind=kind, item_id=item_id, student_id=sid))
        count += 1
        label = "material" if kind == "material" else "quiz"
        events.append(T.notify(db, sid, f"{T.short_name(profile.student)} shared a {label} with you", title, {"tab": "teachers", "view": "mine", f"{label}_id": item_id}))
    db.commit()
    await dispatch(events)
    return count


@router.post("/studio/materials/{material_id}/share")
async def share_material(material_id: int, payload: ShareIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    row = db.get(TeacherMaterial, material_id)
    if row is None or row.teacher_id != profile.id or row.status != "active":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material not found.")
    return {"shared": await _share(db, profile, "material", row.id, row.title, payload.student_ids)}


# ----- quizzes ---------------------------------------------------------------
def _validate_question(q: QuestionIn) -> None:
    if q.kind == "mcq":
        options = [o for o in q.options if o.strip()]
        if len(options) < 2:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"“{q.prompt[:40]}” needs at least two options.")
        letters = "ABCDEF"[: len(options)]
        if q.answer.strip().upper() not in letters:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Pick the correct option for “{q.prompt[:40]}”.")
    elif q.kind == "tf":
        if q.answer.strip().lower() not in {"true", "false"}:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Choose True or False for “{q.prompt[:40]}”.")
    elif q.kind == "numeric":
        try:
            float(q.answer)
        except ValueError as error:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"“{q.prompt[:40]}” needs a numeric answer.") from error
    elif not q.answer.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Add the accepted answer for “{q.prompt[:40]}”.")


def _apply_quiz(db: Session, profile: TeacherProfile, quiz: TeacherQuiz, payload: QuizIn) -> None:
    if payload.visibility == "group":
        if not payload.group_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a group for a group quiz.")
        _my_group(db, profile, payload.group_id)
    for q in payload.questions:
        _validate_question(q)
    quiz.title = T.clean(payload.title, 200)
    quiz.description = payload.description.strip()
    quiz.subject = T.clean(payload.subject, 80)
    quiz.topic = T.clean(payload.topic, 120)
    quiz.time_limit_minutes = payload.time_limit_minutes
    quiz.pass_mark = payload.pass_mark
    quiz.visibility = payload.visibility
    quiz.group_id = payload.group_id if payload.visibility == "group" else None
    existing = {q.id: q for q in db.scalars(select(TeacherQuizQuestion).where(TeacherQuizQuestion.quiz_id == quiz.id)).all()} if quiz.id else {}
    keep: set[int] = set()
    for position, q in enumerate(payload.questions):
        row = existing.get(q.id) if q.id else None
        if row is None:
            row = TeacherQuizQuestion(quiz_id=quiz.id)
            db.add(row)
        row.position = position
        row.kind = q.kind
        row.prompt = q.prompt.strip()
        row.options = [o.strip() for o in q.options if o.strip()] if q.kind == "mcq" else (["True", "False"] if q.kind == "tf" else [])
        row.answer = q.answer.strip().upper() if q.kind == "mcq" else q.answer.strip().lower() if q.kind == "tf" else q.answer.strip()
        row.tolerance = q.tolerance if q.kind == "numeric" else 0.0
        row.explanation = q.explanation.strip()
        row.marks = q.marks
        row.difficulty = q.difficulty
        row.source_question_id = q.source_question_id
        if row.id:
            keep.add(row.id)
    for qid, row in existing.items():
        if qid not in keep:
            db.delete(row)


def _quiz_full(db: Session, quiz: TeacherQuiz) -> dict:
    payload = _quiz_summary(db, quiz, owner=True)
    payload["questions"] = [_question_full(q) for q in db.scalars(select(TeacherQuizQuestion).where(TeacherQuizQuestion.quiz_id == quiz.id).order_by(TeacherQuizQuestion.position, TeacherQuizQuestion.id)).all()]
    return payload


def _my_quiz(db: Session, profile: TeacherProfile, quiz_id: int) -> TeacherQuiz:
    quiz = db.get(TeacherQuiz, quiz_id)
    if quiz is None or quiz.teacher_id != profile.id or quiz.status == "removed":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quiz not found.")
    return quiz


@router.get("/studio/quizzes")
def studio_quizzes(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    rows = db.scalars(select(TeacherQuiz).where(TeacherQuiz.teacher_id == profile.id, TeacherQuiz.status != "removed").order_by(TeacherQuiz.updated_at.desc())).all()
    return {"items": [_quiz_summary(db, q, owner=True) for q in rows]}


@router.post("/studio/quizzes")
def create_quiz(payload: QuizIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    quiz = TeacherQuiz(teacher_id=profile.id, title=payload.title)
    db.add(quiz)
    db.flush()
    _apply_quiz(db, profile, quiz, payload)
    db.commit()
    return _quiz_full(db, quiz)


@router.get("/studio/quizzes/{quiz_id}")
def studio_quiz(quiz_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    return _quiz_full(db, _my_quiz(db, profile, quiz_id))


@router.put("/studio/quizzes/{quiz_id}")
def update_quiz(quiz_id: int, payload: QuizIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    quiz = _my_quiz(db, profile, quiz_id)
    _apply_quiz(db, profile, quiz, payload)
    db.commit()
    return _quiz_full(db, quiz)


@router.post("/studio/quizzes/{quiz_id}/publish")
async def publish_quiz(quiz_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    quiz = _my_quiz(db, profile, quiz_id)
    count = db.scalar(select(func.count(TeacherQuizQuestion.id)).where(TeacherQuizQuestion.quiz_id == quiz.id)) or 0
    if count < 1:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Add at least one question before publishing.")
    first_publish = quiz.published_at is None
    quiz.status = "published"
    quiz.published_at = quiz.published_at or utcnow()
    events = []
    if first_publish:
        label = f"{count} questions" + (f" · {quiz.time_limit_minutes} minutes" if quiz.time_limit_minutes else "")
        recipients: set[int] = set()
        if quiz.visibility == "group" and quiz.group_id:
            recipients = {m.student_id for m in db.scalars(select(StudyGroupMember).where(StudyGroupMember.group_id == quiz.group_id)).all()}
        elif quiz.visibility == "students":
            recipients = {r.student_id for r in db.scalars(select(TeacherStudent).where(TeacherStudent.teacher_id == profile.id, TeacherStudent.status == "active")).all()}
        recipients.discard(student.id)
        for sid in recipients:
            events.append(T.notify(db, sid, f"New quiz: {quiz.title}", label, {"tab": "teachers", "view": "mine", "quiz_id": quiz.id}))
    db.commit()
    await dispatch(events)
    return _quiz_full(db, quiz)


@router.post("/studio/quizzes/{quiz_id}/archive")
def archive_quiz(quiz_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    quiz = _my_quiz(db, profile, quiz_id)
    quiz.status = "archived"
    db.commit()
    return _quiz_full(db, quiz)


@router.post("/studio/quizzes/{quiz_id}/unarchive")
def unarchive_quiz(quiz_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    quiz = _my_quiz(db, profile, quiz_id)
    quiz.status = "published" if quiz.published_at else "draft"
    db.commit()
    return _quiz_full(db, quiz)


@router.delete("/studio/quizzes/{quiz_id}")
def delete_quiz(quiz_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    quiz = _my_quiz(db, profile, quiz_id)
    has_attempts = db.scalar(select(TeacherQuizAttempt.id).where(TeacherQuizAttempt.quiz_id == quiz.id))
    if has_attempts:
        quiz.status = "archived"  # keep students' results; archive instead
        db.commit()
        return {"ok": True, "archived": True}
    db.delete(quiz)
    db.commit()
    return {"ok": True, "archived": False}


@router.post("/studio/quizzes/bank-preview")
def bank_preview(payload: BankImportIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """Pull questions from the shared Genesis bank (the same one practice uses)."""
    T.require_teacher(db, student)
    course = db.get(Course, payload.course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found.")
    quiz_ids = [q.id for q in db.scalars(select(Quiz).where(Quiz.course_id == course.id)).all()]
    query = select(Question).where(or_(Question.course_id == course.id, Question.quiz_id.in_(quiz_ids or [-1])))
    if payload.topic.strip():
        query = query.where(func.lower(Question.topic) == payload.topic.strip().lower())
    seen_text: set[str] = set()
    pool = []
    for row in db.scalars(query).all():
        key = (row.text or "").strip().lower()
        if key and key not in seen_text:
            seen_text.add(key)
            pool.append(row)
    random.shuffle(pool)
    out = []
    for q in pool[: payload.count]:
        options = [o for o in [q.option_a, q.option_b, q.option_c, q.option_d] if (o or "").strip()]
        if len(options) < 2:
            continue
        out.append(
            {
                "kind": "mcq",
                "prompt": q.text,
                "options": options,
                "answer": (q.correct or "A").strip().upper()[:1],
                "explanation": q.explanation or "",
                "marks": 1,
                "difficulty": (q.difficulty or "medium").lower() if (q.difficulty or "").lower() in T.DIFFICULTIES else "medium",
                "source_question_id": q.id,
            }
        )
    return {"items": out, "available": len(pool)}


@router.post("/studio/quizzes/{quiz_id}/share")
async def share_quiz(quiz_id: int, payload: ShareIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    quiz = _my_quiz(db, profile, quiz_id)
    if quiz.status != "published":
        raise HTTPException(status.HTTP_409_CONFLICT, "Publish the quiz before sharing it.")
    return {"shared": await _share(db, profile, "quiz", quiz.id, quiz.title, payload.student_ids)}


@router.get("/studio/quizzes/{quiz_id}/results")
def quiz_results(quiz_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    quiz = _my_quiz(db, profile, quiz_id)
    attempts = db.scalars(select(TeacherQuizAttempt).where(TeacherQuizAttempt.quiz_id == quiz.id, TeacherQuizAttempt.status == "submitted").order_by(TeacherQuizAttempt.submitted_at.desc())).all()
    questions = db.scalars(select(TeacherQuizQuestion).where(TeacherQuizQuestion.quiz_id == quiz.id).order_by(TeacherQuizQuestion.position)).all()
    per_question = []
    for q in questions:
        answered = [a for a in attempts if (a.answers or {}).get(str(q.id)) not in (None, "")]
        correct = sum(1 for a in answered if T.grade_answer(q.kind, q.answer, q.tolerance, (a.answers or {}).get(str(q.id))))
        per_question.append({"id": q.id, "prompt": q.prompt[:140], "correct_rate": round(correct * 100 / len(attempts)) if attempts else None})
    # Completion: of the students this quiz targets, how many attempted it.
    targets: set[int] = set()
    if quiz.visibility == "group" and quiz.group_id:
        targets = {m.student_id for m in db.scalars(select(StudyGroupMember).where(StudyGroupMember.group_id == quiz.group_id, StudyGroupMember.student_id != student.id)).all()}
    elif quiz.visibility in {"students", "private"}:
        targets = {r.student_id for r in db.scalars(select(TeacherStudent).where(TeacherStudent.teacher_id == profile.id, TeacherStudent.status == "active")).all()}
    targets |= {s.student_id for s in db.scalars(select(TeacherShare).where(TeacherShare.kind == "quiz", TeacherShare.item_id == quiz.id)).all()}
    attempted = {a.student_id for a in attempts}
    return {
        "quiz": _quiz_summary(db, quiz, owner=True),
        "completion": round(len(attempted & targets) * 100 / len(targets)) if targets else None,
        "targets": len(targets),
        "attempts": [{"id": a.id, "student": T.person_chip(db.get(Student, a.student_id)), "percentage": a.percentage, "passed": a.passed, "submitted_at": T.iso(a.submitted_at)} for a in attempts[:200]],
        "questions": per_question,
    }


# ----- groups ----------------------------------------------------------------
@router.get("/studio/groups")
def studio_groups(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    rows = db.scalars(select(StudyGroup).where(StudyGroup.teacher_id == profile.id).order_by(StudyGroup.id.desc())).all()
    items = []
    for group in rows:
        payload = _group_public(db, group, student)
        payload["pending_requests"] = int(db.scalar(select(func.count(GroupJoinRequest.id)).where(GroupJoinRequest.group_id == group.id, GroupJoinRequest.status == "pending")) or 0)
        payload["materials"] = int(db.scalar(select(func.count(TeacherMaterial.id)).where(TeacherMaterial.group_id == group.id, TeacherMaterial.status == "active")) or 0)
        payload["quizzes"] = int(db.scalar(select(func.count(TeacherQuiz.id)).where(TeacherQuiz.group_id == group.id, TeacherQuiz.status == "published")) or 0)
        items.append(payload)
    return {"items": items}


@router.post("/studio/groups")
async def create_teacher_group(payload: GroupIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    if db.scalar(select(func.count(StudyGroup.id)).where(StudyGroup.teacher_id == profile.id)) >= 20:
        raise HTTPException(status.HTTP_409_CONFLICT, "You can run up to 20 groups.")
    from .groups import _make_group_code

    group = StudyGroup(
        code=_make_group_code(db),
        name=T.clean(payload.name, 140),
        description=payload.description.strip()[:300],
        owner_id=student.id,
        course_id=payload.course_id,
        goal=(payload.topic or payload.subject)[:200],
        teacher_id=profile.id,
        subject=T.clean(payload.subject, 80),
        topic=T.clean(payload.topic, 120),
        privacy=payload.privacy,
        capacity=payload.capacity,
    )
    db.add(group)
    db.flush()
    db.add(StudyGroupMember(group_id=group.id, student_id=student.id, role="owner"))
    db.flush()
    _, events = log_activity(db, group, kind="system", text=f"{T.first_name(student)} created the group.", actor=student)
    db.commit()
    await dispatch(events)
    return _group_public(db, group, student)


@router.patch("/studio/groups/{group_id}")
def update_teacher_group(group_id: int, payload: GroupIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    group = _my_group(db, profile, group_id)
    group.name = T.clean(payload.name, 140)
    group.description = payload.description.strip()[:300]
    group.subject = T.clean(payload.subject, 80)
    group.topic = T.clean(payload.topic, 120)
    group.privacy = payload.privacy
    group.capacity = payload.capacity
    db.commit()
    return _group_public(db, group, student)


@router.get("/studio/groups/{group_id}/requests")
def group_requests(group_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    group = _my_group(db, profile, group_id)
    rows = db.scalars(select(GroupJoinRequest).where(GroupJoinRequest.group_id == group.id, GroupJoinRequest.status == "pending").order_by(GroupJoinRequest.created_at)).all()
    return {"items": [{"id": r.id, "student": T.person_chip(db.get(Student, r.student_id)), "message": r.message, "created_at": T.iso(r.created_at)} for r in rows]}


@router.post("/studio/groups/{group_id}/requests/{request_id}/{decision}")
async def decide_group_request(group_id: int, request_id: int, decision: Literal["approve", "reject"], db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    group = _my_group(db, profile, group_id)
    row = db.get(GroupJoinRequest, request_id)
    if row is None or row.group_id != group.id or row.status != "pending":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found.")
    events = []
    row.decided_at = utcnow()
    if decision == "approve":
        if group.capacity and _group_member_count(db, group.id) >= group.capacity:
            raise HTTPException(status.HTTP_409_CONFLICT, "The group is full. Raise the capacity first.")
        row.status = "approved"
        if not db.scalar(select(StudyGroupMember.id).where(StudyGroupMember.group_id == group.id, StudyGroupMember.student_id == row.student_id)):
            db.add(StudyGroupMember(group_id=group.id, student_id=row.student_id, role="member"))
            db.flush()
            learner = db.get(Student, row.student_id)
            _, act = log_activity(db, group, kind="join", text=f"{T.first_name(learner)} joined the group.", actor=learner)
            events += act
        events.append(T.notify(db, row.student_id, f"You're in: {group.name}", "Your request to join was approved.", {"tab": "teachers", "view": "groups", "group_id": group.id}))
    else:
        row.status = "rejected"
        events.append(T.notify(db, row.student_id, f"Request to join {group.name}", "The teacher couldn't add you this time.", {"tab": "teachers", "view": "groups"}))
    db.commit()
    await dispatch(events)
    return {"ok": True, "status": row.status}


@router.post("/studio/groups/{group_id}/invite")
async def invite_to_group(group_id: int, payload: InviteIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    group = _my_group(db, profile, group_id)
    rel = T.relationship_between(db, profile.id, payload.student_id)
    if rel is None or T.is_blocked(db, student.id, payload.student_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can invite your own students.")
    if db.scalar(select(StudyGroupMember.id).where(StudyGroupMember.group_id == group.id, StudyGroupMember.student_id == payload.student_id)):
        raise HTTPException(status.HTTP_409_CONFLICT, "They're already in this group.")
    event = T.notify(db, payload.student_id, f"{T.short_name(student)} invited you to {group.name}", f"Join with code {group.code}.", {"tab": "teachers", "view": "groups", "group_code": group.code, "invite": True})
    db.commit()
    await dispatch([event])
    return {"ok": True}


@router.get("/studio/reviews")
def studio_reviews(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.require_teacher(db, student)
    rows = db.scalars(select(TeacherReview).where(TeacherReview.teacher_id == profile.id, TeacherReview.status == "visible").order_by(TeacherReview.created_at.desc())).all()
    stats = T.stats_for(db, [profile.id])[profile.id]
    distribution = {str(i): sum(1 for r in rows if r.rating == i) for i in range(1, 6)}
    return {"items": [_review_public(db, r) for r in rows], "stats": stats, "distribution": distribution}


# ---------------------------------------------------------------------------
# Teacher public profile + actions on a teacher (keep last: /{teacher_id})
# ---------------------------------------------------------------------------
@router.get("/{teacher_id}")
def teacher_profile(teacher_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = db.get(TeacherProfile, teacher_id)
    own = profile is not None and profile.student_id == student.id
    if profile is None or (not T.is_live(profile) and not own) or (not own and T.is_blocked(db, profile.student_id, student.id)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Teacher not found.")
    T.expire_requests(db)
    db.commit()
    specs = db.scalars(select(TeacherSpecialty).where(TeacherSpecialty.teacher_id == profile.id)).all()
    stats = T.stats_for(db, [profile.id])[profile.id]
    card = T.teacher_card_safe(db, profile, stats, list(specs))
    quals = db.scalars(select(TeacherQualification).where(TeacherQualification.teacher_id == profile.id, TeacherQualification.status != "rejected")).all()
    groups = db.scalars(select(StudyGroup).where(StudyGroup.teacher_id == profile.id, StudyGroup.privacy != "invite")).all()
    materials = db.scalars(select(TeacherMaterial).where(TeacherMaterial.teacher_id == profile.id, TeacherMaterial.visibility == "public", TeacherMaterial.status == "active").order_by(TeacherMaterial.created_at.desc()).limit(12)).all()
    quizzes = db.scalars(select(TeacherQuiz).where(TeacherQuiz.teacher_id == profile.id, TeacherQuiz.visibility == "public", TeacherQuiz.status == "published").order_by(TeacherQuiz.published_at.desc()).limit(12)).all()
    reviews = db.scalars(select(TeacherReview).where(TeacherReview.teacher_id == profile.id, TeacherReview.status == "visible").order_by(TeacherReview.created_at.desc()).limit(30)).all()
    rel = T.relationship_between(db, profile.id, student.id)
    pending = db.scalar(select(TeacherRequest).where(TeacherRequest.teacher_id == profile.id, TeacherRequest.student_id == student.id, TeacherRequest.status == "pending"))
    my_review = db.scalar(select(TeacherReview).where(TeacherReview.relationship_id == rel.id)) if rel else None
    distribution = {str(i): sum(1 for r in reviews if r.rating == i) for i in range(1, 6)}
    return {
        **card,
        "bio": profile.bio,
        "experience": profile.experience,
        "availability": profile.availability or [],
        "qualifications": [{"id": q.id, "title": q.title, "institution": q.institution, "year": q.year, "verified": q.status == "verified", "has_document": bool(q.file_id)} for q in quals],
        "groups": [_group_public(db, g, student) for g in groups],
        "materials": [_material_public(db, m) for m in materials],
        "quizzes": [_quiz_summary(db, q, viewer=student) for q in quizzes],
        "reviews": [_review_public(db, r, viewer_id=student.id) for r in reviews],
        "rating_distribution": distribution,
        "is_me": own,
        "relationship": {"id": rel.id, "status": rel.status} if rel else None,
        "pending_request": _request_public(db, pending, for_teacher=False) if pending else None,
        "can_message": bool(rel and rel.status in {"active", "completed"}) or bool(pending),
        "can_review": bool(rel and rel.status == "completed" and my_review is None),
        "my_review": _review_public(db, my_review, viewer_id=student.id) if my_review else None,
    }


@router.post("/{teacher_id}/requests")
async def request_teacher(teacher_id: int, payload: RequestIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = T.live_teacher_or_404(db, teacher_id)
    if profile.student_id == student.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can't request yourself.")
    if T.is_blocked(db, profile.student_id, student.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't send a request to this teacher.")
    if not profile.accepting:
        raise HTTPException(status.HTTP_409_CONFLICT, "This teacher isn't accepting new students right now.")
    T.expire_requests(db)
    rel = T.relationship_between(db, profile.id, student.id)
    if rel is not None and rel.status == "active":
        raise HTTPException(status.HTTP_409_CONFLICT, "You're already learning with this teacher — message them instead.")
    if db.scalar(select(TeacherRequest.id).where(TeacherRequest.teacher_id == profile.id, TeacherRequest.student_id == student.id, TeacherRequest.status == "pending")):
        raise HTTPException(status.HTTP_409_CONFLICT, "You already have a pending request with this teacher.")
    open_requests = db.scalar(select(func.count(TeacherRequest.id)).where(TeacherRequest.student_id == student.id, TeacherRequest.status == "pending")) or 0
    if open_requests >= 5:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "You have 5 pending requests. Wait for replies or cancel one first.")
    T.limiter.check(f"treq:{student.id}", 10, 86400, "You've sent the maximum number of requests for today.")
    spam = T.looks_like_spam(payload.message)
    if spam:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, spam)
    row = TeacherRequest(
        student_id=student.id,
        teacher_id=profile.id,
        subject=T.clean(payload.subject, 80),
        topic=T.clean(payload.topic, 120),
        message=payload.message.strip(),
        format=payload.format,
        preferred_time=T.clean(payload.preferred_time, 160),
    )
    db.add(row)
    db.flush()
    event = T.notify(db, profile.student_id, "New student request", f"{student.name} needs help with {row.topic or row.subject or 'a topic'}.", {"tab": "studio", "view": "requests", "request_id": row.id})
    db.commit()
    await dispatch([event])
    return _request_public(db, row, for_teacher=False)


@router.post("/{teacher_id}/reviews")
async def review_teacher(teacher_id: int, payload: ReviewIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = db.get(TeacherProfile, teacher_id)
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Teacher not found.")
    rel = T.relationship_between(db, profile.id, student.id)
    if rel is None or rel.status != "completed":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can review a teacher after completing lessons with them.")
    if db.scalar(select(TeacherReview.id).where(TeacherReview.relationship_id == rel.id)):
        raise HTTPException(status.HTTP_409_CONFLICT, "You've already reviewed this teacher. You can edit your review within 7 days.")
    spam = T.looks_like_spam(payload.body)
    if spam:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, spam)
    body = payload.body.strip()
    if body and db.scalar(select(TeacherReview.id).where(TeacherReview.student_id == student.id, TeacherReview.body == body)):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That review is identical to one you wrote before. Please describe this teacher.")
    T.limiter.check(f"review:{student.id}", 5, 86400, "You've written several reviews today. Try again tomorrow.")
    row = TeacherReview(teacher_id=profile.id, student_id=student.id, relationship_id=rel.id, rating=payload.rating, body=body, anonymous=payload.anonymous)
    db.add(row)
    db.flush()
    event = T.notify(db, profile.student_id, f"New {payload.rating}-star review", body[:120] or "A student rated your teaching.", {"tab": "studio", "view": "reviews"})
    db.commit()
    await dispatch([event])
    return _review_public(db, row, viewer_id=student.id)
