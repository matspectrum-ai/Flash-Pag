import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  ArrowLeftRight,
  BookOpen,
  Building2,
  CircleAlert,
  Home,
  KeyRound,
  Landmark,
  LogOut,
  Menu,
  Network,
  Settings2,
  Users,
  Webhook,
  X,
} from 'lucide-react'
import { api } from '../../api/client'
import { useSession } from '../../app/session'
import { roleLabel } from '../../lib/format'
import { BrandMark } from '../brand/BrandMark'

const pageMeta: Record<string, { title: string; subtitle?: string }> = {
  '/': { title: 'Início', subtitle: 'Visão financeira e operacional' },
  '/transactions': { title: 'Transações', subtitle: 'Pagamentos Pix recebidos dos clientes desta organização' },
  '/accounts': { title: 'Contas', subtitle: 'Saldo e estrutura financeira da organização' },
  '/customers': { title: 'Clientes', subtitle: 'Pagadores e histórico financeiro' },
  '/api-keys': { title: 'API Keys', subtitle: 'Credenciais para integração programática' },
  '/webhooks': { title: 'Webhooks', subtitle: 'Eventos e saúde das entregas' },
  '/docs': { title: 'Documentação', subtitle: 'Referência para integrar com a Flash Pag' },
  '/connections': { title: 'Conexões', subtitle: 'Provedores e infraestrutura de pagamento' },
  '/organization': { title: 'Organização', subtitle: 'Contexto, equipe e permissões do merchant' },
  '/platform': { title: 'Plataforma', subtitle: 'Operação administrativa da Flash Pag' },
}

const primaryMobilePaths = new Set(['/', '/transactions', '/customers'])

export function AppShell() {
  const location = useLocation()
  const { me, organizationId, setOrganizationId, logout } = useSession()
  const meta = pageMeta[location.pathname] ?? pageMeta['/']
  const previewReadOnly = import.meta.env.VITE_PREVIEW_READ_ONLY === 'true'
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const selectedOrganization = (me?.organizations ?? []).find((item) => item.id === organizationId)
  const moreActive = !primaryMobilePaths.has(location.pathname)

  const accessQuery = useQuery({
    queryKey: ['access', organizationId],
    queryFn: () => api.access(organizationId!),
    enabled: Boolean(organizationId),
  })
  const canManageIntegrations = Boolean(accessQuery.data?.can_manage_integrations || me?.user.platform_admin)
  const currentRole = accessQuery.data?.role

  const developerItems = [
    ...(canManageIntegrations ? [
      { to: '/api-keys', label: 'API Keys', icon: KeyRound },
      { to: '/webhooks', label: 'Webhooks', icon: Webhook },
    ] : []),
    { to: '/docs', label: 'Documentação', icon: BookOpen },
  ]
  const settingsItems = [
    ...(canManageIntegrations ? [{ to: '/connections', label: 'Conexões', icon: Network }] : []),
    { to: '/organization', label: 'Organização', icon: Settings2 },
  ]
  const navGroups = [
    { label: '', items: [{ to: '/', label: 'Início', icon: Home }] },
    { label: 'Dinheiro', items: [
      { to: '/transactions', label: 'Transações', icon: ArrowLeftRight },
      { to: '/accounts', label: 'Contas', icon: Landmark },
    ] },
    { label: '', items: [{ to: '/customers', label: 'Clientes', icon: Users }] },
    { label: 'Desenvolvedores', items: developerItems },
    { label: 'Configurações', items: settingsItems },
  ]
  const mobileMoreGroups = [
    { label: 'Financeiro', items: [{ to: '/accounts', label: 'Contas', icon: Landmark }] },
    { label: 'Desenvolvedores', items: developerItems },
    { label: 'Configurações', items: settingsItems },
  ]

  useEffect(() => {
    setMobileMoreOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!mobileMoreOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [mobileMoreOpen])

  return (
    <div className="app-shell">
      <aside className="sidebar desktop-sidebar">
        <div className="brand-lockup sidebar-brand">
          <BrandMark />
          <div>
            <strong>Flash Pag</strong>
            <span>Infraestrutura Pix</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Navegação principal">
          {navGroups.map((group, index) => (
            <div className="nav-group" key={`${group.label}-${index}`}>
              {group.label ? <div className="nav-group-label">{group.label}</div> : null}
              {group.items.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                  <Icon size={17} strokeWidth={1.8} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}

          {me?.user.platform_admin ? (
            <div className="nav-group platform-nav">
              <div className="nav-group-label">Plataforma</div>
              <NavLink to="/platform" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <Building2 size={17} strokeWidth={1.8} />
                <span>Administração</span>
              </NavLink>
            </div>
          ) : null}
        </nav>

        <div className="sidebar-footer">
          <div className="session-summary">
            <div className="avatar">{me?.user.email?.charAt(0).toUpperCase() || 'U'}</div>
            <div className="session-copy">
              <strong>{me?.user.email}</strong>
              <span>{me?.user.platform_admin ? 'Administrador da plataforma' : roleLabel(currentRole)}</span>
            </div>
          </div>
          <button className="button button-quiet button-full" type="button" onClick={() => void logout()}>
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>

      <main className="app-main">
        <div className="mobile-topbar">
          <div className="mobile-brand">
            <BrandMark />
            <strong>Flash Pag</strong>
          </div>
          <label className="mobile-organization-switcher" aria-label="Organização atual">
            <select value={organizationId || ''} onChange={(event) => setOrganizationId(event.target.value)}>
              {(me?.organizations ?? []).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
        </div>

        <header className="app-header">
          <div className="page-heading">
            <span className="mobile-context-label">{selectedOrganization?.name || 'Organização'}</span>
            <h1>{meta.title}</h1>
            {meta.subtitle ? <p>{meta.subtitle}</p> : null}
          </div>

          <div className="header-actions desktop-header-actions">
            <label className="organization-switcher">
              <span>Organização</span>
              <select value={organizationId || ''} onChange={(event) => setOrganizationId(event.target.value)}>
                {(me?.organizations ?? []).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <div className="app-content">
          <div className="page-stack">
            {previewReadOnly ? (
              <div className="attention-banner preview-banner" role="status">
                <div className="attention-icon"><CircleAlert size={17} /></div>
                <div>
                  <strong>Preview somente leitura</strong>
                  <span>Dados reais para inspeção visual; alterações permanecem bloqueadas.</span>
                </div>
              </div>
            ) : null}
            <Outlet />
          </div>
        </div>

        <nav className="mobile-bottom-nav" aria-label="Navegação mobile">
          <NavLink to="/" end className={({ isActive }) => `mobile-nav-item${isActive ? ' active' : ''}`}>
            <Home size={20} strokeWidth={1.8} />
            <span>Início</span>
          </NavLink>
          <NavLink to="/transactions" className={({ isActive }) => `mobile-nav-item${isActive ? ' active' : ''}`}>
            <ArrowLeftRight size={20} strokeWidth={1.8} />
            <span>Transações</span>
          </NavLink>
          <NavLink to="/customers" className={({ isActive }) => `mobile-nav-item${isActive ? ' active' : ''}`}>
            <Users size={20} strokeWidth={1.8} />
            <span>Clientes</span>
          </NavLink>
          <button
            type="button"
            className={`mobile-nav-item${mobileMoreOpen || moreActive ? ' active' : ''}`}
            onClick={() => setMobileMoreOpen(true)}
            aria-expanded={mobileMoreOpen}
            aria-controls="mobile-more-sheet"
          >
            <Menu size={20} strokeWidth={1.8} />
            <span>Mais</span>
          </button>
        </nav>

        {mobileMoreOpen ? (
          <div className="mobile-sheet-backdrop" role="presentation" onMouseDown={() => setMobileMoreOpen(false)}>
            <section id="mobile-more-sheet" className="mobile-sheet" role="dialog" aria-modal="true" aria-label="Mais opções" onMouseDown={(event) => event.stopPropagation()}>
              <div className="mobile-sheet-handle" aria-hidden="true" />
              <div className="mobile-sheet-header">
                <div>
                  <span>Flash Pag</span>
                  <strong>Mais opções</strong>
                </div>
                <button className="icon-button" type="button" onClick={() => setMobileMoreOpen(false)} aria-label="Fechar menu">
                  <X size={19} />
                </button>
              </div>

              <label className="mobile-sheet-organization">
                <span>Organização</span>
                <select value={organizationId || ''} onChange={(event) => setOrganizationId(event.target.value)}>
                  {(me?.organizations ?? []).map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>

              <div className="mobile-sheet-groups">
                {mobileMoreGroups.map((group) => (
                  <div className="mobile-sheet-group" key={group.label}>
                    <span className="mobile-sheet-group-label">{group.label}</span>
                    <div>
                      {group.items.map(({ to, label, icon: Icon }) => (
                        <NavLink key={to} to={to} className={({ isActive }) => `mobile-sheet-link${isActive ? ' active' : ''}`}>
                          <span className="mobile-sheet-icon"><Icon size={18} strokeWidth={1.8} /></span>
                          <strong>{label}</strong>
                        </NavLink>
                      ))}
                    </div>
                  </div>
                ))}

                {me?.user.platform_admin ? (
                  <div className="mobile-sheet-group">
                    <span className="mobile-sheet-group-label">Plataforma</span>
                    <div>
                      <NavLink to="/platform" className={({ isActive }) => `mobile-sheet-link${isActive ? ' active' : ''}`}>
                        <span className="mobile-sheet-icon"><Building2 size={18} strokeWidth={1.8} /></span>
                        <strong>Administração</strong>
                      </NavLink>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mobile-sheet-session">
                <div className="session-summary">
                  <div className="avatar">{me?.user.email?.charAt(0).toUpperCase() || 'U'}</div>
                  <div className="session-copy">
                    <strong>{me?.user.email}</strong>
                    <span>{me?.user.platform_admin ? 'Administrador da plataforma' : roleLabel(currentRole)}</span>
                  </div>
                </div>
                <button className="button button-quiet" type="button" onClick={() => void logout()}>
                  <LogOut size={16} />
                  Sair
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </main>
    </div>
  )
}
