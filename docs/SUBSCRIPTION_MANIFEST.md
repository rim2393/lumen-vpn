# Lumen Subscription Manifest

Source packages:

- `packages/subscription-schema`
- `packages/subscription-renderers`

## Manifest Version

Version: `lumen.subscription-manifest.v1`

The manifest is a neutral subscription description. It carries provider metadata, subscription metadata, node entries, protocol endpoint metadata, renderer hints, and credential references.

## Required Shape

Top-level fields:

- `schemaVersion`
- `generatedAt`
- `provider.id`
- `provider.name`
- `subscription.id`
- `subscription.audience`
- `nodes`
- `renderHints`

Each node must include at least one protocol entry. Each protocol entry requires:

- `type`
- `adapter`
- `endpoint.host`
- `endpoint.port`
- `credentialsRef`

Normalized protocol entries also include `id`, defaulting to `type` when omitted.

Supported protocols:

- `vless-reality`
- `vless-tcp-tls`
- `vless`
- `trojan`
- `shadowsocks`
- `wireguard`
- `hysteria2`

## VLESS Reality/TLS Fields

`vless-reality` entries use `security.type: "reality"` and must include:

- `security.serverName`
- `security.publicKey`

Optional non-secret client fields include `security.shortId`, `security.fingerprint`, `security.spiderX`, and `flow`.

`vless-tcp-tls` entries use `security.type: "tls"` and must include `security.serverName`. `security.alpn` may be set. `security.allowInsecure` must remain false.

## Secret Handling

The schema rejects secret-like inline keys such as `password`, `token`, `privateKey`, VLESS client UUID fields, `subscriptionUrl`, and generated runtime config fields. The manifest stores references only.

## Renderers

Current renderers:

- `lumen-json`
- `sing-box-skeleton`
- `clash-meta-skeleton`

The skeleton renderers are intentionally not runnable client configs. For VLESS Reality/TLS they include non-secret public endpoint and TLS/Reality metadata, plus credential references so later secure render stages can resolve credentials out of band.

## TODO

- Add JSON Schema export once the final manifest version is stable.
- Add manifest signing and freshness fields.
- Add client capability targeting and per-client renderer feature flags.
- Add migration tests between manifest versions.
- Add secure handoff from credential resolver to final client config renderer.
