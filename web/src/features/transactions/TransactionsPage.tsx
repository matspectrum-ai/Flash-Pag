import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownLeft,
  ArrowUpRight,
  CircleAlert,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { api } from '../../api/client'
import type { Transaction } from '../../api/types'
import { useSession } from '../../app/session'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { formatBRL, formatDateTime, transactionLabel } from '../../lib/format'

type DirectionFilter = 'all' | 'in' | 'out'

function isIncoming(transaction: Transaction) {
  return transaction.direction === 'in' || transaction.kind === 'pix_in'
}

export function TransactionsPage() {
  const { organizationId } = useSession()
  const queryClient = useQueryClient()
  const previewReadOnly = import.meta.env.VITE_PREVIEW_READ_ONLY === 'true'
  const [direction, setDirection] = useState<DirectionFilter>('all')
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Transaction | null>(null)

  const transactionsQuery = useQuery({
    queryKey: ['transactions', organizationId],
    queryFn: () => api.list<Transaction>('transactions', organizationId!),
    enabled: Boolean(organizationId),
  })

  const reconcileMutation = useMutation({
    mutationFn: (transaction: Transaction) => api.reconcileTransaction(transaction.id, organizationId!),
    onSuccess: (fresh) => {
      setSelected(fresh)
      void queryClient.invalidateQueries({ queryKey: ['transactions', organizationId] })
      void queryClient.invalidateQueries({ queryKey: ['summary', organizationId] })
    },
  })

  const transactions = transactionsQuery.data?.data ?? []
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return transactions.filter((transaction) => {
      const incoming = isIncoming(transaction)
      if (direction === 'in' && !incoming) return false
      if (direction === 'out' && incoming) return false
      if (status !== 'all' && transaction.status !== status) return false
      if (!needle) return true
      return [
        transaction.id,
        transaction.description,
        transaction.pix_key,
        transaction.provider_external_id,
        transaction.kind,
      ].some((value) => value?.toLowerCase().includes(needle))
    })
  }, [transactions, direction, status, search])

  if (!organizationId) {
    return <div className="empty-state"><strong>Selecione uma organização</strong><span>As transações são isoladas por organização.</span></div>
  }

  if (transactionsQuery.isLoading) {
    return <div className="skeleton skeleton-panel" aria-busy="true" />
  }

  if (transactionsQuery.isError) {
    return (
      <div className="error-state">
        <CircleAlert size={22} />
        <strong>Não foi possível carregar as transações.</strong>
        <span>Nenhuma operação financeira foi repetida.</span>
        <button className="button button-secondary" onClick={() => void transactionsQuery.refetch()}>Tentar novamente</button>
      </div>
    )
  }

  return (
    <div className="page-stack">
      <section className="toolbar">
        <div className="segmented-control" aria-label="Direção da transação">
          {([
            ['all', 'Todas'],
            ['in', 'Entradas'],
            ['out', 'Saídas'],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" className={direction === value ? 'active' : ''} onClick={() => setDirection(value)}>
              {label}
            </button>
          ))}
        </div>

        <div className="toolbar-right">
          <label className="search-field">
            <Search size={15} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por ID, chave ou descrição" />
          </label>
          <select className="compact-select" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrar por status">
            <option value="all">Todos os status</option>
            <option value="succeeded">Concluídas</option>
            <option value="pending">Pendentes</option>
            <option value="ambiguous">Ambíguas</option>
            <option value="failed">Falhas</option>
          </select>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Movimentações</h2>
            <p>{filtered.length} de {transactions.length} transações</p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table interactive-table">
            <thead>
              <tr>
                <th>Transação</th>
                <th>Status</th>
                <th>Data</th>
                <th className="align-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((transaction) => {
                const incoming = isIncoming(transaction)
                return (
                  <tr key={transaction.id} onClick={() => setSelected(transaction)}>
                    <td>
                      <div className="transaction-primary">
                        <span className={`direction-icon ${incoming ? 'incoming' : 'outgoing'}`}>
                          {incoming ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
                        </span>
                        <div>
                          <strong>{transactionLabel(transaction.kind)}</strong>
                          <span>{transaction.description || `ID ${transaction.id.slice(0, 10)}`}</span>
                        </div>
                      </div>
                    </td>
                    <td><StatusBadge status={transaction.status} /></td>
                    <td>{formatDateTime(transaction.created_at)}</td>
                    <td className={`align-right money ${incoming ? 'money-positive' : ''}`}>
                      {incoming ? '+' : '-'} {formatBRL(transaction.amount_minor)}
                    </td>
                  </tr>
                )
              })}
              {!filtered.length ? <tr><td colSpan={4}><div className="table-empty">Nenhuma transação corresponde aos filtros.</div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {selected ? (
        <div className="drawer-backdrop" role="presentation" onMouseDown={() => setSelected(null)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-label="Detalhes da transação" onMouseDown={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <span className="eyebrow">Transação</span>
                <h2>{transactionLabel(selected.kind)}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setSelected(null)} aria-label="Fechar detalhes"><X size={18} /></button>
            </div>

            <div className="drawer-amount">
              <strong>{isIncoming(selected) ? '+' : '-'} {formatBRL(selected.amount_minor)}</strong>
              <StatusBadge status={selected.status} />
            </div>

            {(selected.status === 'pending' || selected.status === 'ambiguous') ? (
              <div className="drawer-callout warning-callout">
                <CircleAlert size={17} />
                <div>
                  <strong>{selected.status === 'ambiguous' ? 'Resultado ainda não confirmado' : 'Operação em processamento'}</strong>
                  <span>{previewReadOnly ? 'A reconciliação está desabilitada neste preview para não alterar o ledger real.' : 'A reconciliação consulta o provider sem criar uma segunda movimentação.'}</span>
                </div>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={reconcileMutation.isPending || previewReadOnly}
                  onClick={() => reconcileMutation.mutate(selected)}
                >
                  <RefreshCw size={14} className={reconcileMutation.isPending ? 'spin' : ''} />
                  {previewReadOnly ? 'Indisponível no preview' : reconcileMutation.isPending ? 'Consultando…' : 'Reconciliar'}
                </button>
              </div>
            ) : null}

            {reconcileMutation.isError ? (
              <div className="inline-error">{reconcileMutation.error instanceof Error ? reconcileMutation.error.message : 'Não foi possível reconciliar.'}</div>
            ) : null}

            <dl className="detail-list">
              <div><dt>ID</dt><dd className="mono">{selected.id}</dd></div>
              <div><dt>Data</dt><dd>{formatDateTime(selected.created_at)}</dd></div>
              <div><dt>Descrição</dt><dd>{selected.description || '—'}</dd></div>
              <div><dt>Chave Pix</dt><dd>{selected.pix_key || '—'}</dd></div>
              <div><dt>Moeda</dt><dd>{selected.currency}</dd></div>
              {selected.failure_message ? <div><dt>Falha</dt><dd className="danger-text">{selected.failure_message}</dd></div> : null}
            </dl>

            <details className="technical-details">
              <summary>Detalhes técnicos</summary>
              <dl className="detail-list compact">
                <div><dt>Provider</dt><dd>{selected.provider_code || '—'}</dd></div>
                <div><dt>ID externo</dt><dd className="mono">{selected.provider_external_id || '—'}</dd></div>
                <div><dt>Conexão</dt><dd className="mono">{selected.provider_connection_id || '—'}</dd></div>
                <div><dt>Conta</dt><dd className="mono">{selected.account_id || '—'}</dd></div>
              </dl>
            </details>
          </aside>
        </div>
      ) : null}
    </div>
  )
}
