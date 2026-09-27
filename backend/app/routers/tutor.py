"""AI Tutor API.

Student routes live on ``core`` and are mounted twice: ``/api/tutor/*`` (what
the app uses) and ``/api/ai/*`` (the documented public names). Staff routes
are under ``/api/admin/tutor/*``. All AI traffic goes through the server; no
provider key ever reaches the browser, and students only see friendly errors.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
import uuid
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db, session_scope
from ..deps import require_admin, require_student
from ..models import (
    AIConversation,
    AIFeedback,
    AIFlashcard,
    AIFlashcardDeck,
    AIFlashcardReview,
    AIGeneratedQuestion,
    AILearningProfile,
    AIMessage,
    AIPracticeSet,
    AISavedItem,
    AIStudyPlan,
    AIStudyPlanItem,
    AIUsage,
    AIUsageEvent,
    AIUserSetting,
    Config,
    Course,
    CourseTopic,
    Question,
    Student,
)
from ..services import ai_library as library
from ..services import ai_providers as providers
from ..services import ai_tutor as tutor

log = logging.getLogger("arena.ai")

core = APIRouter()
router = APIRouter(prefix="/tutor", tags=["ai-tutor"])
alias_router = APIRouter(prefix="/ai", tags=["ai-tutor"])
admin_router = APIRouter(prefix="/admin/tutor", tags=["ai-tutor-staff"], dependencies=[Depends(require_admin)])

SUMMARY_LENGTHS = {
    "quick": "Make it a QUICK summary: 4-6 bullet points, nothing else.",
    "detailed": "Make it a DETAILED summary: go section by section with headings and the important details.",
    "revision": "Make it REVISION NOTES: exam-focused — key facts, definitions, lists to memorise, common traps.",
}
REWRITE_STYLES = {
    "simpler": "Rewrite your previous answer more simply, for a beginner, in fewer words.",
    "example": "Answer again, this time built around one or two concrete examples.",
    "shorter": "Answer again much more briefly (3-5 lines).",
    "detailed": "Answer again in more depth, step by step.",
}
PROGRESS_WORDS = re.compile(r"\b(weak|wrong|mistake|progress|score|getting|struggl|study next|improve|revise|revision|plan)\w*", re.I)
FEEDBACK_REASONS = {"incorrect", "confusing", "too_long", "too_short", "no_answer", "unsafe", "other"}
_cancels: dict[str, threading.Event] = {}
_cancels_lock = threading.Lock()


def _http(error: Exception) -> HTTPException:
    if isinstance(error, tutor.TutorError):
        return HTTPException(error.status, str(error), headers={"X-Error-Code": error.code})
    if isinstance(error, library.LibraryError):
        return HTTPException(error.status, str(error))
    raise error


def _conversation_row(conv: AIConversation, count: int | None = None, snippet: str | None = None) -> dict:
    return {
        "id": conv.id, "title": conv.title, "course_id": conv.course_id, "topic": conv.topic, "context_type": conv.context_type or "general",
        "archived": conv.archived, "archived_at": conv.archived_at.isoformat() if conv.archived_at else None,
        "created_at": conv.created_at.isoformat(), "last_message_at": conv.last_message_at.isoformat() if conv.last_message_at else None,
        **({"messages": count} if count is not None else {}), **({"snippet": snippet} if snippet else {}),
    }


def _message_row(m: AIMessage, feedback: dict[int, int] | None = None) -> dict:
    out = {"id": m.id, "role": m.role, "content": m.content, "type": m.message_type, "meta": m.meta or {}, "created_at": m.created_at.isoformat()}
    if feedback is not None and m.id in feedback:
        out["feedback"] = feedback[m.id]
    return out


def _own_conversation(db: Session, student: Student, conversation_id: int) -> AIConversation:
    conv = db.get(AIConversation, conversation_id)
    if conv is None or conv.user_id != student.id or conv.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found.")
    return conv


def _status_payload(db: Session, student: Student) -> dict:
    lim = tutor.limits(db, student.id)
    counts = tutor.usage_counts(db, student.id)
    policy = tutor.exam_policy(db, student)
    settings = tutor.tutor_settings(db)
    profile = tutor.learning_profile(db, student)
    return {
        "configured": bool(settings["key"]),
        "enabled": lim["enabled"] and not lim["user_disabled"],
        "user_disabled": lim["user_disabled"],
        "provider": settings["provider_label"],
        "model": settings["model"],
        "limits": {k: lim[k] for k in ("daily", "monthly", "per_minute", "max_message_chars", "max_upload_mb")},
        "usage": counts,
        "remaining_today": tutor.remaining(lim, counts),
        "features": lim["features"],
        "exam": {"active": policy["active"], "mode": policy["mode"] if policy["active"] else None},
        "exam_locked": tutor.exam_lock(db, student),
        "profile": _profile_row(profile),
    }


def _profile_row(profile: AILearningProfile | None) -> dict:
    if profile is None:
        return {"explanation_style": "balanced", "difficulty": "medium", "language": "English", "goals": ""}
    return {"explanation_style": profile.explanation_style, "difficulty": profile.difficulty, "language": profile.language, "goals": profile.goals}


# ------------------------------------------------------------------ status
@core.get("/status")
def tutor_status(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    return _status_payload(db, student)


@core.get("/usage")
def tutor_usage(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    return _status_payload(db, student)


@core.get("/options")
def tutor_options(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    courses = db.execute(select(Course).where(Course.is_active.is_(True)).order_by(Course.code)).scalars().all()
    topics = db.execute(select(CourseTopic).order_by(CourseTopic.course_id, CourseTopic.position, CourseTopic.name)).scalars().all()
    by_course: dict[int, list] = {}
    for topic in topics:
        by_course.setdefault(topic.course_id, []).append({"id": topic.id, "name": topic.name})
    uploads = db.execute(select(AISavedItem).where(AISavedItem.user_id == student.id, AISavedItem.kind == "upload").order_by(AISavedItem.created_at.desc())).scalars().all()
    return {
        "courses": [{"id": c.id, "code": c.code, "title": c.title, "topics": by_course.get(c.id, [])} for c in courses],
        "uploads": [{"id": u.id, "title": u.title, "sections": len((u.data or {}).get("sections", [])), "status": (u.data or {}).get("status", "ready"), "error": (u.data or {}).get("error")} for u in uploads],
    }


@core.get("/profile")
def get_profile(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    return _profile_row(tutor.learning_profile(db, student))


@core.put("/profile")
def put_profile(payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    profile = db.get(AILearningProfile, student.id) or AILearningProfile(user_id=student.id)
    if payload.get("explanation_style") in tutor.STYLE_HINT:
        profile.explanation_style = payload["explanation_style"]
    if payload.get("difficulty") in {"easy", "medium", "hard"}:
        profile.difficulty = payload["difficulty"]
    if "language" in payload:
        profile.language = re.sub(r"[^A-Za-z \-()]", "", str(payload.get("language") or ""))[:40] or "English"
    if "goals" in payload:
        profile.goals = str(payload.get("goals") or "").strip()[:400]
    db.add(profile)
    db.commit()
    return _profile_row(profile)


# ----------------------------------------------------------- conversations
@core.get("/conversations")
def list_conversations(
    archived: bool = Query(False), q: str = Query("", max_length=120), db: Session = Depends(get_db), student: Student = Depends(require_student)
) -> dict:
    stmt = (
        select(AIConversation, func.count(AIMessage.id))
        .outerjoin(AIMessage, AIMessage.conversation_id == AIConversation.id)
        .where(AIConversation.user_id == student.id, AIConversation.deleted_at.is_(None))
        .group_by(AIConversation.id)
        .order_by(AIConversation.last_message_at.desc())
        .limit(200)
    )
    snippets: dict[int, str] = {}
    term = q.strip()
    if term:
        like = f"%{term.lower()}%"
        hits = db.execute(
            select(AIMessage.conversation_id, AIMessage.content)
            .join(AIConversation, AIConversation.id == AIMessage.conversation_id)
            .where(AIConversation.user_id == student.id, AIMessage.user_id == student.id, AIConversation.deleted_at.is_(None), func.lower(AIMessage.content).like(like))
            .limit(400)
        ).all()
        for conv_id, content in hits:
            if conv_id not in snippets:
                low = content.lower()
                at = max(0, low.find(term.lower()) - 40)
                snippets[conv_id] = ("…" if at else "") + re.sub(r"\s+", " ", content[at : at + 120]).strip() + "…"
        stmt = stmt.where(or_(func.lower(AIConversation.title).like(like), AIConversation.id.in_(list(snippets) or [-1])))
    else:
        stmt = stmt.where(AIConversation.archived.is_(archived))
    rows = db.execute(stmt).all()
    return {"conversations": [_conversation_row(conv, count, snippets.get(conv.id)) for conv, count in rows]}


@core.post("/conversations", status_code=status.HTTP_201_CREATED)
def create_conversation(payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    lim = tutor.limits(db, student.id)
    total = db.execute(select(func.count(AIConversation.id)).where(AIConversation.user_id == student.id, AIConversation.deleted_at.is_(None))).scalar_one()
    if total >= lim["max_conversations"]:
        raise HTTPException(status.HTTP_409_CONFLICT, f"You have {total} chats — delete a few old ones to start a new one.")
    course_id = payload.get("course_id") if isinstance(payload.get("course_id"), int) and db.get(Course, payload["course_id"]) else None
    ctype = payload.get("context_type") if payload.get("context_type") in tutor.CONTEXT_TYPES else ("course" if course_id else "general")
    conv = AIConversation(user_id=student.id, title=tutor.title_from(str(payload.get("title") or "")) if payload.get("title") else "New chat", course_id=course_id, topic=str(payload.get("topic") or "")[:120], context_type=ctype)
    db.add(conv)
    db.commit()
    return _conversation_row(conv, 0)


@core.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    conv = _own_conversation(db, student, conversation_id)
    ids = [m.id for m in conv.messages]
    feedback = dict(db.execute(select(AIFeedback.message_id, AIFeedback.rating).where(AIFeedback.user_id == student.id, AIFeedback.message_id.in_(ids or [-1]))).all())
    visible = [m for m in conv.messages if m.role in {"user", "assistant"} and not (m.meta or {}).get("superseded")]
    return {**_conversation_row(conv), "summary": bool(conv.summary), "messages": [_message_row(m, feedback) for m in visible]}


@core.patch("/conversations/{conversation_id}")
def update_conversation(conversation_id: int, payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    conv = _own_conversation(db, student, conversation_id)
    if "title" in payload and str(payload.get("title") or "").strip():
        conv.title = tutor.title_from(str(payload["title"]))
        conv.title_final = True
    if "archived" in payload:
        conv.archived = bool(payload["archived"])
        conv.archived_at = tutor.utcnow() if conv.archived else None
    if "course_id" in payload:
        conv.course_id = payload["course_id"] if isinstance(payload["course_id"], int) and db.get(Course, payload["course_id"]) else None
    if "topic" in payload:
        conv.topic = str(payload.get("topic") or "")[:120]
    db.commit()
    return _conversation_row(conv)


@core.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    conv = _own_conversation(db, student, conversation_id)
    conv.deleted_at = tutor.utcnow()
    db.commit()
    return {"ok": True, "id": conv.id}


@core.post("/conversations/{conversation_id}/restore")
def restore_conversation(conversation_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    conv = db.get(AIConversation, conversation_id)
    if conv is None or conv.user_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found.")
    conv.deleted_at = None
    db.commit()
    return _conversation_row(conv)


def _sse(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode()


def _estimate(messages: list[dict], text: str) -> dict:
    return {"input": sum(len(str(m.get("content"))) for m in messages) // 4, "output": len(text) // 4, "cached": 0}


def _prepare(db: Session, student: Student, conv: AIConversation, *, content: str, mode: str, context: dict, image: str | None, lim: dict, extra_task: str = "", before_id: int | None = None):
    """Context + prompt for one reply. Returns (messages, meta, parts)."""
    if str(context.get("course_id") or "").isdigit() and db.get(Course, int(context["course_id"])):
        conv.course_id = int(context["course_id"])
    if context.get("topic"):
        conv.topic = str(context["topic"])[:120]
    merged = {"course_id": conv.course_id, "topic": conv.topic, "_soft_course": True, **{k: v for k, v in context.items() if v not in (None, "")}}
    want_progress = mode in {"STUDY_PLAN", "WHAT_TO_STUDY", "PROGRESS", "EXAM_REVISION"} or bool(PROGRESS_WORDS.search(content))
    parts, meta = tutor.build_context(db, student, merged, content, want_progress=want_progress, policy=lim["policy"])
    profile = tutor.learning_profile(db, student)
    task = tutor.MODES.get(mode) or ""
    length = context.get("summary_length")
    if mode == "SUMMARY" and length in SUMMARY_LENGTHS:
        task += " " + SUMMARY_LENGTHS[length]
    if extra_task:
        task = (task + "\n" + extra_task).strip()
    socratic = bool(context.get("socratic")) or (profile is not None and profile.explanation_style == "socratic" and mode == "CHAT")
    system = tutor.assemble_system(policy=lim["policy"], question_hidden=bool(meta.get("answer_hidden")), profile=tutor.profile_text(profile), task=task, parts=parts, summary=conv.summary or "", socratic=socratic)
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}, *tutor.history_messages(conv, before_id=before_id)]
    messages.append({"role": "user", "content": [{"type": "text", "text": content}, {"type": "image_url", "image_url": {"url": image}}]} if image else {"role": "user", "content": content})
    return messages, meta


def _stream_reply(db: Session, student: Student, conv: AIConversation, *, messages: list[dict], meta: dict, mode: str, lim: dict, user_msg_id: int, extra_meta: dict | None = None) -> StreamingResponse:
    """Open the provider stream and relay it as SSE: meta → delta… → done
    (or error / cancelled). Title + memory run in the background afterwards."""
    slot = tutor.concurrency_slot(student.id, lim["concurrent"])
    try:
        slot.__enter__()
    except tutor.TutorError as error:
        db.rollback()
        raise _http(error) from error
    started = time.monotonic()
    request_id = uuid.uuid4().hex[:16]
    course_id = meta.get("course_id") or conv.course_id
    try:
        upstream, model, provider = tutor.open_stream(db, messages, max_tokens=lim["max_response_tokens"])
    except tutor.TutorError as error:
        slot.__exit__(None, None, None)
        db.rollback()  # drop the unanswered user message; the app keeps the text for a retry
        tutor.record_usage(db, student.id, kind=mode, model="", usage=None, latency_ms=int((time.monotonic() - started) * 1000), status="error", error=error.technical, conversation_id=conv.id, request_id=request_id, course_id=course_id)
        db.commit()
        raise _http(error) from error
    db.commit()
    conv_id, student_id, conv_title = conv.id, student.id, conv.title
    cancel = threading.Event()
    with _cancels_lock:
        _cancels[request_id] = cancel
    stored_meta = {"mode": mode, "model": model, **({"passages": meta["passages"]} if meta.get("passages") else {}), **({"answer_hidden": True} if meta.get("answer_hidden") else {}), **(extra_meta or {})}

    def save_partial(text: str, usage: dict | None, note: str, status_: str) -> int | None:
        with session_scope() as s:
            msg = AIMessage(conversation_id=conv_id, user_id=student_id, role="assistant", content=text + f"\n\n_({note})_", message_type=tutor.MESSAGE_TYPE.get(mode, "chat"), meta={**stored_meta, "partial": True})
            s.add(msg)
            tutor.record_usage(s, student_id, kind=mode, model=model, usage=usage or _estimate(messages, text), latency_ms=int((time.monotonic() - started) * 1000), status=status_, conversation_id=conv_id, request_id=request_id, provider=provider, course_id=course_id, output_chars=len(text))
            s.flush()
            return msg.id

    def events():
        text, usage, finish = "", None, None
        settled = False
        try:
            yield _sse("meta", {"conversation_id": conv_id, "user_message_id": user_msg_id, "request_id": request_id, "title": conv_title, "model": model, "context": meta})
            for kind, value in upstream:
                if cancel.is_set():
                    break
                if kind == "delta":
                    text += value
                    yield _sse("delta", {"text": value})
                elif kind == "usage":
                    usage = value
                elif kind == "finish":
                    finish = value
            if cancel.is_set():
                upstream.close()
                settled = True
                message_id = save_partial(text, usage, "stopped", "cancelled") if text.strip() else None
                if not text.strip():
                    with session_scope() as s:
                        tutor.record_usage(s, student_id, kind=mode, model=model, usage=usage or _estimate(messages, ""), latency_ms=int((time.monotonic() - started) * 1000), status="cancelled", conversation_id=conv_id, request_id=request_id, provider=provider, course_id=course_id)
                yield _sse("cancelled", {"message_id": message_id})
                return
            latency = int((time.monotonic() - started) * 1000)
            if not text.strip():
                raise tutor.TutorError(tutor.FRIENDLY, 502, "empty", technical="provider streamed an empty answer")
            with session_scope() as s:
                convo = s.get(AIConversation, conv_id)
                usage = usage or _estimate(messages, text)
                msg = AIMessage(conversation_id=conv_id, user_id=student_id, role="assistant", content=text, message_type=tutor.MESSAGE_TYPE.get(mode, "chat"), meta={**stored_meta, "finish": finish}, token_input=int(usage.get("input") or 0), token_output=int(usage.get("output") or 0))
                s.add(msg)
                convo.last_message_at = tutor.utcnow()
                cost = tutor.record_usage(s, student_id, kind=mode, model=model, usage=usage, latency_ms=latency, conversation_id=conv_id, request_id=request_id, provider=provider, course_id=course_id, output_chars=len(text))
                s.flush()
                message_id = msg.id
                lim_now = tutor.limits(s, student_id)
                remaining = tutor.remaining(lim_now, tutor.usage_counts(s, student_id))
            settled = True
            yield _sse("done", {"message_id": message_id, "finish": finish, "usage": cost, "remaining_today": remaining})
            tutor.run_background("after-reply", tutor.after_reply_jobs, conv_id)
        except (tutor.TutorError, providers.ProviderError) as error:
            settled = True
            technical = getattr(error, "technical", str(error))
            log.warning("tutor stream failed: %s", technical)
            with session_scope() as s:
                tutor.record_usage(s, student_id, kind=mode, model=model, usage=usage, latency_ms=int((time.monotonic() - started) * 1000), status="error", error=technical, conversation_id=conv_id, request_id=request_id, provider=provider, course_id=course_id)
                if text.strip():  # keep what arrived so the student doesn't lose it
                    s.add(AIMessage(conversation_id=conv_id, user_id=student_id, role="assistant", content=text + "\n\n_(answer cut off)_", message_type="chat", meta={**stored_meta, "partial": True}))
            yield _sse("error", {"detail": tutor.FRIENDLY, "status": 503, "partial": bool(text.strip())})
        except Exception:  # noqa: BLE001
            settled = True
            log.exception("tutor stream crashed")
            yield _sse("error", {"detail": tutor.FRIENDLY, "status": 500, "partial": bool(text.strip())})
        finally:
            slot.__exit__(None, None, None)
            with _cancels_lock:
                _cancels.pop(request_id, None)
            if not settled:
                # the client disconnected (Stop / left): close upstream, keep what they saw
                upstream.close()
                try:
                    if text.strip():
                        save_partial(text, usage, "stopped", "cancelled")
                except Exception:  # noqa: BLE001
                    log.exception("could not save partial answer")

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"})


@core.post("/conversations/{conversation_id}/messages")
def send_message(conversation_id: int, payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)):
    """Streams the answer (SSE). Plain requests like "make 10 flashcards" are
    answered with JSON ``{"route": "generate", ...}`` so the app opens the tool."""
    conv = _own_conversation(db, student, conversation_id)
    content = str(payload.get("content") or "").strip()
    mode = str(payload.get("mode") or "CHAT").upper()
    mode = mode if mode in tutor.KINDS else "CHAT"
    context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
    context.pop("exam_mode", None)  # never trusted from the browser
    image = payload.get("image") if isinstance(payload.get("image"), str) and payload.get("image") else None
    if not content and not image:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Type a message first.")
    if mode == "CHAT" and not image and payload.get("route", True) is not False:
        intent = tutor.detect_intent(content)
        if intent and intent["route"] == "generate":
            return JSONResponse({"route": "generate", "kind": intent["kind"], "count": intent.get("count"), "text": content})
        if intent and intent["route"] == "mode":
            mode = intent["mode"]
    try:
        lim = tutor.check_limits(db, student, len(content), feature="images" if image else None, allow_during_exam=not image)
        if image:
            tutor.validate_image(image)
            if mode == "CHAT":
                mode = "IMAGE_EXPLANATION"
        visible = content or "Explain this image."
        messages, meta = _prepare(db, student, conv, content=visible, mode=mode, context=context, image=image, lim=lim)
    except tutor.TutorError as error:
        db.rollback()
        raise _http(error) from error
    user_msg = AIMessage(conversation_id=conv.id, user_id=student.id, role="user", content=visible, message_type=tutor.MESSAGE_TYPE.get(mode, "chat"), meta={**{k: v for k, v in meta.items() if k != "passages"}, "mode": mode, "context": {k: context[k] for k in ("course_id", "topic", "question_id", "material_id", "section_id", "upload_id", "summary_length", "socratic") if k in context}, **({"image": True} if image else {})})
    db.add(user_msg)
    if conv.title == "New chat":
        conv.title = tutor.title_from(visible)
    if (conv.context_type or "general") == "general":
        conv.context_type = tutor.context_type_for({**context, "course_id": conv.course_id}, mode)
    db.flush()
    return _stream_reply(db, student, conv, messages=messages, meta=meta, mode=mode, lim=lim, user_msg_id=user_msg.id)


@core.post("/conversations/{conversation_id}/regenerate")
def regenerate(conversation_id: int, payload: dict | None = None, db: Session = Depends(get_db), student: Student = Depends(require_student)):
    """Answer the last question again (optionally simpler / with an example…).
    The previous answer is kept but hidden (``superseded``)."""
    payload = payload or {}
    conv = _own_conversation(db, student, conversation_id)
    turns = [m for m in conv.messages if m.role in {"user", "assistant"} and not (m.meta or {}).get("superseded")]
    last_user = next((m for m in reversed(turns) if m.role == "user"), None)
    if last_user is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "There is nothing to regenerate yet.")
    style = str(payload.get("style") or "")
    stored = last_user.meta or {}
    mode = stored.get("mode") if stored.get("mode") in tutor.KINDS else "CHAT"
    if mode == "IMAGE_EXPLANATION":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Images aren't kept, so this answer can't be regenerated. Attach the image again.")
    context = dict(stored.get("context") or {})
    try:
        lim = tutor.check_limits(db, student, len(last_user.content))
        messages, meta = _prepare(db, student, conv, content=last_user.content, mode=mode, context=context, image=None, lim=lim, extra_task=REWRITE_STYLES.get(style, "Give a fresh, differently worded answer."), before_id=last_user.id)
    except tutor.TutorError as error:
        db.rollback()
        raise _http(error) from error
    for m in turns:
        if m.role == "assistant" and m.id > last_user.id:
            m.meta = {**(m.meta or {}), "superseded": True}
    db.flush()
    return _stream_reply(db, student, conv, messages=messages, meta=meta, mode=mode, lim=lim, user_msg_id=last_user.id, extra_meta={"regenerated": True, **({"style": style} if style in REWRITE_STYLES else {})})


@core.post("/streams/{request_id}/cancel")
def cancel_stream(request_id: str, student: Student = Depends(require_student)) -> dict:
    with _cancels_lock:
        event = _cancels.get(request_id)
    if event is not None:
        event.set()
    return {"ok": True, "cancelled": event is not None}


@core.post("/messages/{message_id}/feedback")
def message_feedback(message_id: int, payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    msg = db.get(AIMessage, message_id)
    if msg is None or msg.user_id != student.id or msg.role != "assistant":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found.")
    rating = payload.get("rating")
    if rating not in (1, -1, 0):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Rating must be 1 (helpful) or -1 (not helpful).")
    row = db.execute(select(AIFeedback).where(AIFeedback.user_id == student.id, AIFeedback.message_id == message_id)).scalar_one_or_none()
    if rating == 0:
        if row is not None:
            db.delete(row)
            db.commit()
        return {"ok": True, "rating": 0}
    conv = db.get(AIConversation, msg.conversation_id)
    if row is None:
        row = AIFeedback(user_id=student.id, message_id=message_id)
        db.add(row)
    row.rating = rating
    row.reason = payload.get("reason") if payload.get("reason") in FEEDBACK_REASONS else ""
    row.comment = str(payload.get("comment") or "").strip()[:500]
    row.topic = (conv.topic if conv else "") or str((msg.meta or {}).get("topic") or "")[:120]
    row.course_id = conv.course_id if conv else None
    db.commit()
    return {"ok": True, "rating": rating, "reason": row.reason}


# -------------------------------------------------------------- generators
_GEN_FEATURE = {"FLASHCARDS": "flashcards", "PRACTICE": "practice", "MATERIAL": "materials", "PLAN": "study_plans"}


def _generate(payload: dict, db: Session, student: Student) -> dict:
    kind = str(payload.get("kind") or "").upper()
    if kind == "QUIZ":
        kind, payload = "PRACTICE", {**payload, "quiz": True}
    if kind not in tutor.JSON_KINDS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose flashcards, practice, material or plan.")
    limit_n = {"FLASHCARDS": 50, "PRACTICE": 20, "MATERIAL": 1, "PLAN": 60}[kind]
    try:
        count = max(1, min(int(payload.get("count") or 10), limit_n))
    except (TypeError, ValueError):
        count = 10
    difficulty = payload.get("difficulty") if payload.get("difficulty") in {"easy", "medium", "hard", "mixed"} else "mixed"
    types = [t for t in (payload.get("types") or ["mcq"]) if t in {"mcq", "true_false", "short_answer", "calculation", "scenario"}] or ["mcq"]
    source = dict(payload.get("source")) if isinstance(payload.get("source"), dict) else {}
    source.pop("exam_mode", None)
    instructions = str(payload.get("instructions") or "").strip()[:500]
    try:
        lim = tutor.check_limits(db, student, len(instructions), feature=_GEN_FEATURE[kind], allow_during_exam=False)
        if payload.get("quiz"):
            tutor.require_feature(lim, "quiz")
        query = " ".join(str(source.get(k) or "") for k in ("topic", "selected_text", "query")) + " " + instructions
        want_progress = kind == "PLAN" or bool(source.get("weak_topics"))
        if kind == "PLAN":
            plan = source.get("plan") if isinstance(source.get("plan"), dict) else {}
            source["plan"] = plan
        parts, meta = tutor.build_context(db, student, source, query, want_progress=want_progress, policy=lim["policy"])
    except tutor.TutorError as error:
        raise _http(error) from error
    extra: list[str] = []
    conv = None
    if str(source.get("conversation_id") or "").isdigit():
        conv = _own_conversation(db, student, int(source["conversation_id"]))
        turns = [m for m in conv.messages if m.role in {"user", "assistant"} and not (m.meta or {}).get("superseded")][-12:]
        extra.append("CONVERSATION:\n" + (f"Summary: {conv.summary}\n" if conv.summary else "") + "\n".join(f"{m.role.upper()}: {tutor.fence(m.content[:1500])}" for m in turns))
    if str(source.get("message_id") or "").isdigit():
        msg = db.get(AIMessage, int(source["message_id"]))
        if msg is not None and msg.user_id == student.id:
            extra.append(f'TUTOR ANSWER TO USE:\n<document source="tutor answer">\n{tutor.fence(msg.content[:6000])}\n</document>')
    q_ids = [q for q in (source.get("questions") or []) if isinstance(q, int)][:30] if isinstance(source.get("questions"), list) else []
    if q_ids:  # a question set the student just finished (ids only)
        lines = []
        for qid in q_ids:
            q = db.get(Question, qid)
            if q is None:
                continue
            try:
                tutor.check_question_access(db, q)
            except tutor.TutorError:
                continue
            if tutor.question_protected(db, student, q, lim["policy"]):
                continue
            lines.append(f"- {q.text} (answer: {q.correct}; {(q.explanation or '')[:200]})")
        if lines:
            extra.append("QUESTION SET:\n" + "\n".join(lines))
    missed = [m for m in (source.get("missed") or []) if isinstance(m, str)][:15] if isinstance(source.get("missed"), list) else []
    if missed:
        extra.append("QUESTIONS THE STUDENT GOT WRONG (focus on these concepts):\n" + "\n".join(f"- {tutor.fence(m[:300])}" for m in missed))
    similar_to = source.get("similar_to") if isinstance(source.get("similar_to"), dict) else None
    if similar_to and similar_to.get("question"):
        extra.append("WRITE NEW QUESTIONS SIMILAR TO (same concept, different wording/numbers — never a copy):\n" + tutor.fence(str(similar_to.get("question"))[:800]))
    context_text = "\n\n".join(parts[k] for k in ("course", "material", "question", "progress", "plan") if parts.get(k))
    has_source = bool(meta.get("passages") or meta.get("question") or meta.get("selected_text") or meta.get("topic") or extra or kind == "PLAN")
    if not has_source:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Pick a source first — a topic, material, upload, selected text or this conversation.")
    plan_req = source.get("plan") or {}
    try:
        days_wanted = int(plan_req.get("days") or 0)
    except (TypeError, ValueError):
        days_wanted = 0
    if kind == "PLAN":
        try:
            until = date.fromisoformat(str(plan_req.get("exam_date") or "")[:10])
            days_wanted = max(1, min((until - tutor.utcnow().date()).days, 60))
        except ValueError:
            days_wanted = max(1, min(days_wanted or 7, 60))
        count = days_wanted
    try:
        minutes = int(plan_req.get("minutes_per_day") or 60)
    except (TypeError, ValueError):
        minutes = 60
    rules = tutor.JSON_RULES[kind].format(count=count, difficulty=difficulty if difficulty != "mixed" else "mixed-difficulty", types=", ".join(types), today=tutor.utcnow().date().isoformat(), days=days_wanted or 7, minutes=minutes)
    profile = tutor.profile_text(tutor.learning_profile(db, student))
    system = tutor.assemble_system(policy=lim["policy"], question_hidden=bool(meta.get("answer_hidden")), profile=profile, task="You are generating structured study content. " + rules, parts={})
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": f"SOURCE:\n{context_text}\n\n" + "\n\n".join(extra) + (f"\n\nExtra instructions from the student: {instructions}" if instructions else "") + "\n\nReply with the JSON object only."},
    ]
    started = time.monotonic()
    request_id = uuid.uuid4().hex[:16]
    course_id = meta.get("course_id")
    max_tokens = {"FLASHCARDS": min(8000, 160 * count + 400), "PRACTICE": min(8000, 380 * count + 500), "MATERIAL": 5000, "PLAN": min(8000, 220 * count + 600)}[kind]
    try:
        with tutor.concurrency_slot(student.id, lim["concurrent"]):
            data, usage, model, invalid = tutor.generate_json(db, messages, kind, count, max_tokens=max_tokens)
    except tutor.TutorError as error:
        latency = int((time.monotonic() - started) * 1000)
        status_ = "invalid_json" if error.code == "invalid_json" else "error"
        tutor.record_usage(db, student.id, kind=kind, model=getattr(error, "model", ""), usage=getattr(error, "usage", None), latency_ms=latency, status=status_, error=error.technical, request_id=request_id, course_id=course_id)
        db.commit()
        raise _http(error) from error
    latency = int((time.monotonic() - started) * 1000)
    if invalid:
        db.add(AIUsageEvent(user_id=student.id, request_id=request_id, kind=kind, provider=tutor.ai_target(db)[0].name, model=model, status="invalid_json", error="first reply was malformed JSON; retried", course_id=course_id))
    cost = tutor.record_usage(db, student.id, kind=kind, model=model, usage=usage, latency_ms=latency, conversation_id=conv.id if conv else None, request_id=request_id, course_id=course_id, output_chars=len(json.dumps(data)))
    result: dict[str, Any] = {"kind": kind.lower(), "data": data, "model": model, "usage": cost, "context": meta}
    topic = str(source.get("topic") or meta.get("topic") or "")[:120]
    source_type = "material" if meta.get("material") else "upload" if meta.get("upload") else "question" if meta.get("question") else "conversation" if conv else "quiz" if q_ids else "topic" if topic else "custom"
    source_id = (meta.get("material") or meta.get("upload") or meta.get("question") or {}).get("id") if source_type in {"material", "upload", "question"} else (conv.id if conv else None)
    if kind == "PRACTICE":
        # stored straight away (so results and "try another" work) but only listed once saved
        ps = AIPracticeSet(user_id=student.id, course_id=course_id, topic_id=meta.get("topic_id"), topic=topic, title=data["title"], source_type=source_type, source_id=source_id, saved=False)
        library._set_questions(ps, data["questions"], student.id)
        db.add(ps)
        db.flush()
        result["set_id"] = ps.id
        result["data"] = {**data, "questions": [library.question_row(q) for q in ps.questions]}
    if kind == "PLAN":
        plan = library.new_plan(db, student, {**data, "exam_date": plan_req.get("exam_date"), "minutes_per_day": minutes}, course_id=course_id, saved=False)
        db.add(plan)
        db.flush()
        result["plan_id"] = plan.id
        result["data"] = library.plan_data(plan)
    result["source"] = {"source_type": source_type, "source_id": source_id, "course_id": course_id, "topic": topic}
    if conv is not None:
        label = {"FLASHCARDS": f"{len(data.get('cards', []))} flashcards", "PRACTICE": f"{len(data.get('questions', []))} practice questions", "MATERIAL": "a study material", "PLAN": "a study plan"}[kind]
        db.add(AIMessage(conversation_id=conv.id, user_id=student.id, role="assistant", content=f"I made {label}: **{data['title']}**.", message_type=tutor.MESSAGE_TYPE[kind], meta={"generated": kind.lower(), "title": data["title"]}))
        conv.last_message_at = tutor.utcnow()
    db.commit()
    result["remaining_today"] = tutor.remaining(tutor.limits(db, student.id), tutor.usage_counts(db, student.id))
    return result


@core.post("/generate")
def generate(payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """Flashcards, practice/quiz, study material or a study plan as validated JSON."""
    return _generate(payload, db, student)


# ------------------------------------------------------------- my library
@core.get("/saved")
def list_saved(kind: str = Query(""), q: str = Query("", max_length=120), db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    return {"items": library.list_items(db, student, kind, q), "counts": library.counts(db, student)}


@core.post("/saved", status_code=status.HTTP_201_CREATED)
def create_saved(payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    try:
        tutor.require_feature(tutor.limits(db, student.id), "saving")
        return library.create(db, student, payload)
    except (tutor.TutorError, library.LibraryError) as error:
        raise _http(error) from error


@core.get("/saved/{kind}/{item_id}")
def get_saved(kind: str, item_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    try:
        return library.row(kind, library.get_owned(db, student, kind, item_id), full=True)
    except library.LibraryError as error:
        raise _http(error) from error


@core.patch("/saved/{kind}/{item_id}")
def update_saved(kind: str, item_id: int, payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    try:
        return library.update(db, student, kind, item_id, payload)
    except library.LibraryError as error:
        raise _http(error) from error


@core.delete("/saved/{kind}/{item_id}")
def delete_saved(kind: str, item_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    try:
        library.delete(db, student, kind, item_id)
    except library.LibraryError as error:
        raise _http(error) from error
    return {"ok": True, "id": item_id, "kind": kind}


@core.post("/saved/{kind}/{item_id}/duplicate", status_code=status.HTTP_201_CREATED)
def duplicate_saved(kind: str, item_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    try:
        return library.duplicate(db, student, kind, item_id)
    except library.LibraryError as error:
        raise _http(error) from error


# --------------------------------------------------------- flashcard review
def _own_card(db: Session, student: Student, card_id: int) -> AIFlashcard:
    card = db.get(AIFlashcard, card_id)
    deck = db.get(AIFlashcardDeck, card.deck_id) if card else None
    if card is None or deck is None or deck.user_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Card not found.")
    return card


@core.post("/flashcards/{card_id}/review")
def review_card(card_id: int, payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    card = _own_card(db, student, card_id)
    rating = "know" if payload.get("rating") in ("know", "easy", "good", True) else "dont_know"
    card.interval_days, card.next_review_at = tutor.next_review(card.interval_days or 0.0, rating)
    db.add(AIFlashcardReview(card_id=card.id, user_id=student.id, rating=rating, next_review_at=card.next_review_at))
    db.commit()
    return {"id": card.id, "rating": rating, "next_review_at": card.next_review_at.isoformat(), "interval_days": card.interval_days}


@core.get("/flashcards/due")
def due_cards(limit: int = Query(40, ge=1, le=200), db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    now = tutor.utcnow()
    rows = db.execute(
        select(AIFlashcard, AIFlashcardDeck.title).join(AIFlashcardDeck, AIFlashcardDeck.id == AIFlashcard.deck_id)
        .where(AIFlashcardDeck.user_id == student.id, or_(AIFlashcard.next_review_at.is_(None), AIFlashcard.next_review_at <= now))
        .order_by(AIFlashcard.next_review_at.is_not(None), AIFlashcard.next_review_at).limit(limit)
    ).all()
    return {"cards": [{"id": c.id, "deck": title, "deck_id": c.deck_id, "front": c.front, "back": c.back, "topic": c.topic, "difficulty": c.difficulty} for c, title in rows]}


# ----------------------------------------------------------- practice runs
@core.post("/practice-sets/{set_id}/results")
def practice_results(set_id: int, payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    try:
        ps = library.get_owned(db, student, "practice", set_id, include_unsaved=True)
    except library.LibraryError as error:
        raise _http(error) from error
    by_id = {q.id: q for q in ps.questions}
    answered = correct = 0
    per_topic: dict[str, list[int]] = {}
    now = tutor.utcnow()
    for item in payload.get("answers") or []:
        if not isinstance(item, dict) or item.get("question_id") not in by_id:
            continue
        q = by_id[item["question_id"]]
        ok = bool(item.get("correct"))
        q.times_answered += 1
        q.times_correct += 1 if ok else 0
        q.last_answered_at = now
        answered += 1
        correct += 1 if ok else 0
        per_topic.setdefault(q.topic or ps.topic or "General", [0, 0])
        per_topic[q.topic or ps.topic or "General"][0] += 1
        per_topic[q.topic or ps.topic or "General"][1] += 1 if ok else 0
    if answered:
        score = round(correct / answered * 100)
        ps.attempts += 1
        ps.last_score = score
        ps.best_score = max(ps.best_score or 0, score)
    db.commit()
    topics = [{"topic": t, "answered": a, "correct": c, "accuracy": round(c / a * 100)} for t, (a, c) in per_topic.items()]
    return {
        "answered": answered, "correct": correct, "score": ps.last_score, "best": ps.best_score, "attempts": ps.attempts,
        "topics": sorted(topics, key=lambda r: r["accuracy"]),
        "weak": [r["topic"] for r in topics if r["accuracy"] < tutor.WEAK_BELOW],
        "strong": [r["topic"] for r in topics if r["accuracy"] >= tutor.STRONG_FROM],
    }


# -------------------------------------------------------------- study plans
@core.patch("/plans/{plan_id}/items/{item_id}")
def update_plan_item(plan_id: int, item_id: int, payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    plan = db.get(AIStudyPlan, plan_id)
    item = db.get(AIStudyPlanItem, item_id)
    if plan is None or plan.user_id != student.id or item is None or item.plan_id != plan.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan item not found.")
    if payload.get("status") in {"pending", "completed", "skipped"}:
        item.status = payload["status"]
        item.completed = item.status == "completed"
    if "date" in payload:
        try:
            item.date = date.fromisoformat(str(payload["date"])[:10])
        except ValueError:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Use a date like 2026-10-01.") from None
    plan.completed = all(i.status != "pending" for i in plan.items)
    plan.updated_at = tutor.utcnow()
    db.commit()
    return library.row("plan", plan, full=True)


# ------------------------------------------------------------------ uploads
def _process_upload(item_id: int, filename: str, data: bytes) -> None:
    from ..services.material_import import DocumentError, read_document

    with session_scope() as s:
        item = s.get(AISavedItem, item_id)
        if item is None:
            return
        try:
            draft = read_document(filename or "document", data)
        except DocumentError as error:
            item.data = {**(item.data or {}), "status": "failed", "error": error.message}
            return
        except Exception:  # noqa: BLE001
            log.exception("upload processing failed")
            item.data = {**(item.data or {}), "status": "failed", "error": "This file could not be read."}
            return
        sections = [{"position": i + 1, "title": sec.get("title", ""), "blocks": sec.get("blocks", [])} for i, sec in enumerate(draft.get("sections", []))]
        item.title = (draft.get("title") or item.title)[:200]
        item.data = {"filename": (filename or "")[:200], "words": draft.get("words", 0), "sections": sections, "status": "ready"}


UPLOAD_TYPES = {".pdf", ".docx", ".txt", ".md", ".html", ".htm", ".rtf", ".odt", ".pptx", ".csv"}
ASYNC_UPLOAD_BYTES = 1_500_000


@core.post("/uploads", status_code=status.HTTP_201_CREATED)
async def upload_material(file: UploadFile = File(...), db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """A student's own notes/handout → private, searchable sections the tutor
    can quote. Large files are processed in the background (status
    "processing" → "ready"/"failed"). Only the extracted text is kept."""
    lim = tutor.limits(db, student.id)
    try:
        tutor.require_feature(lim, "uploads")
    except tutor.TutorError as error:
        raise _http(error) from error
    name = file.filename or "document"
    ext = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""
    if ext not in UPLOAD_TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Upload a PDF, Word (.docx), PowerPoint (.pptx), text or Markdown file.")
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That file is empty.")
    if len(data) > lim["max_upload_mb"] * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Files must be {lim['max_upload_mb']} MB or smaller.")
    count = db.execute(select(func.count(AISavedItem.id)).where(AISavedItem.user_id == student.id, AISavedItem.kind == "upload")).scalar_one()
    if count >= 30:
        raise HTTPException(status.HTTP_409_CONFLICT, "You have 30 uploads — delete one to add another.")
    item = AISavedItem(user_id=student.id, kind="upload", title=name[:200], data={"filename": name[:200], "status": "processing", "sections": []})
    db.add(item)
    db.commit()
    if len(data) > ASYNC_UPLOAD_BYTES:
        tutor.run_background("upload", _process_upload, item.id, name, data)
        return {"id": item.id, "title": item.title, "status": "processing", "sections": 0, "words": 0}
    import asyncio

    await asyncio.to_thread(_process_upload, item.id, name, data)
    db.refresh(item)
    info = item.data or {}
    if info.get("status") == "failed":
        db.delete(item)
        db.commit()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, info.get("error") or "This file could not be read.")
    return {"id": item.id, "title": item.title, "status": "ready", "sections": len(info.get("sections", [])), "words": info.get("words", 0)}


@core.get("/uploads/{item_id}")
def upload_status(item_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    item = db.get(AISavedItem, item_id)
    if item is None or item.user_id != student.id or item.kind != "upload":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Upload not found.")
    info = item.data or {}
    return {"id": item.id, "title": item.title, "status": info.get("status", "ready"), "error": info.get("error"), "sections": len(info.get("sections", [])), "words": info.get("words", 0)}


@core.delete("/uploads/{item_id}")
def delete_upload(item_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    item = db.get(AISavedItem, item_id)
    if item is None or item.user_id != student.id or item.kind != "upload":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Upload not found.")
    db.delete(item)
    db.commit()
    return {"ok": True, "id": item_id}


# ------------------------------------------------------ progress/dashboard
@core.get("/progress")
def my_progress(course_id: int | None = Query(None), db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    summary = tutor.progress_summary(db, student, course_id)
    db.commit()
    return summary


@core.get("/dashboard")
def study_dashboard(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """Numbers for the study cards: what's due today, weak topics, recommendation."""
    summary = tutor.progress_summary(db, student)
    db.commit()
    counts = library.counts(db, student)
    today = tutor.utcnow().date()
    plan_items = db.execute(
        select(AIStudyPlanItem, AIStudyPlan.title, AIStudyPlan.id).join(AIStudyPlan, AIStudyPlan.id == AIStudyPlanItem.plan_id)
        .where(AIStudyPlan.user_id == student.id, AIStudyPlan.saved.is_(True), AIStudyPlanItem.date == today).order_by(AIStudyPlanItem.position)
    ).all()
    recommended = None
    if summary["weak"]:
        w = summary["weak"][0]
        recommended = {"topic": w["topic"], "course_id": w.get("course_id"), "reason": f"{w['accuracy']}% accuracy over {w['attempted']} questions", "activity": "Mini lesson, then 10 practice questions", "minutes": 25}
    elif summary["topics"]:
        t = summary["topics"][0]
        recommended = {"topic": t["topic"], "course_id": t.get("course_id"), "reason": "Your least-practised topic so far", "activity": "Quick practice set", "minutes": 15}
    return {
        "counts": counts,
        "flashcards_due": counts["cards_due"] + summary["flashcards_due"],
        "weak": summary["weak"][:3],
        "strong": summary["strong"][:3],
        "accuracy": summary["accuracy"],
        "attempted": summary["attempted"],
        "repeated_mistakes": summary["repeated_mistakes"][:3],
        "upcoming": summary["upcoming"],
        "today_plan": [{"id": item.id, "plan_id": pid, "plan": title, "topic": item.topic, "activity": item.activity, "duration": item.duration, "status": item.status} for item, title, pid in plan_items],
        "recommended": recommended,
    }


# ---------------------------------------------------------- /api/ai aliases
@alias_router.post("/chat")
def ai_chat(payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)):
    """One-call chat: continues ``conversation_id`` or starts a new chat."""
    conv_id = payload.get("conversation_id")
    if not isinstance(conv_id, int):
        conv_id = create_conversation({"course_id": (payload.get("context") or {}).get("course_id")}, db, student)["id"]
    return send_message(conv_id, payload, db, student)


@alias_router.post("/flashcards/generate")
def ai_flashcards(payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    return _generate({**payload, "kind": "FLASHCARDS"}, db, student)


@alias_router.post("/practice/generate")
def ai_practice(payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    return _generate({**payload, "kind": "PRACTICE"}, db, student)


@alias_router.post("/quiz/generate")
def ai_quiz(payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    return _generate({**payload, "kind": "QUIZ"}, db, student)


@alias_router.post("/materials/generate")
def ai_material(payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    return _generate({**payload, "kind": "MATERIAL"}, db, student)


@alias_router.post("/study-plan/generate")
def ai_plan(payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    return _generate({**payload, "kind": "PLAN"}, db, student)


@alias_router.post("/feedback")
def ai_feedback(payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    if not isinstance(payload.get("message_id"), int):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "message_id is required.")
    return message_feedback(payload["message_id"], payload, db, student)


router.include_router(core)
alias_router.include_router(core)


# ------------------------------------------------------------------- staff
SETTING_FIELDS: dict[str, type] = {
    "ai_enabled": bool, "ai_daily_limit": int, "ai_monthly_limit": int, "ai_per_minute": int, "ai_max_concurrent": int,
    "ai_max_message_chars": int, "ai_max_response_tokens": int, "ai_max_conversations": int, "ai_exam_safe": bool,
    "ai_provider": str, "ai_model": str, "ai_exam_mode": str, "ai_monthly_budget_usd": float,
    "ai_retention_deleted_days": int, "ai_retention_logs_days": int, "ai_retention_unsaved_days": int,
    **{f"ai_feat_{name}": bool for name in tutor.FEATURES},
}
SETTING_RANGES = {
    "ai_daily_limit": (0, 10000), "ai_monthly_limit": (0, 100000), "ai_per_minute": (1, 120), "ai_max_concurrent": (1, 10),
    "ai_max_message_chars": (200, 20000), "ai_max_response_tokens": (200, 8000), "ai_max_conversations": (1, 5000),
    "ai_monthly_budget_usd": (0, 100000), "ai_retention_deleted_days": (1, 3650), "ai_retention_logs_days": (7, 3650), "ai_retention_unsaved_days": (1, 365),
}


def _providers_info(db: Session) -> list[dict]:
    active, model = tutor.ai_target(db)
    out = []
    for impl in providers.PROVIDERS.values():
        s = impl.settings()
        out.append({
            "id": impl.name, "name": impl.label, "configured": impl.configured(), "active": impl.name == active.name,
            "model": model if impl.name == active.name else impl.default_model(), "default_model": impl.default_model(),
            "fallbacks": s.get("fallbacks", []), "pricing": providers.AI_PRICING_CONFIG.get(impl.name, {}),
            "key_env": "DEEPSEEK_API_KEY" if impl.name == "deepseek" else "GEMINI_API_KEY",
        })
    return out


@admin_router.get("/settings")
def staff_settings(db: Session = Depends(get_db)) -> dict:
    cfg = db.get(Config, 1)
    settings = tutor.tutor_settings(db)
    return {
        "settings": {name: getattr(cfg, name) for name in SETTING_FIELDS} if cfg else {},
        "provider": {"name": settings["provider_label"], "id": settings["provider"], "configured": bool(settings["key"]), "model": settings["model"]},
        "providers": _providers_info(db),
        "exam_modes": list(tutor.EXAM_MODES),
        "features": list(tutor.FEATURES),
    }


@admin_router.put("/settings")
def staff_update_settings(payload: dict, db: Session = Depends(get_db)) -> dict:
    cfg = db.get(Config, 1)
    if cfg is None:
        cfg = Config(id=1)
        db.add(cfg)
    for name, kind in SETTING_FIELDS.items():
        if name not in payload:
            continue
        value = payload[name]
        if kind is bool:
            setattr(cfg, name, bool(value))
        elif kind is str:
            text = str(value or "").strip()
            if name == "ai_provider" and text not in {"", *providers.PROVIDERS}:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Provider must be deepseek, gemini or empty (automatic).")
            if name == "ai_exam_mode" and text not in tutor.EXAM_MODES:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Exam mode must be one of {', '.join(tutor.EXAM_MODES)}.")
            if name == "ai_model" and text and not re.fullmatch(r"[A-Za-z0-9._\-/]{2,60}", text):
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That model name doesn't look right.")
            setattr(cfg, name, text)
        else:
            try:
                number = kind(value)
            except (TypeError, ValueError):
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{name} must be a number.") from None
            low, high = SETTING_RANGES[name]
            if not low <= number <= high:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{name} must be between {low} and {high}.")
            setattr(cfg, name, number)
    db.commit()
    return staff_settings(db)


@admin_router.post("/test")
def staff_test(db: Session = Depends(get_db)) -> dict:
    """Send a tiny prompt to check the provider works (staff see the real error)."""
    impl, model = tutor.ai_target(db)
    started = time.monotonic()
    try:
        text, usage, finish, used = impl.complete([{"role": "user", "content": "Reply with the single word: OK"}], model=model, max_tokens=10)
    except providers.ProviderError as error:
        return {"ok": False, "provider": impl.label, "model": model, "error": str(error), "code": error.code}
    return {"ok": True, "provider": impl.label, "model": used, "reply": text.strip()[:40], "latency_ms": int((time.monotonic() - started) * 1000), "usage": usage}


def _range(range_: str, start: str | None, end: str | None) -> tuple[datetime, datetime, str]:
    now = tutor.utcnow()
    today = datetime(now.year, now.month, now.day)
    if range_ == "today":
        return today, now + timedelta(seconds=1), "Today"
    if range_ == "yesterday":
        return today - timedelta(days=1), today, "Yesterday"
    if range_ == "custom" and start:
        try:
            a = datetime.fromisoformat(start[:10])
            b = datetime.fromisoformat((end or start)[:10]) + timedelta(days=1)
        except ValueError:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Dates must look like 2026-09-01.") from None
        if b <= a:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The end date must be after the start date.")
        return a, b, f"{a.date()} → {(b - timedelta(days=1)).date()}"
    days = 30 if range_ == "30d" else 90 if range_ == "90d" else 7
    return today - timedelta(days=days - 1), now + timedelta(seconds=1), f"Last {days} days"


COUNTED = ("ok", "cancelled")
FOREGROUND = AIUsageEvent.kind.not_in(["SUMMARY_MEMORY", "TITLE"])


@admin_router.get("/overview")
def staff_overview(range: str = Query("7d"), start: str | None = None, end: str | None = None, db: Session = Depends(get_db)) -> dict:  # noqa: A002
    a, b, label = _range(range, start, end)
    window = (AIUsageEvent.created_at >= a, AIUsageEvent.created_at < b)
    rows = db.execute(select(AIUsageEvent.status, func.count(AIUsageEvent.id)).where(*window, FOREGROUND).group_by(AIUsageEvent.status)).all()
    by_status = {s: int(c) for s, c in rows}
    agg = db.execute(
        select(
            func.coalesce(func.sum(AIUsageEvent.input_tokens), 0), func.coalesce(func.sum(AIUsageEvent.output_tokens), 0),
            func.coalesce(func.sum(AIUsageEvent.cache_hit_tokens), 0), func.coalesce(func.sum(AIUsageEvent.estimated_cost), 0.0),
            func.count(func.distinct(AIUsageEvent.user_id)),
        ).where(*window)
    ).one()
    ok_stats = db.execute(select(func.avg(AIUsageEvent.latency_ms), func.avg(AIUsageEvent.output_chars)).where(*window, FOREGROUND, AIUsageEvent.status == "ok")).one()
    success = by_status.get("ok", 0) + by_status.get("cancelled", 0)
    failed = by_status.get("error", 0)
    invalid = by_status.get("invalid_json", 0)
    total = success + failed
    series = db.execute(
        select(func.date(AIUsageEvent.created_at), func.count(AIUsageEvent.id), func.sum(AIUsageEvent.input_tokens + AIUsageEvent.output_tokens), func.sum(AIUsageEvent.estimated_cost))
        .where(*window, FOREGROUND, AIUsageEvent.status.in_(COUNTED + ("error",))).group_by(func.date(AIUsageEvent.created_at)).order_by(func.date(AIUsageEvent.created_at))
    ).all()
    by_kind = db.execute(
        select(AIUsageEvent.kind, func.count(AIUsageEvent.id), func.sum(AIUsageEvent.estimated_cost)).where(*window, AIUsageEvent.status.in_(COUNTED)).group_by(AIUsageEvent.kind).order_by(func.count(AIUsageEvent.id).desc())
    ).all()
    by_model = db.execute(
        select(AIUsageEvent.provider, AIUsageEvent.model, func.count(AIUsageEvent.id), func.sum(AIUsageEvent.input_tokens), func.sum(AIUsageEvent.output_tokens), func.sum(AIUsageEvent.cache_hit_tokens), func.sum(AIUsageEvent.estimated_cost))
        .where(*window, AIUsageEvent.model != "").group_by(AIUsageEvent.provider, AIUsageEvent.model).order_by(func.sum(AIUsageEvent.estimated_cost).desc())
    ).all()
    top = db.execute(
        select(Student.id, Student.name, Student.username, func.count(AIUsageEvent.id), func.sum(AIUsageEvent.estimated_cost)).join(Student, Student.id == AIUsageEvent.user_id)
        .where(*window, FOREGROUND, AIUsageEvent.status.in_(COUNTED)).group_by(Student.id).order_by(func.count(AIUsageEvent.id).desc()).limit(10)
    ).all()
    tokens_in, tokens_out, cached, cost, users = agg
    return {
        "range": {"from": a.isoformat(), "to": b.isoformat(), "label": label},
        "totals": {
            "requests": total, "successful": success, "failed": failed, "rate_limited": by_status.get("rate_limited", 0), "invalid_json": invalid,
            "cancelled": by_status.get("cancelled", 0), "active_users": int(users), "input_tokens": int(tokens_in), "output_tokens": int(tokens_out),
            "cached_tokens": int(cached), "tokens": int(tokens_in + tokens_out), "estimated_cost": round(float(cost), 4),
            "average_latency_ms": int(ok_stats[0] or 0), "average_response_chars": int(ok_stats[1] or 0),
            "failure_rate": round(failed / total * 100, 1) if total else 0.0,
            "conversations": db.execute(select(func.count(AIConversation.id)).where(AIConversation.created_at >= a, AIConversation.created_at < b)).scalar_one(),
            "month_cost": round(tutor.month_cost(db), 4),
        },
        "daily": [{"day": str(d), "requests": int(r or 0), "tokens": int(t or 0), "cost": round(float(c or 0), 4)} for d, r, t, c in series],
        "by_feature": [{"kind": k, "requests": int(n), "cost": round(float(c or 0), 4)} for k, n, c in by_kind],
        "by_model": [{"provider": p, "model": m, "requests": int(n), "input_tokens": int(i or 0), "output_tokens": int(o or 0), "cached_tokens": int(h or 0), "cost": round(float(c or 0), 4), "pricing": providers.price_for(p, m)} for p, m, n, i, o, h, c in by_model],
        "top_students": [{"id": i, "name": n, "username": u, "requests": int(r or 0), "cost": round(float(c or 0), 4)} for i, n, u, r, c in top],
    }


@admin_router.get("/usage")
def staff_usage(days: int = Query(30, ge=1, le=365), db: Session = Depends(get_db)) -> dict:
    """v1 shape, kept for older admin screens."""
    today = tutor.utcnow().date()
    since = today - timedelta(days=days - 1)
    totals = db.execute(
        select(
            func.coalesce(func.sum(AIUsage.requests), 0), func.coalesce(func.sum(AIUsage.failed), 0), func.coalesce(func.sum(AIUsage.rate_limited), 0),
            func.coalesce(func.sum(AIUsage.total_tokens), 0), func.coalesce(func.sum(AIUsage.estimated_cost), 0.0), func.coalesce(func.sum(AIUsage.latency_ms_total), 0),
            func.count(func.distinct(AIUsage.user_id)),
        ).where(AIUsage.day >= since)
    ).one()
    daily = db.execute(select(AIUsage.day, func.sum(AIUsage.requests), func.sum(AIUsage.total_tokens), func.sum(AIUsage.estimated_cost)).where(AIUsage.day >= since).group_by(AIUsage.day).order_by(AIUsage.day)).all()
    top = db.execute(
        select(Student.id, Student.name, func.sum(AIUsage.requests), func.sum(AIUsage.estimated_cost)).join(Student, Student.id == AIUsage.user_id)
        .where(AIUsage.day >= since).group_by(Student.id).order_by(func.sum(AIUsage.requests).desc()).limit(10)
    ).all()
    errors = db.execute(select(AIUsageEvent).where(AIUsageEvent.status.in_(["error", "invalid_json"]), AIUsageEvent.created_at >= tutor.utcnow() - timedelta(days=days)).order_by(AIUsageEvent.created_at.desc()).limit(15)).scalars().all()
    requests, failed, limited, tokens, cost, latency, users = totals
    return {
        "days": days,
        "totals": {"requests": int(requests), "failed": int(failed), "rate_limited": int(limited), "tokens": int(tokens), "estimated_cost": round(float(cost), 4), "average_latency_ms": int(latency / max(1, requests + failed)), "students": int(users)},
        "daily": [{"day": d.isoformat(), "requests": int(r or 0), "tokens": int(t or 0), "cost": round(float(c or 0), 4)} for d, r, t, c in daily],
        "top_students": [{"id": i, "name": n, "requests": int(r or 0), "cost": round(float(c or 0), 4)} for i, n, r, c in top],
        "recent_errors": [{"at": e.created_at.isoformat(), "kind": e.kind, "error": e.error} for e in errors],
    }


def _user_row(db: Session, student: Student, stats: tuple | None = None) -> dict:
    override = db.get(AIUserSetting, student.id)
    lim = tutor.limits(db, student.id)
    counts = tutor.usage_counts(db, student.id)
    out = {
        "id": student.id, "name": student.name, "username": student.username, "banned": bool(student.is_banned),
        "ai_disabled": bool(override.disabled) if override else False,
        "daily_limit": lim["daily"], "monthly_limit": lim["monthly"], "custom_quota": lim["custom_quota"],
        "today": counts["today"], "month": counts["month"], "note": override.note if override else "",
    }
    if stats is not None:
        out.update({"requests": int(stats[0] or 0), "tokens": int(stats[1] or 0), "cost": round(float(stats[2] or 0), 4), "last_used": stats[3].isoformat() if stats[3] else None})
    return out


@admin_router.get("/users")
def staff_users(q: str = Query("", max_length=80), range: str = Query("30d"), start: str | None = None, end: str | None = None, limit: int = Query(50, ge=1, le=200), db: Session = Depends(get_db)) -> dict:  # noqa: A002
    a, b, label = _range(range, start, end)
    stats = (
        select(AIUsageEvent.user_id.label("uid"), func.count(AIUsageEvent.id).label("n"), func.sum(AIUsageEvent.input_tokens + AIUsageEvent.output_tokens).label("t"), func.sum(AIUsageEvent.estimated_cost).label("c"), func.max(AIUsageEvent.created_at).label("last"))
        .where(AIUsageEvent.created_at >= a, AIUsageEvent.created_at < b, AIUsageEvent.status.in_(COUNTED), FOREGROUND).group_by(AIUsageEvent.user_id).subquery()
    )
    stmt = select(Student, stats.c.n, stats.c.t, stats.c.c, stats.c.last).outerjoin(stats, stats.c.uid == Student.id)
    if q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(Student.name).like(like), func.lower(Student.username).like(like), func.lower(func.coalesce(Student.phone, "")).like(like)))
    else:
        stmt = stmt.where(stats.c.n.is_not(None))
    rows = db.execute(stmt.order_by(func.coalesce(stats.c.n, 0).desc(), Student.name).limit(limit)).all()
    return {"range": label, "users": [_user_row(db, s, (n, t, c, last)) for s, n, t, c, last in rows]}


def _student(db: Session, user_id: int) -> Student:
    student = db.get(Student, user_id)
    if student is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found.")
    return student


@admin_router.get("/users/{user_id}")
def staff_user(user_id: int, db: Session = Depends(get_db)) -> dict:
    """Usage + chat TITLES only — staff don't read private messages here."""
    student = _student(db, user_id)
    agg = db.execute(select(func.count(AIUsageEvent.id), func.sum(AIUsageEvent.input_tokens + AIUsageEvent.output_tokens), func.sum(AIUsageEvent.estimated_cost), func.max(AIUsageEvent.created_at)).where(AIUsageEvent.user_id == user_id, AIUsageEvent.status.in_(COUNTED), FOREGROUND)).one()
    convs = db.execute(
        select(AIConversation, func.count(AIMessage.id)).outerjoin(AIMessage, AIMessage.conversation_id == AIConversation.id)
        .where(AIConversation.user_id == user_id).group_by(AIConversation.id).order_by(AIConversation.last_message_at.desc()).limit(50)
    ).all()
    by_kind = db.execute(select(AIUsageEvent.kind, func.count(AIUsageEvent.id)).where(AIUsageEvent.user_id == user_id, AIUsageEvent.status.in_(COUNTED)).group_by(AIUsageEvent.kind)).all()
    return {
        **_user_row(db, student, agg),
        "by_feature": [{"kind": k, "requests": int(n)} for k, n in by_kind],
        "conversations": [{"id": c.id, "title": c.title, "messages": int(n), "context_type": c.context_type, "archived": c.archived, "deleted": c.deleted_at is not None, "last_message_at": c.last_message_at.isoformat() if c.last_message_at else None} for c, n in convs],
        "saved": library.counts(db, student),
    }


@admin_router.put("/users/{user_id}/settings")
def staff_user_settings(user_id: int, payload: dict, db: Session = Depends(get_db)) -> dict:
    student = _student(db, user_id)
    override = db.get(AIUserSetting, user_id) or AIUserSetting(user_id=user_id)
    if "disabled" in payload:
        override.disabled = bool(payload["disabled"])
    for field, high in (("daily_limit", 10000), ("monthly_limit", 100000)):
        if field in payload:
            value = payload[field]
            if value in (None, ""):
                setattr(override, field, None)
            else:
                try:
                    number = int(value)
                except (TypeError, ValueError):
                    raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{field} must be a number.") from None
                if not 0 <= number <= high:
                    raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{field} must be between 0 and {high}.")
                setattr(override, field, number)
    if "note" in payload:
        override.note = str(payload.get("note") or "")[:200]
    db.add(override)
    db.commit()
    return _user_row(db, student)


@admin_router.post("/users/{user_id}/reset-quota")
def staff_reset_quota(user_id: int, db: Session = Depends(get_db)) -> dict:
    """Forgive today's requests (the audit log keeps them)."""
    student = _student(db, user_id)
    today = tutor.utcnow().date()
    row = db.execute(select(AIUsage).where(AIUsage.user_id == user_id, AIUsage.day == today)).scalar_one_or_none()
    override = db.get(AIUserSetting, user_id) or AIUserSetting(user_id=user_id)
    override.reset_day = today
    override.reset_count = int(row.requests if row else 0)
    db.add(override)
    db.commit()
    return _user_row(db, student)


@admin_router.get("/conversations")
def staff_conversations(q: str = Query("", max_length=80), limit: int = Query(50, ge=1, le=200), db: Session = Depends(get_db)) -> dict:
    """Titles and counts only (no message content)."""
    stmt = (
        select(AIConversation, Student.name, Student.username, func.count(AIMessage.id)).join(Student, Student.id == AIConversation.user_id)
        .outerjoin(AIMessage, AIMessage.conversation_id == AIConversation.id).group_by(AIConversation.id, Student.name, Student.username)
    )
    if q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(AIConversation.title).like(like), func.lower(Student.name).like(like), func.lower(Student.username).like(like)))
    rows = db.execute(stmt.order_by(AIConversation.last_message_at.desc()).limit(limit)).all()
    return {"conversations": [{"id": c.id, "title": c.title, "student": {"id": c.user_id, "name": n, "username": u}, "messages": int(m), "context_type": c.context_type, "course_id": c.course_id, "archived": c.archived, "deleted": c.deleted_at is not None, "created_at": c.created_at.isoformat(), "last_message_at": c.last_message_at.isoformat() if c.last_message_at else None} for c, n, u, m in rows]}


@admin_router.get("/courses")
def staff_courses(range: str = Query("30d"), start: str | None = None, end: str | None = None, db: Session = Depends(get_db)) -> dict:  # noqa: A002
    a, b, label = _range(range, start, end)
    rows = db.execute(
        select(Course.id, Course.code, Course.title, func.count(AIUsageEvent.id), func.count(func.distinct(AIUsageEvent.user_id)), func.sum(AIUsageEvent.estimated_cost))
        .join(AIUsageEvent, AIUsageEvent.course_id == Course.id).where(AIUsageEvent.created_at >= a, AIUsageEvent.created_at < b, AIUsageEvent.status.in_(COUNTED), FOREGROUND)
        .group_by(Course.id).order_by(func.count(AIUsageEvent.id).desc())
    ).all()
    topics = db.execute(
        select(AIConversation.course_id, AIConversation.topic, func.count(AIConversation.id)).where(AIConversation.created_at >= a, AIConversation.created_at < b, AIConversation.topic != "")
        .group_by(AIConversation.course_id, AIConversation.topic).order_by(func.count(AIConversation.id).desc()).limit(100)
    ).all()
    top_topics: dict[int, list] = {}
    for cid, topic, n in topics:
        top_topics.setdefault(cid or 0, []).append({"topic": topic, "chats": int(n)})
    no_course = db.execute(select(func.count(AIUsageEvent.id)).where(AIUsageEvent.created_at >= a, AIUsageEvent.created_at < b, AIUsageEvent.status.in_(COUNTED), FOREGROUND, AIUsageEvent.course_id.is_(None))).scalar_one()
    return {"range": label, "courses": [{"id": i, "code": c, "title": t, "requests": int(n), "students": int(u), "cost": round(float(cost or 0), 4), "top_topics": top_topics.get(i, [])[:5]} for i, c, t, n, u, cost in rows], "general_requests": int(no_course)}


@admin_router.get("/quality")
def staff_quality(range: str = Query("30d"), start: str | None = None, end: str | None = None, db: Session = Depends(get_db)) -> dict:  # noqa: A002
    a, b, label = _range(range, start, end)
    fb = db.execute(select(AIFeedback.rating, func.count(AIFeedback.id)).where(AIFeedback.created_at >= a, AIFeedback.created_at < b).group_by(AIFeedback.rating)).all()
    counts = {r: int(n) for r, n in fb}
    up, down = counts.get(1, 0), counts.get(-1, 0)
    reasons = db.execute(select(AIFeedback.reason, func.count(AIFeedback.id)).where(AIFeedback.created_at >= a, AIFeedback.created_at < b, AIFeedback.rating == -1).group_by(AIFeedback.reason)).all()
    topics = db.execute(
        select(AIFeedback.topic, func.count(AIFeedback.id)).where(AIFeedback.created_at >= a, AIFeedback.created_at < b, AIFeedback.rating == -1, AIFeedback.topic != "")
        .group_by(AIFeedback.topic).order_by(func.count(AIFeedback.id).desc()).limit(10)
    ).all()
    recent = db.execute(select(AIFeedback).where(AIFeedback.created_at >= a, AIFeedback.created_at < b, AIFeedback.rating == -1).order_by(AIFeedback.created_at.desc()).limit(20)).scalars().all()
    ev = dict(db.execute(select(AIUsageEvent.status, func.count(AIUsageEvent.id)).where(AIUsageEvent.created_at >= a, AIUsageEvent.created_at < b, FOREGROUND).group_by(AIUsageEvent.status)).all())
    gen_total = db.execute(select(func.count(AIUsageEvent.id)).where(AIUsageEvent.created_at >= a, AIUsageEvent.created_at < b, AIUsageEvent.kind.in_(list(tutor.JSON_KINDS)), AIUsageEvent.status.in_(["ok", "error"]))).scalar_one()
    total = int(ev.get("ok", 0)) + int(ev.get("error", 0)) + int(ev.get("cancelled", 0))
    return {
        "range": label,
        "feedback": {"helpful": up, "not_helpful": down, "negative_rate": round(down / (up + down) * 100, 1) if up + down else 0.0},
        "reasons": [{"reason": r or "unspecified", "count": int(n)} for r, n in reasons],
        "reported_topics": [{"topic": t, "count": int(n)} for t, n in topics],
        "recent_negative": [{"at": f.created_at.isoformat(), "reason": f.reason, "comment": f.comment, "topic": f.topic, "course_id": f.course_id} for f in recent],
        "failed_requests": int(ev.get("error", 0)),
        "failure_rate": round(int(ev.get("error", 0)) / total * 100, 1) if total else 0.0,
        "invalid_json": int(ev.get("invalid_json", 0)),
        "invalid_json_rate": round(int(ev.get("invalid_json", 0)) / gen_total * 100, 1) if gen_total else 0.0,
    }


@admin_router.get("/logs")
def staff_logs(
    status_: str = Query("", alias="status"), kind: str = Query(""), user_id: int | None = None, range: str = Query("7d"), start: str | None = None, end: str | None = None,  # noqa: A002
    page: int = Query(1, ge=1), per_page: int = Query(50, ge=1, le=200), db: Session = Depends(get_db),
) -> dict:
    """Request log: who/when/what feature/tokens/cost/latency/status — never prompts or answers."""
    a, b, label = _range(range, start, end)
    stmt = select(AIUsageEvent, Student.name).join(Student, Student.id == AIUsageEvent.user_id).where(AIUsageEvent.created_at >= a, AIUsageEvent.created_at < b)
    if status_:
        stmt = stmt.where(AIUsageEvent.status == status_)
    if kind:
        stmt = stmt.where(AIUsageEvent.kind == kind.upper())
    if user_id:
        stmt = stmt.where(AIUsageEvent.user_id == user_id)
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = db.execute(stmt.order_by(AIUsageEvent.created_at.desc()).offset((page - 1) * per_page).limit(per_page)).all()
    return {
        "range": label, "total": int(total), "page": page, "per_page": per_page,
        "logs": [{"id": e.id, "at": e.created_at.isoformat(), "request_id": e.request_id, "user": {"id": e.user_id, "name": n}, "kind": e.kind, "provider": e.provider, "model": e.model, "status": e.status, "input_tokens": e.input_tokens, "output_tokens": e.output_tokens, "cached_tokens": e.cache_hit_tokens, "cost": e.estimated_cost, "latency_ms": e.latency_ms, "course_id": e.course_id, "error": e.error} for e, n in rows],
    }


@admin_router.get("/models")
def staff_models(db: Session = Depends(get_db)) -> dict:
    return {"providers": _providers_info(db)}


@admin_router.post("/cleanup")
def staff_cleanup(db: Session = Depends(get_db)) -> dict:
    return {"ok": True, "removed": tutor.cleanup(db)}
