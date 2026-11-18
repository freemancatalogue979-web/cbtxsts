"""Dashboard insights: the numbers behind the big charts.

* team    — every scrim + tournament game, week by week: record, win rate, KDA, rating
* me      — the signed-in member's own weekly progress (team games and solo games)
* heroes  — what the team plays most and how it goes
* players — staff: each roster player's weekly rating / games
* activity — staff: who uses the hub, day by day; players see only themselves
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Scrim, SoloGame, TournamentMatch, User, UserActivity, loads, utcnow
from .performance import appearances, clean_player_stats, hero_key, scrim_game_lineup

STAFF = {"admin", "captain", "coach", "analyst"}
WEEKS = 12
ACTIVITY_DAYS = 28


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def week_starts(today: date, n: int = WEEKS) -> list[date]:
    first = week_start(today) - timedelta(weeks=n - 1)
    return [first + timedelta(weeks=i) for i in range(n)]


def _pct(won: int, total: int) -> float | None:
    return round(100 * won / total, 1) if total else None


# --------------------------------------------------------------------------- #
# team games (one row per game, not per player)
# --------------------------------------------------------------------------- #
def team_games(db: Session) -> list[dict]:
    from .routers.tournaments import implied_result, match_games  # late: avoid import cycle

    out: list[dict] = []
    for s in db.scalars(select(Scrim).where(Scrim.status == "played")).all():
        for g in s.games:
            lineup, _ = scrim_game_lineup(s, g)
            out.append({"day": s.scrim_date, "source": "scrim", "result": g.result if g.result in {"WIN", "LOSS"} else "",
                        "lines": clean_player_stats(loads(g.player_stats or "{}", {})), "lineup": lineup,
                        "picks": (loads(g.draft or "{}", {}) or {}).get("our_picks") or {}})
    for m in db.scalars(select(TournamentMatch).where(TournamentMatch.status == "played")).all():
        for g in match_games(m):
            out.append({"day": m.scheduled_date, "source": "tournament", "result": implied_result(m, g),
                        "lines": clean_player_stats(g.get("player_stats")), "lineup": g["lineup"],
                        "picks": g["draft"].get("our_picks") or {}})
    return out


def _line_block(lines: Iterable[dict]) -> dict:
    lines = list(lines)
    kda_lines = [ln for ln in lines if any(k in ln for k in ("kills", "deaths", "assists"))]
    rated = [ln["rating"] for ln in lines if "rating" in ln]
    k = sum(ln.get("kills", 0) for ln in kda_lines)
    d = sum(ln.get("deaths", 0) for ln in kda_lines)
    a = sum(ln.get("assists", 0) for ln in kda_lines)
    return {"kda": round((k + a) / max(d, 1), 2) if kda_lines else None,
            "rating": round(sum(rated) / len(rated), 1) if rated else None}


def team_weeks(games: list[dict], starts: list[date]) -> list[dict]:
    buckets: dict[date, list[dict]] = defaultdict(list)
    for g in games:
        if g["day"]:
            buckets[week_start(g["day"])].append(g)
    rows = []
    for ws in starts:
        gs = buckets.get(ws, [])
        wins = sum(g["result"] == "WIN" for g in gs)
        losses = sum(g["result"] == "LOSS" for g in gs)
        rows.append({"games": len(gs), "wins": wins, "losses": losses, "win_rate": _pct(wins, wins + losses),
                     "scrim_games": sum(g["source"] == "scrim" for g in gs),
                     "tournament_games": sum(g["source"] == "tournament" for g in gs),
                     **_line_block(ln for g in gs for ln in g["lines"].values())})
    return rows


def team_heroes(games: list[dict], since: date, limit: int = 8) -> list[dict]:
    tally: dict[str, dict] = {}
    for g in games:
        if not g["day"] or g["day"] < since:
            continue
        for hero in g["picks"].values():
            if not hero:
                continue
            row = tally.setdefault(hero_key(hero), {"name": str(hero), "games": 0, "wins": 0})
            row["games"] += 1
            row["wins"] += g["result"] == "WIN"
    rows = sorted(tally.values(), key=lambda r: (-r["games"], r["name"]))[:limit]
    for r in rows:
        r["win_rate"] = _pct(r["wins"], r["games"])
    return rows


def team_streak(games: list[dict]) -> dict:
    decided = sorted((g for g in games if g["day"] and g["result"]), key=lambda g: g["day"], reverse=True)
    if not decided:
        return {"result": "", "count": 0}
    n = 1
    while n < len(decided) and decided[n]["result"] == decided[0]["result"]:
        n += 1
    return {"result": decided[0]["result"], "count": n}


# --------------------------------------------------------------------------- #
# people
# --------------------------------------------------------------------------- #
def person_weeks(db: Session, user_id: int, starts: list[date], solo: list[SoloGame] | None = None) -> list[dict]:
    """One member's weeks: team games (scrims + tournaments) and solo games side by side."""
    team: dict[date, list] = defaultdict(list)
    for a in appearances(db, user_id):
        if a.day:
            team[week_start(a.day)].append(a)
    own: dict[date, list] = defaultdict(list)
    for g in solo if solo is not None else db.query(SoloGame).filter(SoloGame.user_id == user_id).all():
        if g.played_on:
            own[week_start(g.played_on)].append(g)
    rows = []
    for ws in starts:
        apps, sg = team.get(ws, []), own.get(ws, [])
        t_w = sum(a.result == "WIN" for a in apps)
        t_d = sum(a.result in {"WIN", "LOSS"} for a in apps)
        s_w = sum(g.result == "WIN" for g in sg)
        s_d = sum(g.result in {"WIN", "LOSS"} for g in sg)
        team_lines = _line_block(a.kda for a in apps)
        solo_lines = _line_block({k: v for k, v in (("kills", g.kills), ("deaths", g.deaths), ("assists", g.assists),
                                                    ("rating", g.rating)) if v is not None} for g in sg)
        both = _line_block([*(a.kda for a in apps), *({k: v for k, v in (("kills", g.kills), ("deaths", g.deaths),
                                                                         ("assists", g.assists), ("rating", g.rating))
                                                      if v is not None} for g in sg)])
        rows.append({"team_games": len(apps), "team_win_rate": _pct(t_w, t_d), "team_rating": team_lines["rating"],
                     "solo_games": len(sg), "solo_win_rate": _pct(s_w, s_d), "solo_rating": solo_lines["rating"],
                     "games": len(apps) + len(sg), "win_rate": _pct(t_w + s_w, t_d + s_d),
                     "kda": both["kda"], "rating": both["rating"]})
    return rows


def activity(db: Session, users: list[User], today: date, days: int = ACTIVITY_DAYS) -> dict:
    first = today - timedelta(days=days - 1)
    ids = [u.id for u in users]
    rows = db.query(UserActivity).filter(UserActivity.user_id.in_(ids), UserActivity.day >= first).all() if ids else []
    by_user: dict[int, dict[date, int]] = defaultdict(dict)
    last_seen: dict[int, Any] = {}
    for r in rows:
        by_user[r.user_id][r.day] = r.hits or 0
    for uid, at in db.query(UserActivity.user_id, UserActivity.last_at).filter(UserActivity.user_id.in_(ids)).all() if ids else []:
        if at and (uid not in last_seen or at > last_seen[uid]):
            last_seen[uid] = at
    solo_counts: dict[int, int] = defaultdict(int)
    for (uid,) in db.query(SoloGame.user_id).filter(SoloGame.user_id.in_(ids), SoloGame.created_at >= first).all() if ids else []:
        solo_counts[uid] += 1
    day_list = [first + timedelta(days=i) for i in range(days)]
    people = []
    for u in users:
        hits = by_user.get(u.id, {})
        series = [hits.get(d, 0) for d in day_list]
        streak = 0
        for v in reversed(series):
            if not v:
                break
            streak += 1
        people.append({"user_id": u.id, "name": u.ign or u.name, "role": u.role, "days": series,
                       "active_days": sum(1 for v in series if v), "active_7": sum(1 for v in series[-7:] if v),
                       "streak": streak, "solo_games": solo_counts.get(u.id, 0),
                       "last_seen": last_seen[u.id].isoformat() if u.id in last_seen else None})
    people.sort(key=lambda p: (-p["active_days"], -(p["streak"]), p["name"].lower()))
    daily = [sum(1 for p in people if p["days"][i]) for i in range(days)]
    return {"days": [d.isoformat() for d in day_list], "daily_active": daily, "people": people,
            "active_today": daily[-1] if daily else 0, "active_7": sum(1 for p in people if p["active_7"]),
            "active_28": sum(1 for p in people if p["active_days"]), "members": len(people)}


# --------------------------------------------------------------------------- #
# entry point
# --------------------------------------------------------------------------- #
def insights(db: Session, user: User, weeks: int = WEEKS) -> dict:
    today = utcnow().date()
    starts = week_starts(today, weeks)
    staff = user.role in STAFF
    games = team_games(db)
    in_range = [g for g in games if g["day"] and g["day"] >= starts[0]]
    wins = sum(g["result"] == "WIN" for g in in_range)
    decided = sum(g["result"] in {"WIN", "LOSS"} for g in in_range)

    roster = db.scalars(select(User).where(User.active.is_(True), User.roster.is_(True)).order_by(User.ign)).all()
    solo_q = db.query(SoloGame).filter(SoloGame.played_on >= starts[0])
    if not staff:
        solo_q = solo_q.filter(SoloGame.user_id == user.id)
    solo_rows = solo_q.all()
    solo_weeks: dict[date, list] = defaultdict(list)
    for g in solo_rows:
        solo_weeks[week_start(g.played_on)].append(g)
    team = team_weeks(games, starts)
    for row, ws in zip(team, starts):
        sg = solo_weeks.get(ws, [])
        s_w = sum(g.result == "WIN" for g in sg)
        row["solo_games"] = len(sg)
        row["solo_win_rate"] = _pct(s_w, sum(g.result in {"WIN", "LOSS"} for g in sg))

    out: dict[str, Any] = {
        "scope": "staff" if staff else "member",
        "weeks": [ws.isoformat() for ws in starts],
        "team": team,
        "summary": {"games": len(in_range), "wins": wins, "losses": decided - wins, "win_rate": _pct(wins, decided),
                    "streak": team_streak(games), "solo_games": len(solo_rows),
                    "scrim_games": sum(g["source"] == "scrim" for g in in_range),
                    "tournament_games": sum(g["source"] == "tournament" for g in in_range),
                    **_line_block(ln for g in in_range for ln in g["lines"].values())},
        "heroes": team_heroes(games, starts[0]),
        "me": {"user_id": user.id, "name": user.ign or user.name, "weeks": person_weeks(db, user.id, starts)},
    }
    if staff:
        members = db.scalars(select(User).where(User.active.is_(True)).order_by(User.ign)).all()
        out["activity"] = activity(db, list(members), today)
        out["players"] = [{"user_id": p.id, "name": p.ign or p.name, "lane": p.main_role,
                           "weeks": person_weeks(db, p.id, starts)} for p in roster]
    else:
        out["activity"] = activity(db, [user], today)
        out["players"] = []
    return out
