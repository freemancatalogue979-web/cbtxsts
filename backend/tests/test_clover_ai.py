"""Member-AI ASGI security and retrieval tests; synthetic data, no network."""

from __future__ import annotations
import asyncio
import io
import json
import os
import unittest
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlsplit

os.environ["CLOVER_AERENA_ENABLED"] = "0"
from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from app.clover_ai_models import AIConversation, AIKnowledge, AIMemoryNote, AIMessage  # noqa: E402
from app.clover_ai_service import knowledge_search, safe_source_url  # noqa: E402
from app.db import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import ArchiveFolder, ArchiveItem, Hero, HeroPoolEntry, IntelLink, Scrim, User, utcnow  # noqa: E402
from app.security import issue_token  # noqa: E402


async def asgi_request(method, url, token="", payload=None, cookie=""):
    parsed = urlsplit(url)
    body = json.dumps(payload).encode() if payload is not None else b""
    headers = [(b"host", b"testserver"), (b"origin", b"https://other.e2b.app")]
    if token:
        headers.append((b"authorization", f"Bearer {token}".encode()))
    if cookie:
        headers.append((b"cookie", f"clover_session={cookie}".encode()))
    if payload is not None:
        headers.append((b"content-type", b"application/json"))
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": method,
        "scheme": "https",
        "path": parsed.path,
        "raw_path": parsed.path.encode(),
        "query_string": parsed.query.encode(),
        "root_path": "",
        "headers": headers,
        "client": ("198.51.100.9", 1234),
        "server": ("testserver", 443),
    }
    sent, received = [], False

    async def receive():
        nonlocal received
        if not received:
            received = True
            return {"type": "http.request", "body": body, "more_body": False}
        return {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    await app(scope, receive, send)
    start = next(message for message in sent if message["type"] == "http.response.start")
    content = b"".join(message.get("body", b"") for message in sent if message["type"] == "http.response.body")
    return start["status"], json.loads(content) if content else {}, dict(start["headers"])


def request(method, path, token="", payload=None, cookie=""):
    return asyncio.run(asgi_request(method, path, token, payload, cookie))


class CloverAITests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"CLOVER_AI_API_KEY": "", "DEEPSEEK_API_KEY": "", "CLOVER_CREDENTIAL_ENCRYPTION_KEY": ""})
        self.env.start()
        # General API/security tests must not contact a community source. The
        # source-integration suite exercises the real enrichment with fixtures.
        self.game_sources = patch("app.ai_game_sources.enrich", return_value=[])
        self.game_sources.start()
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

        @event.listens_for(self.engine, "connect")
        def enable_fk(conn, _record):
            conn.execute("PRAGMA foreign_keys=ON")

        Base.metadata.create_all(self.engine)
        self.factory = sessionmaker(bind=self.engine, autoflush=False)
        with self.factory() as db:
            own = User(
                email="owner@test.invalid",
                password_hash="unused",
                name="Own Member",
                ign="OwnIGN",
                role="player",
                main_role="JUNGLE",
            )
            other = User(
                email="other@test.invalid",
                password_hash="unused",
                name="Other Private Member",
                ign="OtherIGN",
                role="player",
            )
            admin = User(email="admin@test.invalid", password_hash="unused", name="Admin", role="admin")
            db.add_all([own, other, admin])
            db.flush()
            hero = Hero(
                name="Alice",
                role="EXP",
                hero_class="Mage",
                win_rate=99.9,
                notes="NEVER_SEND_HERO_NOTES",
                strong_against='["INVENTED_COUNTER"]',
            )
            other_hero = Hero(name="Ling", role="JUNGLE", hero_class="Assassin")
            db.add_all([hero, other_hero])
            db.flush()
            db.add_all(
                [
                    IntelLink(
                        user_id=own.id,
                        role_id=111222333,
                        zone_id=4444,
                        jwt="SECRET_OWN_JWT",
                        token="SECRET_OWN_REFRESH",
                        display_name="LinkedOwn",
                        level=42,
                    ),
                    IntelLink(
                        user_id=other.id,
                        role_id=999,
                        zone_id=999,
                        jwt="SECRET_OTHER_JWT",
                        token="SECRET_OTHER_REFRESH",
                        display_name="LinkedOther",
                    ),
                    HeroPoolEntry(
                        user_id=own.id,
                        hero_id=hero.id,
                        category="comfort",
                        confidence=8,
                        games=4,
                        wins=3,
                        losses=1,
                        coach_notes="SECRET_COACH_NOTE",
                    ),
                    HeroPoolEntry(
                        user_id=other.id, hero_id=other_hero.id, category="pocket", coach_notes="SECRET_OTHER_POOL"
                    ),
                    Scrim(
                        number=1,
                        opponent="Own Opponent",
                        scrim_date=date(2026, 1, 1),
                        lineup=json.dumps({"JUNGLE": own.id}),
                        substitutes="[]",
                        status="played",
                        result="WIN",
                        score_us=2,
                        score_them=1,
                        notes="SECRET_SCRIM_NOTE",
                    ),
                    Scrim(
                        number=2,
                        opponent="Other Private Opponent",
                        scrim_date=date(2026, 1, 2),
                        lineup=json.dumps({"ROAM": other.id}),
                        substitutes="[]",
                        status="played",
                        result="LOSS",
                    ),
                ]
            )
            folder = ArchiveFolder(owner_id=other.id, name="Other locker")
            db.add(folder)
            db.flush()
            db.add(
                ArchiveItem(
                    folder_id=folder.id,
                    title="SECRET_ARCHIVE_TITLE",
                    body="SECRET_ARCHIVE_BODY",
                    visibility="private",
                    created_by=other.id,
                )
            )
            db.commit()
            self.tokens = {
                key: issue_token(user.id, user.role, user.name)
                for key, user in (("owner", own), ("other", other), ("admin", admin))
            }

        def override_db():
            with self.factory() as db:
                yield db

        app.dependency_overrides[get_db] = override_db

    def tearDown(self):
        app.dependency_overrides.pop(get_db, None)
        self.engine.dispose()
        self.game_sources.stop()
        self.env.stop()

    def req(self, method, path, who="owner", payload=None):
        return request(method, "/api/ai" + path, self.tokens[who], payload)

    def new_chat(self, who="owner"):
        status, body, _ = self.req("POST", "/conversations", who)
        self.assertEqual(status, 201)
        return body["id"]

    def test_status_reports_no_application_web_daily_cap(self):
        with patch.dict(os.environ, {"CLOVER_AI_WEB_DAILY_LIMIT": "1"}):
            status, result, _ = self.req("GET", "/status")
        self.assertEqual(status, 200)
        self.assertIsNone(result["web_search_daily_limit"])
        self.assertIn("version", result["patch_feed"].lower())

    def test_chats_are_owner_only_even_for_admin_and_cookie_only_cannot_read(self):
        self.assertEqual(request("GET", "/api/ai/conversations")[0], 401)
        self.assertEqual(request("GET", "/api/ai/conversations", cookie=self.tokens["owner"])[0], 401)
        self.assertEqual(request("POST", "/api/ai/conversations", cookie=self.tokens["owner"])[0], 401)
        chat = self.new_chat()
        status, body, headers = self.req(
            "POST", f"/conversations/{chat}/messages", payload={"text": "How does Alice work?"}
        )
        self.assertEqual((status, body["assistant_message"]["mode"]), (201, "facts"))
        self.assertIn("rather than a generated answer", body["assistant_message"]["content"])
        self.assertEqual(headers.get(b"cache-control"), b"no-store")
        for who in ("other", "admin"):
            self.assertEqual(self.req("GET", "/conversations", who)[1]["items"], [])
            self.assertEqual(self.req("GET", f"/conversations/{chat}/messages", who)[0], 404)
            self.assertEqual(self.req("PATCH", f"/conversations/{chat}", who, {"title": "stolen"})[0], 404)
            self.assertEqual(self.req("POST", f"/conversations/{chat}/messages", who, {"text": "stolen"})[0], 404)
            self.assertEqual(self.req("DELETE", f"/conversations/{chat}", who)[0], 404)
        self.assertEqual(
            self.req("PATCH", f"/conversations/{chat}", payload={"title": "My private plan"})[1]["title"],
            "My private plan",
        )
        self.assertEqual(len(self.req("GET", f"/conversations/{chat}/messages")[1]["messages"]), 2)
        self.assertEqual(self.req("DELETE", f"/conversations/{chat}")[0], 204)
        with self.factory() as db:
            self.assertIsNone(db.get(AIConversation, chat))
            self.assertEqual(db.query(AIMessage).filter_by(conversation_id=chat).count(), 0)

    def test_minimization_preferences_history_and_no_secrets_in_provider_payload(self):
        captured = []

        def provider(req, timeout):
            captured.append(json.loads(req.data))
            self.assertEqual(req.get_header("Authorization"), "Bearer synthetic-key")
            return io.BytesIO(b'{"choices":[{"message":{"content":"Useful but cautious guidance."}}]}')

        chat = self.new_chat()
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener", return_value=SimpleNamespace(open=provider)
        ):
            status, result, _ = self.req("POST", f"/conversations/{chat}/messages", payload={"text": "Explain Alice."})
            self.assertEqual((status, result["assistant_message"]["mode"]), (201, "ai"))
            first = json.loads(captured[-1]["messages"][-1]["content"])["available_context"]
            self.assertEqual(first["hero_library"][0]["name"], "Alice")
            for key in ("member_profile", "member_hero_pool", "assigned_scrims"):
                self.assertNotIn(key, first)
            payload = {
                "share_profile": True,
                "share_pool": True,
                "share_scrims": True,
                "use_history": False,
                "coaching_goal": "Improve rotations",
            }
            self.assertEqual(self.req("PATCH", "/settings", payload=payload)[0], 200)
            status, second, _ = self.req(
                "POST", f"/conversations/{chat}/messages", payload={"text": "Review my hero pool and recent scrims."}
            )
            self.assertEqual(status, 201)
            sent = captured[-1]
            self.assertEqual(len(sent["messages"]), 2)
            facts = json.loads(sent["messages"][-1]["content"])["available_context"]
            self.assertEqual(facts["member_profile"]["name"], "OwnIGN")
            self.assertEqual(facts["member_profile"]["member_supplied_goal"], "Improve rotations")
            self.assertNotIn("role_id", facts["member_profile"]["linked_account_snapshot"])
            self.assertEqual(facts["member_hero_pool"]["entries"][0]["hero"], "Alice")
            self.assertEqual([x["opponent"] for x in facts["assigned_scrims"]["entries"]], ["Own Opponent"])
            serialized = json.dumps(sent)
            for secret in (
                "SECRET_OWN_JWT",
                "SECRET_OWN_REFRESH",
                "SECRET_OTHER",
                "SECRET_ARCHIVE",
                "SECRET_COACH",
                "SECRET_SCRIM",
                "Other Private Opponent",
                "OtherIGN",
                "owner@test.invalid",
                "99.9",
                "INVENTED_COUNTER",
                "NEVER_SEND_HERO_NOTES",
                "synthetic-key",
                "111222333",
            ):
                self.assertNotIn(secret, serialized)
            self.assertTrue(any(s["kind"] == "personal" for s in second["assistant_message"]["sources"]))
            self.assertEqual(self.req("PATCH", "/settings", payload={"use_history": True})[0], 200)
            self.req("POST", f"/conversations/{chat}/messages", payload={"text": "What next?"})
            self.assertGreater(len(captured[-1]["messages"]), 2)
            self.assertEqual(
                self.req("DELETE", "/settings/memory")[1],
                {
                    "share_profile": False,
                    "share_account_stats": False,
                    "share_pool": False,
                    "share_scrims": False,
                    "use_history": False,
                    "coaching_goal": "",
                },
            )
            self.req("POST", f"/conversations/{chat}/messages", payload={"text": "Start fresh."})
            self.assertEqual(len(captured[-1]["messages"]), 2)
            self.assertNotIn("member_profile", json.loads(captured[-1]["messages"][-1]["content"])["available_context"])
        self.assertEqual(self.req("GET", "/context")[1]["profile"]["name"], "OwnIGN")
        self.assertNotIn("SECRET_OWN_JWT", json.dumps(self.req("GET", "/context")[1]))

    def test_scrim_selection_requires_exact_assignment_and_notes_stay_excluded(self):
        from app.security import verify_token

        uid = verify_token(self.tokens["owner"]).subject
        with self.factory() as db:
            db.add_all(
                [
                    Scrim(
                        number=3,
                        opponent="Assigned substitute",
                        scrim_date=date(2026, 2, 1),
                        lineup="{}",
                        substitutes=json.dumps([str(uid)]),
                        status="scheduled",
                        notes="SECRET_SUB_NOTE",
                    ),
                    Scrim(
                        number=4,
                        opponent="Not assigned boolean",
                        scrim_date=date(2026, 2, 2),
                        lineup=json.dumps({"JUNGLE": True}),
                        substitutes="[]",
                        status="played",
                    ),
                    Scrim(
                        number=5,
                        opponent="Malformed assignment",
                        scrim_date=date(2026, 2, 3),
                        lineup="{bad json",
                        substitutes="not json",
                        status="played",
                    ),
                ]
            )
            db.commit()
        context = self.req("GET", "/context")[1]
        self.assertEqual([row["opponent"] for row in context["scrims"]], ["Assigned substitute", "Own Opponent"])
        self.assertEqual(context["scrims"][0]["assignment"], "substitute")
        self.assertNotIn("SECRET_SUB_NOTE", json.dumps(context))
        chat = self.new_chat()
        self.assertEqual(self.req("POST", f"/conversations/{chat}/messages", payload={"text": "   "})[0], 422)
        self.assertEqual(self.req("POST", f"/conversations/{chat}/messages", payload={"text": "x" * 4001})[0], 422)

    def test_provider_errors_quota_feedback_and_locked_chat(self):
        chat = self.new_chat()
        with self.factory() as db:
            row = db.get(AIConversation, chat)
            row.busy_until = utcnow() + timedelta(minutes=1)
            row.busy_token = "busy"
            db.commit()
        self.assertEqual(self.req("POST", f"/conversations/{chat}/messages", payload={"text": "hi"})[0], 409)
        with self.factory() as db:
            row = db.get(AIConversation, chat)
            row.busy_until = utcnow() - timedelta(seconds=1)
            db.commit()
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "secret-key"}), patch(
            "app.clover_ai_service._reserve", return_value=False
        ):
            status, result, _ = self.req("POST", f"/conversations/{chat}/messages", payload={"text": "hi"})
        self.assertEqual((status, result["assistant_message"]["mode"]), (201, "facts"))
        self.assertIn("record", result["assistant_message"]["note"])
        mid = result["assistant_message"]["id"]
        self.assertEqual(
            self.req("PATCH", f"/conversations/{chat}/messages/{mid}/feedback", payload={"rating": 1})[1]["feedback"], 1
        )
        self.assertEqual(
            self.req("PATCH", f"/conversations/{chat}/messages/{mid}/feedback", "admin", {"rating": -1})[0], 404
        )
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "secret-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener", side_effect=OSError("SECRET_EXTERNAL_ERROR")
        ):
            status, result, _ = self.req("POST", f"/conversations/{chat}/messages", payload={"text": "help"})
        self.assertEqual((status, result["assistant_message"]["mode"]), (201, "facts"))
        self.assertNotIn("SECRET_EXTERNAL_ERROR", json.dumps(result))
        self.assertNotIn("secret-key", json.dumps(result))

    def test_pagination_and_delete_during_generation(self):
        chat = self.new_chat()
        for i in range(3):
            self.req("POST", f"/conversations/{chat}/messages", payload={"text": f"Question {i}"})
        recent = self.req("GET", f"/conversations/{chat}/messages?limit=2")[1]
        self.assertEqual((len(recent["messages"]), recent["has_more"]), (2, True))
        older = self.req("GET", f"/conversations/{chat}/messages?limit=2&before={recent['messages'][0]['id']}")[1]
        self.assertLess(older["messages"][-1]["id"], recent["messages"][0]["id"])

        def provider(_req, timeout):
            self.assertEqual(self.req("DELETE", f"/conversations/{chat}")[0], 204)
            return io.BytesIO(b'{"choices":[{"message":{"content":"Should not survive deletion."}}]}')

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener", return_value=SimpleNamespace(open=provider)
        ):
            self.assertEqual(
                self.req("POST", f"/conversations/{chat}/messages", payload={"text": "Delete while working"})[0], 409
            )
        with self.factory() as db:
            self.assertIsNone(db.get(AIConversation, chat))
            self.assertEqual(db.query(AIMessage).filter_by(conversation_id=chat).count(), 0)

    def test_member_chat_and_esports_share_accounting_without_a_daily_cap(self):
        from app.aerena_models import AerenaAIUsage
        from app.esports_ai import ask
        from app.security import verify_token

        chat = self.new_chat()

        def provider(_req, timeout):
            return io.BytesIO(b'{"choices":[{"message":{"content":"Synthetic answer."}}]}')

        # An old deployment setting must no longer enforce an artificial cap.
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key", "CLOVER_AI_DAILY_LIMIT": "1"}), patch(
            "app.clover_ai_service.urllib.request.build_opener", return_value=SimpleNamespace(open=provider)
        ):
            status, result, _ = self.req("POST", f"/conversations/{chat}/messages", payload={"text": "Hello MLBB"})
            self.assertEqual((status, result["assistant_message"]["mode"]), (201, "ai"))
            with self.factory() as db:
                detail = {"match": {"id": "fixture", "status": "completed", "team1": {}, "team2": {}}, "games": []}
                other = ask(db, verify_token(self.tokens["owner"]).subject, "What happened?", detail)
                self.assertEqual(other["mode"], "ai")
                self.assertEqual(db.query(AerenaAIUsage).one().calls, 2)

    def test_expired_request_does_not_save_a_late_response(self):
        chat = self.new_chat()

        def provider(_req, timeout):
            with self.factory() as db:
                row = db.get(AIConversation, chat)
                row.busy_until = utcnow() - timedelta(seconds=1)
                db.commit()
            return io.BytesIO(b'{"choices":[{"message":{"content":"Late response"}}]}')

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener", return_value=SimpleNamespace(open=provider)
        ):
            status, _, _ = self.req("POST", f"/conversations/{chat}/messages", payload={"text": "Slow request"})
        self.assertEqual(status, 409)
        messages = self.req("GET", f"/conversations/{chat}/messages")[1]["messages"]
        self.assertEqual([(row["role"], row["content"]) for row in messages], [("user", "Slow request")])
        with self.factory() as db:
            self.assertIsNone(db.get(AIConversation, chat).busy_token)

    def test_contributions_are_explicit_reviewed_and_retrievable_without_chat_leaks(self):
        body = {
            "kind": "strategy",
            "title": "Alice river rotation",
            "content": "Consider watching the river before rotating.",
            "source_url": "https://example.com/evidence",
            "share_with_reviewers": False,
        }
        self.assertEqual(self.req("POST", "/contributions", payload=body)[0], 422)
        body["share_with_reviewers"] = True
        status, submission, _ = self.req("POST", "/contributions", payload=body)
        self.assertEqual((status, submission["status"]), (201, "pending"))
        self.assertEqual(self.req("POST", "/contributions", payload=body)[0], 409)
        self.assertEqual(self.req("GET", "/contributions", "other")[1], [])
        self.assertEqual(self.req("GET", "/review", "other")[0], 403)
        self.assertEqual(self.req("GET", "/knowledge?q=Alice", "other")[1]["notes"], [])
        self.assertEqual(
            self.req(
                "POST",
                f"/review/{submission['id']}",
                "admin",
                {"decision": "approve", "note": "checked", "reviewed": False},
            )[0],
            422,
        )
        decision = {"decision": "approve", "note": "REVIEWER_PRIVATE_NOTE", "reviewed": True}
        self.assertEqual(self.req("POST", f"/review/{submission['id']}", "admin", decision)[1]["status"], "approved")
        found = self.req("GET", "/knowledge?q=Alice", "other")[1]
        self.assertEqual((found["community_count"], found["notes"][0]["title"]), (1, body["title"]))
        self.assertEqual(found["heroes"][0]["name"], "Alice")
        self.assertNotIn("REVIEWER_PRIVATE_NOTE", json.dumps(found))
        self.assertEqual(self.req("POST", "/contributions", "other", body)[0], 409)
        chat = self.new_chat("other")
        captured = []

        def provider(req, timeout):
            captured.append(json.loads(req.data))
            return io.BytesIO(b'{"choices":[{"message":{"content":"A cautious note."}}]}')

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener", return_value=SimpleNamespace(open=provider)
        ):
            status, result, _ = self.req(
                "POST", f"/conversations/{chat}/messages", "other", {"text": "Alice river rotation?"}
            )
        facts = json.loads(captured[0]["messages"][-1]["content"])["available_context"]
        self.assertEqual(facts["reviewed_community_notes"][0]["title"], body["title"])
        self.assertNotIn("REVIEWER_PRIVATE_NOTE", json.dumps(captured))
        self.assertTrue(any(s["kind"] == "community" for s in result["assistant_message"]["sources"]))
        note_id = found["notes"][0]["id"]
        self.assertEqual(self.req("GET", f"/knowledge/{note_id}", "other")[1]["title"], body["title"])
        self.assertTrue(any(s.get("knowledge_id") == note_id for s in result["assistant_message"]["sources"]))
        self.assertEqual(self.req("DELETE", f"/knowledge/{note_id}", "other")[0], 403)
        self.assertEqual(self.req("DELETE", f"/knowledge/{note_id}", "admin")[0], 204)
        self.assertEqual(self.req("GET", f"/knowledge/{note_id}", "other")[0], 404)
        self.assertEqual(self.req("GET", "/knowledge?q=Alice", "other")[1]["notes"], [])
        self.assertEqual(self.req("GET", "/contributions")[1][0]["status"], "removed")
        body["title"], body["source_url"] = "Invalid source", "https://127.0.0.1/private"
        self.assertEqual(self.req("POST", "/contributions", payload=body)[0], 422)

    def test_question_review_is_not_published_and_pending_author_can_withdraw(self):
        body = {
            "kind": "question",
            "title": "What is a rotation?",
            "content": "Please explain rotation.",
            "source_url": "",
            "share_with_reviewers": True,
        }
        _, item, _ = self.req("POST", "/contributions", payload=body)
        self.assertEqual(self.req("DELETE", f"/contributions/{item['id']}", "other")[0], 404)
        result = self.req(
            "POST",
            f"/review/{item['id']}",
            "admin",
            {"decision": "approve", "note": "See the guide.", "reviewed": True},
        )
        self.assertEqual(result[1]["status"], "reviewed")
        self.assertEqual(self.req("GET", "/knowledge?q=rotation")[1]["community_count"], 0)
        self.assertEqual(self.req("DELETE", f"/contributions/{item['id']}")[0], 409)
        body["title"] = "Please withdraw this"
        _, pending, _ = self.req("POST", "/contributions", payload=body)
        self.assertEqual(self.req("DELETE", f"/contributions/{pending['id']}")[0], 204)
        self.assertEqual(len(self.req("GET", "/contributions")[1]), 1)

    def test_keyword_retrieval_ranks_relevant_active_notes_and_skips_pending(self):
        with self.factory() as db:
            db.add_all(
                [
                    AIKnowledge(
                        title="Alice river rotation",
                        content="A river rotation plan",
                        source_url="",
                        fingerprint="a" * 64,
                        reviewed_at=utcnow() - timedelta(days=2),
                    ),
                    AIKnowledge(
                        title="Alice unrelated",
                        content="Other subject",
                        source_url="",
                        fingerprint="b" * 64,
                        reviewed_at=utcnow(),
                    ),
                    AIKnowledge(
                        title="Alice river rotation perfect",
                        content="Not active",
                        source_url="",
                        fingerprint="c" * 64,
                        active=False,
                        reviewed_at=utcnow(),
                    ),
                ]
            )
            db.commit()
            found = knowledge_search(db, "Alice river rotation", 1)
            self.assertEqual([row.title for row in found], ["Alice river rotation"])
            self.assertEqual(knowledge_search(db, "the and for", 5), [])

    def test_source_url_restrictions(self):
        for value in (
            "javascript:alert(1)",
            "http://example.com",
            "https://localhost/path",
            "https://127.0.0.1/x",
            "https://127.1/x",
            "https://0177.0.0.1/x",
            "https://0x7f.0.0.1/x",
            "https://10.0.0.2/a",
            "https://example.com@127.0.0.1/x",
            "https://bad_host.example/a",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                safe_source_url(value)
        self.assertEqual(safe_source_url("https://example.com/fact"), "https://example.com/fact")

    def test_memory_is_owner_only_and_only_explicit_opt_ins_reach_provider(self):
        self.assertEqual(request("GET", "/api/ai/memory-notes", cookie=self.tokens["owner"])[0], 401)
        status, private, headers = self.req(
            "POST", "/memory-notes", payload={"category": "strength", "content": "PRIVATE_UNSHARED_NOTE"}
        )
        self.assertEqual(
            (status, private["share_in_context"], headers.get(b"cache-control")), (201, False, b"no-store")
        )
        shared = self.req(
            "POST",
            "/memory-notes",
            payload={"category": "focus", "content": "MEMBER_OPTED_IN_NOTE", "share_in_context": True},
        )[1]
        other = self.req(
            "POST",
            "/memory-notes",
            "other",
            {"category": "goal", "content": "OTHER_MEMBER_NOTE", "share_in_context": True},
        )[1]
        for who in ("other", "admin"):
            self.assertNotIn(private["id"], [item["id"] for item in self.req("GET", "/memory-notes", who)[1]])
            self.assertEqual(self.req("PATCH", f"/memory-notes/{private['id']}", who, {"content": "steal"})[0], 404)
            self.assertEqual(self.req("DELETE", f"/memory-notes/{private['id']}", who)[0], 404)
        self.assertEqual(self.req("PATCH", f"/memory-notes/{private['id']}", payload={"content": "   "})[0], 422)
        self.assertEqual(self.req("PATCH", f"/memory-notes/{private['id']}", payload={"content": None})[0], 422)
        self.assertEqual(self.req("POST", "/memory-notes", payload={"category": "unknown", "content": "x"})[0], 422)

        captured = []

        def provider(req, timeout):
            captured.append(json.loads(req.data))
            return io.BytesIO(b'{"choices":[{"message":{"content":"Synthetic coaching response."}}]}')

        chat = self.new_chat()
        self.req("PATCH", "/settings", payload={"use_history": False})
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener", return_value=SimpleNamespace(open=provider)
        ):
            status, result, _ = self.req(
                "POST", f"/conversations/{chat}/messages", payload={"text": "What should I practice?"}
            )
            self.assertEqual(status, 201)
            sent = json.dumps(captured[-1])
            facts = json.loads(captured[-1]["messages"][-1]["content"])["available_context"]
            self.assertNotIn("member_profile", facts)  # note consent is independent from profile opt-in
            self.assertEqual(
                facts["member_coaching_notes"]["entries"], [{"category": "focus", "content": "MEMBER_OPTED_IN_NOTE"}]
            )
            self.assertIn("not independently verified", facts["member_coaching_notes"]["notice"])
            self.assertIn("MEMBER_OPTED_IN_NOTE", sent)
            self.assertNotIn("PRIVATE_UNSHARED_NOTE", sent)
            self.assertNotIn("OTHER_MEMBER_NOTE", sent)
            self.assertTrue(any("coaching notes" in item["label"] for item in result["assistant_message"]["sources"]))
            self.req("PATCH", f"/memory-notes/{shared['id']}", payload={"share_in_context": False})
            self.req(
                "PATCH", f"/memory-notes/{private['id']}", payload={"share_in_context": True, "content": "UPDATED_NOTE"}
            )
            self.req("POST", f"/conversations/{chat}/messages", payload={"text": "A fresh question"})
            sent = json.dumps(captured[-1])
            self.assertIn("UPDATED_NOTE", sent)
            self.assertNotIn("MEMBER_OPTED_IN_NOTE", sent)
            self.req("DELETE", "/settings/memory")
            self.assertEqual(self.req("GET", "/memory-notes")[1], [])
            self.assertEqual(self.req("GET", "/memory-notes", "other")[1][0]["id"], other["id"])
            self.req("POST", f"/conversations/{chat}/messages", payload={"text": "After clearing"})
            self.assertNotIn(
                "member_coaching_notes", json.loads(captured[-1]["messages"][-1]["content"])["available_context"]
            )
            self.assertGreater(len(self.req("GET", f"/conversations/{chat}/messages")[1]["messages"]), 0)

    def test_memory_note_limit_and_edit_delete(self):
        ids = []
        for i in range(12):
            status, item, _ = self.req(
                "POST", "/memory-notes", payload={"category": "preference", "content": f"Note {i}"}
            )
            self.assertEqual(status, 201)
            ids.append(item["id"])
        self.assertEqual(self.req("POST", "/memory-notes", payload={"category": "goal", "content": "Too many"})[0], 409)
        self.assertEqual(self.req("POST", "/memory-notes", payload={"category": "goal", "content": "x" * 501})[0], 422)
        edited = self.req("PATCH", f"/memory-notes/{ids[0]}", payload={"category": "goal", "content": "  New goal  "})[
            1
        ]
        self.assertEqual((edited["category"], edited["content"]), ("goal", "New goal"))
        self.assertEqual(self.req("DELETE", f"/memory-notes/{ids[0]}")[0], 204)
        self.assertEqual(self.req("POST", "/memory-notes", payload={"category": "goal", "content": "New slot"})[0], 201)
        self.assertEqual(len(self.req("GET", "/memory-notes")[1]), 12)
        # Even overlapping requests cannot bypass the database slot limit.
        with self.factory() as db:
            existing = db.query(AIMemoryNote).first()
            uid, slot = existing.user_id, existing.slot
            db.add(AIMemoryNote(user_id=uid, slot=slot, category="goal", content="duplicate"))
            with self.assertRaises(IntegrityError):
                db.commit()
            db.rollback()
            db.add(AIMemoryNote(user_id=uid, slot=12, category="goal", content="outside the limit"))
            with self.assertRaises(IntegrityError):
                db.commit()
            db.rollback()

    def test_selected_saved_matches_only_use_local_allowlisted_evidence(self):
        from app.aerena_models import AerenaDraftEvent, AerenaGame, AerenaLeague, AerenaMatch, AerenaPlayerGameStat
        from app.esports_ai import MAX_CONTEXT_CHARS

        with self.factory() as db:
            left = {"team": "A", "teamName": "Alpha", "teamScore": 1, "teamKills": 8, "raw_secret": "SOURCE_SECRET"}
            right = {"team": "B", "teamName": "Bravo", "teamScore": 2, "teamKills": 15}
            db.add_all(
                [
                    AerenaLeague(id="league-1", code="SYN", name="Synthetic Season"),
                    AerenaMatch(
                        id="MATCH-ONE",
                        source_id="src-1",
                        league_id="league-1",
                        has_result=True,
                        team1_json=json.dumps(left),
                        team2_json=json.dumps(right),
                        winner_json=json.dumps(right),
                        team1_name="Alpha",
                        team2_name="Bravo",
                        source_verified=False,
                        game_count=1,
                    ),
                    AerenaMatch(
                        id="MATCH-TWO",
                        source_id="src-2",
                        league_id="league-1",
                        has_result=False,
                        team1_json=json.dumps({"teamName": "Charlie"}),
                        team2_json=json.dumps({"teamName": "Delta"}),
                        team1_name="Charlie",
                        team2_name="Delta",
                        game_count=0,
                    ),
                    AerenaGame(id="game-1", match_id="MATCH-ONE", number=1, draft_coverage="partial"),
                    AerenaDraftEvent(
                        game_id="game-1",
                        match_id="MATCH-ONE",
                        kind="Pick",
                        source_order=1,
                        sequence=None,
                        side=None,
                        hero_id="unknown-hero",
                    ),
                    AerenaPlayerGameStat(
                        id="stat-1",
                        match_id="MATCH-ONE",
                        game_number=1,
                        ign="Recorded Player",
                        raw_json=json.dumps({"kills": 4, "secret": "STAT_RAW_SECRET"}),
                    ),
                ]
            )
            db.commit()
        chat = self.new_chat()
        captured = []

        def provider(req, timeout):
            captured.append(json.loads(req.data))
            return io.BytesIO(b'{"choices":[{"message":{"content":"Synthetic match analysis."}}]}')

        with patch(
            "app.routers.esports._claim_detail_refresh", side_effect=AssertionError("must not refresh")
        ) as refresh, patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener", return_value=SimpleNamespace(open=provider)
        ):
            self.req("POST", f"/conversations/{chat}/messages", payload={"text": "No match selected"})
            self.assertNotIn(
                "selected_aerena_matches", json.loads(captured[-1]["messages"][-1]["content"])["available_context"]
            )
            status, result, _ = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "Compare these matches", "match_ids": ["MATCH-ONE", "MATCH-TWO"]},
            )
            self.assertEqual(status, 201)
            facts = json.loads(captured[-1]["messages"][-1]["content"])["available_context"]
            sample = facts["selected_aerena_matches"]
            self.assertLessEqual(len(json.dumps(sample, ensure_ascii=False)), MAX_CONTEXT_CHARS)
            self.assertEqual([m["match_id"] for m in sample["matches"]], ["MATCH-ONE", "MATCH-TWO"])
            self.assertFalse(sample["matches"][0]["source_verified"])
            self.assertEqual(sample["matches"][0]["games"][0]["draft_coverage"], "partial")
            self.assertIsNone(sample["matches"][0]["games"][0]["draft"][0]["sequence"])
            self.assertEqual(sample["matches"][1]["games"], [])
            sent = json.dumps(captured[-1])
            self.assertNotIn("SOURCE_SECRET", sent)
            self.assertNotIn("STAT_RAW_SECRET", sent)
            self.assertNotIn("SECRET_OWN_JWT", sent)
            self.assertNotIn("SECRET_ARCHIVE", sent)
            sources = [s for s in result["assistant_message"]["sources"] if s["kind"] == "match"]
            self.assertEqual(len(sources), 2)
            self.assertEqual(sources[0]["url"], "https://aerena.gg/mobile-legends/match/MATCH-ONE")
            self.assertTrue(sources[0]["observed_at"])
            self.assertEqual(len(result["user_message"]["sources"]), 2)
            refresh.assert_not_called()
        with patch("app.routers.esports._claim_detail_refresh", side_effect=AssertionError("must not refresh")):
            status, result, _ = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "What was the result?", "match_ids": ["MATCH-ONE", "MATCH-TWO"]},
            )
            self.assertEqual((status, result["assistant_message"]["mode"]), (201, "facts"))
            self.assertIn("Alpha 1–2 Bravo", result["assistant_message"]["content"])
            self.assertIn("not available", result["assistant_message"]["content"])
            self.assertIn("not a complete team or season history", result["assistant_message"]["content"])
        before = len(self.req("GET", f"/conversations/{chat}/messages")[1]["messages"])
        self.assertEqual(
            self.req("POST", f"/conversations/{chat}/messages", payload={"text": "x", "match_ids": ["missing"]})[0], 404
        )
        self.assertEqual(
            self.req("POST", f"/conversations/{chat}/messages", payload={"text": "x", "match_ids": ["MATCH-ONE"] * 2})[
                0
            ],
            422,
        )
        self.assertEqual(
            self.req(
                "POST", f"/conversations/{chat}/messages", payload={"text": "x", "match_ids": ["1", "2", "3", "4"]}
            )[0],
            422,
        )
        self.assertEqual(before, len(self.req("GET", f"/conversations/{chat}/messages")[1]["messages"]))
        self.assertEqual(
            self.req("POST", f"/conversations/{chat}/messages", payload={"text": "Lease was released"})[0], 201
        )

    def test_search_and_bounded_plaintext_export_are_owner_only(self):
        own = self.new_chat()
        self.req("POST", f"/conversations/{own}/messages", payload={"text": "A rare phrase and 100% safe"})
        self.req("PATCH", f"/conversations/{own}", payload={"title": "Practice journal"})
        another = self.new_chat()
        self.req("POST", f"/conversations/{another}/messages", payload={"text": "100abc"})
        foreign = self.new_chat("other")
        self.req("POST", f"/conversations/{foreign}/messages", "other", {"text": "A rare phrase"})
        status, found, headers = self.req("POST", "/conversations/search", payload={"q": "rare phrase"})
        self.assertEqual((status, headers.get(b"cache-control")), (200, b"no-store"))
        self.assertEqual([item["id"] for item in found["items"]], [own])
        self.assertEqual(
            [item["id"] for item in self.req("POST", "/conversations/search", payload={"q": "100%"})[1]["items"]], [own]
        )
        self.assertEqual(self.req("POST", "/conversations/search", payload={"q": "100_"})[1]["items"], [])
        self.assertEqual(
            [item["id"] for item in self.req("POST", "/conversations/search", payload={"q": "journal"})[1]["items"]],
            [own],
        )
        self.assertEqual(self.req("POST", "/conversations/search", payload={"q": "x"})[0], 422)
        self.assertEqual(
            request("POST", "/api/ai/conversations/search", payload={"q": "rare"}, cookie=self.tokens["owner"])[0], 401
        )
        for who in ("other", "admin"):
            self.assertEqual(self.req("GET", f"/conversations/{own}/export", who)[0], 404)
        status, exported, headers = self.req("GET", f"/conversations/{own}/export")
        self.assertEqual((status, headers.get(b"cache-control")), (200, b"no-store"))
        self.assertEqual(exported["format"], "9clover-ai-conversation-v1")
        self.assertFalse(exported["truncated"])
        self.assertIn("plaintext", exported["notice"])
        self.assertEqual(len(exported["messages"]), 2)
        with self.factory() as db:
            db.add_all(
                [AIMessage(conversation_id=own, role="user", content=f"Extra {i}", mode="user") for i in range(501)]
            )
            db.commit()
        exported = self.req("GET", f"/conversations/{own}/export")[1]
        self.assertTrue(exported["truncated"])
        self.assertEqual(len(exported["messages"]), exported["message_limit"])
        self.assertEqual(exported["next_after"], exported["messages"][-1]["id"])
        with self.factory() as db:
            db.add(AIMessage(conversation_id=own, role="user", content="Added after snapshot", mode="user"))
            db.commit()
        second = self.req(
            "GET", f"/conversations/{own}/export?after={exported['next_after']}&through={exported['snapshot_through']}"
        )[1]
        self.assertFalse(second["truncated"])
        self.assertIsNone(second["next_after"])
        self.assertEqual(len(exported["messages"]) + len(second["messages"]), 503)
        self.assertNotIn("Added after snapshot", json.dumps(second))
        self.assertEqual(self.req("GET", f"/conversations/{own}/export?after=50&through=1")[0], 422)


if __name__ == "__main__":
    unittest.main()
