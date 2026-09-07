import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { CircleAlert, Landmark, ShieldCheck, WalletCards } from 'lucide-react'
import { api } from '../../api/client'
import type { Account } from '../../api/types'
import { useSession } from '../../app/session'
import { balanceMinor, formatBRL } from '../../lib/format'
import { StatusBadge } from '../../components/ui/StatusBadge'
import './admin-finance.css'

export function PlatformBalancesPage() {
  const { me } = useSession()
  const platformAdmin = Boolean(me?.user.platform_admin)
  const tenantsQuery = useQuery({ queryKey: ['platform-tenants'], queryFn: api.adminTenants, enabled: platformAdmin, staleTime: 30_000 })
  const organizations = tenantsQuery.data?.organizations ?? []
  const summaryQueries = useQueries({ queries: organizations.map((organization) => ({ queryKey: ['platform-balances-summary', organization.id], queryFn: () => api.summary(organization.id), staleTime: 15_000 })) })
  const accountQueries = useQueries({ queries: organizations.map((organization) => ({ queryKey: ['platform-balances-accounts', organization.id], queryFn: () => api.list<Account>('accounts', organization.id), staleTime: 15_000 })) })
  const rows = useMemo(() => organizations.map((organization, index) => {
    const summary = summaryQueries[index]?.data
    const accounts = accountQueries[index]?.data?.data ?? []
    return {
      organization,
      accounts,
      available: summary ? balanceMinor(summary.balance as Record<string, unknown>, 'available') : null,
      reserved: summary ? balanceMinor(summary.balance as Record<string, unknown>, 'reserved') : null,
      error: Boolean(summaryQueries[index]?.isError || accountQueries[index]?.isError),
    }
  }), [organizations, summaryQueries, accountQueries])
  const availableTotal = rows.reduce((sum, row) => sum + (row.available ?? 0), 0)
  const reservedTotal = rows.reduce((sum, row) => sum + (row.reserved ?? 0), 0)
  const unavailable = rows.filter((row) => row.error).length

  if (!platformAdmin) return <div className="error-state"><ShieldCheck size={22} /><strong>Acesso restrito à plataforma.</strong><span>Saldos globais são exclusivos da administração Flash Pag.</span></div>
  return <div className="page-stack admin-finance-page">
    <section className="platform-section-heading"><div><span className="eyebrow">Operação</span><h2>Saldos</h2><p>Liquidez operacional por organização, sem misturar saldos entre tenants.</p></div></section>
    {unavailable ? <div className="attention-banner"><div className="attention-icon"><CircleAlert size={17} /></div><div><strong>Leitura parcial</strong><span>{unavailable} organização(ões) sem saldo completo. Totais abaixo somam somente dados disponíveis.</span></div></div> : null}
    <section className="platform-admin-kpis"><article className="metric-card"><div className="metric-label"><WalletCards size={16} /><span>Disponível confirmado</span></div><strong>{formatBRL(availableTotal)}</strong><span className="metric-detail">Soma das organizações carregadas</span></article><article className="metric-card"><div className="metric-label"><Landmark size={16} /><span>Reservado confirmado</span></div><strong>{formatBRL(reservedTotal)}</strong><span className="metric-detail">Saldo não disponível</span></article><article className="metric-card"><div className="metric-label"><CircleAlert size={16} /><span>Indisponíveis</span></div><strong>{unavailable}</strong><span className="metric-detail">Reads com falha</span></article></section>
    <section className="panel"><div className="panel-header"><div><h2>Saldos por organização</h2><p>Saldo disponível e reservado da conta operacional principal.</p></div><span className="count-pill">{rows.length}</span></div><div className="table-wrap"><table className="data-table platform-balance-table"><thead><tr><th>Organização</th><th>Conta principal</th><th>Disponível</th><th>Reservado</th><th>Status</th></tr></thead><tbody>{rows.map(({ organization, accounts, available, reserved, error }) => { const account = accounts.find((item) => item.is_default) ?? accounts[0]; return <tr key={organization.id}><td><strong>{organization.name}</strong><span className="platform-table-subline">{organization.slug}</span></td><td>{error ? 'Indisponível' : account?.name || '—'}</td><td>{available == null ? '—' : formatBRL(available)}</td><td>{reserved == null ? '—' : formatBRL(reserved)}</td><td>{account ? <StatusBadge status={account.status} /> : error ? 'Indisponível' : '—'}</td></tr> })}</tbody></table></div></section>
  </div>
}
