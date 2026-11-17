"""A tournament series gets one draft per game played: BO3 2–0 → 2 drafts, 2–1 → 3."""
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
from app.models import Tournament, TournamentMatch, User, dumps  # noqa: E402
from app.routers.tournaments import (  # noqa: E402
    GameDraftIn, MatchPatch, clear_game_draft, max_games, save_game_draft, update_match,
)


def draft(hero: str) -> dict:
    return {"our_bans": [hero, "", "", "", ""], "enemy_bans": ["", "", "", "", ""],
            "our_picks": {"Gold": "Claude"}, "enemy_picks": {}}


class TournamentGameDraftTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.user = User(email="cap@9clover.gg", password_hash="x", name="Cap", ign="DRE", role="captain")
        self.db.add(self.user)
        t = Tournament(name="Snapshot Cup", status="ongoing")
        self.db.add(t)
        self.db.flush()
        self.match = TournamentMatch(tournament_id=t.id, match_no=1, opponent="Zenith", format="BO3")
        self.db.add(self.match)
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _match(self, out: dict) -> dict:
        return next(m for m in out["matches"] if m["id"] == self.match.id)

    def _score(self, us: int, them: int) -> dict:
        return self._match(update_match(self.match.id, MatchPatch(status="played", score_us=us, score_them=them),
                                        db=self.db, user=self.user))

    def test_format_parsing(self) -> None:
        self.assertEqual([max_games(f) for f in ("BO1", "BO3", "BO5", "BO7", "bo3", "", "custom")], [1, 3, 5, 7, 3, 7, 7])

    def test_two_nil_gives_two_game_drafts_and_blocks_a_third(self) -> None:
        self.assertEqual(self._score(2, 0)["game_slots"], 2)
        save_game_draft(self.match.id, 1, GameDraftIn(draft=draft("Ling"), result="win"), db=self.db, user=self.user)
        out = self._match(save_game_draft(self.match.id, 2, GameDraftIn(draft=draft("Fanny"), result="WIN"),
                                          db=self.db, user=self.user))
        self.assertEqual([g["game_no"] for g in out["games"]], [1, 2])
        self.assertEqual([g["result"] for g in out["games"]], ["WIN", "WIN"])
        self.assertEqual(out["games"][1]["draft"]["our_bans"][0], "Fanny")
        self.assertEqual(out["draft"]["our_bans"][0], "Ling")  # legacy field = game 1
        with self.assertRaises(HTTPException) as err:
            save_game_draft(self.match.id, 3, GameDraftIn(draft=draft("Joy")), db=self.db, user=self.user)
        self.assertEqual(err.exception.status_code, 422)

    def test_two_one_gives_three_game_drafts(self) -> None:
        self.assertEqual(self._score(2, 1)["game_slots"], 3)
        for no in (1, 2, 3):
            out = save_game_draft(self.match.id, no, GameDraftIn(draft=draft(f"H{no}")), db=self.db, user=self.user)
        games = self._match(out)["games"]
        self.assertEqual([g["draft"]["our_bans"][0] for g in games], ["H1", "H2", "H3"])
        with self.assertRaises(HTTPException):  # a BO3 never has a game 4
            save_game_draft(self.match.id, 4, GameDraftIn(draft=draft("X")), db=self.db, user=self.user)

    def test_unplayed_match_offers_one_planning_draft(self) -> None:
        self.assertEqual(self._match(update_match(self.match.id, MatchPatch(notes="prep"), db=self.db, user=self.user))["game_slots"], 1)

    def test_legacy_single_draft_reads_as_game_one_and_is_kept_when_game_two_is_added(self) -> None:
        self.match.draft = dumps(draft("Old"))
        self.db.commit()
        out = self._score(2, 0)
        self.assertEqual([g["game_no"] for g in out["games"]], [1])
        out = self._match(save_game_draft(self.match.id, 2, GameDraftIn(draft=draft("New")), db=self.db, user=self.user))
        self.assertEqual([g["draft"]["our_bans"][0] for g in out["games"]], ["Old", "New"])

    def test_correcting_the_score_keeps_saved_drafts_and_clearing_removes_one(self) -> None:
        self._score(2, 1)
        for no in (1, 2, 3):
            save_game_draft(self.match.id, no, GameDraftIn(draft=draft(f"H{no}")), db=self.db, user=self.user)
        out = self._score(2, 0)
        self.assertEqual(out["game_slots"], 3)  # game 3 is not silently thrown away
        out = self._match(clear_game_draft(self.match.id, 3, db=self.db, user=self.user))
        self.assertEqual([g["game_no"] for g in out["games"]], [1, 2])
        self.assertEqual(out["game_slots"], 2)

    def test_empty_draft_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as err:
            save_game_draft(self.match.id, 1, GameDraftIn(draft={"our_bans": ["", ""]}), db=self.db, user=self.user)
        self.assertEqual(err.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()
