import { ArrowRight, ShieldCheck } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApiClient } from '../../shared/api/apiClientContext'
import { useAuthSession } from './authSession'

export function MfaPage() {
  const apiClient = useApiClient()
  const navigate = useNavigate()
  const { mfaChallenge, setMfaChallenge, setSession } = useAuthSession()
  const [status, setStatus] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!mfaChallenge) {
      setStatus('Start with username and password before entering an MFA code.')
      return
    }
    setIsSubmitting(true)
    const form = new FormData(event.currentTarget)
    try {
      const session = await apiClient.verifyMfaChallenge({
        challengeToken: mfaChallenge.challengeToken,
        code: String(form.get('code') ?? ''),
        methodId: mfaChallenge.methods[0]?.id ?? '',
      })
      setSession(session)
      setMfaChallenge(null)
      setStatus('Challenge accepted. Portal session can begin.')
      navigate('/dashboard')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'MFA verification failed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form className="auth-card" onSubmit={handleSubmit}>
      <div className="auth-card__icon" aria-hidden="true">
        <ShieldCheck size={24} />
      </div>
      <div>
        <p className="eyebrow">Step 2 of 2</p>
        <h2>Verify MFA</h2>
        <p>Confirm the one-time code from an authenticator or hardware token.</p>
      </div>
      <label>
        One-time code
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          placeholder="000000"
          required
        />
      </label>
      <button type="submit" className="button button--primary" disabled={isSubmitting}>
        {isSubmitting ? 'Verifying...' : 'Open portal'}
        <ArrowRight size={18} aria-hidden="true" />
      </button>
      <p className="auth-card__note" aria-live="polite">
        {status || 'MFA is mandatory for privileged Lumen admin routes.'}
      </p>
    </form>
  )
}
