import { useMemo, useState } from 'react'
import { Activity, Fingerprint, Flame, Radar, Route, Trash2 } from 'lucide-react'
import {
  useClearUserDevices,
  useDeleteUserDevice,
  useHappRoutingData,
  useHwidInspectorData,
  useRevokeToolSession,
  useSessionInspectorData,
  useSrhInspectorData,
  useToolSummaryData,
  useTorrentReportsData,
} from '../shared/api/resourceHooks'
import { DataTable } from '../shared/components/DataTable'
import { EmptyState, ErrorState, LoadingState } from '../shared/components/DataState'
import { PageHeader } from '../shared/components/PageHeader'
import { StatusBadge } from '../shared/components/StatusBadge'
import { formatDateTime, formatRecord, toneForStatus } from '../shared/utils/resourceFormat'

type ToolId = 'hwid' | 'srh' | 'sessions' | 'torrent' | 'happ'

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
]

export function ToolsPage() {
  const [activeTool, setActiveTool] = useState<ToolId>('hwid')
  const summaryQuery = useToolSummaryData()
  const hwidQuery = useHwidInspectorData()
  const srhQuery = useSrhInspectorData()
  const sessionsQuery = useSessionInspectorData()
  const torrentQuery = useTorrentReportsData()
  const happQuery = useHappRoutingData()
  const deleteDevice = useDeleteUserDevice()
  const clearDevices = useClearUserDevices()
  const revokeToolSession = useRevokeToolSession()
  const queries = [summaryQuery, hwidQuery, srhQuery, sessionsQuery, torrentQuery, happQuery]
  const isLoading = queries.some((query) => query.isLoading)
  const error = queries.find((query) => query.isError)?.error

  const activeTable = useMemo(() => {
    if (activeTool === 'hwid') {
      return {
        columns: ['User', 'Devices', 'Limit', 'Status', 'HWIDs', 'Actions'],
        empty: 'No HWID records yet.',
        rows: (hwidQuery.data?.items ?? []).map((item) => ({
          cells: [
            item.username ?? item.email,
            String(item.device_count),
            item.device_limit === null ? 'unlimited' : String(item.device_limit),
            <StatusBadge tone={item.status === 'over_limit' ? 'danger' : 'good'}>
              {item.status}
            </StatusBadge>,
            item.devices.join(', ') || '-',
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
            item.actor_email ?? '-',
            item.resource_id ?? '-',
            formatRecord(item.metadata_json),
            formatDateTime(item.created_at),
          ],
          id: item.id,
        })),
        title: 'Torrent blocker reports',
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
    happQuery.data,
    hwidQuery.data,
    revokeToolSession,
    sessionsQuery.data,
    srhQuery.data,
    torrentQuery.data,
  ])

  return (
    <section className="page">
      <PageHeader
        eyebrow="Operational tools"
        title="Tools"
        description="Diagnostics and utility surfaces for device binding, subscription parsing, sessions, torrent policy, and HApp routing."
      />

      {isLoading ? <LoadingState label="Loading tools context..." /> : null}
      {error ? <ErrorState title="Tools unavailable" error={error} /> : null}
      {!isLoading && !error ? (
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
            </div>
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
            {activeTable.rows.length > 0 ? (
              <DataTable
                caption="Operational tools"
                columns={activeTable.columns}
                rows={activeTable.rows}
              />
            ) : (
              <EmptyState title="No data" description={activeTable.empty} />
            )}
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
          </article>
        </section>
      ) : null}
    </section>
  )
}
