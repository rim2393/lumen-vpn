from app.domains.protocols.service import list_protocol_adapters


def test_protocol_adapter_catalog_contains_full_product_matrix() -> None:
    adapters = list_protocol_adapters()
    protocols = [adapter.protocol for adapter in adapters]

    assert len(adapters) >= 25
    assert len(protocols) == len(set(protocols))
    assert protocols[0] == "vless-reality"

    for expected_protocol in (
        "vless-reality",
        "vless-reality-grpc",
        "vless-ws-tls",
        "vmess-ws-tls",
        "trojan-tcp-tls",
        "trojan-tcp-reality",
        "shadowsocks-2022",
        "wireguard-amneziawg",
        "hysteria2-obfs",
        "tuic-v5",
        "naiveproxy",
        "tcp-smoke",
    ):
        assert expected_protocol in protocols

    for adapter in adapters:
        assert adapter.display_name
        assert "subscription" in adapter.capabilities
