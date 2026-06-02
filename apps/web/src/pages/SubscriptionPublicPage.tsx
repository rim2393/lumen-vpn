import { useEffect, useState, type FormEvent } from 'react'
import {
  useSettingGroupsData,
  useSubscriptionsPageData,
  useUpdateSettingGroup,
} from '../shared/api/resourceHooks'
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
  const groupsQuery = useSettingGroupsData()
  const updateGroup = useUpdateSettingGroup()
  const subscriptions = subscriptionsQuery.data?.items ?? []
  const groups = groupsQuery.data?.items ?? []
  const deliveryGroup = groups.find((group) => group.key === GROUP_KEY)
  const deliverySettings = deliveryGroup?.value_json
  const [form, setForm] = useState<SubscriptionDeliveryForm>(defaultForm)
  const [formError, setFormError] = useState<string | null>(null)

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
