"""ASGI-level integration tests for authenticated esports routes.

These use an in-memory database and source fixtures only, with no upstream
network or extra HTTP client dependency. No fixture is seeded into the app.
"""
from __future__ import annotations

import asyncio
import json
import os
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit

os.environ["CLOVER_AERENA_ENABLED"] = "0"

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.aerena_service import save_heroes, save_league, save_match, save_series  # noqa: E402
from app.db import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402
from app.security import issue_token  # noqa: E402
from test_aerena import ALICE_ID, LEAGUE_ID, MATCH_ID, league, match, series  # noqa: E402


async def asgi_request(method: str, url: str, token: str = "", payload: dict | None = None) -> tuple[int, dict]:
    parsed = urlsplit(url)
    body = json.dumps(payload).encode() if payload is not None else b""
    headers = [(b"host", b"testserver")]
    if token:
        headers.append((b"authorization", f"Bearer {token}".encode()))
    if payload is not None:
        headers.append((b"content-type", b"application/json"))
    scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"}, "http_version": "1.1",
             "method": method, "scheme": "http", "path": parsed.path, "raw_path": parsed.path.encode(),
             "query_string": parsed.query.encode(), "root_path": "", "headers": headers,
             "client": ("testclient", 12345), "server": ("testserver", 80)}
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
    status = next(message["status"] for message in sent if message["type"] == "http.response.start")
    content = b"".join(message.get("body", b"") for message in sent if message["type"] == "http.response.body")
    return status, json.loads(content) if content else {}


def request(method: str, url: str, token: str = "", payload: dict | None = None) -> tuple[int, dict]:
    return asyncio.run(asgi_request(method, url, token, payload))


class EsportsHttpTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.factory = sessionmaker(bind=self.engine, autoflush=False)
        with self.factory() as db:
            player = User(email="player@test.invalid", password_hash="not-used", name="Player", role="player")
            admin = User(email="admin@test.invalid", password_hash="not-used", name="Admin", role="admin")
            db.add_all([player, admin])
            save_series(db, [series()])
            save_heroes(db, [{"_id": ALICE_ID, "heroName": "ALICE"}])
            saved_league = save_league(db, league())
            save_match(db, match(), saved_league)
            db.commit()
            self.player = issue_token(player.id, player.role, player.name)
            self.admin = issue_token(admin.id, admin.role, admin.name)

        def override_db():
            with self.factory() as db:
                yield db

        app.dependency_overrides[get_db] = override_db

    def tearDown(self):
        app.dependency_overrides.pop(get_db, None)
        self.engine.dispose()

    def test_http_auth_browsing_search_detail_and_analysis(self):
        self.assertEqual(request("GET", "/api/esports/source")[0], 401)
        status, source = request("GET", "/api/esports/source", self.player)
        self.assertEqual((status, source["status"], source["match_count"]), (200, "disabled", 1))
        status, catalog = request("GET", "/api/esports/catalog", self.player)
        self.assertEqual((status, catalog["series"][0]["latest_league_id"]), (200, LEAGUE_ID))
        status, rows = request("GET", "/api/esports/matches?view=results&q=ONIC", self.player)
        self.assertEqual((status, rows["matches"][0]["id"]), (200, MATCH_ID))
        status, detail = request("GET", f"/api/esports/matches/{MATCH_ID}", self.player)
        self.assertEqual((status, detail["games"][0]["draft_coverage"]), (200, "complete"))
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": ""}):
            status, single = request("POST", f"/api/esports/matches/{MATCH_ID}/analysis", self.player, {"question": "Why?"})
            self.assertEqual((status, single["mode"]), (200, "facts"))
            status, scene = request("POST", "/api/esports/analysis", self.player, {"question": "What happened?", "match_ids": [MATCH_ID]})
            self.assertEqual((status, scene["mode"], scene["sources"][0]["match_id"]), (200, "facts", MATCH_ID))
        self.assertEqual(request("POST", "/api/esports/analysis", self.player, {"question": "?", "match_ids": [MATCH_ID, MATCH_ID]})[0], 400)
        self.assertEqual(request("POST", "/api/esports/analysis", self.player, {"question": "?", "match_ids": ["NOT-FOUND"]})[0], 404)
        self.assertEqual(request("POST", "/api/esports/analysis", self.player, {"question": "?", "match_ids": []})[0], 422)

    def test_refresh_is_role_gated_and_queue_is_shared(self):
        body = {"league_id": LEAGUE_ID}
        self.assertEqual(request("POST", "/api/esports/refresh", self.player, body)[0], 403)
        self.assertEqual(request("POST", "/api/esports/refresh", self.admin, body)[0], 409)
        with patch("app.aerena_service.ENABLED", True):
            self.assertEqual(request("POST", "/api/esports/refresh", self.admin, body)[0], 202)
            self.assertEqual(request("POST", "/api/esports/refresh", self.admin, body)[0], 409)


if __name__ == "__main__":
    unittest.main()
