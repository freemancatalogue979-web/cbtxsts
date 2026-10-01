"""Teacher Network checks — the full Phase 1 loop plus the security rules.

Runs in-process against a throwaway SQLite database:

    cd backend && PYTHONPATH=. .venv/bin/python scripts/verify_teachers.py

Covers: application → staff verification (with history) → discovery/search →
request (rate limits, duplicates) → accept → relationship-gated messaging
(text, attachments, read receipts, blocks) → private notes (never visible to
students) → materials (visibility rules, upload validation, download access)
→ quizzes (builder, bank import, auto-grading, deadline) → teacher groups
(public / request / invite, capacity, code privacy) → reviews (only after a
completed relationship, one each, anonymous, response, moderation) → reports,
suspension, and reputation badges.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import uuid
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="agteach-"))
os.environ.update({"CBT_DATABASE_URL": f"sqlite:///{TMP / 'teach.db'}", "DEEPSEEK_API_KEY": "", "GEMINI_API_KEY": ""})
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import socket  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402
import urllib.error  # noqa: E402
import urllib.request  # noqa: E402

import uvicorn  # noqa: E402

from app.main import app  # noqa: E402

PASSED = FAILED = 0


def check(name: str, ok: bool, detail=None) -> None:
    global PASSED, FAILED
    if ok:
        PASSED += 1
        print(f"  ok   {name}")
    else:
        FAILED += 1
        print(f"  FAIL {name} — {str(detail)[:300]}")


def main() -> None:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(300):
        if server.started:
            break
        time.sleep(0.1)
    base = f"http://127.0.0.1:{port}/api"
    # Wait for the seed to finish.
    for _ in range(300):
        try:
            with urllib.request.urlopen(base + "/health", timeout=5) as r:
                if r.status == 200:
                    break
        except Exception:  # noqa: BLE001
            pass
        time.sleep(0.2)

    def call(method, path, body=None, token=None, raw=False):
        req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                code, data = r.status, r.read()
        except urllib.error.HTTPError as e:
            code, data = e.code, e.read()
        if raw:
            return code, data
        try:
            return code, json.loads(data.decode())
        except ValueError:
            return code, data.decode(errors="replace")

    def upload(path, fields: dict, file_name: str | None, content: bytes | None, token: str):
        boundary = uuid.uuid4().hex
        parts = []
        for key, value in fields.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
        if file_name is not None:
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{file_name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode() + content + b"\r\n")
        parts.append(f"--{boundary}--\r\n".encode())
        req = urllib.request.Request(base + path, data=b"".join(parts), method="POST", headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "Authorization": f"Bearer {token}"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            try:
                return e.code, json.loads(body)
            except ValueError:
                return e.code, body

    def player(label: str):
        name = label.lower() + uuid.uuid4().hex[:5]
        code, body = call("POST", "/auth/register", {"username": name, "password": "secret123", "phone": "0803" + str(uuid.uuid4().int)[:7], "display_name": f"{label} Tester"})
        assert code in (200, 201), body
        return body["token"], body["profile"]["id"]

    code, body = call("POST", "/auth/admin", {"email": "admin@quizarena.ng", "password": "arena2026"})
    admin = body["token"]

    teacher, teacher_sid = player("Ada")
    learner, learner_sid = player("Bola")
    other, other_sid = player("Chidi")
    stranger, stranger_sid = player("Dayo")

    print("\n— application & verification")
    code, body = call("GET", "/teachers/studio/overview", token=teacher)
    check("studio locked before approval", code == 403, body)
    code, body = call("PUT", "/teachers/me/profile", {
        "headline": "Calculus and Physics tutor for 100-level students",
        "bio": "I help first-year students master calculus, mechanics and exam technique with clear worked examples.",
        "experience_years": 6, "institution": "University of Port Harcourt", "languages": ["English", "Pidgin"], "formats": "both",
        "availability": [{"day": d, "start": "00:00", "end": "23:59"} for d in range(7)],
        "specialties": [{"subject": "Mathematics", "topics": ["Calculus", "Algebra"]}, {"subject": "Physics", "topics": ["Mechanics"]}],
    }, token=teacher)
    check("save draft profile", code == 200 and body["profile"]["status"] == "draft", body)
    code, body = call("POST", "/teachers/me/submit", token=teacher)
    check("submit blocked without qualification", code == 422 and "qualification" in str(body), body)
    code, body = upload("/teachers/me/qualifications", {"title": "B.Sc. Mathematics", "institution": "UNIPORT", "year": "2018"}, "cert.exe", b"MZ\x90\x00", teacher)
    check("qualification rejects .exe", code == 415, body)
    code, body = upload("/teachers/me/qualifications", {"title": "B.Sc. Mathematics", "institution": "UNIPORT", "year": "2018"}, "cert.pdf", b"not really a pdf", teacher)
    check("qualification rejects fake PDF (magic bytes)", code == 415, body)
    code, body = upload("/teachers/me/qualifications", {"title": "B.Sc. Mathematics", "institution": "UNIPORT", "year": "2018"}, "cert.pdf", b"%PDF-1.4 certificate", teacher)
    check("qualification with real PDF", code == 200 and body["profile"]["qualifications"][0]["file"]["name"] == "cert.pdf", body)
    qual_file = body["profile"]["qualifications"][0]["file"]["id"]
    qual_id = body["profile"]["qualifications"][0]["id"]
    code, _ = call("GET", f"/teachers/files/{qual_file}", token=learner, raw=True)
    check("qualification document hidden from other players", code == 404, code)
    code, body = call("POST", "/teachers/me/submit", token=teacher)
    check("submit application → pending", code == 200 and body["profile"]["status"] == "pending", body)
    teacher_id = body["profile"]["id"]
    code, body = call("GET", "/teachers", token=learner)
    check("pending teacher not discoverable", code == 200 and body["total"] == 0, body)

    code, body = call("GET", "/admin/teachers?state=pending", token=admin)
    check("admin sees pending queue", code == 200 and any(t["id"] == teacher_id for t in body["items"]), body)
    code, body = call("GET", "/admin/teachers?state=pending", token=learner)
    check("players can't open admin queue", code in (401, 403), body)
    code, body = call("POST", f"/admin/teachers/{teacher_id}/action", {"action": "needs_info", "note": "", "message": ""}, token=admin)
    check("request-info needs a message for the teacher", code == 422, body)
    code, body = call("POST", f"/admin/teachers/{teacher_id}/action", {"action": "needs_info", "note": "ID blurry", "message": "Please upload a clearer certificate."}, token=admin)
    check("staff: request more info", code == 200 and body["status"] == "needs_info", body)
    code, body = call("GET", "/teachers/me/profile", token=teacher)
    check("teacher sees staff message, not internal note", body["profile"]["staff_message"].startswith("Please upload") and "ID blurry" not in json.dumps(body), body)
    call("POST", "/teachers/me/submit", token=teacher)
    code, body = call("POST", f"/admin/teachers/qualifications/{qual_id}", {"status": "verified"}, token=admin)
    check("staff verifies qualification", code == 200, body)
    code, _ = call("GET", f"/admin/teachers/files/{qual_file}", token=admin, raw=True)
    check("staff can open qualification document", code == 200, code)
    code, body = call("POST", f"/admin/teachers/{teacher_id}/action", {"action": "approve", "note": "Checked", "message": ""}, token=admin)
    check("staff approves → verified", code == 200 and body["status"] == "approved" and body["verified"], body)
    check("verification history logged", [h["action"] for h in body["history"]][:3] == ["approve", "qualification_verified", "submitted"], body.get("history"))

    print("\n— discovery")
    code, body = call("GET", "/teachers?q=calculus", token=learner)
    check("search by topic finds teacher", code == 200 and body["total"] == 1 and body["items"][0]["id"] == teacher_id, body)
    card = body["items"][0]
    check("card shows verified + badges, no phone", card["verified"] and any(b["key"] == "verified" for b in card["badges"]) and "phone" not in json.dumps(card), card)
    check("public name is shortened", card["name"] == "Ada T.", card["name"])
    code, body = call("GET", "/teachers?subject=Chemistry", token=learner)
    check("subject filter excludes", body["total"] == 0, body)
    code, body = call("GET", "/teachers?language=Pidgin&min_experience=5&verified=true", token=learner)
    check("language/experience/verified filters", body["total"] == 1, body)
    code, body = call("GET", f"/teachers/{teacher_id}", token=learner)
    check("public profile", code == 200 and body["qualifications"][0]["verified"] and not body["can_message"] and not body["can_review"], body)
    check("profile never exposes documents", "file_id" not in json.dumps(body) and "path" not in json.dumps(body["qualifications"]), body["qualifications"])

    print("\n— requests")
    code, body = call("POST", "/chat", {"to": teacher_sid, "body": "hi"}, token=learner)
    check("no messaging before a request", code == 403, body)
    code, body = call("POST", f"/teachers/{teacher_id}/requests", {"subject": "Mathematics", "topic": "Calculus", "message": "short", "format": "one"}, token=learner)
    check("request message too short", code == 422, body)
    code, body = call("POST", f"/teachers/{teacher_id}/requests", {"subject": "Mathematics", "topic": "Calculus", "message": "I struggle with differentiation and need help before my exam.", "format": "one", "preferred_time": "Evenings"}, token=learner)
    check("student sends request", code == 200 and body["status"] == "pending", body)
    request_id = body["id"]
    code, body = call("POST", f"/teachers/{teacher_id}/requests", {"message": "Another request for the same teacher please.", "format": "one"}, token=learner)
    check("duplicate pending request blocked", code == 409, body)
    code, body = call("POST", f"/teachers/{teacher_id}/requests", {"message": "Requesting myself for some reason here.", "format": "one"}, token=teacher)
    check("teacher can't request self", code == 400, body)
    code, body = call("POST", "/chat", {"to": teacher_sid, "body": "Hello, I sent a request"}, token=learner)
    check("pending request opens messaging", code == 200, body)
    code, body = call("GET", "/teachers/studio/overview", token=teacher)
    check("studio overview counts request", code == 200 and body["today"]["new_requests"] == 1 and body["today"]["unread_messages"] == 1, body.get("today"))
    code, body = call("POST", f"/teachers/studio/requests/{request_id}/accept", {"note": "Happy to help!"}, token=other)
    check("non-teacher can't accept", code == 403, body)
    code, body = call("POST", f"/teachers/studio/requests/{request_id}/accept", {"note": "Happy to help!"}, token=teacher)
    check("teacher accepts", code == 200 and body["status"] == "accepted", body)
    code, body = call("POST", f"/teachers/studio/requests/{request_id}/decline", {}, token=teacher)
    check("can't re-decide a request", code == 409, body)
    code, body = call("GET", "/teachers/me/learning", token=learner)
    check("student sees teacher in My Teachers", len(body["teachers"]) == 1 and body["teachers"][0]["relationship"]["status"] == "active", body.get("teachers"))
    relationship_id = body["teachers"][0]["relationship"]["id"]

    # Rate limit: 5 pending requests max (needs 5 more live teachers).
    extra_ids = []
    for i in range(5):
        tok, _ = player(f"T{i}")
        call("PUT", "/teachers/me/profile", {"headline": "Biology teacher for secondary school", "bio": "x" * 80, "languages": ["English"], "specialties": [{"subject": "Biology", "topics": ["Genetics"]}]}, token=tok)
        upload("/teachers/me/qualifications", {"title": "B.Sc."}, None, None, tok)
        _, b = call("POST", "/teachers/me/submit", token=tok)
        call("POST", f"/admin/teachers/{b['profile']['id']}/action", {"action": "approve"}, token=admin)
        extra_ids.append(b["profile"]["id"])
    results = [call("POST", f"/teachers/{tid}/requests", {"message": "Please help me understand genetics better.", "format": "either"}, token=other)[0] for tid in extra_ids]
    check("five pending requests allowed", results == [200] * 5, results)
    code, body = call("POST", f"/teachers/{teacher_id}/requests", {"message": "Please help me understand calculus better.", "format": "either"}, token=other)
    check("sixth pending request rate-limited", code == 429, body)

    print("\n— messaging")
    code, body = call("POST", "/chat", {"to": learner_sid, "body": "Welcome! Let's start with limits."}, token=teacher)
    check("teacher messages student", code == 200, body)
    code, body = call("GET", "/teachers/conversations", token=learner)
    item = next((c for c in body["items"] if c["with"]["id"] == teacher_sid), None)
    check("conversation list shows teacher role + unread", item is not None and item["role"] == "teacher" and item["unread"] == 1, body)
    code, body = call("POST", f"/chat/read?with={teacher_sid}", token=learner)
    check("mark read", code == 200 and body["marked"] == 1, body)
    code, body = call("POST", "/chat", {"to": learner_sid, "body": "hi"}, token=stranger)
    check("stranger can't message student", code == 403, body)
    code, body = upload("/teachers/files", {"purpose": "chat"}, "notes.txt", b"Limits worksheet", learner)
    check("chat attachment upload", code == 200, body)
    chat_file = body["id"]
    code, body = call("POST", "/chat", {"to": teacher_sid, "kind": "file", "meta": {"id": chat_file, "name": "fake.exe"}}, token=learner)
    check("attachment message (server fills metadata)", code == 200 and body["meta"]["name"] == "notes.txt", body)
    code, _ = call("GET", f"/teachers/files/{chat_file}", token=teacher, raw=True)
    check("recipient can download attachment", code == 200, code)
    code, _ = call("GET", f"/teachers/files/{chat_file}", token=stranger, raw=True)
    check("others can't download attachment", code == 404, code)
    code, body = call("POST", "/chat", {"to": teacher_sid, "kind": "file", "meta": {"id": qual_file}}, token=learner)
    check("can't send someone else's file", code == 422, body)
    code, _ = upload("/teachers/files", {"purpose": "chat"}, "big.pdf", b"%PDF" + b"0" * (15 * 1024 * 1024 + 10), learner)
    check("15 MB upload limit", code == 413, code)

    print("\n— private notes")
    code, body = call("PUT", f"/teachers/studio/students/{learner_sid}/notes", {"weak_areas": "Chain rule", "progress": "Improving", "next_step": "Practice integration", "body": "Gets anxious under time pressure."}, token=teacher)
    check("teacher saves private note", code == 200, body)
    code, body = call("GET", f"/teachers/studio/students/{learner_sid}", token=teacher)
    check("teacher reads note", body["notes"]["weak_areas"] == "Chain rule", body.get("notes"))
    leaks = []
    for path in ["/teachers/me/learning", f"/teachers/{teacher_id}", "/teachers/conversations", f"/chat?with={teacher_sid}", f"/teachers/studio/students/{learner_sid}"]:
        _, b = call("GET", path, token=learner)
        if "anxious" in json.dumps(b) or "Chain rule" in json.dumps(b):
            leaks.append(path)
    check("private note never reaches the student", not leaks, leaks)
    code, body = call("PUT", f"/teachers/studio/students/{stranger_sid}/notes", {"body": "x"}, token=teacher)
    check("no notes on non-students", code == 404, body)

    print("\n— materials")
    code, body = upload("/teachers/files", {"purpose": "material"}, "sheet.pdf", b"%PDF-1.5 worksheet", learner)
    check("non-teacher can't upload materials", code == 403, body)
    code, body = upload("/teachers/files", {"purpose": "material"}, "sheet.pdf", b"%PDF-1.5 worksheet", teacher)
    material_file = body["id"]
    made = {}
    for vis in ["private", "students", "public"]:
        code, body = call("POST", "/teachers/studio/materials", {"title": f"Limits ({vis})", "kind": "file", "file_id": material_file, "visibility": vis, "subject": "Mathematics", "topic": "Calculus"}, token=teacher)
        made[vis] = body["id"]
    check("materials created", len(made) == 3, made)
    code, _ = call("GET", f"/teachers/materials/{made['private']}", token=learner)
    check("private material hidden from student", code == 404, code)
    code, _ = call("GET", f"/teachers/materials/{made['students']}", token=learner)
    check("students-only material visible to my student", code == 200, code)
    code, _ = call("GET", f"/teachers/materials/{made['students']}", token=stranger)
    check("students-only material hidden from stranger", code == 404, code)
    code, _ = call("GET", f"/teachers/materials/{made['public']}", token=stranger)
    check("public material visible to anyone", code == 200, code)
    code, _ = call("GET", f"/teachers/files/{material_file}?download=true", token=learner, raw=True)
    check("material file download via visible material", code == 200, code)
    code, body = call("GET", "/teachers/studio/materials", token=teacher)
    stats = next(m for m in body["items"] if m["id"] == made["students"])["stats"]
    check("material analytics (views, downloads)", stats["views"] == 1 and stats["unique_viewers"] == 1 and stats["downloads"] >= 1, stats)
    code, body = call("POST", "/teachers/studio/materials", {"title": "Bad link", "kind": "link", "link": "javascript:alert(1)", "visibility": "public"}, token=teacher)
    check("unsafe links rejected", code == 422, body)
    code, body = call("POST", "/chat", {"to": stranger_sid, "kind": "material", "meta": {"id": made["private"]}}, token=teacher)
    check("can't share into a non-relationship chat", code == 403, body)
    code, body = call("POST", "/chat", {"to": learner_sid, "kind": "material", "meta": {"id": made["private"]}}, token=teacher)
    check("share private material in chat", code == 200 and body["meta"]["title"].startswith("Limits"), body)
    code, _ = call("GET", f"/teachers/materials/{made['private']}", token=learner)
    check("shared material now opens for that student", code == 200, code)

    print("\n— quizzes")
    code, body = call("POST", "/teachers/studio/quizzes", {"title": "Limits check", "time_limit_minutes": 10, "pass_mark": 60, "visibility": "students", "questions": [
        {"kind": "mcq", "prompt": "lim x→0 sin(x)/x = ?", "options": ["0", "1", "∞", "undefined"], "answer": "B", "explanation": "Standard limit."},
        {"kind": "tf", "prompt": "The derivative of a constant is zero.", "answer": "true"},
        {"kind": "short", "prompt": "Name the rule for d/dx f(g(x)).", "answer": "chain rule|the chain rule"},
        {"kind": "numeric", "prompt": "d/dx x² at x=1.5", "answer": "3", "tolerance": 0.01, "marks": 2},
    ]}, token=teacher)
    check("quiz builder (4 types)", code == 200 and body["question_count"] == 4 and body["status"] == "draft", body)
    quiz_id = body["id"]
    code, body = call("POST", "/teachers/studio/quizzes", {"title": "Broken", "questions": [{"kind": "mcq", "prompt": "Pick one", "options": ["a", "b"], "answer": "D"}]}, token=teacher)
    check("invalid MCQ answer rejected", code == 422, body)
    code, _ = call("GET", f"/teachers/quizzes/{quiz_id}", token=learner)
    check("draft quiz hidden from students", code == 404, code)
    code, body = call("POST", f"/teachers/studio/quizzes/{quiz_id}/publish", token=teacher)
    check("publish quiz", code == 200 and body["status"] == "published", body)
    code, body = call("POST", f"/teachers/quizzes/{quiz_id}/start", token=learner)
    check("student starts quiz, answers hidden", code == 200 and "answer" not in json.dumps(body["questions"]) and body["remaining_seconds"] > 500, body)
    attempt_id = body["id"]
    qids = [q["id"] for q in body["questions"]]
    code, body = call("POST", f"/teachers/quizzes/attempts/{attempt_id}/submit", {"answers": {str(qids[0]): "b", str(qids[1]): "True", str(qids[2]): "  The Chain-Rule ", str(qids[3]): "3.005"}}, token=learner)
    check("auto-grading (mcq/tf/short/numeric tolerance)", code == 200 and body["score"] == 4 and body["max_score"] == 5 and body["passed"], body)
    code, body = call("POST", f"/teachers/quizzes/{quiz_id}/start", token=stranger)
    check("stranger can't take students-only quiz", code == 404, body)
    code, body = call("GET", f"/teachers/studio/quizzes/{quiz_id}/results", token=teacher)
    check("teacher sees results + completion", code == 200 and body["quiz"]["stats"]["attempts"] == 1 and body["completion"] == 100, body)
    code, body = call("GET", "/courses", token=learner)
    courses = body if isinstance(body, list) else body.get("items", body.get("courses", []))
    if courses:
        code, body = call("POST", "/teachers/studio/quizzes/bank-preview", {"course_id": courses[0]["id"], "count": 5}, token=teacher)
        check("import from Genesis question bank", code == 200 and len(body["items"]) > 0 and body["items"][0]["kind"] == "mcq", body)
    code, body = call("DELETE", f"/teachers/studio/quizzes/{quiz_id}", token=teacher)
    check("delete with attempts archives instead", code == 200 and body["archived"], body)

    print("\n— teacher groups")
    groups = {}
    for privacy, cap in [("public", 1), ("request", 10), ("invite", 10)]:
        code, body = call("POST", "/teachers/studio/groups", {"name": f"Calculus {privacy} circle", "subject": "Mathematics", "topic": "Calculus", "privacy": privacy, "capacity": cap}, token=teacher)
        groups[privacy] = body
    check("teacher creates groups", all(g.get("id") for g in groups.values()), groups)
    code, body = call("GET", "/teachers/groups/discover", token=stranger)
    names = {g["privacy"] for g in body["items"]}
    check("invite-only groups not discoverable", names == {"public", "request"}, names)
    check("join codes hidden from non-members", all(g["code"] is None for g in body["items"]), body["items"])
    code, body = call("POST", f"/teachers/groups/{groups['public']['id']}/join", {}, token=learner)
    check("join public group", code == 200 and body["is_member"], body)
    code, body = call("POST", f"/teachers/groups/{groups['public']['id']}/join", {}, token=stranger)
    check("capacity enforced", code == 409, body)
    code, body = call("POST", f"/groups/{groups['public']['id']}/join", token=stranger)
    check("capacity enforced on legacy join path", code == 409, body)
    code, body = call("POST", f"/groups/{groups['request']['id']}/join", token=stranger)
    check("request group can't be joined directly", code == 403, body)
    code, body = call("POST", f"/teachers/groups/{groups['request']['id']}/join", {"message": "Please add me"}, token=stranger)
    check("ask to join request group", code == 200 and body["request_pending"] and not body["is_member"], body)
    code, body = call("GET", f"/teachers/studio/groups/{groups['request']['id']}/requests", token=teacher)
    join_request = body["items"][0]["id"]
    code, body = call("POST", f"/teachers/studio/groups/{groups['request']['id']}/requests/{join_request}/approve", token=teacher)
    check("teacher approves join request", code == 200 and body["status"] == "approved", body)
    code, body = call("GET", f"/groups/{groups['request']['id']}", token=stranger)
    check("approved member opens group home", code == 200, body)
    code, body = call("POST", f"/teachers/groups/{groups['invite']['id']}/join", {}, token=other)
    check("invite-only group refuses direct join", code == 403, body)
    code, body = call("POST", f"/teachers/studio/groups/{groups['invite']['id']}/invite", {"student_id": stranger_sid}, token=teacher)
    check("can only invite own students", code == 403, body)
    code, body = call("POST", f"/teachers/studio/groups/{groups['invite']['id']}/invite", {"student_id": learner_sid}, token=teacher)
    check("invite own student", code == 200, body)
    code, body = call("POST", f"/groups/join/{groups['invite']['code']}", token=learner)
    check("invite code joins invite-only group", code == 200 and body.get("is_member"), body)

    print("\n— reviews")
    code, body = call("POST", f"/teachers/{teacher_id}/reviews", {"rating": 5, "body": "Great"}, token=learner)
    check("no review while relationship active", code == 403, body)
    code, body = call("POST", f"/teachers/{teacher_id}/reviews", {"rating": 1, "body": "Bad"}, token=stranger)
    check("no review without relationship", code == 403, body)
    code, body = call("POST", f"/teachers/relationships/{relationship_id}/complete", token=learner)
    check("student completes relationship", code == 200 and body["status"] == "completed", body)
    code, body = call("POST", "/chat", {"to": teacher_sid, "body": "Thanks for everything!"}, token=learner)
    check("messaging continues after completion", code == 200, body)
    code, body = call("POST", f"/teachers/{teacher_id}/reviews", {"rating": 5, "body": "Very patient and clear. My calculus improved a lot.", "anonymous": True}, token=learner)
    check("review after completion", code == 200 and body["author"] == "Anonymous student", body)
    review_id = body["id"]
    code, body = call("POST", f"/teachers/{teacher_id}/reviews", {"rating": 4, "body": "Again"}, token=learner)
    check("one review per relationship", code == 409, body)
    code, body = call("GET", f"/teachers/{teacher_id}", token=stranger)
    check("anonymous review hides author from public", body["reviews"][0]["author"] == "Anonymous student" and "Bola" not in json.dumps(body["reviews"]), body["reviews"])
    code, body = call("POST", f"/teachers/reviews/{review_id}/response", {"response": "Thank you, keep practising!"}, token=teacher)
    check("teacher responds to review", code == 200 and body["teacher_response"].startswith("Thank"), body)
    code, body = call("POST", f"/teachers/reviews/{review_id}/response", {"response": "Hijack"}, token=other)
    check("others can't respond", code == 403, body)
    code, body = call("POST", "/teachers/report", {"kind": "teacher_review", "target_id": review_id, "reason": "Looks fake to me"}, token=teacher)
    check("report review", code == 200, body)
    code, body = call("GET", "/admin/teachers/moderation/reports", token=admin)
    report = next(r for r in body["items"] if r["kind"] == "teacher_review")
    check("report reaches staff queue with target", report["target"]["label"].startswith("5★"), report)
    code, body = call("POST", f"/admin/teachers/moderation/reports/{report['id']}", {"status": "resolved", "action": "hide_review"}, token=admin)
    check("staff hides review via report", code == 200 and body["status"] == "resolved", body)
    code, body = call("GET", f"/teachers/{teacher_id}", token=stranger)
    check("hidden review gone from profile & stats", body["reviews"] == [] and body["stats"]["review_count"] == 0, body["stats"])
    call("POST", f"/admin/teachers/moderation/reviews/{review_id}", {"status": "visible"}, token=admin)

    print("\n— reputation")
    code, body = call("GET", f"/teachers/{teacher_id}", token=stranger)
    st = body["stats"]
    check("explainable stats (rating, reviews, students, completed)", st["rating"] == 5.0 and st["review_count"] == 1 and st["students_taught"] == 1 and st["completed_relationships"] == 1, st)
    check("no opaque score exposed", "score" not in st and all("reason" in b for b in body["badges"]), body["badges"])
    keys = {b["key"] for b in body["badges"]}
    check("badges: verified, experienced, new", {"verified", "experienced", "new"} <= keys, keys)

    print("\n— blocks & suspension")
    code, body = call("POST", f"/teachers/blocks/{teacher_sid}", token=learner)
    check("student blocks teacher", code == 200, body)
    code, body = call("POST", "/chat", {"to": learner_sid, "body": "Hello?"}, token=teacher)
    check("block stops messages", code == 403, body)
    code, body = call("GET", "/teachers?q=calculus", token=learner)
    check("blocked teacher hidden from search", body["total"] == 0, body)
    call("DELETE", f"/teachers/blocks/{teacher_sid}", token=learner)
    code, body = call("POST", f"/admin/teachers/{teacher_id}/action", {"action": "suspend", "note": "Investigation", "message": "Your account is under review."}, token=admin)
    check("staff suspends teacher", code == 200 and body["status"] == "suspended", body)
    code, body = call("GET", "/teachers/studio/overview", token=teacher)
    check("suspended teacher locked out of studio", code == 403 and "suspended" in str(body), body)
    code, body = call("GET", "/teachers?q=calculus", token=learner)
    check("suspended teacher hidden from discovery", body["total"] == 0, body)
    code, _ = call("GET", f"/teachers/materials/{made['public']}", token=stranger)
    check("suspended teacher's materials hidden", code == 404, code)
    code, body = call("POST", f"/admin/teachers/{teacher_id}/action", {"action": "reinstate", "message": ""}, token=admin)
    check("staff reinstates", code == 200 and body["status"] == "approved", body)
    actions = [h["action"] for h in body["history"]]
    check("full audit history", actions[:2] == ["reinstate", "suspend"] and "approve" in actions, actions)

    print(f"\n{PASSED} passed, {FAILED} failed")
    server.should_exit = True
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
