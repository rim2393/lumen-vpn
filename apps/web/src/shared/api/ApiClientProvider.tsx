import { type PropsWithChildren, useMemo } from 'react'
import { useAuthSession } from '../../features/auth/authSession'
import { ApiClientContext } from './apiClientContext'
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

    const fixturesRequested = import.meta.env.VITE_LUMEN_USE_FIXTURES === 'true'
    if (fixturesRequested) {
      throw new Error(
        'LUMEN: in-app fixture API is forbidden. Tests must inject an explicit client.',
      )
    }

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
