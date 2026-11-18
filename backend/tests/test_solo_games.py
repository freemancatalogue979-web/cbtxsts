"""Utility AI + Learning utility: a member's own solo games from screenshots, documents and sheets."""
from __future__ import annotations

import io
import os
import sys
import unittest
import zipfile
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.main  # noqa: E402,F401  (registers every model)
from app import ai_game_import, ai_solo_coach, solo_games as sg  # noqa: E402
from app.config import UPLOAD_DIR  # noqa: E402
from app.db import Base  # noqa: E402
from app.models import Hero, HeroPoolEntry, SoloGame, User, utcnow  # noqa: E402
from app.routers import solo_games as api  # noqa: E402
from app.routers.dashboard import my_form  # noqa: E402
from app.routers.players import player_detail  # noqa: E402
from app.trash import TrashItem  # noqa: E402

KEY = {"DEEPSEEK_API_KEY": "synthetic-key"}
HEROES = {"Ling": "JUNGLE", "Hayabusa": "JUNGLE", "Fanny": "JUNGLE", "Yu Zhong": "EXP", "Karrie": "GOLD", "Khufra": "ROAM"}


def minimal_pdf(lines: list[str]) -> bytes:
    """A one-page PDF with real text (enough for pypdf to extract)."""
    text = " T* ".join(f"({line}) Tj" for line in lines)
    stream = f"BT /F1 11 Tf 14 TL 40 780 Td {text} ET".encode()
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offsets = io.BytesIO(), []
    out.write(b"%PDF-1.4\n")
    for i, body in enumerate(objs, 1):
        offsets.append(out.tell())
        out.write(b"%d 0 obj\n" % i + body + b"\nendobj\n")
    xref = out.tell()
    out.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1))
    for off in offsets:
        out.write(b"%010d 00000 n \n" % off)
    out.write(b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref))
    return out.getvalue()


def minimal_docx(paragraphs: list[str]) -> bytes:
    body = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paragraphs)
    xml = ('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/'
           f'wordprocessingml/2006/main"><w:body>{body}</w:body></w:document>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", xml)
    return buf.getvalue()


class SoloGamesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.me = User(email="t@9clover.gg", password_hash="x", name="Tobi", ign="TOBI", role="player", roster=True, main_role="JUNGLE")
        self.other = User(email="p@9clover.gg", password_hash="x", name="Pip", ign="PIP", role="player", roster=True, main_role="GOLD")
        self.coach = User(email="c@9clover.gg", password_hash="x", name="Coach", ign="ICHI", role="coach")
        self.admin = User(email="a@9clover.gg", password_hash="x", name="Admin", ign="DRE", role="admin")
        self.db.add_all([self.me, self.other, self.coach, self.admin])
        self.db.add_all([Hero(name=n, role=r) for n, r in HEROES.items()])
        self.db.commit()
        self.files: list[Path] = []

    def tearDown(self) -> None:
        for f in self.files:
            f.unlink(missing_ok=True)
        self.db.close()
        self.engine.dispose()

    def upload(self, name: str, raw: bytes) -> str:
        path = UPLOAD_DIR / name
        path.write_bytes(raw)
        self.files.append(path)
        return f"/api/files/{name}"

    def png(self, name="test0solo.png") -> str:
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (40, 80), (10, 20, 30)).save(buf, "PNG")
        return self.upload(name, buf.getvalue())

    def add(self, user=None, **game) -> dict:
        return api.add_game(api.SoloGameIn(**game), db=self.db, user=user or self.me)

    # -- parsing ---------------------------------------------------------------
    def test_cleaning_understands_messy_values(self) -> None:
        heroes = sg.hero_names(self.db)
        today = date(2026, 10, 7)
        g = sg.clean_game({"hero": "hayabsa", "result": "Victory", "kda": "9/2/7", "gold": "13.2k", "rating": "11.24",
                           "date": "05/10/2026", "duration": "14:30", "mode": "Mythic ranked", "role": "jungler", "mvp": "yes"},
                          heroes, today)
        self.assertEqual(g["hero"], "Hayabusa")  # near-miss spelling fixed
        self.assertEqual((g["kills"], g["deaths"], g["assists"]), (9, 2, 7))
        self.assertEqual(g["gold"], 13200)
        self.assertEqual(g["rating"], 11.2)
        self.assertEqual(g["played_on"], date(2026, 10, 5))  # day first
        self.assertEqual(g["duration_min"], 14.5)
        self.assertEqual((g["mode"], g["lane"], g["result"], g["mvp"]), ("Ranked", "JUNGLE", "WIN", True))
        self.assertEqual(sg.parse_date("yesterday", today), date(2026, 10, 6))
        self.assertEqual(sg.parse_date("09/13/2026", today), date(2026, 9, 13))  # 13 can't be a month
        self.assertIsNone(sg.parse_date("2030-01-01", today))  # the future isn't a played game
        self.assertEqual(sg.canon_result("Defeat"), "LOSS")
        self.assertIsNone(sg.clean_game({"notes": "nothing here"}, heroes))
        self.assertIsNone(sg.clean_game({"mode": "Ranked", "result": "WIN"}, heroes))  # result alone isn't a game

    # -- manual add / edit / delete ------------------------------------------------
    def test_manual_add_edit_delete_to_trash(self) -> None:
        out = self.add(hero="Ling", result="WIN", kills=7, deaths=1, assists=5, rating=10.4, played_on="2026-10-01")
        self.assertEqual((out["hero"], out["source"], out["played_on"]), ("Ling", "manual", "2026-10-01"))
        fixed = api.edit_game(out["id"], api.SoloGameIn(deaths=3), db=self.db, user=self.me)
        self.assertEqual((fixed["kills"], fixed["deaths"]), (7, 3))
        with self.assertRaises(HTTPException) as err:
            api.edit_game(out["id"], api.SoloGameIn(deaths=0), db=self.db, user=self.other)
        self.assertEqual(err.exception.status_code, 404)  # someone else's game doesn't exist for you
        with self.assertRaises(HTTPException) as err:
            self.add(mode="Ranked")
        self.assertEqual(err.exception.status_code, 422)
        api.delete_game(out["id"], db=self.db, user=self.me)
        self.assertEqual(self.db.query(SoloGame).count(), 0)
        item = self.db.query(TrashItem).one()
        self.assertEqual((item.kind, item.restricted), ("solo_game", True))

    def test_only_owner_and_staff_see_games(self) -> None:
        self.add(hero="Ling", result="WIN")
        self.assertEqual(api.list_games(db=self.db, user=self.me)["total"], 1)
        self.assertEqual(api.list_games(user_id=self.me.id, db=self.db, user=self.coach)["total"], 1)
        with self.assertRaises(HTTPException) as err:
            api.list_games(user_id=self.me.id, db=self.db, user=self.other)
        self.assertEqual(err.exception.status_code, 403)
        self.assertEqual(api.list_games(db=self.db, user=self.other)["total"], 0)

    # -- imports -------------------------------------------------------------------
    def test_csv_is_read_directly_without_ai(self) -> None:
        csv = ("Date;Mode;Hero;Result;K;D;A;Rating;Gold;Duration\n"
               "2026-10-01;Ranked;Ling;Win;9;2;7;11.2;13200;14:32\n"
               "2026-10-01;Ranked;Fanny;Loss;3;8;2;5.1;7400;18:10\n"
               "2026-10-02;Classic;;;;;;;;\n")
        url = self.upload("test0solo.csv", csv.encode())
        with patch.object(ai_game_import, "call_text") as call:
            out = api.import_file(api.ImportIn(file_url=url), db=self.db, user=self.me)
        call.assert_not_called()
        self.assertTrue(out["read_directly"])
        self.assertFalse(any("AI" in c["text"] for c in out["checks"]))  # members never see how it's read
        self.assertEqual([g["hero"] for g in out["added"]], ["Ling", "Fanny"])
        self.assertEqual(out["added"][0]["duration_min"], 14.5)
        self.assertTrue(any("skipped" in c["text"] for c in out["checks"]))
        # the same file again adds nothing
        again = api.import_file(api.ImportIn(file_url=url), db=self.db, user=self.me)
        self.assertEqual((len(again["added"]), again["duplicates"], again["batch"]), (0, 2, None))

    def test_xlsx_sheet_and_undo(self) -> None:
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.append(["My MLBB log"])
        ws.append(["Played", "Hero", "W/L", "KDA", "Score", "MVP"])
        ws.append([date(2026, 9, 30), "Yu Zhong", "W", "6/3/9", 9.8, "yes"])
        ws.append([date(2026, 9, 30), "Khufra", "L", "0/5/12", 7.1, ""])
        buf = io.BytesIO()
        wb.save(buf)
        url = self.upload("test0solo.xlsx", buf.getvalue())
        out = api.import_file(api.ImportIn(file_url=url), db=self.db, user=self.me)
        self.assertEqual(len(out["added"]), 2)
        self.assertEqual(out["added"][0]["played_on"], "2026-09-30")
        self.assertTrue(out["added"][0]["mvp"])
        self.assertEqual(out["added"][1]["assists"], 12)
        with self.assertRaises(HTTPException):
            api.undo_import(api.UndoIn(batch=out["batch"]), db=self.db, user=self.other)  # not theirs
        self.assertEqual(api.undo_import(api.UndoIn(batch=out["batch"]), db=self.db, user=self.me), {"removed": 2})
        self.assertEqual(self.db.query(SoloGame).count(), 0)
        self.assertEqual(self.db.query(TrashItem).one().kind, "solo_import")

    def test_screenshot_reads_only_my_games(self) -> None:
        url = self.png()
        reply = {"source": "scoreboard", "player_found": True, "games": [
            {"hero": "Ling", "result": "WIN", "kills": 11, "deaths": 1, "assists": 4, "rating": 12.1, "gold": "14.1k", "mvp": True,
             "duration": "12:05"}], "notes": ["Damage tab not shown"]}
        with patch.dict(os.environ, KEY), patch.object(ai_game_import, "call_vision", return_value=reply) as call:
            out = api.import_file(api.ImportIn(file_url=url), db=self.db, user=self.me)
        prompt = call.call_args.args[2]
        self.assertIn('"player": "TOBI"', prompt)
        self.assertIn("Hayabusa", prompt)  # hero list for spelling
        g = out["added"][0]
        self.assertEqual((g["hero"], g["gold"], g["source"], g["played_on"]), ("Ling", 14100, "screenshot", utcnow().date().isoformat()))
        self.assertTrue(any("Damage tab" in c["text"] for c in out["checks"]))

    def test_screenshot_heroes_come_from_the_portrait_matcher(self) -> None:
        from app import hero_vision
        url = self.png("test0solo3.png")
        seen = hero_vision.Match(hero="Ling", score=0.91, margin=0.3, x=0.1, y=0.4, size=0.1, box=(1, 1, 20, 20))
        help_ = hero_vision.PortraitHelp(image=b"tagged", sheet=b"sheet", matches=[seen], maybes=["Fanny"])
        reply = {"games": [{"hero": "Ling", "result": "WIN", "kills": 3, "deaths": 1, "assists": 2}]}
        with patch.dict(os.environ, KEY), patch.object(ai_game_import, "portrait_help", return_value=help_), \
                patch.object(ai_game_import, "call_vision", return_value=reply) as call:
            out = api.import_file(api.ImportIn(file_url=url), db=self.db, user=self.me)
        self.assertEqual(call.call_args.args[3:], (b"tagged", "image/jpeg"))
        self.assertEqual(call.call_args.kwargs["extra"], [(b"sheet", "image/png")])
        self.assertIn('"portrait_matches"', call.call_args.args[2])
        self.assertIn("yellow tag", call.call_args.args[1])
        self.assertTrue(any(c["text"] == "Recognised from the portraits: Ling." for c in out["checks"]))

    def test_screenshot_without_me_says_so(self) -> None:
        url = self.png("test0solo2.png")
        with patch.dict(os.environ, KEY), patch.object(ai_game_import, "call_vision",
                                                       return_value={"player_found": False, "games": []}):
            out = api.import_file(api.ImportIn(file_url=url), db=self.db, user=self.me)
        self.assertEqual(out["added"], [])
        self.assertTrue(any("Couldn't find TOBI" in c["text"] for c in out["checks"]))

    def test_documents_go_through_text_ai(self) -> None:
        reply = {"games": [{"date": "2026-09-28", "hero": "Karrie", "result": "LOSS", "kills": 4, "deaths": 6, "assists": 3}]}
        pdf = self.upload("test0solo.pdf", minimal_pdf(["Match history for TOBI", "Karrie defeat 4/6/3 on 28 Sept 2026"]))
        docx = self.upload("test0solo.docx", minimal_docx(["Ling win 9 2 7 yesterday", "Fanny loss 2 7 3"]))
        txt = self.upload("test0solo.txt", b"Played Ling today, won, 8/1/6")
        with patch.dict(os.environ, KEY), patch.object(ai_game_import, "call_text", return_value=reply) as call:
            for url in (pdf, docx, txt):
                api.import_file(api.ImportIn(file_url=url), db=self.db, user=self.me)
        sent = [c.args[2] for c in call.call_args_list]
        self.assertIn("Karrie defeat 4/6/3", sent[0])
        self.assertIn("Ling win 9 2 7 yesterday", sent[1])
        self.assertIn("Fanny loss", sent[1])
        self.assertIn("won, 8/1/6", sent[2])
        self.assertEqual(self.db.query(SoloGame).count(), 1)  # the same reading three times is one game

    def test_scanned_pdf_and_bad_files(self) -> None:
        empty_pdf = self.upload("test0solo3.pdf", minimal_pdf([]))
        with self.assertRaises(HTTPException) as err:
            api.import_file(api.ImportIn(file_url=empty_pdf), db=self.db, user=self.me)
        self.assertIn("screenshots", err.exception.detail)
        for bad in ("https://evil.example/x.png", "/api/files/../secret.png", "/api/files/x.exe", "/api/files/nothere.png"):
            with self.assertRaises(HTTPException):
                api.import_file(api.ImportIn(file_url=bad), db=self.db, user=self.me)
        with patch("app.ai_scoreboard._credential", return_value=(None, "not configured")):
            with self.assertRaises(HTTPException) as err:
                api.import_file(api.ImportIn(file_url=self.png("test0solo4.png")), db=self.db, user=self.me)
        self.assertEqual(err.exception.status_code, 503)
        self.assertNotIn("AI", err.exception.detail)
        self.assertIn("by hand", err.exception.detail)

    # -- learning --------------------------------------------------------------------
    def seed_history(self) -> None:
        today = utcnow().date()
        # newest first: 6 straight losses on Fanny, then a strong Ling run before that
        for i in range(6):
            self.add(hero="Fanny", result="LOSS", kills=2, deaths=8, assists=3, rating=4.8, played_on=str(today - timedelta(days=i)))
        for i in range(12):
            self.add(hero="Ling", result="WIN" if i % 4 != 3 else "LOSS", kills=9, deaths=2, assists=6, rating=10.5,
                     played_on=str(today - timedelta(days=10 + i)), mode="Ranked", lane="JUNGLE")

    def test_learning_stats_and_alerts(self) -> None:
        self.seed_history()
        stats = api.list_games(db=self.db, user=self.me)["stats"]
        self.assertEqual(stats["overall"]["games"], 18)
        self.assertEqual(stats["streak"], {"result": "LOSS", "count": 6})
        heroes = {h["name"]: h for h in stats["heroes"]}
        self.assertEqual(heroes["Ling"]["win_rate"], 75.0)
        self.assertEqual(heroes["Fanny"]["loss_streak"], 6)
        kinds = [a["kind"] for a in stats["alerts"]]
        self.assertEqual(kinds[0], "losing_streak")
        self.assertIn("struggling", kinds)
        self.assertIn("strength", kinds)
        self.assertLess(stats["trend"]["win_rate"], 0)
        self.assertEqual(stats["lanes"][0]["name"], "JUNGLE")

    def test_coach_uses_my_games_only(self) -> None:
        self.seed_history()
        self.add(user=self.other, hero="Karrie", result="WIN", kills=20, deaths=0, assists=1)
        pool_hero = self.db.query(Hero).filter_by(name="Ling").one()
        self.db.add(HeroPoolEntry(user_id=self.me.id, hero_id=pool_hero.id, category="comfort"))
        self.db.commit()
        reply = {"headline": "Ling carries you, Fanny is sinking you.", "summary": "75% on Ling.",
                 "strengths": [{"title": "Ling", "detail": "9/2/6 a game"}],
                 "fixes": [{"title": "Fanny", "detail": "0W-6L", "drill": "10 Classic games"}],
                 "heroes": {"keep": [{"hero": "Ling", "why": "75%"}], "work_on": [{"hero": "Fanny", "why": "0%"}], "try": []},
                 "next_games": ["Ling first-pick", 7]}
        with patch.dict(os.environ, KEY), patch.object(ai_solo_coach, "_text_call", return_value=reply) as call:
            out = api.coach(api.CoachIn(focus="climb to Mythic"), db=self.db, user=self.me)
        prompt = call.call_args.args[2]
        self.assertIn("climb to Mythic", prompt)
        self.assertIn('"hero_pool": [{"hero": "Ling"', prompt)
        self.assertNotIn("Karrie", prompt)
        self.assertEqual(out["games_used"], 18)
        self.assertEqual(out["next_games"], ["Ling first-pick", "7"])
        with patch.dict(os.environ, KEY):
            with self.assertRaises(HTTPException) as err:
                api.coach(api.CoachIn(), db=self.db, user=self.coach)  # no games
        self.assertEqual(err.exception.status_code, 422)

    # -- the rest of the app ------------------------------------------------------------
    def test_pool_and_dashboard_show_solo_privately(self) -> None:
        ling = self.db.query(Hero).filter_by(name="Ling").one()
        self.db.add(HeroPoolEntry(user_id=self.me.id, hero_id=ling.id, category="comfort"))
        self.db.commit()
        self.add(hero="Ling", result="WIN", kills=5, deaths=1, assists=5)
        self.add(hero="Ling", result="LOSS", kills=1, deaths=4, assists=2, played_on="2026-09-01")
        mine = player_detail(self.me.id, db=self.db, user=self.me)["pool"]["comfort"][0]["played"]
        self.assertEqual(mine["solo"], {"games": 2, "wins": 1, "losses": 1, "win_rate": 50.0})
        self.assertEqual(mine["games"], 0)  # team numbers are untouched
        theirs = player_detail(self.me.id, db=self.db, user=self.other)["pool"]["comfort"][0]["played"]
        self.assertNotIn("solo", theirs)
        form = my_form(self.db, self.me)
        self.assertEqual(form["solo"]["games"], 2)
        self.assertEqual(form["overall"]["games"], 0)
        self.assertIsNone(my_form(self.db, self.coach))

    def test_chat_context_needs_consent(self) -> None:
        from app import clover_ai_service as svc
        self.add(hero="Ling", result="WIN", kills=5, deaths=1, assists=5, notes="private thought")
        self.add(user=self.other, hero="Karrie", result="WIN", kills=20, deaths=0, assists=1)
        prefs = svc.settings_for(self.db, self.me.id)
        self.assertFalse(svc.settings_dict(prefs)["share_games"])
        facts, _ = svc.build_evidence(self.db, self.me, prefs, "how are my solo games going?",
                                      include_auto_esports=False, include_season_aggregate=False)
        self.assertNotIn("member_solo_games", facts)
        prefs.share_games = True
        facts, sources = svc.build_evidence(self.db, self.me, prefs, "how are my solo games going?",
                                            include_auto_esports=False, include_season_aggregate=False)
        solo = facts["member_solo_games"]
        self.assertEqual(solo["heroes"][0]["name"], "Ling")
        self.assertNotIn("notes", solo["recent_games"][0])
        self.assertNotIn("Karrie", str(solo))  # never another player's games
        self.assertTrue(any(src["label"] == "Your 1 solo game" for src in sources))

    def test_hero_gaps(self) -> None:
        heroes = {h.name: h for h in self.db.query(Hero).all()}
        heroes["Ling"].meta_status = "META"
        heroes["Fanny"].meta_status = "STRONG"
        heroes["Hayabusa"].meta_status = "META"
        for name, cat in (("Yu Zhong", "comfort"), ("Khufra", "pocket"), ("Karrie", "meta")):
            self.db.add(HeroPoolEntry(user_id=self.me.id, hero_id=heroes[name].id, category=cat))
        self.db.commit()
        old = str(utcnow().date() - timedelta(days=40))
        self.add(hero="Khufra", result="WIN", kills=1, deaths=2, assists=9, played_on=old)
        self.add(hero="Karrie", result="WIN", kills=8, deaths=2, assists=4)
        self.add(hero="Hayabusa", result="LOSS", kills=3, deaths=5, assists=2)
        gaps = api.list_games(db=self.db, user=self.me)["gaps"]
        self.assertEqual([g["hero"] for g in gaps["no_data"]], ["Yu Zhong"])
        self.assertEqual([g["hero"] for g in gaps["not_playing"]], ["Khufra"])
        self.assertGreaterEqual(gaps["not_playing"][0]["days"], 40)
        # jungle main: Ling and Fanny are strong and never played; Hayabusa is played already
        self.assertEqual([g["hero"] for g in gaps["lane_meta"]], ["Ling", "Fanny"])


if __name__ == "__main__":
    unittest.main()
