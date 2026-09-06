import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, CircleAlert, Layers3, Plus, ShieldCheck, Trash2, UserRound, UsersRound, X } from 'lucide-react'
import { api } from '../../api/client'
import type { MemberRole, MerchantMember } from '../../api/types'
import { useSession } from '../../app/session'
import { formatDateTime, roleLabel } from '../../lib/format'
import { StatusBadge } from '../../components/ui/StatusBadge'

const allRoles: Array<{ value: MemberRole; label: string; description: string }> = [
  { value: 'owner', label: 'Proprietário', description: 'Controle total do merchant, incluindo outros administradores.' },
  { value: 'admin', label: 'Administrador', description: 'Gerencia operação, integrações e membros comuns.' },
  { value: 'member', label: 'Membro', description: 'Opera clientes e recursos cotidianos, sem credenciais sensíveis.' },
  { value: 'viewer', label: 'Visualizador', description: 'Acesso somente leitura ao contexto operacional.' },
]

export function OrganizationPage() {
  const { me, organization, organizationId, setOrganizationId } = useSession()
  const queryClient = useQueryClient()
  const previewReadOnly = import.meta.env.VITE_PREVIEW_READ_ONLY === 'true'
  const [addingMember, setAddingMember] = useState(false)
  const [memberEmail, setMemberEmail] = useState('')
  const [memberRole, setMemberRole] = useState<MemberRole>('member')

  const accessQuery = useQuery({
    queryKey: ['access', organizationId],
    queryFn: () => api.access(organizationId!),
    enabled: Boolean(organizationId),
  })
  const membersQuery = useQuery({
    queryKey: ['members', organizationId],
    queryFn: () => api.members(organizationId!),
    enabled: Boolean(organizationId),
  })

  const createMemberMutation = useMutation({
    mutationFn: () => api.createMember(organizationId!, { email: memberEmail.trim(), role: memberRole }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['members', organizationId] })
      setAddingMember(false)
      setMemberEmail('')
      setMemberRole('member')
    },
  })
  const updateMemberMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: MemberRole }) => api.updateMemberRole(organizationId!, userId, role),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['members', organizationId] }),
  })
  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => api.removeMember(organizationId!, userId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['members', organizationId] }),
  })
  const memberMutationError = updateMemberMutation.error ?? removeMemberMutation.error

  if (!organizationId || !organization) return <div className="empty-state"><strong>Nenhuma organização selecionada</strong><span>Seu usuário ainda não possui um contexto de tenant acessível.</span></div>
  if (accessQuery.isLoading || membersQuery.isLoading) return <div className="skeleton skeleton-panel" aria-busy="true" />
  if (accessQuery.isError || membersQuery.isError) return <div className="error-state"><CircleAlert size={22} /><strong>Não foi possível carregar a organização e sua equipe.</strong></div>

  const merchant = me?.merchants.find((item) => item.id === organization.merchant_id)
  const siblingOrganizations = (me?.organizations ?? []).filter((item) => item.merchant_id === organization.merchant_id)
  const access = accessQuery.data
  const members = membersQuery.data?.data ?? []
  const actorRole = access?.role
  const manageableRoles = actorRole === 'owner' || actorRole === 'platform_admin'
    ? allRoles
    : allRoles.filter((item) => item.value === 'member' || item.value === 'viewer')

  const canManageTarget = (member: MerchantMember) => {
    if (actorRole === 'owner' || actorRole === 'platform_admin') return true
    if (actorRole === 'admin') return member.role === 'member' || member.role === 'viewer'
    return false
  }

  const submitMember = (event: FormEvent) => {
    event.preventDefault()
    if (!previewReadOnly && access?.can_manage_members && memberEmail.trim()) createMemberMutation.mutate()
  }

  return (
    <div className="page-stack">
      <section className="organization-hero panel">
        <div className="organization-hero-icon"><Building2 size={24} /></div>
        <div className="organization-hero-copy"><span className="eyebrow">Tenant atual</span><h2>{organization.name}</h2><p>Clientes, pagamentos e recursos permanecem isolados por organização; membros e papéis pertencem ao merchant.</p></div>
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
          <div className="access-summary"><span className="access-role-icon"><UsersRound size={20} /></span><div><strong>{roleLabel(access?.role)}</strong><span>{access?.can_manage_integrations ? 'Pode administrar credenciais, webhooks, conexões e equipe conforme o papel.' : access?.can_write_operational ? 'Pode operar recursos cotidianos sem administrar credenciais sensíveis.' : 'Acesso somente leitura ao contexto operacional.'}</span></div></div>
        </article>
      </section>

      <section className="panel merchant-team-panel">
        <div className="panel-header">
          <div><h2>Equipe do merchant</h2><p>Estes acessos valem para todas as organizações pertencentes a {merchant?.name || 'este merchant'}.</p></div>
          <div className="panel-header-actions"><span className="count-pill">{members.length}</span>{access?.can_manage_members ? <button className="button button-primary" type="button" onClick={() => setAddingMember(true)}><Plus size={15} />Adicionar membro</button> : null}</div>
        </div>
        <div className="member-list">
          {members.map((member) => {
            const manageable = canManageTarget(member)
            return (
              <div className="member-row" key={member.user_id}>
                <span className="member-avatar"><UserRound size={17} /></span>
                <div className="member-identity"><strong>{member.email || 'Usuário sem e-mail'}</strong><span className="mono">{member.user_id}</span></div>
                <div className="member-role-control">
                  {manageable && access?.can_manage_members ? (
                    <select
                      value={member.role}
                      disabled={previewReadOnly || updateMemberMutation.isPending}
                      onChange={(event) => updateMemberMutation.mutate({ userId: member.user_id, role: event.target.value as MemberRole })}
                      aria-label={`Papel de ${member.email}`}
                    >
                      {manageableRoles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                    </select>
                  ) : <span className="role-pill">{roleLabel(member.role)}</span>}
                </div>
                <span className="member-created">Desde {formatDateTime(member.created_at)}</span>
                {manageable && access?.can_manage_members ? (
                  <button className="icon-button danger-icon-button" type="button" disabled={previewReadOnly || removeMemberMutation.isPending} onClick={() => removeMemberMutation.mutate(member.user_id)} aria-label={`Remover ${member.email}`}><Trash2 size={16} /></button>
                ) : <span />}
              </div>
            )
          })}
          {!members.length ? <div className="empty-state compact-empty"><strong>Nenhum membro encontrado</strong><span>O merchant ainda não possui membros listáveis.</span></div> : null}
        </div>
        {memberMutationError ? <div className="inline-error member-inline-error">{memberMutationError instanceof Error ? memberMutationError.message : 'Não foi possível alterar a equipe.'}</div> : null}
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Organizações deste merchant</h2><p>Trocar de organização troca completamente o contexto financeiro e operacional.</p></div><span className="count-pill">{siblingOrganizations.length}</span></div>
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

      {addingMember ? (
        <div className="drawer-backdrop" role="presentation" onMouseDown={() => setAddingMember(false)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-label="Adicionar membro" onMouseDown={(event) => event.stopPropagation()}>
            <div className="drawer-header"><div><span className="eyebrow">{merchant?.name || 'Merchant'}</span><h2>Adicionar membro</h2></div><button className="icon-button" type="button" onClick={() => setAddingMember(false)} aria-label="Fechar"><X size={18} /></button></div>
            <form className="financial-form drawer-form" onSubmit={submitMember}>
              <label className="field"><span>E-mail</span><input type="email" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} placeholder="usuario@empresa.com" autoFocus required /></label>
              <label className="field"><span>Papel</span><select value={memberRole} onChange={(event) => setMemberRole(event.target.value as MemberRole)}>{manageableRoles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
              <div className="role-explainer">{allRoles.find((item) => item.value === memberRole)?.description}</div>
              <div className="inline-info">Nesta etapa, o e-mail precisa pertencer a um usuário que já possui conta na Flash Pag. Convites por e-mail serão uma camada separada.</div>
              {previewReadOnly ? <div className="inline-info">No preview a equipe é exibida com dados reais, mas alterações estão bloqueadas.</div> : null}
              {createMemberMutation.isError ? <div className="inline-error">{createMemberMutation.error instanceof Error ? createMemberMutation.error.message : 'Não foi possível adicionar o membro.'}</div> : null}
              <button className="button button-primary button-full" type="submit" disabled={previewReadOnly || createMemberMutation.isPending || !memberEmail.trim()}>{previewReadOnly ? 'Bloqueado no preview' : createMemberMutation.isPending ? 'Adicionando…' : 'Adicionar ao merchant'}</button>
            </form>
          </aside>
        </div>
      ) : null}
    </div>
  )
}
