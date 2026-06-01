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
    "adapter": "shadowsocks-obfs",
    "port": 18475,
    "method": "aes-256-gcm",
    "server_plugin": "obfs-server",
    "client_plugin": "obfs-local",
    "plugin_opts": "obfs=http;obfs-host=www.bing.com",
    "obfs": "http",
    "obfs_host": "www.bing.com",
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
    name = "live-shadowsocks-obfs-matrix"
    payload = {
        "name": name,
        "node_id": node_id,
        "adapter": VARIANT["adapter"],
        "status": "active",
        "config_json": {
            "port": VARIANT["port"],
            "method": VARIANT["method"],
            "network": "tcp",
            "obfs": VARIANT["obfs"],
            "obfs_host": VARIANT["obfs_host"],
        },
        "port_reservations": [
            {
                "address": "0.0.0.0",
                "port": VARIANT["port"],
                "protocol": "tcp",
                "exclusive": True,
            }
        ],
        "credentials_ref": "vault://subscriptions/live-shadowsocks-obfs/creds",
        "metadata_json": {"liveValidation": True, "matrix": "shadowsocks-obfs"},
        "allow_port_conflicts": True,
    }
    for profile in request("GET", "/profiles")["items"]:
        if profile.get("name") == name:
            return request("PATCH", f"/profiles/{profile['id']}", payload)
    return request("POST", "/profiles", payload)


def wait_command(node_id, command_id):
    for _ in range(60):
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
            hints = first.get("rendererHints", {})
            item["protocol"] = first.get("type") or first.get("protocol")
            item["plugin"] = hints.get("plugin")
            item["plugin_opts"] = hints.get("pluginOpts")
        elif target == "sing-box":
            obj = json.loads(text)
            ss = [o for o in obj.get("outbounds", []) if o.get("type") == "shadowsocks"]
            item["method"] = ss[0].get("method") if ss else None
            item["plugin"] = ss[0].get("plugin") if ss else None
            item["plugin_opts"] = ss[0].get("plugin_opts") if ss else None
            item["password_len"] = len(ss[0].get("password", "")) if ss else 0
        elif target in {"xray-json", "amnezia"}:
            obj = json.loads(text)
            server = obj.get("outbounds", [{}])[0].get("settings", {}).get("servers", [{}])[0]
            item["method"] = server.get("method")
            item["plugin"] = server.get("plugin")
            item["plugin_opts"] = server.get("plugin_opts")
        else:
            item["contains_ss"] = (
                "ss://" in text or "type: ss" in text or 'type: "ss"' in text
            )
            item["contains_plugin"] = VARIANT["client_plugin"] in text
            item["contains_obfs"] = "obfs=http" in text or "obfs%3Dhttp" in text
        out[target] = item

    for target in ["lumen-json", "sing-box", "xray-json", "amnezia"]:
        if out[target].get("plugin") != VARIANT["client_plugin"]:
            raise RuntimeError(f"bad {target} plugin render: {out[target]}")
        if "obfs=http" not in str(out[target].get("plugin_opts")):
            raise RuntimeError(f"bad {target} plugin opts render: {out[target]}")
    for target in ["happ", "mihomo"]:
        if not out[target].get("contains_plugin") or not out[target].get("contains_obfs"):
            raise RuntimeError(f"bad {target} render: {out[target]}")
    return out


def main():
    node = find_node()
    sub = find_subscription()
    profile = upsert_profile(node["id"])
    delivery = {
        "profile_id": profile["id"],
        "protocol": VARIANT["adapter"],
        "adapter": VARIANT["adapter"],
        "profile_title": "Lumen Shadowsocks simple-obfs Live",
        "port": str(VARIANT["port"]),
        "method": VARIANT["method"],
        "plugin": VARIANT["client_plugin"],
        "plugin_opts": VARIANT["plugin_opts"],
        "obfs": VARIANT["obfs"],
    }
    request(
        "PATCH",
        f"/subscriptions/{sub['id']}",
        {
            "node_id": node["id"],
            "delivery_profile": delivery,
            "config_hash": "sha256:live-shadowsocks-obfs",
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
