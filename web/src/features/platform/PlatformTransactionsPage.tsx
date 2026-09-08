import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Activity, CircleAlert, CircleDollarSign, Clock3, ShieldCheck } from 'lucide-react'
import { api } from '../../api/client'
import { useSession } from '../../app/session'
import { formatBRL, formatDateTime } from '../../lib/format'
import { StatusBadge } from '../../components/ui/StatusBadge'
import './admin-finance.css'

export function PlatformTransactionsPage() {
  const { me } = useSession()
  const platformAdmin = Boolean(me?.user.platform_admin)
  const tenantsQuery = useQuery({ queryKey: ['platform-tenants'], queryFn: api.adminTenants, enabled: platformAdmin, staleTime: 30_000 })
  const organizations = tenantsQuery.data?.organizations ?? []
  const queries = useQueries({ queries: organizations.map((organization) => ({ queryKey: ['platform-transactions', organization.id], queryFn: () => api.transactions(organization.id, 1000), staleTime: 15_000 })) })
  const rows = useMemo(() => organizations.flatMap((organization, index) => (queries[index]?.data?.data ?? []).map((transaction) => ({ organization, transaction }))).sort((a, b) => new Date(b.transaction.created_at).getTime() - new Date(a.transaction.created_at).getTime()), [organizations, queries])
  const pix = rows.filter((row) => row.transaction.kind === 'pix_in')
  const succeeded = pix.filter((row) => row.transaction.status === 'succeeded')
  const pending = pix.filter((row) => row.transaction.status === 'pending').length
  const failed = pix.filter((row) => row.transaction.status === 'failed').length
  const revenue = succeeded.reduce((sum, row) => sum + (row.transaction.fee_minor ?? 0), 0)
  const hasError = tenantsQuery.isError || queries.some((query) => query.isError)
  const limited = queries.some((query) => (query.data?.data.length ?? 0) >= 1000)

  if (!platformAdmin) return <div className="error-state"><ShieldCheck size={22} /><strong>Acesso restrito à plataforma.</strong><span>Transações globais são exclusivas da administração Flash Pag.</span></div>
  return <div className="page-stack admin-finance-page">
    <section className="platform-section-heading"><div><span className="eyebrow">Operação</span><h2>Transações</h2><p>Auditoria global de Pix recebido em todas as organizações.</p></div></section>
    {hasError || limited ? <div className="attention-banner"><div className="attention-icon"><CircleAlert size={17} /></div><div><strong>{hasError ? 'Leitura parcial' : 'Janela limitada'}</strong><span>{hasError ? 'Uma ou mais organizações não responderam.' : 'Ao menos uma organização atingiu 1.000 transações; totais não representam fechamento.'}</span></div></div> : null}
    <section className="platform-admin-kpis four"><article className="metric-card"><div className="metric-label"><Activity size={16} /><span>Pix exibidos</span></div><strong>{pix.length}</strong><span className="metric-detail">Somente pix_in</span></article><article className="metric-card"><div className="metric-label"><Activity size={16} /><span>Concluídos</span></div><strong>{succeeded.length}</strong><span className="metric-detail">Receita realizada</span></article><article className="metric-card"><div className="metric-label"><Clock3 size={16} /><span>Pendente / falhou</span></div><strong>{pending} / {failed}</strong><span className="metric-detail">Não realizam receita</span></article><article className="metric-card"><div className="metric-label"><CircleDollarSign size={16} /><span>Receita realizada</span></div><strong>{formatBRL(revenue)}</strong><span className="metric-detail">fee_minor somente em sucesso</span></article></section>
    <section className="panel"><div className="panel-header"><div><h2>Transações globais</h2><p>Ordenadas da mais recente para a mais antiga.</p></div><span className="count-pill">{pix.length}</span></div><div className="table-wrap"><table className="data-table admin-finance-table"><thead><tr><th>Data</th><th>Organização</th><th>Processadora</th><th>Status</th><th>Valor</th><th>Receita</th><th>Custo provider</th></tr></thead><tbody>{pix.map(({ organization, transaction }) => <tr key={transaction.id}><td>{formatDateTime(transaction.created_at)}</td><td><strong>{organization.name}</strong><span>{organization.slug}</span></td><td>{transaction.provider_code || '—'}</td><td><StatusBadge status={transaction.status} /></td><td>{formatBRL(transaction.amount_minor)}</td><td>{transaction.status === 'succeeded' ? formatBRL(transaction.fee_minor ?? 0) : '—'}</td><td>{typeof transaction.provider_cost_minor === 'number' ? formatBRL(transaction.provider_cost_minor) : '—'}</td></tr>)}</tbody></table></div></section>
  </div>
}
