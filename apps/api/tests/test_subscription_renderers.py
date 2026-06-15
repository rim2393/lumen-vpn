import json
import base64
from types import SimpleNamespace

from pydantic import SecretStr

from app.core.config import Settings
from app.domains.subscriptions.service import _manifest_renderer_hints
from app.domains.subscriptions.renderers import render_subscription_for_target

TEST_CA_CERT = "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----"


def _settings() -> Settings:
    return Settings(api_key_hash_pepper=SecretStr("renderer-test-pepper"))


def _manifest(protocols: list[dict[str, object]]) -> dict[str, object]:
    return {
        "subscription": {"id": "renderer-user"},
        "metadata": {},
        "nodes": [
            {
                "id": "node-1",
                "displayName": "Node One",
                "protocols": protocols,
            }
        ],
    }


def _vmess_profile_names(body: str) -> list[str]:
    names: list[str] = []
    for line in body.splitlines():
        if not line.startswith("vmess://"):
            continue
        payload = line.removeprefix("vmess://")
        names.append(json.loads(base64.b64decode(payload))["ps"])
    return names


def _profile_title(rendered) -> str:
    return base64.b64decode(rendered.headers["profile-title"].removeprefix("base64:")).decode()


def _base64_header(rendered, key: str) -> str:
    return base64.b64decode(rendered.headers[key].removeprefix("base64:")).decode()


def test_shadowsocks_2022_manifest_hints_use_2022_method() -> None:
    hints = _manifest_renderer_hints(
        delivery={},
        host=None,
        profile=SimpleNamespace(
            adapter="shadowsocks-2022",
            config_json={},
            metadata_json={},
        ),
        profile_title="SS 2022",
    )

    assert hints["method"] == "2022-blake3-aes-128-gcm"


def test_xray_renderer_forces_shadowsocks_2022_method_from_adapter() -> None:
    rendered = render_subscription_for_target(
        _manifest(
            [
                {
                    "id": "ss2022",
                    "type": "shadowsocks-2022",
                    "adapter": "shadowsocks-2022",
                    "endpoint": {"host": "ss.example.test", "port": 18493, "transport": "tcp"},
                    "credentialsRef": "vault://subscriptions/ss2022",
                    "rendererHints": {},
                }
            ]
        ),
        settings=_settings(),
        target="xray-json",
    )

    server = json.loads(rendered.body)["outbounds"][0]["settings"]["servers"][0]
    assert server["method"] == "2022-blake3-aes-128-gcm"


def test_happ_raw_uri_filters_to_happ_supported_protocols() -> None:
    manifest = _manifest(
        [
            {
                "id": "http-1",
                "type": "http",
                "endpoint": {"host": "proxy.example.test", "port": 8080, "transport": "tcp"},
                "credentialsRef": "vault://subscriptions/http",
            },
            {
                "id": "tuic-1",
                "type": "tuic",
                "endpoint": {"host": "tuic.example.test", "port": 443, "transport": "udp"},
                "credentialsRef": "vault://subscriptions/tuic",
            },
            {
                "id": "vless-1",
                "type": "vless",
                "endpoint": {"host": "vless.example.test", "port": 443, "transport": "tcp"},
                "credentialsRef": "vault://subscriptions/vless",
            },
            {
                "id": "hysteria2-1",
                "type": "hysteria2",
                "endpoint": {"host": "hy2.example.test", "port": 443, "transport": "udp"},
                "credentialsRef": "vault://subscriptions/hysteria2",
            },
        ]
    )
    manifest["metadata"]["deliveryMode"] = "squad"

    happ = render_subscription_for_target(manifest, settings=_settings(), target="happ")
    raw_uri = render_subscription_for_target(manifest, settings=_settings(), target="raw-uri")

    assert "vless://" in happ.body
    assert "hysteria2://" in happ.body
    assert "http://" not in happ.body
    assert "tuic://" not in happ.body
    assert "http://" in raw_uri.body
    assert "tuic://" in raw_uri.body


def test_happ_raw_uri_skips_vmess_grpc_profiles() -> None:
    manifest = _manifest(
        [
            {
                "id": "vmess-grpc-1",
                "type": "vmess-grpc-tls",
                "adapter": "vmess-grpc-tls",
                "endpoint": {"host": "vmess.example.test", "port": 443, "transport": "grpc"},
                "security": {"type": "tls", "serverName": "vmess.example.test"},
                "credentialsRef": "vault://subscriptions/vmess-grpc",
                "rendererHints": {"name": "VMess gRPC TLS"},
            },
            {
                "id": "vmess-tcp-1",
                "type": "vmess",
                "endpoint": {"host": "vmess.example.test", "port": 443, "transport": "tcp"},
                "security": {"type": "tls", "serverName": "vmess.example.test"},
                "credentialsRef": "vault://subscriptions/vmess-tcp",
                "rendererHints": {"name": "VMess TCP TLS"},
            },
        ]
    )
    manifest["metadata"]["deliveryMode"] = "squad"

    happ = render_subscription_for_target(manifest, settings=_settings(), target="happ")
    raw_uri = render_subscription_for_target(manifest, settings=_settings(), target="raw-uri")

    assert _vmess_profile_names(happ.body) == ["VMess TCP TLS"]
    assert _vmess_profile_names(raw_uri.body) == ["VMess gRPC TLS", "VMess TCP TLS"]


def test_happ_uses_plain_lumen_title_and_country_flagged_profiles() -> None:
    manifest = _manifest(
        [
            {
                "id": "hysteria2-1",
                "type": "hysteria2",
                "endpoint": {"host": "hy2.example.test", "port": 443, "transport": "udp"},
                "credentialsRef": "vault://subscriptions/hysteria2",
                "rendererHints": {"name": "NL Amsterdam - Lumen Hysteria2"},
            },
        ]
    )
    manifest["metadata"]["profileTitle"] = "Lumen multi-protocol dev"
    manifest["nodes"][0]["region"] = "NL"
    manifest["nodes"][0]["displayName"] = "NL Amsterdam"

    happ = render_subscription_for_target(manifest, settings=_settings(), target="happ")
    raw_uri = render_subscription_for_target(manifest, settings=_settings(), target="raw-uri")

    assert _profile_title(happ) == "Lumen"
    assert "%F0%9F%87%B3%F0%9F%87%B1%20NL%20Amsterdam%20-%20Lumen%20Hysteria2" in happ.body
    assert "%F0%9F%87%B3%F0%9F%87%B1%20NL%20Amsterdam" not in raw_uri.body


def test_happ_sets_subscription_announce_header_only_for_happ() -> None:
    manifest = _manifest(
        [
            {
                "id": "hysteria2-1",
                "type": "hysteria2",
                "endpoint": {"host": "hy2.example.test", "port": 443, "transport": "udp"},
                "credentialsRef": "vault://subscriptions/hysteria2",
                "rendererHints": {"name": "NL Amsterdam - Lumen Hysteria2"},
            },
        ]
    )
    manifest["metadata"]["happAnnounce"] = (
        "подписка для: DEV\n"
        "разрешено устройств: 23\n"
        "дней осталось: 684"
    )

    happ = render_subscription_for_target(manifest, settings=_settings(), target="happ")
    raw_uri = render_subscription_for_target(manifest, settings=_settings(), target="raw-uri")

    assert _base64_header(happ, "announce") == (
        "подписка для: DEV\n"
        "разрешено устройств: 23\n"
        "дней осталось: 684"
    )
    assert "announce" not in raw_uri.headers


def test_raw_subscription_renders_openvpn_wireguard_and_ikev2_profiles() -> None:
    rendered = render_subscription_for_target(
        _manifest(
            [
                {
                    "id": "openvpn-1",
                    "type": "openvpn",
                    "endpoint": {"host": "ovpn.example.test", "port": 1194, "transport": "udp"},
                    "credentialsRef": "vault://subscriptions/openvpn",
                    "rendererHints": {"caCert": TEST_CA_CERT},
                },
                {
                    "id": "wireguard-1",
                    "type": "wireguard",
                    "endpoint": {"host": "wg.example.test", "port": 51820, "transport": "udp"},
                    "security": {"publicKey": "server-public-key"},
                    "credentialsRef": "vault://subscriptions/wireguard",
                    "rendererHints": {"address": "10.66.0.2/32", "dns": "1.1.1.1"},
                },
                {
                    "id": "ikev2-1",
                    "type": "ikev2",
                    "endpoint": {"host": "ikev2.example.test", "port": 500, "transport": "udp"},
                    "credentialsRef": "vault://subscriptions/ikev2",
                    "rendererHints": {
                        "ikev2CaCert": TEST_CA_CERT,
                        "ikev2ServerId": "ikev2.example.test",
                    },
                },
            ]
        ),
        settings=_settings(),
        target="raw-uri",
    )

    assert rendered.content_type == "text/plain; charset=utf-8"
    assert "remote ovpn.example.test 1194" in rendered.body
    assert "<auth-user-pass>" in rendered.body
    assert "[Interface]" in rendered.body
    assert "Endpoint = wg.example.test:51820" in rendered.body
    assert '"type": "ikev2-eap"' in rendered.body
    assert '"addr": "ikev2.example.test"' in rendered.body


def test_structured_subscription_targets_render_vless_profile() -> None:
    manifest = _manifest(
        [
            {
                "id": "vless-1",
                "type": "vless",
                "endpoint": {"host": "xray.example.test", "port": 443, "transport": "tcp"},
                "credentialsRef": "vault://subscriptions/vless",
                "security": {"serverName": "xray.example.test"},
            }
        ]
    )

    mihomo = render_subscription_for_target(manifest, settings=_settings(), target="mihomo")
    sing_box = render_subscription_for_target(manifest, settings=_settings(), target="sing-box")
    xray = render_subscription_for_target(manifest, settings=_settings(), target="xray-json")
    amnezia = render_subscription_for_target(manifest, settings=_settings(), target="amnezia")

    assert "proxies:" in mihomo.body
    assert json.loads(sing_box.body)["outbounds"][0]["type"] == "vless"
    assert json.loads(xray.body)["outbounds"][0]["protocol"] == "vless"
    assert json.loads(amnezia.body)["outbounds"][0]["protocol"] == "vless"
