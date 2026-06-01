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


def _inbounds(port: int):
    return [
        SimpleNamespace(
            tag="inbound-test",
            listen="0.0.0.0",  # noqa: S104
            port=port,
            protocol="vless",
            transport="tcp",
            security="tls",
            credentials_ref="vault://subscriptions/p/creds",
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


def test_tuic_profile_builds_tuic_payload():
    payload = build_node_outbound_payload(_profile("tuic-v5"), _inbounds(8443))
    assert "tuicConfig" in payload
    assert payload["tuicConfig"]["server"] == ":8443"
    assert payload["tuicConfig"]["congestion_control"] == "bbr"
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
