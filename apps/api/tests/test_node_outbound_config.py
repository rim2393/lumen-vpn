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
    return [SimpleNamespace(port=port)]


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
