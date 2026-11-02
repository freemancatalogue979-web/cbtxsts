"""Local-first MLBB knowledge and season trends; all records are synthetic."""

from __future__ import annotations

import io
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.aerena_models import AerenaDraftEvent, AerenaGame, AerenaHero, AerenaLeague, AerenaMatch
from app.ai_esports_meta import season_meta
from app.models import Hero, utcnow
from tests import test_clover_ai as fixture


class GameKnowledgeTests(unittest.TestCase):
    setUp = fixture.CloverAITests.setUp
    tearDown = fixture.CloverAITests.tearDown
    req = fixture.CloverAITests.req
    new_chat = fixture.CloverAITests.new_chat

    def seed_seasons(self):
        with self.factory() as db:
            db.add_all(
                [
                    AerenaLeague(
                        id="ph18", series_id="ph", code="MPL PH S18", name="MPL Philippines Season 18", region="PH"
                    ),
                    AerenaLeague(
                        id="ph17", series_id="ph", code="MPL PH S17", name="MPL Philippines Season 17", region="PH"
                    ),
                    AerenaLeague(
                        id="id18", series_id="id", code="MPL ID S18", name="MPL Indonesia Season 18", region="ID"
                    ),
                ]
            )
            for index in range(19):
                name = "Alice" if index == 0 else "Ling" if index == 10 else f"Hero {index}"
                db.add(AerenaHero(id=f"h{index}", name=name))
            for match_id, league, stage in (
                ("PH18-final", "ph18", "Grand Final"),
                ("PH18-regular", "ph18", "Regular Season"),
                ("PH18-nodraft", "ph18", "Regular Season"),
                ("PH17-old", "ph17", "Regular Season"),
                ("ID18-other", "id18", "Regular Season"),
            ):
                db.add(AerenaMatch(id=match_id, source_id=match_id, league_id=league, stage=stage, starts_at=utcnow()))
            for game_id, match_id, coverage in (
                ("g1", "PH18-final", "complete"),
                ("g2", "PH18-final", "partial"),  # Full slots but unknown interleaved order.
                ("g3", "PH18-regular", "partial"),
                ("g4", "PH18-nodraft", "none"),
                ("g5", "PH17-old", "complete"),
                ("g6", "ID18-other", "complete"),
            ):
                db.add(
                    AerenaGame(
                        id=game_id, match_id=match_id, number=2 if game_id == "g2" else 1, draft_coverage=coverage
                    )
                )
            db.flush()
            for game_id, match_id, reverse in (
                ("g1", "PH18-final", False),
                ("g2", "PH18-final", True),
                ("g5", "PH17-old", False),
                ("g6", "ID18-other", False),
            ):
                for index in range(20):
                    kind = "Pick" if (index < 10) != reverse else "Ban"
                    order = index % 10 + 1
                    db.add(
                        AerenaDraftEvent(
                            game_id=game_id, match_id=match_id, kind=kind, source_order=order, hero_id=f"h{index}"
                        )
                    )
            db.add(AerenaDraftEvent(game_id="g3", match_id="PH18-regular", kind="Pick", source_order=1, hero_id="h0"))
            db.commit()

    def test_mpl_season_aggregate_uses_complete_drafts_and_separate_scope(self):
        self.seed_seasons()
        with self.factory() as db:
            result, sources = season_meta(db, "MPL PH S18 meta")
            self.assertEqual(result["status"], "ok")
            self.assertEqual((result["region"], result["season"]), ("PH", 18))
            self.assertEqual(result["matches_saved"], 3)
            self.assertEqual(result["games_scanned"], 4)
            self.assertEqual(result["complete_draft_games"], 2)
            self.assertEqual(result["partial_draft_games"], 1)
            self.assertEqual(result["games_without_usable_draft"], 1)
            self.assertEqual(result["complete_games_with_unknown_heroes"], 2)
            alice = next(item for item in result["top_heroes"] if item["hero"] == "Alice")
            self.assertEqual((alice["picks"], alice["bans"], alice["presence_percent"]), (1, 1, 100.0))
            self.assertEqual((alice["pick_rate_percent"], alice["ban_rate_percent"]), (50.0, 50.0))
            self.assertEqual(sources[0]["route"], "esports")
            finals, _ = season_meta(db, "MPL Philippines Season 18 grand final pick ban meta")
            self.assertEqual((finals["matches_saved"], finals["complete_draft_games"]), (1, 2))
            previous, _ = season_meta(db, "MPL PH Season 17 meta")
            self.assertEqual((previous["matches_saved"], previous["complete_draft_games"]), (1, 1))
            other_region, _ = season_meta(db, "MPL ID S18 meta")
            self.assertEqual((other_region["region"], other_region["matches_saved"]), ("ID", 1))
            self.assertEqual(season_meta(db, "MPL PH meta")[0], None)  # No guessed season.
            missing, _ = season_meta(db, "MPL PH S19 meta")
            self.assertEqual(missing["status"], "season_not_found")

    def test_duplicate_hero_names_in_one_draft_do_not_produce_invalid_rates(self):
        self.seed_seasons()
        with self.factory() as db:
            db.add(AerenaHero(id="h19", name="ALICE"))  # Same hero under a second upstream ID.
            db.commit()
            result, _ = season_meta(db, "MPL PH S18 meta")
            self.assertEqual(result["complete_draft_games"], 0)
            self.assertEqual(result["partial_draft_games"], 3)
            self.assertEqual(result["top_heroes"], [])

    def test_truncated_aggregate_reports_a_sample_not_the_whole_season(self):
        self.seed_seasons()
        with self.factory() as db, patch("app.ai_esports_meta.MAX_MATCHES", 1):
            result, _ = season_meta(db, "MPL PH S18 meta")
            self.assertEqual(result["matches_saved"], 3)
            self.assertEqual(result["matches_scanned"], 1)
            self.assertTrue(result["sample_truncated"])

    def test_provider_gets_all_saved_season_trends_without_default_web_search(self):
        self.seed_seasons()
        chat = self.new_chat()
        calls = []

        def upstream(req, timeout):
            self.assertFalse(req.full_url.endswith("/tools/search"))
            calls.append(json.loads(req.data))
            return io.BytesIO(b'{"choices":[{"message":{"content":"Here is a practical meta read."}}]}')

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener", return_value=SimpleNamespace(open=upstream)
        ):
            result = self.req(
                "POST", f"/conversations/{chat}/messages", payload={"text": "MPL PH S18 meta", "web_mode": "auto"}
            )[1]
        context = json.loads(calls[-1]["messages"][-1]["content"])["available_context"]
        self.assertEqual(context["saved_season_draft_trends"]["complete_draft_games"], 2)
        self.assertEqual(context["saved_season_draft_trends"]["matches_saved"], 3)
        self.assertIn("existing MLBB knowledge", calls[-1]["messages"][0]["content"])
        self.assertIn("optional supporting checks", calls[-1]["messages"][0]["content"])
        self.assertNotIn("limitations", context)
        self.assertTrue(
            any("saved draft trends" in source["label"] for source in result["assistant_message"]["sources"])
        )
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener", return_value=SimpleNamespace(open=upstream)
        ):
            self.req(
                "POST", f"/conversations/{chat}/messages", payload={"text": "Who was most banned?", "web_mode": "off"}
            )
            followup = json.loads(calls[-1]["messages"][-1]["content"])["available_context"]
            self.assertEqual(followup["saved_season_draft_trends"]["complete_draft_games"], 2)
            self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "MPL PH S18 meta", "web_mode": "off", "match_ids": ["PH18-final"]},
            )
            attached = json.loads(calls[-1]["messages"][-1]["content"])["available_context"]
            self.assertNotIn("saved_season_draft_trends", attached)
            self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "MPL PH S18 meta", "web_mode": "off", "auto_esports": False},
            )
            disabled = json.loads(calls[-1]["messages"][-1]["content"])["available_context"]
            self.assertNotIn("saved_season_draft_trends", disabled)

    def test_season_games_question_keeps_season_trends_instead_of_a_small_series_sample(self):
        self.seed_seasons()
        chat = self.new_chat()
        calls = []

        def upstream(req, timeout):
            calls.append(json.loads(req.data))
            return io.BytesIO(b'{"choices":[{"message":{"content":"Season trends."}}]}')

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener", return_value=SimpleNamespace(open=upstream)
        ):
            previous = self.req(
                "POST", f"/conversations/{chat}/messages",
                payload={"text": "Analyze this match", "match_ids": ["PH18-final"], "web_mode": "off"},
            )
            self.assertEqual(previous[0], 201)
            status, result, _ = self.req(
                "POST", f"/conversations/{chat}/messages",
                payload={"text": "MPL PH S18 games: which heroes were most picked?", "web_mode": "off"},
            )
        self.assertEqual(status, 201)
        context = json.loads(calls[-1]["messages"][-1]["content"])["available_context"]
        self.assertEqual(context["saved_season_draft_trends"]["matches_saved"], 3)
        self.assertEqual(context["saved_season_draft_trends"]["complete_draft_games"], 2)
        self.assertNotIn("match_pick_analysis", context)
        self.assertFalse(any(source.get("esports_selection") for source in result["user_message"]["sources"]))

    def test_season_trends_remain_useful_when_the_provider_is_unavailable(self):
        self.seed_seasons()
        chat = self.new_chat()
        result = self.req(
            "POST", f"/conversations/{chat}/messages", payload={"text": "MPL PH S18 meta", "web_mode": "off"}
        )[1]
        self.assertEqual(result["assistant_message"]["mode"], "facts")
        self.assertIn("2 complete saved drafts across 3 saved matches", result["assistant_message"]["content"])
        self.assertIn("Alice: 1 pick, 1 ban", result["assistant_message"]["content"])
        self.assertIn("small sample", result["assistant_message"]["content"])

    def test_bundled_hero_knowledge_works_without_seeding_and_respects_new_subject(self):
        chat = self.new_chat()
        calls = []

        def upstream(req, timeout):
            calls.append(json.loads(req.data))
            return io.BytesIO(b'{"choices":[{"message":{"content":"Game guidance."}}]}')

        with self.factory() as db:
            self.assertIsNone(db.query(Hero).filter_by(name="Suyou").first())
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener", return_value=SimpleNamespace(open=upstream)
        ):
            first = self.req(
                "POST", f"/conversations/{chat}/messages", payload={"text": "How does Suyou play?", "web_mode": "auto"}
            )[1]
            first_facts = json.loads(calls[-1]["messages"][-1]["content"])["available_context"]
            self.assertEqual(first_facts["hero_library"][0]["name"], "Suyou")
            self.assertIn("Jungle", first_facts["hero_library"][0]["lanes"])
            self.assertTrue(first_facts["hero_library"][0]["skill_names"])
            self.assertTrue(any(source.get("route") == "intel" for source in first["assistant_message"]["sources"]))
            self.req("POST", f"/conversations/{chat}/messages", payload={"text": "Explain Alice", "web_mode": "auto"})
            next_facts = json.loads(calls[-1]["messages"][-1]["content"])["available_context"]
            self.assertEqual([hero["name"] for hero in next_facts["hero_library"]], ["Alice"])
            self.req(
                "POST", f"/conversations/{chat}/messages", payload={"text": "Recommend a jungler", "web_mode": "auto"}
            )
            roster = json.loads(calls[-1]["messages"][-1]["content"])["available_context"]["hero_roster_reference"]
            self.assertTrue(any(item["name"] == "Suyou" for item in roster["entries"]))
            self.assertTrue(all("Jungle" in item["lanes"] for item in roster["entries"]))
        with self.factory() as db:
            self.assertIsNone(db.query(Hero).filter_by(name="Suyou").first())


if __name__ == "__main__":
    unittest.main()
