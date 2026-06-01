import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Ban, Save, Trash2, UserMinus, UserPlus } from 'lucide-react'
import {
  useAddSquadUsers,
  useCreateSquad,
  useDeleteSquad,
  useHostsPageData,
  useProfilesPageData,
  useReorderSquads,
  useRemoveSquadUsers,
  useSquadDetailData,
  useSquadsPageData,
  useUpdateHost,
  useUpdateProfile,
  useUpdateSquad,
  useUsersPageData,
} from '../shared/api/resourceHooks'
import type { SquadRecord, SquadUpdateRequest } from '../shared/api/types'
import {
  FormError,
  ResourceScreen,
  ScreenForm,
  SubmitButton,
} from '../shared/components/ResourceScreen'
import { StatusBadge } from '../shared/components/StatusBadge'
import { sectionSpecs } from '../shared/data/resourceMeta'
import { useI18n } from '../shared/i18n/I18nProvider'
import { formatRecord, parseKeyValueInput, toneForStatus } from '../shared/utils/resourceFormat'

export function SquadsPage() {
  const { t } = useI18n()
  const query = useSquadsPageData()
  const usersQuery = useUsersPageData()
  const profilesQuery = useProfilesPageData()
  const hostsQuery = useHostsPageData()
  const createSquad = useCreateSquad()
  const updateSquad = useUpdateSquad()
  const updateProfile = useUpdateProfile()
  const updateHost = useUpdateHost()
  const deleteSquad = useDeleteSquad()
  const reorderSquads = useReorderSquads()
  const addUsers = useAddSquadUsers()
  const removeUsers = useRemoveSquadUsers()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'internal' | 'external'>('internal')
  const [metadata, setMetadata] = useState('channel=stable, hwid_limit=5')
  const [formError, setFormError] = useState<string | null>(null)
  const [selectedSquadId, setSelectedSquadId] = useState('')
  const [memberUserId, setMemberUserId] = useState('')
  const [matrixProfileId, setMatrixProfileId] = useState('')
  const [matrixHostId, setMatrixHostId] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | 'internal' | 'external'>('all')
  const squads = query.data?.items ?? []
  const users = usersQuery.data?.items ?? []
  const profiles = profilesQuery.data?.items ?? []
  const hosts = hostsQuery.data?.items ?? []
  const visibleSquads = useMemo(
    () => squads.filter((squad) => kindFilter === 'all' || squad.kind === kindFilter),
    [kindFilter, squads],
  )
  const selectedSquad = useMemo(
    () => squads.find((squad) => squad.id === selectedSquadId) ?? squads[0],
    [selectedSquadId, squads],
  )
  const detailQuery = useSquadDetailData(selectedSquad?.id)

  useEffect(() => {
    if (visibleSquads.length > 0 && !visibleSquads.some((squad) => squad.id === selectedSquad?.id)) {
      setSelectedSquadId(visibleSquads[0].id)
    }
  }, [selectedSquad?.id, visibleSquads])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    try {
      await createSquad.mutateAsync({
        kind,
        metadata_json: parseKeyValueInput(metadata),
        name: name.trim(),
        status: 'active',
      })
      setName('')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Squad could not be created.')
    }
  }

  async function handleAddUser() {
    if (!selectedSquad || !memberUserId) {
      return
    }
    await addUsers.mutateAsync({
      id: selectedSquad.id,
      request: { user_ids: [memberUserId] },
    })
  }

  async function handleBindProfile() {
    if (!selectedSquad || !matrixProfileId) {
      return
    }
    await updateProfile.mutateAsync({
      id: matrixProfileId,
      request: { squad_id: selectedSquad.id },
    })
    setMatrixProfileId('')
    await detailQuery.refetch()
  }

  async function handleUnbindProfile(profileId: string) {
    await updateProfile.mutateAsync({
      id: profileId,
      request: { squad_id: null },
    })
    await detailQuery.refetch()
  }

  async function handleBindHost() {
    if (!selectedSquad || !matrixHostId) {
      return
    }
    await updateHost.mutateAsync({
      id: matrixHostId,
      request: { squad_id: selectedSquad.id },
    })
    setMatrixHostId('')
    await detailQuery.refetch()
  }

  async function handleUnbindHost(hostId: string) {
    await updateHost.mutateAsync({
      id: hostId,
      request: { squad_id: null },
    })
    await detailQuery.refetch()
  }

  return (
    <ResourceScreen
      caption="Squad inventory"
      columns={['Name', 'Kind', 'Users', 'Profiles', 'Hosts', 'Metadata', 'Status', 'Actions']}
      createForm={
        <ScreenForm onSubmit={handleSubmit}>
          <div>
            <p className="eyebrow">{t('Create squad')}</p>
            <h2>{t('Access lane')}</h2>
            <p>{t('Group users, profiles, and hosts without storing inline credentials.')}</p>
          </div>
          <label htmlFor="squad-name">
            {t('Name')}
            <input
              id="squad-name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label htmlFor="squad-kind">
            {t('Kind')}
            <select
              id="squad-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as 'internal' | 'external')}
            >
              <option value="internal">internal</option>
              <option value="external">external</option>
            </select>
          </label>
          <label htmlFor="squad-metadata">
            {t('Metadata')}
            <textarea
              id="squad-metadata"
              value={metadata}
              onChange={(event) => setMetadata(event.target.value)}
            />
          </label>
          <FormError message={formError} />
          <SubmitButton pending={createSquad.isPending}>{t('Create squad')}</SubmitButton>
        </ScreenForm>
      }
      emptyDescription="Create internal or external access lanes before assigning profiles and hosts."
      emptyTitle="No squads created"
      error={query.error}
      errorTitle="Squads unavailable"
      isError={query.isError}
      isLoading={query.isLoading}
      isSuccess={query.isSuccess}
      items={visibleSquads}
      loadingLabel="Loading squads..."
      onRefresh={() => void query.refetch()}
      renderRow={(squad) => {
        const userCount = Array.isArray(squad.metadata_json.user_ids)
          ? squad.metadata_json.user_ids.length
          : 0
        const isSelected = selectedSquad?.id === squad.id
        return {
          cells: [
            squad.name,
            squad.kind,
            String(userCount),
            isSelected ? String(detailQuery.data?.profiles.length ?? 0) : 'Open',
            isSelected ? String(detailQuery.data?.hosts.length ?? 0) : 'Open',
            formatRecord(squad.metadata_json),
            <StatusBadge tone={toneForStatus(squad.status)}>{squad.status}</StatusBadge>,
            <div className="inline-actions">
              <button
                type="button"
                className="icon-button"
                aria-label={`Open ${squad.name}`}
                onClick={() => setSelectedSquadId(squad.id)}
              >
                <Save size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`${squad.status === 'active' ? 'Disable' : 'Enable'} ${squad.name}`}
                onClick={() =>
                  void updateSquad.mutateAsync({
                    id: squad.id,
                    request: { status: squad.status === 'active' ? 'disabled' : 'active' },
                  })
                }
              >
                <Ban size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Delete ${squad.name}`}
                onClick={() => void deleteSquad.mutateAsync(squad.id)}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>,
          ],
          id: squad.id,
        }
      }}
      rightPanel={
        <div className="side-stack">
          <article className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">{t('Squad scope')}</p>
                <h2>{t('Internal and external')}</h2>
              </div>
            </div>
            <div className="inline-actions" role="group" aria-label={t('Squad kind filter')}>
              {(['all', 'internal', 'external'] as const).map((nextFilter) => (
                <button
                  key={nextFilter}
                  type="button"
                  className={`button ${kindFilter === nextFilter ? 'button--primary' : 'button--secondary'}`}
                  onClick={() => setKindFilter(nextFilter)}
                >
                  {t(nextFilter === 'all' ? 'All squads' : `${nextFilter} squads`)}
                </button>
              ))}
            </div>
          </article>
          <SquadEditor
            onReorder={() => void reorderSquads.mutateAsync(squads.map((squad) => squad.id).reverse())}
            onSave={async (id, request) => {
              await updateSquad.mutateAsync({ id, request })
              await query.refetch()
              await detailQuery.refetch()
            }}
            pending={updateSquad.isPending}
            squad={selectedSquad}
          />
          <article className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">{t('Squad membership')}</p>
                <h2>{t('{count} users', { count: detailQuery.data?.users.length ?? 0 })}</h2>
              </div>
            </div>
            <label htmlFor="squad-member-user">
              {t('Add user')}
              <select
                id="squad-member-user"
                value={memberUserId}
                onChange={(event) => setMemberUserId(event.target.value)}
              >
                <option value="">{t('Select user')}</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.username ?? user.email}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="button button--secondary" onClick={() => void handleAddUser()}>
              <UserPlus size={16} aria-hidden="true" /> {t('Add user')}
            </button>
            <div className="resource-list">
              {(detailQuery.data?.users ?? []).map((user) => (
                <div key={user.id} className="resource-list__item">
                  <span>{user.username ?? user.email}</span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${user.email}`}
                    onClick={() =>
                      selectedSquad &&
                      void removeUsers.mutateAsync({
                        id: selectedSquad.id,
                        request: { user_ids: [user.id] },
                      })
                    }
                  >
                    <UserMinus size={16} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </article>
          <article className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">{t('Binding matrix')}</p>
                <h2>{t('Profiles and hosts')}</h2>
              </div>
            </div>
            <label htmlFor="squad-matrix-profile">
              {t('Attach profile')}
              <select
                id="squad-matrix-profile"
                value={matrixProfileId}
                onChange={(event) => setMatrixProfileId(event.target.value)}
              >
                <option value="">{t('Select profile')}</option>
                {profiles
                  .filter((profile) => profile.squad_id !== selectedSquad?.id)
                  .map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} | {profile.adapter}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              className="button button--secondary"
              disabled={!selectedSquad || !matrixProfileId || updateProfile.isPending}
              onClick={() => void handleBindProfile()}
            >
              {t('Attach profile')}
            </button>
            <label htmlFor="squad-matrix-host">
              {t('Attach host')}
              <select
                id="squad-matrix-host"
                value={matrixHostId}
                onChange={(event) => setMatrixHostId(event.target.value)}
              >
                <option value="">{t('Select host')}</option>
                {hosts
                  .filter((host) => host.squad_id !== selectedSquad?.id)
                  .map((host) => (
                    <option key={host.id} value={host.id}>
                      {host.hostname} | {host.name}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              className="button button--secondary"
              disabled={!selectedSquad || !matrixHostId || updateHost.isPending}
              onClick={() => void handleBindHost()}
            >
              {t('Attach host')}
            </button>
          </article>
          <article className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">{t('Squad nodes')}</p>
                <h2>{t('{count} nodes', { count: detailQuery.data?.nodes.length ?? 0 })}</h2>
              </div>
            </div>
            <div className="resource-list">
              {(detailQuery.data?.nodes ?? []).map((node) => (
                <div key={node.id} className="resource-list__item">
                  <span>{node.name}</span>
                  <small>
                    {node.region} | {node.public_address} | {node.status}
                  </small>
                </div>
              ))}
              {detailQuery.data?.nodes.length === 0 && (
                <div className="resource-list__item">
                  <span>{t('No accessible nodes')}</span>
                  <small>{t('Attach profiles or hosts to expose node access for this squad.')}</small>
                </div>
              )}
            </div>
          </article>
          <article className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">{t('Squad profiles')}</p>
                <h2>{t('{count} profiles', { count: detailQuery.data?.profiles.length ?? 0 })}</h2>
              </div>
            </div>
            <div className="resource-list">
              {(detailQuery.data?.profiles ?? []).map((profile) => (
                <div key={profile.id} className="resource-list__item">
                  <span>{profile.name}</span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Detach profile ${profile.name}`}
                    disabled={updateProfile.isPending}
                    onClick={() => void handleUnbindProfile(profile.id)}
                  >
                    <UserMinus size={16} aria-hidden="true" />
                  </button>
                  <small>
                    {profile.adapter} | {profile.status} |{' '}
                    {profile.inbounds.length > 0 ? formatTags(profile.inbounds) : t('No inbounds')}
                  </small>
                </div>
              ))}
              {detailQuery.data?.profiles.length === 0 && (
                <div className="resource-list__item">
                  <span>{t('No profiles')}</span>
                  <small>{t('Assign protocol profiles to this squad to publish subscriptions.')}</small>
                </div>
              )}
            </div>
          </article>
          <article className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">{t('Squad hosts')}</p>
                <h2>{t('{count} hosts', { count: detailQuery.data?.hosts.length ?? 0 })}</h2>
              </div>
            </div>
            <div className="resource-list">
              {(detailQuery.data?.hosts ?? []).map((host) => (
                <div key={host.id} className="resource-list__item">
                  <span>{host.hostname}</span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Detach host ${host.hostname}`}
                    disabled={updateHost.isPending}
                    onClick={() => void handleUnbindHost(host.id)}
                  >
                    <UserMinus size={16} aria-hidden="true" />
                  </button>
                  <small>
                    {host.name} | {host.inbound_tag ?? t('No inbound')} | {host.port ?? t('Automatic port')} |{' '}
                    {host.status}
                  </small>
                </div>
              ))}
              {detailQuery.data?.hosts.length === 0 && (
                <div className="resource-list__item">
                  <span>{t('No hosts')}</span>
                  <small>{t('Bind hosts to profiles when this squad needs public routes.')}</small>
                </div>
              )}
            </div>
          </article>
          <article className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">{t('Access matrix')}</p>
                <h2>{t('{count} inbounds', { count: detailQuery.data?.inbound_matrix.length ?? 0 })}</h2>
              </div>
            </div>
            <div className="resource-list">
              {(detailQuery.data?.inbound_matrix ?? []).map((inbound) => (
                <div key={`${inbound.profile_id}-${inbound.tag}`} className="resource-list__item">
                  <span>{inbound.tag}</span>
                  <small>
                    {inbound.profile_name} | {inbound.node_name} | {inbound.protocol}/{inbound.transport}/
                    {inbound.security} | {inbound.listen}:{inbound.port} | {inbound.status}
                  </small>
                </div>
              ))}
              {detailQuery.data?.inbound_matrix.length === 0 && (
                <div className="resource-list__item">
                  <span>{t('No inbounds')}</span>
                  <small>{t('Runtime inbounds appear here after profiles are linked to this squad.')}</small>
                </div>
              )}
            </div>
          </article>
        </div>
      }
      spec={sectionSpecs.squads}
      tableEyebrow="Access groups"
      tableTitle="Squad registry"
    />
  )
}

function SquadEditor({
  onReorder,
  onSave,
  pending,
  squad,
}: {
  onReorder: () => void
  onSave: (id: string, request: SquadUpdateRequest) => Promise<void>
  pending: boolean
  squad: SquadRecord | undefined
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<SquadUpdateRequest>({})
  const [metadataJson, setMetadataJson] = useState('{}')
  const [overrideDraft, setOverrideDraft] = useState<ExternalSubscriptionOverrideDraft>(
    emptyExternalSubscriptionOverrideDraft(),
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!squad) {
      setDraft({})
      setMetadataJson('{}')
      setOverrideDraft(emptyExternalSubscriptionOverrideDraft())
      return
    }
    setDraft({
      kind: squad.kind === 'external' ? 'external' : 'internal',
      name: squad.name,
      status: squad.status,
    })
    setMetadataJson(JSON.stringify(squad.metadata_json, null, 2))
    setOverrideDraft(externalSubscriptionOverrideDraftFromMetadata(squad.metadata_json))
  }, [squad])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (!squad) {
      return
    }
    try {
      const metadata = parseMetadata(metadataJson)
      if ((draft.kind ?? squad.kind) === 'external') {
        metadata.subscription_overrides = externalSubscriptionOverridesFromDraft(overrideDraft)
      }
      await onSave(squad.id, {
        ...draft,
        metadata_json: metadata,
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Squad could not be saved.')
    }
  }

  return (
    <ScreenForm onSubmit={handleSubmit}>
      <div>
        <p className="eyebrow">{t('Squad editor')}</p>
        <h2>{t('Selected squad')}</h2>
        <p>
          {squad
            ? t('Editing {name}', { name: squad.name })
            : t('Select a squad to edit type, status, metadata, order, and membership.')}
        </p>
      </div>
      <div className="inline-actions">
        <button type="button" className="button button--secondary" onClick={onReorder}>
          {t('Reverse order')}
        </button>
      </div>
      <label htmlFor="editor-squad-name">
        {t('Editor name')}
        <input
          id="editor-squad-name"
          value={draft.name ?? ''}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </label>
      <label htmlFor="editor-squad-kind">
        {t('Editor kind')}
        <select
          id="editor-squad-kind"
          value={draft.kind ?? 'internal'}
          onChange={(event) => setDraft({ ...draft, kind: event.target.value as 'internal' | 'external' })}
        >
          <option value="internal">internal</option>
          <option value="external">external</option>
        </select>
      </label>
      <label htmlFor="editor-squad-status">
        {t('Editor status')}
        <input
          id="editor-squad-status"
          value={draft.status ?? ''}
          onChange={(event) => setDraft({ ...draft, status: event.target.value })}
        />
      </label>
      <label htmlFor="editor-squad-metadata">
        {t('Editor JSON')}
        <textarea
          id="editor-squad-metadata"
          rows={6}
          value={metadataJson}
          onChange={(event) => setMetadataJson(event.target.value)}
        />
      </label>
      {(draft.kind ?? squad?.kind) === 'external' && (
        <div className="field-grid">
          <div className="field-grid__full">
            <p className="eyebrow">{t('External subscription delivery')}</p>
            <p>{t('These settings change real public subscription manifests for users in this external squad.')}</p>
          </div>
          <label htmlFor="external-remark">
            {t('Custom remark')}
            <input
              id="external-remark"
              value={overrideDraft.remark}
              onChange={(event) => setOverrideDraft({ ...overrideDraft, remark: event.target.value })}
            />
          </label>
          <label htmlFor="external-template">
            {t('Template key')}
            <input
              id="external-template"
              value={overrideDraft.template}
              onChange={(event) => setOverrideDraft({ ...overrideDraft, template: event.target.value })}
            />
          </label>
          <label htmlFor="external-header-key">
            {t('Header key')}
            <input
              id="external-header-key"
              value={overrideDraft.headerKey}
              onChange={(event) => setOverrideDraft({ ...overrideDraft, headerKey: event.target.value })}
            />
          </label>
          <label htmlFor="external-header-value">
            {t('Header value')}
            <input
              id="external-header-value"
              value={overrideDraft.headerValue}
              onChange={(event) => setOverrideDraft({ ...overrideDraft, headerValue: event.target.value })}
            />
          </label>
          <label htmlFor="external-endpoint-host">
            {t('Endpoint host override')}
            <input
              id="external-endpoint-host"
              value={overrideDraft.endpointHost}
              onChange={(event) => setOverrideDraft({ ...overrideDraft, endpointHost: event.target.value })}
            />
          </label>
          <label htmlFor="external-sni">
            {t('SNI override')}
            <input
              id="external-sni"
              value={overrideDraft.sni}
              onChange={(event) => setOverrideDraft({ ...overrideDraft, sni: event.target.value })}
            />
          </label>
          <label htmlFor="external-path">
            {t('Path override')}
            <input
              id="external-path"
              value={overrideDraft.path}
              onChange={(event) => setOverrideDraft({ ...overrideDraft, path: event.target.value })}
            />
          </label>
          <label htmlFor="external-port">
            {t('Port override')}
            <input
              id="external-port"
              inputMode="numeric"
              value={overrideDraft.port}
              onChange={(event) => setOverrideDraft({ ...overrideDraft, port: event.target.value })}
            />
          </label>
          <label htmlFor="external-hwid-limit">
            {t('HWID limit')}
            <input
              id="external-hwid-limit"
              inputMode="numeric"
              value={overrideDraft.hwidLimit}
              onChange={(event) => setOverrideDraft({ ...overrideDraft, hwidLimit: event.target.value })}
            />
          </label>
          <label htmlFor="external-hwid-required" className="checkbox-field">
            <input
              id="external-hwid-required"
              type="checkbox"
              checked={overrideDraft.hwidRequired}
              onChange={(event) => setOverrideDraft({ ...overrideDraft, hwidRequired: event.target.checked })}
            />
            {t('Require HWID')}
          </label>
          <label htmlFor="external-subpage-title" className="field-grid__full">
            {t('Subpage title')}
            <input
              id="external-subpage-title"
              value={overrideDraft.subpageTitle}
              onChange={(event) => setOverrideDraft({ ...overrideDraft, subpageTitle: event.target.value })}
            />
          </label>
        </div>
      )}
      <FormError message={error} />
      <SubmitButton pending={pending || !squad}>{t('Save squad')}</SubmitButton>
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

type ExternalSubscriptionOverrideDraft = {
  endpointHost: string
  headerKey: string
  headerValue: string
  hwidLimit: string
  hwidRequired: boolean
  path: string
  port: string
  remark: string
  sni: string
  subpageTitle: string
  template: string
}

function emptyExternalSubscriptionOverrideDraft(): ExternalSubscriptionOverrideDraft {
  return {
    endpointHost: '',
    headerKey: '',
    headerValue: '',
    hwidLimit: '',
    hwidRequired: false,
    path: '',
    port: '',
    remark: '',
    sni: '',
    subpageTitle: '',
    template: '',
  }
}

function externalSubscriptionOverrideDraftFromMetadata(
  metadata: Record<string, unknown>,
): ExternalSubscriptionOverrideDraft {
  const overrides = readObject(metadata.subscription_overrides)
  const host = readObject(overrides.host)
  const headers = readObject(overrides.headers)
  const hwid = readObject(overrides.hwid)
  const subpage = readObject(overrides.subpage)
  const firstHeader = Object.entries(headers)[0]
  return {
    endpointHost: stringValue(host.endpoint_host ?? host.final_mask),
    headerKey: firstHeader?.[0] ?? '',
    headerValue: stringValue(firstHeader?.[1]),
    hwidLimit: stringValue(hwid.limit),
    hwidRequired: booleanValue(hwid.required),
    path: stringValue(host.path),
    port: stringValue(host.port),
    remark: stringValue(overrides.remark ?? overrides.profile_title),
    sni: stringValue(host.sni ?? host.server_name),
    subpageTitle: stringValue(subpage.title),
    template: stringValue(overrides.template),
  }
}

function externalSubscriptionOverridesFromDraft(
  draft: ExternalSubscriptionOverrideDraft,
): Record<string, unknown> {
  const headers =
    draft.headerKey.trim() && draft.headerValue.trim()
      ? { [draft.headerKey.trim()]: draft.headerValue.trim() }
      : {}
  return removeEmptyValues({
    headers,
    host: removeEmptyValues({
      endpoint_host: draft.endpointHost.trim(),
      path: draft.path.trim(),
      port: draft.port.trim(),
      sni: draft.sni.trim(),
    }),
    hwid: removeEmptyValues({
      limit: draft.hwidLimit.trim(),
      required: draft.hwidRequired,
    }),
    profile_title: draft.remark.trim(),
    remark: draft.remark.trim(),
    subpage: removeEmptyValues({
      title: draft.subpageTitle.trim(),
    }),
    template: draft.template.trim(),
  })
}

function removeEmptyValues(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === '' || entry === undefined || entry === null) {
        return false
      }
      if (typeof entry === 'boolean') {
        return entry
      }
      if (isRecord(entry)) {
        return Object.keys(entry).length > 0
      }
      return true
    }),
  )
}

function readObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  return typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function formatTags(values: string[]): string {
  return values.length > 0 ? values.join(', ') : 'no inbounds'
}
