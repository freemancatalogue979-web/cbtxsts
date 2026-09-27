"""AI Tutor v2 migration tool.

    cd backend
    ./.venv/bin/python scripts/migrate_ai.py backup
    ./.venv/bin/python scripts/migrate_ai.py upgrade      # takes a backup first
    ./.venv/bin/python scripts/migrate_ai.py verify
    ./.venv/bin/python scripts/migrate_ai.py downgrade    # takes a backup first

Stop the API before upgrade/downgrade. The API also upgrades itself on start.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import ai_migrations as m  # noqa: E402


def main() -> None:
    action = sys.argv[1] if len(sys.argv) > 1 else "verify"
    if action == "backup":
        result = {"backup": m.backup()}
    elif action == "upgrade":
        result = {"backup": m.backup("pre-upgrade"), **m.upgrade()}
    elif action == "downgrade":
        if "--yes" not in sys.argv and sys.stdin.isatty():
            if input("Drop the AI Tutor v2 tables (a backup is taken first)? [y/N] ").strip().lower() != "y":
                raise SystemExit("cancelled")
        result = m.downgrade()
    elif action == "verify":
        result = m.verify()
    else:
        raise SystemExit(__doc__)
    print(json.dumps(result, indent=2, default=str))
    if action == "verify" and not result["ok"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
