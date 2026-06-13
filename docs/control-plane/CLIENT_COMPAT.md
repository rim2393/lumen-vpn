# Lumen Client Compatibility

This document tracks verified client compatibility for subscription renderers.

## Current Status

The active renderer slice produces runnable client output for subscriptions that
are attached to a real node and a renderable VLESS profile. Public subscription
creation rejects records without a node or without a supported protocol.

- `lumen-json`: canonical internal manifest JSON
- `sing-box`: runnable sing-box JSON with derived per-subscription credentials
- `clash-meta`: runnable Clash Meta YAML with derived per-subscription credentials
- `mihomo`: runnable Mihomo-compatible YAML with derived per-subscription credentials

`lumen-json` keeps credential references only. Client configs require a
credential seed from the secure render context and do not emit vault references,
private keys, access tokens, or generated subscription URLs.

## Compatibility Matrix

| Format | Target | Status | Notes |
| --- | --- | --- | --- |
| `lumen-json` | Lumen clients | Stable schema v1 | Stable internal shape, no inline secrets |
| `sing-box` | sing-box family | Multi-protocol runnable config | Requires secure credential seed |
| `clash-meta` | Clash Meta family | Multi-protocol runnable YAML | Alias of Mihomo renderer |
| `mihomo` | Mihomo family | Multi-protocol runnable YAML | Requires secure credential seed |

## Protocol Matrix

| Protocol | Lumen JSON | sing-box | Clash Meta/Mihomo | Notes |
| --- | --- | --- | --- | --- |
| `vless-reality` | Yes | Yes | Yes | Reality public metadata plus derived UUID |
| `vless-tcp-tls` | Yes | Yes | Yes | `allowInsecure` is rejected |
| `hysteria2` | Yes | Yes | Yes | Derived Hysteria2 password |
| `hysteria2-obfs` | Yes | Yes | Yes | Derived Hysteria2 password plus derived obfs password |
| `vmess-ws-tls` | Yes | Yes | Yes | WebSocket transport path is rendered |
| Xray WS/gRPC/HTTPUpgrade/XHTTP variants | Yes | Partial by client support | Partial by client support | Backend emits concrete Xray transport settings; client support varies by app |
| Catalog-only protocols | Yes | Not emitted | Not emitted | Hidden from production provisioning until their adapter is implemented |

## Fallback Landing

`apps/lumen-edge/src/fallback-landing.js` defines `lumen.edge.fallback-landing.v1` for edge fallback responses. The model reports fallback status, reason, host, request ID, safe diagnostics, and non-secret action links.

## Planned Compatibility Work

- Define minimum supported versions for each target client.
- Add renderer fixture tests from real client parsers for every newly enabled target.
- Add negative tests that fail on inline secrets or subscription URLs.
- Add localized fallback landing copy after product text is approved.
