import json
import os
import socket
import time
import urllib.error
import urllib.request


BASE = "https://panel.89-185-85-184.sslip.io/api/v1"
SUB_BASE = "https://sub.89-185-85-184.sslip.io/sub/lumen_sub_eXUbxmeZ0TcnL4rILpK03g"
NODE_HOST = "85.192.60.8"
PUBLIC_ID = "lumen_sub_eXUbxmeZ0TcnL4rILpK03g"
KEY = os.environ["LUMEN_BOOTSTRAP_ADMIN_API_KEY"]
HEADERS = {"X-Lumen-Api-Key": KEY, "Content-Type": "application/json"}
TLS_SECURITY = {
    "type": "tls",
    "serverName": "panel.89-185-85-184.sslip.io",
    "certificates": [
        {
            "certificateFile": "/var/lib/lumen-node/runtime/tls/live.crt",
            "keyFile": "/var/lib/lumen-node/runtime/tls/live.key",
        }
    ],
}


def request(method, path, body=None, base=BASE, raw=False):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        base + path,
        data=data,
        method=method,
        headers=HEADERS if base == BASE else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            payload = resp.read()
            if raw:
                return resp.status, dict(resp.headers), payload
            return json.loads(payload.decode() or "{}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"{method} {path} -> {exc.code}: {detail[:700]}") from exc


def find_subscription():
    for sub in request("GET", "/subscriptions")["items"]:
        if sub.get("public_id") == PUBLIC_ID:
            return sub
    raise RuntimeError("subscription not found")


def find_node():
    for node in request("GET", "/nodes")["items"]:
        if node.get("name") == "node-01" or node.get("public_address") == NODE_HOST:
            return node
    raise RuntimeError("node not found")


def build_variants():
    keypair = request("POST", "/tools/x25519-keypair")
    reality_security = {
        "type": "reality",
        "serverName": "www.cloudflare.com",
        "dest": "www.cloudflare.com:443",
        "fingerprint": "chrome",
        "privateKey": keypair["private_key"],
        "publicKey": keypair["public_key"],
        "shortId": "6d6f7a31",
        "spiderX": "/",
    }
    return [
        {
            "adapter": "vless-reality-grpc",
            "port": 18477,
            "config": {
                "network": "grpc",
                "serviceName": "lumen-reality-grpc",
                "security": reality_security,
            },
            "security": "reality",
            "transport": "grpc",
        },
        {
            "adapter": "vless-reality-xhttp",
            "port": 18478,
            "config": {
                "network": "xhttp",
                "path": "/reality-xhttp",
                "mode": "auto",
                "security": reality_security,
            },
            "security": "reality",
            "transport": "xhttp",
        },
        {
            "adapter": "vless-ws-tls",
            "port": 18479,
            "config": {
                "network": "ws",
                "path": "/vless-ws",
                "host": "panel.89-185-85-184.sslip.io",
                "security": TLS_SECURITY,
            },
            "security": "tls",
            "transport": "ws",
        },
        {
            "adapter": "vless-grpc-tls",
            "port": 18480,
            "config": {
                "network": "grpc",
                "serviceName": "lumen-vless-grpc",
                "security": TLS_SECURITY,
            },
            "security": "tls",
            "transport": "grpc",
        },
        {
            "adapter": "vless-httpupgrade-tls",
            "port": 18481,
            "config": {
                "network": "httpupgrade",
                "path": "/vless-hu",
                "host": "panel.89-185-85-184.sslip.io",
                "security": TLS_SECURITY,
            },
            "security": "tls",
            "transport": "httpupgrade",
        },
        {
            "adapter": "vless-ws",
            "port": 18482,
            "config": {
                "network": "ws",
                "path": "/vless-ws-plain",
                "host": "panel.89-185-85-184.sslip.io",
            },
            "security": "none",
            "transport": "ws",
        },
    ]


def upsert_profile(node_id, variant):
    name = f"live-{variant['adapter']}-matrix"
    payload = {
        "name": name,
        "node_id": node_id,
        "adapter": variant["adapter"],
        "status": "active",
        "config_json": variant["config"],
        "port_reservations": [
            {
                "address": "0.0.0.0",
                "port": variant["port"],
                "protocol": "tcp",
                "exclusive": True,
            }
        ],
        "credentials_ref": f"vault://subscriptions/live-{variant['adapter']}/creds",
        "metadata_json": {"liveValidation": True, "matrix": "vless-transports"},
        "allow_port_conflicts": True,
    }
    for profile in request("GET", "/profiles")["items"]:
        if profile.get("name") == name:
            return request("PATCH", f"/profiles/{profile['id']}", payload)
    return request("POST", "/profiles", payload)


def wait_command(node_id, command_id):
    for _ in range(90):
        for command in request("GET", f"/nodes/{node_id}/commands")["items"]:
            if command.get("id") == command_id and command.get("status") in {
                "succeeded",
                "failed",
            }:
                return command
        time.sleep(1)
    raise RuntimeError("command did not finish")


def tcp_reachable(port):
    with socket.create_connection((NODE_HOST, port), timeout=7):
        return True


def xray_transport_settings(stream, transport):
    if transport == "ws":
        return stream.get("wsSettings") or {}
    if transport == "grpc":
        return stream.get("grpcSettings") or {}
    if transport == "httpupgrade":
        return stream.get("httpupgradeSettings") or {}
    if transport == "xhttp":
        return stream.get("xhttpSettings") or {}
    return {}


def validate_renders(variant):
    status, _headers, raw_body = request("GET", "/happ", base=SUB_BASE, raw=True)
    happ = raw_body.decode(errors="replace")
    if status != 200 or variant["adapter"].split("-")[0] not in happ.lower():
        raise RuntimeError(f"bad happ render for {variant['adapter']}: status={status}")

    status, _headers, body = request("GET", "/lumen-json", base=SUB_BASE, raw=True)
    lumen = json.loads(body.decode())
    first = lumen["nodes"][0]["protocols"][0]
    if first.get("type") != variant["adapter"]:
        raise RuntimeError(f"bad lumen-json protocol for {variant['adapter']}: {first.get('type')}")
    endpoint = first.get("endpoint") or {}
    if endpoint.get("transport") != variant["transport"]:
        raise RuntimeError(f"bad lumen-json transport for {variant['adapter']}: {endpoint.get('transport')}")
    lumen_bytes = len(body)

    status, _headers, body = request("GET", "/xray-json", base=SUB_BASE, raw=True)
    xray = json.loads(body.decode())
    outbound = xray["outbounds"][0]
    stream = outbound["streamSettings"]
    if stream.get("network") != variant["transport"]:
        raise RuntimeError(f"bad xray network for {variant['adapter']}: {stream}")
    if stream.get("security") != variant["security"]:
        raise RuntimeError(f"bad xray security for {variant['adapter']}: {stream}")
    if not xray_transport_settings(stream, variant["transport"]):
        raise RuntimeError(f"missing xray transport settings for {variant['adapter']}: {stream}")
    if variant["security"] == "reality":
        reality = stream.get("realitySettings") or {}
        if not reality.get("publicKey") or not reality.get("shortId"):
            raise RuntimeError(f"missing xray reality settings for {variant['adapter']}: {stream}")

    status, _headers, mihomo_body = request("GET", "/mihomo", base=SUB_BASE, raw=True)
    mihomo = mihomo_body.decode(errors="replace")
    if status != 200 or variant["transport"] not in mihomo:
        raise RuntimeError(f"bad mihomo render for {variant['adapter']}: status={status}")

    return {
        "happ_bytes": len(raw_body),
        "lumen_bytes": lumen_bytes,
        "xray_network": stream.get("network"),
        "xray_security": stream.get("security"),
        "mihomo_bytes": len(mihomo_body),
    }


def apply_variant(node, sub, variant):
    profile = upsert_profile(node["id"], variant)
    delivery = {
        "profile_id": profile["id"],
        "protocol": variant["adapter"],
        "adapter": variant["adapter"],
        "profile_title": f"Lumen {variant['adapter']} Live",
        "port": str(variant["port"]),
        "security": variant["security"],
        "transport": variant["transport"],
    }
    security = variant["config"].get("security") if isinstance(variant["config"], dict) else {}
    if isinstance(security, dict):
        if security.get("publicKey"):
            delivery["public_key"] = str(security["publicKey"])
        if security.get("shortId"):
            delivery["short_id"] = str(security["shortId"])
        if security.get("serverName"):
            delivery["server_name"] = str(security["serverName"])
    request(
        "PATCH",
        f"/subscriptions/{sub['id']}",
        {
            "node_id": node["id"],
            "delivery_profile": delivery,
            "config_hash": f"sha256:live-{variant['adapter']}",
        },
    )
    apply_response = request("POST", f"/profiles/{profile['id']}/apply-to-node")
    command = wait_command(node["id"], apply_response["command_id"])
    if command.get("status") != "succeeded":
        result = command.get("result_json") if isinstance(command.get("result_json"), dict) else {}
        outputs = result.get("outputs") if isinstance(result.get("outputs"), dict) else {}
        safe_error = {
            "adapter": variant["adapter"],
            "command_id": command.get("id"),
            "status": command.get("status"),
            "error": result.get("error") or outputs.get("error"),
            "implementationStatus": outputs.get("implementationStatus"),
        }
        raise RuntimeError(json.dumps(safe_error, ensure_ascii=False))
    return {
        "adapter": variant["adapter"],
        "port": variant["port"],
        "profile_id": profile["id"],
        "command_status": command.get("status"),
        "tcp_reachable": tcp_reachable(variant["port"]),
        "renders": validate_renders(variant),
    }


def validate_blocked_reality_httpupgrade(node_id):
    try:
        request(
            "POST",
            "/profiles",
            {
                "name": "blocked-vless-reality-httpupgrade-live-check",
                "node_id": node_id,
                "adapter": "vless-reality-httpupgrade",
                "status": "active",
                "config_json": {"network": "httpupgrade"},
                "port_reservations": [
                    {
                        "address": "0.0.0.0",
                        "port": 18483,
                        "protocol": "tcp",
                        "exclusive": True,
                    }
                ],
                "credentials_ref": "vault://subscriptions/blocked-vless-reality-httpupgrade/creds",
                "allow_port_conflicts": True,
            },
        )
    except RuntimeError as exc:
        if "protocol_adapter_not_live" in str(exc) or "422" in str(exc):
            return {
                "adapter": "vless-reality-httpupgrade",
                "status": "blocked",
                "reason": "xray-reality-supports-raw-xhttp-grpc-only",
            }
        raise
    raise RuntimeError("vless-reality-httpupgrade unexpectedly accepted as active")


def main():
    node = find_node()
    sub = find_subscription()
    results = [apply_variant(node, sub, variant) for variant in build_variants()]
    blocked = validate_blocked_reality_httpupgrade(node["id"])
    print(
        json.dumps(
            {"matrix": "vless-transports", "results": results, "blocked": [blocked]},
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
