import type { MetricTone } from '../data/lumenData'

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return 'Not set'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function formatRecord(value: Record<string, unknown> | null | undefined) {
  const entries = Object.entries(value ?? {})
  if (entries.length === 0) {
    return 'None'
  }
  return entries.map(([key, entry]) => `${key}=${String(entry)}`).join(', ')
}

export function parseKeyValueInput(value: string) {
  const result: Record<string, string> = {}
  const rows = value
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean)

  for (const row of rows) {
    const separator = row.indexOf('=')
    if (separator <= 0 || separator === row.length - 1) {
      throw new Error('Use key=value pairs separated by commas or new lines.')
    }
    const key = row.slice(0, separator).trim()
    const normalizedKey = key.replace(/[-_]/g, '').toLowerCase()
    const forbidden = [
      'secret',
      'token',
      'password',
      'privatekey',
      'subscriptionurl',
      'runtimeconfig',
    ]
    if (forbidden.some((fragment) => normalizedKey.includes(fragment))) {
      throw new Error('Inline secret-like fields are not allowed.')
    }
    result[key] = row.slice(separator + 1).trim()
  }
  return result
}

export function toneForStatus(status: string): MetricTone {
  const normalized = status.toLowerCase().replace(/[\s-]+/g, '_')
  if (['active', 'valid', 'ready', 'enabled', 'passed'].includes(normalized)) {
    return 'good'
  }
  if (['paused', 'license_paused', 'limited', 'expiring', 'queued', 'pending'].includes(normalized)) {
    return 'watch'
  }
  if (['failed', 'invalid', 'revoked', 'disabled', 'quarantined'].includes(normalized)) {
    return 'danger'
  }
  if (['installing', 'provisioning', 'running', 'catalog'].includes(normalized)) {
    return 'info'
  }
  return 'neutral'
}
