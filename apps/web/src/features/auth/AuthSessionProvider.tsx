import { type PropsWithChildren, useMemo, useState } from 'react'
import type { AuthSession, MfaChallenge } from '../../shared/api/types'
import {
  AuthSessionContext,
  type AuthSessionContextValue,
  type AuthSessionStatus,
} from './authSession'

type AuthSessionProviderProps = PropsWithChildren<{
  initialSession?: AuthSession | null
}>

export function AuthSessionProvider({ children, initialSession = null }: AuthSessionProviderProps) {
  const [session, setSession] = useState<AuthSession | null>(initialSession)
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallenge | null>(null)
  const status: AuthSessionStatus = session ? 'authenticated' : 'anonymous'

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      clearSession: () => {
        setMfaChallenge(null)
        setSession(null)
      },
      mfaChallenge,
      session,
      setMfaChallenge,
      setSession,
      status,
    }),
    [mfaChallenge, session, status],
  )

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>
}
