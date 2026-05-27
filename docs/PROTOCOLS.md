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

## Active Adapters

The first real protocol slice is Xray VLESS over TCP:

- `vless-reality`
- `vless-tcp-tls`

Both adapters are marked `experimental`. They validate public protocol configuration, reject inline secret-like fields, require `credentialsRef`, and render Xray-shaped outbound plans with exclusive bind port reservations. The plans are not live Xray config files: credential material such as VLESS client IDs, Reality key material, and TLS certificate material stays behind references.

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

## Placeholders

The registry still keeps placeholder adapters for:

- VLESS
- Trojan
- Shadowsocks
- WireGuard
- Hysteria2

All are marked `placeholder`. Their `planOutbound` method returns `implementationStatus: "not-implemented"` and must not be used for live traffic.

## Bind Reservations

Real protocol plans include `portReservations` entries using `lumen.protocol-registry.port-reservation.v1`. `detectExclusiveBindPortConflicts()` reports overlapping exclusive address/port/protocol reservations before a node agent attempts to apply runtime config.

## Renderer Hints

Renderer hints provide stable protocol naming for client formats such as sing-box and Clash Meta. They are not executable configs.

## TODO

- Define runtime credential resolver interface.
- Keep live protocol binaries and generated configs outside this registry package.
