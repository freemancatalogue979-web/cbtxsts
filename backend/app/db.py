"""SQLAlchemy engine / session plumbing (SQLite by default).

Two engines share the same database file:

* ``engine``      – the classic sync engine used by REST routers, services and
  the startup migrations.
* ``async_engine`` – an ``sqlalchemy.ext.asyncio`` engine used by the websocket
  hot paths (snapshots, presence, chat writes) so SQL I/O never blocks the
  event loop while chat/heartbeat traffic is in flight.
"""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import DATABASE_URL

logger = logging.getLogger("arena.db")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
    future=True,
)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_connection, _record):  # noqa: ANN001 - SQLAlchemy hook signature
    """Enable WAL + foreign keys so the API and websockets can share the file."""
    if not DATABASE_URL.startswith("sqlite"):
        return
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


def _async_database_url(url: str) -> str:
    """Map the configured sync URL onto the matching async driver.

    SQLite uses aiosqlite, PostgreSQL asyncpg, MySQL aiomysql. Anything else
    is returned unchanged (and will raise loudly at import time if it has no
    async support, which is what we want)."""
    if url.startswith("sqlite:///") or url == "sqlite://":
        return url.replace("sqlite", "sqlite+aiosqlite", 1)
    if url.startswith("postgres"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1).replace(
            "postgres://", "postgresql+asyncpg://", 1
        )
    if url.startswith("mysql"):
        return url.replace("mysql://", "mysql+aiomysql://", 1)
    return url


ASYNC_DATABASE_URL = _async_database_url(DATABASE_URL)

async_engine = create_async_engine(ASYNC_DATABASE_URL, pool_pre_ping=True, future=True)


@event.listens_for(async_engine.sync_engine, "connect")
def _sqlite_pragmas_async(dbapi_connection, _record):  # noqa: ANN001 - SQLAlchemy hook signature
    """Same pragmas as the sync engine — both engines share the SQLite file."""
    _sqlite_pragmas(dbapi_connection, _record)


class Base(DeclarativeBase):
    pass


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Iterator[Session]:
    """FastAPI dependency."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional scope for background tasks and websocket handlers."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


AsyncSessionLocal = async_sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    autoflush=False,
    expire_on_commit=False,  # attributes stay readable after commit — no lazy refresh on the loop
)


@asynccontextmanager
async def async_session_scope() -> AsyncIterator[AsyncSession]:
    """Async transactional scope for the websocket hot paths.

    Usage::

        async with async_session_scope() as db:
            result = await db.execute(...)
            await db.commit()  # or let the scope commit on clean exit
    """
    db = AsyncSessionLocal()
    try:
        yield db
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    finally:
        await db.close()


def init_db() -> None:
    from . import models  # noqa: F401 - ensures mappers are registered

    Base.metadata.create_all(bind=engine)
    _light_migrations()


def _light_migrations() -> None:
    """Forward-only, idempotent migrations.

    Adds every column declared on the models but missing from the live database
    (SQLite supports ``ALTER TABLE ... ADD COLUMN``), then back-fills sensible
    defaults so an existing ``arena.db`` keeps working untouched. New tables and
    indexes are created by ``Base.metadata.create_all``.
    """
    from sqlalchemy import inspect, text
    from sqlalchemy.schema import CreateIndex

    from . import models  # noqa: F401 - ensure every mapper is registered

    inspector = inspect(engine)
    live_tables = set(inspector.get_table_names())
    statements: list[str] = []
    backfills: list[str] = []

    for table in Base.metadata.sorted_tables:
        if table.name not in live_tables:
            continue
        live_columns = {column["name"] for column in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in live_columns:
                continue
            try:
                ddl_type = column.type.compile(dialect=engine.dialect)
            except Exception:  # pragma: no cover - exotic types
                ddl_type = "TEXT"
            default = None
            if column.default is not None and not column.default.is_callable:
                value = column.default.arg
                if isinstance(value, bool):
                    default = "1" if value else "0"
                elif isinstance(value, (int, float)):
                    default = str(value)
                elif isinstance(value, str):
                    default = "'" + value.replace("'", "''") + "'"
            elif column.default is not None and column.default.is_callable and column.default.arg.__name__ in {"list", "dict"}:
                default = "'[]'" if column.default.arg.__name__ == "list" else "'{}'"
                ddl_type = "TEXT"
            elif column.type.__class__.__name__ == "JSON":
                ddl_type = "TEXT"
            clause = f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {ddl_type}'
            if default is not None:
                clause += f" DEFAULT {default}"
            statements.append(clause)
            if default is not None:
                backfills.append(
                    f'UPDATE "{table.name}" SET "{column.name}" = {default} WHERE "{column.name}" IS NULL'
                )

    with engine.begin() as conn:
        for statement in statements:
            try:
                conn.execute(text(statement))
            except Exception as error:  # pragma: no cover - already migrated / exotic
                logger.warning("skip migration %s (%s)", statement, error)
        for statement in backfills:
            try:
                conn.execute(text(statement))
            except Exception:  # pragma: no cover
                pass
        # Indexes declared on models for tables that already existed.
        for table in Base.metadata.sorted_tables:
            if table.name not in live_tables:
                continue
            for index in table.indexes:
                ddl = str(CreateIndex(index).compile(dialect=engine.dialect))
                if "CREATE UNIQUE INDEX" in ddl:
                    ddl = ddl.replace("CREATE UNIQUE INDEX", "CREATE UNIQUE INDEX IF NOT EXISTS", 1)
                else:
                    ddl = ddl.replace("CREATE INDEX", "CREATE INDEX IF NOT EXISTS", 1)
                try:
                    conn.execute(text(ddl))
                except Exception:  # pragma: no cover - duplicate data still blocks a unique index
                    pass

