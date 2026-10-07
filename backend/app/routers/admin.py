"""Admin: user management + team settings."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import can, get_current_user, get_db, require
from ..models import TeamSettings, User
from ..schemas import SettingsPatch, UserIn, UserPatch
from ..security import ROLES, hash_password
from ..serializers import settings_out, user_out

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users")
def list_users(db: Session = Depends(get_db), user=Depends(get_current_user)):
    users = db.scalars(select(User).order_by(User.roster.desc(), User.role, User.ign)).all()
    return [user_out(u) for u in users]


@router.post("/users", status_code=201)
def create_user(payload: UserIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_users(user), "manage users")
    if payload.role not in ROLES:
        raise HTTPException(status_code=422, detail="Unknown role")
    email = payload.email.strip().lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Email already registered")
    from ..config import DEFAULT_ADMIN_PASSWORD

    new = User(
        email=email, password_hash=hash_password(payload.password or DEFAULT_ADMIN_PASSWORD),
        name=payload.name.strip(), ign=payload.ign.strip(), role=payload.role,
        main_role=payload.main_role.upper(), bio=payload.bio, active=payload.active,
        roster=payload.roster or payload.role in {"player", "captain"},
    )
    db.add(new)
    db.commit()
    db.refresh(new)
    return user_out(new)


@router.patch("/users/{user_id}")
def update_user(user_id: int, payload: UserPatch, db: Session = Depends(get_db),
                user=Depends(get_current_user)):
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    data = payload.model_dump(exclude_unset=True)

    # Users may fix their own bio/ign; everything else is admin-only.
    if not can.manage_users(user):
        require(user.id == user_id and not (set(data) - {"bio", "ign"}), "edit this profile")

    if "email" in data and data["email"]:
        data["email"] = data["email"].strip().lower()
    if "role" in data and data["role"] and data["role"] not in ROLES:
        raise HTTPException(status_code=422, detail="Unknown role")
    if "main_role" in data and data["main_role"]:
        data["main_role"] = data["main_role"].upper()
    if "password" in data:
        password = data.pop("password")
        if password:
            target.password_hash = hash_password(password)
    for key, value in data.items():
        setattr(target, key, value)
    db.commit()
    db.refresh(target)
    return user_out(target)


@router.get("/settings")
def get_settings(db: Session = Depends(get_db), user=Depends(get_current_user)):
    settings = db.get(TeamSettings, 1)
    if settings is None:
        settings = TeamSettings(id=1)
        db.add(settings)
        db.commit()
    return settings_out(settings)


@router.patch("/settings")
def update_settings(payload: SettingsPatch, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(user.role in {"admin", "coach"}, "edit team focus")
    settings = db.get(TeamSettings, 1)
    if settings is None:
        settings = TeamSettings(id=1)
        db.add(settings)
        db.flush()
    for key, value in payload.model_dump(exclude_unset=True).items():
        if key == "weakness_category" and value:
            value = value.upper()
        setattr(settings, key, value)
    db.commit()
    db.refresh(settings)
    return settings_out(settings)


# ---------------------------------------------------------------------------
# Data management: admin can wipe table groups. Accounts, heroes and the
# battlefield map guide are never wipeable from here.
# ---------------------------------------------------------------------------
from pydantic import BaseModel  # noqa: E402
from sqlalchemy import text  # noqa: E402

WIPEABLE: dict[str, str] = {
    "development_entries": "Player development + coach ratings",
    "hero_pool": "Player hero pools",
    "training_weeks": "Training weeks",
    "training_activities": "Training activities",
    "scrims": "Scrims (series)",
    "scrim_games": "Scrim games",
    "match_reviews": "Match reviews",
    "strategy_notes": "Strategy notes",
    "map_boards": "Map Lab boards",
    "draft_plans": "Draft Lab boards",
    "ban_entries": "Ban board entries",
    "events": "Calendar events",
    "notifications": "Notifications + announcements",
    "tournaments": "Tournaments",
    "tournament_matches": "Tournament matches",
    "training_programs": "Training programs",
    "program_weeks": "Program weeks/tasks",
    "week_progress": "Program week progress",
}
PROTECTED = "accounts (users), heroes, map guide"


class DataWipeIn(BaseModel):
    tables: list[str]
    confirm: bool = False


@router.get("/data-summary")
def data_summary(db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_users(user), "see data summary")
    return [
        {"table": t, "label": label, "rows": db.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()}
        for t, label in WIPEABLE.items()
    ]


@router.post("/data-wipe")
def data_wipe(payload: DataWipeIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_users(user), "wipe data")
    if not payload.confirm:
        raise HTTPException(status_code=422, detail="Confirmation required.")
    unknown = [t for t in payload.tables if t not in WIPEABLE]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown tables: {', '.join(unknown)}")
    deleted: dict[str, int] = {}
    for table in payload.tables:
        n = db.execute(text(f"DELETE FROM {table}")).rowcount  # noqa: S608 - allowlisted names
        deleted[table] = int(n or 0)
    db.commit()
    return {"deleted": deleted, "protected": PROTECTED}
