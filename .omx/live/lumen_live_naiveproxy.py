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
VARIANT = {
    "adapter": "naiveproxy",
    "port": 18476,
    "tls": {
        "cert": "/var/lib/lumen-node/runtime/tls/live.crt",
        "key": "/var/lib/lumen-node/runtime/tls/live.key",
    },
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


def upsert_profile(node_id):
    name = "live-naiveproxy-matrix"
    payload = {
        "name": name,
        "node_id": node_id,
        "adapter": VARIANT["adapter"],
        "status": "active",
        "config_json": {
            "port": VARIANT["port"],
            "network": "tcp",
            "tls": VARIANT["tls"],
        },
        "port_reservations": [
            {
                "address": "0.0.0.0",
                "port": VARIANT["port"],
                "protocol": "tcp",
                "exclusive": True,
            }
        ],
        "credentials_ref": "vault://subscriptions/live-naiveproxy/creds",
        "metadata_json": {"liveValidation": True, "matrix": "naiveproxy"},
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


def validate_renders():
    out = {}
    for target in ["happ", "sing-box", "mihomo", "xray-json", "amnezia", "lumen-json"]:
        status, _headers, body = request("GET", f"/{target}", base=SUB_BASE, raw=True)
        text = body.decode(errors="replace")
        item = {"status": status, "bytes": len(body)}
        if target == "lumen-json":
            obj = json.loads(text)
            first = obj["nodes"][0]["protocols"][0]
            credentials = first.get("credentials") or {}
            item["protocol"] = first.get("type") or first.get("protocol")
            item["has_username"] = bool(credentials.get("username"))
            item["password_len"] = len(credentials.get("password", ""))
        elif target == "sing-box":
            obj = json.loads(text)
            naive = [o for o in obj.get("outbounds", []) if o.get("type") == "naive"]
            item["type"] = naive[0].get("type") if naive else None
            item["has_username"] = bool(naive[0].get("username")) if naive else False
            item["password_len"] = len(naive[0].get("password", "")) if naive else 0
            item["tls_enabled"] = bool(naive[0].get("tls", {}).get("enabled")) if naive else False
        elif target == "mihomo":
            item["contains_naive"] = "type: naive" in text or 'type: "naive"' in text
            item["has_username"] = "username:" in text
            item["has_password"] = "password:" in text
        elif target in {"xray-json", "amnezia"}:
            obj = json.loads(text)
            item["outbounds"] = len(obj.get("outbounds", []))
            item["contains_fake_naive"] = "naive" in text.lower()
        else:
            item["starts_https"] = text.strip().startswith("https://")
            item["contains_port"] = f":{VARIANT['port']}" in text
            item["has_credentials_marker"] = "@" in text and ":" in text.split("@", 1)[0]
        out[target] = item

    if out["lumen-json"].get("protocol") not in {"naive", "naiveproxy"}:
        raise RuntimeError(f"bad lumen-json protocol render: {out['lumen-json']}")
    if not out["lumen-json"].get("has_username") or out["lumen-json"].get("password_len", 0) < 12:
        raise RuntimeError(f"bad lumen-json credentials render: {out['lumen-json']}")
    if out["sing-box"].get("type") != "naive" or not out["sing-box"].get("tls_enabled"):
        raise RuntimeError(f"bad sing-box render: {out['sing-box']}")
    if not out["mihomo"].get("contains_naive"):
        raise RuntimeError(f"bad mihomo render: {out['mihomo']}")
    if not out["happ"].get("starts_https") or not out["happ"].get("contains_port"):
        raise RuntimeError(f"bad happ render: {out['happ']}")
    for target in ["xray-json", "amnezia"]:
        if out[target].get("contains_fake_naive"):
            raise RuntimeError(f"fake unsupported {target} naive render: {out[target]}")
    return out


def main():
    node = find_node()
    sub = find_subscription()
    profile = upsert_profile(node["id"])
    delivery = {
        "profile_id": profile["id"],
        "protocol": VARIANT["adapter"],
        "adapter": VARIANT["adapter"],
        "profile_title": "Lumen NaiveProxy Live",
        "port": str(VARIANT["port"]),
        "tls": "enabled",
    }
    request(
        "PATCH",
        f"/subscriptions/{sub['id']}",
        {
            "node_id": node["id"],
            "delivery_profile": delivery,
            "config_hash": "sha256:live-naiveproxy",
        },
    )
    apply_response = request("POST", f"/profiles/{profile['id']}/apply-to-node")
    command = wait_command(node["id"], apply_response["command_id"])
    if command.get("status") != "succeeded":
        raise RuntimeError(json.dumps(command, ensure_ascii=False)[:1500])
    result = {
        "adapter": VARIANT["adapter"],
        "port": VARIANT["port"],
        "profile_id": profile["id"],
        "command_status": command.get("status"),
        "tcp_reachable": tcp_reachable(VARIANT["port"]),
        "renders": validate_renders(),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
