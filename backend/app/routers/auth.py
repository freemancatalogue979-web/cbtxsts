"""Authentication: phone-number entry for players, email+password for staff."""
from __future__ import annotations

import base64
import random  # noqa: F401 - reserved for future randomised reward rolls
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import game
from ..game import level_progress
from ..config import DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_NAME, DEFAULT_ADMIN_PASSWORD
from ..db import get_db
from ..deps import current_principal, require_student
from ..events import dispatch, to_everyone
from ..models import Admin, Config, Student, utcnow
from ..schemas import (
    AdminLoginRequest,
    LoginIn,
    PhoneLookupRequest,
    ProfileUpdateIn,
    RegisterIn,
    SessionResponse,
)
from ..security import ROLE_ADMIN, ROLE_STUDENT, create_token, hash_password, normalize_phone, verify_password
from ..schemas import PhotoIn
from ..serializers import initials, iso, student_profile
from ..ws import hub

router = APIRouter(prefix="/auth", tags=["auth"])

WELCOME_COINS = 100
WELCOME_XP = 25


def _avatar_hue(name: str) -> int:
    """Deterministic but varied brand hue (red -> violet -> blue band)."""
    hues = [348, 265, 226, 285, 210, 330, 250, 200]
    return hues[sum(ord(c) for c in name) % len(hues)]


@router.post("/lookup")
def phone_lookup(payload: PhoneLookupRequest, db: Session = Depends(get_db)) -> dict:
    """Recognise an existing player before they submit the sign-in form.

    Returns only what the sign-in card needs to greet a returning player: a
    first name, a level and a hue. No phone number, surname, rank or history is
    ever echoed back, so the endpoint cannot be used to profile a number.
    """
    student = db.scalar(select(Student).where(Student.phone == payload.phone))
    if student is None:
        return {"exists": False, "phone": payload.phone}

    progress = level_progress(student.xp)
    return {
        "exists": True,
        "phone": payload.phone,
        "first_name": (student.name.strip().split(" ")[0][:24] or "Player"),
        "initials": initials(student.name),
        "avatar_hue": student.avatar_hue,
        "level": progress["level"],
        "title": progress["title"],
        "xp": student.xp,
        "percent": progress["percent"],
        "coins": student.coins,
        "streak": student.streak,
        "exams_taken": student.exams_taken,
        "duels_played": student.duels_played,
        "badges": len(student.badges),
        "banned": bool(student.is_banned),
    }


@router.post("/register", response_model=SessionResponse)
async def register(payload: RegisterIn, db: Session = Depends(get_db)) -> SessionResponse:
    """Secure sign-up: unique username + unique phone + password."""
    username = payload.username.strip().lower()
    if db.scalar(select(Student).where(Student.username == username)):
        raise HTTPException(status.HTTP_409_CONFLICT, "That username is taken — pick another.")
    if db.scalar(select(Student).where(Student.phone == payload.phone)):
        raise HTTPException(status.HTTP_409_CONFLICT, "That phone number already has an account — sign in instead.")
    name = (payload.display_name or "").strip() or username
    student = Student(
        phone=payload.phone,
        username=username,
        password_hash=hash_password(payload.password),
        name=name,
        avatar_hue=_avatar_hue(payload.phone),
        coins=WELCOME_COINS,
        xp=0,
        week_key=game.week_key(),
        player_code=game.make_player_code(db),
    )
    db.add(student)
    db.flush()
    game.grant(db, student, xp=WELCOME_XP, coins=0, kind="xp", title="Welcome to the Arena", detail="Sign-up bonus")
    streak = game.touch_streak(student)
    db.commit()
    token = create_token(student.id, ROLE_STUDENT, student.name)
    profile = student_profile(db, student)
    profile["is_new"] = True
    profile["streak"] = streak
    return SessionResponse(token=token, role=ROLE_STUDENT, profile=profile)


@router.post("/student", response_model=SessionResponse)
async def student_login(payload: LoginIn, db: Session = Depends(get_db)) -> SessionResponse:
    """Sign in with phone number OR username, plus the account password."""
    identifier = payload.identifier.strip()
    phone = None
    try:
        phone = normalize_phone(identifier)
    except Exception:  # noqa: BLE001 - not a phone shape, treat as username
        phone = None
    student = None
    if phone:
        student = db.scalar(select(Student).where(Student.phone == phone))
    if student is None:
        student = db.scalar(select(Student).where(Student.username == identifier.lower()))
    if student is None or not student.password_hash or not verify_password(payload.password, student.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong username/phone or password.")
    if student.is_banned:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been suspended. Contact the arena admin.")

    if not student.player_code:
        student.player_code = game.make_player_code(db)

    streak = game.touch_streak(student)
    db.commit()

    token = create_token(student.id, ROLE_STUDENT, student.name)
    profile = student_profile(db, student)
    profile["is_new"] = False  # password login always lands on an existing account
    profile["streak"] = streak

    await hub.broadcast_presence()
    await dispatch([to_everyone("leaderboard", {"scope": "global", "rows": game_leaderboard(db)})])
    return SessionResponse(token=token, role="student", profile=profile)


def game_leaderboard(db: Session, limit: int = 10) -> list[dict]:
    from ..services.exam import top_leaderboard

    return top_leaderboard(db, limit=limit)


@router.post("/admin", response_model=SessionResponse)
async def admin_login(payload: AdminLoginRequest, db: Session = Depends(get_db)) -> SessionResponse:
    admin = db.scalar(select(Admin).where(Admin.email == payload.email.strip().lower()))
    if admin is None or not verify_password(payload.password, admin.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid staff credentials.")
    token = create_token(admin.id, ROLE_ADMIN, admin.name)
    return SessionResponse(
        token=token,
        role="admin",
        profile={
            "id": admin.id,
            "name": admin.name,
            "email": admin.email,
            "role": admin.role,
            "created_at": iso(admin.created_at),
        },
    )


@router.get("/bootstrap-admin")
def bootstrap_admin(db: Session = Depends(get_db)) -> dict:
    """Creates the default staff account on a fresh database (idempotent)."""
    existing = db.scalar(select(Admin).where(Admin.email == DEFAULT_ADMIN_EMAIL))
    if existing:
        return {"created": False, "email": DEFAULT_ADMIN_EMAIL}
    db.add(
        Admin(
            email=DEFAULT_ADMIN_EMAIL,
            name=DEFAULT_ADMIN_NAME,
            password_hash=hash_password(DEFAULT_ADMIN_PASSWORD),
            role="owner",
        )
    )
    db.commit()
    return {"created": True, "email": DEFAULT_ADMIN_EMAIL}


me_router = APIRouter(prefix="/me", tags=["me"])


@me_router.get("")
def read_me(student: Student = Depends(require_student), db: Session = Depends(get_db)) -> dict:
    profile = student_profile(db, student)
    profile["online"] = hub.is_online(student.id)
    return profile


@me_router.patch("")
def update_me(
    payload: ProfileUpdateIn,
    student: Student = Depends(require_student),
    db: Session = Depends(get_db),
) -> dict:
    if payload.name is not None and payload.name.strip():
        student.name = payload.name.strip()[:160]
    if payload.avatar_hue is not None:
        student.avatar_hue = payload.avatar_hue
    if payload.bio is not None:
        student.bio = payload.bio.strip()[:240]
    if payload.status_text is not None:
        student.status_text = payload.status_text.strip()[:80]
    db.commit()
    return student_profile(db, student)


_PHOTO_PREFIXES = (
    "data:image/jpeg;base64,",
    "data:image/jpg;base64,",
    "data:image/png;base64,",
    "data:image/webp;base64,",
)


@me_router.post("/photo")
async def upload_photo(
    payload: PhotoIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Store a profile photo (client-resized data URL) right in the database."""
    image = (payload.image or "").strip()
    prefix = next((candidate for candidate in _PHOTO_PREFIXES if image.startswith(candidate)), None)
    if prefix is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Send a JPEG, PNG or WebP data URL.")
    try:
        raw = base64.b64decode(image[len(prefix):], validate=True)
    except Exception as error:  # noqa: BLE001 - any decode failure is a bad upload
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That image could not be decoded.") from error
    if len(raw) > 400_000:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "Keep photos under ~400KB — the app resizes them automatically before upload.",
        )
    student.photo = image
    db.commit()
    return student_profile(db, student)


@me_router.delete("/photo")
async def remove_photo(
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    student.photo = None
    db.commit()
    return student_profile(db, student)


@me_router.post("/daily-bonus")
async def daily_bonus(student: Student = Depends(require_student), db: Session = Depends(get_db)) -> dict:
    """Once-per-day login reward: coins + XP, scaled by the current streak."""
    from ..models import Activity

    config = db.get(Config, 1)
    claimed_today = db.scalar(
        select(Activity.id).where(
            Activity.student_id == student.id,
            Activity.kind == "daily",
            Activity.created_at >= utcnow() - timedelta(hours=12),
        )
    )
    if claimed_today:
        raise HTTPException(status.HTTP_409_CONFLICT, "You already collected today's bonus. Come back tomorrow.")

    events = game.grant(
        db,
        student,
        xp=25 + min(student.streak, 10) * 5,
        coins=15 + min(student.streak, 10) * 2,
        kind="daily",
        title="Daily arena bonus",
        detail=f"Streak day {student.streak}",
    )
    db.commit()
    await dispatch([to_everyone("leaderboard", {"scope": "global", "rows": game_leaderboard(db)})])
    return {
        "profile": student_profile(db, student),
        "rewards": events,
        "season": (config.season_name if config else ""),
    }
