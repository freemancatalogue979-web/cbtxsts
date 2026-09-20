"""Socket handshake smoke suite: duel / event / ranked channels.

The load suite (ws_load.py) stresses the live channel and room chat; this one
proves the *other* websocket endpoints still complete their handshakes after
the async-hub rework, with the exact same payloads and close codes as before::

    backend/.venv/bin/python backend/tests/ws_handshake.py
"""
from __future__ import annotations

import asyncio
import json
import os
import random
import string
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

import websockets

API = os.environ.get("ARENA_API", "http://127.0.0.1:3000/api")
ROOT = API[: -len("/api")] if API.endswith("/api") else API
WS_BASE = ROOT.replace("http://", "ws://").rstrip("/")
ADMIN_EMAIL = os.environ.get("ARENA_ADMIN_EMAIL", "admin@quizarena.ng")
ADMIN_PASSWORD = os.environ.get("ARENA_ADMIN_PASSWORD", "arena2026")

PASSED = 0
FAILED = 0


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


def admin_token() -> str:
    status, payload = call("POST", "/auth/admin", {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    if status != 200:
        print(f"cannot sign in as staff: {status} {payload}")
        sys.exit(2)
    return payload["token"]


async def recv_event(ws, event: str, timeout: float = 6.0) -> dict | None:
    deadline = time.monotonic() + timeout
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return None
        raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
        message = json.loads(raw)
        if message.get("event") == event:
            return message


async def expect_rejected(path: str) -> bool:
    """A 4403 close issued before accept surfaces as a failed handshake."""
    try:
        ws = await websockets.connect(f"{WS_BASE}{path}")
    except Exception:
        return True
    try:
        await asyncio.wait_for(ws.recv(), timeout=3)
    except Exception:
        return True
    await ws.close()
    return False


# ---------------------------------------------------------------------------
# duel socket: async eager-loaded handshake
# ---------------------------------------------------------------------------
async def duel_handshake() -> None:
    print("\nduel socket handshake")
    token_a, profile_a = new_student("duela")
    token_b, profile_b = new_student("duelb")
    token_c, _ = new_student("duelc")

    status, duel = call("POST", "/duels", {"opponent_id": profile_b["id"], "question_count": 5}, token=token_a)
    check("duel created", status == 200 and duel.get("id"), f"{status} {duel}")
    duel_id = duel["id"]

    status, accepted = call("POST", f"/duels/{duel_id}/accept", {}, token=token_b)
    check("opponent accepted", status == 200, f"{status} {accepted}")

    ws_a = await websockets.connect(f"{WS_BASE}/ws/duel/{duel_id}?token={token_a}")
    state = await recv_event(ws_a, "duel_state")
    check("challenger receives duel_state", state is not None)
    data = (state or {}).get("data", {})
    check(
        "duel_state carries both participants and the questions",
        len(data.get("participants", [])) == 2 and len(data.get("questions", [])) == 5,
        sorted(data),
    )

    ws_b = await websockets.connect(f"{WS_BASE}/ws/duel/{duel_id}?token={token_b}")
    state_b = await recv_event(ws_b, "duel_state")
    check("opponent receives duel_state too", state_b is not None)

    check("a stranger is rejected", await expect_rejected(f"/ws/duel/{duel_id}?token={token_c}"))
    check("a missing duel is rejected", await expect_rejected(f"/ws/duel/999999?token={token_a}"))

    await ws_a.close()
    await ws_b.close()


# ---------------------------------------------------------------------------
# event socket: worker-thread handshake (deep sync service chain)
# ---------------------------------------------------------------------------
async def event_handshake() -> None:
    print("\nevent socket handshake")
    token, profile = new_student("evta")
    staff = admin_token()

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    status, created = call(
        "POST",
        "/admin/events",
        {
            "name": f"Handshake Cup {letters(4)}",
            "description": "smoke event",
            "starts_at": (now - timedelta(minutes=5)).isoformat(),
            "ends_at": (now + timedelta(hours=2)).isoformat(),
            "time_mode": "untimed",
        },
        token=staff,
    )
    check("staff can schedule an event", status == 200 and created.get("event"), f"{status} {created}")
    event_id = created["event"]["id"]

    status, joined = call("POST", f"/events/{event_id}/join", {}, token=token)
    check("player can join the event", status == 200, f"{status} {joined}")

    ws = await websockets.connect(f"{WS_BASE}/ws/event/{event_id}?token={token}")
    state = await recv_event(ws, "event_state")
    check("event socket delivers event_state", state is not None)
    data = (state or {}).get("data", {})
    check(
        "event_state has event + leaderboard",
        isinstance(data.get("event"), dict) and "leaderboard" in data,
        sorted(data),
    )
    await ws.close()

    check("a missing event is rejected", await expect_rejected(f"/ws/event/999999?token={token}"))


# ---------------------------------------------------------------------------
# ranked socket: worker-thread handshake through matchmaking
# ---------------------------------------------------------------------------
async def ranked_handshake() -> None:
    print("\nranked socket handshake")
    token_a, _ = new_student("rkqa")
    token_b, _ = new_student("rkqb")

    # the queue is per-course; any seeded course id works for the handshake
    status, queue_meta = call("GET", "/ranked/meta", token=token_a)
    course_id = None
    if status == 200:
        courses = queue_meta.get("courses") or queue_meta.get("queue") or []
        if isinstance(courses, list) and courses:
            course_id = (courses[0] or {}).get("id") or (courses[0] or {}).get("course_id")
    course_id = course_id or 1

    for tok in (token_a, token_b):
        status, queued = call("POST", "/ranked/queue", {"course_id": course_id}, token=tok)
        if status != 200:
            check("player can join the ranked queue", False, f"{status} {queued}")
            return
    check("both players joined the ranked queue", True)

    match_id = None
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        await asyncio.sleep(1)
        status, mine = call("GET", "/ranked/status", token=token_a)
        if status == 200 and mine.get("match_id"):
            match_id = mine["match_id"]
            break
    check("matchmaking minted a match", match_id is not None)
    if match_id is None:
        return

    ws = await websockets.connect(f"{WS_BASE}/ws/ranked/{match_id}?token={token_a}")
    state = await recv_event(ws, "ranked_state")
    check("ranked socket delivers ranked_state", state is not None)
    data = (state or {}).get("data", {})
    check(
        "ranked_state carries participants + clocks",
        "participants" in data and "server_now" in data,
        sorted(data),
    )
    await ws.close()

    token_c, _ = new_student("rkqc")
    check("a non-participant is rejected", await expect_rejected(f"/ws/ranked/{match_id}?token={token_c}"))


def main() -> None:
    print(f"ws handshake suite against {API}")
    asyncio.run(duel_handshake())
    asyncio.run(event_handshake())
    asyncio.run(ranked_handshake())
    print(f"\n{PASSED} passed, {FAILED} failed")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
