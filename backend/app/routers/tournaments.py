"""Tournaments — named competitions with their own schedule, match drafts,
results and an optional review flag.

Parallel to scrims: Tournament → matches (stage/day, draft, result, evidence)
→ optional match review via the standard MatchReview flow. Unlike scrims a
tournament LOSS never blocks future booking — review is opt-in here.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, object_session

from ..deps import can, get_current_user, get_db, require
from ..trash import send_to_trash
from ..models import MatchReview, Tournament, TournamentMatch, User, dumps, loads, utcnow
from ..performance import clean_enemy_stats, clean_player_stats
from ..security import LANES
from ..schemas import OptionalDate
from ..serializers import review_out

router = APIRouter(prefix="/tournaments", tags=["tournaments"])


# --------------------------------------------------------------------------- #
# Per-game drafts
# --------------------------------------------------------------------------- #
# A series has one draft per game actually played: BO3 2–0 → games 1–2,
# BO3 2–1 → games 1–3. Older matches stored a single draft; it reads as game 1.
DRAFT_KEYS = ("our_bans", "enemy_bans", "our_picks", "enemy_picks")


def max_games(fmt: str | None) -> int:
    """BO1/BO3/BO5/BO7 → 1/3/5/7. Unknown formats allow up to 7 games."""
    digits = "".join(ch for ch in str(fmt or "") if ch.isdigit())
    n = int(digits) if digits else 0
    return n if 1 <= n <= 9 else 7


def draft_has_content(draft: dict | None) -> bool:
    if not isinstance(draft, dict):
        return False
    bans = [*(draft.get("our_bans") or []), *(draft.get("enemy_bans") or [])]
    picks = [*((draft.get("our_picks") or {}).values()), *((draft.get("enemy_picks") or {}).values())]
    return any(bool(x) for x in [*bans, *picks])


def clean_draft(draft: dict | None) -> dict:
    draft = draft if isinstance(draft, dict) else {}
    out = {k: v for k, v in draft.items() if k not in DRAFT_KEYS and not isinstance(v, (dict, list))}
    out["our_bans"] = [str(x or "") for x in (draft.get("our_bans") or [])][:5]
    out["enemy_bans"] = [str(x or "") for x in (draft.get("enemy_bans") or [])][:5]
    out["our_picks"] = {str(k): str(v or "") for k, v in (draft.get("our_picks") or {}).items()}
    out["enemy_picks"] = {str(k): str(v or "") for k, v in (draft.get("enemy_picks") or {}).items()}
    return out


def clean_lineup(lineup: dict | None) -> dict[str, int]:
    """{LANE: user_id} for known lanes only; blanks dropped."""
    out: dict[str, int] = {}
    for lane, uid in (lineup or {}).items() if isinstance(lineup, dict) else []:
        lane = str(lane).upper()
        try:
            uid = int(uid)
        except (TypeError, ValueError):
            continue
        if lane in LANES and uid > 0:
            out[lane] = uid
    return {lane: out[lane] for lane in LANES if lane in out}


def match_games(m: TournamentMatch) -> list[dict]:
    """Saved games sorted by game number — each has a draft and/or the lineup
    that played it (legacy single draft → game 1)."""
    rows = loads(m.game_drafts or "[]", [])
    games: dict[int, dict] = {}
    for g in rows if isinstance(rows, list) else []:
        try:
            no = int(g.get("game_no"))
        except (TypeError, ValueError, AttributeError):
            continue
        lineup = clean_lineup(g.get("lineup"))
        if no >= 1 and (draft_has_content(g.get("draft")) or lineup):
            result = str(g.get("result") or "").upper()
            games[no] = {"game_no": no, "result": result if result in {"WIN", "LOSS"} else "",
                         "draft": clean_draft(g.get("draft")), "lineup": lineup,
                         "player_stats": clean_player_stats(g.get("player_stats")),
                         "enemy_stats": clean_enemy_stats(g.get("enemy_stats"))}
    legacy = loads(m.draft or "{}", {})
    if 1 not in games and draft_has_content(legacy):
        games[1] = {"game_no": 1, "result": "", "draft": clean_draft(legacy), "lineup": {},
                    "player_stats": {}, "enemy_stats": {}}
    return [games[k] for k in sorted(games)]


def implied_result(m: TournamentMatch, game: dict) -> str:
    """A game's result, or the one the score makes certain (2–0 → every game won)."""
    if game.get("result") in {"WIN", "LOSS"}:
        return game["result"]
    if m.status == "played" and (m.score_us or 0) > 0 and not m.score_them:
        return "WIN"
    if m.status == "played" and (m.score_them or 0) > 0 and not m.score_us:
        return "LOSS"
    return ""


def user_names(db: Session | None) -> dict[int, str]:
    if db is None:
        return {}
    return {u.id: (u.ign or u.name or f"Player {u.id}") for u in db.scalars(select(User)).all()}


def _pct(won: int, total: int) -> float | None:
    return round(100 * won / total, 1) if total else None


def series_stats(matches: list[TournamentMatch], names: dict[int, str],
                 tournament_names: dict[int, str] | None = None) -> dict:
    """Overall match stats for a set of tournament matches: series and game
    records from the scores, plus who played each game (lineups) with the hero
    they were on (lineup lane × draft pick)."""
    played = [m for m in matches if m.status == "played"]
    series_w = sum(1 for m in played if m.result == "WIN")
    series_l = sum(1 for m in played if m.result == "LOSS")
    games_w = sum(m.score_us or 0 for m in played)
    games_l = sum(m.score_them or 0 for m in played)
    players: dict[int, dict] = {}
    heroes: dict[str, dict] = {}
    with_lineup = 0
    for m in played:
        for g in match_games(m):
            res = implied_result(m, g)
            picks = g["draft"].get("our_picks") or {}
            if g["lineup"]:
                with_lineup += 1
            for lane in LANES:
                hero = picks.get(lane) or ""
                if hero:
                    h = heroes.setdefault(hero, {"hero": hero, "games": 0, "wins": 0, "losses": 0})
                    h["games"] += 1
                    h["wins"] += res == "WIN"
                    h["losses"] += res == "LOSS"
                uid = g["lineup"].get(lane)
                if not uid:
                    continue
                p = players.setdefault(uid, {"user_id": uid, "name": names.get(uid, f"Player {uid}"),
                                             "games": 0, "wins": 0, "losses": 0, "series": set(),
                                             "tournaments": set(), "lanes": {}, "heroes": {}})
                p["games"] += 1
                p["wins"] += res == "WIN"
                p["losses"] += res == "LOSS"
                p["series"].add(m.id)
                p["tournaments"].add(m.tournament_id)
                p["lanes"][lane] = p["lanes"].get(lane, 0) + 1
                if hero:
                    ph = p["heroes"].setdefault(hero, {"hero": hero, "games": 0, "wins": 0})
                    ph["games"] += 1
                    ph["wins"] += res == "WIN"
    player_rows = []
    for p in players.values():
        decided = p["wins"] + p["losses"]
        player_rows.append({
            "user_id": p["user_id"], "name": p["name"], "games": p["games"], "wins": p["wins"],
            "losses": p["losses"], "win_rate": _pct(p["wins"], decided), "series": len(p["series"]),
            "tournaments": len(p["tournaments"]),
            "main_lane": max(p["lanes"], key=lambda k: p["lanes"][k]) if p["lanes"] else "",
            "lanes": p["lanes"],
            "heroes": sorted(p["heroes"].values(), key=lambda h: (-h["games"], -h["wins"], h["hero"]))[:5],
        })
    player_rows.sort(key=lambda r: (-r["games"], -r["wins"], r["name"].lower()))
    hero_rows = sorted(heroes.values(), key=lambda h: (-h["games"], -h["wins"], h["hero"]))[:10]
    for h in hero_rows:
        h["win_rate"] = _pct(h["wins"], h["wins"] + h["losses"])
    out = {
        "series": {"played": len(played), "wins": series_w, "losses": series_l,
                   "draws": len(played) - series_w - series_l, "win_rate": _pct(series_w, len(played))},
        "games": {"played": games_w + games_l, "wins": games_w, "losses": games_l,
                  "win_rate": _pct(games_w, games_w + games_l), "with_lineup": with_lineup},
        "players": player_rows,
        "heroes": hero_rows,
    }
    if tournament_names is not None:
        out["tournaments"] = len({m.tournament_id for m in played})
    return out


def game_slots(m: TournamentMatch, games: list[dict] | None = None) -> int:
    """How many game drafts this match offers: one per game in the recorded score
    (at least one, so a draft can be planned before the match), capped by the
    format, and never fewer than the drafts already saved."""
    games = match_games(m) if games is None else games
    played = (m.score_us or 0) + (m.score_them or 0)
    slots = min(max(played, 1), max_games(m.format))
    return max(slots, max((g["game_no"] for g in games), default=0))


def match_out(m: TournamentMatch, names: dict[int, str] | None = None) -> dict:
    names = user_names(object_session(m)) if names is None else names
    games = match_games(m)
    for g in games:
        g["players"] = {lane: names.get(uid, f"Player {uid}") for lane, uid in g["lineup"].items()}
    return {
        "id": m.id,
        "match_no": m.match_no,
        "stage": m.stage,
        "scheduled_date": m.scheduled_date.isoformat() if m.scheduled_date else None,
        "start_time": m.start_time,
        "opponent": m.opponent,
        "format": m.format,
        "status": m.status,
        "result": m.result,
        "score_us": m.score_us,
        "score_them": m.score_them,
        "notes": m.notes,
        "draft": games[0]["draft"] if games else loads(m.draft, {}),
        "games": games,
        "game_slots": game_slots(m, games),
        "max_games": max_games(m.format),
        "attachments": loads(m.attachments),
        "review_queued": m.review_queued,
        "has_review": m.review is not None,
        "review_id": m.review.id if m.review else None,
    }


def tournament_out(t: Tournament, *, with_matches: bool = True) -> dict:
    matches = sorted(t.matches, key=lambda m: (m.scheduled_date or date.max, m.match_no))
    played = [m for m in matches if m.status == "played"]
    out = {
        "id": t.id,
        "name": t.name,
        "status": t.status,
        "review_queued": t.review_queued,
        "start_date": t.start_date.isoformat() if t.start_date else None,
        "end_date": t.end_date.isoformat() if t.end_date else None,
        "notes": t.notes,
        "match_count": len(matches),
        "played_count": len(played),
        "wins": sum(1 for m in played if m.result == "WIN"),
        "losses": sum(1 for m in played if m.result == "LOSS"),
        "review_pending": sum(1 for m in played if m.review_queued and m.review is None),
        "stages": sorted({m.stage for m in matches if m.stage}),
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }
    if with_matches:
        names = user_names(object_session(t))
        out["matches"] = [match_out(m, names) for m in matches]
        out["stats"] = series_stats(matches, names)
    return out


def _get(db: Session, tournament_id: int) -> Tournament:
    t = db.get(Tournament, tournament_id)
    if t is None:
        raise HTTPException(status_code=404, detail="Tournament not found")
    return t


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class TournamentIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    status: str = "upcoming"
    review_queued: bool = False
    start_date: OptionalDate = None
    end_date: OptionalDate = None
    notes: str = ""


class TournamentPatch(BaseModel):
    name: str | None = None
    status: str | None = None
    review_queued: bool | None = None
    start_date: OptionalDate = None
    end_date: OptionalDate = None
    notes: str | None = None


class MatchIn(BaseModel):
    stage: str = ""
    scheduled_date: OptionalDate = None
    start_time: str = ""
    opponent: str = Field(min_length=1, max_length=120)
    format: str = "BO3"
    review_queued: bool = False
    notes: str = ""


class GameDraftIn(BaseModel):
    draft: dict = Field(default_factory=dict)
    result: str = ""
    # {LANE: user_id} — who played this game. Omit to keep the saved lineup.
    lineup: dict[str, int | str | None] | None = None
    # Scoreboard lines by lane (ours / theirs). Omit to keep what's saved.
    player_stats: dict[str, dict] | None = None
    enemy_stats: dict[str, dict] | None = None


class MatchPatch(BaseModel):
    stage: str | None = None
    scheduled_date: OptionalDate = None
    start_time: str | None = None
    opponent: str | None = None
    format: str | None = None
    status: str | None = None
    result: str | None = None
    score_us: int | None = None
    score_them: int | None = None
    notes: str | None = None
    draft: dict | None = None
    attachments: list[dict] | None = None
    review_queued: bool | None = None


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@router.get("")
def list_tournaments(db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = db.scalars(select(Tournament).order_by(Tournament.created_at.desc()).limit(200)).all()
    return [tournament_out(t, with_matches=False) for t in rows]


@router.get("/stats")
def overall_stats(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Overall match stats across every tournament: records, who played, heroes."""
    matches = db.scalars(select(TournamentMatch)).all()
    names = {t.id: t.name for t in db.scalars(select(Tournament)).all()}
    return series_stats(list(matches), user_names(db), tournament_names=names)


def player_tournament_stats(db: Session, user_id: int) -> dict:
    """One player's tournament games (from game lineups) for the player page."""
    matches = db.scalars(select(TournamentMatch).where(TournamentMatch.status == "played")).all()
    names = {t.id: t.name for t in db.scalars(select(Tournament)).all()}
    row = next((p for p in series_stats(list(matches), {}, tournament_names=names)["players"]
                if p["user_id"] == user_id), None)
    recent = []
    ordered = sorted(matches, key=lambda m: (m.scheduled_date or date.min, m.id), reverse=True)
    for m in ordered:
        for g in reversed(match_games(m)):
            lane = next((ln for ln, uid in g["lineup"].items() if uid == user_id), None)
            if lane:
                recent.append({"tournament_id": m.tournament_id, "tournament": names.get(m.tournament_id, ""),
                               "match_id": m.id, "opponent": m.opponent, "game_no": g["game_no"],
                               "lane": lane, "hero": (g["draft"].get("our_picks") or {}).get(lane, ""),
                               "result": implied_result(m, g),
                               "date": m.scheduled_date.isoformat() if m.scheduled_date else None})
    empty = {"games": 0, "wins": 0, "losses": 0, "win_rate": None, "series": 0, "tournaments": 0,
             "main_lane": "", "lanes": {}, "heroes": []}
    out = {k: v for k, v in (row or empty).items() if k not in {"user_id", "name"}}
    out["form"] = [r["result"] for r in recent[:5]]
    out["recent"] = recent[:8]
    return out


@router.get("/review-queue")
def review_queue(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Played matches flagged for review that have no review filed yet."""
    ms = db.scalars(
        select(TournamentMatch)
        .where(TournamentMatch.status == "played", TournamentMatch.review_queued.is_(True))
        .order_by(TournamentMatch.scheduled_date.desc().nullslast(), TournamentMatch.id.desc())
    ).all()
    out = []
    for m in ms:
        if m.review is not None:
            continue
        o = match_out(m)
        o["tournament_id"] = m.tournament_id
        o["tournament_name"] = m.tournament.name
        out.append(o)
    return out


@router.post("", status_code=201)
def create_tournament(payload: TournamentIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_scrims(user), "create tournaments")
    t = Tournament(name=payload.name.strip(), status="upcoming", review_queued=payload.review_queued,
                   start_date=payload.start_date, end_date=payload.end_date,
                   notes=payload.notes, created_by=user.id)
    db.add(t)
    db.commit()
    db.refresh(t)
    return tournament_out(t)


@router.get("/{tournament_id}")
def get_tournament(tournament_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    return tournament_out(_get(db, tournament_id))


@router.patch("/{tournament_id}")
def update_tournament(tournament_id: int, payload: TournamentPatch, db: Session = Depends(get_db),
                      user=Depends(get_current_user)):
    require(can.manage_scrims(user), "update tournaments")
    t = _get(db, tournament_id)
    data = payload.model_dump(exclude_unset=True)
    if (st := data.pop("status", None)) is not None and st in {"upcoming", "ongoing", "finished"}:
        t.status = st
    for k, v in data.items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return tournament_out(t)


@router.delete("/{tournament_id}", status_code=204)
def delete_tournament(tournament_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_scrims(user), "delete tournaments")
    t = _get(db, tournament_id)
    send_to_trash(db, [t], user=user, kind="tournament", area="tournaments", label=t.name)
    db.delete(t)
    db.commit()


# --------------------------------- matches --------------------------------- #
@router.post("/{tournament_id}/matches", status_code=201)
def add_match(tournament_id: int, payload: MatchIn, db: Session = Depends(get_db),
              user=Depends(get_current_user)):
    require(can.upload_results(user), "schedule tournament matches")
    t = _get(db, tournament_id)
    m = TournamentMatch(
        tournament_id=t.id,
        match_no=(max((x.match_no for x in t.matches), default=0) + 1),
        stage=payload.stage.strip(),
        scheduled_date=payload.scheduled_date,
        start_time=payload.start_time,
        opponent=payload.opponent.strip(),
        format=payload.format,
        review_queued=payload.review_queued,
        notes=payload.notes,
    )
    db.add(m)
    db.commit()
    db.refresh(t)
    return tournament_out(t)


def _get_match(db: Session, match_id: int) -> TournamentMatch:
    m = db.get(TournamentMatch, match_id)
    if m is None:
        raise HTTPException(status_code=404, detail="Match not found")
    return m


@router.patch("/matches/{match_id}")
def update_match(match_id: int, payload: MatchPatch, db: Session = Depends(get_db),
                 user=Depends(get_current_user)):
    require(can.upload_results(user), "update tournament matches")
    m = _get_match(db, match_id)
    data = payload.model_dump(exclude_unset=True)
    if (st := data.pop("status", None)) is not None and st in {"scheduled", "played", "cancelled"}:
        m.status = st
    if (rs := data.pop("result", None)) is not None:
        m.result = rs.upper() if rs.upper() in {"WIN", "LOSS", "DRAW"} else ""
    if (dr := data.pop("draft", None)) is not None:
        # Legacy single-draft write = game 1 of the series.
        _store_game(m, 1, dr, None, None)
    if (at := data.pop("attachments", None)) is not None:
        m.attachments = dumps(at)
    for k, v in data.items():
        setattr(m, k, v)
    db.commit()
    db.refresh(m)
    return tournament_out(m.tournament)


def _store_game(m: TournamentMatch, game_no: int, draft: dict | None, result: str | None,
                lineup: dict | None, player_stats: dict | None = None, enemy_stats: dict | None = None) -> None:
    """Write one game. draft=None clears the game; lineup/stats=None keep what's saved."""
    games = {g["game_no"]: g for g in match_games(m)}
    previous = games.get(game_no, {})
    line = clean_lineup(lineup) if lineup is not None else previous.get("lineup", {})
    if draft is None or (not draft_has_content(draft) and not line):
        games.pop(game_no, None)
    else:
        res = (result if result is not None else previous.get("result", "")) or ""
        res = res.upper() if res.upper() in {"WIN", "LOSS"} else ""
        games[game_no] = {
            "game_no": game_no, "result": res, "draft": clean_draft(draft), "lineup": line,
            "player_stats": clean_player_stats(player_stats) if player_stats is not None else previous.get("player_stats", {}),
            "enemy_stats": clean_enemy_stats(enemy_stats) if enemy_stats is not None else previous.get("enemy_stats", {}),
        }
    m.game_drafts = dumps([games[k] for k in sorted(games)])
    m.draft = dumps(games[1]["draft"]) if 1 in games else "{}"


@router.put("/matches/{match_id}/games/{game_no}")
def save_game_draft(match_id: int, game_no: int, payload: GameDraftIn, db: Session = Depends(get_db),
                    user=Depends(get_current_user)):
    """Save the draft for one game of the series (game 2 of a 2–0, game 3 of a 2–1…)."""
    require(can.upload_results(user), "save tournament drafts")
    m = _get_match(db, match_id)
    if game_no < 1 or game_no > max_games(m.format):
        raise HTTPException(status_code=422, detail=f"{m.format} has games 1–{max_games(m.format)}; game {game_no} doesn't exist")
    if game_no > game_slots(m):
        raise HTTPException(
            status_code=422,
            detail=(f"Score is {m.score_us}–{m.score_them}, so this series has {game_slots(m)} game(s) — "
                    f"update the score to add game {game_no}"),
        )
    lineup = None
    if payload.lineup is not None:
        unknown = sorted({str(k).upper() for k in payload.lineup} - set(LANES))
        if unknown:
            raise HTTPException(status_code=422, detail=f"Unknown lane(s): {', '.join(unknown)}")
        lineup = clean_lineup(payload.lineup)
        ids = list(lineup.values())
        if len(ids) != len(set(ids)):
            raise HTTPException(status_code=422, detail="A player can only play one lane in a game")
        if ids and len(db.scalars(select(User.id).where(User.id.in_(ids))).all()) != len(set(ids)):
            raise HTTPException(status_code=422, detail="Lineup has a player who doesn't exist")
    saved_lineup = next((g["lineup"] for g in match_games(m) if g["game_no"] == game_no), {})
    if not draft_has_content(payload.draft) and not (lineup if lineup is not None else saved_lineup):
        raise HTTPException(status_code=422, detail="Add who played or pick/ban at least one hero to save this game")
    _store_game(m, game_no, payload.draft, payload.result, lineup, payload.player_stats, payload.enemy_stats)
    db.commit()
    db.refresh(m)
    return tournament_out(m.tournament)


@router.delete("/matches/{match_id}/games/{game_no}")
def clear_game_draft(match_id: int, game_no: int, db: Session = Depends(get_db),
                     user=Depends(get_current_user)):
    require(can.upload_results(user), "clear tournament drafts")
    m = _get_match(db, match_id)
    game = next((g for g in match_games(m) if g["game_no"] == game_no), None)
    if game is None:
        raise HTTPException(status_code=404, detail=f"Game {game_no} has nothing saved")
    send_to_trash(db, user=user, kind="tournament_game", area="tournaments",
                  label=f"Game {game_no} · M{m.match_no} vs {m.opponent} · {m.tournament.name}",
                  summary=" · ".join(x for x in ("who played" if game["lineup"] else "",
                                                  "draft" if draft_has_content(game["draft"]) else "") if x),
                  custom={"match_id": m.id, "game": game}, target_id=m.tournament_id)
    _store_game(m, game_no, None, None, None)
    db.commit()
    db.refresh(m)
    return tournament_out(m.tournament)


@router.delete("/matches/{match_id}", status_code=204)
def delete_match(match_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.upload_results(user), "delete tournament matches")
    m = _get_match(db, match_id)
    send_to_trash(db, [m], user=user, kind="tournament_match", area="tournaments",
                  label=f"M{m.match_no} vs {m.opponent} · {m.tournament.name}")
    db.delete(m)
    db.commit()


def _restore_game_sheet(db: Session, item) -> list[str]:
    """Put a cleared game sheet (who played + draft) back on its match."""
    custom = loads(item.payload, {}).get("custom") or {}
    m = db.get(TournamentMatch, custom.get("match_id"))
    if m is None:
        from ..trash import RestoreConflict
        raise RestoreConflict("Can't restore: its match no longer exists. Restore the match from Trash first.")
    game = custom.get("game") or {}
    no = int(game.get("game_no") or 0)
    if any(g["game_no"] == no for g in match_games(m)):
        from ..trash import RestoreConflict
        raise RestoreConflict(f"Can't restore: game {no} already has a new sheet. Clear it first, then restore.")
    _store_game(m, no, game.get("draft") or {}, game.get("result") or "", game.get("lineup") or {},
                game.get("player_stats") or {}, game.get("enemy_stats") or {})
    return []


from ..trash import CUSTOM_RESTORERS as _CUSTOM  # noqa: E402

_CUSTOM["tournament_game"] = _restore_game_sheet
