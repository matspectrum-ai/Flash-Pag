import { useState, type FormEvent } from 'react'
import { LockKeyhole } from 'lucide-react'
import { useSession } from '../../app/session'

export function LoginPage() {
  const { login } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(email.trim(), password)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível entrar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="brand-lockup">
          <div className="brand-mark">F</div>
          <div>
            <strong>Flash Pag</strong>
            <span>Pix para sua operação</span>
          </div>
        </div>

        <div className="auth-heading">
          <div className="auth-icon"><LockKeyhole size={18} /></div>
          <h1 id="login-title">Acesse sua conta</h1>
          <p>Entre para acompanhar saldo, transações e integrações.</p>
        </div>

        <form onSubmit={submit} className="form-stack">
          <label className="field">
            <span>E-mail</span>
            <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label className="field">
            <span>Senha</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          {error ? <div className="inline-error" role="alert">{error}</div> : null}
          <button className="button button-primary button-full" type="submit" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  )
}
