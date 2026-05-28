import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Ban, Save, Trash2, UserMinus, UserPlus } from 'lucide-react'
import {
  useAddSquadUsers,
  useCreateSquad,
  useDeleteSquad,
  useReorderSquads,
  useRemoveSquadUsers,
  useSquadDetailData,
  useSquadsPageData,
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
import { sectionSpecs } from '../shared/data/lumenData'
import { formatRecord, parseKeyValueInput, toneForStatus } from '../shared/utils/resourceFormat'

export function SquadsPage() {
  const query = useSquadsPageData()
  const usersQuery = useUsersPageData()
  const createSquad = useCreateSquad()
  const updateSquad = useUpdateSquad()
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
  const squads = query.data?.items ?? []
  const users = usersQuery.data?.items ?? []
  const selectedSquad = useMemo(
    () => squads.find((squad) => squad.id === selectedSquadId) ?? squads[0],
    [selectedSquadId, squads],
  )
  const detailQuery = useSquadDetailData(selectedSquad?.id)

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

  return (
    <ResourceScreen
      caption="Squad inventory"
      columns={['Name', 'Kind', 'Users', 'Profiles', 'Hosts', 'Metadata', 'Status', 'Actions']}
      createForm={
        <ScreenForm onSubmit={handleSubmit}>
          <div>
            <p className="eyebrow">Create squad</p>
            <h2>Access lane</h2>
            <p>Group users, profiles, and hosts without storing inline credentials.</p>
          </div>
          <label htmlFor="squad-name">
            Name
            <input
              id="squad-name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label htmlFor="squad-kind">
            Kind
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
            Metadata
            <textarea
              id="squad-metadata"
              value={metadata}
              onChange={(event) => setMetadata(event.target.value)}
            />
          </label>
          <FormError message={formError} />
          <SubmitButton pending={createSquad.isPending}>Create squad</SubmitButton>
        </ScreenForm>
      }
      emptyDescription="Create internal or external access lanes before assigning profiles and hosts."
      emptyTitle="No squads created"
      error={query.error}
      errorTitle="Squads unavailable"
      isError={query.isError}
      isLoading={query.isLoading}
      isSuccess={query.isSuccess}
      items={squads}
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
                <p className="eyebrow">Squad membership</p>
                <h2>{detailQuery.data?.users.length ?? 0} users</h2>
              </div>
            </div>
            <label htmlFor="squad-member-user">
              Add user
              <select
                id="squad-member-user"
                value={memberUserId}
                onChange={(event) => setMemberUserId(event.target.value)}
              >
                <option value="">Select user</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.username ?? user.email}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="button button--secondary" onClick={() => void handleAddUser()}>
              <UserPlus size={16} aria-hidden="true" /> Add user
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
                <p className="eyebrow">Access matrix</p>
                <h2>{detailQuery.data?.inbound_matrix.length ?? 0} inbounds</h2>
              </div>
            </div>
            <div className="resource-list">
              {(detailQuery.data?.inbound_matrix ?? []).map((inbound) => (
                <div key={`${inbound.profile_id}-${inbound.tag}`} className="resource-list__item">
                  <span>{inbound.tag}</span>
                  <small>{inbound.node_name} : {inbound.port}</small>
                </div>
              ))}
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
  const [draft, setDraft] = useState<SquadUpdateRequest>({})
  const [metadataJson, setMetadataJson] = useState('{}')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!squad) {
      setDraft({})
      setMetadataJson('{}')
      return
    }
    setDraft({
      kind: squad.kind === 'external' ? 'external' : 'internal',
      name: squad.name,
      status: squad.status,
    })
    setMetadataJson(JSON.stringify(squad.metadata_json, null, 2))
  }, [squad])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (!squad) {
      return
    }
    try {
      await onSave(squad.id, {
        ...draft,
        metadata_json: parseMetadata(metadataJson),
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Squad could not be saved.')
    }
  }

  return (
    <ScreenForm onSubmit={handleSubmit}>
      <div>
        <p className="eyebrow">Squad editor</p>
        <h2>Selected squad</h2>
        <p>
          {squad
            ? `Editing ${squad.name}`
            : 'Select a squad to edit type, status, metadata, order, and membership.'}
        </p>
      </div>
      <div className="inline-actions">
        <button type="button" className="button button--secondary" onClick={onReorder}>
          Reverse order
        </button>
      </div>
      <label htmlFor="editor-squad-name">
        Editor name
        <input
          id="editor-squad-name"
          value={draft.name ?? ''}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </label>
      <label htmlFor="editor-squad-kind">
        Editor kind
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
        Editor status
        <input
          id="editor-squad-status"
          value={draft.status ?? ''}
          onChange={(event) => setDraft({ ...draft, status: event.target.value })}
        />
      </label>
      <label htmlFor="editor-squad-metadata">
        Editor JSON
        <textarea
          id="editor-squad-metadata"
          rows={6}
          value={metadataJson}
          onChange={(event) => setMetadataJson(event.target.value)}
        />
      </label>
      <FormError message={error} />
      <SubmitButton pending={pending || !squad}>Save squad</SubmitButton>
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
