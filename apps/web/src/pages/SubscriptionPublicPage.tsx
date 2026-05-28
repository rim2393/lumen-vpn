import { useEffect, useState, type FormEvent } from 'react'
import {
  useSettingsPageData,
  useSubscriptionsPageData,
  useUpdateSetting,
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
import { sectionSpecs } from '../shared/data/lumenData'
import { formatDateTime, formatRecord } from '../shared/utils/resourceFormat'

const SETTING_KEY = 'subscription.info'

const pageSpec = {
  ...sectionSpecs.subscription,
  description:
    'Configure the real metadata used by public subscription pages and client subscription headers.',
  eyebrow: 'Subscription page',
  primaryAction: 'Save public metadata',
  status: 'active',
  title: 'Subscription Page',
}

type SubscriptionInfoForm = {
  autoUpdateHours: string
  profilePageUrl: string
  supportUrl: string
  title: string
}

const defaultForm: SubscriptionInfoForm = {
  autoUpdateHours: '2',
  profilePageUrl: '',
  supportUrl: '',
  title: 'Lumen',
}

export function SubscriptionPublicPage() {
  const subscriptionsQuery = useSubscriptionsPageData()
  const settingsQuery = useSettingsPageData()
  const updateSetting = useUpdateSetting()
  const subscriptions = subscriptionsQuery.data?.items ?? []
  const settings = settingsQuery.data?.items ?? []
  const subscriptionInfo = settings.find((setting) => setting.key === SETTING_KEY)?.value_json
  const [form, setForm] = useState<SubscriptionInfoForm>(defaultForm)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!subscriptionInfo) {
      return
    }
    setForm({
      autoUpdateHours: stringValue(subscriptionInfo.auto_update_hours, defaultForm.autoUpdateHours),
      profilePageUrl: stringValue(subscriptionInfo.profile_page_url, ''),
      supportUrl: stringValue(subscriptionInfo.support_url, ''),
      title: stringValue(subscriptionInfo.title, defaultForm.title),
    })
  }, [subscriptionInfo])

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
      await updateSetting.mutateAsync({
        key: SETTING_KEY,
        request: {
          value_json: {
            auto_update_hours: form.autoUpdateHours.trim(),
            profile_page_url: form.profilePageUrl.trim(),
            support_url: form.supportUrl.trim(),
            title: form.title.trim(),
          },
        },
      })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Subscription page could not be saved.')
    }
  }

  return (
    <section className="page">
      <PageHeader
        eyebrow={pageSpec.eyebrow}
        title={pageSpec.title}
        description={pageSpec.description}
      />
      <section className="metrics-grid" aria-label="Subscription page metrics">
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
            detail: subscriptionInfo ? SETTING_KEY : 'not configured',
            icon: sectionSpecs.license.icon,
            label: 'Applied setting',
            tone: subscriptionInfo ? 'good' : 'watch',
            value: subscriptionInfo ? 'Active' : 'Missing',
          }}
        />
      </section>
      <div className="resource-layout">
        <ScreenForm onSubmit={handleSubmit}>
          <div>
            <p className="eyebrow">Public metadata</p>
            <h2>Client-facing subscription settings</h2>
            <p>
              These values are saved as {SETTING_KEY} and are used by manifest metadata,
              subscription response headers, and the public subscription page.
            </p>
          </div>
          <label htmlFor="subscription-title">
            Subscription title
            <input
              id="subscription-title"
              required
              value={form.title}
              onChange={(event) => setForm((value) => ({ ...value, title: event.target.value }))}
            />
          </label>
          <label htmlFor="subscription-auto-update">
            Auto-update interval, hours
            <input
              id="subscription-auto-update"
              inputMode="numeric"
              min="1"
              required
              type="number"
              value={form.autoUpdateHours}
              onChange={(event) =>
                setForm((value) => ({ ...value, autoUpdateHours: event.target.value }))
              }
            />
          </label>
          <label htmlFor="subscription-support-url">
            Support link
            <input
              id="subscription-support-url"
              placeholder="https://t.me/support"
              type="url"
              value={form.supportUrl}
              onChange={(event) =>
                setForm((value) => ({ ...value, supportUrl: event.target.value }))
              }
            />
          </label>
          <label htmlFor="subscription-profile-url">
            Public profile page URL
            <input
              id="subscription-profile-url"
              placeholder="https://sub.example.com"
              type="url"
              value={form.profilePageUrl}
              onChange={(event) =>
                setForm((value) => ({ ...value, profilePageUrl: event.target.value }))
              }
            />
          </label>
          <FormError message={formError} />
          {updateSetting.isSuccess ? (
            <p className="auth-card__note" aria-live="polite">
              Subscription page metadata saved and will be used by new render requests.
            </p>
          ) : null}
          <SubmitButton pending={updateSetting.isPending}>Save subscription page</SubmitButton>
        </ScreenForm>
        <article className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Effective JSON</p>
              <h2>{SETTING_KEY}</h2>
            </div>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void settingsQuery.refetch()}
            >
              Refresh
            </button>
          </div>
          {subscriptionInfo ? (
            <pre className="code-block">{JSON.stringify(subscriptionInfo, null, 2)}</pre>
          ) : (
            <p className="auth-card__note">
              No saved subscription.info setting exists yet. Save the form to apply these
              values to public manifests and subscription render headers.
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

function stringValue(value: unknown, fallback: string) {
  if (value === null || value === undefined) {
    return fallback
  }
  return String(value)
}
