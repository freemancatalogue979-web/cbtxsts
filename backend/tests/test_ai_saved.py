"""AI uses only bounded, dated and explicitly authorized saved evidence."""

from __future__ import annotations

import io
import json
import os
import unittest
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from app.aerena_models import AerenaLeague, AerenaMatch
from app.clover_ai_models import AIAccountConsent
from app.intel_cache import IntelAccountGeneration, IntelSnapshot, save_snapshot
from app.models import IntelLink, User, utcnow
from tests import test_clover_ai as fixture


class SavedEvidenceTests(unittest.TestCase):
    setUp = fixture.CloverAITests.setUp
    tearDown = fixture.CloverAITests.tearDown
    req = fixture.CloverAITests.req
    new_chat = fixture.CloverAITests.new_chat

    def account_seed(self):
        with self.factory() as db:
            users = {u.email: u for u in db.query(User).all()}
            for email, marker in (("owner@test.invalid", "Alice"), ("other@test.invalid", "OTHER_PRIVATE_HERO")):
                user = users[email]
                link = db.query(IntelLink).filter_by(user_id=user.id).one()
                generation = IntelAccountGeneration(id=f"generation-{user.id}", owner_id=user.id, link_id=link.id)
                db.add(generation)
                db.commit()
                payload = {
                    "code": 0,
                    "data": {
                        "records": [
                            {
                                "data": {
                                    "hero_name": marker,
                                    "wins": 3,
                                    "kills": 9,
                                    "player_name": "OTHER_PLAYER_PRIVATE",
                                    "opponent": "PRIVATE_OPPONENT",
                                    "jwt": "NO_JWT",
                                    "players": [{"name": "PRIVATE_TEAMMATE"}],
                                }
                            }
                        ]
                    },
                }
                row = save_snapshot(
                    db,
                    "account",
                    "user/matches",
                    "index=1&lang=en&size=10",
                    payload,
                    owner_id=user.id,
                    generation_id=generation.id,
                )
                if email.startswith("owner"):
                    row.observed_at = utcnow() - timedelta(days=2)
                    db.commit()

    def test_private_snapshots_require_separate_consent_and_are_filtered(self):
        self.account_seed()
        chat = self.new_chat()
        calls = []

        def provider(req, timeout):
            calls.append(json.loads(req.data))
            return io.BytesIO(b'{"choices":[{"message":{"content":"A cautious answer."}}]}')

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener", return_value=SimpleNamespace(open=provider)
        ):
            self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "Analyze my recent matches.", "web_mode": "off"},
            )
            context = json.loads(calls[-1]["messages"][-1]["content"])["available_context"]
            self.assertNotIn("opted_in_own_account", context)
            self.req("PATCH", "/settings", payload={"share_profile": True})
            self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "Analyze my recent matches.", "web_mode": "off"},
            )
            context = json.loads(calls[-1]["messages"][-1]["content"])["available_context"]
            self.assertNotIn("opted_in_own_account", context)  # Profile sharing is not statistics consent.
            self.assertEqual(self.req("PATCH", "/settings", payload={"share_account_stats": True})[0], 200)
            response = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "Analyze my recent matches.", "web_mode": "off"},
            )[1]
            sent = calls[-1]
            context = json.loads(sent["messages"][-1]["content"])["available_context"]
            snapshot = context["opted_in_own_account"]["snapshots"][0]
            self.assertTrue(snapshot["stale"])
            self.assertEqual(snapshot["entries"][0]["hero_name"], "Alice")
            self.assertEqual(snapshot["entries"][0]["wins"], 3)
            for secret in (
                "OTHER_PRIVATE_HERO",
                "OTHER_PLAYER_PRIVATE",
                "PRIVATE_OPPONENT",
                "PRIVATE_TEAMMATE",
                "NO_JWT",
                "SECRET_OWN_JWT",
                "SECRET_OWN_REFRESH",
            ):
                self.assertNotIn(secret, json.dumps(sent))
            self.assertTrue(
                any(s["kind"] == "personal" and s.get("observed_at") for s in response["assistant_message"]["sources"])
            )
            self.req("PATCH", "/settings", payload={"share_account_stats": False, "use_history": False})
            self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "Analyze my recent matches.", "web_mode": "off"},
            )
            context = json.loads(calls[-1]["messages"][-1]["content"])["available_context"]
            self.assertNotIn("opted_in_own_account", context)

    def test_saved_hero_and_rone_are_used_without_network_or_team_annotations(self):
        with self.factory() as db:
            save_snapshot(
                db,
                "public",
                "heroes/Alice",
                "size=1&index=1&lang=en",
                {
                    "code": 0,
                    "data": {
                        "records": [
                            {
                                "data": {
                                    "heroskilllist": [
                                        {
                                            "skilllist": [
                                                {
                                                    "skillname": "Blood Song",
                                                    "skilldesc": "<b>Deals damage</b>",
                                                    "secret": "SKILL_SECRET",
                                                }
                                            ]
                                        }
                                    ]
                                }
                            }
                        ]
                    },
                },
            )
            save_snapshot(
                db,
                "public",
                "esports/ph/standings",
                "",
                {"standings": [{"rank": 1, "team": {"name": "ONIC"}, "match_wl": {"win": 3, "lose": 1}}]},
            )
        chat = self.new_chat()
        calls = []

        def provider(req, timeout):
            self.assertNotIn("/esports/", req.full_url)  # This saved feed needs no live Rone request.
            calls.append(json.loads(req.data))
            return io.BytesIO(b'{"choices":[{"message":{"content":"A sourced answer."}}]}')

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener", return_value=SimpleNamespace(open=provider)
        ):
            answer = self.req("POST", f"/conversations/{chat}/messages", payload={"text": "Explain Alice skills."})[1]
            context = json.loads(calls[-1]["messages"][-1]["content"])["available_context"]
            self.assertEqual(
                context["hero_library"][0]["saved_rone_skills"]["skills"][0]["description"], "Deals damage"
            )
            self.assertNotIn("SKILL_SECRET", json.dumps(context))
            self.assertNotIn("NEVER_SEND_HERO_NOTES", json.dumps(context))
            self.assertTrue(
                any("saved Rone skills" in source["label"] for source in answer["assistant_message"]["sources"])
            )
            answer = self.req("POST", f"/conversations/{chat}/messages", payload={"text": "MPL PH standings"})[1]
            context = json.loads(calls[-1]["messages"][-1]["content"])["available_context"]
            self.assertEqual(context["rone_public_mpl"]["status"], "saved")
            self.assertEqual(context["rone_public_mpl"]["standings"][0]["team"], "ONIC")
            self.assertIsNone(context["rone_public_mpl"]["season"])
            self.assertTrue(
                any(
                    s["kind"] == "esports_feed" and s.get("observed_at") for s in answer["assistant_message"]["sources"]
                )
            )

    def test_aerena_schedule_link_recognizes_the_connected_source_without_making_it_a_search_term(self):
        from app.ai_context import aerena_link, automatic_match_ids

        with self.factory() as db:
            db.add(AerenaLeague(id="season", series_id="series", code="MPL PH", name="MPL Philippines", region="PH"))
            db.add(
                AerenaMatch(
                    id="PH-MATCH",
                    source_id="id",
                    league_id="season",
                    starts_at=utcnow(),
                    team1_name="ONIC",
                    team2_name="Rival",
                    team1_json='{"teamName":"ONIC"}',
                    team2_json='{"teamName":"Rival"}',
                )
            )
            db.commit()
            question = "https://aerena.gg/mobile-legends/schedule i would train you get mpl data from here bro so you understand the pro scene"
            self.assertEqual(aerena_link(question), ("schedule", None))
            self.assertEqual(automatic_match_ids(db, question), ["PH-MATCH"])
            self.assertEqual(
                automatic_match_ids(
                    db, "Could you check https://aerena.gg/mobile-legends/schedule and find some MPL data bro"
                ),
                ["PH-MATCH"],
            )
            self.assertEqual(
                automatic_match_ids(db, "Analyze https://aerena.gg/mobile-legends/match/PH-MATCH"), ["PH-MATCH"]
            )
            self.assertEqual(automatic_match_ids(db, "Analyze https://aerena.gg/mobile-legends/match/UNKNOWN"), [])
            self.assertIsNone(aerena_link("https://aerena.gg.evil.invalid/mobile-legends/schedule"))
        chat = self.new_chat()
        calls = []

        def provider(req, timeout):
            calls.append(json.loads(req.data))
            return io.BytesIO(b'{"choices":[{"message":{"content":"Bro, I can use the saved Aerena matches."}}]}')

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener", return_value=SimpleNamespace(open=provider)
        ):
            result = self.req("POST", f"/conversations/{chat}/messages", payload={"text": question, "web_mode": "off"})[
                1
            ]
            self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={
                    "text": "What about https://aerena.gg/mobile-legends/match/OTHER?",
                    "web_mode": "off",
                    "match_ids": ["PH-MATCH"],
                },
            )
        context = json.loads(calls[0]["messages"][-1]["content"])["available_context"]
        self.assertTrue(context["aerena_link_request"]["selected_records_available"])
        self.assertEqual(context["selected_aerena_matches"]["matches"][0]["match_id"], "PH-MATCH")
        self.assertTrue(any(source["kind"] == "match" for source in result["assistant_message"]["sources"]))
        attached_facts = json.loads(calls[1]["messages"][-1]["content"])["available_context"]
        self.assertFalse(attached_facts["aerena_link_request"]["selected_records_available"])
        self.assertEqual(attached_facts["selected_aerena_matches"]["matches"][0]["match_id"], "PH-MATCH")

    def test_ai_refreshes_public_only_and_uses_consented_saved_account_without_player_calls(self):
        self.account_seed()
        with self.factory() as db:
            row = save_snapshot(
                db, "public", "esports/ph/standings", "", {"standings": [{"rank": 1, "team": {"name": "ONIC"}}]}
            )
            row.observed_at = utcnow() - timedelta(days=2)
            db.commit()
        chat = self.new_chat()
        with patch("app.routers.intel._refresh_public_snapshot") as refresh:
            response = self.req(
                "POST", f"/conversations/{chat}/messages", payload={"text": "MPL PH standings", "web_mode": "off"}
            )
            self.assertEqual(response[0], 201)
            self.assertIn("ONIC", response[1]["assistant_message"]["content"])
            self.assertEqual(refresh.call_count, 1)
            args = refresh.call_args.args
            self.assertEqual(args[2], "esports/ph/standings")
            self.assertNotIn("MPL PH standings", repr(args))
        with self.factory() as db:
            row = save_snapshot(
                db,
                "public",
                "heroes/Alice",
                "lang=en",
                {
                    "code": 0,
                    "data": {"heroskilllist": [{"skilllist": [{"skillname": "Skill one", "skilldesc": "Damage"}]}]},
                },
            )
            row.observed_at = utcnow() - timedelta(days=2)
            db.commit()
        with patch("app.routers.intel._refresh_public_snapshot") as refresh:
            self.req(
                "POST", f"/conversations/{chat}/messages", payload={"text": "Explain Alice skills", "web_mode": "off"}
            )
            self.assertEqual(refresh.call_count, 1)
            self.assertEqual(refresh.call_args.args[2], "heroes/Alice")
        self.req("PATCH", "/settings", payload={"share_account_stats": True})
        with patch("app.routers.intel._refresh_account_snapshot") as refresh:
            response = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "Analyze my recent matches", "web_mode": "off"},
            )
            self.assertEqual(refresh.call_count, 0)
            self.assertTrue(any(source["kind"] == "personal" for source in response[1]["assistant_message"]["sources"]))
            for secret in ("SECRET_OWN_JWT", "SECRET_OWN_REFRESH"):
                self.assertNotIn(secret, json.dumps(response[1]))
        with patch("app.routers.intel._refresh_account_snapshot") as refresh:
            self.req("PATCH", "/settings", payload={"share_account_stats": False})
            self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "Analyze my recent matches", "web_mode": "off"},
            )
            self.assertEqual(refresh.call_count, 0)

    def test_optional_refresh_database_failure_does_not_block_chat(self):
        from sqlalchemy.exc import SQLAlchemyError

        chat = self.new_chat()
        with patch("app.ai_saved.queue_relevant_refreshes", side_effect=SQLAlchemyError("synthetic refresh failure")):
            result = self.req(
                "POST", f"/conversations/{chat}/messages", payload={"text": "Explain Alice", "web_mode": "off"}
            )
        self.assertEqual(result[0], 201)
        self.assertIn("saved details", result[1]["assistant_message"]["content"])

    def test_team_equipment_and_manual_patch_are_relevant_unverified_evidence(self):
        from app.platform_data import TeamEquipment, PlatformPatch

        with self.factory() as db:
            db.add(
                TeamEquipment(
                    name="Clover Shield", category="Defense", description="Team note on shield timing", patch="2.0"
                )
            )
            db.add(PlatformPatch(id=1, label="2.0", revision=1))
            db.commit()
        chat = self.new_chat()
        calls = []

        def provider(req, timeout):
            calls.append(json.loads(req.data))
            return io.BytesIO(b'{"choices":[{"message":{"content":"Here is the team entry."}}]}')

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener", return_value=SimpleNamespace(open=provider)
        ):
            result = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "What does Clover Shield do on this patch?", "web_mode": "off"},
            )[1]
        context = json.loads(calls[-1]["messages"][-1]["content"])["available_context"]
        self.assertEqual(context["team_equipment"]["entries"][0]["name"], "Clover Shield")
        self.assertIn("not an official", context["team_equipment"]["notice"])
        self.assertEqual(context["platform_patch_label"]["label"], "2.0")
        self.assertEqual(context["platform_patch_label"]["source"], "admin-reviewed label")
        self.assertTrue(any(s["kind"] == "team_item" for s in result["assistant_message"]["sources"]))

    def test_generic_esports_question_finds_saved_matches_and_facts_fallback(self):
        from app.ai_context import automatic_match_ids

        with self.factory() as db:
            db.add(AerenaLeague(id="season", series_id="series", code="MPL PH", name="MPL Philippines", region="PH"))
            db.add(
                AerenaMatch(
                    id="PH-MATCH",
                    source_id="id",
                    league_id="season",
                    starts_at=utcnow(),
                    team1_name="ONIC",
                    team2_name="Rival",
                    team1_json='{"teamName":"ONIC"}',
                    team2_json='{"teamName":"Rival"}',
                )
            )
            db.commit()
            self.assertEqual(automatic_match_ids(db, "Can you access esports data?"), ["PH-MATCH"])
        chat = self.new_chat()
        _, answer, _ = self.req(
            "POST", f"/conversations/{chat}/messages", payload={"text": "Can you access esports data?"}
        )
        self.assertIn("1 saved Aerena match", answer["assistant_message"]["content"])
        self.assertIn("PH-MATCH", answer["assistant_message"]["content"])
        self.assertTrue(any(s["kind"] == "match" for s in answer["assistant_message"]["sources"]))


if __name__ == "__main__":
    unittest.main()
