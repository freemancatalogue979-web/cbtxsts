"""Sign-in and session endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import TOKEN_TTL_HOURS
from ..deps import SESSION_COOKIE, get_current_user, get_db
from ..models import User
from ..schemas import LoginIn
from ..security import issue_token, verify_password
from ..serializers import user_out

router = APIRouter(prefix="/auth", tags=["auth"])
WRONG = "Wrong username or password"


def username_of(email: str | None) -> str:
    """The sign-in username: everything before the @ (\"admin\" for admin@9clover.gg)."""
    return (email or "").strip().lower().split("@", 1)[0]


def username_taken(db: Session, email: str, *, except_id: int | None = None) -> bool:
    """True when another account already signs in with this email's username."""
    name = username_of(email)
    if not name:
        return False
    return any(u.id != except_id and username_of(u.email) == name
               for u in db.scalars(select(User).where(User.email.like(f"%{name}%"))).all())


def find_login_user(db: Session, identifier: str, password: str) -> User | None:
    """The account for a username or a full email, if the password matches.

    Usernames are unique for accounts made now, but older data might hold two emails with
    the same part before the @ — then the password decides, and if it fits both the full
    email is needed."""
    ident = (identifier or "").strip().lower()
    if not ident or not password:
        return None
    if "@" in ident:
        user = db.scalar(select(User).where(User.email == ident))
        return user if user is not None and verify_password(password, user.password_hash) else None
    candidates = [u for u in db.scalars(select(User).where(User.email.like(f"{ident}@%"))).all()
                  if username_of(u.email) == ident]
    matches = [u for u in candidates if verify_password(password, u.password_hash)]
    if len(matches) > 1:
        raise HTTPException(status_code=409, detail="Two accounts use that username — sign in with your full email")
    return matches[0] if matches else None


def _set_session_cookie(response: Response, token: str) -> None:
    """Browser-side cookie so <img>/<video>/new-tab loads of uploaded files
    are authenticated. HttpOnly + SameSite=Lax; fetch calls keep using bearer."""
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=TOKEN_TTL_HOURS * 3600,
        httponly=True,
        samesite="lax",
        path="/",
    )


@router.post("/login")
def login(payload: LoginIn, response: Response, db: Session = Depends(get_db)):
    user = find_login_user(db, payload.username or payload.email, payload.password)
    if user is None:
        raise HTTPException(status_code=401, detail=WRONG)
    if not user.active:
        raise HTTPException(status_code=403, detail="Account deactivated — talk to staff")
    token = issue_token(user.id, user.role, user.ign or user.name)
    _set_session_cookie(response, token)
    return {"token": token, "user": user_out(user)}


@router.get("/me")
def me(response: Response, user: User = Depends(get_current_user),
       authorization: str | None = Header(default=None)):
    # refresh the browser cookie for sessions that predate cookie login
    if authorization and authorization.lower().startswith("bearer "):
        _set_session_cookie(response, authorization.split(None, 1)[1].strip())
    return user_out(user)


@router.post("/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE, path="/")
