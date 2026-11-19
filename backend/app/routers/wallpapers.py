"""Official MLBB wallpapers for the hub background (see :mod:`app.wallpaper_sync`)."""
from __future__ import annotations

import threading

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from .. import wallpaper_sync
from ..deps import get_current_user, require

router = APIRouter(prefix="/wallpapers", tags=["wallpapers"])
_running = threading.Event()


@router.get("")
@router.get("/")
def list_wallpapers(user=Depends(get_current_user)):
    data = wallpaper_sync.gallery()
    data["refreshing"] = _running.is_set()
    return data


@router.post("/sync", status_code=202)
def sync_wallpapers(user=Depends(get_current_user)):
    """Admin: fetch the newest gallery wallpapers now (in the background)."""
    require(user.role == "admin", "refresh the wallpapers")
    if not _running.is_set():
        _running.set()

        def work():
            try:
                wallpaper_sync.run_once()
            except Exception:  # noqa: BLE001 - logged; cosmetic
                wallpaper_sync.logger.exception("Wallpaper refresh failed")
            finally:
                _running.clear()

        threading.Thread(target=work, name="wallpaper-sync", daemon=True).start()
    data = wallpaper_sync.gallery()
    data["refreshing"] = True
    return data


@router.get("/{wid}/{kind}.jpg")
def wallpaper_file(wid: str, kind: str):
    # Public art (Moonton's own gallery), so the login screen can use it too.
    path = wallpaper_sync.file_for(wid, kind)
    if not path:
        raise HTTPException(status_code=404, detail="Wallpaper not found")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=604800"})
