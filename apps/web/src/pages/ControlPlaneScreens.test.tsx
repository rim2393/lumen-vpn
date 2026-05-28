import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createDevelopmentLumenApiClient } from '../shared/api/developmentClient'
import type { LumenApiClient, SettingUpdateRequest, SquadCreateRequest, UserRecord } from '../shared/api/types'
import { developmentSession } from '../shared/data/lumenData'
import { renderWithRouter } from '../test/renderWithRouter'

describe('Control plane resource screens', () => {
  it('renders API-backed hosts, profiles, squads, subscriptions, and settings screens', async () => {
    const apiClient = createDevelopmentLumenApiClient()

    const hosts = renderWithRouter('/hosts', { apiClient, initialSession: developmentSession })
    expect(await screen.findByRole('table', { name: /host inventory/i })).toBeInTheDocument()
    expect(screen.getByText('auto.lumen.local')).toBeInTheDocument()
    hosts.unmount()

    const profiles = renderWithRouter('/profiles', { apiClient, initialSession: developmentSession })
    expect(await screen.findByRole('table', { name: /protocol profile inventory/i })).toBeInTheDocument()
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
    expect(screen.getByText(/backend does not expose device registry/i)).toBeInTheDocument()
    expect(screen.getByText(/backend does not expose subscription request history/i)).toBeInTheDocument()
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
})
