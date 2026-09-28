"""AI core API.

Students  /api/ai/mini-exams…       real, timed mini exams (AI- or self-made)
Staff     /api/admin/ai/agent        the staff assistant (tool-using, proposal-only)
          /api/admin/ai/proposals…   review AI proposals (approve / reject)
          /api/admin/ai/tool-calls   audit trail of every tool the AI used
          /api/admin/ai/usage        cost + cache-hit tracking (students + staff)
"""

from __future__ import annotations

import logging
import time
import uuid
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_admin, require_student
from ..models import Admin, AIProposal, AIStaffUsage, AIToolCall, AIUsageEvent, Config, Course, Student
from ..services import ai_core
from ..services import ai_providers as providers
from ..services import ai_tutor as tutor
from ..services import mini_exam
from ..services.ai_core import proposals, registry

log = logging.getLogger("arena.ai")

router = APIRouter(prefix="/ai/mini-exams", tags=["ai-mini-exams"])
admin_router = APIRouter(prefix="/admin/ai", tags=["ai-core-staff"])


def _err(error: mini_exam.MiniExamError | proposals.ProposalError) -> HTTPException:
    return HTTPException(error.status, error.message)


# ================================================================ students
@router.get("")
def list_mini_exams(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    rows = mini_exam.list_for(db, student)
    db.commit()
    return {"mini_exams": rows}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_mini_exam(payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """Self-serve: the student picks course / topics / size (no AI call needed)."""
    try:
        course_id = int(payload.get("course_id") or 0) or None
        topics = [str(t)[:120] for t in (payload.get("topics") or []) if str(t).strip()][:6]
        exam = mini_exam.create(
            db, student, course_id=course_id, topics=topics or None, difficulty=str(payload.get("difficulty") or "mixed"),
            count=int(payload.get("question_count") or 10), minutes=int(payload["duration_minutes"]) if payload.get("duration_minutes") else None,
            focus=str(payload.get("focus") or "mixed") if payload.get("focus") in {"mixed", "weak", "new"} else "mixed",
            title=str(payload.get("title") or ""), created_by="student",
        )
    except mini_exam.MiniExamError as error:
        db.rollback()
        raise _err(error) from error
    except (TypeError, ValueError) as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Check the numbers and try again.") from error
    db.commit()
    return mini_exam.payload(db, exam)


@router.get("/{exam_id}")
def get_mini_exam(exam_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    try:
        exam = mini_exam.owned(db, student, exam_id)
    except mini_exam.MiniExamError as error:
        raise _err(error) from error
    db.commit()
    return mini_exam.payload(db, exam)


@router.post("/{exam_id}/start")
def start_mini_exam(exam_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    try:
        exam = mini_exam.start(db, student, mini_exam.owned(db, student, exam_id))
    except mini_exam.MiniExamError as error:
        db.rollback()
        raise _err(error) from error
    db.commit()
    return mini_exam.payload(db, exam)


@router.post("/{exam_id}/answer")
def answer_mini_exam(exam_id: int, payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    try:
        exam = mini_exam.owned(db, student, exam_id)
        item = mini_exam.answer(db, exam, int(payload.get("question_id") or 0), payload.get("selected"), float(payload.get("seconds") or 0))
    except mini_exam.MiniExamError as error:
        db.commit()  # keep an auto-close that settle() may have done
        raise _err(error) from error
    except (TypeError, ValueError) as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Bad answer payload.") from error
    db.commit()
    return {"question_id": item.question_id, "selected": item.selected, "answered": sum(1 for i in exam.items if i.selected), "seconds_left": mini_exam.payload(db, exam, questions=False)["seconds_left"]}


@router.post("/{exam_id}/finish")
def finish_mini_exam(exam_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    try:
        exam = mini_exam.owned(db, student, exam_id)
    except mini_exam.MiniExamError as error:
        raise _err(error) from error
    if exam.status == "ready":
        raise HTTPException(status.HTTP_409_CONFLICT, "Start the mini exam first.")
    mini_exam.finish(db, exam, reason="early")
    tutor.refresh_topic_progress(db, student)  # the learning profile updates straight away
    db.commit()
    return mini_exam.payload(db, exam)


@router.get("/{exam_id}/result")
def mini_exam_result(exam_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    data = get_mini_exam(exam_id, db, student)
    if data["status"] not in {"submitted", "expired"}:
        raise HTTPException(status.HTTP_409_CONFLICT, "This mini exam isn't finished yet.")
    return data


@router.post("/{exam_id}/feedback")
def mini_exam_feedback(exam_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """The AI's written feedback on a finished exam (written once, then cached)."""
    try:
        exam = mini_exam.owned(db, student, exam_id)
    except mini_exam.MiniExamError as error:
        raise _err(error) from error
    if exam.status != "submitted":
        raise HTTPException(status.HTTP_409_CONFLICT, "Feedback is available once the exam is submitted.")
    if (exam.analysis or {}).get("ai"):
        return {"feedback": exam.analysis["ai"], "cached": True}
    cfg = db.get(Config, 1)
    if cfg is not None and not getattr(cfg, "ai_exam_feedback", True):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "AI feedback is switched off.")
    try:
        lim = tutor.check_limits(db, student, 0)
    except tutor.TutorError as error:
        raise HTTPException(error.status, str(error)) from error
    course = db.get(Course, exam.course_id) if exam.course_id else None
    messages = mini_exam.narrative_messages(exam, f"{course.code} {course.title}" if course else "Mixed")
    started = time.monotonic()
    try:
        text, usage, model = tutor.complete(messages, max_tokens=min(900, lim["max_response_tokens"]), json_mode=True, db=db)
        data = tutor.parse_json(text)
    except tutor.TutorError as error:
        tutor.record_usage(db, student.id, kind="EXAM_FEEDBACK", model="", usage=None, latency_ms=int((time.monotonic() - started) * 1000), status="error", error=error.technical, course_id=exam.course_id)
        db.commit()
        raise HTTPException(error.status, str(error)) from error
    clean = lambda v, n: str(v or "").strip()[:n]  # noqa: E731
    feedback = {
        "headline": clean(data.get("headline"), 200),
        "summary": clean(data.get("summary"), 900),
        "mistake_patterns": [clean(x, 200) for x in (data.get("mistake_patterns") or []) if clean(x, 200)][:3],
        "recommended_actions": [clean(x, 200) for x in (data.get("recommended_actions") or []) if clean(x, 200)][:4],
    }
    exam.analysis = {**(exam.analysis or {}), "ai": feedback}
    tutor.record_usage(db, student.id, kind="EXAM_FEEDBACK", model=model, usage=usage, latency_ms=int((time.monotonic() - started) * 1000), course_id=exam.course_id, output_chars=len(text))
    db.commit()
    return {"feedback": feedback, "cached": False}


@router.delete("/{exam_id}")
def delete_mini_exam(exam_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    try:
        exam = mini_exam.owned(db, student, exam_id)
    except mini_exam.MiniExamError as error:
        raise _err(error) from error
    if exam.status == "in_progress":
        raise HTTPException(status.HTTP_409_CONFLICT, "Finish the exam before deleting it.")
    db.delete(exam)
    db.commit()
    return {"ok": True}


# =================================================================== staff
def _role(admin: Admin) -> str:
    return admin.role if admin.role in registry.STAFF_ROLES else registry.STAFF


def _staff_today(db: Session, admin: Admin) -> int:
    since = tutor.utcnow() - timedelta(days=1)
    return db.execute(select(func.count(AIStaffUsage.id)).where(AIStaffUsage.admin_id == admin.id, AIStaffUsage.created_at >= since, AIStaffUsage.status == "ok")).scalar_one()


def _record_staff(db: Session, admin: Admin, *, request_id: str, model: str, provider: str, usage: dict | None, latency: int, status_: str = "ok", error: str = "") -> dict:
    usage = usage or {}
    tokens_in, tokens_out, cached = int(usage.get("input") or 0), int(usage.get("output") or 0), int(usage.get("cached") or 0)
    cost = providers.estimate_cost(provider, model, usage)
    db.add(AIStaffUsage(admin_id=admin.id, request_id=request_id, provider=provider, model=model, input_tokens=tokens_in, output_tokens=tokens_out, cache_hit_tokens=cached, cache_miss_tokens=max(0, tokens_in - cached), estimated_cost=cost, latency_ms=latency, status=status_, error=error[:300]))
    return {"input": tokens_in, "output": tokens_out, "cached": cached, "cost": cost}


@admin_router.get("/status")
def staff_ai_status(db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    impl, model = tutor.ai_target(db)
    cfg = db.get(Config, 1)
    pending = db.execute(select(func.count(AIProposal.id)).where(AIProposal.status == "pending")).scalar_one()
    return {
        "configured": impl.configured(), "provider": impl.label, "model": model,
        "agent_enabled": bool(getattr(cfg, "ai_agent_enabled", True)) if cfg else True,
        "pending_proposals": pending, "used_today": _staff_today(db, admin), "daily_limit": int(getattr(cfg, "ai_staff_daily_limit", 200) or 0) if cfg else 200,
        "tools": {"student": registry.names_for(registry.STUDENT), "staff": registry.names_for(_role(admin))},
    }


@admin_router.post("/agent")
def staff_agent(payload: dict, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    """One assistant turn. The console keeps the visible thread and sends the
    recent turns back (max 12); the server adds the rules and the tools."""
    impl, _model = tutor.ai_target(db)
    if not impl.configured():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Add an AI key in AI Tutor settings first.")
    cfg = db.get(Config, 1)
    limit = int(getattr(cfg, "ai_staff_daily_limit", 200) or 0) if cfg else 200
    if limit and _staff_today(db, admin) >= limit:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, f"You've used today's {limit} assistant requests.")
    turns = [m for m in (payload.get("messages") or []) if isinstance(m, dict) and m.get("role") in {"user", "assistant"} and str(m.get("content") or "").strip()][-12:]
    if not turns or turns[-1]["role"] != "user":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Type a request first.")
    course_id = int(payload.get("course_id") or 0) or None
    course = db.get(Course, course_id) if course_id else None
    system = ai_core.ADMIN_SYSTEM + (f"\n\nCURRENT COURSE\nThe staff member is working in {course.code} — {course.title} (course_id {course.id})." if course else "")
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}, *({"role": m["role"], "content": str(m["content"])[:6000]} for m in turns)]
    request_id = uuid.uuid4().hex[:16]
    ctx = ai_core.ToolContext(db=db, role=_role(admin), request_id=request_id, admin=admin, course_hint=course.id if course else None)
    started = time.monotonic()
    text, usage, model, tools = "", None, "", []
    try:
        for kind, value in ai_core.run(ctx, messages, max_steps=max(3, int(getattr(cfg, "ai_agent_max_steps", 5) or 5) + 1), max_tokens=3000, temperature=0.3):
            if kind == "tool_done":
                tools.append(value)
            elif kind == "usage":
                usage = value
            elif kind == "model":
                model = value
            elif kind == "final":
                text = value
    except tutor.TutorError as error:
        db.rollback()
        _record_staff(db, admin, request_id=request_id, model=model, provider=impl.name, usage=usage, latency=int((time.monotonic() - started) * 1000), status_="error", error=error.technical)
        db.commit()
        raise HTTPException(error.status, str(error)) from error
    cost = _record_staff(db, admin, request_id=request_id, model=model, provider=impl.name, usage=usage, latency=int((time.monotonic() - started) * 1000))
    db.commit()
    return {"reply": text, "tools": tools, "actions": ctx.actions, "usage": cost, "request_id": request_id}


@admin_router.get("/proposals")
def list_proposals(status_: str = Query("pending", alias="status"), course_id: int | None = None, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    stmt = select(AIProposal).order_by(AIProposal.created_at.desc()).limit(100)
    if status_ in {"pending", "approved", "rejected"}:
        stmt = stmt.where(AIProposal.status == status_)
    if course_id:
        stmt = stmt.where(AIProposal.course_id == course_id)
    rows = db.execute(stmt).scalars().all()
    codes = dict(db.execute(select(Course.id, Course.code)).all())
    return {"proposals": [{**proposals.public(p), "course": codes.get(p.course_id)} for p in rows]}


@admin_router.get("/proposals/{proposal_id}")
def get_proposal(proposal_id: int, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    p = db.get(AIProposal, proposal_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proposal not found.")
    course = db.get(Course, p.course_id) if p.course_id else None
    return {**proposals.public(p, full=True), "course": course.code if course else None}


@admin_router.post("/proposals/{proposal_id}/approve")
def approve_proposal(proposal_id: int, payload: dict | None = None, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    p = db.get(AIProposal, proposal_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proposal not found.")
    payload = payload or {}
    selected = payload.get("selected") if isinstance(payload.get("selected"), list) else None
    edited = payload.get("items") if isinstance(payload.get("items"), list) else None
    try:
        result = proposals.approve(db, p, admin, selected=selected, edited=edited)
    except proposals.ProposalError as error:
        db.rollback()
        raise _err(error) from error
    db.commit()
    return {**proposals.public(p), "result": result}


@admin_router.post("/proposals/{proposal_id}/reject")
def reject_proposal(proposal_id: int, payload: dict | None = None, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    p = db.get(AIProposal, proposal_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proposal not found.")
    try:
        proposals.reject(db, p, admin, str((payload or {}).get("reason") or ""))
    except proposals.ProposalError as error:
        raise _err(error) from error
    db.commit()
    return proposals.public(p)


@admin_router.get("/tool-calls")
def tool_calls(limit: int = Query(60, ge=1, le=300), db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    rows = db.execute(select(AIToolCall).order_by(AIToolCall.id.desc()).limit(limit)).scalars().all()
    return {"calls": [{"id": r.id, "tool": r.tool, "role": r.actor_role, "student_id": r.student_id, "admin_id": r.admin_id, "status": r.status, "summary": r.summary, "ms": r.latency_ms, "arguments": r.arguments, "at": r.created_at.isoformat()} for r in rows]}


@admin_router.get("/usage")
def ai_usage(days: int = Query(30, ge=1, le=365), db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    """Cost per feature and per day, with cache hit/miss tokens (students + staff)."""
    since = tutor.utcnow() - timedelta(days=days)
    by_kind = db.execute(
        select(AIUsageEvent.kind, func.count(AIUsageEvent.id), func.sum(AIUsageEvent.input_tokens), func.sum(AIUsageEvent.output_tokens), func.sum(AIUsageEvent.cache_hit_tokens), func.sum(AIUsageEvent.estimated_cost))
        .where(AIUsageEvent.created_at >= since).group_by(AIUsageEvent.kind)
    ).all()
    staff = db.execute(
        select(func.count(AIStaffUsage.id), func.sum(AIStaffUsage.input_tokens), func.sum(AIStaffUsage.output_tokens), func.sum(AIStaffUsage.cache_hit_tokens), func.sum(AIStaffUsage.estimated_cost)).where(AIStaffUsage.created_at >= since)
    ).one()
    daily = db.execute(select(func.date(AIUsageEvent.created_at), func.sum(AIUsageEvent.estimated_cost), func.count(AIUsageEvent.id)).where(AIUsageEvent.created_at >= since).group_by(func.date(AIUsageEvent.created_at)).order_by(func.date(AIUsageEvent.created_at))).all()
    row = lambda k, n, i, o, c, cost: {"feature": k, "requests": int(n or 0), "input": int(i or 0), "output": int(o or 0), "cache_hit": int(c or 0), "cache_rate": round((c or 0) / i * 100, 1) if i else 0.0, "cost": round(float(cost or 0), 4)}  # noqa: E731
    features = [row(*r) for r in by_kind] + [row("STAFF_ASSISTANT", *staff)]
    return {
        "days": days, "features": sorted(features, key=lambda r: -r["cost"]),
        "total_cost": round(sum(r["cost"] for r in features), 4),
        "daily": [{"day": str(d), "cost": round(float(c or 0), 4), "requests": int(n or 0)} for d, c, n in daily],
    }
