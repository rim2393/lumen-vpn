from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Permission, Principal, require_permission
from app.db.session import get_db_session
from app.domains.metrics.service import (
    PROMETHEUS_CONTENT_TYPE,
    render_prometheus_metrics,
)

router = APIRouter()
MetricsReader = Annotated[Principal, Depends(require_permission(Permission.NODE_MANAGE))]
DatabaseSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.get("", response_class=PlainTextResponse)
async def read_prometheus_metrics(
    _: MetricsReader,
    session: DatabaseSession,
) -> PlainTextResponse:
    body = await render_prometheus_metrics(session)
    return PlainTextResponse(content=body, media_type=PROMETHEUS_CONTENT_TYPE)
