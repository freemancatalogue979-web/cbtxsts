"""Websocket load / lag regression suite.

Run against a live server (the committed regression suite in verify_arena.py
covers REST behaviour; this one covers the realtime paths)::

    backend/.venv/bin/python backend/tests/ws_load.py
    ARENA_API=http://host:3000/api backend/.venv/bin/python backend/tests/ws_load.py

For the dead-client reaping checks to run in seconds instead of minutes, start
the server with short windows, e.g.::

    ARENA_HEARTBEAT_SECONDS=2 ARENA_STALE_AFTER_SECONDS=6 \\
        uvicorn app.main:app --host 0.0.0.0 --port 3000

What this exercises (the acceptance list for the async-hub rework):

  * many concurrent clients on the live channel
  * one client sending messages rapidly
  * a silent / never-reading client that must NOT hold anyone else up
  * dead (silent) clients get reaped; everyone else keeps receiving traffic
  * room chat writes persist asynchronously and broadcast while one member
    is a dead weight
  * disconnect / reconnect sanity
"""
from __future__ import annotations

import asyncio
import json
import os
import random
import statistics
import string
import sys
import time
import urllib.error
import urllib.request
from collections import Counter

import websockets

API = os.environ.get("ARENA_API", "http://127.0.0.1:3000/api")
ROOT = API[: -len("/api")] if API.endswith("/api") else API  # the live router mounts at /, not /api
WS_BASE = os.environ.get("ARENA_WS", ROOT.replace("http://", "ws://").rstrip("/"))

PASSED = 0
FAILED = 0

READERS = 10          # normal draining clients on the live channel
PRESENCE_BLAST = 300  # rapid-fire broadcasts from one client
CHAT_BLAST = 100      # rapid-fire room chat messages from the host


def check(label: str, condition: bool, extra="") -> None:
    global PASSED, FAILED
    if condition:
        PASSED += 1
        print(f"  ok   {label}")
    else:
        FAILED += 1
        print(f"  FAIL {label} :: {extra}")


def call(method: str, path: str, body=None, token: str | None = None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(API + path, data=data, method=method)
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request) as response:
            raw = response.read().decode()
            return response.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as error:
        raw = error.read().decode()
        try:
            return error.code, json.loads(raw)
        except Exception:
            return error.code, raw


def get_presence() -> dict:
    """The live router is mounted unprefixed, so presence lives at /live/presence."""
    with urllib.request.urlopen(ROOT + "/live/presence") as response:
        return json.loads(response.read().decode())


def letters(n: int) -> str:
    return "".join(random.choice(string.ascii_lowercase) for _ in range(n))


def digits(n: int) -> str:
    return "".join(random.choice(string.digits) for _ in range(n))


def new_student(prefix: str) -> tuple[str, dict]:
    status, payload = call(
        "POST",
        "/auth/register",
        {"username": f"{prefix}{letters(6)}", "phone": f"0703{digits(7)}", "password": "secret123"},
    )
    if status != 200:
        print(f"cannot register a player: {status} {payload}")
        sys.exit(2)
    return payload["token"], payload["profile"]


class Reader:
    """A client that drains its socket like a healthy browser tab would."""

    def __init__(self, ws):
        self.ws = ws
        self.counts: Counter[str] = Counter()
        self.presence_events = 0
        self.last_presence: dict | None = None
        self.pong_times: list[float] = []
        self._pending_ping: float | None = None

    async def drain(self) -> None:
        async for raw in self.ws:
            message = json.loads(raw)
            event = message.get("event")
            self.counts[event] += 1
            if event == "presence":
                self.presence_events += 1
                self.last_presence = message.get("data")
            elif event == "pong" and self._pending_ping is not None:
                self.pong_times.append(time.monotonic() - self._pending_ping)
                self._pending_ping = None

    async def keepalive(self, every: float = 2.0) -> None:
        """Mirror the browser client's app-level ping so we stay off the
        stale list (the frontend sends one every 20s)."""
        while True:
            await asyncio.sleep(every)
            self._pending_ping = time.monotonic()
            try:
                await self.ws.send(json.dumps({"type": "ping"}))
            except Exception:
                return


async def open_live(token: str):
    return await websockets.connect(f"{WS_BASE}/ws/live?token={token}", max_size=4 * 1024 * 1024)


async def recv_event(ws, event: str, timeout: float = 5.0) -> dict | None:
    """Wait for a specific event, skipping everything else (presence broadcasts
    legitimately arrive ahead of welcome/state frames)."""
    deadline = time.monotonic() + timeout
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return None
        raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
        message = json.loads(raw)
        if message.get("event") == event:
            return message


# ---------------------------------------------------------------------------
# 1. parallel fan-out: rapid sender + silent dead weight on the live channel
# ---------------------------------------------------------------------------
async def live_channel_load(silent_token: str, blaster_token: str) -> None:
    print("\nlive channel under load")

    reader_tokens = [new_student("ldr")[0] for _ in range(READERS)]
    readers: list[Reader] = []
    connections = []
    for token in reader_tokens:
        ws = await open_live(token)
        connections.append(ws)
        readers.append(Reader(ws))
    drain_tasks = [asyncio.create_task(reader.drain()) for reader in readers]
    keepalive_tasks = [asyncio.create_task(reader.keepalive()) for reader in readers]

    # the dead weight: connects, reads nothing after the welcome frame
    silent_ws = await open_live(silent_token)
    await silent_ws.recv()  # welcome

    # the rapid sender (single manual consumer — no drain task).
    # NOTE: the websockets library allows only one writer per connection, so
    # every send on this socket happens in the main task (no keepalive task).
    blaster_ws = await open_live(blaster_token)
    connections += [silent_ws, blaster_ws]
    await asyncio.sleep(0.5)  # let welcomes + first presence settle

    async def recv_until_pong(timeout: float = 5.0) -> tuple[list[float], int]:
        """Drain the blaster's socket, timing ping→pong; count presence too."""
        pong_times: list[float] = []
        presence_seen = 0
        deadline = time.monotonic() + timeout
        sent_at = time.monotonic()
        await blaster_ws.send(json.dumps({"type": "ping"}))
        while time.monotonic() < deadline:
            raw = await asyncio.wait_for(blaster_ws.recv(), timeout=deadline - time.monotonic() + 0.1)
            message = json.loads(raw)
            if message.get("event") == "pong":
                pong_times.append(time.monotonic() - sent_at)
                break
            if message.get("event") == "presence":
                presence_seen += 1
        return pong_times, presence_seen

    start = time.monotonic()
    for _ in range(PRESENCE_BLAST):
        await blaster_ws.send(json.dumps({"type": "presence"}))
    blast_seconds = time.monotonic() - start

    # round-trip checks under fire
    ping_latencies: list[float] = []
    blaster_presence = 0
    for _ in range(5):
        pong_times, presence_seen = await recv_until_pong()
        ping_latencies.extend(pong_times)
        blaster_presence += presence_seen
    # drain whatever is still queued so the count is honest
    try:
        while True:
            raw = await asyncio.wait_for(blaster_ws.recv(), timeout=2)
            if json.loads(raw).get("event") == "presence":
                blaster_presence += 1
    except (asyncio.TimeoutError, Exception):
        pass

    check(
        f"blaster fired {PRESENCE_BLAST} presence requests in {blast_seconds:.2f}s",
        blast_seconds < 10,
        blast_seconds,
    )
    check(
        "ping→pong stayed fast while broadcasting",
        ping_latencies and max(ping_latencies) < 1.0,
        [round(latency, 3) for latency in ping_latencies],
    )
    check(
        "the blaster saw its own presence broadcasts come back",
        blaster_presence >= PRESENCE_BLAST // 2,
        blaster_presence,
    )
    await asyncio.sleep(1)  # let fan-out finish everywhere
    drained = [reader.presence_events for reader in readers]
    check(
        "every healthy reader got the broadcasts in parallel",
        min(drained) >= PRESENCE_BLAST // 2,
        drained,
    )
    reader_pongs = [t for reader in readers for t in reader.pong_times]
    median_pong = statistics.median(reader_pongs) if reader_pongs else None
    check(
        "keepalive pongs stayed quick for the crowd",
        median_pong is not None and median_pong < 0.5,
        median_pong,
    )

    # ---- dead client reaping -------------------------------------------
    presence_now = get_presence()
    online_ids = set(presence_now.get("student_ids", []))
    silent_id = SILENT_PROFILE["id"]
    check("the silent client still counts online before the reaper fires", silent_id in online_ids, sorted(online_ids))

    # no app pings ever arrive from the silent socket → the pump reaps it
    deadline = time.monotonic() + 40
    reaped = False
    while time.monotonic() < deadline:
        await asyncio.sleep(2)
        # keep the blaster itself off the stale list while we wait
        await blaster_ws.send(json.dumps({"type": "ping"}))
        snapshot = get_presence()
        if silent_id not in set(snapshot.get("student_ids", [])):
            reaped = True
            break
    check("the silent client was reaped (dropped from presence)", reaped)

    # and the room kept working after the reap
    raw = await asyncio.wait_for(blaster_ws.recv(), timeout=5)
    check(
        "traffic keeps flowing after the reap",
        json.loads(raw).get("event") in {"pong", "presence", "heartbeat"},
        json.loads(raw).get("event"),
    )

    for task in keepalive_tasks:
        task.cancel()
    for ws in connections:
        await ws.close()
    for task in drain_tasks:
        task.cancel()
    await asyncio.gather(*drain_tasks, *keepalive_tasks, return_exceptions=True)


# ---------------------------------------------------------------------------
# 2. room chat: async writes + one member that never reads again
# ---------------------------------------------------------------------------
async def room_chat_load(host_token: str, dead_token: str) -> None:
    print("\nroom chat under load")

    status, created = call(
        "POST",
        "/rooms",
        {"title": "Load room", "course_id": None, "question_count": 3, "per_question_seconds": 20},
        token=host_token,
    )
    check("host can create a room", status == 200 and created.get("room"), f"{status} {created}")
    room = created["room"]

    status, joined = call("POST", f"/rooms/join/{room['code']}", token=dead_token)
    check("second player can join by code", status == 200, f"{status} {joined}")

    host_ws = await websockets.connect(f"{WS_BASE}/ws/room/{room['id']}?token={host_token}", max_size=4 * 1024 * 1024)
    dead_ws = await websockets.connect(f"{WS_BASE}/ws/room/{room['id']}?token={dead_token}", max_size=4 * 1024 * 1024)

    host_state = await recv_event(host_ws, "room_state")
    check("host receives room_state on connect", host_state is not None)
    members = host_state["data"]["room"]["members"] if host_state else []
    check("initial room_state lists both members", len(members) == 2, members)
    dead_state = await recv_event(dead_ws, "room_state")
    check("dead-weight member also received its initial state", dead_state is not None)
    # ...and never reads another frame from here on.

    bodies = [f"load-{index}-{'x' * 360}" for index in range(CHAT_BLAST)]
    received: dict[str, float] = {}
    latencies: list[float] = []

    # The host stays fresh purely by sending (every chat frame counts as
    # inbound traffic server-side), so no separate keepalive task — the
    # websockets library allows exactly one writer per connection.
    start = time.monotonic()
    for index, body in enumerate(bodies):
        sent_at = time.monotonic()
        await host_ws.send(json.dumps({"type": "chat", "body": body}))
        while len(received) <= index:
            raw = await asyncio.wait_for(host_ws.recv(), timeout=10)
            message = json.loads(raw)
            if message.get("event") != "room_chat":
                continue  # heartbeats / presence keep arriving in parallel
            got = message["data"]["body"]
            if got not in received:
                received[got] = time.monotonic()
                latencies.append(received[got] - sent_at)
    total = time.monotonic() - start

    check(f"all {CHAT_BLAST} chat messages echoed back to the sender", len(received) == CHAT_BLAST, len(received))
    if latencies:
        check(
            "no single echo waited on the dead member (all under the 2s send timeout)",
            max(latencies) < 2.0,
            f"max={max(latencies):.3f}s median={statistics.median(latencies):.3f}s",
        )
        check(
            "rapid sending stayed rapid",
            total < 20,
            f"{total:.2f}s for {CHAT_BLAST} messages",
        )

    status, page = call("GET", f"/rooms/{room['id']}/messages", token=host_token)
    persisted = [row["body"] for row in page.get("messages", page.get("rows", []))] if status == 200 else []
    # the REST history view caps at 80 rows (messages_payload default), so a
    # 100-message blast shows the newest 80 — the newest must be our last send
    check(
        "chat writes persisted asynchronously",
        status == 200 and len(persisted) == min(CHAT_BLAST, 80) and persisted[-1] == bodies[-1],
        f"status={status} stored={len(persisted)}",
    )

    await host_ws.close()
    await dead_ws.close()


# ---------------------------------------------------------------------------
# 3. reconnect + heartbeat sanity
# ---------------------------------------------------------------------------
async def reconnect_and_heartbeat(token: str) -> None:
    print("\nreconnect + heartbeat")
    ws = await open_live(token)
    first = await recv_event(ws, "welcome")
    check("welcome carries the snapshot on first connect", first is not None)
    data = (first or {}).get("data", {})
    check(
        "snapshot shape unchanged (profile/leaderboard/online/online_ids)",
        {"profile", "leaderboard", "online", "online_ids"} <= set(data),
        sorted(data),
    )
    await ws.close()
    await asyncio.sleep(0.4)

    ws = await open_live(token)
    again = await recv_event(ws, "welcome")
    check("reconnect gets a fresh welcome snapshot", again is not None)

    # heartbeats arrive on the async snapshot path (send a ping now and then —
    # with fast test windows a silent socket gets reaped before the heartbeat)
    got_heartbeat = False
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        try:
            await ws.send(json.dumps({"type": "ping"}))
            raw = await asyncio.wait_for(ws.recv(), timeout=5)
        except (asyncio.TimeoutError, websockets.ConnectionClosed):
            break
        message = json.loads(raw)
        if message.get("event") == "heartbeat":
            got_heartbeat = True
            break
    check("heartbeat still arrives (async _snapshot under the pump)", got_heartbeat)
    await ws.close()


# ---------------------------------------------------------------------------
# 4. 10+ clients on one room socket, one of them dead mid-blast
# ---------------------------------------------------------------------------
async def room_crowd_load(host_token: str) -> None:
    print("\nroom with a crowd (12 sockets)")
    status, created = call(
        "POST",
        "/rooms",
        {"title": "Crowd room", "course_id": None, "question_count": 3, "per_question_seconds": 20},
        token=host_token,
    )
    check("crowd room created", status == 200 and created.get("room"), f"{status} {created}")
    room = created["room"]

    guest_tokens = []
    for _ in range(11):
        token, _ = new_student("crwd")
        status, _ = call("POST", f"/rooms/join/{room['code']}", token=token)
        if status != 200:
            check("guests can join the crowd room", False, status)
            return
        guest_tokens.append(token)
    check("11 guests joined (12 players total)", True)

    sockets = []
    host_ws = await websockets.connect(f"{WS_BASE}/ws/room/{room['id']}?token={host_token}", max_size=4 * 1024 * 1024)
    sockets.append(host_ws)
    await recv_event(host_ws, "room_state")
    guests = []
    for token in guest_tokens:
        ws = await websockets.connect(f"{WS_BASE}/ws/room/{room['id']}?token={token}", max_size=4 * 1024 * 1024)
        sockets.append(ws)
        guests.append(ws)
    dead_ws = guests[0]  # this one stops reading after its initial state
    await recv_event(dead_ws, "room_state")

    readers = [asyncio.create_task(_drain_guest(ws)) for ws in guests[1:]]

    blast = 50
    for index in range(blast):
        await host_ws.send(json.dumps({"type": "chat", "body": f"crowd-{index}"}))
    # drain the host's own echoes
    got = 0
    deadline = time.monotonic() + 20
    while got < blast and time.monotonic() < deadline:
        message = json.loads(await asyncio.wait_for(host_ws.recv(), timeout=20))
        if message.get("event") == "room_chat":
            got += 1
    check("host received every echo in the crowd room", got == blast, got)

    await asyncio.sleep(1.5)
    for ws in sockets:
        try:
            await ws.close()
        except Exception:
            pass
    counts = await asyncio.gather(*readers, return_exceptions=True)
    counts = [c for c in counts if isinstance(c, int)]
    check(
        "every healthy guest received the full blast despite the dead member",
        counts and min(counts) >= blast,
        counts,
    )


async def _drain_guest(ws) -> int:
    """Read the room feed; ping during quiet gaps so the server knows we're
    alive. One task owns this socket — the websockets library allows exactly
    one writer per connection."""
    count = 0
    while True:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
        except asyncio.TimeoutError:
            try:
                await ws.send(json.dumps({"type": "ping"}))
            except Exception:
                return count
            continue
        except Exception:
            return count
        try:
            if json.loads(raw).get("event") == "room_chat":
                count += 1
        except Exception:
            return count


SILENT_PROFILE: dict = {}


def main() -> None:
    print(f"ws load suite against {API}")
    silent_token, silent_profile = new_student("silent")
    blaster_token, _ = new_student("fast")
    host_token, _ = new_student("host")
    dead_token, _ = new_student("dead")
    SILENT_PROFILE.update(silent_profile)

    asyncio.run(live_channel_load(silent_token, blaster_token))
    asyncio.run(room_chat_load(host_token, dead_token))
    asyncio.run(room_crowd_load(host_token))
    asyncio.run(reconnect_and_heartbeat(blaster_token))

    print(f"\n{PASSED} passed, {FAILED} failed")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
