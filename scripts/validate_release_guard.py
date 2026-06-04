#!/usr/bin/env python3
"""Validate backend/admin/node release guard documentation.

This is intentionally a documentation/process gate. It prevents the project
from silently dropping mandatory production-reality release invariants while
backend/admin/node work is considered closed.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TRACKER = ROOT / "docs" / "EXECUTION_TRACKER.md"
REALITY_CONTRACT = ROOT / "docs" / "PRODUCT_REALITY_CONTRACT.md"
RELEASE_GUARD = ROOT / "docs" / "BACKEND_ADMIN_NODE_RELEASE_GUARD.md"
ADMIN_SMOKE = ROOT / "scripts" / "live" / "admin-surface-smoke.py"
QUALITY_WORKFLOW = ROOT / ".github" / "workflows" / "quality.yml"

BACKEND_ADMIN_NODE_PREFIXES = {
    "PH",
    "U",
    "SQ",
    "N",
    "S",
    "SUB",
    "T",
    "PR",
}
OPEN_STATUSES = {"OPEN", "PARTIAL", "NEXT", "IN_PROGRESS", "BLOCKED"}


def read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        fail(f"missing required file: {path.relative_to(ROOT)}")


def fail(message: str) -> None:
    print(f"release guard validation failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def require_contains(name: str, text: str, snippets: list[str]) -> None:
    lowered = text.lower()
    missing = [snippet for snippet in snippets if snippet.lower() not in lowered]
    if missing:
        fail(f"{name} is missing required release invariant(s): {', '.join(missing)}")


def validate_tracker_statuses(tracker: str) -> None:
    pattern = re.compile(
        r"^\|\s*(?P<id>[A-Z]+-\d+)\s*\|[^|]*\|\s*(?P<status>[A-Z_]+)\s*\|",
        re.MULTILINE,
    )
    offenders: list[str] = []
    for match in pattern.finditer(tracker):
        item_id = match.group("id")
        prefix = item_id.split("-", 1)[0]
        status = match.group("status")
        if prefix in BACKEND_ADMIN_NODE_PREFIXES and status in OPEN_STATUSES:
            offenders.append(f"{item_id}={status}")
    if offenders:
        fail(
            "backend/admin/node tracker rows must not stay open without a fresh "
            f"release slice: {', '.join(offenders)}"
        )


def main() -> int:
    tracker = read(TRACKER)
    reality = read(REALITY_CONTRACT)
    guard = read(RELEASE_GUARD)
    workflow = read(QUALITY_WORKFLOW)

    if not ADMIN_SMOKE.exists():
        fail("scripts/live/admin-surface-smoke.py is required")

    validate_tracker_statuses(tracker)

    require_contains(
        "docs/BACKEND_ADMIN_NODE_RELEASE_GUARD.md",
        guard,
        [
            "scripts/live/admin-surface-smoke.py",
            "cleanup returns `0`",
            "/tmp/lumen-*",
            "GitHub-hosted Actions",
            "billing/spending",
            "digest-pinned",
            "signed public manifest",
            "Release signing",
            "Traffic accounting is mandatory",
            "docs/PRODUCT_REALITY_CONTRACT.md",
        ],
    )

    require_contains(
        "docs/EXECUTION_TRACKER.md",
        tracker,
        [
            "docs/BACKEND_ADMIN_NODE_RELEASE_GUARD.md",
            "scripts/validate_release_guard.py",
            "GitHub-hosted Actions remain externally blocked",
            "manual image promotion must stay digest-pinned",
        ],
    )

    require_contains(
        "docs/PRODUCT_REALITY_CONTRACT.md",
        reality,
        [
            "Production behavior must be real",
            "No fake replacements",
            "Release Gate",
        ],
    )

    require_contains(
        ".github/workflows/quality.yml",
        workflow,
        [
            "Validate backend/admin/node release guard",
            "python scripts/validate_release_guard.py",
        ],
    )

    print("release guard validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
