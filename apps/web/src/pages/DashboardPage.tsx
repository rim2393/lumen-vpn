import { useQueries } from '@tanstack/react-query'
import { Activity, AlertTriangle, BadgeCheck, Network, RadioTower, UsersRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useApiClient } from '../shared/api/apiClientContext'
import type {
  AdminUserRecord,
  ApiKeyRecord,
  LicenseSummary,
  NodeResponse,
  SubscriptionRecord,
} from '../shared/api/types'
import { ErrorState, LoadingState } from '../shared/components/DataState'
import { MetricCard } from '../shared/components/MetricCard'
import { PageHeader } from '../shared/components/PageHeader'
import { StatusBadge } from '../shared/components/StatusBadge'
import type { DashboardMetric } from '../shared/data/lumenData'

type DashboardQueryResult<TData> = {
  data: TData | undefined
  error: Error | null
  isError: boolean
  isLoading: boolean
}

type ActivityRow = {
  label: string
  meta: string
}

type RiskRow = {
  label: string
  value: string
}

const ACTIVE_NODE_STATUSES = new Set(['active'])
const ATTENTION_NODE_STATUSES = new Set(['failed', 'offline', 'license_paused', 'paused', 'quarantined'])

export function DashboardPage() {
  const apiClient = useApiClient()
  const [usersQuery, nodesQuery, subscriptionsQuery, apiKeysQuery, licenseQuery] = useQueries({
    queries: [
      {
        queryFn: apiClient.listUsers,
        queryKey: ['dashboard', 'users'],
      },
      {
        queryFn: apiClient.listNodes,
        queryKey: ['dashboard', 'nodes'],
      },
      {
        queryFn: apiClient.listSubscriptions,
        queryKey: ['dashboard', 'subscriptions'],
      },
      {
        queryFn: apiClient.listApiKeys,
        queryKey: ['dashboard', 'api-keys'],
      },
      {
        queryFn: apiClient.readLicense,
        queryKey: ['dashboard', 'license'],
      },
    ],
  }) as [
    DashboardQueryResult<{ items: AdminUserRecord[]; source?: string; total?: number }>,
    DashboardQueryResult<{ items: NodeResponse[] }>,
    DashboardQueryResult<{ items: SubscriptionRecord[] }>,
    DashboardQueryResult<{ items: ApiKeyRecord[] }>,
    DashboardQueryResult<LicenseSummary | null>,
  ]

  const isLoading = [usersQuery, nodesQuery, subscriptionsQuery, apiKeysQuery, licenseQuery].some(
    (query) => query.isLoading,
  )
  const firstError = [usersQuery, nodesQuery, subscriptionsQuery, apiKeysQuery, licenseQuery].find(
    (query) => query.isError,
  )?.error

  const users = usersQuery.data?.items ?? []
  const nodes = nodesQuery.data?.items ?? []
  const subscriptions = subscriptionsQuery.data?.items ?? []
  const apiKeys = apiKeysQuery.data?.items ?? []
  const license = licenseQuery.data ?? null
  const metrics = buildDashboardMetrics({ license, nodes, subscriptions, users })
  const activityRows = buildActivityRows({ apiKeys, license, nodes, subscriptions, users })
  const riskRows = buildRiskRows({ apiKeys, license, nodes, subscriptions, users })
  const sourceLabel = usersQuery.data?.source === 'mock' ? 'Test data' : 'Live API'

  return (
    <section className="page">
      <PageHeader
        eyebrow="Lumen control plane"
        title="Command dashboard"
        description="Live state from the panel API. Empty values mean the backend has no recorded data yet."
        actions={
          <Link to="/nodes" className="button button--secondary">
            Open nodes
            <RadioTower size={18} aria-hidden="true" />
          </Link>
        }
      />

      {isLoading ? <LoadingState label="Loading live dashboard..." /> : null}
      {firstError ? <ErrorState error={firstError} title="Live dashboard API is unavailable" /> : null}

      {!isLoading && !firstError ? (
        <>
          <section className="metrics-grid" aria-label="Live dashboard metrics">
            {metrics.map((metric) => (
              <MetricCard key={metric.label} metric={metric} />
            ))}
          </section>

          <section className="dashboard-grid">
            <article className="panel">
              <div className="panel__header">
                <div>
                  <p className="eyebrow">Recent operations</p>
                  <h2>Live activity</h2>
                </div>
                <StatusBadge tone={sourceLabel === 'Live API' ? 'good' : 'watch'}>{sourceLabel}</StatusBadge>
              </div>
              {activityRows.length > 0 ? (
                <ul className="activity-list">
                  {activityRows.map((event) => (
                    <li key={`${event.label}-${event.meta}`}>
                      <Activity size={18} aria-hidden="true" />
                      <span>{event.label}</span>
                      <small>{event.meta}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-inline">No live activity is recorded yet.</p>
              )}
            </article>

            <article className="panel">
              <div className="panel__header">
                <div>
                  <p className="eyebrow">Attention</p>
                  <h2>Risk watch</h2>
                </div>
                <AlertTriangle size={20} aria-hidden="true" />
              </div>
              {riskRows.length > 0 ? (
                <div className="risk-list">
                  {riskRows.map((item) => (
                    <div key={item.label} className="risk-row">
                      <AlertTriangle size={18} aria-hidden="true" />
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-inline">No live risks are recorded yet.</p>
              )}
            </article>
          </section>
        </>
      ) : null}
    </section>
  )
}

function buildDashboardMetrics({
  license,
  nodes,
  subscriptions,
  users,
}: {
  license: LicenseSummary | null
  nodes: NodeResponse[]
  subscriptions: SubscriptionRecord[]
  users: AdminUserRecord[]
}): DashboardMetric[] {
  const activeUsers = users.filter((user) => user.status === 'active').length
  const activeNodes = nodes.filter((node) => ACTIVE_NODE_STATUSES.has(node.status)).length
  const attentionNodes = nodes.filter((node) => ATTENTION_NODE_STATUSES.has(node.status)).length
  const trafficGb = users.reduce((total, user) => total + safeNumber(user.trafficUsedGb), 0)
  const activeSubscriptions = subscriptions.filter(
    (subscription) => subscription.status === 'active' && !subscription.revoked_at,
  ).length

  return [
    {
      detail: `${users.length} total`,
      icon: UsersRound,
      label: 'Active users',
      tone: activeUsers > 0 ? 'good' : 'neutral',
      value: formatInteger(activeUsers),
    },
    {
      detail: attentionNodes > 0 ? `${attentionNodes} need attention` : `${nodes.length} total`,
      icon: Network,
      label: 'Healthy nodes',
      tone: attentionNodes > 0 ? 'watch' : activeNodes > 0 ? 'good' : 'neutral',
      value: `${formatInteger(activeNodes)} / ${formatInteger(nodes.length)}`,
    },
    {
      detail: 'recorded by API',
      icon: Activity,
      label: 'Traffic used',
      tone: trafficGb > 0 ? 'info' : 'neutral',
      value: formatTraffic(trafficGb),
    },
    {
      detail: license ? `${activeSubscriptions} active subscriptions` : 'free mode or not synced',
      icon: BadgeCheck,
      label: 'License seats',
      tone: license?.status === 'invalid' ? 'danger' : license?.status === 'expiring' ? 'watch' : 'good',
      value: license ? `${formatInteger(license.seatsUsed)} / ${formatInteger(license.seatsLimit)}` : 'Free',
    },
  ]
}

function buildActivityRows({
  apiKeys,
  license,
  nodes,
  subscriptions,
  users,
}: {
  apiKeys: ApiKeyRecord[]
  license: LicenseSummary | null
  nodes: NodeResponse[]
  subscriptions: SubscriptionRecord[]
  users: AdminUserRecord[]
}): ActivityRow[] {
  const rows: ActivityRow[] = []
  const latestNode = [...nodes]
    .filter((node) => node.last_seen_at)
    .sort((left, right) => String(right.last_seen_at).localeCompare(String(left.last_seen_at)))[0]
  const latestApiKey = [...apiKeys].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
  const latestSubscription = subscriptions[0]

  if (latestNode) {
    rows.push({
      label: `${latestNode.name} reported ${latestNode.status}`,
      meta: formatDateTime(latestNode.last_seen_at),
    })
  }
  if (latestSubscription) {
    rows.push({
      label: `Subscription ${latestSubscription.public_id} is ${latestSubscription.status}`,
      meta: latestSubscription.expires_at ? `expires ${formatDateTime(latestSubscription.expires_at)}` : 'no expiry',
    })
  }
  if (latestApiKey) {
    rows.push({
      label: `API key ${latestApiKey.name} is ${latestApiKey.status}`,
      meta: latestApiKey.lastUsedAt ? `last used ${formatDateTime(latestApiKey.lastUsedAt)}` : 'never used',
    })
  }
  if (license) {
    rows.push({
      label: `License status is ${license.status}`,
      meta: `expires ${formatDateTime(license.expiresAt)}`,
    })
  }
  if (users.length > 0) {
    rows.push({
      label: `${users.length} users loaded from API`,
      meta: `${users.filter((user) => user.status === 'active').length} active`,
    })
  }

  return rows.slice(0, 5)
}

function buildRiskRows({
  apiKeys,
  license,
  nodes,
  subscriptions,
  users,
}: {
  apiKeys: ApiKeyRecord[]
  license: LicenseSummary | null
  nodes: NodeResponse[]
  subscriptions: SubscriptionRecord[]
  users: AdminUserRecord[]
}): RiskRow[] {
  const rows: RiskRow[] = []
  const inactiveNodes = nodes.filter((node) => !ACTIVE_NODE_STATUSES.has(node.status))
  const expiringUsers = users.filter((user) => user.status === 'limited' || user.subscription === 'grace')
  const revokedSubscriptions = subscriptions.filter((subscription) => subscription.revoked_at)
  const expiringApiKeys = apiKeys.filter((apiKey) => apiKey.status === 'expiring')

  if (inactiveNodes.length > 0) {
    rows.push({ label: 'Nodes not active', value: formatInteger(inactiveNodes.length) })
  }
  if (expiringUsers.length > 0) {
    rows.push({ label: 'Users limited or in grace', value: formatInteger(expiringUsers.length) })
  }
  if (revokedSubscriptions.length > 0) {
    rows.push({ label: 'Revoked subscriptions', value: formatInteger(revokedSubscriptions.length) })
  }
  if (expiringApiKeys.length > 0) {
    rows.push({ label: 'API keys expiring', value: formatInteger(expiringApiKeys.length) })
  }
  if (license?.status === 'invalid' || license?.status === 'expiring') {
    rows.push({ label: 'License attention', value: license.status })
  }

  return rows
}

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

function formatTraffic(gigabytes: number): string {
  if (gigabytes <= 0) {
    return '0 B'
  }
  if (gigabytes >= 1024) {
    return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(gigabytes / 1024)} TiB`
  }
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(gigabytes)} GiB`
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return 'never'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}
