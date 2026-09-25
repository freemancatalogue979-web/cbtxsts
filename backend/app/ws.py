"""Live websocket hub: presence, global feed, duel rooms.

Realtime design notes
---------------------
* Fan-out is parallel: one ``asyncio.gather`` per broadcast, each send wrapped
  in a timeout. A slow or half-dead socket can never stall the other clients.
* Clients that miss their send window (or fail outright) are disconnected and
  dropped from every room, so dead sockets do not accumulate.
* Connection state (rooms, online ids) stays in memory; the database is only
  touched — asynchronously — by the routers for persistent data.
"""
from __future__ import annotations

import asyncio
import json
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

#: Max seconds a single websocket send may take before the client is dropped.
SEND_TIMEOUT_SECONDS = 2.0


@dataclass(slots=True, eq=False)  # eq=False keeps identity hashing for room sets
class Client:
    websocket: WebSocket
    student_id: int | None = None
    admin_id: int | None = None
    name: str = ""
    rooms: set[str] = field(default_factory=lambda: {"live"})
    # Presence state for group rooms: "online" while the tab is foregrounded,
    # "away" when the client reports the page is hidden/idle.
    status: str = "online"
    last_seen: float = field(default_factory=time.monotonic)
    closed: bool = False

    def touch(self) -> None:
        """Record inbound traffic so the liveness check knows we're alive."""
        self.last_seen = time.monotonic()


class Hub:
    """Async broadcast hub with named rooms.

    Rooms in use:
      * ``live``            – every authenticated connection (feed, leaderboard, invites)
      * ``duel:{duel_id}``  – the two players of a head-to-head match
      * ``group:{group_id}``– study-group workspace (chat, quizzes, presence)
      * ``admin``           – staff console (live submission counters)
    """

    def __init__(self) -> None:
        self._rooms: dict[str, set[Client]] = defaultdict(set)
        self._clients: dict[int, set[Client]] = defaultdict(set)  # student_id -> clients
        self._admin_clients: set[Client] = set()
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------ join
    async def connect(self, websocket: WebSocket, *, student_id: int | None, admin_id: int | None, name: str) -> Client:
        await websocket.accept()
        client = Client(websocket=websocket, student_id=student_id, admin_id=admin_id, name=name)
        client.touch()
        async with self._lock:
            self._rooms["live"].add(client)
            if student_id is not None:
                self._clients[student_id].add(client)
            if admin_id is not None:
                self._admin_clients.add(client)
                client.rooms.add("admin")
                self._rooms["admin"].add(client)
        await self.broadcast_presence()
        return client

    async def disconnect(self, client: Client) -> None:
        """Idempotent: the endpoint teardown and the stale-client cleanup both call this."""
        async with self._lock:
            if client.closed:
                return
            client.closed = True
            for room in list(client.rooms):
                self._rooms[room].discard(client)
            if client.student_id is not None:
                self._clients[client.student_id].discard(client)
                if not self._clients[client.student_id]:
                    self._clients.pop(client.student_id, None)
            self._admin_clients.discard(client)
        try:
            await client.websocket.close()
        except Exception:
            pass
        await self.broadcast_presence()

    def join_room(self, client: Client, room: str) -> None:
        client.rooms.add(room)
        self._rooms[room].add(client)

    def leave_room(self, client: Client, room: str) -> None:
        client.rooms.discard(room)
        self._rooms[room].discard(client)

    # ------------------------------------------------------------- introspect
    @property
    def online_student_ids(self) -> list[int]:
        return sorted(self._clients.keys())

    def online_count(self) -> int:
        return len(self._clients)

    def is_online(self, student_id: int) -> bool:
        return bool(self._clients.get(student_id))

    def clients_for(self, student_id: int) -> list[Client]:
        return list(self._clients.get(student_id, ()))

    def student_ids_in_room(self, room: str) -> set[int]:
        """Which players currently hold a socket in a named room (presence)."""
        return {client.student_id for client in self._rooms.get(room, ()) if client.student_id is not None}

    def room_clients(self, room: str) -> list[Client]:
        """Every live client holding a socket in a named room."""
        return list(self._rooms.get(room, ()))

    async def online_snapshot(self) -> dict[str, Any]:
        """Online count + ids, snapshotted under the lock in one quick pass.

        Callers must use the returned copy — it is safe to do slow work
        (async DB queries, broadcasting) afterwards without holding the lock.
        """
        async with self._lock:
            return {"online": len(self._clients), "student_ids": sorted(self._clients.keys())}

    # -------------------------------------------------------------- messaging
    async def send(self, client: Client, event: str, payload: dict[str, Any] | None = None) -> None:
        await self._emit([client], event, payload)

    async def send_to_student(self, student_id: int, event: str, payload: dict[str, Any] | None = None) -> None:
        await self._emit(self.clients_for(student_id), event, payload)

    async def broadcast(self, event: str, payload: dict[str, Any] | None = None, room: str = "live") -> None:
        await self._emit(list(self._rooms.get(room, ())), event, payload)

    async def broadcast_to_admins(self, event: str, payload: dict[str, Any] | None = None) -> None:
        await self._emit(list(self._admin_clients), event, payload)

    async def broadcast_presence(self) -> None:
        snapshot = await self.online_snapshot()
        await self.broadcast(
            "presence",
            {"online": snapshot["online"], "student_ids": snapshot["student_ids"]},
        )

    async def _emit(self, clients: list[Client], event: str, payload: dict[str, Any] | None) -> None:
        """Fan one message out to many sockets *in parallel*.

        Each send gets its own bounded timeout: a socket that cannot keep up
        (dozing phone, frozen tab, dead TCP) is marked stale and disconnected
        afterwards instead of queueing everyone else behind it.
        """
        if not clients:
            return
        message = json.dumps({"event": event, "data": payload or {}}, default=str)

        async def deliver(client: Client) -> Client | None:
            try:
                await asyncio.wait_for(client.websocket.send_text(message), timeout=SEND_TIMEOUT_SECONDS)
            except asyncio.CancelledError:  # pragma: no cover - let shutdown propagate
                raise
            except Exception:
                return client  # failed or timed out → stale
            return None

        results = await asyncio.gather(*(deliver(client) for client in clients))
        stale = [client for client in results if client is not None]
        for client in stale:
            asyncio.create_task(self.disconnect(client))


hub = Hub()
