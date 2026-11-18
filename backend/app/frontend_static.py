"""Serve the built web app (``frontend/dist``) from the API process — production on one port.

Off by default (development uses the Vite dev server). Turn it on with
``CLOVER_SERVE_FRONTEND=1`` (``start-arena.bat`` does this), optionally pointing
``CLOVER_FRONTEND_DIST`` at another build folder. Then uvicorn alone serves:

* ``/api/*``, ``/docs`` …        → the API, exactly as before (registered first)
* ``/assets/*``                 → hashed build files, cached for a year
* ``/sw.js``, ``/manifest.webmanifest``, ``/index.html`` → always revalidated, so
  installed apps pick up every new build
* anything else that isn't a file → ``index.html`` (the app's own router takes over)
"""
from __future__ import annotations

import logging
import mimetypes
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

from .config import REPO_ROOT

logger = logging.getLogger("clover")

# Windows reads MIME types from the registry and can report .js as text/plain, which
# browsers refuse for module scripts. Pin the types the build uses.
for _type, _ext in (("text/javascript", ".js"), ("text/javascript", ".mjs"), ("text/css", ".css"),
                    ("image/svg+xml", ".svg"), ("application/manifest+json", ".webmanifest"),
                    ("font/woff2", ".woff2"), ("font/woff", ".woff"), ("image/webp", ".webp"),
                    ("application/json", ".json"), ("image/png", ".png")):
    mimetypes.add_type(_type, _ext)

# Paths the API owns: never answered with the web app, even when nothing matched.
API_PREFIXES = ("api/", "live/", "ws/", "docs", "redoc", "openapi.json")
NO_CACHE = {"Cache-Control": "no-cache"}
IMMUTABLE = {"Cache-Control": "public, max-age=31536000, immutable"}
SHORT = {"Cache-Control": "public, max-age=3600"}


def enabled() -> bool:
    return os.getenv("CLOVER_SERVE_FRONTEND", "").strip().lower() in {"1", "true", "yes", "on"}


def dist_dir() -> Path:
    custom = os.getenv("CLOVER_FRONTEND_DIST", "").strip()
    return Path(custom).expanduser().resolve() if custom else (REPO_ROOT / "frontend" / "dist").resolve()


def _headers(rel: str) -> dict[str, str]:
    if rel.startswith("assets/"):
        return IMMUTABLE
    if rel in {"sw.js", "manifest.webmanifest", "index.html", "registerSW.js"}:
        return {**NO_CACHE, "Service-Worker-Allowed": "/"} if rel == "sw.js" else NO_CACHE
    return SHORT


def mount_frontend(app: FastAPI, root: Path) -> bool:
    """Add the web app routes. Call after every API router so the API always wins."""
    root = root.resolve()
    index = root / "index.html"
    if not index.is_file():
        logger.warning("Web app build not found at %s — run `npm run build` in frontend/. Serving the API only.", root)
        return False

    @app.get("/", include_in_schema=False)
    def web_index():
        return FileResponse(index, headers=NO_CACHE)

    @app.get("/{path:path}", include_in_schema=False)
    def web_app(path: str):
        if path == "api" or path.startswith(API_PREFIXES):
            raise HTTPException(status_code=404, detail="Not Found")
        target = (root / path).resolve()
        # Real files only, and never outside the build folder (no ../ tricks).
        if target.is_file() and (target == root or root in target.parents):
            return FileResponse(target, headers=_headers(path))
        if Path(path).suffix and path.startswith("assets/"):
            raise HTTPException(status_code=404, detail="Not Found")  # a stale hashed file, not a page
        return FileResponse(index, headers=NO_CACHE)

    logger.info("Serving the web app from %s", root)
    return True


def maybe_mount(app: FastAPI) -> bool:
    return mount_frontend(app, dist_dir()) if enabled() else False
