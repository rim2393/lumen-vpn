import hashlib
from datetime import UTC, datetime
from uuid import UUID

from fastapi import status
from sqlalchemy import String as SQLString
from sqlalchemy import cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import APIError
from app.core.security import generate_opaque_token
from app.domains.ip_control.service import build_ip_control_policy
from app.domains.licenses.models import License
from app.domains.node_plugins.service import list_effective_node_plugins, plugin_policy_records
from app.domains.nodes.models import Node
from app.domains.protocols.models import Host, ProtocolProfile
from app.domains.protocols.schemas import VAULT_REF_PREFIX
from app.domains.settings.models import PanelSetting
from app.domains.subscriptions.models import Subscription
from app.domains.subscriptions.renderers import (
    derive_client_credentials,
    shadowsocks_password_for_method,
)
from app.domains.subscriptions.schemas import (
    SubscriptionCreateRequest,
    SubscriptionDeviceRecord,
    SubscriptionResponse,
    SubscriptionUpdateRequest,
)
from app.domains.users.models import User

SUBSCRIPTION_PUBLIC_ID_PREFIX = "lumen_sub"
SUBSCRIPTION_INFO_SETTING_KEY = "subscription.info"
PUBLIC_ID_COLLISION_ATTEMPTS = 3
SERVABLE_STATUSES = frozenset({"active", "paid", "trial"})
SECRET_FIELD_FRAGMENTS = frozenset(
    {
        "password",
        "private_key",
        "privatekey",
        "secret",
        "token",
        "subscription_url",
        "runtime_config",
    }
)
RENDERABLE_PROTOCOL_PREFIXES = (
    "vless",
    "vmess",
    "trojan",
    "shadowsocks",
    "hysteria2",
    "naive",
    "tuic",
    "wireguard",
    "openvpn",
    "socks",
    "http",
)
AMNEZIA_WG_HINT_KEYS = (
    "Jc",
    "Jmin",
    "Jmax",
    "S1",
    "S2",
    "S3",
    "S4",
    "H1",
    "H2",
    "H3",
    "H4",
    "I1",
    "I2",
    "I3",
    "I4",
    "I5",
)


def utc_now() -> datetime:
    return datetime.now(UTC)


def ensure_no_inline_secret_keys(values: dict[str, str], *, field_name: str) -> None:
    for key in values:
        normalized = key.replace("-", "_").lower()
        if any(fragment in normalized for fragment in SECRET_FIELD_FRAGMENTS):
            raise APIError(
                code="inline_secret_rejected",
                message="Inline secret-like fields are not accepted for subscriptions.",
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                details=[f"{field_name}.{key}"],
            )


async def list_subscriptions(session: AsyncSession) -> list[Subscription]:
    result = await session.execute(select(Subscription).order_by(Subscription.created_at.desc()))
    return list(result.scalars())


async def lookup_subscriptions(session: AsyncSession, *, query: str) -> list[Subscription]:
    normalized_query = query.strip().lower()
    if not normalized_query:
        return []

    like_value = f"%{normalized_query}%"
    id_prefix = f"{normalized_query}%"
    result = await session.execute(
        select(Subscription)
        .join(User, User.id == Subscription.user_id)
        .where(
            or_(
                func.lower(Subscription.public_id).like(like_value),
                func.lower(cast(Subscription.id, SQLString)).like(id_prefix),
                func.lower(User.email).like(like_value),
                func.lower(User.username).like(like_value),
                func.lower(User.display_name).like(like_value),
            )
        )
        .order_by(Subscription.created_at.desc())
        .limit(25)
    )
    return list(result.scalars())


async def list_subscriptions_for_user(
    session: AsyncSession,
    *,
    user_id: UUID,
) -> list[Subscription]:
    result = await session.execute(
        select(Subscription)
        .where(Subscription.user_id == user_id)
        .order_by(Subscription.created_at.desc())
    )
    return list(result.scalars())


async def get_subscription(
    session: AsyncSession,
    *,
    subscription_id: UUID,
) -> Subscription:
    subscription = await session.get(Subscription, subscription_id)
    if subscription is None:
        raise APIError(
            code="subscription_not_found",
            message="Subscription was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    return subscription


async def get_subscription_by_public_id(
    session: AsyncSession,
    *,
    public_id: str,
) -> Subscription:
    subscription = (
        await session.execute(select(Subscription).where(Subscription.public_id == public_id))
    ).scalar_one_or_none()
    if subscription is None:
        raise APIError(
            code="subscription_not_found",
            message="Subscription was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    return subscription


async def get_subscription_by_short_uuid(
    session: AsyncSession,
    *,
    short_uuid: str,
) -> Subscription:
    normalized = short_uuid.strip().lower()
    if len(normalized) < 8:
        raise APIError(
            code="subscription_short_uuid_too_short",
            message="Subscription short UUID must contain at least 8 characters.",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )
    subscription = (
        await session.execute(
            select(Subscription).where(
                func.lower(cast(Subscription.id, SQLString)).like(f"{normalized}%")
            )
        )
    ).scalar_one_or_none()
    if subscription is None:
        raise APIError(
            code="subscription_not_found",
            message="Subscription was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    return subscription


async def build_subscription_manifest(
    session: AsyncSession,
    *,
    subscription_id: UUID,
) -> dict[str, object]:
    subscription = await get_subscription(session, subscription_id=subscription_id)
    user = await session.get(User, subscription.user_id)
    if user is None:
        raise APIError(
            code="subscription_user_not_found",
            message="Subscription user was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    if subscription.node_id is None:
        raise APIError(
            code="subscription_manifest_node_missing",
            message="Subscription must be attached to a node before a manifest can be rendered.",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )

    node = await session.get(Node, subscription.node_id)
    if node is None:
        raise APIError(
            code="subscription_node_not_found",
            message="Subscription node was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    delivery = subscription.delivery_profile
    profile = await _get_optional_profile(session, delivery.get("profile_id"))
    host = await _resolve_manifest_host(
        session,
        delivery=delivery,
        profile=profile,
        node=node,
        subscription_public_id=subscription.public_id,
    )
    protocol_type = delivery.get("protocol") or (profile.adapter if profile is not None else None)
    if protocol_type is None or not str(protocol_type).startswith(RENDERABLE_PROTOCOL_PREFIXES):
        raise APIError(
            code="subscription_protocol_required",
            message=(
                "Subscription delivery profile must reference a renderable protocol "
                "or profile."
            ),
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            details=["delivery_profile.protocol"],
        )
    adapter = delivery.get("adapter") or (profile.adapter if profile is not None else protocol_type)
    endpoint_host = _manifest_endpoint_host(host=host, node=node)
    endpoint_port = _manifest_port(delivery=delivery, profile=profile, host=host)
    credentials_ref = _manifest_credentials_ref(
        profile=profile,
        subscription=subscription,
        protocol_type=protocol_type,
    )
    credentials = derive_client_credentials(
        settings=get_settings(),
        subscription_id=subscription.public_id,
        credentials_ref=credentials_ref,
        protocol_id=delivery.get("protocol_id") or protocol_type,
        protocol_type=protocol_type,
    )
    page_settings = await _subscription_page_settings(session)
    profile_title = (
        delivery.get("profile_title")
        or delivery.get("name")
        or _setting_string(page_settings, "title")
        or "Lumen"
    )
    support_url = delivery.get("support_url") or _setting_string(page_settings, "support_url")
    update_interval_hours = delivery.get("update_interval_hours") or _setting_string(
        page_settings,
        "auto_update_hours",
    )
    profile_page_url = _setting_string(page_settings, "profile_page_url")
    provider_name = delivery.get("provider_name") or profile_title
    access_policy = await build_ip_control_policy(session, user_id=str(user.id))
    node_plugins = await list_effective_node_plugins(session, node_id=node.id)
    node_policy = {
        "modelVersion": "lumen.node-policy.v1",
        "plugins": plugin_policy_records(node_plugins),
    }
    if access_policy is not None:
        node_policy["ipControl"] = access_policy

    return {
        "schemaVersion": "lumen.subscription-manifest.v1",
        "generatedAt": _isoformat(
            subscription.updated_at or subscription.created_at or datetime.now(UTC),
        ),
        "provider": {
            "id": delivery.get("provider_id") or "lumen",
            "name": provider_name,
        },
        "subscription": {
            "id": subscription.public_id,
            "audience": delivery.get("audience") or "lumen-client",
            "expiresAt": _isoformat(subscription.expires_at),
            "refreshAfter": None,
        },
        "nodes": [
            {
                "id": str(node.id),
                "displayName": node.name,
                "region": node.region,
                "priority": _manifest_priority(delivery),
                "tags": host.tags if host is not None else [],
                "protocols": [
                    {
                        "id": delivery.get("protocol_id") or protocol_type,
                        "type": protocol_type,
                        "adapter": adapter,
                        "endpoint": {
                            "host": endpoint_host,
                            "port": endpoint_port,
                            "transport": delivery.get("transport")
                            or _host_transport(host)
                            or _default_transport(protocol_type),
                            "network": delivery.get("network") or "public",
                        },
                        "security": _manifest_security(
                            profile=profile,
                            delivery=delivery,
                            protocol_type=protocol_type,
                            host=host,
                        ),
                        "flow": delivery.get("flow"),
                        "path": delivery.get("path")
                        or _host_string(host, "path")
                        or _profile_config_string(profile, "path"),
                        "mode": delivery.get("mode")
                        or _host_xhttp_string(host, "mode")
                        or _profile_config_string(profile, "mode"),
                        "serviceName": delivery.get("service_name")
                        or delivery.get("serviceName")
                        or _profile_config_string(profile, "serviceName")
                        or _profile_config_string(profile, "service_name"),
                        "credentialsRef": credentials_ref,
                        "credentials": _manifest_credentials(
                            credentials,
                            username=subscription.public_id,
                            method=(
                                delivery.get("method")
                                or _profile_config_string(profile, "method")
                                or "2022-blake3-aes-128-gcm"
                            ),
                        ),
                        "capabilities": _manifest_capabilities(protocol_type),
                        "rendererHints": _manifest_renderer_hints(
                            delivery=delivery,
                            host=host,
                            profile=profile,
                            profile_title=profile_title,
                        ),
                    }
                ],
                "metadata": {
                    "nodePolicy": node_policy,
                },
            }
        ],
        "renderHints": {"preferredFormats": [delivery.get("format") or "lumen-json"]},
        "metadata": {
            "source": "lumen-api",
            "subscriptionId": str(subscription.id),
            "profileTitle": profile_title,
            "supportUrl": support_url,
            "profilePageUrl": profile_page_url,
            "trafficLimitGb": delivery.get("traffic_limit_gb"),
            "trafficUsedGb": user.traffic_used_gb,
            "trafficUploadGb": delivery.get("traffic_upload_gb"),
            "updateIntervalHours": update_interval_hours,
            "accessPolicy": access_policy,
        },
    }


async def build_public_subscription_manifest(
    session: AsyncSession,
    *,
    public_id: str,
) -> dict[str, object]:
    subscription = await get_subscription_by_public_id(session, public_id=public_id)
    _ensure_subscription_can_be_served(subscription)
    license_record = await session.get(License, subscription.license_id)
    _ensure_license_can_be_served(license_record)
    return await build_subscription_manifest(session, subscription_id=subscription.id)


async def enforce_public_subscription_device(
    session: AsyncSession,
    *,
    subscription: Subscription,
    device_id: str | None,
    device_label: str | None = None,
    platform: str | None = None,
) -> dict[str, object] | None:
    user = await session.get(User, subscription.user_id)
    if user is None:
        raise APIError(
            code="subscription_user_not_found",
            message="Subscription user was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    if user.device_limit is None:
        return None

    normalized_device_id = _normalize_device_id(device_id)
    if normalized_device_id is None:
        raise APIError(
            code="subscription_device_id_required",
            message="This subscription requires a device id or HWID.",
            status_code=status.HTTP_428_PRECONDITION_REQUIRED,
        )

    metadata = dict(user.metadata_json)
    raw_devices = metadata.get("devices")
    devices = list(raw_devices) if isinstance(raw_devices, list) else []
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    active_count = 0
    matching_index: int | None = None
    normalized_devices: list[object] = []
    for raw_device in devices:
        if not isinstance(raw_device, dict):
            continue
        device = dict(raw_device)
        if str(device.get("status") or "active") == "active":
            active_count += 1
        if _device_id_matches(device, normalized_device_id):
            matching_index = len(normalized_devices)
        normalized_devices.append(device)

    if matching_index is None:
        if user.device_limit <= 0 or active_count >= user.device_limit:
            raise APIError(
                code="subscription_device_limit_exceeded",
                message="Subscription device limit has been reached.",
                status_code=status.HTTP_403_FORBIDDEN,
                details=[f"device_limit={user.device_limit}", f"device_count={active_count}"],
            )
        normalized_devices.append(
            {
                "id": normalized_device_id,
                "hwid": normalized_device_id,
                "label": _normalize_device_label(device_label) or normalized_device_id,
                "platform": _normalize_device_label(platform),
                "status": "active",
                "first_seen_at": now,
                "last_seen_at": now,
                "subscription_id": str(subscription.id),
            }
        )
        device_status = "registered"
    else:
        device = dict(normalized_devices[matching_index])
        device["last_seen_at"] = now
        device.setdefault("first_seen_at", now)
        device["status"] = "active"
        if device_label:
            device["label"] = _normalize_device_label(device_label) or device.get("label")
        if platform:
            device["platform"] = _normalize_device_label(platform)
        normalized_devices[matching_index] = device
        device_status = "known"

    metadata["devices"] = normalized_devices
    user.metadata_json = metadata
    await session.flush()
    return {
        "device_id": normalized_device_id,
        "device_status": device_status,
        "device_limit": user.device_limit,
        "device_count": len(
            [
                item
                for item in normalized_devices
                if isinstance(item, dict) and str(item.get("status") or "active") == "active"
            ]
        ),
    }


async def create_subscription(
    session: AsyncSession,
    *,
    request: SubscriptionCreateRequest,
) -> Subscription:
    ensure_no_inline_secret_keys(request.delivery_profile, field_name="delivery_profile")

    user = await session.get(User, request.user_id)
    if user is None:
        raise APIError(
            code="subscription_user_not_found",
            message="Subscription user was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    license_record = await session.get(License, request.license_id)
    if license_record is None:
        raise APIError(
            code="subscription_license_not_found",
            message="Subscription license was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    if request.node_id is not None:
        node = await session.get(Node, request.node_id)
        if node is None:
            raise APIError(
                code="subscription_node_not_found",
                message="Subscription node was not found.",
                status_code=status.HTTP_404_NOT_FOUND,
            )

    _ensure_renderable_subscription_request(
        node_id=request.node_id,
        delivery_profile=request.delivery_profile,
    )

    subscription = Subscription(
        public_id=await create_subscription_public_id(session),
        user_id=request.user_id,
        license_id=request.license_id,
        node_id=request.node_id,
        status="active",
        delivery_profile=request.delivery_profile,
        config_hash=request.config_hash,
        expires_at=request.expires_at,
    )
    session.add(subscription)
    await session.flush()
    return subscription


async def update_subscription(
    session: AsyncSession,
    *,
    subscription_id: UUID,
    request: SubscriptionUpdateRequest,
) -> Subscription:
    subscription = await get_subscription(session, subscription_id=subscription_id)
    updated_fields = request.model_fields_set

    if "node_id" in updated_fields and request.node_id is not None:
        node = await session.get(Node, request.node_id)
        if node is None:
            raise APIError(
                code="subscription_node_not_found",
                message="Subscription node was not found.",
                status_code=status.HTTP_404_NOT_FOUND,
            )

    if "delivery_profile" in updated_fields:
        delivery_profile = request.delivery_profile or {}
        ensure_no_inline_secret_keys(delivery_profile, field_name="delivery_profile")
        _ensure_renderable_subscription_request(
            node_id=subscription.node_id,
            delivery_profile=delivery_profile,
        )
        subscription.delivery_profile = delivery_profile
    if "status" in updated_fields and request.status is not None:
        subscription.status = request.status
    if "node_id" in updated_fields:
        _ensure_renderable_subscription_request(
            node_id=request.node_id,
            delivery_profile=subscription.delivery_profile,
        )
        subscription.node_id = request.node_id
    if "config_hash" in updated_fields:
        subscription.config_hash = request.config_hash
    if "expires_at" in updated_fields:
        subscription.expires_at = request.expires_at

    await session.flush()
    return subscription


async def revoke_subscription(session: AsyncSession, *, subscription_id: UUID) -> Subscription:
    subscription = await get_subscription(session, subscription_id=subscription_id)
    subscription.status = "revoked"
    if subscription.revoked_at is None:
        subscription.revoked_at = utc_now()
    await session.flush()
    return subscription


async def clone_subscription(session: AsyncSession, *, subscription_id: UUID) -> Subscription:
    source = await get_subscription(session, subscription_id=subscription_id)
    clone = Subscription(
        public_id=await create_subscription_public_id(session),
        user_id=source.user_id,
        license_id=source.license_id,
        node_id=source.node_id,
        status="active",
        delivery_profile=dict(source.delivery_profile),
        config_hash=source.config_hash,
        expires_at=source.expires_at,
    )
    session.add(clone)
    await session.flush()
    return clone


async def delete_subscription(session: AsyncSession, *, subscription_id: UUID) -> Subscription:
    subscription = await get_subscription(session, subscription_id=subscription_id)
    await session.delete(subscription)
    await session.flush()
    return subscription


async def list_subscription_devices(
    session: AsyncSession,
    *,
    subscription_id: UUID,
) -> list[SubscriptionDeviceRecord]:
    subscription = await get_subscription(session, subscription_id=subscription_id)
    user = await session.get(User, subscription.user_id)
    if user is None:
        raise APIError(
            code="subscription_user_not_found",
            message="Subscription user was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    raw_devices = user.metadata_json.get("devices", [])
    if not isinstance(raw_devices, list):
        return []
    devices: list[SubscriptionDeviceRecord] = []
    for index, raw_device in enumerate(raw_devices):
        if not isinstance(raw_device, dict):
            continue
        if raw_device.get("subscription_id") != str(subscription.id):
            continue
        device_id = raw_device.get("id") or raw_device.get("hwid") or f"device-{index + 1}"
        last_seen = raw_device.get("last_seen_at")
        devices.append(
            SubscriptionDeviceRecord(
                id=str(device_id),
                label=_optional_str(raw_device.get("label")),
                hwid=_optional_str(raw_device.get("hwid")),
                platform=_optional_str(raw_device.get("platform")),
                status=str(raw_device.get("status") or "active"),
                last_seen_at=last_seen if hasattr(last_seen, "isoformat") else None,
                metadata_json={str(key): value for key, value in raw_device.items()},
            )
        )
    return devices


def subscription_to_response(subscription: Subscription) -> SubscriptionResponse:
    return SubscriptionResponse(
        id=subscription.id,
        public_id=subscription.public_id,
        user_id=subscription.user_id,
        license_id=subscription.license_id,
        node_id=subscription.node_id,
        status=subscription.status,
        delivery_profile=subscription.delivery_profile,
        config_hash=subscription.config_hash,
        expires_at=subscription.expires_at,
        revoked_at=subscription.revoked_at,
    )


def _optional_str(value: object) -> str | None:
    if value is None:
        return None
    return str(value)


def _ensure_renderable_subscription_request(
    *,
    node_id: UUID | None,
    delivery_profile: dict[str, str],
) -> None:
    if node_id is None:
        raise APIError(
            code="subscription_node_required",
            message="Subscription must be attached to a node before it can be shared.",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )
    protocol = str(delivery_profile.get("protocol") or "")
    if protocol.startswith(RENDERABLE_PROTOCOL_PREFIXES):
        return
    raise APIError(
        code="subscription_protocol_required",
        message="Subscription delivery profile must reference a renderable protocol or profile.",
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        details=["delivery_profile.protocol"],
    )


async def _get_optional_profile(
    session: AsyncSession,
    profile_id: str | None,
) -> ProtocolProfile | None:
    if not profile_id:
        return None
    try:
        profile_uuid = UUID(profile_id)
    except ValueError as exc:
        raise APIError(
            code="subscription_manifest_profile_id_invalid",
            message="delivery_profile.profile_id must be a valid UUID.",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        ) from exc
    profile = await session.get(ProtocolProfile, profile_uuid)
    if profile is None:
        raise APIError(
            code="subscription_profile_not_found",
            message="Subscription profile was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    return profile


async def _get_optional_host(session: AsyncSession, host_id: str | None) -> Host | None:
    if not host_id:
        return None
    try:
        host_uuid = UUID(host_id)
    except ValueError as exc:
        raise APIError(
            code="subscription_manifest_host_id_invalid",
            message="delivery_profile.host_id must be a valid UUID.",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        ) from exc
    host = await session.get(Host, host_uuid)
    if host is None:
        raise APIError(
            code="subscription_host_not_found",
            message="Subscription host was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    return host


async def _resolve_manifest_host(
    session: AsyncSession,
    *,
    delivery: dict[str, str],
    profile: ProtocolProfile | None,
    node: Node,
    subscription_public_id: str,
) -> Host | None:
    explicit_host = await _get_optional_host(session, delivery.get("host_id"))
    if explicit_host is not None:
        _ensure_host_can_be_served(explicit_host, explicit=True)
        return explicit_host
    if profile is None:
        return None
    result = await session.execute(
        select(Host)
        .where(Host.node_id == node.id)
        .where(Host.protocol_profile_id == profile.id)
        .where(Host.status == "active")
        .order_by(Host.created_at.asc(), Host.name.asc())
    )
    candidates = [
        host for host in result.scalars().all() if _host_is_subscription_visible(host)
    ]
    if not candidates:
        return None
    if any(host.shuffle_host for host in candidates):
        index = _stable_index(subscription_public_id, len(candidates))
        return candidates[index]
    return candidates[0]


def _ensure_host_can_be_served(host: Host, *, explicit: bool) -> None:
    if _host_is_subscription_visible(host):
        return
    raise APIError(
        code="subscription_host_not_renderable",
        message="Subscription host is disabled, hidden, or excluded from subscriptions.",
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        details=[str(host.id), "delivery_profile.host_id" if explicit else "host"],
    )


def _host_is_subscription_visible(host: Host) -> bool:
    return (
        host.status == "active"
        and not host.hidden
        and not host.subscription_excluded
    )


def _stable_index(value: str, modulo: int) -> int:
    digest = hashlib.sha256(value.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") % modulo


def _manifest_endpoint_host(*, host: Host | None, node: Node) -> str:
    if host is None:
        return node.public_address
    return _host_string(host, "final_mask") or host.hostname


def _host_string(host: Host | None, key: str) -> str | None:
    value = getattr(host, key, None) if host is not None else None
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _host_xhttp_string(host: Host | None, key: str) -> str | None:
    if host is None or not isinstance(host.xhttp_json, dict):
        return None
    value = host.xhttp_json.get(key)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _host_transport(host: Host | None) -> str | None:
    if host is None:
        return None
    if host.xhttp_json:
        return "xhttp"
    return None


async def _subscription_page_settings(session: AsyncSession) -> dict[str, object]:
    setting = (
        await session.execute(
            select(PanelSetting).where(PanelSetting.key == SUBSCRIPTION_INFO_SETTING_KEY),
        )
    ).scalar_one_or_none()
    return dict(setting.value_json) if setting is not None else {}


def _setting_string(settings: dict[str, object], key: str) -> str | None:
    value = settings.get(key)
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _manifest_port(
    *,
    delivery: dict[str, str],
    profile: ProtocolProfile | None,
    host: Host | None,
) -> int:
    if "port" in delivery:
        return _manifest_int(
            delivery["port"],
            field_name="delivery_profile.port",
            min_value=1,
            max_value=65535,
        )
    if host is not None and host.port is not None:
        return _manifest_int(
            host.port,
            field_name="host.port",
            min_value=1,
            max_value=65535,
        )
    if profile is not None and profile.port_reservations:
        return _manifest_int(
            profile.port_reservations[0].get("port"),
            field_name="profile.port_reservations[0].port",
            min_value=1,
            max_value=65535,
        )
    return 443


def _manifest_priority(delivery: dict[str, str]) -> int:
    return _manifest_int(
        delivery.get("priority", "100"),
        field_name="delivery_profile.priority",
        min_value=0,
        max_value=100000,
    )


def _manifest_int(
    value: object,
    *,
    field_name: str,
    min_value: int,
    max_value: int,
) -> int:
    try:
        parsed = int(str(value))
    except (TypeError, ValueError) as exc:
        raise APIError(
            code="subscription_manifest_invalid_value",
            message="Subscription manifest contains an invalid numeric value.",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            details=[field_name],
        ) from exc
    if parsed < min_value or parsed > max_value:
        raise APIError(
            code="subscription_manifest_invalid_value",
            message="Subscription manifest contains an out-of-range numeric value.",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            details=[field_name],
        )
    return parsed


def _manifest_credentials_ref(
    *,
    profile: ProtocolProfile | None,
    subscription: Subscription,
    protocol_type: str,
) -> str:
    credentials_ref = (
        profile.credentials_ref
        if profile is not None and profile.credentials_ref is not None
        else f"{VAULT_REF_PREFIX}subscriptions/{subscription.public_id}/{protocol_type}"
    )
    if not credentials_ref.startswith(VAULT_REF_PREFIX):
        raise APIError(
            code="subscription_manifest_credentials_ref_invalid",
            message="Subscription manifest credentials must reference vault storage.",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            details=["profile.credentials_ref"],
        )
    return credentials_ref


def _manifest_security(
    *,
    profile: ProtocolProfile | None,
    delivery: dict[str, str],
    protocol_type: str,
    host: Host | None,
) -> dict[str, object]:
    config = profile.config_json if profile is not None else {}
    security = config.get("security") if isinstance(config.get("security"), dict) else {}
    security_type = str(
        _host_string(host, "security")
        or security.get("type")
        or delivery.get("security")
        or _default_security(protocol_type)
    )
    return {
        "type": security_type,
        "serverName": _host_string(host, "sni")
        or security.get("serverName")
        or delivery.get("server_name"),
        "publicKey": security.get("publicKey") or delivery.get("public_key"),
        "shortId": security.get("shortId") or delivery.get("short_id"),
        "fingerprint": security.get("fingerprint") or delivery.get("fingerprint"),
        "spiderX": security.get("spiderX") or delivery.get("spider_x"),
        "alpn": _manifest_alpn(security=security, delivery=delivery),
        "allowInsecure": False,
    }


def _default_security(protocol_type: str) -> str:
    if protocol_type.endswith("reality") or "-reality" in protocol_type:
        return "reality"
    if (
        protocol_type.endswith("tls")
        or "-tls" in protocol_type
        or protocol_type
        in {"hysteria2", "naive", "naiveproxy", "openvpn", "openvpn-udp", "openvpn-shadowsocks"}
    ):
        return "tls"
    return "none"


def _default_transport(protocol_type: str) -> str:
    if protocol_type == "openvpn-shadowsocks":
        return "tcp"
    if protocol_type.startswith(("hysteria2", "tuic", "wireguard", "openvpn")):
        return "udp"
    if "grpc" in protocol_type:
        return "grpc"
    if "xhttp" in protocol_type:
        return "xhttp"
    if "httpupgrade" in protocol_type:
        return "httpupgrade"
    if "-ws" in protocol_type or "websocket" in protocol_type:
        return "ws"
    return "tcp"


def _profile_config_string(profile: ProtocolProfile | None, key: str) -> str | None:
    if profile is None:
        return None
    value = profile.config_json.get(key)
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _manifest_alpn(*, security: dict[str, object], delivery: dict[str, str]) -> list[str]:
    if isinstance(security.get("alpn"), list):
        return [str(value) for value in security["alpn"]]
    if delivery.get("alpn"):
        return [value.strip() for value in delivery["alpn"].split(",") if value.strip()]
    return []


def _manifest_capabilities(protocol_type: str) -> list[str]:
    return ["subscription"]


def _manifest_renderer_hints(
    *,
    delivery: dict[str, str],
    host: Host | None,
    profile: ProtocolProfile | None,
    profile_title: str,
) -> dict[str, object]:
    hints: dict[str, object] = {
        "liveDiagnostic": False,
        "name": profile_title,
        "method": delivery.get("method"),
        "plugin": delivery.get("plugin"),
        "pluginOpts": delivery.get("plugin_opts") or delivery.get("pluginOpts"),
        "obfs": delivery.get("obfs"),
        "address": delivery.get("address"),
        "allowedIps": delivery.get("allowed_ips"),
        "mtu": delivery.get("mtu"),
        "persistentKeepalive": delivery.get("persistent_keepalive"),
        "finalMask": _host_string(host, "final_mask"),
        "mihomoX25519PublicKey": _host_string(host, "mihomo_x25519_public_key"),
        "shuffleHost": host.shuffle_host if host is not None else None,
    }
    profile_config = profile.config_json if profile is not None else {}
    profile_metadata = (
        profile.metadata_json
        if profile is not None and isinstance(profile.metadata_json, dict)
        else {}
    )
    openvpn_pki = (
        profile_metadata.get("openvpn_pki")
        if isinstance(profile_metadata.get("openvpn_pki"), dict)
        else {}
    )
    if openvpn_pki.get("ca_cert") is not None:
        hints["caCert"] = openvpn_pki["ca_cert"]
    if profile is not None and profile.adapter == "openvpn-shadowsocks":
        shadowsocks_config = (
            profile_config.get("shadowsocks")
            if isinstance(profile_config.get("shadowsocks"), dict)
            else {}
        )
        if hints.get("method") is None:
            hints["method"] = (
                shadowsocks_config.get("method")
                or profile_config.get("method")
                or "aes-256-gcm"
            )
        openvpn_config = (
            profile_config.get("openvpn")
            if isinstance(profile_config.get("openvpn"), dict)
            else {}
        )
        hints["openvpnRemoteHost"] = openvpn_config.get("remote_host") or "127.0.0.1"
        hints["openvpnRemotePort"] = openvpn_config.get("listen_port") or 1194
    obfs_config = profile_config.get("obfs") if isinstance(profile_config.get("obfs"), dict) else {}
    if hints.get("obfs") is None and obfs_config.get("type") is not None:
        hints["obfs"] = obfs_config["type"]
    if hints.get("plugin") is None and profile_config.get("plugin") is not None:
        hints["plugin"] = profile_config["plugin"]
    if hints.get("pluginOpts") is None and profile_config.get("plugin_opts") is not None:
        hints["pluginOpts"] = profile_config["plugin_opts"]
    interface_config = (
        profile_config.get("interface") if isinstance(profile_config.get("interface"), dict) else {}
    )
    for key in AMNEZIA_WG_HINT_KEYS:
        if key in delivery and delivery[key] is not None:
            hints[key] = delivery[key]
        elif key in interface_config and interface_config[key] is not None:
            hints[key] = interface_config[key]
    return hints


def _manifest_credentials(credentials, *, username: str, method: str) -> dict[str, str]:
    return {
        "username": username,
        "uuid": credentials.uuid,
        "password": credentials.password,
        "shadowsocksPassword": shadowsocks_password_for_method(credentials, method),
        "hysteriaPassword": credentials.hysteria_password,
        "hysteriaObfsPassword": credentials.hysteria_obfs_password,
        "wireguardPrivateKey": credentials.wireguard_private_key,
        "wireguardPublicKey": credentials.wireguard_public_key,
    }


def _ensure_subscription_can_be_served(subscription: Subscription) -> None:
    if subscription.revoked_at is not None or subscription.status not in SERVABLE_STATUSES:
        raise APIError(
            code="subscription_not_active",
            message="Subscription is not active.",
            status_code=status.HTTP_410_GONE,
        )
    if (
        subscription.expires_at is not None
        and _ensure_aware(subscription.expires_at) <= datetime.now(UTC)
    ):
        raise APIError(
            code="subscription_expired",
            message="Subscription has expired.",
            status_code=status.HTTP_410_GONE,
        )


def _ensure_license_can_be_served(license_record: License | None) -> None:
    if license_record is None:
        raise APIError(
            code="subscription_license_not_found",
            message="Subscription license was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    if license_record.status not in SERVABLE_STATUSES:
        raise APIError(
            code="subscription_license_not_active",
            message="Subscription license is not active.",
            status_code=status.HTTP_410_GONE,
        )
    now = datetime.now(UTC)
    if license_record.starts_at is not None and _ensure_aware(license_record.starts_at) > now:
        raise APIError(
            code="subscription_license_not_active",
            message="Subscription license is not active yet.",
            status_code=status.HTTP_410_GONE,
        )
    if license_record.expires_at is not None and _ensure_aware(license_record.expires_at) <= now:
        raise APIError(
            code="subscription_license_expired",
            message="Subscription license has expired.",
            status_code=status.HTTP_410_GONE,
        )


def _normalize_device_id(device_id: str | None) -> str | None:
    if device_id is None:
        return None
    normalized = str(device_id).strip()
    if not normalized:
        return None
    if len(normalized) > 128:
        raise APIError(
            code="subscription_device_id_invalid",
            message="Device id is too long.",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            details=["device_id"],
        )
    return normalized


def _normalize_device_label(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    if not normalized:
        return None
    return normalized[:160]


def _device_id_matches(device: dict[object, object], device_id: str) -> bool:
    candidates = [device.get("id"), device.get("hwid")]
    return any(str(candidate) == device_id for candidate in candidates if candidate is not None)


def _ensure_aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _isoformat(value) -> str | None:
    return value.isoformat().replace("+00:00", "Z") if value is not None else None


async def create_subscription_public_id(session: AsyncSession) -> str:
    for _ in range(PUBLIC_ID_COLLISION_ATTEMPTS):
        public_id = generate_opaque_token(prefix=SUBSCRIPTION_PUBLIC_ID_PREFIX, entropy_bytes=16)
        existing_subscription = (
            await session.execute(select(Subscription).where(Subscription.public_id == public_id))
        ).scalar_one_or_none()
        if existing_subscription is None:
            return public_id

    raise APIError(
        code="subscription_public_id_collision",
        message="Could not allocate a unique subscription public id.",
        status_code=status.HTTP_409_CONFLICT,
    )
