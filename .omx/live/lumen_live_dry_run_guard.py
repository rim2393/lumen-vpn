import os
import uuid

import requests


BASE = os.environ.get("LUMEN_LIVE_PANEL_API", "https://panel.89-185-85-184.sslip.io/api/v1")
KEY = os.environ["LUMEN_BOOTSTRAP_ADMIN_API_KEY"]
NODE_TOKEN = os.environ["LUMEN_LIVE_NODE_TOKEN"]
HEADERS = {"X-Lumen-Api-Key": KEY}
NODE_HEADERS = {"X-Lumen-Node-Token": NODE_TOKEN}


def request(method, path, **kwargs):
    response = requests.request(method, f"{BASE}{path}", timeout=20, **kwargs)
    if response.status_code >= 400 and kwargs.pop("allow_error", False) is False:
        raise RuntimeError(f"{method} {path} failed: {response.status_code} {response.text[:240]}")
    return response


def main() -> None:
    nodes = request("GET", "/nodes", headers=HEADERS).json()["items"]
    active_node = next((node for node in nodes if node["status"] == "active"), None)
    if active_node is None:
        raise RuntimeError("no active live node available for dry-run guard smoke")

    node_id = active_node["id"]
    command = request(
        "POST",
        f"/nodes/{node_id}/commands",
        headers=HEADERS,
        json={
            "command_type": "conflict.scan",
            "payload_json": {"probe": f"dry-run-guard-{uuid.uuid4().hex[:8]}"},
        },
    ).json()
    command_id = command["id"]

    claimed = request("GET", f"/nodes/{node_id}/commands/next", headers=NODE_HEADERS).json()
    if claimed["id"] != command_id:
        raise RuntimeError("live dry-run guard command was not claimed first")

    rejected = request(
        "POST",
        f"/nodes/{node_id}/commands/{command_id}/result",
        headers=NODE_HEADERS,
        allow_error=True,
        json={
            "status": "succeeded",
            "result_json": {
                "outputs": {
                    "dryRun": True,
                    "implementationStatus": "xray-dry-run",
                },
            },
        },
    )
    if rejected.status_code != 422:
        raise RuntimeError(f"dry-run success was not rejected: {rejected.status_code}")
    error_code = rejected.json()["error"]["code"]
    if error_code != "node_command_dry_run_success_forbidden":
        raise RuntimeError(f"unexpected dry-run rejection code: {error_code}")

    completed = request(
        "POST",
        f"/nodes/{node_id}/commands/{command_id}/result",
        headers=NODE_HEADERS,
        json={
            "status": "failed",
            "result_json": {
                "outputs": {
                    "dryRun": True,
                    "implementationStatus": "xray-dry-run",
                },
                "error": {"code": "dry_run_guard_probe"},
            },
            "error_code": "dry_run_guard_probe",
            "error_message": "dry-run success rejection verified",
        },
    ).json()
    if completed["status"] != "failed":
        raise RuntimeError(f"cleanup completion did not fail the probe command: {completed['status']}")

    print(
        "live dry-run guard ok: "
        f"node={active_node['name']} command={command_id} rejected={error_code} cleanup=failed"
    )


if __name__ == "__main__":
    main()
