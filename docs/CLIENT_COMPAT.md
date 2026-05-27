# Lumen Client Compatibility

This document tracks intended client compatibility for subscription renderers.

## Current Status

No renderer produces a live production subscription yet. The current outputs are:

- `lumen-json`: canonical internal manifest JSON
- `sing-box-skeleton`: non-runnable sing-box-like shape
- `clash-meta-skeleton`: non-runnable Clash Meta-like shape

All outputs carry `credentialsRef` or `lumen_credentials_ref` values instead of secrets. VLESS Reality/TLS skeletons include only public client metadata such as server name, Reality public key, short ID, fingerprint, ALPN, and flow.

## Compatibility Matrix

| Format | Target | Status | Notes |
| --- | --- | --- | --- |
| `lumen-json` | Lumen clients | Stable schema v1 | Stable internal shape, no inline secrets |
| `sing-box-skeleton` | sing-box family | VLESS skeleton | VLESS Reality/TLS shape without credential values |
| `clash-meta-skeleton` | Clash Meta family | VLESS skeleton | VLESS Reality/TLS YAML skeleton without credential values |

## Protocol Matrix

| Protocol | Lumen JSON | sing-box skeleton | Clash Meta skeleton | Notes |
| --- | --- | --- | --- | --- |
| `vless-reality` | Yes | Yes | Yes | Non-runnable until credentials are resolved out of band |
| `vless-tcp-tls` | Yes | Yes | Yes | `allowInsecure` is rejected |
| Placeholder protocols | Yes | Placeholder | Placeholder | Kept for discovery only |

## Fallback Landing

`apps/lumen-edge/src/fallback-landing.js` defines `lumen.edge.fallback-landing.v1` for edge fallback responses. The model reports fallback status, reason, host, request ID, safe diagnostics, and non-secret action links.

## TODO

- Define minimum supported versions for each target client.
- Add renderer fixture tests from real client parsers once formats are executable.
- Add negative tests that fail on inline secrets or subscription URLs.
- Add localized fallback landing copy after product text is approved.
