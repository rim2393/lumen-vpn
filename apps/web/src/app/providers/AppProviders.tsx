import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthSessionProvider } from '../../features/auth/AuthSessionProvider'
import { ApiClientProvider } from '../../shared/api/ApiClientProvider'
import { ResourceCacheWarmer } from '../../shared/api/ResourceCacheWarmer'
import type { AuthSession, LumenApiClient } from '../../shared/api/types'
import { queryClient } from '../queryClient'

type AppProvidersProps = PropsWithChildren<{
  apiClient?: LumenApiClient
  enableResourceCacheWarmer?: boolean
  initialSession?: AuthSession | null
  queryClientOverride?: QueryClient
}>

export function AppProviders({
  apiClient,
  children,
  enableResourceCacheWarmer = true,
  initialSession,
  queryClientOverride = queryClient,
}: AppProvidersProps) {
  return (
    <QueryClientProvider client={queryClientOverride}>
      <AuthSessionProvider initialSession={initialSession}>
        <ApiClientProvider client={apiClient}>
          {enableResourceCacheWarmer ? <ResourceCacheWarmer /> : null}
          {children}
        </ApiClientProvider>
      </AuthSessionProvider>
    </QueryClientProvider>
  )
}
