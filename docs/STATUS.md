# Status

## Current Phase

Production hardening sprint: deployed self-hosted control plane with one live
panel and one live node, replacing non-live code paths with real contracts.

## Completed

- Four GitHub repositories verified and cloned into `D:\lumen-work`.
- `D:\lumen-secrets` created and ACL restricted to the current user,
  Administrators, and SYSTEM.
- Native subagents used for installer, backend, frontend, node/protocol,
  license server, and client compatibility work.
- Client compatibility repo initialized with subscription import docs,
  protocol support docs, Android/Windows status docs, compatibility matrix, and
  `lumen.subscription.v1` JSON fixtures.
- Node/protocol/subscription packages completed with node-agent contracts,
  protocol registry, subscription schema/renderers, Lumen Edge fallback landing,
  and passing Node test suites.
- Frontend completed with Lumen Guard, admin shell, route tests,
  passing build, and passing Vitest suite. Temporary dev server was stopped.
- Backend completed with FastAPI app, security/RBAC/API docs,
  SQLAlchemy/Alembic layout, domain modules, and passing pytest suite.
- Public installer repo initialized and locally committed by the DevOps
  agent; main integration patched `secret-scan.sh` to handle patterns that
  start with dashes.
- License server initialized with FastAPI API, React cabinet,
  signed offline license model, TOTP/recovery contracts, Docker/Compose, docs,
  and passing backend/frontend tests.
- Backend Phase 2 security slice completed with API key one-time generation,
  HMAC-at-rest verification, scope checks, and a free 3-node license policy.
- Backend Phase 3 node provisioning slice completed with idempotent provisioning
  jobs, SSH credential references only, preflight states, one-time install token
  exchange, node heartbeat token hashing, and route/service tests.
- Production Reality Contract is active: production web builds reject development API mode,
  public subscriptions require a real node and renderable protocol, catalog-only
  protocol adapters cannot provision live plans, and client renderers no longer
  emit incomplete client configs.

## In Progress

- Remnawave parity backlog execution and per-protocol enablement.

## Verification

- Private control-plane repo: backend pytest/ruff, web build/Vitest,
  node-agent tests, lumen-edge tests, protocol-registry tests,
  subscription-schema tests, and subscription-renderers tests pass.
- Public installer repo: bash syntax, Docker Compose config with
  `.env.example`, release manifest JSON validation, and secret scan pass.
- License server repo: backend pytest/ruff, frontend build/Vitest, and Docker
  Compose config pass.
- Client compatibility repo: JSON fixtures parse and `git diff --check` passes.
- Plaintext VPS passwords were not found in `D:\lumen-work`.
- Backend API Phase 2 security slice: `.venv\Scripts\python.exe -m pytest`
  and `.venv\Scripts\python.exe -m ruff check .` pass in `apps\api`.
- Backend API Phase 3 node provisioning slice: `.venv\Scripts\python.exe -m pytest`
  and `.venv\Scripts\python.exe -m ruff check .` pass in `apps\api`.

## Blockers

- No current deployment blocker for the active VLESS TLS slice. Additional
  protocols remain gated until their adapter, node-agent, renderer, and client
  import checks are implemented.

## Next

1. Continue closing Remnawave parity surfaces with real API-backed behavior.
2. Enable protocols one by one with live node-agent and client import tests.
3. Keep every production deployment on pinned images from the official pipeline.
