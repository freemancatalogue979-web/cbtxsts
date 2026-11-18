"""AI screenshot reader, AI strategy writer, scoreboard lines and the AI's view of team stats."""
from __future__ import annotations

import io
import os
import sys
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.main  # noqa: E402,F401  (registers every model)
from app import ai_scoreboard, ai_strategy_writer  # noqa: E402
from app.clover_ai_service import member_team_games, team_records_for  # noqa: E402
from app.config import UPLOAD_DIR  # noqa: E402
from app.db import Base  # noqa: E402
from app.models import Hero, HeroPoolEntry, Scrim, Tournament, TournamentMatch, User, dumps  # noqa: E402
from app.performance import player_performance  # noqa: E402
from app.routers.ai_tools import ScoreboardIn, StrategyAIIn, scoreboard, strategy  # noqa: E402
from app.routers.scrims import add_game, get_scrim  # noqa: E402
from app.routers.tournaments import GameDraftIn, save_game_draft  # noqa: E402
from app.schemas import GameIn  # noqa: E402

LANES = ["EXP", "JUNGLE", "MID", "GOLD", "ROAM"]
HEROES = {"Arlott": "EXP", "Hayabusa": "JUNGLE", "Yve": "MID", "Karrie": "GOLD", "Khufra": "ROAM",
          "Yu Zhong": "EXP", "Ling": "JUNGLE", "Valentina": "MID", "Claude": "GOLD", "Chip": "ROAM",
          "Fanny": "JUNGLE", "Joy": "JUNGLE", "Lukas": "EXP"}
KEY = {"DEEPSEEK_API_KEY": "synthetic-key"}


def row(name, hero, k, d, a, gold=None, rating=None, mvp=False):
    return {"name": name, "hero": hero, "kills": k, "deaths": d, "assists": a, "gold": gold, "rating": rating, "mvp": mvp}


def screenshot(us_on_right=True, our_gold_hero="Karrie", gold_ign="TOBI"):
    ours = {"side": "right" if us_on_right else "left", "victory": True, "kills": 18, "bans": ["Fanny", "Joy"],
            "objectives": {"turrets": 8, "lords": 1, "turtles": 2},
            "players": [row("9C•KAZE", "Khufra", 1, 3, 14, "7.1k", 7.4),
                        row(gold_ign, our_gold_hero, 8, 1, 6, "13,200", 11.6, True),
                        row("RINJI", "Arlott", 4, 2, 7, 9800, 8.2),
                        row("SORA", "hayabusa", 4, 2, 5, 10100, 8.9),
                        row("M1RA", "Yve", 1, 4, 11, 8400, 7.0)]}
    theirs = {"side": "left" if us_on_right else "right", "victory": False, "kills": 12,
              "players": [row("onyx.a", "Yu Zhong", 3, 4, 5), row("onyx.b", "Ling", 4, 5, 4),
                          row("onyx.c", "Valentina", 2, 3, 6), row("onyx.d", "Claude", 3, 3, 5),
                          row("onyx.e", "Chip", 0, 3, 9)]}
    teams = [theirs, ours] if us_on_right else [ours, theirs]
    return {"screen": "scoreboard", "duration": "16:30", "teams": teams, "notes": ["Damage tab not shown"]}


class AIToolsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.admin = User(email="a@9clover.gg", password_hash="x", name="Admin", ign="DRE", role="admin")
        self.coach = User(email="c@9clover.gg", password_hash="x", name="Coach", ign="ICHI", role="coach")
        names = [("RINJI", "EXP"), ("SORA", "JUNGLE"), ("MIRA", "MID"), ("TOBI", "GOLD"), ("KAZE", "ROAM"), ("PIP", "GOLD")]
        self.p = {ign: User(email=f"{ign}@9clover.gg", password_hash="x", name=ign.title(), ign=ign, role="player",
                            roster=True, main_role=lane) for ign, lane in names}
        self.db.add_all([self.admin, self.coach, *self.p.values()])
        self.db.add_all([Hero(name=n, role=r) for n, r in HEROES.items()])
        self.db.commit()
        self.lineup = {lane: self.p[ign].id for lane, ign in zip(LANES, ["RINJI", "SORA", "MIRA", "TOBI", "KAZE"])}
        self.img = UPLOAD_DIR / "test0aiscoreboard.png"
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (64, 32), (20, 30, 40)).save(buf, "PNG")
        self.img.write_bytes(buf.getvalue())

    def tearDown(self) -> None:
        self.img.unlink(missing_ok=True)
        self.db.close()
        self.engine.dispose()

    def read(self, raw, *, lineup=None, draft=None, result="", user=None):
        payload = ScoreboardIn(image_url=f"/api/files/{self.img.name}", opponent="Onyx", result=result,
                               lineup=self.lineup if lineup is None else lineup, draft=draft or {})
        with patch.dict(os.environ, KEY), patch.object(ai_scoreboard, "call_model", return_value=raw) as call:
            out = scoreboard(payload, db=self.db, user=user or self.admin)
        return out, call

    # ------------------------------------------------------------------ #
    def test_portrait_matcher_feeds_the_reader_and_flags_missed_heroes(self) -> None:
        from app import hero_vision
        sure = hero_vision.Match(hero="Chip", score=0.93, margin=0.3, x=0.1, y=0.3, size=0.09, box=(1, 2, 30, 31))
        lost = hero_vision.Match(hero="Lukas", score=0.9, margin=0.3, x=0.9, y=0.5, size=0.09, box=(40, 2, 60, 22))
        help_ = hero_vision.PortraitHelp(image=b"tagged-jpeg", sheet=b"sheet-png", matches=[sure, lost], maybes=[])
        draft = {"our_picks": {"EXP": "Arlott", "JUNGLE": "Hayabusa", "MID": "Yve", "GOLD": "Karrie", "ROAM": "Khufra"},
                 "enemy_picks": {"EXP": "Yu Zhong", "JUNGLE": "Ling"}}
        with patch.object(ai_scoreboard, "portrait_help", return_value=help_) as matcher:
            out, call = self.read(screenshot(us_on_right=True), draft=draft)
        # the recorded picks narrow the matcher down
        self.assertEqual(set(matcher.call_args.args[2]), {"Arlott", "Hayabusa", "Yve", "Karrie", "Khufra", "Yu Zhong", "Ling"})
        _key, _system, text, image, mime = call.call_args.args
        self.assertEqual((image, mime), (b"tagged-jpeg", "image/jpeg"))
        self.assertEqual(call.call_args.kwargs["extra"], [(b"sheet-png", "image/png")])
        self.assertIn('"portrait_matches"', text)
        self.assertIn('"hero": "Chip"', text)
        texts = [c["text"] for c in out["checks"]]
        self.assertTrue(any("Recognised 2 heroes from their portraits: Chip, Lukas." == t for t in texts), texts)
        self.assertTrue(any("clearly show Lukas" in t for t in texts), texts)
        self.assertFalse(any("clearly show Chip" in t for t in texts))
        self.assertEqual([h["hero"] for h in out["heroes_seen"]], ["Chip", "Lukas"])

    def test_reads_the_scoreboard_into_lanes_players_and_team_totals(self) -> None:
        draft = {"our_picks": {"EXP": "Arlott", "JUNGLE": "Hayabusa", "MID": "Yve", "GOLD": "Karrie", "ROAM": "Khufra"}}
        out, call = self.read(screenshot(us_on_right=True), draft=draft)
        # The picture went to the vision model with the game's context.
        _key, _system, text, image, mime = call.call_args.args
        self.assertEqual(mime, "image/png")
        self.assertIn('"GOLD": "TOBI"', text)
        self.assertIn("Karrie", text)
        # Ours was on the right; every row found its lane from the draft.
        self.assertEqual(out["result"], "WIN")
        self.assertEqual(out["duration_min"], 16.5)
        self.assertEqual({r["lane"]: r["placed_by"] for r in out["rows"]["ours"]}, dict.fromkeys(LANES, "draft"))
        self.assertEqual(out["player_stats"]["GOLD"], {"kills": 8, "deaths": 1, "assists": 6, "gold": 13200,
                                                       "rating": 11.6, "mvp": True})
        self.assertEqual(out["player_stats"]["ROAM"]["gold"], 7100)
        self.assertEqual(out["lineup"], self.lineup)  # "9C•KAZE" → KAZE, "M1RA" → MIRA
        self.assertEqual(out["stats"], {"kills": 18, "deaths": 12, "gold": 48600, "enemy_kills": 12, "enemy_deaths": 18,
                                        "turrets": 8, "lords": 1, "turtles": 2})
        self.assertEqual(out["enemy_stats"]["JUNGLE"], {"kills": 4, "deaths": 5, "assists": 4, "hero": "Ling", "name": "onyx.b"})
        self.assertEqual(out["draft"]["enemy_picks"]["MID"], "Valentina")
        self.assertEqual(out["draft"]["our_bans"][:2], ["Fanny", "Joy"])
        texts = [c["text"] for c in out["checks"]]
        self.assertIn("MVP: TOBI (11.6).", texts)
        raw = screenshot()
        before = repr(raw)
        again = ai_scoreboard.interpret(raw, db=self.db, lineup=self.lineup, draft=draft)
        again = ai_scoreboard.interpret(raw, db=self.db, lineup=self.lineup, draft=draft)  # same reply read twice
        self.assertEqual(repr(raw), before, "the model's reply is never modified")
        self.assertEqual(len(again["enemy_stats"]), 5)
        self.assertIn("All five of our players matched to a lane.", texts)
        self.assertIn("Damage tab not shown", texts)

    def test_compares_with_the_draft_and_lineup_and_says_what_changed(self) -> None:
        draft = {"our_picks": {"GOLD": "Karrie"}, "enemy_picks": {"MID": "Valentina"}}
        out, _ = self.read(screenshot(us_on_right=False, our_gold_hero="Claude", gold_ign="PIP"), draft=draft,
                           result="LOSS")
        texts = [c["text"] for c in out["checks"]]
        self.assertIn("Our GOLD: draft said Karrie, screenshot shows Claude — updated.", texts)
        self.assertIn("PIP played GOLD (lineup had TOBI).", texts)
        self.assertIn("Form said loss, screenshot shows a win — updated.", texts)
        self.assertEqual(out["lineup"]["GOLD"], self.p["PIP"].id)
        self.assertEqual(out["draft"]["our_picks"]["GOLD"], "Claude")
        # Enemy Claude isn't confused with ours: their gold lane is Claude, from the hero's lane.
        self.assertEqual(out["enemy_stats"]["GOLD"]["hero"], "Claude")

    def test_no_names_or_picks_to_go_on_means_left_team_with_a_warning(self) -> None:
        raw = screenshot(us_on_right=False)
        for t in raw["teams"]:
            for r in t["players"]:
                r["name"] = "?"
        out, _ = self.read(raw, lineup={}, draft={})
        self.assertTrue(any("left team was taken" in c["text"] for c in out["checks"]))
        self.assertEqual(out["rows"]["ours"][0]["hero"], "Arlott")  # placed by the hero's lane

    def test_errors_the_person_can_act_on(self) -> None:
        with self.assertRaises(HTTPException) as err:
            self.read({"screen": "other", "teams": []})
        self.assertEqual(err.exception.status_code, 422)
        self.assertIn("Couldn't find a scoreboard", err.exception.detail)
        for url, code in (("https://evil.example/x.png", 422), ("/api/files/../secret.png", 422),
                          ("/api/files/missing0000.png", 404), ("/api/files/notes.txt", 422)):
            with self.subTest(url), self.assertRaises(HTTPException) as err:
                scoreboard(ScoreboardIn(image_url=url), db=self.db, user=self.admin)
            self.assertEqual(err.exception.status_code, code)
        with patch("app.ai_scoreboard._credential", return_value=(None, "not configured")), \
                self.assertRaises(HTTPException) as err:
            scoreboard(ScoreboardIn(image_url=f"/api/files/{self.img.name}"), db=self.db, user=self.admin)
        self.assertEqual(err.exception.status_code, 503)
        self.assertIn("fill everything in by hand", err.exception.detail)
        with self.assertRaises(HTTPException) as err:  # players can't record games, so can't read them either
            self.read(screenshot(), user=self.p["TOBI"])
        self.assertEqual(err.exception.status_code, 403)

    def test_the_read_sheet_saves_on_a_scrim_game_and_feeds_the_profile(self) -> None:
        s = Scrim(number=1, opponent="Onyx", scrim_date=date(2026, 10, 1), lineup=dumps(self.lineup))
        self.db.add(s)
        self.db.commit()
        draft = {"our_picks": {"EXP": "Arlott", "JUNGLE": "Hayabusa", "MID": "Yve", "GOLD": "Karrie", "ROAM": "Khufra"}}
        out, _ = self.read(screenshot(), draft=draft)
        add_game(s.id, GameIn(game_no=1, result=out["result"], duration_min=out["duration_min"], stats=out["stats"],
                              draft=out["draft"], lineup=out["lineup"], player_stats=out["player_stats"],
                              enemy_stats=out["enemy_stats"]), db=self.db, user=self.admin)
        g = get_scrim(s.id, db=self.db, user=self.admin)["games"][0]
        self.assertEqual(g["player_stats"]["GOLD"]["rating"], 11.6)
        self.assertEqual(g["enemy_stats"]["ROAM"]["hero"], "Chip")
        perf = player_performance(self.db, self.p["TOBI"].id)
        self.assertEqual(perf["overall"]["rating"], {"games": 1, "avg": 11.6, "mvps": 1})
        self.assertEqual(perf["recent"][0]["mvp"], True)

    def test_tournament_games_keep_scoreboard_lines_and_low_ratings_get_flagged(self) -> None:
        t = Tournament(name="Cup")
        self.db.add(t)
        self.db.flush()
        m = TournamentMatch(tournament_id=t.id, match_no=1, opponent="Zenith", status="played", result="WIN",
                            score_us=3, score_them=0, format="BO5", scheduled_date=date(2026, 10, 9))
        self.db.add(m)
        self.db.commit()
        self.db.add(HeroPoolEntry(user_id=self.p["TOBI"].id, hero_id=self.db.query(Hero).filter_by(name="Karrie").one().id,
                                  category="comfort", confidence=7))
        self.db.commit()
        for no in (1, 2, 3):
            save_game_draft(m.id, no, GameDraftIn(draft={"our_picks": {"GOLD": "Karrie"}}, result="WIN",  # winning, but rated low
                                                  lineup=self.lineup,
                                                  player_stats={"GOLD": {"kills": 3, "deaths": 2, "assists": 9, "rating": 5.1}},
                                                  enemy_stats={"GOLD": {"hero": "Claude", "kills": 9, "rating": "10.4"}}),
                            db=self.db, user=self.admin)
        # Saving the draft again without stats keeps them.
        out = save_game_draft(m.id, 1, GameDraftIn(draft={"our_picks": {"GOLD": "Karrie", "MID": "Yve"}}),
                              db=self.db, user=self.admin)
        game1 = out["matches"][0]["games"][0]
        self.assertEqual(game1["player_stats"]["GOLD"]["rating"], 5.1)
        self.assertEqual(game1["enemy_stats"]["GOLD"], {"kills": 9, "rating": 10.4, "hero": "Claude"})
        perf = player_performance(self.db, self.p["TOBI"].id)
        self.assertEqual(perf["tournaments"]["kda"]["ratio"], 6.0)
        alert = next(a for a in perf["focus"] if a["hero"] == "Karrie")
        self.assertEqual(alert["kind"], "low_rating")
        self.assertIn("Average rating 5.1 over 3 rated games", alert["detail"])

    def test_strategy_writer_uses_team_records_and_fills_the_form_only(self) -> None:
        s = Scrim(number=1, opponent="Onyx", scrim_date=date(2026, 10, 1), lineup=dumps(self.lineup),
                  status="played", result="LOSS", score_us=0, score_them=1)
        self.db.add(s)
        self.db.commit()
        add_game(s.id, GameIn(game_no=1, result="LOSS", draft={"our_picks": {"GOLD": "Karrie"}, "enemy_picks": {"JUNGLE": "Ling"},
                                                              "enemy_bans": ["Fanny"]}), db=self.db, user=self.admin)
        reply = {"title": "Beat Onyx's Ling", "category": "teamfight", "opponent": "", "tags": ["#onyx", "ling"],
                 "body": "## Win condition\nDeny Ling."}
        with patch.dict(os.environ, KEY), patch.object(ai_strategy_writer, "call_model", return_value=reply) as call:
            out = strategy(StrategyAIIn(topic="How do we beat their Ling?", opponent="Onyx"), db=self.db, user=self.coach)
        sent = call.call_args.args[2]
        self.assertIn('"against_opponent"', sent)
        self.assertIn('"their_picks": {"JUNGLE": "Ling"}', sent)
        self.assertIn('"name": "TOBI"', sent)
        self.assertEqual(out["title"], "Beat Onyx's Ling")
        self.assertEqual(out["category"], "TEAMFIGHT")
        self.assertEqual(out["tags"], ["onyx", "ling"])
        self.assertEqual(out["opponent"], "Onyx")
        self.assertEqual(self.db.query(app.models.StrategyNote).count(), 0)  # nothing saved
        with self.assertRaises(HTTPException) as err:
            strategy(StrategyAIIn(topic="x"), db=self.db, user=self.p["TOBI"])
        self.assertEqual(err.exception.status_code, 403)

    def test_strategy_can_be_written_from_an_uploaded_document(self) -> None:
        doc = UPLOAD_DIR / "test0strategydoc.md"
        doc.write_text("Our turtle plan: rotate roam at 1:45, jungle takes lord at 8:00.", encoding="utf-8")
        self.addCleanup(lambda: doc.unlink(missing_ok=True))
        reply = {"title": "Turtle setup", "category": "objective", "tags": [], "body": "## Plan\nRotate at 1:45."}
        with patch.dict(os.environ, KEY), patch.object(ai_strategy_writer, "call_model", return_value=reply) as call:
            out = strategy(StrategyAIIn(document_url=f"/api/files/{doc.name}"), db=self.db, user=self.coach)
        sent = call.call_args.args[2]
        self.assertIn('"reference_document"', sent)
        self.assertIn("rotate roam at 1:45", sent)
        self.assertEqual(out["title"], "Turtle setup")
        img = UPLOAD_DIR / "test0strategypic.png"
        img.write_bytes(b"\x89PNG\r\n\x1a\n")
        self.addCleanup(lambda: img.unlink(missing_ok=True))
        with patch.dict(os.environ, KEY), self.assertRaises(HTTPException) as err:
            strategy(StrategyAIIn(document_url=f"/api/files/{img.name}"), db=self.db, user=self.coach)
        self.assertEqual(err.exception.status_code, 422)

    def test_ai_chat_sees_own_games_and_team_records_only_when_asked_about_the_team(self) -> None:
        s = Scrim(number=1, opponent="Onyx", scrim_date=date(2026, 10, 1), lineup=dumps(self.lineup),
                  status="played", result="WIN", score_us=1)
        self.db.add(s)
        self.db.commit()
        add_game(s.id, GameIn(game_no=1, result="WIN", draft={"our_picks": {"GOLD": "Karrie"}},
                              player_stats={"GOLD": {"kills": 7, "deaths": 1, "assists": 4, "rating": 10.2}}),
                 db=self.db, user=self.admin)
        mine = member_team_games(self.db, self.p["TOBI"].id)
        self.assertEqual(mine["all_games"]["games"], 1)
        self.assertEqual(mine["heroes"][0]["hero"], "Karrie")
        self.assertEqual(mine["recent_games"][0]["rating"], 10.2)
        tobi = self.p["TOBI"]
        self.assertIsNone(team_records_for(self.db, "review my recent scrims and my stats", tobi))
        self.assertIsNone(team_records_for(self.db, "how am I doing, TOBI?", tobi))  # own name isn't "another player"
        for q in ("how is our team doing in scrims?", "what should MIRA work on?", "game plan vs onyx"):
            with self.subTest(q):
                self.assertIsNotNone(team_records_for(self.db, q, tobi))
        staff = team_records_for(self.db, "show me scrim stats", self.coach)
        self.assertEqual(staff["scrim_record"]["game_wins"], 1)
        self.assertEqual(next(p for p in staff["players"] if p["name"] == "TOBI")["all_games"]["avg_rating"], 10.2)
        self.assertEqual(team_records_for(self.db, "game plan vs Onyx", tobi)["against_opponent"]["wins"], 1)


if __name__ == "__main__":
    unittest.main()
