import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownLeft,
  CircleAlert,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { api } from '../../api/client'
import type { Transaction } from '../../api/types'
import { useSession } from '../../app/session'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { formatBRL, formatDateTime } from '../../lib/format'

function isPixReceipt(transaction: Transaction) {
  return transaction.direction === 'in' || transaction.kind === 'pix_in'
}

export function TransactionsPage() {
  const { organizationId } = useSession()
  const queryClient = useQueryClient()
  const previewReadOnly = import.meta.env.VITE_PREVIEW_READ_ONLY === 'true'
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

  const receipts = useMemo(
    () => (transactionsQuery.data?.data ?? []).filter(isPixReceipt),
    [transactionsQuery.data],
  )

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return receipts.filter((transaction) => {
      if (status !== 'all' && transaction.status !== status) return false
      if (!needle) return true
      return [
        transaction.id,
        transaction.customer_id,
        transaction.description,
        transaction.provider_external_id,
      ].some((value) => value?.toLowerCase().includes(needle))
    })
  }, [receipts, status, search])

  if (!organizationId) {
    return <div className="empty-state"><strong>Selecione uma organização</strong><span>Os pagamentos são isolados por organização.</span></div>
  }

  if (transactionsQuery.isLoading) {
    return <div className="skeleton skeleton-panel" aria-busy="true" />
  }

  if (transactionsQuery.isError) {
    return (
      <div className="error-state">
        <CircleAlert size={22} />
        <strong>Não foi possível carregar os pagamentos Pix.</strong>
        <span>Nenhuma operação financeira foi repetida.</span>
        <button className="button button-secondary" onClick={() => void transactionsQuery.refetch()}>Tentar novamente</button>
      </div>
    )
  }

  return (
    <div className="page-stack">
      <section className="toolbar">
        <div className="toolbar-copy">
          <strong>Pagamentos Pix</strong>
          <span>Recebimentos dos clientes do merchant nesta organização.</span>
        </div>

        <div className="toolbar-right">
          <label className="search-field">
            <Search size={15} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por ID, cliente ou descrição" />
          </label>
          <select className="compact-select" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrar por status">
            <option value="all">Todos os status</option>
            <option value="succeeded">Concluídos</option>
            <option value="pending">Pendentes</option>
            <option value="ambiguous">Ambíguos</option>
            <option value="failed">Falharam</option>
          </select>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Transações</h2>
            <p>{filtered.length} de {receipts.length} pagamentos Pix</p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table interactive-table">
            <thead>
              <tr>
                <th>Pagamento</th>
                <th>Status</th>
                <th>Data</th>
                <th className="align-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((transaction) => (
                <tr key={transaction.id} onClick={() => setSelected(transaction)}>
                  <td>
                    <div className="transaction-primary">
                      <span className="direction-icon incoming"><ArrowDownLeft size={15} /></span>
                      <div>
                        <strong>Pix recebido</strong>
                        <span>{transaction.description || `ID ${transaction.id.slice(0, 10)}`}</span>
                      </div>
                    </div>
                  </td>
                  <td><StatusBadge status={transaction.status} /></td>
                  <td>{formatDateTime(transaction.created_at)}</td>
                  <td className="align-right money money-positive">+ {formatBRL(transaction.amount_minor)}</td>
                </tr>
              ))}
              {!filtered.length ? <tr><td colSpan={4}><div className="table-empty">Nenhum pagamento Pix corresponde aos filtros.</div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {selected ? (
        <div className="drawer-backdrop" role="presentation" onMouseDown={() => setSelected(null)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-label="Detalhes do pagamento" onMouseDown={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <span className="eyebrow">Transação</span>
                <h2>Pix recebido</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setSelected(null)} aria-label="Fechar detalhes"><X size={18} /></button>
            </div>

            <div className="drawer-amount">
              <strong>+ {formatBRL(selected.amount_minor)}</strong>
              <StatusBadge status={selected.status} />
            </div>

            {(selected.status === 'pending' || selected.status === 'ambiguous') ? (
              <div className="drawer-callout warning-callout">
                <CircleAlert size={17} />
                <div>
                  <strong>{selected.status === 'ambiguous' ? 'Recebimento ainda não confirmado' : 'Pagamento em processamento'}</strong>
                  <span>{previewReadOnly ? 'A reconciliação está desabilitada neste preview para não alterar o ledger real.' : 'A reconciliação consulta o provider sem criar uma nova cobrança ou movimentação.'}</span>
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
              <div><dt>Cliente</dt><dd className="mono">{selected.customer_id || '—'}</dd></div>
              <div><dt>Descrição</dt><dd>{selected.description || '—'}</dd></div>
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
