import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Ban, Save, Send, Trash2 } from 'lucide-react'
import {
  useApplyProfileToNode,
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
  const applyProfileToNode = useApplyProfileToNode()
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
  const [path, setPath] = useState('')
  const [sni, setSni] = useState('')
  const [security, setSecurity] = useState('')
  const [hidden, setHidden] = useState(false)
  const [subscriptionExcluded, setSubscriptionExcluded] = useState(false)
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
      const selectedNodeId = nodeId || nodes[0]?.id || ''
      if (!selectedNodeId) {
        throw new Error(t('Select a node before creating a host.'))
      }
      await createHost.mutateAsync({
        hostname: hostname.trim(),
        name: name.trim(),
        node_id: selectedNodeId,
        protocol_profile_id: profileId || null,
        squad_id: squadId || null,
        status: 'active',
        hidden,
        path: path.trim() || null,
        security: security || null,
        sni: sni.trim() || null,
        subscription_excluded: subscriptionExcluded,
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      })
      setName('')
      setHostname('')
      setPath('')
      setSni('')
      setSecurity('')
      setHidden(false)
      setSubscriptionExcluded(false)
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
      setFormError(t('Select at least one host first.'))
      return
    }
    setFormError(null)
    try {
      await bulkHosts.mutateAsync({
        action,
        request: { ids: Array.from(selectedIds), ...extra },
      })
      if (action === 'delete') {
        setSelectedIds(new Set())
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('Host bulk action failed.'))
    }
  }

  return (
    <ResourceScreen
      caption="Host inventory"
      columns={['Select', 'Name', 'Hostname', 'Node', 'Profile', 'Squad', 'Endpoint', 'Tags', 'Runtime', 'Status', 'Actions']}
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
          <label htmlFor="host-path">
            {t('Path')}
            <input id="host-path" placeholder="/grpc, /ws, /xhttp" value={path} onChange={(event) => setPath(event.target.value)} />
          </label>
          <label htmlFor="host-sni">
            {t('SNI')}
            <input id="host-sni" value={sni} onChange={(event) => setSni(event.target.value)} />
          </label>
          <label htmlFor="host-security">
            {t('Security')}
            <select id="host-security" value={security} onChange={(event) => setSecurity(event.target.value)}>
              <option value="">{t('Profile default')}</option>
              <option value="none">none</option>
              <option value="tls">tls</option>
              <option value="reality">reality</option>
            </select>
          </label>
          <label className="checkbox-line" htmlFor="host-hidden">
            <input id="host-hidden" type="checkbox" checked={hidden} onChange={(event) => setHidden(event.target.checked)} />
            {t('Hidden from operators')}
          </label>
          <label className="checkbox-line" htmlFor="host-subscription-excluded">
            <input
              id="host-subscription-excluded"
              type="checkbox"
              checked={subscriptionExcluded}
              onChange={(event) => setSubscriptionExcluded(event.target.checked)}
            />
            {t('Exclude from subscriptions')}
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
          `${host.address ?? host.hostname}${host.port ? `:${host.port}` : ''}${host.path ?? ''}`,
          host.tags.join(', ') || 'None',
          <RuntimeSyncBadge status={runtimeSyncStatus(host)} />,
          <StatusBadge tone={toneForStatus(host.status)}>{host.status}</StatusBadge>,
          <div className="inline-actions">
            <HostActionTooltip
              text={t('Open host editor: DNS, node binding, profile, squad, port, SNI, masks, and JSON metadata.')}
            >
              <button
                type="button"
                className="icon-button"
                aria-label={t('Edit {name}', { name: host.name })}
                onClick={() => setSelectedHostId(host.id)}
              >
                <Save size={16} aria-hidden="true" />
              </button>
            </HostActionTooltip>
            <HostActionTooltip
              text={
                host.protocol_profile_id
                  ? t('Apply this host profile to the node runtime. The backend will enqueue a real node-agent command.')
                  : t('Attach a protocol profile first, then this action can apply the host runtime to the node.')
              }
            >
              <button
                type="button"
                className="icon-button"
                disabled={!host.protocol_profile_id || applyProfileToNode.isPending}
                aria-label={t('Apply {name} to node', { name: host.name })}
                onClick={() => host.protocol_profile_id && void applyProfileToNode.mutateAsync(host.protocol_profile_id)}
              >
                <Send size={16} aria-hidden="true" />
              </button>
            </HostActionTooltip>
            <HostActionTooltip
              text={
                host.status === 'active'
                  ? t('Disable the host. It stops being used in active routes and generated subscriptions.')
                  : t('Enable the host. It becomes available again for routes and generated subscriptions.')
              }
            >
              <button
                type="button"
                className="icon-button"
                aria-label={
                  host.status === 'active'
                    ? t('Disable {name}', { name: host.name })
                    : t('Enable {name}', { name: host.name })
                }
                onClick={() =>
                  void updateHost.mutateAsync({
                    id: host.id,
                    request: { status: host.status === 'active' ? 'disabled' : 'active' },
                  })
                }
              >
                <Ban size={16} aria-hidden="true" />
              </button>
            </HostActionTooltip>
            <HostActionTooltip
              text={t('Delete this host from the panel. Runtime must be resynchronized after removal.')}
            >
              <button
                type="button"
                className="icon-button"
                aria-label={t('Delete {name}', { name: host.name })}
                onClick={() => void deleteHost.mutateAsync(host.id)}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </HostActionTooltip>
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

function HostActionTooltip({ children, text }: { children: ReactNode; text: string }) {
  return (
    <span className="host-action-tooltip" data-tooltip={text}>
      {children}
    </span>
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
  const isValidPort = isValidHostPort(parsedPort)

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
        disabled={!isValidPort}
        onClick={() => void onBulk('set-port', { port: parsedPort })}
      >
        {t('Set port')}
      </button>
      {!isValidPort ? <p className="auth-card__note">{t('Port must be an integer between 1 and 65535.')}</p> : null}
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
  const [xrayTemplateJson, setXrayTemplateJson] = useState('{}')
  const [muxJson, setMuxJson] = useState('{}')
  const [sockoptJson, setSockoptJson] = useState('{}')
  const [xhttpJson, setXhttpJson] = useState('{}')
  const [excludedSquads, setExcludedSquads] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!host) {
      setDraft({})
      setMetadataJson('{}')
      setXrayTemplateJson('{}')
      setMuxJson('{}')
      setSockoptJson('{}')
      setXhttpJson('{}')
      setExcludedSquads('')
      return
    }
    setDraft({
      address: host.address,
      final_mask: host.final_mask,
      hidden: host.hidden,
      hostname: host.hostname,
      inbound_tag: host.inbound_tag,
      mihomo_x25519_public_key: host.mihomo_x25519_public_key,
      name: host.name,
      node_id: host.node_id,
      path: host.path,
      port: host.port,
      protocol_profile_id: host.protocol_profile_id,
      remark: host.remark,
      security: host.security,
      shuffle_host: host.shuffle_host,
      sni: host.sni,
      squad_id: host.squad_id,
      status: host.status,
      subscription_excluded: host.subscription_excluded,
      tags: host.tags,
    })
    setMetadataJson(JSON.stringify(host.metadata_json, null, 2))
    setXrayTemplateJson(JSON.stringify(host.xray_template_json, null, 2))
    setMuxJson(JSON.stringify(host.mux_json, null, 2))
    setSockoptJson(JSON.stringify(host.sockopt_json, null, 2))
    setXhttpJson(JSON.stringify(host.xhttp_json, null, 2))
    setExcludedSquads(host.excluded_internal_squad_ids.join(', '))
  }, [host])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (!host) {
      return
    }
    try {
      const nextNodeId = typeof draft.node_id === 'string' ? draft.node_id.trim() : ''
      if (!nextNodeId) {
        throw new Error(t('Select a node before saving a host.'))
      }
      const nextPort = normalizeHostPort(draft.port, t)
      await onSave(host.id, {
        ...draft,
        excluded_internal_squad_ids: excludedSquads.split(',').map((value) => value.trim()).filter(Boolean),
        metadata_json: parseMetadata(metadataJson),
        mux_json: parseMetadata(muxJson),
        node_id: nextNodeId,
        port: nextPort,
        sockopt_json: parseMetadata(sockoptJson),
        tags: draft.tags ?? [],
        xhttp_json: parseMetadata(xhttpJson),
        xray_template_json: parseMetadata(xrayTemplateJson),
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
          <option value="">{t('Select node')}</option>
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
      <label htmlFor="editor-host-path">
        Path
        <input id="editor-host-path" value={draft.path ?? ''} onChange={(event) => setDraft({ ...draft, path: event.target.value || null })} />
      </label>
      <label htmlFor="editor-host-sni">
        SNI
        <input id="editor-host-sni" value={draft.sni ?? ''} onChange={(event) => setDraft({ ...draft, sni: event.target.value || null })} />
      </label>
      <label htmlFor="editor-host-security">
        Security
        <select id="editor-host-security" value={draft.security ?? ''} onChange={(event) => setDraft({ ...draft, security: event.target.value || null })}>
          <option value="">Profile default</option>
          <option value="none">none</option>
          <option value="tls">tls</option>
          <option value="reality">reality</option>
        </select>
      </label>
      <label htmlFor="editor-host-final-mask">
        Final mask
        <input id="editor-host-final-mask" value={draft.final_mask ?? ''} onChange={(event) => setDraft({ ...draft, final_mask: event.target.value || null })} />
      </label>
      <label htmlFor="editor-host-mihomo-x25519">
        Mihomo X25519 public key
        <input
          id="editor-host-mihomo-x25519"
          value={draft.mihomo_x25519_public_key ?? ''}
          onChange={(event) => setDraft({ ...draft, mihomo_x25519_public_key: event.target.value || null })}
        />
      </label>
      <label className="checkbox-line" htmlFor="editor-host-hidden">
        <input id="editor-host-hidden" type="checkbox" checked={Boolean(draft.hidden)} onChange={(event) => setDraft({ ...draft, hidden: event.target.checked })} />
        Hidden from operators
      </label>
      <label className="checkbox-line" htmlFor="editor-host-subscription-excluded">
        <input
          id="editor-host-subscription-excluded"
          type="checkbox"
          checked={Boolean(draft.subscription_excluded)}
          onChange={(event) => setDraft({ ...draft, subscription_excluded: event.target.checked })}
        />
        Exclude from subscriptions
      </label>
      <label className="checkbox-line" htmlFor="editor-host-shuffle">
        <input id="editor-host-shuffle" type="checkbox" checked={Boolean(draft.shuffle_host)} onChange={(event) => setDraft({ ...draft, shuffle_host: event.target.checked })} />
        Shuffle host
      </label>
      <label htmlFor="editor-host-excluded-squads">
        Excluded internal squad IDs
        <input id="editor-host-excluded-squads" value={excludedSquads} onChange={(event) => setExcludedSquads(event.target.value)} />
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
      <label htmlFor="editor-host-xray-template">
        xray_template_json
        <textarea id="editor-host-xray-template" rows={5} value={xrayTemplateJson} onChange={(event) => setXrayTemplateJson(event.target.value)} />
      </label>
      <label htmlFor="editor-host-mux">
        mux_json
        <textarea id="editor-host-mux" rows={4} value={muxJson} onChange={(event) => setMuxJson(event.target.value)} />
      </label>
      <label htmlFor="editor-host-sockopt">
        sockopt_json
        <textarea id="editor-host-sockopt" rows={4} value={sockoptJson} onChange={(event) => setSockoptJson(event.target.value)} />
      </label>
      <label htmlFor="editor-host-xhttp">
        xhttp_json
        <textarea id="editor-host-xhttp" rows={4} value={xhttpJson} onChange={(event) => setXhttpJson(event.target.value)} />
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

function RuntimeSyncBadge({ status }: { status: { label: string; tone: 'danger' | 'good' | 'info' | 'neutral' | 'watch' } }) {
  return <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
}

function runtimeSyncStatus(host: HostRecord): { label: string; tone: 'danger' | 'good' | 'info' | 'neutral' | 'watch' } {
  const status = host.runtime_sync?.status ?? 'never_applied'
  if (status === 'applied') {
    return { label: 'Runtime applied', tone: 'good' }
  }
  if (status === 'apply_queued') {
    return { label: 'Apply queued', tone: 'info' }
  }
  if (status === 'apply_failed') {
    return { label: 'Apply failed', tone: 'danger' }
  }
  if (host.runtime_sync?.pending_apply || status === 'pending_apply') {
    return { label: 'Pending apply', tone: 'watch' }
  }
  return { label: 'Never applied', tone: 'neutral' }
}

function isValidHostPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535
}

function normalizeHostPort(value: HostUpdateRequest['port'], t: (value: string) => string): number | null {
  if (value === null || value === undefined) {
    return null
  }
  const parsed = Number(value)
  if (!isValidHostPort(parsed)) {
    throw new Error(t('Port must be an integer between 1 and 65535.'))
  }
  return parsed
}
