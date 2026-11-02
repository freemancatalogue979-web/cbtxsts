"""Explicitly maintained platform reference records (not verified live feeds)."""

from __future__ import annotations

from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base
from .models import utcnow


class PlatformPatch(Base):
    """Singleton, manually reviewed patch label; falls back to CLOVER_PATCH."""

    __tablename__ = "platform_patch"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    label: Mapped[str] = mapped_column(String(20), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class TeamEquipment(Base):
    """Team-maintained equipment; never merged into or presented as the Rone feed."""

    __tablename__ = "team_equipment"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    category: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    patch: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    source_url: Mapped[str] = mapped_column(String(2048), default="", nullable=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


# Enforce case-insensitive uniqueness across concurrent admins, not just a pre-check.
Index("uq_team_equipment_name_ci", func.lower(TeamEquipment.name), unique=True)
