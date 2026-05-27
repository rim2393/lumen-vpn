import { Plus, Search } from 'lucide-react'
import { useNodesPageData } from '../shared/api/resourceHooks'
import type { NodeStatus } from '../shared/api/types'
import { DataTable } from '../shared/components/DataTable'
import { EmptyState, ErrorState, LoadingState } from '../shared/components/DataState'
import { PageHeader } from '../shared/components/PageHeader'
import { StatusBadge } from '../shared/components/StatusBadge'
import type { MetricTone } from '../shared/data/lumenData'
import { placeholderSpecs } from '../shared/data/lumenData'

const nodeTone: Record<NodeStatus, MetricTone> = {
  degraded: 'watch',
  healthy: 'good',
  offline: 'danger',
}

export function NodesPage() {
  const spec = placeholderSpecs.nodes
  const query = useNodesPageData()
  const nodes = query.data?.items ?? []

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

      {query.isLoading ? <LoadingState label="Loading nodes..." /> : null}
      {query.isError ? <ErrorState title="Nodes unavailable" error={query.error} /> : null}
      {query.isSuccess && nodes.length === 0 ? (
        <EmptyState
          title="No nodes registered"
          description="Relay nodes will appear here after the node registry endpoint is connected."
        />
      ) : null}
      {query.isSuccess && nodes.length > 0 ? (
        <article className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Infrastructure mesh</p>
              <h2>Node health</h2>
            </div>
            <StatusBadge>{query.data.source}</StatusBadge>
          </div>
          <DataTable
            caption="Node health inventory"
            columns={['Node', 'Region', 'Version', 'Load', 'Transports', 'Status']}
            rows={nodes.map((node) => ({
              cells: [
                `${node.name} (${node.activeUsers} users)`,
                node.region,
                node.version,
                `${node.loadPercent}%`,
                node.transports.join(', '),
                <StatusBadge tone={nodeTone[node.status]}>{node.status}</StatusBadge>,
              ],
              id: node.id,
            }))}
          />
        </article>
      ) : null}
    </section>
  )
}
