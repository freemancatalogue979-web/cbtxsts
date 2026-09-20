"""Progression engine: XP, levels, coins, streaks, badges, grades and rankings.

Every reward flows through :func:`grant`, which returns a list of *reward
events* that the API/ websocket layer forwards to the client so the UI can play
count-ups, level-up flashes, badge unlocks and confetti.
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Activity, Attempt, Badge, Friendship, Student, StudentBadge, utcnow

# ---------------------------------------------------------------------------
# Levels
# ---------------------------------------------------------------------------
TITLES = [
    (1, "Rookie"),
    (2, "Contender"),
    (3, "Tactician"),
    (4, "Scholar"),
    (5, "Barrister"),
    (6, "Champion"),
    (7, "Grandmaster"),
    (8, "Legend"),
    (9, "Immortal"),
    (10, "Arena Deity"),
]

MAX_LEVEL = 60


def xp_for_level(level: int) -> int:
    """Cumulative XP needed to *reach* ``level`` (1 -> 0, 2 -> 250, 3 -> 750 ...)."""
    level = max(1, min(level, MAX_LEVEL + 1))
    return 125 * (level - 1) * level


def level_from_xp(xp: int) -> int:
    level = 1
    while level < MAX_LEVEL and xp >= xp_for_level(level + 1):
        level += 1
    return level


def level_progress(xp: int) -> dict[str, int | float]:
    """Progress bar data for the current level band."""
    level = level_from_xp(xp)
    floor = xp_for_level(level)
    ceiling = xp_for_level(level + 1)
    span = max(1, ceiling - floor)
    return {
        "level": level,
        "title": title_for_level(level),
        "current_xp": xp,
        "level_floor": floor,
        "level_ceiling": ceiling,
        "into_level": xp - floor,
        "needed": max(0, ceiling - xp),
        "percent": round(min(100.0, (xp - floor) / span * 100), 2),
    }


def title_for_level(level: int) -> str:
    title = TITLES[0][1]
    for threshold, name in TITLES:
        if level >= threshold:
            title = name
    return title


def tier_for_level(level: int) -> str:
    if level >= 7:
        return "platinum"
    if level >= 5:
        return "gold"
    if level >= 3:
        return "silver"
    return "bronze"


# ---------------------------------------------------------------------------
# Streaks
# ---------------------------------------------------------------------------
CODE_ALPHABET = "ACDEFGHJKLMNPQRTUVWXY3479"  # no look-alikes (0/O, 1/I, 2/Z…)


def make_player_code(db) -> str:
    """A short, shareable, collision-free friend code."""
    import random

    from sqlalchemy import select

    from .models import Student

    for _ in range(24):
        code = "".join(random.choice(CODE_ALPHABET) for _ in range(6))
        if not db.scalar(select(Student.id).where(Student.player_code == code)):
            return code
    return ""


def week_key(day: date | None = None) -> str:
    day = day or utcnow().date()
    iso = day.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def touch_streak(student: Student) -> int:
    """Advance the daily streak; returns the streak length after the touch."""
    current = utcnow().date()
    if student.last_active == current:
        student.streak = max(1, student.streak)
        return student.streak
    if student.last_active == current - timedelta(days=1):
        student.streak += 1
    elif student.streak_freezes > 0 and student.streak >= 1:
        # a purchased streak freeze absorbs the missed day(s)
        student.streak_freezes -= 1
        student.streak += 1
    else:
        student.streak = 1
    student.best_streak = max(student.best_streak, student.streak)
    student.last_active = current
    if student.week_key != week_key(current):
        student.week_key = week_key(current)
        student.weekly_xp = 0
    return student.streak


# ---------------------------------------------------------------------------
# Badges
# ---------------------------------------------------------------------------
BADGE_DEFINITIONS: list[dict] = [
    {"key": "first_blood", "name": "First Blood", "description": "Win your opening duel", "icon": "swords", "tier": "bronze", "xp_reward": 50, "coin_reward": 25},
    {"key": "duelist", "name": "Duelist", "description": "Win 5 duels", "icon": "swords", "tier": "silver", "xp_reward": 120, "coin_reward": 60},
    {"key": "arena_king", "name": "Arena Royalty", "description": "Win 25 duels", "icon": "crown", "tier": "platinum", "xp_reward": 400, "coin_reward": 250},
    {"key": "sharpshooter", "name": "Sharpshooter", "description": "Answer 10 questions correctly in a row", "icon": "target", "tier": "silver", "xp_reward": 100, "coin_reward": 50},
    {"key": "flawless", "name": "Flawless", "description": "Score 95% or higher in an exam", "icon": "sparkles", "tier": "gold", "xp_reward": 250, "coin_reward": 150},
    {"key": "marathon", "name": "Marathon Runner", "description": "Submit a full examination", "icon": "flag", "tier": "bronze", "xp_reward": 60, "coin_reward": 30},
    {"key": "scholar", "name": "Resident Scholar", "description": "Submit 5 examinations", "icon": "graduation-cap", "tier": "silver", "xp_reward": 150, "coin_reward": 80},
    {"key": "centurion", "name": "Centurion", "description": "Answer 100 questions correctly", "icon": "medal", "tier": "gold", "xp_reward": 200, "coin_reward": 120},
    {"key": "quiz_champion", "name": "Quiz Champion", "description": "Finish #1 on an exam leaderboard", "icon": "trophy", "tier": "gold", "xp_reward": 300, "coin_reward": 200},
    {"key": "streak_3", "name": "Warming Up", "description": "3-day activity streak", "icon": "flame", "tier": "bronze", "xp_reward": 40, "coin_reward": 20},
    {"key": "streak_7", "name": "On Fire", "description": "7-day activity streak", "icon": "flame", "tier": "silver", "xp_reward": 140, "coin_reward": 70},
    {"key": "streak_30", "name": "Unstoppable", "description": "30-day activity streak", "icon": "flame", "tier": "platinum", "xp_reward": 600, "coin_reward": 400},
    {"key": "level_5", "name": "Barrister", "description": "Reach level 5", "icon": "scale", "tier": "silver", "xp_reward": 0, "coin_reward": 100},
    {"key": "level_10", "name": "Legend", "description": "Reach level 10", "icon": "crown", "tier": "platinum", "xp_reward": 0, "coin_reward": 500},
    {"key": "banker", "name": "Banker", "description": "Hold 1,000 arena coins", "icon": "coins", "tier": "gold", "xp_reward": 80, "coin_reward": 0},
    {"key": "socialite", "name": "Socialite", "description": "Add your first friend on the arena", "icon": "users", "tier": "bronze", "xp_reward": 30, "coin_reward": 15},
]

BADGE_RULES = {
    "first_blood": lambda s: s.duels_won >= 1,
    "duelist": lambda s: s.duels_won >= 5,
    "arena_king": lambda s: s.duels_won >= 25,
    "sharpshooter": lambda s: s.best_run >= 10,
    "flawless": lambda s: s.best_percentage >= 95,
    "marathon": lambda s: s.exams_taken >= 1,
    "scholar": lambda s: s.exams_taken >= 5,
    "centurion": lambda s: s.correct_answers >= 100,
    "quiz_champion": lambda s: s.exams_won >= 1,
    "streak_3": lambda s: s.best_streak >= 3,
    "streak_7": lambda s: s.best_streak >= 7,
    "streak_30": lambda s: s.best_streak >= 30,
    "level_5": lambda s: level_from_xp(s.xp) >= 5,
    "level_10": lambda s: level_from_xp(s.xp) >= 10,
    "banker": lambda s: s.coins >= 1000,
    "socialite": lambda s: bool(getattr(s, "_has_friend", False)),
}


def ensure_badges(db: Session) -> None:
    """Create any missing badge rows (idempotent)."""
    existing = {row.key for row in db.scalars(select(Badge)).all()}
    for definition in BADGE_DEFINITIONS:
        if definition["key"] not in existing:
            db.add(Badge(**definition))
    db.flush()


def evaluate_badges(db: Session, student: Student, events: list[dict]) -> None:
    """Award every badge whose rule now passes; appends unlock events."""
    ensure_badges(db)
    owned = set(
        db.scalars(
            select(StudentBadge.badge_id).where(StudentBadge.student_id == student.id)
        ).all()
    )
    # Transient flag consumed by the "socialite" rule below.
    student._has_friend = (  # noqa: SLF001 - transient, never persisted
        db.scalar(select(Friendship.id).where(Friendship.student_id == student.id).limit(1)) is not None
    )
    badges = db.scalars(select(Badge)).all()
    for badge in badges:
        if badge.id in owned:
            continue
        rule = BADGE_RULES.get(badge.key)
        if not rule:
            continue
        try:
            earned = bool(rule(student))
        except Exception:  # pragma: no cover - defensive
            earned = False
        if not earned:
            continue
        db.add(StudentBadge(student_id=student.id, badge_id=badge.id))
        if badge.xp_reward:
            award_xp(db, student, badge.xp_reward, events=events)
        if badge.coin_reward:
            student.coins += badge.coin_reward
        db.add(
            Activity(
                student_id=student.id,
                kind="badge",
                title=f"Badge unlocked — {badge.name}",
                detail=badge.description,
                amount=badge.xp_reward,
            )
        )
        events.append(
            {
                "type": "badge",
                "badge": {
                    "key": badge.key,
                    "name": badge.name,
                    "description": badge.description,
                    "icon": badge.icon,
                    "tier": badge.tier,
                    "xp_reward": badge.xp_reward,
                    "coin_reward": badge.coin_reward,
                },
            }
        )


# ---------------------------------------------------------------------------
# Granting rewards
# ---------------------------------------------------------------------------
def award_xp(
    db: Session,
    student: Student,
    amount: int,
    *,
    season: bool = True,
    events: list[dict] | None = None,
) -> dict | None:
    """Credit XP to a player: lifetime, this week, and the season ladder.

    One door on purpose. Every XP path that does not go through here shows the
    player a number the season ledger never saw, and the badge drifts behind the
    XP bar — so badge payouts, the arcade, Study XP and the daily grants all land
    here. Returns the climb event when the award crossed a season level.

    Corrections are the exception: a negative staff adjustment lowers lifetime
    XP but never rewrites a season that has already been played.
    """
    amount = int(amount or 0)
    if amount <= 0:
        return None
    student.xp = (student.xp or 0) + amount
    student.weekly_xp = (student.weekly_xp or 0) + amount
    if not season:
        return None
    from .services.season import record as record_season_xp

    climb = record_season_xp(db, student, amount, events)
    if climb and events is not None:
        events.append(climb)
    return climb


def award_diamonds(
    db: Session,
    student: Student,
    amount: int,
    *,
    reason: str = "",
    events: list[dict] | None = None,
) -> dict | None:
    """**The only door diamonds come through.**

    Diamonds are the prestige currency: they are never sold, never converted
    from coins and never granted by a client. Every payout is a milestone the
    shop service has already claimed in ``student_milestones``, so nothing here
    can be repeated. Returns the reward event that was pushed, or None.
    """
    amount = int(amount or 0)
    if amount <= 0:
        return None
    student.diamonds = max(0, int(student.diamonds or 0) + amount)
    db.add(
        Activity(
            student_id=student.id,
            kind="diamond",
            title=f"+{amount} diamonds",
            detail=reason or "Milestone reached",
            amount=amount,
        )
    )
    event = {
        "type": "diamonds",
        "amount": amount,
        "label": reason or "Milestone reached",
        "total": student.diamonds,
    }
    if events is not None:
        events.append(event)
    return event


def grant(
    db: Session,
    student: Student,
    *,
    xp: int = 0,
    coins: int = 0,
    kind: str = "xp",
    title: str = "",
    detail: str = "",
    touch: bool = True,
    check_badges: bool = True,
    season: bool = True,
) -> list[dict]:
    """Apply XP/coins, handle streak + level-ups, and return UI reward events."""
    events: list[dict] = []
    before_level = level_from_xp(student.xp)

    if touch:
        streak = touch_streak(student)
        if streak > 1 and kind in {"exam", "duel", "daily"}:
            events.append({"type": "streak", "days": streak})

    if xp and student.xp_boost_until and student.xp_boost_until > utcnow():
        xp *= 2
        title = f"{title} (2× boost)" if title else "Double XP boost"
    if xp:
        # The season ladder is its own counter: it starts at zero on the first
        # day of each month and only ever records what was earned in that
        # month, so resetting it cannot touch a player's lifetime progress.
        climb = award_xp(db, student, xp, season=season, events=events)
        if climb and climb["promoted"]:
            db.add(
                Activity(
                    student_id=student.id,
                    kind="season",
                    title=f"{climb['rank']['label']} badge earned",
                    detail=f"Season level {climb['level']} in {climb['label']}.",
                    amount=climb["level"],
                )
            )
        events.append({"type": "xp", "amount": xp, "reason": title or detail})
    if coins:
        student.coins += coins
        events.append({"type": "coins", "amount": coins, "reason": title or detail})

    if title or detail or xp or coins:
        db.add(
            Activity(
                student_id=student.id,
                kind=kind,
                title=title or ("Reward" if not detail else detail[:60]),
                detail=detail,
                amount=xp or coins,
            )
        )

    after_level = level_from_xp(student.xp)
    if after_level > before_level:
        db.add(
            Activity(
                student_id=student.id,
                kind="level",
                title=f"Level {after_level} reached",
                detail=f"You are now a {title_for_level(after_level)}.",
                amount=after_level,
            )
        )
        events.append(
            {
                "type": "level_up",
                "level": after_level,
                "title": title_for_level(after_level),
                "tier": tier_for_level(after_level),
            }
        )

    if check_badges:
        evaluate_badges(db, student, events)

    # Diamonds and chests are milestone payouts: the shop service claims each one
    # exactly once, so a reward that crosses a milestone pays for it here.
    from .services.shop import sync as sync_shop_milestones  # local import (circular)

    for payout in sync_shop_milestones(db, student, events):
        events.append({"type": "milestone", **payout})

    db.flush()
    return events


# ---------------------------------------------------------------------------
# Exam scoring helpers
# ---------------------------------------------------------------------------
DEFAULT_GRADING_SCALE = [
    {"grade": "A1", "min_percent": 75, "label": "Distinction"},
    {"grade": "B2", "min_percent": 70, "label": "Excellent"},
    {"grade": "B3", "min_percent": 65, "label": "Very Good"},
    {"grade": "C4", "min_percent": 60, "label": "Good"},
    {"grade": "C5", "min_percent": 55, "label": "Credit"},
    {"grade": "D6", "min_percent": 50, "label": "Pass"},
    {"grade": "F", "min_percent": 0, "label": "Fail"},
]


def calculate_grade(percentage: float, scale: list[dict] | None = None) -> dict:
    boundaries = sorted(scale or DEFAULT_GRADING_SCALE, key=lambda row: -float(row.get("min_percent", 0)))
    for row in boundaries:
        if percentage >= float(row.get("min_percent", 0)):
            return {"grade": row.get("grade", "F"), "label": row.get("label", "")}
    return {"grade": "F", "label": "Fail"}


def rank_suffix(rank: int) -> str:
    if 11 <= rank % 100 <= 13:
        return f"{rank}th"
    return {1: f"{rank}st", 2: f"{rank}nd", 3: f"{rank}rd"}.get(rank % 10, f"{rank}th")


def ranked_attempts(db: Session, quiz_id: int) -> list[dict]:
    """Submitted attempts for one quiz, ranked (score desc, then fastest submit)."""
    attempts = db.scalars(
        select(Attempt)
        .where(Attempt.quiz_id == quiz_id, Attempt.status == "submitted")
        .order_by(Attempt.score.desc(), Attempt.percentage.desc(), Attempt.submitted_at.asc())
    ).all()
    return [{"attempt": attempt, "rank": index + 1} for index, attempt in enumerate(attempts)]


def exam_rewards(percentage: float, correct: int, total: int, rank: int | None) -> tuple[int, int]:
    """XP / coins for a submitted exam."""
    xp = correct * 12 + 40
    coins = correct * 3 + 20
    if total and percentage >= 95:
        xp += 150
        coins += 80
    elif total and percentage >= 80:
        xp += 80
        coins += 40
    if rank == 1:
        xp += 200
        coins += 120
    elif rank == 2:
        xp += 120
        coins += 70
    elif rank == 3:
        xp += 80
        coins += 45
    return xp, coins
