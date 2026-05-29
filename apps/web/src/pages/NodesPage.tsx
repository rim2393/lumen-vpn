import { useMemo, useState, type FormEvent } from 'react'
import { CirclePause, HeartPulse, Plus, RefreshCw, ShieldAlert } from 'lucide-react'
import {
  useCreateNodeCommand,
  useCreateNodeProvisioningJob,
  useNodeCommandsData,
  useNodeMetricsData,
  useNodesPageData,
  usePauseNode,
  useQuarantineNode,
  useResumeNode,
} from '../shared/api/resourceHooks'
import type { NodeResponse, ProvisioningJobResponse } from '../shared/api/types'
import { DataTable } from '../shared/components/DataTable'
import { EmptyState, ErrorState, LoadingState } from '../shared/components/DataState'
import { OperatorGuide } from '../shared/components/OperatorGuide'
import { PageHeader } from '../shared/components/PageHeader'
import { StatusBadge } from '../shared/components/StatusBadge'
import type { MetricTone } from '../shared/data/resourceMeta'
import { sectionSpecs } from '../shared/data/resourceMeta'

type ProvisioningFormState = {
  capabilities: string
  credentialsRef: string
  name: string
  publicAddress: string
  region: string
  sshHost: string
  sshPort: string
  sshUsername: string
}

type NodeStatePresentation = {
  detail: string
  label: string
  tone: MetricTone
}

const initialFormState: ProvisioningFormState = {
  capabilities: 'service_manager=systemd',
  credentialsRef: '',
  name: '',
  publicAddress: '',
  region: '',
  sshHost: '',
  sshPort: '22',
  sshUsername: 'root',
}

const secretFieldFragments = [
  'password',
  'private_key',
  'privatekey',
  'secret',
  'subscription_url',
  'runtime_config',
  'token',
]

function normalizeStatus(status: string) {
  return status.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function formatStatus(status: string) {
  return normalizeStatus(status).replace(/_/g, ' ')
}

function getNodeState(status: string): NodeStatePresentation {
  switch (normalizeStatus(status)) {
    case 'active':
      return { detail: 'Heartbeat accepted by the control plane.', label: 'active', tone: 'good' }
    case 'provisioning':
      return { detail: 'Provisioning job created; waiting for preflight.', label: 'provisioning', tone: 'info' }
    case 'installing':
      return { detail: 'Install token exchanged; node agent is installing.', label: 'installing', tone: 'info' }
    case 'offline':
      return { detail: 'Heartbeat is stale or unavailable.', label: 'offline', tone: 'danger' }
    case 'failed':
      return { detail: 'Provisioning or heartbeat reported failure.', label: 'failed', tone: 'danger' }
    case 'deleted':
      return { detail: 'Node has been removed from active service.', label: 'deleted', tone: 'neutral' }
    case 'license_paused':
    case 'paused':
      return { detail: 'Paid capacity is paused by license policy.', label: 'license paused', tone: 'watch' }
    case 'quarantine':
    case 'quarantined':
      return { detail: 'Node is quarantined and should not receive traffic.', label: 'quarantined', tone: 'danger' }
    default:
      return { detail: 'Control plane returned an unrecognized node state.', label: formatStatus(status), tone: 'neutral' }
  }
}

function getJobTone(status: string): MetricTone {
  switch (normalizeStatus(status)) {
    case 'active':
      return 'good'
    case 'failed':
    case 'cancelled':
      return 'danger'
    case 'queued':
    case 'preflight_running':
    case 'preflight_passed':
    case 'install_token_issued':
    case 'installing':
      return 'info'
    default:
      return 'neutral'
  }
}

function getPreflightTone(status: string): MetricTone {
  switch (normalizeStatus(status)) {
    case 'passed':
      return 'good'
    case 'failed':
      return 'danger'
    case 'running':
      return 'info'
    default:
      return 'neutral'
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'The request could not be completed.'
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return 'Not recorded'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatCapabilities(capabilities: Record<string, string>) {
  const entries = Object.entries(capabilities)

  if (entries.length === 0) {
    return 'None reported'
  }

  return entries.map(([key, value]) => `${key}=${value}`).join(', ')
}

function parseCapabilities(value: string) {
  const capabilities: Record<string, string> = {}
  const rows = value
    .split(/[\n,]+/)
    .map((row) => row.trim())
    .filter(Boolean)

  for (const row of rows) {
    const separatorIndex = row.indexOf('=')
    if (separatorIndex <= 0 || separatorIndex === row.length - 1) {
      throw new Error('Capabilities must use key=value pairs separated by commas or new lines.')
    }

    const key = row.slice(0, separatorIndex).trim()
    const capabilityValue = row.slice(separatorIndex + 1).trim()
    const normalizedKey = key.replace(/-/g, '_').toLowerCase()

    if (secretFieldFragments.some((fragment) => normalizedKey.includes(fragment))) {
      throw new Error('Capability keys must not contain secret-like names.')
    }

    capabilities[key] = capabilityValue
  }

  return capabilities
}

function createIdempotencyKey() {
  const randomValue =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

  return `web-node-${randomValue}`
}

function parseCommandPayload(value: string) {
  const parsed: unknown = JSON.parse(value || '{}')
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Command payload must be a JSON object.')
  }
  return parsed as Record<string, unknown>
}

function getHeartbeatLabel(node: NodeResponse) {
  if (node.last_seen_at) {
    return `Last heartbeat ${formatTimestamp(node.last_seen_at)}`
  }

  const status = normalizeStatus(node.status)
  if (status === 'provisioning' || status === 'installing') {
    return 'Awaiting first heartbeat'
  }

  return 'Heartbeat missing'
}

function isLicensePaused(node: NodeResponse) {
  const status = normalizeStatus(node.status)
  return status === 'license_paused' || status === 'paused'
}

function isQuarantined(node: NodeResponse) {
  const status = normalizeStatus(node.status)
  return status === 'quarantine' || status === 'quarantined'
}

function canPauseNode(node: NodeResponse) {
  return !isLicensePaused(node) && !isQuarantined(node)
}

function canResumeNode(node: NodeResponse) {
  return isLicensePaused(node) || isQuarantined(node)
}

function canQuarantineNode(node: NodeResponse) {
  return !isQuarantined(node)
}

function hasMissingHeartbeat(node: NodeResponse) {
  const status = normalizeStatus(node.status)
  return !node.last_seen_at && status !== 'provisioning' && status !== 'installing'
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural
}

function ProvisioningJobPanel({ job }: { job: ProvisioningJobResponse | null }) {
  if (!job) {
    return (
      <article className="panel">
        <div className="panel__header">
          <div>
            <p className="eyebrow">Provisioning state</p>
            <h2>Install flow</h2>
          </div>
          <StatusBadge>idle</StatusBadge>
        </div>
        <ul className="feature-list">
          <li>
            <span aria-hidden="true">-</span>
            <span>Install token status will appear after a job is queued.</span>
          </li>
          <li>
            <span aria-hidden="true">-</span>
            <span>Token exchange is performed by the node agent; token values are not shown here.</span>
          </li>
          <li>
            <span aria-hidden="true">-</span>
            <span>Heartbeat state appears after the agent exchanges its one-time install token.</span>
          </li>
        </ul>
      </article>
    )
  }

  return (
    <article className="panel">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Provisioning state</p>
          <h2>{job.node_id}</h2>
        </div>
        <StatusBadge tone={getJobTone(job.status)}>{formatStatus(job.status)}</StatusBadge>
      </div>
      <div className="summary-grid">
        <div>
          <span>Preflight</span>
          <strong>
            <StatusBadge tone={getPreflightTone(job.preflight_status)}>
              {formatStatus(job.preflight_status)}
            </StatusBadge>
          </strong>
        </div>
        <div>
          <span>Credential reference</span>
          <strong>{job.ssh_credentials_ref}</strong>
        </div>
        <div>
          <span>SSH target</span>
          <strong>
            {job.ssh_username}@{job.ssh_host}:{job.ssh_port}
          </strong>
        </div>
      </div>
      <ul className="feature-list">
        <li>
          <span aria-hidden="true">-</span>
          <span>
            Install token:{' '}
            {job.token_issued_at
              ? `issued ${formatTimestamp(job.token_issued_at)}`
              : 'not issued; one-time plaintext is not displayed in this UI'}
          </span>
        </li>
        <li>
          <span aria-hidden="true">-</span>
          <span>
            Token exchange:{' '}
            {job.token_exchanged_at
              ? `completed ${formatTimestamp(job.token_exchanged_at)}`
              : 'pending node-agent exchange'}
          </span>
        </li>
        <li>
          <span aria-hidden="true">-</span>
          <span>Heartbeat endpoint: /api/v1/nodes/{job.node_id}/heartbeat</span>
        </li>
      </ul>
    </article>
  )
}

export function NodesPage() {
  const spec = sectionSpecs.nodes
  const query = useNodesPageData()
  const createJob = useCreateNodeProvisioningJob()
  const [form, setForm] = useState<ProvisioningFormState>(initialFormState)
  const [formError, setFormError] = useState<string | null>(null)
  const [latestJob, setLatestJob] = useState<ProvisioningJobResponse | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined)
  const [commandType, setCommandType] = useState('capabilities.report')
  const [commandPayload, setCommandPayload] = useState('{}')
  const [commandError, setCommandError] = useState<string | null>(null)
  const createCommand = useCreateNodeCommand()
  const pauseNode = usePauseNode()
  const resumeNode = useResumeNode()
  const quarantineNode = useQuarantineNode()
  const nodes = useMemo(() => query.data?.items ?? [], [query.data?.items])
  const selectedNode = selectedNodeId ? nodes.find((node) => node.id === selectedNodeId) : undefined
  const effectiveNodeId = selectedNode?.id
  const commandsQuery = useNodeCommandsData(effectiveNodeId)
  const metricsQuery = useNodeMetricsData(effectiveNodeId)
  const nodeStateSummary = useMemo(
    () => ({
      heartbeatMissing: nodes.filter(hasMissingHeartbeat).length,
      heartbeatReported: nodes.filter((node) => Boolean(node.last_seen_at)).length,
      licensePaused: nodes.filter(isLicensePaused).length,
      quarantined: nodes.filter(isQuarantined).length,
      total: nodes.length,
    }),
    [nodes],
  )
  const heartbeatStatus = useMemo(() => {
    if (!query.isSuccess) {
      return {
        label: 'loading',
        text: 'Heartbeat telemetry will be evaluated after the live API responds.',
        tone: 'neutral' as MetricTone,
      }
    }

    if (nodeStateSummary.total === 0) {
      return {
        label: 'no nodes',
        text: 'No nodes registered, so no heartbeat telemetry is available.',
        tone: 'neutral' as MetricTone,
      }
    }

    if (nodeStateSummary.heartbeatReported === 0) {
      return {
        label: 'telemetry pending',
        text: `No node has reported a heartbeat yet; ${nodeStateSummary.heartbeatMissing} ${pluralize(
          nodeStateSummary.heartbeatMissing,
          'node',
        )} missing heartbeat data.`,
        tone: 'watch' as MetricTone,
      }
    }

    return {
      label: 'heartbeat',
      text: `${nodeStateSummary.heartbeatReported} of ${nodeStateSummary.total} ${pluralize(
        nodeStateSummary.total,
        'node',
      )} reported heartbeat; ${nodeStateSummary.heartbeatMissing} ${pluralize(
        nodeStateSummary.heartbeatMissing,
        'node',
      )} missing heartbeat data.`,
      tone: nodeStateSummary.heartbeatMissing > 0 ? ('watch' as MetricTone) : ('good' as MetricTone),
    }
  }, [nodeStateSummary, query.isSuccess])

  async function handleProvisioningSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    let requestedCapabilities: Record<string, string>
    try {
      requestedCapabilities = parseCapabilities(form.capabilities)
    } catch (error) {
      setFormError(getErrorMessage(error))
      return
    }

    const sshPort = Number(form.sshPort)
    if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) {
      setFormError('SSH port must be an integer between 1 and 65535.')
      return
    }

    try {
      const job = await createJob.mutateAsync({
        idempotency_key: createIdempotencyKey(),
        kind: 'node.provision',
        node: {
          name: form.name.trim(),
          public_address: form.publicAddress.trim(),
          region: form.region.trim(),
        },
        requested_capabilities: requestedCapabilities,
        ssh: {
          credentials_ref: form.credentialsRef.trim(),
          host: form.sshHost.trim(),
          port: sshPort,
          username: form.sshUsername.trim(),
        },
      })
      setLatestJob(job)
    } catch {
      // The mutation error is rendered below from TanStack Query state.
    }
  }

  async function handleCommandSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCommandError(null)
    if (!effectiveNodeId) {
      setCommandError('Select a node first.')
      return
    }
    let payload: Record<string, unknown>
    try {
      payload = parseCommandPayload(commandPayload)
    } catch (error) {
      setCommandError(getErrorMessage(error))
      return
    }
    try {
      await createCommand.mutateAsync({
        id: effectiveNodeId,
        request: { command_type: commandType.trim(), payload_json: payload },
      })
      await commandsQuery.refetch()
    } catch {
      // Mutation error is rendered below.
    }
  }

  return (
    <section className="page">
      <PageHeader
        eyebrow={spec.eyebrow}
        title={spec.title}
        description="Register relay nodes through backend provisioning jobs, track heartbeat state, and avoid inline SSH secrets."
        actions={
          <button
            type="button"
            className="button button--secondary"
            aria-label="Refresh nodes"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw size={18} aria-hidden="true" />
            Refresh
          </button>
        }
      />

      {query.isLoading ? <LoadingState label="Loading nodes..." /> : null}
      {query.isError ? <ErrorState title="Nodes unavailable" error={query.error} /> : null}

      <section className="resource-grid">
        {query.isSuccess && nodes.length === 0 ? (
          <EmptyState
            title="No nodes registered"
            description="Create a provisioning job to register the first node through the backend contract."
          />
        ) : null}

        {query.isSuccess && nodes.length > 0 ? (
          <article className="panel panel--wide">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Infrastructure mesh</p>
                <h2>Node inventory</h2>
              </div>
              <StatusBadge>{`${nodes.length} nodes`}</StatusBadge>
            </div>
            <DataTable
              caption="Node provisioning and heartbeat inventory"
              columns={[
                'Node',
                'Region',
                'Public address',
                'Capabilities',
                'Heartbeat',
                'State',
                'Actions',
              ]}
              rows={nodes.map((node) => {
                const state = getNodeState(node.status)

                return {
                  cells: [
                    node.name,
                    node.region,
                    node.public_address,
                    formatCapabilities(node.capabilities),
                    getHeartbeatLabel(node),
                    <>
                      <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                      <br />
                      <small>{state.detail}</small>
                    </>,
                    <div className="inline-actions">
                      <button
                        type="button"
                        className="button button--secondary"
                        onClick={() => setSelectedNodeId(node.id)}
                      >
                        Inspect
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={!canPauseNode(node) || pauseNode.isPending}
                        onClick={() =>
                          void pauseNode.mutateAsync({
                            id: node.id,
                            request: { reason: 'operator requested', license_enforced: false },
                          })
                        }
                      >
                        Pause
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={!canResumeNode(node) || resumeNode.isPending}
                        onClick={() =>
                          void resumeNode.mutateAsync({
                            id: node.id,
                            request: {
                              clear_quarantine: isQuarantined(node),
                              target_status: 'offline',
                            },
                          })
                        }
                      >
                        Resume
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={!canQuarantineNode(node) || quarantineNode.isPending}
                        onClick={() =>
                          void quarantineNode.mutateAsync({
                            id: node.id,
                            request: { reason: 'operator quarantine' },
                          })
                        }
                      >
                        Quarantine
                      </button>
                    </div>,
                  ],
                  id: node.id,
                }
              })}
            />
          </article>
        ) : null}

        {selectedNode ? (
          <article className="panel panel--wide">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Node operations</p>
                <h2>{selectedNode.name}</h2>
              </div>
              <StatusBadge tone={getNodeState(selectedNode.status).tone}>
                {getNodeState(selectedNode.status).label}
              </StatusBadge>
            </div>
            <form className="screen-form" onSubmit={handleCommandSubmit}>
              <label htmlFor="node-command-type">
                Command type
                <select
                  id="node-command-type"
                  value={commandType}
                  onChange={(event) => setCommandType(event.target.value)}
                >
                  <option value="capabilities.report">capabilities.report</option>
                  <option value="conflict.scan">conflict.scan</option>
                  <option value="outbound.apply">outbound.apply</option>
                  <option value="outbound.remove">outbound.remove</option>
                  <option value="desired-state.validate">desired-state.validate</option>
                </select>
              </label>
              <label htmlFor="node-command-payload">
                Payload JSON
                <textarea
                  id="node-command-payload"
                  rows={4}
                  value={commandPayload}
                  onChange={(event) => setCommandPayload(event.target.value)}
                />
              </label>
              {commandError ? <p className="auth-card__note">{commandError}</p> : null}
              {createCommand.isError ? (
                <p className="auth-card__note">{getErrorMessage(createCommand.error)}</p>
              ) : null}
              <button
                type="submit"
                className="button button--primary"
                disabled={createCommand.isPending}
              >
                Queue command
              </button>
            </form>
            <DataTable
              caption="Node command queue"
              columns={['Command', 'Status', 'Payload', 'Result', 'Created']}
              rows={(commandsQuery.data?.items ?? []).map((command) => ({
                cells: [
                  command.command_type,
                  <StatusBadge tone={getNodeState(command.status).tone}>
                    {formatStatus(command.status)}
                  </StatusBadge>,
                  JSON.stringify(command.payload_json),
                  command.result_json ? JSON.stringify(command.result_json) : '-',
                  formatTimestamp(command.created_at),
                ],
                id: command.id,
              }))}
            />
            <DataTable
              caption="Node metrics"
              columns={['Kind', 'Values', 'Observed']}
              rows={(metricsQuery.data?.items ?? []).map((metric) => ({
                cells: [
                  metric.metric_kind,
                  Object.entries(metric.values_json)
                    .map(([key, value]) => `${key}=${value}`)
                    .join(', '),
                  formatTimestamp(metric.observed_at),
                ],
                id: metric.id,
              }))}
            />
          </article>
        ) : null}

        <form
          action="/api/v1/nodes/provisioning-jobs"
          className="auth-card"
          method="post"
          onSubmit={handleProvisioningSubmit}
        >
          <div>
            <p className="eyebrow">Provision node</p>
            <h2>Start provisioning</h2>
            <p id="provisioning-form-note">
              Submit SSH connection metadata with a vault-backed credentials_ref. Inline
              passwords, private keys, and tokens are not accepted.
            </p>
          </div>

          <label htmlFor="node-name">
            Node name
            <input
              id="node-name"
              name="name"
              required
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </label>

          <label htmlFor="node-region">
            Region
            <input
              id="node-region"
              name="region"
              required
              value={form.region}
              onChange={(event) =>
                setForm((current) => ({ ...current, region: event.target.value }))
              }
            />
          </label>

          <label htmlFor="node-public-address">
            Public address
            <input
              id="node-public-address"
              name="public_address"
              required
              value={form.publicAddress}
              onChange={(event) =>
                setForm((current) => ({ ...current, publicAddress: event.target.value }))
              }
            />
          </label>

          <label htmlFor="node-ssh-host">
            SSH host
            <input
              id="node-ssh-host"
              name="ssh_host"
              required
              value={form.sshHost}
              onChange={(event) =>
                setForm((current) => ({ ...current, sshHost: event.target.value }))
              }
            />
          </label>

          <label htmlFor="node-ssh-port">
            SSH port
            <input
              id="node-ssh-port"
              inputMode="numeric"
              name="ssh_port"
              pattern="[0-9]*"
              required
              value={form.sshPort}
              onChange={(event) =>
                setForm((current) => ({ ...current, sshPort: event.target.value }))
              }
            />
          </label>

          <label htmlFor="node-ssh-username">
            SSH username
            <input
              autoComplete="username"
              id="node-ssh-username"
              name="ssh_username"
              required
              value={form.sshUsername}
              onChange={(event) =>
                setForm((current) => ({ ...current, sshUsername: event.target.value }))
              }
            />
          </label>

          <label htmlFor="node-credentials-ref">
            credentials_ref
            <input
              autoComplete="off"
              id="node-credentials-ref"
              name="credentials_ref"
              required
              value={form.credentialsRef}
              onChange={(event) =>
                setForm((current) => ({ ...current, credentialsRef: event.target.value }))
              }
            />
          </label>

          <label htmlFor="node-capabilities">
            Requested capabilities
            <input
              id="node-capabilities"
              name="requested_capabilities"
              value={form.capabilities}
              onChange={(event) =>
                setForm((current) => ({ ...current, capabilities: event.target.value }))
              }
            />
          </label>

          {formError ? (
            <p className="auth-card__note" role="alert">
              {formError}
            </p>
          ) : null}
          {createJob.isError ? (
            <p className="auth-card__note" role="alert">
              {getErrorMessage(createJob.error)}
            </p>
          ) : null}
          {createJob.isSuccess ? (
            <p className="auth-card__note" aria-live="polite">
              Provisioning job queued.
            </p>
          ) : null}

          <button type="submit" className="button button--primary" disabled={createJob.isPending}>
            <Plus size={18} aria-hidden="true" />
            {createJob.isPending ? 'Starting...' : 'Start provisioning'}
          </button>
        </form>

        <article className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Runtime guardrails</p>
              <h2>Policy and heartbeat</h2>
            </div>
            <StatusBadge>live states</StatusBadge>
          </div>
          <ul className="feature-list">
            <li>
              <CirclePause size={18} aria-hidden="true" />
              <span>
                <StatusBadge tone="watch">license pause</StatusBadge>{' '}
                {nodeStateSummary.licensePaused} nodes paused by license policy.
              </span>
            </li>
            <li>
              <ShieldAlert size={18} aria-hidden="true" />
              <span>
                <StatusBadge tone="danger">quarantine</StatusBadge>{' '}
                {nodeStateSummary.quarantined} nodes isolated from traffic.
              </span>
            </li>
            <li>
              <HeartPulse size={18} aria-hidden="true" />
              <span>
                <StatusBadge tone={heartbeatStatus.tone}>{heartbeatStatus.label}</StatusBadge>{' '}
                {heartbeatStatus.text}
              </span>
            </li>
          </ul>
        </article>

        <OperatorGuide
          title="Node workflow"
          steps={[
            { detail: 'Start provisioning only with a vault credentials reference, never inline secrets.', label: 'Provision node' },
            { detail: 'Wait until heartbeat is active before assigning customer traffic.', label: 'Verify heartbeat' },
            { detail: 'Create a profile on the healthy node and reserve the protocol port.', label: 'Create profile', to: '/profiles' },
            { detail: 'Bind a public hostname after the profile exists.', label: 'Bind host', to: '/hosts' },
          ]}
        />

        <ProvisioningJobPanel job={latestJob} />
      </section>
    </section>
  )
}
