"""Scrim + tournament games → player profile, hero pool games and heroes to work on."""
from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.main  # noqa: E402,F401  (registers every model)
from app.db import Base  # noqa: E402
from app.models import Hero, HeroPoolEntry, Scrim, ScrimGame, Tournament, TournamentMatch, User, dumps  # noqa: E402
from app.performance import appearances, focus_alerts, hero_rows  # noqa: E402
from app.routers.dashboard import dashboard  # noqa: E402
from app.routers.players import player_detail  # noqa: E402
from app.routers.scrims import GamePatch, add_game, get_scrim, scrim_stats, update_game  # noqa: E402
from app.schemas import GameIn  # noqa: E402

LANES = ["EXP", "JUNGLE", "MID", "GOLD", "ROAM"]


class PerformanceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.coach = User(email="c@9clover.gg", password_hash="x", name="Coach", ign="COACH", role="coach")
        self.admin = User(email="a@9clover.gg", password_hash="x", name="Admin", ign="DRE", role="admin")
        self.p = [User(email=f"p{i}@9clover.gg", password_hash="x", name=f"P{i}", ign=ign, role="player", roster=True)
                  for i, ign in enumerate(["RINJI", "SORA", "MIRA", "TOBI", "KAZE", "PIP"])]
        self.db.add_all([self.coach, self.admin, *self.p])
        self.heroes = {n: Hero(name=n, role="GOLD") for n in ["Claude", "Karrie", "Beatrix", "Wanwan", "Yve", "Chou"]}
        self.db.add_all(self.heroes.values())
        self.db.commit()
        self.lineup = {lane: u.id for lane, u in zip(LANES, self.p)}
        self.n = 0

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def scrim(self, day: int = 1) -> Scrim:
        self.n += 1
        s = Scrim(number=self.n, opponent="Onyx", scrim_date=date(2026, 10, day), lineup=dumps(self.lineup))
        self.db.add(s)
        self.db.commit()
        return s

    def game(self, s: Scrim, no: int, result: str, gold_hero: str, **extra) -> dict:
        draft = {"our_bans": [], "enemy_bans": [], "our_picks": {"GOLD": gold_hero, "MID": "Yve"}, "enemy_picks": {}}
        return add_game(s.id, GameIn(game_no=no, result=result, draft=draft, **extra), db=self.db, user=self.admin)

    def pool(self, user: User, hero: str, category: str = "comfort") -> None:
        self.db.add(HeroPoolEntry(user_id=user.id, hero_id=self.heroes[hero].id, category=category, confidence=7))
        self.db.commit()

    @property
    def tobi(self) -> User:
        return self.p[3]

    # ------------------------------------------------------------------ #
    def test_game_without_lineup_uses_the_scrims_lineup_and_a_sub_overrides_it(self) -> None:
        s = self.scrim()
        g1 = self.game(s, 1, "WIN", "Claude")
        self.assertTrue(g1["lineup_from_scrim"])
        self.assertEqual(g1["players"]["GOLD"], "TOBI")
        sub = {**self.lineup, "GOLD": self.p[5].id}
        g2 = self.game(s, 2, "LOSS", "Karrie", lineup=sub)
        self.assertFalse(g2["lineup_from_scrim"])
        self.assertEqual(g2["players"]["GOLD"], "PIP")
        tobi = appearances(self.db, self.tobi.id)
        self.assertEqual([(a.game_no, a.hero, a.result) for a in tobi], [(1, "Claude", "WIN")])
        pip = appearances(self.db, self.p[5].id)
        self.assertEqual([(a.game_no, a.lane, a.hero) for a in pip], [(2, "GOLD", "Karrie")])

    def test_clearing_a_games_lineup_falls_back_to_the_scrim(self) -> None:
        s = self.scrim()
        g = self.game(s, 1, "WIN", "Claude", lineup={**self.lineup, "GOLD": self.p[5].id})
        out = update_game(s.id, g["id"], GamePatch(lineup=None), db=self.db, user=self.admin)
        self.assertTrue(out["lineup_from_scrim"])
        self.assertEqual(out["players"]["GOLD"], "TOBI")

    def test_bad_lineups_and_stats_are_rejected_or_cleaned(self) -> None:
        s = self.scrim()
        for lineup, why in (({"EXP": self.p[0].id, "MID": self.p[0].id}, "same player twice"),
                            ({"TOP": self.p[0].id}, "unknown lane"),
                            ({"EXP": 999}, "unknown player")):
            with self.subTest(why), self.assertRaises(HTTPException) as err:
                self.game(s, 1, "WIN", "Claude", lineup=lineup)
            self.assertEqual(err.exception.status_code, 422)
        g = self.game(s, 1, "WIN", "Claude",
                      player_stats={"gold": {"kills": "7", "deaths": -2, "assists": 4.0}, "TOP": {"kills": 1},
                                    "MID": {"kills": ""}})
        self.assertEqual(g["player_stats"], {"GOLD": {"kills": 7, "deaths": 0, "assists": 4}})

    def test_scrim_and_tournament_games_combine_per_hero_and_fill_the_pool(self) -> None:
        self.pool(self.tobi, "Claude")
        s = self.scrim()
        self.game(s, 1, "WIN", "Claude", player_stats={"GOLD": {"kills": 8, "deaths": 1, "assists": 3}})
        self.game(s, 2, "WIN", "Claude", player_stats={"GOLD": {"kills": 6, "deaths": 2, "assists": 5}})
        t = Tournament(name="Cup")
        self.db.add(t)
        self.db.flush()
        m = TournamentMatch(tournament_id=t.id, match_no=1, opponent="Zenith", status="played", result="LOSS",
                            score_us=0, score_them=1, scheduled_date=date(2026, 10, 9),
                            game_drafts=dumps([{"game_no": 1, "lineup": self.lineup,
                                                "draft": {"our_picks": {"GOLD": "claude"}}}]))
        self.db.add(m)
        self.db.commit()

        d = player_detail(self.tobi.id, db=self.db, user=self.coach)
        perf = d["performance"]
        self.assertEqual((perf["overall"]["games"], perf["scrims"]["games"], perf["tournaments"]["games"]), (3, 2, 1))
        claude = perf["heroes"][0]
        self.assertEqual((claude["hero"], claude["games"], claude["wins"], claude["losses"]), ("Claude", 3, 2, 1))
        self.assertEqual((claude["scrim_games"], claude["tournament_games"]), (2, 1))
        self.assertEqual(claude["kda"]["ratio"], round((8 + 6 + 3 + 5) / 3, 2))
        self.assertEqual(perf["recent"][0]["source"], "tournament")  # newest first
        played = d["pool"]["comfort"][0]["played"]
        self.assertEqual((played["games"], played["wins"], played["scrim_games"], played["tournament_games"]), (3, 2, 2, 1))

    def test_losing_hero_is_flagged_to_work_on(self) -> None:
        self.pool(self.tobi, "Karrie")
        for day, result in ((1, "LOSS"), (2, "LOSS"), (3, "WIN"), (4, "LOSS")):
            self.game(self.scrim(day), 1, result, "Karrie")
        focus = player_detail(self.tobi.id, db=self.db, user=self.coach)["performance"]["focus"]
        self.assertEqual(focus[0]["kind"], "struggling")
        self.assertEqual(focus[0]["title"], "Work on Karrie")
        self.assertIn("1W 3L (25%)", focus[0]["detail"])
        self.assertIn("comfort pool", focus[0]["tip"])

    def test_low_kda_cold_streak_no_reps_and_strength(self) -> None:
        self.pool(self.tobi, "Beatrix", "meta")  # never played with the team
        # Wanwan: wins but feeds → low KDA
        for day in (1, 2, 3):
            self.game(self.scrim(day), 1, "WIN", "Wanwan", player_stats={"GOLD": {"kills": 1, "deaths": 6, "assists": 2}})
        # Claude: strong, not in pool → add it
        for day in (4, 5, 6):
            self.game(self.scrim(day), 1, "WIN", "Claude")
        kinds = {a["kind"]: a for a in player_detail(self.tobi.id, db=self.db, user=self.coach)["performance"]["focus"]}
        self.assertIn("Dying a lot on Wanwan", kinds["low_kda"]["title"])
        self.assertEqual(kinds["no_reps"]["hero"], "Beatrix")
        self.assertEqual(kinds["strength"]["title"], "Add Claude to your pool")
        self.assertNotIn("struggling", kinds)

        heroes = hero_rows(appearances(self.db, self.tobi.id))
        for h in heroes:
            if h["hero"] == "Claude":
                h["loss_streak"], h["decided"], h["win_rate"] = 3, 2, 50.0
        streak = [a for a in focus_alerts(heroes, []) if a["kind"] == "cold_streak"]
        self.assertEqual(streak[0]["title"], "Claude: lost the last 3")

    def test_scrim_stats_list_who_played_with_heroes(self) -> None:
        s = self.scrim()
        self.game(s, 1, "WIN", "Claude", player_stats={"GOLD": {"kills": 5, "deaths": 1, "assists": 5}})
        self.game(s, 2, "LOSS", "Karrie", lineup={**self.lineup, "GOLD": self.p[5].id})
        st = scrim_stats(db=self.db, user=self.coach)
        self.assertEqual(st["series"]["played"], 1)
        self.assertEqual((st["games"]["played"], st["games"]["with_lineup"], st["games"]["with_player_stats"]), (2, 2, 1))
        rows = {r["name"]: r for r in st["players"]}
        self.assertEqual((rows["TOBI"]["games"], rows["TOBI"]["kda"]), (1, 10.0))
        self.assertEqual([h["hero"] for h in rows["PIP"]["heroes"]], ["Karrie"])
        self.assertEqual(rows["MIRA"]["games"], 2)
        self.assertEqual(get_scrim(s.id, db=self.db, user=self.coach)["games"][1]["players"]["GOLD"], "PIP")

    def test_dashboard_alerts_the_player_and_gives_staff_the_squad_view(self) -> None:
        self.pool(self.tobi, "Karrie")
        for day in (1, 2, 3):
            self.game(self.scrim(day), 1, "LOSS", "Karrie")
        mine = dashboard(db=self.db, user=self.tobi)
        self.assertEqual(mine["my_form"]["overall"]["games"], 3)
        self.assertEqual(mine["my_form"]["focus"][0]["title"], "Work on Karrie")
        self.assertEqual(mine["squad_focus"], [])  # players see their own alerts only
        staff = dashboard(db=self.db, user=self.coach)
        self.assertIsNone(staff["my_form"])
        squad = {r["name"]: r["alert"]["title"] for r in staff["squad_focus"]}
        self.assertEqual(squad["TOBI"], "Work on Karrie")
        self.assertEqual(squad["MIRA"], "Work on Yve")  # every struggling player is listed


if __name__ == "__main__":
    unittest.main()
