import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createDevelopmentLumenApiClient } from '../shared/api/developmentClient'
import type {
  LumenApiClient,
  NodeCommandRecord,
  NodePluginRecord,
  NodeResponse,
} from '../shared/api/types'
import { developmentSession } from '../shared/data/developmentFixtures'
import { renderWithRouter } from '../test/renderWithRouter'

function createTestClient(overrides: Partial<LumenApiClient> = {}): LumenApiClient {
  return {
    ...createDevelopmentLumenApiClient(),
    getSession: async () => null,
    listApiKeys: async () => ({
      generatedAt: '2026-05-27T00:00:00Z',
      items: [],
      source: 'development',
      total: 0,
    }),
    listUsers: async () => ({
      generatedAt: '2026-05-27T00:00:00Z',
      items: [],
      source: 'development',
      total: 0,
    }),
    readLicense: async () => null,
    ...overrides,
  }
}

function plugin(overrides: Partial<NodePluginRecord>): NodePluginRecord {
  return {
    config_json: {},
    created_at: '2026-05-27T10:00:00Z',
    enabled: true,
    id: 'plugin-default',
    kind: 'torrent-blocker',
    name: 'Default plugin',
    node_id: null,
    sort_order: 0,
    updated_at: '2026-05-27T10:00:00Z',
    ...overrides,
  }
}

function command(overrides: Partial<NodeCommandRecord>): NodeCommandRecord {
  return {
    claimed_at: null,
    command_type: 'firewall.plan.apply',
    completed_at: null,
    created_at: '2026-05-27T10:00:00Z',
    error_code: null,
    error_message: null,
    id: 'cmd-policy-1',
    node_id: 'node-1',
    payload_json: {},
    result_json: null,
    status: 'queued',
    updated_at: '2026-05-27T10:00:00Z',
    ...overrides,
  }
}

describe('NodePluginsPage', () => {
  it('wires clone, reorder and apply controls to the real API contract', async () => {
    const cloneNodePlugin = vi.fn(async () =>
      plugin({ id: 'plugin-copy', name: 'Torrent filter copy', sort_order: 20 }),
    )
    const reorderNodePlugins = vi.fn(async () => ({
      items: [
        plugin({ id: 'plugin-domain', kind: 'domain-filter', name: 'Domain filter', sort_order: 0 }),
        plugin({ id: 'plugin-torrent', name: 'Torrent filter', sort_order: 10 }),
      ],
    }))
    const applyNodePlugins = vi.fn(async () =>
      command({
        payload_json: {
          nodePolicy: {
            modelVersion: 'lumen.node-policy.v1',
            plugins: [{ id: 'plugin-torrent', kind: 'torrent-blocker', name: 'Torrent filter' }],
          },
        },
      }),
    )
    const nodes: NodeResponse[] = [
      {
        capabilities: {},
        id: 'node-1',
        last_seen_at: '2026-05-27T09:30:00Z',
        name: 'node-01',
        public_address: '203.0.113.10',
        region: 'test',
        sort_order: 0,
        status: 'active',
      },
    ]
    const apiClient = createTestClient({
      applyNodePlugins,
      cloneNodePlugin,
      listNodePlugins: async () => ({
        items: [
          plugin({ id: 'plugin-torrent', name: 'Torrent filter', sort_order: 0 }),
          plugin({ id: 'plugin-domain', kind: 'domain-filter', name: 'Domain filter', sort_order: 10 }),
        ],
      }),
      listNodes: async () => ({ items: nodes }),
      reorderNodePlugins,
    })
    const user = userEvent.setup()

    renderWithRouter('/node-plugins', { apiClient, initialSession: developmentSession })

    expect(await screen.findByText('Torrent filter')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /edit/i })[0])
    await user.click(screen.getByRole('button', { name: /clone/i }))
    await waitFor(() => expect(cloneNodePlugin).toHaveBeenCalledWith('plugin-torrent', expect.any(Object)))

    await user.click(screen.getAllByRole('button', { name: /down/i })[0])
    await waitFor(() =>
      expect(reorderNodePlugins).toHaveBeenCalledWith({
        items: [
          { id: 'plugin-torrent', sort_order: 10 },
          { id: 'plugin-domain', sort_order: 0 },
        ],
      }),
    )

    await user.selectOptions(screen.getAllByLabelText(/^node$/i)[1], 'node-1')
    await user.click(screen.getByRole('button', { name: /apply policy/i }))

    await waitFor(() =>
      expect(applyNodePlugins).toHaveBeenCalledWith({
        node_id: 'node-1',
        reason: 'operator applied node plugin policy',
      }),
    )
    expect(await screen.findByText(/firewall\.plan\.apply cmd-policy-1/i)).toBeInTheDocument()
  })
})
