"""Teacher Network — shared rules for the student, teacher and staff APIs.

Everything that decides *who may do what* lives here so the three routers
can't drift apart:

* teachers are player accounts with an approved :class:`TeacherProfile`;
* a :class:`TeacherStudent` relationship (or a pending request) is the gate
  for messaging, sharing and private notes;
* reviews need a completed relationship, one per relationship;
* blocks override everything;
* reputation is reported as separate, understandable numbers and badges —
  never as one opaque score.
"""
from __future__ import annotations

import re
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..events import Event, to_student
from ..models import (
    ContentReport,
    InboxNote,
    Student,
    StudyGroup,
    StudyGroupMember,
    TeacherFile,
    TeacherMaterial,
    TeacherProfile,
    TeacherQualification,
    TeacherQuiz,
    TeacherQuizAttempt,
    TeacherRequest,
    TeacherReview,
    TeacherShare,
    TeacherSpecialty,
    TeacherStudent,
    UserBlock,
    utcnow,
)

# ---------------------------------------------------------------------------
# Subject catalogue — teachers pick specific topics, not just a subject
# ---------------------------------------------------------------------------
SUBJECTS: dict[str, list[str]] = {
    "Mathematics": ["Algebra", "Calculus", "Geometry", "Trigonometry", "Statistics", "Probability", "Linear Algebra", "Differential Equations", "Number Theory"],
    "Physics": ["Mechanics", "Electromagnetism", "Waves and Optics", "Thermodynamics", "Modern Physics", "Electricity", "Nuclear Physics"],
    "Chemistry": ["Organic Chemistry", "Inorganic Chemistry", "Physical Chemistry", "Stoichiometry", "Chemical Bonding", "Electrochemistry", "Analytical Chemistry"],
    "Biology": ["Cell Biology", "Genetics", "Ecology", "Human Physiology", "Evolution", "Microbiology", "Botany", "Zoology"],
    "English": ["Grammar", "Essay Writing", "Comprehension", "Literature", "Oral English", "Vocabulary"],
    "Law": ["Constitutional Law", "Criminal Law", "Contract Law", "Law of Torts", "Jurisprudence", "Land Law", "Equity and Trusts", "Evidence", "Commercial Law", "Legal Research"],
    "Economics": ["Microeconomics", "Macroeconomics", "Development Economics", "Econometrics", "Public Finance"],
    "Computer Science": ["Programming", "Data Structures", "Algorithms", "Databases", "Web Development", "Computer Networks"],
    "Accounting": ["Financial Accounting", "Cost Accounting", "Management Accounting", "Auditing", "Taxation"],
    "Government": ["Political Theory", "Nigerian Government", "International Relations", "Public Administration"],
}

LANGUAGES = ["English", "Pidgin", "Igbo", "Yoruba", "Hausa", "French"]
FORMATS = {"one", "group", "both"}
REQUEST_FORMATS = {"one", "group", "either"}
VISIBILITIES = {"private", "students", "group", "public"}
QUESTION_KINDS = {"mcq", "tf", "short", "numeric"}
DIFFICULTIES = {"easy", "medium", "hard"}
REQUEST_TTL = timedelta(days=14)
REVIEW_EDIT_WINDOW = timedelta(days=7)
TEACHER_REPORT_KINDS = {
    "teacher",
    "teacher_student",
    "teacher_group",
    "teacher_material",
    "teacher_quiz",
    "teacher_review",
    "chat_message",
}

# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def first_name(student: Student | None) -> str:
    return (student.name or "").split(" ")[0] if student else ""


def short_name(student: Student | None) -> str:
    """"David O." — a teacher's public display name never shows a full surname."""
    if not student:
        return ""
    parts = [p for p in (student.name or "").split(" ") if p]
    if len(parts) < 2:
        return parts[0] if parts else ""
    return f"{parts[0]} {parts[-1][0]}."


def person_chip(student: Student | None) -> dict[str, Any]:
    """Public identity only — never phone numbers or contact details."""
    if student is None:
        return {"id": None, "name": "Former member", "username": "", "avatar_hue": 260, "has_photo": False}
    return {
        "id": student.id,
        "name": student.name,
        "username": student.username or "",
        "avatar_hue": student.avatar_hue,
        "has_photo": bool(student.photo),
        "last_active": iso(datetime.combine(student.last_active, datetime.min.time())) if student.last_active else None,
    }


def clean(text: str | None, limit: int) -> str:
    return re.sub(r"[ \t]+", " ", (text or "").strip())[:limit]


class RateLimiter:
    """In-memory sliding window, per key. Good enough for one API process."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str, limit: int, window_seconds: int, message: str) -> None:
        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] > window_seconds:
            hits.popleft()
        if len(hits) >= limit:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, message)
        hits.append(now)


limiter = RateLimiter()

# ---------------------------------------------------------------------------
# Identity, permissions and blocks
# ---------------------------------------------------------------------------


def profile_for(db: Session, student_id: int) -> TeacherProfile | None:
    return db.scalar(select(TeacherProfile).where(TeacherProfile.student_id == student_id))


def is_live(profile: TeacherProfile | None) -> bool:
    return bool(profile and profile.status == "approved")


def require_teacher(db: Session, student: Student) -> TeacherProfile:
    """An approved, non-suspended teacher. Everything in the studio goes through this."""
    profile = profile_for(db, student.id)
    if profile is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Apply to become a teacher first.")
    if profile.status == "suspended":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your teacher account is suspended. Contact support for details.")
    if profile.status != "approved":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your teacher application has not been approved yet.")
    return profile


def live_teacher_or_404(db: Session, teacher_id: int) -> TeacherProfile:
    profile = db.get(TeacherProfile, teacher_id)
    if not is_live(profile):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Teacher not found.")
    return profile  # type: ignore[return-value]


def is_blocked(db: Session, a: int, b: int) -> bool:
    return (
        db.scalar(
            select(UserBlock.id).where(
                or_(
                    (UserBlock.blocker_id == a) & (UserBlock.blocked_id == b),
                    (UserBlock.blocker_id == b) & (UserBlock.blocked_id == a),
                )
            )
        )
        is not None
    )


def relationship_between(db: Session, teacher_id: int, student_id: int) -> TeacherStudent | None:
    return db.scalar(
        select(TeacherStudent).where(TeacherStudent.teacher_id == teacher_id, TeacherStudent.student_id == student_id)
    )


def teaching_link(db: Session, me: int, other: int) -> str | None:
    """How two players are connected through teaching, if at all.

    Returns ``"relationship"`` (active or completed), ``"request"`` (a pending
    request either way) or ``None``.
    """
    profiles = {row.student_id: row for row in db.scalars(select(TeacherProfile).where(TeacherProfile.student_id.in_([me, other]))).all()}
    for teacher_student_id, learner_id in ((me, other), (other, me)):
        profile = profiles.get(teacher_student_id)
        if profile is None:
            continue
        rel = relationship_between(db, profile.id, learner_id)
        if rel is not None and rel.status in {"active", "completed"}:
            return "relationship"
        pending = db.scalar(
            select(TeacherRequest.id).where(
                TeacherRequest.teacher_id == profile.id,
                TeacherRequest.student_id == learner_id,
                TeacherRequest.status == "pending",
            )
        )
        if pending:
            return "request"
    return None


# ---------------------------------------------------------------------------
# Requests housekeeping
# ---------------------------------------------------------------------------


def expire_requests(db: Session) -> int:
    cutoff = utcnow() - REQUEST_TTL
    rows = db.scalars(
        select(TeacherRequest).where(TeacherRequest.status == "pending", TeacherRequest.created_at < cutoff)
    ).all()
    for row in rows:
        row.status = "expired"
    if rows:
        db.flush()
    return len(rows)


# ---------------------------------------------------------------------------
# Notifications (personal inbox + live push)
# ---------------------------------------------------------------------------


def notify(db: Session, student_id: int, title: str, message: str, meta: dict | None = None) -> Event:
    import json

    note = InboxNote(
        student_id=student_id,
        kind="teacher",
        title=title[:180],
        message=message[:600],
        meta=json.dumps(meta or {}, default=str),
    )
    db.add(note)
    db.flush()
    return to_student(
        student_id,
        "notify",
        {
            "id": note.id,
            "kind": note.kind,
            "title": note.title,
            "message": note.message,
            "meta": meta or {},
            "read": False,
            "created_at": iso(note.created_at),
        },
    )


# ---------------------------------------------------------------------------
# Reputation — separate, explainable numbers
# ---------------------------------------------------------------------------


def stats_for(db: Session, teacher_ids: Iterable[int], *, include_reports: bool = False) -> dict[int, dict[str, Any]]:
    ids = list({int(i) for i in teacher_ids})
    out: dict[int, dict[str, Any]] = {
        i: {
            "rating": 0.0,
            "review_count": 0,
            "students_taught": 0,
            "active_students": 0,
            "completed_relationships": 0,
            "response_rate": None,
            "response_hours": None,
            "retention": None,
            "groups": 0,
            "group_members": 0,
            "materials": 0,
            "quizzes": 0,
            "quiz_attempts": 0,
        }
        for i in ids
    }
    if not ids:
        return out

    for tid, avg, count in db.execute(
        select(TeacherReview.teacher_id, func.avg(TeacherReview.rating), func.count(TeacherReview.id))
        .where(TeacherReview.teacher_id.in_(ids), TeacherReview.status == "visible")
        .group_by(TeacherReview.teacher_id)
    ).all():
        out[tid]["rating"] = round(float(avg or 0), 1)
        out[tid]["review_count"] = int(count)

    now = utcnow()
    rels = db.scalars(select(TeacherStudent).where(TeacherStudent.teacher_id.in_(ids))).all()
    retained: dict[int, list[int]] = defaultdict(lambda: [0, 0])
    for rel in rels:
        row = out[rel.teacher_id]
        row["students_taught"] += 1
        if rel.status == "active":
            row["active_students"] += 1
        if rel.status == "completed":
            row["completed_relationships"] += 1
        # Retention: of relationships at least two weeks old, how many lasted
        # two weeks or were completed (rather than ended early).
        if now - rel.started_at >= timedelta(days=14):
            retained[rel.teacher_id][1] += 1
            lasted = (rel.ended_at or now) - rel.started_at >= timedelta(days=14)
            if rel.status == "completed" or lasted:
                retained[rel.teacher_id][0] += 1
    for tid, (kept, total) in retained.items():
        if total:
            out[tid]["retention"] = round(kept * 100 / total)

    requests = db.scalars(select(TeacherRequest).where(TeacherRequest.teacher_id.in_(ids))).all()
    answered: dict[int, list[float]] = defaultdict(list)
    due: dict[int, int] = defaultdict(int)
    for req in requests:
        if req.status in {"accepted", "declined", "completed"} and req.responded_at:
            answered[req.teacher_id].append((req.responded_at - req.created_at).total_seconds() / 3600)
            due[req.teacher_id] += 1
        elif req.status == "expired" or (req.status == "pending" and now - req.created_at > timedelta(hours=48)):
            due[req.teacher_id] += 1
    for tid in ids:
        if due[tid]:
            out[tid]["response_rate"] = round(len(answered[tid]) * 100 / due[tid])
        if answered[tid]:
            hours = sorted(answered[tid])
            out[tid]["response_hours"] = round(hours[len(hours) // 2], 1)

    for tid, count in db.execute(
        select(StudyGroup.teacher_id, func.count(StudyGroup.id)).where(StudyGroup.teacher_id.in_(ids)).group_by(StudyGroup.teacher_id)
    ).all():
        out[tid]["groups"] = int(count)
    for tid, count in db.execute(
        select(StudyGroup.teacher_id, func.count(StudyGroupMember.id))
        .join(StudyGroupMember, StudyGroupMember.group_id == StudyGroup.id)
        .where(StudyGroup.teacher_id.in_(ids), StudyGroupMember.role != "owner")
        .group_by(StudyGroup.teacher_id)
    ).all():
        out[tid]["group_members"] = int(count)
    for tid, count in db.execute(
        select(TeacherMaterial.teacher_id, func.count(TeacherMaterial.id))
        .where(TeacherMaterial.teacher_id.in_(ids), TeacherMaterial.status == "active")
        .group_by(TeacherMaterial.teacher_id)
    ).all():
        out[tid]["materials"] = int(count)
    for tid, count in db.execute(
        select(TeacherQuiz.teacher_id, func.count(TeacherQuiz.id))
        .where(TeacherQuiz.teacher_id.in_(ids), TeacherQuiz.status == "published")
        .group_by(TeacherQuiz.teacher_id)
    ).all():
        out[tid]["quizzes"] = int(count)
    for tid, count in db.execute(
        select(TeacherQuiz.teacher_id, func.count(TeacherQuizAttempt.id))
        .join(TeacherQuizAttempt, TeacherQuizAttempt.quiz_id == TeacherQuiz.id)
        .where(TeacherQuiz.teacher_id.in_(ids), TeacherQuizAttempt.status == "submitted")
        .group_by(TeacherQuiz.teacher_id)
    ).all():
        out[tid]["quiz_attempts"] = int(count)

    if include_reports:
        for tid in ids:
            out[tid]["open_reports"] = 0
        for tid, count in db.execute(
            select(ContentReport.target_id, func.count(ContentReport.id))
            .where(ContentReport.kind == "teacher", ContentReport.target_id.in_(ids), ContentReport.status == "open")
            .group_by(ContentReport.target_id)
        ).all():
            out[int(tid)]["open_reports"] = int(count)
    return out


def badges_for(profile: TeacherProfile, stats: dict[str, Any]) -> list[dict[str, str]]:
    """Plain-language badges, each with the reason it was earned."""
    badges: list[dict[str, str]] = []
    if profile.verified:
        badges.append({"key": "verified", "label": "Verified teacher", "reason": "Identity and qualifications checked by Genesis staff."})
    if stats.get("review_count", 0) >= 5 and stats.get("rating", 0) >= 4.7:
        badges.append({"key": "top_rated", "label": "Top rated", "reason": f"{stats['rating']} average from {stats['review_count']} reviews."})
    if (stats.get("response_rate") or 0) >= 90 and (stats.get("response_hours") or 99) <= 24:
        badges.append({"key": "fast", "label": "Quick to respond", "reason": f"Answers {stats['response_rate']}% of requests, usually within a day."})
    if profile.experience_years >= 5:
        badges.append({"key": "experienced", "label": f"{profile.experience_years}+ years teaching", "reason": "Self-reported teaching experience."})
    if stats.get("group_members", 0) >= 10:
        badges.append({"key": "community", "label": "Community builder", "reason": f"{stats['group_members']} students across their study groups."})
    if (stats.get("retention") or 0) >= 80 and stats.get("students_taught", 0) >= 5:
        badges.append({"key": "retention", "label": "Students stay", "reason": f"{stats['retention']}% of students continue past two weeks."})
    if profile.approved_at and utcnow() - profile.approved_at < timedelta(days=30):
        badges.append({"key": "new", "label": "New on Genesis", "reason": "Joined the teacher network this month."})
    return badges


def specialties_grouped(rows: Iterable[TeacherSpecialty]) -> list[dict[str, Any]]:
    grouped: dict[str, list[str]] = {}
    for row in rows:
        topics = grouped.setdefault(row.subject, [])
        if row.topic and row.topic not in topics:
            topics.append(row.topic)
    return [{"subject": subject, "topics": topics} for subject, topics in grouped.items()]


def teacher_card(db: Session, profile: TeacherProfile, stats: dict[str, Any], specialties: list[TeacherSpecialty]) -> dict[str, Any]:
    student = profile.student
    return {
        "id": profile.id,
        "student_id": profile.student_id,
        "name": short_name(student),
        "full_name": student.name if student else "",
        "avatar_hue": student.avatar_hue if student else 260,
        "has_photo": bool(student and student.photo),
        "headline": profile.headline,
        "bio": profile.bio[:220],
        "verified": profile.verified,
        "experience_years": profile.experience_years,
        "institution": profile.institution,
        "languages": profile.languages or [],
        "formats": profile.formats,
        "accepting": profile.accepting,
        "availability_now": availability_now(profile),
        "specialties": specialties_grouped(specialties),
        "stats": {k: v for k, v in stats.items() if k != "open_reports"},
        "badges": badges_for(profile, stats),
    }


def availability_now(profile: TeacherProfile) -> str:
    """"available" | "busy" | "unavailable" from the weekly slots (server time)."""
    if not profile.accepting:
        return "unavailable"
    slots = profile.availability or []
    if not slots:
        return "busy"
    now = datetime.now()
    hhmm = now.strftime("%H:%M")
    for slot in slots:
        try:
            if int(slot.get("day", -1)) == now.weekday() and str(slot.get("start", "")) <= hhmm < str(slot.get("end", "")):
                return "available"
        except (TypeError, ValueError):
            continue
    return "busy"


# ---------------------------------------------------------------------------
# Files — validated uploads, checked downloads
# ---------------------------------------------------------------------------
FILE_ROOT = Path(__file__).resolve().parents[2] / "data" / "teacher_files"
MAX_FILE_BYTES = 15 * 1024 * 1024
ALLOWED_TYPES: dict[str, str] = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def _signature_ok(ext: str, head: bytes) -> bool:
    if ext == ".pdf":
        return head.startswith(b"%PDF")
    if ext in {".docx", ".pptx"}:
        return head.startswith(b"PK\x03\x04")
    if ext in {".doc", ".ppt"}:
        return head.startswith(b"\xd0\xcf\x11\xe0")
    if ext == ".png":
        return head.startswith(b"\x89PNG")
    if ext in {".jpg", ".jpeg"}:
        return head.startswith(b"\xff\xd8\xff")
    if ext == ".gif":
        return head.startswith(b"GIF8")
    if ext == ".webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    if ext in {".txt", ".md"}:
        return b"\x00" not in head
    return False


async def save_upload(db: Session, upload: UploadFile, owner: Student, purpose: str) -> TeacherFile:
    name = Path(upload.filename or "file").name[:180] or "file"
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Upload a PDF, Word, PowerPoint, text or image file.")
    data = await upload.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Files can be at most 15 MB.")
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That file is empty.")
    if not _signature_ok(ext, data[:16]):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "The file's contents don't match its type.")
    limiter.check(f"upload:{owner.id}", 30, 3600, "Too many uploads in the last hour. Try again later.")
    FILE_ROOT.mkdir(parents=True, exist_ok=True)
    disk_name = f"{uuid.uuid4().hex}{ext}"
    (FILE_ROOT / disk_name).write_bytes(data)
    row = TeacherFile(owner_id=owner.id, purpose=purpose, name=name, mime=ALLOWED_TYPES[ext], size=len(data), path=disk_name)
    db.add(row)
    db.flush()
    return row


def file_public(row: TeacherFile | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {"id": row.id, "name": row.name, "mime": row.mime, "size": row.size, "is_image": row.mime.startswith("image/")}


def file_path(row: TeacherFile) -> Path:
    path = (FILE_ROOT / row.path).resolve()
    if FILE_ROOT.resolve() not in path.parents:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found.")
    return path


# ---------------------------------------------------------------------------
# Content access — materials and quizzes
# ---------------------------------------------------------------------------


def _shared(db: Session, kind: str, item_id: int, student_id: int) -> bool:
    return (
        db.scalar(
            select(TeacherShare.id).where(TeacherShare.kind == kind, TeacherShare.item_id == item_id, TeacherShare.student_id == student_id)
        )
        is not None
    )


def _visible(db: Session, *, kind: str, item_id: int, teacher_id: int, visibility: str, group_id: int | None, viewer: Student) -> bool:
    profile = db.get(TeacherProfile, teacher_id)
    if profile is None:
        return False
    if profile.student_id == viewer.id:
        return True
    if profile.status != "approved" or is_blocked(db, profile.student_id, viewer.id):
        return False
    if _shared(db, kind, item_id, viewer.id):
        return True
    if visibility == "public":
        return True
    if visibility == "students":
        rel = relationship_between(db, teacher_id, viewer.id)
        return rel is not None and rel.status in {"active", "completed"}
    if visibility == "group" and group_id:
        return db.scalar(
            select(StudyGroupMember.id).where(StudyGroupMember.group_id == group_id, StudyGroupMember.student_id == viewer.id)
        ) is not None
    return False


def can_view_material(db: Session, material: TeacherMaterial, viewer: Student) -> bool:
    if material.status != "active":
        return False
    return _visible(db, kind="material", item_id=material.id, teacher_id=material.teacher_id, visibility=material.visibility, group_id=material.group_id, viewer=viewer)


def can_view_quiz(db: Session, quiz: TeacherQuiz, viewer: Student) -> bool:
    profile = db.get(TeacherProfile, quiz.teacher_id)
    if profile and profile.student_id == viewer.id:
        return quiz.status != "removed"
    if quiz.status != "published":
        return False
    return _visible(db, kind="quiz", item_id=quiz.id, teacher_id=quiz.teacher_id, visibility=quiz.visibility, group_id=quiz.group_id, viewer=viewer)


def can_download_file(db: Session, row: TeacherFile, viewer: Student) -> bool:
    if row.owner_id == viewer.id:
        return True
    if row.purpose == "qualification":
        return False  # owner and staff only
    if row.purpose == "chat":
        return _shared(db, "file", row.id, viewer.id) and not is_blocked(db, row.owner_id, viewer.id)
    materials = db.scalars(select(TeacherMaterial).where(TeacherMaterial.file_id == row.id)).all()
    return any(can_view_material(db, m, viewer) for m in materials)


# ---------------------------------------------------------------------------
# Quiz grading
# ---------------------------------------------------------------------------


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s.\-]", "", (text or "").lower())).strip()


def grade_answer(kind: str, answer_key: str, tolerance: float, given: Any) -> bool:
    if given is None or str(given).strip() == "":
        return False
    value = str(given).strip()
    if kind == "mcq":
        return value.upper() == (answer_key or "").strip().upper()
    if kind == "tf":
        return value.lower() in {"true", "false"} and value.lower() == (answer_key or "").strip().lower()
    if kind == "numeric":
        try:
            return abs(float(value.replace(",", "")) - float(answer_key)) <= max(0.0, float(tolerance or 0))
        except ValueError:
            return False
    accepted = [_norm(a) for a in (answer_key or "").split("|") if a.strip()]
    return _norm(value) in accepted


# ---------------------------------------------------------------------------
# Spam heuristics for reviews and requests
# ---------------------------------------------------------------------------
_LINK = re.compile(r"(https?://|www\.)", re.I)


def looks_like_spam(text: str) -> str | None:
    body = (text or "").strip()
    if len(_LINK.findall(body)) > 1:
        return "Please don't include links."
    if re.search(r"(.)\1{9,}", body):
        return "That looks like repeated characters."
    letters = [c for c in body if c.isalpha()]
    if len(letters) > 20 and sum(1 for c in letters if c.isupper()) / len(letters) > 0.8:
        return "Please don't write in all capitals."
    return None
