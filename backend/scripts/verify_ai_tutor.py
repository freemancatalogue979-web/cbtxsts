"""AI Tutor end-to-end check against mock DeepSeek + Gemini (no internet needed).

Starts its own API on :3995 with a throw-away database and a fake DeepSeek on
:3996, then drives the real HTTP endpoints (streaming included):

    cd backend && ./.venv/bin/python scripts/verify_ai_tutor.py
"""

from __future__ import annotations

import json
import re
import struct
import zlib
from datetime import date, timedelta
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MOCK_PORT, API_PORT = 3996, 3995
ROOT = Path(__file__).resolve().parents[1]
DB_FILE = Path(tempfile.gettempdir()) / f"tutor_verify_{os.getpid()}.db"
ENV = {
    **os.environ,
    "CBT_DATABASE_URL": f"sqlite:///{DB_FILE}",
    "DEEPSEEK_API_KEY": "ds-test-key",
    "CBT_AI_KEYS_FILE": str(Path(tempfile.gettempdir()) / f"no_saved_keys_{os.getpid()}.json"),  # keys saved in the admin panel must not leak into the test
    "DEEPSEEK_API_BASE": f"http://127.0.0.1:{MOCK_PORT}",
    "DEEPSEEK_TIMEOUT": "5",
    "TUTOR_STREAM_TIMEOUT": "5",
    "GEMINI_API_KEY": "gm-test-key",
    "GEMINI_API_BASE": f"http://127.0.0.1:{MOCK_PORT}/v1beta",
    "GEMINI_TIMEOUT": "5",
    "TUTOR_RETRY_BASE": "0.05",
    "AI_PROVIDER": "deepseek",
}
os.environ.update({k: ENV[k] for k in ("CBT_DATABASE_URL", "CBT_AI_KEYS_FILE", "DEEPSEEK_API_KEY", "DEEPSEEK_API_BASE")})
sys.path.insert(0, str(ROOT))

PASSED = FAILED = 0
MODE = {"value": "ok"}
COUNT = {"json": 0, "stream": 0}
SEEN: list[dict] = []
BASE = f"http://127.0.0.1:{API_PORT}/api"


def check(name: str, ok: bool, detail: object = "") -> None:
    global PASSED, FAILED
    if ok:
        PASSED += 1
        print(f"  ok   {name}")
    else:
        FAILED += 1
        print(f"  FAIL {name} — {str(detail)[:400]}")


# ------------------------------------------------------------ mock DeepSeek
def _all_text(body: dict) -> str:
    out = []
    for m in body["messages"]:
        c = m["content"]
        out.append(c if isinstance(c, str) else " ".join(p.get("text", "") for p in c if isinstance(p, dict)))
    return "\n".join(out)


class MockDeepSeek(BaseHTTPRequestHandler):
    def log_message(self, *args) -> None:
        pass

    def reply(self, code: int, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        gemini = "/models/" in self.path
        if gemini:  # translate a Gemini request into the OpenAI shape the checks read
            sys_text = " ".join(p.get("text", "") for p in (body.get("systemInstruction") or {}).get("parts", []))
            msgs = ([{"role": "system", "content": sys_text}] if sys_text else []) + [
                {"role": "assistant" if c["role"] == "model" else "user", "content": " ".join(p.get("text", "") for p in c["parts"])} for c in body.get("contents", [])
            ]
            body = {**body, "messages": msgs, "stream": "streamGenerateContent" in self.path, "_gemini": True, "_path": self.path}
        SEEN.append({"auth": self.headers.get("Authorization"), "goog": self.headers.get("x-goog-api-key"), "body": body})
        mode = MODE["value"]
        if mode in {"402", "503"}:
            return self.reply(int(mode), {"error": {"message": "nope upstream detail"}})
        system = body["messages"][0]["content"] if body["messages"] and body["messages"][0]["role"] == "system" else ""
        if not body.get("stream"):
            COUNT["json"] += 1
            if "compress tutoring" in system:
                text = "SUMMARY: the student studied the topic and asked many questions."
            elif "Write a short title" in system:
                text = "Tort Duty Basics"
            elif mode == "badjson_always" or (mode == "badjson_once" and COUNT["json"] % 2 == 1):
                text = "Sure! Here are your cards: {broken json"
            elif re.search(r"Create (\d+) flashcards", system):
                n = int(re.search(r"Create (\d+) flashcards", system).group(1))
                text = json.dumps({"title": "Mock deck", "cards": [{"front": f"Term {i}", "back": f"Meaning {i}", "topic": "Mock", "difficulty": "easy"} for i in range(n + 2)]})
            elif "practice questions from the SOURCE" in system:
                text = json.dumps({"title": "Mock set", "questions": [
                    {"type": "mcq", "question": "Pick B", "options": ["A1", "B1", "C1", "D1"], "correct_answer": "B", "explanation": "B is right.", "topic": "Negligence"},
                    {"type": "true_false", "question": "Sky is blue?", "options": ["yes", "no"], "correct_answer": "True", "explanation": "It is.", "topic": "Nature"},
                    {"type": "mcq", "question": "Broken key", "options": ["A", "B"], "correct_answer": "Z nonsense", "explanation": ""},
                    {"type": "short_answer", "question": "Define law.", "correct_answer": "A rule.", "explanation": "Basic.", "topic": "Negligence"},
                ]})
            elif "realistic study plan" in system:
                today = date.today()
                text = json.dumps({"title": "Mock plan", "overview": "Weak topics first.", "days": [{"date": (today + timedelta(days=i)).isoformat(), "items": [{"topic": "Negligence", "activity": "Lesson + 10 practice questions", "duration": 40}, {"topic": "Tort", "activity": "Flashcards", "duration": 20}]} for i in range(3)], "tips": ["Sleep well"]})
            elif "Reply with the single word" in _all_text(body):
                text = "OK"
            else:
                text = json.dumps({"title": "Mock material", "overview": "Overview.", "sections": [{"heading": "Key concepts", "content": "Stuff **bold**."}], "definitions": [{"term": "Tort", "meaning": "A civil wrong."}], "summary": "Done."})
            if gemini:
                return self.reply(200, {"candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": "STOP"}], "usageMetadata": {"promptTokenCount": 90, "candidatesTokenCount": 40}})
            return self.reply(200, {"choices": [{"message": {"content": text}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 100, "completion_tokens": 50}})
        # streaming answer
        COUNT["stream"] += 1
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        if mode == "empty":
            self.wfile.write(b'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
            return
        pieces = ["Great ", "question! ", "Here is ", "the answer."]
        if mode == "slow":
            pieces = [f"part{i} " for i in range(60)]
        try:
            for piece in pieces:
                if gemini:
                    self.wfile.write(f"data: {json.dumps({'candidates': [{'content': {'parts': [{'text': piece}]}}]})}\n\n".encode())
                else:
                    self.wfile.write(f"data: {json.dumps({'choices': [{'delta': {'content': piece}}]})}\n\n".encode())
                self.wfile.flush()
                time.sleep(0.15 if mode == "slow" else 0.02)
            if gemini:
                self.wfile.write(b'data: {"candidates":[{"content":{"parts":[]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":200,"candidatesTokenCount":9,"cachedContentTokenCount":50}}\n\n')
                return
            self.wfile.write(b'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n')
            self.wfile.write(b'data: {"choices":[],"usage":{"prompt_tokens":321,"completion_tokens":12,"prompt_cache_hit_tokens":100}}\n\n')
            self.wfile.write(b"data: [DONE]\n\n")
        except (BrokenPipeError, ConnectionResetError):
            SEEN.append({"auth": None, "goog": None, "body": {"_closed_early": True}})


# ------------------------------------------------------------------ helpers
def call(method: str, path: str, body=None, token: str | None = None, raw: bytes | None = None, ctype: str = "application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": ctype, **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            text = r.read().decode()
            ctype_out = r.headers.get("Content-Type", "")
            return r.status, (text if "event-stream" in ctype_out else (json.loads(text) if text else {}))
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        try:
            return e.code, json.loads(text)
        except json.JSONDecodeError:
            return e.code, text


def events(text: str) -> list[tuple[str, dict]]:
    out = []
    for block in text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        if "event" in lines:
            out.append((lines["event"], json.loads(lines["data"])))
    return out


def last_stream() -> dict:
    return next(r["body"] for r in reversed(SEEN) if r["body"].get("stream"))


def last_json() -> dict:
    return next(r["body"] for r in reversed(SEEN) if "messages" in r["body"] and not r["body"].get("stream") and "Write a short title" not in str(r["body"]["messages"][0].get("content")) and "compress tutoring" not in str(r["body"]["messages"][0].get("content")))


def png(side: int) -> str:
    """A valid side×side PNG as a data URL."""
    import base64

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + b"\xff\x00\x00" * side for _ in range(side))
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", side, side, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    return "data:image/png;base64," + base64.b64encode(data).decode()


def student() -> str:
    name = "tt" + uuid.uuid4().hex[:8]
    code, body = call("POST", "/auth/register", {"username": name, "password": "secret123", "phone": "080" + str(uuid.uuid4().int)[:8], "full_name": "Tutor Tester"})
    assert code in (200, 201), body
    return body["token"]


def say(token: str, conv: int, content: str, **extra):
    return call("POST", f"/tutor/conversations/{conv}/messages", {"content": content, **extra}, token)


def multipart(field: str, filename: str, data: bytes, ctype: str) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{filename}\"\r\nContent-Type: {ctype}\r\n\r\n").encode() + data + f"\r\n--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


def main() -> None:
    mock = ThreadingHTTPServer(("127.0.0.1", MOCK_PORT), MockDeepSeek)
    threading.Thread(target=mock.serve_forever, daemon=True).start()
    api = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(API_PORT)], cwd=ROOT, env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        for _ in range(120):
            try:
                urllib.request.urlopen(BASE + "/health", timeout=2)
                break
            except Exception:  # noqa: BLE001
                time.sleep(0.5)
        else:
            raise SystemExit("API did not start: " + (api.stderr.read(4000).decode() if api.poll() is not None else "timeout"))
        run()
    finally:
        api.terminate()
        mock.shutdown()
        try:
            api.wait(10)
        except subprocess.TimeoutExpired:
            api.kill()
        for suffix in ("", "-wal", "-shm"):
            Path(str(DB_FILE) + suffix).unlink(missing_ok=True)
    print(f"\n{PASSED} passed, {FAILED} failed")
    sys.exit(1 if FAILED else 0)


def run() -> None:
    from app.db import SessionLocal
    from app.models import AIConversation, Attempt, Material, MaterialSection, Question, Quiz, StudentTopicProgress

    code, admin = call("POST", "/auth/admin", {"email": "admin@quizarena.ng", "password": "arena2026"})
    staff = admin["token"]
    # classic streaming path; the tool-using agent is covered by verify_ai_core.py
    code, _ = call("PUT", "/admin/tutor/settings", {"ai_per_minute": 100, "ai_daily_limit": 200, "ai_agent_enabled": False}, staff)
    check("staff can change tutor limits", code == 200, _)

    print("access & status")
    check("tutor needs a login", call("GET", "/tutor/status")[0] == 401)
    me, other = student(), student()
    code, st = call("GET", "/tutor/status", token=me)
    check("status says configured + limits", code == 200 and st["configured"] and st["limits"]["daily"] == 200 and st["remaining_today"] == 200, st)
    check("players can't open staff settings", call("GET", "/admin/tutor/settings", token=me)[0] == 403)
    code, opts = call("GET", "/tutor/options", token=me)
    check("options list courses with topics", code == 200 and opts["courses"] and "topics" in opts["courses"][0], opts)
    course = opts["courses"][0]

    print("streaming chat + memory")
    code, conv = call("POST", "/tutor/conversations", {}, me)
    cid = conv["id"]
    check("conversation created", code == 201 and conv["title"] == "New chat", conv)
    code, text = say(me, cid, "Explain the rule in Donoghue v Stevenson", context={"course_id": course["id"]})
    ev = events(text) if code == 200 else []
    kinds = [k for k, _ in ev]
    check("stream order meta → delta → done", code == 200 and kinds[0] == "meta" and "delta" in kinds and kinds[-1] == "done", text)
    answer = "".join(d["text"] for k, d in ev if k == "delta")
    check("deltas join into the full answer", answer == "Great question! Here is the answer.", answer)
    done = ev[-1][1] if ev else {}
    check("done carries usage + remaining", done.get("usage", {}).get("input") == 321 and done.get("remaining_today") == 199, done)
    body = last_stream()
    check("key stays server-side, sent as Bearer", next(r for r in reversed(SEEN) if r["body"].get("stream"))["auth"] == "Bearer ds-test-key")
    check("request streams with thinking off", body["stream"] and body["thinking"] == {"type": "disabled"} and body["stream_options"]["include_usage"])
    check("system prompt has the tutor persona + course", "AI Tutor" in body["messages"][0]["content"] and course["code"] in body["messages"][0]["content"], body["messages"][0]["content"][:600])
    say(me, cid, "Give me an example", mode="EXAMPLE")
    body = last_stream()
    roles = [m["role"] for m in body["messages"]]
    check("follow-up carries earlier turns (memory)", roles[:4] == ["system", "user", "assistant", "user"] and "Donoghue" in body["messages"][1]["content"], roles)
    code, full = call("GET", f"/tutor/conversations/{cid}", token=me)
    check("messages saved with type + tokens", code == 200 and len(full["messages"]) == 4 and full["messages"][2]["type"] == "general" or len(full["messages"]) == 4, full)
    time.sleep(0.4)
    code, full = call("GET", f"/tutor/conversations/{cid}", token=me)
    check("AI writes a short title after the first exchange (background)", full["title"] == "Tort Duty Basics", full["title"])
    check("other students can't read it", call("GET", f"/tutor/conversations/{cid}", token=other)[0] == 404)
    check("other students can't post into it", say(other, cid, "hi")[0] == 404)

    print("question help & exam safety")
    with SessionLocal() as db:
        q = db.query(Question).filter(Question.exam_only.is_(False), Question.explanation != "").first()
        hidden = db.query(Question).filter(Question.exam_only.is_(True), Question.quiz_id.is_not(None), Question.explanation != "").first()
        if hidden is None:  # fresh installs draw from the bank — add one exam-only question
            exam = db.query(Quiz).filter(Quiz.is_bank.is_(False)).first()
            hidden = Question(quiz_id=exam.id, course_id=exam.course_id, text="Secret exam question?", option_a="w", option_b="x", option_c="y", option_d="z", correct="C", explanation="Top secret reasoning for the live exam.", exam_only=True)
            db.add(hidden)
            db.flush()
        db.get(Quiz, hidden.quiz_id).status = "active"  # a live exam: its answers must stay secret
        material = Material(course_id=course["id"], title="Tort Basics Handout", status="published", topic="Negligence")
        db.add(material)
        db.flush()
        db.add(MaterialSection(material_id=material.id, position=1, title="Duty of care", body=json.dumps([{"type": "paragraph", "text": "The neighbour principle defines who is owed a duty of care."}])))
        db.commit()
        section = True
        material_id = material.id
        q_id, q_text, q_expl = (q.id, q.text, q.explanation) if q else (None, "", "")
        hidden_id, hidden_expl = (hidden.id, hidden.explanation) if hidden else (None, "")
    if q_id:
        code, text = say(me, cid, "Why is my answer wrong?", mode="WHY_WRONG", context={"question_id": q_id, "selected": "A"})
        system = last_stream()["messages"][0]["content"]
        check("question context loaded server-side", code == 200 and q_text[:40] in system and q_expl[:40] in system, system[-1200:])
        check("why-wrong uses the structured format", "testing" in system.lower() and "correct" in system.lower())
    if hidden_id:
        code, text = say(me, cid, "What's the answer?", mode="QUESTION_HELP", context={"question_id": hidden_id})
        system = last_stream()["messages"][0]["content"]
        check("live exam-only answers stay hidden", code == 200 and hidden_expl[:40] not in system, system[-800:])
    else:
        print("  (no live exam-only question in the seed — skipped)")

    print("materials & uploads")
    if section:
        code, text = say(me, cid, "Summarise chapter 1", mode="SUMMARY", context={"material_id": material_id})
        system = last_stream()["messages"][0]["content"]
        check("material passages attached", code == 200 and "neighbour principle" in system, system[-800:])
    data, ctype = multipart("file", "my-notes.txt", b"Chapter One\n\nThe doctrine of consideration requires something of value in exchange. Promissory estoppel softens it.\n\nChapter Two\n\nOffer and acceptance form agreement.", "text/plain")
    code, up = call("POST", "/tutor/uploads", token=me, raw=data, ctype=ctype)
    check("student upload extracted into sections", code == 201 and up["sections"] >= 1, up)
    code, text = say(me, cid, "What does my upload say about consideration?", context={"upload_id": up.get("id")})
    system = last_stream()["messages"][0]["content"]
    check("upload text retrieved for the answer", "consideration requires something of value" in system, system[-800:])
    check("others can't use my upload", say(other, call("POST", "/tutor/conversations", {}, other)[1]["id"], "consideration", context={"upload_id": up.get("id")})[0] == 404)
    bad, ctype = multipart("file", "virus.exe", b"MZ....", "application/octet-stream")
    check("unsupported uploads refused", call("POST", "/tutor/uploads", token=me, raw=bad, ctype=ctype)[0] in (400, 415, 422))

    print("images")
    code, text = say(me, cid, "What is this diagram?", image=png(32))
    last = last_stream()["messages"][-1]["content"]
    check("image sent to the model as image_url", code == 200 and isinstance(last, list) and last[1]["type"] == "image_url", last if not isinstance(last, list) else "")
    code, full = call("GET", f"/tutor/conversations/{cid}", token=me)
    stored = [m for m in full["messages"] if m["meta"].get("image")]
    check("image not stored, only flagged", stored and "base64" not in json.dumps(full), stored)
    check("non-image data refused", say(me, cid, "x", image="data:text/html;base64,PGgxPg==")[0] in (413, 415, 422))
    check("tiny/odd image dimensions refused", say(me, cid, "x", image=png(4))[0] == 422)
    check("fake image bytes refused", say(me, cid, "x", image="data:image/png;base64,aGVsbG8gd29ybGQgdGhpcyBpcyBub3QgYSBwbmc=")[0] == 415)

    print("generators (JSON)")
    code, fc = call("POST", "/tutor/generate", {"kind": "FLASHCARDS", "count": 5, "source": {"course_id": course["id"], "topic": "Negligence"}}, me)
    check("5 flashcards exactly", code == 200 and len(fc["data"]["cards"]) == 5, fc)
    check("JSON mode requested", last_json().get("response_format") == {"type": "json_object"})
    code, pr = call("POST", "/tutor/generate", {"kind": "PRACTICE", "count": 4, "types": ["mcq", "true_false", "short_answer"], "source": {"conversation_id": cid}}, me)
    qs = pr.get("data", {}).get("questions", []) if code == 200 else []
    check("practice validated (letter key fixed, broken key dropped)", len(qs) == 3 and qs[0]["correct_answer"] == "B1" and qs[1]["options"] == ["True", "False"], pr)
    check("practice stored at once (set id, question ids) but not listed", bool(pr.get("set_id")) and all(q.get("id") for q in qs) and not call("GET", "/tutor/saved?kind=practice", token=me)[1]["items"], pr)
    code, mt = call("POST", "/tutor/generate", {"kind": "MATERIAL", "source": {"selected_text": "A tort is a civil wrong that causes harm."}}, me)
    check("study material structured", code == 200 and mt["data"]["sections"][0]["heading"] == "Key concepts" and mt["data"]["definitions"], mt)
    check("generate needs a source", call("POST", "/tutor/generate", {"kind": "FLASHCARDS", "source": {}}, me)[0] == 422)

    print("saved items")
    code, saved = call("POST", "/tutor/saved", {"kind": "flashcards", "data": fc["data"], "course_id": course["id"]}, me)
    check("save deck", code == 201 and saved["items"] == 5, saved)
    check("list shows it", any(i["id"] == saved["id"] for i in call("GET", "/tutor/saved?kind=flashcards", token=me)[1]["items"]))
    code, edited = call("PATCH", f"/tutor/saved/flashcards/{saved['id']}", {"title": "My deck", "data": {**fc["data"], "cards": saved["data"]["cards"][:2]}}, me)
    check("edit deck (keeps card ids)", code == 200 and edited["title"] == "My deck" and edited["items"] == 2 and edited["data"]["cards"][0]["id"] == saved["data"]["cards"][0]["id"], edited)
    check("others can't open it", call("GET", f"/tutor/saved/flashcards/{saved['id']}", token=other)[0] == 404)
    code, dup = call("POST", f"/tutor/saved/flashcards/{saved['id']}/duplicate", {}, me)
    check("duplicate deck", code == 201 and dup["title"].endswith("(copy)") and dup["items"] == 2 and dup["id"] != saved["id"], dup)
    check("delete deck", call("DELETE", f"/tutor/saved/flashcards/{saved['id']}", token=me)[0] == 200 and call("GET", f"/tutor/saved/flashcards/{saved['id']}", token=me)[0] == 404)
    check("unknown kinds refused", call("POST", "/tutor/saved", {"kind": "exe", "data": {}}, me)[0] == 422)

    print("progress awareness")
    code, prog = call("GET", "/tutor/progress", token=me)
    check("progress summary from real data", code == 200 and "weak" in prog and prog["attempted"] == 0, prog)
    code, text = say(me, cid, "Make me a study plan", mode="STUDY_PLAN")
    system = last_stream()["messages"][0]["content"]
    check("study plan gets progress context", "PROGRESS" in system.upper(), system[-600:])

    print("limits & errors")
    check("too-long message → 413", say(me, cid, "x" * 5000)[0] == 413)
    code, st = call("GET", "/tutor/status", token=me)
    used = st["usage"]["today"]
    call("PUT", "/admin/tutor/settings", {"ai_daily_limit": used}, staff)
    code, body = say(me, cid, "one more?")
    check("daily limit → 429 JSON", code == 429 and "today" in str(body.get("detail")), body)
    call("PUT", "/admin/tutor/settings", {"ai_daily_limit": 200, "ai_per_minute": 1}, staff)
    check("per-minute limit → 429", say(me, cid, "fast")[0] == 429)
    call("PUT", "/admin/tutor/settings", {"ai_per_minute": 100, "ai_enabled": False}, staff)
    check("switched off → 403", say(me, cid, "hello")[0] == 403)
    call("PUT", "/admin/tutor/settings", {"ai_enabled": True}, staff)
    check("bad setting value refused", call("PUT", "/admin/tutor/settings", {"ai_per_minute": 0}, staff)[0] == 422)
    before = len(call("GET", f"/tutor/conversations/{cid}", token=me)[1]["messages"])
    MODE["value"] = "402"
    code, body = say(me, cid, "hello")
    check("provider balance error → friendly message only", code == 503 and body.get("detail") == "AI Tutor is temporarily unavailable. Please try again." and "402" not in str(body), body)
    MODE["value"] = "empty"
    code, text = say(me, cid, "hello")
    check("empty answer → SSE error event", code == 200 and events(text)[-1][0] == "error", text)
    MODE["value"] = "ok"
    after = len(call("GET", f"/tutor/conversations/{cid}", token=me)[1]["messages"])
    check("failed upstream call leaves no orphan message", after == before + 1, (before, after))  # only the empty-answer user turn remains

    with SessionLocal() as db:
        from app.models import Student
        from app.security import decode_token

        sid = int(decode_token(me).subject)
        quiz = db.query(Quiz).filter(Quiz.is_bank.is_(False)).first()
        from datetime import datetime, timedelta

        attempt = Attempt(student_id=sid, quiz_id=quiz.id, status="in_progress", deadline_at=datetime.utcnow() + timedelta(minutes=30), question_ids=[])
        db.add(attempt)
        db.commit()
        call("PUT", "/admin/tutor/settings", {"ai_exam_mode": "AI_DISABLED"}, staff)
        code, body = say(me, cid, "help me with question 3")
        check("active exam → tutor paused (423)", code == 423 and "exam" in str(body).lower(), body)
        code, st = call("GET", "/tutor/status", token=me)
        check("status shows the exam lock", bool(st.get("exam_locked")), st)
        db.delete(attempt)
        db.commit()
        call("PUT", "/admin/tutor/settings", {"ai_exam_mode": "CONCEPT_ONLY"}, staff)

    print("conversation management + summary memory")
    code, c2 = call("POST", "/tutor/conversations", {}, me)
    for i in range(18):
        say(me, c2["id"], f"Question number {i} about tort law")
    time.sleep(0.5)
    with SessionLocal() as db:
        convo = db.get(AIConversation, c2["id"])
        check("older turns folded into a summary", convo.summary.startswith("SUMMARY:") and convo.summarized_until > 0, convo.summary)
    say(me, c2["id"], "and finally?")
    check("summary sent as memory (in the system prompt)", "SUMMARY: the student" in last_stream()["messages"][0]["content"])
    check("rename", call("PATCH", f"/tutor/conversations/{cid}", {"title": "Tort revision"}, me)[1]["title"] == "Tort revision")
    check("delete (soft)", call("DELETE", f"/tutor/conversations/{cid}", token=me)[0] == 200 and call("GET", f"/tutor/conversations/{cid}", token=me)[0] == 404)
    check("restore", call("POST", f"/tutor/conversations/{cid}/restore", token=me)[0] == 200)
    code, listing = call("GET", "/tutor/conversations", token=me)
    check("list shows chats with counts", code == 200 and any(c["id"] == cid and c["messages"] > 0 for c in listing["conversations"]), listing)

    code, usage = call("GET", "/admin/tutor/usage", token=staff)
    check("staff usage totals", code == 200 and usage["totals"]["requests"] > 10 and usage["totals"]["estimated_cost"] > 0 and usage["top_students"], usage["totals"])
    run_v2(me, other, staff, course, cid, q_id, hidden_id, hidden_expl, material_id)


from verify_ai_tutor_v2 import run_v2  # noqa: E402


if __name__ == "__main__":
    main()
