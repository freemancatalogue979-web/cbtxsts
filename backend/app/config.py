"""Runtime configuration for the 9 CLOVER backend."""
from __future__ import annotations

import os
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
DATA_DIR = BACKEND_ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)


def _load_dotenv(path: Path) -> None:
    """Read ``backend/.env`` (KEY=value lines) without overriding real env vars."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip().removeprefix("export ").strip()
        value = value.strip().strip('"').strip("'")
        if key and value and key not in os.environ:
            os.environ[key] = value


_load_dotenv(BACKEND_ROOT / ".env")

# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------
HOST = os.getenv("CLOVER_HOST", "0.0.0.0")
PORT = int(os.getenv("CLOVER_PORT", "9000"))

EXTRA_CORS_ORIGINS = [o.strip() for o in os.getenv("CLOVER_CORS_ORIGINS", "").split(",") if o.strip()]
CORS_ALLOW_ORIGIN_REGEX = os.getenv(
    "CLOVER_CORS_REGEX", r"https?://(localhost|127\.0\.0\.1|.*\.e2b\.app)(:\d+)?"
)

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
DATABASE_URL = os.getenv("CLOVER_DATABASE_URL", f"sqlite:///{DATA_DIR / 'clover.db'}")

# ---------------------------------------------------------------------------
# Security
# ---------------------------------------------------------------------------
SECRET_KEY = os.getenv("CLOVER_SECRET_KEY", "clover-dev-secret-change-me-in-production")
TOKEN_TTL_HOURS = int(os.getenv("CLOVER_TOKEN_TTL_HOURS", "168"))
PBKDF2_ITERATIONS = 240_000

DEFAULT_ADMIN_EMAIL = os.getenv("CLOVER_ADMIN_EMAIL", "admin@9clover.gg").lower()
DEFAULT_ADMIN_PASSWORD = os.getenv("CLOVER_ADMIN_PASSWORD", "clover2026")
DEFAULT_ADMIN_NAME = os.getenv("CLOVER_ADMIN_NAME", "Dre")
DEFAULT_ADMIN_IGN = os.getenv("CLOVER_ADMIN_IGN", "DRE")

# ---------------------------------------------------------------------------
# Team
# ---------------------------------------------------------------------------
TEAM_NAME = os.getenv("CLOVER_TEAM_NAME", "9 CLOVER")
TEAM_TAGLINE = os.getenv("CLOVER_TEAM_TAGLINE", "PLAY. REVIEW. ADAPT. DOMINATE.")
CURRENT_PATCH = os.getenv("CLOVER_PATCH", "2.2.16")
