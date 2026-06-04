#!/usr/bin/env python3
"""Validate that production UI code cannot reach fake/demo fixture behavior."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_SRC = ROOT / "apps" / "web" / "src"
API_CLIENT_PROVIDER = WEB_SRC / "shared" / "api" / "ApiClientProvider.tsx"
REALITY_CONTRACT = ROOT / "docs" / "PRODUCT_REALITY_CONTRACT.md"


def fail(message: str) -> None:
    print(f"production reality validation failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        fail(f"missing required file: {path.relative_to(ROOT)}")


def is_production_web_source(path: Path) -> bool:
    if path.suffix not in {".ts", ".tsx"}:
        return False
    rel = path.relative_to(WEB_SRC).as_posix()
    if rel.endswith((".test.ts", ".test.tsx")):
        return False
    if rel.startswith("test/"):
        return False
    if rel in {
        "shared/api/developmentClient.ts",
        "shared/data/developmentFixtures.ts",
        "shared/data/productionReality.test.ts",
    }:
        return False
    return True


def production_web_sources() -> list[tuple[Path, str]]:
    return [(path, read(path)) for path in WEB_SRC.rglob("*") if is_production_web_source(path)]


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def assert_no_offenders(name: str, offenders: list[str]) -> None:
    if offenders:
        fail(f"{name}: {', '.join(offenders)}")


def main() -> int:
    reality = read(REALITY_CONTRACT)
    if "Production behavior must be real" not in reality or "No fake replacements" not in reality:
        fail("docs/PRODUCT_REALITY_CONTRACT.md is missing the mandatory reality wording")

    sources = production_web_sources()

    assert_no_offenders(
        "development fixtures imported by production web modules",
        [
            rel(path)
            for path, source in sources
            if "developmentFixtures" in source or "createDevelopmentLumenApiClient" in source
        ],
    )

    assert_no_offenders(
        "sample subscription/support URLs in production web modules",
        [
            rel(path)
            for path, source in sources
            if re.search(r"https://(?:sub\.example\.com|t\.me/support)", source)
        ],
    )

    assert_no_offenders(
        "old fake production counters in production web modules",
        [
            rel(path)
            for path, source in sources
            if re.search(r"\b18[,]?420\b|\b45\s+(?:nodes?|нод)", source, flags=re.IGNORECASE)
        ],
    )

    forbidden_status_labels = [
        "Backend render status not exposed",
        "Backend does not expose device registry",
        "Backend does not expose subscription request history",
        "Backend unavailable",
    ]
    assert_no_offenders(
        "pseudo-backend placeholder status labels in production web modules",
        [
            rel(path)
            for path, source in sources
            if any(label in source for label in forbidden_status_labels)
        ],
    )

    fixture_env_offenders = [
        rel(path)
        for path, source in sources
        if "VITE_LUMEN_USE_FIXTURES" in source and path != API_CLIENT_PROVIDER
    ]
    assert_no_offenders("fixture environment flag outside the fail-closed provider", fixture_env_offenders)

    provider = read(API_CLIENT_PROVIDER)
    for required in [
        "VITE_LUMEN_USE_FIXTURES",
        "throw new Error",
        "in-app fixture API is forbidden",
        "createHttpLumenApiClient",
        "window.location.origin",
    ]:
        if required not in provider:
            fail(f"{rel(API_CLIENT_PROVIDER)} is missing fail-closed provider invariant: {required}")

    print("production reality validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
