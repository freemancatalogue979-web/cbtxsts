"""Who's active: one row per member per day, bumped when they use the hub.

Writes are throttled per process (one write per member every few minutes), so
signing in and clicking around costs at most a handful of tiny updates a day.
Never lets a tracking hiccup get in the way of a request.
"""
from __future__ import annotations

import logging
import threading
import time

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from .models import User, UserActivity, utcnow

log = logging.getLogger("clover.activity")
THROTTLE_SECONDS = 180
_last: dict[int, tuple[str, float]] = {}
_lock = threading.Lock()


def _due(user_id: int, day: str) -> bool:
    now = time.monotonic()
    with _lock:
        seen = _last.get(user_id)
        if seen and seen[0] == day and now - seen[1] < THROTTLE_SECONDS:
            return False
        _last[user_id] = (day, now)
        return True


def touch(db: Session, user: User) -> None:
    """Record that ``user`` is active today (throttled)."""
    now = utcnow()
    today = now.date()
    if not _due(user.id, today.isoformat()):
        return
    try:
        row = db.query(UserActivity).filter_by(user_id=user.id, day=today).first()
        if row is None:
            db.add(UserActivity(user_id=user.id, day=today, hits=1, first_at=now, last_at=now))
        else:
            row.hits = (row.hits or 0) + 1
            row.last_at = now
        db.commit()
    except SQLAlchemyError:  # pragma: no cover - a race or locked DB must not break the request
        db.rollback()
        with _lock:
            _last.pop(user.id, None)
        log.debug("activity write skipped", exc_info=True)


def reset_throttle() -> None:
    """Tests: forget who was seen."""
    with _lock:
        _last.clear()
