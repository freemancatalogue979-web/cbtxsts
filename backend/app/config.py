"""Runtime configuration for the Quiz Arena backend."""
from __future__ import annotations

import os
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
DATA_DIR = BACKEND_ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------
HOST = os.getenv("CBT_HOST", "0.0.0.0")
PORT = int(os.getenv("CBT_PORT", "3000"))

# Comma separated list of extra origins allowed to call the API. The preview
# tunnels used by the sandbox are wildcard matched below.
EXTRA_CORS_ORIGINS = [o.strip() for o in os.getenv("CBT_CORS_ORIGINS", "").split(",") if o.strip()]
CORS_ALLOW_ORIGIN_REGEX = os.getenv("CBT_CORS_REGEX", r"https?://(localhost|127\.0\.0\.1|.*\.e2b\.app)(:\d+)?")

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
DATABASE_URL = os.getenv("CBT_DATABASE_URL", f"sqlite:///{DATA_DIR / 'arena.db'}")

# ---------------------------------------------------------------------------
# Security
# ---------------------------------------------------------------------------
SECRET_KEY = os.getenv("CBT_SECRET_KEY", "quiz-arena-dev-secret-change-me-in-production")
TOKEN_TTL_HOURS = int(os.getenv("CBT_TOKEN_TTL_HOURS", "168"))  # 7 days
PBKDF2_ITERATIONS = 240_000

DEFAULT_ADMIN_EMAIL = os.getenv("CBT_ADMIN_EMAIL", "admin@quizarena.ng")
DEFAULT_ADMIN_PASSWORD = os.getenv("CBT_ADMIN_PASSWORD", "arena2026")
DEFAULT_ADMIN_NAME = "Arena Administrator"

# ---------------------------------------------------------------------------
# Gameplay tuning
# ---------------------------------------------------------------------------
EXAM_GRACE_SECONDS = 20          # extra seconds allowed after the deadline before auto-expiry
DUEL_QUESTION_COUNT = 10         # default head-to-head length
DUEL_TIME_LIMIT_SECONDS = 180    # hard clock for a live duel
DUEL_STAKE_COINS = 25            # coins each player puts into the winner's pot
DUEL_SPEED_BONUS_MAX = 40        # fastest answer bonus points
DUEL_BASE_POINTS = 60            # points for a correct duel answer

MIN_MATCHMAKING_POOL = 2         # online players needed before quick-duel matches

APP_NAME = "Quiz Arena"
APP_TAGLINE = "Compete. Conquer. Climb."
