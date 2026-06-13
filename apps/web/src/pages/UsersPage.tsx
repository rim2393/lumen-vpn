import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  Ban,
  CalendarClock,
  CheckCircle2,
  Eye,
  Filter,
  RefreshCw,
  RotateCcw,
  Search,
  Tags,
  Trash2,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import {
  useBulkUsers,
  useCreateUser,
  useDeleteUser,
  useDisableUser,
  useEnableUser,
  useLookupUsers,
  useResetUserTraffic,
  useRevokeUser,
  useSquadsPageData,
  useUsersPageData,
} from '../shared/api/resourceHooks'
import type { UserRecord } from '../shared/api/types'
import { DataTable } from '../shared/components/DataTable'
import { EmptyState, ErrorState, LoadingState } from '../shared/components/DataState'
import { FormError, ScreenForm, SubmitButton } from '../shared/components/ResourceScreen'
import { PageHeader } from '../shared/components/PageHeader'
import { StatusBadge } from '../shared/components/StatusBadge'
import { sectionSpecs } from '../shared/data/resourceMeta'
import { useI18n } from '../shared/i18n/I18nProvider'
import { formatDateTime, toneForStatus } from '../shared/utils/resourceFormat'

type StatusFilter = 'all' | 'active' | 'disabled' | 'revoked' | 'expired' | 'over_limit'
type SortMode = 'created_desc' | 'traffic_desc' | 'expires_asc' | 'name_asc'
type UserDangerAction = 'delete' | 'reset-traffic' | 'revoke'
type UserDangerTarget =
  | { action: UserDangerAction; kind: 'bulk'; count: number; ids: string[] }
  | { action: UserDangerAction; kind: 'single'; user: UserRecord }

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

function isExpired(user: UserRecord) {
  return Boolean(user.expires_at && Date.parse(user.expires_at) <= Date.now())
}

function isOverTrafficLimit(user: UserRecord) {
  return user.traffic_limit_gb !== null && user.traffic_used_gb >= user.traffic_limit_gb
}

function userMatchesSearch(user: UserRecord, needle: string) {
  if (!needle) {
    return true
  }
  const fields = [
    user.id,
    user.email,
    user.username,
    user.display_name,
    user.telegram_id,
    user.role,
    user.status,
    ...user.tags,
    String(user.metadata_json.numeric_id ?? user.metadata_json.id ?? ''),
  ]
  return fields.some((field) => String(field ?? '').toLowerCase().includes(needle))
}

function sortedUsers(users: UserRecord[], sortMode: SortMode) {
  const items = [...users]
  switch (sortMode) {
    case 'traffic_desc':
      return items.sort((left, right) => right.traffic_used_gb - left.traffic_used_gb)
    case 'expires_asc':
      return items.sort((left, right) => {
        const leftTime = left.expires_at ? Date.parse(left.expires_at) : Number.POSITIVE_INFINITY
        const rightTime = right.expires_at ? Date.parse(right.expires_at) : Number.POSITIVE_INFINITY
        return leftTime - rightTime
      })
    case 'name_asc':
      return items.sort((left, right) => formatUserName(left).localeCompare(formatUserName(right)))
    case 'created_desc':
    default:
      return items.sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
  }
}

export function UsersPage() {
  const { t } = useI18n()
  const spec = sectionSpecs.users
  const query = useUsersPageData()
  const squadsQuery = useSquadsPageData()
  const createUser = useCreateUser()
  const deleteUser = useDeleteUser()
  const enableUser = useEnableUser()
  const disableUser = useDisableUser()
  const revokeUser = useRevokeUser()
  const resetUserTraffic = useResetUserTraffic()
  const bulkUsers = useBulkUsers()
  const lookupUsers = useLookupUsers()
  const users = query.data?.items ?? []
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [focusedUserId, setFocusedUserId] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('created_desc')
  const [lookupQuery, setLookupQuery] = useState('')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [trafficLimit, setTrafficLimit] = useState('300')
  const [deviceLimit, setDeviceLimit] = useState('5')
  const [bulkTags, setBulkTags] = useState('')
  const [bulkExpiresAt, setBulkExpiresAt] = useState('')
  const [bulkTrafficDelta, setBulkTrafficDelta] = useState('')
  const [bulkSquadId, setBulkSquadId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingDanger, setPendingDanger] = useState<UserDangerTarget | null>(null)

  const filteredUsers = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const statusMatched = users.filter((user) => {
      if (!userMatchesSearch(user, needle)) {
        return false
      }
      if (statusFilter === 'expired') {
        return isExpired(user)
      }
      if (statusFilter === 'over_limit') {
        return isOverTrafficLimit(user)
      }
      return statusFilter === 'all' || user.status === statusFilter
    })
    return sortedUsers(statusMatched, sortMode)
  }, [search, sortMode, statusFilter, users])

  const focusedUser = useMemo(
    () => users.find((user) => user.id === focusedUserId) ?? filteredUsers[0],
    [filteredUsers, focusedUserId, users],
  )

  const stats = useMemo(() => {
    const trafficUsed = users.reduce((total, user) => total + user.traffic_used_gb, 0)
    const trafficLimit = users.reduce(
      (total, user) => total + (user.traffic_limit_gb === null ? 0 : user.traffic_limit_gb),
      0,
    )
    return {
      active: users.filter((user) => user.status === 'active').length,
      disabled: users.filter((user) => user.status === 'disabled').length,
      expired: users.filter(isExpired).length,
      overLimit: users.filter(isOverTrafficLimit).length,
      revoked: users.filter((user) => user.status === 'revoked').length,
      total: users.length,
      trafficLimit,
      trafficUsed,
    }
  }, [users])

  const allFilteredSelected =
    filteredUsers.length > 0 && filteredUsers.every((user) => selectedIds.has(user.id))

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

  function toggleFilteredSelection() {
    setSelectedIds((current) => {
      if (allFilteredSelected) {
        const next = new Set(current)
        for (const user of filteredUsers) {
          next.delete(user.id)
        }
        return next
      }
      const next = new Set(current)
      for (const user of filteredUsers) {
        next.add(user.id)
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
      const created = await createUser.mutateAsync({
        device_limit: parsedDeviceLimit,
        display_name: displayName.trim() || null,
        email: email.trim(),
        role: 'user',
        status: 'active',
        traffic_limit_gb: parsedTrafficLimit,
        username: username.trim() || null,
      })
      setFocusedUserId(created.id)
      setEmail('')
      setUsername('')
      setDisplayName('')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('User could not be created.'))
    }
  }

  async function runBulk(action: string, status?: string) {
    await runBulkWithRequest(action, { status })
  }

  async function runBulkWithRequest(
    action: string,
    request: {
      expires_at?: string | null
      squad_id?: string | null
      status?: string | null
      tags?: string[] | null
      traffic_delta_gb?: number | null
    } = {},
  ) {
    if (selectedIds.size === 0) {
      setFormError(t('Select at least one user first.'))
      return
    }
    if (action === 'delete' || action === 'revoke' || action === 'reset-traffic') {
      setPendingDanger({
        action: action as UserDangerAction,
        count: selectedIds.size,
        ids: Array.from(selectedIds),
        kind: 'bulk',
      })
      return
    }
    setFormError(null)
    await bulkUsers.mutateAsync({
      action,
      request: { ...request, user_ids: Array.from(selectedIds) },
    })
    if (action === 'delete') {
      setSelectedIds(new Set())
    }
  }

  async function confirmDanger() {
    if (!pendingDanger) {
      return
    }
    setFormError(null)
    try {
      if (pendingDanger.kind === 'bulk') {
        await bulkUsers.mutateAsync({
          action: pendingDanger.action,
          request: { user_ids: pendingDanger.ids },
        })
        if (pendingDanger.action === 'delete') {
          setSelectedIds(new Set())
        }
      } else if (pendingDanger.action === 'delete') {
        await deleteUser.mutateAsync(pendingDanger.user.id)
      } else if (pendingDanger.action === 'revoke') {
        await revokeUser.mutateAsync(pendingDanger.user.id)
      } else {
        await resetUserTraffic.mutateAsync(pendingDanger.user.id)
      }
      setPendingDanger(null)
      await query.refetch()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('User action failed.'))
    }
  }

  async function runBulkTags() {
    const tags = bulkTags.split(',').map((tag) => tag.trim()).filter(Boolean)
    if (tags.length === 0) {
      setFormError(t('Enter at least one tag.'))
      return
    }
    await runBulkWithRequest('tag', { tags })
  }

  async function runBulkExtend() {
    if (!bulkExpiresAt) {
      setFormError(t('Set an expiration date first.'))
      return
    }
    await runBulkWithRequest('extend', { expires_at: new Date(bulkExpiresAt).toISOString() })
  }

  async function runBulkTrafficDelta() {
    const value = Number(bulkTrafficDelta)
    if (!Number.isFinite(value)) {
      setFormError(t('Traffic delta must be a valid number.'))
      return
    }
    await runBulkWithRequest('traffic', { traffic_delta_gb: value })
  }

  async function runBulkSquad(action: 'squad-add' | 'squad-remove') {
    if (!bulkSquadId) {
      setFormError(t('Select a squad first.'))
      return
    }
    await runBulkWithRequest(action, { squad_id: bulkSquadId })
  }

  async function handleLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const queryText = lookupQuery.trim()
    if (!queryText) {
      setFormError(t('Enter a user lookup query.'))
      return
    }
    setFormError(null)
    await lookupUsers.mutateAsync(queryText)
  }

  return (
    <section className="page users-page">
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

      <section className="summary-grid" aria-label={t('Users summary')}>
        <SummaryTile label={t('Total users')} value={String(stats.total)} detail={`${stats.active} ${t('active')}`} />
        <SummaryTile label={t('Disabled')} value={String(stats.disabled)} detail={`${stats.revoked} ${t('revoked')}`} />
        <SummaryTile label={t('Expired')} value={String(stats.expired)} detail={`${stats.overLimit} ${t('over limit')}`} />
        <SummaryTile
          label={t('Traffic')}
          value={`${stats.trafficUsed.toFixed(1)} GB`}
          detail={stats.trafficLimit > 0 ? `/ ${stats.trafficLimit.toFixed(0)} GB` : t('unlimited')}
        />
      </section>

      <section className="users-workspace">
        <article className="panel panel--wide users-directory">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{t('Identity registry')}</p>
              <h2>{t('User directory')}</h2>
            </div>
            <StatusBadge>{`${t('Showing')} ${filteredUsers.length} / ${users.length}`}</StatusBadge>
          </div>

          <div className="users-toolbar">
            <label htmlFor="users-search" className="field">
              {t('Search users')}
              <span className="topbar__search users-toolbar__search">
                <Search size={18} aria-hidden="true" />
                <input
                  id="users-search"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('Email, username, tag, Telegram, UUID')}
                />
              </span>
            </label>
            <label htmlFor="users-status-filter" className="field">
              {t('Status')}
              <select
                id="users-status-filter"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              >
                <option value="all">{t('All statuses')}</option>
                <option value="active">{t('Active')}</option>
                <option value="disabled">{t('Disabled')}</option>
                <option value="revoked">{t('Revoked')}</option>
                <option value="expired">{t('Expired')}</option>
                <option value="over_limit">{t('Over traffic limit')}</option>
              </select>
            </label>
            <label htmlFor="users-sort" className="field">
              {t('Sort')}
              <select id="users-sort" value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                <option value="created_desc">{t('Newest first')}</option>
                <option value="traffic_desc">{t('Traffic used')}</option>
                <option value="expires_asc">{t('Expiration first')}</option>
                <option value="name_asc">{t('Name')}</option>
              </select>
            </label>
            <button
              type="button"
              className="button button--secondary"
              disabled={filteredUsers.length === 0}
              onClick={toggleFilteredSelection}
            >
              <Filter size={16} aria-hidden="true" />
              {allFilteredSelected ? t('Unselect filtered') : t('Select filtered')}
            </button>
          </div>

          <div className="users-bulk-panel" aria-label={t('Bulk user actions')}>
            <div>
              <span>{t('Selected users')}</span>
              <strong>{selectedIds.size}</strong>
            </div>
            <div className="inline-actions inline-actions--compact">
              <button type="button" className="button button--secondary" onClick={() => void runBulk('status', 'active')}>
                <CheckCircle2 size={16} aria-hidden="true" />
                {t('Enable')}
              </button>
              <button type="button" className="button button--secondary" onClick={() => void runBulk('status', 'disabled')}>
                <Ban size={16} aria-hidden="true" />
                {t('Disable')}
              </button>
              <button type="button" className="button button--secondary" onClick={() => void runBulk('reset-traffic')}>
                <RotateCcw size={16} aria-hidden="true" />
                {t('Reset traffic')}
              </button>
              <button type="button" className="button button--secondary" onClick={() => void runBulkWithRequest('revoke')}>
                <Ban size={16} aria-hidden="true" />
                {t('Revoke')}
              </button>
              <button type="button" className="button button--secondary" onClick={() => void runBulkWithRequest('delete')}>
                <Trash2 size={16} aria-hidden="true" />
                {t('Delete')}
              </button>
            </div>
          </div>

          <DataTable
            caption={t('User directory')}
            columns={['Select', 'User', 'Devices', 'Traffic', 'Expires', 'Tags', 'Status', 'Actions']}
            rows={filteredUsers.map((user) => ({
              className: user.id === focusedUser?.id ? 'data-table__row--selected' : undefined,
              cells: [
                <input
                  aria-label={t('Select {name}', { name: formatUserName(user) })}
                  checked={selectedIds.has(user.id)}
                  type="checkbox"
                  onChange={() => toggleSelected(user.id)}
                />,
                <div>
                  <Link
                    className="users-table-identity text-link"
                    to={`/users/${user.id}`}
                    onMouseEnter={() => setFocusedUserId(user.id)}
                    onFocus={() => setFocusedUserId(user.id)}
                  >
                    <span>{formatUserName(user)}</span>
                    <small>{user.id.slice(0, 8)}</small>
                  </Link>
                  <p className="table-subtext">{user.email}</p>
                </div>,
                user.device_limit === null ? t('unlimited') : user.device_limit,
                formatLimit(user, t),
                user.expires_at ? formatDateTime(user.expires_at) : t('Not set'),
                user.tags.length > 0 ? user.tags.join(', ') : t('none'),
                <StatusBadge tone={toneForStatus(isExpired(user) ? 'expired' : user.status)}>
                  {isExpired(user) ? t('expired') : user.status}
                </StatusBadge>,
                <div className="inline-actions inline-actions--compact">
                  <Link
                    className="icon-button"
                    aria-label={t('Open {name}', { name: formatUserName(user) })}
                    title={t('Open detail')}
                    to={`/users/${user.id}`}
                    onMouseEnter={() => setFocusedUserId(user.id)}
                    onFocus={() => setFocusedUserId(user.id)}
                  >
                    <Eye size={16} aria-hidden="true" />
                  </Link>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('Toggle status {name}', { name: formatUserName(user) })}
                    title={user.status === 'active' ? t('Disable') : t('Enable')}
                    disabled={enableUser.isPending || disableUser.isPending}
                    onClick={() =>
                      void (user.status === 'active'
                        ? disableUser.mutateAsync(user.id)
                        : enableUser.mutateAsync(user.id))
                    }
                  >
                    <Ban size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('Reset traffic {name}', { name: formatUserName(user) })}
                    title={t('Reset traffic')}
                    disabled={resetUserTraffic.isPending}
                    onClick={() => setPendingDanger({ action: 'reset-traffic', kind: 'single', user })}
                  >
                    <RotateCcw size={16} aria-hidden="true" />
                  </button>
                </div>,
              ],
              id: user.id,
            }))}
          />
        </article>

        <aside className="side-stack users-side">
          <UserDangerConfirm
            pending={bulkUsers.isPending || deleteUser.isPending || resetUserTraffic.isPending || revokeUser.isPending}
            target={pendingDanger}
            onCancel={() => setPendingDanger(null)}
            onConfirm={() => void confirmDanger()}
          />
          <FocusedUserCard
            disableUser={disableUser}
            enableUser={enableUser}
            onDanger={setPendingDanger}
            t={t}
            user={focusedUser}
          />
          <BulkEditor
            bulkExpiresAt={bulkExpiresAt}
            bulkSquadId={bulkSquadId}
            bulkTags={bulkTags}
            bulkTrafficDelta={bulkTrafficDelta}
            runBulkExtend={runBulkExtend}
            runBulkSquad={runBulkSquad}
            runBulkTags={runBulkTags}
            runBulkTrafficDelta={runBulkTrafficDelta}
            setBulkExpiresAt={setBulkExpiresAt}
            setBulkSquadId={setBulkSquadId}
            setBulkTags={setBulkTags}
            setBulkTrafficDelta={setBulkTrafficDelta}
            squads={squadsQuery.data?.items ?? []}
            t={t}
          />
          <LookupCard
            handleLookup={handleLookup}
            lookupQuery={lookupQuery}
            lookupUsers={lookupUsers}
            setLookupQuery={setLookupQuery}
            t={t}
          />
          <CreateUserCard
            createUser={createUser}
            deviceLimit={deviceLimit}
            displayName={displayName}
            email={email}
            formError={formError}
            handleCreate={handleCreate}
            setDeviceLimit={setDeviceLimit}
            setDisplayName={setDisplayName}
            setEmail={setEmail}
            setTrafficLimit={setTrafficLimit}
            setUsername={setUsername}
            t={t}
            trafficLimit={trafficLimit}
            username={username}
          />
          <FormError
            message={
              bulkUsers.isError
                ? getErrorMessage(bulkUsers.error, t('Bulk user action failed.'))
                : null
            }
          />
        </aside>
      </section>
    </section>
  )
}

function UserDangerConfirm({
  onCancel,
  onConfirm,
  pending,
  target,
}: {
  onCancel: () => void
  onConfirm: () => void
  pending: boolean
  target: UserDangerTarget | null
}) {
  const { t } = useI18n()
  if (!target) {
    return null
  }
  const name = target.kind === 'single' ? formatUserName(target.user) : String(target.count)
  const titleKey =
    target.action === 'delete'
      ? target.kind === 'single'
        ? 'Delete user {name}'
        : 'Delete selected users'
      : target.action === 'revoke'
        ? target.kind === 'single'
          ? 'Revoke user {name}'
          : 'Revoke selected users'
        : target.kind === 'single'
          ? 'Reset traffic for {name}'
          : 'Reset traffic for selected users'
  const descriptionKey =
    target.action === 'delete'
      ? target.kind === 'single'
        ? 'This will remove the real user through the production API.'
        : 'This will remove {count} real users through the production API.'
      : target.action === 'revoke'
        ? target.kind === 'single'
          ? 'This will revoke the real user through the production API.'
          : 'This will revoke {count} real users through the production API.'
        : target.kind === 'single'
          ? 'This will reset real traffic counters through the production API.'
          : 'This will reset traffic counters for {count} real users through the production API.'

  return (
    <section className="danger-confirm-inline" role="alertdialog" aria-modal="false" aria-label={t(titleKey, { count: name, name })}>
      <div>
        <p className="eyebrow">{t('Danger action')}</p>
        <h3>{t(titleKey, { count: name, name })}</h3>
        <p>{t(descriptionKey, { count: name, name })}</p>
      </div>
      <div className="inline-actions inline-actions--compact">
        <button type="button" className="button button--secondary" disabled={pending} onClick={onCancel}>
          {t('Cancel')}
        </button>
        <button type="button" className="button button--danger" disabled={pending} onClick={onConfirm}>
          {target.action === 'reset-traffic' ? t('Reset traffic') : target.action === 'revoke' ? t('Revoke') : t('Delete')}
        </button>
      </div>
    </section>
  )
}

function SummaryTile({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}

function FocusedUserCard({
  disableUser,
  enableUser,
  onDanger,
  t,
  user,
}: {
  disableUser: ReturnType<typeof useDisableUser>
  enableUser: ReturnType<typeof useEnableUser>
  onDanger: (target: UserDangerTarget) => void
  t: (value: string, params?: Record<string, string | number>) => string
  user: UserRecord | undefined
}) {
  if (!user) {
    return (
      <article className="panel">
        <p className="eyebrow">{t('Selection')}</p>
        <h2>{t('No user selected')}</h2>
        <p className="empty-inline">{t('Select a user to inspect account controls.')}</p>
      </article>
    )
  }

  return (
    <article className="panel users-focus-card">
      <div className="panel__header users-focus-card__header">
        <div>
          <p className="eyebrow">{t('Selected user')}</p>
          <h2>{formatUserName(user)}</h2>
        </div>
        <StatusBadge tone={toneForStatus(user.status)}>{user.status}</StatusBadge>
      </div>
      <dl className="profile-facts">
        <div>
          <dt>{t('Email')}</dt>
          <dd>{user.email}</dd>
        </div>
        <div>
          <dt>{t('Traffic')}</dt>
          <dd>{formatLimit(user, t)}</dd>
        </div>
        <div>
          <dt>{t('Devices')}</dt>
          <dd>{user.device_limit === null ? t('unlimited') : String(user.device_limit)}</dd>
        </div>
        <div>
          <dt>{t('Expires')}</dt>
          <dd>{user.expires_at ? formatDateTime(user.expires_at) : t('Not set')}</dd>
        </div>
        <div>
          <dt>{t('Telegram ID')}</dt>
          <dd>{user.telegram_id ?? t('Not set')}</dd>
        </div>
      </dl>
      <div className="inline-actions">
        <Link className="button button--primary" to={`/users/${user.id}`}>
          <Eye size={16} aria-hidden="true" />
          {t('Open detail')}
        </Link>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => void (user.status === 'active' ? disableUser.mutateAsync(user.id) : enableUser.mutateAsync(user.id))}
        >
          <Ban size={16} aria-hidden="true" />
          {user.status === 'active' ? t('Disable') : t('Enable')}
        </button>
        <button type="button" className="button button--secondary" onClick={() => onDanger({ action: 'reset-traffic', kind: 'single', user })}>
          <RotateCcw size={16} aria-hidden="true" />
          {t('Reset traffic')}
        </button>
        <button type="button" className="button button--secondary" onClick={() => onDanger({ action: 'revoke', kind: 'single', user })}>
          <Ban size={16} aria-hidden="true" />
          {t('Revoke')}
        </button>
        <button type="button" className="button button--danger" onClick={() => onDanger({ action: 'delete', kind: 'single', user })}>
          <Trash2 size={16} aria-hidden="true" />
          {t('Delete')}
        </button>
      </div>
    </article>
  )
}

function BulkEditor({
  bulkExpiresAt,
  bulkSquadId,
  bulkTags,
  bulkTrafficDelta,
  runBulkExtend,
  runBulkSquad,
  runBulkTags,
  runBulkTrafficDelta,
  setBulkExpiresAt,
  setBulkSquadId,
  setBulkTags,
  setBulkTrafficDelta,
  squads,
  t,
}: {
  bulkExpiresAt: string
  bulkSquadId: string
  bulkTags: string
  bulkTrafficDelta: string
  runBulkExtend: () => Promise<void>
  runBulkSquad: (action: 'squad-add' | 'squad-remove') => Promise<void>
  runBulkTags: () => Promise<void>
  runBulkTrafficDelta: () => Promise<void>
  setBulkExpiresAt: (value: string) => void
  setBulkSquadId: (value: string) => void
  setBulkTags: (value: string) => void
  setBulkTrafficDelta: (value: string) => void
  squads: Array<{ id: string; name: string }>
  t: (value: string, params?: Record<string, string | number>) => string
}) {
  return (
    <article className="panel">
      <p className="eyebrow">{t('Bulk operations')}</p>
      <h2>{t('Policy edits')}</h2>
      <div className="resource-list users-policy-list">
        <label htmlFor="bulk-user-tags">
          {t('Tags')}
          <input id="bulk-user-tags" value={bulkTags} onChange={(event) => setBulkTags(event.target.value)} placeholder="vip, trial" />
        </label>
        <button type="button" className="button button--secondary" onClick={() => void runBulkTags()}>
          <Tags size={16} aria-hidden="true" />
          {t('Apply tags')}
        </button>
        <label htmlFor="bulk-user-expires-at">
          {t('Expiration')}
          <input id="bulk-user-expires-at" type="datetime-local" value={bulkExpiresAt} onChange={(event) => setBulkExpiresAt(event.target.value)} />
        </label>
        <button type="button" className="button button--secondary" onClick={() => void runBulkExtend()}>
          <CalendarClock size={16} aria-hidden="true" />
          {t('Extend selected')}
        </button>
        <label htmlFor="bulk-user-traffic-delta">
          {t('Traffic delta GB')}
          <input id="bulk-user-traffic-delta" inputMode="decimal" value={bulkTrafficDelta} onChange={(event) => setBulkTrafficDelta(event.target.value)} placeholder="10 or -5" />
        </label>
        <button type="button" className="button button--secondary" onClick={() => void runBulkTrafficDelta()}>
          <RotateCcw size={16} aria-hidden="true" />
          {t('Apply traffic delta')}
        </button>
        <label htmlFor="bulk-user-squad">
          {t('Squad')}
          <select id="bulk-user-squad" value={bulkSquadId} onChange={(event) => setBulkSquadId(event.target.value)}>
            <option value="">{t('Select squad')}</option>
            {squads.map((squad) => (
              <option key={squad.id} value={squad.id}>
                {squad.name}
              </option>
            ))}
          </select>
        </label>
        <div className="inline-actions">
          <button type="button" className="button button--secondary" onClick={() => void runBulkSquad('squad-add')}>
            <UserPlus size={16} aria-hidden="true" />
            {t('Add to squad')}
          </button>
          <button type="button" className="button button--secondary" onClick={() => void runBulkSquad('squad-remove')}>
            <UserMinus size={16} aria-hidden="true" />
            {t('Remove from squad')}
          </button>
        </div>
      </div>
    </article>
  )
}

function LookupCard({
  handleLookup,
  lookupQuery,
  lookupUsers,
  setLookupQuery,
  t,
}: {
  handleLookup: (event: FormEvent<HTMLFormElement>) => Promise<void>
  lookupQuery: string
  lookupUsers: ReturnType<typeof useLookupUsers>
  setLookupQuery: (value: string) => void
  t: (value: string, params?: Record<string, string | number>) => string
}) {
  return (
    <ScreenForm onSubmit={handleLookup}>
      <div>
        <p className="eyebrow">{t('Lookup')}</p>
        <h2>{t('Find user')}</h2>
        <p>{t('Lookup by UUID, short UUID, username, email, numeric ID, Telegram ID, or tag.')}</p>
      </div>
      <label htmlFor="user-lookup-query">
        {t('Lookup query')}
        <input id="user-lookup-query" value={lookupQuery} onChange={(event) => setLookupQuery(event.target.value)} placeholder="email@example.com, tag:trial, 12345" />
      </label>
      <SubmitButton pending={lookupUsers.isPending}>
        <Search size={16} aria-hidden="true" />
        {t('Find user')}
      </SubmitButton>
      <FormError message={lookupUsers.isError ? getErrorMessage(lookupUsers.error, t('User lookup failed.')) : null} />
      {lookupUsers.data ? (
        <div className="resource-list">
          <div className="resource-list__item">
            <span>{t('Lookup strategy')}</span>
            <small>{lookupUsers.data.strategy}</small>
          </div>
          {lookupUsers.data.items.length === 0 ? (
            <div className="resource-list__item">
              <span>{t('No users found')}</span>
              <small>{lookupUsers.data.query}</small>
            </div>
          ) : (
            lookupUsers.data.items.map((user) => (
              <div className="resource-list__item" key={user.id}>
                <span>
                  <Link className="text-link" to={`/users/${user.id}`}>
                    {formatUserName(user)}
                  </Link>
                </span>
                <small>{user.email}</small>
              </div>
            ))
          )}
        </div>
      ) : null}
    </ScreenForm>
  )
}

function CreateUserCard({
  createUser,
  deviceLimit,
  displayName,
  email,
  formError,
  handleCreate,
  setDeviceLimit,
  setDisplayName,
  setEmail,
  setTrafficLimit,
  setUsername,
  t,
  trafficLimit,
  username,
}: {
  createUser: ReturnType<typeof useCreateUser>
  deviceLimit: string
  displayName: string
  email: string
  formError: string | null
  handleCreate: (event: FormEvent<HTMLFormElement>) => Promise<void>
  setDeviceLimit: (value: string) => void
  setDisplayName: (value: string) => void
  setEmail: (value: string) => void
  setTrafficLimit: (value: string) => void
  setUsername: (value: string) => void
  t: (value: string, params?: Record<string, string | number>) => string
  trafficLimit: string
  username: string
}) {
  return (
    <ScreenForm onSubmit={handleCreate}>
      <div>
        <p className="eyebrow">{t('Create user')}</p>
        <h2>{t('VPN account')}</h2>
        <p>{t('Limits are stored in the backend and used by subscription delivery.')}</p>
      </div>
      <label htmlFor="user-email">
        {t('Email')}
        <input id="user-email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label htmlFor="user-username">
        {t('Username')}
        <input id="user-username" value={username} onChange={(event) => setUsername(event.target.value)} />
      </label>
      <label htmlFor="user-display-name">
        {t('Display name')}
        <input id="user-display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      </label>
      <label htmlFor="user-traffic-limit">
        {t('Traffic limit GB')}
        <input id="user-traffic-limit" inputMode="decimal" value={trafficLimit} onChange={(event) => setTrafficLimit(event.target.value)} />
      </label>
      <label htmlFor="user-device-limit">
        {t('Device limit')}
        <input id="user-device-limit" inputMode="numeric" value={deviceLimit} onChange={(event) => setDeviceLimit(event.target.value)} />
      </label>
      <FormError message={formError} />
      <FormError message={createUser.isError ? getErrorMessage(createUser.error, t('User could not be created.')) : null} />
      <SubmitButton pending={createUser.isPending}>{t('Create user')}</SubmitButton>
    </ScreenForm>
  )
}
