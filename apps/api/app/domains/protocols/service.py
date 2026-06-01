from copy import deepcopy
from uuid import UUID

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import APIError
from app.domains.nodes.models import Node
from app.domains.protocols.models import Host, ProtocolProfile, Squad
from app.domains.protocols.schemas import (
    WILDCARD_BIND_ADDRESS,
    HostBulkActionRequest,
    HostCreateRequest,
    HostReorderRequest,
    HostResponse,
    HostUpdateRequest,
    PortCheckRequest,
    PortCheckResponse,
    PortConflict,
    PortReservation,
    ProfileComputedConfigResponse,
    ProfileComputedNodeResponse,
    ProfileInboundHostBindingResponse,
    ProfileInboundResponse,
    ProtocolAdapterResponse,
    ProtocolProfileCreateRequest,
    ProtocolProfileResponse,
    ProtocolProfileUpdateRequest,
    SquadCreateRequest,
    SquadDetailResponse,
    SquadHostResponse,
    SquadNodeResponse,
    SquadProfileResponse,
    SquadReorderRequest,
    SquadResponse,
    SquadUpdateRequest,
    SquadUserMutationRequest,
    SquadUserResponse,
)
from app.domains.subscriptions.models import Subscription
from app.domains.subscriptions.renderers import derive_client_credentials
from app.domains.users.models import User


def _adapter(
    protocol: str,
    display_name: str,
    *,
    capabilities: list[str],
    required_credential_refs: list[str],
    status: str = "catalog",
) -> ProtocolAdapterResponse:
    return ProtocolAdapterResponse(
        protocol=protocol,
        display_name=display_name,
        status=status,
        capabilities=capabilities,
        required_credential_refs=required_credential_refs,
    )


PROTOCOL_ADAPTERS = (
    _adapter(
        "vless-reality",
        "VLESS Reality TCP",
        status="experimental",
        capabilities=["xray", "vless", "reality", "tcp", "subscription"],
        required_credential_refs=["client_uuid", "reality_private_key"],
    ),
    _adapter(
        "vless-reality-grpc",
        "VLESS Reality gRPC",
        capabilities=["xray", "vless", "reality", "grpc", "subscription"],
        required_credential_refs=["client_uuid", "reality_private_key"],
    ),
    _adapter(
        "vless-reality-xhttp",
        "VLESS Reality XHTTP",
        capabilities=["xray", "vless", "reality", "xhttp", "subscription"],
        required_credential_refs=["client_uuid", "reality_private_key"],
    ),
    _adapter(
        "vless-reality-httpupgrade",
        "VLESS Reality HTTPUpgrade",
        capabilities=["xray", "vless", "reality", "httpupgrade", "subscription"],
        required_credential_refs=["client_uuid", "reality_private_key"],
    ),
    _adapter(
        "vless-tcp-tls",
        "VLESS TCP TLS",
        status="experimental",
        capabilities=["xray", "vless", "tls", "tcp", "subscription"],
        required_credential_refs=["client_uuid", "tls_certificate"],
    ),
    _adapter(
        "vless-ws-tls",
        "VLESS WebSocket TLS",
        capabilities=["xray", "vless", "tls", "websocket", "subscription"],
        required_credential_refs=["client_uuid", "tls_certificate"],
    ),
    _adapter(
        "vless-grpc-tls",
        "VLESS gRPC TLS",
        capabilities=["xray", "vless", "tls", "grpc", "subscription"],
        required_credential_refs=["client_uuid", "tls_certificate"],
    ),
    _adapter(
        "vless-xhttp-tls",
        "VLESS XHTTP TLS",
        capabilities=["xray", "vless", "tls", "xhttp", "subscription"],
        required_credential_refs=["client_uuid", "tls_certificate"],
    ),
    _adapter(
        "vless-httpupgrade-tls",
        "VLESS HTTPUpgrade TLS",
        capabilities=["xray", "vless", "tls", "httpupgrade", "subscription"],
        required_credential_refs=["client_uuid", "tls_certificate"],
    ),
    _adapter(
        "vless-tcp",
        "VLESS TCP",
        capabilities=["xray", "vless", "tcp", "subscription"],
        required_credential_refs=["client_uuid"],
    ),
    _adapter(
        "vless-ws",
        "VLESS WebSocket",
        capabilities=["xray", "vless", "websocket", "subscription"],
        required_credential_refs=["client_uuid"],
    ),
    _adapter(
        "vmess-tcp",
        "VMess TCP",
        capabilities=["xray", "vmess", "tcp", "subscription"],
        required_credential_refs=["client_uuid"],
    ),
    _adapter(
        "vmess-ws-tls",
        "VMess WebSocket TLS",
        capabilities=["xray", "vmess", "tls", "websocket", "subscription"],
        required_credential_refs=["client_uuid", "tls_certificate"],
    ),
    _adapter(
        "vmess-grpc-tls",
        "VMess gRPC TLS",
        capabilities=["xray", "vmess", "tls", "grpc", "subscription"],
        required_credential_refs=["client_uuid", "tls_certificate"],
    ),
    _adapter(
        "vmess-httpupgrade-tls",
        "VMess HTTPUpgrade TLS",
        capabilities=["xray", "vmess", "tls", "httpupgrade", "subscription"],
        required_credential_refs=["client_uuid", "tls_certificate"],
    ),
    _adapter(
        "trojan-tcp-tls",
        "Trojan TCP TLS",
        capabilities=["xray", "trojan", "tls", "tcp", "subscription"],
        required_credential_refs=["password", "tls_certificate"],
    ),
    _adapter(
        "trojan-ws-tls",
        "Trojan WebSocket TLS",
        capabilities=["xray", "trojan", "tls", "websocket", "subscription"],
        required_credential_refs=["password", "tls_certificate"],
    ),
    _adapter(
        "trojan-grpc-tls",
        "Trojan gRPC TLS",
        capabilities=["xray", "trojan", "tls", "grpc", "subscription"],
        required_credential_refs=["password", "tls_certificate"],
    ),
    _adapter(
        "trojan-xhttp-tls",
        "Trojan XHTTP TLS",
        capabilities=["xray", "trojan", "tls", "xhttp", "subscription"],
        required_credential_refs=["password", "tls_certificate"],
    ),
    _adapter(
        "trojan-tcp-reality",
        "Trojan TCP Reality",
        capabilities=["xray", "trojan", "reality", "tcp", "subscription"],
        required_credential_refs=["password", "reality_private_key"],
    ),
    _adapter(
        "shadowsocks-native",
        "Shadowsocks Native",
        capabilities=["xray", "shadowsocks", "tcp", "udp", "subscription"],
        required_credential_refs=["password"],
    ),
    _adapter(
        "shadowsocks-2022",
        "Shadowsocks 2022",
        capabilities=["sing-box", "shadowsocks", "tcp", "udp", "subscription"],
        required_credential_refs=["password", "method"],
    ),
    _adapter(
        "shadowsocks-v2ray-plugin",
        "Shadowsocks v2ray-plugin",
        capabilities=["shadowsocks", "plugin", "websocket", "tls", "subscription"],
        required_credential_refs=["password", "plugin_opts"],
    ),
    _adapter(
        "shadowsocks-obfs",
        "Shadowsocks simple-obfs",
        capabilities=["shadowsocks", "plugin", "obfs", "subscription"],
        required_credential_refs=["password", "plugin_opts"],
    ),
    _adapter(
        "wireguard-native",
        "WireGuard Native",
        capabilities=["wireguard", "udp", "subscription"],
        required_credential_refs=["private_key", "peer_public_key"],
    ),
    _adapter(
        "wireguard-amneziawg",
        "AmneziaWG",
        capabilities=["wireguard", "amneziawg", "udp", "subscription"],
        required_credential_refs=["private_key", "peer_public_key"],
    ),
    _adapter(
        "hysteria2",
        "Hysteria2",
        capabilities=["hysteria2", "udp", "tls", "subscription"],
        required_credential_refs=["password", "tls_certificate"],
    ),
    _adapter(
        "hysteria2-obfs",
        "Hysteria2 Obfs",
        capabilities=["hysteria2", "udp", "tls", "obfs", "subscription"],
        required_credential_refs=["password", "obfs_password", "tls_certificate"],
    ),
    _adapter(
        "tuic-v5",
        "TUIC v5",
        capabilities=["tuic", "udp", "tls", "subscription"],
        required_credential_refs=["uuid", "password", "tls_certificate"],
    ),
    _adapter(
        "naiveproxy",
        "NaiveProxy",
        capabilities=["naiveproxy", "https", "tls", "subscription"],
        required_credential_refs=["username", "password", "tls_certificate"],
    ),
    _adapter(
        "socks5",
        "SOCKS5",
        capabilities=["socks", "tcp", "udp", "subscription"],
        required_credential_refs=["username", "password"],
    ),
    _adapter(
        "http-proxy",
        "HTTP Proxy",
        capabilities=["http", "tcp", "subscription"],
        required_credential_refs=["username", "password"],
    ),
    _adapter(
        "trojan",
        "Trojan Legacy",
        status="legacy",
        capabilities=["trojan", "subscription"],
        required_credential_refs=["password"],
    ),
    _adapter(
        "shadowsocks",
        "Shadowsocks Legacy",
        status="legacy",
        capabilities=["shadowsocks", "subscription"],
        required_credential_refs=["password"],
    ),
    _adapter(
        "wireguard",
        "WireGuard Legacy",
        status="legacy",
        capabilities=["wireguard", "subscription"],
        required_credential_refs=["private_key"],
    ),
)
def _protocol_adapter_by_protocol(protocol: str) -> ProtocolAdapterResponse:
    return next(
        (adapter for adapter in PROTOCOL_ADAPTERS if adapter.protocol == protocol),
        None,
    )


LIVE_PROFILE_ADAPTERS = frozenset(
    adapter.protocol for adapter in PROTOCOL_ADAPTERS if adapter.status != "legacy"
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


async def get_profile_computed_config(
    session: AsyncSession,
    *,
    profile_id: UUID,
) -> ProfileComputedConfigResponse:
    profile = await get_profile(session, profile_id=profile_id)
    node = await _get_profile_node(session, profile)
    inbounds = await list_profile_inbounds(session, profile_id=profile.id)
    computed_config = compute_node_outbound_config(profile, inbounds)
    return ProfileComputedConfigResponse(
        profile=profile_response(profile),
        node=_computed_node_response(node),
        inbounds=inbounds,
        computed_config=computed_config,
    )


async def apply_profile_to_node(session: AsyncSession, *, profile_id: UUID):
    """Build a node runtime config for the profile and queue an outbound.apply.

    The payload references client secrets via `clientsRef`; concrete credentials
    are injected by the secret-delivery layer before the command reaches the
    node (node commands must never carry inline secrets).
    """

    from app.domains.ip_control.service import build_ip_control_policy
    from app.domains.node_plugins.service import (
        list_effective_node_plugins,
        plugin_policy_records,
    )
    from app.domains.nodes.schemas import NodeCommandCreateRequest
    from app.domains.nodes.service import enqueue_node_command

    profile = await get_profile(session, profile_id=profile_id)
    if profile.status != "active":
        raise APIError(
            code="profile_not_active",
            message="Only active profiles can be applied to a node.",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )
    node = await _get_profile_node(session, profile)
    inbounds = await list_profile_inbounds(session, profile_id=profile.id)
    plugins = await list_effective_node_plugins(session, node_id=node.id)
    runtime_policy = build_node_runtime_policy(
        plugins=plugin_policy_records(plugins),
        ip_control=await build_ip_control_policy(session),
    )
    runtime_clients = await list_profile_runtime_clients(session, profile=profile)
    payload = build_node_outbound_payload(
        profile,
        inbounds,
        runtime_policy=runtime_policy,
        runtime_clients=runtime_clients,
    )
    return await enqueue_node_command(
        session,
        node_id=node.id,
        request=NodeCommandCreateRequest(command_type="outbound.apply", payload_json=payload),
    )


async def list_profile_inbounds(
    session: AsyncSession,
    *,
    profile_id: UUID,
) -> list[ProfileInboundResponse]:
    profile = await get_profile(session, profile_id=profile_id)
    node = await _get_profile_node(session, profile)
    hosts = await _list_profile_hosts(session, profile_id=profile.id)
    return _profile_inbounds(profile=profile, node=node, hosts=hosts)


async def list_global_profile_inbounds(session: AsyncSession) -> list[ProfileInboundResponse]:
    profiles = await list_profiles(session)
    inbounds: list[ProfileInboundResponse] = []
    for profile in profiles:
        node = await _get_profile_node(session, profile)
        hosts = await _list_profile_hosts(session, profile_id=profile.id)
        inbounds.extend(_profile_inbounds(profile=profile, node=node, hosts=hosts))
    return inbounds


async def create_profile(
    session: AsyncSession,
    *,
    request: ProtocolProfileCreateRequest,
) -> ProtocolProfile:
    await _ensure_node_exists(session, request.node_id)
    if request.squad_id is not None:
        await get_squad(session, squad_id=request.squad_id)
    _ensure_adapter_live_for_active_profile(request.adapter, request.status)
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
        metadata_json=request.metadata_json,
    )
    session.add(profile)
    await session.flush()
    return profile


async def update_profile(
    session: AsyncSession,
    *,
    profile_id: UUID,
    request: ProtocolProfileUpdateRequest,
) -> ProtocolProfile:
    profile = await get_profile(session, profile_id=profile_id)
    data = request.model_dump(exclude_unset=True)
    if "node_id" in data and data["node_id"] is not None:
        await _ensure_node_exists(session, data["node_id"])
    if "squad_id" in data and data["squad_id"] is not None:
        await get_squad(session, squad_id=data["squad_id"])
    if "adapter" in data and data["adapter"] is not None:
        next_status = data.get("status") or profile.status
        _ensure_adapter_live_for_active_profile(data["adapter"], next_status)
    if "status" in data and data["status"] is not None:
        next_adapter = data.get("adapter") or profile.adapter
        _ensure_adapter_live_for_active_profile(next_adapter, data["status"])
    if "name" in data and data["name"] != profile.name:
        await _ensure_unique_name(
            session,
            model=ProtocolProfile,
            name=data["name"],
            code="protocol_profile_name_exists",
            exclude_id=profile.id,
        )
    if "port_reservations" in data and data["port_reservations"] is not None:
        reservations = request.port_reservations or []
        node_id = data.get("node_id") or profile.node_id
        port_check = await check_port_conflicts(
            session,
            request=PortCheckRequest(
                node_id=node_id,
                reservations=reservations,
                exclude_profile_id=profile.id,
            ),
        )
        if port_check.conflicts and not request.allow_port_conflicts:
            raise APIError(
                code="protocol_port_conflict",
                message="Protocol profile conflicts with an existing exclusive bind reservation.",
                status_code=status.HTTP_409_CONFLICT,
                details=[conflict.model_dump_json() for conflict in port_check.conflicts],
            )
        data["port_reservations"] = [reservation.model_dump() for reservation in reservations]
    data.pop("allow_port_conflicts", None)
    for field, value in data.items():
        setattr(profile, field, value)
    await session.flush()
    return profile


async def delete_profile(session: AsyncSession, *, profile_id: UUID) -> None:
    profile = await get_profile(session, profile_id=profile_id)
    await session.delete(profile)
    await session.flush()


async def delete_profiles(session: AsyncSession, *, ids: list[UUID]) -> int:
    profiles = await _get_profiles_by_ids(session, ids)
    for profile in profiles:
        await session.delete(profile)
    await session.flush()
    return len(profiles)


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
    squads = list(result.scalars().all())
    return sorted(squads, key=_squad_sort_key)


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
    await _ensure_unique_name(session, model=Squad, name=request.name, code="squad_name_exists")
    squad = Squad(**request.model_dump())
    session.add(squad)
    await session.flush()
    return squad


async def update_squad(
    session: AsyncSession,
    *,
    squad_id: UUID,
    request: SquadUpdateRequest,
) -> Squad:
    squad = await get_squad(session, squad_id=squad_id)
    data = request.model_dump(exclude_unset=True)
    if "name" in data and data["name"] != squad.name:
        await _ensure_unique_name(
            session,
            model=Squad,
            name=data["name"],
            code="squad_name_exists",
            exclude_id=squad.id,
        )
    for field, value in data.items():
        setattr(squad, field, value)
    await session.flush()
    return squad


async def delete_squad(session: AsyncSession, *, squad_id: UUID) -> None:
    squad = await get_squad(session, squad_id=squad_id)
    await session.delete(squad)
    await session.flush()


async def get_squad_detail(session: AsyncSession, *, squad_id: UUID) -> SquadDetailResponse:
    squad = await get_squad(session, squad_id=squad_id)
    users = await _list_squad_users(session, squad=squad)
    profiles = await _list_squad_profiles(session, squad_id=squad.id)
    hosts = await _list_squad_hosts(session, squad_id=squad.id)
    node_ids = {profile.node_id for profile in profiles} | {host.node_id for host in hosts}
    nodes = await _list_nodes_by_ids(session, node_ids=node_ids)
    inbound_matrix: list[ProfileInboundResponse] = []
    nodes_by_id = {node.id: node for node in nodes}
    for profile in profiles:
        node = nodes_by_id.get(profile.node_id) or await _get_profile_node(session, profile)
        profile_hosts = [host for host in hosts if host.protocol_profile_id == profile.id]
        inbound_matrix.extend(_profile_inbounds(profile=profile, node=node, hosts=profile_hosts))
    return SquadDetailResponse(
        squad=squad_response(squad),
        users=[_squad_user_response(user) for user in users],
        nodes=[_squad_node_response(node) for node in nodes],
        profiles=[_squad_profile_response(profile) for profile in profiles],
        hosts=[_squad_host_response(host) for host in hosts],
        inbound_matrix=inbound_matrix,
    )


async def add_squad_users(
    session: AsyncSession,
    *,
    squad_id: UUID,
    request: SquadUserMutationRequest,
) -> Squad:
    squad = await get_squad(session, squad_id=squad_id)
    await _ensure_users_exist(session, user_ids=request.user_ids)
    current = _squad_user_ids(squad)
    for user_id in request.user_ids:
        if str(user_id) not in current:
            current.append(str(user_id))
    squad.metadata_json = {**squad.metadata_json, "user_ids": current}
    await session.flush()
    return squad


async def remove_squad_users(
    session: AsyncSession,
    *,
    squad_id: UUID,
    request: SquadUserMutationRequest,
) -> Squad:
    squad = await get_squad(session, squad_id=squad_id)
    remove_ids = {str(user_id) for user_id in request.user_ids}
    squad.metadata_json = {
        **squad.metadata_json,
        "user_ids": [user_id for user_id in _squad_user_ids(squad) if user_id not in remove_ids],
    }
    await session.flush()
    return squad


async def reorder_squads(session: AsyncSession, *, request: SquadReorderRequest) -> int:
    result = await session.execute(select(Squad).where(Squad.id.in_(request.ids)))
    squads = list(result.scalars().all())
    if len(squads) != len(set(request.ids)):
        found = {squad.id for squad in squads}
        missing = [str(squad_id) for squad_id in request.ids if squad_id not in found]
        raise APIError(
            code="squad_not_found",
            message="One or more squads were not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            details=missing,
        )
    squads_by_id = {squad.id: squad for squad in squads}
    for order, squad_id in enumerate(request.ids):
        squad = squads_by_id[squad_id]
        squad.metadata_json = {**squad.metadata_json, "order": order}
    await session.flush()
    return len(squads)


async def list_hosts(session: AsyncSession) -> list[Host]:
    result = await session.execute(select(Host).order_by(Host.created_at.desc()))
    hosts = list(result.scalars().all())
    return sorted(hosts, key=_host_sort_key)


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
    await _ensure_unique_name(session, model=Host, name=request.name, code="host_name_exists")
    host = Host(**request.model_dump())
    session.add(host)
    await session.flush()
    return host


async def update_host(
    session: AsyncSession,
    *,
    host_id: UUID,
    request: HostUpdateRequest,
) -> Host:
    host = await get_host(session, host_id=host_id)
    data = request.model_dump(exclude_unset=True)
    if "node_id" in data and data["node_id"] is not None:
        await _ensure_node_exists(session, data["node_id"])
    if "protocol_profile_id" in data and data["protocol_profile_id"] is not None:
        await get_profile(session, profile_id=data["protocol_profile_id"])
    if "squad_id" in data and data["squad_id"] is not None:
        await get_squad(session, squad_id=data["squad_id"])
    if "name" in data and data["name"] != host.name:
        await _ensure_unique_name(
            session,
            model=Host,
            name=data["name"],
            code="host_name_exists",
            exclude_id=host.id,
        )
    for field, value in data.items():
        setattr(host, field, value)
    await session.flush()
    return host


async def delete_host(session: AsyncSession, *, host_id: UUID) -> None:
    host = await get_host(session, host_id=host_id)
    await session.delete(host)
    await session.flush()


async def bulk_update_hosts(
    session: AsyncSession,
    *,
    request: HostBulkActionRequest,
    action: str,
) -> int:
    hosts = await _get_hosts_by_ids(session, request.ids)
    if action == "delete":
        for host in hosts:
            await session.delete(host)
        await session.flush()
        return len(hosts)
    for host in hosts:
        if action == "enable":
            host.status = "active"
        elif action == "disable":
            host.status = "disabled"
        elif action == "set-inbound":
            if request.inbound_tag is None:
                raise APIError(
                    code="host_bulk_inbound_required",
                    message="inbound_tag is required for set-inbound.",
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )
            host.inbound_tag = request.inbound_tag
        elif action == "set-port":
            if request.port is None:
                raise APIError(
                    code="host_bulk_port_required",
                    message="port is required for set-port.",
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )
            host.port = request.port
        else:
            raise APIError(
                code="host_bulk_action_unknown",
                message="Host bulk action is not supported.",
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                details=[action],
            )
    await session.flush()
    return len(hosts)


async def reorder_hosts(session: AsyncSession, *, request: HostReorderRequest) -> int:
    hosts = await _get_hosts_by_ids(session, request.ids)
    hosts_by_id = {host.id: host for host in hosts}
    for order, host_id in enumerate(request.ids):
        host = hosts_by_id[host_id]
        host.metadata_json = {**host.metadata_json, "order": order}
    await session.flush()
    return len(hosts)


async def bulk_set_status(
    session: AsyncSession,
    *,
    model: type[ProtocolProfile] | type[Host] | type[Squad],
    ids: list[UUID],
    status_value: str,
) -> int:
    result = await session.execute(select(model).where(model.id.in_(ids)))
    records = list(result.scalars().all())
    if len(records) != len(set(ids)):
        found = {record.id for record in records}
        missing = [str(record_id) for record_id in ids if record_id not in found]
        raise APIError(
            code="resource_not_found",
            message="One or more resources were not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            details=missing,
        )
    for record in records:
        record.status = status_value
    await session.flush()
    return len(records)


async def _get_hosts_by_ids(session: AsyncSession, ids: list[UUID]) -> list[Host]:
    result = await session.execute(select(Host).where(Host.id.in_(ids)))
    hosts = list(result.scalars().all())
    if len(hosts) != len(set(ids)):
        found = {host.id for host in hosts}
        missing = [str(host_id) for host_id in ids if host_id not in found]
        raise APIError(
            code="host_not_found",
            message="One or more hosts were not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            details=missing,
        )
    return hosts


async def _get_profiles_by_ids(session: AsyncSession, ids: list[UUID]) -> list[ProtocolProfile]:
    result = await session.execute(select(ProtocolProfile).where(ProtocolProfile.id.in_(ids)))
    profiles = list(result.scalars().all())
    if len(profiles) != len(set(ids)):
        found = {profile.id for profile in profiles}
        missing = [str(profile_id) for profile_id in ids if profile_id not in found]
        raise APIError(
            code="protocol_profile_not_found",
            message="One or more protocol profiles were not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            details=missing,
        )
    return profiles


async def _ensure_node_exists(session: AsyncSession, node_id: UUID) -> None:
    node = await session.get(Node, node_id)
    if node is None:
        raise APIError(
            code="node_not_found",
            message="Node was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )


def _ensure_adapter_known(adapter: str) -> None:
    if adapter not in {item.protocol for item in PROTOCOL_ADAPTERS}:
        raise APIError(
            code="protocol_adapter_unknown",
            message="Protocol adapter is not registered.",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            details=[adapter],
        )


def _ensure_adapter_live_for_active_profile(adapter: str, profile_status: str) -> None:
    adapter_def = _protocol_adapter_by_protocol(adapter)
    if adapter_def is None:
        _ensure_adapter_known(adapter)
    if profile_status != "active":
        return
    if adapter_def is None:
        return
    if adapter_def.status != "legacy":
        return
    if profile_status != "active":
        return
    raise APIError(
        code="protocol_adapter_not_live",
        message=(
            "This protocol adapter is legacy in current MVP and can be used in disabled state only "
            "until its node-agent runtime, "
            "renderer, and client compatibility checks are complete."
        ),
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        details=[adapter],
    )


async def _ensure_unique_name(
    session: AsyncSession,
    *,
    model: type[ProtocolProfile] | type[Host] | type[Squad],
    name: str,
    code: str,
    exclude_id: UUID | None = None,
) -> None:
    existing = (await session.execute(select(model).where(model.name == name))).scalar_one_or_none()
    if existing is not None and existing.id != exclude_id:
        raise APIError(
            code=code,
            message="Resource name already exists.",
            status_code=status.HTTP_409_CONFLICT,
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
        metadata_json=profile.metadata_json,
    )


def _computed_node_response(node: Node) -> ProfileComputedNodeResponse:
    return ProfileComputedNodeResponse(
        id=node.id,
        name=node.name,
        region=node.region,
        public_address=node.public_address,
        status=node.status,
        capabilities=node.capabilities,
    )


def squad_response(squad: Squad) -> SquadResponse:
    return SquadResponse(
        id=squad.id,
        name=squad.name,
        kind=squad.kind,
        status=squad.status,
        metadata_json=squad.metadata_json,
    )


def _squad_user_response(user: User) -> SquadUserResponse:
    return SquadUserResponse(
        id=user.id,
        email=user.email,
        username=user.username,
        display_name=user.display_name,
        status=user.status,
        tags=user.tags,
    )


def _squad_node_response(node: Node) -> SquadNodeResponse:
    return SquadNodeResponse(
        id=node.id,
        name=node.name,
        region=node.region,
        public_address=node.public_address,
        status=node.status,
    )


def _squad_profile_response(profile: ProtocolProfile) -> SquadProfileResponse:
    return SquadProfileResponse(
        id=profile.id,
        name=profile.name,
        adapter=profile.adapter,
        node_id=profile.node_id,
        status=profile.status,
        inbounds=[
            _inbound_tag(profile=profile, hosts=[], index=index)
            for index, _reservation in enumerate(profile.port_reservations)
        ],
    )


def _squad_host_response(host: Host) -> SquadHostResponse:
    return SquadHostResponse(
        id=host.id,
        name=host.name,
        hostname=host.hostname,
        node_id=host.node_id,
        protocol_profile_id=host.protocol_profile_id,
        status=host.status,
        inbound_tag=host.inbound_tag,
        port=host.port,
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
        address=host.address,
        port=host.port,
        inbound_tag=host.inbound_tag,
        remark=host.remark,
        metadata_json=host.metadata_json,
    )


def _host_sort_key(host: Host) -> tuple[int, str]:
    order = host.metadata_json.get("order")
    if isinstance(order, int):
        return (order, host.name)
    if isinstance(order, str) and order.isdigit():
        return (int(order), host.name)
    return (1_000_000, host.name)


def _squad_sort_key(squad: Squad) -> tuple[int, str]:
    order = squad.metadata_json.get("order")
    if isinstance(order, int):
        return (order, squad.name)
    if isinstance(order, str) and order.isdigit():
        return (int(order), squad.name)
    return (1_000_000, squad.name)


def _squad_user_ids(squad: Squad) -> list[str]:
    user_ids = squad.metadata_json.get("user_ids")
    if not isinstance(user_ids, list):
        return []
    return [str(user_id) for user_id in user_ids]


async def _ensure_users_exist(session: AsyncSession, *, user_ids: list[UUID]) -> None:
    result = await session.execute(select(User.id).where(User.id.in_(user_ids)))
    found = set(result.scalars().all())
    if len(found) != len(set(user_ids)):
        missing = [str(user_id) for user_id in user_ids if user_id not in found]
        raise APIError(
            code="user_not_found",
            message="One or more users were not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            details=missing,
        )


async def _list_squad_users(session: AsyncSession, *, squad: Squad) -> list[User]:
    user_ids = _squad_user_ids(squad)
    if not user_ids:
        return []
    result = await session.execute(
        select(User).where(User.id.in_([UUID(user_id) for user_id in user_ids]))
    )
    users = list(result.scalars().all())
    users_by_id = {str(user.id): user for user in users}
    return [users_by_id[user_id] for user_id in user_ids if user_id in users_by_id]


async def _list_squad_profiles(session: AsyncSession, *, squad_id: UUID) -> list[ProtocolProfile]:
    result = await session.execute(
        select(ProtocolProfile)
        .where(ProtocolProfile.squad_id == squad_id)
        .order_by(ProtocolProfile.created_at.desc(), ProtocolProfile.name.asc())
    )
    return list(result.scalars().all())


async def _list_squad_hosts(session: AsyncSession, *, squad_id: UUID) -> list[Host]:
    result = await session.execute(
        select(Host)
        .where(Host.squad_id == squad_id)
        .order_by(Host.created_at.desc(), Host.name.asc())
    )
    return list(result.scalars().all())


async def _list_nodes_by_ids(session: AsyncSession, *, node_ids: set[UUID]) -> list[Node]:
    if not node_ids:
        return []
    result = await session.execute(
        select(Node).where(Node.id.in_(node_ids)).order_by(Node.name.asc())
    )
    return list(result.scalars().all())


async def _get_profile_node(session: AsyncSession, profile: ProtocolProfile) -> Node:
    node = await session.get(Node, profile.node_id)
    if node is None:
        raise APIError(
            code="profile_node_not_found",
            message="Protocol profile node was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            details=[str(profile.node_id)],
        )
    return node


async def _list_profile_hosts(session: AsyncSession, *, profile_id: UUID) -> list[Host]:
    result = await session.execute(
        select(Host)
        .where(Host.protocol_profile_id == profile_id)
        .order_by(Host.created_at.desc(), Host.name.asc())
    )
    return list(result.scalars().all())


def _profile_inbounds(
    *,
    profile: ProtocolProfile,
    node: Node,
    hosts: list[Host],
) -> list[ProfileInboundResponse]:
    reservations = profile.port_reservations or []
    if not reservations and hosts:
        reservations = [_reservation_from_host(host) for host in hosts if host.port is not None]
    if not reservations:
        config_port = profile.config_json.get("port")
        if config_port is None:
            return []
        reservations = [_reservation_from_profile_defaults(profile, port=config_port)]

    return [
        _profile_inbound_response(
            profile=profile,
            node=node,
            hosts=hosts,
            reservation=reservation,
            index=index,
        )
        for index, reservation in enumerate(reservations)
    ]


def _profile_inbound_response(
    *,
    profile: ProtocolProfile,
    node: Node,
    hosts: list[Host],
    reservation: dict[str, object],
    index: int,
) -> ProfileInboundResponse:
    port = _port_from_reservation(reservation)
    return ProfileInboundResponse(
        profile_id=profile.id,
        profile_name=profile.name,
        node_id=node.id,
        node_name=node.name,
        adapter=profile.adapter,
        status=profile.status,
        tag=_inbound_tag(profile=profile, hosts=hosts, index=index),
        protocol=_inbound_protocol(profile.adapter),
        listen=str(reservation.get("address") or WILDCARD_BIND_ADDRESS),
        port=port,
        transport=_inbound_transport(profile),
        security=_inbound_security(profile),
        credentials_ref=profile.credentials_ref,
        hosts=[_host_binding_response(host) for host in hosts],
        config_json=profile.config_json,
    )


def _computed_xray_config(
    profile: ProtocolProfile,
    inbounds: list[ProfileInboundResponse],
    *,
    runtime_clients: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    config = deepcopy(profile.config_json)
    if not isinstance(config, dict):
        config = {}
    config.setdefault("log", {"loglevel": "warning"})
    config.setdefault("routing", {"rules": []})
    config.setdefault(
        "inbounds",
        [_xray_inbound(inbound, runtime_clients=runtime_clients) for inbound in inbounds],
    )
    return config


def _xray_inbound(
    inbound: ProfileInboundResponse,
    *,
    runtime_clients: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    return {
        "tag": inbound.tag,
        "listen": inbound.listen,
        "port": inbound.port,
        "protocol": inbound.protocol,
        "settings": _xray_inbound_settings(inbound, runtime_clients=runtime_clients),
        "streamSettings": {
            "network": inbound.transport,
            "security": inbound.security,
        },
    }


def _xray_inbound_settings(
    inbound: ProfileInboundResponse,
    *,
    runtime_clients: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    clients = runtime_clients or []
    if inbound.protocol == "vless":
        settings: dict[str, object] = {
            "decryption": "none",
            "clients": [
                {
                    "id": str(client["uuid"]),
                    "email": str(client["public_id"]),
                    **(
                        {"flow": str(client["flow"])}
                        if str(client.get("flow") or "").strip()
                        else {}
                    ),
                }
                for client in clients
            ],
        }
    elif inbound.protocol == "vmess":
        settings = {
            "clients": [
                {
                    "id": str(client["uuid"]),
                    "alterId": 0,
                    "email": str(client["public_id"]),
                }
                for client in clients
            ],
        }
    elif inbound.protocol == "trojan":
        settings = {
            "clients": [
                {
                    "password": str(client["password"]),
                    "email": str(client["public_id"]),
                }
                for client in clients
            ],
        }
    else:
        settings = {}
    if not clients and inbound.credentials_ref is not None:
        settings["clientsRef"] = inbound.credentials_ref
    return settings


# -- node runtime config generation (panel -> node outbound.apply payload) -----
#
# Each generator returns the node-runtime config for one adapter family in the
# exact shape the node-agent dispatcher reads (xrayConfig / hysteria2Config /
# tuicConfig / wireguardConfig). Client secrets are referenced via `clientsRef`
# (a vault reference) and resolved to concrete credentials by the secret layer
# before the command reaches the node; the node-agent rejects any config that
# still contains an unresolved `clientsRef`/`credentialsRef`.

_NODE_CONFIG_KEY_BY_FAMILY = {
    "hysteria2": "hysteria2Config",
    "tuic": "tuicConfig",
    "wireguard": "wireguardConfig",
    "xray": "xrayConfig",
}


def _adapter_family(adapter: str) -> str:
    protocol = _inbound_protocol(adapter)
    if protocol in {"hysteria2", "tuic", "wireguard"}:
        return protocol
    return "xray"


def _first_inbound_port(inbounds: list[ProfileInboundResponse]) -> int | None:
    for inbound in inbounds:
        port = getattr(inbound, "port", None)
        if port:
            return int(port)
    return None


def _profile_config_dict(profile: ProtocolProfile) -> dict[str, object]:
    config = deepcopy(profile.config_json)
    return config if isinstance(config, dict) else {}


async def list_profile_runtime_clients(
    session: AsyncSession,
    *,
    profile: ProtocolProfile,
) -> list[dict[str, object]]:
    """Return concrete per-subscription credentials for this profile's node config."""

    result = await session.execute(
        select(Subscription).where(
            Subscription.node_id == profile.node_id,
            Subscription.status.in_(["active", "paid", "trial"]),
        )
    )
    subscriptions = list(result.scalars().all())
    clients: list[dict[str, object]] = []
    settings = get_settings()
    for subscription in subscriptions:
        delivery = (
            subscription.delivery_profile
            if isinstance(subscription.delivery_profile, dict)
            else {}
        )
        delivery_profile_id = str(delivery.get("profile_id") or "")
        delivery_adapter = str(delivery.get("adapter") or delivery.get("protocol") or "")
        if delivery_profile_id and delivery_profile_id != str(profile.id):
            continue
        if not delivery_profile_id and delivery_adapter and delivery_adapter != profile.adapter:
            continue
        if not delivery_profile_id and not delivery_adapter:
            continue

        protocol_type = str(delivery.get("protocol") or profile.adapter)
        credentials = derive_client_credentials(
            settings=settings,
            subscription_id=subscription.public_id,
            credentials_ref=profile.credentials_ref,
            protocol_id=delivery.get("protocol_id") or protocol_type,
            protocol_type=protocol_type,
        )
        clients.append(
            {
                "public_id": subscription.public_id,
                "uuid": credentials.uuid,
                "password": credentials.password,
                "shadowsocks_password": credentials.shadowsocks_password,
                "hysteria_password": credentials.hysteria_password,
                "wireguard_private_key": credentials.wireguard_private_key,
                "wireguard_public_key": credentials.wireguard_public_key,
                "flow": delivery.get("flow") or profile.config_json.get("flow"),
                "address": delivery.get("address"),
            }
        )
    return clients


def _computed_hysteria2_config(
    profile: ProtocolProfile,
    port: int | None,
    *,
    runtime_clients: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    config = _profile_config_dict(profile)
    config.setdefault("listen", f":{port}" if port else ":443")
    config.setdefault("tls", config.get("tls") or {})
    clients = runtime_clients or []
    if clients:
        config["auth"] = {
            "type": "password",
            "password": str(clients[0]["hysteria_password"]),
        }
        config.pop("clientsRef", None)
    else:
        config["clientsRef"] = profile.credentials_ref
    return config


def _computed_tuic_config(
    profile: ProtocolProfile,
    port: int | None,
    *,
    runtime_clients: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    config = _profile_config_dict(profile)
    config.setdefault("server", f":{port}" if port else ":443")
    config.setdefault("congestion_control", config.get("congestion_control") or "bbr")
    clients = runtime_clients or []
    if clients:
        config["users"] = {
            str(client["uuid"]): str(client["password"])
            for client in clients
        }
        config.pop("clientsRef", None)
    else:
        config["clientsRef"] = profile.credentials_ref
    return config


def _computed_wireguard_config(
    profile: ProtocolProfile,
    port: int | None,
    *,
    runtime_clients: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    config = _profile_config_dict(profile)
    interface = dict(config.get("interface") or {})
    interface.setdefault("listen_port", port or 51820)
    interface.setdefault("address", config.get("address") or "10.66.0.1/24")
    config["interface"] = interface
    clients = runtime_clients or []
    if clients:
        config["peers"] = [
            {
                "public_key": str(client["wireguard_public_key"]),
                "allowed_ips": str(client.get("address") or f"10.66.0.{index + 2}/32"),
            }
            for index, client in enumerate(clients)
        ]
        config.pop("clientsRef", None)
    else:
        config["clientsRef"] = profile.credentials_ref
    return config


def compute_node_outbound_config(
    profile: ProtocolProfile,
    inbounds: list[ProfileInboundResponse],
    *,
    runtime_clients: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    family = _adapter_family(profile.adapter)
    if family == "hysteria2":
        return _computed_hysteria2_config(
            profile,
            _first_inbound_port(inbounds),
            runtime_clients=runtime_clients,
        )
    if family == "tuic":
        return _computed_tuic_config(
            profile,
            _first_inbound_port(inbounds),
            runtime_clients=runtime_clients,
        )
    if family == "wireguard":
        return _computed_wireguard_config(
            profile,
            _first_inbound_port(inbounds),
            runtime_clients=runtime_clients,
        )
    return _computed_xray_config(profile, inbounds, runtime_clients=runtime_clients)


def build_node_outbound_payload(
    profile: ProtocolProfile,
    inbounds: list[ProfileInboundResponse],
    *,
    runtime_policy: dict[str, object] | None = None,
    runtime_clients: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    """Build the ``outbound.apply`` command payload the panel sends to a node."""

    family = _adapter_family(profile.adapter)
    config_key = _NODE_CONFIG_KEY_BY_FAMILY[family]
    config = compute_node_outbound_config(profile, inbounds, runtime_clients=runtime_clients)
    if family == "xray" and runtime_policy is not None:
        config = _apply_xray_policy(config, runtime_policy)
    payload = {
        "adapter": profile.adapter,
        "profileId": str(profile.id),
        config_key: config,
    }
    if runtime_policy is not None:
        payload["nodePolicy"] = runtime_policy
    return payload


def build_node_runtime_policy(
    *,
    plugins: list[dict[str, object]],
    ip_control: dict[str, object] | None,
) -> dict[str, object] | None:
    if not plugins and ip_control is None:
        return None
    policy: dict[str, object] = {
        "modelVersion": "lumen.node-policy.v1",
        "plugins": plugins,
    }
    if ip_control is not None:
        policy["ipControl"] = ip_control
    return policy


def _apply_xray_policy(
    config: dict[str, object],
    policy: dict[str, object],
) -> dict[str, object]:
    next_config = deepcopy(config)
    plugins = policy.get("plugins")
    if not isinstance(plugins, list):
        return next_config
    blocking_rules = _xray_blocking_rules_from_plugins(plugins)
    if not blocking_rules:
        return next_config

    outbounds = next_config.get("outbounds")
    if not isinstance(outbounds, list):
        outbounds = []
    if not any(isinstance(item, dict) and item.get("tag") == "blocked" for item in outbounds):
        outbounds.append({"tag": "blocked", "protocol": "blackhole"})
    next_config["outbounds"] = outbounds

    routing = next_config.get("routing")
    if not isinstance(routing, dict):
        routing = {}
    existing_rules = routing.get("rules")
    if not isinstance(existing_rules, list):
        existing_rules = []
    routing["rules"] = blocking_rules + existing_rules
    next_config["routing"] = routing
    return next_config


def _xray_blocking_rules_from_plugins(plugins: list[object]) -> list[dict[str, object]]:
    rules: list[dict[str, object]] = []
    for item in plugins:
        if not isinstance(item, dict) or item.get("enabled") is False:
            continue
        kind = str(item.get("kind") or "")
        config = item.get("config")
        config_dict = config if isinstance(config, dict) else {}
        action = str(config_dict.get("action") or config_dict.get("mode") or "block")
        if action not in {"block", "drop", "blackhole"}:
            continue
        if kind == "torrent-blocker":
            rules.append(
                {
                    "type": "field",
                    "protocol": ["bittorrent"],
                    "outboundTag": "blocked",
                }
            )
        elif kind == "domain-filter":
            domains = _string_list(config_dict.get("domains"))
            if domains:
                rules.append(
                    {
                        "type": "field",
                        "domain": domains,
                        "outboundTag": "blocked",
                    }
                )
        elif kind == "geoip-filter":
            countries = _string_list(config_dict.get("countries") or config_dict.get("geoip"))
            if countries:
                rules.append(
                    {
                        "type": "field",
                        "ip": [f"geoip:{country.lower()}" for country in countries],
                        "outboundTag": "blocked",
                    }
                )
    return rules


def _string_list(value: object) -> list[str]:
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def _host_binding_response(host: Host) -> ProfileInboundHostBindingResponse:
    return ProfileInboundHostBindingResponse(
        id=host.id,
        name=host.name,
        hostname=host.hostname,
        address=host.address,
        port=host.port,
        inbound_tag=host.inbound_tag,
        status=host.status,
        tags=host.tags,
        remark=host.remark,
    )


def _reservation_from_host(host: Host) -> dict[str, object]:
    return {
        "address": host.address or WILDCARD_BIND_ADDRESS,
        "port": host.port,
        "protocol": "tcp",
        "exclusive": True,
    }


def _reservation_from_profile_defaults(
    profile: ProtocolProfile,
    *,
    port: object,
) -> dict[str, object]:
    return {
        "address": WILDCARD_BIND_ADDRESS,
        "port": port,
        "protocol": "udp" if _inbound_transport(profile) == "udp" else "tcp",
        "exclusive": True,
    }


def _port_from_reservation(reservation: dict[str, object]) -> int:
    try:
        port = int(str(reservation["port"]))
    except (KeyError, TypeError, ValueError) as exc:
        raise APIError(
            code="profile_inbound_port_invalid",
            message="Protocol profile inbound reservation has an invalid port.",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            details=["profile.port_reservations.port"],
        ) from exc
    if port < 1 or port > 65535:
        raise APIError(
            code="profile_inbound_port_invalid",
            message="Protocol profile inbound reservation has an out-of-range port.",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            details=["profile.port_reservations.port"],
        )
    return port


def _inbound_tag(*, profile: ProtocolProfile, hosts: list[Host], index: int) -> str:
    host_tag = next((host.inbound_tag for host in hosts if host.inbound_tag), None)
    config_tag = profile.config_json.get("tag")
    if isinstance(config_tag, str) and config_tag:
        return config_tag
    if host_tag is not None:
        return host_tag
    suffix = "" if index == 0 else f"-{index + 1}"
    return f"{profile.adapter}-{profile.id}{suffix}"


def _inbound_protocol(adapter: str) -> str:
    if adapter.startswith("vless"):
        return "vless"
    if adapter.startswith("vmess"):
        return "vmess"
    if adapter.startswith("trojan"):
        return "trojan"
    if adapter.startswith("shadowsocks"):
        return "shadowsocks"
    if adapter.startswith("wireguard"):
        return "wireguard"
    if adapter.startswith("hysteria2"):
        return "hysteria2"
    if adapter.startswith("tuic"):
        return "tuic"
    if adapter == "naiveproxy":
        return "http"
    if adapter == "socks5":
        return "socks"
    if adapter == "http-proxy":
        return "http"
    return adapter.split("-", maxsplit=1)[0]


def _inbound_transport(profile: ProtocolProfile) -> str:
    network = profile.config_json.get("network") or profile.config_json.get("transport")
    if isinstance(network, str) and network:
        return network
    if "grpc" in profile.adapter:
        return "grpc"
    if "xhttp" in profile.adapter:
        return "xhttp"
    if "httpupgrade" in profile.adapter:
        return "httpupgrade"
    if "-ws" in profile.adapter or "websocket" in profile.adapter:
        return "ws"
    if profile.adapter in {"wireguard-native", "wireguard-amneziawg", "hysteria2", "tuic-v5"}:
        return "udp"
    return "tcp"


def _inbound_security(profile: ProtocolProfile) -> str:
    security = profile.config_json.get("security")
    if isinstance(security, dict) and isinstance(security.get("type"), str):
        return str(security["type"])
    if "reality" in profile.adapter:
        return "reality"
    if "tls" in profile.adapter or profile.adapter in {"hysteria2", "tuic-v5", "naiveproxy"}:
        return "tls"
    return "none"


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
