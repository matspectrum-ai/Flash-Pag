import { useState, type FormEvent } from 'react'
import { ArrowRight, Building2, CircleCheck, LockKeyhole, Mail } from 'lucide-react'
import { useSession } from '../../app/session'
import { BrandMark } from '../../components/brand/BrandMark'
import './auth-onboarding.css'

type AuthMode = 'login' | 'register'

export function LoginPage() {
  const { login, register } = useSession()
  const previewReadOnly = import.meta.env.VITE_PREVIEW_READ_ONLY === 'true'
  const [mode, setMode] = useState<AuthMode>('login')
  const [merchantName, setMerchantName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmationSent, setConfirmationSent] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setConfirmationSent(false)
    try {
      if (mode === 'login') {
        await login(email.trim(), password)
      } else {
        if (previewReadOnly) {
          setError('Criação de conta está bloqueada no ambiente de preview.')
          return
        }
        const result = await register(merchantName.trim(), email.trim(), password)
        if (result.requires_email_confirmation && !result.authenticated) {
          setConfirmationSent(true)
          setMode('login')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : mode === 'login' ? 'Não foi possível entrar.' : 'Não foi possível criar a conta.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <div className="brand-lockup auth-brand-lockup">
          <BrandMark />
          <strong>Flash Pag</strong>
        </div>
        <div className="auth-brand-copy">
          <span className="eyebrow">Infraestrutura Pix</span>
          <h1>Pagamentos Pix para sua operação.</h1>
          <p>Um ambiente único para acompanhar pagamentos, clientes, integrações e organizações com isolamento por tenant.</p>
        </div>
        <div className="auth-trust-list">
          <div><LockKeyhole size={16} /><span>Credenciais e documentos protegidos no backend</span></div>
          <div><Building2 size={16} /><span>Conta Merchant com organizações isoladas</span></div>
        </div>
      </section>

      <section className="auth-form-panel">
        <div className="auth-card">
          <div className="auth-mode-switch" role="tablist" aria-label="Acesso à Flash Pag">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError('') }}>Entrar</button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError('') }}>Criar conta</button>
          </div>

          <div className="auth-card-header">
            <span className="eyebrow">{mode === 'login' ? 'Conta Flash Pag' : 'Novo Merchant'}</span>
            <h2>{mode === 'login' ? 'Acesse sua conta' : 'Crie sua conta'}</h2>
            <p>{mode === 'login' ? 'Entre para acompanhar sua operação Pix.' : 'Depois do cadastro, complete a verificação KYC/KYB para habilitar operações financeiras reais.'}</p>
          </div>

          {confirmationSent ? (
            <div className="auth-success"><CircleCheck size={18} /><div><strong>Confirme seu e-mail</strong><span>Enviamos a confirmação para {email}. Depois, volte aqui para entrar e concluir seu KYC.</span></div></div>
          ) : null}

          <form className="auth-form" onSubmit={submit}>
            {mode === 'register' ? (
              <label className="field">
                <span>Empresa / Merchant</span>
                <div className="input-with-icon"><Building2 size={16} /><input value={merchantName} onChange={(event) => setMerchantName(event.target.value)} placeholder="Nome da sua empresa" autoComplete="organization" required /></div>
              </label>
            ) : null}
            <label className="field">
              <span>E-mail</span>
              <div className="input-with-icon"><Mail size={16} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com" autoComplete="email" required /></div>
            </label>
            <label className="field">
              <span>Senha</span>
              <div className="input-with-icon"><LockKeyhole size={16} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'register' ? 'Mínimo de 8 caracteres' : 'Sua senha'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={mode === 'register' ? 8 : undefined} required /></div>
            </label>

            {mode === 'register' && previewReadOnly ? <div className="inline-info">A criação de contas fica desabilitada no preview read-only.</div> : null}
            {error ? <div className="auth-error">{error}</div> : null}

            <button className="button button-primary button-full auth-submit" type="submit" disabled={loading || (mode === 'register' && previewReadOnly)}>
              {loading ? (mode === 'login' ? 'Entrando…' : 'Criando…') : (mode === 'login' ? 'Entrar' : 'Criar conta')}
              {!loading ? <ArrowRight size={16} /> : null}
            </button>
          </form>

          {mode === 'register' ? <p className="auth-legal">Operações Pix reais e saques permanecem bloqueados até a aprovação do KYC/KYB.</p> : null}
        </div>
      </section>
    </main>
  )
}
