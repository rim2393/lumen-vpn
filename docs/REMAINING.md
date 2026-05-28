# Remaining Work

This file must contain every known incomplete area before a handoff or release.

## Current

- Remnawave parity is still being closed screen by screen; no admin-visible
  item may be marked complete without a real API, database state, or external
  service state behind it.
- `docs/PRODUCT_REALITY_CONTRACT.md` is the mandatory rule for all remaining
  work: no fake, mock, placeholder, demo-only, synthetic, or hardcoded
  production behavior may be shipped.
- Every additional protocol must be enabled in order: adapter, node-agent apply,
  subscription renderer, client import fixture, live VPS verification.
- Development API clients and fixtures must remain unreachable from production
  install scripts, deployed images, live admin UI, and public subscription URLs.
- Payment provider selection is intentionally deferred.
- Legal documents are deferred until external beta/commercial phase.
