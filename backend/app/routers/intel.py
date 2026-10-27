"""MLBB public-data proxy — fronts the community Rone Arena API server-side.

Why a proxy: the browser never talks to the third-party host (our auth cookies
apply to every intel call, no CORS surprises, single retry/cache layer), and
only PUBLIC reference/analytics endpoints are allowed through. The player
account flow (`/user/*` — verification-code login, profile, match history) is
deliberately NOT proxied: that needs token isolation and is Phase 4 work.

Response envelope upstream: `{code: 0, message, data, traceID}`; ranking rows
live in `data.records[].data`.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
import urllib.error
import urllib.request

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from ..deps import get_current_user
from ..models import User

logger = logging.getLogger("clover.intel")

router = APIRouter(prefix="/intel", tags=["intel"])

BASE_URL = os.getenv("RONE_BASE_URL", "https://arena.rone.dev/api").rstrip("/")
FALLBACK_URL = os.getenv("RONE_FALLBACK_URL", "").rstrip("/")

SAFE_PATH = re.compile(r"^[a-z0-9][a-z0-9\-_/\.]*$", re.IGNORECASE)
ALLOWED_BASES = ("heroes", "academy", "esports", "addon")
DENY_BASES = ("user",)  # account endpoints — never through here

# in-memory TTL cache: path?query -> (expires_at, status, body)
_cache: dict[str, tuple[float, int, bytes]] = {}
CACHE_TTL = int(os.getenv("RONE_CACHE_TTL", "300"))  # shifting stats: 5 min
LONG_TTL = 3600  # reference data: 1 h
LONG_LIVED = re.compile(
    r"^(academy/(equipment|equipment/expanded|spells|emblems|ranks|meta/version|roles)"
    r"|heroes$|heroes/positions|esports/[a-z]+/(standings|playoffs))"
)


def _fetch(url: str) -> tuple[int, bytes]:
    req = urllib.request.Request(
        url, headers={"Accept": "application/json", "User-Agent": "9clover-hub/1.0"}
    )
    with urllib.request.urlopen(req, timeout=12) as resp:
        return resp.status, resp.read()


@router.get("/{path:path}")
def intel_proxy(path: str, request: Request, _user: User = Depends(get_current_user)) -> JSONResponse:
    if not SAFE_PATH.match(path or ""):
        raise HTTPException(400, "bad path")
    base = path.split("/", 1)[0]
    if base in DENY_BASES or base not in ALLOWED_BASES:
        raise HTTPException(403, "endpoint not proxied")

    qs = request.url.query
    key = f"{path}?{qs}"
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return JSONResponse(status_code=hit[1], content=json.loads(hit[2]), headers={"x-intel-cache": "hit"})

    ttl = LONG_TTL if LONG_LIVED.match(path) else CACHE_TTL
    last_err: Exception | None = None
    for host in [BASE_URL] + ([FALLBACK_URL] if FALLBACK_URL else []):
        try:
            status, body = _fetch(f"{host}/{path}" + (f"?{qs}" if qs else ""))
            payload = json.loads(body)
            if status == 200:
                _cache[key] = (time.time() + ttl, status, body)
                if len(_cache) > 500:  # crude bound
                    _cache.clear()
            return JSONResponse(status_code=status, content=payload, headers={"x-intel-cache": "miss"})
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_err = exc
            logger.warning("intel upstream failed via %s: %s", host, exc)
        except json.JSONDecodeError as exc:
            last_err = exc
            break
    raise HTTPException(502, f"MLBB data service unreachable ({last_err})")
