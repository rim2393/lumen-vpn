import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Ban,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  Edit3,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import {
  useCreateProfile,
  useDeleteProfile,
  useNodesPageData,
  useProfileComputedConfig,
  useProfileInbounds,
  useProfilesPageData,
  useProtocolAdaptersData,
  useSquadsPageData,
  useUpdateProfile,
} from '../shared/api/resourceHooks'
import type { PortReservation, ProtocolProfileRecord } from '../shared/api/types'
import { useApiClient } from '../shared/api/apiClientContext'
import { EmptyState, ErrorState, LoadingState } from '../shared/components/DataState'
import { DataTable } from '../shared/components/DataTable'
import { FormError, SubmitButton } from '../shared/components/ResourceScreen'
import { PageHeader } from '../shared/components/PageHeader'
import { StatusBadge } from '../shared/components/StatusBadge'
import { sectionSpecs } from '../shared/data/lumenData'
import { useI18n } from '../shared/i18n/I18nProvider'
import { toneForStatus } from '../shared/utils/resourceFormat'

type ProfileFormState = {
  adapter: string
  allowPortConflicts: boolean
  credentialsRef: string
  configJson: string
  flow: string
  name: string
  nodeId: string
  port: string
  security: string
  squadId: string
  status: string
  tag: string
  transport: string
}

const defaultForm: ProfileFormState = {
  adapter: 'vless-reality',
  allowPortConflicts: false,
  credentialsRef: 'vault://lumen/profiles/new-profile',
  configJson: JSON.stringify(
    {
      flow: 'xtls-rprx-vision',
      security: 'reality',
      transport: 'tcp',
    },
    null,
    2,
  ),
  flow: 'xtls-rprx-vision',
  name: '',
  nodeId: '',
  port: '443',
  security: 'reality',
  squadId: '',
  status: 'active',
  tag: '',
  transport: 'tcp',
}

export function ProfilesPage() {
  const { t } = useI18n()
  const apiClient = useApiClient()
  const profilesQuery = useProfilesPageData()
  const adaptersQuery = useProtocolAdaptersData()
  const nodesQuery = useNodesPageData()
  const squadsQuery = useSquadsPageData()
  const createProfile = useCreateProfile()
  const updateProfile = useUpdateProfile()
  const deleteProfile = useDeleteProfile()
  const profiles = profilesQuery.data?.items ?? []
  const adapters = adaptersQuery.data?.items ?? []
  const nodes = nodesQuery.data?.items ?? []
  const squads = squadsQuery.data?.items ?? []
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [form, setForm] = useState<ProfileFormState>(defaultForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [portCheckMessage, setPortCheckMessage] = useState<string | null>(null)
  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0],
    [profiles, selectedProfileId],
  )
  const computedQuery = useProfileComputedConfig(selectedProfile?.id)
  const inboundsQuery = useProfileInbounds(selectedProfile?.id)

  useEffect(() => {
    if (!selectedProfileId && profiles[0]) {
      setSelectedProfileId(profiles[0].id)
    }
  }, [profiles, selectedProfileId])

  useEffect(() => {
    if (adapters.length > 0 && !adapters.some((item) => item.protocol === form.adapter)) {
      setForm((current) => ({ ...current, adapter: adapters[0].protocol }))
    }
  }, [adapters, form.adapter])

  useEffect(() => {
    if (!form.nodeId && nodes[0]) {
      setForm((current) => ({ ...current, nodeId: nodes[0].id }))
    }
  }, [form.nodeId, nodes])

  const selectedAdapter = adapters.find((adapter) => adapter.protocol === form.adapter)
  const selectedNode = nodes.find((node) => node.id === selectedProfile?.node_id)
  const selectedSquad = squads.find((squad) => squad.id === selectedProfile?.squad_id)
  const isLoading =
    profilesQuery.isLoading || adaptersQuery.isLoading || nodesQuery.isLoading || squadsQuery.isLoading
  const error = profilesQuery.error ?? adaptersQuery.error ?? nodesQuery.error ?? squadsQuery.error
  const profileStats = {
    active: profiles.filter((profile) => profile.status === 'active').length,
    disabled: profiles.filter((profile) => profile.status !== 'active').length,
    ports: profiles.reduce((total, profile) => total + profile.port_reservations.length, 0),
  }

  function startEdit(profile: ProtocolProfileRecord) {
    setEditingProfileId(profile.id)
    setSelectedProfileId(profile.id)
    setForm(profileToForm(profile))
    setFormError(null)
    setPortCheckMessage(null)
  }

  function resetCreate() {
    setEditingProfileId(null)
    setForm({
      ...defaultForm,
      adapter: adapters[0]?.protocol ?? defaultForm.adapter,
      nodeId: nodes[0]?.id ?? '',
    })
    setFormError(null)
    setPortCheckMessage(null)
  }

  async function checkPorts(reservations: PortReservation[]) {
    if (!form.nodeId) {
      throw new Error(t('Node is required.'))
    }
    const response = await apiClient.checkPortConflicts({
      exclude_profile_id: editingProfileId,
      node_id: form.nodeId,
      reservations,
    })
    if (!response.allowed && !form.allowPortConflicts) {
      const conflict = response.conflicts[0]
      const suggestion = conflict?.suggested_port ? ` ${t('Suggested port')}: ${conflict.suggested_port}.` : ''
      throw new Error(`${conflict?.message ?? t('Port conflict detected.')}${suggestion}`)
    }
    setPortCheckMessage(
      response.allowed
        ? t('Port check passed.')
        : `${t('Port conflict acknowledged')}: ${response.conflicts[0]?.message ?? t('conflict')}`,
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setPortCheckMessage(null)
    try {
      const request = formToRequest(form, t)
      await checkPorts(request.port_reservations)
      if (editingProfileId) {
        await updateProfile.mutateAsync({ id: editingProfileId, request })
      } else {
        const created = await createProfile.mutateAsync(request)
        setSelectedProfileId(created.id)
      }
      resetCreate()
      await profilesQuery.refetch()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('Profile could not be saved.'))
    }
  }

  async function copyJson(value: unknown) {
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2))
  }

  function downloadJson(filename: string, value: unknown) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(href)
  }

  function handleDelete(profile: ProtocolProfileRecord) {
    if (window.confirm(t('Delete profile confirmation', { name: profile.name }))) {
      void deleteProfile.mutateAsync(profile.id)
    }
  }

  return (
    <section className="page">
      <PageHeader
        eyebrow={sectionSpecs.profiles.eyebrow}
        title={sectionSpecs.profiles.title}
        description={t('Build Xray protocol profiles, reserve real node ports, inspect generated inbounds, and attach delivery squads.')}
        actions={
          <div className="inline-actions">
            <button
              type="button"
              className="button button--secondary"
              aria-label={t('Refresh profiles')}
              onClick={() => void profilesQuery.refetch()}
            >
              <RefreshCw size={18} aria-hidden="true" />
              {t('Refresh')}
            </button>
            <button type="button" className="button button--primary" onClick={resetCreate}>
              <Plus size={18} aria-hidden="true" />
              {t('Create profile')}
            </button>
          </div>
        }
      />

      {isLoading ? <LoadingState label={t('Loading profiles...')} /> : null}
      {error ? <ErrorState title={t('Profiles unavailable')} error={error} /> : null}
      {!isLoading && !error ? (
        <>
          <section className="summary-grid" aria-label={t('Profile summary')}>
            <div>
              <span>{t('Total profiles')}</span>
              <strong>{profiles.length}</strong>
            </div>
            <div>
              <span>{t('Active')}</span>
              <strong>{profileStats.active}</strong>
            </div>
            <div>
              <span>{t('Reserved ports')}</span>
              <strong>{profileStats.ports}</strong>
            </div>
            <div>
              <span>{t('Disabled')}</span>
              <strong>{profileStats.disabled}</strong>
            </div>
          </section>

          <section className="profile-layout">
            <article className="panel panel--wide">
              <div className="panel__header">
                <div>
                  <p className="eyebrow">{t('Client delivery')}</p>
                  <h2>{t('Profiles')}</h2>
                </div>
                <StatusBadge>{t('real API')}</StatusBadge>
              </div>
              {profiles.length === 0 ? (
                <EmptyState
                  title={t('No profiles created')}
                  description={t('Create the first profile after registering a node.')}
                />
              ) : (
                <div className="profile-card-grid">
                  {profiles.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      className={
                        profile.id === selectedProfile?.id
                          ? 'profile-card profile-card--selected'
                          : 'profile-card'
                      }
                      onClick={() => setSelectedProfileId(profile.id)}
                    >
                      <span className="profile-card__icon">
                        <ShieldCheck size={20} aria-hidden="true" />
                      </span>
                      <span className="profile-card__body">
                        <strong>{profile.name}</strong>
                        <small>
                          {profile.adapter} · {portsLabel(profile, t)}
                        </small>
                      </span>
                      <StatusBadge tone={toneForStatus(profile.status)}>{t(profile.status)}</StatusBadge>
                    </button>
                  ))}
                </div>
              )}
            </article>

            <ProfileDetailPanel
              computedConfig={computedQuery.data?.computed_config}
              copyJson={copyJson}
              downloadJson={downloadJson}
              inbounds={inboundsQuery.data?.items ?? []}
              isComputedLoading={computedQuery.isLoading}
              nodeName={selectedNode?.name ?? selectedProfile?.node_id}
              onDelete={handleDelete}
              onEdit={startEdit}
              onToggle={(profile) =>
                void updateProfile.mutateAsync({
                  id: profile.id,
                  request: { status: profile.status === 'active' ? 'disabled' : 'active' },
                })
              }
              profile={selectedProfile}
              squadName={selectedSquad?.name ?? null}
              t={t}
            />

            <ProfileEditor
              adapters={adapters}
              editing={Boolean(editingProfileId)}
              error={formError}
              form={form}
              onCancel={resetCreate}
              onChange={setForm}
              onSubmit={handleSubmit}
              pending={createProfile.isPending || updateProfile.isPending}
              portCheckMessage={portCheckMessage}
              selectedAdapterCapabilities={selectedAdapter?.capabilities ?? []}
              nodes={nodes}
              squads={squads}
              t={t}
            />
          </section>
        </>
      ) : null}
    </section>
  )
}

function ProfileDetailPanel({
  computedConfig,
  copyJson,
  downloadJson,
  inbounds,
  isComputedLoading,
  nodeName,
  onDelete,
  onEdit,
  onToggle,
  profile,
  squadName,
  t,
}: {
  computedConfig: Record<string, unknown> | undefined
  copyJson: (value: unknown) => Promise<void>
  downloadJson: (filename: string, value: unknown) => void
  inbounds: Array<{
    hosts: Array<Record<string, unknown>>
    listen: string
    port: number
    security: string
    tag: string
    transport: string
  }>
  isComputedLoading: boolean
  nodeName: string | undefined
  onDelete: (profile: ProtocolProfileRecord) => void
  onEdit: (profile: ProtocolProfileRecord) => void
  onToggle: (profile: ProtocolProfileRecord) => void
  profile: ProtocolProfileRecord | undefined
  squadName: string | null
  t: (value: string, params?: Record<string, string | number>) => string
}) {
  if (!profile) {
    return (
      <article className="panel">
        <EmptyState title={t('No profile selected')} description={t('Create or select a profile to inspect it.')} />
      </article>
    )
  }

  const rawProfileExport = {
    adapter: profile.adapter,
    config_json: profile.config_json,
    credentials_ref: profile.credentials_ref,
    id: profile.id,
    name: profile.name,
    node_id: profile.node_id,
    port_reservations: profile.port_reservations,
    squad_id: profile.squad_id,
    status: profile.status,
  }

  return (
    <article className="panel">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{t('Selected profile')}</p>
          <h2>{profile.name}</h2>
        </div>
        <StatusBadge tone={toneForStatus(profile.status)}>{t(profile.status)}</StatusBadge>
      </div>
      <div className="inline-actions">
        <button type="button" className="button button--secondary" onClick={() => onEdit(profile)}>
          <Edit3 size={16} aria-hidden="true" />
          {t('Edit')}
        </button>
        <button type="button" className="button button--secondary" onClick={() => onToggle(profile)}>
          <Ban size={16} aria-hidden="true" />
          {profile.status === 'active' ? t('Disable') : t('Enable')}
        </button>
        <button
          type="button"
          className="button button--secondary"
          disabled={!computedConfig || isComputedLoading}
          onClick={() => computedConfig && downloadJson(`${profile.name}-computed.json`, computedConfig)}
        >
          <Download size={16} aria-hidden="true" />
          {t('Export computed')}
        </button>
        <button type="button" className="icon-button" aria-label={t('Delete {name}', { name: profile.name })} onClick={() => onDelete(profile)}>
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>

      <dl className="profile-facts">
        <div>
          <dt>{t('Adapter')}</dt>
          <dd>{profile.adapter}</dd>
        </div>
        <div>
          <dt>{t('Node')}</dt>
          <dd>{nodeName ?? profile.node_id}</dd>
        </div>
        <div>
          <dt>{t('Squad')}</dt>
          <dd>{squadName ?? t('None')}</dd>
        </div>
        <div>
          <dt>{t('Vault ref')}</dt>
          <dd>{profile.credentials_ref ?? t('None')}</dd>
        </div>
      </dl>

      <DataTable
        caption={t('Profile inbounds')}
        columns={[t('Tag'), t('Listen'), t('Port'), t('Transport'), t('Security'), t('Hosts')]}
        rows={inbounds.map((inbound) => ({
          cells: [
            inbound.tag,
            inbound.listen,
            String(inbound.port),
            inbound.transport,
            inbound.security,
            String(inbound.hosts.length),
          ],
          id: inbound.tag,
        }))}
      />
      {inbounds.length === 0 ? (
        <p className="auth-card__note">{t('No generated inbounds for this profile yet.')}</p>
      ) : null}

      <details className="details-card">
        <summary>
          <Code2 size={16} aria-hidden="true" />
          {t('Raw profile JSON')}
        </summary>
        <div className="inline-actions">
          <button type="button" className="button button--secondary" onClick={() => void copyJson(rawProfileExport)}>
            <Copy size={16} aria-hidden="true" />
            {t('Copy JSON')}
          </button>
          <button type="button" className="button button--secondary" onClick={() => downloadJson(`${profile.name}-profile.json`, rawProfileExport)}>
            <Download size={16} aria-hidden="true" />
            {t('Download JSON')}
          </button>
        </div>
        <pre className="code-block">{JSON.stringify(rawProfileExport, null, 2)}</pre>
      </details>

      <details className="details-card">
        <summary>
          <Code2 size={16} aria-hidden="true" />
          {t('Xray computed config')}
        </summary>
        <div className="inline-actions">
          <button
            type="button"
            className="button button--secondary"
            disabled={!computedConfig || isComputedLoading}
            onClick={() => computedConfig && void copyJson(computedConfig)}
          >
            <Copy size={16} aria-hidden="true" />
            {t('Copy JSON')}
          </button>
        </div>
        <pre className="code-block">
          {computedConfig ? JSON.stringify(computedConfig, null, 2) : t('Computed config unavailable.')}
        </pre>
      </details>
    </article>
  )
}

function ProfileEditor({
  adapters,
  editing,
  error,
  form,
  nodes,
  onCancel,
  onChange,
  onSubmit,
  pending,
  portCheckMessage,
  selectedAdapterCapabilities,
  squads,
  t,
}: {
  adapters: Array<{ capabilities: string[]; display_name: string; protocol: string; status: string }>
  editing: boolean
  error: string | null
  form: ProfileFormState
  nodes: Array<{ id: string; name: string; status: string }>
  onCancel: () => void
  onChange: (state: ProfileFormState) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  pending: boolean
  portCheckMessage: string | null
  selectedAdapterCapabilities: string[]
  squads: Array<{ id: string; name: string }>
  t: (value: string) => string
}) {
  const patch = (partial: Partial<ProfileFormState>) => onChange({ ...form, ...partial })

  return (
    <form className="auth-card auth-card--wide" onSubmit={onSubmit}>
      <div>
        <p className="eyebrow">{editing ? t('Edit profile') : t('Create profile')}</p>
        <h2>{t('Xray config wrapper')}</h2>
        <p>{t('All fields are persisted through the profile API and validated before save.')}</p>
      </div>
      <div className="profile-form-grid">
        <label htmlFor="profile-name">
          {t('Name')}
          <input
            id="profile-name"
            required
            value={form.name}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </label>
        <label htmlFor="profile-adapter">
          {t('Adapter')}
          <select
            id="profile-adapter"
            value={form.adapter}
            onChange={(event) => patch({ adapter: event.target.value })}
          >
            {adapters.map((adapter) => (
              <option key={adapter.protocol} value={adapter.protocol}>
                {adapter.display_name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="profile-node">
          {t('Node')}
          <select
            id="profile-node"
            required
            value={form.nodeId}
            onChange={(event) => patch({ nodeId: event.target.value })}
          >
            <option value="">{t('Select node')}</option>
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.name} · {t(node.status)}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="profile-squad">
          {t('Squad')}
          <select
            id="profile-squad"
            value={form.squadId}
            onChange={(event) => patch({ squadId: event.target.value })}
          >
            <option value="">{t('None')}</option>
            {squads.map((squad) => (
              <option key={squad.id} value={squad.id}>
                {squad.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="profile-port">
          {t('Port')}
          <input
            id="profile-port"
            inputMode="numeric"
            required
            value={form.port}
            onChange={(event) => patch({ port: event.target.value })}
          />
        </label>
        <label htmlFor="profile-transport">
          {t('Transport')}
          <select
            id="profile-transport"
            value={form.transport}
            onChange={(event) => patch({ transport: event.target.value })}
          >
            {['tcp', 'grpc', 'ws', 'xhttp', 'httpupgrade', 'splithttp'].map((transport) => (
              <option key={transport} value={transport}>
                {transport}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="profile-security">
          {t('Security')}
          <select
            id="profile-security"
            value={form.security}
            onChange={(event) => patch({ security: event.target.value })}
          >
            {['reality', 'tls', 'none'].map((security) => (
              <option key={security} value={security}>
                {security}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="profile-flow">
          {t('Flow')}
          <input id="profile-flow" value={form.flow} onChange={(event) => patch({ flow: event.target.value })} />
        </label>
        <label htmlFor="profile-tag">
          {t('Inbound tag')}
          <input id="profile-tag" value={form.tag} onChange={(event) => patch({ tag: event.target.value })} />
        </label>
        <label htmlFor="profile-credentials-ref" className="profile-form-grid__wide">
          {t('Credentials ref')}
          <input
            id="profile-credentials-ref"
            value={form.credentialsRef}
            onChange={(event) => patch({ credentialsRef: event.target.value })}
          />
        </label>
        <label htmlFor="profile-config-json" className="profile-form-grid__wide">
          {t('Profile config JSON')}
          <textarea
            id="profile-config-json"
            spellCheck={false}
            value={form.configJson}
            onChange={(event) => patch({ configJson: event.target.value })}
          />
        </label>
        <label className="toggle-row profile-form-grid__wide" htmlFor="profile-allow-conflicts">
          <input
            id="profile-allow-conflicts"
            type="checkbox"
            checked={form.allowPortConflicts}
            onChange={(event) => patch({ allowPortConflicts: event.target.checked })}
          />
          {t('Allow saving with acknowledged port conflicts')}
        </label>
      </div>
      <div className="resource-list">
        <div className="resource-list__item">
          <span>
            <Server size={16} aria-hidden="true" /> {t('Adapter capabilities')}
          </span>
          <small>{selectedAdapterCapabilities.join(', ') || t('No capabilities reported')}</small>
        </div>
        {portCheckMessage ? (
          <div className="resource-list__item">
            <span>
              <CheckCircle2 size={16} aria-hidden="true" /> {t('Port validation')}
            </span>
            <small>{portCheckMessage}</small>
          </div>
        ) : null}
      </div>
      <FormError message={error} />
      <div className="inline-actions">
        <SubmitButton pending={pending}>{editing ? t('Save profile') : t('Create profile')}</SubmitButton>
        {editing ? (
          <button type="button" className="button button--secondary" onClick={onCancel}>
            {t('Cancel edit')}
          </button>
        ) : null}
      </div>
    </form>
  )
}

function profileToForm(profile: ProtocolProfileRecord): ProfileFormState {
  const reservation = profile.port_reservations[0] ?? {}
  return {
    adapter: profile.adapter,
    allowPortConflicts: false,
    configJson: JSON.stringify(profile.config_json, null, 2),
    credentialsRef: profile.credentials_ref ?? '',
    flow: String(profile.config_json.flow ?? ''),
    name: profile.name,
    nodeId: profile.node_id,
    port: String(reservation.port ?? ''),
    security: String(profile.config_json.security ?? 'reality'),
    squadId: profile.squad_id ?? '',
    status: profile.status,
    tag: String(profile.config_json.tag ?? ''),
    transport: String(profile.config_json.transport ?? profile.config_json.network ?? 'tcp'),
  }
}

function formToRequest(form: ProfileFormState, t: (value: string) => string) {
  const port = Number(form.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(t('Port must be an integer between 1 and 65535.'))
  }
  if (!form.nodeId) {
    throw new Error(t('Node is required.'))
  }
  if (!form.name.trim()) {
    throw new Error(t('Name is required.'))
  }
  const config_json = parseProfileConfigJson(form.configJson, t)
  config_json.security = form.security
  config_json.transport = form.transport
  if (form.flow.trim()) {
    config_json.flow = form.flow.trim()
  } else {
    delete config_json.flow
  }
  if (form.tag.trim()) {
    config_json.tag = form.tag.trim()
  } else {
    delete config_json.tag
  }
  return {
    adapter: form.adapter,
    allow_port_conflicts: form.allowPortConflicts,
    config_json,
    credentials_ref: form.credentialsRef.trim() || null,
    name: form.name.trim(),
    node_id: form.nodeId,
    port_reservations: [{ address: '0.0.0.0', exclusive: true, port, protocol: 'tcp' as const }],
    squad_id: form.squadId || null,
    status: form.status,
  }
}

function parseProfileConfigJson(value: string, t: (value: string) => string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(t('Profile config JSON must be valid JSON.'))
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(t('Profile config JSON must be an object.'))
  }
  return { ...(parsed as Record<string, unknown>) }
}

function portsLabel(profile: ProtocolProfileRecord, t: (value: string) => string): string {
  if (profile.port_reservations.length === 0) {
    return t('no ports')
  }
  return profile.port_reservations
    .map((reservation) => `${String(reservation.port)}/${String(reservation.protocol ?? 'tcp')}`)
    .join(', ')
}
