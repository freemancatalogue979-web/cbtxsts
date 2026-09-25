"""Seed a demo study group with known credentials for the live preview.

Creates one owner + several members, a group, chat (with a reply), a pinned
announcement, a Q&A thread, and both a live and a scheduled quiz — so opening
the workspace shows real content instead of empty states.

Login (student): username ``ada`` · password ``secret123``
Run against a live server:  .venv/bin/python scripts/seed_demo_group.py
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request

API = "http://127.0.0.1:3000/api"
PASSWORD = "secret123"


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


def register(username, phone, display=None):
    status, payload = call(
        "POST", "/auth/register", body={"username": username, "phone": phone, "password": PASSWORD, "display_name": display}
    )
    if status != 200:
        # Already exists from a previous seed — sign in instead.
        status, payload = call("POST", "/auth/student", body={"identifier": username, "password": PASSWORD})
    return payload["token"], payload.get("profile", {})


def main() -> None:
    people = [
        ("ada", "08030000001", "Ada Obi"),
        ("tunde", "08030000002", "Tunde Bakare"),
        ("zainab", "08030000003", "Zainab Yusuf"),
        ("musa", "08030000004", "Musa Danladi"),
        ("chloe", "08030000005", "Chloe Nwosu"),
        ("ife", "08030000006", "Ife Adeyemi"),
    ]
    tokens = {}
    for username, phone, display in people:
        token, profile = register(username, phone, display)
        tokens[username] = token
        print(f"  • {username} ({display}) -> id {profile.get('id')}")

    owner = tokens["ada"]

    status, group = call("POST", "/groups", owner, {
        "name": "Government Study Squad",
        "goal": "Ace the WAEC Government mocks",
        "description": "400L study circle — shared quizzes, duels, Q&A and weekly announcements.",
    })
    if status != 200:
        print("  ! could not create group:", status, group)
        return
    gid = group["id"]
    code = group["code"]
    print(f"  ✓ group #{gid} '{group['name']}' code {code}")

    for username in ("tunde", "zainab", "musa", "chloe", "ife"):
        call("POST", f"/groups/join/{code}", tokens[username])

    # Promote a moderator so the role chips and staff gating are visible.
    status, members = call("GET", f"/groups/{gid}/members?size=20", owner)
    for row in members.get("items", []):
        if row.get("name", "").startswith("Tunde"):
            call("PATCH", f"/groups/{gid}/members/{row['student_id']}", owner, {"role": "moderator"})

    # --- chat ------------------------------------------------------------
    _, m1 = call("POST", f"/groups/{gid}/messages", owner, {"body": "Evening everyone 👋 Mocks are in two weeks — let's run daily past questions."})
    call("POST", f"/groups/{gid}/messages", tokens["zainab"], {"body": "I'm in! Can we focus on constitutional development first?", "reply_to_id": m1.get("id")})
    call("POST", f"/groups/{gid}/messages", tokens["tunde"], {"body": "Sharing the 2019 WAEC set tonight. Who wants to duel after?"})
    call("POST", f"/groups/{gid}/messages", tokens["musa"], {"body": "Count me in ⚔️"})
    call("POST", f"/groups/{gid}/messages", tokens["chloe"], {"body": "Please explain 'separation of powers' simply 🙏"})
    _, m6 = call("POST", f"/groups/{gid}/messages", tokens["ife"], {"body": "Legislature makes laws, Executive implements, Judiciary interprets. That's the core."})
    call("POST", f"/groups/{gid}/messages/{m1.get('id')}/react", tokens["zainab"], {"emoji": "🔥"})
    call("POST", f"/groups/{gid}/messages/{m6.get('id')}/react", owner, {"emoji": "👏"})

    # --- announcements ---------------------------------------------------
    call("POST", f"/groups/{gid}/announcements", owner, {
        "title": "Mock exam moved to Friday 4pm",
        "body": "The school rescheduled the WAEC mock. We'll run a group quiz right after to debrief answers.",
        "priority": "high",
        "pinned": True,
    })
    call("POST", f"/groups/{gid}/announcements", tokens["tunde"], {
        "title": "Weekly study plan",
        "body": "Mon–Wed: past questions. Thu: duel night. Fri: group quiz + review.",
        "priority": "normal",
    })

    # --- questions -------------------------------------------------------
    _, q1 = call("POST", f"/groups/{gid}/questions", tokens["chloe"], {
        "title": "Difference between presidential and parliamentary systems?",
        "body": "I keep mixing up where executive power sits. Can someone break it down with Nigerian examples?",
        "topic": "Systems of Government",
    })
    _, a1 = call("POST", f"/groups/{gid}/questions/{q1.get('id')}/answers", tokens["ife"], {
        "body": "Presidential: the president is both head of state and government, elected separately from the legislature (e.g. Nigeria, USA). Parliamentary: the PM comes from the legislature and is accountable to it (e.g. UK, India).",
    })
    call("POST", f"/groups/{gid}/questions/{q1.get('id')}/answers/{a1.get('id')}/useful", tokens["chloe"])
    call("POST", f"/groups/{gid}/questions/{q1.get('id')}/answers/{a1.get('id')}/best", tokens["chloe"])
    call("POST", f"/groups/{gid}/questions", tokens["musa"], {
        "title": "Which courts have original jurisdiction over fundamental rights?",
        "body": "Is it only the Federal High Court, or can State High Courts hear them too?",
        "topic": "Judiciary",
    })

    # --- quizzes: one live now, one scheduled ----------------------------
    call("POST", f"/groups/{gid}/quizzes", owner, {
        "title": "Constitutional Development — Live Drill",
        "topic": "Constitutional Development",
        "description": "20 quick questions from the 2015–2019 WAEC sets.",
        "question_count": 20,
        "per_question_seconds": 30,
        "max_attempts": 2,
        "reward_xp": 120,
        "reward_coins": 50,
        "pass_score": 60,
        "randomize": True,
    })
    call("POST", f"/groups/{gid}/quizzes", owner, {
        "title": "Friday Mock Debrief",
        "topic": "Mixed",
        "description": "Scheduled for Friday after the school mock.",
        "question_count": 40,
        "per_question_seconds": 25,
        "starts_at": "2030-01-01T16:00:00Z",
        "reward_xp": 200,
        "pass_score": 50,
    })

    # --- a duel so the Duels tab has content -----------------------------
    call("POST", f"/groups/{gid}/duels", owner, {
        "opponent_id": _member_id(tokens, gid, "Zainab"),
        "topic": "Systems of Government",
        "question_count": 10,
        "public": True,
        "message": "Warm-up before mocks!",
    })

    print("\n  Demo login →  username: ada   password: secret123")
    print(f"  Group workspace:  #/group/{gid}/overview   (code {code})")


def _member_id(tokens, gid, name_prefix):
    _, members = call("GET", f"/groups/{gid}/members?size=50", tokens["ada"])
    for row in members.get("items", []):
        if row.get("name", "").startswith(name_prefix):
            return row["student_id"]
    return None


if __name__ == "__main__":
    main()
