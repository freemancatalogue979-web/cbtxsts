"""Bounded, source-specific match loading and deterministic pick counts.

Only public esports data is fetched.  A week is selected from source-provided
labels, never inferred from dates.  We count complete ten-hero lineups, retain
partial games as partial, and never merge Aerena and Rone observations.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
import unicodedata
from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Callable
from uuid import uuid4

from sqlalchemy import DateTime, String, Text, and_, or_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column

from .aerena_models import AerenaLeague, AerenaMatch
from .db import Base
from .intel_cache import (
    IntelSnapshot,
    cache_payload,
    decode_snapshot,
    save_snapshot,
    snapshot_key,
)
from .models import loads, utcnow

# Broad enough for a full season, but still bounded against runaway requests.
MAX_MATCHES = 500
MAX_GAMES_PER_MATCH = 30
# Broad enough for per-game facts from ordinary large selections, still below
# the upstream model's context window alongside the rest of the chat context.
MAX_MATCH_CONTEXT_CHARS = 180_000
MAX_SCHEDULE_ROWS = 1_000
LOAD_DEADLINE_SECONDS = 900
RETRY_SECONDS = 90
LEASE_SECONDS = 75
DETAIL_TTL = timedelta(hours=12)
SCHEDULE_TTL = timedelta(hours=1)
REGIONS = {"id", "ph", "my", "kh"}


class PublicLoadLease(Base):
    """Cross-worker single-flight and failure cooldown for a public source path."""

    __tablename__ = "clover_esports_public_loads"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    lease_token: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    attempted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str] = mapped_column(Text, default="", nullable=False)


def _text(value: Any, limit: int = 100) -> str:
    return " ".join(value.split())[:limit] if isinstance(value, str) else ""


def _obj(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _root(payload: Any) -> dict:
    value = _obj(payload)
    return _obj(value.get("data")) if isinstance(value.get("data"), dict) else value


def _int(value: Any, *, low: int = 1, high: int = 99) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and low <= value <= high:
        return value
    if isinstance(value, str) and re.fullmatch(r"\d{1,3}", value.strip()):
        number = int(value)
        return number if low <= number <= high else None
    return None


def aerena_week(match: AerenaMatch) -> int | None:
    """Use explicit week fields/stage or Aerena's S…W…D…M… match label.

    Conflicting source labels are unknown, not silently assigned to a week.
    """
    if aerena_playoff_stage(match.stage):
        return None  # A playoff round is not a regular-season week.
    raw = loads(match.raw_json, {})
    raw = raw if isinstance(raw, dict) else {}
    candidates = {_int(raw.get(key)) for key in ("week", "weekNumber", "week_number")}
    stage = re.search(r"\bweek\s*[-:#]?\s*(\d{1,2})\b", match.stage or "", re.I)
    if stage:
        candidates.add(_int(stage.group(1)))
    label = re.search(
        r"(?:^|[-_])S\d{1,3}W(\d{1,2})D\d{1,2}M\d{1,2}(?:$|[-_])", match.id or "", re.I
    )
    if label:
        candidates.add(_int(label.group(1)))
    candidates.discard(None)
    return next(iter(candidates)) if len(candidates) == 1 else None


# Only source-provided stage names count; unknown stages are never inferred
# from dates, scores, match IDs or best-of formats.
AERENA_EXPLICIT_PLAYOFF_LABELS = (
    "playoff",
    "play-off",
    "play off",
    "bracket",
    "knockout",
    "grand final",
    "grand-final",
)
AERENA_NON_PLAYOFF_MARKERS = ("regular", "group", "week")


def aerena_playoff_stage(stage: str | None) -> bool:
    value = (stage or "").casefold()
    if any(label in value for label in AERENA_EXPLICIT_PLAYOFF_LABELS):
        return True
    # "Final week" or "group final" is not evidence of a playoff bracket.
    return "final" in value and not any(
        label in value for label in AERENA_NON_PLAYOFF_MARKERS
    )


def aerena_playoff_condition():  # noqa: ANN201
    """SQL equivalent for filtering before pagination in the public match centre."""
    return or_(
        *(
            AerenaMatch.stage.ilike(f"%{label}%")
            for label in AERENA_EXPLICIT_PLAYOFF_LABELS
        ),
        and_(
            AerenaMatch.stage.ilike("%final%"),
            *(
                ~AerenaMatch.stage.ilike(f"%{label}%")
                for label in AERENA_NON_PLAYOFF_MARKERS
            ),
        ),
    )


def aerena_league_matches_region(league: AerenaLeague, region: str) -> bool:
    patterns = {
        "id": r"\b(?:id|idn|indonesia|indonesian)\b",
        "ph": r"\b(?:ph|phl|philippines|philippine)\b",
        "my": r"\b(?:my|mys|malaysia|malaysian)\b",
        "kh": r"\b(?:kh|khm|cambodia|cambodian)\b",
    }
    pattern = patterns.get(region)
    return bool(
        pattern
        and re.search(pattern, f"{league.region} {league.code} {league.name}", re.I)
    )


def rone_id(region: str, value: Any) -> str | None:
    if region not in REGIONS or isinstance(value, bool):
        return None
    text = str(value).strip() if isinstance(value, (str, int)) else ""
    if region in {"id", "my"}:
        return text if re.fullmatch(r"[1-9]\d{0,11}", text) else None
    if region == "ph":
        return text if re.fullmatch(r"[a-z0-9-]{1,80}", text) else None
    return None  # Rone publishes no KH match-details route.


def _rone_source_id(value: Any) -> str | None:
    """Safe identifier for deduplication, even when a region has no details route."""
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return None
    text = str(value).strip()
    return text if re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}", text) else None


def _valid_schedule(payload: Any) -> bool:
    if (
        not isinstance(payload, dict)
        or payload.get("code", 0) not in (0, None)
        or not isinstance(_root(payload).get("weeks"), list)
    ):
        return False
    try:
        rone_schedule_rows(
            payload, "id"
        )  # Shape and bounds only; no source IDs are fetched here.
        return True
    except ValueError:
        return False


def _valid_playoffs(payload: Any) -> bool:
    if (
        not isinstance(payload, dict)
        or payload.get("code", 0) not in (0, None)
        or not isinstance(_root(payload).get("days"), list)
    ):
        return False
    try:
        rone_playoff_rows(payload, "id")
        return True
    except ValueError:
        return False


def _valid_detail(payload: Any, match_id: str) -> bool:
    root = _root(payload)
    return (
        isinstance(payload, dict)
        and payload.get("code", 0) in (0, None)
        and str(root.get("match_id", "")) == match_id
        and isinstance(root.get("games"), list)
        and len(root["games"]) <= MAX_GAMES_PER_MATCH
    )


def _saved(
    db: Session, path: str, validate: Callable[[Any], bool], query: str = ""
) -> tuple[Any | None, datetime | None]:
    row = db.get(IntelSnapshot, snapshot_key("public", path, query))
    if not row:
        return None, None
    try:
        payload = decode_snapshot(row)
        return (payload, row.observed_at) if validate(payload) else (None, None)
    except (ValueError, TypeError):
        return None, None


def _claim(
    db: Session,
    path: str,
    *,
    lease_seconds: int = LEASE_SECONDS,
    retry_seconds: float = RETRY_SECONDS,
) -> tuple[str, str] | tuple[str, None]:
    key = hashlib.sha256(path.encode()).hexdigest()
    row = db.get(PublicLoadLease, key)
    if row is None:
        db.add(PublicLoadLease(key=key))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    now, token = utcnow(), uuid4().hex
    result = db.execute(
        update(PublicLoadLease)
        .where(
            PublicLoadLease.key == key,
            or_(
                PublicLoadLease.lease_until.is_(None), PublicLoadLease.lease_until < now
            ),
            or_(
                PublicLoadLease.attempted_at.is_(None),
                PublicLoadLease.attempted_at < now - timedelta(seconds=retry_seconds),
            ),
        )
        .values(
            lease_token=token,
            lease_until=now + timedelta(seconds=lease_seconds),
            attempted_at=now,
        )
    )
    db.commit()
    return key, token if result.rowcount else None


def _finish(db: Session, key: str, token: str, error: str = "") -> None:
    db.execute(
        update(PublicLoadLease)
        .where(PublicLoadLease.key == key, PublicLoadLease.lease_token == token)
        .values(lease_token="", lease_until=None, last_error=error[:160])
    )
    db.commit()


def load_rone(
    db: Session,
    path: str,
    validate: Callable[[Any], bool],
    *,
    ttl: timedelta,
    refresh: bool = False,
    wait_for_peer: bool = True,
    query: str = "",
) -> tuple[Any | None, datetime | None, str]:
    """Read or fetch one allowlisted public path; retain saved data on failure.

    Caller constructs the path and query from fixed public-source identifiers.
    No user questions, credentials or private data go to the public source.
    """
    saved, observed = _saved(db, path, validate, query)
    if saved is not None and not refresh and observed and observed + ttl > utcnow():
        return saved, observed, "saved"
    key, token = _claim(db, f"{path}?{query}" if query else path)
    if token is None:
        if saved is not None and not refresh:
            return saved, observed, "saved_stale"
        # Another worker may be fetching the same missing/incomplete match.
        # Wait for a newer snapshot, but never bypass the shared cooldown.
        previous, previous_at = saved, observed
        if wait_for_peer:
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                db.expire_all()
                current, current_at = _saved(db, path, validate, query)
                if current is not None and (
                    previous_at is None or (current_at and current_at > previous_at)
                ):
                    return current, current_at, "saved"
                state = db.get(PublicLoadLease, key)
                if not state or not state.lease_until or state.lease_until < utcnow():
                    break
                db.rollback()  # release SQLite read transaction before waiting
                time.sleep(0.4)
        return (
            (previous, previous_at, "saved_stale")
            if previous is not None
            else (None, None, "unavailable")
        )
    # Serialize community-hosted Rone requests across workers as well as
    # deduplicating individual paths. Never forward user prompts or credentials.
    global_key, global_token = _claim(db, "rone-public-global", retry_seconds=0.25)
    deadline = time.monotonic() + 30
    while global_token is None and time.monotonic() < deadline:
        db.rollback()
        time.sleep(0.4)
        global_key, global_token = _claim(db, "rone-public-global", retry_seconds=0.25)
    if global_token is None:
        _finish(db, key, token, "Public source is busy; saved data retained.")
        return saved, observed, "saved_stale" if saved is not None else "unavailable"
    try:
        from .routers.intel import _public_fetch

        status, payload = _public_fetch(path, query)
        if status != 200 or not validate(payload):
            raise ValueError("Unrecognized or unavailable source data.")
        cache_payload(payload)
        row = save_snapshot(db, "public", path, query, payload)
        _finish(db, key, token)
        return payload, row.observed_at, "loaded"
    except Exception:  # No upstream error text, prompt or secrets in logs/context.
        db.rollback()
        _finish(
            db, key, token, "Public source could not be loaded; saved data retained."
        )
        return saved, observed, "saved_stale" if saved is not None else "unavailable"
    finally:
        db.rollback()
        _finish(db, global_key, global_token)


def rone_schedule(
    db: Session, region: str, *, refresh: bool = False
) -> tuple[Any | None, datetime | None, str]:
    if region not in REGIONS:
        raise ValueError("Choose a supported MPL region.")
    return load_rone(
        db,
        f"esports/{region}/schedule",
        _valid_schedule,
        ttl=SCHEDULE_TTL,
        refresh=refresh,
    )


def rone_playoffs(
    db: Session, region: str, *, refresh: bool = False
) -> tuple[Any | None, datetime | None, str]:
    if region not in REGIONS:
        raise ValueError("Choose a supported MPL region.")
    return load_rone(
        db,
        f"esports/{region}/playoffs",
        _valid_playoffs,
        ttl=SCHEDULE_TTL,
        refresh=refresh,
    )


def rone_playoff_rows(payload: Any, region: str) -> tuple[list[dict], int]:
    """Project the separate playoff days without treating them as schedule weeks."""
    days = _root(payload).get("days")
    if not isinstance(days, list) or len(days) > 50:
        raise ValueError("Rone playoffs have incomplete day information.")
    rows: list[dict] = []
    seen: dict[str, dict] = {}
    duplicates = 0

    def team(value: Any) -> str:
        obj = _obj(value)
        return (
            _text(
                obj.get("name")
                or obj.get("team_name")
                or obj.get("full_name")
                or value,
                80,
            )
            or "TBD"
        )

    for day in days:
        if (
            not isinstance(day, dict)
            or not isinstance(day.get("matches"), list)
            or len(day["matches"]) > 50
        ):
            raise ValueError("Rone playoffs have incomplete match information.")
        for item in day["matches"]:
            if not isinstance(item, dict):
                raise ValueError("Rone playoffs have an incomplete match record.")
            raw_id = _rone_source_id(item.get("match_id"))
            mid = rone_id(region, item.get("match_id"))
            row = {
                "id": mid,
                "week": None,
                "phase": "playoffs",
                "day": _text(day.get("label"), 80),
                "starts_at": _text(item.get("start_at"), 40) or None,
                "team1": team(
                    item.get("team1") or item.get("home") or item.get("team_a")
                ),
                "team2": team(
                    item.get("team2") or item.get("away") or item.get("team_b")
                ),
                "score1": _int(item.get("score1"), low=0, high=30),
                "score2": _int(item.get("score2"), low=0, high=30),
                "status": _text(item.get("status"), 20),
                "round": _text(item.get("round"), 100),
                "best_of": _int(item.get("best_of"), low=1, high=30),
            }
            if raw_id and raw_id in seen:
                duplicates += 1
                first = seen[raw_id]
                fields = ("team1", "team2", "starts_at", "score1", "score2", "round")
                if any(
                    first[key] != row[key]
                    and first[key] not in (None, "", "TBD")
                    and row[key] not in (None, "", "TBD")
                    for key in fields
                ):
                    first["id"] = None
                    first["id_conflict"] = True
                continue
            if raw_id:
                seen[raw_id] = row
            rows.append(row)
            if len(rows) > MAX_SCHEDULE_ROWS:
                raise ValueError("Rone playoffs exceed the safe scan limit.")
    return rows, duplicates


def rone_schedule_rows(
    payload: Any, region: str, week: int | None = None
) -> tuple[list[dict], int]:
    root = _root(payload)
    rows: list[dict] = []
    duplicates = 0
    seen: set[tuple[int, str]] = set()
    weeks_by_id: dict[str, set[int]] = {}
    weeks = root.get("weeks") or []
    if not isinstance(weeks, list) or len(weeks) > 60:
        raise ValueError("Rone schedule exceeds the safe scan limit.")
    for w in weeks:
        if (
            not isinstance(w, dict)
            or _int(w.get("week")) is None
            or not isinstance(w.get("days"), list)
        ):
            raise ValueError("Rone schedule has incomplete week labels.")
        number = _int(w.get("week"))
        assert number is not None  # Validated above.
        days = w["days"]
        if len(days) > 20:
            raise ValueError("Rone schedule exceeds the safe scan limit.")
        for day in days:
            if not isinstance(day, dict) or not isinstance(day.get("matches"), list):
                raise ValueError("Rone schedule has incomplete day information.")
            day_matches = day["matches"]
            if len(day_matches) > 50:
                raise ValueError("Rone schedule exceeds the safe scan limit.")
            for item in day_matches:
                if not isinstance(item, dict):
                    raise ValueError("Rone schedule has an incomplete match record.")
                mid = rone_id(region, item.get("match_id"))
                if mid and (number, mid) in seen:
                    duplicates += 1
                    continue
                if mid:
                    if mid in weeks_by_id and number not in weeks_by_id[mid]:
                        duplicates += 1
                    seen.add((number, mid))
                    weeks_by_id.setdefault(mid, set()).add(number)

                def team(value: Any) -> str:
                    obj = _obj(value)
                    return (
                        _text(obj.get("name") or obj.get("team_name") or value, 80)
                        or "TBD"
                    )

                rows.append(
                    {
                        "id": mid,
                        "week": number,
                        "team1": team(item.get("team1")),
                        "team2": team(item.get("team2")),
                        "status": _text(item.get("status"), 20),
                        "starts_at": _text(item.get("start_at"), 40) or None,
                        "day": _text(day.get("label"), 80),
                        "score1": _int(item.get("score1"), low=0, high=30),
                        "score2": _int(item.get("score2"), low=0, high=30),
                    }
                )
                if len(rows) > MAX_SCHEDULE_ROWS:
                    raise ValueError("Rone schedule exceeds the safe scan limit.")
    conflicting_ids = {
        mid for mid, labelled_weeks in weeks_by_id.items() if len(labelled_weeks) > 1
    }
    for row in rows:
        if row["id"] in conflicting_ids:
            row["id"] = None
            row["id_conflict"] = True
    return [row for row in rows if week is None or row["week"] == week], duplicates


def requested_scope(question: str, db: Session | None = None) -> dict | None:
    """Recognize a source, region and week or playoffs without guessing a season."""
    from .ai_rone import requested_region

    if not re.search(r"\b(rone|mpl|aerena)\b", question, re.I):
        return None
    week_pattern = r"(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)"
    hits = list(re.finditer(rf"\bweeks?\s*[-:#]?\s*({week_pattern})\b", question, re.I))
    playoffs = bool(re.search(r"\b(?:play[\s-]?offs?|bracket)\b", question, re.I))
    region = requested_region(question)
    if not region:
        short = re.search(
            r"\b(?:rone|aerena)\s+(?:mpl\s+)?(id|ph|my|kh)\b", question, re.I
        )
        region = short.group(1).lower() if short else None
    if (not hits and not playoffs) or not region:
        return None
    words = {
        name: n
        for n, name in enumerate(
            (
                "one",
                "two",
                "three",
                "four",
                "five",
                "six",
                "seven",
                "eight",
                "nine",
                "ten",
            ),
            1,
        )
    }
    word = hits[0].group(1).casefold() if hits else ""
    week = (words.get(word) or _int(word)) if hits else None
    if hits and not week:
        return None
    mode = "playoffs" if playoffs else "week"
    seasons = {
        int(value)
        for value in re.findall(
            r"\b(?:season\s*[-:#]?\s*|s\s*)(0*[1-9]\d{0,2})\b", question, re.I
        )
    }
    words_only = re.sub(r"https?://[^\s]+", " ", question, flags=re.I)
    explicit_rone = bool(
        re.search(r"\brone\b", words_only, re.I)
        or re.search(r"https?://(?:[a-z0-9-]+\.)?rone\.dev\b", question, re.I)
    )
    explicit_aerena = bool(
        re.search(r"\b(?:aerena|arena)\b", words_only, re.I)
        or re.search(r"https?://(?:www\.)?aerena\.gg\b", question, re.I)
    )
    use_aerena = not explicit_rone and (explicit_aerena or bool(seasons))
    multiple_weeks = len(hits) > 1 or bool(
        re.search(
            rf"\bweeks?\s*[-:#]?\s*{week_pattern}\s*(?:,|and|or|to|[-–])\s*(?:week\s*)?{week_pattern}\b",
            question,
            re.I,
        )
    )
    if multiple_weeks or (playoffs and hits) or (explicit_rone and explicit_aerena):
        return {
            "source": "aerena" if use_aerena else "rone",
            "mode": mode,
            "region": region,
            "week": week,
            "selection_error": "Choose one source and one week or the playoffs at a time in the picker; no stages or sources were silently combined.",
        }
    narrow_round = playoffs and bool(
        re.search(
            r"\b(?:(?:upper|lower)\s+(?:bracket|finals?)|grand[\s-]+finals?|semi[\s-]*finals?|quarter[\s-]*finals?)\b|\b\w+\s+vs\.?\s+\w+\b",
            question,
            re.I,
        )
    )
    if narrow_round:
        return {
            "source": "aerena" if use_aerena else "rone",
            "mode": mode,
            "region": region,
            "selection_error": "For a specific playoff round or matchup, select those matches in the picker. The entire playoffs were not substituted.",
        }
    if not use_aerena:
        return {
            "source": "rone",
            "mode": mode,
            "region": region,
            "week": week,
            "season_requested": bool(seasons),
        }
    result: dict[str, Any] = {
        "source": "aerena",
        "mode": mode,
        "region": region,
        "week": week,
    }
    if len(seasons) != 1:
        result["selection_error"] = (
            "Choose a specific Aerena MPL season in the picker, or include one season number in your question. No season was guessed."
        )
        return result
    number = next(iter(seasons))
    result["season_number"] = number
    if db is None:
        result["selection_error"] = (
            "The Aerena season catalog is unavailable. Choose the season in the picker."
        )
        return result
    names = {"id": "indonesia", "ph": "philippines", "my": "malaysia", "kh": "cambodia"}
    rows = (
        db.query(AerenaLeague)
        .filter(
            or_(AerenaLeague.code.ilike("%mpl%"), AerenaLeague.name.ilike("%mpl%")),
            or_(
                AerenaLeague.region.ilike(region),
                AerenaLeague.region.ilike(f"%{names[region]}%"),
                AerenaLeague.code.ilike(f"%mpl%{region}%"),
                AerenaLeague.name.ilike(f"%{names[region]}%"),
            ),
        )
        .order_by(AerenaLeague.starts_at.desc().nullslast(), AerenaLeague.id)
        .limit(501)
        .all()
    )
    season_pattern = re.compile(rf"\b(?:s\s*|season\s*)0*{number}\b", re.I)
    candidates = [
        row for row in rows if season_pattern.search(f"{row.code} {row.name}")
    ]
    exact = re.compile(
        rf"^\s*mpl[\s-]+{region}[\s-]+s(?:eason\s*)?0*{number}\s*$", re.I
    )
    canonical = [row for row in candidates if exact.fullmatch(row.code or "")]
    if len(rows) <= 500 and len(canonical) == 1:
        result["league_id"] = canonical[0].id
    elif len(rows) <= 500 and len(candidates) == 1:
        result["league_id"] = candidates[0].id
    else:
        result["selection_error"] = (
            "That Aerena season is not in the saved catalog. Choose or load it in the picker; no other season was substituted."
            if not candidates
            else "More than one Aerena competition matches that season. Choose the exact season in the picker."
        )
    return result


def _hero(value: Any) -> str:
    name = _text(value, 80)
    if not name or name.casefold() in {"unknown", "tbd", "none", "-", "null"}:
        return ""
    return unicodedata.normalize("NFKC", name)


def _key(name: str) -> str:
    return name.casefold()


def _rone_games(payload: Any) -> tuple[list[dict], int]:
    raw = _root(payload).get("games", [])
    counts = Counter(
        _int(_obj(game).get("number"), high=30)
        for game in raw
        if isinstance(game, dict)
    )
    ambiguous = sum(
        count for key, count in counts.items() if key is None or count > 1
    ) + sum(not isinstance(game, dict) for game in raw)
    games = []
    for item in raw:
        item = _obj(item)
        number = _int(item.get("number"), high=30)
        if number is None or counts[number] != 1:
            continue
        teams = item.get("teams") if isinstance(item.get("teams"), list) else []
        projected = []
        all_names: list[str] = []
        malformed = len(teams) != 2
        for team in teams[:2]:
            team = _obj(team)
            players = (
                team.get("players") if isinstance(team.get("players"), list) else []
            )
            malformed |= len(players) != 5
            names = [
                _hero(_obj(_obj(player).get("hero")).get("name"))
                for player in players[:5]
            ]
            all_names.extend(name for name in names if name)
            player_rows = []
            for player in players[:5]:
                player = _obj(player)
                player_rows.append(
                    {
                        "name": _text(player.get("name"), 60) or None,
                        "hero": _hero(_obj(player.get("hero")).get("name")) or None,
                        "kills": _int(player.get("kills"), low=0, high=200),
                        "deaths": _int(player.get("deaths"), low=0, high=200),
                        "assists": _int(player.get("assists"), low=0, high=200),
                        "gold": _int(player.get("gold"), low=0, high=1_000_000_000),
                        "damage_dealt": _int(
                            player.get("damage_dealt"), low=0, high=1_000_000_000
                        ),
                        "damage_taken": _int(
                            player.get("damage_taken"), low=0, high=1_000_000_000
                        ),
                        "tower_damage": _int(
                            player.get("tower_damage"), low=0, high=1_000_000_000
                        ),
                        "item_ids": (
                            [
                                _text(_obj(item).get("id"), 40)
                                for item in (player.get("items") or [])[:10]
                                if isinstance(item, dict) and _text(item.get("id"), 40)
                            ]
                            if isinstance(player.get("items"), list)
                            else []
                        ),
                    }
                )
            stats = _obj(team.get("stats"))
            projected.append(
                {
                    "team": _text(_obj(team.get("team")).get("name"), 80) or None,
                    "won": (
                        team.get("winner")
                        if isinstance(team.get("winner"), bool)
                        else None
                    ),
                    "kills": _int(team.get("kills"), low=0, high=1000),
                    "stats": {
                        key: value
                        for key in (
                            "total_gold",
                            "total_damage",
                            "red_buff",
                            "blue_buff",
                            "lord_kill",
                            "tortoise_kill",
                            "tower_destroy",
                        )
                        if (value := _int(stats.get(key), low=0, high=1_000_000_000))
                        is not None
                    },
                    "heroes": names,
                    "players": player_rows,
                }
            )
        complete = (
            not malformed
            and len(all_names) == 10
            and len({_key(name) for name in all_names}) == 10
        )
        games.append(
            {
                "number": number,
                "teams": projected,
                "picks": all_names,
                "complete_picks": complete,
                "bans": None,
                "duration": _text(
                    item.get("duration") or item.get("duration_estimate"), 24
                )
                or None,
                "duration_estimated": bool(
                    not item.get("duration") and item.get("duration_estimate")
                ),
            }
        )
    return sorted(games, key=lambda game: game["number"]), ambiguous


def _aerena_games(detail: dict) -> tuple[list[dict], int]:
    result = []
    raw = detail.get("games") if isinstance(detail.get("games"), list) else []
    limited = raw[:MAX_GAMES_PER_MATCH]
    numbers = Counter(
        _int(game.get("number"), high=30) for game in limited if isinstance(game, dict)
    )
    ambiguous = (
        max(0, len(raw) - MAX_GAMES_PER_MATCH)
        + sum(count for number, count in numbers.items() if number is None or count > 1)
        + sum(not isinstance(game, dict) for game in limited)
    )
    for game in limited:
        if not isinstance(game, dict):
            continue
        number = _int(game.get("number"), high=30)
        if number is None or numbers[number] != 1:
            continue
        events = game.get("draft") if isinstance(game.get("draft"), list) else []
        picks = [
            _hero(event.get("hero_name"))
            for event in events
            if isinstance(event, dict) and event.get("kind") == "Pick"
        ]
        bans = [
            _hero(event.get("hero_name"))
            for event in events
            if isinstance(event, dict) and event.get("kind") == "Ban"
        ]
        complete = (
            len(picks) == 10
            and all(picks)
            and len({_key(name) for name in picks}) == 10
        )
        stats = (
            game.get("player_stats")
            if isinstance(game.get("player_stats"), list)
            else []
        )
        players = [
            {
                "name": _text(row.get("ign"), 60) or None,
                "team_id": _text(row.get("team_id"), 80) or None,
                "position": _text(row.get("position"), 30) or None,
                "hero": _hero(row.get("hero_name")) or None,
                "kills": _int(row.get("kills"), low=0, high=200),
                "deaths": _int(row.get("deaths"), low=0, high=200),
                "assists": _int(row.get("assists"), low=0, high=200),
                "gold": _int(row.get("gold"), low=0, high=1_000_000_000),
                "damage_dealt": _int(row.get("dmgDealt"), low=0, high=1_000_000_000),
                "damage_taken": _int(row.get("dmgTaken"), low=0, high=1_000_000_000),
            }
            for row in stats[:10]
            if isinstance(row, dict)
        ]
        draft = [
            {
                "kind": event.get("kind"),
                "sequence": _int(event.get("sequence"), high=20),
                "side": _text(event.get("side"), 8) or None,
                "hero": _hero(event.get("hero_name")) or None,
                "player": _text(event.get("player_ign"), 60) or None,
            }
            for event in events[:20]
            if isinstance(event, dict) and event.get("kind") in {"Pick", "Ban"}
        ]
        team_values = (_obj(game.get("team1")), _obj(game.get("team2")))
        team_stats = [
            {
                key: value
                for key in ("teamName", "teamCode", "side")
                if (value := _text(team.get(key), 80))
            }
            | {
                key: value
                for key in (
                    "teamScore",
                    "teamKills",
                    "teamDeaths",
                    "teamAssists",
                    "teamGold",
                    "teamDmgDealt",
                    "teamDmgTaken",
                    "teamTurtles",
                    "teamLords",
                    "teamObjectives",
                )
                if (value := _int(team.get(key), low=0, high=1_000_000_000)) is not None
            }
            for team in team_values
        ]
        winning = _obj(game.get("winner"))
        winner_name = _text(winning.get("teamName") or winning.get("teamCode"), 80)
        if not winner_name and winning.get("team"):
            winning_teams = [
                team for team in team_values if team.get("team") == winning["team"]
            ]
            if len(winning_teams) == 1:
                winner_name = _text(
                    winning_teams[0].get("teamName")
                    or winning_teams[0].get("teamCode"),
                    80,
                )
        result.append(
            {
                "number": number,
                "picks": [name for name in picks if name],
                "complete_picks": complete,
                "bans": [name for name in bans if name] if bans else None,
                "draft_coverage": _text(game.get("draft_coverage"), 20) or None,
                "draft": draft,
                "teams": team_stats,
                "players": players,
                "players_omitted": max(0, len(stats) - 10),
                "winner": winner_name or None,
                "duration_seconds": (
                    game.get("duration_seconds")
                    if isinstance(game.get("duration_seconds"), int)
                    else None
                ),
            }
        )
    return result, ambiguous


def _ranking(counter: Counter, labels: dict[str, str]) -> list[dict]:
    return [
        {"hero": labels[key], "picks": count}
        for key, count in sorted(
            counter.items(), key=lambda item: (-item[1], labels[item[0]].casefold())
        )
    ]


def aggregate(
    matches: list[dict],
    *,
    source: str,
    scope: dict,
    missing: int = 0,
    duplicate_rows: int = 0,
    notice: str = "",
    player_details_omitted: bool = False,
) -> dict:
    all_picks: Counter = Counter()
    by_number: dict[int, Counter] = {}
    numbers: dict[int, dict[str, int]] = {}
    labels: dict[str, str] = {}
    partial = complete = ambiguous = 0
    for match in matches:
        ambiguous += match.get("ambiguous_games", 0)
        for game in match.get("games", []):
            n = game["number"]
            state = numbers.setdefault(
                n, {"games": 0, "complete_picks": 0, "partial_picks": 0}
            )
            state["games"] += 1
            if not game.get("complete_picks"):
                partial += 1
                state["partial_picks"] += 1
                continue
            complete += 1
            state["complete_picks"] += 1
            counter = by_number.setdefault(n, Counter())
            for name in game["picks"]:
                key = _key(name)
                labels.setdefault(key, name)
                all_picks[key] += 1
                counter[key] += 1
    result = {
        "source": source,
        "scope": scope,
        "matches": matches,
        "coverage": {
            "matches_listed": len(matches) + missing,
            "matches_with_games": sum(bool(m.get("games")) for m in matches),
            "missing_matches": missing + sum(not m.get("games") for m in matches),
            "complete_pick_games": complete,
            "partial_pick_games": partial,
            "missing_scored_games": sum(
                m.get("missing_scored_games") or 0 for m in matches
            ),
            "score_game_conflicts": sum(
                bool(m.get("score_game_conflict")) for m in matches
            ),
            "ambiguous_or_omitted_games": ambiguous,
            "duplicate_schedule_rows_removed": duplicate_rows,
        },
        "all_games": {
            "complete_pick_games": complete,
            "top_picks": _ranking(all_picks, labels),
        },
        "by_game_number": [
            {
                "game_number": n,
                **numbers[n],
                "top_picks": _ranking(by_number.get(n, Counter()), labels),
            }
            for n in sorted(numbers)
        ],
        "notice": (
            "Counts are deterministic counts of picks in complete ten-distinct-hero games only; "
            "partial games are excluded and must be disclosed. Hero lists do not imply pick order. "
            "Community records may be stale or incomplete. " + notice
        ).strip(),
    }
    # Compute counts before compacting. Retain every match and game identity,
    # rather than allocating the budget to the first few match cards.
    result["coverage"]["game_records"] = complete + partial
    result["coverage"]["match_detail_cards_omitted"] = 0
    result["coverage"]["game_detail_level"] = (
        "without_players" if player_details_omitted else "full"
    )
    size = lambda: len(json.dumps(result, ensure_ascii=False))  # noqa: E731
    buckets = [result["all_games"], *result["by_game_number"]]

    def limit_rankings(limit: int) -> None:
        for bucket in buckets:
            ranked = bucket["top_picks"]
            if len(ranked) > limit:
                leaders = sum(row["picks"] == ranked[0]["picks"] for row in ranked)
                bucket["additional_heroes_not_listed"] = (
                    bucket.get("additional_heroes_not_listed", 0) + len(ranked) - limit
                )
                bucket["tied_leaders_omitted"] = bucket.get(
                    "tied_leaders_omitted", 0
                ) + max(0, leaders - limit)
                bucket["top_picks"] = ranked[:limit]

    if size() > 140_000:
        for match in matches:
            _drop_player_details(match.get("games", []))
        result["coverage"]["game_detail_level"] = "without_players"
        result[
            "notice"
        ] += " Player detail was omitted from the bounded context; pick counts still include every complete game."
    if size() > MAX_MATCH_CONTEXT_CHARS:
        # Keep per-game hero lists and winner for every series before dropping
        # individual game cards or truncating ranked ties.
        for match in matches:
            compacted = []
            for game in match.get("games", []):
                winner = game.get("winner")
                if not winner:
                    winners = [
                        team.get("team")
                        for team in game.get("teams", [])
                        if team.get("won") is True and team.get("team")
                    ]
                    winner = winners[0] if len(winners) == 1 else None
                compacted.append(
                    {
                        "number": game["number"],
                        "complete_picks": game.get("complete_picks", False),
                        "picks": game.get("picks", []),
                        "bans": game.get("bans"),
                        "winner": winner,
                    }
                )
            match["games"] = compacted
        limit_rankings(40)
        result["coverage"]["game_detail_level"] = "heroes_and_winner"
        result[
            "notice"
        ] += " Per-game stats and draft order were compacted; recorded picks and bans remain for every listed game. Some ranked heroes may be omitted; counts are unchanged."
    if size() > MAX_MATCH_CONTEXT_CHARS:
        # The model cannot fit a whole large season's detailed drafts at once.
        # Keep a complete game index for every match and be explicit about what
        # needs a narrower selection; never present a first-75 sample as all.
        for match in matches:
            games = match.pop("games", [])
            match["games_recorded"] = len(games)
            match["game_numbers"] = [game["number"] for game in games]
            match["partial_pick_game_numbers"] = [
                game["number"] for game in games if not game.get("complete_picks")
            ]
        limit_rankings(10)
        result["coverage"]["game_detail_level"] = "game_index"
        result[
            "notice"
        ] += " Per-game hero lists were compacted; every available game number remains indexed by match. Narrow the selection for game-by-game hero or player analysis. Summary counts still include all complete games."
    if size() > MAX_MATCH_CONTEXT_CHARS:

        def ranges(values: list[int]) -> str:
            ordered = sorted(set(values))
            groups: list[str] = []
            while ordered:
                first = last = ordered.pop(0)
                while ordered and ordered[0] == last + 1:
                    last = ordered.pop(0)
                groups.append(str(first) if first == last else f"{first}-{last}")
            return ",".join(groups)

        result["matches"] = [
            {
                key: match.get(key)
                for key in (
                    "match_id",
                    "season_id",
                    "season",
                    "region",
                    "week",
                    "phase",
                    "stage",
                    "round",
                    "team1",
                    "team2",
                    "score1",
                    "score2",
                    "load_status",
                    "missing_scored_games",
                )
            }
            | {
                "games_recorded": match["games_recorded"],
                "game_numbers": ranges(match["game_numbers"]),
                "partial_pick_game_numbers": ranges(match["partial_pick_game_numbers"]),
            }
            for match in matches
        ]
        result["coverage"]["game_number_format"] = "inclusive comma-separated ranges"
        result[
            "notice"
        ] += " Game numbers are compact inclusive ranges, not scores; some match metadata was omitted."
    if size() > MAX_MATCH_CONTEXT_CHARS:
        # A pathological full-season sample with maximum-length names still
        # keeps each source ID and every game number. The narrowed metadata is
        # disclosed and users can select a smaller set for exact stage labels.
        result["matches"] = [
            {
                "match_id": match.get("match_id"),
                "season_id": match.get("season_id"),
                "region": match.get("region"),
                "week": match.get("week"),
                "phase": match.get("phase"),
                "stage": _text(match.get("stage"), 40) or None,
                "round": _text(match.get("round"), 40) or None,
                "games_recorded": match["games_recorded"],
                "game_numbers": match["game_numbers"],
                "partial_pick_game_numbers": match["partial_pick_game_numbers"],
            }
            for match in result["matches"]
        ]
        result[
            "notice"
        ] += " Team names, scores and portions of unusually long stage labels were omitted; narrow the selection for them."
    if size() > MAX_MATCH_CONTEXT_CHARS:
        for match in result["matches"]:
            match.pop("stage", None)
            match.pop("round", None)
            match.pop("partial_pick_game_numbers", None)
        result[
            "notice"
        ] += " Detailed stage labels and per-game completeness were also omitted; overall coverage and all game numbers remain."
    if size() > MAX_MATCH_CONTEXT_CHARS:
        # Deduplicate long season/region labels across large selections while
        # retaining their association with each individual match.
        season_keys: list[list[str | None]] = []
        indexes: dict[tuple[str | None, str | None], int] = {}
        for match in result["matches"]:
            key = (match.pop("season_id", None), match.pop("region", None))
            if any(key):
                if key not in indexes:
                    indexes[key] = len(season_keys)
                    season_keys.append(list(key))
                match["season_region_ref"] = indexes[key]
        result["coverage"]["season_region_index"] = season_keys
        result[
            "notice"
        ] += " season_region_ref indexes the [season ID, region] table in coverage."
    if size() > MAX_MATCH_CONTEXT_CHARS:
        # Positional rows avoid repeating field names 500 times. The columns
        # are supplied explicitly and every match/game remains recoverable.
        columns = [
            "match_id",
            "week",
            "phase",
            "games_recorded",
            "game_numbers",
            "season_region_ref",
        ]
        result["match_index_columns"] = columns
        result["matches"] = [
            [match.get(key) for key in columns] for match in result["matches"]
        ]
        result[
            "notice"
        ] += " Each compact match row follows match_index_columns; game numbers remain associated with their match."
        if size() > MAX_MATCH_CONTEXT_CHARS:
            limit_rankings(3)
            result[
                "notice"
            ] += " Additional ranked heroes and ties are counted but omitted; do not call the displayed leaders exhaustive."
    return result


def pick_chart(facts: dict, question: str) -> dict | None:
    """Create a bounded, deterministic picture of the already-computed counts."""
    words = {
        "one": 1,
        "two": 2,
        "three": 3,
        "four": 4,
        "five": 5,
        "six": 6,
        "seven": 7,
        "eight": 8,
        "nine": 9,
        "ten": 10,
    }
    mentions = re.findall(
        r"\bgame\s*(?:number\s*)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b",
        question.casefold(),
    )
    numbers = {int(value) if value.isdigit() else words[value] for value in mentions}
    bucket = facts.get("all_games") or {}
    title = "Most-picked heroes · all recorded games"
    if len(numbers) == 1:
        number = next(iter(numbers))
        match = next(
            (
                row
                for row in facts.get("by_game_number", [])
                if row.get("game_number") == number
            ),
            None,
        )
        if match is None:
            return None
        bucket, title = match, f"Most-picked heroes · game {number}"
    scope = facts.get("scope") or {}
    if scope.get("mode") == "playoffs" or scope.get("phase") == "playoffs":
        title += " · playoffs"
    elif scope.get("phase") == "all":
        title += " · selected matches across stages"
    ranked = bucket.get("top_picks") or []
    if not ranked:
        return None
    bars = [{"label": row["hero"], "value": row["picks"]} for row in ranked[:6]]
    coverage = facts.get("coverage") or {}
    omitted = max(0, len(ranked) - len(bars)) + int(
        bucket.get("additional_heroes_not_listed") or 0
    )
    excluded = sum(
        int(coverage.get(key) or 0)
        for key in (
            "partial_pick_games",
            "missing_scored_games",
            "ambiguous_or_omitted_games",
        )
    )
    return {
        "kind": "picks_chart",
        "title": title,
        "bars": bars,
        "complete_games": int(
            bucket.get("complete_picks", bucket.get("complete_pick_games", 0))
        ),
        "omitted_heroes": omitted,
        "incomplete_data": bool(
            excluded
            or coverage.get("missing_matches")
            or coverage.get("score_game_conflicts")
        ),
        "notice": (
            "Counts use complete games only; more heroes may be tied or ranked below."
            if omitted
            else "Counts use complete games only."
        ),
    }


def _drop_player_details(games: list[dict]) -> None:
    """Conserve memory for broad selections; hero picks remain for counting."""
    for game in games:
        game.pop("players", None)
        for team in game.get("teams", []):
            team.pop("players", None)


def analyze_rone(
    db: Session, scope: dict, on_progress: Callable[[str], None] | None = None
) -> tuple[dict, list[dict]]:
    region = scope["region"]
    week = scope.get("week") if scope.get("mode") == "week" else None
    mode = scope.get("mode")
    phase = "playoffs" if mode == "playoffs" else (scope.get("phase") or "regular")
    label = {
        "source": "Rone",
        "region": region.upper(),
        "week": week,
        "season": None,
        "mode": mode,
        "phase": phase,
    }
    if scope.get("selection_error"):
        return (
            aggregate([], source="Rone", scope=label, notice=scope["selection_error"]),
            [],
        )
    if scope.get("season_requested"):
        return (
            aggregate(
                [],
                source="Rone",
                scope=label,
                notice="Rone does not identify the season in its schedule or playoffs. The requested historical season cannot be verified; no other season was substituted.",
            ),
            [],
        )
    if on_progress:
        on_progress("loading_matches")
    feeds = ["regular", "playoffs"] if phase == "all" else [phase]
    rows: list[dict] = []
    duplicates = 0
    unavailable_feeds: list[str] = []
    stale_feed = False
    sources: list[dict] = []
    for feed in feeds:
        payload, observed, state = (
            rone_playoffs(db, region)
            if feed == "playoffs"
            else rone_schedule(db, region)
        )
        if payload is None:
            unavailable_feeds.append("playoffs" if feed == "playoffs" else "schedule")
            continue
        stale_feed |= state == "saved_stale"
        source_rows, removed = (
            rone_playoff_rows(payload, region)
            if feed == "playoffs"
            else rone_schedule_rows(payload, region, week)
        )
        rows.extend(source_rows)
        duplicates += removed
        sources.append(
            {
                "kind": "esports_feed",
                "label": f"Rone MPL {region.upper()} · "
                + (
                    "Playoffs"
                    if feed == "playoffs"
                    else (f"Week {week}" if week else "Regular season")
                ),
                "route": "esports",
                "url": f"https://arena.rone.dev/api/esports/{region}/"
                + ("playoffs" if feed == "playoffs" else "schedule"),
                "observed_at": observed.isoformat() + "Z" if observed else None,
            }
        )
    if not sources:
        return (
            aggregate(
                [],
                source="Rone",
                scope=label,
                missing=len(set(scope.get("match_ids") or [])),
                notice=f"Rone's {' and '.join(unavailable_feeds)} could not be loaded. No match data was invented; retry later.",
            ),
            [],
        )
    cross_feed_conflicts: set[str] = set()
    if phase == "all":
        seen_ids: set[str] = set()
        for row in rows:
            if row["id"] and row["id"] in seen_ids:
                cross_feed_conflicts.add(row["id"])
            elif row["id"]:
                seen_ids.add(row["id"])
        rows = [row for row in rows if row["id"] not in cross_feed_conflicts]
        duplicates += len(cross_feed_conflicts)
    unavailable_rows: list[dict] = []
    if scope.get("mode") == "matches":
        requested = scope.get("match_ids") or []
        wanted = set(requested)
        rows = [row for row in rows if row["id"] in wanted]
        missing = len(wanted - {row["id"] for row in rows})
    else:
        unavailable_rows = [row for row in rows if row["id"] is None]
        missing = 0
        rows = [row for row in rows if row["id"]]
    if len(rows) + len(unavailable_rows) > MAX_MATCHES:
        return (
            aggregate(
                [],
                source="Rone",
                scope=label,
                missing=len(rows) + len(unavailable_rows) + missing,
                duplicate_rows=duplicates,
                notice=f"This selection exceeds the {MAX_MATCHES}-match safety limit; narrow it. No partial stage was presented as complete.",
            ),
            sources,
        )
    deadline = time.monotonic() + LOAD_DEADLINE_SECONDS
    matches = []
    consecutive_failures = 0
    skipped_after_failures = False
    skipped_after_timeout = False
    for index, row in enumerate(rows):
        if on_progress:
            on_progress(f"loading_matches:{index + 1}:{len(rows)}")
        mid = row["id"]
        path = f"esports/{region}/matches/{mid}"
        validate = lambda value, mid=mid: _valid_detail(value, mid)
        score_total = (
            (row["score1"] + row["score2"])
            if row["score1"] is not None and row["score2"] is not None
            else None
        )
        saved, saved_at = _saved(db, path, validate)
        saved_games, _ = _rone_games(saved) if saved is not None else ([], 0)
        needs_recheck = bool(
            saved is not None
            and (
                any(not game["complete_picks"] for game in saved_games)
                or (score_total is not None and len(saved_games) < score_total)
            )
        )
        if time.monotonic() < deadline and consecutive_failures < 3:
            detail, seen, detail_state = load_rone(
                db, path, validate, ttl=DETAIL_TTL, refresh=needs_recheck
            )
        else:
            detail, seen, detail_state = (
                saved,
                saved_at,
                "saved_stale" if saved is not None else "unavailable",
            )
            skipped_after_failures |= consecutive_failures >= 3
            skipped_after_timeout |= time.monotonic() >= deadline
        games, ambiguous = _rone_games(detail) if detail is not None else ([], 0)
        if len(rows) + len(unavailable_rows) > 50:
            _drop_player_details(games)
        if detail_state == "unavailable":
            consecutive_failures += 1
        elif detail_state == "loaded":
            consecutive_failures = 0
        matches.append(
            {
                "match_id": mid,
                "week": row["week"],
                "phase": row.get("phase", "regular"),
                "round": row.get("round") or None,
                "team1": row["team1"],
                "team2": row["team2"],
                "status": row["status"],
                "starts_at": row["starts_at"],
                "score1": row["score1"],
                "score2": row["score2"],
                "observed_at": seen.isoformat() + "Z" if seen else None,
                "load_status": detail_state,
                "missing_scored_games": (
                    max(0, score_total - len(games))
                    if score_total is not None
                    else None
                ),
                "score_game_conflict": score_total is not None
                and row["status"].casefold() in {"completed", "finished"}
                and len(games) > score_total,
                "ambiguous_games": ambiguous,
                "games": games,
            }
        )
        if detail_state == "loaded" and index + 1 < len(rows):
            time.sleep(0.25)  # Avoid bursts against a community-hosted feed.
    for row in unavailable_rows:
        score_total = (
            (row["score1"] + row["score2"])
            if row["score1"] is not None and row["score2"] is not None
            else None
        )
        matches.append(
            {
                "match_id": None,
                "week": row["week"],
                "phase": row.get("phase", "regular"),
                "round": row.get("round") or None,
                "team1": row["team1"],
                "team2": row["team2"],
                "status": row["status"],
                "starts_at": row["starts_at"],
                "score1": row["score1"],
                "score2": row["score2"],
                "observed_at": None,
                "load_status": (
                    "conflicting_source_match"
                    if row.get("id_conflict") and row.get("phase") == "playoffs"
                    else (
                        "conflicting_source_week"
                        if row.get("id_conflict")
                        else (
                            "no_region_detail_route"
                            if region == "kh"
                            else "no_source_match_id"
                        )
                    )
                ),
                "missing_scored_games": score_total,
                "ambiguous_games": 0,
                "games": [],
            }
        )
    notice = "Rone does not report a season, bans or draft order. " "Games missing from a series score are not assumed to be present. " + (
        "Player detail was omitted for this large selection; pick totals include all complete games. "
        if len(rows) + len(unavailable_rows) > 50
        else ""
    ) + (
        "Rone does not provide a match-details route for MPL KH. "
        if region == "kh"
        else ""
    ) + (
        "The saved feed or details may be stale. "
        if stale_feed or any(m["load_status"] == "saved_stale" for m in matches)
        else ""
    ) + (
        "After repeated source errors, remaining missing matches were not fetched; retry later. "
        if skipped_after_failures
        else ""
    ) + (
        "The loading time limit was reached; remaining missing matches were not fetched. "
        if skipped_after_timeout
        else ""
    ) + (
        "A source match ID has conflicting records; it was not resolved arbitrarily. "
        if any(row.get("id_conflict") for row in unavailable_rows)
        or cross_feed_conflicts
        else ""
    ) + (
        f"Rone's {' and '.join(unavailable_feeds)} could not be loaded; the selection may be incomplete. "
        if unavailable_feeds
        else ""
    ) + (
        "No matches were listed for this source selection. "
        if not rows and not unavailable_rows and not missing
        else ""
    )
    return (
        aggregate(
            matches,
            source="Rone",
            scope=label,
            missing=missing,
            duplicate_rows=duplicates,
            notice=notice,
            player_details_omitted=len(rows) + len(unavailable_rows) > 50,
        ),
        sources,
    )


def load_aerena_detail(
    db: Session,
    row: AerenaMatch,
    *,
    deadline: float | None = None,
    load_missing: bool = True,
) -> tuple[dict, AerenaMatch]:
    """Read every saved game, then refresh an incomplete public series if possible.

    Share the match-detail endpoint's cross-worker lease and retry cooldown.
    A source failure, disabled integration, or peer timeout never discards the
    locally saved games; their missing/partial coverage is reported downstream.
    """
    from .routers.esports import (
        DETAIL_RETRY,
        DETAIL_TTL,
        ENABLED,
        _claim_detail_refresh,
        _refresh_detail_in_background,
        detail_for,
    )

    detail = detail_for(db, row)
    if not load_missing or not ENABLED:
        return detail, row
    if deadline is not None and time.monotonic() >= deadline:
        return detail, row
    games, _ambiguous = _aerena_games(detail)
    match = detail["match"]
    left, right = _obj(match.get("team1")), _obj(match.get("team2"))
    scores = [
        _int(left.get("teamScore"), low=0, high=30),
        _int(right.get("teamScore"), low=0, high=30),
    ]
    expected = sum(scores) if all(score is not None for score in scores) else None
    raw_games = detail.get("games") if isinstance(detail.get("games"), list) else []
    # An in-progress series can already have games even before a final winner
    # is recorded. Avoid fetching genuinely upcoming 0–0 fixtures.
    if not row.has_result and not raw_games and not expected:
        return detail, row
    incomplete = bool(
        not games
        or any(not game["complete_picks"] for game in games)
        or (expected is not None and len(games) < expected)
        or any(
            game.get("draft_coverage") != "complete"
            for game in raw_games
            if isinstance(game, dict)
        )
    )
    # Match-list records can contain complete picks but no player statistics.
    # Obtain the public detail once even when every saved draft looks complete.
    if (
        not incomplete
        and row.detail_fetched_at is not None
        and row.detail_fetched_at + DETAIL_TTL >= utcnow()
        and (
            row.source_updated_at is None
            or row.source_updated_at <= row.detail_fetched_at
        )
    ):
        return detail, row
    attempted = _claim_detail_refresh(db, row, incomplete=incomplete)
    mid = row.id
    if attempted:
        db.rollback()
        _refresh_detail_in_background(db.get_bind(), mid, attempted)
        db.expire_all()
        row = db.get(AerenaMatch, mid)
    else:
        # Another worker may already be fetching this match. Wait for that
        # existing request, but never block indefinitely or bypass its cooldown.
        db.refresh(row)
        peer_deadline = min(deadline or float("inf"), time.monotonic() + 25)
        while (
            row.detail_attempted_at
            and not row.detail_error
            and (
                not row.detail_fetched_at
                or row.detail_attempted_at > row.detail_fetched_at
            )
            and row.detail_attempted_at + DETAIL_RETRY > utcnow()
            and time.monotonic() < peer_deadline
        ):
            db.rollback()
            time.sleep(0.5)
            db.expire_all()
            row = db.get(AerenaMatch, mid)
            if row is None:
                raise LookupError("A selected Aerena match is no longer available.")
    if row is None:
        raise LookupError("A selected Aerena match is no longer available.")
    return detail_for(db, row), row


def analyze_aerena(
    db: Session,
    ids: list[str],
    *,
    scope: dict | None = None,
    on_progress: Callable[[str], None] | None = None,
    load_missing: bool = True,
) -> tuple[dict, list[dict]]:
    matches = []
    sources = []
    deadline = time.monotonic() + LOAD_DEADLINE_SECONDS
    consecutive_failures = 0
    skipped_after_failures = False
    skipped_after_timeout = False
    for index, mid in enumerate(ids[:MAX_MATCHES]):
        row = db.get(AerenaMatch, mid)
        if row is None:
            raise LookupError(
                "A selected match is no longer in the saved Aerena feed. Remove it and try again."
            )
        if on_progress:
            on_progress(f"loading_matches:{index + 1}:{len(ids)}")
        allow_load = (
            load_missing and consecutive_failures < 3 and time.monotonic() < deadline
        )
        skipped_after_failures |= (
            load_missing and not allow_load and consecutive_failures >= 3
        )
        skipped_after_timeout |= (
            load_missing and not allow_load and time.monotonic() >= deadline
        )
        previous_attempt = getattr(row, "detail_attempted_at", None)
        detail, row = load_aerena_detail(
            db, row, deadline=deadline, load_missing=allow_load
        )
        if allow_load and getattr(row, "detail_attempted_at", None) != previous_attempt:
            if getattr(row, "detail_error", ""):
                consecutive_failures += 1
            else:
                consecutive_failures = 0
            # Do not burst public source calls for a whole season selection.
            if index + 1 < len(ids):
                time.sleep(0.25)
        games, ambiguous = _aerena_games(detail)
        if len(ids) > 50:
            _drop_player_details(games)
        match = detail["match"]
        left, right = _obj(match.get("team1")), _obj(match.get("team2"))

        def team_name(value: dict) -> str:
            return _text(value.get("teamName") or value.get("teamCode"), 80) or "TBD"

        scores = [
            _int(left.get("teamScore"), low=0, high=30),
            _int(right.get("teamScore"), low=0, high=30),
        ]
        expected = sum(scores) if all(score is not None for score in scores) else None
        matches.append(
            {
                "match_id": mid,
                "season_id": _text(match.get("league_id"), 80) or None,
                "season": _text(
                    match.get("league_code") or match.get("league_name"), 100
                )
                or None,
                "region": _text(match.get("league_region"), 30) or None,
                "week": aerena_week(row),
                "stage": row.stage or None,
                "phase": (
                    "playoffs"
                    if aerena_playoff_stage(row.stage)
                    else "other_or_unknown"
                ),
                "team1": team_name(left),
                "team2": team_name(right),
                "starts_at": match.get("starts_at"),
                "status": match.get("status"),
                "score1": scores[0],
                "score2": scores[1],
                "observed_at": match.get("fetched_at"),
                "detail_error": detail.get("detail_error"),
                "missing_scored_games": (
                    max(0, expected - len(games)) if expected is not None else None
                ),
                "score_game_conflict": expected is not None
                and match.get("status") == "completed"
                and len(games) > expected,
                "ambiguous_games": ambiguous,
                "games": games,
            }
        )
        sources.append(
            {
                "kind": "match",
                "label": f"Aerena: {team_name(left)} vs {team_name(right)}",
                "match_id": mid,
                "url": match.get("source_url"),
                "observed_at": match.get("fetched_at"),
            }
        )
    if len(sources) > 50:
        omitted = len(sources) - 50
        sources = sources[:50] + [
            {
                "kind": "esports_feed",
                "label": f"Aerena: {omitted} more selected matches included",
                "route": "esports",
            }
        ]
    return (
        aggregate(
            matches,
            source="Aerena",
            scope=scope or {"mode": "matches"},
            player_details_omitted=len(ids) > 50,
            notice=(
                "Aerena match IDs and source week labels are used where available; unlabeled games are not assigned a week. "
                + (
                    "Player detail was omitted for this large selection; pick totals include all complete games. "
                    if len(ids) > 50
                    else ""
                )
                + (
                    "Further public detail requests were paused after repeated failures; saved games are still included. "
                    if skipped_after_failures
                    else ""
                )
                + (
                    "The loading time limit was reached; remaining matches use saved games only. "
                    if skipped_after_timeout
                    else ""
                )
            ),
        ),
        sources,
    )


def ensure_aerena_season(
    db: Session,
    league_id: str,
    on_progress: Callable[[str], None] | None = None,
    *,
    refresh: bool = False,
) -> tuple[bool, str]:
    """Request a missing season via the existing shared worker and wait for it.

    The worker remains responsible for the global Aerena lease and transactional
    validation. A separate short cooldown prevents repeated member-triggered
    attempts when a public source is unavailable.
    """
    from .aerena_models import AerenaSyncState
    from .aerena_service import ENABLED, request_refresh
    from .aerena_client import AerenaError

    league = db.get(AerenaLeague, league_id)
    if not league:
        raise LookupError("That Aerena season is not in the saved catalog.")
    baseline = league.matches_fetched_at
    if baseline and not refresh:
        return True, "saved"
    if not ENABLED:
        return (
            False,
            "Aerena loading is disabled on this server. Saved matches may be incomplete.",
        )
    requested_at = utcnow()
    key, token = _claim(db, f"aerena-season/{league_id}", lease_seconds=150)
    if token is None:
        state = db.get(PublicLoadLease, key)
        if not state or not state.lease_until or state.lease_until < utcnow():
            return (
                False,
                "Aerena could not load that season recently. Please retry shortly.",
            )
    if token:
        try:
            request_refresh(db, league_id)
        except AerenaError:
            _finish(db, key, token, "The season could not be queued.")
            return (
                False,
                "Aerena is already busy or the season could not be queued. Please retry.",
            )
    deadline = time.monotonic() + 105
    try:
        while time.monotonic() < deadline:
            db.expire_all()
            league = db.get(AerenaLeague, league_id)
            if (
                league
                and league.matches_fetched_at
                and (baseline is None or league.matches_fetched_at > baseline)
            ):
                return True, "loaded"
            state = db.get(AerenaSyncState, 1)
            if (
                league
                and league.matches_error
                and state
                and state.last_finished_at
                and state.last_finished_at >= requested_at
                and (
                    not state.requested_at
                    and (not state.lease_until or state.lease_until < utcnow())
                )
            ):
                return (
                    False,
                    "Aerena could not load that season. Saved matches were retained.",
                )
            if on_progress:
                on_progress("loading_matches")
            db.rollback()
            time.sleep(1)
        return (
            False,
            "Aerena is taking longer than expected; use saved matches or retry later.",
        )
    finally:
        if token:
            db.rollback()
            _finish(db, key, token)


def analyze_aerena_scope(
    db: Session, scope: dict, on_progress: Callable[[str], None] | None = None
) -> tuple[dict, list[dict]]:
    if scope.get("mode") == "matches":
        ids = scope.get("match_ids") or []
        if scope.get("league_id"):
            for mid in ids:
                row = db.get(AerenaMatch, mid)
                if not row or row.league_id != scope["league_id"]:
                    raise LookupError(
                        "A selected match is not in the chosen Aerena season."
                    )
        league = (
            db.get(AerenaLeague, scope["league_id"]) if scope.get("league_id") else None
        )
        stage_flags = {
            aerena_playoff_stage(row.stage)
            for mid in ids
            if (row := db.get(AerenaMatch, mid))
        }
        selected_phase = (
            "all"
            if len(stage_flags) > 1
            else "playoffs" if stage_flags == {True} else None
        )
        return analyze_aerena(
            db,
            ids,
            scope={
                "mode": "matches",
                "region": (scope.get("region") or "").upper() or None,
                "season": league.code if league else None,
                "season_id": league.id if league else None,
                "phase": selected_phase,
            },
            on_progress=on_progress,
        )
    if scope.get("selection_error"):
        label = {
            "mode": scope.get("mode", "week"),
            "region": (scope.get("region") or "").upper(),
            "week": scope.get("week"),
            "season": scope.get("season_number"),
        }
        return (
            aggregate(
                [], source="Aerena", scope=label, notice=scope["selection_error"]
            ),
            [],
        )
    league_id, week = scope["league_id"], scope.get("week")
    playoffs = scope.get("mode") == "playoffs"
    league = db.get(AerenaLeague, league_id)
    if league is None:
        raise LookupError("That Aerena season is not in the saved catalog.")
    stale = bool(
        league.matches_fetched_at
        and league.matches_fetched_at + timedelta(hours=24) < utcnow()
    )
    loaded, load_note = ensure_aerena_season(db, league_id, on_progress, refresh=stale)
    db.expire_all()
    league = db.get(AerenaLeague, league_id)
    rows = (
        db.query(AerenaMatch)
        .filter_by(league_id=league_id)
        .order_by(AerenaMatch.starts_at, AerenaMatch.id)
        .limit(5001)
        .all()
    )
    label = {
        "mode": "playoffs" if playoffs else "week",
        "season": league.code,
        "season_id": league_id,
        "region": (scope.get("region") or "").upper() or None,
        "week": week,
    }
    if len(rows) > 5000:
        return (
            aggregate(
                [],
                source="Aerena",
                scope=label,
                notice="The season exceeds the safe scan limit; no partial stage was presented as complete.",
            ),
            [],
        )
    unknown = sum(
        aerena_week(row) is None and not aerena_playoff_stage(row.stage) for row in rows
    )
    unknown_stage = sum(not (row.stage or "").strip() for row in rows)
    ids = (
        [row.id for row in rows if aerena_playoff_stage(row.stage)]
        if playoffs
        else [row.id for row in rows if aerena_week(row) == week]
    )
    if len(ids) > MAX_MATCHES:
        return (
            aggregate(
                [],
                source="Aerena",
                scope=label,
                missing=len(ids),
                notice=f"This stage exceeds the {MAX_MATCHES}-match safety limit; select individual matches instead.",
            ),
            [],
        )
    facts, sources = analyze_aerena(db, ids, scope=label, on_progress=on_progress)
    if playoffs:
        facts["coverage"]["season_matches_without_stage_label"] = unknown_stage
        facts["notice"] += (
            " Only source-labelled playoff, bracket, knockout or final stages are included; group/regular final weeks are not treated as playoffs. "
            f"{unknown_stage} season match(es) had no stage label; other missing or differently labelled playoff matches cannot be inferred."
        )
        if not ids:
            facts[
                "notice"
            ] += " No source-labelled playoff matches are saved for this season."
    else:
        facts["coverage"]["season_matches_without_week_label"] = unknown
        selected_ids = set(ids)
        unknown_selected = sum(
            not (row.stage or "").strip() for row in rows if row.id in selected_ids
        )
        facts["coverage"]["selected_matches_without_stage_label"] = unknown_selected
        facts["notice"] += (
            f" {unknown} non-playoff season match(es) had no unambiguous source week and were not assigned to this week."
            + (
                f" {unknown_selected} selected match(es) have no source stage label, so their stage is unverified."
                if unknown_selected
                else ""
            )
        )
    if not loaded:
        facts["notice"] += f" {load_note}"
    return facts, sources
