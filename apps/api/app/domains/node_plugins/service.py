from uuid import UUID

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.core.rbac import Principal
from app.domains.audit.service import record_audit_event
from app.domains.node_plugins.models import NodePlugin
from app.domains.node_plugins.schemas import (
    NodePluginCreateRequest,
    NodePluginListResponse,
    NodePluginRecord,
    NodePluginUpdateRequest,
)


def _record(plugin: NodePlugin) -> NodePluginRecord:
    return NodePluginRecord(
        id=plugin.id,
        node_id=plugin.node_id,
        kind=plugin.kind,
        name=plugin.name,
        config_json=plugin.config_json or {},
        enabled=plugin.enabled,
        created_at=plugin.created_at,
        updated_at=plugin.updated_at,
    )


async def list_plugins(
    session: AsyncSession,
    *,
    node_id: UUID | None = None,
) -> NodePluginListResponse:
    stmt = select(NodePlugin).order_by(NodePlugin.name)
    if node_id is not None:
        # Return both node-specific and global (null-bound) plugins for a node.
        stmt = stmt.where(
            (NodePlugin.node_id == node_id) | (NodePlugin.node_id.is_(None))
        )
    result = await session.execute(stmt)
    return NodePluginListResponse(items=[_record(p) for p in result.scalars().all()])


async def list_effective_node_plugins(
    session: AsyncSession,
    *,
    node_id: UUID,
) -> list[NodePlugin]:
    """Return enabled global and node-bound plugins that must reach node-agent."""

    result = await session.execute(
        select(NodePlugin)
        .where(NodePlugin.enabled.is_(True))
        .where((NodePlugin.node_id == node_id) | (NodePlugin.node_id.is_(None)))
        .order_by(NodePlugin.node_id.is_(None).desc(), NodePlugin.name.asc())
    )
    return list(result.scalars().all())


def plugin_policy_records(plugins: list[NodePlugin]) -> list[dict[str, object]]:
    return [
        {
            "id": str(plugin.id),
            "nodeId": str(plugin.node_id) if plugin.node_id is not None else None,
            "kind": plugin.kind,
            "name": plugin.name,
            "config": dict(plugin.config_json or {}),
            "enabled": plugin.enabled,
        }
        for plugin in plugins
    ]


async def create_plugin(
    session: AsyncSession,
    *,
    request: NodePluginCreateRequest,
    principal: Principal,
) -> NodePluginRecord:
    plugin = NodePlugin(
        node_id=request.node_id,
        kind=request.kind,
        name=request.name,
        config_json=request.config_json,
        enabled=request.enabled,
    )
    session.add(plugin)
    await session.flush()
    await record_audit_event(
        session,
        principal=principal,
        action="node_plugin.created",
        resource_type="node_plugin",
        resource_id=str(plugin.id),
        metadata_json={"kind": plugin.kind},
    )
    await session.commit()
    return _record(plugin)


async def _get_plugin(session: AsyncSession, plugin_id: UUID) -> NodePlugin:
    plugin = await session.get(NodePlugin, plugin_id)
    if plugin is None:
        raise APIError(
            code="node_plugin_not_found",
            message="Node plugin not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    return plugin


async def update_plugin(
    session: AsyncSession,
    *,
    plugin_id: UUID,
    request: NodePluginUpdateRequest,
    principal: Principal,
) -> NodePluginRecord:
    plugin = await _get_plugin(session, plugin_id)
    if request.node_id is not None:
        plugin.node_id = request.node_id
    if request.kind is not None:
        plugin.kind = request.kind
    if request.name is not None:
        plugin.name = request.name
    if request.config_json is not None:
        plugin.config_json = request.config_json
    if request.enabled is not None:
        plugin.enabled = request.enabled
    await record_audit_event(
        session,
        principal=principal,
        action="node_plugin.updated",
        resource_type="node_plugin",
        resource_id=str(plugin.id),
    )
    await session.commit()
    return _record(plugin)


async def delete_plugin(
    session: AsyncSession,
    *,
    plugin_id: UUID,
    principal: Principal,
) -> None:
    plugin = await _get_plugin(session, plugin_id)
    await session.delete(plugin)
    await record_audit_event(
        session,
        principal=principal,
        action="node_plugin.deleted",
        resource_type="node_plugin",
        resource_id=str(plugin_id),
    )
    await session.commit()
