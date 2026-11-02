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
import urllib.error
import urllib.parse
import urllib.request
from datetime import timedelta
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import exists, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..clover_ai_models import AIAccountConsent
from ..config import AVATAR_DIR
from ..db import get_db
from ..deps import get_current_user
from ..intel_cache import MAX_SNAPSHOT_BYTES, IntelAccountGeneration, IntelSnapshot, cache_payload, claim_refresh, decode_snapshot, finish_refresh, save_snapshot, snapshot_key
from ..models import IntelLink, User, utcnow

logger = logging.getLogger("clover.intel")

router = APIRouter(prefix="/intel", tags=["intel"])

BASE_URL = os.getenv("RONE_BASE_URL", "https://arena.rone.dev/api").rstrip("/")
FALLBACK_URL = os.getenv("RONE_FALLBACK_URL", "").rstrip("/")

SAFE_PATH = re.compile(r"^[a-z0-9][a-z0-9\-_/\. ]*$", re.IGNORECASE)  # hero names carry spaces ("Yu Zhong", "Yi Sun-shin")
ALLOWED_BASES = ("heroes", "academy", "esports", "addon")

CACHE_TTL = int(os.getenv("RONE_CACHE_TTL", "300"))  # shifting stats: 5 min
LONG_TTL = 3600  # reference data: 1 h
LONG_LIVED = re.compile(
    r"^(academy/(equipment|equipment/expanded|spells|emblems|ranks|meta/version|roles)"
    r"|heroes$|heroes/positions|heroes/wallpapers|esports/[a-z]+/(standings|playoffs))"
)


def _fetch(url: str) -> tuple[int, bytes]:
    from ..esports_ai import _NoRedirect

    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "9clover-hub/1.0"})
    with urllib.request.build_opener(_NoRedirect()).open(req, timeout=12) as resp:
        body = resp.read(MAX_SNAPSHOT_BYTES + 1)
        if len(body) > MAX_SNAPSHOT_BYTES:
            raise ValueError("Source response exceeds the snapshot size limit.")
        return resp.status, body


# ---------------------------------------------------------------------------
# MLBB account linking (verified flow: send-vc → login → Bearer jwt per user)
# ---------------------------------------------------------------------------

def account_user(response: Response, authorization: str | None = Header(default=None),
                 user: User = Depends(get_current_user)) -> User:
    # Cookies are intended for media, not cross-origin account-stat reads or writes.
    scheme, _, credential = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not credential.strip():
        raise HTTPException(401, "Bearer sign-in required for your MLBB account.")
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return user


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
    from ..esports_ai import _NoRedirect
    try:
        # Never forward an account bearer token to a redirected host.
        with urllib.request.build_opener(_NoRedirect()).open(req, timeout=15) as resp:
            body = resp.read(MAX_SNAPSHOT_BYTES + 1)
            if len(body) > MAX_SNAPSHOT_BYTES:
                raise HTTPException(502, "MLBB data response was too large.")
            result = json.loads(body)
            if not isinstance(result, dict):
                raise HTTPException(502, "MLBB data service returned an invalid response.")
            return result
    except urllib.error.HTTPError as exc:
        try:
            result = json.loads(exc.read(MAX_SNAPSHOT_BYTES + 1))
            if isinstance(result, dict):
                return result
        except (ValueError, OSError):
            pass
        raise HTTPException(502, f"MLBB data service error (HTTP {exc.code})") from None
    except (json.JSONDecodeError,) as exc:
        raise HTTPException(502, "MLBB data service returned bad JSON") from exc
    except (urllib.error.URLError, TimeoutError, OSError):
        raise HTTPException(502, "MLBB data service is unreachable.") from None


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
def account_send_code(body: SendCodeIn, user: User = Depends(account_user)) -> dict:
    env = _rone_request("POST", "user/auth/send-vc", payload={"role_id": body.role_id, "zone_id": body.zone_id})
    err = _envelope_error(env)
    if err:
        raise HTTPException(400, f"Upstream refused: {err}")
    return {"sent": True, "hint": "Check your in-game mail — the code expires in 5 minutes"}


@router.post("/account/connect")
def account_connect(body: ConnectIn, user: User = Depends(account_user), db: Session = Depends(get_db)) -> dict:
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
    # Capture the new profile before replacing the existing link. Old account
    # snapshots and AI consent must never carry across a relink.
    info = _rone_request("GET", "user/info", params={"lang": "en"}, jwt=jwt)
    _purge_account_data(db, user.id)
    link.role_id = body.role_id
    link.zone_id = body.zone_id
    link.jwt = jwt
    link.token = str(data.get("token") or "")
    link.linked_at = utcnow()
    link.display_name = link.avatar = ""
    link.level = link.rank_level = None
    idata = info.get("data") if isinstance(info.get("data"), dict) else {}
    _cache_profile(link, idata)
    _adopt_avatar(user, link.avatar)
    db.add(link)
    db.flush()
    generation = IntelAccountGeneration(id=uuid4().hex, owner_id=user.id, link_id=link.id)
    db.add(generation)
    db.commit()
    try:
        if not _envelope_error(info):
            save_snapshot(db, "account", "user/info", "lang=en", _account_safe(info, secrets=(jwt, link.token)), owner_id=user.id, generation_id=generation.id)
    except (ValueError, IntegrityError):
        db.rollback()  # Linking succeeded even if the optional first snapshot could not be saved.
    logger.info("MLBB account linked for user %s (role %s)", user.id, body.role_id)  # ids only, never tokens
    return {"linked": True, "name": link.display_name, "role_id": body.role_id, "zone_id": body.zone_id}


@router.get("/account/status")
def account_status(user: User = Depends(account_user), db: Session = Depends(get_db)) -> dict:
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


_ACCOUNT_SECRET_KEYS = {"jwt", "token", "access_token", "refresh_token", "authorization", "password", "secret", "cookie", "vc", "verification_code", "sig", "signature", "api_key"}


def _account_safe(value, depth: int = 0, secrets: tuple[str, ...] = ()):  # noqa: ANN001
    """Remove credentials even if an account endpoint unexpectedly echoes them."""
    if depth > 16:
        return None
    if isinstance(value, dict):
        return {str(k): _account_safe(v, depth + 1, secrets) for k, v in value.items()
                if str(k).lower().replace("-", "_") not in _ACCOUNT_SECRET_KEYS
                and not re.search(r"token|password|secret|credential|jwt|authorization|cookie|verification|session", str(k), re.I)}
    if isinstance(value, list):
        return [_account_safe(v, depth + 1, secrets) for v in value[:1000]]
    if isinstance(value, str):
        if re.fullmatch(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", value):
            return ""
        for secret in secrets:
            if secret:
                value = value.replace(secret, "[redacted]")
        # Signed URLs can contain credentials too; do not persist such URLs.
        try:
            parsed = urllib.parse.urlsplit(value)
            if parsed.scheme in {"http", "https"} and any(
                key.lower() in _ACCOUNT_SECRET_KEYS or "token" in key.lower()
                for key, _ in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
            ):
                return ""
        except ValueError:
            return ""
        return value[:20000]
    return value if value is None or isinstance(value, (bool, int, float)) else None


def _purge_account_data(db: Session, user_id: int) -> None:
    # The generation FK also prevents an in-flight refresh re-creating old data.
    db.query(IntelSnapshot).filter_by(scope="account", owner_id=user_id).delete(synchronize_session=False)
    db.query(IntelAccountGeneration).filter_by(owner_id=user_id).delete(synchronize_session=False)
    db.query(AIAccountConsent).filter_by(user_id=user_id).delete(synchronize_session=False)


def _account_generation(db: Session, link: IntelLink) -> str:
    owner_id, link_id = link.user_id, link.id
    existing = db.query(IntelAccountGeneration).filter_by(owner_id=owner_id, link_id=link_id).one_or_none()
    if existing:
        return existing.id
    row = IntelAccountGeneration(id=uuid4().hex, owner_id=owner_id, link_id=link_id)
    db.add(row)
    try:
        db.commit()
        return row.id
    except IntegrityError:
        db.rollback()  # Another request may have created the namespace for a legacy link.
        existing = db.query(IntelAccountGeneration).filter_by(owner_id=owner_id, link_id=link_id).one_or_none()
        if existing is None:
            raise HTTPException(409, "Your linked account changed. Please reload.") from None
        return existing.id


def _account_meta(payload: dict, observed_at, state: str, refreshing: bool = False, error: bool = False) -> dict:  # noqa: ANN001
    return {**payload, "_clover_cache": {"observed_at": observed_at.isoformat() + "Z" if observed_at else None,
                                          "status": state, "refreshing": refreshing, "refresh_failed": error}}


def _update_profile_if_current(db: Session, user_id: int, generation_id: str, jwt: str, data: dict) -> None:
    values: dict = {}
    for key, attr, limit in (("name", "display_name", 120), ("avatar", "avatar", 500)):
        if isinstance(data.get(key), str) and data[key]:
            values[attr] = data[key][:limit]
    for key in ("level", "rank_level"):
        try:
            if data.get(key) is not None:
                values[key] = int(data[key])
        except (ValueError, TypeError, OverflowError):
            pass
    if values:
        active_generation = exists().where(IntelAccountGeneration.id == generation_id, IntelAccountGeneration.owner_id == user_id,
                                           IntelAccountGeneration.link_id == IntelLink.id)
        db.execute(update(IntelLink).where(IntelLink.user_id == user_id, IntelLink.jwt == jwt, active_generation).values(**values))
        db.commit()


def _refresh_account_snapshot(bind, key: str, user_id: int, generation_id: str, path: str, query: str, token: str) -> None:  # noqa: ANN001
    with Session(bind=bind) as db:
        try:
            generation = db.get(IntelAccountGeneration, generation_id)
            link = db.query(IntelLink).filter_by(user_id=user_id).one_or_none()
            if not generation or generation.owner_id != user_id or not link or link.id != generation.link_id:
                return
            jwt = link.jwt  # Never place credentials in the task queue, snapshots or logs.
            secrets = (jwt, link.token)
            params = dict(urllib.parse.parse_qsl(query, keep_blank_values=True))
            payload = _account_safe(_rone_request("GET", path, params=params, jwt=jwt), secrets=secrets)
            if _envelope_error(payload):
                raise ValueError("Source returned an error.")
            cache_payload(payload)
            saved = finish_refresh(db, key, token, payload)
            if saved and path == "user/info" and isinstance(payload.get("data"), dict):
                _update_profile_if_current(db, user_id, generation_id, jwt, payload["data"])
        except Exception:
            db.rollback()
            finish_refresh(db, key, token, None, "Refresh failed; the saved snapshot was retained.")


def _account_cached(db: Session, user: User, link: IntelLink, path: str, params: dict,
                    background_tasks: BackgroundTasks) -> dict:
    generation_id = _account_generation(db, link)
    query = urllib.parse.urlencode(sorted(params.items()))
    key = snapshot_key("account", path, query, user.id, generation_id)
    row = db.get(IntelSnapshot, key)
    if row:
        try:
            payload = decode_snapshot(row)
            if not isinstance(payload, dict):
                raise ValueError("Invalid saved account response.")
        except (ValueError, TypeError):
            db.delete(row); db.commit()
        else:
            observed_at = row.observed_at
            stale = observed_at + timedelta(seconds=CACHE_TTL) <= utcnow()
            had_error = bool(row.last_error)
            refreshing = bool(row.lease_until and row.lease_until > utcnow())
            if stale:
                token = uuid4().hex
                if claim_refresh(db, key, token):
                    background_tasks.add_task(_refresh_account_snapshot, db.get_bind(), key, user.id, generation_id, path, query, token)
                    refreshing = True
            return _account_meta(payload, observed_at, "stale" if stale else "fresh", refreshing, had_error)

    jwt = link.jwt
    payload = _account_safe(_rone_request("GET", path, params=params, jwt=jwt), secrets=(jwt, link.token))
    if _envelope_error(payload):
        return payload
    db.expire_all()
    current = db.query(IntelLink).filter_by(user_id=user.id).one_or_none()
    if not current or current.jwt != jwt or not db.get(IntelAccountGeneration, generation_id):
        raise HTTPException(409, "Your linked account changed. Please reload.")
    try:
        row = save_snapshot(db, "account", path, query, payload, owner_id=user.id, generation_id=generation_id)
    except (ValueError, IntegrityError):
        db.rollback()
        raise HTTPException(409, "Your linked account changed or the snapshot was too large. Please reload.") from None
    if path == "user/info" and isinstance(payload.get("data"), dict):
        _update_profile_if_current(db, user.id, generation_id, jwt, payload["data"])
    return _account_meta(payload, row.observed_at, "fresh")


def _account_params(request: Request, matches: bool) -> dict:
    allowed = {"index", "size", "lang"} if matches else {"lang"}
    if any(key not in allowed for key in request.query_params):
        raise HTTPException(400, "Invalid account data query.")
    result: dict = {"lang": request.query_params.get("lang", "en")}
    if not re.fullmatch(r"[A-Za-z-]{2,12}", result["lang"]):
        raise HTTPException(400, "Invalid language.")
    if matches:
        for key, default, maximum in (("index", 1, 100), ("size", 20, 50)):
            try:
                value = int(request.query_params.get(key, str(default)))
            except ValueError:
                raise HTTPException(400, f"Invalid {key}.") from None
            if not 1 <= value <= maximum:
                raise HTTPException(400, f"Invalid {key}.")
            result[key] = value
    return result


@router.get("/account/profile")
def account_profile(background_tasks: BackgroundTasks, response: Response, user: User = Depends(account_user),
                    db: Session = Depends(get_db)) -> dict:
    response.headers["Cache-Control"] = "no-store"
    link = _get_link(user, db)
    out: dict = {"link": _summary(link)}
    for key, path in (("info", "user/info"), ("season", "user/season"), ("stats", "user/stats")):
        try:
            out[key] = _account_cached(db, user, link, path, {"lang": "en"}, background_tasks)
        except HTTPException as exc:
            out[key] = {"code": -1, "error": str(exc.detail)}
    out["link"] = _summary(link)
    return out


@router.get("/account/matches")
def account_matches(request: Request, background_tasks: BackgroundTasks, response: Response,
                    user: User = Depends(account_user), db: Session = Depends(get_db)) -> dict:
    response.headers["Cache-Control"] = "no-store"
    return _account_cached(db, user, _get_link(user, db), "user/matches", _account_params(request, True), background_tasks)


@router.get("/account/heroes")
def account_heroes(request: Request, background_tasks: BackgroundTasks, response: Response,
                   user: User = Depends(account_user), db: Session = Depends(get_db)) -> dict:
    response.headers["Cache-Control"] = "no-store"
    return _account_cached(db, user, _get_link(user, db), "user/heroes/frequent", _account_params(request, False), background_tasks)


@router.post("/account/disconnect")
def account_disconnect(user: User = Depends(account_user), db: Session = Depends(get_db)) -> dict:
    link = _get_link(user, db)
    jwt = link.jwt
    _purge_account_data(db, user.id)
    db.delete(link)
    db.commit()  # Local access and saved data are removed even if logout fails.
    try:
        _rone_request("POST", "user/auth/logout", payload={}, jwt=jwt)
    except HTTPException:
        pass
    logger.info("MLBB account unlinked for user %s", user.id)
    return {"linked": False}


# ---------------------------------------------------------------------------
# Generic public GET proxy — registered LAST so /account/* wins the routing.
# ---------------------------------------------------------------------------

def _public_fetch(path: str, query: str) -> tuple[int, object]:
    safe_path = urllib.parse.quote(path, safe="/._-")
    for host in [BASE_URL] + ([FALLBACK_URL] if FALLBACK_URL else []):
        try:
            status, body = _fetch(f"{host}/{safe_path}" + (f"?{query}" if query else ""))
            return status, json.loads(body)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            logger.warning("Public MLBB data refresh failed for %s", path)
    raise HTTPException(502, "MLBB data service is unavailable. No saved snapshot exists yet.")


def _refresh_public_snapshot(bind, key: str, path: str, query: str, token: str) -> None:  # noqa: ANN001
    # A new session is required: the request's session closes after the response.
    with Session(bind=bind) as db:
        try:
            status, payload = _public_fetch(path, query)
            if status != 200:
                raise ValueError("Source returned an error.")
            cache_payload(payload)
            finish_refresh(db, key, token, payload)
        except Exception:
            db.rollback()
            finish_refresh(db, key, token, None, "Refresh failed; the saved snapshot was retained.")


def _snapshot_response(payload: object, observed_at, state: str, refreshing: bool = False, error: bool = False) -> JSONResponse:  # noqa: ANN001
    meta = {"observed_at": observed_at.isoformat() + "Z" if observed_at else None,
            "status": state, "refreshing": refreshing, "refresh_failed": error}
    # The upstream envelope is preserved; extra metadata is ignored by old clients.
    content = {**payload, "_clover_cache": meta} if isinstance(payload, dict) else payload
    return JSONResponse(content=content, headers={"x-intel-cache": state, "Cache-Control": "no-store"})


@router.get("/{path:path}")
def intel_proxy(path: str, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                _user: User = Depends(get_current_user)) -> JSONResponse:
    if (path.startswith("account") or not SAFE_PATH.fullmatch(path or "") or len(path) > 256
            or any(part in {"", ".", ".."} for part in path.split("/"))):
        raise HTTPException(404, "unknown endpoint")
    if path.split("/", 1)[0] not in ALLOWED_BASES:
        raise HTTPException(403, "endpoint not proxied")
    query = request.url.query
    if len(query) > 2048 or any(key.casefold() in {"token", "access_token", "jwt", "authorization", "api_key", "password", "vc"}
                                 for key in request.query_params):
        raise HTTPException(400, "Invalid public data query.")

    key = snapshot_key("public", path, query)
    row = db.get(IntelSnapshot, key)
    ttl = LONG_TTL if LONG_LIVED.match(path) else CACHE_TTL
    if row is not None:
        try:
            payload = decode_snapshot(row)
        except (ValueError, TypeError):
            # A corrupt snapshot is not a successful source response.
            db.delete(row); db.commit(); row = None
        else:
            observed_at = row.observed_at
            stale = observed_at + timedelta(seconds=ttl) <= utcnow()
            had_error = bool(row.last_error)
            refreshing = bool(row.lease_until and row.lease_until > utcnow())
            if stale:
                token = uuid4().hex
                claimed = claim_refresh(db, key, token)
                if claimed:
                    background_tasks.add_task(_refresh_public_snapshot, db.get_bind(), key, path, query, token)
                    refreshing = True
            return _snapshot_response(payload, observed_at, "stale" if stale else "fresh", refreshing, had_error)

    status, payload = _public_fetch(path, query)
    if status != 200:
        return JSONResponse(status_code=status, content=payload, headers={"Cache-Control": "no-store"})
    try:
        row = save_snapshot(db, "public", path, query, payload)
    except ValueError:
        # Preserve an upstream error envelope for existing clients; never cache it.
        return JSONResponse(content=payload, headers={"x-intel-cache": "not-saved", "Cache-Control": "no-store"})
    return _snapshot_response(payload, row.observed_at, "fresh")
