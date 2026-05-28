import { Link } from 'react-router-dom'
import { BrandMark } from '../shared/components/BrandMark'

export function NotFoundPage() {
  return (
    <section className="page page--center">
      <BrandMark compact />
      <p className="eyebrow">Route unavailable</p>
      <h1>Control surface not found</h1>
      <p>The requested Lumen admin view is not available in this deployment.</p>
      <Link to="/dashboard" className="button button--primary">
        Return to dashboard
      </Link>
    </section>
  )
}
