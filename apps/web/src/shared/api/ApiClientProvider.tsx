import { type PropsWithChildren, useMemo } from 'react'
import { useAuthSession } from '../../features/auth/authSession'
import { ApiClientContext } from './apiClientContext'
import { createHttpLumenApiClient } from './httpClient'
import { createMockLumenApiClient } from './mockClient'
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

    const configuredBaseUrl = import.meta.env.VITE_LUMEN_API_BASE_URL?.trim()
    const mode = import.meta.env.VITE_LUMEN_API_MODE?.trim()

    if (mode === 'mock') {
      return createMockLumenApiClient()
    }

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
