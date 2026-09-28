"""AI core API.

Students  /api/ai/mini-exams…       real, timed mini exams (AI- or self-made)
Staff     /api/admin/ai/agent        the staff assistant (tool-using, proposal-only)
          /api/admin/ai/proposals…   review AI proposals (approve / reject)
          /api/admin/ai/tool-calls   audit trail of every tool the AI used
          /api/admin/ai/usage        cost + cache-hit tracking (students + staff)
          /api/admin/ai/insights     course health from the staff tools — no AI call, no cost
          /api/admin/ai/tasks…       background bulk jobs (read materials → topics → map
                                     every question → generate up to 1000 questions)
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
from ..models import Admin, AIProposal, AITask, AIStaffUsage, AIToolCall, AIUsageEvent, Attempt, Config, Course, CourseTopic, Material, Question, Quiz, Student
from ..services import ai_core
from ..services import ai_providers as providers
from ..services import ai_tutor as tutor
from ..services import mini_exam
from ..services.ai_core import admin_tools, proposals, registry, tasks

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
    return db.execute(select(func.count(AIStaffUsage.id)).where(AIStaffUsage.admin_id == admin.id, AIStaffUsage.created_at >= since, AIStaffUsage.status == "ok", AIStaffUsage.kind != "ADMIN_TASK")).scalar_one()


def _record_staff(db: Session, admin: Admin, *, request_id: str, model: str, provider: str, usage: dict | None, latency: int, status_: str = "ok", error: str = "") -> dict:
    usage = usage or {}
    tokens_in, tokens_out, cached = int(usage.get("input") or 0), int(usage.get("output") or 0), int(usage.get("cached") or 0)
    cost = providers.estimate_cost(provider, model, usage)
    db.add(AIStaffUsage(admin_id=admin.id, request_id=request_id, provider=provider, model=model, input_tokens=tokens_in, output_tokens=tokens_out, cache_hit_tokens=cached, cache_miss_tokens=max(0, tokens_in - cached), estimated_cost=cost, latency_ms=latency, status=status_, error=error[:300]))
    return {"input": tokens_in, "output": tokens_out, "cached": cached, "cost": cost}


def _spend(db: Session, cfg: Config | None) -> dict:
    """Students + staff spend today and this month (UTC), against the monthly budget."""
    now = tutor.utcnow()
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month = midnight.replace(day=1)

    def total(since) -> float:
        a = db.execute(select(func.coalesce(func.sum(AIUsageEvent.estimated_cost), 0.0)).where(AIUsageEvent.created_at >= since)).scalar_one()
        b = db.execute(select(func.coalesce(func.sum(AIStaffUsage.estimated_cost), 0.0)).where(AIStaffUsage.created_at >= since)).scalar_one()
        return round(float(a or 0) + float(b or 0), 4)

    requests_today = db.execute(select(func.count(AIUsageEvent.id)).where(AIUsageEvent.created_at >= midnight)).scalar_one()
    staff_today = db.execute(select(func.count(AIStaffUsage.id)).where(AIStaffUsage.created_at >= midnight)).scalar_one()
    return {
        "cost_today": total(midnight), "cost_month": total(month),
        "budget_month": float(getattr(cfg, "ai_monthly_budget_usd", 0) or 0) if cfg else 0.0,
        "requests_today": int(requests_today or 0) + int(staff_today or 0),
    }


@admin_router.get("/status")
def staff_ai_status(db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    impl, model = tutor.ai_target(db)
    cfg = db.get(Config, 1)
    pending = db.execute(select(func.count(AIProposal.id)).where(AIProposal.status == "pending")).scalar_one()
    return {
        "configured": impl.configured(), "provider": impl.label, "model": model,
        "agent_enabled": bool(getattr(cfg, "ai_agent_enabled", True)) if cfg else True,
        "pending_proposals": pending, "used_today": _staff_today(db, admin), "daily_limit": int(getattr(cfg, "ai_staff_daily_limit", 200) or 0) if cfg else 200,
        **_spend(db, cfg),
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
    if any(a.get("type") == "task" for a in ctx.actions):
        tasks.kick()
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


# ================================================================ insights
_SEVERITY_WEIGHT = {"high": 14, "medium": 7, "low": 3}


def _issue(out: list, key: str, severity: str, title: str, detail: str, prompt: str, action: str, count: int | None = None) -> None:
    out.append({"id": key, "severity": severity, "title": title, "detail": detail, "prompt": prompt, "action": action, "count": count})


def _course_cards(db: Session) -> list[dict]:
    courses = db.execute(select(Course).order_by(Course.code)).scalars().all()
    bank = dict(db.execute(select(Question.course_id, func.count(Question.id)).where(Question.source_id.is_(None), Question.exam_only.is_(False)).group_by(Question.course_id)).all())
    topics = dict(db.execute(select(CourseTopic.course_id, func.count(CourseTopic.id)).group_by(CourseTopic.course_id)).all())
    materials = dict(db.execute(select(Material.course_id, func.count(Material.id)).where(Material.kind != "folder").group_by(Material.course_id)).all())
    pending = dict(db.execute(select(AIProposal.course_id, func.count(AIProposal.id)).where(AIProposal.status == "pending").group_by(AIProposal.course_id)).all())
    attempts = dict(db.execute(select(Quiz.course_id, func.count(Attempt.id)).join(Quiz, Quiz.id == Attempt.quiz_id).where(Attempt.status != "in_progress").group_by(Quiz.course_id)).all())
    return [{
        "id": c.id, "code": c.code, "title": c.title, "active": c.is_active, "bank": int(bank.get(c.id, 0)), "topics": int(topics.get(c.id, 0)),
        "materials": int(materials.get(c.id, 0)), "pending": int(pending.get(c.id, 0)), "attempts": int(attempts.get(c.id, 0)),
    } for c in courses]


@admin_router.get("/insights")
def insights(course_id: int | None = None, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    """What needs attention in a course, straight from the staff tools (no AI, free).

    Every issue carries a ready-made prompt so the console can hand it to the
    assistant ("Fix with AI") — which still only *proposes* changes."""
    cards = _course_cards(db)
    if not course_id:
        return {"courses": cards}
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found.")
    ctx = ai_core.ToolContext(db=db, role=_role(admin), request_id="insights", admin=admin, course_hint=course.id)
    overview = admin_tools.get_course_overview(ctx, {"course_id": course.id})
    health = admin_tools.analyze_question_bank(ctx, {"course_id": course.id})
    try:
        performance = admin_tools.get_class_performance(ctx, {"course_id": course.id})
    except Exception:  # noqa: BLE001 — results are optional context
        log.exception("insights: class performance failed")
        performance = {"attempts": 0, "average_percentage": 0, "topics": [], "flagged_questions": [], "summary": {}}

    warn = health.get("warnings", {})
    total = int(health.get("total") or 0)
    code = course.code
    issues: list[dict] = []
    if total == 0:
        _issue(issues, "empty_bank", "high", "The question bank is empty", "Exams drawn from the bank can't run until it has questions.",
               f"Read the materials for {code} and draft 12 good questions across the main topics, with explanations.", "Draft questions")
    elif total < 30:
        _issue(issues, "small_bank", "medium", f"Only {total} questions in the bank", "Random-draw exams repeat questions quickly below ~30.",
               f"Draft 10 more questions for {code}, focusing on the topics with the fewest questions. Include explanations.", "Grow the bank", total)
    if warn.get("broken"):
        _issue(issues, "broken", "high", f"{warn['broken']} broken question{'s' if warn['broken'] != 1 else ''}", "Missing options or an answer key that doesn't match an option.",
               f"Find the broken questions in {code} (missing options or invalid answer key) and propose fixes.", "Propose fixes", warn["broken"])
    flagged = performance.get("flagged_questions") or []
    wrong_key = [q for q in flagged if any("key" in str(f).lower() for f in (q.get("flags") or []))]
    if wrong_key:
        _issue(issues, "wrong_key", "high", f"{len(wrong_key)} question{'s' if len(wrong_key) != 1 else ''} may have the wrong answer", "Strong students keep choosing a different option.",
               f"Check the flagged questions in {code} that may have a wrong answer key. Explain the evidence for each and tell me what to change.", "Investigate", len(wrong_key))
    if warn.get("untagged"):
        _issue(issues, "untagged", "medium", f"{warn['untagged']} question{'s' if warn['untagged'] != 1 else ''} without a topic", "Untagged questions don't count towards topic coverage or weak-topic practice.",
               f"Classify the questions in {code} that have no topic (topic + difficulty) and propose the classification.", "Classify with AI", warn["untagged"])
    if warn.get("no_explanation"):
        n = int(warn["no_explanation"])
        _issue(issues, "no_explanation", "medium" if n > 5 else "low", f"{n} question{'s' if n != 1 else ''} without an explanation", "Students only see right/wrong, not why.",
               f"Which questions in {code} have no explanation? Draft short, accurate explanations for up to 10 of them as a proposal.", "Draft explanations", n)
    dup = health.get("duplicates") or []
    if dup:
        _issue(issues, "duplicates", "medium", f"{len(dup)} likely duplicate pair{'s' if len(dup) != 1 else ''}", "Duplicates inflate the bank and repeat in random draws.",
               f"List the near-duplicate questions in {code} and recommend which of each pair to keep and why.", "Review duplicates", len(dup))
    empty_topics = health.get("curated_without_questions") or []
    if empty_topics:
        _issue(issues, "empty_topics", "medium", f"{len(empty_topics)} topic{'s' if len(empty_topics) != 1 else ''} with no questions", ", ".join(empty_topics[:4]) + ("…" if len(empty_topics) > 4 else ""),
               f"Draft 5 questions each for these {code} topics that have none yet: {', '.join(empty_topics[:5])}.", "Fill the gaps", len(empty_topics))
    thin = [t for t in (warn.get("low_pool_topics") or []) if t.get("topic") not in empty_topics]
    if thin:
        _issue(issues, "thin_topics", "low", f"{len(thin)} thin topic{'s' if len(thin) != 1 else ''}", ", ".join(f"{t['topic']} ({t['count']})" for t in thin[:4]),
               f"Draft 4 more questions each for the thinnest topics in {code}: {', '.join(t['topic'] for t in thin[:4])}.", "Strengthen", len(thin))
    if not overview["topics"] and (overview["materials"] or total):
        source = "course materials" if overview["materials"] else "topics already used by the question bank"
        _issue(issues, "no_topics", "medium", "No curated topic list", "Topics organise materials, questions and students' weak-topic reports.",
               f"Using the {source} for {code}, propose a clean topic list with short descriptions.", "Propose topics")
    stray = health.get("question_topics_not_curated") or []
    if stray and overview["topics"]:
        _issue(issues, "stray_topics", "low", f"{len(stray)} question topic{'s' if len(stray) != 1 else ''} not in the topic list", ", ".join(stray[:4]),
               f"These question topics in {code} aren't in the curated topic list: {', '.join(stray[:8])}. Propose whether to add them as topics or reclassify the questions.", "Tidy topics", len(stray))
    levels = health.get("by_difficulty") or {}
    if total >= 20:
        low = [lvl for lvl in ("easy", "medium", "hard") if levels.get(lvl, 0) / total < 0.12]
        if low:
            _issue(issues, "difficulty", "low", f"Few {' & '.join(low)} questions", "A balanced bank gives fairer random draws.",
                   f"Draft 6 {low[0]} questions for {code} spread across its topics.", f"Add {low[0]}")
    if not overview["materials"]:
        _issue(issues, "no_materials", "low", "No materials yet", "The AI grounds answers and new questions in course materials first.",
               f"What materials would you recommend for {code} — {course.title}? Suggest a reading structure by topic.", "Plan materials")
    weak_topics = [t for t in performance.get("topics") or [] if t.get("accuracy") is not None and t["accuracy"] < 50 and t.get("answers", 0) >= 5]
    if weak_topics:
        _issue(issues, "weak_class", "medium", f"Class struggles with {weak_topics[0]['topic']}", f"{weak_topics[0]['accuracy']}% accuracy" + (f" · +{len(weak_topics) - 1} more weak topic(s)" if len(weak_topics) > 1 else ""),
               f"How is the class doing in {code}? Explain why students struggle with {weak_topics[0]['topic']} and draft 6 practice questions that target the misconceptions.", "Plan a fix", len(weak_topics))

    order = {"high": 0, "medium": 1, "low": 2}
    issues.sort(key=lambda i: order[i["severity"]])
    score = max(0, min(100, 100 - sum(_SEVERITY_WEIGHT[i["severity"]] for i in issues)))
    topic_counts = {row["topic"]: row["count"] for row in health.get("by_topic") or []}
    coverage = [{"topic": t["name"], "questions": int(topic_counts.get(t["name"], 0)), "curated": True} for t in overview["topics"]]
    curated_lower = {t["name"].lower() for t in overview["topics"]}
    coverage += [{"topic": k, "questions": int(v), "curated": False} for k, v in topic_counts.items() if k.lower() not in curated_lower]
    return {
        "course": overview["course"], "courses": cards, "score": score, "issues": issues,
        "bank": {"total": total, "by_difficulty": levels, "by_status": health.get("by_status") or {}, "drafts": int(warn.get("drafts") or 0), "flagged": int(warn.get("flagged") or 0)},
        "coverage": sorted(coverage, key=lambda r: (-r["questions"], r["topic"]))[:24],
        "materials": {"total": len(overview["materials"]), "published": sum(1 for m in overview["materials"] if m["status"] == "published")},
        "exams": {"total": len(overview["exams"]), "live": sum(1 for e in overview["exams"] if e["status"] in {"published", "live", "active"})},
        "topics": len(overview["topics"]),
        "performance": {"attempts": int(performance.get("attempts") or 0), "average": performance.get("average_percentage") or 0,
                        "topics": (performance.get("topics") or [])[:8], "flagged": flagged[:6]},
        "weakest": health.get("weakest", [])[:5], "most_missed": health.get("most_missed", [])[:5], "duplicates": dup[:5],
    }


# ------------------------------------------------------------------ tasks
def _task_err(error: tasks.TaskError) -> HTTPException:
    return HTTPException(error.status, error.message)


def _task_course(db: Session, payload: dict) -> Course:
    course = db.get(Course, int(payload.get("course_id") or 0))
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pick a course first.")
    return course


@admin_router.get("/tasks")
def list_tasks(course_id: int | None = None, limit: int = Query(30, ge=1, le=100), db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    stmt = select(AITask).order_by(AITask.id.desc()).limit(limit)
    if course_id:
        stmt = stmt.where(AITask.course_id == course_id)
    codes = dict(db.execute(select(Course.id, Course.code)).all())
    rows = db.execute(stmt).scalars().all()
    pending = dict(db.execute(select(AIProposal.id, AIProposal.status).where(AIProposal.id.in_([p["id"] for t in rows for p in (t.result or {}).get("proposals", [])] or [0]))).all())
    out = []
    for t in rows:
        item = {**tasks.public(t), "course": codes.get(t.course_id)}
        item["proposals"] = [{**p, "status": pending.get(p["id"], "missing")} for p in (t.result or {}).get("proposals", [])]
        out.append(item)
    return {"tasks": out, "limits": {"max_questions": tasks.MAX_QUESTIONS, "default_max_cost": tasks.default_max_cost(), "hard_max_cost": tasks.HARD_MAX_COST, "workers": tasks.workers()}}


@admin_router.post("/tasks/estimate")
def estimate_task(payload: dict, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    course = _task_course(db, payload)
    try:
        params = tasks.clean_params(db, course, payload)
    except tasks.TaskError as error:
        raise _task_err(error) from error
    return {"estimate": tasks.estimate(db, course, params), "params": params, "title": tasks.describe(params, course)}


@admin_router.post("/tasks", status_code=202)
def create_task(payload: dict, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    course = _task_course(db, payload)
    try:
        task = tasks.create(db, admin, course, payload)
    except tasks.TaskError as error:
        db.rollback()
        raise _task_err(error) from error
    db.commit()
    tasks.kick()
    return {**tasks.public(task, full=True), "course": course.code, "proposals": []}


@admin_router.get("/tasks/{task_id}")
def get_task(task_id: int, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    t = db.get(AITask, task_id)
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found.")
    course = db.get(Course, t.course_id) if t.course_id else None
    ids = [p["id"] for p in (t.result or {}).get("proposals", [])]
    states = dict(db.execute(select(AIProposal.id, AIProposal.status).where(AIProposal.id.in_(ids or [0]))).all())
    return {**tasks.public(t, full=True), "course": course.code if course else None,
            "proposals": [{**p, "status": states.get(p["id"], "missing")} for p in (t.result or {}).get("proposals", [])]}


@admin_router.post("/tasks/{task_id}/cancel")
def cancel_task(task_id: int, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    t = db.get(AITask, task_id)
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found.")
    try:
        tasks.cancel(db, t)
    except tasks.TaskError as error:
        raise _task_err(error) from error
    db.commit()
    return tasks.public(t)


@admin_router.post("/tasks/{task_id}/approve-all")
def approve_task(task_id: int, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    """Staff approve every pending proposal a task produced, in a safe order
    (topics first, then material tags, question mapping, new questions)."""
    t = db.get(AITask, task_id)
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found.")
    order = {"topics": 0, "material_topics": 1, "classification": 2, "questions": 3}
    ids = [p["id"] for p in (t.result or {}).get("proposals", [])]
    rows = sorted(db.execute(select(AIProposal).where(AIProposal.id.in_(ids or [0]), AIProposal.status == "pending")).scalars(), key=lambda p: (order.get(p.kind, 9), p.id))
    if not rows:
        raise HTTPException(status.HTTP_409_CONFLICT, "Nothing left to approve for this task.")
    summary = {"approved": 0, "topics": 0, "questions": 0, "classified": 0, "materials": 0, "errors": []}
    for p in rows:
        try:
            result = proposals.approve(db, p, admin)
        except proposals.ProposalError as error:
            summary["errors"].append(f"#{p.id}: {error.message}")
            continue
        summary["approved"] += 1
        key = {"topics": "topics", "questions": "questions", "classification": "classified", "material_topics": "materials"}[p.kind]
        summary[key] += int(result.get("created") or result.get("updated") or 0)
        summary["errors"] += [f"#{p.id}: {e}" for e in (result.get("errors") or [])[:5]]
    db.commit()
    return summary
