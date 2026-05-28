import { useSubscriptionsPageData, useUsersPageData, useNodesPageData } from '../shared/api/resourceHooks'
import { ResourceScreen } from '../shared/components/ResourceScreen'
import { StatusBadge } from '../shared/components/StatusBadge'
import { placeholderSpecs } from '../shared/data/lumenData'
import { useI18n } from '../shared/i18n/I18nProvider'
import { formatDateTime, formatRecord, toneForStatus } from '../shared/utils/resourceFormat'

export function SubscriptionPage() {
  const { t } = useI18n()
  const query = useSubscriptionsPageData()
  const usersQuery = useUsersPageData()
  const nodesQuery = useNodesPageData()
  const subscriptions = query.data?.items ?? []
  const users = usersQuery.data?.items ?? []
  const nodes = nodesQuery.data?.items ?? []

  return (
    <ResourceScreen
      caption="Subscription inventory"
      columns={['Public ID', 'User', 'Node', 'Delivery profile', 'Expires', 'Config hash', 'Status']}
      emptyDescription="Subscription records will appear after user/license/node bindings are created."
      emptyTitle="No subscriptions"
      error={query.error}
      errorTitle="Subscriptions unavailable"
      isError={query.isError}
      isLoading={query.isLoading}
      isSuccess={query.isSuccess}
      items={subscriptions}
      loadingLabel="Loading subscriptions..."
      onRefresh={() => void query.refetch()}
      renderRow={(subscription) => ({
        cells: [
          subscription.public_id,
          users.find((user) => user.id === subscription.user_id)?.displayName ?? subscription.user_id,
          nodes.find((node) => node.id === subscription.node_id)?.name ?? subscription.node_id ?? t('All nodes'),
          formatRecord(subscription.delivery_profile),
          subscription.expires_at ? formatDateTime(subscription.expires_at) : t('Not set'),
          subscription.config_hash ?? t('Not generated'),
          <StatusBadge tone={toneForStatus(subscription.status)}>{subscription.status}</StatusBadge>,
        ],
        id: subscription.id,
      })}
      rightPanel={
        <article className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{t('Response rules')}</p>
              <h2>{t('Client surface')}</h2>
            </div>
            <StatusBadge>read-only</StatusBadge>
          </div>
          <ul className="feature-list">
            {placeholderSpecs.subscription.items.map((item) => (
              <li key={item}>
                <span aria-hidden="true">-</span>
                <span>{t(item)}</span>
              </li>
            ))}
          </ul>
        </article>
      }
      spec={placeholderSpecs.subscription}
      tableEyebrow="Public config surface"
      tableTitle="Subscription feed records"
    />
  )
}
