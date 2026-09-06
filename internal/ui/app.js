const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const state = {
  me: null,
  orgId: null,
  view: 'dashboard',
  transactions: [],
  customers: [],
  connections: [],
  apiKeys: [],
};

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.orgId) headers['X-Organization-Id'] = state.orgId;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
}

function node(tag, text, cls) {
  const el = document.createElement(tag);
  if (text !== undefined && text !== null) el.textContent = text;
  if (cls) el.className = cls;
  return el;
}

function money(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(v) || 0) / 100);
}

function date(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('pt-BR');
}

function shortDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('pt-BR');
}

function shortId(v) {
  if (!v) return '—';
  return v.length > 18 ? `${v.slice(0, 8)}…${v.slice(-6)}` : v;
}

function labelStatus(v) {
  return ({ succeeded: 'Concluída', failed: 'Falhou', pending: 'Pendente', ambiguous: 'Ambígua', active: 'Ativa', disabled: 'Desativada', blocked: 'Bloqueada', error: 'Erro', revoked: 'Revogada' })[v] || v || '—';
}

function labelKind(v) {
  return ({ pix_in: 'Pix recebido', transfer: 'Transferência', withdrawal: 'Saque' })[v] || v || '—';
}

function flash(msg, bad = false) {
  const el = $('#flash');
  el.textContent = msg;
  el.classList.toggle('bad', bad);
  el.classList.remove('hidden');
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => el.classList.add('hidden'), 5000);
}

function badge(v) {
  return node('span', labelStatus(v), `badge ${v || ''}`);
}

function button(text, cls = 'secondary', onClick) {
  const b = node('button', text, cls);
  b.type = 'button';
  if (onClick) b.onclick = onClick;
  return b;
}

function table(rows, columns, opts = {}) {
  const wrap = node('div', undefined, 'table-wrap');
  if (!rows?.length) {
    wrap.append(emptyState(opts.empty || 'Nenhum registro encontrado.'));
    return wrap;
  }
  const t = node('table');
  const thead = node('thead');
  const trh = node('tr');
  columns.forEach(c => trh.append(node('th', c.label)));
  thead.append(trh);
  t.append(thead);
  const tb = node('tbody');
  rows.forEach(r => {
    const tr = node('tr');
    if (opts.onRowClick) {
      tr.classList.add('row-clickable');
      tr.onclick = e => {
        if (e.target.closest('button,a,input,select')) return;
        opts.onRowClick(r);
      };
    }
    columns.forEach(c => {
      const td = node('td');
      if (c.className) td.className = c.className;
      const val = c.render ? c.render(r) : r[c.key];
      if (val instanceof Node) td.append(val);
      else td.textContent = val ?? '—';
      tr.append(td);
    });
    tb.append(tr);
  });
  t.append(tb);
  wrap.append(t);
  return wrap;
}

function panel(title, content, actions) {
  const p = node('section', undefined, 'panel');
  if (title || actions) {
    const h = node('div', undefined, 'panel-head');
    const left = node('div');
    if (title) left.append(node('h2', title));
    h.append(left);
    if (actions) h.append(actions);
    p.append(h);
  }
  if (content) p.append(content);
  return p;
}

function statCard(label, value, meta = '', tone = '') {
  const c = node('div', undefined, `metric-card ${tone}`.trim());
  c.append(node('div', label, 'metric-label'));
  c.append(node('div', value, 'metric-value'));
  if (meta) c.append(node('div', meta, 'metric-meta'));
  return c;
}

function emptyState(text, title = 'Nada por aqui') {
  const e = node('div', undefined, 'empty');
  e.append(node('strong', title));
  e.append(node('span', text));
  return e;
}

function setContent(...els) {
  $('#content').replaceChildren(...els);
}

function field(label, input) {
  const l = node('label');
  l.append(node('span', label));
  l.append(input);
  return l;
}

function input(name, opts = {}) {
  const i = document.createElement(opts.tag || 'input');
  i.name = name;
  if (opts.type) i.type = opts.type;
  if (opts.placeholder) i.placeholder = opts.placeholder;
  if (opts.required) i.required = true;
  if (opts.value !== undefined) i.value = opts.value;
  if (opts.min !== undefined) i.min = opts.min;
  if (opts.step !== undefined) i.step = opts.step;
  return i;
}

function select(name, options, value = '') {
  const s = document.createElement('select');
  s.name = name;
  options.forEach(o => {
    const op = node('option', o.label);
    op.value = o.value;
    if (String(o.value) === String(value)) op.selected = true;
    s.append(op);
  });
  return s;
}

function drawer(title, content) {
  $('#drawer-title').textContent = title;
  $('#drawer-content').replaceChildren(content);
  $('#drawer-layer').classList.remove('hidden');
  document.body.classList.add('drawer-open');
}

function closeDrawer() {
  $('#drawer-layer').classList.add('hidden');
  document.body.classList.remove('drawer-open');
}

$('#drawer-close').onclick = closeDrawer;
$('#drawer-backdrop').onclick = closeDrawer;

function keyValue(label, value, mono = false) {
  const row = node('div', undefined, 'kv');
  row.append(node('span', label));
  row.append(node('strong', value ?? '—', mono ? 'mono' : ''));
  return row;
}

function orgQuery(path) {
  const join = path.includes('?') ? '&' : '?';
  return `${path}${join}organization_id=${encodeURIComponent(state.orgId)}`;
}

function navigate(view) {
  state.view = view;
  $$('nav button[data-view]').forEach(x => x.classList.toggle('active', x.dataset.view === view));
  loadView();
}

async function boot() {
  try {
    state.me = await api('/console/api/me');
    showApp();
  } catch {
    showLogin();
  }
}

function showLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
}

function showApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#user-email').textContent = state.me.user.email;
  $('#user-role').textContent = state.me.user.platform_admin ? 'Platform admin' : 'Merchant user';
  $('#admin-nav-wrap').classList.toggle('hidden', !state.me.user.platform_admin);
  const sel = $('#org-select');
  sel.replaceChildren();
  state.me.organizations.forEach(o => {
    const op = node('option', `${o.name} · ${o.slug}`);
    op.value = o.id;
    sel.append(op);
  });
  const remembered = localStorage.getItem('flashpag_org');
  state.orgId = state.me.organizations.some(o => o.id === remembered) ? remembered : (state.me.organizations[0]?.id || null);
  if (state.orgId) sel.value = state.orgId;
  sel.onchange = () => {
    state.orgId = sel.value;
    localStorage.setItem('flashpag_org', state.orgId);
    loadView();
  };
  navigate(state.view);
}

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  $('#login-error').textContent = '';
  const submit = $('#login-submit');
  submit.disabled = true;
  try {
    await api('/console/session', { method: 'POST', body: JSON.stringify({ email: $('#email').value, password: $('#password').value }) });
    state.me = await api('/console/api/me');
    showApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
  } finally {
    submit.disabled = false;
  }
});

$('#logout').onclick = async () => {
  await api('/console/session', { method: 'DELETE' }).catch(() => {});
  state.me = null;
  showLogin();
};

$$('nav button[data-view]').forEach(b => b.onclick = () => navigate(b.dataset.view));

const titles = {
  dashboard: ['Dashboard', 'Visão operacional da organização'],
  transactions: ['Transações', 'Acompanhe Pix, transferências e saques'],
  transfers: ['Transferências', 'Envie Pix e acompanhe saídas'],
  customers: ['Clientes', 'Pagadores e histórico operacional'],
  integrations: ['Integrações', 'Providers, credenciais e API keys'],
  webhooks: ['Webhooks', 'Endpoints que recebem eventos da Flash Pag'],
  accounts: ['Contas', 'Saldo e estrutura financeira da organização'],
  organizations: ['Organizações', 'Estrutura multi-tenant do merchant'],
  admin: ['Administração', 'Merchants, organizações e membros'],
};

async function loadView() {
  closeDrawer();
  const t = titles[state.view] || titles.dashboard;
  $('#page-title').textContent = t[0];
  $('#page-subtitle').textContent = t[1];
  $('#content').replaceChildren(node('div', 'Carregando…', 'loading'));
  if (!state.orgId && !['organizations', 'admin'].includes(state.view)) {
    setContent(panel('Sem organização', emptyState('Crie ou selecione uma organização para continuar.')));
    return;
  }
  try {
    await ({ dashboard, transactions, transfers, customers, integrations, webhooks, accounts, organizations, admin }[state.view] || dashboard)();
  } catch (err) {
    setContent(panel('Não foi possível carregar', node('div', err.message, 'error-block')));
  }
}

async function dashboard() {
  const [summary, tx, conns] = await Promise.all([
    api(orgQuery('/console/api/summary')),
    api('/console/api/transactions'),
    api('/console/api/provider-connections'),
  ]);
  const rows = tx.data || [];
  state.transactions = rows;
  state.connections = conns.data || [];
  const succeeded = rows.filter(r => r.status === 'succeeded');
  const settled = rows.filter(r => ['succeeded', 'failed'].includes(r.status));
  const inbound = succeeded.filter(r => r.direction === 'in').reduce((s, r) => s + Number(r.amount_minor || 0), 0);
  const outbound = succeeded.filter(r => r.direction === 'out').reduce((s, r) => s + Number(r.amount_minor || 0), 0);
  const successRate = settled.length ? Math.round((succeeded.length / settled.length) * 100) : 0;
  const pending = rows.filter(r => ['pending', 'ambiguous'].includes(r.status)).length;

  const metrics = node('div', undefined, 'metrics-grid');
  metrics.append(
    statCard('Disponível', money(summary.balance.available_minor), `Conta ${summary.account.name}`),
    statCard('Reservado', money(summary.balance.reserved_minor), pending ? `${pending} operação(ões) em aberto` : 'Nenhuma reserva em aberto'),
    statCard('Entradas concluídas', money(inbound), `${succeeded.filter(r => r.direction === 'in').length} recebimento(s)`),
    statCard('Taxa de sucesso', `${successRate}%`, settled.length ? `${settled.length} operação(ões) finalizadas` : 'Sem histórico suficiente')
  );

  const quick = node('div', undefined, 'quick-actions');
  quick.append(
    button('Nova transferência', 'quick-action', () => navigate('transfers')),
    button('Adicionar cliente', 'quick-action', () => navigate('customers')),
    button('Gerenciar integração', 'quick-action', () => navigate('integrations'))
  );

  const activity = node('div', undefined, 'activity-grid');
  const inBox = node('div', undefined, 'activity-card');
  inBox.append(node('span', 'Entradas confirmadas'), node('strong', money(inbound)), node('small', 'No histórico carregado'));
  const outBox = node('div', undefined, 'activity-card');
  outBox.append(node('span', 'Saídas confirmadas'), node('strong', money(outbound)), node('small', 'No histórico carregado'));
  const pendingBox = node('div', undefined, 'activity-card');
  pendingBox.append(node('span', 'Pendências'), node('strong', String(pending)), node('small', 'Pending + ambiguous'));
  activity.append(inBox, outBox, pendingBox);

  const providerList = node('div', undefined, 'provider-list');
  if (!state.connections.length) providerList.append(emptyState('Nenhuma conexão configurada.'));
  state.connections.slice(0, 5).forEach(c => {
    const row = node('div', undefined, 'provider-row');
    const left = node('div');
    left.append(node('strong', c.label || c.provider_code), node('span', c.provider_code));
    row.append(left, badge(c.status));
    providerList.append(row);
  });

  const two = node('div', undefined, 'two-col');
  two.append(panel('Atividade', activity), panel('Providers', providerList, button('Ver integrações', 'link-button', () => navigate('integrations'))));

  const recent = table(summary.recent_transactions || [], [
    { label: 'Data', render: r => date(r.created_at) },
    { label: 'Tipo', render: r => labelKind(r.kind) },
    { label: 'Status', render: r => badge(r.status) },
    { label: 'Valor', render: r => money(r.amount_minor), className: 'amount' },
    { label: 'Provider', key: 'provider_code' },
  ], { empty: 'As próximas movimentações aparecerão aqui.' });

  setContent(metrics, panel('Ações rápidas', quick), two, panel('Últimas transações', recent, button('Ver todas', 'link-button', () => navigate('transactions'))));
}

function transactionDetail(tx) {
  const box = node('div', undefined, 'detail-stack');
  const hero = node('div', undefined, 'detail-hero');
  hero.append(node('span', labelKind(tx.kind), 'eyebrow'), node('strong', money(tx.amount_minor), 'detail-amount'), badge(tx.status));
  box.append(hero);
  const grid = node('div', undefined, 'detail-grid');
  grid.append(
    keyValue('Transaction ID', tx.id, true),
    keyValue('Provider ID', tx.provider_external_id || '—', true),
    keyValue('Provider', tx.provider_code || '—'),
    keyValue('Direção', tx.direction === 'in' ? 'Entrada' : 'Saída'),
    keyValue('Criada em', date(tx.created_at)),
    keyValue('Atualizada em', date(tx.updated_at)),
    keyValue('Customer ID', tx.customer_id || '—', true),
    keyValue('Account ID', tx.account_id || '—', true),
    keyValue('Chave Pix', tx.pix_key || '—', true),
    keyValue('Descrição', tx.description || '—')
  );
  box.append(grid);
  if (tx.provider_code === 'pixhub' && ['pending', 'ambiguous'].includes(tx.status)) {
    const actions = node('div', undefined, 'drawer-actions');
    const b = button('Reconciliar agora', 'primary-action', async () => {
      b.disabled = true;
      try {
        const fresh = await api(`/console/api/transactions/${tx.id}/reconcile`, { method: 'POST' });
        flash(`Reconciliação concluída: ${labelStatus(fresh.status)}`);
        closeDrawer();
        transactions();
      } catch (err) {
        flash(err.message, true);
      } finally {
        b.disabled = false;
      }
    });
    actions.append(b);
    box.append(actions);
  }
  return box;
}

async function transactions() {
  const d = await api('/console/api/transactions');
  const rows = d.data || [];
  state.transactions = rows;

  const toolbar = node('div', undefined, 'toolbar');
  const search = input('search', { placeholder: 'Buscar por ID, provider ou chave Pix' });
  const status = select('status', [
    { value: '', label: 'Todos os status' },
    { value: 'succeeded', label: 'Concluídas' },
    { value: 'pending', label: 'Pendentes' },
    { value: 'ambiguous', label: 'Ambíguas' },
    { value: 'failed', label: 'Falhas' },
  ]);
  const kind = select('kind', [
    { value: '', label: 'Todos os tipos' },
    { value: 'pix_in', label: 'Pix recebido' },
    { value: 'transfer', label: 'Transferência' },
    { value: 'withdrawal', label: 'Saque' },
  ]);
  const providerValues = [...new Set(rows.map(r => r.provider_code).filter(Boolean))];
  const provider = select('provider', [{ value: '', label: 'Todos os providers' }, ...providerValues.map(v => ({ value: v, label: v }))]);
  toolbar.append(search, status, kind, provider);

  const body = node('div');
  function render() {
    const q = search.value.trim().toLowerCase();
    const filtered = rows.filter(r => {
      const hay = [r.id, r.provider_external_id, r.provider_code, r.pix_key, r.customer_id].filter(Boolean).join(' ').toLowerCase();
      return (!q || hay.includes(q)) && (!status.value || r.status === status.value) && (!kind.value || r.kind === kind.value) && (!provider.value || r.provider_code === provider.value);
    });
    body.replaceChildren(table(filtered, [
      { label: 'Data', render: r => date(r.created_at) },
      { label: 'Transação', render: r => { const x = node('div', undefined, 'tx-cell'); x.append(node('strong', labelKind(r.kind)), node('span', shortId(r.id), 'mono')); return x; } },
      { label: 'Status', render: r => badge(r.status) },
      { label: 'Valor', render: r => money(r.amount_minor), className: 'amount' },
      { label: 'Provider', key: 'provider_code' },
    ], { onRowClick: r => drawer('Detalhes da transação', transactionDetail(r)), empty: 'Nenhuma transação corresponde aos filtros.' }));
  }
  [search, status, kind, provider].forEach(x => x.addEventListener(x.tagName === 'INPUT' ? 'input' : 'change', render));
  render();
  setContent(panel('Todas as transações', node('div', undefined, 'stack')));
  const p = $('#content .panel');
  p.append(toolbar, body);
}

async function transfers() {
  const [tx, conns] = await Promise.all([api('/console/api/transactions'), api('/console/api/provider-connections')]);
  const rows = (tx.data || []).filter(r => ['transfer', 'withdrawal'].includes(r.kind));
  const activeConns = (conns.data || []).filter(c => c.status === 'active');

  const f = document.createElement('form');
  f.className = 'form-grid form-cardless';
  const kindSel = select('kind', [{ value: 'transfer', label: 'Transferência Pix' }, { value: 'withdrawal', label: 'Saque' }]);
  const providerSel = select('provider', state.me.installed_providers.map(p => ({ value: p, label: p })));
  const connSel = select('provider_connection_id', [{ value: '', label: 'Conexão automática' }, ...activeConns.map(c => ({ value: c.id, label: `${c.label} · ${c.provider_code}` }))]);
  const amount = input('amount_reais', { type: 'number', min: '0.01', step: '0.01', placeholder: '0,00', required: true });
  const pixKey = input('pix_key', { placeholder: 'CPF, CNPJ, e-mail, telefone ou EVP', required: true });
  const description = input('description', { placeholder: 'Descrição opcional' });
  f.append(field('Operação', kindSel), field('Provider', providerSel), field('Conexão', connSel), field('Valor (R$)', amount), field('Chave Pix', pixKey), field('Descrição', description));
  const hint = node('div', 'A saída só é concluída quando o provider confirma. Em caso ambíguo, o saldo permanece reservado para reconciliação.', 'form-hint wide');
  const actions = node('div', undefined, 'form-actions wide');
  actions.append(button('Enviar operação', 'primary-action'));
  actions.firstChild.type = 'submit';
  f.append(hint, actions);
  f.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(f);
    const reais = Number(fd.get('amount_reais'));
    const data = {
      amount_minor: Math.round(reais * 100),
      currency: 'BRL',
      pix_key: String(fd.get('pix_key') || ''),
      description: String(fd.get('description') || ''),
      provider: String(fd.get('provider') || ''),
    };
    if (fd.get('provider_connection_id')) data.provider_connection_id = String(fd.get('provider_connection_id'));
    const kindValue = fd.get('kind');
    try {
      await api(`/console/api/${kindValue === 'withdrawal' ? 'withdrawals' : 'transfers'}`, { method: 'POST', body: JSON.stringify(data) });
      flash(kindValue === 'withdrawal' ? 'Saque solicitado.' : 'Transferência criada.');
      transfers();
    } catch (err) {
      flash(err.message, true);
    }
  };

  const history = table(rows, [
    { label: 'Data', render: r => date(r.created_at) },
    { label: 'Tipo', render: r => labelKind(r.kind) },
    { label: 'Chave', render: r => shortId(r.pix_key) },
    { label: 'Status', render: r => badge(r.status) },
    { label: 'Valor', render: r => money(r.amount_minor), className: 'amount' },
  ], { onRowClick: r => drawer('Detalhes da saída', transactionDetail(r)), empty: 'Nenhuma saída Pix criada ainda.' });

  const grid = node('div', undefined, 'two-col two-col-form');
  grid.append(panel('Nova saída Pix', f), panel('Como funciona', (() => {
    const steps = node('div', undefined, 'steps');
    [['1', 'Validação', 'A Flash Pag valida saldo, provider e idempotência.'], ['2', 'Reserva', 'O valor fica reservado antes da chamada externa.'], ['3', 'Confirmação', 'Sucesso liquida; falha final libera a reserva.']].forEach(([n, t, d]) => {
      const s = node('div', undefined, 'step');
      s.append(node('span', n, 'step-number'), (() => { const x = node('div'); x.append(node('strong', t), node('small', d)); return x; })());
      steps.append(s);
    });
    return steps;
  })()));
  setContent(grid, panel('Histórico de saídas', history));
}

function customerDetail(c, txs) {
  const customerTx = txs.filter(t => t.customer_id === c.id);
  const succeeded = customerTx.filter(t => t.status === 'succeeded');
  const volume = succeeded.reduce((s, t) => s + Number(t.amount_minor || 0), 0);
  const box = node('div', undefined, 'detail-stack');
  const hero = node('div', undefined, 'customer-hero');
  const avatar = node('div', (c.name || c.email || 'C').slice(0, 1).toUpperCase(), 'avatar large');
  const copy = node('div');
  copy.append(node('strong', c.name || 'Cliente sem nome'), node('span', c.email || 'Sem e-mail'));
  hero.append(avatar, copy);
  box.append(hero);
  const stats = node('div', undefined, 'mini-metrics');
  stats.append(statCard('Transações', String(customerTx.length)), statCard('Volume concluído', money(volume)));
  box.append(stats);
  const info = node('div', undefined, 'detail-grid');
  info.append(keyValue('Customer ID', c.id, true), keyValue('Documento', c.document || '—'), keyValue('ID externo', c.external_id || '—'), keyValue('Criado em', date(c.created_at)));
  box.append(info);
  box.append(panel('Histórico', table(customerTx.slice(0, 10), [
    { label: 'Data', render: r => shortDate(r.created_at) },
    { label: 'Tipo', render: r => labelKind(r.kind) },
    { label: 'Status', render: r => badge(r.status) },
    { label: 'Valor', render: r => money(r.amount_minor) },
  ], { empty: 'Este cliente ainda não possui transações.' })));
  return box;
}

async function customers() {
  const [d, tx] = await Promise.all([api('/console/api/customers'), api('/console/api/transactions')]);
  const rows = d.data || [];
  state.customers = rows;
  const txs = tx.data || [];

  const f = document.createElement('form');
  f.className = 'form-grid form-cardless';
  f.append(
    field('Nome', input('name', { placeholder: 'Nome do cliente' })),
    field('ID externo', input('external_id', { placeholder: 'Seu identificador interno' })),
    field('E-mail', input('email', { type: 'email', placeholder: 'cliente@exemplo.com' })),
    field('Documento', input('document', { placeholder: 'CPF ou CNPJ' }))
  );
  const actions = node('div', undefined, 'form-actions wide');
  const submit = button('Adicionar cliente', 'primary-action');
  submit.type = 'submit';
  actions.append(submit);
  f.append(actions);
  f.onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(f));
    try {
      await api('/console/api/customers', { method: 'POST', body: JSON.stringify(data) });
      flash('Cliente criado.');
      customers();
    } catch (err) {
      flash(err.message, true);
    }
  };

  const search = input('search', { placeholder: 'Buscar por nome, e-mail, documento ou ID' });
  const body = node('div');
  function render() {
    const q = search.value.trim().toLowerCase();
    const filtered = rows.filter(r => !q || [r.name, r.email, r.document, r.external_id, r.id].filter(Boolean).join(' ').toLowerCase().includes(q));
    body.replaceChildren(table(filtered, [
      { label: 'Cliente', render: r => { const x = node('div', undefined, 'person-cell'); const a = node('div', (r.name || r.email || 'C').slice(0, 1).toUpperCase(), 'avatar'); const t = node('div'); t.append(node('strong', r.name || 'Sem nome'), node('span', r.email || 'Sem e-mail')); x.append(a, t); return x; } },
      { label: 'Documento', key: 'document' },
      { label: 'ID externo', key: 'external_id' },
      { label: 'Criado', render: r => shortDate(r.created_at) },
    ], { onRowClick: r => drawer('Cliente', customerDetail(r, txs)), empty: 'Nenhum cliente corresponde à busca.' }));
  }
  search.addEventListener('input', render);
  render();
  setContent(panel('Novo cliente', f), panel('Clientes', (() => { const box = node('div', undefined, 'stack'); const tb = node('div', undefined, 'toolbar'); tb.append(search); box.append(tb, body); return box; })()));
}

async function integrations() {
  const [conns, keys] = await Promise.all([api('/console/api/provider-connections'), api('/console/api/api-keys')]);
  const connections = conns.data || [];
  const apiKeys = keys.data || [];
  state.connections = connections;
  state.apiKeys = apiKeys;

  const providerForm = document.createElement('form');
  providerForm.className = 'form-grid form-cardless';
  const providerSel = select('provider', state.me.installed_providers.map(p => ({ value: p, label: p === 'pixhub' ? 'Pixhub' : p })));
  const labelInput = input('label', { value: 'Principal', required: true });
  const clientId = input('client_id', { placeholder: 'Client ID' });
  const clientSecret = input('client_secret', { type: 'password', placeholder: 'Client Secret' });
  const idField = field('Client ID', clientId);
  const secretField = field('Client Secret', clientSecret);
  function syncProviderFields() {
    const pixhub = providerSel.value === 'pixhub';
    idField.classList.toggle('hidden', !pixhub);
    secretField.classList.toggle('hidden', !pixhub);
    clientId.required = pixhub;
    clientSecret.required = pixhub;
  }
  providerSel.onchange = syncProviderFields;
  providerForm.append(field('Provider', providerSel), field('Nome da conexão', labelInput), idField, secretField);
  const providerHint = node('div', 'As credenciais são criptografadas antes de serem persistidas e não voltam na resposta da API.', 'form-hint wide');
  const providerActions = node('div', undefined, 'form-actions wide');
  const connectBtn = button('Conectar provider', 'primary-action');
  connectBtn.type = 'submit';
  providerActions.append(connectBtn);
  providerForm.append(providerHint, providerActions);
  syncProviderFields();
  providerForm.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(providerForm);
    const providerCode = String(fd.get('provider'));
    const credentials = providerCode === 'pixhub' ? { client_id: String(fd.get('client_id') || ''), client_secret: String(fd.get('client_secret') || '') } : {};
    try {
      await api('/console/api/provider-connections', { method: 'POST', body: JSON.stringify({ provider: providerCode, label: String(fd.get('label') || 'Principal'), credentials, config: {} }) });
      flash('Provider conectado.');
      integrations();
    } catch (err) {
      flash(err.message, true);
    }
  };

  const providerTable = table(connections, [
    { label: 'Conexão', render: r => { const x = node('div', undefined, 'tx-cell'); x.append(node('strong', r.label), node('span', r.provider_code)); return x; } },
    { label: 'Status', render: r => badge(r.status) },
    { label: 'Criada', render: r => shortDate(r.created_at) },
    { label: '', render: r => {
      const b = button('Testar', 'secondary compact', async () => {
        b.disabled = true;
        try {
          const h = await api(`/console/api/provider-connections/${r.id}/test`, { method: 'POST' });
          flash(h.healthy ? `${r.label}: conexão saudável · ${money(h.available_minor)} disponíveis no provider` : `${r.label}: indisponível`, !h.healthy);
        } catch (err) {
          flash(err.message, true);
        } finally {
          b.disabled = false;
        }
      });
      return b;
    } },
  ], { empty: 'Nenhum provider conectado.' });

  const keyForm = document.createElement('form');
  keyForm.className = 'form-grid form-cardless';
  const keyName = input('name', { value: 'Integração principal', required: true });
  keyForm.append(field('Nome da API key', keyName));
  const scopesBox = node('div', undefined, 'scope-grid wide');
  const scopes = ['pix:read', 'pix:write', 'balance:read', 'customers:read', 'customers:write', 'webhooks:write'];
  scopes.forEach(scope => {
    const l = node('label', undefined, 'check-row');
    const c = input('scope', { type: 'checkbox', value: scope });
    c.checked = true;
    l.append(c, node('span', scope, 'mono'));
    scopesBox.append(l);
  });
  keyForm.append(node('div', 'Scopes', 'field-label wide'), scopesBox);
  const created = node('div', undefined, 'wide');
  const keyActions = node('div', undefined, 'form-actions wide');
  const keyBtn = button('Criar API key', 'primary-action');
  keyBtn.type = 'submit';
  keyActions.append(keyBtn);
  keyForm.append(created, keyActions);
  keyForm.onsubmit = async e => {
    e.preventDefault();
    const selected = $$('input[name="scope"]', keyForm).filter(x => x.checked).map(x => x.value);
    try {
      const out = await api('/console/api/api-keys', { method: 'POST', body: JSON.stringify({ name: keyName.value, scopes: selected }) });
      created.className = 'secret-callout wide';
      created.replaceChildren(node('strong', 'Copie agora — esta chave não será exibida novamente.'), node('code', out.secret));
      flash('API key criada.');
      const refreshed = await api('/console/api/api-keys');
      state.apiKeys = refreshed.data || [];
    } catch (err) {
      flash(err.message, true);
    }
  };

  const keyTable = table(apiKeys, [
    { label: 'Nome', key: 'name' },
    { label: 'Prefixo', render: r => node('span', r.prefix, 'mono') },
    { label: 'Scopes', render: r => (r.scopes || []).join(', ') },
    { label: 'Último uso', render: r => date(r.last_used_at) },
    { label: 'Status', render: r => badge(r.revoked_at ? 'revoked' : 'active') },
  ], { empty: 'Nenhuma API key criada.' });

  const top = node('div', undefined, 'two-col');
  top.append(panel('Nova conexão', providerForm), panel('Nova API key', keyForm));
  setContent(top, panel('Providers', providerTable), panel('API keys', keyTable));
}

async function webhooks() {
  const d = await api('/console/api/webhook-endpoints');
  const rows = d.data || [];
  const f = document.createElement('form');
  f.className = 'form-grid form-cardless';
  const url = input('url', { type: 'url', placeholder: 'https://seu-sistema.com/webhooks/flashpag', required: true });
  const description = input('description', { placeholder: 'Produção, ERP, automação…' });
  f.append(field('URL HTTPS', url), field('Descrição', description));
  const events = node('div', undefined, 'scope-grid wide');
  ['transaction.*', 'transaction.succeeded', 'transaction.failed', 'transaction.pending'].forEach((eventName, idx) => {
    const l = node('label', undefined, 'check-row');
    const c = input('event', { type: 'checkbox', value: eventName });
    c.checked = idx === 0;
    l.append(c, node('span', eventName, 'mono'));
    events.append(l);
  });
  f.append(node('div', 'Eventos', 'field-label wide'), events);
  const secretBox = node('div', undefined, 'wide');
  const actions = node('div', undefined, 'form-actions wide');
  const submit = button('Adicionar endpoint', 'primary-action');
  submit.type = 'submit';
  actions.append(submit);
  f.append(secretBox, actions);
  f.onsubmit = async e => {
    e.preventDefault();
    const selected = $$('input[name="event"]', f).filter(x => x.checked).map(x => x.value);
    try {
      const out = await api('/console/api/webhook-endpoints', { method: 'POST', body: JSON.stringify({ url: url.value, description: description.value, events: selected }) });
      secretBox.className = 'secret-callout wide';
      secretBox.replaceChildren(node('strong', 'Secret de assinatura — copie agora.'), node('code', out.secret));
      flash('Webhook criado.');
    } catch (err) {
      flash(err.message, true);
    }
  };

  const explanation = node('div', undefined, 'steps');
  [['1', 'Evento', 'Uma transação muda de estado.'], ['2', 'Fila', 'A Flash Pag persiste a entrega e controla retries.'], ['3', 'Assinatura', 'Seu endpoint valida o HMAC antes de processar.']].forEach(([n, t, d]) => {
    const s = node('div', undefined, 'step');
    s.append(node('span', n, 'step-number'), (() => { const x = node('div'); x.append(node('strong', t), node('small', d)); return x; })());
    explanation.append(s);
  });
  const grid = node('div', undefined, 'two-col two-col-form');
  grid.append(panel('Novo webhook', f), panel('Entrega de eventos', explanation));
  setContent(grid, panel('Endpoints', table(rows, [
    { label: 'Endpoint', render: r => { const x = node('div', undefined, 'tx-cell'); x.append(node('strong', r.description || 'Webhook'), node('span', r.url)); return x; } },
    { label: 'Eventos', render: r => (r.events || []).join(', ') },
    { label: 'Status', render: r => badge(r.status) },
    { label: 'Criado', render: r => shortDate(r.created_at) },
  ], { empty: 'Nenhum endpoint cadastrado.' })));
}

async function accounts() {
  const [d, summary] = await Promise.all([api('/console/api/accounts'), api(orgQuery('/console/api/summary'))]);
  const rows = d.data || [];
  const cards = node('div', undefined, 'account-grid');
  rows.forEach(a => {
    const c = node('div', undefined, 'account-card');
    const top = node('div', undefined, 'account-card-head');
    const name = node('div');
    name.append(node('span', a.is_default ? 'Conta principal' : 'Conta'), node('strong', a.name));
    top.append(name, badge(a.status));
    c.append(top);
    const available = summary.account.id === a.id ? money(summary.balance.available_minor) : '—';
    c.append(node('div', available, 'account-balance'));
    c.append(node('div', `${a.currency} · ${a.is_default ? 'Padrão' : 'Secundária'}`, 'account-meta'));
    cards.append(c);
  });
  const info = node('div', undefined, 'callout');
  info.append(node('strong', 'Ledger interno'), node('span', 'Disponível e reservado são calculados a partir de lançamentos imutáveis. O saldo externo do provider não é copiado automaticamente para esta conta.'));
  setContent(cards, info);
}

async function organizations() {
  const rows = state.me.organizations || [];
  const merchants = new Map((state.me.merchants || []).map(m => [m.id, m]));
  const grid = node('div', undefined, 'org-grid');
  rows.forEach(o => {
    const c = node('div', undefined, `org-card ${o.id === state.orgId ? 'selected' : ''}`);
    const top = node('div', undefined, 'org-card-head');
    top.append(node('strong', o.name), badge(o.status));
    c.append(top, node('span', o.slug, 'mono'), node('small', merchants.get(o.merchant_id)?.name || shortId(o.merchant_id)));
    const actions = node('div', undefined, 'org-actions');
    const choose = button(o.id === state.orgId ? 'Selecionada' : 'Usar organização', 'secondary compact', () => {
      state.orgId = o.id;
      localStorage.setItem('flashpag_org', o.id);
      $('#org-select').value = o.id;
      organizations();
    });
    choose.disabled = o.id === state.orgId;
    actions.append(choose);
    c.append(actions);
    grid.append(c);
  });
  setContent(panel('Organizações disponíveis', grid));
}

async function admin() {
  if (!state.me.user.platform_admin) {
    setContent(panel('Acesso negado', emptyState('Seu usuário não possui permissão de platform admin.')));
    return;
  }
  const merchants = state.me.merchants || [];
  const orgs = state.me.organizations || [];
  const metrics = node('div', undefined, 'metrics-grid admin-metrics');
  metrics.append(statCard('Merchants', String(merchants.length)), statCard('Organizações', String(orgs.length)), statCard('Ativas', String(orgs.filter(o => o.status === 'active').length)), statCard('Admin', state.me.user.email, 'Sessão atual'));

  const merchantForm = document.createElement('form');
  merchantForm.className = 'form-grid form-cardless';
  merchantForm.append(field('Nome do merchant', input('name', { placeholder: 'Empresa ou operação', required: true })), field('Owner user UUID', input('owner_user_id', { placeholder: 'Opcional' })));
  const ma = node('div', undefined, 'form-actions wide');
  const mb = button('Criar merchant', 'primary-action'); mb.type = 'submit'; ma.append(mb); merchantForm.append(ma);
  merchantForm.onsubmit = async e => {
    e.preventDefault();
    try {
      await api('/console/api/admin/merchants', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(merchantForm))) });
      flash('Merchant criado.');
      await refreshMe(false);
      admin();
    } catch (err) { flash(err.message, true); }
  };

  const orgForm = document.createElement('form');
  orgForm.className = 'form-grid form-cardless';
  const merchantSel = select('merchant_id', merchants.map(m => ({ value: m.id, label: m.name })));
  orgForm.append(field('Merchant', merchantSel), field('Nome', input('name', { required: true, placeholder: 'Operação Brasil' })), field('Slug', input('slug', { required: true, placeholder: 'operacao-brasil' })));
  const oa = node('div', undefined, 'form-actions wide'); const ob = button('Criar organização + conta', 'primary-action'); ob.type = 'submit'; oa.append(ob); orgForm.append(oa);
  orgForm.onsubmit = async e => {
    e.preventDefault();
    try {
      await api('/console/api/admin/organizations', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(orgForm))) });
      flash('Organização criada.');
      await refreshMe(false);
      admin();
    } catch (err) { flash(err.message, true); }
  };

  const memberForm = document.createElement('form');
  memberForm.className = 'form-grid form-cardless';
  memberForm.append(
    field('Merchant', select('merchant_id', merchants.map(m => ({ value: m.id, label: m.name })))),
    field('User UUID', input('user_id', { required: true, placeholder: 'UUID do usuário Auth' })),
    field('Permissão', select('role', [
      { value: 'owner', label: 'Owner' }, { value: 'admin', label: 'Admin' }, { value: 'member', label: 'Member' }, { value: 'viewer', label: 'Viewer' }
    ], 'member'))
  );
  const ua = node('div', undefined, 'form-actions wide'); const ub = button('Adicionar membro', 'primary-action'); ub.type = 'submit'; ua.append(ub); memberForm.append(ua);
  memberForm.onsubmit = async e => {
    e.preventDefault();
    try {
      await api('/console/api/admin/members', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(memberForm))) });
      flash('Membro adicionado ou atualizado.');
    } catch (err) { flash(err.message, true); }
  };

  const forms = node('div', undefined, 'admin-form-grid');
  forms.append(panel('Novo merchant', merchantForm), panel('Nova organização', orgForm), panel('Adicionar membro', memberForm));

  const merchantTable = table(merchants, [
    { label: 'Merchant', key: 'name' },
    { label: 'ID', render: r => node('span', r.id, 'mono') },
    { label: 'Status', render: r => badge(r.status) },
    { label: 'Criado', render: r => shortDate(r.created_at) },
  ], { empty: 'Nenhum merchant cadastrado.' });
  const orgTable = table(orgs, [
    { label: 'Organização', key: 'name' },
    { label: 'Slug', render: r => node('span', r.slug, 'mono') },
    { label: 'Merchant', render: r => merchants.find(m => m.id === r.merchant_id)?.name || shortId(r.merchant_id) },
    { label: 'Status', render: r => badge(r.status) },
  ], { empty: 'Nenhuma organização cadastrada.' });

  setContent(metrics, forms, panel('Merchants', merchantTable), panel('Organizações', orgTable));
}

async function refreshMe(render = true) {
  state.me = await api('/console/api/me');
  if (render) showApp();
  else {
    const sel = $('#org-select');
    sel.replaceChildren();
    state.me.organizations.forEach(o => {
      const op = node('option', `${o.name} · ${o.slug}`);
      op.value = o.id;
      sel.append(op);
    });
    if (!state.me.organizations.some(o => o.id === state.orgId)) state.orgId = state.me.organizations[0]?.id || null;
    if (state.orgId) sel.value = state.orgId;
  }
}

boot();
