import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CircleAlert, LockKeyhole, Plus, RefreshCw, X } from 'lucide-react'
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
  const queryClient = useQueryClient()
  const previewReadOnly = import.meta.env.VITE_PREVIEW_READ_ONLY === 'true'
  const [healthByConnection, setHealthByConnection] = useState<Record<string, ConnectionHealth>>({})
  const [createOpen, setCreateOpen] = useState(false)
  const [provider, setProvider] = useState<'mock' | 'pixhub'>('mock')
  const [label, setLabel] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')

  const connectionsQuery = useQuery({
    queryKey: ['provider-connections', organizationId],
    queryFn: () => api.list<ProviderConnection>('provider-connections', organizationId!),
    enabled: Boolean(organizationId),
  })

  const createMutation = useMutation({
    mutationFn: () => api.createProviderConnection(organizationId!, {
      provider,
      label: label.trim() || (provider === 'mock' ? 'Mock QA' : 'Pixhub'),
      credentials: provider === 'pixhub' ? { client_id: clientId.trim(), client_secret: clientSecret } : undefined,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['provider-connections', organizationId] })
      setCreateOpen(false)
      setProvider('mock')
      setLabel('')
      setClientId('')
      setClientSecret('')
    },
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
        <div className="panel-header connection-panel-header">
          <div><h2>Conexões ativas</h2><p>Rotas disponíveis para operações reais da organização.</p></div>
          <div className="connection-panel-actions"><span className="count-pill">{active.length}</span><button className="button button-primary" type="button" disabled={previewReadOnly} onClick={() => setCreateOpen(true)}><Plus size={15} />Nova conexão</button></div>
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
                      <strong>{health ? (health.healthy ? 'Conexão saudável' : 'Atenção necessária') : previewReadOnly ? 'Consulta desabilitada no preview' : 'Saúde não consultada'}</strong>
                      <span>{health?.currency ? `${health.currency} · leitura externa` : previewReadOnly ? 'O preview não executa chamadas POST, mesmo quando a operação é somente leitura.' : 'O teste é somente leitura e não movimenta dinheiro.'}</span>
                    </div>
                  </div>
                  {typeof health?.available_minor === 'number' ? <div className="external-balance"><span>Saldo externo</span><strong>{formatBRL(health.available_minor)}</strong></div> : null}
                </div>

                <button className="button button-secondary button-full" disabled={testing || previewReadOnly} onClick={() => testMutation.mutate(connection.id)}>
                  <RefreshCw size={15} className={testing ? 'spin' : ''} />
                  {previewReadOnly ? 'Indisponível no preview' : testing ? 'Testando…' : 'Testar conexão'}
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

      {createOpen ? (
        <div className="drawer-backdrop" role="presentation" onMouseDown={() => setCreateOpen(false)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-label="Nova conexão" onMouseDown={(event) => event.stopPropagation()}>
            <div className="drawer-header"><div><span className="eyebrow">Integração</span><h2>Nova conexão</h2></div><button className="icon-button" type="button" onClick={() => setCreateOpen(false)}><X size={18} /></button></div>
            <form className="financial-form drawer-form" onSubmit={(event) => { event.preventDefault(); createMutation.mutate() }}>
              <label className="field"><span>Provider</span><select value={provider} onChange={(event) => setProvider(event.target.value as 'mock' | 'pixhub')}><option value="mock">Mock · desenvolvimento</option><option value="pixhub">Pixhub</option></select></label>
              <label className="field"><span>Nome da conexão</span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder={provider === 'mock' ? 'Mock QA' : 'Pixhub principal'} /></label>
              {provider === 'pixhub' ? <><label className="field"><span>Client ID</span><input value={clientId} onChange={(event) => setClientId(event.target.value)} autoComplete="off" /></label><label className="field"><span>Client secret</span><input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} autoComplete="new-password" /></label></> : <div className="inline-info">O provider Mock não usa credenciais e existe somente para desenvolvimento e staging.</div>}
              <div className="inline-info">Credenciais de providers reais são criptografadas no backend e não são exibidas novamente.</div>
              {createMutation.isError ? <div className="inline-error">{createMutation.error instanceof Error ? createMutation.error.message : 'Falha ao criar conexão.'}</div> : null}
              <button className="button button-primary button-full" type="submit" disabled={createMutation.isPending || (provider === 'pixhub' && (!clientId.trim() || !clientSecret))}>{createMutation.isPending ? 'Criando…' : 'Criar conexão'}</button>
            </form>
          </aside>
        </div>
      ) : null}
    </div>
  )
}
