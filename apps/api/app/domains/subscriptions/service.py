from datetime import UTC, datetime
from uuid import UUID

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.core.security import generate_opaque_token
from app.domains.licenses.models import License
from app.domains.nodes.models import Node
from app.domains.protocols.models import Host, ProtocolProfile
from app.domains.subscriptions.models import Subscription
from app.domains.subscriptions.schemas import SubscriptionCreateRequest
from app.domains.users.models import User

SUBSCRIPTION_PUBLIC_ID_PREFIX = "lumen_sub"
PUBLIC_ID_COLLISION_ATTEMPTS = 3
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


async def build_subscription_manifest(
    session: AsyncSession,
    *,
    subscription_id: UUID,
) -> dict[str, object]:
    subscription = await get_subscription(session, subscription_id=subscription_id)
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
    protocol_type = delivery.get("protocol") or (
        profile.adapter if profile is not None else "tcp-smoke"
    )
    adapter = delivery.get("adapter") or (
        profile.adapter
        if profile is not None and profile.adapter != "tcp-smoke"
        else "tcp-smoke-listener"
    )
    endpoint_host = host.hostname if host is not None else node.public_address
    endpoint_port = _manifest_port(delivery=delivery, profile=profile)
    credentials_ref = (
        profile.credentials_ref
        if profile is not None and profile.credentials_ref is not None
        else f"vault://subscriptions/{subscription.public_id}/{protocol_type}"
    )

    return {
        "schemaVersion": "lumen.subscription-manifest.v1",
        "generatedAt": _isoformat(
            subscription.updated_at or subscription.created_at or datetime.now(UTC),
        ),
        "provider": {
            "id": delivery.get("provider_id") or "lumen",
            "name": delivery.get("provider_name") or "Lumen",
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
                "priority": int(delivery.get("priority", "100")),
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
                        "security": _manifest_security(profile=profile, delivery=delivery),
                        "flow": delivery.get("flow"),
                        "credentialsRef": credentials_ref,
                        "capabilities": _manifest_capabilities(protocol_type),
                        "rendererHints": {"liveSmoke": protocol_type == "tcp-smoke"},
                    }
                ],
                "metadata": {},
            }
        ],
        "renderHints": {"preferredFormats": [delivery.get("format") or "lumen-json"]},
        "metadata": {
            "source": "lumen-api",
            "subscriptionId": str(subscription.id),
        },
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


def _manifest_port(
    *,
    delivery: dict[str, str],
    profile: ProtocolProfile | None,
) -> int:
    if "port" in delivery:
        return int(delivery["port"])
    if profile is not None and profile.port_reservations:
        return int(profile.port_reservations[0]["port"])
    return 443


def _manifest_security(
    *,
    profile: ProtocolProfile | None,
    delivery: dict[str, str],
) -> dict[str, object]:
    config = profile.config_json if profile is not None else {}
    security = config.get("security") if isinstance(config.get("security"), dict) else {}
    security_type = str(security.get("type") or delivery.get("security") or "none")
    return {
        "type": security_type,
        "serverName": security.get("serverName") or delivery.get("server_name"),
        "publicKey": security.get("publicKey"),
        "shortId": security.get("shortId"),
        "fingerprint": security.get("fingerprint"),
        "spiderX": security.get("spiderX"),
        "alpn": security.get("alpn") if isinstance(security.get("alpn"), list) else [],
        "allowInsecure": False,
    }


def _manifest_capabilities(protocol_type: str) -> list[str]:
    if protocol_type == "tcp-smoke":
        return ["tcp", "live-smoke"]
    return ["subscription"]


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
