# Lumen Shared OpenAPI

`openapi.yaml` is the checked-in seed contract for backend/client integration.
The file is generated as deterministic JSON, which is also valid YAML.

Regenerate it from the backend route surface:

```bash
cd apps/api
python scripts/export_openapi.py
```

Check for drift without writing:

```bash
cd apps/api
python scripts/export_openapi.py --check
python -m pytest tests/test_openapi_seed.py
```

The FastAPI runtime also exposes `/openapi.json` outside production for generated
contract checks.
