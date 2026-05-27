import { type PropsWithChildren, useMemo, useState } from 'react'
import { mockSession } from '../../shared/data/lumenData'
import type { AuthSession } from '../../shared/api/types'
import {
  AuthSessionContext,
  type AuthSessionContextValue,
  type AuthSessionStatus,
} from './authSession'

type AuthSessionProviderProps = PropsWithChildren<{
  initialSession?: AuthSession | null
}>

export function AuthSessionProvider({ children, initialSession = mockSession }: AuthSessionProviderProps) {
  const [session, setSession] = useState<AuthSession | null>(initialSession)
  const status: AuthSessionStatus = session ? 'authenticated' : 'anonymous'

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      clearSession: () => setSession(null),
      session,
      setSession,
      status,
    }),
    [session, status],
  )

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>
}
