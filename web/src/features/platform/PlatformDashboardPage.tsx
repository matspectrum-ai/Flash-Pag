import { useMemo, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Activity, BarChart3, Building2, CircleAlert, CircleDollarSign, ReceiptText, TrendingUp } from 'lucide-react'
import { api } from '../../api/client'
import type { Organization } from '../../api/types'
import { useSession } from '../../app/session'
import { formatBRL, formatDateTime, statusLabel } from '../../lib/format'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { aggregateFinance, transactionMarginMinor, type ScopedTransaction } from './admin-finance'
import './admin-finance.css'

type OrganizationRollup = {
  organization: Organization
  tpvMinor: number
  revenueMinor: number
  succeeded: number
}

export function PlatformDashboardPage() {
  const { me } = useSession()
  const [days, setDays] = useState(30)
  const platformAdmin = Boolean(me?.user.platform_admin)
  const tenantsQuery = useQuery({ queryKey: ['platform-tenants'], queryFn: api.adminTenants, enabled: platformAdmin, staleTime: 30_000 })
  const merchants = tenantsQuery.data?.merchants ?? []
  const organizations = tenantsQuery.data?.organizations ?? []
  const transactionQueries = useQueries({ queries: organizations.map((organization) => ({ queryKey: ['platform-dashboard-transactions', organization.id], queryFn: () => api.transactions(organization.id, 1000), staleTime: 15_000 })) })

  const scoped = useMemo<ScopedTransaction[]>(() => {
    const merchantById = new Map(merchants.map((merchant) => [merchant.id, merchant]))
    return organizations.flatMap((organization, index) => {
      const merchant = merchantById.get(organization.merchant_id)
      if (!merchant) return []
      return (transactionQueries[index]?.data?.data ?? []).map((transaction) => ({ transaction, organization, merchant }))
    })
  }, [merchants, organizations, transactionQueries])
  const finance = useMemo(() => aggregateFinance(scoped, days), [scoped, days])
  const rollups = useMemo<OrganizationRollup[]>(() => organizations.map((organization) => {
    const txs = finance.transactions.filter((item) => item.organization.id === organization.id && item.transaction.status === 'succeeded')
    return {
      organization,
      tpvMinor: txs.reduce((sum, item) => sum + item.transaction.amount_minor, 0),
      revenueMinor: txs.reduce((sum, item) => sum + (item.transaction.fee_minor ?? 0), 0),
      succeeded: txs.length,
    }
  }).sort((a, b) => b.tpvMinor - a.tpvMinor), [organizations, finance.transactions])
  const recentTransactions = useMemo(() => [...finance.transactions].sort((a, b) => new Date(b.transaction.created_at).getTime() - new Date(a.transaction.created_at).getTime()).slice(0, 100), [finance.transactions])
  const maxDailyTPV = Math.max(1, ...finance.daily.map((point) => point.tpvMinor))
  const isLoading = tenantsQuery.isLoading || transactionQueries.some((query) => query.isLoading)
  const hasError = tenantsQuery.isError || transactionQueries.some((query) => query.isError)
  const inventoryIncomplete = tenantsQuery.data?.complete === false
  const dataLimited = transactionQueries.some((query) => (query.data?.data.length ?? 0) >= 1000)
  const globalIncomplete = hasError || inventoryIncomplete || dataLimited
  const activeOrganizations = organizations.filter((organization) => organization.status === 'active').length
  const providerCostDisplay = isLoading ? '…' : globalIncomplete ? (finance.metrics.providerCostKnownCount > 0 ? `${formatBRL(finance.metrics.providerCostMinor)} confirmado · parcial` : 'Indisponível') : finance.metrics.providerCostComplete ? formatBRL(finance.metrics.providerCostMinor) : finance.metrics.providerCostKnownCount > 0 ? `${formatBRL(finance.metrics.providerCostMinor)} confirmado` : 'Indisponível'

  if (!platformAdmin) return <div className="error-state"><CircleAlert size={22} /><strong>Acesso restrito à plataforma.</strong><span>O dashboard global é exclusivo da administração Flash Pag.</span></div>

  return <div className="page-stack admin-finance-page">
    <section className="admin-finance-hero panel"><div><span className="eyebrow">Visão geral</span><h2>Dashboard da plataforma</h2><p>Operação financeira consolidada das organizações. TPV é volume processado; receita é taxa Flash Pag realizada; custo provider exige evidência real; margem não é lucro líquido.</p></div><div className="admin-period-switch" aria-label="Período">{[7, 30, 90].map((period) => <button key={period} type="button" className={days === period ? 'active' : ''} onClick={() => setDays(period)}>{period}d</button>)}</div></section>
    {hasError ? <div className="attention-banner"><div className="attention-icon"><CircleAlert size={17} /></div><div><strong>Leitura parcial</strong><span>Uma ou mais fontes administrativas falharam; os totais não devem ser tratados como fechamento.</span></div></div> : null}
    {inventoryIncomplete || dataLimited ? <div className="attention-banner"><div className="attention-icon"><CircleAlert size={17} /></div><div><strong>Visão incompleta</strong><span>{inventoryIncomplete ? 'O inventário global atingiu seu limite de segurança. ' : ''}{dataLimited ? 'Ao menos uma organização atingiu 1.000 transações carregadas.' : ''}</span></div></div> : null}
    <section className="admin-finance-metrics"><article className="metric-card admin-metric-card"><div className="metric-label"><Activity size={16} /><span>TPV · Pix recebido</span></div><strong>{isLoading ? '…' : formatBRL(finance.metrics.tpvMinor)}</strong><span className="metric-detail">Volume concluído em {days} dias</span></article><article className="metric-card admin-metric-card"><div className="metric-label"><CircleDollarSign size={16} /><span>Receita Flash Pag</span></div><strong>{isLoading ? '…' : formatBRL(finance.metrics.revenueMinor)}</strong><span className="metric-detail">Taxas realizadas em Pix concluído</span></article><article className="metric-card admin-metric-card"><div className="metric-label"><ReceiptText size={16} /><span>Custo provider confirmado</span></div><strong>{providerCostDisplay}</strong><span className="metric-detail">{finance.metrics.providerCostComplete ? 'Cobertura completa' : `${finance.metrics.providerCostKnownCount} confirmados · ${finance.metrics.providerCostMissingCount} sem evidência`}</span></article><article className="metric-card admin-metric-card"><div className="metric-label"><TrendingUp size={16} /><span>Margem</span></div><strong>{isLoading ? '…' : globalIncomplete || finance.metrics.marginMinor == null ? 'Indisponível' : formatBRL(finance.metrics.marginMinor)}</strong><span className="metric-detail">{globalIncomplete ? 'Visão global incompleta; margem não é fechada.' : 'Receita − custo provider. Não é lucro líquido.'}</span></article></section>
    <section className="admin-finance-secondary-metrics"><article><Building2 size={16} /><div><strong>{organizations.length}</strong><span>organizações</span><small>{activeOrganizations} ativas</small></div></article><article><Activity size={16} /><div><strong>{finance.metrics.succeededCount}</strong><span>Pix concluídos</span><small>{finance.metrics.pendingCount} pendentes · {finance.metrics.failedCount} falhos</small></div></article><article><BarChart3 size={16} /><div><strong>{formatBRL(finance.metrics.averageTicketMinor)}</strong><span>ticket médio</span><small>somente Pix concluído</small></div></article><article><CircleDollarSign size={16} /><div><strong>{formatBRL(finance.metrics.revenueMinor)}</strong><span>receita realizada</span><small>sem antecipar fee pendente</small></div></article></section>
    <section className="panel admin-chart-panel"><div className="panel-header"><div><h2>TPV diário</h2><p>Volume de Pix recebido concluído por dia-calendário no horário de Brasília.</p></div><span className="count-pill">{days} dias</span></div><div className="admin-bar-chart" role="img" aria-label="Gráfico de TPV diário">{finance.daily.map((point) => { const height = Math.max(3, Math.round((point.tpvMinor / maxDailyTPV) * 100)); return <div className="admin-bar-slot" key={point.date} title={`${point.date}: ${formatBRL(point.tpvMinor)}`}><span className="admin-bar" style={{ height: `${height}%` }} /><small>{point.date.slice(5)}</small></div> })}</div></section>
    <section className="panel"><div className="panel-header"><div><h2>Organizações</h2><p>Ranking por TPV com acesso direto ao 360° operacional.</p></div><span className="count-pill">{rollups.length}</span></div><div className="admin-merchant-list">{rollups.map((item) => <Link className="admin-merchant-row" to={`/platform/organizations/${item.organization.id}`} key={item.organization.id}><span className="platform-tenant-icon"><Building2 size={17} /></span><div><strong>{item.organization.name}</strong><span>{item.succeeded} Pix concluídos · {item.organization.slug}</span></div><div><strong>{formatBRL(item.tpvMinor)}</strong><span>TPV</span></div><div><strong>{formatBRL(item.revenueMinor)}</strong><span>Receita</span></div><StatusBadge status={item.organization.status} /></Link>)}</div></section>
    <section className="panel"><div className="panel-header"><div><h2>Transações recentes</h2><p>Somente Pix recebido em todas as organizações.</p></div><span className="count-pill">{recentTransactions.length}</span></div><div className="table-wrap"><table className="data-table admin-finance-table"><thead><tr><th>Data</th><th>Organização</th><th>Status</th><th>Valor</th><th>Receita</th><th>Custo provider</th><th>Margem</th></tr></thead><tbody>{recentTransactions.map(({ transaction, organization }) => { const margin = transactionMarginMinor(transaction); return <tr key={transaction.id}><td>{formatDateTime(transaction.created_at)}</td><td><strong>{organization.name}</strong><span>{organization.slug}</span></td><td><StatusBadge status={transaction.status} /></td><td>{formatBRL(transaction.amount_minor)}</td><td>{transaction.status === 'succeeded' ? formatBRL(transaction.fee_minor ?? 0) : '—'}</td><td>{typeof transaction.provider_cost_minor === 'number' ? formatBRL(transaction.provider_cost_minor) : '—'}</td><td>{margin == null ? '—' : formatBRL(margin)}</td></tr> })}</tbody></table></div><div className="admin-finance-footnote">Datas usam o horário de Brasília. “{statusLabel('succeeded')}” entra no TPV e realiza receita; demais estados não entram no volume concluído.</div></section>
  </div>
}
