import { statusLabel } from '../../lib/format'

export function StatusBadge({ status }: { status?: string }) {
  const tone = status === 'succeeded' || status === 'active'
    ? 'success'
    : status === 'pending' || status === 'ambiguous'
      ? 'warning'
      : status === 'failed'
        ? 'danger'
        : 'neutral'

  return <span className={`status-badge status-${tone}`}>{statusLabel(status)}</span>
}
