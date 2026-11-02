"""Read-only Aerena protocol, durable source records and analysis privacy.

The field names and selected values below are excerpts from Aerena's public
PH18-S18W1D1M1 response observed 2026-11-01. They are test fixtures only;
they are never seeded into the product database.
"""
from __future__ import annotations

import io
import json
import os
import sys
import unittest
from pathlib import Path
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

os.environ["CLOVER_AERENA_ENABLED"] = "0"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402

from app.aerena_client import AerenaClient, AerenaError, REQUIRED_ACTIONS, parse_flight  # noqa: E402
from app.aerena_models import (AerenaAIUsage, AerenaDraftEvent, AerenaGame, AerenaMatch, AerenaSyncState,
                               AerenaPlayerGameStat, AerenaSnapshot)  # noqa: E402
from app.aerena_service import STANDARD_SEQUENCE, refresh, save_heroes, save_league, save_match, save_match_detail, save_series  # noqa: E402
from app.db import Base  # noqa: E402
from app.models import utcnow  # noqa: E402
from app.esports_ai import MAX_CONTEXT_CHARS, ask, ask_scene, scene_evidence  # noqa: E402
from app.routers.esports import RefreshIn, _safe_logo, _team, detail_for, get_catalog, list_matches, refresh_feed  # noqa: E402

SERIES_ID = "68a4455a982458382c28690d"
LEAGUE_ID = "6a6f9d5444dc21b63b18a041"
MATCH_ID = "PH18-S18W1D1M1"
MATCH_SOURCE_ID = "6aa37979816a72029df7aa90"
GAME_ID = "6addfb424e65e6fea7426ccf"
ALICE_ID = "6877446e48e2c33fba3105e6"


def series():
    return {"_id": SERIES_ID, "seriesCode": "MPL PH", "seriesName": "MPL Philippines", "regionCode": "PH"}


def league():
    return {"_id": LEAGUE_ID, "series": SERIES_ID, "leagueCode": "MPL PH S18", "leagueName": "MPL Philippines Season 18",
            "regionCode": "PH", "startDate": "2026-08-20T16:00:00.000Z", "endDate": None, "isPro": True,
            "stages": [{"order": 1, "stage": "Regular Season"}], "draftSequence": STANDARD_SEQUENCE,
            "updatedAt": "2026-10-30T00:00:00.000Z"}


def match():
    bans = ["68774f5248e2c33fba31070d", "6877470048e2c33fba310640", "6877467748e2c33fba310627",
            "6877512348e2c33fba3107a3", "69f1b9a8794458c796181eef", "687748a348e2c33fba3106f9",
            "6877466648e2c33fba31061d", "6877509a48e2c33fba310780", "68774f3048e2c33fba310708", "687751c148e2c33fba3107f8"]
    picks = ["6a436608d1385863aaf080ed", "6877516348e2c33fba3107c1", "687751f548e2c33fba31080c",
             "68774f9048e2c33fba310730", "68774f6348e2c33fba310717", "6877524548e2c33fba310834",
             "6877522948e2c33fba310825", "6877465b48e2c33fba310618", ALICE_ID, "6877518348e2c33fba3107d0"]
    draft = ([{"hero": hid, "type": "Ban", "order": n + 1} for n, hid in enumerate(bans)] +
             [{"hero": hid, "type": "Pick", "order": n + 1, "playerIGN": "NATHZZ" if n == 8 else None} for n, hid in enumerate(picks)])
    t1 = {"team": "68a56be112067d1c730c9629", "teamCode": "RORA", "teamName": "Aurora Gaming PH",
          "teamScore": 0, "teamKills": 3, "teamTurtles": 0, "teamLords": 0}
    t2 = {"team": "68a53d6269cbd723b87b38fe", "teamCode": "ONIC PH", "teamName": "ONIC Philippines",
          "teamScore": 2, "teamKills": 25, "teamTurtles": 6, "teamLords": 3}
    return {"_id": MATCH_SOURCE_ID, "matchId": MATCH_ID, "league": {"league": LEAGUE_ID, "leagueCode": "MPL PH S18"},
            "matchDate": "2026-08-21T09:00:00.000Z", "stage": "Regular Season", "format": "BO3", "team1": t1, "team2": t2,
            "matchWinner": {"team": t2["team"], "teamName": t2["teamName"], "teamCode": t2["teamCode"]},
            "isVerified": False, "isDraw": False, "updatedAt": "2026-10-30T00:00:00.000Z",
            "games": [{"_id": GAME_ID, "gameNumber": 1, "gameLength": 847, "team1": {**t1, "side": "Blue"},
                       "team2": {**t2, "side": "Red"}, "gameWinner": {"team": t2["team"]}, "draft": draft}]}


class FlightTests(unittest.TestCase):
    def test_real_flight_shape_and_references(self):
        self.assertEqual(parse_flight(b'0:{"a":"$@1","f":"","b":"build"}\n1:[{"league":"$2","price":"$$ok"}]\n2:"MPL PH"\n'),
                         [{"league": "MPL PH", "price": "$ok"}])
        for raw in (b'garbage', b'0:{"a":"$@1"}\n1:E{"digest":"bad"}\n', b'0:{"a":"$@1"}\n1:"$2"\n'):
            with self.subTest(raw=raw), self.assertRaises(AerenaError):
                parse_flight(raw)

    def test_inline_manifest_and_adjacent_unrelated_action_are_not_confused(self):
        ids = {name: f"{i:040x}" for i, name in enumerate(sorted(REQUIRED_ACTIONS), 1)}
        bad = "f" * 40
        calls = []
        # Comma-separated minified calls contain a different action immediately
        # before a whitelisted one. Its ID must never be sent by our client.
        js = f'(0,t.createServerReference)("{bad}",t.callServer,void 0,t.findSourceMapURL,"getMembers"),' + ",".join(
            f'(0,t.createServerReference)("{value}",t.callServer,void 0,t.findSourceMapURL,"{name}")'
            for name, value in ids.items())

        def transport(url, **kwargs):
            calls.append((url, kwargs))
            if url.endswith(".js"):
                return js.encode()
            if kwargs.get("method") == "POST":
                return b'0:{"a":"$@1"}\n1:[{"_id":"abc"}]\n'
            return b'<html><script>self.__next_f.push([1,"static/chunks/renamed.js"])</script></html>'

        c = AerenaClient(transport)
        c.series()
        self.assertEqual(calls[-1][1]["headers"]["Next-Action"], ids["getSeries"])
        self.assertTrue(any(url.endswith("/_next/static/chunks/renamed.js") for url, _ in calls))
        self.assertNotEqual(calls[-1][1]["headers"]["Next-Action"], bad)

    def test_discovers_actions_and_posts_plain_args_without_credentials(self):
        ids = {name: f"{i:040x}" for i, name in enumerate(sorted(REQUIRED_ACTIONS), 1)}
        js = ";".join(f'(0,t.createServerReference)("{value}",t.callServer,void 0,t.findSourceMapURL,"{name}")'
                      for name, value in ids.items())
        calls = []

        def transport(url, **kwargs):
            calls.append((url, kwargs))
            if url.endswith(".js"):
                return js.encode()
            if kwargs.get("method") == "POST":
                return b'0:{"a":"$@1"}\n1:[{"_id":"abc","seriesCode":"MPL PH"}]\n'
            return b'<html><script src="/_next/static/chunks/5659-new.js"></script></html>'

        c = AerenaClient(transport)
        self.assertEqual(c.series()[0]["seriesCode"], "MPL PH")
        sent = calls[-1][1]
        self.assertEqual(sent["body"], b"[]")
        self.assertEqual(sent["headers"]["Next-Action"], ids["getSeries"])
        self.assertNotIn("Authorization", sent["headers"])
        self.assertNotIn("Cookie", sent["headers"])


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine, autoflush=False)
        save_series(self.db, [series()])
        save_heroes(self.db, [{"_id": ALICE_ID, "heroName": "ALICE", "roles": [], "positions": ["EXP"]}])
        self.league = save_league(self.db, league())
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_match_detail_returns_saved_data_before_background_refresh(self):
        from fastapi import BackgroundTasks
        from app.routers.esports import get_match

        save_match(self.db, match(), self.league)
        self.db.commit()
        tasks = BackgroundTasks()
        with patch("app.routers.esports.ENABLED", True), patch("app.routers.esports.client.match_stats", side_effect=OSError("offline")) as upstream:
            result = get_match(MATCH_ID, tasks, self.db, SimpleNamespace(id=1))
            self.assertTrue(result["detail_refreshing"])
            self.assertEqual(result["match"]["id"], MATCH_ID)
            self.assertEqual(upstream.call_count, 0)  # Source is not called before the saved response.
            self.assertEqual(len(tasks.tasks), 1)
            task = tasks.tasks[0]
            task.func(*task.args, **task.kwargs)
            self.db.expire_all()
            self.assertEqual(upstream.call_count, 1)
            self.assertTrue(self.db.get(AerenaMatch, MATCH_ID).detail_error)
            retry = get_match(MATCH_ID, BackgroundTasks(), self.db, SimpleNamespace(id=1))
            self.assertFalse(retry["detail_refreshing"])
            self.assertEqual(retry["match"]["id"], MATCH_ID)
            self.assertEqual(upstream.call_count, 1)  # The cooldown deduplicates failures.

    def test_real_source_order_and_snapshot_are_persisted_without_inventing(self):
        save_match(self.db, match(), self.league)
        self.db.commit()
        self.assertEqual(self.db.query(AerenaDraftEvent).count(), 20)
        data = detail_for(self.db, self.db.get(AerenaMatch, MATCH_ID))
        events = data["games"][0]["draft"]
        self.assertEqual(data["games"][0]["draft_coverage"], "complete")
        self.assertEqual([event["sequence"] for event in events], list(range(1, 21)))
        self.assertEqual([(e["kind"], e["source_order"], e["side"]) for e in events[:2]], [("Ban", 1, "Blue"), ("Ban", 2, "Red")])
        self.assertEqual(next(e for e in events if e["hero_id"] == ALICE_ID)["hero_name"], "Alice")
        self.assertFalse(data["match"]["source_verified"])
        self.assertEqual(data["games"][0]["player_stats"], [])
        count = self.db.query(AerenaSnapshot).filter_by(kind="match").count()
        save_match(self.db, match(), self.league)
        self.db.commit()
        self.assertEqual(self.db.query(AerenaSnapshot).filter_by(kind="match").count(), count)
        changed = match()
        changed["team1"]["teamKills"] = 4
        changed["updatedAt"] = "2026-10-31T00:00:00.000Z"
        save_match(self.db, changed, self.league)
        self.db.commit()
        self.assertEqual(self.db.query(AerenaSnapshot).filter_by(kind="match").count(), count + 1)

    def test_missing_partial_and_ambiguous_drafts_never_become_full_history(self):
        data = match()
        data["games"][0]["draft"] = []
        save_match(self.db, data, self.league)
        self.db.commit()
        self.assertEqual(self.db.get(AerenaGame, GAME_ID).draft_coverage, "none")
        self.assertEqual(self.db.query(AerenaDraftEvent).count(), 0)
        data["games"][0]["draft"] = match()["games"][0]["draft"][:3]
        save_match(self.db, data, self.league)
        self.db.commit()
        self.assertEqual(self.db.get(AerenaGame, GAME_ID).draft_coverage, "partial")
        self.assertTrue(all(e.sequence is None for e in self.db.query(AerenaDraftEvent).all()))
        data["games"][0]["draft"].append(data["games"][0]["draft"][0])
        save_match(self.db, data, self.league)
        self.db.commit()
        self.assertEqual(self.db.get(AerenaGame, GAME_ID).draft_coverage, "ambiguous")
        self.assertEqual(self.db.query(AerenaDraftEvent).count(), 0)
        duplicate_hero = match()
        duplicate_hero["games"][0]["draft"][1]["hero"] = duplicate_hero["games"][0]["draft"][0]["hero"]
        save_match(self.db, duplicate_hero, self.league)
        self.db.commit()
        self.assertEqual(self.db.get(AerenaGame, GAME_ID).draft_coverage, "ambiguous")
        self.assertEqual(self.db.query(AerenaDraftEvent).count(), 0)

    def test_unknown_sequence_has_no_guessed_sides_or_interleaving(self):
        self.league.draft_sequence_json = "{}"
        save_match(self.db, match(), self.league)
        self.db.commit()
        self.assertEqual(self.db.get(AerenaGame, GAME_ID).draft_coverage, "partial")
        self.assertTrue(all(e.sequence is None and e.side is None for e in self.db.query(AerenaDraftEvent).all()))

    def test_invalid_draft_keeps_the_previous_saved_events(self):
        save_match(self.db, match(), self.league)
        self.db.commit()
        invalid = match()
        invalid["games"][0]["draft"] = "not-a-draft-list"
        with self.assertRaises(AerenaError):
            save_match(self.db, invalid, self.league)
        self.db.rollback()
        self.assertEqual(self.db.query(AerenaDraftEvent).count(), 20)
        self.assertEqual(self.db.get(AerenaGame, GAME_ID).draft_coverage, "complete")

    def test_null_draft_keeps_earlier_events_and_their_observation_time(self):
        save_match(self.db, match(), self.league)
        self.db.commit()
        original = detail_for(self.db, self.db.get(AerenaMatch, MATCH_ID))["games"][0]
        omitted = match()
        omitted["updatedAt"] = "2026-10-31T00:00:00Z"
        omitted["games"][0]["draft"] = None
        save_match(self.db, omitted, self.league)
        self.db.commit()
        saved = detail_for(self.db, self.db.get(AerenaMatch, MATCH_ID))["games"][0]
        self.assertEqual(saved["draft_coverage"], "complete")
        self.assertEqual(len(saved["draft"]), 20)
        self.assertEqual(saved["draft_fetched_at"], original["draft_fetched_at"])

    def test_revised_game_id_replaces_latest_row_but_keeps_history(self):
        stat = {"_id": "stat-old", "match": MATCH_SOURCE_ID, "gameNumber": 1, "ign": "NATHZZ"}
        save_match_detail(self.db, {"match": match(), "playerGameStats": [stat]}, self.league)
        self.db.commit()
        self.assertEqual(self.db.query(AerenaPlayerGameStat).count(), 1)
        revised = match()
        revised["updatedAt"] = "2026-10-31T00:00:00Z"
        revised["games"][0]["_id"] = "replacement-game"
        save_match(self.db, revised, self.league)
        self.db.commit()
        self.assertIsNone(self.db.get(AerenaGame, GAME_ID))
        self.assertIsNotNone(self.db.get(AerenaGame, "replacement-game"))
        self.assertEqual(self.db.query(AerenaDraftEvent).count(), 20)
        self.assertEqual(self.db.query(AerenaPlayerGameStat).count(), 0)
        self.assertIsNone(self.db.get(AerenaMatch, MATCH_ID).detail_fetched_at)
        self.assertEqual(self.db.query(AerenaSnapshot).filter_by(kind="match").count(), 2)
        self.assertEqual(self.db.query(AerenaSnapshot).filter_by(kind="detail").count(), 1)

    def test_full_worker_refresh_saves_latest_season_and_provenance(self):
        old_league = {**league(), "_id": "older", "leagueCode": "MPL PH S17", "startDate": "2026-01-01T00:00:00Z"}
        tied_league = {**league(), "_id": "tie-other", "leagueCode": "MPL PH Z18"}
        calls = []

        class FakeSource:
            def series(self):
                return [series()]
            def heroes(self):
                return [{"_id": ALICE_ID, "heroName": "ALICE"}]
            def leagues(self):
                # Exercise the real compact season-index fallback.
                raise AerenaError("Aerena's response was too large to import safely.")
            def seasons(self):
                return [{"batch": [{"league": "older"}, {"league": "tie-other"}, {"league": LEAGUE_ID}]}]
            def league(self, league_id):
                return old_league if league_id == "older" else tied_league if league_id == "tie-other" else league()
            def matches(self, league_id):
                calls.append(league_id)
                return [match()] if league_id == LEAGUE_ID else []

        factory = sessionmaker(bind=self.engine, autoflush=False)
        with patch("app.aerena_service.SessionLocal", factory), patch("app.aerena_service.time.sleep"):
            self.assertTrue(refresh(upstream=FakeSource()))
        self.db.expire_all()
        self.assertEqual(calls, [LEAGUE_ID])
        self.assertEqual(get_catalog(self.db, None)["series"][0]["latest_league_id"], LEAGUE_ID)
        self.assertEqual(self.db.query(AerenaMatch).count(), 1)
        self.assertEqual(self.db.query(AerenaDraftEvent).count(), 20)
        self.assertIsNotNone(self.db.get(AerenaSyncState, 1).last_success_at)
        self.assertEqual(self.db.get(AerenaSyncState, 1).last_error, "")
        self.assertGreater(self.db.query(AerenaSnapshot).count(), 0)

    def test_older_observations_do_not_replace_newer_saved_facts(self):
        save_match(self.db, match(), self.league)
        self.db.commit()
        older = match()
        older["updatedAt"] = "2026-10-01T00:00:00Z"
        older["team1"]["teamKills"] = 999
        save_match(self.db, older, self.league)
        self.db.commit()
        self.assertEqual(detail_for(self.db, self.db.get(AerenaMatch, MATCH_ID))["match"]["team1"]["teamKills"], 3)

    def test_target_failure_rolls_back_and_does_not_poison_global_health(self):
        save_match(self.db, match(), self.league)
        self.db.add(AerenaSyncState(id=1, last_error="existing global failure"))
        self.db.commit()
        changed = match()
        changed["team1"]["teamKills"] = 999
        invalid = match()
        invalid["matchId"] = "INVALID-NEW"
        invalid["league"] = {"league": "other"}
        upstream = SimpleNamespace(matches=lambda _league: [changed, invalid])
        factory = sessionmaker(bind=self.engine, autoflush=False)
        with patch("app.aerena_service.SessionLocal", factory):
            self.assertFalse(refresh(LEAGUE_ID, upstream=upstream))
            self.db.expire_all()
            self.assertEqual(self.db.get(AerenaSyncState, 1).last_error, "existing global failure")
            self.assertTrue(self.db.get(type(self.league), LEAGUE_ID).matches_error)
            self.assertEqual(detail_for(self.db, self.db.get(AerenaMatch, MATCH_ID))["match"]["team1"]["teamKills"], 3)
            self.assertTrue(refresh(LEAGUE_ID, upstream=SimpleNamespace(matches=lambda _league: [match()])))
            self.db.expire_all()
            self.assertEqual(self.db.get(AerenaSyncState, 1).last_error, "existing global failure")
            self.assertEqual(self.db.get(type(self.league), LEAGUE_ID).matches_error, "")

    def test_untrusted_team_values_and_logo_hosts_are_sanitized(self):
        self.assertIsNone(_safe_logo("https://media.aerena.gg.evil.invalid/img.png"))
        self.assertIsNone(_safe_logo("https://username:password@media.aerena.gg/img.png"))
        self.assertIsNone(_safe_logo("javascript:alert(1)"))
        self.assertEqual(_safe_logo("https://media.aerena.gg/team.png"), "https://media.aerena.gg/team.png")
        data = _team(json.dumps({"teamCode": {"nested": "bad"}, "teamScore": "99", "teamKills": 0, "teamLogoLight": "https://evil.invalid/a.png"}))
        self.assertIsNone(data["teamCode"])
        self.assertIsNone(data["teamScore"])
        self.assertEqual(data["teamKills"], 0)
        self.assertIsNone(data["logo"])

    def test_upcoming_results_and_unknown_results_are_not_conflated(self):
        save_match(self.db, match(), self.league)
        future = match()
        future.update({"_id": "future-source", "matchId": "FUTURE-1", "matchDate": (utcnow() + timedelta(days=2)).isoformat() + "Z", "matchWinner": None, "games": []})
        past = {**future, "_id": "past-source", "matchId": "PENDING-1", "matchDate": (utcnow() - timedelta(days=2)).isoformat() + "Z"}
        save_match(self.db, future, self.league)
        save_match(self.db, past, self.league)
        self.db.commit()
        upcoming = list_matches(league_id="", series_id="", q="", view="upcoming", limit=50, db=self.db, _user=None)["matches"]
        results = list_matches(league_id="", series_id="", q="", view="results", limit=50, db=self.db, _user=None)["matches"]
        everything = list_matches(league_id="", series_id="", q="", view="all", limit=50, db=self.db, _user=None)["matches"]
        self.assertEqual([row["id"] for row in upcoming], ["FUTURE-1"])
        self.assertEqual([row["id"] for row in results], [MATCH_ID])
        self.assertEqual(next(row["status"] for row in everything if row["id"] == "PENDING-1"), "pending")

    def test_search_matches_source_team_code(self):
        data = match()
        data["team1"]["teamCode"] = "FLCN"
        data["team1"]["teamName"] = "Team Falcons"
        save_match(self.db, data, self.league)
        self.db.commit()
        rows = list_matches(league_id="", series_id="", q="FLCN", view="all", limit=50, db=self.db, _user=None)
        self.assertEqual(rows["matches"][0]["id"], MATCH_ID)

    def test_scene_analysis_is_bounded_and_uses_only_saved_public_facts(self):
        save_match(self.db, match(), self.league)
        self.db.commit()
        detail = detail_for(self.db, self.db.get(AerenaMatch, MATCH_ID))
        captured = []

        def open_request(request, timeout):
            captured.append(request)
            return io.BytesIO(json.dumps({"choices": [{"message": {"content": "Only this small sample is available."}}]}).encode())

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": ""}):
            fallback = ask_scene(self.db, 10, "What happened?", [detail])
        self.assertEqual(fallback["mode"], "facts")
        self.assertIn("small source-reported sample", fallback["answer"])
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-key"}), patch("app.esports_ai.urllib.request.build_opener", return_value=SimpleNamespace(open=open_request)), patch("app.esports_ai.DAILY_LIMIT", 1):
            response = ask_scene(self.db, 10, "What happened?", [detail])
            limited = ask(self.db, 10, "And why?", detail)
        self.assertEqual(limited["mode"], "facts")
        self.assertIn("Daily analysis limit reached", limited["note"])
        self.assertEqual(len(captured), 1)
        self.assertEqual(response["mode"], "ai")
        self.assertEqual(response["sources"][0]["match_id"], MATCH_ID)
        sent = json.loads(captured[0].data)
        self.assertIn("not a complete team or season history", sent["messages"][1]["content"])
        self.assertNotIn("test-key", json.dumps(sent))
        self.assertNotIn("Archive", sent["messages"][1]["content"])

    def test_scene_context_keeps_every_match_summary_within_budget(self):
        save_match(self.db, match(), self.league)
        self.db.commit()
        detail = detail_for(self.db, self.db.get(AerenaMatch, MATCH_ID))
        # Several long series should not push later match summaries out of context.
        sample = []
        for number in range(8):
            copy = json.loads(json.dumps(detail))
            copy["match"]["id"] = f"MATCH-{number}"
            copy["games"] = [copy["games"][0]] * 7
            sample.append(copy)
        facts = scene_evidence(sample)
        self.assertEqual(len(facts["matches"]), 8)
        self.assertEqual([row["match_id"] for row in facts["matches"]], [f"MATCH-{n}" for n in range(8)])
        self.assertLessEqual(len(json.dumps(facts, ensure_ascii=False)), MAX_CONTEXT_CHARS)
        self.assertTrue(any(row["games_omitted"] for row in facts["matches"]))
        self.assertGreater(sum(bool(row["games"]) for row in facts["matches"]), 1)

    def test_player_detail_is_optional_persisted_and_bound_to_match(self):
        stats = [{"_id": "stat1", "match": MATCH_SOURCE_ID, "gameNumber": 1, "ign": "NATHZZ",
                  "hero": ALICE_ID, "team": "68a56be112067d1c730c9629", "kills": 0, "deaths": 2, "assists": 0}]
        save_match_detail(self.db, {"match": match(), "playerGameStats": stats}, self.league)
        self.db.commit()
        self.assertEqual(self.db.query(AerenaPlayerGameStat).count(), 1)
        detail = detail_for(self.db, self.db.get(AerenaMatch, MATCH_ID))
        self.assertEqual(detail["games"][0]["player_stats"][0]["hero_name"], "Alice")
        with self.assertRaises(AerenaError):
            save_match_detail(self.db, {"match": match(), "playerGameStats": [{**stats[0], "match": "different"}]}, self.league)
        self.db.rollback()
        self.assertEqual(self.db.query(AerenaPlayerGameStat).count(), 1)

    def test_latest_season_search_and_staff_only_refresh(self):
        save_match(self.db, match(), self.league)
        self.db.commit()
        catalog = get_catalog(self.db, SimpleNamespace(role="player"))
        self.assertEqual(catalog["series"][0]["latest_league_id"], LEAGUE_ID)
        rows = list_matches(league_id=LEAGUE_ID, series_id="", q="ONIC", view="results", limit=50, db=self.db, _user=None)
        self.assertEqual(rows["matches"][0]["id"], MATCH_ID)
        with self.assertRaises(HTTPException) as error:
            refresh_feed(RefreshIn(league_id=LEAGUE_ID), self.db, SimpleNamespace(role="player"))
        self.assertEqual(error.exception.status_code, 403)

    def test_fallback_is_honest_and_no_key_is_required(self):
        save_match(self.db, match(), self.league)
        self.db.commit()
        detail = detail_for(self.db, self.db.get(AerenaMatch, MATCH_ID))
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": ""}):
            result = ask(self.db, 1, "Why did ONIC win?", detail)
        self.assertEqual(result["mode"], "facts")
        self.assertIn("3–25 kills", result["answer"])
        self.assertIn("not proof", result["answer"])
        self.assertEqual(self.db.query(AerenaAIUsage).count(), 0)

    def test_provider_failure_returns_labelled_local_facts_and_counts_usage(self):
        import urllib.error
        save_match(self.db, match(), self.league)
        self.db.commit()
        detail = detail_for(self.db, self.db.get(AerenaMatch, MATCH_ID))

        def failed_request(_request, timeout):
            raise urllib.error.URLError("blocked")

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-key"}), patch("app.esports_ai.urllib.request.build_opener", return_value=SimpleNamespace(open=failed_request)):
            result = ask(self.db, 11, "Why?", detail)
        self.assertEqual(result["mode"], "facts")
        self.assertIn("could not complete", result["note"])
        self.assertIn("not an AI answer", result["note"])
        self.assertNotIn("test-key", json.dumps(result))
        self.assertEqual(self.db.query(AerenaAIUsage).one().calls, 1)

    def test_deepseek_sends_only_public_evidence_and_enforces_daily_quota(self):
        save_match(self.db, match(), self.league)
        self.db.commit()
        detail = detail_for(self.db, self.db.get(AerenaMatch, MATCH_ID))
        captured = []

        def urlopen(request, timeout):
            captured.append(request)
            return io.BytesIO(json.dumps({"choices": [{"message": {"content": "Recorded: ONIC won. The reason is uncertain."}}]}).encode())

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-key"}), patch("app.esports_ai.urllib.request.build_opener", return_value=SimpleNamespace(open=urlopen)), patch("app.esports_ai.DAILY_LIMIT", 1):
            result = ask(self.db, 5, "Why?", detail)
            limited = ask(self.db, 5, "Again?", detail)
        self.assertEqual(limited["mode"], "facts")
        self.assertIn("Daily analysis limit reached", limited["note"])
        self.assertEqual(len(captured), 1)
        sent = json.loads(captured[0].data)
        self.assertEqual(result["mode"], "ai")
        self.assertNotIn("test-key", json.dumps(sent))
        self.assertNotIn("Archive", sent["messages"][1]["content"])
        self.assertIn(MATCH_ID, sent["messages"][1]["content"])
        self.assertEqual(self.db.query(AerenaAIUsage).one().calls, 1)


if __name__ == "__main__":
    unittest.main()
