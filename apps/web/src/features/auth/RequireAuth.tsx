import type { PropsWithChildren } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthSession } from './authSession'

export function RequireAuth({ children }: PropsWithChildren) {
  const location = useLocation()
  const { status } = useAuthSession()

  if (status !== 'authenticated') {
    return <Navigate to="/guard/login" replace state={{ from: location.pathname }} />
  }

  return children
}
