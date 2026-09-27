"""Runtime configuration for the Quiz Arena backend."""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
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
DUEL_TIME_LIMIT_SECONDS = 180    # whole-duel hard clock (outer safety net)
DUEL_PER_QUESTION_SECONDS = 20   # server-paced clock applied to every question
DUEL_MIN_QUESTIONS = 3           # smallest duel the arena will build
DUEL_MAX_QUESTIONS = 100         # largest duel the arena will build (hard cap)
DUEL_STAKE_COINS = 25            # coins each player puts into the winner's pot
DUEL_SPEED_BONUS_MAX = 40        # fastest answer bonus points
DUEL_BASE_POINTS = 60            # points for a correct duel answer

MIN_MATCHMAKING_POOL = 2         # online players needed before quick-duel matches

APP_NAME = "Quiz Arena"
APP_TAGLINE = "Compete. Conquer. Climb."


# ---------------------------------------------------------------------------
# AI writing help (Google Gemini, free tier) — "Make it easy to read"
# ---------------------------------------------------------------------------
# Create a free key at https://aistudio.google.com (Get API key) and put
# GEMINI_API_KEY=... in backend/.env (or the process environment), then
# restart the API. Without a key everything else works; the editor explains
# how to set it up.
# ---------------------------------------------------------------------------
# API keys entered by the owner in the admin panel (AI Tutor → Models).
# ---------------------------------------------------------------------------
# Kept in backend/data/ai_keys.json (git-ignored, owner-only file permissions).
# A saved key wins over GEMINI_API_KEY / DEEPSEEK_API_KEY from .env or the
# environment, and every AI call reads settings fresh, so a new key is used from
# the very next request — no restart. Other workers pick it up via the file's mtime.
AI_KEYS_FILE = Path(os.getenv("CBT_AI_KEYS_FILE", "") or DATA_DIR / "ai_keys.json")
AI_KEY_ENV = {"gemini": "GEMINI_API_KEY", "deepseek": "DEEPSEEK_API_KEY"}
_saved_keys: dict = {"mtime": None, "keys": {}}


def _read_saved_keys() -> dict:
    try:
        mtime = AI_KEYS_FILE.stat().st_mtime_ns
    except FileNotFoundError:
        _saved_keys.update(mtime=None, keys={})
        return {}
    if mtime != _saved_keys["mtime"]:
        try:
            data = json.loads(AI_KEYS_FILE.read_text("utf-8"))
        except (OSError, ValueError):
            data = {}
        keys = {name: entry for name, entry in (data.get("keys") or {}).items() if isinstance(entry, dict) and entry.get("key")}
        _saved_keys.update(mtime=mtime, keys=keys)
    return _saved_keys["keys"]


def saved_ai_key(provider: str) -> dict | None:
    """{"key", "updated_at", "updated_by"} saved from the admin panel, or None."""
    return _read_saved_keys().get(provider)


def save_ai_key(provider: str, key: str | None, *, by: str = "") -> None:
    """Store (or with ``key=None`` remove) the admin-panel key for a provider."""
    keys = dict(_read_saved_keys())
    if key:
        keys[provider] = {"key": key, "updated_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds"), "updated_by": by[:120]}
    else:
        keys.pop(provider, None)
    temp = AI_KEYS_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps({"keys": keys}, indent=1), "utf-8")
    try:
        os.chmod(temp, 0o600)
    except OSError:
        pass
    os.replace(temp, AI_KEYS_FILE)
    _saved_keys["mtime"] = None  # re-read on next use


def ai_key(provider: str) -> tuple[str, str]:
    """(key, source) — source is "admin" (panel), "env" (.env / environment) or ""."""
    saved = saved_ai_key(provider)
    if saved:
        return str(saved["key"]).strip(), "admin"
    value = os.getenv(AI_KEY_ENV[provider], "").strip()
    return value, ("env" if value else "")


def mask_key(key: str) -> str:
    """Enough to recognise a key, never enough to use it: "AQ.A…9Q2x"."""
    key = key.strip()
    if len(key) <= 10:
        return "•" * len(key)
    return f"{key[:4]}…{key[-4:]}"


def gemini_settings() -> dict:
    return {
        "key": ai_key("gemini")[0],
        # Model names change often; "gemini-flash-latest" follows Google's current
        # free Flash model. Fallbacks are tried if the chosen one is unavailable.
        "model": os.getenv("GEMINI_MODEL", "gemini-flash-latest").strip(),
        "fallbacks": [m.strip() for m in os.getenv("GEMINI_FALLBACK_MODELS", "gemini-2.5-flash,gemini-flash-lite-latest").split(",") if m.strip()],
        "base": os.getenv("GEMINI_API_BASE", "https://generativelanguage.googleapis.com/v1beta").rstrip("/"),
        # Per call, and a total budget per request (fallbacks included) that stays
        # under typical proxy limits (Cloudflare 100 s, preview proxies 120 s).
        "timeout": float(os.getenv("GEMINI_TIMEOUT", "60")),
        "budget": float(os.getenv("GEMINI_BUDGET", "75")),
    }


# DeepSeek (paid, very cheap): create a key at https://platform.deepseek.com
# (API keys), add a small balance, and put DEEPSEEK_API_KEY=... in backend/.env.
def deepseek_settings() -> dict:
    return {
        "key": ai_key("deepseek")[0],
        # DeepSeek renames models now and then; unknown names fall through the list.
        "model": os.getenv("DEEPSEEK_MODEL", "deepseek-flash").strip(),
        "fallbacks": [m.strip() for m in os.getenv("DEEPSEEK_FALLBACK_MODELS", "deepseek-v4-flash,deepseek-chat").split(",") if m.strip()],
        "base": os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com").rstrip("/"),
        "timeout": float(os.getenv("DEEPSEEK_TIMEOUT", os.getenv("GEMINI_TIMEOUT", "60"))),
        "budget": float(os.getenv("DEEPSEEK_BUDGET", os.getenv("GEMINI_BUDGET", "75"))),
    }


def ai_provider() -> str:
    """AI_PROVIDER=deepseek|gemini forces one; otherwise DeepSeek when its key is
    set, else Gemini."""
    chosen = os.getenv("AI_PROVIDER", "auto").strip().lower()
    if chosen in {"deepseek", "gemini"}:
        return chosen
    return "deepseek" if deepseek_settings()["key"] else "gemini"
