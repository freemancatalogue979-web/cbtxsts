"""A member's own games (ranked, classic, brawl…): cleaning, duplicate checks and the
stats behind the Learning utility — overall form, heroes, lanes, modes, the recent
trend and what to work on."""
from __future__ import annotations

import difflib
import hashlib
import re
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from .models import Hero, SoloGame, utcnow
from .performance import COLD_STREAK, LOW_KDA, LOW_RATING, MIN_GAMES, clean_line, hero_key
from .security import LANES

MODES = ("Ranked", "Classic", "Brawl", "Custom", "Arcade")
NUM_FIELDS = ("kills", "deaths", "assists", "gold", "damage", "damage_taken", "turret_damage")
RECENT = 10  # games in the "recent" side of the trend
LANE_WORDS = {"exp": "EXP", "explane": "EXP", "fighter": "EXP", "top": "EXP", "jungle": "JUNGLE", "jungler": "JUNGLE",
              "jg": "JUNGLE", "mid": "MID", "midlane": "MID", "mage": "MID", "gold": "GOLD", "goldlane": "GOLD",
              "mm": "GOLD", "marksman": "GOLD", "adc": "GOLD", "roam": "ROAM", "roamer": "ROAM", "support": "ROAM",
              "tank": "ROAM"}
WIN_WORDS = {"win", "won", "w", "victory", "v", "1", "true", "yes"}
LOSS_WORDS = {"loss", "lose", "lost", "l", "defeat", "d", "0", "false", "no"}


def to_int(value: Any) -> int | None:
    """'13,200' → 13200, '12.3k' → 12300, '7' → 7."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip().lower().replace(",", "").replace(" ", "")
    m = re.fullmatch(r"(\d+(?:\.\d+)?)(k|m)?", text)
    if not m:
        return None
    number = float(m.group(1)) * {"k": 1_000, "m": 1_000_000}.get(m.group(2) or "", 1)
    return int(round(number))


def to_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(str(value).strip().replace(",", "."))
    except ValueError:
        return None


def canon_mode(value: Any) -> str:
    text = str(value or "").strip().lower()
    for mode in MODES:
        if mode.lower() in text:
            return mode
    if "rank" in text or "mythic" in text or "legend" in text or "epic" in text:
        return "Ranked"
    return str(value or "").strip()[:30].title() if text else ""


def canon_lane(value: Any) -> str:
    text = re.sub(r"[^a-z]", "", str(value or "").lower())
    if text.upper() in LANES:
        return text.upper()
    return LANE_WORDS.get(text, "")


def canon_result(value: Any) -> str:
    if value is True:
        return "WIN"
    if value is False:
        return "LOSS"
    text = str(value or "").strip().lower()
    if text in WIN_WORDS or text.startswith("victor") or text.startswith("win"):
        return "WIN"
    if text in LOSS_WORDS or text.startswith("defeat") or text.startswith("los"):
        return "LOSS"
    return ""


def parse_date(value: Any, today: date | None = None) -> date | None:
    """ISO, 2026/10/05, 05/10/2026 (day first unless impossible), 'today', 'yesterday', '3 days ago'."""
    today = today or utcnow().date()
    if isinstance(value, datetime):
        found = value.date()
    elif isinstance(value, date):
        found = value
    else:
        text = str(value or "").strip().lower()
        if not text:
            return None
        found = None
        if text in {"today", "now", "just now"} or re.fullmatch(r"\d+\s*(?:min|mins|minutes?|h|hrs?|hours?)\s*ago", text):
            found = today
        elif text == "yesterday":
            found = today - timedelta(days=1)
        elif m := re.fullmatch(r"(\d+)\s*days?\s*ago", text):
            found = today - timedelta(days=int(m.group(1)))
        elif m := re.match(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", text):
            found = _date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        elif m := re.match(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})", text):
            a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            y += 2000 if y < 100 else 0
            found = _date(y, a, b) if b > 12 else _date(y, b, a)  # day first, unless the day is the 2nd part
        elif m := re.match(r"(\d{1,2})[-/.](\d{1,2})$", text):  # "10-05" on MLBB history = month-day
            found = _date(today.year, int(m.group(1)), int(m.group(2))) or _date(today.year, int(m.group(2)), int(m.group(1)))
            if found and found > today:
                found = _date(today.year - 1, found.month, found.day)
    if found is None or found > today + timedelta(days=1) or found.year < 2016:
        return None
    return found


def _date(y: int, m: int, d: int) -> date | None:
    try:
        return date(y, m, d)
    except ValueError:
        return None


def parse_duration(value: Any) -> float | None:
    if value is None or value == "":
        return None
    text = str(value).strip().lower()
    if m := re.fullmatch(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", text):
        if m.group(3):  # h:mm:ss
            minutes = int(m.group(1)) * 60 + int(m.group(2)) + int(m.group(3)) / 60
        else:
            minutes = int(m.group(1)) + int(m.group(2)) / 60
    else:
        number = to_float(re.sub(r"\s*(m|min|mins|minutes)$", "", text))
        if number is None:
            return None
        minutes = number
    return round(minutes, 1) if 1 <= minutes <= 90 else None


def hero_names(db: Session) -> dict[str, str]:
    return {hero_key(name): name for (name,) in db.query(Hero.name).all() if name}


def canon_hero(value: Any, heroes: dict[str, str]) -> str:
    name = str(value or "").strip()
    if not name:
        return ""
    if hero_key(name) in heroes:
        return heroes[hero_key(name)]
    close = difflib.get_close_matches(hero_key(name), list(heroes), n=1, cutoff=0.82)
    return heroes[close[0]] if close else name[:60]


def clean_game(data: dict, heroes: dict[str, str], today: date | None = None) -> dict | None:
    """One game from any source → stored fields. None when there's nothing usable."""
    if not isinstance(data, dict):
        return None
    nums = {k: to_int(data.get(k)) for k in NUM_FIELDS}
    kda = data.get("kda")
    if isinstance(kda, str) and (m := re.fullmatch(r"\s*(\d+)\s*[/\-]\s*(\d+)\s*[/\-]\s*(\d+)\s*", kda)):
        for key, part in zip(("kills", "deaths", "assists"), m.groups()):
            if nums[key] is None:
                nums[key] = int(part)
    line = clean_line({**{k: v for k, v in nums.items() if v is not None}, "rating": to_float(data.get("rating")),
                       "mvp": data.get("mvp")})
    game = {
        "played_on": parse_date(data.get("played_on") or data.get("date"), today),
        "mode": canon_mode(data.get("mode")),
        "hero": canon_hero(data.get("hero"), heroes),
        "lane": canon_lane(data.get("lane") or data.get("role")),
        "result": canon_result(data.get("result")),
        "duration_min": parse_duration(data.get("duration_min") if data.get("duration_min") is not None else data.get("duration")),
        "kills": line.get("kills"), "deaths": line.get("deaths"), "assists": line.get("assists"),
        "rating": line.get("rating"), "gold": line.get("gold"), "damage": line.get("damage"),
        "damage_taken": line.get("damage_taken"), "turret_damage": line.get("turret_damage"),
        "mvp": bool(line.get("mvp")),
        "notes": str(data.get("notes") or "").strip()[:400],
    }
    has_line = any(game[k] is not None for k in ("kills", "deaths", "assists", "rating", "gold"))
    if not (game["hero"] or game["result"]) or not (game["hero"] or has_line):
        return None
    return game


def fingerprint(game: dict) -> str:
    """Same day, hero, result and scoreboard line → the same game uploaded twice."""
    parts = [str(game.get("played_on") or ""), hero_key(game.get("hero")), game.get("result") or "",
             *(str(game.get(k) if game.get(k) is not None else "") for k in ("kills", "deaths", "assists", "gold", "rating")),
             str(game.get("duration_min") or "")]
    return hashlib.sha1("|".join(parts).encode()).hexdigest()


def game_out(row: SoloGame) -> dict:
    return {
        "id": row.id, "played_on": row.played_on.isoformat() if row.played_on else None, "mode": row.mode,
        "hero": row.hero, "lane": row.lane, "result": row.result, "duration_min": row.duration_min,
        "kills": row.kills, "deaths": row.deaths, "assists": row.assists, "rating": row.rating, "gold": row.gold,
        "damage": row.damage, "damage_taken": row.damage_taken, "turret_damage": row.turret_damage, "mvp": bool(row.mvp),
        "notes": row.notes, "source": row.source, "source_file": row.source_file, "batch": row.batch,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def user_games(db: Session, user_id: int, limit: int | None = None) -> list[SoloGame]:
    q = (db.query(SoloGame).filter(SoloGame.user_id == user_id)
         .order_by(SoloGame.played_on.is_(None), SoloGame.played_on.desc(), SoloGame.id.desc()))
    return q.limit(limit).all() if limit else q.all()


# --------------------------------------------------------------------------- #
# stats (games are newest first)
# --------------------------------------------------------------------------- #
def _pct(won: int, total: int) -> float | None:
    return round(100 * won / total, 1) if total else None


def block(games: list[SoloGame]) -> dict:
    decided = [g for g in games if g.result in {"WIN", "LOSS"}]
    wins = sum(g.result == "WIN" for g in decided)
    kda_games = [g for g in games if g.kills is not None or g.deaths is not None or g.assists is not None]
    rated = [g for g in games if g.rating is not None]
    out: dict[str, Any] = {"games": len(games), "wins": wins, "losses": len(decided) - wins,
                           "win_rate": _pct(wins, len(decided)), "kda": None, "rating": None,
                           "mvps": sum(bool(g.mvp) for g in games)}
    if kda_games:
        k = sum(g.kills or 0 for g in kda_games)
        d = sum(g.deaths or 0 for g in kda_games)
        a = sum(g.assists or 0 for g in kda_games)
        n = len(kda_games)
        out["kda"] = {"games": n, "kills": round(k / n, 1), "deaths": round(d / n, 1), "assists": round(a / n, 1),
                      "ratio": round((k + a) / max(d, 1), 2)}
    if rated:
        out["rating"] = {"games": len(rated), "avg": round(sum(g.rating for g in rated) / len(rated), 1)}
    gold = [g.gold for g in games if g.gold]
    if gold:
        out["avg_gold"] = round(sum(gold) / len(gold))
    timed = [g for g in games if g.duration_min and g.gold]
    if timed:
        out["gold_per_min"] = round(sum(g.gold for g in timed) / sum(g.duration_min for g in timed))
    return out


def _form(games: list[SoloGame], n: int = 5) -> list[str]:
    return [g.result for g in games if g.result in {"WIN", "LOSS"}][:n]


def _streak(games: list[SoloGame]) -> tuple[str, int]:
    form = [g.result for g in games if g.result in {"WIN", "LOSS"}]
    if not form:
        return "", 0
    n = 1
    while n < len(form) and form[n] == form[0]:
        n += 1
    return form[0], n


def grouped(games: list[SoloGame], key) -> list[dict]:
    groups: dict[str, list[SoloGame]] = {}
    names: dict[str, str] = {}
    for g in games:
        raw = key(g)
        if not raw:
            continue
        k = hero_key(raw)
        groups.setdefault(k, []).append(g)
        names.setdefault(k, raw)
    rows = []
    for k, gs in groups.items():
        row = {"name": names[k], **block(gs), "form": _form(gs),
               "last_played": next((g.played_on.isoformat() for g in gs if g.played_on), None)}
        result, n = _streak(gs)
        row["loss_streak"] = n if result == "LOSS" else 0
        rows.append(row)
    rows.sort(key=lambda r: (-r["games"], -(r["win_rate"] or 0), r["name"]))
    return rows


def trend(games: list[SoloGame]) -> dict | None:
    """The last 10 games against the 20 before them."""
    recent, before = games[:RECENT], games[RECENT:RECENT * 3]
    if len(recent) < 5 or len(before) < 5:
        return None
    a, b = block(recent), block(before)

    def delta(path: tuple[str, ...]) -> float | None:
        x, y = a, b
        for p in path:
            x = x.get(p) if isinstance(x, dict) else None
            y = y.get(p) if isinstance(y, dict) else None
        return round(x - y, 2) if isinstance(x, (int, float)) and isinstance(y, (int, float)) else None

    return {"recent": a, "before": b, "win_rate": delta(("win_rate",)), "kda": delta(("kda", "ratio")),
            "rating": delta(("rating", "avg")), "deaths": delta(("kda", "deaths"))}


def alerts(games: list[SoloGame], heroes: list[dict], overall: dict, tr: dict | None, limit: int = 8) -> list[dict]:
    """What to fix and what's working — strongest signals first."""
    out: list[dict] = []
    result, n = _streak(games)
    if result == "LOSS" and n >= COLD_STREAK + 1:
        out.append({"kind": "losing_streak", "tone": "bad", "title": f"{n} losses in a row",
                    "detail": "Take a break or switch to your most comfortable hero before the next ranked game."})
    if tr and tr["win_rate"] is not None and tr["win_rate"] <= -15:
        out.append({"kind": "form_drop", "tone": "bad", "title": "Form is dropping",
                    "detail": f"Win rate {tr['recent']['win_rate']}% in your last {tr['recent']['games']} games, "
                              f"{tr['before']['win_rate']}% before that."})
    if overall.get("kda") and overall["kda"]["games"] >= MIN_GAMES and overall["kda"]["deaths"] >= 6:
        out.append({"kind": "deaths", "tone": "warn", "title": f"Dying {overall['kda']['deaths']} times a game",
                    "detail": "Watch the minimap before pushing a lane and don't face-check bushes without vision."})
    for h in heroes:
        name = h["name"]
        decided = h["wins"] + h["losses"]
        if decided >= MIN_GAMES and (h["win_rate"] or 0) < 40:
            out.append({"kind": "struggling", "tone": "bad", "hero": name, "title": f"Struggling on {name}",
                        "detail": f"{h['wins']}W–{h['losses']}L ({h['win_rate']}%) in your games. "
                                  "Practise it in Classic before taking it to Ranked."})
        elif h["kda"] and h["kda"]["games"] >= MIN_GAMES and h["kda"]["ratio"] < LOW_KDA:
            out.append({"kind": "low_kda", "tone": "warn", "hero": name, "title": f"Dying a lot on {name}",
                        "detail": f"KDA {h['kda']['ratio']} ({h['kda']['kills']}/{h['kda']['deaths']}/{h['kda']['assists']} a game)."})
        elif h["rating"] and h["rating"]["games"] >= MIN_GAMES and h["rating"]["avg"] < LOW_RATING:
            out.append({"kind": "low_rating", "tone": "warn", "hero": name, "title": f"Low rating on {name}",
                        "detail": f"Average rating {h['rating']['avg']} over {h['rating']['games']} games."})
        elif h["loss_streak"] >= COLD_STREAK:
            out.append({"kind": "cold_streak", "tone": "warn", "hero": name, "title": f"Cold streak on {name}",
                        "detail": f"Lost the last {h['loss_streak']} games on it."})
    for h in heroes:
        decided = h["wins"] + h["losses"]
        if decided >= MIN_GAMES and (h["win_rate"] or 0) >= 60 and (not h["kda"] or h["kda"]["ratio"] >= 3):
            out.append({"kind": "strength", "tone": "good", "hero": h["name"], "title": f"{h['name']} is working",
                        "detail": f"{h['wins']}W–{h['losses']}L ({h['win_rate']}%)"
                                  + (f", KDA {h['kda']['ratio']}" if h["kda"] else "") + ". Keep it in your pool."})
    if tr and tr["win_rate"] is not None and tr["win_rate"] >= 15:
        out.append({"kind": "form_up", "tone": "good", "title": "Form is climbing",
                    "detail": f"Win rate {tr['recent']['win_rate']}% in your last {tr['recent']['games']} games, "
                              f"up from {tr['before']['win_rate']}%."})
    order = {"bad": 0, "warn": 1, "good": 2}
    out.sort(key=lambda a: order[a["tone"]])
    return out[:limit]


def solo_stats(games: list[SoloGame]) -> dict:
    overall = block(games)
    heroes = grouped(games, lambda g: g.hero)
    tr = trend(games)
    result, n = _streak(games)
    return {
        "overall": overall,
        "streak": {"result": result, "count": n},
        "form": _form(games, 10),
        "heroes": heroes,
        "lanes": grouped(games, lambda g: g.lane),
        "modes": grouped(games, lambda g: g.mode),
        "trend": tr,
        "alerts": alerts(games, heroes, overall, tr),
        "last_played": next((g.played_on.isoformat() for g in games if g.played_on), None),
    }


def ai_summary(games: list[SoloGame], recent: int = 12) -> dict:
    """Compact form for the AI: totals, heroes, trend, alerts and the latest games."""
    stats = solo_stats(games)
    return {
        "overall": stats["overall"], "streak": stats["streak"], "trend": stats["trend"],
        "heroes": [{k: h[k] for k in ("name", "games", "wins", "losses", "win_rate", "kda", "rating", "mvps", "form")}
                   for h in stats["heroes"][:12]],
        "lanes": [{k: h[k] for k in ("name", "games", "win_rate")} for h in stats["lanes"]],
        "modes": [{k: h[k] for k in ("name", "games", "win_rate")} for h in stats["modes"]],
        "alerts": [{k: a[k] for k in ("kind", "title", "detail") if k in a} for a in stats["alerts"]],
        "recent_games": [{k: v for k, v in game_out(g).items()
                          if k not in {"id", "source", "source_file", "batch", "created_at", "notes"} and v not in (None, "", False)}
                         for g in games[:recent]],
    }


# --------------------------------------------------------------------------- #
# heroes with no data / not being played
# --------------------------------------------------------------------------- #
NOT_PLAYING_DAYS = 21
META = ("META", "STRONG")


def hero_gaps(db: Session, user, games: list[SoloGame], limit: int = 8) -> dict:
    """Pool heroes with no games at all, pool heroes gone quiet, and strong heroes in
    the member's lane they've never played (solo or team)."""
    from .models import HeroPoolEntry
    from .performance import appearances

    today = utcnow().date()
    last: dict[str, date | None] = {}
    count: dict[str, int] = {}

    def seen(name: str, day: date | None) -> None:
        k = hero_key(name)
        if not k:
            return
        count[k] = count.get(k, 0) + 1
        if day and (last.get(k) is None or day > last[k]):
            last[k] = day
        else:
            last.setdefault(k, None)

    for g in games:
        seen(g.hero, g.played_on)
    for a in appearances(db, user.id):
        seen(a.hero, a.day)

    pool = (db.query(Hero, HeroPoolEntry.category).join(HeroPoolEntry, HeroPoolEntry.hero_id == Hero.id)
            .filter(HeroPoolEntry.user_id == user.id).all())
    in_pool = {hero_key(h.name) for h, _ in pool}
    no_data, quiet = [], []
    for hero, category in pool:
        k = hero_key(hero.name)
        if not count.get(k):
            no_data.append({"hero": hero.name, "role": hero.role, "category": category,
                            "why": f"In your {category} pool, but no games recorded on it yet."})
        elif last.get(k) and (today - last[k]).days >= NOT_PLAYING_DAYS:
            days = (today - last[k]).days
            quiet.append({"hero": hero.name, "role": hero.role, "category": category, "days": days, "games": count[k],
                          "why": f"Last played {days} days ago — {count[k]} {'game' if count[k] == 1 else 'games'} on record."})
    quiet.sort(key=lambda r: -r["days"])
    lane = (user.main_role or "").upper()
    lane_meta = []
    if lane:
        for hero in db.query(Hero).filter(Hero.role == lane, Hero.meta_status.in_(META)).all():
            k = hero_key(hero.name)
            if k in in_pool or count.get(k):
                continue
            lane_meta.append({"hero": hero.name, "role": hero.role, "status": hero.meta_status,
                              "why": f"{hero.meta_status.title()} in your lane right now — you haven't played it."})
        lane_meta.sort(key=lambda r: (META.index(r["status"]), r["hero"]))
    return {"no_data": no_data[:limit], "not_playing": quiet[:limit], "lane_meta": lane_meta[:limit]}
