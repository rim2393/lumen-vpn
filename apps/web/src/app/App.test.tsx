import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDevelopmentLumenApiClient } from '../shared/api/developmentClient'
import type { LumenApiClient } from '../shared/api/types'
import { developmentSession } from '../shared/data/developmentFixtures'
import { renderWithRouter } from '../test/renderWithRouter'

describe('Lumen admin routing', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.lang = 'en'
  })

  it('renders the dashboard shell with primary navigation', async () => {
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      listApiKeys: async () => ({
        generatedAt: '2026-05-28T00:00:00Z',
        items: [],
        source: 'api',
        total: 0,
      }),
      listNodes: async () => ({
        items: [
          {
            capabilities: {},
            id: 'node-live-01',
            last_seen_at: '2026-05-28T00:00:00Z',
            name: 'live-node-01',
            public_address: '85.192.60.8',
            region: 'EU',
            sort_order: 0,
            status: 'active',
          },
        ],
      }),
      listSubscriptions: async () => ({ items: [] }),
      listUsers: async () => ({
        generatedAt: '2026-05-28T00:00:00Z',
        items: [],
        source: 'api',
        total: 0,
      }),
      readLicense: async () => null,
    }

    renderWithRouter('/dashboard', { apiClient, initialSession: developmentSession })

    expect(await screen.findByRole('heading', { name: /command dashboard/i })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: /primary/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /users/i })).toHaveAttribute('href', '/users')
    expect(screen.getByRole('combobox', { name: /interface language/i })).toBeInTheDocument()
    expect(await screen.findByText('1 / 1')).toBeInTheDocument()
    expect(screen.getByText('Live API')).toBeInTheDocument()
  })

  it('wires shell controls to real UI state and routes', async () => {
    const user = userEvent.setup()

    renderWithRouter('/dashboard', { apiClient: createDevelopmentLumenApiClient(), initialSession: developmentSession })

    expect(await screen.findByText(developmentSession.email)).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: /interface language/i }), 'ru')
    expect(document.documentElement.lang).toBe('ru')
    expect(window.localStorage.getItem('lumen-ui-language')).toBe('ru')
    expect(screen.getByRole('link', { name: /пользователи/i })).toHaveAttribute('href', '/users')

    await user.type(screen.getByPlaceholderText(/поиск пользователей, нод, хостов/i), 'ноды')
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { level: 1, name: /ноды/i })).toBeInTheDocument()
  })

  it('redirects protected admin routes to real sign in without a session', async () => {
    renderWithRouter('/dashboard', { initialSession: null })

    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
  })

  it('renders the Lumen Guard MFA step', () => {
    renderWithRouter('/guard/mfa')

    expect(screen.getByRole('heading', { name: /verify mfa/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/one-time code/i)).toBeInTheDocument()
    expect(screen.getByText(/authenticator app registered on this account/i)).toBeInTheDocument()
    expect(screen.getByText(/active totp method/i)).toBeInTheDocument()
  })

  it('renders API-backed resource screens with the isolated development client', async () => {
    renderWithRouter('/api-keys', {
      apiClient: createDevelopmentLumenApiClient(),
      initialSession: developmentSession,
    })

    expect(screen.getByRole('heading', { level: 1, name: /api keys/i })).toBeInTheDocument()
    expect(screen.getByText(/scoped automation tokens/i)).toBeInTheDocument()
    expect(await screen.findByRole('table', { name: /api key inventory/i })).toBeInTheDocument()
  })

  it('creates and revokes scoped API keys with one-time reveal', async () => {
    const user = userEvent.setup()
    const createApiKey = async (request: Parameters<LumenApiClient['createApiKey']>[0]) => ({
      api_key: 'lumen_sk_test_one_time_value',
      expires_at: request.expires_at ?? null,
      id: 'key_created',
      key_prefix: 'lumen_sk_test_one',
      name: request.name,
    })
    const createSpy = vi.fn(createApiKey)
    const revokeSpy = vi.fn(async (_apiKeyId: string) => undefined)
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      createApiKey: createSpy,
      listApiKeys: async () => ({
        generatedAt: '2026-05-28T00:00:00Z',
        items: [
          {
            createdAt: '2026-05-28T00:00:00Z',
            expiresAt: null,
            fingerprint: 'lumen_sk_existing',
            id: 'key_existing',
            keyPrefix: 'lumen_sk_existing',
            lastUsedAt: null,
            name: 'Existing token',
            owner: 'usr_admin',
            ownerUserId: 'usr_admin',
            scopes: ['api_key:manage'],
            status: 'active',
          },
        ],
        source: 'api',
        total: 1,
      }),
      revokeApiKey: revokeSpy,
    }

    renderWithRouter('/api-keys', { apiClient, initialSession: developmentSession })

    expect(await screen.findByRole('table', { name: /api key inventory/i })).toBeInTheDocument()
    await user.type(screen.getByLabelText(/^name$/i), 'Telegram bot')
    await user.selectOptions(screen.getByLabelText(/preset/i), 'Node automation')
    await user.selectOptions(screen.getByLabelText(/expiration/i), '30')
    await user.click(screen.getAllByRole('button', { name: /create key/i }).at(-1)!)

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1))
    expect(createSpy).toHaveBeenCalledWith({
      expires_at: expect.any(String),
      name: 'Telegram bot',
      scopes: ['node:manage', 'subscription:read'],
    })
    expect(await screen.findByText(/lumen_sk_test_one_time_value/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /revoke existing token/i }))
    await waitFor(() => expect(revokeSpy).toHaveBeenCalledWith('key_existing'))
  })

  it('renders graceful empty and error resource states', async () => {
    const emptyApiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      createProvisioningJob: async () => {
        throw new Error('Provisioning is unavailable')
      },
      getSession: async () => null,
      listApiKeys: async () => ({
        generatedAt: '2026-05-27T00:00:00Z',
        items: [],
        source: 'development',
        total: 0,
      }),
      listNodes: async () => {
        throw new Error('Node registry is unavailable')
      },
      listUsers: async () => ({
        generatedAt: '2026-05-27T00:00:00Z',
        items: [],
        source: 'development',
        total: 0,
      }),
      readProvisioningJob: async () => {
        throw new Error('Provisioning job is unavailable')
      },
      readLicense: async () => null,
    }

    renderWithRouter('/api-keys', { apiClient: emptyApiClient, initialSession: developmentSession })
    expect(await screen.findByRole('heading', { name: /no api keys issued/i })).toBeInTheDocument()

    renderWithRouter('/nodes', { apiClient: emptyApiClient, initialSession: developmentSession })
    expect(await screen.findByRole('alert')).toHaveTextContent(/node registry is unavailable/i)
  })
})
