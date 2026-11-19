"""Scrim dashboard numbers (pure function, no DB)."""

from __future__ import annotations

import json
import unittest
from datetime import date
from types import SimpleNamespace as NS

from app.routers.scrims import scrim_insights_data


def game(result, minutes, stats, draft=None, players=None):
    return NS(result=result, duration_min=minutes, stats=json.dumps(stats), draft=json.dumps(draft or {}),
              player_stats=json.dumps(players or {}))


def scrim(i, d, opp, result, games):
    w = sum(1 for g in games if g.result == "WIN")
    return NS(id=i, number=i, opponent=opp, scrim_date=d, result=result, score_us=w, score_them=len(games) - w, games=games)


DRAFT = {"our_picks": {"EXP": "Arlott", "JUNGLE": "Ling"}, "enemy_picks": {"EXP": "Yu Zhong"},
         "our_bans": ["Fanny", ""], "enemy_bans": ["Ling"]}


class InsightTests(unittest.TestCase):
    def setUp(self):
        self.played = [
            scrim(2, date(2026, 10, 3), "Onyx", "LOSS", [
                game("LOSS", 18, {"kills": 8, "deaths": 15, "enemy_kills": 15, "turrets": 2, "enemy_turrets": 8,
                                  "lords": 0, "enemy_lords": 2, "gold_diff_10": -1500}, DRAFT,
                     {"EXP": {"kills": 2, "deaths": 4, "assists": 3, "rating": 6.5}}),
            ]),
            scrim(1, date(2026, 9, 20), "Onyx", "WIN", [
                game("WIN", 11, {"kills": 20, "deaths": 6, "enemy_kills": 6, "turrets": 9, "enemy_turrets": 1,
                                 "lords": 1, "enemy_lords": 0, "gold_diff_10": 2200}, DRAFT,
                     {"EXP": {"kills": 6, "deaths": 0, "assists": 5, "rating": 11.5}}),
                game("WIN", 14, {"kills": 18, "deaths": 9}),
            ]),
            scrim(3, date(2026, 10, 9), "Blacklist", "WIN", [game("WIN", 22, {"kills": 12, "deaths": 10})]),
        ]
        self.out = scrim_insights_data(self.played)

    def test_timeline_is_in_date_order_with_running_rates(self):
        t = self.out["timeline"]
        self.assertEqual([r["number"] for r in t], [1, 2, 3])
        self.assertEqual([r["win_rate_to_date"] for r in t], [100.0, 50.0, 66.7])
        self.assertEqual(t[0]["kills"], 19.0)
        self.assertEqual(self.out["form"], ["WIN", "LOSS", "WIN"])
        self.assertEqual(self.out["streak"], {"result": "WIN", "count": 1})
        self.assertEqual([m["month"] for m in self.out["monthly"]], ["2026-09", "2026-10"])

    def test_objectives_durations_and_edges(self):
        o = self.out["objectives"]
        self.assertEqual(o["turrets"], {"us": 5.5, "them": 4.5, "games": 2})
        self.assertEqual(o["kills"]["games"], 4)   # deaths stand in for enemy kills when missing
        d = {b["bucket"]: b for b in self.out["duration"]}
        self.assertEqual((d["Under 12 min"]["games"], d["16–20 min"]["wins"], d["20 min +"]["wins"]), (1, 0, 1))
        self.assertEqual(self.out["early"]["ahead_at_10"], {"games": 1, "wins": 1, "win_rate": 100.0})
        self.assertEqual(self.out["lord_edge"]["fewer_lords"]["win_rate"], 0.0)

    def test_heroes_lanes_and_opponents(self):
        h = self.out["heroes"]
        self.assertEqual(h["picked"][0], {"hero": "Arlott", "games": 2, "wins": 1, "win_rate": 50.0})
        self.assertEqual(h["banned_by_us"], [{"hero": "Fanny", "games": 2, "wins": 0, "win_rate": 0.0}])
        exp = next(l for l in self.out["lanes"] if l["lane"] == "EXP")
        self.assertEqual((exp["games"], exp["kda"], exp["rating"]), (2, 4.0, 9.0))
        onyx = self.out["opponents"][0]
        self.assertEqual((onyx["opponent"], onyx["played"], onyx["won"], onyx["game_wins"], onyx["game_losses"]), ("Onyx", 2, 1, 2, 1))

    def test_real_models(self):
        from app.models import Scrim, ScrimGame
        sc = Scrim(id=9, number=9, opponent="Real", scrim_date=date(2026, 10, 1), status="played", result="WIN", score_us=1, score_them=0)
        sc.games.append(ScrimGame(game_no=1, result="WIN", duration_min=15, stats=json.dumps({"kills": 10, "deaths": 4}),
                                  draft="{}", player_stats="{}"))
        out = scrim_insights_data([sc])
        self.assertEqual((out["timeline"][0]["date"], out["timeline"][0]["kills"]), ("2026-10-01", 10.0))

    def test_empty(self):
        out = scrim_insights_data([])
        self.assertEqual((out["timeline"], out["objectives"], out["streak"]["count"]), ([], {}, 0))


if __name__ == "__main__":
    unittest.main()
