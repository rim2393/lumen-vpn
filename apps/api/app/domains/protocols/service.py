from uuid import UUID

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.domains.nodes.models import Node
from app.domains.protocols.models import Host, ProtocolProfile, Squad
from app.domains.protocols.schemas import (
    WILDCARD_BIND_ADDRESS,
    HostCreateRequest,
    HostResponse,
    PortCheckRequest,
    PortCheckResponse,
    PortConflict,
    PortReservation,
    ProtocolAdapterResponse,
    ProtocolProfileCreateRequest,
    ProtocolProfileResponse,
    SquadCreateRequest,
    SquadResponse,
)

PROTOCOL_ADAPTERS = (
    ProtocolAdapterResponse(
        protocol="vless-reality",
        display_name="VLESS Reality",
        status="experimental",
        capabilities=["xray", "reality", "tcp", "subscription"],
        required_credential_refs=["client_uuid", "reality_private_key"],
    ),
    ProtocolAdapterResponse(
        protocol="vless-tcp-tls",
        display_name="VLESS TCP TLS",
        status="experimental",
        capabilities=["xray", "tls", "tcp", "subscription"],
        required_credential_refs=["client_uuid", "tls_certificate"],
    ),
    ProtocolAdapterResponse(
        protocol="trojan",
        display_name="Trojan",
        status="placeholder",
        capabilities=["subscription"],
        required_credential_refs=["password"],
    ),
    ProtocolAdapterResponse(
        protocol="shadowsocks",
        display_name="Shadowsocks",
        status="placeholder",
        capabilities=["subscription"],
        required_credential_refs=["password"],
    ),
    ProtocolAdapterResponse(
        protocol="wireguard",
        display_name="WireGuard",
        status="placeholder",
        capabilities=["subscription"],
        required_credential_refs=["private_key"],
    ),
    ProtocolAdapterResponse(
        protocol="hysteria2",
        display_name="Hysteria2",
        status="placeholder",
        capabilities=["subscription"],
        required_credential_refs=["password"],
    ),
)


def list_protocol_adapters() -> list[ProtocolAdapterResponse]:
    return list(PROTOCOL_ADAPTERS)


async def list_profiles(session: AsyncSession) -> list[ProtocolProfile]:
    result = await session.execute(
        select(ProtocolProfile).order_by(ProtocolProfile.created_at.desc())
    )
    return list(result.scalars().all())


async def get_profile(session: AsyncSession, *, profile_id: UUID) -> ProtocolProfile:
    profile = await session.get(ProtocolProfile, profile_id)
    if profile is None:
        raise APIError(
            code="protocol_profile_not_found",
            message="Protocol profile was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    return profile


async def create_profile(
    session: AsyncSession,
    *,
    request: ProtocolProfileCreateRequest,
) -> ProtocolProfile:
    await _ensure_node_exists(session, request.node_id)
    if request.squad_id is not None:
        await get_squad(session, squad_id=request.squad_id)
    if request.adapter not in {adapter.protocol for adapter in PROTOCOL_ADAPTERS}:
        raise APIError(
            code="protocol_adapter_unknown",
            message="Protocol adapter is not registered.",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            details=[request.adapter],
        )
    existing = (
        await session.execute(select(ProtocolProfile).where(ProtocolProfile.name == request.name))
    ).scalar_one_or_none()
    if existing is not None:
        raise APIError(
            code="protocol_profile_name_exists",
            message="Protocol profile name already exists.",
            status_code=status.HTTP_409_CONFLICT,
        )
    port_check = await check_port_conflicts(
        session,
        request=PortCheckRequest(
            node_id=request.node_id,
            reservations=request.port_reservations,
        ),
    )
    if port_check.conflicts and not request.allow_port_conflicts:
        raise APIError(
            code="protocol_port_conflict",
            message="Protocol profile conflicts with an existing exclusive bind reservation.",
            status_code=status.HTTP_409_CONFLICT,
            details=[conflict.model_dump_json() for conflict in port_check.conflicts],
        )
    profile = ProtocolProfile(
        name=request.name,
        node_id=request.node_id,
        squad_id=request.squad_id,
        adapter=request.adapter,
        status=request.status,
        config_json=request.config_json,
        port_reservations=[reservation.model_dump() for reservation in request.port_reservations],
        credentials_ref=request.credentials_ref,
    )
    session.add(profile)
    await session.flush()
    return profile


async def check_port_conflicts(
    session: AsyncSession,
    *,
    request: PortCheckRequest,
) -> PortCheckResponse:
    profiles = (
        await session.execute(
            select(ProtocolProfile)
            .where(ProtocolProfile.node_id == request.node_id)
            .where(ProtocolProfile.status.in_(["active", "installing"]))
        )
    ).scalars()
    conflicts: list[PortConflict] = []
    for profile in profiles:
        if profile.id == request.exclude_profile_id:
            continue
        for existing in profile.port_reservations:
            for incoming in request.reservations:
                if _reservations_conflict(existing, incoming):
                    conflicts.append(
                        PortConflict(
                            profile_id=profile.id,
                            profile_name=profile.name,
                            address=str(existing.get("address", WILDCARD_BIND_ADDRESS)),
                            port=int(existing["port"]),
                            protocol=str(existing.get("protocol", "tcp")),
                            suggested_port=_suggest_port(
                                request.reservations,
                                [p.port_reservations for p in [profile]],
                                incoming.port,
                            ),
                            message=(
                                "Exclusive bind reservation overlaps on address, "
                                "port, and protocol."
                            ),
                        )
                    )
    return PortCheckResponse(allowed=not conflicts, conflicts=conflicts)


async def list_squads(session: AsyncSession) -> list[Squad]:
    result = await session.execute(select(Squad).order_by(Squad.created_at.desc()))
    return list(result.scalars().all())


async def get_squad(session: AsyncSession, *, squad_id: UUID) -> Squad:
    squad = await session.get(Squad, squad_id)
    if squad is None:
        raise APIError(
            code="squad_not_found",
            message="Squad was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    return squad


async def create_squad(session: AsyncSession, *, request: SquadCreateRequest) -> Squad:
    existing = (
        await session.execute(select(Squad).where(Squad.name == request.name))
    ).scalar_one_or_none()
    if existing is not None:
        raise APIError(
            code="squad_name_exists",
            message="Squad name already exists.",
            status_code=status.HTTP_409_CONFLICT,
        )
    squad = Squad(**request.model_dump())
    session.add(squad)
    await session.flush()
    return squad


async def list_hosts(session: AsyncSession) -> list[Host]:
    result = await session.execute(select(Host).order_by(Host.created_at.desc()))
    return list(result.scalars().all())


async def get_host(session: AsyncSession, *, host_id: UUID) -> Host:
    host = await session.get(Host, host_id)
    if host is None:
        raise APIError(
            code="host_not_found",
            message="Host was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    return host


async def create_host(session: AsyncSession, *, request: HostCreateRequest) -> Host:
    await _ensure_node_exists(session, request.node_id)
    if request.protocol_profile_id is not None:
        await get_profile(session, profile_id=request.protocol_profile_id)
    if request.squad_id is not None:
        await get_squad(session, squad_id=request.squad_id)
    existing = (
        await session.execute(select(Host).where(Host.name == request.name))
    ).scalar_one_or_none()
    if existing is not None:
        raise APIError(
            code="host_name_exists",
            message="Host name already exists.",
            status_code=status.HTTP_409_CONFLICT,
        )
    host = Host(**request.model_dump())
    session.add(host)
    await session.flush()
    return host


async def _ensure_node_exists(session: AsyncSession, node_id: UUID) -> None:
    node = await session.get(Node, node_id)
    if node is None:
        raise APIError(
            code="node_not_found",
            message="Node was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )


def profile_response(profile: ProtocolProfile) -> ProtocolProfileResponse:
    return ProtocolProfileResponse(
        id=profile.id,
        name=profile.name,
        node_id=profile.node_id,
        squad_id=profile.squad_id,
        adapter=profile.adapter,
        status=profile.status,
        config_json=profile.config_json,
        port_reservations=profile.port_reservations,
        credentials_ref=profile.credentials_ref,
    )


def squad_response(squad: Squad) -> SquadResponse:
    return SquadResponse(
        id=squad.id,
        name=squad.name,
        kind=squad.kind,
        status=squad.status,
        metadata_json=squad.metadata_json,
    )


def host_response(host: Host) -> HostResponse:
    return HostResponse(
        id=host.id,
        name=host.name,
        hostname=host.hostname,
        node_id=host.node_id,
        protocol_profile_id=host.protocol_profile_id,
        squad_id=host.squad_id,
        status=host.status,
        tags=host.tags,
    )


def _reservations_conflict(existing: dict[str, object], incoming: PortReservation) -> bool:
    if not existing.get("exclusive", True) or not incoming.exclusive:
        return False
    return (
        int(existing["port"]) == incoming.port
        and str(existing.get("protocol", "tcp")).lower() == incoming.protocol
        and _addresses_overlap(
            str(existing.get("address", WILDCARD_BIND_ADDRESS)),
            incoming.address,
        )
    )


def _addresses_overlap(left: str, right: str) -> bool:
    wildcards = {WILDCARD_BIND_ADDRESS, "::", "*"}
    return left == right or left in wildcards or right in wildcards


def _suggest_port(
    incoming: list[PortReservation],
    existing_groups: list[list[dict[str, object]]],
    requested_port: int,
) -> int | None:
    blocked = {reservation.port for reservation in incoming}
    for group in existing_groups:
        blocked.update(int(item["port"]) for item in group if item.get("exclusive", True))
    for port in range(requested_port + 1, 65536):
        if port not in blocked:
            return port
    return None
