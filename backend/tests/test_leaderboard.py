"""Players tab: leaderboard over team + Utility games, and each member's Utility charts."""
from __future__ import annotations

import os
import sys
import unittest
from datetime import timedelta
from pathlib import Path

os.environ.setdefault("CLOVER_AERENA_ENABLED", "0")
os.environ.setdefault("CLOVER_HERO_SYNC_ENABLED", "0")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

import app.main  # noqa: E402,F401  (registers every model)
from app import leaderboard as lb  # noqa: E402
from app.db import Base  # noqa: E402
from app.models import Hero, SoloGame, User, utcnow  # noqa: E402
from app.routers.players import leaderboard, player_utility  # noqa: E402


class LeaderboardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        mk = lambda ign, lane, role="player": User(email=f"{ign}@t.gg", password_hash="x", name=ign.title(), ign=ign,  # noqa: E731
                                                   role=role, roster=role != "coach", main_role=lane)
        self.ace, self.mid, self.low, self.new = mk("ACE", "JUNGLE"), mk("MIDO", "MID"), mk("LOWE", "GOLD"), mk("NEWB", "ROAM")
        self.coach = mk("ICHI", "", "coach")
        self.db.add_all([self.ace, self.mid, self.low, self.new, self.coach,
                         Hero(name="Ling", role="JUNGLE"), Hero(name="Karrie", role="GOLD"), Hero(name="Valentina", role="MID")])
        self.db.commit()
        self.today = utcnow().date()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def games(self, user, hero, results, k=5, d=2, a=6, rating=9.0, days_ago=1, notes=""):
        for i, r in enumerate(results):
            self.db.add(SoloGame(user_id=user.id, played_on=self.today - timedelta(days=days_ago + i), mode="Ranked", hero=hero,
                                 lane="JUNGLE", result=r, kills=k, deaths=d, assists=a, rating=rating, notes=notes,
                                 source_file="/uploads/private.png"))
        self.db.commit()

    def test_ranks_best_to_least_and_tells_short_members_what_to_add(self):
        self.games(self.ace, "Ling", ["WIN"] * 6 + ["LOSS"], k=8, d=2, a=7, rating=11.5)
        self.games(self.mid, "Valentina", ["WIN", "LOSS"] * 3, k=4, d=3, a=8, rating=8.2)
        self.games(self.low, "Karrie", ["LOSS"] * 5 + ["WIN"], k=2, d=6, a=3, rating=5.1)
        self.games(self.new, "Ling", ["WIN", "WIN"])
        board = leaderboard(period="30", db=self.db, user=self.new)
        order = [r["ign"] for r in board["rows"]]
        self.assertEqual(order, ["ACE", "MIDO", "LOWE", "NEWB"])
        self.assertEqual((board["best"], board["least"]), (self.ace.id, self.low.id))
        ace, newb = board["rows"][0], board["rows"][3]
        self.assertEqual((ace["rank"], ace["wins"], ace["losses"], ace["win_rate"]), (1, 6, 1, 85.7))
        self.assertEqual(ace["heroes"][0], {"hero": "Ling", "games": 7, "wins": 6, "win_rate": 85.7})
        self.assertGreater(ace["score"]["value"], board["rows"][1]["score"]["value"])
        self.assertIsNone(newb["rank"])
        self.assertIn("3 more games", newb["nudge"])
        self.assertEqual(board["me"], {"user_id": self.new.id, "rank": None, "nudge": newb["nudge"], "of": 3, "games_7d": 2})
        self.assertEqual(board["awards"]["win_rate"]["ign"], "ACE")
        self.assertNotIn(self.coach.id, [r["user_id"] for r in board["rows"]])  # roster only

    def test_score_is_plain_arithmetic_and_skips_missing_parts(self):
        n = lb.numbers([lb._game(self.today, "Ling", "WIN", lb._line(), "solo")] * 4
                       + [lb._game(self.today, "Ling", "LOSS", lb._line(), "solo")])
        s = lb.score(n)
        # No K/D/A or rating typed: only win rate (80) and games (5/20 → 25) count, weights .45/.10.
        self.assertEqual(s["parts"], {"win": 80.0, "volume": 25.0})
        self.assertEqual(s["value"], round((80 * 0.45 + 25 * 0.10) / 0.55, 1))
        self.assertIsNone(lb.score(lb.numbers([lb._game(self.today, "Ling", "WIN", lb._line(), "solo")] * 4)))

    def test_period_filters_and_stale_uploads_are_nudged(self):
        self.games(self.ace, "Ling", ["WIN"] * 5, days_ago=40)
        old = self.db.query(SoloGame).filter_by(user_id=self.ace.id).all()
        for g in old:
            g.created_at = utcnow() - timedelta(days=40)
        self.db.commit()
        recent = leaderboard(period="30", db=self.db, user=self.ace)
        ace = next(r for r in recent["rows"] if r["user_id"] == self.ace.id)
        self.assertEqual((ace["games"], ace["rank"]), (0, None))
        every = leaderboard(period="all", db=self.db, user=self.ace)
        ace = next(r for r in every["rows"] if r["user_id"] == self.ace.id)
        self.assertEqual(ace["rank"], 1)
        self.assertIn("Nothing added for 40 days", ace["nudge"])
        self.assertIn("No games added yet", next(r for r in every["rows"] if r["user_id"] == self.mid.id)["nudge"])
        with self.assertRaises(HTTPException):
            leaderboard(period="7", db=self.db, user=self.ace)

    def test_teammates_see_utility_charts_but_not_notes_files_or_coaching(self):
        self.games(self.low, "Karrie", ["LOSS"] * 6, k=1, d=7, a=2, rating=4.0, notes="tilted, private")
        mine = player_utility(self.low.id, db=self.db, user=self.low)
        theirs = player_utility(self.low.id, db=self.db, user=self.ace)
        self.assertEqual(theirs["overall"]["games"], 6)
        self.assertEqual(theirs["heroes"][0]["name"], "Karrie")
        self.assertEqual(len(theirs["weeks"]), 12)
        self.assertEqual(sum(w["solo_games"] for w in theirs["weeks"]), 6)
        self.assertNotIn("private", str(theirs))
        self.assertNotIn("notes", theirs["recent"][0])
        self.assertTrue(any(a["tone"] == "bad" for a in mine["alerts"]))
        self.assertFalse(any(a["tone"] != "good" for a in theirs["alerts"]))
        self.assertTrue(mine["is_self"])
        self.assertTrue(theirs["last_added"].endswith("Z"))
        with self.assertRaises(HTTPException):
            player_utility(99999, db=self.db, user=self.ace)


if __name__ == "__main__":
    unittest.main()
