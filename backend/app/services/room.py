"""Multiplayer quiz-night rooms.

A room holds up to 15 players: one host, everyone else a guest. The host picks
the question source (a course bank or the whole arena), starts the run and
paces it — every question opens for the whole room at once with its own clock,
answers are graded server-side, the standings update live, and the room chat
runs the entire time so players can talk or ask about the question in front of
them. Rewards pay out when the run finishes.
"""
from __future__ import annotations

import random
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import game
from ..models import (
    Question,
    Room,
    RoomAnswer,
    RoomMember,
    RoomMessage,
    RoomQuestion,
    Student,
    utcnow,
)
from ..serializers import question_public
from .duel import question_pool

ROOM_CAPACITY = 15
PLACE_XP = (30, 20, 10)
PLACE_COINS = (15, 10, 5)
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

# room_id -> {question_id, index, deadline} for the question currently on screen
OPEN: dict[int, dict] = {}


class RoomError(Exception):
    """Raised for user-facing room failures."""


def _make_code(db: Session) -> str:
    for _ in range(20):
        code = "".join(random.choice(CODE_ALPHABET) for _ in range(6))
        if db.scalar(select(Room.id).where(Room.code == code)) is None:
            return code
    raise RoomError("Could not mint a room code — try again.")


def _member(db: Session, room_id: int, student_id: int) -> RoomMember | None:
    return db.scalar(select(RoomMember).where(RoomMember.room_id == room_id, RoomMember.student_id == student_id))


def create_room(
    db: Session,
    host: Student,
    *,
    title: str,
    course_id: int | None,
    question_count: int,
    per_question_seconds: int,
) -> Room:
    room = Room(
        code=_make_code(db),
        host_id=host.id,
        title=(title or "Arena Room").strip()[:120] or "Arena Room",
        course_id=course_id,
        question_count=max(3, min(20, question_count)),
        per_question_seconds=max(10, min(90, per_question_seconds)),
        status="lobby",
    )
    db.add(room)
    db.flush()
    db.add(RoomMember(room_id=room.id, student_id=host.id, is_host=True))
    db.flush()
    return room


def join_room(db: Session, student: Student, code: str) -> Room:
    room = db.scalar(select(Room).where(Room.code == (code or "").strip().upper()))
    if room is None:
        raise RoomError("No room with that code.")
    if room.status != "lobby":
        raise RoomError("That round is already running — ask the host for the next room.")
    if _member(db, room.id, student.id):
        return room
    if len(room_members(db, room)) >= ROOM_CAPACITY:
        raise RoomError(f"Room is full ({ROOM_CAPACITY} players max).")
    db.add(RoomMember(room_id=room.id, student_id=student.id))
    db.flush()
    return room


def room_members(db: Session, room: Room) -> list[RoomMember]:
    return list(db.scalars(select(RoomMember).where(RoomMember.room_id == room.id).order_by(RoomMember.joined_at)).all())


def leave_room(db: Session, student: Student, room: Room) -> bool:
    """Returns True when the room was deleted (empty lobby)."""
    member = _member(db, room.id, student.id)
    if member is None:
        return False
    if member.is_host and room.status == "live":
        raise RoomError("The host cannot abandon a live round — finish it or kick players first.")
    db.delete(member)
    db.flush()
    if room.status == "lobby" and not room_members(db, room):
        db.delete(room)
        db.flush()
        return True
    return False


def kick_member(db: Session, host: Student, room: Room, student_id: int) -> None:
    if room.host_id != host.id:
        raise RoomError("Only the host can kick players.")
    if student_id == host.id:
        raise RoomError("You cannot kick yourself.")
    member = _member(db, room.id, student_id)
    if member is None:
        raise RoomError("That player is not in this room.")
    db.delete(member)
    db.flush()


def members_payload(db: Session, room: Room) -> list[dict]:
    payload = []
    for member in room_members(db, room):
        student = db.get(Student, member.student_id)
        if student is None:
            continue
        payload.append(
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
        )
    return payload


def room_state(db: Session, room: Room, viewer_id: int) -> dict:
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
        "questions_total": db.scalar(
            select(func.count(RoomQuestion.id)).where(RoomQuestion.room_id == room.id)
        )
        or 0,
        "capacity": ROOM_CAPACITY,
        "is_host": room.host_id == viewer_id,
        "created_at": room.created_at.isoformat() + "Z",
        "members": members_payload(db, room),
    }


def start_run(db: Session, room: Room) -> int:
    if room.host_id is None:
        raise RoomError("Room has no host.")
    if room.status != "lobby":
        raise RoomError("This room has already started.")
    if len(room_members(db, room)) < 2:
        raise RoomError("Wait for at least one guest before starting.")
    pool = question_pool(db, None, course_id=room.course_id)
    if not pool:
        raise RoomError("No questions available for this room's source yet.")
    picks = random.sample(pool, min(room.question_count, len(pool)))
    for position, question in enumerate(picks):
        db.add(RoomQuestion(room_id=room.id, question_id=question.id, position=position))
    room.status = "live"
    room.round_index = -1
    db.flush()
    return len(picks)


def open_next(db: Session, room: Room) -> dict | None:
    """Open the next question for the whole room. None when the run is over."""
    questions = list(
        db.scalars(select(RoomQuestion).where(RoomQuestion.room_id == room.id).order_by(RoomQuestion.position)).all()
    )
    nxt = room.round_index + 1
    if nxt >= len(questions):
        return None
    room.round_index = nxt
    db.flush()
    question = db.get(Question, questions[nxt].question_id)
    deadline = utcnow() + timedelta(seconds=room.per_question_seconds)
    OPEN[room.id] = {"question_id": question.id, "index": nxt, "deadline": deadline}
    return {
        "index": nxt,
        "total": len(questions),
        "seconds": room.per_question_seconds,
        "deadline": deadline.isoformat() + "Z",
        "question": question_public(question, reveal=False),
    }


def open_info(room: Room) -> dict | None:
    return OPEN.get(room.id)


def submit_answer(db: Session, room: Room, student: Student, selected: str, elapsed_ms: int) -> tuple[dict, bool]:
    info = OPEN.get(room.id)
    if info is None or room.status != "live":
        raise RoomError("No question is open right now.")
    if utcnow() > info["deadline"]:
        raise RoomError("Too slow — the clock on that question already ran out.")
    member = _member(db, room.id, student.id)
    if member is None:
        raise RoomError("You are not in this room.")
    question = db.get(Question, info["question_id"])
    existing = db.scalar(
        select(RoomAnswer).where(
            RoomAnswer.room_id == room.id,
            RoomAnswer.question_id == question.id,
            RoomAnswer.student_id == student.id,
        )
    )
    if existing:
        raise RoomError("You already locked an answer for this question.")
    correct = (selected or "").strip().upper() == (question.correct or "").strip().upper()
    remaining = max(0.0, (info["deadline"] - utcnow()).total_seconds())
    points = 0
    if correct:
        speed_bonus = int(round((remaining / max(1, room.per_question_seconds)) * 10))
        points = 10 + speed_bonus
        member.score += points
        member.correct_count += 1
    answer = RoomAnswer(
        room_id=room.id,
        question_id=question.id,
        student_id=student.id,
        selected=(selected or "").strip().upper(),
        correct=correct,
        elapsed_ms=elapsed_ms,
        points=points,
    )
    db.add(answer)
    db.flush()
    answered = db.scalar(
        select(func.count(RoomAnswer.id)).where(
            RoomAnswer.room_id == room.id, RoomAnswer.question_id == question.id
        )
    ) or 0
    return {"correct": correct, "points": points}, answered >= len(room_members(db, room))


def close_question(db: Session, room: Room) -> dict | None:
    """Grade the open question, reveal the answer and publish standings."""
    info = OPEN.pop(room.id, None)
    if info is None:
        return None
    question = db.get(Question, info["question_id"])
    answers = list(
        db.scalars(select(RoomAnswer).where(RoomAnswer.room_id == room.id, RoomAnswer.question_id == question.id)).all()
    )
    correct_ids = {row.student_id for row in answers if row.correct}
    standings = sorted(members_payload(db, room), key=lambda row: (-row["score"], row["name"]))
    return {
        "index": info["index"],
        "question_id": question.id,
        "correct": question.correct,
        "explanation": question.explanation or "",
        "correct_ids": sorted(correct_ids),
        "answered": len(answers),
        "standings": standings,
    }


def finish_run(db: Session, room: Room) -> dict:
    OPEN.pop(room.id, None)
    room.status = "finished"
    room.finished_at = utcnow()
    standings = sorted(members_payload(db, room), key=lambda row: (-row["score"], row["name"]))
    rewards = []
    for place, row in enumerate(standings):
        student = db.get(Student, row["student_id"])
        if student is None:
            continue
        bonus_xp = PLACE_XP[place] if place < len(PLACE_XP) else 0
        bonus_coins = PLACE_COINS[place] if place < len(PLACE_COINS) else 0
        xp = 3 * row["correct_count"] + bonus_xp
        coins = 2 * row["correct_count"] + bonus_coins
        if xp or coins:
            game.grant(
                db,
                student,
                xp=xp,
                coins=coins,
                kind="xp",
                title=f"Room night: {room.title}",
                detail=f"Place {place + 1} · {row['correct_count']} correct",
            )
        rewards.append({"student_id": row["student_id"], "xp": xp, "coins": coins})
    db.flush()
    return {"standings": standings, "rewards": rewards}


def messages_payload(db: Session, room: Room, limit: int = 80) -> list[dict]:
    rows = list(
        db.scalars(
            select(RoomMessage).where(RoomMessage.room_id == room.id).order_by(RoomMessage.created_at.desc()).limit(limit)
        ).all()
    )
    out = []
    for row in reversed(rows):
        sender = db.get(Student, row.sender_id)
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


def add_message(db: Session, room: Room, student: Student, body: str) -> dict:
    clean = (body or "").strip()[:400]
    if not clean:
        raise RoomError("Empty message.")
    row = RoomMessage(room_id=room.id, sender_id=student.id, body=clean)
    db.add(row)
    db.flush()
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
