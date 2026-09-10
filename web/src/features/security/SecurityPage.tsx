import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, ShieldCheck, Smartphone, Download, FileKey2 } from 'lucide-react'
import { api } from '../../api/client'
import { useSession } from '../../app/session'
import { MFAQRCode } from '../../components/security/MFAQRCode'
import type { MFAEnrollment } from '../../api/types'

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
  if (statusQuery.isError) return <div className="error-state"><ShieldCheck size={22} /><strong>Não foi possível carregar a proteção da conta.</strong></div>
  const enabled = Boolean(statusQuery.data?.enabled)
  const recoveryConfigured = Boolean(recoveryQuery.data?.configured)

  return <div className="page-stack">
    <section className="panel security-hero"><div className="security-hero-icon"><ShieldCheck size={24} /></div><div><span className="eyebrow">Segurança da conta</span><h2>Autenticação e recuperação</h2><p>Google Authenticator protege o acesso e ações sensíveis. O Recovery Kit permite recuperar a conta sem depender de e-mail ou SMS.</p></div><span className={`status-pill ${enabled ? 'success' : 'warning'}`}>{enabled ? 'Proteção ativa' : 'Configuração necessária'}</span></section>
    <section className="security-grid">
      <article className="panel"><div className="panel-header"><div><h2>Autenticador</h2><p>TOTP compatível com Google Authenticator e outros apps autenticadores.</p></div><Smartphone size={18} /></div>{enabled ? <div className="security-enabled"><ShieldCheck size={19} /><div><strong>Proteção ativa</strong><span>{statusQuery.data?.factors.map((factor) => factor.friendly_name || 'Authenticator').join(' · ')}</span></div></div> : <div className="security-disabled"><KeyRound size={20} /><div><strong>Ative antes de operar</strong><span>Sem um autenticador verificado, a conta não pode concluir o fluxo de acesso nem ações de alto risco.</span></div><button className="button button-primary" type="button" disabled={enrollMutation.isPending} onClick={() => enrollMutation.mutate()}>{enrollMutation.isPending ? 'Preparando…' : 'Configurar'}</button></div>}</article>
      <article className="panel"><div className="panel-header"><div><h2>Recovery Kit</h2><p>Credencial offline para recuperar a conta quando o autenticador estiver indisponível.</p></div><FileKey2 size={18} /></div><div className="security-rule-list"><div><strong>Offline</strong><span>O Flash Pag não armazena o arquivo nem o segredo em texto puro.</span></div><div><strong>Uso único por geração</strong><span>Depois de usado em uma recuperação, o kit é invalidado.</span></div><div><strong>Sem e-mail</strong><span>A recuperação usa a posse do arquivo e o identificador da conta.</span></div></div>{recoveryConfigured ? <div className="security-enabled"><ShieldCheck size={19} /><div><strong>Recovery Kit configurado</strong><span>Gerar outro substitui e invalida o kit anterior.</span></div></div> : <div className="security-disabled"><FileKey2 size={20} /><div><strong>Nenhum kit ativo</strong><span>Crie agora e mantenha o arquivo em armazenamento offline seguro.</span></div></div>}{recoveryNotice ? <div className="inline-info">{recoveryNotice}</div> : null}<button className="button button-secondary button-full" type="button" disabled={!enabled || recoveryMutation.isPending} onClick={() => { setRecoveryNotice(''); recoveryMutation.mutate() }}><Download size={16} />{recoveryMutation.isPending ? 'Gerando…' : recoveryConfigured ? 'Gerar novo Recovery Kit' : 'Baixar Recovery Kit'}</button>{!enabled ? <span className="form-hint">Ative e confirme o Google Authenticator antes de criar o kit.</span> : null}</article>
    </section>
    <section className="panel"><div className="panel-header"><div><h2>Quando será solicitado</h2><p>Autenticação reforçada por ação.</p></div><ShieldCheck size={18} /></div><div className="security-rule-list"><div><strong>Login</strong><span>Senha + código de 6 dígitos.</span></div><div><strong>API Keys</strong><span>Revalidação do autenticador antes de criar ou revogar.</span></div><div><strong>Saques</strong><span>Revalidação antes de iniciar uma saída financeira.</span></div><div><strong>Recuperação</strong><span>Recovery Kit não autoriza saques nem outras operações financeiras diretamente.</span></div></div></section>
    {enrollment ? <div className="drawer-backdrop" role="presentation"><aside className="drawer" role="dialog" aria-modal="true" aria-label="Configurar Google Authenticator"><div className="drawer-header"><div><span className="eyebrow">Proteção</span><h2>Conectar autenticador</h2></div></div><p className="drawer-copy">Escaneie o QR Code com o Google Authenticator. Depois informe o código atual para confirmar que o dispositivo foi configurado.</p><MFAQRCode uri={enrollment.uri} alt="QR Code do Google Authenticator" /><div className="mfa-secret"><span>Chave manual</span><code>{enrollment.secret}</code></div><label className="field"><span>Código de 6 dígitos</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} autoFocus placeholder="000000" /></label>{error ? <div className="inline-error">{error}</div> : null}<button className="button button-primary button-full" type="button" disabled={verifyMutation.isPending || code.length !== 6} onClick={() => verifyMutation.mutate()}>{verifyMutation.isPending ? 'Confirmando…' : 'Ativar Google Authenticator'}</button></aside></div> : null}
  </div>
}
