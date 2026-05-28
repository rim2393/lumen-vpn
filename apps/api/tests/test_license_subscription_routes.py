from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import app.db.models  # noqa: F401
from app.core.config import Settings, get_settings
from app.core.rbac import Permission, Principal, Role, get_current_principal
from app.db.base import Base
from app.db.session import create_engine, get_db_session
from app.domains.audit.models import AuditEvent
from app.domains.licenses.models import License
from app.domains.licenses.service import hash_license_key
from app.domains.nodes.models import Node
from app.domains.protocols.models import Host, ProtocolProfile
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
    assert created["status"] == "pending_sync"
    assert created["max_devices"] == 0
    assert created["metadata_json"] == {
        "sync_status": "pending",
        "tier": "enterprise",
    }
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


async def test_subscription_create_requires_node_and_renderable_protocol(
    route_app: RouteTestApp,
) -> None:
    user, license_record, node = await seed_subscription_dependencies(route_app)

    missing_node_response = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": None,
            "delivery_profile": {"protocol": "vless"},
        },
    )
    assert missing_node_response.status_code == 422
    assert missing_node_response.json()["error"]["code"] == "subscription_node_required"

    missing_protocol_response = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {"format": "happ"},
        },
    )
    assert missing_protocol_response.status_code == 422
    assert missing_protocol_response.json()["error"]["code"] == "subscription_protocol_required"


async def test_subscription_routes_patch_revoke_and_record_audit(
    route_app: RouteTestApp,
) -> None:
    user, license_record, node = await seed_subscription_dependencies(route_app)
    async with route_app.sessionmaker() as session:
        replacement_node = Node(
            name="route-replacement-node",
            region="us",
            public_address="203.0.113.51",
            status="active",
            capabilities={},
        )
        session.add(replacement_node)
        await session.commit()
        replacement_node_id = str(replacement_node.id)

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
    subscription_id = create_response.json()["id"]

    patch_response = await route_app.client.patch(
        f"/api/v1/subscriptions/{subscription_id}",
        json={
            "status": "limited",
            "node_id": replacement_node_id,
            "delivery_profile": {"protocol": "vless", "format": "lumen-json"},
            "config_hash": None,
            "expires_at": None,
        },
    )
    assert patch_response.status_code == 200
    patched = patch_response.json()
    assert patched["status"] == "limited"
    assert patched["node_id"] == replacement_node_id
    assert patched["delivery_profile"] == {"protocol": "vless", "format": "lumen-json"}
    assert patched["config_hash"] is None
    assert patched["expires_at"] is None

    revoke_response = await route_app.client.post(f"/api/v1/subscriptions/{subscription_id}/revoke")
    assert revoke_response.status_code == 200
    revoked = revoke_response.json()
    assert revoked["status"] == "revoked"
    assert revoked["revoked_at"] is not None

    async with route_app.sessionmaker() as session:
        events = (
            await session.execute(select(AuditEvent).order_by(AuditEvent.created_at.asc()))
        ).scalars().all()

    assert [event.action for event in events] == [
        "subscription.updated",
        "subscription.revoked",
    ]
    assert {event.resource_id for event in events} == {subscription_id}
    assert all(event.actor_email == "owner@example.com" for event in events)


async def test_subscription_manifest_route_renders_vless_profile_protocol(
    route_app: RouteTestApp,
) -> None:
    user, license_record, node = await seed_subscription_dependencies(route_app)
    async with route_app.sessionmaker() as session:
        profile = ProtocolProfile(
            name="vless-profile",
            node_id=node.id,
            adapter="vless-tcp-tls",
            status="active",
            config_json={"security": {"type": "tls", "serverName": "route.example.net"}},
            port_reservations=[
                {"address": "0.0.0.0", "port": 18081, "protocol": "tcp"},  # noqa: S104
            ],
            credentials_ref="vault://subscriptions/vless-profile/client",
        )
        session.add(profile)
        await session.flush()
        host = Host(
            name="vless-host",
            hostname="85.192.60.8",
            node_id=node.id,
            protocol_profile_id=profile.id,
            status="active",
            tags=["vless"],
        )
        session.add(host)
        await session.commit()

    create_response = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {
                "protocol": "vless-tcp-tls",
                "adapter": "vless-tcp-tls",
                "profile_id": str(profile.id),
                "host_id": str(host.id),
                "format": "lumen-json",
            },
            "config_hash": "sha256:vless-profile",
        },
    )
    assert create_response.status_code == 201

    manifest_response = await route_app.client.get(
        f"/api/v1/subscriptions/{create_response.json()['id']}/manifest",
    )

    assert manifest_response.status_code == 200
    manifest = manifest_response.json()
    protocol = manifest["nodes"][0]["protocols"][0]
    assert manifest["schemaVersion"] == "lumen.subscription-manifest.v1"
    assert manifest["subscription"]["id"].startswith("lumen_sub_")
    assert protocol["type"] == "vless-tcp-tls"
    assert protocol["adapter"] == "vless-tcp-tls"
    assert protocol["endpoint"] == {
        "host": "85.192.60.8",
        "port": 18081,
        "transport": "tcp",
        "network": "public",
    }
    assert protocol["security"]["type"] == "tls"

    public_manifest_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{create_response.json()['public_id']}/manifest",
    )

    assert public_manifest_response.status_code == 200
    public_manifest = public_manifest_response.json()
    assert public_manifest["subscription"]["id"] == create_response.json()["public_id"]
    assert public_manifest["nodes"][0]["protocols"][0]["type"] == "vless-tcp-tls"


async def test_public_subscription_renderers_emit_client_compatible_formats(
    route_app: RouteTestApp,
) -> None:
    user, license_record, node = await seed_subscription_dependencies(route_app)
    create_response = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {
                "protocol": "vless-reality",
                "adapter": "vless-reality",
                "profile_title": "Lumen Test",
                "server_name": "www.example.com",
                "public_key": "F1E2D3C4B5A69788776655443322110abcdEFGH_-",
                "short_id": "a1b2c3d4",
                "fingerprint": "chrome",
                "spider_x": "/",
                "flow": "xtls-rprx-vision",
                "traffic_limit_gb": "500",
            },
            "config_hash": "sha256:vless-reality",
        },
    )
    assert create_response.status_code == 201
    public_id = create_response.json()["public_id"]

    raw_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=hiddify",
    )
    assert raw_response.status_code == 200
    assert raw_response.headers["x-lumen-render-target"] == "hiddify"
    assert raw_response.headers["profile-title"].startswith("base64:")
    assert "total=536870912000" in raw_response.headers["subscription-userinfo"]
    raw_body = raw_response.text
    assert raw_body.startswith("vless://")
    assert "security=reality" in raw_body
    assert "pbk=F1E2D3C4B5A69788776655443322110abcdEFGH_-" in raw_body
    assert "sid=a1b2c3d4" in raw_body
    assert "flow=xtls-rprx-vision" in raw_body

    mihomo_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=mihomo",
    )
    assert mihomo_response.status_code == 200
    assert "proxies:" in mihomo_response.text
    assert 'type: "vless"' in mihomo_response.text
    assert "reality-opts:" in mihomo_response.text
    assert 'public-key: "F1E2D3C4B5A69788776655443322110abcdEFGH_-"' in (
        mihomo_response.text
    )

    sing_box_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=sing-box",
    )
    assert sing_box_response.status_code == 200
    sing_box = sing_box_response.json()
    assert sing_box["outbounds"][0]["type"] == "vless"
    assert sing_box["outbounds"][0]["tls"]["reality"]["public_key"] == (
        "F1E2D3C4B5A69788776655443322110abcdEFGH_-"
    )

    xray_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=amnezia",
    )
    assert xray_response.status_code == 200
    xray = xray_response.json()
    assert xray["outbounds"][0]["protocol"] == "vless"
    assert xray["outbounds"][0]["streamSettings"]["security"] == "reality"


async def test_public_subscription_manifest_rejects_plaintext_profile_credential(
    route_app: RouteTestApp,
) -> None:
    user, license_record, node = await seed_subscription_dependencies(route_app)
    async with route_app.sessionmaker() as session:
        profile = ProtocolProfile(
            name="legacy-plaintext-profile",
            node_id=node.id,
            adapter="vless-tcp-tls",
            status="active",
            config_json={"security": {"type": "tls", "serverName": "legacy.example.net"}},
            port_reservations=[
                {"address": "0.0.0.0", "port": 18081, "protocol": "tcp"},  # noqa: S104
            ],
            credentials_ref="plain-password-token",
        )
        session.add(profile)
        await session.commit()

    create_response = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {
                "protocol": "vless-tcp-tls",
                "profile_id": str(profile.id),
            },
            "config_hash": "sha256:vless-tls",
        },
    )
    assert create_response.status_code == 201

    public_manifest_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{create_response.json()['public_id']}/manifest",
    )

    assert public_manifest_response.status_code == 422
    assert (
        public_manifest_response.json()["error"]["code"]
        == "subscription_manifest_credentials_ref_invalid"
    )


async def test_public_subscription_manifest_rejects_invalid_profile_port(
    route_app: RouteTestApp,
) -> None:
    user, license_record, node = await seed_subscription_dependencies(route_app)
    async with route_app.sessionmaker() as session:
        profile = ProtocolProfile(
            name="legacy-invalid-port-profile",
            node_id=node.id,
            adapter="vless-tcp-tls",
            status="active",
            config_json={"security": {"type": "tls", "serverName": "legacy.example.net"}},
            port_reservations=[
                {"address": "0.0.0.0", "port": "not-a-port", "protocol": "tcp"},  # noqa: S104
            ],
            credentials_ref="vault://subscriptions/legacy/vless-tls",
        )
        session.add(profile)
        await session.commit()

    create_response = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {
                "protocol": "vless-tcp-tls",
                "profile_id": str(profile.id),
            },
            "config_hash": "sha256:vless-tls",
        },
    )
    assert create_response.status_code == 201

    public_manifest_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{create_response.json()['public_id']}/manifest",
    )

    assert public_manifest_response.status_code == 422
    assert public_manifest_response.json()["error"]["code"] == "subscription_manifest_invalid_value"
    assert public_manifest_response.json()["error"]["details"] == [
        "profile.port_reservations[0].port"
    ]


async def test_public_subscription_manifest_rejects_expired_license(
    route_app: RouteTestApp,
) -> None:
    user, license_record, node = await seed_subscription_dependencies(route_app)
    license_record.expires_at = datetime.now(UTC) - timedelta(days=1)
    async with route_app.sessionmaker() as session:
        await session.merge(license_record)
        await session.commit()

    create_response = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {"protocol": "vless"},
            "config_hash": "sha256:vless",
        },
    )
    assert create_response.status_code == 201

    public_manifest_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{create_response.json()['public_id']}/manifest",
    )

    assert public_manifest_response.status_code == 410
    assert public_manifest_response.json()["error"]["code"] == "subscription_license_expired"


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


async def test_subscription_patch_route_rejects_inline_secret_delivery_field(
    route_app: RouteTestApp,
) -> None:
    user, license_record, node = await seed_subscription_dependencies(route_app)
    create_response = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {"protocol": "vless"},
        },
    )
    assert create_response.status_code == 201

    response = await route_app.client.patch(
        f"/api/v1/subscriptions/{create_response.json()['id']}",
        json={"delivery_profile": {"runtime_config": "plain-json"}},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "inline_secret_rejected"
