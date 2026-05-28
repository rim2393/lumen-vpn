from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import APIError
from app.core.rbac import Principal
from app.domains.audit.models import AuditEvent
from app.domains.audit.service import record_audit_event
from app.domains.auth.models import UserSession
from app.domains.auth.service import revoke_session
from app.domains.nodes.models import Node
from app.domains.subscriptions.models import Subscription
from app.domains.subscriptions.renderers import build_subscription_headers
from app.domains.subscriptions.service import build_subscription_manifest
from app.domains.tools.schemas import (
    HappRoutingResponse,
    HappRoutingRow,
    HwidDeviceRecord,
    HwidInspectorResponse,
    HwidInspectorRow,
    SessionInspectorResponse,
    SessionInspectorRow,
    SrhInspectorResponse,
    SrhInspectorRow,
    ToolSummaryResponse,
    TorrentReportResponse,
    TorrentReportRow,
)
from app.domains.users.models import User


async def inspect_hwid(session: AsyncSession) -> HwidInspectorResponse:
    result = await session.execute(select(User).order_by(User.email))
    rows = []
    for user in result.scalars().all():
        device_records = _device_records(user.metadata_json)
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
    happ_routes = sum(1 for row in (await inspect_happ_routing(session)).items if row.route_status == "happ")
    return ToolSummaryResponse(
        hwid_over_limit=sum(1 for row in hwid.items if row.status == "over_limit"),
        sessions_active=int(active_sessions or 0),
        torrent_events=int(torrent_count or 0),
        happ_routes=int(happ_routes or 0),
    )


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
                platform=_optional_str(raw_device.get("platform")),
                status=str(raw_device.get("status") or "active"),
            )
        )
    return devices


def _optional_str(value: object) -> str | None:
    if value is None:
        return None
    return str(value)


def _short_fingerprint(value: str | None) -> str | None:
    if value is None:
        return None
    return value[:12]


def _is_expired(expires_at: datetime, now: datetime) -> bool:
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return expires_at <= now
