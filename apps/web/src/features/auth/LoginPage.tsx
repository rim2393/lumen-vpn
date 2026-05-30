import { ArrowRight, Fingerprint, KeyRound, LockKeyhole } from 'lucide-react'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApiClient } from '../../shared/api/apiClientContext'
import type { LoginMethod, TelegramLoginPayload } from '../../shared/api/types'
import { useAuthSession } from './authSession'
import { isPasskeySupported, performPasskeyAuthentication } from './webauthn'

const OAUTH_KINDS = new Set(['oauth2', 'oidc'])

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const apiClient = useApiClient()
  const { setMfaChallenge, setSession } = useAuthSession()
  const [status, setStatus] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [methods, setMethods] = useState<LoginMethod[]>([])
  const [busyProvider, setBusyProvider] = useState<string | null>(null)
  const redirectTo =
    typeof location.state === 'object' &&
    location.state !== null &&
    'from' in location.state &&
    typeof location.state.from === 'string'
      ? location.state.from
      : '/dashboard'

  useEffect(() => {
    let active = true
    apiClient
      .listLoginMethods()
      .then((response) => {
        if (active) {
          setMethods(response.items.filter((method) => method.enabled))
        }
      })
      .catch(() => {
        if (active) {
          setMethods([])
        }
      })
    return () => {
      active = false
    }
  }, [apiClient])

  const completeLogin = useCallback(
    (result: Awaited<ReturnType<typeof apiClient.login>>, successMessage: string) => {
      if ('challengeToken' in result) {
        setSession(null)
        setMfaChallenge(result)
        setStatus('Credentials accepted. MFA challenge prepared.')
        navigate('/guard/mfa')
        return
      }
      setSession(result)
      setMfaChallenge(null)
      setStatus(successMessage)
      navigate(redirectTo)
    },
    [apiClient, navigate, redirectTo, setMfaChallenge, setSession],
  )

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
      completeLogin(authResult, 'Credentials accepted. Portal session can begin.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Sign in failed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleOAuth(provider: string) {
    setBusyProvider(provider)
    setStatus('')
    try {
      const { authorization_url } = await apiClient.startOAuth(provider, redirectTo)
      window.location.assign(authorization_url)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not start the sign-in flow.')
      setBusyProvider(null)
    }
  }

  async function handlePasskey() {
    if (!isPasskeySupported()) {
      setStatus('This browser does not support passkeys.')
      return
    }
    setBusyProvider('webauthn')
    setStatus('')
    try {
      const options = await apiClient.webauthnAuthenticateOptions()
      const assertion = await performPasskeyAuthentication(options.options)
      const result = await apiClient.webauthnAuthenticateVerify(options.challenge_id, assertion)
      completeLogin(result, 'Passkey accepted. Portal session can begin.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Passkey sign-in failed.')
    } finally {
      setBusyProvider(null)
    }
  }

  const handleTelegram = useCallback(
    async (payload: TelegramLoginPayload) => {
      setBusyProvider('telegram')
      setStatus('')
      try {
        const result = await apiClient.telegramLogin(payload)
        completeLogin(result, 'Telegram account accepted. Portal session can begin.')
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Telegram sign-in failed.')
      } finally {
        setBusyProvider(null)
      }
    },
    [apiClient, completeLogin],
  )

  const oauthMethods = methods.filter((method) => OAUTH_KINDS.has(method.kind))
  const passkeyMethod = methods.find((method) => method.kind === 'webauthn')
  const telegramMethod = methods.find(
    (method) => method.kind === 'telegram' && Boolean(method.bot_username),
  )
  const hasAlternativeMethods = Boolean(
    oauthMethods.length || passkeyMethod || telegramMethod,
  )

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
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <button type="submit" className="button button--primary" disabled={isSubmitting}>
        {isSubmitting ? 'Checking...' : 'Continue'}
        <ArrowRight size={18} aria-hidden="true" />
      </button>

      {hasAlternativeMethods ? (
        <div className="auth-card__alternatives">
          <div className="auth-card__divider" aria-hidden="true">
            <span>or</span>
          </div>

          {passkeyMethod ? (
            <button
              type="button"
              className="button button--ghost"
              onClick={handlePasskey}
              disabled={busyProvider !== null}
            >
              <Fingerprint size={18} aria-hidden="true" />
              {busyProvider === 'webauthn' ? 'Waiting for passkey...' : 'Sign in with a passkey'}
            </button>
          ) : null}

          {oauthMethods.map((method) => (
            <button
              key={method.provider}
              type="button"
              className="button button--ghost"
              onClick={() => handleOAuth(method.provider)}
              disabled={busyProvider !== null}
            >
              <KeyRound size={18} aria-hidden="true" />
              {busyProvider === method.provider
                ? `Redirecting to ${method.display_name}...`
                : `Continue with ${method.display_name}`}
            </button>
          ))}

          {telegramMethod?.bot_username ? (
            <TelegramLoginButton
              botUsername={telegramMethod.bot_username}
              onAuth={handleTelegram}
            />
          ) : null}
        </div>
      ) : null}

      <p className="auth-card__note" aria-live="polite">
        {status || 'Submit to continue to MFA.'}
      </p>
    </form>
  )
}

type TelegramLoginButtonProps = {
  botUsername: string
  onAuth: (payload: TelegramLoginPayload) => void
}

function TelegramLoginButton({ botUsername, onAuth }: TelegramLoginButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const callbackName = '__lumenTelegramAuth'
    const globalScope = window as unknown as Record<string, unknown>
    globalScope[callbackName] = (user: TelegramLoginPayload) => onAuth(user)

    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.async = true
    script.setAttribute('data-telegram-login', botUsername)
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-userpic', 'false')
    script.setAttribute('data-request-access', 'write')
    script.setAttribute('data-onauth', `${callbackName}(user)`)

    const node = containerRef.current
    node?.appendChild(script)

    return () => {
      if (node) {
        node.innerHTML = ''
      }
      delete globalScope[callbackName]
    }
  }, [botUsername, onAuth])

  return <div ref={containerRef} className="auth-card__telegram" />
}
