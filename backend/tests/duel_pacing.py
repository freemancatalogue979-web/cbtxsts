"""Duel rework suite: public/private visibility, shared waiting room,
server-paced 20-second questions, waiting-room chat and the question cap.

Runs against a live server (defaults to http://127.0.0.1:3000)::

    backend/.venv/bin/python backend/tests/duel_pacing.py
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

import websockets

API = os.environ.get("ARENA_API", "http://127.0.0.1:3000/api")
ROOT = API[: -len("/api")] if API.endswith("/api") else API
WS_BASE = ROOT.replace("http://", "ws://").rstrip("/")

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


async def recv_event(ws, event: str, timeout: float = 8.0) -> dict | None:
    deadline = time.monotonic() + timeout
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return None
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
        except asyncio.TimeoutError:
            return None
        message = json.loads(raw)
        if message.get("event") == event:
            return message


async def collect(ws, events: set[str], timeout: float = 8.0) -> dict[str, list]:
    """Gather every event of interest until the timeout lapses."""
    found: dict[str, list] = {}
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        remaining = deadline - time.monotonic()
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
        except asyncio.TimeoutError:
            break
        message = json.loads(raw)
        name = message.get("event")
        if name in events:
            found.setdefault(name, []).append(message.get("data"))
    return found


def answer_question(token: str, duel_id: int, question_id: int, selected: str = "A", elapsed_ms: int = 0):
    return call(
        "POST",
        f"/duels/{duel_id}/answer",
        {"question_id": question_id, "selected": selected, "elapsed_ms": elapsed_ms},
        token=token,
    )


async def main() -> None:
    token_a, profile_a = new_student("duelpub")
    token_b, profile_b = new_student("duelguest")
    token_c, _ = new_student("duelstranger")

    # ------------------------------------------------ public vs private list
    print("\npublic vs private duels")
    status, pub = call("POST", "/duels/open", {"question_count": 5, "stake_coins": 0}, token=token_a)
    check("public duel created", status == 200 and pub.get("id"), f"{status} {pub}")
    check("public duel flagged public", pub.get("visibility") == "public", pub.get("visibility"))
    check("public duel clock is 20s/question", pub.get("time_limit_seconds") == 20, pub.get("time_limit_seconds"))

    status, priv = call(
        "POST",
        "/duels",
        {"opponent_id": profile_b["id"], "question_count": 5, "stake_coins": 0},
        token=token_a,
    )
    check("private duel created", status == 200 and priv.get("id"), f"{status} {priv}")
    check("private duel flagged private", priv.get("visibility") == "private", priv.get("visibility"))

    status, listing = call("GET", "/duels/open", token=token_c)
    open_ids = [row["id"] for row in (listing or [])]
    check("public duel is listed", pub["id"] in open_ids, open_ids)
    check("private duel is NOT listed", priv["id"] not in open_ids, open_ids)

    status, mine = call("GET", "/duels", token=token_a)
    open_section = [row["id"] for row in (mine or {}).get("open", [])]
    check("my_duels carries the open arena", pub["id"] in open_section, open_section)

    status, view = call("GET", f"/duels/{pub['id']}", token=token_c)
    check(
        "stranger can inspect a public waiting duel",
        status == 200 and view.get("is_yours") is False and view.get("questions") is None,
        f"{status} {sorted(view) if isinstance(view, dict) else view}",
    )
    status, blocked = call("GET", f"/duels/{priv['id']}", token=token_c)
    check("stranger is still blocked from private duels", status == 403, f"{status} {blocked}")

    # ------------------------------------------------ waiting room chat
    print("\nwaiting-room chat")
    ws_a = await websockets.connect(f"{WS_BASE}/ws/duel/{pub['id']}?token={token_a}")
    state = await recv_event(ws_a, "duel_state")
    check("host receives duel_state immediately", state is not None)
    await ws_a.send(json.dumps({"type": "chat", "body": "gl hf before we start"}))

    status, joined = call("POST", f"/duels/{pub['id']}/join", {}, token=token_b)
    check("guest joins the public duel by id", status == 200 and joined.get("status") == "starting", f"{status} {joined}")
    check("countdown deadline is served", bool(joined.get("round_deadline")), joined.get("round_deadline"))

    ws_b = await websockets.connect(f"{WS_BASE}/ws/duel/{pub['id']}?token={token_b}")
    state_b = await recv_event(ws_b, "duel_state")
    check("guest receives duel_state too", state_b is not None)
    # Global multiplayer rule: per-player deals. Before the sets are dealt the
    # waiting creator sees NOTHING (the union would leak the rival's future
    # questions); after the start each fighter fetches their own five.
    pre_questions = (state or {}).get("data", {}).get("questions") or []
    check("the waiting room leaks no questions before the deal", len(pre_questions) == 0, pre_questions)

    await ws_b.send(json.dumps({"type": "chat", "body": "ready when you are"}))
    # The room broadcast also echoes a sender's own lines, so scan past A's
    # earlier message for the guest's actual words. The countdown may fire
    # mid-scan, so keep any duel_question that flies past.
    chat_seen = None
    q1 = None
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline and (chat_seen is None or q1 is None):
        remaining = max(0.2, deadline - time.monotonic())
        try:
            raw = await asyncio.wait_for(ws_a.recv(), timeout=remaining)
        except asyncio.TimeoutError:
            break
        event = json.loads(raw)
        if event.get("event") == "duel_chat" and chat_seen is None and "ready when you are" in raw:
            chat_seen = event
        elif event.get("event") == "duel_question" and q1 is None:
            q1 = event
    check("waiting-room chat reaches the other player", chat_seen is not None, chat_seen)
    check("chat is scoped (carries duel id)", bool(chat_seen) and chat_seen.get("data", {}).get("duel_id") == pub["id"], chat_seen)

    # ------------------------------------------------ countdown -> question 1
    print("\nserver-paced rounds")
    if q1 is None:
        q1 = await recv_event(ws_a, "duel_question", timeout=10)
    check("server starts question 1 after the countdown", q1 is not None and q1.get("data", {}).get("index") == 0, q1)
    q1_b = await recv_event(ws_b, "duel_question", timeout=6)
    check(
        "both players get the same round event (pacing only, no question id)",
        bool(q1_b)
        and q1_b.get("data", {}).get("index") == q1.get("data", {}).get("index")
        and "question_id" not in q1_b.get("data", {})
        and "question_id" not in q1.get("data", {}),
        f"{q1} {q1_b}",
    )

    status, live = call("GET", f"/duels/{pub['id']}", token=token_a)
    check("duel is live with round cursor 0", status == 200 and live.get("status") == "live" and live.get("round_index") == 0, live.get("status"))

    status_b, live_b = call("GET", f"/duels/{pub['id']}", token=token_b)
    questions_a = [q["id"] for q in (live or {}).get("questions", [])]
    questions_b = [q["id"] for q in (live_b or {}).get("questions", [])]
    check(
        "each player holds their OWN server-dealt set (five apiece, disjoint)",
        status_b == 200 and len(questions_a) == 5 and len(questions_b) == 5 and not (set(questions_a) & set(questions_b)),
        f"{questions_a} {questions_b}",
    )

    # chat must be locked once the duel started
    await ws_a.send(json.dumps({"type": "chat", "body": "this must not arrive"}))
    leaked = await recv_event(ws_b, "duel_chat", timeout=2.5)
    check("waiting-room chat is disabled after the start", leaked is None, leaked)

    first_question_id = questions_a[0] if questions_a else None

    # ------------------------------------------------ server timing authority
    status, graded = answer_question(token_a, pub["id"], first_question_id, "A", elapsed_ms=9_999_999)
    check("answer accepted for the current question", status == 200, f"{status} {graded}")
    mine_row = next((row for row in (graded or {}).get("my_answers", []) if row["question_id"] == first_question_id), None)
    check(
        "elapsed time is server-measured (client value ignored)",
        bool(mine_row) and 0 <= mine_row.get("elapsed_ms", -1) <= 20_000,
        mine_row,
    )
    status, early = answer_question(token_a, pub["id"], questions_a[2], "A")
    check("future questions reject answers", status == 400, f"{status} {early}")
    status, twice = answer_question(token_a, pub["id"], first_question_id, "B")
    check("a second answer for the same question is rejected", status == 400, f"{status} {twice}")

    # ------------------------------------------------ round timeout (no answer)
    print("\nper-question timeout (waiting ~20s for the server clock)")
    progressed = await collect(ws_a, {"duel_question"}, timeout=26)
    rounds = progressed.get("duel_question", [])
    check(
        "server auto-advanced past the unanswered question",
        any(row.get("index") == 1 for row in rounds),
        rounds,
    )

    status, stale = answer_question(token_a, pub["id"], first_question_id, "C")
    check("old rounds stay closed (no client re-open)", status == 400, f"{status} {stale}")

    await ws_a.close()
    await ws_b.close()

    # ------------------------------------------------ question count rules
    print("\nquestion count limits")
    status, huge = call("POST", "/duels/open", {"question_count": 101, "stake_coins": 0}, token=token_a)
    check("101 questions rejected by the schema", status == 422, f"{status} {huge}")
    status, short = call("POST", "/duels/open", {"question_count": 100, "stake_coins": 0}, token=token_a)
    check(
        "asking for more than the bank holds fails loudly",
        status == 400 and "Not enough unique questions" in str(short),
        f"{status} {short}",
    )
    status, capped = call("POST", "/duels/open", {"question_count": 4, "stake_coins": 0}, token=token_a)
    check("a valid custom count is honoured exactly", status == 200 and capped.get("question_count") == 4, f"{status} {capped}")

    # ------------------------------------------------ decline path unchanged
    print("\nexisting invite flow")
    status, _ = call("POST", f"/duels/{priv['id']}/decline", {}, token=token_b)
    check("private invite can still be declined", status == 200, status)

    print(f"\n{PASSED} passed, {FAILED} failed")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    asyncio.run(main())
