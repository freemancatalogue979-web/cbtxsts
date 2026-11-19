"""Admin: user management + team settings."""
from __future__ import annotations

from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, SecretStr
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import vision_provider
from ..ai_credentials import GEMINI, GROQ, PROVIDER, CredentialStorageError, key_status, remove_key, resolved_key, save_key
from ..deps import can, get_current_user, get_db, require
from ..trash import send_to_trash
from ..models import TeamSettings, User
from ..schemas import SettingsPatch, UserIn, UserPatch
from ..security import ROLES, hash_password
from ..serializers import settings_out, user_out
from .auth import username_of, username_taken

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
    if username_taken(db, email):
        raise HTTPException(status_code=409, detail=f"Username \"{username_of(email)}\" is taken — pick an email with a different part before the @")
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
        if data["email"] != target.email:
            if db.scalar(select(User).where(User.email == data["email"], User.id != target.id)):
                raise HTTPException(status_code=409, detail="Email already registered")
            if username_taken(db, data["email"], except_id=target.id):
                raise HTTPException(status_code=409, detail=f"Username \"{username_of(data['email'])}\" is taken — pick an email with a different part before the @")
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
# AI provider credential: write-only, admin-only, encrypted on the server.
# ---------------------------------------------------------------------------
class AIKeyIn(BaseModel):
    key: SecretStr


def _require_secret_write(request: Request, authorization: str | None) -> None:
    # Cookie-only browser requests must not be able to rotate credentials.
    scheme, _, token = (authorization or "").partition(" ")
    require(scheme.lower() == "bearer" and bool(token.strip()), "change provider credentials without a bearer session")
    origin = request.headers.get("origin")
    if origin:
        try:
            parsed = urlsplit(origin)
            secure = parsed.scheme == "https" or (parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"})
        except ValueError:
            secure = False
        require(secure, "send a provider key over an insecure connection")
    elif request.url.scheme != "https" and (not request.client or request.client.host not in {"localhost", "127.0.0.1", "::1"}):
        raise HTTPException(403, "Use HTTPS to change a provider key.")


def _clean_key(payload: AIKeyIn) -> str:
    value = payload.key.get_secret_value().strip()
    if not value or len(value) > 512 or any(ord(char) < 33 or ord(char) > 126 for char in value):
        raise HTTPException(422, "Enter an API key of at most 512 printable ASCII characters without spaces.")
    return value


def _save(db: Session, value: str, provider: str) -> None:
    try:
        save_key(db, value, provider)
    except CredentialStorageError as exc:
        raise HTTPException(503, str(exc)) from None
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Another update was saved at the same time. Please try again.") from None


def _groq_status(db: Session) -> dict:
    return {**key_status(db, GROQ), "model": vision_provider.GROQ_MODEL, "backup": bool(key_status(db)["configured"])}


@router.get("/integrations/ai")
def ai_key_status(response: Response, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require(can.manage_users(user), "manage provider credentials")
    response.headers["Cache-Control"] = "no-store"
    return key_status(db)


@router.post("/integrations/ai")
def update_ai_key(payload: AIKeyIn, request: Request, response: Response,
                        authorization: str | None = Header(default=None), db: Session = Depends(get_db),
                        user: User = Depends(get_current_user)):
    require(can.manage_users(user), "manage provider credentials")
    _require_secret_write(request, authorization)
    _save(db, _clean_key(payload), PROVIDER)
    response.headers["Cache-Control"] = "no-store"
    return key_status(db)


@router.delete("/integrations/ai")
def remove_ai_key(request: Request, response: Response, authorization: str | None = Header(default=None),
                        db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require(can.manage_users(user), "manage provider credentials")
    _require_secret_write(request, authorization)
    remove_key(db)
    response.headers["Cache-Control"] = "no-store"
    return key_status(db)


# Groq: optional key that reads screenshots and documents (app/vision_provider.py).
@router.get("/integrations/groq")
def groq_key_status(response: Response, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require(can.manage_users(user), "manage provider credentials")
    response.headers["Cache-Control"] = "no-store"
    return _groq_status(db)


@router.post("/integrations/groq")
def update_groq_key(payload: AIKeyIn, request: Request, response: Response,
                    authorization: str | None = Header(default=None), db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    require(can.manage_users(user), "manage provider credentials")
    _require_secret_write(request, authorization)
    _save(db, _clean_key(payload), GROQ)
    response.headers["Cache-Control"] = "no-store"
    return _groq_status(db)


@router.delete("/integrations/groq")
def remove_groq_key(request: Request, response: Response, authorization: str | None = Header(default=None),
                    db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require(can.manage_users(user), "manage provider credentials")
    _require_secret_write(request, authorization)
    remove_key(db, GROQ)
    response.headers["Cache-Control"] = "no-store"
    return _groq_status(db)


@router.post("/integrations/groq/test")
def test_groq_key(response: Response, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Check the saved key against Groq's model list (no image is sent, nothing is billed)."""
    require(can.manage_users(user), "manage provider credentials")
    response.headers["Cache-Control"] = "no-store"
    try:
        key = resolved_key(db, GROQ)
    except CredentialStorageError as exc:
        raise HTTPException(503, str(exc)) from None
    if not key:
        raise HTTPException(409, "Save a Groq key first.")
    return vision_provider.check_groq_key(key)


# Gemini: optional Google key, first choice for reading match screenshots (app/vision_provider.py).
def _gemini_status(db: Session) -> dict:
    return {**key_status(db, GEMINI), "model": vision_provider.GEMINI_MODEL,
            "backup": bool(key_status(db, GROQ)["configured"] or key_status(db)["configured"]),
            "backup_names": [name for name, prov in (("Groq", GROQ), ("main AI key", PROVIDER)) if key_status(db, prov)["configured"]]}


@router.get("/integrations/gemini")
def gemini_key_status(response: Response, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require(can.manage_users(user), "manage provider credentials")
    response.headers["Cache-Control"] = "no-store"
    return _gemini_status(db)


@router.post("/integrations/gemini")
def update_gemini_key(payload: AIKeyIn, request: Request, response: Response,
                      authorization: str | None = Header(default=None), db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)):
    require(can.manage_users(user), "manage provider credentials")
    _require_secret_write(request, authorization)
    _save(db, _clean_key(payload), GEMINI)
    response.headers["Cache-Control"] = "no-store"
    return _gemini_status(db)


@router.delete("/integrations/gemini")
def remove_gemini_key(request: Request, response: Response, authorization: str | None = Header(default=None),
                      db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require(can.manage_users(user), "manage provider credentials")
    _require_secret_write(request, authorization)
    remove_key(db, GEMINI)
    response.headers["Cache-Control"] = "no-store"
    return _gemini_status(db)


@router.post("/integrations/gemini/test")
def test_gemini_key(response: Response, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Check the saved key against Gemini's model list (no image is sent, nothing is billed)."""
    require(can.manage_users(user), "manage provider credentials")
    response.headers["Cache-Control"] = "no-store"
    try:
        key = resolved_key(db, GEMINI)
    except CredentialStorageError as exc:
        raise HTTPException(503, str(exc)) from None
    if not key:
        raise HTTPException(409, "Save a Gemini key first.")
    return vision_provider.check_gemini_key(key)


# ---------------------------------------------------------------------------
# Data management: admin can wipe table groups. Accounts, heroes and the
# battlefield map guide are never wipeable from here.
# ---------------------------------------------------------------------------
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
    from ..db import Base

    roots = []
    for name in payload.tables:
        table = Base.metadata.tables.get(name)
        if table is not None:
            rows = [dict(r) for r in db.execute(table.select()).mappings().all()]
            if rows:
                roots.append((table, rows))
    if roots:
        send_to_trash(db, user=user, kind="data_wipe", area="admin", tables=roots,
                      label="Data wipe: " + ", ".join(WIPEABLE[t] for t in payload.tables)[:180],
                      target_id="")
    deleted: dict[str, int] = {}
    for table in payload.tables:
        n = db.execute(text(f"DELETE FROM {table}")).rowcount  # noqa: S608 - allowlisted names
        deleted[table] = int(n or 0)
    db.commit()
    return {"deleted": deleted, "protected": PROTECTED}
