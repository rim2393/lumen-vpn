import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Activity, Ban, Fingerprint, Flame, Globe2, KeyRound, Radar, Route, ScrollText, Trash2 } from 'lucide-react'
import {
  useBuildHappRouting,
  useClearUserDevices,
  useCreateToolSnippet,
  useDeleteToolSnippet,
  useDeleteUserDevice,
  useDropConnections,
  useGenerateNodeKey,
  useGenerateX25519Keypair,
  useHappRoutingData,
  useHwidInspectorData,
  useNodeUserIpsData,
  useRevokeToolSession,
  useSessionInspectorData,
  useSrhInspectorData,
  useToolSummaryData,
  useToolSnippetsData,
  useTopUsersData,
  useTorrentReportsData,
  useTruncateTorrentReports,
  useUpdateToolSnippet,
  useUserIpsData,
} from '../shared/api/resourceHooks'
import { DataTable } from '../shared/components/DataTable'
import { EmptyState, ErrorState, LoadingState } from '../shared/components/DataState'
import { PageHeader } from '../shared/components/PageHeader'
import { StatusBadge } from '../shared/components/StatusBadge'
import type { NodeCommandRecord } from '../shared/api/types'
import { formatDateTime, formatRecord, toneForStatus } from '../shared/utils/resourceFormat'

type ToolId = 'hwid' | 'top-users' | 'user-ips' | 'srh' | 'sessions' | 'torrent' | 'happ' | 'utilities' | 'snippets'

const tools: Array<{
  detail: string
  icon: typeof Fingerprint
  id: ToolId
  name: string
}> = [
  {
    detail: 'Inspect device binding pressure and per-user HWID limits.',
    icon: Fingerprint,
    id: 'hwid',
    name: 'Inspector HWID',
  },
  {
    detail: 'Rank real users by traffic, device pressure, and expiration risk.',
    icon: Activity,
    id: 'top-users',
    name: 'Top users',
  },
  {
    detail: 'Trace real user IPs from subscription requests and IP-control events.',
    icon: Globe2,
    id: 'user-ips',
    name: 'User IPs',
  },
  {
    detail: 'Review subscription response headers and parser hints.',
    icon: Radar,
    id: 'srh',
    name: 'Inspector SRH',
  },
  {
    detail: 'Review active and revoked control-plane sessions.',
    icon: Activity,
    id: 'sessions',
    name: 'Session browser',
  },
  {
    detail: 'Report torrent blocker events and policy hits.',
    icon: Flame,
    id: 'torrent',
    name: 'Torrent blocker reports',
  },
  {
    detail: 'Preview HApp routing and node affinity decisions.',
    icon: Route,
    id: 'happ',
    name: 'HApp routing',
  },
  {
    detail: 'Generate one-time operational keys without storing plaintext.',
    icon: KeyRound,
    id: 'utilities',
    name: 'Key utilities',
  },
  {
    detail: 'Store reusable operational snippets in the control-plane database.',
    icon: ScrollText,
    id: 'snippets',
    name: 'Snippets',
  },
]

export function ToolsPage() {
  const [activeTool, setActiveTool] = useState<ToolId>('hwid')
  const [snippetForm, setSnippetForm] = useState({
    content: 'systemctl status xray',
    language: 'shell',
    name: 'Xray status',
  })
  const [hwidFilter, setHwidFilter] = useState('')
  const [ipFilter, setIpFilter] = useState('')
  const [torrentFilter, setTorrentFilter] = useState('')
  const [torrentTruncateArmed, setTorrentTruncateArmed] = useState(false)
  const [topUsersMetric, setTopUsersMetric] = useState('traffic_used')
  const [latestDropCommand, setLatestDropCommand] = useState<NodeCommandRecord | null>(null)
  const [happBuildError, setHappBuildError] = useState<string | null>(null)
  const [happBuildForm, setHappBuildForm] = useState({
    cryptoMethod: 'v4',
    mode: 'onadd',
    profileJson: JSON.stringify(
      {
        DomainStrategy: 'AsIs',
        LastUpdated: Math.floor(Date.now() / 1000),
        Name: 'Lumen HApp Routing',
        Rules: [{ DomainSuffix: 'example.test', Outbound: 'proxy' }],
      },
      null,
      2,
    ),
    subscriptionUrl: '',
  })
  const summaryQuery = useToolSummaryData()
  const hwidQuery = useHwidInspectorData(hwidFilter)
  const topUsersQuery = useTopUsersData(topUsersMetric, 50)
  const userIpsQuery = useUserIpsData(ipFilter, 200)
  const nodeUserIpsQuery = useNodeUserIpsData(ipFilter, 200)
  const srhQuery = useSrhInspectorData()
  const sessionsQuery = useSessionInspectorData()
  const torrentQuery = useTorrentReportsData(torrentFilter, 200)
  const happQuery = useHappRoutingData()
  const snippetsQuery = useToolSnippetsData()
  const buildHappRouting = useBuildHappRouting()
  const deleteDevice = useDeleteUserDevice()
  const clearDevices = useClearUserDevices()
  const dropConnections = useDropConnections()
  const revokeToolSession = useRevokeToolSession()
  const truncateTorrentReports = useTruncateTorrentReports()
  const generateX25519Keypair = useGenerateX25519Keypair()
  const generateNodeKey = useGenerateNodeKey()
  const createSnippet = useCreateToolSnippet()
  const updateSnippet = useUpdateToolSnippet()
  const deleteSnippet = useDeleteToolSnippet()
  const queries = [
    summaryQuery,
    hwidQuery,
    topUsersQuery,
    userIpsQuery,
    nodeUserIpsQuery,
    srhQuery,
    sessionsQuery,
    torrentQuery,
    happQuery,
    snippetsQuery,
  ]
  const activeQueries =
    activeTool === 'hwid'
      ? [hwidQuery]
      : activeTool === 'top-users'
        ? [topUsersQuery]
        : activeTool === 'user-ips'
          ? [userIpsQuery, nodeUserIpsQuery]
          : activeTool === 'srh'
            ? [srhQuery]
            : activeTool === 'sessions'
              ? [sessionsQuery]
              : activeTool === 'torrent'
                ? [torrentQuery]
                : activeTool === 'happ'
                  ? [happQuery]
                  : activeTool === 'snippets'
                    ? [snippetsQuery]
                    : []
  const isLoading = activeQueries.some((query) => query.isLoading)
  const error = activeQueries.find((query) => query.isError)?.error
  const handleBuildHappRouting = () => {
    setHappBuildError(null)
    let profileJson: Record<string, unknown> | null = null
    if (happBuildForm.mode !== 'off') {
      try {
        const parsed = JSON.parse(happBuildForm.profileJson) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setHappBuildError('Routing JSON must be an object.')
          return
        }
        profileJson = parsed as Record<string, unknown>
      } catch (error) {
        setHappBuildError(error instanceof Error ? error.message : 'Routing JSON is invalid.')
        return
      }
    }
    void buildHappRouting.mutateAsync({
      crypto_method: happBuildForm.cryptoMethod as 'v3' | 'v4',
      mode: happBuildForm.mode as 'add' | 'onadd' | 'off',
      profile_json: profileJson,
      subscription_url: happBuildForm.subscriptionUrl.trim() || null,
    })
  }

  const copyText = (value: string) => {
    if (!navigator.clipboard) {
      return
    }
    void navigator.clipboard.writeText(value)
  }

  const downloadText = (filename: string, value: string) => {
    const url = URL.createObjectURL(new Blob([value], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  const activeTable = useMemo(() => {
    if (activeTool === 'hwid') {
      return {
        columns: ['User', 'Devices', 'Limit', 'Status', 'Device registry', 'Actions'],
        empty: 'No HWID records yet.',
        rows: (hwidQuery.data?.items ?? []).map((item) => ({
          cells: [
            item.username ?? item.email,
            String(item.device_count),
            item.device_limit === null ? 'unlimited' : String(item.device_limit),
            <StatusBadge tone={item.status === 'over_limit' ? 'danger' : 'good'}>
              {item.status}
            </StatusBadge>,
            item.device_records.length > 0 ? (
              <div className="stacked-list">
                {item.device_records.map((device) => (
                  <span key={device.id}>
                    {device.label} · {device.hwid ?? device.id} · {device.platform ?? 'unknown'} · {device.last_seen_at ? formatDateTime(device.last_seen_at) : 'not seen'} · {device.subscription_id ?? 'no subscription'}
                  </span>
                ))}
              </div>
            ) : '-',
            <div className="inline-actions">
              {item.device_records.map((device) => (
                <button
                  key={device.id}
                  type="button"
                  className="icon-button"
                  aria-label={`Delete device ${device.id} for ${item.email}`}
                  disabled={deleteDevice.isPending}
                  onClick={() =>
                    void deleteDevice.mutateAsync({
                      deviceId: device.id,
                      userId: item.user_id,
                    })
                  }
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              ))}
              {item.device_records.length > 0 ? (
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={clearDevices.isPending}
                  onClick={() => void clearDevices.mutateAsync(item.user_id)}
                >
                  Clear all
                </button>
              ) : null}
            </div>,
          ],
          id: item.user_id,
        })),
        title: 'HWID inspector',
      }
    }
    if (activeTool === 'top-users') {
      return {
        columns: ['Rank', 'User', 'Traffic', 'Devices', 'Expires', 'Risk'],
        empty: 'No users recorded.',
        rows: (topUsersQuery.data?.items ?? []).map((item) => ({
          cells: [
            String(item.rank),
            item.username ? `${item.username} · ${item.email}` : item.email,
            `${item.traffic_used_gb.toFixed(2)} GB${item.traffic_limit_gb === null ? '' : ` / ${item.traffic_limit_gb.toFixed(0)} GB`}${item.traffic_percent === null ? '' : ` · ${item.traffic_percent.toFixed(2)}%`}`,
            `${item.device_count}${item.device_limit === null ? '' : ` / ${item.device_limit}`}`,
            item.expires_at ? formatDateTime(item.expires_at) : 'not set',
            <StatusBadge tone={toneForStatus(item.risk)}>{item.risk}</StatusBadge>,
          ],
          id: item.user_id,
        })),
        title: 'Top users',
      }
    }
    if (activeTool === 'user-ips') {
      return {
        columns: ['User', 'IP', 'Sources', 'Subscriptions', 'Nodes', 'Seen', 'Evidence', 'Actions'],
        empty: 'No user IP events recorded.',
        rows: (userIpsQuery.data?.items ?? []).map((item) => ({
          cells: [
            item.username ? `${item.username} В· ${item.email ?? item.user_id}` : (item.email ?? item.user_id),
            item.ip,
            item.sources.join(', '),
            item.subscription_ids.length > 0 ? item.subscription_ids.join(', ') : '-',
            item.node_ids.length > 0 ? item.node_ids.join(', ') : '-',
            `${formatDateTime(item.first_seen_at)} В· ${formatDateTime(item.last_seen_at)}`,
            `${item.evidence_count}${item.last_decision ? ` В· ${item.last_decision}` : ''}${item.last_target ? ` В· ${item.last_target}` : ''}`,
            item.node_ids.length > 0 ? (
              <button
                type="button"
                className="icon-button"
                aria-label={`Drop connections for ${item.ip} on ${item.node_ids[0]}`}
                disabled={dropConnections.isPending}
                onClick={() =>
                  void dropConnections
                    .mutateAsync({
                      ip: item.ip,
                      node_id: item.node_ids[0],
                      reason: 'operator requested connection drop from tools user IPs',
                      subscription_id: item.subscription_ids[0] ?? null,
                      user_id: item.user_id,
                    })
                    .then((response) => setLatestDropCommand(response.command))
                }
              >
                <Ban size={16} aria-hidden="true" />
              </button>
            ) : (
              <span title="No node evidence is available for this IP row">-</span>
            ),
          ],
          id: `${item.user_id}-${item.ip}`,
        })),
        title: 'User IPs',
      }
    }
    if (activeTool === 'srh') {
      return {
        columns: ['Subscription', 'Parser', 'Status', 'Config hash', 'Headers'],
        empty: 'No subscription response headers yet.',
        rows: (srhQuery.data?.items ?? []).map((item) => ({
          cells: [
            item.public_id,
            item.parser,
            <StatusBadge tone={toneForStatus(item.status)}>{item.status}</StatusBadge>,
            item.config_hash ?? '-',
            formatRecord(item.response_headers),
          ],
          id: item.subscription_id,
        })),
        title: 'SRH inspector',
      }
    }
    if (activeTool === 'sessions') {
      return {
        columns: ['User', 'Status', 'IP', 'User agent', 'Expires', 'Revoked', 'Actions'],
        empty: 'No sessions recorded.',
        rows: (sessionsQuery.data?.items ?? []).map((item) => ({
          cells: [
            item.is_current
              ? `${item.email ?? item.user_id} (current)`
              : (item.email ?? item.user_id),
            <StatusBadge tone={toneForStatus(item.status)}>{item.status}</StatusBadge>,
            item.ip_fingerprint ?? '-',
            item.user_agent_fingerprint ?? '-',
            formatDateTime(item.expires_at),
            item.revoked_at ? formatDateTime(item.revoked_at) : '-',
            <button
              type="button"
              className="button button--secondary"
              disabled={item.status !== 'active' || item.is_current || revokeToolSession.isPending}
              onClick={() => void revokeToolSession.mutateAsync(item.id)}
              title={
                item.is_current
                  ? 'Current browser session cannot be revoked from this row'
                  : undefined
              }
            >
              Revoke
            </button>,
          ],
          id: item.id,
        })),
        title: 'Session browser',
      }
    }
    if (activeTool === 'torrent') {
      return {
        columns: ['Action', 'Actor', 'Resource', 'Metadata', 'At'],
        empty: 'No torrent blocker events recorded.',
        rows: (torrentQuery.data?.items ?? []).map((item) => ({
          cells: [
            item.action,
            item.actor_email ?? item.actor_subject,
            `${item.resource_type}${item.resource_id ? ` / ${item.resource_id}` : ''}`,
            formatRecord(item.metadata_json),
            formatDateTime(item.created_at),
          ],
          id: item.id,
        })),
        title: 'Torrent blocker reports',
      }
    }
    if (activeTool === 'snippets') {
      return {
        columns: ['Name', 'Language', 'Content', 'Updated', 'Actions'],
        empty: 'No snippets stored.',
        rows: (snippetsQuery.data?.items ?? []).map((item) => ({
          cells: [
            item.name,
            item.language,
            item.content,
            formatDateTime(item.updated_at),
            <div className="inline-actions">
              <button
                type="button"
                className="button button--secondary"
                disabled={updateSnippet.isPending}
                onClick={() =>
                  void updateSnippet.mutateAsync({
                    id: item.id,
                    request: { content: item.content, name: item.name },
                  })
                }
              >
                Save
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Delete snippet ${item.name}`}
                disabled={deleteSnippet.isPending}
                onClick={() => void deleteSnippet.mutateAsync(item.id)}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>,
          ],
          id: item.id,
        })),
        title: 'Snippets',
      }
    }
    if (activeTool === 'utilities') {
      const rows: Array<{ cells: ReactNode[]; id: string }> = []
      if (generateX25519Keypair.data) {
        rows.push({
          cells: [
            'X25519 keypair',
            generateX25519Keypair.data.encoding,
            generateX25519Keypair.data.public_key,
          ],
          id: 'x25519-keypair',
        })
      }
      if (generateNodeKey.data) {
        rows.push({
          cells: [
            'Node token',
            generateNodeKey.data.hash_algorithm,
            `${generateNodeKey.data.token_prefix}...`,
          ],
          id: 'node-key',
        })
      }
      return {
        columns: ['Utility', 'Algorithm / encoding', 'Public value'],
        empty: 'No generated keys in this browser session.',
        rows,
        title: 'Key utilities',
      }
    }
    return {
      columns: ['Subscription', 'User', 'Node', 'Route', 'Delivery profile'],
      empty: 'No HApp routes recorded.',
      rows: (happQuery.data?.items ?? []).map((item) => ({
        cells: [
          item.public_id,
          item.username ?? item.user_id,
          item.node_name ?? item.node_id ?? '-',
          <StatusBadge tone={toneForStatus(item.route_status)}>{item.route_status}</StatusBadge>,
          formatRecord(item.delivery_profile),
        ],
        id: item.subscription_id,
      })),
      title: 'HApp routing',
    }
  }, [
    activeTool,
    clearDevices,
    deleteDevice,
    deleteSnippet,
    dropConnections,
    happQuery.data,
    hwidQuery.data,
    hwidFilter,
    generateX25519Keypair,
    generateNodeKey.data,
    revokeToolSession,
    sessionsQuery.data,
    snippetsQuery.data,
    srhQuery.data,
    truncateTorrentReports,
    torrentQuery.data,
    topUsersMetric,
    topUsersQuery.data,
    userIpsQuery.data,
    updateSnippet,
  ])

  return (
    <section className="page">
      <PageHeader
        eyebrow="Operational tools"
        title="Tools"
        description="Diagnostics and utility surfaces for device binding, subscription parsing, sessions, torrent policy, and HApp routing."
      />

      <section className="resource-grid">
          <article className="panel panel--wide">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Live diagnostics</p>
                <h2>{activeTable.title}</h2>
              </div>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => queries.forEach((query) => void query.refetch())}
              >
                Refresh
              </button>
              {activeTool === 'torrent' ? (
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={
                    truncateTorrentReports.isPending ||
                    (torrentQuery.data?.items.length ?? 0) === 0
                  }
                  onClick={() => {
                    if (!torrentTruncateArmed) {
                      setTorrentTruncateArmed(true)
                      return
                    }
                    void truncateTorrentReports.mutateAsync().then(() => setTorrentTruncateArmed(false))
                  }}
                >
                  {torrentTruncateArmed ? 'Confirm truncate' : 'Truncate'}
                </button>
              ) : null}
              {activeTool === 'utilities' ? (
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={generateX25519Keypair.isPending}
                  onClick={() => void generateX25519Keypair.mutateAsync()}
                >
                  Generate X25519
                </button>
              ) : null}
              {activeTool === 'utilities' ? (
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={generateNodeKey.isPending}
                  onClick={() => void generateNodeKey.mutateAsync()}
                >
                  Generate node key
                </button>
              ) : null}
              {activeTool === 'snippets' ? (
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={createSnippet.isPending}
                  onClick={() => void createSnippet.mutateAsync(snippetForm)}
                >
                  Create snippet
                </button>
              ) : null}
            </div>
            {activeTool === 'hwid' ? (
              <div className="toolbar">
                <label htmlFor="hwid-filter" className="field field--inline">
                  <span>Lookup HWID</span>
                  <input
                    id="hwid-filter"
                    type="search"
                    placeholder="email, username, HWID, device, subscription"
                    value={hwidFilter}
                    onChange={(event) => setHwidFilter(event.target.value)}
                  />
                </label>
              </div>
            ) : null}
            {activeTool === 'top-users' ? (
              <div className="toolbar">
                <label htmlFor="top-users-metric" className="field field--inline">
                  <span>Metric</span>
                  <select
                    id="top-users-metric"
                    value={topUsersMetric}
                    onChange={(event) => setTopUsersMetric(event.target.value)}
                  >
                    <option value="traffic_used">Traffic used</option>
                    <option value="traffic_percent">Traffic percent</option>
                    <option value="device_count">Device count</option>
                    <option value="expiration_risk">Expiration risk</option>
                  </select>
                </label>
              </div>
            ) : null}
            {activeTool === 'torrent' ? (
              <div className="toolbar">
                <label htmlFor="torrent-filter" className="field field--inline">
                  <span>Lookup torrent report</span>
                  <input
                    id="torrent-filter"
                    type="search"
                    placeholder="action, actor, resource, metadata"
                    value={torrentFilter}
                    onChange={(event) => {
                      setTorrentFilter(event.target.value)
                      setTorrentTruncateArmed(false)
                    }}
                  />
                </label>
                <StatusBadge tone="neutral">
                  {`${torrentQuery.data?.total ?? 0} reports`}
                </StatusBadge>
              </div>
            ) : null}
            {activeTool === 'user-ips' ? (
              <div className="toolbar">
                <label htmlFor="ip-filter" className="field field--inline">
                  <span>Lookup IP</span>
                  <input
                    id="ip-filter"
                    type="search"
                    placeholder="IP, email, username, node, subscription"
                    value={ipFilter}
                    onChange={(event) => setIpFilter(event.target.value)}
                  />
                </label>
              </div>
            ) : null}
            {activeTool === 'happ' ? (
              <div className="details-card">
                <h3>HApp routing builder</h3>
                <div className="form-grid">
                  <label>
                    <span>Routing mode</span>
                    <select
                      value={happBuildForm.mode}
                      onChange={(event) =>
                        setHappBuildForm((current) => ({ ...current, mode: event.target.value }))
                      }
                    >
                      <option value="add">add</option>
                      <option value="onadd">onadd</option>
                      <option value="off">off</option>
                    </select>
                  </label>
                  <label>
                    <span>Crypto method</span>
                    <select
                      value={happBuildForm.cryptoMethod}
                      onChange={(event) =>
                        setHappBuildForm((current) => ({
                          ...current,
                          cryptoMethod: event.target.value,
                        }))
                      }
                    >
                      <option value="v4">v4</option>
                      <option value="v3">v3</option>
                    </select>
                  </label>
                  <label className="form-grid__wide">
                    <span>Subscription URL for HApp crypto</span>
                    <input
                      value={happBuildForm.subscriptionUrl}
                      placeholder="https://sub.example/sub/..."
                      onChange={(event) =>
                        setHappBuildForm((current) => ({
                          ...current,
                          subscriptionUrl: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="form-grid__wide">
                    <span>Routing JSON</span>
                    <textarea
                      value={happBuildForm.profileJson}
                      disabled={happBuildForm.mode === 'off'}
                      onChange={(event) =>
                        setHappBuildForm((current) => ({
                          ...current,
                          profileJson: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
                <div className="inline-actions">
                  <button
                    type="button"
                    className="button"
                    disabled={buildHappRouting.isPending}
                    onClick={handleBuildHappRouting}
                  >
                    Build HApp payload
                  </button>
                  {buildHappRouting.data?.routing_header ? (
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => copyText(buildHappRouting.data.routing_header)}
                    >
                      Copy routing
                    </button>
                  ) : null}
                  {buildHappRouting.data?.crypto_link ? (
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => copyText(buildHappRouting.data.crypto_link ?? '')}
                    >
                      Copy crypto
                    </button>
                  ) : null}
                </div>
                {happBuildError ? <p className="form-error">{happBuildError}</p> : null}
                {buildHappRouting.error ? (
                  <p className="form-error">
                    {buildHappRouting.error instanceof Error
                      ? buildHappRouting.error.message
                      : 'HApp payload build failed.'}
                  </p>
                ) : null}
                {buildHappRouting.data ? (
                  <dl className="detail-list">
                    <div>
                      <dt>Routing header</dt>
                      <dd>{buildHappRouting.data.routing_header}</dd>
                    </div>
                    <div>
                      <dt>Routing bytes</dt>
                      <dd>{buildHappRouting.data.profile_bytes}</dd>
                    </div>
                    <div>
                      <dt>Crypto link</dt>
                      <dd>{buildHappRouting.data.crypto_link ?? '-'}</dd>
                    </div>
                  </dl>
                ) : null}
              </div>
            ) : null}
            <div className="toolbar">
              {tools.map((tool) => {
                const Icon = tool.icon
                return (
                  <button
                    key={tool.id}
                    type="button"
                    className={tool.id === activeTool ? 'button' : 'button button--secondary'}
                    onClick={() => setActiveTool(tool.id)}
                    title={tool.detail}
                  >
                    <Icon size={16} aria-hidden="true" />
                    {tool.name}
                  </button>
                )
              })}
            </div>
            {isLoading ? <LoadingState label="Loading tools context..." /> : null}
            {error ? <ErrorState title={`${activeTable.title} unavailable`} error={error} /> : null}
            {!isLoading && !error && activeTable.rows.length > 0 ? (
              <DataTable
                caption="Operational tools"
                columns={activeTable.columns}
                rows={activeTable.rows}
              />
            ) : null}
            {!isLoading && !error && activeTable.rows.length === 0 ? (
              <EmptyState title="No data" description={activeTable.empty} />
            ) : null}
            {activeTool === 'user-ips' && !nodeUserIpsQuery.isError ? (
              <div className="details-card">
                <h3>Node user IPs</h3>
                {(nodeUserIpsQuery.data?.items.length ?? 0) > 0 ? (
                  <DataTable
                    caption="Node user IPs"
                    columns={['Node', 'User', 'IP', 'Subscriptions', 'Seen', 'Evidence', 'Actions']}
                    rows={(nodeUserIpsQuery.data?.items ?? []).map((item) => ({
                      cells: [
                        item.node_name ?? item.node_id,
                        item.username ? `${item.username} В· ${item.email ?? item.user_id}` : (item.email ?? item.user_id),
                        item.ip,
                        item.subscription_ids.length > 0 ? item.subscription_ids.join(', ') : '-',
                        `${formatDateTime(item.first_seen_at)} В· ${formatDateTime(item.last_seen_at)}`,
                        `${item.evidence_count}${item.last_target ? ` В· ${item.last_target}` : ''}`,
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Drop connections for ${item.ip} on ${item.node_name ?? item.node_id}`}
                          disabled={dropConnections.isPending}
                          onClick={() =>
                            void dropConnections
                              .mutateAsync({
                                ip: item.ip,
                                node_id: item.node_id,
                                reason: 'operator requested connection drop from tools node user IPs',
                                subscription_id: item.subscription_ids[0] ?? null,
                                user_id: item.user_id,
                              })
                              .then((response) => setLatestDropCommand(response.command))
                          }
                        >
                          <Ban size={16} aria-hidden="true" />
                        </button>,
                      ],
                      id: `${item.node_id}-${item.user_id}-${item.ip}`,
                    }))}
                  />
                ) : (
                  <EmptyState title="No node IPs" description="No node-bound user IP events recorded." />
                )}
                {latestDropCommand ? (
                  <div className="details-card">
                    <h3>Latest drop command</h3>
                    <dl className="detail-list">
                      <div>
                        <dt>Command</dt>
                        <dd>{latestDropCommand.id}</dd>
                      </div>
                      <div>
                        <dt>Status</dt>
                        <dd>{latestDropCommand.status}</dd>
                      </div>
                      <div>
                        <dt>Node</dt>
                        <dd>{latestDropCommand.node_id}</dd>
                      </div>
                      <div>
                        <dt>IP</dt>
                        <dd>{String(latestDropCommand.payload_json.ip ?? '-')}</dd>
                      </div>
                    </dl>
                  </div>
                ) : null}
              </div>
            ) : null}
            {activeTool === 'utilities' && generateX25519Keypair.data ? (
              <div className="details-card">
                <h3>X25519 keypair</h3>
                <p className="security-note">
                  Private key is returned once in this browser session and is not stored by the API.
                </p>
                <div className="inline-actions">
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => copyText(generateX25519Keypair.data.public_key)}
                  >
                    Copy public
                  </button>
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => copyText(generateX25519Keypair.data.private_key)}
                  >
                    Copy private
                  </button>
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() =>
                      downloadText('lumen-x25519-private-key.txt', generateX25519Keypair.data.private_key)
                    }
                  >
                    Download private
                  </button>
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => generateX25519Keypair.reset()}
                  >
                    Clear private
                  </button>
                </div>
                <dl className="detail-list">
                  <div>
                    <dt>Public key</dt>
                    <dd>{generateX25519Keypair.data.public_key}</dd>
                  </div>
                  <div>
                    <dt>Private key</dt>
                    <dd>{generateX25519Keypair.data.private_key}</dd>
                  </div>
                  <div>
                    <dt>Encoding</dt>
                    <dd>{generateX25519Keypair.data.encoding}</dd>
                  </div>
                </dl>
              </div>
            ) : null}
            {activeTool === 'utilities' && generateNodeKey.data ? (
              <div className="details-card">
                <h3>Node key</h3>
                <dl className="detail-list">
                  <div>
                    <dt>Token</dt>
                    <dd>{generateNodeKey.data.token}</dd>
                  </div>
                  <div>
                    <dt>Prefix</dt>
                    <dd>{generateNodeKey.data.token_prefix}</dd>
                  </div>
                  <div>
                    <dt>Stored</dt>
                    <dd>{generateNodeKey.data.stored ? 'yes' : 'no'}</dd>
                  </div>
                </dl>
              </div>
            ) : null}
            {activeTool === 'snippets' ? (
              <div className="details-card">
                <h3>Snippet editor</h3>
                <div className="form-grid">
                  <label>
                    <span>Name</span>
                    <input
                      value={snippetForm.name}
                      onChange={(event) =>
                        setSnippetForm((current) => ({ ...current, name: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    <span>Language</span>
                    <input
                      value={snippetForm.language}
                      onChange={(event) =>
                        setSnippetForm((current) => ({
                          ...current,
                          language: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="form-grid__wide">
                    <span>Content</span>
                    <textarea
                      value={snippetForm.content}
                      onChange={(event) =>
                        setSnippetForm((current) => ({
                          ...current,
                          content: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              </div>
            ) : null}
          </article>
          <article className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Summary</p>
                <h2>Tool posture</h2>
              </div>
              <StatusBadge tone="good">api-backed</StatusBadge>
            </div>
            <ul className="feature-list">
              <li>
                <span>HWID over limit</span>
                <span>{summaryQuery.data?.hwid_over_limit ?? 0}</span>
              </li>
              <li>
                <span>Active sessions</span>
                <span>{summaryQuery.data?.sessions_active ?? 0}</span>
              </li>
              <li>
                <span>Torrent reports</span>
                <span>{summaryQuery.data?.torrent_events ?? 0}</span>
              </li>
              <li>
                <span>HApp routes</span>
                <span>{summaryQuery.data?.happ_routes ?? 0}</span>
              </li>
            </ul>
            {summaryQuery.isError ? (
              <p className="auth-card__note" role="alert">
                Summary endpoint is unavailable; tool tabs stay usable independently.
              </p>
            ) : null}
          </article>
        </section>
    </section>
  )
}
