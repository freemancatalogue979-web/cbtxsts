"""Async database access for the websocket hot paths.

Everything here runs through ``AsyncSession`` (``sqlalchemy.ext.asyncio``) so
SQL I/O never blocks the event loop while chat, presence and heartbeat traffic
is in flight. The shapes returned are byte-for-byte the same payloads the
sync code produced, so the frontend and the socket protocol stay unchanged.

Scope rule: only queries the websocket hub actually performs per
connection / per message / per heartbeat live here. The REST API keeps its
sync sessions.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .db import async_session_scope
from .game import level_progress
from .models import Duel, DuelParticipant, DuelQuestion, Room, RoomMember, RoomMessage, RoomQuestion, Student
from .serializers import duel_public, leaderboard_row
from .services.room import ROOM_CAPACITY, RoomError

# ---------------------------------------------------------------------------
# Presence snapshot pieces
# ---------------------------------------------------------------------------


async def top_leaderboard_async(session: AsyncSession, *, limit: int = 10) -> list[dict]:
    """Async mirror of ``services.exam.top_leaderboard`` (same query, same rows)."""
    played = (Student.xp > 0) | (Student.exams_taken > 0) | (Student.duels_played > 0)
    result = await session.execute(
        select(Student)
        .where(Student.is_banned.is_(False), played)
        .order_by(Student.xp.desc(), Student.coins.desc())
        .limit(limit)
    )
    students = result.scalars().all()
    return [leaderboard_row(student, index + 1) for index, student in enumerate(students)]


async def profile_payload_async(session: AsyncSession, student_id: int) -> dict | None:
    student = await session.get(Student, student_id)
    if student is None:
        return None
    progress = level_progress(student.xp)
    return {
        "id": student.id,
        "name": student.name,
        "xp": student.xp,
        "coins": student.coins,
        "level": progress["level"],
        "title": progress["title"],
        "streak": student.streak,
    }


async def snapshot_payload(student_id: int | None, online: dict[str, Any]) -> dict:
    """The heartbeat / welcome snapshot, built without ever blocking the loop.

    ``online`` is the hub snapshot taken *before* this runs (under the hub
    lock, in one quick pass) — no lock is held while the SQL below executes.
    """
    async with async_session_scope() as session:
        leaderboard = await top_leaderboard_async(session, limit=10)
        if student_id:
            profile = await profile_payload_async(session, student_id)
            return {
                "profile": profile,
                "leaderboard": leaderboard,
                "online": online["online"],
                "online_ids": online["student_ids"],
            }
        return {"leaderboard": leaderboard, "online": online["online"]}


async def student_name(student_id: int | None) -> str | None:
    """Display name for a connecting socket (None when the id is unknown)."""
    if not student_id:
        return None
    async with async_session_scope() as session:
        student = await session.get(Student, student_id)
        return student.name if student else None


# ---------------------------------------------------------------------------
# Duel socket handshake
# ---------------------------------------------------------------------------


async def duel_initial_state(duel_id: int, student_id: int) -> dict | None:
    """Membership check + full initial ``duel_state`` payload.

    Returns None when the duel is missing or the student is not a participant
    (the endpoint answers with close code 4403). The eager loads make the
    existing ``duel_public`` serializer run purely in memory.
    """
    async with async_session_scope() as session:
        result = await session.execute(
            select(Duel)
            .options(
                selectinload(Duel.participants).selectinload(DuelParticipant.student),
                selectinload(Duel.questions).selectinload(DuelQuestion.question),
                selectinload(Duel.answers),
            )
            .where(Duel.id == duel_id)
        )
        duel = result.scalar_one_or_none()
        if duel is None or not any(p.student_id == student_id for p in duel.participants):
            return None
        student = await session.get(Student, student_id)
        return {
            "name": student.name if student else None,
            "state": duel_public(duel, viewer_id=student_id, include_questions=True, reveal=duel.status == "finished"),
        }


# ---------------------------------------------------------------------------
# Room socket handshake + chat writes
# ---------------------------------------------------------------------------


async def room_initial_state(session: AsyncSession, room: Room, viewer_id: int) -> dict:
    """Async mirror of ``services.room.room_state`` with batched member loads."""
    members = await _members_with_students(session, room.id)
    questions_total = (
        await session.scalar(select(func.count(RoomQuestion.id)).where(RoomQuestion.room_id == room.id))
    ) or 0
    return {
        "id": room.id,
        "code": room.code,
        "title": room.title,
        "status": room.status,
        "host_id": room.host_id,
        "course_id": room.course_id,
        "question_count": room.question_count,
        "per_question_seconds": room.per_question_seconds,
        "round_index": room.round_index,
        "questions_total": questions_total,
        "capacity": ROOM_CAPACITY,
        "is_host": room.host_id == viewer_id,
        "created_at": room.created_at.isoformat() + "Z",
        "members": [
            {
                "student_id": student.id,
                "name": student.name,
                "initials": student.name.split(" ")[0][:2].upper() if student.name else "?",
                "avatar_hue": student.avatar_hue,
                "has_photo": bool(student.photo),
                "is_host": member.is_host,
                "score": member.score,
                "correct_count": member.correct_count,
            }
            for member, student in members
        ],
    }


async def messages_payload_async(session: AsyncSession, room: Room, limit: int = 80) -> list[dict]:
    """Async mirror of ``services.room.messages_payload`` (one IN query for senders)."""
    result = await session.execute(
        select(RoomMessage)
        .where(RoomMessage.room_id == room.id)
        .order_by(RoomMessage.created_at.desc())
        .limit(limit)
    )
    rows = list(result.scalars().all())
    if not rows:
        return []
    sender_ids = {row.sender_id for row in rows}
    senders_result = await session.execute(select(Student).where(Student.id.in_(sender_ids)))
    senders = {student.id: student for student in senders_result.scalars().all()}
    out = []
    for row in reversed(rows):
        sender = senders.get(row.sender_id)
        out.append(
            {
                "id": row.id,
                "sender_id": row.sender_id,
                "sender_name": sender.name if sender else "?",
                "sender_initials": (sender.name.split(" ")[0][:2].upper() if sender and sender.name else "?"),
                "sender_hue": sender.avatar_hue if sender else 260,
                "sender_has_photo": bool(sender.photo) if sender else False,
                "body": row.body,
                "created_at": row.created_at.isoformat() + "Z",
            }
        )
    return out


async def _members_with_students(session: AsyncSession, room_id: int) -> list[tuple[RoomMember, Student]]:
    result = await session.execute(
        select(RoomMember).where(RoomMember.room_id == room_id).order_by(RoomMember.joined_at)
    )
    members = list(result.scalars().all())
    if not members:
        return []
    member_ids = [member.student_id for member in members]
    students_result = await session.execute(select(Student).where(Student.id.in_(member_ids)))
    students = {student.id: student for student in students_result.scalars().all()}
    pairs = []
    for member in members:
        student = students.get(member.student_id)
        if student is not None:
            pairs.append((member, student))
    return pairs


async def add_room_message_async(room_id: int, sender_id: int, body: str) -> dict | None:
    """Persist a room chat message asynchronously and return the broadcast payload.

    Same validation and payload shape as ``services.room.add_message``. Returns
    None when the room or sender vanished mid-session (the sync path silently
    skipped the broadcast in that case).
    """
    clean = (body or "").strip()[:400]
    if not clean:
        raise RoomError("Empty message.")
    async with async_session_scope() as session:
        room = await session.get(Room, room_id)
        student = await session.get(Student, sender_id)
        if room is None or student is None:
            return None
        row = RoomMessage(room_id=room.id, sender_id=student.id, body=clean)
        session.add(row)
        await session.flush()
        return {
            "id": row.id,
            "sender_id": student.id,
            "sender_name": student.name,
            "sender_initials": student.name.split(" ")[0][:2].upper() if student.name else "?",
            "sender_hue": student.avatar_hue,
            "sender_has_photo": bool(student.photo),
            "body": clean,
            "created_at": row.created_at.isoformat() + "Z",
        }
