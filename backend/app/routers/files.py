"""Generic file uploads (device files for program tasks, briefs, etc.).

Files are stored on disk under backend/data/uploads with random names and
served back to any signed-in member via GET /files/{name}.
"""
from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..config import UPLOAD_DIR
from ..deps import can, get_current_user, get_db, require

router = APIRouter(prefix="/files", tags=["files"])

MAX_UPLOAD_BYTES = 60 * 1024 * 1024  # 60 MB

EXT_KIND = {
    "png": "image", "jpg": "image", "jpeg": "image", "webp": "image", "gif": "image",
    "mp4": "video", "webm": "video", "mov": "video",
    "pdf": "pdf",
    "txt": "file", "md": "file", "csv": "file", "zip": "file",
}


def _safe_name(filename: str) -> tuple[str, str]:
    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "").lower()
    if ext not in EXT_KIND:
        raise HTTPException(status_code=422,
            detail="File type not allowed — use images, video, PDF, text or zip")
    return secrets.token_hex(10) + "." + ext, ext


@router.post("", status_code=201)
async def upload_file(file: UploadFile, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_training(user), "upload files")
    stored, ext = _safe_name(file.filename or "")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=422, detail="Empty file")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 60 MB)")
    (UPLOAD_DIR / stored).write_bytes(raw)
    return {
        "label": file.filename or stored,
        "url": f"/api/files/{stored}",
        "kind": EXT_KIND[ext],
    }


@router.get("/{name}")
def get_file(name: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if "/" in name or ".." in name or name.count(".") != 1:
        raise HTTPException(status_code=404, detail="Not found")
    p = UPLOAD_DIR / name
    if not p.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    kind = EXT_KIND.get(name.rsplit(".", 1)[-1].lower(), "file")
    disp = "inline" if kind in {"image", "video", "pdf"} else "attachment"
    return FileResponse(p, headers={"Content-Disposition": f'{disp}; filename="{name}"',
                                    "Cache-Control": "private, max-age=3600"})
