"""Teacher, school, subscription and persistent adaptive-learning APIs.

Admin identities carry staff/teacher/principal roles; organization memberships
and class assignments constrain what each account may inspect. Student-facing
routes never accept a student id from the browser.
"""
from __future__ import annotations

import csv
import io
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_institution_staff, require_student
from ..models import (
    Admin,
    AdaptiveLearningSession,
    Assignment,
    AssignmentSubmission,
    ClassEnrollment,
    ClassTeacher,
    ConceptPrerequisite,
    Course,
    LearningConcept,
    MasterySnapshot,
    Organization,
    OrganizationMember,
    PlayerMastery,
    Student,
    SubscriptionAccount,
    TeachingClass,
    utcnow,
)
from ..security import hash_password
from ..services import learning_intelligence

router = APIRouter(prefix="/institutions", tags=["institutions"])
learning_router = APIRouter(prefix="/learning", tags=["learning-intelligence"])


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:100]


def _org_access(db: Session, admin: Admin, organization_id: int, *, manage: bool = False) -> Organization:
    org = db.get(Organization, organization_id)
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found.")
    if admin.role == "owner":
        return org
    member = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.actor_type == "admin",
            OrganizationMember.actor_id == admin.id,
            OrganizationMember.status == "active",
        )
    )
    allowed = {"owner", "principal"} if manage else {"owner", "principal", "teacher", "analyst"}
    if member is None or member.role not in allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this organization.")
    return org


def _class_access(db: Session, admin: Admin, class_id: int, *, manage: bool = False) -> TeachingClass:
    classroom = db.get(TeachingClass, class_id)
    if classroom is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Class not found.")
    if admin.role == "owner":
        return classroom
    try:
        _org_access(db, admin, classroom.organization_id, manage=manage)
        return classroom
    except HTTPException:
        teacher = db.scalar(select(ClassTeacher).where(ClassTeacher.class_id == class_id, ClassTeacher.admin_id == admin.id))
        if teacher is None or manage:
            raise
        return classroom


def _class_public(db: Session, row: TeachingClass) -> dict:
    students = int(db.scalar(select(func.count(ClassEnrollment.id)).where(ClassEnrollment.class_id == row.id, ClassEnrollment.status == "active")) or 0)
    teachers = int(db.scalar(select(func.count(ClassTeacher.id)).where(ClassTeacher.class_id == row.id)) or 0)
    return {"id": row.id, "organization_id": row.organization_id, "name": row.name, "academic_year": row.academic_year, "level": row.level, "course_ids": row.course_ids or [], "active": row.active, "students": students, "teachers": teachers}


@router.get("")
def organizations(db: Session = Depends(get_db), admin: Admin = Depends(require_institution_staff)) -> dict:
    stmt = select(Organization).order_by(Organization.name)
    if admin.role != "owner":
        ids = select(OrganizationMember.organization_id).where(OrganizationMember.actor_type == "admin", OrganizationMember.actor_id == admin.id, OrganizationMember.status == "active")
        stmt = stmt.where(Organization.id.in_(ids))
    rows = db.scalars(stmt).all()
    return {"organizations": [{"id": row.id, "name": row.name, "slug": row.slug, "kind": row.kind, "status": row.status, "settings": row.settings or {}} for row in rows]}


@router.post("")
def create_organization(payload: dict, db: Session = Depends(get_db), admin: Admin = Depends(require_institution_staff)) -> dict:
    if admin.role not in {"owner", "staff"}:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only platform staff can create an organization.")
    name = str(payload.get("name") or "").strip()[:200]
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Organization name is required.")
    slug = _slug(str(payload.get("slug") or name))
    if not slug or db.scalar(select(Organization.id).where(Organization.slug == slug)):
        raise HTTPException(status.HTTP_409_CONFLICT, "That organization slug is already in use.")
    row = Organization(name=name, slug=slug, kind=str(payload.get("kind") or "school")[:24], created_by=admin.id, settings=dict(payload.get("settings") or {}))
    db.add(row); db.flush()
    db.add(OrganizationMember(organization_id=row.id, actor_type="admin", actor_id=admin.id, role="owner"))
    db.add(SubscriptionAccount(owner_type="organization", owner_id=row.id, plan=str(payload.get("plan") or "school"), seats=max(1, int(payload.get("seats") or 100))))
    db.commit()
    return {"id": row.id, "name": row.name, "slug": row.slug, "kind": row.kind}


@router.post("/{organization_id}/members")
def add_member(organization_id: int, payload: dict, db: Session = Depends(get_db), admin: Admin = Depends(require_institution_staff)) -> dict:
    _org_access(db, admin, organization_id, manage=True)
    actor_type = str(payload.get("actor_type") or "student")
    actor_id = int(payload.get("actor_id") or 0)
    if actor_type not in {"admin", "student"} or not actor_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a valid admin or student.")
    actor = db.get(Admin if actor_type == "admin" else Student, actor_id)
    if actor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found.")
    row = db.scalar(select(OrganizationMember).where(OrganizationMember.organization_id == organization_id, OrganizationMember.actor_type == actor_type, OrganizationMember.actor_id == actor_id))
    if row is None:
        row = OrganizationMember(organization_id=organization_id, actor_type=actor_type, actor_id=actor_id)
        db.add(row)
    row.role = str(payload.get("role") or ("teacher" if actor_type == "admin" else "student"))[:24]
    row.status = "active"
    db.commit()
    return {"id": row.id, "role": row.role, "status": row.status}


@router.post("/{organization_id}/teachers")
def create_teacher(organization_id: int, payload: dict, db: Session = Depends(get_db), admin: Admin = Depends(require_institution_staff)) -> dict:
    _org_access(db, admin, organization_id, manage=True)
    email = str(payload.get("email") or "").strip().lower()[:200]
    name = str(payload.get("name") or "Teacher").strip()[:160]
    password = str(payload.get("password") or "")
    if "@" not in email or len(password) < 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Enter a valid email and a password of at least 8 characters.")
    teacher = db.scalar(select(Admin).where(func.lower(Admin.email) == email))
    if teacher is None:
        teacher = Admin(email=email, name=name, password_hash=hash_password(password), role="teacher")
        db.add(teacher); db.flush()
    member = db.scalar(select(OrganizationMember).where(OrganizationMember.organization_id == organization_id, OrganizationMember.actor_type == "admin", OrganizationMember.actor_id == teacher.id))
    if member is None:
        member = OrganizationMember(organization_id=organization_id, actor_type="admin", actor_id=teacher.id, role="teacher"); db.add(member)
    else:
        member.role, member.status = "teacher", "active"
    db.commit()
    return {"id": teacher.id, "email": teacher.email, "name": teacher.name, "role": "teacher"}


@router.get("/{organization_id}/dashboard")
def school_dashboard(organization_id: int, db: Session = Depends(get_db), admin: Admin = Depends(require_institution_staff)) -> dict:
    org = _org_access(db, admin, organization_id)
    classes = db.scalars(select(TeachingClass).where(TeachingClass.organization_id == organization_id).order_by(TeachingClass.name)).all()
    student_ids = select(ClassEnrollment.student_id).join(TeachingClass, TeachingClass.id == ClassEnrollment.class_id).where(TeachingClass.organization_id == organization_id, ClassEnrollment.status == "active")
    unique_ids = list(dict.fromkeys(db.scalars(student_ids).all()))
    mastery = db.execute(select(PlayerMastery.scope_key, func.avg(PlayerMastery.mastery), func.sum(PlayerMastery.answered)).where(PlayerMastery.student_id.in_(unique_ids), PlayerMastery.scope_type == "topic").group_by(PlayerMastery.scope_key).order_by(func.avg(PlayerMastery.mastery))).all() if unique_ids else []
    active_today = int(db.scalar(select(func.count(Student.id)).where(Student.id.in_(unique_ids), Student.last_active == utcnow().date())) or 0) if unique_ids else 0
    return {
        "organization": {"id": org.id, "name": org.name, "kind": org.kind},
        "summary": {"students": len(unique_ids), "active_today": active_today, "classes": len(classes), "average_mastery": round(sum(float(x[1] or 0) for x in mastery) / len(mastery), 1) if mastery else 0},
        "classes": [_class_public(db, row) for row in classes],
        "topics": [{"topic": topic, "mastery": round(float(score or 0), 1), "evidence": int(evidence or 0)} for topic, score, evidence in mastery[:16]],
    }


@router.post("/{organization_id}/classes")
def create_class(organization_id: int, payload: dict, db: Session = Depends(get_db), admin: Admin = Depends(require_institution_staff)) -> dict:
    _org_access(db, admin, organization_id, manage=True)
    name = str(payload.get("name") or "").strip()[:140]
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Class name is required.")
    row = TeachingClass(organization_id=organization_id, name=name, academic_year=str(payload.get("academic_year") or "")[:30], level=str(payload.get("level") or "")[:60], course_ids=[int(x) for x in payload.get("course_ids", []) if str(x).isdigit()], created_by=admin.id)
    db.add(row); db.flush(); db.add(ClassTeacher(class_id=row.id, admin_id=admin.id)); db.commit()
    return _class_public(db, row)


@router.post("/classes/{class_id}/enroll")
def enroll(class_id: int, payload: dict, db: Session = Depends(get_db), admin: Admin = Depends(require_institution_staff)) -> dict:
    _class_access(db, admin, class_id, manage=True)
    ids = list(dict.fromkeys(int(x) for x in payload.get("student_ids", []) if str(x).isdigit()))[:2000]
    found = set(db.scalars(select(Student.id).where(Student.id.in_(ids))).all()) if ids else set()
    added = 0
    for student_id in found:
        row = db.scalar(select(ClassEnrollment).where(ClassEnrollment.class_id == class_id, ClassEnrollment.student_id == student_id))
        if row is None:
            db.add(ClassEnrollment(class_id=class_id, student_id=student_id)); added += 1
        else:
            row.status = "active"
    db.commit()
    return {"ok": True, "added": added, "active": len(found)}


@router.post("/classes/{class_id}/teachers")
def assign_teacher(class_id: int, payload: dict, db: Session = Depends(get_db), admin: Admin = Depends(require_institution_staff)) -> dict:
    _class_access(db, admin, class_id, manage=True)
    teacher_id = int(payload.get("admin_id") or 0)
    if db.get(Admin, teacher_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Teacher account not found.")
    row = db.scalar(select(ClassTeacher).where(ClassTeacher.class_id == class_id, ClassTeacher.admin_id == teacher_id))
    if row is None:
        row = ClassTeacher(class_id=class_id, admin_id=teacher_id); db.add(row)
    row.role = str(payload.get("role") or "teacher")[:24]
    db.commit()
    return {"id": row.id, "admin_id": teacher_id, "role": row.role}


@router.get("/classes/{class_id}/intelligence")
def class_intelligence(class_id: int, db: Session = Depends(get_db), admin: Admin = Depends(require_institution_staff)) -> dict:
    classroom = _class_access(db, admin, class_id)
    student_ids = list(db.scalars(select(ClassEnrollment.student_id).where(ClassEnrollment.class_id == class_id, ClassEnrollment.status == "active")).all())
    rows = db.execute(select(PlayerMastery.scope_key, func.avg(PlayerMastery.mastery), func.sum(PlayerMastery.answered), func.count(PlayerMastery.id)).where(PlayerMastery.student_id.in_(student_ids), PlayerMastery.scope_type == "topic").group_by(PlayerMastery.scope_key)).all() if student_ids else []
    topics = sorted([{"topic": topic, "mastery": round(float(avg or 0), 1), "evidence": int(evidence or 0), "students": int(students or 0)} for topic, avg, evidence, students in rows], key=lambda x: x["mastery"])
    at_risk = db.execute(select(PlayerMastery.student_id, func.avg(PlayerMastery.mastery)).where(PlayerMastery.student_id.in_(student_ids), PlayerMastery.scope_type == "topic", PlayerMastery.answered >= 3).group_by(PlayerMastery.student_id).having(func.avg(PlayerMastery.mastery) < 50).order_by(func.avg(PlayerMastery.mastery))).all() if student_ids else []
    return {"class": _class_public(db, classroom), "summary": {"students": len(student_ids), "topics": len(topics), "mastery": round(sum(x["mastery"] for x in topics) / len(topics), 1) if topics else 0, "at_risk": len(at_risk)}, "topics": topics, "weakest": topics[:6], "strongest": list(reversed(topics[-6:])), "at_risk_students": [{"student_id": sid, "mastery": round(float(score or 0), 1)} for sid, score in at_risk[:20]]}


@router.get("/classes/{class_id}/report.csv")
def class_report(class_id: int, db: Session = Depends(get_db), admin: Admin = Depends(require_institution_staff)) -> Response:
    classroom = _class_access(db, admin, class_id)
    students = db.execute(select(Student).join(ClassEnrollment, ClassEnrollment.student_id == Student.id).where(ClassEnrollment.class_id == class_id, ClassEnrollment.status == "active").order_by(Student.name)).scalars().all()
    output = io.StringIO(); writer = csv.writer(output)
    writer.writerow(["Student", "Registration", "Topics measured", "Average mastery", "Evidence", "Critical topics"])
    for student in students:
        rows = db.scalars(select(PlayerMastery).where(PlayerMastery.student_id == student.id, PlayerMastery.scope_type == "topic", PlayerMastery.answered > 0)).all()
        average = round(sum(float(row.mastery or 0) for row in rows) / len(rows), 1) if rows else 0
        writer.writerow([student.name, student.reg_no or student.username, len(rows), average, sum(int(row.answered or 0) for row in rows), sum(1 for row in rows if row.answered >= 3 and row.mastery < 40)])
    filename = re.sub(r"[^a-zA-Z0-9_-]+", "-", classroom.name).strip("-") or f"class-{class_id}"
    return Response(output.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{filename}-learning-report.csv"'})


@router.post("/classes/{class_id}/assignments")
def create_assignment(class_id: int, payload: dict, db: Session = Depends(get_db), admin: Admin = Depends(require_institution_staff)) -> dict:
    _class_access(db, admin, class_id)
    title = str(payload.get("title") or "").strip()[:200]
    if not title:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Assignment title is required.")
    due = None
    if payload.get("due_at"):
        try: due = datetime.fromisoformat(str(payload["due_at"]).replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError: raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid due date.") from None
    row = Assignment(class_id=class_id, course_id=int(payload.get("course_id") or 0) or None, created_by=admin.id, title=title, instructions=str(payload.get("instructions") or "")[:4000], kind=str(payload.get("kind") or "practice")[:24], resource_id=int(payload.get("resource_id") or 0) or None, config=dict(payload.get("config") or {}), status=str(payload.get("status") or "published")[:20], due_at=due)
    db.add(row); db.flush()
    students = db.scalars(select(ClassEnrollment.student_id).where(ClassEnrollment.class_id == class_id, ClassEnrollment.status == "active")).all()
    db.add_all([AssignmentSubmission(assignment_id=row.id, student_id=sid) for sid in students]); db.commit()
    return {"id": row.id, "title": row.title, "status": row.status, "students": len(students), "due_at": row.due_at.isoformat() if row.due_at else None}


@router.get("/classes/{class_id}/assignments")
def class_assignments(class_id: int, db: Session = Depends(get_db), admin: Admin = Depends(require_institution_staff)) -> dict:
    _class_access(db, admin, class_id)
    rows = db.scalars(select(Assignment).where(Assignment.class_id == class_id).order_by(Assignment.id.desc())).all()
    return {"assignments": [{"id": row.id, "title": row.title, "kind": row.kind, "status": row.status, "due_at": row.due_at.isoformat() if row.due_at else None, "submitted": int(db.scalar(select(func.count(AssignmentSubmission.id)).where(AssignmentSubmission.assignment_id == row.id, AssignmentSubmission.status == "submitted")) or 0), "total": int(db.scalar(select(func.count(AssignmentSubmission.id)).where(AssignmentSubmission.assignment_id == row.id)) or 0)} for row in rows]}


@router.get("/me/assignments")
def my_assignments(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    rows = db.execute(select(AssignmentSubmission, Assignment).join(Assignment, Assignment.id == AssignmentSubmission.assignment_id).where(AssignmentSubmission.student_id == student.id, Assignment.status == "published").order_by(Assignment.due_at, Assignment.id.desc())).all()
    return {"assignments": [{"id": assignment.id, "title": assignment.title, "instructions": assignment.instructions, "kind": assignment.kind, "config": assignment.config or {}, "due_at": assignment.due_at.isoformat() if assignment.due_at else None, "submission": {"status": submission.status, "score": submission.score}} for submission, assignment in rows]}


@router.post("/me/assignments/{assignment_id}/start")
def start_assignment(assignment_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    assignment = db.get(Assignment, assignment_id)
    submission = db.scalar(select(AssignmentSubmission).where(AssignmentSubmission.assignment_id == assignment_id, AssignmentSubmission.student_id == student.id))
    if assignment is None or submission is None or assignment.status != "published":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assignment not found.")
    if submission.status == "not_started":
        submission.status, submission.started_at = "in_progress", utcnow()
    db.commit()
    return {"assignment": {"id": assignment.id, "kind": assignment.kind, "resource_id": assignment.resource_id, "course_id": assignment.course_id, "config": assignment.config or {}}, "submission": {"status": submission.status, "started_at": submission.started_at.isoformat() if submission.started_at else None}}


@router.post("/me/assignments/{assignment_id}/submit")
def submit_assignment(assignment_id: int, payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    submission = db.scalar(select(AssignmentSubmission).where(AssignmentSubmission.assignment_id == assignment_id, AssignmentSubmission.student_id == student.id))
    if submission is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assignment not found.")
    submission.status = "submitted"; submission.score = max(0.0, min(100.0, float(payload.get("score") or 0)))
    submission.result = dict(payload.get("result") or {}); submission.submitted_at = utcnow(); db.commit()
    return {"ok": True, "status": submission.status, "score": submission.score}


@router.get("/{organization_id}/subscription")
def subscription(organization_id: int, db: Session = Depends(get_db), admin: Admin = Depends(require_institution_staff)) -> dict:
    _org_access(db, admin, organization_id)
    row = db.scalar(select(SubscriptionAccount).where(SubscriptionAccount.owner_type == "organization", SubscriptionAccount.owner_id == organization_id))
    return {"plan": row.plan if row else "free", "status": row.status if row else "active", "seats": row.seats if row else 1, "entitlements": row.entitlements if row else {}}


# ---------------------------------------------------------------- concepts
@router.get("/courses/{course_id}/concepts")
def concepts(course_id: int, db: Session = Depends(get_db), admin: Admin = Depends(require_institution_staff)) -> dict:
    rows = db.scalars(select(LearningConcept).where(LearningConcept.course_id == course_id).order_by(LearningConcept.topic, LearningConcept.position)).all()
    edges = db.scalars(select(ConceptPrerequisite).where(ConceptPrerequisite.concept_id.in_([row.id for row in rows]))).all() if rows else []
    return {"concepts": [{"id": row.id, "course_id": row.course_id, "topic": row.topic, "key": row.key, "title": row.title, "description": row.description, "objective": row.objective, "position": row.position, "active": row.active} for row in rows], "prerequisites": [{"id": edge.id, "concept_id": edge.concept_id, "prerequisite_id": edge.prerequisite_id, "strength": edge.strength} for edge in edges]}


@router.post("/courses/{course_id}/concepts")
def create_concept(course_id: int, payload: dict, db: Session = Depends(get_db), admin: Admin = Depends(require_institution_staff)) -> dict:
    if db.get(Course, course_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found.")
    title = str(payload.get("title") or "").strip()[:180]
    key = _slug(str(payload.get("key") or title)).replace("-", "_")
    if not title or not key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Concept title is required.")
    row = LearningConcept(course_id=course_id, topic=str(payload.get("topic") or "")[:120], key=key, title=title, description=str(payload.get("description") or "")[:600], objective=str(payload.get("objective") or "")[:300], position=int(payload.get("position") or 0))
    db.add(row); db.commit()
    return {"id": row.id, "key": row.key, "title": row.title}


@router.post("/concepts/{concept_id}/prerequisites")
def add_prerequisite(concept_id: int, payload: dict, db: Session = Depends(get_db), admin: Admin = Depends(require_institution_staff)) -> dict:
    prerequisite_id = int(payload.get("prerequisite_id") or 0)
    concept, prerequisite = db.get(LearningConcept, concept_id), db.get(LearningConcept, prerequisite_id)
    if concept is None or prerequisite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Concept not found.")
    if concept.id == prerequisite.id or concept.course_id != prerequisite.course_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Prerequisites must be different concepts in the same course.")
    row = db.scalar(select(ConceptPrerequisite).where(ConceptPrerequisite.concept_id == concept_id, ConceptPrerequisite.prerequisite_id == prerequisite_id))
    if row is None:
        row = ConceptPrerequisite(concept_id=concept_id, prerequisite_id=prerequisite_id); db.add(row)
    row.strength = max(0.1, min(1.0, float(payload.get("strength") or 1.0))); db.commit()
    return {"id": row.id, "concept_id": concept_id, "prerequisite_id": prerequisite_id, "strength": row.strength}


# ------------------------------------------------------ adaptive sessions
PLAN_ENTITLEMENTS = {
    "free": {"adaptive_sessions": 3, "ai_daily": 5, "material_uploads": 1, "deep_analytics": False},
    "pro": {"adaptive_sessions": -1, "ai_daily": 50, "material_uploads": 30, "deep_analytics": True},
    "teacher": {"classes": 10, "students": 500, "teacher_ai": True, "question_generation": True},
    "school": {"classes": -1, "students": 5000, "teacher_ai": True, "school_intelligence": True, "reports": True},
    "enterprise": {"classes": -1, "students": -1, "teacher_ai": True, "school_intelligence": True, "reports": True, "sso": True},
}


@learning_router.get("/entitlements")
def my_entitlements(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    row = db.scalar(select(SubscriptionAccount).where(SubscriptionAccount.owner_type == "student", SubscriptionAccount.owner_id == student.id))
    plan = row.plan if row and row.status == "active" else "free"
    values = {**PLAN_ENTITLEMENTS.get(plan, PLAN_ENTITLEMENTS["free"]), **(row.entitlements if row else {})}
    return {"plan": plan, "status": row.status if row else "active", "entitlements": values, "period_end": row.current_period_end.isoformat() if row and row.current_period_end else None}


@learning_router.get("/sessions/current")
def current_session(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    row = db.scalar(select(AdaptiveLearningSession).where(AdaptiveLearningSession.student_id == student.id, AdaptiveLearningSession.status == "active").order_by(AdaptiveLearningSession.id.desc()))
    return {"session": _session_public(row) if row else None}


def _session_public(row: AdaptiveLearningSession) -> dict:
    return {"id": row.id, "topic": row.topic, "course_id": row.course_id, "kind": row.kind, "status": row.status, "stage": row.stage, "stage_index": row.stage_index, "plan": row.plan or {}, "evidence": row.evidence or {}, "starting_mastery": row.starting_mastery, "ending_mastery": row.ending_mastery, "practice_token": row.practice_token, "started_at": row.started_at.isoformat(), "updated_at": row.updated_at.isoformat()}


@learning_router.post("/sessions")
def start_session(payload: dict | None = None, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = learning_intelligence.build_profile(db, student)
    topic = str((payload or {}).get("topic") or profile.get("next_action", {}).get("topic") or "")[:120]
    source = next((row for row in profile.get("topics", []) if str(row.get("topic", "")).lower() == topic.lower()), None)
    if not source:
        source = {"mastery": 0, "course_id": (payload or {}).get("course_id"), "recommended_session": profile.get("next_action", {}).get("session") or {"steps": [], "duration_minutes": 10, "question_count": 10}}
    previous = db.scalars(select(AdaptiveLearningSession).where(AdaptiveLearningSession.student_id == student.id, AdaptiveLearningSession.status == "active")).all()
    for row in previous: row.status, row.updated_at = "abandoned", utcnow()
    plan = dict(source.get("recommended_session") or {})
    steps = plan.get("steps") or [{"kind": "diagnostic", "label": "Adaptive diagnostic", "minutes": 10}]
    row = AdaptiveLearningSession(student_id=student.id, course_id=int(source.get("course_id") or 0) or None, topic=topic, kind="weakness" if topic else "diagnostic", stage=str(steps[0].get("kind") or "concept_review"), plan={**plan, "steps": steps}, starting_mastery=float(source.get("mastery") or 0))
    db.add(row); db.commit()
    return {"session": _session_public(row)}


@learning_router.patch("/sessions/{session_id}")
def advance_session(session_id: int, payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    row = db.get(AdaptiveLearningSession, session_id)
    if row is None or row.student_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Learning session not found.")
    steps = list((row.plan or {}).get("steps") or [])
    action = str(payload.get("action") or "advance")
    evidence = dict(row.evidence or {})
    if payload.get("evidence"):
        evidence.update(dict(payload["evidence"])); row.evidence = evidence
    if payload.get("practice_token"): row.practice_token = str(payload["practice_token"])[:80]
    if action == "abandon": row.status = "abandoned"
    elif action == "complete" or row.stage_index + 1 >= len(steps):
        profile = learning_intelligence.build_profile(db, student)
        current = next((item for item in profile.get("topics", []) if str(item.get("topic", "")).lower() == row.topic.lower()), None)
        row.ending_mastery = float((current or {}).get("mastery") or row.starting_mastery); row.status = "completed"; row.completed_at = utcnow()
    else:
        row.stage_index += 1; row.stage = str(steps[row.stage_index].get("kind") or "practice")
    row.updated_at = utcnow(); db.commit()
    return {"session": _session_public(row)}


@learning_router.get("/mastery/history")
def mastery_history(scope_type: str = "topic", scope_key: str = "", days: int = Query(90, ge=7, le=730), db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    from datetime import timedelta
    stmt = select(MasterySnapshot).where(MasterySnapshot.student_id == student.id, MasterySnapshot.scope_type == scope_type, MasterySnapshot.recorded_at >= utcnow() - timedelta(days=days)).order_by(MasterySnapshot.recorded_at)
    if scope_key: stmt = stmt.where(func.lower(MasterySnapshot.scope_key) == scope_key.lower())
    rows = db.scalars(stmt).all()
    return {"scope_type": scope_type, "scope_key": scope_key or None, "history": [{"key": row.scope_key, "mastery": row.mastery, "confidence": row.confidence, "answered": row.answered, "correct": row.correct, "source": row.source, "at": row.recorded_at.isoformat()} for row in rows]}
