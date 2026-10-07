"""First-boot seed: roster, heroes, training block, scrims, reviews, ban board.

Dates are computed relative to "today" so a fresh database always shows a
living dashboard (next activity countdown, upcoming events, recent results).
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import CURRENT_PATCH, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_IGN, DEFAULT_ADMIN_NAME, DEFAULT_ADMIN_PASSWORD
from .models import (
    BanEntry,
    DevelopmentEntry,
    DraftPlan,
    Event,
    Hero,
    HeroPoolEntry,
    MatchReview,
    Scrim,
    ScrimGame,
    StrategyNote,
    TeamSettings,
    TrainingActivity,
    TrainingWeek,
    User,
    dumps,
)
from .security import ROLE_ADMIN, ROLE_ANALYST, ROLE_CAPTAIN, ROLE_COACH, ROLE_PLAYER, hash_password

TODAY = date.today()


def d(days: int) -> date:
    """Today offset by ``days`` (negative = past)."""
    return TODAY + timedelta(days=days)


# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------
def seed_users(db: Session) -> dict[str, User]:
    password = hash_password(DEFAULT_ADMIN_PASSWORD)
    rows = [
        ("admin", DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_NAME, DEFAULT_ADMIN_IGN, ROLE_ADMIN, "", False),
        ("coach", "coach@9clover.gg", "Ichika Sato", "ICHIZU", ROLE_COACH, "", False),
        ("captain", "captain@9clover.gg", "Kaze Mori", "KAZE", ROLE_CAPTAIN, "ROAM", True),
        ("exp", "rinji@9clover.gg", "Rinji Ota", "RINJI", ROLE_PLAYER, "EXP", True),
        ("jungle", "sora@9clover.gg", "Sora Yin", "SORA", ROLE_PLAYER, "JUNGLE", True),
        ("mid", "mira@9clover.gg", "Mira Chen", "MIRA", ROLE_PLAYER, "MID", True),
        ("gold", "tobi@9clover.gg", "Tobi Ade", "TOBI", ROLE_PLAYER, "GOLD", True),
        ("analyst", "analyst@9clover.gg", "Nox Reyes", "NOX", ROLE_ANALYST, "", False),
        ("sub", "pip@9clover.gg", "Pip Lan", "PIP", ROLE_PLAYER, "EXP", True),
    ]
    users: dict[str, User] = {}
    for key, email, name, ign, role, lane, roster in rows:
        u = User(
            email=email,
            password_hash=password,
            name=name,
            ign=ign,
            role=role,
            main_role=lane,
            roster=roster,
            bio="9 CLOVER competitive roster." if roster else "9 CLOVER staff.",
        )
        db.add(u)
        users[key] = u
    db.flush()
    return users


# ---------------------------------------------------------------------------
# Heroes
# ---------------------------------------------------------------------------
# (name, role, class, difficulty, status, tier, win, pick, ban, clover, notes,
#  strong, weak, synergy)
HEROES: list[tuple] = [
    # EXP ------------------------------------------------------------------
    ("Arlott", "EXP", "Fighter", 7, "STRONG", "S", 52.4, 18.2, 22.5, 8,
     "Reliable engage + side-lane pressure. Core of our objective setups.",
     ["Terizla", "Phoveus", "Cici"], ["Lukas", "Chou"], ["Chip", "Angela"]),
    ("Yu Zhong", "EXP", "Fighter", 6, "META", "S", 53.1, 24.6, 30.1, 9,
     "Backline access on demand. Respect early; spike at 4.",
     ["Beatrix", "Yve", "Pharsa"], ["Khufra", "Valentina"], ["Mathilda", "Chip"]),
    ("Chou", "EXP", "Fighter", 5, "STRONG", "A", 50.8, 14.9, 8.4, 7,
     "Point-and-click lockdown; our answer to hyper carries.",
     ["Fanny", "Ling", "Wanwan"], ["Terizla", "Hylos"], ["Selena", "Angela"]),
    ("Cici", "EXP", "Marksman", 4, "VIABLE", "A", 50.2, 9.7, 3.1, 6,
     "Kites short-range fighters; weak into heavy CC chains.",
     ["Terizla", "Hylos"], ["Yu Zhong", "Nolan"], ["Khufra"]),
    ("Paquito", "EXP", "Fighter", 7, "STRONG", "S", 51.9, 16.3, 12.8, 8,
     "Champ stance trading wins most early duels. Snowball pick.",
     ["Cici", "Phoveus"], ["Chou", "Terizla"], ["Selena", "Chip"]),
    ("Lukas", "EXP", "Fighter", 4, "META", "S", 54.6, 21.4, 46.2, 9,
     "Overtuned sustain this patch. First-ban material against us.",
     ["Arlott", "Chou", "Terizla"], ["Karrie", "Valentina"], ["Angela"]),
    ("Terizla", "EXP", "Fighter", 4, "VIABLE", "B", 49.6, 7.2, 2.4, 6,
     "Zone control ult is our turtle-dance insurance.",
     ["Cici", "Melissa"], ["Karrie", "Claude"], ["Yve", "Pharsa"]),
    ("Phoveus", "EXP", "Fighter", 4, "SITUATIONAL", "B", 48.9, 3.8, 1.2, 5,
     "Counter-pick into dash-heavy comps only.",
     ["Fanny", "Ling", "Joy"], ["Lukas", "Yu Zhong"], ["Khufra"]),
    # JUNGLE ----------------------------------------------------------------
    ("Fanny", "JUNGLE", "Assassin", 10, "SITUATIONAL", "A", 48.5, 6.9, 9.6, 8,
     "Strong snowball potential. Requires high mechanical confidence.",
     ["Pharsa", "Beatrix", "Yve"], ["Khufra", "Franco", "Chou", "Lukas"], ["Angela", "Chip", "Floryn"]),
    ("Ling", "JUNGLE", "Assassin", 8, "STRONG", "A", 50.6, 11.4, 13.7, 7,
     "Wall mobility = free side-lane pressure mid game.",
     ["Pharsa", "Melissa"], ["Khufra", "Fredrinn"], ["Angela"]),
    ("Hayabusa", "JUNGLE", "Assassin", 7, "STRONG", "A", 50.9, 10.2, 7.3, 8,
     "Safe pick into most metas. Good first-pick flexibility.",
     ["Pharsa", "Yve"], ["Khufra", "Lukas"], ["Selena", "Chip"]),
    ("Nolan", "JUNGLE", "Assassin", 6, "META", "S", 52.8, 19.8, 25.4, 8,
     "Fast clear + execute. Demands level-4 tempo respect.",
     ["Karina", "Alpha"], ["Fredrinn", "Khufra"], ["Chip"]),
    ("Joy", "JUNGLE", "Assassin", 7, "STRONG", "S", 52.2, 15.1, 18.9, 8,
     "Rhythm engage wins scrappy fights. Ban into coordinated teams.",
     ["Melissa", "Beatrix"], ["Khufra", "Franco"], ["Angela", "Floryn"]),
    ("Fredrinn", "JUNGLE", "Tank", 5, "META", "S", 53.4, 17.6, 14.2, 8,
     "Front-line objective tank. Our comfort when roamer is damage.",
     ["Karina", "Alpha"], ["Karrie", "Valentina"], ["Floryn"]),
    ("Alpha", "JUNGLE", "Fighter", 4, "VIABLE", "B", 49.8, 6.1, 1.8, 6,
     "Honest front-to-back pick; falls behind tempo junglers.",
     ["Fredrinn", "Hylos"], ["Nolan", "Ling"], ["Yve"]),
    ("Karina", "JUNGLE", "Assassin", 5, "SITUATIONAL", "B", 49.1, 5.3, 2.9, 5,
     "Punishes immobile drafts; useless into tank lineups.",
     ["Beatrix", "Melissa"], ["Fredrinn", "Lukas"], ["Selena"]),
    ("Suyou", "JUNGLE", "Fighter", 6, "META", "S", 54.9, 20.7, 44.8, 9,
     "Overtuned early skirmish. Standard first ban for us.",
     ["Arlott", "Paquito"], ["Karrie", "Valentina"], ["Floryn"]),
    # MID -------------------------------------------------------------------
    ("Valentina", "MID", "Mage", 7, "META", "S", 52.9, 22.3, 27.6, 9,
     "Ult theft breaks one-ult-reliant comps. Prize pick this patch.",
     ["Pharsa", "Yve"], ["Zhuxin", "Novaria"], ["Khufra", "Chip"]),
    ("Lunox", "MID", "Mage", 6, "VIABLE", "A", 50.4, 8.8, 4.1, 6,
     "Tank melting + self-peel. Slow into poke comps.",
     ["Fredrinn", "Hylos"], ["Novaria", "Pharsa"], ["Grock"]),
    ("Yve", "MID", "Mage", 5, "STRONG", "A", 51.6, 13.9, 9.8, 7,
     "Starfield zone wins Lord dances. Immobile — hard-dive her.",
     ["Terizla", "Hylos"], ["Fanny", "Ling", "Yu Zhong"], ["Khufra"]),
    ("Pharsa", "MID", "Mage", 4, "VIABLE", "A", 50.7, 9.4, 3.6, 6,
     "Long-range poke for siege plays. Dies to flanks.",
     ["Hylos", "Terizla"], ["Ling", "Joy"], ["Franco"]),
    ("Novaria", "MID", "Mage", 5, "STRONG", "S", 51.9, 12.6, 11.2, 7,
     "Fog-snipes force bad recalls before objectives.",
     ["Yve", "Pharsa"], ["Selena", "Fanny"], ["Grock"]),
    ("Zhuxin", "MID", "Mage", 4, "META", "S", 53.8, 16.9, 31.4, 9,
     "Lantern zone control is warping drafts. Respect the pick.",
     ["Arlott", "Terizla"], ["Hayabusa", "Novaria"], ["Khufra"]),
    ("Aurora", "MID", "Mage", 3, "SITUATIONAL", "B", 49.4, 4.2, 1.9, 5,
     "Freeze combo punishes stacked fights. Niche but real.",
     ["Arlott", "Hylos"], ["Ling", "Joy"], ["Franco"]),
    ("Vexana", "MID", "Mage", 3, "WEAK", "C", 47.8, 2.1, 0.6, 3,
     "Puppet value too slow for current tempo. Skip.",
     ["Terizla"], ["Valentina", "Novaria"], ["Grock"]),
    # GOLD ------------------------------------------------------------------
    ("Claude", "GOLD", "Marksman", 6, "META", "S", 52.6, 21.8, 20.4, 8,
     "Blazing duet teamfights + split-push insurance.",
     ["Terizla", "Pharsa"], ["Hayabusa", "Nolan"], ["Diggie" , "Angela"]),
    ("Beatrix", "GOLD", "Marksman", 5, "VIABLE", "A", 50.5, 10.9, 5.2, 6,
     "Weapon-flex specialist. Needs a won lane to matter.",
     ["Bruno", "Moskov"], ["Claude", "Wanwan"], ["Angela"]),
    ("Karrie", "GOLD", "Marksman", 5, "STRONG", "A", 51.3, 12.4, 7.9, 7,
     "True damage melts tank lineups. Our anti-Lukas tech.",
     ["Hylos", "Fredrinn", "Lukas"], ["Wanwan", "Claude"], ["Floryn"]),
    ("Wanwan", "GOLD", "Marksman", 7, "STRONG", "A", 51.1, 9.6, 8.6, 7,
     "Dash-kite carry; needs CC answers pre-picked.",
     ["Karrie", "Bruno"], ["Chou", "Khufra"], ["Angela", "Floryn"]),
    ("Melissa", "GOLD", "Marksman", 4, "SITUATIONAL", "B", 49.2, 4.8, 2.3, 5,
     "Anti-dive field. Pocket into heavy engage comps.",
     ["Joy", "Ling"], ["Pharsa", "Novaria"], ["Floryn"]),
    ("Ixia", "GOLD", "Marksman", 4, "VIABLE", "B", 50.1, 6.4, 1.7, 6,
     "Teamfight sustain damage; weak lane vs poke.",
     ["Bruno", "Melissa"], ["Beatrix", "Claude"], ["Floryn"]),
    ("Bruno", "GOLD", "Marksman", 4, "WEAK", "C", 47.9, 2.4, 0.8, 4,
     "Crit spike too late for the patch tempo.",
     ["Moskov"], ["Beatrix", "Karrie"], ["Angela"]),
    ("Moskov", "GOLD", "Marksman", 6, "SITUATIONAL", "B", 48.8, 3.1, 1.1, 5,
     "Teleport chaos pick. Only with a dedicated plan.",
     ["Pharsa"], ["Claude", "Beatrix"], ["Khufra"]),
    # ROAM ------------------------------------------------------------------
    ("Chip", "ROAM", "Tank", 6, "META", "S", 53.2, 23.4, 28.7, 9,
     "Global teleports = objective numbers advantage on demand.",
     ["Hylos", "Terizla"], ["Valentina", "Novaria"], ["Claude", "Yve"]),
    ("Khufra", "ROAM", "Tank", 6, "META", "S", 52.7, 17.8, 21.3, 8,
     "Bouncing ball deletes dash heroes. Our Fanny/Ling insurance.",
     ["Fanny", "Ling", "Joy"], ["Valentina"], ["Yve", "Karrie"]),
    ("Franco", "ROAM", "Tank", 5, "VIABLE", "A", 50.3, 8.9, 6.1, 6,
     "Hook pressure warps the map. Tilt pick at its finest.",
     ["Pharsa", "Yve"], ["Aurora", "Diggie"], ["Novaria"]),
    ("Angela", "ROAM", "Support", 4, "STRONG", "A", 51.8, 12.2, 9.4, 7,
     "Attach ult turns one carry into two. Ban vs dive teams.",
     ["Beatrix", "Wanwan"], ["Selena", "Valentina"], ["Claude", "Fanny"]),
    ("Floryn", "ROAM", "Support", 3, "VIABLE", "A", 50.9, 7.5, 2.8, 6,
     "Global heal + seed scaling. Squad-sustain engine.",
     ["Claude", "Ixia"], ["Novaria", "Selena"], ["Fredrinn"]),
    ("Grock", "ROAM", "Tank", 4, "SITUATIONAL", "B", 49.7, 4.4, 1.5, 5,
     "Immunity walls enable dive comps. Map-dependent.",
     ["Pharsa", "Novaria"], ["Khufra", "Franco"], ["Yve"]),
    ("Hylos", "ROAM", "Tank", 3, "SITUATIONAL", "B", 48.6, 3.9, 1.3, 5,
     "Slow-circle fights around objectives. No engage of his own.",
     ["Cici", "Melissa"], ["Karrie", "Claude"], ["Terizla"]),
    ("Mathilda", "ROAM", "Support", 7, "VIABLE", "A", 50.6, 6.8, 4.2, 6,
     "Dash-conduit engages; high coordination cost.",
     ["Beatrix", "Melissa"], ["Khufra", "Franco"], ["Yu Zhong"]),
    ("Selena", "ROAM", "Assassin", 8, "SITUATIONAL", "A", 49.9, 5.7, 7.4, 6,
     "Abyssal arrow pickoffs. Needs vision denial practice.",
     ["Angela", "Floryn"], ["Khufra", "Nolan"], ["Chou", "Paquito"]),
]

# every pick/ban reference above resolves against the full roster below.
def seed_heroes(db: Session) -> dict[str, Hero]:
    from .hero_roster import ROSTER, TUNING

    heroes: dict[str, Hero] = {}
    for row in HEROES:
        (name, role, klass, diff, status, tier, wr, pr, br, cr, notes, strong, weak, syn) = row
        h = Hero(
            name=name, role=role, hero_class=klass, difficulty=diff, meta_status=status,
            tier=tier, patch=CURRENT_PATCH, win_rate=wr, pick_rate=pr, ban_rate=br,
            clover_rating=cr, notes=notes,
            strong_against=dumps(strong), weak_against=dumps(weak), synergy=dumps(syn),
        )
        db.add(h)
        heroes[name] = h

    # The full current roster — baseline rows for heroes without curated notes
    # yet; staff refine status/rating in-app as the meta moves.
    for name, lane, klass, diff in ROSTER:
        if name in heroes:
            continue
        status, tier, clover, notes = TUNING.get(name, ("VIABLE", "B", 5.5, ""))
        jitter = (hash(name) % 30 - 15) / 10  # stable ±1.5 so rows aren't robotic
        picks = TUNING.get(name) is not None
        h = Hero(
            name=name, role=lane, hero_class=klass, difficulty=diff,
            meta_status=status, tier=tier, patch=CURRENT_PATCH,
            win_rate=round(50.0 + jitter, 1),
            pick_rate=round((8.0 + jitter) if picks else max(4.0 + jitter, 1.0), 1),
            ban_rate=round((6.0 + jitter) if picks else max(1.5 + jitter / 2, 0.5), 1),
            clover_rating=clover, notes=notes,
            strong_against=dumps([]), weak_against=dumps([]), synergy=dumps([]),
        )
        db.add(h)
        heroes[name] = h

    # Live meta overlay — real win/pick/ban rates + tier from the MLBBDex
    # snapshot (hero_stats.py), so every hero shows current-public numbers.
    # Internal notes and ratings for tuned/curated heroes stay untouched.
    from .hero_stats import lookup, rating_from_score, TIER_TO_STATUS
    tuned = set(TUNING)
    for h in heroes.values():
        st = lookup(h.name)
        if not st:
            # Not on live rankings (upcoming release) — keep honest placeholders
            h.win_rate, h.pick_rate, h.ban_rate = 50.0, 0.3, 0.3
            continue
        _, tier, win, ban, pick, score, low = st
        h.win_rate = win
        h.pick_rate = pick
        h.ban_rate = ban
        h.tier = tier
        h.meta_status = TIER_TO_STATUS.get(tier, h.meta_status)
        if h.name not in tuned and not any(r[0] == h.name for r in HEROES):
            h.clover_rating = rating_from_score(score, low)
    db.flush()
    return heroes


def apply_live_stats(db: Session) -> tuple[int, int]:
    """Idempotent refresh for a running database (no reseed): update rates,
    tier and status from hero_stats.py for every known hero and insert any
    hero missing from the DB (new releases). Internal ratings/notes kept."""
    from .hero_stats import lookup, rating_from_score, TIER_TO_STATUS, SITE_STATS
    from .hero_roster import ROSTER, TUNING

    updated = inserted = 0
    existing = {h.name: h for h in db.query(Hero).all()}
    for h in existing.values():
        st = lookup(h.name)
        if not st:
            continue
        _, tier, win, ban, pick, _, _ = st
        if (h.win_rate, h.pick_rate, h.ban_rate, h.tier, h.meta_status) != (
            win, pick, ban, tier, TIER_TO_STATUS.get(tier, h.meta_status)):
            h.win_rate = win
            h.pick_rate = pick
            h.ban_rate = ban
            h.tier = tier
            h.meta_status = TIER_TO_STATUS.get(tier, h.meta_status)
            updated += 1
    roster_by_name = {r[0]: r for r in ROSTER}
    for slug, st in SITE_STATS.items():
        _, tier, win, ban, pick, score, low = st
        name = st[0]
        if name in existing:
            continue
        lane, klass, diff = roster_by_name.get(name, ("EXP", "Fighter", 5))[1:]
        t = TUNING.get(name)
        db.add(Hero(
            name=name, role=lane, hero_class=klass, difficulty=diff,
            meta_status=TIER_TO_STATUS.get(tier, "VIABLE"), tier=tier, patch=CURRENT_PATCH,
            win_rate=win, pick_rate=pick, ban_rate=ban,
            clover_rating=t[2] if t else rating_from_score(score, low),
            notes=t[3] if t else "",
            strong_against=dumps([]), weak_against=dumps([]), synergy=dumps([]),
        ))
        inserted += 1
    db.commit()
    return updated, inserted


def seed_pools(db: Session, users: dict[str, User], heroes: dict[str, Hero]) -> None:
    # (user key, category, hero, confidence, last_played_offset, games, wins, notes)
    rows = [
        # RINJI — EXP
        ("exp", "comfort", "Arlott", 9, -2, 41, 27, ""),
        ("exp", "comfort", "Paquito", 8, -5, 33, 20, ""),
        ("exp", "comfort", "Terizla", 7, -12, 26, 14, ""),
        ("exp", "meta", "Yu Zhong", 8, -1, 24, 14, "Confidence growing on backline dives."),
        ("exp", "meta", "Lukas", 6, -3, 11, 5, "Wobbly on sustain timings — coach block booked."),
        ("exp", "meta", "Cici", 7, -6, 18, 10, ""),
        ("exp", "pocket", "Phoveus", 8, -30, 14, 9, "Dash-comp counter tech."),
        ("exp", "pocket", "Chou", 7, -9, 29, 16, ""),
        ("exp", "emergency", "Terizla", 8, -4, 26, 14, ""),
        ("exp", "emergency", "Arlott", 9, -2, 41, 27, ""),
        # SORA — JUNGLE
        ("jungle", "comfort", "Hayabusa", 9, -1, 52, 33, ""),
        ("jungle", "comfort", "Nolan", 8, -2, 38, 23, ""),
        ("jungle", "comfort", "Fredrinn", 8, -7, 30, 18, ""),
        ("jungle", "meta", "Joy", 7, -4, 21, 12, "Ulting early — drill booked with ICHIZU."),
        ("jungle", "meta", "Ling", 7, -11, 26, 13, ""),
        ("jungle", "meta", "Alpha", 6, -20, 15, 8, ""),
        ("jungle", "pocket", "Fanny", 9, -15, 47, 29, "Signature. Only when comp allows."),
        ("jungle", "pocket", "Karina", 6, -40, 12, 6, ""),
        ("jungle", "emergency", "Hayabusa", 9, -1, 52, 33, ""),
        ("jungle", "emergency", "Nolan", 8, -2, 38, 23, ""),
        # MIRA — MID
        ("mid", "comfort", "Valentina", 9, -1, 44, 28, ""),
        ("mid", "comfort", "Yve", 8, -3, 36, 21, ""),
        ("mid", "comfort", "Pharsa", 8, -8, 31, 17, ""),
        ("mid", "meta", "Zhuxin", 7, -2, 16, 9, "New meta pick — 20 ranked games this week."),
        ("mid", "meta", "Novaria", 8, -5, 22, 12, ""),
        ("mid", "meta", "Lunox", 6, -16, 14, 7, ""),
        ("mid", "pocket", "Aurora", 7, -25, 12, 7, "Freeze-flank tech vs dive."),
        ("mid", "pocket", "Vexana", 5, -60, 8, 4, ""),
        ("mid", "emergency", "Valentina", 9, -1, 44, 28, ""),
        ("mid", "emergency", "Pharsa", 8, -8, 31, 17, ""),
        # TOBI — GOLD
        ("gold", "comfort", "Claude", 9, -1, 49, 31, ""),
        ("gold", "comfort", "Karrie", 8, -2, 35, 21, ""),
        ("gold", "comfort", "Beatrix", 8, -6, 30, 17, ""),
        ("gold", "meta", "Wanwan", 7, -3, 19, 10, "Needs CC-answer draft around her."),
        ("gold", "meta", "Ixia", 6, -9, 13, 6, ""),
        ("gold", "meta", "Melissa", 7, -7, 15, 8, ""),
        ("gold", "pocket", "Moskov", 7, -35, 11, 6, "Teleport chaos specialty."),
        ("gold", "pocket", "Bruno", 6, -21, 9, 4, ""),
        ("gold", "emergency", "Claude", 9, -1, 49, 31, ""),
        ("gold", "emergency", "Karrie", 8, -2, 35, 21, ""),
        # KAZE — ROAM (captain)
        ("captain", "comfort", "Khufra", 9, -1, 46, 29, ""),
        ("captain", "comfort", "Franco", 8, -4, 34, 19, ""),
        ("captain", "comfort", "Floryn", 8, -6, 28, 16, ""),
        ("captain", "meta", "Chip", 9, -2, 25, 16, "Teleport timings reviewed."),
        ("captain", "meta", "Angela", 7, -5, 22, 12, ""),
        ("captain", "meta", "Mathilda", 6, -13, 12, 6, ""),
        ("captain", "pocket", "Selena", 8, -10, 21, 12, "Pickoff comps with Nox's vision maps."),
        ("captain", "pocket", "Grock", 6, -18, 10, 5, ""),
        ("captain", "emergency", "Khufra", 9, -1, 46, 29, ""),
        ("captain", "emergency", "Franco", 8, -4, 34, 19, ""),
        # PIP — substitute
        ("sub", "comfort", "Chou", 7, -14, 18, 9, ""),
        ("sub", "comfort", "Claude", 6, -20, 9, 4, ""),
        ("sub", "meta", "Arlott", 6, -9, 12, 6, ""),
        ("sub", "pocket", "Phoveus", 6, -30, 7, 3, ""),
        ("sub", "emergency", "Chou", 7, -14, 18, 9, ""),
    ]
    for key, cat, hero_name, conf, last_off, games, wins, notes in rows:
        db.add(
            HeroPoolEntry(
                user_id=users[key].id,
                hero_id=heroes[hero_name].id,
                category=cat,
                confidence=conf,
                last_played=d(last_off),
                games=games,
                wins=wins,
                losses=max(games - wins, 0),
                coach_notes=notes,
            )
        )
    db.flush()


# ---------------------------------------------------------------------------
# Training block
# ---------------------------------------------------------------------------
def seed_training(db: Session, users: dict[str, User]) -> dict[str, TrainingWeek]:
    """Five-week block. Week 4 (OBJECTIVE CONTROL) is the active one at 80%."""
    monday_this = TODAY - timedelta(days=TODAY.weekday())  # Monday of current week
    wk = lambda n: monday_this + timedelta(weeks=n - 4)    # week n's Monday

    weeks = {
        1: ("EARLY GAME", "Win the first 5 minutes: invade reads, lane priority, first-blood setups.",
            "Reach +500 gold @5 in 60% of scrim games.", "completed", -35),
        2: ("MID-GAME ROTATIONS", "Convert lane wins into map movement: 1-3-1 defaults, roam timers.",
            "Zero unanswered cross-map plays in review clips.", "completed", -28),
        3: ("TEAM FIGHTS", "Front-to-back discipline, engage cues, cooldown tracking.",
            "Win ≥55% of full 5v5 fights in scrims.", "completed", -21),
        4: ("OBJECTIVE CONTROL", "Own Turtle and Lord: setup positions, trade rules, contest calls.",
            "First turtle in 70% of games this week.", "active", -14),
        5: ("LATE GAME", "Lord dance patience, base-race rules, comeback discipline.",
            "Close 80% of games with a 10k lead. Throw zero.", "planned", -7),
    }
    week_rows: dict[int, TrainingWeek] = {}
    for n, (focus, objective, target, status, _off) in weeks.items():
        start = wk(n)
        w = TrainingWeek(
            number=n, focus=focus, objective=objective, performance_target=target, status=status,
            start_date=start, end_date=start + timedelta(days=6),
            notes="Weekly block set by coaching staff.",
            weakness_text="Late-game decision making" if n == 4 else "",
            weakness_drills_target=4 if n == 4 else 0,
        )
        db.add(w)
        week_rows[n] = w
    db.flush()

    everyone = [users[k].id for k in ("exp", "jungle", "mid", "gold", "captain")]
    core3 = [users["jungle"].id, users["mid"].id, users["captain"].id]
    coach = "ICHIZU"

    def act(week: int, day_off: int, time_: str, title: str, cat: str, status: str,
            minutes: int = 90, desc: str = "", players: list[int] | None = None,
            required: bool = True, result: str = "", lessons: str = "") -> None:
        db.add(
            TrainingActivity(
                week_id=week_rows[week].id,
                title=title,
                description=desc,
                category=cat,
                activity_date=wk(week) + timedelta(days=day_off),
                start_time=time_,
                duration_min=minutes,
                coach_name=coach,
                assigned_player_ids=dumps(players if players is not None else everyone),
                required=required,
                status=status,
                result=result,
                lessons=lessons,
            )
        )

    # Week 4 — ten sessions, eight done = 80%.
    act(4, 0, "21:30", "Turtle setup walkthrough — zones & ward lines", "OBJECTIVE DRILL", "done", 75,
        "Walk the 8 standard turtle setups on stream sketchboard. KAZE calls, squad mirrors.",
        result="All five setups executed clean by run 3.",
        lessons="JUNGLE must stand on river brush at :25 spawn, not pit.")
    act(4, 0, "23:00", "Replay review: our turtle losses (Weeks 1-3)", "MATCH REVIEW", "done", 60,
        "Nox cuts 6 lost-turtle sequences; squad calls the mistake before the reveal.",
        lessons="4 of 6 losses started with mid lane priority ignored.")
    act(4, 1, "21:00", "Objective trading macro class", "MACRO", "done", 90,
        "When to trade turtle for turret gold; gold-per-objective sheet from analyst.",
        lessons="Trading turtle for two outer turrets is +EV from behind only.")
    act(4, 1, "22:45", "Jungle + mid objective sync drill", "ROLE DRILL", "done", 60,
        "SORA/MIRA 30 reps: smite windows behind Yve/Novaria zone.",
        players=core3, lessons="Smite call must come from KAZE, not SORA — confusion at rep 12.")
    act(4, 2, "21:00", "Communication: contest-call laddering", "COMMUNICATION", "done", 45,
        "Call laddering: scout → posture → commit/abandon. Three-word rule enforced.",
        result="Average call latency 4.1s → 2.3s.",
        lessons="'Go go go' is banned; use 'commit'/'bail' only.")
    act(4, 2, "22:30", "Lord dance scenarios 12-18 min", "SCENARIO", "done", 90,
        "Five scripted spots: ahead 3k, even, behind 2k, 4v5, retake.",
        lessons="We flip Lord 2/5 times from behind — patience rule added to playbook.")
    act(4, 3, "21:00", "Draft lab: objective-first compositions", "DRAFT", "done", 75,
        "Build 3 comps that secure river control by 1:40. Test vs Nox's counters.",
        lessons="Yve + Khufra + Fredrinn core is our safest objective shell.")
    act(4, 3, "23:00", "Micro block: retribution mind-games", "MICRO", "done", 45,
        "SORA + PIP 1v1 pit duels; feint pull-outs and HP-check discipline.",
        players=[users["jungle"].id, users["sub"].id])
    # Spillover sessions (dates run past the week's Sunday — normal when scrims stack).
    act(4, 9, "22:00", "Custom: turtle-to-tower conversion", "TEAM FIGHT", "scheduled", 90,
        "Secure turtle then force structure inside buff window. Film for review.")
    act(4, 10, "20:30", "Week 4 VOD review circle", "MATCH REVIEW", "scheduled", 90,
        "Squad watches week tape; everyone submits one clip + one lesson.")

    # A flavour of scheduled week 5.
    act(5, 3, "22:00", "Scrim + late-game close-out drill", "SCRIM", "scheduled", 120,
        "Scrim block with post-game close-out checklist review.")
    act(5, 4, "21:00", "Base-race decision tree class", "MACRO", "scheduled", 60,
        "When to trade base for Lord; minion-wave state reading.")

    # One important dated block that is also the dashboard's NEXT ACTIVITY:
    next_tue = TODAY + timedelta(days=(1 - TODAY.weekday()) % 7 or 7)
    db.add(
        TrainingActivity(
            week_id=week_rows[5].id,
            title="Scrim + Objective Drill",
            description="BO3 scrim with objective-control checklist enforced — turtle setups, "
                        "trade calls, contest discipline. Live graded on the Week 4 sheet.",
            category="SCRIM",
            activity_date=next_tue,
            start_time="22:00",
            duration_min=150,
            coach_name=coach,
            assigned_player_ids=dumps(everyone),
            required=True,
            status="scheduled",
        )
    )
    db.flush()
    return {"w4": week_rows[4], "w5": week_rows[5]}


# ---------------------------------------------------------------------------
# Scrims + games + reviews
# ---------------------------------------------------------------------------
def _stats(kills, deaths, gold, turrets, turtles, lords, tf_won, tf_total,
           gd10, k10, d10, e_kills, e_deaths, e_gold, e_turrets, e_turtles, e_lords) -> str:
    return dumps({
        "kills": kills, "deaths": deaths, "gold": gold, "turrets": turrets,
        "turtles": turtles, "lords": lords,
        "teamfights_won": tf_won, "teamfights_total": tf_total,
        "gold_diff_10": gd10, "kills_10": k10, "deaths_10": d10,
        "enemy_kills": e_kills, "enemy_deaths": e_deaths, "enemy_gold": e_gold,
        "enemy_turrets": e_turrets, "enemy_turtles": e_turtles, "enemy_lords": e_lords,
    })


def _draft(our_bans, enemy_bans, our_picks, enemy_picks) -> str:
    return dumps({"our_bans": our_bans, "enemy_bans": enemy_bans,
                  "our_picks": our_picks, "enemy_picks": enemy_picks})


STD_BANS_OURS = ["Suyou", "Lukas", "Zhuxin", "Chip", "Fredrinn"]
STD_BANS_THEIRS = ["Fanny", "Nolan", "Joy", "Angela", "Valentina"]
OUR_A = {"EXP": "Arlott", "JUNGLE": "Hayabusa", "MID": "Yve", "GOLD": "Karrie", "ROAM": "Khufra"}
OUR_B = {"EXP": "Paquito", "JUNGLE": "Nolan", "MID": "Valentina", "GOLD": "Claude", "ROAM": "Chip"}
OUR_C = {"EXP": "Cici", "JUNGLE": "Fredrinn", "MID": "Novaria", "GOLD": "Wanwan", "ROAM": "Floryn"}
ENEMY_A = {"EXP": "Yu Zhong", "JUNGLE": "Ling", "MID": "Valentina", "GOLD": "Claude", "ROAM": "Chip"}
ENEMY_B = {"EXP": "Lukas", "JUNGLE": "Joy", "MID": "Zhuxin", "GOLD": "Wanwan", "ROAM": "Khufra"}
ENEMY_C = {"EXP": "Chou", "JUNGLE": "Suyou", "MID": "Pharsa", "GOLD": "Beatrix", "ROAM": "Angela"}


def seed_scrims(db: Session, users: dict[str, User]) -> dict[str, Scrim]:
    lineup = dumps({"EXP": users["exp"].id, "JUNGLE": users["jungle"].id, "MID": users["mid"].id,
                    "GOLD": users["gold"].id, "ROAM": users["captain"].id})
    lineup_ids = dumps([users["exp"].id, users["jungle"].id, users["mid"].id,
                        users["gold"].id, users["captain"].id])
    subs = dumps([users["sub"].id])

    def scrim(number: int, opponent: str, day_off: int, time_: str, fmt: str,
              games: list[tuple], *, prep: bool = False, notes: str = "",
              strategy: str = "", status: str = "played") -> Scrim:
        us = sum(1 for g in games if g[0] == "W")
        them = sum(1 for g in games if g[0] == "L")
        s = Scrim(
            number=number, opponent=opponent, scrim_date=d(day_off), start_time=time_, format=fmt,
            server="Custom lobby", tournament_prep=prep, lineup=lineup,
            substitutes=subs if number % 2 else "[]", notes=notes, expected_strategy=strategy,
            status=status, result=("WIN" if us > them else "LOSS") if games else "",
            score_us=us, score_them=them, created_by=users["captain"].id,
        )
        db.add(s)
        db.flush()
        for i, g in enumerate(games, start=1):
            res, dur, stats, draft = g
            db.add(ScrimGame(scrim_id=s.id, game_no=i, result="WIN" if res == "W" else "LOSS",
                             duration_min=dur, stats=stats, draft=draft))
        return s

    # --- Scrim #023: the plan's fully-reviewed example -----------------------
    s23 = scrim(23, "Team X", -25, "22:00", "BO5", [
        ("L", 17.5, _stats(9, 14, 41200, 3, 1, 0, 2, 5, -1100, 3, 5, 14, 9, 46800, 7, 0, 1),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_A, ENEMY_A)),
        ("W", 14.2, _stats(13, 7, 38900, 6, 1, 0, 3, 4, 900, 5, 2, 7, 13, 35100, 2, 0, 0),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_B, ENEMY_B)),
        ("W", 16.8, _stats(11, 9, 42100, 5, 2, 1, 3, 5, 1400, 4, 3, 9, 11, 39800, 3, 1, 0),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_C, ENEMY_C)),
        ("L", 19.3, _stats(8, 15, 43400, 2, 0, 0, 1, 6, -1800, 2, 6, 15, 8, 49200, 8, 1, 1),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_A, ENEMY_B)),
        ("L", 22.6, _stats(10, 16, 51700, 3, 1, 0, 2, 6, -600, 3, 4, 16, 10, 58900, 8, 2, 2),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_B, ENEMY_A)),
    ], prep=False, notes="First BO5 endurance test of the split.",
       strategy="Test objective shell (Yve + Khufra) into their dive core.")

    db.add(MatchReview(
        scrim_id=s23.id, opponent="Team X", review_date=d(-24), duration_min=19.1, result="LOSS",
        player_ids=lineup_ids, mandatory=True,
        stats=dumps({"series": "2 - 3", "kills": 51, "deaths": 61, "turrets": 19,
                     "turtles": 5, "lords": 1, "gold_share": 46.8}),
        draft=_draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_A, ENEMY_A),
        biggest_mistakes=dumps([
            "Game 5: flipped Lord at 19:40 while down 4k — no vision, no smite backup.",
            "Game 4: mid lane recalled on turtle spawn timer, pit gifted for free.",
            "Game 1: draft gave away Valentina open; her stolen Khufra ult won two fights.",
        ]),
        why_happened="Late-game calls made on tilt after losing game 4. Shot-caller and jungler "
                     "gave conflicting smite windows; nobody owned the final call.",
        should_have_done="Dance the Lord, zone with Yve starfield, force THEM to face-check "
                         "Khufra. If contested, trade for inhibitor turret — never coin-flip.",
        who_involved="SORA (smite timing), KAZE (commit call), MIRA (Game 4 recall timing).",
        what_change="New rule: from 12:00, only KAZE calls contest vs trade — drafted into "
                    "playbook section 4. Valentina banned on side-select games vs Team X.",
        lesson="A 50/50 Lord is a 100% decision error when we are behind. Discipline beats heroics.",
        action_item="Lord-dance rep block: 20 contested scenarios, smite-call laddering on comms.",
        action_assignee_id=users["jungle"].id, action_deadline=d(-18),
        status="resolved", created_by=users["coach"].id,
    ))

    # --- History --------------------------------------------------------------
    scrim(8, "Team X", -47, "21:30", "BO3", [
        ("W", 15.4, _stats(12, 8, 37400, 6, 1, 0, 3, 5, 800, 4, 3, 8, 12, 33900, 3, 0, 0),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_A, ENEMY_A)),
        ("L", 18.1, _stats(7, 12, 40200, 2, 1, 0, 1, 4, -1300, 2, 4, 12, 7, 44100, 6, 1, 1),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_B, ENEMY_B)),
        ("W", 13.9, _stats(14, 6, 36800, 7, 1, 1, 4, 4, 1600, 6, 2, 6, 14, 32700, 2, 0, 0),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_C, ENEMY_C)),
    ], notes="Season opener set.")
    scrim(11, "Team X", -40, "22:00", "BO3", [
        ("W", 16.0, _stats(11, 9, 39100, 5, 1, 1, 3, 5, 400, 3, 3, 9, 11, 36500, 4, 1, 0),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_B, ENEMY_A)),
        ("W", 15.2, _stats(13, 10, 38600, 6, 2, 0, 3, 6, 1100, 5, 3, 10, 13, 35200, 3, 1, 0),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_A, ENEMY_C)),
    ])
    s14 = scrim(14, "Blackhawk", -33, "21:00", "BO3", [
        ("L", 17.7, _stats(6, 14, 39900, 2, 0, 0, 1, 5, -2100, 1, 5, 14, 6, 45800, 7, 1, 1),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_C, ENEMY_B)),
        ("L", 14.8, _stats(5, 13, 35100, 1, 1, 0, 1, 4, -1900, 2, 5, 13, 5, 40200, 6, 1, 0),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_A, ENEMY_A)),
    ], notes="Exposed our early invade answers.")
    db.add(MatchReview(
        scrim_id=s14.id, opponent="Blackhawk", review_date=d(-32), duration_min=16.2, result="LOSS",
        player_ids=lineup_ids, mandatory=True,
        stats=dumps({"series": "0 - 2", "kills": 11, "deaths": 27}),
        draft=_draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_A, ENEMY_B),
        biggest_mistakes=dumps([
            "No answer to level-1 invade both games — late cover from EXP side.",
            "Roam camped gold lane while jungle got doubled on first buff.",
        ]),
        why_happened="We scouted their opener on tape and still queued into it unprepared.",
        should_have_done="Vertical jungling answer: EXP collapses level 1, roam shadow camps.",
        who_involved="RINJI (late collapse), KAZE (pathing call).",
        what_change="Added level-1 invade answer sheet to playbook; PIP runs the drill weekly.",
        lesson="Tape you don't act on is decoration.",
        action_item="Level-1 invade answer drill every Monday for 3 weeks.",
        action_assignee_id=users["exp"].id, action_deadline=d(-25),
        status="resolved", created_by=users["coach"].id,
    ))
    scrim(17, "Nova Kings", -26, "20:30", "BO3", [
        ("W", 13.1, _stats(15, 6, 36100, 7, 1, 0, 4, 5, 1800, 7, 1, 6, 15, 31500, 2, 0, 0),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_B, ENEMY_C)),
        ("W", 16.4, _stats(12, 8, 39400, 6, 2, 1, 3, 4, 1200, 4, 2, 8, 12, 35800, 3, 1, 0),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_A, ENEMY_B)),
    ])
    scrim(19, "Iron Lotus", -19, "22:30", "BO3", [
        ("W", 17.9, _stats(10, 9, 41600, 5, 1, 1, 2, 5, 500, 3, 4, 9, 10, 38100, 4, 1, 0),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_C, ENEMY_A)),
        ("L", 20.3, _stats(9, 13, 46200, 3, 1, 0, 2, 6, -900, 3, 5, 13, 9, 49700, 6, 1, 1),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_B, ENEMY_B)),
        ("W", 15.6, _stats(14, 7, 38200, 6, 1, 0, 3, 4, 1300, 5, 2, 7, 14, 34600, 2, 0, 0),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_A, ENEMY_C)),
    ])
    scrim(26, "Zenith 5", -12, "21:00", "BO3", [
        ("W", 14.6, _stats(13, 8, 37900, 6, 1, 0, 3, 5, 900, 4, 3, 8, 13, 34100, 3, 0, 0),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_A, ENEMY_C)),
        ("W", 18.8, _stats(11, 10, 43900, 5, 2, 1, 3, 6, 700, 3, 4, 10, 11, 40200, 4, 1, 0),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_B, ENEMY_B)),
    ])
    # The plan's recent results: 1-2 Team X (LOSS, review OPEN), 2-0 Team Y (WIN).
    s29 = scrim(29, "Team X", -6, "22:00", "BO3", [
        ("L", 16.9, _stats(8, 12, 39600, 3, 0, 0, 2, 5, -900, 2, 4, 12, 8, 42800, 6, 1, 1),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_A, ENEMY_B)),
        ("W", 15.1, _stats(13, 9, 38800, 6, 1, 0, 3, 4, 1000, 5, 3, 9, 13, 34900, 2, 0, 0),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_C, ENEMY_C)),
        ("L", 21.4, _stats(9, 15, 49600, 3, 1, 0, 2, 6, -1400, 3, 5, 15, 9, 55600, 7, 2, 2),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_B, ENEMY_A)),
    ], prep=True, notes="Tournament prep set — they run the same pool as our group opponent.",
       strategy="Test anti-dive shell before ADM Clash groups.")
    db.add(MatchReview(
        scrim_id=s29.id, opponent="Team X", review_date=d(-5), duration_min=17.8, result="LOSS",
        player_ids=lineup_ids, mandatory=True,
        stats=dumps({"series": "1 - 2", "kills": 30, "deaths": 36}),
        draft=_draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_A, ENEMY_B),
        biggest_mistakes=dumps([
            "Game 3: contested second Lord without mid wave pushed.",
            "Game 3: no tracking of enemy Khufra flash — two lost carries to ball + flicker.",
        ]),
        why_happened="Wave-state discipline broke once the series went long.",
        should_have_done="Fix mid wave at 10:55 before any Lord posture; KAZE owns the check.",
        who_involved="MIRA (wave), KAZE (posture call).",
        what_change="Wave-first checklist added to late-game playbook.",
        lesson="Lord is a wave-state minigame before it is a smite minigame.",
        action_item="Clip review of both fights + wave drill Thursday block.",
        action_assignee_id=users["mid"].id, action_deadline=d(3),
        status="in_progress", created_by=users["analyst"].id,
    ))
    scrim(30, "Team Y", -4, "22:00", "BO3", [
        ("W", 13.5, _stats(16, 5, 35900, 8, 1, 0, 4, 4, 2100, 8, 1, 5, 16, 30900, 2, 0, 0),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_A, ENEMY_C)),
        ("W", 14.9, _stats(14, 6, 37100, 7, 2, 0, 4, 5, 1700, 6, 2, 6, 14, 32800, 3, 1, 0),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_B, ENEMY_C)),
    ], notes="Clean set — objective checklist pilot game. Zero unforced contests.")
    scrim(31, "Zenith 5", -2, "22:00", "BO3", [
        ("W", 15.7, _stats(12, 9, 39100, 6, 1, 1, 2, 4, 600, 4, 3, 9, 12, 36100, 3, 1, 0),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_C, ENEMY_A)),
        ("L", 19.9, _stats(8, 14, 45100, 3, 1, 0, 1, 5, -1600, 2, 6, 14, 8, 50100, 6, 1, 1),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_A, ENEMY_B)),
        ("L", 23.2, _stats(10, 17, 53800, 4, 0, 0, 2, 7, -2200, 3, 7, 17, 10, 61200, 8, 2, 2),
         _draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_B, ENEMY_B)),
    ], prep=False, notes="Late-game collapse again — review MANDATORY before next booking.")
    # ^ deliberately left without a review: drives the "NO REVIEW, NO NEXT SCRIM" banner.

    # Upcoming bookings
    upcoming = Scrim(
        number=32, opponent="Nova Kings", scrim_date=d(2), start_time="22:00", format="BO3",
        server="Custom lobby", tournament_prep=True, lineup=lineup, substitutes=subs,
        notes="Final prep before ADM Clash group stage.",
        expected_strategy="Run the Week 4 objective shell; grade every turtle with the checklist.",
        status="scheduled", created_by=users["captain"].id,
    )
    db.add(upcoming)
    next_tue = TODAY + timedelta(days=(1 - TODAY.weekday()) % 7 or 7)
    db.add(Scrim(
        number=33, opponent="Team X", scrim_date=next_tue, start_time="22:00", format="BO3",
        server="Custom lobby", tournament_prep=False, lineup=lineup,
        notes="Rematch — apply the Scrim #029 wave-first changes.",
        expected_strategy="Valentina ban on side-select; wave-first Lord checklist.",
        status="scheduled", created_by=users["captain"].id,
    ))
    db.flush()
    return {"s23": s23, "s29": s29}


# ---------------------------------------------------------------------------
# Ban board, strategy, drafts, events, development, settings
# ---------------------------------------------------------------------------
def seed_bans(db: Session, heroes: dict[str, Hero]) -> None:
    def h(name: str) -> tuple[int | None, str]:
        hero = heroes.get(name)
        return (hero.id if hero else None), name

    rows = [
        ("standard", 1, "", "Suyou", "Overtuned early skirmish — we never leave it open."),
        ("standard", 2, "", "Lukas", "Sustain outscales our EXP pool until nerfs land."),
        ("standard", 3, "", "Zhuxin", "Zone control removes our Yve/Pharsa comfort angles."),
        ("opponent", 1, "Team X", "Fanny", "Their jungler IXI is 41-12 career on her. Respect ban."),
        ("opponent", 2, "Team X", "Valentina", "Stolen Khufra ult decided Scrim #023 game 1."),
        ("opponent", 3, "Team X", "Joy", "Opens their fastest snowball — force them onto Nolan."),
        ("opponent", 1, "Blackhawk", "Mathilda", "Whole comp is built around her engages."),
        ("opponent", 2, "Blackhawk", "Fredrinn", "Removes the wall their damage roam hides behind."),
        ("patch", 1, CURRENT_PATCH, "Lukas", "Hotfix landed light — stay banned until scrim data says otherwise."),
        ("patch", 2, CURRENT_PATCH, "Suyou", "Mask tap combo still one-shots backline at level 2."),
        ("patch", 3, CURRENT_PATCH, "Chip", "Teleport objective tempo is patch-warping; ban when first-picked."),
    ]
    for scope, prio, opp, hero_name, reason in rows:
        hid, hname = h(hero_name)
        db.add(BanEntry(scope=scope, priority=prio, opponent=opp,
                        patch=CURRENT_PATCH if scope == "patch" else "",
                        hero_id=hid, hero_name=hname, reason=reason))
    db.flush()


def seed_strategy(db: Session, users: dict[str, User]) -> None:
    rows = [
        ("Default 1-3-1 objective setup", "MACRO",
         "From 1:40: RINJI holds far side, TOBI+MIRA hug river, KAZE owns pit brush. "
         "No recall on objective spawn timers — consumables check at :50.\n\n"
         "Trade rule: if pit is lost by setup, instantly trade cross-map turret + jungle camps. "
         "Never arrive late and fight 4v5.", True, "", ["objective", "default"], ["turtle", "lord"], ""),
        ("Lord dance: zone, don't flip", "OBJECTIVE",
         "We do NOT start Lord below 60% wave assurance. Posture: Yve starfield on choke, "
         "Khufra fog-side, jungler behind pit wall.\n\nBehind ≥3k? Fake posture, take the trade. "
         "A 50/50 Lord is a 100% decision error.", True, "", ["lord", "zone"], ["lord"], "1.9.47"),
        ("Team X file: mid-jungle invade timings", "OPPONENT FILE",
         "Their mid+roam shadow IXI at 0:48 into our blue-side when we show roam gold side early.\n\n"
         "Answer: KAZE hovers mid brush at 0:35, MIRA leashes vertical. Force their plan B — "
         "their level 2-4 is significantly weaker.", False, "Team X", ["invade", "timings"], ["early game"], ""),
        ("Anti-dive front-to-back shell", "TEAMFIGHT",
         "Core: Yve / Khufra / Fredrinn. Damage owns ONE target — called by KAZE only. "
         "Divers ignored unless past the starfield line.\n\nReposition cue: 'reset' = stacked "
         "retreat to pit-side brush, never split exits.", False, "", ["teamfight", "dive"], [], ""),
        ("Fanny snowball comp (SORA package)", "COMPOSITION",
         "Only drafted when: enemy mid is immobile AND Khufra is banned out.\n"
         "Pair with Angela + split EXP (Cici). First buff is contested WITH Fanny, never solo.\n"
         "Win condition: 8-minute 3k lead via pick rotations; close before two defensive items.",
         False, "", ["fanny", "snowball"], ["fanny"], ""),
        ("Wave-first checklist (from Scrim #029)", "MACRO",
         "10:55 checkpoint: mid wave state → enemy roam flash timer → pit vision triangle. "
         "All three green before ANY Lord posture. Missing one = posture only, no start.",
         False, "", ["checklist", "lord"], ["late game"], ""),
    ]
    for title, cat, body, pinned, opp, tags_cat, tags_extra, patch in rows:
        tags = list(tags_cat) + list(tags_extra)
        db.add(StrategyNote(title=title, category=cat, body=body, pinned=pinned, opponent=opp,
                            patch=patch, tags=dumps(tags),
                            author_id=users["coach"].id if cat != "OPPONENT FILE" else users["analyst"].id))
    db.flush()


def seed_drafts(db: Session, users: dict[str, User]) -> None:
    db.add(DraftPlan(
        name="Anti–Team X objective shell", opponent="Team X", patch=CURRENT_PATCH, status="approved",
        notes="Wave-first plan from Scrim #029 review. Bans shift Valentina to first phase on side-select.",
        draft=_draft(["Valentina", "Fanny", "Joy", "Suyou", "Lukas"],
                     ["Nolan", "Yve", "Khufra", "Claude", "Chip"],
                     {"EXP": "Arlott", "JUNGLE": "Fredrinn", "MID": "Novaria", "GOLD": "Karrie", "ROAM": "Khufra"},
                     {"EXP": "Lukas", "JUNGLE": "Hayabusa", "MID": "Zhuxin", "GOLD": "Beatrix", "ROAM": "Angela"}),
        created_by=users["coach"].id,
    ))
    db.add(DraftPlan(
        name="Fanny snowball package", opponent="", patch=CURRENT_PATCH, status="testing",
        notes="SORA signature. Gate: Khufra banned + immobile enemy mid. Test in Friday scrim block.",
        draft=_draft(["Karrie", "Chou", "Franco", "Suyou", "Lukas"],
                     ["Hayabusa", "Valentina", "Chip", "Claude", "Yve"],
                     {"EXP": "Cici", "JUNGLE": "Fanny", "MID": "Pharsa", "GOLD": "Beatrix", "ROAM": "Angela"},
                     {"EXP": "Terizla", "JUNGLE": "Nolan", "MID": "Yve", "GOLD": "Wanwan", "ROAM": "Floryn"}),
        created_by=users["captain"].id,
    ))
    db.add(DraftPlan(
        name="ADM Clash groups — day one board", opponent="", patch=CURRENT_PATCH, status="idea",
        notes="Placeholder board for group opponents; Nox fills enemy tendencies after scout.",
        draft=_draft(STD_BANS_OURS, STD_BANS_THEIRS, OUR_A, ENEMY_A),
        created_by=users["analyst"].id,
    ))
    db.flush()


def seed_events(db: Session, users: dict[str, User]) -> None:
    rows = [
        ("ADM Community Clash S3 — Group Stage", "tournament", 10, "18:00", "23:00", "Online",
         "Group B seed #4. Three series day one. Win two → playoffs.", "https://discord.gg/example"),
        ("Scrim block vs Nova Kings", "scrim", 2, "22:00", "", "Custom lobby",
         "Tournament prep. Objective checklist graded live.", ""),
        ("Week 4 VOD review circle", "review", 3, "20:30", "22:00", "Discord stage",
         "Everyone brings one clip + one lesson. Failure to submit = bench talk.", ""),
        ("Scrim #029 action deadline — wave drill", "deadline", 3, "23:59", "", "",
         "MIRA: clip review + wave-first checklist proof to ICHIZU.", ""),
        ("Patch 1.9.48 drops — meta meeting", "meeting", 7, "21:00", "22:00", "Discord",
         "Nox presents tier shifts; ban board gets rebuilt same night.", ""),
        ("Roster check-in + VOD of Week 5 opener", "meeting", 13, "20:30", "", "Discord",
         "Quick blockers round, then tape.", ""),
    ]
    for title, kind, off, t1, t2, loc, desc, link in rows:
        db.add(Event(title=title, kind=kind, event_date=d(off), start_time=t1, end_time=t2,
                     location=loc, description=desc, link=link, created_by=users["coach"].id))
    db.flush()


def seed_development(db: Session, users: dict[str, User]) -> None:
    coach, analyst = users["coach"].id, users["analyst"].id
    rows = [
        ("jungle", -2, "coach", "OBJECTIVE", 7, "Turtle setups finally clean. Still peeks pit solo at Lord — see Scrim #031 clips.", coach),
        ("jungle", -9, "coach", "MECHANICS", 8, "Retribution mind-games vs PIP: 14-6 week score. Keep pairing.", coach),
        ("jungle", -3, "self", "MENTAL", 6, "Felt tilted after G2 vs Zenith. Need the 2-minute reset routine between games.", users["jungle"].id),
        ("mid", -5, "coach", "MACRO", 7, "Wave-state discipline improved since Scrim #029 talk. Checklist taped to monitor now.", coach),
        ("mid", -1, "self", "HERO POOL", 8, "20 ranked Zhuxin games done. Lantern placement feels natural; ready to sign off for scrims.", users["mid"].id),
        ("gold", -4, "coach", "POSITIONING", 6, "Two greedy deaths per series average. Farm-to-fight conversion top tier though.", coach),
        ("gold", -2, "self", "MENTAL", 7, "Comms calmer this week. Still quiet when behind — working on stating needs early.", users["gold"].id),
        ("exp", -6, "coach", "LANE", 8, "Lukas block paid off — sustain timings now correct. Cleared for meta slot.", coach),
        ("captain", -3, "analyst", "SHOTCALLING", 8, "Call latency halved since ladder drill. Watch double-call moments vs Zenith G3.", analyst),
        ("captain", -1, "self", "SHOTCALLING", 7, "Owned the G3 flip vs Zenith. That one's on me — review tomorrow, already booked VOD.", users["captain"].id),
    ]
    for key, off, src, cat, rating, notes, by in rows:
        db.add(DevelopmentEntry(user_id=users[key].id, entry_date=d(off), source=src, category=cat,
                                rating=rating, notes=notes, created_by=by))
    db.flush()


def seed_settings(db: Session) -> None:
    db.add(TeamSettings(
        id=1,
        current_weakness="Late-game decision making",
        weakness_category="MACRO",
        weakness_drills_target=4,
        season_name="Season 36 — ADM Clash qualifier run",
    ))
    db.flush()


# ---------------------------------------------------------------------------
def seed_if_empty(db: Session) -> bool:
    """Seed everything when the database has no users. Returns True if seeded."""
    if db.scalar(select(func.count()).select_from(User)):
        return False
    users = seed_users(db)
    heroes = seed_heroes(db)
    seed_pools(db, users, heroes)
    seed_training(db, users)
    seed_scrims(db, users)
    seed_bans(db, heroes)
    seed_strategy(db, users)
    seed_drafts(db, users)
    seed_events(db, users)
    seed_development(db, users)
    seed_settings(db)
    db.commit()
    return True
