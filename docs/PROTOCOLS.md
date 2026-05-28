# Lumen Protocol Registry

Source package: `packages/protocol-registry`

## Adapter Contract

Version: `lumen.protocol-adapter.v1`

An adapter descriptor contains:

- `protocol`
- `displayName`
- `status`
- `capabilities`
- `requiredCredentialRefs`
- `rendererHints`
- `validateConfig(request)`
- `planOutbound(request)`

`requiredCredentialRefs` names reference slots, not credential values. Adapter implementations must consume secret material only through a runtime resolver outside this package.

## Adapter Catalog

The control-plane API exposes a product-size adapter catalog through
`/api/v1/protocols/adapters`. It includes VLESS Reality/TLS transport variants,
VMess, Trojan, Shadowsocks, WireGuard/AmneziaWG, Hysteria2, TUIC, NaiveProxy,
SOCKS/HTTP proxy entries, legacy aliases, and the internal `tcp-smoke` adapter.

The currently executable runtime slice is still limited: VLESS TCP Reality/TLS
and `tcp-smoke` have the most complete backend contracts. Planned adapters are
listed so the UI, profile validation, port reservations, and staged
implementation work operate against stable protocol identifiers instead of fake
frontend-only options.

The VLESS Reality adapter expects public client subscription fields:

- `security.serverName`
- `security.publicKey`
- optional `security.shortId`
- optional `security.fingerprint`
- optional `security.spiderX`

The VLESS TCP TLS adapter expects:

- `security.serverName`
- optional `security.alpn`
- `security.allowInsecure` must remain false

## Planned Runtime Work

Adapters marked `planned` or `legacy` are accepted by the control plane as
profile metadata, but must not be treated as fully runnable node-agent protocol
installers until their protocol-specific install, health, export, conflict, and
client compatibility tests are completed.

## Bind Reservations

Real protocol plans include `portReservations` entries using `lumen.protocol-registry.port-reservation.v1`. `detectExclusiveBindPortConflicts()` reports overlapping exclusive address/port/protocol reservations before a node agent attempts to apply runtime config.

## Renderer Hints

Renderer hints provide stable protocol naming for client formats such as sing-box and Clash Meta. They are not executable configs.

## TODO

- Define runtime credential resolver interface.
- Keep live protocol binaries and generated configs outside this registry package.
