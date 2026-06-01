# Remnawave Parity Audit

Date: 2026-06-01

This file tracks the live parity audit. A row is closed only when code, tests,
release/update flow and live VPS validation prove the feature is real. Fake
counts, placeholder actions and DB-only buttons do not count.

## Current P0 Findings

| Area | Finding | Status |
| --- | --- | --- |
| Nodes | Admin UI had pause/resume/quarantine, but missed update/delete/reorder/restart/reset traffic/restart-all/bulk surfaces. | Closed for P0 node-management slice in `v0.1.59`; broader Remnawave Nodes parity still needs screen-by-screen UX polish. |
| Nodes | Several node actions changed control-plane state without a matching live node-agent command. | Closed for restart/reset-traffic in `v0.1.59`; future node actions must keep the same API -> command -> live evidence rule. |
| Profiles and hosts | CRUD exists, but profile/host changes do not auto-sync node runtime except explicit profile apply. | Open |
| Hosts | Host model is narrower than required Remnawave parity fields: path, SNI, security, mux, sockopt, xHTTP, exclusions, final mask and Mihomo X25519. | Open |
| Subscriptions | Admin API lacks delete/clone/raw/connection keys/subpage config and lookup by username or short UUID. | Open |
| Subscriptions | Create UI covers only a narrow part of the backend subscription contract and still has a static `server_name` default. | Open |
| Settings | Auth providers with `unimplemented` status are deliberately read-only; this is not Remnawave-level parity until the real callback/config flow exists. | Open |
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

Closure evidence:

- Code: commits `846dbb6`, `2642546`, `4cd173f`, `b5bb0c2`.
- Local gates: API scoped pytest and ruff passed, web `NodesPage.test.tsx`
  and production build passed, node-agent full `node --test` passed with
  `99 passed`.
- Release/update: signed public manifest advanced to `v0.1.59`.
- Live VPS: panel web/api/subscription images healthy on `v0.1.59`; node-agent
  installed through `scripts/install-node.sh` using pinned image digest
  `sha256:4425bdcab9a051352b3743e984005323f095adf9c16feaf91b2959b269bb58ab`.
- Live commands: `node.traffic.reset` returned
  `implementationStatus=node-traffic-reset`; `node.restart` returned
  `implementationStatus=node-agent-restart-scheduled` with command
  `process.exit(0)` and the real container `StartedAt` changed from
  `2026-06-01T16:39:20.843014313Z` to
  `2026-06-01T16:40:27.775375566Z`.

## Profiles/Hosts Follow-Up Findings

- Profiles UI now exposes explicit Apply controls in the table, card view and
  detail panel. The action calls the real backend endpoint
  `POST /api/v1/profiles/{profile_id}/apply-to-node`, which queues the node
  `outbound.apply` command instead of only editing a database row.
- Hosts P0 gap: the create flow can still derive `node_id=""` when no node is
  selected. The UI must block submit with a clear error before the API 422.
- Hosts P1 gaps: bulk set-port and host editor port validation need strict
  `1..65535` checks and user-facing errors before mutation.
- Users/subscriptions/settings audit findings: user lifecycle/device controls
  are wired to real endpoints; subscription create UI is too narrow for the
  backend contract; subscription delivery profile still has a static
  `server_name` default; auth-provider parity is incomplete while providers are
  `unimplemented`/read-only.
