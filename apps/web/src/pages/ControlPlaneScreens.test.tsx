import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createDevelopmentLumenApiClient } from '../shared/api/developmentClient'
import type {
  LumenApiClient,
  ResponseRuleCreateRequest,
  ResponseRuleRecord,
  ResponseRuleUpdateRequest,
  SettingGroupUpdateRequest,
  SettingUpdateRequest,
  SubscriptionPageConfigCreateRequest,
  SubscriptionPageConfigRecord,
  SubscriptionPageConfigUpdateRequest,
  SubscriptionRecord,
  SquadCreateRequest,
  SquadDetailResponse,
  SquadUpdateRequest,
  SubscriptionTemplateCreateRequest,
  SubscriptionTemplateRecord,
  SubscriptionTemplateUpdateRequest,
  UserRecord,
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
    expect((await screen.findAllByRole('heading', { name: /subscription page/i })).length).toBeGreaterThan(0)
    page.unmount()

    renderWithRouter('/tools', { apiClient, initialSession: developmentSession })
    expect(await screen.findByRole('table', { name: /operational tools/i })).toBeInTheDocument()
    cleanup()
  })

  it('keeps inactive tools endpoints from breaking the active tool tab', async () => {
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      inspectHappRouting: vi.fn(async () => {
        throw new Error('inactive HApp endpoint should not block HWID tab')
      }),
      inspectSessions: vi.fn(async () => {
        throw new Error('inactive sessions endpoint should not block HWID tab')
      }),
      inspectTorrentReports: vi.fn(async () => {
        throw new Error('inactive torrent endpoint should not block HWID tab')
      }),
    }

    renderWithRouter('/tools', { apiClient, initialSession: developmentSession })

    expect(await screen.findByRole('table', { name: /operational tools/i })).toBeInTheDocument()
    expect(screen.queryByText(/tools unavailable/i)).not.toBeInTheDocument()
  })

  it('creates subscriptions with a real listed license and backend public render metadata', async () => {
    const user = userEvent.setup()
    const baseClient = createDevelopmentLumenApiClient()
    const createSubscription = vi.fn(baseClient.createSubscription)
    const apiClient: LumenApiClient = {
      ...baseClient,
      createSubscription,
    }

    renderWithRouter('/subscription', { apiClient, initialSession: developmentSession })

    expect(await screen.findByRole('table', { name: /subscription inventory/i })).toBeInTheDocument()
    expect(await screen.findByLabelText(/^(license|лицензия)$/i)).toHaveDisplayValue(/lumen-production-instance/i)
    expect(screen.getByText(/happ, hiddify/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^(create subscription|создать подписку)$/i }))

    await waitFor(() => expect(createSubscription).toHaveBeenCalledTimes(1))
    expect(createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        license_id: 'license_business',
        node_id: 'node_mow_02',
        user_id: 'usr_mira',
      }),
    )
  })

  it('requires inline confirmation before deleting a real subscription', async () => {
    const user = userEvent.setup()
    const baseClient = createDevelopmentLumenApiClient()
    const deleteSubscription = vi.fn(async () => undefined)
    const apiClient: LumenApiClient = {
      ...baseClient,
      deleteSubscription,
    }

    renderWithRouter('/subscription', { apiClient, initialSession: developmentSession })

    expect(await screen.findByRole('table', { name: /subscription inventory/i })).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /^delete$/i })[0])
    expect(deleteSubscription).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog', { name: /delete subscription/i })
    expect(dialog).toHaveTextContent(/live API/i)
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(deleteSubscription).toHaveBeenCalledTimes(1))
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
    expect(screen.getByText(/(users limited or in grace|пользователи с лимитом или grace)/i)).toBeInTheDocument()
  })

  it('wires per-user lifecycle controls to real update requests', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true)
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
    const disableUser = vi.fn(async (userId: string) => ({
      ...users[0],
      id: userId,
      status: 'disabled',
    }))
    const resetUserTraffic = vi.fn(async (userId: string) => ({
      ...users[0],
      id: userId,
      traffic_used_gb: 0,
    }))
    const revokeUser = vi.fn(async (userId: string) => ({
      ...users[0],
      id: userId,
      status: 'revoked',
    }))
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      listUsers: async () => ({ items: users }),
      disableUser,
      resetUserTraffic,
      revokeUser,
    }

    renderWithRouter('/users', { apiClient, initialSession: developmentSession })

    expect((await screen.findAllByText('Lifecycle User')).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /(toggle status|переключить статус) lifecycle user/i }))
    await user.click(screen.getByRole('button', { name: /(reset traffic|сбросить трафик) lifecycle user/i }))
    await user.click(within(screen.getByRole('alertdialog', { name: /reset traffic for lifecycle user/i })).getByRole('button', { name: /^reset traffic$/i }))
    const lifecycleRevokeButtons = screen.getAllByRole('button', { name: /^revoke$/i })
    await user.click(lifecycleRevokeButtons[lifecycleRevokeButtons.length - 1])
    await user.click(within(screen.getByRole('alertdialog', { name: /revoke user lifecycle user/i })).getByRole('button', { name: /^revoke$/i }))

    await waitFor(() => expect(disableUser).toHaveBeenCalledWith('usr_lifecycle'))
    await waitFor(() => expect(resetUserTraffic).toHaveBeenCalledWith('usr_lifecycle'))
    await waitFor(() => expect(revokeUser).toHaveBeenCalledWith('usr_lifecycle'))
  })

  it('wires user bulk controls to the real bulk API contract', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true)
    const users: UserRecord[] = [
      {
        created_at: '2026-05-27T00:00:00Z',
        device_limit: 3,
        display_name: 'Bulk User',
        email: 'bulk-user@lumen.local',
        expires_at: null,
        id: 'usr_bulk',
        metadata_json: {},
        role: 'user',
        status: 'active',
        tags: [],
        telegram_id: null,
        traffic_limit_gb: 300,
        traffic_used_gb: 42,
        updated_at: '2026-05-27T00:00:00Z',
        username: 'bulk-user',
      },
    ]
    const developmentClient = createDevelopmentLumenApiClient()
    const bulkUsers = vi.fn(async () => ({ items: users, updated: users.length }))
    const apiClient: LumenApiClient = {
      ...developmentClient,
      bulkUsers,
      listUsers: async () => ({ items: users }),
      listSquads: async () => ({
        items: [
          {
            created_at: '2026-05-27T00:00:00Z',
            id: 'squad_bulk',
            kind: 'internal',
            metadata_json: {},
            name: 'Bulk squad',
            status: 'active',
            updated_at: '2026-05-27T00:00:00Z',
          },
        ],
      }),
    }

    renderWithRouter('/users', { apiClient, initialSession: developmentSession })

    expect((await screen.findAllByText('Bulk User')).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('checkbox', { name: /(select|выбрать) bulk user/i }))
    await user.type(screen.getByLabelText(/(tags|теги)/i), 'vip, trial')
    await user.click(screen.getByRole('button', { name: /(apply tags|применить теги)/i }))
    await user.type(screen.getByLabelText(/(traffic delta gb|изменение трафика)/i), '5')
    await user.click(screen.getByRole('button', { name: /(apply traffic delta|применить изменение трафика)/i }))
    await user.selectOptions(screen.getByLabelText(/^(squad|сквад)$/i), 'squad_bulk')
    await user.click(screen.getByRole('button', { name: /(add to squad|добавить в сквад)/i }))
    await user.click(screen.getAllByRole('button', { name: /^revoke$/i })[0])
    await user.click(within(screen.getByRole('alertdialog', { name: /revoke selected users/i })).getByRole('button', { name: /^revoke$/i }))

    await waitFor(() => expect(bulkUsers).toHaveBeenCalledTimes(4))
    expect(bulkUsers.mock.calls[0]).toEqual([
      'tag',
      { tags: ['vip', 'trial'], user_ids: ['usr_bulk'] },
    ])
    expect(bulkUsers.mock.calls[1]).toEqual([
      'traffic',
      { traffic_delta_gb: 5, user_ids: ['usr_bulk'] },
    ])
    expect(bulkUsers.mock.calls[2]).toEqual([
      'squad-add',
      { squad_id: 'squad_bulk', user_ids: ['usr_bulk'] },
    ])
    expect(bulkUsers.mock.calls[3]).toEqual(['revoke', { user_ids: ['usr_bulk'] }])
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
      metadata_json: { numeric_id: 77 },
      role: 'user',
      status: 'active',
      tags: ['qa'],
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

    expect(await screen.findByRole('table', { name: /(registered devices|зарегистрированные устройства)/i })).toBeInTheDocument()
    expect(screen.getByText(/user metadata json|json метаданных пользователя/i)).toBeInTheDocument()
    expect(screen.getByText(/numeric_id/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /(delete|удалить) device phone|(delete|удалить) устройство phone/i }))
    expect(deleteUserDevice).not.toHaveBeenCalled()
    await user.click(within(screen.getByRole('alertdialog', { name: /delete device phone/i })).getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(deleteUserDevice).toHaveBeenCalledWith('usr_devices', 'phone'))
    await user.click(screen.getByRole('button', { name: /(clear all devices|очистить все устройства)/i }))
    expect(clearUserDevices).not.toHaveBeenCalled()
    await user.click(within(screen.getByRole('alertdialog', { name: /clear devices for device owner/i })).getByRole('button', { name: /^clear all devices$/i }))
    await waitFor(() => expect(clearUserDevices).toHaveBeenCalledWith('usr_devices'))
  })

  it('renders user detail editor with production form semantics', async () => {
    const owner: UserRecord = {
      created_at: '2026-05-27T00:00:00Z',
      device_limit: 2,
      display_name: 'Semantic Owner',
      email: 'semantic@lumen.local',
      expires_at: null,
      id: 'usr_semantic',
      metadata_json: { numeric_id: 78 },
      role: 'user',
      status: 'active',
      tags: ['qa'],
      telegram_id: '12345',
      traffic_limit_gb: 100,
      traffic_used_gb: 1,
      updated_at: '2026-05-27T00:00:00Z',
      username: 'semantic',
    }
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      getUserDetail: async () => ({
        accessible_nodes: [],
        devices: [],
        request_history: [],
        subscriptions: [],
        user: owner,
      }),
    }

    renderWithRouter('/users/usr_semantic', { apiClient, initialSession: developmentSession })

    expect(await screen.findByLabelText(/email/i)).toHaveAttribute('autocomplete', 'email')
    expect(screen.getByLabelText(/username/i)).toHaveAttribute('name', 'username')
    expect(screen.getByLabelText(/display name/i)).toHaveAttribute('autocomplete', 'name')
    expect(screen.getByLabelText(/telegram id/i)).toHaveAttribute('inputmode', 'numeric')
    expect(screen.getByLabelText(/new password/i)).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByLabelText(/user metadata json/i)).toHaveAttribute('name', 'metadata_json')
  })

  it('wires user detail subscription actions to real subscription APIs', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const owner: UserRecord = {
      created_at: '2026-05-27T00:00:00Z',
      device_limit: 2,
      display_name: 'Subscription Owner',
      email: 'subscription-owner@lumen.local',
      expires_at: null,
      id: 'usr_subscription_detail',
      metadata_json: { numeric_id: 79 },
      role: 'user',
      status: 'active',
      tags: ['qa'],
      telegram_id: null,
      traffic_limit_gb: 100,
      traffic_used_gb: 1,
      updated_at: '2026-05-27T00:00:00Z',
      username: 'subscription-owner',
    }
    const subscription: SubscriptionRecord = {
      config_hash: 'hash-live',
      created_at: '2026-05-27T00:00:00Z',
      delivery_profile: { client: 'happ', format: 'happ', profile_title: 'HApp live' },
      expires_at: null,
      id: 'sub-user-detail',
      license_id: 'lic-live',
      node_id: 'node-live',
      public_id: 'lumen_sub_user_detail',
      public_manifest_url: '/api/v1/subscriptions/public/lumen_sub_user_detail/manifest',
      public_page_url: '/sub/lumen_sub_user_detail',
      public_render_url: '/api/v1/subscriptions/public/lumen_sub_user_detail/render',
      public_render_urls: { happ: '/api/v1/subscriptions/public/lumen_sub_user_detail/render?target=happ' },
      render_formats: ['happ'],
      revoked_at: null,
      status: 'active',
      updated_at: '2026-05-27T00:00:00Z',
      user_id: owner.id,
    }
    const detail = {
      accessible_nodes: [],
      devices: [],
      request_history: [],
      subscriptions: [subscription],
      user: owner,
    }
    const cloneSubscription = vi.fn(async (subscriptionId: string) => ({
      ...subscription,
      id: `${subscriptionId}-clone`,
      public_id: 'lumen_sub_user_detail_clone',
    }))
    const revokeSubscription = vi.fn(async (subscriptionId: string) => {
      detail.subscriptions = detail.subscriptions.map((item) =>
        item.id === subscriptionId ? { ...item, revoked_at: '2026-05-28T00:00:00Z', status: 'revoked' } : item,
      )
      return detail.subscriptions[0]
    })
    const deleteSubscription = vi.fn(async (subscriptionId: string) => {
      detail.subscriptions = detail.subscriptions.filter((item) => item.id !== subscriptionId)
    })
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      cloneSubscription,
      deleteSubscription,
      getUserDetail: async () => detail,
      revokeSubscription,
    }

    renderWithRouter('/users/usr_subscription_detail', { apiClient, initialSession: developmentSession })

    expect(await screen.findByRole('table', { name: /(issued subscriptions|выданные подписки)/i })).toBeInTheDocument()
    expect(screen.getByText('HApp live')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /copy happ raw subscription lumen_sub_user_detail/i }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/sub/lumen_sub_user_detail/happ?raw=1'))

    await user.click(screen.getByRole('button', { name: /clone subscription lumen_sub_user_detail/i }))
    await waitFor(() => expect(cloneSubscription).toHaveBeenCalledWith('sub-user-detail'))

    await user.click(screen.getByRole('button', { name: /revoke subscription lumen_sub_user_detail/i }))
    expect(revokeSubscription).not.toHaveBeenCalled()
    await user.click(within(screen.getByRole('alertdialog', { name: /revoke subscription lumen_sub_user_detail/i })).getByRole('button', { name: /^revoke$/i }))
    await waitFor(() => expect(revokeSubscription).toHaveBeenCalledWith('sub-user-detail'))

    await user.click(screen.getByRole('button', { name: /delete subscription lumen_sub_user_detail/i }))
    expect(deleteSubscription).not.toHaveBeenCalled()
    await user.click(within(screen.getByRole('alertdialog', { name: /delete subscription lumen_sub_user_detail/i })).getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(deleteSubscription).toHaveBeenCalledWith('sub-user-detail'))
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
    const inspectHwid = vi.fn(async (_query?: string) => ({
      items: [
        {
          device_count: 1,
          device_limit: 2,
          device_records: [
            {
              hwid: 'HWID-1',
              id: 'phone',
              label: 'Phone',
              last_seen_at: '2026-05-28T10:00:00Z',
              platform: 'android',
              status: 'active',
              subscription_id: 'sub-live',
            },
          ],
          devices: ['Phone'],
          email: 'device-owner@lumen.local',
          status: 'ok',
          subscription_ids: ['sub-live'],
          user_id: 'usr_hwid_tools',
          username: 'device-owner',
        },
      ],
    }))
    const inspectTopUsers = vi.fn(async (_metric = 'traffic_used') => ({
      items: [
        {
          device_count: 2,
          device_limit: 1,
          email: 'device-owner@lumen.local',
          expires_at: '2026-06-05T00:00:00Z',
          rank: 1,
          risk: 'device_over_limit',
          status: 'active',
          traffic_limit_gb: 100,
          traffic_percent: 95,
          traffic_used_gb: 95,
          user_id: 'usr_hwid_tools',
          username: 'device-owner',
        },
      ],
      metric: _metric,
    }))
    const inspectUserIps = vi.fn(async (_query?: string) => ({
      items: [
        {
          email: 'device-owner@lumen.local',
          evidence_count: 2,
          first_seen_at: '2026-05-28T10:00:00Z',
          ip: '203.0.113.44',
          last_decision: null,
          last_seen_at: '2026-05-28T10:30:00Z',
          last_target: 'happ',
          node_ids: ['node-live'],
          sources: ['subscription'],
          subscription_ids: ['sub-live'],
          user_id: 'usr_hwid_tools',
          username: 'device-owner',
        },
      ],
    }))
    const inspectNodeUserIps = vi.fn(async (_query?: string) => ({
      items: [
        {
          email: 'device-owner@lumen.local',
          evidence_count: 2,
          first_seen_at: '2026-05-28T10:00:00Z',
          ip: '203.0.113.44',
          last_seen_at: '2026-05-28T10:30:00Z',
          last_target: 'happ',
          node_id: 'node-live',
          node_name: 'node-01',
          subscription_ids: ['sub-live'],
          user_id: 'usr_hwid_tools',
          username: 'device-owner',
        },
      ],
    }))
    const dropConnections: LumenApiClient['dropConnections'] = vi.fn(async (request) => ({
      command: {
        claimed_at: null,
        command_type: 'node.connections.drop',
        completed_at: null,
        created_at: '2026-05-28T10:31:00Z',
        error_code: null,
        error_message: null,
        id: 'cmd-drop-1',
        node_id: request.node_id,
        payload_json: request,
        result_json: null,
        status: 'queued',
        updated_at: '2026-05-28T10:31:00Z',
      },
    }))
    const buildHappRouting: LumenApiClient['buildHappRouting'] = vi.fn(async (request) => ({
      crypto_link: request.subscription_url ? 'happ://crypt4/encrypted' : null,
      crypto_method: request.subscription_url ? request.crypto_method ?? 'v4' : null,
      encoded_profile: 'eyJOYW1lIjoiTHVtZW4gSEFwcCBSb3V0aW5nIn0=',
      encrypted_url_bytes: request.subscription_url ? request.subscription_url.length : null,
      encoding: 'base64-json',
      mode: request.mode ?? 'add',
      profile_bytes: 32,
      profile_name: 'Lumen HApp Routing',
      routing_header: 'happ://routing/onadd/eyJOYW1lIjoiTHVtZW4gSEFwcCBSb3V0aW5nIn0=',
      routing_link: 'happ://routing/onadd/eyJOYW1lIjoiTHVtZW4gSEFwcCBSb3V0aW5nIn0=',
    }))
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      buildHappRouting,
      clearUserDevices,
      deleteUserDevice,
      dropConnections,
      inspectHwid,
      inspectNodeUserIps,
      inspectTopUsers,
      inspectUserIps,
    }

    renderWithRouter('/tools', { apiClient, initialSession: developmentSession })

    expect(await screen.findByRole('table', { name: /operational tools/i })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/lookup hwid/i), { target: { value: 'HWID-1' } })
    await waitFor(() => expect(inspectHwid).toHaveBeenCalledWith('HWID-1'))
    await user.click(
      await screen.findByRole('button', {
        name: /delete device phone for device-owner@lumen.local/i,
      }),
    )
    await waitFor(() =>
      expect(deleteUserDevice).toHaveBeenCalledWith('usr_hwid_tools', 'phone'),
    )
    await user.click(screen.getByRole('button', { name: /^clear all$/i }))
    await waitFor(() => expect(clearUserDevices).toHaveBeenCalledWith('usr_hwid_tools'))
    await user.click(screen.getByRole('button', { name: /top users/i }))
    expect(await screen.findByText(/device-owner · device-owner@lumen.local/i)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/metric/i), { target: { value: 'device_count' } })
    await waitFor(() => expect(inspectTopUsers).toHaveBeenCalledWith('device_count', 50))
    await user.click(await screen.findByRole('button', { name: /user ips/i }))
    expect((await screen.findAllByText('203.0.113.44')).length).toBeGreaterThan(0)
    expect(screen.getByRole('table', { name: /node user ips/i })).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: /drop connections for 203\.0\.113\.44 on node-live/i }),
    )
    await waitFor(() =>
      expect(dropConnections).toHaveBeenCalledWith({
        ip: '203.0.113.44',
        node_id: 'node-live',
        reason: 'operator requested connection drop from tools user IPs',
        subscription_id: 'sub-live',
        user_id: 'usr_hwid_tools',
      }),
    )
    expect(await screen.findByText('cmd-drop-1')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/lookup ip/i), { target: { value: 'node-01' } })
    await waitFor(() => expect(inspectUserIps).toHaveBeenCalledWith('node-01', 200))
    await waitFor(() => expect(inspectNodeUserIps).toHaveBeenCalledWith('node-01', 200))
    await user.click(screen.getByRole('button', { name: /^HApp routing$/i }))
    fireEvent.change(screen.getByLabelText(/subscription url for happ crypto/i), {
      target: { value: 'https://sub.example.test/sub/live/happ' },
    })
    await user.click(screen.getByRole('button', { name: /build happ payload/i }))
    await waitFor(() =>
      expect(buildHappRouting).toHaveBeenCalledWith(
        expect.objectContaining({
          crypto_method: 'v4',
          mode: 'onadd',
          subscription_url: 'https://sub.example.test/sub/live/happ',
        }),
      ),
    )
    expect(await screen.findByText('happ://crypt4/encrypted')).toBeInTheDocument()
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
    const truncateTorrentReports = vi.fn(async () => ({
      actions: [],
      items: [],
      limit: 200,
      query: null,
      total: 0,
    }))
    const inspectTorrentReports = vi.fn(async (_query?: string, limit = 200) => ({
      actions: ['torrent.blocked'],
      items: [
        {
          action: 'torrent.blocked',
          actor_email: 'operator@lumen.local',
          actor_subject: 'usr_operator',
          created_at: '2026-05-28T00:00:00.000Z',
          id: 'torrent-event-1',
          metadata_json: { host: 'example.test' },
          resource_id: 'btih:test',
          resource_type: 'torrent',
        },
      ],
      limit,
      query: _query ?? null,
      total: 1,
    }))
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      inspectTorrentReports,
      truncateTorrentReports,
    }

    renderWithRouter('/tools', { apiClient, initialSession: developmentSession })

    await user.click(await screen.findByRole('button', { name: /torrent blocker reports/i }))
    fireEvent.change(screen.getByLabelText(/lookup torrent report/i), {
      target: { value: 'example.test' },
    })
    await waitFor(() => expect(inspectTorrentReports).toHaveBeenCalledWith('example.test', 200))
    expect(await screen.findByText('torrent / btih:test')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^truncate$/i }))
    expect(truncateTorrentReports).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /^confirm truncate$/i }))
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
    expect(screen.getByRole('button', { name: /copy public/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy private/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download private/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /clear private/i }))
    expect(screen.queryByText('private-key')).not.toBeInTheDocument()
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

  it('filters external squads and creates external squads through the typed API contract', async () => {
    const user = userEvent.setup()
    const createSquad = vi.fn(async (request: SquadCreateRequest) => ({
      id: 'squad_external_new',
      kind: request.kind ?? 'internal',
      metadata_json: request.metadata_json ?? {},
      name: request.name,
      status: request.status ?? 'active',
    }))
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      createSquad,
      listSquads: async () => ({
        items: [
          {
            id: 'squad_internal',
            kind: 'internal',
            metadata_json: {},
            name: 'Internal squad',
            status: 'active',
          },
          {
            id: 'squad_external',
            kind: 'external',
            metadata_json: {},
            name: 'External squad',
            status: 'active',
          },
        ],
      }),
    }

    renderWithRouter('/squads', { apiClient, initialSession: developmentSession })

    expect(await screen.findByText('Internal squad')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /external squads/i }))
    expect(screen.getByText('External squad')).toBeInTheDocument()
    expect(screen.queryByText('Internal squad')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText(/^name$/i), 'Partner lane')
    await user.selectOptions(screen.getByLabelText(/^kind$/i), 'external')
    await user.click(screen.getByRole('button', { name: /create squad/i }))

    await waitFor(() => expect(createSquad).toHaveBeenCalledTimes(1))
    expect(createSquad.mock.calls[0][0]).toMatchObject({
      kind: 'external',
      name: 'Partner lane',
    })
  })

  it('requires inline confirmation before deleting a real squad', async () => {
    const user = userEvent.setup()
    const deleteSquad = vi.fn(async (_squadId: string) => undefined)
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      deleteSquad,
      listSquads: async () => ({
        items: [
          {
            id: 'squad_delete',
            kind: 'internal',
            metadata_json: { channel: 'qa' },
            name: 'Delete candidate',
            status: 'active',
          },
        ],
      }),
    }

    renderWithRouter('/squads', { apiClient, initialSession: developmentSession })

    expect(await screen.findByText('Delete candidate')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /delete delete candidate|удалить delete candidate/i }))
    expect(deleteSquad).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog', { name: /delete squad delete candidate|удалить сквад delete candidate/i })
    expect(dialog).toHaveTextContent(/live API|боевой API/i)
    await user.click(within(dialog).getByRole('button', { name: /^delete$|^удалить$/i }))

    await waitFor(() => expect(deleteSquad).toHaveBeenCalledWith('squad_delete'))
  })

  it('saves external squad subscription delivery overrides through the typed API contract', async () => {
    const user = userEvent.setup()
    const squad = {
      id: 'squad_external_delivery',
      kind: 'external' as const,
      metadata_json: {
        user_ids: ['usr_external'],
        subscription_overrides: {
          headers: { 'X-Partner': 'old' },
          host: { endpoint_host: 'old.example.test' },
          hwid: { limit: '1', required: true },
          remark: 'Old partner',
        },
      },
      name: 'External delivery squad',
      status: 'active',
    }
    const updateSquad = vi.fn(async (_squadId: string, request: SquadUpdateRequest) => ({
      ...squad,
      ...request,
      metadata_json: request.metadata_json ?? squad.metadata_json,
    }))
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      getSquadDetail: async () => ({
        hosts: [],
        inbound_matrix: [],
        nodes: [],
        profiles: [],
        squad,
        users: [],
      }),
      listSquads: async () => ({ items: [squad] }),
      listUsers: async () => ({ items: [] }),
      updateSquad,
    }

    renderWithRouter('/squads', { apiClient, initialSession: developmentSession })

    expect(await screen.findByDisplayValue('Old partner')).toBeInTheDocument()
    await user.clear(screen.getByLabelText(/custom remark/i))
    await user.type(screen.getByLabelText(/custom remark/i), 'Partner public profile')
    await user.clear(screen.getByLabelText(/template key/i))
    await user.type(screen.getByLabelText(/template key/i), 'partner-template')
    await user.clear(screen.getByLabelText(/header key/i))
    await user.type(screen.getByLabelText(/header key/i), 'X-Lumen-Partner')
    await user.clear(screen.getByLabelText(/header value/i))
    await user.type(screen.getByLabelText(/header value/i), 'partner-a')
    await user.clear(screen.getByLabelText(/endpoint host override/i))
    await user.type(screen.getByLabelText(/endpoint host override/i), 'front.partner.example.test')
    await user.clear(screen.getByLabelText(/sni override/i))
    await user.type(screen.getByLabelText(/sni override/i), 'sni.partner.example.test')
    await user.clear(screen.getByLabelText(/path override/i))
    await user.type(screen.getByLabelText(/path override/i), '/partner')
    await user.clear(screen.getByLabelText(/port override/i))
    await user.type(screen.getByLabelText(/port override/i), '2443')
    await user.clear(screen.getByLabelText(/hwid limit/i))
    await user.type(screen.getByLabelText(/hwid limit/i), '2')
    await user.clear(screen.getByLabelText(/subpage title/i))
    await user.type(screen.getByLabelText(/subpage title/i), 'Partner page')
    await user.click(screen.getByRole('button', { name: /save squad/i }))

    await waitFor(() => expect(updateSquad).toHaveBeenCalledTimes(1))
    expect(updateSquad.mock.calls[0][0]).toBe('squad_external_delivery')
    expect(updateSquad.mock.calls[0][1].metadata_json).toMatchObject({
      subscription_overrides: {
        headers: { 'X-Lumen-Partner': 'partner-a' },
        host: {
          endpoint_host: 'front.partner.example.test',
          path: '/partner',
          port: '2443',
          sni: 'sni.partner.example.test',
        },
        hwid: { limit: '2', required: true },
        profile_title: 'Partner public profile',
        remark: 'Partner public profile',
        subpage: { title: 'Partner page' },
        template: 'partner-template',
      },
      user_ids: ['usr_external'],
    })
  })

  it('renders squad detail nodes profiles hosts and inbounds from the detail API contract', async () => {
    const detail: SquadDetailResponse = {
      hosts: [
        {
          hostname: 'detail.example.test',
          id: 'host_detail',
          inbound_tag: 'DETAIL_INBOUND',
          name: 'Detail host',
          node_id: 'node_detail',
          port: 443,
          protocol_profile_id: 'profile_detail',
          status: 'active',
        },
      ],
      inbound_matrix: [
        {
          adapter: 'xray-core',
          config_json: { flow: 'xtls-rprx-vision' },
          credentials_ref: 'vault://detail',
          hosts: [],
          listen: '0.0.0.0',
          node_id: 'node_detail',
          node_name: 'node-eu-1',
          port: 443,
          profile_id: 'profile_detail',
          profile_name: 'detail-profile',
          protocol: 'vless',
          security: 'reality',
          status: 'active',
          tag: 'DETAIL_INBOUND',
          transport: 'tcp',
        },
      ],
      nodes: [
        {
          id: 'node_detail',
          name: 'node-eu-1',
          public_address: '203.0.113.10',
          region: 'eu',
          status: 'active',
        },
      ],
      profiles: [
        {
          adapter: 'xray-core',
          id: 'profile_detail',
          inbounds: ['DETAIL_INBOUND'],
          name: 'detail-profile',
          node_id: 'node_detail',
          status: 'active',
        },
      ],
      squad: {
        id: 'squad_detail',
        kind: 'internal',
        metadata_json: { user_ids: ['usr_detail'] },
        name: 'Detail squad',
        status: 'active',
      },
      users: [
        {
          display_name: 'Detail User',
          email: 'detail-user@lumen.local',
          id: 'usr_detail',
          status: 'active',
          tags: ['qa'],
          username: 'detail-user',
        },
      ],
    }
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      getSquadDetail: async () => detail,
      listSquads: async () => ({ items: [detail.squad] }),
      listUsers: async () => ({ items: [] }),
    }

    renderWithRouter('/squads', { apiClient, initialSession: developmentSession })

    expect(await screen.findByRole('table', { name: /squad inventory/i })).toBeInTheDocument()
    expect(await screen.findByText('detail-user')).toBeInTheDocument()
    expect(screen.getByText('node-eu-1')).toBeInTheDocument()
    expect(screen.getByText('detail-profile')).toBeInTheDocument()
    expect(screen.getByText('detail.example.test')).toBeInTheDocument()
    expect(screen.getAllByText('DETAIL_INBOUND').length).toBeGreaterThan(0)
    expect(screen.getByText(/vless\/tcp\/reality/i)).toBeInTheDocument()
  })

  it('wires squad binding matrix controls to profile and host update requests', async () => {
    const user = userEvent.setup()
    const detail: SquadDetailResponse = {
      hosts: [
        {
          hostname: 'assigned.example.test',
          id: 'host_assigned',
          inbound_tag: 'ASSIGNED_INBOUND',
          name: 'Assigned host',
          node_id: 'node_detail',
          port: 443,
          protocol_profile_id: 'profile_assigned',
          status: 'active',
        },
      ],
      inbound_matrix: [],
      nodes: [],
      profiles: [
        {
          adapter: 'xray-core',
          id: 'profile_assigned',
          inbounds: [],
          name: 'assigned-profile',
          node_id: 'node_detail',
          status: 'active',
        },
      ],
      squad: {
        id: 'squad_detail',
        kind: 'internal',
        metadata_json: {},
        name: 'Detail squad',
        status: 'active',
      },
      users: [],
    }
    const profileAssigned = {
      adapter: 'xray-core',
      config_json: {},
      credentials_ref: null,
      id: 'profile_assigned',
      metadata_json: {},
      name: 'assigned-profile',
      node_id: 'node_detail',
      port_reservations: [],
      squad_id: 'squad_detail',
      status: 'active',
    }
    const profileAvailable = {
      ...profileAssigned,
      id: 'profile_available',
      name: 'available-profile',
      squad_id: null,
    }
    const hostAssigned = {
      address: null,
      excluded_internal_squad_ids: [],
      final_mask: null,
      hidden: false,
      hostname: 'assigned.example.test',
      id: 'host_assigned',
      inbound_tag: 'ASSIGNED_INBOUND',
      metadata_json: {},
      mihomo_x25519_public_key: null,
      mux_json: {},
      name: 'Assigned host',
      node_id: 'node_detail',
      path: null,
      port: 443,
      protocol_profile_id: 'profile_assigned',
      remark: null,
      security: null,
      shuffle_host: false,
      sni: null,
      sockopt_json: {},
      squad_id: 'squad_detail',
      status: 'active',
      subscription_excluded: false,
      tags: [],
      xhttp_json: {},
      xray_template_json: {},
    }
    const hostAvailable = {
      ...hostAssigned,
      hostname: 'available.example.test',
      id: 'host_available',
      name: 'Available host',
      squad_id: null,
    }
    const updateProfile = vi.fn(async (_profileId: string, request) => ({
      ...profileAvailable,
      squad_id: request.squad_id ?? null,
    }))
    const updateHost = vi.fn(async (_hostId: string, request) => ({
      ...hostAvailable,
      squad_id: request.squad_id ?? null,
    }))
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      getSquadDetail: async () => detail,
      listHosts: async () => ({ items: [hostAssigned, hostAvailable] }),
      listProfiles: async () => ({ items: [profileAssigned, profileAvailable] }),
      listSquads: async () => ({ items: [detail.squad] }),
      listUsers: async () => ({ items: [] }),
      updateHost,
      updateProfile,
    }

    renderWithRouter('/squads', { apiClient, initialSession: developmentSession })

    expect(await screen.findByText('available-profile | xray-core')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText(/attach profile/i), 'profile_available')
    await user.click(screen.getByRole('button', { name: /^attach profile$/i }))
    await user.selectOptions(screen.getByLabelText(/attach host/i), 'host_available')
    await user.click(screen.getByRole('button', { name: /^attach host$/i }))
    await user.click(screen.getByRole('button', { name: /detach profile assigned-profile/i }))
    await user.click(screen.getByRole('button', { name: /detach host assigned.example.test/i }))

    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith('profile_available', { squad_id: 'squad_detail' }),
    )
    await waitFor(() =>
      expect(updateHost).toHaveBeenCalledWith('host_available', { squad_id: 'squad_detail' }),
    )
    expect(updateProfile).toHaveBeenCalledWith('profile_assigned', { squad_id: null })
    expect(updateHost).toHaveBeenCalledWith('host_assigned', { squad_id: null })
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

  it('updates typed settings groups through the typed API', async () => {
    const user = userEvent.setup()
    const updateSettingGroup = vi.fn(async (groupKey: string, request: SettingGroupUpdateRequest) => ({
      description: 'Client-facing subscription presentation and update behavior.',
      key: groupKey,
      title: 'Subscription delivery',
      updated_at: '2026-05-27T00:00:00Z',
      updated_by: 'usr_admin',
      value_json: request.value_json,
    }))
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      updateSettingGroup,
    }

    renderWithRouter('/settings', { apiClient, initialSession: developmentSession })

    expect(await screen.findByRole('heading', { name: /settings groups/i })).toBeInTheDocument()
    const updateIntervalHours = await screen.findByLabelText(/update interval hours/i)
    await user.clear(updateIntervalHours)
    await user.type(updateIntervalHours, '6')
    await user.click(screen.getAllByRole('button', { name: /save group/i })[1])

    await waitFor(() => expect(updateSettingGroup).toHaveBeenCalledTimes(1))
    expect(updateSettingGroup).toHaveBeenCalledWith('subscription.delivery', {
      value_json: expect.objectContaining({
        random_host_order: false,
        title: 'Lumen VPN',
        update_interval_hours: 6,
      }),
    })
  })

  it('saves subscription page delivery through the typed settings API', async () => {
    const user = userEvent.setup()
    const updateSettingGroup = vi.fn(async (groupKey: string, request: SettingGroupUpdateRequest) => ({
      description: 'Client-facing subscription presentation and update behavior.',
      key: groupKey,
      title: 'Subscription delivery',
      updated_at: '2026-05-27T00:00:00Z',
      updated_by: 'usr_admin',
      value_json: request.value_json,
    }))
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      updateSettingGroup,
    }

    renderWithRouter('/subscription-page', { apiClient, initialSession: developmentSession })

    expect((await screen.findAllByRole('heading', { name: /subscription page/i })).length).toBeGreaterThan(0)
    const updateInterval = screen.getByLabelText(/update interval, hours/i)
    await waitFor(() => expect(updateInterval).toHaveValue(2))
    fireEvent.change(updateInterval, {
      target: { value: '8' },
    })
    await user.click(screen.getByText(/^renderer json$/i))
    fireEvent.change(screen.getByLabelText(/response headers json/i), {
      target: { value: '{"X-Lumen-Test":"typed"}' },
    })
    fireEvent.change(screen.getByLabelText(/base json/i), {
      target: { value: '{"dns":{"strategy":"prefer_ipv4"}}' },
    })
    fireEvent.change(screen.getByLabelText(/routing json/i), {
      target: { value: '{"rules":[{"domain_suffix":"example.test"}]}' },
    })
    fireEvent.change(screen.getByLabelText(/custom remarks json/i), {
      target: { value: '{"happ":"Lumen HApp"}' },
    })
    fireEvent.change(screen.getByLabelText(/subpage json/i), {
      target: { value: '{"title":"Public profile"}' },
    })
    await user.click(screen.getByLabelText(/random host order/i))
    await user.click(screen.getByRole('button', { name: /save subscription delivery/i }))

    await waitFor(() => expect(updateSettingGroup).toHaveBeenCalledTimes(1))
    expect(updateSettingGroup).toHaveBeenCalledWith('subscription.delivery', {
      value_json: expect.objectContaining({
        base_json: { dns: { strategy: 'prefer_ipv4' } },
        custom_remarks: { happ: 'Lumen HApp' },
        random_host_order: true,
        response_headers: { 'X-Lumen-Test': 'typed' },
        routing: { rules: [{ domain_suffix: 'example.test' }] },
        subpage: { title: 'Public profile' },
        title: 'Lumen VPN',
        update_interval_hours: 8,
      }),
    })
  })

  it('manages subscription page configs and binds them to real subscriptions', async () => {
    const user = userEvent.setup()
    const configs: SubscriptionPageConfigRecord[] = [
      {
        config_json: { title: 'Default page', theme: 'lumen' },
        id: 'subpage_default',
        name: 'Default page',
        order: 0,
        status: 'active',
      },
      {
        config_json: { title: 'Partner page' },
        id: 'subpage_partner',
        name: 'Partner page',
        order: 1,
        status: 'active',
      },
    ]
    const subscriptions: SubscriptionRecord[] = [
      {
        config_hash: 'sha256:test',
        created_at: '2026-05-27T00:00:00Z',
        delivery_profile: { format: 'happ', subpage_config_id: 'subpage_default' },
        expires_at: null,
        id: 'sub_live',
        license_id: 'lic_live',
        node_id: 'node_live',
        public_id: 'lumen_sub_live',
        public_manifest_url: '/api/v1/subscriptions/public/lumen_sub_live/manifest',
        public_page_url: '/sub/lumen_sub_live',
        public_render_url: '/api/v1/subscriptions/public/lumen_sub_live/render',
        public_render_urls: { happ: '/api/v1/subscriptions/public/lumen_sub_live/render?target=happ' },
        render_formats: ['happ'],
        revoked_at: null,
        status: 'active',
        updated_at: '2026-05-27T00:00:00Z',
        user_id: 'user_live',
      },
    ]
    const listSubscriptionPageConfigs = vi.fn(async () => ({ items: configs }))
    const createSubscriptionPageConfig = vi.fn(
      async (request: SubscriptionPageConfigCreateRequest): Promise<SubscriptionPageConfigRecord> => ({
        config_json: request.config_json ?? {},
        id: 'subpage_created',
        name: request.name,
        order: configs.length,
        status: request.status ?? 'active',
      }),
    )
    const updateSubscriptionPageConfig = vi.fn(
      async (
        configId: string,
        request: SubscriptionPageConfigUpdateRequest,
      ): Promise<SubscriptionPageConfigRecord> => {
        const current = configs.find((config) => config.id === configId)!
        return {
          ...current,
          ...request,
          order: request.order ?? current.order,
        }
      },
    )
    const cloneSubscriptionPageConfig = vi.fn(
      async (configId: string, request: { name?: string | null }): Promise<SubscriptionPageConfigRecord> => {
        const current = configs.find((config) => config.id === configId)!
        return {
          ...current,
          id: 'subpage_clone',
          name: request.name ?? `${current.name} copy`,
          order: configs.length,
        }
      },
    )
    const deleteSubscriptionPageConfig = vi.fn(async () => undefined)
    const reorderSubscriptionPageConfigs = vi.fn(async (ids: string[]) => ({ updated: ids.length }))
    const updateSubscription = vi.fn(
      async (subscriptionId: string, request: { delivery_profile?: Record<string, string> }) => {
        const current = subscriptions.find((subscription) => subscription.id === subscriptionId)!
        return {
          ...current,
          ...request,
        }
      },
    )
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      cloneSubscriptionPageConfig,
      createSubscriptionPageConfig,
      deleteSubscriptionPageConfig,
      listSubscriptionPageConfigs,
      listSubscriptions: async () => ({ items: subscriptions }),
      reorderSubscriptionPageConfigs,
      updateSubscription,
      updateSubscriptionPageConfig,
    }

    renderWithRouter('/subscription-page', { apiClient, initialSession: developmentSession })

    expect(await screen.findByRole('table', { name: /subscription page configs/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/update interval, hours/i)).toHaveAttribute('name', 'subscription-update-interval')
    await user.click(screen.getByText(/^config json$/i, { selector: 'summary' }))
    expect(screen.getByLabelText(/^config json$/i, { selector: '#subpage-config-json' })).toHaveAttribute('name', 'subpage-config-json')
    await user.type(screen.getByLabelText(/^config name$/i, { selector: '#subpage-config-name' }), 'Mobile profile page')
    fireEvent.change(screen.getByLabelText(/^config json$/i, { selector: '#subpage-config-json' }), {
      target: { value: '{"title":"Mobile profile","theme":"mobile"}' },
    })
    await user.click(screen.getByRole('button', { name: /create page config/i }))
    await waitFor(() => expect(createSubscriptionPageConfig).toHaveBeenCalledWith({
      config_json: { theme: 'mobile', title: 'Mobile profile' },
      name: 'Mobile profile page',
      status: 'active',
    }))

    await user.click(screen.getAllByRole('button', { name: /^edit$/i })[0])
    await user.clear(screen.getByLabelText(/selected config name/i))
    await user.type(screen.getByLabelText(/selected config name/i), 'Default page edited')
    await user.click(screen.getByText(/^selected config json$/i, { selector: 'summary' }))
    fireEvent.change(screen.getByLabelText(/selected config json/i), {
      target: { value: '{"title":"Edited page","theme":"edited"}' },
    })
    await user.click(screen.getByRole('button', { name: /save selected page config/i }))
    await waitFor(() => expect(updateSubscriptionPageConfig).toHaveBeenCalledWith('subpage_default', {
      config_json: { theme: 'edited', title: 'Edited page' },
      name: 'Default page edited',
      status: 'active',
    }))

    await user.click(screen.getAllByRole('button', { name: /^clone$/i })[0])
    await waitFor(() => expect(cloneSubscriptionPageConfig).toHaveBeenCalledWith('subpage_default', {
      name: 'Default page copy',
    }))
    await user.click(screen.getAllByRole('button', { name: /^down$/i })[0])
    await waitFor(() => expect(reorderSubscriptionPageConfigs).toHaveBeenCalledWith([
      'subpage_partner',
      'subpage_default',
    ]))
    await user.click(screen.getByRole('button', { name: /bind page config/i }))
    await waitFor(() => expect(updateSubscription).toHaveBeenCalledWith('sub_live', {
      delivery_profile: { format: 'happ', subpage_config_id: 'subpage_default' },
    }))
    await user.click(screen.getByRole('button', { name: /clear binding/i }))
    await waitFor(() => expect(updateSubscription).toHaveBeenCalledWith('sub_live', {
      delivery_profile: { format: 'happ' },
    }))
    await user.click(screen.getAllByRole('button', { name: /^delete$/i })[0])
    expect(deleteSubscriptionPageConfig).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog', { name: /delete subscription page config default page/i })
    expect(dialog).toHaveTextContent(/live API/i)
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(deleteSubscriptionPageConfig).toHaveBeenCalledWith('subpage_default'))
  })

  it('edits, clones, and reorders subscription templates through real template APIs', async () => {
    const user = userEvent.setup()
    const templates: SubscriptionTemplateRecord[] = [
      {
        content_json: { prepend: '# base\n', headers: { 'X-Lumen-Template': 'base' } },
        format: 'mihomo',
        id: 'tpl_base',
        name: 'Base Mihomo',
        order: 0,
        status: 'active',
      },
      {
        content_json: { merge: { routing: { domainStrategy: 'AsIs' } } },
        format: 'xray_json',
        id: 'tpl_xray',
        name: 'Xray JSON',
        order: 1,
        status: 'active',
      },
    ]
    const listSubscriptionTemplates = vi.fn(async () => ({ items: templates }))
    const updateSubscriptionTemplate = vi.fn(
      async (
        templateId: string,
        request: SubscriptionTemplateUpdateRequest,
      ): Promise<SubscriptionTemplateRecord> => {
        const current = templates.find((template) => template.id === templateId)!
        return {
          ...current,
          ...request,
          order: request.order ?? current.order,
        }
      },
    )
    const createSubscriptionTemplate = vi.fn(
      async (request: SubscriptionTemplateCreateRequest): Promise<SubscriptionTemplateRecord> => ({
        content_json: request.content_json ?? {},
        format: request.format,
        id: 'tpl_clone',
        name: request.name,
        order: templates.length,
        status: request.status ?? 'active',
      }),
    )
    const reorderSubscriptionTemplates = vi.fn(async (ids: string[]) => ({
      updated: ids.length,
    }))
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      createSubscriptionTemplate,
      listSubscriptionTemplates,
      reorderSubscriptionTemplates,
      updateSubscriptionTemplate,
    }

    renderWithRouter('/templates', { apiClient, initialSession: developmentSession })

    expect(await screen.findByRole('table', { name: /subscription templates/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /edit base mihomo/i }))
    await user.clear(screen.getByLabelText(/^name$/i, { selector: '#edit-template-name' }))
    await user.type(screen.getByLabelText(/^name$/i, { selector: '#edit-template-name' }), 'Base Mihomo Live')
    fireEvent.change(screen.getByLabelText(/content json/i, { selector: '#edit-template-content' }), {
      target: {
        value: '{"prepend":"# edited\\\\n","headers":{"X-Lumen-Template":"edited"}}',
      },
    })
    await user.click(screen.getByRole('button', { name: /save selected template/i }))

    await waitFor(() => expect(updateSubscriptionTemplate).toHaveBeenCalledTimes(1))
    expect(updateSubscriptionTemplate).toHaveBeenCalledWith('tpl_base', {
      content_json: {
        headers: { 'X-Lumen-Template': 'edited' },
        prepend: '# edited\\n',
      },
      format: 'mihomo',
      name: 'Base Mihomo Live',
      status: 'active',
    })

    await user.click(screen.getByRole('button', { name: /clone xray json/i }))
    await waitFor(() => expect(createSubscriptionTemplate).toHaveBeenCalledTimes(1))
    expect(createSubscriptionTemplate).toHaveBeenCalledWith({
      content_json: { merge: { routing: { domainStrategy: 'AsIs' } } },
      format: 'xray_json',
      name: 'Xray JSON copy',
      status: 'active',
    })

    await user.click(screen.getByRole('button', { name: /move xray json up/i }))
    await waitFor(() => expect(reorderSubscriptionTemplates).toHaveBeenCalledWith([
      'tpl_xray',
      'tpl_base',
    ]))
  })

  it('edits, clones, reorders, and tests response rules through real rule APIs', async () => {
    const user = userEvent.setup()
    const rules: ResponseRuleRecord[] = [
      {
        body: 'Expired',
        enabled: true,
        headers: { 'X-Lumen-Reason': 'expired' },
        id: 'rule_expired',
        name: 'Expired rule',
        order: 0,
        status_code: 403,
        trigger_status: 'expired',
      },
      {
        body: 'Disabled',
        enabled: true,
        headers: { 'X-Lumen-Reason': 'disabled' },
        id: 'rule_disabled',
        name: 'Disabled rule',
        order: 1,
        status_code: 451,
        trigger_status: 'disabled',
      },
    ]
    const listResponseRules = vi.fn(async () => ({ items: rules }))
    const updateResponseRule = vi.fn(
      async (
        ruleId: string,
        request: ResponseRuleUpdateRequest,
      ): Promise<ResponseRuleRecord> => {
        const current = rules.find((rule) => rule.id === ruleId)!
        return {
          ...current,
          ...request,
          order: request.order ?? current.order,
        }
      },
    )
    const createResponseRule = vi.fn(
      async (request: ResponseRuleCreateRequest): Promise<ResponseRuleRecord> => ({
        body: request.body ?? '',
        enabled: request.enabled ?? true,
        headers: request.headers ?? {},
        id: 'rule_clone',
        name: request.name,
        order: rules.length,
        status_code: request.status_code ?? 200,
        trigger_status: request.trigger_status,
      }),
    )
    const reorderResponseRules = vi.fn(async (ids: string[]) => ({ updated: ids.length }))
    const testResponseRule = vi.fn(async (request: { subscription_status: string }) => {
      const rule = rules.find(
        (item) => item.enabled && item.trigger_status === request.subscription_status,
      )
      return {
        body: rule?.body ?? '',
        headers: rule?.headers ?? {},
        matched: Boolean(rule),
        rule: rule ?? null,
        status_code: rule?.status_code ?? 200,
      }
    })
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      createResponseRule,
      listResponseRules,
      reorderResponseRules,
      testResponseRule,
      updateResponseRule,
    }

    renderWithRouter('/response-rules', { apiClient, initialSession: developmentSession })

    expect(await screen.findByRole('table', { name: /response rules/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /edit expired rule/i }))
    await user.clear(screen.getByLabelText(/^name$/i, { selector: '#edit-rule-name' }))
    await user.type(screen.getByLabelText(/^name$/i, { selector: '#edit-rule-name' }), 'Expired rule live')
    await user.clear(screen.getByLabelText(/http status/i, { selector: '#edit-rule-status-code' }))
    await user.type(screen.getByLabelText(/http status/i, { selector: '#edit-rule-status-code' }), '410')
    fireEvent.change(screen.getByLabelText(/headers json/i, { selector: '#edit-rule-headers' }), {
      target: { value: '{"X-Lumen-Reason":"edited"}' },
    })
    await user.click(screen.getByRole('button', { name: /save selected rule/i }))

    await waitFor(() => expect(updateResponseRule).toHaveBeenCalledTimes(1))
    expect(updateResponseRule).toHaveBeenCalledWith('rule_expired', {
      body: 'Expired',
      enabled: true,
      headers: { 'X-Lumen-Reason': 'edited' },
      name: 'Expired rule live',
      status_code: 410,
      trigger_status: 'expired',
    })

    await user.click(screen.getByRole('button', { name: /clone disabled rule/i }))
    await waitFor(() => expect(createResponseRule).toHaveBeenCalledTimes(1))
    expect(createResponseRule).toHaveBeenCalledWith({
      body: 'Disabled',
      enabled: true,
      headers: { 'X-Lumen-Reason': 'disabled' },
      name: 'Disabled rule copy',
      status_code: 451,
      trigger_status: 'disabled',
    })

    await user.click(screen.getByRole('button', { name: /move disabled rule up/i }))
    await waitFor(() => expect(reorderResponseRules).toHaveBeenCalledWith([
      'rule_disabled',
      'rule_expired',
    ]))

    fireEvent.change(screen.getByLabelText(/subscription status/i), {
      target: { value: 'disabled' },
    })
    await user.click(screen.getByRole('button', { name: /test rule/i }))
    await waitFor(() => expect(testResponseRule).toHaveBeenCalledWith({
      subscription_status: 'disabled',
    }))
    expect(await screen.findByText(/matched rule/i)).toBeInTheDocument()
    expect(screen.getByText('Response status: 451')).toBeInTheDocument()
  })

  it('manages MFA methods and passkeys through auth security APIs', async () => {
    const user = userEvent.setup()
    const mfaMethods = [
      {
        confirmed_at: '2026-05-27T00:00:00Z',
        id: 'mfa_existing',
        kind: 'totp',
        label: 'Existing authenticator',
        last_used_at: null,
        status: 'active',
      },
    ]
    const passkeys = [
      {
        aaguid: null,
        created_at: '2026-05-27T00:00:00Z',
        id: 'passkey_existing',
        label: 'Laptop passkey',
        last_used_at: null,
        sign_count: 0,
        transports: ['internal'],
      },
    ]
    const listMfaMethods = vi.fn(async () => ({ items: mfaMethods }))
    const setupTotp = vi.fn(async (label: string) => ({
      method_id: 'mfa_pending',
      otpauth_url: `otpauth://totp/Lumen:${label}?secret=TESTSECRET&issuer=Lumen`,
      secret: 'TESTSECRET',
      status: 'pending' as const,
    }))
    const verifyTotpSetup = vi.fn(async (methodId: string, code: string) => ({
      items: [
        ...mfaMethods,
        {
          confirmed_at: '2026-05-27T01:00:00Z',
          id: methodId,
          kind: 'totp',
          label: `verified-${code}`,
          last_used_at: null,
          status: 'active',
        },
      ],
    }))
    const deleteMfaMethod = vi.fn(async (_methodId: string) => undefined)
    const listWebAuthnCredentials = vi.fn(async () => ({ items: passkeys }))
    const deleteWebAuthnCredential = vi.fn(async (_credentialId: string) => undefined)
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      deleteMfaMethod,
      deleteWebAuthnCredential,
      listMfaMethods,
      listWebAuthnCredentials,
      setupTotp,
      verifyTotpSetup,
    }

    renderWithRouter('/settings', { apiClient, initialSession: developmentSession })

    expect(await screen.findByRole('heading', { name: /MFA and passkeys/i })).toBeInTheDocument()
    expect(listMfaMethods).not.toHaveBeenCalled()
    expect(listWebAuthnCredentials).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /open security methods/i }))
    expect(await screen.findByText('Existing authenticator')).toBeInTheDocument()
    expect(await screen.findByText('Laptop passkey')).toBeInTheDocument()

    await user.clear(screen.getByLabelText(/MFA label/i))
    await user.type(screen.getByLabelText(/MFA label/i), 'Owner phone')
    await user.click(screen.getByRole('button', { name: /start setup/i }))
    await waitFor(() => expect(setupTotp).toHaveBeenCalledWith('Owner phone'))
    expect((await screen.findAllByText(/TESTSECRET/)).length).toBeGreaterThanOrEqual(2)

    await user.type(screen.getByLabelText(/authenticator code/i), '123456')
    await user.click(screen.getByRole('button', { name: /confirm code/i }))
    await waitFor(() => expect(verifyTotpSetup).toHaveBeenCalledWith('mfa_pending', '123456'))

    await user.click(screen.getAllByRole('button', { name: /^delete$/i })[0])
    expect(deleteMfaMethod).not.toHaveBeenCalled()
    const mfaDialog = await screen.findByRole('alertdialog', { name: /delete security method existing authenticator/i })
    expect(mfaDialog).toHaveTextContent(/real MFA or passkey/i)
    await user.click(within(mfaDialog).getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(deleteMfaMethod).toHaveBeenCalledWith('mfa_existing'))

    await user.click(screen.getAllByRole('button', { name: /^delete$/i })[1])
    const passkeyDialog = await screen.findByRole('alertdialog', { name: /delete security method laptop passkey/i })
    await user.click(within(passkeyDialog).getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(deleteWebAuthnCredential).toHaveBeenCalledWith('passkey_existing'))
  })

  it('does not offer enable actions for catalog-only auth providers', async () => {
    const updateAuthProvider = vi.fn()
    const apiClient: LumenApiClient = {
      ...createDevelopmentLumenApiClient(),
      updateAuthProvider,
    }

    renderWithRouter('/settings', { apiClient, initialSession: developmentSession })

    expect(await screen.findByRole('heading', { name: /provider toggles/i })).toBeInTheDocument()
    expect(screen.getAllByText(/passkey/i).length).toBeGreaterThan(0)
    const unavailableButtons = await screen.findAllByRole('button', { name: /unavailable/i })
    expect(unavailableButtons.length).toBeGreaterThan(0)
    expect(unavailableButtons[0]).toBeDisabled()
    expect(updateAuthProvider).not.toHaveBeenCalled()
  })
})
