import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, ShieldCheck, Smartphone } from 'lucide-react'
import { api } from '../../api/client'
import { useSession } from '../../app/session'
import type { MFAEnrollment } from '../../api/types'

export function SecurityPage() {
  const { refreshMe } = useSession()
  const queryClient = useQueryClient()
  const [enrollment, setEnrollment] = useState<MFAEnrollment | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const statusQuery = useQuery({ queryKey: ['mfa-status'], queryFn: api.mfaStatus })
  const enrollMutation = useMutation({ mutationFn: api.mfaEnroll, onSuccess: (result) => { setEnrollment(result); setError('') } })
  const verifyMutation = useMutation({
    mutationFn: () => api.mfaVerify({ factor_id: enrollment!.factor_id, code }),
    onSuccess: async () => { setEnrollment(null); setCode(''); await queryClient.invalidateQueries({ queryKey: ['mfa-status'] }); await refreshMe() },
    onError: (err) => setError(err instanceof Error ? err.message : 'Código inválido.'),
  })

  if (statusQuery.isLoading) return <div className="skeleton skeleton-panel" aria-busy="true" />
  if (statusQuery.isError) return <div className="error-state"><ShieldCheck size={22} /><strong>Não foi possível carregar a proteção da conta.</strong></div>
  const enabled = Boolean(statusQuery.data?.enabled)

  return <div className="page-stack">
    <section className="panel security-hero"><div className="security-hero-icon"><ShieldCheck size={24} /></div><div><span className="eyebrow">Segurança da conta</span><h2>Google Authenticator</h2><p>O mesmo segundo fator protege o login, a criação de credenciais de API e ações financeiras sensíveis, como saques.</p></div><span className={`status-pill ${enabled ? 'success' : 'warning'}`}>{enabled ? 'Ativo' : 'Configuração necessária'}</span></section>
    <section className="security-grid">
      <article className="panel"><div className="panel-header"><div><h2>Autenticador</h2><p>TOTP compatível com Google Authenticator e outros apps autenticadores.</p></div><Smartphone size={18} /></div>{enabled ? <div className="security-enabled"><ShieldCheck size={19} /><div><strong>Proteção ativa</strong><span>{statusQuery.data?.factors.map((factor) => factor.friendly_name || 'Authenticator').join(' · ')}</span></div></div> : <div className="security-disabled"><KeyRound size={20} /><div><strong>Ative antes de operar</strong><span>Sem um autenticador verificado, a conta não pode concluir o fluxo de acesso nem ações de alto risco.</span></div><button className="button button-primary" type="button" disabled={enrollMutation.isPending} onClick={() => enrollMutation.mutate()}>{enrollMutation.isPending ? 'Preparando…' : 'Configurar'}</button></div>}</article>
      <article className="panel"><div className="panel-header"><div><h2>Quando será solicitado</h2><p>Autenticação reforçada por ação.</p></div><ShieldCheck size={18} /></div><div className="security-rule-list"><div><strong>Login</strong><span>Senha + código de 6 dígitos.</span></div><div><strong>API Keys</strong><span>Revalidação do autenticador antes de criar ou revogar.</span></div><div><strong>Saques</strong><span>Revalidação antes de iniciar uma saída financeira.</span></div></div></article>
    </section>
    {enrollment ? <div className="drawer-backdrop" role="presentation"><aside className="drawer" role="dialog" aria-modal="true" aria-label="Configurar Google Authenticator"><div className="drawer-header"><div><span className="eyebrow">Proteção</span><h2>Conectar autenticador</h2></div></div><p className="drawer-copy">Escaneie o QR Code com o Google Authenticator. Depois informe o código atual para confirmar que o dispositivo foi configurado.</p><div className="mfa-qr"><img src={enrollment.qr_code} alt="QR Code do Google Authenticator" /></div><div className="mfa-secret"><span>Chave manual</span><code>{enrollment.secret}</code></div><label className="field"><span>Código de 6 dígitos</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} autoFocus placeholder="000000" /></label>{error ? <div className="inline-error">{error}</div> : null}<button className="button button-primary button-full" type="button" disabled={verifyMutation.isPending || code.length !== 6} onClick={() => verifyMutation.mutate()}>{verifyMutation.isPending ? 'Confirmando…' : 'Ativar Google Authenticator'}</button></aside></div> : null}
  </div>
}
