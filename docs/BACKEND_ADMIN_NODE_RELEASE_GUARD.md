# Backend/Admin/Node Release Guard

This document is the operational guard for the self-hosted control plane,
admin UI, backend API and node-agent runtime. It turns the remaining
operational debt into release invariants.

The source of truth for task status is `docs/EXECUTION_TRACKER.md`. This file
defines what must be true before a backend/admin/node change can be considered
release-ready.

## Scope

This guard covers:

- admin UI routes and buttons;
- backend API and database state;
- public subscription renderers when they depend on backend/node state;
- node-agent runtime apply, metrics, cleanup, pause/resume and commands;
- official installer, upgrade and rollback paths for panel and node.

It does not close Android, Windows, license-server or billing-portal work. Those
remain separately tracked in `docs/EXECUTION_TRACKER.md`.

## Mandatory Post-Release Regression

After every production release that touches backend, admin UI, subscriptions,
runtime protocols, node-agent, installer, upgrade or manifest behavior:

1. Run `scripts/live/run-admin-surface-smoke-on-panel.sh` on the real panel
   host. The wrapper executes `scripts/live/admin-surface-smoke.py` against the
   real production panel through the API container and performs root cleanup of
   host/API `/tmp/lumen-*` artifacts.
2. Verify real protected surfaces for nodes, profiles, hosts, squads, users,
   subscriptions, settings, subscription assets, tools, infra billing, IP
   control and utility endpoints.
3. Verify cleanup returns `0` for every temporary user, API key, subscription,
   license, profile, host, squad or other QA record created by the smoke.
4. Verify panel host, API container and node host do not retain
   `/tmp/lumen-*` artifacts after the smoke.
   When a smoke script is copied into a production container with `docker cp`,
   remove it with root inside the container, for example
   `docker exec -u 0 lumen-api-1 rm -f /tmp/lumen-*.py`, because the runtime
   application user may not be allowed to delete host-copied files.
5. Verify the node VPS contains only its runtime/config/state/secrets under
   `/opt/lumen-node`, with no admin checkout, installer checkout, build
   worktree or smoke script.
6. Record the live evidence in `docs/EXECUTION_TRACKER.md` in the same commit
   as the completed slice, or in the immediate evidence commit for manually
   promoted releases.

## GitHub Actions Billing Block

GitHub-hosted Actions are currently an external release-system blocker when the
account refuses to start jobs because of billing/spending limits.

The detailed recovery checklist is `docs/GITHUB_ACTIONS_BILLING_UNBLOCK.md`.

Until the account owner fixes billing/spending:

- do not claim that normal CI/CD is healthy;
- manual image promotion is allowed only as a controlled fallback;
- every manual image must be digest-pinned;
- every manual release must still use the signed public manifest and official
  upgrade path;
- every manual release must include live smoke evidence and cleanup evidence.
- tag/workflow-dispatch releases must fail if `LUMEN_PUBLIC_REPO_TOKEN` is not
  configured, because silently skipping the public installer dispatch would
  bypass the signed manifest pipeline.

After billing/spending is fixed, the next release must prove:

- `.github/workflows/quality.yml` starts and passes from GitHub-hosted runners;
- `.github/workflows/release-images.yml` builds and verifies all product
  images;
- the public installer manifest is produced by the normal secret-backed
  release pipeline instead of ad-hoc local signing.
- the passing workflow run ids and signing verification evidence are recorded
  in `docs/EXECUTION_TRACKER.md`.

## Release Signing Secret

Release signing must be a durable ops secret, not a temporary private key kept
on a developer workstation, panel host or node host.

Before marking the release pipeline fully healthy again:

- product repo releases must have `LUMEN_PUBLIC_REPO_TOKEN` configured so the
  private image workflow can dispatch the public signed-manifest workflow;
- public installer releases must have `LUMEN_RELEASE_SIGNING_KEY` configured as
  the Ed25519 private key secret and `LUMEN_RELEASE_SIGNING_KID` configured as
  the non-secret key id;
- install the signing secret in the approved CI/ops secret store;
- verify the public release manifest validates against the deployed public key;
- remove any temporary signing private key from hosts and local worktrees;
- document only the secret name and verification evidence, never the secret
  value.

## Runtime And Protocol Changes

Any runtime/protocol change must follow this order:

1. implement code;
2. run focused local tests for the touched API/node/subscription packages;
3. build product images;
4. publish a signed public manifest;
5. run the official panel/node upgrade scripts;
6. run live VPS smoke through the real panel, real node, real DB and public
   subscription URL;
7. clean all temporary prod records and files;
8. record evidence in `docs/EXECUTION_TRACKER.md`.

If the change only reaches local tests, keep the tracker row `PARTIAL`.

Detailed protocol acceptance criteria are in
`docs/PROTOCOL_RUNTIME_CLOSURE_CHECKLIST.md`.

Traffic accounting is mandatory for new protocol families. A protocol can have
limited client-app feature parity, but it cannot be closed if node/backend GB
accounting is missing or unproven.

## Remnawave Parity Gaps

Do not reopen old Remnawave parity items from memory or stale screenshots.

If a new backend/admin/node gap is suspected:

1. prove it with a current live API/UI/node check;
2. create a new concrete row in `docs/EXECUTION_TRACKER.md`;
3. implement against real backend/node state;
4. release through the official path;
5. close only after live evidence and cleanup evidence.

## No-Fake Invariant

`docs/PRODUCT_REALITY_CONTRACT.md` is mandatory. Backend/admin/node release is
blocked if production can reach fake/demo/mock/placeholder state, seeded
counters, synthetic nodes, optimistic success, mock-only API clients, generated
demo subscriptions or hardcoded production numbers.

The local and CI guard `scripts/validate_production_reality.py` enforces the
frontend production boundary without requiring a web dependency install. It
blocks development fixture imports, development API clients, old hardcoded fake
dashboard counters, sample subscription URLs and pseudo-backend placeholder
status labels in production web modules.

Empty real state is valid. Fake positive state is not.
