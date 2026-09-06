import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CircleAlert, Copy, KeyRound, Plus, ShieldAlert, X } from 'lucide-react'
import { api } from '../../api/client'
import type { ApiKey, CreatedApiKey } from '../../api/types'
import { useSession } from '../../app/session'
import { formatDateTime } from '../../lib/format'
import { StatusBadge } from '../../components/ui/StatusBadge'

const availableScopes = [
  ['pix:read', 'Ler pagamentos Pix'],
  ['pix:write', 'Criar cobranças Pix'],
  ['balance:read', 'Ler saldo'],
  ['customers:read', 'Ler clientes'],
  ['customers:write', 'Criar clientes'],
  ['webhooks:write', 'Gerenciar webhooks'],
] as const

export function ApiKeysPage() {
  const { organizationId } = useSession()
  const queryClient = useQueryClient()
  const previewReadOnly = import.meta.env.VITE_PREVIEW_READ_ONLY === 'true'
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>(availableScopes.map(([scope]) => scope))
  const [created, setCreated] = useState<CreatedApiKey | null>(null)
  const [revokeCandidate, setRevokeCandidate] = useState<ApiKey | null>(null)
  const [copied, setCopied] = useState(false)

  const accessQuery = useQuery({
    queryKey: ['access', organizationId],
    queryFn: () => api.access(organizationId!),
    enabled: Boolean(organizationId),
  })
  const keysQuery = useQuery({
    queryKey: ['api-keys', organizationId],
    queryFn: () => api.list<ApiKey>('api-keys', organizationId!),
    enabled: Boolean(organizationId),
  })

  const createMutation = useMutation({
    mutationFn: () => api.createAPIKey(organizationId!, { name: name.trim(), scopes }),
    onSuccess: (key) => {
      setCreated(key)
      setCreating(false)
      setName('')
      setScopes(availableScopes.map(([scope]) => scope))
      void queryClient.invalidateQueries({ queryKey: ['api-keys', organizationId] })
    },
  })

  const revokeMutation = useMutation({
    mutationFn: (key: ApiKey) => api.revokeAPIKey(organizationId!, key.id),
    onSuccess: () => {
      setRevokeCandidate(null)
      void queryClient.invalidateQueries({ queryKey: ['api-keys', organizationId] })
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim() && scopes.length && !previewReadOnly && accessQuery.data?.can_manage) createMutation.mutate()
  }

  const copySecret = async () => {
    if (!created?.secret) return
    await navigator.clipboard.writeText(created.secret)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  if (!organizationId) return <div className="empty-state"><strong>Selecione uma organização</strong><span>API Keys nunca são compartilhadas entre organizações.</span></div>
  if (keysQuery.isLoading || accessQuery.isLoading) return <div className="skeleton skeleton-panel" aria-busy="true" />
  if (keysQuery.isError || accessQuery.isError) return <div className="error-state"><CircleAlert size={22} /><strong>Não foi possível carregar as API Keys.</strong></div>

  const keys = keysQuery.data?.data ?? []

  return (
    <div className="page-stack">
      <section className="context-strip">
        <div className="context-strip-icon"><ShieldAlert size={16} /></div>
        <div><strong>Credenciais por organização</strong><span>Cada chave autentica somente a organização em que foi criada. O segredo completo é exibido uma única vez.</span></div>
      </section>

      <section className="toolbar">
        <div className="toolbar-copy"><strong>Credenciais de API</strong><span>Use chaves separadas por aplicação e ambiente.</span></div>
        <button className="button button-primary" type="button" disabled={!accessQuery.data?.can_manage} onClick={() => setCreating(true)}><Plus size={15} />Nova API Key</button>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>API Keys</h2><p>{keys.filter((key) => !key.revoked_at).length} ativa(s) · {keys.length} total</p></div><KeyRound size={18} /></div>
        <div className="credential-list">
          {keys.map((key) => (
            <article className="credential-row" key={key.id}>
              <div className="credential-icon"><KeyRound size={16} /></div>
              <div className="credential-main"><div><strong>{key.name}</strong><StatusBadge status={key.revoked_at ? 'revoked' : 'active'} /></div><code>{key.prefix}••••••••</code><span>{key.scopes.join(' · ')}</span></div>
              <div className="credential-meta"><span>Último uso</span><strong>{formatDateTime(key.last_used_at || undefined)}</strong><small>Criada {formatDateTime(key.created_at)}</small></div>
              {!key.revoked_at && accessQuery.data?.can_manage ? <button className="button button-quiet" type="button" onClick={() => setRevokeCandidate(key)}>Revogar</button> : null}
            </article>
          ))}
          {!keys.length ? <div className="empty-state compact-empty"><KeyRound size={23} /><strong>Nenhuma API Key</strong><span>Crie uma credencial para integrar um sistema à API da Flash Pag.</span></div> : null}
        </div>
      </section>

      {creating ? (
        <div className="drawer-backdrop" role="presentation" onMouseDown={() => setCreating(false)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-label="Nova API Key" onMouseDown={(event) => event.stopPropagation()}>
            <div className="drawer-header"><div><span className="eyebrow">Desenvolvedores</span><h2>Nova API Key</h2></div><button className="icon-button" type="button" onClick={() => setCreating(false)} aria-label="Fechar"><X size={18} /></button></div>
            <form className="financial-form drawer-form" onSubmit={submit}>
              <label className="field"><span>Nome</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Backend produção" autoFocus /></label>
              <fieldset className="scope-fieldset"><legend>Permissões</legend>{availableScopes.map(([scope, label]) => <label className="scope-option" key={scope}><input type="checkbox" checked={scopes.includes(scope)} onChange={(event) => setScopes((current) => event.target.checked ? [...current, scope] : current.filter((item) => item !== scope))} /><span><strong>{label}</strong><code>{scope}</code></span></label>)}</fieldset>
              {previewReadOnly ? <div className="inline-info">No preview a criação de credenciais está bloqueada.</div> : null}
              {createMutation.isError ? <div className="inline-error">{createMutation.error instanceof Error ? createMutation.error.message : 'Não foi possível criar a chave.'}</div> : null}
              <button className="button button-primary button-full" type="submit" disabled={previewReadOnly || createMutation.isPending || !name.trim() || !scopes.length}>{previewReadOnly ? 'Bloqueado no preview' : createMutation.isPending ? 'Criando…' : 'Criar API Key'}</button>
            </form>
          </aside>
        </div>
      ) : null}

      {created ? (
        <div className="drawer-backdrop" role="presentation">
          <aside className="drawer secret-drawer" role="dialog" aria-modal="true" aria-label="API Key criada">
            <div className="drawer-header"><div><span className="eyebrow">Criada com sucesso</span><h2>Salve esta chave agora</h2></div><button className="icon-button" type="button" onClick={() => setCreated(null)} aria-label="Fechar"><X size={18} /></button></div>
            <div className="secret-warning"><ShieldAlert size={18} /><div><strong>Ela não será exibida novamente.</strong><span>Armazene o segredo em um cofre de credenciais e nunca envie por chat ou commit.</span></div></div>
            <div className="secret-box"><code>{created.secret}</code><button className="button button-secondary" type="button" onClick={() => void copySecret()}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copiada' : 'Copiar'}</button></div>
            <button className="button button-primary button-full" type="button" onClick={() => setCreated(null)}>Já salvei a chave</button>
          </aside>
        </div>
      ) : null}

      {revokeCandidate ? (
        <div className="drawer-backdrop" role="presentation" onMouseDown={() => setRevokeCandidate(null)}>
          <aside className="confirm-sheet" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><ShieldAlert size={23} /><div><h2>Revogar {revokeCandidate.name}?</h2><p>Integrações usando esta chave deixarão de autenticar imediatamente.</p></div>{previewReadOnly ? <div className="inline-info">Revogação bloqueada no preview.</div> : null}<div className="confirm-actions"><button className="button button-quiet" type="button" onClick={() => setRevokeCandidate(null)}>Cancelar</button><button className="button button-danger" type="button" disabled={previewReadOnly || revokeMutation.isPending} onClick={() => revokeMutation.mutate(revokeCandidate)}>{revokeMutation.isPending ? 'Revogando…' : 'Revogar chave'}</button></div></aside>
        </div>
      ) : null}
    </div>
  )
}
