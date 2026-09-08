import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { CircleAlert, Network, ServerCog, ShieldCheck } from 'lucide-react'
import { api } from '../../api/client'
import type { ProviderConnection } from '../../api/types'
import { useSession } from '../../app/session'
import './admin-finance.css'

type ProviderRollup = {
  code: string
  active: number
  disabled: number
  error: number
  organizations: Set<string>
  labels: Set<string>
}

export function PlatformProcessorsPage() {
  const { me } = useSession()
  const platformAdmin = Boolean(me?.user.platform_admin)
  const tenantsQuery = useQuery({ queryKey: ['platform-tenants'], queryFn: api.adminTenants, enabled: platformAdmin, staleTime: 30_000 })
  const organizations = tenantsQuery.data?.organizations ?? []
  const queries = useQueries({ queries: organizations.map((organization) => ({ queryKey: ['platform-processors', organization.id], queryFn: () => api.list<ProviderConnection>('provider-connections', organization.id), staleTime: 15_000 })) })
  const rollups = useMemo(() => {
    const map = new Map<string, ProviderRollup>()
    for (const code of me?.installed_providers ?? []) map.set(code, { code, active: 0, disabled: 0, error: 0, organizations: new Set(), labels: new Set() })
    organizations.forEach((organization, index) => {
      for (const connection of queries[index]?.data?.data ?? []) {
        const item = map.get(connection.provider_code) ?? { code: connection.provider_code, active: 0, disabled: 0, error: 0, organizations: new Set<string>(), labels: new Set<string>() }
        if (connection.status === 'active') item.active += 1
        else if (connection.status === 'error') item.error += 1
        else item.disabled += 1
        item.organizations.add(organization.id)
        item.labels.add(connection.label)
        map.set(connection.provider_code, item)
      }
    })
    return [...map.values()].sort((a, b) => b.organizations.size - a.organizations.size || a.code.localeCompare(b.code))
  }, [me?.installed_providers, organizations, queries])
  const totalConnections = rollups.reduce((sum, item) => sum + item.active + item.disabled + item.error, 0)
  const hasError = tenantsQuery.isError || queries.some((query) => query.isError)

  if (!platformAdmin) return <div className="error-state"><ShieldCheck size={22} /><strong>Acesso restrito à plataforma.</strong><span>Processadoras globais são exclusivas da administração Flash Pag.</span></div>
  return <div className="page-stack admin-finance-page">
    <section className="platform-section-heading"><div><span className="eyebrow">Infraestrutura</span><h2>Processadoras</h2><p>Visão global das conexões Pix instaladas e vinculadas às organizações.</p></div></section>
    {hasError ? <div className="attention-banner"><div className="attention-icon"><CircleAlert size={17} /></div><div><strong>Leitura parcial</strong><span>Uma ou mais organizações não retornaram suas conexões.</span></div></div> : null}
    <section className="platform-admin-kpis"><article className="metric-card"><div className="metric-label"><ServerCog size={16} /><span>Adapters instalados</span></div><strong>{me?.installed_providers?.length ?? 0}</strong><span className="metric-detail">Disponíveis no backend</span></article><article className="metric-card"><div className="metric-label"><Network size={16} /><span>Conexões</span></div><strong>{totalConnections}</strong><span className="metric-detail">Vínculos organização-provider</span></article><article className="metric-card"><div className="metric-label"><ShieldCheck size={16} /><span>Ativas</span></div><strong>{rollups.reduce((sum, item) => sum + item.active, 0)}</strong><span className="metric-detail">Conexões operacionais</span></article></section>
    <section className="panel"><div className="panel-header"><div><h2>Processadoras Pix</h2><p>Esta fase não inventa latência, disponibilidade ou aprovação agregada; telemetria de roteamento será adicionada quando houver contrato próprio.</p></div><span className="count-pill">{rollups.length}</span></div><div className="table-wrap"><table className="data-table platform-processors-table"><thead><tr><th>Processadora</th><th>Ativas</th><th>Desativadas</th><th>Erro</th><th>Organizações</th><th>Labels</th></tr></thead><tbody>{rollups.map((item) => <tr key={item.code}><td><strong>{item.code}</strong></td><td>{item.active}</td><td>{item.disabled}</td><td>{item.error}</td><td>{item.organizations.size}</td><td>{item.labels.size ? [...item.labels].join(', ') : '—'}</td></tr>)}</tbody></table></div></section>
  </div>
}
