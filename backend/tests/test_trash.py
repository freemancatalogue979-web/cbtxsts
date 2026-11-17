"""Trash: every delete lands in Trash first and can be restored."""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.main  # noqa: E402,F401  (registers every model)
from app import trash  # noqa: E402
from app.clover_ai_models import AIConversation, AIMemoryNote, AIMessage  # noqa: E402
from app.db import Base  # noqa: E402
from app.models import (  # noqa: E402
    ArchiveComment, ArchiveFolder, ArchiveItem, MatchReview, Notification, Scrim, ScrimGame,
    Tournament, TournamentMatch, TrashItem, User,
)
from app.routers import archive, clover_ai, notifications, scrims, tournaments  # noqa: E402
from app.routers import trash as trash_api  # noqa: E402
from app.routers.admin import DataWipeIn, data_wipe  # noqa: E402


class TrashTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:")

        @event.listens_for(self.engine, "connect")
        def _fk(conn, _rec):  # same rules as production
            conn.execute("PRAGMA foreign_keys=ON")

        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.admin = User(email="a@9clover.gg", password_hash="x", name="Admin", ign="DRE", role="admin")
        self.cap = User(email="c@9clover.gg", password_hash="x", name="Cap", ign="KAZE", role="captain")
        self.p1 = User(email="p1@9clover.gg", password_hash="x", name="P1", ign="RINJI", role="player")
        self.p2 = User(email="p2@9clover.gg", password_hash="x", name="P2", ign="SORA", role="player")
        self.db.add_all([self.admin, self.cap, self.p1, self.p2])
        self.db.commit()
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        (root / "trash").mkdir()
        (root / "archive").mkdir()
        self.patches = [mock.patch.object(trash, "TRASH_DIR", root / "trash"),
                        mock.patch.object(trash, "DATA_DIR", root),
                        mock.patch.object(archive, "ARCHIVE_DIR", root / "archive")]
        for p in self.patches:
            p.start()
        self.root = root

    def tearDown(self) -> None:
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()
        self.db.close()
        self.engine.dispose()

    # helpers ---------------------------------------------------------------- #
    def bin_for(self, user: User) -> list[dict]:
        return trash_api.list_trash(area=None, q=None, db=self.db, user=user)["items"]

    def restore(self, user: User, item_id: int) -> dict:
        return trash_api.restore_item(item_id, db=self.db, user=user)

    def scrim(self, number=7) -> Scrim:
        s = Scrim(number=number, opponent="Onyx", format="BO3", status="played")
        self.db.add(s)
        self.db.flush()
        self.db.add_all([ScrimGame(scrim_id=s.id, game_no=1, result="WIN"),
                         ScrimGame(scrim_id=s.id, game_no=2, result="LOSS"),
                         ScrimGame(scrim_id=s.id, game_no=3, result="WIN")])
        self.db.commit()
        return s

    # tests ------------------------------------------------------------------ #
    def test_scrim_with_games_comes_back_whole_with_its_review_link(self) -> None:
        s = self.scrim()
        review = MatchReview(opponent="Onyx", scrim_id=s.id, result="WIN", created_by=self.cap.id)
        self.db.add(review)
        self.db.commit()
        sid = s.id
        scrims.delete_scrim(sid, db=self.db, user=self.cap)
        self.assertIsNone(self.db.get(Scrim, sid))
        self.db.refresh(review)
        self.assertIsNone(review.scrim_id)  # SET NULL on delete

        [entry] = self.bin_for(self.cap)
        self.assertEqual(entry["label"], "Scrim #7 vs Onyx")
        self.assertIn("3 games", entry["summary"])
        self.assertIn("1 link", entry["summary"])

        out = self.restore(self.cap, entry["id"])
        self.assertEqual(out["target_id"], str(sid))
        self.db.expire_all()
        back = self.db.get(Scrim, sid)
        self.assertEqual(sorted(g.game_no for g in back.games), [1, 2, 3])
        self.assertEqual(self.db.get(MatchReview, review.id).scrim_id, sid)
        self.assertEqual(self.bin_for(self.cap), [])

    def test_restored_game_rescores_its_scrim(self) -> None:
        s = self.scrim()
        scrims._rescore(s)
        self.db.commit()
        game = next(g for g in s.games if g.game_no == 2)
        scrims.delete_game(s.id, game.id, db=self.db, user=self.cap)
        self.db.refresh(s)
        self.assertEqual((s.score_us, s.score_them), (2, 0))
        [entry] = self.bin_for(self.cap)
        self.restore(self.cap, entry["id"])
        self.db.expire_all()
        s = self.db.get(Scrim, s.id)
        self.assertEqual((s.score_us, s.score_them), (2, 1))

    def test_new_row_took_the_old_id_so_children_follow_a_new_id(self) -> None:
        s = self.scrim(number=7)
        old_id = s.id
        scrims.delete_scrim(old_id, db=self.db, user=self.cap)
        newer = Scrim(id=old_id, number=8, opponent="Zenith")  # SQLite reuses the top id
        self.db.add(newer)
        self.db.commit()
        [entry] = self.bin_for(self.cap)
        out = self.restore(self.cap, entry["id"])
        self.assertNotEqual(out["target_id"], str(old_id))
        self.db.expire_all()
        back = self.db.get(Scrim, int(out["target_id"]))
        self.assertEqual(back.number, 7)
        self.assertEqual(len(back.games), 3)
        self.assertEqual(len(self.db.get(Scrim, old_id).games), 0)

    def test_unique_value_taken_since_delete_is_a_readable_409(self) -> None:
        s = self.scrim(number=7)
        scrims.delete_scrim(s.id, db=self.db, user=self.cap)
        self.db.add(Scrim(number=7, opponent="Someone else"))
        self.db.commit()
        [entry] = self.bin_for(self.cap)
        with self.assertRaises(HTTPException) as err:
            self.restore(self.cap, entry["id"])
        self.assertEqual(err.exception.status_code, 409)
        self.assertIn("number 7", err.exception.detail)
        self.assertEqual(len(self.bin_for(self.cap)), 1)  # still in Trash

    def test_child_whose_parent_is_gone_asks_for_the_parent_first(self) -> None:
        t = Tournament(name="Cup", status="ongoing")
        self.db.add(t)
        self.db.flush()
        m = TournamentMatch(tournament_id=t.id, match_no=1, opponent="Onyx")
        self.db.add(m)
        self.db.commit()
        tournaments.delete_match(m.id, db=self.db, user=self.cap)
        tournaments.delete_tournament(t.id, db=self.db, user=self.cap)
        match_entry = next(e for e in self.bin_for(self.cap) if e["kind"] == "tournament_match")
        with self.assertRaises(HTTPException) as err:
            self.restore(self.cap, match_entry["id"])
        self.assertIn("Restore that tournament from Trash first", err.exception.detail)
        cup = next(e for e in self.bin_for(self.cap) if e["kind"] == "tournament")
        self.restore(self.cap, cup["id"])
        self.restore(self.cap, match_entry["id"])
        self.db.expire_all()
        self.assertEqual([x.opponent for x in self.db.get(Tournament, t.id).matches], ["Onyx"])

    def test_cleared_tournament_game_sheet_comes_back(self) -> None:
        t = Tournament(name="Cup", status="ongoing")
        self.db.add(t)
        self.db.flush()
        m = TournamentMatch(tournament_id=t.id, match_no=1, opponent="Onyx", format="BO3")
        self.db.add(m)
        self.db.commit()
        tournaments.update_match(m.id, tournaments.MatchPatch(status="played", result="WIN", score_us=2, score_them=0),
                                 db=self.db, user=self.cap)
        draft = {"our_bans": [], "enemy_bans": [], "our_picks": {"GOLD": "Claude"}, "enemy_picks": {}}
        tournaments.save_game_draft(m.id, 1, tournaments.GameDraftIn(draft=draft, lineup={"GOLD": self.p1.id}),
                                    db=self.db, user=self.cap)
        tournaments.clear_game_draft(m.id, 1, db=self.db, user=self.cap)
        self.db.refresh(m)
        self.assertFalse(any(g["game_no"] == 1 for g in tournaments.match_games(m)))
        [entry] = self.bin_for(self.cap)
        self.assertEqual(entry["summary"], "who played · draft")
        self.restore(self.cap, entry["id"])
        self.db.expire_all()
        g1 = next(g for g in tournaments.match_games(self.db.get(TournamentMatch, m.id)) if g["game_no"] == 1)
        self.assertEqual(g1["lineup"]["GOLD"], self.p1.id)
        self.assertEqual(g1["draft"]["our_picks"]["GOLD"], "Claude")

    def test_private_drop_is_invisible_to_admin_in_trash_and_file_round_trips(self) -> None:
        folder = ArchiveFolder(owner_id=self.p1.id, name="Rinji")
        self.db.add(folder)
        self.db.flush()
        (self.root / "archive" / "abc123.png").write_bytes(b"png!")
        item = ArchiveItem(folder_id=folder.id, title="Secret rotation", kind="file", file_stored="abc123.png",
                           visibility="private", shared=f"[{self.p2.id}]", created_by=self.p1.id)
        self.db.add(item)
        self.db.flush()
        self.db.add(ArchiveComment(item_id=item.id, user_id=self.p1.id, body="note to self"))
        self.db.commit()
        archive.delete_item(item.id, db=self.db, user=self.p1)
        self.assertFalse((self.root / "archive" / "abc123.png").exists())

        self.assertEqual(self.bin_for(self.admin), [])
        self.assertEqual(self.bin_for(self.p2), [])
        with self.assertRaises(HTTPException) as err:
            self.restore(self.admin, self.db.query(TrashItem).one().id)
        self.assertEqual(err.exception.status_code, 404)

        [entry] = self.bin_for(self.p1)
        self.assertTrue(entry["restricted"] and entry["can_purge"])
        self.assertIn("1 comment", entry["summary"])
        self.restore(self.p1, entry["id"])
        self.assertEqual((self.root / "archive" / "abc123.png").read_bytes(), b"png!")
        self.db.expire_all()
        self.assertEqual(len(self.db.get(ArchiveItem, item.id).comments), 1)

    def test_locker_restore_refused_while_owner_has_a_new_locker(self) -> None:
        folder = ArchiveFolder(owner_id=self.p1.id, name="Rinji")
        self.db.add(folder)
        self.db.commit()
        archive.delete_folder(folder.id, db=self.db, user=self.p1)
        self.db.add(ArchiveFolder(owner_id=self.p1.id, name="Rinji v2"))
        self.db.commit()
        [entry] = self.bin_for(self.p1)
        with self.assertRaises(HTTPException) as err:
            self.restore(self.p1, entry["id"])
        self.assertIn("already a locker for that owner", err.exception.detail)

    def test_purge_rules(self) -> None:
        s = self.scrim()
        scrims.delete_scrim(s.id, db=self.db, user=self.cap)
        [entry] = self.bin_for(self.cap)
        self.assertFalse(entry["can_purge"])
        with self.assertRaises(HTTPException) as err:
            trash_api.purge_item(entry["id"], db=self.db, user=self.cap)
        self.assertEqual(err.exception.status_code, 403)
        self.assertEqual(len(self.bin_for(self.p1)), 0)  # not theirs, not admin
        trash_api.purge_item(entry["id"], db=self.db, user=self.admin)
        self.assertEqual(self.db.query(TrashItem).count(), 0)

    def test_empty_trash_only_purges_what_you_may(self) -> None:
        s = self.scrim()
        scrims.delete_scrim(s.id, db=self.db, user=self.cap)
        conv = AIConversation(owner_id=self.cap.id, title="Draft help")
        self.db.add(conv)
        self.db.commit()
        clover_ai.delete_conversation(conv.id, user=self.cap, db=self.db)
        out = trash_api.empty_trash(confirm=True, db=self.db, user=self.cap)
        self.assertEqual(out["deleted"], 1)  # their private chat, not the shared scrim
        self.assertEqual([e["kind"] for e in self.bin_for(self.cap)], ["scrim"])

    def test_ai_chat_is_owner_only_and_messages_come_back(self) -> None:
        conv = AIConversation(owner_id=self.p1.id, title="Lane help")
        self.db.add(conv)
        self.db.flush()
        self.db.add_all([AIMessage(conversation_id=conv.id, role="user", content="hi"),
                         AIMessage(conversation_id=conv.id, role="assistant", content="hello")])
        self.db.commit()
        clover_ai.delete_conversation(conv.id, user=self.p1, db=self.db)
        self.assertEqual(self.bin_for(self.admin), [])
        [entry] = self.bin_for(self.p1)
        self.assertEqual(entry["label"], "Lane help")
        self.restore(self.p1, entry["id"])
        self.db.expire_all()
        self.assertEqual(len(self.db.get(AIConversation, conv.id).messages), 2)

    def test_memory_note_takes_a_free_slot_when_its_slot_is_used(self) -> None:
        note = AIMemoryNote(user_id=self.p1.id, slot=0, category="goal", content="Ward more")
        self.db.add(note)
        self.db.commit()
        clover_ai.delete_memory(note.id, user=self.p1, db=self.db)
        self.db.add(AIMemoryNote(user_id=self.p1.id, slot=0, category="goal", content="Rotate early"))
        self.db.commit()
        [entry] = self.bin_for(self.p1)
        self.restore(self.p1, entry["id"])
        slots = {n.content: n.slot for n in self.db.query(AIMemoryNote).filter_by(user_id=self.p1.id)}
        self.assertEqual(slots, {"Rotate early": 0, "Ward more": 1})

    def test_own_inbox_notification_is_private(self) -> None:
        n = Notification(user_id=self.p1.id, actor_id=self.cap.id, kind="reminder", title="Ranked tonight", body="")
        self.db.add(n)
        self.db.commit()
        notifications.delete_notification(n.id, retract_all=False, db=self.db, user=self.p1)
        self.assertEqual(self.bin_for(self.admin), [])
        [entry] = self.bin_for(self.p1)
        self.restore(self.p1, entry["id"])
        self.assertIsNotNone(self.db.get(Notification, n.id))

    def test_data_wipe_restores_everything_without_duplicates(self) -> None:
        s = self.scrim()
        self.db.add(MatchReview(opponent="Onyx", scrim_id=s.id, result="WIN", created_by=self.cap.id))
        self.db.commit()
        data_wipe(DataWipeIn(tables=["scrims", "scrim_games", "match_reviews"], confirm=True),
                  db=self.db, user=self.admin)
        self.assertEqual(self.db.query(ScrimGame).count(), 0)
        [entry] = self.bin_for(self.admin)
        self.assertEqual(entry["kind"], "data_wipe")
        self.restore(self.admin, entry["id"])
        self.assertEqual(self.db.query(Scrim).count(), 1)
        self.assertEqual(self.db.query(ScrimGame).count(), 3)
        self.assertEqual(self.db.query(MatchReview).one().scrim_id, s.id)

    def test_undo_header_ids_are_collected_per_request(self) -> None:
        ids = trash.begin_request()
        s = self.scrim()
        scrims.delete_scrim(s.id, db=self.db, user=self.cap)
        self.assertEqual(ids, [self.db.query(TrashItem).one().id])


if __name__ == "__main__":
    unittest.main()
