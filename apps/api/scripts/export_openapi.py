from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from fastapi.encoders import jsonable_encoder

API_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = API_ROOT.parents[1]
OPENAPI_SEED = REPO_ROOT / "packages" / "shared-openapi" / "openapi.yaml"

sys.path.insert(0, str(API_ROOT))

from app.core.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402


def _sort_openapi(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _sort_openapi(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [_sort_openapi(item) for item in value]
    return value


def build_openapi_document() -> dict[str, Any]:
    app = create_app(
        Settings(
            app_name="Lumen API",
            app_version="0.1.0",
            environment="local",
            docs_url="/docs",
            redoc_url="/redoc",
            openapi_url="/openapi.json",
        )
    )
    schema = jsonable_encoder(app.openapi())
    if not isinstance(schema, dict):
        raise TypeError("FastAPI returned a non-object OpenAPI schema")
    return _sort_openapi(schema)


def render_openapi_document(schema: dict[str, Any]) -> str:
    return json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Export or verify the checked-in OpenAPI seed.")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Fail when packages/shared-openapi/openapi.yaml is not current.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=OPENAPI_SEED,
        help="OpenAPI seed path to write or check.",
    )
    args = parser.parse_args()

    rendered = render_openapi_document(build_openapi_document())
    current = args.output.read_text(encoding="utf-8") if args.output.exists() else None
    if args.check:
        if current != rendered:
            print(
                f"{args.output} is stale. Run `python apps/api/scripts/export_openapi.py`.",
                file=sys.stderr,
            )
            return 1
        return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
