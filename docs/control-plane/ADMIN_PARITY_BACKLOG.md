# admin parity Backlog

This backlog is the working contract for closing Lumen admin parity. Each item must be backed by real API, database state or external service state before it can be marked done. Production UI must not use fake counters or mock-only data.

The mandatory cross-project rule is `docs/PRODUCT_REALITY_CONTRACT.md`. This
backlog adds admin parity scope on top of that contract; it does not weaken
or replace it.

## Production Reality Contract

- Every deployed page, button, metric, subscription link, node action and API response must reflect real panel/node/database/external-service state.
- Test fixtures and development API clients are allowed only inside automated tests or explicitly local development paths; they must never be reachable from production install scripts, deployed images, live admin UI or public subscription URLs.
- A public subscription must always be attached to a real node and a renderable protocol/profile. The backend must reject subscriptions without a node or without a renderable protocol.
- Automated tests must seed real users, licenses, nodes and renderable protocols for positive flows. Missing-node or missing-protocol subscriptions are allowed only in negative validation tests that assert rejection.
- If a feature is not production-ready, the UI must hide it or mark it unavailable with a real backend status. It must not show fake success, fake counts, fake nodes, fake users or fake client compatibility.
- Any future parity item can be closed only after live VPS/API verification proves the state is real.

## Users

- Users list/create/edit/delete.
- Lookup by UUID, username, short UUID, email, numeric id, Telegram id, tag, and resolver endpoint.
- User actions: enable, disable, revoke, reset traffic.
- User detail with accessible nodes, subscriptions, subscription request history, metadata and devices/HWID.
- Tags and bulk actions: delete, delete by status, revoke subscription, reset traffic, update, update squads, extend expiration.

## Internal Squads

- CRUD for internal access-control squads.
- Detail page with accessible nodes and inbound matrix.
- Reorder, add users, remove users.
- Editable inbounds and profile bindings.

## External Squads

- CRUD for external subscription-behavior squads.
- Reorder, add users, remove users.
- Templates, subscription settings, response headers, host overrides, HWID settings, custom remarks and subpage config binding.

## Profiles

- Config profile CRUD and detail editor.
- Xray computed config preview, inbound list and global inbound registry.
- Profile reorder.
- JSON editor and protocol-specific builders.

## Hosts

- Host CRUD and detail editor.
- Reorder, tags and bulk enable/disable/delete/set inbound/set port.
- Full host fields: address, host, port, path, SNI, security, inbound, node binding, tag, remark, hidden/disabled flags, subscription exclusions, excluded internal squads, Xray JSON template, mux, sockopt, xHTTP, shuffle/final mask and Mihomo X25519.

## Nodes

- Node CRUD and management actions: enable, disable, restart, reset traffic, restart all, reorder.
- Bulk actions and profile modification.
- Node plugins CRUD, clone, reorder and executor.
- Node statistics, bandwidth table, metrics, metadata, infra billing and provider history.

## Settings, Auth And Tokens

- Typed Lumen/Lumen settings with validation.
- Auth status, login, register and MFA.
- OAuth2: Telegram, GitHub, PocketID, Google/generic OAuth2, Keycloak and future providers.
- Passkey registration/authentication.
- API tokens CRUD with scoped keys for automation and Telegram bot control.
- Branding/auth method toggles.

## Subscription Surface

- Subscription settings with title, support link, update interval, base JSON behavior, profile page URL, Happ announce/routing, custom remarks, response headers, random host order and response rules.
- Template CRUD and reorder for Xray JSON, Mihomo, Stash, Sing-box and Clash.
- Response rule editor and tester.
- Subscription page configs CRUD, clone and reorder.
- Protected subscription admin API: list, by UUID, username, short UUID, raw, connection keys and subpage config.
- Public subscription API: base subscription, info and per-client render targets.

## Tools

- HWID inspector, stats, top users, delete device and delete all.
- Subscription request history inspector and stats.
- Torrent blocker reports and truncate.
- Sessions explorer/IP control: fetch user IPs, fetch node user IPs and drop connections.
- Utility APIs: Happ routing encryption and X25519 generation.
- System overview APIs: health, metadata, stats, recap and bandwidth.
- Snippets CRUD.
- Node key generation without logging or storing generated secrets in plaintext.
