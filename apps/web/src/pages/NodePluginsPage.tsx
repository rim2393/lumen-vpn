import { useMemo, useState, type FormEvent } from 'react'
import {
  Ban,
  CheckCircle2,
  Copy,
  Play,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  ArrowDown,
  ArrowUp,
} from 'lucide-react'
import {
  useApplyNodePlugins,
  useCloneNodePlugin,
  useCreateNodePlugin,
  useDeleteNodePlugin,
  useNodePluginsData,
  useNodesPageData,
  useReorderNodePlugins,
  useUpdateNodePlugin,
} from '../shared/api/resourceHooks'
import type { NodePluginRecord } from '../shared/api/types'
import { EmptyState, ErrorState, LoadingState } from '../shared/components/DataState'
import { DataTable } from '../shared/components/DataTable'
import { PageHeader } from '../shared/components/PageHeader'
import { StatusBadge } from '../shared/components/StatusBadge'
import { useI18n } from '../shared/i18n/I18nProvider'

const KIND_OPTIONS = ['torrent-blocker', 'geoip-filter', 'domain-filter']

type PluginFormState = {
  configText: string
  enabled: boolean
  kind: string
  name: string
  nodeId: string
  sortOrder: string
}

const emptyForm: PluginFormState = {
  configText: '{}',
  enabled: true,
  kind: KIND_OPTIONS[0],
  name: '',
  nodeId: '',
  sortOrder: '0',
}

function pluginToForm(plugin: NodePluginRecord): PluginFormState {
  return {
    configText: JSON.stringify(plugin.config_json ?? {}, null, 2),
    enabled: plugin.enabled,
    kind: plugin.kind,
    name: plugin.name,
    nodeId: plugin.node_id ?? '',
    sortOrder: String(plugin.sort_order),
  }
}

function parseConfig(configText: string) {
  const parsed = configText.trim() ? JSON.parse(configText) : {}
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Config must be a JSON object.')
  }
  return parsed as Record<string, unknown>
}

function sortPlugins(plugins: NodePluginRecord[]) {
  return [...plugins].sort((left, right) => {
    if (left.sort_order !== right.sort_order) {
      return left.sort_order - right.sort_order
    }
    return left.name.localeCompare(right.name)
  })
}

export function NodePluginsPage() {
  const { t } = useI18n()
  const pluginsQuery = useNodePluginsData()
  const nodesQuery = useNodesPageData()
  const applyPlugins = useApplyNodePlugins()
  const clonePlugin = useCloneNodePlugin()
  const createPlugin = useCreateNodePlugin()
  const deletePlugin = useDeleteNodePlugin()
  const reorderPlugins = useReorderNodePlugins()
  const updatePlugin = useUpdateNodePlugin()

  const plugins = useMemo(() => sortPlugins(pluginsQuery.data?.items ?? []), [pluginsQuery.data?.items])
  const nodes = nodesQuery.data?.items ?? []
  const [form, setForm] = useState<PluginFormState>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [applyNodeId, setApplyNodeId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [actionResult, setActionResult] = useState<string | null>(null)

  const isMutating =
    applyPlugins.isPending ||
    clonePlugin.isPending ||
    createPlugin.isPending ||
    deletePlugin.isPending ||
    reorderPlugins.isPending ||
    updatePlugin.isPending

  const selectedPlugin = editingId
    ? plugins.find((plugin) => plugin.id === editingId) ?? null
    : null
  const nextSortOrder =
    plugins.length === 0 ? 0 : Math.max(...plugins.map((plugin) => plugin.sort_order)) + 10

  function nodeNameFor(id: string | null) {
    return id ? nodes.find((node) => node.id === id)?.name ?? id : t('All nodes')
  }

  function resetForm() {
    setEditingId(null)
    setForm({ ...emptyForm, sortOrder: String(nextSortOrder) })
    setFormError(null)
  }

  function editPlugin(plugin: NodePluginRecord) {
    setEditingId(plugin.id)
    setForm(pluginToForm(plugin))
    setFormError(null)
  }

  async function submitPlugin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setActionResult(null)
    let config: Record<string, unknown>
    try {
      config = parseConfig(form.configText)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('Invalid JSON config.'))
      return
    }

    const sortOrder = Number.parseInt(form.sortOrder, 10)
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      setFormError(t('Sort order must be a non-negative integer.'))
      return
    }

    const request = {
      config_json: config,
      enabled: form.enabled,
      kind: form.kind,
      name: form.name,
      node_id: form.nodeId || null,
      sort_order: sortOrder,
    }

    try {
      if (editingId) {
        const updated = await updatePlugin.mutateAsync({ id: editingId, request })
        setActionResult(t('Node plugin saved: {name}', { name: updated.name }))
      } else {
        const created = await createPlugin.mutateAsync(request)
        setActionResult(t('Node plugin created: {name}', { name: created.name }))
        setEditingId(created.id)
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('Could not save plugin.'))
    }
  }

  async function cloneCurrentPlugin() {
    if (!selectedPlugin) {
      return
    }
    setFormError(null)
    const cloned = await clonePlugin.mutateAsync({
      id: selectedPlugin.id,
      request: { name: `${selectedPlugin.name} copy`, node_id: selectedPlugin.node_id },
    })
    setActionResult(t('Node plugin cloned: {name}', { name: cloned.name }))
    setEditingId(cloned.id)
    setForm(pluginToForm(cloned))
  }

  async function movePlugin(plugin: NodePluginRecord, direction: -1 | 1) {
    const index = plugins.findIndex((item) => item.id === plugin.id)
    const target = plugins[index + direction]
    if (!target) {
      return
    }
    await reorderPlugins.mutateAsync({
      items: [
        { id: plugin.id, sort_order: target.sort_order },
        { id: target.id, sort_order: plugin.sort_order },
      ],
    })
    setActionResult(t('Node plugin order saved.'))
  }

  async function applyPolicy() {
    if (!applyNodeId) {
      setFormError(t('Select a node before applying plugin policy.'))
      return
    }
    setFormError(null)
    const command = await applyPlugins.mutateAsync({
      node_id: applyNodeId,
      reason: 'operator applied node plugin policy',
    })
    setActionResult(
      t('Plugin policy command queued: {command}', {
        command: `${command.command_type} ${command.id}`,
      }),
    )
  }

  return (
    <section className="page">
      <PageHeader
        eyebrow={t('Traffic policy')}
        title={t('Node plugins')}
        description={t(
          'Manage traffic-filtering plugins applied per node or globally across the fleet.',
        )}
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

      {pluginsQuery.isLoading ? <LoadingState label={t('Loading node plugins...')} /> : null}
      {pluginsQuery.error ? (
        <ErrorState title={t('Node plugins unavailable')} error={pluginsQuery.error} />
      ) : null}

      {actionResult ? (
        <article className="panel" aria-live="polite">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{t('Action result')}</p>
              <h2>{t('Node plugins')}</h2>
            </div>
            <StatusBadge tone="good">{t('queued')}</StatusBadge>
          </div>
          <p>{actionResult}</p>
        </article>
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
                title={t('No plugins yet')}
                description={t('Create a plugin to filter or shape traffic on a node.')}
              />
            ) : (
              <DataTable
                caption={t('Node plugins')}
                columns={[
                  t('Order'),
                  t('Name'),
                  t('Kind'),
                  t('Node'),
                  t('Status'),
                  t('Actions'),
                ]}
                rows={plugins.map((plugin, index) => ({
                  id: plugin.id,
                  cells: [
                    plugin.sort_order,
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
                        onClick={() => editPlugin(plugin)}
                      >
                        {t('Edit')}
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={isMutating || index === 0}
                        onClick={() => void movePlugin(plugin, -1)}
                      >
                        <ArrowUp size={16} aria-hidden="true" />
                        {t('Up')}
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={isMutating || index === plugins.length - 1}
                        onClick={() => void movePlugin(plugin, 1)}
                      >
                        <ArrowDown size={16} aria-hidden="true" />
                        {t('Down')}
                      </button>
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
                        onClick={() => {
                          if (globalThis.confirm(t('Delete node plugin confirmation'))) {
                            void deletePlugin.mutateAsync(plugin.id)
                          }
                        }}
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

          <form className="auth-card auth-card--wide" onSubmit={submitPlugin}>
            <div>
              <p className="eyebrow">{editingId ? t('Edit plugin') : t('Create plugin')}</p>
              <h2>{editingId ? selectedPlugin?.name ?? t('Edit plugin') : t('Create plugin')}</h2>
            </div>
            <label htmlFor="plugin-name">
              {t('Name')}
              <input
                id="plugin-name"
                required
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
            </label>
            <label htmlFor="plugin-kind">
              {t('Kind')}
              <select
                id="plugin-kind"
                value={form.kind}
                onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value }))}
              >
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
                value={form.nodeId}
                onChange={(event) => setForm((current) => ({ ...current, nodeId: event.target.value }))}
              >
                <option value="">{t('All nodes')}</option>
                {nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="plugin-sort-order">
              {t('Order')}
              <input
                id="plugin-sort-order"
                inputMode="numeric"
                required
                value={form.sortOrder}
                onChange={(event) =>
                  setForm((current) => ({ ...current, sortOrder: event.target.value }))
                }
              />
            </label>
            <label className="checkbox-field" htmlFor="plugin-enabled">
              <input
                id="plugin-enabled"
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
              />
              {t('Enabled')}
            </label>
            <label htmlFor="plugin-config">
              {t('Config (JSON)')}
              <textarea
                id="plugin-config"
                rows={8}
                value={form.configText}
                onChange={(event) =>
                  setForm((current) => ({ ...current, configText: event.target.value }))
                }
              />
            </label>
            {formError ? <p className="auth-card__error">{formError}</p> : null}
            <div className="inline-actions">
              <button type="submit" className="button button--primary" disabled={isMutating}>
                <Save size={18} aria-hidden="true" />
                {editingId ? t('Save plugin') : t('Create plugin')}
              </button>
              <button
                type="button"
                className="button button--secondary"
                disabled={!selectedPlugin || isMutating}
                onClick={() => void cloneCurrentPlugin()}
              >
                <Copy size={18} aria-hidden="true" />
                {t('Clone')}
              </button>
              <button type="button" className="button button--secondary" onClick={resetForm}>
                <Plus size={18} aria-hidden="true" />
                {t('New plugin')}
              </button>
            </div>
          </form>

          <article className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">{t('Executor')}</p>
                <h2>{t('Apply node policy')}</h2>
              </div>
              <StatusBadge>{t('real command')}</StatusBadge>
            </div>
            <p>
              {t(
                'Queues firewall.plan.apply with the current effective plugin policy for the selected node.',
              )}
            </p>
            <label htmlFor="plugin-apply-node">
              {t('Node')}
              <select
                id="plugin-apply-node"
                value={applyNodeId}
                onChange={(event) => setApplyNodeId(event.target.value)}
              >
                <option value="">{t('Select node')}</option>
                {nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button button--primary"
              disabled={isMutating || !applyNodeId}
              onClick={() => void applyPolicy()}
            >
              <Play size={18} aria-hidden="true" />
              {t('Apply policy')}
            </button>
          </article>
        </section>
      ) : null}
    </section>
  )
}
