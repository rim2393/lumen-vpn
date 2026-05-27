import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createMockLumenApiClient } from '../shared/api/mockClient'
import type {
  LumenApiClient,
  NodeResponse,
  ProvisioningJobCreateRequest,
  ProvisioningJobResponse,
} from '../shared/api/types'
import { mockSession } from '../shared/data/lumenData'
import { renderWithRouter } from '../test/renderWithRouter'

function createTestClient(overrides: Partial<LumenApiClient> = {}): LumenApiClient {
  return {
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
    listNodes: async () => ({ items: [] }),
    listUsers: async () => ({
      generatedAt: '2026-05-27T00:00:00Z',
      items: [],
      source: 'mock',
      total: 0,
    }),
    readLicense: async () => null,
    readProvisioningJob: async () => {
      throw new Error('Provisioning job is unavailable')
    },
    ...overrides,
  }
}

function buildProvisioningJob(
  request: ProvisioningJobCreateRequest,
): ProvisioningJobResponse {
  return {
    created_at: '2026-05-27T10:00:00Z',
    error_code: null,
    error_message: null,
    id: 'job-edge-new',
    idempotency_key: request.idempotency_key,
    kind: 'node.provision',
    node_id: 'node-edge-new',
    preflight_result: {},
    preflight_status: 'pending',
    requested_capabilities: request.requested_capabilities,
    ssh_credentials_ref: request.ssh.credentials_ref,
    ssh_host: request.ssh.host,
    ssh_port: request.ssh.port,
    ssh_username: request.ssh.username,
    status: 'queued',
    token_exchanged_at: null,
    token_issued_at: null,
    updated_at: '2026-05-27T10:00:00Z',
  }
}

describe('NodesPage backend wiring', () => {
  it('renders backend node records with policy and heartbeat states', async () => {
    const nodes: NodeResponse[] = [
      {
        capabilities: { service_manager: 'systemd', tun: 'available' },
        id: 'node-active',
        last_seen_at: '2026-05-27T09:30:00Z',
        name: 'edge-active',
        public_address: '203.0.113.10',
        region: 'eu',
        status: 'active',
      },
      {
        capabilities: {},
        id: 'node-paused',
        last_seen_at: null,
        name: 'edge-paused',
        public_address: '203.0.113.11',
        region: 'us',
        status: 'license_paused',
      },
      {
        capabilities: { firewall: 'nftables' },
        id: 'node-quarantined',
        last_seen_at: '2026-05-27T09:15:00Z',
        name: 'edge-quarantined',
        public_address: '203.0.113.12',
        region: 'ap',
        status: 'quarantined',
      },
    ]
    const apiClient = createTestClient({
      listNodes: async () => ({
        items: nodes,
      }),
    })

    renderWithRouter('/nodes', { apiClient, initialSession: mockSession })

    expect(
      await screen.findByRole('table', { name: /node provisioning and heartbeat inventory/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('edge-active')).toBeInTheDocument()
    expect(screen.getByText('203.0.113.10')).toBeInTheDocument()
    expect(screen.getAllByText(/license pause/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/quarantine/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/1 nodes paused by license policy/i)).toBeInTheDocument()
    expect(screen.getByText(/1 nodes isolated from traffic/i)).toBeInTheDocument()
    expect(screen.getByText(/1 nodes missing heartbeat data/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
  })

  it('creates a provisioning job with credentials_ref only and safe token placeholders', async () => {
    const createProvisioningJob = vi.fn(async (request: ProvisioningJobCreateRequest) =>
      buildProvisioningJob(request),
    )
    const apiClient = createTestClient({ createProvisioningJob })
    const user = userEvent.setup()

    renderWithRouter('/nodes', { apiClient, initialSession: mockSession })

    await user.type(screen.getByLabelText(/node name/i), 'edge-new')
    await user.type(screen.getByLabelText(/region/i), 'eu')
    await user.type(screen.getByLabelText(/public address/i), '203.0.113.50')
    await user.type(screen.getByLabelText(/ssh host/i), '203.0.113.50')
    await user.clear(screen.getByLabelText(/ssh port/i))
    await user.type(screen.getByLabelText(/ssh port/i), '2222')
    await user.clear(screen.getByLabelText(/ssh username/i))
    await user.type(screen.getByLabelText(/ssh username/i), 'deploy')
    await user.type(
      screen.getByLabelText(/^credentials_ref$/i),
      'vault://lumen/nodes/edge-new/ssh',
    )
    await user.clear(screen.getByLabelText(/requested capabilities/i))
    await user.type(
      screen.getByLabelText(/requested capabilities/i),
      'service_manager=systemd, tun=available',
    )
    await user.click(screen.getByRole('button', { name: /start provisioning/i }))

    await waitFor(() => expect(createProvisioningJob).toHaveBeenCalledTimes(1))
    const payload = createProvisioningJob.mock.calls[0][0]
    expect(payload.ssh.credentials_ref).toBe('vault://lumen/nodes/edge-new/ssh')
    expect(payload.ssh).not.toHaveProperty('password')
    expect(JSON.stringify(payload).toLowerCase()).not.toContain('private_key')
    expect(payload.requested_capabilities).toEqual({
      service_manager: 'systemd',
      tun: 'available',
    })
    expect(await screen.findByText(/provisioning job queued/i)).toBeInTheDocument()
    expect(screen.getByText(/not issued; one-time plaintext/i)).toBeInTheDocument()
    expect(screen.getByText(/pending node-agent exchange/i)).toBeInTheDocument()
    expect(screen.queryByText(/lumen_it_/i)).not.toBeInTheDocument()
  })
})
