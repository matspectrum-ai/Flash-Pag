import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Activity, ArrowLeft, BadgeCheck, Building2, CircleAlert, CircleDollarSign, Landmark, Network, ReceiptText, TrendingUp, Users } from 'lucide-react'
import { api } from '../../api/client'
import type { Account, MerchantMember, ProviderConnection } from '../../api/types'
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

export function Organization360Page() {
  const { organizationId = '' } = useParams()
  const { me } = useSession()
  const [days, setDays] = useState(30)
  const platformAdmin = Boolean(me?.user.platform_admin)

  const tenantsQuery = useQuery({ queryKey: ['platform-tenants'], queryFn: api.adminTenants, enabled: platformAdmin, staleTime: 30_000 })
  const organizations = tenantsQuery.data?.organizations ?? []
  const merchants = tenantsQuery.data?.merchants ?? []
  const organization = organizations.find((item) => item.id === organizationId)
  const merchant = organization ? merchants.find((item) => item.id === organization.merchant_id) : undefined

  const transactionsQuery = useQuery({
    queryKey: ['organization-360-transactions', organizationId],
    queryFn: () => api.transactions(organizationId, 1000),
    enabled: Boolean(organization && merchant),
    staleTime: 15_000,
  })
  const summaryQuery = useQuery({ queryKey: ['organization-360-summary', organizationId], queryFn: () => api.summary(organizationId), enabled: Boolean(organization), staleTime: 15_000 })
  const accountsQuery = useQuery({ queryKey: ['organization-360-accounts', organizationId], queryFn: () => api.list<Account>('accounts', organizationId), enabled: Boolean(organization), staleTime: 15_000 })
  const statsQuery = useQuery({ queryKey: ['organization-360-stats', organizationId], queryFn: () => api.adminOrganizationStats(organizationId), enabled: Boolean(organization), staleTime: 30_000 })
  const connectionsQuery = useQuery({ queryKey: ['organization-360-connections', organizationId], queryFn: () => api.list<ProviderConnection>('provider-connections', organizationId), enabled: Boolean(organization), staleTime: 15_000 })
  const kycQuery = useQuery({ queryKey: ['organization-360-kyc', merchant?.id], queryFn: () => api.adminKYCDetail(merchant!.id), enabled: Boolean(merchant) })
  const pricingQuery = useQuery({ queryKey: ['organization-360-pricing', merchant?.id], queryFn: () => api.adminPricingDetail(merchant!.id), enabled: Boolean(merchant) })
  const membersQuery = useQuery({ queryKey: ['organization-360-members', merchant?.id], queryFn: () => api.adminMerchantMembers(merchant!.id), enabled: Boolean(merchant) })

  const scoped = useMemo<ScopedTransaction[]>(() => {
    if (!organization || !merchant) return []
    return (transactionsQuery.data?.data ?? []).map((transaction) => ({ transaction, organization, merchant }))
  }, [organization, merchant, transactionsQuery.data])
  const finance = useMemo(() => aggregateFinance(scoped, days), [scoped, days])
  const recentTransactions = useMemo(() => [...finance.transactions].sort((a, b) => new Date(b.transaction.created_at).getTime() - new Date(a.transaction.created_at).getTime()).slice(0, 80), [finance.transactions])

  const currentPricing = (pricingQuery.data?.current ?? null) as Record<string, unknown> | null
  const pricingRules = (currentPricing?.rules ?? {}) as Record<string, PricingRule>
  const pixInRule = pricingRules.pix_in
  const members = (membersQuery.data?.data ?? []) as MerchantMember[]
  const accounts = accountsQuery.data?.data ?? []
  const connections = connectionsQuery.data?.data ?? []
  const readError = transactionsQuery.isError || summaryQuery.isError || accountsQuery.isError || statsQuery.isError || connectionsQuery.isError || kycQuery.isError || pricingQuery.isError || membersQuery.isError
  const dataLimited = (transactionsQuery.data?.data.length ?? 0) >= 1000
  const inventoryIncomplete = tenantsQuery.data?.complete === false
  const membersIncomplete = membersQuery.data?.complete === false
  const financeLoading = tenantsQuery.isLoading || transactionsQuery.isLoading
  const financeUnavailable = transactionsQuery.isError
  const providerCostDisplay = financeLoading
    ? '…'
    : financeUnavailable
      ? 'Indisponível'
      : dataLimited
        ? finance.metrics.providerCostKnownCount > 0 ? `${formatBRL(finance.metrics.providerCostMinor)} confirmado · parcial` : 'Indisponível'
        : finance.metrics.providerCostComplete
          ? formatBRL(finance.metrics.providerCostMinor)
          : finance.metrics.providerCostKnownCount > 0
            ? `${formatBRL(finance.metrics.providerCostMinor)} confirmado`
            : 'Indisponível'

  if (!platformAdmin) return <div className="error-state"><CircleAlert size={22} /><strong>Acesso restrito à plataforma.</strong><span>O 360° de organização é exclusivo da administração Flash Pag.</span></div>
  if (tenantsQuery.isLoading) return <div className="empty-state compact-empty"><Building2 size={22} /><strong>Carregando organização</strong><span>Recuperando o inventário administrativo.</span></div>
  if (!organization || !merchant) return <div className="error-state"><Building2 size={22} /><strong>{inventoryIncomplete ? 'Organização fora da janela carregada.' : 'Organização não encontrada.'}</strong><span>{inventoryIncomplete ? 'O inventário administrativo atingiu o limite de segurança; não é possível afirmar que a conta comercial não existe.' : 'A conta comercial informada não existe no inventário administrativo.'}</span></div>

  return (
    <div className="page-stack admin-finance-page">
      <Link className="admin-back-link" to="/platform/organizations"><ArrowLeft size={15} />Voltar às organizações</Link>

      <section className="merchant-360-hero panel">
        <div className="merchant-360-title"><span className="platform-tenant-icon"><Building2 size={20} /></span><div><span className="eyebrow">Organização 360°</span><h2>{organization.name}</h2><p className="mono">{organization.slug} · {organization.id}</p></div></div>
        <div className="merchant-360-hero-meta"><StatusBadge status={organization.status} /><span>Criada em {organization.created_at ? formatDateTime(organization.created_at) : '—'}</span></div>
        <div className="admin-period-switch" aria-label="Período"><span>Financeiro</span>{[7, 30, 90].map((period) => <button key={period} type="button" className={days === period ? 'active' : ''} onClick={() => setDays(period)}>{period}d</button>)}</div>
      </section>

      {inventoryIncomplete ? <div className="attention-banner"><div className="attention-icon"><CircleAlert size={17} /></div><div><strong>Inventário global parcial</strong><span>Esta organização foi encontrada, mas o inventário administrativo global atingiu seu limite de segurança.</span></div></div> : null}
      {membersIncomplete ? <div className="attention-banner"><div className="attention-icon"><CircleAlert size={17} /></div><div><strong>Lista de usuários parcial</strong><span>O limite de segurança de vínculos foi atingido; a equipe exibida não deve ser tratada como completa.</span></div></div> : null}
      {readError ? <div className="attention-banner"><div className="attention-icon"><CircleAlert size={17} /></div><div><strong>Leitura administrativa parcial</strong><span>Uma ou mais fontes da organização falharam. Campos indisponíveis não representam valores vazios ou zero.</span></div></div> : null}
      {dataLimited ? <div className="attention-banner"><div className="attention-icon"><CircleAlert size={17} /></div><div><strong>Janela de transações limitada</strong><span>A organização atingiu o limite de 1.000 transações carregadas; totais não devem ser tratados como fechamento contábil.</span></div></div> : null}

      <section className="admin-finance-metrics">
        <article className="metric-card admin-metric-card"><div className="metric-label"><Activity size={16} /><span>TPV · Pix recebido</span></div><strong>{financeLoading ? '…' : financeUnavailable ? 'Indisponível' : formatBRL(finance.metrics.tpvMinor)}</strong><span className="metric-detail">Volume concluído · horário de Brasília</span></article>
        <article className="metric-card admin-metric-card"><div className="metric-label"><CircleDollarSign size={16} /><span>Receita Flash Pag</span></div><strong>{financeLoading ? '…' : financeUnavailable ? 'Indisponível' : formatBRL(finance.metrics.revenueMinor)}</strong><span className="metric-detail">Taxas realizadas em Pix concluído</span></article>
        <article className="metric-card admin-metric-card"><div className="metric-label"><ReceiptText size={16} /><span>Custo provider confirmado</span></div><strong>{providerCostDisplay}</strong><span className="metric-detail">{financeUnavailable ? 'Leitura de transações indisponível' : dataLimited ? 'Janela parcial; subtotal confirmado quando disponível' : finance.metrics.providerCostComplete ? 'Cobertura completa' : 'Somente evidência verificável'}</span></article>
        <article className="metric-card admin-metric-card"><div className="metric-label"><TrendingUp size={16} /><span>Margem</span></div><strong>{financeLoading ? '…' : financeUnavailable || dataLimited || finance.metrics.marginMinor == null ? 'Indisponível' : formatBRL(finance.metrics.marginMinor)}</strong><span className="metric-detail">{dataLimited ? 'Janela parcial; margem não é fechada.' : 'Receita − custo provider; não é lucro líquido'}</span></article>
      </section>

      <section className="merchant-360-grid">
        <article className="panel merchant-360-info-card">
          <div className="panel-header"><div><h2>KYC / KYB</h2><p>Verificação da conta comercial desta organização.</p></div><BadgeCheck size={18} /></div>
          <div className="merchant-360-detail-list">
            <div><span>Status</span><strong>{kycQuery.isError ? 'Indisponível' : kycQuery.data?.profile ? <StatusBadge status={kycQuery.data.profile.status} /> : '—'}</strong></div>
            <div><span>Razão social</span><strong>{kycQuery.isError ? 'Indisponível' : kycQuery.data?.profile?.legal_name || '—'}</strong></div>
            <div><span>Nome fantasia</span><strong>{kycQuery.isError ? 'Indisponível' : kycQuery.data?.profile?.trade_name || '—'}</strong></div>
            <div><span>CNPJ / documento</span><strong>{kycQuery.isError ? 'Indisponível' : kycQuery.data?.profile?.tax_id || '—'}</strong></div>
            <div><span>E-mail</span><strong>{kycQuery.isError ? 'Indisponível' : kycQuery.data?.profile?.company_email || '—'}</strong></div>
          </div>
        </article>

        <article className="panel merchant-360-info-card">
          <div className="panel-header"><div><h2>Pricing Pix</h2><p>Regra comercial aplicada aos Pix recebidos.</p></div><CircleDollarSign size={18} /></div>
          <div className="merchant-360-detail-list">
            <div><span>Versão</span><strong>{pricingQuery.isError ? 'Indisponível' : typeof currentPricing?.version === 'number' ? `v${currentPricing.version}` : '—'}</strong></div>
            <div><span>Taxa fixa</span><strong>{pricingQuery.isError ? 'Indisponível' : pixInRule ? formatBRL(pixInRule.fixed_minor ?? 0) : '—'}</strong></div>
            <div><span>Percentual</span><strong>{pricingQuery.isError ? 'Indisponível' : pixInRule ? `${((pixInRule.percent_bps ?? 0) / 100).toFixed(2)}%` : '—'}</strong></div>
            <div><span>Mínimo</span><strong>{pricingQuery.isError ? 'Indisponível' : pixInRule ? (pixInRule.min_fee_minor == null ? 'Sem mínimo' : formatBRL(pixInRule.min_fee_minor)) : '—'}</strong></div>
            <div><span>Máximo</span><strong>{pricingQuery.isError ? 'Indisponível' : pixInRule ? (pixInRule.max_fee_minor == null ? 'Sem máximo' : formatBRL(pixInRule.max_fee_minor)) : '—'}</strong></div>
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Operação da organização</h2><p>Saldo, contas, clientes e processadoras deste contexto operacional.</p></div><StatusBadge status={organization.status} /></div>
        <div className="organization-360-operation">
          <div className="merchant-360-org-balance"><span>Saldo disponível</span><strong>{summaryQuery.isError ? 'Indisponível' : summaryQuery.data ? formatBRL(balanceMinor(summaryQuery.data.balance as Record<string, unknown>, 'available')) : '—'}</strong><small>{summaryQuery.isError ? 'Falha ao carregar saldo' : summaryQuery.data ? `Reservado ${formatBRL(balanceMinor(summaryQuery.data.balance as Record<string, unknown>, 'reserved'))}` : 'Carregando saldo'}</small></div>
          <div className="merchant-360-org-stats"><span><Landmark size={14} /><strong>{statsQuery.isError ? '—' : statsQuery.data?.accounts ?? '—'}</strong><small>contas</small></span><span><Users size={14} /><strong>{statsQuery.isError ? '—' : statsQuery.data?.customers ?? '—'}</strong><small>clientes</small></span><span><Network size={14} /><strong>{statsQuery.isError ? '—' : statsQuery.data?.provider_connections ?? '—'}</strong><small>conexões</small></span><span><Activity size={14} /><strong>{financeUnavailable ? '—' : finance.metrics.succeededCount}</strong><small>Pix no período</small></span></div>
          <div className="organization-360-lists">
            <div><h3>Contas</h3><div className="merchant-360-connection-list">{accountsQuery.isError ? <em>Contas indisponíveis.</em> : accountsQuery.isLoading ? <em>Carregando contas…</em> : accounts.length ? accounts.map((account) => <span key={account.id}><strong>{account.name}</strong><small>{account.currency}</small><StatusBadge status={account.status} /></span>) : <em>Sem contas cadastradas.</em>}</div></div>
            <div><h3>Processadoras</h3><div className="merchant-360-connection-list">{connectionsQuery.isError ? <em>Conexões indisponíveis.</em> : connectionsQuery.isLoading ? <em>Carregando conexões…</em> : connections.length ? connections.map((connection) => <span key={connection.id}><strong>{connection.provider_code}</strong><small>{connection.label}</small><StatusBadge status={connection.status} /></span>) : <em>Sem provider conectado.</em>}</div></div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Usuários da organização</h2><p>Equipe vinculada à conta comercial que controla esta organização.</p></div><span className="count-pill">{members.length}</span></div>
        <div className="merchant-360-members">{members.map((member) => <article key={member.user_id}><span className="customer-avatar"><Users size={14} /></span><div><strong>{member.email || member.user_id}</strong><span className="mono">{member.user_id}</span></div><span>{roleLabel(member.role)}</span></article>)}{!members.length && membersQuery.isError ? <div className="empty-state compact-empty"><CircleAlert size={22} /><strong>Usuários indisponíveis</strong><span>Não foi possível carregar os vínculos desta conta comercial.</span></div> : null}{!members.length && !membersQuery.isLoading && !membersQuery.isError ? <div className="empty-state compact-empty"><Users size={22} /><strong>Sem usuários carregados</strong><span>Nenhum vínculo foi retornado para esta conta comercial.</span></div> : null}</div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Pix recentes</h2><p>Atividade Pix recebida nesta organização.</p></div><span className="count-pill">{recentTransactions.length}</span></div>
        <div className="table-wrap"><table className="data-table admin-finance-table"><thead><tr><th>Data</th><th>Processadora</th><th>Status</th><th>Valor</th><th>Receita</th><th>Custo provider</th><th>Margem</th></tr></thead><tbody>{recentTransactions.map(({ transaction }) => { const margin = transactionMarginMinor(transaction); const realizedRevenue = transaction.status === 'succeeded' ? formatBRL(transaction.fee_minor ?? 0) : '—'; return <tr key={transaction.id}><td>{formatDateTime(transaction.created_at)}</td><td>{transaction.provider_code || '—'}</td><td><StatusBadge status={transaction.status} /></td><td>{formatBRL(transaction.amount_minor)}</td><td>{realizedRevenue}</td><td>{typeof transaction.provider_cost_minor === 'number' ? formatBRL(transaction.provider_cost_minor) : '—'}</td><td>{margin == null ? '—' : formatBRL(margin)}</td></tr> })}{!recentTransactions.length && !financeLoading && !financeUnavailable ? <tr><td colSpan={7}><div className="empty-state compact-empty"><Activity size={22} /><strong>Nenhum Pix no período</strong><span>Não há Pix recebido para exibir nesta janela.</span></div></td></tr> : null}</tbody></table></div>
      </section>
    </div>
  )
}
