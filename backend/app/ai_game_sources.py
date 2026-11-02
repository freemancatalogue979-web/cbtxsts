"""On-demand public Rone game references for Clover, never player lookups.

Only fixed, allowlisted game-reference paths and canonical hero identifiers are
sent upstream. Member questions, account data, board contents and credentials
are never included in these requests. Projections strip author/player fields.
"""

from __future__ import annotations

import html
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from sqlalchemy.orm import Session

from . import ai_saved
from .ai_esports_analysis import load_rone
from .hero_profiles import PROFILES

REFERENCE_TTL = timedelta(hours=1)
MAX_SOURCE_CALLS = 8
GAME_REFERENCE_DEADLINE_SECONDS = 180
GAME_DATA_INTENT = re.compile(
    r"\b(?:builds?|items?|equipment|gear|emblems?|talents?|spells?)\b", re.I
)
SPELL_INTENT = re.compile(r"\b(?:battle\s+)?spells?\b", re.I)
EMBLEM_INTENT = re.compile(r"\b(?:emblems?|talents?)\b", re.I)
STATS_INTENT = re.compile(
    r"\b(?:rating|ratings|win.?rate|pick.?rate|ban.?rate|ranked|meta|statistics|stats|performance)\b",
    re.I,
)
PATCH_INTENT = re.compile(r"\b(?:patch(?:es)?|patch[ -]?notes?|version(?:s)?)\b", re.I)


def _canonical(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.casefold())[:60]


# Outbound hero identifiers must come from a known public roster, never an
# arbitrary team-created hero name or free text from a private question.
_PUBLIC_HERO_SLUGS = {_canonical(name) for name in PROFILES}


def _public_hero_slug(name: str) -> str:
    candidate = _canonical(name)
    return candidate if candidate in _PUBLIC_HERO_SLUGS else ""


def _plain(value: Any, limit: int = 600) -> str:
    if not isinstance(value, str) or value.startswith("@"):
        return ""
    return " ".join(html.unescape(re.sub(r"<[^>]*>", " ", value)).split())[:limit]


def _records(payload: Any) -> list[dict] | None:
    if not isinstance(payload, dict) or payload.get("code", 0) not in (0, None):
        return None
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    records = data.get("records") if isinstance(data, dict) else None
    if not isinstance(records, list) or len(records) > 350:
        return None
    return [row for row in records if isinstance(row, dict)]


def _data(row: Any) -> dict:
    return (
        row.get("data", {})
        if isinstance(row, dict) and isinstance(row.get("data"), dict)
        else {}
    )


def _valid_hero(payload: Any, name: str) -> bool:
    found = ai_saved._find_kits(payload)
    if not found:
        return False
    _, host = found
    source_name = host.get("name")
    return bool(
        isinstance(source_name, str) and _canonical(source_name) == _canonical(name)
    )


def _rate(value: Any) -> float | None:
    if (
        isinstance(value, bool)
        or not isinstance(value, (float, int))
        or not 0 <= value <= 1
    ):
        return None
    return round(value * 100, 2)


def _iso(observed) -> str | None:  # noqa: ANN001
    return observed.isoformat() + "Z" if observed else None


def _source_timestamp(row: dict) -> str | None:
    # Rone's documented record dates are Unix milliseconds, not seconds.
    value = row.get("createdAt", row.get("_createdAt"))
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 1_000_000_000_000 <= value <= 4_000_000_000_000
    ):
        return None
    return (
        datetime.fromtimestamp(value / 1000, timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _source(
    label: str, path: str, observed, kind: str = "hero"
) -> dict:  # noqa: ANN001
    return {
        "kind": kind,
        "label": label,
        "route": "intel",
        "observed_at": _iso(observed),
        "url": "https://arena.rone.dev/api/" + path,
    }


def _version_projection(payload: Any, observed, state: str) -> dict:
    versions = []
    for row in (_records(payload) or [])[:20]:
        item = _data(row)
        version = _plain(item.get("game_version") or item.get("version"), 40)
        if not version:
            continue
        notes = []
        for key in (
            "patch_notes",
            "notes",
            "changes",
            "description",
            "summary",
            "content",
        ):
            value = item.get(key)
            if isinstance(value, str) and (text := _plain(value, 1800)):
                notes.append(text)
            elif isinstance(value, list):
                notes.extend(
                    _plain(entry, 500) for entry in value[:8] if _plain(entry, 500)
                )
        versions.append(
            {
                "version": version,
                "source_created_at": _source_timestamp(row),
                "notes": notes[:8],
            }
        )
    return {
        "status": (
            "available" if any(row["notes"] for row in versions) else "version_only"
        ),
        "observed_at": _iso(observed),
        "stale": state == "saved_stale",
        "versions": versions,
        "notice": "Rone's game-version feed may expose version labels without full balance notes; do not invent missing changes. Community data may be stale.",
    }


def _build_projection(payload: Any, hero_name: str, observed, state: str) -> dict:
    guides, equip_ids = [], set()
    for row in (_records(payload) or [])[:5]:
        content = _data(row)
        nested = _data(content)
        if not nested:
            continue
        equip = []
        for entry in (
            nested.get("equips", [])[:4]
            if isinstance(nested.get("equips"), list)
            else []
        ):
            if not isinstance(entry, dict):
                continue
            ids = (
                [
                    int(v)
                    for v in entry.get("equip_ids", [])[:8]
                    if isinstance(v, int)
                    and not isinstance(v, bool)
                    and 0 < v < 1_000_000
                ]
                if isinstance(entry.get("equip_ids"), list)
                else []
            )
            equip_ids.update(ids)
            equip.append(
                {
                    "title": _plain(entry.get("equip_title"), 100),
                    "description": _plain(entry.get("equip_desc"), 1200),
                    "item_ids": ids,
                }
            )
        emblems = []
        for entry in (
            nested.get("emblems", [])[:3]
            if isinstance(nested.get("emblems"), list)
            else []
        ):
            if isinstance(entry, dict):
                emblems.append(
                    {
                        "title": _plain(entry.get("emblem_title"), 100),
                        "description": _plain(entry.get("emblem_desc"), 700),
                    }
                )
        spell = nested.get("spell") if isinstance(nested.get("spell"), dict) else {}
        guides.append(
            {
                "title": _plain(nested.get("title") or nested.get("recommend"), 120),
                "game_version": _plain(nested.get("game_version"), 40) or None,
                "equipment": equip,
                "emblems": emblems,
                "spell": (
                    {"description": _plain(spell.get("spell_desc"), 600)}
                    if spell
                    else None
                ),
            }
        )
    return {
        "hero": hero_name,
        "guides": guides[:3],
        "item_ids": sorted(equip_ids),
        "observed_at": _iso(observed),
        "stale": state == "saved_stale",
        "notice": "Community recommendations, not official or guaranteed current. Author and player account fields are excluded.",
    }


def _equipment_projection(
    payload: Any, question: str, wanted_ids: set[int], observed, state: str
) -> dict:
    entries = []
    text = question.casefold()
    for row in _records(payload) or []:
        item = _data(row)
        name = _plain(item.get("equipname"), 120)
        iid = item.get("equipid")
        if not name:
            continue
        if (isinstance(iid, int) and iid in wanted_ids) or re.search(
            r"(?<!\w)" + re.escape(name.casefold()) + r"(?!\w)", text
        ):
            entries.append(
                {
                    "name": name,
                    "item_id": iid if isinstance(iid, int) else None,
                    "type": _plain(item.get("equiptypename"), 60) or None,
                    "description": _plain(item.get("equipskilldesc"), 1200) or None,
                    "tips": _plain(item.get("equiptips"), 350) or None,
                }
            )
    return {
        "entries": entries[:20],
        "catalog_size": len(_records(payload) or []),
        "truncated": len(entries) > 20,
        "observed_at": _iso(observed),
        "stale": state == "saved_stale",
        "notice": "Source equipment descriptions may be incomplete or outdated; an empty match does not prove an item does not exist.",
    }


def _ability_catalog(
    payload: Any, question: str, kind: str, observed, state: str
) -> dict:
    found = []
    for row in _records(payload) or []:
        data = _data(row)
        detail = data.get("__data") if kind == "spells" else data.get("emblemskill")
        detail = detail if isinstance(detail, dict) else {}
        name = _plain(detail.get("skillname") or data.get("skillname"), 100)
        description = _plain(
            detail.get("skilldesc")
            or detail.get("skilldescemblem")
            or data.get("skilldesc"),
            1000,
        )
        if name and description:
            found.append({"name": name, "description": description})
    exact = [
        item
        for item in found
        if re.search(
            r"(?<!\w)" + re.escape(item["name"].casefold()) + r"(?!\w)",
            question.casefold(),
        )
    ]
    return {
        "entries": (exact or found)[:8],
        "exact_name_match": bool(exact),
        "catalog_size": len(found),
        "observed_at": _iso(observed),
        "stale": state == "saved_stale",
        "notice": "Community source; descriptions may be outdated. When no exact name matches, entries are a sample, not recommended choices.",
    }


def _stats_projection(payload: Any, hero_name: str, observed, state: str) -> dict:
    result = []
    for row in (_records(payload) or [])[:5]:
        data = _data(row)
        main = _data(_data(data.get("main_hero")).get("hero"))
        source_name = main.get("name")
        # Do not attribute a rate to the requested hero unless the source
        # record itself identifies that hero; malformed or mismatched rows stay unknown.
        if not isinstance(source_name, str) or _canonical(source_name) != _canonical(
            hero_name
        ):
            continue
        values = {
            "win_rate_percent": _rate(data.get("main_hero_win_rate")),
            "pick_rate_percent": _rate(data.get("main_hero_appearance_rate")),
            "ban_rate_percent": _rate(data.get("main_hero_ban_rate")),
        }
        if any(value is not None for value in values.values()):
            result.append(values)
    return {
        "hero": hero_name,
        "rank_filter": "all ranks",
        "records": result[:2],
        "observed_at": _iso(observed),
        "stale": state == "saved_stale",
        "notice": "Source-reported aggregate rates, not individual-player data. The source may not specify the sample window or patch.",
    }


def enrich(
    db: Session,
    question: str,
    facts: dict,
    on_progress: Callable[[str], None] | None = None,
) -> list[dict]:
    """Load only relevant public game data after consulting saved app evidence."""
    heroes = [
        item
        for item in facts.get("hero_library", [])
        if isinstance(item, dict) and isinstance(item.get("name"), str)
    ][:4]
    wants_patch = bool(PATCH_INTENT.search(question))
    wants_build = bool(GAME_DATA_INTENT.search(question))
    wants_stats = bool(STATS_INTENT.search(question))
    if not (heroes or wants_patch or wants_build):
        return []
    if on_progress:
        on_progress("loading_game_data")
    sources: list[dict] = []
    attempts = failures = 0
    deadline = time.monotonic() + GAME_REFERENCE_DEADLINE_SECONDS

    def fetch(path: str, validate: Callable[[Any], bool], query: str = ""):
        nonlocal attempts, failures
        if (
            attempts >= MAX_SOURCE_CALLS
            or failures >= 2
            or time.monotonic() >= deadline
        ):
            return None, None, "unavailable"
        attempts += 1
        payload, observed, state = load_rone(
            db, path, validate, ttl=REFERENCE_TTL, query=query
        )
        if payload is None:
            failures += 1
        return payload, observed, state

    for hero in heroes:
        name = hero["name"]
        slug = _public_hero_slug(name)
        if not slug:
            continue
        if not hero.get("saved_rone_skills"):
            path = f"heroes/{slug}"
            payload, observed, state = fetch(
                path, lambda value, n=name: _valid_hero(value, n)
            )
            if payload is not None:
                kit, source = ai_saved.hero_evidence(db, name)
                if kit and source:
                    hero["saved_rone_skills"] = kit
                    sources.append(_source(f"{name} · Rone skills", path, observed))
            if not hero.get("saved_rone_skills"):
                hero["rone_skills_status"] = {
                    "status": "unavailable",
                    "notice": "Rone skill descriptions could not be loaded; bundled skill names may be historical.",
                }
        if wants_stats:
            path = f"academy/heroes/{slug}/stats"
            payload, observed, state = fetch(
                path, lambda value: _records(value) is not None
            )
            if payload is not None:
                hero["rone_ranked_stats"] = _stats_projection(
                    payload, name, observed, state
                )
                sources.append(
                    _source(f"{name} · Rone aggregate stats", path, observed)
                )
            else:
                hero["rone_ranked_stats"] = {
                    "status": "unavailable",
                    "notice": "Rone aggregate statistics could not be loaded.",
                }
    if wants_patch:
        path = "academy/meta/version"
        payload, observed, state = fetch(
            path, lambda value: _records(value) is not None
        )
        facts["rone_patch_versions"] = (
            _version_projection(payload, observed, state)
            if payload is not None
            else {
                "status": "unavailable",
                "notice": "Rone game versions are unavailable; no patch changes were inferred.",
            }
        )
        if payload is not None:
            sources.append(
                _source(
                    "Rone · game versions and available notes",
                    path,
                    observed,
                    "esports_feed",
                )
            )
    wanted_ids: set[int] = set()
    if wants_build:
        for hero in heroes:
            slug = _public_hero_slug(hero["name"])
            if not slug:
                continue
            path = f"academy/heroes/{slug}/recommended"
            payload, observed, state = fetch(
                path, lambda value: _records(value) is not None
            )
            if payload is not None:
                guide = _build_projection(payload, hero["name"], observed, state)
                hero["rone_recommended_builds"] = guide
                wanted_ids.update(guide["item_ids"])
                sources.append(
                    _source(f"{hero['name']} · Rone recommended builds", path, observed)
                )
            else:
                hero["rone_recommended_builds"] = {
                    "status": "unavailable",
                    "notice": "Rone community builds could not be loaded.",
                }
        path = "academy/equipment/expanded"
        payload, observed, state = fetch(
            path, lambda value: _records(value) is not None, "size=300&index=1"
        )
        if payload is not None:
            facts["rone_equipment"] = _equipment_projection(
                payload, question, wanted_ids, observed, state
            )
            sources.append(
                _source("Rone · equipment descriptions", path, observed, "team_item")
            )
        else:
            facts["rone_equipment"] = {
                "status": "unavailable",
                "notice": "Rone equipment could not be loaded; saved team items remain available.",
            }
    for kind, intent in (("spells", SPELL_INTENT), ("emblems", EMBLEM_INTENT)):
        if not intent.search(question):
            continue
        path = f"academy/{kind}"
        payload, observed, state = fetch(
            path, lambda value: _records(value) is not None, "size=100&index=1"
        )
        if payload is not None:
            facts[f"rone_{kind}"] = _ability_catalog(
                payload, question, kind, observed, state
            )
            sources.append(_source(f"Rone · {kind}", path, observed, "team_item"))
        else:
            facts[f"rone_{kind}"] = {
                "status": "unavailable",
                "notice": f"Rone {kind} are unavailable; do not invent a source record.",
            }
    return sources
