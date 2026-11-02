"""AI actions: typed proposals, independent review, RBAC, conflicts and durable audit."""

from __future__ import annotations

import io
import json
import os
import unittest
import tempfile
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from app.clover_ai_models import AIActionAudit, AIActionProposal, AIConversation, AIMessage
from app.db import Base
from app.models import DraftPlan, Hero, StrategyNote, User, utcnow
from app.platform_data import PlatformPatch, TeamEquipment
from app.security import issue_token
from tests import test_clover_ai as fixture


class AIActionTests(unittest.TestCase):
    setUp = fixture.CloverAITests.setUp
    tearDown = fixture.CloverAITests.tearDown
    req = fixture.CloverAITests.req
    new_chat = fixture.CloverAITests.new_chat

    def set_roles(self):
        with self.factory() as db:
            for role in ("captain", "coach", "analyst"):
                user = User(email=f"{role}@test.invalid", name=role, password_hash="unused", role=role)
                db.add(user)
                db.flush()
                self.tokens[role] = issue_token(user.id, role, role)
            second = User(email="second@test.invalid", name="Second admin", password_hash="unused", role="admin")
            db.add(second)
            db.flush()
            self.tokens["second"] = issue_token(second.id, "admin", "Second admin")
            db.commit()

    def propose(self, question, kind, payload, who="admin", *, request_action=False):
        chat = self.new_chat(who)
        calls = []
        answer = {"answer": "Here is a proposal to review.", "proposal": {"kind": kind, "payload": payload}}

        def provider(req, timeout):
            calls.append(json.loads(req.data))
            return io.BytesIO(json.dumps({"choices": [{"message": {"content": json.dumps(answer)}}]}).encode())

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener", return_value=SimpleNamespace(open=provider)
        ):
            response = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                who,
                {"text": question, "web_mode": "off", "auto_esports": False, "request_action": request_action},
            )
        return chat, response, calls

    def test_read_only_draft_questions_do_not_enable_write_proposals(self):
        from app.ai_actions import intent

        with self.factory() as db:
            self.assertEqual(intent(db, "Analyze my draft against Alice"), [])
            self.assertEqual(intent(db, "What does this draft need?"), [])
            self.assertIn("create_draft", intent(db, "Please draft a lineup around Alice"))
            self.assertIn("create_draft", intent(db, "Create a draft for Alice"))

    def test_draft_review_confirm_idempotence_privacy_and_audit_survives_chat_deletion(self):
        self.set_roles()
        draft = {
            "name": "Alice opener",
            "opponent": "Rivals",
            "patch": "",
            "notes": "Test in scrims.",
            "draft": {"our_bans": ["Ling"], "enemy_bans": [], "our_picks": {"EXP": "Alice"}, "enemy_picks": {}},
        }
        chat, (status, result, _), calls = self.propose("Create a draft around Alice", "create_draft", draft)
        self.assertEqual(status, 201)
        self.assertEqual(calls[0]["response_format"], {"type": "json_object"})
        proposal = result["assistant_message"]["proposal"]
        self.assertEqual(proposal["status"], "pending")
        self.assertIn("nothing changes", result["assistant_message"]["content"])
        with self.factory() as db:
            self.assertEqual(db.query(DraftPlan).count(), 0)
            self.assertEqual(db.query(AIActionAudit).count(), 0)
        self.assertEqual(self.req("GET", f"/conversations/{chat}/messages", "owner")[0], 404)
        path = f"/actions/{proposal['id']}/apply"
        for who in ("owner", "captain", "coach", "analyst"):
            self.assertEqual(self.req("POST", path, who, {"reviewed": True, "confirm": True})[0], 403)
        self.assertEqual(self.req("POST", path, "second", {"reviewed": True, "confirm": True})[0], 409)
        self.assertEqual(self.req("POST", path, "admin", {"reviewed": False, "confirm": True})[0], 422)
        self.assertEqual(self.req("POST", path, "admin", {"reviewed": True, "confirm": "true"})[0], 422)
        self.assertEqual(
            fixture.request(
                "POST", "/api/ai" + path, cookie=self.tokens["admin"], payload={"reviewed": True, "confirm": True}
            )[0],
            401,
        )
        applied = self.req("POST", path, "admin", {"reviewed": True, "confirm": True})
        self.assertEqual(applied[0], 200)
        self.assertEqual(applied[1]["status"], "applied")
        self.assertEqual(self.req("POST", path, "admin", {"reviewed": True, "confirm": True})[0], 409)
        with self.factory() as db:
            target = db.query(DraftPlan).one()
            self.assertEqual(target.status, "idea")
            self.assertEqual(json.loads(target.draft)["our_picks"], {"EXP": "Alice"})
            self.assertEqual(db.query(AIActionAudit).count(), 1)
        self.assertEqual(self.req("GET", "/actions/audit", "coach")[0], 403)
        audit = self.req("GET", "/actions/audit", "admin")[1]["items"]
        self.assertEqual(audit[0]["kind"], "create_draft")
        self.assertNotIn("Create a draft around Alice", json.dumps(audit))
        self.assertEqual(self.req("DELETE", f"/conversations/{chat}", "admin")[0], 204)
        with self.factory() as db:
            self.assertEqual(db.query(AIActionProposal).count(), 0)
            self.assertEqual(db.query(AIActionAudit).count(), 1)

    def test_nonadmins_cannot_request_or_apply_ai_actions_even_if_they_can_edit_normally(self):
        self.set_roles()
        draft = {"name": "Bad", "draft": {"our_picks": {"EXP": "Alice"}}}
        for role in ("owner", "captain", "coach", "analyst"):
            chat, (status, _, _), calls = self.propose(
                "Create a draft for Alice", "create_draft", draft, role, request_action=True
            )
            self.assertEqual(status, 403)
            self.assertEqual(calls, [])
            self.assertEqual(self.req("GET", f"/conversations/{chat}/messages", role)[1]["messages"], [])
        _, (status, result, _), calls = self.propose("Create a draft for Alice", "create_draft", draft, "coach")
        self.assertEqual(status, 201)
        self.assertNotIn("response_format", calls[0])
        self.assertIsNone(result["assistant_message"]["proposal"])
        # Existing manual captain/coach permissions are deliberately unchanged.
        self.assertEqual(fixture.request("POST", "/api/drafts", self.tokens["captain"], {"name": "Manual"})[0], 201)
        self.assertEqual(
            fixture.request("POST", "/api/strategy", self.tokens["coach"], {"title": "Manual", "body": "Plan"})[0], 201
        )

    def test_manual_equipment_crud_is_admin_only_and_names_are_checked(self):
        self.set_roles()
        path = "/api/items"
        payload = {
            "name": "Clover Shield",
            "category": "Defense",
            "description": "A team-maintained description",
            "patch": "1.0",
            "source_url": "https://example.com/guide",
        }
        for who in ("owner", "captain", "coach", "analyst"):
            self.assertEqual(fixture.request("POST", path, self.tokens[who], payload)[0], 403)
        self.assertEqual(fixture.request("POST", path, cookie=self.tokens["admin"], payload=payload)[0], 401)
        created = fixture.request("POST", path, self.tokens["admin"], payload)
        self.assertEqual(created[0], 201)
        item_id = created[1]["id"]
        self.assertEqual(fixture.request("GET", path, self.tokens["owner"])[1][0]["name"], "Clover Shield")
        self.assertEqual(
            fixture.request("POST", path, self.tokens["admin"], {**payload, "name": "clover shield"})[0], 409
        )
        self.assertEqual(
            fixture.request("PATCH", f"{path}/{item_id}", self.tokens["captain"], {"description": "No"})[0], 403
        )
        self.assertEqual(
            fixture.request(
                "PATCH", f"{path}/{item_id}", self.tokens["admin"], {"source_url": "https://127.0.0.1/unsafe"}
            )[0],
            422,
        )
        self.assertEqual(
            fixture.request("PATCH", f"{path}/{item_id}", self.tokens["admin"], {"description": "Updated"})[1][
                "description"
            ],
            "Updated",
        )
        self.assertEqual(fixture.request("DELETE", f"{path}/{item_id}", self.tokens["coach"])[0], 403)
        self.assertEqual(fixture.request("DELETE", f"{path}/{item_id}", self.tokens["admin"])[0], 204)

    def test_invalid_mismatched_and_executable_payloads_never_become_proposals(self):
        invalid = [
            ("Create a draft", "create_draft", {"name": "x", "draft": {"our_picks": {"EXP": "Unknown Hero"}}}),
            (
                "Create a draft",
                "create_draft",
                {"name": "x", "draft": {"our_bans": ["Alice"], "our_picks": {"EXP": "Alice"}}},
            ),
            ("Create a draft", "create_draft", {"name": "x", "draft": {}, "sql": "DELETE FROM users"}),
            ("Create a draft", "create_item", {"name": "Injected", "description": "x"}),
            ("Create a draft", "run_shell", {"command": "rm -rf /"}),
        ]
        for question, kind, data in invalid:
            _, (status, result, _), _ = self.propose(question, kind, data)
            self.assertEqual(status, 201)
            self.assertIsNone(result["assistant_message"]["proposal"])
            self.assertIn("Nothing was changed", result["assistant_message"]["content"])
        with self.factory() as db:
            self.assertEqual(db.query(AIActionProposal).count(), 0)
            self.assertEqual(db.query(DraftPlan).count(), 0)
            self.assertEqual(db.query(TeamEquipment).count(), 0)
            self.assertEqual(db.query(User).count(), 3)

    def test_strategy_item_hero_and_patch_are_applied_only_after_confirmation(self):
        cases = [
            (
                "Create a strategy for turtle",
                "create_strategy",
                {"title": "Turtle setup", "category": "OBJECTIVE", "body": "Secure vision first.", "tags": ["turtle"]},
            ),
            (
                "Add an item called Test Shield",
                "create_item",
                {"name": "Test Shield", "category": "Defense", "description": "Team note: shield timing.", "patch": ""},
            ),
            (
                "Add a new hero called Newcomer",
                "create_hero",
                {"name": "Newcomer", "role": "MID", "hero_class": "Mage", "notes": "Unverified entry"},
            ),
            ("Update the global patch label to 1.2.3", "set_patch", {"label": "1.2.3"}),
        ]
        for question, kind, data in cases:
            _, (status, result, _), _ = self.propose(question, kind, data)
            self.assertEqual(status, 201)
            proposal = result["assistant_message"]["proposal"]
            self.assertIsNotNone(proposal, result)
            applied = self.req("POST", f"/actions/{proposal['id']}/apply", "admin", {"reviewed": True, "confirm": True})
            self.assertEqual(applied[0], 200, applied)
        with self.factory() as db:
            self.assertEqual(db.query(StrategyNote).one().title, "Turtle setup")
            self.assertEqual(db.query(TeamEquipment).one().name, "Test Shield")
            hero = db.query(Hero).filter_by(name="Newcomer").one()
            self.assertEqual((hero.win_rate, hero.pick_rate, hero.ban_rate), (50, 5, 5))  # documented placeholders
            self.assertEqual(db.get(PlatformPatch, 1).label, "1.2.3")
            self.assertEqual(db.query(AIActionAudit).count(), 4)
        self.assertEqual(fixture.request("GET", "/api/meta")[1]["season_patch"], "1.2.3")
        self.assertEqual(fixture.request("GET", "/api/items", self.tokens["owner"])[1][0]["name"], "Test Shield")

    def test_hero_and_patch_conflicts_do_not_overwrite_newer_work(self):
        _, (_, result, _), _ = self.propose(
            "Update Alice hero tier to S", "update_hero", {"hero": "Alice", "changes": {"tier": "S"}}
        )
        proposal = result["assistant_message"]["proposal"]
        self.assertIsNotNone(proposal)
        with self.factory() as db:
            hero = db.query(Hero).filter_by(name="Alice").one()
            before = hero.tier
            self.assertEqual(proposal["before"]["fields"]["tier"], before)
            hero.tier = "B" if before != "B" else "C"
            db.commit()
        self.assertEqual(
            self.req("POST", f"/actions/{proposal['id']}/apply", "admin", {"reviewed": True, "confirm": True})[0], 409
        )
        with self.factory() as db:
            self.assertNotEqual(db.query(Hero).filter_by(name="Alice").one().tier, "S")
            self.assertEqual(db.query(AIActionAudit).count(), 0)
            self.assertEqual(db.get(AIActionProposal, proposal["id"]).status, "pending")
        _, (_, result, _), _ = self.propose("Update the global patch label to 1.2.4", "set_patch", {"label": "1.2.4"})
        patch_proposal = result["assistant_message"]["proposal"]
        with self.factory() as db:
            db.add(PlatformPatch(id=1, label="1.2.5", revision=1))
            db.commit()
        self.assertEqual(
            self.req("POST", f"/actions/{patch_proposal['id']}/apply", "admin", {"reviewed": True, "confirm": True})[0],
            409,
        )
        with self.factory() as db:
            self.assertEqual(db.get(PlatformPatch, 1).label, "1.2.5")

    def test_expired_proposal_cannot_apply(self):
        _, (_, result, _), _ = self.propose("Create a strategy", "create_strategy", {"title": "Old", "body": "Plan"})
        proposal = result["assistant_message"]["proposal"]
        with self.factory() as db:
            db.get(AIActionProposal, proposal["id"]).expires_at = utcnow() - timedelta(seconds=1)
            db.commit()
        self.assertEqual(
            self.req("POST", f"/actions/{proposal['id']}/apply", "admin", {"reviewed": True, "confirm": True})[0], 409
        )
        with self.factory() as db:
            self.assertEqual(db.query(StrategyNote).count(), 0)
            self.assertEqual(db.query(AIActionAudit).count(), 0)

    def test_admin_demotion_and_discard_revoke_pending_action(self):
        self.set_roles()
        _, (_, result, _), _ = self.propose(
            "Create a strategy", "create_strategy", {"title": "Plan", "body": "Do the thing."}
        )
        proposal = result["assistant_message"]["proposal"]
        path = f"/actions/{proposal['id']}"
        self.assertEqual(self.req("POST", path + "/discard", "second")[0], 404)
        self.assertEqual(self.req("POST", path + "/discard", "admin")[1]["status"], "discarded")
        self.assertEqual(self.req("POST", path + "/apply", "admin", {"reviewed": True, "confirm": True})[0], 409)
        _, (_, result, _), _ = self.propose(
            "Create a strategy", "create_strategy", {"title": "Plan 2", "body": "Do the thing."}
        )
        proposal = result["assistant_message"]["proposal"]
        with self.factory() as db:
            admin = db.query(User).filter_by(email="admin@test.invalid").one()
            admin.role = "coach"
            db.commit()
        self.assertEqual(
            self.req("POST", f"/actions/{proposal['id']}/apply", "admin", {"reviewed": True, "confirm": True})[0], 403
        )
        with self.factory() as db:
            self.assertEqual(db.query(StrategyNote).count(), 0)


class ConcurrentActionTests(unittest.TestCase):
    def test_two_workers_can_apply_one_proposal_only_once(self):
        from app.ai_actions import ActionError, apply, prepare

        with tempfile.TemporaryDirectory(prefix="clover-action-test-") as temp:
            engine = create_engine(
                f"sqlite:///{Path(temp) / 'test.sqlite'}", connect_args={"check_same_thread": False, "timeout": 10}
            )

            @event.listens_for(engine, "connect")
            def enable_fk(conn, _record):
                conn.execute("PRAGMA foreign_keys=ON")

            Base.metadata.create_all(engine)
            factory = sessionmaker(bind=engine, autoflush=False)
            with factory() as db:
                admin = User(email="admin@fixture.invalid", password_hash="unused", name="Admin", role="admin")
                db.add(admin)
                db.flush()
                conversation = AIConversation(owner_id=admin.id)
                db.add(conversation)
                db.flush()
                message = AIMessage(conversation_id=conversation.id, role="assistant", content="Review this", mode="ai")
                db.add(message)
                db.flush()
                proposal = prepare(
                    db,
                    admin,
                    message,
                    {"kind": "create_strategy", "payload": {"title": "One plan", "body": "Take vision."}},
                    ["create_strategy"],
                )
                db.commit()
                user_id, proposal_id = admin.id, proposal.id
            barrier = Barrier(2)

            def worker():
                with factory() as db:
                    user = db.get(User, user_id)
                    barrier.wait(timeout=10)
                    try:
                        apply(db, user, proposal_id)
                        return "applied"
                    except ActionError:
                        return "rejected"

            with ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(lambda _: worker(), range(2)))
            self.assertCountEqual(results, ["applied", "rejected"])
            with factory() as db:
                self.assertEqual(db.query(StrategyNote).count(), 1)
                self.assertEqual(db.query(AIActionAudit).count(), 1)
                self.assertEqual(db.get(AIActionProposal, proposal_id).status, "applied")
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
