from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.api.compat_router import compat_router
from app.api.v1.router import api_v1_router
from app.core.config import Settings, get_settings
from app.core.errors import register_error_handlers
from app.core.logging_config import configure_logging
from app.db.session import create_engine
from app.domains.users.bootstrap import bootstrap_first_admin


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = app.state.settings
    configure_logging(settings)
    engine = create_engine(settings)
    sessionmaker = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    try:
        async with sessionmaker() as session:
            await bootstrap_first_admin(session, settings)
            await session.commit()
        yield
    finally:
        await engine.dispose()


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or get_settings()
    configure_logging(resolved_settings)

    # Interactive API docs and the OpenAPI schema are disabled in production to
    # avoid exposing the full API surface to anonymous callers.
    expose_docs = not resolved_settings.is_production
    app = FastAPI(
        title=resolved_settings.app_name,
        version=resolved_settings.app_version,
        docs_url=resolved_settings.docs_url if expose_docs else None,
        redoc_url=resolved_settings.redoc_url if expose_docs else None,
        openapi_url=resolved_settings.openapi_url if expose_docs else None,
        lifespan=lifespan,
    )
    app.state.settings = resolved_settings
    if resolved_settings.allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=[str(origin).rstrip("/") for origin in resolved_settings.allowed_origins],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    register_error_handlers(app)
    app.include_router(compat_router)
    app.include_router(api_v1_router, prefix=resolved_settings.api_v1_prefix)
    return app


app = create_app()
