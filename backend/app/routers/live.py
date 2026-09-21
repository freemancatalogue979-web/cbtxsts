"""Websocket endpoints: the global live channel and per-duel rooms."""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import func, select

from ..db import session_scope
from ..game import level_progress, title_for_level
from ..models import ArenaEvent, Duel, EventParticipant, RankedMatch, RankedParticipant, Room, RoomMember, Student
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


@router.websocket("/ws/ranked/{match_id}")
async def ranked_socket(websocket: WebSocket, match_id: int) -> None:
    """Ranked match channel: live standings, question pacing, activity."""
    principal = decode_token(websocket.query_params.get("token"))
    if not principal or principal.role != ROLE_STUDENT:
        await websocket.close(code=4401)
        return
    student_id = int(principal.subject)

    with session_scope() as db:
        match = db.get(RankedMatch, match_id)
        member = (
            db.scalar(
                select(RankedParticipant).where(
                    RankedParticipant.match_id == match_id, RankedParticipant.student_id == student_id
                )
            )
            if match
            else None
        )
        if match is None or member is None:
            await websocket.close(code=4403)
            return
        student = db.get(Student, student_id)
        name = student.name if student else principal.name
        from ..services.ranked import match_state

        state = match_state(db, match, student_id, hub.student_ids_in_room(f"ranked:{match_id}"))

    room_key = f"ranked:{match_id}"
    client = await hub.connect(websocket, student_id=student_id, admin_id=None, name=name)
    hub.join_room(client, room_key)
    pump = asyncio.create_task(_pump(client))
    try:
        await hub.send(client, "ranked_state", state)
        await hub.broadcast(
            "ranked_presence",
            {"student_id": student_id, "connected": True},
            room=room_key,
        )
        await _consume(client, websocket, None)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        pump.cancel()
        await hub.disconnect(client)
        await hub.broadcast(
            "ranked_presence",
            {"student_id": student_id, "connected": False},
            room=room_key,
        )


@router.websocket("/ws/event/{event_id}")
async def event_socket(websocket: WebSocket, event_id: int) -> None:
    """Event channel: leaderboard deltas, activity, start/end transitions."""
    principal = decode_token(websocket.query_params.get("token"))
    if not principal or principal.role != ROLE_STUDENT:
        await websocket.close(code=4401)
        return
    student_id = int(principal.subject)

    with session_scope() as db:
        event = db.get(ArenaEvent, event_id)
        if event is None:
            await websocket.close(code=4403)
            return
        student = db.get(Student, student_id)
        name = student.name if student else principal.name
        from ..services.events import event_public, leaderboard_payload

        payload = {
            "event": event_public(db, event, student_id),
            "leaderboard": (
                leaderboard_payload(db, event, student_id, hub.student_ids_in_room(f"event:{event_id}"))
                if event.leaderboard_visible
                else None
            ),
        }

    room_key = f"event:{event_id}"
    client = await hub.connect(websocket, student_id=student_id, admin_id=None, name=name)
    hub.join_room(client, room_key)
    pump = asyncio.create_task(_pump(client))
    try:
        await hub.send(client, "event_state", payload)
        await _consume(client, websocket, None)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        pump.cancel()
        await hub.disconnect(client)
        await hub.broadcast("event_presence", {"student_id": student_id, "left": True}, room=room_key)


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


# ---------------------------------------------------------------------------
# Study-group room: real-time chat, presence and activity fan-out.
# The room name is ``study_group:{group_id}`` and only members of that group
# ever hold a socket in it, so nothing leaks to the global ``live`` channel.
# ---------------------------------------------------------------------------
def _group_presence_payload(room: str) -> dict:
    statuses: dict[str, str] = {}
    for client in hub.room_clients(room):
        if client.student_id is not None:
            current = statuses.get(str(client.student_id), "offline")
            state = getattr(client, "status", "online")
            # Any foregrounded connection wins over an away one.
            if state == "online" or current != "online":
                statuses[str(client.student_id)] = state
    return {"statuses": statuses, "online": sum(1 for value in statuses.values() if value == "online")}


@router.websocket("/ws/group/{group_id}")
async def group_socket(websocket: WebSocket, group_id: int) -> None:
    from ..models import GroupMessage, StudyGroup, StudyGroupMember, StudyGroupNotification
    from ..services import group as group_service

    principal = decode_token(websocket.query_params.get("token"))
    if not principal or principal.role != ROLE_STUDENT:
        await websocket.close(code=4401)
        return
    student_id = int(principal.subject)

    with session_scope() as db:
        group = db.get(StudyGroup, group_id)
        member = (
            db.scalar(
                select(StudyGroupMember).where(
                    StudyGroupMember.group_id == group_id, StudyGroupMember.student_id == student_id
                )
            )
            if group
            else None
        )
        if group is None or member is None:
            await websocket.close(code=4403)
            return
        student = db.get(Student, student_id)
        name = student.name if student else principal.name
        rows = db.scalars(
            select(GroupMessage)
            .where(GroupMessage.group_id == group_id)
            .order_by(GroupMessage.id.desc())
            .limit(50)
        ).all()
        reply_ids = {row.reply_to_id for row in rows if row.reply_to_id}
        replies = (
            {row.id: row for row in db.scalars(select(GroupMessage).where(GroupMessage.id.in_(reply_ids))).all()}
            if reply_ids
            else {}
        )
        messages = [
            group_service.message_public(row, viewer_id=student_id, reply=replies.get(row.reply_to_id))
            for row in reversed(rows)
        ]
        unread = int(
            db.scalar(
                select(func.count(StudyGroupNotification.id)).where(
                    StudyGroupNotification.group_id == group_id,
                    StudyGroupNotification.student_id == student_id,
                    StudyGroupNotification.read_at.is_(None),
                )
            )
            or 0
        )

    room = group_service.group_room(group_id)
    client = await hub.connect(websocket, student_id=student_id, admin_id=None, name=name)
    hub.join_room(client, room)
    pump = asyncio.create_task(_pump(client))
    try:
        await hub.send(
            client,
            "group_state",
            {
                "group_id": group_id,
                "messages": messages,
                "unread_notifications": unread,
                "presence": _group_presence_payload(room),
            },
        )
        await hub.broadcast(
            "group_presence",
            {"group_id": group_id, "student_id": student_id, "status": "online", "connected": True},
            room=room,
        )
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
            elif kind == "away":
                client.status = "away" if message.get("value") else "online"
                await hub.broadcast(
                    "group_presence",
                    {"group_id": group_id, "student_id": student_id, "status": client.status, "connected": True},
                    room=room,
                )
            elif kind == "typing":
                await hub.broadcast(
                    "group_typing",
                    {"group_id": group_id, "student_id": student_id, "name": name},
                    room=room,
                )
            elif kind == "chat":
                body = str(message.get("body", "")).strip()[:2000]
                if not body:
                    continue
                try:
                    with session_scope() as db2:
                        reply_to = message.get("reply_to_id")
                        reply = db2.get(GroupMessage, int(reply_to)) if reply_to else None
                        if reply is not None and reply.group_id != group_id:
                            reply = None
                        row = GroupMessage(
                            group_id=group_id,
                            student_id=student_id,
                            body=body,
                            reply_to_id=reply.id if reply else None,
                        )
                        db2.add(row)
                        db2.flush()
                        payload = group_service.message_public(row, viewer_id=student_id, reply=reply)
                        payload["sender_name"] = name
                except Exception as exc:  # noqa: BLE001 - relay the reason to the sender
                    await hub.send(client, "error", {"message": str(exc)})
                    continue
                await hub.broadcast("group_message", payload, room=room)
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
        await hub.broadcast(
            "group_presence",
            {"group_id": group_id, "student_id": student_id, "status": "offline", "connected": False},
            room=room,
        )
