"""Background document imports for materials.

Flow (all requests return in well under a second):

    POST /import/uploads          file → saved to disk, read in a worker   → {id, state: "reading"}
    GET  /import/uploads/{id}     poll                                     → reading | ready (+preview) | error
    POST /import/uploads/{id}/commit   course/title/…  → material created in a worker → importing → done (+material)

Jobs are mirrored to small JSON state files. On restart, reading/importing
work is resumed from the saved upload while ready jobs remain available for
staff to commit. State writes are atomic, so a process crash cannot leave a
half-written job record.
"""

from __future__ import annotations

import json
import logging
import os
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


def _state_path(job_id: str) -> Path:
    return _dir() / f"{job_id}.json"


def _persist(job: dict[str, Any]) -> None:
    """Atomically mirror one job; only JSON-compatible import drafts are stored."""
    target = _state_path(str(job["id"]))
    temporary = target.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(job, ensure_ascii=False, default=str), encoding="utf-8")
    os.replace(temporary, target)


def recover() -> dict[str, int]:
    """Reload persisted jobs and resume work interrupted by a process restart."""
    resumed = ready = failed = 0
    with _lock:
        _jobs.clear()
        for path in _dir().glob("*.json"):
            try:
                job = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(job, dict) or not job.get("id"):
                    raise ValueError("invalid job")
                _jobs[str(job["id"])] = job
            except Exception:  # noqa: BLE001
                failed += 1
                path.unlink(missing_ok=True)
    for job_id, job in list(_jobs.items()):
        state = str(job.get("state") or "error")
        if state == "reading":
            _pool.submit(_read, job_id); resumed += 1
        elif state == "importing" and job.get("commit_fields"):
            _pool.submit(_create, job_id, dict(job["commit_fields"])); resumed += 1
        elif state in {"ready", "done"}:
            ready += 1
        else:
            _set(job_id, state="error", error=job.get("error") or "This import was interrupted. Upload it again.")
    _sweep()
    return {"loaded": len(_jobs), "resumed": resumed, "ready": ready, "invalid": failed}


def _sweep() -> None:
    cutoff = time.time() - KEEP_SECONDS
    with _lock:
        old = [key for key, job in _jobs.items() if job["updated"] < cutoff and job["state"] not in {"reading", "importing"}]
        for key in old:
            _jobs.pop(key, None)
    for key in old:
        (_dir() / key).unlink(missing_ok=True)
        _state_path(key).unlink(missing_ok=True)


def _set(job_id: str, **changes: Any) -> None:
    snapshot = None
    with _lock:
        job = _jobs.get(job_id)
        if job is not None:
            job.update(changes, updated=time.time())
            snapshot = dict(job)
    if snapshot is not None:
        _persist(snapshot)


def _message(error: Exception) -> str:
    detail = getattr(error, "detail", None) or getattr(error, "message", None)
    return str(detail or "That file could not be read.")[:400]


def _save_message(error: Exception) -> str:
    """Staff-facing reason a save failed (never the misleading "could not be read")."""
    detail = getattr(error, "detail", None) or getattr(error, "message", None)
    if detail:
        return str(detail)[:400]
    errors = getattr(error, "errors", None)
    if callable(errors):  # pydantic ValidationError → first problem, in plain words
        try:
            first = errors()[0]
            where = " → ".join(str(p) for p in first.get("loc", ()) if not isinstance(p, int)) or "the document"
            return f"Couldn't save this material ({where}: {first.get('msg', 'invalid value')}). Edit the title or try again; if it keeps failing, save the file as PDF or Word and re-upload."[:400]
        except Exception:  # noqa: BLE001
            pass
    return f"Couldn't save this material ({type(error).__name__}). Please try again — the file is kept, no need to re-upload."[:400]


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
        _set(job_id, state="ready", error=_save_message(error))


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
                         "draft": None, "material": None, "commit_fields": None, "created": now, "updated": now}
        snapshot = dict(_jobs[job_id])
    _persist(snapshot)
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
        job.update(state="importing", error="", commit_fields=fields, updated=time.time())
        snapshot = dict(job)
    _persist(snapshot)
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


def stats() -> dict[str, int]:
    """Small, non-sensitive worker snapshot for health checks and monitoring."""
    with _lock:
        counts: dict[str, int] = {"total": len(_jobs), "reading": 0, "ready": 0, "importing": 0, "done": 0, "error": 0}
        for job in _jobs.values():
            state = str(job.get("state") or "error")
            counts[state] = counts.get(state, 0) + 1
    counts["active"] = counts.get("reading", 0) + counts.get("importing", 0)
    return counts


def shutdown() -> None:
    """Stop accepting import work during a graceful API shutdown."""
    _pool.shutdown(wait=False, cancel_futures=True)
