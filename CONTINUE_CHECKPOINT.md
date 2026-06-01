# Continuation Checkpoint

Last audited: 2026-06-01 13:25 Europe/Moscow.

## Current Working Copy

- Repo: `D:\android-app-new\_work\full-revna-like-projekt`
- Main branch state: clean after `12ae7fd Expand live protocol JS contract`.
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
2. Continue Remnawave parity UI pages only against live API state; no fake counters or static placeholder rows.
3. Extend non-Xray protocol runtimes to actively consume the persisted policy file where native protocol support exists.
4. Keep official release/update path mandatory for production validation.
