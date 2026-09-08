import { useQuery } from '@tanstack/react-query'
import { CircleAlert, Landmark, LockKeyhole, ShieldCheck } from 'lucide-react'
import { api } from '../../api/client'
import type { Account } from '../../api/types'
import { useSession } from '../../app/session'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { balanceMinor, formatBRL, formatDateTime } from '../../lib/format'

export function AccountsPage() {
  const { organizationId } = useSession()

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

  if (!organizationId) {
    return <div className="empty-state"><strong>Selecione uma organização</strong><span>Contas e saldos pertencem à organização ativa.</span></div>
  }

  if (accountsQuery.isLoading || summaryQuery.isLoading) {
    return <div className="skeleton skeleton-panel" aria-busy="true" />
  }

  if (accountsQuery.isError || summaryQuery.isError) {
    return (
      <div className="error-state">
        <CircleAlert size={22} />
        <strong>Não foi possível carregar as contas.</strong>
        <span>O ledger não foi alterado.</span>
      </div>
    )
  }

  const accounts = accountsQuery.data?.data ?? []
  const balance = summaryQuery.data?.balance as unknown as Record<string, unknown> | undefined
  const defaultAccount = summaryQuery.data?.account
  const available = balanceMinor(balance, 'available')
  const reserved = balanceMinor(balance, 'reserved')
  const clearing = balanceMinor(balance, 'clearing')
  const total = balanceMinor(balance, 'total')

  return (
    <div className="page-stack">
      <section className="accounts-hero">
        <div>
          <span>Saldo disponível</span>
          <strong>{formatBRL(available)}</strong>
          <p>{defaultAccount?.name || 'Conta principal'} · BRL</p>
        </div>
        <div className="balance-breakdown">
          <div><span>Reservado</span><strong>{formatBRL(reserved)}</strong></div>
          <div><span>Em compensação</span><strong>{formatBRL(clearing)}</strong></div>
          <div><span>Total</span><strong>{formatBRL(total || available + reserved + clearing)}</strong></div>
        </div>
      </section>

      <section className="ledger-principle">
        <ShieldCheck size={18} />
        <div>
          <strong>Saldo Flash Pag é o ledger interno da organização</strong>
          <span>Ele não representa o saldo externo do provider. Saídas reservam fundos antes da chamada externa e só liberam ou compensam conforme o estado final.</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div><h2>Contas</h2><p>Estrutura financeira disponível nesta organização.</p></div>
          <span className="count-pill">{accounts.length}</span>
        </div>
        <div className="account-list">
          {accounts.map((account) => (
            <article className="account-row" key={account.id}>
              <div className="account-icon"><Landmark size={17} /></div>
              <div className="account-copy">
                <div>
                  <strong>{account.name}</strong>
                  {account.is_default ? <span className="subtle-pill">Principal</span> : null}
                </div>
                <span>{account.currency} · criada em {formatDateTime(account.created_at)}</span>
              </div>
              <StatusBadge status={account.status} />
              <div className="account-balance">
                {account.id === defaultAccount?.id ? (
                  <>
                    <span>Disponível</span>
                    <strong>{formatBRL(available)}</strong>
                  </>
                ) : (
                  <>
                    <span>Saldo</span>
                    <strong>—</strong>
                  </>
                )}
              </div>
            </article>
          ))}
          {!accounts.length ? <div className="table-empty">Nenhuma conta encontrada.</div> : null}
        </div>
      </section>

      <section className="panel account-model-panel">
        <div className="panel-header">
          <div><h2>Modelo de saída</h2><p>Como o saldo muda durante uma transferência.</p></div>
          <LockKeyhole size={17} />
        </div>
        <div className="state-flow" aria-label="Fluxo de saldo em transferências">
          <div><span>available</span><strong>Disponível</strong></div>
          <i>→</i>
          <div><span>reserved</span><strong>Reservado</strong></div>
          <i>→</i>
          <div><span>provider</span><strong>Processamento</strong></div>
          <i>→</i>
          <div><span>final</span><strong>Clearing ou liberação</strong></div>
        </div>
      </section>
    </div>
  )
}
