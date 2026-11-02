"""Provider keys are write-only, encrypted, role-gated and used server-side.

All credentials and provider responses here are synthetic. No network is used.
"""
from __future__ import annotations

import asyncio
import io
import json
import os
import stat
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

os.environ["CLOVER_AERENA_ENABLED"] = "0"

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.ai_credentials import CredentialStorageError, ProviderCredential, _cipher, resolved_key  # noqa: E402
from app.db import Base, get_db  # noqa: E402
from app.esports_ai import ask  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402
from app.routers.esports import source_status  # noqa: E402
from app.security import issue_token  # noqa: E402


async def asgi_request(method: str, token: str = "", payload: dict | None = None, *,
                       cookie: str = "", origin: str | None = "https://clover.example", scheme: str = "https"):
    body = json.dumps(payload).encode() if payload is not None else b""
    headers = [(b"host", b"clover.example")]
    if token:
        headers.append((b"authorization", f"Bearer {token}".encode()))
    if cookie:
        headers.append((b"cookie", f"clover_session={cookie}".encode()))
    if origin:
        headers.append((b"origin", origin.encode()))
    if payload is not None:
        headers.append((b"content-type", b"application/json"))
    path = "/api/admin/integrations/ai"
    scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"}, "http_version": "1.1",
             "method": method, "scheme": scheme, "path": path, "raw_path": path.encode(), "query_string": b"",
             "root_path": "", "headers": headers, "client": ("198.51.100.2", 1234), "server": ("clover.example", 443)}
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
    start = next(event for event in sent if event["type"] == "http.response.start")
    content = b"".join(event.get("body", b"") for event in sent if event["type"] == "http.response.body")
    return start["status"], json.loads(content) if content else {}, dict(start["headers"])


def request(method: str, token: str = "", payload: dict | None = None, **kwargs):
    return asyncio.run(asgi_request(method, token, payload, **kwargs))


class CredentialHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.key_file = Path(self.temp.name) / "credential-encryption.key"
        self.key_path_patch = patch("app.ai_credentials.KEY_PATH", self.key_file)
        self.key_path_patch.start()
        self.env_patch = patch.dict(os.environ, {"CLOVER_AI_API_KEY": "", "DEEPSEEK_API_KEY": "", "CLOVER_CREDENTIAL_ENCRYPTION_KEY": ""})
        self.env_patch.start()
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.factory = sessionmaker(bind=self.engine, autoflush=False)
        with self.factory() as db:
            users = [User(email=f"{role}@test.invalid", password_hash="unused", name=role, role=role)
                     for role in ("admin", "coach", "player")]
            db.add_all(users)
            db.commit()
            self.tokens = {user.role: issue_token(user.id, user.role, user.name) for user in users}
            self.admin_id = users[0].id

        def override_db():
            with self.factory() as db:
                yield db
        app.dependency_overrides[get_db] = override_db

    def tearDown(self):
        app.dependency_overrides.pop(get_db, None)
        self.engine.dispose()
        self.env_patch.stop()
        self.key_path_patch.stop()
        self.temp.cleanup()

    def test_only_admin_can_manage_and_cookie_only_writes_are_rejected(self):
        self.assertEqual(request("GET")[0], 401)
        for role in ("coach", "player"):
            self.assertEqual(request("GET", self.tokens[role])[0], 403)
            self.assertEqual(request("POST", self.tokens[role], {"key": "synthetic-secret"})[0], 403)
            self.assertEqual(request("DELETE", self.tokens[role])[0], 403)
        self.assertEqual(request("POST", payload={"key": "synthetic-secret"}, cookie=self.tokens["admin"])[0], 403)
        self.assertFalse(self.key_file.exists())

    def test_admin_save_rotate_remove_and_runtime_uses_encrypted_key(self):
        first = "sk-synthetic-first-12345"
        second = "sk-synthetic-second-67890"
        token = self.tokens["admin"]
        status, body, headers = request("POST", token, {"key": first})
        self.assertEqual((status, body["configured"], body["source"]), (200, True, "admin"))
        self.assertEqual(headers.get(b"cache-control"), b"no-store")
        self.assertNotIn(first, json.dumps(body))
        self.assertEqual(stat.S_IMODE(self.key_file.stat().st_mode), 0o600)
        with self.factory() as db:
            row = db.get(ProviderCredential, "deepseek")
            old_ciphertext = row.ciphertext
            self.assertNotIn(first, old_ciphertext)
            self.assertEqual(resolved_key(db), first)
            self.assertTrue(source_status(db)["ai_configured"])
        self.assertNotIn(first, self.key_file.read_text())
        status, body, _ = request("POST", token, {"key": second})
        self.assertEqual((status, body["source"]), (200, "admin"))
        self.assertNotIn(second, json.dumps(body))
        with self.factory() as db:
            row = db.get(ProviderCredential, "deepseek")
            self.assertNotEqual(row.ciphertext, old_ciphertext)
            self.assertNotIn(second, row.ciphertext)
            self.assertEqual(resolved_key(db), second)
            captured = []

            def send_to_provider(req, timeout):
                captured.append(req)
                return io.BytesIO(json.dumps({"choices": [{"message": {"content": "A cautious observation."}}]}).encode())

            detail = {"match": {"id": "MATCH-1", "status": "completed", "team1": {"teamName": "A", "teamScore": 0},
                                "team2": {"teamName": "B", "teamScore": 2}}, "games": []}
            with patch("app.esports_ai.urllib.request.build_opener", return_value=SimpleNamespace(open=send_to_provider)):
                result = ask(db, self.admin_id, "What happened?", detail)
            self.assertEqual(result["mode"], "ai")
            self.assertEqual(captured[0].get_header("Authorization"), f"Bearer {second}")
            self.assertNotIn(second, captured[0].data.decode())
            self.assertNotIn(second, json.dumps(result))
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "environment-fallback"}):
            status, body, _ = request("DELETE", token)
            self.assertEqual((status, body["source"], body["configured"]), (200, "environment", True))
            self.assertFalse(body["has_saved_key"])
            self.assertNotIn("environment-fallback", json.dumps(body))
            with self.factory() as db:
                self.assertEqual(resolved_key(db), "environment-fallback")
        self.assertEqual(request("GET", token)[1]["configured"], False)

    def test_unavailable_encryption_fails_closed_and_can_be_replaced(self):
        token = self.tokens["admin"]
        self.assertEqual(request("POST", token, {"key": "synthetic-original"})[0], 200)
        self.key_file.unlink()
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "must-not-silently-use"}):
            status, body, _ = request("GET", token)
            self.assertEqual((status, body["configured"], body["source"]), (200, False, "unavailable"))
            with self.factory() as db:
                with self.assertRaises(CredentialStorageError):
                    resolved_key(db)
                self.assertFalse(source_status(db)["ai_configured"])
                detail = {"match": {"id": "MATCH-1", "status": "completed", "team1": {}, "team2": {}}, "games": []}
                result = ask(db, self.admin_id, "Why?", detail)
                self.assertEqual(result["mode"], "facts")
                self.assertIn("cannot be unlocked", result["note"])
            status, body, _ = request("POST", token, {"key": "synthetic-replacement"})
            self.assertEqual((status, body["configured"], body["source"]), (200, True, "admin"))
            with self.factory() as db:
                self.assertEqual(resolved_key(db), "synthetic-replacement")

    def test_concurrent_workers_share_one_atomically_created_master_key(self):
        def encrypt(_index):
            return _cipher(create=True).encrypt(b"synthetic-credential")
        with ThreadPoolExecutor(max_workers=12) as workers:
            tokens = list(workers.map(encrypt, range(24)))
        cipher = _cipher(create=False)
        self.assertTrue(all(cipher.decrypt(value) == b"synthetic-credential" for value in tokens))
        self.assertEqual(stat.S_IMODE(self.key_file.stat().st_mode), 0o600)
        self.assertEqual(list(self.key_file.parent.glob(".credential-key-*")), [])

    def test_rejects_insecure_origin_invalid_keys_and_bad_master_config(self):
        token = self.tokens["admin"]
        self.assertEqual(request("POST", token, {"key": "synthetic"}, origin="http://clover.example", scheme="http")[0], 403)
        self.assertEqual(request("POST", token, {"key": "synthetic"}, origin=None, scheme="http")[0], 403)
        for value in ("", "bad\nheader", "a" * 513, "sp ace"):
            status, body, _ = request("POST", token, {"key": value})
            self.assertEqual(status, 422)
            if value:
                self.assertNotIn(value, json.dumps(body))
        with patch.dict(os.environ, {"CLOVER_CREDENTIAL_ENCRYPTION_KEY": "not-a-fernet-key"}):
            status, body, _ = request("POST", token, {"key": "synthetic-secret"})
            self.assertEqual(status, 503)
            self.assertNotIn("synthetic-secret", json.dumps(body))
        self.assertFalse(self.key_file.exists())


if __name__ == "__main__":
    unittest.main()
