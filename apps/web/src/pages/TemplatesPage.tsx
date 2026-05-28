import { useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import {
  useCreateSubscriptionTemplate,
  useDeleteSubscriptionTemplate,
  useReorderSubscriptionTemplates,
  useSubscriptionTemplatesData,
  useUpdateSubscriptionTemplate,
} from '../shared/api/resourceHooks'
import type { SubscriptionTemplateFormat } from '../shared/api/types'
import {
  FormError,
  ResourceScreen,
  ScreenForm,
  SubmitButton,
} from '../shared/components/ResourceScreen'
import { StatusBadge } from '../shared/components/StatusBadge'
import { sectionSpecs } from '../shared/data/lumenData'
import { formatRecord, toneForStatus } from '../shared/utils/resourceFormat'

const formats: SubscriptionTemplateFormat[] = [
  'xray_json',
  'mihomo',
  'stash',
  'sing_box',
  'clash',
  'raw_uri',
]

const templatesSpec = {
  ...sectionSpecs.subscription,
  description: 'Manage persisted subscription renderer templates for all client formats.',
  eyebrow: 'Subscription templates',
  primaryAction: 'New template',
  status: 'api-backed',
  title: 'Templates',
}

export function TemplatesPage() {
  const query = useSubscriptionTemplatesData()
  const createTemplate = useCreateSubscriptionTemplate()
  const updateTemplate = useUpdateSubscriptionTemplate()
  const deleteTemplate = useDeleteSubscriptionTemplate()
  const reorderTemplates = useReorderSubscriptionTemplates()
  const templates = query.data?.items ?? []
  const [name, setName] = useState('')
  const [format, setFormat] = useState<SubscriptionTemplateFormat>('mihomo')
  const [content, setContent] = useState('{"profile_title":"Lumen"}')
  const [formError, setFormError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    try {
      await createTemplate.mutateAsync({
        content_json: parseJson(content),
        format,
        name: name.trim(),
        status: 'active',
      })
      setName('')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Template could not be saved.')
    }
  }

  return (
    <ResourceScreen
      caption="Subscription templates"
      columns={['Name', 'Format', 'Content', 'Order', 'Status', 'Actions']}
      createForm={
        <ScreenForm onSubmit={handleSubmit}>
          <div>
            <p className="eyebrow">Create template</p>
            <h2>Renderer profile</h2>
            <p>Persist client-specific renderer defaults and metadata.</p>
          </div>
          <label htmlFor="template-name">
            Name
            <input id="template-name" required value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label htmlFor="template-format">
            Format
            <select id="template-format" value={format} onChange={(event) => setFormat(event.target.value as SubscriptionTemplateFormat)}>
              {formats.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label htmlFor="template-content">
            Content JSON
            <textarea id="template-content" rows={6} value={content} onChange={(event) => setContent(event.target.value)} />
          </label>
          <FormError message={formError} />
          <SubmitButton pending={createTemplate.isPending}>Create template</SubmitButton>
        </ScreenForm>
      }
      emptyDescription="Create templates for Happ, Mihomo, Sing-box, Clash, Stash, Xray JSON, or raw URI delivery."
      emptyTitle="No templates"
      error={query.error}
      errorTitle="Templates unavailable"
      isError={query.isError}
      isLoading={query.isLoading}
      isSuccess={query.isSuccess}
      items={templates}
      loadingLabel="Loading templates..."
      onRefresh={() => void query.refetch()}
      renderRow={(template) => ({
        cells: [
          template.name,
          template.format,
          formatRecord(template.content_json),
          String(template.order),
          <StatusBadge tone={toneForStatus(template.status)}>{template.status}</StatusBadge>,
          <div className="inline-actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() =>
                void updateTemplate.mutateAsync({
                  id: template.id,
                  request: { status: template.status === 'active' ? 'disabled' : 'active' },
                })
              }
            >
              Toggle
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Delete ${template.name}`}
              onClick={() => void deleteTemplate.mutateAsync(template.id)}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>,
        ],
        id: template.id,
      })}
      rightPanel={
        <article className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Renderer order</p>
              <h2>{templates.length} templates</h2>
            </div>
            <StatusBadge tone="good">api-backed</StatusBadge>
          </div>
          <button type="button" className="button button--secondary" onClick={() => void reorderTemplates.mutateAsync(templates.map((item) => item.id).reverse())}>
            Reverse order
          </button>
          <div className="resource-list">
            {templates.map((template) => (
              <div key={template.id} className="resource-list__item">
                <span>{template.name}</span>
                <small>{template.format}</small>
              </div>
            ))}
          </div>
        </article>
      }
      spec={templatesSpec}
      tableEyebrow="Renderer templates"
      tableTitle="Template registry"
    />
  )
}

function parseJson(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value || '{}')
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Content JSON must be an object.')
  }
  return parsed as Record<string, unknown>
}
