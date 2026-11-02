"""Bounded season-wide pick/ban evidence from the saved Aerena database.

This is an aggregate of recorded drafts, not a prediction or a live tier list.
Only a clearly requested MPL region and season can select a season. Rates use
complete 10-pick/10-ban games as the denominator; partial drafts never silently
count as zero picks or bans. No upstream calls or private team data are used.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import Any

from sqlalchemy import or_
from sqlalchemy.orm import Session

from .aerena_models import AerenaDraftEvent, AerenaGame, AerenaHero, AerenaLeague, AerenaMatch
from .ai_rone import requested_region

MAX_MATCHES = 500
MAX_GAMES = 3500
MAX_HEROES = 30
BATCH = 350

_META = re.compile(
    r"\b(meta|meat|tier(?:s|\s+list)?|pick(?:s|ed)?|ban(?:s|ned)?|presence|priorit(?:y|ies)|"
    r"popular|most[\s-]+(?:used|picked|banned)|draft\s+(?:trend|trends|stats|statistics))\b",
    re.I,
)
_SEASON = re.compile(r"\b(?:s\s*|season\s*)(0*[1-9]\d{0,2})\b", re.I)
_REGION_NAMES = {"ph": "philippines", "id": "indonesia", "my": "malaysia", "kh": "cambodia"}


def _batches(values: list[str]):
    for start in range(0, len(values), BATCH):
        yield values[start : start + BATCH]


def season_meta(db: Session, question: str) -> tuple[dict[str, Any] | None, list[dict]]:
    """Return actual local season draft frequencies for a specific MPL meta request."""
    if not _META.search(question):
        return None, []
    region = requested_region(question)
    seasons = {int(match) for match in _SEASON.findall(question)}
    if not region or len(seasons) != 1:
        return None, []
    number = next(iter(seasons))
    pattern = re.compile(rf"\b(?:s|season\s*)0*{number}\b", re.I)
    region_name = _REGION_NAMES[region]
    rows = (
        db.query(AerenaLeague)
        .filter(
            or_(AerenaLeague.code.ilike("%mpl%"), AerenaLeague.name.ilike("%mpl%")),
            or_(
                AerenaLeague.region.ilike(region),
                AerenaLeague.region.ilike(f"%{region_name}%"),
                AerenaLeague.code.ilike(f"%mpl%{region}%"),
                AerenaLeague.name.ilike(f"%{region_name}%"),
            ),
        )
        .order_by(AerenaLeague.starts_at.desc().nullslast(), AerenaLeague.id)
        .limit(500)
        .all()
    )
    candidates = [row for row in rows if pattern.search(f"{row.code} {row.name}")]
    base: dict[str, Any] = {"region": region.upper(), "season": number, "source": "Saved Aerena records"}
    if not candidates:
        return {**base, "status": "season_not_found"}, []

    # Prefer an exact competition code rather than combining separate events
    # which happen to share an MPL region/season number.
    exact = re.compile(rf"^\s*mpl[\s-]+{region}[\s-]+s(?:eason\s*)?0*{number}\s*$", re.I)
    canonical = [row for row in candidates if exact.fullmatch(row.code or "")]
    if canonical:
        selected = canonical
    elif len(candidates) == 1:
        selected = candidates
    else:
        return {**base, "status": "ambiguous_season", "competitions": [row.code for row in candidates[:10]]}, []

    query = db.query(AerenaMatch).filter(AerenaMatch.league_id.in_([row.id for row in selected]))
    phase = "all saved stages"
    if re.search(r"\bgrand\s+finals?\b", question, re.I):
        query = query.filter(AerenaMatch.stage.ilike("%grand%final%"))
        phase = "stages labelled grand final"
    elif re.search(r"\bplay[\s-]?offs?\b", question, re.I):
        query = query.filter(
            or_(
                AerenaMatch.stage.ilike("%playoff%"),
                AerenaMatch.stage.ilike("%play-off%"),
                AerenaMatch.stage.ilike("%grand%final%"),
                AerenaMatch.stage.ilike("%upper%bracket%"),
                AerenaMatch.stage.ilike("%lower%bracket%"),
            )
        )
        phase = "stages labelled playoffs or bracket/final"
    total_matches = query.count()
    matches = query.order_by(AerenaMatch.starts_at.desc().nullslast(), AerenaMatch.id).limit(MAX_MATCHES + 1).all()
    match_truncated = len(matches) > MAX_MATCHES
    matches = matches[:MAX_MATCHES]
    match_ids = [row.id for row in matches]
    games: list[AerenaGame] = []
    # Batching avoids oversized IN clauses on older SQLite deployments.
    for batch in _batches(match_ids):
        games.extend(
            db.query(AerenaGame)
            .filter(AerenaGame.match_id.in_(batch))
            .order_by(AerenaGame.match_id, AerenaGame.number)
            .limit(MAX_GAMES + 1)
            .all()
        )
        if len(games) > MAX_GAMES:
            break
    game_truncated = len(games) > MAX_GAMES
    games = games[:MAX_GAMES]
    game_map = {game.id: game for game in games}
    by_game: dict[str, list[tuple[str, str]]] = defaultdict(list)
    hero_ids: set[str] = set()
    for batch in _batches(list(game_map)):
        events = (
            db.query(
                AerenaDraftEvent.game_id, AerenaDraftEvent.match_id, AerenaDraftEvent.kind, AerenaDraftEvent.hero_id
            )
            .filter(AerenaDraftEvent.game_id.in_(batch), AerenaDraftEvent.kind.in_(["Pick", "Ban"]))
            .all()
        )
        for game_id, match_id, kind, hero_id in events:
            game = game_map[game_id]
            if match_id == game.match_id and game.draft_coverage in {"complete", "partial"} and hero_id:
                by_game[game_id].append((kind, hero_id))
                hero_ids.add(hero_id)
    names: dict[str, str] = {}
    for batch in _batches(sorted(hero_ids)):
        for hero_id, name in db.query(AerenaHero.id, AerenaHero.name).filter(AerenaHero.id.in_(batch)).all():
            if isinstance(name, str) and name.strip():
                names[hero_id] = name.strip()[:100].title()

    picks: Counter[str] = Counter()
    bans: Counter[str] = Counter()
    complete_games = partial_games = unknown_games = 0
    for game in games:
        events = by_game.get(game.id, [])
        pick_ids = [hero for kind, hero in events if kind == "Pick"]
        ban_ids = [hero for kind, hero in events if kind == "Ban"]
        known_names = [names[hero].casefold() for hero in pick_ids + ban_ids if hero in names]
        if (
            len(pick_ids) == len(ban_ids) == 10
            and len(set(pick_ids + ban_ids)) == 20
            and len(set(known_names)) == len(known_names)
        ):
            complete_games += 1
            if len(known_names) != 20:
                unknown_games += 1
            picks.update(names[hero].casefold() for hero in pick_ids if hero in names)
            bans.update(names[hero].casefold() for hero in ban_ids if hero in names)
        elif events:
            partial_games += 1

    display_names = {name.casefold(): name for name in names.values()}
    heroes = []
    for hero_name in set(picks) | set(bans):
        pick_count, ban_count = picks[hero_name], bans[hero_name]
        heroes.append(
            {
                "hero": display_names[hero_name],
                "picks": pick_count,
                "bans": ban_count,
                "pick_rate_percent": round(100 * pick_count / complete_games, 1),
                "ban_rate_percent": round(100 * ban_count / complete_games, 1),
                "presence_percent": round(100 * (pick_count + ban_count) / complete_games, 1),
            }
        )
    heroes.sort(key=lambda hero: (-(hero["picks"] + hero["bans"]), -hero["picks"], hero["hero"]))
    result = {
        **base,
        "status": "ok",
        "competitions": [row.code for row in selected[:10]],
        "phase": phase,
        "matches_saved": total_matches,
        "matches_scanned": len(matches),
        "games_scanned": len(games),
        "complete_draft_games": complete_games,
        "partial_draft_games": partial_games,
        "games_without_usable_draft": len(games) - complete_games - partial_games,
        "complete_games_with_unknown_heroes": unknown_games,
        "sample_truncated": match_truncated or game_truncated,
        "top_heroes": heroes[:MAX_HEROES],
        "heroes_truncated": len(heroes) > MAX_HEROES,
        "notice": "Rates use only complete saved drafts; they describe this saved sample, not every game or a verified live tier list. Partial drafts are counted separately.",
    }
    return result, [
        {
            "kind": "esports_feed",
            "label": f"Aerena MPL {region.upper()} S{number} · saved draft trends",
            "route": "esports",
        }
    ]
