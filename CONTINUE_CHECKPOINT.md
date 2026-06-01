# Continuation Checkpoint

Last audited: 2026-06-01 17:10 Europe/Moscow.

## Current Working Copy

- Repo: `D:\android-app-new\_work\full-revna-like-projekt`
- Main branch state: clean after `340d87b Tolerate host-managed IP forwarding`.
- Current signed production manifest: `v0.1.49`.
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
  - CI fix `16aa332`: branch push image builds no longer dispatch the public installer/prod deploy pipeline. Only workflow dispatch/tag releases should change `release/prod.json`.
- 2026-06-01 Clash/Mihomo Android pass:
  - supported Clash aliases now become concrete runtime profiles: `hy2` -> Hysteria2, TUIC hyphen fields -> runtime keys, SOCKS4/SOCKS4A version preserved, packet-encoding normalized.
  - `clash://install-config?url=<inline-yaml>` now decodes form-encoded spaces only for structured inline Clash payloads while keeping normal subscription URL token handling unchanged.

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
- Node-agent gate after managed OpenVPN fixes: `node --test`, 93 passed.
- Live prod evidence after `v0.1.40`: panel `LUMEN_VERSION=v0.1.40`, node-agent image pinned to `v0.1.40`, HTTP-proxy profile apply succeeded with `dryRun=false`, Xray config contains `blackhole`, `protocol=["bittorrent"]`, sniffing on all active inbounds, and `xray -test` passed.
- Live prod evidence after `v0.1.41`: panel `LUMEN_VERSION=v0.1.41`, node-agent image pinned to `v0.1.41`, `shadowsocks-2022` profile apply succeeded with `dryRun=false`, node policy applied, generated sing-box Shadowsocks config contains the policy block route, `sing-box check -c` passed against the live config, and TCP `24081` listened on the node.
- Live prod evidence after `v0.1.49`: panel `LUMEN_VERSION=v0.1.49`, node-agent image pinned to `v0.1.49`, public installer persisted host IP forwarding, direct OpenVPN UDP profile apply succeeded with `dryRun=false`, node listened on UDP `24103`, OpenVPN auth files were readable/executable by the dropped `nobody` user without exposing raw credentials, NAT had exactly one `10.90.3.0/24` MASQUERADE rule after repeated apply, and a disposable OpenVPN client connected from the panel VPS using the rendered subscription.
- Alembic heads: single head `0008_infra_billing`.

## Fixes Applied During Audit

- Replaced stale fixed session expiry dates in API tests with `datetime.now(UTC) + timedelta(days=5)`.
- Fixed `test_admin_compat_routes.py` expected `expiresAt` assertion to use the seeded expiry.
- Added missing `timedelta` import in `test_control_plane_foundation_routes.py`.

## Important Notes

- Do not treat local visual fixtures as product data. They are guarded by DEV-only Vite checks and a PROD tripwire.
- Production/live panel must continue to use real API/database/node state only.
- `NEXTSTEP.md` currently appears mojibake-encoded. Prefer this checkpoint for continuation unless that file is re-saved as UTF-8.

## Next Suggested Work

1. Continue the remaining real-runtime protocol gaps: OpenVPN over Shadowsocks bridge and Android IKEv2/IPsec.
2. Do not mark WireGuard/AWG torrent blocking complete through a fake policy artifact. Native WireGuard needs a real enforceable design such as nftables marks/routing or an explicit unsupported/enforced-by-edge status; ordinary `wg-quick` cannot do BitTorrent protocol detection by itself.
3. Continue Remnawave parity UI pages only against live API state; no fake counters or static placeholder rows.
4. Keep official release/update path mandatory for production validation.
