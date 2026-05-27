Build Lumen VPN as a commercial self-hosted VPN control-plane product with a separate central license/billing server and public installer/docs repo. Current state: live v0.1.0 foundation exists on two VPS; GHCR v0.1.0 images are built, verified, and pulled on panel/node; node enrollment and heartbeat work. Finish the project end-to-end in phases without requiring more user decisions unless truly blocked.

Scope to implement:
1. Self-hosted panel/control plane in D:\lumen-work\full-revna-like-projekt: real auth, sessions, API keys, MFA/TOTP scaffold, RBAC, audit log, users, licenses, subscriptions, nodes, protocol/profile/host/squad models, settings, API contracts, background jobs, node command queue, metrics, pause/resume semantics, port conflict policy, protocol installation pipeline, subscription renderers, tests.
2. Node agent in same repo: command polling, apply config, protocol runtime scaffolds, safe pause/resume, health/metrics reports, port conflict checks, landing page fallback support, secure token storage, tests.
3. Admin UI in same repo: Remna-like but Lumen-branded full functional screens wired to backend: dashboard, users, internal/external squads, profiles, hosts, nodes, Remnawave settings, subscription settings/templates/rules/page, tools, API tokens, auth providers, warnings/errors.
4. Public installer/docs repo D:\lumen-work\lumen_vpn: install.sh, install-node.sh, upgrade.sh, rollback, backup/migrations, release manifest, pinned images, GHCR auth, docs, troubleshooting, two-server live smoke path.
5. License server repo D:\lumen-work\lumen-license-server: commercial license portal scaffold with auth/MFA, account/license APIs, free <=3 nodes policy, offline grace, sync API, UI, tests. Payment can remain scaffolded until later, but license policy must be real enough for control-plane integration.
6. Client compatibility repo D:\lumen-work\rim2393-lumen-client: acceptance fixtures for generated subscriptions; Android integration is later but fixtures must exist.

Constraints:
- Do not leak secrets. Do not commit tokens/passwords/runtime configs.
- Keep source private where intended; public repo must contain only installer/docs/manifests, no private source.
- Work sequentially by stories, but use subagents for independent slices. Test after each meaningful step.
- Do not call the product complete until final verification, security review, code review, and live smoke pass.
