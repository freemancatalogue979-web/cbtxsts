"""Persisted, bounded snapshots of public and owner-scoped MLBB data.

A snapshot is source data, not verified current truth. Public reference feeds and
private account snapshots are separate; never store account credentials here.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column

from .db import Base
from .models import utcnow

MAX_SNAPSHOT_BYTES = 2_000_000
MAX_PUBLIC_SNAPSHOTS = 600
MAX_PRIVATE_SNAPSHOTS = 30
REFRESH_LEASE_SECONDS = 60
RETRY_SECONDS = 60


class IntelAccountGeneration(Base):
    """A revocable namespace for one linked account, including legacy links."""

    __tablename__ = "intel_account_generations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    link_id: Mapped[int] = mapped_column(ForeignKey("intel_links.id", ondelete="CASCADE"), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class IntelSnapshot(Base):
    __tablename__ = "intel_snapshots"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    scope: Mapped[str] = mapped_column(String(12), index=True, nullable=False)  # public | account
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=True)
    generation_id: Mapped[str | None] = mapped_column(
        ForeignKey("intel_account_generations.id", ondelete="CASCADE"), index=True, nullable=True
    )
    path: Mapped[str] = mapped_column(String(256), index=True, nullable=False)
    query: Mapped[str] = mapped_column(String(2048), default="", nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True, nullable=False)
    attempted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    lease_token: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    last_error: Mapped[str] = mapped_column(String(160), default="", nullable=False)


def snapshot_key(
    scope: str, path: str, query: str = "", owner_id: int | None = None, generation_id: str | None = None
) -> str:
    raw = json.dumps([scope, owner_id, generation_id, path, query], separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def cache_payload(payload: Any) -> str:
    if not isinstance(payload, (dict, list)):
        raise ValueError("Source response is not a JSON object or list.")
    if isinstance(payload, dict) and payload.get("code", 0) not in (0, None):
        raise ValueError("Source did not return a successful response.")
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    if len(raw.encode("utf-8")) > MAX_SNAPSHOT_BYTES:
        raise ValueError("Source response is too large to cache.")
    return raw


def save_snapshot(
    db: Session,
    scope: str,
    path: str,
    query: str,
    payload: Any,
    *,
    owner_id: int | None = None,
    generation_id: str | None = None,
) -> IntelSnapshot:
    """Save only a validated successful response; a failed refresh keeps the old snapshot."""
    if (
        scope not in {"public", "account"}
        or (scope == "public") != (owner_id is None)
        or (scope == "public") != (generation_id is None)
    ):
        raise ValueError("Invalid snapshot scope.")
    if not path or len(path) > 256 or len(query) > 2048:
        raise ValueError("Snapshot key is too long.")
    if (
        scope == "account"
        and not db.query(IntelAccountGeneration.id).filter_by(id=generation_id, owner_id=owner_id).first()
    ):
        raise ValueError("Linked account changed; snapshot was not saved.")
    raw = cache_payload(payload)
    key = snapshot_key(scope, path, query, owner_id, generation_id)
    row = db.get(IntelSnapshot, key)
    if row is None:
        row = IntelSnapshot(
            key=key,
            scope=scope,
            owner_id=owner_id,
            generation_id=generation_id,
            path=path,
            query=query,
            payload_json=raw,
            observed_at=utcnow(),
        )
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            row = db.get(IntelSnapshot, key)
            if row is None:
                raise
        else:
            _trim(db, scope, owner_id)
            return row
    row.payload_json = raw
    row.observed_at = utcnow()
    row.last_error = ""
    row.lease_until = None
    row.lease_token = ""
    db.commit()
    _trim(db, scope, owner_id)
    return row


def _trim(db: Session, scope: str, owner_id: int | None) -> None:
    limit = MAX_PUBLIC_SNAPSHOTS if scope == "public" else MAX_PRIVATE_SNAPSHOTS
    query = (
        db.query(IntelSnapshot.key)
        .filter_by(scope=scope, owner_id=owner_id)
        .order_by(IntelSnapshot.observed_at.desc(), IntelSnapshot.key)
    )
    excess = [key for (key,) in query.offset(limit).all()]
    if excess:
        db.query(IntelSnapshot).filter(IntelSnapshot.key.in_(excess)).delete(synchronize_session=False)
        db.commit()


def claim_refresh(db: Session, key: str, token: str) -> bool:
    """Claim a bounded cross-worker refresh; failures have a short cooldown."""
    now = utcnow()
    result = db.execute(
        update(IntelSnapshot)
        .where(
            IntelSnapshot.key == key,
            (IntelSnapshot.lease_until.is_(None) | (IntelSnapshot.lease_until < now)),
            (
                IntelSnapshot.attempted_at.is_(None)
                | (IntelSnapshot.attempted_at < now - timedelta(seconds=RETRY_SECONDS))
            ),
        )
        .values(lease_token=token, lease_until=now + timedelta(seconds=REFRESH_LEASE_SECONDS), attempted_at=now)
    )
    db.commit()
    return bool(result.rowcount)


def finish_refresh(db: Session, key: str, token: str, payload: Any | None, error: str = "") -> bool:
    """Update only while our lease is current. An error never replaces saved data."""
    now = utcnow()
    values: dict[str, Any] = {"lease_token": "", "lease_until": None}
    if payload is None:
        values["last_error"] = (error or "Refresh failed; saved data retained.")[:160]
    else:
        values.update(payload_json=cache_payload(payload), observed_at=now, last_error="")
    result = db.execute(
        update(IntelSnapshot)
        .where(IntelSnapshot.key == key, IntelSnapshot.lease_token == token, IntelSnapshot.lease_until >= now)
        .values(**values)
    )
    db.commit()
    return bool(result.rowcount)


def decode_snapshot(row: IntelSnapshot) -> Any:
    return json.loads(row.payload_json)
