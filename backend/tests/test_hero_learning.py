"""Heroes checked at each row's own portrait, corrected or flagged, and learned when people confirm them."""
from __future__ import annotations

import io
import os
import random
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("CLOVER_AERENA_ENABLED", "0")
os.environ.setdefault("CLOVER_HERO_SYNC_ENABLED", "0")

from PIL import Image, ImageDraw, ImageFilter, ImageOps  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

import app.main  # noqa: E402,F401  (registers every model)
from app import ai_scoreboard, hero_vision as hv  # noqa: E402
from app.config import UPLOAD_DIR  # noqa: E402
from app.db import Base  # noqa: E402
from app.models import Hero, Scrim, User, dumps, utcnow  # noqa: E402
from app.routers import utility  # noqa: E402

HAVE_ART = hv.np is not None and bool(hv.hero_heads())
KEY = {"DEEPSEEK_API_KEY": "synthetic-key"}
LANES = ["EXP", "JUNGLE", "MID", "GOLD", "ROAM"]
OURS = {"RINJI": "Arlott", "SORA": "Hayabusa", "MIRA": "Yve", "TOBI": "Karrie", "KAZE": "Khufra"}
THEIRS = ["Yu Zhong", "Ling", "Valentina", "Claude", "Paquito"]


def skin_of(hero: str) -> Image.Image:
    """A look the official art doesn't cover: mirrored, inverted, recoloured, turned."""
    art = hv.hero_heads()[hero]
    odd = ImageOps.colorize(ImageOps.invert(ImageOps.mirror(art)).convert("L"), (40, 0, 90), (255, 230, 120))
    return odd.rotate(18, resample=Image.BICUBIC, fillcolor=(200, 160, 90))


def board(faces: list[Image.Image], d=44, w=900, h=480, seed=7) -> tuple[bytes, list[list[int]]]:
    """Two columns of round portraits (5 + 5) with numbers around. Returns (png, Qwen-style boxes 0-1000)."""
    rnd = random.Random(seed)
    img = Image.new("RGB", (w, h), (20, 34, 70))
    draw = ImageDraw.Draw(img)
    for _ in range(60):
        draw.text((rnd.randint(0, w), rnd.randint(0, h)), str(rnd.randint(0, 99999)), fill=(230, 230, 230))
    boxes = []
    gap = (h - 60) / 5
    for i, face in enumerate(faces):
        x = 70 if i < 5 else w - 70 - d
        y = round(40 + (i % 5) * gap)
        mask = Image.new("L", (d, d), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, d - 1, d - 1), fill=255)
        img.paste(face.resize((d, d), Image.LANCZOS), (x, y), mask)
        draw.ellipse((x + d - 13, y + d - 13, x + d, y + d), fill=(200, 60, 120))
        # the reader's box is rough: a little off and a little big
        j = rnd.uniform(-0.1, 0.1) * d
        boxes.append([round((x + j - 3) / w * 1000), round((y - j - 3) / h * 1000),
                      round((x + j + d + 4) / w * 1000), round((y - j + d + 4) / h * 1000)])
    out = io.BytesIO()
    img.filter(ImageFilter.GaussianBlur(0.4)).save(out, "PNG")
    return out.getvalue(), boxes


class LearnDir(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.learn_patch = patch.object(hv, "LEARN_DIR", Path(self.tmp.name) / "hero_portraits")
        self.learn_patch.start()
        hv.reset()
        self.heads = hv.hero_heads()

    def tearDown(self) -> None:
        self.learn_patch.stop()
        hv.reset()
        self.tmp.cleanup()


@unittest.skipUnless(HAVE_ART, "hero art or numpy not available")
class PortraitChecks(LearnDir):
    def test_box_check_names_the_hero_in_a_rough_box(self) -> None:
        faces = [self.heads[n] for n in list(OURS.values()) + THEIRS]
        raw, boxes = board(faces)
        for name, box in zip(list(OURS.values()) + THEIRS, boxes):
            chk = hv.check_box(raw, box)
            self.assertEqual(chk.hero, name)
            self.assertGreaterEqual(chk.score, hv.BOX_AGREE)
            self.assertTrue(all(0 <= v <= 1 for v in chk.norm))
        self.assertIsNone(hv.check_box(raw, [0, 0, 0, 0]))
        self.assertIsNone(hv.check_box(raw, "nonsense"))
        self.assertEqual(hv.parse_box([100, 200, 150, 260]), [0.1, 0.2, 0.15, 0.26])
        self.assertEqual(hv.parse_box([0.1, 0.2, 0.15, 0.26]), [0.1, 0.2, 0.15, 0.26])

    def test_rows_are_confirmed_corrected_or_flagged(self) -> None:
        names = list(OURS.values()) + THEIRS
        raw, boxes = board([self.heads[n] for n in names[:9]] + [skin_of("Paquito")])
        rows = [{"hero": n, "portrait": b} for n, b in zip(names, boxes)]
        rows[1]["hero"] = "Fanny"                  # the reader got Hayabusa wrong
        rows[6]["hero"] = "Arlott"                 # ... and gave a hero that's already in the game
        rows[7].pop("portrait")                    # no box and no portrait match: not judged
        rows[9]["hero"] = "Chip"                   # a skin the art doesn't know; the reader guessed
        notes = hv.check_rows(raw, rows)
        self.assertEqual((rows[0]["hero_check"], rows[0]["hero"]), ("portrait", "Arlott"))
        self.assertEqual((rows[1]["hero"], rows[1]["hero_was"], rows[1]["hero_check"]), ("Hayabusa", "Fanny", "corrected"))
        self.assertEqual(rows[6]["hero"], "Ling")  # the portrait clearly shows Ling, still free → corrected
        self.assertEqual(rows[7]["hero_check"], "unchecked")
        self.assertEqual((rows[9]["hero"], rows[9]["hero_check"]), ("Chip", "unsure"))
        self.assertTrue(all(len(r.get("portrait", [0] * 4)) == 4 for r in rows))
        text = " ".join(n["text"] for n in notes)
        self.assertIn("Fanny → Hayabusa", text)
        self.assertIn("Not sure about Chip", text)

    def test_never_two_rows_with_the_same_hero(self) -> None:
        raw, boxes = board([self.heads["Ling"]] * 2 + [self.heads[n] for n in THEIRS[:3]], seed=3)
        rows = [{"hero": "Ling", "portrait": boxes[0]}, {"hero": "Fanny", "portrait": boxes[1]}]
        hv.check_rows(raw, rows)
        self.assertEqual(rows[1]["hero"], "Fanny")             # Ling is taken: flag instead of duplicating
        self.assertEqual(rows[1]["hero_check"], "unsure")
        rows = [{"hero": "Ling", "portrait": boxes[0]}, {"hero": "Fanny", "portrait": boxes[1]}]
        hv.check_rows(raw, rows, unique=False)                 # a match-history list repeats heroes
        self.assertEqual(rows[1]["hero"], "Ling")

    def test_a_confirmed_skin_is_recognised_next_time(self) -> None:
        skin = skin_of("Paquito")
        first, boxes = board([self.heads[n] for n in list(OURS.values()) + THEIRS[:4]] + [skin])
        self.assertNotEqual(hv.check_box(first, boxes[9]).hero, "Paquito")
        self.assertTrue(hv.learn(first, boxes[9], "Paquito"))
        self.assertEqual(hv.learned_counts(), {"paquito": 1})
        # another screenshot: different size, place and background noise
        later, boxes2 = board([self.heads[n] for n in THEIRS[:4]] + [skin] + [self.heads[n] for n in OURS.values()],
                              d=38, w=1000, h=520, seed=21)
        chk = hv.check_box(later, boxes2[4])
        self.assertEqual(chk.hero, "Paquito")
        self.assertGreaterEqual(chk.score, hv.BOX_ACCEPT[0])
        rows = [{"hero": "Chip", "portrait": boxes2[4]}]
        hv.check_rows(later, rows)
        self.assertEqual((rows[0]["hero"], rows[0]["hero_check"]), ("Paquito", "corrected"))
        # and the whole-picture scan finds it without any box
        self.assertIn("Paquito", [m.hero for m in hv.find_heroes(later)])
        # the official heroes are still found as before
        self.assertEqual(hv.check_box(later, boxes2[0]).hero, THEIRS[0])

    def test_learning_refuses_junk_and_keeps_the_newest(self) -> None:
        flat = io.BytesIO()
        Image.new("RGB", (400, 300), (30, 30, 30)).save(flat, "PNG")
        self.assertFalse(hv.learn(flat.getvalue(), [100, 100, 200, 230], "Paquito"))   # a flat patch
        raw, boxes = board([self.heads[n] for n in THEIRS] * 2)
        self.assertFalse(hv.learn(raw, boxes[0], "Not A Hero"))
        self.assertFalse(hv.learn(raw, None, "Paquito"))
        with patch.object(hv, "LEARN_MAX", 3):
            for i in range(5):
                raw_i, boxes_i = board([skin_of(THEIRS[i])] * 10, seed=40 + i)
                self.assertTrue(hv.learn(raw_i, boxes_i[0], "Paquito"))
            self.assertEqual(hv.learned_counts(), {"paquito": 3})


@unittest.skipUnless(HAVE_ART, "hero art or numpy not available")
class ReadAndConfirm(LearnDir):
    """Utility → Matches: read a screenshot, fix a hero, confirm → learned for the next read."""

    def setUp(self) -> None:
        super().setUp()
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.admin = User(email="a@9clover.gg", password_hash="x", name="Admin", ign="DRE", role="admin")
        players = [User(email=f"{n}@9clover.gg", password_hash="x", name=n.title(), ign=n, role="player", roster=True,
                        main_role=lane) for n, lane in zip(OURS, LANES)]
        self.db.add_all([self.admin, *players])
        self.db.add_all([Hero(name=n, role="EXP") for n in sorted(self.heads)])
        self.db.commit()
        self.files: list[Path] = []
        self.scrim = Scrim(number=7, opponent="Onyx", scrim_date=utcnow().date(),
                           lineup=dumps({lane: p.id for lane, p in zip(LANES, players)}))
        self.db.add(self.scrim)
        self.db.commit()

    def tearDown(self) -> None:
        for f in self.files:
            f.unlink(missing_ok=True)
        self.db.close()
        self.engine.dispose()
        super().tearDown()

    def upload(self, raw: bytes, name: str) -> str:
        path = UPLOAD_DIR / name
        path.write_bytes(raw)
        self.files.append(path)
        return f"/api/files/{name}"

    def reading(self, boxes: list[list[int]], enemy_last: str) -> dict:
        def row(name, hero, box):
            return {"name": name, "hero": hero, "kills": 3, "deaths": 2, "assists": 5, "portrait": box}
        return {"screen": "scoreboard", "duration": "15:10", "teams": [
            {"side": "left", "victory": True, "players": [row(n, h, b) for (n, h), b in zip(OURS.items(), boxes[:5])]},
            {"side": "right", "victory": False,
             "players": [row(f"o.{i}", h, b) for i, (h, b) in enumerate(zip(THEIRS[:4] + [enemy_last], boxes[5:]))]}]}

    def read(self, url: str, reply: dict) -> dict:
        with patch.dict(os.environ, KEY), patch.object(ai_scoreboard, "call_model", return_value=reply):
            return utility.read(utility.ReadIn(kind="scrim", id=self.scrim.id, game_no=1, image_url=url),
                                db=self.db, user=self.admin)

    def test_fix_confirm_and_learn(self) -> None:
        skin = skin_of("Paquito")
        raw, boxes = board([self.heads[h] for h in OURS.values()] + [self.heads[h] for h in THEIRS[:4]] + [skin])
        url = self.upload(raw, "test0learn1.png")
        out = self.read(url, self.reading(boxes, "Chip"))     # the reader can't tell the skin either
        enemy = {r["lane"]: r for r in out["sheet"]["rows"]["enemy"]}
        flagged = [r for r in enemy.values() if r["hero_check"] == "unsure"]
        self.assertEqual([r["hero"] for r in flagged], ["Chip"])
        self.assertIn("portrait", flagged[0])
        self.assertTrue(all(r["hero_check"] == "portrait" for r in out["sheet"]["rows"]["ours"]))
        self.assertTrue(any("Not sure about Chip" in c["text"] for c in out["sheet"]["checks"]))

        # the admin taps the hero, picks Paquito and confirms
        sheet = out["sheet"]
        draft = {**sheet["draft"], "enemy_picks": {**sheet["draft"]["enemy_picks"], flagged[0]["lane"]: "Paquito"}}
        saved = utility.apply(utility.ApplyIn(
            kind="scrim", id=self.scrim.id, game_no=1, result="WIN", lineup=sheet["lineup"], draft=draft,
            player_stats=sheet["player_stats"], enemy_stats=sheet["enemy_stats"], evidence_url=url,
            portraits=[utility.PortraitIn(hero="Paquito", box=flagged[0]["portrait"]),
                       utility.PortraitIn(hero="Arlott", box=out["sheet"]["rows"]["ours"][0]["portrait"])]),
            db=self.db, user=self.admin)
        self.assertEqual(saved["learned"], 1)                  # Arlott was already matched well: nothing to learn
        self.assertEqual(hv.learned_counts(), {"paquito": 1})

        # next scrim screenshot with the same skin: fixed automatically
        raw2, boxes2 = board([self.heads[h] for h in OURS.values()] + [self.heads[h] for h in THEIRS[:4]] + [skin],
                             d=40, w=960, h=500, seed=99)
        out2 = self.read(self.upload(raw2, "test0learn2.png"), self.reading(boxes2, "Chip"))
        last = [r for r in out2["sheet"]["rows"]["enemy"] if r.get("hero_was") == "Chip"]
        self.assertEqual([(r["hero"], r["hero_check"]) for r in last], [("Paquito", "corrected")])
        self.assertIn("Paquito", out2["sheet"]["draft"]["enemy_picks"].values())

    def test_portraits_from_the_browser_cannot_learn_nonsense(self) -> None:
        raw, boxes = board([self.heads[h] for h in THEIRS] * 2)
        url = self.upload(raw, "test0learn3.png")
        self.assertEqual(utility.learn_portraits(self.db, url, [utility.PortraitIn(hero="Nobody", box=boxes[0])]), 0)
        self.assertEqual(utility.learn_portraits(self.db, "/api/files/../etc.png",
                                                 [utility.PortraitIn(hero="Paquito", box=boxes[0])]), 0)
        self.assertEqual(utility.learn_portraits(self.db, url, [utility.PortraitIn(hero="Paquito", box=[0, 0, 1, 1])]), 0)
        self.assertEqual(hv.learned_counts(), {})



@unittest.skipUnless(HAVE_ART, "hero art or numpy not available")
class SoloReviewBeforeSaving(LearnDir):
    """My own games from a screenshot: shown first, heroes fixable, saved only on confirm."""

    def setUp(self) -> None:
        super().setUp()
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.me = User(email="t@9clover.gg", password_hash="x", name="Tobi", ign="TOBI", role="player", roster=True)
        self.db.add(self.me)
        self.db.add_all([Hero(name=n, role="EXP") for n in sorted(self.heads)])
        self.db.commit()
        self.path = UPLOAD_DIR / "test0solo-review.png"

    def tearDown(self) -> None:
        self.path.unlink(missing_ok=True)
        self.db.close()
        self.engine.dispose()
        super().tearDown()

    def test_preview_fix_then_confirm(self) -> None:
        from app import ai_game_import
        from app.models import SoloGame
        from app.routers import solo_games as solo
        names = list(OURS.values()) + THEIRS[:4]
        raw, boxes = board([self.heads[n] for n in names] + [skin_of("Paquito")])
        self.path.write_bytes(raw)
        url = "/api/files/test0solo-review.png"
        reply = {"games": [{"hero": "Chip", "result": "WIN", "kills": 4, "deaths": 1, "assists": 9, "portrait": boxes[9]},
                           {"hero": "Arlott", "result": "LOSS", "kills": 2, "deaths": 5, "assists": 3, "portrait": boxes[0]}]}
        with patch.dict(os.environ, KEY), patch.object(ai_game_import, "call_vision", return_value=reply):
            out = solo.import_file(solo.ImportIn(file_url=url, preview=True), db=self.db, user=self.me)
        self.assertTrue(out["preview"])
        self.assertEqual(self.db.query(SoloGame).count(), 0)          # nothing saved yet
        first, second = out["games"]
        self.assertEqual(second["look"]["hero_check"], "portrait")
        self.assertEqual(len(first["look"]["portrait"]), 4)                # where to learn from, as sent back by the page
        # the person fixes the first hero to Paquito and confirms
        games = [{**{k: v for k, v in g.items() if k != "look"}, "hero": h} for g, h in ((first, "Paquito"), (second, "Arlott"))]
        done = solo.confirm_import(solo.ConfirmIn(file_url=url, source="screenshot", games=games,
                                                  portraits=[utility.PortraitIn(hero="Paquito", box=first["look"]["portrait"])]),
                                   db=self.db, user=self.me)
        self.assertEqual([g["hero"] for g in done["added"]], ["Paquito", "Arlott"])
        self.assertEqual(done["learned"], 1)
        self.assertEqual(hv.learned_counts().get("paquito"), 1)
        self.assertEqual(hv.check_box(raw, boxes[9]).hero, "Paquito")
        # the same games again are skipped, never doubled
        again = solo.confirm_import(solo.ConfirmIn(file_url=url, games=games), db=self.db, user=self.me)
        self.assertEqual((again["duplicates"], len(again["added"])), (2, 0))

    def test_sheets_typed_by_people_still_save_straight_away(self) -> None:
        from app.routers import solo_games as solo
        path = UPLOAD_DIR / "test0solo-review.csv"
        path.write_text("hero,result,kills,deaths,assists\nLing,WIN,5,1,7\n")
        try:
            out = solo.import_file(solo.ImportIn(file_url="/api/files/test0solo-review.csv", preview=True),
                                   db=self.db, user=self.me)
        finally:
            path.unlink(missing_ok=True)
        self.assertFalse(out["preview"])
        self.assertEqual(len(out["added"]), 1)


if __name__ == "__main__":
    unittest.main()
