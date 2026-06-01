import json
import os
import urllib.request


BASE = "https://panel.89-185-85-184.sslip.io/api/v1"
NODE_HOST = "85.192.60.8"
HEADERS = {"X-Lumen-Api-Key": os.environ["LUMEN_BOOTSTRAP_ADMIN_API_KEY"]}


def get(path):
    req = urllib.request.Request(BASE + path, headers=HEADERS)
    return json.loads(urllib.request.urlopen(req, timeout=30).read().decode())


node = next(
    item
    for item in get("/nodes")["items"]
    if item.get("name") == "node-01" or item.get("public_address") == NODE_HOST
)
for command in get(f"/nodes/{node['id']}/commands")["items"][:12]:
    result = command.get("result_json") if isinstance(command.get("result_json"), dict) else {}
    outputs = result.get("outputs") if isinstance(result.get("outputs"), dict) else {}
    print(
        json.dumps(
            {
                "id": command.get("id"),
                "type": command.get("command_type"),
                "status": command.get("status"),
                "adapter": (command.get("payload_json") or {}).get("adapter"),
                "error": result.get("error") or outputs.get("error"),
                "implementationStatus": outputs.get("implementationStatus"),
            },
            ensure_ascii=False,
        )
    )
