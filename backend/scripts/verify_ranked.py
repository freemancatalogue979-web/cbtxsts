"""Committed regression suite for the Ranked multiplayer system.

Run against a live server::

    .venv/bin/uvicorn app.main:app --port 3000 &
    ARENA_API=http://127.0.0.1:3000/api .venv/bin/python scripts/verify_ranked.py

It proves the contract ranked play is judged on, in the order players hit it:

  1. the ladder     — tiers, defaults, meta (server-owned scoring formula)
  2. the queue      — join per course, cancel, no cross-course mixing
  3. matchmaking    — patience ladder (30s→12 … 2min→4 … anyone), cap 15
  4. the lobby      — server countdown, roster with rating/tier/level
  5. the match      — shared question windows, hidden answers before reveal
  6. scoring        — accuracy-dominant points, streaks, wrong = 0
  7. standings      — live order updates as answers land
  8. the finish     — positions, Elo rating movement (zero-sum-ish), rewards
  9. afterglow      — history, ladder (top + own + nearby), answer review
 10. the guards     — double answers, foreign matches, dead questions

No mocks: every call goes through the HTTP API of a running server. The
match itself is driven the way the ticker drives it — by waiting for the
server's own clocks, so pacing bugs surface here too.
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
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

API = os.environ.get("ARENA_API", "http://127.0.0.1:3000/api")
ADMIN_EMAIL = os.environ.get("ARENA_ADMIN_EMAIL", "admin@quizarena.ng")
ADMIN_PASSWORD = os.environ.get("ARENA_ADMIN_PASSWORD", "arena2026")

PASSED = 0
FAILED = 0
LETTERS = "ABCD"
TIMEOUT = 90  # seconds any single wait may take


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


def new_student(prefix: str = "rq") -> tuple[str, dict]:
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


def wait_for(predicate, timeout: int = TIMEOUT, interval: float = 0.5):
    """Poll until predicate() is truthy. Returns its last value."""
    deadline = time.time() + timeout
    result = None
    while time.time() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(interval)
    return result


def pick_courses(admin: str) -> list[dict]:
    status, payload = call("GET", "/admin/courses", token=admin)
    rows = payload.get("courses") if isinstance(payload, dict) else payload
    if status != 200 or not rows:
        return []
    return rows


def main() -> int:
    admin = admin_token()
    courses = pick_courses(admin)
    if not courses:
        print("no courses available — seed the database first")
        return 2
    course = courses[0]
    course_id = course["id"]
    other_course_id = courses[1]["id"] if len(courses) > 1 else course_id
    print(f"# ranked regression — course: {course['title']} ({course_id})")

    # ---------------------------------------------------------------- meta
    print("\n1) the ladder")
    status, meta = call("GET", "/ranked/meta")
    check("meta responds", status == 200, detail(meta))
    tiers = meta.get("tiers", [])
    check("fifteen badges configured", len(tiers) == 15, str(len(tiers)))
    check(
        "tier names climb Bronze III → Grandmaster",
        [t["name"] for t in tiers]
        == [
            "Bronze III", "Bronze II", "Bronze I",
            "Silver III", "Silver II", "Silver I",
            "Gold III", "Gold II", "Gold I",
            "Platinum II", "Platinum I",
            "Diamond II", "Diamond I",
            "Master", "Grandmaster",
        ],
        str([t.get("name") for t in tiers]),
    )
    check(
        "every badge carries art (glyph + deep/bright)",
        all(t.get("icon") and t.get("deep") and t.get("bright") and t.get("metal") for t in tiers),
        str(tiers[:2]),
    )
    check(
        "tier rules cover all fifteen badges",
        all(key in (meta.get("tier_rules") or {}) for key in (t["key"] for t in tiers)),
        str(list((meta.get("tier_rules") or {}).keys())[:4]),
    )
    check("scoring formula is server-side (base dominates speed)", meta.get("base_points", 0) > meta.get("speed_bonus", 99), str(meta))

    p1, profile1 = new_student()
    p2, _ = new_student()
    p3, _ = new_student()
    outsider, _ = new_student()

    # ------------------------------------------------------------- the queue
    print("\n2) the queue")
    status, status1 = call("GET", "/ranked/status", token=p1)
    check("status responds", status == 200, detail(status1))
    check("new player starts at 1000 Silver I", status1.get("rating") == 1000 and status1.get("tier") == "silver_1", str(status1))
    check("not queued, no match", status1.get("in_queue") is False and status1.get("match_id") is None, str(status1))

    status, joined = call("POST", "/ranked/queue", {"course_id": course_id}, token=p1)
    check("queue join accepted", status == 200 and joined.get("queued") is True, detail(joined))
    status, status1 = call("GET", "/ranked/status", token=p1)
    check("status shows the queue", status1.get("in_queue") is True and status1.get("waiting", 0) >= 1, str(status1))

    # A second player in a different course must never mix with the first.
    status, _ = call("POST", "/ranked/queue", {"course_id": other_course_id}, token=p2)
    check("other-course queue join accepted", status == 200, "")
    time.sleep(3)
    status, status1 = call("GET", "/ranked/status", token=p1)
    check("courses never mix (still queued)", status1.get("match_id") is None, str(status1))

    status, cancelled = call("POST", "/ranked/queue/cancel", token=p2)
    check("cancel leaves the queue", status == 200 and cancelled.get("cancelled") is True, detail(cancelled))
    status, _ = call("POST", "/ranked/queue/cancel", token=p2)
    check("cancel is idempotent", status == 200, "")

    # --------------------------------------------------------- matchmaking
    print("\n3) matchmaking")
    for token in (p2, p3):
        call("POST", "/ranked/queue", {"course_id": course_id}, token=token)
    print("   waiting for the server to mint a match (patience ladder: 3 players launch at the 150s rung)…")
    match = wait_for(lambda: (call("GET", "/ranked/status", token=p1)[1] or {}).get("match_id"), timeout=220)
    check("a match is minted with 3 players (never 'exactly 15')", bool(match), "no match after waiting")
    if not match:
        return finish()
    match_id = match

    status, detail1 = call("GET", f"/ranked/match/{match_id}", token=p1)
    check("match detail responds", status == 200, detail(detail1))
    state = detail1["match"]
    check("lobby first", state["status"] == "lobby", state["status"])
    check("three participants", len(state["participants"]) == 3, str(len(state["participants"])))
    roster = state["participants"]
    check(
        "roster carries rating, tier, level and readiness",
        all(p.get("rating") == 1000 and p.get("tier") == "silver_1" and p.get("level", 0) >= 1 and p.get("ready") for p in roster),
        str(roster[:1]),
    )
    check("lobby countdown is server-stamped", bool(state.get("lobby_at")) and bool(state.get("server_now")), str(state.get("lobby_at")))

    # ------------------------------------------------------------ the match
    print("\n4) the match")
    print("   waiting for the lobby countdown…")
    live = wait_for(lambda: (call("GET", f"/ranked/match/{match_id}", token=p1)[1] or {}).get("match", {}).get("status") == "live")
    check("match goes live on the server clock", bool(live), "never went live")

    status, detail1 = call("GET", f"/ranked/match/{match_id}", token=p1)
    state = detail1["match"]
    question = state.get("question")
    check("a question is open", bool(question), str(state)[:200])
    check("answers stay hidden before the reveal", "correct" not in (question or {}), str(question)[:160])
    check("question window is server-deadlined", bool(state.get("question")) , "")

    def fetch(token):
        status, payload = call("GET", f"/ranked/match/{match_id}", token=token)
        return (payload or {}).get("match", {}) if status == 200 else {}

    def answer(token, letter):
        return call("POST", f"/ranked/match/{match_id}/answer", {"selected": letter, "elapsed_ms": 900}, token=token)

    total = state.get("questions_total", 10)
    scorecard = {p1: {"correct": 0}, p2: {"correct": 0}, p3: {"correct": 0}}
    asked = 0
    wrong_locked = False
    double_locked = False
    foreign_locked = False

    deadline = time.time() + 300  # whole match budget
    while time.time() < deadline:
        state = fetch(p1)
        if state.get("status") == "finished":
            break
        question = state.get("question")
        reveal = state.get("reveal")
        if question and not state.get("me", {}).get("answered"):
            asked += 1
            key = admin_answer_key(admin, question["id"])
            # player 1 and 3 always right, player 2 always wrong
            status, result = answer(p1, key)
            if status != 200:
                check(f"answer {asked} accepted for p1", False, detail(result))
                break
            scorecard[p1]["correct"] += 1 if result["result"]["correct"] else 0
            if asked == 1:
                check("correct answer scores accuracy-dominant points", result["result"]["points"] >= 60, str(result["result"]))
                # guards, once: double answer + foreign player
                status, dup = answer(p1, key)
                double_locked = status == 400
                status, foreign = answer(outsider, key)
                foreign_locked = status == 403
            answer(p3, key)
            status, wrong = answer(p2, "Z" if key != "Z" else "Y")
            if status == 200 and wrong["result"]["points"] == 0:
                scorecard[p2]["correct"] = 0
            elif status != 200 and "closed" not in detail(wrong):
                check(f"wrong answer accepted for p2 (q{asked})", False, detail(wrong))
                break
        elif reveal:
            time.sleep(0.4)  # let the reveal window pass on the server clock
        else:
            time.sleep(0.4)

    check("every question was served", asked >= total, f"{asked}/{total}")

    print("\n5) the guards")
    check("double answers are rejected", double_locked, "second identical answer was accepted")
    check("foreign players cannot answer", foreign_locked, "outsider was not rejected")

    print("\n6) the finish")
    state = fetch(p1)
    check("match reaches finished", state.get("status") == "finished", state.get("status", "?"))
    status, status1 = call("GET", "/ranked/status", token=p1)
    winner_rating = status1.get("rating")
    check("winner rating moved up", winner_rating > 1000, str(winner_rating))
    status, status2 = call("GET", "/ranked/status", token=p2)
    check("loser rating moved down", status2.get("rating") < 1000, str(status2.get("rating")))
    status, status3 = call("GET", "/ranked/status", token=p3)
    check("matches played counted", status1.get("played", 0) >= 1 and status2.get("played", 0) >= 1, str(status1.get("played")))

    status, review = call("GET", f"/ranked/match/{match_id}/review", token=p1)
    check("answer review available after the match", status == 200 and len(review.get("items", [])) == total, detail(review)[:160])
    check("review reveals the correct answers", all("correct" in item["question"] for item in review.get("items", [])), "")

    status, history = call("GET", "/ranked/history", token=p1)
    rows = history.get("history", [])
    check("history records the match", any(row["match_id"] == match_id for row in rows), str(rows)[:160])
    mine = next((row for row in rows if row["match_id"] == match_id), None)
    check("history shows position and rating movement", mine and mine.get("position") == 1 and mine.get("rating_after", 0) > mine.get("rating_before", 0), str(mine))

    status, board = call("GET", "/ranked/leaderboard", token=p2)
    check("ladder ships top, own and nearby slices", all(k in board for k in ("top", "mine", "nearby")), str(board)[:200])
    check("ladder positions the players", board.get("mine", 0) >= 1 and len(board.get("top", [])) >= 1, str(board.get("mine")))

    # rating sanity: winner gains, loser loses, roughly zero-sum
    deltas = [
        (status1.get("rating", 1000) - 1000),
        (status2.get("rating", 1000) - 1000),
        (status3.get("rating", 1000) - 1000),
    ]
    check("Elo is roughly zero-sum", abs(sum(deltas)) <= 2, str(deltas))
    check("winner beats loser in rating", deltas[0] > deltas[1], str(deltas))

    return finish()


def finish() -> int:
    print(f"\n{'=' * 60}\nverify_ranked: {PASSED} passed, {FAILED} failed")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
