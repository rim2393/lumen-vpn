# Remnawave Parity Audit

Date: 2026-06-01

This file tracks the live parity audit. A row is closed only when code, tests,
release/update flow and live VPS validation prove the feature is real. Fake
counts, placeholder actions and DB-only buttons do not count.

Execution tracker: `docs/EXECUTION_TRACKER.md`. Update that tracker with task
IDs, status and evidence before starting a new parity slice, so completed work
is not repeated after context compaction.

2026-06-04 update: this audit file is historical. The current backend/admin/node
status is in `docs/EXECUTION_TRACKER.md`; after API `v0.1.127`, that tracker has
no `OPEN`, `PARTIAL`, or `NEXT` Remnawave parity rows outside client evidence.
The latest protected admin surface evidence is the prod run of
`scripts/live/admin-surface-smoke.py` against `https://panel.lumentech.tel`.

## Current P0 Findings

| Area | Finding | Status |
| --- | --- | --- |
| Nodes | Admin UI had pause/resume/quarantine, but missed update/delete/reorder/restart/reset traffic/restart-all/bulk surfaces. | Closed for P0 node-management slice in `v0.1.59`; broader Remnawave Nodes parity still needs screen-by-screen UX polish. |
| Nodes | Several node actions changed control-plane state without a matching live node-agent command. | Closed for restart/reset-traffic in `v0.1.59`; future node actions must keep the same API -> command -> live evidence rule. |
| Profiles and hosts | CRUD exists, but profile/host changes do not auto-sync node runtime except explicit profile apply. | Closed in `PH-006`: UI/API marks affected runtime as pending apply and a real `apply-to-node` operation queues/applies live node commands. |
| Hosts | Host model is narrower than required Remnawave parity fields: path, SNI, security, mux, sockopt, xHTTP, exclusions, final mask and Mihomo X25519. | Closed in `PH-007` through `PH-009`: storage/API/UI/computed Xray overrides and public subscription manifest/renderers are released and live-validated. |
| Subscriptions | Admin API lacks delete/clone/raw/connection keys/subpage config and lookup by username or short UUID. | Closed in `SUB-001` and `SUB-006`: protected admin lookup/clone/delete/raw/devices/page-config flows are backed by real API and release evidence. |
| Subscriptions | Create UI covers only a narrow part of the backend subscription contract and still has a static `server_name` default. | Closed in `SUB-002` and `SUB-003`: static server default removed, richer create contract and typed subscription delivery settings are released and live-validated. |
| Settings | Auth providers with `unimplemented` status are deliberately read-only; this is not Remnawave-level parity until the real callback/config flow exists. | Closed in `S-001`, `S-003`, and `S-005`: generic OAuth2, passkeys, Telegram runtime status, MFA and auth method toggles are real backend flows or fail-closed as `needs_configuration`. |
| Tools | Several tools are inspector-only; drop connections, top users, node user IPs and full HApp routing encryption remain incomplete. | Closed in `T-001` through `T-007`: tools are backed by real database, audit, node command and crypto flows with release/live evidence. |
| Settings | Settings are generic key/value; typed Remnawave/Lumen groups with validation are incomplete. | Closed in `S-002`: typed settings groups validate and block generic bypass. |
| OpenAPI | Checked-in OpenAPI seed is stale and does not include the current admin/node/tools surfaces. | Closed in `O-001`; keep running the seed drift gate when API surfaces change. |

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
- Live closure for this Apply surface: `v0.1.60` panel API returned queued
  `outbound.apply` command `f579715a-dc66-47da-9f1c-8b46b31f3bfa`, and the
  real node-agent completed it as `succeeded` with implementation
  `openvpn-shadowsocks-managed-process-started`.
- Hosts P0/P1 validation gaps closed locally: create now blocks empty
  `node_id` before mutation, host editor blocks empty node before save, and
  bulk/editor ports are validated as integer `1..65535` before sending a
  mutation.
- Users/subscriptions/settings audit findings: user lifecycle/device controls
  are wired to real endpoints; subscription create UI is too narrow for the
  backend contract; subscription delivery profile still has a static
  `server_name` default; auth-provider parity is incomplete while providers are
  `unimplemented`/read-only.

## Subscription Follow-Up Findings

- Subscription create form no longer bakes in a panel-domain `server_name`.
  When not provided explicitly in `delivery_profile`, the UI derives
  `server_name` from the selected host hostname or selected node public address
  before creating the backend record.
- Subscription create form now exposes backend `expires_at` and `config_hash`
  fields in addition to `user_id`, `license_id`, `node_id`, and
  `delivery_profile`.
- Subscription admin now has real backend routes for lookup by public ID,
  username/email/display name and short UUID, clone, hard delete, raw admin
  preview, and subscription-scoped registered device/HWID inspection.
- Subscription UI wires these admin actions through the production API client:
  lookup search, Clone, Delete, Devices, and Raw preview are not local-only
  controls.
- Local closure gates for this slice: API subscription route tests passed
  (`17 passed`), scoped API ruff passed, web TypeScript passed,
  `httpClient.test.ts` plus `productionReality.test.ts` passed (`11 tests`),
  and web production build passed.

## Auth Provider Follow-Up Findings

- `generic_oauth2` is no longer catalog-only. It is part of the implemented
  provider set and is blocked as `needs_configuration` until real environment
  or secret-file configuration exists.
- The real login flow supports either OIDC discovery through
  `generic_oauth2_issuer` or explicit authorization/token/userinfo endpoints.
  Client secrets remain env/file-backed and are not accepted in panel metadata.
- The provider can use custom userinfo field names for subject, email,
  verification, and display name while keeping existing Google/GitHub/Keycloak
  and PocketID behavior intact.
- Local gates for this slice: scoped API ruff passed; auth/settings route tests
  passed (`34 passed, 2 skipped`); web TypeScript passed.

## Hosts Field Parity Follow-Up Findings

- Host records now have first-class database/API fields for path, SNI, security,
  Xray template JSON, mux, sockopt, xHTTP settings, subscription exclusion,
  hidden flag, excluded internal squad IDs, shuffle flag, final mask and Mihomo
  X25519 public key.
- The Hosts create form and editor expose these fields directly instead of
  forcing operators to hide them inside `metadata_json`.
- Computed Xray inbound generation now applies host-level path/SNI/security,
  xHTTP, mux and sockopt overrides to `streamSettings`; these fields are not
  stored-only for runtime config preview/apply payload generation.
- Public subscription manifest generation now rejects explicit hidden/excluded
  hosts, auto-selects only active subscription-visible hosts for a profile/node,
  applies deterministic host shuffle, uses `final_mask` as the client-visible
  endpoint host, keeps host SNI/security as TLS/Reality metadata, and forwards
  Mihomo-specific X25519 public keys through renderer hints.
- Mihomo/Clash-family exports now use the host-level Mihomo X25519 key in
  `reality-opts.public-key` while other clients keep the protocol security
  public key.
- Local gates for this slice: scoped API ruff passed; control-plane route tests
  passed (`24 passed`); subscription route tests passed (`18 passed`); web
  TypeScript passed. Live closure still requires official release/update and
  production smoke.
