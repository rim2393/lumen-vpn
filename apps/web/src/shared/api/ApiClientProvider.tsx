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

    const baseUrl = import.meta.env.VITE_LUMEN_API_BASE_URL?.trim()
    const mode = import.meta.env.VITE_LUMEN_API_MODE?.trim()

    if (baseUrl && mode !== 'mock') {
      return createHttpLumenApiClient({
        baseUrl,
        getSession: () => session,
      })
    }

    return createMockLumenApiClient()
  }, [client, session])

  return <ApiClientContext.Provider value={resolvedClient}>{children}</ApiClientContext.Provider>
}
