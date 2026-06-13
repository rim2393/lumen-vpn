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
OpenVPN UDP, SOCKS/HTTP proxy entries, and legacy aliases.

The currently executable runtime slice includes the adapters that have passed
backend renderer tests, node-agent runtime tests, and live VPS validation:
VLESS/VMess/Trojan TCP variants, Shadowsocks native, SOCKS5, HTTP proxy,
Hysteria2, TUIC v5, WireGuard native, AmneziaWG, and direct OpenVPN UDP.
OpenVPN-over-Shadowsocks now has a real backend/node-agent implementation and
must still pass the official image release plus live VPS validation before it is
listed as live-validated. Catalog entries outside that set remain metadata only
until install, health, export, conflict, and client compatibility tests are
completed.

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

The Hysteria2 Obfs adapter expects:

- `rendererHints.obfs`, normally `salamander`
- a derived per-subscription `hysteriaObfsPassword`
- node-agent process mode with sing-box Hysteria2 inbound support

The OpenVPN UDP adapter expects:

- profile-managed server CA/certificate/private key material
- per-subscription username/password credentials
- node-agent process mode with `openvpn` installed, TUN/NET_ADMIN available,
  IP forwarding enabled, and NAT for the OpenVPN client network

The OpenVPN-over-Shadowsocks adapter expects:

- profile-managed server CA/certificate/private key material
- per-subscription OpenVPN username/password credentials
- per-subscription Shadowsocks password credentials
- node-agent process mode with `openvpn`, `ssserver`, TUN/NET_ADMIN, IP
  forwarding, and NAT
- OpenVPN is bound to loopback TCP and the public listener is Shadowsocks TCP.
  Generic sing-box/Mihomo/Xray exports are rejected for this adapter rather
  than emitting a broken config. Lumen native exports include both layers, and
  raw/Happ exports render an `.ovpn` profile with `socks-proxy` instructions.

The Xray transport variants use adapter-derived transport defaults:

- `*-ws*` -> `streamSettings.network=ws` plus `wsSettings.path`
- `*-grpc*` -> `streamSettings.network=grpc` plus `grpcSettings.serviceName`
- `*-httpupgrade*` -> `streamSettings.network=httpupgrade` plus `httpupgradeSettings.path`
- `*-xhttp*` -> `streamSettings.network=xhttp` plus `xhttpSettings.path/mode`

## Runtime Enablement

Adapters marked `legacy` are compatibility entries. Catalog entries outside the
default protocol registry throw on provisioning attempts instead of returning a
successful non-live plan.

## Bind Reservations

Real protocol plans include `portReservations` entries using `lumen.protocol-registry.port-reservation.v1`. `detectExclusiveBindPortConflicts()` reports overlapping exclusive address/port/protocol reservations before a node agent attempts to apply runtime config.

## Renderer Hints

Renderer hints provide stable protocol naming for client formats such as sing-box and Clash Meta. They are not executable configs.

## Planned Runtime Work

- Define runtime credential resolver interface.
- Keep live protocol binaries and generated configs outside this registry package.
