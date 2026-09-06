import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownLeft, ChevronRight, CircleAlert, Network, ReceiptText } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import type { ProviderConnection, Transaction } from '../../api/types'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useSession } from '../../app/session'
import { balanceMinor, formatBRL, formatDateTime, transactionLabel } from '../../lib/format'

function isPixReceipt(transaction: Transaction) {
  return transaction.direction === 'in' || transaction.kind === 'pix_in'
}

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
  const receipts = transactions.filter(isPixReceipt)
  const connections = connectionsQuery.data?.data ?? []
  const activeConnections = connections.filter((item) => item.status === 'active' && item.provider_code !== 'mock')
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  const recent = receipts.filter((item) => new Date(item.created_at).getTime() >= cutoff)
  const succeeded = recent.filter((item) => item.status === 'succeeded')
  const received = succeeded.reduce((sum, item) => sum + item.amount_minor, 0)
  const attention = recent.filter((item) => item.status === 'pending' || item.status === 'ambiguous')
  const decided = recent.filter((item) => item.status === 'succeeded' || item.status === 'failed')
  const successRate = decided.length ? Math.round((decided.filter((item) => item.status === 'succeeded').length / decided.length) * 100) : 0

  const balance = summary?.balance as unknown as Record<string, unknown> | undefined
  const available = balanceMinor(balance, 'available')
  const reserved = balanceMinor(balance, 'reserved')
  const recentReceipts = receipts.slice(0, 8)

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
              <Link className="button button-light" to="/transactions">Ver transações</Link>
              <Link className="button button-dark-quiet" to="/accounts">Ver contas</Link>
            </div>
          </div>
        </div>

        <Metric label="Recebido · 7 dias" value={formatBRL(received)} detail="Pix concluídos" icon={<ArrowDownLeft size={16} />} />
        <Metric label="Pagamentos · 7 dias" value={String(recent.length)} detail={`${succeeded.length} concluído(s)`} icon={<ReceiptText size={16} />} />
        <Metric label="Taxa de sucesso" value={`${successRate}%`} detail={`${attention.length} em acompanhamento`} />
      </section>

      {attention.length ? (
        <section className="attention-banner">
          <div className="attention-icon"><CircleAlert size={18} /></div>
          <div>
            <strong>{attention.length} pagamento(s) precisam de acompanhamento</strong>
            <span>Pendências e estados ambíguos devem ser reconciliados antes de considerar o recebimento concluído.</span>
          </div>
          <Link to="/transactions" className="button button-secondary">Revisar transações</Link>
        </section>
      ) : null}

      <section className="content-grid content-grid-main">
        <div className="panel">
          <div className="panel-header">
            <div><h2>Pagamentos recentes</h2><p>Últimos Pix recebidos nesta organização.</p></div>
            <Link to="/transactions" className="text-link">Ver todos <ChevronRight size={14} /></Link>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Transação</th><th>Status</th><th>Data</th><th className="align-right">Valor</th></tr></thead>
              <tbody>
                {recentReceipts.map((transaction) => (
                  <tr key={transaction.id}>
                    <td><div className="transaction-primary"><span className="direction-icon incoming"><ArrowDownLeft size={15} /></span><div><strong>{transactionLabel(transaction.kind)}</strong><span>{transaction.description || `ID ${transaction.id.slice(0, 10)}`}</span></div></div></td>
                    <td><StatusBadge status={transaction.status} /></td>
                    <td>{formatDateTime(transaction.created_at)}</td>
                    <td className="align-right money money-positive">+ {formatBRL(transaction.amount_minor)}</td>
                  </tr>
                ))}
                {!recentReceipts.length ? <tr><td colSpan={4}><div className="table-empty">Nenhum pagamento Pix recebido ainda.</div></td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="panel connection-summary">
          <div className="panel-header">
            <div><h2>Rotas de recebimento</h2><p>Infraestrutura real elegível para processar Pix de entrada.</p></div>
            <Network size={18} />
          </div>
          <div className="connection-health-value"><strong>{activeConnections.length}</strong><span>ativa(s)</span></div>
          <div className="connection-list-mini">
            {activeConnections.slice(0, 3).map((connection) => (
              <div key={connection.id}><div className="provider-avatar">{connection.label.charAt(0).toUpperCase()}</div><div><strong>{connection.label}</strong><span>Conexão operacional</span></div><StatusBadge status={connection.status} /></div>
            ))}
            {!activeConnections.length ? <div className="empty-inline">Nenhuma conexão real ativa.</div> : null}
          </div>
          <Link to="/connections" className="button button-secondary button-full">Gerenciar conexões</Link>
        </aside>
      </section>
    </div>
  )
}

function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon?: ReactNode }) {
  return <article className="metric-card"><div className="metric-label">{icon}<span>{label}</span></div><strong>{value}</strong><span className="metric-detail">{detail}</span></article>
}

function HomeSkeleton() {
  return <div className="page-stack" aria-busy="true"><div className="home-grid"><div className="skeleton skeleton-large" /><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div><div className="content-grid content-grid-main"><div className="skeleton skeleton-panel" /><div className="skeleton skeleton-panel" /></div></div>
}
