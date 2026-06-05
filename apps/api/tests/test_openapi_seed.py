from __future__ import annotations

from pathlib import Path

from scripts.export_openapi import build_openapi_document, render_openapi_document

REPO_ROOT = Path(__file__).resolve().parents[3]
OPENAPI_SEED = REPO_ROOT / "packages" / "shared-openapi" / "openapi.yaml"


def test_checked_in_openapi_seed_is_current() -> None:
    expected = render_openapi_document(build_openapi_document())
    assert OPENAPI_SEED.read_text(encoding="utf-8") == expected


def test_openapi_seed_includes_current_admin_node_tools_and_subscription_surfaces() -> None:
    schema = build_openapi_document()
    paths = schema["paths"]

    expected_paths = {
        "/api/v1/api-keys",
        "/api/v1/node-plugins",
        "/api/v1/nodes/{node_id}/commands",
        "/api/v1/nodes/{node_id}/protocol-selection",
        "/api/v1/profiles/{profile_id}/apply-to-node",
        "/api/v1/response-rules/test",
        "/api/v1/settings/groups/{group_key}",
        "/api/v1/subscription-page-configs/{config_id}/clone",
        "/api/v1/subscriptions/{subscription_id}/render",
        "/api/v1/tools/happ-routing/build",
        "/api/v1/tools/torrent-blocker-reports",
        "/api/v1/users/bulk/{action}",
        "/api/v1/users/lookup",
    }

    missing = sorted(expected_paths.difference(paths))
    assert missing == []
