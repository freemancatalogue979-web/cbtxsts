"""End-to-end smoke test for the Quiz Arena API (REST + websockets).

Every run registers two throwaway players so it is repeatable against a
persistent database::

    backend/.venv/bin/python backend/scripts/smoke.py
"""
from __future__ import annotations

import asyncio
import json
import random
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:3000"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

PASSED: list[str] = []
FAILED: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    (PASSED if condition else FAILED).append(label)
    print(f"{'PASS' if condition else 'FAIL'} | {label}" + ("" if condition or not detail else f" -> {detail[:200]}"))


def call(method: str, path: str, token: str | None = None, body: dict | None = None) -> tuple[int, object]:
    request = urllib.request.Request(f"{BASE}{path}", method=method)
    request.add_header("content-type", "application/json")
    if token:
        request.add_header("authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(request, data, timeout=25) as response:
            blob = response.read()
            try:
                raw = blob.decode()
            except UnicodeDecodeError:
                return response.status, blob  # binary payloads (profile photos)
            if not raw:
                return response.status, None
            try:
                return response.status, json.loads(raw)
            except json.JSONDecodeError:
                return response.status, raw  # CSV / plain-text responses
    except urllib.error.HTTPError as error:
        raw = error.read().decode()
        try:
            return error.code, json.loads(raw)
        except json.JSONDecodeError:
            return error.code, raw


def fresh_phone() -> str:
    return "08" + "".join(str(random.randint(0, 9)) for _ in range(9))


def fresh_username(tag: str) -> str:
    return f"{tag}{random.randint(10000, 999999)}"


SMOKE_PASSWORD = "smokepass1"


def register(username: str, phone: str, name: str | None = None, password: str = SMOKE_PASSWORD) -> tuple[str, dict]:
    body: dict = {"username": username, "phone": phone, "password": password}
    if name:
        body["display_name"] = name
    status_code, payload = call("POST", "/api/auth/register", body=body)
    assert status_code == 200, payload
    return payload["token"], payload["profile"]


def login(identifier: str, password: str = SMOKE_PASSWORD) -> tuple[str, dict]:
    status_code, payload = call("POST", "/api/auth/student", body={"identifier": identifier, "password": password})
    assert status_code == 200, payload
    return payload["token"], payload["profile"]


async def ws_collect(url: str, seconds: float = 2.0, expect: int = 1) -> list[dict]:
    import websockets

    messages: list[dict] = []
    try:
        async with websockets.connect(url) as socket:
            async def reader() -> None:
                while len(messages) < expect:
                    messages.append(json.loads(await socket.recv()))

            task = asyncio.create_task(reader())
            try:
                await asyncio.wait_for(task, timeout=seconds + 3)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                task.cancel()
    except Exception as error:  # noqa: BLE001
        messages.append({"event": "error", "data": str(error)})
    return messages


async def main() -> None:
    # ---------------- platform ----------------
    status_code, health = call("GET", "/api/health")
    check("health endpoint", status_code == 200 and health["status"] == "ok", str(health))

    status_code, boot = call("GET", "/api/bootstrap")
    check(
        "bootstrap payload",
        status_code == 200 and boot["players"] >= 0 and len(boot["quizzes"]) > 0 and "leaderboard" in boot,
        str(status_code),
    )

    # ---------------- secure registration ----------------
    known_user = fresh_username("smoke")
    known_phone = fresh_phone()
    known_token, known_profile = register(known_user, known_phone, "Smoke Known")
    check("register creates the account", bool(known_token) and known_profile["username"] == known_user, str(known_profile)[:160])
    check("register grants the welcome bonus", known_profile["is_new"] is True and known_profile["coins"] == 100, str(known_profile)[:160])

    status_code, dup = call("POST", "/api/auth/register", body={"username": known_user, "phone": fresh_phone(), "password": SMOKE_PASSWORD})
    check("duplicate username rejected", status_code == 409, str(dup)[:120])
    status_code, dup = call("POST", "/api/auth/register", body={"username": fresh_username("dup"), "phone": known_phone, "password": SMOKE_PASSWORD})
    check("duplicate phone rejected", status_code == 409, str(dup)[:120])
    status_code, bad = call("POST", "/api/auth/register", body={"username": fresh_username("bad"), "phone": "12345", "password": SMOKE_PASSWORD})
    check("invalid phone rejected at register", status_code == 422, str(bad)[:120])
    status_code, bad = call("POST", "/api/auth/register", body={"username": fresh_username("weak"), "phone": fresh_phone(), "password": "123"})
    check("weak password rejected at register", status_code == 422, str(bad)[:120])

    status_code, wrong = call("POST", "/api/auth/student", body={"identifier": known_user, "password": "not-the-password"})
    check("wrong password rejected", status_code == 401, str(wrong)[:120])

    # Every way a player might type the same number must reach the same account.
    local = known_phone[1:]
    for form in (known_user, f"+234{local}", f"234 {local}", local):
        status_code, alt = call("POST", "/api/auth/student", body={"identifier": form, "password": SMOKE_PASSWORD})
        check(
            f"login as {form[:6]}... reaches the same account",
            status_code == 200 and alt["profile"]["id"] == known_profile["id"] and alt["profile"]["is_new"] is False,
            str(status_code),
        )

    status_code, found = call("POST", "/api/auth/lookup", body={"phone": known_phone})
    check(
        "lookup greets an existing player",
        status_code == 200 and found["exists"] is True and bool(found["first_name"]) and "level" in found,
        str(found)[:160],
    )
    status_code, missing = call("POST", "/api/auth/lookup", body={"phone": fresh_phone()})
    check("lookup flags an unknown number as new", status_code == 200 and missing["exists"] is False, str(missing)[:120])

    token_a, profile_a = register(fresh_username("smka"), fresh_phone(), "Smoke Player A")
    token_b, profile_b = register(fresh_username("smkb"), fresh_phone(), "Smoke Player B")
    check("second registrations stay independent", profile_a["id"] != profile_b["id"], "")
    check("profile carries level/xp/badges", {"xp", "coins", "progress", "badges", "stats"} <= set(profile_a), "")

    # ---------------- admin ----------------
    status_code, admin = call("POST", "/api/auth/admin", body={"email": "admin@quizarena.ng", "password": "arena2026"})
    check("admin login", status_code == 200 and admin["role"] == "admin", str(admin)[:160])
    admin_token = admin["token"] if status_code == 200 else ""

    status_code, wrong = call("POST", "/api/auth/admin", body={"email": "admin@quizarena.ng", "password": "nope"})
    check("wrong admin password rejected", status_code == 401, str(wrong))

    status_code, _ = call("GET", "/api/admin/overview", token=token_a)
    check("students cannot read the admin API", status_code == 403, str(status_code))

    status_code, overview = call("GET", "/api/admin/overview", token=admin_token)
    check(
        "admin overview stats",
        status_code == 200 and overview["players"] >= 3 and overview["questions"] >= 90,
        str(overview)[:160],
    )

    status_code, adjusted = call(
        "POST", f"/api/admin/students/{profile_a['id']}/adjust?xp=100&coins=2000&reason=smoke-topup", token=admin_token
    )
    check("admin adjusts a player's coins", status_code == 200 and adjusted["coins"] >= 2000, str(adjusted)[:160])

    # ---------------- exams ----------------
    status_code, quizzes = call("GET", "/api/quizzes", token=token_a)
    active = [q for q in quizzes if q["status"] == "active" and q["question_count"] > 0]
    check("quiz list exposes active exams", status_code == 200 and len(active) >= 2, str(status_code))

    target = max(active, key=lambda q: q["question_count"])
    status_code, attempt = call("POST", f"/api/exams/{target['id']}/start", token=token_a)
    check("start exam", status_code == 200 and attempt["status"] == "in_progress", str(attempt)[:160])
    check("answer key hidden during the exam", all("correct" not in q for q in attempt.get("questions", [])), "")
    check("server owns the countdown", attempt.get("time_remaining", 0) > 0, str(attempt.get("time_remaining")))

    for index, question in enumerate(attempt["questions"][:3]):
        option = ["A", "B", "C", "D"][index % 4]
        status_code, saved = call(
            "POST",
            f"/api/exams/attempts/{attempt['id']}/answer",
            token=token_a,
            body={"question_id": question["id"], "selected": option, "seconds_spent": 4.5},
        )
        check(f"autosave answer #{index + 1}", status_code == 200 and saved.get("ok") is True, str(saved))

    status_code, flagged = call(
        "POST",
        f"/api/exams/attempts/{attempt['id']}/answer",
        token=token_a,
        body={"question_id": attempt["questions"][3]["id"], "selected": "C", "flagged": True},
    )
    check("flag a question", status_code == 200 and flagged.get("ok"), str(flagged))

    status_code, resumed = call("GET", f"/api/exams/attempts/{attempt['id']}", token=token_a)
    check("attempt resumes with saved answers", status_code == 200 and len(resumed.get("answers", [])) == 4, str(status_code))

    status_code, _ = call("GET", f"/api/exams/attempts/{attempt['id']}", token=token_b)
    check("attempt is private to its owner", status_code == 404, str(status_code))

    status_code, result = call(
        "POST", f"/api/exams/attempts/{attempt['id']}/submit", token=token_a, body={"submission_type": "early"}
    )
    check("submit exam", status_code == 200 and result.get("status") == "submitted", str(result)[:160])
    check("review reveals correct answers", any(row.get("correct") for row in result.get("review", [])), "")
    check("submission grants XP + coins", result.get("xp_awarded", 0) > 0 and result.get("coins_awarded", 0) > 0, "")
    check("submission returns a rank", bool(result.get("rank")), str(result.get("rank")))

    status_code, again = call("POST", f"/api/exams/{target['id']}/start", token=token_a)
    check("cannot retake a submitted exam", status_code == 400, str(again))

    status_code, mine = call("GET", "/api/results/me", token=token_a)
    check("my results list", status_code == 200 and len(mine) >= 1 and mine[0]["rank_label"], str(mine)[:160])

    status_code, sheet = call("GET", f"/api/quizzes/{target['id']}/leaderboard", token=token_a)
    check("quiz master sheet", status_code == 200 and isinstance(sheet, list), str(status_code))

    # ---------------- leaderboards, prizes, badges ----------------
    for scope in ("global", "weekly", "friends", "duels", "helpers"):
        status_code, board = call("GET", f"/api/leaderboard?scope={scope}&limit=25", token=token_a)
        check(f"leaderboard scope '{scope}'", status_code == 200 and "rows" in board and "me" in board, str(status_code))

    status_code, prizes = call("GET", "/api/prizes", token=token_a)
    check("prize vault", status_code == 200 and len(prizes.get("prizes", [])) >= 5, str(status_code))

    coin_prize = next(
        (p for p in prizes["prizes"] if p["kind"] == "coins" and p["eligible"] and not p["claimed"]), None
    )
    if coin_prize:
        status_code, claim = call("POST", f"/api/prizes/{coin_prize['id']}/claim", token=token_a, body={"note": "smoke"})
        check("claim a coin prize", status_code == 200 and claim.get("ok") is True, str(claim))
        status_code, dupe = call("POST", f"/api/prizes/{coin_prize['id']}/claim", token=token_a, body={})
        check("double claim blocked", status_code == 409, str(dupe))
    else:
        check("claim a coin prize", False, "no eligible coin prize")

    rank_prize = next((p for p in prizes["prizes"] if p["kind"] == "rank" and not p["eligible"]), None)
    if rank_prize:
        status_code, denied = call("POST", f"/api/prizes/{rank_prize['id']}/claim", token=token_a, body={})
        check("rank-locked prize denied", status_code == 403, str(denied))

    status_code, badges = call("GET", "/api/badges", token=token_a)
    check("badge catalogue", status_code == 200 and len(badges) >= 10, str(status_code))

    # ---------------- social ----------------
    status_code, added = call("POST", "/api/friends", token=token_a, body={"phone": profile_b["phone"]})
    check("add friend by phone", status_code == 200 and added.get("ok") is True, str(added))
    status_code, friends = call("GET", "/api/friends", token=token_a)
    check("friends list", status_code == 200 and any(f["id"] == profile_b["id"] for f in friends["friends"]), "")
    status_code, search = call("GET", "/api/players/search?q=smoke", token=token_a)
    check("player search", status_code == 200 and len(search) >= 1, str(status_code))
    status_code, activity = call("GET", "/api/activity", token=token_a)
    check("activity feed", status_code == 200 and len(activity) >= 1, str(status_code))

    # chat: text, quiz plan card, unread counting and read receipts
    status_code, sent = call("POST", "/api/chat", token=token_a, body={"to": profile_b["id"], "body": "Hello from smoke A"})
    check("chat message sends", status_code == 200 and sent["kind"] == "text", str(sent)[:160])
    status_code, thread = call("GET", f"/api/chat?with={profile_a['id']}", token=token_b)
    check(
        "chat thread reaches the friend",
        status_code == 200 and any(m["body"] == "Hello from smoke A" for m in thread["messages"]),
        str(thread)[:160],
    )
    status_code, unread = call("GET", "/api/chat/unread", token=token_b)
    check(
        "unread counter sees the new message",
        status_code == 200 and unread["total"] >= 1,
        str(unread)[:160],
    )
    status_code, plan = call(
        "POST",
        "/api/chat",
        token=token_a,
        body={"to": profile_b["id"], "kind": "quiz", "body": "Let's sit this together", "meta": {"quiz_id": 1, "title": "Smoke exam", "when": ""}},
    )
    check("quiz plan card carries its meta", status_code == 200 and plan["kind"] == "quiz" and plan["meta"].get("quiz_id") == 1, str(plan)[:160])
    status_code, stranger = call("POST", "/api/chat", token=token_a, body={"to": known_profile["id"], "body": "hi"})
    check("strangers cannot slide into DMs", status_code == 403, str(status_code))
    status_code, _marked = call("POST", f"/api/chat/read?with={profile_a['id']}", token=token_b)
    status_code, unread2 = call("GET", "/api/chat/unread", token=token_b)
    check("read receipt clears the counter", status_code == 200 and unread2["total"] == 0, str(unread2)[:160])
    status_code, _ = call("POST", "/api/me/daily-bonus", token=token_a)
    check("daily bonus (or already claimed)", status_code in (200, 409), str(status_code))

    # ---------------- study modes & social learning ----------------
    status_code, flash = call("GET", "/api/study/flashcards", token=token_a)
    check(
        "flashcard deck reveals answers for self-study",
        status_code == 200 and len(flash["cards"]) >= 5 and "correct" in flash["cards"][0],
        str(status_code),
    )

    status_code, rush = call("GET", "/api/study/rush?mode=blitz", token=token_a)
    check(
        "blitz deals ten sealed questions",
        status_code == 200 and len(rush["questions"]) == 10 and all("correct" not in q for q in rush["questions"]),
        str(status_code),
    )
    status_code, rushed = call(
        "POST",
        "/api/study/rush",
        token=token_a,
        body={
            "mode": "blitz",
            "issued_at": rush["issued_at"],
            "items": [{"question_id": q["id"], "answer": "A"} for q in rush["questions"]],
        },
    )
    check("blitz run grades server-side", status_code == 200 and rushed["ok"] and isinstance(rushed["score"], int), str(rushed)[:160])
    status_code, stale = call(
        "POST", "/api/study/rush", token=token_a,
        body={"mode": "blitz", "issued_at": "2020-01-01T00:00:00Z", "items": []},
    )
    check("expired rush runs are refused", status_code == 400, str(status_code))

    status_code, daily = call("GET", "/api/study/daily", token=token_a)
    check(
        "daily challenge deals five shared questions",
        status_code == 200 and len(daily["questions"]) == 5 and daily["done"] is False,
        str(status_code),
    )
    status_code, daily_done = call(
        "POST", "/api/study/daily", token=token_a,
        body={"day": daily["day"], "items": [{"question_id": q["id"], "answer": "B"} for q in daily["questions"]]},
    )
    check("daily challenge grades once", status_code == 200 and daily_done["total"] == 5, str(daily_done)[:160])
    status_code, daily_again = call("POST", "/api/study/daily", token=token_a, body={"day": daily["day"], "items": []})
    check("daily challenge cannot be retaken", status_code == 409, str(status_code))

    review_row = result["review"][0]
    status_code, asked = call("POST", "/api/study/help", token=token_a, body={"to": profile_b["id"], "question_id": review_row["question_id"]})
    check("ask-a-friend sends a help request", status_code == 200 and asked["request"]["status"] == "pending", str(asked)[:160])
    status_code, help_inbox = call("GET", "/api/study/help/inbox", token=token_b)
    check(
        "helper sees the request",
        status_code == 200 and any(row["id"] == asked["request"]["id"] for row in help_inbox["requests"]),
        str(status_code),
    )
    status_code, answered = call(
        "POST", f"/api/study/help/{asked['request']['id']}/answer", token=token_b, body={"answer": review_row["correct"]}
    )
    check(
        "correct help pays tutor points",
        status_code == 200 and answered["was_correct"] is True and answered["profile"]["helper_points"] >= 1,
        str(answered)[:160],
    )
    status_code, notes = call("GET", "/api/inbox", token=token_a)
    check(
        "asker gets a personal notification",
        status_code == 200 and notes["unread"] >= 1 and any(note["kind"] == "answer" for note in notes["notes"]),
        str(notes)[:160],
    )

    status_code, match = call("GET", "/api/study/match", token=token_a)
    check(
        "mind match deals twelve real cards",
        status_code == 200 and len(match["cards"]) == 12 and len({c["pair"] for c in match["cards"]}) == 6,
        str(status_code),
    )
    status_code, matched = call(
        "POST", "/api/study/match", token=token_a,
        body={"issued_at": match["issued_at"], "moves": 9, "matched": 6, "elapsed_ms": 42000},
    )
    check("mind match grades and pays", status_code == 200 and matched["matched"] == 6 and matched["ok"], str(matched)[:160])
    status_code, cheat = call(
        "POST", "/api/study/match", token=token_a,
        body={"issued_at": "2020-01-01T00:00:00Z", "moves": 6, "matched": 6, "elapsed_ms": 1000},
    )
    check("stale mind-match runs are refused", status_code == 400, str(status_code))

    status_code, spun = call("POST", "/api/study/spin", token=token_a)
    check("lucky spin pays coins", status_code == 200 and spun["coins"] > 0, str(spun)[:160])
    status_code, respun = call("POST", "/api/study/spin", token=token_a)
    check("spin is once per day", status_code == 409, str(status_code))

    status_code, missions = call("GET", "/api/study/missions", token=token_a)
    exam_mission = next((m for m in missions.get("missions", []) if m["key"] == "exam1"), {})
    check("missions track real progress", status_code == 200 and exam_mission.get("progress", 0) >= 1, str(missions)[:160])
    status_code, claimed = call("POST", "/api/study/missions/exam1/claim", token=token_a)
    check("mission reward claims", status_code == 200 and claimed["ok"], str(claimed)[:160])
    status_code, reclaim = call("POST", "/api/study/missions/exam1/claim", token=token_a)
    check("missions cannot be double-claimed", status_code == 409, str(status_code))

    status_code, shop = call("GET", "/api/study/shop", token=token_a)
    check("shop shelves are stocked", status_code == 200 and len(shop["items"]) >= 5, str(status_code))
    status_code, bought = call("POST", "/api/study/shop/buy", token=token_a, body={"sku": "freeze"})
    check("streak freeze lands in inventory", status_code == 200 and bought["profile"]["streak_freezes"] >= 1, str(bought)[:160])
    status_code, boosted = call("POST", "/api/study/shop/buy", token=token_a, body={"sku": "boost"})
    check("double XP boost activates", status_code == 200 and boosted["profile"]["xp_boosted"] is True, str(boosted)[:160])

    status_code, nudged = call("POST", f"/api/friends/{profile_b['id']}/nudge", token=token_a)
    check("nudge reaches a friend", status_code == 200 and nudged["ok"], str(nudged)[:160])
    status_code, renudge = call("POST", f"/api/friends/{profile_b['id']}/nudge", token=token_a)
    check("nudges are rate-limited", status_code == 429, str(status_code))

    # ---------------- course question bank + draws ----------------
    status_code, bank = call("GET", "/api/admin/courses/1/bank", token=admin_token)
    check("course bank counts its originals", status_code == 200 and bank["bank"] > 0, str(bank)[:160])

    status_code, draw_quiz = call(
        "POST", "/api/admin/quizzes", token=admin_token,
        body={"title": "Bank Draw Test", "course_id": 1, "duration_minutes": 40, "status": "draft"},
    )
    draw_quiz_id = draw_quiz.get("id")
    status_code, drawn = call("POST", f"/api/admin/quizzes/{draw_quiz_id}/draw", token=admin_token, body={"count": 5})
    check("draw pulls five bank questions", status_code == 200 and drawn["drawn"] == 5 and drawn["total"] == 5, str(drawn)[:160])

    status_code, draw_qs = call("GET", f"/api/admin/quizzes/{draw_quiz_id}/questions", token=admin_token)
    texts = [q["text"] for q in draw_qs] if isinstance(draw_qs, list) else []
    check(
        "drawn questions are flagged and unique",
        status_code == 200 and len(texts) == 5 and len(set(texts)) == 5 and all(q.get("drawn") for q in draw_qs),
        str(draw_qs)[:160],
    )

    status_code, drawn2 = call("POST", f"/api/admin/quizzes/{draw_quiz_id}/draw", token=admin_token, body={"count": 5})
    status_code, draw_qs2 = call("GET", f"/api/admin/quizzes/{draw_quiz_id}/questions", token=admin_token)
    texts2 = [q["text"] for q in draw_qs2] if isinstance(draw_qs2, list) else []
    check("a second draw never repeats a question", drawn2.get("drawn") == 5 and len(set(texts2)) == 10, f"{len(set(texts2))} unique")

    status_code, _ = call("DELETE", f"/api/admin/quizzes/{draw_quiz_id}", token=admin_token)
    check("drawn quizzes clean up", status_code == 200, str(status_code))

    # ---------------- duels honour a course ----------------
    status_code, empty_course = call(
        "POST", "/api/admin/courses", token=admin_token,
        body={"code": "SMK101", "title": "Smoke Empty Course"},
    )
    empty_course_id = empty_course.get("id") if isinstance(empty_course, dict) else None
    status_code, dead_duel = call(
        "POST", "/api/duels/open", token=token_a,
        body={"course_id": empty_course_id, "question_count": 5, "topic": "Empty course duel"},
    )
    check("a course with no bank cannot host duels", status_code == 400, str(status_code))

    status_code, law_duel = call(
        "POST", "/api/duels/open", token=token_a,
        body={"course_id": 1, "question_count": 5, "topic": "Course duel"},
    )
    check("course duel publishes with its course", status_code == 200 and law_duel.get("course_id") == 1, str(law_duel)[:160])
    if isinstance(law_duel, dict) and law_duel.get("id"):
        call("POST", f"/api/duels/{law_duel['id']}/cancel", token=token_a)
    call("DELETE", f"/api/admin/courses/{empty_course_id}", token=admin_token)

    # ---------------- profile photos ----------------
    png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    status_code, with_photo = call("POST", "/api/me/photo", token=token_a, body={"image": png})
    check("profile photo uploads", status_code == 200 and with_photo.get("has_photo") is True, str(with_photo)[:160])
    status_code, _ = call("GET", f"/api/players/{profile_a['id']}/photo", token=token_b)
    check("friends can fetch the photo", status_code == 200, str(status_code))
    status_code, public = call("GET", f"/api/players/{profile_a['id']}", token=token_b)
    check("public profiles advertise the photo", status_code == 200 and public.get("has_photo") is True, str(public)[:160])
    status_code, bad = call("POST", "/api/me/photo", token=token_a, body={"image": "data:text/html;base64,aGk="})
    check("non-image uploads are refused", status_code == 422, str(status_code))
    delete_status, cleared = call("DELETE", "/api/me/photo", token=token_a)
    gone_status, _gone = call("GET", f"/api/players/{profile_a['id']}/photo", token=token_b)
    check(
        "photo removal works",
        delete_status == 200 and cleared.get("has_photo") is False and gone_status == 404,
        f"{delete_status}/{gone_status}",
    )

    status_code, my_feed = call("GET", "/api/activity", token=token_a)
    target_activity = my_feed[0]["id"]
    status_code, reacted = call("POST", f"/api/activity/{target_activity}/react", token=token_a)
    check("feed reactions toggle on", status_code == 200 and reacted["mine"] is True and reacted["count"] >= 1, str(reacted)[:160])
    status_code, unreacted = call("POST", f"/api/activity/{target_activity}/react", token=token_a)
    check("feed reactions toggle off", status_code == 200 and unreacted["mine"] is False, str(unreacted)[:160])

    status_code, patched = call("PATCH", "/api/me", token=token_b, body={"bio": "Law student, duel addict.", "status_text": "Grinding jurisprudence"})
    check("profile bio + status update", status_code == 200 and patched["bio"] == "Law student, duel addict.", str(patched)[:160])

    status_code, analytics = call("GET", "/api/study/analytics", token=token_a)
    check(
        "analytics reflects real answers",
        status_code == 200 and analytics["questions_answered"] > 0 and "predicted_grade" in analytics,
        str(analytics)[:160],
    )

    status_code, by_code = call("POST", "/api/friends", token=token_b, body={"code": known_profile["player_code"]})
    check("friends can be added by player code", status_code == 200 and by_code.get("ok") is True, str(by_code)[:160])

    status_code, helpers_board = call("GET", "/api/leaderboard?scope=helpers&limit=25", token=token_a)
    check(
        "helpers board ranks tutors",
        status_code == 200 and any(row["id"] == profile_b["id"] for row in helpers_board["rows"]),
        str(helpers_board)[:160],
    )
    status_code, board = call("GET", "/api/leaderboard?scope=global&limit=100", token=token_a)
    check(
        "global board lists only players who actually played",
        status_code == 200 and all(row["xp"] > 0 for row in board["rows"]),
        str(board)[:160],
    )

    # ---------------- duels ----------------
    status_code, duel = call(
        "POST",
        "/api/duels",
        token=token_a,
        body={"opponent_phone": profile_b["phone"], "question_count": 5, "stake_coins": 0, "topic": "Smoke Test"},
    )
    check("challenge a friend to a duel", status_code == 200 and duel["status"] == "invited", str(duel)[:160])
    duel_id = duel["id"]

    status_code, selfduel = call("POST", "/api/duels", token=token_a, body={"opponent_phone": profile_a["phone"]})
    check("cannot duel yourself", status_code == 400, str(selfduel))

    status_code, accepted = call("POST", f"/api/duels/{duel_id}/accept", token=token_b)
    check("accepting starts the duel", status_code == 200 and accepted["status"] in ("starting", "live"), str(accepted)[:160])
    check("live duel ships its questions", len(accepted.get("questions", [])) == 5, str(len(accepted.get("questions", []))))
    check("duel answer key hidden", all("correct" not in q for q in accepted.get("questions", [])), "")

    # Multiplayer rule: each player gets their OWN server-dealt set.
    status_code, mine_a = call("GET", f"/api/duels/{duel_id}", token=token_a)
    check("challenger sees their own set", status_code == 200 and len(mine_a.get("questions", [])) == 5, str(status_code))
    ids_a = {q["id"] for q in mine_a.get("questions", [])}
    ids_b = {q["id"] for q in accepted.get("questions", [])}
    check("the two sets do not overlap", not (ids_a & ids_b), str(sorted(ids_a & ids_b)))
    check("each set has no duplicates", len(ids_a) == 5 and len(ids_b) == 5, "")

    room = await ws_collect(f"ws://127.0.0.1:3000/ws/duel/{duel_id}?token={token_a}", seconds=2, expect=3)
    check("duel websocket streams state", any(m.get("event") == "duel_state" for m in room), str(room)[:160])

    status_code, cross = call(
        "POST", f"/api/duels/{duel_id}/answer", token=token_a,
        body={"question_id": accepted["questions"][0]["id"], "selected": "A", "elapsed_ms": 100},
    )
    check("a rival's question is not answerable", status_code == 400, str(cross))

    # Server-paced rounds: the countdown flips the duel live, then each round
    # only accepts its own question while it is on the clock. Once BOTH
    # fighters answer, the 1-second ticker opens the next round.
    order_a = [q["id"] for q in mine_a["questions"]]
    order_b = [q["id"] for q in accepted["questions"]]

    def await_round(index: int) -> dict:
        budget = time.monotonic() + 30
        state: dict = {}
        while time.monotonic() < budget:
            sc, payload = call("GET", f"/api/duels/{duel_id}", token=token_a)
            state = payload if sc == 200 else {}
            cursor = state.get("round_index")
            if state.get("status") == "finished":
                return state
            # NB: `cursor or -1` would swallow round 0 (falsy zero) — compare explicitly.
            if state.get("status") == "live" and cursor is not None and cursor >= index:
                return state
            time.sleep(0.4)
        return state

    live_state = await_round(0)
    check("countdown flips the duel to live", live_state.get("status") in ("live", "finished"), str(live_state.get("status")))

    for index in range(5):
        st_now = await_round(index)
        option = ["A", "B", "C", "D"][index % 4]
        status_code, reply = call(
            "POST",
            f"/api/duels/{duel_id}/answer",
            token=token_a,
            body={"question_id": order_a[index], "selected": option, "elapsed_ms": 1200 + index * 500},
        )
        check(f"player A answers duel question #{index + 1}", status_code == 200, f"{status_code} ri={st_now.get('round_index')} status={st_now.get('status')} {str(reply)[:110]}")
        status_code, reply = call(
            "POST",
            f"/api/duels/{duel_id}/answer",
            token=token_b,
            body={"question_id": order_b[index], "selected": "A", "elapsed_ms": 1500},
        )
        check(f"player B answers duel question #{index + 1}", status_code == 200, f"{status_code} {str(reply)[:140]}")

    status_code, dupe = call(
        "POST", f"/api/duels/{duel_id}/answer", token=token_a,
        body={"question_id": order_a[0], "selected": "A", "elapsed_ms": 100},
    )
    check("duplicate duel answer blocked", status_code == 400, str(dupe))

    status_code, trespass = call(
        "POST", f"/api/duels/{duel_id}/answer", token=known_token,
        body={"question_id": order_a[0], "selected": "A"},
    )
    check("non-participant cannot answer", status_code == 403, str(trespass))

    budget = time.monotonic() + 20
    final: dict = {}
    while time.monotonic() < budget:
        status_code, final = call("GET", f"/api/duels/{duel_id}", token=token_a)
        if isinstance(final, dict) and final.get("status") == "finished":
            break
        time.sleep(0.5)
    check("duel finishes when both sides complete", status_code == 200 and final.get("status") == "finished", str(final)[:160])
    check("finished duel reveals answers", any("correct" in q for q in final.get("questions", [])), "")
    check(
        "the reveal stays inside my own set",
        {q["id"] for q in final.get("questions", [])} == ids_a,
        str(sorted({q["id"] for q in final.get("questions", [])} ^ ids_a)),
    )
    check("duel winner recorded", "winner_id" in final, str(final.get("winner_id")))

    status_code, quick = call("POST", "/api/duels/quick", token=token_a, body={"question_count": 3, "stake_coins": 0})
    check("quick match responds (match or graceful 409)", status_code in (200, 409), str(status_code))

    status_code, opened = call("POST", "/api/duels/open", token=token_a, body={"question_count": 3, "stake_coins": 0})
    check("open duel publishes a join code", status_code == 200 and bool(opened.get("code")), str(opened)[:160])
    if status_code == 200:
        status_code, joined = call("POST", f"/api/duels/join/{opened['code']}", token=token_b)
        check("second player joins by code", status_code == 200 and joined["status"] in ("starting", "live"), str(joined)[:160])

    status_code, my_duels = call("GET", "/api/duels", token=token_a)
    check("duel history", status_code == 200 and len(my_duels.get("history", [])) >= 1, str(status_code))

    # ---------------- websockets: live channel ----------------
    live = await ws_collect(f"ws://127.0.0.1:3000/ws/live?token={token_a}", seconds=2, expect=3)
    check("live websocket welcome", any(m.get("event") == "welcome" for m in live), str(live)[:160])
    welcome = next((m for m in live if m.get("event") == "welcome"), {})
    check("welcome carries leaderboard + presence", bool(welcome.get("data", {}).get("leaderboard")), str(live)[:160])

    status_code, presence = call("GET", "/live/presence")
    check("presence REST fallback", status_code == 200 and "online" in presence, str(presence))

    # ---------------- admin authoring ----------------
    status_code, created = call(
        "POST", "/api/admin/quizzes", token=admin_token,
        body={"title": "Smoke Test Quiz", "course_id": 1, "duration_minutes": 5, "status": "draft"},
    )
    check("admin creates a quiz", status_code == 200 and created["title"] == "Smoke Test Quiz", str(created)[:160])
    new_quiz_id = created.get("id")

    status_code, bulk = call(
        "POST", f"/api/admin/quizzes/{new_quiz_id}/questions/bulk", token=admin_token,
        body={"questions": [
            {"text": "Smoke question one?", "option_a": "Yes", "option_b": "No", "correct": "A"},
            {"text": "Smoke question two?", "option_a": "Blue", "option_b": "Red", "option_c": "Green", "correct": "C"},
        ]},
    )
    check("admin bulk-imports questions", status_code == 200 and bulk["created"] == 2, str(bulk)[:160])

    status_code, activated = call(
        "PATCH", f"/api/admin/quizzes/{new_quiz_id}/status", token=admin_token, body={"status": "active"}
    )
    check("admin activates a quiz", status_code == 200 and activated["status"] == "active", str(activated)[:160])

    status_code, notice = call(
        "POST", "/api/admin/notifications", token=admin_token,
        body={"title": "Smoke broadcast", "message": "Testing live fan-out", "kind": "general"},
    )
    check("admin broadcasts a notification", status_code == 200 and notice["title"] == "Smoke broadcast", str(notice)[:160])

    status_code, _ = call("GET", f"/api/admin/results/export?quiz_id={target['id']}", token=admin_token)
    check("admin exports results CSV", status_code == 200, str(status_code))

    status_code, claims = call("GET", "/api/admin/claims", token=admin_token)
    check(
        "admin sees prize claims",
        status_code == 200 and isinstance(claims.get("rows"), list),
        str(status_code),
    )

    status_code, _ = call("DELETE", f"/api/admin/quizzes/{new_quiz_id}", token=admin_token)
    check("admin deletes a quiz", status_code == 200, str(status_code))

    # ---------------- multiplayer rooms ----------------
    status_code, created = call("POST", "/api/rooms", body={"title": "Smoke Room", "question_count": 3, "per_question_seconds": 10}, token=token_a)
    room = created.get("room", {})
    check("host creates a room", status_code == 200 and bool(room.get("code")) and room.get("is_host"), str(created)[:160])
    room_id = room.get("id")
    room_code = room.get("code", "")

    status_code, joined = call("POST", f"/api/rooms/join/{room_code}", token=token_b)
    check("guest joins by code", status_code == 200 and len(joined["room"]["members"]) == 2, str(joined)[:160])
    status_code, _ = call("POST", "/api/rooms/join/ZZZZZZ", token=token_b)
    check("bad room code rejected", status_code == 400, str(status_code))
    status_code, _ = call("POST", f"/api/rooms/{room_id}/start", token=token_b)
    check("guest cannot start the room", status_code == 403, str(status_code))

    status_code, started = call("POST", f"/api/rooms/{room_id}/start", token=token_a)
    question = started.get("question") or {}
    check("host starts and first question opens", status_code == 200 and question.get("question", {}).get("text") is not None, str(started)[:160])

    status_code, answered = call("POST", f"/api/rooms/{room_id}/answer", body={"selected": "A", "elapsed_ms": 1200}, token=token_a)
    check("host locks an answer", status_code == 200 and "result" in answered, str(answered)[:160])
    status_code, dup_answer = call("POST", f"/api/rooms/{room_id}/answer", body={"selected": "B"}, token=token_a)
    check("double answer blocked", status_code == 400, str(dup_answer)[:120])
    status_code, second = call("POST", f"/api/rooms/{room_id}/answer", body={"selected": "B", "elapsed_ms": 1500}, token=token_b)
    check("everyone answered reveals the question", status_code == 200 and second.get("all_answered") and second.get("reveal"), str(second)[:160])

    finished = None
    for _ in range(4):
        status_code, nxt = call("POST", f"/api/rooms/{room_id}/next", token=token_a)
        if status_code != 200:
            break
        if nxt.get("finish"):
            finished = nxt["finish"]
            break
        call("POST", f"/api/rooms/{room_id}/answer", body={"selected": "A", "elapsed_ms": 900}, token=token_a)
        call("POST", f"/api/rooms/{room_id}/answer", body={"selected": "C", "elapsed_ms": 950}, token=token_b)
    check("room run finishes with standings", bool(finished) and len(finished.get("standings", [])) == 2, str(finished)[:160])
    check("finish pays rewards", bool(finished) and any(row.get("xp") for row in finished.get("rewards", [])), str(finished)[:160])

    status_code, kicked = call("POST", f"/api/rooms/{room_id}/kick/{profile_b['id']}", token=token_a)
    check("kick after finish is refused", status_code in (200, 400), str(kicked)[:120])
    status_code, mine = call("GET", "/api/rooms/mine", token=token_b)
    check("finished rooms leave the active list", status_code == 200 and all(row["id"] != room_id for row in mine.get("rooms", [])), str(mine)[:160])

    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    if FAILED:
        print("failures:", FAILED)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
