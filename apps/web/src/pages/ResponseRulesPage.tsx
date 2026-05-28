import { useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import {
  useCreateResponseRule,
  useDeleteResponseRule,
  useReorderResponseRules,
  useResponseRulesData,
  useTestResponseRule,
  useUpdateResponseRule,
} from '../shared/api/resourceHooks'
import {
  FormError,
  ResourceScreen,
  ScreenForm,
  SubmitButton,
} from '../shared/components/ResourceScreen'
import { StatusBadge } from '../shared/components/StatusBadge'
import { placeholderSpecs } from '../shared/data/lumenData'
import { formatRecord } from '../shared/utils/resourceFormat'

const rulesSpec = {
  ...placeholderSpecs.subscription,
  description: 'Control public subscription responses for expired, limited, disabled, and custom states.',
  eyebrow: 'Response rules',
  primaryAction: 'Save rule',
  status: 'api-backed',
  title: 'Response Rules',
}

export function ResponseRulesPage() {
  const query = useResponseRulesData()
  const createRule = useCreateResponseRule()
  const updateRule = useUpdateResponseRule()
  const deleteRule = useDeleteResponseRule()
  const reorderRules = useReorderResponseRules()
  const testRule = useTestResponseRule()
  const rules = query.data?.items ?? []
  const [name, setName] = useState('')
  const [triggerStatus, setTriggerStatus] = useState('expired')
  const [statusCode, setStatusCode] = useState('403')
  const [body, setBody] = useState('Subscription expired')
  const [headers, setHeaders] = useState('{"X-Lumen-Reason":"expired"}')
  const [testStatus, setTestStatus] = useState('expired')
  const [formError, setFormError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    try {
      await createRule.mutateAsync({
        body,
        enabled: true,
        headers: parseHeaders(headers),
        name: name.trim(),
        status_code: Number(statusCode),
        trigger_status: triggerStatus.trim(),
      })
      setName('')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Response rule could not be saved.')
    }
  }

  return (
    <ResourceScreen
      caption="Response rules"
      columns={['Name', 'Trigger', 'Status', 'Headers', 'Enabled', 'Actions']}
      createForm={
        <ScreenForm onSubmit={handleSubmit}>
          <div>
            <p className="eyebrow">Create rule</p>
            <h2>Subscription outcome</h2>
            <p>Persist response mapping for subscription status branches.</p>
          </div>
          <label htmlFor="rule-name">
            Name
            <input id="rule-name" required value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label htmlFor="rule-trigger">
            Trigger status
            <input id="rule-trigger" required value={triggerStatus} onChange={(event) => setTriggerStatus(event.target.value)} />
          </label>
          <label htmlFor="rule-status-code">
            HTTP status
            <input id="rule-status-code" inputMode="numeric" value={statusCode} onChange={(event) => setStatusCode(event.target.value)} />
          </label>
          <label htmlFor="rule-body">
            Body
            <textarea id="rule-body" rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
          <label htmlFor="rule-headers">
            Headers JSON
            <textarea id="rule-headers" rows={4} value={headers} onChange={(event) => setHeaders(event.target.value)} />
          </label>
          <FormError message={formError} />
          <SubmitButton pending={createRule.isPending}>Create rule</SubmitButton>
        </ScreenForm>
      }
      emptyDescription="Create response rules for expired, limited, disabled, or custom subscription states."
      emptyTitle="No response rules"
      error={query.error}
      errorTitle="Response rules unavailable"
      isError={query.isError}
      isLoading={query.isLoading}
      isSuccess={query.isSuccess}
      items={rules}
      loadingLabel="Loading response rules..."
      onRefresh={() => void query.refetch()}
      renderRow={(rule) => ({
        cells: [
          rule.name,
          rule.trigger_status,
          String(rule.status_code),
          formatRecord(rule.headers),
          <StatusBadge tone={rule.enabled ? 'good' : 'neutral'}>{rule.enabled ? 'enabled' : 'disabled'}</StatusBadge>,
          <div className="inline-actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void updateRule.mutateAsync({ id: rule.id, request: { enabled: !rule.enabled } })}
            >
              Toggle
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Delete ${rule.name}`}
              onClick={() => void deleteRule.mutateAsync(rule.id)}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>,
        ],
        id: rule.id,
      })}
      rightPanel={
        <article className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Rule tester</p>
              <h2>{rules.length} rules</h2>
            </div>
            <StatusBadge tone="good">api-backed</StatusBadge>
          </div>
          <label htmlFor="rule-test-status">
            Subscription status
            <input id="rule-test-status" value={testStatus} onChange={(event) => setTestStatus(event.target.value)} />
          </label>
          <div className="inline-actions">
            <button type="button" className="button button--secondary" onClick={() => void testRule.mutateAsync({ subscription_status: testStatus })}>
              Test rule
            </button>
            <button type="button" className="button button--secondary" onClick={() => void reorderRules.mutateAsync(rules.map((rule) => rule.id).reverse())}>
              Reverse order
            </button>
          </div>
          {testRule.data ? (
            <div className="resource-list">
              <div className="resource-list__item">
                <span>{testRule.data.matched ? testRule.data.rule?.name : 'No match'}</span>
                <small>{testRule.data.status_code}</small>
              </div>
              <div className="resource-list__item">
                <span>{testRule.data.body || 'Empty body'}</span>
                <small>{formatRecord(testRule.data.headers)}</small>
              </div>
            </div>
          ) : null}
        </article>
      }
      spec={rulesSpec}
      tableEyebrow="Subscription policy"
      tableTitle="Response rule registry"
    />
  )
}

function parseHeaders(value: string): Record<string, string> {
  const parsed: unknown = JSON.parse(value || '{}')
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Headers JSON must be an object.')
  }
  return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, String(item)]))
}
