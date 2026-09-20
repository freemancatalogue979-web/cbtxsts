"""Token issuing / verification and password hashing (stdlib only)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
import time
from dataclasses import dataclass

from .config import PBKDF2_ITERATIONS, SECRET_KEY, TOKEN_TTL_HOURS

ROLE_STUDENT = "student"
ROLE_ADMIN = "admin"

_NON_DIGITS = re.compile(r"\D+")


# ---------------------------------------------------------------------------
# Phone numbers
# ---------------------------------------------------------------------------
def normalize_phone(raw: str) -> str:
    """Accept 0803..., +234803..., 234-803-... and return a canonical local form.

    Nigerian numbers are stored as 11 local digits (``08031234567``). Foreign
    style ``+234`` prefixes are folded back to the leading zero.
    """
    digits = _NON_DIGITS.sub("", raw or "")
    if not digits:
        return ""
    # International forms fold back to the 11-digit local number:
    #   +234 803 123 4567 -> 234 + 10 digits -> 08031234567
    #   00234 803 123 4567 -> 00234 + 10 digits -> 08031234567
    if digits.startswith("00234"):
        digits = "0" + digits[5:]
    elif digits.startswith("234") and len(digits) >= 13:
        digits = "0" + digits[-10:]
    elif len(digits) == 10 and digits[0] in "789":
        # Bare local form without the trunk zero (7034548639).
        digits = "0" + digits
    return digits


def format_phone(phone: str) -> str:
    """Pretty ``0803 123 4567`` grouping for display."""
    digits = normalize_phone(phone)
    if len(digits) == 11:
        return f"{digits[:4]} {digits[4:7]} {digits[7:]}"
    return digits


def is_valid_phone(raw: str) -> bool:
    digits = normalize_phone(raw)
    return len(digits) == 11 and digits.startswith("0") and digits[1] in "789"


# ---------------------------------------------------------------------------
# Passwords (admin accounts)
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
# Tokens
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class Principal:
    """Who is making the request."""

    subject: str  # student id or admin id, as a string
    role: str     # ROLE_STUDENT | ROLE_ADMIN
    name: str = ""

    @property
    def student_id(self) -> int | None:
        return int(self.subject) if self.role == ROLE_STUDENT else None

    @property
    def admin_id(self) -> int | None:
        return int(self.subject) if self.role == ROLE_ADMIN else None


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64decode(raw: str) -> bytes:
    return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))


def create_token(subject: str | int, role: str, name: str = "", ttl_hours: int | None = None) -> str:
    payload = {
        "sub": str(subject),
        "role": role,
        "name": name,
        "iat": int(time.time()),
        "exp": int(time.time()) + (ttl_hours or TOKEN_TTL_HOURS) * 3600,
    }
    body = _b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(SECRET_KEY.encode(), body.encode(), hashlib.sha256).hexdigest()[:40]
    return f"{body}.{signature}"


def decode_token(token: str | None) -> Principal | None:
    if not token or "." not in token:
        return None
    body, _, signature = token.partition(".")
    expected = hmac.new(SECRET_KEY.encode(), body.encode(), hashlib.sha256).hexdigest()[:40]
    if not hmac.compare_digest(expected, signature):
        return None
    try:
        payload = json.loads(_b64decode(body))
    except (ValueError, json.JSONDecodeError):
        return None
    if int(payload.get("exp", 0)) < int(time.time()):
        return None
    return Principal(subject=payload.get("sub", ""), role=payload.get("role", ""), name=payload.get("name", ""))


def extract_token(authorization: str | None, token_param: str | None) -> str | None:
    """Bearer header wins, then ``?token=`` (needed for WebSocket handshakes)."""
    if authorization and authorization.lower().startswith("bearer "):
        return authorization.split(" ", 1)[1].strip()
    return token_param.strip() if token_param else None
