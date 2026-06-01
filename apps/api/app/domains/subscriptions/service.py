from datetime import UTC, datetime
from uuid import UUID

from fastapi import status
from sqlalchemy import select
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
from app.domains.subscriptions.renderers import derive_client_credentials
from app.domains.subscriptions.schemas import (
    SubscriptionCreateRequest,
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
    "tuic",
    "wireguard",
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
    host = await _get_optional_host(session, delivery.get("host_id"))
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
    endpoint_host = host.hostname if host is not None else node.public_address
    endpoint_port = _manifest_port(delivery=delivery, profile=profile)
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
                            "transport": delivery.get("transport") or "tcp",
                            "network": delivery.get("network") or "public",
                        },
                        "security": _manifest_security(
                            profile=profile,
                            delivery=delivery,
                            protocol_type=protocol_type,
                        ),
                        "flow": delivery.get("flow"),
                        "credentialsRef": credentials_ref,
                        "credentials": _manifest_credentials(credentials),
                        "capabilities": _manifest_capabilities(protocol_type),
                        "rendererHints": _manifest_renderer_hints(
                            delivery=delivery,
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
) -> int:
    if "port" in delivery:
        return _manifest_int(
            delivery["port"],
            field_name="delivery_profile.port",
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
) -> dict[str, object]:
    config = profile.config_json if profile is not None else {}
    security = config.get("security") if isinstance(config.get("security"), dict) else {}
    security_type = str(
        security.get("type") or delivery.get("security") or _default_security(protocol_type)
    )
    return {
        "type": security_type,
        "serverName": security.get("serverName") or delivery.get("server_name"),
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
    if protocol_type.endswith("tls") or "-tls" in protocol_type or protocol_type == "hysteria2":
        return "tls"
    return "none"


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
    profile: ProtocolProfile | None,
    profile_title: str,
) -> dict[str, object]:
    hints: dict[str, object] = {
        "liveDiagnostic": False,
        "name": profile_title,
        "method": delivery.get("method"),
        "address": delivery.get("address"),
        "allowedIps": delivery.get("allowed_ips"),
        "mtu": delivery.get("mtu"),
        "persistentKeepalive": delivery.get("persistent_keepalive"),
    }
    profile_config = profile.config_json if profile is not None else {}
    interface_config = (
        profile_config.get("interface") if isinstance(profile_config.get("interface"), dict) else {}
    )
    for key in AMNEZIA_WG_HINT_KEYS:
        if key in delivery and delivery[key] is not None:
            hints[key] = delivery[key]
        elif key in interface_config and interface_config[key] is not None:
            hints[key] = interface_config[key]
    return hints


def _manifest_credentials(credentials) -> dict[str, str]:
    return {
        "uuid": credentials.uuid,
        "password": credentials.password,
        "shadowsocksPassword": credentials.shadowsocks_password,
        "hysteriaPassword": credentials.hysteria_password,
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
