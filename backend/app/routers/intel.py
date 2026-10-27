"""MLBB public-data proxy + account linking — fronts the community Rone Arena API server-side.

Why a proxy: the browser never talks to the third-party host (our auth cookies
apply to every intel call, no CORS surprises, single retry/cache layer), and
only PUBLIC reference/analytics endpoints pass through the generic GET proxy.
The player-account flow lives in dedicated endpoints below with per-user token
isolation (JWT stored in our DB, never in the browser, never logged).

Upstream envelope: `{code: 0, message, data, traceID}`; ranking rows live in
`data.records[].data`. Account endpoints reply `{code, msg, data}`.
"""
from __future__ import annotations

import io
import json
import logging
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import AVATAR_DIR
from ..db import get_db
from ..deps import get_current_user
from ..models import IntelLink, User

logger = logging.getLogger("clover.intel")

router = APIRouter(prefix="/intel", tags=["intel"])

BASE_URL = os.getenv("RONE_BASE_URL", "https://arena.rone.dev/api").rstrip("/")
FALLBACK_URL = os.getenv("RONE_FALLBACK_URL", "").rstrip("/")

SAFE_PATH = re.compile(r"^[a-z0-9][a-z0-9\-_/\.]*$", re.IGNORECASE)
ALLOWED_BASES = ("heroes", "academy", "esports", "addon")

_cache: dict[str, tuple[float, int, bytes]] = {}
CACHE_TTL = int(os.getenv("RONE_CACHE_TTL", "300"))  # shifting stats: 5 min
LONG_TTL = 3600  # reference data: 1 h
LONG_LIVED = re.compile(
    r"^(academy/(equipment|equipment/expanded|spells|emblems|ranks|meta/version|roles)"
    r"|heroes$|heroes/positions|heroes/wallpapers|esports/[a-z]+/(standings|playoffs))"
)


def _fetch(url: str) -> tuple[int, bytes]:
    req = urllib.request.Request(
        url, headers={"Accept": "application/json", "User-Agent": "9clover-hub/1.0"}
    )
    with urllib.request.urlopen(req, timeout=12) as resp:
        return resp.status, resp.read()


# ---------------------------------------------------------------------------
# MLBB account linking (verified flow: send-vc → login → Bearer jwt per user)
# ---------------------------------------------------------------------------

class SendCodeIn(BaseModel):
    role_id: int
    zone_id: int


class ConnectIn(SendCodeIn):
    vc: str


def _rone_request(method: str, path: str, *, payload: dict | None = None,
                  params: dict | None = None, jwt: str | None = None) -> dict:
    url = f"{BASE_URL}/{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    headers = {"Accept": "application/json", "User-Agent": "9clover-hub/1.0"}
    if jwt:
        headers["Authorization"] = f"Bearer {jwt}"
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        try:
            return json.loads(exc.read())
        except Exception:
            raise HTTPException(502, f"MLBB data service error (HTTP {exc.code})") from None
    except (json.JSONDecodeError,) as exc:
        raise HTTPException(502, "MLBB data service returned bad JSON") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise HTTPException(502, f"MLBB data service unreachable ({exc})") from None


def _envelope_error(env: dict) -> str | None:
    if env.get("code", 0) == 0:
        return None
    return str(env.get("message") or env.get("msg") or f"upstream code {env.get('code')}")


def _summary(link: IntelLink) -> dict:
    return {"linked": True, "name": link.display_name, "avatar": link.avatar,
            "role_id": link.role_id, "zone_id": link.zone_id,
            "level": link.level, "rank_level": link.rank_level,
            "linked_at": link.linked_at.isoformat() if link.linked_at else None}


def _adopt_avatar(user: User, url: str) -> None:
    """Linked account gives the pfp — but NEVER stomps an existing avatar file
    (a custom upload, or a previously synced one). Delete your avatar to re-sync."""
    if not url:
        return
    target = AVATAR_DIR / f"{user.id}.png"
    if target.exists():
        return
    try:
        from PIL import Image  # Pillow is a pinned requirement; local import keeps boot cheap
        req = urllib.request.Request(url, headers={"User-Agent": "9clover-hub/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read()
        if len(raw) > 5 * 1024 * 1024:
            return
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        w, h = im.size
        side = min(w, h)
        im = im.crop(((w - side) // 2, (h - side) // 2, (w - side) // 2 + side, (h - side) // 2 + side))
        im = im.resize((256, 256), Image.LANCZOS)
        AVATAR_DIR.mkdir(parents=True, exist_ok=True)
        im.save(target, "PNG", optimize=True)
        logger.info("adopted MLBB avatar for user %s", user.id)
    except Exception as exc:  # avatar sync is nice-to-have, never fail the flow
        logger.info("avatar sync skipped for user %s: %s", user.id, exc)


def _cache_profile(link: IntelLink, idata: dict) -> None:
    """Stash name/avatar/level/rank from a user/info payload (coerce defensively)."""
    link.display_name = str(idata.get("name") or link.display_name or "")
    link.avatar = str(idata.get("avatar") or link.avatar or "")
    for key, attr in (("level", "level"), ("rank_level", "rank_level")):
        try:
            v = idata.get(key)
            if v is not None:
                setattr(link, attr, int(v))
        except (TypeError, ValueError):
            pass


def _get_link(user: User, db: Session) -> IntelLink:
    link = db.query(IntelLink).filter(IntelLink.user_id == user.id).one_or_none()
    if link is None:
        raise HTTPException(404, "Link your MLBB account first")
    return link


@router.post("/account/send-code")
def account_send_code(body: SendCodeIn, user: User = Depends(get_current_user)) -> dict:
    env = _rone_request("POST", "user/auth/send-vc", payload={"role_id": body.role_id, "zone_id": body.zone_id})
    err = _envelope_error(env)
    if err:
        raise HTTPException(400, f"Upstream refused: {err}")
    return {"sent": True, "hint": "Check your in-game mail — the code expires in 5 minutes"}


@router.post("/account/connect")
def account_connect(body: ConnectIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    env = _rone_request("POST", "user/auth/login",
                        payload={"role_id": body.role_id, "zone_id": body.zone_id, "vc": body.vc})
    err = _envelope_error(env)
    if err:
        raise HTTPException(400, f"Link failed: {err}")
    data = env.get("data") if isinstance(env.get("data"), dict) else {}
    jwt = str(data.get("jwt") or "")
    if not jwt:
        raise HTTPException(502, "Upstream login returned no token")
    link = db.query(IntelLink).filter(IntelLink.user_id == user.id).one_or_none() or IntelLink(user_id=user.id)
    link.role_id = body.role_id
    link.zone_id = body.zone_id
    link.jwt = jwt
    link.token = str(data.get("token") or "")
    # capture display name + avatar + level/rank while the session is fresh
    info = _rone_request("GET", "user/info", params={"lang": "en"}, jwt=jwt)
    idata = info.get("data") if isinstance(info.get("data"), dict) else {}
    _cache_profile(link, idata)
    _adopt_avatar(user, link.avatar)
    db.add(link)
    db.commit()
    logger.info("MLBB account linked for user %s (role %s)", user.id, body.role_id)  # ids only, never tokens
    return {"linked": True, "name": link.display_name, "role_id": body.role_id, "zone_id": body.zone_id}


@router.get("/account/status")
def account_status(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    link = db.query(IntelLink).filter(IntelLink.user_id == user.id).one_or_none()
    return _summary(link) if link else {"linked": False}


@router.get("/linked")
def linked_roster(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """Team-wide view: who has a linked MLBB account (cached profile snapshot only —
    no tokens, no upstream call). Drives the MLBB chip on the Players roster."""
    links = db.query(IntelLink).all()
    return {"linked": [{**_summary(l), "user_id": l.user_id} for l in links]}


@router.get("/account/of/{user_id}")
def account_of(user_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    link = db.query(IntelLink).filter(IntelLink.user_id == user_id).one_or_none()
    return _summary(link) if link else {"linked": False}


@router.get("/account/profile")
def account_profile(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    link = _get_link(user, db)
    out: dict = {"link": _summary(link)}
    for key, path in (("info", "user/info"), ("season", "user/season"), ("stats", "user/stats")):
        try:
            out[key] = _rone_request("GET", path, params={"lang": "en"}, jwt=link.jwt)
            if key == "info" and isinstance(out[key].get("data"), dict):
                _cache_profile(link, out[key]["data"])  # keep roster snapshot fresh
                _adopt_avatar(user, link.avatar)
                db.commit()
                out["link"] = _summary(link)
        except HTTPException as exc:
            out[key] = {"code": -1, "error": str(exc.detail)}
    return out


@router.get("/account/matches")
def account_matches(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    link = _get_link(user, db)
    params = dict(request.query_params)
    return _rone_request("GET", "user/matches", params=params or {"lang": "en"}, jwt=link.jwt)


@router.get("/account/heroes")
def account_heroes(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    link = _get_link(user, db)
    params = dict(request.query_params)
    return _rone_request("GET", "user/heroes/frequent", params=params or {"lang": "en"}, jwt=link.jwt)


@router.post("/account/disconnect")
def account_disconnect(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    link = _get_link(user, db)
    try:
        _rone_request("POST", "user/auth/logout", payload={}, jwt=link.jwt)
    except HTTPException:
        pass  # local cleanup happens regardless of upstream state
    db.delete(link)
    db.commit()
    logger.info("MLBB account unlinked for user %s", user.id)
    return {"linked": False}


# ---------------------------------------------------------------------------
# Generic public GET proxy — registered LAST so /account/* wins the routing.
# ---------------------------------------------------------------------------

@router.get("/{path:path}")
def intel_proxy(path: str, request: Request, _user: User = Depends(get_current_user)) -> JSONResponse:
    if path.startswith("account") or not SAFE_PATH.match(path or ""):
        raise HTTPException(404, "unknown endpoint")
    base = path.split("/", 1)[0]
    if base not in ALLOWED_BASES:
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
