"""Background document imports for materials.

Flow (all requests return in well under a second):

    POST /import/uploads          file → saved to disk, read in a worker   → {id, state: "reading"}
    GET  /import/uploads/{id}     poll                                     → reading | ready (+preview) | error
    POST /import/uploads/{id}/commit   course/title/…  → material created in a worker → importing → done (+material)

Jobs live in memory (a restart loses unfinished ones — the app then asks to
upload again) and are swept after a few hours together with their files.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from .. import config

log = logging.getLogger("arena.import")

MAX_BYTES = 40 * 1024 * 1024
KEEP_SECONDS = 3 * 3600
WORKERS = 2

_jobs: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()
_pool = ThreadPoolExecutor(max_workers=WORKERS, thread_name_prefix="import")


class JobError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


def _dir() -> Path:
    base = Path(getattr(config, "DATA_DIR", Path(__file__).resolve().parents[2] / "data")) / "import-jobs"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _sweep() -> None:
    cutoff = time.time() - KEEP_SECONDS
    with _lock:
        old = [key for key, job in _jobs.items() if job["updated"] < cutoff and job["state"] not in {"reading", "importing"}]
        for key in old:
            _jobs.pop(key, None)
    for key in old:
        (_dir() / key).unlink(missing_ok=True)


def _set(job_id: str, **changes: Any) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job is not None:
            job.update(changes, updated=time.time())


def _message(error: Exception) -> str:
    detail = getattr(error, "detail", None) or getattr(error, "message", None)
    return str(detail or "That file could not be read.")[:400]


def _read(job_id: str) -> None:
    from ..services.material_import import DocumentError, read_document

    job = _jobs.get(job_id)
    if job is None:
        return
    started = time.monotonic()
    try:
        data = (_dir() / job_id).read_bytes()
        draft = read_document(job["filename"], data)
        _set(job_id, state="ready", draft=draft, seconds=round(time.monotonic() - started, 2))
    except DocumentError as error:
        _set(job_id, state="error", error=error.message)
    except Exception as error:  # noqa: BLE001 — never leave a job stuck on "reading"
        log.exception("import read failed (%s)", job.get("filename"))
        _set(job_id, state="error", error=_message(error))
    if _jobs.get(job_id, {}).get("state") == "error":
        (_dir() / job_id).unlink(missing_ok=True)  # unreadable — nothing to keep


def _create(job_id: str, fields: dict) -> None:
    from ..db import session_scope
    from ..models import Admin
    from ..routers.materials import _import_draft

    job = _jobs.get(job_id)
    if job is None:
        return
    try:
        data = (_dir() / job_id).read_bytes()
        with session_scope() as db:
            admin = db.get(Admin, job["owner"])
            if admin is None:
                raise JobError("Your staff account was not found.", 403)
            created = _import_draft(db, admin, filename=job["filename"], data=data, draft=job["draft"], **fields)
        _set(job_id, state="done", material=created)
        (_dir() / job_id).unlink(missing_ok=True)
    except Exception as error:  # noqa: BLE001
        if not isinstance(error, JobError) and not hasattr(error, "detail"):
            log.exception("import create failed (%s)", job.get("filename"))
        # back to "ready" so staff can fix the problem (e.g. pick a course) and retry without re-uploading
        _set(job_id, state="ready", error=_message(error))


def start(filename: str, data: bytes, *, owner: int) -> dict:
    _sweep()
    if not data:
        raise JobError("That file is empty.", 400)
    if len(data) > MAX_BYTES:
        raise JobError(f"That file is too big (max {MAX_BYTES // (1024 * 1024)} MB). Split it or save a smaller PDF.", 413)
    job_id = uuid.uuid4().hex
    (_dir() / job_id).write_bytes(data)
    now = time.time()
    with _lock:
        _jobs[job_id] = {"id": job_id, "owner": owner, "filename": filename[:200], "size": len(data), "state": "reading", "error": "",
                         "draft": None, "material": None, "created": now, "updated": now}
    _pool.submit(_read, job_id)
    return public(_jobs[job_id])


def get(job_id: str, *, owner: int) -> dict:
    job = _jobs.get(job_id)
    if job is None or job["owner"] != owner:
        raise JobError("This upload has expired. Add the file again.", 404)
    return job


def commit(job_id: str, *, owner: int, fields: dict) -> dict:
    job = get(job_id, owner=owner)
    with _lock:
        if job["state"] == "done":
            return job
        if job["state"] != "ready":
            raise JobError("This file isn't ready yet." if job["state"] in {"reading", "importing"} else job["error"] or "This file can't be imported.", 409)
        job.update(state="importing", error="", updated=time.time())
    _pool.submit(_create, job_id, fields)
    return job


def public(job: dict) -> dict:
    out: dict[str, Any] = {"id": job["id"], "state": job["state"], "filename": job["filename"], "size": job["size"], "error": job["error"] or None}
    if job.get("draft") is not None and job["state"] in {"ready", "importing"}:
        from ..routers.materials import _preview_payload

        out["preview"] = _preview_payload(job["draft"])
    if job["state"] == "done":
        out["material"] = job["material"]
    return out
