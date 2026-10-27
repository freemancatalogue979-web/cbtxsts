"""Archive — per-player lockers for theory, documents, videos and private drops.

Every squad member may own exactly one locker. The locker card itself is
team-visible, but items inside are gated per item:

- PUBLIC  — every signed-in squad member can view and comment.
- PRIVATE — visible ONLY to the locker owner and the members the owner picked.
            Admins are NOT auto-included: private means private.

Uploaded files are stored on disk under ``backend/data/archive`` with random
names and served through a permission-checked endpoint, so a private file can
never be fetched by guessing its URL.
"""
from __future__ import annotations

import json
import secrets

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import ARCHIVE_DIR
from ..deps import ROLE_ADMIN, get_current_user, get_db
from ..models import ArchiveComment, ArchiveFolder, ArchiveItem, User, dumps, loads, utcnow
from ..schemas import ArchiveCommentIn, ArchiveFolderIn, ArchiveFolderPatch, ArchiveItemPatch
from ..serializers import user_brief

router = APIRouter(prefix="/archive", tags=["archive"])

MAX_UPLOAD_BYTES = 60 * 1024 * 1024  # 60 MB

ARCHIVE_EXT_KIND = {
    "png": "image", "jpg": "image", "jpeg": "image", "webp": "image", "gif": "image",
    "mp4": "video", "webm": "video", "mov": "video", "m4v": "video",
    "mp3": "audio", "wav": "audio", "ogg": "audio", "m4a": "audio",
    "pdf": "pdf",
    "txt": "file", "md": "file", "csv": "file", "zip": "file",
    "doc": "file", "docx": "file", "ppt": "file", "pptx": "file",
    "xls": "sheet", "xlsx": "sheet",
}

ITEM_KINDS = {"note", "link", "video", "file"}


# --------------------------------------------------------------------------- helpers
def _iso(dt) -> str:
    return dt.isoformat() + "Z" if dt else ""


def _shared_ids(item: ArchiveItem) -> list[int]:
    out: list[int] = []
    for x in loads(item.shared):
        try:
            out.append(int(x))
        except (TypeError, ValueError):
            continue
    return out


def _can_view(item: ArchiveItem, user: User) -> bool:
    """Public → any squad member. Private → owner + hand-picked viewers ONLY
    (admins are 'everyone else' here — private means private)."""
    if item.visibility != "private":
        return True
    if user.id in {item.created_by, item.folder.owner_id}:
        return True
    return user.id in _shared_ids(item)


def _get_folder(db: Session, folder_id: int) -> ArchiveFolder:
    folder = db.get(ArchiveFolder, folder_id)
    if folder is None:
        raise HTTPException(status_code=404, detail="Locker not found")
    return folder


def _get_item(db: Session, item_id: int) -> ArchiveItem:
    item = db.get(ArchiveItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


def _item_out(db: Session, item: ArchiveItem, user: User) -> dict | None:
    if not _can_view(item, user):
        return None
    owner = db.get(User, item.folder.owner_id)
    shared_users = []
    if item.visibility == "private" and user.id in {item.created_by, item.folder.owner_id}:
        # only the owner sees WHO has access
        for uid in _shared_ids(item):
            u = db.get(User, uid)
            if u is not None:
                shared_users.append(user_brief(u))
    out = {
        "id": item.id,
        "folder_id": item.folder_id,
        "title": item.title,
        "kind": item.kind,
        "url": item.url,
        "body": item.body,
        "visibility": item.visibility,
        "shared": shared_users,
        "mine": user.id in {item.created_by, (owner.id if owner else -1)},
        "comments": len(item.comments),
        "created_at": _iso(item.created_at),
        "updated_at": _iso(item.updated_at),
    }
    if item.file_stored:
        out["file"] = {
            "name": item.file_name,
            "kind": item.file_kind,
            "size": item.file_size,
            "url": f"/api/archive/files/{item.id}",
        }
    return out


def _folder_out(db: Session, folder: ArchiveFolder, user: User) -> dict:
    visible = [i for i in folder.items if _can_view(i, user)]
    owner = db.get(User, folder.owner_id)
    out = {
        "id": folder.id,
        "name": folder.name,
        "tag": folder.tag,
        "owner": user_brief(owner),
        "mine": folder.owner_id == user.id,
        "item_count": len(visible),
        "created_at": _iso(folder.created_at),
        "updated_at": _iso(folder.updated_at),
    }
    if folder.owner_id == user.id:
        out["private_count"] = sum(1 for i in folder.items if i.visibility == "private")
    return out


def _touch(folder: ArchiveFolder) -> None:
    folder.updated_at = utcnow()


def _store_upload(file: UploadFile) -> tuple[str, str, int, str]:
    """Returns (stored_name, kind, size, original_name). Caller must await file.read()? No —
    UploadFile bytes are read here synchronously via .file; upload endpoint is async."""
    ext = ((file.filename or "").rsplit(".", 1)[-1] if "." in (file.filename or "") else "").lower()
    if ext not in ARCHIVE_EXT_KIND:
        raise HTTPException(status_code=422,
            detail="File type not allowed — images, video, audio, PDF, docs, text or zip")
    return secrets.token_hex(12) + "." + ext, ARCHIVE_EXT_KIND[ext], 0, file.filename or "file"


def _unlink(stored: str) -> None:
    if stored:
        try:
            (ARCHIVE_DIR / stored).unlink(missing_ok=True)
        except OSError:
            pass


# --------------------------------------------------------------------------- members (share picker)
@router.get("/members")
def archive_members(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    members = db.scalars(
        select(User).where(User.active.is_(True)).order_by(User.ign, User.name)
    ).all()
    return [user_brief(m) for m in members]


# --------------------------------------------------------------------------- folders (lockers)
@router.get("/folders")
def list_folders(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    folders = db.scalars(select(ArchiveFolder).order_by(ArchiveFolder.created_at)).all()
    out = [_folder_out(db, f, user) for f in folders]
    out.sort(key=lambda f: (not f["mine"], (f["owner"] or {}).get("ign", "~").lower()))
    mine = next((f["id"] for f in out if f["mine"]), None)
    return {"folders": out, "mine_folder_id": mine}


@router.post("/folders", status_code=201)
def create_folder(payload: ArchiveFolderIn, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    existing = db.scalars(select(ArchiveFolder).where(ArchiveFolder.owner_id == user.id)).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="You already have a locker — one per player")
    folder = ArchiveFolder(owner_id=user.id, name=payload.name.strip(),
                           tag=payload.tag.strip()[:60])
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return _folder_out(db, folder, user)


@router.patch("/folders/{folder_id}")
def update_folder(folder_id: int, payload: ArchiveFolderPatch, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    folder = _get_folder(db, folder_id)
    if folder.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Only the owner can edit this locker")
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        if value is not None:
            setattr(folder, key, str(value).strip())
    _touch(folder)
    db.commit()
    db.refresh(folder)
    return _folder_out(db, folder, user)


@router.delete("/folders/{folder_id}", status_code=204)
def delete_folder(folder_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    folder = _get_folder(db, folder_id)
    if folder.owner_id != user.id and user.role != ROLE_ADMIN:
        raise HTTPException(status_code=403, detail="Only the owner (or an admin) can delete this locker")
    for item in folder.items:
        _unlink(item.file_stored)
    db.delete(folder)
    db.commit()
    return None


@router.get("/folders/{folder_id}")
def folder_detail(folder_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    folder = _get_folder(db, folder_id)
    items = []
    for item in folder.items:  # newest first (relationship order)
        row = _item_out(db, item, user)
        if row is not None:
            items.append(row)
    out = _folder_out(db, folder, user)
    out["items"] = items
    return out


# --------------------------------------------------------------------------- items
@router.post("/folders/{folder_id}/items", status_code=201)
async def create_item(
    folder_id: int,
    title: str = Form(...),
    kind: str = Form("note"),
    url: str = Form(""),
    body: str = Form(""),
    visibility: str = Form("public"),
    shared: str = Form("[]"),
    file: UploadFile | None = Form(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    folder = _get_folder(db, folder_id)
    if folder.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Only the owner can add drops to this locker")
    kind = kind.lower().strip()
    if kind not in ITEM_KINDS:
        raise HTTPException(status_code=422, detail="Item kind must be note, link, video or file")
    title = title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Title is required")
    if kind in {"link", "video"} and not url.strip():
        raise HTTPException(status_code=422, detail="A URL is required for links and videos")
    if visibility not in {"public", "private"}:
        raise HTTPException(status_code=422, detail="Visibility must be public or private")

    try:
        shared_ids = [int(x) for x in json.loads(shared)]
    except (ValueError, TypeError):
        shared_ids = []

    item = ArchiveItem(
        folder_id=folder.id, title=title, kind=kind, url=url.strip(), body=body,
        visibility=visibility, shared=dumps(shared_ids) if visibility == "private" else "[]",
        created_by=user.id,
    )
    if kind == "file":
        if file is None or not (file.filename or ""):
            raise HTTPException(status_code=422, detail="Pick a file to upload")
        stored, fkind, _, orig = _store_upload(file)
        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=422, detail="Empty file")
        if len(raw) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="File too large (max 60 MB)")
        (ARCHIVE_DIR / stored).write_bytes(raw)
        item.file_stored = stored
        item.file_kind = fkind
        item.file_name = orig
        item.file_size = len(raw)
    db.add(item)
    _touch(folder)
    db.commit()
    db.refresh(item)
    return _item_out(db, item, user)


@router.patch("/items/{item_id}")
def update_item(item_id: int, payload: ArchiveItemPatch, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    item = _get_item(db, item_id)
    folder = item.folder
    if folder.owner_id != user.id and item.created_by != user.id:
        raise HTTPException(status_code=403, detail="Only the owner can edit this drop")
    data = payload.model_dump(exclude_unset=True)
    if "title" in data and data["title"]:
        item.title = data["title"].strip()
    if "url" in data and data["url"] is not None:
        item.url = data["url"].strip()
    if "body" in data and data["body"] is not None:
        item.body = data["body"]
    if "visibility" in data and data["visibility"]:
        item.visibility = data["visibility"]
    if "shared" in data and data["shared"] is not None:
        item.shared = dumps([int(x) for x in data["shared"]]) if item.visibility == "private" else "[]"
    if item.visibility != "private":
        item.shared = "[]"
    item.updated_at = utcnow()
    _touch(folder)
    db.commit()
    db.refresh(item)
    return _item_out(db, item, user)


@router.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = _get_item(db, item_id)
    folder = item.folder
    if folder.owner_id != user.id and item.created_by != user.id and user.role != ROLE_ADMIN:
        raise HTTPException(status_code=403, detail="Only the owner (or an admin) can delete this drop")
    _unlink(item.file_stored)
    db.delete(item)
    _touch(folder)
    db.commit()
    return None


@router.get("/files/{item_id}")
def archive_file(item_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Permission-checked file serve — private files are unreachable otherwise."""
    item = _get_item(db, item_id)
    if not _can_view(item, user):
        raise HTTPException(status_code=404, detail="Not found")
    if not item.file_stored:
        raise HTTPException(status_code=404, detail="Not found")
    p = ARCHIVE_DIR / item.file_stored
    if not p.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    disp = "inline" if item.file_kind in {"image", "video", "pdf", "audio"} else "attachment"
    safe_name = (item.file_name or "file").replace('"', "")
    return FileResponse(p, headers={
        "Content-Disposition": f'{disp}; filename="{safe_name}"',
        "Cache-Control": "private, max-age=900",
    })


# --------------------------------------------------------------------------- comments
def _comment_out(db: Session, comment: ArchiveComment) -> dict:
    author = db.get(User, comment.user_id)
    return {
        "id": comment.id,
        "item_id": comment.item_id,
        "author": user_brief(author),
        "body": comment.body,
        "created_at": _iso(comment.created_at),
    }


@router.get("/items/{item_id}/comments")
def list_comments(item_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = _get_item(db, item_id)
    if not _can_view(item, user):
        raise HTTPException(status_code=404, detail="Not found")
    return [_comment_out(db, c) for c in item.comments]


@router.post("/items/{item_id}/comments", status_code=201)
def add_comment(item_id: int, payload: ArchiveCommentIn, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    item = _get_item(db, item_id)
    if not _can_view(item, user):
        raise HTTPException(status_code=404, detail="Not found")
    comment = ArchiveComment(item_id=item.id, user_id=user.id, body=payload.body.strip())
    db.add(comment)
    _touch(item.folder)
    db.commit()
    db.refresh(comment)
    return _comment_out(db, comment)


@router.delete("/comments/{comment_id}", status_code=204)
def delete_comment(comment_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    comment = db.get(ArchiveComment, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    if (comment.user_id != user.id and comment.item.folder.owner_id != user.id
            and user.role != ROLE_ADMIN):
        raise HTTPException(status_code=403, detail="Not your comment")
    db.delete(comment)
    db.commit()
    return None
