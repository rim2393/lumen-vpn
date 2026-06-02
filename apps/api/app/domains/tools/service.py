import base64
import ipaddress
import json
import re
from datetime import UTC, datetime
from urllib.parse import urlparse
from uuid import UUID, uuid4

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import padding, x25519
from fastapi import status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import APIError
from app.core.rbac import Principal
from app.domains.audit.models import AuditEvent
from app.domains.audit.service import record_audit_event
from app.domains.auth.models import UserSession
from app.domains.auth.service import revoke_session
from app.domains.ip_control.models import IpControlEvent
from app.domains.nodes.models import Node
from app.domains.nodes.schemas import NodeCommandCreateRequest, NodeCommandResponse
from app.domains.nodes.service import NODE_TOKEN_PREFIX, enqueue_node_command, generate_node_token
from app.domains.settings.models import PanelSetting
from app.domains.subscriptions.models import Subscription
from app.domains.subscriptions.renderers import build_subscription_headers
from app.domains.subscriptions.service import build_subscription_manifest
from app.domains.tools.schemas import (
    DropConnectionsRequest,
    DropConnectionsResponse,
    HappRoutingBuildRequest,
    HappRoutingBuildResponse,
    HappRoutingResponse,
    HappRoutingRow,
    HwidDeviceRecord,
    HwidInspectorResponse,
    HwidInspectorRow,
    NodeKeyResponse,
    NodeUserIpRecord,
    NodeUserIpResponse,
    SessionInspectorResponse,
    SessionInspectorRow,
    SrhInspectorResponse,
    SrhInspectorRow,
    ToolSnippetCreateRequest,
    ToolSnippetListResponse,
    ToolSnippetRecord,
    ToolSnippetUpdateRequest,
    ToolSummaryResponse,
    TopUserResponse,
    TopUserRow,
    TorrentReportResponse,
    TorrentReportRow,
    UserIpRecord,
    UserIpResponse,
    X25519KeypairResponse,
)
from app.domains.users.models import User

SNIPPETS_SETTING_KEY = "tools.snippets"
SECRET_LIKE_PATTERN = re.compile(
    r"(password|passwd|token|secret|private[_ -]?key|api[_ -]?key|bearer\s+[a-z0-9._-]+)",
    re.IGNORECASE,
)
HAPP_PUBLIC_KEY_V3 = b"""-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAlBetA0wjbaj+h7oJ/d/h
pNrXvAcuhOdFGEFcfCxSWyLzWk4SAQ05gtaEGZyetTax2uqagi9HT6lapUSUe2S8
nMLJf5K+LEs9TYrhhBdx/B0BGahA+lPJa7nUwp7WfUmSF4hir+xka5ApHjzkAQn6
cdG6FKtSPgq1rYRPd1jRf2maEHwiP/e/jqdXLPP0SFBjWTMt/joUDgE7v/IGGB0L
Q7mGPAlgmxwUHVqP4bJnZ//5sNLxWMjtYHOYjaV+lixNSfhFM3MdBndjpkmgSfmg
D5uYQYDL29TDk6Eu+xetUEqry8ySPjUbNWdDXCglQWMxDGjaqYXMWgxBA1UKjUBW
wbgr5yKTJ7mTqhlYEC9D5V/LOnKd6pTSvaMxkHXwk8hBWvUNWAxzAf5JZ7EVE3jt
0j682+/hnmL/hymUE44yMG1gCcWvSpB3BTlKoMnl4yrTakmdkbASeFRkN3iMRewa
IenvMhzJh1fq7xwX94otdd5eLB2vRFavrnhOcN2JJAkKTnx9dwQwFpGEkg+8U613
+Tfm/f82l56fFeoFN98dD2mUFLFZoeJ5CG81ZeXrH83niI0joX7rtoAZIPWzq3Y1
Zb/Zq+kK2hSIhphY172Uvs8X2Qp2ac9UoTPM71tURsA9IvPNvUwSIo/aKlX5KE3I
VE0tje7twWXL5Gb1sfcXRzsCAwEAAQ==
-----END PUBLIC KEY-----"""
HAPP_PUBLIC_KEY_V4 = b"""-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA3UZ0M3L4K+WjM3vkbQnz
ozHg/cRbEXvQ6i4A8RVN4OM3rK9kU01FdjyoIgywve8OEKsFnVwERZAQZ1Trv60B
hmaM76QQEE+EUlIOL9EpwKWGtTL5lYC1sT9XJMNP3/CI0gP5wwQI88cY/xedpOEB
W72EmOOShHUm/b/3m+HPmqwc4ugKj5zWV5SyiT829aFA5DxSjmIIFBAms7DafmSq
LFTYIQL5cShDY2u+/sqyAw9yZIOoqW2TFIgIHhLPWek/ocDU7zyOrlu1E0SmcQQb
LFqHq02fsnH6IcqTv3N5Adb/CkZDDQ6HvQVBmqbKZKf7ZdXkqsc/Zw27xhG7OfXC
tUmWsiL7zA+KoTd3avyOh93Q9ju4UQsHthL3Gs4vECYOCS9dsXXSHEY/1ngU/hjO
WFF8QEE/rYV6nA4PTyUvo5RsctSQL/9DJX7XNh3zngvif8LsCN2MPvx6X+zLouBX
zgBkQ9DFfZAGLWf9TR7KVjZC/3NsuUCDoAOcpmN8pENBbeB0puiKMMWSvll36+2M
YR1Xs0MgT8Y9TwhE2+TnnTJOhzmHi/BxiUlY/w2E0s4ax9GHAmX0wyF4zeV7kDkc
vHuEdc0d7vDmdw0oqCqWj0Xwq86HfORu6tm1A8uRATjb4SzjTKclKuoElVAVa5Jo
oh/uZMozC65SmDw+N5p6Su8CAwEAAQ==
-----END PUBLIC KEY-----"""
HAPP_ROUTING_MAX_PROFILE_BYTES = 32_768


async def inspect_hwid(session: AsyncSession, *, query: str | None = None) -> HwidInspectorResponse:
    result = await session.execute(select(User).order_by(User.email))
    needle = query.strip().lower() if query else None
    rows = []
    for user in result.scalars().all():
        device_records = _device_records(user.metadata_json)
        subscription_ids = sorted(
            {
                device.subscription_id
                for device in device_records
                if device.subscription_id is not None
            }
        )
        if needle and not _hwid_row_matches(user, device_records, subscription_ids, needle):
            continue
        device_count = len(device_records)
        if user.device_limit is not None and device_count > user.device_limit:
            status = "over_limit"
        elif user.device_limit is None:
            status = "unlimited"
        else:
            status = "ok"
        rows.append(
            HwidInspectorRow(
                user_id=user.id,
                username=user.username,
                email=user.email,
                device_limit=user.device_limit,
                device_count=device_count,
                status=status,
                devices=[device.label for device in device_records],
                device_records=device_records,
                subscription_ids=subscription_ids,
            )
        )
    return HwidInspectorResponse(items=rows)


async def inspect_srh(session: AsyncSession, *, settings: Settings) -> SrhInspectorResponse:
    result = await session.execute(select(Subscription).order_by(Subscription.created_at.desc()))
    rows = []
    for subscription in result.scalars().all():
        parser = (
            subscription.delivery_profile.get("client")
            or subscription.delivery_profile.get("format")
            or "generic"
        )
        response_headers = await _real_subscription_headers(
            session,
            settings=settings,
            subscription=subscription,
            parser=parser,
        )
        rows.append(
            SrhInspectorRow(
                subscription_id=subscription.id,
                public_id=subscription.public_id,
                user_id=subscription.user_id,
                status=subscription.status,
                parser=parser,
                config_hash=subscription.config_hash,
                response_headers=response_headers,
            )
        )
    return SrhInspectorResponse(items=rows)


async def inspect_sessions(
    session: AsyncSession,
    *,
    principal: Principal | None = None,
) -> SessionInspectorResponse:
    result = await session.execute(
        select(UserSession, User.email)
        .outerjoin(User, User.id == UserSession.user_id)
        .order_by(UserSession.created_at.desc())
        .limit(200)
    )
    now = datetime.now(UTC)
    rows = []
    for user_session, email in result.all():
        status = (
            "revoked"
            if user_session.revoked_at
            else "expired"
            if _is_expired(user_session.expires_at, now)
            else "active"
        )
        rows.append(
            SessionInspectorRow(
                id=user_session.id,
                user_id=user_session.user_id,
                email=email,
                status=status,
                is_current=principal.session_id == user_session.id if principal else False,
                ip_fingerprint=_short_fingerprint(user_session.ip_hash),
                user_agent_fingerprint=_short_fingerprint(user_session.user_agent_hash),
                expires_at=user_session.expires_at,
                revoked_at=user_session.revoked_at,
                created_at=user_session.created_at,
                updated_at=user_session.updated_at,
            )
        )
    return SessionInspectorResponse(items=rows)


async def revoke_inspected_session(
    session: AsyncSession,
    *,
    session_id: UUID,
    principal: Principal,
) -> SessionInspectorRow:
    user_session = await revoke_session(session, session_id=session_id)
    await record_audit_event(
        session,
        principal=principal,
        action="session.revoked",
        resource_type="user_session",
        resource_id=str(user_session.id),
        metadata_json={
            "user_id": str(user_session.user_id),
            "revoked_current_session": str(principal.session_id == user_session.id).lower(),
        },
    )
    user = await session.get(User, user_session.user_id)
    now = datetime.now(UTC)
    status = (
        "revoked"
        if user_session.revoked_at
        else "expired"
        if _is_expired(user_session.expires_at, now)
        else "active"
    )
    return SessionInspectorRow(
        id=user_session.id,
        user_id=user_session.user_id,
        email=user.email if user else None,
        status=status,
        is_current=principal.session_id == user_session.id,
        ip_fingerprint=_short_fingerprint(user_session.ip_hash),
        user_agent_fingerprint=_short_fingerprint(user_session.user_agent_hash),
        expires_at=user_session.expires_at,
        revoked_at=user_session.revoked_at,
        created_at=user_session.created_at,
        updated_at=user_session.updated_at,
    )


async def inspect_torrent_reports(session: AsyncSession) -> TorrentReportResponse:
    result = await session.execute(
        select(AuditEvent)
        .where(
            or_(
                AuditEvent.action.ilike("%torrent%"),
                AuditEvent.resource_type.ilike("%torrent%"),
            )
        )
        .order_by(AuditEvent.created_at.desc())
        .limit(200)
    )
    return TorrentReportResponse(
        items=[
            TorrentReportRow(
                id=event.id,
                action=event.action,
                actor_email=event.actor_email,
                resource_id=event.resource_id,
                metadata_json=event.metadata_json,
                created_at=event.created_at,
            )
            for event in result.scalars().all()
        ]
    )


async def truncate_torrent_reports(
    session: AsyncSession,
    *,
    principal: Principal,
) -> TorrentReportResponse:
    existing = await inspect_torrent_reports(session)
    if existing.items:
        await session.execute(
            delete(AuditEvent).where(
                or_(
                    AuditEvent.action.ilike("%torrent%"),
                    AuditEvent.resource_type.ilike("%torrent%"),
                )
            )
        )
    await record_audit_event(
        session,
        principal=principal,
        action="tool.reports.truncated",
        resource_type="maintenance",
        resource_id="torrent-blocker-reports",
        metadata_json={"report_type": "torrent", "deleted": str(len(existing.items))},
    )
    return await inspect_torrent_reports(session)


async def inspect_happ_routing(session: AsyncSession) -> HappRoutingResponse:
    result = await session.execute(
        select(Subscription, User.username, Node.name, Node.status, Node.last_seen_at)
        .outerjoin(User, User.id == Subscription.user_id)
        .outerjoin(Node, Node.id == Subscription.node_id)
        .order_by(Subscription.created_at.desc())
        .limit(500)
    )
    rows = []
    for subscription, username, node_name, node_status, node_last_seen_at in result.all():
        client = (subscription.delivery_profile.get("client") or "").lower()
        parser = (subscription.delivery_profile.get("format") or "").lower()
        is_happ = "happ" in {client, parser}
        route_status = "happ" if is_happ else "generic"
        if subscription.node_id is None:
            route_status = "unassigned"
        elif not is_happ:
            route_status = "not_happ"
        elif node_status != "active":
            route_status = "node_unavailable"
        elif node_last_seen_at is None:
            route_status = "node_pending_heartbeat"
        rows.append(
            HappRoutingRow(
                subscription_id=subscription.id,
                public_id=subscription.public_id,
                user_id=subscription.user_id,
                username=username,
                node_id=subscription.node_id,
                node_name=node_name,
                node_status=node_status,
                route_status=route_status,
                delivery_profile=subscription.delivery_profile,
            )
        )
    return HappRoutingResponse(items=rows)


async def build_happ_routing_payload(
    session: AsyncSession,
    *,
    request: HappRoutingBuildRequest,
    principal: Principal,
) -> HappRoutingBuildResponse:
    profile_json = request.profile_json
    if request.mode != "off" and profile_json is None:
        raise APIError(
            code="happ_routing_profile_required",
            message="HApp routing profile JSON is required for add/onadd links.",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    if profile_json is not None:
        _reject_secret_like_json(profile_json, path="profile_json")

    encoded_profile: str | None = None
    profile_bytes = 0
    profile_name: str | None = None
    if request.mode == "off":
        routing_link = "happ://routing/off"
        routing_header = routing_link
    else:
        assert profile_json is not None
        profile_payload = json.dumps(
            profile_json,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        profile_bytes = len(profile_payload)
        if profile_bytes > HAPP_ROUTING_MAX_PROFILE_BYTES:
            raise APIError(
                code="happ_routing_profile_too_large",
                message="HApp routing profile JSON is too large.",
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                details=[str(profile_bytes), str(HAPP_ROUTING_MAX_PROFILE_BYTES)],
            )
        encoded_profile = base64.b64encode(profile_payload).decode("ascii")
        routing_link = f"happ://routing/{request.mode}/{encoded_profile}"
        routing_header = routing_link
        profile_name_value = profile_json.get("Name") or profile_json.get("name")
        profile_name = str(profile_name_value) if profile_name_value is not None else None

    crypto_link = None
    encrypted_url_bytes = None
    if request.subscription_url is not None:
        subscription_url = _validated_happ_subscription_url(request.subscription_url)
        crypto_link = _create_happ_crypto_link(subscription_url, method=request.crypto_method)
        encrypted_url_bytes = len(subscription_url.encode("utf-8"))

    await record_audit_event(
        session,
        principal=principal,
        action="tool.happ_routing.generated",
        resource_type="tools",
        resource_id="happ-routing",
        metadata_json={
            "mode": request.mode,
            "encoding": "base64-json",
            "profile_supplied": str(profile_json is not None).lower(),
            "profile_bytes": str(profile_bytes),
            "subscription_url_supplied": str(request.subscription_url is not None).lower(),
            "subscription_url_bytes": str(encrypted_url_bytes or 0),
            "crypto_method": request.crypto_method if request.subscription_url is not None else "",
        },
    )
    return HappRoutingBuildResponse(
        mode=request.mode,
        encoding="base64-json",
        profile_name=profile_name,
        profile_bytes=profile_bytes,
        encoded_profile=encoded_profile,
        routing_link=routing_link,
        routing_header=routing_header,
        crypto_method=request.crypto_method if crypto_link else None,
        crypto_link=crypto_link,
        encrypted_url_bytes=encrypted_url_bytes,
    )


async def summarize_tools(session: AsyncSession) -> ToolSummaryResponse:
    hwid = await inspect_hwid(session)
    active_sessions = await session.scalar(
        select(func.count())
        .select_from(UserSession)
        .where(UserSession.revoked_at.is_(None), UserSession.expires_at > datetime.now(UTC))
    )
    torrent_count = await session.scalar(
        select(func.count())
        .select_from(AuditEvent)
        .where(
            or_(
                AuditEvent.action.ilike("%torrent%"),
                AuditEvent.resource_type.ilike("%torrent%"),
            )
        )
    )
    happ_routes = sum(
        1 for row in (await inspect_happ_routing(session)).items if row.route_status == "happ"
    )
    return ToolSummaryResponse(
        hwid_over_limit=sum(1 for row in hwid.items if row.status == "over_limit"),
        sessions_active=int(active_sessions or 0),
        torrent_events=int(torrent_count or 0),
        happ_routes=int(happ_routes or 0),
    )


async def inspect_top_users(
    session: AsyncSession,
    *,
    metric: str = "traffic_used",
    limit: int = 50,
) -> TopUserResponse:
    normalized_metric = metric.strip().lower()
    if normalized_metric not in {
        "device_count",
        "expiration_risk",
        "traffic_percent",
        "traffic_used",
    }:
        raise APIError(
            code="top_users_metric_invalid",
            message="Top users metric is not supported.",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            details=[metric],
        )
    result = await session.execute(select(User).order_by(User.email))
    now = datetime.now(UTC)
    rows = [_top_user_row(rank=0, user=user, now=now) for user in result.scalars().all()]
    rows.sort(key=lambda row: _top_user_sort_value(row, normalized_metric), reverse=True)
    return TopUserResponse(
        items=[
            row.model_copy(update={"rank": index + 1})
            for index, row in enumerate(rows[:limit])
        ],
        metric=normalized_metric,
    )


async def inspect_user_ips(
    session: AsyncSession,
    *,
    query: str | None = None,
    limit: int = 200,
) -> UserIpResponse:
    users_by_id = await _users_by_id(session)
    rows: dict[tuple[UUID, str], dict[str, object]] = {}
    await _collect_subscription_ip_rows(session, rows=rows, users_by_id=users_by_id)
    await _collect_ip_control_rows(session, rows=rows, users_by_id=users_by_id)
    records = [_user_ip_record(row, users_by_id=users_by_id) for row in rows.values()]
    records.sort(key=lambda item: (item.last_seen_at, item.email or ""), reverse=True)
    needle = query.strip().lower() if query else None
    if needle:
        records = [record for record in records if _user_ip_record_matches(record, needle)]
    return UserIpResponse(items=records[:limit])


async def inspect_node_user_ips(
    session: AsyncSession,
    *,
    query: str | None = None,
    limit: int = 200,
) -> NodeUserIpResponse:
    users_by_id = await _users_by_id(session)
    nodes_by_id = await _nodes_by_id(session)
    result = await session.execute(
        select(AuditEvent)
        .where(AuditEvent.action == "subscription.public.rendered")
        .order_by(AuditEvent.created_at.desc())
        .limit(2000)
    )
    rows: dict[tuple[UUID, UUID, str], dict[str, object]] = {}
    for event in result.scalars().all():
        metadata = event.metadata_json if isinstance(event.metadata_json, dict) else {}
        user_id = _uuid_from_string(event.resource_id)
        node_id = _uuid_from_string(metadata.get("node_id"))
        ip = _non_empty_string(metadata.get("client_ip"))
        if user_id is None or node_id is None or ip is None:
            continue
        key = (node_id, user_id, ip)
        row = rows.setdefault(
            key,
            {
                "evidence_count": 0,
                "first_seen_at": event.created_at,
                "ip": ip,
                "last_seen_at": event.created_at,
                "last_target": None,
                "node_id": node_id,
                "subscription_ids": set(),
                "user_id": user_id,
            },
        )
        _merge_time_window(row, event.created_at)
        row["evidence_count"] = int(row["evidence_count"]) + 1
        if subscription_id := _non_empty_string(metadata.get("subscription_id")):
            cast_set(row["subscription_ids"]).add(subscription_id)
        if target := _non_empty_string(metadata.get("target")):
            row["last_target"] = target

    records = [
        NodeUserIpRecord(
            node_id=row["node_id"],
            node_name=(
                nodes_by_id.get(row["node_id"]).name
                if row["node_id"] in nodes_by_id
                else None
            ),
            user_id=row["user_id"],
            email=(
                users_by_id.get(row["user_id"]).email
                if row["user_id"] in users_by_id
                else None
            ),
            username=(
                users_by_id.get(row["user_id"]).username
                if row["user_id"] in users_by_id
                else None
            ),
            ip=str(row["ip"]),
            subscription_ids=sorted(cast_set(row["subscription_ids"])),
            first_seen_at=row["first_seen_at"],
            last_seen_at=row["last_seen_at"],
            evidence_count=int(row["evidence_count"]),
            last_target=row["last_target"],
        )
        for row in rows.values()
    ]
    records.sort(key=lambda item: (item.last_seen_at, item.node_name or ""), reverse=True)
    needle = query.strip().lower() if query else None
    if needle:
        records = [record for record in records if _node_user_ip_record_matches(record, needle)]
    return NodeUserIpResponse(items=records[:limit])


async def queue_connection_drop(
    session: AsyncSession,
    *,
    request: DropConnectionsRequest,
    principal: Principal,
) -> DropConnectionsResponse:
    ip = _validated_ip(request.ip)
    if request.subscription_id is not None:
        subscription = await session.get(Subscription, request.subscription_id)
        if subscription is None:
            raise APIError(
                code="subscription_not_found",
                message="Subscription was not found.",
                status_code=status.HTTP_404_NOT_FOUND,
            )
        if subscription.node_id is not None and subscription.node_id != request.node_id:
            raise APIError(
                code="drop_connections_node_mismatch",
                message="Subscription is not assigned to the requested node.",
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                details=[str(subscription.node_id), str(request.node_id)],
            )
        if request.user_id is not None and subscription.user_id != request.user_id:
            raise APIError(
                code="drop_connections_user_mismatch",
                message="Subscription is not assigned to the requested user.",
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                details=[str(subscription.user_id), str(request.user_id)],
            )
    if request.user_id is not None and await session.get(User, request.user_id) is None:
        raise APIError(
            code="user_not_found",
            message="User was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    command = await enqueue_node_command(
        session,
        node_id=request.node_id,
        request=NodeCommandCreateRequest(
            command_type="node.connections.drop",
            payload_json={
                "ip": ip,
                "reason": request.reason or "operator requested connection drop",
                "source": "tools.drop-connections",
                **({"user_id": str(request.user_id)} if request.user_id is not None else {}),
                **(
                    {"subscription_id": str(request.subscription_id)}
                    if request.subscription_id is not None
                    else {}
                ),
            },
        ),
    )
    await record_audit_event(
        session,
        principal=principal,
        action="tool.connections.drop.queued",
        resource_type="node_command",
        resource_id=str(command.id),
        metadata_json={
            "node_id": str(request.node_id),
            "ip": ip,
            "user_id": str(request.user_id) if request.user_id is not None else "",
            "subscription_id": (
                str(request.subscription_id) if request.subscription_id is not None else ""
            ),
        },
    )
    return DropConnectionsResponse(command=_node_command_response(command))


async def generate_x25519_keypair(
    session: AsyncSession,
    *,
    principal: Principal,
) -> X25519KeypairResponse:
    private_key = x25519.X25519PrivateKey.generate()
    public_key = private_key.public_key()
    private_raw = private_key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_raw = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    await record_audit_event(
        session,
        principal=principal,
        action="tool.x25519_keypair.generated",
        resource_type="tool",
        resource_id="x25519-keypair",
        metadata_json={"encoding": "base64url-nopad", "private_key_stored": "false"},
    )
    return X25519KeypairResponse(
        private_key=_base64url_nopad(private_raw),
        public_key=_base64url_nopad(public_raw),
    )


async def generate_node_key(
    session: AsyncSession,
    *,
    principal: Principal,
    settings: Settings,
) -> NodeKeyResponse:
    token, token_prefix, _token_hash = generate_node_token(
        prefix=NODE_TOKEN_PREFIX,
        settings=settings,
    )
    await record_audit_event(
        session,
        principal=principal,
        action="tool.node_key.generated",
        resource_type="tool",
        resource_id="node-key",
        metadata_json={
            "token_prefix": token_prefix,
            "hash_algorithm": "hmac-sha256",
            "stored": "false",
        },
    )
    return NodeKeyResponse(token=token, token_prefix=token_prefix)


async def list_tool_snippets(session: AsyncSession) -> ToolSnippetListResponse:
    result = await session.execute(
        select(PanelSetting).where(PanelSetting.key == SNIPPETS_SETTING_KEY)
    )
    setting = result.scalar_one_or_none()
    if setting is None:
        return ToolSnippetListResponse(items=[])
    records = [_snippet_record(raw) for raw in _snippet_items(setting)]
    return ToolSnippetListResponse(items=sorted(records, key=lambda item: (item.order, item.name)))


async def create_tool_snippet(
    session: AsyncSession,
    *,
    request: ToolSnippetCreateRequest,
    principal: Principal,
) -> ToolSnippetRecord:
    _ensure_snippet_has_no_secret_like_content(request.content)
    setting = await _snippets_setting(session, create=True, principal=principal)
    items = _snippet_items(setting)
    snippet_id = uuid4()
    now = datetime.now(UTC)
    order = request.order if request.order is not None else _next_snippet_order(items)
    item = {
        "id": str(snippet_id),
        "name": request.name,
        "content": request.content,
        "description": request.description,
        "language": request.language,
        "order": order,
        "updated_at": now.isoformat(),
        "updated_by": principal.subject,
    }
    items.append(item)
    await _save_snippet_items(session, setting=setting, items=items, principal=principal)
    await record_audit_event(
        session,
        principal=principal,
        action="tool.snippet.created",
        resource_type="tool_snippet",
        resource_id=str(snippet_id),
        metadata_json={"name": request.name, "language": request.language},
    )
    return _snippet_record(item)


async def update_tool_snippet(
    session: AsyncSession,
    *,
    snippet_id: UUID,
    request: ToolSnippetUpdateRequest,
    principal: Principal,
) -> ToolSnippetRecord:
    setting = await _snippets_setting(session)
    items = _snippet_items(setting)
    index = _snippet_index(items, snippet_id=snippet_id)
    existing = dict(items[index])
    data = request.model_dump(exclude_unset=True)
    if "content" in data and data["content"] is not None:
        _ensure_snippet_has_no_secret_like_content(str(data["content"]))
    updated = {**existing, **data}
    updated["updated_at"] = datetime.now(UTC).isoformat()
    updated["updated_by"] = principal.subject
    items[index] = updated
    await _save_snippet_items(session, setting=setting, items=items, principal=principal)
    await record_audit_event(
        session,
        principal=principal,
        action="tool.snippet.updated",
        resource_type="tool_snippet",
        resource_id=str(snippet_id),
        metadata_json={"name": str(updated["name"]), "language": str(updated["language"])},
    )
    return _snippet_record(updated)


async def delete_tool_snippet(
    session: AsyncSession,
    *,
    snippet_id: UUID,
    principal: Principal,
) -> ToolSnippetListResponse:
    setting = await _snippets_setting(session)
    items = _snippet_items(setting)
    index = _snippet_index(items, snippet_id=snippet_id)
    removed = items.pop(index)
    await _save_snippet_items(session, setting=setting, items=items, principal=principal)
    await record_audit_event(
        session,
        principal=principal,
        action="tool.snippet.deleted",
        resource_type="tool_snippet",
        resource_id=str(snippet_id),
        metadata_json={"name": str(removed.get("name") or "")},
    )
    return ToolSnippetListResponse(items=[_snippet_record(item) for item in items])


async def _snippets_setting(
    session: AsyncSession,
    *,
    create: bool = False,
    principal: Principal | None = None,
) -> PanelSetting:
    result = await session.execute(
        select(PanelSetting).where(PanelSetting.key == SNIPPETS_SETTING_KEY)
    )
    setting = result.scalar_one_or_none()
    if setting is None and create:
        setting = PanelSetting(
            key=SNIPPETS_SETTING_KEY,
            value_json={"items": []},
            updated_by=principal.subject if principal else None,
        )
        session.add(setting)
        await session.flush()
    if setting is None:
        raise APIError(
            code="tool_snippets_not_found",
            message="No tool snippets have been created.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    return setting


def _snippet_items(setting: PanelSetting) -> list[dict[str, object]]:
    raw_items = setting.value_json.get("items", [])
    if not isinstance(raw_items, list):
        return []
    return [dict(item) for item in raw_items if isinstance(item, dict)]


async def _save_snippet_items(
    session: AsyncSession,
    *,
    setting: PanelSetting,
    items: list[dict[str, object]],
    principal: Principal,
) -> None:
    setting.value_json = {"items": items}
    setting.updated_by = principal.subject
    await session.flush()


def _snippet_record(raw: dict[str, object]) -> ToolSnippetRecord:
    updated_at = raw.get("updated_at")
    parsed_updated_at = (
        datetime.fromisoformat(str(updated_at))
        if updated_at is not None
        else datetime.now(UTC)
    )
    return ToolSnippetRecord(
        id=UUID(str(raw["id"])),
        name=str(raw.get("name") or "Untitled snippet"),
        content=str(raw.get("content") or ""),
        description=str(raw["description"]) if raw.get("description") is not None else None,
        language=str(raw.get("language") or "text"),
        order=int(raw.get("order") or 0),
        updated_at=parsed_updated_at,
        updated_by=str(raw["updated_by"]) if raw.get("updated_by") is not None else None,
    )


def _next_snippet_order(items: list[dict[str, object]]) -> int:
    if not items:
        return 0
    return max(int(item.get("order") or 0) for item in items) + 1


def _snippet_index(items: list[dict[str, object]], *, snippet_id: UUID) -> int:
    for index, item in enumerate(items):
        if str(item.get("id")) == str(snippet_id):
            return index
    raise APIError(
        code="tool_snippet_not_found",
        message="Tool snippet was not found.",
        status_code=status.HTTP_404_NOT_FOUND,
    )


def _ensure_snippet_has_no_secret_like_content(content: str) -> None:
    if SECRET_LIKE_PATTERN.search(content):
        raise APIError(
            code="tool_snippet_secret_like_content",
            message="Tool snippets must not store passwords, tokens, API keys, or private keys.",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )


def _base64url_nopad(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


async def _real_subscription_headers(
    session: AsyncSession,
    *,
    settings: Settings,
    subscription: Subscription,
    parser: str,
) -> dict[str, str]:
    try:
        manifest = await build_subscription_manifest(session, subscription_id=subscription.id)
        headers = build_subscription_headers(manifest)
        return {
            "Subscription-Userinfo": headers["subscription-userinfo"],
            "Profile-Update-Interval": headers["profile-update-interval"],
            "Profile-Title": headers["profile-title"],
            "X-Lumen-Subscription-Status": subscription.status,
            "X-Lumen-Parser": parser,
            "X-Lumen-Inspector-Status": "renderable",
        }
    except APIError as exc:
        return {
            "X-Lumen-Subscription-Status": subscription.status,
            "X-Lumen-Parser": parser,
            "X-Lumen-Inspector-Status": "unavailable",
            "X-Lumen-Inspector-Error": exc.code,
        }


def _device_records(metadata: dict[str, object]):
    raw_devices = metadata.get("devices", [])
    if not isinstance(raw_devices, list):
        return []
    devices = []
    for index, raw_device in enumerate(raw_devices):
        if not isinstance(raw_device, dict):
            continue
        device_id = raw_device.get("id") or raw_device.get("hwid") or f"device-{index + 1}"
        label = (
            raw_device.get("label")
            or raw_device.get("hwid")
            or device_id
            or f"device-{index + 1}"
        )
        devices.append(
            HwidDeviceRecord(
                id=str(device_id),
                label=str(label),
                hwid=_optional_str(raw_device.get("hwid")),
                last_seen_at=_optional_str(raw_device.get("last_seen_at")),
                platform=_optional_str(raw_device.get("platform")),
                status=str(raw_device.get("status") or "active"),
                subscription_id=_optional_str(raw_device.get("subscription_id")),
            )
        )
    return devices


def _hwid_row_matches(
    user: User,
    devices: list[HwidDeviceRecord],
    subscription_ids: list[str],
    needle: str,
) -> bool:
    user_fields = [
        str(user.id),
        user.email,
        user.username,
        user.display_name,
        user.telegram_id,
        *user.tags,
        *subscription_ids,
    ]
    if any(needle in str(value).lower() for value in user_fields if value is not None):
        return True
    for device in devices:
        fields = [
            device.id,
            device.label,
            device.hwid,
            device.platform,
            device.status,
            device.last_seen_at,
            device.subscription_id,
        ]
        if any(needle in str(value).lower() for value in fields if value is not None):
            return True
    return False


def _top_user_row(*, rank: int, user: User, now: datetime) -> TopUserRow:
    devices = _device_records(user.metadata_json)
    traffic_percent = (
        round((user.traffic_used_gb / user.traffic_limit_gb) * 100, 2)
        if user.traffic_limit_gb and user.traffic_limit_gb > 0
        else None
    )
    return TopUserRow(
        rank=rank,
        user_id=user.id,
        email=user.email,
        username=user.username,
        status=user.status,
        traffic_used_gb=float(user.traffic_used_gb),
        traffic_limit_gb=user.traffic_limit_gb,
        traffic_percent=traffic_percent,
        device_count=len(devices),
        device_limit=user.device_limit,
        expires_at=user.expires_at,
        risk=_top_user_risk(
            user=user,
            device_count=len(devices),
            traffic_percent=traffic_percent,
            now=now,
        ),
    )


def _top_user_risk(
    *,
    user: User,
    device_count: int,
    traffic_percent: float | None,
    now: datetime,
) -> str:
    if user.expires_at is not None and _is_expired(user.expires_at, now):
        return "expired"
    if traffic_percent is not None and traffic_percent >= 100:
        return "traffic_exceeded"
    if user.device_limit is not None and device_count > user.device_limit:
        return "device_over_limit"
    if user.expires_at is not None:
        expires_at = (
            user.expires_at if user.expires_at.tzinfo else user.expires_at.replace(tzinfo=UTC)
        )
        if (expires_at - now).days <= 7:
            return "expires_soon"
    if traffic_percent is not None and traffic_percent >= 80:
        return "traffic_warning"
    return "ok"


def _top_user_sort_value(row: TopUserRow, metric: str) -> tuple[float, float]:
    if metric == "traffic_percent":
        return (
            row.traffic_percent if row.traffic_percent is not None else -1.0,
            row.traffic_used_gb,
        )
    if metric == "device_count":
        return (float(row.device_count), row.traffic_used_gb)
    if metric == "expiration_risk":
        risk_weight = {
            "expired": 5.0,
            "traffic_exceeded": 4.0,
            "device_over_limit": 3.0,
            "expires_soon": 2.0,
            "traffic_warning": 1.0,
            "ok": 0.0,
        }
        return (risk_weight.get(row.risk, 0.0), row.traffic_used_gb)
    return (row.traffic_used_gb, row.traffic_percent if row.traffic_percent is not None else -1.0)


async def _users_by_id(session: AsyncSession) -> dict[UUID, User]:
    result = await session.execute(select(User))
    return {user.id: user for user in result.scalars().all()}


async def _nodes_by_id(session: AsyncSession) -> dict[UUID, Node]:
    result = await session.execute(select(Node))
    return {node.id: node for node in result.scalars().all()}


async def _collect_subscription_ip_rows(
    session: AsyncSession,
    *,
    rows: dict[tuple[UUID, str], dict[str, object]],
    users_by_id: dict[UUID, User],
) -> None:
    result = await session.execute(
        select(AuditEvent)
        .where(AuditEvent.action == "subscription.public.rendered")
        .order_by(AuditEvent.created_at.desc())
        .limit(2000)
    )
    for event in result.scalars().all():
        metadata = event.metadata_json if isinstance(event.metadata_json, dict) else {}
        user_id = _uuid_from_string(event.resource_id)
        ip = _non_empty_string(metadata.get("client_ip"))
        if user_id is None or ip is None:
            continue
        row = _user_ip_row(rows, user_id=user_id, ip=ip, seen_at=event.created_at)
        row["evidence_count"] = int(row["evidence_count"]) + 1
        cast_set(row["sources"]).add("subscription")
        if subscription_id := _non_empty_string(metadata.get("subscription_id")):
            cast_set(row["subscription_ids"]).add(subscription_id)
        if node_id := _uuid_from_string(metadata.get("node_id")):
            cast_set(row["node_ids"]).add(str(node_id))
        if target := _non_empty_string(metadata.get("target")):
            row["last_target"] = target
        if user_id not in users_by_id:
            row["missing_user"] = "true"


async def _collect_ip_control_rows(
    session: AsyncSession,
    *,
    rows: dict[tuple[UUID, str], dict[str, object]],
    users_by_id: dict[UUID, User],
) -> None:
    result = await session.execute(
        select(IpControlEvent).order_by(IpControlEvent.created_at.desc()).limit(2000)
    )
    for event in result.scalars().all():
        user_id = _uuid_from_string(event.user_id)
        ip = _non_empty_string(event.ip)
        if user_id is None or ip is None:
            continue
        row = _user_ip_row(rows, user_id=user_id, ip=ip, seen_at=event.created_at)
        row["evidence_count"] = int(row["evidence_count"]) + 1
        cast_set(row["sources"]).add("ip-control")
        row["last_decision"] = event.decision
        if user_id not in users_by_id:
            row["missing_user"] = "true"


def _user_ip_row(
    rows: dict[tuple[UUID, str], dict[str, object]],
    *,
    user_id: UUID,
    ip: str,
    seen_at: datetime,
) -> dict[str, object]:
    key = (user_id, ip)
    row = rows.setdefault(
        key,
        {
            "evidence_count": 0,
            "first_seen_at": seen_at,
            "ip": ip,
            "last_decision": None,
            "last_seen_at": seen_at,
            "last_target": None,
            "node_ids": set(),
            "sources": set(),
            "subscription_ids": set(),
            "user_id": user_id,
        },
    )
    _merge_time_window(row, seen_at)
    return row


def _user_ip_record(row: dict[str, object], *, users_by_id: dict[UUID, User]) -> UserIpRecord:
    user_id = row["user_id"]
    assert isinstance(user_id, UUID)
    user = users_by_id.get(user_id)
    return UserIpRecord(
        user_id=user_id,
        email=user.email if user else None,
        username=user.username if user else None,
        ip=str(row["ip"]),
        sources=sorted(cast_set(row["sources"])),
        subscription_ids=sorted(cast_set(row["subscription_ids"])),
        node_ids=[UUID(value) for value in sorted(cast_set(row["node_ids"]))],
        first_seen_at=_datetime_value(row["first_seen_at"]),
        last_seen_at=_datetime_value(row["last_seen_at"]),
        evidence_count=int(row["evidence_count"]),
        last_target=_optional_str(row.get("last_target")),
        last_decision=_optional_str(row.get("last_decision")),
    )


def _merge_time_window(row: dict[str, object], seen_at: datetime) -> None:
    first_seen_at = _datetime_value(row["first_seen_at"])
    last_seen_at = _datetime_value(row["last_seen_at"])
    if seen_at < first_seen_at:
        row["first_seen_at"] = seen_at
    if seen_at > last_seen_at:
        row["last_seen_at"] = seen_at


def _datetime_value(value: object) -> datetime:
    assert isinstance(value, datetime)
    return value


def cast_set(value: object) -> set[str]:
    assert isinstance(value, set)
    return value


def _uuid_from_string(value: object) -> UUID | None:
    if value is None:
        return None
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def _non_empty_string(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _user_ip_record_matches(record: UserIpRecord, needle: str) -> bool:
    fields = [
        str(record.user_id),
        record.email,
        record.username,
        record.ip,
        record.last_target,
        record.last_decision,
        *record.sources,
        *record.subscription_ids,
        *(str(node_id) for node_id in record.node_ids),
    ]
    return any(needle in str(value).lower() for value in fields if value is not None)


def _node_user_ip_record_matches(record: NodeUserIpRecord, needle: str) -> bool:
    fields = [
        str(record.node_id),
        record.node_name,
        str(record.user_id),
        record.email,
        record.username,
        record.ip,
        record.last_target,
        *record.subscription_ids,
    ]
    return any(needle in str(value).lower() for value in fields if value is not None)


def _optional_str(value: object) -> str | None:
    if value is None:
        return None
    return str(value)


def _reject_secret_like_json(value: object, *, path: str) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            key_text = str(key)
            next_path = f"{path}.{key_text}"
            if SECRET_LIKE_PATTERN.search(key_text):
                raise APIError(
                    code="happ_routing_secret_like_key",
                    message="HApp routing profile contains a secret-like key.",
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    details=[next_path],
                )
            _reject_secret_like_json(item, path=next_path)
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            _reject_secret_like_json(item, path=f"{path}[{index}]")
        return
    if isinstance(value, str) and SECRET_LIKE_PATTERN.search(value):
        raise APIError(
            code="happ_routing_secret_like_value",
            message="HApp routing profile contains a secret-like value.",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            details=[path],
        )


def _validated_happ_subscription_url(subscription_url: str) -> str:
    normalized = subscription_url.strip()
    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise APIError(
            code="happ_subscription_url_invalid",
            message="HApp crypto input must be an absolute http(s) subscription URL.",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    return normalized


def _create_happ_crypto_link(subscription_url: str, *, method: str) -> str:
    public_key_pem = {
        "v3": HAPP_PUBLIC_KEY_V3,
        "v4": HAPP_PUBLIC_KEY_V4,
    }[method]
    public_key = serialization.load_pem_public_key(public_key_pem)
    try:
        encrypted = public_key.encrypt(
            subscription_url.encode("utf-8"),
            padding.PKCS1v15(),
        )
    except ValueError as exc:
        raise APIError(
            code="happ_subscription_url_too_long_for_crypto",
            message="Subscription URL is too long for the selected HApp RSA crypto method.",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        ) from exc
    payload = base64.b64encode(encrypted).decode("ascii")
    return f"happ://crypt{method.removeprefix('v')}/{payload}"


def _validated_ip(value: str) -> str:
    try:
        return str(ipaddress.ip_address(value.strip()))
    except ValueError as exc:
        raise APIError(
            code="drop_connections_ip_invalid",
            message="Drop connections requires a valid client IP address.",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            details=[value],
        ) from exc


def _node_command_response(command) -> NodeCommandResponse:
    return NodeCommandResponse(
        id=command.id,
        node_id=command.node_id,
        command_type=command.command_type,
        status=command.status,
        payload_json=command.payload_json,
        result_json=command.result_json,
        error_code=command.error_code,
        error_message=command.error_message,
        claimed_at=command.claimed_at,
        completed_at=command.completed_at,
        created_at=command.created_at,
        updated_at=command.updated_at,
    )


def _short_fingerprint(value: str | None) -> str | None:
    if value is None:
        return None
    return value[:12]


def _is_expired(expires_at: datetime, now: datetime) -> bool:
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return expires_at <= now
