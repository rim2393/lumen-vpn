type LoadingStateProps = {
  label: string
}

type EmptyStateProps = {
  description: string
  title: string
}

type ErrorStateProps = {
  error: unknown
  title: string
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'The request could not be completed. Try again after the API is reachable.'
}

export function LoadingState({ label }: LoadingStateProps) {
  return (
    <p className="loading-state" aria-live="polite">
      {label}
    </p>
  )
}

export function EmptyState({ description, title }: EmptyStateProps) {
  return (
    <article className="state-card">
      <h2>{title}</h2>
      <p>{description}</p>
    </article>
  )
}

export function ErrorState({ error, title }: ErrorStateProps) {
  return (
    <article className="state-card state-card--error" role="alert">
      <h2>{title}</h2>
      <p>{getErrorMessage(error)}</p>
    </article>
  )
}
