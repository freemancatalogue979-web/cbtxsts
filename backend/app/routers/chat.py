"""Direct chat between players: text, duel invites and quiz plans."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_student
from ..events import dispatch, to_student
from ..models import ChatMessage, Duel, DuelParticipant, Friendship, Student, utcnow
from ..schemas import ChatEditIn, ChatReactIn, ChatReportIn, ChatSendIn

router = APIRouter(prefix="/chat", tags=["chat"])


DELETED_BODY = "This message was deleted"


def _serialize(message: ChatMessage, viewer_id: int | None = None) -> dict:
    from ..serializers import iso

    try:
        reactions = json.loads(message.reactions or "{}")
    except ValueError:
        reactions = {}
    deleted = bool(message.deleted)
    return {
        "id": message.id,
        "sender_id": message.sender_id,
        "recipient_id": message.recipient_id,
        "kind": message.kind,
        "body": "" if deleted else message.body,
        "meta": json.loads(message.meta or "{}"),
        "created_at": iso(message.created_at),
        "read": message.read_at is not None,
        "edited_at": iso(message.edited_at) if message.edited_at else None,
        "deleted": deleted,
        "reactions": {emoji: len(ids) for emoji, ids in reactions.items()},
        # Only the viewer's own reactions: nobody else's taps leak into your UI.
        "my_reactions": [
            emoji for emoji, ids in reactions.items() if isinstance(ids, list) and viewer_id in ids
        ],
    }


def _can_talk(db: Session, me: int, other: int) -> bool:
    """Friends (accepted or pending) and past duel opponents may message each other."""
    friend = db.scalar(
        select(Friendship.id).where(
            or_(
                (Friendship.student_id == me) & (Friendship.friend_id == other),
                (Friendship.student_id == other) & (Friendship.friend_id == me),
            )
        )
    )
    if friend:
        return True
    duel = db.scalar(
        select(Duel.id)
        .join(DuelParticipant, DuelParticipant.duel_id == Duel.id)
        .where(
            DuelParticipant.student_id == me,
            Duel.id.in_(select(DuelParticipant.duel_id).where(DuelParticipant.student_id == other)),
        )
    )
    return duel is not None


@router.get("")
def history(
    with_id: int = Query(alias="with"),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    rows = db.scalars(
        select(ChatMessage)
        .where(
            or_(
                (ChatMessage.sender_id == student.id) & (ChatMessage.recipient_id == with_id),
                (ChatMessage.sender_id == with_id) & (ChatMessage.recipient_id == student.id),
            )
        )
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .limit(120)
    ).all()
    return {"messages": [_serialize(row, student.id) for row in reversed(rows)]}


@router.get("/unread")
def unread(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    rows = db.execute(
        select(ChatMessage.sender_id, func.count(ChatMessage.id))
        .where(ChatMessage.recipient_id == student.id, ChatMessage.read_at.is_(None))
        .group_by(ChatMessage.sender_id)
    ).all()
    per_friend = {sender_id: count for sender_id, count in rows}
    return {"total": sum(per_friend.values()), "per_friend": per_friend}


@router.post("/read")
def mark_read(
    with_id: int = Query(alias="with"),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    now = utcnow()
    rows = db.scalars(
        select(ChatMessage).where(
            ChatMessage.sender_id == with_id,
            ChatMessage.recipient_id == student.id,
            ChatMessage.read_at.is_(None),
        )
    ).all()
    for row in rows:
        row.read_at = now
    db.commit()
    return {"marked": len(rows)}


@router.patch("/{message_id}")
async def edit_message(
    message_id: int,
    payload: ChatEditIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Edit your own message. The original text is kept for honest history."""
    message = db.get(ChatMessage, message_id)
    if message is None or message.sender_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found.")
    if message.deleted:
        raise HTTPException(status.HTTP_409_CONFLICT, "That message was deleted.")
    body = payload.body.strip()
    if not body:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A message cannot be empty.")
    if not message.original_body:
        message.original_body = message.body
    message.body = body
    message.edited_at = utcnow()
    db.commit()
    db.refresh(message)
    await dispatch(
        [
            to_student(message.recipient_id, "chat_edit", _serialize(message, message.recipient_id)),
            to_student(message.sender_id, "chat_edit", _serialize(message, message.sender_id)),
        ]
    )
    return _serialize(message, student.id)


@router.delete("/{message_id}")
async def delete_message(
    message_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Delete your own message for both sides (a tombstone keeps the thread honest)."""
    message = db.get(ChatMessage, message_id)
    if message is None or message.sender_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found.")
    message.deleted = True
    message.body = ""
    db.commit()
    db.refresh(message)
    await dispatch(
        [
            to_student(message.recipient_id, "chat_edit", _serialize(message, message.recipient_id)),
            to_student(message.sender_id, "chat_edit", _serialize(message, message.sender_id)),
        ]
    )
    return _serialize(message, student.id)


@router.post("/{message_id}/react")
async def react_message(
    message_id: int,
    payload: ChatReactIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Toggle one emoji reaction on a message you can see."""
    message = db.get(ChatMessage, message_id)
    if message is None or student.id not in {message.sender_id, message.recipient_id}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found.")
    if message.deleted:
        raise HTTPException(status.HTTP_409_CONFLICT, "That message was deleted.")
    emoji = payload.emoji.strip()[:8]
    if not emoji:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Pick an emoji to react with.")
    try:
        reactions = json.loads(message.reactions or "{}")
    except ValueError:
        reactions = {}
    ids = [int(value) for value in reactions.get(emoji, []) if isinstance(value, (int, str)) and str(value).isdigit()]
    if student.id in ids:
        ids = [value for value in ids if value != student.id]
    else:
        ids.append(student.id)
    if ids:
        reactions[emoji] = ids
    else:
        reactions.pop(emoji, None)
    message.reactions = json.dumps(reactions)[:2000]
    db.commit()
    db.refresh(message)
    await dispatch(
        [
            to_student(message.recipient_id, "chat_edit", _serialize(message, message.recipient_id)),
            to_student(message.sender_id, "chat_edit", _serialize(message, message.sender_id)),
        ]
    )
    return _serialize(message, student.id)


@router.post("/{message_id}/report")
def report_message(
    message_id: int,
    payload: ChatReportIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Flag a message for the staff moderation queue."""
    message = db.get(ChatMessage, message_id)
    if message is None or student.id not in {message.sender_id, message.recipient_id}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found.")
    from ..models import ContentReport

    report = ContentReport(
        kind="chat_message",
        target_id=message.id,
        reporter_id=student.id,
        reason=payload.reason.strip()[:400] or "Reported from chat",
        status="open",
    )
    db.add(report)
    db.commit()
    return {"ok": True, "report_id": report.id, "status": report.status}


@router.post("")
async def send(
    payload: ChatSendIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    other = db.get(Student, payload.to)
    if other is None or other.id == student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No player found to message.")
    if not _can_talk(db, student.id, other.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Add each other as friends (or duel once) to chat.")

    message = ChatMessage(
        sender_id=student.id,
        recipient_id=other.id,
        kind=payload.kind,
        body=payload.body.strip(),
        meta=json.dumps(payload.meta, default=str)[:2000],
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    serialized = _serialize(message, student.id)
    serialized["sender_name"] = student.name
    await dispatch(
        [
            to_student(other.id, "chat", serialized),
            to_student(student.id, "chat", serialized),
        ]
    )
    return serialized
