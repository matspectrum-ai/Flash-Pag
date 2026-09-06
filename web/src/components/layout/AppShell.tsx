import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  ArrowLeftRight,
  BookOpen,
  Building2,
  CircleDollarSign,
  Home,
  KeyRound,
  Landmark,
  LogOut,
  Network,
  Settings2,
  Users,
  Webhook,
} from 'lucide-react'
import { useSession } from '../../app/session'

const navGroups = [
  {
    label: '',
    items: [{ to: '/', label: 'Início', icon: Home }],
  },
  {
    label: 'Dinheiro',
    items: [
      { to: '/transactions', label: 'Transações', icon: ArrowLeftRight },
      { to: '/transfers', label: 'Transferências', icon: CircleDollarSign },
      { to: '/accounts', label: 'Contas', icon: Landmark },
    ],
  },
  {
    label: '',
    items: [{ to: '/customers', label: 'Clientes', icon: Users }],
  },
  {
    label: 'Desenvolvedores',
    items: [
      { to: '/api-keys', label: 'API Keys', icon: KeyRound },
      { to: '/webhooks', label: 'Webhooks', icon: Webhook },
      { to: '/docs', label: 'Documentação', icon: BookOpen },
    ],
  },
  {
    label: 'Configurações',
    items: [
      { to: '/connections', label: 'Conexões', icon: Network },
      { to: '/organization', label: 'Organização', icon: Settings2 },
    ],
  },
]

const pageMeta: Record<string, { title: string; subtitle?: string }> = {
  '/': { title: 'Início', subtitle: 'Visão financeira e operacional' },
  '/transactions': { title: 'Transações', subtitle: 'Acompanhe entradas, saídas e estados do Pix' },
  '/transfers': { title: 'Transferências', subtitle: 'Envie Pix com revisão e controle de saldo' },
  '/accounts': { title: 'Contas', subtitle: 'Saldo e estrutura financeira da organização' },
  '/customers': { title: 'Clientes', subtitle: 'Pagadores e histórico financeiro' },
  '/api-keys': { title: 'API Keys', subtitle: 'Credenciais para integração programática' },
  '/webhooks': { title: 'Webhooks', subtitle: 'Eventos e saúde das entregas' },
  '/docs': { title: 'Documentação', subtitle: 'Referência para integrar com a Flash Pag' },
  '/connections': { title: 'Conexões', subtitle: 'Provedores e infraestrutura de pagamento' },
  '/organization': { title: 'Organização', subtitle: 'Contexto, identidade e acesso' },
  '/platform': { title: 'Plataforma', subtitle: 'Operação administrativa da Flash Pag' },
}

export function AppShell() {
  const location = useLocation()
  const { me, organizationId, setOrganizationId, logout } = useSession()
  const meta = pageMeta[location.pathname] ?? pageMeta['/']

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup sidebar-brand">
          <div className="brand-mark">F</div>
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
            <div className="avatar">{me?.user.email?.charAt(0).toUpperCase() || 'F'}</div>
            <div className="session-copy">
              <strong>{me?.user.email}</strong>
              <span>{me?.user.platform_admin ? 'Administrador da plataforma' : 'Membro'}</span>
            </div>
          </div>
          <button className="button button-quiet button-full" type="button" onClick={() => void logout()}>
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>

      <main className="app-main">
        <header className="app-header">
          <div className="page-heading">
            <h1>{meta.title}</h1>
            {meta.subtitle ? <p>{meta.subtitle}</p> : null}
          </div>

          <div className="header-actions">
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
          <Outlet />
        </div>
      </main>
    </div>
  )
}
