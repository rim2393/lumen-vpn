import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createMockLumenApiClient } from '../shared/api/mockClient'
import type { LumenApiClient } from '../shared/api/types'
import { mockSession } from '../shared/data/lumenData'
import { renderWithRouter } from '../test/renderWithRouter'

describe('Lumen admin routing scaffold', () => {
  it('renders the dashboard shell with primary navigation', async () => {
    const apiClient: LumenApiClient = {
      ...createMockLumenApiClient(),
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

    renderWithRouter('/dashboard', { apiClient, initialSession: mockSession })

    expect(await screen.findByRole('heading', { name: /command dashboard/i })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: /primary/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /users/i })).toHaveAttribute('href', '/users')
    expect(screen.getByRole('combobox', { name: /interface language/i })).toBeInTheDocument()
    expect(await screen.findByText('1 / 1')).toBeInTheDocument()
    expect(screen.getByText('Live API')).toBeInTheDocument()
  })

  it('redirects protected admin routes to real sign in without a session', async () => {
    renderWithRouter('/dashboard', { initialSession: null })

    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
  })

  it('renders the Lumen Guard MFA step', () => {
    renderWithRouter('/guard/mfa')

    expect(screen.getByRole('heading', { name: /verify mfa/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/one-time code/i)).toBeInTheDocument()
  })

  it('renders API-backed resource screens with mock data', async () => {
    renderWithRouter('/api-keys', {
      apiClient: createMockLumenApiClient(),
      initialSession: mockSession,
    })

    expect(screen.getByRole('heading', { level: 1, name: /api keys/i })).toBeInTheDocument()
    expect(screen.getByText(/scoped token management/i)).toBeInTheDocument()
    expect(await screen.findByRole('table', { name: /api key inventory/i })).toBeInTheDocument()
  })

  it('renders graceful empty and error resource states', async () => {
    const emptyApiClient: LumenApiClient = {
      ...createMockLumenApiClient(),
      createProvisioningJob: async () => {
        throw new Error('Provisioning is unavailable')
      },
      getSession: async () => null,
      listApiKeys: async () => ({
        generatedAt: '2026-05-27T00:00:00Z',
        items: [],
        source: 'mock',
        total: 0,
      }),
      listNodes: async () => {
        throw new Error('Node registry is unavailable')
      },
      listUsers: async () => ({
        generatedAt: '2026-05-27T00:00:00Z',
        items: [],
        source: 'mock',
        total: 0,
      }),
      readProvisioningJob: async () => {
        throw new Error('Provisioning job is unavailable')
      },
      readLicense: async () => null,
    }

    renderWithRouter('/api-keys', { apiClient: emptyApiClient, initialSession: mockSession })
    expect(await screen.findByRole('heading', { name: /no api keys issued/i })).toBeInTheDocument()

    renderWithRouter('/nodes', { apiClient: emptyApiClient, initialSession: mockSession })
    expect(await screen.findByRole('alert')).toHaveTextContent(/node registry is unavailable/i)
  })
})
