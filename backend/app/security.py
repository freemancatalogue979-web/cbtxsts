"""Token issuing / verification and password hashing (stdlib only)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass

from .config import PBKDF2_ITERATIONS, SECRET_KEY, TOKEN_TTL_HOURS

# Roles -----------------------------------------------------------------
ROLE_ADMIN = "admin"
ROLE_CAPTAIN = "captain"
ROLE_COACH = "coach"
ROLE_PLAYER = "player"
ROLE_ANALYST = "analyst"

ROLES = {ROLE_ADMIN, ROLE_CAPTAIN, ROLE_COACH, ROLE_PLAYER, ROLE_ANALYST}

ROLE_LABELS = {
    ROLE_ADMIN: "Admin",
    ROLE_CAPTAIN: "Captain",
    ROLE_COACH: "Coach",
    ROLE_PLAYER: "Player",
    ROLE_ANALYST: "Analyst",
}

# In-game lanes.
LANES = ["EXP", "JUNGLE", "MID", "GOLD", "ROAM"]


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERATIONS
    ).hex()
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, iterations, salt, digest = stored.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        candidate = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iterations)
        ).hex()
        return hmac.compare_digest(candidate, digest)
    except (ValueError, AttributeError):
        return False


# ---------------------------------------------------------------------------
# Tokens (stateless HMAC-signed JSON)
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class TokenPayload:
    subject: int
    role: str
    name: str
    exp: int


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64decode(raw: str) -> bytes:
    return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))


def _signature(body: str) -> str:
    return _b64encode(hmac.new(SECRET_KEY.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest())


def issue_token(user_id: int, role: str, name: str) -> str:
    body = _b64encode(
        json.dumps(
            {
                "sub": user_id,
                "role": role,
                "name": name,
                "exp": int(time.time()) + TOKEN_TTL_HOURS * 3600,
            },
            separators=(",", ":"),
        ).encode("utf-8")
    )
    return f"{body}.{_signature(body)}"


def verify_token(token: str) -> TokenPayload | None:
    try:
        body, sig = token.split(".", 1)
    except ValueError:
        return None
    if not hmac.compare_digest(sig, _signature(body)):
        return None
    try:
        data = json.loads(_b64decode(body))
        payload = TokenPayload(
            subject=int(data["sub"]), role=str(data["role"]), name=str(data.get("name", "")), exp=int(data["exp"])
        )
    except (KeyError, ValueError, TypeError, json.JSONDecodeError):
        return None
    if payload.exp < int(time.time()):
        return None
    if payload.role not in ROLES:
        return None
    return payload
