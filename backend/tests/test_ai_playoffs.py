"""Playoff feeds, scoped aggregation and UI APIs; synthetic public fixtures only."""

from __future__ import annotations

import copy
import io
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

os.environ["CLOVER_AERENA_ENABLED"] = "0"

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import ai_esports_analysis as analysis
from app.aerena_service import save_heroes, save_league, save_match, save_series
from app.db import Base
from app.models import utcnow
from test_aerena import (
    league as aerena_league,
    match as aerena_match,
    series as aerena_series,
)
from test_ai_esports_analysis import (
    BASE,
    OTHER,
    THIRD,
    detail,
    game,
    schedule,
    schedule_match,
)
import test_clover_ai as chat_fixture


def playoffs():
    first = schedule_match("10", "Final Alpha", "Final Bravo", 3, 2) | {
        "round": "Upper final",
        "best_of": 5,
    }
    second = schedule_match("11", "Final Charlie", "Final Delta", 3, 0) | {
        "round": "Grand final",
        "best_of": 7,
    }
    pending = schedule_match(None, "TBD", "TBD", None, None) | {"round": "Lower final"}
    return {
        "bracket_image": None,
        "seeds": [],
        "days": [
            {
                "day": 1,
                "label": "Playoff day 1",
                "matches": [first, copy.deepcopy(first), second, pending],
            },
        ],
    }


def rone_fetch(path, query):
    assert query == ""
    routes = {
        "esports/id/schedule": schedule(),
        "esports/id/playoffs": playoffs(),
        "esports/id/matches/1": detail(
            1, [game(1, BASE), game(2, OTHER), game(3, THIRD)]
        ),
        "esports/id/matches/10": detail(
            10,
            [
                game(1, BASE),
                game(2, OTHER),
                game(3, THIRD),
                game(4, BASE),
                game(5, OTHER),
            ],
        ),
        "esports/id/matches/11": detail(
            11, [game(1, BASE), game(2, BASE), game(3, OTHER)]
        ),
    }
    if path not in routes:
        raise AssertionError(f"unexpected source path: {path}")
    return 200, routes[path]


def seed_aerena(db):
    save_series(db, [aerena_series()])
    league = save_league(db, aerena_league())
    prototype = aerena_match()
    picks = [
        event["hero"]
        for event in prototype["games"][0]["draft"]
        if event["type"] == "Pick"
    ]
    save_heroes(
        db, [{"_id": hid, "heroName": f"Hero {i}"} for i, hid in enumerate(picks)]
    )
    for index, stage in enumerate(
        ("Regular Season", "Playoffs", "Upper Bracket", "Grand Final", ""), 1
    ):
        item = copy.deepcopy(prototype)
        item.update(
            {
                "_id": f"source-{index}",
                "matchId": f"PH18-S18W1D{index}M1",
                "stage": stage,
            }
        )
        item["games"][0]["_id"] = f"game-{index}"
        save_match(db, item, league)
    league.matches_fetched_at = utcnow()
    db.commit()
    return league.id


class PlayoffAnalysisTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine, autoflush=False)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_defensive_playoff_projection_keeps_rounds_tbd_and_conflicts(self):
        source = playoffs()
        rows, duplicates = analysis.rone_playoff_rows(source, "id")
        self.assertTrue(analysis._valid_playoffs(source))
        self.assertEqual((len(rows), duplicates), (3, 1))
        self.assertEqual(
            (rows[0]["id"], rows[0]["week"], rows[0]["round"], rows[0]["best_of"]),
            ("10", None, "Upper final", 5),
        )
        self.assertEqual(rows[2]["phase"], "playoffs")
        self.assertIsNone(rows[2]["id"])
        kh_rows, kh_duplicates = analysis.rone_playoff_rows(source, "kh")
        self.assertEqual((len(kh_rows), kh_duplicates), (3, 1))
        self.assertTrue(all(row["id"] is None for row in kh_rows))
        with patch(
            "app.ai_esports_analysis.rone_playoffs",
            return_value=(source, None, "saved"),
        ):
            kh_facts, _ = analysis.analyze_rone(
                self.db, {"source": "rone", "region": "kh", "mode": "playoffs"}
            )
        self.assertEqual(kh_facts["coverage"]["matches_listed"], 3)
        self.assertTrue(
            all(
                row["load_status"] == "no_region_detail_route"
                for row in kh_facts["matches"]
            )
        )
        self.assertIn("match-details route for MPL KH", kh_facts["notice"])
        ph = {
            "days": [
                {"label": "D1", "matches": [schedule_match("team-a-team-b-20260821")]}
            ]
        }
        self.assertEqual(
            analysis.rone_playoff_rows(ph, "ph")[0][0]["id"], "team-a-team-b-20260821"
        )
        self.assertFalse(analysis._valid_playoffs({"weeks": []}))
        self.assertFalse(analysis._valid_playoffs({"days": [{"matches": [{}] * 51}]}))
        conflicting = playoffs()
        conflicting["days"][0]["matches"].append(
            schedule_match("10", "Different", "Teams")
        )
        rows, _ = analysis.rone_playoff_rows(conflicting, "id")
        self.assertIsNone(rows[0]["id"])
        self.assertTrue(rows[0]["id_conflict"])

    def test_full_playoffs_and_individual_match_load_all_available_games(self):
        with patch(
            "app.routers.intel._public_fetch", side_effect=rone_fetch
        ) as fetch, patch("app.ai_esports_analysis.time.sleep"):
            facts, sources = analysis.analyze_rone(
                self.db, {"source": "rone", "region": "id", "mode": "playoffs"}
            )
            self.assertEqual(facts["scope"]["mode"], "playoffs")
            self.assertIsNone(facts["scope"]["week"])
            self.assertEqual(facts["coverage"]["matches_listed"], 3)
            self.assertEqual(facts["coverage"]["complete_pick_games"], 8)
            self.assertEqual(facts["coverage"]["missing_matches"], 1)
            self.assertEqual(facts["coverage"]["duplicate_schedule_rows_removed"], 1)
            self.assertEqual(facts["matches"][0]["round"], "Upper final")
            self.assertEqual(facts["matches"][2]["load_status"], "no_source_match_id")
            self.assertEqual(
                facts["all_games"]["top_picks"][0], {"hero": "Alice", "picks": 7}
            )
            self.assertIn(
                "playoffs", analysis.pick_chart(facts, "game 2 picks")["title"]
            )
            self.assertEqual(len(sources), 1)
            self.assertTrue(sources[0]["url"].endswith("/playoffs"))
            self.assertFalse(
                any("schedule" in call.args[0] for call in fetch.call_args_list)
            )
            one, _ = analysis.analyze_rone(
                self.db,
                {
                    "source": "rone",
                    "region": "id",
                    "mode": "matches",
                    "phase": "playoffs",
                    "match_ids": ["10", "999"],
                },
            )
            self.assertEqual(one["coverage"]["complete_pick_games"], 5)
            self.assertEqual(one["coverage"]["missing_matches"], 1)
            self.assertFalse(
                any("999" in call.args[0] for call in fetch.call_args_list)
            )

    def test_mixed_selected_stages_do_not_duplicate_or_invent_matches(self):
        with patch(
            "app.routers.intel._public_fetch", side_effect=rone_fetch
        ) as fetch, patch("app.ai_esports_analysis.time.sleep"):
            facts, sources = analysis.analyze_rone(
                self.db,
                {
                    "source": "rone",
                    "region": "id",
                    "mode": "matches",
                    "phase": "all",
                    "match_ids": ["1", "10"],
                },
            )
            self.assertEqual(facts["coverage"]["complete_pick_games"], 8)
            self.assertEqual(
                {row["phase"] for row in facts["matches"]}, {"regular", "playoffs"}
            )
            self.assertEqual(len(sources), 2)
            self.assertEqual(facts["coverage"]["missing_matches"], 0)
            self.assertFalse(any("11" in call.args[0] for call in fetch.call_args_list))
        # Same source ID in both feeds is ambiguous, not counted twice.
        conflicting = playoffs()
        conflicting["days"][0]["matches"].append(
            schedule_match("1", "Different", "Finalists")
        )
        with patch(
            "app.ai_esports_analysis.rone_schedule",
            return_value=(schedule(), None, "saved"),
        ), patch(
            "app.ai_esports_analysis.rone_playoffs",
            return_value=(conflicting, None, "saved"),
        ):
            facts, _ = analysis.analyze_rone(
                self.db,
                {
                    "source": "rone",
                    "region": "id",
                    "mode": "matches",
                    "phase": "all",
                    "match_ids": ["1"],
                },
            )
        self.assertEqual(facts["coverage"]["missing_matches"], 1)
        self.assertEqual(facts["coverage"]["complete_pick_games"], 0)
        self.assertIn("conflicting records", facts["notice"])

    def test_unavailable_one_feed_is_disclosed_and_other_stage_is_retained(self):
        def upstream(path, query):
            if path.endswith("/schedule"):
                return 503, {"code": 503}
            return rone_fetch(path, query)

        with patch("app.routers.intel._public_fetch", side_effect=upstream), patch(
            "app.ai_esports_analysis.time.sleep"
        ):
            facts, sources = analysis.analyze_rone(
                self.db,
                {
                    "source": "rone",
                    "region": "id",
                    "mode": "matches",
                    "phase": "all",
                    "match_ids": ["1", "10"],
                },
            )
        self.assertEqual(facts["coverage"]["complete_pick_games"], 5)
        self.assertEqual(facts["coverage"]["missing_matches"], 1)
        self.assertIn("schedule could not be loaded", facts["notice"])
        self.assertEqual(len(sources), 1)

    def test_aerena_playoffs_use_only_source_stage_labels_not_weeks(self):
        league_id = seed_aerena(self.db)
        facts, sources = analysis.analyze_aerena_scope(
            self.db,
            {
                "source": "aerena",
                "region": "ph",
                "league_id": league_id,
                "mode": "playoffs",
            },
        )
        self.assertEqual(facts["scope"]["season"], "MPL PH S18")
        self.assertEqual(facts["scope"]["mode"], "playoffs")
        self.assertEqual(facts["coverage"]["matches_listed"], 3)
        self.assertEqual(facts["coverage"]["complete_pick_games"], 3)
        self.assertEqual(facts["coverage"]["season_matches_without_stage_label"], 1)
        self.assertTrue(
            all(
                row["phase"] == "playoffs" and row["week"] is None
                for row in facts["matches"]
            )
        )
        self.assertEqual(len(sources), 3)
        self.assertIn("differently labelled", facts["notice"])
        single, _ = analysis.analyze_aerena_scope(
            self.db,
            {
                "source": "aerena",
                "region": "ph",
                "league_id": league_id,
                "mode": "matches",
                "match_ids": ["PH18-S18W1D2M1"],
            },
        )
        self.assertEqual(single["scope"]["phase"], "playoffs")
        self.assertIn("playoffs", analysis.pick_chart(single, "game 1 picks")["title"])
        regular, _ = analysis.analyze_aerena_scope(
            self.db,
            {
                "source": "aerena",
                "region": "ph",
                "league_id": league_id,
                "mode": "week",
                "week": 1,
            },
        )
        self.assertEqual(
            regular["coverage"]["matches_listed"], 2
        )  # regular + source week with unknown stage
        self.assertFalse(any(row["phase"] == "playoffs" for row in regular["matches"]))
        self.assertEqual(
            analysis.requested_scope("Aerena MPL PH season 18 play-offs", self.db)[
                "league_id"
            ],
            league_id,
        )
        self.assertEqual(
            analysis.requested_scope("Rone PH playoffs")["mode"], "playoffs"
        )
        self.assertTrue(
            analysis.requested_scope("Rone MPL PH season 18 playoffs")[
                "season_requested"
            ]
        )
        self.assertIn(
            "Choose a specific",
            analysis.requested_scope("Aerena MPL PH playoffs", self.db)[
                "selection_error"
            ],
        )
        self.assertIn(
            "one week or the playoffs",
            analysis.requested_scope("MPL PH week 1 playoffs")["selection_error"],
        )
        self.assertIn(
            "specific playoff round",
            analysis.requested_scope("Rone MPL ID playoffs grand final picks")[
                "selection_error"
            ],
        )
        self.assertTrue(analysis.aerena_playoff_stage("Playoffs - Week 1"))
        self.assertTrue(analysis.aerena_playoff_stage("Grand Final"))
        self.assertFalse(analysis.aerena_playoff_stage("Regular Season - Final Week"))
        self.assertFalse(analysis.aerena_playoff_stage("Group Final"))


class PlayoffRouteTests(unittest.TestCase):
    setUp = chat_fixture.CloverAITests.setUp
    tearDown = chat_fixture.CloverAITests.tearDown
    req = chat_fixture.CloverAITests.req
    new_chat = chat_fixture.CloverAITests.new_chat

    def test_rone_route_validation_direct_chat_and_owner_followup(self):
        self.assertEqual(
            chat_fixture.request("GET", "/api/ai/esports/rone/id/playoffs")[0], 401
        )
        captured = []

        def provider(req, timeout):
            captured.append(json.loads(req.data))
            return io.BytesIO(
                b'{"choices":[{"message":{"content":"Synthetic analysis."}}]}'
            )

        chat = self.new_chat()
        with patch(
            "app.routers.intel._public_fetch", side_effect=rone_fetch
        ) as fetch, patch("app.ai_esports_analysis.time.sleep"), patch.dict(
            os.environ, {"DEEPSEEK_API_KEY": "synthetic"}
        ), patch(
            "app.clover_ai_service.urllib.request.build_opener",
            return_value=SimpleNamespace(open=provider),
        ):
            status, data, _ = self.req("GET", "/esports/rone/id/playoffs")
            self.assertEqual(status, 200)
            self.assertEqual(
                (len(data["matches"]), data["duplicate_rows_removed"]), (3, 1)
            )
            self.assertIsNone(data["season"])
            status, result, _ = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={
                    "text": "Most picked heroes in Rone MPL ID playoffs?",
                    "web_mode": "off",
                },
            )
            self.assertEqual(status, 201)
            stats = json.loads(captured[-1]["messages"][-1]["content"])[
                "available_context"
            ]["match_pick_analysis"]
            self.assertEqual(
                (stats["scope"]["mode"], stats["coverage"]["complete_pick_games"]),
                ("playoffs", 8),
            )
            saved = result["user_message"]["sources"][0]["esports_selection"]
            self.assertEqual(saved["mode"], "playoffs")
            self.assertIn("Playoffs", result["user_message"]["sources"][0]["label"])
            follow, _, _ = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "And game 2 picks?", "web_mode": "off"},
            )
            self.assertEqual(follow, 201)
            again = json.loads(captured[-1]["messages"][-1]["content"])[
                "available_context"
            ]["match_pick_analysis"]
            self.assertEqual(
                (again["scope"]["mode"], again["coverage"]["complete_pick_games"]),
                ("playoffs", 8),
            )
            self.assertEqual(fetch.call_count, 3)
        self.assertEqual(
            self.req("GET", f"/conversations/{chat}/messages", who="other")[0], 404
        )
        fallback_chat = self.new_chat()
        with patch("app.routers.intel._public_fetch", side_effect=rone_fetch), patch(
            "app.ai_esports_analysis.time.sleep"
        ):
            status, fallback, _ = self.req(
                "POST",
                f"/conversations/{fallback_chat}/messages",
                payload={"text": "Rone MPL ID playoffs picks", "web_mode": "off"},
            )
        self.assertEqual(status, 201)
        self.assertEqual(fallback["assistant_message"]["mode"], "facts")
        self.assertIn(
            "Rone MPL ID · Playoffs", fallback["assistant_message"]["content"]
        )
        self.assertIn("Upper final", fallback["assistant_message"]["content"])
        for bad in [
            {"source": "rone", "region": "id", "mode": "playoffs", "week": 1},
            {"source": "rone", "region": "id", "mode": "playoffs", "match_ids": ["10"]},
            {
                "source": "rone",
                "region": "id",
                "mode": "week",
                "week": 1,
                "phase": "playoffs",
            },
            {"source": "aerena", "region": "ph", "mode": "playoffs"},
            {
                "source": "aerena",
                "region": "ph",
                "league_id": "x",
                "mode": "playoffs",
                "phase": "all",
            },
        ]:
            self.assertEqual(
                self.req(
                    "POST",
                    f"/conversations/{chat}/messages",
                    payload={"text": "x", "esports_selection": bad},
                )[0],
                422,
            )

    def test_aerena_picker_and_match_centre_filter_before_limit(self):
        with self.factory() as db:
            league_id = seed_aerena(db)
            from app.aerena_models import AerenaLeague

            league = db.get(AerenaLeague, league_id)
            for index, stage in enumerate(
                ("Regular Season - Final Week", "Group Final")
            ):
                item = copy.deepcopy(aerena_match())
                item.update(
                    {
                        "_id": f"not-playoff-{index}",
                        "matchId": f"REGULAR-FINAL-{index}",
                        "stage": stage,
                        "games": [],
                    }
                )
                save_match(db, item, league)
            db.commit()
        status, data, _ = self.req(
            "GET", f"/esports/aerena/{league_id}/matches?phase=playoffs&limit=2"
        )
        self.assertEqual(status, 200)
        self.assertEqual(
            (data["total"], data["playoff_matches"], data["unlabeled_stages"]),
            (3, 3, 1),
        )
        self.assertTrue(data["has_more"])
        self.assertTrue(all(row["week"] is None for row in data["matches"]))
        status, page, _ = self.req(
            "GET", f"/esports/aerena/{league_id}/matches?phase=playoffs&offset=2"
        )
        self.assertEqual((status, len(page["matches"])), (200, 1))
        status, search, _ = self.req(
            "GET", f"/esports/aerena/{league_id}/matches?phase=playoffs&q=bracket"
        )
        self.assertEqual((status, search["total"]), (200, 1))
        status, result, _ = chat_fixture.request(
            "GET",
            f"/api/esports/matches?league_id={league_id}&phase=playoffs&view=all&limit=1",
            self.tokens["owner"],
        )
        self.assertEqual(status, 200)
        self.assertEqual(len(result["matches"]), 1)
        self.assertTrue(result["has_more"])
        self.assertTrue(analysis.aerena_playoff_stage(result["matches"][0]["stage"]))
        status, all_playoffs, _ = chat_fixture.request(
            "GET",
            f"/api/esports/matches?league_id={league_id}&phase=playoffs&view=all&limit=200",
            self.tokens["owner"],
        )
        self.assertEqual(status, 200)
        self.assertEqual(len(all_playoffs["matches"]), 3)
        self.assertFalse(all_playoffs["has_more"])
        self.assertTrue(
            all(
                analysis.aerena_playoff_stage(row["stage"])
                for row in all_playoffs["matches"]
            )
        )
        self.assertEqual(
            chat_fixture.request(
                "GET", "/api/esports/matches?phase=invalid", self.tokens["owner"]
            )[0],
            422,
        )
        self.assertEqual(
            self.req("GET", f"/esports/aerena/{league_id}/matches?phase=invalid")[0],
            422,
        )
        self.assertEqual(
            self.req(
                "GET", f"/esports/aerena/{league_id}/matches?phase=playoffs&week=1"
            )[0],
            422,
        )


if __name__ == "__main__":
    unittest.main()
