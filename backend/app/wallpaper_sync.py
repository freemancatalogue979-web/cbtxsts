"""Official MLBB wallpapers (mobilelegends.com/m/gallery) for customising the hub.

The gallery page is fed by Moonton's public GMS content API (app 2669606, wallpaper source 3255326,
"Wallpaper" channel 3255313). Each record carries the hero ids it shows plus the same picture in
several sizes (1920x1080, 2560x1440, 1080x1920, 1080x2400 …).

Once a day, with the hero refresh, the newest wallpapers are read — straight from Moonton first,
Rone's relay of the same list next — and saved on the server:

    data/wallpapers/<id>/desktop.jpg   landscape, at most 1920 wide
    data/wallpapers/<id>/mobile.jpg    portrait, at most 1080 wide
    data/wallpapers/<id>/thumb.jpg     small preview for the picker

If neither list answers, the wallpapers seen on the gallery page itself are downloaded directly.
Only Moonton's own image hosts are downloaded from and nothing about members is ever sent.
Members pick one in the profile menu (or let every area get its own); the choice is device-local.
"""
from __future__ import annotations

import io
import json
import logging
import os
import re
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from PIL import Image

from .config import DATA_DIR
from .hero_art_sync import GMS_AUTH, GMS_HEADERS, ArtSyncError, _http, allowed_image

logger = logging.getLogger("clover.wallpapers")

ENABLED = os.getenv("CLOVER_WALLPAPER_SYNC", "1").strip().lower() not in {"0", "false", "off", "no"}
WALL_DIR = DATA_DIR / "wallpapers"
MANIFEST = WALL_DIR / "manifest.json"
KEEP = max(4, min(int(os.getenv("CLOVER_WALLPAPER_KEEP", "36") or 36), 120))
MAX_BYTES = 12 * 1024 * 1024
SIZES = {"desktop": (1920, 1920), "mobile": (1080, 2400), "thumb": (480, 480)}
KINDS = ("desktop", "mobile", "thumb")

GMS_URL = "https://api.gms.moontontech.com/api/gms/source/2669606/3255326"
CHANNEL = 3255313
GMS_BODY = {"pageSize": 60, "pageIndex": 1, "filters": [{"field": "channel", "operator": "hasAnyOf", "value": [CHANNEL]}],
            "sorts": [], "object": []}
RONE_PATH, RONE_QUERY = "heroes/wallpapers", "device=desktop&size=60&index=1&lang=en"
IMAGE_BASE = "https://akmweb.youngjoygame.com/web/gms/image/"
# Shown on mobilelegends.com/m/gallery (Oct 2026). Used when neither list can be read, and as
# picker entries (loaded straight from Moonton) before the server has saved anything.
GALLERY_SEED = (
    "e74da4cbaf5db9d97036a914ae0ce370", "e1947af3909d736350fe6d643143f505", "0b336c2cfb64d7bfdc1fb32616a1ca20",
    "fa0661a702ec08e82200908e4f0144fc", "86e8c917b7d0560473b1dab376fdd6b1", "8a4f3603a70f66efd8b15b84179f12b2",
    "bf17432c81a34849f5bfd6590a8321ff", "df025b4dda2d11ecde52129e1a956c3b", "c219a9f316df90205f97c2b80b440769",
    "a541d88e99eb90f46275ac113f51bb1e", "15a613be4effb97c00dcc7c3f621ed84", "a51d7cb1dddf3b6a27de830a1e3cf76d",
    "14f309104559bedfafab2ba34519a886", "a0492113bb02756148a18c1b145220dc", "cf972c24a3761801a09beae9f619daff",
)
ID_RE = re.compile(r"[a-z0-9]{1,40}")
_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _size(res: Any) -> tuple[int, int]:
    m = re.fullmatch(r"\s*(\d{2,5})\s*[x×*]\s*(\d{2,5})\s*", str(res or ""))
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


def _best(pictures: list[dict], landscape: bool) -> str | None:
    """Pick the picture closest to (but preferably not below) 1920 wide / 1920 tall for the orientation."""
    rows = []
    for p in pictures:
        w, h = _size(p.get("resolution"))
        if not w or not allowed_image(p.get("url")) or (w > h) != landscape:
            continue
        long_side = max(w, h)
        rows.append((long_side < 1920, abs(long_side - 1920), p["url"]))
    return min(rows)[2] if rows else None


def parse_list(payload: Any) -> list[dict]:
    """GMS (or Rone's relay) → [{id, title, hero_ids, urls: {desktop?, mobile?}}], newest first as given."""
    data = payload.get("data") if isinstance(payload, dict) else None
    records = data.get("records") if isinstance(data, dict) else None
    out, seen = [], set()
    for rec in records if isinstance(records, list) else []:
        if not isinstance(rec, dict) or not isinstance(rec.get("data"), dict):
            continue
        row = rec["data"]
        wid = str(rec.get("id") or rec.get("configId") or "").strip()
        if not ID_RE.fullmatch(wid) or wid in seen:
            continue
        pics = [p for p in row.get("pictures") or [] if isinstance(p, dict)]
        urls = {k: u for k, u in (("desktop", _best(pics, True)), ("mobile", _best(pics, False))) if u}
        if not urls:
            continue
        seen.add(wid)
        ids = [int(h) for h in row.get("heroid") or [] if str(h).isdigit()]
        out.append({"id": wid, "title": "", "hero_ids": ids[:5], "urls": urls})
    return out


def seed_list() -> list[dict]:
    return [{"id": md5[:16], "title": "", "hero_ids": [], "urls": {"any": IMAGE_BASE + md5 + ".jpg"}} for md5 in GALLERY_SEED]


def fetch_gms() -> Any:
    payload = json.loads(_http(GMS_URL, json.dumps(GMS_BODY).encode(), {**GMS_HEADERS, "authorization": GMS_AUTH}))
    if not isinstance(payload, dict) or payload.get("code") not in (0, "0", None):
        raise ArtSyncError(f"Moonton refused the wallpaper list ({payload.get('code') if isinstance(payload, dict) else '?'})")
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
    WALL_DIR.mkdir(parents=True, exist_ok=True)
    tmp = MANIFEST.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1, sort_keys=True), "utf8")
    tmp.replace(MANIFEST)


def _open(raw: bytes) -> Image.Image:
    try:
        with Image.open(io.BytesIO(raw)) as img:
            img.load()
            out = img.convert("RGB")
    except Exception as exc:  # noqa: BLE001 - not a picture
        raise ArtSyncError("Not a picture") from exc
    if min(out.size) < 200:
        raise ArtSyncError("Picture too small")
    return out


def _save(img: Image.Image, kind: str, folder: Path) -> str:
    copy = img.copy()
    copy.thumbnail(SIZES[kind], Image.LANCZOS)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{kind}.jpg"
    tmp = path.with_suffix(".tmp")
    copy.save(tmp, "JPEG", quality=70 if kind == "thumb" else 84, optimize=True, progressive=True)
    tmp.replace(path)
    return path.name


def _hero_names() -> dict[int, str]:
    from .hero_art_sync import load_manifest as art_manifest

    out = {}
    for entry in (art_manifest().get("heroes") or {}).values():
        if isinstance(entry, dict) and isinstance(entry.get("hero_id"), int):
            out[entry["hero_id"]] = str(entry.get("name") or "")
    return out


def run_once(fetch_list: Callable[[], tuple[str, Any]] | None = None,
             download: Callable[[str], bytes] | None = None) -> dict:
    """Save the newest wallpapers (new ones only) and drop ones that fell out of the newest KEEP."""
    with _lock:
        return _run(fetch_list, download)


def _run(fetch_list, download) -> dict:
    manifest = load_manifest()
    state: dict = manifest.get("wallpapers") if isinstance(manifest.get("wallpapers"), dict) else {}
    download = download or (lambda url: _http(url, limit=MAX_BYTES))
    errors, source, walls = [], "", []
    if fetch_list is not None:
        source, payload = fetch_list()
        walls = parse_list(payload)
    else:
        for label, fn in (("Moonton (mobilelegends.com gallery)", fetch_gms), ("Rone (relay of the same list)", fetch_rone)):
            try:
                walls = parse_list(fn())
            except Exception as exc:  # noqa: BLE001 - try the next source
                errors.append(f"{label.split(' (')[0]}: {str(exc)[:120] or type(exc).__name__}")
                continue
            if walls:
                source = label
                break
            errors.append(f"{label.split(' (')[0]}: empty list")
        if not walls:
            walls, source = seed_list(), "Gallery page pictures"
    walls = walls[:KEEP]
    names = _hero_names()
    summary = {"at": _now(), "source": source, "listed": len(walls), "downloaded": 0, "failed": 0,
               "error": "; ".join(errors) if source == "Gallery page pictures" else ""}
    order = []
    for w in walls:
        entry = state.get(w["id"]) if isinstance(state.get(w["id"]), dict) else {"urls": {}, "files": {}}
        folder = WALL_DIR / w["id"]
        heroes = [names[h] for h in w["hero_ids"] if names.get(h)]
        entry.update(hero_ids=w["hero_ids"], heroes=heroes, title=w["title"] or " & ".join(heroes))
        for kind, url in w["urls"].items():
            if entry["urls"].get(kind) == url and all((folder / f).is_file() for f in entry["files"].values()):
                continue
            try:
                img = _open(download(url))
            except Exception as exc:  # noqa: BLE001 - one bad picture never stops the rest
                summary["failed"] += 1
                logger.info("Wallpaper %s/%s not saved: %s", w["id"], kind, exc)
                continue
            target = kind if kind != "any" else ("desktop" if img.width >= img.height else "mobile")
            entry["files"][target] = _save(img, target, folder)
            if target == "desktop" or "thumb" not in entry["files"]:
                entry["files"]["thumb"] = _save(img, "thumb", folder)
            entry["urls"][kind] = url
            entry["updated_at"] = summary["at"]
            summary["downloaded"] += 1
        if entry["files"].get("desktop") or entry["files"].get("mobile"):
            state[w["id"]] = entry
            order.append(w["id"])
    # Keep previously saved ones after the fresh list, then trim to KEEP (oldest go).
    for wid in manifest.get("order") or []:
        if wid in state and wid not in order:
            order.append(wid)
    for wid in order[KEEP:]:
        shutil.rmtree(WALL_DIR / wid, ignore_errors=True)
        state.pop(wid, None)
    order = order[:KEEP]
    state = {k: v for k, v in state.items() if k in order}
    manifest.update(wallpapers=state, order=order, last=summary)
    _save_manifest(manifest)
    logger.info("Wallpapers: %s listed from %s, %s pictures saved", len(walls), source or "nowhere", summary["downloaded"])
    return summary


def file_for(wid: str, kind: str) -> Path | None:
    if not ID_RE.fullmatch(wid or "") or kind not in KINDS:
        return None
    path = WALL_DIR / wid / f"{kind}.jpg"
    return path if path.is_file() else None


def gallery() -> dict:
    """Picker payload: saved wallpapers (served by us), or the gallery page pictures straight from Moonton."""
    m = load_manifest()
    state = m.get("wallpapers") if isinstance(m.get("wallpapers"), dict) else {}
    items = []
    for wid in m.get("order") or []:
        entry = state.get(wid)
        if not isinstance(entry, dict) or not ID_RE.fullmatch(str(wid)):
            continue
        url = {k: f"/api/wallpapers/{wid}/{k}.jpg" for k in KINDS if file_for(wid, k)}
        if not (url.get("desktop") or url.get("mobile")):
            continue
        items.append({"id": wid, "title": entry.get("title") or "", "heroes": entry.get("heroes") or [],
                      "desktop": url.get("desktop") or url.get("mobile"), "mobile": url.get("mobile") or url.get("desktop"),
                      "thumb": url.get("thumb") or url.get("desktop") or url.get("mobile"), "local": True})
    if not items:
        items = [{"id": s["id"], "title": "", "heroes": [], "desktop": s["urls"]["any"], "mobile": s["urls"]["any"],
                  "thumb": s["urls"]["any"], "local": False} for s in seed_list()]
    last = m.get("last") if isinstance(m.get("last"), dict) else {}
    return {"items": items, "enabled": ENABLED, "last_at": last.get("at"), "source": last.get("source") or "",
            "error": last.get("error") or ""}


def refresh() -> None:
    """Called by the daily hero worker; never raises."""
    if not ENABLED:
        return
    try:
        run_once()
    except Exception:  # noqa: BLE001 - wallpapers are cosmetic
        logger.exception("Wallpaper refresh failed")
