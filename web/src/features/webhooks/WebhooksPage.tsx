import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CircleAlert, Copy, Plus, ShieldAlert, Webhook, X } from 'lucide-react'
import { api } from '../../api/client'
import type { CreatedWebhookEndpoint, WebhookEndpoint } from '../../api/types'
import { useSession } from '../../app/session'
import { formatDateTime } from '../../lib/format'
import { StatusBadge } from '../../components/ui/StatusBadge'

const eventOptions = [
  ['transaction.*', 'Todos os eventos de transação'],
  ['transaction.succeeded', 'Pagamento concluído'],
  ['transaction.pending', 'Pagamento pendente'],
  ['transaction.ambiguous', 'Pagamento ambíguo'],
  ['transaction.failed', 'Pagamento falhou'],
] as const

export function WebhooksPage() {
  const { organizationId } = useSession()
  const queryClient = useQueryClient()
  const previewReadOnly = import.meta.env.VITE_PREVIEW_READ_ONLY === 'true'
  const [creating, setCreating] = useState(false)
  const [url, setURL] = useState('')
  const [description, setDescription] = useState('')
  const [events, setEvents] = useState<string[]>(['transaction.*'])
  const [created, setCreated] = useState<CreatedWebhookEndpoint | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<WebhookEndpoint | null>(null)
  const [copied, setCopied] = useState(false)

  const accessQuery = useQuery({
    queryKey: ['access', organizationId],
    queryFn: () => api.access(organizationId!),
    enabled: Boolean(organizationId),
  })
  const webhooksQuery = useQuery({
    queryKey: ['webhook-endpoints', organizationId],
    queryFn: () => api.list<WebhookEndpoint>('webhook-endpoints', organizationId!),
    enabled: Boolean(organizationId),
  })

  const createMutation = useMutation({
    mutationFn: () => api.createWebhook(organizationId!, { url: url.trim(), description: description.trim() || undefined, events }),
    onSuccess: (endpoint) => {
      setCreated(endpoint)
      setCreating(false)
      setURL('')
      setDescription('')
      setEvents(['transaction.*'])
      void queryClient.invalidateQueries({ queryKey: ['webhook-endpoints', organizationId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (endpoint: WebhookEndpoint) => api.deleteWebhook(organizationId!, endpoint.id),
    onSuccess: () => {
      setDeleteCandidate(null)
      void queryClient.invalidateQueries({ queryKey: ['webhook-endpoints', organizationId] })
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (url.trim() && events.length && !previewReadOnly && accessQuery.data?.can_manage) createMutation.mutate()
  }

  const toggleEvent = (eventName: string, checked: boolean) => {
    if (eventName === 'transaction.*') {
      setEvents(checked ? ['transaction.*'] : [])
      return
    }
    setEvents((current) => {
      const withoutWildcard = current.filter((item) => item !== 'transaction.*')
      return checked ? [...withoutWildcard, eventName] : withoutWildcard.filter((item) => item !== eventName)
    })
  }

  const copySecret = async () => {
    if (!created?.secret) return
    await navigator.clipboard.writeText(created.secret)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  if (!organizationId) return <div className="empty-state"><strong>Selecione uma organização</strong><span>Webhooks são configurados separadamente por organização.</span></div>
  if (webhooksQuery.isLoading || accessQuery.isLoading) return <div className="skeleton skeleton-panel" aria-busy="true" />
  if (webhooksQuery.isError || accessQuery.isError) return <div className="error-state"><CircleAlert size={22} /><strong>Não foi possível carregar os webhooks.</strong></div>

  const webhooks = webhooksQuery.data?.data ?? []

  return (
    <div className="page-stack">
      <section className="context-strip">
        <div className="context-strip-icon"><Webhook size={16} /></div>
        <div><strong>Eventos por tenant</strong><span>Uma organização recebe apenas eventos gerados pelas próprias transações. Segredos de assinatura também são isolados.</span></div>
      </section>

      <section className="toolbar">
        <div className="toolbar-copy"><strong>Endpoints</strong><span>Entregue atualizações de pagamentos ao backend do merchant.</span></div>
        <button className="button button-primary" type="button" disabled={!accessQuery.data?.can_manage} onClick={() => setCreating(true)}><Plus size={15} />Novo webhook</button>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Webhooks</h2><p>{webhooks.length} endpoint(s) nesta organização</p></div><Webhook size={18} /></div>
        <div className="webhook-list">
          {webhooks.map((endpoint) => (
            <article className="webhook-row" key={endpoint.id}>
              <div className="webhook-icon"><Webhook size={16} /></div>
              <div className="webhook-main"><div><strong>{endpoint.description || 'Webhook'}</strong><StatusBadge status={endpoint.status} /></div><code>{endpoint.url}</code><span>{endpoint.events.join(' · ')}</span></div>
              <div className="webhook-meta"><span>Criado</span><strong>{formatDateTime(endpoint.created_at)}</strong></div>
              {accessQuery.data?.can_manage ? <button className="button button-quiet" type="button" onClick={() => setDeleteCandidate(endpoint)}>Remover</button> : null}
            </article>
          ))}
          {!webhooks.length ? <div className="empty-state compact-empty"><Webhook size={23} /><strong>Nenhum webhook configurado</strong><span>Crie um endpoint HTTPS para receber atualizações dos pagamentos desta organização.</span></div> : null}
        </div>
      </section>

      {creating ? (
        <div className="drawer-backdrop" role="presentation" onMouseDown={() => setCreating(false)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-label="Novo webhook" onMouseDown={(event) => event.stopPropagation()}>
            <div className="drawer-header"><div><span className="eyebrow">Desenvolvedores</span><h2>Novo webhook</h2></div><button className="icon-button" type="button" onClick={() => setCreating(false)} aria-label="Fechar"><X size={18} /></button></div>
            <form className="financial-form drawer-form" onSubmit={submit}>
              <label className="field"><span>URL HTTPS</span><input type="url" value={url} onChange={(event) => setURL(event.target.value)} placeholder="https://api.suaempresa.com/webhooks/flashpag" autoFocus /></label>
              <label className="field"><span>Descrição <em>opcional</em></span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ex.: Backend de produção" /></label>
              <fieldset className="scope-fieldset"><legend>Eventos</legend>{eventOptions.map(([eventName, label]) => <label className="scope-option" key={eventName}><input type="checkbox" checked={events.includes(eventName)} onChange={(event) => toggleEvent(eventName, event.target.checked)} /><span><strong>{label}</strong><code>{eventName}</code></span></label>)}</fieldset>
              <div className="inline-info">Use HTTPS público. Endereços privados e loopback são rejeitados fora do desenvolvimento local.</div>
              {previewReadOnly ? <div className="inline-info">No preview a criação de webhooks está bloqueada.</div> : null}
              {createMutation.isError ? <div className="inline-error">{createMutation.error instanceof Error ? createMutation.error.message : 'Não foi possível criar o webhook.'}</div> : null}
              <button className="button button-primary button-full" type="submit" disabled={previewReadOnly || createMutation.isPending || !url.trim() || !events.length}>{previewReadOnly ? 'Bloqueado no preview' : createMutation.isPending ? 'Criando…' : 'Criar webhook'}</button>
            </form>
          </aside>
        </div>
      ) : null}

      {created ? (
        <div className="drawer-backdrop" role="presentation">
          <aside className="drawer secret-drawer" role="dialog" aria-modal="true" aria-label="Webhook criado">
            <div className="drawer-header"><div><span className="eyebrow">Endpoint criado</span><h2>Salve o segredo de assinatura</h2></div><button className="icon-button" type="button" onClick={() => setCreated(null)} aria-label="Fechar"><X size={18} /></button></div>
            <div className="secret-warning"><ShieldAlert size={18} /><div><strong>O segredo é exibido uma única vez.</strong><span>Use-o para validar a assinatura dos eventos recebidos pelo seu backend.</span></div></div>
            <div className="secret-box"><code>{created.secret}</code><button className="button button-secondary" type="button" onClick={() => void copySecret()}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copiado' : 'Copiar'}</button></div>
            <button className="button button-primary button-full" type="button" onClick={() => setCreated(null)}>Já salvei o segredo</button>
          </aside>
        </div>
      ) : null}

      {deleteCandidate ? (
        <div className="drawer-backdrop" role="presentation" onMouseDown={() => setDeleteCandidate(null)}>
          <aside className="confirm-sheet" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><ShieldAlert size={23} /><div><h2>Remover webhook?</h2><p>Eventos futuros deixarão de ser enviados para <span className="mono">{deleteCandidate.url}</span>.</p></div>{previewReadOnly ? <div className="inline-info">Remoção bloqueada no preview.</div> : null}<div className="confirm-actions"><button className="button button-quiet" type="button" onClick={() => setDeleteCandidate(null)}>Cancelar</button><button className="button button-danger" type="button" disabled={previewReadOnly || deleteMutation.isPending} onClick={() => deleteMutation.mutate(deleteCandidate)}>{deleteMutation.isPending ? 'Removendo…' : 'Remover endpoint'}</button></div></aside>
        </div>
      ) : null}
    </div>
  )
}
