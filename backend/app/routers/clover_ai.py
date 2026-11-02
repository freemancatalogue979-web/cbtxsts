"""Member AI workspace: private chats, opt-in context and reviewed knowledge."""

from __future__ import annotations

import asyncio
import json
import re
from datetime import timedelta
from typing import Annotated, Callable, Literal
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator, model_validator
from sqlalchemy import func, or_, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from .. import ai_context, ai_esports_analysis, ai_learning, ai_web
from .. import clover_ai_service as service
from ..ai_credentials import key_status
from ..ai_privacy import public_ai_mode, public_ai_text
from ..clover_ai_models import AIAccountConsent, AIActionAudit, AIActionProposal, AIContribution, AIConversation, AIKnowledge, AILearnedMemory, AILearningSettings, AIMemoryNote, AIMessage, AISettings
from ..deps import get_current_user, get_db
from ..hero_profiles import profile_for
from ..models import Hero, User, dumps, loads, utcnow

router = APIRouter(prefix="/ai", tags=["9 Clover AI"])


def ai_user(
    response: Response, authorization: str | None = Header(default=None), user: User = Depends(get_current_user)
) -> User:
    # The shared CORS config permits preview subdomains. Requiring the bearer
    # token even for GET prevents cookie-only cross-origin reads of private chat.
    scheme, _, credential = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not credential.strip():
        raise HTTPException(status_code=401, detail="Bearer sign-in required for AI workspace")
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return user


def admin_user(user: User = Depends(ai_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admins can review community submissions.")
    return user


def iso(value):  # noqa: ANN001
    return value.isoformat() + "Z" if value else None


def conversation_json(row: AIConversation) -> dict:
    return {"id": row.id, "title": row.title, "created_at": iso(row.created_at), "updated_at": iso(row.updated_at)}


def message_json(row: AIMessage) -> dict:
    sources = loads(row.sources_json, [])
    if row.role == "assistant" and isinstance(sources, list):
        sources = [
            {**source, "label": public_ai_text(source.get("label", ""))} if isinstance(source, dict) else source
            for source in sources
        ]
    from ..ai_actions import proposal_json
    return {
        "id": row.id,
        "role": row.role,
        "content": public_ai_text(row.content) if row.role == "assistant" else row.content,
        "mode": "user" if row.role == "user" else public_ai_mode(row.mode),
        "note": public_ai_text(row.note) if row.role == "assistant" else row.note,
        "sources": sources,
        "proposal": proposal_json(row.action_proposal) if row.role == "assistant" and row.action_proposal else None,
        "feedback": row.feedback,
        "created_at": iso(row.created_at),
    }


def memory_json(row: AIMemoryNote) -> dict:
    return {
        "id": row.id,
        "category": row.category,
        "content": row.content,
        "share_in_context": row.share_in_context,
        "created_at": iso(row.created_at),
        "updated_at": iso(row.updated_at),
    }


def own_memory(db: Session, user: User, memory_id: str) -> AIMemoryNote:
    row = db.query(AIMemoryNote).filter_by(id=memory_id, user_id=user.id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Coaching note not found.")
    return row


def own_conversation(db: Session, user: User, conversation_id: str) -> AIConversation:
    row = db.query(AIConversation).filter_by(id=conversation_id, owner_id=user.id).first()
    if row is None:
        # Indistinguishable from a nonexistent conversation, even for admins.
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return row


class SettingsIn(BaseModel):
    share_profile: bool | None = None
    share_account_stats: bool | None = None
    share_pool: bool | None = None
    share_scrims: bool | None = None
    use_history: bool | None = None
    coaching_goal: str | None = Field(default=None, max_length=600)

    @field_validator("coaching_goal")
    @classmethod
    def trim_goal(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else value


MemoryCategory = Literal["strength", "focus", "preference", "goal"]


class MemoryIn(BaseModel):
    category: MemoryCategory
    content: str = Field(min_length=1, max_length=500)
    share_in_context: bool = False


class MemoryUpdateIn(BaseModel):
    category: MemoryCategory | None = None
    content: str | None = Field(default=None, min_length=1, max_length=500)
    share_in_context: bool | None = None


class TitleIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class EsportsSelectionIn(BaseModel):
    """Only source identifiers and filters, never client-supplied match facts."""
    model_config = ConfigDict(extra="forbid")
    source: Literal["aerena", "rone"]
    mode: Literal["week", "matches"]
    region: Literal["id", "ph", "my", "kh"] | None = None
    league_id: str | None = Field(default=None, max_length=80)
    week: int | None = Field(default=None, ge=1, le=99, strict=True)
    match_ids: list[str] = Field(default_factory=list, max_length=500)

    @model_validator(mode="after")
    def valid_scope(self):  # noqa: ANN201
        from ..ai_esports_analysis import rone_id
        from ..aerena_service import _id
        if self.source == "rone" and (not self.region or self.league_id):
            raise ValueError("Choose a Rone MPL region; the source does not identify a season.")
        if self.source == "aerena" and self.league_id is not None and not _id(self.league_id):
            raise ValueError("Invalid Aerena season identifier.")
        if self.source == "aerena" and self.mode == "week" and not _id(self.league_id):
            raise ValueError("Choose an Aerena season.")
        if self.mode == "week" and (self.week is None or self.match_ids):
            raise ValueError("Choose one source week without individual matches.")
        if self.mode == "matches" and (self.week is not None or not self.match_ids):
            raise ValueError("Choose one or more individual matches.")
        if len(set(self.match_ids)) != len(self.match_ids):
            raise ValueError("Select each match only once.")
        for match_id in self.match_ids:
            valid = rone_id(self.region or "", match_id) if self.source == "rone" else _id(match_id, 120)
            if not valid:
                raise ValueError("Invalid source match identifier.")
        return self


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    esports_selection: EsportsSelectionIn | None = None
    match_ids: list[str] = Field(default_factory=list, max_length=service.MAX_SELECTED_MATCHES)
    draft_ids: list[Annotated[int, Field(gt=0, strict=True)]] = Field(
        default_factory=list, max_length=ai_context.MAX_DRAFTS
    )
    map_ids: list[Annotated[int, Field(gt=0, strict=True)]] = Field(
        default_factory=list, max_length=ai_context.MAX_MAPS
    )
    share_board_context: bool = False
    request_action: bool = False
    auto_esports: bool = True
    # Opt-in only: older clients keep their existing cost and response behavior.
    think: StrictBool = False
    # Older clients do not trigger new billable search calls accidentally.
    web_mode: Literal["auto", "on", "off"] = "off"

    @model_validator(mode="after")
    def no_mixed_match_sources(self):  # noqa: ANN201
        if self.esports_selection and self.match_ids:
            raise ValueError("Choose one match selection at a time.")
        return self

    @field_validator("draft_ids", "map_ids")
    @classmethod
    def unique_boards(cls, values: list[int]) -> list[int]:
        if len(set(values)) != len(values):
            raise ValueError("Select each board only once.")
        return values

    @field_validator("match_ids")
    @classmethod
    def valid_match_ids(cls, values: list[str]) -> list[str]:
        if any(not value or len(value) > 120 or value != value.strip() for value in values):
            raise ValueError("Each selected match ID must be 1–120 characters.")
        if len(set(values)) != len(values):
            raise ValueError("Select each match only once.")
        return values


class LearningSettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    auto_learn: StrictBool | None = None
    use_memory: StrictBool | None = None


class SaveResearchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_index: int = Field(ge=0, le=100, strict=True)


class FeedbackIn(BaseModel):
    rating: Literal[-1, 0, 1]


class ChatSearchIn(BaseModel):
    q: str = Field(min_length=2, max_length=100)
    offset: int = Field(default=0, ge=0, le=10000)
    limit: int = Field(default=30, ge=1, le=100)


class ContributionIn(BaseModel):
    kind: Literal["question", "correction", "strategy", "draft", "feedback"]
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=2000)
    source_url: str = Field(default="", max_length=2048)
    share_with_reviewers: bool


class ReviewIn(BaseModel):
    decision: Literal["approve", "reject"]
    note: str = Field(min_length=1, max_length=500)
    reviewed: bool


def nonblank(value: str, label: str) -> str:
    result = value.strip()
    if not result:
        raise HTTPException(status_code=422, detail=f"{label} cannot be blank.")
    return result


@router.get("/esports/rone/{region}/schedule")
def ai_rone_schedule(region: str, refresh: bool = False, user: User = Depends(ai_user),
                     db: Session = Depends(get_db)) -> dict:
    from .. import ai_esports_analysis as analysis
    if region not in analysis.REGIONS:
        raise HTTPException(404, "MPL region not found.")
    payload, observed, state = analysis.rone_schedule(db, region, refresh=refresh)
    if payload is None:
        return {"status": "unavailable", "matches": [], "weeks": [], "observed_at": None,
                "notice": "Rone could not load this schedule. Try again shortly."}
    rows, duplicates = analysis.rone_schedule_rows(payload, region)
    return {"status": state, "matches": rows, "weeks": sorted({row["week"] for row in rows}),
            "observed_at": iso(observed), "duplicate_rows_removed": duplicates, "season": None,
            "notice": "Rone labels weeks but does not identify the season in this schedule."}


@router.get("/esports/aerena/{league_id}/matches")
def ai_aerena_matches(league_id: str, week: int | None = Query(default=None, ge=1, le=99),
                      q: str = Query(default="", max_length=100), offset: int = Query(default=0, ge=0, le=5000),
                      limit: int = Query(default=50, ge=1, le=100), user: User = Depends(ai_user),
                      db: Session = Depends(get_db)) -> dict:
    from ..aerena_models import AerenaLeague, AerenaMatch
    from ..ai_esports_analysis import aerena_week
    from .esports import match_row
    league = db.get(AerenaLeague, league_id)
    if not league:
        raise HTTPException(404, "Aerena season not found.")
    rows = (db.query(AerenaMatch).filter_by(league_id=league_id)
            .order_by(AerenaMatch.starts_at.desc().nullslast(), AerenaMatch.id).limit(5001).all())
    if len(rows) > 5000:
        raise HTTPException(422, "This season is too large to browse safely. Choose a narrower source.")
    weeks: dict[int, int] = {}
    for row in rows:
        number = aerena_week(row)
        if number is not None:
            weeks[number] = weeks.get(number, 0) + 1
    unknown = sum(aerena_week(row) is None for row in rows)
    term = q.strip().casefold()
    filtered = [row for row in rows if (week is None or aerena_week(row) == week) and (
        not term or term in " ".join((row.id, row.team1_name or "", row.team2_name or "",
                                       row.team1_json or "", row.team2_json or "")).casefold())]
    return {"matches": [dict(match_row(row, league), week=aerena_week(row)) for row in filtered[offset:offset + limit]],
            "total": len(filtered), "has_more": offset + limit < len(filtered), "offset": offset,
            "weeks": [{"number": n, "matches": weeks[n]} for n in sorted(weeks)],
            "unlabeled_matches": unknown, "season_loaded": bool(league.matches_fetched_at),
            "season_observed_at": iso(league.matches_fetched_at), "season_error": bool(league.matches_error)}


@router.post("/esports/aerena/{league_id}/load")
def ai_load_aerena_season(league_id: str, refresh: bool = False, user: User = Depends(ai_user),
                          db: Session = Depends(get_db)) -> dict:
    from ..ai_esports_analysis import ensure_aerena_season
    try:
        loaded, notice = ensure_aerena_season(db, league_id, refresh=refresh)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None
    return {"loaded": loaded, "notice": notice}


@router.get("/status")
def status(user: User = Depends(ai_user), db: Session = Depends(get_db)) -> dict:
    state = key_status(db)
    return {
        "provider_configured": bool(state["configured"]),
        "provider_note": (
            "A key is configured; live connectivity has not been verified here."
            if state["configured"]
            else "The AI provider is not configured or the saved key cannot be unlocked."
        ),
        "knowledge": "MLBB game knowledge, saved hero and esports records, private memory and reviewed community notes.",
        "patch_feed": "Rone game-version feed; full balance notes depend on source availability",
        "web_search": (
            "available when enabled and the provider is configured; connectivity not verified"
            if ai_web.enabled()
            else "disabled"
        ),
        "web_search_enabled": ai_web.enabled(),
        "web_search_daily_limit": ai_web.daily_limit(),
        "account_match_history": "Own saved account snapshots only, when separately opted in; coverage depends on the upstream feed.",
        "tournament_participation": "not connected",
        "prediction_engine": "not available",
    }


@router.get("/settings")
def get_settings(user: User = Depends(ai_user), db: Session = Depends(get_db)) -> dict:
    return service.settings_dict(service.settings_for(db, user.id), service.account_stats_consent(db, user.id))


@router.patch("/settings")
def update_settings(data: SettingsIn, user: User = Depends(ai_user), db: Session = Depends(get_db)) -> dict:
    changes = data.model_dump(exclude_unset=True)
    if any(value is None for value in changes.values()):
        raise HTTPException(status_code=422, detail="Settings cannot be null.")
    share_account_stats = changes.pop("share_account_stats", None)
    generation_id = None
    if share_account_stats is True:
        from .intel import _account_generation, _get_link
        generation_id = _account_generation(db, _get_link(user, db))
    row = db.get(AISettings, user.id)
    if row is None:
        row = AISettings(user_id=user.id, **changes)
        db.add(row)
        try:
            db.commit()
        except IntegrityError:  # Another first write created this member's row.
            db.rollback()
            row = db.get(AISettings, user.id)
            if row is None:
                raise
            for key, value in changes.items():
                setattr(row, key, value)
            row.updated_at = utcnow()
            db.commit()
    else:
        for key, value in changes.items():
            setattr(row, key, value)
        row.updated_at = utcnow()
        db.commit()
    if share_account_stats is not None:
        consent = db.get(AIAccountConsent, user.id)
        if share_account_stats:
            if consent is None:
                consent = AIAccountConsent(user_id=user.id, generation_id=generation_id, share_account_stats=True)
                db.add(consent)
            else:
                consent.generation_id = generation_id
                consent.share_account_stats = True
                consent.updated_at = utcnow()
        elif consent is not None:
            db.delete(consent)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "Your linked account changed. Reload before sharing account statistics.") from None
    db.refresh(row)
    return service.settings_dict(row, service.account_stats_consent(db, user.id))


def _clear_learned_context(db: Session, user_id: int) -> None:
    db.query(AILearnedMemory).filter_by(owner_id=user_id).delete(synchronize_session=False)
    learned_settings = db.get(AILearningSettings, user_id)
    if learned_settings is None:
        learned_settings = AILearningSettings(user_id=user_id, auto_learn=False, use_memory=False)
        db.add(learned_settings)
    else:
        learned_settings.auto_learn = learned_settings.use_memory = False
        learned_settings.updated_at = utcnow()


@router.delete("/settings/memory")
def clear_memory(user: User = Depends(ai_user), db: Session = Depends(get_db)) -> dict:
    for _ in range(3):
        row = db.get(AISettings, user.id)
        if row is None:
            row = AISettings(user_id=user.id)
            db.add(row)
        row.share_profile = row.share_pool = row.share_scrims = row.use_history = False
        row.coaching_goal = ""
        row.updated_at = utcnow()
        db.query(AIMemoryNote).filter_by(user_id=user.id).delete(synchronize_session=False)
        db.query(AIAccountConsent).filter_by(user_id=user.id).delete(synchronize_session=False)
        _clear_learned_context(db, user.id)
        try:
            db.commit()
            db.refresh(row)
            return service.settings_dict(row, False)
        except IntegrityError:  # A concurrent first write created a settings row.
            db.rollback()
    raise HTTPException(409, "Your AI settings changed. Please try clearing again.")


@router.get("/memory-notes")
def memory_notes(user: User = Depends(ai_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.query(AIMemoryNote).filter_by(user_id=user.id).order_by(AIMemoryNote.slot.asc()).all()
    return [memory_json(row) for row in rows]


@router.post("/memory-notes", status_code=201)
def create_memory(data: MemoryIn, user: User = Depends(ai_user), db: Session = Depends(get_db)) -> dict:
    content = nonblank(data.content, "Coaching note")
    slots = {slot for (slot,) in db.query(AIMemoryNote.slot).filter_by(user_id=user.id).all()}
    available = next((slot for slot in range(service.MAX_MEMORY_NOTES) if slot not in slots), None)
    if available is None:
        raise HTTPException(status_code=409, detail="You can save up to 12 coaching notes. Delete one to add another.")
    row = AIMemoryNote(
        user_id=user.id, slot=available, category=data.category, content=content, share_in_context=data.share_in_context
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        # The unique slot prevents concurrent creates from exceeding the cap.
        raise HTTPException(
            status_code=409, detail="Your notes changed in another request. Please try again."
        ) from None
    db.refresh(row)
    return memory_json(row)


@router.patch("/memory-notes/{memory_id}")
def update_memory(
    memory_id: str, data: MemoryUpdateIn, user: User = Depends(ai_user), db: Session = Depends(get_db)
) -> dict:
    row = own_memory(db, user, memory_id)
    changes = data.model_dump(exclude_unset=True)
    if any(value is None for value in changes.values()):
        raise HTTPException(status_code=422, detail="Coaching note fields cannot be null.")
    if "content" in changes:
        changes["content"] = nonblank(changes["content"], "Coaching note")
    for key, value in changes.items():
        setattr(row, key, value)
    row.updated_at = utcnow()
    db.commit()
    db.refresh(row)
    return memory_json(row)


@router.delete("/memory-notes/{memory_id}", status_code=204)
def delete_memory(memory_id: str, user: User = Depends(ai_user), db: Session = Depends(get_db)) -> Response:
    row = own_memory(db, user, memory_id)
    db.delete(row)
    db.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.get("/learned-memory")
def list_learned_memory(user: User = Depends(ai_user), db: Session = Depends(get_db)) -> dict:
    prefs = ai_learning.settings(db, user.id)
    rows = db.query(AILearnedMemory).filter_by(owner_id=user.id).order_by(AILearnedMemory.created_at.desc()).limit(ai_learning.MAX_MEMORIES).all()
    return {"auto_learn": prefs.auto_learn, "use_memory": prefs.use_memory, "limit": ai_learning.MAX_MEMORIES,
            "items": [ai_learning.as_json(row) for row in rows]}


@router.patch("/learned-memory/settings")
def update_learning_settings(data: LearningSettingsIn, user: User = Depends(ai_user), db: Session = Depends(get_db)) -> dict:
    changes = data.model_dump(exclude_unset=True)
    if any(value is None for value in changes.values()):
        raise HTTPException(422, "Learning settings cannot be null.")
    for _ in range(2):
        row = db.get(AILearningSettings, user.id)
        if row is None:
            row = AILearningSettings(user_id=user.id, auto_learn=True, use_memory=True)
            db.add(row)
        for key, value in changes.items():
            setattr(row, key, value)
        row.updated_at = utcnow()
        try:
            db.commit()
            return {"auto_learn": row.auto_learn, "use_memory": row.use_memory}
        except IntegrityError:
            db.rollback()
    raise HTTPException(409, "Your memory settings changed. Please try again.")


@router.delete("/learned-memory", status_code=204)
def delete_all_learned_memory(user: User = Depends(ai_user), db: Session = Depends(get_db)) -> Response:
    db.query(AILearnedMemory).filter_by(owner_id=user.id).delete(synchronize_session=False)
    db.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.delete("/learned-memory/{memory_id}", status_code=204)
def delete_learned_memory(memory_id: str, user: User = Depends(ai_user), db: Session = Depends(get_db)) -> Response:
    row = db.query(AILearnedMemory).filter_by(owner_id=user.id, id=memory_id).first()
    if row is None:
        raise HTTPException(404, "Memory not found.")
    db.delete(row)
    db.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.get("/context")
def context(user: User = Depends(ai_user), db: Session = Depends(get_db)) -> dict:
    return service.context_preview(db, user)


@router.get("/conversations")
def conversations(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    user: User = Depends(ai_user),
    db: Session = Depends(get_db),
) -> dict:
    rows = (
        db.query(AIConversation)
        .filter_by(owner_id=user.id)
        .order_by(AIConversation.updated_at.desc(), AIConversation.id.desc())
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    return {"items": [conversation_json(row) for row in rows[:limit]], "has_more": len(rows) > limit}


@router.post("/conversations/search")
def search_conversations(data: ChatSearchIn, user: User = Depends(ai_user), db: Session = Depends(get_db)) -> dict:
    # Search terms can be sensitive. Keep them in the request body rather than
    # the URL, which is commonly retained in server and proxy access logs.
    term = data.q.strip()
    if len(term) < 2:
        raise HTTPException(status_code=422, detail="Enter at least two characters to search.")
    term = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{term}%"
    rows = (
        db.query(AIConversation)
        .filter(
            AIConversation.owner_id == user.id,
            or_(
                AIConversation.title.ilike(pattern, escape="\\"),
                AIConversation.messages.any(AIMessage.content.ilike(pattern, escape="\\")),
            ),
        )
        .order_by(AIConversation.updated_at.desc(), AIConversation.id.desc())
        .offset(data.offset)
        .limit(data.limit + 1)
        .all()
    )
    return {"items": [conversation_json(row) for row in rows[: data.limit]], "has_more": len(rows) > data.limit}


@router.post("/conversations", status_code=201)
def create_conversation(user: User = Depends(ai_user), db: Session = Depends(get_db)) -> dict:
    row = AIConversation(owner_id=user.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return conversation_json(row)


@router.patch("/conversations/{conversation_id}")
def rename_conversation(
    conversation_id: str, data: TitleIn, user: User = Depends(ai_user), db: Session = Depends(get_db)
) -> dict:
    row = own_conversation(db, user, conversation_id)
    row.title = nonblank(data.title, "Title")
    row.updated_at = utcnow()
    db.commit()
    return conversation_json(row)


@router.delete("/conversations/{conversation_id}", status_code=204)
def delete_conversation(conversation_id: str, user: User = Depends(ai_user), db: Session = Depends(get_db)) -> Response:
    row = own_conversation(db, user, conversation_id)
    db.delete(row)
    db.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.get("/conversations/{conversation_id}/export")
def export_conversation(
    conversation_id: str,
    after: int = Query(default=0, ge=0),
    through: int | None = Query(default=None, ge=0),
    limit: int = Query(default=500, ge=1, le=500),
    user: User = Depends(ai_user),
    db: Session = Depends(get_db),
) -> dict:
    row = own_conversation(db, user, conversation_id)
    # Each response is bounded; a high-water mark keeps later pages from including
    # messages added during the export by another session.
    if through is None:
        through = db.query(func.max(AIMessage.id)).filter(AIMessage.conversation_id == conversation_id).scalar() or 0
    if after > through:
        raise HTTPException(status_code=422, detail="Export cursor is outside this snapshot.")
    rows = (
        db.query(AIMessage)
        .filter(AIMessage.conversation_id == conversation_id, AIMessage.id > after, AIMessage.id <= through)
        .order_by(AIMessage.id.asc())
        .limit(limit + 1)
        .all()
    )
    more = len(rows) > limit
    return {
        "format": "9clover-ai-conversation-v1",
        "exported_at": iso(utcnow()),
        "conversation": conversation_json(row),
        "messages": [message_json(message) for message in rows[:limit]],
        "truncated": more,
        "message_limit": limit,
        "snapshot_through": through,
        "next_after": rows[limit - 1].id if more else None,
        "notice": "Private conversation in plaintext. This file is not encrypted; keep it somewhere safe.",
    }


@router.get("/conversations/{conversation_id}/messages")
def messages(
    conversation_id: str,
    before: int | None = Query(default=None, ge=1),
    limit: int = Query(default=50, ge=1, le=100),
    user: User = Depends(ai_user),
    db: Session = Depends(get_db),
) -> dict:
    conversation = own_conversation(db, user, conversation_id)
    query = db.query(AIMessage).filter_by(conversation_id=conversation_id)
    if before is not None:
        query = query.filter(AIMessage.id < before)
    rows = query.order_by(AIMessage.id.desc()).limit(limit + 1).all()
    processing = bool(conversation.busy_until and conversation.busy_until >= utcnow())
    latest = rows[0] if before is None and rows else None
    return {
        "conversation": conversation_json(conversation),
        "messages": [message_json(row) for row in reversed(rows[:limit])],
        "has_more": len(rows) > limit,
        "processing": processing,
        "processing_think": bool(processing and latest and latest.role == "user" and latest.mode == "user_think"),
    }


def _send_message(
    conversation_id: str,
    data: MessageIn,
    background_tasks: BackgroundTasks,
    user: User,
    db: Session,
    on_progress: Callable[[str], None] | None = None,
) -> dict:
    from .. import ai_esports_analysis as match_analysis, ai_game_sources, ai_thinking
    question = nonblank(data.text, "Message")
    own_conversation(db, user, conversation_id)
    if (data.draft_ids or data.map_ids) and not data.share_board_context:
        raise HTTPException(status_code=422, detail="Confirm sharing the selected saved boards with the AI provider.")
    if data.request_action and user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admins can request AI platform-change proposals.")
    from .. import ai_actions
    action_kinds = ai_actions.intent(db, question) if user.role == "admin" else []
    scope = data.esports_selection.model_dump() if data.esports_selection else (
        match_analysis.requested_scope(question, db) if data.auto_esports and not data.match_ids else None
    )
    # A short follow-up may reuse the last public selection only when the
    # member has enabled chat history. It never retrieves another member's data.
    if scope is None and data.auto_esports and not data.match_ids and len(question) < 180 and re.search(
        r"\b(games?|picks?|picked|bans?|banned|heroes|hero|matches|match)\b", question, re.I
    ):
        prefs = service.settings_for(db, user.id)
        if prefs.use_history:
            latest = (db.query(AIMessage).filter_by(conversation_id=conversation_id, role="user")
                      .order_by(AIMessage.id.desc()).first())
            for item in loads(latest.sources_json, []) if latest else []:
                candidate = item.get("esports_selection") if isinstance(item, dict) else None
                if isinstance(candidate, dict):
                    try:
                        scope = EsportsSelectionIn.model_validate(candidate).model_dump()
                    except ValueError:
                        scope = None
                    break
    auto_ids = ai_context.automatic_match_ids(db, question) if data.auto_esports and not data.match_ids and not scope else []
    will_load_matches = bool(scope or data.match_ids or (auto_ids and re.search(r"\b(pick|picks|picked|games?)\b", question, re.I)))
    will_load_game = bool(ai_game_sources.PATCH_INTENT.search(question) or ai_game_sources.GAME_DATA_INTENT.search(question)
                          or re.search(r"\b(skills?|kit|abilities|ability|hero(?:es)?)\b", question, re.I)
                          or service._matching_heroes(db, question, []))
    extra_seconds = max(match_analysis.LOAD_DEADLINE_SECONDS + 240 if will_load_matches else 0,
                        540 if will_load_game else 0)
    token = uuid4().hex
    now = utcnow()
    lock = db.execute(
        update(AIConversation)
        .where(
            AIConversation.id == conversation_id,
            AIConversation.owner_id == user.id,
            or_(AIConversation.busy_until.is_(None), AIConversation.busy_until < now),
        )
        .values(
            busy_token=token,
            busy_until=now + timedelta(seconds=(ai_thinking.THINK_LEASE_SECONDS if data.think else 90) + extra_seconds),
        )
    )
    db.commit()
    if not lock.rowcount:
        own_conversation(db, user, conversation_id)
        raise HTTPException(status_code=409, detail="Another message is still processing in this conversation.")
    try:
        if data.esports_selection and scope and scope["source"] == "aerena":
            from ..aerena_models import AerenaLeague, AerenaMatch
            league = db.get(AerenaLeague, scope["league_id"]) if scope.get("league_id") else None
            if scope.get("league_id") and not league:
                raise HTTPException(404, "That Aerena season is no longer available.")
            if league and scope.get("region") and not match_analysis.aerena_league_matches_region(league, scope["region"]):
                raise HTTPException(422, "That Aerena season does not match the chosen region.")
            for match_id in scope.get("match_ids") or []:
                match = db.get(AerenaMatch, match_id)
                if not match or (scope.get("league_id") and match.league_id != scope["league_id"]):
                    raise HTTPException(404, "A selected match is not in the chosen Aerena season.")
                match_league = league or db.get(AerenaLeague, match.league_id)
                if scope.get("region") and (not match_league or not match_analysis.aerena_league_matches_region(match_league, scope["region"])):
                    raise HTTPException(422, "A selected match does not match the chosen region.")
        try:
            match_facts, match_sources = service.selected_match_evidence(db, data.match_ids or auto_ids)
            board_facts, board_sources = ai_context.selected_boards(db, user, data.draft_ids, data.map_ids)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from None
        except (service.AnalysisError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None
        if auto_ids and match_facts:
            match_facts["sample_notice"] = (
                "Automatically matched saved Aerena records; only a small, potentially stale and incomplete sample, "
                "not a complete team or season history. Game details may be omitted."
            )
            for source in match_sources:
                source["auto_selected"] = True
        prefs = service.settings_for(db, user.id)
        history, previous_user = service.recent_history(db, conversation_id, prefs.use_history)
        if user.role == "admin" and not action_kinds:
            action_kinds = ai_actions.followup_intent(db, question, history)
        if "set_draft_patch" in action_kinds:
            if re.search(r"\b(default|global|new boards?)\b", question, re.I):
                action_kinds.remove("set_draft_patch")
            elif data.draft_ids and "set_patch" in action_kinds:
                action_kinds.remove("set_patch")
        if data.request_action and not action_kinds:
            raise HTTPException(status_code=422, detail="Specify a draft, strategy, hero, patch label or equipment change to propose.")
        facts, sources = service.build_evidence(db, user, prefs, question, previous_user, match_facts, match_sources,
                                                include_auto_esports=data.auto_esports,
                                                include_season_aggregate=not bool(data.match_ids or scope))
        facts.update(board_facts)
        sources.extend(board_sources)
        from .. import ai_saved
        row = own_conversation(db, user, conversation_id)
        if row.title == "New conversation":
            row.title = " ".join(question.split())[:80]
        row.updated_at = utcnow()
        scope_source = []
        if scope and not scope.get("season_requested") and not scope.get("selection_error"):
            stored_scope = {key: value for key, value in scope.items() if key not in {"season_requested", "season_number"}}
            label = f"{scope['source'].title()} esports selection"
            if scope.get("region"):
                label += f" · MPL {scope['region'].upper()}"
            if scope.get("week"):
                label += f" · Week {scope['week']}"
            scope_source = [{"kind": "esports_feed", "label": label, "route": "esports",
                             "esports_selection": stored_scope}]
        prompt = AIMessage(
            conversation_id=conversation_id,
            role="user",
            content=question,
            mode="user_think" if data.think else "user",
            sources_json=dumps((match_sources if data.match_ids else []) + scope_source + board_sources),
        )
        db.add(prompt)
        db.commit()  # Save the user's request before any external network operation.
        db.refresh(prompt)
        clarification = ai_actions.patch_clarification(question, action_kinds, data.draft_ids)
        direct_patch = ai_actions.direct_patch_proposal(question, action_kinds, data.draft_ids) if not clarification else None
        try:
            if not clarification and not direct_patch:
                sources.extend(ai_game_sources.enrich(db, question, facts, on_progress))
            ai_saved.queue_relevant_refreshes(db, user.id, question, facts, background_tasks)
        except SQLAlchemyError:
            # Saved local context remains usable if a best-effort refresh fails.
            db.rollback()
        try:
            pick_facts, pick_sources = None, []
            if scope:
                if scope["source"] == "rone":
                    pick_facts, pick_sources = match_analysis.analyze_rone(db, scope, on_progress)
                else:
                    pick_facts, pick_sources = match_analysis.analyze_aerena_scope(db, scope, on_progress)
            elif data.match_ids or (auto_ids and re.search(r"\b(pick|picks|picked|games?)\b", question, re.I)):
                pick_facts, pick_sources = match_analysis.analyze_aerena(db, data.match_ids or auto_ids,
                                                                         on_progress=on_progress)
            if pick_facts is not None:
                facts["match_pick_analysis"] = pick_facts
                chart = match_analysis.pick_chart(pick_facts, question)
                target_sources = pick_sources if scope else match_sources
                if chart and target_sources:
                    target_sources[0]["visual"] = chart
                if scope:  # Legacy saved-match citations were already included.
                    sources.extend(pick_sources)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from None
        learned, learning_status = ai_learning.learn(db, user.id, question, conversation_id, prompt.id)
        if learning_status != "none":
            facts["memory_action"] = {"status": learning_status, "topic": learned.topic if learned else None,
                                      "notice": "Server-confirmed private memory result; a separate notice is shown to the member."}
        if clarification:
            output = {"mode": "guidance", "content": clarification, "note": "", "sources": []}
            sources = []  # No model or web search was used for this clarification.
        elif direct_patch:
            output = {"mode": "guidance", "content": "Got it, bro — here’s the patch change for your review.",
                      "note": "", "sources": [], "proposal": direct_patch}
            sources = []
        else:
            output = service.answer(
                db, user.id, question, facts, history, data.web_mode, data.auto_esports, action_kinds,
                think=data.think, on_progress=on_progress,
            )
            sources.extend(output.get("sources", []))
        ai_thinking.report(on_progress, "finishing")
        # A deleted chat or expired/replaced lease must never be resurrected.
        db.expire_all()
        row = (
            db.query(AIConversation)
            .filter_by(id=conversation_id, owner_id=user.id, busy_token=token)
            .filter(AIConversation.busy_until >= utcnow())
            .first()
        )
        if row is None:
            raise HTTPException(status_code=409, detail="Conversation was removed or the request expired.")
        memory_notices = {
            "saved": "Got it, bro — I’ve saved that to your private memory. You can review or delete it in Manage context.",
            "duplicate": "I’ve already got that in your private memory, bro. You can review it in Manage context.",
            "disabled": "Auto-learning is switched off, so I haven’t saved that. You can turn it on in Manage context.",
            "need_details": "Tell me the fact you want me to remember, bro — a link or request by itself isn’t enough to save a teaching.",
            "too_long": "That teaching is too long to save in one memory. Send it in shorter pieces, bro.",
            "sensitive": "I haven’t saved that because it looks like it may contain a secret. Please keep passwords and tokens out of chat.",
            "unsafe": "I haven’t saved that as a memory. Share the game fact itself without instructions for the AI, bro.",
            "full": "Your private memory is full. Delete an old memory in Manage context to make room, bro.",
            "unavailable": "I couldn’t save that memory just now. Please try again, bro.",
        }
        memory_notice = memory_notices.get(learning_status)
        reply_content = f"{memory_notice}\n\n{output['content']}" if memory_notice else output["content"]
        reply = AIMessage(
            conversation_id=conversation_id,
            role="assistant",
            content=reply_content,
            mode=output["mode"],
            note=output["note"][:600],
            sources_json=dumps(sources),
        )
        row.updated_at = utcnow()
        row.busy_token = row.busy_until = None
        db.add(reply)
        db.flush()
        if action_kinds and output.get("mode") in {"ai", "think", "guidance"}:
            if output.get("proposal") is not None:
                try:
                    ai_actions.prepare(db, user, reply, output["proposal"], action_kinds,
                                       attached_draft_ids=data.draft_ids, request_text=question)
                    reply.content += "\n\nThis is a proposal only; nothing changes until you review and confirm it."
                except ai_actions.ActionError as exc:
                    reply.content = f"I couldn’t prepare that change: {public_ai_text(str(exc))[:300]} Nothing was changed."
            elif output.get("mode") in {"ai", "think"} and "nothing" not in reply.content.lower():
                reply.content += "\n\nNo change was made."
        db.commit()
        db.refresh(reply)
        return {
            "conversation": conversation_json(row),
            "user_message": message_json(prompt),
            "assistant_message": message_json(reply),
        }
    finally:
        # Handles provider exceptions and process-level interruptions on a best-effort basis;
        # the bounded lease also self-expires after an actual worker crash.
        db.rollback()
        db.execute(
            update(AIConversation)
            .where(
                AIConversation.id == conversation_id,
                AIConversation.owner_id == user.id,
                AIConversation.busy_token == token,
            )
            .values(busy_token=None, busy_until=None)
        )
        db.commit()


@router.post("/conversations/{conversation_id}/messages", status_code=201)
def send_message(
    conversation_id: str,
    data: MessageIn,
    background_tasks: BackgroundTasks,
    user: User = Depends(ai_user),
    db: Session = Depends(get_db),
) -> dict:
    return _send_message(conversation_id, data, background_tasks, user, db)


# Keep detached work alive when a browser disconnects; the result is saved to the
# owner's chat and a reload can observe the processing lease. Request data remains
# in process memory while the task runs. This is not a cross-worker lock.
_stream_jobs: set[asyncio.Task] = set()


@router.post("/conversations/{conversation_id}/messages/stream")
async def send_message_stream(
    conversation_id: str,
    data: MessageIn,
    user: User = Depends(ai_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """Stream truthful stages and heartbeats while the usual guarded send runs."""
    nonblank(data.text, "Message")
    own_conversation(db, user, conversation_id)
    if (data.draft_ids or data.map_ids) and not data.share_board_context:
        raise HTTPException(status_code=422, detail="Confirm sharing the selected saved boards with the AI provider.")
    if data.request_action and user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admins can request AI platform-change proposals.")
    user_id, bind = user.id, db.get_bind()
    db.rollback()  # Do not hold a request-scoped transaction for a long analysis.
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict] = asyncio.Queue()

    def publish(event: dict) -> None:
        try:
            loop.call_soon_threadsafe(queue.put_nowait, event)
        except RuntimeError:
            pass  # The app is shutting down; never log private data.

    def worker() -> None:
        background = BackgroundTasks()
        try:
            # This session belongs solely to the worker and survives a client
            # disconnect; request dependencies may already have been closed.
            with Session(bind=bind, autoflush=False) as worker_db:
                owner = worker_db.get(User, user_id)
                if owner is None or not owner.active:
                    raise HTTPException(status_code=401, detail="Sign in again to use the AI workspace.")
                output = _send_message(
                    conversation_id,
                    data,
                    background,
                    owner,
                    worker_db,
                    on_progress=lambda stage: publish({"type": "status", "stage": stage}),
                )
            publish({"type": "result", "result": output})
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, str) else "The request could not be completed."
            publish({"type": "error", "status": exc.status_code, "detail": public_ai_text(detail)[:500]})
        except Exception:
            # Exceptions can contain prompts, board contents or credentials.
            publish({"type": "error", "status": 500, "detail": "The request could not be completed. Please try again."})
        finally:
            if background.tasks:
                try:
                    asyncio.run(background())
                except Exception:
                    pass  # Refreshes are best-effort and never block the answer.

    job = asyncio.create_task(asyncio.to_thread(worker))
    _stream_jobs.add(job)
    job.add_done_callback(_stream_jobs.discard)

    async def events():  # noqa: ANN202
        def frame(value: dict) -> bytes:
            return (json.dumps(value, ensure_ascii=False) + "\n").encode("utf-8")

        yield frame({"type": "status", "stage": "preparing"})
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=8)
            except asyncio.TimeoutError:
                yield frame({"type": "heartbeat"})
                continue
            yield frame(event)
            if event["type"] in {"result", "error"}:
                return

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-store", "Pragma": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/conversations/{conversation_id}/messages/{message_id}/research-memory", status_code=201)
def save_research_memory(conversation_id: str, message_id: int, data: SaveResearchIn,
                         user: User = Depends(ai_user), db: Session = Depends(get_db)) -> dict:
    own_conversation(db, user, conversation_id)
    row = db.query(AIMessage).filter_by(id=message_id, conversation_id=conversation_id, role="assistant").first()
    if row is None:
        raise HTTPException(404, "Research source not found.")
    sources = loads(row.sources_json, [])
    if not isinstance(sources, list) or data.source_index >= len(sources) or not isinstance(sources[data.source_index], dict):
        raise HTTPException(404, "Research source not found.")
    memory, outcome = ai_learning.save_research(db, user.id, sources[data.source_index], conversation_id, message_id)
    if outcome == "full":
        raise HTTPException(409, "Your memory is full. Delete an old memory to make room.")
    if outcome in {"invalid", "unsafe"}:
        raise HTTPException(422, "This source does not contain a saveable excerpt, or it may include sensitive instructions or secrets.")
    if memory is None:
        raise HTTPException(409, "Could not save this finding. Please try again.")
    return {"status": outcome, "memory": ai_learning.as_json(memory)}


class ConfirmActionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reviewed: StrictBool
    confirm: StrictBool


def action_admin(user: User = Depends(ai_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Only admins can manage AI platform-change proposals.")
    return user


@router.get("/actions/audit")
def action_audit(limit: int = Query(default=50, ge=1, le=100), user: User = Depends(action_admin),
                 db: Session = Depends(get_db)) -> dict:
    rows = db.query(AIActionAudit).order_by(AIActionAudit.created_at.desc(), AIActionAudit.id.desc()).limit(limit).all()
    return {"items": [{"id": row.id, "kind": row.kind, "actor_id": row.actor_id, "target_id": row.target_id,
                       "before": loads(row.before_json, {}), "after": loads(row.after_json, {}),
                       "created_at": iso(row.created_at)} for row in rows]}


@router.post("/actions/{proposal_id}/apply")
def apply_action(proposal_id: str, data: ConfirmActionIn, user: User = Depends(action_admin),
                 db: Session = Depends(get_db)) -> dict:
    if not data.reviewed or not data.confirm:
        raise HTTPException(422, "Review and explicitly confirm the proposal first.")
    from ..ai_actions import ActionError, apply, proposal_json
    try:
        return proposal_json(apply(db, user, proposal_id))
    except ActionError as exc:
        raise HTTPException(409, str(exc)) from None
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "The target changed or already exists; review a new proposal.") from None


@router.post("/actions/{proposal_id}/discard")
def discard_action(proposal_id: str, user: User = Depends(action_admin), db: Session = Depends(get_db)) -> dict:
    result = db.execute(update(AIActionProposal).where(AIActionProposal.id == proposal_id,
                        AIActionProposal.owner_id == user.id, AIActionProposal.status == "pending")
                        .values(status="discarded", resolved_at=utcnow()))
    db.commit()
    if not result.rowcount:
        raise HTTPException(404, "Pending proposal not found.")
    from ..ai_actions import proposal_json
    return proposal_json(db.get(AIActionProposal, proposal_id))


@router.patch("/conversations/{conversation_id}/messages/{message_id}/feedback")
def feedback(
    conversation_id: str,
    message_id: int,
    data: FeedbackIn,
    user: User = Depends(ai_user),
    db: Session = Depends(get_db),
) -> dict:
    own_conversation(db, user, conversation_id)
    row = db.query(AIMessage).filter_by(id=message_id, conversation_id=conversation_id, role="assistant").first()
    if row is None:
        raise HTTPException(status_code=404, detail="Message not found.")
    row.feedback = data.rating
    db.commit()
    return message_json(row)


def knowledge_json(item: AIKnowledge) -> dict:
    return {
        "id": item.id,
        "title": item.title,
        "content": item.content,
        "source_url": item.source_url or None,
        "reviewed_at": iso(item.reviewed_at),
        "notice": "Human-reviewed community guidance; not independently verified.",
    }


@router.get("/knowledge")
def knowledge(
    q: str = Query(default="", max_length=200), user: User = Depends(ai_user), db: Session = Depends(get_db)
) -> dict:
    q = q.strip()
    if q:
        notes = service.knowledge_search(db, q, 20)
        safe = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        heroes = (
            db.query(Hero.id, Hero.name)
            .filter(Hero.name.ilike(f"%{safe}%", escape="\\"))
            .order_by(Hero.name)
            .limit(12)
            .all()
        )
    else:
        notes = db.query(AIKnowledge).filter_by(active=True).order_by(AIKnowledge.reviewed_at.desc()).limit(20).all()
        heroes = []
    return {
        "notes": [knowledge_json(item) for item in notes],
        "heroes": [
            {
                "id": hero.id,
                "name": hero.name,
                "roles": (profile_for(hero.name) or {}).get("roles", []),
                "lanes": (profile_for(hero.name) or {}).get("lanes", []),
                "notice": (
                    "Bundled historical snapshot; not verified for the current patch."
                    if profile_for(hero.name)
                    else "Local name only; no bundled profile available."
                ),
            }
            for hero in heroes
        ],
        "hero_count": db.query(Hero).count(),
        "community_count": db.query(AIKnowledge).filter_by(active=True).count(),
        "notice": "Shared-library keyword search; private learned memories are managed separately. The chat can use saved team equipment and optional web research. No verified live patch feed is connected.",
    }


@router.get("/knowledge/{knowledge_id}")
def knowledge_detail(knowledge_id: str, user: User = Depends(ai_user), db: Session = Depends(get_db)) -> dict:
    row = db.query(AIKnowledge).filter_by(id=knowledge_id, active=True).first()
    if row is None:
        raise HTTPException(status_code=404, detail="This shared note is no longer available.")
    return knowledge_json(row)


@router.delete("/knowledge/{knowledge_id}", status_code=204)
def remove_knowledge(knowledge_id: str, user: User = Depends(admin_user), db: Session = Depends(get_db)) -> Response:
    row = db.query(AIKnowledge).filter_by(id=knowledge_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Knowledge note not found.")
    if row.contribution_id:
        submission = db.get(AIContribution, row.contribution_id)
        if submission is not None:
            submission.status = "removed"
            submission.review_note = (
                "Removed from the shared knowledge library by an admin. " + submission.review_note[:430]
            )
            submission.reviewed_by, submission.reviewed_at = user.id, utcnow()
    db.delete(row)
    db.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


def contribution_json(row: AIContribution, author: str | None = None) -> dict:
    result = {
        "id": row.id,
        "kind": row.kind,
        "title": row.title,
        "content": row.content,
        "source_url": row.source_url or None,
        "status": row.status,
        "review_note": row.review_note,
        "created_at": iso(row.created_at),
        "reviewed_at": iso(row.reviewed_at),
    }
    if author is not None:
        result["author"] = author
    return result


@router.get("/contributions")
def my_contributions(user: User = Depends(ai_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = (
        db.query(AIContribution)
        .filter_by(author_id=user.id)
        .order_by(AIContribution.created_at.desc())
        .limit(100)
        .all()
    )
    return [contribution_json(row) for row in rows]


@router.post("/contributions", status_code=201)
def contribute(data: ContributionIn, user: User = Depends(ai_user), db: Session = Depends(get_db)) -> dict:
    if not data.share_with_reviewers:
        raise HTTPException(
            status_code=422,
            detail="Confirm that this submission may be shared with reviewers and published if approved.",
        )
    title, content = nonblank(data.title, "Title"), nonblank(data.content, "Contribution")
    try:
        source = service.safe_source_url(data.source_url)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    digest = service.fingerprint(title, content)
    if db.query(AIKnowledge).filter_by(fingerprint=digest, active=True).first():
        raise HTTPException(status_code=409, detail="An exact matching note is already in the shared library.")
    if db.query(AIContribution).filter_by(author_id=user.id, fingerprint=digest, status="pending").first():
        raise HTTPException(status_code=409, detail="You already have this exact submission awaiting review.")
    row = AIContribution(
        author_id=user.id, kind=data.kind, title=title, content=content, source_url=source, fingerprint=digest
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return contribution_json(row)


@router.delete("/contributions/{contribution_id}", status_code=204)
def withdraw_contribution(
    contribution_id: str, user: User = Depends(ai_user), db: Session = Depends(get_db)
) -> Response:
    row = db.query(AIContribution).filter_by(id=contribution_id, author_id=user.id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Submission not found.")
    # Atomic conditional delete prevents a withdrawal racing an admin approval.
    from sqlalchemy import delete

    result = db.execute(
        delete(AIContribution).where(
            AIContribution.id == contribution_id,
            AIContribution.author_id == user.id,
            AIContribution.status == "pending",
        )
    )
    if not result.rowcount:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Only a pending submission can be withdrawn; ask an admin to remove a published note.",
        )
    db.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.get("/review")
def review_queue(user: User = Depends(admin_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = (
        db.query(AIContribution, User)
        .join(User, User.id == AIContribution.author_id)
        .filter(AIContribution.status == "pending")
        .order_by(AIContribution.created_at.asc())
        .limit(100)
        .all()
    )
    return [contribution_json(row, author.ign or author.name) for row, author in rows]


@router.post("/review/{contribution_id}")
def review(
    contribution_id: str, data: ReviewIn, user: User = Depends(admin_user), db: Session = Depends(get_db)
) -> dict:
    note = nonblank(data.note, "Review note")
    if not data.reviewed:
        raise HTTPException(status_code=422, detail="Confirm you reviewed the submission before deciding.")
    row = db.query(AIContribution).filter_by(id=contribution_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Submission not found.")
    if row.status != "pending":
        raise HTTPException(status_code=409, detail="This submission has already been reviewed.")
    # Questions and feedback can be answered/acknowledged, but are not facts to
    # publish as guidance. A reviewer can submit a separate sourced note instead.
    publishes = data.decision == "approve" and row.kind not in {"question", "feedback"}
    if publishes and db.query(AIKnowledge).filter_by(fingerprint=row.fingerprint).first():
        raise HTTPException(
            status_code=409, detail="An exact matching note is already in the library; reject the duplicate instead."
        )
    state = "approved" if publishes else ("reviewed" if data.decision == "approve" else "rejected")
    reviewed_at = utcnow()
    # Conditional update works on SQLite as well as databases with row locks,
    # so concurrent reviewers cannot publish a note and reject the same item.
    claimed = db.execute(
        update(AIContribution)
        .where(AIContribution.id == row.id, AIContribution.status == "pending")
        .values(status=state, review_note=note, reviewed_by=user.id, reviewed_at=reviewed_at)
    )
    if not claimed.rowcount:
        db.rollback()
        raise HTTPException(status_code=409, detail="This submission has already been reviewed.")
    if publishes:
        db.add(
            AIKnowledge(
                contribution_id=row.id,
                title=row.title,
                content=row.content,
                source_url=row.source_url,
                fingerprint=row.fingerprint,
                reviewed_at=reviewed_at,
            )
        )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A matching note was approved concurrently.") from None
    db.refresh(row)
    return contribution_json(row)
