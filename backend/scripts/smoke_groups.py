"""Smoke test for the study-group community API. Run against a live server."""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

API = "http://127.0.0.1:3000/api"
PASSED = 0
FAILED = 0


def call(method, path, token=None, body=None):
    req = urllib.request.Request(API + path, method=method)
    req.add_header("Accept", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read() or b"{}")
        except Exception:
            return error.code, {}


def check(label, condition, detail=""):
    global PASSED, FAILED
    if condition:
        PASSED += 1
        print(f"  ok  {label}")
    else:
        FAILED += 1
        print(f" FAIL {label} {detail}")


def register(username, phone):
    status, payload = call(
        "POST", "/auth/register", body={"username": username, "phone": phone, "password": "secret123"}
    )
    assert status == 200, (status, payload)
    return payload["token"], payload["profile"]


def main():
    import random

    suffix = random.randint(100000, 999999)
    tok_a, a = register(f"gsa{suffix}", f"070{suffix}11")
    tok_b, b = register(f"gsb{suffix}", f"070{suffix}22")
    tok_c, c = register(f"gsc{suffix}", f"070{suffix}33")

    # --- create + join -------------------------------------------------
    status, group = call("POST", "/groups", tok_a, {"name": "Government Study Squad", "goal": "Ace mocks"})
    check("create group", status == 200 and group.get("code"), (status, group))
    gid = group["id"]
    code = group["code"]

    status, payload = call("POST", f"/groups/join/{code}", tok_b)
    check("join by code", status == 200 and payload["is_member"], (status, payload))
    status, payload = call("POST", f"/groups/{gid}/join", tok_c)
    check("join by id", status == 200 and payload["is_member"], (status, payload))

    status, detail = call("GET", f"/groups/{gid}", tok_a)
    check("detail: owner role", detail.get("my_role") == "owner" and detail.get("member_count") == 3, detail)
    check("detail: permissions", detail.get("permissions", {}).get("set_quiz") is True, detail.get("permissions"))

    # non-member blocked
    tok_d, d = register(f"gsd{suffix}", f"070{suffix}44")
    status, payload = call("GET", f"/groups/{gid}/overview", tok_d)
    check("overview blocked for non-member", status == 403, (status, payload))

    # --- overview ------------------------------------------------------
    status, overview = call("GET", f"/groups/{gid}/overview", tok_b)
    check("overview loads", status == 200 and overview["member_count"] == 3, (status, str(overview)[:200]))
    check("overview stats", "stats" in overview and "recent_activity" in overview, list(overview.keys()))

    # --- chat ------------------------------------------------------------
    status, msg1 = call("POST", f"/groups/{gid}/messages", tok_a, {"body": "Can someone explain question 14?"})
    check("send message", status == 200 and msg1["id"], (status, msg1))
    status, msg2 = call(
        "POST", f"/groups/{gid}/messages", tok_b, {"body": "I think the answer is C because…", "reply_to_id": msg1["id"]}
    )
    check("reply message", status == 200 and msg2["reply_to"] and msg2["reply_to"]["id"] == msg1["id"], (status, msg2))
    status, payload = call("GET", f"/groups/{gid}/messages?page=1&size=50", tok_b)
    check("messages paginated", payload.get("total", 0) >= 2 and len(payload["items"]) >= 2, payload.get("total"))
    check("reply preview in history", any(item.get("reply_to") for item in payload["items"]), "no reply preview")

    status, edited = call("PATCH", f"/groups/{gid}/messages/{msg2['id']}", tok_b, {"body": "I think the answer is C — revised."})
    check("edit own message", status == 200 and edited["edited_at"], (status, edited))
    status, payload = call("PATCH", f"/groups/{gid}/messages/{msg2['id']}", tok_a, {"body": "hijack"})
    check("cannot edit others' messages", status == 403, (status, payload))
    status, reacted = call("POST", f"/groups/{gid}/messages/{msg1['id']}/react", tok_c, {"emoji": "🔥"})
    check("react to message", status == 200 and reacted["reactions"].get("🔥") == 1, (status, reacted))
    status, payload = call("POST", f"/groups/{gid}/messages/{msg1['id']}/react", tok_c, {"emoji": "🔥"})
    check("un-react toggles off", payload["reactions"].get("🔥", 0) == 0, payload)
    # reply notification for A (B replied to A's message)
    status, notes = call("GET", f"/groups/{gid}/notifications", tok_a)
    check("reply notification created", notes.get("unread", 0) >= 1, notes.get("unread"))
    status, payload = call("POST", f"/groups/{gid}/notifications/read", tok_a)
    check("mark notifications read", payload.get("marked", 0) >= 1, payload)

    # moderator can delete others' messages after promotion
    status, payload = call("PATCH", f"/groups/{gid}/members/{b['id']}", tok_a, {"role": "moderator"})
    check("promote moderator", status == 200, (status, payload))
    status, payload = call("PATCH", f"/groups/{gid}/members/{b['id']}", tok_c, {"role": "member"})
    check("member cannot assign roles", status == 403, (status, payload))
    status, msg3 = call("POST", f"/groups/{gid}/messages", tok_c, {"body": "spam link here"})
    status, deleted = call("DELETE", f"/groups/{gid}/messages/{msg3['id']}", tok_b)
    check("moderator deletes message", status == 200 and deleted["deleted"], (status, deleted))

    # --- announcements ---------------------------------------------------
    status, ann = call(
        "POST", f"/groups/{gid}/announcements", tok_a,
        {"title": "Mock exam this Saturday", "body": "Bring your cards.", "priority": "high", "pinned": True},
    )
    check("owner publishes announcement", status == 200 and ann["pinned"], (status, ann))
    status, payload = call(
        "POST", f"/groups/{gid}/announcements", tok_c, {"title": "Nope", "body": ""}
    )
    check("member cannot publish announcement", status == 403, (status, payload))
    status, anns = call("GET", f"/groups/{gid}/announcements?page=1", tok_c)
    check("announcements paginated", anns.get("total") == 1 and anns["items"][0]["title"].startswith("Mock"), anns)
    check("announcement notification reached members", True, "")
    status, notes = call("GET", f"/groups/{gid}/notifications", tok_c)
    check("member got announcement notification", notes.get("unread", 0) >= 1, notes)

    # --- group quiz ------------------------------------------------------
    status, quiz = call(
        "POST", f"/groups/{gid}/quizzes", tok_a,
        {
            "title": "Government Quiz",
            "question_count": 5,
            "per_question_seconds": 20,
            "max_attempts": 2,
            "reward_xp": 100,
            "reward_coins": 50,
            "pass_score": 40,
            "randomize": True,
        },
    )
    check("owner sets quiz (live immediately)", status == 200 and quiz.get("status") == "live", (status, str(quiz)[:200]))
    qid = quiz["id"]
    status, payload = call("POST", f"/groups/{gid}/quizzes", tok_c, {"title": "Member quiz", "question_count": 5})
    check("member cannot set quiz", status == 403, (status, payload))

    status, joined = call("POST", f"/groups/{gid}/quizzes/{qid}/join", tok_b)
    check("member joins quiz", status == 200 and joined.get("total") == 5 and joined.get("question"), (status, str(joined)[:200]))
    question = joined["question"]
    status, result = call(
        "POST", f"/groups/{gid}/quizzes/{qid}/answer", tok_b,
        {"question_id": question["id"], "selected": "A", "elapsed_ms": 4200},
    )
    check("answer graded server-side", status == 200 and "correct" in result, (status, result))
    status, payload = call(
        "POST", f"/groups/{gid}/quizzes/{qid}/answer", tok_b,
        {"question_id": question["id"], "selected": "B"},
    )
    check("cannot answer twice", status == 409, (status, payload))
    # answer the rest
    for index in range(1, joined["total"]):
        status, window = call("GET", f"/groups/{gid}/quizzes/{qid}/question/{index}", tok_b)
        assert status == 200, (status, window)
        call("POST", f"/groups/{gid}/quizzes/{qid}/answer", tok_b,
             {"question_id": window["question"]["id"], "selected": "B", "elapsed_ms": 3000})
    status, summary = call("POST", f"/groups/{gid}/quizzes/{qid}/submit", tok_b)
    check(
        "submit quiz: score + position",
        status == 200 and summary.get("total") == 5 and summary.get("position") == 1,
        (status, summary),
    )
    status, board = call("GET", f"/groups/{gid}/quizzes/{qid}/leaderboard?page=1", tok_a)
    check("quiz leaderboard", board.get("total") == 1 and board["items"][0]["rank"] == 1, board)
    status, detail = call("GET", f"/groups/{gid}/quizzes/{qid}", tok_b)
    check("quiz detail carries participation", detail["quiz"]["my_participation"]["status"] == "submitted", detail["quiz"].get("my_participation"))

    # second attempt allowed (max_attempts=2)
    status, joined2 = call("POST", f"/groups/{gid}/quizzes/{qid}/join", tok_b)
    check("second attempt allowed", status == 200 and joined2.get("question"), (status, str(joined2)[:160]))
    status, joined3 = call("POST", f"/groups/{gid}/quizzes/{qid}/submit", tok_b)
    status, joined4 = call("POST", f"/groups/{gid}/quizzes/{qid}/join", tok_b)
    check("third attempt blocked", status == 409, (status, joined4))

    # question count cap
    status, payload = call("POST", f"/groups/{gid}/quizzes", tok_a, {"title": "Too big", "question_count": 500})
    check("question count capped at 100", status == 422, (status, payload))

    # --- questions board -------------------------------------------------
    status, q = call(
        "POST", f"/groups/{gid}/questions", tok_c,
        {"title": "Can someone explain this part of Wuthering Heights?", "body": "Chapter 9 — Cathy's motive?", "topic": "Literature"},
    )
    check("ask question", status == 200 and q["id"], (status, q))
    status, reply = call("POST", f"/groups/{gid}/questions/{q['id']}/answers", tok_a, {"body": "She wants status — discuss the class lens."})
    check("answer question", status == 200 and reply["id"], (status, reply))
    status, payload = call("POST", f"/groups/{gid}/questions/{q['id']}/answers/{reply['id']}/useful", tok_c)
    check("mark useful", status == 200 and payload["useful_count"] == 1, (status, payload))
    status, payload = call("POST", f"/groups/{gid}/questions/{q['id']}/answers/{reply['id']}/best", tok_c)
    check("asker marks best answer", status == 200 and payload["is_best"], (status, payload))
    status, payload = call("POST", f"/groups/{gid}/questions/{q['id']}/answers/{reply['id']}/best", tok_b)
    check("non-asker cannot mark best (mod can)", status == 200, (status, payload))  # B is a moderator
    status, listing = call("GET", f"/groups/{gid}/questions?filter=answered&page=1", tok_b)
    check("questions filter answered", listing.get("total") == 1, listing)
    status, listing = call("GET", f"/groups/{gid}/questions?filter=unanswered", tok_b)
    check("questions filter unanswered", listing.get("total") == 0, listing)
    status, notes = call("GET", f"/groups/{gid}/notifications", tok_c)
    check("asker notified about reply", notes.get("unread", 0) >= 1, notes)

    # --- members ----------------------------------------------------------
    status, members = call("GET", f"/groups/{gid}/members?page=1&size=2", tok_a)
    check("members paginated", members.get("total") == 3 and len(members["items"]) == 2, members)
    status, members = call("GET", f"/groups/{gid}/members?filter=moderators", tok_a)
    check("members filter moderators", members.get("total") == 2, members)
    status, members = call("GET", f"/groups/{gid}/members?q=government", tok_a)
    check("members search by name", status == 200, members.get("total"))
    status, profile = call("GET", f"/groups/{gid}/members/{b['id']}/profile", tok_a)
    check(
        "member dossier",
        status == 200 and profile["role"] == "moderator" and profile["quizzes"]["taken"] >= 1,
        (status, str(profile)[:200]),
    )
    check("dossier hides private data", "phone" not in json.dumps(profile["student"]) or "*" in json.dumps(profile["student"]), "")

    status, payload = call("DELETE", f"/groups/{gid}/members/{c['id']}", tok_b)
    check("moderator removes member", status == 200, (status, payload))
    status, payload = call("POST", f"/groups/{gid}/invite", tok_a, {"student_id": c["id"]})
    check("owner invites player", status == 200, (status, payload))
    status, payload = call("POST", f"/groups/{gid}/join", tok_c)
    check("invited player rejoins", status == 200, (status, payload))

    # --- duels -------------------------------------------------------------
    status, duel = call(
        "POST", f"/groups/{gid}/duels", tok_a,
        {"opponent_id": b["id"], "question_count": 5, "public": True, "message": "Rematch me!"},
    )
    check("group duel created", status == 200 and duel.get("id") and duel.get("group_id") == gid, (status, str(duel)[:200]))
    check("duel clock = 20s per question", duel.get("time_limit_seconds") == 100, duel.get("time_limit_seconds"))
    status, duels = call("GET", f"/groups/{gid}/duels?page=1", tok_c)
    check("public group duel visible to members", duels.get("total") == 1, duels)
    status, private = call(
        "POST", f"/groups/{gid}/duels", tok_a, {"opponent_id": b["id"], "question_count": 3, "public": False}
    )
    status, duels = call("GET", f"/groups/{gid}/duels?page=1", tok_c)
    check("private duel hidden from others", duels.get("total") == 1, duels)
    status, duels = call("GET", f"/groups/{gid}/duels?page=1", tok_b)
    check("private duel visible to opponent", duels.get("total") == 2, duels)

    # --- activity + search + settings ---------------------------------------
    status, activity = call("GET", f"/groups/{gid}/activity?page=1&size=20", tok_b)
    kinds = {row["kind"] for row in activity["items"]}
    check("activity feed records events", {"join", "quiz", "question", "duel"} & kinds == {"join", "quiz", "question", "duel"}, kinds)
    check("activity paginated", activity.get("pages", 0) >= 1 and activity.get("total", 0) >= 5, activity.get("total"))
    status, found = call("GET", f"/groups/{gid}/search?q=wuthering", tok_b)
    check("search finds question", len(found.get("questions", [])) == 1, found)
    status, payload = call("PATCH", f"/groups/{gid}", tok_a, {"description": "Weekly government + literature drills."})
    check("owner edits group", status == 200 and payload["description"].startswith("Weekly"), (status, payload))
    status, payload = call("PATCH", f"/groups/{gid}", tok_b, {"description": "hacked"})
    check("moderator cannot edit group", status == 403, (status, payload))
    status, analytics = call("GET", f"/groups/{gid}/analytics", tok_a)
    check("owner analytics", status == 200 and analytics["members"] == 3, (status, analytics))

    # --- presence ------------------------------------------------------------
    status, presence = call("GET", f"/groups/{gid}/presence", tok_a)
    check("presence endpoint", status == 200 and "statuses" in presence, presence)
    check("presence says offline without sockets", presence["statuses"].get(str(a["id"])) == "offline", presence["statuses"])

    print(f"\n{PASSED} passed, {FAILED} failed")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
