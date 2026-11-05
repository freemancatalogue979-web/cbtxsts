"""Archive adaptation regressions. Isolated SQLite only; never writes the app DB.

    backend/.venv/bin/python backend/tests/archive_regressions.py
"""
from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db import Base
from app.models import Course, Question, Quiz, Room, RoomAnswer, RoomMember, Student, TeamMatch, TeamMatchPlayer, utcnow
from app.services import room, ranked_teams
from app.services.questions import display_order
from app.serializers import question_public


class ArchiveRegressions(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = create_engine(f"sqlite:///{self.temp.name}/test.db")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine, autoflush=False)
        self.players = [Student(name=f"Player {i}", username=f"player{i}", phone=f"0800000000{i}") for i in range(2)]
        self.db.add_all(self.players)
        self.course = Course(code="ENG 101", title="English")
        self.db.add(self.course)
        self.db.flush()
        self.quiz = Quiz(course_id=self.course.id, title="Archive checks")
        self.db.add(self.quiz)
        self.db.flush()
        self.questions = [Question(quiz_id=self.quiz.id, course_id=self.course.id, text=f"Question {i}?", option_a="Yes", option_b="No", option_c="Maybe", option_d="Never", correct="A", explanation=f"Explanation {i}") for i in range(6)]
        self.db.add_all(self.questions)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        self.temp.cleanup()

    def live_room(self):
        host, guest = self.players
        instance = room.create_room(self.db, host, title="Race", course_id=self.course.id, question_count=3, per_question_seconds=10)
        room.join_room(self.db, guest, instance.code)
        room.start_run(self.db, instance)
        opened = room.open_next(self.db, instance)
        self.db.commit()
        return instance, opened

    def test_private_question_recovery_survives_new_session(self):
        instance, opened = self.live_room()
        expected = dict(opened[1])
        with Session(self.engine) as fresh:
            restored = fresh.get(Room, instance.id)
            for player in self.players:
                snapshot = room.current_round_state(fresh, restored, player.id)
                self.assertEqual(snapshot["question"]["question"]["id"], expected[player.id]["question"]["id"])
                self.assertNotIn("correct", snapshot["question"]["question"])
                self.assertIsNone(snapshot["reveal"])
            self.assertNotEqual(expected[self.players[0].id]["question"]["id"], expected[self.players[1].id]["question"]["id"])

    def test_timeout_reveals_then_auto_advances_and_finishes_once(self):
        instance, _ = self.live_room()
        for index in range(3):
            instance.round_deadline = utcnow() - timedelta(seconds=1)
            events = room.advance_rooms(self.db)
            self.assertEqual([event.event for event in events], ["room_reveal", "room_reveal"])
            self.assertTrue(all(event.scope == "student" for event in events))
            self.assertEqual(room.advance_rooms(self.db), [], "must leave time to read reveal")
            instance.round_revealed_at = utcnow() - timedelta(seconds=3)
            with patch.object(room.game, "grant") as grant:
                events = room.advance_rooms(self.db)
                if index < 2:
                    self.assertEqual(instance.round_index, index + 1)
                    self.assertTrue(all(event.event == "room_question" and event.scope == "student" for event in events))
                else:
                    self.assertEqual(instance.status, "finished")
                    self.assertEqual(events[0].event, "room_finish")
                    calls = grant.call_count
                    room.finish_run(self.db, instance)
                    room.finished_payload(self.db, instance)
                    self.assertEqual(grant.call_count, calls)
        self.assertEqual(room.advance_rooms(self.db), [])

    def test_all_answered_advances_early_and_reconnect_preserves_lock(self):
        instance, _ = self.live_room()
        for player in self.players:
            result, _ = room.submit_answer(self.db, instance, player, "A", 100)
            self.assertTrue(result["correct"])
        snapshot = room.current_round_state(self.db, instance, self.players[1].id)
        self.assertTrue(snapshot["question"]["answered"])
        self.assertEqual(set(room.room_state(self.db, instance, self.players[0].id)["locked_ids"]), {p.id for p in self.players})
        self.assertEqual(len(room.advance_rooms(self.db)), 2)
        with self.assertRaises(room.RoomError):
            room.submit_answer(self.db, instance, self.players[0], "B", 100)

    def test_legacy_live_room_recovers_clock_without_skipping_deal(self):
        instance, opened = self.live_room()
        instance.round_deadline = None
        self.assertEqual(room.advance_rooms(self.db), [])
        self.assertEqual(instance.round_index, 0)
        snapshot = room.current_round_state(self.db, instance, self.players[0].id)
        self.assertEqual(snapshot["question"]["question"]["id"], dict(opened[1])[self.players[0].id]["question"]["id"])

    def test_ranked_feedback_is_private_current_round_and_display_label(self):
        match = TeamMatch(status="live", team_size=1, question_count=3, round_index=0, round_deadline=utcnow() + timedelta(seconds=20), round_opened_at=utcnow())
        self.db.add(match)
        self.db.flush()
        members = [TeamMatchPlayer(match_id=match.id, student_id=p.id, team=i, set_ids=[q.id for q in self.questions[i * 3:(i + 1) * 3]]) for i, p in enumerate(self.players)]
        self.db.add_all(members)
        self.db.flush()
        q = self.questions[0]
        order = display_order(q, shuffle=True, seed=f"team:{match.id}:{q.id}")
        label = question_public(q, reveal=True, order=order)["correct_label"]
        with patch.object(ranked_teams, "mastery_scope_update"), patch.object(ranked_teams.study_lab, "resolve_mistake"):
            result = ranked_teams.submit_answer(self.db, match, self.players[0], q.id, label, 100)
        self.assertTrue(result["correct"])
        self.assertEqual(result["correct_answer"], label)
        state = ranked_teams.match_state(self.db, match, self.players[0].id)
        self.assertTrue(state["you"]["answered_this_round"])
        self.assertEqual(state["you"]["round_result"]["question_id"], q.id)
        self.assertEqual(state["you"]["round_result"]["correct_answer"], label)
        opponent = ranked_teams.match_state(self.db, match, self.players[1].id)
        self.assertFalse(opponent["you"]["answered_this_round"])
        self.assertIsNone(opponent["you"]["round_result"])
        self.assertNotIn("correct", opponent["current"])
        match.round_index = 1
        new_round = ranked_teams.match_state(self.db, match, self.players[0].id)
        self.assertFalse(new_round["you"]["answered_this_round"])
        self.assertIsNone(new_round["you"]["round_result"], "never show previous explanation under a new question")

    def test_profile_backdrop_upload_validation_and_public_persistence(self):
        import base64
        from io import BytesIO
        from fastapi import HTTPException
        from pydantic import ValidationError
        from PIL import Image
        from app.routers.auth import upload_banner, remove_banner, update_me
        from app.routers.social import player_banner
        from app.schemas import PhotoIn, ProfileUpdateIn
        from app.serializers import student_public

        player = self.players[0]
        out = BytesIO()
        Image.new("RGB", (120, 80), "navy").save(out, format="PNG")
        image = "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()
        result = upload_banner(PhotoIn(image=image), self.db, player)
        self.assertTrue(result["has_banner"])
        self.assertTrue(result["banner_version"])
        self.assertNotIn("banner_image", student_public(player))
        response = player_banner(player.id, self.db, self.players[1])
        self.assertEqual(response.media_type, "image/jpeg")
        self.assertEqual(Image.open(BytesIO(response.body)).size, (960, 480))
        for bad in ["data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,YmFkLWltYWdl", "data:image/png;base64,??"]:
            with self.assertRaises(HTTPException) as raised:
                upload_banner(PhotoIn(image=bad), self.db, player)
            self.assertEqual(raised.exception.status_code, 422)
            self.assertTrue(player.banner_image, "a failed upload must preserve the current banner")
        with self.assertRaises(ValidationError):
            ProfileUpdateIn(profile_banner="javascript:alert(1)")
        update_me(ProfileUpdateIn(profile_banner="forest", profile_motion=False), player, self.db)
        with Session(self.engine) as fresh:
            recovered = student_public(fresh.get(Student, player.id))
            self.assertEqual(recovered["profile_banner"], "forest")
            self.assertFalse(recovered["profile_motion"])
            self.assertFalse(recovered["has_banner"])
        upload_banner(PhotoIn(image=image), self.db, player)
        self.assertFalse(remove_banner(self.db, player)["has_banner"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
