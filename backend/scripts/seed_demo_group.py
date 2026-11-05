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


def register(username, phone, display=None, country="US"):
    status, payload = call(
        "POST", "/auth/register", body={"username": username, "phone": phone, "password": PASSWORD, "display_name": display}
    )
    if status != 200:
        # Already exists from a previous seed — sign in instead.
        status, payload = call("POST", "/auth/student", body={"identifier": username, "password": PASSWORD})
    token = payload["token"]
    call("PATCH", "/me", token, {"name": display, "country": country})
    return token, payload.get("profile", {})


def main() -> None:
    people = [
        ("ada", "+12025550101", "Ada Brooks", "US"),
        ("oliver", "+447700900102", "Oliver James", "GB"),
        ("maya", "+12025550103", "Maya Reed", "US"),
        ("ethan", "+447700900104", "Ethan Clark", "GB"),
        ("chloe", "+447700900105", "Chloe Bennett", "GB"),
        ("ife", "+12025550106", "Ife Adeyemi", "US"),
    ]
    tokens = {}
    for username, phone, display, country in people:
        token, profile = register(username, phone, display, country)
        tokens[username] = token
        print(f"  • {username} ({display}) -> id {profile.get('id')}")

    owner = tokens["ada"]

    status, group = call("POST", "/groups", owner, {
        "name": "English & Maths Study Circle",
        "goal": "Build confidence in English and Mathematics",
        "description": "A friendly study circle for grammar, writing, arithmetic and algebra practice.",
    })
    if status != 200:
        print("  ! could not create group:", status, group)
        return
    gid = group["id"]
    code = group["code"]
    print(f"  ✓ group #{gid} '{group['name']}' code {code}")

    for username in ("oliver", "maya", "ethan", "chloe", "ife"):
        call("POST", f"/groups/join/{code}", tokens[username])

    # Promote a moderator so the role chips and staff gating are visible.
    status, members = call("GET", f"/groups/{gid}/members?size=20", owner)
    for row in members.get("items", []):
        if row.get("name", "").startswith("Oliver"):
            call("PATCH", f"/groups/{gid}/members/{row['student_id']}", owner, {"role": "moderator"})

    # --- chat ------------------------------------------------------------
    _, m1 = call("POST", f"/groups/{gid}/messages", owner, {"body": "Hi everyone 👋 Let's fit in short English and maths practice sessions this week."})
    call("POST", f"/groups/{gid}/messages", tokens["maya"], {"body": "I'm in! Could we start with punctuation and sentence structure?", "reply_to_id": m1.get("id")})
    call("POST", f"/groups/{gid}/messages", tokens["oliver"], {"body": "I have a quick algebra set ready. Who wants to try it after the grammar drill?"})
    call("POST", f"/groups/{gid}/messages", tokens["ethan"], {"body": "Count me in — I'll bring a few equations ⚔️"})
    call("POST", f"/groups/{gid}/messages", tokens["chloe"], {"body": "Could someone explain when to use a semicolon? 🙏"})
    _, m6 = call("POST", f"/groups/{gid}/messages", tokens["ife"], {"body": "Use it to join two closely related complete sentences; both sides can stand on their own."})
    call("POST", f"/groups/{gid}/messages/{m1.get('id')}/react", tokens["maya"], {"emoji": "🔥"})
    call("POST", f"/groups/{gid}/messages/{m6.get('id')}/react", owner, {"emoji": "👏"})

    # --- announcements ---------------------------------------------------
    call("POST", f"/groups/{gid}/announcements", owner, {
        "title": "English and maths practice on Friday",
        "body": "Our shared practice session is Friday afternoon. We'll finish with a short quiz and review.",
        "priority": "high",
        "pinned": True,
    })
    call("POST", f"/groups/{gid}/announcements", tokens["oliver"], {
        "title": "Weekly study plan",
        "body": "Mon–Wed: grammar and algebra. Thu: friendly duels. Fri: group quiz + review.",
        "priority": "normal",
    })

    # --- questions -------------------------------------------------------
    _, q1 = call("POST", f"/groups/{gid}/questions", tokens["chloe"], {
        "title": "When should I use a semicolon instead of a comma?",
        "body": "I know it can join ideas, but I'm not sure when both sides count as complete sentences.",
        "topic": "Punctuation",
    })
    _, a1 = call("POST", f"/groups/{gid}/questions/{q1.get('id')}/answers", tokens["ife"], {
        "body": "Use a semicolon between closely related independent clauses when you want a stronger pause than a comma. Each side should be able to stand as a complete sentence.",
    })
    call("POST", f"/groups/{gid}/questions/{q1.get('id')}/answers/{a1.get('id')}/useful", tokens["chloe"])
    call("POST", f"/groups/{gid}/questions/{q1.get('id')}/answers/{a1.get('id')}/best", tokens["chloe"])
    call("POST", f"/groups/{gid}/questions", tokens["ethan"], {
        "title": "How do I solve 3(x + 2) = 21?",
        "body": "I get stuck after expanding the brackets. Could someone show the steps?",
        "topic": "Algebra",
    })

    # --- quizzes: one live now, one scheduled ----------------------------
    call("POST", f"/groups/{gid}/quizzes", owner, {
        "title": "English Grammar — Live Drill",
        "topic": "Grammar",
        "description": "20 quick questions from the English practice bank.",
        "question_count": 20,
        "per_question_seconds": 30,
        "max_attempts": 2,
        "reward_xp": 120,
        "reward_coins": 50,
        "pass_score": 60,
        "randomize": True,
    })
    call("POST", f"/groups/{gid}/quizzes", owner, {
        "title": "Friday English & Maths Review",
        "topic": "Mixed",
        "description": "Scheduled for Friday afternoon for a mixed review.",
        "question_count": 40,
        "per_question_seconds": 25,
        "starts_at": "2030-01-01T16:00:00Z",
        "reward_xp": 200,
        "pass_score": 50,
    })

    # --- a duel so the Duels tab has content -----------------------------
    call("POST", f"/groups/{gid}/duels", owner, {
        "opponent_id": _member_id(tokens, gid, "Maya"),
        "topic": "Grammar",
        "question_count": 10,
        "public": True,
        "message": "Warm-up before the study session!",
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
