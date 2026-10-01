"""Staff tools for the Teacher Network: verification, suspension, moderation."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_admin
from ..events import dispatch
from ..models import (
    Admin,
    ContentReport,
    Student,
    StudyGroup,
    TeacherFile,
    TeacherMaterial,
    TeacherProfile,
    TeacherQualification,
    TeacherQuiz,
    TeacherRequest,
    TeacherReview,
    TeacherSpecialty,
    TeacherStudent,
    TeacherVerificationLog,
    utcnow,
)
from ..services import teachers as T

router = APIRouter(prefix="/admin/teachers", tags=["admin-teachers"])

ACTIONS = {
    # action: (allowed from, new status, verified flag or None to keep)
    "approve": ({"pending", "needs_info", "rejected", "draft"}, "approved", True),
    "reject": ({"pending", "needs_info", "draft"}, "rejected", False),
    "needs_info": ({"pending"}, "needs_info", None),
    "suspend": ({"approved", "pending", "needs_info"}, "suspended", None),
    "reinstate": ({"suspended"}, "approved", None),
    "unverify": ({"approved"}, "approved", False),
    "verify": ({"approved"}, "approved", True),
}


class ActionIn(BaseModel):
    action: Literal["approve", "reject", "needs_info", "suspend", "reinstate", "verify", "unverify", "note"]
    note: str = Field(default="", max_length=2000)  # internal, staff-only
    message: str = Field(default="", max_length=1000)  # shown to the teacher


class QualificationIn(BaseModel):
    status: Literal["pending", "verified", "rejected"]


class ReviewStatusIn(BaseModel):
    status: Literal["visible", "hidden"]
    note: str = Field(default="", max_length=400)


class ReportDecisionIn(BaseModel):
    status: Literal["resolved", "dismissed"]
    action: Literal["none", "hide_review", "remove_material", "remove_quiz", "suspend_teacher"] = "none"
    note: str = Field(default="", max_length=400)


def _row(db: Session, profile: TeacherProfile, stats: dict) -> dict:
    student = profile.student
    specs = db.scalars(select(TeacherSpecialty).where(TeacherSpecialty.teacher_id == profile.id)).all()
    return {
        "id": profile.id,
        "student_id": profile.student_id,
        "name": student.name if student else "",
        "username": student.username if student else "",
        "avatar_hue": student.avatar_hue if student else 260,
        "has_photo": bool(student and student.photo),
        "headline": profile.headline,
        "status": profile.status,
        "verified": profile.verified,
        "experience_years": profile.experience_years,
        "specialties": T.specialties_grouped(specs),
        "submitted_at": T.iso(profile.submitted_at),
        "approved_at": T.iso(profile.approved_at),
        "created_at": T.iso(profile.created_at),
        "stats": stats,
    }


@router.get("/summary")
def summary(db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    counts = dict(db.execute(select(TeacherProfile.status, func.count(TeacherProfile.id)).group_by(TeacherProfile.status)).all())
    open_reports = int(db.scalar(select(func.count(ContentReport.id)).where(ContentReport.kind.like("teacher%"), ContentReport.status == "open")) or 0)
    return {
        "counts": counts,
        "verified": int(db.scalar(select(func.count(TeacherProfile.id)).where(TeacherProfile.verified.is_(True))) or 0),
        "open_reports": open_reports,
        "hidden_reviews": int(db.scalar(select(func.count(TeacherReview.id)).where(TeacherReview.status == "hidden")) or 0),
        "relationships": int(db.scalar(select(func.count(TeacherStudent.id)).where(TeacherStudent.status == "active")) or 0),
        "pending_requests": int(db.scalar(select(func.count(TeacherRequest.id)).where(TeacherRequest.status == "pending")) or 0),
    }


@router.get("")
def list_teachers(
    state: str = Query("all"),
    q: str = Query("", max_length=120),
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    query = select(TeacherProfile)
    if state == "verified":
        query = query.where(TeacherProfile.verified.is_(True), TeacherProfile.status == "approved")
    elif state == "reported":
        reported = select(ContentReport.target_id).where(ContentReport.kind == "teacher", ContentReport.status == "open")
        query = query.where(TeacherProfile.id.in_(reported))
    elif state != "all":
        query = query.where(TeacherProfile.status == state)
    else:
        query = query.where(TeacherProfile.status != "draft")
    rows = db.scalars(query.order_by(TeacherProfile.submitted_at.desc().nullslast(), TeacherProfile.id.desc()).limit(300)).all()
    needle = q.strip().lower()
    if needle:
        rows = [r for r in rows if needle in f"{r.student.name if r.student else ''} {r.student.username if r.student else ''} {r.headline}".lower()]
    stats = T.stats_for(db, [r.id for r in rows], include_reports=True)
    return {"items": [_row(db, r, stats[r.id]) for r in rows]}


@router.get("/{teacher_id}")
def teacher_detail(teacher_id: int, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    profile = db.get(TeacherProfile, teacher_id)
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Teacher not found.")
    stats = T.stats_for(db, [profile.id], include_reports=True)[profile.id]
    quals = db.scalars(select(TeacherQualification).where(TeacherQualification.teacher_id == profile.id)).all()
    logs = db.scalars(select(TeacherVerificationLog).where(TeacherVerificationLog.teacher_id == profile.id).order_by(TeacherVerificationLog.created_at.desc())).all()
    reviews = db.scalars(select(TeacherReview).where(TeacherReview.teacher_id == profile.id).order_by(TeacherReview.created_at.desc()).limit(50)).all()
    material_ids = [m.id for m in db.scalars(select(TeacherMaterial).where(TeacherMaterial.teacher_id == profile.id)).all()]
    quiz_ids = [m.id for m in db.scalars(select(TeacherQuiz).where(TeacherQuiz.teacher_id == profile.id)).all()]
    review_ids = [r.id for r in reviews]
    reports = db.scalars(
        select(ContentReport)
        .where(
            or_(
                (ContentReport.kind == "teacher") & (ContentReport.target_id == profile.id),
                (ContentReport.kind == "teacher_material") & ContentReport.target_id.in_(material_ids or [-1]),
                (ContentReport.kind == "teacher_quiz") & ContentReport.target_id.in_(quiz_ids or [-1]),
                (ContentReport.kind == "teacher_review") & ContentReport.target_id.in_(review_ids or [-1]),
            )
        )
        .order_by(ContentReport.created_at.desc())
        .limit(50)
    ).all()
    student = profile.student
    return {
        **_row(db, profile, stats),
        "bio": profile.bio,
        "experience": profile.experience,
        "institution": profile.institution,
        "languages": profile.languages or [],
        "formats": profile.formats,
        "accepting": profile.accepting,
        "staff_message": profile.staff_message,
        "account": {"joined": T.iso(student.created_at) if student else None, "is_banned": bool(student and student.is_banned), "level": getattr(student, "level", None)},
        "qualifications": [
            {"id": q.id, "title": q.title, "institution": q.institution, "year": q.year, "status": q.status, "file": T.file_public(db.get(TeacherFile, q.file_id) if q.file_id else None)}
            for q in quals
        ],
        "history": [{"id": l.id, "action": l.action, "note": l.note, "actor": l.actor, "created_at": T.iso(l.created_at)} for l in logs],
        "reviews": [
            {"id": r.id, "rating": r.rating, "body": r.body, "anonymous": r.anonymous, "author": (db.get(Student, r.student_id).name if db.get(Student, r.student_id) else ""), "status": r.status, "teacher_response": r.teacher_response, "created_at": T.iso(r.created_at)}
            for r in reviews
        ],
        "reports": [_report_public(db, r) for r in reports],
        "materials": [{"id": m.id, "title": m.title, "visibility": m.visibility, "status": m.status, "kind": m.kind} for m in db.scalars(select(TeacherMaterial).where(TeacherMaterial.teacher_id == profile.id).order_by(TeacherMaterial.id.desc()).limit(50)).all()],
        "quizzes": [{"id": z.id, "title": z.title, "status": z.status, "visibility": z.visibility} for z in db.scalars(select(TeacherQuiz).where(TeacherQuiz.teacher_id == profile.id).order_by(TeacherQuiz.id.desc()).limit(50)).all()],
        "groups": [{"id": g.id, "name": g.name, "privacy": g.privacy, "capacity": g.capacity} for g in db.scalars(select(StudyGroup).where(StudyGroup.teacher_id == profile.id)).all()],
    }


@router.post("/{teacher_id}/action")
async def act(teacher_id: int, payload: ActionIn, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    profile = db.get(TeacherProfile, teacher_id)
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Teacher not found.")
    events = []
    if payload.action != "note":
        allowed, new_status, verified = ACTIONS[payload.action]
        if profile.status not in allowed:
            raise HTTPException(status.HTTP_409_CONFLICT, f"Can't {payload.action.replace('_', ' ')} a teacher who is {profile.status}.")
        if payload.action in {"reject", "needs_info", "suspend"} and not payload.message.strip():
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Tell the teacher why (the message is shown to them).")
        profile.status = new_status
        if verified is not None:
            profile.verified = verified
        if payload.action == "approve" and profile.approved_at is None:
            profile.approved_at = utcnow()
        if payload.message.strip():
            profile.staff_message = payload.message.strip()
        elif payload.action in {"approve", "reinstate"}:
            profile.staff_message = ""
        titles = {
            "approve": ("You're a verified Genesis teacher", "Your Teacher Studio is open. Students can now find and request you."),
            "reject": ("Your teacher application wasn't approved", payload.message.strip()),
            "needs_info": ("Your teacher application needs more information", payload.message.strip()),
            "suspend": ("Your teacher account is suspended", payload.message.strip()),
            "reinstate": ("Your teacher account is active again", payload.message.strip() or "Welcome back to the Teacher Studio."),
            "verify": ("You've been verified", "A Verified badge now shows on your profile."),
            "unverify": ("Your Verified badge was removed", payload.message.strip() or "Contact support for details."),
        }
        title, message = titles[payload.action]
        events.append(T.notify(db, profile.student_id, title, message, {"tab": "studio"}))
    db.add(TeacherVerificationLog(teacher_id=profile.id, action=payload.action, note=payload.note.strip(), actor=admin.name or admin.email, admin_id=admin.id))
    db.commit()
    await dispatch(events)
    return teacher_detail(teacher_id, db, admin)


@router.post("/qualifications/{qualification_id}")
def set_qualification(qualification_id: int, payload: QualificationIn, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    row = db.get(TeacherQualification, qualification_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Qualification not found.")
    row.status = payload.status
    db.add(TeacherVerificationLog(teacher_id=row.teacher_id, action=f"qualification_{payload.status}", note=row.title, actor=admin.name or admin.email, admin_id=admin.id))
    db.commit()
    return {"ok": True, "status": row.status}


@router.get("/files/{file_id}")
def staff_file(file_id: int, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)):
    row = db.get(TeacherFile, file_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found.")
    path = T.file_path(row)
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found.")
    return FileResponse(path, media_type=row.mime, filename=row.name, content_disposition_type="inline", headers={"X-Content-Type-Options": "nosniff"})


# ----- reports ---------------------------------------------------------------
def _report_public(db: Session, row: ContentReport) -> dict:
    reporter = db.get(Student, row.reporter_id) if row.reporter_id else None
    target: dict = {"label": f"#{row.target_id}"}
    teacher_id = None
    if row.kind == "teacher":
        profile = db.get(TeacherProfile, row.target_id)
        target = {"label": profile.student.name if profile and profile.student else "Teacher"}
        teacher_id = row.target_id
    elif row.kind == "teacher_material":
        item = db.get(TeacherMaterial, row.target_id)
        target = {"label": item.title if item else "Deleted material", "status": item.status if item else "deleted"}
        teacher_id = item.teacher_id if item else None
    elif row.kind == "teacher_quiz":
        item = db.get(TeacherQuiz, row.target_id)
        target = {"label": item.title if item else "Deleted quiz", "status": item.status if item else "deleted"}
        teacher_id = item.teacher_id if item else None
    elif row.kind == "teacher_review":
        item = db.get(TeacherReview, row.target_id)
        target = {"label": f"{item.rating}★ “{item.body[:80]}”" if item else "Deleted review", "status": item.status if item else "deleted"}
        teacher_id = item.teacher_id if item else None
    elif row.kind == "teacher_group":
        item = db.get(StudyGroup, row.target_id)
        target = {"label": item.name if item else "Deleted group"}
        teacher_id = item.teacher_id if item else None
    elif row.kind == "teacher_student":
        item = db.get(Student, row.target_id)
        target = {"label": item.name if item else "Player"}
    return {
        "id": row.id,
        "kind": row.kind,
        "target_id": row.target_id,
        "target": target,
        "teacher_id": teacher_id,
        "reason": row.reason,
        "reporter": reporter.name if reporter else "Unknown",
        "status": row.status,
        "resolved_by": row.resolved_by,
        "created_at": T.iso(row.created_at),
    }


@router.get("/moderation/reports")
def reports(state: str = Query("open"), db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    query = select(ContentReport).where(ContentReport.kind.like("teacher%"))
    if state != "all":
        query = query.where(ContentReport.status == state)
    rows = db.scalars(query.order_by(ContentReport.created_at.desc()).limit(200)).all()
    return {"items": [_report_public(db, r) for r in rows]}


@router.post("/moderation/reports/{report_id}")
async def decide_report(report_id: int, payload: ReportDecisionIn, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    row = db.get(ContentReport, report_id)
    if row is None or not row.kind.startswith("teacher"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found.")
    events = []
    actor = admin.name or admin.email
    if payload.action == "hide_review" and row.kind == "teacher_review":
        review = db.get(TeacherReview, row.target_id)
        if review:
            review.status = "hidden"
    elif payload.action == "remove_material" and row.kind == "teacher_material":
        item = db.get(TeacherMaterial, row.target_id)
        if item:
            item.status = "removed"
            profile = db.get(TeacherProfile, item.teacher_id)
            if profile:
                events.append(T.notify(db, profile.student_id, "A material was removed", f"“{item.title}” broke the community guidelines. {payload.note}".strip(), {"tab": "studio", "view": "materials"}))
    elif payload.action == "remove_quiz" and row.kind == "teacher_quiz":
        item = db.get(TeacherQuiz, row.target_id)
        if item:
            item.status = "removed"
            profile = db.get(TeacherProfile, item.teacher_id)
            if profile:
                events.append(T.notify(db, profile.student_id, "A quiz was removed", f"“{item.title}” broke the community guidelines. {payload.note}".strip(), {"tab": "studio", "view": "quizzes"}))
    elif payload.action == "suspend_teacher":
        teacher_id = _report_public(db, row).get("teacher_id")
        profile = db.get(TeacherProfile, teacher_id) if teacher_id else None
        if profile and profile.status != "suspended":
            profile.status = "suspended"
            profile.staff_message = payload.note or "Suspended after a report review."
            db.add(TeacherVerificationLog(teacher_id=profile.id, action="suspend", note=f"Report #{row.id}: {payload.note}", actor=actor, admin_id=admin.id))
            events.append(T.notify(db, profile.student_id, "Your teacher account is suspended", profile.staff_message, {"tab": "studio"}))
    row.status = payload.status
    row.resolved_by = actor
    db.commit()
    await dispatch(events)
    return _report_public(db, row)


@router.post("/moderation/reviews/{review_id}")
def set_review(review_id: int, payload: ReviewStatusIn, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    row = db.get(TeacherReview, review_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Review not found.")
    row.status = payload.status
    db.add(TeacherVerificationLog(teacher_id=row.teacher_id, action=f"review_{payload.status}", note=f"Review #{row.id}. {payload.note}".strip(), actor=admin.name or admin.email, admin_id=admin.id))
    db.commit()
    return {"ok": True, "status": row.status}


@router.post("/moderation/{kind}/{item_id}/{verb}")
def set_content(kind: Literal["materials", "quizzes"], item_id: int, verb: Literal["remove", "restore"], db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    model = TeacherMaterial if kind == "materials" else TeacherQuiz
    row = db.get(model, item_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.")
    if verb == "remove":
        row.status = "removed"
    else:
        row.status = "active" if kind == "materials" else ("published" if row.published_at else "draft")
    db.add(TeacherVerificationLog(teacher_id=row.teacher_id, action=f"{kind[:-1] if kind == 'materials' else 'quiz'}_{verb}", note=row.title, actor=admin.name or admin.email, admin_id=admin.id))
    db.commit()
    return {"ok": True, "status": row.status}
