import { useState } from 'react'

export function BrandMark({ className = '' }: { className?: string }) {
  const [unavailable, setUnavailable] = useState(false)

  if (unavailable) return null

  return (
    <span className={`brand-mark ${className}`.trim()} aria-hidden="true">
      <img
        src="/app/brand/flash-pag-mark.png"
        alt=""
        onError={() => setUnavailable(true)}
      />
    </span>
  )
}
