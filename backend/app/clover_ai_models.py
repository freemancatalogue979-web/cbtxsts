"""Private member conversations and explicitly reviewed shared AI knowledge.

These are deliberately separate from team drafts, Archive and provider keys.
Application access to conversations is owner-only, including for admins.
"""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base
from .intel_cache import IntelAccountGeneration
from .models import utcnow


def new_id() -> str:
    return uuid4().hex


class AISettings(Base):
    __tablename__ = "clover_ai_settings"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    share_profile: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    share_pool: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    share_scrims: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    use_history: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    coaching_goal: Mapped[str] = mapped_column(String(600), default="", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class AIAccountConsent(Base):
    """Separate, revocable opt-in for private MLBB account statistics."""
    __tablename__ = "clover_ai_account_consent"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    generation_id: Mapped[str] = mapped_column(ForeignKey(IntelAccountGeneration.id, ondelete="CASCADE"), nullable=False)
    share_account_stats: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class AIMemoryNote(Base):
    """A member-authored note; sharing each note is a separate opt-in."""

    __tablename__ = "clover_ai_memory_notes"
    __table_args__ = (
        UniqueConstraint("user_id", "slot", name="uq_ai_memory_user_slot"),
        CheckConstraint("slot >= 0 AND slot < 12", name="ck_ai_memory_slot"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    # A bounded slot and unique constraint enforce the limit even with concurrent requests.
    slot: Mapped[int] = mapped_column(Integer, nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(String(500), nullable=False)
    share_in_context: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class AIWebSearchUsage(Base):
    """A separate daily budget for potentially billable web searches."""

    __tablename__ = "clover_ai_web_search_usage"
    __table_args__ = (UniqueConstraint("user_id", "day", name="uq_ai_web_user_day"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    day: Mapped[str] = mapped_column(String(10), nullable=False)
    calls: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class AIConversation(Base):
    __tablename__ = "clover_ai_conversations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(120), default="New conversation", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True, nullable=False)
    # A short-lived DB lease prevents two workers generating into the same chat.
    busy_token: Mapped[str | None] = mapped_column(String(32), nullable=True)
    busy_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    messages: Mapped[list["AIMessage"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", passive_deletes=True
    )


class AIMessage(Base):
    __tablename__ = "clover_ai_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("clover_ai_conversations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    role: Mapped[str] = mapped_column(String(12), nullable=False)  # user | assistant
    content: Mapped[str] = mapped_column(Text, nullable=False)
    mode: Mapped[str] = mapped_column(
        String(20), default="user", nullable=False
    )  # user | ai | facts; historic values remain readable
    note: Mapped[str] = mapped_column(String(600), default="", nullable=False)
    sources_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    feedback: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # -1 | 0 | 1
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    conversation: Mapped[AIConversation] = relationship(back_populates="messages")


class AIContribution(Base):
    __tablename__ = "clover_ai_contributions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    source_url: Mapped[str] = mapped_column(String(2048), default="", nullable=False)
    fingerprint: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True, nullable=False)
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    review_note: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AIKnowledge(Base):
    __tablename__ = "clover_ai_knowledge"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    # Knowledge stays available if an author later leaves; no author identifiers
    # or review notes are sent to the model.
    contribution_id: Mapped[str | None] = mapped_column(
        ForeignKey("clover_ai_contributions.id", ondelete="SET NULL"), unique=True, nullable=True
    )
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    source_url: Mapped[str] = mapped_column(String(2048), default="", nullable=False)
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
