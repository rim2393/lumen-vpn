from __future__ import annotations

import base64
import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote, urlencode
from uuid import NAMESPACE_URL, UUID, uuid5

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import x25519
from fastapi import status

from app.core.config import Settings
from app.core.errors import APIError

SUPPORTED_RENDER_TARGETS = frozenset(
    {
        "lumen-json",
        "raw-uri",
        "v2ray",
        "v2ray-base64",
        "v2rayn",
        "v2rayng",
        "streisand",
        "shadowrocket",
        "hiddify",
        "happ",
        "sing-box",
        "nekobox",
        "nekoray",
        "mihomo",
        "clash-meta",
        "clash",
        "flclash",
        "stash",
        "koala-clash",
        "xray-json",
        "amnezia",
    }
)

MIHOMO_TARGETS = frozenset({"mihomo", "clash-meta", "clash", "flclash", "stash", "koala-clash"})
SING_BOX_TARGETS = frozenset({"sing-box", "nekobox", "nekoray"})
RAW_URI_TARGETS = frozenset(
    {"raw-uri", "v2ray", "v2rayn", "v2rayng", "streisand", "shadowrocket", "hiddify", "happ"}
)
XRAY_TARGETS = frozenset({"xray-json", "amnezia"})
AMNEZIA_WG_KEYS = (
    "Jc",
    "Jmin",
    "Jmax",
    "S1",
    "S2",
    "S3",
    "S4",
    "H1",
    "H2",
    "H3",
    "H4",
    "I1",
    "I2",
    "I3",
    "I4",
    "I5",
)
AMNEZIA_WG_POSITIVE_INT_KEYS = frozenset({"Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4"})
AMNEZIA_WG_JUNK_COUNT_KEYS = frozenset({"Jc", "Jmin", "Jmax"})
RAW_URI_IMPORTABLE_PROTOCOLS = frozenset(
    {
        "vless",
        "vmess",
        "trojan",
        "shadowsocks",
        "hysteria2",
        "tuic",
        "naive",
        "socks",
        "http",
    }
)
HAPP_IMPORTABLE_PROTOCOLS = frozenset(
    {
        "vless",
        "vmess",
        "trojan",
        "shadowsocks",
        "hysteria2",
        "socks",
    }
)
RAW_URI_CLIENT_TARGETS = RAW_URI_TARGETS - frozenset({"raw-uri"})
DEFAULT_SHADOWSOCKS_METHOD = "aes-256-gcm"


@dataclass(frozen=True)
class RenderedSubscription:
    body: str
    content_type: str
    filename: str
    headers: dict[str, str]


@dataclass(frozen=True)
class ClientCredential:
    uuid: str
    password: str
    shadowsocks_password: str
    shadowsocks_2022_password: str
    hysteria_password: str
    hysteria_obfs_password: str
    wireguard_private_key: str
    wireguard_public_key: str


def render_subscription_for_target(
    manifest: dict[str, Any],
    *,
    settings: Settings,
    target: str | None,
) -> RenderedSubscription:
    normalized_target = normalize_render_target(target)
    headers = (
        build_happ_subscription_headers(manifest)
        if normalized_target == "happ"
        else build_subscription_headers(manifest)
    )
    render_manifest = manifest_for_render_target(manifest, normalized_target)
    if manifest_contains_openvpn_shadowsocks(manifest) and (
        normalized_target in MIHOMO_TARGETS
        or normalized_target in SING_BOX_TARGETS
        or normalized_target in XRAY_TARGETS
    ):
        raise APIError(
            code="subscription_render_target_unsupported_for_protocol",
            message=(
                "OpenVPN-over-Shadowsocks can be rendered as the Lumen native "
                "manifest or raw OpenVPN profile only."
            ),
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            details=[normalized_target, "openvpn-shadowsocks"],
        )
    if manifest_contains_ikev2(manifest) and (
        normalized_target in MIHOMO_TARGETS
        or normalized_target in SING_BOX_TARGETS
        or normalized_target in XRAY_TARGETS
    ):
        raise APIError(
            code="subscription_render_target_unsupported_for_protocol",
            message=(
                "IKEv2/IPsec can be rendered as the Lumen native manifest "
                "or strongSwan Android .sswan raw profile only."
            ),
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            details=[normalized_target, "ikev2"],
        )

    if normalized_target == "lumen-json":
        return RenderedSubscription(
            body=f"{json.dumps(manifest, indent=2, ensure_ascii=False)}\n",
            content_type="application/json; charset=utf-8",
            filename="lumen-subscription.json",
            headers=headers,
        )

    if normalized_target in RAW_URI_TARGETS or normalized_target == "v2ray-base64":
        raw = render_raw_uri_subscription(
            render_manifest,
            settings=settings,
            target=normalized_target,
        )
        if normalized_target == "v2ray-base64":
            body = base64.b64encode(raw.encode("utf-8")).decode("ascii")
            if body:
                body += "\n"
        else:
            body = raw
        return RenderedSubscription(
            body=body,
            content_type="text/plain; charset=utf-8",
            filename="lumen-v2ray-subscription.txt",
            headers=headers,
        )

    if normalized_target in MIHOMO_TARGETS:
        if not manifest_has_mihomo_proxy(render_manifest, settings=settings):
            raise_render_target_unsupported(render_manifest, normalized_target)
        return RenderedSubscription(
            body=render_mihomo_yaml(render_manifest, settings=settings),
            content_type="application/yaml; charset=utf-8",
            filename="lumen-mihomo.yaml",
            headers=headers,
        )

    if normalized_target in SING_BOX_TARGETS:
        config = render_sing_box_config(render_manifest, settings=settings)
        if not has_non_selector_outbound(config):
            raise_render_target_unsupported(manifest, normalized_target)
        body = json.dumps(config, indent=2, ensure_ascii=False)
        return RenderedSubscription(
            body=f"{body}\n",
            content_type="application/json; charset=utf-8",
            filename="lumen-sing-box.json",
            headers=headers,
        )

    if normalized_target in XRAY_TARGETS:
        config = render_xray_json(render_manifest, settings=settings)
        if not config.get("outbounds"):
            raise_render_target_unsupported(manifest, normalized_target)
        body = json.dumps(config, indent=2, ensure_ascii=False)
        return RenderedSubscription(
            body=f"{body}\n",
            content_type="application/json; charset=utf-8",
            filename="lumen-xray.json",
            headers=headers,
        )

    raise APIError(
        code="subscription_render_target_unknown",
        message="Subscription render target is not supported.",
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        details=[normalized_target],
    )


def raise_render_target_unsupported(manifest: dict[str, Any], target: str) -> None:
    adapters = sorted(
        {
            str(entry["protocol"].get("adapter") or entry["protocol"].get("type") or "unknown")
            for entry in iter_protocol_entries(manifest)
        }
    )
    raise APIError(
        code="subscription_render_target_unsupported_for_protocol",
        message="Subscription render target is not supported for this protocol.",
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        details=[target, ",".join(adapters)],
    )


def manifest_for_render_target(manifest: dict[str, Any], render_target: str) -> dict[str, Any]:
    if render_target != "happ":
        return manifest
    metadata = dict(manifest.get("metadata", {}))
    metadata["activeRenderTarget"] = render_target
    return {**manifest, "metadata": metadata}


def manifest_contains_openvpn_shadowsocks(manifest: dict[str, Any]) -> bool:
    return any(
        is_openvpn_shadowsocks_protocol(entry["protocol"])
        for entry in iter_protocol_entries(manifest)
    )


def manifest_contains_ikev2(manifest: dict[str, Any]) -> bool:
    return any(
        normalize_protocol_type(entry["protocol"].get("type")) == "ikev2"
        for entry in iter_protocol_entries(manifest)
    )


def is_openvpn_shadowsocks_protocol(protocol: dict[str, Any]) -> bool:
    return (
        protocol.get("adapter") == "openvpn-shadowsocks"
        or protocol.get("type") == "openvpn-shadowsocks"
    )


def normalize_render_target(target: str | None) -> str:
    normalized = (target or "v2ray").strip().lower().replace("_", "-")
    aliases = {
        "base64": "v2ray-base64",
        "clashmeta": "clash-meta",
        "clash-meta-yaml": "clash-meta",
        "happ-routing": "happ",
        "hiddify-next": "hiddify",
        "mihomo-yaml": "mihomo",
        "singbox": "sing-box",
        "singbox-json": "sing-box",
        "v2ray-uri": "v2ray",
        "xray": "xray-json",
    }
    normalized = aliases.get(normalized, normalized)
    if normalized not in SUPPORTED_RENDER_TARGETS:
        raise APIError(
            code="subscription_render_target_unknown",
            message="Subscription render target is not supported.",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            details=[normalized],
        )
    return normalized


def build_subscription_headers(manifest: dict[str, Any]) -> dict[str, str]:
    subscription = manifest.get("subscription", {})
    metadata = manifest.get("metadata", {})
    expire = _unix_timestamp(subscription.get("expiresAt"))
    total = _bytes_from_gb(metadata.get("trafficLimitGb"))
    upload = _bytes_from_gb(metadata.get("trafficUploadGb"))
    download = _bytes_from_gb(metadata.get("trafficUsedGb"))
    userinfo = f"upload={upload}; download={download}; total={total}; expire={expire}"
    title = str(metadata.get("profileTitle") or manifest.get("provider", {}).get("name") or "Lumen")
    update_interval = str(metadata.get("updateIntervalHours") or 24)
    headers = {
        "profile-title": _base64_header_value(title),
        "profile-update-interval": update_interval,
        "subscription-userinfo": userinfo,
    }
    response_headers = metadata.get("responseHeaders")
    if isinstance(response_headers, dict):
        blocked = {
            "cache-control",
            "content-disposition",
            "set-cookie",
            "x-lumen-render-target",
        }
        for key, value in response_headers.items():
            normalized_key = str(key).strip()
            normalized_value = str(value).strip()
            if (
                not normalized_key
                or normalized_key.lower() in blocked
                or "\r" in normalized_key
                or "\n" in normalized_key
                or "\r" in normalized_value
                or "\n" in normalized_value
            ):
                continue
            headers[normalized_key] = normalized_value
    return headers


def build_happ_subscription_headers(manifest: dict[str, Any]) -> dict[str, str]:
    headers = build_subscription_headers(manifest)
    headers["profile-title"] = _base64_header_value("Lumen")
    announce = _happ_announce(manifest)
    if announce is not None:
        headers["announce"] = _base64_header_value(announce)
    return headers


def render_raw_uri_subscription(
    manifest: dict[str, Any],
    *,
    settings: Settings,
    target: str = "raw-uri",
) -> str:
    is_squad_bundle = manifest.get("metadata", {}).get("deliveryMode") == "squad"
    lines = [
        uri
        for entry in iter_protocol_entries(manifest)
        if raw_uri_target_supports_entry(
            entry,
            target=target,
            is_squad_bundle=is_squad_bundle,
        )
        if (uri := render_share_uri(entry, settings=settings)) is not None
    ]
    return "\n".join(lines) + ("\n" if lines else "")


def _happ_announce(manifest: dict[str, Any]) -> str | None:
    metadata = manifest.get("metadata", {})
    value = metadata.get("happAnnounce") if isinstance(metadata, dict) else None
    if value is None:
        return None
    lines = [line.strip() for line in str(value).replace("\r", "\n").split("\n")]
    normalized = "\n".join(line for line in lines if line)
    if not normalized:
        return None
    return normalized[:200]


def raw_uri_target_supports_entry(
    entry: dict[str, Any],
    *,
    target: str,
    is_squad_bundle: bool,
) -> bool:
    protocol = entry["protocol"]
    protocol_type = normalize_protocol_type(protocol.get("type"))
    protocol_variant = " ".join(
        str(protocol.get(key) or "").lower()
        for key in ("id", "type", "adapter")
    )
    if target == "happ" and protocol_type == "vmess" and (
        network_type(protocol) == "grpc" or "vmess-grpc" in protocol_variant
    ):
        return False
    if not is_squad_bundle:
        if target == "happ":
            return protocol_type in HAPP_IMPORTABLE_PROTOCOLS
        return True
    if target == "happ":
        return protocol_type in HAPP_IMPORTABLE_PROTOCOLS
    if target in RAW_URI_CLIENT_TARGETS or target == "v2ray-base64":
        return protocol_type in RAW_URI_IMPORTABLE_PROTOCOLS
    return True


def render_share_uri(entry: dict[str, Any], *, settings: Settings) -> str | None:
    protocol = entry["protocol"]
    protocol_type = normalize_protocol_type(protocol.get("type"))
    credentials = derive_credentials(
        settings=settings,
        manifest=entry["manifest"],
        protocol=protocol,
    )
    label = node_label(entry, with_country_flag=is_happ_render(entry))

    if protocol_type == "vless":
        query = {
            "encryption": "none",
            "type": network_type(protocol),
            "security": security_name(protocol),
        }
        if protocol.get("flow"):
            query["flow"] = str(protocol["flow"])
        security = protocol.get("security", {})
        if security.get("serverName"):
            query["sni"] = str(security["serverName"])
        if security.get("fingerprint"):
            query["fp"] = str(security["fingerprint"])
        if security.get("publicKey"):
            query["pbk"] = str(security["publicKey"])
        if security.get("shortId") is not None:
            query["sid"] = str(security["shortId"])
        if security.get("spiderX"):
            query["spx"] = str(security["spiderX"])
        _add_share_transport_query(query, protocol)
        return build_uri("vless", credentials.uuid, protocol, query, label)

    if protocol_type == "vmess":
        security = protocol.get("security", {})
        payload = {
            "v": "2",
            "ps": label,
            "add": protocol["endpoint"]["host"],
            "port": str(protocol["endpoint"]["port"]),
            "id": credentials.uuid,
            "aid": "0",
            "scy": "auto",
            "net": network_type(protocol),
            "type": "none",
            "host": str(security.get("serverName") or ""),
            "path": str(protocol.get("path") or ""),
            "tls": "tls" if security_name(protocol) != "none" else "",
            "sni": str(security.get("serverName") or ""),
        }
        encoded = base64.b64encode(
            json.dumps(payload, ensure_ascii=False).encode("utf-8")
        ).decode("ascii")
        return f"vmess://{encoded}"

    if protocol_type == "trojan":
        security = protocol.get("security", {})
        query = {"type": network_type(protocol), "security": security_name(protocol)}
        if security.get("serverName"):
            query["sni"] = str(security["serverName"])
        if security.get("fingerprint"):
            query["fp"] = str(security["fingerprint"])
        if security.get("publicKey"):
            query["pbk"] = str(security["publicKey"])
        if security.get("shortId") is not None:
            query["sid"] = str(security["shortId"])
        if security.get("spiderX"):
            query["spx"] = str(security["spiderX"])
        _add_share_transport_query(query, protocol)
        return build_uri("trojan", credentials.password, protocol, query, label)

    if protocol_type == "shadowsocks":
        hints = protocol.get("rendererHints", {})
        method = shadowsocks_method(protocol)
        password = shadowsocks_password_for_method(credentials, str(method))
        userinfo = base64.urlsafe_b64encode(
            f"{method}:{password}".encode()
        ).decode("ascii").rstrip("=")
        query = shadowsocks_plugin_query(hints)
        return build_uri("ss", userinfo, protocol, query, label)

    if protocol_type == "hysteria2":
        security = protocol.get("security", {})
        hints = protocol.get("rendererHints", {})
        query = {}
        if security.get("serverName"):
            query["sni"] = str(security["serverName"])
        if hints.get("obfs"):
            query["obfs"] = str(hints["obfs"])
            query["obfs-password"] = credentials.hysteria_obfs_password
        return build_uri("hysteria2", credentials.hysteria_password, protocol, query, label)

    if protocol_type == "ikev2":
        return render_ikev2_sswan(entry, credentials=credentials)

    if protocol_type == "tuic":
        security = protocol.get("security", {})
        endpoint = protocol["endpoint"]
        query = {"congestion_control": "bbr", "alpn": "h3"}
        if security.get("serverName"):
            query["sni"] = str(security["serverName"])
        userinfo = f"{quote(credentials.uuid, safe='')}:{quote(credentials.password, safe='')}"
        return (
            f"tuic://{userinfo}@{endpoint['host']}:{endpoint['port']}"
            f"?{urlencode(query)}#{quote(label)}"
        )

    if protocol_type == "naive":
        userinfo = (
            f"{quote(protocol_username(entry), safe='')}:"
            f"{quote(credentials.password, safe='')}"
        )
        return build_uri("https", userinfo, protocol, {}, label)

    if protocol_type == "openvpn":
        return render_openvpn_ovpn(entry, credentials=credentials)

    if protocol_type == "wireguard":
        return render_wireguard_conf(entry, credentials=credentials)

    if protocol_type == "socks":
        userinfo = (
            f"{quote(protocol_username(entry), safe='')}:"
            f"{quote(credentials.password, safe='')}"
        )
        return build_uri("socks5", userinfo, protocol, {}, label)

    if protocol_type == "http":
        userinfo = (
            f"{quote(protocol_username(entry), safe='')}:"
            f"{quote(credentials.password, safe='')}"
        )
        return build_uri("http", userinfo, protocol, {}, label)

    # AmneziaWG has no universal single-line share URI; it is emitted in
    # structured client formats and the Lumen native manifest.
    return None


def render_openvpn_ovpn(entry: dict[str, Any], *, credentials: ClientCredential) -> str | None:
    protocol = entry["protocol"]
    endpoint = protocol.get("endpoint", {})
    hints = protocol.get("rendererHints", {})
    ca_cert = hints.get("caCert")
    if not endpoint.get("host") or not endpoint.get("port") or not ca_cert:
        return None
    is_shadowsocks_bridge = is_openvpn_shadowsocks_protocol(protocol)
    proto = "tcp" if is_shadowsocks_bridge else network_type(protocol)
    if proto not in {"udp", "tcp"}:
        proto = "udp"
    remote_host = endpoint["host"]
    remote_port = endpoint["port"]
    bridge_lines: list[str] = []
    if is_shadowsocks_bridge:
        remote_host = str(hints.get("openvpnRemoteHost") or "127.0.0.1")
        remote_port = int(hints.get("openvpnRemotePort") or 1194)
        bridge_lines = [
            "# Lumen OpenVPN-over-Shadowsocks profile.",
            "# Start a local Shadowsocks client first and expose SOCKS5 on 127.0.0.1:1080.",
            f"# Shadowsocks server: {endpoint['host']}:{endpoint['port']}",
            f"# Shadowsocks method: {hints.get('method') or 'aes-256-gcm'}",
            "# Shadowsocks password is available in the Lumen native subscription manifest.",
            "socks-proxy 127.0.0.1 1080",
            "route-method exe",
            "route-delay 2",
        ]
    lines = [
        "client",
        "dev tun",
        f"proto {proto}",
        f"remote {remote_host} {remote_port}",
        "resolv-retry infinite",
        "nobind",
        "persist-key",
        "persist-tun",
        "remote-cert-tls server",
        "auth SHA256",
        "auth-nocache",
        "data-ciphers AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305",
        "verb 3",
        *bridge_lines,
        "<ca>",
        str(ca_cert).strip(),
        "</ca>",
        "<auth-user-pass>",
        protocol_username(entry),
        credentials.password,
        "</auth-user-pass>",
    ]
    return "\n".join(lines)


def render_wireguard_conf(entry: dict[str, Any], *, credentials: ClientCredential) -> str | None:
    protocol = entry["protocol"]
    endpoint = protocol.get("endpoint", {})
    security = protocol.get("security", {})
    hints = protocol.get("rendererHints", {})
    peer_public_key = security.get("publicKey")
    address = hints.get("address")
    if not endpoint.get("host") or not endpoint.get("port") or not peer_public_key or not address:
        return None
    allowed_ips = hints.get("allowedIps") or "0.0.0.0/0, ::/0"
    lines = [
        "[Interface]",
        f"PrivateKey = {credentials.wireguard_private_key}",
        f"Address = {address}",
    ]
    if hints.get("dns"):
        lines.append(f"DNS = {hints['dns']}")
    if hints.get("mtu"):
        lines.append(f"MTU = {hints['mtu']}")
    for key in AMNEZIA_WG_KEYS:
        if key in AMNEZIA_WG_JUNK_COUNT_KEYS and not has_valid_amneziawg_junk_count(hints):
            continue
        value = hints.get(key)
        if value is not None and is_valid_amneziawg_hint_value(key, value):
            lines.append(f"{key} = {value}")
    lines.extend(
        [
            "",
            "[Peer]",
            f"PublicKey = {peer_public_key}",
            f"Endpoint = {endpoint['host']}:{endpoint['port']}",
            f"AllowedIPs = {allowed_ips}",
        ]
    )
    if hints.get("persistentKeepalive"):
        lines.append(f"PersistentKeepalive = {hints['persistentKeepalive']}")
    return "\n".join(lines)


def is_valid_amneziawg_hint_value(key: str, value: object) -> bool:
    if value is None:
        return False
    if key not in AMNEZIA_WG_POSITIVE_INT_KEYS:
        return str(value).strip() != ""
    try:
        return int(str(value).strip()) > 0
    except ValueError:
        return False


def has_valid_amneziawg_junk_count(hints: dict[str, Any]) -> bool:
    return all(
        is_valid_amneziawg_hint_value(key, hints.get(key))
        for key in AMNEZIA_WG_JUNK_COUNT_KEYS
    )


def render_ikev2_sswan(entry: dict[str, Any], *, credentials: ClientCredential) -> str | None:
    protocol = entry["protocol"]
    endpoint = protocol.get("endpoint", {})
    hints = protocol.get("rendererHints", {})
    ca_cert = hints.get("ikev2CaCert")
    host = endpoint.get("host")
    if not host or not ca_cert:
        return None
    profile_uuid = str(
        uuid5(
            NAMESPACE_URL,
            f"lumen:ikev2:{entry['manifest']['subscription']['id']}:{protocol.get('id')}",
        )
    )
    payload = {
        "uuid": profile_uuid,
        "name": node_label(entry),
        "type": "ikev2-eap",
        "remote": {
            "addr": host,
            "port": int(endpoint.get("port") or 500),
            "id": hints.get("ikev2ServerId") or host,
            "cert": base64.b64encode(str(ca_cert).encode("utf-8")).decode("ascii"),
        },
        "local": {
            "eap_id": protocol_username(entry),
            "shared_secret": credentials.password,
        },
        "split-tunneling": {
            "block-ipv4": True,
            "block-ipv6": False,
        },
    }
    if hints.get("mtu") is not None:
        payload["mtu"] = int(hints["mtu"])
    if hints.get("dns"):
        payload["dns-servers"] = [
            value.strip()
            for value in str(hints["dns"]).split(",")
            if value.strip()
        ]
    return json.dumps(payload, ensure_ascii=False, indent=2)


def build_uri(
    scheme: str,
    userinfo: str,
    protocol: dict[str, Any],
    query: dict[str, str],
    label: str,
) -> str:
    endpoint = protocol["endpoint"]
    query_string = urlencode({key: value for key, value in query.items() if value is not None})
    suffix = f"?{query_string}" if query_string else ""
    return (
        f"{scheme}://{quote(userinfo, safe=':')}@{endpoint['host']}:{endpoint['port']}"
        f"{suffix}#{quote(label)}"
    )


def shadowsocks_plugin_fields(hints: dict[str, Any]) -> dict[str, str] | None:
    plugin = hints.get("plugin")
    plugin_opts = hints.get("pluginOpts") or hints.get("plugin_opts") or hints.get("plugin-opts")
    if not plugin:
        return None
    return {
        "plugin": str(plugin),
        "plugin_opts": str(plugin_opts or ""),
    }


def shadowsocks_plugin_query(hints: dict[str, Any]) -> dict[str, str]:
    plugin = shadowsocks_plugin_fields(hints)
    if not plugin:
        return {}
    value = plugin["plugin"]
    if plugin["plugin_opts"]:
        value = f"{value};{plugin['plugin_opts']}"
    return {"plugin": value}


def render_mihomo_yaml(manifest: dict[str, Any], *, settings: Settings) -> str:
    proxies = [
        proxy
        for entry in iter_protocol_entries(manifest)
        if (proxy := mihomo_proxy(entry, settings=settings)) is not None
    ]
    names = [proxy["name"] for proxy in proxies]
    lines = [
        "mixed-port: 7890",
        "allow-lan: false",
        "mode: rule",
        "log-level: warning",
        "proxies:",
    ]
    if not proxies:
        lines.append("  []")
    for proxy in proxies:
        lines.extend(yaml_object(proxy, indent=2, list_item=True))
    lines.extend(
        [
            "proxy-groups:",
            "  - name: Lumen",
            "    type: select",
            "    proxies:",
            *[f"      - {yaml_scalar(name)}" for name in names],
            "rules:",
            "  - MATCH,Lumen",
            "",
        ]
    )
    return "\n".join(lines)


def manifest_has_mihomo_proxy(manifest: dict[str, Any], *, settings: Settings) -> bool:
    return any(
        mihomo_proxy(entry, settings=settings) is not None
        for entry in iter_protocol_entries(manifest)
    )


def mihomo_proxy(entry: dict[str, Any], *, settings: Settings) -> dict[str, Any] | None:
    protocol = entry["protocol"]
    protocol_type = normalize_protocol_type(protocol.get("type"))
    credentials = derive_credentials(
        settings=settings,
        manifest=entry["manifest"],
        protocol=protocol,
    )
    security = protocol.get("security", {})
    base = {
        "name": node_label(entry),
        "type": protocol_type,
        "server": protocol["endpoint"]["host"],
        "port": protocol["endpoint"]["port"],
        "network": network_type(protocol),
    }

    if protocol_type == "vless":
        base.update(
            {
                "uuid": credentials.uuid,
                "udp": True,
                "tls": security_name(protocol) != "none",
            }
        )
        if protocol.get("flow"):
            base["flow"] = protocol["flow"]
        add_mihomo_transport_fields(base, protocol)
        add_mihomo_tls_fields(base, security, protocol.get("rendererHints", {}))
        return base

    if protocol_type == "vmess":
        base.update(
            {
                "uuid": credentials.uuid,
                "alterId": 0,
                "cipher": "auto",
                "udp": True,
                "tls": security_name(protocol) != "none",
            }
        )
        add_mihomo_transport_fields(base, protocol)
        add_mihomo_tls_fields(base, security, protocol.get("rendererHints", {}))
        return base

    if protocol_type == "trojan":
        base.update({"password": credentials.password, "udp": True, "tls": True})
        add_mihomo_transport_fields(base, protocol)
        add_mihomo_tls_fields(base, security, protocol.get("rendererHints", {}))
        return base

    if protocol_type == "shadowsocks":
        hints = protocol.get("rendererHints", {})
        method = shadowsocks_method(protocol)
        base.update(
            {
                "type": "ss",
                "cipher": method,
                "password": shadowsocks_password_for_method(credentials, str(method)),
                "udp": True,
            }
        )
        plugin = shadowsocks_plugin_fields(hints)
        if plugin:
            base.update({"plugin": plugin["plugin"], "plugin-opts": plugin["plugin_opts"]})
        return base

    if protocol_type == "hysteria2":
        hints = protocol.get("rendererHints", {})
        base.update({"password": credentials.hysteria_password, "udp": True})
        if security.get("serverName"):
            base["sni"] = security["serverName"]
        if hints.get("obfs"):
            base["obfs"] = str(hints["obfs"])
            base["obfs-password"] = credentials.hysteria_obfs_password
        return base

    if protocol_type == "tuic":
        base.update(
            {
                "uuid": credentials.uuid,
                "password": credentials.password,
                "udp": True,
                "congestion-controller": "bbr",
                "alpn": ["h3"],
            }
        )
        if security.get("serverName"):
            base["sni"] = security["serverName"]
        return base

    if protocol_type == "naive":
        base.update(
            {
                "username": protocol_username(entry),
                "password": credentials.password,
                "tls": True,
            }
        )
        add_mihomo_tls_fields(base, security, protocol.get("rendererHints", {}))
        return base

    if protocol_type == "wireguard":
        hints = protocol.get("rendererHints", {})
        client_address = hints.get("address")
        if not client_address or not security.get("publicKey"):
            return None
        base.update(
            {
                "private-key": credentials.wireguard_private_key,
                "public-key": security["publicKey"],
                "ip": str(client_address).split(",")[0].split("/")[0].strip(),
                "udp": True,
            }
        )
        if hints.get("mtu"):
            base["mtu"] = hints["mtu"]
        return base

    if protocol_type == "socks":
        base.update(
            {
                "type": "socks5",
                "username": protocol_username(entry),
                "password": credentials.password,
                "udp": True,
            }
        )
        return base

    if protocol_type == "http":
        base.update(
            {
                "username": protocol_username(entry),
                "password": credentials.password,
            }
        )
        return base

    return None


def add_mihomo_tls_fields(
    output: dict[str, Any],
    security: dict[str, Any],
    hints: dict[str, Any] | None = None,
) -> None:
    hints = hints or {}
    if security.get("serverName"):
        output["servername"] = security["serverName"]
        output["sni"] = security["serverName"]
    output["skip-cert-verify"] = bool(security.get("allowInsecure", False))
    if security.get("fingerprint"):
        output["client-fingerprint"] = security["fingerprint"]
    if security.get("alpn"):
        output["alpn"] = security["alpn"]
    if security.get("type") == "reality":
        reality = {
            "public-key": hints.get("mihomoX25519PublicKey") or security.get("publicKey")
        }
        if security.get("shortId") is not None:
            reality["short-id"] = security.get("shortId")
        output["reality-opts"] = {key: value for key, value in reality.items() if value is not None}


def render_sing_box_config(manifest: dict[str, Any], *, settings: Settings) -> dict[str, Any]:
    outbounds = [
        outbound
        for entry in iter_protocol_entries(manifest)
        if (outbound := sing_box_outbound(entry, settings=settings)) is not None
    ]
    selector_tags = [outbound["tag"] for outbound in outbounds]
    outbounds.append({"type": "selector", "tag": "Lumen", "outbounds": selector_tags})
    return {
        "log": {"level": "warn"},
        "dns": {"servers": [{"tag": "cloudflare", "address": "1.1.1.1"}]},
        "inbounds": [
            {"type": "tun", "tag": "tun-in", "address": ["172.19.0.1/30"], "auto_route": True}
        ],
        "outbounds": outbounds,
        "route": {"final": "Lumen", "auto_detect_interface": True},
    }


def has_non_selector_outbound(config: dict[str, Any]) -> bool:
    return any(
        isinstance(outbound, dict) and outbound.get("type") != "selector"
        for outbound in config.get("outbounds", [])
    )


def sing_box_outbound(entry: dict[str, Any], *, settings: Settings) -> dict[str, Any] | None:
    protocol = entry["protocol"]
    if is_openvpn_shadowsocks_protocol(protocol):
        return None
    protocol_type = normalize_protocol_type(protocol.get("type"))
    credentials = derive_credentials(
        settings=settings,
        manifest=entry["manifest"],
        protocol=protocol,
    )
    base = {
        "type": protocol_type,
        "tag": node_label(entry),
        "server": protocol["endpoint"]["host"],
        "server_port": protocol["endpoint"]["port"],
    }
    if protocol_type in {"vless", "vmess", "trojan"} and network_type(protocol) == "xhttp":
        return None

    if protocol_type == "vless":
        base.update(
            {
                "uuid": credentials.uuid,
                "flow": protocol.get("flow"),
                "tls": sing_box_tls(protocol),
                "transport": sing_box_transport(protocol),
            }
        )
        return compact_object(base)
    if protocol_type == "vmess":
        base.update(
            {
                "uuid": credentials.uuid,
                "security": "auto",
                "alter_id": 0,
                "tls": sing_box_tls(protocol),
                "transport": sing_box_transport(protocol),
            }
        )
        return compact_object(base)
    if protocol_type == "trojan":
        base.update(
            {
                "password": credentials.password,
                "tls": sing_box_tls(protocol),
                "transport": sing_box_transport(protocol),
            }
        )
        return compact_object(base)
    if protocol_type == "shadowsocks":
        hints = protocol.get("rendererHints", {})
        method = shadowsocks_method(protocol)
        base.update(
            {
                "method": method,
                "password": shadowsocks_password_for_method(credentials, str(method)),
            }
        )
        plugin = shadowsocks_plugin_fields(hints)
        if plugin:
            base.update(plugin)
        return compact_object(base)
    if protocol_type == "hysteria2":
        hints = protocol.get("rendererHints", {})
        base.update({"password": credentials.hysteria_password, "tls": sing_box_tls(protocol)})
        if hints.get("obfs"):
            base["obfs"] = {
                "type": str(hints["obfs"]),
                "password": credentials.hysteria_obfs_password,
            }
        return compact_object(base)
    if protocol_type == "tuic":
        base.update(
            {
                "uuid": credentials.uuid,
                "password": credentials.password,
                "congestion_control": "bbr",
                "tls": sing_box_tls(protocol),
            }
        )
        return compact_object(base)
    if protocol_type == "naive":
        base.update(
            {
                "username": protocol_username(entry),
                "password": credentials.password,
                "tls": sing_box_tls(protocol),
            }
        )
        return compact_object(base)
    if protocol_type == "wireguard":
        security = protocol.get("security", {})
        hints = protocol.get("rendererHints", {})
        client_address = hints.get("address")
        if not client_address or not security.get("publicKey"):
            return None
        base.update(
            {
                "local_address": [
                    str(addr).strip()
                    for addr in str(client_address).split(",")
                    if str(addr).strip()
                ],
                "private_key": credentials.wireguard_private_key,
                "peer_public_key": security["publicKey"],
                "mtu": hints.get("mtu"),
            }
        )
        return compact_object(base)
    if protocol_type == "socks":
        base.update(
            {
                "type": "socks",
                "version": "5",
                "username": protocol_username(entry),
                "password": credentials.password,
            }
        )
        return compact_object(base)
    if protocol_type == "http":
        base.update({"username": protocol_username(entry), "password": credentials.password})
        return compact_object(base)
    return None


def sing_box_tls(protocol: dict[str, Any]) -> dict[str, Any] | None:
    security = protocol.get("security", {})
    if security.get("type") == "none":
        return None
    tls = {
        "enabled": True,
        "server_name": security.get("serverName"),
        "alpn": security.get("alpn") or None,
        "insecure": bool(security.get("allowInsecure", False)),
    }
    if security.get("fingerprint"):
        tls["utls"] = {"enabled": True, "fingerprint": security["fingerprint"]}
    if security.get("type") == "reality":
        tls["reality"] = compact_object(
            {
                "enabled": True,
                "public_key": security.get("publicKey"),
                "short_id": security.get("shortId"),
            }
        )
    return compact_object(tls)


def render_xray_json(manifest: dict[str, Any], *, settings: Settings) -> dict[str, Any]:
    outbounds = [
        outbound
        for entry in iter_protocol_entries(manifest)
        if (outbound := xray_outbound(entry, settings=settings)) is not None
    ]
    return {
        "log": {"loglevel": "warning"},
        "inbounds": [
            {"tag": "socks-in", "listen": "127.0.0.1", "port": 10808, "protocol": "socks"}
        ],
        "outbounds": outbounds,
        "routing": {"rules": []},
    }


def xray_outbound(entry: dict[str, Any], *, settings: Settings) -> dict[str, Any] | None:
    protocol = entry["protocol"]
    if is_openvpn_shadowsocks_protocol(protocol):
        return None
    protocol_type = normalize_protocol_type(protocol.get("type"))
    credentials = derive_credentials(
        settings=settings,
        manifest=entry["manifest"],
        protocol=protocol,
    )
    stream_settings = xray_stream_settings(protocol)

    if protocol_type == "vless":
        return compact_object(
            {
                "tag": node_label(entry),
                "protocol": "vless",
                "settings": {
                    "vnext": [
                        {
                            "address": protocol["endpoint"]["host"],
                            "port": protocol["endpoint"]["port"],
                            "users": [
                                {
                                    "id": credentials.uuid,
                                    "encryption": "none",
                                    "flow": protocol.get("flow"),
                                }
                            ],
                        }
                    ]
                },
                "streamSettings": stream_settings,
            }
        )

    if protocol_type == "vmess":
        return compact_object(
            {
                "tag": node_label(entry),
                "protocol": "vmess",
                "settings": {
                    "vnext": [
                        {
                            "address": protocol["endpoint"]["host"],
                            "port": protocol["endpoint"]["port"],
                            "users": [
                                {
                                    "id": credentials.uuid,
                                    "alterId": 0,
                                    "security": "auto",
                                }
                            ],
                        }
                    ]
                },
                "streamSettings": stream_settings,
            }
        )

    if protocol_type == "trojan":
        return {
            "tag": node_label(entry),
            "protocol": "trojan",
            "settings": {
                "servers": [
                    {
                        "address": protocol["endpoint"]["host"],
                        "port": protocol["endpoint"]["port"],
                        "password": credentials.password,
                    }
                ]
            },
            "streamSettings": stream_settings,
        }

    if protocol_type == "shadowsocks":
        hints = protocol.get("rendererHints", {})
        method = shadowsocks_method(protocol)
        server = {
            "address": protocol["endpoint"]["host"],
            "port": protocol["endpoint"]["port"],
            "method": method,
            "password": shadowsocks_password_for_method(credentials, str(method)),
        }
        plugin = shadowsocks_plugin_fields(hints)
        if plugin:
            server.update(plugin)
        return {
            "tag": node_label(entry),
            "protocol": "shadowsocks",
            "settings": {
                "servers": [server]
            },
        }

    if protocol_type == "wireguard":
        security = protocol.get("security", {})
        hints = protocol.get("rendererHints", {})
        client_address = hints.get("address")
        if not client_address or not security.get("publicKey"):
            return None
        allowed_ips = [
            value.strip()
            for value in str(hints.get("allowedIps") or "0.0.0.0/0").split(",")
            if value.strip()
        ]
        return compact_object(
            {
                "tag": node_label(entry),
                "protocol": "wireguard",
                "settings": {
                    "secretKey": credentials.wireguard_private_key,
                    "address": [
                        addr.strip()
                        for addr in str(client_address).split(",")
                        if addr.strip()
                    ],
                    "peers": [
                        {
                            "publicKey": security["publicKey"],
                            "endpoint": (
                                f"{protocol['endpoint']['host']}:"
                                f"{protocol['endpoint']['port']}"
                            ),
                            "allowedIPs": allowed_ips,
                        }
                    ],
                    "mtu": hints.get("mtu"),
                },
            }
        )

    if protocol_type == "socks":
        return {
            "tag": node_label(entry),
            "protocol": "socks",
            "settings": {
                "servers": [
                    {
                        "address": protocol["endpoint"]["host"],
                        "port": protocol["endpoint"]["port"],
                        "users": [
                            {
                                "user": protocol_username(entry),
                                "pass": credentials.password,
                            }
                        ],
                    }
                ]
            },
        }

    if protocol_type == "http":
        return {
            "tag": node_label(entry),
            "protocol": "http",
            "settings": {
                "servers": [
                    {
                        "address": protocol["endpoint"]["host"],
                        "port": protocol["endpoint"]["port"],
                        "users": [
                            {
                                "user": protocol_username(entry),
                                "pass": credentials.password,
                            }
                        ],
                    }
                ]
            },
        }

    if protocol_type == "naive":
        return None

    return None


def xray_stream_settings(protocol: dict[str, Any]) -> dict[str, Any]:
    security = protocol.get("security", {})
    stream = {"network": network_type(protocol), "security": security_name(protocol)}
    stream.update(xray_transport_settings(protocol))
    if security.get("type") == "reality":
        stream["realitySettings"] = compact_object(
            {
                "serverName": security.get("serverName"),
                "fingerprint": security.get("fingerprint"),
                "publicKey": security.get("publicKey"),
                "shortId": security.get("shortId"),
                "spiderX": security.get("spiderX"),
            }
        )
    elif security.get("type") == "tls":
        stream["tlsSettings"] = compact_object(
            {
                "serverName": security.get("serverName"),
                "alpn": security.get("alpn") or None,
                "pinnedPeerCertSha256": security.get("pinnedPeerCertSha256"),
            }
        )
    return stream


def _add_share_transport_query(query: dict[str, str], protocol: dict[str, Any]) -> None:
    transport = network_type(protocol)
    if transport in {"ws", "httpupgrade", "xhttp"} and protocol.get("path"):
        query["path"] = str(protocol["path"])
    if transport == "grpc" and protocol.get("serviceName"):
        query["serviceName"] = str(protocol["serviceName"])
    if transport == "xhttp":
        query["mode"] = str(protocol.get("mode") or "auto")


def sing_box_transport(protocol: dict[str, Any]) -> dict[str, Any] | None:
    transport = network_type(protocol)
    if transport == "tcp":
        return None
    if transport == "ws":
        return compact_object({"type": "ws", "path": protocol.get("path") or "/"})
    if transport == "grpc":
        return compact_object(
            {"type": "grpc", "service_name": protocol.get("serviceName") or "lumen"}
        )
    if transport == "httpupgrade":
        return compact_object({"type": "httpupgrade", "path": protocol.get("path") or "/"})
    return None


def add_mihomo_transport_fields(output: dict[str, Any], protocol: dict[str, Any]) -> None:
    transport = network_type(protocol)
    if transport in {"ws", "httpupgrade"} and protocol.get("path"):
        output["ws-opts"] = {"path": protocol["path"]}
    elif transport == "grpc":
        output["grpc-opts"] = {"grpc-service-name": protocol.get("serviceName") or "lumen"}
    elif transport == "xhttp":
        output["xhttp-opts"] = {
            "path": protocol.get("path") or "/",
            "mode": protocol.get("mode") or "auto",
        }


def xray_transport_settings(protocol: dict[str, Any]) -> dict[str, Any]:
    transport = network_type(protocol)
    path = str(protocol.get("path") or "/")
    if transport == "ws":
        return {"wsSettings": {"path": path}}
    if transport == "grpc":
        return {"grpcSettings": {"serviceName": protocol.get("serviceName") or "lumen"}}
    if transport == "httpupgrade":
        return {"httpupgradeSettings": {"path": path}}
    if transport == "xhttp":
        return {
            "xhttpSettings": {
                "path": path,
                "mode": str(protocol.get("mode") or "auto"),
            }
        }
    return {}


def derive_credentials(
    *,
    settings: Settings,
    manifest: dict[str, Any],
    protocol: dict[str, Any],
) -> ClientCredential:
    return derive_client_credentials(
        settings=settings,
        subscription_id=manifest.get("subscription", {}).get("id"),
        credentials_ref=protocol.get("credentialsRef"),
        protocol_id=protocol.get("id"),
        protocol_type=protocol.get("type"),
    )


def derive_client_credentials(
    *,
    settings: Settings,
    subscription_id: object,
    credentials_ref: object,
    protocol_id: object,
    protocol_type: object,
) -> ClientCredential:
    """Deterministically derive a user's per-protocol credentials.

    Both the client subscription renderer and the node-side config resolver call
    this with the same inputs, so the credentials embedded in the client config
    and the node config are guaranteed to match.
    """

    seed = _credential_seed(settings)
    base = f"{subscription_id}|{credentials_ref}|{protocol_id}|{protocol_type}"
    uuid_bytes = hmac.new(seed, f"{base}|uuid".encode(), hashlib.sha256).digest()[:16]
    mutable = bytearray(uuid_bytes)
    mutable[6] = (mutable[6] & 0x0F) | 0x40
    mutable[8] = (mutable[8] & 0x3F) | 0x80
    password = _secret_text(seed, f"{base}|password", 24)
    wireguard_private_key, wireguard_public_key = _derive_wireguard_keypair(seed, base)
    return ClientCredential(
        uuid=str(UUID(bytes=bytes(mutable))),
        password=password,
        shadowsocks_password=_secret_text(seed, f"{base}|ss", 32),
        shadowsocks_2022_password=base64.b64encode(
            hmac.new(seed, f"{base}|ss-2022-aes128".encode(), hashlib.sha256).digest()[:16]
        ).decode("ascii"),
        hysteria_password=_secret_text(seed, f"{base}|hy2", 24),
        hysteria_obfs_password=_secret_text(seed, f"{base}|hy2-obfs", 24),
        wireguard_private_key=wireguard_private_key,
        wireguard_public_key=wireguard_public_key,
    )


def shadowsocks_password_for_method(credentials: ClientCredential, method: str) -> str:
    if method == "2022-blake3-aes-128-gcm":
        return credentials.shadowsocks_2022_password
    return credentials.shadowsocks_password


def _derive_wireguard_keypair(seed: bytes, base: str) -> tuple[str, str]:
    raw = hmac.new(seed, f"{base}|wg".encode(), hashlib.sha256).digest()
    private = x25519.X25519PrivateKey.from_private_bytes(raw)
    private_b64 = base64.b64encode(
        private.private_bytes(
            serialization.Encoding.Raw,
            serialization.PrivateFormat.Raw,
            serialization.NoEncryption(),
        )
    ).decode("ascii")
    public_b64 = base64.b64encode(
        private.public_key().public_bytes(
            serialization.Encoding.Raw,
            serialization.PublicFormat.Raw,
        )
    ).decode("ascii")
    return private_b64, public_b64


def _credential_seed(settings: Settings) -> bytes:
    for candidate in (
        settings.api_key_hash_pepper,
        settings.session_hash_pepper,
        settings.node_token_hash_pepper,
        settings.bootstrap_admin_api_key,
    ):
        if candidate is not None:
            return candidate.get_secret_value().encode("utf-8")
    if settings.is_production:
        raise APIError(
            code="subscription_renderer_secret_missing",
            message="Subscription renderer secret is not configured.",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    return b"lumen-local-subscription-renderer"


def _secret_text(seed: bytes, label: str, length: int) -> str:
    digest = hmac.new(seed, label.encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")[:length]


def iter_protocol_entries(manifest: dict[str, Any]):
    for node in manifest.get("nodes", []):
        for index, protocol in enumerate(node.get("protocols", [])):
            yield {"manifest": manifest, "node": node, "protocol": protocol, "index": index}


def node_label(entry: dict[str, Any], *, with_country_flag: bool = False) -> str:
    node = entry["node"]
    protocol = entry["protocol"]
    label = str(
        protocol.get("rendererHints", {}).get("name")
        or node.get("displayName")
        or node["id"]
    )
    if with_country_flag:
        label = add_country_flag(label, node)
    return label


def is_happ_render(entry: dict[str, Any]) -> bool:
    manifest = entry.get("manifest", {})
    metadata = manifest.get("metadata", {}) if isinstance(manifest, dict) else {}
    return str(metadata.get("activeRenderTarget") or "").lower() == "happ"


def add_country_flag(label: str, node: dict[str, Any]) -> str:
    stripped = label.strip()
    if starts_with_regional_indicator(stripped):
        return stripped
    country = country_code_from_node(node, stripped)
    if country is None:
        return stripped
    return f"{country_flag(country)} {stripped}"


def starts_with_regional_indicator(value: str) -> bool:
    if len(value) < 2:
        return False
    return all(0x1F1E6 <= ord(char) <= 0x1F1FF for char in value[:2])


def country_code_from_node(node: dict[str, Any], label: str) -> str | None:
    candidates = [
        node.get("country"),
        node.get("countryCode"),
        node.get("region"),
        node.get("location"),
        label.split(" ", 1)[0] if label else None,
    ]
    for candidate in candidates:
        code = normalize_country_code(candidate)
        if code is not None:
            return code
    return None


def normalize_country_code(value: object) -> str | None:
    if value is None:
        return None
    raw = str(value).strip().upper()
    if len(raw) == 2 and raw.isalpha():
        return raw
    country_aliases = {
        "NETHERLANDS": "NL",
        "NL": "NL",
        "AMSTERDAM": "NL",
        "GERMANY": "DE",
        "DEUTSCHLAND": "DE",
        "DE": "DE",
        "FRANCE": "FR",
        "FR": "FR",
        "UNITED STATES": "US",
        "USA": "US",
        "US": "US",
        "UNITED KINGDOM": "GB",
        "UK": "GB",
        "GB": "GB",
        "RUSSIA": "RU",
        "RU": "RU",
    }
    return country_aliases.get(raw)


def country_flag(country_code: str) -> str:
    base = 0x1F1E6
    return "".join(chr(base + ord(char) - ord("A")) for char in country_code)


def normalize_protocol_type(value: object) -> str:
    raw = str(value or "")
    if raw.startswith("vless"):
        return "vless"
    if raw.startswith("trojan"):
        return "trojan"
    if raw.startswith("vmess"):
        return "vmess"
    if raw.startswith("shadowsocks"):
        return "shadowsocks"
    if raw.startswith("hysteria2"):
        return "hysteria2"
    if raw.startswith("ikev2") or raw.startswith("ipsec"):
        return "ikev2"
    if raw.startswith("tuic"):
        return "tuic"
    if raw.startswith("naive"):
        return "naive"
    if raw.startswith("openvpn"):
        return "openvpn"
    if raw.startswith("wireguard"):
        return "wireguard"
    if raw.startswith("socks"):
        return "socks"
    if raw.startswith("http"):
        return "http"
    return raw


def shadowsocks_method(protocol: dict[str, Any]) -> object:
    if (
        protocol.get("adapter") == "shadowsocks-2022"
        or protocol.get("type") == "shadowsocks-2022"
    ):
        return "2022-blake3-aes-128-gcm"
    hints = protocol.get("rendererHints", {})
    return hints.get("method") or DEFAULT_SHADOWSOCKS_METHOD


def protocol_username(entry: dict[str, Any]) -> str:
    manifest = entry.get("manifest", {})
    subscription = manifest.get("subscription", {}) if isinstance(manifest, dict) else {}
    value = subscription.get("id")
    return str(value or "lumen")


def network_type(protocol: dict[str, Any]) -> str:
    endpoint = protocol.get("endpoint", {})
    transport = str(endpoint.get("transport") or "tcp").lower()
    return "tcp" if transport in {"raw", "tcp"} else transport


def security_name(protocol: dict[str, Any]) -> str:
    security = protocol.get("security", {})
    return str(security.get("type") or "none")


def compact_object(value: dict[str, Any]) -> dict[str, Any]:
    return {
        key: child
        for key, child in value.items()
        if child is not None and child != [] and child != {}
    }


def yaml_object(value: dict[str, Any], *, indent: int, list_item: bool = False) -> list[str]:
    lines: list[str] = []
    prefix = " " * indent
    first_prefix = f"{prefix}- " if list_item else prefix
    child_prefix = " " * (indent + (2 if list_item else 0))
    first = True
    for key, child in value.items():
        current_prefix = first_prefix if first else child_prefix
        first = False
        if isinstance(child, dict):
            lines.append(f"{current_prefix}{key}:")
            lines.extend(yaml_object(child, indent=indent + (4 if list_item else 2)))
        elif isinstance(child, list):
            lines.append(f"{current_prefix}{key}:")
            lines.extend(f"{child_prefix}  - {yaml_scalar(item)}" for item in child)
        else:
            lines.append(f"{current_prefix}{key}: {yaml_scalar(child)}")
    return lines


def yaml_scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return str(value)
    return json.dumps(str(value), ensure_ascii=False)


def _unix_timestamp(value: object) -> int:
    if not value:
        return 0
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return 0
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return int(parsed.timestamp())


def _bytes_from_gb(value: object) -> int:
    try:
        parsed = float(str(value))
    except (TypeError, ValueError):
        return 0
    return max(0, int(parsed * 1024 * 1024 * 1024))


def _base64_header_value(value: str) -> str:
    return f"base64:{base64.b64encode(value.encode('utf-8')).decode('ascii')}"
