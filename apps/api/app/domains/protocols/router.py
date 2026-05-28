from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Permission, Principal, require_permission
from app.db.session import get_db_session
from app.domains.audit.service import record_audit_event
from app.domains.protocols.models import Host, ProtocolProfile, Squad
from app.domains.protocols.schemas import (
    HostBulkActionRequest,
    HostCreateRequest,
    HostListResponse,
    HostReorderRequest,
    HostResponse,
    HostUpdateRequest,
    PortCheckRequest,
    PortCheckResponse,
    ProfileComputedConfigResponse,
    ProfileInboundListResponse,
    ProtocolAdapterListResponse,
    ProtocolProfileCreateRequest,
    ProtocolProfileListResponse,
    ProtocolProfileResponse,
    ProtocolProfileUpdateRequest,
    ResourceBulkActionRequest,
    ResourceBulkActionResponse,
    SquadCreateRequest,
    SquadListResponse,
    SquadResponse,
    SquadUpdateRequest,
)
from app.domains.protocols.service import (
    bulk_set_status,
    bulk_update_hosts,
    check_port_conflicts,
    create_host,
    create_profile,
    create_squad,
    delete_host,
    delete_profile,
    delete_squad,
    get_host,
    get_profile,
    get_profile_computed_config,
    get_squad,
    host_response,
    list_global_profile_inbounds,
    list_hosts,
    list_profile_inbounds,
    list_profiles,
    list_protocol_adapters,
    list_squads,
    profile_response,
    reorder_hosts,
    squad_response,
    update_host,
    update_profile,
    update_squad,
)

protocols_router = APIRouter()
profiles_router = APIRouter()
hosts_router = APIRouter()
squads_router = APIRouter()
Manager = Annotated[Principal, Depends(require_permission(Permission.NODE_MANAGE))]
DatabaseSession = Annotated[AsyncSession, Depends(get_db_session)]


@protocols_router.get("/adapters", response_model=ProtocolAdapterListResponse)
async def list_adapters(_: Manager) -> ProtocolAdapterListResponse:
    return ProtocolAdapterListResponse(items=list_protocol_adapters())


@protocols_router.post("/port-check", response_model=PortCheckResponse)
async def check_ports(
    request: PortCheckRequest,
    _: Manager,
    session: DatabaseSession,
) -> PortCheckResponse:
    return await check_port_conflicts(session, request=request)


@profiles_router.get("", response_model=ProtocolProfileListResponse)
async def read_profiles(
    _: Manager,
    session: DatabaseSession,
) -> ProtocolProfileListResponse:
    profiles = await list_profiles(session)
    return ProtocolProfileListResponse(items=[profile_response(profile) for profile in profiles])


@profiles_router.post(
    "",
    response_model=ProtocolProfileResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_profile(
    request: ProtocolProfileCreateRequest,
    principal: Manager,
    session: DatabaseSession,
) -> ProtocolProfileResponse:
    profile = await create_profile(session, request=request)
    await record_audit_event(
        session,
        principal=principal,
        action="protocol_profile.created",
        resource_type="protocol_profile",
        resource_id=str(profile.id),
    )
    await session.commit()
    return profile_response(profile)


@profiles_router.get("/inbounds", response_model=ProfileInboundListResponse)
async def read_all_profile_inbounds(
    _: Manager,
    session: DatabaseSession,
) -> ProfileInboundListResponse:
    return ProfileInboundListResponse(items=await list_global_profile_inbounds(session))


@profiles_router.get("/{profile_id}", response_model=ProtocolProfileResponse)
async def read_profile(
    profile_id: UUID,
    _: Manager,
    session: DatabaseSession,
) -> ProtocolProfileResponse:
    return profile_response(await get_profile(session, profile_id=profile_id))


@profiles_router.get("/{profile_id}/computed-config", response_model=ProfileComputedConfigResponse)
async def read_profile_computed_config(
    profile_id: UUID,
    _: Manager,
    session: DatabaseSession,
) -> ProfileComputedConfigResponse:
    return await get_profile_computed_config(session, profile_id=profile_id)


@profiles_router.get("/{profile_id}/inbounds", response_model=ProfileInboundListResponse)
async def read_profile_inbounds(
    profile_id: UUID,
    _: Manager,
    session: DatabaseSession,
) -> ProfileInboundListResponse:
    inbounds = await list_profile_inbounds(session, profile_id=profile_id)
    return ProfileInboundListResponse(items=inbounds)


@profiles_router.patch("/{profile_id}", response_model=ProtocolProfileResponse)
async def patch_profile(
    profile_id: UUID,
    request: ProtocolProfileUpdateRequest,
    principal: Manager,
    session: DatabaseSession,
) -> ProtocolProfileResponse:
    profile = await update_profile(session, profile_id=profile_id, request=request)
    await record_audit_event(
        session,
        principal=principal,
        action="protocol_profile.updated",
        resource_type="protocol_profile",
        resource_id=str(profile.id),
    )
    await session.commit()
    return profile_response(profile)


@profiles_router.delete("/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_profile_route(
    profile_id: UUID,
    principal: Manager,
    session: DatabaseSession,
) -> None:
    await delete_profile(session, profile_id=profile_id)
    await record_audit_event(
        session,
        principal=principal,
        action="protocol_profile.deleted",
        resource_type="protocol_profile",
        resource_id=str(profile_id),
    )
    await session.commit()


@profiles_router.post("/bulk/status", response_model=ResourceBulkActionResponse)
async def bulk_profile_status(
    request: ResourceBulkActionRequest,
    principal: Manager,
    session: DatabaseSession,
) -> ResourceBulkActionResponse:
    updated = await bulk_set_status(
        session,
        model=ProtocolProfile,
        ids=request.ids,
        status_value=request.status or "active",
    )
    await record_audit_event(
        session,
        principal=principal,
        action="protocol_profile.bulk.status",
        resource_type="protocol_profile",
    )
    await session.commit()
    return ResourceBulkActionResponse(updated=updated)


@squads_router.get("", response_model=SquadListResponse)
async def read_squads(
    _: Manager,
    session: DatabaseSession,
) -> SquadListResponse:
    squads = await list_squads(session)
    return SquadListResponse(items=[squad_response(squad) for squad in squads])


@squads_router.post("", response_model=SquadResponse, status_code=status.HTTP_201_CREATED)
async def post_squad(
    request: SquadCreateRequest,
    principal: Manager,
    session: DatabaseSession,
) -> SquadResponse:
    squad = await create_squad(session, request=request)
    await record_audit_event(
        session,
        principal=principal,
        action="squad.created",
        resource_type="squad",
        resource_id=str(squad.id),
    )
    await session.commit()
    return squad_response(squad)


@squads_router.get("/{squad_id}", response_model=SquadResponse)
async def read_squad(
    squad_id: UUID,
    _: Manager,
    session: DatabaseSession,
) -> SquadResponse:
    return squad_response(await get_squad(session, squad_id=squad_id))


@squads_router.patch("/{squad_id}", response_model=SquadResponse)
async def patch_squad(
    squad_id: UUID,
    request: SquadUpdateRequest,
    principal: Manager,
    session: DatabaseSession,
) -> SquadResponse:
    squad = await update_squad(session, squad_id=squad_id, request=request)
    await record_audit_event(
        session,
        principal=principal,
        action="squad.updated",
        resource_type="squad",
        resource_id=str(squad.id),
    )
    await session.commit()
    return squad_response(squad)


@squads_router.delete("/{squad_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_squad_route(
    squad_id: UUID,
    principal: Manager,
    session: DatabaseSession,
) -> None:
    await delete_squad(session, squad_id=squad_id)
    await record_audit_event(
        session,
        principal=principal,
        action="squad.deleted",
        resource_type="squad",
        resource_id=str(squad_id),
    )
    await session.commit()


@squads_router.post("/bulk/status", response_model=ResourceBulkActionResponse)
async def bulk_squad_status(
    request: ResourceBulkActionRequest,
    principal: Manager,
    session: DatabaseSession,
) -> ResourceBulkActionResponse:
    updated = await bulk_set_status(
        session,
        model=Squad,
        ids=request.ids,
        status_value=request.status or "active",
    )
    await record_audit_event(
        session,
        principal=principal,
        action="squad.bulk.status",
        resource_type="squad",
    )
    await session.commit()
    return ResourceBulkActionResponse(updated=updated)


@hosts_router.get("", response_model=HostListResponse)
async def read_hosts(
    _: Manager,
    session: DatabaseSession,
) -> HostListResponse:
    hosts = await list_hosts(session)
    return HostListResponse(items=[host_response(host) for host in hosts])


@hosts_router.post("", response_model=HostResponse, status_code=status.HTTP_201_CREATED)
async def post_host(
    request: HostCreateRequest,
    principal: Manager,
    session: DatabaseSession,
) -> HostResponse:
    host = await create_host(session, request=request)
    await record_audit_event(
        session,
        principal=principal,
        action="host.created",
        resource_type="host",
        resource_id=str(host.id),
    )
    await session.commit()
    return host_response(host)


@hosts_router.get("/{host_id}", response_model=HostResponse)
async def read_host(
    host_id: UUID,
    _: Manager,
    session: DatabaseSession,
) -> HostResponse:
    return host_response(await get_host(session, host_id=host_id))


@hosts_router.patch("/{host_id}", response_model=HostResponse)
async def patch_host(
    host_id: UUID,
    request: HostUpdateRequest,
    principal: Manager,
    session: DatabaseSession,
) -> HostResponse:
    host = await update_host(session, host_id=host_id, request=request)
    await record_audit_event(
        session,
        principal=principal,
        action="host.updated",
        resource_type="host",
        resource_id=str(host.id),
    )
    await session.commit()
    return host_response(host)


@hosts_router.delete("/{host_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_host_route(
    host_id: UUID,
    principal: Manager,
    session: DatabaseSession,
) -> None:
    await delete_host(session, host_id=host_id)
    await record_audit_event(
        session,
        principal=principal,
        action="host.deleted",
        resource_type="host",
        resource_id=str(host_id),
    )
    await session.commit()


@hosts_router.post("/bulk/status", response_model=ResourceBulkActionResponse)
async def bulk_host_status(
    request: ResourceBulkActionRequest,
    principal: Manager,
    session: DatabaseSession,
) -> ResourceBulkActionResponse:
    updated = await bulk_set_status(
        session,
        model=Host,
        ids=request.ids,
        status_value=request.status or "active",
    )
    await record_audit_event(
        session,
        principal=principal,
        action="host.bulk.status",
        resource_type="host",
    )
    await session.commit()
    return ResourceBulkActionResponse(updated=updated)


@hosts_router.post("/bulk/{action}", response_model=ResourceBulkActionResponse)
async def bulk_host_action(
    action: str,
    request: HostBulkActionRequest,
    principal: Manager,
    session: DatabaseSession,
) -> ResourceBulkActionResponse:
    updated = await bulk_update_hosts(session, request=request, action=action)
    await record_audit_event(
        session,
        principal=principal,
        action=f"host.bulk.{action}",
        resource_type="host",
        metadata_json={"host_ids": [str(host_id) for host_id in request.ids]},
    )
    await session.commit()
    return ResourceBulkActionResponse(updated=updated)


@hosts_router.post("/actions/reorder", response_model=ResourceBulkActionResponse)
async def reorder_host_route(
    request: HostReorderRequest,
    principal: Manager,
    session: DatabaseSession,
) -> ResourceBulkActionResponse:
    updated = await reorder_hosts(session, request=request)
    await record_audit_event(
        session,
        principal=principal,
        action="host.reordered",
        resource_type="host",
        metadata_json={"host_ids": [str(host_id) for host_id in request.ids]},
    )
    await session.commit()
    return ResourceBulkActionResponse(updated=updated)
