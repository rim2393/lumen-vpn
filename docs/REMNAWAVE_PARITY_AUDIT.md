# Remnawave Parity Audit

Date: 2026-06-01

This file tracks the live parity audit. A row is closed only when code, tests,
release/update flow and live VPS validation prove the feature is real. Fake
counts, placeholder actions and DB-only buttons do not count.

## Current P0 Findings

| Area | Finding | Status |
| --- | --- | --- |
| Nodes | Admin UI had pause/resume/quarantine, but missed update/delete/reorder/restart/reset traffic/restart-all/bulk surfaces. | In progress |
| Nodes | Several node actions changed control-plane state without a matching live node-agent command. | In progress |
| Profiles and hosts | CRUD exists, but profile/host changes do not auto-sync node runtime except explicit profile apply. | Open |
| Hosts | Host model is narrower than required Remnawave parity fields: path, SNI, security, mux, sockopt, xHTTP, exclusions, final mask and Mihomo X25519. | Open |
| Subscriptions | Admin API lacks delete/clone/raw/connection keys/subpage config and lookup by username or short UUID. | Open |
| Tools | Several tools are inspector-only; drop connections, top users, node user IPs and full HApp routing encryption remain incomplete. | Open |
| Settings | Settings are generic key/value; typed Remnawave/Lumen groups with validation are incomplete. | Open |
| OpenAPI | Checked-in OpenAPI seed is stale and does not include the current admin/node/tools surfaces. | Open |

## First Implementation Slice

Node-management parity is first because the panel must not expose buttons that
only mutate database rows. Required closure evidence:

- Backend API: node update, delete, reorder, restart, restart all, reset traffic and bulk actions.
- Node-agent: command envelope and live command execution for restart and traffic reset.
- Web UI: visible controls wired to those real endpoints.
- Tests: backend route tests and node-agent command tests.
- Production: release, deploy, live admin smoke and node command completion on the real node.

