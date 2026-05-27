from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.compat_router import compat_router
from app.api.v1.router import api_v1_router
from app.core.config import Settings, get_settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings)
    yield


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or get_settings()
    configure_logging(resolved_settings)

    app = FastAPI(
        title=resolved_settings.app_name,
        version=resolved_settings.app_version,
        docs_url=resolved_settings.docs_url,
        redoc_url=resolved_settings.redoc_url,
        openapi_url=resolved_settings.openapi_url,
        lifespan=lifespan,
    )
    app.state.settings = resolved_settings
    register_error_handlers(app)
    app.include_router(compat_router)
    app.include_router(api_v1_router, prefix=resolved_settings.api_v1_prefix)
    return app


app = create_app()
