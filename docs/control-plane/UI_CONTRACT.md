# Lumen Admin UI Contract

## Scope

The current web app lives in `apps/web` and covers the Lumen Guard admin entry plus the first admin control plane. Production deployments must use the HTTP client and real API data only. Mock data is limited to local component tests and offline development; it must never be used for deployed dashboard, users, nodes, hosts, profiles, squads, subscription, license, or API key state.

## Routes

- `/guard/login` - Lumen Guard login form.
- `/guard/mfa` - MFA challenge form.
- `/guard/portal` - guarded handoff into the admin control plane.
- `/dashboard` - live overview from API resources.
- `/users` - live VPN account directory with create, update, delete, status bulk actions, traffic reset, traffic/device limits, expiry-ready fields, and tags.
- `/nodes`, `/license`, `/api-keys` - API-backed resource workspaces. `/nodes` uses the `/api/v1/nodes` list shape and can create node provisioning jobs with `credentials_ref` only.
- `/hosts`, `/profiles`, `/squads`, `/subscription` - API-backed resource workspaces for host bindings, config profiles, internal/external routing groups, and subscription feeds.

## Structure

- `src/app` owns providers, query client setup, and route definitions.
- `src/features/auth` owns Guard login/MFA/portal screens and the session provider.
- `src/pages` owns dashboard and resource screens.
- `src/shared/api` owns typed API client contracts, the HTTP client, API provider, and page data hooks. The in-memory development client is test-only and must be injected explicitly by tests; runtime bundles must never select it through environment variables.
- `src/shared/components` owns shell, navigation, metrics, badges, headers, and brand primitives.
- `src/shared/data` owns local test fixtures and navigation maps.
- `src/shared/styles` owns CSS design tokens and global layout rules.
- `src/test` owns testing setup and router render helpers.

## Design Tokens

The Lumen look uses graphite surfaces, green safety accents, amber warning states, compact 4/8 spacing, and card radii at 8px or below. Density is encoded with `data-density="compact"` selectors so the core UI does not depend on container style queries. Dashboard containment uses `content-visibility: auto` with a `contain` fallback.

## Planned Integration Work

- Active screen parity source of truth: `docs/ADMIN_SCREEN_PARITY_PLAN.md`.
  Backend/API parity rows are not enough to mark a screen complete. A screen is
  production-ready only when the visual layout, user workflow, every visible
  button and live API behavior are verified against the Lumen-style target.
- Set `VITE_LUMEN_API_BASE_URL` when the web bundle must call a different API origin. If it is unset, the runtime uses `window.location.origin`. There is no environment switch for fake/development API mode in runtime bundles.
- Current HTTP paths include `GET/PATCH/DELETE /api/v1/users/{id}`, `POST /api/v1/users/bulk/{action}`, `GET/POST/PATCH/DELETE /api/v1/hosts`, `GET/POST/PATCH/DELETE /api/v1/profiles`, `GET/POST/PATCH/DELETE /api/v1/squads`, `GET /api/admin/license`, `GET /api/admin/api-keys`, `GET /api/v1/nodes`, `POST /api/v1/nodes/provisioning-jobs`, and legacy-compatible aliases under `/api/users`, `/api/hosts`, `/api/config-profiles`, `/api/internal-squads`, `/api/external-squads`, and `/api/tokens`.
- Node provisioning UI must never collect or render SSH passwords, private keys, install tokens, heartbeat tokens, subscription URLs, or generated runtime configs. It may show safe install-token issue/exchange timestamps and the real heartbeat endpoint path.
- Replace the hand-written HTTP client with a generated API client once backend contracts are stable.
- Add deeper admin parity screens: user detail tabs, squad inbound matrix, profile JSON editor, host reorder, node statistics, infra billing, bandwidth, metrics, HWID inspector, SRH/session explorers, torrent blocker reports, HApp routing builder, and subscription template editors.
- Add table state, pagination, filtering, optimistic mutations, and audit-safe notifications.
- Add visual regression coverage after real data components land.
