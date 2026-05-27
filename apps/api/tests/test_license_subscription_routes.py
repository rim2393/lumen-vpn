from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import app.db.models  # noqa: F401
from app.core.config import Settings, get_settings
from app.core.rbac import Permission, Principal, Role, get_current_principal
from app.db.base import Base
from app.db.session import create_engine, get_db_session
from app.domains.licenses.models import License
from app.domains.licenses.service import hash_license_key
from app.domains.nodes.models import Node
from app.domains.users.models import User
from app.main import create_app


@dataclass(frozen=True)
class RouteTestApp:
    client: AsyncClient
    sessionmaker: async_sessionmaker[AsyncSession]


@pytest.fixture
async def route_app(tmp_path) -> AsyncIterator[RouteTestApp]:
    settings = Settings(
        environment="test",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'api.db'}",
    )
    engine = create_engine(settings)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessionmaker = async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)

    async def override_db_session() -> AsyncIterator[AsyncSession]:
        async with sessionmaker() as session:
            yield session

    async def override_principal() -> Principal:
        return Principal(
            subject="owner",
            email="owner@example.com",
            roles={Role.OWNER},
            permissions={
                Permission.LICENSE_MANAGE,
                Permission.SUBSCRIPTION_READ,
                Permission.SUBSCRIPTION_MANAGE,
            },
        )

    app = create_app(settings)
    app.dependency_overrides[get_db_session] = override_db_session
    app.dependency_overrides[get_current_principal] = override_principal
    app.dependency_overrides[get_settings] = lambda: settings

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        yield RouteTestApp(client=client, sessionmaker=sessionmaker)

    app.dependency_overrides.clear()
    await engine.dispose()


async def seed_subscription_dependencies(
    route_app: RouteTestApp,
) -> tuple[User, License, Node]:
    async with route_app.sessionmaker() as session:
        user = User(email="route-subscriber@example.com", status="active")
        license_record = License(
            license_key_hash=hash_license_key("route-subscription-license"),
            customer_ref="route-customer",
            status="active",
            max_devices=3,
            starts_at=datetime.now(UTC) - timedelta(days=1),
            expires_at=datetime.now(UTC) + timedelta(days=30),
            metadata_json={},
        )
        node = Node(
            name="route-subscription-node",
            region="eu",
            public_address="203.0.113.50",
            status="active",
            capabilities={},
        )
        session.add_all([user, license_record, node])
        await session.commit()
        return user, license_record, node


async def test_license_routes_create_list_and_get(route_app: RouteTestApp) -> None:
    create_response = await route_app.client.post(
        "/api/v1/licenses",
        json={
            "license_key": "route-license-key",
            "customer_ref": "route-customer",
            "max_devices": 8,
            "metadata_json": {"tier": "enterprise"},
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["customer_ref"] == "route-customer"
    assert created["max_devices"] == 8
    assert created["metadata_json"] == {"tier": "enterprise"}
    assert "license_key" not in created
    assert "license_key_hash" not in created

    list_response = await route_app.client.get("/api/v1/licenses")
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()["items"]] == [created["id"]]

    get_response = await route_app.client.get(f"/api/v1/licenses/{created['id']}")
    assert get_response.status_code == 200
    assert get_response.json()["id"] == created["id"]


async def test_license_route_duplicate_key_returns_api_error(route_app: RouteTestApp) -> None:
    payload = {"license_key": "duplicate-route-license"}
    first_response = await route_app.client.post("/api/v1/licenses", json=payload)
    assert first_response.status_code == 201

    duplicate_response = await route_app.client.post("/api/v1/licenses", json=payload)
    assert duplicate_response.status_code == 409
    assert duplicate_response.json()["error"]["code"] == "license_key_exists"


async def test_subscription_routes_create_list_and_get(route_app: RouteTestApp) -> None:
    user, license_record, node = await seed_subscription_dependencies(route_app)

    create_response = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {"protocol": "vless"},
            "config_hash": "sha256:route-config",
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["public_id"].startswith("lumen_sub_")
    assert created["status"] == "active"
    assert created["config_hash"] == "sha256:route-config"
    assert created["delivery_profile"] == {"protocol": "vless"}

    list_response = await route_app.client.get("/api/v1/subscriptions")
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()["items"]] == [created["id"]]

    get_response = await route_app.client.get(f"/api/v1/subscriptions/{created['id']}")
    assert get_response.status_code == 200
    assert get_response.json()["public_id"] == created["public_id"]


async def test_subscription_route_rejects_inline_secret_delivery_field(
    route_app: RouteTestApp,
) -> None:
    user, license_record, _ = await seed_subscription_dependencies(route_app)

    response = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "delivery_profile": {"runtime_config": "plain-json"},
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "inline_secret_rejected"
