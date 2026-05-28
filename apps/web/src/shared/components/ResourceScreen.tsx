import type { FormEvent, ReactNode } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from './DataState'
import { DataTable } from './DataTable'
import { PageHeader } from './PageHeader'
import { StatusBadge } from './StatusBadge'
import type { PlaceholderSpec } from '../data/lumenData'

type ResourceScreenProps<TItem> = {
  actions?: ReactNode
  caption: string
  columns: string[]
  createForm?: ReactNode
  emptyDescription: string
  emptyTitle: string
  error?: unknown
  errorTitle: string
  isError: boolean
  isLoading: boolean
  isSuccess: boolean
  items: TItem[]
  loadingLabel: string
  onRefresh?: () => void
  renderRow: (item: TItem) => { cells: ReactNode[]; id: string }
  rightPanel?: ReactNode
  sourceLabel?: string
  spec: PlaceholderSpec
  tableEyebrow: string
  tableTitle: string
}

export function ScreenForm({
  children,
  onSubmit,
}: {
  children: ReactNode
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <form className="auth-card auth-card--wide" onSubmit={onSubmit}>
      {children}
    </form>
  )
}

export function FormError({ message }: { message: string | null }) {
  if (!message) {
    return null
  }

  return (
    <p className="auth-card__note" role="alert">
      {message}
    </p>
  )
}

export function ResourceScreen<TItem>({
  actions,
  caption,
  columns,
  createForm,
  emptyDescription,
  emptyTitle,
  error,
  errorTitle,
  isError,
  isLoading,
  isSuccess,
  items,
  loadingLabel,
  onRefresh,
  renderRow,
  rightPanel,
  sourceLabel = 'api-ready',
  spec,
  tableEyebrow,
  tableTitle,
}: ResourceScreenProps<TItem>) {
  return (
    <section className="page">
      <PageHeader
        eyebrow={spec.eyebrow}
        title={spec.title}
        description={spec.description}
        actions={
          actions ?? (
            <button
              type="button"
              className="button button--secondary"
              aria-label={`Refresh ${spec.title.toLowerCase()}`}
              disabled={!onRefresh}
              onClick={onRefresh}
            >
              <RefreshCw size={18} aria-hidden="true" />
              Refresh
            </button>
          )
        }
      />

      {isLoading ? <LoadingState label={loadingLabel} /> : null}
      {isError ? <ErrorState title={errorTitle} error={error ?? new Error(errorTitle)} /> : null}
      {isSuccess && items.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : null}
      {isSuccess && items.length === 0 && (createForm || rightPanel) ? (
        <section className="resource-grid">
          {createForm}
          {rightPanel}
        </section>
      ) : null}

      {isSuccess && items.length > 0 ? (
        <section className="resource-grid">
          <article className="panel panel--wide">
            <div className="panel__header">
              <div>
                <p className="eyebrow">{tableEyebrow}</p>
                <h2>{tableTitle}</h2>
              </div>
              <StatusBadge>{sourceLabel}</StatusBadge>
            </div>
            <DataTable caption={caption} columns={columns} rows={items.map(renderRow)} />
          </article>
          {rightPanel}
          {createForm}
        </section>
      ) : null}
    </section>
  )
}

export function SubmitButton({
  children,
  pending,
}: {
  children: ReactNode
  pending?: boolean
}) {
  return (
    <button type="submit" className="button button--primary" disabled={pending}>
      <Plus size={18} aria-hidden="true" />
      {children}
    </button>
  )
}
