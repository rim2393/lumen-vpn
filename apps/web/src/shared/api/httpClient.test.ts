import { describe, expect, it, vi } from 'vitest'
import { createHttpLumenApiClient } from './httpClient'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  })
}

describe('createHttpLumenApiClient', () => {
  it('reads the real server session after login instead of fabricating identity', async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo, _init?: RequestInit) => {
      const url = input instanceof URL ? input.pathname : new URL(String(input)).pathname

      if (url === '/api/v1/auth/login') {
        return jsonResponse({
          access_token: 'lumen_at_login',
          expires_at: '2026-05-28T12:00:00Z',
          refresh_token: 'lumen_rt_login',
          token_type: 'Bearer',
        })
      }

      if (url === '/api/auth/session') {
        return jsonResponse({
          email: 'owner@test.lumentah.tel',
          expiresAt: '2026-05-28T12:00:00Z',
          name: 'Owner',
          role: 'owner',
          scopes: ['user:manage'],
          userId: '0e0e0e0e-0000-4000-8000-000000000001',
        })
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    const client = createHttpLumenApiClient({
      baseUrl: 'https://panel.example.test',
      fetcher,
      getSession: () => null,
    })

    const session = await client.login({
      email: 'typed-email@example.test',
      password: 'typed-password',
    })

    expect('challengeToken' in session).toBe(false)
    if ('challengeToken' in session) {
      throw new Error('expected session')
    }
    expect(session.email).toBe('owner@test.lumentah.tel')
    expect(session.role).toBe('owner')
    expect(session.userId).toBe('0e0e0e0e-0000-4000-8000-000000000001')
    expect(session.accessToken).toBe('lumen_at_login')
    expect(session.refreshToken).toBe('lumen_rt_login')
  })

  it('restores the operator session by refreshing from the secure cookie', async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo, _init?: RequestInit) => {
      const url = input instanceof URL ? input.pathname : new URL(String(input)).pathname

      if (url === '/api/auth/session' && fetcher.mock.calls.length === 1) {
        return jsonResponse({ error: { message: 'Session has expired.' } }, 401)
      }

      if (url === '/api/v1/auth/refresh') {
        return jsonResponse({
          access_token: 'lumen_at_refreshed',
          expires_at: '2026-05-28T12:00:00Z',
          refresh_token: 'lumen_rt_rotated',
          token_type: 'Bearer',
        })
      }

      if (url === '/api/auth/session') {
        return jsonResponse({
          email: 'admin@test.lumentah.tel',
          expiresAt: '2026-05-28T12:00:00Z',
          name: 'Admin',
          role: 'admin',
          scopes: ['user:manage'],
          userId: 'admin',
        })
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    const client = createHttpLumenApiClient({
      baseUrl: 'https://panel.example.test',
      fetcher,
      getSession: () => null,
    })

    const session = await client.getSession()

    expect(session?.email).toBe('admin@test.lumentah.tel')
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(new URL(String(fetcher.mock.calls[1][0])).pathname).toBe('/api/v1/auth/refresh')
    expect(fetcher.mock.calls[1][1]).toMatchObject({ credentials: 'include', method: 'POST' })
  })
})
