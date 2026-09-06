import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Calculator, CircleAlert, DollarSign, History, ReceiptText, Save, ShieldCheck } from 'lucide-react'
import { api } from '../../api/client'
import type { Merchant } from '../../api/types'
import { useSession } from '../../app/session'
import { formatBRL, formatDateTime } from '../../lib/format'
import './platform-pricing.css'

type PricingOperation = 'pix_in' | 'transfer' | 'withdrawal'

type PricingRule = {
  fixed_minor: number
  percent_bps: number
  min_fee_minor: number | null
  max_fee_minor: number | null
}

type PricingVersion = {
  id: string
  merchant_id: string
  version: number
  currency: string
  note?: string | null
  created_by?: string | null
  created_at: string
  updated_by?: string | null
  updated_at?: string
  rules: Record<PricingOperation, PricingRule>
}

type PricingDetail = {
  merchant: Merchant
  current: PricingVersion
  history: PricingVersion[]
}

type RuleForm = {
  fixed: string
  percent: string
  min: string
  max: string
}

type PricingForm = Record<PricingOperation, RuleForm>

const operations: { key: PricingOperation; label: string; description: string }[] = [
  { key: 'pix_in', label: 'Pix recebido', description: 'Descontada do valor bruto antes do crédito no saldo do Merchant.' },
  { key: 'transfer', label: 'Transferência Pix', description: 'Somada ao valor enviado e debitada do saldo no mesmo fluxo financeiro.' },
  { key: 'withdrawal', label: 'Saque', description: 'Somada ao valor do saque e reconhecida somente quando a operação conclui.' },
]

const emptyRule: RuleForm = { fixed: '0,00', percent: '0', min: '', max: '' }
const emptyForm: PricingForm = {
  pix_in: { ...emptyRule },
  transfer: { ...emptyRule },
  withdrawal: { ...emptyRule },
}

function minorToInput(value: number | null | undefined) {
  if (value == null) return ''
  return (value / 100).toFixed(2).replace('.', ',')
}

function parseMoneyMinor(value: string, optional = false): number | null {
  const trimmed = value.trim()
  if (!trimmed && optional) return null
  if (!trimmed) return 0
  const normalized = trimmed.replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.')
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Informe um valor monetário válido.')
  return Math.round(parsed * 100)
}

function parsePercentBPS(value: string) {
  const parsed = Number(value.trim().replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) throw new Error('O percentual deve ficar entre 0% e 100%.')
  return Math.round(parsed * 100)
}

function feeFor(amountMinor: number, rule: PricingRule) {
  const percentMinor = Number((BigInt(amountMinor) * BigInt(rule.percent_bps) + 5000n) / 10000n)
  let fee = rule.fixed_minor + percentMinor
  if (rule.min_fee_minor != null) fee = Math.max(fee, rule.min_fee_minor)
  if (rule.max_fee_minor != null) fee = Math.min(fee, rule.max_fee_minor)
  return fee
}

function ruleDescription(rule: PricingRule) {
  const parts: string[] = []
  if (rule.fixed_minor) parts.push(formatBRL(rule.fixed_minor))
  if (rule.percent_bps) parts.push(`${(rule.percent_bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`)
  if (!parts.length) parts.push('Sem taxa')
  if (rule.min_fee_minor != null) parts.push(`mín. ${formatBRL(rule.min_fee_minor)}`)
  if (rule.max_fee_minor != null) parts.push(`máx. ${formatBRL(rule.max_fee_minor)}`)
  return parts.join(' + ')
}

function formFromVersion(version?: PricingVersion): PricingForm {
  if (!version?.rules) return emptyForm
  const next = {} as PricingForm
  for (const operation of operations) {
    const rule = version.rules[operation.key] ?? { fixed_minor: 0, percent_bps: 0, min_fee_minor: null, max_fee_minor: null }
    next[operation.key] = {
      fixed: minorToInput(rule.fixed_minor),
      percent: (rule.percent_bps / 100).toString().replace('.', ','),
      min: minorToInput(rule.min_fee_minor),
      max: minorToInput(rule.max_fee_minor),
    }
  }
  return next
}

function pricingPayload(form: PricingForm, note: string) {
  const rules = {} as Record<PricingOperation, PricingRule>
  for (const operation of operations) {
    const item = form[operation.key]
    const fixed = parseMoneyMinor(item.fixed) ?? 0
    const min = parseMoneyMinor(item.min, true)
    const max = parseMoneyMinor(item.max, true)
    if (min != null && max != null && min > max) throw new Error(`${operation.label}: a taxa mínima não pode superar a máxima.`)
    rules[operation.key] = {
      fixed_minor: fixed,
      percent_bps: parsePercentBPS(item.percent),
      min_fee_minor: min,
      max_fee_minor: max,
    }
  }
  return { note: note.trim(), rules }
}

export function PlatformPricingPage() {
  const { me } = useSession()
  const queryClient = useQueryClient()
  const previewReadOnly = import.meta.env.VITE_PREVIEW_READ_ONLY === 'true'
  const merchants = me?.merchants ?? []
  const [merchantId, setMerchantId] = useState(merchants[0]?.id ?? '')
  const [form, setForm] = useState<PricingForm>(emptyForm)
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState('')
  const [savedMessage, setSavedMessage] = useState('')
  const [simulatorOperation, setSimulatorOperation] = useState<PricingOperation>('pix_in')
  const [simulatorAmount, setSimulatorAmount] = useState('100,00')

  useEffect(() => {
    if (!merchantId && merchants[0]?.id) setMerchantId(merchants[0].id)
  }, [merchantId, merchants])

  const pricingQuery = useQuery({
    queryKey: ['admin-pricing', merchantId],
    queryFn: () => api.adminPricingDetail(merchantId).then((value) => value as unknown as PricingDetail),
    enabled: Boolean(me?.user.platform_admin && merchantId),
  })

  useEffect(() => {
    if (!pricingQuery.data?.current) return
    setForm(formFromVersion(pricingQuery.data.current))
    setNote('')
    setFormError('')
    setSavedMessage('')
  }, [pricingQuery.data?.current?.id])

  const saveMutation = useMutation({
    mutationFn: (payload: ReturnType<typeof pricingPayload>) =>
      api.adminSetPricing(merchantId, payload).then((value) => value as unknown as PricingDetail),
    onSuccess: async (detail) => {
      setForm(formFromVersion(detail.current))
      setNote('')
      setFormError('')
      setSavedMessage(`Versão ${detail.current.version} ativada. Novas transações já usarão esta política.`)
      await queryClient.invalidateQueries({ queryKey: ['admin-pricing', merchantId] })
    },
  })

  const parsedDraftRules = useMemo(() => {
    try {
      return pricingPayload(form, note).rules
    } catch {
      return null
    }
  }, [form, note])

  const simulator = useMemo(() => {
    if (!parsedDraftRules) return null
    try {
      const amount = parseMoneyMinor(simulatorAmount)
      if (!amount || amount <= 0) return null
      const fee = feeFor(amount, parsedDraftRules[simulatorOperation])
      return {
        amount,
        fee,
        net: simulatorOperation === 'pix_in' ? amount - fee : amount + fee,
      }
    } catch {
      return null
    }
  }, [parsedDraftRules, simulatorAmount, simulatorOperation])

  const updateRule = (operation: PricingOperation, field: keyof RuleForm, value: string) => {
    setSavedMessage('')
    setFormError('')
    setForm((current) => ({ ...current, [operation]: { ...current[operation], [field]: value } }))
  }

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (previewReadOnly) return
    try {
      const payload = pricingPayload(form, note)
      setFormError('')
      saveMutation.mutate(payload)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Revise os valores informados.')
    }
  }

  if (!me?.user.platform_admin) {
    return <div className="error-state"><ShieldCheck size={22} /><strong>Acesso restrito à plataforma.</strong><span>Somente administradores da Flash Pag podem alterar pricing.</span></div>
  }

  if (!merchants.length) {
    return <div className="empty-state"><DollarSign size={24} /><strong>Nenhum Merchant disponível</strong><span>Crie um Merchant antes de configurar taxas.</span></div>
  }

  const current = pricingQuery.data?.current

  return (
    <div className="page-stack pricing-page">
      <section className="pricing-context panel">
        <div>
          <span className="eyebrow">Política comercial</span>
          <h2>Taxas por Merchant</h2>
          <p>Cada alteração cria uma versão imutável. A versão de uma transação é congelada no momento em que ela nasce.</p>
        </div>
        <label className="pricing-merchant-select">
          <span>Merchant</span>
          <select value={merchantId} onChange={(event) => setMerchantId(event.target.value)}>
            {merchants.map((merchant) => <option key={merchant.id} value={merchant.id}>{merchant.name}</option>)}
          </select>
        </label>
      </section>

      {pricingQuery.isLoading ? <div className="skeleton skeleton-panel" aria-busy="true" /> : null}
      {pricingQuery.isError ? (
        <div className="error-state"><CircleAlert size={22} /><strong>Não foi possível carregar as taxas.</strong><span>{pricingQuery.error instanceof Error ? pricingQuery.error.message : 'Tente novamente.'}</span><button className="button button-secondary" onClick={() => void pricingQuery.refetch()}>Tentar novamente</button></div>
      ) : null}

      {current ? (
        <>
          <section className="pricing-version-strip">
            <div><span>Versão ativa</span><strong>v{current.version}</strong></div>
            <div><span>Moeda</span><strong>{current.currency}</strong></div>
            <div><span>Ativada em</span><strong>{formatDateTime(current.updated_at || current.created_at)}</strong></div>
            <div><span>Modelo</span><strong>Merchant-wide</strong></div>
          </section>

          <section className="pricing-rule-grid">
            {operations.map((operation) => (
              <article className="pricing-rule-card panel" key={operation.key}>
                <div className="pricing-rule-head"><span className="pricing-rule-icon"><ReceiptText size={17} /></span><div><strong>{operation.label}</strong><span>{operation.description}</span></div></div>
                <div className="pricing-rule-value">{ruleDescription(current.rules[operation.key])}</div>
              </article>
            ))}
          </section>

          <section className="pricing-workspace">
            <form className="panel pricing-editor" onSubmit={save}>
              <div className="panel-header"><div><h2>Nova versão</h2><p>Edite a política abaixo. O histórico anterior não será alterado.</p></div><span className="count-pill">próxima v{current.version + 1}</span></div>
              <div className="pricing-editor-body">
                {operations.map((operation) => (
                  <fieldset className="pricing-rule-form" key={operation.key}>
                    <legend><strong>{operation.label}</strong><span>{operation.key}</span></legend>
                    <label className="field"><span>Taxa fixa</span><div className="input-prefix"><span>R$</span><input inputMode="decimal" value={form[operation.key].fixed} onChange={(event) => updateRule(operation.key, 'fixed', event.target.value)} /></div></label>
                    <label className="field"><span>Percentual</span><div className="input-suffix"><input inputMode="decimal" value={form[operation.key].percent} onChange={(event) => updateRule(operation.key, 'percent', event.target.value)} /><span>%</span></div></label>
                    <label className="field"><span>Mínimo <em>opcional</em></span><div className="input-prefix"><span>R$</span><input inputMode="decimal" value={form[operation.key].min} onChange={(event) => updateRule(operation.key, 'min', event.target.value)} placeholder="—" /></div></label>
                    <label className="field"><span>Máximo <em>opcional</em></span><div className="input-prefix"><span>R$</span><input inputMode="decimal" value={form[operation.key].max} onChange={(event) => updateRule(operation.key, 'max', event.target.value)} placeholder="—" /></div></label>
                  </fieldset>
                ))}
                <label className="field pricing-note"><span>Nota da versão <em>opcional</em></span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ex.: condição comercial negociada em setembro" maxLength={240} /></label>
                <div className="pricing-safety-note"><ShieldCheck size={16} /><span>Taxa de Pix recebido é reconhecida apenas no sucesso. Em transferências ambíguas, principal + taxa permanecem reservados até reconciliação. Falhas definitivas devolvem ambos ao saldo disponível.</span></div>
                {formError ? <div className="inline-error">{formError}</div> : null}
                {saveMutation.isError ? <div className="inline-error">{saveMutation.error instanceof Error ? saveMutation.error.message : 'Não foi possível criar a nova versão.'}</div> : null}
                {savedMessage ? <div className="inline-success">{savedMessage}</div> : null}
              </div>
              <div className="pricing-editor-footer">
                <span>{previewReadOnly ? 'Alterações bloqueadas no preview.' : 'Salvar cria uma nova versão; não existe edição retroativa.'}</span>
                <button className="button button-primary" type="submit" disabled={previewReadOnly || saveMutation.isPending}><Save size={15} />{previewReadOnly ? 'Bloqueado no preview' : saveMutation.isPending ? 'Criando versão…' : 'Ativar nova versão'}</button>
              </div>
            </form>

            <div className="pricing-side-stack">
              <section className="panel pricing-simulator">
                <div className="panel-header"><div><h2><Calculator size={17} /> Simulador</h2><p>Prévia local da versão que está no formulário.</p></div></div>
                <div className="pricing-simulator-body">
                  <label className="field"><span>Operação</span><select value={simulatorOperation} onChange={(event) => setSimulatorOperation(event.target.value as PricingOperation)}>{operations.map((operation) => <option key={operation.key} value={operation.key}>{operation.label}</option>)}</select></label>
                  <label className="field"><span>Valor principal</span><div className="input-prefix"><span>R$</span><input inputMode="decimal" value={simulatorAmount} onChange={(event) => setSimulatorAmount(event.target.value)} /></div></label>
                  {simulator ? (
                    <dl className="pricing-simulation-result">
                      <div><dt>Principal</dt><dd>{formatBRL(simulator.amount)}</dd></div>
                      <div><dt>Taxa Flash Pag</dt><dd>{formatBRL(simulator.fee)}</dd></div>
                      <div className="pricing-simulation-total"><dt>{simulatorOperation === 'pix_in' ? 'Crédito líquido' : 'Débito total'}</dt><dd>{formatBRL(simulator.net)}</dd></div>
                    </dl>
                  ) : <div className="inline-info">Informe um valor válido para simular.</div>}
                </div>
              </section>

              <section className="panel pricing-history">
                <div className="panel-header"><div><h2><History size={17} /> Histórico</h2><p>Versões comerciais imutáveis.</p></div><span className="count-pill">{pricingQuery.data?.history.length ?? 0}</span></div>
                <div className="pricing-history-list">
                  {(pricingQuery.data?.history ?? []).map((version) => (
                    <article key={version.id} className={`pricing-history-row${version.id === current.id ? ' current' : ''}`}>
                      <div><strong>v{version.version}{version.id === current.id ? ' · ativa' : ''}</strong><span>{version.note || 'Sem nota'}</span></div>
                      <time>{formatDateTime(version.created_at)}</time>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
