# GitHub Actions Billing And Release Unblock

This runbook is the required recovery path when GitHub-hosted Actions refuse to
start jobs for `rim2393/lumen-vpn` because of account
billing/spending limits.

The blocker is external to the codebase: product quality and image workflows
fail before any job step starts. Do not treat those runs as test failures and do
not claim normal CI/CD is healthy until the account billing state is fixed and
the workflows pass on GitHub-hosted runners.

GitHub tracker issue: <https://github.com/rim2393/lumen-vpn/issues/1>.

## Current Blocker Evidence

- `Quality gates` run `26957467443` failed in 5 seconds before job execution.
- `Build release images` run `26957467136` failed in 6 seconds before job
  execution.
- Earlier runs `26956499317`, `26956500694`, `26957155650` and
  `26957156032` show the same pre-job failure pattern.

## Owner Action

Only a GitHub account or organization owner can remove this blocker.

1. Open GitHub account or organization `Billing & plans`.
2. Fix any failed payment method, spending limit, Actions minutes or billing
   hold that prevents GitHub-hosted Actions from starting.
3. Confirm Actions are allowed for the private product repository.
4. Keep repository secrets unchanged unless rotating them deliberately through
   the approved ops secret process.

## Product CI Recovery

After billing/spending is fixed:

1. Rerun the latest failed `Quality gates` workflow on `main`.
2. Confirm the `Validate backend/admin/node release guard` job runs
   `python scripts/validate_release_guard.py` and passes.
3. Rerun the latest failed `Build release images` workflow on `main`.
4. Confirm API, web, subscription and node-agent images are built and verified.
5. Confirm tag or workflow-dispatch release paths fail closed when
   `LUMEN_PUBLIC_REPO_TOKEN` is missing, and dispatch the public installer
   signed-manifest workflow when the token is present.
6. Record the passing run ids in `docs/EXECUTION_TRACKER.md`.

## Release Signing Secret Recovery

The release signing private key must be a durable CI/ops secret, not a
developer-local, panel-host or node-host temporary key.

Required secret-backed state:

- product repo secret `LUMEN_PUBLIC_REPO_TOKEN`;
- public installer repo secret `LUMEN_RELEASE_SIGNING_KEY`;
- public installer repo secret or variable `LUMEN_RELEASE_SIGNING_KID`;
- deployed public verification key matches the signed manifest.

Verification:

1. Trigger a signed public installer manifest publish from the product release
   workflow.
2. Validate the produced manifest with the public installer
   `scripts/validate-manifest.sh`.
3. Verify `release/prod.json` points to digest-pinned product images.
4. Verify the real panel upgrade accepts the signed manifest.
5. Verify no signing private key exists on the panel host, node host or
   committed worktrees.

Never write the signing private key, personal access token, registry token or
raw secret value into docs, wiki, logs, issues or commits.

## Manual Fallback While Blocked

Manual image promotion is allowed only while GitHub-hosted Actions remain
blocked by billing/spending and only as a controlled production fallback.

Manual fallback requirements:

- image references must be digest-pinned;
- public installer manifest must be signed and validated;
- panel/node deployment must use the official upgrade scripts;
- `scripts/live/run-admin-surface-smoke-on-panel.sh` must pass on the real
  panel after deployment;
- cleanup must return `0` for temporary records and `/tmp/lumen-*` artifacts;
- node VPS must stay clean and contain no admin checkout, installer checkout,
  build worktree or smoke script;
- evidence must be recorded in `docs/EXECUTION_TRACKER.md`.

Manual fallback is not a replacement for restoring normal CI/CD.
