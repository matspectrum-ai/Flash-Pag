import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  Eye,
  FileText,
  Search,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react'
import { api } from '../../api/client'
import type { AdminKYCDetail, KYCStatus, PlatformKYCRow } from '../../api/types'
import { useSession } from '../../app/session'
import { formatDateTime, maskDocument } from '../../lib/format'
import '../kyc/kyc.css'

type Filter = 'queue' | 'submitted' | 'under_review' | 'needs_changes' | 'approved' | 'rejected' | 'all'

type Decision = 'approved' | 'needs_changes' | 'rejected'

const labels: Record<string, string> = {
  draft: 'Rascunho', submitted: 'Enviado', under_review: 'Em análise', needs_changes: 'Correção necessária', approved: 'Aprovado', rejected: 'Recusado',
}

function statusPill(status?: string | null) {
  const normalized = (status || 'draft') as KYCStatus
  return <span className={`kyc-status-pill status-${normalized}`}>{labels[normalized] || normalized}</span>
}

export function PlatformKYCPage() {
  const { me } = useSession()
  const queryClient = useQueryClient()
  const previewReadOnly = import.meta.env.VITE_PREVIEW_READ_ONLY === 'true'
  const [filter, setFilter] = useState<Filter>('queue')
  const [search, setSearch] = useState('')
  const [selectedMerchantId, setSelectedMerchantId] = useState<string | null>(null)
  const [decision, setDecision] = useState<Decision | null>(null)
  const [publicNote, setPublicNote] = useState('')
  const [internalNote, setInternalNote] = useState('')

  const queueQuery = useQuery({
    queryKey: ['platform-kyc'],
    queryFn: api.adminKYCQueue,
    enabled: Boolean(me?.user.platform_admin),
  })
  const detailQuery = useQuery({
    queryKey: ['platform-kyc-detail', selectedMerchantId],
    queryFn: () => api.adminKYCDetail(selectedMerchantId!),
    enabled: Boolean(selectedMerchantId && me?.user.platform_admin),
  })

  const startMutation = useMutation({
    mutationFn: (merchantId: string) => api.adminKYCStartReview(merchantId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['platform-kyc'] }),
        queryClient.invalidateQueries({ queryKey: ['platform-kyc-detail', selectedMerchantId] }),
      ])
    },
  })

  const decisionMutation = useMutation({
    mutationFn: ({ merchantId, value }: { merchantId: string; value: Decision }) => api.adminKYCDecision(merchantId, value, publicNote, internalNote),
    onSuccess: async () => {
      setDecision(null)
      setPublicNote('')
      setInternalNote('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['platform-kyc'] }),
        queryClient.invalidateQueries({ queryKey: ['platform-kyc-detail', selectedMerchantId] }),
      ])
    },
  })

  const rows = queueQuery.data?.data ?? []
  const counts = useMemo(() => {
    const result: Record<string, number> = { submitted: 0, under_review: 0, needs_changes: 0, approved: 0, rejected: 0 }
    for (const row of rows) result[row.kyc_status || 'draft'] = (result[row.kyc_status || 'draft'] ?? 0) + 1
    return result
  }, [rows])
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows.filter((row) => {
      const status = row.kyc_status || 'draft'
      if (filter === 'queue' && status !== 'submitted' && status !== 'under_review') return false
      if (!['queue','all'].includes(filter) && status !== filter) return false
      if (!needle) return true
      return [row.merchant_name, row.legal_name, row.tax_id, row.company_email, row.merchant_id].some((value) => value?.toLowerCase().includes(needle))
    })
  }, [rows, filter, search])

  if (!me?.user.platform_admin) return <div className="error-state"><ShieldCheck size={22} /><strong>Acesso restrito à plataforma.</strong></div>
  if (queueQuery.isLoading) return <div className="skeleton skeleton-panel" aria-busy="true" />
  if (queueQuery.isError) return <div className="error-state"><CircleAlert size={22} /><strong>Não foi possível carregar a fila KYC.</strong></div>

  return (
    <div className="page-stack">
      <section className="platform-metrics">
        <article className="metric-card"><div className="metric-label"><Clock3 size={16} /><span>Aguardando análise</span></div><strong>{counts.submitted ?? 0}</strong><span className="metric-detail">Submetidos</span></article>
        <article className="metric-card"><div className="metric-label"><Eye size={16} /><span>Em análise</span></div><strong>{counts.under_review ?? 0}</strong><span className="metric-detail">Revisões abertas</span></article>
        <article className="metric-card"><div className="metric-label"><CircleAlert size={16} /><span>Correções</span></div><strong>{counts.needs_changes ?? 0}</strong><span className="metric-detail">Aguardando merchant</span></article>
        <article className="metric-card"><div className="metric-label"><CheckCircle2 size={16} /><span>Aprovados</span></div><strong>{counts.approved ?? 0}</strong><span className="metric-detail">Merchants verificados</span></article>
      </section>

      <section className="toolbar platform-kyc-toolbar">
        <div className="platform-kyc-tabs">
          {([
            ['queue', 'Fila'], ['submitted', 'Enviados'], ['under_review', 'Em análise'], ['needs_changes', 'Correções'], ['approved', 'Aprovados'], ['rejected', 'Recusados'], ['all', 'Todos'],
          ] as [Filter, string][]).map(([value, label]) => <button key={value} type="button" className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
        <label className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar empresa, CNPJ ou e-mail" /></label>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Verificações de Merchant</h2><p>Analise dados empresariais e documentos antes de liberar operações financeiras reais.</p></div><span className="count-pill">{filtered.length}</span></div>
        <div className="table-wrap">
          <table className="data-table interactive-table">
            <thead><tr><th>Merchant</th><th>CNPJ</th><th>Status</th><th>Documentos</th><th>Enviado / atualizado</th></tr></thead>
            <tbody>
              {filtered.map((row) => (
                <tr className="kyc-admin-row" key={row.merchant_id} onClick={() => setSelectedMerchantId(row.merchant_id)}>
                  <td><div className="kyc-admin-merchant"><strong>{row.legal_name || row.merchant_name}</strong><span>{row.company_email || row.merchant_name}</span></div></td>
                  <td className="mono subtle-text">{maskDocument(row.tax_id || undefined)}</td>
                  <td>{statusPill(row.kyc_status)}</td>
                  <td>{row.document_count ?? 0}</td>
                  <td>{formatDateTime(row.submitted_at || row.updated_at || undefined)}</td>
                </tr>
              ))}
              {!filtered.length ? <tr><td colSpan={5}><div className="table-empty">Nenhuma verificação corresponde ao filtro.</div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {selectedMerchantId ? (
        <div className="drawer-backdrop" role="presentation" onMouseDown={() => { setSelectedMerchantId(null); setDecision(null) }}>
          <aside className="drawer kyc-admin-detail" role="dialog" aria-modal="true" aria-label="Análise KYC" onMouseDown={(event) => event.stopPropagation()}>
            <div className="drawer-header"><div><span className="eyebrow">Compliance</span><h2>{detailQuery.data?.profile.legal_name || detailQuery.data?.merchant.name || 'Análise KYC'}</h2></div><button className="icon-button" type="button" onClick={() => setSelectedMerchantId(null)}><X size={18} /></button></div>
            {detailQuery.isLoading ? <div className="skeleton skeleton-panel" /> : null}
            {detailQuery.isError ? <div className="inline-error">Não foi possível carregar os detalhes.</div> : null}
            {detailQuery.data ? <KYCAdminDetail detail={detailQuery.data} previewReadOnly={previewReadOnly} onStart={() => startMutation.mutate(selectedMerchantId)} onDecision={setDecision} starting={startMutation.isPending} /> : null}

            {decision && detailQuery.data ? (
              <div className="kyc-admin-section">
                <h3>{decision === 'approved' ? 'Aprovar Merchant' : decision === 'needs_changes' ? 'Solicitar correção' : 'Recusar verificação'}</h3>
                <div className="financial-form">
                  {decision !== 'approved' ? <label className="field"><span>Observação para o Merchant *</span><textarea rows={4} value={publicNote} onChange={(event) => setPublicNote(event.target.value)} placeholder="Explique exatamente o que precisa ser corrigido ou o motivo da recusa." /></label> : <label className="field"><span>Mensagem para o Merchant <em>opcional</em></span><textarea rows={3} value={publicNote} onChange={(event) => setPublicNote(event.target.value)} /></label>}
                  <label className="field"><span>Nota interna <em>somente Admin</em></span><textarea rows={4} value={internalNote} onChange={(event) => setInternalNote(event.target.value)} placeholder="Contexto interno de compliance. Nunca será mostrado ao Merchant." /></label>
                  {previewReadOnly ? <div className="inline-info">Decisões ficam bloqueadas no preview read-only.</div> : null}
                  {decisionMutation.isError ? <div className="inline-error">{decisionMutation.error instanceof Error ? decisionMutation.error.message : 'Não foi possível aplicar a decisão.'}</div> : null}
                  <div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setDecision(null)}>Cancelar</button><button className="button button-primary" type="button" disabled={previewReadOnly || decisionMutation.isPending || (decision !== 'approved' && !publicNote.trim())} onClick={() => decisionMutation.mutate({ merchantId: selectedMerchantId, value: decision })}>{decisionMutation.isPending ? 'Aplicando…' : 'Confirmar decisão'}</button></div>
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}
    </div>
  )
}

function KYCAdminDetail({ detail, previewReadOnly, onStart, onDecision, starting }: { detail: AdminKYCDetail; previewReadOnly: boolean; onStart: () => void; onDecision: (decision: Decision) => void; starting: boolean }) {
  const profile = detail.profile
  const canReview = profile.status === 'submitted' || profile.status === 'under_review'
  return (
    <>
      <section className="kyc-admin-section">
        <div className="drawer-amount"><div><span className="eyebrow">Status atual</span><div style={{ marginTop: 7 }}>{statusPill(profile.status)}</div></div><span className="subtle-text">{formatDateTime(profile.submitted_at || profile.updated_at)}</span></div>
      </section>
      {profile.public_note ? <section className="kyc-observation"><CircleAlert size={18} /><div><strong>Última observação pública</strong><p>{profile.public_note}</p></div></section> : null}
      <section className="kyc-admin-section"><h3>Empresa</h3><div className="kyc-admin-grid">
        <Data label="Razão social" value={profile.legal_name} /><Data label="Nome fantasia" value={profile.trade_name} /><Data label="CNPJ" value={profile.tax_id} /><Data label="Data de abertura" value={profile.incorporation_date} /><Data label="E-mail" value={profile.company_email} /><Data label="Telefone" value={profile.company_phone} />
      </div></section>
      <section className="kyc-admin-section"><h3>Endereço</h3><div className="kyc-admin-grid"><Data label="Endereço" value={[profile.address_line1,profile.address_line2].filter(Boolean).join(', ')} /><Data label="Bairro" value={profile.district} /><Data label="Cidade / UF" value={[profile.city,profile.state].filter(Boolean).join(' / ')} /><Data label="CEP" value={profile.postal_code} /></div></section>
      <section className="kyc-admin-section"><h3>Representante legal</h3><div className="kyc-admin-grid"><Data label="Nome" value={profile.representative_name} /><Data label="CPF" value={profile.representative_document} /><Data label="Nascimento" value={profile.representative_birth_date} /><Data label="Cargo" value={profile.representative_role} /><Data label="E-mail" value={profile.representative_email} /><Data label="Telefone" value={profile.representative_phone} /></div></section>
      <section className="kyc-admin-section"><h3>Documentos</h3><div className="kyc-admin-documents">{detail.documents.filter((doc) => doc.is_current).map((doc) => <article className="kyc-admin-document" key={doc.id}><FileText size={17} /><div><strong>{doc.document_type.replaceAll('_', ' ')}</strong><span>{doc.original_name} · {Math.ceil(doc.size_bytes / 1024)} KB · v{doc.version}</span></div><button className="button button-secondary" type="button" onClick={() => window.open(api.adminKYCDocumentURL(detail.merchant.id, doc.id), '_blank', 'noopener,noreferrer')}>Abrir</button></article>)}</div></section>
      {canReview ? <section className="kyc-admin-section"><h3>Decisão</h3>{profile.status === 'submitted' ? <button className="button button-secondary button-full" type="button" disabled={previewReadOnly || starting} onClick={onStart}><Eye size={15} />{starting ? 'Iniciando…' : 'Iniciar análise'}</button> : null}<div className="kyc-decision-grid" style={{ marginTop: 10 }}><button className="button button-secondary approve" type="button" onClick={() => onDecision('approved')} disabled={previewReadOnly}><CheckCircle2 size={15} />Aprovar</button><button className="button button-secondary changes" type="button" onClick={() => onDecision('needs_changes')} disabled={previewReadOnly}><CircleAlert size={15} />Pedir correção</button><button className="button button-secondary reject" type="button" onClick={() => onDecision('rejected')} disabled={previewReadOnly}><XCircle size={15} />Recusar</button></div></section> : null}
      <section className="kyc-admin-section"><h3>Histórico de análise</h3><div className="kyc-review-history">{detail.reviews.map((review) => <div className="kyc-review-item" key={review.id}><strong>{labels[review.action] || review.action}</strong><span>{review.reviewer_email || 'Admin'} · {formatDateTime(review.created_at)}</span>{review.public_note ? <p>Merchant: {review.public_note}</p> : null}{review.internal_note ? <p>Interno: {review.internal_note}</p> : null}</div>)}{!detail.reviews.length ? <span className="subtle-text">Nenhuma decisão registrada.</span> : null}</div></section>
    </>
  )
}

function Data({ label, value }: { label: string; value?: string | null }) {
  return <div className="kyc-admin-data"><span>{label}</span><strong>{value || '—'}</strong></div>
}
