from copy import deepcopy
from datetime import UTC, datetime, timedelta
from uuid import UUID

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import APIError
from app.domains.nodes.models import Node, NodeCommand
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
from app.domains.subscriptions.renderers import (
    derive_client_credentials,
    shadowsocks_password_for_method,
)
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
        status="legacy",
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
        status="experimental",
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
        "openvpn-udp",
        "OpenVPN UDP",
        capabilities=["openvpn", "udp", "tls", "subscription"],
        required_credential_refs=["username", "password", "server_certificate"],
    ),
    _adapter(
        "openvpn-shadowsocks",
        "OpenVPN over Shadowsocks",
        capabilities=["openvpn", "shadowsocks", "tcp", "tls", "subscription"],
        required_credential_refs=["username", "password", "shadowsocks_password"],
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

RUNTIME_SYNC_METADATA_KEY = "runtime_sync"
PROFILE_RUNTIME_FIELDS = frozenset(
    {
        "adapter",
        "config_json",
        "credentials_ref",
        "node_id",
        "port_reservations",
        "squad_id",
        "status",
    }
)
HOST_RUNTIME_FIELDS = frozenset(
    {
        "address",
        "excluded_internal_squad_ids",
        "final_mask",
        "hidden",
        "hostname",
        "inbound_tag",
        "mihomo_x25519_public_key",
        "mux_json",
        "node_id",
        "path",
        "port",
        "protocol_profile_id",
        "security",
        "shuffle_host",
        "sni",
        "sockopt_json",
        "squad_id",
        "status",
        "subscription_excluded",
        "tags",
        "xhttp_json",
        "xray_template_json",
    }
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

    The payload carries concrete runtime credentials derived from active real
    subscriptions bound to the profile/node. Apply is rejected when no real
    subscription exists so production cannot queue placeholder configs.
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
    runtime_clients = await list_profile_runtime_clients(session, profile=profile)
    if not runtime_clients:
        raise APIError(
            code="profile_runtime_clients_required",
            message=(
                "Profile apply requires at least one active real subscription "
                "bound to this profile and node."
            ),
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )
    plugins = await list_effective_node_plugins(session, node_id=node.id)
    runtime_policy = build_node_runtime_policy(
        plugins=plugin_policy_records(plugins),
        ip_control=await build_ip_control_policy(session),
    )
    if _adapter_family(profile.adapter) == "xray":
        payload = await build_node_xray_outbound_payload(
            session,
            node_id=node.id,
            target_profile=profile,
            runtime_policy=runtime_policy,
        )
    else:
        payload = build_node_outbound_payload(
            profile,
            inbounds,
            runtime_policy=runtime_policy,
            runtime_clients=runtime_clients,
        )
    command = await enqueue_node_command(
        session,
        node_id=node.id,
        request=NodeCommandCreateRequest(command_type="outbound.apply", payload_json=payload),
    )
    _mark_profile_apply_queued(profile, command=command)
    await _mark_profile_hosts_apply_queued(session, profile_id=profile.id, command=command)
    await session.flush()
    return command


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
    _ensure_openvpn_profile_pki(profile)
    _mark_profile_runtime_pending(
        profile,
        reason="profile.created",
        changed_fields=[
            "adapter",
            "config_json",
            "credentials_ref",
            "node_id",
            "port_reservations",
            "squad_id",
            "status",
        ],
    )
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
    changed_fields: list[str] = []
    for field, value in data.items():
        if field in PROFILE_RUNTIME_FIELDS and getattr(profile, field) != value:
            changed_fields.append(field)
        setattr(profile, field, value)
    await session.flush()
    _ensure_openvpn_profile_pki(profile)
    if changed_fields:
        _mark_profile_runtime_pending(
            profile,
            reason="profile.updated",
            changed_fields=changed_fields,
        )
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
    _mark_host_runtime_pending(
        host,
        reason="host.created",
        changed_fields=sorted(HOST_RUNTIME_FIELDS),
    )
    if host.protocol_profile_id is not None:
        await _mark_profile_runtime_pending_by_id(
            session,
            profile_id=host.protocol_profile_id,
            reason="host.created",
            changed_fields=["hosts"],
        )
    await session.flush()
    return host


async def update_host(
    session: AsyncSession,
    *,
    host_id: UUID,
    request: HostUpdateRequest,
) -> Host:
    host = await get_host(session, host_id=host_id)
    previous_profile_id = host.protocol_profile_id
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
    changed_fields: list[str] = []
    for field, value in data.items():
        if field in HOST_RUNTIME_FIELDS and getattr(host, field) != value:
            changed_fields.append(field)
        setattr(host, field, value)
    await session.flush()
    if changed_fields:
        _mark_host_runtime_pending(
            host,
            reason="host.updated",
            changed_fields=changed_fields,
        )
        affected_profile_ids = {
            profile_id
            for profile_id in (previous_profile_id, host.protocol_profile_id)
            if profile_id is not None
        }
        for profile_id in affected_profile_ids:
            await _mark_profile_runtime_pending_by_id(
                session,
                profile_id=profile_id,
                reason="host.updated",
                changed_fields=["hosts", *changed_fields],
            )
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
        changed_fields: list[str] = []
        if action == "enable":
            if host.status != "active":
                changed_fields.append("status")
            host.status = "active"
        elif action == "disable":
            if host.status != "disabled":
                changed_fields.append("status")
            host.status = "disabled"
        elif action == "set-inbound":
            if request.inbound_tag is None:
                raise APIError(
                    code="host_bulk_inbound_required",
                    message="inbound_tag is required for set-inbound.",
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )
            if host.inbound_tag != request.inbound_tag:
                changed_fields.append("inbound_tag")
            host.inbound_tag = request.inbound_tag
        elif action == "set-port":
            if request.port is None:
                raise APIError(
                    code="host_bulk_port_required",
                    message="port is required for set-port.",
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )
            if host.port != request.port:
                changed_fields.append("port")
            host.port = request.port
        else:
            raise APIError(
                code="host_bulk_action_unknown",
                message="Host bulk action is not supported.",
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                details=[action],
            )
        if changed_fields:
            _mark_host_runtime_pending(
                host,
                reason=f"host.bulk.{action}",
                changed_fields=changed_fields,
            )
            if host.protocol_profile_id is not None:
                await _mark_profile_runtime_pending_by_id(
                    session,
                    profile_id=host.protocol_profile_id,
                    reason=f"host.bulk.{action}",
                    changed_fields=["hosts", *changed_fields],
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
        if isinstance(record, ProtocolProfile) and record.status != status_value:
            _mark_profile_runtime_pending(
                record,
                reason="profile.bulk.status",
                changed_fields=["status"],
            )
        elif isinstance(record, Host) and record.status != status_value:
            _mark_host_runtime_pending(
                record,
                reason="host.bulk.status",
                changed_fields=["status"],
            )
            if record.protocol_profile_id is not None:
                await _mark_profile_runtime_pending_by_id(
                    session,
                    profile_id=record.protocol_profile_id,
                    reason="host.bulk.status",
                    changed_fields=["hosts", "status"],
                )
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


def _utc_iso() -> str:
    return datetime.now(UTC).isoformat()


def _metadata_with_runtime_sync(
    metadata: dict[str, object],
    runtime_sync: dict[str, object],
) -> dict[str, object]:
    next_metadata = deepcopy(metadata or {})
    next_metadata[RUNTIME_SYNC_METADATA_KEY] = runtime_sync
    return next_metadata


def _runtime_sync_from_metadata(metadata: dict[str, object] | None) -> dict[str, object]:
    value = (metadata or {}).get(RUNTIME_SYNC_METADATA_KEY)
    if isinstance(value, dict):
        return deepcopy(value)
    return {"pending_apply": False, "status": "never_applied"}


def _mark_profile_runtime_pending(
    profile: ProtocolProfile,
    *,
    reason: str,
    changed_fields: list[str],
) -> None:
    current = _runtime_sync_from_metadata(profile.metadata_json)
    existing_fields = {
        str(field)
        for field in current.get("changed_fields", [])
        if isinstance(field, str) and field
    }
    existing_fields.update(changed_fields)
    runtime_sync: dict[str, object] = {
        **current,
        "changed_at": _utc_iso(),
        "changed_fields": sorted(existing_fields),
        "node_id": str(profile.node_id),
        "pending_apply": True,
        "profile_id": str(profile.id),
        "reason": reason,
        "status": "pending_apply",
    }
    profile.metadata_json = _metadata_with_runtime_sync(profile.metadata_json, runtime_sync)


async def _mark_profile_runtime_pending_by_id(
    session: AsyncSession,
    *,
    profile_id: UUID,
    reason: str,
    changed_fields: list[str],
) -> None:
    profile = await session.get(ProtocolProfile, profile_id)
    if profile is not None:
        _mark_profile_runtime_pending(profile, reason=reason, changed_fields=changed_fields)


def _mark_host_runtime_pending(
    host: Host,
    *,
    reason: str,
    changed_fields: list[str],
) -> None:
    current = _runtime_sync_from_metadata(host.metadata_json)
    existing_fields = {
        str(field)
        for field in current.get("changed_fields", [])
        if isinstance(field, str) and field
    }
    existing_fields.update(changed_fields)
    runtime_sync: dict[str, object] = {
        **current,
        "changed_at": _utc_iso(),
        "changed_fields": sorted(existing_fields),
        "host_id": str(host.id),
        "node_id": str(host.node_id),
        "pending_apply": True,
        "profile_id": str(host.protocol_profile_id) if host.protocol_profile_id else None,
        "reason": reason,
        "status": "pending_apply",
    }
    host.metadata_json = _metadata_with_runtime_sync(host.metadata_json, runtime_sync)


def _mark_profile_apply_queued(profile: ProtocolProfile, *, command: NodeCommand) -> None:
    current = _runtime_sync_from_metadata(profile.metadata_json)
    runtime_sync: dict[str, object] = {
        **current,
        "last_apply_queued_at": _utc_iso(),
        "last_command_id": str(command.id),
        "node_id": str(command.node_id),
        "pending_apply": True,
        "profile_id": str(profile.id),
        "status": "apply_queued",
    }
    profile.metadata_json = _metadata_with_runtime_sync(profile.metadata_json, runtime_sync)


def _mark_host_apply_queued(host: Host, *, command: NodeCommand) -> None:
    current = _runtime_sync_from_metadata(host.metadata_json)
    runtime_sync: dict[str, object] = {
        **current,
        "last_apply_queued_at": _utc_iso(),
        "last_command_id": str(command.id),
        "node_id": str(command.node_id),
        "pending_apply": True,
        "profile_id": str(host.protocol_profile_id) if host.protocol_profile_id else None,
        "status": "apply_queued",
    }
    host.metadata_json = _metadata_with_runtime_sync(host.metadata_json, runtime_sync)


async def _mark_profile_hosts_apply_queued(
    session: AsyncSession,
    *,
    profile_id: UUID,
    command: NodeCommand,
) -> None:
    hosts = await _list_profile_hosts(session, profile_id=profile_id)
    for host in hosts:
        runtime_sync = _runtime_sync_from_metadata(host.metadata_json)
        if runtime_sync.get("pending_apply") is True:
            _mark_host_apply_queued(host, command=command)


async def record_outbound_apply_result(
    session: AsyncSession,
    *,
    command: NodeCommand,
) -> None:
    if command.command_type != "outbound.apply":
        return
    profile_ids = _profile_ids_from_apply_command(command)
    if not profile_ids:
        return
    profiles = (
        await session.execute(select(ProtocolProfile).where(ProtocolProfile.id.in_(profile_ids)))
    ).scalars().all()
    hosts = (
        await session.execute(select(Host).where(Host.protocol_profile_id.in_(profile_ids)))
    ).scalars().all()
    if command.status == "succeeded":
        applied_at = command.completed_at.isoformat() if command.completed_at else _utc_iso()
        for profile in profiles:
            _mark_runtime_applied(profile, command=command, applied_at=applied_at)
        for host in hosts:
            _mark_runtime_applied(host, command=command, applied_at=applied_at)
    elif command.status == "failed":
        failed_at = command.completed_at.isoformat() if command.completed_at else _utc_iso()
        for profile in profiles:
            _mark_runtime_apply_failed(profile, command=command, failed_at=failed_at)
        for host in hosts:
            _mark_runtime_apply_failed(host, command=command, failed_at=failed_at)


def _profile_ids_from_apply_command(command: NodeCommand) -> list[UUID]:
    raw_profile_ids = command.payload_json.get("profileIds")
    if isinstance(raw_profile_ids, list):
        candidates = raw_profile_ids
    else:
        candidates = [command.payload_json.get("profileId")]
    profile_ids: list[UUID] = []
    for candidate in candidates:
        try:
            if candidate is not None:
                profile_ids.append(UUID(str(candidate)))
        except ValueError:
            continue
    return profile_ids


def _mark_runtime_applied(
    resource: ProtocolProfile | Host,
    *,
    command: NodeCommand,
    applied_at: str,
) -> None:
    current = _runtime_sync_from_metadata(resource.metadata_json)
    runtime_sync: dict[str, object] = {
        **current,
        "applied_command_id": str(command.id),
        "last_applied_at": applied_at,
        "last_command_id": str(command.id),
        "node_id": str(command.node_id),
        "pending_apply": False,
        "status": "applied",
    }
    runtime_sync.pop("changed_fields", None)
    resource.metadata_json = _metadata_with_runtime_sync(resource.metadata_json, runtime_sync)


def _mark_runtime_apply_failed(
    resource: ProtocolProfile | Host,
    *,
    command: NodeCommand,
    failed_at: str,
) -> None:
    current = _runtime_sync_from_metadata(resource.metadata_json)
    runtime_sync: dict[str, object] = {
        **current,
        "error_code": command.error_code,
        "error_message": command.error_message,
        "failed_command_id": str(command.id),
        "last_failed_at": failed_at,
        "last_command_id": str(command.id),
        "node_id": str(command.node_id),
        "pending_apply": True,
        "status": "apply_failed",
    }
    resource.metadata_json = _metadata_with_runtime_sync(resource.metadata_json, runtime_sync)


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
        runtime_sync=_runtime_sync_from_metadata(profile.metadata_json),
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
        path=host.path,
        security=host.security,
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
        path=host.path,
        sni=host.sni,
        security=host.security,
        xray_template_json=host.xray_template_json,
        mux_json=host.mux_json,
        sockopt_json=host.sockopt_json,
        xhttp_json=host.xhttp_json,
        subscription_excluded=host.subscription_excluded,
        hidden=host.hidden,
        excluded_internal_squad_ids=host.excluded_internal_squad_ids,
        shuffle_host=host.shuffle_host,
        final_mask=host.final_mask,
        mihomo_x25519_public_key=host.mihomo_x25519_public_key,
        remark=host.remark,
        metadata_json=host.metadata_json,
        runtime_sync=_runtime_sync_from_metadata(host.metadata_json),
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
    config.setdefault("outbounds", [{"tag": "direct", "protocol": "freedom"}])
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
    xray_template = _primary_host_dict(inbound, "xray_template_json")
    base = deepcopy(xray_template) if xray_template else {}
    if not isinstance(base, dict):
        base = {}
    base.update(
        {
            "tag": inbound.tag,
            "listen": inbound.listen,
            "port": inbound.port,
            "protocol": inbound.protocol,
            "settings": _xray_inbound_settings(inbound, runtime_clients=runtime_clients),
            "streamSettings": _xray_inbound_stream_settings(inbound),
        }
    )
    return base


def _primary_host(inbound: ProfileInboundResponse) -> ProfileInboundHostBindingResponse | None:
    visible_hosts = [
        host
        for host in inbound.hosts
        if not host.subscription_excluded and not host.hidden and host.status == "active"
    ]
    return visible_hosts[0] if visible_hosts else (inbound.hosts[0] if inbound.hosts else None)


def _primary_host_dict(inbound: ProfileInboundResponse, key: str) -> dict[str, object]:
    host = _primary_host(inbound)
    value = getattr(host, key, None) if host is not None else None
    return deepcopy(value) if isinstance(value, dict) else {}


def _primary_host_string(inbound: ProfileInboundResponse, key: str) -> str | None:
    host = _primary_host(inbound)
    value = getattr(host, key, None) if host is not None else None
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _effective_inbound_transport(inbound: ProfileInboundResponse) -> str:
    xhttp = _primary_host_dict(inbound, "xhttp_json")
    if xhttp:
        return "xhttp"
    return inbound.transport


def _effective_inbound_security(inbound: ProfileInboundResponse) -> str:
    return _primary_host_string(inbound, "security") or inbound.security


def _effective_config_with_host(inbound: ProfileInboundResponse) -> dict[str, object]:
    config = deepcopy(inbound.config_json)
    if not isinstance(config, dict):
        config = {}
    host_path = _primary_host_string(inbound, "path")
    host_sni = _primary_host_string(inbound, "sni")
    if host_path is not None:
        config["path"] = host_path
    if host_sni is not None:
        config["host"] = host_sni
        security_value = config.get("security")
        security = deepcopy(security_value) if isinstance(security_value, dict) else {}
        security["serverName"] = host_sni
        config["security"] = security
    xhttp = _primary_host_dict(inbound, "xhttp_json")
    if xhttp:
        config["xhttp"] = xhttp
    return config


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
    elif inbound.protocol == "shadowsocks":
        password = (
            str(clients[0]["shadowsocks_password"])
            if clients
            else ""
        )
        settings = {
            "method": str(inbound.config_json.get("method") or "aes-256-gcm"),
            "password": password,
            "network": str(inbound.config_json.get("network") or "tcp,udp"),
        }
    elif inbound.protocol == "socks":
        settings = {
            "auth": "password",
            "accounts": [
                {
                    "user": str(client["public_id"]),
                    "pass": str(client["password"]),
                }
                for client in clients
            ],
            "udp": True,
        }
    elif inbound.protocol == "http":
        settings = {
            "accounts": [
                {
                    "user": str(client["public_id"]),
                    "pass": str(client["password"]),
                }
                for client in clients
            ],
        }
    else:
        settings = {}
    if not clients and inbound.credentials_ref is not None:
        settings["clientsRef"] = inbound.credentials_ref
    return settings


def _xray_inbound_stream_settings(inbound: ProfileInboundResponse) -> dict[str, object]:
    transport = _effective_inbound_transport(inbound)
    security = _effective_inbound_security(inbound)
    config = _effective_config_with_host(inbound)
    stream: dict[str, object] = {
        "network": transport,
        "security": security,
    }
    mux = _primary_host_dict(inbound, "mux_json")
    sockopt = _primary_host_dict(inbound, "sockopt_json")
    if mux:
        stream["mux"] = mux
    if sockopt:
        stream["sockopt"] = sockopt
    transport_settings = _xray_transport_settings(
        transport,
        config,
    )
    stream.update(transport_settings)
    security_value = config.get("security")
    security_config = security_value if isinstance(security_value, dict) else {}
    if security == "reality":
        server_name = str(
            security_config.get("serverName")
            or security_config.get("server_name")
            or _primary_host_string(inbound, "sni")
            or "www.cloudflare.com"
        )
        short_id = str(security_config.get("shortId") or security_config.get("short_id") or "")
        stream["realitySettings"] = _compact_object(
            {
                "show": bool(security_config.get("show", False)),
                "dest": str(security_config.get("dest") or f"{server_name}:443"),
                "xver": int(security_config.get("xver") or 0),
                "serverNames": [server_name],
                "privateKey": security_config.get("privateKey")
                or security_config.get("private_key"),
                "shortIds": [short_id],
            }
        )
    elif security == "tls":
        certificates = security_config.get("certificates")
        if isinstance(certificates, list) and certificates:
            stream["tlsSettings"] = {"certificates": certificates}
    return _compact_object(stream)


def _xray_transport_settings(
    transport: str,
    config: dict[str, object],
) -> dict[str, object]:
    path = str(config.get("path") or "/")
    host = config.get("host") or config.get("serverName") or config.get("server_name")
    if transport == "ws":
        headers = {"Host": str(host)} if host else None
        return {"wsSettings": _compact_object({"path": path, "headers": headers})}
    if transport == "grpc":
        service_name = str(
            config.get("serviceName")
            or config.get("service_name")
            or config.get("grpc_service_name")
            or "lumen"
        )
        return {"grpcSettings": {"serviceName": service_name}}
    if transport == "httpupgrade":
        return {
            "httpupgradeSettings": _compact_object(
                {"path": path, "host": str(host) if host else None}
            )
        }
    if transport == "xhttp":
        xhttp_config = config.get("xhttp") if isinstance(config.get("xhttp"), dict) else {}
        return {
            "xhttpSettings": _compact_object(
                {
                    "path": path,
                    "host": str(host) if host else None,
                    "mode": str(xhttp_config.get("mode") or config.get("mode") or "auto"),
                    **xhttp_config,
                }
            )
        }
    return {}


def _compact_object(value: dict[str, object]) -> dict[str, object]:
    return {
        key: child
        for key, child in value.items()
        if child is not None and child != [] and child != {}
    }


# -- node runtime config generation (panel -> node outbound.apply payload) -----
#
# Each generator returns the node-runtime config for one adapter family in the
# exact shape the node-agent dispatcher reads (xrayConfig / hysteria2Config /
# tuicConfig / wireguardConfig). The panel resolves active subscription clients
# into concrete runtime credentials before queueing the command; node-agent
# rejects configs that still contain unresolved `clientsRef`/`credentialsRef`.

_NODE_CONFIG_KEY_BY_FAMILY = {
    "hysteria2": "hysteria2Config",
    "naive": "naiveConfig",
    "openvpn": "openvpnConfig",
    "openvpn-shadowsocks": "openvpnShadowsocksConfig",
    "sing-box-shadowsocks": "singBoxShadowsocksConfig",
    "shadowsocks-plugin": "shadowsocksPluginConfig",
    "tuic": "tuicConfig",
    "wireguard": "wireguardConfig",
    "xray": "xrayConfig",
}
_DEFAULT_NODE_TLS_CERT_PATH = "/var/lib/lumen-node/runtime/tls/live.crt"
_DEFAULT_NODE_TLS_KEY_PATH = "/var/lib/lumen-node/runtime/tls/live.key"


def _adapter_family(adapter: str) -> str:
    if adapter == "naiveproxy":
        return "naive"
    if adapter == "openvpn-shadowsocks":
        return "openvpn-shadowsocks"
    if adapter.startswith("openvpn"):
        return "openvpn"
    if adapter == "shadowsocks-2022":
        return "sing-box-shadowsocks"
    if adapter in {"shadowsocks-v2ray-plugin", "shadowsocks-obfs"}:
        return "shadowsocks-plugin"
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


def _ensure_node_tls_paths(config: dict[str, object]) -> None:
    if isinstance(config.get("tls"), dict):
        tls = dict(config["tls"])  # type: ignore[index]
    else:
        tls = {}
    if isinstance(tls.get("cert"), str) and isinstance(tls.get("key"), str):
        config["tls"] = tls
        return
    if isinstance(tls.get("acme"), dict):
        config["tls"] = tls
        return
    tls.setdefault("cert", _DEFAULT_NODE_TLS_CERT_PATH)
    tls.setdefault("key", _DEFAULT_NODE_TLS_KEY_PATH)
    config["tls"] = tls


def _ensure_tuic_tls_paths(config: dict[str, object]) -> None:
    if isinstance(config.get("certificate"), str) and isinstance(config.get("private_key"), str):
        return
    if isinstance(config.get("acme"), dict):
        return
    config.setdefault("certificate", _DEFAULT_NODE_TLS_CERT_PATH)
    config.setdefault("private_key", _DEFAULT_NODE_TLS_KEY_PATH)


def _ensure_naive_tls_paths(config: dict[str, object]) -> None:
    _ensure_node_tls_paths(config)


def _pem_private_key(private_key) -> str:
    return private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")


def _pem_certificate(certificate: x509.Certificate) -> str:
    return certificate.public_bytes(serialization.Encoding.PEM).decode("ascii")


def _generate_openvpn_pki(*, common_name: str) -> dict[str, str]:
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    server_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = datetime.now(UTC)
    ca_subject = x509.Name(
        [
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Lumen"),
            x509.NameAttribute(NameOID.COMMON_NAME, f"Lumen OpenVPN CA {common_name}"),
        ]
    )
    ca_cert = (
        x509.CertificateBuilder()
        .subject_name(ca_subject)
        .issuer_name(ca_subject)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                key_cert_sign=True,
                crl_sign=True,
                key_encipherment=False,
                content_commitment=False,
                data_encipherment=False,
                key_agreement=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .sign(ca_key, hashes.SHA256())
    )
    server_subject = x509.Name(
        [
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Lumen"),
            x509.NameAttribute(NameOID.COMMON_NAME, f"Lumen OpenVPN Server {common_name}"),
        ]
    )
    server_cert = (
        x509.CertificateBuilder()
        .subject_name(server_subject)
        .issuer_name(ca_cert.subject)
        .public_key(server_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=825))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                key_encipherment=True,
                key_cert_sign=False,
                crl_sign=False,
                content_commitment=False,
                data_encipherment=False,
                key_agreement=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),
            critical=False,
        )
        .sign(ca_key, hashes.SHA256())
    )
    return {
        "ca_cert": _pem_certificate(ca_cert),
        "server_cert": _pem_certificate(server_cert),
        "server_key": _pem_private_key(server_key),
    }


def _ensure_openvpn_profile_pki(profile: ProtocolProfile) -> None:
    if not profile.adapter.startswith("openvpn"):
        return
    metadata = dict(profile.metadata_json or {})
    pki = metadata.get("openvpn_pki") if isinstance(metadata.get("openvpn_pki"), dict) else {}
    if all(
        isinstance(pki.get(key), str) and pki[key]
        for key in ("ca_cert", "server_cert", "server_key")
    ):
        return
    metadata["openvpn_pki"] = _generate_openvpn_pki(common_name=str(profile.id))
    profile.metadata_json = metadata


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
        shadowsocks_method = str(
            profile.config_json.get("method")
            or delivery.get("method")
            or "2022-blake3-aes-128-gcm"
        )
        clients.append(
            {
                "public_id": subscription.public_id,
                "uuid": credentials.uuid,
                "password": credentials.password,
                "shadowsocks_password": shadowsocks_password_for_method(
                    credentials,
                    shadowsocks_method,
                ),
                "hysteria_password": credentials.hysteria_password,
                "hysteria_obfs_password": credentials.hysteria_obfs_password,
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
    _ensure_node_tls_paths(config)
    clients = runtime_clients or []
    if clients:
        config["auth"] = {
            "type": "password",
            "password": str(clients[0]["hysteria_password"]),
        }
        if profile.adapter == "hysteria2-obfs":
            obfs = dict(config.get("obfs") or {})
            obfs.setdefault("type", "salamander")
            obfs["password"] = str(clients[0]["hysteria_obfs_password"])
            config["obfs"] = obfs
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
    _ensure_tuic_tls_paths(config)
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


def _computed_naive_config(
    profile: ProtocolProfile,
    port: int | None,
    *,
    runtime_clients: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    config = _profile_config_dict(profile)
    config.setdefault("listen", f":{port}" if port else ":443")
    _ensure_naive_tls_paths(config)
    clients = runtime_clients or []
    if clients:
        config["users"] = [
            {
                "username": str(client["public_id"]),
                "password": str(client["password"]),
            }
            for client in clients
        ]
        config.pop("clientsRef", None)
    else:
        config["clientsRef"] = profile.credentials_ref
    return config


def _profile_openvpn_pki(profile: ProtocolProfile) -> dict[str, str]:
    metadata = profile.metadata_json if isinstance(profile.metadata_json, dict) else {}
    pki = metadata.get("openvpn_pki") if isinstance(metadata.get("openvpn_pki"), dict) else {}
    if all(
        isinstance(pki.get(key), str) and pki[key]
        for key in ("ca_cert", "server_cert", "server_key")
    ):
        return {
            "ca_cert": str(pki["ca_cert"]),
            "server_cert": str(pki["server_cert"]),
            "server_key": str(pki["server_key"]),
        }
    return _generate_openvpn_pki(common_name=str(profile.id))


def _computed_openvpn_config(
    profile: ProtocolProfile,
    port: int | None,
    *,
    runtime_clients: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    config = _profile_config_dict(profile)
    config.setdefault("listen_port", port or 1194)
    config.setdefault("proto", "udp")
    config.setdefault("network", "10.88.0.0/24")
    config["pki"] = _profile_openvpn_pki(profile)
    clients = runtime_clients or []
    if clients:
        config["users"] = [
            {
                "username": str(client["public_id"]),
                "password": str(client["password"]),
            }
            for client in clients
        ]
        config.pop("clientsRef", None)
    else:
        config["clientsRef"] = profile.credentials_ref
    return config


def _computed_openvpn_shadowsocks_config(
    profile: ProtocolProfile,
    port: int | None,
    *,
    runtime_clients: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    config = _profile_config_dict(profile)
    openvpn_config = dict(config.get("openvpn") or {})
    shadowsocks_config = dict(config.get("shadowsocks") or {})
    bridge_port = int(openvpn_config.get("listen_port") or config.get("openvpn_port") or 1194)
    bridge_profile = ProtocolProfile(
        id=profile.id,
        adapter="openvpn-shadowsocks",
        credentials_ref=profile.credentials_ref,
        config_json={
            **openvpn_config,
            "listen_port": bridge_port,
            "proto": "tcp-server",
            "local_address": "127.0.0.1",
            "network": openvpn_config.get("network") or config.get("network") or "10.89.0.0/24",
        },
        metadata_json=profile.metadata_json,
    )
    shadowsocks_config.setdefault("listen", WILDCARD_BIND_ADDRESS)
    shadowsocks_config.setdefault("listen_port", port or config.get("listen_port") or 8388)
    shadowsocks_config.setdefault("method", config.get("method") or "aes-256-gcm")
    clients = runtime_clients or []
    if clients:
        shadowsocks_config["password"] = str(clients[0]["shadowsocks_password"])
    else:
        shadowsocks_config["clientsRef"] = profile.credentials_ref
    return {
        "openvpn": _computed_openvpn_config(
            bridge_profile,
            bridge_port,
            runtime_clients=runtime_clients,
        ),
        "shadowsocks": shadowsocks_config,
    }


def _computed_sing_box_shadowsocks_config(
    profile: ProtocolProfile,
    port: int | None,
    *,
    runtime_clients: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    config = _profile_config_dict(profile)
    config.setdefault("listen", "::")
    config.setdefault("listen_port", port or 8388)
    config.setdefault("method", "2022-blake3-aes-128-gcm")
    config.setdefault("network", "tcp")
    clients = runtime_clients or []
    if clients:
        config["password"] = str(clients[0]["shadowsocks_password"])
        config.pop("clientsRef", None)
    else:
        config["clientsRef"] = profile.credentials_ref
    return config


def _computed_shadowsocks_plugin_config(
    profile: ProtocolProfile,
    port: int | None,
    *,
    runtime_clients: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    config = _profile_config_dict(profile)
    config.setdefault("listen_port", port or 8388)
    config.setdefault("method", "aes-256-gcm")
    config.setdefault("network", "tcp")
    if profile.adapter == "shadowsocks-obfs":
        config.setdefault("listen", WILDCARD_BIND_ADDRESS)
        config["plugin"] = "obfs-server"
        config.setdefault("obfs", "http")
        config.setdefault("obfs_host", "www.bing.com")
        obfs = str(config.get("obfs") or "http")
        obfs_host = str(config.get("obfs_host") or "www.bing.com")
        config["plugin_opts"] = str(
            config.get("plugin_opts") or f"obfs={obfs};obfs-host={obfs_host}"
        )
    else:
        config.setdefault("listen", "::")
        config["plugin"] = "v2ray-plugin"
        config.setdefault("plugin_opts", "server")
    clients = runtime_clients or []
    if clients:
        config["password"] = str(clients[0]["shadowsocks_password"])
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
    if family == "naive":
        return _computed_naive_config(
            profile,
            _first_inbound_port(inbounds),
            runtime_clients=runtime_clients,
        )
    if family == "openvpn":
        return _computed_openvpn_config(
            profile,
            _first_inbound_port(inbounds),
            runtime_clients=runtime_clients,
        )
    if family == "openvpn-shadowsocks":
        return _computed_openvpn_shadowsocks_config(
            profile,
            _first_inbound_port(inbounds),
            runtime_clients=runtime_clients,
        )
    if family == "sing-box-shadowsocks":
        return _computed_sing_box_shadowsocks_config(
            profile,
            _first_inbound_port(inbounds),
            runtime_clients=runtime_clients,
        )
    if family == "shadowsocks-plugin":
        return _computed_shadowsocks_plugin_config(
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
    if family == "wireguard" and profile.adapter == "wireguard-amneziawg":
        payload["wireguardReloadMode"] = "awg-quick"
    if runtime_policy is not None:
        payload["nodePolicy"] = runtime_policy
    return payload


async def build_node_xray_outbound_payload(
    session: AsyncSession,
    *,
    node_id: UUID,
    target_profile: ProtocolProfile,
    runtime_policy: dict[str, object] | None = None,
) -> dict[str, object]:
    """Build a single Xray config containing every real active Xray inbound on a node."""

    active_profiles = (
        await session.execute(
            select(ProtocolProfile)
            .where(
                ProtocolProfile.node_id == node_id,
                ProtocolProfile.status == "active",
            )
            .order_by(ProtocolProfile.created_at.asc())
        )
    ).scalars().all()

    profile_payloads: list[tuple[ProtocolProfile, dict[str, object]]] = []
    target_profile_has_clients = False
    for profile in active_profiles:
        if _adapter_family(profile.adapter) != "xray":
            continue
        inbounds = await list_profile_inbounds(session, profile_id=profile.id)
        runtime_clients = await list_profile_runtime_clients(session, profile=profile)
        if not runtime_clients:
            if profile.id == target_profile.id:
                target_profile_has_clients = False
            continue
        if profile.id == target_profile.id:
            target_profile_has_clients = True
        profile_payloads.append(
            (
                profile,
                _computed_xray_config(profile, inbounds, runtime_clients=runtime_clients),
            )
        )

    if not target_profile_has_clients:
        raise APIError(
            code="profile_runtime_clients_required",
            message=(
                "Profile apply requires at least one active real subscription "
                "bound to this profile and node."
            ),
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )

    xray_config = merge_xray_profile_configs([config for _, config in profile_payloads])
    if runtime_policy is not None:
        xray_config = _apply_xray_policy(xray_config, runtime_policy)
    payload: dict[str, object] = {
        "adapter": target_profile.adapter,
        "profileId": str(target_profile.id),
        "xrayConfig": xray_config,
        "profileIds": [str(profile.id) for profile, _ in profile_payloads],
    }
    if runtime_policy is not None:
        payload["nodePolicy"] = runtime_policy
    return payload


def merge_xray_profile_configs(profile_configs: list[dict[str, object]]) -> dict[str, object]:
    merged: dict[str, object] = {
        "log": {"loglevel": "warning"},
        "routing": {"rules": []},
        "outbounds": [{"tag": "direct", "protocol": "freedom"}],
        "inbounds": [],
    }
    outbound_tags = {"direct"}
    routing_rules: list[object] = []
    inbounds: list[object] = []

    for config in profile_configs:
        if isinstance(config.get("log"), dict):
            merged["log"] = deepcopy(config["log"])
        config_outbounds = config.get("outbounds")
        if isinstance(config_outbounds, list):
            for outbound in config_outbounds:
                if not isinstance(outbound, dict):
                    continue
                tag = str(outbound.get("tag") or "")
                if tag and tag in outbound_tags:
                    continue
                if tag:
                    outbound_tags.add(tag)
                merged["outbounds"].append(deepcopy(outbound))  # type: ignore[index]
        routing = config.get("routing")
        if isinstance(routing, dict) and isinstance(routing.get("rules"), list):
            routing_rules.extend(deepcopy(routing["rules"]))
        config_inbounds = config.get("inbounds")
        if isinstance(config_inbounds, list):
            inbounds.extend(deepcopy(config_inbounds))

    merged["routing"] = {"rules": routing_rules}
    merged["inbounds"] = inbounds
    return merged


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
    next_config["inbounds"] = _xray_inbounds_with_policy_sniffing(next_config.get("inbounds"))
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


def _xray_inbounds_with_policy_sniffing(value: object) -> list[object]:
    if not isinstance(value, list):
        return []
    next_inbounds: list[object] = []
    for inbound in value:
        if not isinstance(inbound, dict):
            next_inbounds.append(deepcopy(inbound))
            continue
        next_inbound = deepcopy(inbound)
        sniffing = next_inbound.get("sniffing")
        sniffing_config = deepcopy(sniffing) if isinstance(sniffing, dict) else {}
        existing_dest_override = _string_list(sniffing_config.get("destOverride"))
        for protocol in ("http", "tls", "quic"):
            if protocol not in existing_dest_override:
                existing_dest_override.append(protocol)
        sniffing_config.update(
            {
                "enabled": True,
                "destOverride": existing_dest_override,
                "routeOnly": True,
            }
        )
        next_inbound["sniffing"] = sniffing_config
        next_inbounds.append(next_inbound)
    return next_inbounds


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
        path=host.path,
        sni=host.sni,
        security=host.security,
        xray_template_json=host.xray_template_json,
        mux_json=host.mux_json,
        sockopt_json=host.sockopt_json,
        xhttp_json=host.xhttp_json,
        subscription_excluded=host.subscription_excluded,
        hidden=host.hidden,
        final_mask=host.final_mask,
        mihomo_x25519_public_key=host.mihomo_x25519_public_key,
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
        return "naive"
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
    if profile.adapter in {
        "wireguard-native",
        "wireguard-amneziawg",
        "hysteria2",
        "tuic-v5",
        "openvpn-udp",
    }:
        return "udp"
    if profile.adapter == "openvpn-shadowsocks":
        return "tcp"
    return "tcp"


def _inbound_security(profile: ProtocolProfile) -> str:
    security = profile.config_json.get("security")
    if isinstance(security, dict) and isinstance(security.get("type"), str):
        return str(security["type"])
    if "reality" in profile.adapter:
        return "reality"
    if "tls" in profile.adapter or profile.adapter in {
        "hysteria2",
        "tuic-v5",
        "naiveproxy",
        "openvpn-udp",
        "openvpn-shadowsocks",
    }:
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
