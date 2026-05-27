import { ArrowRight, LockKeyhole } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApiClient } from '../../shared/api/apiClientContext'
import { useAuthSession } from './authSession'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const apiClient = useApiClient()
  const { setMfaChallenge, setSession } = useAuthSession()
  const [status, setStatus] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const redirectTo =
    typeof location.state === 'object' &&
    location.state !== null &&
    'from' in location.state &&
    typeof location.state.from === 'string'
      ? location.state.from
      : '/dashboard'

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setStatus('')
    const form = new FormData(event.currentTarget)
    try {
      const authResult = await apiClient.login({
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
      })
      if ('challengeToken' in authResult) {
        setSession(null)
        setMfaChallenge(authResult)
        setStatus('Credentials accepted. MFA challenge prepared.')
        navigate('/guard/mfa')
        return
      }
      setSession(authResult)
      setMfaChallenge(null)
      setStatus('Credentials accepted. Portal session can begin.')
      navigate(redirectTo)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Sign in failed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form className="auth-card" onSubmit={handleSubmit}>
      <div className="auth-card__icon" aria-hidden="true">
        <LockKeyhole size={24} />
      </div>
      <div>
        <p className="eyebrow">Lumen Guard</p>
        <h2>Sign in</h2>
        <p>Use an operator account. Credentials are sent to the auth API and are not stored.</p>
      </div>
      <label>
        Email
        <input name="email" type="email" autoComplete="email" placeholder="admin@lumen.local" required />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <button type="submit" className="button button--primary" disabled={isSubmitting}>
        {isSubmitting ? 'Checking...' : 'Continue'}
        <ArrowRight size={18} aria-hidden="true" />
      </button>
      <p className="auth-card__note" aria-live="polite">
        {status || 'Submit to continue to MFA.'}
      </p>
    </form>
  )
}
