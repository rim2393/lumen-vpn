from __future__ import annotations

import base64
import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote, urlencode
from uuid import UUID

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
    hysteria_password: str


def render_subscription_for_target(
    manifest: dict[str, Any],
    *,
    settings: Settings,
    target: str | None,
) -> RenderedSubscription:
    normalized_target = normalize_render_target(target)
    headers = build_subscription_headers(manifest)

    if normalized_target == "lumen-json":
        return RenderedSubscription(
            body=f"{json.dumps(manifest, indent=2, ensure_ascii=False)}\n",
            content_type="application/json; charset=utf-8",
            filename="lumen-subscription.json",
            headers=headers,
        )

    if normalized_target in RAW_URI_TARGETS or normalized_target == "v2ray-base64":
        raw = render_raw_uri_subscription(manifest, settings=settings)
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
        return RenderedSubscription(
            body=render_mihomo_yaml(manifest, settings=settings),
            content_type="application/yaml; charset=utf-8",
            filename="lumen-mihomo.yaml",
            headers=headers,
        )

    if normalized_target in SING_BOX_TARGETS:
        body = json.dumps(
            render_sing_box_config(manifest, settings=settings),
            indent=2,
            ensure_ascii=False,
        )
        return RenderedSubscription(
            body=f"{body}\n",
            content_type="application/json; charset=utf-8",
            filename="lumen-sing-box.json",
            headers=headers,
        )

    if normalized_target in XRAY_TARGETS:
        body = json.dumps(
            render_xray_json(manifest, settings=settings),
            indent=2,
            ensure_ascii=False,
        )
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
    return {
        "profile-title": _base64_header_value(title),
        "profile-update-interval": update_interval,
        "subscription-userinfo": userinfo,
    }


def render_raw_uri_subscription(manifest: dict[str, Any], *, settings: Settings) -> str:
    lines = [
        uri
        for entry in iter_protocol_entries(manifest)
        if (uri := render_share_uri(entry, settings=settings)) is not None
    ]
    return "\n".join(lines) + ("\n" if lines else "")


def render_share_uri(entry: dict[str, Any], *, settings: Settings) -> str | None:
    protocol = entry["protocol"]
    protocol_type = normalize_protocol_type(protocol.get("type"))
    credentials = derive_credentials(
        settings=settings,
        manifest=entry["manifest"],
        protocol=protocol,
    )
    label = node_label(entry)

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
        return build_uri("vless", credentials.uuid, protocol, query, label)

    if protocol_type == "trojan":
        security = protocol.get("security", {})
        query = {"type": network_type(protocol), "security": security_name(protocol)}
        if security.get("serverName"):
            query["sni"] = str(security["serverName"])
        return build_uri("trojan", credentials.password, protocol, query, label)

    if protocol_type == "shadowsocks":
        method = protocol.get("rendererHints", {}).get("method") or "2022-blake3-aes-128-gcm"
        userinfo = base64.urlsafe_b64encode(
            f"{method}:{credentials.shadowsocks_password}".encode()
        ).decode("ascii").rstrip("=")
        return build_uri("ss", userinfo, protocol, {}, label)

    if protocol_type == "hysteria2":
        security = protocol.get("security", {})
        query = {}
        if security.get("serverName"):
            query["sni"] = str(security["serverName"])
        return build_uri("hysteria2", credentials.hysteria_password, protocol, query, label)

    return None


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
        f"{scheme}://{quote(userinfo, safe='')}@{endpoint['host']}:{endpoint['port']}"
        f"{suffix}#{quote(label)}"
    )


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
        add_mihomo_tls_fields(base, security)
        return base

    if protocol_type == "trojan":
        base.update({"password": credentials.password, "udp": True, "tls": True})
        add_mihomo_tls_fields(base, security)
        return base

    if protocol_type == "shadowsocks":
        base.update(
            {
                "cipher": protocol.get("rendererHints", {}).get("method")
                or "2022-blake3-aes-128-gcm",
                "password": credentials.shadowsocks_password,
                "udp": True,
            }
        )
        return base

    if protocol_type == "hysteria2":
        base.update({"password": credentials.hysteria_password, "udp": True})
        if security.get("serverName"):
            base["sni"] = security["serverName"]
        return base

    return None


def add_mihomo_tls_fields(output: dict[str, Any], security: dict[str, Any]) -> None:
    if security.get("serverName"):
        output["servername"] = security["serverName"]
        output["sni"] = security["serverName"]
    output["skip-cert-verify"] = bool(security.get("allowInsecure", False))
    if security.get("fingerprint"):
        output["client-fingerprint"] = security["fingerprint"]
    if security.get("alpn"):
        output["alpn"] = security["alpn"]
    if security.get("type") == "reality":
        reality = {"public-key": security.get("publicKey")}
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


def sing_box_outbound(entry: dict[str, Any], *, settings: Settings) -> dict[str, Any] | None:
    protocol = entry["protocol"]
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

    if protocol_type == "vless":
        base.update(
            {
                "uuid": credentials.uuid,
                "flow": protocol.get("flow"),
                "tls": sing_box_tls(protocol),
            }
        )
        return compact_object(base)
    if protocol_type == "trojan":
        base.update({"password": credentials.password, "tls": sing_box_tls(protocol)})
        return compact_object(base)
    if protocol_type == "shadowsocks":
        base.update(
            {
                "method": protocol.get("rendererHints", {}).get("method")
                or "2022-blake3-aes-128-gcm",
                "password": credentials.shadowsocks_password,
            }
        )
        return compact_object(base)
    if protocol_type == "hysteria2":
        base.update({"password": credentials.hysteria_password, "tls": sing_box_tls(protocol)})
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

    return None


def xray_stream_settings(protocol: dict[str, Any]) -> dict[str, Any]:
    security = protocol.get("security", {})
    stream = {"network": network_type(protocol), "security": security_name(protocol)}
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
            {"serverName": security.get("serverName"), "alpn": security.get("alpn") or None}
        )
    return stream


def derive_credentials(
    *,
    settings: Settings,
    manifest: dict[str, Any],
    protocol: dict[str, Any],
) -> ClientCredential:
    seed = _credential_seed(settings)
    base = (
        f"{manifest.get('subscription', {}).get('id')}|"
        f"{protocol.get('credentialsRef')}|{protocol.get('id')}|{protocol.get('type')}"
    )
    uuid_bytes = hmac.new(seed, f"{base}|uuid".encode(), hashlib.sha256).digest()[:16]
    mutable = bytearray(uuid_bytes)
    mutable[6] = (mutable[6] & 0x0F) | 0x40
    mutable[8] = (mutable[8] & 0x3F) | 0x80
    password = _secret_text(seed, f"{base}|password", 24)
    return ClientCredential(
        uuid=str(UUID(bytes=bytes(mutable))),
        password=password,
        shadowsocks_password=_secret_text(seed, f"{base}|ss", 32),
        hysteria_password=_secret_text(seed, f"{base}|hy2", 24),
    )


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


def node_label(entry: dict[str, Any]) -> str:
    node = entry["node"]
    protocol = entry["protocol"]
    return str(
        protocol.get("rendererHints", {}).get("name")
        or node.get("displayName")
        or node["id"]
    )


def normalize_protocol_type(value: object) -> str:
    raw = str(value or "")
    if raw.startswith("vless"):
        return "vless"
    if raw.startswith("trojan"):
        return "trojan"
    if raw.startswith("shadowsocks"):
        return "shadowsocks"
    return raw


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
