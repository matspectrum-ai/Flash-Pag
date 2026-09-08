import { BookOpen, ExternalLink, FileCode2, KeyRound, Webhook } from 'lucide-react'

export function DocsPage() {
  return (
    <div className="page-stack">
      <section className="docs-hero panel">
        <div><span className="eyebrow">Flash Pag API</span><h2>Integre Pix sem carregar a complexidade operacional para o merchant.</h2><p>As credenciais e os recursos da API são sempre vinculados a uma única organização. Use uma API Key diferente por ambiente e aplicação.</p></div>
        <BookOpen size={28} />
      </section>

      <section className="docs-grid">
        <a className="docs-card panel" href="/docs" target="_blank" rel="noreferrer"><span className="docs-card-icon"><BookOpen size={19} /></span><div><strong>Documentação pública</strong><span>Fluxos, autenticação e exemplos da API.</span></div><ExternalLink size={16} /></a>
        <a className="docs-card panel" href="/openapi.yaml" target="_blank" rel="noreferrer"><span className="docs-card-icon"><FileCode2 size={19} /></span><div><strong>OpenAPI</strong><span>Contrato legível por ferramentas e SDKs.</span></div><ExternalLink size={16} /></a>
      </section>

      <section className="panel developer-principles">
        <div className="panel-header"><div><h2>Modelo de integração</h2><p>O mínimo que um backend precisa saber.</p></div></div>
        <div className="developer-step-list">
          <article><span><KeyRound size={16} /></span><div><strong>1. Autentique pela organização</strong><p>Envie sua API Key em <code>X-API-Key</code> ou como Bearer token. A chave determina automaticamente o tenant.</p></div></article>
          <article><span><FileCode2 size={16} /></span><div><strong>2. Crie cobranças Pix</strong><p>POSTs financeiros exigem <code>Idempotency-Key</code>. Reutilizar a mesma chave com outro payload é rejeitado.</p></div></article>
          <article><span><Webhook size={16} /></span><div><strong>3. Confirme por webhook</strong><p>Use eventos de transação para atualizar seu sistema quando o pagamento mudar de estado.</p></div></article>
        </div>
      </section>
    </div>
  )
}
