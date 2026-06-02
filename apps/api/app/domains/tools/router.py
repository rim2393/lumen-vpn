from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.rbac import Permission, Principal, require_permission
from app.db.session import get_db_session
from app.domains.tools.schemas import (
    DropConnectionsRequest,
    DropConnectionsResponse,
    HappRoutingBuildRequest,
    HappRoutingBuildResponse,
    HappRoutingResponse,
    HwidInspectorResponse,
    NodeKeyResponse,
    NodeUserIpResponse,
    SessionInspectorResponse,
    SrhInspectorResponse,
    ToolSnippetCreateRequest,
    ToolSnippetListResponse,
    ToolSnippetRecord,
    ToolSnippetUpdateRequest,
    ToolSummaryResponse,
    TopUserResponse,
    TorrentReportResponse,
    UserIpResponse,
    X25519KeypairResponse,
)
from app.domains.tools.service import (
    build_happ_routing_payload,
    create_tool_snippet,
    delete_tool_snippet,
    generate_node_key,
    generate_x25519_keypair,
    inspect_happ_routing,
    inspect_hwid,
    inspect_node_user_ips,
    inspect_sessions,
    inspect_srh,
    inspect_top_users,
    inspect_torrent_reports,
    inspect_user_ips,
    list_tool_snippets,
    queue_connection_drop,
    revoke_inspected_session,
    summarize_tools,
    truncate_torrent_reports,
    update_tool_snippet,
)

router = APIRouter()
ToolManager = Annotated[Principal, Depends(require_permission(Permission.USER_MANAGE))]
SessionManager = Annotated[Principal, Depends(require_permission(Permission.USER_MANAGE))]
UtilityManager = Annotated[Principal, Depends(require_permission(Permission.NODE_MANAGE))]
DatabaseSession = Annotated[AsyncSession, Depends(get_db_session)]
AppSettings = Annotated[Settings, Depends(get_settings)]


@router.get("/summary", response_model=ToolSummaryResponse)
async def read_tools_summary(_: ToolManager, session: DatabaseSession) -> ToolSummaryResponse:
    return await summarize_tools(session)


@router.get("/hwid-inspector", response_model=HwidInspectorResponse)
async def read_hwid_inspector(
    _: ToolManager,
    session: DatabaseSession,
    query: str | None = Query(default=None, min_length=1, max_length=160),
) -> HwidInspectorResponse:
    return await inspect_hwid(session, query=query)


@router.get("/top-users", response_model=TopUserResponse)
async def read_top_users(
    _: ToolManager,
    session: DatabaseSession,
    metric: str = Query(default="traffic_used", max_length=64),
    limit: int = Query(default=50, ge=1, le=200),
) -> TopUserResponse:
    return await inspect_top_users(session, metric=metric, limit=limit)


@router.get("/user-ips", response_model=UserIpResponse)
async def read_user_ips(
    _: ToolManager,
    session: DatabaseSession,
    query: str | None = Query(default=None, min_length=1, max_length=160),
    limit: int = Query(default=200, ge=1, le=1000),
) -> UserIpResponse:
    return await inspect_user_ips(session, query=query, limit=limit)


@router.get("/node-user-ips", response_model=NodeUserIpResponse)
async def read_node_user_ips(
    _: ToolManager,
    session: DatabaseSession,
    query: str | None = Query(default=None, min_length=1, max_length=160),
    limit: int = Query(default=200, ge=1, le=1000),
) -> NodeUserIpResponse:
    return await inspect_node_user_ips(session, query=query, limit=limit)


@router.post("/drop-connections", response_model=DropConnectionsResponse, status_code=201)
async def drop_connections_from_tools(
    request: DropConnectionsRequest,
    principal: UtilityManager,
    session: DatabaseSession,
) -> DropConnectionsResponse:
    response = await queue_connection_drop(session, request=request, principal=principal)
    await session.commit()
    return response


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


@router.delete("/torrent-blocker-reports", response_model=TorrentReportResponse)
async def truncate_torrent_blocker_reports(
    principal: SessionManager,
    session: DatabaseSession,
) -> TorrentReportResponse:
    response = await truncate_torrent_reports(session, principal=principal)
    await session.commit()
    return response


@router.get("/happ-routing", response_model=HappRoutingResponse)
async def read_happ_routing(_: ToolManager, session: DatabaseSession) -> HappRoutingResponse:
    return await inspect_happ_routing(session)


@router.post("/happ-routing/build", response_model=HappRoutingBuildResponse)
async def build_happ_routing(
    request: HappRoutingBuildRequest,
    principal: UtilityManager,
    session: DatabaseSession,
) -> HappRoutingBuildResponse:
    response = await build_happ_routing_payload(session, request=request, principal=principal)
    await session.commit()
    return response


@router.post("/x25519-keypair", response_model=X25519KeypairResponse)
async def create_x25519_keypair(
    principal: UtilityManager,
    session: DatabaseSession,
) -> X25519KeypairResponse:
    response = await generate_x25519_keypair(session, principal=principal)
    await session.commit()
    return response


@router.post("/node-key", response_model=NodeKeyResponse)
async def create_node_key(
    principal: UtilityManager,
    session: DatabaseSession,
    settings: AppSettings,
) -> NodeKeyResponse:
    response = await generate_node_key(session, principal=principal, settings=settings)
    await session.commit()
    return response


@router.get("/snippets", response_model=ToolSnippetListResponse)
async def read_tool_snippets(_: ToolManager, session: DatabaseSession) -> ToolSnippetListResponse:
    return await list_tool_snippets(session)


@router.post("/snippets", response_model=ToolSnippetRecord, status_code=201)
async def create_snippet(
    request: ToolSnippetCreateRequest,
    principal: UtilityManager,
    session: DatabaseSession,
) -> ToolSnippetRecord:
    response = await create_tool_snippet(session, request=request, principal=principal)
    await session.commit()
    return response


@router.patch("/snippets/{snippet_id}", response_model=ToolSnippetRecord)
async def update_snippet(
    snippet_id: UUID,
    request: ToolSnippetUpdateRequest,
    principal: UtilityManager,
    session: DatabaseSession,
) -> ToolSnippetRecord:
    response = await update_tool_snippet(
        session,
        snippet_id=snippet_id,
        request=request,
        principal=principal,
    )
    await session.commit()
    return response


@router.delete("/snippets/{snippet_id}", response_model=ToolSnippetListResponse)
async def delete_snippet(
    snippet_id: UUID,
    principal: UtilityManager,
    session: DatabaseSession,
) -> ToolSnippetListResponse:
    response = await delete_tool_snippet(session, snippet_id=snippet_id, principal=principal)
    await session.commit()
    return response
