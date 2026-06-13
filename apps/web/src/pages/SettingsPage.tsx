import { useState, type FormEvent } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  useDeleteMfaMethod,
  useDeleteWebAuthnCredential,
  useAuthProvidersData,
  useMfaMethodsData,
  useSettingGroupsData,
  useSettingsPageData,
  useSetupTotp,
  useUpdateAuthProvider,
  useUpdateSetting,
  useUpdateSettingGroup,
  useVerifyTotpSetup,
  useWebAuthnCredentialsData,
} from '../shared/api/resourceHooks'
import { useApiClient } from '../shared/api/apiClientContext'
import { isPasskeySupported, performPasskeyRegistration } from '../features/auth/webauthn'
import type {
  AuthProviderRecord,
  MfaMethod,
  SettingGroupRecord,
  TotpSetupResponse,
  WebAuthnCredentialRecord,
} from '../shared/api/types'
import {
  FormError,
  ScreenForm,
  SubmitButton,
} from '../shared/components/ResourceScreen'
import { DataTable } from '../shared/components/DataTable'
import { EmptyState, ErrorState, LoadingState } from '../shared/components/DataState'
import { PageHeader } from '../shared/components/PageHeader'
import { StatusBadge } from '../shared/components/StatusBadge'
import { sectionSpecs } from '../shared/data/resourceMeta'
import { useI18n } from '../shared/i18n/I18nProvider'
import { formatDateTime, parseKeyValueInput } from '../shared/utils/resourceFormat'

const settingsSpec = {
  ...sectionSpecs.subscription,
  description:
    'Manage subscription information, auth provider toggles, response headers, and panel-wide metadata.',
  eyebrow: 'Control plane settings',
  primaryAction: 'Save setting',
  status: 'Live settings',
  title: 'Settings',
}

export function SettingsPage() {
  const { t } = useI18n()
  const query = useSettingsPageData()
  const groupsQuery = useSettingGroupsData()
  const providersQuery = useAuthProvidersData()
  const updateSetting = useUpdateSetting()
  const updateGroup = useUpdateSettingGroup()
  const updateProvider = useUpdateAuthProvider()
  const settings = query.data?.items ?? []
  const groups = groupsQuery.data?.items ?? []
  const providers = providersQuery.data?.items ?? []
  const activeProviders = providers.filter((provider) => provider.enabled).length
  const configurableProviders = providers.filter(
    (provider) => provider.status === 'active' || provider.status === 'disabled',
  ).length
  const [key, setKey] = useState('subscription.info')
  const [value, setValue] = useState('title=LUMEN, auto_update_hours=2')
  const [formError, setFormError] = useState<string | null>(null)
  const [providerError, setProviderError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    try {
      await updateSetting.mutateAsync({
        key: key.trim(),
        request: { value_json: parseKeyValueInput(value) },
      })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Setting could not be saved.')
    }
  }

  async function toggleProvider(provider: string, enabled: boolean) {
    setProviderError(null)
    try {
      await updateProvider.mutateAsync({
        provider,
        request: { enabled, status: enabled ? 'active' : 'disabled' },
      })
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : 'Provider could not be updated.')
    }
  }

  return (
    <section className="page settings-page">
      <PageHeader
        eyebrow={settingsSpec.eyebrow}
        title={settingsSpec.title}
        description={settingsSpec.description}
        actions={
          <button
            type="button"
            className="button button--secondary"
            aria-label={t('Refresh settings')}
            disabled={query.isFetching || groupsQuery.isFetching || providersQuery.isFetching}
            onClick={() => {
              void query.refetch()
              void groupsQuery.refetch()
              void providersQuery.refetch()
            }}
          >
            <RefreshCw size={18} aria-hidden="true" />
            {t('Refresh')}
          </button>
        }
      />

      <section className="settings-summary-grid" aria-label={t('Settings overview')}>
        <SettingsSummaryCard label="Typed groups" value={groups.length} detail="Structured live settings" />
        <SettingsSummaryCard label="Registry keys" value={settings.length} detail="Raw persisted records" />
        <SettingsSummaryCard label="Auth providers" value={`${activeProviders}/${providers.length}`} detail="Enabled login methods" />
        <SettingsSummaryCard label="Configurable providers" value={configurableProviders} detail="Ready for operator toggles" />
      </section>

      <section className="settings-workbench">
        <article className="panel settings-workbench__main">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{t('Typed settings')}</p>
              <h2>{t('Settings groups')}</h2>
            </div>
            <StatusBadge tone="good">typed API</StatusBadge>
          </div>
          {groupsQuery.isLoading ? <LoadingState label="Loading settings groups..." /> : null}
          {groupsQuery.isError ? (
            <ErrorState
              title="Settings groups unavailable"
              error={groupsQuery.error ?? new Error('Settings groups unavailable.')}
            />
          ) : null}
          {groupsQuery.isSuccess && groups.length === 0 ? (
            <EmptyState
              title="No settings groups"
              description="Typed settings groups will appear after the backend exposes them."
            />
          ) : null}
          <div className="settings-group-grid">
            {groups.map((group) => (
              <SettingGroupForm
                key={group.key}
                group={group}
                pending={updateGroup.isPending}
                onSave={(groupKey, valueJson) =>
                  updateGroup.mutateAsync({
                    groupKey,
                    request: { value_json: valueJson },
                  })
                }
              />
            ))}
          </div>
        </article>

        <aside className="side-stack settings-workbench__side">
          <article className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">{t('Authentication')}</p>
                <h2>{t('Provider toggles')}</h2>
              </div>
              <StatusBadge tone="good">api-backed</StatusBadge>
            </div>
            {providersQuery.isLoading ? <LoadingState label="Loading providers..." /> : null}
            {providersQuery.isError ? (
              <ErrorState
                title="Auth providers unavailable"
                error={providersQuery.error ?? new Error('Auth providers unavailable.')}
              />
            ) : null}
            {providerError ? (
              <p className="auth-card__note" role="alert">
                {providerError}
              </p>
            ) : null}
            <div className="settings-provider-list">
              {providers.map((provider) => (
                <AuthProviderRow
                  key={provider.provider}
                  provider={provider}
                  pending={updateProvider.isPending}
                  onToggle={toggleProvider}
                />
              ))}
            </div>
          </article>
          <SecurityMethodsPanel />
          <ScreenForm onSubmit={handleSubmit}>
            <div>
              <p className="eyebrow">{t('Upsert setting')}</p>
              <h2>{t('Safe JSON value')}</h2>
              <p>{t('Settings are written as key=value fields; secret-like keys are rejected.')}</p>
            </div>
            <label htmlFor="setting-key">
              {t('Key')}
              <input id="setting-key" required value={key} onChange={(event) => setKey(event.target.value)} />
            </label>
            <label htmlFor="setting-value">
              {t('Value')}
              <textarea id="setting-value" required value={value} onChange={(event) => setValue(event.target.value)} />
            </label>
            <FormError message={formError} />
            {updateSetting.isSuccess ? (
              <p className="auth-card__note" aria-live="polite">
                {t('Setting saved.')}
              </p>
            ) : null}
            <SubmitButton pending={updateSetting.isPending}>{t('Save setting')}</SubmitButton>
          </ScreenForm>
        </aside>
      </section>

      <article className="panel panel--wide settings-registry-panel">
        <div className="panel__header">
          <div>
            <p className="eyebrow">{t('Instance settings')}</p>
            <h2>{t('Settings registry')}</h2>
          </div>
          <StatusBadge>{t('api готов')}</StatusBadge>
        </div>
        {query.isLoading ? <LoadingState label="Loading settings..." /> : null}
        {query.isError ? (
          <ErrorState title="Settings unavailable" error={query.error ?? new Error('Settings unavailable')} />
        ) : null}
        {query.isSuccess && settings.length === 0 ? (
          <EmptyState
            title="No settings saved"
            description="Panel settings appear after an administrator saves the first setting."
          />
        ) : null}
        {query.isSuccess && settings.length > 0 ? (
          <DataTable
            caption="Panel setting inventory"
            columns={['Key', 'Value', 'Updated by', 'Updated']}
            rows={settings.map((setting) => ({
              cells: [
                <code className="settings-key">{setting.key}</code>,
                <SettingValuePreview value={setting.value_json} />,
                setting.updated_by ?? 'system',
                formatDateTime(setting.updated_at),
              ],
              id: setting.id ?? setting.key,
            }))}
          />
        ) : null}
      </article>
    </section>
  )
}

function SettingsSummaryCard({
  detail,
  label,
  value,
}: {
  detail: string
  label: string
  value: number | string
}) {
  const { t } = useI18n()
  return (
    <article className="settings-summary-card">
      <span>{t(label)}</span>
      <strong>{value}</strong>
      <small>{t(detail)}</small>
    </article>
  )
}

function SettingValuePreview({ value }: { value: Record<string, unknown> | null | undefined }) {
  const entries = Object.entries(value ?? {})
  if (entries.length === 0) {
    return <span className="settings-value-empty">None</span>
  }

  return (
    <div className="settings-value-preview">
      {entries.slice(0, 6).map(([key, entry]) => (
        <span className="settings-value-chip" key={key}>
          <strong>{key}</strong>
          <small>{formatSettingValue(entry)}</small>
        </span>
      ))}
      {entries.length > 6 ? (
        <span className="settings-value-more">+{entries.length - 6}</span>
      ) : null}
    </div>
  )
}

function formatSettingValue(value: unknown) {
  if (value === null || value === undefined) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return `${value.length} items`
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}

function SecurityMethodsPanel() {
  const { t } = useI18n()
  const apiClient = useApiClient()
  const mfaQuery = useMfaMethodsData()
  const passkeysQuery = useWebAuthnCredentialsData()
  const setupTotp = useSetupTotp()
  const verifyTotp = useVerifyTotpSetup()
  const deleteMfa = useDeleteMfaMethod()
  const deletePasskey = useDeleteWebAuthnCredential()
  const [totpLabel, setTotpLabel] = useState('Authenticator')
  const [totpCode, setTotpCode] = useState('')
  const [pendingTotp, setPendingTotp] = useState<TotpSetupResponse | null>(null)
  const [passkeyLabel, setPasskeyLabel] = useState('Operator passkey')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [passkeyPending, setPasskeyPending] = useState(false)

  async function beginTotpSetup() {
    setError(null)
    setMessage(null)
    try {
      const response = await setupTotp.mutateAsync(totpLabel.trim() || 'Authenticator')
      setPendingTotp(response)
      setMessage(t('Scan the authenticator secret and confirm it with a current code.'))
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : 'TOTP setup failed.')
    }
  }

  async function confirmTotpSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!pendingTotp) {
      return
    }
    setError(null)
    setMessage(null)
    try {
      await verifyTotp.mutateAsync({
        code: totpCode.trim(),
        methodId: pendingTotp.method_id,
      })
      setPendingTotp(null)
      setTotpCode('')
      setMessage(t('Authenticator MFA is active.'))
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'TOTP verification failed.')
    }
  }

  async function removeMfaMethod(method: MfaMethod) {
    setError(null)
    setMessage(null)
    try {
      await deleteMfa.mutateAsync(method.id)
      setMessage(t('MFA method deleted.'))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'MFA method could not be deleted.')
    }
  }

  async function registerPasskey() {
    setError(null)
    setMessage(null)
    if (!isPasskeySupported()) {
      setError(t('Passkeys are not supported by this browser context.'))
      return
    }
    setPasskeyPending(true)
    try {
      const options = await apiClient.webauthnRegisterOptions()
      const credential = await performPasskeyRegistration(options.options)
      await apiClient.webauthnRegisterVerify(
        options.challenge_id,
        credential,
        passkeyLabel.trim() || null,
      )
      await passkeysQuery.refetch()
      setMessage(t('Passkey registered.'))
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : 'Passkey registration failed.')
    } finally {
      setPasskeyPending(false)
    }
  }

  async function removePasskey(credential: WebAuthnCredentialRecord) {
    setError(null)
    setMessage(null)
    try {
      await deletePasskey.mutateAsync(credential.id)
      setMessage(t('Passkey deleted.'))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Passkey could not be deleted.')
    }
  }

  return (
    <article className="panel" aria-label={t('MFA and passkeys')}>
      <div className="panel__header">
        <div>
          <p className="eyebrow">{t('Account security')}</p>
          <h2>{t('MFA and passkeys')}</h2>
        </div>
        <StatusBadge tone="good">real auth</StatusBadge>
      </div>
      <div className="resource-list">
        <div className="resource-list__item">
          <span>
            {t('Authenticator app')}
            <small>{t('Register a TOTP method for the current operator account.')}</small>
          </span>
          <span className="inline-actions">
            <input
              aria-label={t('MFA label')}
              value={totpLabel}
              onChange={(event) => setTotpLabel(event.target.value)}
            />
            <button
              type="button"
              className="button button--secondary"
              disabled={setupTotp.isPending}
              onClick={() => void beginTotpSetup()}
            >
              {t('Start setup')}
            </button>
          </span>
        </div>
        {pendingTotp ? (
          <form className="resource-list__item" onSubmit={confirmTotpSetup}>
            <span>
              {t('Pending authenticator')}
              <small>{t('Secret')}: {pendingTotp.secret}</small>
              <small>{pendingTotp.otpauth_url}</small>
            </span>
            <span className="inline-actions">
              <input
                aria-label={t('Authenticator code')}
                inputMode="numeric"
                required
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value)}
              />
              <button
                type="submit"
                className="button button--primary"
                disabled={verifyTotp.isPending}
              >
                {t('Confirm code')}
              </button>
            </span>
          </form>
        ) : null}
        {(mfaQuery.data?.items ?? []).map((method) => (
          <div className="resource-list__item" key={method.id}>
            <span>
              {method.label || method.kind}
              <small>{method.kind} / {method.status}</small>
              <small>
                {t('Confirmed')}: {formatDateTime(method.confirmed_at)}
              </small>
              <small>
                {t('Last used')}: {formatDateTime(method.last_used_at)}
              </small>
            </span>
            <span className="inline-actions">
              <StatusBadge tone={method.status === 'active' ? 'good' : 'watch'}>
                {method.status}
              </StatusBadge>
              <button
                type="button"
                className="button button--secondary"
                disabled={deleteMfa.isPending}
                onClick={() => void removeMfaMethod(method)}
              >
                {t('Delete')}
              </button>
            </span>
          </div>
        ))}
        {mfaQuery.isLoading ? <p className="auth-card__note">{t('Loading MFA methods...')}</p> : null}
        {mfaQuery.isSuccess && (mfaQuery.data?.items ?? []).length === 0 ? (
          <p className="auth-card__note">{t('No MFA methods are active for this account.')}</p>
        ) : null}
      </div>
      <div className="resource-list">
        <div className="resource-list__item">
          <span>
            {t('Passkeys')}
            <small>{t('Register a hardware or platform passkey for passwordless login.')}</small>
          </span>
          <span className="inline-actions">
            <input
              aria-label={t('Passkey label')}
              value={passkeyLabel}
              onChange={(event) => setPasskeyLabel(event.target.value)}
            />
            <button
              type="button"
              className="button button--secondary"
              disabled={passkeyPending}
              onClick={() => void registerPasskey()}
            >
              {t('Register passkey')}
            </button>
          </span>
        </div>
        {(passkeysQuery.data?.items ?? []).map((credential) => (
          <div className="resource-list__item" key={credential.id}>
            <span>
              {credential.label || credential.id}
              <small>{credential.transports.join(', ') || 'no transports'}</small>
              <small>
                {t('Created')}: {formatDateTime(credential.created_at)}
              </small>
              <small>
                {t('Last used')}: {formatDateTime(credential.last_used_at)}
              </small>
            </span>
            <span className="inline-actions">
              <StatusBadge tone="good">passkey</StatusBadge>
              <button
                type="button"
                className="button button--secondary"
                disabled={deletePasskey.isPending}
                onClick={() => void removePasskey(credential)}
              >
                {t('Delete')}
              </button>
            </span>
          </div>
        ))}
        {passkeysQuery.isLoading ? <p className="auth-card__note">{t('Loading passkeys...')}</p> : null}
        {passkeysQuery.isSuccess && (passkeysQuery.data?.items ?? []).length === 0 ? (
          <p className="auth-card__note">{t('No passkeys are registered for this account.')}</p>
        ) : null}
      </div>
      {message ? <p className="auth-card__note" aria-live="polite">{message}</p> : null}
      {error ? <p className="auth-card__note" role="alert">{error}</p> : null}
    </article>
  )
}

function fieldString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function fieldNumber(value: unknown, fallback: number) {
  return typeof value === 'number' ? String(value) : String(fallback)
}

function fieldBoolean(value: unknown) {
  return value === true
}

function fieldJson(value: unknown) {
  if (!value || typeof value !== 'object') {
    return '{}'
  }
  return JSON.stringify(value, null, 2)
}

function nullIfEmpty(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function parseJsonObject(value: string, label: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return {}
  }
  const parsed = JSON.parse(trimmed) as unknown
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${label} must be a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

function parseStringRecord(value: string, label: string) {
  const parsed = parseJsonObject(value, label)
  return Object.fromEntries(
    Object.entries(parsed).map(([key, entry]) => [key, String(entry)]),
  )
}

function SettingGroupForm({
  group,
  onSave,
  pending,
}: {
  group: SettingGroupRecord
  onSave: (groupKey: string, valueJson: Record<string, unknown>) => Promise<unknown>
  pending: boolean
}) {
  const { t } = useI18n()
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    initialGroupFormValues(group),
  )
  const [error, setError] = useState<string | null>(null)

  function setValue(key: string, value: string | boolean) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    try {
      await onSave(group.key, groupFormPayload(group.key, values))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Settings group could not be saved.')
    }
  }

  return (
    <form className="settings-group-card" onSubmit={submit}>
      <div>
        <p className="eyebrow">{group.key}</p>
        <h3>{t(group.title)}</h3>
        <p>{t(group.description)}</p>
      </div>
      {renderGroupFields(group.key, values, setValue)}
      <FormError message={error} />
      <button type="submit" className="button button--primary" disabled={pending}>
        {t('Save group')}
      </button>
    </form>
  )
}

function initialGroupFormValues(group: SettingGroupRecord): Record<string, string | boolean> {
  const value = group.value_json
  if (group.key === 'panel.identity') {
    return {
      default_locale: fieldString(value.default_locale) || 'ru',
      docs_url: fieldString(value.docs_url),
      product_name: fieldString(value.product_name) || 'Lumen',
      support_url: fieldString(value.support_url),
    }
  }
  if (group.key === 'subscription.delivery') {
    return {
      base_json: fieldJson(value.base_json),
      custom_remarks: fieldJson(value.custom_remarks),
      happ_announce: fieldString(value.happ_announce),
      profile_page_url: fieldString(value.profile_page_url),
      random_host_order: fieldBoolean(value.random_host_order),
      response_headers: fieldJson(value.response_headers),
      routing: fieldJson(value.routing),
      subpage: fieldJson(value.subpage),
      support_url: fieldString(value.support_url),
      title: fieldString(value.title) || 'Lumen VPN',
      update_interval_hours: fieldNumber(value.update_interval_hours, 2),
    }
  }
  if (group.key === 'security.policy') {
    return {
      api_key_max_ttl_days: fieldNumber(value.api_key_max_ttl_days, 90),
      require_mfa_for_admins: fieldBoolean(value.require_mfa_for_admins),
      session_ttl_minutes: fieldNumber(value.session_ttl_minutes, 720),
    }
  }
  return {
    command_poll_interval_seconds: fieldNumber(value.command_poll_interval_seconds, 30),
    default_region: fieldString(value.default_region) || 'global',
    heartbeat_interval_seconds: fieldNumber(value.heartbeat_interval_seconds, 30),
    runtime_metrics_retention_days: fieldNumber(value.runtime_metrics_retention_days, 30),
  }
}

function groupFormPayload(
  groupKey: string,
  values: Record<string, string | boolean>,
): Record<string, unknown> {
  if (groupKey === 'panel.identity') {
    return {
      default_locale: String(values.default_locale || 'ru'),
      docs_url: nullIfEmpty(String(values.docs_url ?? '')),
      product_name: String(values.product_name ?? '').trim(),
      support_url: nullIfEmpty(String(values.support_url ?? '')),
    }
  }
  if (groupKey === 'subscription.delivery') {
    return {
      base_json: parseJsonObject(String(values.base_json ?? '{}'), 'Base JSON'),
      custom_remarks: parseStringRecord(String(values.custom_remarks ?? '{}'), 'Custom remarks'),
      happ_announce: nullIfEmpty(String(values.happ_announce ?? '')),
      profile_page_url: nullIfEmpty(String(values.profile_page_url ?? '')),
      random_host_order: values.random_host_order === true,
      response_headers: parseStringRecord(String(values.response_headers ?? '{}'), 'Response headers'),
      routing: parseJsonObject(String(values.routing ?? '{}'), 'Routing'),
      subpage: parseJsonObject(String(values.subpage ?? '{}'), 'Subpage'),
      support_url: nullIfEmpty(String(values.support_url ?? '')),
      title: String(values.title ?? '').trim(),
      update_interval_hours: Number(values.update_interval_hours),
    }
  }
  if (groupKey === 'security.policy') {
    return {
      api_key_max_ttl_days: Number(values.api_key_max_ttl_days),
      require_mfa_for_admins: values.require_mfa_for_admins === true,
      session_ttl_minutes: Number(values.session_ttl_minutes),
    }
  }
  return {
    command_poll_interval_seconds: Number(values.command_poll_interval_seconds),
    default_region: String(values.default_region ?? '').trim(),
    heartbeat_interval_seconds: Number(values.heartbeat_interval_seconds),
    runtime_metrics_retention_days: Number(values.runtime_metrics_retention_days),
  }
}

function renderGroupFields(
  groupKey: string,
  values: Record<string, string | boolean>,
  setValue: (key: string, value: string | boolean) => void,
) {
  if (groupKey === 'panel.identity') {
    return (
      <>
        <TextField id="panel-product-name" label="Product name" value={values.product_name} onChange={(value) => setValue('product_name', value)} />
        <TextField id="panel-support-url" label="Support URL" value={values.support_url} onChange={(value) => setValue('support_url', value)} />
        <TextField id="panel-docs-url" label="Docs URL" value={values.docs_url} onChange={(value) => setValue('docs_url', value)} />
        <label htmlFor="panel-default-locale">
          Default locale
          <select
            id="panel-default-locale"
            value={String(values.default_locale)}
            onChange={(event) => setValue('default_locale', event.target.value)}
          >
            <option value="ru">RU</option>
            <option value="en">EN</option>
          </select>
        </label>
      </>
    )
  }
  if (groupKey === 'subscription.delivery') {
    return (
      <>
        <TextField id="subscription-title" label="Title" value={values.title} onChange={(value) => setValue('title', value)} />
        <TextField id="subscription-support-url" label="Support URL" value={values.support_url} onChange={(value) => setValue('support_url', value)} />
        <TextField id="subscription-profile-page-url" label="Profile page URL" value={values.profile_page_url} onChange={(value) => setValue('profile_page_url', value)} />
        <TextField id="subscription-update-hours" label="Update interval hours" type="number" value={values.update_interval_hours} onChange={(value) => setValue('update_interval_hours', value)} />
        <TextField id="subscription-happ-announce" label="HApp announce" value={values.happ_announce} onChange={(value) => setValue('happ_announce', value)} />
        <CheckboxField id="subscription-random-host-order" label="Random host order" checked={values.random_host_order === true} onChange={(value) => setValue('random_host_order', value)} />
        <TextareaField id="subscription-response-headers" label="Response headers JSON" value={values.response_headers} onChange={(value) => setValue('response_headers', value)} />
        <TextareaField id="subscription-base-json" label="Base JSON" value={values.base_json} onChange={(value) => setValue('base_json', value)} />
        <TextareaField id="subscription-routing" label="Routing JSON" value={values.routing} onChange={(value) => setValue('routing', value)} />
        <TextareaField id="subscription-custom-remarks" label="Custom remarks JSON" value={values.custom_remarks} onChange={(value) => setValue('custom_remarks', value)} />
        <TextareaField id="subscription-subpage" label="Subpage JSON" value={values.subpage} onChange={(value) => setValue('subpage', value)} />
      </>
    )
  }
  if (groupKey === 'security.policy') {
    return (
      <>
        <CheckboxField id="security-require-mfa" label="Require MFA for admins" checked={values.require_mfa_for_admins === true} onChange={(value) => setValue('require_mfa_for_admins', value)} />
        <TextField id="security-api-key-ttl" label="API key max TTL days" type="number" value={values.api_key_max_ttl_days} onChange={(value) => setValue('api_key_max_ttl_days', value)} />
        <TextField id="security-session-ttl" label="Session TTL minutes" type="number" value={values.session_ttl_minutes} onChange={(value) => setValue('session_ttl_minutes', value)} />
      </>
    )
  }
  return (
    <>
      <TextField id="node-default-region" label="Default region" value={values.default_region} onChange={(value) => setValue('default_region', value)} />
      <TextField id="node-heartbeat-interval" label="Heartbeat interval seconds" type="number" value={values.heartbeat_interval_seconds} onChange={(value) => setValue('heartbeat_interval_seconds', value)} />
      <TextField id="node-command-poll-interval" label="Command poll interval seconds" type="number" value={values.command_poll_interval_seconds} onChange={(value) => setValue('command_poll_interval_seconds', value)} />
      <TextField id="node-runtime-retention" label="Runtime metrics retention days" type="number" value={values.runtime_metrics_retention_days} onChange={(value) => setValue('runtime_metrics_retention_days', value)} />
    </>
  )
}

function TextField({
  id,
  label,
  onChange,
  type = 'text',
  value,
}: {
  id: string
  label: string
  onChange: (value: string) => void
  type?: string
  value: string | boolean
}) {
  const { t } = useI18n()
  return (
    <label htmlFor={id}>
      {t(label)}
      <input
        id={id}
        type={type}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function TextareaField({
  id,
  label,
  onChange,
  value,
}: {
  id: string
  label: string
  onChange: (value: string) => void
  value: string | boolean
}) {
  const { t } = useI18n()
  return (
    <label htmlFor={id}>
      {t(label)}
      <textarea
        id={id}
        rows={5}
        spellCheck={false}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function CheckboxField({
  checked,
  id,
  label,
  onChange,
}: {
  checked: boolean
  id: string
  label: string
  onChange: (value: boolean) => void
}) {
  const { t } = useI18n()
  return (
    <label className="checkbox-row" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {t(label)}
    </label>
  )
}

function AuthProviderRow({
  onToggle,
  pending,
  provider,
}: {
  onToggle: (provider: string, enabled: boolean) => Promise<void>
  pending: boolean
  provider: AuthProviderRecord
}) {
  const canToggle = provider.status === 'active' || provider.status === 'disabled'
  const actionLabel = provider.enabled ? 'Disable' : canToggle ? 'Enable' : 'Unavailable'

  const metadata = Object.entries(provider.metadata_json)

  return (
    <div className="settings-provider-card">
      <div className="settings-provider-card__body">
        <strong>{provider.display_name}</strong>
        <span>{provider.provider}</span>
        <small>{provider.scopes.join(', ') || 'no scopes'}</small>
        {metadata.length > 0 ? (
          <div className="settings-provider-card__meta">
            {metadata.slice(0, 4).map(([key, value]) => (
              <span key={key}>
                {key}: {formatSettingValue(value)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="settings-provider-card__actions">
        <StatusBadge tone={provider.enabled ? 'good' : 'neutral'}>
          {provider.enabled ? 'enabled' : 'disabled'}
        </StatusBadge>
        <StatusBadge tone={canToggle ? 'good' : 'watch'}>{provider.status}</StatusBadge>
        <button
          type="button"
          className="button button--secondary"
          disabled={pending || !canToggle}
          title={canToggle ? undefined : 'Provider has no live login callback and cannot be enabled yet.'}
          onClick={() => void onToggle(provider.provider, !provider.enabled)}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  )
}
