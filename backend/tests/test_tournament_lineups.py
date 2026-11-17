"""Who played each tournament game, and the overall match stats built from it."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.main  # noqa: E402,F401  (registers every model)
from app.db import Base  # noqa: E402
from app.models import Tournament, TournamentMatch, User  # noqa: E402
from app.routers.players import player_detail  # noqa: E402
from app.routers.tournaments import (  # noqa: E402
    GameDraftIn, MatchPatch, get_tournament, overall_stats, save_game_draft, update_match,
)


class TournamentLineupTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.cap = User(email="cap@9clover.gg", password_hash="x", name="Cap", ign="DRE", role="captain")
        self.p = [User(email=f"p{i}@9clover.gg", password_hash="x", name=f"P{i}", ign=ign, role="player", roster=True)
                  for i, ign in enumerate(["Rex", "Kai", "Nova", "Zed", "Sub"])]
        self.db.add_all([self.cap, *self.p])
        t = Tournament(name="Snapshot Cup", status="ongoing")
        self.db.add(t)
        self.db.flush()
        self.t = t
        self.m1 = TournamentMatch(tournament_id=t.id, match_no=1, opponent="Zenith", format="BO3")
        self.m2 = TournamentMatch(tournament_id=t.id, match_no=2, opponent="Onyx", format="BO3")
        self.db.add_all([self.m1, self.m2])
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def save(self, match, game, *, lineup=None, picks=None, result=""):
        draft = {"our_bans": [], "enemy_bans": [], "our_picks": picks or {}, "enemy_picks": {}}
        return save_game_draft(match.id, game, GameDraftIn(draft=draft, result=result, lineup=lineup),
                               db=self.db, user=self.cap)

    def score(self, match, us, them):
        update_match(match.id, MatchPatch(status="played", result="WIN" if us > them else "LOSS",
                                          score_us=us, score_them=them), db=self.db, user=self.cap)

    def lineup(self, sub_for_gold: bool = False) -> dict:
        rex, kai, nova, zed, sub = (u.id for u in self.p)
        return {"EXP": rex, "JUNGLE": kai, "MID": nova, "GOLD": sub if sub_for_gold else zed, "ROAM": self.cap.id}

    def test_lineup_only_game_saves_and_shows_player_names(self) -> None:
        self.score(self.m1, 2, 0)
        out = self.save(self.m1, 1, lineup=self.lineup())
        game = next(m for m in out["matches"] if m["id"] == self.m1.id)["games"][0]
        self.assertEqual(game["lineup"]["EXP"], self.p[0].id)
        self.assertEqual(game["players"], {"EXP": "Rex", "JUNGLE": "Kai", "MID": "Nova", "GOLD": "Zed", "ROAM": "DRE"})

    def test_saving_a_draft_without_lineup_keeps_the_saved_lineup(self) -> None:
        self.score(self.m1, 2, 0)
        self.save(self.m1, 1, lineup=self.lineup())
        out = self.save(self.m1, 1, picks={"GOLD": "Claude"})  # lineup omitted
        game = next(m for m in out["matches"] if m["id"] == self.m1.id)["games"][0]
        self.assertEqual(game["players"]["GOLD"], "Zed")
        self.assertEqual(game["draft"]["our_picks"]["GOLD"], "Claude")

    def test_bad_lineups_are_rejected(self) -> None:
        self.score(self.m1, 2, 0)
        rex = self.p[0].id
        for lineup, why in (({"EXP": rex, "MID": rex}, "same player twice"),
                            ({"TOP": rex}, "unknown lane"),
                            ({"EXP": 9999}, "unknown player"),
                            ({}, "nothing to save")):
            with self.subTest(why), self.assertRaises(HTTPException) as err:
                self.save(self.m1, 2, lineup=lineup)
            self.assertEqual(err.exception.status_code, 422)

    def test_overall_stats_count_who_played_each_game_with_their_hero(self) -> None:
        # M1: won 2–0 (results implied), Zed on Claude then the sub on Beatrix.
        self.score(self.m1, 2, 0)
        self.save(self.m1, 1, lineup=self.lineup(), picks={"GOLD": "Claude", "MID": "Yve"})
        self.save(self.m1, 2, lineup=self.lineup(sub_for_gold=True), picks={"GOLD": "Beatrix"})
        # M2: won 2–1; game 2 lost with Zed back in.
        self.score(self.m2, 2, 1)
        self.save(self.m2, 1, lineup=self.lineup(), result="WIN", picks={"GOLD": "Claude"})
        self.save(self.m2, 2, lineup=self.lineup(), result="LOSS")
        self.save(self.m2, 3, lineup=self.lineup(), result="WIN")

        stats = get_tournament(self.t.id, db=self.db, user=self.cap)["stats"]
        self.assertEqual(stats["series"], {"played": 2, "wins": 2, "losses": 0, "draws": 0, "win_rate": 100.0})
        self.assertEqual(stats["games"]["played"], 5)
        self.assertEqual((stats["games"]["wins"], stats["games"]["losses"]), (4, 1))
        self.assertEqual(stats["games"]["with_lineup"], 5)
        by_name = {p["name"]: p for p in stats["players"]}
        self.assertEqual((by_name["Zed"]["games"], by_name["Zed"]["wins"], by_name["Zed"]["losses"]), (4, 3, 1))
        self.assertEqual(by_name["Zed"]["win_rate"], 75.0)
        self.assertEqual(by_name["Zed"]["series"], 2)
        self.assertEqual(by_name["Zed"]["heroes"][0], {"hero": "Claude", "games": 2, "wins": 2})
        self.assertEqual((by_name["Sub"]["games"], by_name["Sub"]["wins"]), (1, 1))
        self.assertEqual(by_name["Sub"]["heroes"], [{"hero": "Beatrix", "games": 1, "wins": 1}])
        self.assertEqual(by_name["DRE"]["main_lane"], "ROAM")
        self.assertEqual(stats["heroes"][0]["hero"], "Claude")

        overall = overall_stats(db=self.db, user=self.cap)
        self.assertEqual(overall["tournaments"], 1)
        self.assertEqual(overall["games"]["played"], 5)

        zed = player_detail(self.p[3].id, db=self.db, user=self.cap)["tournament_stats"]
        self.assertEqual((zed["games"], zed["wins"], zed["tournaments"]), (4, 3, 1))
        self.assertEqual(len(zed["recent"]), 4)
        self.assertTrue(all(r["lane"] == "GOLD" for r in zed["recent"]))

    def test_unplayed_matches_do_not_count(self) -> None:
        self.save(self.m1, 1, lineup=self.lineup())  # planned lineup, match not played
        stats = get_tournament(self.t.id, db=self.db, user=self.cap)["stats"]
        self.assertEqual(stats["players"], [])
        self.assertEqual(stats["games"]["played"], 0)


if __name__ == "__main__":
    unittest.main()
