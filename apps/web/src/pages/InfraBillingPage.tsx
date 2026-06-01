import { useState, type FormEvent } from 'react'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import {
  useCreateInfraBillingRecord,
  useCreateInfraProvider,
  useDeleteInfraProvider,
  useInfraBillingRecordsData,
  useInfraBillingSummary,
  useInfraProvidersData,
  useNodesPageData,
} from '../shared/api/resourceHooks'
import { EmptyState, ErrorState, LoadingState } from '../shared/components/DataState'
import { DataTable } from '../shared/components/DataTable'
import { PageHeader } from '../shared/components/PageHeader'
import { useI18n } from '../shared/i18n/I18nProvider'

export function InfraBillingPage() {
  const { t } = useI18n()
  const providersQuery = useInfraProvidersData()
  const recordsQuery = useInfraBillingRecordsData()
  const summaryQuery = useInfraBillingSummary()
  const nodesQuery = useNodesPageData()
  const createProvider = useCreateInfraProvider()
  const deleteProvider = useDeleteInfraProvider()
  const createRecord = useCreateInfraBillingRecord()

  const providers = providersQuery.data?.items ?? []
  const records = recordsQuery.data?.items ?? []
  const nodes = nodesQuery.data?.items ?? []
  const summary = summaryQuery.data

  const [providerName, setProviderName] = useState('')
  const [providerUrl, setProviderUrl] = useState('')
  const [recordProvider, setRecordProvider] = useState('')
  const [recordNode, setRecordNode] = useState('')
  const [amount, setAmount] = useState('0')
  const [currency, setCurrency] = useState('USD')
  const [period, setPeriod] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const isLoading = providersQuery.isLoading || recordsQuery.isLoading
  const error = providersQuery.error ?? recordsQuery.error
  const isMutating = createProvider.isPending || deleteProvider.isPending || createRecord.isPending

  const providerNameFor = (id: string) =>
    providers.find((provider) => provider.id === id)?.name ?? id
  const nodeNameFor = (id: string | null) =>
    id ? nodes.find((node) => node.id === id)?.name ?? id : t('Unassigned')

  async function submitProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    try {
      await createProvider.mutateAsync({ name: providerName, login_url: providerUrl || null })
      setProviderName('')
      setProviderUrl('')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create provider.')
    }
  }

  async function submitRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    const parsedAmount = Number(amount)
    if (Number.isNaN(parsedAmount) || parsedAmount < 0) {
      setFormError('Amount must be a non-negative number.')
      return
    }
    if (!recordProvider) {
      setFormError('Select a provider first.')
      return
    }
    try {
      await createRecord.mutateAsync({
        provider_id: recordProvider,
        node_id: recordNode || null,
        amount: parsedAmount,
        currency,
        period,
      })
      setAmount('0')
      setPeriod('')
      setRecordNode('')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create record.')
    }
  }

  return (
    <section className="page">
      <PageHeader
        eyebrow="Infrastructure CRM"
        title="Infra billing"
        description="Track infrastructure providers and their recurring costs across the node fleet."
        actions={
          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              void providersQuery.refetch()
              void recordsQuery.refetch()
              void summaryQuery.refetch()
            }}
          >
            <RefreshCw size={18} aria-hidden="true" />
            {t('Refresh')}
          </button>
        }
      />

      {isLoading ? <LoadingState label="Loading infra billing..." /> : null}
      {error ? <ErrorState title="Infra billing unavailable" error={error} /> : null}

      {!isLoading && !error ? (
        <>
          <section className="summary-grid" aria-label={t('Infra billing summary')}>
            <div>
              <span>{t('Providers')}</span>
              <strong>{summary?.providers ?? providers.length}</strong>
            </div>
            <div>
              <span>{t('Billing records')}</span>
              <strong>{summary?.records ?? records.length}</strong>
            </div>
            {(summary?.totals_by_currency ?? []).map((total) => (
              <div key={total.currency}>
                <span>{t('Total')} {total.currency}</span>
                <strong>{total.total.toFixed(2)}</strong>
              </div>
            ))}
          </section>

          <section className="resource-layout">
            <article className="panel">
              <div className="panel__header">
                <div>
                  <p className="eyebrow">{t('Providers')}</p>
                  <h2>{t('Providers')}</h2>
                </div>
              </div>
              {providers.length === 0 ? (
                <EmptyState title="No providers" description="Add a hosting provider to track costs." />
              ) : (
                <DataTable
                  caption="Providers"
                  columns={[t('Name'), t('Login URL'), t('Actions')]}
                  rows={providers.map((provider) => ({
                    id: provider.id,
                    cells: [
                      provider.name,
                      provider.login_url ?? '—',
                      <button
                        key="d"
                        type="button"
                        className="button button--secondary"
                        disabled={isMutating}
                        onClick={() => void deleteProvider.mutateAsync(provider.id)}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                        {t('Delete')}
                      </button>,
                    ],
                  }))}
                />
              )}

              <div className="panel__header">
                <div>
                  <p className="eyebrow">{t('Billing records')}</p>
                  <h2>{t('Billing records')}</h2>
                </div>
              </div>
              {records.length === 0 ? (
                <EmptyState title="No records" description="Add a billing record for a provider." />
              ) : (
                <DataTable
                  caption="Billing records"
                  columns={[t('Provider'), t('Node'), t('Period'), t('Amount'), t('Currency')]}
                  rows={records.map((record) => ({
                    id: record.id,
                    cells: [
                      providerNameFor(record.provider_id),
                      nodeNameFor(record.node_id),
                      record.period,
                      record.amount.toFixed(2),
                      record.currency,
                    ],
                  }))}
                />
              )}
            </article>

            <div className="side-stack">
              <form className="auth-card auth-card--wide" onSubmit={submitProvider}>
                <div>
                  <p className="eyebrow">{t('Add provider')}</p>
                  <h2>{t('Add provider')}</h2>
                </div>
                <label htmlFor="provider-name">
                  {t('Name')}
                  <input
                    id="provider-name"
                    required
                    value={providerName}
                    onChange={(event) => setProviderName(event.target.value)}
                  />
                </label>
                <label htmlFor="provider-url">
                  {t('Login URL')}
                  <input
                    id="provider-url"
                    value={providerUrl}
                    onChange={(event) => setProviderUrl(event.target.value)}
                  />
                </label>
                <button type="submit" className="button button--primary" disabled={isMutating}>
                  <Plus size={18} aria-hidden="true" />
                  {t('Add provider')}
                </button>
              </form>

              <form className="auth-card auth-card--wide" onSubmit={submitRecord}>
                <div>
                  <p className="eyebrow">{t('Add billing record')}</p>
                  <h2>{t('Add billing record')}</h2>
                </div>
                <label htmlFor="record-provider">
                  {t('Provider')}
                  <select
                    id="record-provider"
                    value={recordProvider}
                    onChange={(event) => setRecordProvider(event.target.value)}
                  >
                    <option value="">{t('Select provider')}</option>
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor="record-node">
                  {t('Node')}
                  <select
                    id="record-node"
                    value={recordNode}
                    onChange={(event) => setRecordNode(event.target.value)}
                  >
                    <option value="">{t('Unassigned')}</option>
                    {nodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor="record-period">
                  {t('Period')}
                  <input
                    id="record-period"
                    required
                    placeholder="2026-05"
                    value={period}
                    onChange={(event) => setPeriod(event.target.value)}
                  />
                </label>
                <label htmlFor="record-amount">
                  {t('Amount')}
                  <input
                    id="record-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </label>
                <label htmlFor="record-currency">
                  {t('Currency')}
                  <input
                    id="record-currency"
                    value={currency}
                    onChange={(event) => setCurrency(event.target.value)}
                  />
                </label>
                {formError ? <p className="auth-card__error">{formError}</p> : null}
                <button type="submit" className="button button--primary" disabled={isMutating}>
                  <Plus size={18} aria-hidden="true" />
                  {t('Add billing record')}
                </button>
              </form>
            </div>
          </section>
        </>
      ) : null}
    </section>
  )
}
