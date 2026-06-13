import { describe, expect, it, vi } from 'vitest'
import type { AuthSession } from './types'
import { createHttpLumenApiClient } from './httpClient'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  })
}

function testSession(): AuthSession {
  return {
    accessToken: 'lumen_at_session',
    email: 'admin@test.lumentah.tel',
    expiresAt: '2026-05-28T12:00:00Z',
    name: 'Admin',
    refreshToken: 'lumen_rt_session',
    role: 'admin',
    scopes: ['node:manage', 'subscription:manage', 'user:manage'],
    userId: 'admin',
  }
}

describe('createHttpLumenApiClient', () => {
  it('reads the real server session after login instead of fabricating identity', async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
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
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof URL ? input.pathname : new URL(String(input)).pathname

      if (url === '/api/auth/session' && fetcher.mock.calls.length === 1) {
        return jsonResponse({ error: { message: 'Session has expired.' } }, 401)
      }

      if (url === '/api/v1/auth/refresh') {
        expect(init).toMatchObject({ credentials: 'include', method: 'POST' })
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
  })

  it('queues profile apply through the production profile endpoint', async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof URL ? input.pathname : new URL(String(input)).pathname
      expect(init?.method).toBe('POST')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer lumen_at_session' })
      expect(url).toBe('/api/v1/profiles/profile-live/apply-to-node')

      return jsonResponse({
        adapter: 'vless-reality',
        command_id: 'cmd-live-apply',
        command_type: 'outbound.apply',
        node_id: 'node-live',
        status: 'queued',
      })
    })

    const client = createHttpLumenApiClient({
      baseUrl: 'https://panel.example.test',
      fetcher,
      getSession: () => ({
        accessToken: 'lumen_at_session',
        email: 'admin@test.lumentah.tel',
        expiresAt: '2026-05-28T12:00:00Z',
        name: 'Admin',
        refreshToken: 'lumen_rt_session',
        role: 'admin',
        scopes: ['node:manage'],
        userId: 'admin',
      }),
    })

    await expect(client.applyProfileToNode('profile-live')).resolves.toMatchObject({
      command_id: 'cmd-live-apply',
      command_type: 'outbound.apply',
      node_id: 'node-live',
      status: 'queued',
    })
  })

  it('refreshes an expired access token and retries the original request once', async () => {
    let currentSession: AuthSession = {
      accessToken: 'lumen_at_expired',
      email: 'admin@test.lumentah.tel',
      expiresAt: '2026-05-28T12:00:00Z',
      name: 'Admin',
      refreshToken: 'lumen_rt_session',
      role: 'admin' as const,
      scopes: ['user:manage'],
      userId: 'admin',
    }
    const setSession = vi.fn((session: AuthSession | null) => {
      if (session) {
        currentSession = {
          accessToken: session.accessToken ?? '',
          email: session.email,
          expiresAt: session.expiresAt,
          name: session.name,
          refreshToken: session.refreshToken ?? '',
          role: session.role,
          scopes: session.scopes,
          userId: session.userId,
        }
      }
    })
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof URL ? input.pathname : new URL(String(input)).pathname

      if (url === '/api/v1/users' && fetcher.mock.calls.length === 1) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer lumen_at_expired' })
        return jsonResponse(
          { error: { message: 'A valid API key is required.' } },
          401,
        )
      }

      if (url === '/api/v1/auth/refresh') {
        expect(init?.method).toBe('POST')
        expect(init?.body).toBe(JSON.stringify({ refresh_token: 'lumen_rt_session' }))
        return jsonResponse({
          access_token: 'lumen_at_refreshed',
          expires_at: '2026-05-28T12:10:00Z',
          refresh_token: 'lumen_rt_rotated',
          token_type: 'Bearer',
        })
      }

      if (url === '/api/auth/session') {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer lumen_at_refreshed' })
        return jsonResponse({
          email: 'admin@test.lumentah.tel',
          expiresAt: '2026-05-28T12:10:00Z',
          name: 'Admin',
          role: 'admin',
          scopes: ['user:manage'],
          userId: 'admin',
        })
      }

      if (url === '/api/v1/users') {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer lumen_at_refreshed' })
        return jsonResponse({ items: [] })
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    const client = createHttpLumenApiClient({
      baseUrl: 'https://panel.example.test',
      fetcher,
      getSession: () => currentSession,
      setSession,
    })

    await expect(client.listUsers()).resolves.toEqual({ items: [] })
    expect(setSession).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'lumen_at_refreshed',
        refreshToken: 'lumen_rt_rotated',
      }),
    )
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('uses production subscription admin endpoints for lookup clone devices and delete', async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input))
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer lumen_at_session' })

      if (url.pathname === '/api/v1/subscriptions/lookup') {
        expect(url.searchParams.get('query')).toBe('short-user')
        return jsonResponse({ items: [] })
      }

      if (url.pathname === '/api/v1/subscriptions/sub-live/clone') {
        expect(init?.method).toBe('POST')
        return jsonResponse({ id: 'sub-clone', public_id: 'lumen_sub_clone' })
      }

      if (url.pathname === '/api/v1/subscriptions/sub-live/devices') {
        return jsonResponse({ items: [{ id: 'phone', status: 'active' }] })
      }

      if (url.pathname === '/api/v1/subscriptions/sub-live') {
        expect(init?.method).toBe('DELETE')
        return new Response(null, { status: 204 })
      }

      throw new Error(`Unexpected request: ${url.pathname}`)
    })

    const client = createHttpLumenApiClient({
      baseUrl: 'https://panel.example.test',
      fetcher,
      getSession: () => ({
        accessToken: 'lumen_at_session',
        email: 'admin@test.lumentah.tel',
        expiresAt: '2026-05-28T12:00:00Z',
        name: 'Admin',
        refreshToken: 'lumen_rt_session',
        role: 'admin',
        scopes: ['subscription:manage'],
        userId: 'admin',
      }),
    })

    await expect(client.lookupSubscriptions('short-user')).resolves.toEqual({ items: [] })
    await expect(client.cloneSubscription('sub-live')).resolves.toMatchObject({
      id: 'sub-clone',
      public_id: 'lumen_sub_clone',
    })
    await expect(client.listSubscriptionDevices('sub-live')).resolves.toMatchObject({
      items: [{ id: 'phone', status: 'active' }],
    })
    await expect(client.deleteSubscription('sub-live')).resolves.toBeUndefined()
  })

  it('calls real API endpoints for core admin resource groups', async () => {
    const calls: Array<{ method: string; pathname: string; search: string }> = []
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input))
      calls.push({
        method: init?.method ?? 'GET',
        pathname: url.pathname,
        search: url.search,
      })
      return jsonResponse({ id: 'ok', items: [] })
    })
    const client = createHttpLumenApiClient({
      baseUrl: 'https://panel.example.test',
      fetcher,
      getSession: testSession,
    })

    await client.listNodes()
    await client.createProvisioningJob({} as never)
    await client.issueInstallToken('job-live')
    await client.readProvisioningJob('job-live')
    await client.listProfiles()
    await client.applyProfileToNode('profile-live')
    await client.listSubscriptions()
    await client.issueSubscriptionFromProfile({} as never)
    await client.readToolSummary()
    await client.inspectHwid('device live')
    await client.listSettings()
    await client.listSettingGroups()
    await client.listAuthProviders()
    await client.listNodePlugins('node live')
    await client.createNodePlugin({} as never)
    await client.listLoginMethods()
    await client.readPanelIdentity()

    expect(calls).toEqual([
      { method: 'GET', pathname: '/api/v1/nodes', search: '' },
      { method: 'POST', pathname: '/api/v1/nodes/provisioning-jobs', search: '' },
      { method: 'POST', pathname: '/api/v1/nodes/provisioning-jobs/job-live/install-token', search: '' },
      { method: 'GET', pathname: '/api/v1/nodes/provisioning-jobs/job-live', search: '' },
      { method: 'GET', pathname: '/api/v1/profiles', search: '' },
      { method: 'POST', pathname: '/api/v1/profiles/profile-live/apply-to-node', search: '' },
      { method: 'GET', pathname: '/api/v1/subscriptions', search: '' },
      { method: 'POST', pathname: '/api/v1/subscriptions/actions/issue-from-profile', search: '' },
      { method: 'GET', pathname: '/api/v1/tools/summary', search: '' },
      { method: 'GET', pathname: '/api/v1/tools/hwid-inspector', search: '?query=device%20live' },
      { method: 'GET', pathname: '/api/v1/settings', search: '' },
      { method: 'GET', pathname: '/api/v1/settings/groups', search: '' },
      { method: 'GET', pathname: '/api/v1/settings/auth/providers', search: '' },
      { method: 'GET', pathname: '/api/v1/node-plugins', search: '?node_id=node%20live' },
      { method: 'POST', pathname: '/api/v1/node-plugins', search: '' },
      { method: 'GET', pathname: '/api/v1/auth/providers', search: '' },
      { method: 'GET', pathname: '/api/v1/settings/public/identity', search: '' },
    ])
  })
})
