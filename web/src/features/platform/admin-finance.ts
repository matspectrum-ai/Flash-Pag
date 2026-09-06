import type { Merchant, Organization, Transaction } from '../../api/types'

export const FINANCE_TIME_ZONE = 'America/Sao_Paulo'

const financeDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: FINANCE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export type ScopedTransaction = {
  transaction: Transaction
  organization: Organization
  merchant: Merchant
}

export type AdminFinanceMetrics = {
  tpvMinor: number
  revenueMinor: number
  providerCostMinor: number
  providerCostComplete: boolean
  providerCostKnownCount: number
  providerCostMissingCount: number
  marginMinor: number | null
  succeededCount: number
  pendingCount: number
  failedCount: number
  ambiguousCount: number
  averageTicketMinor: number
}

export type AdminFinanceDailyPoint = {
  date: string
  tpvMinor: number
  revenueMinor: number
  count: number
}

export function financeDateKey(date: Date) {
  if (!Number.isFinite(date.getTime())) return null
  const parts = financeDateFormatter.formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return year && month && day ? `${year}-${month}-${day}` : null
}

export function periodDateKeys(days: number, now = new Date()) {
  if (!Number.isInteger(days) || days < 1) return []
  const todayKey = financeDateKey(now)
  if (!todayKey) return []
  const [year, month, day] = todayKey.split('-').map(Number)
  const anchor = new Date(Date.UTC(year, month - 1, day, 12))
  const keys: string[] = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const cursor = new Date(anchor)
    cursor.setUTCDate(anchor.getUTCDate() - offset)
    keys.push(cursor.toISOString().slice(0, 10))
  }
  return keys
}

export function filterPixInForPeriod(items: ScopedTransaction[], days: number, now = new Date()) {
  const acceptedDates = new Set(periodDateKeys(days, now))
  return items.filter(({ transaction }) => {
    if (transaction.kind !== 'pix_in') return false
    const key = financeDateKey(new Date(transaction.created_at))
    return key != null && acceptedDates.has(key)
  })
}

export function aggregateFinance(items: ScopedTransaction[], days: number, now = new Date()) {
  const filtered = filterPixInForPeriod(items, days, now)
  const metrics: AdminFinanceMetrics = {
    tpvMinor: 0,
    revenueMinor: 0,
    providerCostMinor: 0,
    providerCostComplete: true,
    providerCostKnownCount: 0,
    providerCostMissingCount: 0,
    marginMinor: null,
    succeededCount: 0,
    pendingCount: 0,
    failedCount: 0,
    ambiguousCount: 0,
    averageTicketMinor: 0,
  }

  const daily = new Map<string, AdminFinanceDailyPoint>()
  for (const date of periodDateKeys(days, now)) {
    daily.set(date, { date, tpvMinor: 0, revenueMinor: 0, count: 0 })
  }

  for (const { transaction } of filtered) {
    switch (transaction.status) {
      case 'succeeded': {
        metrics.succeededCount += 1
        metrics.tpvMinor += transaction.amount_minor
        metrics.revenueMinor += transaction.fee_minor ?? 0
        if (typeof transaction.provider_cost_minor === 'number') {
          metrics.providerCostMinor += transaction.provider_cost_minor
          metrics.providerCostKnownCount += 1
        } else {
          metrics.providerCostComplete = false
          metrics.providerCostMissingCount += 1
        }
        const key = financeDateKey(new Date(transaction.created_at))
        const point = key ? daily.get(key) : undefined
        if (point) {
          point.tpvMinor += transaction.amount_minor
          point.revenueMinor += transaction.fee_minor ?? 0
          point.count += 1
        }
        break
      }
      case 'pending': metrics.pendingCount += 1; break
      case 'failed': metrics.failedCount += 1; break
      case 'ambiguous': metrics.ambiguousCount += 1; break
      default: break
    }
  }

  if (metrics.succeededCount > 0) metrics.averageTicketMinor = Math.trunc(metrics.tpvMinor / metrics.succeededCount)
  if (metrics.providerCostComplete) metrics.marginMinor = metrics.revenueMinor - metrics.providerCostMinor

  return { metrics, daily: [...daily.values()], transactions: filtered }
}

export function transactionMarginMinor(transaction: Transaction) {
  if (transaction.status !== 'succeeded' || typeof transaction.provider_cost_minor !== 'number') return null
  return (transaction.fee_minor ?? 0) - transaction.provider_cost_minor
}
