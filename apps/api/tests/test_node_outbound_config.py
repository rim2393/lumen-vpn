from types import SimpleNamespace
from uuid import uuid4

from app.domains.protocols.models import ProtocolProfile
from app.domains.protocols.service import build_node_outbound_payload


def _profile(adapter: str, config_json: dict | None = None) -> ProtocolProfile:
    return ProtocolProfile(
        id=uuid4(),
        adapter=adapter,
        credentials_ref="vault://subscriptions/p/creds",
        config_json=config_json or {},
    )


def _inbounds(
    port: int,
    *,
    protocol: str = "vless",
    security: str = "none",
    config_json: dict | None = None,
):
    return [
        SimpleNamespace(
            tag="inbound-test",
            listen="0.0.0.0",  # noqa: S104
            port=port,
            protocol=protocol,
            transport="tcp",
            security=security,
            credentials_ref="vault://subscriptions/p/creds",
            config_json=config_json or {},
        )
    ]


def test_hysteria2_profile_builds_hysteria2_payload():
    profile = _profile("hysteria2", {"tls": {"acme": {"domains": ["edge.example.test"]}}})
    payload = build_node_outbound_payload(profile, _inbounds(443))
    assert payload["adapter"] == "hysteria2"
    assert "hysteria2Config" in payload
    config = payload["hysteria2Config"]
    assert config["listen"] == ":443"
    assert config["tls"] == {"acme": {"domains": ["edge.example.test"]}}
    assert config["clientsRef"] == "vault://subscriptions/p/creds"


def test_hysteria2_profile_defaults_to_node_runtime_tls_paths():
    payload = build_node_outbound_payload(_profile("hysteria2"), _inbounds(443))
    config = payload["hysteria2Config"]
    assert config["tls"] == {
        "cert": "/var/lib/lumen-node/runtime/tls/live.crt",
        "key": "/var/lib/lumen-node/runtime/tls/live.key",
    }


def test_tuic_profile_builds_tuic_payload():
    payload = build_node_outbound_payload(_profile("tuic-v5"), _inbounds(8443))
    assert "tuicConfig" in payload
    assert payload["tuicConfig"]["server"] == ":8443"
    assert payload["tuicConfig"]["congestion_control"] == "bbr"
    assert payload["tuicConfig"]["certificate"] == "/var/lib/lumen-node/runtime/tls/live.crt"
    assert payload["tuicConfig"]["private_key"] == "/var/lib/lumen-node/runtime/tls/live.key"
    assert payload["tuicConfig"]["clientsRef"] == "vault://subscriptions/p/creds"


def test_wireguard_profile_builds_wireguard_payload():
    payload = build_node_outbound_payload(_profile("wireguard-native"), _inbounds(51820))
    assert "wireguardConfig" in payload
    assert payload["wireguardConfig"]["interface"]["listen_port"] == 51820
    assert payload["wireguardConfig"]["clientsRef"] == "vault://subscriptions/p/creds"


def test_xray_profile_still_builds_xray_payload():
    payload = build_node_outbound_payload(_profile("vless-tcp-tls"), [])
    assert payload["adapter"] == "vless-tcp-tls"
    assert "xrayConfig" in payload
    assert "inbounds" in payload["xrayConfig"]
    assert payload["xrayConfig"]["outbounds"] == [{"tag": "direct", "protocol": "freedom"}]


def test_xray_payload_uses_concrete_runtime_clients_when_available():
    payload = build_node_outbound_payload(
        _profile("vless-tcp-tls"),
        _inbounds(443),
        runtime_clients=[
            {
                "public_id": "lumen_sub_live",
                "uuid": "11111111-1111-4111-8111-111111111111",
                "flow": "xtls-rprx-vision",
            }
        ],
    )

    settings = payload["xrayConfig"]["inbounds"][0]["settings"]
    assert "clientsRef" not in settings
    assert settings["clients"] == [
        {
            "id": "11111111-1111-4111-8111-111111111111",
            "email": "lumen_sub_live",
            "flow": "xtls-rprx-vision",
        }
    ]


def test_xray_reality_profile_builds_server_stream_settings():
    security = {
        "type": "reality",
        "serverName": "www.example.test",
        "dest": "www.example.test:443",
        "privateKey": "server-private-key",
        "publicKey": "client-public-key",
        "shortId": "abcd1234",
    }
    payload = build_node_outbound_payload(
        _profile("vless-reality", {"security": security}),
        _inbounds(
            18443,
            protocol="vless",
            security="reality",
            config_json={"security": security},
        ),
        runtime_clients=[
            {
                "public_id": "lumen_sub_live",
                "uuid": "11111111-1111-4111-8111-111111111111",
                "flow": "xtls-rprx-vision",
            }
        ],
    )

    stream = payload["xrayConfig"]["inbounds"][0]["streamSettings"]
    assert stream["security"] == "reality"
    assert stream["realitySettings"] == {
        "show": False,
        "dest": "www.example.test:443",
        "xver": 0,
        "serverNames": ["www.example.test"],
        "privateKey": "server-private-key",
        "shortIds": ["abcd1234"],
    }


def test_shadowsocks_payload_uses_concrete_runtime_password():
    payload = build_node_outbound_payload(
        _profile("shadowsocks-native", {"method": "aes-128-gcm"}),
        _inbounds(8388, protocol="shadowsocks", config_json={"method": "aes-128-gcm"}),
        runtime_clients=[
            {
                "public_id": "lumen_sub_live",
                "password": "unused-generic-password",
                "shadowsocks_password": "ss-live-password",
            }
        ],
    )

    settings = payload["xrayConfig"]["inbounds"][0]["settings"]
    assert "clientsRef" not in settings
    assert settings == {
        "method": "aes-128-gcm",
        "password": "ss-live-password",
        "network": "tcp,udp",
    }


def test_socks_payload_uses_concrete_runtime_accounts():
    payload = build_node_outbound_payload(
        _profile("socks5"),
        _inbounds(1080, protocol="socks"),
        runtime_clients=[
            {
                "public_id": "lumen_sub_live",
                "password": "socks-live-password",
            }
        ],
    )

    settings = payload["xrayConfig"]["inbounds"][0]["settings"]
    assert "clientsRef" not in settings
    assert settings["accounts"] == [
        {"user": "lumen_sub_live", "pass": "socks-live-password"}
    ]


def test_http_proxy_payload_uses_concrete_runtime_accounts():
    payload = build_node_outbound_payload(
        _profile("http-proxy"),
        _inbounds(8080, protocol="http"),
        runtime_clients=[
            {
                "public_id": "lumen_sub_live",
                "password": "http-live-password",
            }
        ],
    )

    settings = payload["xrayConfig"]["inbounds"][0]["settings"]
    assert "clientsRef" not in settings
    assert settings["accounts"] == [
        {"user": "lumen_sub_live", "pass": "http-live-password"}
    ]


def test_hysteria2_payload_uses_concrete_runtime_clients_when_available():
    payload = build_node_outbound_payload(
        _profile("hysteria2"),
        _inbounds(443),
        runtime_clients=[
            {
                "public_id": "lumen_sub_live",
                "hysteria_password": "hy2-live-password",
            }
        ],
    )

    config = payload["hysteria2Config"]
    assert "clientsRef" not in config
    assert config["auth"] == {"type": "password", "password": "hy2-live-password"}


def test_tuic_payload_uses_concrete_runtime_clients_when_available():
    payload = build_node_outbound_payload(
        _profile("tuic-v5"),
        _inbounds(8443),
        runtime_clients=[
            {
                "public_id": "lumen_sub_live",
                "uuid": "11111111-1111-4111-8111-111111111111",
                "password": "tuic-live-password",
            }
        ],
    )

    config = payload["tuicConfig"]
    assert "clientsRef" not in config
    assert config["users"] == {
        "11111111-1111-4111-8111-111111111111": "tuic-live-password",
    }
