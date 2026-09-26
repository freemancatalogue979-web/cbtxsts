"""A player's own notes on a material (the reader's "My notes" tab).

* create a note (title + body, optionally tied to a section) while reading;
* list, open and edit it; edits change updated_at and keep what was not sent;
* delete it — and undo each step the way the client does (inverse calls);
* notes are private: another player can neither see, open, edit nor delete them;
* empty notes are refused; the reader payload carries the notes too.

    cd backend && .venv/bin/python scripts/verify_player_notes.py
"""
from __future__ import annotations

import json
import os
import sys
import time
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


def call(method: str, path: str, body: dict | None = None, token: str | None = None):
    headers = {"Content-Type": "application/json"} if body is not None else {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            return error.code, json.loads(raw or b"null")
        except json.JSONDecodeError:
            return error.code, raw.decode(errors="replace")


def player(tag: str) -> str:
    status, reg = call("POST", "/auth/register", {"username": f"{tag}{uuid.uuid4().hex[:6]}", "password": "secret123", "phone": f"080{uuid.uuid4().int % 10**8:08d}", "full_name": "Notes Tester"})
    assert status in (200, 201), reg
    return reg["token"]


def main() -> int:
    status, auth = call("POST", "/auth/admin", {"email": "admin@quizarena.ng", "password": "arena2026"})
    admin = auth.get("token") or auth.get("access_token")
    status, courses = call("GET", "/admin/courses", token=admin)
    courses = courses if isinstance(courses, list) else courses.get("courses", [])
    status, material = call(
        "POST",
        "/admin/materials",
        {
            "title": f"Player notes test {uuid.uuid4().hex[:4]}",
            "course_id": courses[0]["id"],
            "status": "published",
            "sections": [
                {"title": "One", "estimated_minutes": 2, "check_enabled": False, "blocks": [{"type": "paragraph", "text": "First section text."}]},
                {"title": "Two", "estimated_minutes": 2, "check_enabled": False, "blocks": [{"type": "paragraph", "text": "Second section text."}]},
            ],
        },
        admin,
    )
    check("material created", status in (200, 201), material)
    mid = material["id"]
    section_two = material["sections"][1]["id"]
    ada, ben = player("ada"), player("ben")

    # create
    status, note = call("POST", f"/materials/{mid}/notes", {"title": "What I learned", "body": "Osmosis moves water.\nIt needs a membrane.", "section_id": section_two}, ada)
    check("create returns the note", status == 200 and note.get("title") == "What I learned" and note.get("section_id") == section_two, note)
    check("create stamps created_at and updated_at", bool(note.get("created_at")) and bool(note.get("updated_at")), note)
    nid = note["id"]
    status, _ = call("POST", f"/materials/{mid}/notes", {"title": "", "body": "   "}, ada)
    check("an empty note is refused", status == 422, status)
    status, untitled = call("POST", f"/materials/{mid}/notes", {"body": "A quick thought"}, ada)
    check("a title is optional", status == 200 and untitled.get("title") == "", untitled)

    # list / open
    status, listed = call("GET", f"/materials/{mid}/notes", token=ada)
    ids = [row["id"] for row in listed.get("notes", [])]
    check("list shows my notes, newest first", status == 200 and ids == [untitled["id"], nid], ids)
    status, opened = call("GET", f"/materials/{mid}/notes/{nid}", token=ada)
    check("open one note", status == 200 and opened.get("body", "").startswith("Osmosis"), opened)
    status, read = call("GET", f"/materials/{mid}", token=ada)
    check("reader payload carries my notes with titles", status == 200 and any(row.get("title") == "What I learned" for row in read.get("notes", [])), read.get("notes"))

    # edit (+ undo edit)
    before = dict(opened)
    time.sleep(1.1)
    status, edited = call("PATCH", f"/materials/{mid}/notes/{nid}", {"body": "Osmosis: water moves to the saltier side."}, ada)
    check("edit changes the body", status == 200 and edited.get("body", "").startswith("Osmosis: water"), edited)
    check("edit keeps the title it was not sent", edited.get("title") == "What I learned", edited)
    check("edit keeps the section it was not sent", edited.get("section_id") == section_two, edited)
    check("edit bumps updated_at", edited.get("updated_at") != before.get("updated_at"), (edited.get("updated_at"), before.get("updated_at")))
    status, _ = call("PATCH", f"/materials/{mid}/notes/{nid}", {"body": ""}, ada)
    check("editing to empty is refused", status == 422, status)
    status, _ = call("PATCH", f"/materials/{mid}/notes/{nid}", {"section_id": None}, ada)
    status, cleared = call("GET", f"/materials/{mid}/notes/{nid}", token=ada)
    check("section can be cleared explicitly", cleared.get("section_id") is None, cleared)
    status, undone = call("PATCH", f"/materials/{mid}/notes/{nid}", {"title": before["title"], "body": before["body"], "section_id": before["section_id"]}, ada)
    check("undo edit restores the earlier text", status == 200 and undone.get("body") == before["body"] and undone.get("section_id") == section_two, undone)

    # privacy
    status, other = call("GET", f"/materials/{mid}/notes", token=ben)
    check("another player sees none of my notes", status == 200 and other.get("notes") == [], other)
    check("another player cannot open my note", call("GET", f"/materials/{mid}/notes/{nid}", token=ben)[0] == 404)
    check("another player cannot edit my note", call("PATCH", f"/materials/{mid}/notes/{nid}", {"body": "hacked"}, ben)[0] == 404)
    check("another player cannot delete my note", call("DELETE", f"/materials/{mid}/notes/{nid}", token=ben)[0] == 404)
    check("staff can't use the player note endpoints", call("GET", f"/materials/{mid}/notes", token=admin)[0] in (401, 403))
    check("my note under the wrong material is 404", call("GET", f"/materials/{mid + 99999}/notes/{nid}", token=ada)[0] == 404)

    # delete (+ undo delete = recreate from the copy the client kept)
    status, gone = call("DELETE", f"/materials/{mid}/notes/{nid}", token=ada)
    check("delete works", status == 200 and gone.get("ok"), gone)
    check("deleted note can't be opened", call("GET", f"/materials/{mid}/notes/{nid}", token=ada)[0] == 404)
    status, back = call("POST", f"/materials/{mid}/notes", {"title": undone["title"], "body": undone["body"], "section_id": undone["section_id"], "quote": undone.get("quote", "")}, ada)
    check("undo delete brings it back with the same content", status == 200 and back.get("body") == undone["body"] and back.get("title") == "What I learned", back)

    # undo create
    status, _ = call("DELETE", f"/materials/{mid}/notes/{untitled['id']}", token=ada)
    status, listed = call("GET", f"/materials/{mid}/notes", token=ada)
    check("undo create removes the new note", [row["id"] for row in listed["notes"]] == [back["id"]], listed)

    call("DELETE", f"/admin/materials/{mid}", token=admin)
    print(f"\nverify_player_notes: {PASSED} passed, {FAILED} failed")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
