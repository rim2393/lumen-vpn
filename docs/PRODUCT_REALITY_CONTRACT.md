# Product Reality Contract

This contract is mandatory for every Lumen self-hosted control-plane change.
It exists to prevent fake progress, demo-only UI, placeholder behavior, and
test-only implementations from reaching the shipped product.

## Hard Rules

- Production behavior must be real. Every deployed page, button, metric,
  subscription link, node action, API response, installer step, and update path
  must reflect real panel, node, database, filesystem, network, or external
  service state.
- No fake replacements are allowed in production. Do not ship mocked counters,
  demo users, demo nodes, synthetic traffic, placeholder protocol results,
  fake success messages, fake client compatibility, or hardcoded production
  state.
- A UI action must either execute a real backend operation or be hidden/disabled
  with a clear backend-backed reason. It must not pretend that a missing feature
  worked.
- Test fixtures and development clients are allowed only in automated tests and
  explicitly local development paths. They must never be reachable from
  production install scripts, deployed images, live admin UI, node agents, public
  subscription URLs, or official update pipelines.
- Public subscriptions must always be backed by a real user, license,
  subscription, node, host/profile where required, and renderable protocol. The
  backend must reject positive subscription flows that omit real required state.
- Protocol support is complete only after adapter validation, node-agent apply
  behavior, subscription rendering, client import compatibility, and live VPS
  verification all pass.
- Secrets, private keys, passwords, registry tokens, generated runtime configs,
  node tokens, subscription URLs, and access tokens must not be committed,
  logged, or stored in plaintext outside the approved secret storage path.
- Installer, upgrade, rollback, and deployment documentation must describe the
  real supported path only. Do not document manual fake setup as production
  installation.
- A parity item can be marked done only when current evidence proves it:
  code exists, tests cover the behavior, deployed images include it when
  production-facing, and live API/UI/node verification passes when the feature is
  runtime-facing.

## Review Checklist

Before committing or marking any item complete, verify:

- The implementation reads or writes authoritative state instead of local
  constants, placeholder arrays, mock fixtures, or generated demo data.
- The frontend calls the real HTTP client in production builds.
- The backend rejects incomplete positive flows instead of filling missing
  values with fake defaults.
- Tests use real domain entities for positive cases: user, license,
  subscription, node, profile/host/protocol where applicable.
- Live deployment was checked for production-facing changes through the official
  build and installer pipeline.

If any check fails, the work is incomplete.
