"""Small, source-dated projections of persisted MLBB snapshots for AI.

These projections never include credentials, teammate records or entire source
payloads. Source text is untrusted and is not an instruction to the model.
"""

from __future__ import annotations

import math
import re
from datetime import timedelta
from typing import Any
from urllib.parse import parse_qs

from sqlalchemy import func
from sqlalchemy.orm import Session

from .aerena_models import AerenaMatch, AerenaSyncState
from .intel_cache import IntelSnapshot, decode_snapshot
from .models import Hero, utcnow

_ACCOUNT_REQUEST = re.compile(
    r"\b(my|mine|me|i|i'm|ive|i've)\b.*\b(account|mlbb|stats?|statistics|matches|match|games?|history|heroes|hero|rank|played|play|performance|results?|win.?rate)\b"
    r"|\b(account|mlbb|stats?|statistics|matches|match|games?|history|heroes|hero|rank|performance|results?)\b.*\b(my|mine|me|i)\b",
    re.I,
)
_ACCOUNT_NUMBER_FIELDS = {
    "level",
    "rank_level",
    "history_rank_level",
    "rank_points",
    "stars",
    "matches",
    "match_count",
    "total_matches",
    "games",
    "game_count",
    "wins",
    "losses",
    "win_count",
    "lose_count",
    "win_rate",
    "winrate",
    "pick_rate",
    "kills",
    "deaths",
    "assists",
    "kda",
    "mvp",
    "mvp_count",
    "gold",
    "damage",
    "damage_dealt",
    "damage_taken",
    "duration",
    "duration_seconds",
    "match_time",
    "time",
    "season_id",
    "hero_id",
    "heroid",
}
_ACCOUNT_TEXT_FIELDS = {"hero_name", "result", "mode", "game_mode"}
_RESULTS = {"win", "won", "victory", "loss", "lost", "lose", "defeat", "draw"}
_MODES = {"ranked", "classic", "brawl", "custom", "vs ai", "arcade"}
_ACCOUNT_PATHS = {
    "user/info": "profile",
    "user/season": "season",
    "user/stats": "stats",
    "user/heroes/frequent": "frequent_heroes",
    "user/matches": "recent_matches",
}


def wants_account(question: str) -> bool:
    return bool(_ACCOUNT_REQUEST.search(question))


def esports_availability(db: Session) -> tuple[dict, list[dict]]:
    count, latest = db.query(func.count(AerenaMatch.id), func.max(AerenaMatch.fetched_at)).one()
    feed_count, feed_latest = (
        db.query(func.count(IntelSnapshot.key), func.max(IntelSnapshot.observed_at))
        .filter(IntelSnapshot.scope == "public", IntelSnapshot.path.like("esports/%"))
        .one()
    )
    state = db.get(AerenaSyncState, 1)
    fact = {
        "saved_aerena_match_count": count,
        "most_recent_match_snapshot_at": latest.isoformat() + "Z" if latest else None,
        "last_successful_aerena_sync_at": (
            state.last_success_at.isoformat() + "Z" if state and state.last_success_at else None
        ),
        "saved_rone_feed_count": feed_count,
        "most_recent_rone_snapshot_at": feed_latest.isoformat() + "Z" if feed_latest else None,
        "notice": "These are local community data counts, not proof that a particular team, season or current match is covered. "
        "Use only supplied records and dates; missing results remain unknown.",
    }
    sources = []
    if count or feed_count:
        observed = max((item for item in (latest, feed_latest) if item is not None), default=None)
        sources.append(
            {
                "kind": "esports_feed",
                "label": "Saved esports database availability",
                "route": "esports",
                "observed_at": observed.isoformat() + "Z" if observed else None,
            }
        )
    return fact, sources


def queue_relevant_refreshes(
    db: Session, user_id: int, question: str, facts: dict, background_tasks
) -> None:  # noqa: ANN001
    """Refresh stale saved evidence after the answer, with the shared cache leases.

    Only public game-source keys are refreshed; chat never requests Rone player
    or account endpoints. Opted-in member information is read from app data.
    """
    from uuid import uuid4
    from . import ai_rone
    from .ai_game_sources import _public_hero_slug
    from .intel_cache import claim_refresh, snapshot_key
    from .routers.intel import CACHE_TTL, LONG_TTL, SAFE_PATH, _refresh_public_snapshot

    candidates: list[tuple[IntelSnapshot, int]] = []
    requested = ai_rone.requested_feed(question)
    if requested and (facts.get("rone_public_mpl") or {}).get("status") == "saved":
        region, view = requested
        row = db.get(IntelSnapshot, snapshot_key("public", f"esports/{region}/{view}"))
        if row:
            candidates.append((row, LONG_TTL if view in {"standings", "playoffs"} else CACHE_TTL))
    for hero in facts.get("hero_library", [])[:4]:
        kit = hero.get("saved_rone_skills") or {}
        if not kit.get("stale"):
            continue
        name = hero.get("name")
        if not isinstance(name, str) or not _public_hero_slug(name):
            continue  # Never send an arbitrary team-created name upstream.
        path = f"heroes/{name}"
        if not SAFE_PATH.fullmatch(path) or any(part in {"", ".", ".."} for part in path.split("/")):
            continue
        row = (
            db.query(IntelSnapshot)
            .filter(
                IntelSnapshot.scope == "public",
                IntelSnapshot.owner_id.is_(None),
                func.lower(IntelSnapshot.path) == path.lower(),
            )
            .order_by(IntelSnapshot.observed_at.desc())
            .first()
        )
        if row:
            candidates.append((row, CACHE_TTL))
    for row, ttl in candidates[:10]:
        if row.observed_at + timedelta(seconds=ttl) > utcnow():
            continue
        # Query strings come from previously validated cache keys; reject any
        # credential-like parameters defensively before queuing network work.
        if any(
            key.casefold() in {"token", "access_token", "jwt", "authorization", "api_key", "password", "vc"}
            for key in parse_qs(row.query, keep_blank_values=True)
        ):
            continue
        key, path, query = row.key, row.path, row.query
        token = uuid4().hex
        if claim_refresh(db, key, token) and row.scope == "public":
            background_tasks.add_task(_refresh_public_snapshot, db.get_bind(), key, path, query, token)


def equipment_evidence(db: Session, question: str) -> tuple[dict | None, list[dict]]:
    """Project only a small relevant sample of explicitly team-maintained items."""
    from .platform_data import TeamEquipment

    words = question.casefold()
    rows = db.query(TeamEquipment).order_by(TeamEquipment.name).limit(500).all()
    selected = [row for row in rows if re.search(r"(?<!\w)" + re.escape(row.name.casefold()) + r"(?!\w)", words)]
    exact = bool(selected)
    general = bool(re.search(r"\b(items?|equipment|gear|builds?)\b", words))
    if not selected and not general:
        return None, []
    if not selected:
        selected = rows[:5]
    if not selected:
        return {"entries": [], "notice": "No team-maintained equipment is saved; do not invent a record."}, []
    entries = [
        {
            "name": row.name,
            "category": row.category or None,
            "description": row.description[:700],
            "patch_label": row.patch or None,
            "source_url": row.source_url or None,
            "updated_at": row.updated_at.isoformat() + "Z",
        }
        for row in selected[:5]
    ]
    return {
        "entries": entries,
        "truncated": len(selected) > 5 or (general and len(rows) > len(selected)),
        "notice": "Team-maintained and not an official or independently verified game feed; a patch label is not proof of current balance. "
        + ("Exact item-name matches." if exact else "This is an alphabetical sample, not a recommended build."),
    }, [
        {
            "kind": "team_item",
            "label": f"Team equipment: {row.name}",
            "route": "intel/equipment",
            "observed_at": row.updated_at.isoformat() + "Z",
        }
        for row in selected[:5]
    ]


def _plain(value: Any, limit: int) -> str:
    if not isinstance(value, str) or value.startswith("@"):
        return ""
    value = re.sub(r"<[^>]*>", "", value)
    return " ".join(value.split())[:limit]


def _number(value: Any) -> int | float | str | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        try:
            return value if math.isfinite(value) and abs(value) <= 1_000_000_000_000 else None
        except OverflowError:
            return None
    if isinstance(value, str) and re.fullmatch(r"-?\d{1,12}(?:\.\d{1,4})?%?", value.strip()):
        return value.strip()
    return None


def _project_account(row: dict, hero_names: dict[str, str]) -> dict:
    result: dict[str, Any] = {}
    for key, value in list(row.items())[:100]:
        if not isinstance(key, str):
            continue
        normalized = re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower()
        if normalized in _ACCOUNT_NUMBER_FIELDS:
            number = _number(value)
            if number is not None:
                result[normalized] = number
        elif normalized in _ACCOUNT_TEXT_FIELDS:
            text = _plain(value, 80)
            if normalized == "hero_name" and text.casefold() in hero_names:
                result[normalized] = hero_names[text.casefold()]
            elif normalized == "result" and text.casefold() in _RESULTS:
                result[normalized] = text
            elif normalized in {"mode", "game_mode"} and text.casefold() in _MODES:
                result[normalized] = text
    # Only locally recognized hero labels; generic names may be other players' identities.
    hero = row.get("hero")
    if isinstance(hero, dict):
        hero = hero.get("data") if isinstance(hero.get("data"), dict) else hero
        name = _plain(hero.get("name") or hero.get("hero_name"), 80)
        if name.casefold() in hero_names:
            result.setdefault("hero_name", hero_names[name.casefold()])
    return result


def _account_rows(payload: Any, hero_names: dict[str, str]) -> list[dict]:
    if not isinstance(payload, dict):
        return []
    data = payload.get("data")
    if isinstance(data, dict) and isinstance(data.get("records"), list):
        data = data["records"]
    if isinstance(data, list):
        rows = data[:25]
    elif isinstance(data, dict):
        rows = [data]
    else:
        rows = []
    output = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        row = item.get("data") if isinstance(item.get("data"), dict) else item
        projected = _project_account(row, hero_names)
        if projected:
            output.append(projected)
    return output


def account_evidence(db: Session, user_id: int, generation_id: str) -> tuple[dict, list[dict]]:
    rows = (
        db.query(IntelSnapshot)
        .filter(
            IntelSnapshot.scope == "account",
            IntelSnapshot.owner_id == user_id,
            IntelSnapshot.generation_id == generation_id,
            IntelSnapshot.path.in_(_ACCOUNT_PATHS),
        )
        .order_by(IntelSnapshot.observed_at.desc())
        .limit(30)
        .all()
    )
    entries, sources, seen = [], [], set()
    hero_names = {name.casefold(): name for (name,) in db.query(Hero.name).limit(500).all() if isinstance(name, str)}
    for row in rows:
        kind = _ACCOUNT_PATHS[row.path]
        if kind in seen:
            continue
        if kind == "recent_matches" and parse_qs(row.query).get("index", ["1"])[0] != "1":
            continue  # Another page is not the latest match sample.
        try:
            projected = _account_rows(decode_snapshot(row), hero_names)
        except (ValueError, TypeError):
            continue
        seen.add(kind)
        limit = 8 if kind == "recent_matches" else 10 if kind == "frequent_heroes" else 1
        observed = row.observed_at.isoformat() + "Z"
        entries.append(
            {
                "kind": kind,
                "saved_at": observed,
                "stale": row.observed_at + timedelta(minutes=5) < utcnow(),
                "entries": projected[:limit],
                "truncated": len(projected) > limit,
            }
        )
        sources.append(
            {
                "kind": "personal",
                "label": f"Your saved MLBB {kind.replace('_', ' ')}",
                "route": "mlbb",
                "observed_at": observed,
            }
        )
    return (
        {
            "snapshots": entries,
            "notice": "Only fields from this member's opted-in saved account feed are included. The upstream schema can be ambiguous; "
            "do not attribute a statistic to the member unless the source supports it. Data may be incomplete or stale; "
            "other players, credentials and unrecognized fields are excluded. Empty entries are not proof of no games.",
        },
        sources,
    )


def _find_kits(node: Any, depth: int = 0) -> tuple[list, dict] | None:
    if depth > 7:
        return None
    if isinstance(node, list):
        for item in node[:30]:
            found = _find_kits(item, depth + 1)
            if found:
                return found
    elif isinstance(node, dict):
        if isinstance(node.get("heroskilllist"), list) and node["heroskilllist"]:
            return node["heroskilllist"], node
        for key in ("data", "records", "hero"):
            found = _find_kits(node.get(key), depth + 1)
            if found:
                return found
    return None


def _resolve(value: Any, roots: list[dict]) -> str:
    if not isinstance(value, str):
        return ""
    if not value.startswith("@"):
        return value
    parts = value[1:].split(".")
    if len(parts) > 6:
        return ""
    for root in roots:
        current: Any = root
        for part in parts:
            current = current.get(part) if isinstance(current, dict) else None
        if isinstance(current, str) and current != value:
            return current
    return ""


def hero_evidence(db: Session, hero_name: str) -> tuple[dict | None, dict | None]:
    canonical = re.sub(r"[^a-z0-9]", "", hero_name.casefold())
    paths = {f"heroes/{hero_name}".lower(), f"heroes/{canonical}"}
    row = (
        db.query(IntelSnapshot)
        .filter(
            IntelSnapshot.scope == "public",
            IntelSnapshot.owner_id.is_(None),
            func.lower(IntelSnapshot.path).in_(paths),
        )
        .order_by(IntelSnapshot.observed_at.desc())
        .first()
    )
    if not row:
        return None, None
    try:
        found = _find_kits(decode_snapshot(row))
    except (ValueError, TypeError):
        return None, None
    if not found:
        return None, None
    kits, host = found
    skills = []
    for kit in kits[:3]:
        if not isinstance(kit, dict) or not isinstance(kit.get("skilllist"), list):
            continue
        for raw in kit["skilllist"][:8]:
            if not isinstance(raw, dict):
                continue
            skill = raw if "skillname" in raw else raw.get("data")
            if not isinstance(skill, dict):
                continue
            name = _plain(_resolve(skill.get("skillname"), [skill, host]), 100)
            description = _plain(_resolve(skill.get("skilldesc"), [skill, host]), 400)
            if name:
                skills.append({"name": name, "description": description or None})
            if len(skills) >= 8:
                break
        if len(skills) >= 8:
            break
    if not skills:
        return None, None
    observed = row.observed_at.isoformat() + "Z"
    fact = {
        "saved_at": observed,
        "stale": row.observed_at + timedelta(hours=1) < utcnow(),
        "skills": skills,
        "notice": "Community Rone snapshot, possibly incomplete or outdated; not a verified current patch.",
    }
    source = {"kind": "hero", "label": f"{hero_name} · saved Rone skills", "observed_at": observed}
    return fact, source
