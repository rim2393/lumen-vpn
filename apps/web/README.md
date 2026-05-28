# Lumen Admin Web

React + TypeScript + Vite admin UI for the Lumen Guard control plane.

## Scripts

- `npm run dev` - start Vite dev server.
- `npm run build` - typecheck and build production assets.
- `npm run lint` - run ESLint.
- `npm test` - run Vitest tests.

## Current Scope

- Guard login, MFA, and portal routes.
- Admin dashboard shell with sidebar navigation.
- API-backed screens for dashboard, users, nodes, hosts, profiles, squads,
  subscription delivery, subscription page metadata, license, settings, tools,
  and API keys.
- TanStack Query provider with the production HTTP client and an isolated
  development client used only by local tests/offline development.
- Design tokens and responsive CSS in `src/shared/styles`.
- Vitest + Testing Library route smoke tests.
