import { Link, useParams } from 'react-router-dom'
import type React from 'react'
import { Ban, CheckCircle2, ExternalLink, RotateCcw, ShieldX, Trash2 } from 'lucide-react'
import {
  useClearUserDevices,
  useDeleteUserDevice,
  useDisableUser,
  useEnableUser,
  useResetUserTraffic,
  useRevokeUser,
  useUserDetailData,
} from '../shared/api/resourceHooks'
import type { SubscriptionRecord, UserRecord } from '../shared/api/types'
import { DataTable } from '../shared/components/DataTable'
import { EmptyState, ErrorState, LoadingState } from '../shared/components/DataState'
import { PageHeader } from '../shared/components/PageHeader'
import { StatusBadge } from '../shared/components/StatusBadge'
import { useI18n } from '../shared/i18n/I18nProvider'
import { formatDateTime, formatRecord, toneForStatus } from '../shared/utils/resourceFormat'

function displayName(user: UserRecord): string {
  return user.display_name || user.username || user.email
}

function trafficLabel(user: UserRecord, t: (value: string) => string): string {
  const used = `${user.traffic_used_gb.toFixed(2)} GB`
  return user.traffic_limit_gb === null ? `${used} / ${t('unlimited')}` : `${used} / ${user.traffic_limit_gb.toFixed(0)} GB`
}

export function UserDetailPage() {
  const { t } = useI18n()
  const { userId } = useParams()
  const query = useUserDetailData(userId)
  const enableUser = useEnableUser()
  const disableUser = useDisableUser()
  const revokeUser = useRevokeUser()
  const resetUserTraffic = useResetUserTraffic()
  const deleteDevice = useDeleteUserDevice()
  const clearDevices = useClearUserDevices()
  const detail = query.data
  const user = detail?.user

  async function setStatus(status: 'active' | 'disabled' | 'revoked') {
    if (!user) {
      return
    }
    if (status === 'active') {
      await enableUser.mutateAsync(user.id)
    } else if (status === 'disabled') {
      await disableUser.mutateAsync(user.id)
    } else {
      await revokeUser.mutateAsync(user.id)
    }
    await query.refetch()
  }

  async function resetTraffic() {
    if (!user) {
      return
    }
    await resetUserTraffic.mutateAsync(user.id)
    await query.refetch()
  }

  async function deleteUserDevice(deviceId: string) {
    if (!user) {
      return
    }
    await deleteDevice.mutateAsync({ deviceId, userId: user.id })
    await query.refetch()
  }

  async function clearUserDevices() {
    if (!user) {
      return
    }
    await clearDevices.mutateAsync(user.id)
    await query.refetch()
  }

  if (query.isLoading) {
    return <LoadingState label={t('Loading user detail...')} />
  }

  if (query.isError) {
    return <ErrorState title={t('User detail unavailable')} error={query.error} />
  }

  if (!user || !detail) {
    return (
      <EmptyState
        title={t('User not found')}
        description={t('The API did not return this user.')}
      />
    )
  }

  return (
    <section className="page">
      <PageHeader
        eyebrow={t('User detail')}
        title={displayName(user)}
        description={`${user.email} - ${t('Real API user record with subscriptions, access, and backend-derived status.')}`}
        actions={
          <div className="action-cluster">
            <button type="button" className="button button--secondary" onClick={() => void setStatus('active')}>
              <CheckCircle2 size={18} aria-hidden="true" />
              {t('Enable')}
            </button>
            <button type="button" className="button button--secondary" onClick={() => void setStatus('disabled')}>
              <Ban size={18} aria-hidden="true" />
              {t('Disable')}
            </button>
            <button type="button" className="button button--secondary" onClick={() => void resetTraffic()}>
              <RotateCcw size={18} aria-hidden="true" />
              {t('Reset traffic')}
            </button>
            <button type="button" className="button button--secondary" onClick={() => void setStatus('revoked')}>
              <ShieldX size={18} aria-hidden="true" />
              {t('Revoke')}
            </button>
          </div>
        }
      />

      <section className="metrics-grid">
        <UserFact label={t('Status')} value={user.status} detail={<StatusBadge tone={toneForStatus(user.status)}>{user.status}</StatusBadge>} />
        <UserFact label={t('Traffic')} value={trafficLabel(user, t)} detail={t('recorded by API')} />
        <UserFact label={t('Devices')} value={user.device_limit === null ? t('unlimited') : String(user.device_limit)} detail={t('configured limit')} />
        <UserFact label={t('Expires')} value={user.expires_at ? formatDateTime(user.expires_at) : t('Not set')} detail={t('subscription policy')} />
      </section>

      <section className="resource-grid">
        <article className="panel panel--wide">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{t('Subscription access')}</p>
              <h2>{t('Issued subscriptions')}</h2>
            </div>
            <StatusBadge>{t('items.count', { count: detail.subscriptions.length })}</StatusBadge>
          </div>
          {detail.subscriptions.length === 0 ? (
            <p className="empty-inline">{t('No subscriptions are issued for this user yet.')}</p>
          ) : (
            <DataTable
              caption={t('Issued subscriptions')}
              columns={['Public ID', 'Node', 'Delivery profile', 'Expires', 'Status', 'Actions']}
              rows={detail.subscriptions.map((subscription) => ({
                id: subscription.id,
                cells: [
                  subscription.public_id,
                  subscription.node_id ?? t('All nodes'),
                  formatRecord(subscription.delivery_profile),
                  subscription.expires_at ? formatDateTime(subscription.expires_at) : t('Not set'),
                  <StatusBadge tone={toneForStatus(subscription.status)}>{subscription.status}</StatusBadge>,
                  <SubscriptionLinks subscription={subscription} />,
                ],
              }))}
            />
          )}
        </article>

        <article className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{t('Access')}</p>
              <h2>{t('Accessible nodes')}</h2>
            </div>
            <StatusBadge>{String(detail.accessible_nodes.length)}</StatusBadge>
          </div>
          <ul className="feature-list">
            {detail.accessible_nodes.map((node) => (
              <li key={node.id}>
                <span aria-hidden="true">-</span>
                <div>
                  <strong>{node.name}</strong>
                  <small>{node.public_address} / {node.region}</small>
                </div>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{t('Identity')}</p>
              <h2>{t('User metadata')}</h2>
            </div>
            <StatusBadge tone="info">{user.role}</StatusBadge>
          </div>
          <dl className="profile-facts">
            <div>
              <dt>{t('Username')}</dt>
              <dd>{user.username ?? t('Not set')}</dd>
            </div>
            <div>
              <dt>{t('Telegram ID')}</dt>
              <dd>{user.telegram_id ?? t('Not set')}</dd>
            </div>
            <div>
              <dt>{t('Tags')}</dt>
              <dd>{user.tags.length > 0 ? user.tags.join(', ') : t('none')}</dd>
            </div>
            <div>
              <dt>metadata_json</dt>
              <dd>{formatRecord(user.metadata_json)}</dd>
            </div>
          </dl>
        </article>

        <article className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{t('HWID')}</p>
              <h2>{detail.devices.length > 0 ? t('Registered devices') : t('Device registry')}</h2>
            </div>
            <div className="inline-actions">
              <StatusBadge tone={detail.devices.length > 0 ? 'info' : 'neutral'}>
                {String(detail.devices.length)}
              </StatusBadge>
              {detail.devices.length > 0 ? (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('Clear all devices')}
                  disabled={clearDevices.isPending}
                  onClick={() => void clearUserDevices()}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
          {detail.devices.length === 0 ? (
            <p className="empty-inline">{t('No devices are registered for this user yet.')}</p>
          ) : (
            <DataTable
              caption={t('Registered devices')}
              columns={['Device', 'HWID', 'Platform', 'Status', 'Last seen', 'Actions']}
              rows={detail.devices.map((device) => ({
                id: device.id,
                cells: [
                  device.label ?? device.id,
                  device.hwid ?? '-',
                  device.platform ?? t('unknown platform'),
                  <StatusBadge tone={toneForStatus(device.status)}>{device.status}</StatusBadge>,
                  device.last_seen_at ? formatDateTime(device.last_seen_at) : t('Not recorded'),
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('Delete device {id}', { id: device.id })}
                    disabled={deleteDevice.isPending}
                    onClick={() => void deleteUserDevice(device.id)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>,
                ],
              }))}
            />
          )}
        </article>

        <article className="panel panel--wide">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{t('History')}</p>
              <h2>{t('Subscription request history')}</h2>
            </div>
            <StatusBadge tone="info">{String(detail.request_history.length)}</StatusBadge>
          </div>
          {detail.request_history.length === 0 ? (
            <p className="empty-inline">{t('No request history is recorded for this user yet.')}</p>
          ) : (
            <DataTable
              caption={t('Backend request audit')}
              columns={['Action', 'Actor', 'Created at', 'Metadata']}
              rows={detail.request_history.map((event) => ({
                id: event.id,
                cells: [
                  event.action,
                  event.actor_email ?? event.actor_subject,
                  formatDateTime(event.created_at),
                  formatRecord(event.metadata_json),
                ],
              }))}
            />
          )}
        </article>
      </section>
    </section>
  )
}

function UserFact({
  detail,
  label,
  value,
}: {
  detail: React.ReactNode
  label: string
  value: string
}) {
  return (
    <article className="metric-card">
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
      {typeof detail === 'string' ? <StatusBadge>{detail}</StatusBadge> : detail}
    </article>
  )
}

function SubscriptionLinks({ subscription }: { subscription: SubscriptionRecord }) {
  const { t } = useI18n()
  const baseUrl = buildSubscriptionUrl(subscription.public_id)
  const renderability = getSubscriptionRenderability(subscription)

  if (!renderability.canOpenBasePage) {
    return (
      <div className="inline-actions">
        <StatusBadge tone="watch">{t(renderability.reason)}</StatusBadge>
        <Link className="text-link" to="/subscription">
          {t('Manage')}
        </Link>
      </div>
    )
  }

  return (
    <div className="inline-actions">
      <a className="text-link" href={baseUrl} target="_blank" rel="noreferrer">
        {t('Page')} <ExternalLink size={14} aria-hidden="true" />
      </a>
      {renderability.formats.includes('happ') ? (
        <a className="text-link" href={`${baseUrl}/happ`} target="_blank" rel="noreferrer">
          Happ
        </a>
      ) : null}
      <Link className="text-link" to="/subscription">
        {t('Manage')}
      </Link>
    </div>
  )
}

function getSubscriptionRenderability(subscription: SubscriptionRecord) {
  if (subscription.revoked_at) {
    return { canOpenBasePage: false, formats: [], reason: 'Subscription revoked' }
  }
  if (subscription.status !== 'active') {
    return { canOpenBasePage: false, formats: [], reason: 'Subscription not active' }
  }
  return {
    canOpenBasePage: true,
    formats: readDeclaredFormats(subscription),
    reason: 'Base endpoint inferred from active subscription',
  }
}

function readDeclaredFormats(subscription: SubscriptionRecord): string[] {
  const declared = [
    subscription.delivery_profile.format,
    subscription.delivery_profile.client,
    subscription.delivery_profile.adapter,
  ]
    .flatMap((value) => String(value ?? '').split(/[,\s/]+/))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  return Array.from(new Set(declared))
}

function buildSubscriptionUrl(publicId: string) {
  if (typeof window === 'undefined') {
    return `/sub/${publicId}`
  }
  const host = window.location.host.replace(/^panel\./, 'sub.')
  return `${window.location.protocol}//${host}/sub/${publicId}`
}
