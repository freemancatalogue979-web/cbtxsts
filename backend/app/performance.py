"""Player and hero performance from what the team actually played.

Every scrim game and tournament game with a lineup becomes one *appearance*
per player: who, which lane, which hero (lineup lane × our pick), the result
and — for scrims, when recorded — the player's kills / deaths / assists.

From those appearances this module builds:
* per-player summaries (all games, scrims only, tournaments only),
* per-hero rows (games, record, KDA, recent form, scrim/tournament split),
* the games played with each hero in a player's pool,
* "heroes to work on" alerts for the dashboard and player page.

A scrim game without its own lineup uses the scrim's booked lineup, so older
scrims count straight away.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Hero, HeroPoolEntry, Scrim, ScrimGame, Tournament, TournamentMatch, User, loads
from .security import LANES

# A verdict needs a few games; one bad game isn't a trend.
MIN_GAMES = 3
STRUGGLE_WIN_RATE = 45.0   # below this over MIN_GAMES+ → work on it
STRONG_WIN_RATE = 65.0     # at/above this over MIN_GAMES+ and not in the pool → add it
LOW_KDA = 2.0              # (kills + assists) / deaths below this → dying too much
COLD_STREAK = 3            # this many losses in a row on one hero
KDA_KEYS = ("kills", "deaths", "assists")
FOCUS_POOL = {"comfort", "meta"}  # pool categories a player is expected to have reps on


def hero_key(name: str | None) -> str:
    """'Yu Zhong', 'yu-zhong' and 'YU ZHONG ' are the same hero."""
    return re.sub(r"[^a-z0-9]+", "", str(name or "").lower())


def clean_lineup(lineup: dict | None) -> dict[str, int]:
    """{LANE: user_id} for known lanes only, blanks dropped, in lane order."""
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


def clean_player_stats(stats: dict | None) -> dict[str, dict[str, int]]:
    """{LANE: {kills, deaths, assists}} with whole, non-negative numbers; empty lanes dropped."""
    out: dict[str, dict[str, int]] = {}
    for lane, row in (stats or {}).items() if isinstance(stats, dict) else []:
        lane = str(lane).upper()
        if lane not in LANES or not isinstance(row, dict):
            continue
        clean: dict[str, int] = {}
        for key in KDA_KEYS:
            value = row.get(key)
            if value is None or value == "":
                continue
            try:
                number = int(float(value))
            except (TypeError, ValueError):
                continue
            clean[key] = max(0, min(number, 199))
        if clean:
            out[lane] = clean
    return {lane: out[lane] for lane in LANES if lane in out}


def scrim_game_lineup(scrim: Scrim, game: ScrimGame) -> tuple[dict[str, int], bool]:
    """(lineup, from_scrim): the game's own lineup, else the scrim's booked one."""
    own = clean_lineup(loads(getattr(game, "lineup", None) or "{}", {}))
    if own:
        return own, False
    return clean_lineup(loads(scrim.lineup or "{}", {})), True


@dataclass
class Appearance:
    source: str            # "scrim" | "tournament"
    event_id: int          # scrim id / tournament id (where the link goes)
    match_id: int          # scrim id / tournament match id
    label: str             # "Scrim #33" / "MPL Snapshot Cup"
    opponent: str
    day: date | None
    game_no: int
    lane: str
    user_id: int
    hero: str
    result: str            # WIN | LOSS | ""
    kda: dict[str, int] = field(default_factory=dict)

    def out(self) -> dict:
        return {
            "source": self.source, "event_id": self.event_id, "match_id": self.match_id,
            "label": self.label, "opponent": self.opponent,
            "date": self.day.isoformat() if self.day else None, "game_no": self.game_no,
            "lane": self.lane, "hero": self.hero, "result": self.result,
            "kills": self.kda.get("kills"), "deaths": self.kda.get("deaths"), "assists": self.kda.get("assists"),
        }


def _sort_key(a: Appearance) -> tuple:
    return (a.day or date.min, a.match_id, a.game_no)


def scrim_appearances(db: Session, user_id: int | None = None) -> list[Appearance]:
    scrims = db.scalars(select(Scrim).where(Scrim.status == "played")).all()
    out: list[Appearance] = []
    for s in scrims:
        for g in s.games:
            lineup, _ = scrim_game_lineup(s, g)
            picks = (loads(g.draft or "{}", {}) or {}).get("our_picks") or {}
            kda = clean_player_stats(loads(getattr(g, "player_stats", None) or "{}", {}))
            result = g.result if g.result in {"WIN", "LOSS"} else ""
            for lane, uid in lineup.items():
                if user_id is not None and uid != user_id:
                    continue
                out.append(Appearance("scrim", s.id, s.id, f"Scrim #{s.number}", s.opponent, s.scrim_date,
                                      g.game_no, lane, uid, str(picks.get(lane) or ""), result, kda.get(lane, {})))
    return out


def tournament_appearances(db: Session, user_id: int | None = None) -> list[Appearance]:
    from .routers.tournaments import implied_result, match_games  # late: avoid import cycle

    names = {t.id: t.name for t in db.scalars(select(Tournament)).all()}
    matches = db.scalars(select(TournamentMatch).where(TournamentMatch.status == "played")).all()
    out: list[Appearance] = []
    for m in matches:
        for g in match_games(m):
            picks = g["draft"].get("our_picks") or {}
            result = implied_result(m, g)
            for lane, uid in g["lineup"].items():
                if user_id is not None and uid != user_id:
                    continue
                out.append(Appearance("tournament", m.tournament_id, m.id, names.get(m.tournament_id, "Tournament"),
                                      m.opponent, m.scheduled_date, g["game_no"], lane, uid,
                                      str(picks.get(lane) or ""), result))
    return out


def appearances(db: Session, user_id: int | None = None) -> list[Appearance]:
    """Every scrim + tournament game a player (or everyone) played, newest first."""
    rows = scrim_appearances(db, user_id) + tournament_appearances(db, user_id)
    # Show the Hero Database spelling, whatever was typed into a draft.
    canon = {hero_key(name): name for (name,) in db.execute(select(Hero.name)).all()}
    for a in rows:
        a.hero = canon.get(hero_key(a.hero), a.hero.strip())
    rows.sort(key=_sort_key, reverse=True)
    return rows


# --------------------------------------------------------------------------- #
# aggregation
# --------------------------------------------------------------------------- #
def _pct(won: int, total: int) -> float | None:
    return round(100 * won / total, 1) if total else None


def _kda(apps: list[Appearance]) -> dict | None:
    """Average K/D/A and the (K+A)/D ratio over games where they were recorded."""
    rows = [a.kda for a in apps if a.kda]
    if not rows:
        return None
    k = sum(r.get("kills", 0) for r in rows)
    d = sum(r.get("deaths", 0) for r in rows)
    a = sum(r.get("assists", 0) for r in rows)
    n = len(rows)
    return {"games": n, "kills": round(k / n, 1), "deaths": round(d / n, 1), "assists": round(a / n, 1),
            "ratio": round((k + a) / max(d, 1), 2)}


def summary(apps: list[Appearance]) -> dict:
    wins = sum(a.result == "WIN" for a in apps)
    losses = sum(a.result == "LOSS" for a in apps)
    lanes: dict[str, int] = {}
    for a in apps:
        lanes[a.lane] = lanes.get(a.lane, 0) + 1
    return {
        "games": len(apps), "wins": wins, "losses": losses, "win_rate": _pct(wins, wins + losses),
        "series": len({(a.source, a.match_id) for a in apps}),
        "main_lane": max(lanes, key=lambda k: lanes[k]) if lanes else "", "lanes": lanes,
        "kda": _kda(apps),
        "form": [a.result for a in apps[:5]],
    }


def hero_rows(apps: list[Appearance]) -> list[dict]:
    """Per hero, newest-first input: games, record, KDA, form and where it was played."""
    groups: dict[str, list[Appearance]] = {}
    names: dict[str, str] = {}
    for a in apps:
        if not a.hero:
            continue
        key = hero_key(a.hero)
        groups.setdefault(key, []).append(a)
        names.setdefault(key, a.hero)
    rows = []
    for key, items in groups.items():
        wins = sum(a.result == "WIN" for a in items)
        losses = sum(a.result == "LOSS" for a in items)
        streak = 0
        for a in items:
            if a.result == "LOSS":
                streak += 1
            elif a.result == "WIN":
                break
        rows.append({
            "hero": names[key], "key": key, "games": len(items), "wins": wins, "losses": losses,
            "win_rate": _pct(wins, wins + losses), "decided": wins + losses,
            "scrim_games": sum(a.source == "scrim" for a in items),
            "tournament_games": sum(a.source == "tournament" for a in items),
            "kda": _kda(items), "form": [a.result for a in items[:5]], "loss_streak": streak,
            "last_played": max((a.day for a in items if a.day), default=None),
            "lanes": sorted({a.lane for a in items}, key=LANES.index),
        })
    rows.sort(key=lambda r: (-r["games"], -r["wins"], r["hero"].lower()))
    for r in rows:
        r["last_played"] = r["last_played"].isoformat() if r["last_played"] else None
    return rows


def team_stats(apps: list[Appearance], names: dict[int, str], *, series: dict, games: dict) -> dict:
    """Who played / most-picked heroes, in the same shape as tournament match stats."""
    players: dict[int, list[Appearance]] = {}
    for a in apps:
        players.setdefault(a.user_id, []).append(a)
    rows = []
    for uid, items in players.items():
        s = summary(items)
        rows.append({
            "user_id": uid, "name": names.get(uid, f"Player {uid}"), "games": s["games"], "wins": s["wins"],
            "losses": s["losses"], "win_rate": s["win_rate"], "series": s["series"], "tournaments": 0,
            "main_lane": s["main_lane"], "lanes": s["lanes"],
            "kda": s["kda"]["ratio"] if s["kda"] else None,
            "heroes": [{"hero": h["hero"], "games": h["games"], "wins": h["wins"]} for h in hero_rows(items)[:5]],
        })
    rows.sort(key=lambda r: (-r["games"], -r["wins"], r["name"].lower()))
    heroes = [{"hero": h["hero"], "games": h["games"], "wins": h["wins"], "losses": h["losses"],
               "win_rate": h["win_rate"]} for h in hero_rows(apps)[:10]]
    return {"series": series, "games": games, "players": rows, "heroes": heroes}


# --------------------------------------------------------------------------- #
# focus alerts
# --------------------------------------------------------------------------- #
def _record(h: dict) -> str:
    return f"{h['wins']}W {h['losses']}L" + (f" ({h['win_rate']:g}%)" if h["win_rate"] is not None else "")


def _where(h: dict) -> str:
    parts = []
    if h["scrim_games"]:
        parts.append(f"{h['scrim_games']} scrim")
    if h["tournament_games"]:
        parts.append(f"{h['tournament_games']} tournament")
    return " + ".join(parts) + (" game" if h["games"] == 1 else " games")


def focus_alerts(heroes: list[dict], pool: list[HeroPoolEntry], limit: int = 6) -> list[dict]:
    """Heroes to work on, most urgent first, plus heroes that earned a pool spot."""
    pool_by_key: dict[str, HeroPoolEntry] = {}
    for e in pool:
        if e.hero is not None:
            current = pool_by_key.get(hero_key(e.hero.name))
            if current is None or (e.category in FOCUS_POOL and current.category not in FOCUS_POOL):
                pool_by_key[hero_key(e.hero.name)] = e
    alerts: list[dict] = []
    flagged: set[str] = set()

    def add(kind: str, tone: str, h: dict | None, hero: str, title: str, detail: str, tip: str, score: float):
        alerts.append({"kind": kind, "tone": tone, "hero": hero, "title": title, "detail": detail, "tip": tip,
                       "games": h["games"] if h else 0, "wins": h["wins"] if h else 0,
                       "losses": h["losses"] if h else 0, "win_rate": h["win_rate"] if h else None,
                       "kda": h["kda"]["ratio"] if h and h["kda"] else None,
                       "pool": pool_by_key[hero_key(hero)].category if hero_key(hero) in pool_by_key else None,
                       "score": score})
        flagged.add(hero_key(hero))

    for h in heroes:  # 1) losing more than winning on a hero they keep playing
        if h["decided"] >= MIN_GAMES and h["win_rate"] is not None and h["win_rate"] < STRUGGLE_WIN_RATE:
            entry = pool_by_key.get(h["key"])
            tip = (f"It's in your {entry.category} pool, so it keeps getting picked: rewatch the losses and "
                   "drill the matchup in ranked before the next scrim." if entry else
                   "Drill it in ranked or customs before bringing it back to scrims.")
            kda = f" · KDA {h['kda']['ratio']:g}" if h["kda"] else ""
            add("struggling", "bad", h, h["hero"], f"Work on {h['hero']}",
                f"{_record(h)} across {_where(h)}{kda}", tip, 100 + h["losses"] * 10 - (h["win_rate"] or 0))

    for h in heroes:  # 2) dying too much even if the team wins
        k = h["kda"]
        if h["key"] in flagged or not k or k["games"] < MIN_GAMES or k["ratio"] >= LOW_KDA:
            continue
        add("low_kda", "bad", h, h["hero"], f"Dying a lot on {h['hero']}",
            f"KDA {k['ratio']:g} ({k['kills']:g}/{k['deaths']:g}/{k['assists']:g} a game) over {k['games']} scrim games",
            "Play safer around objectives and track the enemy's burst before committing.",
            80 + (LOW_KDA - k["ratio"]) * 10)

    for h in heroes:  # 3) cold streak
        if h["key"] in flagged or h["loss_streak"] < COLD_STREAK:
            continue
        add("cold_streak", "warn", h, h["hero"], f"{h['hero']}: lost the last {h['loss_streak']}",
            f"{_record(h)} overall across {_where(h)}",
            "Look at what changed in those games: matchups, build or lane pressure.", 60 + h["loss_streak"])

    by_key = {h["key"]: h for h in heroes}
    no_reps = 0
    for key, e in pool_by_key.items():  # 4) in the main pool but never played with the team
        if e.category not in FOCUS_POOL or key in by_key or no_reps >= 2:
            continue
        no_reps += 1
        add("no_reps", "warn", None, e.hero.name, f"Get reps on {e.hero.name}",
            f"In your {e.category} pool but not played in a scrim or tournament yet",
            "Ask for it in the next scrim draft so the team sees it before it matters.", 40 + e.confidence)

    for h in heroes:  # 5) working well but not in the pool
        if h["key"] in flagged or h["key"] in pool_by_key:
            continue
        if h["decided"] >= MIN_GAMES and (h["win_rate"] or 0) >= STRONG_WIN_RATE:
            add("strength", "good", h, h["hero"], f"Add {h['hero']} to your pool",
                f"{_record(h)} across {_where(h)}", "It's working: make it an official pick.",
                20 + (h["win_rate"] or 0) / 10)

    order = {"struggling": 0, "low_kda": 1, "cold_streak": 2, "no_reps": 3, "strength": 4}
    alerts.sort(key=lambda a: (order[a["kind"]], -a["score"]))
    for a in alerts:
        a.pop("score")
    return alerts[:limit]


# --------------------------------------------------------------------------- #
# entry points
# --------------------------------------------------------------------------- #
def pool_played(entry: HeroPoolEntry, heroes_by_key: dict[str, dict]) -> dict:
    """Team games played with a pool hero (scrims + tournaments)."""
    h = heroes_by_key.get(hero_key(entry.hero.name if entry.hero else ""))
    if not h:
        return {"games": 0, "wins": 0, "losses": 0, "win_rate": None, "scrim_games": 0,
                "tournament_games": 0, "kda": None, "last_played": None, "form": []}
    return {k: h[k] for k in ("games", "wins", "losses", "win_rate", "scrim_games", "tournament_games",
                              "last_played", "form")} | {"kda": h["kda"]["ratio"] if h["kda"] else None}


def player_performance(db: Session, user_id: int, pool: list[HeroPoolEntry] | None = None) -> dict:
    apps = appearances(db, user_id)
    if pool is None:
        pool = db.scalars(select(HeroPoolEntry).where(HeroPoolEntry.user_id == user_id)).all()
    heroes = hero_rows(apps)
    return {
        "overall": summary(apps),
        "scrims": summary([a for a in apps if a.source == "scrim"]),
        "tournaments": summary([a for a in apps if a.source == "tournament"]),
        "heroes": heroes[:20],
        "focus": focus_alerts(heroes, list(pool)),
        "recent": [a.out() for a in apps[:10]],
        "_heroes_by_key": {h["key"]: h for h in heroes},
    }


def squad_focus(db: Session, limit: int = 6) -> list[dict]:
    """Top alert per roster player, for staff on the dashboard."""
    players = db.scalars(select(User).where(User.roster.is_(True), User.active.is_(True))).all()
    if not players:
        return []
    ids = {p.id for p in players}
    apps_by_user: dict[int, list[Appearance]] = {}
    for a in appearances(db):
        if a.user_id in ids:
            apps_by_user.setdefault(a.user_id, []).append(a)
    pools: dict[int, list[HeroPoolEntry]] = {}
    for e in db.scalars(select(HeroPoolEntry).where(HeroPoolEntry.user_id.in_(ids))).all():
        pools.setdefault(e.user_id, []).append(e)
    out = []
    for p in players:
        alerts = [a for a in focus_alerts(hero_rows(apps_by_user.get(p.id, [])), pools.get(p.id, []))
                  if a["kind"] != "strength"]
        if alerts:
            out.append({"user_id": p.id, "name": p.ign or p.name, "alert": alerts[0], "more": len(alerts) - 1})
    rank = {"bad": 0, "warn": 1, "good": 2}
    out.sort(key=lambda r: (rank.get(r["alert"]["tone"], 3), -r["alert"]["losses"], r["name"].lower()))
    return out[:limit]
