import { useMemo, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Building2, CircleAlert, Layers3, Plus, ShieldCheck, Store, X } from 'lucide-react'
import { api } from '../../api/client'
import { useSession } from '../../app/session'
import { formatDateTime } from '../../lib/format'
import { StatusBadge } from '../../components/ui/StatusBadge'

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function PlatformPage() {
  const { me, refreshMe } = useSession()
  const previewReadOnly = import.meta.env.VITE_PREVIEW_READ_ONLY === 'true'
  const [merchantOpen, setMerchantOpen] = useState(false)
  const [organizationOpen, setOrganizationOpen] = useState(false)
  const [merchantName, setMerchantName] = useState('')
  const [ownerUserId, setOwnerUserId] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [organizationSlug, setOrganizationSlug] = useState('')
  const [merchantId, setMerchantId] = useState('')

  const merchants = me?.merchants ?? []
  const organizations = me?.organizations ?? []
  const organizationsByMerchant = useMemo(() => {
    const map = new Map<string, number>()
    for (const organization of organizations) map.set(organization.merchant_id, (map.get(organization.merchant_id) ?? 0) + 1)
    return map
  }, [organizations])

  const merchantMutation = useMutation({
    mutationFn: () => api.adminCreateMerchant({ name: merchantName.trim(), owner_user_id: ownerUserId.trim() || undefined }),
    onSuccess: async () => {
      setMerchantOpen(false)
      setMerchantName('')
      setOwnerUserId('')
      await refreshMe()
    },
  })

  const organizationMutation = useMutation({
    mutationFn: () => api.adminCreateOrganization({ merchant_id: merchantId, name: organizationName.trim(), slug: organizationSlug.trim() }),
    onSuccess: async () => {
      setOrganizationOpen(false)
      setOrganizationName('')
      setOrganizationSlug('')
      setMerchantId('')
      await refreshMe()
    },
  })

  const createMerchant = (event: FormEvent) => {
    event.preventDefault()
    if (!previewReadOnly && merchantName.trim()) merchantMutation.mutate()
  }
  const createOrganization = (event: FormEvent) => {
    event.preventDefault()
    if (!previewReadOnly && merchantId && organizationName.trim() && organizationSlug.trim()) organizationMutation.mutate()
  }

  if (!me?.user.platform_admin) {
    return <div className="error-state"><ShieldCheck size={22} /><strong>Acesso restrito à plataforma.</strong><span>Esta área não pertence ao contexto operacional dos merchants.</span></div>
  }

  return (
    <div className="page-stack">
      <section className="platform-hero panel">
        <div><span className="eyebrow">Control plane</span><h2>Administração da Flash Pag</h2><p>Crie e acompanhe tenants sem misturar a operação administrativa da plataforma com o ambiente dos merchants.</p></div>
        <ShieldCheck size={28} />
      </section>

      <section className="platform-metrics">
        <article className="metric-card"><div className="metric-label"><Store size={16} /><span>Merchants</span></div><strong>{merchants.length}</strong><span className="metric-detail">Tenants comerciais</span></article>
        <article className="metric-card"><div className="metric-label"><Layers3 size={16} /><span>Organizações</span></div><strong>{organizations.length}</strong><span className="metric-detail">Contextos operacionais isolados</span></article>
      </section>

      <section className="toolbar platform-toolbar">
        <div className="toolbar-copy"><strong>Provisionamento</strong><span>Criação de tenants e organizações da plataforma.</span></div>
        <div className="platform-actions"><button className="button button-secondary" type="button" onClick={() => setMerchantOpen(true)}><Plus size={15} />Novo merchant</button><button className="button button-primary" type="button" disabled={!merchants.length} onClick={() => { setMerchantId(merchants[0]?.id || ''); setOrganizationOpen(true) }}><Plus size={15} />Nova organização</button></div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Merchants</h2><p>Visão global da camada SaaS.</p></div><span className="count-pill">{merchants.length}</span></div>
        <div className="platform-tenant-list">
          {merchants.map((merchant) => (
            <article className="platform-tenant-row" key={merchant.id}>
              <span className="platform-tenant-icon"><Store size={17} /></span>
              <div><strong>{merchant.name}</strong><span className="mono">{merchant.id}</span></div>
              <div className="platform-tenant-count"><strong>{organizationsByMerchant.get(merchant.id) ?? 0}</strong><span>organização(ões)</span></div>
              <StatusBadge status={merchant.status} />
              <span className="subtle-text">{formatDateTime(merchant.created_at)}</span>
            </article>
          ))}
          {!merchants.length ? <div className="empty-state compact-empty"><Building2 size={23} /><strong>Nenhum merchant</strong><span>Crie o primeiro tenant comercial da plataforma.</span></div> : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Organizações</h2><p>Contextos operacionais provisionados.</p></div><span className="count-pill">{organizations.length}</span></div>
        <div className="platform-organization-grid">
          {organizations.map((organization) => {
            const merchant = merchants.find((item) => item.id === organization.merchant_id)
            return <article className="platform-organization-card" key={organization.id}><div><span className="platform-tenant-icon"><Layers3 size={16} /></span><StatusBadge status={organization.status} /></div><strong>{organization.name}</strong><span>{merchant?.name || organization.merchant_id}</span><code>{organization.slug}</code></article>
          })}
        </div>
      </section>

      {merchantOpen ? (
        <div className="drawer-backdrop" role="presentation" onMouseDown={() => setMerchantOpen(false)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-label="Novo merchant" onMouseDown={(event) => event.stopPropagation()}>
            <div className="drawer-header"><div><span className="eyebrow">Plataforma</span><h2>Novo merchant</h2></div><button className="icon-button" type="button" onClick={() => setMerchantOpen(false)}><X size={18} /></button></div>
            <form className="financial-form drawer-form" onSubmit={createMerchant}>
              <label className="field"><span>Nome do merchant</span><input value={merchantName} onChange={(event) => setMerchantName(event.target.value)} placeholder="Empresa do cliente" autoFocus /></label>
              <label className="field"><span>User ID do proprietário <em>opcional</em></span><input value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)} placeholder="UUID do usuário Supabase" /></label>
              <div className="inline-info">O merchant é a fronteira comercial do tenant. Organizações serão criadas dentro dele.</div>
              {previewReadOnly ? <div className="inline-info">Provisionamento bloqueado no preview.</div> : null}
              {merchantMutation.isError ? <div className="inline-error">{merchantMutation.error instanceof Error ? merchantMutation.error.message : 'Falha ao criar merchant.'}</div> : null}
              <button className="button button-primary button-full" type="submit" disabled={previewReadOnly || merchantMutation.isPending || !merchantName.trim()}>{previewReadOnly ? 'Bloqueado no preview' : merchantMutation.isPending ? 'Criando…' : 'Criar merchant'}</button>
            </form>
          </aside>
        </div>
      ) : null}

      {organizationOpen ? (
        <div className="drawer-backdrop" role="presentation" onMouseDown={() => setOrganizationOpen(false)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-label="Nova organização" onMouseDown={(event) => event.stopPropagation()}>
            <div className="drawer-header"><div><span className="eyebrow">Plataforma</span><h2>Nova organização</h2></div><button className="icon-button" type="button" onClick={() => setOrganizationOpen(false)}><X size={18} /></button></div>
            <form className="financial-form drawer-form" onSubmit={createOrganization}>
              <label className="field"><span>Merchant</span><select value={merchantId} onChange={(event) => setMerchantId(event.target.value)}>{merchants.map((merchant) => <option key={merchant.id} value={merchant.id}>{merchant.name}</option>)}</select></label>
              <label className="field"><span>Nome</span><input value={organizationName} onChange={(event) => { const value = event.target.value; setOrganizationName(value); setOrganizationSlug(slugify(value)) }} placeholder="Operação principal" /></label>
              <label className="field"><span>Slug</span><input value={organizationSlug} onChange={(event) => setOrganizationSlug(slugify(event.target.value))} placeholder="operacao-principal" /></label>
              <div className="inline-info">A organização nasce com uma conta principal BRL e passa a ser um contexto isolado de clientes, transações e credenciais.</div>
              {previewReadOnly ? <div className="inline-info">Provisionamento bloqueado no preview.</div> : null}
              {organizationMutation.isError ? <div className="inline-error">{organizationMutation.error instanceof Error ? organizationMutation.error.message : 'Falha ao criar organização.'}</div> : null}
              <button className="button button-primary button-full" type="submit" disabled={previewReadOnly || organizationMutation.isPending || !merchantId || !organizationName.trim() || !organizationSlug.trim()}>{previewReadOnly ? 'Bloqueado no preview' : organizationMutation.isPending ? 'Criando…' : 'Criar organização'}</button>
            </form>
          </aside>
        </div>
      ) : null}
    </div>
  )
}
