from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Permission, Principal, require_permission
from app.db.session import get_db_session
from app.domains.tools.schemas import (
    HappRoutingResponse,
    HwidInspectorResponse,
    SessionInspectorResponse,
    SrhInspectorResponse,
    ToolSummaryResponse,
    TorrentReportResponse,
)
from app.domains.tools.service import (
    inspect_happ_routing,
    inspect_hwid,
    inspect_sessions,
    inspect_srh,
    inspect_torrent_reports,
    summarize_tools,
)

router = APIRouter()
ToolManager = Annotated[Principal, Depends(require_permission(Permission.SUBSCRIPTION_READ))]
DatabaseSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.get("/summary", response_model=ToolSummaryResponse)
async def read_tools_summary(_: ToolManager, session: DatabaseSession) -> ToolSummaryResponse:
    return await summarize_tools(session)


@router.get("/hwid-inspector", response_model=HwidInspectorResponse)
async def read_hwid_inspector(_: ToolManager, session: DatabaseSession) -> HwidInspectorResponse:
    return await inspect_hwid(session)


@router.get("/srh-inspector", response_model=SrhInspectorResponse)
async def read_srh_inspector(_: ToolManager, session: DatabaseSession) -> SrhInspectorResponse:
    return await inspect_srh(session)


@router.get("/sessions", response_model=SessionInspectorResponse)
async def read_session_inspector(
    _: ToolManager,
    session: DatabaseSession,
) -> SessionInspectorResponse:
    return await inspect_sessions(session)


@router.get("/torrent-blocker-reports", response_model=TorrentReportResponse)
async def read_torrent_reports(_: ToolManager, session: DatabaseSession) -> TorrentReportResponse:
    return await inspect_torrent_reports(session)


@router.get("/happ-routing", response_model=HappRoutingResponse)
async def read_happ_routing(_: ToolManager, session: DatabaseSession) -> HappRoutingResponse:
    return await inspect_happ_routing(session)
