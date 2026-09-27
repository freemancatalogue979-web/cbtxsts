"""API keys entered in the admin panel (AI Tutor → Models → API keys).

Starts its own API (temp database, temp key file) against a local mock of
DeepSeek and Gemini — no internet, no real keys:

    cd backend && ./.venv/bin/python scripts/verify_ai_keys.py

Checks: a refused key is not saved, a good key is used from the very next
request (no restart) for both providers, keys are masked in every reply,
only the owner can change them, and removing one falls back cleanly.
"""

from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MOCK_PORT, API_PORT = 3994, 3993
ROOT = Path(__file__).resolve().parents[1]
TMP = Path(tempfile.gettempdir())
DB_FILE = TMP / f"keys_verify_{os.getpid()}.db"
KEYS_FILE = TMP / f"keys_verify_{os.getpid()}.json"
ENV = {k: v for k, v in os.environ.items() if k not in {"DEEPSEEK_API_KEY", "GEMINI_API_KEY", "AI_PROVIDER"}}
ENV.update({
    "CBT_DATABASE_URL": f"sqlite:///{DB_FILE}",
    "CBT_AI_KEYS_FILE": str(KEYS_FILE),
    # empty (not unset) so backend/.env can't supply a key during the test
    "DEEPSEEK_API_KEY": "",
    "GEMINI_API_KEY": "",
    "AI_PROVIDER": "auto",
    "DEEPSEEK_API_BASE": f"http://127.0.0.1:{MOCK_PORT}",
    "GEMINI_API_BASE": f"http://127.0.0.1:{MOCK_PORT}/v1beta",
    "DEEPSEEK_TIMEOUT": "5",
    "GEMINI_TIMEOUT": "5",
    "TUTOR_RETRY_BASE": "0.05",
})
BASE = f"http://127.0.0.1:{API_PORT}/api"
SEEN: list[dict] = []
PASSED = FAILED = 0

DS_GOOD = "sk-good-deepseek-key-0001aaaa"
DS_GOOD2 = "sk-good-deepseek-key-0002bbbb"
DS_BAD = "sk-bad-deepseek-key-0000zzzz"
DS_BROKE = "sk-broke-deepseek-key-0000yyyy"
GM_GOOD = "AQ.Ab-good-gemini-key-0001cccc"


def check(name: str, ok: bool, detail: object = "") -> None:
    global PASSED, FAILED
    if ok:
        PASSED += 1
        print(f"  ok   {name}")
    else:
        FAILED += 1
        print(f"  FAIL {name} — {str(detail)[:400]}")


class Mock(BaseHTTPRequestHandler):
    def log_message(self, *_: object) -> None:
        pass

    def reply(self, code: int, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:  # noqa: N802
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        gemini = "/models/" in self.path
        key = self.headers.get("x-goog-api-key") if gemini else (self.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
        SEEN.append({"provider": "gemini" if gemini else "deepseek", "key": key})
        if "bad" in (key or ""):
            return self.reply(401, {"error": {"message": "invalid api key"}})
        if "broke" in (key or ""):
            return self.reply(402, {"error": {"message": "Insufficient Balance"}})
        if gemini:
            return self.reply(200, {"candidates": [{"content": {"parts": [{"text": "OK"}]}, "finishReason": "STOP"}], "usageMetadata": {"promptTokenCount": 5, "candidatesTokenCount": 1}})
        return self.reply(200, {"choices": [{"message": {"content": "OK"}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 5, "completion_tokens": 1}})


def call(method: str, path: str, body: dict | None = None, token: str | None = None) -> tuple[int, dict, str]:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(BASE + path, data=data, method=method)
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode()
            return response.status, json.loads(raw or "{}"), raw
    except urllib.error.HTTPError as error:
        raw = error.read().decode()
        try:
            return error.code, json.loads(raw or "{}"), raw
        except ValueError:
            return error.code, {"raw": raw}, raw


def provider(reply: dict, name: str) -> dict:
    return next((p for p in reply.get("providers", []) if p["id"] == name), {})


def run() -> None:
    code, admin, _ = call("POST", "/auth/admin", {"email": "admin@quizarena.ng", "password": "arena2026"})
    owner = admin["token"]
    code, player, _ = call("POST", "/auth/register", {"username": f"keys{os.getpid() % 100000}", "password": "pass12345", "phone": f"0803{os.getpid() % 10000000:07d}", "display_name": "K"})
    student = player.get("token")

    print("starting without keys")
    code, s, _ = call("GET", "/admin/tutor/settings", token=owner)
    check("no key for either provider", code == 200 and not provider(s, "deepseek").get("configured") and not provider(s, "gemini").get("configured") and provider(s, "deepseek").get("key_source") == "", s.get("providers"))
    code, st, _ = call("GET", "/tutor/status", token=student)
    check("tutor reports not configured", code == 200 and not st.get("configured"), st)

    print("refused / malformed keys are not saved")
    code, r, _ = call("PUT", "/admin/tutor/keys/deepseek", {"key": DS_BAD}, owner)
    check("a key DeepSeek refuses → 422, not saved", code == 422 and "not saved" in r.get("detail", ""), r)
    check("…and nothing was written", not KEYS_FILE.exists() or DS_BAD not in KEYS_FILE.read_text())
    code, r, _ = call("PUT", "/admin/tutor/keys/deepseek", {"key": "abc def"}, owner)
    check("something that isn't a key → 422", code == 422, r)
    code, r, _ = call("PUT", "/admin/tutor/keys/openai", {"key": DS_GOOD}, owner)
    check("unknown provider → 404", code == 404, r)

    print("a good DeepSeek key works at once — no restart")
    code, r, raw = call("PUT", "/admin/tutor/keys/deepseek", {"key": f"  Bearer {DS_GOOD}\n"}, owner)
    ds = provider(r, "deepseek")
    check("saved + confirmed working", code == 200 and r.get("key_result", {}).get("ok") and ds.get("key_source") == "admin" and ds.get("configured"), r.get("key_result"))
    check("reply shows a masked hint, never the key", ds.get("key_hint") == f"{DS_GOOD[:4]}…{DS_GOOD[-4:]}" and DS_GOOD not in raw, ds.get("key_hint"))
    check("who/when recorded", ds.get("key_updated_by") == "admin@quizarena.ng" and ds.get("key_updated_at"), ds)
    code, st, _ = call("GET", "/tutor/status", token=student)
    check("players' tutor is on straight away", code == 200 and st.get("configured"), st)
    SEEN.clear()
    code, t, _ = call("POST", "/admin/tutor/test", token=owner)
    check("the next request uses the new key", code == 200 and t.get("ok") and SEEN and SEEN[-1] == {"provider": "deepseek", "key": DS_GOOD}, (t, SEEN[-1:]))
    mode = KEYS_FILE.stat().st_mode
    check("key file is owner-only (600)", stat.S_IMODE(mode) == 0o600, oct(mode))

    print("changing the key switches immediately")
    code, r, _ = call("PUT", "/admin/tutor/keys/deepseek", {"key": DS_GOOD2}, owner)
    SEEN.clear()
    code, t, _ = call("POST", "/admin/tutor/test", token=owner)
    check("test call now carries the second key", t.get("ok") and SEEN and SEEN[-1]["key"] == DS_GOOD2, SEEN[-1:])
    code, r, _ = call("PUT", "/admin/tutor/keys/deepseek", {"key": DS_BAD}, owner)
    check("a bad replacement is refused…", code == 422, r)
    SEEN.clear()
    call("POST", "/admin/tutor/test", token=owner)
    check("…and the working key stays in use", SEEN and SEEN[-1]["key"] == DS_GOOD2, SEEN[-1:])

    print("Gemini too")
    code, r, raw = call("PUT", "/admin/tutor/keys/gemini", {"key": GM_GOOD}, owner)
    gm = provider(r, "gemini")
    check("Gemini key saved + working", code == 200 and r.get("key_result", {}).get("ok") and gm.get("key_source") == "admin" and GM_GOOD not in raw, r.get("key_result"))
    check("Gemini was called with x-goog-api-key", any(x == {"provider": "gemini", "key": GM_GOOD} for x in SEEN), SEEN[-2:])
    code, r, _ = call("PUT", "/admin/tutor/settings", {"ai_provider": "gemini"}, owner)
    SEEN.clear()
    code, t, _ = call("POST", "/admin/tutor/test", token=owner)
    check("choosing Gemini uses the panel key at once", t.get("ok") and SEEN and SEEN[-1] == {"provider": "gemini", "key": GM_GOOD}, (t, SEEN[-1:]))
    code, a, _ = call("GET", "/admin/materials/assist/status", token=owner)
    check("writing help sees the key too", code == 200 and a.get("ai", {}).get("configured") is True, a)
    call("PUT", "/admin/tutor/settings", {"ai_provider": ""}, owner)

    print("an account without balance")
    code, r, _ = call("PUT", "/admin/tutor/keys/deepseek", {"key": DS_BROKE}, owner)
    check("saved with a clear 'add credit' note", code == 200 and r.get("key_result", {}).get("ok") is False and "balance" in r["key_result"]["message"], r.get("key_result"))

    print("who may change keys")
    from app.db import SessionLocal
    from app.models import Admin
    from app.security import hash_password

    with SessionLocal() as db:
        db.add(Admin(email="lecturer@quizarena.ng", name="Lecturer", password_hash=hash_password("lecturer2026"), role="staff"))
        db.commit()
    code, lec, _ = call("POST", "/auth/admin", {"email": "lecturer@quizarena.ng", "password": "lecturer2026"})
    code, r, _ = call("PUT", "/admin/tutor/keys/deepseek", {"key": DS_GOOD}, lec.get("token"))
    check("staff (non-owner) can't change keys", code == 403, r)
    code, r, _ = call("DELETE", "/admin/tutor/keys/deepseek", token=lec.get("token"))
    check("…or remove them", code == 403, r)
    check("players can't touch keys", call("PUT", "/admin/tutor/keys/deepseek", {"key": DS_GOOD}, student)[0] == 403)
    check("no login, no keys", call("PUT", "/admin/tutor/keys/deepseek", {"key": DS_GOOD})[0] == 401)

    print("removing a saved key")
    code, r, _ = call("DELETE", "/admin/tutor/keys/deepseek", token=owner)
    check("DeepSeek key removed", code == 200 and provider(r, "deepseek").get("key_source") == "" and not provider(r, "deepseek").get("configured"), r.get("key_result"))
    check("Gemini keeps its key and takes over", provider(r, "gemini").get("configured") and provider(r, "gemini").get("active"), r.get("providers"))
    SEEN.clear()
    code, t, _ = call("POST", "/admin/tutor/test", token=owner)
    check("next request goes to Gemini", t.get("ok") and SEEN and SEEN[-1]["provider"] == "gemini", (t, SEEN[-1:]))
    call("DELETE", "/admin/tutor/keys/gemini", token=owner)
    code, st, _ = call("GET", "/tutor/status", token=student)
    check("with both removed the tutor is off again", code == 200 and not st.get("configured"), st)


def main() -> None:
    os.environ.update({"CBT_DATABASE_URL": ENV["CBT_DATABASE_URL"], "CBT_AI_KEYS_FILE": ENV["CBT_AI_KEYS_FILE"]})
    sys.path.insert(0, str(ROOT))
    mock = ThreadingHTTPServer(("127.0.0.1", MOCK_PORT), Mock)
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
        KEYS_FILE.unlink(missing_ok=True)
    print(f"\n{PASSED} passed, {FAILED} failed")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
