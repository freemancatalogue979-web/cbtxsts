"""Socket integration suite: duel / event / ranked channels.

The load suite (ws_load.py) stresses the live channel and room chat; this one
proves that the other websocket endpoints still handshake correctly and that
ranked chat, reconnect snapshots, and per-player question events reach clients::

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


async def recv_ranked_question(ws, timeout: float = 24.0) -> dict | None:
    """Accept either the live question event or a reconnect state snapshot."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        remaining = deadline - time.monotonic()
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
        except asyncio.TimeoutError:
            return None
        message = json.loads(raw)
        data = message.get("data") or {}
        if message.get("event") == "ranked_question" and data.get("question"):
            return data
        if message.get("event") == "ranked_state" and data.get("status") == "live" and data.get("question"):
            return {
                "index": data.get("round_index"),
                "total": data.get("questions_total"),
                "deadline": data.get("question_deadline"),
                "question": data.get("question"),
            }
    return None


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
# ranked socket: reconnect state, lobby messages and individual questions
# ---------------------------------------------------------------------------
async def ranked_handshake() -> None:
    print("\nranked live socket + matchmaking")
    staff = admin_token()
    status, meta = call("GET", "/ranked/meta")
    match_size = max(2, int((meta or {}).get("match_size") or 15))
    status, course_payload = call("GET", "/admin/courses", token=staff)
    courses = course_payload.get("courses") if isinstance(course_payload, dict) else course_payload
    course = max((row for row in courses or [] if row.get("question_count", 0) > 0), key=lambda row: row.get("question_count", 0), default=None)
    if status != 200 or course is None:
        check("a ranked course with questions is available", False, str(course_payload)[:180])
        return
    course_id = course["id"]

    players = [new_student("rkqa")[0], new_student("rkqb")[0]]
    players.extend(new_student("rkqx")[0] for _ in range(match_size - len(players)))
    outsider, _ = new_student("rkqc")

    for token in players:
        status, queued = call("POST", "/ranked/queue", {"course_id": course_id}, token=token)
        if status != 200:
            check("player can join the ranked queue", False, f"{status} {queued}")
            return
    check("a full ranked queue joins the same course", True)

    match_id = None
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        await asyncio.sleep(0.5)
        status, mine = call("GET", "/ranked/status", token=players[0])
        if status == 200 and mine.get("match_id"):
            match_id = mine["match_id"]
            break
    check("matchmaking mints a full match", match_id is not None)
    if match_id is None:
        return

    ws_a = await websockets.connect(f"{WS_BASE}/ws/ranked/{match_id}?token={players[0]}")
    ws_b = await websockets.connect(f"{WS_BASE}/ws/ranked/{match_id}?token={players[1]}")
    state_a, state_b = await asyncio.gather(
        recv_event(ws_a, "ranked_state", timeout=8),
        recv_event(ws_b, "ranked_state", timeout=8),
    )
    check("both opponents receive ranked_state", state_a is not None and state_b is not None)
    data_a = (state_a or {}).get("data", {})
    data_b = (state_b or {}).get("data", {})
    check(
        "ranked_state is a direct participant snapshot with clocks",
        data_a.get("id") == match_id and "participants" in data_a and "server_now" in data_a,
        sorted(data_a),
    )
    check("ranked_state carries the full opponent roster", len(data_a.get("participants", [])) == match_size, len(data_a.get("participants", [])))
    check("newly connected players start in the lobby", data_a.get("status") == "lobby" and data_b.get("status") == "lobby", (data_a.get("status"), data_b.get("status")))

    first_message = f"Ranked lobby hello {letters(6)}"
    await ws_a.send(json.dumps({"type": "chat", "body": first_message}))
    delivered = await recv_event(ws_b, "ranked_chat", timeout=5)
    check("a new lobby message reaches the opponent", (delivered or {}).get("data", {}).get("body") == first_message, str(delivered))

    # A lobby reconnect gets the bounded chat snapshot, including messages
    # sent while that participant was disconnected.
    await ws_b.close()
    second_message = f"Catch-up message {letters(6)}"
    await ws_a.send(json.dumps({"type": "chat", "body": second_message}))
    await recv_event(ws_a, "ranked_chat", timeout=5)
    ws_b = await websockets.connect(f"{WS_BASE}/ws/ranked/{match_id}?token={players[1]}")
    resumed = await recv_event(ws_b, "ranked_state", timeout=8)
    resumed_data = (resumed or {}).get("data", {})
    history = [row.get("body") for row in resumed_data.get("lobby_chat", [])]
    check("reconnecting lobby replays missed messages", first_message in history and second_message in history, str(history))

    # The server sends one private question per participant on the shared
    # round clock. A reconnecting client may receive the question in its state
    # snapshot instead of the original ranked_question event.
    def current_question(state: dict) -> dict:
        return {
            "index": state.get("round_index"),
            "total": state.get("questions_total"),
            "deadline": state.get("question_deadline"),
            "question": state.get("question"),
        }

    if resumed_data.get("status") == "live" and resumed_data.get("question"):
        question_a = await recv_ranked_question(ws_a) if data_a.get("status") == "lobby" else current_question(data_a)
        question_b = current_question(resumed_data)
    elif data_a.get("status") == "lobby":
        question_a, question_b = await asyncio.gather(
            recv_ranked_question(ws_a),
            recv_ranked_question(ws_b),
        )
    else:
        question_a, question_b = current_question(data_a), current_question(resumed_data)
    qa = (question_a or {}).get("question") or {}
    qb = (question_b or {}).get("question") or {}
    check("both opponents receive their own live question", bool(qa.get("id")) and bool(qb.get("id")), (qa.get("id"), qb.get("id")))
    check("ranked questions differ while the round clock is shared", qa.get("id") != qb.get("id") and (question_a or {}).get("index") == (question_b or {}).get("index"), (qa.get("id"), qb.get("id"), (question_a or {}).get("index"), (question_b or {}).get("index")))

    await ws_a.close()
    await ws_b.close()
    check("a non-participant is rejected", await expect_rejected(f"/ws/ranked/{match_id}?token={outsider}"))


def main() -> None:
    print(f"ws handshake suite against {API}")
    asyncio.run(duel_handshake())
    asyncio.run(event_handshake())
    asyncio.run(ranked_handshake())
    print(f"\n{PASSED} passed, {FAILED} failed")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
