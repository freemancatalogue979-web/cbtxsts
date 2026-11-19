"""Scrim manager + scrim results database.

House rule enforced here: NO REVIEW, NO NEXT SCRIM — booking a new scrim is
blocked while a played LOSS has no match review on file.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..deps import can, get_current_user, get_db, require
from ..trash import send_to_trash
from ..models import Scrim, ScrimGame, User, dumps, loads
from ..performance import appearances, clean_enemy_stats, clean_lineup, clean_player_stats, team_stats
from ..security import LANES
from ..schemas import GameIn, ScrimIn, ScrimPatch
from ..serializers import game_out, scrim_out

router = APIRouter(prefix="/scrims", tags=["scrims"])


def blocking_losses(db: Session) -> list[Scrim]:
    losses = db.scalars(
        select(Scrim).where(Scrim.status == "played", Scrim.result == "LOSS")
        .order_by(Scrim.scrim_date.desc())
    ).all()
    return [s for s in losses if s.review is None]


@router.get("")
@router.get("/")
def list_scrims(
    opponent: str | None = Query(default=None),
    result: str | None = Query(default=None),
    player_id: int | None = Query(default=None),
    hero: str | None = Query(default=None),
    status: str | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    stmt = select(Scrim).order_by(Scrim.scrim_date.desc().nullslast(), Scrim.number.desc())
    if opponent:
        stmt = stmt.where(Scrim.opponent.ilike(f"%{opponent}%"))
    if result:
        stmt = stmt.where(Scrim.result == result.upper())
    if status:
        stmt = stmt.where(Scrim.status == status)
    if date_from:
        stmt = stmt.where(Scrim.scrim_date >= date_from)
    if date_to:
        stmt = stmt.where(Scrim.scrim_date <= date_to)
    scrims = db.scalars(stmt.limit(500)).all()
    out = []
    for s in scrims:
        row = scrim_out(s, with_games=bool(hero))
        if player_id is not None:
            lineup_ids = list(row["lineup"].values()) + row["substitutes"]
            if player_id not in lineup_ids:
                continue
        if hero:
            needle = hero.lower()
            picks = []
            for g in row["games"]:
                draft = g["draft"] or {}
                for side in ("our_picks", "enemy_picks"):
                    picks += [str(v).lower() for v in (draft.get(side) or {}).values()]
                picks += [str(b).lower() for b in draft.get("our_bans") or []]
                picks += [str(b).lower() for b in draft.get("enemy_bans") or []]
            if needle not in picks:
                continue
            for g in row["games"]:
                g.pop("draft", None)
        out.append(row)
    return out


@router.get("/summary")
def scrims_summary(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Searchable-results overview: totals, opponent records, duration/KDA averages."""
    played = db.scalars(select(Scrim).where(Scrim.status == "played")).all()
    total = len(played)
    wins = sum(1 for s in played if s.result == "WIN")
    losses = total - wins

    opponents: dict[str, dict] = {}
    for s in played:
        rec = opponents.setdefault(s.opponent, {"opponent": s.opponent, "played": 0, "won": 0, "lost": 0})
        rec["played"] += 1
        rec["won" if s.result == "WIN" else "lost"] += 1
    records = sorted(opponents.values(), key=lambda r: (-r["played"], r["opponent"]))

    games = db.scalars(
        select(ScrimGame).join(Scrim, ScrimGame.scrim_id == Scrim.id).where(Scrim.status == "played")
    ).all()
    g_n = len(games)
    dur = kills = deaths = 0.0
    objectives = 0
    for g in games:
        st = loads(g.stats, {})
        dur += g.duration_min or 0
        kills += int(st.get("kills") or 0)
        deaths += int(st.get("deaths") or 0)
        objectives += int(st.get("turtles") or 0) + int(st.get("lords") or 0)
    game_wins = sum(1 for g in games if g.result == "WIN")

    return {
        "series": {"total": total, "wins": wins, "losses": losses,
                   "win_rate": round(100 * wins / total, 1) if total else None},
        "games": {"total": g_n, "wins": game_wins, "losses": g_n - game_wins,
                  "win_rate": round(100 * game_wins / g_n, 1) if g_n else None},
        "averages": {
            "duration_min": round(dur / g_n, 1) if g_n else None,
            "kills": round(kills / g_n, 1) if g_n else None,
            "deaths": round(deaths / g_n, 1) if g_n else None,
            "objectives": round(objectives / g_n, 1) if g_n else None,
        },
        "opponents": records,
        "blocking_losses": [scrim_out(s, with_games=False) for s in blocking_losses(db)],
    }


@router.get("/stats")
def scrim_stats(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Who played every scrim game (and on which heroes), plus series/game records."""
    played = db.scalars(select(Scrim).where(Scrim.status == "played")).all()
    games = [g for s in played for g in s.games]
    wins = sum(1 for s in played if s.result == "WIN")
    losses = sum(1 for s in played if s.result == "LOSS")
    g_w = sum(1 for g in games if g.result == "WIN")
    g_l = sum(1 for g in games if g.result == "LOSS")
    apps = [a for a in appearances(db) if a.source == "scrim"]
    names = {u.id: (u.ign or u.name) for u in db.scalars(select(User)).all()}
    pct = lambda w, t: round(100 * w / t, 1) if t else None  # noqa: E731
    out = team_stats(apps, names,
                     series={"played": len(played), "wins": wins, "losses": losses,
                             "draws": len(played) - wins - losses, "win_rate": pct(wins, len(played))},
                     games={"played": len(games), "wins": g_w, "losses": g_l, "win_rate": pct(g_w, g_w + g_l),
                            "with_lineup": len({(a.match_id, a.game_no) for a in apps}),
                            "with_player_stats": sum(1 for g in games if loads(g.player_stats or "{}", {}))})
    return out


def _n(value) -> float | None:
    if isinstance(value, bool) or value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _rate(wins: int, games: int) -> float | None:
    return round(100 * wins / games, 1) if games else None


def scrim_insights_data(played: list[Scrim]) -> dict:
    """Chart-ready numbers for the scrim dashboard (pure: tested without a DB)."""
    played = sorted(played, key=lambda s: (s.scrim_date or date.min, s.number or 0, s.id or 0))
    timeline, monthly, opp = [], {}, {}
    wins_so_far = 0
    obj = {k: [0.0, 0.0, 0] for k in ("kills", "turrets", "turtles", "lords", "gold")}
    buckets = [("Under 12 min", 0, 12), ("12–16 min", 12, 16), ("16–20 min", 16, 20), ("20 min +", 20, 999)]
    dur = {b[0]: [0, 0] for b in buckets}
    early = {"ahead": [0, 0], "behind": [0, 0]}
    lord_edge = {"more": [0, 0], "fewer": [0, 0]}
    picked, faced, our_bans, their_bans = {}, {}, {}, {}
    lanes = {ln: {"games": 0, "kills": 0.0, "deaths": 0.0, "assists": 0.0, "rating": 0.0, "rated": 0} for ln in LANES}

    def tally(table: dict, hero, win: bool | None = None) -> None:
        if not hero:
            return
        row = table.setdefault(str(hero), [0, 0])
        row[0] += 1
        row[1] += 1 if win else 0

    for i, sc in enumerate(played, 1):
        won = sc.result == "WIN"
        wins_so_far += won
        g_kills = g_deaths = 0.0
        g_seen = 0
        for g in sc.games:
            st = loads(g.stats, {}) or {}
            gw = g.result == "WIN"
            k, d = _n(st.get("kills")), _n(st.get("deaths"))
            if k is not None:
                g_kills += k
                g_seen += 1
            if d is not None:
                g_deaths += d
            for key, us_key, them_key in (("kills", "kills", "enemy_kills"), ("turrets", "turrets", "enemy_turrets"),
                                          ("turtles", "turtles", "enemy_turtles"), ("lords", "lords", "enemy_lords"),
                                          ("gold", "gold", "enemy_gold")):
                a, b = _n(st.get(us_key)), _n(st.get(them_key))
                if key == "kills" and b is None:
                    b = _n(st.get("deaths"))
                if a is not None and b is not None:
                    obj[key][0] += a
                    obj[key][1] += b
                    obj[key][2] += 1
            if g.result in {"WIN", "LOSS"} and g.duration_min:
                for name, lo, hi in buckets:
                    if lo <= g.duration_min < hi:
                        dur[name][0] += 1
                        dur[name][1] += gw
            gd10 = _n(st.get("gold_diff_10"))
            if gd10 is not None and gd10 != 0 and g.result in {"WIN", "LOSS"}:
                side = early["ahead" if gd10 > 0 else "behind"]
                side[0] += 1
                side[1] += gw
            lu, le = _n(st.get("lords")), _n(st.get("enemy_lords"))
            if lu is not None and le is not None and lu != le and g.result in {"WIN", "LOSS"}:
                side = lord_edge["more" if lu > le else "fewer"]
                side[0] += 1
                side[1] += gw
            dr = loads(g.draft, {}) or {}
            for h in (dr.get("our_picks") or {}).values():
                tally(picked, h, gw)
            for h in (dr.get("enemy_picks") or {}).values():
                tally(faced, h, gw)
            for h in dr.get("our_bans") or []:
                tally(our_bans, h)
            for h in dr.get("enemy_bans") or []:
                tally(their_bans, h)
            for ln, line in (loads(g.player_stats or "{}", {}) or {}).items():
                if ln not in lanes or not isinstance(line, dict):
                    continue
                row = lanes[ln]
                if any(_n(line.get(x)) is not None for x in ("kills", "deaths", "assists")):
                    row["games"] += 1
                    for x in ("kills", "deaths", "assists"):
                        row[x] += _n(line.get(x)) or 0
                if _n(line.get("rating")) is not None:
                    row["rating"] += _n(line.get("rating"))
                    row["rated"] += 1
        game_w = sum(1 for g in sc.games if g.result == "WIN")
        game_l = sum(1 for g in sc.games if g.result == "LOSS")
        timeline.append({
            "id": sc.id, "number": sc.number, "opponent": sc.opponent,
            "date": sc.scrim_date.isoformat() if sc.scrim_date else None, "result": sc.result,
            "score_us": sc.score_us, "score_them": sc.score_them,
            "games": len(sc.games), "game_wins": game_w, "game_losses": game_l,
            "kills": round(g_kills / g_seen, 1) if g_seen else None,
            "deaths": round(g_deaths / g_seen, 1) if g_seen else None,
            "win_rate_to_date": _rate(wins_so_far, i),
        })
        if sc.scrim_date:
            m = monthly.setdefault(sc.scrim_date.strftime("%Y-%m"), {"month": sc.scrim_date.strftime("%Y-%m"), "played": 0, "wins": 0})
            m["played"] += 1
            m["wins"] += won
        o = opp.setdefault(sc.opponent, {"opponent": sc.opponent, "played": 0, "won": 0, "lost": 0, "game_wins": 0, "game_losses": 0})
        o["played"] += 1
        o["won" if won else "lost"] += 1
        o["game_wins"] += game_w
        o["game_losses"] += game_l

    # rolling form (last 5 series) next to the to-date line
    for i, row in enumerate(timeline):
        window = timeline[max(0, i - 4):i + 1]
        row["win_rate_last5"] = _rate(sum(1 for r in window if r["result"] == "WIN"), len(window))
    form = [r["result"] for r in timeline[-10:]]
    streak = {"result": None, "count": 0}
    for r in reversed(timeline):
        if streak["result"] in (None, r["result"]):
            streak = {"result": r["result"], "count": streak["count"] + 1}
        else:
            break

    def top(table: dict, n: int = 8, by_rate: bool = False) -> list[dict]:
        rows = [{"hero": h, "games": v[0], "wins": v[1], "win_rate": _rate(v[1], v[0])} for h, v in table.items()]
        rows.sort(key=lambda r: (-r["games"], r["hero"]))
        return rows[:n]

    def side(pair: list[int]) -> dict:
        return {"games": pair[0], "wins": pair[1], "win_rate": _rate(pair[1], pair[0])}

    return {
        "timeline": timeline,
        "form": form,
        "streak": streak,
        "monthly": [{**m, "win_rate": _rate(m["wins"], m["played"])} for m in sorted(monthly.values(), key=lambda m: m["month"])],
        "objectives": {k: {"us": round(v[0] / v[2], 1), "them": round(v[1] / v[2], 1), "games": v[2]}
                       for k, v in obj.items() if v[2]},
        "duration": [{"bucket": name, "games": dur[name][0], "wins": dur[name][1], "win_rate": _rate(dur[name][1], dur[name][0])}
                     for name, _lo, _hi in buckets],
        "early": {"ahead_at_10": side(early["ahead"]), "behind_at_10": side(early["behind"])},
        "lord_edge": {"more_lords": side(lord_edge["more"]), "fewer_lords": side(lord_edge["fewer"])},
        "heroes": {"picked": top(picked), "faced": top(faced),
                   "banned_by_us": top(our_bans), "banned_by_them": top(their_bans)},
        "lanes": [{"lane": ln, "games": r["games"],
                   "kda": round((r["kills"] + r["assists"]) / max(1.0, r["deaths"]), 2) if r["games"] else None,
                   "kills": round(r["kills"] / r["games"], 1) if r["games"] else None,
                   "deaths": round(r["deaths"] / r["games"], 1) if r["games"] else None,
                   "assists": round(r["assists"] / r["games"], 1) if r["games"] else None,
                   "rating": round(r["rating"] / r["rated"], 1) if r["rated"] else None} for ln, r in lanes.items()],
        "opponents": sorted(opp.values(), key=lambda o: (-o["played"], o["opponent"])),
    }


@router.get("/insights")
def scrim_insights(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Everything the scrim dashboard charts: form over time, objectives, durations, heroes, lanes, opponents."""
    played = db.scalars(select(Scrim).where(Scrim.status == "played")).all()
    return scrim_insights_data(list(played))


def _game_lineup(db: Session, lineup: dict | None) -> dict[str, int] | None:
    """Validate who played a game. None = not sent (keep what's saved)."""
    if lineup is None:
        return None
    unknown = sorted({str(k).upper() for k in lineup} - set(LANES))
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown lane(s): {', '.join(unknown)}")
    clean = clean_lineup(lineup)
    ids = list(clean.values())
    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=422, detail="A player can only play one lane in a game")
    if ids and len(db.scalars(select(User.id).where(User.id.in_(ids))).all()) != len(ids):
        raise HTTPException(status_code=422, detail="Lineup has a player who doesn't exist")
    return clean


@router.get("/{scrim_id}")
def get_scrim(scrim_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    scrim = db.get(Scrim, scrim_id)
    if scrim is None:
        raise HTTPException(status_code=404, detail="Scrim not found")
    return scrim_out(scrim)


@router.post("", status_code=201)
@router.post("/", status_code=201)
def create_scrim(payload: ScrimIn, force: bool = Query(default=False),
                 db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_scrims(user), "create scrims")
    blocks = blocking_losses(db)
    if blocks and not (force and user.role == "admin"):
        raise HTTPException(
            status_code=409,
            detail={
                "rule": "NO REVIEW, NO NEXT SCRIM",
                "message": f"Scrim #{blocks[0].number} vs {blocks[0].opponent} was a LOSS and has no "
                           f"match review. File the review before booking the next scrim.",
                "blocking": [{"scrim_id": s.id, "number": s.number, "opponent": s.opponent,
                              "date": s.scrim_date.isoformat() if s.scrim_date else None}
                             for s in blocks],
            },
        )
    next_number = (db.scalar(select(func.max(Scrim.number))) or 0) + 1
    scrim = Scrim(
        number=next_number, opponent=payload.opponent.strip(), scrim_date=payload.date,
        start_time=payload.time, format=payload.format.upper(), server=payload.server,
        tournament_prep=payload.tournament_prep, lineup=dumps(payload.lineup),
        substitutes=dumps(payload.substitutes), notes=payload.notes,
        expected_strategy=payload.expected_strategy, status="scheduled", created_by=user.id,
    )
    db.add(scrim)
    db.commit()
    db.refresh(scrim)
    return scrim_out(scrim)


@router.patch("/{scrim_id}")
def update_scrim(scrim_id: int, payload: ScrimPatch, db: Session = Depends(get_db),
                 user=Depends(get_current_user)):
    scrim = db.get(Scrim, scrim_id)
    if scrim is None:
        raise HTTPException(status_code=404, detail="Scrim not found")
    data = payload.model_dump(exclude_unset=True)

    # Result columns only through the results-upload capability.
    result_fields = {"status", "result", "attachments"}
    if set(data) & result_fields and not set(data) - result_fields:
        require(can.upload_results(user) or can.manage_scrims(user), "upload scrim results")
    else:
        require(can.manage_scrims(user), "edit scrims")

    if "date" in data:
        data["scrim_date"] = data.pop("date")
    if "time" in data:
        data["start_time"] = data.pop("time")
    if "format" in data and data["format"]:
        data["format"] = data["format"].upper()
    if "result" in data and data["result"]:
        data["result"] = data["result"].upper()
    if "lineup" in data and data["lineup"] is not None:
        data["lineup"] = dumps(data["lineup"])
    if "substitutes" in data and data["substitutes"] is not None:
        data["substitutes"] = dumps(data["substitutes"])
    if "attachments" in data and data["attachments"] is not None:
        data["attachments"] = dumps(data["attachments"])

    if data.get("result") in {"WIN", "LOSS", "DRAW"}:
        data.setdefault("status", "played")
    for key, value in data.items():
        setattr(scrim, key, value)

    # Keep the series score in sync with recorded games.
    if scrim.games:
        scrim.score_us = sum(1 for g in scrim.games if g.result == "WIN")
        scrim.score_them = sum(1 for g in scrim.games if g.result == "LOSS")
        if not data.get("result") and (scrim.score_us or scrim.score_them):
            scrim.result = "WIN" if scrim.score_us > scrim.score_them else ("LOSS" if scrim.score_them > scrim.score_us else "")
            if scrim.result:
                scrim.status = "played"
    db.commit()
    db.refresh(scrim)
    return scrim_out(scrim)


@router.post("/{scrim_id}/games", status_code=201)
def add_game(scrim_id: int, payload: GameIn, db: Session = Depends(get_db),
             user=Depends(get_current_user)):
    require(can.upload_results(user) or can.manage_scrims(user), "record scrim games")
    scrim = db.get(Scrim, scrim_id)
    if scrim is None:
        raise HTTPException(status_code=404, detail="Scrim not found")
    result = payload.result.upper()
    if result not in {"WIN", "LOSS", ""}:
        raise HTTPException(status_code=422, detail="result must be WIN or LOSS")
    lineup = _game_lineup(db, payload.lineup)
    game = ScrimGame(scrim_id=scrim.id, game_no=payload.game_no, result=result,
                     duration_min=payload.duration_min,
                     stats=dumps(payload.stats), draft=dumps(payload.draft),
                     lineup=dumps(lineup or {}), player_stats=dumps(clean_player_stats(payload.player_stats)),
                     enemy_stats=dumps(clean_enemy_stats(payload.enemy_stats)))
    db.add(game)
    us = sum(1 for g in scrim.games if g.result == "WIN") + (1 if result == "WIN" else 0)
    them = sum(1 for g in scrim.games if g.result == "LOSS") + (1 if result == "LOSS" else 0)
    scrim.score_us, scrim.score_them = us, them
    if us or them:
        scrim.result = "WIN" if us > them else "LOSS"
        scrim.status = "played"
    db.commit()
    db.refresh(game)
    return game_out(game)


def _restore_scrim_game(db: Session, item, remap) -> list[str]:
    """After a game comes back from Trash, its scrim's series score follows."""
    from ..models import loads as _loads

    rows = _loads(item.payload, {}).get("rows", [])
    scrim_ids = {r["d"].get("scrim_id") for r in rows if r["t"] == "scrim_games"}
    for sid in scrim_ids:
        scrim = db.get(Scrim, sid)
        if scrim is not None:
            db.refresh(scrim)
            _rescore(scrim)
    return []


def _rescore(scrim: Scrim) -> None:
    """Recompute series score/result from the (remaining) games."""
    us = sum(1 for g in scrim.games if g.result == "WIN")
    them = sum(1 for g in scrim.games if g.result == "LOSS")
    scrim.score_us, scrim.score_them = us, them
    if us or them:
        scrim.result = "WIN" if us > them else "LOSS"
        scrim.status = "played"


class GamePatch(BaseModel):
    game_no: int | None = None
    result: str | None = None
    duration_min: float | None = None
    stats: dict | None = None
    draft: dict | None = None
    lineup: dict[str, int | None] | None = None
    player_stats: dict[str, dict] | None = None
    enemy_stats: dict[str, dict] | None = None


@router.patch("/{scrim_id}/games/{game_id}")
def update_game(scrim_id: int, game_id: int, payload: GamePatch, db: Session = Depends(get_db),
                user=Depends(get_current_user)):
    require(can.upload_results(user) or can.manage_scrims(user), "edit scrim games")
    scrim = db.get(Scrim, scrim_id)
    game = db.get(ScrimGame, game_id)
    if scrim is None or game is None or game.scrim_id != scrim_id:
        raise HTTPException(status_code=404, detail="Game not found")
    data = payload.model_dump(exclude_unset=True)
    if (rs := data.pop("result", None)) is not None:
        r = rs.upper()
        if r not in {"WIN", "LOSS", ""}:
            raise HTTPException(status_code=422, detail="result must be WIN or LOSS")
        game.result = r
    if (st := data.pop("stats", None)) is not None:
        game.stats = dumps(st)
    if (dr := data.pop("draft", None)) is not None:
        game.draft = dumps(dr)
    if "lineup" in data:
        game.lineup = dumps(_game_lineup(db, data.pop("lineup")) or {})
    if "player_stats" in data:
        game.player_stats = dumps(clean_player_stats(data.pop("player_stats")))
    if "enemy_stats" in data:
        game.enemy_stats = dumps(clean_enemy_stats(data.pop("enemy_stats")))
    for k, v in data.items():
        setattr(game, k, v)
    db.flush()
    db.refresh(scrim)
    _rescore(scrim)
    db.commit()
    db.refresh(game)
    return game_out(game)


@router.delete("/{scrim_id}/games/{game_id}", status_code=204)
def delete_game(scrim_id: int, game_id: int, db: Session = Depends(get_db),
                user=Depends(get_current_user)):
    require(can.upload_results(user) or can.manage_scrims(user), "edit scrim games")
    game = db.get(ScrimGame, game_id)
    if game is None or game.scrim_id != scrim_id:
        raise HTTPException(status_code=404, detail="Game not found")
    scrim = game.scrim
    send_to_trash(db, [game], user=user, kind="scrim_game", area="scrims",
                  label=f"Game {game.game_no} · Scrim #{scrim.number} vs {scrim.opponent}")
    db.delete(game)
    db.flush()
    db.refresh(scrim)
    _rescore(scrim)
    db.commit()
    scrim = db.get(Scrim, scrim_id)
    if scrim:
        scrim.score_us = sum(1 for g in scrim.games if g.result == "WIN")
        scrim.score_them = sum(1 for g in scrim.games if g.result == "LOSS")
        db.commit()
    return None


@router.delete("/{scrim_id}", status_code=204)
def delete_scrim(scrim_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_scrims(user), "delete scrims")
    scrim = db.get(Scrim, scrim_id)
    if scrim is None:
        raise HTTPException(status_code=404, detail="Scrim not found")
    send_to_trash(db, [scrim], user=user, kind="scrim", area="scrims", label=f"Scrim #{scrim.number} vs {scrim.opponent}")
    db.delete(scrim)
    db.commit()
    return None


from ..trash import RESTORE_HOOKS as _HOOKS  # noqa: E402

_HOOKS["scrim_game"] = _restore_scrim_game
