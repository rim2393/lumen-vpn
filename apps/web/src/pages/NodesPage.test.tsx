import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createDevelopmentLumenApiClient } from '../shared/api/developmentClient'
import type {
  LumenApiClient,
  NodeResponse,
  NodeProtocolSelectionResponse,
  NodeResumeRequest,
  ProvisioningJobCreateRequest,
  ProvisioningJobResponse,
} from '../shared/api/types'
import { developmentSession } from '../shared/data/developmentFixtures'
import { renderWithRouter } from '../test/renderWithRouter'

function createTestClient(overrides: Partial<LumenApiClient> = {}): LumenApiClient {
  return {
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
    listNodes: async () => ({ items: [] }),
    listUsers: async () => ({
      generatedAt: '2026-05-27T00:00:00Z',
      items: [],
      source: 'development',
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
    const resumeNode = vi.fn(async (_nodeId: string, _request: NodeResumeRequest) => ({
      capabilities: {},
      id: 'node-quarantined',
      last_seen_at: '2026-05-27T09:15:00Z',
      name: 'edge-quarantined',
      public_address: '203.0.113.12',
      region: 'ap',
      sort_order: 2,
      status: 'offline' as const,
    }))
    const nodes: NodeResponse[] = [
      {
        capabilities: { service_manager: 'systemd', tun: 'available' },
        id: 'node-active',
        last_seen_at: '2026-05-27T09:30:00Z',
        name: 'edge-active',
        public_address: '203.0.113.10',
        region: 'eu',
        sort_order: 0,
        status: 'active',
      },
      {
        capabilities: {},
        id: 'node-paused',
        last_seen_at: null,
        name: 'edge-paused',
        public_address: '203.0.113.11',
        region: 'us',
        sort_order: 1,
        status: 'license_paused',
      },
      {
        capabilities: { firewall: 'nftables' },
        id: 'node-quarantined',
        last_seen_at: '2026-05-27T09:15:00Z',
        name: 'edge-quarantined',
        public_address: '203.0.113.12',
        region: 'ap',
        sort_order: 2,
        status: 'quarantined',
      },
    ]
    const apiClient = createTestClient({
      getNodeOverview: async (nodeId: string) => ({
        command_status_counts: [{ count: 2, status: 'succeeded' }],
        infra_billing_records: [
          {
            amount: 12.5,
            currency: 'USD',
            id: 'billing-node-active',
            node_id: nodeId,
            note: 'monthly vps',
            period: '2026-06',
            provider_id: 'provider-1',
            provider_name: 'Provider One',
          },
        ],
        infra_billing_totals: [{ currency: 'USD', records: 1, total: 12.5 }],
        latest_commands: [],
        latest_metrics: [
          {
            metric_kind: 'runtime',
            observed_at: '2026-05-27T09:30:00Z',
            values_json: { rx_bytes: 2048, tx_bytes: 1024 },
          },
        ],
        node: nodes[0],
        traffic: {
          download_bytes: 2048,
          last_observed_at: '2026-05-27T09:30:00Z',
          metric_samples: 1,
          total_bytes: 3072,
          upload_bytes: 1024,
        },
      }),
      listNodes: async () => ({
        items: nodes,
      }),
      resumeNode,
    })
    const user = userEvent.setup()

    renderWithRouter('/nodes', { apiClient, initialSession: developmentSession })

    expect(
      await screen.findByRole('table', { name: /node provisioning and heartbeat inventory/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('edge-active')).toBeInTheDocument()
    expect(screen.getByText('203.0.113.10')).toBeInTheDocument()
    expect(screen.getAllByText(/license pause/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/quarantine/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/1 nodes paused by license policy/i)).toBeInTheDocument()
    expect(screen.getByText(/1 nodes isolated from traffic/i)).toBeInTheDocument()
    expect(
      screen.getByText(/2 of 3 nodes reported heartbeat; 1 node missing heartbeat data/i),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Inspect' })[0])
    expect(await screen.findByRole('region', { name: /node live overview/i })).toBeInTheDocument()
    expect(screen.getByText('3.00 KB')).toBeInTheDocument()
    expect(screen.getByText('Provider One')).toBeInTheDocument()
    const resumeButtons = screen.getAllByRole('button', { name: 'Resume' })
    expect(resumeButtons[0]).toBeDisabled()
    expect(resumeButtons[1]).toBeEnabled()
    expect(resumeButtons[2]).toBeEnabled()

    await user.click(resumeButtons[2])

    await waitFor(() => expect(resumeNode).toHaveBeenCalledTimes(1))
    expect(resumeNode).toHaveBeenCalledWith('node-quarantined', {
      clear_quarantine: true,
      target_status: 'offline',
    })
  })

  it('does not present node telemetry as healthy before any real heartbeat exists', async () => {
    const nodes: NodeResponse[] = [
      {
        capabilities: {},
        id: 'node-active-unseen',
        last_seen_at: null,
        name: 'edge-active-unseen',
        public_address: '203.0.113.13',
        region: 'eu',
        sort_order: 0,
        status: 'active',
      },
    ]
    const apiClient = createTestClient({
      listNodes: async () => ({
        items: nodes,
      }),
    })

    renderWithRouter('/nodes', { apiClient, initialSession: developmentSession })

    expect(await screen.findByText('edge-active-unseen')).toBeInTheDocument()
    expect(screen.getByText(/telemetry pending/i)).toBeInTheDocument()
    expect(
      screen.getByText(/No node has reported a heartbeat yet; 1 node missing heartbeat data/i),
    ).toBeInTheDocument()
  })

  it('shows real node action results and blocks control buttons while a command is pending', async () => {
    const user = userEvent.setup()
    const restartNode = vi.fn(async (nodeId: string) => ({
      claimed_at: null,
      command_type: 'node.restart',
      completed_at: null,
      created_at: '2026-05-27T10:00:00Z',
      error_code: null,
      error_message: null,
      id: 'cmd_restart_1',
      node_id: nodeId,
      payload_json: { reason: 'operator requested restart' },
      result_json: null,
      status: 'queued',
      updated_at: '2026-05-27T10:00:00Z',
    }))
    const nodes: NodeResponse[] = [
      {
        capabilities: {},
        id: 'node-action',
        last_seen_at: '2026-05-27T09:30:00Z',
        name: 'edge-action',
        public_address: '203.0.113.20',
        region: 'eu',
        sort_order: 0,
        status: 'active',
      },
      {
        capabilities: {
          pending_control_command_id: 'cmd_pending',
          pending_control_command_type: 'node.restart',
          pending_control_target_status: 'offline',
        },
        id: 'node-pending',
        last_seen_at: '2026-05-27T09:31:00Z',
        name: 'edge-pending',
        public_address: '203.0.113.21',
        region: 'us',
        sort_order: 1,
        status: 'active',
      },
    ]
    const apiClient = createTestClient({
      listNodeCommands: async () => ({ items: [] }),
      listNodeMetrics: async () => ({ items: [] }),
      listNodes: async () => ({ items: nodes }),
      restartNode,
    })

    renderWithRouter('/nodes', { apiClient, initialSession: developmentSession })

    expect(await screen.findByText('edge-action')).toBeInTheDocument()
    expect(screen.getByText(/Pending control command/i)).toBeInTheDocument()
    const restartButtons = screen.getAllByRole('button', { name: 'Restart' })
    expect(restartButtons[0]).toBeEnabled()
    expect(restartButtons[1]).toBeDisabled()

    await user.click(restartButtons[0])
    expect(restartNode).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog', { name: /restart node edge-action/i })
    expect(dialog).toHaveTextContent(/real API/i)
    await user.click(within(dialog).getByRole('button', { name: /^restart$/i }))

    await waitFor(() => expect(restartNode).toHaveBeenCalledWith('node-action'))
    expect(await screen.findByText(/Last node action/i)).toBeInTheDocument()
    expect(screen.getByText(/node.restart queued as cmd_restart_1/i)).toBeInTheDocument()
  })

  it('updates selected node protocols from the checkbox matrix through the real API contract', async () => {
    const user = userEvent.setup()
    const updateNodeProtocolSelection = vi.fn(
      async (_nodeId: string, _request: { enabled_profile_ids: string[] }): Promise<NodeProtocolSelectionResponse> => ({
        items: [
          {
            adapter: 'vless',
            enabled: true,
            name: 'VLESS Reality',
            profile_id: 'profile-vless',
            runtime_sync: { pending_apply: true, status: 'apply_queued' },
            status: 'active',
          },
          {
            adapter: 'hysteria2',
            enabled: true,
            name: 'Hysteria2 TLS',
            profile_id: 'profile-hy2',
            runtime_sync: { pending_apply: true, status: 'apply_queued' },
            status: 'active',
          },
        ],
        node_id: 'node-protocols',
        queued_commands: [
          {
            claimed_at: null,
            command_type: 'outbound.apply',
            completed_at: null,
            created_at: '2026-05-27T10:00:00Z',
            error_code: null,
            error_message: null,
            id: 'cmd-protocol-1',
            node_id: 'node-protocols',
            payload_json: { profileId: 'profile-hy2' },
            result_json: null,
            status: 'queued',
            updated_at: '2026-05-27T10:00:00Z',
          },
        ],
      }),
    )
    const node: NodeResponse = {
      capabilities: {},
      id: 'node-protocols',
      last_seen_at: '2026-05-27T09:30:00Z',
      name: 'edge-protocols',
      public_address: '203.0.113.40',
      region: 'eu',
      sort_order: 0,
      status: 'active',
    }
    const apiClient = createTestClient({
      getNodeProtocolSelection: async () => ({
        items: [
          {
            adapter: 'vless',
            enabled: true,
            name: 'VLESS Reality',
            profile_id: 'profile-vless',
            runtime_sync: { pending_apply: false, status: 'applied' },
            status: 'active',
          },
          {
            adapter: 'hysteria2',
            enabled: false,
            name: 'Hysteria2 TLS',
            profile_id: 'profile-hy2',
            runtime_sync: { pending_apply: false, status: 'never_applied' },
            status: 'disabled',
          },
        ],
        node_id: 'node-protocols',
        queued_commands: [],
      }),
      listNodeCommands: async () => ({ items: [] }),
      listNodeMetrics: async () => ({ items: [] }),
      listNodes: async () => ({ items: [node] }),
      updateNodeProtocolSelection,
    })

    renderWithRouter('/nodes', { apiClient, initialSession: developmentSession })

    expect(await screen.findByText('edge-protocols')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Inspect' }))
    expect(await screen.findByRole('table', { name: /node protocol assignment matrix/i })).toBeInTheDocument()

    await user.click(screen.getByLabelText(/hysteria2 tls/i))
    expect(screen.getByText(/1 pending changes/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /update protocols/i }))

    await waitFor(() =>
      expect(updateNodeProtocolSelection).toHaveBeenCalledWith('node-protocols', {
        enabled_profile_ids: ['profile-vless', 'profile-hy2'],
      }),
    )
    expect(await screen.findByText(/1 runtime command queued/i)).toBeInTheDocument()
  })

  it('requires inline confirmation before deleting a real node', async () => {
    const user = userEvent.setup()
    const deleteNode = vi.fn(async (nodeId: string) => ({
      capabilities: {},
      id: nodeId,
      last_seen_at: '2026-05-27T09:30:00Z',
      name: 'edge-delete',
      public_address: '203.0.113.30',
      region: 'eu',
      sort_order: 0,
      status: 'deleted' as const,
    }))
    const nodes: NodeResponse[] = [
      {
        capabilities: {},
        id: 'node-delete',
        last_seen_at: '2026-05-27T09:30:00Z',
        name: 'edge-delete',
        public_address: '203.0.113.30',
        region: 'eu',
        sort_order: 0,
        status: 'active',
      },
    ]
    const apiClient = createTestClient({
      deleteNode,
      listNodeCommands: async () => ({ items: [] }),
      listNodeMetrics: async () => ({ items: [] }),
      listNodes: async () => ({ items: nodes }),
    })

    renderWithRouter('/nodes', { apiClient, initialSession: developmentSession })

    expect(await screen.findByText('edge-delete')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(deleteNode).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog', { name: /delete node edge-delete/i })
    expect(dialog).toHaveTextContent(/live API/i)
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(deleteNode).toHaveBeenCalledWith('node-delete'))
    expect(screen.getByText('deleted', { selector: '.status-badge' })).toBeInTheDocument()
  })

  it('creates a provisioning job with credentials_ref only and safe token templates', async () => {
    const createProvisioningJob = vi.fn(async (request: ProvisioningJobCreateRequest) =>
      buildProvisioningJob(request),
    )
    const apiClient = createTestClient({ createProvisioningJob })
    const user = userEvent.setup()

    renderWithRouter('/nodes', { apiClient, initialSession: developmentSession })

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
