from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import Settings, get_settings


def create_engine(settings: Settings | None = None) -> AsyncEngine:
    resolved_settings = settings or get_settings()
    _ensure_persistent_production_database(resolved_settings)
    return create_async_engine(
        resolved_settings.database_url,
        echo=resolved_settings.database_echo,
        pool_pre_ping=True,
    )


def _ensure_persistent_production_database(settings: Settings) -> None:
    if not settings.is_production:
        return
    if settings.database_url.strip() == "sqlite+aiosqlite:///:memory:":
        raise RuntimeError("LUMEN_DATABASE_URL must be a persistent database in production.")


def create_sessionmaker(settings: Settings | None = None) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(
        bind=create_engine(settings),
        expire_on_commit=False,
        autoflush=False,
    )


async def get_db_session() -> AsyncIterator[AsyncSession]:
    sessionmaker = create_sessionmaker()
    async with sessionmaker() as session:
        yield session
