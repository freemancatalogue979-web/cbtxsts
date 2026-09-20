"""Season ladder — 100 levels across 12 ranks, reset every calendar month.

A season is one calendar month. Season XP accumulates in ``season_stats`` while
you play and starts again from zero when the next month opens, so the ladder
resets for everyone at the same moment without touching a single point of
lifetime progress: the lifetime level, XP, coins, badges and mastery that the
rest of the arena keeps are all untouched. This module only reads and writes
the season column of that table.

Rank bands get wider as you climb, so the badge ladder stays exciting early
(Bronze is a couple of good evenings) and meaningful late (Celestial is a
month-long grind). The curve is public: :func:`levels_table` is what the client
draws its 10x10 level grid from, so the UI can never disagree with the server
about what a level costs.
"""
from __future__ import annotations

import calendar
from datetime import date, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import SeasonStat, Student, utcnow

# ---------------------------------------------------------------------------
# The ladder
# ---------------------------------------------------------------------------
MAX_LEVEL = 100
EPOCH_YEAR, EPOCH_MONTH = 2025, 9  # season 1 opened in September 2025

# key, label, glyph, blurb, level band, badge palette (deep -> bright)
RANKS: list[dict] = [
    {"key": "bronze", "label": "Bronze", "glyph": "medal", "from": 1, "to": 6,
     "blurb": "First steps into the arena.", "deep": "#8a4b1e", "bright": "#e8a765"},
    {"key": "silver", "label": "Silver", "glyph": "medal", "from": 7, "to": 13,
     "blurb": "You keep turning up — and it shows.", "deep": "#8b95a8", "bright": "#e6ecf7"},
    {"key": "gold", "label": "Gold", "glyph": "medal", "from": 14, "to": 21,
     "blurb": "A regular on the boards.", "deep": "#a16207", "bright": "#fcd34d"},
    {"key": "platinum", "label": "Platinum", "glyph": "shield", "from": 22, "to": 30,
     "blurb": "Consistently sharp, consistently early.", "deep": "#0e7490", "bright": "#a5f3fc"},
    {"key": "diamond", "label": "Diamond", "glyph": "gem", "from": 31, "to": 40,
     "blurb": "Cut above the rest.", "deep": "#0369a1", "bright": "#bae6fd"},
    {"key": "master", "label": "Master", "glyph": "star", "from": 41, "to": 51,
     "blurb": "You have mastered the fundamentals.", "deep": "#6d28d9", "bright": "#ddd6fe"},
    {"key": "grandmaster", "label": "Grandmaster", "glyph": "crown", "from": 52, "to": 62,
     "blurb": "Feared in every duels lobby.", "deep": "#7e22ce", "bright": "#f0abfc"},
    {"key": "elite", "label": "Elite", "glyph": "flame", "from": 63, "to": 73,
     "blurb": "Top of the class, top of the campus.", "deep": "#047857", "bright": "#a7f3d0"},
    {"key": "champion", "label": "Champion", "glyph": "trophy", "from": 74, "to": 83,
     "blurb": "Champion of the arena boards.", "deep": "#b91c1c", "bright": "#fecaca"},
    {"key": "legend", "label": "Legend", "glyph": "sparkles", "from": 84, "to": 91,
     "blurb": "Your name leads conversations.", "deep": "#b45309", "bright": "#fde68a"},
    {"key": "mythic", "label": "Mythic", "glyph": "zap", "from": 92, "to": 97,
     "blurb": "The stuff of arena stories.", "deep": "#a21caf", "bright": "#f5d0fe"},
    {"key": "celestial", "label": "Celestial", "glyph": "sun", "from": 98, "to": 100,
     "blurb": "Season perfection. Almost nobody gets here.", "deep": "#3730a3", "bright": "#c7d2fe"},
]

RANK_BY_KEY = {row["key"]: row for row in RANKS}


def xp_for_level(level: int) -> int:
    """Cumulative season XP needed to *reach* ``level``.

    Level 1 costs nothing; every level after that costs a little more than the
    one before it (level 2 costs 46, level 50 costs 16,366, level 100 costs
    62,766), which keeps the first evening rewarding and the last week of the
    month a real push.
    """
    level = max(1, min(int(level), MAX_LEVEL))
    step = level - 1
    return 6 * step * step + 40 * step


def level_from_xp(xp: int) -> int:
    xp = max(0, int(xp or 0))
    level = 1
    while level < MAX_LEVEL and xp >= xp_for_level(level + 1):
        level += 1
    return level


def level_progress(xp: int) -> dict:
    xp = max(0, int(xp or 0))
    level = level_from_xp(xp)
    floor = xp_for_level(level)
    ceiling = xp_for_level(level + 1)
    span = max(1, ceiling - floor)
    return {
        "level": level,
        "xp": xp,
        "level_floor": floor,
        "level_ceiling": ceiling,
        "into_level": xp - floor,
        "needed": max(0, ceiling - xp),
        "percent": round(min(100.0, (xp - floor) / span * 100), 1),
        "max_level": MAX_LEVEL,
    }


def rank_for_level(level: int) -> dict:
    level = max(1, min(int(level), MAX_LEVEL))
    for row in RANKS:
        if row["from"] <= level <= row["to"]:
            return row
    return RANKS[-1]


def rank_payload(row: dict, xp: int | None = None) -> dict:
    """A rank plus its XP window, so the client can draw the ladder."""
    return {
        "key": row["key"],
        "label": row["label"],
        "glyph": row["glyph"],
        "blurb": row["blurb"],
        "level_from": row["from"],
        "level_to": row["to"],
        "xp_from": xp_for_level(row["from"]),
        "xp_to": xp_for_level(row["to"] + 1),
        "deep": row["deep"],
        "bright": row["bright"],
    }


# ---------------------------------------------------------------------------
# Seasons are calendar months
# ---------------------------------------------------------------------------
def season_key(day: date | None = None) -> str:
    day = day or utcnow().date()
    return f"{day.year}-{day.month:02d}"


def season_bounds(key: str) -> tuple[date, date]:
    year, month = (int(part) for part in key.split("-"))
    start = date(year, month, 1)
    last_day = calendar.monthrange(year, month)[1]
    return start, date(year, month, last_day)


def season_number(key: str) -> int:
    year, month = (int(part) for part in key.split("-"))
    return (year - EPOCH_YEAR) * 12 + (month - EPOCH_MONTH) + 1


def previous_keys(key: str, count: int) -> list[str]:
    year, month = (int(part) for part in key.split("-"))
    keys: list[str] = []
    for _ in range(count):
        month -= 1
        if month == 0:
            month = 12
            year -= 1
        keys.append(f"{year}-{month:02d}")
    return keys


def season_payload(key: str | None = None) -> dict:
    key = key or season_key()
    start, end = season_bounds(key)
    today = utcnow().date()
    total_days = (end - start).days + 1
    days_left = max(0, (end - today).days)
    elapsed = min(total_days, max(0, (today - start).days + 1))
    return {
        "key": key,
        "number": season_number(key),
        "label": f"{calendar.month_name[start.month]} {start.year}",
        "starts_at": start.isoformat(),
        "ends_at": datetime.combine(end, datetime.min.time()).isoformat(),
        "days_total": total_days,
        "days_left": days_left,
        "days_elapsed": elapsed,
        "percent_elapsed": round(elapsed / total_days * 100, 1),
        "is_current": key == season_key(today),
    }


def ladder() -> list[dict]:
    return [rank_payload(row) for row in RANKS]


def levels_table() -> list[dict]:
    """The public XP curve for all 100 levels (level 1 is free)."""
    return [
        {
            "level": level,
            "xp": xp_for_level(level),
            "next_xp": xp_for_level(level + 1) if level < MAX_LEVEL else None,
            "rank": rank_for_level(level)["key"],
        }
        for level in range(1, MAX_LEVEL + 1)
    ]


# ---------------------------------------------------------------------------
# Stored season XP
# ---------------------------------------------------------------------------
def _row(db: Session, student: Student, key: str | None = None, create: bool = True) -> SeasonStat | None:
    key = key or season_key()
    row = db.scalar(select(SeasonStat).where(SeasonStat.student_id == student.id, SeasonStat.season_key == key))
    if row is None and create:
        row = SeasonStat(student_id=student.id, season_key=key, xp=0, coins=0)
        db.add(row)
        db.flush()
    return row


def record(db: Session, student: Student, xp: int, events: list[dict] | None = None) -> dict | None:
    """Add XP earned this month to the season counter (called from ``grant``).

    Returns a climb event when the grant pushed the player up at least one
    season level, so the client can celebrate the badge. ``None`` means "XP
    banked, nothing to shout about".
    """
    if not xp:
        return None
    row = _row(db, student)
    if row is None:
        return None
    before_xp = int(row.xp or 0)
    row.xp = before_xp + int(xp)
    after_xp = int(row.xp)
    before_level = level_from_xp(before_xp)
    after_level = level_from_xp(after_xp)
    if after_level <= before_level:
        return None

    before_rank = rank_for_level(before_level)
    after_rank = rank_for_level(after_level)
    index = RANKS.index(after_rank)
    nxt = RANKS[index + 1] if index + 1 < len(RANKS) else None
    window = season_payload()
    payload = {
        "type": "season_level",
        "season_key": window["key"],
        "label": window["label"],
        "xp": after_xp,
        "level": after_level,
        "levels_gained": after_level - before_level,
        "rank": rank_payload(after_rank),
        "promoted": before_rank["key"] != after_rank["key"],
        "previous_rank": rank_payload(before_rank),
        "next_rank": rank_payload(nxt) if nxt else None,
        "levels_to_next_rank": (after_rank["to"] - after_level + 1) if nxt else 0,
        "progress": level_progress(after_xp),
    }

    # A new rank band is a real milestone: it pays diamonds and a rare chest,
    # once per band, through the same server-side claim table as everything else.
    if payload["promoted"]:
        from .shop import promote as promote_shop

        payout = promote_shop(db, student, after_rank["key"], events)
        if payout:
            payload["payout"] = payout
    return payload


def standing(db: Session, student: Student, key: str | None = None, create: bool = True) -> dict:
    key = key or season_key()
    row = _row(db, student, key, create=create)
    xp = int(row.xp or 0) if row is not None else 0
    level = level_from_xp(xp)
    rank = rank_for_level(level)
    nxt = RANK_BY_KEY.get(RANKS[RANKS.index(rank) + 1]["key"]) if rank is not RANKS[-1] else None
    return {
        "xp": xp,
        "level": level,
        "rank": rank_payload(rank),
        "next_rank": rank_payload(nxt) if nxt else None,
        "progress": level_progress(xp),
        "rank_progress": round(
            min(100.0, max(0.0, (level - rank["from"]) / max(1, rank["to"] - rank["from"] + 1) * 100)), 1
        ),
        "board_rank": int(
            db.scalar(
                select(func.count(SeasonStat.id)).where(SeasonStat.season_key == key, SeasonStat.xp > xp)
            )
            or 0
        ) + 1,
    }


def history(db: Session, student: Student, months: int = 6) -> list[dict]:
    """Where you finished in the seasons before this one."""
    keys = previous_keys(season_key(), months)
    rows = {
        row.season_key: row
        for row in db.scalars(
            select(SeasonStat).where(SeasonStat.student_id == student.id, SeasonStat.season_key.in_(keys))
        ).all()
    }
    out: list[dict] = []
    for key in keys:
        row = rows.get(key)
        xp = int(row.xp or 0) if row else 0
        level = level_from_xp(xp) if xp else 0
        out.append(
            {
                "season": season_payload(key),
                "xp": xp,
                "level": level,
                "rank": rank_payload(rank_for_level(level)) if level else None,
            }
        )
    return out


def badge_block(db: Session, student: Student) -> dict:
    """Just enough season info to wear the badge on any screen.

    Read-only: it never writes a season row, so a profile fetch cannot create
    one on a quiet month.
    """
    key = season_key()
    me = standing(db, student, key, create=False)
    window = season_payload(key)
    return {
        "season_key": key,
        "number": window["number"],
        "label": window["label"],
        "days_left": window["days_left"],
        "days_total": window["days_total"],
        "xp": me["xp"],
        "level": me["level"],
        "rank": me["rank"],
        "next_rank": me["next_rank"],
        "progress": me["progress"],
        "board_rank": me["board_rank"],
        # How the month before this one ended — the rolling-over notice is built
        # from this, and it is also why a fresh season can say "you finished on
        # Gold" instead of "your badge reset" with no story attached.
        "previous": previous_result(db, student, key),
    }


def previous_result(db: Session, student: Student, key: str | None = None) -> dict:
    """How the player finished the season immediately before ``key``."""
    key = key or season_key()
    prev = previous_keys(key, 1)
    prev_key = prev[0] if prev else None
    if prev_key is None:
        return {"season_key": None, "label": None, "xp": 0, "level": 0, "rank": None}
    row = _row(db, student, prev_key, create=False)
    xp = int(row.xp or 0) if row is not None else 0
    level = level_from_xp(xp) if xp else 0
    return {
        "season_key": prev_key,
        "label": season_payload(prev_key)["label"],
        "xp": xp,
        "level": level,
        "rank": rank_payload(rank_for_level(level)) if level else None,
    }


def summary(db: Session, student: Student) -> dict:
    """Everything the season screen needs, in one call."""
    key = season_key()
    return {
        "generated_at": utcnow().isoformat(),
        "season": season_payload(key),
        "me": standing(db, student, key),
        "ladder": ladder(),
        "levels": levels_table(),
        "history": history(db, student),
    }
