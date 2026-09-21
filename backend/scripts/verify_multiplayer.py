"""Committed regression suite for the GLOBAL multiplayer question rule.

Run against a live server::

    .venv/bin/uvicorn app.main:app --port 3000 &
    ARENA_API=http://127.0.0.1:3000/api .venv/bin/python scripts/verify_multiplayer.py

The rule: in any competitive activity with 2+ players, every player gets
their OWN server-dealt question set — random, no repeats inside a set, the
same difficulty shape across players, no overlap between players while the
bank allows it, and an explicit "Not enough unique questions are available
for this match." instead of silent reuse. Nobody ever sees a rival's set.

Proven here for every multiplayer engine: duels, ranked matches, quiz-night
rooms, group quizzes and arena events. Single-player selection is covered by
the practice suite and is deliberately untouched by this rule.
"""
from __future__ import annotations

import json
import os
import random
import sqlite3
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


def new_student(prefix: str = "mp") -> tuple[str, dict]:
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
    return str(payload.get("correct", "")).strip().upper() if status == 200 else ""


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


# ------------------------------------------------------------- db introspection
def _db_path() -> str:
    from app.config import DATABASE_URL

    return DATABASE_URL.replace("sqlite:///", "")


def assigned_sets(table: str, key_column: str, key_value: int) -> dict[int, list[int]]:
    """Per-player stored question sets, read straight from the server's db."""
    with sqlite3.connect(f"file:{_db_path()}?mode=ro", uri=True) as con:
        rows = con.execute(
            f"SELECT student_id, question_ids FROM {table} WHERE {key_column} = ?", (key_value,)
        ).fetchall()
    return {int(sid): json.loads(raw or "null") or [] for sid, raw in rows}


def make_small_quiz(admin: str, course_id: int, easy: int, medium: int, title: str) -> int:
    status, quiz = call(
        "POST",
        "/admin/quizzes",
        {"title": title, "course_id": course_id, "duration_minutes": 5, "status": "draft"},
        token=admin,
    )
    if status != 200:
        raise SystemExit(f"cannot create quiz: {detail(quiz)}")
    questions = []
    for index in range(easy):
        questions.append(
            {
                "text": f"{title} easy {index}?",
                "option_a": "Yes",
                "option_b": "No",
                "correct": "A",
                "difficulty": "easy",
            }
        )
    for index in range(medium):
        questions.append(
            {
                "text": f"{title} medium {index}?",
                "option_a": "Blue",
                "option_b": "Red",
                "correct": "B",
                "difficulty": "medium",
            }
        )
    status, bulk = call(
        "POST", f"/admin/quizzes/{quiz['id']}/questions/bulk", {"questions": questions}, token=admin
    )
    if status != 200:
        raise SystemExit(f"cannot seed questions: {detail(bulk)}")
    status, _ = call("PATCH", f"/admin/quizzes/{quiz['id']}/status", {"status": "active"}, token=admin)
    if status != 200:
        raise SystemExit("cannot activate quiz")
    return int(quiz["id"])


def main() -> int:
    admin = admin_token()
    course = pick_course(admin)
    if course is None:
        print("no courses available — seed the database first")
        return 2
    course_id = course["id"]
    print(f"# multiplayer question rule — course: {course['title']}")

    tok_a, prof_a = new_student("mpa")
    tok_b, prof_b = new_student("mpb")

    # ------------------------------------------------------------- 1. duels
    print("\n1) duels — own sets, no overlap, no leaks")
    status, duel = call(
        "POST",
        "/duels",
        {"opponent_phone": prof_b["phone"], "question_count": 5, "stake_coins": 0, "topic": "Rule Check"},
        token=tok_a,
    )
    check("challenge created", status == 200 and duel.get("status") == "invited", detail(duel))
    duel_id = duel["id"]
    status, accepted = call("POST", f"/duels/{duel_id}/accept", token=tok_b)
    check("accept starts the duel", status == 200 and accepted.get("status") == "live", detail(accepted))
    set_b = [q["id"] for q in accepted.get("questions", [])]
    status, mine = call("GET", f"/duels/{duel_id}", token=tok_a)
    set_a = [q["id"] for q in (mine or {}).get("questions", [])]
    check("each player was dealt a full set", len(set_a) == 5 and len(set_b) == 5, f"{len(set_a)}/{len(set_b)}")
    check("sets are disjoint (anti-overlap)", not (set(set_a) & set(set_b)), str(set(set_a) & set(set_b)))
    check("no duplicates inside a set", len(set(set_a)) == len(set_a) and len(set(set_b)) == len(set_b))
    status, cross = call(
        "POST", f"/duels/{duel_id}/answer", {"question_id": set_b[0], "selected": "A", "elapsed_ms": 900}, token=tok_a
    )
    check("a rival's question is not answerable", status == 400, detail(cross))
    for index, qid in enumerate(set_a):
        key = admin_answer_key(admin, qid)
        status, _ = call(
            "POST",
            f"/duels/{duel_id}/answer",
            {"question_id": qid, "selected": key or "A", "elapsed_ms": 900 + index * 100},
            token=tok_a,
        )
        if status != 200:
            break
    check("player A graded against their own set", status == 200, str(status))
    for index, qid in enumerate(set_b):
        key = admin_answer_key(admin, qid)
        call(
            "POST",
            f"/duels/{duel_id}/answer",
            {"question_id": qid, "selected": key or "B", "elapsed_ms": 1500 + index * 100},
            token=tok_b,
        )
    status, final = call("GET", f"/duels/{duel_id}", token=tok_a)
    check("duel finished after both completed", status == 200 and final.get("status") == "finished", detail(final))
    revealed = [q["id"] for q in (final or {}).get("questions", [])]
    check("the reveal contains ONLY my own set", revealed == set_a, str(set(revealed) ^ set(set_a)))
    check("the reveal carries my answer key", all("correct" in q for q in (final or {}).get("questions", [])), "")
    status, final_b = call("GET", f"/duels/{duel_id}", token=tok_b)
    revealed_b = [q["id"] for q in (final_b or {}).get("questions", [])]
    check("the rival's reveal contains only THEIR set", revealed_b == set_b, str(set(revealed_b) ^ set(set_b)))

    # ------------------------------------------------- 2. the bank guard
    print("\n2) small banks — explicit error, never silent reuse")
    tiny_quiz = make_small_quiz(admin, course_id, 3, 2, f"Tiny Bank {letters(3).upper()}")
    status, blocked = call(
        "POST",
        "/duels",
        {"opponent_phone": prof_b["phone"], "quiz_id": tiny_quiz, "question_count": 3, "stake_coins": 0},
        token=tok_a,
    )
    message = detail(blocked)
    check("5 questions cannot cover 2×3 players uniquely", status == 400, str(status))
    check(
        "the error is the promised sentence",
        "Not enough unique questions are available for this match." in message,
        message,
    )
    shaped_quiz = make_small_quiz(admin, course_id, 4, 3, f"Shaped Bank {letters(3).upper()}")
    status, shaped = call(
        "POST",
        "/duels",
        {"opponent_phone": prof_b["phone"], "quiz_id": shaped_quiz, "question_count": 3, "stake_coins": 0},
        token=tok_a,
    )
    check("7 questions do cover 2×3 uniquely", status == 200, detail(shaped))
    status, shaped_live = call("POST", f"/duels/{shaped['id']}/accept", token=tok_b)
    shaped_b = [q["id"] for q in (shaped_live or {}).get("questions", [])]
    status, shaped_mine = call("GET", f"/duels/{shaped['id']}", token=tok_a)
    shaped_a = [q["id"] for q in (shaped_mine or {}).get("questions", [])]
    check("the small-bank sets are still disjoint", not (set(shaped_a) & set(shaped_b)), str(shaped_a) + str(shaped_b))
    easy_a = sum(1 for qid in shaped_a if _difficulty(admin, qid) == "easy")
    easy_b = sum(1 for qid in shaped_b if _difficulty(admin, qid) == "easy")
    check("both sets share one difficulty shape", len(shaped_a) == len(shaped_b) == 3 and easy_a == easy_b, f"{easy_a} vs {easy_b}")

    # ------------------------------------------------------------- 3. ranked
    print("\n3) ranked — own sets per matchmade player")
    tok_r1, _ = new_student("mpr")
    tok_r2, _ = new_student("mpr")
    call("POST", "/ranked/queue", {"course_id": course_id}, token=tok_r1)
    call("POST", "/ranked/queue", {"course_id": course_id}, token=tok_r2)
    match_id = wait_for(lambda: (call("GET", "/ranked/status", token=tok_r1)[1] or {}).get("match_id"), timeout=45)
    check("the queue minted a match", bool(match_id), "no match_id")
    live = wait_for(
        lambda: (call("GET", f"/ranked/match/{match_id}", token=tok_r1)[1] or {}).get("match", {}).get("question"),
        timeout=45,
    )
    check("round 1 opened", bool(live), "no question window")
    status, m1 = call("GET", f"/ranked/match/{match_id}", token=tok_r1)
    status, m2 = call("GET", f"/ranked/match/{match_id}", token=tok_r2)
    q1 = ((m1 or {}).get("match") or {}).get("question") or {}
    q2 = ((m2 or {}).get("match") or {}).get("question") or {}
    check("both players see a round-1 question", bool(q1.get("id")) and bool(q2.get("id")), f"{q1.get('id')}/{q2.get('id')}")
    check("ranked round questions differ per player", q1.get("id") != q2.get("id"), str(q1.get("id")))
    sets = assigned_sets("ranked_participants", "match_id", int(match_id))
    check("ranked sets were stored per participant", len(sets) >= 2 and all(sets.values()), str({k: len(v) for k, v in sets.items()}))
    flat = [qid for row in sets.values() for qid in row]
    check("ranked sets are pairwise disjoint", len(flat) == len(set(flat)), str(len(flat) - len(set(flat))))
    check("ranked sets share one length", len({len(v) for v in sets.values()}) == 1, str({len(v) for v in sets.values()}))
    key_r = admin_answer_key(admin, int(q1.get("id")))
    status, graded_r = call("POST", f"/ranked/match/{match_id}/answer", {"selected": key_r or "A", "elapsed_ms": 900}, token=tok_r1)
    check("own round answer accepted", status == 200, detail(graded_r))

    # -------------------------------------------------------------- 4. rooms
    print("\n4) quiz-night rooms — own sets per member")
    tok_h, prof_h = new_student("mph")
    tok_g, _ = new_student("mpg")
    status, room = call(
        "POST", "/rooms", {"title": "Rule Night", "course_id": course_id, "question_count": 4, "per_question_seconds": 30}, token=tok_h
    )
    check("host created the room", status == 200, detail(room))
    room_id = room["room"]["id"]
    status, _ = call("POST", f"/rooms/join/{room['room']['code']}", token=tok_g)
    check("guest joined by code", status == 200, str(status))
    status, started = call("POST", f"/rooms/{room_id}/start", token=tok_h)
    host_q = ((started or {}).get("question") or {}).get("question") or {}
    check("start dealt the host their own question", status == 200 and bool(host_q.get("id")), detail(started))
    room_sets = assigned_sets("room_members", "room_id", int(room_id))
    check("room sets stored per member", len(room_sets) == 2 and all(len(v) == 4 for v in room_sets.values()), str({k: len(v) for k, v in room_sets.items()}))
    flat = [qid for row in room_sets.values() for qid in row]
    check("room sets are pairwise disjoint", len(flat) == len(set(flat)), "")
    check("the host's REST question is from the host's set", host_q.get("id") in room_sets.get(prof_h["id"], []), str(host_q.get("id")))
    check("room state reports per-player totals", started["room"]["questions_total"] == 4, str(started["room"].get("questions_total")))
    status, graded_room = call("POST", f"/rooms/{room_id}/answer", {"selected": "A", "elapsed_ms": 800}, token=tok_g)
    check("guest answers their own deal", status == 200, detail(graded_room))

    # -------------------------------------------------------- 5. group quizzes
    print("\n5) group quizzes — own sets per member attempt")
    status, group = call("POST", "/groups", {"name": f"Rule Squad {letters(3).upper()}", "goal": "Prove the rule"}, token=tok_a)
    check("group created", status == 200 and group.get("code"), detail(group))
    gid = group["id"]
    code = group["code"]
    status, _ = call("POST", f"/groups/join/{code}", token=tok_b)
    check("second member joined", status == 200, str(status))
    status, quiz = call(
        "POST", f"/groups/{gid}/quizzes", {"title": "Rule Quiz", "question_count": 5}, token=tok_a
    )
    check("quiz published (live immediately)", status == 200 and quiz.get("status") == "live", detail(quiz))
    qid = quiz["id"]
    status, join_a = call("POST", f"/groups/{gid}/quizzes/{qid}/join", token=tok_a)
    check("member A joined the quiz", status == 200, detail(join_a))
    status, join_b = call("POST", f"/groups/{gid}/quizzes/{qid}/join", token=tok_b)
    check("member B joined the quiz", status == 200, detail(join_b))
    win_a = [(call("GET", f"/groups/{gid}/quizzes/{qid}/question/{i}", token=tok_a)[1] or {}).get("question", {}).get("id") for i in range(5)]
    win_b = [(call("GET", f"/groups/{gid}/quizzes/{qid}/question/{i}", token=tok_b)[1] or {}).get("question", {}).get("id") for i in range(5)]
    check("both windows served 5 questions", all(win_a) and all(win_b), f"{win_a} / {win_b}")
    check("group quiz sets are disjoint", not (set(win_a) & set(win_b)), str(set(win_a) & set(win_b)))
    check("group windows have no repeats", len(set(win_a)) == 5 and len(set(win_b)) == 5, "")
    status, cross_g = call(
        "POST", f"/groups/{gid}/quizzes/{qid}/answer", {"question_id": win_b[0], "selected": "A", "elapsed_ms": 700}, token=tok_a
    )
    check("a rival's group question is not answerable", status == 404, str(status))

    # -------------------------------------------------------------- 6. events
    print("\n6) arena events — own sets per participant")
    name = f"Rule Clash {letters(4).upper()}"
    status, created = call(
        "POST",
        "/admin/events",
        {
            "name": name,
            "description": "Proves the per-player question rule end to end.",
            "course_id": course_id,
            "topics": [],
            "starts_at": iso_in(8),
            "ends_at": iso_in(900),
            "question_count": 4,
            "time_mode": "fixed",
            "duration_minutes": 10,
            "entry_xp": 0,
            "visibility": "public",
            "rewards": {"xp": 100, "coins": 50, "diamonds": 0},
            "scoring_note": "Accuracy first.",
            "allow_join_during": True,
            "allow_leave": True,
            "leaderboard_visible": True,
        },
        token=admin,
    )
    check("admin created the event", status == 200, detail(created))
    event_id = created["event"]["id"]
    call("POST", f"/events/{event_id}/join", token=tok_a)
    live = wait_for(
        lambda: (call("GET", f"/events/{event_id}", token=tok_a)[1] or {}).get("event", {}).get("status") == "live",
        timeout=40,
    )
    check("the event went live", bool(live), "never live")
    status, win_ev_a = call("GET", f"/events/{event_id}", token=tok_a)
    first_a = ((win_ev_a or {}).get("question") or {}).get("question", {}).get("id")
    call("POST", f"/events/{event_id}/join", token=tok_b)
    status, win_ev_b = call("GET", f"/events/{event_id}", token=tok_b)
    first_b = ((win_ev_b or {}).get("question") or {}).get("question", {}).get("id")
    check("both participants were served a first question", bool(first_a) and bool(first_b), f"{first_a}/{first_b}")
    check("event first questions differ", first_a != first_b, str(first_a))
    ev_sets = assigned_sets("event_participants", "event_id", int(event_id))
    check("event sets stored per participant", len(ev_sets) == 2 and all(len(v) == 4 for v in ev_sets.values()), str({k: len(v) for k, v in ev_sets.items()}))
    flat = [qid for row in ev_sets.values() for qid in row]
    check("event sets are pairwise disjoint", len(flat) == len(set(flat)), "")
    key = admin_answer_key(admin, first_a)
    status, graded = call("POST", f"/events/{event_id}/answer", {"selected": key, "elapsed_ms": 900}, token=tok_a)
    check("event answers grade against the participant's own set", status == 200, detail(graded))

    # --------------------------------------------------------------- summary
    print("\n" + "=" * 60)
    print(f"verify_multiplayer: {PASSED} passed, {FAILED} failed")
    return 1 if FAILED else 0


def _difficulty(admin: str, question_id: int) -> str:
    status, payload = call("GET", f"/admin/questions/{question_id}", token=admin)
    return str(payload.get("difficulty", "")) if status == 200 else ""


if __name__ == "__main__":
    sys.exit(main())
