import type { Merchant, Organization, Transaction } from '../../api/types'

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

export function periodCutoff(days: number) {
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - days + 1)
  return cutoff
}

export function filterPixInForPeriod(items: ScopedTransaction[], days: number) {
  const cutoff = periodCutoff(days).getTime()
  return items.filter(({ transaction }) => {
    if (transaction.kind !== 'pix_in') return false
    const created = new Date(transaction.created_at).getTime()
    return Number.isFinite(created) && created >= cutoff
  })
}

export function aggregateFinance(items: ScopedTransaction[], days: number) {
  const filtered = filterPixInForPeriod(items, days)
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
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - i)
    const key = date.toISOString().slice(0, 10)
    daily.set(key, { date: key, tpvMinor: 0, revenueMinor: 0, count: 0 })
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
        const key = new Date(transaction.created_at).toISOString().slice(0, 10)
        const point = daily.get(key)
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
