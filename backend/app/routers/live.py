"""Websocket endpoints: the global live channel and per-duel rooms."""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from ..db import session_scope
from ..game import level_progress, title_for_level
from ..models import Duel, Room, RoomMember, Student
from ..security import ROLE_ADMIN, ROLE_STUDENT, decode_token
from ..serializers import duel_public
from ..services import room as room_service
from ..services.exam import top_leaderboard
from ..ws import Client, hub

router = APIRouter(tags=["live"])

HEARTBEAT_SECONDS = 25


async def _snapshot(client: Client) -> dict:
    with session_scope() as db:
        if client.student_id:
            student = db.get(Student, client.student_id)
            profile = None
            if student:
                progress = level_progress(student.xp)
                profile = {
                    "id": student.id,
                    "name": student.name,
                    "xp": student.xp,
                    "coins": student.coins,
                    "level": progress["level"],
                    "title": progress["title"],
                    "streak": student.streak,
                }
            return {
                "profile": profile,
                "leaderboard": top_leaderboard(db, limit=10),
                "online": hub.online_count(),
                "online_ids": hub.online_student_ids,
            }
        return {"leaderboard": top_leaderboard(db, limit=10), "online": hub.online_count()}


async def _pump(client: Client) -> None:
    """Periodic heartbeat + leaderboard refresh so idle tabs stay accurate."""
    try:
        while True:
            await asyncio.sleep(HEARTBEAT_SECONDS)
            snapshot = await _snapshot(client)
            await hub.send(client, "heartbeat", snapshot)
    except asyncio.CancelledError:  # pragma: no cover - normal shutdown path
        raise
    except Exception:
        return


async def _consume(client: Client, websocket: WebSocket, duel_room_name: str | None) -> None:
    while True:
        raw = await websocket.receive_text()
        try:
            message = json.loads(raw)
        except json.JSONDecodeError:
            await hub.send(client, "error", {"message": "Malformed JSON."})
            continue

        kind = str(message.get("type", "")).lower()
        if kind in {"ping", "heartbeat"}:
            await hub.send(client, "pong", {"online": hub.online_count()})
        elif kind == "presence":
            await hub.broadcast_presence()
        elif kind == "leave_duel" and duel_room_name:
            hub.leave_room(client, duel_room_name)
            await hub.send(client, "left_room", {"room": duel_room_name})
        elif kind == "hello":
            await hub.send(client, "welcome", await _snapshot(client))
        else:
            await hub.send(client, "ack", {"type": kind})


@router.websocket("/ws/live")
async def live_socket(websocket: WebSocket) -> None:
    """Global channel: presence, leaderboard deltas, invites, rewards, notices."""
    principal = decode_token(websocket.query_params.get("token"))
    student_id = int(principal.subject) if principal and principal.role == ROLE_STUDENT else None
    admin_id = int(principal.subject) if principal and principal.role == ROLE_ADMIN else None

    with session_scope() as db:
        student = db.get(Student, student_id) if student_id else None
        name = student.name if student else (principal.name if principal else "guest")

    client = await hub.connect(websocket, student_id=student_id, admin_id=admin_id, name=name)
    pump = asyncio.create_task(_pump(client))
    try:
        await hub.send(client, "welcome", await _snapshot(client))
        await _consume(client, websocket, None)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        pump.cancel()
        await hub.disconnect(client)


@router.websocket("/ws/duel/{duel_id}")
async def duel_socket(websocket: WebSocket, duel_id: int) -> None:
    """Duel room: live score race between two players."""
    principal = decode_token(websocket.query_params.get("token"))
    if not principal or principal.role != ROLE_STUDENT:
        await websocket.close(code=4401)
        return
    student_id = int(principal.subject)

    with session_scope() as db:
        duel = db.get(Duel, duel_id)
        if duel is None or not any(p.student_id == student_id for p in duel.participants):
            await websocket.close(code=4403)
            return
        student = db.get(Student, student_id)
        name = student.name if student else principal.name
        state = duel_public(duel, viewer_id=student_id, include_questions=True, reveal=duel.status == "finished")

    room = f"duel:{duel_id}"
    client = await hub.connect(websocket, student_id=student_id, admin_id=None, name=name)
    hub.join_room(client, room)
    pump = asyncio.create_task(_pump(client))
    try:
        await hub.send(client, "duel_state", state)
        await _consume(client, websocket, room)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        pump.cancel()
        await hub.disconnect(client)
        await hub.broadcast(
            "duel_disconnect",
            {"duel_id": duel_id, "student_id": student_id},
            room=room,
        )


@router.websocket("/ws/room/{room_id}")
async def room_socket(websocket: WebSocket, room_id: int) -> None:
    """Multiplayer room: state sync plus the live chat relay."""
    principal = decode_token(websocket.query_params.get("token"))
    if not principal or principal.role != ROLE_STUDENT:
        await websocket.close(code=4401)
        return
    student_id = int(principal.subject)

    with session_scope() as db:
        room = db.get(Room, room_id)
        member = (
            db.scalar(select(RoomMember).where(RoomMember.room_id == room_id, RoomMember.student_id == student_id))
            if room
            else None
        )
        if room is None or member is None:
            await websocket.close(code=4403)
            return
        student = db.get(Student, student_id)
        name = student.name if student else principal.name
        state = {
            "room": room_service.room_state(db, room, student_id),
            "messages": room_service.messages_payload(db, room),
        }

    room_key = f"quizroom:{room_id}"
    client = await hub.connect(websocket, student_id=student_id, admin_id=None, name=name)
    hub.join_room(client, room_key)
    pump = asyncio.create_task(_pump(client))
    try:
        await hub.send(client, "room_state", state)
        while True:
            raw = await websocket.receive_text()
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                await hub.send(client, "error", {"message": "Malformed JSON."})
                continue
            kind = str(message.get("type", "")).lower()
            if kind in {"ping", "heartbeat"}:
                await hub.send(client, "pong", {"online": hub.online_count()})
            elif kind == "chat":
                body = str(message.get("body", ""))
                try:
                    with session_scope() as db2:
                        room = db2.get(Room, room_id)
                        student = db2.get(Student, student_id)
                        if room is None or student is None:
                            continue
                        payload = room_service.add_message(db2, room, student, body)
                except Exception as exc:  # noqa: BLE001 - relay the reason to the sender
                    await hub.send(client, "error", {"message": str(exc)})
                    continue
                await hub.broadcast("room_chat", payload, room=room_key)
            elif kind == "hello":
                await hub.send(client, "welcome", await _snapshot(client))
            else:
                await hub.send(client, "ack", {"type": kind})
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        pump.cancel()
        await hub.disconnect(client)
        await hub.broadcast("room_presence", {"student_id": student_id, "left": True}, room=room_key)


@router.get("/live/presence")
def presence() -> dict:
    """REST fallback for clients that cannot open a socket yet."""
    return {"online": hub.online_count(), "student_ids": hub.online_student_ids}


@router.get("/live/duels/open")
def open_duels() -> list[dict]:
    """Public open-arena challenges anyone can join with a code."""
    with session_scope() as db:
        duels = db.scalars(
            select(Duel).where(Duel.status == "invited").order_by(Duel.id.desc()).limit(40)
        ).all()
        return [duel_public(d) for d in duels if len(d.participants) < 2][:10]
