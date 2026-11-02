"""Member AI workspace: private chats, opt-in context and reviewed knowledge."""

from __future__ import annotations

from datetime import timedelta
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import clover_ai_service as service
from ..ai_credentials import key_status
from ..clover_ai_models import AIContribution, AIConversation, AIKnowledge, AIMemoryNote, AIMessage, AISettings
from ..deps import get_current_user, get_db
from ..hero_profiles import profile_for
from ..models import Hero, User, dumps, loads, utcnow

router = APIRouter(prefix="/ai", tags=["9 Clover AI"])


def ai_user(
    response: Response, authorization: str | None = Header(default=None), user: User = Depends(get_current_user)
) -> User:
    # The shared CORS config permits preview subdomains. Requiring the bearer
    # token even for GET prevents cookie-only cross-origin reads of private chat.
    scheme, _, credential = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not credential.strip():
        raise HTTPException(status_code=401, detail="Bearer sign-in required for AI workspace")
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return user


def admin_user(user: User = Depends(ai_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admins can review community submissions.")
    return user


def iso(value):  # noqa: ANN001
    return value.isoformat() + "Z" if value else None


def conversation_json(row: AIConversation) -> dict:
    return {"id": row.id, "title": row.title, "created_at": iso(row.created_at), "updated_at": iso(row.updated_at)}


def message_json(row: AIMessage) -> dict:
    return {
        "id": row.id,
        "role": row.role,
        "content": row.content,
        "mode": row.mode,
        "note": row.note,
        "sources": loads(row.sources_json, []),
        "feedback": row.feedback,
        "created_at": iso(row.created_at),
    }


def memory_json(row: AIMemoryNote) -> dict:
    return {
        "id": row.id,
        "category": row.category,
        "content": row.content,
        "share_in_context": row.share_in_context,
        "created_at": iso(row.created_at),
        "updated_at": iso(row.updated_at),
    }


def own_memory(db: Session, user: User, memory_id: str) -> AIMemoryNote:
    row = db.query(AIMemoryNote).filter_by(id=memory_id, user_id=user.id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Coaching note not found.")
    return row


def own_conversation(db: Session, user: User, conversation_id: str) -> AIConversation:
    row = db.query(AIConversation).filter_by(id=conversation_id, owner_id=user.id).first()
    if row is None:
        # Indistinguishable from a nonexistent conversation, even for admins.
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return row


class SettingsIn(BaseModel):
    share_profile: bool | None = None
    share_pool: bool | None = None
    share_scrims: bool | None = None
    use_history: bool | None = None
    coaching_goal: str | None = Field(default=None, max_length=600)

    @field_validator("coaching_goal")
    @classmethod
    def trim_goal(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else value


MemoryCategory = Literal["strength", "focus", "preference", "goal"]


class MemoryIn(BaseModel):
    category: MemoryCategory
    content: str = Field(min_length=1, max_length=500)
    share_in_context: bool = False


class MemoryUpdateIn(BaseModel):
    category: MemoryCategory | None = None
    content: str | None = Field(default=None, min_length=1, max_length=500)
    share_in_context: bool | None = None


class TitleIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    match_ids: list[str] = Field(default_factory=list, max_length=service.MAX_SELECTED_MATCHES)

    @field_validator("match_ids")
    @classmethod
    def valid_match_ids(cls, values: list[str]) -> list[str]:
        if any(not value or len(value) > 120 or value != value.strip() for value in values):
            raise ValueError("Each selected match ID must be 1–120 characters.")
        if len(set(values)) != len(values):
            raise ValueError("Select each match only once.")
        return values


class FeedbackIn(BaseModel):
    rating: Literal[-1, 0, 1]


class ChatSearchIn(BaseModel):
    q: str = Field(min_length=2, max_length=100)
    offset: int = Field(default=0, ge=0, le=10000)
    limit: int = Field(default=30, ge=1, le=100)


class ContributionIn(BaseModel):
    kind: Literal["question", "correction", "strategy", "draft", "feedback"]
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=2000)
    source_url: str = Field(default="", max_length=2048)
    share_with_reviewers: bool


class ReviewIn(BaseModel):
    decision: Literal["approve", "reject"]
    note: str = Field(min_length=1, max_length=500)
    reviewed: bool


def nonblank(value: str, label: str) -> str:
    result = value.strip()
    if not result:
        raise HTTPException(status_code=422, detail=f"{label} cannot be blank.")
    return result


@router.get("/status")
def status(user: User = Depends(ai_user), db: Session = Depends(get_db)) -> dict:
    state = key_status(db)
    return {
        "provider_configured": bool(state["configured"]),
        "provider_note": (
            "A key is configured; live connectivity has not been verified here."
            if state["configured"]
            else "DeepSeek is not configured or the saved key cannot be unlocked."
        ),
        "knowledge": "Bundled historical hero profiles and approved community notes; keyword retrieval.",
        "patch_feed": "not connected",
        "web_search": "not connected",
        "account_match_history": "not connected",
        "tournament_participation": "not connected",
        "prediction_engine": "not available",
    }


@router.get("/settings")
def get_settings(user: User = Depends(ai_user), db: Session = Depends(get_db)) -> dict:
    return service.settings_dict(service.settings_for(db, user.id))


@router.patch("/settings")
def update_settings(data: SettingsIn, user: User = Depends(ai_user), db: Session = Depends(get_db)) -> dict:
    changes = data.model_dump(exclude_unset=True)
    if any(value is None for value in changes.values()):
        raise HTTPException(status_code=422, detail="Settings cannot be null.")
    row = db.get(AISettings, user.id)
    if row is None:
        row = AISettings(user_id=user.id, **changes)
        db.add(row)
        try:
            db.commit()
        except IntegrityError:  # Another first write created this member's row.
            db.rollback()
            row = db.get(AISettings, user.id)
            if row is None:
                raise
            for key, value in changes.items():
                setattr(row, key, value)
            row.updated_at = utcnow()
            db.commit()
    else:
        for key, value in changes.items():
            setattr(row, key, value)
        row.updated_at = utcnow()
        db.commit()
    db.refresh(row)
    return service.settings_dict(row)


@router.delete("/settings/memory")
def clear_memory(user: User = Depends(ai_user), db: Session = Depends(get_db)) -> dict:
    row = db.get(AISettings, user.id)
    if row is None:
        row = AISettings(user_id=user.id)
        db.add(row)
    row.share_profile = row.share_pool = row.share_scrims = row.use_history = False
    row.coaching_goal = ""
    row.updated_at = utcnow()
    db.query(AIMemoryNote).filter_by(user_id=user.id).delete(synchronize_session=False)
    try:
        db.commit()
    except IntegrityError:  # Concurrent first-write from another session.
        db.rollback()
        row = db.get(AISettings, user.id)
        if row is None:
            raise
        row.share_profile = row.share_pool = row.share_scrims = row.use_history = False
        row.coaching_goal = ""
        row.updated_at = utcnow()
        db.query(AIMemoryNote).filter_by(user_id=user.id).delete(synchronize_session=False)
        db.commit()
    db.refresh(row)
    return service.settings_dict(row)


@router.get("/memory-notes")
def memory_notes(user: User = Depends(ai_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.query(AIMemoryNote).filter_by(user_id=user.id).order_by(AIMemoryNote.slot.asc()).all()
    return [memory_json(row) for row in rows]


@router.post("/memory-notes", status_code=201)
def create_memory(data: MemoryIn, user: User = Depends(ai_user), db: Session = Depends(get_db)) -> dict:
    content = nonblank(data.content, "Coaching note")
    slots = {slot for (slot,) in db.query(AIMemoryNote.slot).filter_by(user_id=user.id).all()}
    available = next((slot for slot in range(service.MAX_MEMORY_NOTES) if slot not in slots), None)
    if available is None:
        raise HTTPException(status_code=409, detail="You can save up to 12 coaching notes. Delete one to add another.")
    row = AIMemoryNote(
        user_id=user.id, slot=available, category=data.category, content=content, share_in_context=data.share_in_context
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        # The unique slot prevents concurrent creates from exceeding the cap.
        raise HTTPException(
            status_code=409, detail="Your notes changed in another request. Please try again."
        ) from None
    db.refresh(row)
    return memory_json(row)


@router.patch("/memory-notes/{memory_id}")
def update_memory(
    memory_id: str, data: MemoryUpdateIn, user: User = Depends(ai_user), db: Session = Depends(get_db)
) -> dict:
    row = own_memory(db, user, memory_id)
    changes = data.model_dump(exclude_unset=True)
    if any(value is None for value in changes.values()):
        raise HTTPException(status_code=422, detail="Coaching note fields cannot be null.")
    if "content" in changes:
        changes["content"] = nonblank(changes["content"], "Coaching note")
    for key, value in changes.items():
        setattr(row, key, value)
    row.updated_at = utcnow()
    db.commit()
    db.refresh(row)
    return memory_json(row)


@router.delete("/memory-notes/{memory_id}", status_code=204)
def delete_memory(memory_id: str, user: User = Depends(ai_user), db: Session = Depends(get_db)) -> Response:
    row = own_memory(db, user, memory_id)
    db.delete(row)
    db.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.get("/context")
def context(user: User = Depends(ai_user), db: Session = Depends(get_db)) -> dict:
    return service.context_preview(db, user)


@router.get("/conversations")
def conversations(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    user: User = Depends(ai_user),
    db: Session = Depends(get_db),
) -> dict:
    rows = (
        db.query(AIConversation)
        .filter_by(owner_id=user.id)
        .order_by(AIConversation.updated_at.desc(), AIConversation.id.desc())
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    return {"items": [conversation_json(row) for row in rows[:limit]], "has_more": len(rows) > limit}


@router.post("/conversations/search")
def search_conversations(data: ChatSearchIn, user: User = Depends(ai_user), db: Session = Depends(get_db)) -> dict:
    # Search terms can be sensitive. Keep them in the request body rather than
    # the URL, which is commonly retained in server and proxy access logs.
    term = data.q.strip()
    if len(term) < 2:
        raise HTTPException(status_code=422, detail="Enter at least two characters to search.")
    term = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{term}%"
    rows = (
        db.query(AIConversation)
        .filter(
            AIConversation.owner_id == user.id,
            or_(
                AIConversation.title.ilike(pattern, escape="\\"),
                AIConversation.messages.any(AIMessage.content.ilike(pattern, escape="\\")),
            ),
        )
        .order_by(AIConversation.updated_at.desc(), AIConversation.id.desc())
        .offset(data.offset)
        .limit(data.limit + 1)
        .all()
    )
    return {"items": [conversation_json(row) for row in rows[: data.limit]], "has_more": len(rows) > data.limit}


@router.post("/conversations", status_code=201)
def create_conversation(user: User = Depends(ai_user), db: Session = Depends(get_db)) -> dict:
    row = AIConversation(owner_id=user.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return conversation_json(row)


@router.patch("/conversations/{conversation_id}")
def rename_conversation(
    conversation_id: str, data: TitleIn, user: User = Depends(ai_user), db: Session = Depends(get_db)
) -> dict:
    row = own_conversation(db, user, conversation_id)
    row.title = nonblank(data.title, "Title")
    row.updated_at = utcnow()
    db.commit()
    return conversation_json(row)


@router.delete("/conversations/{conversation_id}", status_code=204)
def delete_conversation(conversation_id: str, user: User = Depends(ai_user), db: Session = Depends(get_db)) -> Response:
    row = own_conversation(db, user, conversation_id)
    db.delete(row)
    db.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.get("/conversations/{conversation_id}/export")
def export_conversation(
    conversation_id: str,
    after: int = Query(default=0, ge=0),
    through: int | None = Query(default=None, ge=0),
    limit: int = Query(default=500, ge=1, le=500),
    user: User = Depends(ai_user),
    db: Session = Depends(get_db),
) -> dict:
    row = own_conversation(db, user, conversation_id)
    # Each response is bounded; a high-water mark keeps later pages from including
    # messages added during the export by another session.
    if through is None:
        through = db.query(func.max(AIMessage.id)).filter(AIMessage.conversation_id == conversation_id).scalar() or 0
    if after > through:
        raise HTTPException(status_code=422, detail="Export cursor is outside this snapshot.")
    rows = (
        db.query(AIMessage)
        .filter(AIMessage.conversation_id == conversation_id, AIMessage.id > after, AIMessage.id <= through)
        .order_by(AIMessage.id.asc())
        .limit(limit + 1)
        .all()
    )
    more = len(rows) > limit
    return {
        "format": "9clover-ai-conversation-v1",
        "exported_at": iso(utcnow()),
        "conversation": conversation_json(row),
        "messages": [message_json(message) for message in rows[:limit]],
        "truncated": more,
        "message_limit": limit,
        "snapshot_through": through,
        "next_after": rows[limit - 1].id if more else None,
        "notice": "Private conversation in plaintext. This file is not encrypted; keep it somewhere safe.",
    }


@router.get("/conversations/{conversation_id}/messages")
def messages(
    conversation_id: str,
    before: int | None = Query(default=None, ge=1),
    limit: int = Query(default=50, ge=1, le=100),
    user: User = Depends(ai_user),
    db: Session = Depends(get_db),
) -> dict:
    own_conversation(db, user, conversation_id)
    query = db.query(AIMessage).filter_by(conversation_id=conversation_id)
    if before is not None:
        query = query.filter(AIMessage.id < before)
    rows = query.order_by(AIMessage.id.desc()).limit(limit + 1).all()
    return {"messages": [message_json(row) for row in reversed(rows[:limit])], "has_more": len(rows) > limit}


@router.post("/conversations/{conversation_id}/messages", status_code=201)
def send_message(
    conversation_id: str, data: MessageIn, user: User = Depends(ai_user), db: Session = Depends(get_db)
) -> dict:
    question = nonblank(data.text, "Message")
    own_conversation(db, user, conversation_id)
    token = uuid4().hex
    now = utcnow()
    lock = db.execute(
        update(AIConversation)
        .where(
            AIConversation.id == conversation_id,
            AIConversation.owner_id == user.id,
            or_(AIConversation.busy_until.is_(None), AIConversation.busy_until < now),
        )
        .values(busy_token=token, busy_until=now + timedelta(seconds=90))
    )
    db.commit()
    if not lock.rowcount:
        own_conversation(db, user, conversation_id)
        raise HTTPException(status_code=409, detail="Another message is still processing in this conversation.")
    try:
        try:
            match_facts, match_sources = service.selected_match_evidence(db, data.match_ids)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from None
        except service.AnalysisError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None
        prefs = service.settings_for(db, user.id)
        history, previous_user = service.recent_history(db, conversation_id, prefs.use_history)
        facts, sources = service.build_evidence(db, user, prefs, question, previous_user, match_facts, match_sources)
        row = own_conversation(db, user, conversation_id)
        if row.title == "New conversation":
            row.title = " ".join(question.split())[:80]
        row.updated_at = utcnow()
        prompt = AIMessage(
            conversation_id=conversation_id,
            role="user",
            content=question,
            mode="user",
            sources_json=dumps(match_sources),
        )
        db.add(prompt)
        db.commit()  # Save the user's request before any external network operation.
        db.refresh(prompt)
        output = service.answer(db, user.id, question, facts, history)
        # A deleted chat or expired/replaced lease must never be resurrected.
        db.expire_all()
        row = (
            db.query(AIConversation)
            .filter_by(id=conversation_id, owner_id=user.id, busy_token=token)
            .filter(AIConversation.busy_until >= utcnow())
            .first()
        )
        if row is None:
            raise HTTPException(status_code=409, detail="Conversation was removed or the request expired.")
        reply = AIMessage(
            conversation_id=conversation_id,
            role="assistant",
            content=output["content"],
            mode=output["mode"],
            note=output["note"][:600],
            sources_json=dumps(sources),
        )
        row.updated_at = utcnow()
        row.busy_token = row.busy_until = None
        db.add(reply)
        db.commit()
        db.refresh(reply)
        return {
            "conversation": conversation_json(row),
            "user_message": message_json(prompt),
            "assistant_message": message_json(reply),
        }
    finally:
        # Handles provider exceptions and process-level interruptions on a best-effort basis;
        # the bounded lease also self-expires after an actual worker crash.
        db.rollback()
        db.execute(
            update(AIConversation)
            .where(
                AIConversation.id == conversation_id,
                AIConversation.owner_id == user.id,
                AIConversation.busy_token == token,
            )
            .values(busy_token=None, busy_until=None)
        )
        db.commit()


@router.patch("/conversations/{conversation_id}/messages/{message_id}/feedback")
def feedback(
    conversation_id: str,
    message_id: int,
    data: FeedbackIn,
    user: User = Depends(ai_user),
    db: Session = Depends(get_db),
) -> dict:
    own_conversation(db, user, conversation_id)
    row = db.query(AIMessage).filter_by(id=message_id, conversation_id=conversation_id, role="assistant").first()
    if row is None:
        raise HTTPException(status_code=404, detail="Message not found.")
    row.feedback = data.rating
    db.commit()
    return message_json(row)


def knowledge_json(item: AIKnowledge) -> dict:
    return {
        "id": item.id,
        "title": item.title,
        "content": item.content,
        "source_url": item.source_url or None,
        "reviewed_at": iso(item.reviewed_at),
        "notice": "Human-reviewed community guidance; not independently verified.",
    }


@router.get("/knowledge")
def knowledge(
    q: str = Query(default="", max_length=200), user: User = Depends(ai_user), db: Session = Depends(get_db)
) -> dict:
    q = q.strip()
    if q:
        notes = service.knowledge_search(db, q, 20)
        safe = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        heroes = (
            db.query(Hero.id, Hero.name)
            .filter(Hero.name.ilike(f"%{safe}%", escape="\\"))
            .order_by(Hero.name)
            .limit(12)
            .all()
        )
    else:
        notes = db.query(AIKnowledge).filter_by(active=True).order_by(AIKnowledge.reviewed_at.desc()).limit(20).all()
        heroes = []
    return {
        "notes": [knowledge_json(item) for item in notes],
        "heroes": [
            {
                "id": hero.id,
                "name": hero.name,
                "roles": (profile_for(hero.name) or {}).get("roles", []),
                "lanes": (profile_for(hero.name) or {}).get("lanes", []),
                "notice": (
                    "Bundled historical snapshot; not verified for the current patch."
                    if profile_for(hero.name)
                    else "Local name only; no bundled profile available."
                ),
            }
            for hero in heroes
        ],
        "hero_count": db.query(Hero).count(),
        "community_count": db.query(AIKnowledge).filter_by(active=True).count(),
        "notice": "Keyword search only. No live patch feed, web search or item database is connected here.",
    }


@router.get("/knowledge/{knowledge_id}")
def knowledge_detail(knowledge_id: str, user: User = Depends(ai_user), db: Session = Depends(get_db)) -> dict:
    row = db.query(AIKnowledge).filter_by(id=knowledge_id, active=True).first()
    if row is None:
        raise HTTPException(status_code=404, detail="This shared note is no longer available.")
    return knowledge_json(row)


@router.delete("/knowledge/{knowledge_id}", status_code=204)
def remove_knowledge(knowledge_id: str, user: User = Depends(admin_user), db: Session = Depends(get_db)) -> Response:
    row = db.query(AIKnowledge).filter_by(id=knowledge_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Knowledge note not found.")
    if row.contribution_id:
        submission = db.get(AIContribution, row.contribution_id)
        if submission is not None:
            submission.status = "removed"
            submission.review_note = (
                "Removed from the shared knowledge library by an admin. " + submission.review_note[:430]
            )
            submission.reviewed_by, submission.reviewed_at = user.id, utcnow()
    db.delete(row)
    db.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


def contribution_json(row: AIContribution, author: str | None = None) -> dict:
    result = {
        "id": row.id,
        "kind": row.kind,
        "title": row.title,
        "content": row.content,
        "source_url": row.source_url or None,
        "status": row.status,
        "review_note": row.review_note,
        "created_at": iso(row.created_at),
        "reviewed_at": iso(row.reviewed_at),
    }
    if author is not None:
        result["author"] = author
    return result


@router.get("/contributions")
def my_contributions(user: User = Depends(ai_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = (
        db.query(AIContribution)
        .filter_by(author_id=user.id)
        .order_by(AIContribution.created_at.desc())
        .limit(100)
        .all()
    )
    return [contribution_json(row) for row in rows]


@router.post("/contributions", status_code=201)
def contribute(data: ContributionIn, user: User = Depends(ai_user), db: Session = Depends(get_db)) -> dict:
    if not data.share_with_reviewers:
        raise HTTPException(
            status_code=422,
            detail="Confirm that this submission may be shared with reviewers and published if approved.",
        )
    title, content = nonblank(data.title, "Title"), nonblank(data.content, "Contribution")
    try:
        source = service.safe_source_url(data.source_url)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    digest = service.fingerprint(title, content)
    if db.query(AIKnowledge).filter_by(fingerprint=digest, active=True).first():
        raise HTTPException(status_code=409, detail="An exact matching note is already in the shared library.")
    if db.query(AIContribution).filter_by(author_id=user.id, fingerprint=digest, status="pending").first():
        raise HTTPException(status_code=409, detail="You already have this exact submission awaiting review.")
    row = AIContribution(
        author_id=user.id, kind=data.kind, title=title, content=content, source_url=source, fingerprint=digest
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return contribution_json(row)


@router.delete("/contributions/{contribution_id}", status_code=204)
def withdraw_contribution(
    contribution_id: str, user: User = Depends(ai_user), db: Session = Depends(get_db)
) -> Response:
    row = db.query(AIContribution).filter_by(id=contribution_id, author_id=user.id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Submission not found.")
    # Atomic conditional delete prevents a withdrawal racing an admin approval.
    from sqlalchemy import delete

    result = db.execute(
        delete(AIContribution).where(
            AIContribution.id == contribution_id,
            AIContribution.author_id == user.id,
            AIContribution.status == "pending",
        )
    )
    if not result.rowcount:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Only a pending submission can be withdrawn; ask an admin to remove a published note.",
        )
    db.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.get("/review")
def review_queue(user: User = Depends(admin_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = (
        db.query(AIContribution, User)
        .join(User, User.id == AIContribution.author_id)
        .filter(AIContribution.status == "pending")
        .order_by(AIContribution.created_at.asc())
        .limit(100)
        .all()
    )
    return [contribution_json(row, author.ign or author.name) for row, author in rows]


@router.post("/review/{contribution_id}")
def review(
    contribution_id: str, data: ReviewIn, user: User = Depends(admin_user), db: Session = Depends(get_db)
) -> dict:
    note = nonblank(data.note, "Review note")
    if not data.reviewed:
        raise HTTPException(status_code=422, detail="Confirm you reviewed the submission before deciding.")
    row = db.query(AIContribution).filter_by(id=contribution_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Submission not found.")
    if row.status != "pending":
        raise HTTPException(status_code=409, detail="This submission has already been reviewed.")
    # Questions and feedback can be answered/acknowledged, but are not facts to
    # publish as guidance. A reviewer can submit a separate sourced note instead.
    publishes = data.decision == "approve" and row.kind not in {"question", "feedback"}
    if publishes and db.query(AIKnowledge).filter_by(fingerprint=row.fingerprint).first():
        raise HTTPException(
            status_code=409, detail="An exact matching note is already in the library; reject the duplicate instead."
        )
    state = "approved" if publishes else ("reviewed" if data.decision == "approve" else "rejected")
    reviewed_at = utcnow()
    # Conditional update works on SQLite as well as databases with row locks,
    # so concurrent reviewers cannot publish a note and reject the same item.
    claimed = db.execute(
        update(AIContribution)
        .where(AIContribution.id == row.id, AIContribution.status == "pending")
        .values(status=state, review_note=note, reviewed_by=user.id, reviewed_at=reviewed_at)
    )
    if not claimed.rowcount:
        db.rollback()
        raise HTTPException(status_code=409, detail="This submission has already been reviewed.")
    if publishes:
        db.add(
            AIKnowledge(
                contribution_id=row.id,
                title=row.title,
                content=row.content,
                source_url=row.source_url,
                fingerprint=row.fingerprint,
                reviewed_at=reviewed_at,
            )
        )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A matching note was approved concurrently.") from None
    db.refresh(row)
    return contribution_json(row)
