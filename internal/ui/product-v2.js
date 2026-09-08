(() => {
  const copyText = async value => {
    const text = String(value ?? '');
    if (!text || text === '—') return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    flash('Copiado para a área de transferência.');
  };

  const copyButton = (value, label = 'Copiar') => {
    const b = button(label, 'copy-button');
    b.setAttribute('aria-label', label);
    b.onclick = e => {
      e.preventDefault();
      e.stopPropagation();
      copyText(value);
    };
    return b;
  };

  const usableCopyValue = value => {
    const v = String(value ?? '');
    return v && v !== '—' && !v.includes('…');
  };

  keyValue = function(label, value, mono = false) {
    const row = node('div', undefined, 'kv');
    row.append(node('span', label));
    const right = node('div', undefined, 'kv-value');
    right.append(node('strong', value ?? '—', mono ? 'mono' : ''));
    if (mono && usableCopyValue(value)) right.append(copyButton(value));
    row.append(right);
    return row;
  };

  function skeletonPage() {
    const wrap = node('div', undefined, 'skeleton-page');
    const stats = node('div', undefined, 'metrics-grid');
    for (let i = 0; i < 4; i++) {
      const card = node('div', undefined, 'metric-card skeleton-card');
      card.append(node('span', '', 'skeleton skeleton-sm'), node('span', '', 'skeleton skeleton-lg'), node('span', '', 'skeleton skeleton-md'));
      stats.append(card);
    }
    const panelSkeleton = node('div', undefined, 'panel skeleton-panel');
    panelSkeleton.append(node('span', '', 'skeleton skeleton-sm'), node('span', '', 'skeleton skeleton-row'), node('span', '', 'skeleton skeleton-row'), node('span', '', 'skeleton skeleton-row'));
    wrap.append(stats, panelSkeleton);
    return wrap;
  }

  function errorState(err) {
    const wrap = node('div', undefined, 'error-state');
    const mark = node('div', '!', 'error-mark');
    const copy = node('div');
    copy.append(node('strong', 'Não foi possível carregar esta área'), node('p', err?.message || 'Ocorreu um erro inesperado.'));
    const retry = button('Tentar novamente', 'secondary compact', () => loadView());
    wrap.append(mark, copy, retry);
    return wrap;
  }

  const viewTitles = {
    dashboard: ['Dashboard', 'Visão operacional da organização'],
    transactions: ['Transações', 'Acompanhe Pix, transferências e saques'],
    transfers: ['Transferências', 'Envie Pix e acompanhe saídas'],
    customers: ['Clientes', 'Pagadores e histórico operacional'],
    integrations: ['Integrações', 'Providers, credenciais e acesso à API'],
    webhooks: ['Webhooks', 'Endpoints e entrega de eventos'],
    accounts: ['Contas', 'Saldo e estrutura financeira da organização'],
    organizations: ['Organizações', 'Estrutura multi-tenant do merchant'],
    admin: ['Administração', 'Merchants, organizações e governança'],
  };

  loadView = async function() {
    closeDrawer();
    const title = viewTitles[state.view] || viewTitles.dashboard;
    $('#page-title').textContent = title[0];
    $('#page-subtitle').textContent = title[1];
    $('#content').replaceChildren(skeletonPage());
    if (!state.orgId && !['organizations', 'admin'].includes(state.view)) {
      setContent(panel('Sem organização', emptyState('Crie ou selecione uma organização para continuar.')));
      return;
    }
    const handlers = { dashboard, transactions, transfers, customers, integrations, webhooks, accounts, organizations, admin };
    try {
      await (handlers[state.view] || dashboard)();
      enhanceSecretCallouts();
    } catch (err) {
      setContent(panel('', errorState(err)));
    }
  };

  const baseTransactionDetail = transactionDetail;
  transactionDetail = function(tx) {
    const box = baseTransactionDetail(tx);

    const lifecycle = node('div', undefined, 'lifecycle-card');
    lifecycle.append(node('strong', 'Estado da operação', 'block-title'));
    const steps = node('div', undefined, 'lifecycle');

    const created = node('div', undefined, 'lifecycle-step done');
    created.append(node('span', '1', 'lifecycle-dot'), (() => {
      const x = node('div');
      x.append(node('strong', 'Registrada na Flash Pag'), node('small', date(tx.created_at)));
      return x;
    })());
    steps.append(created);

    const providerState = node('div', undefined, `lifecycle-step ${tx.provider_external_id ? 'done' : tx.status === 'failed' ? 'muted' : 'current'}`);
    providerState.append(node('span', '2', 'lifecycle-dot'), (() => {
      const x = node('div');
      x.append(node('strong', tx.provider_external_id ? 'Referência externa criada' : 'Processamento no provider'), node('small', tx.provider_external_id ? shortId(tx.provider_external_id) : (tx.provider_code || 'Aguardando provider')));
      return x;
    })());
    steps.append(providerState);

    const finalLabels = {
      succeeded: ['Concluída', 'O estado final foi confirmado.'],
      failed: ['Falhou', 'A operação terminou com falha final.'],
      pending: ['Pendente', 'Aguardando confirmação ou reconciliação.'],
      ambiguous: ['Ambígua', 'O saldo deve permanecer protegido até reconciliação.'],
    };
    const [finalTitle, finalCopy] = finalLabels[tx.status] || ['Em processamento', 'Acompanhe o estado desta operação.'];
    const final = node('div', undefined, `lifecycle-step ${tx.status === 'succeeded' || tx.status === 'failed' ? 'done' : 'current'}`);
    final.append(node('span', '3', 'lifecycle-dot'), (() => {
      const x = node('div');
      x.append(node('strong', finalTitle), node('small', finalCopy));
      return x;
    })());
    steps.append(final);
    lifecycle.append(steps);

    if (tx.failure_code || tx.failure_message) {
      const failure = node('div', undefined, 'failure-callout');
      failure.append(node('strong', tx.failure_code || 'Falha do provider'), node('span', tx.failure_message || 'A operação não foi concluída.'));
      lifecycle.append(failure);
    }

    const actionBar = node('div', undefined, 'detail-copy-actions');
    if (usableCopyValue(tx.id)) actionBar.append(copyButton(tx.id, 'Copiar transaction ID'));
    if (usableCopyValue(tx.provider_external_id)) actionBar.append(copyButton(tx.provider_external_id, 'Copiar provider ID'));
    if (usableCopyValue(tx.pix_key)) actionBar.append(copyButton(tx.pix_key, 'Copiar chave Pix'));
    if (actionBar.children.length) lifecycle.append(actionBar);

    const hero = box.querySelector('.detail-hero');
    if (hero?.nextSibling) box.insertBefore(lifecycle, hero.nextSibling);
    else box.append(lifecycle);
    return box;
  };

  function apiAccessPanel() {
    const wrap = node('div', undefined, 'developer-grid');
    const baseUrl = `${window.location.origin}/v1`;
    const docsUrl = `${window.location.origin}/docs`;

    const endpoint = node('div', undefined, 'developer-card');
    endpoint.append(node('span', 'Base URL', 'eyebrow'));
    const endpointValue = node('div', undefined, 'developer-value');
    endpointValue.append(node('code', baseUrl), copyButton(baseUrl));
    endpoint.append(endpointValue, node('p', 'API REST da organização para saldo, clientes, Pix e transferências.'));

    const auth = node('div', undefined, 'developer-card');
    auth.append(node('span', 'Autenticação', 'eyebrow'));
    const authValue = node('div', undefined, 'developer-value');
    authValue.append(node('code', 'X-API-Key: fp_live_…'), copyButton('X-API-Key', 'Copiar header'));
    auth.append(authValue, node('p', 'Use API keys com o menor conjunto de scopes necessário para cada integração.'));

    const idempotency = node('div', undefined, 'developer-card');
    idempotency.append(node('span', 'Operações financeiras', 'eyebrow'), node('strong', 'Idempotency-Key obrigatório'), node('p', 'Toda criação financeira deve ter uma chave única para impedir duplicidade em retries.'));

    wrap.append(endpoint, auth, idempotency);

    const actions = node('div', undefined, 'developer-actions');
    const docs = button('Abrir documentação', 'primary-action', () => window.open(docsUrl, '_blank', 'noopener'));
    const copyBase = copyButton(baseUrl, 'Copiar Base URL');
    actions.append(docs, copyBase);

    const shell = node('div', undefined, 'developer-access');
    shell.append(wrap, actions);
    return shell;
  }

  function rbacPanel() {
    const roles = [
      ['Viewer', 'Leitura', 'Consulta saldo, transações, clientes e estrutura.'],
      ['Member', 'Operação de clientes', 'Leitura + cadastro operacional de clientes.'],
      ['Admin', 'Operação privilegiada', 'Clientes, saídas Pix, API keys, providers e webhooks.'],
      ['Owner', 'Controle do merchant', 'Mesmo conjunto privilegiado para a operação atual.'],
      ['Platform admin', 'Provisionamento', 'Cria merchants/organizações e associa membros na plataforma.'],
    ];
    const grid = node('div', undefined, 'rbac-grid');
    roles.forEach(([role, title, copy]) => {
      const card = node('div', undefined, 'rbac-card');
      card.append(node('strong', role), node('span', title), node('p', copy));
      grid.append(card);
    });
    return grid;
  }

  const baseIntegrations = integrations;
  integrations = async function() {
    await baseIntegrations();
    $('#content').append(panel('Acesso para desenvolvedores', apiAccessPanel()));
    enhanceSecretCallouts();
  };

  const baseTransactions = transactions;
  transactions = async function() {
    await baseTransactions();
    const toolbar = $('#content .transaction-toolbar');
    if (toolbar && !toolbar.querySelector('[data-reset-filters]')) {
      const reset = button('Limpar filtros', 'secondary compact');
      reset.dataset.resetFilters = '1';
      reset.onclick = () => {
        $$('input,select', toolbar).forEach(control => {
          if (control.tagName === 'SELECT') control.selectedIndex = 0;
          else control.value = '';
          control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
        });
      };
      toolbar.append(reset);
    }
  };

  const baseWebhooks = webhooks;
  webhooks = async function() {
    await baseWebhooks();
    const pending = node('div', undefined, 'observability-placeholder');
    const copy = node('div');
    copy.append(node('strong', 'Logs de entrega'), node('p', 'A estrutura de retries já existe no backend. A listagem de tentativas ficará disponível aqui quando o console expuser webhook_deliveries.'));
    pending.append(node('span', 'Próxima camada', 'tag neutral'), copy);
    $('#content').append(panel('Observabilidade', pending));
  };

  const baseAdmin = admin;
  admin = async function() {
    await baseAdmin();
    if (!state.me.user.platform_admin) return;
    $('#content').append(panel('Modelo de permissões', rbacPanel()));
    const guard = node('div', undefined, 'admin-guard');
    guard.append(node('strong', 'Separação de responsabilidades'), node('p', 'Merchant users operam dentro do escopo do merchant. Platform admins fazem provisionamento da plataforma. Dados financeiros continuam isolados por organização.'));
    $('#content').append(guard);
  };

  function enhanceSecretCallouts() {
    $$('.secret-callout').forEach(box => {
      if (box.dataset.enhancedCopy === '1') return;
      const code = box.querySelector('code');
      if (!code?.textContent) return;
      const actions = node('div', undefined, 'secret-actions');
      actions.append(copyButton(code.textContent, 'Copiar secret'));
      box.append(actions);
      box.dataset.enhancedCopy = '1';
    });
  }

  const observer = new MutationObserver(() => enhanceSecretCallouts());
  observer.observe($('#content'), { childList: true, subtree: true });
})();
