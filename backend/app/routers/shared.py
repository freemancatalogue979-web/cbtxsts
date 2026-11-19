"""Open a shared AI answer or chat snapshot by its link token (no AI workspace access needed)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy.orm import Session

from .. import ai_share
from ..clover_ai_models import AIShare
from ..deps import get_db
from ..models import User, utcnow
from ..security import verify_token

router = APIRouter(prefix="/shared", tags=["Shared AI"])


def _viewer(authorization: str | None, db: Session) -> User | None:
    scheme, _, credential = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not credential.strip():
        return None
    payload = verify_token(credential.strip())
    if payload is None:
        return None
    user = db.get(User, payload.subject)
    return user if user is not None and user.active else None


@router.get("/{token}")
def open_share(
    token: str,
    response: Response,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> dict:
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    response.headers["Referrer-Policy"] = "no-referrer"
    row = db.query(AIShare).filter_by(token=token).first() if 16 <= len(token) <= 64 else None
    if row is None:
        raise HTTPException(status_code=404, detail="This link was removed or never existed.")
    if row.audience == "team" and _viewer(authorization, db) is None:
        raise HTTPException(status_code=401, detail="Sign in with your 9 Clover account to open this link.")
    body = ai_share.public_share(db, row)
    if body is None:
        raise HTTPException(status_code=404, detail="This link was removed or never existed.")
    row.views += 1
    row.last_viewed_at = utcnow()
    db.commit()
    return body
