import { createContext, useContext } from 'react'
import type { AuthSession } from '../../shared/api/types'

export type AuthSessionStatus = 'anonymous' | 'authenticated'

export type AuthSessionContextValue = {
  clearSession: () => void
  session: AuthSession | null
  setSession: (session: AuthSession | null) => void
  status: AuthSessionStatus
}

export const AuthSessionContext = createContext<AuthSessionContextValue | undefined>(undefined)

export function useAuthSession() {
  const context = useContext(AuthSessionContext)

  if (!context) {
    throw new Error('useAuthSession must be used inside AuthSessionProvider')
  }

  return context
}
