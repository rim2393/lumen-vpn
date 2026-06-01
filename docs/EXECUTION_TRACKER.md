# Lumen Execution Tracker

Date: 2026-06-01

This is the primary execution tracker for closing the remaining Lumen control
plane, node runtime, subscription, client and commercial gaps. Use this file
before starting every new slice. Do not repeat a finished slice unless the
evidence here is wrong or stale.

## Rules

- Production reality only: no fake counters, placeholder rows, mock success
  states, synthetic nodes, fake users or non-live subscription behavior.
- A task is `DONE` only when code, tests, official release/update flow and live
  evidence prove it for the relevant surface.
- If a task touches node runtime or public subscriptions, live evidence must
  include the real panel/node path after the signed manifest upgrade.
- If a task is intentionally deferred, mark it `DEFERRED` and explain the
  external dependency or product decision.
- Keep evidence short and concrete: commit, version, workflow/run, endpoint,
  test command and result.

## Status Legend

- `DONE`: implemented, tested, released when required, and evidence recorded.
- `PARTIAL`: meaningful real implementation exists, but one or more required
  surfaces are incomplete.
- `OPEN`: not implemented or only scaffolded.
- `NEXT`: the next planned implementation slice.
- `DEFERRED`: intentionally not started yet.

## Release Baseline

| Item | Current Evidence |
| --- | --- |
| Latest production release | `v0.1.68` |
| Product repo head | `2bf2979 Complete profile detail editor metadata parity` |
| Public installer manifest | `rim2393/lumen_vpn@74325ec` |
| Prod health | `GET /api/v1/health/ready -> {"status":"ok","dependencies":{"api":"ok"}}` |
| Current rule | Continue from this tracker; do not restart already closed host/subscription renderer work. |

## Execution Order

1. Profiles/Hosts runtime sync and profile parity.
2. Users parity.
3. Squads parity.
4. Nodes polish and node plugins/provider history UX.
5. Settings, auth, MFA/passkeys/API tokens.
6. Subscription surface parity.
7. Tools parity.
8. OpenAPI regeneration.
9. Protocol closure.
10. Android/Windows client verification.
11. License server and commercial portal.

## P0: Profiles And Hosts

| ID | Task | Status | Done Criteria | Evidence |
| --- | --- | --- | --- | --- |
| PH-001 | Explicit profile Apply queues real node `outbound.apply` | DONE | UI action calls backend, backend queues command, node-agent completes on live node | `v0.1.60`, live command succeeded with `openvpn-shadowsocks-managed-process-started` |
| PH-002 | Host required-field and port validation | DONE | Create/edit/bulk reject missing node and invalid ports before mutation | `v0.1.61`, web TS/build gates, prod health |
| PH-003 | Full host parity fields in DB/API/UI | DONE | First-class fields for path/SNI/security/mux/sockopt/xHTTP/exclusions/final mask/Mihomo X25519, migration, UI create/edit | `0606e89`, migration `0010_host_remnawave_fields`, `v0.1.65` |
| PH-004 | Host fields affect computed Xray runtime config | DONE | Computed config applies host path/SNI/security/xHTTP/mux/sockopt, tests prove `streamSettings` | `0606e89`, `test_control_plane_foundation_routes.py`, `24 passed` |
| PH-005 | Host policy affects public subscription renderers | DONE | Hidden/excluded hosts blocked, visible hosts auto-selected, shuffle deterministic, final mask and Mihomo X25519 exported | `cda23ee`, `test_license_subscription_routes.py`, `18 passed`, `v0.1.66` |
| PH-006 | Profile/host changes auto-sync or require explicit dirty/apply state | DONE | After profile/host mutation the UI/API clearly marks affected node/profile as pending apply, and a real sync/apply operation applies it. No silent stale runtime. | `6aed6ff`, `v0.1.67`, release run `26778396746`, installer/deploy run `26778480970`, manifest `rim2393/lumen_vpn@70cab94`; `ruff`, `pytest tests/test_apply_profile_to_node_routes.py` 6 passed, web `tsc`; prod health OK and `/hosts` shows `Рантайм`/`Еще не применялось` after signed deploy. |
| PH-007 | Profiles detail editor parity | DONE | Detail page/editor covers profile name/status/node/squad/adapter/config/ports/credentials metadata with validation | `2bf2979`, `v0.1.68`, release run `26779454552`, installer/deploy run `26779535240`, manifest `rim2393/lumen_vpn@74325ec`; web `tsc` passed; local Vitest hung on Windows and was recorded in wiki; prod health OK and `/profiles` editor shows `JSON метаданных профиля`. |
| PH-008 | Profiles reorder parity | DONE | Real backend reorder endpoint and UI controls persist order, tests cover order | `1fb3559`, `v0.1.69`, release run `26780147882`, installer/deploy run `26780247823`, manifest `rim2393/lumen_vpn@4042794`; web `tsc` passed; `ruff` passed; `pytest tests/test_control_plane_foundation_routes.py -k profile_reorder` passed; local targeted Vitest hung on Windows and existing wiki mitigation applies; prod health OK and `/profiles` live UI shows `Ручной порядок`, `Вверх`, `Вниз` after signed deploy. |
| PH-009 | Protocol-specific profile builders | DONE | Builders for supported adapters produce valid payloads and port reservations, no raw JSON-only requirement | `5f3233b`, `v0.1.70`, release run `26780707608`, installer/deploy run `26780786555`, manifest `rim2393/lumen_vpn@b0ac95d`; web `tsc` passed; `ruff` passed; focused backend pytest passed; profile test contract now asserts builder `serverName` reaches `config_json.security`; prod health OK and live `/profiles` editor shows `Собрать JSON из полей протокола`. |
| PH-010 | Profile JSON editor with validation | DONE | JSON editor validates schema/secret rules and shows backend errors without fake success | `becc9c8`, `v0.1.71`, release run `26780993334`, installer/deploy run `26781081704`, manifest `rim2393/lumen_vpn@37508a8`; web `tsc` passed; `ruff` passed; focused backend pytest passed; profile test contract rejects inline `privateKey`; prod health OK and live `/profiles` editor shows config JSON, credentials ref, and protocol builder after signed deploy. |

## P1: Users

| ID | Task | Status | Done Criteria | Evidence |
| --- | --- | --- | --- | --- |
| U-001 | User lifecycle base controls | PARTIAL | Existing endpoints/UI manage basic lifecycle | Existing audit says wired; full evidence incomplete |
| U-002 | Lookup by UUID, username, short UUID, email, numeric id, Telegram id, tag | DONE | Backend lookup endpoint and UI search support all identifiers with tests | `0e03b24`, `v0.1.72`, release run `26781436509`, installer/deploy run `26781533403`, manifest `rim2393/lumen_vpn@bb4e2d1`; web `tsc` passed; `ruff` passed; focused backend pytest passed; prod health OK and live `/users` shows unified lookup UI with UUID/Telegram/tag guidance. |
| U-003 | User detail: nodes, subscriptions, request history, metadata, devices/HWID | DONE | Detail screen uses real DB/API state only | `28cec34` added user detail metadata UI; `e574916` fixed prod `/users` regression from existing service `.local` accounts; `v0.1.74`, release run `26782220964`, installer/deploy run `26782304076`, manifest `rim2393/lumen_vpn@b5177aa`; web `tsc` passed; `ruff` passed; focused backend pytest passed; prod health OK; live `/users` shows real users without error and live `/users/440ca348-6ed2-427c-ab05-48e552c7845b` shows metadata/devices/request history. |
| U-004 | User actions: enable, disable, revoke, reset traffic | DONE | Actions mutate real state and queue node/runtime work where required | `b217a7d`, `v0.1.75`, release run `26782682790`, installer/deploy run `26782766079`, manifest `rim2393/lumen_vpn@63de6ad`; added explicit `/enable`, `/disable`, `/revoke`, `/reset-traffic` action API plus audit events and UI hooks; `ruff`, focused backend pytest, web `tsc`, focused Vitest passed; prod health OK; live UI smoke created temporary user `qa-u004-1780348946748@example.com`, ran disable/reset/revoke/delete, and verified no page error and no leftover temp row. |
| U-005 | Tags and bulk actions: delete/status/revoke/reset/update/squads/extend expiration | DONE | Bulk API/UI with tests and audit events | `f788e24`, `v0.1.76`, release run `26783115565`, installer/deploy run `26783190801`, manifest `rim2393/lumen_vpn@3c4ce1e`; backend bulk API covers status/reset/revoke/tag/extend/traffic/delete/squad-add/squad-remove with tests; Users UI exposes selected-user bulk controls; `ruff`, focused backend pytest, web `tsc`, focused Vitest passed; prod health OK; live smoke verified bulk tag/extend/traffic/squad add/remove/revoke without page errors, cleaned temp rows, then focused bulk delete removed `QA U005 DEL A/B 1780349680785` with no leftover rows. |

## P1: Squads

| ID | Task | Status | Done Criteria | Evidence |
| --- | --- | --- | --- | --- |
| SQ-001 | Internal squads CRUD and detail | DONE | Squad detail exposes real membership, accessible nodes, profiles, hosts and inbound matrix in UI/API | `5bbd792` + `96e691b`, `v0.1.78`, release run `26784041783`, installer/deploy run `26784116318`, manifest `rim2393/lumen_vpn@7aef27a`; web `tsc`, focused Vitest `squad detail`, backend `ruff`, focused backend pytest `squad_detail_membership_and_reorder_are_persisted` passed; prod health OK; prod containers `lumen-api/web/subscription` on `v0.1.78` healthy; live browser smoke on `/squads` verified real squad `bear` detail panels: `node-01`, `prod-trojan-tcp-reality-live`, `wireguard-amneziawg`, RU headings `Ноды сквада`/`Профили сквада`/`Хосты сквада`, and inbound matrix entries `trojan/tcp/reality` plus `wireguard/tcp/none`. |
| SQ-002 | Internal squad accessible-node matrix and inbound/profile bindings | DONE | Matrix editor persists profile/host bindings and refreshes accessible nodes/detail/runtime-relevant state | `689f6c2`, `v0.1.79`, release run `26784396196`, installer/deploy run `26784468008`, manifest `rim2393/lumen_vpn@4c8da07`; web `tsc`, focused Vitest `squad binding matrix` + `squad detail`, backend `ruff`, focused backend pytest `squad_detail_membership_and_reorder_are_persisted` passed; prod health OK; prod containers `lumen-api/web/subscription` on `v0.1.79` healthy; live smoke created disabled temporary QA profile/host, patched them through the real prod API into squad `bear`, browser `/squads` detail showed `qa-sq002-profile-1780351331657` under `Профили сквада` and `qa-sq002-1780351331657.example.test` under `Хосты сквада`; detach/delete cleanup returned 200/200/204/204 and DB counts for `metadata_json.qa = sq002` were `0` profiles and `0` hosts. |
| SQ-003 | External squads CRUD and membership | DONE | External squads manage users, profiles and hosts through real API and visible UI path | `bbcef39`, `v0.1.80`, release run `26785081272`, installer/deploy run `26785155330`, manifest `rim2393/lumen_vpn@83d4cdc`; web `tsc`, focused Vitest `external squads`, backend `ruff`, focused backend pytest `squad_detail_membership_and_reorder_are_persisted` passed with external squad user/profile/host/detail assertions; prod health OK; prod containers `lumen-api/web/subscription` on `v0.1.80` healthy; live browser `/squads` verified external squad UI row/filter controls and a temporary external QA squad row, with associated QA user/profile/host visible in the page data surface; cleanup removed temporary `sq003` squads/users/profiles/hosts and DB counts returned `0` for all four tables. |
| SQ-004 | External squad templates, headers, host overrides, HWID settings, custom remarks, subpage config binding | OPEN | Subscription behavior changes are reflected in public renderers | Not started |

## P1: Nodes

| ID | Task | Status | Done Criteria | Evidence |
| --- | --- | --- | --- | --- |
| N-001 | Node management P0 actions | DONE | update/delete/reorder/restart/reset traffic/restart all/bulk, real node-agent commands | `v0.1.59`, live restart evidence |
| N-002 | Node management UX polish | OPEN | UI flows are clear, all buttons explain state/result and avoid fake success | Not started |
| N-003 | Node plugins CRUD/clone/reorder/executor | OPEN | Plugin management is full CRUD and runtime policy evidence exists | Partial policy integration exists; management parity open |
| N-004 | Node stats, bandwidth, metadata, infra billing, provider history | OPEN | Real metrics/history surfaces only, no fake counters | Not started |

## P1: Settings, Auth, Tokens

| ID | Task | Status | Done Criteria | Evidence |
| --- | --- | --- | --- | --- |
| S-001 | Generic OAuth2 provider | DONE | Real env/file-backed OAuth2/OIDC config, start/callback, validation | `4980e8c`, `v0.1.64` |
| S-002 | Typed settings groups | OPEN | Settings are grouped and validated by domain, not generic key/value UI only | Not started |
| S-003 | MFA/passkey registration and login UX | OPEN | Authenticator 2FA/passkeys can be configured and used end-to-end | Not started |
| S-004 | API tokens CRUD with scopes for automation/Telegram bot | OPEN | Scoped token lifecycle with one-time secret display and audit | Not started |
| S-005 | Auth method toggles and branding toggles | OPEN | Toggles are real settings and affect login/UI surfaces | Not started |

## P1: Subscription Surface

| ID | Task | Status | Done Criteria | Evidence |
| --- | --- | --- | --- | --- |
| SUB-001 | Subscription admin lookup/clone/delete/devices/raw preview | DONE | Protected admin API/UI uses real production API controls | `e8f8699`, released through later versions |
| SUB-002 | Subscription create richer contract | PARTIAL | Static server default removed, expires/config hash exposed; more settings remain | `v0.1.62` |
| SUB-003 | Subscription settings page | OPEN | Title/support/update/base JSON/profile page URL/Happ announce/routing/custom remarks/headers/random host order/rules | Not started |
| SUB-004 | Template CRUD/reorder for Xray JSON, Mihomo, Stash, sing-box, Clash | OPEN | Template ordering and editor affect renderers with tests | Partial CRUD exists; reorder/parity incomplete |
| SUB-005 | Response rule editor/tester | OPEN | Rules can be edited/tested in UI and applied to public responses | Backend partial exists; UI parity open |
| SUB-006 | Subscription page configs CRUD/clone/reorder | OPEN | Configs bind to squads/subscriptions and affect public subpage | Not started |

## P1: Tools

| ID | Task | Status | Done Criteria | Evidence |
| --- | --- | --- | --- | --- |
| T-001 | HWID inspector and device delete/delete-all | PARTIAL | Device list exists for subscription admin; full tools surface open | `e8f8699` devices list |
| T-002 | Top users | OPEN | Real database stats and UI table, no fake counters | Not started |
| T-003 | Fetch user IPs and node user IPs | OPEN | Real session/runtime/IP-control views | Not started |
| T-004 | Drop connections | OPEN | Backend queues/executes real node-agent disconnect operation | Not started |
| T-005 | Full HApp routing encryption | OPEN | Utility/API/UI produce usable encrypted routing payloads | Not started |
| T-006 | X25519 generation UI/API | OPEN | Generates keys without logging/storing secrets incorrectly | Not started |
| T-007 | Torrent report management | OPEN | Real reports, truncate, filters and evidence from node events | Partial ingestion exists; UI parity open |

## P2: OpenAPI

| ID | Task | Status | Done Criteria | Evidence |
| --- | --- | --- | --- | --- |
| API-001 | Regenerate checked-in OpenAPI seed | OPEN | OpenAPI includes current admin/node/tools/subscription surfaces and CI detects drift | Not started |

## P2: Protocol Closure

| ID | Task | Status | Done Criteria | Evidence |
| --- | --- | --- | --- | --- |
| PR-001 | Keep already live protocol slices regression-tested | PARTIAL | Existing live protocols stay covered in CI and live smoke after related changes | Evidence exists through `v0.1.55`, needs ongoing smoke |
| PR-002 | Remaining Xray transport edge cases | OPEN | WS/gRPC/HTTPUpgrade/xHTTP/Reality/TLS edge cases pass backend, node, renderers, client imports, live smoke | Not started |
| PR-003 | WireGuard/AmneziaWG real key lifecycle and policy enforcement | OPEN | No fake torrent blocking; enforceable design implemented or clear unsupported status | Not started |
| PR-004 | IKEv2/IPsec | OPEN | Backend profile, node runtime, subscription renderer, client import and live connect | Not started |
| PR-005 | NaiveProxy/HTTP/SOCKS edge compatibility | OPEN | Target clients import and connect through live node | Not started |
| PR-006 | Client compatibility matrix | OPEN | Happ/Hiddify/Amnezia/Mihomo/Stash/sing-box fixtures and live imports verified | Not started |

## P2: Clients

| ID | Task | Status | Done Criteria | Evidence |
| --- | --- | --- | --- | --- |
| C-001 | Android real production subscription import | OPEN | App imports real prod URL without logging secrets | Not started in this tracker |
| C-002 | Android connect per live protocol | OPEN | Emulator/device evidence per protocol | Not started |
| C-003 | Android portrait-only verification | PARTIAL | Project rule exists; needs final release QA evidence | Wiki/project rule |
| C-004 | Windows client | OPEN | Same real protocol set, no mocks | Not started |

## P3: License Server And Commercial Portal

| ID | Task | Status | Done Criteria | Evidence |
| --- | --- | --- | --- | --- |
| L-001 | Separate license server product/repo | DEFERRED | Repo/deploy split and API contract defined | Deferred until control plane/client core stabilizes |
| L-002 | Account login with authenticator 2FA | DEFERRED | Central portal login and 2FA verified | Deferred |
| L-003 | License issue/renew/sync | DEFERRED | Self-hosted panel syncs account/key and applies <=3 free node behavior | Deferred |
| L-004 | Expired license semantics | DEFERRED | Existing <=3 nodes continue, extra nodes pause, changes blocked, renewal resumes | Deferred |

## Next Slice

`PH-006`: profile/host runtime sync state.

Proposed implementation:

1. Add backend dirty-state metadata when profile/host changes affect runtime.
2. Expose affected profile/node pending-apply status in API responses.
3. Add UI indicator and action to apply pending changes.
4. Keep explicit Apply available; do not silently fake runtime sync.
5. Test: profile/host mutation marks pending; apply queues real node command and clears pending only after command success evidence.

## Checkpoint Notes

- Always update this file in the same commit as a completed slice.
- If a slice only reaches local tests, keep it `PARTIAL` until release/live
  evidence is recorded.
- Do not remove old evidence; append newer evidence if a feature regresses and
  is fixed again.
