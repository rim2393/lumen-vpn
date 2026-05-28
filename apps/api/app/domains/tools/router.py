from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
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
    revoke_inspected_session,
    summarize_tools,
)

router = APIRouter()
ToolManager = Annotated[Principal, Depends(require_permission(Permission.SUBSCRIPTION_READ))]
SessionManager = Annotated[Principal, Depends(require_permission(Permission.USER_MANAGE))]
DatabaseSession = Annotated[AsyncSession, Depends(get_db_session)]
AppSettings = Annotated[Settings, Depends(get_settings)]


@router.get("/summary", response_model=ToolSummaryResponse)
async def read_tools_summary(_: ToolManager, session: DatabaseSession) -> ToolSummaryResponse:
    return await summarize_tools(session)


@router.get("/hwid-inspector", response_model=HwidInspectorResponse)
async def read_hwid_inspector(_: ToolManager, session: DatabaseSession) -> HwidInspectorResponse:
    return await inspect_hwid(session)


@router.get("/srh-inspector", response_model=SrhInspectorResponse)
async def read_srh_inspector(
    _: ToolManager,
    session: DatabaseSession,
    settings: AppSettings,
) -> SrhInspectorResponse:
    return await inspect_srh(session, settings=settings)


@router.get("/sessions", response_model=SessionInspectorResponse)
async def read_session_inspector(
    principal: ToolManager,
    session: DatabaseSession,
) -> SessionInspectorResponse:
    return await inspect_sessions(session, principal=principal)


@router.delete("/sessions/{session_id}", response_model=SessionInspectorResponse)
async def revoke_session_from_inspector(
    session_id: UUID,
    principal: SessionManager,
    session: DatabaseSession,
) -> SessionInspectorResponse:
    await revoke_inspected_session(session, session_id=session_id, principal=principal)
    await session.commit()
    return await inspect_sessions(session, principal=principal)


@router.get("/torrent-blocker-reports", response_model=TorrentReportResponse)
async def read_torrent_reports(_: ToolManager, session: DatabaseSession) -> TorrentReportResponse:
    return await inspect_torrent_reports(session)


@router.get("/happ-routing", response_model=HappRoutingResponse)
async def read_happ_routing(_: ToolManager, session: DatabaseSession) -> HappRoutingResponse:
    return await inspect_happ_routing(session)
