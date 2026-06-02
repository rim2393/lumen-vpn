import { ShieldCheck } from 'lucide-react'

type BrandMarkProps = {
  compact?: boolean
  productName?: string
}

export function BrandMark({ compact = false, productName = 'Lumen Guard' }: BrandMarkProps) {
  const [primary, ...secondaryParts] = productName.trim().split(/\s+/)
  const secondary = secondaryParts.join(' ') || 'Guard'

  return (
    <span className="brand-mark" aria-label={productName}>
      <span className="brand-mark__sigil" aria-hidden="true">
        <ShieldCheck size={compact ? 18 : 22} strokeWidth={2.2} />
      </span>
      {!compact && (
        <span className="brand-mark__text">
          <strong>{primary || 'Lumen'}</strong>
          <span>{secondary}</span>
        </span>
      )}
    </span>
  )
}
