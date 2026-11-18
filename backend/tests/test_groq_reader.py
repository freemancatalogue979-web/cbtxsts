"""Groq key in Team Admin: screenshots and documents are read by Groq first, main key as backup.

A local fake server stands in for both providers. No real network and no real keys.
"""
from __future__ import annotations

import asyncio
import io
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("CLOVER_AERENA_ENABLED", "0")
os.environ.setdefault("CLOVER_HERO_SYNC_ENABLED", "0")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app import ai_game_import, ai_scoreboard, vision_provider  # noqa: E402
from app.ai_credentials import resolved_key  # noqa: E402
from app.ai_scoreboard import ReadError, reader_key  # noqa: E402
from app.db import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402
from app.security import issue_token  # noqa: E402
from app.vision_provider import Reader  # noqa: E402

NO_KEYS = {"CLOVER_AI_API_KEY": "", "DEEPSEEK_API_KEY": "", "CLOVER_GROQ_API_KEY": "", "GROQ_API_KEY": "",
           "CLOVER_CREDENTIAL_ENCRYPTION_KEY": ""}


def png(size=(64, 40), noise=False) -> bytes:
    img = Image.effect_noise(size, 90).convert("RGB") if noise else Image.new("RGB", size, (20, 120, 200))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def reply(content: str) -> dict:
    return {"choices": [{"message": {"content": content}}]}


class FakeProviders:
    """Answers queued (status, body) per path and records every request."""

    def __init__(self) -> None:
        self.queue: dict[str, list[tuple[int, dict]]] = {}
        self.seen: list[dict] = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def _answer(self, body: bytes | None) -> None:
                outer.seen.append({"path": self.path, "method": self.command, "auth": self.headers.get("Authorization"),
                                   "body": json.loads(body) if body else None})
                status, payload = (outer.queue.get(self.path) or [(500, {"error": "nothing queued"})]).pop(0)
                data = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self):  # noqa: N802
                self._answer(self.rfile.read(int(self.headers.get("Content-Length") or 0)))

            def do_GET(self):  # noqa: N802
                self._answer(None)

            def log_message(self, *args):  # noqa: ANN002
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def add(self, path: str, status: int, body: dict) -> None:
        self.queue.setdefault(path, []).append((status, body))

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


class GroqRequests(unittest.TestCase):
    def setUp(self) -> None:
        self.fake = FakeProviders()
        self.patches = [
            patch.object(vision_provider, "GROQ_BASE", self.fake.url + "/groq"),
            patch.object(vision_provider, "GROQ_ENDPOINT", self.fake.url + "/groq/chat/completions"),
            patch.object(ai_scoreboard, "ENDPOINT", self.fake.url + "/main"),
            patch.object(ai_game_import, "ENDPOINT", self.fake.url + "/main"),
        ]
        for p in self.patches:
            p.start()
        self.both = Reader("groq", "gsk_synthetic", backup=Reader("deepseek", "main-synthetic"))

    def tearDown(self) -> None:
        for p in self.patches:
            p.stop()
        self.fake.close()

    def test_screenshot_goes_to_groq_with_its_own_request_shape(self) -> None:
        self.fake.add("/groq/chat/completions", 200, reply('<think>scanning</think>\n{"teams": [], "victory": true}'))
        out = ai_scoreboard.call_model(self.both, "system rules", "Transcribe this.", png(), "image/png",
                                       extra=[(png((30, 30)), "image/png")])
        self.assertEqual(out, {"teams": [], "victory": True})
        sent = self.fake.seen[0]
        body = sent["body"]
        self.assertEqual((sent["path"], sent["auth"]), ("/groq/chat/completions", "Bearer gsk_synthetic"))
        self.assertEqual(body["model"], vision_provider.GROQ_MODEL)
        self.assertEqual((body["reasoning_effort"], body["reasoning_format"], body["temperature"]), ("none", "hidden", 0))
        self.assertEqual(body["response_format"], {"type": "json_object"})
        self.assertNotIn("thinking", body)  # main-provider-only switch
        parts = body["messages"][1]["content"]
        self.assertEqual([p["type"] for p in parts], ["text", "image_url", "image_url"])
        self.assertTrue(parts[1]["image_url"]["url"].startswith("data:image/png;base64,"))
        self.assertNotIn("detail", parts[1]["image_url"])
        self.assertEqual(len(self.fake.seen), 1)  # backup untouched

    def test_model_without_reasoning_switches_is_asked_again_plainly(self) -> None:
        self.fake.add("/groq/chat/completions", 400, {"error": {"message": "`reasoning_format` is not supported with this model"}})
        self.fake.add("/groq/chat/completions", 200, reply('{"games": []}'))
        self.assertEqual(ai_game_import.call_text(self.both, "sys", "Ling win 8/1/6"), {"games": []})
        first, second = (s["body"] for s in self.fake.seen)
        self.assertIn("reasoning_effort", first)
        self.assertNotIn("reasoning_effort", second)
        self.assertNotIn("reasoning_format", second)
        self.assertEqual(second["messages"][1]["content"], "Ling win 8/1/6")

    def test_groq_down_or_key_refused_falls_back_to_the_main_key(self) -> None:
        for status in (503, 429, 401):
            self.fake.seen.clear()
            self.fake.add("/groq/chat/completions", status, {"error": "nope"})
            self.fake.add("/main", 200, reply('{"teams": [1]}'))
            out = ai_scoreboard.call_model(self.both, "sys", "text", png(), "image/png")
            self.assertEqual(out, {"teams": [1]})
            backup = self.fake.seen[1]
            self.assertEqual((backup["path"], backup["auth"]), ("/main", "Bearer main-synthetic"))
            self.assertEqual(backup["body"]["thinking"], {"type": "disabled"})
            self.assertEqual(backup["body"]["messages"][1]["content"][1]["image_url"]["detail"], "high")

    def test_groq_alone_failing_gives_a_plain_message(self) -> None:
        self.fake.add("/groq/chat/completions", 503, {"error": "busy"})
        with self.assertRaises(ReadError) as err:
            ai_scoreboard.call_model(Reader("groq", "gsk_synthetic"), "sys", "text", png(), "image/png")
        self.assertEqual(err.exception.status, 502)
        self.assertNotIn("AI", str(err.exception))  # players see this in Utility
        self.fake.add("/groq/chat/completions", 200, reply("sorry, I can't"))
        with self.assertRaises(ReadError) as err:
            ai_scoreboard.call_model(Reader("groq", "gsk_synthetic"), "sys", "text", png(), "image/png")
        self.assertIn("garbled", str(err.exception))

    def test_plain_main_key_still_works_as_before(self) -> None:
        self.fake.add("/main", 200, reply('{"teams": []}'))
        self.assertEqual(ai_scoreboard.call_model("main-only", "sys", "text", png(), "image/png"), {"teams": []})
        self.assertEqual(self.fake.seen[0]["auth"], "Bearer main-only")

    def test_big_pictures_are_shrunk_to_fit_and_capped_at_three(self) -> None:
        big = png((3000, 2000), noise=True)
        self.assertGreater(len(big), 3_500_000)
        fitted = vision_provider.fit_images([(big, "image/png")] * 4)
        self.assertEqual(len(fitted), 3)
        self.assertLessEqual(sum(len(d) for d, _ in fitted), vision_provider.GROQ_IMAGE_BUDGET)
        self.assertTrue(all(kind == "image/jpeg" for _, kind in fitted))
        small = [(png(), "image/png")]
        self.assertEqual(vision_provider.fit_images(small), small)  # small files are sent untouched

    def test_key_check(self) -> None:
        self.fake.add("/groq/models", 200, {"data": [{"id": vision_provider.GROQ_MODEL}, {"id": "other"}]})
        self.assertTrue(vision_provider.check_groq_key("gsk_synthetic")["ok"])
        self.fake.add("/groq/models", 200, {"data": [{"id": "other"}]})
        self.assertIn("isn't available", vision_provider.check_groq_key("gsk_synthetic")["message"])
        self.fake.add("/groq/models", 401, {"error": "invalid key"})
        result = vision_provider.check_groq_key("gsk_synthetic")
        self.assertFalse(result["ok"])
        self.assertIn("refused", result["message"])
        self.assertNotIn("gsk_synthetic", json.dumps(result))


async def asgi(method: str, path: str, token: str = "", payload: dict | None = None):
    body = json.dumps(payload).encode() if payload is not None else b""
    headers = [(b"host", b"clover.example"), (b"origin", b"https://clover.example")]
    if token:
        headers.append((b"authorization", f"Bearer {token}".encode()))
    if payload is not None:
        headers.append((b"content-type", b"application/json"))
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method, "scheme": "https",
             "path": path, "raw_path": path.encode(), "query_string": b"", "root_path": "", "headers": headers,
             "client": ("198.51.100.2", 1234), "server": ("clover.example", 443)}
    sent: list[dict] = []
    received = False

    async def receive():
        nonlocal received
        if not received:
            received = True
            return {"type": "http.request", "body": body, "more_body": False}
        return {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    await app(scope, receive, send)
    start = next(e for e in sent if e["type"] == "http.response.start")
    content = b"".join(e.get("body", b"") for e in sent if e["type"] == "http.response.body")
    return start["status"], json.loads(content) if content else {}


def call(method: str, path: str, token: str = "", payload: dict | None = None):
    return asyncio.run(asgi(method, "/api/admin/integrations/" + path, token, payload))


class TeamAdminGroqKey(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.patches = [patch("app.ai_credentials.KEY_PATH", Path(self.temp.name) / "credential-encryption.key"),
                        patch.dict(os.environ, NO_KEYS)]
        for p in self.patches:
            p.start()
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.factory = sessionmaker(bind=self.engine, autoflush=False)
        with self.factory() as db:
            users = [User(email=f"{r}@test.invalid", password_hash="x", name=r, role=r) for r in ("admin", "player")]
            db.add_all(users)
            db.commit()
            self.tokens = {u.role: issue_token(u.id, u.role, u.name) for u in users}
            self.player_id = users[1].id

        def override_db():
            with self.factory() as db:
                yield db
        app.dependency_overrides[get_db] = override_db

    def tearDown(self) -> None:
        app.dependency_overrides.pop(get_db, None)
        self.engine.dispose()
        for p in reversed(self.patches):
            p.stop()
        self.temp.cleanup()

    def test_only_admin_and_the_key_is_never_shown(self) -> None:
        for method, payload in (("GET", None), ("POST", {"key": "gsk_synthetic_123"}), ("DELETE", None)):
            self.assertEqual(call(method, "groq", self.tokens["player"], payload)[0], 403)
        self.assertEqual(call("POST", "groq/test", self.tokens["player"])[0], 403)
        status, body = call("GET", "groq", self.tokens["admin"])
        self.assertEqual((status, body["configured"], body["model"], body["backup"]), (200, False, vision_provider.GROQ_MODEL, False))
        self.assertEqual(call("POST", "groq/test", self.tokens["admin"])[0], 409)  # nothing saved yet

        status, body = call("POST", "groq", self.tokens["admin"], {"key": "gsk_synthetic_123"})
        self.assertEqual((status, body["configured"], body["source"]), (200, True, "admin"))
        self.assertNotIn("gsk_synthetic_123", json.dumps(body))
        with self.factory() as db:
            self.assertEqual(resolved_key(db, "groq"), "gsk_synthetic_123")
            self.assertIsNone(resolved_key(db))  # the main key slot is separate
        with patch.object(vision_provider, "check_groq_key", return_value={"ok": True, "model": "m", "message": "Connected."}) as check:
            self.assertEqual(call("POST", "groq/test", self.tokens["admin"])[1]["message"], "Connected.")
        check.assert_called_once_with("gsk_synthetic_123")

        status, body = call("DELETE", "groq", self.tokens["admin"])
        self.assertEqual((status, body["configured"]), (200, False))

    def test_who_reads_uploads(self) -> None:
        with self.factory() as db:
            player = db.get(User, self.player_id)
            with self.assertRaises(ReadError) as err:
                reader_key(db, player)
            self.assertEqual(err.exception.status, 503)
            self.assertIn("Team Admin", str(err.exception))
            self.assertNotIn("AI", str(err.exception))

            with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "main-synthetic"}):
                self.assertEqual(reader_key(db, player), Reader("deepseek", "main-synthetic"))
                call("POST", "groq", self.tokens["admin"], {"key": "gsk_synthetic_123"})
                both = reader_key(db, player)
                self.assertEqual((both.provider, both.key, both.backup), ("groq", "gsk_synthetic_123", Reader("deepseek", "main-synthetic")))
                self.assertNotIn("gsk_synthetic_123", repr(both))
            alone = reader_key(db, player)  # Groq works even without the main key
            self.assertEqual((alone.provider, alone.backup), ("groq", None))


if __name__ == "__main__":
    unittest.main()
