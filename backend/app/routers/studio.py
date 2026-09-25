"""Staff content studio — question bank, workflows, blueprints and builders.

Everything here is additive: the original ``/api/admin`` routes keep working
exactly as before, and these routes hang off the same prefix so the existing
admin authentication guards both.
"""
from __future__ import annotations

import random
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_admin
from ..models import (
    Admin,
    AuditLog,
    Course,
    ExamBlueprint,
    Question,
    QuestionFlag,
    QuestionVersion,
    Quiz,
    Student,
    utcnow,
)
from ..schemas import (
    BlueprintGenerateIn,
    BlueprintIn,
    QuestionBulkActionIn,
    QuestionFlagIn,
    QuestionImportIn,
    QuestionOrderIn,
    QuestionPatchIn,
    QuizBuilderIn,
    QuizDuplicateIn,
    QuizIn,
)
from ..services.uploads import UploadError, read_upload
from ..services.questions import (
    AnswerValidationError,
    apply_question_fields,
    audit,
    bank_health,
    clear_flag,
    duplicate_question,
    ensure_course_bank_quiz,
    export_questions,
    flag_question,
    import_payload,
    parse_question_blocks,
    question_admin_public,
    question_analytics,
    question_query,
    record_version,
    validate_payload,
    validate_saved_question,
)
from ..serializers import iso, quiz_public

router = APIRouter(prefix="/admin", tags=["studio"], dependencies=[Depends(require_admin)])

EXPORTABLE = (
    "text",
    "option_a",
    "option_b",
    "option_c",
    "option_d",
    "correct",
    "explanation",
    "points",
    "difficulty",
    "question_type",
    "topic",
    "subtopic",
    "tags",
    "source",
    "reference",
    "status",
)


def _question_or_404(db: Session, question_id: int) -> Question:
    question = db.get(Question, question_id)
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found.")
    return question


# ---------------------------------------------------------------------------
# Question bank dashboard
# ---------------------------------------------------------------------------
@router.get("/bank")
def bank_dashboard(
    db: Session = Depends(get_db),
    course_id: int | None = Query(None),
    quiz_id: int | None = Query(None),
) -> dict:
    """Question-bank dashboard: counters, health warnings and quick stats."""
    result = question_query(db, course_id=course_id, quiz_id=quiz_id, limit=1)
    health = bank_health(db, course_id)
    courses = db.scalars(select(Course).order_by(Course.code)).all()
    quizzes = db.scalars(select(Quiz).where(Quiz.is_bank.is_(False)).order_by(Quiz.id.desc()).limit(60)).all()
    return {
        "total": result["total"],
        "facets": result["facets"],
        "health": health,
        "courses": [{"id": c.id, "code": c.code, "title": c.title} for c in courses],
        "quizzes": [{"id": q.id, "title": q.title, "status": q.status, "questions": len(q.questions)} for q in quizzes],
    }


@router.get("/questions")
def search_questions(
    db: Session = Depends(get_db),
    q: str = Query("", max_length=120),
    course_id: int | None = Query(None),
    quiz_id: int | None = Query(None),
    topic: str = Query(""),
    subtopic: str = Query(""),
    difficulty: str = Query(""),
    status_filter: str = Query("", alias="status"),
    answer: str = Query(""),
    tag: str = Query(""),
    question_type: str = Query(""),
    flagged: bool | None = Query(None),
    drawn: bool | None = Query(None),
    min_usage: int | None = Query(None),
    max_success: float | None = Query(None),
    sort: str = Query("position"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    """Instant search + filters + sort over the whole bank (paginated)."""
    result = question_query(
        db,
        q=q,
        course_id=course_id,
        quiz_id=quiz_id,
        topic=topic,
        subtopic=subtopic,
        difficulty=difficulty,
        status=status_filter,
        answer=answer,
        tag=tag,
        question_type=question_type,
        flagged=flagged,
        drawn=drawn,
        min_usage=min_usage,
        max_success=max_success,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    return {
        "total": result["total"],
        "limit": limit,
        "offset": offset,
        "facets": result["facets"],
        "rows": [question_admin_public(row) for row in result["questions"]],
    }


@router.post("/questions/bulk")
def bulk_action(
    payload: QuestionBulkActionIn,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    """Bulk edit / delete / archive / tag / re-target — one transaction."""
    rows = list(db.scalars(select(Question).where(Question.id.in_(payload.ids))).all())
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No matching questions.")
    touched: list[int] = []
    errors: list[dict] = []

    def _apply(question: Question, data: dict[str, Any], note: str) -> None:
        try:
            apply_question_fields(db, question, data, author=admin.email, note=note)
            validate_saved_question(question)
            touched.append(question.id)
        except (AnswerValidationError, ValueError) as error:
            errors.append({"id": question.id, "reason": getattr(error, "message", str(error))})

    for question in rows:
        if payload.action == "delete":
            db.delete(question)
            touched.append(question.id)
        elif payload.action == "archive":
            _apply(question, {"status": "archived"}, "Bulk archived")
        elif payload.action == "publish":
            _apply(question, {"status": "approved", "visible": True}, "Bulk published")
        elif payload.action == "draft":
            _apply(question, {"status": "draft"}, "Bulk moved to draft")
        elif payload.action == "status" and payload.status:
            _apply(question, {"status": payload.status}, "Bulk status")
        elif payload.action == "flag":
            question.flag_reason = (payload.value or "flagged")[:240]
            question.flagged_by = admin.email
            question.flagged_at = utcnow()
            touched.append(question.id)
        elif payload.action == "unflag":
            clear_flag(db, question, actor=admin.email)
            touched.append(question.id)
        elif payload.action == "tag":
            tags = list(question.tags or [])
            for tag in payload.tags:
                if tag and tag not in tags:
                    tags.append(tag)
            _apply(question, {"tags": tags}, "Bulk tagged")
        elif payload.action == "untag":
            drop = {tag.lower() for tag in payload.tags}
            _apply(question, {"tags": [tag for tag in (question.tags or []) if tag.lower() not in drop]}, "Bulk untagged")
        elif payload.action == "difficulty":
            _apply(question, {"difficulty": payload.difficulty or payload.value}, "Bulk difficulty")
        elif payload.action == "points":
            _apply(question, {"points": payload.points if payload.points is not None else int(payload.value or 1)}, "Bulk points")
        elif payload.action == "answer":
            _apply(question, {"correct": payload.correct or payload.value}, "Bulk answer")
        elif payload.action == "topic":
            _apply(question, {"topic": payload.topic or payload.value}, "Bulk topic")
        elif payload.action == "move":
            if not payload.quiz_id:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a target exam to move questions into.")
            quiz = db.get(Quiz, payload.quiz_id)
            if quiz is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Target exam not found.")
            _apply(question, {"quiz_id": quiz.id, "course_id": quiz.course_id, "position": None}, "Bulk moved")
        elif payload.action == "duplicate":
            clone = duplicate_question(db, question, target_quiz_id=payload.quiz_id, author=admin.email)
            touched.append(clone.id)
        elif payload.action == "toggle_mode":
            field = {"flashcard": "flashcard_enabled", "duel": "duel_enabled", "practice": "practice_enabled"}.get(payload.mode)
            if field:
                _apply(question, {field: payload.enabled}, f"Bulk {payload.mode} eligibility")

    audit(db, actor=admin.email, action=f"question.bulk_{payload.action}", target_type="question", target_id=0,
          detail={"ids": payload.ids[:200], "touched": len(touched), "errors": errors[:20]})
    db.commit()
    return {"ok": True, "touched": len(touched), "ids": touched, "errors": errors}


@router.post("/questions/order")
def reorder_questions(
    payload: QuestionOrderIn,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    """Drag-and-drop ordering: the client sends ids in the new order."""
    rows = {row.id: row for row in db.scalars(select(Question).where(Question.id.in_(payload.ids))).all()}
    for index, question_id in enumerate(payload.ids, start=1):
        row = rows.get(question_id)
        if row is None:
            continue
        if row.order_locked:
            continue
        row.position = index
        row.updated_by = admin.email
        if payload.lock:
            row.order_locked = True
    audit(db, actor=admin.email, action="question.reorder", target_type="question", target_id=0,
          detail={"count": len(payload.ids), "locked": payload.lock})
    db.commit()
    return {"ok": True, "count": len(payload.ids)}


@router.post("/questions/{question_id}/flag")
def flag_question_endpoint(
    question_id: int,
    payload: QuestionFlagIn,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    question = _question_or_404(db, question_id)
    flag_question(db, question, reason=payload.reason, note=payload.note, actor=admin.email)
    audit(db, actor=admin.email, action="question.flag", target_type="question", target_id=question.id,
          detail={"reason": payload.reason})
    db.commit()
    return question_admin_public(question)


@router.post("/questions/{question_id}/unflag")
def unflag_question(
    question_id: int,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    question = _question_or_404(db, question_id)
    clear_flag(db, question, actor=admin.email)
    db.commit()
    return question_admin_public(question)


@router.get("/review-queue")
def review_queue(
    db: Session = Depends(get_db),
    limit: int = Query(60, ge=1, le=200),
) -> dict:
    """Everything awaiting staff attention: drafts, rejected, flagged, reports."""
    drafts = db.scalars(
        select(Question).where(Question.status.in_(["draft", "rejected"])).order_by(Question.updated_at.desc()).limit(limit)
    ).all()
    flagged = db.scalars(
        select(Question).where(Question.flag_reason != "").order_by(Question.flagged_at.desc()).limit(limit)
    ).all()
    reports = db.scalars(
        select(QuestionFlag).where(QuestionFlag.status == "open").order_by(QuestionFlag.created_at.desc()).limit(limit)
    ).all()
    weak = db.scalars(
        select(Question)
        .where(Question.usage_count >= 5, (Question.correct_count * 1.0) / func.max(Question.usage_count, 1) < 0.35)
        .order_by(Question.wrong_count.desc())
        .limit(20)
    ).all()
    report_rows = []
    for report in reports:
        question = db.get(Question, report.question_id)
        report_rows.append(
            {
                "id": report.id,
                "question_id": report.question_id,
                "reason": report.reason,
                "note": report.note,
                "status": report.status,
                "created_at": iso(report.created_at),
                "question_text": (question.text[:160] if question else ""),
                "correct": question.correct if question else None,
            }
        )
    return {
        "drafts": [question_admin_public(row) for row in drafts],
        "flagged": [question_admin_public(row) for row in flagged],
        "reports": report_rows,
        "weak": [question_admin_public(row) for row in weak],
    }


@router.patch("/reports/{report_id}")
def resolve_report(
    report_id: int,
    decision: str = Query("resolved", pattern="^(resolved|dismissed)$"),
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    report = db.get(QuestionFlag, report_id)
    if report is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found.")
    report.status = decision
    audit(db, actor=admin.email, action=f"question.report_{decision}", target_type="question", target_id=report.question_id)
    db.commit()
    return {"ok": True, "status": report.status}


@router.get("/audit")
def audit_log(
    db: Session = Depends(get_db),
    limit: int = Query(80, ge=1, le=400),
    action: str = Query(""),
) -> list[dict]:
    stmt = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)
    if action:
        stmt = stmt.where(AuditLog.action.like(f"{action}%"))
    return [
        {
            "id": row.id,
            "actor": row.actor,
            "role": row.role,
            "action": row.action,
            "target_type": row.target_type,
            "target_id": row.target_id,
            "detail": row.detail or {},
            "created_at": iso(row.created_at),
        }
        for row in db.scalars(stmt).all()
    ]


# ---------------------------------------------------------------------------
# Import / export wizards
# ---------------------------------------------------------------------------
@router.post("/questions/preview-import")
def preview_import(payload: QuestionImportIn, db: Session = Depends(get_db)) -> dict:
    """Parse + validate an import without writing anything: the wizard preview."""
    quiz_id = payload.quiz_id
    course_id = payload.course_id
    if quiz_id:
        quiz = db.get(Quiz, quiz_id)
        if quiz is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found.")
        course_id = course_id or quiz.course_id

    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    if payload.payload is not None:
        report = import_payload(payload.payload, default_quiz_id=quiz_id or 0, default_course_id=course_id)
        rows = [dict(row) for row in report["questions"]]
        errors = report["errors"]
    if payload.raw.strip():
        report = parse_question_blocks(payload.raw)
        rows.extend(report["questions"])
        errors.extend(report["errors"])
        warnings.extend(report["warnings"])

    existing_texts = set()
    if quiz_id:
        existing_texts = {
            (row.text or "").strip().lower()
            for row in db.scalars(select(Question).where(Question.quiz_id == quiz_id)).all()
        }
    duplicates, clean = [], []
    for index, row in enumerate(rows, start=1):
        text = str(row.get("text") or "").strip().lower()
        if text and text in existing_texts:
            duplicates.append({"index": index, "text": str(row.get("text"))[:160], "reason": "Already in this exam"})
        else:
            clean.append({**row, "number": row.get("number", index)})

    return {
        "valid": len(clean),
        "rejected": len(errors),
        "duplicates": len(duplicates),
        "errors": errors,
        "warnings": warnings,
        "duplicate_rows": duplicates[:40],
        "preview": clean[:200],
    }


@router.post("/questions/import")
def run_import(
    payload: QuestionImportIn,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    """Commit a validated import. Answers are preserved exactly as supplied."""
    quiz_id = payload.quiz_id
    if payload.mode == "replace" and not quiz_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose the exam to replace.")
    quiz = db.get(Quiz, quiz_id) if quiz_id else None
    if quiz_id and quiz is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found.")
    course_id = payload.course_id or (quiz.course_id if quiz else None)

    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    if payload.payload is not None:
        report = import_payload(payload.payload, default_quiz_id=quiz_id or 0, default_course_id=course_id)
        rows.extend(report["questions"])
        errors.extend(report["errors"])
    if payload.raw.strip():
        report = parse_question_blocks(payload.raw)
        rows.extend(report["questions"])
        errors.extend(report["errors"])

    if not rows:
        return {"created": 0, "rejected": len(errors), "errors": errors, "skipped": 0}

    if payload.mode == "replace" and quiz:
        for row in db.scalars(select(Question).where(Question.quiz_id == quiz.id)).all():
            db.delete(row)
        db.flush()

    target = quiz
    if target is None:
        # Course-level imports land in the hidden course question bank — the
        # admin never has to fake an exam to stock a course with questions.
        if course_id is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pick a course (or an exam) to import into.")
        course = db.get(Course, int(course_id))
        if course is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found.")
        target = ensure_course_bank_quiz(db, course, admin.email)

    position = int(db.scalar(select(func.max(Question.position)).where(Question.quiz_id == target.id)) or 0) + 1
    existing_texts = {
        (row.text or "").strip().lower()
        for row in db.scalars(select(Question).where(Question.quiz_id == target.id)).all()
    }
    created: list[Question] = []
    skipped: list[dict[str, Any]] = []
    for index, row in enumerate(rows, start=1):
        text = str(row.get("text") or "").strip()
        if payload.skip_duplicates and text.lower() in existing_texts:
            skipped.append({"index": index, "text": text[:160], "reasons": ["Duplicate"]})
            continue
        data = {key: value for key, value in row.items() if key not in {"number", "quiz_id", "course_id"}}
        data["status"] = "approved" if payload.publish else "draft"
        try:
            cleaned = validate_payload(data, require_answer=True)
        except (AnswerValidationError, ValueError) as error:
            errors.append({"index": index, "text": text[:160], "answer": row.get("correct"),
                           "reasons": [getattr(error, "message", str(error))]})
            continue
        question = Question(
            quiz_id=target.id,
            course_id=course_id,
            position=position,
            created_by=admin.email,
            updated_by=admin.email,
            **cleaned,
        )
        db.add(question)
        created.append(question)
        existing_texts.add(text.lower())
        position += 1

    db.flush()
    for question in created:
        validate_saved_question(question)
        record_version(db, question, note="Imported", author=admin.email)
    audit(db, actor=admin.email, action="question.import", target_type="quiz", target_id=target.id,
          detail={"created": len(created), "rejected": len(errors), "skipped": len(skipped)})
    db.commit()
    return {
        "created": len(created),
        "rejected": len(errors),
        "skipped": len(skipped),
        "errors": errors,
        "skipped_rows": skipped,
        "questions": [question_admin_public(row) for row in created],
    }


# ---------------------------------------------------------------------------
# Import straight from the device: .txt / .csv / .pdf / .json papers
# ---------------------------------------------------------------------------
def _paper_from_upload(
    filename: str,
    data: bytes,
    content_type: str,
    *,
    quiz_id: int | None,
    course_id: int | None,
    mode: str = "append",
    skip_duplicates: bool = True,
    publish: bool = True,
) -> tuple[QuestionImportIn, dict[str, Any]]:
    """Read an uploaded paper and wrap it in the normal import contract."""
    try:
        paper = read_upload(filename, data, content_type=content_type)
    except UploadError as error:
        raise HTTPException(error.status_code, error.message) from error

    payload = QuestionImportIn(
        raw=paper.get("text") or "",
        payload=paper.get("payload"),
        quiz_id=quiz_id,
        course_id=course_id,
        mode="replace" if mode == "replace" else "append",
        skip_duplicates=skip_duplicates,
        publish=publish,
    )
    meta = {
        "filename": paper["filename"],
        "kind": paper["kind"],
        "bytes": paper["bytes"],
        "pages": paper.get("pages"),
        "characters": paper.get("characters"),
        "rows_detected": paper.get("rows_detected"),
        "notes": paper.get("notes") or [],
    }
    return payload, meta


@router.post("/questions/import-file/preview")
async def preview_import_file(
    file: UploadFile = File(...),
    quiz_id: int | None = Form(None),
    course_id: int | None = Form(None),
    db: Session = Depends(get_db),
) -> dict:
    """Read a device file and show the validation report before anything is saved."""
    payload, meta = _paper_from_upload(
        file.filename or "upload", await file.read(), file.content_type or "",
        quiz_id=quiz_id, course_id=course_id,
    )
    report = preview_import(payload, db)
    return {"file": meta, **report}


@router.post("/questions/import-file")
async def run_import_file(
    file: UploadFile = File(...),
    quiz_id: int | None = Form(None),
    course_id: int | None = Form(None),
    mode: str = Form("append"),
    skip_duplicates: bool = Form(True),
    publish: bool = Form(True),
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    """Commit an uploaded paper. Answer letters are preserved exactly as read."""
    payload, meta = _paper_from_upload(
        file.filename or "upload", await file.read(), file.content_type or "",
        quiz_id=quiz_id, course_id=course_id, mode=mode,
        skip_duplicates=skip_duplicates, publish=publish,
    )
    result = run_import(payload, db, admin)
    return {"file": meta, **result}


@router.get("/questions/export")
def export_bank(
    db: Session = Depends(get_db),
    course_id: int | None = Query(None),
    quiz_id: int | None = Query(None),
    fmt: str = Query("json", pattern="^(json|csv)$"),
    answer: str = Query(""),
    difficulty: str = Query(""),
    status_filter: str = Query("", alias="status"),
) -> Response:
    result = question_query(
        db,
        course_id=course_id,
        quiz_id=quiz_id,
        answer=answer,
        difficulty=difficulty,
        status=status_filter,
        limit=5000,
    )
    content, media_type, filename = export_questions(result["questions"], fmt=fmt)
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# ---------------------------------------------------------------------------
# Exam templates, duplication, blueprints and generation
# ---------------------------------------------------------------------------
@router.post("/quizzes/{quiz_id}/duplicate")
def duplicate_quiz(
    quiz_id: int,
    payload: QuizDuplicateIn,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    quiz = db.get(Quiz, quiz_id)
    if quiz is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found.")
    clone = Quiz(
        course_id=quiz.course_id,
        title=payload.title.strip() or f"{quiz.title} (copy)",
        instructions=quiz.instructions,
        duration_minutes=quiz.duration_minutes,
        status="draft",
        scheduled_at=None,
        end_at=None,
        shuffle_questions=quiz.shuffle_questions,
        allow_duel=quiz.allow_duel,
        rules=getattr(quiz, "rules", "") or "",
        shuffle_options=bool(getattr(quiz, "shuffle_options", False)),
        per_question_seconds=int(getattr(quiz, "per_question_seconds", 0) or 0),
        grace_seconds=int(getattr(quiz, "grace_seconds", 0) or 0),
        auto_submit=bool(getattr(quiz, "auto_submit", True)),
        calculator=bool(getattr(quiz, "calculator", False)),
        review_before_submit=bool(getattr(quiz, "review_before_submit", True)),
        max_attempts=int(getattr(quiz, "max_attempts", 1) or 0),
        practice_mode=bool(getattr(quiz, "practice_mode", False)),
        version_label=("" if payload.as_template else quiz.version_label),
        template_of=quiz.id if not payload.as_template else None,
    )
    db.add(clone)
    db.flush()
    if payload.with_questions:
        for question in quiz.questions:
            duplicate_question(db, question, target_quiz_id=clone.id, author=admin.email)
    audit(db, actor=admin.email, action="quiz.duplicate", target_type="quiz", target_id=clone.id,
          detail={"from": quiz.id, "questions": payload.with_questions, "template": payload.as_template})
    db.commit()
    return quiz_public(clone, questions=True, reveal=True)


@router.post("/quizzes/from-template/{template_id}")
def create_from_template(
    template_id: int,
    payload: QuizDuplicateIn,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    return duplicate_quiz(template_id, QuizDuplicateIn(title=payload.title, with_questions=True, as_template=False), db, admin)


@router.get("/blueprints")
def list_blueprints(db: Session = Depends(get_db), course_id: int | None = Query(None)) -> list[dict]:
    stmt = select(ExamBlueprint).order_by(ExamBlueprint.updated_at.desc())
    if course_id:
        stmt = stmt.where(ExamBlueprint.course_id == course_id)
    return [
        {
            "id": row.id,
            "name": row.name,
            "course_id": row.course_id,
            "quiz_id": row.quiz_id,
            "config": row.config or {},
            "version_labels": row.version_labels,
            "is_template": row.is_template,
            "updated_at": iso(row.updated_at),
        }
        for row in db.scalars(stmt).all()
    ]


@router.post("/blueprints")
def create_blueprint(
    payload: BlueprintIn,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    row = ExamBlueprint(
        name=payload.name.strip(),
        course_id=payload.course_id,
        quiz_id=payload.quiz_id,
        config=payload.config or {},
        is_template=payload.is_template,
    )
    db.add(row)
    audit(db, actor=admin.email, action="blueprint.create", target_type="blueprint", target_id=0,
          detail={"name": row.name})
    db.commit()
    return {"id": row.id, "name": row.name, "config": row.config, "is_template": row.is_template}


@router.patch("/blueprints/{blueprint_id}")
def update_blueprint(
    blueprint_id: int,
    payload: BlueprintIn,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    row = db.get(ExamBlueprint, blueprint_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Blueprint not found.")
    row.name = payload.name.strip()
    row.course_id = payload.course_id
    row.quiz_id = payload.quiz_id
    row.config = payload.config or {}
    row.is_template = payload.is_template
    audit(db, actor=admin.email, action="blueprint.update", target_type="blueprint", target_id=row.id)
    db.commit()
    return {"id": row.id, "name": row.name, "config": row.config, "is_template": row.is_template}


@router.delete("/blueprints/{blueprint_id}")
def delete_blueprint(blueprint_id: int, db: Session = Depends(get_db)) -> dict:
    row = db.get(ExamBlueprint, blueprint_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Blueprint not found.")
    db.delete(row)
    db.commit()
    return {"ok": True}


def _blueprint_candidates(db: Session, config: dict, course_id: int | None) -> list[Question]:
    stmt = select(Question).where(Question.source_id.is_(None), Question.visible.is_(True))
    if course_id:
        stmt = stmt.where(Question.course_id == course_id)
    if config.get("course_ids"):
        stmt = stmt.where(Question.course_id.in_([int(cid) for cid in config["course_ids"]]))
    statuses = config.get("statuses") or ["approved"]
    stmt = stmt.where(Question.status.in_(statuses))
    pool = list(db.scalars(stmt).all())
    topics = {str(item).lower() for item in (config.get("topics") or [])}
    if topics:
        pool = [row for row in pool if (row.topic or "").lower() in topics]
    wanted_difficulties = {str(item).lower() for item in (config.get("difficulties") or [])}
    if wanted_difficulties:
        pool = [row for row in pool if (row.difficulty or "").lower() in wanted_difficulties]
    return pool


def _pick_for_blueprint(pool: list[Question], config: dict, total: int, rng: random.Random) -> list[Question]:
    quotas = config.get("quotas") or {}
    topic_quota = {str(key): int(value) for key, value in (quotas.get("topics") or {}).items()}
    difficulty_quota = {str(key).lower(): int(value) for key, value in (quotas.get("difficulty") or {}).items()}
    picked: list[Question] = []
    used: set[int] = set()

    def take(candidates: list[Question], count: int) -> None:
        pool_rows = [row for row in candidates if row.id not in used]
        rng.shuffle(pool_rows)
        for row in pool_rows[: max(0, count)]:
            picked.append(row)
            used.add(row.id)

    if topic_quota:
        for topic, count in topic_quota.items():
            take([row for row in pool if (row.topic or "").lower() == topic.lower()], count)
    if difficulty_quota:
        for level, count in difficulty_quota.items():
            take([row for row in pool if (row.difficulty or "").lower() == level], count)
    remaining = total - len(picked)
    if remaining > 0:
        take(pool, remaining)
    return picked[:total]


@router.post("/blueprints/{blueprint_id}/generate")
def generate_from_blueprint(
    blueprint_id: int,
    payload: BlueprintGenerateIn,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    """Auto-generate exam paper(s) from a blueprint — with A/B/C/D versions."""
    blueprint = db.get(ExamBlueprint, blueprint_id)
    if blueprint is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Blueprint not found.")
    config = blueprint.config or {}
    total = int(config.get("total", 20) or 20)
    course_id = blueprint.course_id
    pool = _blueprint_candidates(db, config, course_id)
    if not pool:
        raise HTTPException(status.HTTP_409_CONFLICT, "No questions match this blueprint yet.")

    base_quiz = db.get(Quiz, payload.quiz_id) if payload.quiz_id else (db.get(Quiz, blueprint.quiz_id) if blueprint.quiz_id else None)
    created: list[dict] = []
    labels = ["A", "B", "C", "D", "E", "F"]
    for index in range(payload.versions):
        rng = random.Random(f"{blueprint.id}:{index}:{utcnow().timestamp()}")
        picks = _pick_for_blueprint(pool, config, total, rng)
        quiz = Quiz(
            course_id=course_id,
            title=(payload.title.strip() or blueprint.name) + (f" — Version {labels[index]}" if payload.versions > 1 else ""),
            instructions=(base_quiz.instructions if base_quiz else "") or config.get("instructions", ""),
            duration_minutes=int(config.get("duration_minutes", base_quiz.duration_minutes if base_quiz else 25)),
            status="active" if payload.activate else "draft",
            shuffle_questions=bool(config.get("shuffle_questions", True)),
            shuffle_options=bool(config.get("shuffle_options", False)),
            per_question_seconds=int(config.get("per_question_seconds", 0)),
            auto_submit=True,
            calculator=bool(config.get("calculator", False)),
            allow_duel=bool(config.get("allow_duel", True)),
            version_label=labels[index] if payload.versions > 1 else "",
            blueprint_id=blueprint.id,
        )
        db.add(quiz)
        db.flush()
        for position, question in enumerate(picks, start=1):
            clone = duplicate_question(db, question, target_quiz_id=quiz.id, author=admin.email)
            clone.position = position
        db.flush()
        created.append({"id": quiz.id, "title": quiz.title, "questions": len(picks), "version_label": quiz.version_label, "status": quiz.status})
    audit(db, actor=admin.email, action="blueprint.generate", target_type="blueprint", target_id=blueprint.id,
          detail={"versions": payload.versions, "total": total})
    db.commit()
    return {"ok": True, "created": created, "pool": len(pool)}


@router.post("/blueprints/{blueprint_id}/preview")
def preview_blueprint(blueprint_id: int, db: Session = Depends(get_db)) -> dict:
    blueprint = db.get(ExamBlueprint, blueprint_id)
    if blueprint is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Blueprint not found.")
    config = blueprint.config or {}
    pool = _blueprint_candidates(db, config, blueprint.course_id)
    rng = random.Random(f"preview:{blueprint.id}")
    picks = _pick_for_blueprint(pool, config, int(config.get("total", 20) or 20), rng)
    return {
        "blueprint": {"id": blueprint.id, "name": blueprint.name, "config": config},
        "pool": len(pool),
        "picked": len(picks),
        "by_topic": _histogram(picks, "topic"),
        "by_difficulty": _histogram(picks, "difficulty"),
        "questions": [question_admin_public(row) for row in picks],
    }


def _histogram(rows: list[Question], field: str) -> list[dict]:
    counts: dict[str, int] = {}
    for row in rows:
        key = (getattr(row, field, "") or "Untagged").strip() or "Untagged"
        counts[key] = counts.get(key, 0) + 1
    return [{"key": key, "count": value} for key, value in sorted(counts.items(), key=lambda item: -item[1])]


# ---------------------------------------------------------------------------
# Topic / tag managers
# ---------------------------------------------------------------------------
@router.get("/topics")
def topic_manager(db: Session = Depends(get_db), course_id: int | None = Query(None)) -> dict:
    stmt = select(Question.topic, Question.subtopic, func.count(Question.id)).where(Question.topic != "")
    if course_id:
        stmt = stmt.where(Question.course_id == course_id)
    rows = db.execute(stmt.group_by(Question.topic, Question.subtopic)).all()
    topics: dict[str, dict] = {}
    for topic, subtopic, count in rows:
        entry = topics.setdefault(str(topic), {"topic": str(topic), "count": 0, "subtopics": []})
        entry["count"] += int(count)
        if subtopic:
            entry["subtopics"].append({"subtopic": str(subtopic), "count": int(count)})
    return {
        "topics": sorted(topics.values(), key=lambda item: -item["count"]),
        "untagged": int(db.scalar(select(func.count(Question.id)).where(Question.topic == "")) or 0),
    }


@router.get("/tags")
def tag_manager(db: Session = Depends(get_db)) -> dict:
    counter: dict[str, int] = {}
    for row in db.scalars(select(Question.tags)).all():
        for tag in row or []:
            counter[str(tag)] = counter.get(str(tag), 0) + 1
    return {"tags": [{"tag": key, "count": value} for key, value in sorted(counter.items(), key=lambda item: -item[1])]}


@router.post("/topics/rename")
def rename_topic(
    old: str = Query(..., min_length=1),
    new: str = Query(""),
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    rows = db.scalars(select(Question).where(func.lower(Question.topic) == old.strip().lower())).all()
    for row in rows:
        row.topic = new.strip()
        row.updated_by = admin.email
    audit(db, actor=admin.email, action="topic.rename", target_type="topic", target_id=0,
          detail={"from": old, "to": new, "count": len(rows)})
    db.commit()
    return {"ok": True, "moved": len(rows)}


@router.post("/tags/rename")
def rename_tag(
    old: str = Query(..., min_length=1),
    new: str = Query(""),
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    rows = db.scalars(select(Question)).all()
    moved = 0
    for row in rows:
        tags = list(row.tags or [])
        if old in tags:
            tags = [tag for tag in tags if tag != old]
            if new.strip():
                tags.append(new.strip())
            row.tags = tags
            moved += 1
    audit(db, actor=admin.email, action="tag.rename", target_type="tag", target_id=0,
          detail={"from": old, "to": new, "count": moved})
    db.commit()
    return {"ok": True, "moved": moved}


# ---------------------------------------------------------------------------
# Preview as player
# ---------------------------------------------------------------------------
@router.get("/preview/question/{question_id}")
def preview_question(question_id: int, db: Session = Depends(get_db)) -> dict:
    question = _question_or_404(db, question_id)
    from ..services.questions import question_student_public

    return {
        "as_player": question_student_public(question, reveal=False),
        "with_answer": question_student_public(question, reveal=True),
        "analytics": question_analytics(db, question_id),
    }


@router.get("/preview/quiz/{quiz_id}")
def preview_quiz(quiz_id: int, db: Session = Depends(get_db)) -> dict:
    from ..services.exam import question_order

    quiz = db.get(Quiz, quiz_id)
    if quiz is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found.")
    from ..services.questions import display_order, question_student_public

    sample = list(quiz.questions)[:10]
    return {
        "quiz": quiz_public(quiz, questions=False),
        "questions": [
            {
                "as_player": question_student_public(
                    row,
                    reveal=False,
                    order=display_order(row, shuffle=bool(quiz.shuffle_options), seed=f"preview:{row.id}"),
                ),
                "answer_key": row.correct,
            }
            for row in sample
        ],
    }


# ---------------------------------------------------------------------------
# Flashcard deck builder, challenge builder, boss builder, duel pool builder
# ---------------------------------------------------------------------------
@router.post("/decks/from-bank")
def build_deck_from_bank(
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
    name: str = Query(..., min_length=2, max_length=140),
    course_id: int | None = Query(None),
    topic: str = Query(""),
    difficulty: str = Query(""),
    limit: int = Query(50, ge=1, le=400),
) -> dict:
    """Publish an arena-wide flashcard deck straight from the bank."""
    from ..models import FlashcardCard, FlashcardDeck

    result = question_query(
        db, course_id=course_id, topic=topic, difficulty=difficulty, status="approved", limit=limit, drawn=False
    )
    deck = FlashcardDeck(
        owner_id=None,
        name=name.strip(),
        description=f"Arena deck · {result['total']} cards",
        kind="admin",
        config={"course_id": course_id, "topic": topic, "difficulty": difficulty},
        is_public=True,
    )
    db.add(deck)
    db.flush()
    for row in result["questions"]:
        if not row.flashcard_enabled:
            continue
        db.add(FlashcardCard(deck_id=deck.id, question_id=row.id, student_id=None))
    audit(db, actor=admin.email, action="deck.create", target_type="flashcard_deck", target_id=deck.id,
          detail={"cards": len(result["questions"])})
    db.commit()
    return {"ok": True, "deck_id": deck.id, "cards": len(result["questions"])}


@router.get("/challenge-pool")
def challenge_pool(
    db: Session = Depends(get_db),
    course_id: int | None = Query(None),
    difficulty: str = Query(""),
    topic: str = Query(""),
) -> dict:
    """Preview the pool a challenge/boss/duel would draw from."""
    result = question_query(
        db, course_id=course_id, difficulty=difficulty, topic=topic, status="approved", limit=400
    )
    eligible = {
        "duels": sum(1 for row in result["questions"] if row.duel_enabled),
        "practice": sum(1 for row in result["questions"] if row.practice_enabled),
        "flashcards": sum(1 for row in result["questions"] if row.flashcard_enabled),
    }
    return {
        "total": result["total"],
        "eligible": eligible,
        "by_difficulty": _histogram(result["questions"], "difficulty"),
        "by_topic": _histogram(result["questions"], "topic"),
    }


# ---------------------------------------------------------------------------
# Quiz metadata edit (rules, timers, versions) — additive fields only
# ---------------------------------------------------------------------------
@router.patch("/quizzes/{quiz_id}/builder")
def update_builder(
    quiz_id: int,
    payload: QuizBuilderIn,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    quiz = db.get(Quiz, quiz_id)
    if quiz is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found.")
    data = payload.model_dump(exclude_unset=True, exclude_none=True)
    if "status" in data and data["status"] == "active" and quiz.scheduled_at is None:
        quiz.scheduled_at = utcnow()
    for field, value in data.items():
        if hasattr(quiz, field):
            setattr(quiz, field, value)
    audit(db, actor=admin.email, action="quiz.builder", target_type="quiz", target_id=quiz.id,
          detail={"fields": sorted(data.keys())})
    db.commit()
    return quiz_public(quiz, questions=True, reveal=True)


@router.get("/questions/{question_id}/usage")
def question_usage(question_id: int, db: Session = Depends(get_db)) -> dict:
    """Where a question actually shows up, so edits are never a surprise."""
    question = _question_or_404(db, question_id)
    quizzes = db.scalars(select(Quiz).where(Quiz.id == question.quiz_id)).all()
    copies = db.scalars(select(Question).where(Question.source_id == question.id)).all()
    return {
        "question_id": question.id,
        "version": question.version,
        "usage_count": question.usage_count,
        "quiz": [{"id": row.id, "title": row.title, "status": row.status} for row in quizzes],
        "copies": [{"id": row.id, "quiz_id": row.quiz_id, "correct": row.correct, "text": row.text[:120]} for row in copies],
        "copy_count": len(copies),
        "sync_policy": "copies hold their own copy of the answer — edits here do not silently change an exam already drawn",
    }


@router.get("/versions/recent")
def recent_versions(db: Session = Depends(get_db), limit: int = Query(60, ge=1, le=300)) -> list[dict]:
    rows = db.scalars(select(QuestionVersion).order_by(QuestionVersion.id.desc()).limit(limit)).all()
    return [
        {
            "id": row.id,
            "question_id": row.question_id,
            "version": row.version,
            "note": row.note,
            "author": row.author,
            "created_at": iso(row.created_at),
        }
        for row in rows
    ]


@router.post("/questions/{question_id}/patch")
def patch_question_alias(
    question_id: int,
    payload: QuestionPatchIn,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    """Alias of PATCH /questions/{id} kept for explicit studio calls."""
    question = _question_or_404(db, question_id)
    data = payload.model_dump(exclude_unset=True, exclude_none=True)
    try:
        apply_question_fields(db, question, data, author=admin.email, note="Studio patch")
        validate_saved_question(question)
    except (AnswerValidationError, ValueError) as error:
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, getattr(error, "message", str(error))) from error
    audit(db, actor=admin.email, action="question.patch", target_type="question", target_id=question.id,
          detail={"fields": sorted(data.keys())})
    db.commit()
    db.refresh(question)
    return question_admin_public(question)


@router.get("/students/leaderboard")
def student_board(db: Session = Depends(get_db), limit: int = Query(20, ge=1, le=100)) -> list[dict]:
    rows = db.scalars(select(Student).order_by(Student.xp.desc()).limit(limit)).all()
    return [
        {"id": row.id, "name": row.name, "xp": row.xp, "coins": row.coins, "accuracy": round(
            row.correct_answers / row.questions_answered * 100, 1) if row.questions_answered else 0.0}
        for row in rows
    ]


@router.get("/health-snapshot")
def health_snapshot(db: Session = Depends(get_db)) -> dict:
    """A single object the studio dashboard can poll for the arena's pulse."""
    since = utcnow() - timedelta(hours=24)
    from ..models import Activity, Answer, Attempt, Duel, PracticeRun

    return {
        "generated_at": iso(utcnow()),
        "questions": int(db.scalar(select(func.count(Question.id))) or 0),
        "flagged": int(db.scalar(select(func.count(Question.id)).where(Question.flag_reason != "")) or 0),
        "drafts": int(db.scalar(select(func.count(Question.id)).where(Question.status == "draft")) or 0),
        "answers_24h": int(db.scalar(select(func.count(Answer.id)).where(Answer.answered_at >= since)) or 0),
        "attempts_24h": int(db.scalar(select(func.count(Attempt.id)).where(Attempt.started_at >= since)) or 0),
        "duels_24h": int(db.scalar(select(func.count(Duel.id)).where(Duel.created_at >= since)) or 0),
        "practice_24h": int(db.scalar(select(func.count(PracticeRun.id)).where(PracticeRun.created_at >= since)) or 0),
        "recent_activity": [
            {"title": row.title, "detail": row.detail, "kind": row.kind, "created_at": iso(row.created_at)}
            for row in db.scalars(select(Activity).order_by(Activity.created_at.desc()).limit(12)).all()
        ],
    }
