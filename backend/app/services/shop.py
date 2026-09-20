"""The arena shop: catalogue, prestige currency and what players own.

Three rules shape this module:

1. **The server owns everything.** Prices, rarity, loot rolls and the diamond
   balance all live here. The client never sends a price, a roll or an amount.
2. **Diamonds cannot be farmed.** Coins are the working currency (questions,
   materials, streaks, duels). Diamonds only move for milestones that happen
   once: a 100-day streak, a flawless exam, a finished course, a rank
   promotion, a major badge. A player holding 500 diamonds has been here for
   months, and the shop is priced for that.
3. **Nothing academic is for sale.** Every item in the catalogue is cosmetic —
   avatars, auras, frames, titles, profiles, chat, victory and answer effects.
   No item changes a score, an XP multiplier or a reward.
"""
from __future__ import annotations

import json
import random
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Attempt, Cosmetic, Course, Quiz, Student, StudentMilestone, utcnow

# --------------------------------------------------------------------------- rarity
RARITIES: dict[str, dict] = {
    "common": {"key": "common", "label": "Common", "order": 0, "ink": "#cbd5e1", "deep": "#64748b", "bright": "#f1f5f9"},
    "rare": {"key": "rare", "label": "Rare", "order": 1, "ink": "#7dd3fc", "deep": "#0369a1", "bright": "#e0f2fe"},
    "epic": {"key": "epic", "label": "Epic", "order": 2, "ink": "#d8b4fe", "deep": "#7c3aed", "bright": "#f3e8ff"},
    "legendary": {"key": "legendary", "label": "Legendary", "order": 3, "ink": "#fcd34d", "deep": "#b45309", "bright": "#fef3c7"},
    "mythic": {"key": "mythic", "label": "Mythic", "order": 4, "ink": "#fda4af", "deep": "#be123c", "bright": "#ffe4e6"},
}

SLOTS: dict[str, str] = {
    "avatar": "Avatar",
    "aura": "Aura",
    "frame": "Frame",
    "title": "Title",
    "theme": "Profile theme",
    "chat": "Chat bubble",
    "duel": "Victory animation",
    "answer": "Answer effect",
}

# --------------------------------------------------------------------------- catalogue


def _item(
    key: str,
    name: str,
    slot: str,
    rarity: str,
    *,
    coins: int = 0,
    diamonds: int = 0,
    glyph: str = "✨",
    blurb: str = "",
    source: str = "shop",
    released: str = "Season 1",
    **extra,
) -> dict:
    return {
        "key": key,
        "name": name,
        "slot": slot,
        "slot_label": SLOTS.get(slot, slot.title()),
        "rarity": rarity,
        "price_coins": coins,
        "price_diamonds": diamonds,
        "glyph": glyph,
        "blurb": blurb,
        "source": source,
        "released": released,
        **extra,
    }


CATALOG: tuple[dict, ...] = (
    # ------------------------------------------------------------- avatars
    _item("avatar_mage", "Mage", "avatar", "common", coins=900, glyph="🧙", blurb="Arcane robes and a staff of first answers."),
    _item("avatar_ninja", "Shadow Ninja", "avatar", "common", coins=1200, glyph="🥷", blurb="Answers before the timer knows it moved."),
    _item("avatar_robot", "Knowledge Robot", "avatar", "common", coins=1000, glyph="🤖", blurb="Beeps once per correct answer."),
    _item("avatar_fox", "Fox Scholar", "avatar", "rare", coins=2600, glyph="🦊", blurb="Clever, quick, and never guesses twice."),
    _item("avatar_scientist", "Mad Scientist", "avatar", "rare", coins=2800, glyph="🧪", blurb="Experiments on every past question."),
    _item("avatar_astronaut", "Space Explorer", "avatar", "rare", coins=3000, glyph="🧑‍🚀", blurb="Studying beyond the syllabus."),
    _item("avatar_dragon", "Dragon Scholar", "avatar", "rare", coins=3400, glyph="🐉", blurb="Hoards citations like treasure."),
    _item("avatar_cyber", "Cyber Warrior", "avatar", "epic", coins=7200, glyph="🦾", blurb="Half machine, all revision."),
    _item("avatar_pirate", "Knowledge Pirate", "avatar", "epic", coins=5800, glyph="🏴‍☠️", blurb="Plunders every past paper."),
    _item("avatar_royal", "Royal Scholar", "avatar", "epic", coins=6500, glyph="👑", blurb="Born to the top of the board."),
    _item("avatar_ancient", "Ancient Scholar", "avatar", "epic", coins=6000, glyph="📚", blurb="Has read everything twice."),
    _item("avatar_shadow_scholar", "Shadow Scholar", "avatar", "legendary", diamonds=750, glyph="🕶️", blurb="Dark Academy exclusive. Gone when the event ends.", source="event", event="dark_academy"),
    _item("avatar_legendary_scholar", "Legendary Scholar", "avatar", "mythic", diamonds=10000, glyph="🎓", blurb="Reserved for the players who never left.", source="vault"),
    _item("avatar_cyber_wolf", "Cyber Wolf", "avatar", "rare", coins=3500, glyph="🐺", blurb="Bio-synthetic predator with optic reflexes and circuit fur."),
    _item("avatar_biome_guardian", "Biome Guardian", "avatar", "legendary", diamonds=650, glyph="🌱", blurb="Protects the digital seedlings across the ecosystem.", source="vault"),

    # ------------------------------------------------------------- auras
    _item("aura_blue", "Blue Glow", "aura", "common", coins=1400, glyph="🔵", blurb="A calm aura for steady revision."),
    _item("aura_green", "Green Particles", "aura", "common", coins=1500, glyph="🍃", blurb="Meadow motes that trail your avatar."),
    _item("aura_gold", "Golden Particles", "aura", "common", coins=2200, glyph="✨", blurb="Gold dust for gold answers."),
    _item("aura_fire", "Fire Aura", "aura", "rare", coins=4200, glyph="🔥", blurb="For players on a run."),
    _item("aura_ice", "Ice Aura", "aura", "rare", coins=4200, glyph="❄️", blurb="Cold, precise, first try."),
    _item("aura_lightning", "Lightning Aura", "aura", "rare", coins=4800, glyph="⚡", blurb="Crackles when the timer is low."),
    _item("aura_royal", "Royal Aura", "aura", "epic", diamonds=700, glyph="👑", blurb="A court of light around your name."),
    _item("aura_storm", "Storm Aura", "aura", "epic", diamonds=900, glyph="⛈️", blurb="Thunder rolls across your portrait."),
    _item("aura_phoenix", "Phoenix Aura", "aura", "legendary", glyph="🪽", blurb="Only for a 100-day streak. Never sold.", source="achievement", requirement="streak_100"),
    _item("aura_galaxy", "Galaxy Aura", "aura", "legendary", diamonds=800, glyph="🌌", blurb="A whole sky orbiting your avatar.", source="vault"),
    _item("aura_dragon", "Dragon Aura", "aura", "legendary", diamonds=1200, glyph="🐲", blurb="Wings folded behind your portrait.", source="vault"),
    _item("aura_void", "Void Aura", "aura", "legendary", diamonds=1500, glyph="🌑", blurb="Dark Academy exclusive. The light bends.", source="event", event="dark_academy"),
    _item("aura_neural", "Neural Aura", "aura", "legendary", diamonds=600, glyph="🧠", blurb="Pulsing synaptic currents flowing around your portrait.", source="vault"),
    _item("aura_bioluminescent", "Bioluminescent Spores", "aura", "rare", coins=3600, glyph="🍄", blurb="Glowing neon forest spores drifting in the dark."),

    # ------------------------------------------------------------- frames
    _item("frame_rookie", "Rookie Ring", "frame", "common", coins=800, glyph="🟢", blurb="A clean ring for a clean start."),
    _item("frame_scholar", "Scholar Ring", "frame", "rare", coins=2400, glyph="🔷", blurb="Parchment and brass around your portrait."),
    _item("frame_champion", "Champion Ring", "frame", "epic", coins=5500, glyph="🏅", blurb="Built for the top of the board."),
    _item("frame_iron_will", "Iron Will", "frame", "epic", glyph="🛡️", blurb="Fifty exams. Never sold.", source="achievement", requirement="exams_50"),
    _item("frame_dark_academy", "Dark Academy Frame", "frame", "legendary", diamonds=300, glyph="🖼️", blurb="Dark Academy exclusive. Ends with the event.", source="event", event="dark_academy"),
    _item("frame_knowledge_crown", "The Knowledge Crown", "frame", "mythic", diamonds=5000, glyph="👑", blurb="An animated crown around your avatar.", source="vault"),
    _item("frame_founder", "The Arena Founder", "frame", "mythic", diamonds=25000, glyph="🏛️", blurb="For the very few who ever get here.", source="vault"),
    _item("frame_cyber_roots", "Cyber Roots", "frame", "rare", coins=2800, glyph="🌿", blurb="Fiber-optic vines woven into an adaptive protective ring."),
    _item("frame_void_core", "Void Frame", "frame", "legendary", diamonds=500, glyph="🕳️", blurb="Dark matter and glowing circuit lines frame your avatar.", source="vault"),
    _item("frame_digital_relic", "Digital Relic", "frame", "mythic", diamonds=3500, glyph="💠", blurb="An ancient crystallized technological core.", source="vault"),

    # ------------------------------------------------------------- titles
    _item("title_novice", "NOVICE", "title", "common", coins=600, glyph="🏷️", blurb="Everyone starts somewhere."),
    _item("title_question_hunter", "QUESTION HUNTER", "title", "common", coins=900, glyph="🏷️", blurb="You have a taste for it now."),
    _item("title_knowledge_seeker", "KNOWLEDGE SEEKER", "title", "rare", coins=2000, glyph="🏷️", blurb="Reading before the exam, not after."),
    _item("title_quiz_warrior", "QUIZ WARRIOR", "title", "rare", coins=2600, glyph="🏷️", blurb="Duels are your warm-up."),
    _item("title_course_master", "COURSE MASTER", "title", "epic", coins=5000, glyph="🏷️", blurb="Whole courses, no gaps."),
    _item("title_exam_slayer", "EXAM SLAYER", "title", "epic", coins=6200, glyph="🏷️", blurb="Papers fear you."),
    _item("title_the_undefeated", "THE UNDEFEATED", "title", "legendary", glyph="🏷️", blurb="Twenty-five correct in a row. Never sold.", source="achievement", requirement="run_25"),
    _item("title_arena_champion", "ARENA CHAMPION", "title", "legendary", diamonds=400, glyph="🏷️", blurb="A title that shows up in every feed.", source="vault"),
    _item("title_diamond_scholar", "DIAMOND SCHOLAR", "title", "legendary", diamonds=900, glyph="🏷️", blurb="Worn by players who grind, not spend.", source="vault"),
    _item("title_the_dark_scholar", "The Dark Scholar", "title", "legendary", diamonds=2000, glyph="🏷️", blurb="Dark Academy exclusive, forever tied to the event.", source="event", event="dark_academy"),
    _item("title_digital_evolution", "DIGITAL EVOLUTION", "title", "legendary", diamonds=500, glyph="🏷️", blurb="A living testament to growth through knowledge.", source="vault"),
    _item("title_biome_master", "BIOME MASTER", "title", "rare", coins=3200, glyph="🏷️", blurb="Explorer of all digital wildernesses."),

    # ------------------------------------------------------------- profile themes
    _item("theme_ancient_library", "Ancient Library", "theme", "common", coins=1200, glyph="📖", blurb="Dust, lamplight and tall shelves."),
    _item("theme_ocean", "Ocean", "theme", "common", coins=1400, glyph="🌊", blurb="Deep blue with moving light."),
    _item("theme_jungle", "Jungle", "theme", "rare", coins=2800, glyph="🌴", blurb="Leaves, shade and birdsong."),
    _item("theme_volcano", "Volcano", "theme", "rare", coins=3000, glyph="🌋", blurb="Embers drifting over your stats."),
    _item("theme_royal", "Royal", "theme", "epic", coins=5200, glyph="🏰", blurb="Velvet, gold leaf and portraits."),
    _item("theme_space", "Space", "theme", "epic", coins=6000, glyph="🪐", blurb="A slow orbit behind your card."),
    _item("theme_haunted", "Haunted Library", "theme", "epic", coins=6800, glyph="🕯️", blurb="Candles that move on their own."),
    _item("theme_castle", "Fantasy Castle", "theme", "legendary", diamonds=500, glyph="🏯", blurb="An animated castle skyline.", source="vault"),
    _item("theme_futuristic", "Futuristic City", "theme", "legendary", diamonds=700, glyph="🌆", blurb="Neon skyline, animated.", source="vault"),
    _item("theme_golden_academy", "Golden Academy", "theme", "legendary", diamonds=850, glyph="🏛️", blurb="Gilded halls, slow shimmer.", source="vault"),
    _item("theme_cyber_forest", "Cyber Forest", "theme", "rare", coins=3200, glyph="🌲", blurb="Giant circuit trees and rivers of flowing glowing data."),
    _item("theme_neon_jungle", "Neon Jungle", "theme", "legendary", diamonds=450, glyph="🌿", blurb="Dark canopy illuminated by bioluminescent alien flora.", source="vault"),
    _item("theme_techno_nature", "Techno-Nature", "theme", "legendary", diamonds=500, glyph="🌱", blurb="Where branches are fiber optics and petals are processors.", source="vault"),

    # ------------------------------------------------------------- chat items
    _item("chat_sky", "Sky Bubble", "chat", "common", coins=700, glyph="💬", blurb="Your messages ride a blue bubble."),
    _item("chat_sunset", "Sunset Bubble", "chat", "rare", coins=1800, glyph="💬", blurb="Warm gradient, soft edge."),
    _item("chat_neon", "Neon Bubble", "chat", "epic", coins=3400, glyph="💬", blurb="Glowing outline around every line."),
    _item("chat_dragon", "Dragon Bubble", "chat", "legendary", diamonds=350, glyph="💬", blurb="Scales shimmer when you send.", source="vault"),

    # ------------------------------------------------------------- duel cosmetics
    _item("duel_classic", "Classic Victory", "duel", "common", coins=900, glyph="🏆", blurb="A clean trophy on the win screen."),
    _item("duel_confetti", "Confetti Victory", "duel", "rare", coins=2000, glyph="🎉", blurb="The whole arena throws paper."),
    _item("duel_dragon", "Dragon Victory", "duel", "legendary", diamonds=450, glyph="🐲", blurb="Your hero finishes the duel with wings.", source="vault"),
    _item("duel_galaxy", "Galaxy Victory", "duel", "mythic", diamonds=1200, glyph="🌌", blurb="The board folds into stars.", source="vault"),

    # ------------------------------------------------------------- answer effects
    _item("answer_sparkle", "Sparkle", "answer", "common", coins=800, glyph="✨", blurb="A little shine on every correct answer."),
    _item("answer_perfect", "PERFECT!", "answer", "rare", coins=2400, glyph="⚡", blurb="Correct answers shout PERFECT!."),
    _item("answer_perfect_knowledge", "PERFECT KNOWLEDGE!", "answer", "mythic", diamonds=900, glyph="🌌", blurb="The rarest answer effect in the arena.", source="vault"),
)

CATALOG_BY_KEY: dict[str, dict] = {row["key"]: row for row in CATALOG}

# Free starters: everyone owns the plain look, so an empty inventory still works.
DEFAULT_ITEMS: tuple[str, ...] = ("answer_classic",)

EVENT_ITEMS: dict[str, tuple[str, ...]] = {
    "dark_academy": ("frame_dark_academy", "avatar_shadow_scholar", "aura_void", "title_the_dark_scholar"),
}

VAULT_KEYS: tuple[str, ...] = tuple(row["key"] for row in CATALOG if row.get("source") == "vault")

# Achievement requirements — checked server-side, and these items can never be
# bought at any price.
REQUIREMENTS: dict[str, dict] = {
    "streak_100": {"label": "Reach a 100-day streak", "field": "best_streak", "value": 100},
    "exams_50": {"label": "Submit 50 exams", "field": "exams_taken", "value": 50},
    "run_25": {"label": "Answer 25 questions correctly in a row", "field": "best_run", "value": 25},
}

# --------------------------------------------------------------------------- events
# One live event at a time, aligned to the calendar so every player sees the same
# shelf and the same countdown. Days 1–12 of each month are Dark Academy.
EVENTS: tuple[dict, ...] = (
    {
        "key": "dark_academy",
        "name": "Dark Academy",
        "glyph": "🌑",
        "blurb": "The library goes dark. Void auras, a shadow avatar and the Dark Scholar title — all of them leave when the event does.",
        "day_from": 1,
        "day_to": 12,
        "color": "#7c3aed",
    },
)


def active_event(now: datetime | None = None) -> dict | None:
    """The event running right now, with the exact moment it closes."""
    now = now or utcnow()
    for event in EVENTS:
        if event["day_from"] <= now.day <= event["day_to"]:
            closes = now.replace(day=event["day_to"], hour=23, minute=59, second=59, microsecond=0)
            return {**event, "closes_at": closes.isoformat(), "seconds_left": int((closes - now).total_seconds())}
    return None


def next_event(now: datetime | None = None) -> dict | None:
    """The next window an event opens — so the shelf can count down to it."""
    now = now or utcnow()
    for event in EVENTS:
        if event["day_from"] <= now.day <= event["day_to"]:
            continue
        if now.day < event["day_from"]:
            opens = now.replace(day=event["day_from"], hour=0, minute=0, second=0, microsecond=0)
        else:
            month = now.month + 1
            year = now.year + (1 if month > 12 else 0)
            month = 1 if month > 12 else month
            opens = now.replace(year=year, month=month, day=event["day_from"], hour=0, minute=0, second=0, microsecond=0)
        return {**event, "opens_at": opens.isoformat(), "seconds_until": int((opens - now).total_seconds())}
    return None


def event_item_keys(event_key: str) -> set[str]:
    return set(EVENT_ITEMS.get(event_key, ()))


# --------------------------------------------------------------------------- daily deals
DEAL_WINDOW_HOURS = 24


def _day_seed(now: datetime) -> str:
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return f"deals:{start.date().isoformat()}"


def daily_deals(now: datetime | None = None, count: int = 3) -> list[dict]:
    """Three coin items on sale today. Same for everyone, changes at midnight."""
    now = now or utcnow()
    pool = [row for row in CATALOG if row["price_coins"] > 0 and row["source"] == "shop"]
    rng = random.Random(_day_seed(now))
    picked = rng.sample(pool, min(count, len(pool)))
    deals = []
    for row in picked:
        off = rng.choice([15, 20, 25, 30, 35, 40])
        price = max(1, int(round(row["price_coins"] * (100 - off) / 100)))
        deals.append({"key": row["key"], "off": off, "price_coins": price, "base_coins": row["price_coins"]})
    return deals


def featured(now: datetime | None = None, count: int = 4) -> list[str]:
    """The rotating shelf — reshuffles every six hours."""
    now = now or utcnow()
    bucket = now.replace(minute=0, second=0, microsecond=0)
    bucket = bucket - timedelta(hours=bucket.hour % 6)
    pool = [row["key"] for row in CATALOG if row["source"] in {"shop", "vault"}]
    rng = random.Random(f"featured:{bucket.isoformat()}")
    return rng.sample(pool, min(count, len(pool)))


# --------------------------------------------------------------------------- ownership
def owned_keys(db: Session, student_id: int) -> set[str]:
    rows = db.scalars(select(Cosmetic.item_key).where(Cosmetic.student_id == student_id)).all()
    return set(rows) | set(DEFAULT_ITEMS)


def owner_counts(db: Session, keys: list[str] | None = None) -> dict[str, int]:
    """How many players own each item — the number that makes prestige real."""
    statement = select(Cosmetic.item_key, func.count(Cosmetic.id)).group_by(Cosmetic.item_key)
    if keys:
        statement = statement.where(Cosmetic.item_key.in_(keys))
    return {key: int(count) for key, count in db.execute(statement).all()}


def grant_item(db: Session, student: Student, key: str, *, source: str = "shop") -> Cosmetic | None:
    """Give an item. Returns None when the player already owns it."""
    if key not in CATALOG_BY_KEY:
        raise ShopError("That item does not exist.")
    if key in owned_keys(db, student.id):
        return None
    serial = int(db.scalar(select(func.count(Cosmetic.id)).where(Cosmetic.item_key == key)) or 0) + 1
    row = Cosmetic(student_id=student.id, item_key=key, source=source, serial=serial)
    db.add(row)
    db.flush()
    return row


def loadout_of(student: Student) -> dict[str, str]:
    try:
        data = json.loads(student.loadout or "{}")
    except (TypeError, ValueError):
        data = {}
    return {slot: str(value) for slot, value in data.items() if slot in SLOTS and isinstance(value, str) and value}


def equipped_item(student: Student, slot: str) -> dict | None:
    key = loadout_of(student).get(slot)
    return CATALOG_BY_KEY.get(key or "") if key else None


def cosmetic_ref(student: Student) -> dict[str, str]:
    """What other players see: the equipped avatar, aura, frame and title."""
    equipped = loadout_of(student)
    return {slot: equipped.get(slot, "") for slot in ("avatar", "aura", "frame", "title", "theme", "chat")}


def set_equipped(db: Session, student: Student, key: str | None, slot: str | None = None) -> str:
    """Equip (or clear) an item. Returns the slot that changed."""
    current = loadout_of(student)
    if key is None:
        if slot not in SLOTS:
            raise ShopError("Pick a slot to clear.")
        current.pop(slot, None)
        student.loadout = json.dumps(current)
        db.flush()
        return slot
    item = CATALOG_BY_KEY.get(key)
    if item is None:
        raise ShopError("That item does not exist.")
    if key not in owned_keys(db, student.id):
        raise ShopError("You do not own that item yet.")
    current[item["slot"]] = key
    student.loadout = json.dumps(current)
    db.flush()
    return item["slot"]


class ShopError(Exception):
    """A purchase or equip the server refuses."""


# --------------------------------------------------------------------------- buying
def purchase(db: Session, student: Student, key: str) -> dict:
    """Buy an item with coins or diamonds. The server checks the price."""
    item = CATALOG_BY_KEY.get(key)
    if item is None:
        raise ShopError("That item does not exist.")
    if item["source"] == "achievement":
        raise ShopError("That item has to be earned, not bought.")
    if item["source"] == "event" and not active_event():
        raise ShopError("That item left with the event.")
    if key in owned_keys(db, student.id):
        raise ShopError("You already own that.")

    price_coins, price_diamonds = _price_today(item)
    if price_diamonds:
        if student.diamonds < price_diamonds:
            raise ShopError("Not enough diamonds.")
        student.diamonds -= price_diamonds
    elif price_coins:
        if student.coins < price_coins:
            raise ShopError("Not enough coins.")
        student.coins -= price_coins
    else:
        raise ShopError("That item is not for sale.")

    row = grant_item(db, student, key, source=item["source"])
    db.flush()
    return {
        "key": key,
        "name": item["name"],
        "paid_coins": price_coins,
        "paid_diamonds": price_diamonds,
        "serial": row.serial if row else None,
        "source": item["source"],
    }


def _price_today(item: dict) -> tuple[int, int]:
    """Coins / diamonds the item costs right now (daily deals applied)."""
    if item["price_diamonds"]:
        return 0, int(item["price_diamonds"])
    for deal in daily_deals():
        if deal["key"] == item["key"]:
            return int(deal["price_coins"]), 0
    return int(item["price_coins"]), 0


# --------------------------------------------------------------------------- chests
CHESTS: dict[str, dict] = {
    "common": {
        "key": "common",
        "name": "Common Chest",
        "glyph": "📦",
        "rarity": "common",
        "loot": {"coins": (150, 600), "xp": (30, 120), "diamonds": (0, 0)},
        "items": "common",
        "blurb": "Earned from streaks and level-ups. Coins, XP or a common cosmetic.",
    },
    "rare": {
        "key": "rare",
        "name": "Rare Chest",
        "glyph": "🎁",
        "rarity": "rare",
        "loot": {"coins": (600, 1500), "xp": (150, 400), "diamonds": (5, 15)},
        "items": "rare",
        "blurb": "A week-long streak or a rank promotion pays one of these.",
    },
    "legendary": {
        "key": "legendary",
        "name": "Legendary Chest",
        "glyph": "👑",
        "rarity": "legendary",
        "loot": {"coins": (2000, 5000), "xp": (500, 1200), "diamonds": (50, 150)},
        "items": "legendary",
        "blurb": "Finishing a whole course is the usual way to get one.",
    },
}

# How a chest can be earned. Payout keys are milestones, so they pay once.
CHEST_SOURCES: dict[str, tuple[str, int]] = {
    "streak_3": ("common", 1),
    "streak_7": ("rare", 1),
    "streak_30": ("legendary", 1),
    "level_5": ("common", 1),
    "level_10": ("rare", 1),
    "level_25": ("legendary", 1),
    "course_complete": ("legendary", 1),
    "rank_promotion": ("rare", 1),
}


def chest_counts(student: Student) -> dict[str, int]:
    try:
        data = json.loads(student.chests or "{}")
    except (TypeError, ValueError):
        data = {}
    return {kind: max(0, int(data.get(kind, 0) or 0)) for kind in CHESTS}


def _add_chest(student: Student, kind: str, amount: int = 1) -> None:
    counts = chest_counts(student)
    counts[kind] = counts.get(kind, 0) + amount
    student.chests = json.dumps(counts)


def open_chest(db: Session, student: Student, kind: str) -> dict:
    """Open one earned chest. The roll happens here — the client sends nothing."""
    kind = kind if kind in CHESTS else "common"
    counts = chest_counts(student)
    if counts.get(kind, 0) <= 0:
        raise ShopError("You have no chest of that kind.")
    counts[kind] -= 1
    student.chests = json.dumps(counts)

    chest = CHESTS[kind]
    owned = owned_keys(db, student.id)
    pool = [
        row
        for row in CATALOG
        if row["source"] == "shop"
        and row["rarity"] == chest["items"]
        and row["key"] not in owned
        and row["price_coins"] > 0
    ]
    rng = random.Random(f"{student.id}:{kind}:{len(owned)}:{counts[kind]}")
    roll = rng.random()

    reward: dict = {"kind": kind, "name": chest["name"], "glyph": chest["glyph"]}
    if pool and roll < 0.45:
        item = rng.choice(pool)
        grant_item(db, student, item["key"], source="chest")
        reward.update({"type": "item", "item": item["key"], "item_name": item["name"], "rarity": item["rarity"], "glyph": item["glyph"]})
    elif roll < 0.8 or not pool:
        low, high = chest["loot"]["xp"]
        amount = rng.randint(low, high)
        from ..game import award_xp  # local import: game imports this module's milestones

        award_xp(db, student, amount)
        reward.update({"type": "xp", "amount": amount})
    else:
        low, high = chest["loot"]["coins"]
        amount = rng.randint(low, high)
        student.coins += amount
        reward.update({"type": "coins", "amount": amount})

    diamonds_low, diamonds_high = chest["loot"]["diamonds"]
    if diamonds_high > 0 and rng.random() < 0.25:
        amount = rng.randint(diamonds_low, max(diamonds_low, diamonds_high))
        from ..game import award_diamonds  # local import (see above)

        award_diamonds(db, student, amount, reason=f"{chest['name']} bonus")
        reward["diamonds"] = amount

    db.flush()
    return reward


# --------------------------------------------------------------------------- milestones
# Every entry pays once, keyed by the milestone name. This is what keeps
# diamonds rare: nothing here can be repeated for a second payout.
DIAMOND_MILESTONES: dict[str, dict] = {
    "streak_7": {"diamonds": 1, "chest": None, "label": "7-day streak"},
    "streak_30": {"diamonds": 5, "chest": "rare", "label": "30-day streak"},
    "streak_100": {"diamonds": 20, "chest": "legendary", "label": "100-day streak"},
    "flawless_exam": {"diamonds": 3, "chest": None, "label": "Flawless exam (95%+)"},
    "level_10": {"diamonds": 5, "chest": "common", "label": "Level 10"},
    "level_25": {"diamonds": 10, "chest": "rare", "label": "Level 25"},
    "level_50": {"diamonds": 25, "chest": "legendary", "label": "Level 50"},
    "level_60": {"diamonds": 50, "chest": "legendary", "label": "Level 60"},
}
BADGE_DIAMONDS = {"gold": 1, "platinum": 2}
RANK_PROMOTION_DIAMONDS = 15
COURSE_COMPLETE_DIAMONDS = 25

LEVEL_CHESTS = {5: "common", 10: "common", 15: "common", 25: "rare", 40: "rare", 60: "legendary"}


def _claim(db: Session, student: Student, key: str) -> bool:
    """Record a milestone. False when it already paid out."""
    if db.scalar(select(StudentMilestone.id).where(StudentMilestone.student_id == student.id, StudentMilestone.key == key)):
        return False
    db.add(StudentMilestone(student_id=student.id, key=key))
    db.flush()
    return True


def sync(db: Session, student: Student, events: list[dict] | None = None) -> list[dict]:
    """Pay every milestone this player has reached but not yet claimed.

    Called from the reward funnel (:func:`game.grant`), so any XP grant also
    re-checks the diamond milestones. Every payout is claimed exactly once.
    """
    from ..game import award_diamonds, level_from_xp  # local import: game imports this module

    earned: list[dict] = []
    level = level_from_xp(student.xp)

    reached: list[tuple[str, str]] = []
    if student.best_streak >= 7:
        reached.append(("streak_7", "streak"))
    if student.best_streak >= 30:
        reached.append(("streak_30", "streak"))
    if student.best_streak >= 100:
        reached.append(("streak_100", "streak"))
    if student.best_percentage >= 95:
        reached.append(("flawless_exam", "exam"))
    for threshold in (10, 25, 50, 60):
        if level >= threshold:
            reached.append((f"level_{threshold}", "level"))
    for threshold, chest in LEVEL_CHESTS.items():
        if level >= threshold:
            reached.append((f"chest_level_{threshold}", "level"))

    # Badge tiers: a gold badge is worth a diamond, platinum two.
    from ..models import Badge, StudentBadge

    rows = db.execute(
        select(Badge.key, Badge.tier)
        .join(StudentBadge, StudentBadge.badge_id == Badge.id)
        .where(StudentBadge.student_id == student.id)
    ).all()
    for badge_key, tier in rows:
        if tier in BADGE_DIAMONDS:
            reached.append((f"badge_{badge_key}", f"badge:{tier}"))

    # Finishing every quiz in a course is worth real diamonds.
    for course_id, course_code in _completed_courses(db, student):
        reached.append((f"course_{course_id}", f"course:{course_code}"))

    for key, kind in reached:
        if not _claim(db, student, key):
            continue
        if key.startswith("chest_level_"):
            threshold = int(key.split("_")[-1])
            _add_chest(student, LEVEL_CHESTS[threshold])
            earned.append({"type": "chest", "kind": LEVEL_CHESTS[threshold], "milestone": key, "label": f"Level {threshold} chest"})
            continue
        if kind.startswith("badge:"):
            tier = kind.split(":", 1)[1]
            amount = BADGE_DIAMONDS[tier]
            award_diamonds(db, student, amount, reason=f"{tier.title()} badge", events=events)
            earned.append({"type": "diamonds", "amount": amount, "milestone": key, "label": f"{tier.title()} badge"})
            continue
        if kind.startswith("course:"):
            code = kind.split(":", 1)[1]
            award_diamonds(db, student, COURSE_COMPLETE_DIAMONDS, reason=f"{code} completed", events=events)
            _add_chest(student, "legendary")
            earned.append({
                "type": "diamonds",
                "amount": COURSE_COMPLETE_DIAMONDS,
                "milestone": key,
                "label": f"{code} completed",
            })
            continue
        plan = DIAMOND_MILESTONES.get(key)
        if plan:
            award_diamonds(db, student, plan["diamonds"], reason=plan["label"], events=events)
            if plan["chest"]:
                _add_chest(student, plan["chest"])
            earned.append({"type": "diamonds", "amount": plan["diamonds"], "milestone": key, "label": plan["label"]})

    # Chests for early streaks and levels — the friendly half of the economy.
    if student.best_streak >= 3 and _claim(db, student, "chest_streak_3"):
        _add_chest(student, "common")
        earned.append({"type": "chest", "kind": "common", "milestone": "chest_streak_3", "label": "3-day streak chest"})
    for threshold in (5,):
        if level >= threshold and _claim(db, student, f"chest_level_{threshold}_early"):
            _add_chest(student, "common")
            earned.append({"type": "chest", "kind": "common", "milestone": f"chest_level_{threshold}_early", "label": "Level chest"})

    return earned


def promote(db: Session, student: Student, rank_key: str, events: list[dict] | None = None) -> dict | None:
    """A new season rank band is worth diamonds and a chest. Fires once per band."""
    if rank_key in {"bronze", ""}:
        return None
    key = f"rank_{rank_key}"
    if not _claim(db, student, key):
        return None
    from ..game import award_diamonds

    award_diamonds(db, student, RANK_PROMOTION_DIAMONDS, reason=f"Reached {rank_key.title()}", events=events)
    _add_chest(student, "rare")
    return {"type": "diamonds", "amount": RANK_PROMOTION_DIAMONDS, "milestone": key, "label": f"Reached {rank_key.title()}"}


def _completed_courses(db: Session, student: Student) -> list[tuple[int, str]]:
    """Courses where this player has a submitted attempt on every quiz."""
    quizzes = db.execute(select(Quiz.id, Quiz.course_id).where(Quiz.status != "draft")).all()
    if not quizzes:
        return []
    submitted = set(
        db.scalars(
            select(Attempt.quiz_id).where(
                Attempt.student_id == student.id,
                Attempt.status.in_(("submitted", "expired")),
            )
        ).all()
    )
    by_course: dict[int, list[int]] = {}
    for quiz_id, course_id in quizzes:
        by_course.setdefault(int(course_id), []).append(int(quiz_id))
    done: list[tuple[int, str]] = []
    for course_id, quiz_ids in by_course.items():
        if quiz_ids and all(quiz_id in submitted for quiz_id in quiz_ids):
            course = db.get(Course, course_id)
            done.append((course_id, getattr(course, "code", f"Course {course_id}")))
    return done


# --------------------------------------------------------------------------- shop state
def item_public(db: Session, item: dict, *, owned: set[str], counts: dict[str, int], viewer: Student, serial: int | None = None) -> dict:
    price_coins, price_diamonds = _price_today(item)
    deal = next((row for row in daily_deals() if row["key"] == item["key"]), None)
    unlocked = True
    requirement = REQUIREMENTS.get(item.get("requirement", ""))
    if item["source"] == "achievement" and requirement:
        unlocked = getattr(viewer, requirement["field"], 0) >= requirement["value"]
    event = active_event()
    available = item["source"] != "event" or (event is not None and item["key"] in event_item_keys(event["key"]))
    return {
        **item,
        "price_coins": price_coins,
        "price_diamonds": price_diamonds,
        "base_coins": int(item["price_coins"]),
        "deal_off": int(deal["off"]) if deal else 0,
        "owned": item["key"] in owned,
        "serial": serial,
        "owners": int(counts.get(item["key"], 0)),
        "requirement": requirement["label"] if requirement else None,
        "unlocked": unlocked,
        "available": available,
        "rarity_meta": RARITIES[item["rarity"]],
    }


def shop_state(db: Session, student: Student) -> dict:
    """Everything the shop screen needs in one response."""
    owned = owned_keys(db, student.id)
    counts = owner_counts(db)
    serials = {
        row.item_key: row.serial
        for row in db.scalars(select(Cosmetic).where(Cosmetic.student_id == student.id)).all()
    }
    items = [item_public(db, row, owned=owned, counts=counts, viewer=student, serial=serials.get(row["key"])) for row in CATALOG]
    event = active_event()
    deals = daily_deals()
    deal_keys = {row["key"] for row in deals}
    return {
        "balance": {"coins": student.coins, "diamonds": student.diamonds, "xp": student.xp},
        "equipped": loadout_of(student),
        "items": items,
        "owned": sorted(owned),
        "serials": serials,
        "chests": chest_counts(student),
        "chest_defs": list(CHESTS.values()),
        "featured": featured(),
        "deals": deals,
        "deal_keys": sorted(deal_keys),
        "event": event,
        "next_event": next_event(),
        "event_items": sorted(event_item_keys(event["key"])) if event else [],
        "vault": list(VAULT_KEYS),
        "slots": SLOTS,
        "rarities": list(RARITIES.values()),
        "achievements": {key: row["label"] for key, row in REQUIREMENTS.items()},
        "collection": {
            "owned_count": len(owned),
            "total": len(CATALOG),
            "diamond_items": len([row for row in CATALOG if row["price_diamonds"]]),
            "owners_richest": 0,
        },
    }


def trophy_history(db: Session, key: str, student: Student | None = None) -> dict:
    """The plaque under an item: rarity, release, owners, source."""
    item = CATALOG_BY_KEY.get(key)
    if item is None:
        raise ShopError("That item does not exist.")
    count = int(db.scalar(select(func.count(Cosmetic.id)).where(Cosmetic.item_key == key)) or 0)
    mine = None
    if student is not None:
        row = db.scalar(select(Cosmetic).where(Cosmetic.student_id == student.id, Cosmetic.item_key == key))
        mine = {"serial": row.serial, "acquired_at": row.acquired_at.isoformat(), "source": row.source} if row else None
    return {
        "key": key,
        "name": item["name"],
        "rarity": item["rarity"],
        "rarity_meta": RARITIES[item["rarity"]],
        "released": item["released"],
        "owners": count,
        "obtained_from": {
            "shop": "Arena shop",
            "vault": "Diamond vault",
            "event": "Limited-time event",
            "achievement": "Achievement only",
            "chest": "Chest",
        }.get(item["source"], item["source"]),
        "mine": mine,
    }
