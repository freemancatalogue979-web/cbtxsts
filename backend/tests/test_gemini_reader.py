"""Gemini key in Team Admin: match screenshots are read by Gemini first, then Groq, then the main key.

A local fake server stands in for every provider. No real network and no real keys.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_groq_reader import FakeProviders, NO_KEYS, call, png, reply  # noqa: E402

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app import ai_game_import, ai_scoreboard, vision_provider  # noqa: E402
from app.ai_credentials import resolved_key  # noqa: E402
from app.ai_scoreboard import reader_key  # noqa: E402
from app.db import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402
from app.security import issue_token  # noqa: E402
from app.vision_provider import Reader  # noqa: E402

ALL_NO_KEYS = {**NO_KEYS, "CLOVER_GEMINI_API_KEY": "", "GEMINI_API_KEY": ""}


class GeminiRequests(unittest.TestCase):
    def setUp(self) -> None:
        self.fake = FakeProviders()
        self.patches = [
            patch.object(vision_provider, "GEMINI_BASE", self.fake.url + "/gemini"),
            patch.object(vision_provider, "GEMINI_ENDPOINT", self.fake.url + "/gemini/chat/completions"),
            patch.object(vision_provider, "GROQ_ENDPOINT", self.fake.url + "/groq/chat/completions"),
            patch.object(ai_scoreboard, "ENDPOINT", self.fake.url + "/main"),
            patch.object(ai_game_import, "ENDPOINT", self.fake.url + "/main"),
        ]
        for p in self.patches:
            p.start()
        self.chain = Reader("gemini", "AIza_synthetic", backup=Reader("groq", "gsk_synthetic", backup=Reader("deepseek", "main-synthetic")))

    def tearDown(self) -> None:
        for p in self.patches:
            p.stop()
        self.fake.close()

    def test_screenshot_goes_to_gemini_in_openai_format(self) -> None:
        self.fake.add("/gemini/chat/completions", 200, reply('```json\n{"teams": [], "screen": "scoreboard"}\n```'))
        out = ai_scoreboard.call_model(self.chain, "system rules", "Transcribe this.", png(), "image/png",
                                       extra=[(png((30, 30)), "image/png")] * 4)
        self.assertEqual(out, {"teams": [], "screen": "scoreboard"})
        sent = self.fake.seen[0]
        body = sent["body"]
        self.assertEqual((sent["path"], sent["auth"]), ("/gemini/chat/completions", "Bearer AIza_synthetic"))
        self.assertEqual((body["model"], body["temperature"], body["reasoning_effort"]), (vision_provider.GEMINI_MODEL, 0, "low"))
        self.assertEqual(body["response_format"], {"type": "json_object"})
        self.assertGreaterEqual(body["max_tokens"], 12000)        # room for thinking + the JSON
        self.assertIn("x (left→right) first", body["messages"][0]["content"])  # boxes the way we read them
        parts = body["messages"][1]["content"]
        self.assertEqual([p["type"] for p in parts], ["text"] + ["image_url"] * 5)   # more pictures than Groq's 3
        self.assertEqual(len(self.fake.seen), 1)

    def test_falls_down_the_chain(self) -> None:
        self.fake.add("/gemini/chat/completions", 429, {"error": "quota"})
        self.fake.add("/groq/chat/completions", 503, {"error": "busy"})
        self.fake.add("/main", 200, reply('{"teams": [2]}'))
        self.assertEqual(ai_scoreboard.call_model(self.chain, "sys", "text", png(), "image/png"), {"teams": [2]})
        self.assertEqual([s["path"] for s in self.fake.seen], ["/gemini/chat/completions", "/groq/chat/completions", "/main"])

    def test_text_documents_and_reasoning_retry(self) -> None:
        self.fake.add("/gemini/chat/completions", 400, {"error": {"message": "Unknown name \"reasoning_effort\""}})
        self.fake.add("/gemini/chat/completions", 200, reply('{"games": []}'))
        self.assertEqual(ai_game_import.call_text(self.chain, "sys", "Ling win 8/1/6"), {"games": []})
        first, second = (s["body"] for s in self.fake.seen)
        self.assertIn("reasoning_effort", first)
        self.assertNotIn("reasoning_effort", second)
        self.assertEqual(second["messages"][1]["content"], "Ling win 8/1/6")

    def test_key_check(self) -> None:
        self.fake.add("/gemini/models", 200, {"data": [{"id": f"models/{vision_provider.GEMINI_MODEL}"}]})
        self.assertTrue(vision_provider.check_gemini_key("AIza_synthetic")["ok"])
        self.fake.add("/gemini/models", 200, {"data": [{"id": "models/other"}]})
        self.assertIn("isn't available", vision_provider.check_gemini_key("AIza_synthetic")["message"])
        self.fake.add("/gemini/models", 400, {"error": "API key not valid"})
        result = vision_provider.check_gemini_key("AIza_synthetic")
        self.assertFalse(result["ok"])
        self.assertIn("refused", result["message"])
        self.assertNotIn("AIza_synthetic", json.dumps(result))


class TeamAdminGeminiKey(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.patches = [patch("app.ai_credentials.KEY_PATH", Path(self.temp.name) / "credential-encryption.key"),
                        patch.dict(os.environ, ALL_NO_KEYS)]
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

    def test_admin_only_hidden_key_and_reading_order(self) -> None:
        for method, payload in (("GET", None), ("POST", {"key": "AIza_synthetic_1"}), ("DELETE", None)):
            self.assertEqual(call(method, "gemini", self.tokens["player"], payload)[0], 403)
        status, body = call("GET", "gemini", self.tokens["admin"])
        self.assertEqual((status, body["configured"], body["model"], body["backup"]), (200, False, vision_provider.GEMINI_MODEL, False))
        self.assertEqual(call("POST", "gemini/test", self.tokens["admin"])[0], 409)
        status, body = call("POST", "gemini", self.tokens["admin"], {"key": "AIza_synthetic_1"})
        self.assertEqual((status, body["configured"], body["source"]), (200, True, "admin"))
        self.assertNotIn("AIza_synthetic_1", json.dumps(body))
        call("POST", "groq", self.tokens["admin"], {"key": "gsk_synthetic_2"})
        self.assertEqual(call("GET", "gemini", self.tokens["admin"])[1]["backup_names"], ["Groq"])
        with self.factory() as db:
            self.assertEqual(resolved_key(db, "gemini"), "AIza_synthetic_1")
            player = db.get(User, self.player_id)
            with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "main-synthetic"}):
                r = reader_key(db, player)
                self.assertEqual((r.provider, r.backup.provider, r.backup.backup.provider), ("gemini", "groq", "deepseek"))
                self.assertNotIn("AIza_synthetic_1", repr(r))
        status, body = call("DELETE", "gemini", self.tokens["admin"])
        self.assertEqual((status, body["configured"]), (200, False))
        with self.factory() as db:
            self.assertEqual(reader_key(db, db.get(User, self.player_id)).provider, "groq")


if __name__ == "__main__":
    unittest.main()
