# Lumen Node Provisioning

This document defines the local contract surface for `apps/node-agent`.

## Scope

The node agent owns local provisioning models and the guarded command loop:

- outbound plan records
- provisioning job and result envelopes
- system capability reports
- port and local system conflict detection

It does not persist runtime secrets or generated client configs. Live protocol
implementation is enabled per adapter only after the adapter has install,
health, conflict, export, and client import tests.

## Outbound Plan Model

Source: `apps/node-agent/src/outbound-model.js`

Version: `lumen.node-agent.outbound.v1`

Required fields:

- `id`
- `nodeId`
- `protocol`
- `adapter`
- `endpoint.host`
- `endpoint.port`
- `credentialsRef`

`credentialsRef` is the only supported credential carrier. Inline `password`,
`token`, `privateKey`, subscription URL, generated runtime config, and similar
secret-like fields are rejected.

## Provisioning Jobs

Source: `apps/node-agent/src/provisioning-contracts.js`

Version: `lumen.node-agent.provisioning-job.v1`

Initial job kinds:

- `node.provision`
- `node.deprovision`
- `outbound.apply`
- `outbound.remove`
- `capabilities.report`
- `conflict.scan`

Jobs must be idempotent by `idempotencyKey`. Results preserve `jobId`, `nodeId`, terminal status, outputs, conflicts, and error state. Outputs are checked for secret-like inline fields.

## Backend Control Plane Surface

Source: `apps/api/app/domains/nodes`

The backend now owns the minimal durable provisioning surface:

- `POST /api/v1/nodes/provisioning-jobs` creates an idempotent `node.provision`
  job and an associated node in `provisioning` state.
- `POST /api/v1/nodes/provisioning-jobs/{jobId}/preflight` records preflight
  state: `pending`, `running`, `passed`, or `failed`.
- `POST /api/v1/nodes/provisioning-jobs/{jobId}/install-token` issues a
  one-time install token only after preflight passes.
- `POST /api/v1/nodes/install-token/exchange` exchanges the install token once
  for a node heartbeat token.
- `POST /api/v1/nodes/{nodeId}/heartbeat` updates `last_seen_at`, status, and
  capabilities using `X-Lumen-Node-Token`.

Provisioning job states are `queued`, `preflight_running`, `preflight_passed`,
`install_token_issued`, `installing`, `active`, `failed`, and `cancelled`.

The backend accepts SSH connection metadata (`host`, `port`, `username`) plus
`credentials_ref`. It does not accept or persist inline SSH passwords, private
keys, access tokens, subscription URLs, or generated runtime configs. Install
tokens and node heartbeat tokens are returned once and persisted only as HMAC
hashes using `LUMEN_NODE_TOKEN_HASH_PEPPER`.

## System Capabilities

Source: `apps/node-agent/src/system-capabilities.js`

The first registry includes service manager, firewall, TUN, IPv6, QUIC/UDP, privileged bind, WireGuard kernel, sing-box, Xray-core, and Docker capabilities. Unknown capability keys are preserved as booleans so later probes can add non-breaking checks.

## Conflict Model

Source: `apps/node-agent/src/conflict-model.js`

Version: `lumen.node-agent.conflict.v1`

The agent detects:

- overlapping exclusive address/port/protocol reservations
- privileged port usage without `bind.privileged_ports`

## Planned Runtime Work

- Wire capability reports to real OS probes per platform.
- Add durable provisioning queue storage and retry policy.
- Add signed job source verification before accepting control-plane commands.
- Add service manager and firewall apply backends.
- Extend conflict detection to reserved paths, process ownership, and exclusive protocol runtimes.
