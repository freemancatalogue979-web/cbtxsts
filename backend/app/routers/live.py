"""Websocket endpoints: the global live channel and per-duel rooms.

Hot-path rule: no synchronous SQL ever runs on the event loop here. Recurring
work (heartbeats, presence, chat writes) uses ``AsyncSession`` via
``app.live_queries``; the one-shot state builders for ranked/event sockets
reuse their existing sync service chains but execute on a worker thread, so a
connecting client can never stall everyone else's realtime traffic.
"""
from __future__ import annotations

import asyncio
import json
import os
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from ..db import AsyncSessionLocal, session_scope
from ..live_queries import (
    add_room_message_async,
    duel_chat_async,
    duel_initial_state,
    ranked_chat_async,
    messages_payload_async,
    room_initial_state,
    snapshot_payload,
    student_name,
)
from ..models import ArenaEvent, Duel, RankedMatch, RankedParticipant, Room, RoomMember, Student
from ..security import ROLE_ADMIN, ROLE_STUDENT, decode_token
from ..serializers import duel_public
from ..ws import Client, hub

router = APIRouter(tags=["live"])

HEARTBEAT_SECONDS = float(os.getenv("ARENA_HEARTBEAT_SECONDS", "25"))

#: The browser client pings every 20s; allow three missed pings plus grace
#: before declaring a socket dead. Uvicorn's protocol-level ping/pong
#: (ws_ping_interval / ws_ping_timeout) enforces the same on the wire.
STALE_AFTER_SECONDS = float(os.getenv("ARENA_STALE_AFTER_SECONDS", "70"))


async def _snapshot(client: Client) -> dict:
    """Heartbeat / welcome payload.

    Order matters: the in-memory online snapshot is taken first (quick, under
    the hub lock), then the async DB reads run with no lock held at all.
    """
    online = await hub.online_snapshot()
    return await snapshot_payload(client.student_id, online)


async def _pump(client: Client) -> None:
    """Periodic heartbeat + leaderboard refresh so idle tabs stay accurate.

    Doubles as the dead-client reaper: a socket that has sent us nothing for
    ``STALE_AFTER_SECONDS`` is disconnected, which also frees it from every
    broadcast fan-out.
    """
    try:
        while True:
            await asyncio.sleep(HEARTBEAT_SECONDS)
            if time.monotonic() - client.last_seen > STALE_AFTER_SECONDS:
                await hub.disconnect(client)
                return
            snapshot = await _snapshot(client)
            await hub.send(client, "heartbeat", snapshot)
    except asyncio.CancelledError:  # pragma: no cover - normal shutdown path
        raise
    except Exception:
        return


async def _consume(
    client: Client,
    websocket: WebSocket,
    duel_room_name: str | None,
    duel_id: int | None = None,
    ranked_room_name: str | None = None,
    ranked_match_id: int | None = None,
) -> None:
    while True:
        raw = await websocket.receive_text()
        client.touch()  # any inbound traffic proves the socket is alive
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
        elif kind == "chat" and duel_room_name and duel_id is not None:
            # Waiting-room chat: relayed to this duel's room only, and only
            # while the duel is still in the lobby (duel_chat_async enforces
            # both — it returns None once the match has started).
            payload = await duel_chat_async(duel_id, client.student_id, str(message.get("body", "")))
            if payload is not None:
                await hub.broadcast("duel_chat", payload, room=duel_room_name)
        elif kind == "chat" and ranked_room_name and ranked_match_id is not None:
            # Ranked lobby chat: same gate as duels — participants only, and
            # only while the match is still counting down in the lobby.
            payload = await ranked_chat_async(ranked_match_id, client.student_id, str(message.get("body", "")))
            if payload is not None:
                await hub.broadcast("ranked_chat", payload, room=ranked_room_name)
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

    name = await student_name(student_id)
    if name is None:
        name = principal.name if principal else "guest"

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

    entry = await duel_initial_state(duel_id, student_id)
    if entry is None:
        await websocket.close(code=4403)
        return

    room = f"duel:{duel_id}"
    client = await hub.connect(
        websocket, student_id=student_id, admin_id=None, name=entry["name"] or principal.name
    )
    hub.join_room(client, room)
    pump = asyncio.create_task(_pump(client))
    try:
        await hub.send(client, "duel_state", entry["state"])
        await _consume(client, websocket, room, duel_id=duel_id)
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

    async with AsyncSessionLocal() as session:
        room = await session.get(Room, room_id)
        member = (
            await session.scalar(
                select(RoomMember).where(RoomMember.room_id == room_id, RoomMember.student_id == student_id)
            )
            if room
            else None
        )
        if room is None or member is None:
            await websocket.close(code=4403)
            return
        student = await session.get(Student, student_id)
        name = student.name if student else principal.name
        state = {
            "room": await room_initial_state(session, room, student_id),
            "messages": await messages_payload_async(session, room),
        }

    room_key = f"quizroom:{room_id}"
    client = await hub.connect(websocket, student_id=student_id, admin_id=None, name=name)
    hub.join_room(client, room_key)
    pump = asyncio.create_task(_pump(client))
    try:
        await hub.send(client, "room_state", state)
        while True:
            raw = await websocket.receive_text()
            client.touch()
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
                    payload = await add_room_message_async(room_id, student_id, body)
                except Exception as exc:  # noqa: BLE001 - relay the reason to the sender
                    await hub.send(client, "error", {"message": str(exc)})
                    continue
                if payload is None:  # room or sender vanished: silently skip, as before
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


def _ranked_handshake(match_id: int, student_id: int, connected_ids: set[int]) -> dict | None:
    """One-shot connect state for a ranked match.

    Runs on a worker thread (see ``ranked_socket``): it reuses the deep sync
    service chain in ``services.ranked`` wholesale instead of porting it, and
    off-thread it cannot block the event loop.
    """
    from ..services.ranked import match_state

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
            return None
        student = db.get(Student, student_id)
        return {
            "name": student.name if student else None,
            "state": match_state(db, match, student_id, connected_ids),
        }


@router.websocket("/ws/ranked/{match_id}")
async def ranked_socket(websocket: WebSocket, match_id: int) -> None:
    """Ranked match channel: live standings, question pacing, activity."""
    principal = decode_token(websocket.query_params.get("token"))
    if not principal or principal.role != ROLE_STUDENT:
        await websocket.close(code=4401)
        return
    student_id = int(principal.subject)

    room_key = f"ranked:{match_id}"
    info = await asyncio.to_thread(_ranked_handshake, match_id, student_id, hub.student_ids_in_room(room_key))
    if info is None:
        await websocket.close(code=4403)
        return

    client = await hub.connect(websocket, student_id=student_id, admin_id=None, name=info["name"] or principal.name)
    hub.join_room(client, room_key)
    pump = asyncio.create_task(_pump(client))
    try:
        await hub.send(client, "ranked_state", info["state"])
        await hub.broadcast(
            "ranked_presence",
            {"student_id": student_id, "connected": True},
            room=room_key,
        )
        await _consume(client, websocket, None, ranked_room_name=room_key, ranked_match_id=match_id)
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


def _event_handshake(event_id: int, student_id: int, connected_ids: set[int]) -> dict | None:
    """One-shot connect state for an arena event (worker thread — same reason
    as ``_ranked_handshake``)."""
    from ..services.events import event_public, leaderboard_payload

    with session_scope() as db:
        event = db.get(ArenaEvent, event_id)
        if event is None:
            return None
        student = db.get(Student, student_id)
        return {
            "name": student.name if student else None,
            "payload": {
                "event": event_public(db, event, student_id),
                "leaderboard": (
                    leaderboard_payload(db, event, student_id, connected_ids)
                    if event.leaderboard_visible
                    else None
                ),
            },
        }


@router.websocket("/ws/event/{event_id}")
async def event_socket(websocket: WebSocket, event_id: int) -> None:
    """Event channel: leaderboard deltas, activity, start/end transitions."""
    principal = decode_token(websocket.query_params.get("token"))
    if not principal or principal.role != ROLE_STUDENT:
        await websocket.close(code=4401)
        return
    student_id = int(principal.subject)

    room_key = f"event:{event_id}"
    info = await asyncio.to_thread(_event_handshake, event_id, student_id, hub.student_ids_in_room(room_key))
    if info is None:
        await websocket.close(code=4403)
        return

    client = await hub.connect(websocket, student_id=student_id, admin_id=None, name=info["name"] or principal.name)
    hub.join_room(client, room_key)
    pump = asyncio.create_task(_pump(client))
    try:
        await hub.send(client, "event_state", info["payload"])
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
    """Public open-arena challenges anyone can join (private duels stay hidden)."""
    from ..services.duel import public_duels

    with session_scope() as db:
        return [duel_public(d) for d in public_duels(db)][:10]
