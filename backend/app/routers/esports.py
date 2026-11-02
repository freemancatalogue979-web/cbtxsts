"""Authenticated read-only Esports views backed by the persisted Aerena feed."""
from __future__ import annotations

import math
import urllib.parse
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_, update
from sqlalchemy.orm import Session

from ..aerena_client import AerenaError, client
from ..aerena_models import (AerenaDraftEvent, AerenaGame, AerenaHero, AerenaLeague,
                             AerenaMatch, AerenaPlayerGameStat, AerenaSeries, AerenaSyncState)
from ..aerena_service import (ENABLED, SYNC_SECONDS, _id, _state, iso, request_refresh,
                              save_match_detail)
from ..db import get_db
from ..deps import can, get_current_user, require
from ..esports_ai import configured as ai_configured
from ..models import User, loads, utcnow

router = APIRouter(prefix="/esports", tags=["esports"])
DETAIL_TTL = timedelta(hours=24)
DETAIL_RETRY = timedelta(minutes=5)


def _safe_logo(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        url = urllib.parse.urlsplit(value)
        if (url.scheme == "https" and url.hostname == "media.aerena.gg" and url.port in (None, 443)
                and not url.username and not url.password):
            return value
    except ValueError:
        pass
    return None


def _team(raw: str) -> dict:
    value = loads(raw, {})
    value = value if isinstance(value, dict) else {}
    # Source JSON is untrusted: never pass arbitrary nested objects as names,
    # strings as statistics, or non-finite numbers into the browser/AI prompt.
    result: dict[str, Any] = {"team": _id(value.get("team")) or None}
    for key in ("teamCode", "teamName", "side"):
        item = value.get(key)
        result[key] = item[:200] if isinstance(item, str) else None
    for key in ("teamScore", "teamKills", "teamDeaths", "teamAssists", "teamGold",
                "teamDmgDealt", "teamDmgTaken", "teamTurtles", "teamLords", "teamObjectives"):
        item = value.get(key)
        result[key] = item if isinstance(item, (int, float)) and not isinstance(item, bool) and math.isfinite(item) else None
    result["logo"] = _safe_logo(value.get("teamLogoLight") or value.get("teamLogoDark"))
    return result


def _winner(raw: str) -> dict:
    value = _team(raw)
    return {key: value.get(key) for key in ("team", "teamCode", "teamName")}


def _match_status(row: AerenaMatch) -> str:
    if row.has_result:
        return "completed"
    if row.starts_at and row.starts_at >= utcnow():
        return "upcoming"
    return "pending"


def match_row(row: AerenaMatch, league: AerenaLeague | None = None) -> dict:
    return {
        "id": row.id, "league_id": row.league_id, "league_code": league.code if league else None,
        "league_name": league.name if league else None, "stage": row.stage, "format": row.format,
        "starts_at": iso(row.starts_at), "status": _match_status(row),
        "team1": _team(row.team1_json), "team2": _team(row.team2_json), "winner": _winner(row.winner_json),
        "is_draw": row.is_draw, "source_verified": row.source_verified, "game_count": row.game_count,
        "draft_event_count": row.draft_event_count, "source_updated_at": iso(row.source_updated_at),
        "fetched_at": iso(row.fetched_at), "detail_fetched_at": iso(row.detail_fetched_at),
        "source_url": f"https://aerena.gg/mobile-legends/match/{urllib.parse.quote(row.id, safe='')}",
    }


def source_status(db: Session) -> dict:
    state = _state(db)
    now = utcnow()
    in_progress = bool(state.lease_until and state.lease_until > now)
    stale = not state.last_success_at or state.last_success_at + timedelta(seconds=SYNC_SECONDS * 2) < now or bool(state.last_error)
    if not ENABLED:
        label = "disabled"
    elif in_progress:
        label = "syncing"
    elif state.last_error and not state.last_success_at:
        label = "unavailable"
    elif stale and state.last_success_at:
        label = "stale"
    elif state.last_success_at:
        label = "fresh"
    else:
        label = "waiting"
    return {
        "source": "Aerena.gg", "status": label, "enabled": ENABLED, "phase": state.phase if in_progress else "",
        "last_attempt_at": iso(state.last_started_at), "last_success_at": iso(state.last_success_at),
        "last_error": state.last_error or None, "refresh_seconds": SYNC_SECONDS,
        "series_count": db.query(AerenaSeries).count(), "league_count": db.query(AerenaLeague).count(),
        "match_count": db.query(AerenaMatch).count(), "draft_events": db.query(AerenaDraftEvent).count(),
        "ai_configured": ai_configured(db),
    }


@router.get("/source")
def get_source(db: Session = Depends(get_db), _user: User = Depends(get_current_user)) -> dict:
    return source_status(db)


@router.get("/catalog")
def get_catalog(db: Session = Depends(get_db), _user: User = Depends(get_current_user)) -> dict:
    series = db.query(AerenaSeries).order_by(AerenaSeries.code).all()
    leagues = db.query(AerenaLeague).order_by(AerenaLeague.starts_at.desc(), AerenaLeague.code, AerenaLeague.id).all()
    latest: dict[str, str] = {}
    for league in leagues:
        if league.starts_at and league.series_id not in latest:
            latest[league.series_id] = league.id
    return {
        "series": [{"id": row.id, "code": row.code, "name": row.name, "region": row.region,
                    "kind": row.kind, "logo": _safe_logo(row.logo), "latest_league_id": latest.get(row.id)} for row in series],
        "leagues": [{"id": row.id, "series_id": row.series_id, "code": row.code, "name": row.name,
                     "region": row.region, "logo": _safe_logo(row.logo), "starts_at": iso(row.starts_at),
                     "ends_at": iso(row.ends_at), "is_pro": row.is_pro, "is_latest": latest.get(row.series_id) == row.id,
                     "matches_fetched_at": iso(row.matches_fetched_at), "matches_error": row.matches_error or None} for row in leagues],
    }


@router.get("/matches")
def list_matches(league_id: str = "", series_id: str = "", q: str = Query(default="", max_length=100),
                 view: str = Query(default="upcoming", pattern="^(upcoming|results|all)$"),
                 limit: int = Query(default=80, ge=1, le=200),
                 db: Session = Depends(get_db), _user: User = Depends(get_current_user)) -> dict:
    query = db.query(AerenaMatch, AerenaLeague).outerjoin(AerenaLeague, AerenaMatch.league_id == AerenaLeague.id)
    if league_id:
        query = query.filter(AerenaMatch.league_id == league_id)
    if series_id:
        query = query.filter(AerenaLeague.series_id == series_id)
    if q.strip():
        # Escape LIKE wildcards; search is text, not a query language.
        term = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{term}%"
        query = query.filter(or_(AerenaMatch.id.ilike(pattern, escape="\\"), AerenaMatch.team1_name.ilike(pattern, escape="\\"),
                                 AerenaMatch.team2_name.ilike(pattern, escape="\\"),
                                 # Codes may differ entirely from full names (e.g. FLCN vs Team Falcons).
                                 AerenaMatch.team1_json.ilike(pattern, escape="\\"), AerenaMatch.team2_json.ilike(pattern, escape="\\"),
                                 AerenaLeague.code.ilike(pattern, escape="\\"), AerenaLeague.name.ilike(pattern, escape="\\")))
    if view == "upcoming":
        query = query.filter(AerenaMatch.has_result.is_(False), AerenaMatch.starts_at >= utcnow())
        query = query.order_by(AerenaMatch.starts_at.asc())
    elif view == "results":
        query = query.filter(AerenaMatch.has_result.is_(True))
        query = query.order_by(AerenaMatch.starts_at.desc())
    else:
        query = query.order_by(AerenaMatch.starts_at.desc())
    return {"matches": [match_row(match, league) for match, league in query.limit(limit).all()], "limit": limit}


def _claim_detail_refresh(db: Session, row: AerenaMatch):  # noqa: ANN201
    if not ENABLED:
        return None
    now = utcnow()
    needs_detail = row.detail_fetched_at is None or row.detail_fetched_at + DETAIL_TTL < now or (
        row.source_updated_at is not None and row.detail_fetched_at is not None and row.source_updated_at > row.detail_fetched_at
    )
    if not needs_detail:
        return None
    # Atomic cross-worker cooldown: many people opening the same match do not
    # trigger a burst of upstream requests. Never forward the user's session.
    result = db.execute(update(AerenaMatch).where(AerenaMatch.id == row.id,
                        or_(AerenaMatch.detail_attempted_at.is_(None), AerenaMatch.detail_attempted_at < now - DETAIL_RETRY))
                        .values(detail_attempted_at=now, detail_error=""))
    db.commit()
    return now if result.rowcount else None


def _refresh_detail_in_background(bind, match_id: str, attempted_at) -> None:  # noqa: ANN001
    with Session(bind=bind) as db:
        try:
            detail = client.match_stats(match_id)
            row = db.get(AerenaMatch, match_id)
            if not row or row.detail_attempted_at != attempted_at:
                return
            league = db.get(AerenaLeague, row.league_id)
            if not league:
                raise AerenaError("This match's season is missing from the catalog.")
            save_match_detail(db, detail, league)
            db.commit()
        except Exception as exc:
            db.rollback()
            saved = db.get(AerenaMatch, match_id)
            if saved and saved.detail_attempted_at == attempted_at:
                saved.detail_error = str(exc) if isinstance(exc, AerenaError) else "Match details could not be refreshed."
                db.commit()


def detail_for(db: Session, row: AerenaMatch) -> dict:
    league = db.get(AerenaLeague, row.league_id)
    hero_names = {h.id: h.name.title() for h in db.query(AerenaHero).all()}
    games = db.query(AerenaGame).filter_by(match_id=row.id).order_by(AerenaGame.number).all()
    event_rows = db.query(AerenaDraftEvent).filter_by(match_id=row.id).all()
    stat_rows = db.query(AerenaPlayerGameStat).filter_by(match_id=row.id).all()
    result: list[dict] = []
    for game in games:
        events = [event for event in event_rows if event.game_id == game.id]
        events.sort(key=lambda event: (event.sequence is None, event.sequence or 0, event.kind, event.source_order))
        player_stats = []
        for stat in stat_rows:
            if stat.game_number != game.number:
                continue
            raw = loads(stat.raw_json, {})
            raw = raw if isinstance(raw, dict) else {}
            numbers: dict[str, int | float | None] = {}
            for key in ("kills", "deaths", "assists", "gold", "dmgDealt", "dmgTaken", "killParticipation"):
                value = raw.get(key)
                numeric = value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None
                if key == "killParticipation" and numeric is not None and not 0 <= numeric <= 1:
                    numeric = None  # Source uses a fraction; do not invent a percentage.
                numbers[key] = numeric
            player_stats.append({"id": stat.id, "team_id": stat.team_id, "player_id": stat.player_id,
                                 "ign": stat.ign, "position": stat.position, "hero_id": stat.hero_id,
                                 "hero_name": hero_names.get(stat.hero_id), **numbers,
                                 "isMVP": raw.get("isMVP") if isinstance(raw.get("isMVP"), bool) else None})
        result.append({"id": game.id, "number": game.number, "duration_seconds": game.duration_seconds,
                       "team1": _team(game.team1_json), "team2": _team(game.team2_json),
                       "winner": _winner(game.winner_json), "mvp": loads(game.mvp_json, {}),
                       "draft_coverage": game.draft_coverage,
                       "draft_fetched_at": iso(max((event.fetched_at for event in events), default=None)),
                       "draft": [{"kind": event.kind, "source_order": event.source_order, "sequence": event.sequence,
                                  "side": event.side, "hero_id": event.hero_id, "hero_name": hero_names.get(event.hero_id),
                                  "player_ign": event.player_ign, "position": event.position} for event in events],
                       "player_stats": player_stats})
    return {"match": match_row(row, league), "games": result, "detail_error": row.detail_error or None,
            "source_note": "Aerena compiles community match data; draft order and verification are reported by the source, not independently verified."}


@router.get("/matches/{match_id}")
def get_match(match_id: str, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
              _user: User = Depends(get_current_user)) -> dict:
    row = db.get(AerenaMatch, match_id)
    if row is None:
        raise HTTPException(404, "Match not found in the local Aerena database.")
    attempted_at = _claim_detail_refresh(db, row)
    if attempted_at:
        background_tasks.add_task(_refresh_detail_in_background, db.get_bind(), match_id, attempted_at)
    db.expire_all()
    row = db.get(AerenaMatch, match_id)
    result = detail_for(db, row)
    result["detail_refreshing"] = bool(
        ENABLED and row.detail_attempted_at and not row.detail_error
        and (not row.detail_fetched_at or row.detail_attempted_at > row.detail_fetched_at)
        and row.detail_attempted_at + DETAIL_RETRY > utcnow()
    )
    return result


class RefreshIn(BaseModel):
    league_id: str = Field(default="", max_length=80)


@router.post("/refresh", status_code=202)
def refresh_feed(body: RefreshIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    require(can.manage_strategy(user), "refresh the esports feed")
    if body.league_id and not _id(body.league_id):
        raise HTTPException(400, "Invalid season identifier.")
    try:
        request_refresh(db, body.league_id)
    except AerenaError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"queued": True, "league_id": body.league_id or None}


class AnalysisIn(BaseModel):
    question: str = Field(min_length=1, max_length=500)


@router.post("/matches/{match_id}/analysis")
def analyze_match(match_id: str, body: AnalysisIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    from ..esports_ai import AnalysisError, ask

    question = body.question.strip()
    if not question:
        raise HTTPException(400, "Enter a question about the match.")
    row = db.get(AerenaMatch, match_id)
    if row is None:
        raise HTTPException(404, "Match not found in the local Aerena database.")
    try:
        # Only saved public evidence and the explicitly typed question leave the server.
        return ask(db, user.id, question, detail_for(db, row))
    except AnalysisError as exc:
        raise HTTPException(429 if "limit reached" in str(exc) else 502, str(exc)) from exc


class SceneAnalysisIn(AnalysisIn):
    # IDs come from the current, authenticated match list; never accept
    # arbitrary client-supplied evidence or private team records.
    match_ids: list[str] = Field(min_length=1, max_length=8)


@router.post("/analysis")
def analyze_scene(body: SceneAnalysisIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    from ..esports_ai import AnalysisError, ask_scene

    question = body.question.strip()
    if not question:
        raise HTTPException(400, "Enter a question about the selected matches.")
    if len(set(body.match_ids)) != len(body.match_ids) or any(not _id(value, 120) for value in body.match_ids):
        raise HTTPException(400, "Invalid or duplicate match identifiers.")
    details = []
    for match_id in body.match_ids:
        row = db.get(AerenaMatch, match_id)
        if row is None:
            raise HTTPException(404, "A selected match is not in the local Aerena database.")
        # Read only saved facts; scene questions do not trigger an upstream
        # request per match or pull private Archive/team data.
        details.append(detail_for(db, row))
    try:
        return ask_scene(db, user.id, question, details)
    except AnalysisError as exc:
        raise HTTPException(429 if "limit reached" in str(exc) else 502, str(exc)) from exc
