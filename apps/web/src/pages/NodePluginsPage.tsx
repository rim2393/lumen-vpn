import { useState, type FormEvent } from 'react'
import { Ban, CheckCircle2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import {
  useCreateNodePlugin,
  useDeleteNodePlugin,
  useNodePluginsData,
  useNodesPageData,
  useUpdateNodePlugin,
} from '../shared/api/resourceHooks'
import { EmptyState, ErrorState, LoadingState } from '../shared/components/DataState'
import { DataTable } from '../shared/components/DataTable'
import { PageHeader } from '../shared/components/PageHeader'
import { StatusBadge } from '../shared/components/StatusBadge'
import { useI18n } from '../shared/i18n/I18nProvider'

const KIND_OPTIONS = ['torrent-blocker', 'geoip-filter', 'domain-filter']

export function NodePluginsPage() {
  const { t } = useI18n()
  const pluginsQuery = useNodePluginsData()
  const nodesQuery = useNodesPageData()
  const createPlugin = useCreateNodePlugin()
  const updatePlugin = useUpdateNodePlugin()
  const deletePlugin = useDeleteNodePlugin()

  const plugins = pluginsQuery.data?.items ?? []
  const nodes = nodesQuery.data?.items ?? []

  const [name, setName] = useState('')
  const [kind, setKind] = useState(KIND_OPTIONS[0])
  const [nodeId, setNodeId] = useState('')
  const [configText, setConfigText] = useState('{}')
  const [formError, setFormError] = useState<string | null>(null)

  const isMutating = createPlugin.isPending || updatePlugin.isPending || deletePlugin.isPending

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    let config: Record<string, unknown> = {}
    try {
      const parsed = configText.trim() ? JSON.parse(configText) : {}
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Config must be a JSON object.')
      }
      config = parsed as Record<string, unknown>
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Invalid JSON config.')
      return
    }
    try {
      await createPlugin.mutateAsync({
        name,
        kind,
        node_id: nodeId || null,
        config_json: config,
      })
      setName('')
      setConfigText('{}')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not create plugin.')
    }
  }

  const nodeNameFor = (id: string | null) =>
    id ? nodes.find((node) => node.id === id)?.name ?? id : t('All nodes')

  return (
    <section className="page">
      <PageHeader
        eyebrow="Traffic policy"
        title="Node plugins"
        description="Manage traffic-filtering plugins applied per node or globally across the fleet."
        actions={
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void pluginsQuery.refetch()}
          >
            <RefreshCw size={18} aria-hidden="true" />
            {t('Refresh')}
          </button>
        }
      />

      {pluginsQuery.isLoading ? <LoadingState label="Loading node plugins..." /> : null}
      {pluginsQuery.error ? (
        <ErrorState title="Node plugins unavailable" error={pluginsQuery.error} />
      ) : null}

      {!pluginsQuery.isLoading && !pluginsQuery.error ? (
        <section className="resource-layout">
          <article className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">{t('Inventory')}</p>
                <h2>{t('Node plugins')}</h2>
              </div>
              <StatusBadge tone={plugins.length > 0 ? 'good' : 'neutral'}>
                {t('Total: {count}', { count: plugins.length })}
              </StatusBadge>
            </div>
            {plugins.length === 0 ? (
              <EmptyState
                title="No plugins yet"
                description="Create a plugin to filter or shape traffic on a node."
              />
            ) : (
              <DataTable
                caption="Node plugins"
                columns={[
                  t('Name'),
                  t('Kind'),
                  t('Node'),
                  t('Status'),
                  t('Actions'),
                ]}
                rows={plugins.map((plugin) => ({
                  id: plugin.id,
                  cells: [
                    plugin.name,
                    plugin.kind,
                    nodeNameFor(plugin.node_id),
                    <StatusBadge key="s" tone={plugin.enabled ? 'good' : 'neutral'}>
                      {plugin.enabled ? t('enabled') : t('disabled')}
                    </StatusBadge>,
                    <div key="a" className="inline-actions inline-actions--compact">
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={isMutating}
                        onClick={() =>
                          void updatePlugin.mutateAsync({
                            id: plugin.id,
                            request: { enabled: !plugin.enabled },
                          })
                        }
                      >
                        {plugin.enabled ? (
                          <>
                            <Ban size={16} aria-hidden="true" /> {t('Disable')}
                          </>
                        ) : (
                          <>
                            <CheckCircle2 size={16} aria-hidden="true" /> {t('Enable')}
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={isMutating}
                        onClick={() => void deletePlugin.mutateAsync(plugin.id)}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                        {t('Delete')}
                      </button>
                    </div>,
                  ],
                }))}
              />
            )}
          </article>

          <form className="auth-card auth-card--wide" onSubmit={handleSubmit}>
            <div>
              <p className="eyebrow">{t('Create plugin')}</p>
              <h2>{t('Create plugin')}</h2>
            </div>
            <label htmlFor="plugin-name">
              {t('Name')}
              <input
                id="plugin-name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label htmlFor="plugin-kind">
              {t('Kind')}
              <select id="plugin-kind" value={kind} onChange={(event) => setKind(event.target.value)}>
                {KIND_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="plugin-node">
              {t('Node')}
              <select
                id="plugin-node"
                value={nodeId}
                onChange={(event) => setNodeId(event.target.value)}
              >
                <option value="">{t('All nodes')}</option>
                {nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="plugin-config">
              {t('Config (JSON)')}
              <textarea
                id="plugin-config"
                rows={6}
                value={configText}
                onChange={(event) => setConfigText(event.target.value)}
              />
            </label>
            {formError ? <p className="auth-card__error">{formError}</p> : null}
            <button type="submit" className="button button--primary" disabled={isMutating}>
              <Plus size={18} aria-hidden="true" />
              {t('Create plugin')}
            </button>
          </form>
        </section>
      ) : null}
    </section>
  )
}
