import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  ArrowLeftRight,
  BadgeCheck,
  BookOpen,
  Building2,
  CircleAlert,
  ClipboardCheck,
  DollarSign,
  Home,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Network,
  ServerCog,
  Settings2,
  Users,
  WalletCards,
  Webhook,
  Banknote,
  ShieldCheck,
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
  '/withdrawals': { title: 'Saques', subtitle: 'Saída Pix para o destino bancário cadastrado' },
  '/customers': { title: 'Clientes', subtitle: 'Pagadores e histórico financeiro' },
  '/api-keys': { title: 'API Keys', subtitle: 'Credenciais para integração programática' },
  '/webhooks': { title: 'Webhooks', subtitle: 'Eventos e saúde das entregas' },
  '/docs': { title: 'Documentação', subtitle: 'Referência para integrar com a Flash Pag' },
  '/kyc': { title: 'Verificação', subtitle: 'KYC/KYB da conta comercial' },
  '/connections': { title: 'Conexões', subtitle: 'Provedores e infraestrutura de pagamento' },
  '/organization': { title: 'Organização', subtitle: 'Contexto, equipe e permissões' },
  '/security': { title: 'Segurança', subtitle: 'Google Authenticator e autenticação reforçada' },
  '/platform': { title: 'Dashboard', subtitle: 'Financeiro, operação e saúde da plataforma' },
  '/platform/organizations': { title: 'Organizações', subtitle: 'Contas comerciais que operam na Flash Pag' },
  '/platform/users': { title: 'Usuários', subtitle: 'Acessos às contas comerciais da plataforma' },
  '/platform/transactions': { title: 'Transações', subtitle: 'Auditoria global de Pix recebido' },
  '/platform/balances': { title: 'Saldos', subtitle: 'Liquidez operacional por organização' },
  '/platform/processors': { title: 'Processadoras', subtitle: 'Infraestrutura Pix vinculada às organizações' },
  '/platform/kyc': { title: 'KYC', subtitle: 'Fila de verificação das contas comerciais' },
  '/platform/pricing': { title: 'Taxas', subtitle: 'Pricing versionado das contas comerciais' },
}

const merchantPrimaryMobilePaths = new Set(['/', '/transactions', '/customers'])
const platformPrimaryMobilePaths = new Set(['/platform', '/platform/organizations', '/platform/transactions'])

export function AppShell() {
  const location = useLocation()
  const { me, organizationId, setOrganizationId, logout } = useSession()
  const platformContext = location.pathname === '/platform' || location.pathname.startsWith('/platform/')
  const dynamicOrganization = location.pathname.startsWith('/platform/organizations/')
  const meta = dynamicOrganization
    ? { title: 'Organização 360°', subtitle: 'Visão financeira e operacional completa da conta comercial' }
    : pageMeta[location.pathname] ?? pageMeta['/']
  const previewReadOnly = import.meta.env.VITE_PREVIEW_READ_ONLY === 'true'
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const selectedOrganization = (me?.organizations ?? []).find((item) => item.id === organizationId)
  const moreActive = platformContext
    ? !platformPrimaryMobilePaths.has(location.pathname)
    : !merchantPrimaryMobilePaths.has(location.pathname)

  const accessQuery = useQuery({
    queryKey: ['access', organizationId],
    queryFn: () => api.access(organizationId!),
    enabled: Boolean(organizationId && !platformContext),
  })
  const canManageIntegrations = Boolean(accessQuery.data?.can_manage_integrations || me?.user.platform_admin)
  const currentRole = accessQuery.data?.role
  const canManageKYC = Boolean(me?.user.platform_admin || currentRole === 'owner' || currentRole === 'admin')
  const kycQuery = useQuery({
    queryKey: ['kyc-shell', organizationId],
    queryFn: () => api.kyc(organizationId!),
    enabled: Boolean(organizationId && canManageKYC && !platformContext),
    staleTime: 30_000,
  })
  const kycStatus = kycQuery.data?.profile.status

  const developerItems = [
    ...(canManageIntegrations ? [
      { to: '/api-keys', label: 'API Keys', icon: KeyRound },
      { to: '/webhooks', label: 'Webhooks', icon: Webhook },
    ] : []),
    { to: '/docs', label: 'Documentação', icon: BookOpen },
  ]
  const settingsItems = [
    ...(canManageKYC ? [{ to: '/kyc', label: 'Verificação', icon: BadgeCheck }] : []),
    ...(canManageIntegrations ? [{ to: '/connections', label: 'Conexões', icon: Network }] : []),
    { to: '/organization', label: 'Organização', icon: Settings2 },
  ]
  const merchantGroups = [
    { label: '', items: [{ to: '/', label: 'Início', icon: Home }] },
    { label: 'Dinheiro', items: [{ to: '/transactions', label: 'Transações', icon: ArrowLeftRight }, { to: '/accounts', label: 'Contas', icon: Landmark }, { to: '/withdrawals', label: 'Saques', icon: Banknote }] },
    { label: '', items: [{ to: '/customers', label: 'Clientes', icon: Users }] },
    { label: 'Desenvolvedores', items: developerItems },
    { label: 'Configurações', items: [...settingsItems, { to: '/security', label: 'Segurança', icon: ShieldCheck }] },
  ]
  const platformGroups = [
    { label: 'Visão geral', items: [{ to: '/platform', label: 'Dashboard', icon: LayoutDashboard }] },
    { label: 'Operação', items: [
      { to: '/platform/organizations', label: 'Organizações', icon: Building2 },
      { to: '/platform/users', label: 'Usuários', icon: Users },
      { to: '/platform/transactions', label: 'Transações', icon: ArrowLeftRight },
      { to: '/platform/balances', label: 'Saldos', icon: WalletCards },
    ] },
    { label: 'Infraestrutura', items: [{ to: '/platform/processors', label: 'Processadoras', icon: ServerCog }] },
    { label: 'Risco & comercial', items: [
      { to: '/platform/kyc', label: 'KYC', icon: ClipboardCheck },
      { to: '/platform/pricing', label: 'Taxas', icon: DollarSign },
    ] },
  ]
  const merchantMoreGroups = [
    { label: 'Financeiro', items: [{ to: '/accounts', label: 'Contas', icon: Landmark }, { to: '/withdrawals', label: 'Saques', icon: Banknote }] },
    { label: 'Desenvolvedores', items: developerItems },
    { label: 'Configurações', items: [...settingsItems, { to: '/security', label: 'Segurança', icon: ShieldCheck }] },
  ]
  const platformMoreGroups = [
    { label: 'Operação', items: [{ to: '/platform/users', label: 'Usuários', icon: Users }, { to: '/platform/balances', label: 'Saldos', icon: WalletCards }] },
    { label: 'Infraestrutura', items: [{ to: '/platform/processors', label: 'Processadoras', icon: ServerCog }] },
    { label: 'Risco & comercial', items: [{ to: '/platform/kyc', label: 'KYC', icon: ClipboardCheck }, { to: '/platform/pricing', label: 'Taxas', icon: DollarSign }] },
  ]

  useEffect(() => { setMobileMoreOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!mobileMoreOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [mobileMoreOpen])

  const renderGroups = (groups: typeof merchantGroups) => groups.map((group, index) => (
    <div className="nav-group" key={`${group.label}-${index}`}>
      {group.label ? <div className="nav-group-label">{group.label}</div> : null}
      {group.items.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/' || to === '/platform'} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}><Icon size={17} strokeWidth={1.8} /><span>{label}</span></NavLink>)}
    </div>
  ))

  return <div className={`app-shell${platformContext ? ' platform-context' : ''}`}>
    <aside className="sidebar desktop-sidebar">
      <div className="brand-lockup sidebar-brand"><BrandMark /><div><strong>Flash Pag</strong><span>{platformContext ? 'Administração' : 'Infraestrutura Pix'}</span></div></div>
      <nav className="sidebar-nav" aria-label={platformContext ? 'Navegação administrativa' : 'Navegação principal'}>
        {platformContext ? renderGroups(platformGroups) : renderGroups(merchantGroups)}
        {!platformContext && me?.user.platform_admin ? <div className="nav-group platform-nav"><div className="nav-group-label">Plataforma</div><NavLink to="/platform" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}><LayoutDashboard size={17} strokeWidth={1.8} /><span>Abrir administração</span></NavLink></div> : null}
        {platformContext ? <div className="nav-group"><div className="nav-group-label">Conta operacional</div><NavLink to="/" className="nav-item"><Home size={17} strokeWidth={1.8} /><span>Painel da organização</span></NavLink></div> : null}
      </nav>
      <div className="sidebar-footer"><div className="session-summary"><div className="avatar">{me?.user.email?.charAt(0).toUpperCase() || 'U'}</div><div className="session-copy"><strong>{me?.user.email}</strong><span>{me?.user.platform_admin ? 'Administrador da plataforma' : roleLabel(currentRole)}</span></div></div><button className="button button-quiet button-full" type="button" onClick={() => void logout()}><LogOut size={16} />Sair</button></div>
    </aside>

    <main className="app-main">
      <div className="mobile-topbar"><div className="mobile-brand"><BrandMark /><strong>Flash Pag</strong></div>{platformContext ? <span className="mobile-admin-context">Admin</span> : <label className="mobile-organization-switcher" aria-label="Organização atual"><select value={organizationId || ''} onChange={(event) => setOrganizationId(event.target.value)}>{(me?.organizations ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div>
      <header className="app-header"><div className="page-heading"><span className="mobile-context-label">{platformContext ? 'Flash Pag · Plataforma' : selectedOrganization?.name || 'Organização'}</span><h1>{meta.title}</h1>{meta.subtitle ? <p>{meta.subtitle}</p> : null}</div>{!platformContext ? <div className="header-actions desktop-header-actions"><label className="organization-switcher"><span>Organização</span><select value={organizationId || ''} onChange={(event) => setOrganizationId(event.target.value)}>{(me?.organizations ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div> : null}</header>
      <div className="app-content"><div className="page-stack">
        {previewReadOnly ? <div className="attention-banner preview-banner" role="status"><div className="attention-icon"><CircleAlert size={17} /></div><div><strong>Preview somente leitura</strong><span>Dados reais para inspeção visual; alterações permanecem bloqueadas.</span></div></div> : null}
        {!platformContext && canManageKYC && kycStatus && kycStatus !== 'approved' && location.pathname !== '/kyc' ? <div className="attention-banner" role="status"><div className="attention-icon"><BadgeCheck size={17} /></div><div><strong>Verificação da empresa pendente</strong><span>Conclua o KYC/KYB para habilitar conexões e operações financeiras com providers reais.</span></div><Link className="button button-secondary" to="/kyc">Abrir verificação</Link></div> : null}
        <Outlet />
      </div></div>

      {platformContext ? <nav className="mobile-bottom-nav" aria-label="Navegação administrativa mobile"><NavLink to="/platform" end className={({ isActive }) => `mobile-nav-item${isActive ? ' active' : ''}`}><LayoutDashboard size={20} strokeWidth={1.8} /><span>Dashboard</span></NavLink><NavLink to="/platform/organizations" className={({ isActive }) => `mobile-nav-item${isActive ? ' active' : ''}`}><Building2 size={20} strokeWidth={1.8} /><span>Organizações</span></NavLink><NavLink to="/platform/transactions" className={({ isActive }) => `mobile-nav-item${isActive ? ' active' : ''}`}><ArrowLeftRight size={20} strokeWidth={1.8} /><span>Transações</span></NavLink><button type="button" className={`mobile-nav-item${mobileMoreOpen || moreActive ? ' active' : ''}`} onClick={() => setMobileMoreOpen(true)}><Menu size={20} strokeWidth={1.8} /><span>Mais</span></button></nav> : <nav className="mobile-bottom-nav" aria-label="Navegação mobile"><NavLink to="/" end className={({ isActive }) => `mobile-nav-item${isActive ? ' active' : ''}`}><Home size={20} strokeWidth={1.8} /><span>Início</span></NavLink><NavLink to="/transactions" className={({ isActive }) => `mobile-nav-item${isActive ? ' active' : ''}`}><ArrowLeftRight size={20} strokeWidth={1.8} /><span>Transações</span></NavLink><NavLink to="/customers" className={({ isActive }) => `mobile-nav-item${isActive ? ' active' : ''}`}><Users size={20} strokeWidth={1.8} /><span>Clientes</span></NavLink><button type="button" className={`mobile-nav-item${mobileMoreOpen || moreActive ? ' active' : ''}`} onClick={() => setMobileMoreOpen(true)}><Menu size={20} strokeWidth={1.8} /><span>Mais</span></button></nav>}

      {mobileMoreOpen ? <div className="mobile-sheet-backdrop" role="presentation" onMouseDown={() => setMobileMoreOpen(false)}><section id="mobile-more-sheet" className="mobile-sheet" role="dialog" aria-modal="true" aria-label="Mais opções" onMouseDown={(event) => event.stopPropagation()}><div className="mobile-sheet-handle" aria-hidden="true" /><div className="mobile-sheet-header"><div><span>Flash Pag</span><strong>{platformContext ? 'Administração' : 'Mais opções'}</strong></div><button className="icon-button" type="button" onClick={() => setMobileMoreOpen(false)} aria-label="Fechar menu"><X size={19} /></button></div>{!platformContext ? <label className="mobile-sheet-organization"><span>Organização</span><select value={organizationId || ''} onChange={(event) => setOrganizationId(event.target.value)}>{(me?.organizations ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}<div className="mobile-sheet-groups">{(platformContext ? platformMoreGroups : merchantMoreGroups).map((group) => <div className="mobile-sheet-group" key={group.label}><span className="mobile-sheet-group-label">{group.label}</span><div>{group.items.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => `mobile-sheet-link${isActive ? ' active' : ''}`}><span className="mobile-sheet-icon"><Icon size={18} strokeWidth={1.8} /></span><strong>{label}</strong></NavLink>)}</div></div>)}{platformContext ? <div className="mobile-sheet-group"><span className="mobile-sheet-group-label">Conta operacional</span><div><NavLink to="/" className="mobile-sheet-link"><span className="mobile-sheet-icon"><Home size={18} /></span><strong>Painel da organização</strong></NavLink></div></div> : me?.user.platform_admin ? <div className="mobile-sheet-group"><span className="mobile-sheet-group-label">Plataforma</span><div><NavLink to="/platform" className="mobile-sheet-link"><span className="mobile-sheet-icon"><LayoutDashboard size={18} /></span><strong>Abrir administração</strong></NavLink></div></div> : null}</div><div className="mobile-sheet-session"><div className="session-summary"><div className="avatar">{me?.user.email?.charAt(0).toUpperCase() || 'U'}</div><div className="session-copy"><strong>{me?.user.email}</strong><span>{me?.user.platform_admin ? 'Administrador da plataforma' : roleLabel(currentRole)}</span></div></div><button className="button button-quiet" type="button" onClick={() => void logout()}><LogOut size={16} />Sair</button></div></section></div> : null}
    </main>
  </div>
}
