from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Permission, Principal, require_permission
from app.db.session import get_db_session
from app.domains.audit.service import record_audit_event
from app.domains.protocols.schemas import (
    HostCreateRequest,
    HostListResponse,
    HostResponse,
    PortCheckRequest,
    PortCheckResponse,
    ProtocolAdapterListResponse,
    ProtocolProfileCreateRequest,
    ProtocolProfileListResponse,
    ProtocolProfileResponse,
    SquadCreateRequest,
    SquadListResponse,
    SquadResponse,
)
from app.domains.protocols.service import (
    check_port_conflicts,
    create_host,
    create_profile,
    create_squad,
    get_host,
    get_profile,
    get_squad,
    host_response,
    list_hosts,
    list_profiles,
    list_protocol_adapters,
    list_squads,
    profile_response,
    squad_response,
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


@profiles_router.get("/{profile_id}", response_model=ProtocolProfileResponse)
async def read_profile(
    profile_id: UUID,
    _: Manager,
    session: DatabaseSession,
) -> ProtocolProfileResponse:
    return profile_response(await get_profile(session, profile_id=profile_id))


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
