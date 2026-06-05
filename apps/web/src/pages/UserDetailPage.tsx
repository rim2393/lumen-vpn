import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldX,
  Trash2,
  UserCog,
} from 'lucide-react'
import {
  useClearUserDevices,
  useDeleteUser,
  useDeleteUserDevice,
  useDisableUser,
  useEnableUser,
  useResetUserTraffic,
  useRevokeUser,
  useUpdateUser,
  useUserDetailData,
} from '../shared/api/resourceHooks'
import type { SubscriptionRecord, UserRecord, UserUpdateRequest } from '../shared/api/types'
import { DataTable } from '../shared/components/DataTable'
import { EmptyState, ErrorState, LoadingState } from '../shared/components/DataState'
import { FormError } from '../shared/components/ResourceScreen'
import { PageHeader } from '../shared/components/PageHeader'
import { StatusBadge } from '../shared/components/StatusBadge'
import { useI18n } from '../shared/i18n/I18nProvider'
import { formatDateTime, formatRecord, toneForStatus } from '../shared/utils/resourceFormat'

type UserEditorState = {
  deviceLimit: string
  displayName: string
  email: string
  expiresAt: string
  metadataJson: string
  password: string
  role: 'owner' | 'admin' | 'operator' | 'user'
  status: string
  tags: string
  telegramId: string
  trafficLimit: string
  trafficUsed: string
  username: string
}

function displayName(user: UserRecord): string {
  return user.display_name || user.username || user.email
}

function trafficLabel(user: UserRecord, t: (value: string) => string): string {
  const used = `${user.traffic_used_gb.toFixed(2)} GB`
  return user.traffic_limit_gb === null ? `${used} / ${t('unlimited')}` : `${used} / ${user.traffic_limit_gb.toFixed(0)} GB`
}

function toInputDateTime(value: string | null): string {
  if (!value) {
    return ''
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return ''
  }
  const offsetMs = parsed.getTimezoneOffset() * 60_000
  return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 16)
}

function fromInputDateTime(value: string): string | null {
  return value.trim() ? new Date(value).toISOString() : null
}

function userToEditorState(user: UserRecord): UserEditorState {
  return {
    deviceLimit: user.device_limit === null ? '' : String(user.device_limit),
    displayName: user.display_name ?? '',
    email: user.email,
    expiresAt: toInputDateTime(user.expires_at),
    metadataJson: JSON.stringify(user.metadata_json ?? {}, null, 2),
    password: '',
    role: user.role,
    status: user.status,
    tags: user.tags.join(', '),
    telegramId: user.telegram_id ?? '',
    trafficLimit: user.traffic_limit_gb === null ? '' : String(user.traffic_limit_gb),
    trafficUsed: String(user.traffic_used_gb),
    username: user.username ?? '',
  }
}

function parseNullableNumber(value: string, field: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${field} must be a positive number.`)
  }
  return parsed
}

function parseRequiredNumber(value: string, field: string): number {
  const parsed = Number(value.trim())
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${field} must be a positive number.`)
  }
  return parsed
}

function editorStateToRequest(state: UserEditorState): UserUpdateRequest {
  const metadata = JSON.parse(state.metadataJson || '{}') as unknown
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('metadata_json must be a JSON object.')
  }
  const password = state.password.trim()
  return {
    device_limit: parseNullableNumber(state.deviceLimit, 'device_limit'),
    display_name: state.displayName.trim() || null,
    email: state.email.trim(),
    expires_at: fromInputDateTime(state.expiresAt),
    metadata_json: metadata as Record<string, unknown>,
    ...(password ? { password } : {}),
    role: state.role,
    status: state.status.trim() || 'active',
    tags: state.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    telegram_id: state.telegramId.trim() || null,
    traffic_limit_gb: parseNullableNumber(state.trafficLimit, 'traffic_limit_gb'),
    traffic_used_gb: parseRequiredNumber(state.trafficUsed, 'traffic_used_gb'),
    username: state.username.trim() || null,
  }
}

function mutationError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export function UserDetailPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { userId } = useParams()
  const query = useUserDetailData(userId)
  const enableUser = useEnableUser()
  const disableUser = useDisableUser()
  const revokeUser = useRevokeUser()
  const resetUserTraffic = useResetUserTraffic()
  const deleteUser = useDeleteUser()
  const updateUser = useUpdateUser()
  const deleteDevice = useDeleteUserDevice()
  const clearDevices = useClearUserDevices()
  const detail = query.data
  const user = detail?.user
  const [editor, setEditor] = useState<UserEditorState | null>(null)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)

  useEffect(() => {
    if (user) {
      setEditor(userToEditorState(user))
      setEditorError(null)
    }
  }, [user])

  const hasDevicesOverLimit = useMemo(() => {
    if (!user || !detail || user.device_limit === null) {
      return false
    }
    return detail.devices.length > user.device_limit
  }, [detail, user])

  async function setStatus(status: 'active' | 'disabled' | 'revoked') {
    if (!user) {
      return
    }
    if (status === 'revoked' && !globalThis.confirm(t('Revoke user confirmation', { name: displayName(user) }))) {
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
    if (!user || !globalThis.confirm(t('Reset user traffic confirmation', { name: displayName(user) }))) {
      return
    }
    await resetUserTraffic.mutateAsync(user.id)
    await query.refetch()
  }

  async function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || !editor) {
      return
    }
    setEditorError(null)
    setSavedMessage(null)
    try {
      const request = editorStateToRequest(editor)
      await updateUser.mutateAsync({ id: user.id, request })
      await query.refetch()
      setSavedMessage(t('User saved.'))
      setEditor((current) => (current ? { ...current, password: '' } : current))
    } catch (error) {
      setEditorError(mutationError(error, t('User could not be saved.')))
    }
  }

  async function deleteUserDevice(deviceId: string) {
    if (!user || !globalThis.confirm(t('Delete user device confirmation', { id: deviceId }))) {
      return
    }
    await deleteDevice.mutateAsync({ deviceId, userId: user.id })
    await query.refetch()
  }

  async function clearUserDevices() {
    if (!user || !globalThis.confirm(t('Clear user devices confirmation', { name: displayName(user) }))) {
      return
    }
    await clearDevices.mutateAsync(user.id)
    await query.refetch()
  }

  async function removeUser() {
    if (!user || !globalThis.confirm(t('Delete user confirmation', { name: displayName(user) }))) {
      return
    }
    await deleteUser.mutateAsync(user.id)
    navigate('/users')
  }

  if (query.isLoading) {
    return <LoadingState label={t('Loading user detail...')} />
  }

  if (query.isError) {
    return <ErrorState title={t('User detail unavailable')} error={query.error} />
  }

  if (!user || !detail || !editor) {
    return (
      <EmptyState
        title={t('User not found')}
        description={t('The API did not return this user.')}
      />
    )
  }

  return (
    <section className="page user-detail-page">
      <PageHeader
        eyebrow={t('User detail')}
        title={displayName(user)}
        description={`${user.email} - ${t('Real API user record with subscriptions, access, devices, and audit history.')}`}
        actions={
          <div className="action-cluster">
            <Link className="button button--secondary" to="/users">
              <ArrowLeft size={18} aria-hidden="true" />
              {t('Back to users')}
            </Link>
            <button type="button" className="button button--secondary" onClick={() => void query.refetch()}>
              <RefreshCw size={18} aria-hidden="true" />
              {t('Refresh')}
            </button>
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
        <UserFact
          label={t('Devices')}
          value={`${detail.devices.length} / ${user.device_limit === null ? t('unlimited') : user.device_limit}`}
          detail={<StatusBadge tone={hasDevicesOverLimit ? 'danger' : 'info'}>{hasDevicesOverLimit ? t('over limit') : t('within limit')}</StatusBadge>}
        />
        <UserFact label={t('Expires')} value={user.expires_at ? formatDateTime(user.expires_at) : t('Not set')} detail={t('subscription policy')} />
      </section>

      <section className="user-detail-workspace">
        <article className="panel panel--wide user-editor-panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{t('Editable profile')}</p>
              <h2>{t('Account fields')}</h2>
            </div>
            <StatusBadge tone="info">PATCH /api/v1/users/:id</StatusBadge>
          </div>

          <form className="user-editor-grid" onSubmit={saveUser}>
            <label htmlFor="detail-user-email">
              {t('Email')}
              <input
                id="detail-user-email"
                required
                type="email"
                value={editor.email}
                onChange={(event) => setEditor({ ...editor, email: event.target.value })}
              />
            </label>
            <label htmlFor="detail-user-username">
              {t('Username')}
              <input
                id="detail-user-username"
                value={editor.username}
                onChange={(event) => setEditor({ ...editor, username: event.target.value })}
              />
            </label>
            <label htmlFor="detail-user-display-name">
              {t('Display name')}
              <input
                id="detail-user-display-name"
                value={editor.displayName}
                onChange={(event) => setEditor({ ...editor, displayName: event.target.value })}
              />
            </label>
            <label htmlFor="detail-user-telegram">
              {t('Telegram ID')}
              <input
                id="detail-user-telegram"
                value={editor.telegramId}
                onChange={(event) => setEditor({ ...editor, telegramId: event.target.value })}
              />
            </label>
            <label htmlFor="detail-user-role">
              {t('Role')}
              <select
                id="detail-user-role"
                value={editor.role}
                onChange={(event) => setEditor({ ...editor, role: event.target.value as UserEditorState['role'] })}
              >
                <option value="user">{t('user')}</option>
                <option value="operator">{t('operator')}</option>
                <option value="admin">{t('admin')}</option>
                <option value="owner">{t('owner')}</option>
              </select>
            </label>
            <label htmlFor="detail-user-status">
              {t('Status')}
              <select
                id="detail-user-status"
                value={editor.status}
                onChange={(event) => setEditor({ ...editor, status: event.target.value })}
              >
                <option value="active">{t('active')}</option>
                <option value="disabled">{t('disabled')}</option>
                <option value="revoked">{t('revoked')}</option>
                <option value="limited">{t('limited')}</option>
              </select>
            </label>
            <label htmlFor="detail-user-traffic-used">
              {t('Traffic used GB')}
              <input
                id="detail-user-traffic-used"
                inputMode="decimal"
                value={editor.trafficUsed}
                onChange={(event) => setEditor({ ...editor, trafficUsed: event.target.value })}
              />
            </label>
            <label htmlFor="detail-user-traffic-limit">
              {t('Traffic limit GB')}
              <input
                id="detail-user-traffic-limit"
                inputMode="decimal"
                value={editor.trafficLimit}
                onChange={(event) => setEditor({ ...editor, trafficLimit: event.target.value })}
                placeholder={t('unlimited')}
              />
            </label>
            <label htmlFor="detail-user-device-limit">
              {t('Device limit')}
              <input
                id="detail-user-device-limit"
                inputMode="numeric"
                value={editor.deviceLimit}
                onChange={(event) => setEditor({ ...editor, deviceLimit: event.target.value })}
                placeholder={t('unlimited')}
              />
            </label>
            <label htmlFor="detail-user-expires">
              {t('Expiration')}
              <input
                id="detail-user-expires"
                type="datetime-local"
                value={editor.expiresAt}
                onChange={(event) => setEditor({ ...editor, expiresAt: event.target.value })}
              />
            </label>
            <label htmlFor="detail-user-password">
              {t('New password')}
              <input
                id="detail-user-password"
                minLength={8}
                type="password"
                value={editor.password}
                onChange={(event) => setEditor({ ...editor, password: event.target.value })}
                placeholder={t('Leave empty to keep current password')}
              />
            </label>
            <label htmlFor="detail-user-tags" className="user-editor-grid__wide">
              {t('Tags')}
              <input
                id="detail-user-tags"
                value={editor.tags}
                onChange={(event) => setEditor({ ...editor, tags: event.target.value })}
                placeholder="vip, trial"
              />
            </label>
            <label htmlFor="detail-user-metadata" className="user-editor-grid__wide">
              metadata_json
              <textarea
                id="detail-user-metadata"
                rows={10}
                spellCheck={false}
                value={editor.metadataJson}
                onChange={(event) => setEditor({ ...editor, metadataJson: event.target.value })}
              />
            </label>
            <div className="user-editor-grid__actions">
              <button type="submit" className="button button--primary" disabled={updateUser.isPending}>
                <Save size={16} aria-hidden="true" />
                {updateUser.isPending ? t('Saving...') : t('Save user')}
              </button>
              <button type="button" className="button button--secondary" onClick={() => setEditor(userToEditorState(user))}>
                <RefreshCw size={16} aria-hidden="true" />
                {t('Reset form')}
              </button>
              <button type="button" className="button button--danger" onClick={() => void removeUser()}>
                <Trash2 size={16} aria-hidden="true" />
                {t('Delete user')}
              </button>
            </div>
            <FormError message={editorError} />
            <FormError message={updateUser.isError ? mutationError(updateUser.error, t('User could not be saved.')) : null} />
            {savedMessage ? <StatusBadge tone="good">{savedMessage}</StatusBadge> : null}
          </form>
        </article>

        <aside className="side-stack user-detail-side">
          <article className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">{t('Identity')}</p>
                <h2>{t('Current values')}</h2>
              </div>
              <UserCog size={20} aria-hidden="true" />
            </div>
            <dl className="profile-facts">
              <div>
                <dt>ID</dt>
                <dd>{user.id}</dd>
              </div>
              <div>
                <dt>{t('Created')}</dt>
                <dd>{formatDateTime(user.created_at)}</dd>
              </div>
              <div>
                <dt>{t('Updated')}</dt>
                <dd>{formatDateTime(user.updated_at)}</dd>
              </div>
              <div>
                <dt>{t('Tags')}</dt>
                <dd>{user.tags.length > 0 ? user.tags.join(', ') : t('none')}</dd>
              </div>
            </dl>
          </article>

          <article className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">{t('Access')}</p>
                <h2>{t('Accessible nodes')}</h2>
              </div>
              <StatusBadge>{String(detail.accessible_nodes.length)}</StatusBadge>
            </div>
            {detail.accessible_nodes.length === 0 ? (
              <p className="empty-inline">{t('No accessible nodes are available for this user.')}</p>
            ) : (
              <ul className="feature-list">
                {detail.accessible_nodes.map((node) => (
                  <li key={node.id}>
                    <span aria-hidden="true">-</span>
                    <div>
                      <strong>{node.name}</strong>
                      <small>{node.public_address} / {node.region} / {node.status}</small>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </aside>
      </section>

      <section className="resource-grid user-detail-lists">
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

        <article className="panel panel--wide">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{t('HWID')}</p>
              <h2>{detail.devices.length > 0 ? t('Registered devices') : t('Device registry')}</h2>
            </div>
            <div className="inline-actions">
              <StatusBadge tone={hasDevicesOverLimit ? 'danger' : 'info'}>{String(detail.devices.length)}</StatusBadge>
              {detail.devices.length > 0 ? (
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={clearDevices.isPending}
                  onClick={() => void clearUserDevices()}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  {t('Clear all devices')}
                </button>
              ) : null}
            </div>
          </div>
          {detail.devices.length === 0 ? (
            <p className="empty-inline">{t('No devices are registered for this user yet.')}</p>
          ) : (
            <DataTable
              caption={t('Registered devices')}
              columns={['Device', 'HWID', 'Platform', 'Status', 'Last seen', 'Metadata', 'Actions']}
              rows={detail.devices.map((device) => ({
                id: device.id,
                cells: [
                  device.label ?? device.id,
                  device.hwid ?? '-',
                  device.platform ?? t('unknown platform'),
                  <StatusBadge tone={toneForStatus(device.status)}>{device.status}</StatusBadge>,
                  device.last_seen_at ? formatDateTime(device.last_seen_at) : t('Not recorded'),
                  formatRecord(device.metadata_json),
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
              <h2>{t('Request and admin audit')}</h2>
            </div>
            <StatusBadge tone="info">{String(detail.request_history.length)}</StatusBadge>
          </div>
          {detail.request_history.length === 0 ? (
            <p className="empty-inline">{t('No request history is recorded for this user yet.')}</p>
          ) : (
            <DataTable
              caption={t('Backend request audit')}
              columns={['Action', 'Actor', 'Created at', 'Resource', 'Metadata']}
              rows={detail.request_history.map((event) => ({
                id: event.id,
                cells: [
                  event.action,
                  event.actor_email ?? event.actor_subject,
                  formatDateTime(event.created_at),
                  event.resource_type,
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
