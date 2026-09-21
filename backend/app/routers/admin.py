"""Staff console API — every destructive action requires an admin token."""
from __future__ import annotations

import csv
import io
import random
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import game
from ..config import DEFAULT_ADMIN_EMAIL
from ..db import get_db
from ..deps import require_admin
from ..events import dispatch, to_everyone
from ..models import (
    Activity,
    Admin,
    ArenaEvent,
    Attempt,
    Badge,
    Config,
    Course,
    Duel,
    GroupMessage,
    Notification,
    Prize,
    PrizeClaim,
    Question,
    QuestionVersion,
    Quiz,
    Student,
    StudentBadge,
    StudyGroup,
    StudyGroupMember,
    utcnow,
)
from ..schemas import (
    BankDrawIn,
    BlueprintGenerateIn,
    BlueprintIn,
    ClaimStatusIn,
    ConfigIn,
    EventCreateInUtc,
    EventUpdateInUtc,
    CourseIn,
    NotificationIn,
    PrizeIn,
    QuestionBulkIn,
    QuestionFlagIn,
    QuestionIn,
    QuestionOrderIn,
    QuestionPatchIn,
    QuizBuilderIn,
    QuizDuplicateIn,
    QuizIn,
    QuizStatusIn,
    StudentIn,
)
from ..services.questions import (
    AnswerValidationError,
    apply_question_fields,
    audit,
    bank_health,
    duplicate_question,
    export_questions,
    import_payload,
    parse_question_blocks,
    question_admin_public,
    question_analytics,
    question_query,
    question_snapshot,
    record_version,
    restore_version,
    similar_questions,
    validate_saved_question,
    validate_payload,
)
from ..serializers import (
    activity_public,
    badge_public,
    claim_public,
    course_public,
    iso,
    notification_public,
    prize_public,
    question_public,
    quiz_public,
    student_profile,
    student_public,
)
from ..services.exam import quiz_leaderboard
from ..ws import hub

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


# ---------------------------------------------------------------------------
# overview
# ---------------------------------------------------------------------------
@router.get("/overview")
def overview(db: Session = Depends(get_db)) -> dict:
    since = utcnow() - timedelta(hours=24)
    total_questions = db.scalar(select(func.count(Question.id))) or 0
    return {
        "players": db.scalar(select(func.count(Student.id))) or 0,
        "online": hub.online_count(),
        "courses": db.scalar(select(func.count(Course.id))) or 0,
        "quizzes": db.scalar(select(func.count(Quiz.id))) or 0,
        "active_quizzes": db.scalar(select(func.count(Quiz.id)).where(Quiz.status == "active")) or 0,
        "questions": total_questions,
        "submissions": db.scalar(select(func.count(Attempt.id)).where(Attempt.status == "submitted")) or 0,
        "in_progress": db.scalar(select(func.count(Attempt.id)).where(Attempt.status == "in_progress")) or 0,
        "duels": db.scalar(select(func.count(Duel.id))) or 0,
        "duels_live": db.scalar(select(func.count(Duel.id)).where(Duel.status == "live")) or 0,
        "duels_today": db.scalar(select(func.count(Duel.id)).where(Duel.created_at >= since)) or 0,
        "prize_claims_pending": db.scalar(
            select(func.count(PrizeClaim.id)).where(PrizeClaim.status == "pending")
        )
        or 0,
        "badges_awarded": db.scalar(select(func.count(StudentBadge.id))) or 0,
        "xp_awarded": db.scalar(select(func.coalesce(func.sum(Student.xp), 0))) or 0,
        "coins_in_circulation": db.scalar(select(func.coalesce(func.sum(Student.coins), 0))) or 0,
        "top_players": [
            student_public(s, mask=False)
            for s in db.scalars(select(Student).order_by(Student.xp.desc()).limit(5)).all()
        ],
        "recent_activity": [
            {**activity_public(a), "student": student_public(a.student, mask=True) if a.student else None}
            for a in db.scalars(select(Activity).order_by(Activity.created_at.desc()).limit(12)).all()
        ],
    }


@router.get("/config")
def read_config(db: Session = Depends(get_db)) -> dict:
    config = db.get(Config, 1)
    if config is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Config missing — run the seeder.")
    return {
        "institution": config.institution,
        "campus": config.campus,
        "faculty": config.faculty,
        "season_name": config.season_name,
        "prize_pool_note": config.prize_pool_note,
        "grading_scale": config.grading_scale or game.DEFAULT_GRADING_SCALE,
        "duels_enabled": config.duels_enabled,
        "exams_enabled": config.exams_enabled,
        "admin_email": DEFAULT_ADMIN_EMAIL,
        "updated_at": iso(config.updated_at),
    }


@router.patch("/config")
async def update_config(payload: ConfigIn, db: Session = Depends(get_db)) -> dict:
    config = db.get(Config, 1)
    if config is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Config missing.")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(config, field, value)
    config.updated_at = utcnow()
    db.commit()
    await dispatch([to_everyone("config_updated", read_config(db))])
    return read_config(db)


# ---------------------------------------------------------------------------
# courses
# ---------------------------------------------------------------------------
@router.get("/courses")
def list_courses(db: Session = Depends(get_db)) -> list[dict]:
    counts = dict(db.execute(select(Quiz.course_id, func.count(Quiz.id)).group_by(Quiz.course_id)).all())
    return [course_public(c, quiz_count=int(counts.get(c.id, 0))) for c in db.scalars(select(Course).order_by(Course.code)).all()]


@router.post("/courses")
def create_course(payload: CourseIn, db: Session = Depends(get_db)) -> dict:
    code = payload.code.strip().upper()
    if db.scalar(select(Course.id).where(Course.code == code)):
        raise HTTPException(status.HTTP_409_CONFLICT, f"{code} already exists.")
    course = Course(**{**payload.model_dump(), "code": code})
    db.add(course)
    db.commit()
    return course_public(course)


@router.patch("/courses/{course_id}")
def update_course(course_id: int, payload: CourseIn, db: Session = Depends(get_db)) -> dict:
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found.")
    data = payload.model_dump()
    data["code"] = data["code"].strip().upper()
    for field, value in data.items():
        setattr(course, field, value)
    db.commit()
    return course_public(course)


@router.delete("/courses/{course_id}")
def delete_course(course_id: int, db: Session = Depends(get_db)) -> dict:
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found.")
    db.delete(course)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# quizzes
# ---------------------------------------------------------------------------
@router.get("/quizzes")
def list_quizzes(db: Session = Depends(get_db)) -> list[dict]:
    quizzes = db.scalars(select(Quiz).order_by(Quiz.id.desc())).all()
    payload = []
    for quiz in quizzes:
        submissions = db.scalar(
            select(func.count(Attempt.id)).where(Attempt.quiz_id == quiz.id, Attempt.status == "submitted")
        )
        payload.append(quiz_public(quiz, submission_count=int(submissions or 0)))
    return payload


@router.post("/quizzes")
def create_quiz(payload: QuizIn, db: Session = Depends(get_db)) -> dict:
    quiz = Quiz(**payload.model_dump())
    db.add(quiz)
    db.commit()
    return quiz_public(quiz, questions=True, reveal=True)


@router.get("/quizzes/{quiz_id}")
def read_quiz(quiz_id: int, db: Session = Depends(get_db)) -> dict:
    quiz = db.get(Quiz, quiz_id)
    if quiz is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quiz not found.")
    return quiz_public(quiz, questions=True, reveal=True)


@router.patch("/quizzes/{quiz_id}")
async def update_quiz(quiz_id: int, payload: QuizBuilderIn, db: Session = Depends(get_db)) -> dict:
    quiz = db.get(Quiz, quiz_id)
    if quiz is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quiz not found.")
    data = payload.model_dump(exclude_unset=True, exclude_none=True)
    if "max_attempts" in data and data["max_attempts"] < 0:
        data["max_attempts"] = 0
    for field, value in data.items():
        if hasattr(quiz, field):
            setattr(quiz, field, value)
    db.commit()
    await dispatch([to_everyone("quiz_updated", quiz_public(quiz))])
    return quiz_public(quiz, questions=True, reveal=True)


@router.patch("/quizzes/{quiz_id}/status")
async def set_quiz_status(quiz_id: int, payload: QuizStatusIn, db: Session = Depends(get_db)) -> dict:
    quiz = db.get(Quiz, quiz_id)
    if quiz is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quiz not found.")
    quiz.status = payload.status
    if payload.status == "active" and quiz.scheduled_at is None:
        quiz.scheduled_at = utcnow()
    db.commit()
    await dispatch(
        [
            to_everyone("quiz_status", {"quiz": quiz_public(quiz), "status": payload.status}),
        ]
    )
    return quiz_public(quiz)


@router.delete("/quizzes/{quiz_id}")
def delete_quiz(quiz_id: int, db: Session = Depends(get_db)) -> dict:
    quiz = db.get(Quiz, quiz_id)
    if quiz is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quiz not found.")
    db.delete(quiz)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# questions
# ---------------------------------------------------------------------------
@router.get("/quizzes/{quiz_id}/questions")
def list_questions(quiz_id: int, db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(
        select(Question).where(Question.quiz_id == quiz_id).order_by(Question.position, Question.id)
    ).all()
    return [question_admin_public(q) for q in rows]


def _next_position(db: Session, quiz_id: int) -> int:
    highest = db.scalar(select(func.max(Question.position)).where(Question.quiz_id == quiz_id))
    return int(highest or 0) + 1


@router.post("/quizzes/{quiz_id}/questions")
def create_question(
    quiz_id: int,
    payload: QuestionIn,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    quiz = db.get(Quiz, quiz_id)
    if quiz is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quiz not found.")
    data = payload.model_dump()
    data["quiz_id"] = quiz_id
    if data.get("course_id") is None:
        data["course_id"] = quiz.course_id
    position = data.pop("position", None) or _next_position(db, quiz_id)
    try:
        cleaned = validate_payload(data, require_answer=True)
    except AnswerValidationError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, error.message) from error
    except ValueError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(error)) from error
    cleaned.pop("quiz_id", None)
    cleaned.pop("course_id", None)
    question = Question(
        quiz_id=quiz_id,
        course_id=data.get("course_id") or quiz.course_id,
        position=position,
        created_by=admin.email,
        updated_by=admin.email,
        **cleaned,
    )
    db.add(question)
    db.flush()
    validate_saved_question(question)
    record_version(db, question, note="Created", author=admin.email)
    audit(db, actor=admin.email, action="question.create", target_type="question", target_id=question.id,
          detail={"quiz_id": quiz_id, "correct": question.correct})
    db.commit()
    return question_admin_public(question)


@router.post("/quizzes/{quiz_id}/questions/bulk")
def bulk_create_questions(
    quiz_id: int,
    payload: QuestionBulkIn,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    """Bulk import from structured rows **or** a pasted paper.

    Invalid answers are rejected with a per-question reason — never silently
    converted to ``A``. The response always includes the full validation report.
    """
    quiz = db.get(Quiz, quiz_id)
    if quiz is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quiz not found.")
    if payload.mode == "replace":
        for row in db.scalars(select(Question).where(Question.quiz_id == quiz_id)).all():
            db.delete(row)
        db.flush()

    position = _next_position(db, quiz_id)
    created: list[Question] = []
    errors: list[dict] = []
    warnings: list[dict] = []

    if payload.raw.strip():
        report = parse_question_blocks(
            payload.raw,
            default_points=payload.default_points,
            default_difficulty=payload.default_difficulty,
        )
        errors.extend(report["errors"])
        warnings.extend(report["warnings"])
        rows = report["questions"]
    else:
        rows = []
        for index, item in enumerate(payload.questions, start=1):
            try:
                cleaned = validate_payload(item.model_dump(), require_answer=True)
                rows.append(cleaned)
            except (AnswerValidationError, ValueError) as error:
                errors.append({
                    "index": index,
                    "text": (item.text or "")[:160],
                    "answer": item.correct,
                    "reasons": [getattr(error, "message", str(error))],
                })

    existing_texts = {
        (row.text or "").strip().lower()
        for row in db.scalars(select(Question).where(Question.quiz_id == quiz_id)).all()
    }
    skipped: list[dict] = []
    for index, row in enumerate(rows, start=1):
        text = str(row.get("text") or "").strip()
        if payload.skip_duplicates and text.lower() in existing_texts:
            skipped.append({"index": index, "text": text[:160], "reasons": ["Duplicate of an existing question in this exam"]})
            continue
        try:
            cleaned = validate_payload({**row, "quiz_id": quiz_id, "course_id": quiz.course_id}, require_answer=True)
        except (AnswerValidationError, ValueError) as error:
            errors.append({
                "index": index,
                "text": text[:160],
                "answer": row.get("correct"),
                "reasons": [getattr(error, "message", str(error))],
            })
            continue
        cleaned.pop("quiz_id", None)
        cleaned.pop("course_id", None)
        question = Question(
            quiz_id=quiz_id,
            course_id=quiz.course_id,
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
    audit(db, actor=admin.email, action="question.bulk_import", target_type="quiz", target_id=quiz_id,
          detail={"created": len(created), "rejected": len(errors), "skipped": len(skipped)})
    db.commit()
    return {
        "created": len(created),
        "rejected": len(errors),
        "skipped": len(skipped),
        "errors": errors,
        "skipped_rows": skipped,
        "warnings": warnings,
        "questions": [question_admin_public(q) for q in created],
    }


@router.get("/courses/{course_id}/bank")
def course_bank(course_id: int, db: Session = Depends(get_db)) -> dict:
    """Every original question that belongs to this course — its single bank."""
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found.")
    bank = db.scalar(
        select(func.count(Question.id)).where(Question.course_id == course_id, Question.source_id.is_(None))
    ) or 0
    copies = db.scalar(
        select(func.count(Question.id)).where(Question.course_id == course_id, Question.source_id.is_not(None))
    ) or 0
    return {"course_id": course_id, "code": course.code, "bank": bank, "drawn_copies": copies}


@router.post("/quizzes/{quiz_id}/draw")
def draw_from_bank(
    quiz_id: int,
    payload: BankDrawIn,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    """Randomly pull `count` questions from the quiz's course bank into the quiz.

    Drawn questions are copies tagged with source_id, so the bank itself never
    shrinks, a question can never land in the same quiz twice, and every existing
    exam/duel/study path keeps working untouched. The copy carries the *same*
    stored answer — importing or drawing can never change the key.
    """
    quiz = db.get(Quiz, quiz_id)
    if quiz is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quiz not found.")
    if quiz.course_id is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Give the quiz a course first — draws pull from that course's question bank only.",
        )
    owned = set(db.scalars(select(Question.id).where(Question.quiz_id == quiz_id)).all())
    already_copied = set(
        db.scalars(select(Question.source_id).where(Question.quiz_id == quiz_id, Question.source_id.is_not(None))).all()
    )
    pool = list(
        db.scalars(
            select(Question).where(
                Question.course_id == quiz.course_id,
                Question.source_id.is_(None),
                Question.status.in_(["approved"]),
                Question.visible.is_(True),
                Question.id.not_in(owned | already_copied),
            )
        ).all()
    )
    # Never draw the same question text twice into one exam — two bank originals
    # can legitimately share wording, and duplicate rows confuse players.
    existing_texts = {
        (text or "").strip().lower()
        for text in db.scalars(select(Question.text).where(Question.quiz_id == quiz_id)).all()
    }
    seen_texts = set(existing_texts)
    picks: list[Question] = []
    for candidate in random.sample(pool, len(pool)):
        key = (candidate.text or "").strip().lower()
        if key in seen_texts:
            continue
        seen_texts.add(key)
        picks.append(candidate)
        if len(picks) >= payload.count:
            break
    position = _next_position(db, quiz_id)
    for original in picks:
        clone = Question(
            quiz_id=quiz_id,
            course_id=quiz.course_id,
            position=position,
            text=original.text,
            option_a=original.option_a,
            option_b=original.option_b,
            option_c=original.option_c,
            option_d=original.option_d,
            correct=original.correct,
            explanation=original.explanation,
            difficulty=original.difficulty,
            points=original.points,
            question_type=original.question_type,
            topic=original.topic,
            subtopic=original.subtopic,
            objective=original.objective,
            tags=list(original.tags or []),
            source=original.source,
            reference=original.reference,
            author=original.author,
            hint=original.hint,
            media=dict(original.media or {}),
            content=dict(original.content or {}),
            status="approved",
            flashcard_enabled=original.flashcard_enabled,
            duel_enabled=original.duel_enabled,
            practice_enabled=original.practice_enabled,
            time_limit_seconds=original.time_limit_seconds,
            source_id=original.id,
            created_by=admin.email,
            updated_by=admin.email,
        )
        db.add(clone)
        position += 1
    db.flush()
    audit(db, actor=admin.email, action="question.draw", target_type="quiz", target_id=quiz_id,
          detail={"drawn": len(picks)})
    db.commit()
    total = db.scalar(select(func.count(Question.id)).where(Question.quiz_id == quiz_id)) or 0
    return {
        "drawn": len(picks),
        "requested": payload.count,
        "available": sum(1 for row in pool if (row.text or "").strip().lower() not in seen_texts),
        "total": total,
        "bank": db.scalar(
            select(func.count(Question.id)).where(Question.course_id == quiz.course_id, Question.source_id.is_(None))
        ) or 0,
    }


# ``:int`` keeps this route from swallowing sibling literal paths such as
# /questions/export that live in the studio router.
@router.get("/questions/{question_id:int}")
def read_question(question_id: int, db: Session = Depends(get_db)) -> dict:
    question = db.get(Question, question_id)
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found.")
    return question_admin_public(question)


@router.patch("/questions/{question_id:int}")
def update_question(
    question_id: int,
    payload: QuestionPatchIn,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    """Partial edit with PATCH semantics.

    Only the fields the administrator actually changed are written — a request
    that touches the option text can never reset the stored answer, and a request
    that changes the answer is persisted exactly as chosen (then re-read from the
    database so the caller can verify).
    """
    question = db.get(Question, question_id)
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found.")
    data = payload.model_dump(exclude_unset=True, exclude_none=True)
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nothing to update.")
    if "quiz_id" in data and data["quiz_id"] != question.quiz_id:
        quiz = db.get(Quiz, data["quiz_id"])
        if quiz is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Target exam not found.")
        if data.get("course_id") is None:
            data["course_id"] = quiz.course_id
        if question.order_locked:
            raise HTTPException(status.HTTP_409_CONFLICT, "This question's order is locked — unlock it first.")
    before = question_snapshot(question)
    try:
        apply_question_fields(db, question, data, author=admin.email, note="Edited in studio")
    except AnswerValidationError as error:
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, error.message) from error
    except ValueError as error:
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(error)) from error
    validate_saved_question(question)
    changed = sorted(
        key for key in data if str(before.get(key)) != str(getattr(question, key, None))
    )
    audit(db, actor=admin.email, action="question.update", target_type="question", target_id=question.id,
          detail={"fields": changed, "correct": question.correct})
    db.commit()
    db.refresh(question)
    payload_out = question_admin_public(question)
    payload_out["changed"] = changed
    payload_out["verified"] = {"correct": question.correct, "version": question.version}
    return payload_out


@router.delete("/questions/{question_id:int}")
def delete_question(
    question_id: int,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    question = db.get(Question, question_id)
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found.")
    audit(db, actor=admin.email, action="question.delete", target_type="question", target_id=question.id,
          detail={"text": question.text[:120], "correct": question.correct})
    db.delete(question)
    db.commit()
    return {"ok": True}


@router.post("/questions/{question_id}/duplicate")
def duplicate_question_endpoint(
    question_id: int,
    quiz_id: int | None = Query(None),
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    question = db.get(Question, question_id)
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found.")
    clone = duplicate_question(db, question, target_quiz_id=quiz_id, author=admin.email)
    audit(db, actor=admin.email, action="question.duplicate", target_type="question", target_id=clone.id,
          detail={"from": question.id})
    db.commit()
    return question_admin_public(clone)


@router.get("/questions/{question_id}/versions")
def question_versions(question_id: int, db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(
        select(QuestionVersion)
        .where(QuestionVersion.question_id == question_id)
        .order_by(QuestionVersion.id.desc())
        .limit(50)
    ).all()
    return [
        {
            "id": row.id,
            "version": row.version,
            "note": row.note,
            "author": row.author,
            "created_at": iso(row.created_at),
            "snapshot": row.snapshot,
        }
        for row in rows
    ]


@router.post("/questions/{question_id}/versions/{version}/restore")
def restore_question_version(
    question_id: int,
    version: int,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    question = db.get(Question, question_id)
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found.")
    try:
        restore_version(db, question, version, author=admin.email)
    except ValueError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(error)) from error
    audit(db, actor=admin.email, action="question.restore", target_type="question", target_id=question.id,
          detail={"restored_version": version})
    db.commit()
    return question_admin_public(question)


@router.get("/questions/{question_id}/analytics")
def question_analytics_endpoint(question_id: int, db: Session = Depends(get_db)) -> dict:
    try:
        return question_analytics(db, question_id)
    except ValueError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(error)) from error


@router.get("/questions/{question_id}/similar")
def question_similar(question_id: int, db: Session = Depends(get_db)) -> list[dict]:
    question = db.get(Question, question_id)
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found.")
    return similar_questions(db, question)


# ---------------------------------------------------------------------------
# students
# ---------------------------------------------------------------------------
def name_or_phone_filter(term: str):
    needle = term.strip().lower()
    return func.lower(Student.name).like(f"%{needle}%") | Student.phone.like(f"%{needle}%")


@router.get("/students")
def list_students(
    db: Session = Depends(get_db),
    q: str = Query("", max_length=60),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict:
    query = select(Student)
    total_query = select(func.count(Student.id))
    if q.strip():
        clause = name_or_phone_filter(q)
        query = query.where(clause)
        total_query = total_query.where(clause)
    total = db.scalar(total_query) or 0
    rows = db.scalars(query.order_by(Student.name).limit(limit).offset(offset)).all()
    return {
        "total": int(total),
        "rows": [student_public(s, mask=False) for s in rows],
        "limit": limit,
        "offset": offset,
    }


@router.post("/students")
def create_student(payload: StudentIn, db: Session = Depends(get_db)) -> dict:
    if db.scalar(select(Student.id).where(Student.phone == payload.phone)):
        raise HTTPException(status.HTTP_409_CONFLICT, "That phone number is already registered.")
    base = "".join(ch for ch in payload.name.strip().lower() if ch.isalnum()) or "player"
    username = base[:18]
    suffix = 1
    while db.scalar(select(Student.id).where(Student.username == username)):
        suffix += 1
        username = f"{base[:14]}{suffix}"
    student = Student(
        phone=payload.phone,
        username=username,
        password_hash="",  # staff-created record; the player registers their own login
        name=payload.name.strip(),
        reg_no=payload.reg_no,
        level=payload.level,
        faculty=payload.faculty,
        campus=payload.campus,
        class_name=payload.class_name,
        avatar_hue=(payload.name.__len__() * 37) % 360,
        week_key=game.week_key(),
    )
    db.add(student)
    db.commit()
    return student_public(student, mask=False)


@router.get("/students/{student_id}")
def read_student(student_id: int, db: Session = Depends(get_db)) -> dict:
    student = db.get(Student, student_id)
    if student is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Player not found.")
    return student_profile(db, student)


@router.patch("/students/{student_id}")
def update_student(student_id: int, payload: StudentIn, db: Session = Depends(get_db)) -> dict:
    student = db.get(Student, student_id)
    if student is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Player not found.")
    clash = db.scalar(
        select(Student.id).where(Student.phone == payload.phone, Student.id != student.id)
    )
    if clash:
        raise HTTPException(status.HTTP_409_CONFLICT, "Another player already uses that phone number.")
    student.phone = payload.phone
    student.name = payload.name.strip()
    student.reg_no = payload.reg_no
    student.level = payload.level
    student.faculty = payload.faculty
    student.campus = payload.campus
    student.class_name = payload.class_name
    db.commit()
    return student_public(student, mask=False)


@router.post("/students/{student_id}/ban")
def toggle_ban(student_id: int, db: Session = Depends(get_db)) -> dict:
    student = db.get(Student, student_id)
    if student is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Player not found.")
    student.is_banned = not student.is_banned
    db.commit()
    return {"ok": True, "is_banned": student.is_banned}


@router.post("/students/{student_id}/adjust")
def adjust_progress(
    student_id: int,
    xp: int = Query(0),
    coins: int = Query(0),
    reason: str = Query("Staff adjustment"),
    db: Session = Depends(get_db),
) -> dict:
    student = db.get(Student, student_id)
    if student is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Player not found.")
    student.coins = max(0, student.coins + coins)
    if xp > 0:
        # A staff award is XP the player can see, so it climbs the season ladder
        # with everything else. A negative correction is the one thing that lands
        # on lifetime XP alone: a season already played is not rewritten.
        from ..game import award_xp

        award_xp(db, student, xp)
    elif xp < 0:
        student.xp = max(0, student.xp + xp)
    db.add(
        Activity(
            student_id=student.id,
            kind="xp",
            title=reason,
            detail=f"Staff adjustment: {xp:+d} XP, {coins:+d} coins",
            amount=xp or coins,
        )
    )
    db.commit()
    return student_public(student, mask=False)


@router.delete("/students/{student_id}")
def delete_student(student_id: int, db: Session = Depends(get_db)) -> dict:
    student = db.get(Student, student_id)
    if student is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Player not found.")
    db.delete(student)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# study groups — a cross-group moderation list for staff
# ---------------------------------------------------------------------------
@router.get("/groups")
def admin_list_groups(
    db: Session = Depends(get_db),
    q: str = Query(""),
    limit: int = Query(40, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    """Every study group in the arena, newest first, with owner + activity counts.

    Server-paginated (``limit``/``offset``) and searchable by name or join code
    so staff can moderate groups without an endless scroll.
    """
    stmt = select(StudyGroup)
    needle = q.strip()
    if needle:
        like = f"%{needle}%"
        stmt = stmt.where(StudyGroup.name.ilike(like) | StudyGroup.code.ilike(like))
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    groups = db.scalars(stmt.order_by(StudyGroup.id.desc()).limit(limit).offset(offset)).all()
    group_ids = [group.id for group in groups] or [-1]
    member_counts = dict(
        db.execute(
            select(StudyGroupMember.group_id, func.count(StudyGroupMember.id))
            .where(StudyGroupMember.group_id.in_(group_ids))
            .group_by(StudyGroupMember.group_id)
        ).all()
    )
    message_counts = dict(
        db.execute(
            select(GroupMessage.group_id, func.count(GroupMessage.id))
            .where(GroupMessage.group_id.in_(group_ids))
            .group_by(GroupMessage.group_id)
        ).all()
    )
    owners = {
        row.id: row
        for row in db.scalars(select(Student).where(Student.id.in_([g.owner_id for g in groups] or [-1]))).all()
    }
    courses = {
        row.id: row
        for row in db.scalars(
            select(Course).where(Course.id.in_([g.course_id for g in groups if g.course_id] or [-1]))
        ).all()
    }
    rows = []
    for group in groups:
        owner = owners.get(group.owner_id)
        course = courses.get(group.course_id) if group.course_id else None
        rows.append(
            {
                "id": group.id,
                "name": group.name,
                "code": group.code,
                "goal": group.goal,
                "description": group.description,
                "owner": {"id": group.owner_id, "name": owner.name if owner else "Unknown"},
                "course_title": course.title if course else None,
                "member_count": int(member_counts.get(group.id, 0)),
                "message_count": int(message_counts.get(group.id, 0)),
                "created_at": iso(group.created_at),
            }
        )
    return {"rows": rows, "total": int(total), "limit": limit, "offset": offset}


# ---------------------------------------------------------------------------
# results
# ---------------------------------------------------------------------------
@router.get("/results")
def results(
    db: Session = Depends(get_db),
    quiz_id: int | None = Query(None),
    q: str = Query(""),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    if quiz_id:
        rows = quiz_leaderboard(db, quiz_id)
        if q.strip():
            needle = q.strip().lower()
            rows = [r for r in rows if needle in r["student"]["name"].lower() or needle in r["student"]["phone"]]
        total = len(rows)
        return {
            "quiz_id": quiz_id,
            "rows": rows[offset : offset + limit],
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    base = select(Attempt).where(Attempt.status == "submitted")
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    attempts = db.scalars(base.order_by(Attempt.submitted_at.desc()).limit(limit).offset(offset)).all()
    return {
        "quiz_id": None,
        "rows": [
            {
                "id": a.id,
                "student": student_public(a.student, mask=False),
                "quiz": {"id": a.quiz.id, "title": a.quiz.title},
                "score": a.score,
                "percentage": round(a.percentage, 2),
                "grade": a.grade,
                "submitted_at": iso(a.submitted_at),
            }
            for a in attempts
        ],
        "total": int(total),
        "limit": limit,
        "offset": offset,
    }


@router.get("/results/export")
def export_results(quiz_id: int, db: Session = Depends(get_db)) -> Response:
    quiz = db.get(Quiz, quiz_id)
    if quiz is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quiz not found.")
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["Rank", "Name", "Phone", "Score", "Total", "Percentage", "Grade", "Submitted"])
    for row in quiz_leaderboard(db, quiz_id):
        writer.writerow(
            [
                row["rank"],
                row["student"]["name"],
                row["student"]["phone"],
                row["result"]["score"],
                len(quiz.questions),
                row["result"]["percentage"],
                row["result"]["grade"],
                row["result"]["submitted_at"] or "",
            ]
        )
    headers = {"Content-Disposition": f'attachment; filename="arena-results-quiz-{quiz_id}.csv"'}
    return Response(content=buffer.getvalue(), media_type="text/csv", headers=headers)


@router.delete("/results/{attempt_id}")
def delete_result(attempt_id: int, db: Session = Depends(get_db)) -> dict:
    attempt = db.get(Attempt, attempt_id)
    if attempt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Result not found.")
    db.delete(attempt)
    db.commit()
    return {"ok": True}


@router.delete("/results")
def clear_quiz_results(quiz_id: int, db: Session = Depends(get_db)) -> dict:
    attempts = db.scalars(select(Attempt).where(Attempt.quiz_id == quiz_id)).all()
    for attempt in attempts:
        db.delete(attempt)
    db.commit()
    return {"ok": True, "deleted": len(attempts)}


# ---------------------------------------------------------------------------
# notifications, prizes, claims, badges
# ---------------------------------------------------------------------------
@router.get("/notifications")
def admin_notifications(
    db: Session = Depends(get_db),
    limit: int = Query(40, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    total = db.scalar(select(func.count(Notification.id))) or 0
    rows = db.scalars(
        select(Notification).order_by(Notification.created_at.desc()).limit(limit).offset(offset)
    ).all()
    return {"rows": [notification_public(n) for n in rows], "total": int(total), "limit": limit, "offset": offset}


@router.post("/notifications")
async def create_notification(payload: NotificationIn, db: Session = Depends(get_db)) -> dict:
    notice = Notification(
        title=payload.title.strip(),
        message=payload.message,
        kind=payload.kind,
        target_course=payload.target_course,
        is_pinned=payload.is_pinned,
        author="Arena Control",
    )
    db.add(notice)
    db.commit()
    await dispatch([to_everyone("notification", notification_public(notice))])
    return notification_public(notice)


@router.delete("/notifications/{notification_id}")
def delete_notification(notification_id: int, db: Session = Depends(get_db)) -> dict:
    notice = db.get(Notification, notification_id)
    if notice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found.")
    db.delete(notice)
    db.commit()
    return {"ok": True}


@router.get("/prizes")
def admin_prizes(db: Session = Depends(get_db)) -> list[dict]:
    return [prize_public(p) for p in db.scalars(select(Prize).order_by(Prize.sort_order, Prize.id)).all()]


@router.post("/prizes")
def create_prize(payload: PrizeIn, db: Session = Depends(get_db)) -> dict:
    prize = Prize(**payload.model_dump())
    db.add(prize)
    db.commit()
    return prize_public(prize)


@router.patch("/prizes/{prize_id}")
def update_prize(prize_id: int, payload: PrizeIn, db: Session = Depends(get_db)) -> dict:
    prize = db.get(Prize, prize_id)
    if prize is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prize not found.")
    for field, value in payload.model_dump().items():
        setattr(prize, field, value)
    db.commit()
    return prize_public(prize)


@router.delete("/prizes/{prize_id}")
def delete_prize(prize_id: int, db: Session = Depends(get_db)) -> dict:
    prize = db.get(Prize, prize_id)
    if prize is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prize not found.")
    db.delete(prize)
    db.commit()
    return {"ok": True}


@router.get("/claims")
def list_claims(
    db: Session = Depends(get_db),
    limit: int = Query(40, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    total = db.scalar(select(func.count(PrizeClaim.id))) or 0
    pending = db.scalar(select(func.count(PrizeClaim.id)).where(PrizeClaim.status == "pending")) or 0
    rows = db.scalars(
        select(PrizeClaim).order_by(PrizeClaim.created_at.desc()).limit(limit).offset(offset)
    ).all()
    return {
        "rows": [claim_public(row) for row in rows],
        "total": int(total),
        "pending": int(pending),
        "limit": limit,
        "offset": offset,
    }


@router.patch("/claims/{claim_id}")
async def update_claim(claim_id: int, payload: ClaimStatusIn, db: Session = Depends(get_db)) -> dict:
    claim = db.get(PrizeClaim, claim_id)
    if claim is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Claim not found.")
    claim.status = payload.status
    claim.note = payload.note[:240]
    db.commit()
    from ..events import to_student

    await dispatch(
        [
            to_student(
                claim.student_id,
                "claim_updated",
                {"prize": claim.prize.title, "status": claim.status, "note": claim.note},
            )
        ]
    )
    return claim_public(claim)


@router.get("/badges")
def admin_badges(db: Session = Depends(get_db)) -> dict:
    badges = db.scalars(select(Badge)).all()
    counts = dict(db.execute(select(StudentBadge.badge_id, func.count(StudentBadge.id)).group_by(StudentBadge.badge_id)).all())
    return {
        "badges": [badge_public(b) for b in badges],
        "awarded": {b.key: int(counts.get(b.id, 0)) for b in badges},
    }


@router.get("/admins")
def list_admins(db: Session = Depends(get_db)) -> list[dict]:
    return [
        {"id": a.id, "email": a.email, "name": a.name, "role": a.role, "created_at": iso(a.created_at)}
        for a in db.scalars(select(Admin)).all()
    ]


# ---------------------------------------------------------------------------
# arena events
# ---------------------------------------------------------------------------
def _event_or_404(db: Session, event_id: int) -> ArenaEvent:
    event = db.get(ArenaEvent, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found.")
    return event


@router.get("/events")
def admin_list_events(
    db: Session = Depends(get_db),
    limit: int = Query(40, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    from ..services.events import event_public

    total = db.scalar(select(func.count(ArenaEvent.id))) or 0
    rows = db.scalars(
        select(ArenaEvent).order_by(ArenaEvent.starts_at.desc()).limit(limit).offset(offset)
    ).all()
    return {
        "events": [event_public(db, row, None) for row in rows],
        "total": int(total),
        "limit": limit,
        "offset": offset,
    }


@router.post("/events")
def admin_create_event(payload: EventCreateInUtc, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    from ..services.events import event_public

    if payload.ends_at <= payload.starts_at:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The event must end after it starts.")
    event = ArenaEvent(
        name=payload.name.strip(),
        description=payload.description,
        course_id=payload.course_id,
        topics=payload.topics,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        question_count=payload.question_count,
        time_mode=payload.time_mode,
        duration_minutes=payload.duration_minutes,
        per_question_seconds=payload.per_question_seconds,
        entry_xp=payload.entry_xp,
        visibility=payload.visibility,
        rewards=payload.rewards,
        banner=payload.banner,
        scoring_note=payload.scoring_note,
        allow_join_during=payload.allow_join_during,
        allow_leave=payload.allow_leave,
        leaderboard_visible=payload.leaderboard_visible,
        status="scheduled",
        created_by=admin.email,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return {"event": event_public(db, event, None)}


@router.patch("/events/{event_id}")
def admin_update_event(
    event_id: int,
    payload: EventUpdateInUtc,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_admin),
) -> dict:
    from ..services.events import event_public

    event = _event_or_404(db, event_id)
    if event.status == "finished":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This event already finished.")
    data = payload.model_dump(exclude_unset=True)
    if "starts_at" in data or "ends_at" in data:
        starts = data.get("starts_at", event.starts_at)
        ends = data.get("ends_at", event.ends_at)
        if ends <= starts:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "The event must end after it starts.")
    for field, value in data.items():
        setattr(event, field, value)
    db.commit()
    db.refresh(event)
    return {"event": event_public(db, event, None)}


@router.delete("/events/{event_id}")
def admin_delete_event(event_id: int, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    event = _event_or_404(db, event_id)
    if event.status == "live":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cancel the event before deleting it.")
    db.delete(event)
    db.commit()
    return {"ok": True}
