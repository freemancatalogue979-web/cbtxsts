"""Course bank ⇄ exam architecture verification.

Proves, against a live API on :3000:

* a course bank can hold thousands of questions (bulk-imported here);
* a "Random From Course" exam of 40 copies nothing — the bank stays the size
  it was and the exam reports 40 as its length and the bank size separately;
* every player is dealt their OWN random 40 at start (papers differ between
  players, are not "the first 40", have no duplicates, and stay fixed for the
  attempt across refreshes); scoring is out of the player's 40;
* an exam that asks for more than the bank holds is refused with a clear message;
* exam-specific questions belong to their exam only — they do not grow the
  course bank and never appear in practice — until explicitly added to the bank.

Pollutes data on purpose (a new course per run). Exits non-zero on failure.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:3000/api"
PASS = 0
FAIL = 0
SUFFIX = str(int(time.time()))[-6:]
BANK_SIZE = 2000
DRAW = 40
PLAYERS = 6


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name} {('— ' + detail[:200]) if detail else ''}")


def call(method: str, path: str, body: dict | None = None, token: str | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            return error.code, json.loads(raw or b"null")
        except ValueError:
            return error.code, {"detail": raw.decode(errors="replace")[:200]}


def student(n: int) -> str:
    username = f"cb{SUFFIX}p{n}"
    phone = f"081{SUFFIX}{n:02d}"[:11].ljust(11, "0")
    status, res = call("POST", "/auth/register", {"username": username, "phone": phone, "password": "secret123"})
    if status != 200:
        status, res = call("POST", "/auth/student", {"identifier": username, "password": "secret123"})
    return res["token"]


def row(i: int, topic: str, difficulty: str) -> dict:
    return {
        "text": f"[{SUFFIX}] Bank question number {i}: which option is the stored key for item {i}?",
        "option_a": f"Alpha {i}",
        "option_b": f"Bravo {i}",
        "option_c": f"Charlie {i}",
        "option_d": f"Delta {i}",
        "correct": "ABCD"[i % 4],
        "topic": topic,
        "difficulty": difficulty,
        "explanation": f"Item {i} is keyed {'ABCD'[i % 4]}.",
    }


def main() -> None:
    status, admin = call("POST", "/auth/admin", {"email": "admin@quizarena.ng", "password": "arena2026"})
    check("admin login", status == 200)
    T = admin["token"]

    print("== 1 · course + bank of thousands ==")
    status, course = call("POST", "/admin/courses", {"code": f"CB{SUFFIX}", "title": f"Bank Course {SUFFIX}"}, token=T)
    check("course created", status == 200, str(course))
    cid = course["id"]
    status, bank_quiz = call("POST", f"/admin/courses/{cid}/bank-quiz", {}, token=T)
    check("bank opened", status == 200 and bank_quiz.get("is_bank") is True, str(bank_quiz)[:150])
    topics = ["Contracts", "Torts", "Evidence", "Procedure"]
    diffs = ["easy", "medium", "hard"]
    started = time.time()
    for start in range(0, BANK_SIZE, 500):
        batch = [row(i, topics[i % 4], diffs[i % 3]) for i in range(start, start + 500)]
        status, res = call("POST", f"/admin/quizzes/{bank_quiz['id']}/questions/bulk", {"questions": batch}, token=T)
        if status != 200:
            check(f"bulk batch {start}", False, str(res)[:200])
            break
    print(f"     imported {BANK_SIZE} in {time.time() - started:.1f}s")
    status, bank = call("GET", f"/admin/courses/{cid}/bank", token=T)
    check(f"bank holds {BANK_SIZE}", bank.get("bank") == BANK_SIZE, str(bank))

    print("== 2 · random-from-course exam ==")
    status, quiz = call(
        "POST",
        "/admin/quizzes",
        {"title": f"CB Random {SUFFIX}", "course_id": cid, "question_source": "course_random", "draw_count": DRAW,
         "duration_minutes": 30, "status": "active", "shuffle_questions": True},
        token=T,
    )
    check("random exam created", status == 200, str(quiz)[:200])
    qid = quiz["id"]
    check("exam length reported as 40", quiz.get("question_count") == DRAW, str(quiz.get("question_count")))
    check("bank size reported separately", quiz.get("bank_size") == BANK_SIZE, str(quiz.get("bank_size")))
    check("nothing copied into the exam", quiz.get("exam_question_count") == 0 and quiz["questions"] == [])
    status, bank = call("GET", f"/admin/courses/{cid}/bank", token=T)
    check("bank unchanged after creating exam", bank.get("bank") == BANK_SIZE, str(bank))

    status, res = call("POST", "/admin/quizzes", {"title": f"CB TooBig {SUFFIX}", "course_id": cid,
                       "question_source": "course_random", "draw_count": 480}, token=T)
    check("draw larger than a small scope refused", status in (200, 400))
    status, res = call("POST", "/admin/quizzes", {"title": f"CB TooBig2 {SUFFIX}", "course_id": cid,
                       "question_source": "course_random", "draw_count": 40, "topics": ["NoSuchTopic"]}, token=T)
    check("draw bigger than bank refused with message", status == 400 and "only holds 0" in str(res.get("detail")), str(res))

    print("== 3 · each player gets their own random paper ==")
    bank_ids = set()
    papers: list[list[int]] = []
    tokens = [student(n) for n in range(PLAYERS)]
    for token in tokens:
        status, att = call("POST", f"/exams/{qid}/start", {}, token=token)
        if status != 200:
            check("attempt start", False, str(att)[:200])
            return
        papers.append([q["id"] for q in att["questions"]])
    check("every paper has exactly 40", all(len(p) == DRAW for p in papers), str([len(p) for p in papers]))
    check("no duplicates inside a paper", all(len(set(p)) == len(p) for p in papers))
    distinct = {tuple(sorted(p)) for p in papers}
    check(f"{PLAYERS} players → {PLAYERS} different selections", len(distinct) == PLAYERS, f"{len(distinct)} distinct")
    overlaps = [len(set(papers[0]) & set(p)) for p in papers[1:]]
    print(f"     overlap of player 1 with others: {overlaps} (expected ≈ {DRAW * DRAW / BANK_SIZE:.1f})")
    check("overlap looks random (not the same block)", max(overlaps) < 15, str(overlaps))
    status, listing = call("GET", f"/admin/questions?course_id={cid}&scope=bank&sort=position&limit=40", token=T)
    first40 = {r["id"] for r in (listing or {}).get("rows", [])}
    check("not simply the first 40 of the bank", all(set(p) != first40 for p in papers))
    positions = []
    for p in papers:
        positions.extend(p)
    spread = max(positions) - min(positions)
    check("draws span the whole bank", spread > BANK_SIZE * 0.8, f"id spread {spread}")

    status, again = call("POST", f"/exams/{qid}/start", {}, token=tokens[0])
    check("refresh keeps the same paper", [q["id"] for q in again["questions"]] == papers[0])
    attempt_id = again.get("attempt_id") or again.get("id")
    # answer every question right using the admin view of each bank question
    for q_id in papers[0]:
        _, full = call("GET", f"/admin/questions/{q_id}", token=T)
        status, res = call("POST", f"/exams/attempts/{attempt_id}/answer",
                           {"question_id": q_id, "selected": full["correct"], "seconds_spent": 2}, token=tokens[0])
        if status != 200:
            check("answer accepted", False, str(res)[:200])
            break
    foreign = next(i for i in papers[1] if i not in papers[0])
    status, res = call("POST", f"/exams/attempts/{attempt_id}/answer",
                       {"question_id": foreign, "selected": "A", "seconds_spent": 1}, token=tokens[0])
    check("another player's question is rejected", status == 400, str(res)[:120])
    status, result = call("POST", f"/exams/attempts/{attempt_id}/submit", {}, token=tokens[0])
    check("submitted with 40/40", status == 200 and result.get("correct_count") == DRAW and result.get("unanswered_count") == 0,
          str({k: result.get(k) for k in ("correct_count", "wrong_count", "unanswered_count", "percentage")}))
    check("100% on own paper", round(result.get("percentage", 0)) == 100, str(result.get("percentage")))
    status, bank = call("GET", f"/admin/courses/{cid}/bank", token=T)
    check("bank still intact after play", bank.get("bank") == BANK_SIZE and bank.get("drawn_copies") == 0, str(bank))

    print("== 4 · difficulty quota ==")
    status, mix = call("POST", "/admin/quizzes", {"title": f"CB Mix {SUFFIX}", "course_id": cid, "question_source": "course_random",
                       "draw_count": 12, "draw_difficulty": {"easy": 6, "hard": 6}, "status": "active"}, token=T)
    check("mixed exam created", status == 200, str(mix)[:200])
    status, att = call("POST", f"/exams/{mix['id']}/start", {}, token=tokens[1])
    levels = []
    for q in att.get("questions", []):
        _, full = call("GET", f"/admin/questions/{q['id']}", token=T)
        levels.append(full["difficulty"])
    check("6 easy + 6 hard dealt", sorted(levels) == ["easy"] * 6 + ["hard"] * 6, str(levels))

    print("== 5 · exam-specific questions stay in their exam ==")
    status, own = call("POST", "/admin/quizzes", {"title": f"CB Own {SUFFIX}", "course_id": cid,
                       "question_source": "exam_specific"}, token=T)
    check("exam-specific exam created (draft)", status == 200 and own.get("question_source") == "exam_specific", str(own)[:200])
    status, res = call("PATCH", f"/admin/quizzes/{own['id']}/status", {"status": "active"}, token=T)
    check("cannot go live with no questions", status == 400, str(res)[:150])
    special = [
        {**row(90000 + i, "Exam only", "medium"), "text": f"[{SUFFIX}] Exam-specific item {i} for this paper only?"}
        for i in range(10)
    ]
    status, res = call("POST", f"/admin/quizzes/{own['id']}/questions/bulk", {"questions": special}, token=T)
    check("10 exam-specific questions added", status == 200, str(res)[:200])
    status, bank = call("GET", f"/admin/courses/{cid}/bank", token=T)
    check("course bank did NOT grow", bank.get("bank") == BANK_SIZE and bank.get("exam_specific") == 10, str(bank))
    status, courses = call("GET", "/admin/courses", token=T)
    mine = next(c for c in courses if c["id"] == cid)
    check("course question count = bank only", mine["question_count"] == BANK_SIZE, str(mine["question_count"]))
    status, res = call("PATCH", f"/admin/quizzes/{own['id']}/status", {"status": "active"}, token=T)
    check("exam-specific exam goes live", status == 200, str(res)[:150])
    status, att = call("POST", f"/exams/{own['id']}/start", {}, token=tokens[2])
    check("player gets the 10 exam questions", status == 200 and len(att["questions"]) == 10)
    status, listing = call("GET", f"/admin/questions?course_id={cid}&scope=exam&limit=50", token=T)
    exam_rows = listing.get("rows", [])
    check("scope=exam lists them", len(exam_rows) == 10 and all(r["exam_only"] for r in exam_rows), str(len(exam_rows)))
    status, random_att = call("POST", f"/exams/{qid}/start", {}, token=tokens[3])
    exam_ids = {r["id"] for r in exam_rows}
    check("random draws never include exam-specific rows",
          not any(set(p) & exam_ids for p in papers) and not set(q["id"] for q in random_att["questions"]) & exam_ids)
    status, res = call("POST", f"/admin/questions/{exam_rows[0]['id']}/add-to-bank", {}, token=T)
    check("explicit add-to-bank works", status == 200 and res.get("bank_question_id"), str(res)[:150])
    status, bank = call("GET", f"/admin/courses/{cid}/bank", token=T)
    check("bank grew by exactly one", bank.get("bank") == BANK_SIZE + 1, str(bank))

    print(f"\nverify_course_bank: {PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
