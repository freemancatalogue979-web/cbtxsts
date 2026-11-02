"""Server-only, encrypted storage for the team's DeepSeek credential.

The database contains ciphertext only. A separate Fernet key is supplied by the
host or generated once in the persistent data directory with restrictive file
permissions. Neither the plaintext nor a partial value is returned to clients.
"""
from __future__ import annotations

import os
import stat
import tempfile
from datetime import datetime
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, Session, mapped_column

from .config import DATA_DIR
from .db import Base
from .models import utcnow

KEY_PATH = DATA_DIR / "credential-encryption.key"
MASTER_KEY_ENV = "CLOVER_CREDENTIAL_ENCRYPTION_KEY"
PROVIDER = "deepseek"


class ProviderCredential(Base):
    """Encrypted credential; separate from generally readable team settings."""

    __tablename__ = "provider_credentials"

    provider: Mapped[str] = mapped_column(String(40), primary_key=True)
    ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class CredentialStorageError(RuntimeError):
    pass


def _create_key_file(path: Path) -> None:
    """Publish a complete key atomically if multiple local workers race."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=".credential-key-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as temp:
            temp.write(Fernet.generate_key())
            temp.flush()
            os.fsync(temp.fileno())
        try:
            # Hard-link publication is atomic and never overwrites another
            # worker's existing key. Both paths live on the same filesystem.
            os.link(temp_name, path)
        except FileExistsError:
            pass
    finally:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass


def _cipher(*, create: bool) -> Fernet:
    """Load the master key without silently replacing one needed for decryption."""
    try:
        supplied = os.getenv(MASTER_KEY_ENV, "").strip()
        if supplied:
            key = supplied.encode("ascii")
        else:
            path = Path(KEY_PATH)
            if create and not path.exists():
                _create_key_file(path)
            info = path.stat()
            if not stat.S_ISREG(info.st_mode):
                raise CredentialStorageError("Credential encryption key is not a regular file.")
            if os.name != "nt" and stat.S_IMODE(info.st_mode) & 0o077:
                raise CredentialStorageError("Credential encryption key permissions must be owner-only.")
            key = path.read_bytes().strip()
        return Fernet(key)
    except CredentialStorageError:
        raise
    except (OSError, UnicodeError, ValueError, TypeError) as exc:
        raise CredentialStorageError("Credential encryption is unavailable; check the server's encryption key and storage.") from exc


def _decrypt(row: ProviderCredential) -> str:
    try:
        return _cipher(create=False).decrypt(row.ciphertext.encode("ascii")).decode("utf-8")
    except CredentialStorageError:
        raise
    except (InvalidToken, UnicodeError, ValueError, TypeError) as exc:
        raise CredentialStorageError("The saved key could not be unlocked. Restore the encryption key or save a new API key.") from exc


def resolved_key(db: Session) -> str | None:
    """Admin-saved key takes precedence; a locked saved key fails closed."""
    row = db.get(ProviderCredential, PROVIDER)
    if row is not None:
        return _decrypt(row)
    return os.getenv("DEEPSEEK_API_KEY", "").strip() or None


def key_status(db: Session) -> dict:
    row = db.get(ProviderCredential, PROVIDER)
    if row is not None:
        try:
            usable = bool(_decrypt(row))
        except CredentialStorageError:
            return {"configured": False, "source": "unavailable", "has_saved_key": True,
                    "updated_at": row.updated_at.isoformat() + "Z", "message": "The saved key cannot be unlocked. Restore the encryption key or save a replacement."}
        return {"configured": usable, "source": "admin", "has_saved_key": True,
                "updated_at": row.updated_at.isoformat() + "Z", "message": None}
    from_env = bool(os.getenv("DEEPSEEK_API_KEY", "").strip())
    return {"configured": from_env, "source": "environment" if from_env else "none", "has_saved_key": False,
            "updated_at": None, "message": None}


def save_key(db: Session, key: str) -> None:
    try:
        ciphertext = _cipher(create=True).encrypt(key.encode("ascii")).decode("ascii")
    except (UnicodeError, ValueError, TypeError) as exc:
        raise CredentialStorageError("Could not encrypt the API key.") from exc
    row = db.get(ProviderCredential, PROVIDER)
    if row is None:
        row = ProviderCredential(provider=PROVIDER, ciphertext=ciphertext, updated_at=utcnow())
        db.add(row)
    else:
        row.ciphertext = ciphertext
        row.updated_at = utcnow()
    db.commit()


def remove_key(db: Session) -> None:
    row = db.get(ProviderCredential, PROVIDER)
    if row is not None:
        db.delete(row)
        db.commit()
