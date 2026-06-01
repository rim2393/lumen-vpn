import { Link, useRouteError } from 'react-router-dom'
import { BrandMark } from '../shared/components/BrandMark'

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'object' && error !== null && 'statusText' in error) {
    return String((error as { statusText: unknown }).statusText)
  }
  return 'An unexpected error occurred while rendering this view.'
}

export function ErrorPage() {
  const error = useRouteError()

  return (
    <section className="page page--center" role="alert">
      <BrandMark compact />
      <p className="eyebrow">Something went wrong</p>
      <h1>This control surface failed to load</h1>
      <p>{describeError(error)}</p>
      <Link to="/dashboard" className="button button--primary">
        Return to dashboard
      </Link>
    </section>
  )
}
