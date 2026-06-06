# Remnawave Screen Parity Plan

Date: 2026-06-06

This is the active working plan for Remnawave-like visual and functional parity.
Older backend/API parity rows are not enough to close this plan. A screen is
done only when the visible UI, every visible action, real API behavior,
official deploy and live browser/API verification all pass.

## Non-Negotiable Contract

- No fake counters, demo rows, placeholder buttons, mock success, local-only
  controls, or production-inaccessible feature paths.
- Remnawave is the reference for information architecture, density, customer
  subscription page flow, users, squads, profiles, hosts, nodes, settings,
  subscription settings, tools and API token surfaces.
- Lumen keeps its own brand, domain, backend, runtime and security model, but
  the first production pass should be as close as practical to the Remnawave
  operator/customer UX before later Lumen-specific redesigns.
- Public subscription pages must work for real clients: browser page, app deep
  link, QR, copy URL, HWID/device binding, raw client render and request
  history must all be real.
- Admin pages must not expose an action unless it is wired to a real endpoint
  or an honest backend unavailable status.

## Stage Order

| ID | Surface | Target | Done Evidence |
| --- | --- | --- | --- |
| RSP-001 | Public subscription page | Remnawave-like customer portal: centered dark layout, top brand, status card, install tabs, app install block, import block, QR block, copy links and per-client switching. | API route tests, live browser page shows correct layout, real QR, public URL, deep link and no internal URL leakage. |
| RSP-002 | Users list/detail | Remnawave-like user table, detail drawer/page, lifecycle actions, traffic/device limits, tags, subscriptions, request history, devices/HWID, metadata and bulk actions. | Web/API tests plus live click-through on `/users` and `/users/:id`. |
| RSP-003 | Profiles | Remnawave-like profile list/detail editor, protocol builders, generated config preview, JSON editor, reorder, apply/readiness, stale cleanup, issue subscription. | Web/API tests plus live profile edit/apply smoke. |
| RSP-004 | Hosts | Remnawave-like host table/cards, full field editor, tooltips, bulk actions, reorder, inbound/port controls, hidden/exclusion/final mask/Mihomo key. | Web/API tests plus live host create/edit validation. |
| RSP-005 | Nodes/plugins | Remnawave-like node management, real command actions, protocol checkboxes, plugin CRUD/clone/reorder/executor, stats/bandwidth/provider history. | Node/API/web tests plus live command completion. |
| RSP-006 | Squads | Internal/external squad UI parity: members, nodes, inbound matrix, host/profile bindings, external delivery settings. | API/web tests plus live squad membership/matrix smoke. |
| RSP-007 | Settings/auth/tokens | Typed settings, auth providers, MFA/passkeys, API tokens, Telegram/API-key management, real status labels. | API/web tests plus live settings mutation smoke. |
| RSP-008 | Subscription admin/settings | Settings, templates, response rules, page configs, client target list, HWID policy, request history links and renderer previews. | API/web tests plus live public render matrix. |
| RSP-009 | Tools | HWID inspector, request history, sessions/IP control, torrent reports, HApp routing, X25519, snippets, drop connections. | API/web tests plus live tools smoke. |
| RSP-010 | Final parity QA | Screen-by-screen manual/automated click pass, visual checks, no placeholders, no broken buttons, live deploy evidence. | Final tracker row, code review, security review and live evidence. |

## Current Priority

RSP-001 is active because the live public subscription page works technically
but does not meet the requested Remnawave-like visual quality. The next commit
must improve that page first, then deploy and verify live before moving to
admin Users/Profile/Hosts.

## Progress Log

- 2026-06-06: Created this plan after live feedback that functional API parity
  is not sufficient and current visual subscription/admin UI does not meet
  Remnawave-like expectations.
