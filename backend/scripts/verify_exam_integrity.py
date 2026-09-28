"""Exam integrity + offline delivery.

Starts its own API on a temp database (no internet, nothing shared):

    cd backend && ./.venv/bin/python scripts/verify_exam_integrity.py

Checks:
* one device per attempt: a second device gets 423, can take over, and the old
  device is then locked out (and the switch is logged for staff);
* the batch ``/sync`` endpoint: queued answers, integrity events and submit in
  one request; bad rows are refused individually; replays are harmless;
* offline grace: answers arriving shortly after the deadline still count, late
  ones are refused and the paper is closed;
* option shuffling: a resumed paper returns the letters the player tapped;
* staff: results carry an integrity digest, the timeline endpoint works, and
  item analysis reports picks/discrimination and flags a suspicious answer key.
"""
from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

API_PORT = 3991
ROOT = Path(__file__).resolve().parents[1]
TMP = Path(tempfile.gettempdir())
DB_FILE = TMP / f"integrity_verify_{os.getpid()}.db"
ENV = dict(os.environ)
ENV.update({"CBT_DATABASE_URL": f"sqlite:///{DB_FILE}", "CBT_EXAM_SYNC_GRACE_SECONDS": "90"})
BASE = f"http://127.0.0.1:{API_PORT}/api"
PASSED = FAILED = 0
D1, D2 = "dev-one-aaaaaaaa", "dev-two-bbbbbbbb"


def check(name: str, ok: bool, detail: object = "") -> None:
    global PASSED, FAILED
    if ok:
        PASSED += 1
        print(f"  ok   {name}")
    else:
        FAILED += 1
        print(f"  FAIL {name} — {str(detail)[:400]}")


def call(method: str, path: str, body: object = None, token: str | None = None, device: str | None = None) -> tuple[int, object]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if device:
        req.add_header("X-Arena-Device", device)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            return error.code, json.loads(raw)
        except Exception:
            return error.code, raw.decode(errors="replace")


def sql(statement: str, params: tuple = ()) -> list:
    con = sqlite3.connect(DB_FILE)
    try:
        rows = con.execute(statement, params).fetchall()
        con.commit()
        return rows
    finally:
        con.close()


def naive(dt: datetime) -> str:
    return dt.replace(tzinfo=None).isoformat(sep=" ")


def player(name: str) -> str:
    stamp = str(time.time_ns())[-8:]
    code, body = call("POST", "/auth/register", {"username": f"{name}{stamp}"[:20], "password": "secret123", "phone": f"080{stamp}", "display_name": name})
    assert code in (200, 201), body
    return body["token"]


def main() -> int:
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(API_PORT)],
        cwd=ROOT, env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
    )
    try:
        for _ in range(120):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{API_PORT}/api/health", timeout=1)
                break
            except Exception:
                time.sleep(0.25)
        else:
            print("API did not start")
            return 1

        code, admin = call("POST", "/auth/admin", {"email": "admin@quizarena.ng", "password": "arena2026"})
        staff = admin["token"]
        a = player("alice")
        code, quizzes = call("GET", "/quizzes", token=a)
        active = [q for q in quizzes if q.get("status") == "active" and (q.get("question_count") or 0) >= 4]
        check("seed has active exams", len(active) >= 2, quizzes)
        shuffled, plain = active[0], active[1]
        # Deterministic test conditions: long papers, no per-question clock.
        sql("UPDATE quizzes SET shuffle_options=1, per_question_seconds=0, duration_minutes=30 WHERE id=?", (shuffled["id"],))
        sql("UPDATE quizzes SET shuffle_options=0, per_question_seconds=0, duration_minutes=30, max_attempts=0 WHERE id=?", (plain["id"],))

        print("device lock")
        code, st = call("POST", f"/exams/{shuffled['id']}/start", {}, token=a, device=D1)
        check("start on device 1", code == 200 and st["status"] == "in_progress", st)
        att = st["id"]
        check("option shuffle on for this attempt", st.get("option_shuffle") is True, st.get("option_shuffle"))
        code, body = call("GET", f"/exams/attempts/{att}", token=a, device=D2)
        check("second device is refused with 423", code == 423 and "another device" in str(body), (code, body))
        code, body = call("GET", f"/exams/attempts/{att}", token=a)
        check("no device header still reads (legacy client)", code == 200, (code, body))
        code, body = call("GET", f"/exams/attempts/{att}?takeover=true", token=a, device=D2)
        check("takeover moves the paper", code == 200, (code, body))
        q0 = st["questions"][0]["id"]
        code, body = call("POST", f"/exams/attempts/{att}/answer", {"question_id": q0, "selected": "A"}, token=a, device=D1)
        check("old device is locked out (423 moved)", code == 423 and "moved" in str(body), (code, body))
        code, body = call("POST", f"/exams/attempts/{att}/sync", {"answers": [{"question_id": q0, "selected": "A"}]}, token=a, device=D1)
        check("old device cannot sync either", code == 423, (code, body))

        print("sync batch")
        qs = [q["id"] for q in st["questions"]]
        picks = {qs[0]: "A", qs[1]: "B", qs[2]: "C"}
        events = [
            {"type": "away", "seconds": 12, "question": 1},
            {"type": "away", "seconds": 0.4},  # flicker, ignored
            {"type": "offline", "seconds": 30},
            {"type": "copy"},
            {"type": "hack_the_planet", "seconds": 99},  # unknown, ignored
        ]
        body_in = {"answers": [{"question_id": q, "selected": l, "seconds_spent": 5} for q, l in picks.items()]
                   + [{"question_id": 99999999, "selected": "A"}], "events": events}
        code, body = call("POST", f"/exams/attempts/{att}/sync", body_in, token=a, device=D2)
        check("sync accepted 3 answers", code == 200 and sorted(body["accepted"]) == sorted(picks), (code, body))
        check("foreign question refused individually", code == 200 and [r["question_id"] for r in body["rejected"]] == [99999999], body)
        check("sync reports progress", body.get("answered") == 3 and body.get("status") == "in_progress", body)
        code, again = call("POST", f"/exams/attempts/{att}/sync", {"answers": body_in["answers"][:3]}, token=a, device=D2)
        check("replaying the same batch is harmless", code == 200 and again.get("answered") == 3, again)

        code, resumed = call("GET", f"/exams/attempts/{att}", token=a, device=D2)
        got = {row["question_id"]: row["selected"] for row in resumed["answers"]}
        check("resumed paper returns the letters the player tapped", all(got.get(q) == l for q, l in picks.items()), (got, picks))
        orders = json.loads(sql("SELECT option_orders FROM attempts WHERE id=?", (att,))[0][0] or "{}")
        stored = {r[0]: r[1] for r in sql("SELECT question_id, selected FROM answers WHERE attempt_id=?", (att,))}
        mapped_ok = all(stored[q] == orders[str(q)]["ABCD".index(l)] for q, l in picks.items())
        check("stored answers are canonical keys (shuffle mapped back)", mapped_ok, (stored, orders))
        shuffled_any = any(orders[str(q)] != sorted(orders[str(q)]) for q in qs)
        check("options really are shuffled for this paper", shuffled_any, orders)

        integ = json.loads(sql("SELECT integrity FROM attempts WHERE id=?", (att,))[0][0] or "{}")
        check("integrity: 1 screen leave, 12 s away", integ.get("focus_lost") == 1 and integ.get("away_seconds") == 12, integ)
        check("integrity: offline spell + clipboard + device switch", integ.get("offline_spells") == 1 and integ.get("clipboard") == 1 and integ.get("device_switches") == 1, integ)
        check("integrity: unknown event types dropped", all(e["type"] != "hack_the_planet" for e in integ.get("events", [])), integ)

        code, done = call("POST", f"/exams/attempts/{att}/sync", {"answers": [{"question_id": qs[3], "selected": "D"}], "submit": "early"}, token=a, device=D2)
        check("sync can deliver the last answer and submit together", code == 200 and done["status"] == "submitted" and qs[3] in done["accepted"], done)
        code, replay = call("POST", f"/exams/attempts/{att}/sync", {"answers": [{"question_id": qs[0], "selected": "D"}], "submit": "early"}, token=a, device=D1)
        check("sync after submit just reports submitted (no 423, no change)", code == 200 and replay["status"] == "submitted" and replay["accepted"] == [], replay)
        check("answer after submit was not changed", sql("SELECT selected FROM answers WHERE attempt_id=? AND question_id=?", (att, qs[0]))[0][0] == stored[qs[0]])

        print("offline grace window")
        b = player("bola")
        code, sb = call("POST", f"/exams/{plain['id']}/start", {}, token=b, device=D1)
        now = datetime.now(timezone.utc)
        sql("UPDATE attempts SET deadline_at=? WHERE id=?", (naive(now - timedelta(seconds=30)), sb["id"]))
        code, rb = call("GET", f"/exams/attempts/{sb['id']}", token=b, device=D1)
        check("inside the window a reload keeps the paper open", code == 200 and rb["status"] == "in_progress" and rb["time_remaining"] == 0, (code, rb.get("status") if isinstance(rb, dict) else rb))
        code, body = call("POST", f"/exams/attempts/{sb['id']}/answer", {"question_id": sb["questions"][0]["id"], "selected": "A"}, token=b, device=D1)
        check("the live answer endpoint still refuses after 0:00", code == 400, (code, body))
        code, body = call("POST", f"/exams/attempts/{sb['id']}/sync", {"answers": [{"question_id": sb["questions"][0]["id"], "selected": "A"}], "submit": "auto_timer"}, token=b, device=D1)
        check("queued answer 30 s after deadline still counts", code == 200 and body["accepted"] == [sb["questions"][0]["id"]] and body["status"] == "submitted", body)

        c = player("chidi")
        code, sc = call("POST", f"/exams/{plain['id']}/start", {}, token=c, device=D1)
        sql("UPDATE attempts SET deadline_at=? WHERE id=?", (naive(now - timedelta(seconds=200)), sc["id"]))
        code, body = call("POST", f"/exams/attempts/{sc['id']}/sync", {"answers": [{"question_id": sc["questions"][0]["id"], "selected": "A"}]}, token=c, device=D1)
        check("answers after the window are refused and the paper closes", code == 200 and body["late"] is True and body["status"] == "submitted" and body["rejected"], body)
        check("late answer not stored", not sql("SELECT 1 FROM answers WHERE attempt_id=?", (sc["id"],)))

        print("staff views")
        code, res = call("GET", f"/admin/results?quiz_id={shuffled['id']}", token=staff)
        row = next((r for r in res["rows"] if r["result"]["id"] == att), None)
        check("results rows carry an integrity digest", row is not None and "integrity" in row, res)
        if row:
            check("device switch puts the paper up for review", row["integrity"]["level"] == "review" and row["integrity"]["device_switches"] == 1, row["integrity"])
        code, pub = call("GET", f"/quizzes/{shuffled['id']}/leaderboard", token=a)
        check("public leaderboard never shows integrity", "integrity" not in json.dumps(pub), pub)
        code, tl = call("GET", f"/admin/results/{att}/integrity", token=staff)
        check("timeline endpoint lists events", code == 200 and {e["type"] for e in tl["events"]} >= {"away", "offline", "copy", "device_switch"}, tl)
        code, body = call("GET", f"/admin/results/{att}/integrity", token=a)
        check("players cannot read integrity timelines", code in (401, 403), code)

        print("item analysis")
        # Everyone must see the same questions: deal the whole pool to each paper.
        sql("UPDATE quizzes SET draw_count=1000 WHERE id=?", (plain["id"],))
        keys = {r[0]: (r[1] or "A")[:1].upper() for r in sql("SELECT id, correct FROM questions")}
        wrong_of = {qid: next(l for l in "ABCD" if l != k) for qid, k in keys.items()}
        trap = None
        # Strong students ace everything but the trap (where they all pick the same
        # wrong option); weak students miss everything but get the trap "right".
        for i in range(6):
            t = player(f"it{i}")
            code, s = call("POST", f"/exams/{plain['id']}/start", {}, token=t, device=f"device-it-{i:04d}")
            if code == 400 and "only holds" in str(s):
                import re as _re
                size = int(_re.search(r"only holds (\d+)", str(s)).group(1))
                sql("UPDATE quizzes SET draw_count=? WHERE id=?", (size, plain["id"]))
                code, s = call("POST", f"/exams/{plain['id']}/start", {}, token=t, device=f"device-it-{i:04d}")
            assert code == 200, s
            if trap is None:
                trap = s["questions"][0]["id"]
                pool = sorted(q["id"] for q in s["questions"])
            else:
                assert sorted(q["id"] for q in s["questions"]) == pool, "papers differ"
            strong = i < 3
            answers = []
            for q in s["questions"]:
                qid = q["id"]
                if qid == trap:
                    pick = wrong_of[qid] if strong else keys[qid]
                else:
                    pick = keys[qid] if strong else wrong_of[qid]
                answers.append({"question_id": qid, "selected": pick})
            code, body = call("POST", f"/exams/attempts/{s['id']}/sync", {"answers": answers, "submit": "early"}, token=t, device=f"device-it-{i:04d}")
            assert code == 200 and body["status"] == "submitted", body
        code, ia = call("GET", f"/admin/quizzes/{plain['id']}/item-analysis", token=staff)
        check("item analysis responds", code == 200 and ia["attempts"] >= 6, (code, ia if code != 200 else ia["attempts"]))
        trap_row = next((r for r in ia["questions"] if r["id"] == trap), None)
        check("trap question flagged check_key", trap_row is not None and "check_key" in trap_row["flags"], trap_row)
        check("trap question discrimination is negative", trap_row is not None and (trap_row["discrimination"] or 0) < 0, trap_row)
        check("flagged questions sort first", ia["questions"][0]["flags"][:1] == ["check_key"], ia["questions"][:2])
        good = next((r for r in ia["questions"] if r["id"] != trap and r["seen"] >= 6), None)
        check("a normal question has positive discrimination", good is not None and (good["discrimination"] or 0) > 0.5, good)
        check("picks count every answer", trap_row is not None and sum(trap_row["picks"].values()) + trap_row["blank"] == trap_row["seen"], trap_row)
        course_id = sql("SELECT course_id FROM quizzes WHERE id=?", (plain["id"],))[0][0]
        if course_id:
            code, ca = call("GET", f"/admin/courses/{course_id}/item-analysis", token=staff)
            check("course-wide item analysis responds", code == 200 and ca["attempts"] >= ia["attempts"], (code, ca if code != 200 else ca["attempts"]))
        code, body = call("GET", f"/admin/quizzes/{plain['id']}/item-analysis", token=a)
        check("players cannot read item analysis", code in (401, 403), code)

        print("new exams shuffle options by default")
        code, created = call("POST", "/admin/quizzes", {"title": "Integrity default check", "duration_minutes": 10, "course_id": course_id}, token=staff)
        check("new exam has shuffle_options on", code in (200, 201) and created.get("shuffle_options") is True, (code, created))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        for suffix in ("", "-wal", "-shm"):
            try:
                os.remove(f"{DB_FILE}{suffix}")
            except OSError:
                pass
    print(f"\n{PASSED} passed, {FAILED} failed")
    return 1 if FAILED else 0


if __name__ == "__main__":
    raise SystemExit(main())
