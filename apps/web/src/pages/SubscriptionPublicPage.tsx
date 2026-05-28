import { useSettingsPageData, useSubscriptionsPageData } from '../shared/api/resourceHooks'
import { DataTable } from '../shared/components/DataTable'
import { EmptyState, ErrorState, LoadingState } from '../shared/components/DataState'
import { MetricCard } from '../shared/components/MetricCard'
import { PageHeader } from '../shared/components/PageHeader'
import { StatusBadge } from '../shared/components/StatusBadge'
import { sectionSpecs } from '../shared/data/lumenData'
import { formatDateTime, formatRecord } from '../shared/utils/resourceFormat'

const pageSpec = {
  ...sectionSpecs.subscription,
  description: 'Manage public subscription page metadata, support links, JSON mode, and client-facing profile hints.',
  eyebrow: 'Subscription page',
  primaryAction: 'Preview page',
  status: 'active',
  title: 'Subscription Page',
}

export function SubscriptionPublicPage() {
  const subscriptionsQuery = useSubscriptionsPageData()
  const settingsQuery = useSettingsPageData()
  const subscriptions = subscriptionsQuery.data?.items ?? []
  const settings = settingsQuery.data?.items ?? []
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
            detail: 'active feed records',
            icon: sectionSpecs.subscription.icon,
            label: 'Subscriptions',
            tone: 'info',
            value: String(subscriptions.length),
          }}
        />
        <MetricCard
          metric={{
            detail: 'stored panel settings',
            icon: sectionSpecs.license.icon,
            label: 'Page settings',
            tone: 'good',
            value: String(settings.length),
          }}
        />
      </section>
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
