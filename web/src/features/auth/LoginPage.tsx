import { useState, type FormEvent } from 'react'
import { ArrowRight, Building2, CircleCheck, FileKey2, KeyRound, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import { api, ApiError } from '../../api/client'
import { useSession } from '../../app/session'
import { BrandMark } from '../../components/brand/BrandMark'
import { MFAQRCode } from '../../components/security/MFAQRCode'
import type { MFAEnrollment } from '../../api/types'
import './auth-onboarding.css'

type AuthMode = 'login' | 'register'
type SecurityMode = 'credentials' | 'setup' | 'challenge' | 'recovery'
type RecoveryStage = 'kit' | 'password'

function fileToBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  })
}

export function LoginPage() {
  const { login, register, refreshMe } = useSession()
  const previewReadOnly = import.meta.env.VITE_PREVIEW_READ_ONLY === 'true'
  const [mode, setMode] = useState<AuthMode>('login')
  const [securityMode, setSecurityMode] = useState<SecurityMode>('credentials')
  const [recoveryStage, setRecoveryStage] = useState<RecoveryStage>('kit')
  const [merchantName, setMerchantName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [recoveryIdentifier, setRecoveryIdentifier] = useState('')
  const [recoveryKit, setRecoveryKit] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmationSent, setConfirmationSent] = useState(false)
  const [recoverySuccess, setRecoverySuccess] = useState(false)
  const [enrollment, setEnrollment] = useState<MFAEnrollment | null>(null)
  const [factorId, setFactorId] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [code, setCode] = useState('')

  async function beginEnrollment() {
    setError('')
    setLoading(true)
    try {
      const result = await api.mfaEnroll()
      setEnrollment(result)
      setFactorId(result.factor_id)
      setSecurityMode('setup')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível iniciar a configuração do autenticador.')
    } finally { setLoading(false) }
  }

  async function beginChallenge(factor?: string, challenge?: string) {
    setError('')
    setLoading(true)
    try {
      const result = factor && challenge ? { factor_id: factor, challenge_id: challenge } : await api.mfaChallenge(factor)
      setFactorId(result.factor_id)
      setChallengeId(result.challenge_id)
      setSecurityMode('challenge')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível iniciar a verificação.')
    } finally { setLoading(false) }
  }

  async function verifyMFA(event?: FormEvent) {
    event?.preventDefault()
    if (code.trim().length !== 6) { setError('Digite o código de 6 dígitos do Google Authenticator.'); return }
    setLoading(true); setError('')
    try {
      await api.mfaVerify({ factor_id: factorId, challenge_id: challengeId || undefined, code: code.trim() })
      await refreshMe()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Código inválido ou expirado.')
      setCode('')
    } finally { setLoading(false) }
  }

  async function submitRecovery(event: FormEvent) {
    event.preventDefault()
    setLoading(true); setError('')
    try {
      if (recoveryStage === 'kit') {
        if (!recoveryIdentifier.trim() || !recoveryKit) { setError('Informe o identificador da conta e selecione o Recovery Kit.'); return }
        await api.recoveryChallenge(recoveryIdentifier.trim(), recoveryKit)
        setRecoveryStage('password')
      } else {
        if (password !== passwordConfirm) { setError('As senhas não coincidem.'); return }
        await api.recoveryResetPassword(password, passwordConfirm)
        setRecoverySuccess(true)
        setEmail(recoveryIdentifier.trim())
        setPassword('')
        setPasswordConfirm('')
        setSecurityMode('credentials')
        setMode('login')
        setRecoveryStage('kit')
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Não foi possível concluir a recuperação.')
    } finally { setLoading(false) }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setLoading(true); setError(''); setConfirmationSent(false)
    try {
      if (mode === 'login') {
        const result = await login(email.trim(), password)
        if (result.ok) return
        if (result.mfa_required === 'challenge') await beginChallenge(result.factor_id, result.challenge_id)
        else await beginEnrollment()
      } else {
        if (previewReadOnly) { setError('Criação de conta está bloqueada no ambiente de preview.'); return }
        const result = await register(merchantName.trim(), email.trim(), password)
        if (result.requires_email_confirmation && !result.authenticated) {
          setConfirmationSent(true); setMode('login'); return
        }
        if (result.mfa_required === 'enroll') await beginEnrollment()
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : mode === 'login' ? 'Não foi possível entrar.' : 'Não foi possível criar a conta.')
    } finally { setLoading(false) }
  }

  const credentials = (
    <>
      <div className="auth-card-header">
        <span className="eyebrow">{mode === 'login' ? 'Conta Flash Pag' : 'Novo Merchant'}</span>
        <h2>{mode === 'login' ? 'Acesse sua conta' : 'Crie sua conta'}</h2>
        <p>{mode === 'login' ? 'Entre com sua senha. O acesso é protegido pelo Google Authenticator.' : 'Depois do cadastro, ative o Google Authenticator antes de acessar a operação.'}</p>
      </div>
      {confirmationSent ? <div className="auth-success"><CircleCheck size={18} /><div><strong>Confirme seu e-mail</strong><span>Enviamos a confirmação para {email}. Depois, volte aqui para entrar e concluir a proteção da conta.</span></div></div> : null}
      {recoverySuccess ? <div className="auth-success"><CircleCheck size={18} /><div><strong>Conta recuperada</strong><span>A senha foi redefinida e o autenticador anterior foi invalidado. Entre novamente e configure um novo Google Authenticator.</span></div></div> : null}
      <form className="auth-form" onSubmit={submit}>
        {mode === 'register' ? <label className="field"><span>Empresa / Merchant</span><div className="input-with-icon"><Building2 size={16} /><input value={merchantName} onChange={(event) => setMerchantName(event.target.value)} placeholder="Nome da sua empresa" autoComplete="organization" required /></div></label> : null}
        <label className="field"><span>E-mail</span><div className="input-with-icon"><Mail size={16} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com" autoComplete="email" required /></div></label>
        <label className="field"><span>Senha</span><div className="input-with-icon"><LockKeyhole size={16} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'register' ? 'Mínimo de 8 caracteres' : 'Sua senha'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={mode === 'register' ? 8 : undefined} required /></div></label>
        {mode === 'register' && previewReadOnly ? <div className="inline-info">A criação de contas fica desabilitada no preview read-only.</div> : null}
        {error ? <div className="auth-error">{error}</div> : null}
        <button className="button button-primary button-full auth-submit" type="submit" disabled={loading || (mode === 'register' && previewReadOnly)}>{loading ? (mode === 'login' ? 'Verificando…' : 'Criando…') : (mode === 'login' ? 'Entrar' : 'Criar conta')} {!loading ? <ArrowRight size={16} /> : null}</button>
      </form>
      {mode === 'login' ? <button className="auth-link-button" type="button" onClick={() => { setSecurityMode('recovery'); setRecoveryStage('kit'); setError(''); setRecoverySuccess(false) }}>Não consigo acessar minha conta</button> : null}
      {mode === 'register' ? <p className="auth-legal">Operações Pix reais e saques permanecem bloqueados até a aprovação do KYC/KYB e a proteção MFA da conta.</p> : null}
    </>
  )

  const recovery = recoveryStage === 'kit' ? (
    <div className="mfa-auth-flow">
      <div className="auth-card-header"><span className="eyebrow">Recuperação offline</span><h2>Recupere sua conta</h2><p>Use o identificador da conta e o Recovery Kit que você manteve offline. Nenhum e-mail ou SMS é necessário.</p></div>
      <div className="inline-info"><FileKey2 size={18} /><span>O Recovery Kit é uma credencial de alto valor. Nunca envie o arquivo para outra pessoa e não o armazene em um local público.</span></div>
      <form className="auth-form" onSubmit={submitRecovery}>
        <label className="field"><span>Identificador da conta</span><div className="input-with-icon"><Mail size={16} /><input type="email" value={recoveryIdentifier} onChange={(event) => setRecoveryIdentifier(event.target.value)} placeholder="voce@empresa.com" autoComplete="username" required /></div></label>
        <label className="field"><span>Recovery Kit</span><input type="file" accept=".recovery,application/octet-stream" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { setRecoveryKit(await fileToBase64(file)); setError('') } catch { setError('Não foi possível ler o Recovery Kit.') } }} required /></label>
        {error ? <div className="auth-error">{error}</div> : null}
        <button className="button button-primary button-full" type="submit" disabled={loading || !recoveryKit}>{loading ? 'Validando…' : 'Validar Recovery Kit'}</button>
      </form>
      <button className="auth-link-button" type="button" onClick={() => { setSecurityMode('credentials'); setError('') }}>Voltar para o login</button>
    </div>
  ) : (
    <div className="mfa-auth-flow">
      <div className="auth-card-header"><span className="eyebrow">Recuperação confirmada</span><h2>Defina uma nova senha</h2><p>Após concluir, o Recovery Kit será invalidado, todas as sessões serão encerradas e o antigo autenticador será removido. Você precisará configurar um novo autenticador no próximo login.</p></div>
      <form className="auth-form" onSubmit={submitRecovery}><label className="field"><span>Nova senha</span><div className="input-with-icon"><LockKeyhole size={16} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required /></div></label><label className="field"><span>Confirme a nova senha</span><div className="input-with-icon"><LockKeyhole size={16} /><input type="password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required /></div></label>{error ? <div className="auth-error">{error}</div> : null}<button className="button button-primary button-full" type="submit" disabled={loading || password.length < 8 || password !== passwordConfirm}>{loading ? 'Atualizando…' : 'Redefinir senha e encerrar sessões'}</button></form>
    </div>
  )

  const security = securityMode === 'setup' ? (
    <div className="mfa-auth-flow">
      <div className="auth-card-header"><span className="eyebrow">Proteção obrigatória</span><h2>Ative o Google Authenticator</h2><p>Escaneie o QR Code no aplicativo autenticador e confirme com o código de 6 dígitos.</p></div>
      {enrollment ? <><MFAQRCode uri={enrollment.uri} alt="QR Code para configurar o Google Authenticator" /><div className="mfa-secret"><span>Se não conseguir escanear</span><code>{enrollment.secret}</code></div></> : <div className="skeleton skeleton-panel" />}
      <form className="auth-form" onSubmit={verifyMFA}><label className="field"><span>Código do autenticador</span><div className="input-with-icon"><KeyRound size={16} /><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} placeholder="000000" autoFocus required /></div></label>{error ? <div className="auth-error">{error}</div> : null}<button className="button button-primary button-full" type="submit" disabled={loading || code.length !== 6}>{loading ? 'Confirmando…' : 'Ativar proteção'}</button></form>
    </div>
  ) : (
    <div className="mfa-auth-flow"><div className="auth-card-header"><span className="eyebrow">Verificação em duas etapas</span><h2>Confirme seu acesso</h2><p>Abra o Google Authenticator e informe o código atual para continuar.</p></div><div className="mfa-step-icon"><ShieldCheck size={24} /></div><form className="auth-form" onSubmit={verifyMFA}><label className="field"><span>Código de 6 dígitos</span><div className="input-with-icon"><KeyRound size={16} /><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} placeholder="000000" autoFocus required /></div></label>{error ? <div className="auth-error">{error}</div> : null}<button className="button button-primary button-full" type="submit" disabled={loading || code.length !== 6}>{loading ? 'Verificando…' : 'Confirmar acesso'}</button></form></div>
  )

  return (
    <main className="auth-page">
      <section className="auth-brand-panel"><div className="brand-lockup auth-brand-lockup"><BrandMark /><strong>Flash Pag</strong></div><div className="auth-brand-copy"><span className="eyebrow">Infraestrutura Pix</span><h1>Pagamentos Pix para sua operação.</h1><p>Um ambiente único para acompanhar pagamentos, clientes, integrações e organizações com isolamento por tenant.</p></div><div className="auth-trust-list"><div><LockKeyhole size={16} /><span>Credenciais e documentos protegidos no backend</span></div><div><ShieldCheck size={16} /><span>Google Authenticator para acesso e ações financeiras sensíveis</span></div></div></section>
      <section className="auth-form-panel"><div className="auth-card">
        {securityMode === 'credentials' ? <div className="auth-mode-switch" role="tablist" aria-label="Acesso à Flash Pag"><button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError('') }}>Entrar</button><button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError('') }}>Criar conta</button></div> : null}
        {securityMode === 'credentials' ? credentials : securityMode === 'recovery' ? recovery : security}
      </div></section>
    </main>
  )
}
