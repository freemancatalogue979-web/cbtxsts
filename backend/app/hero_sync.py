"""Daily hero database refresh from Rone (public MLBB data).

Once every 24 hours (configurable) a background worker pulls two public lists:

* ``heroes/positions`` — every hero with its lanes (``roadsort``), classes
  (``sortid``) and strong / weak / synergy relations by hero id;
* ``heroes/rank`` — all-rank win, pick and ban rates over the last 7 days.

and merges them into the ``heroes`` table:

* heroes released since the last run are **added** (lane and class from Rone);
* win / pick / ban rates are **updated** for every hero Rone reports;
* an empty class, empty counter / synergy list is filled in.

What the team curates is never overwritten: notes, the Clover rating, tier,
meta status, patch, difficulty, an existing lane, and any counter / synergy
list someone already filled. A failed or partial download changes nothing.

Only fixed public paths are requested — no member data ever leaves the hub.
A database lease keeps several workers from refreshing at the same time.
"""
from __future__ import annotations

import logging
import os
import re
import threading
import uuid
from datetime import datetime, timedelta
from typing import Any, Callable

from sqlalchemy import DateTime, Integer, String, Text, or_, select, update
from sqlalchemy.orm import Mapped, Session, mapped_column

from .db import Base, SessionLocal
from .models import Hero, dumps, loads, utcnow

logger = logging.getLogger("clover.hero_sync")

ENABLED = os.getenv("CLOVER_HERO_SYNC_ENABLED", "1").strip().lower() not in {"0", "false", "off", "no"}
SYNC_SECONDS = max(3600, int(os.getenv("CLOVER_HERO_SYNC_SECONDS", str(24 * 3600))))
FAIL_RETRY_SECONDS = 3 * 3600  # a failed run is retried sooner than a full day
FIRST_RUN_DELAY_SECONDS = 90  # let the server finish booting first
LEASE_SECONDS = 600
RANK_DAYS = "7"
PAGE_SIZE = 300  # the whole roster in one page (Rone has no page-size cap)
SOURCE = "Rone (public MLBB data)"

POSITIONS_PATH, POSITIONS_QUERY = "heroes/positions", f"size={PAGE_SIZE}&index=1&lang=en"
RANK_PATH = "heroes/rank"
RANK_QUERY = f"days={RANK_DAYS}&rank=all&sort_field=win_rate&sort_order=desc&size={PAGE_SIZE}&index=1&lang=en"

# Rone lane / class ids (rone-arena-api utils/filters.py) and their titles.
LANE_BY_ID = {1: "EXP", 2: "MID", 3: "ROAM", 4: "JUNGLE", 5: "GOLD"}
LANE_BY_TITLE = {"exp": "EXP", "explane": "EXP", "mid": "MID", "midlane": "MID", "roam": "ROAM",
                 "jungle": "JUNGLE", "gold": "GOLD", "goldlane": "GOLD"}
CLASS_BY_ID = {1: "Tank", 2: "Fighter", 3: "Assassin", 4: "Mage", 5: "Marksman", 6: "Support"}
# A new hero with no lane from Rone still needs one; its class is the best guess.
LANE_FOR_CLASS = {"Marksman": "GOLD", "Mage": "MID", "Assassin": "JUNGLE", "Tank": "ROAM", "Support": "ROAM", "Fighter": "EXP"}

_stop = threading.Event()
_wake = threading.Event()
_worker: threading.Thread | None = None


class HeroSyncState(Base):
    __tablename__ = "hero_sync_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    last_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str] = mapped_column(Text, default="")
    added: Mapped[int] = mapped_column(Integer, default=0)
    updated: Mapped[int] = mapped_column(Integer, default=0)
    added_names: Mapped[str] = mapped_column(Text, default="[]")
    total: Mapped[int] = mapped_column(Integer, default=0)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    lease_owner: Mapped[str] = mapped_column(String(36), default="")
    requested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class HeroSyncError(RuntimeError):
    pass


# --------------------------------------------------------------------------- #
# Parsing (pure; unit-tested)
# --------------------------------------------------------------------------- #
def norm(name: str) -> str:
    """Name key that survives punctuation and case ("X.Borg", "Chang'e", "Yi Sun-shin")."""
    return re.sub(r"[^a-z0-9]", "", str(name or "").casefold())


def _d(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _records(payload: Any) -> list[dict] | None:
    """Rows of an upstream envelope ``{code: 0, data: {records: [{data: …}]}}``."""
    if not isinstance(payload, dict) or payload.get("code", 0) not in (0, "0"):
        return None
    records = _d(payload.get("data")).get("records")
    if not isinstance(records, list):
        return None
    return [_d(_d(row).get("data")) for row in records]


def _int(value: Any) -> int | None:
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _rate(value: Any) -> float | None:
    """Upstream rates are fractions (0.506) → percent (50.6)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 1:
        return None
    return round(float(value) * 100, 2)


def _lanes(items: Any) -> list[str]:
    lanes: list[str] = []
    for item in items if isinstance(items, list) else []:
        data = _d(_d(item).get("data"))
        lane = LANE_BY_ID.get(_int(data.get("road_sort_id")) or 0) or LANE_BY_TITLE.get(
            norm(data.get("road_sort_title") or _d(item).get("caption") or ""))
        if lane and lane not in lanes:
            lanes.append(lane)
    return lanes


def _classes(items: Any) -> list[str]:
    classes: list[str] = []
    for item in items if isinstance(items, list) else []:
        data = _d(_d(item).get("data"))
        title = CLASS_BY_ID.get(_int(data.get("sort_id")) or 0) or str(data.get("sort_title") or "").strip().title()
        if title and title not in classes:
            classes.append(title)
    return classes


def parse_positions(payload: Any) -> dict[int, dict]:
    """hero id → {name, lanes, classes, strong, weak, assist (hero ids)}."""
    rows = _records(payload)
    if rows is None:
        raise HeroSyncError("The hero list came back in an unexpected shape.")
    heroes: dict[int, dict] = {}
    for data in rows:
        hero = _d(_d(data.get("hero")).get("data"))
        hero_id, name = _int(data.get("hero_id")), str(hero.get("name") or "").strip()
        if not hero_id or not name or len(name) > 80:
            continue
        relation = _d(data.get("relation"))
        ids = lambda key: [i for i in (_int(v) for v in _d(relation.get(key)).get("target_hero_id") or []) if i]  # noqa: E731
        heroes[hero_id] = {"name": name, "lanes": _lanes(hero.get("roadsort")), "classes": _classes(hero.get("sortid")),
                           "strong": ids("strong"), "weak": ids("weak"), "assist": ids("assist")}
    return heroes


def parse_rates(payload: Any) -> dict[int, dict]:
    """hero id → {name, win_rate, pick_rate, ban_rate} in percent."""
    rows = _records(payload)
    if rows is None:
        raise HeroSyncError("The hero statistics came back in an unexpected shape.")
    rates: dict[int, dict] = {}
    for data in rows:
        hero_id = _int(data.get("main_heroid"))
        values = {"win_rate": _rate(data.get("main_hero_win_rate")), "pick_rate": _rate(data.get("main_hero_appearance_rate")),
                  "ban_rate": _rate(data.get("main_hero_ban_rate"))}
        if hero_id and any(v is not None for v in values.values()):
            rates[hero_id] = {"name": str(_d(_d(data.get("main_hero")).get("data")).get("name") or "").strip(), **values}
    return rates


# --------------------------------------------------------------------------- #
# Merge
# --------------------------------------------------------------------------- #
def merge(db: Session, positions: dict[int, dict], rates: dict[int, dict]) -> dict:
    """Apply one download to the hero table. Returns {added, updated, added_names, total}."""
    if len(positions) < 20:  # a truncated list must never look like "most heroes vanished"
        raise HeroSyncError(f"The hero list looked incomplete ({len(positions)} heroes); nothing was changed.")
    names_by_id = {hid: info["name"] for hid, info in positions.items()}
    for hid, info in rates.items():
        names_by_id.setdefault(hid, info.get("name") or "")
    existing = {norm(h.name): h for h in db.scalars(select(Hero)).all()}
    added: list[str] = []
    touched: set[str] = set()  # unique heroes changed (an upstream duplicate counts once)

    def names(ids: list[int]) -> list[str]:
        out = []
        for hid in ids:
            name = names_by_id.get(hid)
            if name and name not in out:
                out.append(name)
        return out[:12]

    for hid, info in positions.items():
        rate = rates.get(hid, {})
        if norm(info["name"]) in {norm(name) for name in added}:
            continue  # the same new hero listed twice upstream
        hero = existing.get(norm(info["name"]))
        hero_class = "/".join(info["classes"][:2])
        if hero is None:
            lane = (info["lanes"] or [LANE_FOR_CLASS.get(info["classes"][0], "EXP") if info["classes"] else "EXP"])[0]
            hero = Hero(name=info["name"], role=lane, hero_class=hero_class, difficulty=5, meta_status="VIABLE", tier="B",
                        win_rate=rate.get("win_rate") or 50.0, pick_rate=rate.get("pick_rate") or 0.0,
                        ban_rate=rate.get("ban_rate") or 0.0, clover_rating=5.0,
                        notes="Added automatically by the daily hero sync from Rone. Check the lane and add team notes.",
                        strong_against=dumps(names(info["strong"])), weak_against=dumps(names(info["weak"])),
                        synergy=dumps(names(info["assist"])))
            db.add(hero)
            existing[norm(info["name"])] = hero
            added.append(info["name"])
            continue
        changed = False
        for field in ("win_rate", "pick_rate", "ban_rate"):
            value = rate.get(field)
            if value is not None and abs((getattr(hero, field) or 0) - value) >= 0.005:
                setattr(hero, field, value)
                changed = True
        if hero_class and not (hero.hero_class or "").strip():
            hero.hero_class, changed = hero_class, True
        for field, key in (("strong_against", "strong"), ("weak_against", "weak"), ("synergy", "assist")):
            fresh = names(info[key])
            if fresh and not loads(getattr(hero, field) or "[]", []):
                setattr(hero, field, dumps(fresh))
                changed = True
        if changed:
            touched.add(norm(hero.name))
    # Heroes only in the rank list (rare) still get fresh rates.
    seen = {norm(info["name"]) for info in positions.values()}
    for hid, rate in rates.items():
        key = norm(rate.get("name") or "")
        hero = existing.get(key)
        if not key or key in seen or hero is None:
            continue
        changed = False
        for field in ("win_rate", "pick_rate", "ban_rate"):
            value = rate.get(field)
            if value is not None and abs((getattr(hero, field) or 0) - value) >= 0.005:
                setattr(hero, field, value)
                changed = True
        if changed:
            touched.add(key)
    db.commit()
    return {"added": len(added), "updated": len(touched - {norm(name) for name in added}), "added_names": added, "total": len(existing)}


# --------------------------------------------------------------------------- #
# State, lease and the worker
# --------------------------------------------------------------------------- #
def _state(db: Session) -> HeroSyncState:
    row = db.get(HeroSyncState, 1)
    if row is None:
        db.add(HeroSyncState(id=1))
        try:
            db.commit()
        except Exception:  # another worker created it first
            db.rollback()
        row = db.get(HeroSyncState, 1)
    assert row is not None
    return row


def _acquire(db: Session) -> str | None:
    _state(db)
    now, owner = utcnow(), str(uuid.uuid4())
    result = db.execute(update(HeroSyncState).where(
        HeroSyncState.id == 1, or_(HeroSyncState.lease_until.is_(None), HeroSyncState.lease_until < now)
    ).values(lease_owner=owner, lease_until=now + timedelta(seconds=LEASE_SECONDS), last_started_at=now, requested_at=None))
    db.commit()
    return owner if result.rowcount == 1 else None


def _default_fetch(path: str, query: str) -> Any:
    from .routers.intel import _public_fetch

    status, payload = _public_fetch(path, query)
    if status != 200:
        raise HeroSyncError(f"Rone answered HTTP {status}.")
    return payload


def run_once(db: Session, fetch: Callable[[str, str], Any] | None = None) -> dict:
    """One refresh under the lease. Raises HeroSyncError if another run holds it."""
    owner = _acquire(db)
    if owner is None:
        raise HeroSyncError("A hero refresh is already running.")
    fetch = fetch or _default_fetch
    values: dict[str, Any] = {"last_finished_at": None, "lease_owner": "", "lease_until": None}
    try:
        positions = parse_positions(fetch(POSITIONS_PATH, POSITIONS_QUERY))
        try:
            rates = parse_rates(fetch(RANK_PATH, RANK_QUERY))
        except Exception:  # rates are a bonus; new heroes and lanes still land
            logger.warning("Hero rates could not be loaded; continuing with the hero list only")
            rates = {}
        result = merge(db, positions, rates)
        values.update(last_success_at=utcnow(), last_error="", added=result["added"], updated=result["updated"],
                      added_names=dumps(result["added_names"]), total=result["total"])
        logger.info("Hero sync: %s added, %s updated", result["added"], result["updated"])
        return result
    except Exception as exc:
        db.rollback()
        message = str(exc) if isinstance(exc, HeroSyncError) else "Rone could not be reached; the hero database was left as it was."
        values["last_error"] = message[:500]
        logger.warning("Hero sync failed: %s", exc)
        raise HeroSyncError(message) from None
    finally:
        values["last_finished_at"] = utcnow()
        db.execute(update(HeroSyncState).where(HeroSyncState.id == 1, HeroSyncState.lease_owner == owner).values(**values))
        db.commit()


def status(db: Session) -> dict:
    state = _state(db)
    iso = lambda value: value.isoformat() + "Z" if value else None  # noqa: E731
    base = state.last_success_at or state.last_started_at
    delay = FAIL_RETRY_SECONDS if state.last_error else SYNC_SECONDS
    running = bool(state.lease_until and state.lease_until > utcnow())
    return {
        "enabled": ENABLED, "source": SOURCE, "interval_hours": round(SYNC_SECONDS / 3600, 1), "running": running,
        "last_success_at": iso(state.last_success_at), "last_attempt_at": iso(state.last_started_at),
        "next_due_at": iso((base + timedelta(seconds=delay)) if base else None) if ENABLED else None,
        "added": state.added, "updated": state.updated, "added_names": loads(state.added_names or "[]", []),
        "total": state.total, "error": state.last_error or "", "queued": state.requested_at is not None,
        "art": _art_status(),
    }


def _art_status() -> dict:
    try:
        from .hero_art_sync import status as art_status
        return art_status()
    except Exception:  # noqa: BLE001
        return {"enabled": False, "heroes": 0, "pictures": 0, "last_at": None, "source": "", "downloaded": 0, "new_heroes": [], "error": ""}


def request_refresh(db: Session) -> None:
    """Ask the worker to refresh now (admin)."""
    if not ENABLED:
        raise HeroSyncError("The daily hero sync is turned off on this server.")
    _state(db)
    db.execute(update(HeroSyncState).where(HeroSyncState.id == 1).values(requested_at=utcnow()))
    db.commit()
    _wake.set()


def _due(state: HeroSyncState, now: datetime) -> bool:
    if state.requested_at is not None:
        return True
    if state.last_started_at is None:
        return True
    delay = FAIL_RETRY_SECONDS if state.last_error else SYNC_SECONDS
    return state.last_started_at + timedelta(seconds=delay) <= now


def _run() -> None:
    _wake.wait(FIRST_RUN_DELAY_SECONDS)  # an admin's "Refresh now" cuts the boot delay short
    _wake.clear()
    if _stop.is_set():
        return
    while not _stop.is_set():
        try:
            with SessionLocal() as db:
                state = _state(db)
                now = utcnow()
                leased = state.lease_until is not None and state.lease_until > now
                if _due(state, now) and not leased:
                    try:
                        run_once(db)
                    except HeroSyncError:
                        pass  # recorded in the state row
                    refresh_art()
        except Exception:
            logger.exception("Hero sync worker encountered an error")
        _wake.wait(300)
        _wake.clear()


def refresh_art() -> None:
    """Moonton's official hero pictures for the portrait checker (new heroes, refreshed art)."""
    from . import hero_art_sync

    if not hero_art_sync.ENABLED:
        return
    try:
        hero_art_sync.run_once()
    except Exception:  # noqa: BLE001 - pictures are a bonus; the hero data already landed
        logger.exception("Official hero art refresh failed")


def start_worker() -> None:
    global _worker
    if ENABLED and (_worker is None or not _worker.is_alive()):
        _stop.clear()
        _worker = threading.Thread(target=_run, name="hero-sync", daemon=True)
        _worker.start()


def stop_worker() -> None:
    _stop.set()
    _wake.set()
