import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CheckCircle2, CircleAlert, LockKeyhole, RefreshCw } from 'lucide-react'
import { api } from '../../api/client'
import type { ProviderConnection } from '../../api/types'
import { useSession } from '../../app/session'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { formatBRL, formatDateTime } from '../../lib/format'
import './connections.css'

type ConnectionHealth = {
  provider?: string
  healthy?: boolean
  available_minor?: number
  blocked_minor?: number
  reserve_minor?: number
  currency?: string
}

function providerName(code: string) {
  if (code === 'pixhub') return 'Pixhub'
  if (code === 'mock') return 'Mock · desenvolvimento'
  return code
}

export function ConnectionsPage() {
  const { organizationId } = useSession()
  const [healthByConnection, setHealthByConnection] = useState<Record<string, ConnectionHealth>>({})

  const connectionsQuery = useQuery({
    queryKey: ['provider-connections', organizationId],
    queryFn: () => api.list<ProviderConnection>('provider-connections', organizationId!),
    enabled: Boolean(organizationId),
  })

  const testMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      const health = await api.testConnection(connectionId, organizationId!)
      return { connectionId, health: health as ConnectionHealth }
    },
    onSuccess: ({ connectionId, health }) => {
      setHealthByConnection((current) => ({ ...current, [connectionId]: health }))
    },
  })

  if (!organizationId) return <div className="empty-state"><strong>Selecione uma organização</strong><span>As conexões são isoladas por organização.</span></div>
  if (connectionsQuery.isLoading) return <div className="skeleton skeleton-panel" aria-busy="true" />
  if (connectionsQuery.isError) return <div className="error-state"><CircleAlert size={22} /><strong>Não foi possível carregar as conexões.</strong><button className="button button-secondary" onClick={() => void connectionsQuery.refetch()}>Tentar novamente</button></div>

  const connections = connectionsQuery.data?.data ?? []
  const active = connections.filter((item) => item.status === 'active')
  const inactive = connections.filter((item) => item.status !== 'active')

  return (
    <div className="page-stack">
      <section className="context-strip">
        <div className="context-strip-icon"><LockKeyhole size={16} /></div>
        <div><strong>Credenciais protegidas</strong><span>Secrets são criptografados no backend e nunca são exibidos novamente em texto puro.</span></div>
      </section>

      <section className="panel connection-page-panel">
        <div className="panel-header">
          <div><h2>Conexões ativas</h2><p>Rotas disponíveis para operações reais da organização.</p></div>
          <span className="count-pill">{active.length}</span>
        </div>
        <div className="connection-card-grid">
          {active.map((connection) => {
            const health = healthByConnection[connection.id]
            const testing = testMutation.isPending && testMutation.variables === connection.id
            return (
              <article className="connection-card" key={connection.id}>
                <div className="connection-card-head">
                  <div className="connection-title"><div className="provider-avatar">{connection.provider_code.charAt(0).toUpperCase()}</div><div><strong>{connection.label}</strong><span>{providerName(connection.provider_code)}</span></div></div>
                  <StatusBadge status={connection.status} />
                </div>

                <dl className="connection-meta">
                  <div><dt>Provider</dt><dd>{providerName(connection.provider_code)}</dd></div>
                  <div><dt>Criada</dt><dd>{formatDateTime(connection.created_at)}</dd></div>
                  <div><dt>Credenciais</dt><dd>Criptografadas</dd></div>
                </dl>

                <div className={`health-panel ${health?.healthy ? 'health-ok' : ''}`}>
                  <div className="health-copy">
                    {health ? (health.healthy ? <CheckCircle2 size={17} /> : <CircleAlert size={17} />) : <RefreshCw size={17} />}
                    <div>
                      <strong>{health ? (health.healthy ? 'Conexão saudável' : 'Atenção necessária') : 'Saúde não consultada'}</strong>
                      <span>{health?.currency ? `${health.currency} · leitura externa` : 'O teste é somente leitura e não movimenta dinheiro.'}</span>
                    </div>
                  </div>
                  {typeof health?.available_minor === 'number' ? <div className="external-balance"><span>Saldo externo</span><strong>{formatBRL(health.available_minor)}</strong></div> : null}
                </div>

                <button className="button button-secondary button-full" disabled={testing} onClick={() => testMutation.mutate(connection.id)}>
                  <RefreshCw size={15} className={testing ? 'spin' : ''} />
                  {testing ? 'Testando…' : 'Testar conexão'}
                </button>
              </article>
            )
          })}
          {!active.length ? <div className="empty-state compact-empty"><strong>Nenhuma conexão ativa</strong><span>Uma conexão válida é necessária para processar operações reais.</span></div> : null}
        </div>
      </section>

      {inactive.length ? (
        <section className="panel">
          <div className="panel-header"><div><h2>Conexões desativadas</h2><p>Mantidas para histórico e auditoria.</p></div><span className="count-pill">{inactive.length}</span></div>
          <div className="inactive-connections">
            {inactive.map((connection) => (
              <div key={connection.id}>
                <div className="connection-title"><div className="provider-avatar muted">{connection.provider_code.charAt(0).toUpperCase()}</div><div><strong>{connection.label}</strong><span>{providerName(connection.provider_code)}</span></div></div>
                <StatusBadge status={connection.status} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
