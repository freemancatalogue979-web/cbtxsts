"""Database models for the 9 CLOVER competitive operations hub.

PLAY → RECORD → REVIEW → IDENTIFY → TRAIN → APPLY → IMPROVE
"""
from __future__ import annotations

import json
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def loads(raw: str | None, default: Any = None) -> Any:
    if not raw:
        return [] if default is None else default
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return [] if default is None else default


# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(190), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(120))
    ign: Mapped[str] = mapped_column(String(60), default="")
    role: Mapped[str] = mapped_column(String(20), index=True)  # admin/captain/coach/player/analyst
    main_role: Mapped[str] = mapped_column(String(20), default="")  # EXP/JUNGLE/MID/GOLD/ROAM
    bio: Mapped[str] = mapped_column(Text, default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    roster: Mapped[bool] = mapped_column(Boolean, default=False)  # shows on Players page
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    pool: Mapped[list["HeroPoolEntry"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", order_by="HeroPoolEntry.category"
    )


class DevelopmentEntry(Base):
    """Player development tracker — coach ratings and player self-reviews."""

    __tablename__ = "development_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    entry_date: Mapped[date] = mapped_column(Date, default=date.today)
    source: Mapped[str] = mapped_column(String(20), default="coach")  # coach | self
    category: Mapped[str] = mapped_column(String(40), default="GENERAL")
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 0-10
    notes: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


# ---------------------------------------------------------------------------
# Heroes
# ---------------------------------------------------------------------------
class Hero(Base):
    __tablename__ = "heroes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(20), index=True)  # EXP/JUNGLE/MID/GOLD/ROAM
    hero_class: Mapped[str] = mapped_column(String(40), default="")
    difficulty: Mapped[int] = mapped_column(Integer, default=5)  # 1-10
    meta_status: Mapped[str] = mapped_column(String(20), default="VIABLE", index=True)
    tier: Mapped[str] = mapped_column(String(4), default="A")
    patch: Mapped[str] = mapped_column(String(20), default="")
    win_rate: Mapped[float] = mapped_column(Float, default=50.0)
    pick_rate: Mapped[float] = mapped_column(Float, default=5.0)
    ban_rate: Mapped[float] = mapped_column(Float, default=5.0)
    clover_rating: Mapped[float] = mapped_column(Float, default=5.0)  # 9 CLOVER internal 0-10
    notes: Mapped[str] = mapped_column(Text, default="")
    strong_against: Mapped[str] = mapped_column(Text, default="[]")  # JSON [hero names]
    weak_against: Mapped[str] = mapped_column(Text, default="[]")
    synergy: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class HeroPoolEntry(Base):
    """A player's hero pool — comfort / meta / pocket / emergency picks."""

    __tablename__ = "hero_pool"
    __table_args__ = (UniqueConstraint("user_id", "hero_id", "category", name="uq_pool_user_hero_cat"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    hero_id: Mapped[int] = mapped_column(ForeignKey("heroes.id", ondelete="CASCADE"), index=True)
    category: Mapped[str] = mapped_column(String(20), default="comfort")  # comfort|meta|pocket|emergency
    confidence: Mapped[int] = mapped_column(Integer, default=5)  # 0-10
    last_played: Mapped[date | None] = mapped_column(Date, nullable=True)
    games: Mapped[int] = mapped_column(Integer, default=0)
    wins: Mapped[int] = mapped_column(Integer, default=0)
    losses: Mapped[int] = mapped_column(Integer, default=0)
    coach_notes: Mapped[str] = mapped_column(Text, default="")

    user: Mapped[User] = relationship(back_populates="pool")
    hero: Mapped[Hero] = relationship()


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------
class TrainingWeek(Base):
    __tablename__ = "training_weeks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    number: Mapped[int] = mapped_column(Integer, unique=True)
    focus: Mapped[str] = mapped_column(String(80))
    objective: Mapped[str] = mapped_column(Text, default="")
    performance_target: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="planned")  # planned|active|completed
    weakness_text: Mapped[str] = mapped_column(String(160), default="")
    weakness_drills_target: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    activities: Mapped[list["TrainingActivity"]] = relationship(back_populates="week")


ACTIVITY_CATEGORIES = [
    "ROLE DRILL",
    "OBJECTIVE DRILL",
    "DRAFT",
    "COMMUNICATION",
    "SCENARIO",
    "SCRIM",
    "MATCH REVIEW",
    "HERO TRAINING",
    "TEAM FIGHT",
    "ROTATION",
    "MACRO",
    "MICRO",
    "MENTAL",
    "TOURNAMENT PREPARATION",
]

ACTIVITY_STATUSES = ["scheduled", "in-progress", "done", "missed", "cancelled"]


class TrainingActivity(Base):
    __tablename__ = "training_activities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    week_id: Mapped[int | None] = mapped_column(ForeignKey("training_weeks.id", ondelete="SET NULL"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(40), index=True)
    activity_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    start_time: Mapped[str] = mapped_column(String(8), default="")
    duration_min: Mapped[int] = mapped_column(Integer, default=60)
    coach_name: Mapped[str] = mapped_column(String(120), default="")
    assigned_player_ids: Mapped[str] = mapped_column(Text, default="[]")  # JSON [user ids]
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(20), default="scheduled", index=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    attachments: Mapped[str] = mapped_column(Text, default="[]")  # JSON [{label,url,kind}]
    result: Mapped[str] = mapped_column(Text, default="")
    score: Mapped[str] = mapped_column(String(40), default="")
    lessons: Mapped[str] = mapped_column(Text, default="")
    scrim_id: Mapped[int | None] = mapped_column(ForeignKey("scrims.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    week: Mapped[TrainingWeek | None] = relationship(back_populates="activities")


# ---------------------------------------------------------------------------
# Training programs: activity (program) → weeks/tasks → per-player progress
# ---------------------------------------------------------------------------
class TrainingProgram(Base):
    __tablename__ = "training_programs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    focus: Mapped[str] = mapped_column(String(60), default="")      # e.g. EXP fundamentals, Macro, Team fight
    description: Mapped[str] = mapped_column(Text, default="")
    enrolled_ids: Mapped[str] = mapped_column(Text, default="[]")   # JSON [user ids]
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)  # active | archived
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    weeks: Mapped[list["ProgramWeek"]] = relationship(back_populates="program",
        cascade="all, delete-orphan", order_by="ProgramWeek.number")


class ProgramWeek(Base):
    __tablename__ = "program_weeks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    program_id: Mapped[int] = mapped_column(Integer, ForeignKey("training_programs.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, default="")
    attachments: Mapped[str] = mapped_column(Text, default="[]")  # JSON [{label,url,kind}]
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    program: Mapped[TrainingProgram] = relationship(back_populates="weeks")
    progress_rows: Mapped[list["WeekProgress"]] = relationship(back_populates="week",
        cascade="all, delete-orphan")


class WeekProgress(Base):
    __tablename__ = "week_progress"
    __table_args__ = (UniqueConstraint("week_id", "user_id", name="uq_week_progress"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    week_id: Mapped[int] = mapped_column(Integer, ForeignKey("program_weeks.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending | done
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    marked_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    week: Mapped[ProgramWeek] = relationship(back_populates="progress_rows")


# ---------------------------------------------------------------------------
# Scrims & reviews
# ---------------------------------------------------------------------------
class Scrim(Base):
    __tablename__ = "scrims"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    number: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    opponent: Mapped[str] = mapped_column(String(120), index=True)
    scrim_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    start_time: Mapped[str] = mapped_column(String(8), default="")
    format: Mapped[str] = mapped_column(String(8), default="BO3")  # BO1/BO3/BO5
    server: Mapped[str] = mapped_column(String(40), default="")
    tournament_prep: Mapped[bool] = mapped_column(Boolean, default=False)
    lineup: Mapped[str] = mapped_column(Text, default="{}")  # JSON {LANE: user_id}
    substitutes: Mapped[str] = mapped_column(Text, default="[]")  # JSON [user_id]
    notes: Mapped[str] = mapped_column(Text, default="")
    expected_strategy: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="scheduled", index=True)  # scheduled|played|cancelled
    result: Mapped[str] = mapped_column(String(8), default="", index=True)  # WIN|LOSS|DRAW|""
    score_us: Mapped[int] = mapped_column(Integer, default=0)
    score_them: Mapped[int] = mapped_column(Integer, default=0)
    attachments: Mapped[str] = mapped_column(Text, default="[]")  # JSON [{kind,label,url}]
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    games: Mapped[list["ScrimGame"]] = relationship(
        back_populates="scrim", cascade="all, delete-orphan", order_by="ScrimGame.game_no"
    )
    review: Mapped["MatchReview | None"] = relationship(back_populates="scrim", uselist=False)


class ScrimGame(Base):
    __tablename__ = "scrim_games"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scrim_id: Mapped[int] = mapped_column(ForeignKey("scrims.id", ondelete="CASCADE"), index=True)
    game_no: Mapped[int] = mapped_column(Integer)
    result: Mapped[str] = mapped_column(String(8), default="")  # WIN|LOSS
    duration_min: Mapped[float] = mapped_column(Float, default=0)
    stats: Mapped[str] = mapped_column(Text, default="{}")  # JSON full stat sheet
    draft: Mapped[str] = mapped_column(Text, default="{}")  # JSON bans/picks

    scrim: Mapped[Scrim] = relationship(back_populates="games")


class MatchReview(Base):
    """Mandatory after every lost competitive game: NO REVIEW, NO NEXT SCRIM."""

    __tablename__ = "match_reviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scrim_id: Mapped[int | None] = mapped_column(ForeignKey("scrims.id", ondelete="SET NULL"), nullable=True, unique=True)
    opponent: Mapped[str] = mapped_column(String(120), default="")
    review_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    duration_min: Mapped[float] = mapped_column(Float, default=0)
    result: Mapped[str] = mapped_column(String(8), default="LOSS")
    player_ids: Mapped[str] = mapped_column(Text, default="[]")  # JSON [user ids]
    stats: Mapped[str] = mapped_column(Text, default="{}")  # JSON team stat lines
    draft: Mapped[str] = mapped_column(Text, default="{}")  # JSON {our_bans:[5], enemy_bans:[5], our_picks:{}, enemy_picks:{}}
    biggest_mistakes: Mapped[str] = mapped_column(Text, default="[]")  # JSON [mistake strings]
    why_happened: Mapped[str] = mapped_column(Text, default="")
    should_have_done: Mapped[str] = mapped_column(Text, default="")
    who_involved: Mapped[str] = mapped_column(Text, default="")
    what_change: Mapped[str] = mapped_column(Text, default="")
    lesson: Mapped[str] = mapped_column(Text, default="")
    action_item: Mapped[str] = mapped_column(Text, default="")
    action_assignee_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    action_deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)  # open|in_progress|resolved
    mandatory: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    scrim: Mapped[Scrim | None] = relationship(back_populates="review")


# ---------------------------------------------------------------------------
# Strategy, drafts, bans
# ---------------------------------------------------------------------------
class StrategyNote(Base):
    """Tactical knowledge base / strategy planner."""

    __tablename__ = "strategy_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(160))
    category: Mapped[str] = mapped_column(String(40), default="GENERAL", index=True)
    body: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[str] = mapped_column(Text, default="[]")  # JSON [tags]
    opponent: Mapped[str] = mapped_column(String(120), default="", index=True)
    patch: Mapped[str] = mapped_column(String(20), default="")
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    author_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    actor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    kind: Mapped[str] = mapped_column(String(20), default="announcement", index=True)  # announcement | reminder
    title: Mapped[str] = mapped_column(String(160), default="")
    body: Mapped[str] = mapped_column(Text)
    link: Mapped[str] = mapped_column(String(200), default="")
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class MapBoard(Base):
    """Tactical Land-of-Dawn board: draggable hero tokens + freehand drawing.

    data JSON: {"tokens":[{"id","hero","side","x","y"}],
                "paths":[{"color","points":[[x,y],...],}], "text":[{"x","y","t"}]}
    """

    __tablename__ = "map_boards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    kind: Mapped[str] = mapped_column(String(20), default="strategy", index=True)  # draft|strategy|scrim-review
    opponent: Mapped[str] = mapped_column(String(120), default="", index=True)
    draft_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    data: Mapped[str] = mapped_column(Text, default="{}")
    notes: Mapped[str] = mapped_column(Text, default="")
    author_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


STRATEGY_CATEGORIES = [
    "COMPOSITION",
    "MACRO",
    "OBJECTIVE",
    "TEAMFIGHT",
    "DRAFT",
    "ROTATION",
    "OPPONENT FILE",
    "META",
    "GENERAL",
]


class DraftPlan(Base):
    """Draft simulator boards: bans/picks per side, testable against opponents."""

    __tablename__ = "draft_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    opponent: Mapped[str] = mapped_column(String(120), default="")
    patch: Mapped[str] = mapped_column(String(20), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    draft: Mapped[str] = mapped_column(Text, default="{}")  # JSON {our_bans:[5], enemy_bans:[5], our_picks:{LANE}, enemy_picks:{LANE}}
    status: Mapped[str] = mapped_column(String(20), default="idea")  # idea|testing|approved|archived
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class BanEntry(Base):
    __tablename__ = "ban_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scope: Mapped[str] = mapped_column(String(20), index=True)  # standard|opponent|patch
    priority: Mapped[int | None] = mapped_column(Integer, nullable=True)  # standard bans: 1..3
    opponent: Mapped[str] = mapped_column(String(120), default="", index=True)
    patch: Mapped[str] = mapped_column(String(20), default="")
    hero_id: Mapped[int | None] = mapped_column(ForeignKey("heroes.id", ondelete="SET NULL"), nullable=True)
    hero_name: Mapped[str] = mapped_column(String(80), default="")
    reason: Mapped[str] = mapped_column(Text, default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


# ---------------------------------------------------------------------------
# Calendar / team state
# ---------------------------------------------------------------------------
class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(160))
    kind: Mapped[str] = mapped_column(String(24), default="other", index=True)  # tournament|scrim|training|review|meeting|other
    event_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    start_time: Mapped[str] = mapped_column(String(8), default="")
    end_time: Mapped[str] = mapped_column(String(8), default="")
    location: Mapped[str] = mapped_column(String(120), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str] = mapped_column(String(255), default="")
    scrim_id: Mapped[int | None] = mapped_column(ForeignKey("scrims.id", ondelete="SET NULL"), nullable=True)
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


EVENT_KINDS = ["tournament", "scrim", "training", "review", "meeting", "deadline", "other"]


class TeamSettings(Base):
    """Singleton row: current weakness, focus and dashboard state."""

    __tablename__ = "team_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    current_weakness: Mapped[str] = mapped_column(String(160), default="")
    weakness_category: Mapped[str] = mapped_column(String(40), default="MACRO")
    weakness_drills_target: Mapped[int] = mapped_column(Integer, default=3)
    season_name: Mapped[str] = mapped_column(String(80), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
