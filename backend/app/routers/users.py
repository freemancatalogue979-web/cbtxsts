"""Self-service user profile: edit profile + avatar upload/serve."""
from __future__ import annotations

import io

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image
from sqlalchemy.orm import Session

from ..config import AVATAR_DIR
from ..deps import get_current_user, get_db
from ..models import User
from ..schemas import UserSelfPatch
from ..serializers import user_out

router = APIRouter(prefix="/users", tags=["users"])

MAX_AVATAR_BYTES = 5 * 1024 * 1024


@router.patch("/me")
def update_me(payload: UserSelfPatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    fields = payload.model_dump(exclude_unset=True)
    if fields.get("main_role"):
        fields["main_role"] = fields["main_role"].upper()
        if fields["main_role"] not in ("EXP", "JUNGLE", "MID", "GOLD", "ROAM", ""):
            raise HTTPException(status_code=422, detail="main_role must be a lane")
    for k, v in fields.items():
        setattr(user, k, v)
    db.commit()
    return user_out(user)


def _avatar_path(user_id: int):
    return AVATAR_DIR / f"{user_id}.png"


@router.post("/me/avatar")
async def upload_avatar(file: UploadFile, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    raw = await file.read()
    if len(raw) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=413, detail="Avatar must be under 5MB")
    try:
        im = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=422, detail="Not a valid image")
    # center-crop to a square avatar
    w, h = im.size
    side = min(w, h)
    im = im.crop(((w - side) // 2, (h - side) // 2, (w - side) // 2 + side, (h - side) // 2 + side))
    im = im.resize((256, 256), Image.LANCZOS)
    im.save(_avatar_path(user.id), "PNG", optimize=True)
    return user_out(user)


@router.delete("/me/avatar", status_code=204)
def delete_avatar(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = _avatar_path(user.id)
    if p.exists():
        p.unlink()


@router.get("/me")
def read_me(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return user_out(user)


@router.get("/{user_id}/avatar")
def get_avatar(user_id: int):
    p = _avatar_path(user_id)
    if not p.exists():
        raise HTTPException(status_code=404, detail="No avatar")
    return FileResponse(p, media_type="image/png", headers={"Cache-Control": "no-cache"})
