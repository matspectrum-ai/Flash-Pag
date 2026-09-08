import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Building2, CircleAlert, Plus, Search, ShieldCheck, X } from 'lucide-react'
import { api } from '../../api/client'
import { useSession } from '../../app/session'
import { balanceMinor, formatBRL, formatDateTime } from '../../lib/format'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { aggregateFinance, type ScopedTransaction } from './admin-finance'
import './admin-finance.css'

type PricingRule = {
  fixed_minor?: number
  percent_bps?: number
}

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function pricingLabel(value: Record<string, unknown> | undefined) {
  const current = (value?.current ?? null) as Record<string, unknown> | null
  const rules = (current?.rules ?? {}) as Record<string, PricingRule>
  const pix = rules.pix_in
  if (!pix) return '—'
  const parts: string[] = []
  if (pix.percent_bps) parts.push(`${(pix.percent_bps / 100).toFixed(2)}%`)
  if (pix.fixed_minor) parts.push(formatBRL(pix.fixed_minor))
  return parts.length ? parts.join(' + ') : 'R$ 0,00'
}

export function PlatformOrganizationsPage() {
  const { me } = useSession()
  const queryClient = useQueryClient()
  const platformAdmin = Boolean(me?.user.platform_admin)
  const previewReadOnly = import.meta.env.VITE_PREVIEW_READ_ONLY === 'true'
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')

  const tenantsQuery = useQuery({
    queryKey: ['platform-tenants'],
    queryFn: api.adminTenants,
    enabled: platformAdmin,
    staleTime: 30_000,
  })
  const merchants = tenantsQuery.data?.merchants ?? []
  const organizations = tenantsQuery.data?.organizations ?? []
  const merchantIndex = useMemo(() => new Map(merchants.map((merchant, index) => [merchant.id, index])), [merchants])

  const kycQueries = useQueries({
    queries: merchants.map((merchant) => ({
      queryKey: ['platform-org-kyc', merchant.id],
      queryFn: () => api.adminKYCDetail(merchant.id),
      staleTime: 30_000,
    })),
  })
  const pricingQueries = useQueries({
    queries: merchants.map((merchant) => ({
      queryKey: ['platform-org-pricing', merchant.id],
      queryFn: () => api.adminPricingDetail(merchant.id),
      staleTime: 30_000,
    })),
  })
  const summaryQueries = useQueries({
    queries: organizations.map((organization) => ({
      queryKey: ['platform-org-summary', organization.id],
      queryFn: () => api.summary(organization.id),
      staleTime: 15_000,
    })),
  })
  const connectionQueries = useQueries({
    queries: organizations.map((organization) => ({
      queryKey: ['platform-org-connections', organization.id],
      queryFn: () => api.list<{ provider_code: string; status: string }>('provider-connections', organization.id),
      staleTime: 15_000,
    })),
  })
  const transactionQueries = useQueries({
    queries: organizations.map((organization) => ({
      queryKey: ['platform-org-transactions', organization.id],
      queryFn: () => api.transactions(organization.id, 1000),
      staleTime: 15_000,
    })),
  })

  const createMutation = useMutation({
    mutationFn: () => api.adminProvisionOrganization({
      name: name.trim(),
      slug: slug.trim(),
    }),
    onSuccess: async () => {
      setCreateOpen(false)
      setName('')
      setSlug('')
      await queryClient.invalidateQueries({ queryKey: ['platform-tenants'] })
    },
  })

  const rows = useMemo(() => organizations.map((organization, index) => {
    const merchant = merchants.find((item) => item.id === organization.merchant_id)
    const merchantQueryIndex = merchant ? merchantIndex.get(merchant.id) : undefined
    const transactions = transactionQueries[index]?.data?.data ?? []
    const scoped: ScopedTransaction[] = merchant
      ? transactions.map((transaction) => ({ transaction, organization, merchant }))
      : []
    const finance = aggregateFinance(scoped, 30)
    const summaryQuery = summaryQueries[index]
    const connectionQuery = connectionQueries[index]
    const transactionQuery = transactionQueries[index]
    const summary = summaryQuery?.data
    const connections = connectionQuery?.data?.data ?? []
    const providers = [...new Set(connections.filter((item) => item.status === 'active').map((item) => item.provider_code))]
    const kyc = merchantQueryIndex == null ? undefined : kycQueries[merchantQueryIndex]
    const pricing = merchantQueryIndex == null ? undefined : pricingQueries[merchantQueryIndex]
    return {
      organization,
      finance,
      availableMinor: summary ? balanceMinor(summary.balance as Record<string, unknown>, 'available') : null,
      summaryError: Boolean(summaryQuery?.isError),
      connectionError: Boolean(connectionQuery?.isError),
      transactionError: Boolean(transactionQuery?.isError),
      providers,
      kycStatus: kyc?.isError ? 'unavailable' : kyc?.data?.profile.status ?? '—',
      pricing: pricing?.isError ? 'Indisponível' : pricingLabel(pricing?.data),
    }
  }), [organizations, merchants, merchantIndex, transactionQueries, summaryQueries, connectionQueries, kycQueries, pricingQueries])

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter(({ organization, providers }) => [organization.name, organization.slug, ...providers].some((value) => value.toLowerCase().includes(needle)))
  }, [rows, search])

  const active = organizations.filter((organization) => organization.status === 'active').length
  const kycPendingStatuses = new Set(['draft', 'submitted', 'under_review', 'needs_changes', 'rejected'])
  const kycPending = rows.filter((row) => kycPendingStatuses.has(row.kycStatus)).length
  const totalTPV = rows.filter((row) => !row.transactionError).reduce((sum, row) => sum + row.finance.metrics.tpvMinor, 0)
  const hasReadError = tenantsQuery.isError || summaryQueries.some((query) => query.isError) || connectionQueries.some((query) => query.isError) || transactionQueries.some((query) => query.isError) || kycQueries.some((query) => query.isError) || pricingQueries.some((query) => query.isError)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!previewReadOnly && name.trim() && slug.trim()) createMutation.mutate()
  }

  if (!platformAdmin) return <div className="error-state"><ShieldCheck size={22} /><strong>Acesso restrito à plataforma.</strong><span>Organizações globais são exclusivas da administração Flash Pag.</span></div>

  return (
    <div className="page-stack admin-finance-page">
      <section className="platform-section-heading">
        <div><span className="eyebrow">Operação</span><h2>Organizações</h2><p>Contas comerciais que usam a infraestrutura Flash Pag.</p></div>
        <button className="button button-primary" type="button" onClick={() => setCreateOpen(true)}><Plus size={15} />Nova organização</button>
      </section>

      {hasReadError ? <div className="attention-banner"><div className="attention-icon"><CircleAlert size={17} /></div><div><strong>Leitura parcial</strong><span>Alguns dados operacionais não puderam ser carregados. Campos indisponíveis não são tratados como zero.</span></div></div> : null}

      <section className="platform-admin-kpis">
        <article className="metric-card"><div className="metric-label"><Building2 size={16} /><span>Organizações</span></div><strong>{organizations.length}</strong><span className="metric-detail">{active} ativas</span></article>
        <article className="metric-card"><div className="metric-label"><ShieldCheck size={16} /><span>KYC exige atenção</span></div><strong>{kycPending}</strong><span className="metric-detail">Exigem acompanhamento</span></article>
        <article className="metric-card"><div className="metric-label"><Building2 size={16} /><span>TPV · 30 dias</span></div><strong>{formatBRL(totalTPV)}</strong><span className="metric-detail">Pix recebido concluído</span></article>
      </section>

      <section className="panel">
        <div className="platform-list-toolbar">
          <label className="platform-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar organização, slug ou processadora" /></label>
          <span className="count-pill">{filteredRows.length}</span>
        </div>
        <div className="table-wrap">
          <table className="data-table platform-organization-table">
            <thead><tr><th>Organização</th><th>Status</th><th>KYC</th><th>Processadora</th><th>TPV 30d</th><th>Saldo</th><th>Taxa Pix</th><th>Criada em</th></tr></thead>
            <tbody>
              {filteredRows.map(({ organization, finance, availableMinor, summaryError, connectionError, transactionError, providers, kycStatus, pricing }) => (
                <tr key={organization.id}>
                  <td><Link className="platform-table-link" to={`/platform/organizations/${organization.id}`}><strong>{organization.name}</strong><span>{organization.slug}</span></Link></td>
                  <td><StatusBadge status={organization.status} /></td>
                  <td>{kycStatus === 'unavailable' ? 'Indisponível' : <StatusBadge status={kycStatus} />}</td>
                  <td>{connectionError ? 'Indisponível' : providers.length ? providers.join(', ') : '—'}</td>
                  <td>{transactionError ? 'Indisponível' : formatBRL(finance.metrics.tpvMinor)}</td>
                  <td>{summaryError ? 'Indisponível' : availableMinor == null ? '—' : formatBRL(availableMinor)}</td>
                  <td>{pricing}</td>
                  <td>{organization.created_at ? formatDateTime(organization.created_at) : '—'}</td>
                </tr>
              ))}
              {!filteredRows.length && !tenantsQuery.isLoading ? <tr><td colSpan={8}><div className="empty-state compact-empty"><Building2 size={22} /><strong>Nenhuma organização encontrada</strong><span>Ajuste a busca ou provisione uma nova conta comercial.</span></div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {createOpen ? (
        <div className="drawer-backdrop" role="presentation" onMouseDown={() => setCreateOpen(false)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-label="Nova organização" onMouseDown={(event) => event.stopPropagation()}>
            <div className="drawer-header"><div><span className="eyebrow">Provisionamento</span><h2>Nova organização</h2></div><button className="icon-button" type="button" onClick={() => setCreateOpen(false)}><X size={18} /></button></div>
            <form className="financial-form drawer-form" onSubmit={submit}>
              <label className="field"><span>Nome da organização</span><input value={name} onChange={(event) => { const value = event.target.value; setName(value); setSlug(slugify(value)) }} placeholder="Empresa do cliente" autoFocus /></label>
              <label className="field"><span>Slug</span><input value={slug} onChange={(event) => setSlug(slugify(event.target.value))} placeholder="empresa-do-cliente" /></label>
              <div className="inline-info">A Flash Pag provisiona automaticamente o KYC inicial, o pricing padrão e a conta BRL principal. Proprietário e equipe permanecem como uma etapa separada de gestão de acessos.</div>
              {previewReadOnly ? <div className="inline-info">Provisionamento bloqueado neste preview somente leitura.</div> : null}
              {createMutation.isError ? <div className="inline-error">{createMutation.error instanceof Error ? createMutation.error.message : 'Falha ao provisionar organização.'}</div> : null}
              <button className="button button-primary button-full" type="submit" disabled={previewReadOnly || createMutation.isPending || !name.trim() || !slug.trim()}>{previewReadOnly ? 'Bloqueado no preview' : createMutation.isPending ? 'Criando…' : 'Criar organização'}</button>
            </form>
          </aside>
        </div>
      ) : null}
    </div>
  )
}
