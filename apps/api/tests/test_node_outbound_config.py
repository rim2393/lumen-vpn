from types import SimpleNamespace
from uuid import uuid4

import pytest

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
    transport: str = "tcp",
    config_json: dict | None = None,
):
    return [
        SimpleNamespace(
            tag="inbound-test",
            listen="0.0.0.0",  # noqa: S104
            port=port,
            protocol=protocol,
            transport=transport,
            security=security,
            credentials_ref="vault://subscriptions/p/creds",
            config_json=config_json or {},
            hosts=[],
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


def test_naiveproxy_profile_builds_naive_payload():
    payload = build_node_outbound_payload(_profile("naiveproxy"), _inbounds(8443))
    assert payload["adapter"] == "naiveproxy"
    assert "naiveConfig" in payload
    assert payload["naiveConfig"]["listen"] == ":8443"
    assert payload["naiveConfig"]["tls"] == {
        "cert": "/var/lib/lumen-node/runtime/tls/live.crt",
        "key": "/var/lib/lumen-node/runtime/tls/live.key",
    }
    assert payload["naiveConfig"]["clientsRef"] == "vault://subscriptions/p/creds"


def test_openvpn_profile_builds_real_openvpn_payload_with_generated_pki():
    payload = build_node_outbound_payload(
        _profile("openvpn-udp", {"network": "10.88.0.0/24"}),
        _inbounds(1194, protocol="openvpn", transport="udp"),
        runtime_clients=[
            {
                "public_id": "lumen_sub_live",
                "password": "openvpn-live-password",
            }
        ],
    )

    assert payload["adapter"] == "openvpn-udp"
    assert "openvpnConfig" in payload
    config = payload["openvpnConfig"]
    assert config["listen_port"] == 1194
    assert config["proto"] == "udp"
    assert config["network"] == "10.88.0.0/24"
    assert config["users"] == [{"username": "lumen_sub_live", "password": "openvpn-live-password"}]
    assert "clientsRef" not in config
    assert "BEGIN CERTIFICATE" in config["pki"]["ca_cert"]
    assert "BEGIN CERTIFICATE" in config["pki"]["server_cert"]
    assert "BEGIN PRIVATE KEY" in config["pki"]["server_key"]


def test_openvpn_shadowsocks_profile_builds_real_bridge_payload():
    payload = build_node_outbound_payload(
        _profile(
            "openvpn-shadowsocks",
            {
                "network": "10.89.0.0/24",
                "openvpn": {"listen_port": 24194},
                "shadowsocks": {"method": "aes-256-gcm"},
            },
        ),
        _inbounds(28443, protocol="openvpn", transport="tcp"),
        runtime_clients=[
            {
                "public_id": "lumen_sub_live",
                "password": "openvpn-live-password",
                "shadowsocks_password": "ss-live-password",
            }
        ],
    )

    assert payload["adapter"] == "openvpn-shadowsocks"
    assert "openvpnShadowsocksConfig" in payload
    config = payload["openvpnShadowsocksConfig"]
    assert config["openvpn"]["listen_port"] == 24194
    assert config["openvpn"]["proto"] == "tcp-server"
    assert config["openvpn"]["local_address"] == "127.0.0.1"
    assert config["openvpn"]["users"] == [
        {"username": "lumen_sub_live", "password": "openvpn-live-password"}
    ]
    assert config["shadowsocks"]["listen_port"] == 28443
    assert config["shadowsocks"]["method"] == "aes-256-gcm"
    assert config["shadowsocks"]["password"] == "ss-live-password"  # noqa: S105
    assert "clientsRef" not in config["openvpn"]
    assert "clientsRef" not in config["shadowsocks"]


def test_wireguard_profile_builds_wireguard_payload():
    payload = build_node_outbound_payload(_profile("wireguard-native"), _inbounds(51820))
    assert "wireguardConfig" in payload
    assert payload["wireguardConfig"]["interface"]["listen_port"] == 51820
    assert payload["wireguardConfig"]["clientsRef"] == "vault://subscriptions/p/creds"


def test_amneziawg_profile_requests_awg_quick_runtime():
    payload = build_node_outbound_payload(
        _profile(
            "wireguard-amneziawg",
            {"interface": {"private_key": "server-private", "address": "10.77.0.1/24", "Jc": 4}},
        ),
        _inbounds(51821, protocol="wireguard"),
    )
    assert payload["adapter"] == "wireguard-amneziawg"
    assert payload["wireguardReloadMode"] == "awg-quick"
    assert payload["wireguardConfig"]["interface"]["Jc"] == 4


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


def test_xray_transport_variants_build_server_stream_settings():
    cases = [
        ("vless-ws-tls", "ws", {"path": "/lumen-ws"}, "wsSettings"),
        ("vless-grpc-tls", "grpc", {"serviceName": "lumenGrpc"}, "grpcSettings"),
        ("vless-httpupgrade-tls", "httpupgrade", {"path": "/upgrade"}, "httpupgradeSettings"),
        ("vless-xhttp-tls", "xhttp", {"path": "/xhttp", "mode": "stream-up"}, "xhttpSettings"),
    ]
    for adapter, transport, config, settings_key in cases:
        payload = build_node_outbound_payload(
            _profile(adapter, {"security": {"type": "tls"}, **config}),
            _inbounds(
                18443,
                protocol="vless",
                security="tls",
                transport=transport,
                config_json={"security": {"type": "tls"}, **config},
            ),
            runtime_clients=[
                {
                    "public_id": "lumen_sub_live",
                    "uuid": "11111111-1111-4111-8111-111111111111",
                }
            ],
        )

        stream = payload["xrayConfig"]["inbounds"][0]["streamSettings"]
        assert stream["network"] == transport
        assert stream[settings_key]


@pytest.mark.parametrize(
    ("adapter", "protocol", "transport", "security", "config", "settings_key", "settings_value"),
    [
        (
            "vless-ws",
            "vless",
            "ws",
            "none",
            {"path": "/vless-ws"},
            "wsSettings",
            {"path": "/vless-ws"},
        ),
        (
            "vless-ws-tls",
            "vless",
            "ws",
            "tls",
            {
                "security": {"type": "tls", "serverName": "vless-ws.example.test"},
                "path": "/vless-ws-tls",
            },
            "wsSettings",
            {"path": "/vless-ws-tls"},
        ),
        (
            "vless-grpc-tls",
            "vless",
            "grpc",
            "tls",
            {
                "security": {"type": "tls", "serverName": "vless-grpc.example.test"},
                "serviceName": "vlessGrpc",
            },
            "grpcSettings",
            {"serviceName": "vlessGrpc"},
        ),
        (
            "vless-httpupgrade-tls",
            "vless",
            "httpupgrade",
            "tls",
            {
                "security": {"type": "tls", "serverName": "vless-hu.example.test"},
                "path": "/vless-hu",
            },
            "httpupgradeSettings",
            {"path": "/vless-hu"},
        ),
        (
            "vless-xhttp-tls",
            "vless",
            "xhttp",
            "tls",
            {
                "security": {"type": "tls", "serverName": "vless-xhttp.example.test"},
                "path": "/vless-xhttp",
                "mode": "stream-up",
            },
            "xhttpSettings",
            {"path": "/vless-xhttp", "mode": "stream-up"},
        ),
        (
            "vless-reality-grpc",
            "vless",
            "grpc",
            "reality",
            {
                "security": {
                    "type": "reality",
                    "serverName": "reality-grpc.example.test",
                    "privateKey": "server-private-key",
                    "shortId": "abcd",
                },
                "serviceName": "realityGrpc",
            },
            "grpcSettings",
            {"serviceName": "realityGrpc"},
        ),
        (
            "vless-reality-httpupgrade",
            "vless",
            "httpupgrade",
            "reality",
            {
                "security": {
                    "type": "reality",
                    "serverName": "reality-hu.example.test",
                    "privateKey": "server-private-key",
                    "shortId": "abcd",
                },
                "path": "/reality-hu",
            },
            "httpupgradeSettings",
            {"path": "/reality-hu"},
        ),
        (
            "vless-reality-xhttp",
            "vless",
            "xhttp",
            "reality",
            {
                "security": {
                    "type": "reality",
                    "serverName": "reality-xhttp.example.test",
                    "privateKey": "server-private-key",
                    "shortId": "abcd",
                },
                "path": "/reality-xhttp",
                "mode": "packet-up",
            },
            "xhttpSettings",
            {"path": "/reality-xhttp", "mode": "packet-up"},
        ),
        (
            "vmess-ws-tls",
            "vmess",
            "ws",
            "tls",
            {
                "security": {"type": "tls", "serverName": "vmess-ws.example.test"},
                "path": "/vmess-ws",
            },
            "wsSettings",
            {"path": "/vmess-ws"},
        ),
        (
            "vmess-grpc-tls",
            "vmess",
            "grpc",
            "tls",
            {
                "security": {"type": "tls", "serverName": "vmess-grpc.example.test"},
                "serviceName": "vmessGrpc",
            },
            "grpcSettings",
            {"serviceName": "vmessGrpc"},
        ),
        (
            "vmess-httpupgrade-tls",
            "vmess",
            "httpupgrade",
            "tls",
            {
                "security": {"type": "tls", "serverName": "vmess-hu.example.test"},
                "path": "/vmess-hu",
            },
            "httpupgradeSettings",
            {"path": "/vmess-hu"},
        ),
        (
            "trojan-ws-tls",
            "trojan",
            "ws",
            "tls",
            {
                "security": {"type": "tls", "serverName": "trojan-ws.example.test"},
                "path": "/trojan-ws",
            },
            "wsSettings",
            {"path": "/trojan-ws"},
        ),
        (
            "trojan-grpc-tls",
            "trojan",
            "grpc",
            "tls",
            {
                "security": {"type": "tls", "serverName": "trojan-grpc.example.test"},
                "serviceName": "trojanGrpc",
            },
            "grpcSettings",
            {"serviceName": "trojanGrpc"},
        ),
        (
            "trojan-httpupgrade-tls",
            "trojan",
            "httpupgrade",
            "tls",
            {
                "security": {"type": "tls", "serverName": "trojan-hu.example.test"},
                "path": "/trojan-hu",
            },
            "httpupgradeSettings",
            {"path": "/trojan-hu"},
        ),
        (
            "trojan-xhttp-tls",
            "trojan",
            "xhttp",
            "tls",
            {
                "security": {"type": "tls", "serverName": "trojan-xhttp.example.test"},
                "path": "/trojan-xhttp",
                "mode": "stream-up",
            },
            "xhttpSettings",
            {"path": "/trojan-xhttp", "mode": "stream-up"},
        ),
        (
            "trojan-tcp-reality",
            "trojan",
            "tcp",
            "reality",
            {
                "security": {
                    "type": "reality",
                    "serverName": "trojan-reality.example.test",
                    "privateKey": "server-private-key",
                    "shortId": "abcd",
                }
            },
            None,
            None,
        ),
    ],
)
def test_xray_edge_transport_matrix_builds_exact_server_stream_settings(
    adapter: str,
    protocol: str,
    transport: str,
    security: str,
    config: dict,
    settings_key: str | None,
    settings_value: dict | None,
):
    runtime_client = {"public_id": "lumen_sub_live"}
    if protocol in {"vless", "vmess"}:
        runtime_client["uuid"] = "11111111-1111-4111-8111-111111111111"
    if protocol == "trojan":
        runtime_client["password"] = "trojan-" + "credential"

    payload = build_node_outbound_payload(
        _profile(adapter, config),
        _inbounds(
            18443,
            protocol=protocol,
            security=security,
            transport=transport,
            config_json=config,
        ),
        runtime_clients=[runtime_client],
    )

    inbound = payload["xrayConfig"]["inbounds"][0]
    stream = inbound["streamSettings"]
    assert stream["network"] == transport
    assert stream["security"] == security
    if settings_key is not None:
        assert stream[settings_key] == settings_value
    if security == "tls":
        assert stream["tlsSettings"] == {
            "certificates": [
                {
                    "certificateFile": "/var/lib/lumen-node/runtime/tls/live.crt",
                    "keyFile": "/var/lib/lumen-node/runtime/tls/live.key",
                }
            ]
        }
    if security == "reality":
        assert stream["realitySettings"]["serverNames"] == [config["security"]["serverName"]]
        assert stream["realitySettings"]["privateKey"] == "server-private-key"


def test_xray_payload_uses_concrete_vmess_and_trojan_runtime_clients():
    vmess = build_node_outbound_payload(
        _profile("vmess-ws-tls", {"security": {"type": "tls"}, "path": "/vmess"}),
        _inbounds(
            18444,
            protocol="vmess",
            security="tls",
            transport="ws",
            config_json={"security": {"type": "tls"}, "path": "/vmess"},
        ),
        runtime_clients=[
            {
                "public_id": "vmess_sub_live",
                "uuid": "22222222-2222-4222-8222-222222222222",
            }
        ],
    )
    assert vmess["xrayConfig"]["inbounds"][0]["settings"]["clients"] == [
        {
            "id": "22222222-2222-4222-8222-222222222222",
            "alterId": 0,
            "email": "vmess_sub_live",
        }
    ]

    trojan = build_node_outbound_payload(
        _profile("trojan-grpc-tls", {"security": {"type": "tls"}, "serviceName": "trojanGrpc"}),
        _inbounds(
            18445,
            protocol="trojan",
            security="tls",
            transport="grpc",
            config_json={"security": {"type": "tls"}, "serviceName": "trojanGrpc"},
        ),
        runtime_clients=[{"public_id": "trojan_sub_live", "password": "trojan-live-password"}],
    )
    assert trojan["xrayConfig"]["inbounds"][0]["settings"]["clients"] == [
        {"password": "trojan-live-password", "email": "trojan_sub_live"}
    ]


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


def test_shadowsocks_2022_payload_uses_sing_box_runtime_password():
    expected_runtime_key = "base64-2022-key"
    payload = build_node_outbound_payload(
        _profile("shadowsocks-2022", {"method": "2022-blake3-aes-128-gcm"}),
        _inbounds(
            8389,
            protocol="shadowsocks",
            config_json={"method": "2022-blake3-aes-128-gcm"},
        ),
        runtime_clients=[
            {
                "public_id": "lumen_sub_live",
                "password": "unused-generic-password",
                "shadowsocks_password": expected_runtime_key,
            }
        ],
    )

    assert "xrayConfig" not in payload
    config = payload["singBoxShadowsocksConfig"]
    assert config["listen_port"] == 8389
    assert config["method"] == "2022-blake3-aes-128-gcm"
    assert config["password"] == expected_runtime_key
    assert "clientsRef" not in config


def test_shadowsocks_v2ray_plugin_payload_uses_managed_ssserver_runtime():
    runtime_password = "ss-plugin-live-" + "password"
    payload = build_node_outbound_payload(
        _profile(
            "shadowsocks-v2ray-plugin",
            {
                "method": "aes-256-gcm",
                "plugin_opts": "server;path=/ss;host=cdn.example.test",
            },
        ),
        _inbounds(
            8390,
            protocol="shadowsocks",
            config_json={"method": "aes-256-gcm"},
        ),
        runtime_clients=[
            {
                "public_id": "lumen_sub_live",
                "password": "unused-generic-password",
                "shadowsocks_password": runtime_password,
            }
        ],
    )

    assert "xrayConfig" not in payload
    config = payload["shadowsocksPluginConfig"]
    assert config["listen_port"] == 8390
    assert config["method"] == "aes-256-gcm"
    assert config["password"] == runtime_password
    assert config["plugin"] == "v2ray-plugin"
    assert config["plugin_opts"] == "server;path=/ss;host=cdn.example.test"
    assert "clientsRef" not in config


def test_shadowsocks_obfs_payload_uses_managed_ssserver_runtime():
    runtime_password = "ss-obfs-live-" + "password"
    payload = build_node_outbound_payload(
        _profile(
            "shadowsocks-obfs",
            {
                "method": "aes-256-gcm",
                "obfs": "http",
                "obfs_host": "cdn.example.test",
            },
        ),
        _inbounds(
            8391,
            protocol="shadowsocks",
            config_json={"method": "aes-256-gcm"},
        ),
        runtime_clients=[
            {
                "public_id": "lumen_sub_live",
                "password": "unused-generic-password",
                "shadowsocks_password": runtime_password,
            }
        ],
    )

    assert "xrayConfig" not in payload
    config = payload["shadowsocksPluginConfig"]
    assert config["listen"] == "0.0.0." + "0"
    assert config["listen_port"] == 8391
    assert config["method"] == "aes-256-gcm"
    assert config["password"] == runtime_password
    assert config["plugin"] == "obfs-server"
    assert config["plugin_opts"] == "obfs=http;obfs-host=cdn.example.test"
    assert "clientsRef" not in config


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
    assert settings["accounts"] == [{"user": "lumen_sub_live", "pass": "socks-live-password"}]


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
    assert settings["accounts"] == [{"user": "lumen_sub_live", "pass": "http-live-password"}]


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


def test_hysteria2_obfs_payload_uses_concrete_runtime_obfs_secret():
    payload = build_node_outbound_payload(
        _profile("hysteria2-obfs", config_json={"obfs": {"type": "salamander"}}),
        _inbounds(443),
        runtime_clients=[
            {
                "public_id": "lumen_sub_live",
                "hysteria_password": "hy2-live-password",
                "hysteria_obfs_password": "hy2-obfs-live-password",
            }
        ],
    )

    config = payload["hysteria2Config"]
    assert "clientsRef" not in config
    assert config["auth"] == {"type": "password", "password": "hy2-live-password"}
    assert config["obfs"] == {"type": "salamander", "password": "hy2-obfs-live-password"}


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


def test_naiveproxy_payload_uses_concrete_runtime_clients_when_available():
    payload = build_node_outbound_payload(
        _profile("naiveproxy"),
        _inbounds(8443),
        runtime_clients=[
            {
                "public_id": "lumen_sub_live",
                "password": "naive-live-password",
            }
        ],
    )
    config = payload["naiveConfig"]
    assert "clientsRef" not in config
    assert config["users"] == [
        {
            "username": "lumen_sub_live",
            "password": "naive-live-password",
        }
    ]
