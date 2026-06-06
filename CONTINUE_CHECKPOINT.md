# Continuation Checkpoint

Last audited: 2026-06-01 21:28 Europe/Moscow.

## Current Working Copy

- Repo: `D:\android-app-new\_work\full-revna-like-projekt`
- Main branch state: dirty with local `generic_oauth2` auth-provider parity
  changes ready to commit.
- Current signed public production manifest: `v0.1.63`.
- `v0.1.63` closed-image release succeeded, and `lumen_vpn` commit `5df4327`
  promoted `release/prod.json` to `v0.1.63`.
- Automatic production deploy failed after manifest promotion because the
  production VPS stopped answering external TCP checks. Local Windows checks
  timed out on panel HTTPS and SSH ports; GitHub Actions failed during the SSH
  deploy step. Do not bypass the official signed manifest/upgrade process; the
  next live step is to restore VPS/provider firewall reachability and rerun the
  official upgrade smoke.
- OpenVPN-over-Shadowsocks backend/node runtime is live-validated on production
  through the official closed-image, public signed manifest, public panel
  upgrade, and public node installer flow.
- Live production panel and node were validated on `v0.1.49` through the official closed-image, public signed manifest, and public node installer flow.
- 5.3 added backend domains/routes/migrations for:
  - `metrics`
  - `ip_control`
  - `node_plugins`
  - `infra_billing`
- 5.3 added frontend/API wiring for:
  - `/node-plugins`
  - `/infra-billing`
  - dashboard sections
  - partial RU localization for dashboard/nodes/hosts/squads/settings/new pages
  - local-only development fixtures behind `VITE_LUMEN_USE_FIXTURES`
- 2026-06-01 integration added real policy wiring:
  - profile apply now embeds effective `nodePolicy` into `outbound.apply`.
  - enabled global/node plugins are included in the command payload.
  - global/user IP-control rules are included in node/subscription policy metadata.
  - Xray configs get real block routing for `torrent-blocker`, `domain-filter`, and `geoip-filter` plugins.
  - node-agent validates and writes `lumen.node-policy.v1` policy artifacts during runtime apply.
- 2026-06-01 native subscription/runtime pass:
  - public `lumen-json` manifests now include concrete per-subscription credentials derived by the same backend renderer helper as Happ/Hiddify/sing-box outputs.
  - Android parses `lumen.subscription-manifest.v1` into real connectable `ServerProfile` entries instead of ignoring the native manifest.
  - profile apply resolves active real subscriptions for the profile/node and replaces `clientsRef` with concrete runtime clients for Xray/Hysteria2/TUIC/WireGuard payload builders where supported.
- 2026-06-01 protocol contract pass:
  - Android `wireguard://` imports now materialize a native WireGuard `.conf` before a profile is considered connectable.
  - Incomplete `wireguard://` links are importable but explicitly not connectable; they no longer fall through as empty sing-box/WireGuard runtime configs.
  - JS `@lumen/protocol-registry` now exposes live plan adapters for `trojan`, `shadowsocks`, `wireguard`, and `hysteria2` instead of leaving them catalog-only.
  - JS `@lumen/subscription-renderers` now renders real derived-credential sing-box/Mihomo client configs for `trojan`, `shadowsocks`, and `hysteria2`; `wireguard` remains intentionally rejected there until real key material is available.
- 2026-06-01 live release hardening pass:
  - `v0.1.35` added real license sync/update API and live-validated activation without direct DB edits.
  - `v0.1.36` fixed Xray multi-inbound apply so applying one Xray-family profile no longer drops sibling inbounds on the same node.
  - `v0.1.37` made HWID/device limits real on public subscription requests.
  - `v0.1.38` added node-authenticated event ingestion for plugin/torrent reports.
  - `v0.1.39` added node-agent runtime log telemetry from real policy files and persisted offsets.
  - `v0.1.40` added Xray inbound sniffing for torrent-blocker enforcement and live-validated blackhole routing plus `xray -test`.
  - `v0.1.41` added sing-box policy enforcement for Hysteria2, TUIC, NaiveProxy, and sing-box Shadowsocks 2022. Live validation applied a real `shadowsocks-2022` profile with the global torrent-blocker policy, confirmed the generated sing-box config contains a `block` outbound plus `route.rules[0].protocol=["bittorrent"]`, passed `sing-box check -c`, and confirmed the live TCP listener.
  - `v0.1.49` completed the first real direct OpenVPN UDP runtime slice. The node-agent image contains OpenVPN, public node compose mounts `/dev/net/tun`, installer persists host `net.ipv4.ip_forward=1`, backend generates per-profile OpenVPN PKI and concrete subscription username/password runtime users, public Happ/raw render emits a real `.ovpn`, and node-agent starts a managed OpenVPN process instead of returning scaffold/dry-run status. Live validation on the real panel/node reapplied the real OpenVPN profile on UDP `24103`, confirmed a live UDP listener, confirmed one idempotent NAT MASQUERADE rule for `10.90.3.0/24`, confirmed auth script execution as `nobody`, and connected a disposable OpenVPN client container through the rendered subscription to `Initialization Sequence Completed`.
  - `v0.1.55` completed the real OpenVPN-over-Shadowsocks bridge slice. It added `openvpn-shadowsocks` catalog/profile payload support, a dedicated `openvpnShadowsocksConfig` node payload, node command validator support, edge forwarding for public subscription device identity, Lumen native/raw `.ovpn` render support with `socks-proxy`, and explicit rejection for generic sing-box/Mihomo/Xray exports that cannot honestly represent the two-layer client path. The node-agent starts public `ssserver` plus OpenVPN TCP bound to loopback, restores both managed processes after container restart, and repairs parent-directory traversal so OpenVPN `nobody` auth can read the runtime users file after restore.
  - CI fix `16aa332`: branch push image builds no longer dispatch the public installer/prod deploy pipeline. Only workflow dispatch/tag releases should change `release/prod.json`.
- 2026-06-01 Clash/Mihomo Android pass:
  - supported Clash aliases now become concrete runtime profiles: `hy2` -> Hysteria2, TUIC hyphen fields -> runtime keys, SOCKS4/SOCKS4A version preserved, packet-encoding normalized.
  - `clash://install-config?url=<inline-yaml>` now decodes form-encoded spaces only for structured inline Clash payloads while keeping normal subscription URL token handling unchanged.
- 2026-06-01 Remnawave parity P0 node-management pass:
  - added `docs/REMNAWAVE_PARITY_AUDIT.md` as the screen/API/function parity ledger.
  - backend nodes API now includes update, soft delete, reorder, restart,
    restart-all, reset-traffic and bulk node actions.
  - node-agent command envelope now supports real `node.restart` and
    `node.traffic.reset` commands.
  - web Nodes page exposes the new actions and uses pause/resume commands for
    enable/disable instead of status-only UI mutations.
  - Alembic head advanced to `0009_node_management_parity`.
  - restart semantics corrected for the actual Docker node-agent deployment:
    attempts to restart through systemd and then shell `kill` against PID 1
    were rejected by live VPS evidence. The working implementation in
    `v0.1.59` schedules `process.exit(0)` after command result submission, so
    Docker `restart: unless-stopped` restarts the real container.
- 2026-06-01 Profiles parity follow-up:
  - Profiles UI now exposes Apply in table, card and detail views.
  - Apply uses `POST /api/v1/profiles/{profile_id}/apply-to-node` and queues
    the real `outbound.apply` node command.
  - Added web API-client contract coverage for the production endpoint and
    completed a live `v0.1.60` smoke through panel API and node-agent.
- 2026-06-01 Hosts validation follow-up:
  - Host create no longer falls through to `node_id=""`; the UI blocks submit
    with a translated error when no node is selected.
  - Host editor blocks empty node before save and validates port as integer
    `1..65535`.
  - Host bulk set-port validates integer `1..65535` before mutation and shows a
    translated error hint.
- 2026-06-01 Subscription create follow-up:
  - Removed the static panel-domain `server_name` default from the create form.
  - If `server_name` is omitted, the UI derives it from the selected host
    hostname or selected node public address before creating the backend record.
  - Exposed backend `expires_at` and `config_hash` fields in the create form.
- 2026-06-01 Subscription admin parity follow-up:
  - Backend subscriptions API now includes lookup by public ID, subscription
    UUID prefix, username, email, and display name, plus an explicit
    `/by-short-uuid/{short_uuid}` route.
  - Backend subscriptions API now includes clone, hard delete, admin raw render
    preview coverage, and subscription-scoped device/HWID listing.
  - Web subscriptions page now exposes real production API controls for lookup,
    Clone, Delete, Devices, and Raw preview.
  - RU translation coverage was extended for the new production UI strings; the
    production reality test remains the guard against partial translation.
- 2026-06-01 Auth provider parity follow-up:
  - `generic_oauth2` is no longer catalog-only/read-only locally. It is in the
    implemented provider set and becomes `active` only when real env/file-backed
    OAuth2/OIDC configuration exists.
  - The OAuth runtime supports either OIDC discovery through
    `generic_oauth2_issuer` or explicit authorization/token/userinfo endpoints.
  - Client secrets remain env/file-backed through
    `generic_oauth2_client_secret` or `generic_oauth2_client_secret_file`; panel
    metadata still rejects inline secret-like fields.
  - Custom userinfo fields are supported for subject, email, verified flag, and
    display name.

## Verification Done

- API ruff: passed.
- API pytest: `114 passed`.
- API pytest after native manifest/runtime pass: `116 passed, 2 skipped`.
- Web TypeScript: `cmd /c npx tsc -b` passed.
- Web production build: `cmd /c npm run build` passed.
- Node agent: `node --test` passed, `60 passed`.
- Android: `:app:testDebugUnitTest` passed with the workspace JDK. Focused `SubscriptionParserTest`, `:app:assembleDebug`, and `:app:assembleRelease` also passed after the WireGuard URI fix.
- JS package gates after live contract sync: `packages/protocol-registry npm test` passed; `packages/subscription-renderers npm test` passed.
- Android focused gate after Clash/Mihomo conversion: `SubscriptionParserTest` and `SubscriptionSourceResolverTest` passed; `:app:assembleDebug` and `:app:assembleRelease` passed.
- Node-agent gate after runtime telemetry: `node --test`, 86 passed.
- API gate after Xray sniffing enforcement: full API `pytest tests`, 142 passed; focused ruff clean.
- Node-agent gate after sing-box policy enforcement: `node --test`, 90 passed.
- Node-agent gate after managed OpenVPN-over-Shadowsocks restore/auth fixes: `node --test`, 97 passed.
- OpenVPN-over-Shadowsocks gates before live completion: API full `pytest tests`,
  146 passed and 2 skipped; node-agent full `node --test`, 97 passed; scoped
  ruff on changed API files passed; protocol-registry, subscription-schema,
  lumen-edge, and subscription-renderers package tests passed.
- Node-management parity local gates: API scoped pytest from `apps/api` passed
  (`6 passed`), scoped API ruff passed, node-agent focused command tests passed
  (`30 passed`), web `NodesPage.test.tsx` passed, and web production build
  passed.
- Node-management restart fix gate after the live Docker PID 1 issue:
  node-agent full `node --test`, 99 passed.
- Profiles Apply local gates: web TypeScript passed; `httpClient.test.ts` passed
  with 3 tests; `productionReality.test.ts` + `httpClient.test.ts` passed with
  10 tests; `NodesPage.test.tsx` regression passed with 3 tests; web production
  build passed.
- Hosts validation local gates: web TypeScript passed; `productionReality.test.ts`
  passed with 7 tests; web production build passed.
- Subscription create local gates: web TypeScript passed;
  `productionReality.test.ts` passed with 7 tests; web production build passed.
- Subscription admin parity local gates: scoped API ruff passed; API
  `test_license_subscription_routes.py` passed with 17 tests; web TypeScript
  passed; web `httpClient.test.ts` plus `productionReality.test.ts` passed with
  11 tests; web production build passed.
- Auth provider parity local gates: scoped API ruff passed; API
  `test_auth_extensions_routes.py` plus `test_control_plane_foundation_routes.py`
  passed with 34 tests and 2 skips; web TypeScript passed.
- Live prod evidence after `v0.1.40`: panel `LUMEN_VERSION=v0.1.40`, node-agent image pinned to `v0.1.40`, HTTP-proxy profile apply succeeded with `dryRun=false`, Xray config contains `blackhole`, `protocol=["bittorrent"]`, sniffing on all active inbounds, and `xray -test` passed.
- Live prod evidence after `v0.1.41`: panel `LUMEN_VERSION=v0.1.41`, node-agent image pinned to `v0.1.41`, `shadowsocks-2022` profile apply succeeded with `dryRun=false`, node policy applied, generated sing-box Shadowsocks config contains the policy block route, `sing-box check -c` passed against the live config, and TCP `24081` listened on the node.
- Live prod evidence after `v0.1.49`: panel `LUMEN_VERSION=v0.1.49`, node-agent image pinned to `v0.1.49`, public installer persisted host IP forwarding, direct OpenVPN UDP profile apply succeeded with `dryRun=false`, node listened on UDP `24103`, OpenVPN auth files were readable/executable by the dropped `nobody` user without exposing raw credentials, NAT had exactly one `10.90.3.0/24` MASQUERADE rule after repeated apply, and a disposable OpenVPN client connected from the panel VPS using the rendered subscription.
- Live prod evidence after `v0.1.55`: panel `LUMEN_VERSION=v0.1.55`, node-agent image pinned to `v0.1.55`, public subscription endpoint forwards `device_id`/`hwid` to the API, OpenVPN-over-Shadowsocks manifest includes `rendererHints.method=aes-256-gcm`, node listens on public TCP `28443` for `ssserver` and loopback TCP `127.0.0.1:24194` for OpenVPN, restore starts both bridge processes after container recreation, parent runtime directories are traversable by the dropped OpenVPN user, and a disposable Alpine client downloaded the public `sub.*` Happ/OpenVPN profile, started `sslocal`, connected OpenVPN through Shadowsocks, and reached `Initialization Sequence Completed`.
- Live prod evidence after `v0.1.57`/`v0.1.58`: panel/node upgrade path worked, node `reset-traffic` completed with `implementationStatus=node-traffic-reset`, but restart evidence proved shell-based `kill -TERM 1` and `kill -KILL 1` did not actually restart the running container. These versions are not accepted for node restart closure.
- Live prod evidence after `v0.1.59`: panel `LUMEN_VERSION=v0.1.59`, web/api/subscription images pinned to `v0.1.59` and healthy, node-agent image pinned to `v0.1.59`, `node.traffic.reset` completed with `implementationStatus=node-traffic-reset`, `node.restart` completed with `implementationStatus=node-agent-restart-scheduled` and command `process.exit(0)`, and the real container restarted from `StartedAt=2026-06-01T16:39:20.843014313Z` to `StartedAt=2026-06-01T16:40:27.775375566Z` while staying on image digest `sha256:4425bdcab9a051352b3743e984005323f095adf9c16feaf91b2959b269bb58ab`.
- Live prod evidence after `v0.1.60`: panel `LUMEN_VERSION=v0.1.60`,
  web/api/subscription images healthy, profile
  `407469f7-bc40-471a-9916-374339d34b73` Apply returned queued
  `outbound.apply` command `f579715a-dc66-47da-9f1c-8b46b31f3bfa` for node
  `d40a27ae-29fa-4cd1-88ee-269957de1e30`; after node-agent polling the command
  became `succeeded` with result status `succeeded` and implementation
  `openvpn-shadowsocks-managed-process-started`.
- Live prod evidence after `v0.1.61`: panel `LUMEN_VERSION=v0.1.61`,
  web/api/subscription images healthy and `/api/v1/health/ready` returned ok.
  This deploy contains the Hosts UI-side validation guard. Browser navigation
  reached `/hosts`, but the in-app session was expired and showed operator
  session restoration; interactive UI smoke still needs an authenticated browser
  session.
- Live prod evidence after `v0.1.62`: panel `LUMEN_VERSION=v0.1.62`,
  web/api/subscription images healthy and `/api/v1/health/ready` returned ok.
  This deploy contains subscription create changes: no static panel-domain
  `server_name`, derived host/node `server_name`, and exposed `expires_at` plus
  `config_hash`.
- Live prod evidence for `v0.1.63`: images and signed public manifest are
  published, but VPS upgrade/smoke is blocked by network reachability timeout
  to the production host.
- Live prod evidence for release
  `main-0da5ae39ecef256671af592411622b4ac74e8b46`: official signed
  publish/deploy workflow completed successfully; panel `.env` and running
  containers show API/Web/Subscription on the pinned release; node-agent was
  aligned to the same pinned image. HApp Shadowsocks rendering now decodes to
  `aes-256-gcm`, matching the live Xray Shadowsocks inbound on TCP `18446`.
  A temporary Xray client inside the node-agent container connected through the
  live Shadowsocks inbound and received HTTP 204 from an external endpoint.
- Live prod evidence for release
  `main-415455871aa3e4ca205b46ecd9872d4199da451f`: official signed
  publish/deploy workflow `27057014986` completed successfully. Public
  subscription browser pages now use the real short raw client endpoint for
  HApp import, QR and copy payloads instead of using the HTML page URL as the
  application payload. Live `https://sub.lumentech.tel/sub/.../happ?hwid=...`
  evidence: `Добавить подписку` has a `happ://add/https%3A%2F%2Fsub.lumentech.tel%2Fsub%2F...%2Fhapp%3Fhwid%3D...%26raw%3D1`
  href, QR SVG is present with a viewBox, copy URL is `/sub/.../happ?...&raw=1`,
  the raw endpoint returns real `text/plain` protocol output, and no internal
  `/api/v1/subscriptions/public/` URL leaks into the public HTML.
- Live prod evidence for release
  `main-c0abd0be724cc3bc9cc972de707a79b9920c039d`: official signed
  publish/deploy workflow `27057177883` completed successfully. Users directory
  rows now open real `/users/{id}` detail routes by mouse and keyboard while
  ignoring checkbox/button/link clicks inside the row. Live
  `https://panel.lumentech.tel/users` evidence: 15 real checkbox controls, no
  API-key error, selecting the first checkbox stays on `/users`, clicking row
  `Открыть QA HApp Squad` opens
  `/users/f35df075-1d60-4983-8038-541e50a1b2a3`, and that real detail route
  shows the user editor, issued subscriptions and HWID/device sections.
- Live prod evidence for release
  `main-c16b7b749d2014ec7f4de1b9b5b3aca75acaa24d`: official signed
  publish/deploy workflow `27057395329` completed successfully. User detail
  layout now keeps the editor and side panels in a two-column desktop layout at
  1080px instead of collapsing early. Live
  `/users/f35df075-1d60-4983-8038-541e50a1b2a3` evidence: workspace grid
  `689px 320px`, editor panel `left=20 top=928 width=689`, side panel
  `left=725 top=928 width=320`, document height reduced from 2378 to 2092,
  user editor form semantics are present (`email` autocomplete, `username`
  name, Telegram numeric input mode, new-password autocomplete,
  `metadata_json` name), and no API-key error is visible.
- Live prod evidence for release
  `main-eb60ca43550fb3e5df19c250a29dc3752b0bb2f7`: official signed
  publish/deploy workflow `27057593252` completed successfully. Tools user-IP
  and node-user-IP tables no longer format row separators with visible mojibake
  `В·`; source now uses the real middle dot. Live panel JS asset
  `/assets/index-DSOse94a.js` contains neither `В·` nor escaped
  `\u0412\u00b7`.
- Live prod evidence for release
  `main-f5f139502dc94e297b95f09d37a26e9f4ef6bda7`: official signed
  publish/deploy workflow `27058042519` completed successfully. NodePlugins,
  Nodes and Subscriptions destructive deletes now use inline production API
  confirmations instead of native browser `confirm(...)`. Local gates passed:
  web focused Vitest (`37 passed`), API subscription browser-page pytest
  (`1 passed` from `apps/api`), web production build, release guard,
  production reality guard, and `git diff --check`. Live public subscription
  evidence on `https://sub.lumentech.tel/sub/.../happ?hwid=...` with browser
  `Accept`: status 200, `text/html; charset=utf-8`,
  `x-lumen-subscription-page=browser`, inline SVG QR present, `data-raw-url`
  present, HApp `happ://add/...raw=1` present, `window.location.href =
  link.href` present, and no `src="data:image...` QR fallback. Live raw HApp
  endpoint status 200, `text/plain; charset=utf-8`,
  `x-lumen-render-target=happ`, and real protocol output includes `vless://`,
  `trojan://`, and `ss://`. Live admin asset `/assets/index-BoRcw4Mm.js`
  contains no native confirm calls and contains inline delete confirmation copy
  for nodes, node plugins and subscriptions.
- Live prod evidence for release
  `main-ce279538cd1ada17f59ddc21491d0b4a41da3adf`: official signed
  publish/deploy workflow `27058474033` completed successfully. User detail
  now keeps the real user PATCH form and real device/HWID actions, collapses
  advanced `metadata_json`, bounds dense user detail tables, and wires
  per-subscription actions directly from the user detail surface: copy public
  page URL, copy HApp raw URL, clone subscription, revoke subscription with
  inline production confirmation, and delete subscription with inline
  production confirmation. Local gates passed: focused
  `ControlPlaneScreens.test.tsx` Vitest (`30 passed`), TypeScript build,
  web production build, release guard, production reality guard, `git
  diff --check`, and source grep found no native browser confirmation calls
  in page/shared code. Live evidence: panel root returned assets
  `/assets/index-D2lHqRQv.js` and `/assets/index-102J8BNc.css`; JS contains
  `Clone subscription {id}`, `Copy HApp raw subscription {id}`, and
  `Advanced metadata JSON`; CSS contains `subscription-row-actions` and
  `advanced-json-panel`; JS contains no `window.confirm`,
  `globalThis.confirm`, or `.confirm(`; `/api/v1/health/ready` returned
  status 200 with API dependency ok.
- Live prod evidence for release
  `main-df400f30dadd3fa5bf1e71a1796144fdfea50abb`: official signed
  publish/deploy workflow `27059270056` completed successfully. Subscription
  page config operations now use real typed API forms with collapsed
  renderer/config JSON, stable field names for browser/password-manager
  semantics, bounded tables/code panels, and inline production API
  confirmation before deleting a real subscription page config. Local gates
  passed: focused `ControlPlaneScreens.test.tsx` Vitest (`30 passed`),
  TypeScript build, web production build, release guard, production reality
  guard, and `git diff --check`. Product GitHub runs succeeded:
  `Quality gates` `27058770673` and `Build release images` `27058770657`.
  Live evidence: `/api/v1/health/ready` returned `ok`; `/subscription-page`
  returned assets `/assets/index-uodQ-W-q.js` and
  `/assets/index-CEE70ukC.css`; JS contains `Delete subscription page config`,
  `Renderer JSON`, `Config JSON`, and `Selected config JSON`; CSS contains
  `subscription-public-page` and `subscription-config-confirm`; JS contains
  no `window.confirm`, `globalThis.confirm`, or `.confirm(` native browser
  confirmation calls.
- Live prod evidence for release
  `main-7514f32c75f080d5e36e1ecc73aa83beded7d701`: official signed
  publish/deploy workflow `27060005431` completed successfully. Settings now
  avoids loading MFA/passkey APIs on first paint; the real security methods
  panel loads on operator action. MFA/passkey deletion uses inline production
  API confirmation before calling the real delete mutations. Subscription
  delivery JSON is collapsed by default, settings fields have stable form
  names and numeric input hints, the broken `api готов` badge key is replaced
  by translated `api ready`, and settings cards/registry/provider cards are
  bounded for medium/mobile widths with `content-visibility` on heavy cards.
  Local gates passed: focused `ControlPlaneScreens.test.tsx` Vitest
  (`30 passed`), TypeScript build, web production build, release guard,
  production reality guard, and `git diff --check`. Product GitHub runs
  succeeded: `Quality gates` `27059485000` and `Build release images`
  `27059484986`. Live evidence: `/api/v1/health/ready` returned `ok`;
  `/settings` returned assets `/assets/index-CeAghXrO.js` and
  `/assets/index-DeoIYgi8.css`; JS contains `Open security methods`,
  `Load on demand`, `Delete security method`, `settings-security-loader`,
  `settings-security-confirm`, and `settings-advanced-json`; CSS contains
  `settings-security-loader`, `settings-security-confirm`,
  `settings-advanced-json`, and `content-visibility`; JS contains no
  `window.confirm`, `globalThis.confirm`, or `.confirm(` native browser
  confirmation calls. This is not full Remnawave Settings completion; it is
  the first production hardening slice for Settings.
- Live prod evidence for release
  `main-5f9cf0657204d3cc047e33d67790299dd3b08a33`: official signed
  publish/deploy workflow `27060633507` completed successfully. Tools now
  requires inline production API confirmation before real destructive
  operations: HWID device delete, clear all devices, user/node IP connection
  drop, session revoke, torrent report truncate, and tool snippet delete.
  The Tools page is scoped as `tools-page`, the main/summary columns and dense
  tables are bounded, the layout collapses to one column on medium widths, and
  the snippet editor uses a full-width content textarea instead of a cramped
  three-column row. Local gates passed: focused
  `ControlPlaneScreens.test.tsx` Vitest (`30 passed`), TypeScript build, web
  production build, release guard, production reality guard, `git
  diff --check`, and source grep found no native browser confirmation calls
  in page/shared code. Product GitHub runs: `Quality gates` `27060175065`
  succeeded; first `Build release images` `27060175064` failed while pulling
  BuildKit from Docker Hub (`registry-1.docker.io` timeout), then rerun for
  the same SHA succeeded. Live evidence: `/api/v1/health/ready` returned
  `ok`; `/tools` returned assets `/assets/index-CeeYHXEs.js` and
  `/assets/index-CDLGnNzj.css`; JS contains `tools-page`,
  `tools-confirm-panel`, and `Production API confirmation`; CSS contains
  `tools-page` and `tools-confirm-panel`; JS contains no `window.confirm`,
  `globalThis.confirm`, or `.confirm(` native browser confirmation calls.
  This is not full Remnawave Tools completion; it is the destructive-action
  and layout hardening slice.
- Live prod evidence for release
  `main-61a3db85e08ec4b5adee5c10066b47e35514ee90`: official signed
  publish/deploy workflow `27061065560` completed successfully. Nodes now
  requires inline production API confirmation before dangerous operations:
  disable, pause, quarantine, node restart, node traffic reset, restart all,
  reset all traffic, and pause all. Selected-node protocol management is a
  real checkbox assignment matrix backed by
  `/api/v1/nodes/{id}/protocol-selection`; it displays adapter, profile
  status, runtime sync, pending enable/disable counts, discard changes, and
  queues real runtime apply/remove commands only through `Update protocols`.
  The Nodes page is scoped as `nodes-page` with bounded tables and responsive
  one-column medium/mobile layout. Local gates passed: focused
  `NodesPage.test.tsx` + `NodePluginsPage.test.tsx` Vitest (`9 passed`),
  `ControlPlaneScreens.test.tsx` Vitest (`30 passed`), TypeScript build, web
  production build, release guard, production reality guard, `git
  diff --check`, and source grep found no native browser confirmation calls
  in page/shared code. Product GitHub runs succeeded: `Quality gates`
  `27061031177` and `Build release images` `27061031173`. Live evidence:
  `/api/v1/health/ready` returned `ok`; panel root returned assets
  `/assets/index-fsknoW3J.js` and `/assets/index-4KJyZif3.css`; JS contains
  `node-protocol-matrix`, `Toggle protocol`, `pending changes`, and
  `node-action-confirm`; CSS contains `nodes-page`, `node-protocol-matrix`,
  and `node-action-confirm`; live browser `/nodes` showed no API-key error,
  real node inventory, selected live node
  `/nodes?focus=d40a27ae-29fa-4cd1-88ee-269957de1e30`, protocol matrix with
  46 real rows, `Update protocols`, and `Перезапустить все` opened inline
  production API confirmation instead of firing immediately. Scoped cancel
  closed the confirmation.
- Live prod evidence for release
  `main-6bfa41b3e566c9fcdb09c57f0baeae16ca1572ed`: official signed
  publish/deploy workflow `27061583696` completed successfully. Tools
  snippets edit flow is no longer a stale-row save. The Snippets surface now
  uses explicit row `Edit`, real editor state with stable `snippet_name`,
  `snippet_language`, and `snippet_content` fields, `Create snippet` for
  drafts, `Save changes` for the selected saved snippet, `New snippet` for
  reset, and editor cleanup after deleting the selected snippet. The Tools
  toolbar uses wrapping flex layout. Local gates passed: focused
  `ControlPlaneScreens.test.tsx` Vitest (`30 passed`), TypeScript build, web
  production build, release guard, production reality guard, `git
  diff --check`, and source grep found no native browser confirmation calls
  in page/shared code. Product GitHub runs succeeded: `Quality gates`
  `27061550067` and `Build release images` `27061550070`. Live evidence:
  `/api/v1/health/ready` returned `ok`; panel root returned assets
  `/assets/index-DlNoyRCT.js` and `/assets/index-BM7Cg-is.css`; JS contains
  `Save changes`, `Edit saved snippet`, `New snippet`, and `snippet_name`;
  CSS contains `.tools-page .toolbar` and `flex-wrap`; live browser `/tools`
  Snippets tab showed no API-key error and no `Tools unavailable`. A temporary
  QA snippet was created through the live UI, edited from the form, saved
  through `Save changes`, verified in the live table with the new name/content,
  then deleted through inline production API confirmation. Final live check
  showed `No snippets stored.`, no QA snippet residue, and draft editor fields
  present.
- Alembic heads: single head `0009_node_management_parity` after this slice.

## Fixes Applied During Audit

- Replaced stale fixed session expiry dates in API tests with `datetime.now(UTC) + timedelta(days=5)`.
- Fixed `test_admin_compat_routes.py` expected `expiresAt` assertion to use the seeded expiry.
- Added missing `timedelta` import in `test_control_plane_foundation_routes.py`.

## Important Notes

- Do not treat local visual fixtures as product data. They are guarded by DEV-only Vite checks and a PROD tripwire.
- Production/live panel must continue to use real API/database/node state only.
- `NEXTSTEP.md` currently appears mojibake-encoded. Prefer this checkpoint for continuation unless that file is re-saved as UTF-8.

## Next Suggested Work

1. Continue Remnawave parity UI pages only against live API state; no fake
   counters or static placeholder rows. The next practical slices are the
   remaining page-complete passes for Tools and Settings, then NodePlugins
   and the other dense admin surfaces that still have weak responsive
   behavior, incomplete inline actions, or incomplete Remnawave parity.
2. For each admin page slice, replace remaining native/browser-only UX with
   real inline controls, add focused tests, run build/guards, push, wait
   product workflows, deploy by official installer workflow, and record live
   evidence here.
3. Continue the remaining real-runtime protocol gaps after admin/backend/node
   page parity: Android IKEv2/IPsec, then client compatibility matrix.
4. Do not mark WireGuard/AWG torrent blocking complete through a fake policy
   artifact. Native WireGuard needs a real enforceable design such as nftables
   marks/routing or an explicit unsupported/enforced-by-edge status; ordinary
   `wg-quick` cannot do BitTorrent protocol detection by itself.
5. Keep official release/update path mandatory for production validation.
