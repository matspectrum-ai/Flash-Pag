export function formatBRL(minor = 0) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(minor / 100)
}

export function formatDateTime(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function maskDocument(value?: string) {
  if (!value) return '—'
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 4) return '••••'
  return `${'•'.repeat(Math.min(8, digits.length - 4))}${digits.slice(-4)}`
}

export function roleLabel(role?: string) {
  const labels: Record<string, string> = {
    owner: 'Proprietário',
    admin: 'Administrador',
    member: 'Membro',
    viewer: 'Visualizador',
    platform_admin: 'Administrador da plataforma',
  }
  return labels[role || ''] || role || '—'
}

export function transactionLabel(kind?: string) {
  const labels: Record<string, string> = {
    pix_in: 'Pix recebido',
    pix_out: 'Pix enviado',
    transfer: 'Transferência',
    withdrawal: 'Saque',
  }
  return labels[kind || ''] || kind || 'Transação'
}

export function statusLabel(status?: string) {
  const labels: Record<string, string> = {
    succeeded: 'Concluída',
    pending: 'Pendente',
    ambiguous: 'Ambígua',
    failed: 'Falhou',
    active: 'Ativa',
    disabled: 'Desativada',
    revoked: 'Revogada',
  }
  return labels[status || ''] || status || '—'
}

export function balanceMinor(balance: Record<string, unknown> | undefined, key: 'available' | 'reserved' | 'clearing' | 'total') {
  if (!balance) return 0
  const minorKey = `${key}_minor`
  const minor = balance[minorKey]
  if (typeof minor === 'number') return minor
  const plain = balance[key]
  if (typeof plain === 'number') return plain
  if (typeof plain === 'string') {
    const parsed = Number(plain)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}
