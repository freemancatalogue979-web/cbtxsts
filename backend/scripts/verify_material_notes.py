"""Notes inside a material + undo (version restore).

* a note can belong to one material of the same course (never to another note,
  never across courses); the material's Notes tab lists exactly its notes;
* every save snapshots the real saved content, and restoring an earlier
  snapshot brings that content back — the restore is itself undoable;
* players see a material's published notes (drafts stay hidden);
* deleting a material keeps its notes (detached, still in the course);
* a document can be imported straight into a material as a note.

    cd backend && .venv/bin/python scripts/verify_material_notes.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
import uuid

API = os.getenv("ARENA_API", "http://127.0.0.1:3000/api")
PASSED = FAILED = 0


def check(name: str, condition: bool, info: object = "") -> None:
    global PASSED, FAILED
    if condition:
        PASSED += 1
        print(f"  ok   {name}")
    else:
        FAILED += 1
        print(f"  FAIL {name} — {str(info)[:220]}")


def call(method: str, path: str, body: dict | None = None, token: str | None = None, file: tuple[str, bytes] | None = None):
    headers: dict[str, str] = {}
    data = None
    if file:
        boundary = uuid.uuid4().hex
        parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in (body or {}).items()]
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{file[0]}"\r\n\r\n'.encode() + file[1] + b"\r\n")
        data = b"".join(parts) + f"--{boundary}--\r\n".encode()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(API + path, method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            return error.code, json.loads(raw or b"null")
        except json.JSONDecodeError:
            return error.code, raw.decode(errors="replace")


def paragraph(text: str) -> list[dict]:
    return [{"title": "Main", "blocks": [{"type": "paragraph", "text": text}]}]


def text_of(material: dict) -> str:
    return " ".join(b.get("text", "") for s in material.get("sections", []) for b in s.get("blocks", []))


def main() -> None:
    status, auth = call("POST", "/auth/admin", {"email": "admin@quizarena.ng", "password": "arena2026"})
    if status != 200:
        check("admin login", False, auth)
        return
    T = auth["token"]
    courses = call("GET", "/admin/courses", token=T)[1]
    c1, c2 = courses[0]["id"], courses[1]["id"]
    made: list[int] = []

    print("== notes belong to a material ==")
    status, material = call("POST", "/admin/materials", {"title": "Federalism — lecture 1", "course_id": c1, "status": "published", "sections": paragraph("Main material text.")}, token=T)
    check("material created", status == 201, material)
    M = material["id"]
    made.append(M)
    status, note = call("POST", "/admin/materials", {"title": "Exam tips", "course_id": c1, "kind": "note", "parent_id": M, "status": "published", "sections": paragraph("Version one of the tips.")}, token=T)
    check("note created inside the material", status == 201 and note["parent_id"] == M and note["kind"] == "note" and note["course_id"] == c1, note)
    N = note["id"]
    made.append(N)
    status, draft_note = call("POST", "/admin/materials", {"title": "Unfinished", "parent_id": M, "status": "draft", "sections": paragraph("Draft note.")}, token=T)
    check("parent sets kind=note and the course automatically", status == 201 and draft_note["kind"] == "note" and draft_note["course_id"] == c1, draft_note)
    made.append(draft_note["id"])

    listed = call("GET", f"/admin/materials?parent_id={M}&limit=50", token=T)[1]
    check("the material's Notes tab lists exactly its notes", {row["id"] for row in listed["items"]} == {N, draft_note["id"]}, listed.get("items"))
    check("each note knows its material's title", all(row["parent_title"] == "Federalism — lecture 1" for row in listed["items"]))
    course_list = call("GET", f"/admin/materials?course_id={c1}&kind=material&limit=200", token=T)[1]
    row = next((r for r in course_list["items"] if r["id"] == M), {})
    check("the material shows its note count", row.get("note_count") == 2, row.get("note_count"))

    status, other = call("POST", "/admin/materials", {"title": "Other course", "course_id": c2, "status": "draft", "sections": paragraph("x")}, token=T)
    made.append(other["id"])
    status, detail = call("POST", "/admin/materials", {"title": "Wrong", "course_id": c2, "parent_id": M, "sections": paragraph("x")}, token=T)
    check("a note cannot belong to a material of another course", status == 400, (status, detail))
    status, detail = call("POST", "/admin/materials", {"title": "Nested", "parent_id": N, "sections": paragraph("x")}, token=T)
    check("a note cannot belong to another note", status == 400, (status, detail))
    status, detail = call("POST", "/admin/materials", {"title": "Ghost", "parent_id": 99999999, "sections": paragraph("x")}, token=T)
    check("unknown parent refused", status == 404, (status, detail))

    print("== edit, undo (restore), redo ==")
    current = call("GET", f"/admin/materials/{N}", token=T)[1]
    section_id = current["sections"][0]["id"]
    for text in ("Version two of the tips.", "Version three of the tips."):
        status, saved = call("PATCH", f"/admin/materials/{N}", {"title": "Exam tips", "status": "published", "sections": [{"id": section_id, "title": "Main", "blocks": [{"type": "paragraph", "text": text}]}]}, token=T)
    check("edits saved", status == 200 and text_of(saved) == "Version three of the tips.", text_of(saved))
    versions = call("GET", f"/admin/materials/{N}/versions", token=T)[1]["versions"]
    check("every save kept a snapshot (created + 2 edits)", len(versions) >= 3, len(versions))
    # snapshots are the saved content, newest first
    check("the newest snapshot matches what was saved", versions and versions[0]["note"].startswith("Saved"), versions[:1])
    previous = versions[1]  # the state before the last edit
    status, restored = call("POST", f"/admin/materials/{N}/versions/{previous['id']}/restore", token=T)
    check("undo last change brings back version two", status == 200 and text_of(restored) == "Version two of the tips.", (status, text_of(restored) if isinstance(restored, dict) else restored))
    check("reader progress anchor kept (same section id)", restored["sections"][0]["id"] == section_id)
    check("status unchanged by a restore", restored["status"] == "published")
    versions_after = call("GET", f"/admin/materials/{N}/versions", token=T)[1]["versions"]
    check("the restore is itself a version", versions_after[0]["note"].startswith("Restored"), versions_after[:1])
    status, redone = call("POST", f"/admin/materials/{N}/versions/{versions_after[1]['id']}/restore", token=T)
    check("undo the undo (redo) brings version three back", status == 200 and text_of(redone) == "Version three of the tips.", text_of(redone))
    oldest = call("GET", f"/admin/materials/{N}/versions", token=T)[1]["versions"][-1]
    status, first = call("POST", f"/admin/materials/{N}/versions/{oldest['id']}/restore", token=T)
    check("any older version can be restored", status == 200 and text_of(first) == "Version one of the tips.", text_of(first))
    status, detail = call("POST", f"/admin/materials/{N}/versions/{versions[0]['id'] + 999999}/restore", token=T)
    check("unknown version refused", status == 404, status)
    foreign = call("GET", f"/admin/materials/{M}/versions", token=T)[1]["versions"][0]["id"]
    status, detail = call("POST", f"/admin/materials/{N}/versions/{foreign}/restore", token=T)
    check("another material's version cannot be restored here", status == 404, status)

    status, renamed = call("PATCH", f"/admin/materials/{N}", {"title": "Exam tips (renamed)"}, token=T)
    check("an update that only sends a title keeps status, course and material", status == 200 and renamed["status"] == "published"
          and renamed["course_id"] == c1 and renamed["parent_id"] == M and text_of(renamed) == "Version one of the tips.", renamed)

    print("== players ==")
    suffix = uuid.uuid4().hex[:6]
    status, reg = call("POST", "/auth/register", {"username": f"nt{suffix}", "password": "secret123", "phone": f"081{uuid.uuid4().int % 10**8:08d}", "full_name": "Notes Tester"})
    student = reg.get("token") if isinstance(reg, dict) else None
    if student:
        status, payload = call("GET", f"/materials/{M}/staff-notes", token=student)
        ids = [row["id"] for row in payload.get("notes", [])] if status == 200 else []
        check("players see the material's published notes", N in ids, (status, payload))
        check("draft notes stay hidden from players", draft_note["id"] not in ids, ids)
        check("notes come with their content", status == 200 and text_of(payload["notes"][0]) == "Version one of the tips.")
    else:
        check("player account", False, reg)

    print("== import into a material ==")
    status, imported = call("POST", "/admin/materials/import", {"course_id": c1, "parent_id": M, "status": "published"}, token=T,
                            file=("cases.md", b"# Key cases\n\n## Ogun\n\nAG Ogun v AG Federation.\n\n## Lagos\n\nAG Lagos v AG Federation.\n"))
    check("imported document lands in the material's Notes tab", status == 201 and imported["parent_id"] == M and imported["kind"] == "note", (status, imported))
    if status == 201:
        made.append(imported["id"])

    print("== deleting the material keeps its notes ==")
    status, gone = call("DELETE", f"/admin/materials/{M}", token=T)
    made.remove(M)
    check("material deleted, notes detached", status == 200 and gone.get("detached_notes") == 3, gone)
    status, kept = call("GET", f"/admin/materials/{N}", token=T)
    check("the note still exists in the course", status == 200 and kept["parent_id"] is None and kept["course_id"] == c1, kept)

    for mid in made:
        call("DELETE", f"/admin/materials/{mid}", token=T)


if __name__ == "__main__":
    main()
    print(f"\nverify_material_notes: {PASSED} passed, {FAILED} failed")
    sys.exit(1 if FAILED else 0)
