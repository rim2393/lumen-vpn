import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Ban, Save, Trash2 } from 'lucide-react'
import {
  useCreateProfile,
  useDeleteProfile,
  useNodesPageData,
  useProfilesPageData,
  useProtocolAdaptersData,
  useSquadsPageData,
  useUpdateProfile,
} from '../shared/api/resourceHooks'
import type { ProtocolProfileRecord } from '../shared/api/types'
import {
  FormError,
  ResourceScreen,
  ScreenForm,
  SubmitButton,
} from '../shared/components/ResourceScreen'
import { OperatorGuide } from '../shared/components/OperatorGuide'
import { StatusBadge } from '../shared/components/StatusBadge'
import { sectionSpecs } from '../shared/data/lumenData'
import { formatRecord, parseKeyValueInput, toneForStatus } from '../shared/utils/resourceFormat'

export function ProfilesPage() {
  const query = useProfilesPageData()
  const adaptersQuery = useProtocolAdaptersData()
  const nodesQuery = useNodesPageData()
  const squadsQuery = useSquadsPageData()
  const createProfile = useCreateProfile()
  const profiles = query.data?.items ?? []
  const nodes = nodesQuery.data?.items ?? []
  const squads = squadsQuery.data?.items ?? []
  const adapters = adaptersQuery.data?.items ?? []
  const updateProfile = useUpdateProfile()
  const deleteProfile = useDeleteProfile()
  const [name, setName] = useState('')
  const [adapter, setAdapter] = useState('vless-reality')
  const [nodeId, setNodeId] = useState('')
  const [squadId, setSquadId] = useState('')
  const [port, setPort] = useState('443')
  const [credentialsRef, setCredentialsRef] = useState('vault://lumen/profiles/new-profile')
  const [config, setConfig] = useState('transport=tcp, security=reality')
  const [formError, setFormError] = useState<string | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0],
    [profiles, selectedProfileId],
  )

  useEffect(() => {
    if (adapters.length > 0 && !adapters.some((item) => item.protocol === adapter)) {
      setAdapter(adapters[0].protocol)
    }
  }, [adapter, adapters])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    const parsedPort = Number(port)
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      setFormError('Port must be an integer between 1 and 65535.')
      return
    }
    try {
      await createProfile.mutateAsync({
        adapter,
        config_json: parseKeyValueInput(config),
        credentials_ref: credentialsRef.trim() || null,
        name: name.trim(),
        node_id: nodeId || nodes[0]?.id || '',
        port_reservations: [{ address: '0.0.0.0', exclusive: true, port: parsedPort, protocol: 'tcp' }],
        squad_id: squadId || null,
        status: 'active',
      })
      setName('')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Profile could not be created.')
    }
  }

  const selectedAdapter = adapters.find((item) => item.protocol === adapter)

  return (
    <ResourceScreen
      caption="Protocol profile inventory"
      columns={['Name', 'Adapter', 'Node', 'Squad', 'Ports', 'Config', 'Status', 'Actions']}
      createForm={
        <ScreenForm onSubmit={handleSubmit}>
          <div>
            <p className="eyebrow">Create profile</p>
            <h2>Xray config wrapper</h2>
            <p>Reserve ports and reference credentials by vault path only.</p>
          </div>
          <label htmlFor="profile-name">
            Name
            <input id="profile-name" required value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label htmlFor="profile-adapter">
            Adapter
            <select id="profile-adapter" value={adapter} onChange={(event) => setAdapter(event.target.value)}>
              {adapters.map((item) => (
                <option key={item.protocol} value={item.protocol}>
                  {item.display_name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="profile-node">
            Node
            <select id="profile-node" required value={nodeId} onChange={(event) => setNodeId(event.target.value)}>
              <option value="">Select node</option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="profile-squad">
            Squad
            <select id="profile-squad" value={squadId} onChange={(event) => setSquadId(event.target.value)}>
              <option value="">None</option>
              {squads.map((squad) => (
                <option key={squad.id} value={squad.id}>
                  {squad.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="profile-port">
            Port
            <input id="profile-port" inputMode="numeric" required value={port} onChange={(event) => setPort(event.target.value)} />
          </label>
          <label htmlFor="profile-credentials-ref">
            credentials_ref
            <input id="profile-credentials-ref" value={credentialsRef} onChange={(event) => setCredentialsRef(event.target.value)} />
          </label>
          <label htmlFor="profile-config">
            Config
            <textarea id="profile-config" value={config} onChange={(event) => setConfig(event.target.value)} />
          </label>
          <FormError message={formError} />
          <SubmitButton pending={createProfile.isPending}>Create profile</SubmitButton>
        </ScreenForm>
      }
      emptyDescription="Create protocol profiles after registering at least one node."
      emptyTitle="No profiles created"
      error={query.error}
      errorTitle="Profiles unavailable"
      isError={query.isError}
      isLoading={query.isLoading}
      isSuccess={query.isSuccess}
      items={profiles}
      loadingLabel="Loading profiles..."
      onRefresh={() => void query.refetch()}
      renderRow={(profile) => ({
        cells: [
          profile.name,
          profile.adapter,
          nodes.find((node) => node.id === profile.node_id)?.name ?? profile.node_id,
          squads.find((squad) => squad.id === profile.squad_id)?.name ?? 'None',
          profile.port_reservations.map((reservation) => `${String(reservation.port)}/${String(reservation.protocol ?? 'tcp')}`).join(', ') || 'None',
          formatRecord(profile.config_json),
          <StatusBadge tone={toneForStatus(profile.status)}>{profile.status}</StatusBadge>,
          <div className="inline-actions">
            <button
              type="button"
              className="icon-button"
              aria-label={`Edit ${profile.name}`}
              onClick={() => setSelectedProfileId(profile.id)}
            >
              <Save size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`${profile.status === 'active' ? 'Disable' : 'Enable'} ${profile.name}`}
              onClick={() =>
                void updateProfile.mutateAsync({
                  id: profile.id,
                  request: { status: profile.status === 'active' ? 'disabled' : 'active' },
                })
              }
            >
              <Ban size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Delete ${profile.name}`}
              onClick={() => void deleteProfile.mutateAsync(profile.id)}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>,
        ],
        id: profile.id,
      })}
      rightPanel={
        <div className="side-stack">
          <OperatorGuide
            title="Profile workflow"
            steps={[
              { detail: 'Pick the protocol adapter that matches the client app and transport.', label: 'Choose adapter' },
              { detail: 'Reserve an available port and keep exclusive protocols isolated.', label: 'Reserve port' },
              { detail: 'Attach the profile to a healthy node before sharing subscriptions.', label: 'Attach node', to: '/nodes' },
              { detail: 'Bind a hostname so client links use the public endpoint.', label: 'Bind host', to: '/hosts' },
            ]}
          />
          <article className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Adapter catalog</p>
                <h2>{selectedAdapter?.display_name ?? 'Protocol adapters'}</h2>
              </div>
              <StatusBadge>{`${adapters.length} adapters`}</StatusBadge>
            </div>
            <ul className="feature-list">
              {(selectedAdapter ? [selectedAdapter] : adapters).map((item) => (
                <li key={item.protocol}>
                  <span>{item.protocol}</span>
                  <span>{item.capabilities.join(', ')}</span>
                </li>
              ))}
            </ul>
          </article>
          <ProfileJsonEditor
            onSave={async (profile, request) => {
              await updateProfile.mutateAsync({ id: profile.id, request })
              await query.refetch()
            }}
            pending={updateProfile.isPending}
            profile={selectedProfile}
          />
        </div>
      }
      spec={sectionSpecs.profiles}
      tableEyebrow="Client delivery"
      tableTitle="Profile builder"
    />
  )
}

function ProfileJsonEditor({
  onSave,
  pending,
  profile,
}: {
  onSave: (
    profile: ProtocolProfileRecord,
    request: {
      config_json: Record<string, unknown>
      metadata_json: Record<string, unknown>
      port_reservations: Array<{ address?: string; exclusive?: boolean; port: number; protocol?: 'tcp' | 'udp' }>
      status: string
    },
  ) => Promise<void>
  pending: boolean
  profile: ProtocolProfileRecord | undefined
}) {
  const [configJson, setConfigJson] = useState('')
  const [metadataJson, setMetadataJson] = useState('')
  const [portsJson, setPortsJson] = useState('')
  const [status, setStatus] = useState('active')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!profile) {
      setConfigJson('')
      setMetadataJson('')
      setPortsJson('')
      setStatus('active')
      return
    }
    setConfigJson(JSON.stringify(profile.config_json, null, 2))
    setMetadataJson(JSON.stringify(profile.metadata_json, null, 2))
    setPortsJson(JSON.stringify(profile.port_reservations, null, 2))
    setStatus(profile.status)
  }, [profile])

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (!profile) {
      return
    }
    try {
      await onSave(profile, {
        config_json: parseJsonObject(configJson, 'config_json'),
        metadata_json: parseJsonObject(metadataJson, 'metadata_json'),
        port_reservations: parsePortReservations(portsJson),
        status,
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Profile could not be saved.')
    }
  }

  return (
    <ScreenForm onSubmit={handleSave}>
      <div>
        <p className="eyebrow">Xray JSON editor</p>
        <h2>{profile?.name ?? 'Select profile'}</h2>
        <p>Edit stored profile JSON and port reservations. Saved values go through the backend PATCH API.</p>
      </div>
      <label htmlFor="profile-editor-status">
        Status
        <select id="profile-editor-status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="active">active</option>
          <option value="disabled">disabled</option>
          <option value="installing">installing</option>
        </select>
      </label>
      <label htmlFor="profile-editor-config">
        config_json
        <textarea id="profile-editor-config" rows={8} value={configJson} onChange={(event) => setConfigJson(event.target.value)} />
      </label>
      <label htmlFor="profile-editor-metadata">
        metadata_json
        <textarea id="profile-editor-metadata" rows={5} value={metadataJson} onChange={(event) => setMetadataJson(event.target.value)} />
      </label>
      <label htmlFor="profile-editor-ports">
        port_reservations
        <textarea id="profile-editor-ports" rows={5} value={portsJson} onChange={(event) => setPortsJson(event.target.value)} />
      </label>
      <FormError message={error} />
      <SubmitButton pending={pending || !profile}>Save profile</SubmitButton>
    </ScreenForm>
  )
}

function parseJsonObject(value: string, fieldName: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value || '{}')
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${fieldName} must be a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

function parsePortReservations(
  value: string,
): Array<{ address?: string; exclusive?: boolean; port: number; protocol?: 'tcp' | 'udp' }> {
  const parsed: unknown = JSON.parse(value || '[]')
  if (!Array.isArray(parsed)) {
    throw new Error('port_reservations must be a JSON array.')
  }
  return parsed.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Each port reservation must be a JSON object.')
    }
    const reservation = entry as Record<string, unknown>
    if (typeof reservation.port !== 'number' || !Number.isInteger(reservation.port)) {
      throw new Error('Each port reservation needs an integer port.')
    }
    return {
      address: typeof reservation.address === 'string' ? reservation.address : '0.0.0.0',
      exclusive: typeof reservation.exclusive === 'boolean' ? reservation.exclusive : true,
      port: reservation.port,
      protocol: reservation.protocol === 'udp' ? 'udp' : 'tcp',
    }
  })
}
