from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domains.audit.models import AuditEvent
from app.domains.auth.models import UserSession
from app.domains.nodes.models import Node
from app.domains.subscriptions.models import Subscription
from app.domains.tools.schemas import (
    HappRoutingResponse,
    HappRoutingRow,
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
        devices = _device_labels(user.metadata_json)
        device_count = len(devices)
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
                devices=devices,
            )
        )
    return HwidInspectorResponse(items=rows)


async def inspect_srh(session: AsyncSession) -> SrhInspectorResponse:
    result = await session.execute(select(Subscription).order_by(Subscription.created_at.desc()))
    rows = []
    for subscription in result.scalars().all():
        parser = (
            subscription.delivery_profile.get("client")
            or subscription.delivery_profile.get("format")
            or "generic"
        )
        rows.append(
            SrhInspectorRow(
                subscription_id=subscription.id,
                public_id=subscription.public_id,
                user_id=subscription.user_id,
                status=subscription.status,
                parser=parser,
                config_hash=subscription.config_hash,
                response_headers={
                    "Subscription-Userinfo": "upload=0; download=0; total=0; expire=0",
                    "Profile-Update-Interval": subscription.delivery_profile.get(
                        "update_interval",
                        "24",
                    ),
                    "X-Lumen-Subscription-Status": subscription.status,
                    "X-Lumen-Parser": parser,
                },
            )
        )
    return SrhInspectorResponse(items=rows)


async def inspect_sessions(session: AsyncSession) -> SessionInspectorResponse:
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
                ip_fingerprint=_short_fingerprint(user_session.ip_hash),
                user_agent_fingerprint=_short_fingerprint(user_session.user_agent_hash),
                expires_at=user_session.expires_at,
                created_at=user_session.created_at,
                updated_at=user_session.updated_at,
            )
        )
    return SessionInspectorResponse(items=rows)


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


async def inspect_happ_routing(session: AsyncSession) -> HappRoutingResponse:
    result = await session.execute(
        select(Subscription, User.username, Node.name, Node.status)
        .outerjoin(User, User.id == Subscription.user_id)
        .outerjoin(Node, Node.id == Subscription.node_id)
        .order_by(Subscription.created_at.desc())
        .limit(500)
    )
    rows = []
    for subscription, username, node_name, node_status in result.all():
        client = (subscription.delivery_profile.get("client") or "").lower()
        parser = (subscription.delivery_profile.get("format") or "").lower()
        route_status = "happ" if "happ" in {client, parser} else "generic"
        if subscription.node_id is None:
            route_status = "unassigned"
        elif node_status not in {"active", "provisioning", "installing"}:
            route_status = "node_unavailable"
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
    happ_routes = await session.scalar(select(func.count()).select_from(Subscription))
    return ToolSummaryResponse(
        hwid_over_limit=sum(1 for row in hwid.items if row.status == "over_limit"),
        sessions_active=int(active_sessions or 0),
        torrent_events=int(torrent_count or 0),
        happ_routes=int(happ_routes or 0),
    )


def _device_labels(metadata: dict[str, object]) -> list[str]:
    raw_devices = metadata.get("devices", [])
    if not isinstance(raw_devices, list):
        return []
    labels = []
    for index, raw_device in enumerate(raw_devices):
        if not isinstance(raw_device, dict):
            continue
        label = (
            raw_device.get("label")
            or raw_device.get("hwid")
            or raw_device.get("id")
            or f"device-{index + 1}"
        )
        labels.append(str(label))
    return labels


def _short_fingerprint(value: str | None) -> str | None:
    if value is None:
        return None
    return value[:12]


def _is_expired(expires_at: datetime, now: datetime) -> bool:
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return expires_at <= now
