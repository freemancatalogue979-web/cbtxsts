"""Player account data straight from Moonton's own servers (no third-party relay).

The same two hosts the official mobilelegends.com academy site uses:

* ``sg-api.mobilelegends.com``            — in-game-mail code, login, profile, logout (form POST)
* ``app.web.moontontech.com/actgateway``  — the battle report: career stats, seasons, recent matches,
                                             most-played heroes (GET with the session token)

Endpoint list cross-checked against github.com/mahsikit/mlbb-api-own (docs/context.md) and the
Rone Arena API, which relays the very same calls. The session token (JWT) a player gets here is the
one both of those use, so a link made here keeps working if the backup relay has to step in.

Every function returns Moonton's own envelope ``{"code", "data", "msg"}``. Network trouble raises
``SourceDown`` so the caller can try the backup; an answer with ``code != 0`` (wrong code, expired
session…) is returned as-is because asking someone else won't change it.
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

AUTH_BASE = os.getenv("MLBB_AUTH_BASE", "https://sg-api.mobilelegends.com").rstrip("/")
STATS_BASE = os.getenv("MLBB_STATS_BASE", "https://app.web.moontontech.com/actgateway").rstrip("/")
# getBaseInfo answers only with the academy's app ids attached
ACT_ID, APP_ID = "2728785", "2713644"
TIMEOUT = float(os.getenv("MLBB_TIMEOUT", "12"))
MAX_BYTES = 2_000_000
SEASON_TTL = 3600

_AGENTS = (
    "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
)


class SourceDown(RuntimeError):
    """Moonton couldn't be reached or answered with something that isn't its envelope."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # a session token must never follow a redirect to another host
    def redirect_request(self, *args, **kwargs):  # noqa: ANN002, ANN003
        return None


def _headers(jwt: str | None = None, *, form: bool = False, info: bool = False, lang: str = "en") -> dict[str, str]:
    h = {
        "User-Agent": random.choice(_AGENTS),
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://www.mobilelegends.com",
        "Referer": "https://www.mobilelegends.com/",
    }
    if form:
        h["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8"
    if jwt:
        h["authorization"] = jwt   # raw token, no "Bearer"
        h["x-token"] = jwt
    if info:
        h["x-actid"], h["x-appid"] = ACT_ID, APP_ID
    if lang and lang != "en":
        h["x-lang"] = lang
    return h


def _send(req: urllib.request.Request) -> dict:
    try:
        with urllib.request.build_opener(_NoRedirect()).open(req, timeout=TIMEOUT) as resp:
            body = resp.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read(MAX_BYTES + 1)
            env = json.loads(body)
            if isinstance(env, dict) and "code" in env and exc.code < 500:
                return env
        except (ValueError, OSError):
            pass
        raise SourceDown(f"HTTP {exc.code}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise SourceDown(str(getattr(exc, "reason", exc))[:120]) from None
    if len(body) > MAX_BYTES:
        raise SourceDown("response too large")
    try:
        env = json.loads(body)
    except ValueError:
        raise SourceDown("not JSON") from None
    if not isinstance(env, dict) or "code" not in env:
        raise SourceDown("unexpected answer")
    return env


def _post(path: str, form: dict[str, Any], jwt: str | None = None, *, info: bool = False, lang: str = "en") -> dict:
    data = urllib.parse.urlencode({k: v for k, v in form.items() if v is not None}).encode()
    req = urllib.request.Request(f"{AUTH_BASE}/{path}", data=data, method="POST",
                                 headers=_headers(jwt, form=True, info=info, lang=lang))
    return _send(req)


def _get(path: str, jwt: str, params: dict[str, Any] | None = None, *, lang: str = "en") -> dict:
    qs = urllib.parse.urlencode({k: v for k, v in (params or {}).items() if v is not None})
    req = urllib.request.Request(f"{STATS_BASE}/{path}" + (f"?{qs}" if qs else ""), method="GET", headers=_headers(jwt, lang=lang))
    return _send(req)


# ---------------------------------------------------------------------------------------------- #
# sign-in
# ---------------------------------------------------------------------------------------------- #
def send_code(role_id: int, zone_id: int) -> dict:
    return _post("base/sendVc", {"roleId": role_id, "zoneId": zone_id})


def login(role_id: int, zone_id: int, code: str) -> dict:
    return _post("base/login", {"roleId": role_id, "zoneId": zone_id, "vc": code, "referer": "academy", "type": "web"})


def logout(jwt: str, role_id: int | None = None, zone_id: int | None = None) -> dict:
    return _post("base/logout", {"roleId": role_id, "zoneId": zone_id}, jwt)


def profile(jwt: str, role_id: int | None = None, zone_id: int | None = None, lang: str = "en") -> dict:
    return _post("base/getBaseInfo", {"roleId": role_id, "zoneId": zone_id}, jwt, info=True, lang=lang)


# ---------------------------------------------------------------------------------------------- #
# battle report
# ---------------------------------------------------------------------------------------------- #
def career(jwt: str, lang: str = "en") -> dict:
    return _get("battlereport/stats", jwt, lang=lang)


def seasons(jwt: str, lang: str = "en") -> dict:
    return _get("battlereport/season/list", jwt, lang=lang)


_season_cache: dict[str, tuple[float, int | None]] = {}
_season_lock = threading.Lock()


def season_ids(env: dict) -> list[int]:
    """Season ids from a season-list or career answer, newest first."""
    data = env.get("data")
    raw = data.get("sids") if isinstance(data, dict) else data if isinstance(data, list) else None
    ids = []
    for v in raw or []:
        try:
            ids.append(int(v.get("sid") if isinstance(v, dict) else v))
        except (TypeError, ValueError, AttributeError):
            continue
    return sorted(set(ids), reverse=True)


def current_season(jwt: str, lang: str = "en") -> int | None:
    """The newest season this account has, cached per session for an hour."""
    key = hashlib.sha256(jwt.encode()).hexdigest()
    now = time.monotonic()
    with _season_lock:
        hit = _season_cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
    env = seasons(jwt, lang)
    ids = season_ids(env) if env.get("code") == 0 else []
    if not ids:
        alt = career(jwt, lang)
        ids = season_ids(alt) if alt.get("code") == 0 else []
    sid = ids[0] if ids else None
    with _season_lock:
        if len(_season_cache) > 500:
            _season_cache.clear()
        _season_cache[key] = (now + SEASON_TTL, sid)
    return sid


def recent_matches(jwt: str, *, sid: int | None = None, limit: int = 20, page: int = 1, lang: str = "en") -> dict:
    """Recent games. Upstream pages with a cursor, so page N walks N-1 pages first."""
    sid = sid or current_season(jwt, lang)
    cursor: Any = None
    env: dict = {}
    for _ in range(max(1, page)):
        env = _get("battlereport/matches/recent", jwt, {"sid": sid, "limit": limit, "last_cursor": cursor}, lang=lang)
        if env.get("code") != 0:
            return env
        data = env.get("data") if isinstance(env.get("data"), dict) else {}
        cursor = (data.get("pageInfo") or {}).get("nextCursor") if isinstance(data.get("pageInfo"), dict) else None
        if not cursor:
            break
    if isinstance(env.get("data"), dict):
        env["data"]["sid"] = sid
    return env


def frequent_heroes(jwt: str, *, sid: int | None = None, limit: int = 20, lang: str = "en") -> dict:
    sid = sid or current_season(jwt, lang)
    env = _get("battlereport/heros/frequent", jwt, {"sid": sid, "limit": limit}, lang=lang)
    if isinstance(env.get("data"), dict):
        env["data"]["sid"] = sid
    return env


def match_detail(jwt: str, match_id: str, sid: int, lang: str = "en") -> dict:
    return _get(f"battlereport/matches/{urllib.parse.quote(str(match_id))}", jwt, {"sid": sid}, lang=lang)


# ---------------------------------------------------------------------------------------------- #
# helpers shared with the backup relay (it hands back the same raw Moonton answers)
# ---------------------------------------------------------------------------------------------- #
def token_ids(jwt: str) -> tuple[int | None, int | None]:
    """roleId/zoneId carried inside the session token (read only, never trusted for access)."""
    import base64

    try:
        part = jwt.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        ext = claims.get("Ext") or claims.get("ext") or {}
        return int(ext.get("roleId")), int(ext.get("zoneId"))
    except Exception:  # noqa: BLE001 - any malformed token just means "unknown"
        return None, None


def _num(v: Any) -> float | None:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if n == n else None


def _int(v: Any) -> int | None:
    n = _num(v)
    return int(n) if n is not None else None


def _hero(row: dict) -> tuple[str | None, str | None]:
    e = row.get("hid_e") if isinstance(row.get("hid_e"), dict) else {}
    name = e.get("n") or e.get("name")
    icon = e.get("ix") or e.get("i2x")
    return (str(name) if name else None), (str(icon) if icon else None)


LANES = {1: "EXP", 2: "Gold", 3: "Mid", 4: "Jungle", 5: "Roam"}


def _rate(wins: Any, total: Any) -> float | None:
    w, t = _num(wins), _num(total)
    return round(100 * w / t, 1) if w is not None and t else None


def _match_row(r: dict) -> dict:
    name, icon = _hero(r)
    k, d, a = _int(r.get("k")), _int(r.get("d")), _int(r.get("a"))
    res = _int(r.get("res"))
    out = {
        "hero_name": name, "hero_id": _int(r.get("hid")), "hero_icon": icon,
        "result": "win" if res == 1 else "loss" if res == 0 else None,
        "kills": k, "deaths": d, "assists": a,
        "kda": round(((k or 0) + (a or 0)) / max(1, d or 0), 2) if k is not None else None,
        "mvp": 1 if _int(r.get("mvp")) == 1 else 0,
        "score": _num(r.get("s")),
        "lane": LANES.get(_int(r.get("lid")) or 0),
        "match_time": _int(r.get("ts")),
        "match_id": str(r.get("bid_s") or r.get("bid") or "") or None,
        "season_id": _int(r.get("sid")),
    }
    return {k2: v for k2, v in out.items() if v is not None}


def _hero_row(r: dict) -> dict:
    name, icon = _hero(r)
    out = {
        "hero_name": name, "hero_id": _int(r.get("hid")), "hero_icon": icon,
        "matches": _int(r.get("tc")), "wins": _int(r.get("wc")),
        "win_rate": _rate(r.get("wc"), r.get("tc")),
        "best_score": _num(r.get("bs")), "rating": _num(r.get("mr")),
    }
    return {k: v for k, v in out.items() if v is not None}


_HIGHS = {"hk": "most_kills", "ma": "most_assists", "mg": "most_gold", "mtd": "most_damage",
          "mdt": "most_damage_taken", "ms": "best_score"}


def _rows(data: Any) -> list[dict]:
    if isinstance(data, list):
        return [r for r in data if isinstance(r, dict)]
    if isinstance(data, dict):
        for key in ("result", "records", "list"):
            if isinstance(data.get(key), list):
                return [r.get("data") if isinstance(r.get("data"), dict) and "hid" not in r else r
                        for r in data[key] if isinstance(r, dict)]
    return []


def friendly(kind: str, env: dict) -> dict:
    """Turn Moonton's short battle-report keys into the readable shape the app, its charts and the
    coach read (``data.records`` rows with kills/wins/hero_name…). Non-success answers pass through."""
    if not isinstance(env, dict) or env.get("code") != 0:
        return env
    data = env.get("data")
    if kind == "matches":
        page = data.get("pageInfo") if isinstance(data, dict) and isinstance(data.get("pageInfo"), dict) else {}
        rows = [_match_row(r) for r in _rows(data)]
        wins = sum(1 for r in rows if r.get("result") == "win")
        body = {"records": rows, "games": len(rows), "wins": wins, "win_rate": _rate(wins, len(rows)),
                "season_id": data.get("sid") if isinstance(data, dict) else None,
                "has_more": bool(page.get("nextCursor"))}
    elif kind == "heroes":
        rows = [_hero_row(r) for r in _rows(data)]
        body = {"records": rows, "season_id": data.get("sid") if isinstance(data, dict) else None}
    elif kind == "stats" and isinstance(data, dict):
        body = {"matches": _int(data.get("tc")), "wins": _int(data.get("wc")),
                "losses": (_int(data.get("tc")) or 0) - (_int(data.get("wc")) or 0) if data.get("tc") is not None else None,
                "win_rate": _rate(data.get("wc"), data.get("tc")), "mvp_count": _int(data.get("mvpc")),
                "best_streak": _int(data.get("wsc")), "avg_score": _num(data.get("as")),
                "avg_game_minutes": round(_num(data.get("gt")) / 60, 1) if _num(data.get("gt")) else None}
        for key, label in _HIGHS.items():
            v = data.get(key)
            body[label] = _num(v.get("v")) if isinstance(v, dict) else _num(v)
        body = {k: v for k, v in body.items() if v is not None}
    elif kind == "season":
        ids = season_ids(env)
        body = {"current_season": ids[0] if ids else None, "seasons": ", ".join(map(str, ids[:8])) or None}
        body = {k: v for k, v in body.items() if v is not None}
    else:
        return env
    return {"code": 0, "msg": env.get("msg") or "ok", "data": body}
