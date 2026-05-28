import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Ban, RefreshCw, RotateCcw, Save, Trash2 } from 'lucide-react'
import {
  useBulkUsers,
  useCreateUser,
  useDeleteUser,
  useUpdateUser,
  useUsersPageData,
} from '../shared/api/resourceHooks'
import type { UserRecord } from '../shared/api/types'
import { DataTable } from '../shared/components/DataTable'
import { EmptyState, ErrorState, LoadingState } from '../shared/components/DataState'
import {
  FormError,
  ScreenForm,
  SubmitButton,
} from '../shared/components/ResourceScreen'
import { PageHeader } from '../shared/components/PageHeader'
import { StatusBadge } from '../shared/components/StatusBadge'
import { sectionSpecs } from '../shared/data/lumenData'
import { useI18n } from '../shared/i18n/I18nProvider'
import { toneForStatus } from '../shared/utils/resourceFormat'

function formatUserName(user: UserRecord): string {
  return user.display_name || user.username || user.email
}

function formatLimit(user: UserRecord, t: (value: string) => string): string {
  const used = `${user.traffic_used_gb.toFixed(2)} GB`
  if (user.traffic_limit_gb === null) {
    return `${used} / ${t('unlimited')}`
  }
  return `${used} / ${user.traffic_limit_gb.toFixed(0)} GB`
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export function UsersPage() {
  const { t } = useI18n()
  const spec = sectionSpecs.users
  const query = useUsersPageData()
  const createUser = useCreateUser()
  const updateUser = useUpdateUser()
  const deleteUser = useDeleteUser()
  const bulkUsers = useBulkUsers()
  const users = query.data?.items ?? []
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [trafficLimit, setTrafficLimit] = useState('300')
  const [deviceLimit, setDeviceLimit] = useState('5')
  const [formError, setFormError] = useState<string | null>(null)

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    const parsedTrafficLimit = trafficLimit.trim() ? Number(trafficLimit) : null
    const parsedDeviceLimit = deviceLimit.trim() ? Number(deviceLimit) : null
    if (
      (parsedTrafficLimit !== null && !Number.isFinite(parsedTrafficLimit)) ||
      (parsedDeviceLimit !== null && !Number.isInteger(parsedDeviceLimit))
    ) {
      setFormError(t('Traffic and device limits must be valid numbers.'))
      return
    }
    try {
      await createUser.mutateAsync({
        device_limit: parsedDeviceLimit,
        display_name: displayName.trim() || null,
        email: email.trim(),
        role: 'user',
        status: 'active',
        traffic_limit_gb: parsedTrafficLimit,
        username: username.trim() || null,
      })
      setEmail('')
      setUsername('')
      setDisplayName('')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('User could not be created.'))
    }
  }

  async function runBulk(action: string, status?: string) {
    if (selectedIds.size === 0) {
      setFormError(t('Select at least one user first.'))
      return
    }
    setFormError(null)
    await bulkUsers.mutateAsync({
      action,
      request: { status, user_ids: Array.from(selectedIds) },
    })
  }

  return (
    <section className="page">
      <PageHeader
        eyebrow={spec.eyebrow}
        title={spec.title}
        description={t('Real VPN customer accounts with traffic, device limits, expiry, status and bulk controls.')}
        actions={
          <button
            type="button"
            className="button button--secondary"
            aria-label={t('Refresh users')}
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw size={18} aria-hidden="true" />
            {t('Refresh')}
          </button>
        }
      />

      {query.isLoading ? <LoadingState label={t('Loading users...')} /> : null}
      {query.isError ? <ErrorState title={t('Users unavailable')} error={query.error} /> : null}
      {query.isSuccess && users.length === 0 ? (
        <EmptyState
          title={t('No users found')}
          description={t('Create the first VPN customer account to issue subscriptions and assign squads.')}
        />
      ) : null}

      <section className="resource-grid">
        <article className="panel panel--wide">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{t('Identity registry')}</p>
              <h2>{t('User directory')}</h2>
            </div>
            <StatusBadge>{t('users.count', { count: users.length })}</StatusBadge>
          </div>
          <div className="inline-actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void runBulk('status', 'active')}
            >
              <Save size={16} aria-hidden="true" />
              {t('Enable selected')}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void runBulk('status', 'disabled')}
            >
              <Ban size={16} aria-hidden="true" />
              {t('Disable selected')}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void runBulk('reset-traffic')}
            >
              <RotateCcw size={16} aria-hidden="true" />
              {t('Reset traffic')}
            </button>
          </div>
          <DataTable
            caption={t('User directory')}
            columns={['Select', 'User', 'Role', 'Devices', 'Traffic', 'Tags', 'Status', 'Actions']}
            rows={users.map((user) => ({
              cells: [
                <input
                  aria-label={t('Select {name}', { name: formatUserName(user) })}
                  checked={selectedIds.has(user.id)}
                  type="checkbox"
                  onChange={() => toggleSelected(user.id)}
                />,
                <div>
                  <Link className="text-link" to={`/users/${user.id}`}>
                    {formatUserName(user)}
                  </Link>
                  <p className="table-subtext">{user.email}</p>
                </div>,
                user.role,
                user.device_limit === null ? t('unlimited') : user.device_limit,
                formatLimit(user, t),
                user.tags.length > 0 ? user.tags.join(', ') : t('none'),
                <StatusBadge tone={toneForStatus(user.status)}>{user.status}</StatusBadge>,
                <div className="inline-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('Toggle status {name}', { name: formatUserName(user) })}
                    disabled={updateUser.isPending}
                    onClick={() =>
                      void updateUser.mutateAsync({
                        id: user.id,
                        request: { status: user.status === 'active' ? 'disabled' : 'active' },
                      })
                    }
                  >
                    <Ban size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('Reset traffic {name}', { name: formatUserName(user) })}
                    disabled={updateUser.isPending}
                    onClick={() =>
                      void updateUser.mutateAsync({
                        id: user.id,
                        request: { traffic_used_gb: 0 },
                      })
                    }
                  >
                    <RotateCcw size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('Revoke {name}', { name: formatUserName(user) })}
                    disabled={updateUser.isPending}
                    onClick={() =>
                      void updateUser.mutateAsync({
                        id: user.id,
                        request: { status: 'revoked' },
                      })
                    }
                  >
                    <Ban size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('Delete {name}', { name: formatUserName(user) })}
                    disabled={deleteUser.isPending}
                    onClick={() => void deleteUser.mutateAsync(user.id)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>,
              ],
              id: user.id,
            }))}
          />
        </article>
        <ScreenForm onSubmit={handleCreate}>
          <div>
            <p className="eyebrow">{t('Create user')}</p>
            <h2>{t('VPN account')}</h2>
            <p>{t('Limits are stored in the backend and used by subscription delivery.')}</p>
          </div>
          <label htmlFor="user-email">
            {t('Email')}
            <input
              id="user-email"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label htmlFor="user-username">
            {t('Username')}
            <input
              id="user-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label htmlFor="user-display-name">
            {t('Display name')}
            <input
              id="user-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label htmlFor="user-traffic-limit">
            {t('Traffic limit GB')}
            <input
              id="user-traffic-limit"
              inputMode="decimal"
              value={trafficLimit}
              onChange={(event) => setTrafficLimit(event.target.value)}
            />
          </label>
          <label htmlFor="user-device-limit">
            {t('Device limit')}
            <input
              id="user-device-limit"
              inputMode="numeric"
              value={deviceLimit}
              onChange={(event) => setDeviceLimit(event.target.value)}
            />
          </label>
          <FormError message={formError} />
          <FormError
            message={
              createUser.isError
                ? getErrorMessage(createUser.error, t('User could not be created.'))
                : null
            }
          />
          <FormError
            message={
              updateUser.isError
                ? getErrorMessage(updateUser.error, t('User could not be updated.'))
                : null
            }
          />
          <FormError
            message={
              deleteUser.isError
                ? getErrorMessage(deleteUser.error, t('User could not be deleted.'))
                : null
            }
          />
          <FormError
            message={
              bulkUsers.isError
                ? getErrorMessage(bulkUsers.error, t('Bulk user action failed.'))
                : null
            }
          />
          <SubmitButton pending={createUser.isPending}>{t('Create user')}</SubmitButton>
        </ScreenForm>
      </section>
    </section>
  )
}
