import json
import os
import urllib.error
import urllib.request


BASE = os.environ.get("LUMEN_LIVE_PANEL_API", "https://panel.89-185-85-184.sslip.io/api/v1")
SUB_ORIGIN = os.environ.get("LUMEN_LIVE_SUB_ORIGIN", "https://sub.89-185-85-184.sslip.io")
PUBLIC_ID = os.environ["LUMEN_LIVE_PUBLIC_ID"]
KEY = os.environ["LUMEN_BOOTSTRAP_ADMIN_API_KEY"]
HEADERS = {"X-Lumen-Api-Key": KEY, "Content-Type": "application/json"}


def request(method, path, body=None, *, base=BASE, raw=False, authenticated=True):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        base + path,
        data=data,
        method=method,
        headers=HEADERS if authenticated else {},
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
    raise RuntimeError("live subscription not found")


def mark_subscription_happ_route(subscription):
    delivery = dict(subscription.get("delivery_profile") or {})
    delivery["client"] = "happ"
    delivery["format"] = "happ"
    return request(
        "PATCH",
        f"/subscriptions/{subscription['id']}",
        {
            "node_id": subscription.get("node_id"),
            "delivery_profile": delivery,
            "config_hash": subscription.get("config_hash"),
        },
    )


def public_render(target):
    status, headers, body = request(
        "GET",
        f"/sub/{PUBLIC_ID}/{target}",
        base=SUB_ORIGIN,
        raw=True,
        authenticated=False,
    )
    if status != 200:
        raise RuntimeError(f"public {target} render returned {status}")
    if len(body) < 20:
        raise RuntimeError(f"public {target} render is unexpectedly short")
    return {
        "target": target,
        "status": status,
        "bytes": len(body),
        "content_type": headers.get("content-type") or headers.get("Content-Type"),
    }


def assert_request_history(user_id, target):
    detail = request("GET", f"/users/{user_id}/detail")
    events = detail.get("request_history") or []
    for event in events[:10]:
        metadata = event.get("metadata_json") or {}
        if (
            event.get("action") == "subscription.public.rendered"
            and event.get("resource_type") == "user"
            and event.get("resource_id") == user_id
            and metadata.get("public_id") == PUBLIC_ID
            and metadata.get("target") == target
        ):
            return {
                "matched": True,
                "target": target,
                "recent_actions": [item.get("action") for item in events[:5]],
            }
    raise RuntimeError(
        json.dumps(
            {
                "request_history_missing": True,
                "target": target,
                "recent_actions": [item.get("action") for item in events[:5]],
            },
            ensure_ascii=False,
        )
    )


def assert_tools(subscription):
    user_id = subscription["user_id"]
    summary = request("GET", "/tools/summary")

    hwid = request("GET", "/tools/hwid-inspector")
    hwid_row = next((item for item in hwid["items"] if item.get("user_id") == user_id), None)
    if hwid_row is None:
        raise RuntimeError("HWID inspector does not include the live subscription user")

    srh = request("GET", "/tools/srh-inspector")
    srh_row = next(
        (item for item in srh["items"] if item.get("subscription_id") == subscription["id"]),
        None,
    )
    if srh_row is None:
        raise RuntimeError("SRH inspector does not include the live subscription")
    srh_status = (srh_row.get("response_headers") or {}).get("X-Lumen-Inspector-Status")
    if srh_status != "renderable":
        raise RuntimeError(f"SRH inspector is not renderable: {srh_status}")

    routing = request("GET", "/tools/happ-routing")
    route_row = next(
        (item for item in routing["items"] if item.get("subscription_id") == subscription["id"]),
        None,
    )
    if route_row is None:
        raise RuntimeError("HApp routing does not include the live subscription")
    if route_row.get("route_status") != "happ":
        raise RuntimeError(f"HApp route is not live-happ: {route_row.get('route_status')}")

    sessions = request("GET", "/tools/sessions")

    return {
        "summary": {
            "happ_routes": summary.get("happ_routes"),
            "sessions_active": summary.get("sessions_active"),
            "torrent_events": summary.get("torrent_events"),
            "hwid_over_limit": summary.get("hwid_over_limit"),
        },
        "hwid": {
            "user_seen": True,
            "device_count": hwid_row.get("device_count"),
            "status": hwid_row.get("status"),
        },
        "srh": {
            "parser": srh_row.get("parser"),
            "status": srh_status,
            "has_userinfo_header": "Subscription-Userinfo"
            in (srh_row.get("response_headers") or {}),
        },
        "happ_routing": {
            "route_status": route_row.get("route_status"),
            "node_status": route_row.get("node_status"),
        },
        "sessions": {"rows": len(sessions.get("items") or [])},
    }


def redact_id(value):
    text = str(value)
    if len(text) <= 10:
        return text
    return f"{text[:6]}...{text[-4:]}"


def main():
    subscription = find_subscription()
    subscription = mark_subscription_happ_route(subscription)
    render = public_render("happ")
    history = assert_request_history(subscription["user_id"], "happ")
    tools = assert_tools(subscription)
    print(
        json.dumps(
            {
                "scope": "tools-request-history-live",
                "subscription_id": redact_id(subscription["id"]),
                "user_id": redact_id(subscription["user_id"]),
                "public_render": render,
                "request_history": history,
                "tools": tools,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
