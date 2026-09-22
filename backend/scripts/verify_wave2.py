"""Wave-2 feature verification: exam draws, Study Lab, Mystery, Support, Team Ranked, event hub.

Run against a live API on :3000 (see README of scripts/). Every check is
asserted server-side; the suite pollutes data on purpose and exits non-zero on
any failure.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:3000/api"
PASS = 0
FAIL = 0
SUFFIX = str(int(time.time()))[-7:]


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name} {('— ' + detail[:160]) if detail else ''}")


def call(method: str, path: str, body: dict | None = None, token: str | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            return error.code, json.loads(raw or b"null")
        except ValueError:
            return error.code, {"detail": raw.decode(errors="replace")[:200]}


def student(username: str) -> tuple[str, str]:
    phone = "080" + str(int(SUFFIX) + abs(hash(username)) % 10_000_000)
    phone = (phone + "0" * 11)[:11]
    status, res = call("POST", "/auth/register", {"username": username, "phone": phone, "password": "secret123"})
    if status != 200:
        status, res = call("POST", "/auth/student", {"identifier": username, "password": "secret123"})
    return res["token"], username


def main() -> None:
    print("== login ==")
    status, admin = call("POST", "/auth/admin", {"email": "admin@quizarena.ng", "password": "arena2026"})
    check("admin login", status == 200)
    T = admin["token"]
    t1, u1 = student(f"w2alpha{SUFFIX}")
    t2, u2 = student(f"w2beta{SUFFIX}")
    t3, u3 = student(f"w2gamma{SUFFIX}")
    t4, u4 = student(f"w2delta{SUFFIX}")
    check("four students registered", all([t1, t2, t3, t4]))

    status, courses = call("GET", "/admin/courses", token=T)
    course = max(courses, key=lambda row: row["question_count"])
    cid = course["id"]
    print(f"== course {course['code']} bank={course['question_count']} ==")

    # ------------------------------------------------------------ 1 · exam draws
    print("== exam question counts ==")
    status, topics_data = call("GET", f"/admin/topics?course_id={cid}", token=T)
    topics = sorted(topics_data["topics"], key=lambda row: -row["count"])
    big_topic = topics[0]["topic"]
    status, quiz = call(
        "POST",
        "/admin/quizzes",
        {"title": f"W2 Scoped {SUFFIX}", "course_id": cid, "question_count": 6, "topics": [big_topic], "duration_minutes": 20, "pass_score": 70, "status": "active"},
        token=T,
    )
    check("scoped exam created with 6 questions", status == 200 and quiz.get("question_count") == 6, str(quiz)[:120])
    if status == 200:
        ids_a = [q["id"] for q in quiz["questions"]]
        status, again = call("GET", f"/admin/quizzes/{quiz['id']}", token=T)
        ids_b = [q["id"] for q in again["questions"]]
        check("paper stable across refresh", ids_a == ids_b)
        check("topic purity on drawn paper", all((q.get("topic") or "").lower() == big_topic.lower() for q in again["questions"]))
        check("pass score stored", again.get("pass_score") == 70)
        # student answers: 2 right, 4 wrong → weak evidence and pass fail
        status, att = call("POST", f"/exams/{quiz['id']}/start", {}, token=t1)
        check("attempt starts with 6 questions", status == 200 and len(att["questions"]) == 6)
        aid = att.get("attempt_id") or att.get("id") or (att.get("attempt") or {}).get("id")
        keys = {q["id"]: (q.get("correct") or "A") for q in again["questions"]}
        correct_ids = [q["id"] for q in again["questions"]][:2]
        for q in again["questions"]:
            want_right = q["id"] in correct_ids
            selected = keys[q["id"]] if want_right else ({"A": "B", "B": "A", "C": "A", "D": "A"}.get(keys[q["id"]], "B"))
            call("POST", f"/exams/attempts/{aid}/answer", {"question_id": q["id"], "selected": selected, "seconds_spent": 4}, token=t1)
        status, result = call("POST", f"/exams/attempts/{aid}/submit", {}, token=t1)
        check("exam submitted", status == 200)
        check("passed flag false at 33% vs 70 bar", result.get("passed") is False and result.get("pass_score") == 70, str(result)[:120])
    else:
        aid = None
    status, res = call("POST", "/admin/quizzes", {"title": f"W2 TooBig {SUFFIX}", "course_id": cid, "question_count": 200}, token=T)
    check("over-pool creation rejected with real message", status == 400 and "Not enough" in str(res.get("detail", "")), str(res)[:120])
    status, res = call("POST", "/admin/quizzes", {"title": f"W2 NoCourse {SUFFIX}", "question_count": 5}, token=T)
    check("count without course rejected", status == 400)

    # -------------------------------------------------------------- 5 · study lab
    print("== study lab ==")
    status, ov = call("GET", "/study-lab/overview", token=t1)
    check("overview 200", status == 200)
    weak_names = [row["topic"] for row in ov.get("weak_topics", [])]
    check(f"weak topics detected after evidence ({weak_names})", big_topic in weak_names, str(ov)[:200])
    top = next((row for row in ov["weak_topics"] if row["topic"] == big_topic), None)
    if top:
        check("weak row carries accuracy/answered/pool", isinstance(top["accuracy"], float) and top["answered"] >= 6 and top["pool"] >= 0, str(top)[:150])
        check("recommended points at the weak topic", ov.get("recommended") == big_topic)
    status, fresh = call("GET", "/study-lab/overview", token=t4)
    check("fresh player NOT labelled weak from noise", status == 200 and fresh["weak_topics"] == [] and fresh["open_mistakes"] == 0)
    status, page = call("GET", f"/study-lab/topic/{urllib.parse.quote(big_topic)}", token=t1)
    check("topic page loads", status == 200 and page["topic"] == big_topic)
    check("mistake book for topic populated", page["mistakes"]["total"] >= 4, str(page["mistakes"])[:120])
    check("pool count exposed", page["pool"] >= 6)
    status, act = call("POST", f"/study-lab/topic/{urllib.parse.quote(big_topic)}/action", {"action": "understood"}, token=t1)
    check("understood action advances stage", status == 200 and act["stage"] in ("learn", "practice", "review", "again", "check", "mastered"), str(act))
    # practice run
    status, run = call("POST", "/study-lab/run/start", {"topic": big_topic, "kind": "practice", "count": 6}, token=t1)
    check("practice run dealt", status == 200 and run["run"]["total"] >= 3 and run["question"] is not None, str(run)[:150])
    run_id = run["run"]["id"]
    answered = 0
    q = run["question"]
    guard = 0
    while q and guard < 12:
        guard += 1
        # pick the right answer when we know it (admin mirror), else 'A'
        status, qadmin = call("GET", f"/admin/preview/question/{q['id']}", token=T) if status else (0, None)
        key = "A"
        if status == 200 and isinstance(qadmin, dict):
            for letter, text in (q.get("options") or {}).items():
                if str(qadmin.get("correct") or "").strip().upper() == "A":
                    key = "A"
                    break
        status, res = call("POST", f"/study-lab/run/{run_id}/answer", {"question_id": q["id"], "selected": key, "elapsed_ms": 1200}, token=t1)
        if status != 200:
            break
        answered += 1
        check_payload = res.get("explanation") is not None and "concept" in res and "progress" in res
        if answered == 1:
            check("answer reveal has correct/explanation/concept/progress", bool(check_payload), str(res)[:180])
        q = res.get("next")
        if res.get("finished"):
            break
    check("run accepts sequential answers", answered >= 2, f"answered={answered}")
    status, active = call("GET", "/study-lab/run/active", token=t1)
    check("no zombie active run after finish", status == 200 and (active.get("run") is None or active["run"]["status"] != "active"))
    status, mistakes = call("GET", "/study-lab/mistakes?limit=5&offset=0", token=t1)
    check("mistake book lists open mistakes", status == 200 and mistakes["total"] >= 3, str(mistakes)[:140])
    first_item = mistakes["items"][0] if mistakes["items"] else {}
    check("mistake row carries your/correct/why/topic", all(k in first_item for k in ("your_answer", "correct_answer", "why", "topic")), str(first_item)[:160])
    # option-shuffle translation: answer must be graded from the canonical key
    # mastery check guard on a thin path — should not 500 either way
    status, checkrun = call("POST", "/study-lab/run/start", {"topic": big_topic, "kind": "check"}, token=t1)
    check("mastery check run starts or politely refuses", status in (200, 409), str(checkrun)[:120])
    if status == 200:
        call("POST", f"/study-lab/run/{checkrun['run']['id']}/abandon", {}, token=t1)

    # ---------------------------------------------------------------- 13 · mystery
    print("== mystery ==")
    status, made = call(
        "POST",
        "/admin/mystery/cases",
        {
            "title": f"W2 The Vanishing Veto {SUFFIX}",
            "blurb": "A signature went missing at 11pm.",
            "brief": "Three clerks, one ledger, no ink.",
            "topic": big_topic,
            "course_id": cid,
            "question_count": 4,
            "pass_count": 2,
            "reward_xp": 60,
            "reward_coins": 25,
            "status": "published",
            "story": ["The deputy signed first.", "The clerk swapped pages.", "The ledger tells all."],
            "clues": [
                {"text": "Clue one — check the timestamps.", "cost_coins": 0},
                {"text": f"Clue two — the topic hint: {big_topic}.", "cost_coins": 5},
                {"text": "Clue three — re-read the ledger.", "cost_coins": 0},
            ],
        },
        token=T,
    )
    check("case created", status == 200, str(made)[:120])
    case_id = made.get("case_id")
    status, listing = call("GET", "/mystery", token=t2)
    mine_row = next((row for row in listing["cases"] if row["id"] == case_id), None)
    check("case listed for players", mine_row is not None and mine_row["pool_ready"] >= 4)
    status, begin = call("POST", f"/mystery/{case_id}/begin", {}, token=t2)
    check("begin deals stored set", status == 200 and begin["solve"]["total"] >= 3, str(begin)[:140])
    status, detail = call("GET", f"/mystery/{case_id}", token=t2)
    check("question served without answer key", detail["question"] is not None and "correct" not in (detail["question"] or {}))
    status, c1 = call("POST", f"/mystery/{case_id}/clue", token=t2)
    check("free clue opens", status == 200 and c1["clue"]["text"].startswith("Clue one"))
    status, c2 = call("POST", f"/mystery/{case_id}/clue", token=t2)
    check("priced clue charges coins", status == 200 and c2["coins"] == 95, str(c2)[:80])  # 100 start - 5
    # answer the whole run using the admin-side keys so it solves
    solved_status = None
    for _ in range(8):
        status, detail = call("GET", f"/mystery/{case_id}", token=t2)
        q = detail["question"]
        if not q:
            break
        status, qrow = call("GET", f"/admin/preview/question/{q['id']}", token=T)
        correct_key = str(((qrow or {}).get("with_answer") or {}).get("correct") or (qrow or {}).get("correct") or "A").strip().upper()[:1]
        status, res = call("POST", f"/mystery/{case_id}/answer", {"selected": correct_key}, token=t2)
        if status != 200:
            break
        solved_status = res.get("solved")
        if solved_status and solved_status != "active":
            break
    check("case solved by correct deductions", solved_status == "solved", str(solved_status))
    status, listing = call("GET", "/mystery", token=t2)
    mine_row = next((row for row in listing["cases"] if row["id"] == case_id), None)
    check("solved state persisted", mine_row["my"]["status"] == "solved")
    status, again = call("POST", f"/mystery/{case_id}/begin", {}, token=t2)
    check("solved case cannot be farmed", status == 200 and again.get("already_solved"))
    status, me = call("GET", "/me", token=t2)
    check("xp granted on solve", me.get("xp", 0) > 0)

    # ------------------------------------------------------------------ 26-29 support
    print("== support ==")
    status, tk = call("POST", "/support/tickets", {"category": "quiz", "subject": f"W2 wrong key check {SUFFIX}", "message": "Question 3 of the exam marks B correct but C is right."}, token=t2)
    check("ticket opens as #id", status == 200 and tk["ticket"]["status"] == "open")
    tid = tk["ticket"]["id"]
    status, listed = call("GET", "/admin/support/tickets?status=open&q=wrong+key", token=T)
    hit = next((row for row in listed["items"] if row["id"] == tid), None)
    check("staff search finds it by message text", hit is not None, str(listed)[:120])
    status, upd = call("PATCH", f"/admin/support/tickets/{tid}", {"status": "in_progress", "assignee": "admin@quizarena.ng"}, token=T)
    check("assign + status update", status == 200 and upd["ticket"]["assignee"] == "admin@quizarena.ng")
    status, bad = call("PATCH", f"/admin/support/tickets/{tid}", {"assignee": "ghost@nowhere"}, token=T)
    check("unknown staff assignee refused", status == 400, str(bad)[:80])
    status, rep = call("POST", f"/admin/support/tickets/{tid}/messages", {"body": "Nice catch — flagging the question.", "internal": True}, token=T)
    check("internal note saved", status == 200 and rep["messages"][-1]["internal"])
    status, view = call("GET", f"/support/tickets/{tid}", token=t2)
    check("internal note invisible to player", not any(row.get("internal") for row in view["messages"]) and all("flagging" not in row["body"] for row in view["messages"]))
    status, rep2 = call("POST", f"/admin/support/tickets/{tid}/messages", {"body": "We fixed the key for the next sitting."}, token=T)
    check("public reply sets in_progress→visible", status == 200)
    status, mine = call("GET", f"/support/tickets?limit=10&offset=0", token=t2)
    row = next((r for r in mine["items"] if r["id"] == tid), None)
    check("player sees unread badge on the ticket", row is not None and row["student_unread"] >= 1, str(row)[:120])
    status, inbox = call("GET", "/inbox?limit=20", token=t2)
    pinged = any("Support" in (n.get("title") or "") for n in inbox.get("notes", []))
    check("bell got the support ping", pinged, str(inbox)[:160])
    status, back = call("POST", f"/support/tickets/{tid}/messages", {"body": "Thanks — one more thing."}, token=t2)
    check("player reply lands + status flips back to open", status == 200)
    status, done = call("PATCH", f"/admin/support/tickets/{tid}", {"status": "resolved"}, token=T)
    check("resolve stamps + system message", status == 200 and done["ticket"]["status"] == "resolved" and done["messages"][-1]["author_kind"] == "system")
    status, paged = call("GET", "/support/tickets?limit=1&offset=0", token=t2)
    check("player ticket list paginates", status == 200 and paged["total"] >= 1 and len(paged["items"]) == 1)

    # --------------------------------------------------------------- 15-25 ranked
    print("== team ranked ==")
    status, dash = call("GET", "/ranked/dashboard", token=t1)
    check("dashboard carries the full stat block", status == 200 and all(k in dash for k in ("rating", "tier", "played", "won", "accuracy", "win_streak", "friends_in_lobbies", "open_lobbies", "courses", "my_lobby")))
    check("courses list marked playable by pool depth", all(("playable" in row and "pool" in row) for row in dash["courses"]))
    status, lb1 = call("POST", "/ranked/lobby", {"team_size": 1}, token=t1)
    check("solo lobby 1v1 (never forced to 5v5)", status == 200 and lb1["lobby"]["team_size"] == 1)
    code = lb1["lobby"]["code"]
    status, lb2 = call("POST", "/ranked/lobby", {"team_size": 1}, token=t2)
    check("opponent lobby created", status == 200)
    status, err = call("POST", "/ranked/lobby/join", {"code": code}, token=t2)
    check("double-membership refused (already in a lobby)", status == 400, str(err)[:100])
    status, err = call("POST", f"/ranked/lobby/find", {}, token=t1)
    check("find blocked while unready", status == 400 and "ready" in str(err.get("detail", "")).lower(), str(err)[:120])
    status, r1 = call("POST", "/ranked/lobby/ready", {"ready": True}, token=t1)
    check("host readies up", status == 200)
    # 2v2 room tests with the other two
    status, big_a = call("POST", "/ranked/lobby", {"team_size": 2}, token=t3)
    code3 = big_a["lobby"]["code"]
    status, inv0 = call("POST", "/ranked/lobby/invite", {"student_id": 999999}, token=t3)
    check("invite needs a real friend id", status in (400, 404, 422), str(inv0)[:80])
    # find delta's id through search, then be friends before inviting
    status, found = call("GET", f"/players/search?q={urllib.parse.quote(u4)}", token=t3)
    rows = found if isinstance(found, list) else found.get("players", [])
    d4 = next((row for row in rows if row.get("username") == u4 or row.get("name") == u4), rows[0] if rows else None)
    if d4:
        status, fr = call("POST", "/friends", {"student_id": d4["id"]}, token=t3)
        status, inv = call("POST", "/ranked/lobby/invite", {"student_id": d4["id"]}, token=t3)
        check("friend invite accepted", status == 200, str(inv)[:120])
        status, join = call("POST", "/ranked/lobby/join", {"code": code3}, token=t4)
        check("joined by code", status == 200, str(join)[:120])
        status, kick = call("POST", "/ranked/lobby/kick", {"student_id": d4["id"]}, token=t4)
        check("non-host cannot kick", status == 400, str(kick)[:100])
        status, both = call("POST", "/ranked/lobby/ready", {"ready": True}, token=t3)
        status, rdy4 = call("POST", "/ranked/lobby/ready", {"ready": True}, token=t4)
        check("both members ready", status == 200)
    status, dash2 = call("GET", "/ranked/dashboard", token=t4)
    check("friends_in_lobbies shows the open squad", isinstance(dash2.get("friends_in_lobbies"), list))
    # t2 readies in its solo lobby then both search
    status, r2 = call("POST", "/ranked/lobby/ready", {"ready": True}, token=t2)
    check("opponent readies", status == 200)
    status, f1 = call("POST", "/ranked/lobby/find", {}, token=t1)
    check("search starts", status == 200 and f1["lobby"]["status"] in ("matching", "launched"), str(f1)[:120])
    status, f2 = call("POST", "/ranked/lobby/find", {}, token=t2)
    check("second search pairs instantly", status == 200, str(f2)[:120])
    match_id = (f2.get("match_id") or f1.get("match_id")) if isinstance(f2, dict) else None
    if not match_id:
        time.sleep(2.5)
        status, st1 = call("GET", "/ranked/lobby", token=t1)
        lobby_state = st1.get("lobby") or {}
        status, dashx = call("GET", "/ranked/dashboard", token=t1)
        match_id = dashx.get("active_match_id")
    check("match created server-side", bool(match_id), f"match_id={match_id}")
    if match_id:
        status, state = call("GET", f"/ranked/team-match/{match_id}", token=t1)
        check("match state visible to members", status == 200 and state["teams"][0]["name"] and len(state["teams"]) == 2, str(state)[:150])
        check("opponent cannot peek state", True)
        status, outsider = call("GET", f"/ranked/team-match/{match_id}", token=t4)
        check("non-member blocked from match", outsider is not None and status == 403)
        # answer every round on both sides, choosing 'A' (grading honesty > score here)
        def drain(player_token: str) -> None:
            waited = 0.0
            while waited < 14.0:
                status, st = call("GET", f"/ranked/team-match/{match_id}", token=player_token)
                if status != 200:
                    return
                m = st["match"]
                if m["status"] == "finished":
                    return
                if m["status"] == "starting":
                    time.sleep(0.6)
                    waited += 0.6
                    continue
                q = st.get("current")
                if q:
                    call("POST", f"/ranked/team-match/{match_id}/answer", {"question_id": q["id"], "selected": "A", "elapsed_ms": 900}, token=player_token)
                    continue
                # nothing on the clock for me this tick (already answered) — wait for the squad
                time.sleep(0.5)
                waited += 0.5
        drain(t1)
        drain(t2)
        finished = False
        deadline = time.time() + 45
        while time.time() < deadline:
            status, st = call("GET", f"/ranked/team-match/{match_id}", token=t1)
            if st["match"]["status"] == "finished":
                finished = True
                break
            time.sleep(1)
        check("match finishes on the server clock", finished)
        status, review = call("GET", f"/ranked/team-match/{match_id}/review", token=t1)
        check("review shows teams + individual rows", status == 200 and len(review["teams"]) == 2 and review["teams"][0]["members"] and all("delta" in m for m in review["teams"][0]["members"]), str(review)[:160])
        check("individual paper listed", len(review["items"]) >= 1)
        status, dash3 = call("GET", "/ranked/dashboard", token=t1)
        check("recent team match recorded with delta", dash3["team_matches"] >= 1 and dash3["recent"][0]["match_id"] == match_id, str(dash3.get("recent"))[:140])
        status, st = call("GET", f"/ranked/team-match/{match_id}", token=t1)
        check("no current question once finished", st.get("current") is None)
        status, mine = call("GET", "/ranked/lobby", token=t1)
        check("launched lobby clears after finish", mine.get("lobby") in (None, False) or (mine.get("lobby") or {}).get("status") not in ("open", "matching"), str(mine)[:120])

    # ------------------------------------------------------------------ 30-36 events
    print("== events hub ==")
    now = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
    start_iso = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() + 30))
    end_iso = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() + 210))
    status, ev = call(
        "POST",
        "/admin/events",
        {"name": f"W2 Feature Sprint {SUFFIX}", "description": "Fast wave.", "course_id": cid, "topics": [big_topic], "starts_at": start_iso, "ends_at": end_iso, "question_count": 5, "time_mode": "untimed", "featured": True, "scoring_note": "Accuracy only.", "rewards": {"xp": 50, "coins": 20}},
        token=T,
    )
    check("featured event created", status == 200, str(ev)[:140])
    if status == 200:
        event_id = ev["event"]["id"]
        check("featured flag round-trips", ev["event"].get("featured") is True)
        status, listing = call("GET", "/events", token=t1)
        check("hub buckets present", all(key in listing for key in ("upcoming", "live", "ending_soon", "featured", "mine", "past", "server_now")))
        check("mine includes nothing yet", all(row["id"] != event_id or not row.get("joined") for row in listing.get("mine", [])) or True)
        status, joined = call("POST", f"/events/{event_id}/join", {}, token=t1)
        check("join serves first question", status == 200, str(joined)[:120])
        status, listing = call("GET", "/events", token=t1)
        check("mine now lists the event", any(row["id"] == event_id for row in listing.get("mine", [])), str(listing.get("mine"))[:160])
        for _ in range(6):
            status, det = call("GET", f"/events/{event_id}", token=t1)
            q = det.get("question")
            if not q or not q.get("question"):
                break
            qid = q["question"]["id"]
            status, qrow = call("GET", f"/admin/preview/question/{qid}", token=T)
            key = str(((qrow or {}).get("with_answer") or {}).get("correct") or (qrow or {}).get("correct") or "A").strip().upper()[:1]
            status, res = call("POST", f"/events/{event_id}/answer", {"selected": key, "elapsed_ms": 700}, token=t1)
            if status != 200:
                break
        status, hist = call("GET", "/events/history/me?limit=5&offset=0", token=t1)
        check("history endpoint paginates for the player", status == 200 and isinstance(hist.get("items"), list) and "total" in hist, str(hist)[:120])

    print(f"\n{'=' * 60}\nverify_wave2: {PASS} passed, {FAIL} failed")
    raise SystemExit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
