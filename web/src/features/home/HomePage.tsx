import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, ChevronRight, CircleAlert, Network } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import type { ProviderConnection, Transaction } from '../../api/types'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useSession } from '../../app/session'
import { balanceMinor, formatBRL, formatDateTime, transactionLabel } from '../../lib/format'

export function HomePage() {
  const { organizationId } = useSession()
  const enabled = Boolean(organizationId)

  const summaryQuery = useQuery({
    queryKey: ['summary', organizationId],
    queryFn: () => api.summary(organizationId!),
    enabled,
  })

  const transactionsQuery = useQuery({
    queryKey: ['transactions', organizationId],
    queryFn: () => api.list<Transaction>('transactions', organizationId!),
    enabled,
  })

  const connectionsQuery = useQuery({
    queryKey: ['provider-connections', organizationId],
    queryFn: () => api.list<ProviderConnection>('provider-connections', organizationId!),
    enabled,
  })

  if (!organizationId) {
    return <div className="empty-state"><strong>Nenhuma organização disponível</strong><span>Seu usuário ainda não possui um contexto financeiro acessível.</span></div>
  }

  if (summaryQuery.isLoading || transactionsQuery.isLoading || connectionsQuery.isLoading) {
    return <HomeSkeleton />
  }

  if (summaryQuery.isError) {
    return (
      <div className="error-state">
        <CircleAlert size={22} />
        <div><strong>Não foi possível carregar sua visão financeira.</strong><span>Tente novamente sem repetir nenhuma operação financeira.</span></div>
        <button className="button button-secondary" onClick={() => void summaryQuery.refetch()}>Tentar novamente</button>
      </div>
    )
  }

  const summary = summaryQuery.data
  const transactions = transactionsQuery.data?.data ?? []
  const connections = connectionsQuery.data?.data ?? []
  const activeConnections = connections.filter((item) => item.status === 'active')

  const metrics = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    const recent = transactions.filter((item) => new Date(item.created_at).getTime() >= cutoff)
    const succeeded = recent.filter((item) => item.status === 'succeeded')
    const received = succeeded.filter((item) => item.direction === 'in' || item.kind === 'pix_in').reduce((sum, item) => sum + item.amount_minor, 0)
    const sent = succeeded.filter((item) => item.direction === 'out' || item.kind === 'pix_out' || item.kind === 'transfer' || item.kind === 'withdrawal').reduce((sum, item) => sum + item.amount_minor, 0)
    const attention = recent.filter((item) => item.status === 'pending' || item.status === 'ambiguous')
    const decided = recent.filter((item) => item.status === 'succeeded' || item.status === 'failed')
    const successRate = decided.length ? Math.round((decided.filter((item) => item.status === 'succeeded').length / decided.length) * 100) : 0
    return { received, sent, attention, successRate }
  }, [transactions])

  const balance = summary?.balance as unknown as Record<string, unknown> | undefined
  const available = balanceMinor(balance, 'available')
  const reserved = balanceMinor(balance, 'reserved')

  return (
    <div className="page-stack">
      <section className="home-grid">
        <div className="balance-card">
          <div className="balance-card-top">
            <span>Saldo disponível</span>
            <span className="balance-account">{summary?.account?.name || 'Conta principal'}</span>
          </div>
          <strong className="balance-amount">{formatBRL(available)}</strong>
          <div className="balance-card-bottom">
            <div><span>Reservado</span><strong>{formatBRL(reserved)}</strong></div>
            <div className="balance-actions">
              <Link className="button button-light" to="/transfers">Transferir</Link>
              <Link className="button button-dark-quiet" to="/accounts">Ver contas</Link>
            </div>
          </div>
        </div>

        <Metric label="Recebido · 7 dias" value={formatBRL(metrics.received)} detail="Operações concluídas" icon={<ArrowDownLeft size={16} />} />
        <Metric label="Enviado · 7 dias" value={formatBRL(metrics.sent)} detail="Operações concluídas" icon={<ArrowUpRight size={16} />} />
        <Metric label="Taxa de sucesso" value={`${metrics.successRate}%`} detail={`${metrics.attention.length} em acompanhamento`} />
      </section>

      {metrics.attention.length ? (
        <section className="attention-banner">
          <div className="attention-icon"><CircleAlert size={18} /></div>
          <div>
            <strong>{metrics.attention.length} operação(ões) precisam de acompanhamento</strong>
            <span>Pendências e estados ambíguos devem ser investigados antes de qualquer nova tentativa.</span>
          </div>
          <Link to="/transactions" className="button button-secondary">Revisar transações</Link>
        </section>
      ) : null}

      <section className="content-grid content-grid-main">
        <div className="panel">
          <div className="panel-header">
            <div><h2>Movimentação recente</h2><p>Últimas operações da organização.</p></div>
            <Link to="/transactions" className="text-link">Ver todas <ChevronRight size={14} /></Link>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Transação</th><th>Status</th><th>Data</th><th className="align-right">Valor</th></tr></thead>
              <tbody>
                {(summary?.recent_transactions ?? []).map((transaction) => {
                  const incoming = transaction.direction === 'in' || transaction.kind === 'pix_in'
                  return (
                    <tr key={transaction.id}>
                      <td><div className="transaction-primary"><span className={`direction-icon ${incoming ? 'incoming' : 'outgoing'}`}>{incoming ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}</span><div><strong>{transactionLabel(transaction.kind)}</strong><span>{transaction.provider_code || 'Flash Pag'} · {transaction.id.slice(0, 8)}</span></div></div></td>
                      <td><StatusBadge status={transaction.status} /></td>
                      <td>{formatDateTime(transaction.created_at)}</td>
                      <td className={`align-right money ${incoming ? 'money-positive' : ''}`}>{incoming ? '+' : '-'} {formatBRL(transaction.amount_minor)}</td>
                    </tr>
                  )
                })}
                {!summary?.recent_transactions?.length ? <tr><td colSpan={4}><div className="table-empty">Nenhuma movimentação ainda.</div></td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="panel connection-summary">
          <div className="panel-header">
            <div><h2>Conexões</h2><p>Infraestrutura ativa para processar Pix.</p></div>
            <Network size={18} />
          </div>
          <div className="connection-health-value"><strong>{activeConnections.length}</strong><span>ativa(s)</span></div>
          <div className="connection-list-mini">
            {activeConnections.slice(0, 3).map((connection) => (
              <div key={connection.id}><div className="provider-avatar">{connection.provider_code.charAt(0).toUpperCase()}</div><div><strong>{connection.label}</strong><span>{connection.provider_code}</span></div><StatusBadge status={connection.status} /></div>
            ))}
            {!activeConnections.length ? <div className="empty-inline">Nenhuma conexão ativa.</div> : null}
          </div>
          <Link to="/connections" className="button button-secondary button-full">Gerenciar conexões</Link>
        </aside>
      </section>
    </div>
  )
}

function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon?: React.ReactNode }) {
  return <article className="metric-card"><div className="metric-label">{icon}<span>{label}</span></div><strong>{value}</strong><span className="metric-detail">{detail}</span></article>
}

function HomeSkeleton() {
  return <div className="page-stack" aria-busy="true"><div className="home-grid"><div className="skeleton skeleton-large" /><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div><div className="content-grid content-grid-main"><div className="skeleton skeleton-panel" /><div className="skeleton skeleton-panel" /></div></div>
}
