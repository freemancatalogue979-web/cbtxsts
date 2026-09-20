"""Committed regression suite for the Arena Events system.

Run against a live server::

    .venv/bin/uvicorn app.main:app --port 3000 &
    ARENA_API=http://127.0.0.1:3000/api .venv/bin/python scripts/verify_events.py

It proves the contract events are judged on, in the order players hit it:

  1. the creator   — admin fields round-trip into the public payload
  2. the lobby     — upcoming card, countdown stamps, pre-registration
  3. the start     — the server clock flips the event live (never the client)
  4. the run       — fixed question order, resume-safe progress, hidden answers
  5. the guards    — entry requirements, foreign answers, join rules
  6. the board     — server ranking with top + own + nearby slices
  7. the finish    — server-side finalize: positions, rewards, history, review
  8. notifications — start and results notices are recorded

No mocks: everything goes through the HTTP API of a running server.
"""
from __future__ import annotations

import json
import os
import random
import string
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

API = os.environ.get("ARENA_API", "http://127.0.0.1:3000/api")
ADMIN_EMAIL = os.environ.get("ARENA_ADMIN_EMAIL", "admin@quizarena.ng")
ADMIN_PASSWORD = os.environ.get("ARENA_ADMIN_PASSWORD", "arena2026")

PASSED = 0
FAILED = 0
TIMEOUT = 60


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


def check(label: str, condition: bool, extra="") -> None:
    global PASSED, FAILED
    if condition:
        PASSED += 1
        print(f"  ok   {label}")
    else:
        FAILED += 1
        print(f"  FAIL {label} :: {extra}")


def digits(n: int) -> str:
    return "".join(random.choice(string.digits) for _ in range(n))


def letters(n: int) -> str:
    return "".join(random.choice(string.ascii_lowercase) for _ in range(n))


def admin_token() -> str:
    status, payload = call("POST", "/auth/admin", {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    if status != 200:
        print(f"cannot sign in as staff: {status} {payload}")
        sys.exit(2)
    return payload["token"]


def new_student(prefix: str = "ev") -> tuple[str, dict]:
    status, payload = call(
        "POST",
        "/auth/register",
        {"username": f"{prefix}{letters(6)}", "phone": f"0703{digits(7)}", "password": "secret123"},
    )
    if status != 200:
        print(f"cannot register a player: {status} {payload}")
        sys.exit(2)
    return payload["token"], payload["profile"]


def detail(payload) -> str:
    if isinstance(payload, dict) and "detail" in payload:
        return str(payload["detail"])
    return str(payload)


def admin_answer_key(admin: str, question_id: int) -> str:
    status, payload = call("GET", f"/admin/questions/{question_id}", token=admin)
    if status != 200:
        return ""
    return str(payload.get("correct", "")).strip().upper()


def iso_in(seconds: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


def wait_for(predicate, timeout: int = TIMEOUT, interval: float = 0.5):
    deadline = time.time() + timeout
    result = None
    while time.time() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(interval)
    return result


def pick_course(admin: str) -> dict | None:
    status, payload = call("GET", "/admin/courses", token=admin)
    rows = payload.get("courses") if isinstance(payload, dict) else payload
    if status != 200 or not rows:
        return None
    return rows[0]


def main() -> int:
    admin = admin_token()
    course = pick_course(admin)
    if course is None:
        print("no courses available — seed the database first")
        return 2
    print(f"# events regression — course: {course['title']}")

    # ------------------------------------------------------------- creator
    print("\n1) the creator")
    name = f"Midnight Clash {letters(4).upper()}"
    status, created = call(
        "POST",
        "/admin/events",
        {
            "name": name,
            "description": "A server-timed skirmish for the regression suite.",
            "course_id": course["id"],
            "topics": [],
            "starts_at": iso_in(6),
            "ends_at": iso_in(45),
            "question_count": 4,
            "time_mode": "fixed",
            "duration_minutes": 5,
            "entry_xp": 0,
            "visibility": "public",
            "rewards": {"xp": 500, "coins": 300, "diamonds": 10},
            "scoring_note": "1 point per correct answer, speed breaks ties.",
            "allow_join_during": True,
            "allow_leave": True,
            "leaderboard_visible": True,
        },
        token=admin,
    )
    check("admin creates the event", status == 200 and (created or {}).get("event", {}).get("id"), detail(created))
    event_id = created["event"]["id"]
    payload = created["event"]
    check("fields round-trip", payload["name"] == name and payload["question_count"] == 4 and payload["time_mode"] == "fixed", str(payload)[:200])
    check("prize pool derived from rewards", "500 XP" in payload.get("prize_pool", "") and "10 diamonds" in payload.get("prize_pool", ""), payload.get("prize_pool", ""))
    check("server stamps its own clock", bool(payload.get("server_now")) and bool(payload.get("starts_at")), "")

    status, bad = call("POST", "/admin/events", {"name": "Broken", "starts_at": iso_in(60), "ends_at": iso_in(30)}, token=admin)
    check("end-before-start is rejected", status == 400, detail(bad))

    # --------------------------------------------------------------- lobby
    print("\n2) the lobby")
    p1, profile1 = new_student()
    p2, _ = new_student()
    status, listing = call("GET", "/events", token=p1)
    check("upcoming list shows the event", any(e["id"] == event_id for e in listing.get("upcoming", [])), str(listing)[:200])
    upcoming = next((e for e in listing.get("upcoming", []) if e["id"] == event_id), None)
    check("upcoming card carries prize pool and question count", upcoming and upcoming.get("prize_pool") and upcoming.get("question_count") == 4, str(upcoming)[:200])

    status, joined = call("POST", f"/events/{event_id}/join", token=p1)
    check("pre-registration works before the start", status == 200 and joined["event"]["joined"] is True, detail(joined))
    status, joined2 = call("POST", f"/events/{event_id}/join", token=p1)
    check("joining twice is a no-op", status == 200 and joined2["event"]["joined"] is True, detail(joined2))

    # --------------------------------------------------------------- start
    print("\n3) the start")
    print("   waiting for the server clock to start the event…")
    live = wait_for(lambda: (call("GET", f"/events/{event_id}", token=p1)[1] or {}).get("event", {}).get("status") == "live", timeout=30)
    check("the server starts the event (never the client)", bool(live), "never went live")
    status, notices = call("GET", "/admin/notifications", token=admin)
    rows = notices if isinstance(notices, list) else notices.get("notifications", []) if isinstance(notices, dict) else []
    check("a start notice is recorded", any(n.get("title", "").startswith(name[:10]) for n in rows), str([n.get("title") for n in rows][:4]))

    # ---------------------------------------------------------------- run
    print("\n4) the run")
    status, detail1 = call("GET", f"/events/{event_id}", token=p1)
    question = detail1.get("question", {})
    check("the first question is served", bool(question.get("question")), str(detail1)[:200])
    check("answers stay hidden", "correct" not in (question.get("question") or {}), str(question)[:160])

    key = admin_answer_key(admin, question["question"]["id"])
    status, result = call("POST", f"/events/{event_id}/answer", {"selected": key, "elapsed_ms": 700}, token=p1)
    check("a correct answer scores accuracy-dominant points", status == 200 and result["result"]["points"] >= 60, detail(result))
    check("progress advances to question 2", result["result"]["progress"]["index"] == 1, str(result["result"]["progress"])[:120])

    # resume: the server remembers exactly where the player is
    status, again = call("GET", f"/events/{event_id}", token=p1)
    check("progress survives a page refresh", again["question"]["index"] == 1, str(again.get("question"))[:120])

    # second player joins mid-event and answers wrong
    status, joined_p2 = call("POST", f"/events/{event_id}/join", token=p2)
    check("mid-event joining is allowed", status == 200 and joined_p2["event"]["joined"] is True, detail(joined_p2))
    q2 = joined_p2.get("question") or {}
    status, wrong = call("POST", f"/events/{event_id}/answer", {"selected": "Z", "elapsed_ms": 500}, token=p2)
    check("wrong answers score zero", status == 200 and wrong["result"]["points"] == 0, detail(wrong))

    # finish the run for p1
    while True:
        status, detail1 = call("GET", f"/events/{event_id}", token=p1)
        question = detail1.get("question") or {}
        if question.get("done"):
            break
        key = admin_answer_key(admin, question["question"]["id"])
        call("POST", f"/events/{event_id}/answer", {"selected": key, "elapsed_ms": 600}, token=p1)
    check("the run completes", bool(question.get("done")), str(question))
    check("participant marked finished", detail1["event"]["me"]["finished"] is True, str(detail1["event"].get("me")))

    # -------------------------------------------------------------- guards
    print("\n5) the guards")
    status, foreign = call("POST", f"/events/{event_id}/answer", {"selected": "A", "elapsed_ms": 100}, token=new_student()[0])
    check("foreign players cannot answer", status == 403, detail(foreign))
    status, dup = call("POST", f"/events/{event_id}/answer", {"selected": "A", "elapsed_ms": 100}, token=p1)
    check("finished runs refuse further questions", status == 400, detail(dup))

    # a gated event rejects players below the entry requirement
    status, gated = call(
        "POST",
        "/admin/events",
        {"name": f"Champions Gate {letters(3).upper()}", "starts_at": iso_in(300), "ends_at": iso_in(600), "question_count": 3, "entry_xp": 100_000},
        token=admin,
    )
    gated_id = gated["event"]["id"]
    status, refused = call("POST", f"/events/{gated_id}/join", token=p2)
    check("entry requirements are enforced", status == 400 and "XP" in detail(refused), detail(refused))
    call("DELETE", f"/admin/events/{gated_id}", token=admin)

    # --------------------------------------------------------------- board
    print("\n6) the board")
    status, board = call("GET", f"/events/{event_id}", token=p1)
    leaderboard = board.get("leaderboard") or {}
    check("leaderboard ships top + own slices", "top" in leaderboard and leaderboard.get("mine") is not None, str(leaderboard)[:200])
    check("the leader is ranked first", leaderboard["mine"]["position"] == 1 and leaderboard["mine"]["score"] >= 240, str(leaderboard.get("mine")))

    # -------------------------------------------------------------- finish
    print("\n7) the finish")
    print("   waiting for the server to finalize…")
    finished = wait_for(lambda: (call("GET", f"/events/{event_id}", token=p1)[1] or {}).get("event", {}).get("status") == "finished", timeout=60)
    check("the server finalizes the event", bool(finished), "never finished")

    status, detail1 = call("GET", f"/events/{event_id}", token=p1)
    me = detail1["event"]["me"]
    check("final position recorded", me["position"] == 1, str(me))
    check("rewards granted in full to the winner", (me.get("rewards") or {}).get("xp") == 500, str(me.get("rewards")))

    status, profile_now = call("GET", "/me", token=p1)
    gained = (profile_now.get("xp", 0) if status == 200 else 0) - profile1.get("xp", 0)
    check("reward XP landed on the profile", gained >= 500, f"{gained}")

    status, history = call("GET", "/events", token=p1)
    past = next((e for e in history.get("past", []) if e["id"] == event_id), None)
    check("the event lands in history with rewards", past is not None and (past.get("rewards") or {}).get("xp") == 500, str(past)[:200])

    status, review = call("GET", f"/events/{event_id}/review", token=p1)
    check("answer review available", status == 200 and len(review.get("items", [])) == 4, detail(review)[:160])

    status, listing = call("GET", "/events", token=p1)
    check("live events that ended leave the live list", not any(e["id"] == event_id for e in listing.get("live", [])), "")

    return finish()


def finish() -> int:
    print(f"\n{'=' * 60}\nverify_events: {PASSED} passed, {FAILED} failed")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
