"""Study groups — the full community workspace API.

One router owns the group page: overview, chat (paginated, with replies,
edits, deletes and reactions), announcements, group quizzes, the Q&A board,
members with roles, duels scoped to the group, the activity feed, per-member
notifications, analytics and search. Every privileged action is re-checked
here against the membership role — the browser never decides permissions.
"""
from __future__ import annotations

import json
import random
import string
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import game
from ..db import get_db
from ..deps import require_student
from ..events import dispatch, to_room, to_student
from ..models import (
    ChatMessage,
    Course,
    Duel,
    DuelParticipant,
    Friendship,
    GroupMessage,
    Question,
    Student,
    StudyGroup,
    StudyGroupActivity,
    StudyGroupAnnouncement,
    StudyGroupMember,
    StudyGroupNotification,
    StudyGroupQuestion,
    StudyGroupQuestionReply,
    StudyGroupQuiz,
    StudyGroupQuizParticipant,
    utcnow,
)
from ..schemas import (
    GroupAnnouncementIn,
    GroupAnnouncementPatchIn,
    GroupDuelIn,
    GroupEditIn,
    GroupInviteIn,
    GroupQuestionIn,
    GroupQuizAnswerIn,
    GroupQuizIn,
    GroupReactIn,
    GroupReplyIn,
    GroupRoleIn,
    GroupSendIn,
    GroupSettingsIn,
    StudyGroupIn,
)
from ..serializers import duel_public, iso, student_public
from ..services import duel as duel_service
from ..services import group as group_service
from ..services.group import GroupError, group_room, log_activity, notify_members

router = APIRouter(prefix="/groups", tags=["groups"])

REACT_EMOJIS = {"👍", "❤️", "😂", "🔥", "🎉", "😮", "🤔", "✅"}


def _fail(error: GroupError) -> HTTPException:
    return HTTPException(error.status, str(error))


def _group_or_404(db: Session, group_id: int) -> StudyGroup:
    try:
        return group_service.require_group(db, group_id)
    except GroupError as error:
        raise _fail(error) from error


def _serialize_message(db: Session, row: GroupMessage, viewer_id: int) -> dict:
    reply = db.get(GroupMessage, row.reply_to_id) if row.reply_to_id else None
    return group_service.message_public(row, viewer_id=viewer_id, reply=reply)


def _make_group_code(db: Session) -> str:
    alphabet = string.ascii_uppercase.replace("O", "").replace("I", "") + "23456789"
    for _ in range(20):
        code = "".join(random.choice(alphabet) for _ in range(6))
        if not db.scalar(select(StudyGroup.id).where(StudyGroup.code == code)):
            return code
    return f"G{random.randint(10000, 99999)}"


# ---------------------------------------------------------------------------
# Listing, creation, joining
# ---------------------------------------------------------------------------
@router.get("")
def list_groups(
    q: str = Query(""),
    page: int = Query(1, ge=1),
    size: int = Query(12, ge=1, le=50),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """My groups and discoverable groups, both paginated."""
    membership_rows = db.scalars(
        select(StudyGroupMember).where(StudyGroupMember.student_id == student.id)
    ).all()
    my_ids = [row.group_id for row in membership_rows]
    query = select(StudyGroup)
    if q.strip():
        needle = f"%{q.strip().lower()}%"
        query = query.where(or_(func.lower(StudyGroup.name).like(needle), func.lower(StudyGroup.description).like(needle)))
    all_groups = list(db.scalars(query.order_by(StudyGroup.id.desc())).all())
    mine = [group for group in all_groups if group.id in set(my_ids)]
    discover = [group for group in all_groups if group.id not in set(my_ids)]

    def window(rows: list[StudyGroup]) -> tuple[list[dict], int]:
        total = len(rows)
        start = (page - 1) * size
        return [group_service.group_public(db, group, student) for group in rows[start : start + size]], total

    mine_payload, mine_total = window(mine)
    discover_payload, discover_total = window(discover)
    return {
        "mine": {"items": mine_payload, **group_service.page_meta(page, size, mine_total)},
        "discover": {"items": discover_payload, **group_service.page_meta(page, size, discover_total)},
    }


@router.post("")
async def create_group(
    payload: StudyGroupIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = StudyGroup(
        code=_make_group_code(db),
        name=payload.name.strip(),
        description=payload.description[:300],
        owner_id=student.id,
        course_id=payload.course_id,
        goal=payload.goal[:200],
    )
    db.add(group)
    db.flush()
    db.add(StudyGroupMember(group_id=group.id, student_id=student.id, role="owner"))
    db.flush()
    _, events = log_activity(
        db, group, kind="system", text=f"{student.name.split(' ')[0]} created the group.", actor=student
    )
    db.commit()
    await dispatch(events)
    return group_service.group_public(db, group, student)


@router.post("/join/{code}")
async def join_group(
    code: str,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = db.scalar(select(StudyGroup).where(StudyGroup.code == code.strip().upper()))
    if group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No study group with that code.")
    existing = group_service.membership(db, group.id, student.id)
    events = []
    if existing is None:
        db.add(StudyGroupMember(group_id=group.id, student_id=student.id, role="member"))
        db.flush()
        _, join_events = log_activity(
            db, group, kind="join", text=f"{student.name.split(' ')[0]} joined the group.", actor=student
        )
        events += join_events
        events += notify_members(
            db,
            group,
            [student.id],
            kind="member",
            title="Welcome to the group",
            message=f"You joined {group.name}. Say hi in the chat!",
        )
        db.commit()
    if events:
        await dispatch(events)
    return group_service.group_public(db, group, student)


@router.post("/{group_id}/join")
async def join_group_by_id(
    group_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Join from the discover card (no code typing)."""
    group = _group_or_404(db, group_id)
    if group_service.membership(db, group.id, student.id) is None:
        db.add(StudyGroupMember(group_id=group.id, student_id=student.id, role="member"))
        db.flush()
        _, events = log_activity(
            db, group, kind="join", text=f"{student.name.split(' ')[0]} joined the group.", actor=student
        )
        db.commit()
        await dispatch(events)
    return group_service.group_public(db, group, student)


@router.post("/{group_id}/leave")
async def leave_group(
    group_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    member = group_service.membership(db, group.id, student.id)
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "You are not in this group.")
    if member.role == "owner":
        raise HTTPException(status.HTTP_409_CONFLICT, "The owner cannot leave — transfer ownership or remove the group first.")
    db.delete(member)
    db.flush()
    _, events = log_activity(
        db, group, kind="member", text=f"{student.name.split(' ')[0]} left the group.", actor=student
    )
    db.commit()
    await dispatch(events)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Group home + overview dashboard
# ---------------------------------------------------------------------------
@router.get("/{group_id}")
def group_detail(
    group_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    payload = group_service.group_public(db, group, student)
    payload["online"] = len(group_service.online_member_ids(group.id))
    if payload["is_member"]:
        payload["unread_notifications"] = int(
            db.scalar(
                select(func.count(StudyGroupNotification.id)).where(
                    StudyGroupNotification.group_id == group.id,
                    StudyGroupNotification.student_id == student.id,
                    StudyGroupNotification.read_at.is_(None),
                )
            )
            or 0
        )
    return payload


@router.get("/{group_id}/overview")
def group_overview(
    group_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """The dashboard payload — one request feeds the whole command centre."""
    group = _group_or_404(db, group_id)
    member = group_service.membership(db, group.id, student.id)
    if member is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Join the group first.")
    now = utcnow()
    online_ids = group_service.online_member_ids(group.id)

    owner = db.get(Student, group.owner_id)
    course = db.get(Course, group.course_id) if group.course_id else None

    # Upcoming + live quizzes (lazy status refresh happens inside quiz_public).
    quizzes = list(
        db.scalars(select(StudyGroupQuiz).where(StudyGroupQuiz.group_id == group.id).order_by(StudyGroupQuiz.id.desc()).limit(30)).all()
    )
    upcoming = [
        group_service.quiz_public(db, quiz, viewer_id=student.id)
        for quiz in quizzes
        if group_service._refresh_quiz_status(db, quiz) is None and quiz.status in {"scheduled", "live"}
    ][:6]

    # Active duels that are public to the group (private duels stay private).
    duel_rows = list(
        db.scalars(
            select(Duel)
            .where(Duel.group_id == group.id, Duel.status.in_(["invited", "live"]))
            .order_by(Duel.id.desc())
            .limit(10)
        ).all()
    )
    active_duels = []
    for duel in duel_rows:
        participants = {p.student_id for p in duel.participants}
        if not duel.group_public and student.id not in participants:
            continue
        names = [p.student.name.split(" ")[0] if p.student else "?" for p in duel.participants]
        active_duels.append(
            {
                "id": duel.id,
                "code": duel.code,
                "status": duel.status,
                "topic": duel.topic,
                "public": bool(duel.group_public),
                "names": names,
                "i_am_in": student.id in participants,
            }
        )

    announcements = _visible_announcements(db, group, student, member.role)
    recent_announcements = [group_service.announcement_public(row) for row in announcements[:4]]
    pinned = [group_service.announcement_public(row) for row in announcements if row.pinned][:3]

    questions = list(
        db.scalars(
            select(StudyGroupQuestion)
            .where(StudyGroupQuestion.group_id == group.id)
            .order_by(StudyGroupQuestion.id.desc())
            .limit(5)
        ).all()
    )
    recent_questions = [group_service.question_public(db, row, viewer_id=student.id) for row in questions]

    activities = list(
        db.scalars(
            select(StudyGroupActivity)
            .where(StudyGroupActivity.group_id == group.id)
            .order_by(StudyGroupActivity.id.desc())
            .limit(10)
        ).all()
    )

    # Group statistics.
    member_count = int(db.scalar(select(func.count(StudyGroupMember.id)).where(StudyGroupMember.group_id == group.id)) or 0)
    messages_week = int(
        db.scalar(
            select(func.count(GroupMessage.id)).where(
                GroupMessage.group_id == group.id,
                GroupMessage.created_at >= now - timedelta(days=7),
            )
        )
        or 0
    )
    quiz_count = len(quizzes)
    submitted_attempts = list(
        db.scalars(
            select(StudyGroupQuizParticipant)
            .where(
                StudyGroupQuizParticipant.quiz_id.in_(select(StudyGroupQuiz.id).where(StudyGroupQuiz.group_id == group.id)),
                StudyGroupQuizParticipant.status == "submitted",
            )
            .limit(1000)
        ).all()
    )
    average_score = (
        round(sum(row.percentage for row in submitted_attempts) / len(submitted_attempts), 1) if submitted_attempts else 0.0
    )
    question_total = int(
        db.scalar(select(func.count(StudyGroupQuestion.id)).where(StudyGroupQuestion.group_id == group.id)) or 0
    )
    open_questions = int(
        db.scalar(
            select(func.count(StudyGroupQuestion.id)).where(
                StudyGroupQuestion.group_id == group.id, StudyGroupQuestion.status == "open"
            )
        )
        or 0
    )
    studying_now = [
        {**group_service._student_chip(db.get(Student, sid)), "status": "online"}
        for sid in sorted(online_ids)[:8]
    ]

    return {
        "group": group_service.group_public(db, group, student),
        "owner": group_service._student_chip(owner) if owner else None,
        "course_title": course.title if course else "",
        "member_count": member_count,
        "online": len(online_ids),
        "online_ids": sorted(online_ids),
        "studying_now": studying_now,
        "upcoming_quizzes": upcoming,
        "active_duels": active_duels[:5],
        "pinned_announcements": pinned,
        "recent_announcements": recent_announcements,
        "recent_questions": recent_questions,
        "recent_activity": [group_service.activity_public(row) for row in activities],
        "stats": {
            "quizzes": quiz_count,
            "average_score": average_score,
            "messages_week": messages_week,
            "questions": question_total,
            "open_questions": open_questions,
            "duels": int(db.scalar(select(func.count(Duel.id)).where(Duel.group_id == group.id)) or 0),
        },
        "unread_notifications": int(
            db.scalar(
                select(func.count(StudyGroupNotification.id)).where(
                    StudyGroupNotification.group_id == group.id,
                    StudyGroupNotification.student_id == student.id,
                    StudyGroupNotification.read_at.is_(None),
                )
            )
            or 0
        ),
    }


@router.get("/{group_id}/presence")
def group_presence(
    group_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Online/away/offline per member — derived from the socket hub, no polling."""
    group = _group_or_404(db, group_id)
    if group_service.membership(db, group.id, student.id) is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Join the group first.")
    rows = db.scalars(select(StudyGroupMember).where(StudyGroupMember.group_id == group.id)).all()
    payload = {}
    for row in rows:
        payload[str(row.student_id)] = group_service.presence_status(row.student_id, group.id)
    online = sum(1 for value in payload.values() if value == "online")
    return {"group_id": group.id, "statuses": payload, "online": online}


# ---------------------------------------------------------------------------
# Chat — paginated history, replies, edits, deletes, reactions
# ---------------------------------------------------------------------------
@router.get("/{group_id}/messages")
def messages(
    group_id: int,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=10, le=100),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_member(db, group.id, student)
    query = select(GroupMessage).where(GroupMessage.group_id == group.id).order_by(GroupMessage.id.desc())
    rows, total = group_service.paginate(query, db, page, size)
    # Oldest → newest inside the page; page 1 is the newest window.
    rows = list(reversed(rows))
    reply_ids = {row.reply_to_id for row in rows if row.reply_to_id}
    replies = {row.id: row for row in db.scalars(select(GroupMessage).where(GroupMessage.id.in_(reply_ids or {-1}))).all()} if reply_ids else {}
    return {
        "items": [
            _serialize_message(db, row, student.id) if not row.reply_to_id else group_service.message_public(row, viewer_id=student.id, reply=replies.get(row.reply_to_id))
            for row in rows
        ],
        **group_service.page_meta(page, size, total),
    }


@router.post("/{group_id}/messages")
async def send_message(
    group_id: int,
    payload: GroupSendIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_permission(db, group.id, student, "chat")
    reply = None
    if payload.reply_to_id:
        reply = db.get(GroupMessage, payload.reply_to_id)
        if reply is None or reply.group_id != group.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "That message is not in this group.")
    row = GroupMessage(
        group_id=group.id,
        student_id=student.id,
        body=payload.body.strip()[:2000],
        reply_to_id=reply.id if reply else None,
    )
    db.add(row)
    db.flush()
    serialized = group_service.message_public(row, viewer_id=student.id, reply=reply)
    serialized["sender_name"] = student.name
    events = [to_room(group_room(group.id), "group_message", serialized)]

    # "Someone replied to your message" — a targeted ping, never a group blast.
    if reply is not None and reply.student_id != student.id:
        events += notify_members(
            db,
            group,
            [reply.student_id],
            kind="reply",
            title=f"{student.name.split(' ')[0]} replied to your message",
            message=payload.body.strip()[:160],
            meta={"message_id": row.id},
            inbox=True,
        )
    db.commit()
    await dispatch(events)
    return serialized


@router.patch("/{group_id}/messages/{message_id}")
async def edit_message(
    group_id: int,
    message_id: int,
    payload: GroupEditIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_member(db, group.id, student)
    row = db.get(GroupMessage, message_id)
    if row is None or row.group_id != group.id or row.deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found.")
    if row.student_id != student.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only edit your own messages.")
    if not row.original_body:
        row.original_body = row.body
    row.body = payload.body.strip()[:2000]
    row.edited_at = utcnow()
    db.commit()
    db.refresh(row)
    serialized = _serialize_message(db, row, student.id)
    await dispatch([to_room(group_room(group.id), "group_message_update", serialized)])
    return serialized


@router.delete("/{group_id}/messages/{message_id}")
async def delete_message(
    group_id: int,
    message_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    member = group_service.require_member(db, group.id, student)
    row = db.get(GroupMessage, message_id)
    if row is None or row.group_id != group.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found.")
    is_moderation = row.student_id != student.id and group_service.can(member.role, "moderate_chat")
    if row.student_id != student.id and not is_moderation:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only delete your own messages.")
    row.deleted = True
    row.body = ""
    db.commit()
    db.refresh(row)
    serialized = _serialize_message(db, row, student.id)
    await dispatch([to_room(group_room(group.id), "group_message_update", serialized)])
    return serialized


@router.post("/{group_id}/messages/{message_id}/react")
async def react_message(
    group_id: int,
    message_id: int,
    payload: GroupReactIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_member(db, group.id, student)
    row = db.get(GroupMessage, message_id)
    if row is None or row.group_id != group.id or row.deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found.")
    emoji = payload.emoji.strip()
    if emoji not in REACT_EMOJIS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That reaction is not available.")
    try:
        reactions = json.loads(row.reactions or "{}")
    except ValueError:
        reactions = {}
    ids = [int(v) for v in reactions.get(emoji, []) if str(v).isdigit()]
    ids = [v for v in ids if v != student.id] if student.id in ids else [*ids, student.id]
    if ids:
        reactions[emoji] = ids
    else:
        reactions.pop(emoji, None)
    row.reactions = json.dumps(reactions)[:2000]
    db.commit()
    db.refresh(row)
    serialized = _serialize_message(db, row, student.id)
    await dispatch([to_room(group_room(group.id), "group_message_update", serialized)])
    return serialized


# ---------------------------------------------------------------------------
# Announcements
# ---------------------------------------------------------------------------
def _visible_announcements(db: Session, group: StudyGroup, student: Student, role: str) -> list[StudyGroupAnnouncement]:
    now = utcnow()
    query = select(StudyGroupAnnouncement).where(StudyGroupAnnouncement.group_id == group.id)
    if not group_service.can(role, "manage_announcements"):
        query = query.where(
            or_(
                StudyGroupAnnouncement.scheduled_at.is_(None),
                StudyGroupAnnouncement.scheduled_at <= now,
            )
        )
    rows = list(db.scalars(query.order_by(StudyGroupAnnouncement.pinned.desc(), StudyGroupAnnouncement.id.desc())).all())
    return rows


@router.get("/{group_id}/announcements")
def announcements(
    group_id: int,
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    member = group_service.require_member(db, group.id, student)
    rows = _visible_announcements(db, group, student, member.role)
    total = len(rows)
    start = (page - 1) * size
    return {
        "items": [group_service.announcement_public(row) for row in rows[start : start + size]],
        **group_service.page_meta(page, size, total),
    }


@router.post("/{group_id}/announcements")
async def create_announcement(
    group_id: int,
    payload: GroupAnnouncementIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_permission(db, group.id, student, "publish_announcements")
    row = StudyGroupAnnouncement(
        group_id=group.id,
        author_id=student.id,
        title=payload.title.strip(),
        body=payload.body.strip(),
        image=payload.image[:400_000],
        priority=payload.priority,
        pinned=bool(payload.pinned),
        scheduled_at=payload.scheduled_at,
    )
    db.add(row)
    db.flush()
    scheduled = row.scheduled_at is not None and row.scheduled_at > utcnow()
    events = [
        group_service.broadcast_group(db, group, "group_announcement", {"announcement": group_service.announcement_public(row)})
    ]
    if not scheduled:
        events += notify_members(
            db,
            group,
            group_service.member_ids(db, group.id, exclude=student.id),
            kind="announcement",
            title=f"📢 {row.title}",
            message=row.body[:200],
            meta={"announcement_id": row.id},
        )
        _, activity_events = log_activity(
            db, group, kind="announcement", text=f"{student.name.split(' ')[0]} published an announcement: “{row.title}”.", actor=student
        )
        events += activity_events
    db.commit()
    await dispatch(events)
    return group_service.announcement_public(row)


@router.patch("/{group_id}/announcements/{announcement_id}")
async def update_announcement(
    group_id: int,
    announcement_id: int,
    payload: GroupAnnouncementPatchIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_permission(db, group.id, student, "manage_announcements")
    row = db.get(StudyGroupAnnouncement, announcement_id)
    if row is None or row.group_id != group.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Announcement not found.")
    if payload.title is not None:
        row.title = payload.title.strip()
    if payload.body is not None:
        row.body = payload.body.strip()
    if payload.image is not None:
        row.image = payload.image[:400_000]
    if payload.priority is not None:
        row.priority = payload.priority
    if payload.pinned is not None:
        row.pinned = payload.pinned
    if payload.scheduled_at is not None:
        row.scheduled_at = payload.scheduled_at
    db.commit()
    db.refresh(row)
    serialized = group_service.announcement_public(row)
    await dispatch([group_service.broadcast_group(db, group, "group_announcement", {"announcement": serialized, "action": "updated"})])
    return serialized


@router.delete("/{group_id}/announcements/{announcement_id}")
async def delete_announcement(
    group_id: int,
    announcement_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_permission(db, group.id, student, "manage_announcements")
    row = db.get(StudyGroupAnnouncement, announcement_id)
    if row is None or row.group_id != group.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Announcement not found.")
    db.delete(row)
    db.commit()
    await dispatch([group_service.broadcast_group(db, group, "group_announcement", {"announcement_id": announcement_id, "action": "deleted"})])
    return {"ok": True}


# ---------------------------------------------------------------------------
# Group quizzes
# ---------------------------------------------------------------------------
@router.get("/{group_id}/quizzes")
def quizzes(
    group_id: int,
    filter: str = Query("all"),  # all|upcoming|live|closed|mine
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_member(db, group.id, student)
    rows = list(
        db.scalars(select(StudyGroupQuiz).where(StudyGroupQuiz.group_id == group.id).order_by(StudyGroupQuiz.id.desc())).all()
    )
    for row in rows:
        group_service._refresh_quiz_status(db, row)
    db.commit()
    if filter == "upcoming":
        rows = [row for row in rows if row.status == "scheduled"]
    elif filter == "live":
        rows = [row for row in rows if row.status == "live"]
    elif filter == "closed":
        rows = [row for row in rows if row.status == "closed"]
    elif filter == "mine":
        participated = {
            row.quiz_id
            for row in db.scalars(
                select(StudyGroupQuizParticipant).where(StudyGroupQuizParticipant.student_id == student.id)
            ).all()
        }
        rows = [row for row in rows if row.id in participated]
    total = len(rows)
    start = (page - 1) * size
    return {
        "items": [group_service.quiz_public(db, row, viewer_id=student.id) for row in rows[start : start + size]],
        **group_service.page_meta(page, size, total),
    }


@router.post("/{group_id}/quizzes")
async def create_quiz(
    group_id: int,
    payload: GroupQuizIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_permission(db, group.id, student, "set_quiz")
    if payload.ends_at and payload.starts_at and payload.ends_at <= payload.starts_at:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The end time must be after the start time.")
    try:
        quiz, events = group_service.build_quiz(
            db,
            group,
            student,
            title=payload.title,
            description=payload.description,
            course_id=payload.course_id,
            topic=payload.topic,
            question_count=payload.question_count,
            per_question_seconds=payload.per_question_seconds,
            duration_minutes=payload.duration_minutes,
            starts_at=payload.starts_at,
            ends_at=payload.ends_at,
            max_attempts=payload.max_attempts,
            randomize=payload.randomize,
            reward_xp=payload.reward_xp,
            reward_coins=payload.reward_coins,
            pass_score=payload.pass_score,
        )
        db.commit()
    except GroupError as error:
        db.rollback()
        raise _fail(error) from error
    await dispatch(events)
    return group_service.quiz_public(db, quiz, viewer_id=student.id)


@router.get("/{group_id}/quizzes/{quiz_id}")
def quiz_detail(
    group_id: int,
    quiz_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_member(db, group.id, student)
    quiz = db.get(StudyGroupQuiz, quiz_id)
    if quiz is None or quiz.group_id != group.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quiz not found.")
    group_service._refresh_quiz_status(db, quiz)
    db.commit()
    board, total = group_service.quiz_leaderboard(db, quiz, page=1, size=10)
    return {
        "quiz": group_service.quiz_public(db, quiz, viewer_id=student.id),
        "leaderboard": {"items": board, **group_service.page_meta(1, 10, total)},
    }


@router.get("/{group_id}/quizzes/{quiz_id}/leaderboard")
def quiz_leaderboard(
    group_id: int,
    quiz_id: int,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_member(db, group.id, student)
    quiz = db.get(StudyGroupQuiz, quiz_id)
    if quiz is None or quiz.group_id != group.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quiz not found.")
    board, total = group_service.quiz_leaderboard(db, quiz, page=page, size=size)
    return {"items": board, **group_service.page_meta(page, size, total)}


@router.post("/{group_id}/quizzes/{quiz_id}/join")
async def join_quiz(
    group_id: int,
    quiz_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_permission(db, group.id, student, "join_quizzes")
    quiz = db.get(StudyGroupQuiz, quiz_id)
    if quiz is None or quiz.group_id != group.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quiz not found.")
    try:
        participant, events = group_service.join_quiz(db, group, quiz, student)
        db.commit()
    except GroupError as error:
        db.rollback()
        raise _fail(error) from error
    await dispatch(events)
    window = group_service.quiz_question_window(db, quiz, participant, participant.current_index)
    return {
        "participant_id": participant.id,
        "quiz": group_service.quiz_public(db, quiz, viewer_id=student.id, participant=participant),
        **window,
    }


@router.get("/{group_id}/quizzes/{quiz_id}/question/{index}")
def quiz_question(
    group_id: int,
    quiz_id: int,
    index: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_member(db, group.id, student)
    quiz = db.get(StudyGroupQuiz, quiz_id)
    if quiz is None or quiz.group_id != group.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quiz not found.")
    participant = _my_participation(db, quiz.id, student.id)
    if participant is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Join the quiz first.")
    try:
        return group_service.quiz_question_window(db, quiz, participant, index)
    except GroupError as error:
        raise _fail(error) from error


@router.post("/{group_id}/quizzes/{quiz_id}/answer")
async def answer_quiz(
    group_id: int,
    quiz_id: int,
    payload: GroupQuizAnswerIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_member(db, group.id, student)
    quiz = db.get(StudyGroupQuiz, quiz_id)
    if quiz is None or quiz.group_id != group.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quiz not found.")
    participant = _my_participation(db, quiz.id, student.id)
    if participant is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Join the quiz first.")
    try:
        result = group_service.answer_quiz_question(
            db,
            group,
            quiz,
            participant,
            student,
            question_id=payload.question_id,
            selected=payload.selected,
            elapsed_ms=payload.elapsed_ms,
        )
        db.commit()
    except GroupError as error:
        db.rollback()
        raise _fail(error) from error
    return result


@router.post("/{group_id}/quizzes/{quiz_id}/submit")
async def submit_quiz(
    group_id: int,
    quiz_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_member(db, group.id, student)
    quiz = db.get(StudyGroupQuiz, quiz_id)
    if quiz is None or quiz.group_id != group.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quiz not found.")
    participant = _my_participation(db, quiz.id, student.id)
    if participant is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Join the quiz first.")
    try:
        participant, summary, events = group_service.submit_quiz(db, group, quiz, participant, student)
        db.commit()
    except GroupError as error:
        db.rollback()
        raise _fail(error) from error
    await dispatch(events)
    return summary


def _my_participation(db: Session, quiz_id: int, student_id: int) -> StudyGroupQuizParticipant | None:
    return db.scalar(
        select(StudyGroupQuizParticipant)
        .where(
            StudyGroupQuizParticipant.quiz_id == quiz_id,
            StudyGroupQuizParticipant.student_id == student_id,
            StudyGroupQuizParticipant.status == "in_progress",
        )
        .order_by(StudyGroupQuizParticipant.attempt_no.desc())
    )


@router.delete("/{group_id}/quizzes/{quiz_id}")
async def delete_quiz(
    group_id: int,
    quiz_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Admins can cancel a quiz they published (only before it closes)."""
    group = _group_or_404(db, group_id)
    group_service.require_permission(db, group.id, student, "manage_quizzes")
    quiz = db.get(StudyGroupQuiz, quiz_id)
    if quiz is None or quiz.group_id != group.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quiz not found.")
    if quiz.status == "closed":
        raise HTTPException(status.HTTP_409_CONFLICT, "A closed quiz keeps its history — it cannot be deleted.")
    db.delete(quiz)
    db.flush()
    _, events = log_activity(
        db, group, kind="quiz", text=f"{student.name.split(' ')[0]} cancelled the quiz “{quiz.title}”.", actor=student
    )
    db.commit()
    await dispatch(events + [group_service.broadcast_group(db, group, "group_quiz_update", {"quiz_id": quiz_id, "action": "deleted"})])
    return {"ok": True}


# ---------------------------------------------------------------------------
# Questions board
# ---------------------------------------------------------------------------
@router.get("/{group_id}/questions")
def questions(
    group_id: int,
    filter: str = Query("all"),  # all|unanswered|answered|mine
    q: str = Query(""),
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_member(db, group.id, student)
    query = select(StudyGroupQuestion).where(StudyGroupQuestion.group_id == group.id)
    if filter == "unanswered":
        query = query.where(StudyGroupQuestion.status == "open")
    elif filter == "answered":
        query = query.where(StudyGroupQuestion.status != "open")
    elif filter == "mine":
        query = query.where(StudyGroupQuestion.asker_id == student.id)
    if q.strip():
        needle = f"%{q.strip().lower()}%"
        query = query.where(or_(func.lower(StudyGroupQuestion.title).like(needle), func.lower(StudyGroupQuestion.body).like(needle)))
    query = query.order_by(StudyGroupQuestion.id.desc())
    rows, total = group_service.paginate(query, db, page, size)
    return {
        "items": [group_service.question_public(db, row, viewer_id=student.id) for row in rows],
        **group_service.page_meta(page, size, total),
    }


@router.post("/{group_id}/questions")
async def ask_question(
    group_id: int,
    payload: GroupQuestionIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_permission(db, group.id, student, "ask_questions")
    row = StudyGroupQuestion(
        group_id=group.id,
        asker_id=student.id,
        course_id=payload.course_id,
        topic=payload.topic.strip()[:120],
        title=payload.title.strip(),
        body=payload.body.strip(),
        attachment=payload.attachment[:400_000],
    )
    db.add(row)
    db.flush()
    events = [
        group_service.broadcast_group(db, group, "group_question", {"question": group_service.question_public(db, row, viewer_id=student.id)})
    ]
    _, activity_events = log_activity(
        db, group, kind="question", text=f"{student.name.split(' ')[0]} posted a question: “{row.title[:60]}”.", actor=student, meta={"question_id": row.id}
    )
    events += activity_events
    events += notify_members(
        db,
        group,
        group_service.member_ids(db, group.id, exclude=student.id)[:50],
        kind="question",
        title="New question posted",
        message=row.title[:160],
        meta={"question_id": row.id},
    )
    db.commit()
    await dispatch(events)
    return group_service.question_public(db, row, viewer_id=student.id, include_replies=True)


@router.get("/{group_id}/questions/{question_id}")
def question_detail(
    group_id: int,
    question_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_member(db, group.id, student)
    row = db.get(StudyGroupQuestion, question_id)
    if row is None or row.group_id != group.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found.")
    return group_service.question_public(db, row, viewer_id=student.id, include_replies=True)


@router.post("/{group_id}/questions/{question_id}/answers")
async def answer_question(
    group_id: int,
    question_id: int,
    payload: GroupReplyIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_permission(db, group.id, student, "answer_questions")
    question = db.get(StudyGroupQuestion, question_id)
    if question is None or question.group_id != group.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found.")
    if payload.parent_id:
        parent = db.get(StudyGroupQuestionReply, payload.parent_id)
        if parent is None or parent.question_id != question.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "That reply is not on this question.")
    row = StudyGroupQuestionReply(
        question_id=question.id,
        student_id=student.id,
        parent_id=payload.parent_id,
        body=payload.body.strip()[:4000],
    )
    db.add(row)
    question.answers_count = (question.answers_count or 0) + 1
    if question.status == "open":
        question.status = "answered"
    db.flush()
    events = [
        group_service.broadcast_group(
            db, group, "group_question_update", {"question_id": question.id, "reply": group_service.reply_public(row, viewer_id=student.id)}
        )
    ]
    # Notify the asker (and the parent author for threaded replies).
    targets = {question.asker_id}
    if payload.parent_id:
        parent = db.get(StudyGroupQuestionReply, payload.parent_id)
        if parent and parent.student_id:
            targets.add(parent.student_id)
    targets.discard(student.id)
    if targets:
        events += notify_members(
            db,
            group,
            sorted(targets),
            kind="reply",
            title=f"{student.name.split(' ')[0]} replied to “{question.title[:40]}”",
            message=row.body[:160],
            meta={"question_id": question.id},
            inbox=True,
        )
    _, activity_events = log_activity(
        db, group, kind="answer", text=f"{student.name.split(' ')[0]} answered “{question.title[:50]}”.", actor=student, meta={"question_id": question.id}
    )
    events += activity_events
    db.commit()
    await dispatch(events)
    return group_service.reply_public(row, viewer_id=student.id)


@router.post("/{group_id}/questions/{question_id}/answers/{reply_id}/useful")
async def mark_useful(
    group_id: int,
    question_id: int,
    reply_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_member(db, group.id, student)
    row = db.get(StudyGroupQuestionReply, reply_id)
    if row is None or row.question_id != question_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reply not found.")
    question = db.get(StudyGroupQuestion, question_id)
    if question is None or question.group_id != group.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found.")
    try:
        ids = [int(v) for v in json.loads(row.useful or "[]")]
    except ValueError:
        ids = []
    ids = [v for v in ids if v != student.id] if student.id in ids else [*ids, student.id]
    row.useful = json.dumps(ids)
    db.commit()
    db.refresh(row)
    return group_service.reply_public(row, viewer_id=student.id)


@router.post("/{group_id}/questions/{question_id}/answers/{reply_id}/best")
async def mark_best(
    group_id: int,
    question_id: int,
    reply_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """The asker or a moderator pins the best answer."""
    group = _group_or_404(db, group_id)
    member = group_service.require_member(db, group.id, student)
    question = db.get(StudyGroupQuestion, question_id)
    if question is None or question.group_id != group.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found.")
    if question.asker_id != student.id and not group_service.can(member.role, "moderate_questions"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the asker or a moderator can pick the best answer.")
    row = db.get(StudyGroupQuestionReply, reply_id)
    if row is None or row.question_id != question.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reply not found.")
    for previous in db.scalars(
        select(StudyGroupQuestionReply).where(
            StudyGroupQuestionReply.question_id == question.id, StudyGroupQuestionReply.is_best.is_(True)
        )
    ).all():
        previous.is_best = False
    toggling_off = question.best_answer_id == row.id
    row.is_best = not toggling_off
    question.best_answer_id = None if toggling_off else row.id
    question.resolved = not toggling_off
    question.status = "open" if toggling_off and question.answers_count == 0 else "answered"
    db.commit()
    db.refresh(row)
    await dispatch(
        [
            group_service.broadcast_group(
                db, group, "group_question_update", {"question_id": question.id, "best_answer_id": question.best_answer_id}
            )
        ]
    )
    return group_service.reply_public(row, viewer_id=student.id)


# ---------------------------------------------------------------------------
# Members, roles, invites, dossiers
# ---------------------------------------------------------------------------
@router.get("/{group_id}/members")
def members(
    group_id: int,
    filter: str = Query("all"),  # all|online|admins|moderators|active
    q: str = Query(""),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_member(db, group.id, student)
    week_key = game.week_key()
    query = select(StudyGroupMember).where(StudyGroupMember.group_id == group.id)
    if filter == "admins":
        query = query.where(StudyGroupMember.role == "owner")
    elif filter == "moderators":
        query = query.where(StudyGroupMember.role.in_(["owner", "moderator"]))
    if q.strip():
        needle = f"%{q.strip().lower()}%"
        query = query.join(Student, Student.id == StudyGroupMember.student_id).where(
            or_(func.lower(Student.name).like(needle), func.lower(Student.username).like(needle))
        )
    if filter == "active":
        query = query.order_by(StudyGroupMember.week_xp.desc(), StudyGroupMember.id.asc())
    else:
        query = query.order_by(StudyGroupMember.id.asc())
    rows, total = group_service.paginate(query, db, page, size)
    items = []
    for row in rows:
        payload = group_service.member_public(row, week_key=week_key)
        payload["status"] = group_service.presence_status(row.student_id, group.id)
        items.append(payload)
    if filter == "online":
        items = [item for item in items if item["status"] in {"online", "away"}]
    return {"items": items, **group_service.page_meta(page, size, total)}


@router.patch("/{group_id}/members/{student_id}")
async def set_member_role(
    group_id: int,
    student_id: int,
    payload: GroupRoleIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_permission(db, group.id, student, "assign_moderators")
    target = group_service.membership(db, group.id, student_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That member is not in this group.")
    if target.role == "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "The owner's role cannot be changed here.")
    target.role = payload.role
    db.commit()
    target_student = db.get(Student, student_id)
    label = "a moderator" if payload.role == "moderator" else "a member"
    events = [
        group_service.broadcast_group(
            db, group, "group_member_update", {"student_id": student_id, "role": payload.role}
        )
    ]
    _, activity_events = log_activity(
        db,
        group,
        kind="member",
        text=f"{student.name.split(' ')[0]} made {(target_student.name.split(' ')[0]) if target_student else 'a member'} {label}.",
        actor=student,
    )
    events += activity_events
    events += notify_members(
        db, group, [student_id], kind="member", title="Your group role changed",
        message=f"You are now {label} of {group.name}.",
        inbox=True,
    )
    await dispatch(events)
    return {"ok": True, "student_id": student_id, "role": payload.role}


@router.delete("/{group_id}/members/{student_id}")
async def remove_member(
    group_id: int,
    student_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    member = group_service.require_permission(db, group.id, student, "remove_members")
    target = group_service.membership(db, group.id, student_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That member is not in this group.")
    if target.role == "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "The owner cannot be removed.")
    # Moderators cannot remove other moderators (or themselves above their rank).
    if group_service.role_rank(target.role) >= group_service.role_rank(member.role) and student_id != student.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot remove a member with your rank or higher.")
    db.delete(target)
    db.flush()
    _, events = log_activity(
        db, group, kind="member", text=f"{student.name.split(' ')[0]} removed a member from the group.", actor=student
    )
    db.commit()
    await dispatch(events + [group_service.broadcast_group(db, group, "group_member_update", {"student_id": student_id, "removed": True})])
    return {"ok": True}


@router.post("/{group_id}/invite")
async def invite_member(
    group_id: int,
    payload: GroupInviteIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_permission(db, group.id, student, "invite_members")
    target = db.get(Student, payload.student_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Player not found.")
    if group_service.membership(db, group.id, target.id) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "They are already in this group.")
    events = notify_members(
        db,
        group,
        [target.id],
        kind="member",
        title=f"{student.name.split(' ')[0]} invited you to {group.name}",
        message=f"Join with code {group.code} to study together.",
        meta={"invite": True, "group_code": group.code},
        inbox=True,
    )
    db.commit()
    await dispatch(events)
    return {"ok": True, "invited": target.id}


@router.get("/{group_id}/members/{student_id}/profile")
def member_profile(
    group_id: int,
    student_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """The in-group dossier — public stats only, never private data."""
    group = _group_or_404(db, group_id)
    group_service.require_member(db, group.id, student)
    member = group_service.membership(db, group.id, student_id)
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That member is not in this group.")
    target = db.get(Student, student_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Player not found.")

    week_key = game.week_key()
    messages_sent = int(
        db.scalar(
            select(func.count(GroupMessage.id)).where(
                GroupMessage.group_id == group.id, GroupMessage.student_id == student_id
            )
        )
        or 0
    )
    answers_given = int(
        db.scalar(
            select(func.count(StudyGroupQuestionReply.id)).where(
                StudyGroupQuestionReply.student_id == student_id,
                StudyGroupQuestionReply.question_id.in_(
                    select(StudyGroupQuestion.id).where(StudyGroupQuestion.group_id == group.id)
                ),
            )
        )
        or 0
    )
    quiz_rows = list(
        db.scalars(
            select(StudyGroupQuizParticipant).where(
                StudyGroupQuizParticipant.student_id == student_id,
                StudyGroupQuizParticipant.quiz_id.in_(
                    select(StudyGroupQuiz.id).where(StudyGroupQuiz.group_id == group.id)
                ),
            )
        ).all()
    )
    group_duels = list(
        db.scalars(select(Duel).where(Duel.group_id == group.id, Duel.status == "finished").limit(200)).all()
    )
    duel_wins = duel_losses = duel_total = 0
    for duel in group_duels:
        participants = {p.student_id for p in duel.participants}
        if student_id not in participants:
            continue
        duel_total += 1
        if duel.winner_id == student_id:
            duel_wins += 1
        elif duel.winner_id:
            duel_losses += 1
    friend = db.scalar(
        select(Friendship).where(
            or_(
                (Friendship.student_id == student.id) & (Friendship.friend_id == student_id),
                (Friendship.student_id == student_id) & (Friendship.friend_id == student.id),
            )
        )
    )
    activities = list(
        db.scalars(
            select(StudyGroupActivity)
            .where(StudyGroupActivity.group_id == group.id, StudyGroupActivity.actor_id == student_id)
            .order_by(StudyGroupActivity.id.desc())
            .limit(8)
        ).all()
    )
    return {
        "student": student_public(target, viewer_id=student.id, mask=True),
        "role": member.role,
        "joined_at": iso(member.joined_at),
        "week_xp": member.week_xp if member.week_key == week_key else 0,
        "status": group_service.presence_status(student_id, group.id),
        "contribution": {
            "messages": messages_sent,
            "answers": answers_given,
            "week_xp": member.week_xp if member.week_key == week_key else 0,
        },
        "quizzes": {
            "taken": len(quiz_rows),
            "submitted": sum(1 for row in quiz_rows if row.status == "submitted"),
            "best_percentage": max((row.percentage for row in quiz_rows), default=0.0),
            "average_percentage": (
                round(sum(row.percentage for row in quiz_rows if row.status == "submitted") / max(1, sum(1 for row in quiz_rows if row.status == "submitted")), 1)
            ),
        },
        "duels": {"played": duel_total, "wins": duel_wins, "losses": duel_losses},
        "recent_activity": [group_service.activity_public(row) for row in activities],
        "friendship": None
        if friend is None
        else {"status": friend.status, "i_initiated": friend.student_id == student.id},
        "is_self": student.id == student_id,
    }


# ---------------------------------------------------------------------------
# Duels scoped to the group
# ---------------------------------------------------------------------------
@router.post("/{group_id}/duels")
async def create_group_duel(
    group_id: int,
    payload: GroupDuelIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Challenge a group member — the authoritative duel engine does the rest."""
    group = _group_or_404(db, group_id)
    group_service.require_permission(db, group.id, student, "challenge_duels")
    opponent = db.get(Student, payload.opponent_id)
    if opponent is None or group_service.membership(db, group.id, opponent.id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That player is not in this group.")
    if opponent.id == student.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot duel yourself.")
    count = max(3, min(payload.question_count, group_service.MAX_DUEL_QUESTIONS))
    try:
        duel, events = duel_service.create_duel(
            db,
            student,
            opponent=opponent,
            course_id=payload.course_id,
            topic=payload.topic or (group.name if not payload.course_id else "Group topic"),
            question_count=count,
            mode="friendly",
        )
        # Group linkage + the 20-seconds-per-question clock the group rules use.
        duel.group_id = group.id
        duel.group_public = bool(payload.public)
        duel.invite_message = payload.message.strip()[:240]
        duel.time_limit_seconds = max(60, count * 20)
        db.flush()
        if duel.group_public:
            _, activity_events = log_activity(
                db,
                group,
                kind="duel",
                text=f"{student.name.split(' ')[0]} challenged {opponent.name.split(' ')[0]} to a duel.",
                actor=student,
                meta={"duel_id": duel.id},
            )
            events += activity_events
        events += notify_members(
            db,
            group,
            [opponent.id],
            kind="duel",
            title=f"⚔️ {student.name.split(' ')[0]} challenged you ({group.name})",
            message=payload.message.strip()[:160] or "Open your duels to accept.",
            meta={"duel_id": duel.id, "group_id": group.id},
            inbox=True,
        )
        events.append(to_room(group_room(group.id), "group_duel_update", {"duel_id": duel.id, "action": "created"}))
        db.commit()
    except duel_service.DuelError as error:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error
    await dispatch(events)
    return duel_public(duel, viewer_id=student.id)


@router.get("/{group_id}/duels")
def group_duels(
    group_id: int,
    filter: str = Query("all"),  # all|live|invited|finished
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_member(db, group.id, student)
    query = select(Duel).where(Duel.group_id == group.id)
    if filter in {"live", "invited", "finished"}:
        query = query.where(Duel.status == filter)
    rows = list(db.scalars(query.order_by(Duel.id.desc()).limit(400)).all())
    visible = []
    for duel in rows:
        participants = {p.student_id for p in duel.participants}
        # Private duels stay private — visible only to the two players.
        if not duel.group_public and student.id not in participants:
            continue
        names = [
            {"id": p.student_id, "name": p.student.name if p.student else "?"}
            for p in duel.participants
        ]
        winner = db.get(Student, duel.winner_id) if duel.winner_id else None
        visible.append(
            {
                "id": duel.id,
                "code": duel.code,
                "status": duel.status,
                "topic": duel.topic,
                "public": bool(duel.group_public),
                "question_count": duel.question_count,
                "stake_coins": duel.stake_coins,
                "message": duel.invite_message,
                "players": names,
                "winner": {"id": winner.id, "name": winner.name} if winner else None,
                "i_am_in": student.id in participants,
                "created_at": iso(duel.created_at),
                "finished_at": iso(duel.finished_at),
            }
        )
    total = len(visible)
    start = (page - 1) * size
    return {"items": visible[start : start + size], **group_service.page_meta(page, size, total)}


# ---------------------------------------------------------------------------
# Activity feed
# ---------------------------------------------------------------------------
_ACTIVITY_KIND_GROUPS: dict[str, tuple[str, ...]] = {
    "join": ("join", "member"),
    "quiz": ("quiz",),
    "duel": ("duel",),
    "question": ("question", "answer"),
    "announcement": ("announcement",),
}


@router.get("/{group_id}/activity")
def activity(
    group_id: int,
    kind: str = Query(""),  # ""|all|join|quiz|duel|question|announcement
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_member(db, group.id, student)
    query = select(StudyGroupActivity).where(StudyGroupActivity.group_id == group.id).order_by(StudyGroupActivity.id.desc())
    wanted = _ACTIVITY_KIND_GROUPS.get(kind.strip().lower())
    if wanted:
        query = query.where(StudyGroupActivity.kind.in_(wanted))
    rows, total = group_service.paginate(query, db, page, size)
    return {
        "items": [group_service.activity_public(row) for row in rows],
        **group_service.page_meta(page, size, total),
    }


# ---------------------------------------------------------------------------
# Notifications (the group bell)
# ---------------------------------------------------------------------------
@router.get("/{group_id}/notifications")
def notifications(
    group_id: int,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=50),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_member(db, group.id, student)
    query = (
        select(StudyGroupNotification)
        .where(StudyGroupNotification.group_id == group.id, StudyGroupNotification.student_id == student.id)
        .order_by(StudyGroupNotification.id.desc())
    )
    rows, total = group_service.paginate(query, db, page, size)
    unread = int(
        db.scalar(
            select(func.count(StudyGroupNotification.id)).where(
                StudyGroupNotification.group_id == group.id,
                StudyGroupNotification.student_id == student.id,
                StudyGroupNotification.read_at.is_(None),
            )
        )
        or 0
    )
    return {
        "items": [group_service.notification_public(row) for row in rows],
        "unread": unread,
        **group_service.page_meta(page, size, total),
    }


@router.get("/notifications/unread")
def unread_across_groups(
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Unread group-notification counts for every group the player belongs to."""
    rows = db.execute(
        select(StudyGroupNotification.group_id, func.count(StudyGroupNotification.id))
        .where(
            StudyGroupNotification.student_id == student.id,
            StudyGroupNotification.read_at.is_(None),
        )
        .group_by(StudyGroupNotification.group_id)
    ).all()
    per_group = {str(group_id): int(count) for group_id, count in rows}
    return {"total": sum(per_group.values()), "per_group": per_group}


@router.post("/{group_id}/notifications/read")
async def read_notifications(
    group_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_member(db, group.id, student)
    now = utcnow()
    rows = db.scalars(
        select(StudyGroupNotification).where(
            StudyGroupNotification.group_id == group.id,
            StudyGroupNotification.student_id == student.id,
            StudyGroupNotification.read_at.is_(None),
        )
    ).all()
    for row in rows:
        row.read_at = now
    db.commit()
    return {"marked": len(rows)}


# ---------------------------------------------------------------------------
# Settings, analytics, search
# ---------------------------------------------------------------------------
@router.patch("/{group_id}")
async def update_settings(
    group_id: int,
    payload: GroupSettingsIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_permission(db, group.id, student, "edit_group")
    if payload.name is not None:
        group.name = payload.name.strip()[:140]
    if payload.description is not None:
        group.description = payload.description.strip()[:300]
    if payload.goal is not None:
        group.goal = payload.goal.strip()[:200]
    if payload.course_id is not None:
        group.course_id = payload.course_id or None
    db.commit()
    db.refresh(group)
    serialized = group_service.group_public(db, group, student)
    await dispatch([group_service.broadcast_group(db, group, "group_updated", {"group": serialized})])
    return serialized


@router.get("/{group_id}/analytics")
def analytics(
    group_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = _group_or_404(db, group_id)
    group_service.require_permission(db, group.id, student, "view_analytics")
    now = utcnow()
    week = now - timedelta(days=7)
    member_rows = db.scalars(select(StudyGroupMember).where(StudyGroupMember.group_id == group.id)).all()
    contributors = sorted(member_rows, key=lambda row: -(row.week_xp if row.week_key == game.week_key() else 0))[:5]
    return {
        "members": len(member_rows),
        "online": len(group_service.online_member_ids(group.id)),
        "messages_week": int(
            db.scalar(select(func.count(GroupMessage.id)).where(GroupMessage.group_id == group.id, GroupMessage.created_at >= week)) or 0
        ),
        "quizzes": int(db.scalar(select(func.count(StudyGroupQuiz.id)).where(StudyGroupQuiz.group_id == group.id)) or 0),
        "questions": int(db.scalar(select(func.count(StudyGroupQuestion.id)).where(StudyGroupQuestion.group_id == group.id)) or 0),
        "duels": int(db.scalar(select(func.count(Duel.id)).where(Duel.group_id == group.id)) or 0),
        "activities_week": int(
            db.scalar(select(func.count(StudyGroupActivity.id)).where(StudyGroupActivity.group_id == group.id, StudyGroupActivity.created_at >= week)) or 0
        ),
        "top_contributors": [group_service.member_public(row, week_key=game.week_key()) for row in contributors],
    }


@router.get("/{group_id}/search")
def search(
    group_id: int,
    q: str = Query(..., min_length=1, max_length=80),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Server-side search across members, questions, announcements, quizzes and activity."""
    group = _group_or_404(db, group_id)
    group_service.require_member(db, group.id, student)
    needle = f"%{q.strip().lower()}%"

    member_rows = list(
        db.scalars(
            select(StudyGroupMember)
            .join(Student, Student.id == StudyGroupMember.student_id)
            .where(StudyGroupMember.group_id == group.id, func.lower(Student.name).like(needle))
            .limit(8)
        ).all()
    )
    question_rows = list(
        db.scalars(
            select(StudyGroupQuestion)
            .where(
                StudyGroupQuestion.group_id == group.id,
                or_(func.lower(StudyGroupQuestion.title).like(needle), func.lower(StudyGroupQuestion.body).like(needle)),
            )
            .order_by(StudyGroupQuestion.id.desc())
            .limit(8)
        ).all()
    )
    announcement_rows = list(
        db.scalars(
            select(StudyGroupAnnouncement)
            .where(
                StudyGroupAnnouncement.group_id == group.id,
                or_(func.lower(StudyGroupAnnouncement.title).like(needle), func.lower(StudyGroupAnnouncement.body).like(needle)),
            )
            .order_by(StudyGroupAnnouncement.id.desc())
            .limit(5)
        ).all()
    )
    quiz_rows = list(
        db.scalars(
            select(StudyGroupQuiz)
            .where(StudyGroupQuiz.group_id == group.id, func.lower(StudyGroupQuiz.title).like(needle))
            .order_by(StudyGroupQuiz.id.desc())
            .limit(5)
        ).all()
    )
    activity_rows = list(
        db.scalars(
            select(StudyGroupActivity)
            .where(StudyGroupActivity.group_id == group.id, func.lower(StudyGroupActivity.text).like(needle))
            .order_by(StudyGroupActivity.id.desc())
            .limit(8)
        ).all()
    )
    return {
        "members": [group_service.member_public(row) for row in member_rows],
        "questions": [group_service.question_public(db, row, viewer_id=student.id) for row in question_rows],
        "announcements": [group_service.announcement_public(row) for row in announcement_rows],
        "quizzes": [group_service.quiz_public(db, row, viewer_id=student.id) for row in quiz_rows],
        "activity": [group_service.activity_public(row) for row in activity_rows],
    }
