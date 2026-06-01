import { type PropsWithChildren, useMemo } from 'react'
import { useAuthSession } from '../../features/auth/authSession'
import { ApiClientContext } from './apiClientContext'
import { createDevelopmentLumenApiClient } from './developmentClient'
import { createHttpLumenApiClient } from './httpClient'
import type { LumenApiClient } from './types'

type ApiClientProviderProps = PropsWithChildren<{
  client?: LumenApiClient
}>

export function ApiClientProvider({ children, client }: ApiClientProviderProps) {
  const { session } = useAuthSession()

  const resolvedClient = useMemo(() => {
    if (client) {
      return client
    }

    // ── DEMO/FIXTURE DATA GUARD ──────────────────────────────────────────────
    // In-memory fixtures are a LOCAL-ONLY convenience for visual review. They must
    // NEVER reach production. Three independent layers enforce this:
    //   1. import.meta.env.DEV — a compile-time constant that Vite hard-codes to
    //      `false` in `vite build`, so the branch below AND the fixtures import are
    //      dead-code-eliminated from production bundles.
    //   2. VITE_LUMEN_USE_FIXTURES — an explicit opt-in flag that lives only in the
    //      gitignored `.env.development.local` (never committed, never loaded by
    //      Vite in production mode).
    //   3. The PROD tripwire below — fail-closed if the flag is ever seen in a prod
    //      build, instead of silently serving demo data.
    const fixturesRequested = import.meta.env.VITE_LUMEN_USE_FIXTURES === 'true'

    if (import.meta.env.PROD && fixturesRequested) {
      throw new Error(
        'LUMEN: demo fixtures (VITE_LUMEN_USE_FIXTURES) are forbidden in production builds.',
      )
    }

    if (import.meta.env.DEV && fixturesRequested) {
      return createDevelopmentLumenApiClient()
    }
    // ─────────────────────────────────────────────────────────────────────────

    const configuredBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_LUMEN_API_BASE_URL)
    const baseUrl =
      configuredBaseUrl || (typeof window === 'undefined' ? '' : window.location.origin)

    if (!baseUrl) {
      throw new Error('Lumen API base URL is not configured.')
    }

    return createHttpLumenApiClient({
      baseUrl,
      getSession: () => session,
    })
  }, [client, session])

  return <ApiClientContext.Provider value={resolvedClient}>{children}</ApiClientContext.Provider>
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed || trimmed === '__LUMEN_WEB_API_BASE_URL__') {
    return ''
  }

  try {
    const url = new URL(trimmed)
    if (url.pathname === '/api') {
      url.pathname = '/'
    }
    return url.toString()
  } catch {
    return ''
  }
}
