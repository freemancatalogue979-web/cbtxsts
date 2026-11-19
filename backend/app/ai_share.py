"""Shared AI answers and chat snapshots: what a share link shows, with private bits removed."""

from __future__ import annotations

import secrets
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from .ai_privacy import public_ai_mode, public_ai_text
from .clover_ai_models import AIConversation, AIMessage, AIShare
from .models import User, loads

SHARE_MESSAGE_LIMIT = 400
# Personal context and learned memories stay private even inside a shared chat.
PRIVATE_SOURCE_KINDS = {"personal", "learned"}
EXCERPT_KINDS = {"web", "community", "hero", "esports_feed"}


def new_token() -> str:
    return secrets.token_urlsafe(24)


def iso(value):  # noqa: ANN001
    return value.isoformat() + "Z" if value else None


def _safe_url(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    parsed = urlparse(value.strip())
    return value.strip() if parsed.scheme in {"http", "https"} and parsed.netloc else None


def shared_source(source: object) -> dict | None:
    """Keep what helps a reader (label, link, visual card), drop ids, routes and private kinds."""
    if not isinstance(source, dict):
        return None
    kind = str(source.get("kind") or "")
    if kind in PRIVATE_SOURCE_KINDS:
        return None
    out: dict = {"kind": kind, "label": public_ai_text(str(source.get("label") or ""))[:200]}
    url = _safe_url(source.get("url"))
    if url:
        out["url"] = url
    if kind in EXCERPT_KINDS and isinstance(source.get("excerpt"), str):
        out["excerpt"] = public_ai_text(source["excerpt"])[:400]
    for key in ("published_at", "match_id"):
        if isinstance(source.get(key), str):
            out[key] = source[key]
    if isinstance(source.get("visual"), dict):
        out["visual"] = source["visual"]
    return out


def shared_message(row: AIMessage) -> dict:
    assistant = row.role == "assistant"
    sources = loads(row.sources_json, [])
    cleaned = [s for s in (shared_source(item) for item in sources) if s] if isinstance(sources, list) else []
    if not assistant:
        # A member's own message keeps only what they attached (matches, boards), never context.
        cleaned = [s for s in cleaned if s["kind"] in {"match", "draft", "map"} or s.get("match_id")]
    return {
        "id": row.id,
        "role": "assistant" if assistant else "user",
        "content": public_ai_text(row.content) if assistant else row.content,
        "mode": public_ai_mode(row.mode) if assistant else "user",
        "note": public_ai_text(row.note) if assistant else "",
        "sources": cleaned,
        "created_at": iso(row.created_at),
    }


def share_kind(row: AIShare) -> str:
    return "message" if row.message_id else "chat"


def share_json(row: AIShare) -> dict:
    return {
        "token": row.token,
        "kind": share_kind(row),
        "title": row.title,
        "audience": row.audience,
        "conversation_id": row.conversation_id,
        "message_id": row.message_id,
        "views": row.views,
        "created_at": iso(row.created_at),
        "last_viewed_at": iso(row.last_viewed_at),
        "path": f"/#/share/{row.token}",
    }


def shared_messages(db: Session, row: AIShare) -> list[AIMessage]:
    base = db.query(AIMessage).filter(AIMessage.conversation_id == row.conversation_id)
    if row.message_id:
        target = base.filter(AIMessage.id == row.message_id).first()
        if target is None:
            return []
        out = [target]
        if row.include_prompt and target.role == "assistant":
            prompt = (
                base.filter(AIMessage.id < target.id, AIMessage.role == "user")
                .order_by(AIMessage.id.desc())
                .first()
            )
            if prompt is not None:
                out.insert(0, prompt)
        return out
    return (
        base.filter(AIMessage.id <= row.through_message_id)
        .order_by(AIMessage.id.asc())
        .limit(SHARE_MESSAGE_LIMIT)
        .all()
    )


def sharer_json(user: User | None) -> dict:
    if user is None:
        return {"name": "A 9 Clover member"}
    return {"name": (user.ign or user.name or "A 9 Clover member").strip()}


def public_share(db: Session, row: AIShare) -> dict | None:
    conversation = db.get(AIConversation, row.conversation_id)
    if conversation is None or conversation.owner_id != row.owner_id:
        return None
    messages = shared_messages(db, row)
    if not messages:
        return None
    return {
        "kind": share_kind(row),
        "title": row.title or conversation.title,
        "audience": row.audience,
        "shared_by": sharer_json(db.get(User, row.owner_id)),
        "created_at": iso(row.created_at),
        "messages": [shared_message(message) for message in messages],
        "truncated": share_kind(row) == "chat" and len(messages) >= SHARE_MESSAGE_LIMIT,
    }
