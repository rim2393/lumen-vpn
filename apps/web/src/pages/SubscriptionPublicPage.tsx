import { useEffect, useState, type FormEvent } from 'react'
import {
  useCloneSubscriptionPageConfig,
  useCreateSubscriptionPageConfig,
  useDeleteSubscriptionPageConfig,
  useSettingGroupsData,
  useReorderSubscriptionPageConfigs,
  useSubscriptionPageConfigsData,
  useSubscriptionsPageData,
  useUpdateSettingGroup,
  useUpdateSubscription,
  useUpdateSubscriptionPageConfig,
} from '../shared/api/resourceHooks'
import type { SubscriptionPageConfigRecord, SubscriptionRecord } from '../shared/api/types'
import { DataTable } from '../shared/components/DataTable'
import { EmptyState, ErrorState, LoadingState } from '../shared/components/DataState'
import { MetricCard } from '../shared/components/MetricCard'
import { PageHeader } from '../shared/components/PageHeader'
import {
  FormError,
  ScreenForm,
  SubmitButton,
} from '../shared/components/ResourceScreen'
import { StatusBadge } from '../shared/components/StatusBadge'
import { sectionSpecs } from '../shared/data/resourceMeta'
import { formatDateTime, formatRecord } from '../shared/utils/resourceFormat'

const GROUP_KEY = 'subscription.delivery'

const pageSpec = {
  ...sectionSpecs.subscription,
  description:
    'Configure the real typed delivery contract used by public manifests, renderer headers and client subscription pages.',
  eyebrow: 'Subscription delivery',
  primaryAction: 'Save delivery settings',
  status: 'active',
  title: 'Subscription Page',
}

type SubscriptionDeliveryForm = {
  baseJson: string
  customRemarks: string
  happAnnounce: string
  profilePageUrl: string
  randomHostOrder: boolean
  responseHeaders: string
  routing: string
  subpage: string
  supportUrl: string
  title: string
  updateIntervalHours: string
}

const defaultForm: SubscriptionDeliveryForm = {
  baseJson: '{}',
  customRemarks: '{}',
  happAnnounce: '',
  profilePageUrl: '',
  randomHostOrder: false,
  responseHeaders: '{}',
  routing: '{}',
  subpage: '{}',
  supportUrl: '',
  title: 'Lumen VPN',
  updateIntervalHours: '2',
}

export function SubscriptionPublicPage() {
  const subscriptionsQuery = useSubscriptionsPageData()
  const configsQuery = useSubscriptionPageConfigsData()
  const groupsQuery = useSettingGroupsData()
  const updateGroup = useUpdateSettingGroup()
  const createConfig = useCreateSubscriptionPageConfig()
  const updateConfig = useUpdateSubscriptionPageConfig()
  const cloneConfigMutation = useCloneSubscriptionPageConfig()
  const deleteConfigMutation = useDeleteSubscriptionPageConfig()
  const reorderConfigs = useReorderSubscriptionPageConfigs()
  const updateSubscription = useUpdateSubscription()
  const subscriptions = subscriptionsQuery.data?.items ?? []
  const configs = configsQuery.data?.items ?? []
  const groups = groupsQuery.data?.items ?? []
  const deliveryGroup = groups.find((group) => group.key === GROUP_KEY)
  const deliverySettings = deliveryGroup?.value_json
  const [form, setForm] = useState<SubscriptionDeliveryForm>(defaultForm)
  const [configName, setConfigName] = useState('')
  const [configStatus, setConfigStatus] = useState('active')
  const [configJson, setConfigJson] = useState('{"title":"Customer profile"}')
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null)
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<string | null>(null)
  const [editorName, setEditorName] = useState('')
  const [editorStatus, setEditorStatus] = useState('active')
  const [editorJson, setEditorJson] = useState('{}')
  const [formError, setFormError] = useState<string | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)

  const selectedConfig = configs.find((config) => config.id === selectedConfigId) ?? configs[0]
  const selectedSubscription =
    subscriptions.find((subscription) => subscription.id === selectedSubscriptionId) ??
    subscriptions[0]

  useEffect(() => {
    if (!deliverySettings) {
      return
    }
    setForm({
      baseJson: jsonValue(deliverySettings.base_json),
      customRemarks: jsonValue(deliverySettings.custom_remarks),
      happAnnounce: stringValue(deliverySettings.happ_announce, ''),
      profilePageUrl: stringValue(deliverySettings.profile_page_url, ''),
      randomHostOrder: deliverySettings.random_host_order === true,
      responseHeaders: jsonValue(deliverySettings.response_headers),
      routing: jsonValue(deliverySettings.routing),
      subpage: jsonValue(deliverySettings.subpage),
      supportUrl: stringValue(deliverySettings.support_url, ''),
      title: stringValue(deliverySettings.title, defaultForm.title),
      updateIntervalHours: stringValue(
        deliverySettings.update_interval_hours,
        defaultForm.updateIntervalHours,
      ),
    })
  }, [deliverySettings])

  useEffect(() => {
    if (!selectedConfig) {
      return
    }
    setSelectedConfigId(selectedConfig.id)
    setEditorName(selectedConfig.name)
    setEditorStatus(selectedConfig.status)
    setEditorJson(JSON.stringify(selectedConfig.config_json, null, 2))
  }, [selectedConfig])

  useEffect(() => {
    if (!selectedSubscription) {
      return
    }
    setSelectedSubscriptionId(selectedSubscription.id)
  }, [selectedSubscription])

  const rows = subscriptions.map((subscription) => ({
    cells: [
      subscription.public_id,
      formatRecord(subscription.delivery_profile),
      formatDateTime(subscription.expires_at),
      <StatusBadge tone={subscription.revoked_at ? 'danger' : 'good'}>
        {subscription.revoked_at ? 'revoked' : 'published'}
      </StatusBadge>,
    ],
    id: subscription.id,
  }))

  const configRows = configs.map((config) => ({
    cells: [
      config.name,
      config.status,
      formatRecord(config.config_json),
      String(config.order),
      <div className="inline-actions">
        <button type="button" className="button button--secondary" onClick={() => setSelectedConfigId(config.id)}>
          Edit
        </button>
        <button type="button" className="button button--secondary" onClick={() => void moveConfig(config, -1)}>
          Up
        </button>
        <button type="button" className="button button--secondary" onClick={() => void moveConfig(config, 1)}>
          Down
        </button>
        <button type="button" className="button button--secondary" onClick={() => void cloneConfig(config)}>
          Clone
        </button>
        <button type="button" className="button button--danger" onClick={() => void deleteConfigMutation.mutateAsync(config.id)}>
          Delete
        </button>
      </div>,
    ],
    id: config.id,
  }))

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    try {
      const payload = buildPayload(form)
      await updateGroup.mutateAsync({
        groupKey: GROUP_KEY,
        request: { value_json: payload },
      })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Subscription delivery could not be saved.')
    }
  }

  async function handleCreateConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setConfigError(null)
    try {
      const config = await createConfig.mutateAsync({
        config_json: parseJsonObject(configJson, 'Config JSON'),
        name: configName.trim(),
        status: configStatus.trim(),
      })
      setSelectedConfigId(config.id)
      setConfigName('')
      setConfigJson('{"title":"Customer profile"}')
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : 'Subscription page config could not be saved.')
    }
  }

  async function saveSelectedConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedConfig) {
      return
    }
    setConfigError(null)
    try {
      await updateConfig.mutateAsync({
        id: selectedConfig.id,
        request: {
          config_json: parseJsonObject(editorJson, 'Selected config JSON'),
          name: editorName.trim(),
          status: editorStatus.trim(),
        },
      })
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : 'Subscription page config could not be updated.')
    }
  }

  async function cloneConfig(config: SubscriptionPageConfigRecord) {
    await cloneConfigMutation.mutateAsync({
      id: config.id,
      request: { name: `${config.name} copy` },
    })
  }

  async function moveConfig(config: SubscriptionPageConfigRecord, direction: -1 | 1) {
    const index = configs.findIndex((item) => item.id === config.id)
    const targetIndex = index + direction
    if (index < 0 || targetIndex < 0 || targetIndex >= configs.length) {
      return
    }
    const ids = configs.map((item) => item.id)
    const [id] = ids.splice(index, 1)
    ids.splice(targetIndex, 0, id)
    await reorderConfigs.mutateAsync(ids)
  }

  async function bindConfigToSubscription() {
    if (!selectedConfig || !selectedSubscription) {
      return
    }
    await updateSubscription.mutateAsync({
      id: selectedSubscription.id,
      request: {
        delivery_profile: {
          ...selectedSubscription.delivery_profile,
          subpage_config_id: selectedConfig.id,
        },
      },
    })
  }

  async function clearSubscriptionConfig(subscription: SubscriptionRecord) {
    const nextProfile = { ...subscription.delivery_profile }
    delete nextProfile.subpage_config_id
    await updateSubscription.mutateAsync({
      id: subscription.id,
      request: { delivery_profile: nextProfile },
    })
  }

  return (
    <section className="page">
      <PageHeader
        eyebrow={pageSpec.eyebrow}
        title={pageSpec.title}
        description={pageSpec.description}
      />
      <section className="metrics-grid" aria-label="Subscription delivery metrics">
        <MetricCard
          metric={{
            detail: 'real public subscription records',
            icon: sectionSpecs.subscription.icon,
            label: 'Subscriptions',
            tone: 'info',
            value: String(subscriptions.length),
          }}
        />
        <MetricCard
          metric={{
            detail: deliveryGroup ? GROUP_KEY : 'typed group missing',
            icon: sectionSpecs.license.icon,
            label: 'Applied setting',
            tone: deliveryGroup ? 'good' : 'watch',
            value: deliveryGroup ? 'Active' : 'Missing',
          }}
        />
      </section>
      <div className="resource-layout">
        <ScreenForm onSubmit={handleSubmit}>
          <div>
            <p className="eyebrow">Typed delivery settings</p>
            <h2>Client-facing subscription contract</h2>
            <p>
              These values are saved as {GROUP_KEY} and are read by the real public
              manifest and renderer path on every request.
            </p>
          </div>
          <TextField id="subscription-title" label="Subscription title" required value={form.title} onChange={(title) => setForm((value) => ({ ...value, title }))} />
          <TextField id="subscription-update-interval" label="Update interval, hours" min="1" required type="number" value={form.updateIntervalHours} onChange={(updateIntervalHours) => setForm((value) => ({ ...value, updateIntervalHours }))} />
          <TextField id="subscription-support-url" label="Support URL" type="url" value={form.supportUrl} onChange={(supportUrl) => setForm((value) => ({ ...value, supportUrl }))} />
          <TextField id="subscription-profile-page-url" label="Profile page URL" type="url" value={form.profilePageUrl} onChange={(profilePageUrl) => setForm((value) => ({ ...value, profilePageUrl }))} />
          <label htmlFor="subscription-happ-announce">
            HApp announce
            <textarea
              id="subscription-happ-announce"
              rows={3}
              value={form.happAnnounce}
              onChange={(event) =>
                setForm((value) => ({ ...value, happAnnounce: event.target.value }))
              }
            />
          </label>
          <label className="checkbox-row" htmlFor="subscription-random-host-order">
            <input
              id="subscription-random-host-order"
              type="checkbox"
              checked={form.randomHostOrder}
              onChange={(event) =>
                setForm((value) => ({ ...value, randomHostOrder: event.target.checked }))
              }
            />
            Random host order
          </label>
          <JsonField id="subscription-response-headers" label="Response headers JSON" value={form.responseHeaders} onChange={(responseHeaders) => setForm((value) => ({ ...value, responseHeaders }))} />
          <JsonField id="subscription-base-json" label="Base JSON" value={form.baseJson} onChange={(baseJson) => setForm((value) => ({ ...value, baseJson }))} />
          <JsonField id="subscription-routing" label="Routing JSON" value={form.routing} onChange={(routing) => setForm((value) => ({ ...value, routing }))} />
          <JsonField id="subscription-custom-remarks" label="Custom remarks JSON" value={form.customRemarks} onChange={(customRemarks) => setForm((value) => ({ ...value, customRemarks }))} />
          <JsonField id="subscription-subpage" label="Subpage JSON" value={form.subpage} onChange={(subpage) => setForm((value) => ({ ...value, subpage }))} />
          <FormError message={formError} />
          {updateGroup.isSuccess ? (
            <p className="auth-card__note" aria-live="polite">
              Subscription delivery settings saved and applied to live render requests.
            </p>
          ) : null}
          <SubmitButton pending={updateGroup.isPending}>Save subscription delivery</SubmitButton>
        </ScreenForm>
        <article className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Effective JSON</p>
              <h2>{GROUP_KEY}</h2>
            </div>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void groupsQuery.refetch()}
            >
              Refresh
            </button>
          </div>
          {deliverySettings ? (
            <pre className="code-block">{JSON.stringify(deliverySettings, null, 2)}</pre>
          ) : (
            <p className="auth-card__note">
              The typed delivery group is not loaded. Refresh the page or check the settings API.
            </p>
          )}
        </article>
      </div>
      <div className="resource-layout">
        <ScreenForm onSubmit={handleCreateConfig}>
          <div>
            <p className="eyebrow">Page configs</p>
            <h2>Create customer page config</h2>
            <p>
              Saved configs are reusable public subscription page presets. Bind one to
              a subscription to make its manifest expose the selected subpage contract.
            </p>
          </div>
          <TextField id="subpage-config-name" label="Config name" required value={configName} onChange={setConfigName} />
          <TextField id="subpage-config-status" label="Config status" required value={configStatus} onChange={setConfigStatus} />
          <JsonField id="subpage-config-json" label="Config JSON" value={configJson} onChange={setConfigJson} />
          <FormError message={configError} />
          <SubmitButton pending={createConfig.isPending}>Create page config</SubmitButton>
        </ScreenForm>
        <article className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Selected config</p>
              <h2>{selectedConfig?.name ?? 'No page config'}</h2>
            </div>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void configsQuery.refetch()}
            >
              Refresh configs
            </button>
          </div>
          {selectedConfig ? (
            <form className="screen-form" onSubmit={saveSelectedConfig}>
              <TextField id="selected-subpage-config-name" label="Selected config name" required value={editorName} onChange={setEditorName} />
              <TextField id="selected-subpage-config-status" label="Selected config status" required value={editorStatus} onChange={setEditorStatus} />
              <JsonField id="selected-subpage-config-json" label="Selected config JSON" value={editorJson} onChange={setEditorJson} />
              <SubmitButton pending={updateConfig.isPending}>Save selected page config</SubmitButton>
            </form>
          ) : (
            <p className="auth-card__note">Create a config before binding customer pages.</p>
          )}
        </article>
      </div>
      <article className="panel panel--wide">
        <div className="panel__header">
          <div>
            <p className="eyebrow">Config registry</p>
            <h2>Subscription page configs</h2>
          </div>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void reorderConfigs.mutateAsync(configs.map((config) => config.id).reverse())}
          >
            Reverse config order
          </button>
        </div>
        {configsQuery.isLoading ? <LoadingState label="Loading subscription page configs..." /> : null}
        {configsQuery.isError ? (
          <ErrorState
            title="Subscription page configs unavailable"
            error={configsQuery.error ?? new Error('Subscription page configs unavailable')}
          />
        ) : null}
        {configsQuery.isSuccess && configs.length === 0 ? (
          <EmptyState
            title="No subscription page configs"
            description="Create a reusable page config before binding subscriptions."
          />
        ) : null}
        {configsQuery.isSuccess && configs.length > 0 ? (
          <DataTable
            caption="Subscription page configs"
            columns={['Name', 'Status', 'Config', 'Order', 'Actions']}
            rows={configRows}
          />
        ) : null}
      </article>
      <article className="panel panel--wide">
        <div className="panel__header">
          <div>
            <p className="eyebrow">Binding</p>
            <h2>Bind config to subscription</h2>
          </div>
          <StatusBadge tone={selectedConfig && selectedSubscription ? 'good' : 'watch'}>
            {selectedConfig && selectedSubscription ? 'ready' : 'select records'}
          </StatusBadge>
        </div>
        <div className="field-grid">
          <label htmlFor="subpage-bind-subscription">
            Subscription
            <select
              id="subpage-bind-subscription"
              value={selectedSubscription?.id ?? ''}
              onChange={(event) => setSelectedSubscriptionId(event.target.value)}
            >
              {subscriptions.map((subscription) => (
                <option key={subscription.id} value={subscription.id}>
                  {subscription.public_id} - {subscription.delivery_profile.subpage_config_id ?? 'no page config'}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="subpage-bind-config">
            Page config
            <select
              id="subpage-bind-config"
              value={selectedConfig?.id ?? ''}
              onChange={(event) => setSelectedConfigId(event.target.value)}
            >
              {configs.map((config) => (
                <option key={config.id} value={config.id}>
                  {config.name} - {config.status}
                </option>
              ))}
            </select>
          </label>
          <div className="inline-actions field-grid__full">
            <button
              type="button"
              className="button button--secondary"
              disabled={!selectedConfig || !selectedSubscription}
              onClick={() => void bindConfigToSubscription()}
            >
              Bind page config
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={!selectedSubscription}
              onClick={() => selectedSubscription && void clearSubscriptionConfig(selectedSubscription)}
            >
              Clear binding
            </button>
          </div>
        </div>
      </article>
      {subscriptionsQuery.isLoading ? <LoadingState label="Loading subscription page..." /> : null}
      {subscriptionsQuery.isError ? (
        <ErrorState
          title="Subscription page unavailable"
          error={subscriptionsQuery.error ?? new Error('Subscription page unavailable')}
        />
      ) : null}
      {subscriptionsQuery.isSuccess && subscriptions.length === 0 ? (
        <EmptyState
          title="No subscription page records"
          description="Create a real subscription before exposing a public customer page."
        />
      ) : null}
      {subscriptionsQuery.isSuccess && subscriptions.length > 0 ? (
        <article className="panel panel--wide">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Public page</p>
              <h2>Profile page records</h2>
            </div>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void subscriptionsQuery.refetch()}
            >
              Refresh
            </button>
          </div>
          <DataTable
            caption="Subscription page metadata"
            columns={['Public ID', 'Profile', 'Expires', 'Page status']}
            rows={rows}
          />
        </article>
      ) : null}
    </section>
  )
}

function buildPayload(form: SubscriptionDeliveryForm): Record<string, unknown> {
  return {
    base_json: parseJsonObject(form.baseJson, 'Base JSON'),
    custom_remarks: parseJsonObject(form.customRemarks, 'Custom remarks JSON'),
    happ_announce: nullIfEmpty(form.happAnnounce),
    profile_page_url: nullIfEmpty(form.profilePageUrl),
    random_host_order: form.randomHostOrder,
    response_headers: parseStringRecord(form.responseHeaders, 'Response headers JSON'),
    routing: parseJsonObject(form.routing, 'Routing JSON'),
    subpage: parseJsonObject(form.subpage, 'Subpage JSON'),
    support_url: nullIfEmpty(form.supportUrl),
    title: form.title.trim(),
    update_interval_hours: Number(form.updateIntervalHours),
  }
}

function TextField({
  id,
  label,
  min,
  onChange,
  required = false,
  type = 'text',
  value,
}: {
  id: string
  label: string
  min?: string
  onChange: (value: string) => void
  required?: boolean
  type?: string
  value: string
}) {
  return (
    <label htmlFor={id}>
      {label}
      <input
        id={id}
        min={min}
        required={required}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function JsonField({
  id,
  label,
  onChange,
  value,
}: {
  id: string
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <label htmlFor={id}>
      {label}
      <textarea
        id={id}
        rows={5}
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function jsonValue(value: unknown) {
  if (!value || typeof value !== 'object') {
    return '{}'
  }
  return JSON.stringify(value, null, 2)
}

function nullIfEmpty(value: string) {
  const normalized = value.trim()
  return normalized ? normalized : null
}

function parseJsonObject(value: string, label: string) {
  const normalized = value.trim()
  if (!normalized) {
    return {}
  }
  const parsed = JSON.parse(normalized) as unknown
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${label} must be a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

function parseStringRecord(value: string, label: string) {
  const parsed = parseJsonObject(value, label)
  return Object.fromEntries(
    Object.entries(parsed).map(([key, entry]) => [key, String(entry)]),
  )
}

function stringValue(value: unknown, fallback: string) {
  if (value === null || value === undefined) {
    return fallback
  }
  return String(value)
}
