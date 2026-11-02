"""Whole-series regression tests with isolated public fixtures and fake providers.

No real source, player-account endpoint or AI provider is contacted.
"""

from __future__ import annotations

import copy
import io
import json
import os
import unittest
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import ai_esports_analysis as analysis
from app.aerena_client import AerenaError
from app.aerena_models import AerenaGame, AerenaMatch, AerenaPlayerGameStat
from app.aerena_service import (
    save_heroes,
    save_league,
    save_match,
    save_match_detail,
    save_series,
)
from app.db import Base
from app.esports_ai import (
    MAX_CONTEXT_CHARS,
    ask,
    evidence,
    factual_fallback,
    scene_evidence,
)
from app.models import utcnow
from app.routers.esports import detail_for
import test_aerena as aerena_fixture
import test_ai_esports_analysis as rone_fixture
import test_clover_ai as chat_fixture
import test_esports_http as esports_http

LAST_HERO_ID = "last-game-hero"
LAST_HERO = "Lastclutch"
LAST_PLAYER = "LastGamePlayer"


def series_match(
    count: int,
    match_id: str = aerena_fixture.MATCH_ID,
    source_id: str = aerena_fixture.MATCH_SOURCE_ID,
) -> dict:
    data = copy.deepcopy(aerena_fixture.match())
    data["matchId"], data["_id"] = match_id, source_id
    data["team1"]["teamScore"] = count // 2
    data["team2"]["teamScore"] = count - count // 2
    data["team1"]["raw_secret"] = "SECRET_FROM_PUBLIC_SOURCE"
    template = data["games"][0]
    games = []
    for number in range(1, count + 1):
        item = copy.deepcopy(template)
        item["_id"] = f"{match_id}-game-{number}"
        item["gameNumber"] = number
        item["gameLength"] = 600 + number
        item["gameWinner"] = {"team": item["team2"]["team"]}
        if number == count:
            item["draft"][-1]["hero"] = LAST_HERO_ID
            item["draft"][-1]["playerIGN"] = LAST_PLAYER
        games.append(item)
    data["games"] = games
    return data


def hero_catalog(data: dict) -> list[dict]:
    ids = list(
        dict.fromkeys(
            event["hero"] for game in data["games"] for event in game["draft"]
        )
    )
    return [
        {"_id": hid, "heroName": LAST_HERO if hid == LAST_HERO_ID else f"Hero{number}"}
        for number, hid in enumerate(ids)
    ]


def player_stats(data: dict) -> list[dict]:
    return [
        {
            "_id": f"{data['matchId']}-stat-last",
            "match": data["_id"],
            "gameNumber": len(data["games"]),
            "ign": LAST_PLAYER,
            "hero": LAST_HERO_ID,
            "team": data["team2"]["team"],
            "kills": 9,
            "deaths": 1,
            "assists": 11,
            "gold": 15000,
            "dmgDealt": 53000,
            "secret": "SECRET_PLAYER_RAW",
        }
    ]


def install(
    db: Session, count: int, *, initial_games: int | None = None, fetched: bool = False
) -> dict:
    full = series_match(count)
    save_series(db, [aerena_fixture.series()])
    league = save_league(db, aerena_fixture.league())
    save_heroes(db, hero_catalog(full))
    initial = copy.deepcopy(full)
    if initial_games is not None:
        initial["games"] = initial["games"][:initial_games]
    row = save_match(db, initial, league)
    db.flush()
    if fetched:
        row.detail_fetched_at = utcnow() - timedelta(seconds=1)
        row.detail_attempted_at = utcnow() - timedelta(minutes=6)
    db.commit()
    return full


def provider(captured: list, *, think: bool = False):
    def opened(req, timeout):
        captured.append(json.loads(req.data))
        if think:
            events = [
                {
                    "choices": [
                        {
                            "delta": {"reasoning_content": "private reasoning"},
                            "finish_reason": None,
                        }
                    ]
                },
                {
                    "choices": [
                        {
                            "delta": {"content": "I reviewed the series."},
                            "finish_reason": "stop",
                        }
                    ]
                },
            ]
            raw = (
                "".join("data: " + json.dumps(event) + "\n\n" for event in events)
                + "data: [DONE]\n\n"
            )
            return io.BytesIO(raw.encode())
        return io.BytesIO(
            b'{"choices":[{"message":{"content":"I reviewed the series."}}]}'
        )

    return SimpleNamespace(open=opened)


def context(captured: list, index: int = -1) -> dict:
    return json.loads(captured[index]["messages"][-1]["content"])["available_context"]


class WholeSeriesEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine, autoflush=False)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_single_series_includes_all_games_and_late_only_facts(self):
        for count in (2, 3, 7, 9):
            with self.subTest(games=count):
                full = install(self.db, count)
                league = self.db.get(
                    type(save_league(self.db, aerena_fixture.league())),
                    aerena_fixture.LEAGUE_ID,
                )
                save_match_detail(
                    self.db,
                    {"match": full, "playerGameStats": player_stats(full)},
                    league,
                )
                self.db.commit()
                detail = detail_for(
                    self.db, self.db.get(AerenaMatch, aerena_fixture.MATCH_ID)
                )
                facts = evidence(detail)
                self.assertEqual(
                    [game["number"] for game in facts["games"]],
                    list(range(1, count + 1)),
                )
                self.assertEqual(facts["reported_game_count"], count)
                self.assertEqual(facts["missing_scored_games"], 0)
                self.assertFalse(facts["games_omitted"])
                self.assertEqual(facts["game_detail_level"], "full")
                self.assertTrue(
                    any(
                        event["hero_name"] == LAST_HERO
                        for event in facts["games"][-1]["draft"]
                    )
                )
                self.assertEqual(facts["games"][-1]["players"][0]["ign"], LAST_PLAYER)
                self.assertIn(f"Game {count}", factual_fallback(detail))
                self.assertIn(LAST_HERO, factual_fallback(detail))
                encoded = json.dumps(facts)
                self.assertNotIn("SECRET_FROM_PUBLIC_SOURCE", encoded)
                self.assertNotIn("SECRET_PLAYER_RAW", encoded)
                self.assertLessEqual(len(encoded), MAX_CONTEXT_CHARS)

    def test_single_and_scene_provider_payloads_include_the_last_game(self):
        full = install(self.db, 7)
        league = self.db.get(
            type(save_league(self.db, aerena_fixture.league())),
            aerena_fixture.LEAGUE_ID,
        )
        save_match_detail(
            self.db, {"match": full, "playerGameStats": player_stats(full)}, league
        )
        self.db.commit()
        detail = detail_for(self.db, self.db.get(AerenaMatch, aerena_fixture.MATCH_ID))
        calls = []
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.esports_ai.urllib.request.build_opener", return_value=provider(calls)
        ):
            response = ask(self.db, 1, "Analyze the match", detail)
        self.assertEqual(response["mode"], "ai")
        sent = calls[0]["messages"][-1]["content"]
        self.assertIn('"number": 7', sent)
        self.assertIn(LAST_HERO, sent)
        self.assertIn(LAST_PLAYER, sent)
        self.assertIn("multi-game series", calls[0]["messages"][0]["content"])
        self.assertNotIn("SECRET_PLAYER_RAW", sent)

    def test_scene_fairly_keeps_every_game_even_at_the_context_limit(self):
        full = install(self.db, 7)
        detail = detail_for(self.db, self.db.get(AerenaMatch, full["matchId"]))
        sample = []
        for match_index in range(8):
            copy_of_detail = copy.deepcopy(detail)
            copy_of_detail["match"]["id"] = f"scene-{match_index}"
            template = copy_of_detail["games"][0]
            # 30 games with maximum-length, source-like names force compaction.
            copy_of_detail["games"] = []
            for number in range(1, 31):
                game = copy.deepcopy(template)
                game["number"] = number
                for event in game["draft"]:
                    event["hero_name"] = "H" * 120
                    event["player_ign"] = "P" * 120
                game["player_stats"] = [{"ign": "P" * 120, "hero_name": "H" * 120}] * 10
                copy_of_detail["games"].append(game)
            sample.append(copy_of_detail)
        facts = scene_evidence(sample)
        self.assertEqual(len(facts["matches"]), 8)
        self.assertTrue(
            all(
                [game["number"] for game in row["games"]] == list(range(1, 31))
                for row in facts["matches"]
            )
        )
        self.assertTrue(
            all(row["game_detail_level"] == "game_index" for row in facts["matches"])
        )
        self.assertTrue(all(not row["games_omitted"] for row in facts["matches"]))
        self.assertLessEqual(
            len(json.dumps(facts, ensure_ascii=False)), MAX_CONTEXT_CHARS
        )
        self.assertIn("narrow the selection", facts["matches"][-1]["limitations"])

    def test_extreme_selection_retains_each_game_and_season_in_a_bounded_index(self):
        matches = []
        for index in range(500):
            games = [
                {
                    "number": n,
                    "complete_picks": True,
                    "picks": [f"{hero}-" + "H" * 78 for hero in range(10)],
                }
                for n in range(1, 31, 2)
            ]
            matches.append(
                {
                    "match_id": f"{index:03}" + "I" * 117,
                    "season_id": f"{index:03}" + "S" * 77,
                    "season": "S" * 100,
                    "region": "P" * 30,
                    "week": 99,
                    "phase": "other_or_unknown",
                    "stage": "S" * 120,
                    "round": "R" * 100,
                    "team1": "A" * 80,
                    "team2": "B" * 80,
                    "score1": 8,
                    "score2": 7,
                    "games": games,
                }
            )
        facts = analysis.aggregate(matches, source="Aerena", scope={"mode": "matches"})
        self.assertLessEqual(
            len(json.dumps(facts, ensure_ascii=False)), analysis.MAX_MATCH_CONTEXT_CHARS
        )
        self.assertEqual(len(facts["matches"]), 500)
        self.assertEqual(facts["coverage"]["game_records"], 7500)
        self.assertEqual(facts["coverage"]["match_detail_cards_omitted"], 0)
        last = dict(zip(facts["match_index_columns"], facts["matches"][-1]))
        self.assertEqual(
            last["game_numbers"], "1,3,5,7,9,11,13,15,17,19,21,23,25,27,29"
        )
        self.assertEqual(
            facts["coverage"]["season_region_index"][last["season_region_ref"]],
            [f"{499:03}" + "S" * 77, "P" * 30],
        )
        self.assertIn("narrow the selection", facts["notice"])

    def test_ongoing_score_discloses_missing_games_without_flagging_the_current_game(
        self,
    ):
        full = install(self.db, 3, initial_games=1, fetched=True)
        row = self.db.get(AerenaMatch, full["matchId"])
        row.has_result = False
        row.starts_at = utcnow() - timedelta(hours=1)
        self.db.commit()
        detail = detail_for(self.db, row)
        self.assertEqual(detail["match"]["status"], "pending")
        facts = evidence(detail)
        self.assertEqual(facts["scored_game_count"], 3)
        self.assertEqual(facts["missing_scored_games"], 2)
        self.assertIn("2 game breakdown(s) are missing", factual_fallback(detail))
        # An in-progress game may be listed before the score is incremented.
        detail["games"] = [copy.deepcopy(detail["games"][0]) for _ in range(4)]
        self.assertFalse(evidence(detail)["score_game_conflict"])
        detail["match"]["status"] = "completed"
        self.assertTrue(evidence(detail)["score_game_conflict"])
        detail["match"]["status"] = "upcoming"
        detail["match"]["team1"]["teamScore"] = 0
        detail["match"]["team2"]["teamScore"] = 0
        self.assertIsNone(evidence(detail)["scored_game_count"])

    def test_score_mismatch_rechecks_even_when_saved_picks_are_complete_and_fresh(self):
        full = install(self.db, 3, initial_games=1, fetched=True)
        row = self.db.get(AerenaMatch, full["matchId"])
        initial = detail_for(self.db, row)
        self.assertTrue(analysis._aerena_games(initial)[0][0]["complete_picks"])
        self.assertEqual(initial["games"][0]["draft_coverage"], "complete")
        with patch("app.routers.esports.ENABLED", True), patch(
            "app.routers.esports.client.match_stats",
            return_value={"match": full, "playerGameStats": player_stats(full)},
        ) as upstream:
            facts, _ = analysis.analyze_aerena(self.db, [full["matchId"]])
        self.assertEqual(upstream.call_count, 1)
        self.assertEqual(upstream.call_args.args, (full["matchId"],))
        self.assertEqual(
            [game["number"] for game in facts["matches"][0]["games"]], [1, 2, 3]
        )
        self.assertEqual(facts["coverage"]["missing_scored_games"], 0)
        self.assertIn(LAST_HERO, facts["matches"][0]["games"][-1]["picks"])
        self.assertEqual(
            facts["matches"][0]["games"][-1]["players"][0]["name"], LAST_PLAYER
        )

    def test_source_failure_keeps_saved_game_and_reports_the_missing_two(self):
        full = install(self.db, 3, initial_games=1, fetched=True)
        with patch("app.routers.esports.ENABLED", True), patch(
            "app.routers.esports.client.match_stats",
            side_effect=AerenaError("Synthetic source unavailable."),
        ) as upstream:
            facts, _ = analysis.analyze_aerena(self.db, [full["matchId"]])
        self.assertEqual(upstream.call_count, 1)
        self.assertEqual(facts["coverage"]["missing_scored_games"], 2)
        self.assertEqual([game["number"] for game in facts["matches"][0]["games"]], [1])
        self.assertIn(
            "Synthetic source unavailable", facts["matches"][0]["detail_error"]
        )
        detail = detail_for(self.db, self.db.get(AerenaMatch, full["matchId"]))
        self.assertIn("2 game breakdown(s) are missing", factual_fallback(detail))
        self.assertEqual(evidence(detail)["missing_scored_games"], 2)

    def test_short_source_list_retains_older_games_and_incomplete_detail_cannot_erase_stats(
        self,
    ):
        full = install(self.db, 3)
        league = save_league(self.db, aerena_fixture.league())
        save_match_detail(
            self.db, {"match": full, "playerGameStats": player_stats(full)}, league
        )
        self.db.commit()
        shorter = copy.deepcopy(full)
        shorter["games"] = shorter["games"][:1]
        shorter["updatedAt"] = "2026-11-01T00:00:00Z"
        row = save_match(self.db, shorter, league)
        self.db.commit()
        self.assertEqual(row.game_count, 3)
        self.assertIn("retained", row.detail_error)
        self.assertEqual(
            self.db.query(AerenaGame).filter_by(match_id=full["matchId"]).count(), 3
        )
        self.assertEqual(
            self.db.query(AerenaPlayerGameStat)
            .filter_by(match_id=full["matchId"])
            .count(),
            1,
        )
        with self.assertRaises(AerenaError):
            save_match_detail(
                self.db, {"match": shorter, "playerGameStats": []}, league
            )
        self.db.rollback()
        self.assertEqual(
            self.db.query(AerenaPlayerGameStat)
            .filter_by(match_id=full["matchId"])
            .count(),
            1,
        )
        # A consistent source correction is allowed to remove a game.
        correction = copy.deepcopy(full)
        correction["updatedAt"] = "2026-11-02T00:00:00Z"
        correction["games"] = correction["games"][:2]
        correction["team1"]["teamScore"] = 0
        correction["team2"]["teamScore"] = 2
        row = save_match(self.db, correction, league)
        self.db.commit()
        self.assertEqual(row.game_count, 2)
        self.assertEqual(
            self.db.query(AerenaGame).filter_by(match_id=full["matchId"]).count(), 2
        )

    def test_short_final_update_with_conflicting_score_retains_saved_games(self):
        full = install(self.db, 4)
        league = save_league(self.db, aerena_fixture.league())
        contradictory = copy.deepcopy(full)
        contradictory["games"] = contradictory["games"][:3]
        contradictory["team1"]["teamScore"], contradictory["team2"]["teamScore"] = 0, 2
        contradictory["updatedAt"] = "2026-11-01T00:00:00Z"
        row = save_match(self.db, contradictory, league)
        self.db.commit()
        self.assertEqual(row.game_count, 4)
        self.assertIn("retained", row.detail_error)
        with self.assertRaises(AerenaError):
            save_match_detail(
                self.db, {"match": contradictory, "playerGameStats": []}, league
            )
        self.db.rollback()
        self.assertEqual(
            self.db.query(AerenaGame).filter_by(match_id=full["matchId"]).count(), 4
        )

    def test_short_ongoing_update_retains_current_game_and_player_stats(self):
        full = install(self.db, 3)
        league = save_league(self.db, aerena_fixture.league())
        ongoing = copy.deepcopy(full)
        ongoing["matchWinner"] = None
        ongoing["team1"]["teamScore"], ongoing["team2"]["teamScore"] = 1, 1
        save_match_detail(
            self.db, {"match": ongoing, "playerGameStats": player_stats(full)}, league
        )
        self.db.commit()
        shorter = copy.deepcopy(ongoing)
        shorter["games"] = shorter["games"][:2]
        shorter["updatedAt"] = "2026-11-01T00:00:00Z"
        row = save_match(self.db, shorter, league)
        self.db.commit()
        self.assertFalse(row.has_result)
        self.assertEqual(row.game_count, 3)
        self.assertIn("retained", row.detail_error)
        with self.assertRaises(AerenaError):
            save_match_detail(
                self.db, {"match": shorter, "playerGameStats": []}, league
            )
        self.db.rollback()
        self.assertEqual(
            self.db.query(AerenaPlayerGameStat)
            .filter_by(match_id=full["matchId"])
            .count(),
            1,
        )

    def test_wrong_source_match_is_rejected_without_overwriting_another_series(self):
        full = install(self.db, 3, initial_games=1, fetched=True)
        other = series_match(2, "OTHER-MATCH", "other-source")
        league = save_league(self.db, aerena_fixture.league())
        save_match(self.db, other, league)
        self.db.commit()
        with patch("app.routers.esports.ENABLED", True), patch(
            "app.routers.esports.client.match_stats",
            return_value={"match": other, "playerGameStats": []},
        ):
            facts, _ = analysis.analyze_aerena(self.db, [full["matchId"]])
        self.assertEqual(facts["coverage"]["missing_scored_games"], 2)
        self.assertIn("different match", facts["matches"][0]["detail_error"])
        self.assertEqual(self.db.get(AerenaMatch, "OTHER-MATCH").game_count, 2)


class WholeSeriesChatTests(unittest.TestCase):
    setUp = chat_fixture.CloverAITests.setUp
    tearDown = chat_fixture.CloverAITests.tearDown
    req = chat_fixture.CloverAITests.req
    new_chat = chat_fixture.CloverAITests.new_chat

    def install(self, count: int, **kwargs) -> dict:
        with self.factory() as db:
            return install(db, count, **kwargs)

    def test_direct_match_link_loads_missing_games_and_followup_keeps_the_series(self):
        full = self.install(3, initial_games=1, fetched=True)
        chat = self.new_chat()
        sent = []
        with patch("app.routers.esports.ENABLED", True), patch(
            "app.routers.esports.client.match_stats",
            return_value={"match": full, "playerGameStats": player_stats(full)},
        ) as upstream, patch.dict(
            os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}
        ), patch(
            "app.clover_ai_service.urllib.request.build_opener",
            return_value=provider(sent),
        ):
            status, first, _ = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={
                    "text": f"Analyze https://aerena.gg/mobile-legends/match/{full['matchId']}",
                    "web_mode": "off",
                },
            )
            self.assertEqual(status, 201)
            status, second, _ = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "What happened in game 3?", "web_mode": "off"},
            )
            self.assertEqual(status, 201)
        self.assertEqual(upstream.call_count, 1)
        for ctx in (context(sent, 0), context(sent, 1)):
            self.assertEqual(
                [
                    g["number"]
                    for g in ctx["selected_aerena_matches"]["matches"][0]["games"]
                ],
                [1, 2, 3],
            )
            self.assertEqual(
                [
                    g["number"]
                    for g in ctx["match_pick_analysis"]["matches"][0]["games"]
                ],
                [1, 2, 3],
            )
            self.assertIn(LAST_HERO, json.dumps(ctx))
            self.assertIn(LAST_PLAYER, json.dumps(ctx))
            self.assertNotIn("SECRET_FROM_PUBLIC_SOURCE", json.dumps(ctx))
            self.assertNotIn("SECRET_PLAYER_RAW", json.dumps(ctx))
        self.assertTrue(
            any(
                source.get("esports_selection")
                for source in first["user_message"]["sources"]
            )
        )
        self.assertEqual(second["assistant_message"]["mode"], "ai")

    def test_plain_language_named_match_loads_all_games_without_pick_keywords(self):
        full = self.install(3, initial_games=1, fetched=True)
        chat = self.new_chat()
        sent = []
        with patch("app.routers.esports.ENABLED", True), patch(
            "app.routers.esports.client.match_stats",
            return_value={"match": full, "playerGameStats": player_stats(full)},
        ) as upstream, patch.dict(
            os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}
        ), patch(
            "app.clover_ai_service.urllib.request.build_opener",
            return_value=provider(sent),
        ):
            status, _, _ = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "Analyze Aurora vs Onic match", "web_mode": "off"},
            )
        self.assertEqual(status, 201)
        self.assertEqual(upstream.call_count, 1)
        ctx = context(sent)
        self.assertEqual(
            [
                g["number"]
                for g in ctx["selected_aerena_matches"]["matches"][0]["games"]
            ],
            [1, 2, 3],
        )
        self.assertIn(LAST_HERO, json.dumps(ctx))

    def test_legacy_selection_rebuilds_context_after_refresh_and_reuses_ids(self):
        full = self.install(2, initial_games=1, fetched=True)
        chat = self.new_chat()
        sent = []
        with patch("app.routers.esports.ENABLED", True), patch(
            "app.routers.esports.client.match_stats",
            return_value={"match": full, "playerGameStats": player_stats(full)},
        ) as upstream, patch.dict(
            os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}
        ), patch(
            "app.clover_ai_service.urllib.request.build_opener",
            return_value=provider(sent),
        ):
            result = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "Analyze this match", "match_ids": [full["matchId"]]},
            )
            self.assertEqual(result[0], 201)
            self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "What about game 2?"},
            )
        self.assertEqual(upstream.call_count, 1)
        self.assertEqual(len(result[1]["user_message"]["sources"]), 1)
        for payload in sent:
            ctx = json.loads(payload["messages"][-1]["content"])["available_context"]
            self.assertEqual(
                [
                    g["number"]
                    for g in ctx["selected_aerena_matches"]["matches"][0]["games"]
                ],
                [1, 2],
            )
            self.assertIn(LAST_HERO, json.dumps(ctx))

    def test_picker_seven_game_series_and_think_use_same_full_context(self):
        full = self.install(7)
        chat = self.new_chat()
        sent = []
        selection = {
            "source": "aerena",
            "mode": "matches",
            "region": "ph",
            "league_id": aerena_fixture.LEAGUE_ID,
            "match_ids": [full["matchId"]],
        }
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener",
            return_value=provider(sent, think=True),
        ):
            status, answer, _ = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={
                    "text": "Analyze this series",
                    "esports_selection": selection,
                    "think": True,
                },
            )
        self.assertEqual((status, answer["assistant_message"]["mode"]), (201, "think"))
        ctx = context(sent)
        self.assertEqual(ctx["match_pick_analysis"]["scope"]["region"], "PH")
        self.assertEqual(
            ctx["match_pick_analysis"]["scope"]["season_id"], aerena_fixture.LEAGUE_ID
        )
        self.assertEqual(
            [
                g["number"]
                for g in ctx["selected_aerena_matches"]["matches"][0]["games"]
            ],
            list(range(1, 8)),
        )
        self.assertIn(LAST_HERO, json.dumps(ctx))
        self.assertNotIn("private reasoning", json.dumps(answer))

    def test_facts_only_reply_shows_late_game_and_source_gap(self):
        full = self.install(3, initial_games=1, fetched=True)
        chat = self.new_chat()
        status, answer, _ = self.req(
            "POST",
            f"/conversations/{chat}/messages",
            payload={"text": "Analyze the series", "match_ids": [full["matchId"]]},
        )
        self.assertEqual((status, answer["assistant_message"]["mode"]), (201, "facts"))
        self.assertIn("Game 1", answer["assistant_message"]["content"])
        self.assertIn("2 scored games missing", answer["assistant_message"]["content"])
        # A complete saved series exposes a later-only pick in the fallback.
        with self.factory() as db:
            league = save_league(db, aerena_fixture.league())
            save_match(db, full, league)
            db.commit()
        status, answer, _ = self.req(
            "POST",
            f"/conversations/{chat}/messages",
            payload={"text": "Analyze these games", "match_ids": [full["matchId"]]},
        )
        self.assertEqual(status, 201)
        self.assertIn("Game 3", answer["assistant_message"]["content"])
        self.assertIn(LAST_HERO, answer["assistant_message"]["content"])

    def test_rone_multiple_series_reach_every_game_and_late_game_stats(self):
        games_by_id = {"1": 2, "2": 3, "3": 7}
        schedule = {
            "weeks": [
                {
                    "week": 1,
                    "days": [
                        {
                            "label": "D1",
                            "matches": [
                                rone_fixture.schedule_match(
                                    mid, score1=count // 2, score2=count - count // 2
                                )
                                for mid, count in games_by_id.items()
                            ],
                        }
                    ],
                }
            ]
        }

        def fetch(path, query):
            if path == "esports/id/schedule":
                return 200, schedule
            mid = path.rsplit("/", 1)[-1]
            games = [
                rone_fixture.game(number, rone_fixture.BASE)
                for number in range(1, games_by_id[mid] + 1)
            ]
            if mid == "3":
                last = games[-1]["teams"][1]["players"][-1]
                last["hero"]["name"] = LAST_HERO
                last["name"] = LAST_PLAYER
                last["gold"] = 15555
                last["damage_dealt"] = 54321
                last["items"] = [
                    {"id": "1234", "image": "https://untrusted.invalid/secret"}
                ]
            return 200, rone_fixture.detail(mid, games)

        sent = []
        chat = self.new_chat()
        selection = {
            "source": "rone",
            "mode": "matches",
            "region": "id",
            "match_ids": ["1", "2", "3"],
        }
        with patch(
            "app.routers.intel._public_fetch", side_effect=fetch
        ) as source, patch("app.ai_esports_analysis.time.sleep"), patch.dict(
            os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}
        ), patch(
            "app.clover_ai_service.urllib.request.build_opener",
            return_value=provider(sent),
        ):
            status, _, _ = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={
                    "text": "Analyze these matches",
                    "esports_selection": selection,
                },
            )
            self.assertEqual(status, 201)
            self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "What happened in Rone MPL ID game 7?"},
            )
        self.assertEqual(
            source.call_count, 4
        )  # schedule and one public detail per match; follow-up uses cache
        for payload in sent:
            facts = json.loads(payload["messages"][-1]["content"])["available_context"][
                "match_pick_analysis"
            ]
            self.assertEqual(
                [[g["number"] for g in m["games"]] for m in facts["matches"]],
                [list(range(1, 3)), list(range(1, 4)), list(range(1, 8))],
            )
            last = facts["matches"][-1]["games"][-1]
            self.assertIn(LAST_HERO, last["picks"])
            player = last["teams"][1]["players"][-1]
            self.assertEqual(
                (
                    player["name"],
                    player["gold"],
                    player["damage_dealt"],
                    player["item_ids"],
                ),
                (LAST_PLAYER, 15555, 54321, ["1234"]),
            )
            self.assertNotIn("untrusted.invalid", json.dumps(facts))
            self.assertNotIn("NOT_IN_AI_CONTEXT", json.dumps(facts))

    def test_explicit_rone_followup_does_not_reuse_or_auto_select_aerena(self):
        full = self.install(3)
        chat = self.new_chat()
        sent = []
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener",
            return_value=provider(sent),
        ):
            self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "Analyze this match", "match_ids": [full["matchId"]]},
            )
            self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "What happened in MPL ID game 3?"},
            )
            self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "What happened in Rone game 3?"},
            )
            self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "Compare Rone and Aerena game 3"},
            )
        self.assertIn("selected_aerena_matches", context(sent, 0))
        for index in (1, 2, 3):
            self.assertNotIn("selected_aerena_matches", context(sent, index))
            self.assertNotIn("match_pick_analysis", context(sent, index))
        self.assertIn("not combined", context(sent, 3)["esports_source_notice"])

    def test_history_disabled_does_not_silently_reuse_a_previous_series(self):
        full = self.install(3)
        chat = self.new_chat()
        sent = []
        self.assertEqual(
            self.req("PATCH", "/settings", payload={"use_history": False})[0], 200
        )
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener",
            return_value=provider(sent),
        ):
            self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "Analyze this match", "match_ids": [full["matchId"]]},
            )
            self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "What happened in game 3?"},
            )
        self.assertIn("selected_aerena_matches", context(sent, 0))
        self.assertNotIn("selected_aerena_matches", context(sent, 1))
        self.assertNotIn("match_pick_analysis", context(sent, 1))

    def test_failed_provider_fallback_still_shows_the_final_game(self):
        self.install(7)
        chat = self.new_chat()
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener",
            return_value=SimpleNamespace(
                open=lambda *_a, **_k: (_ for _ in ()).throw(OSError("offline"))
            ),
        ):
            status, result, _ = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={
                    "text": "Analyze the series",
                    "match_ids": [aerena_fixture.MATCH_ID],
                },
            )
        self.assertEqual((status, result["assistant_message"]["mode"]), (201, "facts"))
        self.assertIn("Game 7", result["assistant_message"]["content"])
        self.assertIn(LAST_HERO, result["assistant_message"]["content"])

    def test_scene_loads_each_missing_series_before_sending_facts(self):
        first = self.install(2, initial_games=1, fetched=True)
        second = series_match(3, "SECOND-MATCH", "second-source")
        with self.factory() as db:
            league = save_league(db, aerena_fixture.league())
            save_heroes(db, hero_catalog(second))
            initial = copy.deepcopy(second)
            initial["games"] = initial["games"][:1]
            row = save_match(db, initial, league)
            row.detail_fetched_at = utcnow() - timedelta(seconds=1)
            row.detail_attempted_at = utcnow() - timedelta(minutes=6)
            db.commit()
        records = {data["matchId"]: data for data in (first, second)}
        sent = []

        def fetch(mid):
            return {
                "match": records[mid],
                "playerGameStats": player_stats(records[mid]),
            }

        with patch("app.routers.esports.ENABLED", True), patch(
            "app.routers.esports.client.match_stats", side_effect=fetch
        ) as upstream, patch("app.routers.esports.time.sleep"), patch.dict(
            os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}
        ), patch(
            "app.esports_ai.urllib.request.build_opener", return_value=provider(sent)
        ):
            status, _ = esports_http.request(
                "POST",
                "/api/esports/analysis",
                self.tokens["owner"],
                {
                    "question": "Analyze the series",
                    "match_ids": [first["matchId"], second["matchId"]],
                },
            )
        self.assertEqual(status, 200)
        self.assertEqual(
            [call.args[0] for call in upstream.call_args_list],
            [first["matchId"], second["matchId"]],
        )
        content = sent[0]["messages"][-1]["content"]
        facts = json.loads(
            content.split("Saved match evidence (JSON):\n", 1)[1].rsplit(
                "\n\nQuestion:", 1
            )[0]
        )
        self.assertEqual(
            [[g["number"] for g in row["games"]] for row in facts["matches"]],
            [[1, 2], [1, 2, 3]],
        )
        self.assertTrue(
            all(
                any(e["hero_name"] == LAST_HERO for e in row["games"][-1]["draft"])
                for row in facts["matches"]
            )
        )

    def test_http_scene_and_match_load_missing_public_games_before_provider(self):
        full = self.install(3, initial_games=1, fetched=True)
        sent = []
        with patch("app.routers.esports.ENABLED", True), patch(
            "app.routers.esports.client.match_stats",
            return_value={"match": full, "playerGameStats": player_stats(full)},
        ) as upstream, patch.dict(
            os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}
        ), patch(
            "app.esports_ai.urllib.request.build_opener", return_value=provider(sent)
        ):
            status, _ = esports_http.request(
                "POST",
                f"/api/esports/matches/{full['matchId']}/analysis",
                self.tokens["owner"],
                {"question": "Analyze this match"},
            )
            self.assertEqual(status, 200)
            status, _ = esports_http.request(
                "POST",
                "/api/esports/analysis",
                self.tokens["owner"],
                {"question": "Analyze these matches", "match_ids": [full["matchId"]]},
            )
            self.assertEqual(status, 200)
            invalid = esports_http.request(
                "POST",
                "/api/esports/analysis",
                self.tokens["owner"],
                {"question": "Analyze", "match_ids": [full["matchId"], "NOT-FOUND"]},
            )
            self.assertEqual(invalid[0], 404)
        self.assertEqual(upstream.call_count, 1)
        self.assertEqual(len(sent), 2)
        for payload in sent:
            content = payload["messages"][-1]["content"]
            self.assertIn('"number": 3', content)
            self.assertIn(LAST_HERO, content)
            self.assertIn(LAST_PLAYER, content)


if __name__ == "__main__":
    unittest.main()
