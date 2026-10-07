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
    user = db.scalar(select(User).where(User.email == payload.email.strip().lower()))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Wrong email or password")
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
