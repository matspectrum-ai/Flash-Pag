import { useMemo, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Activity, ArrowLeft, BadgeCheck, Building2, CircleAlert, CircleDollarSign, Landmark, Network, ReceiptText, Store, TrendingUp, Users } from 'lucide-react'
import { api } from '../../api/client'
import type { Account, Customer, MerchantMember, ProviderConnection } from '../../api/types'
import { useSession } from '../../app/session'
import { balanceMinor, formatBRL, formatDateTime, roleLabel } from '../../lib/format'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { aggregateFinance, transactionMarginMinor, type ScopedTransaction } from './admin-finance'
import './admin-finance.css'

type PricingRule = {
  fixed_minor?: number
  percent_bps?: number
  min_fee_minor?: number | null
  max_fee_minor?: number | null
}

export function Merchant360Page() {
  const { merchantId = '' } = useParams()
  const { me } = useSession()
  const [days, setDays] = useState(30)
  const merchant = (me?.merchants ?? []).find((item) => item.id === merchantId)
  const organizations = (me?.organizations ?? []).filter((item) => item.merchant_id === merchantId)

  const transactionQueries = useQueries({
    queries: organizations.map((organization) => ({
      queryKey: ['merchant-360-transactions', organization.id],
      queryFn: () => api.transactions(organization.id, 1000),
      staleTime: 15_000,
    })),
  })
  const summaryQueries = useQueries({
    queries: organizations.map((organization) => ({
      queryKey: ['merchant-360-summary', organization.id],
      queryFn: () => api.summary(organization.id),
      staleTime: 15_000,
    })),
  })
  const accountQueries = useQueries({
    queries: organizations.map((organization) => ({
      queryKey: ['merchant-360-accounts', organization.id],
      queryFn: () => api.list<Account>('accounts', organization.id),
      staleTime: 15_000,
    })),
  })
  const customerQueries = useQueries({
    queries: organizations.map((organization) => ({
      queryKey: ['merchant-360-customers', organization.id],
      queryFn: () => api.list<Customer>('customers', organization.id),
      staleTime: 15_000,
    })),
  })
  const connectionQueries = useQueries({
    queries: organizations.map((organization) => ({
      queryKey: ['merchant-360-connections', organization.id],
      queryFn: () => api.list<ProviderConnection>('provider-connections', organization.id),
      staleTime: 15_000,
    })),
  })

  const kycQuery = useQuery({
    queryKey: ['merchant-360-kyc', merchantId],
    queryFn: () => api.adminKYCDetail(merchantId),
    enabled: Boolean(merchantId && me?.user.platform_admin),
  })
  const pricingQuery = useQuery({
    queryKey: ['merchant-360-pricing', merchantId],
    queryFn: () => api.adminPricingDetail(merchantId),
    enabled: Boolean(merchantId && me?.user.platform_admin),
  })
  const membersQuery = useQuery({
    queryKey: ['merchant-360-members', organizations[0]?.id],
    queryFn: () => api.members(organizations[0]!.id),
    enabled: Boolean(organizations[0]?.id && me?.user.platform_admin),
  })

  const scoped = useMemo<ScopedTransaction[]>(() => {
    if (!merchant) return []
    const output: ScopedTransaction[] = []
    organizations.forEach((organization, index) => {
      for (const transaction of transactionQueries[index]?.data?.data ?? []) {
        output.push({ transaction, organization, merchant })
      }
    })
    return output
  }, [merchant, organizations, transactionQueries])
  const finance = useMemo(() => aggregateFinance(scoped, days), [scoped, days])
  const recentTransactions = useMemo(
    () => [...finance.transactions].sort((a, b) => new Date(b.transaction.created_at).getTime() - new Date(a.transaction.created_at).getTime()).slice(0, 80),
    [finance.transactions],
  )

  const currentPricing = (pricingQuery.data?.current ?? null) as Record<string, unknown> | null
  const pricingRules = (currentPricing?.rules ?? {}) as Record<string, PricingRule>
  const pixInRule = pricingRules.pix_in
  const members = (membersQuery.data?.data ?? []) as MerchantMember[]
  const loading = transactionQueries.some((query) => query.isLoading) || summaryQueries.some((query) => query.isLoading)
  const dataLimited = transactionQueries.some((query) => (query.data?.data.length ?? 0) >= 1000)

  if (!me?.user.platform_admin) {
    return <div className="error-state"><CircleAlert size={22} /><strong>Acesso restrito à plataforma.</strong><span>Merchant 360° é exclusivo da administração Flash Pag.</span></div>
  }
  if (!merchant) {
    return <div className="error-state"><Store size={22} /><strong>Merchant não encontrado.</strong><span>O tenant informado não existe ou não está disponível nesta sessão.</span></div>
  }

  return (
    <div className="page-stack admin-finance-page">
      <Link className="admin-back-link" to="/platform/finance"><ArrowLeft size={15} />Voltar ao financeiro global</Link>

      <section className="merchant-360-hero panel">
        <div className="merchant-360-title"><span className="platform-tenant-icon"><Store size={20} /></span><div><span className="eyebrow">Merchant 360°</span><h2>{merchant.name}</h2><p className="mono">{merchant.id}</p></div></div>
        <div className="merchant-360-hero-meta"><StatusBadge status={merchant.status} /><span>Criado em {formatDateTime(merchant.created_at)}</span></div>
        <div className="admin-period-switch" aria-label="Período"><span>Financeiro</span>{[7, 30, 90].map((period) => <button key={period} type="button" className={days === period ? 'active' : ''} onClick={() => setDays(period)}>{period}d</button>)}</div>
      </section>

      {dataLimited ? <div className="attention-banner"><div className="attention-icon"><CircleAlert size={17} /></div><div><strong>Janela de dados limitada</strong><span>Uma organização atingiu 1.000 transações carregadas. Os totais permanecem sinalizados como uma visão operacional, não fechamento contábil.</span></div></div> : null}

      <section className="admin-finance-metrics">
        <article className="metric-card admin-metric-card"><div className="metric-label"><Activity size={16} /><span>TPV · Pix recebido</span></div><strong>{loading ? '…' : formatBRL(finance.metrics.tpvMinor)}</strong><span className="metric-detail">Volume concluído no período</span></article>
        <article className="metric-card admin-metric-card"><div className="metric-label"><CircleDollarSign size={16} /><span>Receita Flash Pag</span></div><strong>{loading ? '…' : formatBRL(finance.metrics.revenueMinor)}</strong><span className="metric-detail">Taxas cobradas do merchant</span></article>
        <article className="metric-card admin-metric-card"><div className="metric-label"><ReceiptText size={16} /><span>Custo provider confirmado</span></div><strong>{loading ? '…' : formatBRL(finance.metrics.providerCostMinor)}</strong><span className="metric-detail">{finance.metrics.providerCostComplete ? 'Cobertura completa' : `${finance.metrics.providerCostMissingCount} Pix sem custo explícito`}</span></article>
        <article className="metric-card admin-metric-card"><div className="metric-label"><TrendingUp size={16} /><span>Margem</span></div><strong>{loading ? '…' : finance.metrics.marginMinor == null ? 'Indisponível' : formatBRL(finance.metrics.marginMinor)}</strong><span className="metric-detail">Receita − custo provider; não é lucro líquido</span></article>
      </section>

      <section className="merchant-360-grid">
        <article className="panel merchant-360-info-card">
          <div className="panel-header"><div><h2>KYC / KYB</h2><p>Estado de verificação do merchant.</p></div><BadgeCheck size={18} /></div>
          <div className="merchant-360-detail-list">
            <div><span>Status</span><strong>{kycQuery.data?.profile ? <StatusBadge status={kycQuery.data.profile.status} /> : '—'}</strong></div>
            <div><span>Razão social</span><strong>{kycQuery.data?.profile?.legal_name || '—'}</strong></div>
            <div><span>Nome fantasia</span><strong>{kycQuery.data?.profile?.trade_name || '—'}</strong></div>
            <div><span>CNPJ / documento</span><strong>{kycQuery.data?.profile?.tax_id || '—'}</strong></div>
            <div><span>E-mail</span><strong>{kycQuery.data?.profile?.company_email || '—'}</strong></div>
          </div>
        </article>

        <article className="panel merchant-360-info-card">
          <div className="panel-header"><div><h2>Pricing Pix</h2><p>Versão comercial atualmente aplicada ao Pix recebido.</p></div><CircleDollarSign size={18} /></div>
          <div className="merchant-360-detail-list">
            <div><span>Versão</span><strong>{typeof currentPricing?.version === 'number' ? `v${currentPricing.version}` : '—'}</strong></div>
            <div><span>Taxa fixa</span><strong>{pixInRule ? formatBRL(pixInRule.fixed_minor ?? 0) : '—'}</strong></div>
            <div><span>Percentual</span><strong>{pixInRule ? `${((pixInRule.percent_bps ?? 0) / 100).toFixed(2)}%` : '—'}</strong></div>
            <div><span>Mínimo</span><strong>{pixInRule?.min_fee_minor == null ? 'Sem mínimo' : formatBRL(pixInRule.min_fee_minor)}</strong></div>
            <div><span>Máximo</span><strong>{pixInRule?.max_fee_minor == null ? 'Sem máximo' : formatBRL(pixInRule.max_fee_minor)}</strong></div>
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Organizações</h2><p>Saldos, contas, clientes, conexões e atividade Pix de cada contexto operacional.</p></div><span className="count-pill">{organizations.length}</span></div>
        <div className="merchant-360-org-grid">
          {organizations.map((organization, index) => {
            const summary = summaryQueries[index]?.data
            const accounts = accountQueries[index]?.data?.data ?? []
            const customers = customerQueries[index]?.data?.data ?? []
            const connections = connectionQueries[index]?.data?.data ?? []
            const organizationTx = finance.transactions.filter((item) => item.organization.id === organization.id)
            return <article className="merchant-360-org-card" key={organization.id}>
              <div className="merchant-360-org-head"><span className="platform-tenant-icon"><Building2 size={17} /></span><div><strong>{organization.name}</strong><code>{organization.slug}</code></div><StatusBadge status={organization.status} /></div>
              <div className="merchant-360-org-balance"><span>Saldo disponível</span><strong>{summary ? formatBRL(balanceMinor(summary.balance as Record<string, unknown>, 'available')) : '—'}</strong><small>{summary ? `Reservado ${formatBRL(balanceMinor(summary.balance as Record<string, unknown>, 'reserved'))}` : 'Carregando saldo'}</small></div>
              <div className="merchant-360-org-stats"><span><Landmark size={14} /><strong>{accounts.length}</strong><small>contas</small></span><span><Users size={14} /><strong>{customers.length}</strong><small>clientes</small></span><span><Network size={14} /><strong>{connections.length}</strong><small>conexões</small></span><span><Activity size={14} /><strong>{organizationTx.filter((item) => item.transaction.status === 'succeeded').length}</strong><small>Pix no período</small></span></div>
              <div className="merchant-360-connection-list">{connections.slice(0, 3).map((connection) => <span key={connection.id}><strong>{connection.provider_code}</strong><small>{connection.label}</small><StatusBadge status={connection.status} /></span>)}{!connections.length ? <em>Sem provider conectado.</em> : null}</div>
            </article>
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Equipe do merchant</h2><p>Membros e papéis compartilhados entre as organizações do tenant.</p></div><span className="count-pill">{members.length}</span></div>
        <div className="merchant-360-members">
          {members.map((member) => <article key={member.user_id}><span className="customer-avatar"><Users size={14} /></span><div><strong>{member.email}</strong><span className="mono">{member.user_id}</span></div><span>{roleLabel(member.role)}</span></article>)}
          {!members.length && !membersQuery.isLoading ? <div className="empty-state compact-empty"><Users size={22} /><strong>Sem membros carregados</strong><span>Nenhum vínculo adicional foi retornado para este merchant.</span></div> : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Pix recentes</h2><p>Visão consolidada das organizações. Transferências e saques não aparecem aqui.</p></div><span className="count-pill">{recentTransactions.length}</span></div>
        <div className="table-wrap"><table className="data-table admin-finance-table"><thead><tr><th>Data</th><th>Organização</th><th>Status</th><th>TPV</th><th>Receita</th><th>Custo provider</th><th>Margem</th></tr></thead><tbody>{recentTransactions.map(({ transaction, organization }) => { const margin = transactionMarginMinor(transaction); return <tr key={transaction.id}><td>{formatDateTime(transaction.created_at)}</td><td><strong>{organization.name}</strong><span>{transaction.provider_code || '—'}</span></td><td><StatusBadge status={transaction.status} /></td><td>{formatBRL(transaction.amount_minor)}</td><td>{formatBRL(transaction.fee_minor ?? 0)}</td><td>{typeof transaction.provider_cost_minor === 'number' ? formatBRL(transaction.provider_cost_minor) : '—'}</td><td>{margin == null ? '—' : formatBRL(margin)}</td></tr> })}</tbody></table></div>
      </section>
    </div>
  )
}
