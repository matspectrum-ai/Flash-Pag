import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, CircleAlert, Plus, ShieldCheck, Trash2, WalletCards, X } from 'lucide-react'
import { api, ApiError } from '../../api/client'
import type { WithdrawalDestination } from '../../api/types'
import { useSession } from '../../app/session'
import { formatBRL, formatDateTime } from '../../lib/format'
import { MFAActionDialog } from '../../components/security/MFAActionDialog'
import { StatusBadge } from '../../components/ui/StatusBadge'

function parseMinor(value: string) { const normalized = value.replace(/\./g,'').replace(',','.'); const n = Number(normalized); return Number.isFinite(n) ? Math.round(n * 100) : 0 }

export function WithdrawalsPage() {
  const { organizationId } = useSession()
  const queryClient = useQueryClient()
  const previewReadOnly = import.meta.env.VITE_PREVIEW_READ_ONLY === 'true'
  const [addingDestination, setAddingDestination] = useState(false)
  const [label, setLabel] = useState('Conta principal')
  const [pixKeyType, setPixKeyType] = useState('evp')
  const [pixKey, setPixKey] = useState('')
  const [bankName, setBankName] = useState('')
  const [branch, setBranch] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountType, setAccountType] = useState('checking')
  const [holderName, setHolderName] = useState('')
  const [holderDocument, setHolderDocument] = useState('')
  const [amount, setAmount] = useState('')
  const [stepUpOpen, setStepUpOpen] = useState(false)
  const [stepUpAction, setStepUpAction] = useState<'destination' | 'withdrawal' | null>(null)
  const [pendingDestination, setPendingDestination] = useState(false)
  const [pendingWithdrawal, setPendingWithdrawal] = useState(false)
  const [selectedDestination, setSelectedDestination] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const destinationsQuery = useQuery({ queryKey:['withdrawal-destinations',organizationId], queryFn:() => api.withdrawalDestinations(organizationId!), enabled:Boolean(organizationId) })
  const summaryQuery = useQuery({ queryKey:['summary',organizationId], queryFn:() => api.summary(organizationId!), enabled:Boolean(organizationId) })
  const destinationMutation = useMutation({
    mutationFn: () => api.createWithdrawalDestination(organizationId!, { label:label.trim(), pix_key_type:pixKeyType, pix_key:pixKey.trim(), bank_name:bankName.trim(), branch:branch.trim(), account_number:accountNumber.trim(), account_type:accountType, holder_name:holderName.trim(), holder_document:holderDocument.trim() }),
    onError: (err) => { if (err instanceof ApiError && err.status === 428) { setStepUpAction('destination'); setStepUpOpen(true) } else setError(err instanceof Error ? err.message : 'Não foi possível cadastrar o destino.') },
    onSuccess: () => { setAddingDestination(false); resetDestination(); void queryClient.invalidateQueries({queryKey:['withdrawal-destinations',organizationId]}) },
  })
  const withdrawalMutation = useMutation({
    mutationFn: () => api.createWithdrawal(organizationId!, { destination_id:selectedDestination, amount_minor:parseMinor(amount), description:'Saque Flash Pag', provider:'pixhub' }, crypto.randomUUID()),
    onError: (err) => { if (err instanceof ApiError && err.status === 428) { setStepUpAction('withdrawal'); setStepUpOpen(true) } else setError(err instanceof Error ? err.message : 'Não foi possível iniciar o saque.') },
    onSuccess: (tx) => { setSuccess(`Saque de ${formatBRL(tx.amount_minor)} iniciado. Status: ${tx.status}.`); setAmount(''); setError(''); void queryClient.invalidateQueries({queryKey:['summary',organizationId]}); void queryClient.invalidateQueries({queryKey:['transactions',organizationId]}) },
  })
  const disableMutation = useMutation({ mutationFn:(id:string) => api.disableWithdrawalDestination(organizationId!, id), onSuccess:()=>void queryClient.invalidateQueries({queryKey:['withdrawal-destinations',organizationId]}) })

  function resetDestination() { setLabel('Conta principal'); setPixKeyType('evp'); setPixKey(''); setBankName(''); setBranch(''); setAccountNumber(''); setAccountType('checking'); setHolderName(''); setHolderDocument('') }
  function submitDestination(event:FormEvent) { event.preventDefault(); setError(''); destinationMutation.mutate() }
  function submitWithdrawal(event:FormEvent) { event.preventDefault(); setError(''); setSuccess(''); if (!selectedDestination || parseMinor(amount) <= 0) { setError('Selecione um destino e informe um valor maior que R$ 0,00.'); return } setPendingWithdrawal(true); withdrawalMutation.mutate() }
  function completeStepUp() { setStepUpOpen(false); if (stepUpAction === 'destination') { setPendingDestination(true); destinationMutation.mutate() } else if (stepUpAction === 'withdrawal') { withdrawalMutation.mutate() } setStepUpAction(null) }

  if (!organizationId) return <div className="empty-state"><strong>Selecione uma organização</strong><span>Saques pertencem à organização ativa.</span></div>
  if (destinationsQuery.isLoading || summaryQuery.isLoading) return <div className="skeleton skeleton-panel" aria-busy="true" />
  if (destinationsQuery.isError || summaryQuery.isError) return <div className="error-state"><CircleAlert size={22} /><strong>Não foi possível carregar os saques.</strong></div>
  const destinations = destinationsQuery.data?.data ?? []
  const available = Number(summaryQuery.data?.balance?.available_minor ?? summaryQuery.data?.balance?.available ?? 0)
  const canManage = true

  return <div className="page-stack">
    <section className="withdrawal-hero panel"><div className="withdrawal-hero-main"><div className="withdrawal-icon"><Banknote size={24} /></div><div><span className="eyebrow">Saída Pix</span><h2>Saques</h2><p>Envie saldo disponível para o destino cadastrado usando Pix automático.</p></div></div><div className="withdrawal-balance"><span>Disponível</span><strong>{formatBRL(available)}</strong></div></section>
    <section className="context-strip"><div className="context-strip-icon"><ShieldCheck size={16} /></div><div><strong>Proteção reforçada</strong><span>Cadastro de destino e confirmação do saque exigem Google Authenticator. O valor fica reservado pelo ledger antes da chamada ao provider.</span></div></section>
    {success ? <div className="success-banner"><ShieldCheck size={17} /><span>{success}</span></div> : null}
    {error ? <div className="inline-error">{error}</div> : null}
    <section className="withdrawal-grid">
      <article className="panel"><div className="panel-header"><div><h2>Destino de saque</h2><p>Chave Pix e conta bancária ficam vinculadas ao destino. Os dados bancários completos são criptografados no backend.</p></div><button className="button button-primary" type="button" disabled={previewReadOnly || !canManage} onClick={()=>setAddingDestination(true)}><Plus size={15} />Cadastrar destino</button></div>
        <div className="destination-list">{destinations.map((destination:WithdrawalDestination)=><div className={`destination-row${destination.id===selectedDestination?' selected':''}`} key={destination.id}><button className="destination-select" type="button" onClick={()=>setSelectedDestination(destination.id)}><span className="destination-icon"><WalletCards size={17}/></span><span><strong>{destination.label}</strong><small>{destination.bank_name} · conta •••• {destination.account_last4} · Pix {destination.pix_key_masked}</small></span></button><StatusBadge status={destination.id===selectedDestination?'selected':destination.status}/><button className="icon-button danger-icon-button" type="button" disabled={previewReadOnly || disableMutation.isPending} onClick={()=>disableMutation.mutate(destination.id)} aria-label={`Desativar ${destination.label}`}><Trash2 size={16}/></button></div>)}{!destinations.length?<div className="empty-state compact-empty"><WalletCards size={23}/><strong>Nenhum destino cadastrado</strong><span>Cadastre a chave Pix e a conta bancária que receberão os saques.</span></div>:null}</div>
      </article>
      <article className="panel"><div className="panel-header"><div><h2>Efetuar saque</h2><p>Uma confirmação inicia a operação financeira automaticamente.</p></div><Banknote size={18}/></div><form className="financial-form" onSubmit={submitWithdrawal}><label className="field"><span>Destino</span><select value={selectedDestination} onChange={(event)=>setSelectedDestination(event.target.value)} required><option value="">Selecione um destino</option>{destinations.map((item:WithdrawalDestination)=><option key={item.id} value={item.id}>{item.label} · {item.bank_name} •••• {item.account_last4}</option>)}</select></label><label className="field"><span>Valor</span><div className="input-with-prefix"><span>R$</span><input inputMode="decimal" value={amount} onChange={(event)=>setAmount(event.target.value)} placeholder="0,00" /></div></label><div className="withdrawal-summary"><span>Destino confirmado</span><strong>{selectedDestination ? destinations.find((item)=>item.id===selectedDestination)?.pix_key_masked : 'Selecione um destino'}</strong><small>O Pix é executado pelo provider configurado; a operação permanece rastreável pela transação.</small></div><button className="button button-primary button-full" type="submit" disabled={previewReadOnly || withdrawalMutation.isPending || !destinations.length}>{withdrawalMutation.isPending ? 'Iniciando…' : 'Sacar agora'}</button></form></article>
    </section>
    {addingDestination?<div className="drawer-backdrop" role="presentation" onMouseDown={()=>setAddingDestination(false)}><aside className="drawer wide-drawer" role="dialog" aria-modal="true" aria-label="Cadastrar destino de saque" onMouseDown={(event)=>event.stopPropagation()}><div className="drawer-header"><div><span className="eyebrow">Saques</span><h2>Cadastrar destino</h2></div><button className="icon-button" type="button" onClick={()=>setAddingDestination(false)} aria-label="Fechar"><X size={18}/></button></div><form className="financial-form drawer-form" onSubmit={submitDestination}><div className="form-grid-two"><label className="field"><span>Nome do destino</span><input value={label} onChange={(e)=>setLabel(e.target.value)} required/></label><label className="field"><span>Tipo de chave Pix</span><select value={pixKeyType} onChange={(e)=>setPixKeyType(e.target.value)}><option value="evp">Chave aleatória</option><option value="cpf">CPF</option><option value="cnpj">CNPJ</option><option value="email">E-mail</option><option value="phone">Telefone</option></select></label></div><label className="field"><span>Chave Pix</span><input value={pixKey} onChange={(e)=>setPixKey(e.target.value)} placeholder="Chave vinculada à conta bancária" required/></label><div className="form-grid-two"><label className="field"><span>Banco</span><input value={bankName} onChange={(e)=>setBankName(e.target.value)} placeholder="Nome do banco" required/></label><label className="field"><span>Tipo de conta</span><select value={accountType} onChange={(e)=>setAccountType(e.target.value)}><option value="checking">Corrente</option><option value="savings">Poupança</option><option value="payment">Pagamento</option></select></label></div><div className="form-grid-two"><label className="field"><span>Agência</span><input value={branch} onChange={(e)=>setBranch(e.target.value)} inputMode="numeric" required/></label><label className="field"><span>Conta</span><input value={accountNumber} onChange={(e)=>setAccountNumber(e.target.value)} inputMode="numeric" required/></label></div><div className="form-grid-two"><label className="field"><span>Titular</span><input value={holderName} onChange={(e)=>setHolderName(e.target.value)} required/></label><label className="field"><span>CPF/CNPJ do titular</span><input value={holderDocument} onChange={(e)=>setHolderDocument(e.target.value)} required/></label></div><div className="inline-info">A chave Pix identifica a conta que receberá a transferência. Os dados bancários completos são mantidos criptografados e não são exibidos novamente.</div><button className="button button-primary button-full" type="submit" disabled={previewReadOnly || destinationMutation.isPending}>{destinationMutation.isPending?'Salvando…':'Salvar destino'}</button></form></aside></div>:null}
    <MFAActionDialog open={stepUpOpen} title={stepUpAction==='destination'?'Confirme o destino':'Confirme o saque'} description={stepUpAction==='destination'?'Cadastrar ou alterar um destino pode direcionar futuras saídas financeiras.':'O código confirma que você autoriza esta saída financeira agora.'} onClose={()=>{setStepUpOpen(false);setStepUpAction(null);setPendingDestination(false);setPendingWithdrawal(false)}} onVerified={completeStepUp}/>
  </div>
}
