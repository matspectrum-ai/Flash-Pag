import { useEffect, useState } from 'react'
import { KeyRound, ShieldCheck, X } from 'lucide-react'
import { api } from '../../api/client'

export function MFAActionDialog({ open, title, description, onClose, onVerified }: { open: boolean; title: string; description: string; onClose: () => void; onVerified: () => void }) {
  const [factorId, setFactorId] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setCode(''); setError(''); setFactorId(''); setChallengeId('')
    let cancelled = false
    api.mfaStepUpChallenge().then((result) => { if (!cancelled) { setFactorId(result.factor_id); setChallengeId(result.challenge_id) } }).catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Não foi possível iniciar a verificação.') })
    return () => { cancelled = true }
  }, [open])

  if (!open) return null
  async function verify() {
    if (code.length !== 6) return
    setLoading(true); setError('')
    try { await api.mfaStepUpVerify({ factor_id:factorId, challenge_id:challengeId, code }); onVerified() }
    catch (err) { setError(err instanceof Error ? err.message : 'Código inválido ou expirado.'); setCode('') }
    finally { setLoading(false) }
  }

  return <div className="drawer-backdrop" role="presentation"><aside className="drawer" role="dialog" aria-modal="true" aria-label="Verificação de segurança"><div className="drawer-header"><div><span className="eyebrow">Autenticação reforçada</span><h2>{title}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Fechar"><X size={18} /></button></div><div className="security-stepup-card"><ShieldCheck size={20} /><div><strong>Google Authenticator</strong><span>{description}</span></div></div><label className="field"><span>Código de 6 dígitos</span><div className="input-with-icon"><KeyRound size={16} /><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g,''))} placeholder="000000" /></div></label>{error ? <div className="inline-error">{error}</div> : null}<button className="button button-primary button-full" type="button" disabled={loading || code.length !== 6 || !factorId || !challengeId} onClick={() => void verify()}>{loading ? 'Verificando…' : 'Confirmar com autenticador'}</button></aside></div>
}
