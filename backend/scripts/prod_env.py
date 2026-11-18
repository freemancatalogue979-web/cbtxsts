"""Get backend/.env ready for production (run by start-arena.bat before the server starts).

* Makes sure CLOVER_SECRET_KEY is set to a real random value (it signs every login).
  An old CBT_SECRET_KEY from earlier setup scripts is reused so nobody is signed out.
* A brand-new database gets a random first admin password instead of the public
  default, printed once here and saved in backend/.env.
* For an existing database, warns if an admin account still uses the default password.

Safe to run every time: once everything is set it changes nothing.
"""
from __future__ import annotations

import os
import secrets
import sqlite3
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
DEFAULT_PASSWORD = "clover2026"


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if path.is_file():
        for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                key = key.strip().removeprefix("export ").strip()
                value = value.strip().strip('"').strip("'")
                if value and key not in values:  # same rule as app/config.py: first non-empty wins
                    values[key] = value
    return values


def set_value(path: Path, key: str, value: str) -> None:
    """Replace an empty or default ``KEY=`` line in place, otherwise append."""
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines() if path.is_file() else []
    for i, raw in enumerate(lines):
        if raw.strip().removeprefix("export ").split("=", 1)[0].strip() == key:
            lines[i] = f"{key}={value}"
            break
    else:
        lines.append(f"{key}={value}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def current(key: str, file_values: dict[str, str]) -> str:
    return os.environ.get(key, "").strip() or file_values.get(key, "")


def sqlite_path(file_values: dict[str, str]) -> Path | None:
    url = current("CLOVER_DATABASE_URL", file_values)
    if not url:
        return BACKEND / "data" / "clover.db"
    if url.startswith("sqlite:///"):
        return Path(url.removeprefix("sqlite:///"))
    return None  # another database server: can't tell whether it's new


def admins_on_default(db: Path) -> list[str]:
    sys.path.insert(0, str(BACKEND))
    from app.security import verify_password  # imported late: reads the .env written above

    with sqlite3.connect(db) as conn:
        rows = conn.execute("SELECT email, password_hash FROM users WHERE role = 'admin' AND active = 1").fetchall()
    return [email.split("@")[0] for email, stored in rows if stored and verify_password(DEFAULT_PASSWORD, stored)]


def main(env_path: Path = BACKEND / ".env") -> int:
    values = read_env(env_path)
    notes: list[str] = []

    if not current("CLOVER_SECRET_KEY", values):
        set_value(env_path, "CLOVER_SECRET_KEY", values.get("CBT_SECRET_KEY") or secrets.token_urlsafe(48))
        notes.append("[+] Created a private CLOVER_SECRET_KEY in backend\\.env (keep this file private).")

    db = sqlite_path(values)
    password = current("CLOVER_ADMIN_PASSWORD", values)
    if db is not None and not db.exists():
        if not password or password == DEFAULT_PASSWORD:
            password = secrets.token_urlsafe(12)
            set_value(env_path, "CLOVER_ADMIN_PASSWORD", password)
        notes.append(f"[!] New database. First login:  admin / {password}   (also saved in backend\\.env - change it in the app)")
    elif db is not None:
        try:
            weak = admins_on_default(db)
        except Exception:  # noqa: BLE001 - a warning only; never block startup
            weak = []
        if weak:
            notes.append(f"[!] {', '.join(weak)} still use(s) the default password {DEFAULT_PASSWORD!r}. "
                         "Change it in the app before sharing the link.")

    print("\n".join(notes) if notes else "[ok] backend\\.env is ready for production.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
