"""
Async SQLAlchemy engine and session factory.

Uses a single shared engine with connection pooling.  Each request gets its
own AsyncSession via the ``get_db`` dependency.

Production notes:
- Neon.tech requires SSL; asyncpg does NOT accept the ``sslmode`` query-string
  parameter, so we inject ``ssl="require"`` via ``connect_args``.
- Pool size is kept small for serverless Postgres (Neon imposes connection
  limits that are much lower than self-hosted Postgres).
"""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

# ── Engine & Session Factory ─────────────────────────────────────────────

# Build connect_args: always require SSL for cloud Postgres (Neon / RDS).
# asyncpg uses Python's ssl module, not libpq keywords, so we pass
# ssl="require" instead of the libpq-style ``sslmode`` query parameter.
_connect_args: dict = {}
if "neon.tech" in settings.DATABASE_URL or "amazonaws.com" in settings.DATABASE_URL:
    _connect_args["ssl"] = "require"

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_size=5,          # Neon free-tier: max 5 concurrent connections
    max_overflow=5,
    pool_pre_ping=True,
    connect_args=_connect_args,
)

async_session_factory = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


# ── Declarative Base ─────────────────────────────────────────────────────
class Base(DeclarativeBase):
    """Shared declarative base for all ORM models."""

    pass


# ── FastAPI Dependency ───────────────────────────────────────────────────
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield a transactional async session, rolling back on error."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
