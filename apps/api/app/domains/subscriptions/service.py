from uuid import UUID

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.core.security import generate_opaque_token
from app.domains.licenses.models import License
from app.domains.nodes.models import Node
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
