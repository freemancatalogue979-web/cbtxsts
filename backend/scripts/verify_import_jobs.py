"""Background material imports: upload once, poll, commit — no long requests.

    cd backend && PYTHONPATH=. .venv/bin/python scripts/verify_import_jobs.py [path/to/file.pdf]
"""
from __future__ import annotations

import json
import os
import socket
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="agimp-"))
os.environ["CBT_DATABASE_URL"] = f"sqlite:///{TMP / 'imp.db'}"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import uvicorn  # noqa: E402

from app.main import app  # noqa: E402

PASSED = FAILED = 0


def check(name, ok, detail=None):
    global PASSED, FAILED
    PASSED, FAILED = (PASSED + 1, FAILED) if ok else (PASSED, FAILED + 1)
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f" — {str(detail)[:300]}"))


def main():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.1)
    base = f"http://127.0.0.1:{port}/api"

    def call(method, path, body=None, token=None, raw=None, ctype="application/json"):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(base + path, data=data, method=method, headers={"Content-Type": ctype, **({"Authorization": f"Bearer {token}"} if token else {})})
        t = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                code, text = r.status, r.read().decode()
        except urllib.error.HTTPError as e:
            code, text = e.code, e.read().decode()
        ms = (time.monotonic() - t) * 1000
        try:
            return code, json.loads(text), ms
        except ValueError:
            return code, text, ms

    def upload(token, name, data):
        b = uuid.uuid4().hex
        body = f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode() + data + f"\r\n--{b}--\r\n".encode()
        return call("POST", "/admin/materials/import/uploads", raw=body, token=token, ctype=f"multipart/form-data; boundary={b}")

    def wait(token, job_id, states):
        for _ in range(600):
            code, job, _ = call("GET", f"/admin/materials/import/uploads/{job_id}", token=token)
            if code != 200 or job["state"] in states:
                return code, job
            time.sleep(0.2)
        return 0, {}

    try:
        _, admin, _ = call("POST", "/auth/admin", {"email": "admin@quizarena.ng", "password": "arena2026"})
        staff = admin["token"]
        _, courses, _ = call("GET", "/admin/courses", token=staff)
        course_id = courses[0]["id"]
        path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/big.pdf"
        data = Path(path).read_bytes() if Path(path).exists() else ("CHAPTER ONE\n\n" + "Negligence needs a duty of care. " * 4000).encode()
        name = Path(path).name if Path(path).exists() else "big.txt"

        print("upload returns at once, reading happens in the background")
        code, job, ms = upload(staff, name, data)
        check("upload accepted (202) with a job id", code == 202 and job.get("id") and job["state"] in {"reading", "ready"}, (code, job))
        check(f"upload request is quick ({ms:.0f} ms)", ms < 5000, ms)
        code, _, hms = call("GET", "/health")
        check(f"server stays responsive while reading ({hms:.0f} ms)", code == 200 and hms < 1500, hms)
        code, job = wait(staff, job["id"], {"ready", "error"})
        check("document read → preview", job.get("state") == "ready" and job["preview"]["sections"], job.get("error"))
        check("other people can't see the job", call("GET", f"/admin/materials/import/uploads/{job['id']}")[0] in (401, 403))
        check("commit without a course is refused", call("POST", f"/admin/materials/import/uploads/{job['id']}/commit", {}, staff)[0] == 422)

        print("commit creates the material in the background (no second upload)")
        code, c, ms = call("POST", f"/admin/materials/import/uploads/{job['id']}/commit", {"course_id": course_id, "title": "Big torts pack", "status": "draft"}, staff)
        check(f"commit accepted quickly ({ms:.0f} ms)", code == 202 and c["state"] in {"importing", "done"} and ms < 5000, (code, c))
        code, job = wait(staff, job["id"], {"done", "ready", "error"})
        mat = job.get("material") or {}
        check("material created", job.get("state") == "done" and mat.get("id") and mat.get("title") == "Big torts pack", job.get("error") or job.get("state"))
        code, detail, _ = call("GET", f"/admin/materials/{mat.get('id')}", token=staff)
        check("material has the document's sections", code == 200 and len(detail.get("sections") or []) >= 1, code)
        check("committing twice doesn't duplicate", call("POST", f"/admin/materials/import/uploads/{job['id']}/commit", {"course_id": course_id}, staff)[1].get("state") == "done")

        print("bad files fail cleanly")
        code, bad, _ = upload(staff, "photo.pdf", b"%PDF-1.4 not really a pdf")
        code, bad = wait(staff, bad["id"], {"ready", "error"})
        check("broken PDF → friendly error, not a hang", bad.get("state") == "error" and bad.get("error"), bad)
        check("empty file refused", upload(staff, "empty.txt", b"")[0] == 400)
        check("expired / unknown job → 404", call("GET", "/admin/materials/import/uploads/nope", token=staff)[0] == 404)

        print("old one-shot endpoints still work")
        b = uuid.uuid4().hex
        small = ("TOPIC\n\nA short note about nuisance. " * 20).encode()
        body = f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="n.txt"\r\n\r\n'.encode() + small + f"\r\n--{b}--\r\n".encode()
        check("preview endpoint", call("POST", "/admin/materials/import/preview", raw=body, token=staff, ctype=f"multipart/form-data; boundary={b}")[0] == 200)
    finally:
        server.should_exit = True
    print(f"\n{PASSED} passed, {FAILED} failed")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
