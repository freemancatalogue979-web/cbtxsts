"""Typed, review-first admin AI actions. No SQL, shell, code or arbitrary tools.

A model can only propose one allowlisted operation. The exact validated payload is
stored for review, then applied once by a currently authorized admin in the same
transaction as an immutable audit entry. Existing manual role permissions stay as-is.
"""

from __future__ import annotations

import json
import re
from datetime import timedelta
from typing import Any, Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError, model_validator
from sqlalchemy import exists, func, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .clover_ai_models import AIActionAudit, AIActionProposal, AIMessage
from .config import CURRENT_PATCH
from .models import DraftPlan, Hero, StrategyNote, STRATEGY_CATEGORIES, User, dumps, loads, utcnow
from .platform_data import PlatformPatch, TeamEquipment
from .platform_schemas import EquipmentIn
from .security import LANES

Lane = Literal["EXP", "JUNGLE", "MID", "GOLD", "ROAM"]
HeroName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
Short = Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]
Patch = Annotated[str, StringConstraints(strip_whitespace=True, max_length=20)]
Notes = Annotated[str, StringConstraints(strip_whitespace=True, max_length=4000)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class DraftBoard(StrictModel):
    our_bans: list[HeroName | None] = Field(default_factory=list, max_length=5)
    enemy_bans: list[HeroName | None] = Field(default_factory=list, max_length=5)
    our_picks: dict[Lane, HeroName | None] = Field(default_factory=dict, max_length=5)
    enemy_picks: dict[Lane, HeroName | None] = Field(default_factory=dict, max_length=5)


class DraftProposal(StrictModel):
    name: Name
    opponent: Short = ""
    patch: Patch = ""
    notes: Notes = ""
    draft: DraftBoard


class StrategyProposal(StrictModel):
    title: Name
    category: Literal[
        "COMPOSITION", "MACRO", "OBJECTIVE", "TEAMFIGHT", "DRAFT", "ROTATION", "OPPONENT FILE", "META", "GENERAL"
    ] = "GENERAL"
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=8000)]
    opponent: Short = ""
    patch: Patch = ""
    tags: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]] = Field(
        default_factory=list, max_length=10
    )


class HeroChanges(StrictModel):
    role: Lane | None = None
    hero_class: Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)] | None = None
    difficulty: Annotated[int, Field(ge=1, le=10)] | None = None
    meta_status: Literal["META", "STRONG", "VIABLE", "SITUATIONAL", "WEAK", "BANNED/RESTRICTED"] | None = None
    tier: Literal["S+", "S", "A", "B", "C", "D"] | None = None
    patch: Patch | None = None
    notes: Notes | None = None
    win_rate: Annotated[float, Field(ge=0, le=100)] | None = None
    pick_rate: Annotated[float, Field(ge=0, le=100)] | None = None
    ban_rate: Annotated[float, Field(ge=0, le=100)] | None = None
    clover_rating: Annotated[float, Field(ge=0, le=10)] | None = None
    strong_against: list[HeroName] | None = Field(default=None, max_length=20)
    weak_against: list[HeroName] | None = Field(default=None, max_length=20)
    synergy: list[HeroName] | None = Field(default=None, max_length=20)

    @model_validator(mode="after")
    def has_changes(self):
        changes = self.model_dump(exclude_unset=True)
        if not changes or any(value is None for value in changes.values()):
            raise ValueError("Provide at least one non-null hero field.")
        return self


class UpdateHeroProposal(StrictModel):
    hero: HeroName
    changes: HeroChanges


class CreateHeroProposal(StrictModel):
    name: HeroName
    role: Lane
    hero_class: Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)] = ""
    patch: Patch = ""
    notes: Notes = ""


class PatchProposal(StrictModel):
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20)]

    @model_validator(mode="after")
    def valid_label(self):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.+ _-]{0,19}", self.label):
            raise ValueError("Invalid patch label.")
        return self


class ActionEnvelope(StrictModel):
    kind: Literal["create_draft", "create_strategy", "create_hero", "update_hero", "set_patch", "create_item"]
    payload: dict[str, Any]


SCHEMAS = {
    "create_draft": DraftProposal,
    "create_strategy": StrategyProposal,
    "create_hero": CreateHeroProposal,
    "update_hero": UpdateHeroProposal,
    "set_patch": PatchProposal,
    "create_item": EquipmentIn,
}
LIST_FIELDS = {"strong_against", "weak_against", "synergy"}


class ActionError(ValueError):
    pass


def intent(db: Session, question: str) -> list[str]:
    """Only explicit write requests enable the model's proposal format."""
    lower = question.casefold()
    # 'draft' alone may be a noun ("review my draft"), not a request to save one.
    draft_verb = bool(
        re.search(
            r"(?:^|\b(?:please|you|can you|could you|will you)\s+)draft\s+(?:me\s+)?(?:a|an|the|our|my|for)\b", lower
        )
    )
    create = bool(re.search(r"\b(create|make|generate|build|save|add|prepare|write)\b", lower)) or draft_verb
    update_existing = bool(re.search(r"\b(update|edit|change|set|modify)\b", lower))
    if not (create or update_existing):
        return []
    kinds: list[str] = []
    if re.search(r"\b(draft|drafts|draft lab|lineup|composition)\b", lower) and create:
        kinds.append("create_draft")
    if re.search(r"\b(strateg(?:y|ies)|playbook|tactic|tactical plan)\b", lower) and create:
        kinds.append("create_strategy")
    if re.search(
        r"\b(?:add|create|make|save|generate)\s+(?:(?:a|an|new|the|custom|team)\s+){0,3}(?:item|items|equipment)\b",
        lower,
    ):
        kinds.append("create_item")
    names = [name for (name,) in db.query(Hero.name).limit(500).all() if isinstance(name, str)]
    named_hero = any(re.search(r"(?<!\w)" + re.escape(name.casefold()) + r"(?!\w)", lower) for name in names)
    hero_word = bool(re.search(r"\b(hero|heroes)\b", lower)) or named_hero
    if hero_word and update_existing:
        kinds.append("update_hero")
    if (
        re.search(r"\b(?:add|create|make|save)\s+(?:(?:a|an|new|the|custom)\s+){0,3}(?:hero|heroes)\b", lower)
        and not update_existing
    ):
        kinds.append("create_hero")
    if (
        re.search(r"\bpatch\b", lower)
        and update_existing
        and not named_hero
        and not re.search(r"\b(hero|heroes)\b", lower)
    ):
        kinds.append("set_patch")
    return list(dict.fromkeys(kinds))


def instruction(kinds: list[str], hero_names: list[str]) -> str:
    """The model is an untrusted proposal author; the server checks everything."""
    return (
        "For this explicit admin request, return a JSON object with exactly two keys: "
        '"answer" (a concise string) and "proposal" (null, or an object with "kind" and "payload"). '
        f"Allowed kinds for this request: {', '.join(kinds)}. Never claim a proposal is saved or applied. "
        "If details are missing, ask a question and return null. Never output SQL, shell commands or code as an action. "
        "Draft schema: name, opponent, patch, notes, draft {our_bans:[up to 5 names/null], enemy_bans:[up to 5 names/null], "
        "our_picks:{EXP/JUNGLE/MID/GOLD/ROAM: hero name}, enemy_picks:{same}}. Only use listed hero names; no duplicates. "
        "Strategy schema: title, category (COMPOSITION/MACRO/OBJECTIVE/TEAMFIGHT/DRAFT/ROTATION/OPPONENT FILE/META/GENERAL), "
        "body, opponent, patch, tags. Hero creation: name, role, hero_class, patch, notes. "
        "Hero update: hero (exact existing name), changes (only role, hero_class, difficulty, meta_status, tier, patch, notes, "
        "win_rate, pick_rate, ban_rate, clover_rating, strong_against, weak_against, synergy). "
        "Patch schema: label. Equipment schema: name, category, description, patch, source_url (empty or HTTPS). "
        "Do not invent current patch numbers, item attributes, balance changes or statistics; request missing details. "
        "The server validates every field and the admin must review and explicitly confirm before anything changes. "
        "Existing hero names: " + ", ".join(hero_names[:300])
    )


def _heroes(db: Session) -> dict[str, str]:
    return {name.casefold(): name for (name,) in db.query(Hero.name).limit(500).all() if isinstance(name, str)}


def _canonical_hero(value: str, names: dict[str, str]) -> str:
    result = names.get(value.casefold())
    if not result:
        raise ActionError(f"Hero '{value[:80]}' is not in the saved hero database.")
    return result


def validate_payload(db: Session, kind: str, payload: Any) -> dict:
    schema = SCHEMAS.get(kind)
    if schema is None:
        raise ActionError("This action is not supported.")
    try:
        data = schema.model_validate(payload).model_dump(exclude_unset=False)
    except (ValidationError, ValueError) as exc:
        raise ActionError("The proposed fields are incomplete or invalid. Ask for a revised proposal.") from exc
    if kind == "create_draft":
        names = _heroes(db)
        board = data["draft"]
        used = []
        for side in ("our_bans", "enemy_bans"):
            board[side] = [_canonical_hero(value, names) if value else None for value in board[side]]
            used.extend(name for name in board[side] if name)
            board[side] = (board[side] + [None] * 5)[:5]
        for side in ("our_picks", "enemy_picks"):
            board[side] = {lane: _canonical_hero(value, names) for lane, value in board[side].items() if value}
            used.extend(board[side].values())
        if len(used) != len({name.casefold() for name in used}):
            raise ActionError("The same hero cannot occupy multiple pick or ban slots.")
    elif kind == "update_hero":
        model = UpdateHeroProposal.model_validate(payload)
        data["changes"] = model.changes.model_dump(exclude_unset=True)
        names = _heroes(db)
        data["hero"] = _canonical_hero(data["hero"], names)
        for field in LIST_FIELDS & data["changes"].keys():
            data["changes"][field] = [_canonical_hero(value, names) for value in data["changes"][field]]
    return data


def prepare(db: Session, owner: User, message: AIMessage, raw: Any, allowed: list[str]) -> AIActionProposal:
    if owner.role != "admin" or not owner.active:
        raise ActionError("Only admins can prepare AI changes.")
    try:
        envelope = ActionEnvelope.model_validate(raw)
    except ValidationError as exc:
        raise ActionError("The AI did not return a valid, supported proposal.") from exc
    if envelope.kind not in allowed:
        raise ActionError("The proposed change does not match your request.")
    data = validate_payload(db, envelope.kind, envelope.payload)
    before: dict[str, Any] = {}
    target_id = None
    if envelope.kind == "update_hero":
        hero = db.query(Hero).filter(func.lower(Hero.name) == data["hero"].lower()).one_or_none()
        if not hero:
            raise ActionError("The hero no longer exists.")
        target_id = hero.id
        raw_fields = {field: getattr(hero, field) for field in data["changes"]}
        before = {
            "hero": hero.name,
            "fields": {key: loads(value, []) if key in LIST_FIELDS else value for key, value in raw_fields.items()},
            "_raw": raw_fields,
        }
    elif envelope.kind == "create_hero":
        if db.query(Hero.id).filter(func.lower(Hero.name) == data["name"].lower()).first():
            raise ActionError("A hero with that name already exists.")
        before = {
            "notice": "New local hero records use placeholder rates 50/5/5, rating 5 and difficulty 5 until edited."
        }
    elif envelope.kind == "set_patch":
        row = db.get(PlatformPatch, 1)
        before = {
            "label": row.label if row else CURRENT_PATCH,
            "revision": row.revision if row else None,
            "source": "admin-reviewed label" if row else "server configuration",
        }
    elif envelope.kind == "create_item":
        if db.query(TeamEquipment.id).filter(func.lower(TeamEquipment.name) == data["name"].lower()).first():
            raise ActionError("A team equipment record with that name already exists.")
    raw_payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    if len(raw_payload.encode("utf-8")) > 24000:
        raise ActionError("The proposal is too large.")
    proposal = AIActionProposal(
        owner_id=owner.id,
        conversation_id=message.conversation_id,
        message_id=message.id,
        kind=envelope.kind,
        status="pending",
        payload_json=raw_payload,
        before_json=dumps(before),
        target_id=target_id,
        expires_at=utcnow() + timedelta(days=7),
    )
    db.add(proposal)
    db.flush()
    return proposal


def proposal_json(row: AIActionProposal) -> dict:
    before = loads(row.before_json, {})
    before = {k: v for k, v in before.items() if not k.startswith("_")} if isinstance(before, dict) else {}
    return {
        "id": row.id,
        "kind": row.kind,
        "status": row.status,
        "payload": loads(row.payload_json, {}),
        "before": before,
        "target_id": row.target_id,
        "created_at": row.created_at.isoformat() + "Z",
        "expires_at": row.expires_at.isoformat() + "Z",
        "resolved_at": row.resolved_at.isoformat() + "Z" if row.resolved_at else None,
    }


def apply(db: Session, user: User, proposal_id: str) -> AIActionProposal:
    """Claim and execute one validated action transactionally, or change nothing."""
    if user.role != "admin" or not user.active:
        raise ActionError("Only admins can apply AI proposals.")
    now = utcnow()
    admin_now = exists().where(User.id == user.id, User.role == "admin", User.active.is_(True))
    claimed = db.execute(
        update(AIActionProposal)
        .where(
            AIActionProposal.id == proposal_id,
            AIActionProposal.owner_id == user.id,
            AIActionProposal.status == "pending",
            AIActionProposal.expires_at > now,
            admin_now,
        )
        .values(status="applying")
    )
    if not claimed.rowcount:
        db.rollback()
        raise ActionError("Proposal is unavailable, expired, already resolved or no longer authorized.")
    row = db.get(AIActionProposal, proposal_id)
    try:
        data = validate_payload(db, row.kind, loads(row.payload_json, {}))
        if data != loads(row.payload_json, {}):
            raise ActionError("The saved proposal no longer matches available data; request a new one.")
        before = loads(row.before_json, {})
        target_id = row.target_id
        after: dict[str, Any] = data
        if row.kind == "create_draft":
            target = DraftPlan(
                name=data["name"],
                opponent=data["opponent"],
                patch=data["patch"],
                notes=data["notes"],
                draft=dumps(data["draft"]),
                status="idea",
                created_by=user.id,
            )
            db.add(target)
            db.flush()
            target_id = target.id
        elif row.kind == "create_strategy":
            target = StrategyNote(
                title=data["title"],
                category=data["category"],
                body=data["body"],
                opponent=data["opponent"],
                patch=data["patch"],
                tags=dumps(data["tags"]),
                pinned=False,
                author_id=user.id,
            )
            db.add(target)
            db.flush()
            target_id = target.id
        elif row.kind == "create_hero":
            if db.query(Hero.id).filter(func.lower(Hero.name) == data["name"].lower()).first():
                raise ActionError("A hero with that name already exists.")
            target = Hero(
                **data,
                difficulty=5,
                meta_status="VIABLE",
                tier="A",
                win_rate=50.0,
                pick_rate=5.0,
                ban_rate=5.0,
                clover_rating=5.0,
            )
            db.add(target)
            db.flush()
            target_id = target.id
        elif row.kind == "update_hero":
            raw_before = before.get("_raw", {})
            conditions = [Hero.id == target_id, Hero.name == before.get("hero")]
            conditions.extend(getattr(Hero, field) == value for field, value in raw_before.items())
            changes = {
                field: dumps(value) if field in LIST_FIELDS else value for field, value in data["changes"].items()
            }
            result = db.execute(update(Hero).where(*conditions).values(**changes))
            if not result.rowcount:
                raise ActionError("The hero changed after this proposal. Review a new proposal instead.")
            before = {k: v for k, v in before.items() if k != "_raw"}
        elif row.kind == "set_patch":
            current = db.get(PlatformPatch, 1)
            revision = before.get("revision")
            if revision is None:
                if current is not None:
                    raise ActionError("The patch label changed after this proposal.")
                db.add(PlatformPatch(id=1, label=data["label"], revision=1, updated_by=user.id, updated_at=now))
            else:
                result = db.execute(
                    update(PlatformPatch)
                    .where(
                        PlatformPatch.id == 1,
                        PlatformPatch.revision == revision,
                        PlatformPatch.label == before.get("label"),
                    )
                    .values(label=data["label"], revision=revision + 1, updated_by=user.id, updated_at=now)
                )
                if not result.rowcount:
                    raise ActionError("The patch label changed after this proposal.")
            target_id = 1
        elif row.kind == "create_item":
            if db.query(TeamEquipment.id).filter(func.lower(TeamEquipment.name) == data["name"].lower()).first():
                raise ActionError("A team equipment record with that name already exists.")
            target = TeamEquipment(**data, created_by=user.id)
            db.add(target)
            db.flush()
            target_id = target.id
        else:
            raise ActionError("This action is not supported.")
        row.status = "applied"
        row.target_id = target_id
        row.resolved_at = now
        db.add(
            AIActionAudit(
                proposal_id=row.id,
                actor_id=user.id,
                kind=row.kind,
                target_id=target_id,
                before_json=dumps(before),
                after_json=dumps(after),
                created_at=now,
            )
        )
        db.commit()
        db.refresh(row)
        return row
    except (ActionError, IntegrityError):
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
