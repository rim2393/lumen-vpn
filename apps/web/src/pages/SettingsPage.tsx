import { useState, type FormEvent } from 'react'
import {
  useAuthProvidersData,
  useSettingsPageData,
  useUpdateAuthProvider,
  useUpdateSetting,
} from '../shared/api/resourceHooks'
import {
  FormError,
  ResourceScreen,
  ScreenForm,
  SubmitButton,
} from '../shared/components/ResourceScreen'
import { StatusBadge } from '../shared/components/StatusBadge'
import { placeholderSpecs } from '../shared/data/lumenData'
import { formatDateTime, formatRecord, parseKeyValueInput } from '../shared/utils/resourceFormat'

const settingsSpec = {
  ...placeholderSpecs.subscription,
  description:
    'Manage subscription information, auth provider toggles, response headers, and panel-wide metadata.',
  eyebrow: 'Control plane settings',
  primaryAction: 'Save setting',
  status: 'Live settings',
  title: 'Settings',
}

export function SettingsPage() {
  const query = useSettingsPageData()
  const providersQuery = useAuthProvidersData()
  const updateSetting = useUpdateSetting()
  const updateProvider = useUpdateAuthProvider()
  const settings = query.data?.items ?? []
  const providers = providersQuery.data?.items ?? []
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
    <ResourceScreen
      caption="Panel setting inventory"
      columns={['Key', 'Value', 'Updated by', 'Updated']}
      createForm={
        <ScreenForm onSubmit={handleSubmit}>
          <div>
            <p className="eyebrow">Upsert setting</p>
            <h2>Safe JSON value</h2>
            <p>Settings are written as key=value fields; secret-like keys are rejected.</p>
          </div>
          <label htmlFor="setting-key">
            Key
            <input id="setting-key" required value={key} onChange={(event) => setKey(event.target.value)} />
          </label>
          <label htmlFor="setting-value">
            Value
            <textarea id="setting-value" required value={value} onChange={(event) => setValue(event.target.value)} />
          </label>
          <FormError message={formError} />
          {updateSetting.isSuccess ? (
            <p className="auth-card__note" aria-live="polite">
              Setting saved.
            </p>
          ) : null}
          <SubmitButton pending={updateSetting.isPending}>Save setting</SubmitButton>
        </ScreenForm>
      }
      emptyDescription="Panel settings appear after an administrator saves the first setting."
      emptyTitle="No settings saved"
      error={query.error}
      errorTitle="Settings unavailable"
      isError={query.isError}
      isLoading={query.isLoading}
      isSuccess={query.isSuccess}
      items={settings}
      loadingLabel="Loading settings..."
      onRefresh={() => void query.refetch()}
      renderRow={(setting) => ({
        cells: [
          setting.key,
          formatRecord(setting.value_json),
          setting.updated_by ?? 'system',
          formatDateTime(setting.updated_at),
        ],
        id: setting.id ?? setting.key,
      })}
      rightPanel={
        <article className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Authentication</p>
              <h2>Provider toggles</h2>
            </div>
            <StatusBadge tone="good">api-backed</StatusBadge>
          </div>
          {providersQuery.isLoading ? <p className="auth-card__note">Loading providers...</p> : null}
          {providersQuery.isError ? (
            <p className="auth-card__note" role="alert">
              {providersQuery.error instanceof Error
                ? providersQuery.error.message
                : 'Auth providers unavailable.'}
            </p>
          ) : null}
          {providerError ? (
            <p className="auth-card__note" role="alert">
              {providerError}
            </p>
          ) : null}
          <div className="resource-list">
            {providers.map((provider) => (
              <div className="resource-list__item" key={provider.provider}>
                <span>
                  {provider.display_name}
                  <small>{provider.scopes.join(', ') || 'no scopes'}</small>
                </span>
                <span className="inline-actions">
                  <StatusBadge tone={provider.enabled ? 'good' : 'neutral'}>
                    {provider.enabled ? 'enabled' : 'disabled'}
                  </StatusBadge>
                  <button
                    type="button"
                    className="button button--secondary"
                    disabled={updateProvider.isPending}
                    onClick={() => void toggleProvider(provider.provider, !provider.enabled)}
                  >
                    {provider.enabled ? 'Disable' : 'Enable'}
                  </button>
                </span>
              </div>
            ))}
          </div>
        </article>
      }
      spec={settingsSpec}
      tableEyebrow="Instance settings"
      tableTitle="Settings registry"
    />
  )
}
