"""Who reads uploaded screenshots and documents.

Team Admin can save a Groq API key next to the main AI key. When it is there,
every *reading* job (Utility uploads, scoreboard/evidence screenshots, match
documents) goes to Groq's vision model first; the main key is the automatic
backup if Groq is down, rate-limited or refuses the picture. Without a Groq key
nothing changes. Writing jobs (strategy, coaching, chat) keep the main key.

Groq speaks the OpenAI chat format: https://console.groq.com/docs/vision
(max 3 images per request, JSON mode, instruct mode via reasoning_effort="none").
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, TypeVar

from sqlalchemy.orm import Session

from .ai_credentials import GROQ, PROVIDER as MAIN, CredentialStorageError, resolved_key

log = logging.getLogger("clover")

GROQ_BASE = os.getenv("CLOVER_GROQ_BASE_URL", "https://api.groq.com/openai/v1").strip().rstrip("/")
GROQ_ENDPOINT = f"{GROQ_BASE}/chat/completions"
GROQ_MODEL = os.getenv("CLOVER_GROQ_VISION_MODEL", "").strip() or "qwen/qwen3.8-27b"
GROQ_MAX_IMAGES = 3
GROQ_IMAGE_BUDGET = 3_500_000   # raw image bytes per request (base64 adds a third); keeps requests small and fast
GROQ_MAX_SIDE = 2400

T = TypeVar("T")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None  # never forward the Authorization header anywhere else


@dataclass(frozen=True)
class Reader:
    """A key plus the service it belongs to. ``backup`` is tried if this one fails."""

    provider: str
    key: str = field(repr=False)
    backup: "Reader | None" = None


class ProviderError(RuntimeError):
    """kind: rejected (bad request / picture) · auth (bad key) · unavailable · garbled."""

    def __init__(self, kind: str, status: int = 0, detail: str = "") -> None:
        super().__init__(f"{kind} {status} {detail}".strip())
        self.kind, self.status, self.detail = kind, status, detail


def _key(db: Session, provider: str) -> str | None:
    try:
        return resolved_key(db, provider)
    except CredentialStorageError:
        log.warning("The saved %s key cannot be unlocked; check the credential encryption key.", provider)
        return None


def reader_for(db: Session, main_key: str | None) -> Reader | None:
    """Groq first when its key exists, the main key as backup (or alone)."""
    main = Reader(MAIN, main_key) if main_key else None
    groq = _key(db, GROQ)
    if groq:
        return Reader(GROQ, groq, backup=main)
    return main


def with_backup(reader: Reader, job: Callable[[Reader], T]) -> T:
    try:
        return job(reader)
    except ProviderError as exc:
        if reader.backup is None:
            raise
        log.warning("%s could not read the upload (%s); using the backup key.", reader.provider, exc)
        return job(reader.backup)


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #
def json_from_content(content: Any) -> dict:
    """The model's JSON object, tolerating a reasoning block or code fence around it."""
    if not isinstance(content, str):
        raise ProviderError("garbled")
    text = re.sub(r"<think>.*?</think>", "", content, flags=re.S).strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text).strip()
    try:
        parsed = json.loads(text)
    except ValueError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise ProviderError("garbled") from None
        try:
            parsed = json.loads(text[start:end + 1])
        except ValueError:
            raise ProviderError("garbled") from None
    if not isinstance(parsed, dict):
        raise ProviderError("garbled")
    return parsed


def post_chat(endpoint: str, key: str, body: dict, *, timeout: int, limit: int = 1_000_000) -> dict:
    """POST one chat request; return the JSON object in the first choice."""
    req = urllib.request.Request(endpoint, data=json.dumps(body, ensure_ascii=False).encode("utf-8"), method="POST",
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                                          "Accept": "application/json", "User-Agent": "9clover-hub/1.0"})
    try:
        with urllib.request.build_opener(_NoRedirect()).open(req, timeout=timeout) as resp:
            raw = resp.read(limit + 1)
    except urllib.error.HTTPError as exc:
        try:
            detail = exc.read(2000).decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            detail = ""
        kind = "auth" if exc.code in (401, 403) else "rejected" if exc.code in (400, 404, 413, 422) else "unavailable"
        raise ProviderError(kind, exc.code, detail[:300]) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ProviderError("unavailable", 0, str(exc)[:200]) from exc
    if len(raw) > limit:
        raise ProviderError("garbled", 0, "reply too large")
    try:
        content = json.loads(raw)["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise ProviderError("garbled") from exc
    return json_from_content(content)


# --------------------------------------------------------------------------- #
# Groq
# --------------------------------------------------------------------------- #
def groq_body(system: str, user_content: Any, max_tokens: int, *, minimal: bool = False) -> dict:
    body: dict[str, Any] = {
        "model": GROQ_MODEL,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user_content}],
        "temperature": 0,               # transcription, not writing
        "max_completion_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }
    if not minimal:
        body["reasoning_effort"] = "none"     # instruct mode: answer straight away
        body["reasoning_format"] = "hidden"   # and never mix thinking into the JSON
    return body


def groq_chat(key: str, system: str, user_content: Any, *, max_tokens: int, timeout: int) -> dict:
    try:
        return post_chat(GROQ_ENDPOINT, key, groq_body(system, user_content, max_tokens), timeout=timeout)
    except ProviderError as exc:
        # A model that doesn't take the reasoning switches answers 400: ask again without them.
        if exc.kind != "rejected" or "reasoning" not in exc.detail.lower():
            raise
        return post_chat(GROQ_ENDPOINT, key, groq_body(system, user_content, max_tokens, minimal=True), timeout=timeout)


def fit_images(images: list[tuple[bytes, str]], budget: int = GROQ_IMAGE_BUDGET,
               max_side: int = GROQ_MAX_SIDE) -> list[tuple[bytes, str]]:
    """At most 3 pictures, re-encoded until together they fit the request budget."""
    images = images[:GROQ_MAX_IMAGES]
    if sum(len(data) for data, _ in images) <= budget and all(kind != "image/gif" for _, kind in images):
        return images
    from PIL import Image

    side, quality = max_side, 90
    while True:
        out: list[tuple[bytes, str]] = []
        for data, kind in images:
            img = Image.open(io.BytesIO(data))
            img.load()
            img = img.convert("RGB")
            img.thumbnail((side, side))
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=quality)
            out.append((buf.getvalue(), "image/jpeg"))
        if sum(len(d) for d, _ in out) <= budget or side <= 900:
            return out
        side, quality = int(side * 0.8), max(70, quality - 5)


def groq_image_parts(images: list[tuple[bytes, str]]) -> list[dict]:
    return [{"type": "image_url", "image_url": {"url": f"data:{kind};base64,{base64.b64encode(data).decode('ascii')}"}}
            for data, kind in fit_images(images)]


def check_groq_key(key: str) -> dict:
    """Ask Groq which models this key can use. Never raises; the key is never echoed."""
    req = urllib.request.Request(f"{GROQ_BASE}/models", headers={"Authorization": f"Bearer {key}",
                                                                 "Accept": "application/json", "User-Agent": "9clover-hub/1.0"})
    try:
        with urllib.request.build_opener(_NoRedirect()).open(req, timeout=15) as resp:
            data = json.loads(resp.read(2_000_001))
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            return {"ok": False, "model": GROQ_MODEL, "message": "Groq refused this key. Copy it again from console.groq.com/keys."}
        return {"ok": False, "model": GROQ_MODEL, "message": f"Groq answered with an error ({exc.code}). Try again in a minute."}
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return {"ok": False, "model": GROQ_MODEL, "message": "Couldn't reach Groq from the server. Check its internet connection."}
    ids = {str(m.get("id")) for m in (data.get("data") or []) if isinstance(m, dict)} if isinstance(data, dict) else set()
    if GROQ_MODEL not in ids:
        return {"ok": False, "model": GROQ_MODEL,
                "message": f"The key works, but the model {GROQ_MODEL} isn't available to it. "
                           "Set CLOVER_GROQ_VISION_MODEL to a Groq vision model."}
    return {"ok": True, "model": GROQ_MODEL, "message": f"Connected. Uploads are read with {GROQ_MODEL}."}
