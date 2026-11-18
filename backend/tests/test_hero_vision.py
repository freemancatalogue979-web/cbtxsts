"""Portrait matcher: finds heroes in a screenshot from our own official head art."""
import io
import os
import random
import tempfile
import unittest
from unittest.mock import patch

os.environ.setdefault("CLOVER_DATABASE_URL", "sqlite:///" + os.path.join(tempfile.mkdtemp(), "hv.db"))

from PIL import Image, ImageDraw, ImageFilter  # noqa: E402

from app import hero_vision as hv  # noqa: E402

HAVE_ART = hv.np is not None and bool(hv.hero_heads())


def board(names, d=40, w=800, h=420):
    """A fake scoreboard: two columns of round portraits with level badges, numbers around them."""
    heads = hv.hero_heads()
    rnd = random.Random(7)
    img = Image.new("RGB", (w, h), (20, 34, 70))
    draw = ImageDraw.Draw(img)
    for _ in range(50):
        draw.text((rnd.randint(0, w), rnd.randint(0, h)), str(rnd.randint(0, 99999)), fill=(230, 230, 230))
    spots = []
    for i, name in enumerate(names):
        x = 70 if i < 5 else w - 70 - d
        y = 60 + (i % 5) * 70
        mask = Image.new("L", (d, d), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, d - 1, d - 1), fill=255)
        img.paste(heads[name].resize((d, d), Image.LANCZOS), (x, y), mask)
        draw.ellipse((x + d - 14, y + d - 14, x + d, y + d), fill=(200, 60, 120))
        spots.append((name, (x + d / 2) / w, (y + d / 2) / h))
    out = io.BytesIO()
    img.filter(ImageFilter.GaussianBlur(0.5)).save(out, "JPEG", quality=80)
    return out.getvalue(), spots


@unittest.skipUnless(HAVE_ART, "hero art or numpy not available")
class HeroVisionTest(unittest.TestCase):
    def setUp(self):
        self.names = sorted(hv.hero_heads())
        self.ten = random.Random(3).sample(self.names, 10)

    def test_finds_heroes_where_they_are(self):
        raw, spots = board(self.ten)
        found = {m.hero: m for m in hv.find_heroes(raw)}
        right = [n for n, x, y in spots if n in found and abs(found[n].x - x) < 0.04 and abs(found[n].y - y) < 0.05]
        self.assertGreaterEqual(len(right), 7, found)
        wrong = [h for h in found if h not in self.ten]
        self.assertLessEqual(len(wrong), 1, wrong)

    def test_known_draft_narrows_it_down(self):
        raw, spots = board(self.ten, d=30)
        found = hv.find_heroes(raw, candidates=self.ten)
        self.assertTrue(all(m.hero in self.ten for m in found))
        self.assertGreaterEqual(len(found), 8)

    def test_help_tags_the_picture_and_builds_a_sheet(self):
        raw, _ = board(self.ten)
        help_ = hv.portrait_help(raw)
        self.assertTrue(help_.matches)
        self.assertTrue(Image.open(io.BytesIO(help_.image)).size == (800, 420))
        sheet = Image.open(io.BytesIO(help_.sheet))
        self.assertGreater(sheet.width, 100)
        hints = help_.hints()
        self.assertTrue(hints["reference_sheet"])
        self.assertEqual({m["hero"] for m in hints["portrait_matches"]}, {m.hero for m in help_.matches})
        self.assertIn(hints["portrait_matches"][0]["where"].split(" side")[0], {"left", "right", "middle"})

    def test_draft_heroes_make_the_reference_sheet(self):
        blank = io.BytesIO()
        Image.new("RGB", (400, 200), (30, 30, 30)).save(blank, "PNG")
        help_ = hv.portrait_help(blank.getvalue(), candidates=self.ten[:5])
        self.assertEqual(help_.matches, [])
        self.assertIsNone(help_.image)
        self.assertEqual(Image.open(io.BytesIO(help_.sheet)).size, (5 * 112, 112 + 24))

    def test_never_breaks_reading(self):
        self.assertEqual(hv.find_heroes(b"not a picture"), [])
        help_ = hv.portrait_help(b"not a picture")
        self.assertEqual((help_.image, help_.matches), (None, []))
        with patch.object(hv, "analyse", side_effect=RuntimeError("boom")):
            self.assertEqual(hv.portrait_help(b"x").matches, [])

    def test_prompts_carry_the_hero_rule(self):
        from app import ai_game_import, ai_scoreboard
        for system in (ai_scoreboard.SYSTEM, ai_game_import.SYSTEM):
            self.assertIn("yellow tag", system)
            self.assertIn("reference sheet", system)
            self.assertNotIn("{HINT_RULE}", system)


if __name__ == "__main__":
    unittest.main()
