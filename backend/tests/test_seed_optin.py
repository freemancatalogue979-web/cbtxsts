"""Example roster and fictional operational content require explicit opt-in."""
import os
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.models import Scrim, TeamSettings, User
from app.seed import seed_if_empty


class SeedOptInTests(unittest.TestCase):
    def test_demo_requires_explicit_truthy_flag(self):
        for value, users, has_scrims in (("", 1, False), ("0", 1, False), ("1", 9, True)):
            with self.subTest(value=value), patch.dict(os.environ, {"CLOVER_DEMO_DATA": value}):
                engine = create_engine("sqlite:///:memory:")
                Base.metadata.create_all(engine)
                with Session(engine, autoflush=False) as db:
                    self.assertTrue(seed_if_empty(db))
                    self.assertEqual(db.query(User).count(), users)
                    self.assertEqual(bool(db.query(Scrim).count()), has_scrims)
                    self.assertEqual(bool(db.get(TeamSettings, 1).current_weakness), has_scrims)
                    self.assertFalse(seed_if_empty(db))
                engine.dispose()


if __name__ == "__main__":
    unittest.main()
