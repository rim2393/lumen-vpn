# Lumen Control Plane

Private source repository for the Lumen self-hosted VPN control plane.

This repository contains the closed-source implementation of the admin API,
web console, node agent, subscription page, Lumen Edge fallback service, and
shared packages. Public installer scripts and user-facing deployment docs live
in `rim2393/lumen_vpn`.

## Repository Rules

- `docs/PRODUCT_REALITY_CONTRACT.md` is mandatory: production must use only
  real API, database, node, filesystem, network, or external-service state. No
  fake counters, placeholders, demo entities, mock-only behavior, or fake
  success paths may ship.
- Do not commit secrets, generated runtime configs, private keys, registry
  tokens, subscription URLs, or server credentials.
- Do not copy Remnawave or Amnezia source code or branded assets.
- All externally visible behavior must be implemented through our own code,
  contracts, tests, and documentation.
- Track every implementation decision in `docs/DECISIONS.md`.
- Track status and unfinished work in `docs/STATUS.md` and
  `docs/REMAINING.md`.

## Main Components

- `apps/api` - FastAPI backend.
- `apps/web` - React admin console and Lumen Guard.
- `apps/node-agent` - VPS agent for outbound control, health, provisioning,
  and protocol lifecycle.
- `apps/lumen-edge` - node-side fallback landing and camouflage edge.
- `apps/subscription-page` - public subscription page and renderer frontend.
- `packages/*` - shared schemas, contracts, protocol registry, and renderers.

## Release Target

The first milestone is `v0.1.0-prototype`: clean VPS install, admin login,
free 3-node licensing, node provisioning, protocol framework, first protocol
passes, subscription rendering, backup/restore, and test coverage.
