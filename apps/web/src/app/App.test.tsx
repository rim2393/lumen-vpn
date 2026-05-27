import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LumenApiClient } from '../shared/api/types'
import { renderWithRouter } from '../test/renderWithRouter'

describe('Lumen admin routing scaffold', () => {
  it('renders the dashboard shell with primary navigation', async () => {
    renderWithRouter('/dashboard')

    expect(await screen.findByRole('heading', { name: /command dashboard/i })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: /primary/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /users/i })).toHaveAttribute('href', '/users')
  })

  it('renders the Lumen Guard MFA step', () => {
    renderWithRouter('/guard/mfa')

    expect(screen.getByRole('heading', { name: /verify mfa/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/one-time code/i)).toBeInTheDocument()
  })

  it('renders API-backed resource screens with mock data', async () => {
    renderWithRouter('/api-keys')

    expect(screen.getByRole('heading', { level: 1, name: /api keys/i })).toBeInTheDocument()
    expect(screen.getByText(/scoped token management/i)).toBeInTheDocument()
    expect(await screen.findByRole('table', { name: /api key inventory/i })).toBeInTheDocument()
  })

  it('renders graceful empty and error resource states', async () => {
    const emptyApiClient: LumenApiClient = {
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
      readLicense: async () => null,
    }

    renderWithRouter('/api-keys', { apiClient: emptyApiClient })
    expect(await screen.findByRole('heading', { name: /no api keys issued/i })).toBeInTheDocument()

    renderWithRouter('/nodes', { apiClient: emptyApiClient })
    expect(await screen.findByRole('alert')).toHaveTextContent(/node registry is unavailable/i)
  })
})
