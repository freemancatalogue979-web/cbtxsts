"""Wipe demo/mock content for a fresh competitive start.

Deletes everything except user accounts (`users`), the hero database
(`heroes`) and `team_settings`. Run with the API stopped:

    .venv/bin/python scripts/wipe_demo_data.py
"""
from __future__ import annotations

import sys

sys.path.insert(0, ".")
from app.config import DATA_DIR, DATABASE_URL  # noqa: E402

from pathlib import Path  # noqa: E402

DB_PATH = Path(DATABASE_URL.removeprefix("sqlite:///"))

import sqlite3  # noqa: E402

DEMO_TABLES = [
    "development_entries",
    "hero_pool",
    "training_weeks",
    "training_activities",
    "scrims",
    "scrim_games",
    "match_reviews",
    "strategy_notes",
    "map_boards",
    "draft_plans",
    "ban_entries",
    "events",
]
KEPT = ["users", "heroes", "team_settings"]


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    print(f"Database: {DB_PATH}")
    for table in DEMO_TABLES:
        n = cur.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        cur.execute(f"DELETE FROM {table}")
        print(f"  wiped {table}: {n} rows removed")
    conn.commit()
    remaining = {
        t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in KEPT
    }
    conn.close()

    avatars = DATA_DIR / "avatars"
    cleared = 0
    if avatars.is_dir():
        for f in avatars.iterdir():
            if f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"):
                f.unlink()
                cleared += 1
    if cleared:
        print(f"  cleared {cleared} user avatar(s)")
    print(f"Kept: {remaining}")
    print("Fresh start complete.")


if __name__ == "__main__":
    main()
