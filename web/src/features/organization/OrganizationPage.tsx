import { useQuery } from '@tanstack/react-query'
import { Building2, CircleAlert, Layers3, ShieldCheck, UsersRound } from 'lucide-react'
import { api } from '../../api/client'
import { useSession } from '../../app/session'
import { formatDateTime, roleLabel } from '../../lib/format'
import { StatusBadge } from '../../components/ui/StatusBadge'

export function OrganizationPage() {
  const { me, organization, organizationId, setOrganizationId } = useSession()

  const accessQuery = useQuery({
    queryKey: ['access', organizationId],
    queryFn: () => api.access(organizationId!),
    enabled: Boolean(organizationId),
  })

  if (!organizationId || !organization) return <div className="empty-state"><strong>Nenhuma organização selecionada</strong><span>Seu usuário ainda não possui um contexto de tenant acessível.</span></div>
  if (accessQuery.isLoading) return <div className="skeleton skeleton-panel" aria-busy="true" />
  if (accessQuery.isError) return <div className="error-state"><CircleAlert size={22} /><strong>Não foi possível validar seu acesso à organização.</strong></div>

  const merchant = me?.merchants.find((item) => item.id === organization.merchant_id)
  const siblingOrganizations = (me?.organizations ?? []).filter((item) => item.merchant_id === organization.merchant_id)

  return (
    <div className="page-stack">
      <section className="organization-hero panel">
        <div className="organization-hero-icon"><Building2 size={24} /></div>
        <div className="organization-hero-copy"><span className="eyebrow">Tenant atual</span><h2>{organization.name}</h2><p>Todos os clientes, pagamentos, credenciais, webhooks e conexões exibidos no app estão escopados a esta organização.</p></div>
        <StatusBadge status={organization.status} />
      </section>

      <section className="organization-grid">
        <article className="panel organization-info-card">
          <div className="panel-header"><div><h2>Identidade</h2><p>Contexto usado nas operações e integrações.</p></div><Layers3 size={18} /></div>
          <dl className="detail-list organization-detail-list">
            <div><dt>Organização</dt><dd>{organization.name}</dd></div>
            <div><dt>Slug</dt><dd className="mono">{organization.slug}</dd></div>
            <div><dt>Merchant</dt><dd>{merchant?.name || organization.merchant_id}</dd></div>
            <div><dt>ID da organização</dt><dd className="mono">{organization.id}</dd></div>
            <div><dt>Criada</dt><dd>{formatDateTime(organization.created_at)}</dd></div>
          </dl>
        </article>

        <article className="panel organization-info-card">
          <div className="panel-header"><div><h2>Seu acesso</h2><p>Permissões dentro deste merchant.</p></div><ShieldCheck size={18} /></div>
          <div className="access-summary"><span className="access-role-icon"><UsersRound size={20} /></span><div><strong>{roleLabel(accessQuery.data?.role)}</strong><span>{accessQuery.data?.can_manage ? 'Pode gerenciar credenciais, webhooks e infraestrutura desta organização.' : 'Pode operar recursos permitidos, sem administrar credenciais sensíveis.'}</span></div></div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Organizações deste merchant</h2><p>Trocar de organização troca completamente o contexto do tenant.</p></div><span className="count-pill">{siblingOrganizations.length}</span></div>
        <div className="tenant-switch-list">
          {siblingOrganizations.map((item) => (
            <button className={`tenant-switch-row${item.id === organization.id ? ' active' : ''}`} type="button" key={item.id} onClick={() => setOrganizationId(item.id)}>
              <span className="tenant-switch-icon"><Building2 size={16} /></span>
              <span><strong>{item.name}</strong><small>{item.slug}</small></span>
              <StatusBadge status={item.status} />
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
