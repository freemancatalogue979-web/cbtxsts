"""FastAPI dependencies: auth + role-based permissions.

Permission map (from the 9 CLOVER plan):

- ADMIN    full access: players, events, training, heroes, drafts, scrims,
           strategies, all analytics.
- CAPTAIN  manage training sessions, create scrims, upload results, create
           reviews, manage strategy notes, manage draft plans.
- COACH    create drills, review games, tactical notes, rate players,
           create training plans, manage strategy.
- PLAYER   view training, submit self-review, view assigned drills, team
           strategies, personal performance, upload required info.
- ANALYST  view all analytics, build match reviews and stat sheets.
"""
from __future__ import annotations

from fastapi import Cookie, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from .db import get_db
from .models import User
from .security import (
    ROLE_ADMIN,
    ROLE_ANALYST,
    ROLE_CAPTAIN,
    ROLE_COACH,
    ROLE_PLAYER,
    verify_token,
)

SESSION_COOKIE = "clover_session"

__all__ = [
    "get_db",
    "get_current_user",
    "can",
    "require",
    "ROLE_ADMIN",
    "ROLE_CAPTAIN",
    "ROLE_COACH",
    "ROLE_PLAYER",
    "ROLE_ANALYST",
]


def get_current_user(
    authorization: str | None = Header(default=None),
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    db: Session = Depends(get_db),
) -> User:
    # Bearer token (app fetch calls) or browser cookie (img/video/link loads)
    raw: str | None = None
    if authorization and authorization.lower().startswith("bearer "):
        raw = authorization.split(None, 1)[1].strip()
    elif session_cookie:
        raw = session_cookie
    if not raw:
        raise HTTPException(status_code=401, detail="Sign in required")
    payload = verify_token(raw)
    if payload is None:
        raise HTTPException(status_code=401, detail="Session expired — sign in again")
    user = db.get(User, payload.subject)
    if user is None or not user.active:
        raise HTTPException(status_code=401, detail="Account unavailable")
    return user


class can:  # noqa: N801 - reads like a permission table
    """Capability checks keyed on the signed-in user's role."""

    @staticmethod
    def manage_training(user: User) -> bool:
        return user.role in {ROLE_ADMIN, ROLE_CAPTAIN, ROLE_COACH}

    @staticmethod
    def manage_scrims(user: User) -> bool:
        return user.role in {ROLE_ADMIN, ROLE_CAPTAIN}

    @staticmethod
    def upload_results(user: User) -> bool:
        return user.role in {ROLE_ADMIN, ROLE_CAPTAIN}

    @staticmethod
    def create_review(user: User) -> bool:
        return user.role in {ROLE_ADMIN, ROLE_CAPTAIN, ROLE_COACH, ROLE_ANALYST}

    @staticmethod
    def rate_players(user: User) -> bool:
        return user.role in {ROLE_ADMIN, ROLE_COACH}

    @staticmethod
    def manage_strategy(user: User) -> bool:
        return user.role in {ROLE_ADMIN, ROLE_CAPTAIN, ROLE_COACH}

    @staticmethod
    def manage_drafts(user: User) -> bool:
        return user.role in {ROLE_ADMIN, ROLE_CAPTAIN, ROLE_COACH}

    @staticmethod
    def manage_heroes(user: User) -> bool:
        return user.role == ROLE_ADMIN

    @staticmethod
    def annotate_heroes(user: User) -> bool:
        return user.role in {ROLE_ADMIN, ROLE_COACH}

    @staticmethod
    def manage_bans(user: User) -> bool:
        return user.role in {ROLE_ADMIN, ROLE_CAPTAIN, ROLE_COACH}

    @staticmethod
    def manage_events(user: User) -> bool:
        return user.role in {ROLE_ADMIN, ROLE_CAPTAIN}

    @staticmethod
    def manage_users(user: User) -> bool:
        return user.role == ROLE_ADMIN


def require(check: bool, what: str = "do that") -> None:
    if not check:
        raise HTTPException(status_code=403, detail=f"Your role is not allowed to {what}.")
