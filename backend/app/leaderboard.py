"""Players leaderboard + each member's Utility (solo game) numbers for the Players tab.

Everyone on the team can see how everyone is doing. A member's numbers pool their team
games (scrims + tournaments) and the games they add themselves in Utility. The score is
plain arithmetic over those games — nothing is estimated or invented:

* win rate            45%
* KDA (capped at 6)   25%
* match rating (/15)  20%
* games played (/20)  10%   (adding your games is part of doing well)

A part with no data (say nobody typed K/D/A) is left out and the others are scaled up.
You need ``MIN_GAMES`` games with a result in the period to be ranked; until then the
row says what is missing so the member knows to add their games.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Iterable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .insights import person_weeks, week_starts
from .models import SoloGame, User, utcnow
from .performance import Appearance, appearances, hero_key
from .serializers import avatar_url
from .solo_games import solo_stats, user_games

MIN_GAMES = 5
PERIODS = {"30": 30, "90": 90, "all": 0}
STALE_DAYS = 10
WEIGHTS = {"win": 0.45, "kda": 0.25, "rating": 0.20, "volume": 0.10}
STAFF = {"admin", "captain", "coach", "analyst"}


def _pct(won: int, total: int) -> float | None:
    return round(100 * won / total, 1) if total else None


def _line(kills=None, deaths=None, assists=None, rating=None, mvp=False) -> dict:
    return {"kills": kills, "deaths": deaths, "assists": assists, "rating": rating, "mvp": bool(mvp)}


def _game(day: date | None, hero: str, result: str, line: dict, where: str) -> dict:
    return {"day": day, "hero": (hero or "").strip(), "result": result if result in {"WIN", "LOSS"} else "", "where": where, **line}


def _team_game(a: Appearance) -> dict:
    k = a.kda
    return _game(a.day, a.hero, a.result, _line(k.get("kills"), k.get("deaths"), k.get("assists"), k.get("rating"), k.get("mvp")),
                 a.source)


def _solo_game(g: SoloGame) -> dict:
    return _game(g.played_on or (g.created_at.date() if g.created_at else None), g.hero, g.result,
                 _line(g.kills, g.deaths, g.assists, g.rating, g.mvp), "solo")


def numbers(games: list[dict]) -> dict:
    """Record, KDA, rating and MVPs over a member's games (newest first)."""
    decided = [g for g in games if g["result"]]
    wins = sum(g["result"] == "WIN" for g in decided)
    lined = [g for g in games if any(g[k] is not None for k in ("kills", "deaths", "assists"))]
    rated = [g["rating"] for g in games if g["rating"] is not None]
    out: dict[str, Any] = {"games": len(games), "wins": wins, "losses": len(decided) - wins,
                           "win_rate": _pct(wins, len(decided)), "kda": None, "rating": None,
                           "mvps": sum(g["mvp"] for g in games),
                           "team_games": sum(g["where"] != "solo" for g in games),
                           "solo_games": sum(g["where"] == "solo" for g in games),
                           "form": [g["result"] for g in decided[:5]]}
    if lined:
        k = sum(g["kills"] or 0 for g in lined)
        d = sum(g["deaths"] or 0 for g in lined)
        a = sum(g["assists"] or 0 for g in lined)
        n = len(lined)
        out["kda"] = {"games": n, "kills": round(k / n, 1), "deaths": round(d / n, 1), "assists": round(a / n, 1),
                      "ratio": round((k + a) / max(d, 1), 2)}
    if rated:
        out["rating"] = round(sum(rated) / len(rated), 1)
    return out


def score(n: dict) -> dict | None:
    """0–100 from the parts that have data; ``None`` until there are enough decided games."""
    if n["wins"] + n["losses"] < MIN_GAMES:
        return None
    parts = {"win": n["win_rate"] or 0.0, "volume": min(n["games"] / 20, 1) * 100}
    if n["kda"]:
        parts["kda"] = min(n["kda"]["ratio"], 6) / 6 * 100
    if n["rating"] is not None:
        parts["rating"] = min(n["rating"], 15) / 15 * 100
    weight = sum(WEIGHTS[k] for k in parts)
    value = sum(parts[k] * WEIGHTS[k] for k in parts) / weight
    return {"value": round(value, 1), "parts": {k: round(v, 1) for k, v in parts.items()}}


def top_heroes(games: list[dict], limit: int = 3) -> list[dict]:
    groups: dict[str, list[dict]] = defaultdict(list)
    names: dict[str, str] = {}
    for g in games:
        if g["hero"]:
            key = hero_key(g["hero"])
            groups[key].append(g)
            names.setdefault(key, g["hero"])
    rows = []
    for key, gs in groups.items():
        decided = [g for g in gs if g["result"]]
        wins = sum(g["result"] == "WIN" for g in decided)
        rows.append({"hero": names[key], "games": len(gs), "wins": wins, "win_rate": _pct(wins, len(decided))})
    rows.sort(key=lambda r: (-r["games"], -(r["win_rate"] or 0), r["hero"]))
    return rows[:limit]


def _nudge(n: dict, solo_total: int, last_added: date | None, today: date) -> str:
    decided = n["wins"] + n["losses"]
    if solo_total == 0 and decided < MIN_GAMES:
        return "No games added yet: upload a screenshot or sheet in Utility to get on the board."
    if decided < MIN_GAMES:
        short = MIN_GAMES - decided
        return f"{short} more {'game' if short == 1 else 'games'} with a result to get ranked."
    if last_added is None:
        return "Add your own ranked games in Utility so the board shows your real form."
    idle = (today - last_added).days
    if idle >= STALE_DAYS:
        return f"Nothing added for {idle} days: upload your latest games."
    return ""


def build(db: Session, viewer: User, period: str = "30") -> dict:
    days = PERIODS.get(period, 30)
    today = utcnow().date()
    since = today - timedelta(days=days) if days else None
    members = db.scalars(select(User).where(User.roster.is_(True), User.active.is_(True)).order_by(User.ign)).all()
    ids = [m.id for m in members]

    by_user: dict[int, list[dict]] = defaultdict(list)
    for a in appearances(db):
        if a.user_id in ids:
            by_user[a.user_id].append(_team_game(a))
    solo_total: dict[int, int] = defaultdict(int)
    last_added: dict[int, date] = {}
    if ids:
        for g in db.query(SoloGame).filter(SoloGame.user_id.in_(ids)).all():
            by_user[g.user_id].append(_solo_game(g))
            solo_total[g.user_id] += 1
        for uid, latest in db.query(SoloGame.user_id, func.max(SoloGame.created_at)).filter(
                SoloGame.user_id.in_(ids)).group_by(SoloGame.user_id).all():
            if latest:
                last_added[uid] = latest.date()

    week_ago = today - timedelta(days=7)
    rows = []
    for m in members:
        every = sorted(by_user.get(m.id, []), key=lambda g: g["day"] or date.min, reverse=True)
        games = [g for g in every if since is None or (g["day"] and g["day"] >= since)]
        n = numbers(games)
        rows.append({
            "user_id": m.id, "ign": m.ign or m.name, "name": m.name, "avatar": avatar_url(m.id),
            "main_role": m.main_role or "", "role": m.role,
            **n,
            "score": score(n),
            "heroes": top_heroes(games),
            "games_7d": sum(1 for g in every if g["day"] and g["day"] >= week_ago),
            "last_game": next((g["day"].isoformat() for g in every if g["day"]), None),
            "last_added": last_added[m.id].isoformat() if m.id in last_added else None,
            "solo_total": solo_total.get(m.id, 0),
            "nudge": _nudge(n, solo_total.get(m.id, 0), last_added.get(m.id), today),
        })

    ranked = sorted((r for r in rows if r["score"]), key=lambda r: (-r["score"]["value"], -r["games"], r["ign"].lower()))
    unranked = sorted((r for r in rows if not r["score"]), key=lambda r: (-r["games"], r["ign"].lower()))
    for i, r in enumerate(ranked, 1):
        r["rank"] = i
    for r in unranked:
        r["rank"] = None

    awards: dict[str, dict] = {}

    def award(key: str, label: str, pool: Iterable[dict], value, fmt) -> None:
        best = max(pool, key=value, default=None)
        if best is not None and value(best) is not None and value(best) > 0:
            awards[key] = {"user_id": best["user_id"], "ign": best["ign"], "label": label, "value": fmt(best)}

    award("win_rate", "Best win rate", ranked, lambda r: r["win_rate"], lambda r: f"{r['win_rate']}%")
    award("kda", "Best KDA", [r for r in ranked if r["kda"]], lambda r: r["kda"]["ratio"], lambda r: f"{r['kda']['ratio']}")
    award("rating", "Top rating", [r for r in ranked if r["rating"] is not None], lambda r: r["rating"], lambda r: f"{r['rating']}")
    award("grinder", "Most games", rows, lambda r: r["games"], lambda r: f"{r['games']} games")

    me = next((r for r in rows if r["user_id"] == viewer.id), None)
    return {
        "period": period if period in PERIODS else "30",
        "days": days,
        "min_games": MIN_GAMES,
        "weights": WEIGHTS,
        "rows": ranked + unranked,
        "best": ranked[0]["user_id"] if ranked else None,
        "least": ranked[-1]["user_id"] if len(ranked) >= 3 else None,
        "awards": awards,
        "needs_data": [r["user_id"] for r in rows if r["nudge"]],
        "me": None if me is None else {"user_id": me["user_id"], "rank": me["rank"], "nudge": me["nudge"],
                                        "of": len(ranked), "games_7d": me["games_7d"]},
    }


def _public_game(row: SoloGame) -> dict:
    """A teammate's game line: no notes or file names, just the game."""
    return {"id": row.id, "played_on": row.played_on.isoformat() if row.played_on else None, "mode": row.mode,
            "hero": row.hero, "lane": row.lane, "result": row.result, "kills": row.kills, "deaths": row.deaths,
            "assists": row.assists, "rating": row.rating, "mvp": bool(row.mvp), "duration_min": row.duration_min}


def utility_profile(db: Session, viewer: User, player: User, weeks: int = 12) -> dict:
    """The games a member added in Utility: totals, heroes, weekly chart and latest games."""
    games = user_games(db, player.id)
    stats = solo_stats(games)
    own = viewer.id == player.id or viewer.role in STAFF
    starts = week_starts(utcnow().date(), weeks)
    chart = person_weeks(db, player.id, starts, solo=games)
    latest = db.query(func.max(SoloGame.created_at)).filter(SoloGame.user_id == player.id).scalar()
    return {
        "user_id": player.id, "ign": player.ign or player.name, "is_self": viewer.id == player.id,
        "overall": stats["overall"], "form": stats["form"], "streak": stats["streak"], "trend": stats["trend"],
        "heroes": stats["heroes"][:12], "lanes": stats["lanes"], "modes": stats["modes"],
        # Coaching notes ("take a break…") stay between the member and staff; strengths are for everyone.
        "alerts": stats["alerts"] if own else [a for a in stats["alerts"] if a["tone"] == "good"],
        "weeks": [{"start": s.isoformat(), **w} for s, w in zip(starts, chart)],
        "recent": [_public_game(g) for g in games[:10]],
        "last_played": stats["last_played"],
        "last_added": latest.isoformat() + "Z" if latest else None,
    }
