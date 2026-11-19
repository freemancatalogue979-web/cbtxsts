"""Official wallpapers (mobilelegends.com/m/gallery) and official hero pictures served to the app."""
from __future__ import annotations

import asyncio
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("CLOVER_DATABASE_URL", "sqlite:///" + os.path.join(tempfile.mkdtemp(), "walls.db"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app import hero_art_sync, wallpaper_sync as ws  # noqa: E402
from app.db import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402
from app.security import issue_token  # noqa: E402

IMG = "https://akmweb.youngjoygame.com/web/gms/image/"


def jpg(size, color=(40, 90, 160)):
    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, "JPEG")
    return out.getvalue()


def record(wid, heroes, pics):
    return {"id": wid, "data": {"heroid": heroes, "pictures": [{"resolution": r, "url": IMG + n + ".jpg"} for r, n in pics]}}


LIST = {"code": 0, "data": {"records": [
    record(3503336, [62], [("1920x1080", "d1"), ("2560x1440", "d2"), ("1080x1920", "m1"), ("1080x2400", "m2")]),
    record(3503300, [], [("1080x1920", "m3")]),
    record(3503299, [1], [("1920x1080", "evil")]) | {"data": {"pictures": [{"resolution": "1920x1080", "url": "https://evil.example.com/x.jpg"}]}},
    record(3503336, [62], [("1920x1080", "dupe")]),
]}}


async def raw(method, path, token=""):
    headers = [(b"host", b"clover.example")]
    if token:
        headers.append((b"authorization", f"Bearer {token}".encode()))
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method, "scheme": "https",
             "path": path, "raw_path": path.encode(), "query_string": b"", "root_path": "", "headers": headers,
             "client": ("198.51.100.2", 1234), "server": ("clover.example", 443)}
    sent, done = [], False

    async def receive():
        nonlocal done
        if not done:
            done = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await asyncio.sleep(3600)  # file responses watch for a disconnect while streaming
        return {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    await app(scope, receive, send)
    start = next(e for e in sent if e["type"] == "http.response.start")
    return start["status"], dict((k.decode(), v.decode()) for k, v in start["headers"]), b"".join(e.get("body", b"") for e in sent if e["type"] == "http.response.body")


def call(method, path, token=""):
    return asyncio.run(raw(method, path, token))


class WallpaperSync(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.patches = [patch.object(ws, "WALL_DIR", self.tmp / "walls"), patch.object(ws, "MANIFEST", self.tmp / "walls" / "manifest.json"),
                        patch.object(hero_art_sync, "ART_DIR", self.tmp / "art"), patch.object(hero_art_sync, "MANIFEST", self.tmp / "art" / "manifest.json")]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()

    def test_parse_picks_sizes_and_moonton_hosts_only(self):
        rows = ws.parse_list(LIST)
        self.assertEqual([r["id"] for r in rows], ["3503336", "3503300"])
        self.assertEqual(rows[0]["urls"], {"desktop": IMG + "d1.jpg", "mobile": IMG + "m1.jpg"})
        self.assertEqual(rows[1]["urls"], {"mobile": IMG + "m3.jpg"})
        self.assertEqual(ws.parse_list({"code": 0, "data": None}), [])

    def test_saves_once_names_heroes_and_trims(self):
        hero_art_sync._save_manifest({"heroes": {"kaja": {"name": "Kaja", "hero_id": 62}}})
        calls = []

        def download(url):
            calls.append(url)
            return jpg((1080, 1920)) if "/m" in url else jpg((2560, 1440))

        first = ws.run_once(lambda: ("test", LIST), download)
        self.assertEqual((first["listed"], first["downloaded"], first["failed"]), (2, 3, 0))
        folder = ws.WALL_DIR / "3503336"
        with Image.open(folder / "desktop.jpg") as d, Image.open(folder / "mobile.jpg") as m, Image.open(folder / "thumb.jpg") as t:
            self.assertEqual((d.size, m.size), ((1920, 1080), (1080, 1920)))
            self.assertLessEqual(max(t.size), 480)
        g = ws.gallery()
        self.assertEqual([i["id"] for i in g["items"]], ["3503336", "3503300"])
        self.assertEqual(g["items"][0]["heroes"], ["Kaja"])
        self.assertEqual(g["items"][0]["desktop"], "/api/wallpapers/3503336/desktop.jpg")
        self.assertEqual(g["items"][1]["desktop"], "/api/wallpapers/3503300/mobile.jpg")  # portrait-only falls back
        calls.clear()
        ws.run_once(lambda: ("test", LIST), download)
        self.assertEqual(calls, [])  # nothing changed, nothing downloaded
        with patch.object(ws, "KEEP", 1):
            ws.run_once(lambda: ("test", {"code": 0, "data": {"records": [record(9, [], [("1920x1080", "new")])]}}), download)
        self.assertEqual([i["id"] for i in ws.gallery()["items"]], ["9"])
        self.assertFalse(folder.exists())

    def test_falls_back_to_gallery_page_pictures(self):
        self.assertFalse(ws.gallery()["items"][0]["local"])  # before any sync: straight from Moonton
        self.assertTrue(all(i["desktop"].startswith(IMG) for i in ws.gallery()["items"]))
        with patch.object(ws, "fetch_gms", side_effect=OSError("offline")), patch.object(ws, "fetch_rone", side_effect=OSError("offline")):
            out = ws.run_once(download=lambda url: jpg((1920, 1080)) if url.endswith("0.jpg") else b"junk")
        self.assertEqual(out["source"], "Gallery page pictures")
        self.assertIn("offline", out["error"])
        items = ws.gallery()["items"]
        self.assertTrue(items and all(i["local"] for i in items))
        self.assertEqual(out["failed"], len(ws.GALLERY_SEED) - len(items))


class WallpaperApi(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.patches = [patch.object(ws, "WALL_DIR", self.tmp / "walls"), patch.object(ws, "MANIFEST", self.tmp / "walls" / "manifest.json"),
                        patch.object(hero_art_sync, "ART_DIR", self.tmp / "art"), patch.object(hero_art_sync, "MANIFEST", self.tmp / "art" / "manifest.json")]
        for p in self.patches:
            p.start()
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        factory = sessionmaker(bind=self.engine, autoflush=False)
        with factory() as db:
            users = [User(email=f"{r}@test.invalid", password_hash="x", name=r, role=r) for r in ("admin", "player")]
            db.add_all(users)
            db.commit()
            self.tokens = {u.role: issue_token(u.id, u.role, u.name) for u in users}

        def override_db():
            with factory() as db:
                yield db
        app.dependency_overrides[get_db] = override_db

    def tearDown(self):
        app.dependency_overrides.pop(get_db, None)
        self.engine.dispose()
        for p in reversed(self.patches):
            p.stop()

    def test_list_files_and_admin_refresh(self):
        self.assertEqual(call("GET", "/api/wallpapers")[0], 401)
        ws.run_once(lambda: ("test", LIST), lambda url: jpg((1080, 1920)) if "/m" in url else jpg((1920, 1080)))
        status, _, body = call("GET", "/api/wallpapers", self.tokens["player"])
        self.assertEqual(status, 200)
        self.assertEqual(len(json.loads(body)["items"]), 2)
        status, headers, body = call("GET", "/api/wallpapers/3503336/desktop.jpg")  # public, like bundled art
        self.assertEqual((status, headers["content-type"]), (200, "image/jpeg"))
        self.assertTrue(body.startswith(b"\xff\xd8"))
        for bad in ("/api/wallpapers/3503336/secret.jpg", "/api/wallpapers/..%2f..%2fx/desktop.jpg", "/api/wallpapers/nope/desktop.jpg"):
            self.assertEqual(call("GET", bad)[0], 404)
        self.assertEqual(call("POST", "/api/wallpapers/sync", self.tokens["player"])[0], 403)
        with patch.object(ws, "run_once") as run:
            self.assertEqual(call("POST", "/api/wallpapers/sync", self.tokens["admin"])[0], 202)
        for _ in range(50):
            if run.called:
                break
            asyncio.run(asyncio.sleep(0.02))
        run.assert_called_once()

    def test_official_hero_picture_for_new_heroes(self):
        path = hero_art_sync.ART_DIR / "hirara" / "head.png"
        path.parent.mkdir(parents=True)
        Image.new("RGB", (64, 64), (200, 10, 10)).save(path, "PNG")
        status, headers, body = call("GET", "/api/heroes/art/hirara/head")
        self.assertEqual((status, headers["content-type"]), (200, "image/png"))
        self.assertTrue(body.startswith(b"\x89PNG"))
        for bad in ("/api/heroes/art/hirara/smallmap", "/api/heroes/art/hirara/manifest", "/api/heroes/art/HIRARA!/head", "/api/heroes/art/nobody/head"):
            self.assertEqual(call("GET", bad)[0], 404)


if __name__ == "__main__":
    unittest.main()
