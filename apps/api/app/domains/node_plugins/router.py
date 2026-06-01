from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Permission, Principal, require_permission
from app.db.session import get_db_session
from app.domains.node_plugins.schemas import (
    NodePluginCreateRequest,
    NodePluginListResponse,
    NodePluginRecord,
    NodePluginUpdateRequest,
)
from app.domains.node_plugins.service import (
    create_plugin,
    delete_plugin,
    list_plugins,
    update_plugin,
)

router = APIRouter()
NodePluginManager = Annotated[Principal, Depends(require_permission(Permission.NODE_MANAGE))]
DatabaseSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.get("", response_model=NodePluginListResponse)
async def read_node_plugins(
    _: NodePluginManager,
    session: DatabaseSession,
    node_id: Annotated[UUID | None, Query()] = None,
) -> NodePluginListResponse:
    return await list_plugins(session, node_id=node_id)


@router.post("", response_model=NodePluginRecord, status_code=201)
async def create_node_plugin(
    request: NodePluginCreateRequest,
    principal: NodePluginManager,
    session: DatabaseSession,
) -> NodePluginRecord:
    return await create_plugin(session, request=request, principal=principal)


@router.patch("/{plugin_id}", response_model=NodePluginRecord)
async def update_node_plugin(
    plugin_id: UUID,
    request: NodePluginUpdateRequest,
    principal: NodePluginManager,
    session: DatabaseSession,
) -> NodePluginRecord:
    return await update_plugin(session, plugin_id=plugin_id, request=request, principal=principal)


@router.delete("/{plugin_id}", status_code=204)
async def delete_node_plugin(
    plugin_id: UUID,
    principal: NodePluginManager,
    session: DatabaseSession,
) -> None:
    await delete_plugin(session, plugin_id=plugin_id, principal=principal)
