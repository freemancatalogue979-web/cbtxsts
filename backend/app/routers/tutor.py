"""AI Tutor API — conversations (streamed), generators, saved items, uploads,
plus the staff settings/usage view. All AI traffic goes through the server;
the DeepSeek key never reaches the browser."""

from __future__ import annotations

import json
import re
import time
import uuid
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db, session_scope
from ..deps import require_admin, require_student
from ..models import AIConversation, AIMessage, AISavedItem, AIUsage, AIUsageEvent, Config, Course, CourseTopic, Student
from ..services import ai_tutor as tutor

router = APIRouter(prefix="/tutor", tags=["ai-tutor"])
admin_router = APIRouter(prefix="/admin/tutor", tags=["ai-tutor-staff"], dependencies=[Depends(require_admin)])

SAVED_KINDS = {"flashcards", "practice", "material", "notes", "plan"}
SUMMARY_LENGTHS = {
    "quick": "Make it a QUICK summary: 4-6 bullet points, nothing else.",
    "detailed": "Make it a DETAILED summary: go section by section with headings and the important details.",
    "revision": "Make it REVISION NOTES: exam-focused — key facts, definitions, lists to memorise, common traps.",
}
PROGRESS_WORDS = re.compile(r"\b(weak|wrong|mistake|progress|score|getting|struggl|study next|improve|revise|revision|plan)\w*", re.I)


def _conversation_row(conv: AIConversation, count: int | None = None) -> dict:
    return {
        "id": conv.id,
        "title": conv.title,
        "course_id": conv.course_id,
        "topic": conv.topic,
        "archived": conv.archived,
        "created_at": conv.created_at.isoformat(),
        "last_message_at": conv.last_message_at.isoformat() if conv.last_message_at else None,
        **({"messages": count} if count is not None else {}),
    }


def _message_row(m: AIMessage) -> dict:
    return {"id": m.id, "role": m.role, "content": m.content, "type": m.message_type, "meta": m.meta or {}, "created_at": m.created_at.isoformat()}


def _own_conversation(db: Session, student: Student, conversation_id: int) -> AIConversation:
    conv = db.get(AIConversation, conversation_id)
    if conv is None or conv.user_id != student.id or conv.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found.")
    return conv


# ------------------------------------------------------------------ status
@router.get("/status")
def tutor_status(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    lim = tutor.limits(db)
    counts = tutor.usage_counts(db, student.id)
    return {
        "configured": bool(tutor.tutor_settings()["key"]),
        "enabled": lim["enabled"],
        "model": tutor.tutor_settings()["model"],
        "limits": {k: lim[k] for k in ("daily", "monthly", "per_minute", "max_message_chars", "max_upload_mb")},
        "usage": counts,
        "remaining_today": max(0, min(lim["daily"] - counts["today"], lim["monthly"] - counts["month"])),
        "exam_locked": tutor.exam_lock(db, student) if lim["exam_safe"] else None,
    }


@router.get("/options")
def tutor_options(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    courses = db.execute(select(Course).where(Course.is_active.is_(True)).order_by(Course.code)).scalars().all()
    topics = db.execute(select(CourseTopic).order_by(CourseTopic.course_id, CourseTopic.position, CourseTopic.name)).scalars().all()
    by_course: dict[int, list] = {}
    for topic in topics:
        by_course.setdefault(topic.course_id, []).append({"id": topic.id, "name": topic.name})
    uploads = db.execute(select(AISavedItem).where(AISavedItem.user_id == student.id, AISavedItem.kind == "upload").order_by(AISavedItem.created_at.desc())).scalars().all()
    return {
        "courses": [{"id": c.id, "code": c.code, "title": c.title, "topics": by_course.get(c.id, [])} for c in courses],
        "uploads": [{"id": u.id, "title": u.title, "sections": len((u.data or {}).get("sections", []))} for u in uploads],
    }


# ----------------------------------------------------------- conversations
@router.get("/conversations")
def list_conversations(
    archived: bool = Query(False), db: Session = Depends(get_db), student: Student = Depends(require_student)
) -> dict:
    rows = db.execute(
        select(AIConversation, func.count(AIMessage.id))
        .outerjoin(AIMessage, AIMessage.conversation_id == AIConversation.id)
        .where(AIConversation.user_id == student.id, AIConversation.deleted_at.is_(None), AIConversation.archived.is_(archived))
        .group_by(AIConversation.id)
        .order_by(AIConversation.last_message_at.desc())
        .limit(200)
    ).all()
    return {"conversations": [_conversation_row(conv, count) for conv, count in rows]}


@router.post("/conversations", status_code=status.HTTP_201_CREATED)
def create_conversation(payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    lim = tutor.limits(db)
    total = db.execute(select(func.count(AIConversation.id)).where(AIConversation.user_id == student.id, AIConversation.deleted_at.is_(None))).scalar_one()
    if total >= lim["max_conversations"]:
        raise HTTPException(status.HTTP_409_CONFLICT, f"You have {total} chats — delete a few old ones to start a new one.")
    course_id = payload.get("course_id") if isinstance(payload.get("course_id"), int) and db.get(Course, payload["course_id"]) else None
    conv = AIConversation(user_id=student.id, title=tutor.title_from(str(payload.get("title") or "")) if payload.get("title") else "New chat", course_id=course_id, topic=str(payload.get("topic") or "")[:120])
    db.add(conv)
    db.commit()
    return _conversation_row(conv, 0)


@router.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    conv = _own_conversation(db, student, conversation_id)
    return {**_conversation_row(conv), "messages": [_message_row(m) for m in conv.messages if m.role in {"user", "assistant"}]}


@router.patch("/conversations/{conversation_id}")
def update_conversation(conversation_id: int, payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    conv = _own_conversation(db, student, conversation_id)
    if "title" in payload:
        conv.title = tutor.title_from(str(payload.get("title") or "")) or conv.title
    if "archived" in payload:
        conv.archived = bool(payload["archived"])
    if "course_id" in payload:
        conv.course_id = payload["course_id"] if isinstance(payload["course_id"], int) and db.get(Course, payload["course_id"]) else None
    if "topic" in payload:
        conv.topic = str(payload.get("topic") or "")[:120]
    db.commit()
    return _conversation_row(conv)


@router.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    conv = _own_conversation(db, student, conversation_id)
    conv.deleted_at = tutor.utcnow()
    db.commit()
    return {"ok": True, "id": conv.id}


@router.post("/conversations/{conversation_id}/restore")
def restore_conversation(conversation_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    conv = db.get(AIConversation, conversation_id)
    if conv is None or conv.user_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found.")
    conv.deleted_at = None
    db.commit()
    return _conversation_row(conv)


def _sse(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode()


@router.post("/conversations/{conversation_id}/messages")
def send_message(conversation_id: int, payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)):
    """Stream the tutor's answer as server-sent events: meta → delta… → done (or error)."""
    conv = _own_conversation(db, student, conversation_id)
    content = str(payload.get("content") or "").strip()
    mode = str(payload.get("mode") or "CHAT").upper()
    mode = mode if mode in tutor.KINDS else "CHAT"
    context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
    image = payload.get("image") if isinstance(payload.get("image"), str) and payload.get("image") else None
    if not content and not image:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Type a message first.")
    try:
        lim = tutor.check_limits(db, student, len(content))
        if image:
            tutor.validate_image(image)
            if mode == "CHAT":
                mode = "IMAGE_EXPLANATION"
    except tutor.TutorError as error:
        raise HTTPException(error.status, str(error)) from error

    # remember the course/topic on the conversation so follow-ups keep context
    if str(context.get("course_id") or "").isdigit():
        conv.course_id = int(context["course_id"]) if db.get(Course, int(context["course_id"])) else conv.course_id
    if context.get("topic"):
        conv.topic = str(context["topic"])[:120]
    merged = {"course_id": conv.course_id, "topic": conv.topic, **{k: v for k, v in context.items() if v not in (None, "")}}
    want_progress = mode in {"STUDY_PLAN", "WHAT_TO_STUDY"} or bool(PROGRESS_WORDS.search(content))
    context_text, meta = tutor.build_context(db, student, merged, content, want_progress=want_progress)
    visible = content or "Explain this image."
    user_msg = AIMessage(conversation_id=conv.id, user_id=student.id, role="user", content=visible, message_type=tutor.MESSAGE_TYPE.get(mode, "chat"), meta={**meta, "mode": mode, **({"image": True} if image else {})})
    db.add(user_msg)
    if conv.title == "New chat":
        conv.title = tutor.title_from(visible)
    db.flush()

    task = tutor.MODES.get(mode) or ""
    length = context.get("summary_length")
    if mode == "SUMMARY" and length in SUMMARY_LENGTHS:
        task += " " + SUMMARY_LENGTHS[length]
    system = tutor.SYSTEM + ("\n\nTASK FOR THIS REPLY:\n" + task if task else "") + ("\n\nCONTEXT:\n" + context_text if context_text else "")
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}, *tutor.history_messages(conv, exclude_id=user_msg.id)]
    messages.append({"role": "user", "content": [{"type": "text", "text": visible}, {"type": "image_url", "image_url": {"url": image}}]} if image else {"role": "user", "content": visible})

    slot = tutor.concurrency_slot(student.id, lim["concurrent"])
    try:
        slot.__enter__()
    except tutor.TutorError as error:
        db.rollback()
        raise HTTPException(error.status, str(error)) from error
    started = time.monotonic()
    request_id = uuid.uuid4().hex[:16]
    try:
        upstream, model = tutor.open_completion(messages, max_tokens=lim["max_response_tokens"], stream=True)
    except tutor.TutorError as error:
        slot.__exit__(None, None, None)
        db.rollback()  # drop the unanswered user message; the app keeps the text for a retry
        tutor.record_usage(db, student.id, kind=mode, model="", usage=None, latency_ms=int((time.monotonic() - started) * 1000), status="error", error=str(error), conversation_id=conv.id, request_id=request_id)
        db.commit()
        raise HTTPException(error.status, str(error)) from error
    db.commit()
    conv_id, user_msg_id, student_id, conv_title = conv.id, user_msg.id, student.id, conv.title

    def events():
        text, usage, finish = "", None, None
        settled = False
        try:
            yield _sse("meta", {"conversation_id": conv_id, "user_message_id": user_msg_id, "title": conv_title, "model": model, "context": meta})
            for kind, value in tutor.iter_stream(upstream):
                if kind == "delta":
                    text += value
                    yield _sse("delta", {"text": value})
                elif kind == "usage":
                    usage = value
                elif kind == "finish":
                    finish = value
            latency = int((time.monotonic() - started) * 1000)
            if not text.strip():
                raise tutor.TutorError("The AI returned an empty answer. Try again.", 502, "empty")
            with session_scope() as s:
                convo = s.get(AIConversation, conv_id)
                usage = usage or {"prompt_tokens": sum(len(str(m.get("content"))) for m in messages) // 4, "completion_tokens": len(text) // 4}
                msg = AIMessage(conversation_id=conv_id, user_id=student_id, role="assistant", content=text, message_type=tutor.MESSAGE_TYPE.get(mode, "chat"), meta={"mode": mode, "model": model, "finish": finish, **({"passages": meta["passages"]} if meta.get("passages") else {})}, token_input=int(usage.get("prompt_tokens") or 0), token_output=int(usage.get("completion_tokens") or 0))
                s.add(msg)
                convo.last_message_at = tutor.utcnow()
                cost = tutor.record_usage(s, student_id, kind=mode, model=model, usage=usage, latency_ms=latency, conversation_id=conv_id, request_id=request_id)
                s.flush()
                message_id = msg.id
                lim_now = tutor.limits(s)
                counts = tutor.usage_counts(s, student_id)
            settled = True
            yield _sse("done", {"message_id": message_id, "finish": finish, "usage": cost, "remaining_today": max(0, min(lim_now["daily"] - counts["today"], lim_now["monthly"] - counts["month"]))})
            # memory upkeep after the student already has the answer
            with session_scope() as s:
                convo = s.get(AIConversation, conv_id)
                if convo is not None:
                    tutor.summarise_if_needed(s, convo)
        except tutor.TutorError as error:
            settled = True
            with session_scope() as s:
                tutor.record_usage(s, student_id, kind=mode, model=model, usage=usage, latency_ms=int((time.monotonic() - started) * 1000), status="error", error=str(error), conversation_id=conv_id, request_id=request_id)
                if text.strip():  # keep what arrived so the student doesn't lose it
                    s.add(AIMessage(conversation_id=conv_id, user_id=student_id, role="assistant", content=text + "\n\n_(answer cut off)_", message_type="chat", meta={"mode": mode, "partial": True}))
            yield _sse("error", {"detail": str(error), "status": error.status, "partial": bool(text.strip())})
        except Exception:  # noqa: BLE001
            settled = True
            import logging

            logging.getLogger("arena").exception("tutor stream failed")
            yield _sse("error", {"detail": "Something went wrong while answering. Try again.", "status": 500, "partial": bool(text.strip())})
        finally:
            slot.__exit__(None, None, None)
            if not settled and text.strip():
                # the student pressed Stop / left: keep what they saw and count the tokens used
                try:
                    with session_scope() as s:
                        s.add(AIMessage(conversation_id=conv_id, user_id=student_id, role="assistant", content=text + "\n\n_(stopped)_", message_type=tutor.MESSAGE_TYPE.get(mode, "chat"), meta={"mode": mode, "partial": True}))
                        tutor.record_usage(s, student_id, kind=mode, model=model, usage=usage or {"prompt_tokens": sum(len(str(m.get("content"))) for m in messages) // 4, "completion_tokens": len(text) // 4}, latency_ms=int((time.monotonic() - started) * 1000), conversation_id=conv_id, request_id=request_id)
                except Exception:  # noqa: BLE001
                    pass
                try:
                    upstream.close()
                except Exception:  # noqa: BLE001
                    pass

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"})


# -------------------------------------------------------------- generators
@router.post("/generate")
def generate(payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """Flashcards, practice questions or study material as validated JSON.
    Nothing is saved — the student decides with /saved."""
    kind = str(payload.get("kind") or "").upper()
    if kind not in tutor.JSON_KINDS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose flashcards, practice or material.")
    count = max(1, min(int(payload.get("count") or 10), 50 if kind == "FLASHCARDS" else 20))
    difficulty = payload.get("difficulty") if payload.get("difficulty") in {"easy", "medium", "hard", "mixed"} else "mixed"
    types = [t for t in (payload.get("types") or ["mcq"]) if t in {"mcq", "true_false", "short_answer", "calculation", "scenario"}] or ["mcq"]
    source = payload.get("source") if isinstance(payload.get("source"), dict) else {}
    instructions = str(payload.get("instructions") or "").strip()[:500]
    try:
        lim = tutor.check_limits(db, student, len(instructions))
    except tutor.TutorError as error:
        raise HTTPException(error.status, str(error)) from error

    query = " ".join(str(source.get(k) or "") for k in ("topic", "selected_text", "query")) + " " + instructions
    context_text, meta = tutor.build_context(db, student, source, query)
    conversation_text = ""
    conv = None
    if str(source.get("conversation_id") or "").isdigit():
        conv = _own_conversation(db, student, int(source["conversation_id"]))
        turns = [m for m in conv.messages if m.role in {"user", "assistant"}][-12:]
        conversation_text = (f"Conversation summary: {conv.summary}\n" if conv.summary else "") + "\n".join(f"{m.role.upper()}: {m.content[:1500]}" for m in turns)
    if isinstance(source.get("questions"), list):  # a question set the student just finished (ids only)
        lines = []
        from ..models import Question

        for qid in [q for q in source["questions"] if isinstance(q, int)][:30]:
            q = db.get(Question, qid)
            if q is not None and not (tutor.limits(db)["exam_safe"] and tutor._answer_hidden(db, student, q)):
                lines.append(f"- {q.text} (answer: {q.correct}; {q.explanation[:200]})")
        if lines:
            context_text += "\n\nQUESTION SET:\n" + "\n".join(lines)
    has_source = bool(meta.get("passages") or meta.get("question") or meta.get("selected_text") or meta.get("topic") or conversation_text or "QUESTION SET" in context_text)
    if not has_source:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Pick a source first — a topic, material, upload, selected text or this conversation.")
    rules = tutor.JSON_RULES[kind].format(count=count, difficulty=difficulty if difficulty != "mixed" else "mixed-difficulty", types=", ".join(types))
    messages = [
        {"role": "system", "content": tutor.SYSTEM + "\n\nYou are generating structured study content. " + rules},
        {"role": "user", "content": f"SOURCE:\n{context_text}\n{conversation_text}\n\n{('Extra instructions: ' + instructions) if instructions else ''}\nReply with the JSON object only."},
    ]
    started = time.monotonic()
    request_id = uuid.uuid4().hex[:16]
    try:
        with tutor.concurrency_slot(student.id, lim["concurrent"]):
            text, usage, model = tutor.complete(messages, max_tokens=min(8000, 350 * count + 600), json_mode=True)
            data = tutor.normalise(kind, tutor.parse_json(text), count)
    except tutor.TutorError as error:
        tutor.record_usage(db, student.id, kind=kind, model="", usage=None, latency_ms=int((time.monotonic() - started) * 1000), status="error", error=str(error), request_id=request_id)
        db.commit()
        raise HTTPException(error.status, str(error)) from error
    cost = tutor.record_usage(db, student.id, kind=kind, model=model, usage=usage, latency_ms=int((time.monotonic() - started) * 1000), conversation_id=conv.id if conv else None, request_id=request_id)
    if conv is not None:
        label = {"FLASHCARDS": f"{len(data.get('cards', []))} flashcards", "PRACTICE": f"{len(data.get('questions', []))} practice questions", "MATERIAL": "a study material"}[kind]
        db.add(AIMessage(conversation_id=conv.id, user_id=student.id, role="assistant", content=f"I made {label}: **{data['title']}**.", message_type=tutor.MESSAGE_TYPE[kind], meta={"generated": kind.lower(), "title": data["title"]}))
        conv.last_message_at = tutor.utcnow()
    db.commit()
    counts = tutor.usage_counts(db, student.id)
    return {"kind": kind.lower(), "data": data, "model": model, "usage": cost, "context": meta, "remaining_today": max(0, min(lim["daily"] - counts["today"], lim["monthly"] - counts["month"]))}


# -------------------------------------------------------------- saved items
def _saved_row(item: AISavedItem, full: bool = True) -> dict:
    data = item.data or {}
    size = len(data.get("cards") or data.get("questions") or data.get("sections") or [])
    return {"id": item.id, "kind": item.kind, "title": item.title, "course_id": item.course_id, "topic": item.topic, "items": size, "created_at": item.created_at.isoformat(), "updated_at": item.updated_at.isoformat(), **({"data": data} if full else {})}


@router.get("/saved")
def list_saved(kind: str = Query(""), db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    stmt = select(AISavedItem).where(AISavedItem.user_id == student.id, AISavedItem.kind != "upload")
    if kind:
        stmt = stmt.where(AISavedItem.kind == kind)
    rows = db.execute(stmt.order_by(AISavedItem.updated_at.desc()).limit(300)).scalars().all()
    return {"items": [_saved_row(r, full=False) for r in rows]}


def _clean_saved(payload: dict) -> tuple[str, dict]:
    title = str(payload.get("title") or "").strip()[:200]
    data = payload.get("data") if isinstance(payload.get("data"), dict) else None
    if data is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Nothing to save.")
    if len(json.dumps(data)) > 300_000:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "That is too large to save.")
    return title, data


@router.post("/saved", status_code=status.HTTP_201_CREATED)
def create_saved(payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    kind = str(payload.get("kind") or "")
    if kind not in SAVED_KINDS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown item type.")
    title, data = _clean_saved(payload)
    course_id = payload.get("course_id") if isinstance(payload.get("course_id"), int) and db.get(Course, payload["course_id"]) else None
    conv_id = payload.get("conversation_id") if isinstance(payload.get("conversation_id"), int) else None
    if conv_id:
        conv = db.get(AIConversation, conv_id)
        conv_id = conv.id if conv is not None and conv.user_id == student.id else None
    item = AISavedItem(user_id=student.id, kind=kind, title=title or data.get("title") or kind.title(), course_id=course_id, topic=str(payload.get("topic") or "")[:120], data=data, conversation_id=conv_id)
    db.add(item)
    db.commit()
    return _saved_row(item)


def _own_item(db: Session, student: Student, item_id: int) -> AISavedItem:
    item = db.get(AISavedItem, item_id)
    if item is None or item.user_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Saved item not found.")
    return item


@router.get("/saved/{item_id}")
def get_saved(item_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    return _saved_row(_own_item(db, student, item_id))


@router.patch("/saved/{item_id}")
def update_saved(item_id: int, payload: dict, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    item = _own_item(db, student, item_id)
    if "title" in payload:
        item.title = str(payload.get("title") or "").strip()[:200] or item.title
    if "data" in payload:
        _, item.data = _clean_saved(payload)
    db.commit()
    return _saved_row(item)


@router.delete("/saved/{item_id}")
def delete_saved(item_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    item = _own_item(db, student, item_id)
    db.delete(item)
    db.commit()
    return {"ok": True, "id": item_id}


# ------------------------------------------------------------------ uploads
@router.post("/uploads", status_code=status.HTTP_201_CREATED)
async def upload_material(file: UploadFile = File(...), db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """A student's own notes/handout (PDF, DOCX, TXT…) → private, searchable
    sections the tutor can quote. Only the extracted text is kept."""
    from ..services.material_import import DocumentError, read_document

    lim = tutor.limits(db)
    data = await file.read()
    if len(data) > lim["max_upload_mb"] * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Files must be {lim['max_upload_mb']} MB or smaller.")
    count = db.execute(select(func.count(AISavedItem.id)).where(AISavedItem.user_id == student.id, AISavedItem.kind == "upload")).scalar_one()
    if count >= 30:
        raise HTTPException(status.HTTP_409_CONFLICT, "You have 30 uploads — delete one to add another.")
    try:
        draft = read_document(file.filename or "document", data)
    except DocumentError as error:
        raise HTTPException(error.status_code, error.message) from error
    sections = [{"position": i + 1, "title": s.get("title", ""), "blocks": s.get("blocks", [])} for i, s in enumerate(draft.get("sections", []))]
    item = AISavedItem(user_id=student.id, kind="upload", title=(draft.get("title") or file.filename or "My upload")[:200], data={"filename": (file.filename or "")[:200], "words": draft.get("words", 0), "sections": sections})
    db.add(item)
    db.commit()
    return {"id": item.id, "title": item.title, "sections": len(sections), "words": draft.get("words", 0)}


@router.delete("/uploads/{item_id}")
def delete_upload(item_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    item = _own_item(db, student, item_id)
    if item.kind != "upload":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Upload not found.")
    db.delete(item)
    db.commit()
    return {"ok": True, "id": item_id}


@router.get("/progress")
def my_progress(course_id: int | None = Query(None), db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    summary = tutor.progress_summary(db, student, course_id)
    db.commit()
    return summary


# ------------------------------------------------------------------- staff
SETTING_FIELDS = {
    "ai_enabled": bool, "ai_daily_limit": int, "ai_monthly_limit": int, "ai_per_minute": int, "ai_max_concurrent": int,
    "ai_max_message_chars": int, "ai_max_response_tokens": int, "ai_max_conversations": int, "ai_exam_safe": bool,
}
SETTING_RANGES = {
    "ai_daily_limit": (0, 10000), "ai_monthly_limit": (0, 100000), "ai_per_minute": (1, 120), "ai_max_concurrent": (1, 10),
    "ai_max_message_chars": (200, 20000), "ai_max_response_tokens": (200, 8000), "ai_max_conversations": (1, 5000),
}


@admin_router.get("/settings")
def staff_settings(db: Session = Depends(get_db)) -> dict:
    cfg = db.get(Config, 1)
    settings = tutor.tutor_settings()
    return {
        "settings": {name: getattr(cfg, name) for name in SETTING_FIELDS} if cfg else {},
        "provider": {"name": "DeepSeek", "configured": bool(settings["key"]), "model": settings["model"], "base": settings["base"]},
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
        else:
            try:
                number = int(value)
            except (TypeError, ValueError):
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{name} must be a number.") from None
            low, high = SETTING_RANGES[name]
            if not low <= number <= high:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{name} must be between {low} and {high}.")
            setattr(cfg, name, number)
    db.commit()
    return staff_settings(db)


@admin_router.get("/usage")
def staff_usage(days: int = Query(30, ge=1, le=365), db: Session = Depends(get_db)) -> dict:
    today = tutor.utcnow().date()
    since = today - timedelta(days=days - 1)
    totals = db.execute(
        select(
            func.coalesce(func.sum(AIUsage.requests), 0), func.coalesce(func.sum(AIUsage.failed), 0), func.coalesce(func.sum(AIUsage.rate_limited), 0),
            func.coalesce(func.sum(AIUsage.total_tokens), 0), func.coalesce(func.sum(AIUsage.estimated_cost), 0.0), func.coalesce(func.sum(AIUsage.latency_ms_total), 0),
            func.count(func.distinct(AIUsage.user_id)),
        ).where(AIUsage.day >= since)
    ).one()
    daily = db.execute(
        select(AIUsage.day, func.sum(AIUsage.requests), func.sum(AIUsage.total_tokens), func.sum(AIUsage.estimated_cost)).where(AIUsage.day >= since).group_by(AIUsage.day).order_by(AIUsage.day)
    ).all()
    top = db.execute(
        select(Student.id, Student.name, func.sum(AIUsage.requests), func.sum(AIUsage.estimated_cost)).join(Student, Student.id == AIUsage.user_id)
        .where(AIUsage.day >= since).group_by(Student.id).order_by(func.sum(AIUsage.requests).desc()).limit(10)
    ).all()
    errors = db.execute(select(AIUsageEvent).where(AIUsageEvent.status.in_(["error"]), AIUsageEvent.created_at >= tutor.utcnow() - timedelta(days=days)).order_by(AIUsageEvent.created_at.desc()).limit(15)).scalars().all()
    requests, failed, limited, tokens, cost, latency, users = totals
    return {
        "days": days,
        "totals": {"requests": int(requests), "failed": int(failed), "rate_limited": int(limited), "tokens": int(tokens), "estimated_cost": round(float(cost), 4), "average_latency_ms": int(latency / max(1, requests + failed)), "students": int(users)},
        "daily": [{"day": d.isoformat(), "requests": int(r or 0), "tokens": int(t or 0), "cost": round(float(c or 0), 4)} for d, r, t, c in daily],
        "top_students": [{"id": i, "name": n, "requests": int(r or 0), "cost": round(float(c or 0), 4)} for i, n, r, c in top],
        "recent_errors": [{"at": e.created_at.isoformat(), "kind": e.kind, "error": e.error} for e in errors],
    }
