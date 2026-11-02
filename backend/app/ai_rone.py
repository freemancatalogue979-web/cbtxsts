"""Bounded public Rone MPL context for explicit region/feed questions.

No member question, personal data or team board is sent to Rone: the request
contains only one allowlisted region and feed. Source coverage may be stale or
incomplete; in particular the feed may not identify its season.
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any

from .esports_ai import _NoRedirect
from .models import utcnow
from .routers.intel import BASE_URL

MAX_BYTES = 512_000
CACHE_SECONDS = 180
FAILURE_COOLDOWN = 30
_CACHE: dict[str, tuple[float, dict]] = {}
_FAILURES: dict[str, float] = {}
_REGIONS = {
    "ph": r"\b(?:philippines?|filipino)\b",
    "id": r"\b(?:indonesia(?:n)?)\b",
    "my": r"\b(?:malaysia(?:n)?)\b",
    "kh": r"\b(?:cambodia(?:n)?)\b",
}
_LOCKS = {(region, view): Lock() for region in _REGIONS for view in ("standings", "schedule", "playoffs")}


def requested_region(question: str) -> str | None:
    if not re.search(r"\bmpl\b", question, re.I):
        return None
    regions = {region for region, pattern in _REGIONS.items() if re.search(pattern, question, re.I)}
    regions.update(code.lower() for code in re.findall(r"\bmpl[\s-]+(ph|id|my|kh)\b", question, re.I))
    # Require uppercase before MPL so ordinary phrases like "my MPL PH" do
    # not silently select Malaysia or make an otherwise clear PH query ambiguous.
    regions.update(code.lower() for code in re.findall(r"\b(PH|ID|MY|KH)[\s-]+MPL\b", question))
    return next(iter(regions)) if len(regions) == 1 else None


def requested_feed(question: str) -> tuple[str, str] | None:
    region = requested_region(question)
    if region is None:
        return None
    if re.search(r"\b(standing|standings|table|rankings?|points)\b", question, re.I):
        view = "standings"
    elif re.search(r"\b(play[\s-]?offs?|bracket)\b", question, re.I):
        view = "playoffs"
    elif re.search(r"\b(schedule|fixtures?|matches|match|games?|next|upcoming|results?)\b", question, re.I):
        view = "schedule"
    else:
        return None
    return region, view


def _dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _list(value: Any, limit: int) -> list[dict]:
    return [item for item in value[:limit] if isinstance(item, dict)] if isinstance(value, list) else []


def _str(value: Any, limit: int = 120) -> str | None:
    return value.strip()[:limit] if isinstance(value, str) and value.strip() else None


def _number(value: Any) -> int | float | None:
    # Unknown stays unknown, never zero-filled or guessed.
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not (-1_000_000 <= value <= 1_000_000):
        return None
    return value


def _team(value: Any) -> str | None:
    if isinstance(value, str):
        return _str(value)
    team = _dict(value)
    return _str(team.get("name")) or _str(team.get("team_name")) or _str(team.get("full_name"))


def _match(row: dict, label: Any, week: Any) -> dict:
    return {
        "match_id": _str(row.get("match_id")),
        "week": _number(week),
        "date_label": _str(label, 100),
        "starts_at": _str(row.get("start_at"), 80),
        "local_time": _str(row.get("local_time"), 40),
        "team1": _team(row.get("team1") or row.get("home") or row.get("team_a")),
        "team2": _team(row.get("team2") or row.get("away") or row.get("team_b")),
        "score1": _number(row.get("score1")),
        "score2": _number(row.get("score2")),
        "status": _str(row.get("status"), 40),
        "winner_side": (
            row.get("winner")
            if isinstance(row.get("winner"), str) and row.get("winner") in {"team1", "team2"}
            else None
        ),
        "round": _str(row.get("round"), 100),
        "best_of": _number(row.get("best_of")),
    }


def _evidence(payload: dict, region: str, view: str, question: str, observed: str) -> dict:
    root = _dict(payload.get("data")) if isinstance(payload.get("data"), dict) else payload
    result: dict[str, Any] = {
        "source": "Rone public MPL feed",
        "region": region.upper(),
        "view": view,
        "retrieved_at": observed,
        "season": _str(root.get("season")),
        "notice": "Community feed, potentially incomplete or stale. If season or dates are absent, they are unknown. Do not infer draft order.",
    }
    if view == "standings":
        rows = _list(root.get("standings"), 30)
        result["standings"] = [
            {
                "rank": _number(row.get("rank")),
                "team": _team(row.get("team")),
                "points": _number(row.get("match_point")),
                "match_wins": _number(_dict(row.get("match_wl")).get("win")),
                "match_losses": _number(_dict(row.get("match_wl")).get("lose")),
                "game_wins": _number(_dict(row.get("game_wl")).get("win")),
                "game_losses": _number(_dict(row.get("game_wl")).get("lose")),
                "net_game_wins": _number(row.get("net_game_win")),
            }
            for row in rows[:16]
        ]
        result["truncated"] = len(rows) > 16
        return result
    matches = []
    if isinstance(root.get("weeks"), list):
        for week in _list(root["weeks"], 40):
            for day in _list(week.get("days"), 15):
                matches.extend(_match(row, day.get("label"), week.get("week")) for row in _list(day.get("matches"), 30))
    elif isinstance(root.get("days"), list):
        for day in _list(root["days"], 80):
            matches.extend(_match(row, day.get("label"), None) for row in _list(day.get("matches"), 30))
    else:
        matches.extend(_match(row, None, None) for row in _list(root.get("matches") or root.get("schedule"), 200))
    # Prioritize explicitly mentioned teams and the requested time direction,
    # but retain only actual source rows. ISO dates that cannot be parsed remain unknown.
    words = set(re.findall(r"[\w-]{3,}", question.casefold()))

    def team_hit(row: dict) -> bool:
        return any(name and name.casefold() in words for name in (row["team1"], row["team2"]))

    mentioned = [row for row in matches if team_hit(row)]
    if mentioned:
        matches = mentioned
    future = bool(re.search(r"\b(next|upcoming|schedule|fixtures?)\b", question, re.I))
    if future:
        now = datetime.now(timezone.utc)

        def is_future(row: dict) -> bool:
            try:
                value = datetime.fromisoformat((row["starts_at"] or "").replace("Z", "+00:00"))
                return value.tzinfo is not None and value >= now
            except ValueError:
                return False

        matches = [row for row in matches if is_future(row)]
    result["matches"] = matches[:12] if future else matches[-12:]
    result["truncated"] = len(matches) > 12
    if view == "playoffs":
        result["seeds"] = [
            {"seed": _number(row.get("seed")), "team": _team(row.get("team"))} for row in _list(root.get("seeds"), 16)
        ]
    return result


def saved_feed(db, question: str) -> tuple[dict | None, list[dict]]:  # noqa: ANN001
    """Use the same durable public snapshot shown on the Rone page, if present."""
    from .intel_cache import IntelSnapshot, decode_snapshot, snapshot_key
    from .routers.intel import CACHE_TTL, LONG_TTL

    requested = requested_feed(question)
    if requested is None:
        return None, []
    region, view = requested
    row = db.get(IntelSnapshot, snapshot_key("public", f"esports/{region}/{view}"))
    if not row:
        return None, []
    try:
        payload = decode_snapshot(row)
        root = _dict(payload.get("data")) if isinstance(payload, dict) and isinstance(payload.get("data"), dict) else payload
        expected = {"standings": ("standings",), "schedule": ("weeks", "matches", "schedule"),
                    "playoffs": ("days", "matches", "seeds")}[view]
        if not isinstance(root, dict) or not any(isinstance(root.get(key), list) for key in expected):
            return None, []
        observed = row.observed_at.isoformat() + "Z"
        evidence = _evidence(payload, region, view, question, observed)
    except (ValueError, TypeError):
        return None, []
    ttl = LONG_TTL if view in {"standings", "playoffs"} else CACHE_TTL
    evidence.update(status="saved", stale=row.observed_at + timedelta(seconds=ttl) < utcnow(),
                    refresh_failed=bool(row.last_error))
    evidence["notice"] += " This is a saved snapshot, not proof of live or current-season coverage."
    return evidence, [{"kind": "esports_feed", "label": f"Saved Rone MPL {region.upper()} · {view}",
                       "observed_at": observed, "route": "esports"}]


def lookup(question: str, db=None) -> tuple[dict | None, list[dict], str]:  # noqa: ANN001
    requested = requested_feed(question)
    if requested is None:
        return None, [], ""
    region, view = requested
    url = f"{BASE_URL}/esports/{region}/{view}"
    # A per-feed lock and a short failure cooldown prevent a burst of members
    # from repeatedly hammering a slow or unavailable public service.
    with _LOCKS[(region, view)]:
        now = time.monotonic()
        cached = _CACHE.get(url)
        if cached and now - cached[0] < CACHE_SECONDS:
            payload, observed = cached[1], cached[1]["_observed_at"]
        elif now < _FAILURES.get(url, 0):
            return (
                {"status": "unavailable", "region": region.upper(), "view": view},
                [],
                "The public MPL feed could not be retrieved.",
            )
        else:
            request = urllib.request.Request(
                url, headers={"Accept": "application/json", "User-Agent": "9clover-hub/1.0"}
            )
            try:
                with urllib.request.build_opener(_NoRedirect()).open(request, timeout=8) as response:
                    raw = response.read(MAX_BYTES + 1)
                if len(raw) > MAX_BYTES:
                    raise ValueError("oversized response")
                payload = json.loads(raw)
                if not isinstance(payload, dict) or payload.get("code", 0) not in {0, None}:
                    raise ValueError("invalid feed")
                root = _dict(payload.get("data")) if isinstance(payload.get("data"), dict) else payload
                expected = {
                    "standings": ("standings",),
                    "schedule": ("weeks", "matches", "schedule"),
                    "playoffs": ("days", "matches", "seeds"),
                }[view]
                if not any(isinstance(root.get(key), list) for key in expected):
                    raise ValueError("unrecognized feed")
                observed = utcnow().isoformat() + "Z"
                payload = {**payload, "_observed_at": observed}
                _CACHE[url] = (time.monotonic(), payload)
                _FAILURES.pop(url, None)
            except (urllib.error.URLError, TimeoutError, OSError, ValueError, TypeError):
                _FAILURES[url] = time.monotonic() + FAILURE_COOLDOWN
                return (
                    {"status": "unavailable", "region": region.upper(), "view": view},
                    [],
                    "The public MPL feed could not be retrieved.",
                )
    if db is not None:
        from .intel_cache import save_snapshot
        try:
            save_snapshot(db, "public", f"esports/{region}/{view}", "", {k: v for k, v in payload.items() if k != "_observed_at"})
        except Exception:
            db.rollback()  # A valid answer may still use this bounded live result.
    evidence = _evidence(payload, region, view, question, observed)
    evidence["status"] = "ok"
    # Display a direct link only when the configured feed URL is public HTTPS.
    from .clover_ai_service import safe_source_url

    try:
        source_url = safe_source_url(url)
    except ValueError:
        source_url = ""
    if source_url:
        evidence["source_url"] = source_url
    source = {"kind": "esports_feed", "label": f"Rone MPL {region.upper()} · {view}", "observed_at": observed}
    source.update({"url": source_url} if source_url else {"route": "esports"})
    return evidence, [source], ""
