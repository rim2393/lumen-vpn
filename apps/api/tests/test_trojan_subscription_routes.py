import base64
import json
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
        api_key_hash_pepper=None,
        session_hash_pepper=None,
        bootstrap_admin_api_key=None,
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


async def _seed(route_app: RouteTestApp) -> tuple[User, License, Node]:
    async with route_app.sessionmaker() as session:
        user = User(email="trojan-subscriber@example.com", status="active", traffic_used_gb=1.0)
        license_record = License(
            license_key_hash=hash_license_key("trojan-subscription-license"),
            customer_ref="trojan-customer",
            status="active",
            max_devices=3,
            starts_at=datetime.now(UTC) - timedelta(days=1),
            expires_at=datetime.now(UTC) + timedelta(days=30),
            metadata_json={},
        )
        node = Node(
            name="trojan-node",
            region="eu",
            public_address="203.0.113.70",
            status="active",
            capabilities={},
        )
        session.add_all([user, license_record, node])
        await session.commit()
        return user, license_record, node


async def _create_trojan_subscription(route_app: RouteTestApp) -> str:
    user, license_record, node = await _seed(route_app)
    response = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {
                "protocol": "trojan-tcp-tls",
                "adapter": "trojan-tcp-tls",
                "profile_title": "Lumen Trojan",
                "server_name": "trojan.example.test",
                "port": "8443",
            },
            "config_hash": "sha256:trojan",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["public_id"]


async def test_trojan_subscription_renders_all_client_formats(route_app: RouteTestApp) -> None:
    public_id = await _create_trojan_subscription(route_app)

    raw = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=v2ray",
    )
    assert raw.status_code == 200, raw.text
    body = raw.text
    assert body.startswith("trojan://")
    assert "security=tls" in body
    assert "sni=trojan.example.test" in body
    assert "@trojan.example.test:8443" in body or ":8443" in body

    sing_box = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=sing-box",
    )
    assert sing_box.status_code == 200
    assert sing_box.json()["outbounds"][0]["type"] == "trojan"

    xray = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=amnezia",
    )
    assert xray.status_code == 200
    outbound = xray.json()["outbounds"][0]
    assert outbound["protocol"] == "trojan"
    assert outbound["streamSettings"]["security"] == "tls"

    mihomo = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=mihomo",
    )
    assert mihomo.status_code == 200
    assert 'type: "trojan"' in mihomo.text


async def test_shadowsocks_subscription_renders_all_client_formats(
    route_app: RouteTestApp,
) -> None:
    user, license_record, node = await _seed(route_app)
    create = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {
                "protocol": "shadowsocks-native",
                "adapter": "shadowsocks-native",
                "profile_title": "Lumen SS",
                "method": "aes-256-gcm",
                "port": "8388",
            },
            "config_hash": "sha256:ss",
        },
    )
    assert create.status_code == 201, create.text
    public_id = create.json()["public_id"]

    raw = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=v2ray",
    )
    assert raw.status_code == 200, raw.text
    assert raw.text.startswith("ss://")

    sing_box = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=sing-box",
    )
    assert sing_box.status_code == 200
    assert sing_box.json()["outbounds"][0]["type"] == "shadowsocks"

    xray = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=amnezia",
    )
    assert xray.status_code == 200
    assert xray.json()["outbounds"][0]["protocol"] == "shadowsocks"

    mihomo = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=mihomo",
    )
    assert mihomo.status_code == 200
    assert 'type: "ss"' in mihomo.text


async def test_vmess_subscription_renders_all_client_formats(route_app: RouteTestApp) -> None:
    user, license_record, node = await _seed(route_app)
    create = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {
                "protocol": "vmess-ws-tls",
                "adapter": "vmess-ws-tls",
                "profile_title": "Lumen VMess",
                "server_name": "vmess.example.test",
                "port": "443",
            },
            "config_hash": "sha256:vmess",
        },
    )
    assert create.status_code == 201, create.text
    public_id = create.json()["public_id"]

    raw = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=v2ray",
    )
    assert raw.status_code == 200, raw.text
    assert raw.text.startswith("vmess://")
    decoded = json.loads(base64.b64decode(raw.text.removeprefix("vmess://").strip()))
    assert decoded["add"] == "203.0.113.70"
    assert decoded["tls"] == "tls"
    assert decoded["sni"] == "vmess.example.test"

    sing_box = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=sing-box",
    )
    assert sing_box.status_code == 200
    assert sing_box.json()["outbounds"][0]["type"] == "vmess"

    xray = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=amnezia",
    )
    assert xray.status_code == 200
    assert xray.json()["outbounds"][0]["protocol"] == "vmess"

    mihomo = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=mihomo",
    )
    assert mihomo.status_code == 200
    assert 'type: "vmess"' in mihomo.text


async def test_tuic_subscription_renders_client_formats(route_app: RouteTestApp) -> None:
    user, license_record, node = await _seed(route_app)
    create = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {
                "protocol": "tuic-v5",
                "adapter": "tuic-v5",
                "profile_title": "Lumen TUIC",
                "server_name": "tuic.example.test",
                "port": "8443",
            },
            "config_hash": "sha256:tuic",
        },
    )
    assert create.status_code == 201, create.text
    public_id = create.json()["public_id"]

    raw = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=v2ray",
    )
    assert raw.status_code == 200
    assert raw.text.startswith("tuic://")
    assert "sni=tuic.example.test" in raw.text

    sing_box = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=sing-box",
    )
    assert sing_box.status_code == 200
    assert sing_box.json()["outbounds"][0]["type"] == "tuic"

    mihomo = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=mihomo",
    )
    assert mihomo.status_code == 200
    assert 'type: "tuic"' in mihomo.text


async def test_wireguard_subscription_renders_structured_formats(
    route_app: RouteTestApp,
) -> None:
    user, license_record, node = await _seed(route_app)
    create = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {
                "protocol": "wireguard-native",
                "adapter": "wireguard-native",
                "profile_title": "Lumen WG",
                "public_key": "aGVsbG93b3JsZGhlbGxvd29ybGRoZWxsb3dvcmxkMDA=",
                "address": "10.66.66.2/32",
                "allowed_ips": "0.0.0.0/0",
                "port": "51820",
            },
            "config_hash": "sha256:wg",
        },
    )
    assert create.status_code == 201, create.text
    public_id = create.json()["public_id"]

    sing_box = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=sing-box",
    )
    assert sing_box.status_code == 200
    outbound = sing_box.json()["outbounds"][0]
    assert outbound["type"] == "wireguard"
    assert outbound["peer_public_key"] == "aGVsbG93b3JsZGhlbGxvd29ybGRoZWxsb3dvcmxkMDA="
    assert outbound["local_address"] == ["10.66.66.2/32"]
    assert outbound["private_key"]

    mihomo = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=mihomo",
    )
    assert mihomo.status_code == 200
    assert 'type: "wireguard"' in mihomo.text
    assert "public-key:" in mihomo.text

    xray = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=amnezia",
    )
    assert xray.status_code == 200
    assert xray.json()["outbounds"][0]["protocol"] == "wireguard"


async def test_unsupported_protocol_is_still_rejected(route_app: RouteTestApp) -> None:
    user, license_record, node = await _seed(route_app)
    response = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {"protocol": "naiveproxy", "adapter": "naiveproxy"},
            "config_hash": "sha256:naive",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "subscription_protocol_required"
