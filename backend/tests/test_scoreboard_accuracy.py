"""Scoreboard reading accuracy: zoomed second look + sanity checks. No network."""

from __future__ import annotations

import copy
import io
import unittest
from unittest.mock import patch

from app import ai_scoreboard as sb


def team(side, rows, kills=None):
    return {"side": side, "kills": kills, "players": [
        {"name": n, "hero": h, "kills": k, "deaths": d, "assists": a, "gold": g, "rating": r, "mvp": m}
        for n, h, k, d, a, g, r, m in rows]}


LEFT = [("RINJI", "Arlott", 3, 2, 5, 8000, 7.1, False), ("SORA", "Hayabusa", 7, 1, 4, 11000, 11.2, True),
        ("MIRA", "Yve", 2, 3, 9, 9000, 8.0, False), ("TOBI", "Karrie", 4, 2, 6, 12000, 9.0, False),
        ("KAZE", "Khufra", 0, 4, 12, 6000, 6.5, False)]
RIGHT = [("e1", "Yu Zhong", 2, 4, 3, 7000, 6.0, False), ("e2", "Ling", 4, 3, 2, 9000, 8.4, True),
         ("e3", "Pharsa", 3, 4, 4, 8000, 7.0, False), ("e4", "Moskov", 1, 3, 5, 9500, 6.6, False),
         ("e5", "Atlas", 2, 2, 7, 5000, 5.9, False)]


def raw():
    return {"screen": "scoreboard", "teams": [team("left", LEFT, kills=16), team("right", RIGHT, kills=12)]}


def png(w, h):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (30, 40, 50)).save(buf, "PNG")
    return buf.getvalue()


class ZoomTests(unittest.TestCase):
    def test_landscape_splits_left_right_and_enlarges(self):
        from PIL import Image
        crops = sb.zoom_halves(png(1200, 540))
        self.assertEqual(len(crops), 2)
        sizes = [Image.open(io.BytesIO(c)).size for c, _ in crops]
        self.assertTrue(all(w >= 1400 for w, _ in sizes), sizes)
        self.assertTrue(all(m == "image/jpeg" for _, m in crops))

    def test_portrait_splits_top_bottom(self):
        from PIL import Image
        crops = sb.zoom_halves(png(600, 1300))
        w, h = Image.open(io.BytesIO(crops[0][0])).size
        self.assertAlmostEqual(h / w, (0.53 * 1300) / 600, places=1)  # the top half, not a side

    def test_tiny_or_broken_pictures_are_skipped(self):
        self.assertIsNone(sb.zoom_halves(png(64, 32)))
        self.assertIsNone(sb.zoom_halves(b"not an image"))


class ReconcileTests(unittest.TestCase):
    def test_agreement_confirms(self):
        first = raw()
        second = {"left": {"kills": 16, "players": first["teams"][0]["players"]},
                  "right": {"kills": 12, "players": first["teams"][1]["players"]}}
        notes = sb.reconcile(first, copy.deepcopy(second))
        self.assertEqual(notes[0]["tone"], "ok")
        self.assertIn("all 50 matched", notes[0]["text"])  # 5 numbers × 10 rows (no damage shown)
        self.assertFalse(any(r.get("doubt") for t in first["teams"] for r in t["players"]))

    def test_clash_takes_the_zoomed_value_and_marks_the_row(self):
        first = raw()
        first["teams"][0]["players"][1]["kills"] = 1      # 7 misread as 1
        first["teams"][1]["players"][0]["gold"] = None    # missing in the first look
        second = copy.deepcopy({"left": {"players": raw()["teams"][0]["players"]},
                                "right": {"players": raw()["teams"][1]["players"]}})
        notes = sb.reconcile(first, second)
        sora = first["teams"][0]["players"][1]
        self.assertEqual(sora["kills"], 7)
        self.assertEqual(sora["doubt"], ["kills"])
        self.assertEqual(first["teams"][1]["players"][0]["gold"], 7000)
        self.assertEqual(notes[0]["tone"], "warn")
        self.assertIn("SORA kills 1→7", notes[0]["text"])

    def test_rows_matched_by_name_even_out_of_order(self):
        first = raw()
        first["teams"][0]["players"][0]["deaths"] = 9
        zoomed = list(reversed(copy.deepcopy(raw()["teams"][0]["players"])))[:3]  # partial + shuffled
        sb.reconcile(first, {"left": {"players": zoomed}})
        rows = {r["name"]: r for r in first["teams"][0]["players"]}
        self.assertEqual(rows["KAZE"].get("doubt"), None)
        self.assertNotEqual(rows["RINJI"]["deaths"], 2)  # RINJI not in the partial zoom: untouched
        self.assertEqual(rows["RINJI"]["deaths"], 9)

    def test_junk_second_reading_is_ignored(self):
        first = raw()
        self.assertEqual(sb.reconcile(first, {"teams": []}), [])
        self.assertEqual(sb.reconcile(first, None), [])
        self.assertEqual(first, raw())


class SanityTests(unittest.TestCase):
    def test_clean_reading_has_no_warnings(self):
        self.assertEqual(sb.sanity(raw()), [])

    def test_kill_total_mismatch_and_impossible_values(self):
        r = raw()
        r["teams"][0]["kills"] = 20                     # rows add to 16
        r["teams"][1]["players"][1]["rating"] = 84      # 8.4 without the dot
        r["teams"][1]["players"][2]["gold"] = 80        # 8.0k lost its k
        r["teams"][1]["players"][3]["mvp"] = True       # two MVPs on one team
        texts = " | ".join(n["text"] for n in sb.sanity(r))
        self.assertIn("add up to 16", texts)
        self.assertIn("rating 84", texts)
        self.assertIsNone(r["teams"][1]["players"][1]["rating"])
        self.assertIn("80 gold", texts)
        self.assertIn("more than one MVP", texts)
        self.assertIn("kills", r["teams"][0]["players"][0]["doubt"])

    def test_kills_vs_deaths_cross_check(self):
        r = raw()
        for p in r["teams"][1]["players"]:
            p["deaths"] = 0
        r["teams"][0]["kills"] = None
        self.assertTrue(any("don't line up" in n["text"] for n in sb.sanity(r)))


class DoubleCheckFlowTests(unittest.TestCase):
    def test_failure_keeps_the_first_reading(self):
        with patch.object(sb, "call_numbers", side_effect=RuntimeError("down")):
            notes = sb.double_check("key", png(1200, 540), raw(), {})
        self.assertEqual(notes[0]["tone"], "info")

    def test_can_be_switched_off(self):
        with patch.object(sb, "DOUBLE_CHECK", False), patch.object(sb, "call_numbers") as call:
            self.assertEqual(sb.double_check("key", png(1200, 540), raw(), {}), [])
        call.assert_not_called()

    def test_sends_two_zoomed_crops(self):
        with patch.object(sb, "call_numbers", return_value={}) as call:
            sb.double_check("key", png(1200, 540), raw(), {"our_roster_igns": ["SORA"]})
        crops = call.call_args.args[1]
        self.assertEqual(len(crops), 2)


if __name__ == "__main__":
    unittest.main()
