from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.db.models  # noqa: F401
from app.core.config import Settings
from app.core.errors import APIError
from app.db.base import Base
from app.db.session import create_engine, create_sessionmaker
from app.domains.licenses.models import License
from app.domains.licenses.schemas import LicenseCreateRequest
from app.domains.licenses.service import (
    create_license,
    get_license,
    hash_license_key,
    list_licenses,
)
from app.domains.nodes.models import Node
from app.domains.subscriptions.models import Subscription
from app.domains.subscriptions.schemas import SubscriptionCreateRequest, SubscriptionUpdateRequest
from app.domains.subscriptions.service import (
    create_subscription,
    get_subscription,
    list_subscriptions,
    revoke_subscription,
    update_subscription,
)
from app.domains.users.models import User


@pytest.fixture
async def db_session(tmp_path) -> AsyncIterator[AsyncSession]:
    settings = Settings(
        environment="test",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'api.db'}",
    )
    engine = create_engine(settings)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    sessionmaker = create_sessionmaker(settings)
    async with sessionmaker() as session:
        yield session

    await engine.dispose()


async def seed_user_license_node(
    session: AsyncSession,
) -> tuple[User, License, Node]:
    user = User(email="subscriber@example.com", status="active")
    license_record = License(
        license_key_hash=hash_license_key("license-for-subscription"),
        customer_ref="customer-subscription",
        status="active",
        max_devices=3,
        starts_at=datetime.now(UTC) - timedelta(days=1),
        expires_at=datetime.now(UTC) + timedelta(days=30),
        metadata_json={},
    )
    node = Node(
        name="subscription-node",
        region="eu",
        public_address="203.0.113.40",
        status="active",
        capabilities={},
    )
    session.add_all([user, license_record, node])
    await session.flush()
    return user, license_record, node


async def test_create_license_hashes_key_and_list_get_roundtrip(
    db_session: AsyncSession,
) -> None:
    license_record = await create_license(
        db_session,
        request=LicenseCreateRequest(
            license_key=SecretStr("plain-license-key"),
            customer_ref="customer-1",
            max_devices=5,
            metadata_json={"tier": "team"},
        ),
    )

    assert license_record.license_key_hash == hash_license_key("plain-license-key")
    assert license_record.license_key_hash != "plain-license-key"
    assert license_record.status == "pending_sync"
    assert license_record.max_devices == 0
    assert license_record.metadata_json == {
        "sync_status": "pending",
        "tier": "team",
    }

    persisted = (await db_session.execute(select(License))).scalar_one()
    assert persisted.license_key_hash == license_record.license_key_hash

    listed = await list_licenses(db_session)
    fetched = await get_license(db_session, license_id=license_record.id)
    assert listed == [license_record]
    assert fetched.id == license_record.id


async def test_create_license_rejects_duplicate_key(
    db_session: AsyncSession,
) -> None:
    request = LicenseCreateRequest(license_key=SecretStr("duplicate-license-key"))
    await create_license(db_session, request=request)

    with pytest.raises(APIError) as conflict:
        await create_license(db_session, request=request)

    assert conflict.value.code == "license_key_exists"
    assert conflict.value.status_code == 409


async def test_get_license_missing_returns_api_error(
    db_session: AsyncSession,
) -> None:
    with pytest.raises(APIError) as missing:
        await get_license(db_session, license_id=uuid4())

    assert missing.value.code == "license_not_found"
    assert missing.value.status_code == 404


async def test_create_subscription_generates_public_id_and_list_get_roundtrip(
    db_session: AsyncSession,
) -> None:
    user, license_record, node = await seed_user_license_node(db_session)

    subscription = await create_subscription(
        db_session,
        request=SubscriptionCreateRequest(
            user_id=user.id,
            license_id=license_record.id,
            node_id=node.id,
            delivery_profile={"protocol": "vless"},
            config_hash="sha256:subscription-config",
            expires_at=datetime.now(UTC) + timedelta(days=7),
        ),
    )

    assert subscription.public_id.startswith("lumen_sub_")
    assert subscription.status == "active"
    assert subscription.config_hash == "sha256:subscription-config"

    persisted = (await db_session.execute(select(Subscription))).scalar_one()
    assert persisted.public_id == subscription.public_id

    listed = await list_subscriptions(db_session)
    fetched = await get_subscription(db_session, subscription_id=subscription.id)
    assert listed == [subscription]
    assert fetched.id == subscription.id


async def test_create_subscription_validates_related_records(
    db_session: AsyncSession,
) -> None:
    user, license_record, node = await seed_user_license_node(db_session)

    with pytest.raises(APIError) as missing_user:
        await create_subscription(
            db_session,
            request=SubscriptionCreateRequest(user_id=uuid4(), license_id=license_record.id),
        )
    assert missing_user.value.code == "subscription_user_not_found"
    assert missing_user.value.status_code == 404

    with pytest.raises(APIError) as missing_license:
        await create_subscription(
            db_session,
            request=SubscriptionCreateRequest(user_id=user.id, license_id=uuid4()),
        )
    assert missing_license.value.code == "subscription_license_not_found"
    assert missing_license.value.status_code == 404

    with pytest.raises(APIError) as missing_node:
        await create_subscription(
            db_session,
            request=SubscriptionCreateRequest(
                user_id=user.id,
                license_id=license_record.id,
                node_id=uuid4(),
            ),
        )
    assert missing_node.value.code == "subscription_node_not_found"
    assert missing_node.value.status_code == 404

    valid = await create_subscription(
        db_session,
        request=SubscriptionCreateRequest(
            user_id=user.id,
            license_id=license_record.id,
            node_id=node.id,
            delivery_profile={"protocol": "vless"},
        ),
    )
    assert valid.node_id == node.id

    with pytest.raises(APIError) as missing_renderable_node:
        await create_subscription(
            db_session,
            request=SubscriptionCreateRequest(
                user_id=user.id,
                license_id=license_record.id,
                delivery_profile={"protocol": "vless"},
            ),
        )
    assert missing_renderable_node.value.code == "subscription_node_required"

    with pytest.raises(APIError) as missing_protocol:
        await create_subscription(
            db_session,
            request=SubscriptionCreateRequest(
                user_id=user.id,
                license_id=license_record.id,
                node_id=node.id,
                delivery_profile={"format": "happ"},
            ),
        )
    assert missing_protocol.value.code == "subscription_protocol_required"


async def test_create_subscription_rejects_inline_secret_delivery_fields(
    db_session: AsyncSession,
) -> None:
    user, license_record, _ = await seed_user_license_node(db_session)

    with pytest.raises(APIError) as secret_error:
        await create_subscription(
            db_session,
            request=SubscriptionCreateRequest(
                user_id=user.id,
                license_id=license_record.id,
                delivery_profile={"subscription_url": "https://example.invalid/plain"},
            ),
        )

    assert secret_error.value.code == "inline_secret_rejected"
    assert secret_error.value.status_code == 422
    assert secret_error.value.details == ["delivery_profile.subscription_url"]


async def test_update_subscription_patches_lifecycle_fields(
    db_session: AsyncSession,
) -> None:
    user, license_record, node = await seed_user_license_node(db_session)
    replacement_node = Node(
        name="replacement-subscription-node",
        region="us",
        public_address="203.0.113.41",
        status="active",
        capabilities={},
    )
    db_session.add(replacement_node)
    await db_session.flush()
    subscription = await create_subscription(
        db_session,
        request=SubscriptionCreateRequest(
            user_id=user.id,
            license_id=license_record.id,
            node_id=node.id,
            delivery_profile={"protocol": "vless"},
            config_hash="sha256:old-config",
            expires_at=datetime.now(UTC) + timedelta(days=7),
        ),
    )

    updated = await update_subscription(
        db_session,
        subscription_id=subscription.id,
        request=SubscriptionUpdateRequest(
            status="limited",
            node_id=replacement_node.id,
            delivery_profile={"protocol": "vless", "format": "lumen-json"},
            config_hash=None,
            expires_at=None,
        ),
    )

    assert updated.status == "limited"
    assert updated.node_id == replacement_node.id
    assert updated.delivery_profile == {"protocol": "vless", "format": "lumen-json"}
    assert updated.config_hash is None
    assert updated.expires_at is None


async def test_update_subscription_validates_node_and_secret_delivery_fields(
    db_session: AsyncSession,
) -> None:
    user, license_record, node = await seed_user_license_node(db_session)
    subscription = await create_subscription(
        db_session,
        request=SubscriptionCreateRequest(
            user_id=user.id,
            license_id=license_record.id,
            node_id=node.id,
            delivery_profile={"protocol": "vless"},
        ),
    )

    with pytest.raises(APIError) as missing_node:
        await update_subscription(
            db_session,
            subscription_id=subscription.id,
            request=SubscriptionUpdateRequest(node_id=uuid4()),
        )
    assert missing_node.value.code == "subscription_node_not_found"
    assert missing_node.value.status_code == 404

    with pytest.raises(APIError) as secret_error:
        await update_subscription(
            db_session,
            subscription_id=subscription.id,
            request=SubscriptionUpdateRequest(delivery_profile={"token": "inline"}),
        )
    assert secret_error.value.code == "inline_secret_rejected"
    assert secret_error.value.details == ["delivery_profile.token"]


async def test_revoke_subscription_sets_status_and_revoked_at(
    db_session: AsyncSession,
) -> None:
    user, license_record, node = await seed_user_license_node(db_session)
    subscription = await create_subscription(
        db_session,
        request=SubscriptionCreateRequest(
            user_id=user.id,
            license_id=license_record.id,
            node_id=node.id,
            delivery_profile={"protocol": "vless"},
        ),
    )

    revoked = await revoke_subscription(db_session, subscription_id=subscription.id)

    assert revoked.status == "revoked"
    assert revoked.revoked_at is not None
