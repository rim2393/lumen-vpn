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
from app.domains.api_keys.models import ApiKey
from app.domains.auth.models import UserSession
from app.domains.licenses.models import License
from app.domains.subscriptions.models import Subscription
from app.domains.users.models import User
from app.main import create_app

SESSION_DIGEST = "session-hash-for-compat-test"


@dataclass(frozen=True)
class SeededCompatData:
    api_key_id: str
    license_id: str
    owner_email: str
    owner_id: str
    session_expires_at: datetime
    session_id: str


@dataclass(frozen=True)
class CompatRouteApp:
    client: AsyncClient
    principal_ref: dict[str, Principal]
    sessionmaker: async_sessionmaker[AsyncSession]


@pytest.fixture
async def compat_app(tmp_path) -> AsyncIterator[CompatRouteApp]:
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

    principal_ref = {
        "principal": Principal(
            subject="bootstrap-admin",
            email="bootstrap-admin@example.com",
            roles={Role.OWNER},
            permissions=set(Permission),
        )
    }

    async def override_principal() -> Principal:
        return principal_ref["principal"]

    app = create_app(settings)
    app.dependency_overrides[get_db_session] = override_db_session
    app.dependency_overrides[get_current_principal] = override_principal
    app.dependency_overrides[get_settings] = lambda: settings

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        yield CompatRouteApp(
            client=client,
            principal_ref=principal_ref,
            sessionmaker=sessionmaker,
        )

    app.dependency_overrides.clear()
    await engine.dispose()


async def seed_compat_data(compat_app: CompatRouteApp) -> SeededCompatData:
    now = datetime(2026, 5, 27, tzinfo=UTC)
    async with compat_app.sessionmaker() as session:
        owner = User(
            email="owner.admin@example.com",
            role=Role.OWNER.value,
            status="active",
            traffic_used_gb=42.5,
            created_at=now - timedelta(days=20),
            updated_at=now - timedelta(days=1),
        )
        expired_user = User(
            email="expired.user@example.com",
            role=Role.USER.value,
            status="active",
            traffic_used_gb=11.0,
            created_at=now - timedelta(days=40),
            updated_at=now - timedelta(days=2),
        )
        session.add_all([owner, expired_user])
        await session.flush()

        license_record = License(
            license_key_hash="license-hash-for-compat-test",
            customer_ref="Acme Ops",
            status="active",
            max_devices=25,
            starts_at=now - timedelta(days=30),
            expires_at=now + timedelta(days=90),
            metadata_json={
                "features": "Guard admin shell,Node health telemetry",
                "plan": "Business mesh",
            },
            created_at=now - timedelta(days=30),
            updated_at=now - timedelta(days=5),
        )
        session.add(license_record)
        await session.flush()

        active_subscription = Subscription(
            public_id="lumen_sub_active_compat",
            user_id=owner.id,
            license_id=license_record.id,
            status="active",
            delivery_profile={"traffic_used_gb": "42.5"},
            expires_at=now + timedelta(days=45),
            created_at=now - timedelta(days=10),
            updated_at=now - timedelta(days=1),
        )
        expired_subscription = Subscription(
            public_id="lumen_sub_expired_compat",
            user_id=expired_user.id,
            license_id=license_record.id,
            status="active",
            delivery_profile={"traffic_used_gb": "11"},
            expires_at=now - timedelta(days=1),
            created_at=now - timedelta(days=20),
            updated_at=now - timedelta(days=2),
        )
        api_key = ApiKey(
            owner_user_id=owner.id,
            name="Compat report worker",
            key_prefix="lumen_sk_compat",
            key_hash="api-key-hash-for-compat-test",
            scopes=[Permission.API_KEY_MANAGE.value, Permission.USER_MANAGE.value],
            expires_at=now + timedelta(days=5),
            last_used_at=now - timedelta(hours=2),
            created_at=now - timedelta(days=3),
            updated_at=now - timedelta(days=1),
        )
        user_session = UserSession(
            user_id=owner.id,
            token_hash=SESSION_DIGEST,
            expires_at=now + timedelta(hours=1),
            created_at=now - timedelta(hours=2),
            updated_at=now - timedelta(hours=2),
        )
        session.add_all([active_subscription, expired_subscription, api_key, user_session])
        await session.commit()

        return SeededCompatData(
            api_key_id=str(api_key.id),
            license_id=str(license_record.id),
            owner_email=owner.email,
            owner_id=str(owner.id),
            session_expires_at=user_session.expires_at,
            session_id=str(user_session.id),
        )


async def test_compat_session_returns_web_auth_session_shape(
    compat_app: CompatRouteApp,
) -> None:
    seeded = await seed_compat_data(compat_app)
    compat_app.principal_ref["principal"] = Principal(
        subject=seeded.owner_id,
        email=seeded.owner_email,
        roles={Role.OWNER},
        permissions={Permission.USER_MANAGE, Permission.API_KEY_MANAGE},
        session_id=seeded.session_id,
    )

    response = await compat_app.client.get("/api/auth/session")

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "owner.admin@example.com"
    assert body["expiresAt"].startswith("2026-05-27T01:00:00")
    assert body["name"] == "Owner Admin"
    assert body["role"] == "owner"
    assert body["scopes"] == ["api_key:manage", "user:manage"]
    assert body["userId"] == seeded.owner_id


async def test_compat_admin_users_returns_resource_list_shape(
    compat_app: CompatRouteApp,
) -> None:
    seeded = await seed_compat_data(compat_app)
    compat_app.principal_ref["principal"] = Principal(
        subject=seeded.owner_id,
        email=seeded.owner_email,
        roles={Role.OWNER},
        permissions={Permission.USER_MANAGE},
    )

    response = await compat_app.client.get("/api/admin/users")

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "api"
    assert body["total"] == 2
    assert "generatedAt" in body

    by_email = {item["email"]: item for item in body["items"]}
    assert by_email["owner.admin@example.com"]["displayName"] == "Owner Admin"
    assert by_email["owner.admin@example.com"]["role"] == "owner"
    assert by_email["owner.admin@example.com"]["status"] == "active"
    assert by_email["owner.admin@example.com"]["subscription"] == "paid"
    assert by_email["owner.admin@example.com"]["trafficUsedGb"] == 42.5
    assert by_email["expired.user@example.com"]["status"] == "limited"
    assert by_email["expired.user@example.com"]["subscription"] == "expired"


async def test_compat_admin_api_keys_omits_secret_material(
    compat_app: CompatRouteApp,
) -> None:
    seeded = await seed_compat_data(compat_app)
    compat_app.principal_ref["principal"] = Principal(
        subject=seeded.owner_id,
        email=seeded.owner_email,
        roles={Role.ADMIN},
        permissions={Permission.API_KEY_MANAGE},
    )

    response = await compat_app.client.get("/api/admin/api-keys")

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "api"
    assert body["total"] == 1
    item = body["items"][0]
    assert item["id"] == seeded.api_key_id
    assert item["fingerprint"] == "lumen_sk_compat"
    assert item["owner"] == "Owner Admin"
    assert item["status"] == "expiring"
    assert item["scopes"] == ["api_key:manage", "user:manage"]
    assert "api_key" not in item
    assert "apiKey" not in item
    assert "key_hash" not in item
    assert "keyHash" not in item


async def test_compat_admin_license_returns_summary_without_key_hash(
    compat_app: CompatRouteApp,
) -> None:
    seeded = await seed_compat_data(compat_app)
    compat_app.principal_ref["principal"] = Principal(
        subject=seeded.owner_id,
        email=seeded.owner_email,
        roles={Role.OWNER},
        permissions={Permission.LICENSE_MANAGE},
    )

    response = await compat_app.client.get("/api/admin/license")

    assert response.status_code == 200
    body = response.json()
    assert body["issuedTo"] == "Acme Ops"
    assert body["plan"] == "Business mesh"
    assert body["features"] == ["Guard admin shell", "Node health telemetry"]
    assert body["seatsLimit"] == 25
    assert body["seatsUsed"] == 1
    assert body["status"] == "valid"
    assert body["auditEvents"][0]["label"] == "License registered"
    assert "license_key" not in body
    assert "licenseKey" not in body
    assert "license_key_hash" not in body
    assert "licenseKeyHash" not in body


async def test_compat_admin_routes_require_admin_read_access(
    compat_app: CompatRouteApp,
) -> None:
    seeded = await seed_compat_data(compat_app)
    compat_app.principal_ref["principal"] = Principal(
        subject=seeded.owner_id,
        email=seeded.owner_email,
        roles={Role.USER},
        permissions=set(),
    )

    response = await compat_app.client.get("/api/admin/users")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"
