import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createDevelopmentLumenApiClient } from '../shared/api/developmentClient'
import type {
  LumenApiClient,
  SettingUpdateRequest,
  SquadCreateRequest,
  UserRecord,
  UserUpdateRequest,
} from '../shared/api/types'
import { developmentSession } from '../shared/data/developmentFixtures'
import { renderWithRouter } from '../test/renderWithRouter'

describe('Control plane resource screens', () => {
  it('renders API-backed hosts, profiles, squads, subscriptions, and settings screens', async () => {
    const apiClient = createDevelopmentLumenApiClient()

    const hosts = renderWithRouter('/hosts', { apiClient, initialSession: developmentSession })
    expect(await screen.findByRole('table', { name: /host inventory/i })).toBeInTheDocument()
    expect(screen.getByText('auto.lumen.local')).toBeInTheDocument()
    hosts.unmount()

    const profiles = renderWithRouter('/profiles', { apiClient, initialSession: developmentSession })
    expect(await screen.findByRole('heading', { name: /^profiles$/i })).toBeInTheDocument()
    expect(await screen.findByRole('table', { name: /^profile inbounds$/i })).toBeInTheDocument()
    expect(await screen.findByRole('table', { name: /^global profile inbounds$/i })).toBeInTheDocument()
    expect(screen.getAllByText('StealConfig').length).toBeGreaterThan(0)
    profiles.unmount()

    const squads = renderWithRouter('/squads', { apiClient, initialSession: developmentSession })
    expect(await screen.findByRole('table', { name: /squad inventory/i })).toBeInTheDocument()
    expect(screen.getByText('Default-Squad')).toBeInTheDocument()
    squads.unmount()

    const subscription = renderWithRouter('/subscription', { apiClient, initialSession: developmentSession })
    expect(await screen.findByRole('table', { name: /subscription inventory/i })).toBeInTheDocument()
    expect(screen.getAllByText('sub_pub_default').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /open subscription page/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^mihomo$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /users/i })).toHaveAttribute('href', '/users')
    subscription.unmount()

    const userDetail = renderWithRouter('/users/usr_mira', { apiClient, initialSession: developmentSession })
    expect(await screen.findByRole('heading', { name: /mira volkova/i })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: /issued subscriptions/i })).toBeInTheDocument()
    expect(screen.getAllByText('sub_pub_default').length).toBeGreaterThan(0)
    expect(screen.getByText(/no devices are registered/i)).toBeInTheDocument()
    expect(screen.getByText(/no request history is recorded/i)).toBeInTheDocument()
    userDetail.unmount()

    renderWithRouter('/settings', { apiClient, initialSession: developmentSession })
    expect(await screen.findByRole('table', { name: /panel setting inventory/i })).toBeInTheDocument()
    expect(screen.getByText('subscription.info')).toBeInTheDocument()
    cleanup()

    const templates = renderWithRouter('/templates', { apiClient, initialSession: developmentSession })
    expect(await screen.findByRole('heading', { name: /templates/i })).toBeInTheDocument()
    templates.unmount()

    const rules = renderWithRouter('/response-rules', { apiClient, initialSession: developmentSession })
    expect(await screen.findByRole('heading', { name: /response rules/i })).toBeInTheDocument()
    rules.unmount()

    const page = renderWithRouter('/subscription-page', { apiClient, initialSession: developmentSession })
    expect(await screen.findByRole('heading', { name: /subscription page/i })).toBeInTheDocument()
    page.unmount()

    renderWithRouter('/tools', { apiClient, initialSession: developmentSession })
    expect(await screen.findByRole('table', { name: /operational tools/i })).toBeInTheDocument()
    cleanup()
  })

  it('renders dashboard traffic and user risks from the real user API shape', async () => {
    const users: UserRecord[] = [
      {
        created_at: '2026-05-27T00:00:00Z',
        device_limit: null,
        display_name: 'Real Shape',
        email: 'real-shape@lumen.local',
        expires_at: null,
        id: 'usr_real_shape',
        metadata_json: {},
        role: 'user',
        status: 'limited',
        tags: ['grace'],
        telegram_id: null,
        traffic_limit_gb: 100,
        traffic_used_gb: 12,
        updated_at: '2026-05-27T00:00:00Z',
        username: 'real-shape',
      },
    ]
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      listUsers: async () => ({ items: users }),
    }

    renderWithRouter('/dashboard', { apiClient, initialSession: developmentSession })

    expect(await screen.findByRole('heading', { name: /command dashboard/i })).toBeInTheDocument()
    expect(await screen.findByText('12 GiB')).toBeInTheDocument()
    expect(screen.getByText(/users limited or in grace/i)).toBeInTheDocument()
  })

  it('saves profile config and metadata JSON through the real profile update contract', async () => {
    const user = userEvent.setup()
    const developmentClient = createDevelopmentLumenApiClient()
    const checkPortConflicts = vi.fn(async () => ({ allowed: true, conflicts: [] }))
    const updateProfile = vi.fn(developmentClient.updateProfile)
    const apiClient: LumenApiClient = {
      ...developmentClient,
      checkPortConflicts,
      updateProfile,
    }

    renderWithRouter('/profiles', { apiClient, initialSession: developmentSession })

    expect(await screen.findByRole('heading', { name: /^profiles$/i })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: /^edit$/i }))
    const saveButton = await screen.findByRole('button', { name: /save profile/i })
    const form = saveButton.closest('form')
    expect(form).not.toBeNull()

    fireEvent.change(screen.getByLabelText(/profile config json/i), { target: { value: '{' } })
    fireEvent.submit(form as HTMLFormElement)
    expect(await screen.findByText(/profile config json must be valid json/i)).toBeInTheDocument()
    expect(updateProfile).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/profile config json/i), {
      target: { value: JSON.stringify({ security: 'reality', transport: 'tcp' }, null, 2) },
    })
    fireEvent.change(screen.getByLabelText(/profile metadata json/i), { target: { value: '[]' } })
    fireEvent.submit(form as HTMLFormElement)
    expect(await screen.findByText(/profile metadata json must be an object/i)).toBeInTheDocument()
    expect(updateProfile).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/profile config json/i), {
      target: {
        value: JSON.stringify(
          {
            routing: { domainStrategy: 'AsIs' },
            security: 'reality',
            transport: 'tcp',
          },
          null,
          2,
        ),
      },
    })
    fireEvent.change(screen.getByLabelText(/server name/i), {
      target: { value: 'front.example.test' },
    })
    fireEvent.change(screen.getByLabelText(/profile metadata json/i), {
      target: {
        value: JSON.stringify({ order: 7, owner: 'ops' }, null, 2),
      },
    })
    fireEvent.submit(form as HTMLFormElement)

    await waitFor(() => expect(updateProfile).toHaveBeenCalled())
    expect(updateProfile.mock.calls[0][1].config_json).toMatchObject({
      routing: { domainStrategy: 'AsIs' },
      security: {
        serverName: 'front.example.test',
        type: 'reality',
      },
    })
    expect(updateProfile.mock.calls[0][1].metadata_json).toMatchObject({
      order: 7,
      owner: 'ops',
    })
  })

  it('wires profile manual reorder controls to the real reorder API contract', async () => {
    const user = userEvent.setup()
    const developmentClient = createDevelopmentLumenApiClient()
    const reorderProfiles = vi.fn(developmentClient.reorderProfiles)
    const apiClient: LumenApiClient = {
      ...developmentClient,
      reorderProfiles,
    }

    renderWithRouter('/profiles', { apiClient, initialSession: developmentSession })

    expect(await screen.findByRole('heading', { name: /^profiles$/i })).toBeInTheDocument()
    const moveDown = await screen.findAllByRole('button', { name: /move stealconfig down/i })
    await user.click(moveDown[0])

    await waitFor(() => expect(reorderProfiles).toHaveBeenCalled())
    expect(reorderProfiles.mock.calls[0][0]).toEqual(['profile_trojan_xhttp', 'profile_stealconfig'])
  })

  it('wires per-user lifecycle controls to real update requests', async () => {
    const user = userEvent.setup()
    const users: UserRecord[] = [
      {
        created_at: '2026-05-27T00:00:00Z',
        device_limit: 3,
        display_name: 'Lifecycle User',
        email: 'lifecycle@lumen.local',
        expires_at: null,
        id: 'usr_lifecycle',
        metadata_json: {},
        role: 'user',
        status: 'active',
        tags: [],
        telegram_id: null,
        traffic_limit_gb: 300,
        traffic_used_gb: 42,
        updated_at: '2026-05-27T00:00:00Z',
        username: 'lifecycle',
      },
    ]
    const updateUser = vi.fn(async (userId: string, request: UserUpdateRequest) => ({
      ...users[0],
      id: userId,
      ...request,
    }))
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      listUsers: async () => ({ items: users }),
      updateUser,
    }

    renderWithRouter('/users', { apiClient, initialSession: developmentSession })

    expect(await screen.findByText('Lifecycle User')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /toggle status lifecycle user/i }))
    await user.click(screen.getByRole('button', { name: /reset traffic lifecycle user/i }))
    await user.click(screen.getByRole('button', { name: /revoke lifecycle user/i }))

    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(3))
    expect(updateUser.mock.calls[0]).toEqual(['usr_lifecycle', { status: 'disabled' }])
    expect(updateUser.mock.calls[1]).toEqual(['usr_lifecycle', { traffic_used_gb: 0 }])
    expect(updateUser.mock.calls[2]).toEqual(['usr_lifecycle', { status: 'revoked' }])
  })

  it('wires user detail HWID device deletion controls to backend requests', async () => {
    const user = userEvent.setup()
    const owner: UserRecord = {
      created_at: '2026-05-27T00:00:00Z',
      device_limit: 2,
      display_name: 'Device Owner',
      email: 'devices@lumen.local',
      expires_at: null,
      id: 'usr_devices',
      metadata_json: {},
      role: 'user',
      status: 'active',
      tags: [],
      telegram_id: null,
      traffic_limit_gb: 100,
      traffic_used_gb: 1,
      updated_at: '2026-05-27T00:00:00Z',
      username: 'devices',
    }
    const detail = {
      accessible_nodes: [],
      devices: [
        {
          hwid: 'HWID-1',
          id: 'phone',
          label: 'Phone',
          last_seen_at: null,
          metadata_json: {},
          platform: 'android',
          status: 'active',
        },
        {
          hwid: 'HWID-2',
          id: 'tablet',
          label: 'Tablet',
          last_seen_at: null,
          metadata_json: {},
          platform: 'ios',
          status: 'active',
        },
      ],
      request_history: [],
      subscriptions: [],
      user: owner,
    }
    const deleteUserDevice = vi.fn(async (_userId: string, deviceId: string) => {
      detail.devices = detail.devices.filter((device) => device.id !== deviceId)
      return detail
    })
    const clearUserDevices = vi.fn(async () => {
      detail.devices = []
      return detail
    })
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      clearUserDevices,
      deleteUserDevice,
      getUserDetail: async () => detail,
    }

    renderWithRouter('/users/usr_devices', { apiClient, initialSession: developmentSession })

    expect(await screen.findByRole('table', { name: /registered devices/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /delete device phone/i }))
    await waitFor(() => expect(deleteUserDevice).toHaveBeenCalledWith('usr_devices', 'phone'))
    await user.click(screen.getByRole('button', { name: /clear all devices/i }))
    await waitFor(() => expect(clearUserDevices).toHaveBeenCalledWith('usr_devices'))
  })

  it('wires HWID inspector device actions to backend requests', async () => {
    const user = userEvent.setup()
    const owner: UserRecord = {
      created_at: '2026-05-27T00:00:00Z',
      device_limit: 2,
      display_name: 'Device Owner',
      email: 'device-owner@lumen.local',
      expires_at: null,
      id: 'usr_hwid_tools',
      metadata_json: {},
      role: 'user',
      status: 'active',
      tags: [],
      telegram_id: null,
      traffic_limit_gb: 100,
      traffic_used_gb: 1,
      updated_at: '2026-05-27T00:00:00Z',
      username: 'device-owner',
    }
    const deleteUserDevice = vi.fn(async () => ({
      accessible_nodes: [],
      devices: [],
      request_history: [],
      subscriptions: [],
      user: owner,
    }))
    const clearUserDevices = vi.fn(async () => ({
      accessible_nodes: [],
      devices: [],
      request_history: [],
      subscriptions: [],
      user: owner,
    }))
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      clearUserDevices,
      deleteUserDevice,
      inspectHwid: async () => ({
        items: [
          {
            device_count: 1,
            device_limit: 2,
            device_records: [
              {
                hwid: 'HWID-1',
                id: 'phone',
                label: 'Phone',
                platform: 'android',
                status: 'active',
              },
            ],
            devices: ['Phone'],
            email: 'device-owner@lumen.local',
            status: 'ok',
            user_id: 'usr_hwid_tools',
            username: 'device-owner',
          },
        ],
      }),
    }

    renderWithRouter('/tools', { apiClient, initialSession: developmentSession })

    expect(await screen.findByRole('table', { name: /operational tools/i })).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: /delete device phone for device-owner@lumen.local/i }),
    )
    await waitFor(() =>
      expect(deleteUserDevice).toHaveBeenCalledWith('usr_hwid_tools', 'phone'),
    )
    await user.click(screen.getByRole('button', { name: /^clear all$/i }))
    await waitFor(() => expect(clearUserDevices).toHaveBeenCalledWith('usr_hwid_tools'))
  })

  it('wires session browser revoke actions to backend requests', async () => {
    const user = userEvent.setup()
    const revokeToolSession = vi.fn(async () => ({
      items: [
        {
          created_at: '2026-05-28T00:00:00.000Z',
          email: 'operator@lumen.local',
          expires_at: '2026-05-29T00:00:00.000Z',
          id: 'session-operator',
          ip_fingerprint: 'ip-hash',
          is_current: false,
          revoked_at: '2026-05-28T01:00:00.000Z',
          status: 'revoked',
          updated_at: '2026-05-28T01:00:00.000Z',
          user_agent_fingerprint: 'ua-hash',
          user_id: 'usr_operator',
        },
      ],
    }))
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      inspectSessions: async () => ({
        items: [
          {
            created_at: '2026-05-28T00:00:00.000Z',
            email: 'operator@lumen.local',
            expires_at: '2026-05-29T00:00:00.000Z',
            id: 'session-operator',
            ip_fingerprint: 'ip-hash',
            is_current: false,
            revoked_at: null,
            status: 'active',
            updated_at: '2026-05-28T00:00:00.000Z',
            user_agent_fingerprint: 'ua-hash',
            user_id: 'usr_operator',
          },
        ],
      }),
      revokeToolSession,
    }

    renderWithRouter('/tools', { apiClient, initialSession: developmentSession })

    await user.click(await screen.findByRole('button', { name: /session browser/i }))
    await user.click(screen.getByRole('button', { name: /^revoke$/i }))
    await waitFor(() => expect(revokeToolSession).toHaveBeenCalledWith('session-operator'))
  })

  it('wires torrent report truncation to backend requests', async () => {
    const user = userEvent.setup()
    const truncateTorrentReports = vi.fn(async () => ({ items: [] }))
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      inspectTorrentReports: async () => ({
        items: [
          {
            action: 'torrent.blocked',
            actor_email: 'operator@lumen.local',
            created_at: '2026-05-28T00:00:00.000Z',
            id: 'torrent-event-1',
            metadata_json: { host: 'example.test' },
            resource_id: 'usr_operator',
          },
        ],
      }),
      truncateTorrentReports,
    }

    renderWithRouter('/tools', { apiClient, initialSession: developmentSession })

    await user.click(await screen.findByRole('button', { name: /torrent blocker reports/i }))
    await user.click(screen.getByRole('button', { name: /^truncate$/i }))
    await waitFor(() => expect(truncateTorrentReports).toHaveBeenCalledTimes(1))
  })

  it('wires key utility generation to backend requests', async () => {
    const user = userEvent.setup()
    const generateX25519Keypair = vi.fn(async () => ({
      encoding: 'base64url-nopad',
      private_key: 'private-key',
      public_key: 'public-key',
    }))
    const generateNodeKey = vi.fn(async () => ({
      hash_algorithm: 'hmac-sha256',
      stored: false,
      token: 'lumen_node_real_once',
      token_prefix: 'lumen_node_real_on',
    }))
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      generateNodeKey,
      generateX25519Keypair,
    }

    renderWithRouter('/tools', { apiClient, initialSession: developmentSession })

    await user.click(await screen.findByRole('button', { name: /key utilities/i }))
    await user.click(screen.getByRole('button', { name: /generate x25519/i }))
    await waitFor(() => expect(generateX25519Keypair).toHaveBeenCalledTimes(1))
    expect(await screen.findAllByText('public-key')).toHaveLength(2)
    expect(screen.getByText('private-key')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /generate node key/i }))
    await waitFor(() => expect(generateNodeKey).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('lumen_node_real_once')).toBeInTheDocument()
  })

  it('wires tool snippet CRUD actions to backend requests', async () => {
    const user = userEvent.setup()
    const createToolSnippet = vi.fn(async () => ({
      content: 'systemctl status xray',
      description: null,
      id: 'snippet-1',
      language: 'shell',
      name: 'Xray status',
      order: 0,
      updated_at: '2026-05-28T00:00:00.000Z',
      updated_by: 'owner',
    }))
    const updateToolSnippet = vi.fn(async () => ({
      content: 'systemctl status xray',
      description: null,
      id: 'snippet-1',
      language: 'shell',
      name: 'Xray status',
      order: 0,
      updated_at: '2026-05-28T00:00:00.000Z',
      updated_by: 'owner',
    }))
    const deleteToolSnippet = vi.fn(async () => ({ items: [] }))
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      createToolSnippet,
      deleteToolSnippet,
      listToolSnippets: async () => ({
        items: [
          {
            content: 'systemctl status xray',
            description: null,
            id: 'snippet-1',
            language: 'shell',
            name: 'Xray status',
            order: 0,
            updated_at: '2026-05-28T00:00:00.000Z',
            updated_by: 'owner',
          },
        ],
      }),
      updateToolSnippet,
    }

    renderWithRouter('/tools', { apiClient, initialSession: developmentSession })

    await user.click(await screen.findByRole('button', { name: /^snippets$/i }))
    await user.click(screen.getByRole('button', { name: /create snippet/i }))
    await waitFor(() =>
      expect(createToolSnippet).toHaveBeenCalledWith({
        content: 'systemctl status xray',
        language: 'shell',
        name: 'Xray status',
      }),
    )
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() =>
      expect(updateToolSnippet).toHaveBeenCalledWith('snippet-1', {
        content: 'systemctl status xray',
        name: 'Xray status',
      }),
    )
    await user.click(screen.getByRole('button', { name: /delete snippet xray status/i }))
    await waitFor(() => expect(deleteToolSnippet).toHaveBeenCalledWith('snippet-1'))
  })

  it('exposes refresh buttons as real accessible controls on resource screens', async () => {
    const apiClient = createDevelopmentLumenApiClient()

    for (const [path, label] of [
      ['/users', /refresh users/i],
      ['/nodes', /refresh nodes/i],
      ['/hosts', /refresh hosts/i],
      ['/profiles', /refresh profiles/i],
      ['/squads', /refresh squads/i],
      ['/subscription', /refresh subscription/i],
      ['/templates', /refresh templates/i],
      ['/response-rules', /refresh response rules/i],
      ['/settings', /refresh settings/i],
    ] as const) {
      const view = renderWithRouter(path, { apiClient, initialSession: developmentSession })
      const refreshButton = await screen.findByRole('button', { name: label })
      await waitFor(() => expect(refreshButton).toBeEnabled())
      view.unmount()
    }
  })

  it('creates squads through the typed API client contract', async () => {
    const user = userEvent.setup()
    const createSquad = vi.fn(async (request: SquadCreateRequest) => ({
      id: 'squad_new',
      kind: request.kind ?? 'internal',
      metadata_json: request.metadata_json ?? {},
      name: request.name,
      status: request.status ?? 'active',
    }))
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      createSquad,
      listSquads: async () => ({ items: [] }),
    }

    renderWithRouter('/squads', { apiClient, initialSession: developmentSession })

    expect(await screen.findByRole('heading', { name: /no squads created/i })).toBeInTheDocument()
    await user.type(screen.getByLabelText(/^name$/i), 'Canary')
    await user.clear(screen.getByLabelText(/metadata/i))
    await user.type(screen.getByLabelText(/metadata/i), 'channel=canary, hwid_limit=2')
    await user.click(screen.getByRole('button', { name: /create squad/i }))

    await waitFor(() => expect(createSquad).toHaveBeenCalledTimes(1))
    expect(createSquad.mock.calls[0][0]).toMatchObject({
      kind: 'internal',
      metadata_json: { channel: 'canary', hwid_limit: '2' },
      name: 'Canary',
    })
  })

  it('updates settings without accepting secret-like keys', async () => {
    const user = userEvent.setup()
    const updateSetting = vi.fn(async (key: string, request: SettingUpdateRequest) => ({
      id: `setting_${key}`,
      key,
      updated_at: '2026-05-27T00:00:00Z',
      updated_by: 'usr_admin',
      value_json: request.value_json,
    }))
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      updateSetting,
    }

    renderWithRouter('/settings', { apiClient, initialSession: developmentSession })

    expect(await screen.findByRole('table', { name: /panel setting inventory/i })).toBeInTheDocument()
    await user.clear(screen.getByLabelText(/^key$/i))
    await user.type(screen.getByLabelText(/^key$/i), 'subscription.info')
    await user.clear(screen.getByLabelText(/^value$/i))
    await user.type(screen.getByLabelText(/^value$/i), 'title=LUMEN, auto_update_hours=2')
    await user.click(screen.getByRole('button', { name: /save setting/i }))
    await waitFor(() => expect(updateSetting).toHaveBeenCalledTimes(1))

    await user.clear(screen.getByLabelText(/^value$/i))
    await user.type(screen.getByLabelText(/^value$/i), 'api_token=bad')
    await user.click(screen.getByRole('button', { name: /save setting/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/secret-like/i)
  })

  it('does not offer enable actions for catalog-only auth providers', async () => {
    const updateAuthProvider = vi.fn()
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      updateAuthProvider,
    }

    renderWithRouter('/settings', { apiClient, initialSession: developmentSession })

    expect(await screen.findByRole('heading', { name: /provider toggles/i })).toBeInTheDocument()
    expect(screen.getByText('Passkey')).toBeInTheDocument()
    const unavailableButtons = await screen.findAllByRole('button', { name: /unavailable/i })
    expect(unavailableButtons.length).toBeGreaterThan(0)
    expect(unavailableButtons[0]).toBeDisabled()
    expect(updateAuthProvider).not.toHaveBeenCalled()
  })
})
