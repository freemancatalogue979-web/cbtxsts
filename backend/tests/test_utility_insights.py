"""Utility → team match data (browse, read evidence, confirm) and the dashboard insights + activity."""
from __future__ import annotations

import io
import os
import sys
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.main  # noqa: E402,F401  (registers every model)
from app import activity, ai_scoreboard  # noqa: E402
from app.config import UPLOAD_DIR  # noqa: E402
from app.db import Base  # noqa: E402
from app.insights import insights  # noqa: E402
from app.models import Hero, Scrim, ScrimGame, SoloGame, Tournament, TournamentMatch, User, UserActivity, dumps, loads, utcnow  # noqa: E402
from app.routers import utility  # noqa: E402
from app.routers.tournaments import match_games  # noqa: E402

KEY = {"DEEPSEEK_API_KEY": "synthetic-key"}
LANES = ["EXP", "JUNGLE", "MID", "GOLD", "ROAM"]
HEROES = {"Arlott": "EXP", "Hayabusa": "JUNGLE", "Yve": "MID", "Karrie": "GOLD", "Khufra": "ROAM",
          "Yu Zhong": "EXP", "Ling": "JUNGLE", "Valentina": "MID", "Claude": "GOLD", "Chip": "ROAM"}


def row(name, hero, k, d, a, gold=None, rating=None, mvp=False):
    return {"name": name, "hero": hero, "kills": k, "deaths": d, "assists": a, "gold": gold, "rating": rating, "mvp": mvp}


def reading() -> dict:
    ours = {"side": "left", "victory": True, "kills": 18,
            "players": [row("RINJI", "Arlott", 4, 2, 7, 9800, 8.2), row("SORA", "Hayabusa", 4, 2, 5, 10100, 8.9),
                        row("MIRA", "Yve", 1, 4, 11, 8400, 7.0), row("TOBI", "Karrie", 8, 1, 6, "13,200", 11.6, True),
                        row("KAZE", "Khufra", 1, 3, 14, "7.1k", 7.4)]}
    theirs = {"side": "right", "victory": False, "kills": 12,
              "players": [row("o.a", "Yu Zhong", 3, 4, 5), row("o.b", "Ling", 4, 5, 4), row("o.c", "Valentina", 2, 3, 6),
                          row("o.d", "Claude", 3, 3, 5), row("o.e", "Chip", 0, 3, 9)]}
    return {"screen": "scoreboard", "duration": "16:30", "teams": [ours, theirs], "notes": []}


class UtilityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.admin = User(email="a@9clover.gg", password_hash="x", name="Admin", ign="DRE", role="admin")
        self.coach = User(email="c@9clover.gg", password_hash="x", name="Coach", ign="ICHI", role="coach")
        self.p = {ign: User(email=f"{ign}@9clover.gg", password_hash="x", name=ign.title(), ign=ign, role="player",
                            roster=True, main_role=lane)
                  for ign, lane in zip(["RINJI", "SORA", "MIRA", "TOBI", "KAZE"], LANES)}
        self.db.add_all([self.admin, self.coach, *self.p.values()])
        self.db.add_all([Hero(name=n, role=r) for n, r in HEROES.items()])
        self.db.commit()
        self.lineup = {lane: self.p[ign].id for lane, ign in zip(LANES, ["RINJI", "SORA", "MIRA", "TOBI", "KAZE"])}
        self.img = UPLOAD_DIR / "test0utility.png"
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (64, 32), (20, 30, 40)).save(buf, "PNG")
        self.img.write_bytes(buf.getvalue())
        self.url = f"/api/files/{self.img.name}"
        today = utcnow().date()
        self.scrim = Scrim(number=33, opponent="Onyx", scrim_date=today - timedelta(days=2), lineup=dumps(self.lineup),
                           attachments=dumps([{"kind": "screenshot", "label": "Result", "url": self.url},
                                              {"kind": "file", "label": "notes", "url": "/api/files/x.pdf"}]))
        t = Tournament(name="Snapshot Cup")
        self.db.add_all([self.scrim, t])
        self.db.flush()
        self.match = TournamentMatch(tournament_id=t.id, match_no=3, opponent="Zenith", status="played", result="WIN",
                                     score_us=2, score_them=0, format="BO3", scheduled_date=today - timedelta(days=1))
        self.db.add(self.match)
        self.db.commit()
        activity.reset_throttle()

    def tearDown(self) -> None:
        self.img.unlink(missing_ok=True)
        self.db.close()
        self.engine.dispose()

    def read(self, kind, target_id, game_no, user=None):
        with patch.dict(os.environ, KEY), patch.object(ai_scoreboard, "call_model", return_value=reading()):
            return utility.read(utility.ReadIn(kind=kind, id=target_id, game_no=game_no, image_url=self.url),
                                db=self.db, user=user or self.admin)

    def apply(self, out, user=None):
        sheet = out["sheet"]
        payload = utility.ApplyIn(kind=out["target"]["kind"], id=out["target"]["id"], game_no=out["game_no"],
                                  result=sheet["result"], duration_min=sheet["duration_min"], lineup=sheet["lineup"],
                                  draft=sheet["draft"], player_stats=sheet["player_stats"], enemy_stats=sheet["enemy_stats"],
                                  evidence_url=self.url)
        return utility.apply(payload, db=self.db, user=user or self.admin)

    # ------------------------------------------------------------------ #
    def test_browse_matches(self) -> None:
        rows = utility.matches(db=self.db, user=self.admin)
        self.assertEqual([r["key"] for r in rows], [f"tournament:{self.match.id}", f"scrim:{self.scrim.id}"])
        scrim = rows[1]
        self.assertEqual(scrim["slots"], [1])
        self.assertEqual(scrim["evidence"], [{"url": self.url, "label": "Result"}])  # images only
        self.assertEqual(rows[0]["slots"], [1, 2])  # 2–0 → two games
        self.assertEqual([r["key"] for r in utility.matches(q="zen", db=self.db, user=self.admin)], [f"tournament:{self.match.id}"])
        with self.assertRaises(HTTPException) as err:
            utility.matches(db=self.db, user=self.p["TOBI"])
        self.assertEqual(err.exception.status_code, 403)

    def test_read_then_confirm_fills_a_scrim_game(self) -> None:
        out = self.read("scrim", self.scrim.id, 1)
        self.assertEqual(out["sheet"]["player_stats"]["GOLD"]["gold"], 13200)
        self.assertEqual(out["sheet"]["lineup"]["GOLD"], self.p["TOBI"].id)
        self.assertEqual(self.db.query(ScrimGame).count(), 0)  # reading saves nothing
        saved = self.apply(out)
        game = self.db.query(ScrimGame).one()
        self.assertEqual((game.game_no, game.result), (1, "WIN"))
        self.assertEqual(loads(game.player_stats)["GOLD"]["kills"], 8)
        self.assertEqual(loads(game.enemy_stats)["JUNGLE"]["hero"], "Ling")
        self.db.refresh(self.scrim)
        self.assertEqual((self.scrim.status, self.scrim.score_us), ("played", 1))
        self.assertTrue(saved["target"]["games"][0]["has_stats"])
        self.assertEqual(saved["target"]["slots"], [1, 2])
        # evidence was already on the scrim → not added twice
        self.assertEqual(sum(a["url"] == self.url for a in loads(self.scrim.attachments)), 1)
        # confirming again updates the same game
        self.apply(self.read("scrim", self.scrim.id, 1))
        self.assertEqual(self.db.query(ScrimGame).count(), 1)

    def test_tournament_game_and_closed_slots(self) -> None:
        out = self.read("tournament", self.match.id, 2)
        self.apply(out)
        self.db.refresh(self.match)
        game = next(g for g in match_games(self.match) if g["game_no"] == 2)
        self.assertEqual(game["player_stats"]["GOLD"]["rating"], 11.6)
        self.assertIn(self.url, [a["url"] for a in loads(self.match.attachments)])
        with self.assertRaises(HTTPException) as err:
            self.read("tournament", self.match.id, 3)
        self.assertEqual(err.exception.status_code, 422)
        self.assertIn("score", err.exception.detail)

    def test_coach_cannot_record_games(self) -> None:
        # Same permission as recording a game by hand (admin/captain).
        with self.assertRaises(HTTPException) as err:
            self.read("scrim", self.scrim.id, 1, user=self.coach)
        self.assertEqual(err.exception.status_code, 403)

    # ------------------------------------------------------------------ #
    def test_activity_is_throttled_and_counted(self) -> None:
        tobi = self.p["TOBI"]
        activity.touch(self.db, tobi)
        activity.touch(self.db, tobi)
        self.assertEqual(self.db.query(UserActivity).one().hits, 1)
        activity.reset_throttle()
        activity.touch(self.db, tobi)
        self.assertEqual(self.db.query(UserActivity).one().hits, 2)

    def test_insights_for_staff_and_players(self) -> None:
        self.apply(self.read("scrim", self.scrim.id, 1))
        self.apply(self.read("tournament", self.match.id, 1))
        tobi = self.p["TOBI"]
        self.db.add(SoloGame(user_id=tobi.id, played_on=utcnow().date(), hero="Karrie", result="WIN", kills=9, deaths=1, assists=4))
        self.db.add(SoloGame(user_id=self.p["SORA"].id, played_on=utcnow().date(), hero="Ling", result="LOSS"))
        self.db.commit()
        activity.touch(self.db, tobi)
        activity.reset_throttle()
        activity.touch(self.db, self.admin)

        staff = insights(self.db, self.admin)
        self.assertEqual(len(staff["weeks"]), 12)
        self.assertEqual(staff["summary"]["games"], 2)
        self.assertEqual(staff["summary"]["win_rate"], 100.0)
        self.assertEqual(sum(w["games"] for w in staff["team"]), 2)
        self.assertEqual(staff["summary"]["solo_games"], 2)  # staff see the squad's solo games
        self.assertEqual(staff["activity"]["active_today"], 2)
        self.assertEqual(len(staff["players"]), 5)
        tobi_row = next(p for p in staff["players"] if p["user_id"] == tobi.id)
        self.assertEqual(sum(w["team_games"] for w in tobi_row["weeks"]), 2)
        self.assertEqual(sum(w["solo_games"] for w in tobi_row["weeks"]), 1)
        self.assertEqual(staff["heroes"][0]["games"], 2)

        mine = insights(self.db, tobi)
        self.assertEqual(mine["scope"], "member")
        self.assertEqual(mine["players"], [])
        self.assertEqual([p["user_id"] for p in mine["activity"]["people"]], [tobi.id])  # only themselves
        self.assertEqual(mine["summary"]["solo_games"], 1)  # never someone else's solo games
        self.assertEqual(sum(w["games"] for w in mine["me"]["weeks"]), 3)


if __name__ == "__main__":
    unittest.main()
