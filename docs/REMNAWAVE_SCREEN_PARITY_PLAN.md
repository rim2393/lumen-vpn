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
- 2026-06-06: RSP-001 first production pass released through the official
  signed deploy path. Commits `d323b70` and `3a3aeda` restyled the public
  subscription browser page into a narrower Remnawave-like customer portal and
  fixed desktop install layout to two columns. Local gates passed:
  `pytest tests/test_license_subscription_routes.py -q` (`23 passed`),
  `ruff check app/domains/subscriptions/router.py tests/test_license_subscription_routes.py`,
  GitHub `Quality gates`, GitHub `Build release images`, and installer deploy.
  Live browser evidence on `https://sub.lumentech.tel/sub/.../happ`: page
  renders at 760px width, install grid is `378px 300px`, QR is present and
  compact, `Добавить подписку` is a `happ://add/...` link, copy/QR URL is public
  `https://sub.lumentech.tel/...`, and no internal `http://api:8000` URL leaks.
- 2026-06-06: RSP-001 browser interaction hardening added before moving to
  admin screen parity. The public page now exposes a visible import status,
  clipboard buttons bound through real JS handlers, and a separate `raw=1`
  fallback URL so browser deep-link failures are visible instead of looking
  like a dead button. Regression gate: subscription route pytest (`23 passed`)
  and ruff on the changed API/test files.
- 2026-06-06: RSP-002 Users first admin pass started. Scope: real API-backed
  Users list only, no fake rows. Changes add selected-row styling, denser
  Remnawave-like directory treatment, sticky focused-user action panel,
  tooltips/titles for icon actions, and confirmation gates for dangerous
  revoke/delete flows. Local web `npm run build` passed. Full `npm run lint`
  still fails on pre-existing repository-wide web lint debt outside this
  Users pass; keep this as a separate quality closure item instead of hiding it.
- 2026-06-06: RSP-002 Users first pass was released via official image build
  and installer deploy. Live `https://panel.lumentech.tel/users` evidence:
  15 real API rows, selected row class present, focused-user side panel is
  sticky without an internal hidden scroll, key labels are Russian (`Открыть
  карточку`, `Сортировка`, `превысили лимит`), no old `Open detail` /
  `Policy edits` / standalone `Sort` text remains, and no internal
  `http://api:8000` URL leaks.
- 2026-06-06: RSP-003 Profiles first pass started after live audit showed
  46 real profiles and a 7000px-tall screen with a cramped inventory table.
  Changes keep all existing real API actions, widen the inventory column,
  make the side workflow/detail column sticky, highlight the selected profile
  row, and compress per-row actions into titled icon buttons. Local web
  `npm run build` passed.
- 2026-06-06: RSP-003 Profiles compact-layout correction prepared after live
  deploy evidence showed the first pass increased page height to about 10343px.
  Root cause: profile rows wrapped long real values and the right-side inbound
  registry used `panel--wide`, which created an implicit two-column side grid.
  Fix keeps real actions, uses fixed table layouts with ellipsis, scopes the
  side column to one track, bounds the inbound registry table, and corrects the
  registry actions into one actions cell. Local web `npm run build` passed.
- 2026-06-06: RSP-003 compact-layout correction released through the official
  image build and installer deploy path at commit `d1191af`. Live
  `https://panel.lumentech.tel/profiles` evidence: 46 real profile rows,
  first 10 row heights are 59px, document height dropped from about 10343px to
  4837px, profile inventory table is fixed layout at 1640px with horizontal
  scroll, `.profiles-side` is one grid column, inbound registry contains 46
  real rows in a bounded scroll region, selected profile row remains present,
  per-row actions remain real icon buttons with titles, and no internal
  `http://api:8000` URL leaks.
- 2026-06-06: RSP-003 selected-profile detail compact pass prepared. Live
  audit showed the selected profile panel still consumed about 1251px because
  action buttons wrapped to 232px and fact cards wrapped long IDs/vault refs.
  Fix scopes compact styling only to `.profile-detail-panel`: real action
  handlers stay in place, action buttons become titled icons, facts become
  compact key/value rows with ellipsis, and opened tables/JSON blocks get
  bounded scroll. Local web `npm run build` passed.
