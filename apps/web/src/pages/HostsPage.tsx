import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Ban, Save, Trash2 } from 'lucide-react'
import {
  useBulkHosts,
  useCreateHost,
  useDeleteHost,
  useHostsPageData,
  useNodesPageData,
  useProfilesPageData,
  useReorderHosts,
  useSquadsPageData,
  useUpdateHost,
} from '../shared/api/resourceHooks'
import type { HostRecord, HostUpdateRequest } from '../shared/api/types'
import {
  FormError,
  ResourceScreen,
  ScreenForm,
  SubmitButton,
} from '../shared/components/ResourceScreen'
import { OperatorGuide } from '../shared/components/OperatorGuide'
import { StatusBadge } from '../shared/components/StatusBadge'
import { sectionSpecs } from '../shared/data/resourceMeta'
import { useI18n } from '../shared/i18n/I18nProvider'
import { toneForStatus } from '../shared/utils/resourceFormat'

export function HostsPage() {
  const { t } = useI18n()
  const query = useHostsPageData()
  const nodesQuery = useNodesPageData()
  const profilesQuery = useProfilesPageData()
  const squadsQuery = useSquadsPageData()
  const createHost = useCreateHost()
  const updateHost = useUpdateHost()
  const deleteHost = useDeleteHost()
  const bulkHosts = useBulkHosts()
  const reorderHosts = useReorderHosts()
  const hosts = query.data?.items ?? []
  const nodes = nodesQuery.data?.items ?? []
  const profiles = profilesQuery.data?.items ?? []
  const squads = squadsQuery.data?.items ?? []
  const [name, setName] = useState('')
  const [hostname, setHostname] = useState('')
  const [nodeId, setNodeId] = useState('')
  const [profileId, setProfileId] = useState('')
  const [squadId, setSquadId] = useState('')
  const [tags, setTags] = useState('auto-wifi')
  const [formError, setFormError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedHostId, setSelectedHostId] = useState('')
  const selectedHost = useMemo(
    () => hosts.find((host) => host.id === selectedHostId) ?? hosts[0],
    [hosts, selectedHostId],
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    try {
      await createHost.mutateAsync({
        hostname: hostname.trim(),
        name: name.trim(),
        node_id: nodeId || nodes[0]?.id || '',
        protocol_profile_id: profileId || null,
        squad_id: squadId || null,
        status: 'active',
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      })
      setName('')
      setHostname('')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Host could not be created.')
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  async function runBulk(action: string, extra: Omit<Parameters<typeof bulkHosts.mutateAsync>[0]['request'], 'ids'> = {}) {
    if (selectedIds.size === 0) {
      setFormError('Select at least one host first.')
      return
    }
    await bulkHosts.mutateAsync({
      action,
      request: { ids: Array.from(selectedIds), ...extra },
    })
    if (action === 'delete') {
      setSelectedIds(new Set())
    }
  }

  return (
    <ResourceScreen
      caption="Host inventory"
      columns={['Select', 'Name', 'Hostname', 'Node', 'Profile', 'Squad', 'Endpoint', 'Tags', 'Status', 'Actions']}
      createForm={
        <ScreenForm onSubmit={handleSubmit}>
          <div>
            <p className="eyebrow">{t('Add host')}</p>
            <h2>{t('Ingress mapping')}</h2>
            <p>{t('Bind a public hostname to node/profile/squad routing metadata.')}</p>
          </div>
          <label htmlFor="host-name">
            {t('Name')}
            <input id="host-name" required value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label htmlFor="host-hostname">
            {t('Hostname')}
            <input id="host-hostname" required value={hostname} onChange={(event) => setHostname(event.target.value)} />
          </label>
          <label htmlFor="host-node">
            {t('Node')}
            <select id="host-node" required value={nodeId} onChange={(event) => setNodeId(event.target.value)}>
              <option value="">{t('Select node')}</option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="host-profile">
            {t('Profile')}
            <select id="host-profile" value={profileId} onChange={(event) => setProfileId(event.target.value)}>
              <option value="">{t('None')}</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="host-squad">
            {t('Squad')}
            <select id="host-squad" value={squadId} onChange={(event) => setSquadId(event.target.value)}>
              <option value="">{t('None')}</option>
              {squads.map((squad) => (
                <option key={squad.id} value={squad.id}>
                  {squad.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="host-tags">
            {t('Tags')}
            <input id="host-tags" value={tags} onChange={(event) => setTags(event.target.value)} />
          </label>
          <FormError message={formError} />
          <SubmitButton pending={createHost.isPending}>{t('Add host')}</SubmitButton>
        </ScreenForm>
      }
      emptyDescription="Hosts appear here after domain mappings are created."
      emptyTitle="No hosts configured"
      error={query.error}
      errorTitle="Hosts unavailable"
      isError={query.isError}
      isLoading={query.isLoading}
      isSuccess={query.isSuccess}
      items={hosts}
      loadingLabel="Loading hosts..."
      onRefresh={() => void query.refetch()}
      renderRow={(host) => ({
        cells: [
          <input
            aria-label={`Select ${host.name}`}
            checked={selectedIds.has(host.id)}
            type="checkbox"
            onChange={() => toggleSelected(host.id)}
          />,
          host.name,
          host.hostname,
          nodes.find((node) => node.id === host.node_id)?.name ?? host.node_id,
          profiles.find((profile) => profile.id === host.protocol_profile_id)?.name ?? 'None',
          squads.find((squad) => squad.id === host.squad_id)?.name ?? 'None',
          `${host.address ?? host.hostname}${host.port ? `:${host.port}` : ''}`,
          host.tags.join(', ') || 'None',
          <StatusBadge tone={toneForStatus(host.status)}>{host.status}</StatusBadge>,
          <div className="inline-actions">
            <button
              type="button"
              className="icon-button"
              aria-label={`Edit ${host.name}`}
              onClick={() => setSelectedHostId(host.id)}
            >
              <Save size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`${host.status === 'active' ? 'Disable' : 'Enable'} ${host.name}`}
              onClick={() =>
                void updateHost.mutateAsync({
                  id: host.id,
                  request: { status: host.status === 'active' ? 'disabled' : 'active' },
                })
              }
            >
              <Ban size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Delete ${host.name}`}
              onClick={() => void deleteHost.mutateAsync(host.id)}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>,
        ],
        id: host.id,
      })}
      rightPanel={
        <div className="side-stack">
          <HostBulkPanel
            onBulk={runBulk}
            onReorder={() => void reorderHosts.mutateAsync(hosts.map((host) => host.id).reverse())}
            selectedCount={selectedIds.size}
          />
          <HostEditor
            host={selectedHost}
            nodes={nodes}
            onSave={async (hostId, request) => {
              await updateHost.mutateAsync({ id: hostId, request })
              await query.refetch()
            }}
            pending={updateHost.isPending}
            profiles={profiles}
            squads={squads}
          />
          <OperatorGuide
            title="Host workflow"
            steps={[
              { detail: 'Point DNS to the node address before exposing the host to users.', label: 'Check DNS' },
              { detail: 'Attach the host to the profile that owns protocol and port settings.', label: 'Attach profile', to: '/profiles' },
              { detail: 'Use tags for client-facing grouping, filters, and routing rules.', label: 'Add tags' },
              { detail: 'Open subscriptions after the host is active and verify the public links.', label: 'Verify subscription', to: '/subscription' },
            ]}
          />
        </div>
      }
      spec={sectionSpecs.hosts}
      tableEyebrow="Ingress hosts"
      tableTitle="Host routing"
    />
  )
}

function HostBulkPanel({
  onBulk,
  onReorder,
  selectedCount,
}: {
  onBulk: (action: string, extra?: { inbound_tag?: string; port?: number }) => Promise<void>
  onReorder: () => void
  selectedCount: number
}) {
  const { t } = useI18n()
  const [inboundTag, setInboundTag] = useState('DEFAULT_INBOUND')
  const [port, setPort] = useState('443')
  const parsedPort = Number(port)

  return (
    <article className="panel">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{t('Bulk host actions')}</p>
          <h2>{t('{count} selected', { count: selectedCount })}</h2>
        </div>
      </div>
      <div className="inline-actions">
        <button type="button" className="button button--secondary" onClick={() => void onBulk('enable')}>
          {t('Enable')}
        </button>
        <button type="button" className="button button--secondary" onClick={() => void onBulk('disable')}>
          {t('Disable')}
        </button>
        <button type="button" className="button button--secondary" onClick={() => void onBulk('delete')}>
          {t('Delete')}
        </button>
        <button type="button" className="button button--secondary" onClick={onReorder}>
          {t('Reverse order')}
        </button>
      </div>
      <label htmlFor="bulk-inbound-tag">
        inbound_tag
        <input id="bulk-inbound-tag" value={inboundTag} onChange={(event) => setInboundTag(event.target.value)} />
      </label>
      <button type="button" className="button button--secondary" onClick={() => void onBulk('set-inbound', { inbound_tag: inboundTag })}>
        {t('Set inbound')}
      </button>
      <label htmlFor="bulk-port">
        {t('Port')}
        <input id="bulk-port" inputMode="numeric" value={port} onChange={(event) => setPort(event.target.value)} />
      </label>
      <button
        type="button"
        className="button button--secondary"
        disabled={!Number.isInteger(parsedPort)}
        onClick={() => void onBulk('set-port', { port: parsedPort })}
      >
        {t('Set port')}
      </button>
    </article>
  )
}

function HostEditor({
  host,
  nodes,
  onSave,
  pending,
  profiles,
  squads,
}: {
  host: HostRecord | undefined
  nodes: Array<{ id: string; name: string }>
  onSave: (hostId: string, request: HostUpdateRequest) => Promise<void>
  pending: boolean
  profiles: Array<{ id: string; name: string }>
  squads: Array<{ id: string; name: string }>
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<HostUpdateRequest>({})
  const [metadataJson, setMetadataJson] = useState('{}')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!host) {
      setDraft({})
      setMetadataJson('{}')
      return
    }
    setDraft({
      address: host.address,
      hostname: host.hostname,
      inbound_tag: host.inbound_tag,
      name: host.name,
      node_id: host.node_id,
      port: host.port,
      protocol_profile_id: host.protocol_profile_id,
      remark: host.remark,
      squad_id: host.squad_id,
      status: host.status,
      tags: host.tags,
    })
    setMetadataJson(JSON.stringify(host.metadata_json, null, 2))
  }, [host])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (!host) {
      return
    }
    try {
      await onSave(host.id, {
        ...draft,
        metadata_json: parseMetadata(metadataJson),
        port: draft.port === null || draft.port === undefined ? null : Number(draft.port),
        tags: draft.tags ?? [],
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Host could not be saved.')
    }
  }

  return (
    <ScreenForm onSubmit={handleSubmit}>
      <div>
        <p className="eyebrow">{t('Host editor')}</p>
        <h2>{host?.name ?? t('Select host')}</h2>
        <p>{t('Edit public endpoint, routing bindings, inbound tag, port and metadata.')}</p>
      </div>
      <label htmlFor="editor-host-name">
        Name
        <input id="editor-host-name" value={draft.name ?? ''} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      </label>
      <label htmlFor="editor-host-hostname">
        Hostname
        <input id="editor-host-hostname" value={draft.hostname ?? ''} onChange={(event) => setDraft({ ...draft, hostname: event.target.value })} />
      </label>
      <label htmlFor="editor-host-node">
        Node
        <select id="editor-host-node" value={draft.node_id ?? ''} onChange={(event) => setDraft({ ...draft, node_id: event.target.value })}>
          {nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
        </select>
      </label>
      <label htmlFor="editor-host-profile">
        Profile
        <select id="editor-host-profile" value={draft.protocol_profile_id ?? ''} onChange={(event) => setDraft({ ...draft, protocol_profile_id: event.target.value || null })}>
          <option value="">None</option>
          {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select>
      </label>
      <label htmlFor="editor-host-squad">
        Squad
        <select id="editor-host-squad" value={draft.squad_id ?? ''} onChange={(event) => setDraft({ ...draft, squad_id: event.target.value || null })}>
          <option value="">None</option>
          {squads.map((squad) => <option key={squad.id} value={squad.id}>{squad.name}</option>)}
        </select>
      </label>
      <label htmlFor="editor-host-address">
        Address
        <input id="editor-host-address" value={draft.address ?? ''} onChange={(event) => setDraft({ ...draft, address: event.target.value || null })} />
      </label>
      <label htmlFor="editor-host-port">
        Port
        <input id="editor-host-port" inputMode="numeric" value={draft.port ?? ''} onChange={(event) => setDraft({ ...draft, port: event.target.value ? Number(event.target.value) : null })} />
      </label>
      <label htmlFor="editor-host-inbound">
        inbound_tag
        <input id="editor-host-inbound" value={draft.inbound_tag ?? ''} onChange={(event) => setDraft({ ...draft, inbound_tag: event.target.value || null })} />
      </label>
      <label htmlFor="editor-host-remark">
        Remark
        <input id="editor-host-remark" value={draft.remark ?? ''} onChange={(event) => setDraft({ ...draft, remark: event.target.value || null })} />
      </label>
      <label htmlFor="editor-host-tags">
        Tags
        <input
          id="editor-host-tags"
          value={(draft.tags ?? []).join(', ')}
          onChange={(event) => setDraft({ ...draft, tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })}
        />
      </label>
      <label htmlFor="editor-host-metadata">
        metadata_json
        <textarea id="editor-host-metadata" rows={5} value={metadataJson} onChange={(event) => setMetadataJson(event.target.value)} />
      </label>
      <FormError message={error} />
      <SubmitButton pending={pending || !host}>Save host</SubmitButton>
    </ScreenForm>
  )
}

function parseMetadata(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value || '{}')
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('metadata_json must be a JSON object.')
  }
  return parsed as Record<string, unknown>
}
