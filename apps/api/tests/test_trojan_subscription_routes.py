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


async def test_hysteria2_subscription_renders_client_formats(route_app: RouteTestApp) -> None:
    user, license_record, node = await _seed(route_app)
    create = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {
                "protocol": "hysteria2",
                "adapter": "hysteria2",
                "profile_title": "Lumen HY2",
                "server_name": "hy2.example.test",
                "port": "8443",
            },
            "config_hash": "sha256:hy2",
        },
    )
    assert create.status_code == 201, create.text
    public_id = create.json()["public_id"]

    raw = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=happ",
    )
    assert raw.status_code == 200
    assert raw.text.startswith("hysteria2://")
    assert "sni=hy2.example.test" in raw.text

    sing_box = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=sing-box",
    )
    assert sing_box.status_code == 200
    outbound = sing_box.json()["outbounds"][0]
    assert outbound["type"] == "hysteria2"
    assert outbound["tls"]["server_name"] == "hy2.example.test"

    mihomo = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=mihomo",
    )
    assert mihomo.status_code == 200
    assert 'type: "hysteria2"' in mihomo.text


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

    raw = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=raw-uri",
    )
    assert raw.status_code == 200
    assert "[Interface]" in raw.text
    assert "PrivateKey =" in raw.text
    assert "Address = 10.66.66.2/32" in raw.text
    assert "[Peer]" in raw.text
    assert "PublicKey = aGVsbG93b3JsZGhlbGxvd29ybGRoZWxsb3dvcmxkMDA=" in raw.text
    assert "Endpoint =" in raw.text
    assert "AllowedIPs = 0.0.0.0/0" in raw.text

    happ = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=happ",
    )
    assert happ.status_code == 200
    assert "[Interface]" in happ.text
    assert "PrivateKey =" in happ.text

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


async def test_amneziawg_subscription_preserves_obfuscation_in_native_manifest_and_raw_conf(
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
                "protocol": "wireguard-amneziawg",
                "adapter": "wireguard-amneziawg",
                "profile_title": "Lumen AWG",
                "public_key": "aGVsbG93b3JsZGhlbGxvd29ybGRoZWxsb3dvcmxkMDA=",
                "address": "10.77.0.2/32",
                "allowed_ips": "0.0.0.0/0",
                "port": "51821",
                "Jc": "4",
                "S1": "60",
                "H1": "123456789",
            },
            "config_hash": "sha256:awg",
        },
    )
    assert create.status_code == 201, create.text
    public_id = create.json()["public_id"]

    manifest = await route_app.client.get(f"/api/v1/subscriptions/public/{public_id}/manifest")
    assert manifest.status_code == 200
    hints = manifest.json()["nodes"][0]["protocols"][0]["rendererHints"]
    assert hints["Jc"] == "4"
    assert hints["S1"] == "60"
    assert hints["H1"] == "123456789"

    raw = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=raw-uri",
    )
    assert raw.status_code == 200
    assert "Jc = 4" in raw.text
    assert "S1 = 60" in raw.text
    assert "H1 = 123456789" in raw.text


@pytest.mark.parametrize(
    ("protocol", "adapter", "port", "raw_prefix", "sing_box_type", "xray_protocol", "mihomo_type"),
    [
        ("socks5", "socks5", "1080", "socks5://", "socks", "socks", "socks5"),
        ("http-proxy", "http-proxy", "8080", "http://", "http", "http", "http"),
    ],
)
async def test_proxy_subscriptions_render_client_formats(
    route_app: RouteTestApp,
    protocol: str,
    adapter: str,
    port: str,
    raw_prefix: str,
    sing_box_type: str,
    xray_protocol: str,
    mihomo_type: str,
) -> None:
    user, license_record, node = await _seed(route_app)
    create = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {
                "protocol": protocol,
                "adapter": adapter,
                "profile_title": f"Lumen {protocol}",
                "port": port,
            },
            "config_hash": f"sha256:{protocol}",
        },
    )
    assert create.status_code == 201, create.text
    public_id = create.json()["public_id"]

    raw = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=happ",
    )
    assert raw.status_code == 200, raw.text
    assert raw.text.startswith(raw_prefix)
    assert f":{port}" in raw.text
    assert "%3A" not in raw.text.split("@", maxsplit=1)[0]

    sing_box = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=sing-box",
    )
    assert sing_box.status_code == 200
    outbound = sing_box.json()["outbounds"][0]
    assert outbound["type"] == sing_box_type
    assert outbound["username"] == public_id
    assert outbound["password"]
    if protocol == "socks5":
        assert outbound["version"] == "5"

    xray = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=amnezia",
    )
    assert xray.status_code == 200
    outbound = xray.json()["outbounds"][0]
    assert outbound["protocol"] == xray_protocol
    assert outbound["settings"]["servers"][0]["users"][0]["user"] == public_id
    assert outbound["settings"]["servers"][0]["users"][0]["pass"]

    mihomo = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=mihomo",
    )
    assert mihomo.status_code == 200
    assert f'type: "{mihomo_type}"' in mihomo.text
    assert f'username: "{public_id}"' in mihomo.text


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
