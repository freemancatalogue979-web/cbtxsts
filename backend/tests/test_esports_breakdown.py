"""Draft breakdowns: win conditions, execution, verdicts and validated hero swaps.

Synthetic series modelled on an MPL PH playoff game. Numbers shown to members
come from the saved match data; the model only supplies coaching text and swap
suggestions, which are checked against the real draft and hero catalogue.
"""
from __future__ import annotations

import io
import json
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

os.environ["CLOVER_AERENA_ENABLED"] = "0"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db import Base  # noqa: E402
from app.esports_ai import BREAKDOWN_SYSTEM, ask, ask_scene, hero_catalog  # noqa: E402

BLUE = (["Joy", "Fanny"], ["Fredrinn", "Lancelot", "Kimmy", "Valentina", "Chou"],
        ["KOYL", "SANJI", "DOMENG", "MAGIC", "BRUSKO"])
RED = (["Nolan", "Beatrix"], ["Tigreal", "Ling", "Cici", "Claude", "Harith"],
       ["HADJI", "KIRK", "MARCO", "SUPER", "OWGWEN"])


def game(number=1):
    draft, order = [], 0
    for side, (bans, picks, players) in (("Blue", BLUE), ("Red", RED)):
        for hero in bans:
            order += 1
            draft.append({"kind": "Ban", "source_order": order, "sequence": order, "side": side, "hero_name": hero})
        for hero, player in zip(picks, players):
            order += 1
            draft.append({"kind": "Pick", "source_order": order, "sequence": order, "side": side, "hero_name": hero,
                          "player_ign": player, "position": None})
    stats = [{"team_id": "rora", "ign": "DOMENG", "hero_name": "Kimmy", "kills": 6, "deaths": 0, "assists": 5, "isMVP": True},
             {"team_id": "rora", "ign": "BRUSKO", "hero_name": "Chou", "kills": 1, "deaths": 4, "assists": 3, "isMVP": False},
             {"team_id": "flcn", "ign": "MARCO", "hero_name": "Cici", "kills": 4, "deaths": 2, "assists": 2, "isMVP": False}]
    return {"number": number, "duration_seconds": 864, "draft_coverage": "complete", "draft": draft, "player_stats": stats,
            "team1": {"team": "rora", "teamCode": "RORA", "teamName": "Aurora Gaming PH", "side": "Blue",
                      "teamKills": 14, "teamGold": 61000, "teamTurtles": 3, "teamLords": 2},
            "team2": {"team": "flcn", "teamCode": "FLCN PH", "teamName": "Team Falcons PH", "side": "Red",
                      "teamKills": 7, "teamGold": 52000, "teamTurtles": 0, "teamLords": 0},
            "winner": {"team": "rora"}}


def detail(match_id="PH18-S18POD5M8"):
    return {"match": {"id": match_id, "status": "completed", "format": "BO7", "stage": "Playoffs",
                      "league_name": "MPL Philippines Season 18", "source_url": f"https://aerena.gg/mobile-legends/match/{match_id}",
                      "fetched_at": "2026-11-17T14:26:00Z", "source_verified": False,
                      "team1": {"team": "rora", "teamCode": "RORA", "teamName": "Aurora Gaming PH", "teamScore": 1,
                                "logo": "https://cdn.example/rora.png"},
                      "team2": {"team": "flcn", "teamCode": "FLCN PH", "teamName": "Team Falcons PH", "teamScore": 0,
                                "logo": "javascript:alert(1)"},
                      "winner": {"team": "rora"}},
            "games": [game(1)], "detail_error": None}


def model_reply(match_id="PH18-S18POD5M8"):
    return {
        "headline": "**RORA** snowballed off turtle",
        "answer": "RORA won by \\*\\*tempo\\*\\*.",
        "matches": [{"match_id": match_id, "series_story": "## RORA took control early.", "games": [
            {"number": 1, "deciding_factor": "Lancelot pick-offs at second turtle.", "teams": [
                {"team": "team1", "win_condition": "**Early** snowball: Fredrinn and Lancelot dive around turtle.",
                 "execution": ["- Invade at 0:45", "Take first turtle", "Siege mid with Kimmy poke", ""],
                 "verdict": "executed", "verdict_note": "14–7 kills and both Lords.",
                 "swaps": [{"out": "Chou", "in": "minsitthar", "why": "Chou died 4 times.", "how": "Lock the enemy jungler in the ult zone."},
                           {"out": "Ling", "in": "Khufra", "why": "Not our hero.", "how": "Invalid."}]},
                {"team": "team2", "win_condition": "Late front-to-back fight behind Tigreal.", "execution": ["Stall to Harith spike"],
                 "verdict": "great", "verdict_note": "No objectives.",
                 "swaps": [{"out": "Claude", "in": "Joy", "why": "Banned hero.", "how": "Invalid."},
                           {"out": "Cici", "in": "Not A Hero", "why": "Unknown.", "how": "Invalid."},
                           {"out": "Harith", "in": "Lancelot", "why": "Enemy pick.", "how": "Invalid."},
                           {"out": "**Tigreal**", "in": "KHUFRA", "why": "Better anti-dive.", "how": "Bounce Lancelot."}]}]},
            {"number": 9, "deciding_factor": "A game that does not exist.", "teams": []}]}],
        "takeaways": ["**Punish** turtle setups.", ""],
    }


def provider(reply, sent):
    def open_request(request, timeout):
        sent.append(json.loads(request.data))
        content = reply if isinstance(reply, str) else json.dumps(reply)
        return io.BytesIO(json.dumps({"choices": [{"message": {"content": content}}]}).encode())
    return SimpleNamespace(open=open_request)


class BreakdownTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine, autoflush=False)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def run_ask(self, reply, sent):
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-key"}), \
                patch("app.esports_ai.urllib.request.build_opener", return_value=provider(reply, sent)):
            return ask(self.db, 1, "What was each draft's win condition?", detail())

    def test_breakdown_has_win_conditions_execution_verdicts_and_valid_swaps(self):
        sent = []
        result = self.run_ask(model_reply(), sent)
        self.assertEqual(result["mode"], "ai")
        breakdown = result["breakdown"]
        self.assertEqual(breakdown["headline"], "RORA snowballed off turtle")
        self.assertEqual(breakdown["answer"], "RORA won by tempo.")
        self.assertEqual(breakdown["takeaways"], ["Punish turtle setups."])
        match = breakdown["matches"][0]
        self.assertEqual(match["series_story"], "RORA took control early.")
        self.assertEqual([team["code"] for team in match["teams"]], ["RORA", "FLCN PH"])
        self.assertEqual(match["teams"][0]["logo"], "https://cdn.example/rora.png")
        self.assertIsNone(match["teams"][1]["logo"], "only https logos reach the page")
        self.assertEqual([g["number"] for g in match["games"]], [1], "a game the data does not have is dropped")
        one = match["games"][0]
        self.assertEqual(one["winner"], "team1")
        self.assertEqual(one["deciding_factor"], "Lancelot pick-offs at second turtle.")
        rora, flcn = one["teams"]
        # Chips come from the saved data, never from the model.
        self.assertEqual((rora["kills"], flcn["kills"], rora["turtles"], rora["lords"]), (14, 7, 3, 2))
        self.assertEqual([p["hero"] for p in rora["picks"]], BLUE[1])
        self.assertEqual([p["player"] for p in rora["picks"]], BLUE[2])
        self.assertEqual(rora["bans"], BLUE[0])
        self.assertEqual(rora["standout"], {"player": "DOMENG", "hero": "Kimmy", "mvp": True, "kills": 6, "deaths": 0, "assists": 5})
        plan = rora["plan"]
        self.assertEqual(plan["win_condition"], "Early snowball: Fredrinn and Lancelot dive around turtle.")
        self.assertEqual(plan["execution"], ["Invade at 0:45", "Take first turtle", "Siege mid with Kimmy poke"])
        self.assertEqual(plan["verdict"], "executed")
        # Only a hero the team drafted goes out; the replacement is canonical.
        self.assertEqual(plan["swaps"], [{"out": "Chou", "in": "Minsitthar", "player": "BRUSKO", "position": None,
                                          "why": "Chou died 4 times.", "how": "Lock the enemy jungler in the ult zone."}])
        self.assertIsNone(flcn["plan"]["verdict"], "unknown verdicts are not shown")
        # Banned, unknown and enemy-picked replacements are rejected.
        self.assertEqual([(s["out"], s["in"]) for s in flcn["plan"]["swaps"]], [("Tigreal", "Khufra")])
        self.assertEqual(flcn["plan"]["swaps"][0]["player"], "HADJI")
        self.assertNotIn("**", json.dumps(result))
        self.assertIn("Swap Chou → Minsitthar", result["answer"])

    def test_prompt_treats_sources_as_verified_and_requests_json(self):
        sent = []
        self.run_ask(model_reply(), sent)
        body = sent[0]
        self.assertEqual(body["response_format"], {"type": "json_object"})
        system = body["messages"][0]["content"]
        self.assertEqual(system, BREAKDOWN_SYSTEM)
        self.assertIn("verified", system)
        for phrase in ("win_condition", "execution", "swaps", "NOT picked or banned", "never make up statistics"):
            self.assertIn(phrase, system)
        content = body["messages"][1]["content"]
        for gone in ("community-compiled", "not independently verified", "source_verified"):
            self.assertNotIn(gone, content)
        self.assertNotIn("cautious hypotheses", system.lower())
        reference = json.loads(content.split("Hero reference (JSON):\n", 1)[1].split("\n\nMember question:", 1)[0])
        self.assertEqual(reference["drafted_heroes"]["Chou"]["lanes"], ["Exp", "Roam"])
        self.assertIn("Khufra (Roam)", reference["replacement_pool"])
        self.assertNotIn("test-key", json.dumps(body))

    def test_plain_text_reply_keeps_fact_chips_and_cleans_markdown(self):
        result = self.run_ask("**Series result:** RORA won.\n\n- \\*\\*Lords\\*\\* decided it", [])
        self.assertEqual(result["mode"], "ai")
        self.assertEqual(result["answer"], "Series result: RORA won.\nLords decided it")
        game_one = result["breakdown"]["matches"][0]["games"][0]
        self.assertEqual(game_one["teams"][0]["kills"], 14)
        self.assertNotIn("plan", game_one["teams"][0])

    def test_facts_mode_still_returns_chips_without_a_provider(self):
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": ""}):
            result = ask(self.db, 1, "Why?", detail())
        self.assertEqual(result["mode"], "facts")
        self.assertIn("not an AI answer", result["note"])
        teams = result["breakdown"]["matches"][0]["games"][0]["teams"]
        self.assertEqual([t["standout"]["player"] for t in teams], ["DOMENG", "MARCO"])

    def test_scene_breakdown_maps_each_match_and_ignores_unknown_ids(self):
        reply = model_reply("M-ONE")
        reply["matches"].append({"match_id": "NOT-SELECTED", "series_story": "Ignore", "games": []})
        sent = []
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-key"}), \
                patch("app.esports_ai.urllib.request.build_opener", return_value=provider(reply, sent)):
            result = ask_scene(self.db, 1, "Compare drafts", [detail("M-ONE"), detail("M-TWO")])
        self.assertEqual(result["mode"], "ai")
        self.assertEqual([m["match_id"] for m in result["breakdown"]["matches"]], ["M-ONE", "M-TWO"])
        first, second = result["breakdown"]["matches"]
        self.assertEqual(first["games"][0]["teams"][0]["plan"]["swaps"][0]["in"], "Minsitthar")
        self.assertNotIn("series_story", second)
        self.assertEqual(sent[0]["max_tokens"], 8000)

    def test_catalog_includes_saved_heroes_beyond_the_bundled_profiles(self):
        from app.models import Hero
        self.db.add(Hero(name="Zetian", role="MID"))
        self.db.commit()
        catalog = hero_catalog(self.db)
        self.assertEqual(catalog["zetian"], "Zetian")
        self.assertEqual(catalog["khufra"], "Khufra")


if __name__ == "__main__":
    unittest.main()
