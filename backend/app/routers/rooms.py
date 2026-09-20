"""Multiplayer room endpoints: create, join by code, live rounds, chat, rewards."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db, session_scope
from ..deps import require_student
from ..models import Room, RoomMember, Student
from ..schemas import CreateRoomIn, RoomAnswerIn
from ..services import room as room_service
from ..services.room import RoomError
from ..ws import hub

router = APIRouter(prefix="/rooms", tags=["rooms"])


def _room_key(room_id: int) -> str:
    return f"quizroom:{room_id}"


def _room_or_404(db: Session, room_id: int) -> Room:
    room = db.get(Room, room_id)
    if room is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Room not found.")
    return room


def _member_or_403(db: Session, room: Room, student: Student) -> RoomMember:
    member = db.scalar(
        select(RoomMember).where(RoomMember.room_id == room.id, RoomMember.student_id == student.id)
    )
    if member is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not in this room.")
    return member


def _host_or_403(room: Room, student: Student) -> None:
    if room.host_id != student.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Host-only action.")


async def _schedule_auto_reveal(room_id: int, seconds: int) -> None:
    """When a question's clock runs out, the server reveals the answer on its own."""

    async def _timer() -> None:
        await asyncio.sleep(seconds + 0.5)
        with session_scope() as db:
            room = db.get(Room, room_id)
            if room is None or room.status != "live":
                return
            payload = room_service.close_question(db, room)
        if payload:
            await hub.broadcast("room_reveal", payload, room=_room_key(room_id))

    asyncio.create_task(_timer())


@router.post("")
async def create_room(
    payload: CreateRoomIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    try:
        room = room_service.create_room(
            db,
            student,
            title=payload.title,
            course_id=payload.course_id,
            question_count=payload.question_count,
            per_question_seconds=payload.per_question_seconds,
        )
    except RoomError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    db.commit()
    return {"room": room_service.room_state(db, room, student.id)}


@router.get("/mine")
def my_rooms(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    rows = list(
        db.scalars(
            select(Room)
            .join(RoomMember, RoomMember.room_id == Room.id)
            .where(RoomMember.student_id == student.id, Room.status.in_(["lobby", "live"]))
            .order_by(Room.created_at.desc())
            .limit(10)
        ).all()
    )
    return {"rooms": [room_service.room_state(db, room, student.id) for room in rows]}


@router.post("/join/{code}")
async def join_room(
    code: str,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    try:
        room = room_service.join_room(db, student, code)
    except RoomError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    db.commit()
    await hub.broadcast("room_join", {"student_id": student.id, "name": student.name}, room=_room_key(room.id))
    return {
        "room": room_service.room_state(db, room, student.id),
        "messages": room_service.messages_payload(db, room),
    }


@router.get("/{room_id}")
def room_detail(
    room_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    room = _room_or_404(db, room_id)
    _member_or_403(db, room, student)
    return {
        "room": room_service.room_state(db, room, student.id),
        "messages": room_service.messages_payload(db, room),
    }


@router.post("/{room_id}/start")
async def start_room(
    room_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    room = _room_or_404(db, room_id)
    _member_or_403(db, room, student)
    _host_or_403(room, student)
    try:
        total = room_service.start_run(db, room)
        question = room_service.open_next(db, room)
    except RoomError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    db.commit()
    await hub.broadcast("room_start", {"total": total}, room=_room_key(room.id))
    if question:
        await hub.broadcast("room_question", question, room=_room_key(room.id))
        await _schedule_auto_reveal(room.id, question["seconds"])
    return {"room": room_service.room_state(db, room, student.id), "question": question}


@router.post("/{room_id}/answer")
async def answer_question(
    room_id: int,
    payload: RoomAnswerIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    room = _room_or_404(db, room_id)
    _member_or_403(db, room, student)
    try:
        result, all_answered = room_service.submit_answer(db, room, student, payload.selected, payload.elapsed_ms)
        reveal = room_service.close_question(db, room) if all_answered else None
        state = room_service.room_state(db, room, student.id)
    except RoomError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    db.commit()
    await hub.broadcast(
        "room_answered",
        {"student_id": student.id, "locked": True},
        room=_room_key(room.id),
    )
    if reveal:
        await hub.broadcast("room_reveal", reveal, room=_room_key(room.id))
    return {"result": result, "all_answered": all_answered, "reveal": reveal, "room": state}


@router.post("/{room_id}/reveal")
async def reveal_question(
    room_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    room = _room_or_404(db, room_id)
    _member_or_403(db, room, student)
    _host_or_403(room, student)
    reveal = room_service.close_question(db, room)
    if reveal is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No question is open right now.")
    db.commit()
    await hub.broadcast("room_reveal", reveal, room=_room_key(room.id))
    return {"reveal": reveal}


@router.post("/{room_id}/next")
async def next_question(
    room_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    room = _room_or_404(db, room_id)
    _member_or_403(db, room, student)
    _host_or_403(room, student)
    pending_reveal = room_service.close_question(db, room)  # host skipped the clock
    db.commit()
    if pending_reveal:
        await hub.broadcast("room_reveal", pending_reveal, room=_room_key(room.id))
    question = room_service.open_next(db, room)
    if question:
        db.commit()
        await hub.broadcast("room_question", question, room=_room_key(room.id))
        await _schedule_auto_reveal(room.id, question["seconds"])
        return {"room": room_service.room_state(db, room, student.id), "question": question}
    finish = room_service.finish_run(db, room)
    db.commit()
    await hub.broadcast("room_finish", finish, room=_room_key(room.id))
    await hub.broadcast(
        "rooms_update",
        {"room_id": room.id},
    )
    return {"room": room_service.room_state(db, room, student.id), "finish": finish}


@router.post("/{room_id}/kick/{target_id}")
async def kick_player(
    room_id: int,
    target_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    room = _room_or_404(db, room_id)
    _member_or_403(db, room, student)
    _host_or_403(room, student)
    try:
        room_service.kick_member(db, student, room, target_id)
    except RoomError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    db.commit()
    await hub.broadcast("room_kicked", {"student_id": target_id}, room=_room_key(room.id))
    return {"room": room_service.room_state(db, room, student.id)}


@router.post("/{room_id}/leave")
async def leave(
    room_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    room = _room_or_404(db, room_id)
    _member_or_403(db, room, student)
    try:
        deleted = room_service.leave_room(db, student, room)
    except RoomError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    db.commit()
    await hub.broadcast(
        "room_leave",
        {"student_id": student.id, "deleted": deleted},
        room=_room_key(room.id),
    )
    return {"deleted": deleted}


@router.get("/{room_id}/messages")
def messages(
    room_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    room = _room_or_404(db, room_id)
    _member_or_403(db, room, student)
    return {"messages": room_service.messages_payload(db, room)}
