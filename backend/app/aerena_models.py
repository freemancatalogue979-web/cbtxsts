"""Persisted public esports facts and source provenance, separate from private team data."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base
from .models import utcnow


class AerenaSyncState(Base):
    __tablename__ = "aerena_sync_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    last_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str] = mapped_column(Text, default="")
    phase: Mapped[str] = mapped_column(String(120), default="")
    lease_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    lease_owner: Mapped[str] = mapped_column(String(36), default="")
    requested_league: Mapped[str] = mapped_column(String(80), default="")
    requested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AerenaSeries(Base):
    __tablename__ = "aerena_series"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    code: Mapped[str] = mapped_column(String(100), index=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    region: Mapped[str] = mapped_column(String(30), default="")
    kind: Mapped[str] = mapped_column(String(50), default="")
    logo: Mapped[str] = mapped_column(Text, default="")
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AerenaLeague(Base):
    __tablename__ = "aerena_leagues"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    series_id: Mapped[str] = mapped_column(String(80), default="", index=True)
    code: Mapped[str] = mapped_column(String(100), index=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    region: Mapped[str] = mapped_column(String(30), default="")
    logo: Mapped[str] = mapped_column(Text, default="")
    starts_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_pro: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    stages_json: Mapped[str] = mapped_column(Text, default="[]")
    draft_sequence_json: Mapped[str] = mapped_column(Text, default="{}")
    raw_json: Mapped[str] = mapped_column(Text, default="{}")
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    matches_fetched_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    matches_error: Mapped[str] = mapped_column(Text, default="")


class AerenaHero(Base):
    __tablename__ = "aerena_heroes"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), index=True)
    roles_json: Mapped[str] = mapped_column(Text, default="[]")
    positions_json: Mapped[str] = mapped_column(Text, default="[]")
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AerenaMatch(Base):
    __tablename__ = "aerena_matches"

    id: Mapped[str] = mapped_column(String(120), primary_key=True)  # Aerena's public matchId
    source_id: Mapped[str] = mapped_column(String(80), index=True)  # Aerena's Mongo id
    league_id: Mapped[str] = mapped_column(String(80), index=True)
    stage: Mapped[str] = mapped_column(String(120), default="")
    format: Mapped[str] = mapped_column(String(30), default="")
    starts_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    team1_json: Mapped[str] = mapped_column(Text, default="{}")
    team2_json: Mapped[str] = mapped_column(Text, default="{}")
    team1_name: Mapped[str] = mapped_column(String(180), default="", index=True)
    team2_name: Mapped[str] = mapped_column(String(180), default="", index=True)
    winner_json: Mapped[str] = mapped_column(Text, default="{}")
    is_draw: Mapped[bool] = mapped_column(Boolean, default=False)
    has_result: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    source_verified: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    game_count: Mapped[int] = mapped_column(Integer, default=0)
    draft_event_count: Mapped[int] = mapped_column(Integer, default=0)
    raw_json: Mapped[str] = mapped_column(Text, default="{}")
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    detail_attempted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    detail_fetched_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    detail_error: Mapped[str] = mapped_column(Text, default="")


class AerenaGame(Base):
    __tablename__ = "aerena_games"
    __table_args__ = (UniqueConstraint("match_id", "number", name="uq_aerena_match_game"),)

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    match_id: Mapped[str] = mapped_column(String(120), index=True)
    number: Mapped[int] = mapped_column(Integer)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    team1_json: Mapped[str] = mapped_column(Text, default="{}")
    team2_json: Mapped[str] = mapped_column(Text, default="{}")
    winner_json: Mapped[str] = mapped_column(Text, default="{}")
    mvp_json: Mapped[str] = mapped_column(Text, default="{}")
    draft_coverage: Mapped[str] = mapped_column(String(20), default="none")
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AerenaDraftEvent(Base):
    __tablename__ = "aerena_draft_events"
    __table_args__ = (UniqueConstraint("game_id", "kind", "source_order", name="uq_aerena_game_draft_order"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    game_id: Mapped[str] = mapped_column(String(80), index=True)
    match_id: Mapped[str] = mapped_column(String(120), index=True)
    kind: Mapped[str] = mapped_column(String(10))
    source_order: Mapped[int] = mapped_column(Integer)
    # Combined order is set only for complete, validated standard-format drafts.
    sequence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    side: Mapped[str | None] = mapped_column(String(8), nullable=True)
    hero_id: Mapped[str] = mapped_column(String(80))
    player_id: Mapped[str] = mapped_column(String(80), default="")
    player_ign: Mapped[str] = mapped_column(String(100), default="")
    position: Mapped[str] = mapped_column(String(30), default="")
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AerenaPlayerGameStat(Base):
    __tablename__ = "aerena_player_game_stats"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    match_id: Mapped[str] = mapped_column(String(120), index=True)
    game_number: Mapped[int] = mapped_column(Integer, index=True)
    team_id: Mapped[str] = mapped_column(String(80), default="")
    player_id: Mapped[str] = mapped_column(String(80), default="")
    hero_id: Mapped[str] = mapped_column(String(80), default="")
    ign: Mapped[str] = mapped_column(String(100), default="")
    position: Mapped[str] = mapped_column(String(30), default="")
    raw_json: Mapped[str] = mapped_column(Text, default="{}")
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AerenaSnapshot(Base):
    """A changed upstream observation, kept even if Aerena later revises it."""
    __tablename__ = "aerena_snapshots"
    __table_args__ = (Index("ix_aerena_snapshot_source", "kind", "external_id", "id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(20))
    external_id: Mapped[str] = mapped_column(String(120))
    sha256: Mapped[str] = mapped_column(String(64))
    payload_json: Mapped[str] = mapped_column(Text)
    observed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AerenaAIUsage(Base):
    __tablename__ = "aerena_ai_usage"
    __table_args__ = (UniqueConstraint("user_id", "day", name="uq_aerena_ai_user_day"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    day: Mapped[str] = mapped_column(String(10))  # UTC date
    calls: Mapped[int] = mapped_column(Integer, default=0)
