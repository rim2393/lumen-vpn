import { useState, type FormEvent } from 'react'
import { KeyRound, Plus, Trash2 } from 'lucide-react'
import { useApiKeysPageData, useCreateApiKey, useRevokeApiKey } from '../shared/api/resourceHooks'
import type { ApiKeyStatus } from '../shared/api/types'
import { DataTable } from '../shared/components/DataTable'
import { EmptyState, ErrorState, LoadingState } from '../shared/components/DataState'
import { PageHeader } from '../shared/components/PageHeader'
import { FormError, ScreenForm, SubmitButton } from '../shared/components/ResourceScreen'
import { StatusBadge } from '../shared/components/StatusBadge'
import type { MetricTone } from '../shared/data/lumenData'
import { sectionSpecs } from '../shared/data/lumenData'

const statusTone: Record<ApiKeyStatus, MetricTone> = {
  active: 'good',
  expiring: 'watch',
  revoked: 'danger',
}

export function ApiKeysPage() {
  const spec = sectionSpecs.apiKeys
  const query = useApiKeysPageData()
  const createApiKey = useCreateApiKey()
  const revokeApiKey = useRevokeApiKey()
  const keys = query.data?.items ?? []
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState('node:manage, subscription:read')
  const [oneTimeKey, setOneTimeKey] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  async function handleCreateApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setOneTimeKey(null)
    const parsedScopes = scopes
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean)
    if (parsedScopes.length === 0) {
      setFormError('At least one scope is required.')
      return
    }
    try {
      const response = await createApiKey.mutateAsync({
        expires_at: null,
        name: name.trim(),
        scopes: parsedScopes,
      })
      setOneTimeKey(response.api_key)
      setName('')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'API key could not be created.')
    }
  }

  return (
    <section className="page">
      <PageHeader
        eyebrow={spec.eyebrow}
        title={spec.title}
        description="Scoped token management with API-ready loading, error, and empty states. Secret values are never displayed."
        actions={
          <>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => document.getElementById('api-key-name')?.focus()}
            >
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
          description="Create a scoped automation key below. Secret values are shown once."
        />
      ) : null}
      {query.isSuccess ? (
        <section className="resource-grid">
          {keys.length > 0 ? (
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
                columns={['Name', 'Owner', 'Scopes', 'Fingerprint', 'Last used', 'Status', 'Actions']}
                rows={keys.map((key) => ({
                  cells: [
                    key.name,
                    key.owner,
                    key.scopes.join(', '),
                    key.fingerprint,
                    key.lastUsedAt ?? 'Never',
                    <StatusBadge tone={statusTone[key.status]}>{key.status}</StatusBadge>,
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Revoke ${key.name}`}
                      disabled={key.status === 'revoked' || revokeApiKey.isPending}
                      onClick={() => void revokeApiKey.mutateAsync(key.id)}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>,
                  ],
                  id: key.id,
                }))}
              />
            </article>
          ) : null}
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
          <ScreenForm onSubmit={handleCreateApiKey}>
            <div>
              <p className="eyebrow">Create token</p>
              <h2>One-time reveal</h2>
              <p>New values are shown once and never persisted by the UI.</p>
            </div>
            <label htmlFor="api-key-name">
              Name
              <input id="api-key-name" required value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label htmlFor="api-key-scopes">
              Scopes
              <input id="api-key-scopes" required value={scopes} onChange={(event) => setScopes(event.target.value)} />
            </label>
            <FormError message={formError} />
            {oneTimeKey ? (
              <p className="auth-card__note" aria-live="polite">
                <KeyRound size={16} aria-hidden="true" /> Token created. Copy it now: {oneTimeKey}
              </p>
            ) : null}
            <SubmitButton pending={createApiKey.isPending}>Create key</SubmitButton>
          </ScreenForm>
        </section>
      ) : null}
    </section>
  )
}
