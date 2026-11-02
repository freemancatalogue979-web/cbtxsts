"""Read-only, bounded AI context from the team's existing workspaces.

Only explicitly attached draft/map boards are sent to the AI. Saved public
esports records can be matched automatically to an esports question. Reads use
the same authenticated access rules as the corresponding app pages.
"""

from __future__ import annotations

import json
import math
import re
from typing import Any
from urllib.parse import unquote, urlsplit

from sqlalchemy import or_
from sqlalchemy.orm import Session

from .aerena_models import AerenaLeague, AerenaMatch
from .models import User, utcnow

MAX_DRAFTS = 2
MAX_MAPS = 2
MAX_AUTO_MATCHES = 3


def _text(value: Any, limit: int = 120) -> str:
    return value[:limit] if isinstance(value, str) else ""


def _number(value: Any, *, minimum: float | None = None, maximum: float | None = None) -> int | float | None:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    if (minimum is not None and value < minimum) or (maximum is not None and value > maximum):
        return None
    try:
        return round(value, 2) if math.isfinite(value) else None
    except OverflowError:
        return None


def _point(value: Any) -> list[int | float] | None:
    if not isinstance(value, (list, tuple)) or len(value) < 2:
        return None
    x, y = _number(value[0], minimum=0, maximum=100), _number(value[1], minimum=0, maximum=100)
    return [x, y] if x is not None and y is not None else None


def _sample_points(value: Any, limit: int = 10) -> tuple[list[list[int | float]], bool]:
    if not isinstance(value, list):
        return [], False
    scanned = value if len(value) <= 1000 else [value[round(index * (len(value) - 1) / 999)] for index in range(1000)]
    valid = [point for item in scanned if (point := _point(item)) is not None]
    if len(valid) <= limit:
        return valid, len(value) > len(scanned)
    # Keep both endpoints and evenly sample intermediate positions.
    return [valid[round(index * (len(valid) - 1) / (limit - 1))] for index in range(limit)], True


def _project_list(data: dict, key: str, fields: tuple[str, ...], limit: int) -> tuple[list[dict], bool]:
    raw = data.get(key)
    if not isinstance(raw, list):
        return [], False
    items = []
    for entry in raw[:limit]:
        if not isinstance(entry, dict):
            continue
        item: dict[str, Any] = {}
        for field in fields:
            value = entry.get(field)
            if field in {"x", "y"}:
                item[field] = _number(value, minimum=0, maximum=100)
            elif field in {"radius", "size", "number"}:
                item[field] = _number(value, minimum=0, maximum=1000)
            elif field == "points":
                item["points"], item["points_sampled"] = _sample_points(value)
            elif isinstance(value, str):
                item[field] = _text(value, 160 if field in {"name", "hero", "text"} else 80)
        items.append(item)
    return items, len(raw) > limit


def _draft(raw: dict) -> dict:
    data = raw.get("draft") if isinstance(raw.get("draft"), dict) else {}
    result: dict[str, Any] = {}
    for key in ("our_bans", "enemy_bans"):
        value = data.get(key)
        result[key] = [(_text(item, 100) or None) for item in value[:5]] if isinstance(value, list) else []
    for key in ("our_picks", "enemy_picks"):
        value = data.get(key)
        result[key] = (
            {
                _text(lane, 30): _text(hero, 100)
                for lane, hero in list(value.items())[:10]
                if isinstance(lane, str) and isinstance(hero, str)
            }
            if isinstance(value, dict)
            else {}
        )
    return {
        "id": raw["id"],
        "name": _text(raw.get("name"), 160),
        "opponent": _text(raw.get("opponent")),
        "patch_label": _text(raw.get("patch"), 30),
        "status": _text(raw.get("status"), 30),
        "notes": _text(raw.get("notes"), 1500),
        "board": result,
        "saved_at": raw.get("updated_at"),
        "notice": "Saved team plan; picks and bans are slots, not a verified chronological draft sequence.",
    }


def _map(raw: dict) -> dict:
    data = raw.get("data") if isinstance(raw.get("data"), dict) else {}
    schema = {
        "tokens": (("id", "hero", "side", "x", "y", "size"), 24),
        "chips": (("id", "name", "preset", "x", "y", "size", "color"), 32),
        "zones": (("id", "tokenId", "chipId", "x", "y", "radius", "color"), 24),
        "steps": (("id", "number", "mode", "color", "points", "parentId", "tokenId", "chipId"), 24),
        "paths": (("mode", "color", "points"), 24),
        "text": (("text", "x", "y"), 20),
    }
    result: dict[str, Any] = {
        "id": raw["id"],
        "name": _text(raw.get("name"), 160),
        "kind": _text(raw.get("kind"), 30),
        "opponent": _text(raw.get("opponent")),
        "notes": _text(raw.get("notes"), 1500),
        "saved_at": raw.get("updated_at"),
        "linked_draft_id": raw.get("draft_id"),
        "notice": (
            "Structured saved board, not an image. Coordinates are percentages left-to-right and top-to-bottom; "
            "paths may be sampled. Do not assume unrecorded map locations, timings or intentions."
        ),
    }
    truncated = []
    for key, (fields, limit) in schema.items():
        result[key], cut = _project_list(data, key, fields, limit)
        if cut:
            truncated.append(key)
    result["truncated_collections"] = truncated
    return result


def selected_boards(db: Session, user: User, draft_ids: list[int], map_ids: list[int]) -> tuple[dict, list[dict]]:
    """Resolve selected IDs through the same readers used by the app's pages."""
    from .routers.drafts import get_draft
    from .routers.maps import get_board

    facts: dict[str, Any] = {}
    sources = []
    if draft_ids:
        drafts = [_draft(get_draft(draft_id, db=db, user=user)) for draft_id in draft_ids]
        facts["selected_team_drafts"] = drafts
        sources.extend(
            {"kind": "draft", "label": f"Draft: {item['name']}", "route": "drafts", "board_id": item["id"]}
            for item in drafts
        )
    if map_ids:
        maps = [_map(get_board(board_id, db=db, user=user)) for board_id in map_ids]
        facts["selected_team_maps"] = maps
        sources.extend(
            {"kind": "map", "label": f"Map: {item['name']}", "route": f"maps/{item['id']}", "board_id": item["id"]}
            for item in maps
        )
    # Defend against abnormal legacy records, even after field-level caps.
    if len(json.dumps(facts, ensure_ascii=False)) > 42000:
        raise ValueError("Selected boards are too large to analyze together. Attach fewer boards.")
    return facts, sources


_ESPORTS_INTENT = re.compile(
    r"\b(esports|tournaments?|leagues?|mpl|m-series|msc|m\d{1,2}|playoffs?|"
    r"(?:pro|professional)\s+(?:games?|matches?|teams?)|(?:match|matches|series)\s+(?:results?|scores?|schedules?)|"
    r"(?:latest|recent|last|previous|upcoming|next)\s+(?:pro\s+)?(?:match|matches|series))\b",
    re.IGNORECASE,
)
_ESPORTS_SKIP = {
    "the",
    "and",
    "for",
    "what",
    "when",
    "where",
    "who",
    "why",
    "how",
    "show",
    "tell",
    "about",
    "with",
    "from",
    "latest",
    "recent",
    "current",
    "upcoming",
    "next",
    "match",
    "matches",
    "result",
    "results",
    "score",
    "scores",
    "game",
    "games",
    "draft",
    "picks",
    "bans",
    "versus",
    "against",
    "their",
    "team",
    "teams",
    "which",
    "won",
    "lose",
    "schedule",
    "standings",
    "playoffs",
    "esports",
    "tournament",
    "mobile",
    "legends",
    "mlbb",
    "today",
    "yesterday",
    "analyze",
    "analyse",
    "analysis",
    "summarize",
    "summarise",
    "explain",
    "happened",
    "happen",
    "give",
    "can",
    "could",
    "last",
    "previous",
    "season",
    "series",
    "pro",
    "professional",
    "final",
    "finals",
    "did",
    "does",
    "are",
    "was",
    "have",
    "best",
    "top",
    "strongest",
    "please",
    "recently",
    "stats",
    "statistics",
    "breakdown",
    "performance",
    "perform",
    "played",
    "access",
    "accessible",
    "available",
    "availability",
    "data",
    "information",
    "database",
    "platform",
    "sources",
    "source",
    "coverage",
    "connected",
    "connection",
    "know",
    "anything",
    "there",
    "you",
    "your",
    "about",
    "update",
    "updates",
    "news",
    "scene",
    "going",
    "into",
    "right",
    "now",
    "see",
    "all",
    "any",
    "currently",
    "able",
    "does",
    "has",
    "details",
    "related",
    "available",
    "train",
    "training",
    "teach",
    "learn",
    "learning",
    "remember",
    "understand",
    "using",
    "use",
    "get",
    "here",
    "this",
    "that",
    "link",
    "links",
    "url",
    "website",
    "site",
    "aerena",
    "bro",
    "would",
    "like",
    "https",
    "http",
    "www",
    "mobile-legends",
    "please",
    "want",
    "wanting",
    "feed",
    "teachings",
    "check",
    "checking",
    "look",
    "looking",
    "find",
    "finding",
    "fetch",
    "pull",
    "take",
    "open",
    "visit",
    "page",
    "should",
    "some",
    "our",
    "more",
    "think",
    "read",
    "help",
}


def aerena_link(question: str) -> tuple[str, str | None] | None:
    """Recognize an Aerena URL as an app source, never as an arbitrary fetch target."""
    for match in re.findall(r"https?://[^\s<>\]\[()]+", question, re.I):
        try:
            url = urlsplit(match.rstrip(".,!?;"))
            if url.scheme.lower() != "https" or (url.hostname or "").lower().rstrip(".") not in {
                "aerena.gg",
                "www.aerena.gg",
            }:
                continue
            path = unquote(url.path).strip("/")
            if path == "mobile-legends/schedule":
                return "schedule", None
            detail = re.fullmatch(r"mobile-legends/match/([A-Za-z0-9_-]{1,120})", path)
            if detail:
                return "match", detail.group(1)
        except ValueError:
            continue
    return None


def esports_intent(question: str) -> bool:
    # A clear team acronym plus a match/draft question is also esports intent.
    acronym = bool(re.search(r"\b[A-Z]{3,8}\b", question)) and bool(
        re.search(r"\b(matches|match|games?|draft|series|picks?|bans?|results?|scores?)\b", question, re.I)
    )
    # Named matchups such as "analyze Aurora vs Onic match" need not contain
    # an all-caps team acronym or an explicit source name. A bare hero matchup
    # is not enough; require a match/series question as well.
    matchup = bool(re.search(r"\b(?:vs\.?|versus|against)\b", question, re.I)) and bool(
        re.search(r"\b(?:matches|match(?!\s+up\b)|series|games?)\b", question, re.I)
    )
    return bool(_ESPORTS_INTENT.search(question) or acronym or matchup or aerena_link(question))


def automatic_match_ids(db: Session, question: str) -> list[str]:
    """Find a small, relevant saved sample; do not invent matches or refresh upstream."""
    if not esports_intent(question):
        return []
    linked = aerena_link(question)
    if linked and linked[0] == "match":
        row = db.get(AerenaMatch, linked[1])
        return [row.id] if row else []
    # URLs are references to this app's source, not team-name search terms.
    text = re.sub(r"https?://[^\s]+", " ", question, flags=re.I)
    tokens = [word for word in re.findall(r"[\w-]{3,}", text.casefold()) if word not in _ESPORTS_SKIP][:8]
    base = db.query(AerenaMatch, AerenaLeague).outerjoin(AerenaLeague, AerenaMatch.league_id == AerenaLeague.id)
    # Never mix another MPL region's saved matches into an explicitly regional question.
    from .ai_rone import requested_region

    region = requested_region(question)
    if region:
        full_name = {"ph": "philippines", "id": "indonesia", "my": "malaysia", "kh": "cambodia"}[region]
        base = base.filter(
            or_(
                AerenaLeague.region.ilike(region),
                AerenaLeague.region.ilike(f"%{full_name}%"),
                AerenaLeague.code.ilike(f"%mpl%{region}%"),
                AerenaLeague.name.ilike(f"%mpl%{region}%"),
                AerenaLeague.name.ilike(f"%{full_name}%"),
            )
        )
    upcoming = bool(re.search(r"\b(upcoming|next|schedule|fixtures?)\b", text, re.I))
    if upcoming:
        base = base.filter(AerenaMatch.has_result.is_(False), AerenaMatch.starts_at >= utcnow())
        order = AerenaMatch.starts_at.asc()
    else:
        order = AerenaMatch.starts_at.desc().nullslast()
    # A generic competition term must not crowd a named team's records out of
    # the bounded candidate set or introduce unrelated teams into the sample.
    broad = {"mpl", "msc", "philippines", "indonesia", "malaysia", "cambodia", "league", "leagues"}
    specific = [token for token in tokens if token not in broad]
    filter_tokens = specific or tokens
    if filter_tokens:
        filters = []
        for token in filter_tokens:
            safe = token.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            pattern = f"%{safe}%"
            filters.extend(
                field.ilike(pattern, escape="\\")
                for field in (
                    AerenaMatch.id,
                    AerenaMatch.team1_name,
                    AerenaMatch.team2_name,
                    AerenaMatch.team1_json,
                    AerenaMatch.team2_json,
                    AerenaLeague.name,
                    AerenaLeague.code,
                )
            )
        base = base.filter(or_(*filters))
    rows = base.order_by(order, AerenaMatch.id).limit(80).all()
    matchup = re.search(r"\b(?:vs\.?|versus|against)\b", text, re.I)
    if matchup:
        def terms(part: str) -> list[str]:
            return [word.casefold() for word in re.findall(r"[\w-]{2,}", part)
                    if word.casefold() not in _ESPORTS_SKIP and (len(word) >= 3 or word.isupper())][:8]
        left_words, right_words = terms(text[:matchup.start()]), terms(text[matchup.end():])
        if not left_words or not right_words:
            return []
        def side_has(words: list[str], name: str, raw: str) -> bool:
            try:
                team = json.loads(raw or "{}")
            except (TypeError, ValueError):
                team = {}
            team = team if isinstance(team, dict) else {}
            value = " ".join(_text(item, 200) for item in (name, team.get("teamName"), team.get("teamCode"))).casefold()
            return any(word in value for word in words)
        # Match both named sides, in either order; do not mix another opponent
        # into a specifically requested matchup merely because one team fits.
        rows = [(match, league) for match, league in rows if (
            side_has(left_words, match.team1_name, match.team1_json)
            and side_has(right_words, match.team2_name, match.team2_json)
        ) or (
            side_has(left_words, match.team2_name, match.team2_json)
            and side_has(right_words, match.team1_name, match.team1_json)
        )]

    def score(pair: tuple[AerenaMatch, AerenaLeague | None]) -> int:
        match, league = pair
        teams = " ".join(
            [match.team1_name or "", match.team2_name or "", match.team1_json or "", match.team2_json or ""]
        ).casefold()
        competition = " ".join(
            [match.id or "", (league.name or "") if league else "", (league.code or "") if league else ""]
        ).casefold()
        return sum((4 if token in teams else 0) + (1 if token in competition else 0) for token in set(tokens))

    # Stable sorting preserves the chronological order as a tiebreaker.
    rows.sort(key=score, reverse=True)
    return [row.id for row, _league in rows[:MAX_AUTO_MATCHES]]
