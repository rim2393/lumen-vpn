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
from app.domains.protocols.models import Host, ProtocolProfile
from app.domains.subscriptions.schemas import SubscriptionIssueFromProfileRequest
from app.domains.subscriptions.service import issue_subscription_from_profile
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


async def test_lumen_json_uses_profile_flow_for_profile_backed_vless(
    route_app: RouteTestApp,
) -> None:
    user, license_record, node = await _seed(route_app)
    async with route_app.sessionmaker() as session:
        profile = ProtocolProfile(
            name="profile-backed-vless-reality",
            node_id=node.id,
            adapter="vless-reality",
            status="active",
            credentials_ref="vault://nodes/test/vless-reality",
            config_json={
                "port": "18451",
                "network": "tcp",
                "flow": "xtls-rprx-vision",
                "security": {
                    "type": "reality",
                    "serverName": "www.microsoft.com",
                    "fingerprint": "chrome",
                    "publicKey": "reality-public",
                    "shortId": "abcd",
                    "spiderX": "/",
                },
            },
            port_reservations=[],
            metadata_json={},
        )
        session.add(profile)
        await session.flush()
        host = Host(
            name="profile-backed-vless-host",
            hostname="node.85-192-60-8.sslip.io",
            node_id=node.id,
            protocol_profile_id=profile.id,
            status="active",
            tags=[],
            metadata_json={},
        )
        session.add(host)
        await session.commit()

    async with route_app.sessionmaker() as session:
        subscription = await issue_subscription_from_profile(
            session,
            request=SubscriptionIssueFromProfileRequest(
                user_id=user.id,
                license_id=license_record.id,
                profile_id=profile.id,
                host_id=host.id,
                profile_title="Profile backed VLESS",
                render_targets=["lumen-json"],
                config_hash="sha256:profile-backed-vless",
            ),
        )
        await session.commit()

    native = await route_app.client.get(
        f"/api/v1/subscriptions/public/{subscription.public_id}/render?target=lumen-json",
    )
    assert native.status_code == 200, native.text
    protocol = native.json()["nodes"][0]["protocols"][0]
    assert protocol["adapter"] == "vless-reality"
    assert protocol["flow"] == "xtls-rprx-vision"


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


async def test_shadowsocks_v2ray_plugin_subscription_renders_plugin_fields(
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
                "protocol": "shadowsocks-v2ray-plugin",
                "adapter": "shadowsocks-v2ray-plugin",
                "profile_title": "Lumen SS Plugin",
                "method": "aes-256-gcm",
                "port": "8390",
                "plugin": "v2ray-plugin",
                "plugin_opts": "path=/ss;host=cdn.example.test",
            },
            "config_hash": "sha256:ss-plugin",
        },
    )
    assert create.status_code == 201, create.text
    public_id = create.json()["public_id"]

    raw = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=happ",
    )
    assert raw.status_code == 200, raw.text
    assert raw.text.startswith("ss://")
    assert "plugin=v2ray-plugin" in raw.text

    manifest = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/manifest",
    )
    hints = manifest.json()["nodes"][0]["protocols"][0]["rendererHints"]
    assert hints["plugin"] == "v2ray-plugin"
    assert hints["pluginOpts"] == "path=/ss;host=cdn.example.test"

    sing_box = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=sing-box",
    )
    assert sing_box.status_code == 200
    outbound = sing_box.json()["outbounds"][0]
    assert outbound["type"] == "shadowsocks"
    assert outbound["plugin"] == "v2ray-plugin"
    assert outbound["plugin_opts"] == "path=/ss;host=cdn.example.test"

    mihomo = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=mihomo",
    )
    assert mihomo.status_code == 200
    assert 'plugin: "v2ray-plugin"' in mihomo.text
    assert 'plugin-opts: "path=/ss;host=cdn.example.test"' in mihomo.text


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
                "path": "/lumen-ws",
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
    assert decoded["net"] == "ws"
    assert decoded["path"] == "/lumen-ws"
    assert decoded["tls"] == "tls"
    assert decoded["sni"] == "vmess.example.test"

    sing_box = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=sing-box",
    )
    assert sing_box.status_code == 200
    outbound = sing_box.json()["outbounds"][0]
    assert outbound["type"] == "vmess"
    assert outbound["transport"] == {"type": "ws", "path": "/lumen-ws"}

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


async def test_xhttp_subscription_does_not_emit_fake_sing_box_transport(
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
                "protocol": "vless-xhttp-tls",
                "adapter": "vless-xhttp-tls",
                "profile_title": "Lumen XHTTP",
                "server_name": "xhttp.example.test",
                "path": "/xhttp",
                "mode": "auto",
                "port": "443",
            },
            "config_hash": "sha256:xhttp",
        },
    )
    assert create.status_code == 201, create.text
    public_id = create.json()["public_id"]

    sing_box = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=sing-box",
    )
    assert sing_box.status_code == 422
    assert "xhttp" in sing_box.text.lower()

    xray = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=xray-json",
    )
    assert xray.status_code == 200
    stream = xray.json()["outbounds"][0]["streamSettings"]
    assert stream["network"] == "xhttp"
    assert stream["xhttpSettings"] == {"path": "/xhttp", "mode": "auto"}


@pytest.mark.parametrize(
    ("adapter", "expected_protocol", "expected_network", "delivery_extra", "settings_key"),
    [
        ("vless-ws-tls", "vless", "ws", {"path": "/vless-ws"}, "wsSettings"),
        ("vless-grpc-tls", "vless", "grpc", {"serviceName": "vlessGrpc"}, "grpcSettings"),
        (
            "vless-httpupgrade-tls",
            "vless",
            "httpupgrade",
            {"path": "/vless-hu"},
            "httpupgradeSettings",
        ),
        (
            "vless-xhttp-tls",
            "vless",
            "xhttp",
            {"path": "/vless-xhttp", "mode": "stream-up"},
            "xhttpSettings",
        ),
        (
            "vless-reality-grpc",
            "vless",
            "grpc",
            {"serviceName": "realityGrpc", "public_key": "reality-public", "short_id": "abcd"},
            "grpcSettings",
        ),
        (
            "vless-reality-httpupgrade",
            "vless",
            "httpupgrade",
            {"path": "/reality-hu", "public_key": "reality-public", "short_id": "abcd"},
            "httpupgradeSettings",
        ),
        (
            "vless-reality-xhttp",
            "vless",
            "xhttp",
            {
                "path": "/reality-xhttp",
                "mode": "packet-up",
                "public_key": "reality-public",
                "short_id": "abcd",
            },
            "xhttpSettings",
        ),
        ("vmess-ws-tls", "vmess", "ws", {"path": "/vmess-ws"}, "wsSettings"),
        ("vmess-grpc-tls", "vmess", "grpc", {"serviceName": "vmessGrpc"}, "grpcSettings"),
        (
            "vmess-httpupgrade-tls",
            "vmess",
            "httpupgrade",
            {"path": "/vmess-hu"},
            "httpupgradeSettings",
        ),
        ("trojan-ws-tls", "trojan", "ws", {"path": "/trojan-ws"}, "wsSettings"),
        ("trojan-grpc-tls", "trojan", "grpc", {"serviceName": "trojanGrpc"}, "grpcSettings"),
        (
            "trojan-httpupgrade-tls",
            "trojan",
            "httpupgrade",
            {"path": "/trojan-hu"},
            "httpupgradeSettings",
        ),
        (
            "trojan-xhttp-tls",
            "trojan",
            "xhttp",
            {"path": "/trojan-xhttp", "mode": "stream-up"},
            "xhttpSettings",
        ),
        (
            "trojan-tcp-reality",
            "trojan",
            "tcp",
            {"public_key": "trojan-reality-public", "short_id": "abcd"},
            None,
        ),
    ],
)
async def test_xray_edge_subscription_render_matrix(
    route_app: RouteTestApp,
    adapter: str,
    expected_protocol: str,
    expected_network: str,
    delivery_extra: dict[str, str],
    settings_key: str | None,
) -> None:
    user, license_record, node = await _seed(route_app)
    delivery_profile = {
        "protocol": adapter,
        "adapter": adapter,
        "profile_title": f"Lumen {adapter}",
        "server_name": f"{adapter}.example.test",
        "port": "443",
        **delivery_extra,
    }
    create = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": delivery_profile,
            "config_hash": f"sha256:{adapter}",
        },
    )
    assert create.status_code == 201, create.text
    public_id = create.json()["public_id"]

    raw = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=happ",
    )
    assert raw.status_code == 200, raw.text
    if expected_protocol == "vmess":
        decoded = json.loads(base64.b64decode(raw.text.removeprefix("vmess://").strip()))
        assert decoded["net"] == expected_network
    else:
        assert raw.text.startswith(f"{expected_protocol}://")
        assert f"type={expected_network}" in raw.text

    xray = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=xray-json",
    )
    assert xray.status_code == 200, xray.text
    outbound = xray.json()["outbounds"][0]
    assert outbound["protocol"] == expected_protocol
    stream = outbound["streamSettings"]
    assert stream["network"] == expected_network
    if settings_key is not None:
        assert settings_key in stream
    if "reality" in adapter:
        assert stream["security"] == "reality"
        assert stream["realitySettings"]["publicKey"] in {
            "reality-public",
            "trojan-reality-public",
        }
    elif expected_protocol in {"vless", "vmess", "trojan"} and "tls" in adapter:
        assert stream["security"] == "tls"

    mihomo = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=mihomo",
    )
    assert mihomo.status_code == 200, mihomo.text
    if expected_network in {"ws", "httpupgrade"}:
        assert "ws-opts:" in mihomo.text
    if expected_network == "grpc":
        assert "grpc-opts:" in mihomo.text
    if expected_network == "xhttp":
        assert "xhttp-opts:" in mihomo.text

    sing_box = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=sing-box",
    )
    if expected_network == "xhttp":
        assert sing_box.status_code == 422, sing_box.text
        assert (
            sing_box.json()["error"]["code"]
            == "subscription_render_target_unsupported_for_protocol"
        )
        assert sing_box.json()["error"]["details"] == ["sing-box", adapter]
    else:
        assert sing_box.status_code == 200, sing_box.text
        sing_box_outbounds = [
            outbound
            for outbound in sing_box.json()["outbounds"]
            if outbound.get("type") != "selector"
        ]
        assert sing_box_outbounds[0]["type"] == expected_protocol
        if expected_network != "tcp":
            assert sing_box_outbounds[0]["transport"]["type"] == expected_network


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


async def test_hysteria2_obfs_subscription_renders_client_formats(
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
                "protocol": "hysteria2-obfs",
                "adapter": "hysteria2-obfs",
                "profile_title": "Lumen HY2 Obfs",
                "server_name": "hy2.example.test",
                "obfs": "salamander",
                "port": "8444",
            },
            "config_hash": "sha256:hy2-obfs",
        },
    )
    assert create.status_code == 201, create.text
    public_id = create.json()["public_id"]

    raw = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=happ",
    )
    assert raw.status_code == 200
    assert raw.text.startswith("hysteria2://")
    assert "obfs=salamander" in raw.text
    assert "obfs-password=" in raw.text

    sing_box = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=sing-box",
    )
    assert sing_box.status_code == 200
    outbound = sing_box.json()["outbounds"][0]
    assert outbound["type"] == "hysteria2"
    assert outbound["obfs"]["type"] == "salamander"
    assert outbound["obfs"]["password"]

    mihomo = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=mihomo",
    )
    assert mihomo.status_code == 200
    assert "obfs:" in mihomo.text
    assert "salamander" in mihomo.text
    assert "obfs-password:" in mihomo.text


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
                "Jmin": "40",
                "Jmax": "70",
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
    assert hints["Jmin"] == "40"
    assert hints["Jmax"] == "70"
    assert hints["S1"] == "60"
    assert hints["H1"] == "123456789"

    raw = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=raw-uri",
    )
    assert raw.status_code == 200
    assert "Jc = 4" in raw.text
    assert "Jmin = 40" in raw.text
    assert "Jmax = 70" in raw.text
    assert "S1 = 60" in raw.text
    assert "H1 = 123456789" in raw.text


async def test_amneziawg_subscription_omits_nonpositive_integer_obfuscation_values(
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
                "Jmin": "0",
                "Jmax": "-1",
                "S1": "60",
            },
            "config_hash": "sha256:awg-nonpositive",
        },
    )
    assert create.status_code == 201, create.text
    public_id = create.json()["public_id"]

    manifest = await route_app.client.get(f"/api/v1/subscriptions/public/{public_id}/manifest")
    assert manifest.status_code == 200
    hints = manifest.json()["nodes"][0]["protocols"][0]["rendererHints"]
    assert hints["S1"] == "60"
    assert "Jc" not in hints
    assert "Jmin" not in hints
    assert "Jmax" not in hints

    raw = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=raw-uri",
    )
    assert raw.status_code == 200
    assert "S1 = 60" in raw.text
    assert "Jc =" not in raw.text
    assert "Jmin =" not in raw.text
    assert "Jmax =" not in raw.text


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


async def test_naiveproxy_subscription_renders_supported_clients(route_app: RouteTestApp) -> None:
    user, license_record, node = await _seed(route_app)
    response = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {
                "protocol": "naiveproxy",
                "adapter": "naiveproxy",
                "profile_title": "Lumen Naive",
                "server_name": "naive.example.test",
                "port": "8443",
            },
            "config_hash": "sha256:naive",
        },
    )
    assert response.status_code == 201, response.text
    public_id = response.json()["public_id"]

    raw = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=happ",
    )
    assert raw.status_code == 200, raw.text
    assert raw.text.startswith("https://")
    assert f"{public_id}:" in raw.text
    assert ":8443" in raw.text

    sing_box = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=sing-box",
    )
    assert sing_box.status_code == 200
    outbound = sing_box.json()["outbounds"][0]
    assert outbound["type"] == "naive"
    assert outbound["username"] == public_id
    assert outbound["password"]
    assert outbound["tls"]["server_name"] == "naive.example.test"

    mihomo = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=mihomo",
    )
    assert mihomo.status_code == 200
    assert 'type: "naive"' in mihomo.text
    assert f'username: "{public_id}"' in mihomo.text

    xray = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=amnezia",
    )
    assert xray.status_code == 422
    assert xray.json()["error"]["code"] == "subscription_render_target_unsupported_for_protocol"


async def test_openvpn_subscription_renders_ovpn_from_real_profile_pki(
    route_app: RouteTestApp,
) -> None:
    user, license_record, node = await _seed(route_app)
    async with route_app.sessionmaker() as session:
        profile = ProtocolProfile(
            name="OpenVPN UDP",
            node_id=node.id,
            adapter="openvpn-udp",
            status="active",
            config_json={"network": "10.88.0.0/24"},
            port_reservations=[
                {
                    "address": "0.0.0.0",  # noqa: S104
                    "port": 1194,
                    "protocol": "udp",
                    "exclusive": True,
                }
            ],
            credentials_ref="vault://subscriptions/openvpn/creds",
            metadata_json={
                "openvpn_pki": {
                    "ca_cert": "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----",
                    "server_cert": "-----BEGIN CERTIFICATE-----\nserver\n-----END CERTIFICATE-----",
                    "server_key": "-----BEGIN PRIVATE KEY-----\nserver\n-----END PRIVATE KEY-----",
                }
            },
        )
        session.add(profile)
        await session.commit()

    response = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {
                "profile_id": str(profile.id),
                "protocol": "openvpn",
                "adapter": "openvpn-udp",
                "profile_title": "Lumen OpenVPN",
                "port": "1194",
            },
            "config_hash": "sha256:openvpn",
        },
    )
    assert response.status_code == 201, response.text
    public_id = response.json()["public_id"]

    raw = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=happ",
    )
    assert raw.status_code == 200, raw.text
    assert raw.text.startswith("client\n")
    assert "proto udp" in raw.text
    assert "remote 203.0.113.70 1194" in raw.text
    assert "<ca>\n-----BEGIN CERTIFICATE-----" in raw.text
    assert f"<auth-user-pass>\n{public_id}\n" in raw.text


async def test_ikev2_subscription_renders_strongswan_android_profile(
    route_app: RouteTestApp,
) -> None:
    user, license_record, node = await _seed(route_app)
    ca_cert = "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----"
    async with route_app.sessionmaker() as session:
        profile = ProtocolProfile(
            name="IKEv2 EAP",
            node_id=node.id,
            adapter="ikev2-eap",
            status="active",
            config_json={"server_id": "vpn.example.test", "pool": "10.92.0.0/24"},
            port_reservations=[
                {
                    "address": "0.0.0.0",  # noqa: S104
                    "port": 500,
                    "protocol": "udp",
                    "exclusive": True,
                }
            ],
            credentials_ref="vault://subscriptions/ikev2/creds",
            metadata_json={
                "ikev2_pki": {
                    "ca_cert": ca_cert,
                    "server_cert": "-----BEGIN CERTIFICATE-----\nserver\n-----END CERTIFICATE-----",
                    "server_key": "-----BEGIN PRIVATE KEY-----\nserver\n-----END PRIVATE KEY-----",
                }
            },
        )
        session.add(profile)
        await session.commit()

    response = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {
                "profile_id": str(profile.id),
                "protocol": "ikev2",
                "adapter": "ikev2-eap",
                "profile_title": "Lumen IKEv2",
                "port": "500",
            },
            "config_hash": "sha256:ikev2",
        },
    )
    assert response.status_code == 201, response.text
    public_id = response.json()["public_id"]

    raw = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=raw-uri",
    )
    assert raw.status_code == 200, raw.text
    payload = json.loads(raw.text)
    assert payload["type"] == "ikev2-eap"
    assert payload["remote"]["addr"] == "203.0.113.70"
    assert payload["remote"]["port"] == 500
    assert payload["remote"]["id"] == "vpn.example.test"
    assert base64.b64decode(payload["remote"]["cert"]).decode("utf-8") == ca_cert
    assert payload["local"]["eap_id"] == public_id
    assert payload["local"]["shared_secret"]

    sing_box = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=sing-box",
    )
    assert sing_box.status_code == 422
    assert sing_box.json()["error"]["code"] == "subscription_render_target_unsupported_for_protocol"


async def test_openvpn_shadowsocks_subscription_renders_bridge_ovpn_and_blocks_wrong_targets(
    route_app: RouteTestApp,
) -> None:
    user, license_record, node = await _seed(route_app)
    async with route_app.sessionmaker() as session:
        profile = ProtocolProfile(
            name="OpenVPN Shadowsocks",
            node_id=node.id,
            adapter="openvpn-shadowsocks",
            status="active",
            config_json={
                "network": "10.89.0.0/24",
                "method": "aes-256-gcm",
                "openvpn": {"listen_port": 24194},
                "shadowsocks": {
                    "password": "profile-bridge-password",
                },
            },
            port_reservations=[
                {
                    "address": "0.0.0.0",  # noqa: S104
                    "port": 28443,
                    "protocol": "tcp",
                    "exclusive": True,
                }
            ],
            credentials_ref="vault://subscriptions/openvpn-ss/creds",
            metadata_json={
                "openvpn_pki": {
                    "ca_cert": "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----",
                    "server_cert": "-----BEGIN CERTIFICATE-----\nserver\n-----END CERTIFICATE-----",
                    "server_key": "-----BEGIN PRIVATE KEY-----\nserver\n-----END PRIVATE KEY-----",
                }
            },
        )
        session.add(profile)
        await session.commit()

    response = await route_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": str(user.id),
            "license_id": str(license_record.id),
            "node_id": str(node.id),
            "delivery_profile": {
                "profile_id": str(profile.id),
                "protocol": "openvpn-shadowsocks",
                "adapter": "openvpn-shadowsocks",
                "profile_title": "Lumen OpenVPN over SS",
                "port": "28443",
            },
            "config_hash": "sha256:openvpn-shadowsocks",
        },
    )
    assert response.status_code == 201, response.text
    public_id = response.json()["public_id"]

    raw = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=happ",
    )
    assert raw.status_code == 200, raw.text
    assert "proto tcp" in raw.text
    assert "remote 127.0.0.1 24194" in raw.text
    assert "socks-proxy 127.0.0.1 1080" in raw.text
    assert "Shadowsocks server: 203.0.113.70:28443" in raw.text
    assert f"<auth-user-pass>\n{public_id}\n" in raw.text

    native = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=lumen-json",
    )
    assert native.status_code == 200, native.text
    protocol = native.json()["nodes"][0]["protocols"][0]
    assert protocol["adapter"] == "openvpn-shadowsocks"
    assert protocol["endpoint"]["transport"] == "tcp"
    assert protocol["credentials"]["shadowsocksPassword"] == "profile-bridge-password"
    assert protocol["rendererHints"]["method"] == "aes-256-gcm"

    sing_box = await route_app.client.get(
        f"/api/v1/subscriptions/public/{public_id}/render?target=sing-box",
    )
    assert sing_box.status_code == 422
    assert sing_box.json()["error"]["code"] == "subscription_render_target_unsupported_for_protocol"
