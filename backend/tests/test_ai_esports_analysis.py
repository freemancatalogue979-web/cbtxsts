"""Synthetic, isolated public-source week/game analysis tests."""

from __future__ import annotations

import json
import os
import unittest
from datetime import timedelta
from unittest.mock import patch

os.environ["CLOVER_AERENA_ENABLED"] = "0"

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import ai_esports_analysis as analysis
from app.aerena_models import AerenaLeague
from app.aerena_service import save_heroes, save_league, save_match, save_series
from app.db import Base
from app.intel_cache import IntelSnapshot, save_snapshot, snapshot_key
from app.models import utcnow
from test_aerena import (
    league as aerena_league,
    match as aerena_match,
    series as aerena_series,
)


def schedule_match(mid, left="Alpha", right="Bravo", score1=2, score2=1):
    return {
        "match_id": mid,
        "team1": {"name": left},
        "team2": {"name": right},
        "score1": score1,
        "score2": score2,
        "status": "finished",
        "start_at": "2026-09-01T10:00:00Z",
    }


def schedule():
    return {
        "weeks": [
            {
                "week": 1,
                "days": [
                    {
                        "label": "Day 1",
                        "matches": [
                            schedule_match("1"),
                            schedule_match("1"),
                            schedule_match("2", "Charlie", "Delta", 2, 0),
                            schedule_match(None, "Unknown", "Team", None, None),
                        ],
                    }
                ],
            },
            {"week": 2, "days": [{"label": "Day 2", "matches": [schedule_match("3")]}]},
        ]
    }


def game(number, heroes, *, missing=False):
    players = [
        {
            "name": f"player-{n}",
            "hero": {"name": name},
            "kills": n,
            "deaths": 0,
            "assists": 2,
            "private_extra": "NOT_IN_AI_CONTEXT",
        }
        for n, name in enumerate(heroes)
    ]
    if missing:
        players.pop()
    return {
        "number": number,
        "duration": "12:05",
        "teams": [
            {"team": {"name": "Alpha"}, "winner": True, "players": players[:5]},
            {"team": {"name": "Bravo"}, "winner": False, "players": players[5:]},
        ],
    }


def detail(mid, games):
    return {"match_id": str(mid), "games": games, "secret": "NEVER_IN_AI_CONTEXT"}


BASE = [
    "Alice",
    "Balmond",
    "Cecilion",
    "Diggie",
    "Edith",
    "Fanny",
    "Grock",
    "Hanabi",
    "Irithel",
    "Joy",
]
OTHER = [
    "Alice",
    "Kagura",
    "Lancelot",
    "Miya",
    "Nana",
    "Odette",
    "Paquito",
    "Ruby",
    "Saber",
    "Tigreal",
]
THIRD = [
    "Balmond",
    "Uranus",
    "Vale",
    "Wanwan",
    "Xavier",
    "Yve",
    "Zhask",
    "Aamon",
    "Baxia",
    "Claude",
]


class SourceAnalysisTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine, autoflush=False)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def upstream(self, path, query):
        self.assertEqual(query, "")
        rows = {
            "esports/id/schedule": schedule(),
            "esports/id/matches/1": detail(
                1, [game(1, BASE), game(2, OTHER), game(3, THIRD)]
            ),
            "esports/id/matches/2": detail(2, [game(1, BASE), game(2, OTHER)]),
            "esports/id/matches/3": detail(3, [game(1, THIRD)]),
        }
        if path not in rows:
            raise AssertionError(f"unexpected fetch: {path}")
        return 200, rows[path]

    def test_week_fetches_every_game_counts_each_number_and_reuses_cache(self):
        stages = []
        with patch(
            "app.routers.intel._public_fetch", side_effect=self.upstream
        ) as fetch, patch("app.ai_esports_analysis.time.sleep"):
            facts, sources = analysis.analyze_rone(
                self.db,
                {"source": "rone", "region": "id", "mode": "week", "week": 1},
                stages.append,
            )
            self.assertEqual(fetch.call_count, 3)
            self.assertEqual(
                [row["match_id"] for row in facts["matches"]], ["1", "2", None]
            )
            self.assertEqual(
                [[g["number"] for g in row["games"]] for row in facts["matches"]],
                [[1, 2, 3], [1, 2], []],
            )
            self.assertEqual(facts["matches"][-1]["load_status"], "no_source_match_id")
            self.assertEqual(facts["coverage"]["matches_listed"], 3)
            self.assertEqual(facts["coverage"]["missing_matches"], 1)
            self.assertEqual(facts["coverage"]["duplicate_schedule_rows_removed"], 1)
            self.assertEqual(facts["coverage"]["complete_pick_games"], 5)
            self.assertEqual(
                facts["all_games"]["top_picks"][0], {"hero": "Alice", "picks": 4}
            )
            by_game = {row["game_number"]: row for row in facts["by_game_number"]}
            self.assertEqual(
                [by_game[n]["complete_picks"] for n in (1, 2, 3)], [2, 2, 1]
            )
            self.assertEqual(
                next(row for row in by_game[1]["top_picks"] if row["hero"] == "Alice")[
                    "picks"
                ],
                2,
            )
            self.assertTrue(
                all(g["bans"] is None for m in facts["matches"] for g in m["games"])
            )
            self.assertIsNone(facts["scope"]["season"])
            self.assertIn(
                "does not report a season, bans or draft order", facts["notice"]
            )
            self.assertNotIn("NOT_IN_AI_CONTEXT", json.dumps(facts))
            self.assertNotIn("NEVER_IN_AI_CONTEXT", json.dumps(facts))
            self.assertTrue(sources[0]["url"].startswith("https://arena.rone.dev/"))
            self.assertIn("loading_matches:2:2", stages)
            again, _ = analysis.analyze_rone(
                self.db, {"source": "rone", "region": "id", "mode": "week", "week": 1}
            )
            self.assertEqual(fetch.call_count, 3)
            self.assertEqual(again["all_games"], facts["all_games"])

    def test_partial_duplicate_wrong_id_and_scored_missing_games(self):
        data = detail(
            1,
            [
                game(1, BASE),
                game(2, OTHER, missing=True),
                game(3, THIRD),
                game(3, THIRD),
            ],
        )
        games, ambiguous = analysis._rone_games(data)
        self.assertEqual(ambiguous, 2)
        self.assertEqual([item["number"] for item in games], [1, 2])
        self.assertFalse(games[1]["complete_picks"])
        result = analysis.aggregate(
            [{"games": games, "ambiguous_games": ambiguous, "missing_scored_games": 1}],
            source="Rone",
            scope={"week": 1},
        )
        self.assertEqual(result["coverage"]["complete_pick_games"], 1)
        self.assertEqual(result["coverage"]["partial_pick_games"], 1)
        self.assertEqual(result["coverage"]["missing_scored_games"], 1)
        self.assertEqual(result["coverage"]["ambiguous_or_omitted_games"], 2)
        self.assertFalse(analysis._valid_detail(data, "2"))
        conflicting = schedule()
        conflicting["weeks"][1]["days"][0]["matches"].append(schedule_match("1"))
        week_one, _ = analysis.rone_schedule_rows(conflicting, "id", 1)
        week_two, _ = analysis.rone_schedule_rows(conflicting, "id", 2)
        self.assertTrue(any(row.get("id_conflict") for row in week_one))
        self.assertTrue(any(row.get("id_conflict") for row in week_two))
        self.assertFalse(any(row["id"] == "1" for row in week_one + week_two))
        aerena_games, aerena_ambiguous = analysis._aerena_games(
            {"games": [{"number": 1}, {"number": 1}, {"number": 2}, None]}
        )
        self.assertEqual([item["number"] for item in aerena_games], [2])
        self.assertEqual(aerena_ambiguous, 3)
        with_missing_hero = game(4, BASE)
        with_missing_hero["teams"][0]["players"][0]["hero"] = None
        projected, _ = analysis._rone_games(detail(1, [with_missing_hero]))
        self.assertFalse(projected[0]["complete_picks"])
        projected, _ = analysis._rone_games(detail(1, [game(1, BASE[:-1] + [BASE[0]])]))
        self.assertFalse(projected[0]["complete_picks"])

    def test_unavailable_cooldown_and_stale_data_retained(self):
        path = "esports/id/matches/1"
        valid = lambda value: analysis._valid_detail(value, "1")
        with patch(
            "app.routers.intel._public_fetch", side_effect=HTTPException(502, "offline")
        ) as fetch:
            self.assertEqual(
                analysis.load_rone(self.db, path, valid, ttl=analysis.DETAIL_TTL),
                (None, None, "unavailable"),
            )
            analysis.load_rone(self.db, path, valid, ttl=analysis.DETAIL_TTL)
            self.assertEqual(fetch.call_count, 1)
        row = save_snapshot(self.db, "public", path, "", detail(1, [game(1, BASE)]))
        row.observed_at = utcnow() - timedelta(days=2)
        lease = self.db.get(
            analysis.PublicLoadLease, analysis.hashlib.sha256(path.encode()).hexdigest()
        )
        lease.attempted_at = utcnow() - timedelta(minutes=5)
        self.db.commit()
        with patch(
            "app.routers.intel._public_fetch", return_value=(503, {"code": 503})
        ):
            payload, observed, state = analysis.load_rone(
                self.db, path, valid, ttl=analysis.DETAIL_TTL
            )
        self.assertEqual(state, "saved_stale")
        self.assertEqual(len(payload["games"]), 1)
        self.assertLess(observed, utcnow() - timedelta(days=1))
        self.assertEqual(
            json.loads(
                self.db.get(IntelSnapshot, snapshot_key("public", path)).payload_json
            )["match_id"],
            "1",
        )

    def test_only_schedule_ids_loaded_and_historical_season_never_guessed(self):
        with patch(
            "app.routers.intel._public_fetch", side_effect=self.upstream
        ) as fetch, patch("app.ai_esports_analysis.time.sleep"):
            facts, _ = analysis.analyze_rone(
                self.db,
                {
                    "source": "rone",
                    "region": "id",
                    "mode": "matches",
                    "match_ids": ["1", "999"],
                },
            )
            self.assertEqual([item["match_id"] for item in facts["matches"]], ["1"])
            self.assertEqual(facts["coverage"]["missing_matches"], 1)
            self.assertFalse(
                any("999" in call.args[0] for call in fetch.call_args_list)
            )
            before = fetch.call_count
            facts, sources = analysis.analyze_rone(
                self.db,
                {
                    "source": "rone",
                    "region": "id",
                    "mode": "week",
                    "week": 1,
                    "season_requested": True,
                },
            )
            self.assertEqual(fetch.call_count, before)
            self.assertEqual(sources, [])
            self.assertIn("cannot be verified", facts["notice"])
        self.assertEqual(
            analysis.requested_scope("Using Rone MPL ID, analyze all week 1 matches")[
                "week"
            ],
            1,
        )
        self.assertEqual(
            analysis.requested_scope("MPL PH week three picks")["region"], "ph"
        )
        self.assertTrue(
            analysis.requested_scope("Rone MPL ID S15 week 1")["season_requested"]
        )
        self.assertEqual(
            analysis.requested_scope("https://arena.rone.dev/api MPL ID week 1")[
                "source"
            ],
            "rone",
        )
        self.assertIn(
            "one source and one week",
            analysis.requested_scope("Rone MPL ID weeks 1 and 2")["selection_error"],
        )
        self.assertIn(
            "one source and one week",
            analysis.requested_scope("Rone and Aerena MPL ID week 1")[
                "selection_error"
            ],
        )
        self.assertIn(
            "Choose a specific",
            analysis.requested_scope("Aerena MPL ID week 1", self.db)[
                "selection_error"
            ],
        )
        self.assertIsNone(analysis.requested_scope("Week 1"))
        self.assertIsNone(analysis.rone_id("id", "../../private"))
        self.assertIsNone(analysis.rone_id("kh", "12"))
        self.assertTrue(analysis.rone_id("ph", "team-a-team-b-20260101"))

    def test_aerena_week_labels_and_every_saved_game(self):
        save_series(self.db, [aerena_series()])
        league = save_league(self.db, aerena_league())
        fixture = aerena_match()
        pick_ids = [
            event["hero"]
            for event in fixture["games"][0]["draft"]
            if event["type"] == "Pick"
        ]
        save_heroes(
            self.db,
            [
                {"_id": hid, "heroName": f"Hero {index}"}
                for index, hid in enumerate(pick_ids)
            ],
        )
        fixture["games"] = [
            dict(fixture["games"][0], _id=f"game-{number}", gameNumber=number)
            for number in (1, 2, 3)
        ]
        saved = save_match(self.db, fixture, league)
        self.db.commit()
        self.assertEqual(analysis.aerena_week(saved), 1)
        facts, _ = analysis.analyze_aerena(self.db, [saved.id])
        self.assertEqual(facts["coverage"]["complete_pick_games"], 3)
        self.assertEqual(
            [item["game_number"] for item in facts["by_game_number"]], [1, 2, 3]
        )
        self.assertEqual(facts["all_games"]["top_picks"][0]["picks"], 3)
        self.assertEqual(len(facts["matches"][0]["games"]), 3)
        saved.stage = "Week 2"
        self.db.commit()
        self.assertIsNone(analysis.aerena_week(saved))
        saved.id = "generic-identifier"
        saved.stage = "Regular Season"
        saved.raw_json = "{}"
        self.assertIsNone(analysis.aerena_week(saved))

    def test_missing_aerena_detail_waits_for_a_peer_fetch(self):
        import copy

        save_series(self.db, [aerena_series()])
        league = save_league(self.db, aerena_league())
        complete = aerena_match()
        picks = [
            event["hero"]
            for event in complete["games"][0]["draft"]
            if event["type"] == "Pick"
        ]
        save_heroes(
            self.db,
            [{"_id": hid, "heroName": f"Hero {i}"} for i, hid in enumerate(picks)],
        )
        partial = copy.deepcopy(complete)
        partial["games"][0]["draft"] = []
        row = save_match(self.db, partial, league)
        row.detail_attempted_at = utcnow()
        self.db.commit()

        def peer_finishes(_):
            with Session(self.engine, autoflush=False) as peer:
                updated = save_match(peer, complete, peer.get(AerenaLeague, league.id))
                updated.detail_fetched_at = utcnow() + timedelta(seconds=1)
                updated.detail_error = ""
                peer.commit()

        with patch("app.routers.esports.ENABLED", True), patch(
            "app.routers.esports._claim_detail_refresh", return_value=None
        ), patch(
            "app.ai_esports_analysis.time.sleep", side_effect=peer_finishes
        ) as wait:
            facts, _ = analysis.analyze_aerena(self.db, [row.id])
        wait.assert_called_once()
        self.assertEqual(facts["coverage"]["complete_pick_games"], 1)
        self.assertEqual(len(facts["all_games"]["top_picks"]), 10)

    def test_bounded_scan_and_compaction_disclose_omitted_ties(self):
        malformed = schedule()
        malformed["weeks"][0]["days"] = [None]
        self.assertFalse(analysis._valid_schedule(malformed))
        huge = [
            {
                "match_id": str(i),
                "games": [
                    {
                        "number": n,
                        "complete_picks": True,
                        "picks": [f"hero-{i}-{n}-{x}-" + "x" * 60 for x in range(10)],
                        "teams": [
                            {"team": "X" * 80, "players": [{"name": "P" * 60}] * 5}
                        ]
                        * 2,
                    }
                    for n in range(1, 31)
                ],
                "ambiguous_games": 0,
            }
            for i in range(24)
        ]
        facts = analysis.aggregate(huge, source="Rone", scope={"week": 1})
        self.assertEqual(facts["coverage"]["complete_pick_games"], 720)
        self.assertIn("compacted", facts["notice"])
        self.assertGreater(facts["all_games"].get("tied_leaders_omitted", 0), 0)
        self.assertLess(len(json.dumps(facts)), 120_000)

    def test_near_500_matches_keep_exact_all_game_counts_and_honest_coverage(self):
        from datetime import datetime

        synthetic = {
            "weeks": [
                {
                    "week": 1,
                    "days": [
                        {
                            "matches": [
                                schedule_match(str(i)) for i in range(start, start + 50)
                            ]
                        }
                        for start in range(1, 501, 50)
                    ],
                }
            ]
        }
        self.assertTrue(analysis._valid_schedule(synthetic))
        stages = []

        def fake_load(db, path, validate, **kwargs):
            mid = path.rsplit("/", 1)[-1]
            games = [game(1, BASE), game(2, BASE, missing=mid == "500")]
            if mid != "500":
                games.append(game(3, BASE))
            payload = detail(mid, games)
            self.assertTrue(validate(payload))
            return payload, datetime(2026, 1, 1), "saved"

        with patch.object(
            analysis,
            "rone_schedule",
            return_value=(synthetic, datetime(2026, 1, 1), "saved"),
        ), patch.object(analysis, "_saved", return_value=(None, None)), patch.object(
            analysis, "load_rone", side_effect=fake_load
        ):
            facts, sources = analysis.analyze_rone(
                self.db,
                {"source": "rone", "mode": "week", "region": "id", "week": 1},
                stages.append,
            )
        self.assertEqual(facts["coverage"]["matches_listed"], 500)
        self.assertEqual(facts["coverage"]["complete_pick_games"], 1498)
        self.assertEqual(facts["coverage"]["partial_pick_games"], 1)
        self.assertEqual(facts["coverage"]["missing_scored_games"], 1)
        self.assertEqual(
            next(r for r in facts["all_games"]["top_picks"] if r["hero"] == "Alice")[
                "picks"
            ],
            1498,
        )
        self.assertEqual(
            next(r for r in facts["by_game_number"] if r["game_number"] == 2)[
                "complete_picks"
            ],
            499,
        )
        self.assertEqual(facts["coverage"]["match_detail_cards_omitted"], 425)
        self.assertIn("all complete games", facts["notice"])
        self.assertIn("loading_matches:500:500", stages)
        self.assertLess(len(json.dumps(facts)), 120_000)
        chart = analysis.pick_chart(facts, "most picked in game 2")
        self.assertEqual(chart["complete_games"], 499)
        self.assertTrue(chart["incomplete_data"])
        self.assertEqual(chart["bars"][0]["value"], 499)
        self.assertTrue(sources)

    def test_loading_deadline_reports_unfetched_matches_without_claiming_full_coverage(
        self,
    ):
        from datetime import datetime
        from types import SimpleNamespace

        source = {
            "weeks": [
                {
                    "week": 1,
                    "days": [
                        {
                            "matches": [
                                schedule_match(str(n), score1=1, score2=0)
                                for n in range(1, 4)
                            ]
                        }
                    ],
                }
            ]
        }
        calls = []
        ticks = iter([0, 0, 901, 901, 901, 901, 901])
        clock = SimpleNamespace(
            monotonic=lambda: next(ticks, 901), sleep=lambda _n: None
        )

        def fake_load(db, path, validate, **kwargs):
            mid = path.rsplit("/", 1)[-1]
            calls.append(mid)
            return detail(mid, [game(1, BASE)]), datetime(2026, 1, 1), "loaded"

        with patch.object(analysis, "time", clock), patch.object(
            analysis,
            "rone_schedule",
            return_value=(source, datetime(2026, 1, 1), "saved"),
        ), patch.object(analysis, "_saved", return_value=(None, None)), patch.object(
            analysis, "load_rone", side_effect=fake_load
        ):
            facts, _ = analysis.analyze_rone(
                self.db, {"source": "rone", "mode": "week", "region": "id", "week": 1}
            )
        self.assertEqual(calls, ["1"])
        self.assertEqual(facts["coverage"]["complete_pick_games"], 1)
        self.assertEqual(facts["coverage"]["missing_matches"], 2)
        self.assertIn("loading time limit was reached", facts["notice"])

    def test_aerena_500_matches_keep_counts_and_bounded_citations(self):
        from types import SimpleNamespace

        class FakeDB:
            def get(self, _model, mid):
                return SimpleNamespace(
                    id=mid, stage="Week 1", raw_json="{}", has_result=False
                )

        def detail_for(_db, row):
            return {
                "match": {
                    "id": row.id,
                    "team1": {"teamName": "Alpha", "teamScore": 1},
                    "team2": {"teamName": "Bravo", "teamScore": 0},
                },
                "games": [
                    {
                        "number": 1,
                        "draft": [{"kind": "Pick", "hero_name": hero} for hero in BASE],
                        "player_stats": [{"ign": "not needed", "hero_name": "Alice"}],
                    }
                ],
            }

        ids = [f"match-{n}" for n in range(500)]
        with patch("app.routers.esports.detail_for", side_effect=detail_for):
            facts, sources = analysis.analyze_aerena(FakeDB(), ids, load_missing=False)
        self.assertEqual(facts["coverage"]["complete_pick_games"], 500)
        self.assertTrue(
            all(row["picks"] == 500 for row in facts["all_games"]["top_picks"])
        )
        self.assertEqual(len(sources), 51)
        self.assertIn("450 more selected matches included", sources[-1]["label"])
        self.assertNotIn("not needed", json.dumps(facts))
        self.assertIn("Player detail was omitted", facts["notice"])

    def test_selection_accepts_500_unique_ids_but_rejects_larger_payloads(self):
        from pydantic import ValidationError
        from app.routers.clover_ai import EsportsSelectionIn

        selected = {
            "source": "rone",
            "mode": "matches",
            "region": "id",
            "match_ids": [str(i) for i in range(1, 501)],
        }
        self.assertEqual(
            len(EsportsSelectionIn.model_validate(selected).match_ids), 500
        )
        with self.assertRaises(ValidationError):
            EsportsSelectionIn.model_validate(
                {**selected, "match_ids": selected["match_ids"] + ["501"]}
            )
        with self.assertRaises(ValidationError):
            EsportsSelectionIn.model_validate(
                {**selected, "match_ids": selected["match_ids"] + ["../bad"]}
            )

    def test_full_500_by_30_aggregation_has_bounded_context_and_keeps_ties(self):
        import tracemalloc

        huge = [
            {
                "match_id": str(i),
                "ambiguous_games": 0,
                "games": [
                    {
                        "number": n,
                        "complete_picks": not (i == 499 and n == 30),
                        "picks": list(BASE),
                    }
                    for n in range(1, 31)
                ],
            }
            for i in range(500)
        ]
        tracemalloc.start()
        try:
            facts = analysis.aggregate(huge, source="Rone", scope={"week": 1})
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        self.assertEqual(facts["coverage"]["complete_pick_games"], 14_999)
        self.assertEqual(facts["coverage"]["partial_pick_games"], 1)
        self.assertTrue(
            all(row["picks"] == 14_999 for row in facts["all_games"]["top_picks"])
        )
        self.assertEqual(facts["coverage"]["match_detail_cards_omitted"], 425)
        self.assertLess(len(json.dumps(facts)), 120_000)
        self.assertLess(peak, 200_000_000)

    def test_public_source_singleflight_and_global_serialization(self):
        import tempfile
        import threading
        import time
        from pathlib import Path
        from sqlalchemy.orm import sessionmaker

        with tempfile.TemporaryDirectory() as directory:
            engine = create_engine(
                f"sqlite:///{Path(directory) / 'fixtures.sqlite'}",
                connect_args={"check_same_thread": False},
            )
            Base.metadata.create_all(engine)
            factory = sessionmaker(bind=engine, autoflush=False)
            entered = threading.Event()
            release = threading.Event()
            lock = threading.Lock()
            active = 0
            peak = 0
            calls = []

            def fetch(path, query):
                nonlocal active, peak
                with lock:
                    calls.append(path)
                    active += 1
                    peak = max(peak, active)
                entered.set()
                release.wait(3)
                with lock:
                    active -= 1
                mid = path.rsplit("/", 1)[-1]
                return 200, detail(mid, [game(1, BASE)])

            def load(mid):
                with factory() as db:
                    return analysis.load_rone(
                        db,
                        f"esports/id/matches/{mid}",
                        lambda value: analysis._valid_detail(value, mid),
                        ttl=analysis.DETAIL_TTL,
                    )

            results = []
            with patch("app.routers.intel._public_fetch", side_effect=fetch):
                first = threading.Thread(target=lambda: results.append(load("101")))
                second = threading.Thread(target=lambda: results.append(load("102")))
                first.start()
                self.assertTrue(entered.wait(3))
                second.start()
                time.sleep(0.15)
                release.set()
                first.join(5)
                second.join(5)
            self.assertFalse(first.is_alive() or second.is_alive())
            self.assertEqual(peak, 1)
            self.assertEqual(len(calls), 2)
            self.assertEqual(len(results), 2)
            engine.dispose()

    def test_member_requested_missing_aerena_season_waits_on_the_existing_worker(self):
        save_series(self.db, [aerena_series()])
        league = save_league(self.db, aerena_league())
        self.db.commit()

        def finish(db, league_id):
            row = db.get(type(league), league_id)
            row.matches_fetched_at = utcnow()
            db.commit()

        with patch("app.aerena_service.ENABLED", True), patch(
            "app.aerena_service.request_refresh", side_effect=finish
        ) as queue:
            loaded, status = analysis.ensure_aerena_season(self.db, league.id)
        self.assertTrue(loaded)
        self.assertEqual(status, "loaded")
        queue.assert_called_once()
        with patch(
            "app.aerena_service.request_refresh",
            side_effect=AssertionError("fresh season must use saved data"),
        ):
            self.assertEqual(
                analysis.ensure_aerena_season(self.db, league.id), (True, "saved")
            )


# Exercise the same owner-scoped AI send pipeline used by normal chat and Think.
from types import SimpleNamespace
import asyncio
import io
import test_clover_ai as chat_fixture
from test_ai_thinking import choice, sse, stream_request


class ChatIntegrationTests(unittest.TestCase):
    setUp = chat_fixture.CloverAITests.setUp
    tearDown = chat_fixture.CloverAITests.tearDown
    req = chat_fixture.CloverAITests.req
    new_chat = chat_fixture.CloverAITests.new_chat
    upstream = SourceAnalysisTests.upstream

    def test_rone_week_selection_and_followup_use_exact_all_game_counts(self):
        chat = self.new_chat()
        captured = []

        def provider(req, timeout):
            captured.append(json.loads(req.data))
            return io.BytesIO(
                b'{"choices":[{"message":{"content":"Synthetic analysis."}}]}'
            )

        selection = {"source": "rone", "mode": "week", "region": "id", "week": 1}
        with patch(
            "app.routers.intel._public_fetch", side_effect=self.upstream
        ) as fetch, patch("app.ai_esports_analysis.time.sleep"), patch.dict(
            os.environ, {"DEEPSEEK_API_KEY": "synthetic"}
        ), patch(
            "app.clover_ai_service.urllib.request.build_opener",
            return_value=SimpleNamespace(open=provider),
        ):
            status, result, _ = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={
                    "text": "Most picked in game 2?",
                    "esports_selection": selection,
                    "web_mode": "off",
                },
            )
            self.assertEqual(status, 201)
            context = json.loads(captured[-1]["messages"][-1]["content"])[
                "available_context"
            ]
            stats = context["match_pick_analysis"]
            self.assertEqual(stats["all_games"]["complete_pick_games"], 5)
            self.assertEqual(stats["by_game_number"][1]["game_number"], 2)
            self.assertEqual(stats["by_game_number"][1]["top_picks"][0]["picks"], 2)
            self.assertEqual(stats["coverage"]["missing_matches"], 1)
            self.assertIn("esports_selection", result["user_message"]["sources"][0])
            self.assertTrue(
                any(
                    item["label"].startswith("Rone MPL ID")
                    for item in result["assistant_message"]["sources"]
                )
            )
            self.assertFalse(
                any("Most picked" in call.args[0] for call in fetch.call_args_list)
            )
            self.assertEqual(fetch.call_count, 3)
            follow, _, _ = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={"text": "What about game 3?", "web_mode": "off"},
            )
            self.assertEqual(follow, 201)
            again = json.loads(captured[-1]["messages"][-1]["content"])[
                "available_context"
            ]["match_pick_analysis"]
            self.assertEqual(again["scope"]["week"], 1)
            self.assertEqual(again["by_game_number"][2]["game_number"], 3)
            self.assertEqual(fetch.call_count, 3)
        self.assertEqual(
            self.req("GET", f"/conversations/{chat}/messages", who="other")[0], 404
        )
        self.assertEqual(
            self.req("GET", f"/conversations/{chat}/messages", who="admin")[0], 404
        )

    def test_direct_request_works_without_attachment_and_refuses_unidentified_historical_season(
        self,
    ):
        chat = self.new_chat()
        with patch(
            "app.routers.intel._public_fetch", side_effect=self.upstream
        ) as fetch, patch("app.ai_esports_analysis.time.sleep"):
            status, result, _ = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={
                    "text": "Using Rone MPL ID, most picked heroes in week 1 game 3?",
                    "web_mode": "off",
                },
            )
            self.assertEqual(status, 201)
            content = result["assistant_message"]["content"]
            self.assertIn("Game 3", content)
            self.assertIn("All games", content)
            self.assertIn("5 complete games", content)
            self.assertEqual(fetch.call_count, 3)
            second = self.new_chat()
            status, result, _ = self.req(
                "POST",
                f"/conversations/{second}/messages",
                payload={
                    "text": "Rone MPL ID season 15 week 1 most picked heroes",
                    "web_mode": "off",
                },
            )
            self.assertEqual(status, 201)
            self.assertIn("cannot be verified", result["assistant_message"]["content"])
            self.assertEqual(fetch.call_count, 3)

    def test_scoped_picker_routes_validation_and_privacy(self):
        self.assertEqual(
            chat_fixture.request("GET", "/api/ai/esports/rone/id/schedule")[0], 401
        )
        with patch("app.routers.intel._public_fetch", side_effect=self.upstream):
            status, data, _ = self.req("GET", "/esports/rone/id/schedule")
        self.assertEqual(status, 200)
        self.assertEqual(data["weeks"], [1, 2])
        self.assertEqual(data["duplicate_rows_removed"], 1)
        self.assertIsNone(data["season"])
        chat = self.new_chat()
        for scope in [
            {"source": "rone", "mode": "week", "region": "id", "week": 0},
            {
                "source": "rone",
                "mode": "matches",
                "region": "id",
                "match_ids": ["../bad"],
            },
            {
                "source": "rone",
                "mode": "matches",
                "region": "id",
                "match_ids": ["1", "1"],
            },
            {"source": "aerena", "mode": "week", "week": 1},
        ]:
            self.assertEqual(
                self.req(
                    "POST",
                    f"/conversations/{chat}/messages",
                    payload={"text": "x", "esports_selection": scope},
                )[0],
                422,
            )
        self.assertEqual(
            self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={
                    "text": "x",
                    "match_ids": ["a"],
                    "esports_selection": {
                        "source": "rone",
                        "mode": "week",
                        "region": "id",
                        "week": 1,
                    },
                },
            )[0],
            422,
        )

    def test_aerena_week_filter_and_think_stream_share_the_same_deterministic_scope(
        self,
    ):
        with self.factory() as db:
            save_series(db, [aerena_series()])
            league = save_league(db, aerena_league())
            fixture = aerena_match()
            pick_ids = [
                event["hero"]
                for event in fixture["games"][0]["draft"]
                if event["type"] == "Pick"
            ]
            save_heroes(
                db,
                [
                    {"_id": hid, "heroName": f"Hero {i}"}
                    for i, hid in enumerate(pick_ids)
                ],
            )
            fixture["games"] = [
                dict(fixture["games"][0], _id=f"think-game-{n}", gameNumber=n)
                for n in (1, 2, 3)
            ]
            save_match(db, fixture, league)
            league.matches_fetched_at = utcnow()
            db.commit()
            league_id = league.id
        status, response, _ = self.req(
            "GET", f"/esports/aerena/{league_id}/matches?week=1"
        )
        self.assertEqual(status, 200)
        self.assertEqual(response["total"], 1)
        self.assertEqual(response["weeks"], [{"number": 1, "matches": 1}])
        self.assertEqual(response["matches"][0]["week"], 1)
        direct = self.new_chat()
        status, answer, _ = self.req(
            "POST",
            f"/conversations/{direct}/messages",
            payload={
                "text": "Aerena MPL PH Season 18 week 1 most picked heroes",
                "web_mode": "off",
            },
        )
        self.assertEqual(status, 201)
        self.assertIn("3 complete games", answer["assistant_message"]["content"])
        self.assertIn("Game 3", answer["assistant_message"]["content"])
        with self.factory() as db:
            self.assertEqual(
                analysis.requested_scope("Aerena MPL PH season 18 week 1", db)[
                    "league_id"
                ],
                league_id,
            )
            self.assertEqual(
                analysis.requested_scope("MPL PH S18 week 1", db)["league_id"],
                league_id,
            )
        chat = self.new_chat()
        rejected, _, _ = self.req(
            "POST",
            f"/conversations/{chat}/messages",
            payload={
                "text": "x",
                "esports_selection": {
                    "source": "aerena",
                    "mode": "week",
                    "league_id": league_id,
                    "region": "id",
                    "week": 1,
                },
            },
        )
        self.assertEqual(rejected, 422)
        self.assertEqual(
            self.req("GET", f"/conversations/{chat}/messages")[1]["messages"], []
        )
        sent = []

        def provider(req, timeout):
            sent.append(json.loads(req.data))
            return io.BytesIO(
                sse(
                    choice({"reasoning_content": "SECRET_INTERNAL_THOUGHT"}),
                    choice({"content": "Synthetic deep analysis."}, "stop"),
                    "[DONE]",
                )
            )

        selection = {
            "source": "aerena",
            "mode": "week",
            "league_id": league_id,
            "region": "ph",
            "week": 1,
        }
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic"}), patch(
            "app.clover_ai_service.urllib.request.build_opener",
            return_value=SimpleNamespace(open=provider),
        ):
            status, content, _ = asyncio.run(
                stream_request(
                    f"/api/ai/conversations/{chat}/messages/stream",
                    self.tokens["owner"],
                    {
                        "text": "Compare picks in games 1, 2, and 3",
                        "think": True,
                        "esports_selection": selection,
                        "web_mode": "off",
                    },
                )
            )
        self.assertEqual(status, 200)
        self.assertIn("loading_matches:1:1", content)
        self.assertIn('"stage": "thinking"', content)
        self.assertNotIn("SECRET_INTERNAL_THOUGHT", content)
        context = json.loads(sent[-1]["messages"][-1]["content"])["available_context"][
            "match_pick_analysis"
        ]
        self.assertEqual(context["coverage"]["complete_pick_games"], 3)
        self.assertEqual(
            [b["game_number"] for b in context["by_game_number"]], [1, 2, 3]
        )


if __name__ == "__main__":
    unittest.main()
