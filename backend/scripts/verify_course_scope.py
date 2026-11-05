"""Safe regression checks for the English/Mathematics-only course catalogue.

The local checks exercise the request schema without touching a database. Pass
``--api`` to also check the live catalogue and prove unsupported create/update
requests are rejected before they can persist anything.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.course_catalog import ACTIVE_COURSE_CODES  # noqa: E402
from app.schemas import CourseIn  # noqa: E402

PASS = 0
FAIL = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}{(' — ' + detail[:180]) if detail else ''}")


def request(base: str, method: str, path: str, body: dict | None = None, token: str | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base.rstrip("/") + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            return error.code, json.loads(raw or b"null")
        except ValueError:
            return error.code, {"detail": raw.decode(errors="replace")[:240]}


def schema_checks() -> None:
    print("== schema scope ==")
    check("the supported catalog contains only English and Mathematics", ACTIVE_COURSE_CODES == {"ENG 101", "MTH 101"}, sorted(ACTIVE_COURSE_CODES))
    for submitted, expected in (("eng 101", "ENG 101"), ("  mth   101  ", "MTH 101")):
        try:
            actual = CourseIn(code=submitted, title="Supported course").code
        except Exception as exc:  # noqa: BLE001
            check(f"normalize {submitted!r}", False, str(exc))
        else:
            check(f"normalize {submitted!r}", actual == expected, actual)
    for code in ("LAW 101", "PHY 101", "BIO 101", "CS 101"):
        try:
            CourseIn(code=code, title="Unsupported course", is_active=False)
        except Exception:
            check(f"reject unsupported {code}", True)
        else:
            check(f"reject unsupported {code}", False, "schema accepted an unsupported course")


def api_checks(base: str) -> None:
    print("== read-only API scope ==")
    email = os.environ.get("ARENA_ADMIN_EMAIL", "admin@quizarena.ng")
    password = os.environ.get("ARENA_ADMIN_PASSWORD", "arena2026")
    status, auth = request(base, "POST", "/auth/admin", {"email": email, "password": password})
    check("admin login", status == 200, str(auth))
    if status != 200:
        return
    token = auth["token"]

    status, admin_courses = request(base, "GET", "/admin/courses", token=token)
    admin_codes = {row.get("code") for row in admin_courses} if isinstance(admin_courses, list) else set()
    check("admin course choices are limited to the supported subjects", status == 200 and bool(admin_codes) and admin_codes <= ACTIVE_COURSE_CODES, str(sorted(admin_codes)))

    status, player_courses = request(base, "GET", "/courses")
    player_codes = {row.get("code") for row in player_courses} if isinstance(player_courses, list) else set()
    check("player catalog exposes no unsupported course", status == 200 and bool(player_codes) and player_codes <= ACTIVE_COURSE_CODES, str(sorted(player_codes)))

    for code in ("LAW 101", "PHY 101", "BIO 101", "CS 101"):
        status, result = request(base, "POST", "/admin/courses", {"code": code, "title": "Rejected course", "is_active": False}, token=token)
        check(f"API rejects create for {code}", status == 422, str(result))

    current = next((row for row in admin_courses if row.get("code") in ACTIVE_COURSE_CODES), None) if isinstance(admin_courses, list) else None
    if current:
        payload = {
            "code": "LAW 101",
            "title": current.get("title", "Course"),
            "description": current.get("description", ""),
            "credit_units": current.get("credit_units", 3),
            "semester": current.get("semester", "First Semester"),
            "lecturer": current.get("lecturer", ""),
            "accent": current.get("accent", "violet"),
            "is_active": current.get("is_active", True),
        }
        status, result = request(base, "PATCH", f"/admin/courses/{current['id']}", payload, token)
        check("API rejects changing a supported course into Law", status == 422, str(result))
    else:
        check("API rejects changing a supported course into Law", False, "no supported course returned")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", action="store_true", help="also run safe GET/rejected-write checks against ARENA_API")
    args = parser.parse_args()
    schema_checks()
    if args.api:
        api_checks(os.environ.get("ARENA_API", "http://127.0.0.1:3000/api"))
    print(f"\n{PASS} passed, {FAIL} failed")
    raise SystemExit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
