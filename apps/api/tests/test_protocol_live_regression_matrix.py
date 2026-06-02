from __future__ import annotations

from uuid import uuid4

from app.domains.protocols.models import ProtocolProfile
from app.domains.protocols.service import (
    LIVE_PROFILE_ADAPTERS,
    _adapter_family,
    _inbound_protocol,
    _inbound_security,
    _inbound_transport,
    list_protocol_adapters,
)

PRODUCTION_LIVE_ADAPTERS = frozenset(
    {
        "http-proxy",
        "hysteria2",
        "hysteria2-obfs",
        "naiveproxy",
        "openvpn-shadowsocks",
        "openvpn-udp",
        "shadowsocks-2022",
        "shadowsocks-native",
        "shadowsocks-obfs",
        "shadowsocks-v2ray-plugin",
        "socks5",
        "trojan-grpc-tls",
        "trojan-httpupgrade-tls",
        "trojan-tcp-reality",
        "trojan-tcp-tls",
        "trojan-ws-tls",
        "trojan-xhttp-tls",
        "tuic-v5",
        "vless-grpc-tls",
        "vless-httpupgrade-tls",
        "vless-reality",
        "vless-reality-grpc",
        "vless-reality-httpupgrade",
        "vless-reality-xhttp",
        "vless-tcp",
        "vless-tcp-tls",
        "vless-ws",
        "vless-ws-tls",
        "vless-xhttp-tls",
        "vmess-grpc-tls",
        "vmess-httpupgrade-tls",
        "vmess-tcp",
        "vmess-ws-tls",
        "wireguard-amneziawg",
        "wireguard-native",
    }
)

EXPECTED_RUNTIME_FAMILY = {
    "hysteria2": {"hysteria2", "hysteria2-obfs"},
    "naive": {"naiveproxy"},
    "openvpn": {"openvpn-udp"},
    "openvpn-shadowsocks": {"openvpn-shadowsocks"},
    "shadowsocks-plugin": {"shadowsocks-obfs", "shadowsocks-v2ray-plugin"},
    "sing-box-shadowsocks": {"shadowsocks-2022"},
    "tuic": {"tuic-v5"},
    "wireguard": {"wireguard-amneziawg", "wireguard-native"},
    "xray": {
        "http-proxy",
        "shadowsocks-native",
        "socks5",
        "trojan-grpc-tls",
        "trojan-httpupgrade-tls",
        "trojan-tcp-reality",
        "trojan-tcp-tls",
        "trojan-ws-tls",
        "trojan-xhttp-tls",
        "vless-grpc-tls",
        "vless-httpupgrade-tls",
        "vless-reality",
        "vless-reality-grpc",
        "vless-reality-httpupgrade",
        "vless-reality-xhttp",
        "vless-tcp",
        "vless-tcp-tls",
        "vless-ws",
        "vless-ws-tls",
        "vless-xhttp-tls",
        "vmess-grpc-tls",
        "vmess-httpupgrade-tls",
        "vmess-tcp",
        "vmess-ws-tls",
    },
}

EXPECTED_TRANSPORTS = {
    "grpc": {
        "trojan-grpc-tls",
        "vless-grpc-tls",
        "vless-reality-grpc",
        "vmess-grpc-tls",
    },
    "httpupgrade": {
        "trojan-httpupgrade-tls",
        "vless-httpupgrade-tls",
        "vless-reality-httpupgrade",
        "vmess-httpupgrade-tls",
    },
    "udp": {
        "hysteria2",
        "hysteria2-obfs",
        "openvpn-udp",
        "tuic-v5",
        "wireguard-amneziawg",
        "wireguard-native",
    },
    "ws": {"trojan-ws-tls", "vless-ws", "vless-ws-tls", "vmess-ws-tls"},
    "xhttp": {"trojan-xhttp-tls", "vless-reality-xhttp", "vless-xhttp-tls"},
}

EXPECTED_SECURITY = {
    "none": {
        "http-proxy",
        "shadowsocks-2022",
        "shadowsocks-native",
        "shadowsocks-obfs",
        "shadowsocks-v2ray-plugin",
        "socks5",
        "vless-tcp",
        "vless-ws",
        "vmess-tcp",
        "wireguard-amneziawg",
        "wireguard-native",
    },
    "reality": {
        "trojan-tcp-reality",
        "vless-reality",
        "vless-reality-grpc",
        "vless-reality-httpupgrade",
        "vless-reality-xhttp",
    },
    "tls": {
        "hysteria2",
        "hysteria2-obfs",
        "naiveproxy",
        "openvpn-shadowsocks",
        "openvpn-udp",
        "trojan-grpc-tls",
        "trojan-httpupgrade-tls",
        "trojan-tcp-tls",
        "trojan-ws-tls",
        "trojan-xhttp-tls",
        "tuic-v5",
        "vless-grpc-tls",
        "vless-httpupgrade-tls",
        "vless-tcp-tls",
        "vless-ws-tls",
        "vless-xhttp-tls",
        "vmess-grpc-tls",
        "vmess-httpupgrade-tls",
        "vmess-ws-tls",
    },
}


def _profile(adapter: str) -> ProtocolProfile:
    return ProtocolProfile(
        id=uuid4(),
        name=f"regression-{adapter}",
        node_id=uuid4(),
        adapter=adapter,
        status="active",
        config_json={},
        port_reservations=[],
        metadata_json={},
    )


def test_production_live_adapters_are_registered_and_not_legacy() -> None:
    catalog = {adapter.protocol: adapter for adapter in list_protocol_adapters()}

    assert sorted(PRODUCTION_LIVE_ADAPTERS.difference(catalog)) == []
    assert sorted(PRODUCTION_LIVE_ADAPTERS.difference(LIVE_PROFILE_ADAPTERS)) == []


def test_production_live_adapters_have_runtime_families() -> None:
    expected_by_adapter = {
        adapter: family
        for family, adapters in EXPECTED_RUNTIME_FAMILY.items()
        for adapter in adapters
    }

    assert sorted(PRODUCTION_LIVE_ADAPTERS.difference(expected_by_adapter)) == []
    for adapter in sorted(PRODUCTION_LIVE_ADAPTERS):
        assert _adapter_family(adapter) == expected_by_adapter[adapter]


def test_production_live_adapters_have_stable_inbound_mappings() -> None:
    expected_transport_by_adapter = {
        adapter: transport
        for transport, adapters in EXPECTED_TRANSPORTS.items()
        for adapter in adapters
    }
    expected_security_by_adapter = {
        adapter: security
        for security, adapters in EXPECTED_SECURITY.items()
        for adapter in adapters
    }

    assert sorted(PRODUCTION_LIVE_ADAPTERS.difference(expected_security_by_adapter)) == []
    for adapter in sorted(PRODUCTION_LIVE_ADAPTERS):
        profile = _profile(adapter)
        assert _inbound_protocol(adapter) in {
            "http",
            "hysteria2",
            "naive",
            "openvpn",
            "shadowsocks",
            "socks",
            "trojan",
            "tuic",
            "vless",
            "vmess",
            "wireguard",
        }
        assert _inbound_transport(profile) == expected_transport_by_adapter.get(adapter, "tcp")
        assert _inbound_security(profile) == expected_security_by_adapter[adapter]
