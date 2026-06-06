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

RSP-003 Profiles remains active for the functional smoke closure, then the
work must continue screen by screen through RSP-002/RSP-004/RSP-005 and the
remaining admin surfaces. The current product is not yet accepted as
Remnawave-like visual/function parity: every page still needs a click-through
pass where all visible actions are real, dense, responsive and production
deployed before being marked done.

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
- 2026-06-06: RSP-002 Users continuation prepared after live audit showed the
  directory still spanning the whole content width and several dangerous
  actions relying on old immediate-click behavior. Changes keep the data
  production-backed, bound the Users directory table, place side workflow
  panels next to it, and require inline confirmation before real delete,
  revoke, reset-traffic, and destructive bulk API calls. Local gates passed:
  targeted Users vitest, full web vitest (`59 passed`), production build,
  release guard, production reality guard, and `git diff --check`. Live
  deploy/evidence is required before this continuation is marked released.
- 2026-06-06: RSP-002 Users continuation released through official image build
  and installer deploy at product commit `20e266f`. Live
  `https://panel.lumentech.tel/users` evidence: 15 real API rows, `html lang=ru`,
  no `A valid API key is required`, no internal `http://api:8000` URL, bounded
  Users directory table (`778px` panel with internal table scroll), side column
  aligned to the same top (`left=814`, `width=420`), and destructive bulk
  delete opens inline Russian confirmation (`Удалить выбранных пользователей`,
  `Реальные пользователи будут удалены через боевой API`) before any API call.
  Cancel closes the dialog and leaves all 15 rows intact.
- 2026-06-06: RSP-002 UserDetail continuation prepared after live audit showed
  a 15589px-tall detail page, side panels below the editor, raw `metadata_json`
  label, and native browser confirms for revoke/reset/delete device/clear
  devices/delete user. Changes keep the detail surface API-backed, move editor
  and side panels into the intended two-column layout, bound lower detail
  tables with internal scroll, rename the raw metadata label, and require
  inline confirmation before all destructive detail API calls. Local gates
  passed: targeted UserDetail/productionReality vitest, full web vitest
  (`59 passed`), production build, release guard, production reality guard,
  and `git diff --check`. Live deploy/evidence is required before this
  continuation is marked released.
- 2026-06-06: RSP-002 UserDetail continuation released through official image
  build and installer deploy at product commit `cded5a4`. Live
  `https://panel.lumentech.tel/users/f35df075-...` evidence: document height
  reduced from `15589px` to `2933px`, editor panel is `878px` wide with
  side stack aligned at the same top (`left=914`, `width=320`), raw
  `metadata_json` label is gone, `JSON метаданных пользователя` is visible,
  no internal `http://api:8000` or API-key error leaks, request history is
  bounded to a `560px` internal scroll area, and real device delete / clear
  all devices open Russian inline confirmations before API calls. Cancel closes
  both dialogs and leaves all 103 visible table rows intact.
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
- 2026-06-06: RSP-003 selected-profile detail compact pass released through
  official image build and installer deploy at commit `5fe1355`. Live
  evidence on `https://panel.lumentech.tel/profiles`: selected detail panel
  height dropped from about 1251px to 912px, action strip dropped from 232px
  to 36px, seven real actions remain present as 34px titled icon buttons,
  fact rows are stable at 46px, open inbound section is bounded, 46 real
  profile rows still load, selected row remains present, and no internal
  `http://api:8000` URL leaks.
- 2026-06-06: RSP-003 profile editor compact pass prepared after live create
  editor audit showed the inline real editor at about 1836px high with 18 real
  fields. Fix adds scoped `.profile-editor-panel` styling only: compact
  key/control rows, smaller header copy, bounded JSON textareas, compact
  adapter capability cards, and sticky save/cancel actions. Submit, port
  validation, protocol JSON builder and API persistence are unchanged. Local
  web `npm run build` passed.
- 2026-06-06: RSP-003 profile editor advanced JSON pass prepared. The real
  JSON config, metadata and protocol builder remain in the submitted form but
  move into a collapsed `Advanced JSON` section by default, matching the
  operator expectation that common profile edits do not require scrolling
  through raw JSON. RU label added. Local web `npm run build` passed.
- 2026-06-06: RSP-003 profile editor advanced JSON pass released through
  official image build and installer deploy at commit `fb3b089`. Live
  `https://panel.lumentech.tel/profiles` create-editor evidence: form height
  dropped from about 1836px to 1296px, all 18 real fields remain mounted,
  `Расширенный JSON` is collapsed by default at 50px, the section opens to
  470px with both JSON textareas and the real `Build JSON from protocol
  fields` button present, sticky save/cancel bar remains visible, and no
  internal `http://api:8000` URL leaks.
- 2026-06-06: RSP-003 functional smoke ran against the live production
  backend, not mock data. A disabled real QA profile was created from the
  `/profiles` UI on `node-01` with adapter `vless-reality` and reserved
  port `28531/tcp`, then edited from the same UI and verified on the live
  table. The smoke did not apply that disabled QA profile. Instead, the
  existing active profile `Live vless-ws-tls 1780292415` was applied through
  the real row action and queued command
  `bd6242e9-f05f-4df7-b830-c7c6117c35ef` for node
  `d40a27ae-29fa-4cd1-88ee-269957de1e30`. The temporary QA profile was then
  removed through the official authenticated backend endpoint
  `DELETE /api/v1/profiles/{profile_id}`. Final live browser verification on
  `https://panel.lumentech.tel/profiles` showed the QA row absent and the
  real profiles screen still loaded for `admin@test.lumentah.tel`.
- 2026-06-06: RSP-003 remaining gaps recorded from the same pass: the create
  form still marks adapters as unavailable when creating an active profile in
  some states, delete confirmation is browser-dialog based and awkward for
  automated live QA, and the current Profiles UX is still not accepted as
  full Remnawave visual parity. The next Profiles slice must close these
  gaps before moving to Hosts/Nodes.
- 2026-06-06: RSP-003 Profiles functional hardening prepared. The profile
  editor now keeps non-legacy catalog/live adapters selectable instead of
  hiding valid production protocols behind the active-status check. Dangerous
  profile deletion no longer depends on a native browser confirm; it renders
  an inline production API confirmation panel for single and bulk deletes.
  The profile selection cleanup effects were stabilized to avoid redundant
  Set state writes that made the Profiles tests and page feel slow. Added
  focused `ProfilesPage` tests for real update JSON, reorder API contract,
  adapter selectability and inline delete confirmation, then repaired the
  wider web contract tests so they stay deterministic under the EN/RU i18n
  shell. Local gates: `npx vitest run --no-file-parallelism --reporter=dot`
  (`54 passed`) and `npm run build` passed.
- 2026-06-06: RSP-004 Hosts first compact/function hardening pass prepared.
  Live audit before the change showed 18 real host rows, a about 6659px-tall
  page, a 2697px inventory panel, right-side workflow panels pushed below the
  table, and raw labels such as `None`, `Profile default`, and `inbound_tag`.
  The pass keeps existing production hooks and API behavior, adds scoped
  `ResourceScreen` class hooks, gives Hosts a bounded fixed-layout inventory
  table, sticky side stack, selected-row treatment, dark readable tooltip
  surface, translated host editor labels, collapsed advanced JSON for
  `metadata_json`/`xray_template_json`/`mux_json`/`sockopt_json`/`xhttp_json`,
  and inline production API confirmations for single and bulk host deletion.
  Added focused `HostsPage` tests for real update JSON, single delete confirm,
  and bulk delete confirm. Local gates: `npx vitest run src/pages/HostsPage.test.tsx --reporter=verbose`
  (`3 passed`), `npx vitest run --no-file-parallelism --reporter=dot`
  (`57 passed`), `npm run build`, `python scripts/validate_release_guard.py`,
  `python scripts/validate_production_reality.py`, and `git diff --check`
  passed. Live deploy/evidence is still required before RSP-004 is marked
  released.
- 2026-06-06: RSP-004 Hosts compact/function pass released through the
  official image build and installer deploy path at commits `67035b5` and
  correction `0cf7ba2`. The first live deploy showed the table still spanning
  both grid columns because global `.panel--wide { grid-column: span 2; }`
  overrode the Hosts layout; correction scoped `.hosts-inventory-panel` back
  to `grid-column: auto`. Final live evidence on
  `https://panel.lumentech.tel/hosts`: 18 real host rows, grid columns
  `850px 347px`, inventory panel at `left=20 top=324 width=851 height=790`,
  side stack at `left=887 top=324 width=347`, table wrapper bounded at about
  `682px` high with horizontal scroll, `Advanced JSON` collapsed by default,
  selected host row present, no raw `inbound_tag` / `Profile default` /
  standalone `None` text, no internal `http://api:8000` leak, and clicking a
  real host delete action opens an inline production API confirmation that can
  be cancelled without deleting.
