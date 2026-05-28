# Lumen API

Production-oriented FastAPI backend for the Lumen VPN control plane.

## Local Commands

```powershell
uv sync --dev
uv run pytest
uv run ruff check .
uv run uvicorn app.main:create_app --factory --reload
```

Runtime secrets are read from environment variables prefixed with `LUMEN_`.
Do not commit generated API keys, session tokens, private keys, database passwords,
subscription URLs, or runtime configuration files.
