import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { CircleAlert, ShieldCheck, UserRoundCheck, Users } from 'lucide-react'
import { api } from '../../api/client'
import { useSession } from '../../app/session'
import { roleLabel } from '../../lib/format'
import './admin-finance.css'

export function PlatformUsersPage() {
  const { me } = useSession()
  const platformAdmin = Boolean(me?.user.platform_admin)
  const tenantsQuery = useQuery({ queryKey: ['platform-tenants'], queryFn: api.adminTenants, enabled: platformAdmin, staleTime: 30_000 })
  const merchants = tenantsQuery.data?.merchants ?? []
  const organizations = tenantsQuery.data?.organizations ?? []
  const memberQueries = useQueries({
    queries: merchants.map((merchant) => ({ queryKey: ['platform-users-members', merchant.id], queryFn: () => api.adminMerchantMembers(merchant.id), staleTime: 30_000 })),
  })

  const memberships = useMemo(() => merchants.flatMap((merchant, index) => {
    const orgNames = organizations.filter((organization) => organization.merchant_id === merchant.id).map((organization) => organization.name)
    return (memberQueries[index]?.data?.data ?? []).map((member) => ({ member, merchant, orgNames }))
  }), [merchants, organizations, memberQueries])
  const uniqueUsers = new Set(memberships.map((item) => item.member.user_id)).size
  const privileged = memberships.filter((item) => item.member.role === 'owner' || item.member.role === 'admin').length
  const incomplete = tenantsQuery.data?.complete === false || memberQueries.some((query) => query.data?.complete === false)
  const hasError = tenantsQuery.isError || memberQueries.some((query) => query.isError)

  if (!platformAdmin) return <div className="error-state"><ShieldCheck size={22} /><strong>Acesso restrito à plataforma.</strong><span>Usuários globais são exclusivos da administração Flash Pag.</span></div>

  return (
    <div className="page-stack admin-finance-page">
      <section className="platform-section-heading"><div><span className="eyebrow">Operação</span><h2>Usuários</h2><p>Pessoas com acesso às contas comerciais da Flash Pag.</p></div></section>
      {hasError || incomplete ? <div className="attention-banner"><div className="attention-icon"><CircleAlert size={17} /></div><div><strong>{hasError ? 'Leitura parcial' : 'Inventário parcial'}</strong><span>Os vínculos abaixo podem não representar todos os usuários da plataforma.</span></div></div> : null}
      <section className="platform-admin-kpis">
        <article className="metric-card"><div className="metric-label"><Users size={16} /><span>Usuários</span></div><strong>{uniqueUsers}</strong><span className="metric-detail">Identidades únicas vinculadas</span></article>
        <article className="metric-card"><div className="metric-label"><UserRoundCheck size={16} /><span>Vínculos</span></div><strong>{memberships.length}</strong><span className="metric-detail">Vínculos de acesso</span></article>
        <article className="metric-card"><div className="metric-label"><ShieldCheck size={16} /><span>Owners / admins</span></div><strong>{privileged}</strong><span className="metric-detail">Vínculos administrativos</span></article>
      </section>
      <section className="panel">
        <div className="panel-header"><div><h2>Diretório de usuários</h2><p>Os dados refletem memberships da conta comercial; e-mail verificado e último login ainda não possuem contrato administrativo próprio.</p></div><span className="count-pill">{memberships.length}</span></div>
        <div className="table-wrap"><table className="data-table platform-users-table"><thead><tr><th>Usuário</th><th>Papel</th><th>Organizações</th></tr></thead><tbody>
          {memberships.map(({ member, merchant, orgNames }) => <tr key={`${merchant.id}-${member.user_id}`}><td><strong>{member.email || member.user_id}</strong><span className="mono platform-table-subline">{member.user_id}</span></td><td>{roleLabel(member.role)}</td><td>{orgNames.length ? orgNames.join(', ') : 'Sem organização operacional'}</td></tr>)}
          {!memberships.length && !tenantsQuery.isLoading ? <tr><td colSpan={3}><div className="empty-state compact-empty"><Users size={22} /><strong>Nenhum usuário carregado</strong><span>Não há vínculos de acesso no inventário atual.</span></div></td></tr> : null}
        </tbody></table></div>
      </section>
    </div>
  )
}
