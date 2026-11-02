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

from sqlalchemy import DateTime, String, Text, or_, update
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

MAX_MATCHES = 24
MAX_GAMES_PER_MATCH = 30
MAX_SCHEDULE_ROWS = 1_000
LOAD_DEADLINE_SECONDS = 180
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
    db: Session, path: str, validate: Callable[[Any], bool]
) -> tuple[Any | None, datetime | None]:
    row = db.get(IntelSnapshot, snapshot_key("public", path))
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
) -> tuple[Any | None, datetime | None, str]:
    """Read or fetch one allowlisted public path; retain saved data on failure.

    Caller constructs the path from a validated region and source match ID.
    No user questions, credentials or private data go to the public source.
    """
    saved, observed = _saved(db, path, validate)
    if saved is not None and not refresh and observed and observed + ttl > utcnow():
        return saved, observed, "saved"
    key, token = _claim(db, path)
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
                current, current_at = _saved(db, path, validate)
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

        status, payload = _public_fetch(path, "")
        if status != 200 or not validate(payload):
            raise ValueError("Unrecognized or unavailable source data.")
        cache_payload(payload)
        row = save_snapshot(db, "public", path, "", payload)
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
    """Recognize a source + region + week without guessing a season."""
    from .ai_rone import requested_region

    if not re.search(r"\b(rone|mpl|aerena)\b", question, re.I):
        return None
    week_pattern = r"(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)"
    hits = list(re.finditer(rf"\bweeks?\s*[-:#]?\s*({week_pattern})\b", question, re.I))
    region = requested_region(question)
    if not hits or not region:
        return None
    hit = hits[0]
    word = hit.group(1).casefold()
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
    week = words.get(word) or _int(word)
    if not week:
        return None
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
    if multiple_weeks or (explicit_rone and explicit_aerena):
        return {
            "source": "aerena" if use_aerena else "rone",
            "mode": "week",
            "region": region,
            "week": week,
            "selection_error": "Choose one source and one week at a time in the picker; no other weeks or sources were silently combined.",
        }
    if not use_aerena:
        return {
            "source": "rone",
            "mode": "week",
            "region": region,
            "week": week,
            "season_requested": bool(seasons),
        }
    result: dict[str, Any] = {
        "source": "aerena",
        "mode": "week",
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
                    }
                )
            projected.append(
                {
                    "team": _text(_obj(team.get("team")).get("name"), 80) or None,
                    "won": (
                        team.get("winner")
                        if isinstance(team.get("winner"), bool)
                        else None
                    ),
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
                "duration": _text(item.get("duration"), 24) or None,
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
                "hero": _hero(row.get("hero_name")) or None,
                "kills": _int(row.get("kills"), low=0, high=200),
                "deaths": _int(row.get("deaths"), low=0, high=200),
                "assists": _int(row.get("assists"), low=0, high=200),
            }
            for row in stats[:10]
            if isinstance(row, dict)
        ]
        result.append(
            {
                "number": number,
                "picks": [name for name in picks if name],
                "complete_picks": complete,
                "bans": [name for name in bans if name] if bans else None,
                "players": players,
                "winner": _text(
                    _obj(game.get("winner")).get("teamName")
                    or _obj(game.get("winner")).get("teamCode"),
                    80,
                )
                or None,
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
    # Counts are computed first over all saved games. Compact bulky player
    # details only after counting, so context limits never change the ranking.
    if len(json.dumps(result, ensure_ascii=False)) > 90_000:
        for match in matches:
            for game in match.get("games", []):
                game.pop("players", None)
                for team in game.get("teams", []):
                    team.pop("players", None)
        result[
            "notice"
        ] += " Player detail was omitted from the bounded context; pick counts still include every complete game."
    if len(json.dumps(result, ensure_ascii=False)) > 90_000:
        for match in matches:
            for game in match.get("games", []):
                game.pop("picks", None)
                game.pop("bans", None)
                for team in game.get("teams", []):
                    team.pop("heroes", None)
        for bucket in [result["all_games"], *result["by_game_number"]]:
            ranked = bucket["top_picks"]
            if len(ranked) > 40:
                leaders = sum(row["picks"] == ranked[0]["picks"] for row in ranked)
                bucket["additional_heroes_not_listed"] = len(ranked) - 40
                bucket["tied_leaders_omitted"] = max(0, leaders - 40)
                bucket["top_picks"] = ranked[:40]
        result[
            "notice"
        ] += " Per-game hero detail and some ranked heroes were compacted for context; counts are unchanged. If tied_leaders_omitted is nonzero, say more heroes are tied rather than claiming the displayed leaders are exhaustive."
    if len(json.dumps(result, ensure_ascii=False)) > 120_000:
        for match in matches:
            match["games"] = [
                {"number": game["number"], "complete_picks": game["complete_picks"]}
                for game in match.get("games", [])
            ]
        for bucket in [result["all_games"], *result["by_game_number"]]:
            ranked = bucket["top_picks"]
            if len(ranked) > 10:
                leaders = sum(row["picks"] == ranked[0]["picks"] for row in ranked)
                bucket["additional_heroes_not_listed"] = (
                    bucket.get("additional_heroes_not_listed", 0) + len(ranked) - 10
                )
                bucket["tied_leaders_omitted"] = bucket.get(
                    "tied_leaders_omitted", 0
                ) + max(0, leaders - 10)
                bucket["top_picks"] = ranked[:10]
        result[
            "notice"
        ] += " Only game numbers and pick completeness fit in detailed context; summary counts remain full-scope."
    return result


def analyze_rone(
    db: Session, scope: dict, on_progress: Callable[[str], None] | None = None
) -> tuple[dict, list[dict]]:
    region = scope["region"]
    week = scope.get("week") if scope.get("mode") == "week" else None
    label = {
        "source": "Rone",
        "region": region.upper(),
        "week": week,
        "season": None,
        "mode": scope.get("mode"),
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
                notice="Rone does not identify the season in its schedule. The requested historical season cannot be verified; no other season was substituted.",
            ),
            [],
        )
    if on_progress:
        on_progress("loading_matches")
    payload, observed, state = rone_schedule(db, region)
    if payload is None:
        return (
            aggregate(
                [],
                source="Rone",
                scope=label,
                notice="Rone's schedule could not be loaded. No match data was invented; retry later.",
            ),
            [],
        )
    rows, duplicates = rone_schedule_rows(payload, region, week)
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
                notice=f"This week exceeds the {MAX_MATCHES}-match safety limit; narrow the selection. No partial week was presented as complete.",
            ),
            [],
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
        if detail_state == "unavailable":
            consecutive_failures += 1
        elif detail_state == "loaded":
            consecutive_failures = 0
        matches.append(
            {
                "match_id": mid,
                "week": row["week"],
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
                "team1": row["team1"],
                "team2": row["team2"],
                "status": row["status"],
                "starts_at": row["starts_at"],
                "score1": row["score1"],
                "score2": row["score2"],
                "observed_at": None,
                "load_status": (
                    "conflicting_source_week"
                    if row.get("id_conflict")
                    else "no_source_match_id"
                ),
                "missing_scored_games": score_total,
                "ambiguous_games": 0,
                "games": [],
            }
        )
    notice = "Rone does not report a season, bans or draft order. " "Games missing from a series score are not assumed to be present. " + (
        "The saved schedule or details may be stale. "
        if state == "saved_stale"
        or any(m["load_status"] == "saved_stale" for m in matches)
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
        "A source match ID appeared in multiple weeks; those entries are excluded rather than assigned arbitrarily. "
        if any(row.get("id_conflict") for row in unavailable_rows)
        else ""
    ) + (
        "No matches were listed for this source week. "
        if not rows and not unavailable_rows and not missing
        else ""
    )
    source = {
        "kind": "esports_feed",
        "label": f"Rone MPL {region.upper()}"
        + (f" · Week {week}" if week else " · selected matches"),
        "route": "esports",
        "url": f"https://arena.rone.dev/api/esports/{region}/schedule",
        "observed_at": observed.isoformat() + "Z" if observed else None,
    }
    return aggregate(
        matches,
        source="Rone",
        scope=label,
        missing=missing,
        duplicate_rows=duplicates,
        notice=notice,
    ), [source]


def analyze_aerena(
    db: Session,
    ids: list[str],
    *,
    scope: dict | None = None,
    on_progress: Callable[[str], None] | None = None,
    load_missing: bool = True,
) -> tuple[dict, list[dict]]:
    from .routers.esports import (
        ENABLED,
        _claim_detail_refresh,
        _refresh_detail_in_background,
        detail_for,
    )

    matches = []
    sources = []
    deadline = time.monotonic() + LOAD_DEADLINE_SECONDS
    for index, mid in enumerate(ids[:MAX_MATCHES]):
        row = db.get(AerenaMatch, mid)
        if row is None:
            raise LookupError(
                "A selected match is no longer in the saved Aerena feed. Remove it and try again."
            )
        if on_progress:
            on_progress(f"loading_matches:{index + 1}:{len(ids)}")
        if load_missing and ENABLED and row.has_result and time.monotonic() < deadline:
            # Season snapshots already include drafts. Only request detail when
            # games/picks are missing; share the existing cross-worker cooldown.
            current = detail_for(db, row)
            saved_games, _ = _aerena_games(current)
            if not saved_games or any(
                not game["complete_picks"] for game in saved_games
            ):
                attempted = _claim_detail_refresh(db, row)
                if attempted:
                    db.rollback()
                    _refresh_detail_in_background(db.get_bind(), mid, attempted)
                    db.expire_all()
                    row = db.get(AerenaMatch, mid)
                else:
                    # Another worker may already be fetching the same missing
                    # detail. Wait briefly rather than analyzing its old state.
                    db.refresh(row)
                    pending = (
                        row.detail_attempted_at
                        and not row.detail_error
                        and (
                            not row.detail_fetched_at
                            or row.detail_attempted_at > row.detail_fetched_at
                        )
                    )
                    peer_deadline = min(deadline, time.monotonic() + 25)
                    while pending and time.monotonic() < peer_deadline:
                        db.rollback()
                        time.sleep(0.5)
                        db.expire_all()
                        row = db.get(AerenaMatch, mid)
                        if row is None:
                            raise LookupError(
                                "A selected Aerena match is no longer available."
                            )
                        pending = (
                            row.detail_attempted_at
                            and not row.detail_error
                            and (
                                not row.detail_fetched_at
                                or row.detail_attempted_at > row.detail_fetched_at
                            )
                        )
        detail = detail_for(db, row)
        games, ambiguous = _aerena_games(detail)
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
                "week": aerena_week(row),
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
                "score_game_conflict": expected is not None and len(games) > expected,
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
    return (
        aggregate(
            matches,
            source="Aerena",
            scope=scope or {"mode": "matches"},
            notice="Aerena match IDs and source week labels are used where available; unlabeled games are not assigned a week.",
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
        return analyze_aerena(
            db, ids, scope={"mode": "matches"}, on_progress=on_progress
        )
    if scope.get("selection_error"):
        label = {
            "mode": "week",
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
    league_id, week = scope["league_id"], scope["week"]
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
        "mode": "week",
        "season": league.code,
        "season_id": league_id,
        "week": week,
    }
    if len(rows) > 5000:
        return (
            aggregate(
                [],
                source="Aerena",
                scope=label,
                notice="The season exceeds the safe scan limit; no partial week was presented as complete.",
            ),
            [],
        )
    unknown = sum(aerena_week(row) is None for row in rows)
    ids = [row.id for row in rows if aerena_week(row) == week]
    if len(ids) > MAX_MATCHES:
        return (
            aggregate(
                [],
                source="Aerena",
                scope=label,
                missing=len(ids),
                notice=f"This week exceeds the {MAX_MATCHES}-match safety limit; select individual matches instead.",
            ),
            [],
        )
    facts, sources = analyze_aerena(db, ids, scope=label, on_progress=on_progress)
    facts["coverage"]["season_matches_without_week_label"] = unknown
    facts["notice"] += (
        f" {unknown} season match(es) had no unambiguous source week and were not assigned to this week."
        + (f" {load_note}" if not loaded else "")
    )
    return facts, sources
