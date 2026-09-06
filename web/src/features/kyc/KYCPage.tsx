import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building2,
  CheckCircle2,
  CircleAlert,
  FileCheck2,
  FileText,
  MapPin,
  ShieldCheck,
  Upload,
  UserRound,
} from 'lucide-react'
import { api, ApiError } from '../../api/client'
import type { KYCDocument, KYCDocumentType, KYCProfileInput, KYCStatus } from '../../api/types'
import { useSession } from '../../app/session'
import { formatDateTime } from '../../lib/format'
import './kyc.css'

const emptyForm: KYCProfileInput = {
  legal_name: '', trade_name: '', tax_id: '', incorporation_date: '', company_email: '', company_phone: '',
  address_line1: '', address_line2: '', district: '', city: '', state: '', postal_code: '', country: 'BR',
  representative_name: '', representative_document: '', representative_birth_date: '', representative_role: '', representative_email: '', representative_phone: '',
}

const documentLabels: Record<KYCDocumentType, { title: string; description: string; required?: boolean }> = {
  articles_of_association: { title: 'Contrato social', description: 'Contrato social ou documento constitutivo vigente.', required: true },
  cnpj_card: { title: 'Comprovante de CNPJ', description: 'Cartão ou comprovante de inscrição e situação cadastral.', required: true },
  representative_id: { title: 'Documento do representante', description: 'RG, CNH ou documento oficial com foto.', required: true },
  address_proof: { title: 'Comprovante de endereço', description: 'Documento recente da empresa ou do representante.', required: true },
  ownership_document: { title: 'Quadro societário', description: 'Documento complementar dos sócios, quando aplicável.' },
  bank_proof: { title: 'Comprovante bancário', description: 'Documento da conta de destino, útil para futuros saques.' },
  other: { title: 'Outro documento', description: 'Documento complementar solicitado pela análise.' },
}

const statusCopy: Record<KYCStatus, { label: string; title: string; description: string }> = {
  draft: { label: 'Não enviado', title: 'Complete sua verificação', description: 'Preencha os dados e envie os documentos obrigatórios para análise.' },
  submitted: { label: 'Enviado', title: 'Documentação recebida', description: 'Seu cadastro entrou na fila de análise da Flash Pag.' },
  under_review: { label: 'Em análise', title: 'Verificação em andamento', description: 'Um administrador está revisando os dados e documentos enviados.' },
  needs_changes: { label: 'Correção necessária', title: 'Precisamos de uma correção', description: 'Revise a observação abaixo, ajuste os dados ou documentos e reenvie.' },
  approved: { label: 'Aprovado', title: 'Merchant verificado', description: 'Seu KYC/KYB está aprovado e a conta está apta a habilitar operações financeiras reais.' },
  rejected: { label: 'Recusado', title: 'Verificação recusada', description: 'Revise a justificativa da análise. Se a correção for possível, atualize os dados e reenvie.' },
}

function toInput(profile: Record<string, unknown>): KYCProfileInput {
  const value = (key: keyof KYCProfileInput) => typeof profile[key] === 'string' ? String(profile[key]) : ''
  return {
    legal_name: value('legal_name'), trade_name: value('trade_name'), tax_id: value('tax_id'), incorporation_date: value('incorporation_date'), company_email: value('company_email'), company_phone: value('company_phone'),
    address_line1: value('address_line1'), address_line2: value('address_line2'), district: value('district'), city: value('city'), state: value('state'), postal_code: value('postal_code'), country: value('country') || 'BR',
    representative_name: value('representative_name'), representative_document: value('representative_document'), representative_birth_date: value('representative_birth_date'), representative_role: value('representative_role'), representative_email: value('representative_email'), representative_phone: value('representative_phone'),
  }
}

function currentDocument(documents: KYCDocument[], type: KYCDocumentType) {
  return documents.find((document) => document.document_type === type && document.is_current)
}

export function KYCPage() {
  const { organizationId, organization, me } = useSession()
  const queryClient = useQueryClient()
  const previewReadOnly = import.meta.env.VITE_PREVIEW_READ_ONLY === 'true'
  const [form, setForm] = useState<KYCProfileInput>(emptyForm)
  const [saveMessage, setSaveMessage] = useState('')

  const query = useQuery({
    queryKey: ['kyc', organizationId],
    queryFn: () => api.kyc(organizationId!),
    enabled: Boolean(organizationId),
  })

  useEffect(() => {
    if (query.data?.profile) setForm(toInput(query.data.profile as unknown as Record<string, unknown>))
  }, [query.data?.profile])

  const saveMutation = useMutation({
    mutationFn: () => api.updateKYC(organizationId!, form),
    onSuccess: async () => {
      setSaveMessage('Dados salvos.')
      await queryClient.invalidateQueries({ queryKey: ['kyc', organizationId] })
    },
  })

  const uploadMutation = useMutation({
    mutationFn: ({ type, file }: { type: KYCDocumentType; file: File }) => api.uploadKYCDocument(organizationId!, type, file),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['kyc', organizationId] })
    },
  })

  const submitMutation = useMutation({
    mutationFn: () => api.submitKYC(organizationId!),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['kyc', organizationId] })
    },
  })

  const status = query.data?.profile.status
  const editable = status === 'draft' || status === 'needs_changes' || status === 'rejected'
  const merchant = me?.merchants.find((item) => item.id === organization?.merchant_id)
  const docs = query.data?.documents ?? []
  const requiredDocs = query.data?.required_documents ?? []
  const requiredReady = requiredDocs.every((type) => Boolean(currentDocument(docs, type)))

  const completion = useMemo(() => {
    const keys: (keyof KYCProfileInput)[] = ['legal_name','tax_id','company_email','company_phone','address_line1','city','state','postal_code','representative_name','representative_document','representative_birth_date','representative_role','representative_email','representative_phone']
    const fields = keys.filter((key) => form[key].trim()).length
    const docsReady = requiredDocs.filter((type) => Boolean(currentDocument(docs, type))).length
    const total = keys.length + requiredDocs.length
    return total ? Math.round(((fields + docsReady) / total) * 100) : 0
  }, [form, docs, requiredDocs])

  const set = (key: keyof KYCProfileInput) => (event: ChangeEvent<HTMLInputElement>) => {
    setSaveMessage('')
    setForm((current) => ({ ...current, [key]: event.target.value }))
  }

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!previewReadOnly && editable) saveMutation.mutate()
  }

  const upload = (type: KYCDocumentType) => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || previewReadOnly || !editable) return
    uploadMutation.mutate({ type, file })
  }

  if (!organizationId) return <div className="empty-state"><strong>Selecione uma organização</strong><span>O KYC pertence ao Merchant da organização atual.</span></div>
  if (query.isLoading) return <div className="skeleton skeleton-panel" aria-busy="true" />
  if (query.isError || !status) return <div className="error-state"><CircleAlert size={22} /><strong>Não foi possível carregar a verificação.</strong><span>{query.error instanceof Error ? query.error.message : 'Tente novamente.'}</span></div>

  const copy = statusCopy[status]
  const submissionError = submitMutation.error instanceof ApiError ? submitMutation.error : undefined

  return (
    <div className="page-stack kyc-page">
      <section className={`kyc-status-hero panel status-${status}`}>
        <div className="kyc-status-icon">{status === 'approved' ? <CheckCircle2 size={25} /> : <ShieldCheck size={25} />}</div>
        <div className="kyc-status-copy">
          <div className="kyc-status-line"><span className={`kyc-status-pill status-${status}`}>{copy.label}</span><span>{merchant?.name || 'Merchant'}</span></div>
          <h2>{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        {editable ? <div className="kyc-progress"><strong>{completion}%</strong><span>preenchido</span></div> : null}
      </section>

      {query.data.profile.public_note ? (
        <section className="kyc-observation">
          <CircleAlert size={19} />
          <div><strong>Observação da análise</strong><p>{query.data.profile.public_note}</p></div>
        </section>
      ) : null}

      {status !== 'approved' ? (
        <section className="context-strip kyc-financial-gate">
          <div className="context-strip-icon"><ShieldCheck size={16} /></div>
          <div><strong>Operações financeiras reais permanecem protegidas</strong><span>Providers reais, geração de Pix em produção e saques só são habilitados após a aprovação do KYC/KYB.</span></div>
        </section>
      ) : null}

      <form className="kyc-form page-stack" onSubmit={save}>
        <section className="panel kyc-section">
          <div className="panel-header"><div><h2><Building2 size={18} /> Empresa</h2><p>Dados cadastrais da entidade legal responsável pelo Merchant.</p></div></div>
          <div className="kyc-field-grid">
            <label className="field span-2"><span>Razão social *</span><input value={form.legal_name} onChange={set('legal_name')} disabled={!editable} /></label>
            <label className="field"><span>Nome fantasia</span><input value={form.trade_name} onChange={set('trade_name')} disabled={!editable} /></label>
            <label className="field"><span>CNPJ *</span><input value={form.tax_id} onChange={set('tax_id')} inputMode="numeric" disabled={!editable} placeholder="00.000.000/0000-00" /></label>
            <label className="field"><span>Data de abertura</span><input type="date" value={form.incorporation_date} onChange={set('incorporation_date')} disabled={!editable} /></label>
            <label className="field"><span>E-mail da empresa *</span><input type="email" value={form.company_email} onChange={set('company_email')} disabled={!editable} /></label>
            <label className="field"><span>Telefone da empresa *</span><input value={form.company_phone} onChange={set('company_phone')} disabled={!editable} /></label>
          </div>
        </section>

        <section className="panel kyc-section">
          <div className="panel-header"><div><h2><MapPin size={18} /> Endereço</h2><p>Endereço cadastral usado na análise da empresa.</p></div></div>
          <div className="kyc-field-grid">
            <label className="field span-2"><span>Logradouro e número *</span><input value={form.address_line1} onChange={set('address_line1')} disabled={!editable} /></label>
            <label className="field"><span>Complemento</span><input value={form.address_line2} onChange={set('address_line2')} disabled={!editable} /></label>
            <label className="field"><span>Bairro</span><input value={form.district} onChange={set('district')} disabled={!editable} /></label>
            <label className="field"><span>Cidade *</span><input value={form.city} onChange={set('city')} disabled={!editable} /></label>
            <label className="field"><span>UF *</span><input value={form.state} onChange={set('state')} maxLength={2} disabled={!editable} /></label>
            <label className="field"><span>CEP *</span><input value={form.postal_code} onChange={set('postal_code')} inputMode="numeric" disabled={!editable} /></label>
            <label className="field"><span>País</span><input value={form.country} onChange={set('country')} disabled={!editable} /></label>
          </div>
        </section>

        <section className="panel kyc-section">
          <div className="panel-header"><div><h2><UserRound size={18} /> Representante legal</h2><p>Pessoa responsável pela conta e pela submissão da verificação.</p></div></div>
          <div className="kyc-field-grid">
            <label className="field span-2"><span>Nome completo *</span><input value={form.representative_name} onChange={set('representative_name')} disabled={!editable} /></label>
            <label className="field"><span>CPF *</span><input value={form.representative_document} onChange={set('representative_document')} inputMode="numeric" disabled={!editable} /></label>
            <label className="field"><span>Data de nascimento *</span><input type="date" value={form.representative_birth_date} onChange={set('representative_birth_date')} disabled={!editable} /></label>
            <label className="field"><span>Cargo / vínculo *</span><input value={form.representative_role} onChange={set('representative_role')} disabled={!editable} placeholder="Sócio administrador" /></label>
            <label className="field"><span>E-mail *</span><input type="email" value={form.representative_email} onChange={set('representative_email')} disabled={!editable} /></label>
            <label className="field"><span>Telefone *</span><input value={form.representative_phone} onChange={set('representative_phone')} disabled={!editable} /></label>
          </div>
        </section>

        {editable ? (
          <div className="kyc-save-bar">
            <div>{saveMessage ? <span className="success-text">{saveMessage}</span> : <span>Salve os dados antes de enviar para análise.</span>}</div>
            <button className="button button-secondary" type="submit" disabled={previewReadOnly || saveMutation.isPending}>{previewReadOnly ? 'Bloqueado no preview' : saveMutation.isPending ? 'Salvando…' : 'Salvar dados'}</button>
          </div>
        ) : null}
      </form>

      <section className="panel kyc-section">
        <div className="panel-header"><div><h2><FileCheck2 size={18} /> Documentos</h2><p>Arquivos privados. Aceitamos PDF, JPEG ou PNG de até 15 MB.</p></div><span className="count-pill">{requiredDocs.filter((type) => currentDocument(docs, type)).length}/{requiredDocs.length} obrigatórios</span></div>
        <div className="kyc-document-grid">
          {(Object.keys(documentLabels) as KYCDocumentType[]).map((type) => {
            const descriptor = documentLabels[type]
            const doc = currentDocument(docs, type)
            return (
              <article className={`kyc-document-card${doc ? ' has-document' : ''}`} key={type}>
                <div className="kyc-document-head"><span className="kyc-document-icon"><FileText size={18} /></span><div><strong>{descriptor.title}{descriptor.required ? ' *' : ''}</strong><span>{descriptor.description}</span></div></div>
                {doc ? (
                  <div className="kyc-document-current">
                    <button type="button" className="document-link" onClick={() => window.open(api.kycDocumentURL(organizationId, doc.id), '_blank', 'noopener,noreferrer')}><FileCheck2 size={15} />{doc.original_name}</button>
                    <span>v{doc.version} · {formatDateTime(doc.uploaded_at)}</span>
                  </div>
                ) : <span className="kyc-document-missing">Ainda não enviado</span>}
                {editable ? (
                  <label className={`button button-secondary kyc-upload-button${previewReadOnly ? ' disabled' : ''}`}>
                    <Upload size={15} />{doc ? 'Substituir arquivo' : 'Enviar arquivo'}
                    <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={upload(type)} disabled={previewReadOnly || uploadMutation.isPending} />
                  </label>
                ) : null}
              </article>
            )
          })}
        </div>
        {uploadMutation.isError ? <div className="inline-error">{uploadMutation.error instanceof Error ? uploadMutation.error.message : 'Falha no upload do documento.'}</div> : null}
      </section>

      {editable ? (
        <section className="kyc-submit-panel panel">
          <div><span className="eyebrow">Etapa final</span><h2>Enviar para análise</h2><p>Depois do envio, os dados ficam bloqueados até a decisão do time da Flash Pag. Se precisarmos de algo, o status mudará para Correção necessária com uma observação.</p></div>
          <button className="button button-primary" type="button" disabled={previewReadOnly || submitMutation.isPending || !requiredReady} onClick={() => submitMutation.mutate()}>{previewReadOnly ? 'Bloqueado no preview' : submitMutation.isPending ? 'Enviando…' : 'Enviar KYC/KYB'}</button>
          {submissionError ? <div className="inline-error span-full">{submissionError.message}{submissionError.missing?.length ? ` · Pendências: ${submissionError.missing.join(', ')}` : ''}</div> : null}
        </section>
      ) : null}
    </div>
  )
}
