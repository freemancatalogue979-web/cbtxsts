"""Forms send "" for an optional date or link left empty. That must mean "none",
not fail with 422 Unprocessable Entity (POST /api/training/activities did)."""
from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path

from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.main  # noqa: E402,F401  (registers every model)
from app.db import Base  # noqa: E402
from app.models import User  # noqa: E402
from app.routers.players import DevPatch  # noqa: E402
from app.routers.tournaments import MatchIn, TournamentIn  # noqa: E402
from app.routers.training import create_activity, update_activity  # noqa: E402
from app.schemas import ActivityIn, ActivityPatch, DevIn, ReviewIn, ScrimIn, WeekIn  # noqa: E402


class BlankFormValueTests(unittest.TestCase):
    def test_blank_optional_dates_and_links_become_none(self) -> None:
        activity = ActivityIn(title="Lord timing", date="", week_id="", scrim_id="  ")
        self.assertIsNone(activity.date)
        self.assertIsNone(activity.week_id)
        self.assertIsNone(activity.scrim_id)
        self.assertIsNone(ActivityPatch(date="").date)
        self.assertIsNone(WeekIn(number=5, focus="Macro", start_date="", end_date="").start_date)
        self.assertIsNone(ScrimIn(opponent="Zenith 5", date="").date)
        self.assertIsNone(TournamentIn(name="Clash", start_date="", end_date="").end_date)
        self.assertIsNone(MatchIn(opponent="Nova Kings", scheduled_date="").scheduled_date)
        self.assertIsNone(DevIn(date="").date)
        self.assertIsNone(DevPatch(date="").date)
        review = ReviewIn(opponent="Zenith 5", date="", action_deadline="", scrim_id="", action_assignee_id="")
        self.assertIsNone(review.date)
        self.assertIsNone(review.action_deadline)
        self.assertIsNone(review.scrim_id)
        self.assertIsNone(review.action_assignee_id)

    def test_real_values_still_parse_and_garbage_is_still_rejected(self) -> None:
        self.assertEqual(ActivityIn(title="x", date="2026-11-20", week_id="3").date, date(2026, 11, 20))
        self.assertEqual(ActivityIn(title="x", week_id="3").week_id, 3)
        with self.assertRaises(ValidationError):
            ActivityIn(title="x", date="next tuesday")
        with self.assertRaises(ValidationError):
            ActivityIn(title="x", week_id="abc")


class ActivityRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.user = User(email="coach@9clover.gg", password_hash="x", name="Coach", ign="ICHIZU", role="coach")
        self.db.add(self.user)
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_activity_without_a_date_saves_and_a_date_can_be_cleared(self) -> None:
        body = {"week_id": None, "title": "Objective drill", "category": "OBJECTIVE DRILL", "date": "",
                "time": "21:00", "duration_min": 60, "assigned_player_ids": [], "required": True, "status": "scheduled"}
        created = create_activity(ActivityIn(**body), self.db, self.user)
        self.assertIsNone(created["date"])
        dated = update_activity(created["id"], ActivityPatch(date="2026-11-20"), self.db, self.user)
        self.assertEqual(dated["date"], "2026-11-20")
        cleared = update_activity(created["id"], ActivityPatch(date=""), self.db, self.user)
        self.assertIsNone(cleared["date"])


if __name__ == "__main__":
    unittest.main()
