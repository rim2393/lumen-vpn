import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { CirclePause, HeartPulse, Plus, RefreshCw, ShieldAlert } from 'lucide-react'
import {
  useBulkNodes,
  useCreateNodeCommand,
  useCreateNodeProvisioningJob,
  useDeleteNode,
  useNodeCommandsData,
  useNodeMetricsData,
  useNodeOverviewData,
  useNodeProtocolSelectionData,
  useNodesPageData,
  usePauseNode,
  useQuarantineNode,
  useReorderNodes,
  useResetNodeTraffic,
  useRestartAllNodes,
  useRestartNode,
  useResumeNode,
  useUpdateNodeProtocolSelection,
} from '../shared/api/resourceHooks'
import type { NodeCommandRecord, NodeResponse, ProvisioningJobResponse } from '../shared/api/types'
import { DataTable } from '../shared/components/DataTable'
import { EmptyState, ErrorState, LoadingState } from '../shared/components/DataState'
import { OperatorGuide } from '../shared/components/OperatorGuide'
import { PageHeader } from '../shared/components/PageHeader'
import { StatusBadge } from '../shared/components/StatusBadge'
import type { MetricTone } from '../shared/data/resourceMeta'
import { sectionSpecs } from '../shared/data/resourceMeta'
import { useI18n } from '../shared/i18n/I18nProvider'
import { useSearchParams } from 'react-router-dom'

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

type NodeActionResult = {
  detail: string
  label: string
  nodeName: string
  tone: MetricTone
}

type PendingNodeAction =
  | { action: 'disable' | 'pause' | 'quarantine' | 'restart' | 'reset_traffic'; node: NodeResponse }
  | { action: 'restart_all' | 'reset_all_traffic' | 'pause_all' }

type NodeActionConfirmCopy = {
  confirmLabel: string
  detail: string
  title: string
  titleParams?: Record<string, string | number>
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

function formatBytes(value: number | null) {
  if (value === null) {
    return 'Not reported'
  }
  if (value < 1024) {
    return `${value.toFixed(0)} B`
  }
  const units = ['KB', 'MB', 'GB', 'TB']
  let normalized = value / 1024
  let unitIndex = 0
  while (normalized >= 1024 && unitIndex < units.length - 1) {
    normalized /= 1024
    unitIndex += 1
  }
  return `${normalized.toFixed(normalized >= 10 ? 1 : 2)} ${units[unitIndex]}`
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

function pendingControlCommand(node: NodeResponse) {
  const commandId = node.capabilities.pending_control_command_id
  const commandType = node.capabilities.pending_control_command_type
  if (!commandId && !commandType) {
    return null
  }
  return {
    commandId,
    commandType,
    targetStatus: node.capabilities.pending_control_target_status,
  }
}

function nodeActionResultFromNode(
  label: string,
  node: NodeResponse,
  detail: string,
): NodeActionResult {
  return {
    detail,
    label,
    nodeName: node.name,
    tone: getNodeState(node.status).tone,
  }
}

function nodeActionResultFromCommand(
  label: string,
  node: NodeResponse,
  command: NodeCommandRecord,
): NodeActionResult {
  return {
    detail: `${command.command_type} queued as ${command.id}; status ${formatStatus(command.status)}.`,
    label,
    nodeName: node.name,
    tone: 'info',
  }
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural
}

function ProvisioningJobPanel({
  job,
  t,
}: {
  job: ProvisioningJobResponse | null
  t: (value: string) => string
}) {
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
        <StatusBadge tone={getJobTone(job.status)}>{t(formatStatus(job.status))}</StatusBadge>
      </div>
      <div className="summary-grid">
        <div>
          <span>Preflight</span>
          <strong>
            <StatusBadge tone={getPreflightTone(job.preflight_status)}>
              {t(formatStatus(job.preflight_status))}
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

function NodeDeleteConfirm({
  node,
  onCancel,
  onConfirm,
  pending,
}: {
  node: NodeResponse
  onCancel: () => void
  onConfirm: () => void
  pending: boolean
}) {
  const { t } = useI18n()
  return (
    <section
      className="danger-confirm-inline"
      role="alertdialog"
      aria-modal="false"
      aria-label={t('Delete node {name}', { name: node.name })}
    >
      <div>
        <p className="eyebrow">{t('Production API confirmation')}</p>
        <h3>{t('Delete node {name}', { name: node.name })}</h3>
        <p>{t('This real node will be marked deleted through the live API and removed from active service after the control command is queued.')}</p>
      </div>
      <div className="inline-actions inline-actions--compact">
        <button type="button" className="button button--secondary" disabled={pending} onClick={onCancel}>
          {t('Cancel')}
        </button>
        <button type="button" className="button button--danger" disabled={pending} onClick={onConfirm}>
          {pending ? t('Deleting...') : t('Delete')}
        </button>
      </div>
    </section>
  )
}

function describePendingNodeAction(action: PendingNodeAction): NodeActionConfirmCopy {
  switch (action.action) {
    case 'disable':
      return {
        confirmLabel: 'Disable',
        detail:
          'This queues a real pause command. Customer traffic must stop after node-agent applies the command.',
        title: 'Disable node {name}',
        titleParams: { name: action.node.name },
        tone: 'watch',
      }
    case 'pause':
      return {
        confirmLabel: 'Pause',
        detail:
          'This queues a real node pause command and removes the node from active customer delivery.',
        title: 'Pause node {name}',
        titleParams: { name: action.node.name },
        tone: 'watch',
      }
    case 'quarantine':
      return {
        confirmLabel: 'Quarantine',
        detail:
          'This marks the node as quarantined through the live API. The node should not receive customer traffic.',
        title: 'Quarantine node {name}',
        titleParams: { name: action.node.name },
        tone: 'danger',
      }
    case 'restart':
      return {
        confirmLabel: 'Restart',
        detail:
          'This queues node.restart for the real node-agent container. Active sessions on this node can disconnect.',
        title: 'Restart node {name}',
        titleParams: { name: action.node.name },
        tone: 'watch',
      }
    case 'reset_traffic':
      return {
        confirmLabel: 'Reset traffic',
        detail:
          'This queues a real traffic counter reset for the selected node. Historical counters can change after node-agent applies it.',
        title: 'Reset traffic on {name}',
        titleParams: { name: action.node.name },
        tone: 'danger',
      }
    case 'restart_all':
      return {
        confirmLabel: 'Restart all',
        detail:
          'This queues node.restart for every registered node through the production control API.',
        title: 'Restart all nodes',
        tone: 'danger',
      }
    case 'reset_all_traffic':
      return {
        confirmLabel: 'Reset all traffic',
        detail:
          'This queues real traffic resets for every registered node. Use only after confirming billing and traffic reporting expectations.',
        title: 'Reset all node traffic',
        tone: 'danger',
      }
    case 'pause_all':
      return {
        confirmLabel: 'Pause all',
        detail:
          'This queues real pause commands for every registered node and can stop customer traffic across the fleet.',
        title: 'Pause all nodes',
        tone: 'danger',
      }
  }
}

function NodeActionConfirm({
  action,
  onCancel,
  onConfirm,
  pending,
}: {
  action: PendingNodeAction
  onCancel: () => void
  onConfirm: () => void
  pending: boolean
}) {
  const { t } = useI18n()
  const copy = describePendingNodeAction(action)
  const title = t(copy.title, copy.titleParams)
  return (
    <section
      className="danger-confirm-inline node-action-confirm"
      role="alertdialog"
      aria-modal="false"
      aria-label={title}
    >
      <div>
        <p className="eyebrow">{t('Production API confirmation')}</p>
        <h3>{title}</h3>
        <p>{t(copy.detail)}</p>
      </div>
      <div className="inline-actions inline-actions--compact">
        <StatusBadge tone={copy.tone}>{t('real API')}</StatusBadge>
        <button type="button" className="button button--secondary" disabled={pending} onClick={onCancel}>
          {t('Cancel')}
        </button>
        <button type="button" className="button button--danger" disabled={pending} onClick={onConfirm}>
          {pending ? t('Applying...') : t(copy.confirmLabel)}
        </button>
      </div>
    </section>
  )
}

export function NodesPage() {
  const { t } = useI18n()
  const spec = sectionSpecs.nodes
  const query = useNodesPageData()
  const [searchParams, setSearchParams] = useSearchParams()
  const createJob = useCreateNodeProvisioningJob()
  const [form, setForm] = useState<ProvisioningFormState>(initialFormState)
  const [formError, setFormError] = useState<string | null>(null)
  const [latestJob, setLatestJob] = useState<ProvisioningJobResponse | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined)
  const [commandType, setCommandType] = useState('capabilities.report')
  const [commandPayload, setCommandPayload] = useState('{}')
  const [commandError, setCommandError] = useState<string | null>(null)
  const [protocolSelection, setProtocolSelection] = useState<string[]>([])
  const [protocolSelectionError, setProtocolSelectionError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionResult, setActionResult] = useState<NodeActionResult | null>(null)
  const [pendingDeleteNode, setPendingDeleteNode] = useState<NodeResponse | null>(null)
  const [pendingNodeAction, setPendingNodeAction] = useState<PendingNodeAction | null>(null)
  const createCommand = useCreateNodeCommand()
  const updateNodeProtocols = useUpdateNodeProtocolSelection()
  const pauseNode = usePauseNode()
  const resumeNode = useResumeNode()
  const quarantineNode = useQuarantineNode()
  const deleteNode = useDeleteNode()
  const reorderNodes = useReorderNodes()
  const bulkNodes = useBulkNodes()
  const restartNode = useRestartNode()
  const restartAllNodes = useRestartAllNodes()
  const resetNodeTraffic = useResetNodeTraffic()
  const nodes = useMemo(() => query.data?.items ?? [], [query.data?.items])
  const selectedNode = selectedNodeId ? nodes.find((node) => node.id === selectedNodeId) : undefined
  const effectiveNodeId = selectedNode?.id
  const commandsQuery = useNodeCommandsData(effectiveNodeId)
  const metricsQuery = useNodeMetricsData(effectiveNodeId)
  const overviewQuery = useNodeOverviewData(effectiveNodeId)
  const protocolSelectionQuery = useNodeProtocolSelectionData(effectiveNodeId)
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
  const savedProtocolSelection = useMemo(
    () =>
      protocolSelectionQuery.data?.items
        .filter((item) => item.enabled)
        .map((item) => item.profile_id) ?? [],
    [protocolSelectionQuery.data?.items],
  )
  const protocolSelectionChanges = useMemo(() => {
    const saved = new Set(savedProtocolSelection)
    const next = new Set(protocolSelection)
    const enabled = protocolSelection.filter((profileId) => !saved.has(profileId)).length
    const disabled = savedProtocolSelection.filter((profileId) => !next.has(profileId)).length
    return { disabled, enabled, total: enabled + disabled }
  }, [protocolSelection, savedProtocolSelection])

  useEffect(() => {
    const focusNodeId = searchParams.get('focus')
    if (!focusNodeId) {
      return
    }
    const exists = nodes.some((node) => node.id === focusNodeId)
    if (exists) {
      const timer = globalThis.setTimeout(() => setSelectedNodeId(focusNodeId), 0)
      return () => globalThis.clearTimeout(timer)
    }
  }, [nodes, searchParams])

  useEffect(() => {
    if (!selectedNodeId) {
      return
    }
    if (searchParams.get('focus') === selectedNodeId) {
      return
    }
    const nextSearch = new URLSearchParams(searchParams)
    nextSearch.set('focus', selectedNodeId)
    setSearchParams(nextSearch, { replace: true })
  }, [searchParams, selectedNodeId, setSearchParams])

  useEffect(() => {
    const timer = globalThis.setTimeout(() => setProtocolSelection(savedProtocolSelection), 0)
    return () => globalThis.clearTimeout(timer)
  }, [savedProtocolSelection])

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
      const command = await createCommand.mutateAsync({
        id: effectiveNodeId,
        request: { command_type: commandType.trim(), payload_json: payload },
      })
      setActionResult(nodeActionResultFromCommand('command queued', selectedNode, command))
      await commandsQuery.refetch()
    } catch {
      // Mutation error is rendered below.
    }
  }

  function toggleProtocolSelection(profileId: string) {
    setProtocolSelection((current) =>
      current.includes(profileId)
        ? current.filter((item) => item !== profileId)
        : [...current, profileId],
    )
  }

  async function handleProtocolSelectionSubmit() {
    setProtocolSelectionError(null)
    setActionResult(null)
    if (!effectiveNodeId || !selectedNode) {
      setProtocolSelectionError('Select a node first.')
      return
    }
    try {
      const response = await updateNodeProtocols.mutateAsync({
        nodeId: effectiveNodeId,
        request: { enabled_profile_ids: protocolSelection },
      })
      setActionResult({
        detail: `${response.queued_commands.length} runtime ${pluralize(
          response.queued_commands.length,
          'command',
        )} queued. Node-agent will apply the enabled protocol set from the real backend queue.`,
        label: 'protocols queued',
        nodeName: selectedNode.name,
        tone: 'info',
      })
      await commandsQuery.refetch()
      await protocolSelectionQuery.refetch()
      await overviewQuery.refetch()
    } catch (error) {
      setProtocolSelectionError(getErrorMessage(error))
    }
  }

  async function runNodeAction<T>(
    label: string,
    node: NodeResponse,
    action: () => Promise<T>,
    describe: (result: T) => NodeActionResult,
  ) {
    setActionError(null)
    setActionResult(null)
    try {
      const result = await action()
      setActionResult(describe(result))
      await query.refetch()
      if (effectiveNodeId === node.id) {
        await commandsQuery.refetch()
        await metricsQuery.refetch()
        await overviewQuery.refetch()
      }
    } catch (error) {
      setActionError(`${label} failed for ${node.name}: ${getErrorMessage(error)}`)
    }
  }

  async function runGlobalNodeAction<T>(
    label: string,
    action: () => Promise<T>,
    describe: (result: T) => NodeActionResult,
  ) {
    setActionError(null)
    setActionResult(null)
    try {
      const result = await action()
      setActionResult(describe(result))
      await query.refetch()
    } catch (error) {
      setActionError(`${label} failed: ${getErrorMessage(error)}`)
    }
  }

  const actionPending =
    pauseNode.isPending ||
    resumeNode.isPending ||
    quarantineNode.isPending ||
    restartNode.isPending ||
    restartAllNodes.isPending ||
    resetNodeTraffic.isPending ||
    bulkNodes.isPending

  async function confirmPendingNodeAction() {
    if (!pendingNodeAction) {
      return
    }

    const action = pendingNodeAction
    if (action.action === 'disable') {
      await runNodeAction(
        'Disable node',
        action.node,
        () =>
          pauseNode.mutateAsync({
            id: action.node.id,
            request: { reason: 'operator disabled node', license_enforced: false },
          }),
        (updatedNode) =>
          nodeActionResultFromNode(
            'disabled',
            updatedNode,
            'Node pause command was recorded and runtime traffic will stop after node-agent applies it.',
          ),
      )
    } else if (action.action === 'pause') {
      await runNodeAction(
        'Pause node',
        action.node,
        () =>
          pauseNode.mutateAsync({
            id: action.node.id,
            request: { reason: 'operator requested', license_enforced: false },
          }),
        (updatedNode) =>
          nodeActionResultFromNode(
            'paused',
            updatedNode,
            'Node pause command was recorded against the real control plane.',
          ),
      )
    } else if (action.action === 'quarantine') {
      await runNodeAction(
        'Quarantine node',
        action.node,
        () =>
          quarantineNode.mutateAsync({
            id: action.node.id,
            request: { reason: 'operator quarantine' },
          }),
        (updatedNode) =>
          nodeActionResultFromNode(
            'quarantined',
            updatedNode,
            'Node quarantine command was recorded and this node should not receive traffic.',
          ),
      )
    } else if (action.action === 'restart') {
      await runNodeAction(
        'Restart node',
        action.node,
        () => restartNode.mutateAsync(action.node.id),
        (command) => nodeActionResultFromCommand('restart queued', action.node, command),
      )
    } else if (action.action === 'reset_traffic') {
      await runNodeAction(
        'Reset node traffic',
        action.node,
        () => resetNodeTraffic.mutateAsync(action.node.id),
        (command) => nodeActionResultFromCommand('traffic reset queued', action.node, command),
      )
    } else if (action.action === 'restart_all') {
      await runGlobalNodeAction(
        'Restart all nodes',
        () => restartAllNodes.mutateAsync(),
        (commands) => ({
          detail: `${commands.items.length} restart commands queued through the real node command API.`,
          label: 'restart all queued',
          nodeName: 'All nodes',
          tone: 'info',
        }),
      )
    } else if (action.action === 'reset_all_traffic') {
      await runGlobalNodeAction(
        'Reset all node traffic',
        () =>
          bulkNodes.mutateAsync({
            action: 'reset_traffic',
            ids: nodes.map((node) => node.id),
            reason: 'operator bulk reset traffic',
          }),
        (response) => ({
          detail: `${response.items.length} nodes accepted the traffic reset request.`,
          label: 'bulk reset queued',
          nodeName: 'All nodes',
          tone: 'info',
        }),
      )
    } else if (action.action === 'pause_all') {
      await runGlobalNodeAction(
        'Pause all nodes',
        () =>
          bulkNodes.mutateAsync({
            action: 'pause',
            ids: nodes.map((node) => node.id),
            reason: 'operator bulk pause',
          }),
        (response) => ({
          detail: `${response.items.length} nodes accepted the pause request.`,
          label: 'bulk pause queued',
          nodeName: 'All nodes',
          tone: 'watch',
        }),
      )
    }

    setPendingNodeAction(null)
  }

  return (
    <section className="page nodes-page">
      <PageHeader
        eyebrow={spec.eyebrow}
        title={spec.title}
        description="Register relay nodes through backend provisioning jobs, track heartbeat state, and avoid inline SSH secrets."
        actions={
          <div className="inline-actions">
            <button
              type="button"
              className="button button--secondary"
              aria-label={t('Refresh nodes')}
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              <RefreshCw size={18} aria-hidden="true" />
              {t('Refresh')}
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={actionPending || nodes.length === 0}
              onClick={() => setPendingNodeAction({ action: 'restart_all' })}
            >
              {t('Restart all')}
            </button>
          </div>
        }
      />

      {query.isLoading ? <LoadingState label="Loading nodes..." /> : null}
      {query.isError ? <ErrorState title="Nodes unavailable" error={query.error} /> : null}
      {actionError ? (
        <article className="panel" role="alert">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{t('Node action failed')}</p>
              <h2>{t('Action result')}</h2>
            </div>
            <StatusBadge tone="danger">{t('failed')}</StatusBadge>
          </div>
          <p>{actionError}</p>
        </article>
      ) : null}
      {actionResult ? (
        <article className="panel" aria-live="polite">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{t('Last node action')}</p>
              <h2>{actionResult.nodeName}</h2>
            </div>
            <StatusBadge tone={actionResult.tone}>{t(actionResult.label)}</StatusBadge>
          </div>
          <p>{actionResult.detail}</p>
        </article>
      ) : null}
      {pendingNodeAction ? (
        <NodeActionConfirm
          action={pendingNodeAction}
          pending={actionPending}
          onCancel={() => setPendingNodeAction(null)}
          onConfirm={() => void confirmPendingNodeAction()}
        />
      ) : null}

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
                <p className="eyebrow">{t('Infrastructure mesh')}</p>
                <h2>{t('Node inventory')}</h2>
              </div>
              <StatusBadge>{t('{count} nodes', { count: nodes.length })}</StatusBadge>
            </div>
            {pendingDeleteNode ? (
              <NodeDeleteConfirm
                node={pendingDeleteNode}
                pending={deleteNode.isPending}
                onCancel={() => setPendingDeleteNode(null)}
                onConfirm={() => {
                  void runNodeAction(
                    'Delete node',
                    pendingDeleteNode,
                    () => deleteNode.mutateAsync(pendingDeleteNode.id),
                    (updatedNode) =>
                      nodeActionResultFromNode(
                        'deleted',
                        updatedNode,
                        'Node was marked deleted and a pause command was queued before removal from active service.',
                      ),
                  ).then(() => {
                    setPendingDeleteNode(null)
                  })
                }}
              />
            ) : null}
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
                const pendingControl = pendingControlCommand(node)
                const hasPendingControl = pendingControl !== null

                return {
                  cells: [
                    node.name,
                    node.region,
                    node.public_address,
                    formatCapabilities(node.capabilities),
                    t(getHeartbeatLabel(node)),
                    <>
                      <StatusBadge tone={state.tone}>{t(state.label)}</StatusBadge>
                      <br />
                      <small>{t(state.detail)}</small>
                      {pendingControl ? (
                        <>
                          <br />
                          <small>
                            {t('Pending control command')}: {pendingControl.commandType ?? t('unknown')}{' '}
                            {pendingControl.targetStatus ? `-> ${pendingControl.targetStatus}` : ''}
                          </small>
                        </>
                      ) : null}
                    </>,
                    <div className="inline-actions">
                      <button
                        type="button"
                        className="button button--secondary"
                        onClick={() => {
                          setSelectedNodeId(node.id)
                        }}
                      >
                        {t('Inspect')}
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={
                          hasPendingControl ||
                          actionPending ||
                          (normalizeStatus(node.status) === 'active'
                            ? pauseNode.isPending
                            : resumeNode.isPending)
                        }
                        onClick={() => {
                          if (normalizeStatus(node.status) === 'active') {
                            setPendingNodeAction({ action: 'disable', node })
                            return
                          }
                          void runNodeAction(
                            'Enable node',
                            node,
                            () =>
                              resumeNode.mutateAsync({
                                id: node.id,
                                request: { clear_quarantine: isQuarantined(node), target_status: 'offline' },
                              }),
                            (updatedNode) =>
                              nodeActionResultFromNode(
                                'enabled',
                                updatedNode,
                                'Node resume command was recorded; heartbeat must return before customer traffic is healthy.',
                              ),
                          )
                        }}
                      >
                        {normalizeStatus(node.status) === 'active' ? t('Disable') : t('Enable')}
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={hasPendingControl || !canPauseNode(node) || actionPending}
                        onClick={() => setPendingNodeAction({ action: 'pause', node })}
                      >
                        {t('Pause')}
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={hasPendingControl || !canResumeNode(node) || resumeNode.isPending}
                        onClick={() =>
                          void runNodeAction(
                            'Resume node',
                            node,
                            () =>
                              resumeNode.mutateAsync({
                                id: node.id,
                                request: {
                                  clear_quarantine: isQuarantined(node),
                                  target_status: 'offline',
                                },
                              }),
                            (updatedNode) =>
                              nodeActionResultFromNode(
                                'resumed',
                                updatedNode,
                                'Node resume command was recorded and quarantine flag is cleared when requested.',
                              ),
                          )
                        }
                      >
                        {t('Resume')}
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={hasPendingControl || !canQuarantineNode(node) || actionPending}
                        onClick={() => setPendingNodeAction({ action: 'quarantine', node })}
                      >
                        {t('Quarantine')}
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={hasPendingControl || actionPending}
                        onClick={() => setPendingNodeAction({ action: 'restart', node })}
                      >
                        {t('Restart')}
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={actionPending}
                        onClick={() => setPendingNodeAction({ action: 'reset_traffic', node })}
                      >
                        {t('Reset traffic')}
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={hasPendingControl || deleteNode.isPending}
                        onClick={() => setPendingDeleteNode(node)}
                      >
                        {t('Delete')}
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
                <p className="eyebrow">{t('Node operations')}</p>
                <h2>{selectedNode.name}</h2>
              </div>
              <StatusBadge tone={getNodeState(selectedNode.status).tone}>
                {t(getNodeState(selectedNode.status).label)}
              </StatusBadge>
            </div>
            {overviewQuery.isLoading ? <LoadingState label="Loading node overview..." /> : null}
            {overviewQuery.isError ? (
              <ErrorState title="Node overview unavailable" error={overviewQuery.error} />
            ) : null}
            {overviewQuery.data ? (
              <>
                <section className="summary-grid" aria-label={t('Node live overview')}>
                  <div>
                    <span>{t('Download')}</span>
                    <strong>{formatBytes(overviewQuery.data.traffic.download_bytes)}</strong>
                  </div>
                  <div>
                    <span>{t('Upload')}</span>
                    <strong>{formatBytes(overviewQuery.data.traffic.upload_bytes)}</strong>
                  </div>
                  <div>
                    <span>{t('Total traffic')}</span>
                    <strong>{formatBytes(overviewQuery.data.traffic.total_bytes)}</strong>
                  </div>
                  <div>
                    <span>{t('Metric samples')}</span>
                    <strong>{overviewQuery.data.traffic.metric_samples}</strong>
                  </div>
                  {overviewQuery.data.infra_billing_totals.length === 0 ? (
                    <div>
                      <span>{t('Node infra cost')}</span>
                      <strong>{t('No node-linked records')}</strong>
                    </div>
                  ) : (
                    overviewQuery.data.infra_billing_totals.map((total) => (
                      <div key={total.currency}>
                        <span>{t('Node infra cost')} {total.currency}</span>
                        <strong>{total.total.toFixed(2)}</strong>
                      </div>
                    ))
                  )}
                </section>
                {overviewQuery.data.traffic.total_bytes === null ? (
                  <p className="auth-card__note">
                    {t('Byte counters have not been reported by this node yet.')}
                  </p>
                ) : null}
                <DataTable
                  caption={t('Command history summary')}
                  columns={[t('Status'), t('Count')]}
                  rows={overviewQuery.data.command_status_counts.map((item) => ({
                    cells: [t(formatStatus(item.status)), item.count],
                    id: item.status,
                  }))}
                />
                <DataTable
                  caption={t('Node infra billing history')}
                  columns={[t('Provider'), t('Period'), t('Amount'), t('Currency'), t('Note')]}
                  rows={overviewQuery.data.infra_billing_records.map((record) => ({
                    cells: [
                      record.provider_name,
                      record.period,
                      record.amount.toFixed(2),
                      record.currency,
                      record.note ?? '-',
                    ],
                    id: record.id,
                  }))}
                />
              </>
            ) : null}
            <section className="auth-card" aria-labelledby="node-protocol-selection-title">
              <div className="panel__header">
                <div>
                  <p className="eyebrow">{t('Runtime protocols')}</p>
                  <h3 id="node-protocol-selection-title">{t('Enabled protocols on this node')}</h3>
                </div>
                <span className="inline-actions inline-actions--compact">
                  <StatusBadge>
                    {`${protocolSelection.length}/${protocolSelectionQuery.data?.items.length ?? 0}`}
                  </StatusBadge>
                  {protocolSelectionChanges.total > 0 ? (
                    <StatusBadge tone="watch">
                      {t('{count} pending changes', { count: protocolSelectionChanges.total })}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="good">{t('in sync')}</StatusBadge>
                  )}
                </span>
              </div>
              {protocolSelectionQuery.isLoading ? (
                <LoadingState label="Loading node protocol selection..." />
              ) : null}
              {protocolSelectionQuery.isError ? (
                <ErrorState
                  title="Node protocol selection unavailable"
                  error={protocolSelectionQuery.error}
                />
              ) : null}
              {protocolSelectionQuery.data?.items.length === 0 ? (
                <EmptyState
                  title="No protocol profiles on this node"
                  description="Create real protocol profiles for this node before enabling runtime protocols."
                />
              ) : null}
              {protocolSelectionQuery.data?.items.length ? (
                <>
                  <div className="node-protocol-matrix">
                    <DataTable
                      caption={t('Node protocol assignment matrix')}
                      columns={[
                        t('Enabled'),
                        t('Profile'),
                        t('Adapter'),
                        t('Profile status'),
                        t('Runtime sync'),
                      ]}
                      rows={protocolSelectionQuery.data.items.map((item) => {
                        const enabled = protocolSelection.includes(item.profile_id)
                        const savedEnabled = savedProtocolSelection.includes(item.profile_id)
                        const syncStatus =
                          typeof item.runtime_sync?.status === 'string'
                            ? item.runtime_sync.status
                            : 'never_applied'
                        const rowState =
                          enabled === savedEnabled
                            ? enabled
                              ? t('enabled')
                              : t('disabled')
                            : enabled
                              ? t('will be enabled')
                              : t('will be disabled')
                        return {
                          cells: [
                            <label
                              key="enabled"
                              className="node-protocol-toggle"
                              title={t('Toggle this real profile on the selected node')}
                            >
                              <input
                                aria-label={t('Toggle protocol {name}', { name: item.name })}
                                type="checkbox"
                                checked={enabled}
                                disabled={updateNodeProtocols.isPending}
                                onChange={() => toggleProtocolSelection(item.profile_id)}
                              />
                              <span>{rowState}</span>
                            </label>,
                            <span key="profile" className="cell-stack">
                              <strong>{item.name}</strong>
                              <small>{item.profile_id}</small>
                            </span>,
                            item.adapter,
                            <StatusBadge key="profile-status" tone={item.status === 'active' ? 'good' : 'watch'}>
                              {t(formatStatus(item.status))}
                            </StatusBadge>,
                            <StatusBadge key="runtime-status" tone={syncStatus === 'applied' ? 'good' : 'watch'}>
                              {t(formatStatus(syncStatus))}
                            </StatusBadge>,
                          ],
                          id: item.profile_id,
                        }
                      })}
                    />
                  </div>
                  {protocolSelectionChanges.total > 0 ? (
                    <p className="auth-card__note" role="status">
                      {t('Pending node protocol changes')}: +{protocolSelectionChanges.enabled} / -
                      {protocolSelectionChanges.disabled}. {t('Update protocols queues real runtime apply commands.')}
                    </p>
                  ) : null}
                  {protocolSelectionError ? (
                    <p className="auth-card__note" role="alert">
                      {protocolSelectionError}
                    </p>
                  ) : null}
                  {updateNodeProtocols.isError ? (
                    <p className="auth-card__note" role="alert">
                      {getErrorMessage(updateNodeProtocols.error)}
                    </p>
                  ) : null}
                  <div className="inline-actions">
                    <button
                      type="button"
                      className="button button--primary"
                      disabled={updateNodeProtocols.isPending || protocolSelectionChanges.total === 0}
                      onClick={() => void handleProtocolSelectionSubmit()}
                    >
                      {t('Update protocols')}
                    </button>
                    <button
                      type="button"
                      className="button button--secondary"
                      disabled={updateNodeProtocols.isPending || protocolSelectionChanges.total === 0}
                      onClick={() => setProtocolSelection(savedProtocolSelection)}
                    >
                      {t('Discard changes')}
                    </button>
                    <button
                      type="button"
                      className="button button--secondary"
                      disabled={protocolSelectionQuery.isFetching}
                      onClick={() => void protocolSelectionQuery.refetch()}
                    >
                      {t('Refresh')}
                    </button>
                  </div>
                </>
              ) : null}
            </section>
            <form className="screen-form" onSubmit={handleCommandSubmit}>
              <label htmlFor="node-command-type">
                {t('Command type')}
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
                {t('Payload JSON')}
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
                {t('Queue command')}
              </button>
            </form>
            <DataTable
              caption={t('Node command queue')}
              columns={[
                t('Command'),
                t('Status'),
                t('Payload'),
                t('Result'),
                t('Created'),
              ]}
              rows={(commandsQuery.data?.items ?? []).map((command) => ({
                cells: [
                  command.command_type,
                  <StatusBadge tone={getNodeState(command.status).tone}>
                    {t(formatStatus(command.status))}
                  </StatusBadge>,
                  JSON.stringify(command.payload_json),
                  command.result_json ? JSON.stringify(command.result_json) : '-',
                  formatTimestamp(command.created_at),
                ],
                id: command.id,
              }))}
            />
            <DataTable
              caption={t('Node metrics')}
              columns={[t('Kind'), t('Values'), t('Observed')]}
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

        {query.isSuccess && nodes.length > 0 ? (
          <article className="panel panel--wide">
            <div className="panel__header">
              <div>
                <p className="eyebrow">{t('Bulk operations')}</p>
                <h2>{t('Node management')}</h2>
              </div>
              <StatusBadge>real API</StatusBadge>
            </div>
            <div className="inline-actions">
              <button
                type="button"
                className="button button--secondary"
                disabled={reorderNodes.isPending}
                onClick={() =>
                  void runGlobalNodeAction(
                    'Reverse node order',
                    () =>
                      reorderNodes.mutateAsync({
                        items: nodes.map((node, index) => ({
                          id: node.id,
                          sort_order: nodes.length - index,
                        })),
                      }),
                    (response) => ({
                      detail: `${response.items.length} nodes reordered and refreshed from the backend.`,
                      label: 'order saved',
                      nodeName: 'Node inventory',
                      tone: 'good',
                    }),
                  )
                }
              >
                {t('Reverse order')}
              </button>
              <button
                type="button"
                className="button button--secondary"
                disabled={actionPending}
                onClick={() => setPendingNodeAction({ action: 'reset_all_traffic' })}
              >
                {t('Reset all traffic')}
              </button>
              <button
                type="button"
                className="button button--secondary"
                disabled={actionPending}
                onClick={() => setPendingNodeAction({ action: 'pause_all' })}
              >
                {t('Pause all')}
              </button>
            </div>
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

        <ProvisioningJobPanel job={latestJob} t={t} />
      </section>
    </section>
  )
}
