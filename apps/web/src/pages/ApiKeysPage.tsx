import { Plus, Search } from 'lucide-react'
import { useApiKeysPageData } from '../shared/api/resourceHooks'
import type { ApiKeyStatus } from '../shared/api/types'
import { DataTable } from '../shared/components/DataTable'
import { EmptyState, ErrorState, LoadingState } from '../shared/components/DataState'
import { PageHeader } from '../shared/components/PageHeader'
import { StatusBadge } from '../shared/components/StatusBadge'
import type { MetricTone } from '../shared/data/lumenData'
import { placeholderSpecs } from '../shared/data/lumenData'

const statusTone: Record<ApiKeyStatus, MetricTone> = {
  active: 'good',
  expiring: 'watch',
  revoked: 'danger',
}

export function ApiKeysPage() {
  const spec = placeholderSpecs.apiKeys
  const query = useApiKeysPageData()
  const keys = query.data?.items ?? []

  return (
    <section className="page">
      <PageHeader
        eyebrow={spec.eyebrow}
        title={spec.title}
        description="Scoped token management with API-ready loading, error, and empty states. Secret values are never displayed."
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

      {query.isLoading ? <LoadingState label="Loading API keys..." /> : null}
      {query.isError ? <ErrorState title="API keys unavailable" error={query.error} /> : null}
      {query.isSuccess && keys.length === 0 ? (
        <EmptyState
          title="No API keys issued"
          description="Create a scoped automation key once backend token issuance is enabled."
        />
      ) : null}
      {query.isSuccess && keys.length > 0 ? (
        <section className="resource-grid">
          <article className="panel panel--wide">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Automation access</p>
                <h2>Key inventory</h2>
              </div>
              <StatusBadge>{query.data.source}</StatusBadge>
            </div>
            <DataTable
              caption="API key inventory"
              columns={['Name', 'Owner', 'Scopes', 'Fingerprint', 'Last used', 'Status']}
              rows={keys.map((key) => ({
                cells: [
                  key.name,
                  key.owner,
                  key.scopes.join(', '),
                  key.fingerprint,
                  key.lastUsedAt ?? 'Never',
                  <StatusBadge tone={statusTone[key.status]}>{key.status}</StatusBadge>,
                ],
                id: key.id,
              }))}
            />
          </article>
          <article className="panel">
            <h2>Backend contract</h2>
            <ul className="feature-list">
              {spec.items.map((item) => (
                <li key={item}>
                  <span aria-hidden="true">-</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>
        </section>
      ) : null}
    </section>
  )
}
