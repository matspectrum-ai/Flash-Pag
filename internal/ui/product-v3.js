(() => {
  const prependContent = el => {
    const content = $('#content');
    if (!content || !el) return;
    content.insertBefore(el, content.firstChild);
  };

  const originalEmptyState = emptyState;
  emptyState = function(text, title = 'Nada por aqui') {
    const stateEl = originalEmptyState(text, title);
    if (!stateEl.querySelector('.empty-mark')) {
      const mark = node('div', '·', 'empty-mark');
      stateEl.insertBefore(mark, stateEl.firstChild);
    }
    return stateEl;
  };

  function operationalHint(title, copy, tone = '') {
    const box = node('div', undefined, `operational-hint ${tone}`.trim());
    box.append(node('strong', title), node('span', copy));
    return box;
  }

  function updateOrgContext() {
    const topbar = $('.topbar-actions');
    if (!topbar || $('#org-context-chip')) return;
    const org = (state.me?.organizations || []).find(item => item.id === state.orgId);
    if (!org) return;
    const chip = node('div', undefined, 'org-context-chip');
    chip.id = 'org-context-chip';
    chip.append(node('span', 'Tenant'), node('strong', org.slug || org.name));
    topbar.insertBefore(chip, topbar.firstChild);
  }

  const originalShowApp = showApp;
  showApp = function() {
    originalShowApp();
    requestAnimationFrame(updateOrgContext);
  };

  const originalLoadView = loadView;
  loadView = async function() {
    $('#org-context-chip')?.remove();
    await originalLoadView();
    updateOrgContext();
    normalizeRenderedView();
  };

  function normalizeRenderedView() {
    $$('.panel').forEach(panelEl => {
      if (!panelEl.querySelector('.panel-head') && panelEl.children.length > 0) panelEl.classList.add('panel-flat-head');
    });
    $$('.form-grid').forEach(form => form.classList.add('consistent-form'));
    $$('.table-wrap').forEach(wrap => wrap.setAttribute('tabindex', '0'));
    $$('.badge').forEach(item => item.setAttribute('role', 'status'));
  }

  const baseDashboard = dashboard;
  dashboard = async function() {
    await baseDashboard();
    const firstQuick = $('.product-quick .quick-action.rich');
    if (firstQuick) {
      const strong = firstQuick.querySelector('strong');
      const copy = firstQuick.querySelector('span');
      if (strong) strong.textContent = 'Clientes';
      if (copy) copy.textContent = 'Cadastre pagadores antes de gerar cobranças pela API';
    }
    normalizeRenderedView();
  };

  const baseTransfers = transfers;
  transfers = async function() {
    await baseTransfers();
    const [txData, summary] = await Promise.all([
      api('/console/api/transactions'),
      api(orgQuery('/console/api/summary')),
    ]);
    const rows = (txData.data || []).filter(r => ['transfer', 'withdrawal'].includes(r.kind));
    const succeeded = rows.filter(r => r.status === 'succeeded');
    const open = rows.filter(r => ['pending', 'ambiguous'].includes(r.status));
    const sent = succeeded.reduce((acc, r) => acc + Number(r.amount_minor || 0), 0);

    const metrics = node('div', undefined, 'mini-summary-grid');
    metrics.append(
      statCard('Disponível', money(summary.balance.available_minor), 'Saldo interno'),
      statCard('Saídas concluídas', money(sent), `${succeeded.length} operação(ões)`),
      statCard('Em aberto', String(open.length), 'Pending + ambiguous'),
      statCard('Total de saídas', String(rows.length), 'Histórico carregado')
    );

    const intro = sectionIntro('Saídas Pix', 'Crie transferências e saques com reserva de saldo antes da chamada ao provider.');
    prependContent(metrics);
    prependContent(intro);

    const form = $('#content form');
    if (form) {
      const hint = form.querySelector('.form-hint');
      if (hint) hint.textContent = 'A saída só é concluída quando o provider confirma. Em caso ambíguo, o saldo permanece reservado para reconciliação. Limites mínimos podem variar por provider.';
    }
    normalizeRenderedView();
  };

  const baseCustomers = customers;
  customers = async function() {
    await baseCustomers();
    const form = $('#content form');
    if (form && !form.querySelector('.customer-form-note')) {
      const note = operationalHint('Dados do pagador', 'Para cobranças Pixhub, mantenha CPF/CNPJ válido. E-mail e ID externo são opcionais no cadastro da Flash Pag.');
      note.classList.add('customer-form-note', 'wide');
      form.insertBefore(note, form.querySelector('.form-actions'));
    }
    normalizeRenderedView();
  };

  const baseIntegrations = integrations;
  integrations = async function() {
    await baseIntegrations();
    const providerForm = [...$$('#content form')].find(f => f.querySelector('select[name="provider"]'));
    if (providerForm && !providerForm.querySelector('.provider-form-note')) {
      const note = operationalHint('Credenciais sensíveis', 'Client secrets são enviados ao backend para criptografia e não devem reaparecer na interface depois da criação.');
      note.classList.add('provider-form-note', 'wide');
      providerForm.insertBefore(note, providerForm.querySelector('.form-actions'));
    }
    normalizeRenderedView();
  };

  const baseWebhooks = webhooks;
  webhooks = async function() {
    await baseWebhooks();
    const form = $('#content form');
    if (form && !form.querySelector('.webhook-form-note')) {
      const note = operationalHint('Endpoint público HTTPS', 'Em produção, o destino precisa ser alcançável pela internet e validar a assinatura HMAC antes de processar o evento.');
      note.classList.add('webhook-form-note', 'wide');
      form.insertBefore(note, form.querySelector('.form-actions'));
    }
    normalizeRenderedView();
  };

  const baseAccounts = accounts;
  accounts = async function() {
    await baseAccounts();
    const warning = operationalHint('Saldo interno ≠ saldo do provider', 'O ledger da Flash Pag é a fonte do saldo operacional da organização. O saldo Pixhub é exibido apenas como referência externa.', 'neutral');
    prependContent(warning);
    normalizeRenderedView();
  };

  const baseOrganizations = organizations;
  organizations = async function() {
    await baseOrganizations();
    const callout = operationalHint('Contexto isolado', 'Trocar de organização muda o tenant ativo do console. Transações, clientes, contas, providers e webhooks permanecem separados por organização.', 'neutral');
    prependContent(callout);
    normalizeRenderedView();
  };

  const baseAdmin = admin;
  admin = async function() {
    await baseAdmin();
    if (!state.me.user.platform_admin) return;
    const forms = $$('.admin-form-grid .panel');
    forms.forEach((panelEl, index) => {
      const labels = ['1. Merchant', '2. Organização', '3. Membro'];
      const pill = node('span', labels[index] || `Etapa ${index + 1}`, 'admin-step-pill');
      panelEl.insertBefore(pill, panelEl.firstChild);
    });
    normalizeRenderedView();
  };

  const originalNavigate = navigate;
  navigate = function(view) {
    originalNavigate(view);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const originalDrawer = drawer;
  drawer = function(title, content) {
    originalDrawer(title, content);
    $('#drawer-layer')?.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => $('#drawer-close')?.focus({ preventScroll: true }));
  };

  const originalCloseDrawer = closeDrawer;
  closeDrawer = function() {
    originalCloseDrawer();
    $('#drawer-layer')?.setAttribute('aria-hidden', 'true');
  };

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('#drawer-layer')?.classList.contains('hidden')) {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      const search = $('#content input[name="search"]');
      if (search) {
        event.preventDefault();
        search.focus();
      }
    }
  });

  const orgSelect = $('#org-select');
  orgSelect?.addEventListener('change', () => {
    $('#org-context-chip')?.remove();
    requestAnimationFrame(updateOrgContext);
  });

  normalizeRenderedView();
})();