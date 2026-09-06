import { useMemo, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Activity, BarChart3, Building2, CircleAlert, CircleDollarSign, ReceiptText, Store, TrendingUp } from 'lucide-react'
import { api } from '../../api/client'
import type { Merchant } from '../../api/types'
import { useSession } from '../../app/session'
import { formatBRL, formatDateTime, statusLabel } from '../../lib/format'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { aggregateFinance, transactionMarginMinor, type ScopedTransaction } from './admin-finance'
import './admin-finance.css'

type MerchantRollup = {
  merchant: Merchant
  organizations: number
  tpvMinor: number
  revenueMinor: number
  succeeded: number
}

export function AdminFinancePage() {
  const { me } = useSession()
  const [days, setDays] = useState(30)
  const platformAdmin = Boolean(me?.user.platform_admin)
  const tenantsQuery = useQuery({
    queryKey: ['platform-tenants'],
    queryFn: api.adminTenants,
    enabled: platformAdmin,
    staleTime: 30_000,
  })
  const merchants = platformAdmin ? (tenantsQuery.data?.merchants ?? []) : (me?.merchants ?? [])
  const organizations = platformAdmin ? (tenantsQuery.data?.organizations ?? []) : (me?.organizations ?? [])

  const transactionQueries = useQueries({
    queries: organizations.map((organization) => ({
      queryKey: ['platform-finance-transactions', organization.id],
      queryFn: () => api.transactions(organization.id, 1000),
      staleTime: 15_000,
    })),
  })

  const scoped = useMemo<ScopedTransaction[]>(() => {
    const merchantById = new Map(merchants.map((merchant) => [merchant.id, merchant]))
    const output: ScopedTransaction[] = []
    organizations.forEach((organization, index) => {
      const merchant = merchantById.get(organization.merchant_id)
      if (!merchant) return
      for (const transaction of transactionQueries[index]?.data?.data ?? []) {
        output.push({ transaction, organization, merchant })
      }
    })
    return output
  }, [merchants, organizations, transactionQueries])

  const finance = useMemo(() => aggregateFinance(scoped, days), [scoped, days])
  const merchantRollups = useMemo(() => {
    const byMerchant = new Map<string, MerchantRollup>()
    for (const merchant of merchants) {
      byMerchant.set(merchant.id, {
        merchant,
        organizations: organizations.filter((organization) => organization.merchant_id === merchant.id).length,
        tpvMinor: 0,
        revenueMinor: 0,
        succeeded: 0,
      })
    }
    for (const item of finance.transactions) {
      if (item.transaction.status !== 'succeeded') continue
      const rollup = byMerchant.get(item.merchant.id)
      if (!rollup) continue
      rollup.tpvMinor += item.transaction.amount_minor
      rollup.revenueMinor += item.transaction.fee_minor ?? 0
      rollup.succeeded += 1
    }
    return [...byMerchant.values()].sort((a, b) => b.tpvMinor - a.tpvMinor)
  }, [finance.transactions, merchants, organizations])

  const recentTransactions = useMemo(
    () => [...finance.transactions].sort((a, b) => new Date(b.transaction.created_at).getTime() - new Date(a.transaction.created_at).getTime()).slice(0, 100),
    [finance.transactions],
  )
  const maxDailyTPV = Math.max(1, ...finance.daily.map((point) => point.tpvMinor))
  const isLoading = tenantsQuery.isLoading || transactionQueries.some((query) => query.isLoading)
  const hasError = tenantsQuery.isError || transactionQueries.some((query) => query.isError)
  const inventoryIncomplete = tenantsQuery.data?.complete === false
  const dataLimited = transactionQueries.some((query) => (query.data?.data.length ?? 0) >= 1000)
  const activeMerchants = merchants.filter((merchant) => merchant.status === 'active').length
  const providerCostDisplay = isLoading
    ? '…'
    : finance.metrics.providerCostComplete
      ? formatBRL(finance.metrics.providerCostMinor)
      : finance.metrics.providerCostKnownCount > 0
        ? `${formatBRL(finance.metrics.providerCostMinor)} confirmado`
        : 'Indisponível'

  if (!platformAdmin) {
    return <div className="error-state"><CircleAlert size={22} /><strong>Acesso restrito à plataforma.</strong><span>O dashboard financeiro é exclusivo da administração Flash Pag.</span></div>
  }

  return (
    <div className="page-stack admin-finance-page">
      <section className="admin-finance-hero panel">
        <div>
          <span className="eyebrow">Control plane financeiro</span>
          <h2>Visão financeira global</h2>
          <p>TPV mede volume processado. Receita mede somente taxas Flash Pag realizadas em Pix concluído. Custo de provider vem de evidência real do provider; margem só aparece quando essa cobertura é completa.</p>
        </div>
        <div className="admin-period-switch" aria-label="Período">
          {[7, 30, 90].map((period) => <button key={period} type="button" className={days === period ? 'active' : ''} onClick={() => setDays(period)}>{period}d</button>)}
        </div>
      </section>

      {hasError ? <div className="attention-banner"><div className="attention-icon"><CircleAlert size={17} /></div><div><strong>Leitura parcial</strong><span>Uma ou mais fontes administrativas não puderam ser carregadas. Os totais abaixo não devem ser tratados como fechamento.</span></div></div> : null}
      {inventoryIncomplete ? <div className="attention-banner"><div className="attention-icon"><CircleAlert size={17} /></div><div><strong>Inventário global truncado</strong><span>O limite de segurança do inventário administrativo foi atingido. Métricas e ranking não devem ser tratados como visão global completa.</span></div></div> : null}
      {dataLimited ? <div className="attention-banner"><div className="attention-icon"><CircleAlert size={17} /></div><div><strong>Janela de transações limitada</strong><span>Ao menos uma organização atingiu o limite de 1.000 transações carregadas. O dashboard sinaliza a limitação em vez de presumir completude.</span></div></div> : null}

      <section className="admin-finance-metrics">
        <article className="metric-card admin-metric-card"><div className="metric-label"><Activity size={16} /><span>TPV · Pix recebido</span></div><strong>{isLoading ? '…' : formatBRL(finance.metrics.tpvMinor)}</strong><span className="metric-detail">Volume `pix_in` concluído em {days} dias</span></article>
        <article className="metric-card admin-metric-card"><div className="metric-label"><CircleDollarSign size={16} /><span>Receita Flash Pag</span></div><strong>{isLoading ? '…' : formatBRL(finance.metrics.revenueMinor)}</strong><span className="metric-detail">Taxas realizadas em Pix concluído</span></article>
        <article className="metric-card admin-metric-card"><div className="metric-label"><ReceiptText size={16} /><span>Custo provider confirmado</span></div><strong>{providerCostDisplay}</strong><span className="metric-detail">{finance.metrics.providerCostComplete ? 'Cobertura completa' : `${finance.metrics.providerCostKnownCount} com custo confirmado · ${finance.metrics.providerCostMissingCount} sem evidência`}</span></article>
        <article className="metric-card admin-metric-card"><div className="metric-label"><TrendingUp size={16} /><span>Margem</span></div><strong>{isLoading ? '…' : finance.metrics.marginMinor == null ? 'Indisponível' : formatBRL(finance.metrics.marginMinor)}</strong><span className="metric-detail">Receita − custo provider. Não representa lucro líquido.</span></article>
      </section>

      <section className="admin-finance-secondary-metrics">
        <article><Store size={16} /><div><strong>{merchants.length}</strong><span>merchants</span><small>{activeMerchants} ativos</small></div></article>
        <article><Building2 size={16} /><div><strong>{organizations.length}</strong><span>organizações</span><small>contextos operacionais</small></div></article>
        <article><Activity size={16} /><div><strong>{finance.metrics.succeededCount}</strong><span>Pix concluídos</span><small>{finance.metrics.pendingCount} pendentes · {finance.metrics.failedCount} falhos</small></div></article>
        <article><BarChart3 size={16} /><div><strong>{formatBRL(finance.metrics.averageTicketMinor)}</strong><span>ticket médio</span><small>somente Pix concluído</small></div></article>
      </section>

      <section className="panel admin-chart-panel">
        <div className="panel-header"><div><h2>TPV diário</h2><p>Volume de Pix recebido concluído por dia-calendário no horário de Brasília.</p></div><span className="count-pill">{days} dias</span></div>
        <div className="admin-bar-chart" role="img" aria-label="Gráfico de TPV diário">
          {finance.daily.map((point) => {
            const height = Math.max(3, Math.round((point.tpvMinor / maxDailyTPV) * 100))
            return <div className="admin-bar-slot" key={point.date} title={`${point.date}: ${formatBRL(point.tpvMinor)}`}><span className="admin-bar" style={{ height: `${height}%` }} /><small>{point.date.slice(5)}</small></div>
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Merchants</h2><p>Ranking por TPV do período com acesso direto ao Merchant 360°.</p></div><span className="count-pill">{merchantRollups.length}</span></div>
        <div className="admin-merchant-list">
          {merchantRollups.map((item) => (
            <Link className="admin-merchant-row" to={`/platform/merchants/${item.merchant.id}`} key={item.merchant.id}>
              <span className="platform-tenant-icon"><Store size={17} /></span>
              <div><strong>{item.merchant.name}</strong><span>{item.organizations} organização(ões) · {item.succeeded} Pix concluídos</span></div>
              <div><strong>{formatBRL(item.tpvMinor)}</strong><span>TPV</span></div>
              <div><strong>{formatBRL(item.revenueMinor)}</strong><span>Receita</span></div>
              <StatusBadge status={item.merchant.status} />
            </Link>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Transações globais</h2><p>Somente Pix recebido. Transferências e saques não fazem parte desta fase.</p></div><span className="count-pill">{recentTransactions.length}</span></div>
        <div className="table-wrap">
          <table className="data-table admin-finance-table">
            <thead><tr><th>Data</th><th>Merchant / organização</th><th>Status</th><th>Valor</th><th>Receita</th><th>Custo provider</th><th>Margem</th></tr></thead>
            <tbody>
              {recentTransactions.map(({ transaction, organization, merchant }) => {
                const margin = transactionMarginMinor(transaction)
                const realizedRevenue = transaction.status === 'succeeded' ? formatBRL(transaction.fee_minor ?? 0) : '—'
                return <tr key={transaction.id}><td>{formatDateTime(transaction.created_at)}</td><td><strong>{merchant.name}</strong><span>{organization.name}</span></td><td><StatusBadge status={transaction.status} /></td><td>{formatBRL(transaction.amount_minor)}</td><td>{realizedRevenue}</td><td>{typeof transaction.provider_cost_minor === 'number' ? formatBRL(transaction.provider_cost_minor) : '—'}</td><td>{margin == null ? '—' : formatBRL(margin)}</td></tr>
              })}
              {!recentTransactions.length && !isLoading ? <tr><td colSpan={7}><div className="empty-state compact-empty"><Activity size={22} /><strong>Nenhum Pix no período</strong><span>Não há `pix_in` para compor TPV e receita.</span></div></td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="admin-finance-footnote">Datas financeiras usam o horário de Brasília. “{statusLabel('succeeded')}” entra no TPV e realiza receita; demais estados não entram no volume concluído.</div>
      </section>
    </div>
  )
}
