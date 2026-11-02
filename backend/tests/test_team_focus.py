"""Team focus remains role-gated and drives the real dashboard payload."""

from __future__ import annotations

import asyncio
import json
import os
import unittest

os.environ["CLOVER_AERENA_ENABLED"] = "0"

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.db import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import TeamSettings, TrainingActivity, TrainingWeek, User  # noqa: E402
from app.security import issue_token  # noqa: E402


async def asgi_request(
    method: str, path: str, token: str = "", payload: dict | None = None
):
    body = json.dumps(payload).encode() if payload is not None else b""
    headers = [(b"host", b"clover.example")]
    if token:
        headers.append((b"authorization", f"Bearer {token}".encode()))
    if payload is not None:
        headers.append((b"content-type", b"application/json"))
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": method,
        "scheme": "https",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": headers,
        "client": ("198.51.100.2", 1234),
        "server": ("clover.example", 443),
    }
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
    content = b"".join(
        event.get("body", b"")
        for event in sent
        if event["type"] == "http.response.body"
    )
    return start["status"], json.loads(content) if content else {}


def request(method: str, path: str, token: str = "", payload: dict | None = None):
    return asyncio.run(asgi_request(method, path, token, payload))


class TeamFocusHttpTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        Base.metadata.create_all(self.engine)
        self.factory = sessionmaker(bind=self.engine, autoflush=False)
        with self.factory() as db:
            users = [
                User(
                    email=f"{role}@test.invalid",
                    password_hash="unused",
                    name=role,
                    role=role,
                )
                for role in ("admin", "coach", "captain", "player")
            ]
            db.add_all(
                [
                    *users,
                    TeamSettings(
                        id=1,
                        current_weakness="",
                        weakness_category="MACRO",
                        weakness_drills_target=3,
                        season_name="",
                    ),
                ]
            )
            db.commit()
            self.tokens = {
                user.role: issue_token(user.id, user.role, user.name) for user in users
            }

        def override_db():
            with self.factory() as db:
                yield db

        app.dependency_overrides[get_db] = override_db

    def tearDown(self):
        app.dependency_overrides.pop(get_db, None)
        self.engine.dispose()

    def test_focus_permissions_save_and_dashboard_visibility(self):
        path = "/api/admin/settings"
        self.assertEqual(request("GET", path)[0], 401)
        for role in ("player", "captain"):
            self.assertEqual(
                request(
                    "PATCH",
                    path,
                    self.tokens[role],
                    {"current_weakness": "Unauthorized"},
                )[0],
                403,
            )
        self.assertEqual(
            request("GET", path, self.tokens["player"])[1]["current_weakness"], ""
        )

        focus = {
            "season_name": "S18",
            "current_weakness": "Rotations",
            "weakness_category": "macro",
            "weakness_drills_target": 4,
        }
        status, saved = request("PATCH", path, self.tokens["coach"], focus)
        self.assertEqual(status, 200)
        self.assertEqual(saved, {**focus, "weakness_category": "MACRO"})
        status, dashboard = request("GET", "/api/dashboard", self.tokens["player"])
        self.assertEqual(status, 200)
        self.assertEqual(dashboard["weakness"]["current_weakness"], "Rotations")
        self.assertEqual(dashboard["weakness"]["season_name"], "S18")
        self.assertEqual(dashboard["weakness"]["weakness_drills_target"], 4)
        self.assertEqual(dashboard["weakness"]["drills_remaining"], 4)

        self.assertEqual(
            request(
                "PATCH",
                path,
                self.tokens["admin"],
                {"current_weakness": "", "weakness_drills_target": 0},
            )[0],
            200,
        )
        self.assertIsNone(
            request("GET", "/api/dashboard", self.tokens["player"])[1]["weakness"]
        )
        self.assertEqual(
            request("GET", path, self.tokens["admin"])[1]["weakness_drills_target"], 0
        )

    def test_dashboard_counts_only_done_drills_in_the_active_block_and_category(self):
        with self.factory() as db:
            active = TrainingWeek(number=1, focus="Focus", status="active")
            past = TrainingWeek(number=2, focus="Previous", status="completed")
            db.add_all([active, past])
            db.flush()
            db.add_all(
                [
                    TrainingActivity(
                        week_id=active.id,
                        title="Done macro",
                        category="MACRO",
                        status="done",
                    ),
                    TrainingActivity(
                        week_id=active.id,
                        title="Pending macro",
                        category="MACRO",
                        status="scheduled",
                    ),
                    TrainingActivity(
                        week_id=active.id,
                        title="Done draft",
                        category="DRAFT",
                        status="done",
                    ),
                    TrainingActivity(
                        week_id=past.id,
                        title="Old macro",
                        category="MACRO",
                        status="done",
                    ),
                ]
            )
            db.commit()
        path = "/api/admin/settings"
        token = self.tokens["admin"]
        self.assertEqual(
            request(
                "PATCH",
                path,
                token,
                {
                    "current_weakness": "Rotations",
                    "weakness_category": "MACRO",
                    "weakness_drills_target": 3,
                },
            )[0],
            200,
        )
        focus = request("GET", "/api/dashboard", self.tokens["player"])[1]["weakness"]
        self.assertEqual((focus["drills_done"], focus["drills_remaining"]), (1, 2))
        self.assertEqual(
            request(
                "PATCH",
                path,
                token,
                {
                    "weakness_category": "DRAFT",
                    "weakness_drills_target": 1,
                },
            )[0],
            200,
        )
        focus = request("GET", "/api/dashboard", self.tokens["player"])[1]["weakness"]
        self.assertEqual((focus["drills_done"], focus["drills_remaining"]), (1, 0))


if __name__ == "__main__":
    unittest.main()
