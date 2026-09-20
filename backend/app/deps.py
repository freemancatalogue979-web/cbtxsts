"""FastAPI dependencies: authentication + role guards."""
from __future__ import annotations

from fastapi import Depends, Header, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .models import Admin, Student
from .security import ROLE_ADMIN, ROLE_STUDENT, Principal, decode_token, extract_token


def current_principal(
    authorization: str | None = Header(default=None),
    token: str | None = Query(default=None),
) -> Principal | None:
    return decode_token(extract_token(authorization, token))


def require_principal(
    principal: Principal | None = Depends(current_principal),
) -> Principal:
    if principal is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue.")
    return principal


def require_student(
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
) -> Student:
    if principal.role != ROLE_STUDENT:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Player access required.")
    student = db.get(Student, int(principal.subject))
    if student is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session no longer valid. Sign in again.")
    if student.is_banned:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been suspended.")
    return student


def require_admin(
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
) -> Admin:
    if principal.role != ROLE_ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Staff access required.")
    admin = db.scalar(select(Admin).where(Admin.id == int(principal.subject)))
    if admin is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Staff session expired.")
    return admin
