"""Validate, persist and refresh Aerena's public esports observations.

Only fields actually reported by the source are saved; the source itself may
be unverified. Historical observations are retained while the latest normalized
view is updated idempotently. No private Clover records are imported, and a
missing draft is never manufactured.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import or_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .aerena_client import AerenaClient, AerenaError, client
from .aerena_models import (AerenaDraftEvent, AerenaGame, AerenaHero, AerenaLeague,
                            AerenaMatch, AerenaPlayerGameStat, AerenaSeries,
                            AerenaSnapshot, AerenaSyncState)
from .db import SessionLocal
from .models import dumps, loads, utcnow

logger = logging.getLogger("clover.aerena")
ENABLED = os.getenv("CLOVER_AERENA_ENABLED", "1").strip().lower() not in {"0", "false", "off", "no"}
SYNC_SECONDS = max(300, int(os.getenv("CLOVER_AERENA_SYNC_SECONDS", "7200")))
FAIL_RETRY_SECONDS = min(SYNC_SECONDS, 900)
LEASE_SECONDS = 600
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,120}$")
# Aerena's public client assigns these source-specific orders to the two sides.
STANDARD_SEQUENCE = {
    "bluePickOrders": [1, 4, 5, 8, 9], "redPickOrders": [2, 3, 6, 7, 10],
    "blueBanOrders": [1, 3, 5, 8, 10], "redBanOrders": [2, 4, 6, 7, 9],
}
_wake = threading.Event()
_stop = threading.Event()
_worker: threading.Thread | None = None


def parse_date(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc).replace(tzinfo=None) if parsed.tzinfo else parsed
    except ValueError:
        return None


def iso(value: datetime | None) -> str | None:
    return value.isoformat(timespec="seconds") + "Z" if value else None


def _text(value: Any, limit: int = 200) -> str:
    return str(value).strip()[:limit] if value is not None else ""


def _id(value: Any, limit: int = 80) -> str:
    if isinstance(value, dict):
        value = value.get("_id") or value.get("league") or value.get("series")
    if not isinstance(value, str) or len(value) > limit or not ID_RE.fullmatch(value):
        return ""
    return value


def _object(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _snapshot(db: Session, kind: str, external_id: str, payload: dict, source_updated: datetime | None) -> None:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(raw.encode()).hexdigest()
    previous = (db.query(AerenaSnapshot).filter_by(kind=kind, external_id=external_id)
                .order_by(AerenaSnapshot.id.desc()).first())
    if previous is None or previous.sha256 != digest:
        db.add(AerenaSnapshot(kind=kind, external_id=external_id, sha256=digest,
                              payload_json=raw, source_updated_at=source_updated, observed_at=utcnow()))


def save_series(db: Session, rows: list[dict]) -> None:
    if not rows:
        raise AerenaError("Aerena returned an empty series catalog; existing data was kept.")
    now = utcnow()
    seen: set[str] = set()
    for data in rows:
        sid, code = _id(data.get("_id")), _text(data.get("seriesCode"), 100)
        if not sid or not code or sid in seen:
            raise AerenaError("Aerena returned an unexpected series record.")
        seen.add(sid)
        row = db.get(AerenaSeries, sid)
        if row is None:
            row = AerenaSeries(id=sid)
            db.add(row)
        row.code = code
        row.name = _text(data.get("seriesName"), 200) or code
        row.region = _text(data.get("regionCode"), 30)
        row.kind = _text(data.get("seriesType"), 50)
        row.logo = _text(data.get("seriesLogo"), 2000)
        row.source_updated_at = parse_date(data.get("updatedAt"))
        row.fetched_at = now


def save_heroes(db: Session, rows: list[dict]) -> None:
    if not rows:
        raise AerenaError("Aerena returned an empty hero catalog; existing data was kept.")
    now = utcnow()
    seen: set[str] = set()
    for data in rows:
        hid, name = _id(data.get("_id")), _text(data.get("heroName"), 100)
        if not hid or not name or hid in seen:
            raise AerenaError("Aerena returned an unexpected hero record.")
        seen.add(hid)
        row = db.get(AerenaHero, hid)
        if row is None:
            row = AerenaHero(id=hid)
            db.add(row)
        row.name = name
        row.roles_json = dumps(data.get("roles") if isinstance(data.get("roles"), list) else [])
        row.positions_json = dumps(data.get("positions") if isinstance(data.get("positions"), list) else [])
        row.source_updated_at = parse_date(data.get("updatedAt"))
        row.fetched_at = now


def save_league(db: Session, data: dict) -> AerenaLeague:
    lid, sid = _id(data.get("_id")), _id(data.get("series"))
    code = _text(data.get("leagueCode"), 100)
    if not lid or not sid or not code:
        raise AerenaError("Aerena returned an unexpected league record.")
    row = db.get(AerenaLeague, lid)
    if row is None:
        row = AerenaLeague(id=lid)
        db.add(row)
    incoming = parse_date(data.get("updatedAt"))
    if row.source_updated_at and incoming and incoming < row.source_updated_at:
        return row
    row.series_id = sid
    row.code = code
    row.name = _text(data.get("leagueName"), 200) or code
    row.region = _text(data.get("regionCode"), 30)
    row.logo = _text(data.get("leagueLogo"), 2000)
    row.starts_at = parse_date(data.get("startDate"))
    row.ends_at = parse_date(data.get("endDate"))
    row.is_pro = data.get("isPro") if isinstance(data.get("isPro"), bool) else None
    row.stages_json = dumps(data.get("stages") if isinstance(data.get("stages"), list) else [])
    row.draft_sequence_json = dumps(_object(data.get("draftSequence")))
    row.raw_json = dumps(data)
    row.source_updated_at = incoming
    row.fetched_at = utcnow()
    _snapshot(db, "league", lid, data, incoming)
    return row


def _draft_rows(data: Any, configuration: dict) -> tuple[str, list[dict]]:
    if not isinstance(data, list):
        # An invalid field is not a source assertion that a draft is empty.
        # Abort the transaction rather than erase previously saved events.
        raise AerenaError("Aerena returned an invalid draft; saved data was kept.")
    if not data:
        return "none", []
    records: list[dict] = []
    seen: set[tuple[str, int]] = set()
    seen_heroes: set[str] = set()
    ambiguous = False
    for event in data:
        if not isinstance(event, dict):
            ambiguous = True
            continue
        kind = event.get("type")
        order = event.get("order")
        hero = _id(event.get("hero"))
        if kind not in ("Pick", "Ban") or not isinstance(order, int) or isinstance(order, bool) or not 1 <= order <= 10 or not hero:
            ambiguous = True
            continue
        if (kind, order) in seen or hero in seen_heroes:
            ambiguous = True
            continue
        seen.add((kind, order))
        seen_heroes.add(hero)
        records.append({"kind": kind, "source_order": order, "hero_id": hero,
                        "player_id": _id(event.get("player")), "player_ign": _text(event.get("playerIGN"), 100),
                        "position": _text(event.get("position"), 30)})
    # Duplicate/malformed source slots are not safely orderable; keep the raw
    # snapshot but do not claim an event history for that game.
    if ambiguous:
        return "ambiguous", []
    complete = len(records) == 20 and all((kind, n) in seen for kind in ("Ban", "Pick") for n in range(1, 11))
    source_sequence = all(configuration.get(key) == expected for key, expected in STANDARD_SEQUENCE.items())
    for event in records:
        order, kind = event["source_order"], event["kind"]
        # Side attribution comes from this league's own draftSequence; if that
        # configuration is missing or different, keep it unknown.
        if source_sequence:
            event["side"] = "Blue" if order in configuration["blue" + kind + "Orders"] else "Red"
        else:
            event["side"] = None
        # Aerena's client defines the interleaving for this standard 20-slot
        # format. We do not create a combined sequence for incomplete drafts.
        if complete and source_sequence:
            event["sequence"] = (order if order <= 6 else order + 6) if kind == "Ban" else (order + 6 if order <= 6 else order + 10)
        else:
            event["sequence"] = None
    return ("complete" if complete and source_sequence else "partial"), records


def save_match(db: Session, data: dict, league: AerenaLeague) -> AerenaMatch:
    match_id = _id(data.get("matchId"), 120)
    source_id = _id(data.get("_id"))
    source_league = _id(_object(data.get("league")).get("league"))
    if not match_id or not source_id or source_league != league.id:
        raise AerenaError("Aerena returned a match for an unexpected league.")
    # Serialize normalization with on-demand detail refreshes in multi-worker
    # Postgres deployments; SQLite serializes the write transaction instead.
    row = db.query(AerenaMatch).filter_by(id=match_id).with_for_update().one_or_none()
    if row is not None and (row.league_id != league.id or row.source_id != source_id):
        raise AerenaError("Aerena returned conflicting match identifiers.")
    if row is None:
        row = AerenaMatch(id=match_id, source_id=source_id, league_id=league.id)
        db.add(row)
    incoming = parse_date(data.get("updatedAt"))
    if row.source_updated_at and incoming and incoming < row.source_updated_at:
        return row
    team1, team2 = _object(data.get("team1")), _object(data.get("team2"))
    winner = _object(data.get("matchWinner"))
    row.stage = _text(data.get("stage"), 120)
    row.format = _text(data.get("format"), 30)
    row.starts_at = parse_date(data.get("matchDate"))
    row.team1_json, row.team2_json, row.winner_json = dumps(team1), dumps(team2), dumps(winner)
    row.team1_name = _text(team1.get("teamName") or team1.get("teamCode"), 180)
    row.team2_name = _text(team2.get("teamName") or team2.get("teamCode"), 180)
    row.is_draw = data.get("isDraw") is True
    row.has_result = bool(_id(winner.get("team"))) or row.is_draw
    row.source_verified = data.get("isVerified") if isinstance(data.get("isVerified"), bool) else None
    row.raw_json = dumps(data)
    row.source_updated_at = incoming
    row.fetched_at = utcnow()
    _snapshot(db, "match", match_id, data, incoming)

    games = data.get("games")
    if not isinstance(games, list):
        # Missing is not equivalent to an upstream statement that no games exist.
        return row
    configuration = loads(league.draft_sequence_json, {})
    if not isinstance(configuration, dict):
        configuration = {}
    draft_count = 0
    valid_games: list[tuple[dict, str, int]] = []
    seen_games: set[str] = set()
    seen_numbers: set[int] = set()
    for game in games:
        if not isinstance(game, dict):
            raise AerenaError("Aerena returned an unexpected game record.")
        gid, number = _id(game.get("_id")), game.get("gameNumber")
        if not gid or not isinstance(number, int) or isinstance(number, bool) or not 1 <= number <= 30 or gid in seen_games or number in seen_numbers:
            raise AerenaError("Aerena returned ambiguous game identifiers.")
        seen_games.add(gid)
        seen_numbers.add(number)
        valid_games.append((game, gid, number))
    db.flush()
    old_by_number = {game.number: game for game in db.query(AerenaGame).filter_by(match_id=match_id).all()}
    scores = (team1.get("teamScore"), team2.get("teamScore"))
    scored_games = sum(scores) if all(isinstance(score, int) and not isinstance(score, bool) and 0 <= score <= 30 for score in scores) else None
    score_consistent_correction = row.has_result and scored_games is not None and scored_games > 0 and len(valid_games) == scored_games
    keep_missing = len(valid_games) < len(old_by_number) and not score_consistent_correction
    # A shorter list is not proof that the source removed old games, especially
    # while a series is still in progress. Retain observations unless a final,
    # score-consistent correction confirms the shorter result.
    if keep_missing:
        row.detail_fetched_at = None
        row.detail_error = "The latest source list was incomplete; previously saved games were retained and may be stale."
    for game, gid, number in valid_games:
        game_row = db.get(AerenaGame, gid)
        if game_row and game_row.match_id != match_id:
            raise AerenaError("Aerena returned conflicting game identifiers.")
        if game_row is None:
            # A source correction can assign a new ID to the same numbered
            # game. Remove the old normalized row first; immutable snapshots
            # retain the previous observation and its draft.
            replaced = old_by_number.get(number)
            if replaced is not None:
                db.query(AerenaDraftEvent).filter_by(game_id=replaced.id).delete(synchronize_session=False)
                db.query(AerenaPlayerGameStat).filter_by(match_id=match_id, game_number=number).delete(synchronize_session=False)
                row.detail_fetched_at = None
                row.detail_attempted_at = None
                row.detail_error = "Game data changed; player details need a fresh source check."
                db.delete(replaced)
                db.flush()
            game_row = AerenaGame(id=gid, match_id=match_id, number=number)
            db.add(game_row)
        elif game_row.number != number:
            raise AerenaError("Aerena changed an existing game number.")
        seconds = game.get("gameLength")
        game_row.duration_seconds = seconds if isinstance(seconds, int) and not isinstance(seconds, bool) and seconds >= 0 else None
        game_row.team1_json, game_row.team2_json = dumps(_object(game.get("team1"))), dumps(_object(game.get("team2")))
        game_row.winner_json, game_row.mvp_json = dumps(_object(game.get("gameWinner"))), dumps(_object(game.get("gameMVP")))
        game_row.fetched_at = utcnow()
        if game.get("draft") is not None:
            coverage, events = _draft_rows(game.get("draft"), configuration)
            game_row.draft_coverage = coverage
            db.query(AerenaDraftEvent).filter_by(game_id=gid).delete(synchronize_session=False)
            db.flush()
            for event in events:
                db.add(AerenaDraftEvent(game_id=gid, match_id=match_id, **event, fetched_at=utcnow()))
            draft_count += len(events)
        else:
            # Omitted/null means unknown, not an instruction to erase previously
            # recorded events. Their original observation times are retained.
            draft_count += db.query(AerenaDraftEvent).filter_by(game_id=gid).count()
    # An explicit games list is authoritative for the latest view. Snapshots
    # above preserve previous source revisions, including removed games.
    old_games = db.query(AerenaGame).filter_by(match_id=match_id).all()
    retained_ids = []
    for old in old_games:
        if old.id not in seen_games:
            if keep_missing and old.number not in seen_numbers:
                retained_ids.append(old.id)
                continue
            db.query(AerenaDraftEvent).filter_by(game_id=old.id).delete(synchronize_session=False)
            db.query(AerenaPlayerGameStat).filter_by(match_id=match_id, game_number=old.number).delete(synchronize_session=False)
            row.detail_fetched_at = None
            row.detail_attempted_at = None
            row.detail_error = "Game data changed; player details need a fresh source check."
            db.delete(old)
    if retained_ids:
        draft_count += db.query(AerenaDraftEvent).filter(AerenaDraftEvent.game_id.in_(retained_ids)).count()
    row.game_count = len(valid_games) + len(retained_ids)
    row.draft_event_count = draft_count
    return row


def save_match_detail(db: Session, detail: dict, league: AerenaLeague) -> AerenaMatch:
    data, stats = detail.get("match"), detail.get("playerGameStats")
    if not isinstance(data, dict) or not isinstance(stats, list):
        raise AerenaError("Aerena returned an unexpected match-detail record.")
    match_id, source_id = _id(data.get("matchId"), 120), _id(data.get("_id"))
    if not match_id or not source_id:
        raise AerenaError("Aerena returned an unexpected match-detail identifier.")
    valid: list[dict] = []
    seen: set[str] = set()
    for stat in stats:
        if not isinstance(stat, dict):
            raise AerenaError("Aerena returned an unexpected player-stat record.")
        stat_id, game_number = _id(stat.get("_id")), stat.get("gameNumber")
        stat_match = _id(stat.get("match"))
        if not stat_id or stat_id in seen or not isinstance(game_number, int) or isinstance(game_number, bool) or not 1 <= game_number <= 30 or (stat_match and stat_match != source_id):
            raise AerenaError("Aerena returned ambiguous player stats.")
        seen.add(stat_id)
        valid.append(stat)
    existing = db.query(AerenaMatch).filter_by(id=match_id).with_for_update().one_or_none()
    incoming = parse_date(data.get("updatedAt"))
    if existing and existing.source_updated_at and incoming and incoming < existing.source_updated_at:
        raise AerenaError("Aerena returned older match details; the newer local record was kept.")
    games = data.get("games")
    if not isinstance(games, list):
        raise AerenaError("Aerena returned an incomplete match-detail record; saved data was kept.")
    if existing:
        saved_count = db.query(AerenaGame).filter_by(match_id=match_id).count()
        scores = (_object(data.get("team1")).get("teamScore"), _object(data.get("team2")).get("teamScore"))
        scored_games = sum(scores) if all(isinstance(score, int) and not isinstance(score, bool) and 0 <= score <= 30 for score in scores) else None
        has_result = bool(_id(_object(data.get("matchWinner")).get("team"))) or data.get("isDraw") is True
        score_consistent_correction = has_result and scored_games is not None and scored_games > 0 and len(games) == scored_games
        if len(games) < saved_count and not score_consistent_correction:
            # Do not replace player stats for previously saved games with stats
            # from an incomplete response. The caller rolls back safely.
            raise AerenaError("The source returned an incomplete series; the more complete saved games and player details were kept.")
    game_numbers = {game.get("gameNumber") for game in games if isinstance(game, dict)}
    if any(stat["gameNumber"] not in game_numbers for stat in valid):
        raise AerenaError("Aerena returned player stats for an unknown game.")
    row = save_match(db, data, league)
    db.flush()
    _snapshot(db, "detail", match_id, detail, incoming)
    db.query(AerenaPlayerGameStat).filter_by(match_id=match_id).delete(synchronize_session=False)
    db.flush()
    now = utcnow()
    for stat in valid:
        db.add(AerenaPlayerGameStat(id=_id(stat.get("_id")), match_id=match_id, game_number=stat["gameNumber"],
                  team_id=_id(stat.get("team")), player_id=_id(stat.get("player")), hero_id=_id(stat.get("hero")),
                  ign=_text(stat.get("ign"), 100), position=_text(stat.get("position"), 30), raw_json=dumps(stat), fetched_at=now))
    row.detail_fetched_at = now
    row.detail_error = ""
    return row


def _state(db: Session) -> AerenaSyncState:
    row = db.get(AerenaSyncState, 1)
    if row is None:
        row = AerenaSyncState(id=1)
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            row = db.get(AerenaSyncState, 1)
    assert row is not None
    return row


def _acquire(db: Session) -> str | None:
    _state(db)
    now, owner = utcnow(), str(uuid.uuid4())
    result = db.execute(update(AerenaSyncState).where(
        AerenaSyncState.id == 1, or_(AerenaSyncState.lease_until.is_(None), AerenaSyncState.lease_until < now)
    ).values(lease_owner=owner, lease_until=now + timedelta(seconds=LEASE_SECONDS), last_started_at=now, phase="Starting"))
    db.commit()
    return owner if result.rowcount == 1 else None


def _heartbeat(db: Session, owner: str, phase: str) -> None:
    result = db.execute(update(AerenaSyncState).where(AerenaSyncState.id == 1, AerenaSyncState.lease_owner == owner)
                        .values(lease_until=utcnow() + timedelta(seconds=LEASE_SECONDS), phase=phase[:120]))
    db.commit()
    if result.rowcount != 1:
        raise AerenaError("Another worker took over the Aerena refresh.")


def _get_catalog(upstream: AerenaClient, db: Session, owner: str) -> list[dict]:
    """Use the full catalog when available; fall back to verified season refs."""
    try:
        rows = upstream.leagues()
        if not rows or any(not _id(row.get("_id")) or not _id(row.get("series")) or not row.get("leagueCode") for row in rows):
            raise AerenaError("Aerena returned an unexpected league catalog.")
        return rows
    except AerenaError as exc:
        if "could not be reached" in str(exc):
            raise
        logger.info("Full Aerena catalog unavailable, using the public season index: %s", exc)
    seasons = upstream.seasons()
    refs: list[str] = []
    for season in reversed(seasons):
        batch = season.get("batch")
        if not isinstance(batch, list):
            continue
        for item in batch:
            lid = _id(_object(item).get("league"))
            if lid and lid not in refs:
                refs.append(lid)
    if not refs:
        raise AerenaError("Aerena returned no usable season references.")
    result: list[dict] = []
    for index, lid in enumerate(refs):
        if index % 10 == 0:
            _heartbeat(db, owner, f"Loading season catalog {index + 1}/{len(refs)}")
        result.append(upstream.league(lid))
        # Courtesy pacing for the slower fallback (no parallel scraping).
        time.sleep(0.5)
    return result


def sync_league(db: Session, league: AerenaLeague, upstream: AerenaClient) -> int:
    """Import the season-level match response; all-stage coverage is not guaranteed."""
    rows = upstream.matches(league.id)
    if not rows and db.query(AerenaMatch).filter_by(league_id=league.id).first() is not None:
        raise AerenaError("Aerena returned no matches for a previously populated season; cached data was kept.")
    seen: set[str] = set()
    for match in rows:
        match_id = _id(match.get("matchId"), 120)
        if not match_id or match_id in seen:
            raise AerenaError("Aerena returned duplicate or invalid match identifiers.")
        seen.add(match_id)
        save_match(db, match, league)
    league.matches_fetched_at = utcnow()
    league.matches_error = ""
    db.commit()
    return len(rows)


def refresh(target_league_id: str = "", *, upstream: AerenaClient = client) -> bool:
    """One bounded refresh. Returns false if another worker owns the lease."""
    with SessionLocal() as db:
        owner = _acquire(db)
        if not owner:
            return False
        failures: list[str] = []
        prior_error = _state(db).last_error
        try:
            state = _state(db)
            if state.requested_league == target_league_id:
                state.requested_at = None
                state.requested_league = ""
                db.commit()
            if target_league_id:
                league = db.get(AerenaLeague, target_league_id)
                if league is None:
                    raise AerenaError("That season is not in the current Aerena catalog.")
                _heartbeat(db, owner, f"Refreshing {league.code}")
                sync_league(db, league, upstream)
            else:
                _heartbeat(db, owner, "Loading series and heroes")
                series = upstream.series()
                heroes = upstream.heroes()
                leagues = _get_catalog(upstream, db, owner)
                # Catalog updates are one transaction: malformed source data
                # cannot replace a healthy previous catalog with partial data.
                save_series(db, series)
                save_heroes(db, heroes)
                seen_leagues: set[str] = set()
                for item in leagues:
                    league_id = _id(item.get("_id"))
                    if not league_id or league_id in seen_leagues:
                        raise AerenaError("Aerena returned duplicate or invalid season identifiers.")
                    seen_leagues.add(league_id)
                    save_league(db, item)
                db.commit()
                # Refresh only the latest dated season of each series. Older
                # seasons can be loaded on request without hammering the source.
                latest: dict[str, AerenaLeague] = {}
                dated = (db.query(AerenaLeague).filter(AerenaLeague.starts_at.is_not(None))
                         .order_by(AerenaLeague.starts_at.desc(), AerenaLeague.code, AerenaLeague.id).all())
                if not dated:
                    raise AerenaError("Aerena returned no dated seasons; latest matches could not be determined.")
                for league in dated:
                    # Same deterministic tie-break as the catalog endpoint.
                    latest.setdefault(league.series_id, league)
                for league in latest.values():
                    _heartbeat(db, owner, f"Refreshing {league.code}")
                    try:
                        sync_league(db, league, upstream)
                    except AerenaError as exc:
                        db.rollback()
                        league = db.get(AerenaLeague, league.id)
                        if league:
                            league.matches_error = str(exc)
                            db.commit()
                            failures.append(f"{league.code}: {exc}")
                        else:
                            failures.append(str(exc))
                    time.sleep(0.5)
        except Exception as exc:  # Keep the last good database on source/protocol failure.
            db.rollback()
            logger.warning("Aerena refresh failed: %s", exc)
            failures.append(str(exc) if isinstance(exc, AerenaError) else "Aerena refresh failed; check server logs.")
            # A failed on-demand historical season is not a failure of the
            # global feed. Expose its own error beside that season instead.
            if target_league_id:
                league = db.get(AerenaLeague, target_league_id)
                if league:
                    league.matches_error = failures[-1][:1000]
                    db.commit()
        finally:
            now = utcnow()
            # Targeted refreshes neither hide an earlier global failure nor
            # mark every other feed stale when one historical season fails.
            reported_error = prior_error if target_league_id else "; ".join(failures)[:1000]
            values: dict[str, Any] = {"last_finished_at": now, "last_error": reported_error,
                                      "phase": "", "lease_owner": "", "lease_until": None}
            if not failures and not target_league_id:
                values["last_success_at"] = now
            db.execute(update(AerenaSyncState).where(AerenaSyncState.id == 1, AerenaSyncState.lease_owner == owner).values(**values))
            db.commit()
        return not failures


def request_refresh(db: Session, league_id: str = "") -> None:
    if not ENABLED:
        raise AerenaError("Aerena syncing is disabled on this server.")
    _state(db)
    if league_id and not db.get(AerenaLeague, league_id):
        raise AerenaError("That season is not in the current Aerena catalog.")
    now = utcnow()
    # One pending request at a time, atomically shared between worker processes.
    result = db.execute(update(AerenaSyncState).where(AerenaSyncState.id == 1, AerenaSyncState.requested_at.is_(None))
                        .values(requested_at=now, requested_league=league_id))
    db.commit()
    if not result.rowcount:
        raise AerenaError("A refresh is already queued.")
    _wake.set()


def _run() -> None:
    # Keep the application responsive while the first provider check runs.
    while not _stop.is_set():
        try:
            with SessionLocal() as db:
                state = _state(db)
                now = utcnow()
                pending = state.requested_at is not None
                target = state.requested_league if pending else ""
                delay = FAIL_RETRY_SECONDS if state.last_error else SYNC_SECONDS
                due = state.last_started_at is None or state.last_started_at + timedelta(seconds=delay) <= now
                leased = state.lease_until is not None and state.lease_until > now
            if (pending or due) and not leased:
                refresh(target)
        except Exception:
            logger.exception("Aerena worker encountered an error")
        _wake.wait(30)
        _wake.clear()


def start_worker() -> None:
    global _worker
    if ENABLED and (_worker is None or not _worker.is_alive()):
        _stop.clear()
        _worker = threading.Thread(target=_run, name="aerena-refresh", daemon=True)
        _worker.start()


def stop_worker() -> None:
    _stop.set()
    _wake.set()
