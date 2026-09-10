import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileKey2, KeyRound, ShieldCheck, Smartphone } from 'lucide-react'
import { api } from '../../api/client'
import { useSession } from '../../app/session'
import { MFAQRCode } from '../../components/security/MFAQRCode'
import type { MFAEnrollment } from '../../api/types'
import './security.css'

function downloadRecoveryKit(filename: string, contentBase64: string) {
  const bytes = Uint8Array.from(atob(contentBase64), (char) => char.charCodeAt(0))
  const blob = new Blob([bytes], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function SecurityPage() {
  const { refreshMe } = useSession()
  const queryClient = useQueryClient()
  const [enrollment, setEnrollment] = useState<MFAEnrollment | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [recoveryNotice, setRecoveryNotice] = useState('')
  const statusQuery = useQuery({ queryKey: ['mfa-status'], queryFn: api.mfaStatus })
  const recoveryQuery = useQuery({ queryKey: ['recovery-status'], queryFn: api.recoveryStatus })
  const enrollMutation = useMutation({ mutationFn: api.mfaEnroll, onSuccess: (result) => { setEnrollment(result); setError('') } })
  const verifyMutation = useMutation({
    mutationFn: () => api.mfaVerify({ factor_id: enrollment!.factor_id, code }),
    onSuccess: async () => { setEnrollment(null); setCode(''); await queryClient.invalidateQueries({ queryKey: ['mfa-status'] }); await refreshMe() },
    onError: (err) => setError(err instanceof Error ? err.message : 'Código inválido.'),
  })
  const recoveryMutation = useMutation({
    mutationFn: api.recoverySetup,
    onSuccess: (result) => {
      downloadRecoveryKit(result.filename, result.content_base64)
      setRecoveryNotice('O arquivo foi baixado. Guarde-o offline; gerar um novo kit invalida o anterior.')
      void queryClient.invalidateQueries({ queryKey: ['recovery-status'] })
    },
    onError: (err) => setRecoveryNotice(err instanceof Error ? err.message : 'Não foi possível gerar o Recovery Kit.'),
  })

  if (statusQuery.isLoading || recoveryQuery.isLoading) return <div className="skeleton skeleton-panel" aria-busy="true" />
  if (statusQuery.isError || recoveryQuery.isError) return <div className="error-state"><ShieldCheck size={22} /><strong>Não foi possível carregar a proteção da conta.</strong></div>

  const enabled = Boolean(statusQuery.data?.enabled)
  const recoveryConfigured = Boolean(recoveryQuery.data?.configured)

  return <div className="page-stack security-page">
    <section className="panel security-status-bar">
      <div className={`security-status-icon ${enabled ? 'is-enabled' : 'is-warning'}`}><ShieldCheck size={20} /></div>
      <div className="security-status-copy">
        <span className="eyebrow">Segurança da conta</span>
        <strong>{enabled ? 'Proteção ativa' : 'Configuração necessária'}</strong>
        <span>{enabled ? 'Acesso e ações sensíveis exigem autenticação reforçada.' : 'Ative o autenticador antes de operar com dinheiro ou criar um Recovery Kit.'}</span>
      </div>
      <span className={`status-badge ${enabled ? 'status-success' : 'status-warning'}`}>{enabled ? 'Protegida' : 'Ação necessária'}</span>
    </section>

    <section className="security-columns">
      <article className="panel security-panel">
        <div className="panel-header">
          <div><h2>Autenticador</h2><p>TOTP compatível com Google Authenticator e outros apps autenticadores.</p></div>
          <Smartphone size={18} />
        </div>
        <div className="security-panel-body">
          {enabled ? <div className="security-state-row">
            <div className="security-state-icon success"><ShieldCheck size={17} /></div>
            <div><strong>Google Authenticator ativo</strong><span>{statusQuery.data?.factors.map((factor) => factor.friendly_name || 'Authenticator').join(' · ')}</span></div>
          </div> : <div className="security-state-row">
            <div className="security-state-icon warning"><KeyRound size={17} /></div>
            <div><strong>Ative a proteção</strong><span>O autenticador é obrigatório para concluir o acesso e autorizar ações de alto risco.</span></div>
            <button className="button button-primary" type="button" disabled={enrollMutation.isPending} onClick={() => enrollMutation.mutate()}>{enrollMutation.isPending ? 'Preparando…' : 'Configurar'}</button>
          </div>}
        </div>
      </article>

      <article className="panel security-panel">
        <div className="panel-header">
          <div><h2>Recovery Kit</h2><p>Credencial offline para recuperar a conta quando o autenticador estiver indisponível.</p></div>
          <FileKey2 size={18} />
        </div>
        <div className="security-panel-body">
          <div className="security-facts">
            <div><strong>{recoveryConfigured ? 'Configurado' : 'Ainda não criado'}</strong><span>{recoveryConfigured ? 'Um kit ativo está associado à conta.' : 'Crie um kit enquanto o autenticador estiver ativo.'}</span></div>
            <div><strong>Offline</strong><span>O arquivo e o segredo não ficam armazenados em texto puro no servidor.</span></div>
            <div><strong>Uso único</strong><span>Após uma recuperação, o kit é invalidado. Gerar outro revoga o anterior.</span></div>
          </div>
          {recoveryNotice ? <div className="inline-info">{recoveryNotice}</div> : null}
          <button className="button button-secondary" type="button" disabled={!enabled || recoveryMutation.isPending} onClick={() => { setRecoveryNotice(''); recoveryMutation.mutate() }}><Download size={15} />{recoveryMutation.isPending ? 'Gerando…' : recoveryConfigured ? 'Gerar novo Recovery Kit' : 'Baixar Recovery Kit'}</button>
          {!enabled ? <span className="form-hint">Ative e confirme o Google Authenticator antes de criar o kit.</span> : null}
        </div>
      </article>
    </section>

    <section className="panel security-actions-panel">
      <div className="panel-header">
        <div><h2>Proteção por ação</h2><p>Quando a autenticação reforçada é exigida no fluxo operacional.</p></div>
        <ShieldCheck size={18} />
      </div>
      <div className="security-action-list">
        <div><span>Acesso à conta</span><strong>Senha + autenticador</strong><small>Login com fator TOTP confirmado.</small></div>
        <div><span>API Keys</span><strong>MFA recente</strong><small>Revalidação antes de criar ou revogar credenciais.</small></div>
        <div><span>Saques e transferências</span><strong>MFA recente</strong><small>Step-up antes de iniciar uma operação financeira sensível.</small></div>
        <div><span>Recuperação</span><strong>Recovery Kit</strong><small>Recupera a conta, mas não concede autorização financeira.</small></div>
      </div>
    </section>

    {enrollment ? <div className="drawer-backdrop" role="presentation"><aside className="drawer" role="dialog" aria-modal="true" aria-label="Configurar Google Authenticator"><div className="drawer-header"><div><span className="eyebrow">Proteção</span><h2>Conectar autenticador</h2></div></div><p className="drawer-copy">Escaneie o QR Code com o Google Authenticator. Depois informe o código atual para confirmar que o dispositivo foi configurado.</p><MFAQRCode uri={enrollment.uri} alt="QR Code do Google Authenticator" /><div className="mfa-secret"><span>Chave manual</span><code>{enrollment.secret}</code></div><label className="field"><span>Código de 6 dígitos</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} autoFocus placeholder="000000" /></label>{error ? <div className="inline-error">{error}</div> : null}<button className="button button-primary button-full" type="button" disabled={verifyMutation.isPending || code.length !== 6} onClick={() => verifyMutation.mutate()}>{verifyMutation.isPending ? 'Confirmando…' : 'Ativar Google Authenticator'}</button></aside></div> : null}
  </div>
}
