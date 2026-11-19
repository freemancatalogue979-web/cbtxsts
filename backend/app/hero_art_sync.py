"""Official hero portraits from Moonton, kept fresh for the portrait checker.

The hero page on mobilelegends.com (``/m/hero``) is fed by Moonton's public GMS list (app 2669606,
source 2756564). Every hero there carries:

* ``head`` — the square face icon (the same art the game shows on scoreboards and in the draft);
* ``smallmap`` — the tall hero-list card (``hero.data.smallmap`` on that page);
* ``squarehead`` — a larger square face, when Moonton has one.

Once a day (with the hero database refresh) the list is read — straight from Moonton first, Rone's
relay of the same list as a backup — and any picture that is new or changed is downloaded to
``data/hero_official/<slug>/<kind>.png``. :mod:`hero_vision` then compares screenshot portraits with
these next to the art bundled in the repo, so a hero released after the last app update, or a
hero whose art Moonton refreshed, is still recognised.

Only Moonton's own image hosts are downloaded from; nothing about members is ever sent.
"""
from __future__ import annotations

import io
import json
import logging
import os
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

from PIL import Image

from .config import DATA_DIR

logger = logging.getLogger("clover.hero_art")

ENABLED = os.getenv("CLOVER_HERO_ART_SYNC", "1").strip().lower() not in {"0", "false", "off", "no"}
ART_DIR = DATA_DIR / "hero_official"
MANIFEST = ART_DIR / "manifest.json"
KINDS = ("head", "squarehead", "smallmap")
MAX_BYTES = 4 * 1024 * 1024
MAX_SIDE = 512              # stored pictures are shrunk to this; the matcher works far smaller
TIMEOUT = 12
UA = "Mozilla/5.0 (9 Clover hub; hero portraits)"

GMS_URL = "https://api.gms.moontontech.com/api/gms/source/2669606/2756564"
# The public key the mobilelegends.com hero page itself sends. Moonton rotates it now and then:
# set CLOVER_GMS_AUTHORIZATION to the current one (browser dev tools → that request) if Moonton refuses.
GMS_AUTH = os.getenv("CLOVER_GMS_AUTHORIZATION", "").strip() or "UoXPlAENpsE7NAfeDxk4SvbyDTc="
GMS_HEADERS = {
    "accept": "application/json, text/plain, */*",
    "content-type": "application/json;charset=UTF-8",
    "origin": "https://www.mobilelegends.com",
    "referer": "https://www.mobilelegends.com/",
    "x-actid": "2669607",
    "x-appid": "2669606",
    "x-lang": "en",
    "user-agent": UA,
}
GMS_BODY = {
    "pageSize": 300, "pageIndex": 1, "filters": [], "object": [],
    "sorts": [{"data": {"field": "hero_id", "order": "desc"}, "type": "sequence"}],
    "fields": ["hero_id", "hero.data.name", "hero.data.head", "hero.data.smallmap", "hero.data.squarehead"],
}
RONE_PATH, RONE_QUERY = "heroes", "size=300&index=1&order=desc&lang=en"
IMAGE_HOSTS = ("youngjoygame.com", "moontontech.com", "mobilelegends.com")


class ArtSyncError(RuntimeError):
    pass


def slug(name: str) -> str:
    return "-".join(str(name or "").lower().replace("'", " ").replace("’", " ").split())


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def allowed_image(url: Any) -> bool:
    if not isinstance(url, str) or not url.startswith("https://"):
        return False
    host = (urlparse(url).hostname or "").lower()
    return any(host == h or host.endswith("." + h) for h in IMAGE_HOSTS)


def parse_list(payload: Any) -> list[dict]:
    """GMS (or Rone's relay of it) → [{hero_id, name, slug, urls: {kind: url}}]."""
    data = payload.get("data") if isinstance(payload, dict) else None
    records = data.get("records") if isinstance(data, dict) else None
    out, seen = [], set()
    for rec in records if isinstance(records, list) else []:
        row = rec.get("data") if isinstance(rec, dict) else None
        if not isinstance(row, dict):
            continue
        hero = ((row.get("hero") or {}).get("data") or {}) if isinstance(row.get("hero"), dict) else {}
        name = str(hero.get("name") or "").strip()
        if not name or slug(name) in seen:
            continue
        urls = {k: hero[k] for k in KINDS if allowed_image(hero.get(k))}
        if not urls:
            continue
        seen.add(slug(name))
        hid = row.get("hero_id")
        out.append({"hero_id": int(hid) if str(hid).isdigit() else None, "name": name, "slug": slug(name), "urls": urls})
    return out


def _http(url: str, data: bytes | None = None, headers: dict | None = None, limit: int = MAX_BYTES) -> bytes:
    req = urllib.request.Request(url, data=data, headers=headers or {"user-agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:  # noqa: S310 - fixed https hosts only
        body = resp.read(limit + 1)
    if len(body) > limit:
        raise ArtSyncError("Picture too large")
    return body


def fetch_gms() -> Any:
    body = json.dumps(GMS_BODY).encode()
    payload = json.loads(_http(GMS_URL, body, {**GMS_HEADERS, "authorization": GMS_AUTH}))
    if not isinstance(payload, dict) or payload.get("code") not in (0, "0", None):
        raise ArtSyncError(f"Moonton refused the hero list ({payload.get('code') if isinstance(payload, dict) else '?'}: "
                           f"{(payload.get('message') or payload.get('msg') or '') if isinstance(payload, dict) else ''})".strip())
    return payload


def fetch_rone() -> Any:
    from .routers.intel import _public_fetch

    status, payload = _public_fetch(RONE_PATH, RONE_QUERY)
    if status != 200:
        raise ArtSyncError(f"Rone answered HTTP {status}")
    return payload


def load_manifest() -> dict:
    try:
        data = json.loads(MANIFEST.read_text("utf8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save_manifest(data: dict) -> None:
    ART_DIR.mkdir(parents=True, exist_ok=True)
    tmp = MANIFEST.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1, sort_keys=True), "utf8")
    tmp.replace(MANIFEST)


def store_picture(raw: bytes, path: Path) -> None:
    """Validate and save a downloaded picture as PNG (transparent corners become dark, like the game's frame)."""
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception as exc:  # noqa: BLE001 - not a picture
        raise ArtSyncError("Not a picture") from exc
    if min(img.size) < 24:
        raise ArtSyncError("Picture too small")
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGBA", img.size, (18, 22, 32, 255))
        img = Image.alpha_composite(bg, img)
    img = img.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    img.save(tmp, "PNG")
    tmp.replace(path)


def run_once(fetch_list: Callable[[], tuple[str, Any]] | None = None,
             download: Callable[[str], bytes] | None = None) -> dict:
    """Read the official list and download what's new or changed. Returns a summary (also saved)."""
    manifest = load_manifest()
    heroes_state: dict = manifest.get("heroes") if isinstance(manifest.get("heroes"), dict) else {}
    download = download or _http
    source, heroes = "", []
    errors: list[str] = []
    if fetch_list is not None:
        source, payload = fetch_list()
        heroes = parse_list(payload)
    else:
        for label, fn in (("Moonton (mobilelegends.com hero list)", fetch_gms), ("Rone (relay of the same list)", fetch_rone)):
            try:
                heroes = parse_list(fn())
            except Exception as exc:  # noqa: BLE001 - try the backup
                errors.append(f"{label.split(' (')[0]}: {str(exc)[:120] or type(exc).__name__}")
                continue
            if heroes:
                source = label
                break
            errors.append(f"{label.split(' (')[0]}: empty hero list")
    summary = {"at": _now(), "source": source, "heroes": len(heroes), "downloaded": 0, "failed": 0,
               "new_heroes": [], "error": "" if heroes else ("; ".join(errors) or "No hero list")}
    first_run = not heroes_state
    for h in heroes:
        entry = heroes_state.setdefault(h["slug"], {"name": h["name"], "hero_id": h["hero_id"], "urls": {}, "files": {}})
        if not entry.get("files"):
            summary["new_heroes"].append(h["name"])
        entry.update(name=h["name"], hero_id=h["hero_id"])
        for kind, url in h["urls"].items():
            path = ART_DIR / h["slug"] / f"{kind}.png"
            if entry["urls"].get(kind) == url and path.is_file():
                continue
            try:
                store_picture(download(url), path)
            except Exception as exc:  # noqa: BLE001 - one bad picture never stops the rest
                summary["failed"] += 1
                logger.info("Hero art %s/%s not saved: %s", h["slug"], kind, exc)
                continue
            entry["urls"][kind] = url
            entry["files"][kind] = path.name
            entry["updated_at"] = summary["at"]
            summary["downloaded"] += 1
    if first_run:
        summary["new_heroes"] = []        # everything is "new" the first time; only later arrivals are news
    manifest.update(heroes=heroes_state, last=summary)
    _save_manifest(manifest)
    if summary["downloaded"]:
        from . import hero_vision

        hero_vision.reset()
    if summary["error"]:
        logger.warning("Official hero art not refreshed: %s", summary["error"])
    else:
        logger.info("Official hero art: %s heroes from %s, %s pictures saved", len(heroes), source, summary["downloaded"])
    return summary


def official_files() -> dict[str, dict]:
    """{slug: {"name": ..., "paths": {kind: Path}}} for every saved picture."""
    out: dict[str, dict] = {}
    for key, entry in (load_manifest().get("heroes") or {}).items():
        if not isinstance(entry, dict) or not re.fullmatch(r"[a-z0-9.\-]+", key):
            continue
        paths = {k: ART_DIR / key / f"{k}.png" for k in KINDS if (ART_DIR / key / f"{k}.png").is_file()}
        if paths:
            out[key] = {"name": entry.get("name") or key, "paths": paths}
    return out


def status() -> dict:
    m = load_manifest()
    last = m.get("last") if isinstance(m.get("last"), dict) else {}
    files = official_files()
    return {"enabled": ENABLED, "heroes": len(files), "pictures": sum(len(v["paths"]) for v in files.values()),
            "last_at": last.get("at"), "source": last.get("source") or "", "downloaded": last.get("downloaded", 0),
            "new_heroes": last.get("new_heroes") or [], "error": last.get("error") or ""}
