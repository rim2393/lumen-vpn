import { RefreshCw } from 'lucide-react'
import { useLicensePageData } from '../shared/api/resourceHooks'
import type { LicenseStatus } from '../shared/api/types'
import { EmptyState, ErrorState, LoadingState } from '../shared/components/DataState'
import { PageHeader } from '../shared/components/PageHeader'
import { StatusBadge } from '../shared/components/StatusBadge'
import type { MetricTone } from '../shared/data/lumenData'
import { placeholderSpecs } from '../shared/data/lumenData'

const licenseTone: Record<LicenseStatus, MetricTone> = {
  expiring: 'watch',
  invalid: 'danger',
  valid: 'good',
}

export function LicensePage() {
  const spec = placeholderSpecs.license
  const query = useLicensePageData()
  const license = query.data

  return (
    <section className="page">
      <PageHeader
        eyebrow={spec.eyebrow}
        title={spec.title}
        description="Read-only entitlement health with no license keys or activation secrets persisted in the UI."
        actions={
          <button type="button" className="button button--secondary">
            <RefreshCw size={18} aria-hidden="true" />
            {spec.primaryAction}
          </button>
        }
      />

      {query.isLoading ? <LoadingState label="Loading license status..." /> : null}
      {query.isError ? <ErrorState title="License status unavailable" error={query.error} /> : null}
      {query.isSuccess && !license ? (
        <EmptyState
          title="No license record"
          description="The entitlement endpoint returned no instance license summary."
        />
      ) : null}
      {query.isSuccess && license ? (
        <section className="resource-grid">
          <article className="panel panel--wide">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Entitlement</p>
                <h2>{license.plan}</h2>
              </div>
              <StatusBadge tone={licenseTone[license.status]}>{license.status}</StatusBadge>
            </div>
            <div className="summary-grid">
              <div>
                <span>Issued to</span>
                <strong>{license.issuedTo}</strong>
              </div>
              <div>
                <span>Expiry</span>
                <strong>{license.expiresAt}</strong>
              </div>
              <div>
                <span>Seats</span>
                <strong>
                  {license.seatsUsed.toLocaleString()} / {license.seatsLimit.toLocaleString()}
                </strong>
              </div>
            </div>
          </article>
          <article className="panel">
            <h2>Enabled features</h2>
            <ul className="feature-list">
              {license.features.map((feature) => (
                <li key={feature}>
                  <span aria-hidden="true">-</span>
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </article>
          <article className="panel panel--wide">
            <h2>Audit trail</h2>
            <ul className="activity-list">
              {license.auditEvents.map((event) => (
                <li key={`${event.at}-${event.label}`}>
                  <span aria-hidden="true">-</span>
                  <span>{event.label}</span>
                  <small>{event.at}</small>
                </li>
              ))}
            </ul>
          </article>
        </section>
      ) : null}
    </section>
  )
}
