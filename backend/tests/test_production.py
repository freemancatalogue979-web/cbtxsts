"""Production mode: one process serves the built web app + API; backend/.env is made safe."""
from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("CLOVER_AERENA_ENABLED", "0")
os.environ.setdefault("CLOVER_HERO_SYNC_ENABLED", "0")
BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from fastapi import FastAPI  # noqa: E402

from app import frontend_static  # noqa: E402
from app.security import hash_password  # noqa: E402

sys.path.insert(0, str(BACKEND / "scripts"))


class Response:
    def __init__(self, status: int, headers: dict[str, str], body: bytes) -> None:
        self.status_code, self.headers, self.content = status, headers, body
        self.text = body.decode("utf-8", "replace")

    def json(self):
        import json
        return json.loads(self.content)


class TestClient:
    """Minimal in-process ASGI client (the repo has no httpx)."""

    def __init__(self, app) -> None:
        self.app = app

    def get(self, path: str) -> Response:
        import asyncio
        from urllib.parse import unquote
        raw, _, query = path.partition("?")
        scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "GET", "scheme": "http",
                 "path": unquote(raw), "raw_path": raw.encode(), "query_string": query.encode(), "root_path": "",
                 "headers": [(b"host", b"testserver")], "client": ("127.0.0.1", 1), "server": ("testserver", 80)}
        sent: list[dict] = []

        done = asyncio.Event()
        first = True

        async def receive():
            nonlocal first
            if first:
                first = False
                return {"type": "http.request", "body": b"", "more_body": False}
            await done.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            sent.append(message)
            if message["type"] == "http.response.body" and not message.get("more_body"):
                done.set()

        asyncio.run(asyncio.wait_for(self.app(scope, receive, send), 10))
        start = next(m for m in sent if m["type"] == "http.response.start")
        headers = {k.decode().lower(): v.decode() for k, v in start["headers"]}
        return Response(start["status"], headers, b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body"))
import prod_env  # noqa: E402


class FrontendServingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.dist = root / "dist"
        (self.dist / "assets").mkdir(parents=True)
        (self.dist / "index.html").write_text("<!doctype html><div id=root></div>")
        (self.dist / "assets" / "app-abc123.js").write_text("console.log('hi')")
        (self.dist / "assets" / "app-abc123.css").write_text("body{}")
        (self.dist / "sw.js").write_text("self.addEventListener('fetch',()=>{})")
        (self.dist / "manifest.webmanifest").write_text("{}")
        (root / "secret.txt").write_text("do not serve")
        self.app = FastAPI()

        @self.app.get("/api/health")
        def health():
            return {"ok": True}

        self.assertTrue(frontend_static.mount_frontend(self.app, self.dist))
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_api_wins_and_unknown_api_paths_stay_404(self):
        self.assertEqual(self.client.get("/api/health").json(), {"ok": True})
        for path in ("/api/nope", "/api", "/live/x", "/ws/x"):
            r = self.client.get(path)
            self.assertEqual(r.status_code, 404, path)
            self.assertEqual(r.json(), {"detail": "Not Found"})
        self.assertEqual(self.client.get("/docs").status_code, 200)  # FastAPI's own docs untouched

    def test_app_pages_fall_back_to_index_and_files_get_the_right_cache(self):
        for path in ("/", "/players/5", "/utility/add", "/heroes"):
            r = self.client.get(path)
            self.assertEqual(r.status_code, 200, path)
            self.assertIn("id=root", r.text)
            self.assertEqual(r.headers["cache-control"], "no-cache")
        js = self.client.get("/assets/app-abc123.js")
        self.assertTrue(js.headers["content-type"].startswith("text/javascript"))
        self.assertIn("immutable", js.headers["cache-control"])
        self.assertTrue(self.client.get("/assets/app-abc123.css").headers["content-type"].startswith("text/css"))
        sw = self.client.get("/sw.js")
        self.assertEqual((sw.headers["cache-control"], sw.headers["service-worker-allowed"]), ("no-cache", "/"))
        self.assertEqual(self.client.get("/manifest.webmanifest").headers["content-type"], "application/manifest+json")
        # A stale hashed file from an older build is a 404, not the app shell.
        self.assertEqual(self.client.get("/assets/old-999.js").status_code, 404)

    def test_never_serves_files_outside_the_build(self):
        for path in ("/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt"):
            r = self.client.get(path)
            self.assertNotIn("do not serve", r.text, path)

    def test_off_unless_asked_and_missing_build_only_warns(self):
        with patch.dict(os.environ, {"CLOVER_SERVE_FRONTEND": ""}):
            self.assertFalse(frontend_static.maybe_mount(FastAPI()))
        with patch.dict(os.environ, {"CLOVER_SERVE_FRONTEND": "1", "CLOVER_FRONTEND_DIST": str(Path(self.tmp.name) / "none")}):
            with self.assertLogs("clover", "WARNING"):
                self.assertFalse(frontend_static.maybe_mount(FastAPI()))
        with patch.dict(os.environ, {"CLOVER_SERVE_FRONTEND": "1", "CLOVER_FRONTEND_DIST": str(self.dist)}):
            app = FastAPI()
            self.assertTrue(frontend_static.maybe_mount(app))
            self.assertIn("id=root", TestClient(app).get("/scrims").text)


class ProdEnvTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.env = self.dir / ".env"
        self.db = self.dir / "clover.db"
        clean = {k: v for k, v in os.environ.items() if not k.startswith(("CLOVER_SECRET", "CLOVER_ADMIN", "CLOVER_DATABASE"))}
        self.patch = patch.dict(os.environ, {**clean, "CLOVER_DATABASE_URL": f"sqlite:///{self.db}"}, clear=True)
        self.patch.start()

    def tearDown(self) -> None:
        self.patch.stop()
        self.tmp.cleanup()

    def run_main(self) -> str:
        from contextlib import redirect_stdout
        from io import StringIO
        out = StringIO()
        with redirect_stdout(out):
            self.assertEqual(prod_env.main(self.env), 0)
        return out.getvalue()

    def test_fresh_install_gets_a_secret_and_a_random_admin_password_once(self):
        self.env.write_text("CLOVER_SECRET_KEY=\nCLOVER_ADMIN_PASSWORD=clover2026\n")  # copied from .env.example
        out = self.run_main()
        values = prod_env.read_env(self.env)
        self.assertGreaterEqual(len(values["CLOVER_SECRET_KEY"]), 40)
        self.assertNotEqual(values["CLOVER_ADMIN_PASSWORD"], "clover2026")
        self.assertIn(f"admin / {values['CLOVER_ADMIN_PASSWORD']}", out)
        self.assertEqual(self.env.read_text().count("CLOVER_SECRET_KEY="), 1)  # replaced in place, not duplicated
        before = self.env.read_text()
        self.run_main()
        self.assertEqual(self.env.read_text(), before)  # second run changes nothing

    def test_old_cbt_secret_is_reused_so_nobody_is_signed_out(self):
        self.db.touch()
        self.env.write_text("CBT_SECRET_KEY=keep-me-123\n")
        self.run_main()
        self.assertEqual(prod_env.read_env(self.env)["CLOVER_SECRET_KEY"], "keep-me-123")

    def test_existing_database_warns_about_the_default_admin_password(self):
        with sqlite3.connect(self.db) as conn:
            conn.execute("CREATE TABLE users (email TEXT, password_hash TEXT, role TEXT, active INTEGER)")
            conn.execute("INSERT INTO users VALUES ('admin@9clover.gg', ?, 'admin', 1)", (hash_password("clover2026"),))
            conn.execute("INSERT INTO users VALUES ('dre@9clover.gg', ?, 'admin', 1)", (hash_password("long-unique-pass"),))
        self.env.write_text("CLOVER_SECRET_KEY=already-set\n")
        out = self.run_main()
        self.assertIn("admin still use(s) the default password", out)
        self.assertNotIn("dre", out)
        self.assertNotIn("CLOVER_ADMIN_PASSWORD", self.env.read_text())  # never touches an existing database

    def test_runs_as_a_script(self):
        self.env.write_text("CLOVER_SECRET_KEY=x\n")
        self.db.touch()
        r = subprocess.run([sys.executable, str(BACKEND / "scripts" / "prod_env.py")], capture_output=True, text=True,
                           env={**os.environ, "CLOVER_DATABASE_URL": f"sqlite:///{self.db}", "CLOVER_SECRET_KEY": "from-env"})
        self.assertEqual(r.returncode, 0, r.stderr)


if __name__ == "__main__":
    unittest.main()
