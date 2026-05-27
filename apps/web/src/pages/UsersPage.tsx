import { Plus, Search } from 'lucide-react'
import { useUsersPageData } from '../shared/api/resourceHooks'
import type { UserStatus } from '../shared/api/types'
import { DataTable } from '../shared/components/DataTable'
import { EmptyState, ErrorState, LoadingState } from '../shared/components/DataState'
import { PageHeader } from '../shared/components/PageHeader'
import { StatusBadge } from '../shared/components/StatusBadge'
import type { MetricTone } from '../shared/data/lumenData'
import { placeholderSpecs } from '../shared/data/lumenData'

const userTone: Record<UserStatus, MetricTone> = {
  active: 'good',
  disabled: 'danger',
  limited: 'watch',
}

export function UsersPage() {
  const spec = placeholderSpecs.users
  const query = useUsersPageData()
  const users = query.data?.items ?? []

  return (
    <section className="page">
      <PageHeader
        eyebrow={spec.eyebrow}
        title={spec.title}
        description={spec.description}
        actions={
          <>
            <button type="button" className="button button--secondary">
              <Search size={18} aria-hidden="true" />
              Filter
            </button>
            <button type="button" className="button button--primary">
              <Plus size={18} aria-hidden="true" />
              {spec.primaryAction}
            </button>
          </>
        }
      />

      {query.isLoading ? <LoadingState label="Loading users..." /> : null}
      {query.isError ? <ErrorState title="Users unavailable" error={query.error} /> : null}
      {query.isSuccess && users.length === 0 ? (
        <EmptyState
          title="No users found"
          description="Provisioned accounts will appear here once the users endpoint returns records."
        />
      ) : null}
      {query.isSuccess && users.length > 0 ? (
        <article className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Identity registry</p>
              <h2>User directory</h2>
            </div>
            <StatusBadge>{query.data.source}</StatusBadge>
          </div>
          <DataTable
            caption="User directory"
            columns={['User', 'Role', 'Subscription', 'MFA', 'Traffic', 'Status']}
            rows={users.map((user) => ({
              cells: [
                `${user.displayName} (${user.email})`,
                user.role,
                `${user.subscription} until ${user.expiresAt}`,
                user.mfaEnabled ? 'Enabled' : 'Not enabled',
                `${user.trafficUsedGb} GB`,
                <StatusBadge tone={userTone[user.status]}>{user.status}</StatusBadge>,
              ],
              id: user.id,
            }))}
          />
        </article>
      ) : null}
    </section>
  )
}
