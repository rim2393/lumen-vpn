import { createContext, useContext } from 'react'
import type { LumenApiClient } from './types'

export const ApiClientContext = createContext<LumenApiClient | undefined>(undefined)

export function useApiClient() {
  const context = useContext(ApiClientContext)

  if (!context) {
    throw new Error('useApiClient must be used inside ApiClientProvider')
  }

  return context
}
