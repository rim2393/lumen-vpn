import { Outlet } from 'react-router-dom'
import { usePanelIdentityData } from '../../shared/api/resourceHooks'
import { BrandMark } from '../../shared/components/BrandMark'
import { StatusBadge } from '../../shared/components/StatusBadge'

export function AuthLayout() {
  const identity = usePanelIdentityData()
  const productName = identity.data?.product_name ?? 'Lumen Guard'

  return (
    <main className="auth-shell">
      <section className="auth-intro" aria-label={`${productName} overview`}>
        <BrandMark productName={productName} />
        <div>
          <p className="eyebrow">Zero-trust admin entry</p>
          <h1>{productName}</h1>
          <p>
            A quiet control surface for operators: authenticate, complete the configured MFA
            policy, then enter the portal with least-privilege defaults.
          </p>
        </div>
        <div className="auth-intro__status">
          <StatusBadge tone="good">MFA when configured</StatusBadge>
          <StatusBadge>Session isolated</StatusBadge>
        </div>
      </section>
      <section className="auth-panel" aria-label="Authentication form">
        <Outlet />
      </section>
    </main>
  )
}
