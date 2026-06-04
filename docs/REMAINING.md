# Remaining Work

This file must contain every known incomplete area before a handoff or release.

Primary execution tracker: `docs/EXECUTION_TRACKER.md`. Use that file for
task IDs, status, done criteria, evidence and the next implementation slice.
This file remains a broad backlog summary.

## Current

- As of 2026-06-04 / API `v0.1.127`, the authoritative
  `docs/EXECUTION_TRACKER.md` has no `OPEN`, `PARTIAL`, or `NEXT` rows left for
  backend/admin/node Remnawave parity. Do not restart old admin parity slices
  from this file without first checking the execution tracker and current live
  state.
- Protected admin surface live smoke exists at
  `scripts/live/admin-surface-smoke.py`. The latest prod run on
  `https://panel.lumentech.tel` checked real nodes/profiles/hosts/squads/users,
  subscriptions, settings, subscription assets, tools, infra billing, IP
  control and utility endpoints through a temporary real API key, with cleanup
  returning `0`.
- Remaining active product risk is now evidence depth rather than known missing
  admin buttons: keep re-running backend/admin/node live smoke after each
  release, and only reopen a parity item when a current live/API/UI check proves
  a real gap.
- `docs/PRODUCT_REALITY_CONTRACT.md` is the mandatory rule for all remaining
  work: no fake, mock, placeholder, demo-only, synthetic, or hardcoded
  production behavior may be shipped.
- All UI/API counters and lists must show the actual live installation state.
  If a feature has no real node/API/database backing yet, it must be unavailable
  with a real backend reason instead of showing seeded or presentational data.
- Every additional protocol regression or extension must be enabled in order:
  adapter, node-agent apply, subscription renderer, client import fixture, live
  VPS verification.
- Development API clients and fixtures must remain unreachable from production
  install scripts, deployed images, live admin UI, and public subscription URLs.
- Payment provider selection is intentionally deferred.
- Legal documents are deferred until external beta/commercial phase.

## Historical Audit Plan After v0.1.64

This section is retained as historical context. The active completion order and
status are now in `docs/EXECUTION_TRACKER.md`. A row can be considered closed
only after code, tests, official image release, public manifest promotion,
production upgrade, and live panel/node evidence where the feature touches
runtime behavior.

### 1. Release And Live Baseline

- Finish `v0.1.64` release for the generic OAuth2 provider slice.
- Confirm the public production manifest points at the pinned `v0.1.64`
  image digests.
- Run the official upgrade path against the panel VPS and node VPS.
- Live-smoke:
  - `/api/v1/health/ready`;
  - panel version and image tags;
  - node-agent version and image tag;
  - existing real profile apply still succeeds;
  - subscription admin lookup/clone/delete/devices/raw preview works on real
    records, not fixture rows;
  - generic OAuth2 is visible as implemented but remains inactive until real
    env/file-backed configuration is supplied.

### 2. Remnawave Screen Parity

- Profiles:
  - detail editor parity;
  - reorder;
  - computed config preview;
  - inbound list/global inbound registry;
  - protocol-specific builders;
  - JSON editor with validation;
  - auto-sync/runtime apply semantics after profile or host changes.
- Hosts:
  - release and live-smoke the locally closed full field model/API/UI/computed
    Xray override and public subscription renderer slice for path, SNI,
    security, mux, sockopt, xHTTP, subscription exclusions, internal squad
    exclusions, final mask/shuffle, Mihomo X25519, Xray template, tags and
    remarks;
  - continue target-specific polishing for any client formats that expose extra
    host metadata beyond current raw URI, Lumen JSON, Mihomo, sing-box and Xray
    JSON coverage;
  - bulk enable/disable/delete/set inbound/set port against real API;
  - detail editor parity;
  - reorder and validation.
- Users:
  - lookup by all Remnawave-style identifiers;
  - detail view with nodes, subscriptions, request history, metadata and
    devices/HWID;
  - enable/disable/revoke/reset traffic;
  - tags and bulk actions: delete by status, revoke, reset traffic, update,
    update squads, extend expiration.
- Squads:
  - internal squads CRUD, accessible-node matrix, inbound/profile bindings;
  - external squads CRUD, templates, headers, host overrides, HWID settings,
    custom remarks and subscription page config binding.
- Nodes:
  - UX polish over the already real node-management P0 actions;
  - node plugin CRUD/clone/reorder/executor;
  - stats, bandwidth, metadata, infra billing and provider history.
- Settings:
  - typed settings groups instead of generic key/value surfaces;
  - auth toggles, MFA/passkey flows and API token CRUD;
  - branding/auth method toggles when product naming is finalized.
- Subscription surface:
  - settings for title/support link/update interval/base JSON/profile page
    URL/Happ announce/routing/custom remarks/headers/random host order/rules;
  - template CRUD/reorder for Xray JSON, Mihomo, Stash, sing-box and Clash;
  - response rule editor/tester;
  - subscription page configs CRUD/clone/reorder;
  - protected admin API and public render targets parity.
- Tools:
  - top users;
  - fetch user IPs and node user IPs;
  - drop connections;
  - full Happ routing encryption;
  - X25519 generation;
  - torrent report management;
  - request history and HWID/device inspectors.

### 3. Runtime Protocol Closure

Each protocol must be closed in the same order: adapter validation, backend
profile payload, node-agent runtime apply, public subscription renderer, client
import fixture, official release, production node smoke, then Android/desktop
client evidence.

- Already live-validated slices must stay regression-tested:
  - Xray-family base runtime;
  - Shadowsocks/native and Shadowsocks 2022;
  - Hysteria2;
  - TUIC v5;
  - direct OpenVPN UDP;
  - OpenVPN-over-Shadowsocks.
- Still requiring real closure:
  - remaining Xray transport variants and host fields: WS, gRPC, HTTPUpgrade,
    xHTTP, Reality/TLS edge cases;
  - WireGuard/AmneziaWG with real key lifecycle and enforceable policy model;
  - IKEv2/IPsec;
  - NaiveProxy and HTTP/SOCKS edge compatibility;
  - Clash/Mihomo/Stash/sing-box/Happ/Hiddify/Amnezia subscription compatibility
    per target app.
- WireGuard/AWG torrent blocking must not be faked. It needs a real enforcement
  design such as nftables marks/routing or a clear unsupported policy status.

### 4. Client Compatibility

- Android:
  - import real production subscription URLs;
  - connect through each live-validated protocol;
  - verify portrait-only screens;
  - keep subscription URLs and secrets out of logs/storage/wiki.
- Windows:
  - add only after backend/node subscription formats are stable;
  - verify the same real protocol set instead of building against mocks.
- External clients:
  - maintain fixtures for Happ, Hiddify, Amnezia, Clash/Mihomo, Stash and
    sing-box;
  - subscriptions must include correct names, remarks, update intervals,
    headers and target-specific metadata.

### 5. License And Commercial Portal

- License server remains a separate product/repo.
- Before billing:
  - account login with authenticator 2FA;
  - license issue/renew/sync;
  - self-hosted panel login or manual key entry;
  - expired license behavior: existing <=3 nodes continue, extra nodes pause,
    VPN resumes after renewal, new changes blocked while expired.
- Payment provider/legal documents are deferred until the technical product is
  live-stable.

### 6. Non-Negotiable Rules

- No fake numbers, fake nodes, fake users, fake subscriptions or placeholder
  success states in production.
- If a feature is not real, the UI must hide it or show a backend-provided
  unavailable reason.
- Every production change ships through closed images, signed public manifest,
  official upgrade scripts and live validation.
- Local machine resource policy: keep local checks narrow; expensive web builds
  and broad suites should run in CI unless a focused local gate is required.
