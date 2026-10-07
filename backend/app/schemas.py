"""Inbound payloads (Pydantic)."""
from __future__ import annotations

from datetime import date as dt_date
from typing import Any, Literal

from pydantic import BaseModel, Field


class LoginIn(BaseModel):
    email: str
    password: str


class UserIn(BaseModel):
    email: str
    name: str
    ign: str = ""
    role: Literal["admin", "captain", "coach", "player", "analyst"] = "player"
    main_role: str = ""
    bio: str = ""
    password: str = ""
    active: bool = True
    roster: bool = False


class UserPatch(BaseModel):
    email: str | None = None
    name: str | None = None
    ign: str | None = None
    role: str | None = None
    main_role: str | None = None
    bio: str | None = None
    password: str | None = None
    active: bool | None = None
    roster: bool | None = None


class WeekIn(BaseModel):
    number: int
    focus: str
    objective: str = ""
    performance_target: str = ""
    notes: str = ""
    start_date: dt_date | None = None
    end_date: dt_date | None = None
    status: str = "planned"
    weakness_text: str = ""
    weakness_drills_target: int = 0


class WeekPatch(BaseModel):
    number: int | None = None
    focus: str | None = None
    objective: str | None = None
    performance_target: str | None = None
    notes: str | None = None
    start_date: dt_date | None = None
    end_date: dt_date | None = None
    status: str | None = None
    weakness_text: str | None = None
    weakness_drills_target: int | None = None


class ActivityIn(BaseModel):
    week_id: int | None = None
    title: str
    description: str = ""
    category: str = "MACRO"
    date: dt_date | None = None
    time: str = ""
    duration_min: int = 60
    coach_name: str = ""
    assigned_player_ids: list[int] = Field(default_factory=list)
    required: bool = True
    status: str = "scheduled"
    notes: str = ""
    attachments: list[dict[str, Any]] = Field(default_factory=list)
    result: str = ""
    score: str = ""
    lessons: str = ""
    scrim_id: int | None = None


class ActivityPatch(BaseModel):
    week_id: int | None = None
    title: str | None = None
    description: str | None = None
    category: str | None = None
    date: dt_date | None = None
    time: str | None = None
    duration_min: int | None = None
    coach_name: str | None = None
    assigned_player_ids: list[int] | None = None
    required: bool | None = None
    status: str | None = None
    notes: str | None = None
    attachments: list[dict[str, Any]] | None = None
    result: str | None = None
    score: str | None = None
    lessons: str | None = None
    scrim_id: int | None = None


class ScrimIn(BaseModel):
    opponent: str
    date: dt_date | None = None
    time: str = ""
    format: str = "BO3"
    server: str = ""
    tournament_prep: bool = False
    lineup: dict[str, int | None] = Field(default_factory=dict)
    substitutes: list[int] = Field(default_factory=list)
    notes: str = ""
    expected_strategy: str = ""


class ScrimPatch(BaseModel):
    opponent: str | None = None
    date: dt_date | None = None
    time: str | None = None
    format: str | None = None
    server: str | None = None
    tournament_prep: bool | None = None
    lineup: dict[str, int | None] | None = None
    substitutes: list[int] | None = None
    notes: str | None = None
    expected_strategy: str | None = None
    status: str | None = None
    result: str | None = None
    attachments: list[dict[str, Any]] | None = None


class GameIn(BaseModel):
    game_no: int
    result: str = ""
    duration_min: float = 0
    stats: dict[str, Any] = Field(default_factory=dict)
    draft: dict[str, Any] = Field(default_factory=dict)


class ReviewIn(BaseModel):
    scrim_id: int | None = None
    tournament_match_id: int | None = None
    opponent: str = ""
    date: dt_date | None = None
    duration_min: float = 0
    result: str = "LOSS"
    player_ids: list[int] = Field(default_factory=list)
    stats: dict[str, Any] = Field(default_factory=dict)
    draft: dict[str, Any] = Field(default_factory=dict)
    biggest_mistakes: list[str] = Field(default_factory=list)
    why_happened: str = ""
    should_have_done: str = ""
    who_involved: str = ""
    what_change: str = ""
    lesson: str = ""
    action_item: str = ""
    action_assignee_id: int | None = None
    action_deadline: dt_date | None = None
    status: str = "open"


class ReviewPatch(BaseModel):
    opponent: str | None = None
    date: dt_date | None = None
    duration_min: float | None = None
    result: str | None = None
    player_ids: list[int] | None = None
    stats: dict[str, Any] | None = None
    draft: dict[str, Any] | None = None
    biggest_mistakes: list[str] | None = None
    why_happened: str | None = None
    should_have_done: str | None = None
    who_involved: str | None = None
    what_change: str | None = None
    lesson: str | None = None
    action_item: str | None = None
    action_assignee_id: int | None = None
    action_deadline: dt_date | None = None
    status: str | None = None


class HeroIn(BaseModel):
    name: str
    role: str = "EXP"
    hero_class: str = ""
    difficulty: int = 5
    meta_status: str = "VIABLE"
    tier: str = "A"
    patch: str = ""
    win_rate: float = 50.0
    pick_rate: float = 5.0
    ban_rate: float = 5.0
    clover_rating: float = 5.0
    notes: str = ""
    strong_against: list[str] = Field(default_factory=list)
    weak_against: list[str] = Field(default_factory=list)
    synergy: list[str] = Field(default_factory=list)


class HeroPatch(BaseModel):
    name: str | None = None
    role: str | None = None
    hero_class: str | None = None
    difficulty: int | None = None
    meta_status: str | None = None
    tier: str | None = None
    patch: str | None = None
    win_rate: float | None = None
    pick_rate: float | None = None
    ban_rate: float | None = None
    clover_rating: float | None = None
    notes: str | None = None
    strong_against: list[str] | None = None
    weak_against: list[str] | None = None
    synergy: list[str] | None = None


class PoolIn(BaseModel):
    hero_id: int
    category: str = "comfort"
    confidence: int = 5
    last_played: dt_date | None = None
    games: int = 0
    wins: int = 0
    losses: int = 0
    coach_notes: str = ""


class PoolPatch(BaseModel):
    category: str | None = None
    confidence: int | None = None
    last_played: dt_date | None = None
    games: int | None = None
    wins: int | None = None
    losses: int | None = None
    coach_notes: str | None = None


class DevIn(BaseModel):
    source: str = "coach"
    category: str = "GENERAL"
    rating: int | None = None
    notes: str = ""
    date: dt_date | None = None


class BanIn(BaseModel):
    scope: str = "standard"
    priority: int | None = None
    opponent: str = ""
    patch: str = ""
    hero_id: int | None = None
    hero_name: str = ""
    reason: str = ""
    active: bool = True


class BanPatch(BaseModel):
    scope: str | None = None
    priority: int | None = None
    opponent: str | None = None
    patch: str | None = None
    hero_id: int | None = None
    hero_name: str | None = None
    reason: str | None = None
    active: bool | None = None


class EventIn(BaseModel):
    title: str
    kind: str = "other"
    date: dt_date | None = None
    time: str = ""
    end_time: str = ""
    location: str = ""
    description: str = ""
    link: str = ""
    scrim_id: int | None = None


class EventPatch(BaseModel):
    title: str | None = None
    kind: str | None = None
    date: dt_date | None = None
    time: str | None = None
    end_time: str | None = None
    location: str | None = None
    description: str | None = None
    link: str | None = None
    scrim_id: int | None = None


class StrategyIn(BaseModel):
    title: str
    category: str = "GENERAL"
    body: str = ""
    tags: list[str] = Field(default_factory=list)
    opponent: str = ""
    patch: str = ""
    pinned: bool = False


class StrategyPatch(BaseModel):
    title: str | None = None
    category: str | None = None
    body: str | None = None
    tags: list[str] | None = None
    opponent: str | None = None
    patch: str | None = None
    pinned: bool | None = None


class DraftIn(BaseModel):
    name: str
    opponent: str = ""
    patch: str = ""
    notes: str = ""
    draft: dict[str, Any] = Field(default_factory=dict)
    status: str = "idea"


class DraftPatch(BaseModel):
    name: str | None = None
    opponent: str | None = None
    patch: str | None = None
    notes: str | None = None
    draft: dict[str, Any] | None = None
    status: str | None = None


class SettingsPatch(BaseModel):
    current_weakness: str | None = None
    weakness_category: str | None = None
    weakness_drills_target: int | None = None
    season_name: str | None = None


class UserSelfPatch(BaseModel):
    name: str | None = None
    ign: str | None = None
    main_role: str | None = None
    bio: str | None = None


class MapBoardIn(BaseModel):
    name: str
    kind: Literal["draft", "strategy", "scrim-review"] = "strategy"
    opponent: str = ""
    draft_id: int | None = None
    data: dict[str, Any] | None = None
    notes: str = ""


class MapBoardPatch(BaseModel):
    name: str | None = None
    kind: Literal["draft", "strategy", "scrim-review"] | None = None
    opponent: str | None = None
    data: dict[str, Any] | None = None
    notes: str | None = None
    draft_id: int | None = None
