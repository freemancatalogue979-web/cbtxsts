"""Official hero pictures from Moonton (mobilelegends.com hero list) for the portrait checker."""
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("CLOVER_DATABASE_URL", "sqlite:///" + os.path.join(tempfile.mkdtemp(), "art.db"))

from PIL import Image  # noqa: E402

from app import hero_art_sync as art  # noqa: E402
from app import hero_vision as hv  # noqa: E402

CDN = "https://akmweb.youngjoygame.com/web/svnres/img/test/homepage_2_2_16_1235_1/"


def payload(*rows):
    return {"code": 0, "data": {"records": [
        {"data": {"hero_id": hid, "hero": {"data": {"name": name, **urls}}}} for hid, name, urls in rows]}}


def png(color, size=(128, 128), mode="RGB"):
    out = io.BytesIO()
    Image.new(mode, size, color).save(out, "PNG")
    return out.getvalue()


class ArtSyncTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.patches = [patch.object(art, "ART_DIR", self.tmp), patch.object(art, "MANIFEST", self.tmp / "manifest.json")]
        for p in self.patches:
            p.start()
        hv.reset()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        hv.reset()

    def test_parse_keeps_moonton_pictures_only(self):
        rows = art.parse_list(payload(
            (131, "Hirara", {"head": CDN + "100_a.png", "smallmap": CDN + "100_b.png"}),
            (130, "Evil", {"head": "https://evil.example.com/x.png", "smallmap": "http://akmweb.youngjoygame.com/x.png"}),
            (129, "Chang'e", {"head": CDN + "100_c.png"}),
            (128, "Hirara", {"head": CDN + "100_dupe.png"}),
        ))
        self.assertEqual([(r["name"], r["slug"], sorted(r["urls"])) for r in rows],
                         [("Hirara", "hirara", ["head", "smallmap"]), ("Chang'e", "chang-e", ["head"])])
        self.assertEqual(art.parse_list({"code": 0, "data": None}), [])

    def test_downloads_new_or_changed_pictures_only(self):
        calls = []

        def download(url):
            calls.append(url)
            return png((200, 30, 30), (240, 390), "RGBA") if url.endswith("b.png") else png((30, 200, 30))

        lst = lambda: ("Moonton", payload((131, "Hirara", {"head": CDN + "100_a.png", "smallmap": CDN + "100_b.png"})))  # noqa: E731
        first = art.run_once(lst, download)
        self.assertEqual((first["downloaded"], first["heroes"], first["new_heroes"], first["error"]), (2, 1, [], ""))
        self.assertTrue((self.tmp / "hirara" / "head.png").is_file())
        with Image.open(self.tmp / "hirara" / "smallmap.png") as saved:
            self.assertEqual(saved.mode, "RGB")
        again = art.run_once(lst, download)
        self.assertEqual((again["downloaded"], len(calls)), (0, 2))
        changed = lambda: ("Moonton", payload((131, "Hirara", {"head": CDN + "100_new.png", "smallmap": CDN + "100_b.png"}),  # noqa: E731
                                              (132, "Newbie", {"head": CDN + "100_n.png"})))
        third = art.run_once(changed, download)
        self.assertEqual((third["downloaded"], third["new_heroes"]), (2, ["Newbie"]))
        st = art.status()
        self.assertEqual((st["heroes"], st["pictures"]), (2, 3))

    def test_bad_pictures_are_skipped(self):
        lst = lambda: ("Moonton", payload((1, "Tiny", {"head": CDN + "t.png"}), (2, "Junk", {"head": CDN + "j.png"})))  # noqa: E731
        out = art.run_once(lst, lambda url: png((1, 2, 3), (8, 8)) if "t.png" in url else b"not a picture")
        self.assertEqual((out["downloaded"], out["failed"]), (0, 2))
        self.assertEqual(art.status()["heroes"], 0)

    def test_moonton_first_then_rone(self):
        with patch.object(art, "fetch_gms", side_effect=art.ArtSyncError("Moonton refused the hero list (401)")), \
             patch.object(art, "fetch_rone", return_value=payload((5, "Sora", {"head": CDN + "s.png"}))), \
             patch.object(art, "_http", return_value=png((9, 9, 200))):
            out = art.run_once()
        self.assertEqual((out["source"].split(" (")[0], out["downloaded"], out["error"]), ("Rone", 1, ""))
        with patch.object(art, "fetch_gms", side_effect=OSError("down")), patch.object(art, "fetch_rone", side_effect=OSError("down")):
            out = art.run_once()
        self.assertIn("Moonton", out["error"])
        self.assertIn("Rone", out["error"])

    @unittest.skipUnless(hv.np is not None and bool(hv.hero_heads()), "hero art or numpy not available")
    def test_new_hero_joins_the_portrait_bank(self):
        rnd = __import__("random").Random(4)
        img = Image.new("RGB", (128, 128))
        img.putdata([(rnd.randint(0, 255), rnd.randint(0, 255), rnd.randint(0, 255)) for _ in range(128 * 128)])
        raw = io.BytesIO()
        img.save(raw, "PNG")
        art.run_once(lambda: ("Moonton", payload((999, "Brand New", {"head": CDN + "bn.png"}))), lambda url: raw.getvalue())
        bank = hv.bank()
        self.assertIn("Brand New", bank.heroes)
        canvas = Image.new("RGB", (400, 300), (20, 34, 70))
        canvas.paste(img.resize((60, 60)), (170, 120))
        found = hv.check_box(canvas, [170 / 400, 120 / 300, 230 / 400, 180 / 300])
        self.assertEqual(found.hero, "Brand New")

    @unittest.skipUnless(hv.np is not None and bool(hv.hero_heads()), "hero art or numpy not available")
    def test_card_faces_add_a_second_framing_without_duplicates(self):
        heads = hv.hero_heads()
        extra = hv.official_heads(None, heads)
        names = {n for n, _ in extra}
        self.assertGreater(len(extra), len(heads))          # wide + tight face from each bundled card
        self.assertTrue(names <= set(heads))
        card = Image.new("RGB", (240, 390), (0, 0, 0))
        self.assertEqual(hv.card_face(card).size, (134, 134))
        self.assertEqual(hv.card_face(Image.new("RGB", (128, 128))).size, (128, 128))


if __name__ == "__main__":
    unittest.main()
