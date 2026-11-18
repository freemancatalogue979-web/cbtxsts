"""Daily hero sync from Rone: isolated SQLite, fixture payloads, no network."""

from __future__ import annotations

import unittest
from datetime import timedelta
from unittest.mock import patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import hero_sync
from app.db import Base
from app.hero_sync import HeroSyncError, HeroSyncState, merge, parse_positions, parse_rates, run_once
from app.models import Hero, dumps, loads, utcnow
from tests import test_clover_ai as fixture


def lane(lane_id, title):
    return {"caption": title, "data": {"road_sort_id": str(lane_id), "road_sort_title": title}}


def klass(sort_id, title):
    return {"caption": title, "data": {"sort_id": sort_id, "sort_title": title}}


def position(hero_id, name, lanes=(), classes=(), strong=(), weak=(), assist=()):
    return {"data": {"hero_id": hero_id, "hero": {"data": {"name": name, "roadsort": list(lanes), "sortid": list(classes)}},
                     "relation": {"strong": {"target_hero_id": list(strong)}, "weak": {"target_hero_id": list(weak)},
                                  "assist": {"target_hero_id": list(assist)}}}}


def rank(hero_id, name, win, pick, ban):
    return {"data": {"main_heroid": hero_id, "main_hero": {"data": {"name": name}},
                     "main_hero_win_rate": win, "main_hero_appearance_rate": pick, "main_hero_ban_rate": ban}}


def envelope(rows):
    return {"code": 0, "message": "OK", "data": {"records": rows, "total": len(rows)}}


FILLER = [position(1000 + i, f"Filler {i}", [lane(1, "Exp Lane")], [klass(2, "Fighter")]) for i in range(25)]
POSITIONS = envelope([
    position(1, "X.Borg", [lane(1, "Exp Lane")], [klass(2, "Fighter")], strong=[2], weak=[3]),
    position(2, "Chang'e", [lane(2, "Mid Lane")], [klass(4, "Mage")]),
    position(3, "Zetian", [lane(4, "Jungle")], [klass(3, "Assassin"), klass(4, "Mage")], strong=[1], assist=[2]),
    position(4, "Marcel", [], [klass(5, "Marksman")]),
    *FILLER,
])
RANKS = envelope([rank(1, "X.Borg", 0.5321, 0.0412, 0.1),
                  rank(3, "Zetian", 0.47, 0.2, 0.6512),
                  rank(2, "Chang'e", 1.7, "x", None)])  # invalid values are ignored


class HeroSyncTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.factory = sessionmaker(bind=self.engine, autoflush=False)
        with self.factory() as db:
            db.add_all([
                Hero(name="X.Borg", role="EXP", hero_class="", win_rate=50.0, pick_rate=5.0, ban_rate=5.0, tier="S",
                     meta_status="META", clover_rating=8.5, notes="Team note: flex to jungle.",
                     strong_against=dumps(["Team pick"]), weak_against="[]"),
                Hero(name="Chang’e", role="MID", hero_class="Mage", win_rate=51.0),  # curly apostrophe
            ])
            db.commit()

    def tearDown(self):
        self.engine.dispose()

    def test_parse_reads_lanes_classes_relations_and_percent_rates(self):
        heroes = parse_positions(POSITIONS)
        self.assertEqual(heroes[3], {"name": "Zetian", "lanes": ["JUNGLE"], "classes": ["Assassin", "Mage"],
                                     "strong": [1], "weak": [], "assist": [2]})
        rates = parse_rates(RANKS)
        self.assertEqual(rates[1]["win_rate"], 53.21)
        self.assertEqual(rates[3]["ban_rate"], 65.12)
        self.assertNotIn(2, rates)
        with self.assertRaises(HeroSyncError):
            parse_positions({"code": 500, "message": "upstream error"})

    def test_new_heroes_are_added_and_rates_refresh_without_touching_team_curation(self):
        with self.factory() as db:
            result = merge(db, parse_positions(POSITIONS), parse_rates(RANKS))
            self.assertEqual(result["added_names"][:2], ["Zetian", "Marcel"])
            borg = db.scalar(select(Hero).where(Hero.name == "X.Borg"))
            # Fresh public numbers…
            self.assertEqual((borg.win_rate, borg.pick_rate, borg.ban_rate), (53.21, 4.12, 10.0))
            # …a blank class and blank counter list are filled in…
            self.assertEqual(borg.hero_class, "Fighter")
            self.assertEqual(loads(borg.weak_against), ["Zetian"])
            # …but the team's own work is untouched.
            self.assertEqual((borg.tier, borg.meta_status, borg.clover_rating, borg.role), ("S", "META", 8.5, "EXP"))
            self.assertEqual(borg.notes, "Team note: flex to jungle.")
            self.assertEqual(loads(borg.strong_against), ["Team pick"])
            # The curly-apostrophe name matched instead of being duplicated.
            self.assertEqual(db.scalar(select(Hero).where(Hero.name == "Chang'e")), None)
            zetian = db.scalar(select(Hero).where(Hero.name == "Zetian"))
            self.assertEqual((zetian.role, zetian.hero_class, zetian.ban_rate), ("JUNGLE", "Assassin/Mage", 65.12))
            self.assertEqual((loads(zetian.strong_against), loads(zetian.synergy)), (["X.Borg"], ["Chang'e"]))
            # No lane from Rone → best guess from the class, flagged in the notes.
            marcel = db.scalar(select(Hero).where(Hero.name == "Marcel"))
            self.assertEqual(marcel.role, "GOLD")
            self.assertIn("Check the lane", marcel.notes)
            # A second identical run adds nothing.
            again = merge(db, parse_positions(POSITIONS), parse_rates(RANKS))
            self.assertEqual((again["added"], again["updated"]), (0, 0))

    def test_a_truncated_list_changes_nothing(self):
        with self.factory() as db:
            with self.assertRaises(HeroSyncError):
                merge(db, parse_positions(envelope([position(9, "Lonely", [lane(5, "Gold Lane")])])), {})
            self.assertEqual(db.scalar(select(Hero).where(Hero.name == "Lonely")), None)

    def test_run_records_success_and_failure_and_honours_the_lease(self):
        payloads = {hero_sync.POSITIONS_PATH: POSITIONS, hero_sync.RANK_PATH: RANKS}
        with self.factory() as db:
            run_once(db, fetch=lambda path, query: payloads[path])
            state = hero_sync.status(db)
            self.assertEqual((state["added"], state["error"]), (27, ""))
            self.assertTrue(state["last_success_at"].endswith("Z"))
            self.assertIn("Zetian", state["added_names"])

            def offline(path, query):
                raise OSError("offline")
            with self.assertRaises(HeroSyncError):
                run_once(db, fetch=offline)
            state = hero_sync.status(db)
            self.assertIn("left as it was", state["error"])
            self.assertEqual(state["added"], 27)  # the last good numbers stay visible
            # Failures retry after a few hours instead of a full day.
            row = db.get(HeroSyncState, 1)
            self.assertFalse(hero_sync._due(row, utcnow()))
            self.assertTrue(hero_sync._due(row, utcnow() + timedelta(seconds=hero_sync.FAIL_RETRY_SECONDS + 1)))
            # Someone else holding the lease → no second run.
            row.lease_until = utcnow() + timedelta(minutes=5)
            db.commit()
            with self.assertRaises(HeroSyncError):
                run_once(db, fetch=lambda path, query: payloads[path])

    def test_rates_failure_still_lands_new_heroes(self):
        def fetch(path, query):
            if path == hero_sync.RANK_PATH:
                raise OSError("rank endpoint down")
            return POSITIONS
        with self.factory() as db:
            result = run_once(db, fetch=fetch)
            self.assertIn("Zetian", result["added_names"])


class HeroSyncRouteTests(unittest.TestCase):
    setUp = fixture.CloverAITests.setUp
    tearDown = fixture.CloverAITests.tearDown

    def test_status_is_readable_and_only_hero_managers_can_queue_a_refresh(self):
        status, body, _ = fixture.request("GET", "/api/heroes/sync", self.tokens["owner"])
        self.assertEqual(status, 200)
        self.assertEqual(body["interval_hours"], 24.0)
        self.assertIn("Rone", body["source"])
        status, _, _ = fixture.request("POST", "/api/heroes/sync", self.tokens["owner"])
        self.assertEqual(status, 403)
        with patch.object(hero_sync, "ENABLED", True), patch.object(hero_sync._wake, "set") as wake:
            status, body, _ = fixture.request("POST", "/api/heroes/sync", self.tokens["admin"])
        self.assertEqual(status, 202)
        self.assertTrue(body["queued"])
        wake.assert_called_once()
        # The hero detail route still works next to /sync.
        status, _, _ = fixture.request("GET", "/api/heroes/999999", self.tokens["owner"])
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
