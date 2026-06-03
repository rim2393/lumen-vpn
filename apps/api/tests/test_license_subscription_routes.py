import base64
import hashlib
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
from app.domains.ip_control.models import IpControlRule
from app.domains.licenses.models import License
from app.domains.licenses.service import hash_license_key
from app.domains.node_plugins.models import NodePlugin
from app.domains.nodes.models import Node
from app.domains.protocols.models import Host, ProtocolProfile, Squad
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
                Permission.USER_MANAGE,
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
        user = User(email="route-subscriber@example.com", status="active", traffic_used_gb=17.82)
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


async def test_license_route_patch_syncs_pending_license(route_app: RouteTestApp) -> None:
    create_response = await route_app.client.post(
        "/api/v1/licenses",
        json={
            "license_key": "route-license-key-to-sync",
            "customer_ref": "pending-customer",
            "metadata_json": {"source": "manual"},
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()

    patch_response = await route_app.client.patch(
        f"/api/v1/licenses/{created['id']}",
        json={
            "status": "active",
            "max_devices": 12,
            "customer_ref": "synced-customer",
            "metadata_json": {"source": "manual", "sync_status": "synced"},
        },
    )

    assert patch_response.status_code == 200
    patched = patch_response.json()
    assert patched["status"] == "active"
    assert patched["max_devices"] == 12
    assert patched["customer_ref"] == "synced-customer"
    assert patched["metadata_json"] == {
        "source": "manual",
        "sync_status": "synced",
    }
    assert "license_key" not in patched
    assert "license_key_hash" not in patched


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
            "delivery_profile": {
                "format": "happ",
                "profile_page_url": "https://profiles.example.test/sub",
                "protocol": "vless",
            },
            "config_hash": "sha256:route-config",
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["public_id"].startswith("lumen_sub_")
    assert created["status"] == "active"
    assert created["config_hash"] == "sha256:route-config"
    assert created["delivery_profile"]["protocol"] == "vless"
    assert created["public_page_url"] == f"/sub/{created['public_id']}"
    assert created["public_manifest_url"] == (
        f"/api/v1/subscriptions/public/{created['public_id']}/manifest"
    )
    assert created["public_render_url"] == (
        f"/api/v1/subscriptions/public/{created['public_id']}/render"
    )
    assert created["public_render_urls"]["happ"] == (
        f"/api/v1/subscriptions/public/{created['public_id']}/render?target=happ"
    )
    assert created["public_render_urls"]["hiddify"] == (
        f"/api/v1/subscriptions/public/{created['public_id']}/render?target=hiddify"
    )
    assert created["render_formats"] == ["happ", "hiddify"]
    assert created["created_at"]
    assert created["updated_at"]

    list_response = await route_app.client.get("/api/v1/subscriptions")
    assert list_response.status_code == 200
    listed = list_response.json()["items"]
    assert [item["id"] for item in listed] == [created["id"]]
    assert listed[0]["public_render_urls"] == created["public_render_urls"]

    get_response = await route_app.client.get(f"/api/v1/subscriptions/{created['id']}")
    assert get_response.status_code == 200
    assert get_response.json()["public_id"] == created["public_id"]
    assert get_response.json()["render_formats"] == ["happ", "hiddify"]


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


async def test_subscription_admin_lookup_clone_devices_and_delete(
    route_app: RouteTestApp,
) -> None:
    user, license_record, node = await seed_subscription_dependencies(route_app)
    async with route_app.sessionmaker() as session:
        user_record = await session.get(User, user.id)
        assert user_record is not None
        user_record.username = "route-user"
        user_record.display_name = "Route Subscriber"
        await session.commit()

    create_response = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {"protocol": "vless", "format": "happ"},
            "config_hash": "sha256:clone-source",
        },
    )
    assert create_response.status_code == 201
    source = create_response.json()

    async with route_app.sessionmaker() as session:
        user_record = await session.get(User, user.id)
        assert user_record is not None
        user_record.metadata_json = {
            "devices": [
                {
                    "id": "phone-1",
                    "hwid": "HWID-1",
                    "label": "Phone",
                    "platform": "android",
                    "status": "active",
                    "subscription_id": source["id"],
                },
                {
                    "id": "other-subscription-device",
                    "subscription_id": "00000000-0000-0000-0000-000000000000",
                },
            ]
        }
        await session.commit()

    lookup_by_public_id = await route_app.client.get(
        "/api/v1/subscriptions/lookup",
        params={"query": source["public_id"][0:18]},
    )
    assert lookup_by_public_id.status_code == 200
    assert [item["id"] for item in lookup_by_public_id.json()["items"]] == [source["id"]]

    lookup_by_user = await route_app.client.get(
        "/api/v1/subscriptions/lookup",
        params={"query": "route-user"},
    )
    assert lookup_by_user.status_code == 200
    assert [item["id"] for item in lookup_by_user.json()["items"]] == [source["id"]]

    lookup_by_short_uuid = await route_app.client.get(
        f"/api/v1/subscriptions/by-short-uuid/{source['id'][0:8]}"
    )
    assert lookup_by_short_uuid.status_code == 200
    assert lookup_by_short_uuid.json()["id"] == source["id"]

    raw_preview_response = await route_app.client.get(
        f"/api/v1/subscriptions/{source['id']}/render",
        params={"target": "raw-uri"},
    )
    assert raw_preview_response.status_code == 200
    assert raw_preview_response.headers["x-lumen-render-target"] == "raw-uri"
    assert raw_preview_response.text.startswith("vless://")
    assert "@203.0.113.50:443" in raw_preview_response.text

    devices_response = await route_app.client.get(f"/api/v1/subscriptions/{source['id']}/devices")
    assert devices_response.status_code == 200
    assert devices_response.json()["items"] == [
        {
            "id": "phone-1",
            "label": "Phone",
            "hwid": "HWID-1",
            "platform": "android",
            "status": "active",
            "last_seen_at": None,
            "metadata_json": {
                "id": "phone-1",
                "hwid": "HWID-1",
                "label": "Phone",
                "platform": "android",
                "status": "active",
                "subscription_id": source["id"],
            },
        }
    ]

    clone_response = await route_app.client.post(f"/api/v1/subscriptions/{source['id']}/clone")
    assert clone_response.status_code == 201
    clone = clone_response.json()
    assert clone["id"] != source["id"]
    assert clone["public_id"] != source["public_id"]
    assert clone["status"] == "active"
    assert clone["delivery_profile"] == source["delivery_profile"]
    assert clone["config_hash"] == "sha256:clone-source"

    delete_response = await route_app.client.delete(f"/api/v1/subscriptions/{clone['id']}")
    assert delete_response.status_code == 204
    get_deleted_response = await route_app.client.get(f"/api/v1/subscriptions/{clone['id']}")
    assert get_deleted_response.status_code == 404

    async with route_app.sessionmaker() as session:
        events = (
            await session.execute(select(AuditEvent).order_by(AuditEvent.created_at.asc()))
        ).scalars().all()

    assert [event.action for event in events] == [
        "subscription.cloned",
        "subscription.deleted",
    ]
    assert events[0].metadata_json == {"source_subscription_id": source["id"]}


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
        session.add(
            NodePlugin(
                node_id=node.id,
                kind="domain-filter",
                name="Block bad domains",
                config_json={"action": "block", "domains": ["domain:bad.example"]},
                enabled=True,
            )
        )
        session.add(
            IpControlRule(
                name="subscriber-ip-cap",
                scope="user",
                target_id=str(user.id),
                max_active_ips=1,
                action="block",
                enabled=True,
            )
        )
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
    node_policy = public_manifest["nodes"][0]["metadata"]["nodePolicy"]
    assert node_policy["plugins"][0]["kind"] == "domain-filter"
    assert node_policy["ipControl"]["maxActiveIps"] == 1
    assert (
        public_manifest["metadata"]["accessPolicy"]["ruleId"]
        == node_policy["ipControl"]["ruleId"]
    )

    async with route_app.sessionmaker() as session:
        audit_result = await session.execute(
            select(AuditEvent).where(
                AuditEvent.action == "subscription.public.rendered",
                AuditEvent.resource_type == "user",
                AuditEvent.resource_id == str(user.id),
            )
        )
        event = audit_result.scalar_one()
        assert event.actor_subject == "public-subscription"
        assert event.metadata_json["public_id"] == create_response.json()["public_id"]
        assert event.metadata_json["target"] == "manifest"


async def test_public_wireguard_subscription_uses_linked_profile_and_host_runtime_fields(
    route_app: RouteTestApp,
) -> None:
    user, license_record, node = await seed_subscription_dependencies(route_app)
    async with route_app.sessionmaker() as session:
        profile = ProtocolProfile(
            name="wireguard-profile",
            node_id=node.id,
            adapter="wireguard-native",
            status="active",
            config_json={
                "interface": {
                    "address": "10.66.0.1/24",
                    "public_key": "aGVsbG93b3JsZGhlbGxvd29ybGRoZWxsb3dvcmxkMDA=",
                    "mtu": 1420,
                    "persistent_keepalive": 25,
                }
            },
            port_reservations=[
                {"address": "0.0.0.0", "port": 51820, "protocol": "udp"},  # noqa: S104
            ],
            credentials_ref="vault://subscriptions/wireguard-profile/client",
        )
        session.add(profile)
        await session.flush()
        host = Host(
            name="wireguard-host",
            hostname="85.192.60.8",
            node_id=node.id,
            protocol_profile_id=profile.id,
            port=51820,
            status="active",
            tags=["wireguard"],
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
                "protocol": "wireguard-native",
                "adapter": "wireguard-native",
                "profile_id": str(profile.id),
                "host_id": str(host.id),
                "profile_title": "Linked WG",
            },
            "config_hash": "sha256:wireguard-linked-profile",
        },
    )
    assert create_response.status_code == 201
    second_response = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {
                "protocol": "wireguard-native",
                "adapter": "wireguard-native",
                "profile_id": str(profile.id),
                "host_id": str(host.id),
                "profile_title": "Linked WG 2",
            },
            "config_hash": "sha256:wireguard-linked-profile-second",
        },
    )
    assert second_response.status_code == 201

    raw_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{create_response.json()['public_id']}/render"
        "?target=raw-uri",
    )
    second_raw_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{second_response.json()['public_id']}/render"
        "?target=raw-uri",
    )

    assert raw_response.status_code == 200
    assert second_raw_response.status_code == 200
    assert "[Interface]" in raw_response.text
    assert "Address = 10.66.0.2/32" in raw_response.text
    assert "Address = 10.66.0.3/32" in second_raw_response.text
    assert "MTU = 1420" in raw_response.text
    assert "PublicKey = aGVsbG93b3JsZGhlbGxvd29ybGRoZWxsb3dvcmxkMDA=" in raw_response.text
    assert "Endpoint = 85.192.60.8:51820" in raw_response.text
    assert "PersistentKeepalive = 25" in raw_response.text


async def test_subscription_manifest_applies_host_visibility_and_client_hints(
    route_app: RouteTestApp,
) -> None:
    user, license_record, node = await seed_subscription_dependencies(route_app)
    async with route_app.sessionmaker() as session:
        profile = ProtocolProfile(
            name="host-policy-profile",
            node_id=node.id,
            adapter="vless-reality-xhttp",
            status="active",
            config_json={
                "security": {
                    "type": "reality",
                    "serverName": "profile-front.example.test",
                    "publicKey": "profile-x25519-key",
                    "shortId": "aabbccdd",
                    "fingerprint": "chrome",
                }
            },
            port_reservations=[
                {"address": "0.0.0.0", "port": 443, "protocol": "tcp"},  # noqa: S104
            ],
            credentials_ref="vault://subscriptions/host-policy/client",
        )
        session.add(profile)
        await session.flush()
        hidden_host = Host(
            name="aa-hidden-host",
            hostname="hidden.example.test",
            hidden=True,
            node_id=node.id,
            protocol_profile_id=profile.id,
            status="active",
        )
        excluded_host = Host(
            name="ab-excluded-host",
            hostname="excluded.example.test",
            node_id=node.id,
            protocol_profile_id=profile.id,
            status="active",
            subscription_excluded=True,
        )
        host_a = Host(
            name="host-a",
            hostname="visible-a.example.test",
            final_mask="masked-a.example.test",
            mihomo_x25519_public_key="mihomo-a-x25519",
            node_id=node.id,
            path="/xhttp-a",
            port=2443,
            protocol_profile_id=profile.id,
            security="reality",
            shuffle_host=True,
            sni="front-a.example.test",
            status="active",
            tags=["visible", "a"],
            xhttp_json={"mode": "packet-up"},
        )
        host_b = Host(
            name="host-b",
            hostname="visible-b.example.test",
            final_mask="masked-b.example.test",
            mihomo_x25519_public_key="mihomo-b-x25519",
            node_id=node.id,
            path="/xhttp-b",
            port=3443,
            protocol_profile_id=profile.id,
            security="reality",
            shuffle_host=True,
            sni="front-b.example.test",
            status="active",
            tags=["visible", "b"],
            xhttp_json={"mode": "stream-up"},
        )
        session.add_all([hidden_host, excluded_host, host_a, host_b])
        await session.commit()
        visible_hosts = [host_a, host_b]

    create_response = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {
                "protocol": "vless-reality-xhttp",
                "adapter": "vless-reality-xhttp",
                "profile_id": str(profile.id),
                "format": "mihomo",
            },
            "config_hash": "sha256:host-policy",
        },
    )
    assert create_response.status_code == 201
    public_id = create_response.json()["public_id"]
    expected_host = visible_hosts[
        int.from_bytes(hashlib.sha256(public_id.encode("utf-8")).digest()[:8], "big")
        % len(visible_hosts)
    ]

    manifest_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/manifest",
    )
    assert manifest_response.status_code == 200
    protocol = manifest_response.json()["nodes"][0]["protocols"][0]
    assert protocol["endpoint"]["host"] == expected_host.final_mask
    assert protocol["endpoint"]["port"] == expected_host.port
    assert protocol["endpoint"]["transport"] == "xhttp"
    assert protocol["security"]["serverName"] == expected_host.sni
    assert protocol["security"]["type"] == "reality"
    assert protocol["path"] == expected_host.path
    assert protocol["mode"] == expected_host.xhttp_json["mode"]
    assert protocol["rendererHints"]["finalMask"] == expected_host.final_mask
    assert protocol["rendererHints"]["mihomoX25519PublicKey"] == (
        expected_host.mihomo_x25519_public_key
    )
    assert "hidden.example.test" not in str(manifest_response.json())
    assert "excluded.example.test" not in str(manifest_response.json())

    mihomo_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=mihomo",
    )
    assert mihomo_response.status_code == 200
    assert f'server: "{expected_host.final_mask}"' in mihomo_response.text
    assert f'sni: "{expected_host.sni}"' in mihomo_response.text
    assert f'public-key: "{expected_host.mihomo_x25519_public_key}"' in mihomo_response.text
    assert expected_host.path in mihomo_response.text
    assert "hidden.example.test" not in mihomo_response.text
    assert "excluded.example.test" not in mihomo_response.text

    explicit_excluded_response = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {
                "protocol": "vless-reality-xhttp",
                "adapter": "vless-reality-xhttp",
                "profile_id": str(profile.id),
                "host_id": str(excluded_host.id),
            },
            "config_hash": "sha256:excluded-host",
        },
    )
    assert explicit_excluded_response.status_code == 201
    blocked_render = await route_app.client.get(
        f"/api/v1/subscriptions/public/{explicit_excluded_response.json()['public_id']}/manifest",
    )
    assert blocked_render.status_code == 422
    assert blocked_render.json()["error"]["code"] == "subscription_host_not_renderable"


async def test_external_squad_subscription_overrides_affect_public_manifest_and_renderers(
    route_app: RouteTestApp,
) -> None:
    user, license_record, node = await seed_subscription_dependencies(route_app)
    async with route_app.sessionmaker() as session:
        squad = Squad(
            name="external-delivery-squad",
            kind="external",
            status="active",
            metadata_json={
                "user_ids": [str(user.id)],
                "subscription_overrides": {
                    "headers": {"X-Lumen-Partner": "partner-a"},
                    "host": {
                        "endpoint_host": "front.partner.example.test",
                        "path": "/partner",
                        "port": "2443",
                        "sni": "sni.partner.example.test",
                    },
                    "hwid": {"limit": "1", "required": True},
                    "remark": "Partner public profile",
                    "subpage": {"title": "Partner page"},
                    "template": "partner-template",
                },
            },
        )
        session.add(squad)
        await session.flush()
        profile = ProtocolProfile(
            name="external-delivery-profile",
            node_id=node.id,
            squad_id=squad.id,
            adapter="vless-tcp-tls",
            status="active",
            config_json={"security": {"type": "tls", "serverName": "origin.example.test"}},
            port_reservations=[
                {"address": "0.0.0.0", "port": 443, "protocol": "tcp"},  # noqa: S104
            ],
            credentials_ref="vault://subscriptions/external-delivery/client",
        )
        session.add(profile)
        await session.flush()
        host = Host(
            name="external-delivery-host",
            hostname="origin.partner.example.test",
            node_id=node.id,
            protocol_profile_id=profile.id,
            squad_id=squad.id,
            status="active",
            port=443,
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
                "format": "hiddify",
            },
            "config_hash": "sha256:external-squad-delivery",
        },
    )
    assert create_response.status_code == 201
    public_id = create_response.json()["public_id"]

    missing_hwid_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/manifest",
    )
    assert missing_hwid_response.status_code == 428
    assert missing_hwid_response.json()["error"]["code"] == "subscription_device_id_required"

    manifest_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/manifest",
        headers={"X-Lumen-HWID": "partner-device-1"},
    )
    assert manifest_response.status_code == 200
    manifest = manifest_response.json()
    protocol = manifest["nodes"][0]["protocols"][0]
    assert protocol["endpoint"]["host"] == "front.partner.example.test"
    assert protocol["endpoint"]["port"] == 2443
    assert protocol["security"]["serverName"] == "sni.partner.example.test"
    assert protocol["path"] == "/partner"
    assert protocol["rendererHints"]["name"] == "Partner public profile"
    assert protocol["rendererHints"]["template"] == "partner-template"
    assert manifest["metadata"]["profileTitle"] == "Partner public profile"
    assert manifest["metadata"]["responseHeaders"] == {"X-Lumen-Partner": "partner-a"}
    assert manifest["metadata"]["hwidPolicy"] == {"limit": 1, "required": True}
    assert manifest["metadata"]["subpage"] == {"title": "Partner page"}
    assert manifest["metadata"]["externalSquad"]["name"] == "external-delivery-squad"

    render_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=hiddify",
        headers={"X-Lumen-HWID": "partner-device-1"},
    )
    assert render_response.status_code == 200
    assert render_response.headers["X-Lumen-Partner"] == "partner-a"
    assert "front.partner.example.test:2443" in render_response.text
    assert "sni=sni.partner.example.test" in render_response.text
    assert "Partner%20public%20profile" in render_response.text

    second_device_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/manifest",
        headers={"X-Lumen-HWID": "partner-device-2"},
    )
    assert second_device_response.status_code == 403
    assert second_device_response.json()["error"]["code"] == "subscription_device_limit_exceeded"


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

    template_response = await route_app.client.post(
        "/api/v1/subscription-templates",
        json={
            "name": "Mihomo production template",
            "format": "mihomo",
            "content_json": {
                "prepend": "# Lumen managed profile\n",
                "append": "# end\n",
                "filename": "lumen-managed.yaml",
                "headers": {"X-Lumen-Template": "mihomo-production"},
            },
        },
    )
    assert template_response.status_code == 201
    template_id = template_response.json()["id"]

    raw_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=hiddify",
    )
    assert raw_response.status_code == 200
    assert raw_response.headers["x-lumen-render-target"] == "hiddify"
    assert raw_response.headers["profile-title"].startswith("base64:")
    assert "download=19134079303" in raw_response.headers["subscription-userinfo"]
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
    assert mihomo_response.headers["x-lumen-template-id"] == template_id
    assert mihomo_response.headers["x-lumen-template"] == "mihomo-production"
    assert "lumen-managed.yaml" in mihomo_response.headers["content-disposition"]
    assert mihomo_response.text.startswith("# Lumen managed profile\n")
    assert mihomo_response.text.endswith("# end\n")
    assert "proxies:" in mihomo_response.text
    assert 'type: "vless"' in mihomo_response.text
    assert "reality-opts:" in mihomo_response.text
    assert 'public-key: "F1E2D3C4B5A69788776655443322110abcdEFGH_-"' in (
        mihomo_response.text
    )

    second_mihomo_template_response = await route_app.client.post(
        "/api/v1/subscription-templates",
        json={
            "name": "Mihomo reordered template",
            "format": "mihomo",
            "content_json": {
                "prepend": "# Reordered Mihomo profile\n",
                "headers": {"X-Lumen-Template": "mihomo-reordered"},
            },
        },
    )
    assert second_mihomo_template_response.status_code == 201
    second_mihomo_template_id = second_mihomo_template_response.json()["id"]
    reorder_response = await route_app.client.post(
        "/api/v1/subscription-templates/actions/reorder",
        json={"ids": [second_mihomo_template_id, template_id]},
    )
    assert reorder_response.status_code == 200
    reordered_mihomo_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=mihomo",
    )
    assert reordered_mihomo_response.status_code == 200
    assert reordered_mihomo_response.headers["x-lumen-template-id"] == second_mihomo_template_id
    assert reordered_mihomo_response.headers["x-lumen-template"] == "mihomo-reordered"
    assert reordered_mihomo_response.text.startswith("# Reordered Mihomo profile\n")

    stash_template_response = await route_app.client.post(
        "/api/v1/subscription-templates",
        json={
            "name": "Stash production template",
            "format": "stash",
            "content_json": {
                "append": "# stash end\n",
                "headers": {"X-Lumen-Stash": "active"},
            },
        },
    )
    assert stash_template_response.status_code == 201
    stash_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=stash",
    )
    assert stash_response.status_code == 200
    assert stash_response.headers["x-lumen-stash"] == "active"
    assert stash_response.text.endswith("# stash end\n")

    clash_template_response = await route_app.client.post(
        "/api/v1/subscription-templates",
        json={
            "name": "Clash production template",
            "format": "clash",
            "content_json": {
                "prepend": "# clash profile\n",
                "headers": {"X-Lumen-Clash": "active"},
            },
        },
    )
    assert clash_template_response.status_code == 201
    clash_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=clash",
    )
    assert clash_response.status_code == 200
    assert clash_response.headers["x-lumen-clash"] == "active"
    assert clash_response.text.startswith("# clash profile\n")

    sing_box_template_response = await route_app.client.post(
        "/api/v1/subscription-templates",
        json={
            "name": "sing-box production template",
            "format": "sing_box",
            "content_json": {
                "merge": {
                    "experimental": {"cache_file": {"enabled": True}},
                    "route": {"auto_detect_interface": False},
                },
                "headers": {"X-Lumen-Template": "sing-box-production"},
            },
        },
    )
    assert sing_box_template_response.status_code == 201
    sing_box_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=sing-box",
    )
    assert sing_box_response.status_code == 200
    assert sing_box_response.headers["x-lumen-template"] == "sing-box-production"
    sing_box = sing_box_response.json()
    assert sing_box["outbounds"][0]["type"] == "vless"
    assert sing_box["outbounds"][0]["tls"]["reality"]["public_key"] == (
        "F1E2D3C4B5A69788776655443322110abcdEFGH_-"
    )
    assert sing_box["experimental"]["cache_file"]["enabled"] is True
    assert sing_box["route"]["auto_detect_interface"] is False

    xray_template_response = await route_app.client.post(
        "/api/v1/subscription-templates",
        json={
            "name": "Xray JSON production template",
            "format": "xray_json",
            "content_json": {
                "prepend": "# invalid for json\n",
                "append": "# invalid for json\n",
                "filename": "lumen-xray-managed.json",
                "headers": {"X-Lumen-Template": "xray-production"},
                "merge": {"routing": {"domainStrategy": "IPIfNonMatch"}},
            },
        },
    )
    assert xray_template_response.status_code == 201
    xray_template_id = xray_template_response.json()["id"]

    xray_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=amnezia",
    )
    assert xray_response.status_code == 200
    assert xray_response.headers["x-lumen-template-id"] == xray_template_id
    assert xray_response.headers["x-lumen-template"] == "xray-production"
    assert "lumen-xray-managed.json" in xray_response.headers["content-disposition"]
    xray = xray_response.json()
    assert xray["outbounds"][0]["protocol"] == "vless"
    assert xray["outbounds"][0]["streamSettings"]["security"] == "reality"
    assert xray["routing"]["domainStrategy"] == "IPIfNonMatch"

    target_contracts = {
        "raw-uri": ("text/plain", "raw"),
        "v2ray": ("text/plain", "raw"),
        "v2ray-base64": ("text/plain", "base64"),
        "v2rayn": ("text/plain", "raw"),
        "v2rayng": ("text/plain", "raw"),
        "streisand": ("text/plain", "raw"),
        "shadowrocket": ("text/plain", "raw"),
        "hiddify": ("text/plain", "raw"),
        "happ": ("text/plain", "raw"),
        "mihomo": ("application/yaml", "mihomo"),
        "clash-meta": ("application/yaml", "mihomo"),
        "clash": ("application/yaml", "mihomo"),
        "flclash": ("application/yaml", "mihomo"),
        "stash": ("application/yaml", "mihomo"),
        "koala-clash": ("application/yaml", "mihomo"),
        "sing-box": ("application/json", "sing-box"),
        "nekobox": ("application/json", "sing-box"),
        "nekoray": ("application/json", "sing-box"),
        "xray-json": ("application/json", "xray"),
        "amnezia": ("application/json", "xray"),
        "lumen-json": ("application/json", "lumen"),
    }
    forbidden_markers = (
        "skeleton",
        "placeholder",
        "credentialsref",
        "privatekey",
        "access_token",
    )
    for target, (content_type, family) in target_contracts.items():
        response = await route_app.client.get(
            f"/api/v1/subscriptions/public/{public_id}/render?target={target}",
        )
        assert response.status_code == 200, target
        assert response.headers["x-lumen-render-target"] == target
        assert response.headers["content-type"].startswith(content_type)
        assert response.headers["profile-title"].startswith("base64:")
        assert "subscription-userinfo" in response.headers
        body = response.text
        markers = forbidden_markers
        if family == "lumen":
            markers = ("skeleton",)
        assert not any(marker in body.lower() for marker in markers), target

        if family == "raw":
            assert body.startswith("vless://"), target
            assert "security=reality" in body
            assert "pbk=F1E2D3C4B5A69788776655443322110abcdEFGH_-" in body
        elif family == "base64":
            decoded = base64.b64decode(body.strip()).decode("utf-8")
            assert decoded.startswith("vless://")
            assert "security=reality" in decoded
        elif family == "mihomo":
            assert "proxies:" in body
            assert "proxy-groups:" in body
            assert 'type: "vless"' in body
            assert "reality-opts:" in body
        elif family == "sing-box":
            parsed = response.json()
            assert parsed["outbounds"][0]["type"] == "vless"
            assert parsed["outbounds"][0]["tls"]["reality"]["public_key"] == (
                "F1E2D3C4B5A69788776655443322110abcdEFGH_-"
            )
        elif family == "xray":
            parsed = response.json()
            assert parsed["outbounds"][0]["protocol"] == "vless"
            assert parsed["outbounds"][0]["streamSettings"]["security"] == "reality"
        else:
            parsed = response.json()
            assert parsed["schemaVersion"] == "lumen.subscription-manifest.v1"
            assert parsed["nodes"][0]["protocols"][0]["adapter"] == "vless-reality"


async def test_subscription_delivery_setting_feeds_manifest_and_renderer_headers(
    route_app: RouteTestApp,
) -> None:
    user, license_record, node = await seed_subscription_dependencies(route_app)
    setting_response = await route_app.client.put(
        "/api/v1/settings/groups/subscription.delivery",
        json={
            "value_json": {
                "base_json": {"dns": {"strategy": "prefer_ipv4"}},
                "custom_remarks": {"happ": "Lumen HApp"},
                "happ_announce": "Production announce",
                "title": "Lumen Production",
                "support_url": "https://support.example.test",
                "update_interval_hours": 6,
                "profile_page_url": "https://sub.example.test",
                "random_host_order": True,
                "response_headers": {"X-Lumen-Delivery": "typed"},
                "routing": {"rules": [{"domain_suffix": "example.test", "outbound": "proxy"}]},
                "subpage": {"title": "Public profile page"},
            },
        },
    )
    assert setting_response.status_code == 200
    subpage_config_response = await route_app.client.post(
        "/api/v1/subscription-page-configs",
        json={
            "name": "Customer page config",
            "config_json": {
                "title": "Configured customer page",
                "theme": "lumen-dark",
                "cards": ["qr", "apps"],
            },
        },
    )
    assert subpage_config_response.status_code == 201

    create_response = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {
                "protocol": "vless-tcp-tls",
                "adapter": "vless-tcp-tls",
                "server_name": "subscription.example.test",
                "subpage_config_id": subpage_config_response.json()["id"],
            },
            "config_hash": "sha256:subscription-info",
        },
    )
    assert create_response.status_code == 201
    public_id = create_response.json()["public_id"]

    manifest_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/manifest",
    )
    assert manifest_response.status_code == 200
    manifest = manifest_response.json()
    assert manifest["provider"]["name"] == "Lumen Production"
    assert manifest["nodes"][0]["protocols"][0]["rendererHints"]["name"] == "Lumen Production"
    assert manifest["metadata"]["profileTitle"] == "Lumen Production"
    assert manifest["metadata"]["supportUrl"] == "https://support.example.test/"
    assert manifest["metadata"]["profilePageUrl"] == "https://sub.example.test/"
    assert manifest["metadata"]["updateIntervalHours"] == "6"
    assert manifest["metadata"]["baseJson"] == {"dns": {"strategy": "prefer_ipv4"}}
    assert manifest["metadata"]["customRemarks"] == {"happ": "Lumen HApp"}
    assert manifest["metadata"]["happAnnounce"] == "Production announce"
    assert manifest["metadata"]["randomHostOrder"] is True
    assert manifest["metadata"]["responseHeaders"] == {"X-Lumen-Delivery": "typed"}
    assert manifest["metadata"]["routing"] == {
        "rules": [{"domain_suffix": "example.test", "outbound": "proxy"}]
    }
    assert manifest["metadata"]["subpage"] == {
        "cards": ["qr", "apps"],
        "configId": subpage_config_response.json()["id"],
        "configName": "Customer page config",
        "theme": "lumen-dark",
        "title": "Configured customer page",
    }

    render_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=hiddify",
    )
    assert render_response.status_code == 200
    encoded_title = render_response.headers["profile-title"].removeprefix("base64:")
    assert base64.b64decode(encoded_title).decode("utf-8") == "Lumen Production"
    assert render_response.headers["profile-update-interval"] == "6"
    assert render_response.headers["x-lumen-delivery"] == "typed"

    override_response = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {
                "protocol": "vless-tcp-tls",
                "adapter": "vless-tcp-tls",
                "profile_title": "Customer Override",
                "support_url": "https://override.example.test",
                "update_interval_hours": "1",
            },
            "config_hash": "sha256:subscription-override",
        },
    )
    assert override_response.status_code == 201
    override_manifest_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{override_response.json()['public_id']}/manifest",
    )
    assert override_manifest_response.status_code == 200
    override_manifest = override_manifest_response.json()
    assert override_manifest["metadata"]["profileTitle"] == "Customer Override"
    assert override_manifest["metadata"]["supportUrl"] == "https://override.example.test"
    assert override_manifest["metadata"]["updateIntervalHours"] == "1"


async def test_public_subscription_response_rules_apply_to_blocked_subscriptions(
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
                "protocol": "vless-tcp-tls",
                "adapter": "vless-tcp-tls",
                "profile_title": "Blocked User",
                "server_name": "blocked.example.test",
            },
            "config_hash": "sha256:blocked",
        },
    )
    assert create_response.status_code == 201
    subscription = create_response.json()

    rule_response = await route_app.client.post(
        "/api/v1/response-rules",
        json={
            "name": "Disabled subscription message",
            "trigger_status": "disabled",
            "status_code": 451,
            "body": "Subscription disabled by policy",
            "headers": {
                "X-Lumen-Rule": "disabled",
                "Set-Cookie": "must-not-pass=1",
                "Cache-Control": "public",
            },
        },
    )
    assert rule_response.status_code == 201
    rule_id = rule_response.json()["id"]

    patch_response = await route_app.client.patch(
        f"/api/v1/subscriptions/{subscription['id']}",
        json={"status": "disabled"},
    )
    assert patch_response.status_code == 200

    public_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{subscription['public_id']}/render?target=happ",
    )
    assert public_response.status_code == 451
    assert public_response.text == "Subscription disabled by policy"
    assert public_response.headers["x-lumen-rule"] == "disabled"
    assert public_response.headers["x-lumen-response-rule-id"] == rule_id
    assert public_response.headers["cache-control"] == "no-store"
    assert "set-cookie" not in public_response.headers

    public_manifest_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{subscription['public_id']}/manifest",
    )
    assert public_manifest_response.status_code == 451
    assert public_manifest_response.text == "Subscription disabled by policy"


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


async def test_public_subscription_enforces_user_device_limit_and_registers_hwid(
    route_app: RouteTestApp,
) -> None:
    user, license_record, node = await seed_subscription_dependencies(route_app)
    user.device_limit = 1
    async with route_app.sessionmaker() as session:
        await session.merge(user)
        await session.commit()

    create_response = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {"protocol": "vless"},
            "config_hash": "sha256:vless-device",
        },
    )
    assert create_response.status_code == 201
    public_id = create_response.json()["public_id"]

    missing_device_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/manifest",
    )
    assert missing_device_response.status_code == 428
    assert missing_device_response.json()["error"]["code"] == "subscription_device_id_required"

    first_device_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/manifest?device_id=device-1",
        headers={"User-Agent": "Lumen QA Device"},
    )
    assert first_device_response.status_code == 200

    repeated_device_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=sing-box",
        headers={"X-Lumen-HWID": "device-1"},
    )
    assert repeated_device_response.status_code == 200

    over_limit_response = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/manifest?device_id=device-2",
    )
    assert over_limit_response.status_code == 403
    assert over_limit_response.json()["error"]["code"] == "subscription_device_limit_exceeded"

    async with route_app.sessionmaker() as session:
        persisted_user = await session.get(User, user.id)
        devices = persisted_user.metadata_json["devices"]
    assert len(devices) == 1
    assert devices[0]["id"] == "device-1"
    assert devices[0]["hwid"] == "device-1"
    assert devices[0]["status"] == "active"
    assert devices[0]["last_seen_at"]


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
