"""Regression coverage for the extensible Map Lab board format."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import Base  # noqa: E402
from app.routers.maps import create_board, delete_board, get_board, update_board  # noqa: E402
from app.schemas import MapBoardIn, MapBoardPatch  # noqa: E402


class MapBoardPersistenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.user = SimpleNamespace(id=7, role="admin")

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_new_boards_have_empty_step_chip_and_zone_collections(self) -> None:
        board = create_board(MapBoardIn(name="New board"), self.db, self.user)
        self.assertEqual(board["data"]["steps"], [])
        self.assertEqual(board["data"]["chips"], [])
        self.assertEqual(board["data"]["zones"], [])
        self.assertEqual(board["data"]["paths"], [])

    def test_linked_steps_and_preset_and_custom_chips_round_trip_with_legacy_data(self) -> None:
        old_data = {
            "tokens": [{"id": "hero-1", "hero": "Miya", "side": "ours", "x": 20, "y": 60}],
            "paths": [{"color": "#e11d48", "points": [[10, 10], [20, 20]]}],
            "text": [{"x": 15, "y": 30, "t": "Keep this"}],
            "other_extension": {"keep": True},
        }
        board = create_board(MapBoardIn(name="Existing board", data=old_data), self.db, self.user)
        steps = [
            {"id": "step-1", "number": 1, "mode": "arrow", "color": "#34d399",
             "points": [[20, 60], [40, 35]], "tokenId": "hero-1"},
            {"id": "step-2", "number": 2, "mode": "free", "color": "#34d399",
             "points": [[40, 35], [45, 25], [55, 30]], "parentId": "step-1"},
        ]
        chips = [
            {"id": "chip-1", "name": "Minion", "preset": "minion", "color": "#7db5f5", "size": 80, "x": 65, "y": 75},
            {"id": "chip-2", "name": "Custom callout", "color": "#f5b942", "size": 52, "x": 30, "y": 55},
        ]
        zones = [
            {"id": "zone-1", "tokenId": "hero-1", "x": 20, "y": 60, "radius": 24, "color": "#34d399"},
            {"id": "zone-2", "x": 50, "y": 30, "radius": 18, "color": "#7db5f5"},
        ]
        updated = {**old_data, "steps": steps, "chips": chips, "zones": zones}
        update_board(board["id"], MapBoardPatch(data=updated), self.db, self.user)

        # A fresh session verifies data actually survives a database round-trip.
        with Session(self.engine) as session:
            reloaded = get_board(board["id"], session, self.user)
        self.assertEqual(reloaded["data"], updated)
        self.assertEqual(reloaded["data"]["steps"][1]["parentId"], "step-1")
        self.assertEqual(reloaded["data"]["chips"][0]["preset"], "minion")
        self.assertNotIn("preset", reloaded["data"]["chips"][1])
        self.assertEqual(reloaded["data"]["zones"][0]["tokenId"], "hero-1")
        self.assertEqual(reloaded["data"]["zones"][1]["radius"], 18)
        self.assertEqual(reloaded["data"]["other_extension"], {"keep": True})

    def test_map_edits_follow_strategy_permissions(self) -> None:
        board = create_board(MapBoardIn(name="Staff plan"), self.db, self.user)
        for role in ("player", "analyst"):
            viewer = SimpleNamespace(id=8, role=role)
            self.assertEqual(get_board(board["id"], self.db, viewer)["name"], "Staff plan")
            for action in (
                lambda: create_board(MapBoardIn(name="No access"), self.db, viewer),
                lambda: update_board(board["id"], MapBoardPatch(name="Changed"), self.db, viewer),
                lambda: delete_board(board["id"], self.db, viewer),
            ):
                with self.subTest(role=role), self.assertRaises(HTTPException) as error:
                    action()
                self.assertEqual(error.exception.status_code, 403)
        for role in ("captain", "coach"):
            staff = SimpleNamespace(id=9, role=role)
            created = create_board(MapBoardIn(name=f"{role} plan"), self.db, staff)
            self.assertEqual(update_board(created["id"], MapBoardPatch(name="Updated"), self.db, staff)["name"], "Updated")
            delete_board(created["id"], self.db, staff)
        self.assertEqual(get_board(board["id"], self.db, self.user)["name"], "Staff plan")


if __name__ == "__main__":
    unittest.main()
