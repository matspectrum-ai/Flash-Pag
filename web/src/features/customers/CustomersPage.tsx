import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Mail, Plus, Search, UserRound, X } from 'lucide-react'
import { api } from '../../api/client'
import type { Customer, Transaction } from '../../api/types'
import { useSession } from '../../app/session'
import { formatBRL, formatDateTime, maskDocument } from '../../lib/format'

function isPixReceipt(transaction: Transaction) {
  return transaction.direction === 'in' || transaction.kind === 'pix_in'
}

export function CustomersPage() {
  const { organizationId } = useSession()
  const queryClient = useQueryClient()
  const previewReadOnly = import.meta.env.VITE_PREVIEW_READ_ONLY === 'true'
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Customer | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [document, setDocument] = useState('')
  const [externalId, setExternalId] = useState('')
  const [phone, setPhone] = useState('')

  const accessQuery = useQuery({
    queryKey: ['access', organizationId],
    queryFn: () => api.access(organizationId!),
    enabled: Boolean(organizationId),
  })
  const customersQuery = useQuery({
    queryKey: ['customers', organizationId],
    queryFn: () => api.list<Customer>('customers', organizationId!),
    enabled: Boolean(organizationId),
  })
  const transactionsQuery = useQuery({
    queryKey: ['transactions', organizationId],
    queryFn: () => api.list<Transaction>('transactions', organizationId!),
    enabled: Boolean(organizationId),
  })

  const createMutation = useMutation({
    mutationFn: () => api.createCustomer(organizationId!, {
      name: name.trim() || undefined,
      email: email.trim() || undefined,
      document: document.replace(/\D/g, '') || undefined,
      external_id: externalId.trim() || undefined,
      metadata: phone.trim() ? { phone: phone.trim() } : undefined,
    }),
    onSuccess: (customer) => {
      void queryClient.invalidateQueries({ queryKey: ['customers', organizationId] })
      setCreating(false)
      setSelected(customer)
      setName('')
      setEmail('')
      setDocument('')
      setExternalId('')
      setPhone('')
    },
  })

  const customers = customersQuery.data?.data ?? []
  const receipts = (transactionsQuery.data?.data ?? []).filter(isPixReceipt)
  const metrics = useMemo(() => {
    const result = new Map<string, { count: number; total: number; last?: string }>()
    for (const transaction of receipts) {
      if (!transaction.customer_id) continue
      const current = result.get(transaction.customer_id) ?? { count: 0, total: 0, last: undefined }
      current.count += 1
      if (transaction.status === 'succeeded') current.total += transaction.amount_minor
      if (!current.last || transaction.created_at > current.last) current.last = transaction.created_at
      result.set(transaction.customer_id, current)
    }
    return result
  }, [receipts])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return customers
    return customers.filter((customer) => [customer.name, customer.email, customer.document, customer.external_id, customer.id]
      .some((value) => value?.toLowerCase().includes(needle)))
  }, [customers, search])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!previewReadOnly && accessQuery.data?.can_create_customer) createMutation.mutate()
  }

  if (!organizationId) return <div className="empty-state"><strong>Selecione uma organização</strong><span>Clientes pertencem sempre a uma organização específica.</span></div>
  if (customersQuery.isLoading || transactionsQuery.isLoading || accessQuery.isLoading) return <div className="skeleton skeleton-panel" aria-busy="true" />
  if (customersQuery.isError || transactionsQuery.isError || accessQuery.isError) {
    return <div className="error-state"><CircleAlert size={22} /><strong>Não foi possível carregar os clientes.</strong><span>O contexto da organização não foi alterado.</span></div>
  }

  return (
    <div className="page-stack">
      <section className="toolbar">
        <div className="toolbar-copy"><strong>Base de clientes</strong><span>Pagadores cadastrados somente nesta organização.</span></div>
        <div className="toolbar-right customer-toolbar-actions">
          <label className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente" /></label>
          <button className="button button-primary" type="button" disabled={!accessQuery.data?.can_create_customer} onClick={() => setCreating(true)}><Plus size={15} />Novo cliente</button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Clientes</h2><p>{filtered.length} de {customers.length} clientes</p></div></div>
        <div className="table-wrap">
          <table className="data-table customers-table">
            <thead><tr><th>Cliente</th><th>Documento</th><th>Pagamentos</th><th>Recebido</th><th>Último pagamento</th></tr></thead>
            <tbody>
              {filtered.map((customer) => {
                const metric = metrics.get(customer.id)
                return (
                  <tr key={customer.id} onClick={() => setSelected(customer)}>
                    <td><div className="customer-identity"><span className="customer-avatar"><UserRound size={15} /></span><div><strong>{customer.name || 'Cliente sem nome'}</strong><span>{customer.email || customer.external_id || `ID ${customer.id.slice(0, 8)}`}</span></div></div></td>
                    <td className="mono subtle-text">{maskDocument(customer.document)}</td>
                    <td>{metric?.count ?? 0}</td>
                    <td className="money money-positive">{formatBRL(metric?.total ?? 0)}</td>
                    <td>{formatDateTime(metric?.last)}</td>
                  </tr>
                )
              })}
              {!filtered.length ? <tr><td colSpan={5}><div className="table-empty">Nenhum cliente encontrado nesta organização.</div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {selected ? (
        <div className="drawer-backdrop" role="presentation" onMouseDown={() => setSelected(null)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-label="Detalhes do cliente" onMouseDown={(event) => event.stopPropagation()}>
            <div className="drawer-header"><div><span className="eyebrow">Cliente</span><h2>{selected.name || 'Cliente sem nome'}</h2></div><button className="icon-button" type="button" onClick={() => setSelected(null)} aria-label="Fechar"><X size={18} /></button></div>
            <div className="customer-detail-hero"><span className="customer-detail-avatar"><UserRound size={24} /></span><div><strong>{formatBRL(metrics.get(selected.id)?.total ?? 0)}</strong><span>{metrics.get(selected.id)?.count ?? 0} pagamento(s) Pix associado(s)</span></div></div>
            <dl className="detail-list">
              <div><dt>E-mail</dt><dd>{selected.email || '—'}</dd></div>
              <div><dt>Documento</dt><dd className="mono">{maskDocument(selected.document)}</dd></div>
              <div><dt>Telefone</dt><dd>{typeof selected.metadata?.phone === 'string' ? selected.metadata.phone : '—'}</dd></div>
              <div><dt>ID externo</dt><dd className="mono">{selected.external_id || '—'}</dd></div>
              <div><dt>ID Flash Pag</dt><dd className="mono">{selected.id}</dd></div>
              <div><dt>Criado</dt><dd>{formatDateTime(selected.created_at)}</dd></div>
            </dl>
          </aside>
        </div>
      ) : null}

      {creating ? (
        <div className="drawer-backdrop" role="presentation" onMouseDown={() => setCreating(false)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-label="Novo cliente" onMouseDown={(event) => event.stopPropagation()}>
            <div className="drawer-header"><div><span className="eyebrow">Organização atual</span><h2>Novo cliente</h2></div><button className="icon-button" type="button" onClick={() => setCreating(false)} aria-label="Fechar"><X size={18} /></button></div>
            <form className="financial-form drawer-form" onSubmit={submit}>
              <label className="field"><span>Nome</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome do pagador" autoFocus /></label>
              <label className="field"><span>E-mail</span><div className="input-with-icon"><Mail size={15} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="cliente@empresa.com" /></div></label>
              <label className="field"><span>CPF ou CNPJ</span><input value={document} onChange={(event) => setDocument(event.target.value)} inputMode="numeric" placeholder="Somente números ou formatado" /></label>
              <label className="field"><span>Telefone <em>opcional</em></span><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+55 93 99999-9999" /></label>
              <label className="field"><span>ID externo <em>opcional</em></span><input value={externalId} onChange={(event) => setExternalId(event.target.value)} placeholder="ID do seu sistema" /></label>
              {previewReadOnly ? <div className="inline-info">No preview você pode revisar o formulário, mas a criação está bloqueada.</div> : null}
              {createMutation.isError ? <div className="inline-error">{createMutation.error instanceof Error ? createMutation.error.message : 'Não foi possível criar o cliente.'}</div> : null}
              <button className="button button-primary button-full" type="submit" disabled={previewReadOnly || createMutation.isPending || !accessQuery.data?.can_create_customer}>{previewReadOnly ? 'Bloqueado no preview' : createMutation.isPending ? 'Criando…' : 'Criar cliente'}</button>
            </form>
          </aside>
        </div>
      ) : null}
    </div>
  )
}
