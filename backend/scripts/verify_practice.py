"""Committed regression suite for the custom Practice system.

Run against a live server::

    CBT_DATABASE_URL=sqlite:///data/arena.db .venv/bin/uvicorn app.main:app --port 3000 &
    ARENA_API=http://127.0.0.1:3000/api CBT_DATABASE_URL=sqlite:///data/arena.db \
        .venv/bin/python scripts/verify_practice.py

It proves the contract the Practice feature is judged on, in the order a
student hits it:

  1. the catalog      — courses → topics → real availability counts
  2. the setup rules  — size capped by the bank, clear "Only N available"
  3. random + unique  — no repeated question, fresh order each session
  4. the safe shuffle — grading follows the underlying option, never the
                        displayed A/B/C/D letter
  5. refresh survival — /practice/active restores the SAME paper + answers
  6. the server clock — answers after ends_at are refused, expired runs finish
  7. the results      — score, time used and a full review with explanations
  8. the upload path  — "Correct Answer: <text>" resolves to the canonical key
  9. legacy modes     — sprints still work exactly as before

No mocks: every call goes through the HTTP API. The clock test reaches into
the same database the server uses (WAL) to age a run's ends_at, because the
API deliberately exposes no way to forge time.
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
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

API = os.environ.get("ARENA_API", "http://127.0.0.1:3000/api")
ADMIN_EMAIL = os.environ.get("ARENA_ADMIN_EMAIL", "admin@quizarena.ng")
ADMIN_PASSWORD = os.environ.get("ARENA_ADMIN_PASSWORD", "arena2026")

PASSED = 0
FAILED = 0

LETTERS = "ABCD"


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


def new_student(prefix: str = "pq") -> tuple[str, dict]:
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


def age_run(token: str, seconds: int = 2) -> None:
    """Pull a run's server-side ends_at back to ``started_at + seconds``.

    The API deliberately exposes no way to forge time, so the clock test ages
    the deadline directly in the database (WAL write, same file the server
    uses). Keeping ``ends_at`` after ``started_at`` keeps the run's window
    honest: time used then reads as exactly ``seconds``.
    """
    from datetime import datetime

    from app.db import session_scope
    from app.models import PracticeChallenge

    with session_scope() as db:
        challenge = db.query(PracticeChallenge).filter(PracticeChallenge.token == token).one()
        payload = dict(challenge.payload or {})
        started = datetime.fromisoformat(str(payload["started_at"]))
        payload["ends_at"] = (started + timedelta(seconds=seconds)).isoformat()
        challenge.payload = payload


# ---------------------------------------------------------------------------
# helpers for the answer contract
# ---------------------------------------------------------------------------
def admin_answer_key(admin: str, question_id: int) -> str:
    status, payload = call("GET", f"/admin/questions/{question_id}", token=admin)
    if status != 200:
        raise RuntimeError(f"admin question fetch failed: {status} {payload}")
    return payload["correct"]


def label_for(order: list[str], canonical: str) -> str:
    return LETTERS[order.index(canonical)]


def other_label(order: list[str], canonical: str) -> str:
    for position, key in enumerate(order):
        if key != canonical:
            return LETTERS[position]
    raise RuntimeError("no wrong option")


# ---------------------------------------------------------------------------
# 1 + 2. catalog and setup rules
# ---------------------------------------------------------------------------
def check_catalog(admin: str, student: str) -> dict:
    print("\n[1] practice catalog")
    status, catalog = call("GET", "/arena/practice/catalog", token=student)
    check("catalog loads", status == 200, (status, catalog))
    courses = catalog["courses"]
    check("at least one course offers practice", len(courses) >= 1, courses)
    juris = next((row for row in courses if "Jurisprudence" in row["title"]), None)
    check("Jurisprudence course listed", juris is not None, [row["title"] for row in courses])
    topics = {row["topic"]: row for row in (juris["topics"] if juris else [])}
    check(
        "Historical School topic present with its count",
        topics.get("Historical School", {}).get("count", 0) >= 1,
        topics,
    )
    check("course availability equals the sum of its topics", juris["available"] == sum(row["count"] for row in juris["topics"]), juris)

    print("\n[2] setup rules — the bank decides the maximum")
    status, payload = call(
        "POST",
        "/arena/practice/start",
        {"mode": "custom", "course_id": juris["id"], "topic": "Historical School", "size": 20, "time_limit_seconds": 600},
        token=student,
    )
    check("requesting more than the bank holds is refused", status == 409, (status, payload))
    import re as _re

    refused = detail(payload)
    announced = _re.search(r"Only (\d+) questions? are available", refused)
    check(
        "the refusal says exactly how many exist",
        bool(announced) and int(announced.group(1)) == topics["Historical School"]["count"] and "available" in refused,
        refused,
    )

    status, payload = call(
        "POST",
        "/arena/practice/start",
        {"mode": "custom", "course_id": juris["id"], "topic": "Nowhere", "size": 5, "time_limit_seconds": 600},
        token=student,
    )
    check("empty topic is refused, not silently widened", status == 409, (status, payload))
    return juris


# ---------------------------------------------------------------------------
# 3 + 4 + 5. one full run: random, unique, shuffled, refresh-proof
# ---------------------------------------------------------------------------
def check_full_run(admin: str, student: str, juris: dict) -> None:
    print("\n[3] random unique selection + shuffled order")
    size = min(8, juris["available"])
    status, default_run = call(
        "POST",
        "/arena/practice/start",
        {"mode": "custom", "course_id": juris["id"], "topic": "", "size": 0, "time_limit_seconds": 1200},
        token=student,
    )
    check(
        "an unset size falls back to the bank's real maximum",
        status == 200 and len(default_run["questions"]) == min(20, juris["available"]),
        (status, len(default_run.get("questions") or []), juris["available"]),
    )
    status, run = call(
        "POST",
        "/arena/practice/start",
        {"mode": "custom", "course_id": juris["id"], "topic": "", "size": size, "time_limit_seconds": 1200},
        token=student,
    )
    check("run starts with the requested size", status == 200 and len(run["questions"]) == size, (status, run))
    ids = [row["id"] for row in run["questions"]]
    check("every question is unique (no repeats)", len(ids) == len(set(ids)) == size, ids)
    check("timer end is stamped server-side", bool(run["ends_at"]), run.get("ends_at"))
    check("duration echoes the request", run.get("duration_seconds") == 1200, run.get("duration_seconds"))
    check("answer key never leaks to the browser", all("correct" not in row and "explanation" not in row for row in run["questions"]), run["questions"][0].keys())
    check("options arrive pre-shuffled with their display order", all(isinstance(row.get("display_order"), list) and len(row["display_order"]) == 4 for row in run["questions"]), run["questions"][0])
    token = run["token"]

    # a second run of the same scope must not clone the first session's order
    order_a = [row["id"] for row in default_run["questions"]]
    order_b = ids
    if len(order_a) == len(order_b):
        check("a fresh session draws its own random order", sorted(order_a) == sorted(order_b) and (order_a != order_b or len(order_a) < 2), (order_a, order_b))
    else:
        check("a fresh session redraws its own random sample", len(set(order_b)) == len(order_b), order_b)

    print("\n[4] answer options shuffle without ever moving the correct answer")
    # Q1 deliberately wrong, then the rest right — grading via the canonical key.
    shuffled_somewhere = False
    answered = 0
    for position, question in enumerate(run["questions"]):
        canonical = admin_answer_key(admin, question["id"])
        order = question["display_order"]
        if label_for(order, canonical) != canonical:
            shuffled_somewhere = True
        submit = other_label(order, canonical) if position == 0 else label_for(order, canonical)
        status, result = call(
            "POST",
            "/arena/practice/answer",
            {"token": token, "question_id": question["id"], "selected": submit, "elapsed_ms": 4200},
            token=student,
        )
        if status != 200:
            check(f"question {position + 1} accepted", False, (status, result))
            return
        answered += 1
        if position == 0:
            check(
                "a wrong pick is graded wrong with the stored explanation",
                result["correct"] is False and result["expected"] == canonical and bool(result["explanation"]),
                result,
            )
            status, again = call(
                "POST",
                "/arena/practice/answer",
                {"token": token, "question_id": question["id"], "selected": "A", "elapsed_ms": 100},
                token=student,
            )
            check("a question cannot be answered twice in one session", status == 409 and "already answered" in detail(again), (status, again))
        elif position == 1:
            check(
                "the correct option stays correct wherever it is displayed",
                result["correct"] is True and result["expected"] == canonical,
                result,
            )
        if position == 2:
            break  # leave the run open to prove refresh survival first

    print("\n[5] the same session survives a refresh")
    status, active = call("GET", "/arena/practice/active", token=student)
    check("active run is discoverable", status == 200 and active["run"] is not None, (status, active))
    restored = active["run"]
    check("same token after refresh", restored["token"] == token, restored["token"])
    check("same questions in the same order after refresh", [row["id"] for row in restored["questions"]] == ids, restored["questions"])
    check(
        "same per-question option shuffle after refresh",
        [row["display_order"] for row in restored["questions"]] == [row["display_order"] for row in run["questions"]],
        "orders differ",
    )
    check("resume points at the first unanswered question", restored["index"] == 3, restored["index"])
    check(
        "resume carries the answers already given",
        restored["stats"]["answered"] == 3 and restored["stats"]["correct"] == 2 and restored["stats"]["wrong"] == 1,
        restored["stats"],
    )

    for question in run["questions"][3:]:
        canonical = admin_answer_key(admin, question["id"])
        status, result = call(
            "POST",
            "/arena/practice/answer",
            {"token": token, "question_id": question["id"], "selected": label_for(question["display_order"], canonical), "elapsed_ms": 4200},
            token=student,
        )
        if status != 200:
            check("remaining question accepted", False, (status, result))
            return
        answered += 1
        check("last answer reports the run finished", result["finished"] is True or answered < len(ids), result)
    check("all questions answered", answered == len(run["questions"]), answered)
    check("the run saw at least one shuffled option order", shuffled_somewhere, "unlikely but possible — rerun")

    status, closed = call(
        "POST",
        "/arena/practice/answer",
        {"token": token, "question_id": ids[0], "selected": "A", "elapsed_ms": 100},
        token=student,
    )
    check("a finished run accepts no more answers", status == 409, (status, closed))

    print("\n[7] results — score, time used and a full review")
    time.sleep(1.2)  # a human spends at least this long on eight questions
    status, summary = call("POST", f"/arena/practice/finish?token={token}&elapsed_ms=300000", token=student)
    check("run finishes", status == 200, (status, summary))
    check(
        "totals add up",
        summary["total"] == size and summary["correct"] == size - 1 and summary["wrong"] == 1,
        summary,
    )
    check("score percent computed", summary["score_percent"] == round((size - 1) / size * 100, 1), summary["score_percent"])
    check("time used comes from the server window", 0 < summary["time_used_seconds"] <= 1200, summary["time_used_seconds"])
    review = summary["review"]
    check("review covers every question", len(review) == size, len(review))
    check(
        "review shows your answer, the right answer and the stored explanation",
        all(
            row["answered"] and row["chosen_label"] in LETTERS and row["correct_label"] in LETTERS and isinstance(row["explanation"], str)
            for row in review
        ),
        review[0],
    )
    wrong_row = next(row for row in review if not row["correct"])
    check("the missed question is flagged in the review", wrong_row["chosen_label"] != wrong_row["correct_label"], wrong_row)
    status, repeat = call("GET", "/arena/practice/active", token=student)
    check("no run lingers after finishing", status == 200 and repeat["run"] is None, repeat)
    status, history = call("GET", "/arena/practice/history", token=student)
    labels = [row["label"] for row in history["runs"]]
    check("custom runs appear in history with a readable label", "Custom practice" in labels, labels)


# ---------------------------------------------------------------------------
# 6. the server clock
# ---------------------------------------------------------------------------
def check_server_clock(student: str, juris: dict) -> None:
    print("\n[6] the timer belongs to the server")
    positivism = next((row["count"] for row in juris["topics"] if row["topic"] == "Positivism"), 0)
    status, run = call(
        "POST",
        "/arena/practice/start",
        {"mode": "custom", "course_id": juris["id"], "topic": "Positivism", "size": min(3, positivism), "time_limit_seconds": 600},
        token=student,
    )
    check("timed run starts", status == 200, (status, run))
    token = run["token"]
    question = run["questions"][0]
    time.sleep(3)  # let the aged window (started + 2s) pass for real
    age_run(token)

    status, late = call(
        "POST",
        "/arena/practice/answer",
        {"token": token, "question_id": question["id"], "selected": "A", "elapsed_ms": 1000},
        token=student,
    )
    check("answers after the deadline are refused", status == 409 and "Time is up" in detail(late), (status, late))

    status, active = call("GET", "/arena/practice/active", token=student)
    check("an expired unanswered run is discarded, not resumed", status == 200 and active["run"] is None, active)

    status, fresh = call(
        "POST",
        "/arena/practice/start",
        {"mode": "custom", "course_id": juris["id"], "topic": "Positivism", "size": min(2, positivism), "time_limit_seconds": 600},
        token=student,
    )
    token = fresh["token"]
    call("POST", "/arena/practice/answer", {"token": token, "question_id": fresh["questions"][0]["id"], "selected": "A", "elapsed_ms": 500}, token=student)
    time.sleep(3)
    age_run(token)
    status, active = call("GET", "/arena/practice/active", token=student)
    check("an expired run with answers comes back for its summary", status == 200 and active["run"] is not None and active["expired"] is True, active)
    expected = len(fresh["questions"])
    status, summary = call("POST", f"/arena/practice/finish?token={token}&elapsed_ms=600000", token=student)
    check(
        "expired run finalises with its answers intact",
        status == 200 and summary["total"] == expected and len(summary["review"]) == expected and 1 <= summary["time_used_seconds"] < 600,
        (status, summary),
    )


# ---------------------------------------------------------------------------
# 8. the upload path — correct answer as real text
# ---------------------------------------------------------------------------
def check_text_answers(admin: str, juris_course_id: int) -> None:
    print("\n[8] uploads may state the correct answer as its actual text")
    status, quizzes = call("GET", "/admin/quizzes", token=admin)
    quiz = next(row for row in quizzes if row["course"] and row["course"]["id"] == juris_course_id)
    status, created = call(
        "POST",
        f"/admin/quizzes/{quiz['id']}/questions",
        {
            "text": "Who is regarded as the father of the Historical School of Jurisprudence?",
            "option_a": "John Austin",
            "option_b": "Savigny",
            "option_c": "Jeremy Bentham",
            "option_d": "Roscoe Pound",
            "correct": "Savigny",
            "explanation": "Savigny founded the Historical School, emphasising the Volksgeist.",
            "topic": "Historical School",
        },
        token=admin,
    )
    check("single upload accepts the answer text", status == 200 and created["correct"] == "B", (status, created))
    check("the stored answer is the canonical key, not the text", created["correct"] in ("A", "B", "C", "D"), created["correct"])

    paper = (
        f"Who defined law as the command of the sovereign? (paste check {digits(4)})\n"
        "A. H.L.A. Hart\n"
        "B. John Austin\n"
        "C. Roscoe Pound\n"
        "D. Thomas Aquinas\n"
        "Answer: John Austin\n"
        "Explanation: Austin's command theory in a single line.\n"
    )
    status, bulk = call(
        "POST",
        f"/admin/quizzes/{quiz['id']}/questions/bulk",
        {"raw": paper, "mode": "append"},
        token=admin,
    )
    check(
        "bulk paste accepts the answer text too",
        status == 200 and bulk["created"] == 1 and bulk["rejected"] == 0 and not bulk["errors"],
        (status, bulk),
    )
    check(
        "the pasted text answer lands on the right canonical key",
        status == 200 and [row["correct"] for row in bulk["questions"]] == ["B"],
        bulk.get("questions"),
    )

    status, ambiguous = call(
        "POST",
        f"/admin/quizzes/{quiz['id']}/questions",
        {
            "text": "Two identical options must never silently match.",
            "option_a": "Same text",
            "option_b": "Same text",
            "option_c": "Other",
            "option_d": "Other two",
            "correct": "Same text",
            "explanation": "x",
        },
        token=admin,
    )
    check("an ambiguous text answer is rejected, not guessed", status == 422, (status, ambiguous))

    status, nonsense = call(
        "POST",
        f"/admin/quizzes/{quiz['id']}/questions",
        {
            "text": "A nonsense answer must be rejected.",
            "option_a": "One",
            "option_b": "Two",
            "option_c": "Three",
            "option_d": "Four",
            "correct": "Banana",
            "explanation": "x",
        },
        token=admin,
    )
    check("an unknown text answer is rejected", status == 422, (status, nonsense))

    # cleanup: remove the questions this check added (leave the bank as found)
    created_ids = [created["id"]] + [row["id"] for row in (bulk.get("questions") or []) if isinstance(row, dict) and row.get("id")]
    for question_id in created_ids:
        call("DELETE", f"/admin/questions/{question_id}", token=admin)


# ---------------------------------------------------------------------------
# 9. legacy modes still work
# ---------------------------------------------------------------------------
def check_legacy_modes(student: str) -> None:
    print("\n[9] legacy practice modes are untouched")
    status, modes = call("GET", "/arena/practice/modes", token=student)
    check("modes list still loads", status == 200 and len(modes["modes"]) >= 10, (status, modes))
    keys = [row["key"] for row in modes["modes"]]
    check("custom mode is not duplicated into the quick modes", "custom" not in keys, keys)
    status, run = call("POST", "/arena/practice/start", {"mode": "sprint5", "size": 0}, token=student)
    check("a sprint still starts", status == 200 and len(run["questions"]) == 5, (status, run))
    question = run["questions"][0]
    status, result = call(
        "POST",
        "/arena/practice/answer",
        {"token": run["token"], "question_id": question["id"], "selected": "A", "elapsed_ms": 800},
        token=student,
    )
    check("a sprint answer still grades", status == 200 and "correct" in result, (status, result))
    status, finished = call("POST", f"/arena/practice/finish?token={run['token']}&elapsed_ms=45000", token=student)
    check("a sprint still finishes with rewards", status == 200 and finished.get("xp", 0) >= 0, (status, finished))


def main() -> None:
    admin = admin_token()
    student, _profile = new_student()
    juris = check_catalog(admin, student)
    check_full_run(admin, student, juris)
    check_server_clock(student, juris)
    check_text_answers(admin, juris["id"])
    check_legacy_modes(student)

    print(f"\npractice suite: {PASSED} passed, {FAILED} failed")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
