import { useState, type FormEvent } from 'react'
import { KeyRound, Plus, Trash2 } from 'lucide-react'
import { useApiKeysPageData, useCreateApiKey, useRevokeApiKey } from '../shared/api/resourceHooks'
import type { ApiKeyStatus } from '../shared/api/types'
import { DataTable } from '../shared/components/DataTable'
import { EmptyState, ErrorState, LoadingState } from '../shared/components/DataState'
import { PageHeader } from '../shared/components/PageHeader'
import { FormError, ScreenForm, SubmitButton } from '../shared/components/ResourceScreen'
import { StatusBadge } from '../shared/components/StatusBadge'
import type { MetricTone } from '../shared/data/resourceMeta'
import { sectionSpecs } from '../shared/data/resourceMeta'
import { formatDateTime } from '../shared/utils/resourceFormat'

const statusTone: Record<ApiKeyStatus, MetricTone> = {
  active: 'good',
  expired: 'danger',
  expiring: 'watch',
  revoked: 'danger',
}

const scopeOptions = [
  { label: 'API key management', value: 'api_key:manage' },
  { label: 'Node management', value: 'node:manage' },
  { label: 'Subscription read', value: 'subscription:read' },
  { label: 'Subscription management', value: 'subscription:manage' },
  { label: 'User management', value: 'user:manage' },
  { label: 'License management', value: 'license:manage' },
]

const scopePresets = [
  {
    description: 'Create and revoke automation tokens only.',
    label: 'Telegram bot token admin',
    scopes: ['api_key:manage'],
  },
  {
    description: 'Read subscriptions and operate nodes without user management.',
    label: 'Node automation',
    scopes: ['node:manage', 'subscription:read'],
  },
  {
    description: 'Manage users and subscriptions for support workflows.',
    label: 'Support operator',
    scopes: ['subscription:read', 'subscription:manage', 'user:manage'],
  },
  {
    description: 'Full owner-equivalent automation for trusted internal jobs.',
    label: 'Full admin automation',
    scopes: scopeOptions.map((scope) => scope.value),
  },
]

const ttlOptions = [
  { label: '7 days', value: '7' },
  { label: '30 days', value: '30' },
  { label: '90 days', value: '90' },
  { label: '1 year', value: '365' },
  { label: 'No expiry', value: 'none' },
]

export function ApiKeysPage() {
  const spec = sectionSpecs.apiKeys
  const query = useApiKeysPageData()
  const createApiKey = useCreateApiKey()
  const revokeApiKey = useRevokeApiKey()
  const keys = query.data?.items ?? []
  const [name, setName] = useState('')
  const [selectedPreset, setSelectedPreset] = useState(scopePresets[0].label)
  const [selectedScopes, setSelectedScopes] = useState<string[]>(scopePresets[0].scopes)
  const [ttlDays, setTtlDays] = useState('90')
  const [oneTimeKey, setOneTimeKey] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  async function handleCreateApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setOneTimeKey(null)
    setCopyStatus(null)
    if (selectedScopes.length === 0) {
      setFormError('At least one scope is required.')
      return
    }
    try {
      const response = await createApiKey.mutateAsync({
        expires_at: expiryFromTtl(ttlDays),
        name: name.trim(),
        scopes: selectedScopes,
      })
      setOneTimeKey(response.api_key)
      setName('')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'API key could not be created.')
    }
  }

  function applyPreset(label: string) {
    setSelectedPreset(label)
    const preset = scopePresets.find((item) => item.label === label)
    if (preset) {
      setSelectedScopes(preset.scopes)
    }
  }

  function toggleScope(scope: string, enabled: boolean) {
    setSelectedPreset('Custom')
    setSelectedScopes((current) => {
      if (enabled) {
        return Array.from(new Set([...current, scope])).sort()
      }
      return current.filter((item) => item !== scope)
    })
  }

  async function copyOneTimeKey() {
    if (!oneTimeKey || !navigator.clipboard) {
      setCopyStatus('Clipboard is not available in this browser.')
      return
    }
    await navigator.clipboard.writeText(oneTimeKey)
    setCopyStatus('Copied.')
  }

  return (
    <section className="page">
      <PageHeader
        eyebrow={spec.eyebrow}
        title={spec.title}
        description="Scoped automation tokens. Stored values are hashed; a newly issued token is shown once."
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
                columns={['Name', 'Owner', 'Scopes', 'Prefix', 'Created', 'Expires', 'Last used', 'Status', 'Actions']}
                rows={keys.map((key) => ({
                  cells: [
                    key.name,
                    key.owner,
                    key.scopes.join(', '),
                    key.keyPrefix ?? key.fingerprint,
                    formatDateTime(key.createdAt),
                    key.expiresAt ? formatDateTime(key.expiresAt) : 'No expiry',
                    key.lastUsedAt ? formatDateTime(key.lastUsedAt) : 'Never',
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
              <p>Choose the smallest scope set that the automation needs. The token value appears once after creation.</p>
            </div>
            <label htmlFor="api-key-name">
              Name
              <input id="api-key-name" required value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label htmlFor="api-key-preset">
              Preset
              <select
                id="api-key-preset"
                value={selectedPreset}
                onChange={(event) => applyPreset(event.target.value)}
              >
                {scopePresets.map((preset) => (
                  <option key={preset.label} value={preset.label}>
                    {preset.label}
                  </option>
                ))}
                <option value="Custom">Custom</option>
              </select>
            </label>
            <p className="auth-card__note">
              {scopePresets.find((preset) => preset.label === selectedPreset)?.description ?? 'Custom scope set.'}
            </p>
            <div className="resource-list" aria-label="API key scopes">
              {scopeOptions.map((scope) => (
                <label className="checkbox-row" htmlFor={`api-key-scope-${scope.value}`} key={scope.value}>
                  <input
                    id={`api-key-scope-${scope.value}`}
                    type="checkbox"
                    checked={selectedScopes.includes(scope.value)}
                    onChange={(event) => toggleScope(scope.value, event.target.checked)}
                  />
                  <span>
                    {scope.label}
                    <small>{scope.value}</small>
                  </span>
                </label>
              ))}
            </div>
            <label htmlFor="api-key-ttl">
              Expiration
              <select id="api-key-ttl" value={ttlDays} onChange={(event) => setTtlDays(event.target.value)}>
                {ttlOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <FormError message={formError} />
            {oneTimeKey ? (
              <div className="auth-card__note" aria-live="polite">
                <p>
                  <KeyRound size={16} aria-hidden="true" /> Token created. Copy it now; it will not be shown again.
                </p>
                <code>{oneTimeKey}</code>
                <span className="inline-actions">
                  <button type="button" className="button button--secondary" onClick={() => void copyOneTimeKey()}>
                    Copy token
                  </button>
                  <button type="button" className="button button--secondary" onClick={() => setOneTimeKey(null)}>
                    Clear reveal
                  </button>
                </span>
                {copyStatus ? <small>{copyStatus}</small> : null}
              </div>
            ) : null}
            <SubmitButton pending={createApiKey.isPending}>Create key</SubmitButton>
          </ScreenForm>
        </section>
      ) : null}
    </section>
  )
}

function expiryFromTtl(ttlDays: string): string | null {
  if (ttlDays === 'none') {
    return null
  }
  const days = Number(ttlDays)
  if (!Number.isFinite(days) || days <= 0) {
    return null
  }
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}
