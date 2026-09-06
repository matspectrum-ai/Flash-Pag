import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Landmark,
  Route,
  ShieldCheck,
} from 'lucide-react'
import { api } from '../../api/client'
import type { Account, ProviderConnection, Transaction } from '../../api/types'
import { useSession } from '../../app/session'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { balanceMinor, formatBRL } from '../../lib/format'

function moneyToMinor(value: string) {
  const raw = value.trim().replace(/\s/g, '').replace(/^R\$/i, '')
  if (!raw) return 0
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
}

function providerName(code: string) {
  if (code === 'pixhub') return 'Pixhub'
  if (code === 'mock') return 'Mock · desenvolvimento'
  return code
}

export function TransfersPage() {
  const { organizationId } = useSession()
  const queryClient = useQueryClient()
  const [accountId, setAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [pixKey, setPixKey] = useState('')
  const [description, setDescription] = useState('')
  const [connectionId, setConnectionId] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [result, setResult] = useState<Transaction | null>(null)

  const accountsQuery = useQuery({
    queryKey: ['accounts', organizationId],
    queryFn: () => api.list<Account>('accounts', organizationId!),
    enabled: Boolean(organizationId),
  })

  const summaryQuery = useQuery({
    queryKey: ['summary', organizationId],
    queryFn: () => api.summary(organizationId!),
    enabled: Boolean(organizationId),
  })

  const connectionsQuery = useQuery({
    queryKey: ['provider-connections', organizationId],
    queryFn: () => api.list<ProviderConnection>('provider-connections', organizationId!),
    enabled: Boolean(organizationId),
  })

  const accounts = useMemo(() => accountsQuery.data?.data ?? [], [accountsQuery.data])
  const realConnections = useMemo(
    () => (connectionsQuery.data?.data ?? []).filter((item) => item.status === 'active' && item.provider_code !== 'mock'),
    [connectionsQuery.data],
  )

  useEffect(() => {
    const defaultAccount = accounts.find((item) => item.is_default) ?? accounts[0]
    if (defaultAccount && !accounts.some((item) => item.id === accountId)) {
      setAccountId(defaultAccount.id)
    }
  }, [accounts, accountId])

  useEffect(() => {
    if (realConnections.length === 1) {
      setConnectionId(realConnections[0].id)
      return
    }
    if (!realConnections.some((item) => item.id === connectionId)) {
      setConnectionId('')
    }
  }, [realConnections, connectionId])

  const selectedAccount = accounts.find((item) => item.id === accountId)
  const selectedConnection = realConnections.find((item) => item.id === connectionId)
  const amountMinor = moneyToMinor(amount)
  const balance = summaryQuery.data?.balance as unknown as Record<string, unknown> | undefined
  const availableMinor = balanceMinor(balance, 'available')
  const balanceKnown = selectedAccount?.id === summaryQuery.data?.account.id
  const insufficientBalance = balanceKnown && amountMinor > availableMinor
  const pixhubMinimumViolation = selectedConnection?.provider_code === 'pixhub' && amountMinor > 0 && amountMinor < 500
  const routeReady = Boolean(selectedConnection)
  const formReady = amountMinor > 0
    && Boolean(pixKey.trim())
    && Boolean(accountId)
    && routeReady
    && !pixhubMinimumViolation
    && !insufficientBalance

  const mutation = useMutation({
    mutationFn: () => api.createTransfer(organizationId!, {
      account_id: accountId,
      amount_minor: amountMinor,
      currency: 'BRL',
      pix_key: pixKey.trim(),
      description: description.trim() || undefined,
      provider: selectedConnection?.provider_code,
      provider_connection_id: selectedConnection?.id,
    }),
    onSuccess: (transaction) => {
      setResult(transaction)
      setReviewing(false)
      void queryClient.invalidateQueries({ queryKey: ['transactions', organizationId] })
      void queryClient.invalidateQueries({ queryKey: ['summary', organizationId] })
    },
  })

  const beginReview = (event: FormEvent) => {
    event.preventDefault()
    setResult(null)
    if (formReady) setReviewing(true)
  }

  const resetReview = () => {
    setReviewing(false)
    setResult(null)
  }

  if (!organizationId) {
    return <div className="empty-state"><strong>Selecione uma organização</strong><span>Transferências são executadas no contexto financeiro da organização selecionada.</span></div>
  }

  if (accountsQuery.isLoading || connectionsQuery.isLoading || summaryQuery.isLoading) {
    return <div className="skeleton skeleton-panel" aria-busy="true" />
  }

  if (accountsQuery.isError || connectionsQuery.isError || summaryQuery.isError) {
    return (
      <div className="error-state">
        <CircleAlert size={22} />
        <strong>Não foi possível preparar uma transferência.</strong>
        <span>Nenhuma saída foi criada. Recarregue os dados antes de tentar novamente.</span>
      </div>
    )
  }

  if (!realConnections.length) {
    return (
      <div className="empty-state">
        <Route size={24} />
        <strong>Nenhuma rota Pix real está disponível</strong>
        <span>Ative uma conexão de pagamento real em Configurações → Conexões. O provider Mock não é usado como fallback para saídas reais.</span>
      </div>
    )
  }

  return (
    <div className="page-stack transfer-layout">
      <section className="panel transfer-form-panel">
        <div className="panel-header">
          <div>
            <h2>Nova transferência</h2>
            <p>Informe o destino e revise a operação antes do envio.</p>
          </div>
          <ShieldCheck size={18} />
        </div>

        <form className="financial-form" onSubmit={beginReview} onChange={resetReview}>
          <label className="field">
            <span>Conta de origem</span>
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}{account.is_default ? ' · principal' : ''}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Valor</span>
            <div className="money-input">
              <span>R$</span>
              <input
                inputMode="decimal"
                placeholder="0,00"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                autoComplete="off"
              />
            </div>
            {pixhubMinimumViolation ? <small className="field-error">O valor mínimo operacional do Pixhub é R$ 5,00.</small> : null}
            {insufficientBalance ? <small className="field-error">Saldo disponível insuficiente para esta transferência.</small> : null}
          </label>

          <label className="field">
            <span>Chave Pix</span>
            <input value={pixKey} onChange={(event) => setPixKey(event.target.value)} placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória" autoComplete="off" />
          </label>

          <label className="field">
            <span>Descrição <em>opcional</em></span>
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ex.: Pagamento fornecedor" maxLength={140} />
          </label>

          <div className="route-summary">
            <div className="route-icon"><Route size={16} /></div>
            <div>
              <strong>{realConnections.length === 1 ? 'Rota definida automaticamente' : 'Rota de pagamento'}</strong>
              <span>
                {realConnections.length === 1
                  ? 'A Flash Pag usará a única conexão real elegível para esta organização.'
                  : connectionId
                    ? 'Uma rota foi selecionada para esta operação.'
                    : 'Há mais de uma rota elegível. Escolha uma opção em Avançado.'}
              </span>
            </div>
            <button type="button" className="text-button" onClick={() => setAdvancedOpen((open) => !open)}>
              Avançado <ChevronDown size={14} className={advancedOpen ? 'rotate-180' : ''} />
            </button>
          </div>

          {advancedOpen ? (
            <div className="advanced-panel">
              <label className="field">
                <span>Conexão de pagamento</span>
                <select value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>
                  <option value="">{realConnections.length > 1 ? 'Selecione uma rota' : 'Rota automática'}</option>
                  {realConnections.map((connection) => (
                    <option key={connection.id} value={connection.id}>{connection.label} · {providerName(connection.provider_code)}</option>
                  ))}
                </select>
              </label>
              <p>Provider e connection ID são detalhes de infraestrutura. Só altere a rota quando houver uma necessidade operacional explícita.</p>
            </div>
          ) : null}

          <button className="button button-primary button-full transfer-submit" type="submit" disabled={!formReady}>
            Revisar transferência
          </button>
        </form>
      </section>

      <aside className="transfer-side">
        <section className="panel balance-summary-panel">
          <div className="panel-header">
            <div><h2>Saldo disponível</h2><p>{selectedAccount?.name || 'Conta principal'}</p></div>
            <Landmark size={17} />
          </div>
          <div className="balance-summary-body">
            <strong>{balanceKnown ? formatBRL(availableMinor) : '—'}</strong>
            <span>{balanceKnown ? 'Saldo Flash Pag disponível no ledger interno.' : 'O contrato atual só expõe o saldo detalhado da conta principal.'}</span>
          </div>
        </section>

        {reviewing ? (
          <section className="panel review-card">
            <div className="review-heading">
              <span className="eyebrow">Revisão final</span>
              <h2>{formatBRL(amountMinor)}</h2>
              <span>para {pixKey}</span>
            </div>
            <dl className="detail-list compact">
              <div><dt>Conta</dt><dd>{selectedAccount?.name || '—'}</dd></div>
              <div><dt>Descrição</dt><dd>{description || '—'}</dd></div>
              <div><dt>Rota</dt><dd>{selectedConnection?.label || '—'}</dd></div>
            </dl>
            <div className="review-warning">
              <CircleAlert size={15} />
              <span>Confirme apenas uma vez. Estados ambíguos devem ser reconciliados, nunca reenviados.</span>
            </div>
            {mutation.isError ? <div className="inline-error">{mutation.error instanceof Error ? mutation.error.message : 'Não foi possível criar a transferência.'}</div> : null}
            <button className="button button-primary button-full" type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? 'Enviando…' : 'Confirmar transferência'}
            </button>
            <button className="button button-quiet button-full" type="button" disabled={mutation.isPending} onClick={() => setReviewing(false)}>Editar dados</button>
          </section>
        ) : null}

        {result ? (
          <section className="panel success-card">
            <CheckCircle2 size={24} />
            <div>
              <span className="eyebrow">Transferência criada</span>
              <h2>{formatBRL(result.amount_minor)}</h2>
              <StatusBadge status={result.status} />
            </div>
            <p>A operação foi registrada com o ID <span className="mono">{result.id}</span>. Use Transações para acompanhar ou reconciliar o estado.</p>
          </section>
        ) : null}
      </aside>
    </div>
  )
}
