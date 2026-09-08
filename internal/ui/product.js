(() => {
  const now = () => new Date();
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const inLastDays = (value, days) => {
    if (!days) return true;
    const t = new Date(value).getTime();
    return Number.isFinite(t) && t >= Date.now() - days * 86400000;
  };
  const sum = (rows, predicate = () => true) => rows.filter(predicate).reduce((acc, r) => acc + Number(r.amount_minor || 0), 0);
  const statusCount = (rows, status) => rows.filter(r => r.status === status).length;
  const currentOrg = () => (state.me?.organizations || []).find(o => o.id === state.orgId);
  const currentMerchant = () => {
    const org = currentOrg();
    return (state.me?.merchants || []).find(m => m.id === org?.merchant_id);
  };

  function tag(text, tone = '') {
    return node('span', text, `tag ${tone}`.trim());
  }

  function sectionIntro(title, copy, actions) {
    const wrap = node('div', undefined, 'section-intro');
    const left = node('div');
    left.append(node('h2', title), node('p', copy));
    wrap.append(left);
    if (actions) wrap.append(actions);
    return wrap;
  }

  function statusBreakdown(rows) {
    const wrap = node('div', undefined, 'status-breakdown');
    [
      ['succeeded', 'Concluídas'],
      ['pending', 'Pendentes'],
      ['ambiguous', 'Ambíguas'],
      ['failed', 'Falhas'],
    ].forEach(([key, label]) => {
      const item = node('div', undefined, 'status-item');
      item.append(node('span', label), node('strong', String(statusCount(rows, key))), badge(key));
      wrap.append(item);
    });
    return wrap;
  }

  function sevenDaySeries(rows) {
    const days = [];
    const today = startOfDay(now());
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const next = new Date(d);
      next.setDate(d.getDate() + 1);
      const dayRows = rows.filter(r => {
        const t = new Date(r.created_at).getTime();
        return t >= d.getTime() && t < next.getTime() && r.status === 'succeeded';
      });
      days.push({
        date: d,
        inbound: sum(dayRows, r => r.direction === 'in'),
        outbound: sum(dayRows, r => r.direction === 'out'),
      });
    }
    return days;
  }

  function volumeChart(rows) {
    const series = sevenDaySeries(rows);
    const max = Math.max(1, ...series.flatMap(x => [x.inbound, x.outbound]));
    const wrap = node('div', undefined, 'volume-chart');
    const legend = node('div', undefined, 'chart-legend');
    legend.append(tag('Entradas', 'positive'), tag('Saídas', 'neutral'));
    wrap.append(legend);
    const bars = node('div', undefined, 'chart-bars');
    series.forEach(point => {
      const col = node('div', undefined, 'chart-col');
      const stack = node('div', undefined, 'chart-stack');
      const inBar = node('div', undefined, 'chart-bar in');
      const outBar = node('div', undefined, 'chart-bar out');
      inBar.style.height = `${Math.max(4, Math.round((point.inbound / max) * 100))}%`;
      outBar.style.height = `${Math.max(4, Math.round((point.outbound / max) * 100))}%`;
      inBar.title = `Entradas: ${money(point.inbound)}`;
      outBar.title = `Saídas: ${money(point.outbound)}`;
      stack.append(inBar, outBar);
      col.append(stack, node('span', point.date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')));
      bars.append(col);
    });
    wrap.append(bars);
    return wrap;
  }

  function providerCard(connection) {
    const card = node('div', undefined, 'integration-card');
    const head = node('div', undefined, 'integration-head');
    const name = node('div');
    name.append(node('strong', connection.label || connection.provider_code), node('span', connection.provider_code));
    head.append(name, badge(connection.status));
    card.append(head);
    const meta = node('div', undefined, 'integration-meta');
    meta.append(keyValue('ID', shortId(connection.id), true), keyValue('Criada', shortDate(connection.created_at)));
    card.append(meta);
    const actions = node('div', undefined, 'integration-actions');
    const test = button('Testar conexão', 'secondary compact', async () => {
      test.disabled = true;
      try {
        const h = await api(`/console/api/provider-connections/${connection.id}/test`, { method: 'POST' });
        flash(h.healthy ? `${connection.label}: saudável · ${money(h.available_minor)} no provider` : `${connection.label}: indisponível`, !h.healthy);
      } catch (err) {
        flash(err.message, true);
      } finally {
        test.disabled = false;
      }
    });
    actions.append(test);
    card.append(actions);
    return card;
  }

  async function enhancedDashboard() {
    const [summary, tx, conns, customersData] = await Promise.all([
      api(orgQuery('/console/api/summary')),
      api('/console/api/transactions'),
      api('/console/api/provider-connections'),
      api('/console/api/customers'),
    ]);
    const rows = tx.data || [];
    const customers = customersData.data || [];
    const connections = conns.data || [];
    state.transactions = rows;
    state.customers = customers;
    state.connections = connections;

    const succeeded = rows.filter(r => r.status === 'succeeded');
    const settled = rows.filter(r => ['succeeded', 'failed'].includes(r.status));
    const last7 = rows.filter(r => inLastDays(r.created_at, 7));
    const incoming7 = sum(last7, r => r.status === 'succeeded' && r.direction === 'in');
    const outgoing7 = sum(last7, r => r.status === 'succeeded' && r.direction === 'out');
    const successRate = settled.length ? Math.round((succeeded.length / settled.length) * 100) : 0;
    const pending = rows.filter(r => ['pending', 'ambiguous'].includes(r.status)).length;

    const metrics = node('div', undefined, 'metrics-grid');
    metrics.append(
      statCard('Saldo disponível', money(summary.balance.available_minor), `Conta ${summary.account.name}`),
      statCard('Recebido · 7 dias', money(incoming7), `${last7.filter(r => r.status === 'succeeded' && r.direction === 'in').length} entrada(s)`),
      statCard('Enviado · 7 dias', money(outgoing7), `${last7.filter(r => r.status === 'succeeded' && r.direction === 'out').length} saída(s)`),
      statCard('Taxa de sucesso', `${successRate}%`, pending ? `${pending} operação(ões) em aberto` : 'Sem pendências')
    );

    const quick = node('div', undefined, 'quick-actions product-quick');
    [
      ['Receber Pix', 'Criar cliente e cobrança pela API', 'customers'],
      ['Nova transferência', 'Enviar Pix ou solicitar saque', 'transfers'],
      ['Integrações', 'Providers e API keys', 'integrations'],
    ].forEach(([title, copy, view]) => {
      const b = button('', 'quick-action rich', () => navigate(view));
      b.append(node('strong', title), node('span', copy));
      quick.append(b);
    });

    const performance = node('div', undefined, 'two-col dashboard-grid');
    performance.append(
      panel('Volume dos últimos 7 dias', volumeChart(rows)),
      panel('Status das operações', statusBreakdown(rows))
    );

    const providerList = node('div', undefined, 'provider-list');
    if (!connections.length) providerList.append(emptyState('Nenhuma conexão configurada.'));
    connections.slice(0, 5).forEach(c => {
      const row = node('div', undefined, 'provider-row');
      const left = node('div');
      left.append(node('strong', c.label || c.provider_code), node('span', `${c.provider_code} · ${shortDate(c.created_at)}`));
      row.append(left, badge(c.status));
      providerList.append(row);
    });

    const org = currentOrg();
    const merchant = currentMerchant();
    const context = node('div', undefined, 'context-list');
    context.append(
      keyValue('Organização', org?.name || '—'),
      keyValue('Merchant', merchant?.name || shortId(org?.merchant_id || '')),
      keyValue('Clientes', String(customers.length)),
      keyValue('Providers ativos', String(connections.filter(c => c.status === 'active').length))
    );

    const lower = node('div', undefined, 'two-col dashboard-grid');
    lower.append(panel('Providers', providerList, button('Gerenciar', 'link-button', () => navigate('integrations'))), panel('Contexto da organização', context));

    const recent = table((summary.recent_transactions || []).slice(0, 8), [
      { label: 'Data', render: r => date(r.created_at) },
      { label: 'Tipo', render: r => labelKind(r.kind) },
      { label: 'Status', render: r => badge(r.status) },
      { label: 'Valor', render: r => money(r.amount_minor), className: 'amount' },
      { label: 'Provider', key: 'provider_code' },
    ], { onRowClick: r => drawer('Detalhes da transação', transactionDetail(r)), empty: 'As próximas movimentações aparecerão aqui.' });

    setContent(
      sectionIntro('Visão da operação', 'Saldo, performance e saúde da organização selecionada.'),
      metrics,
      panel('Ações rápidas', quick),
      performance,
      lower,
      panel('Últimas transações', recent, button('Ver todas', 'link-button', () => navigate('transactions')))
    );
  }

  async function enhancedTransactions() {
    const d = await api('/console/api/transactions');
    const rows = d.data || [];
    state.transactions = rows;
    let page = 1;
    const pageSize = 20;

    const overview = node('div', undefined, 'mini-summary-grid');
    overview.append(
      statCard('Total', String(rows.length), 'Transações carregadas'),
      statCard('Concluídas', String(statusCount(rows, 'succeeded')), money(sum(rows, r => r.status === 'succeeded'))),
      statCard('Pendentes', String(statusCount(rows, 'pending') + statusCount(rows, 'ambiguous')), 'Requerem acompanhamento'),
      statCard('Falhas', String(statusCount(rows, 'failed')), 'Operações recusadas')
    );

    const toolbar = node('div', undefined, 'toolbar transaction-toolbar');
    const search = input('search', { placeholder: 'Buscar ID, provider, customer ou chave Pix' });
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
    const period = select('period', [
      { value: '', label: 'Todo o período' },
      { value: '7', label: 'Últimos 7 dias' },
      { value: '30', label: 'Últimos 30 dias' },
    ]);
    const providerValues = [...new Set(rows.map(r => r.provider_code).filter(Boolean))];
    const provider = select('provider', [{ value: '', label: 'Todos os providers' }, ...providerValues.map(v => ({ value: v, label: v }))]);
    toolbar.append(search, status, kind, provider, period);

    const body = node('div');
    const footer = node('div', undefined, 'pagination');

    function filteredRows() {
      const q = search.value.trim().toLowerCase();
      const days = Number(period.value || 0);
      return rows.filter(r => {
        const hay = [r.id, r.provider_external_id, r.provider_code, r.pix_key, r.customer_id, r.description].filter(Boolean).join(' ').toLowerCase();
        return (!q || hay.includes(q)) && (!status.value || r.status === status.value) && (!kind.value || r.kind === kind.value) && (!provider.value || r.provider_code === provider.value) && inLastDays(r.created_at, days);
      });
    }

    function render() {
      const filtered = filteredRows();
      const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
      if (page > pages) page = pages;
      const start = (page - 1) * pageSize;
      const shown = filtered.slice(start, start + pageSize);
      body.replaceChildren(table(shown, [
        { label: 'Data', render: r => date(r.created_at) },
        { label: 'Transação', render: r => { const x = node('div', undefined, 'tx-cell'); x.append(node('strong', labelKind(r.kind)), node('span', shortId(r.id), 'mono')); return x; } },
        { label: 'Status', render: r => badge(r.status) },
        { label: 'Provider', key: 'provider_code' },
        { label: 'Valor', render: r => money(r.amount_minor), className: 'amount' },
      ], { onRowClick: r => drawer('Detalhes da transação', transactionDetail(r)), empty: 'Nenhuma transação corresponde aos filtros.' }));
      footer.replaceChildren();
      footer.append(node('span', `${filtered.length} resultado(s) · página ${page} de ${pages}`));
      const controls = node('div');
      const prev = button('Anterior', 'secondary compact', () => { if (page > 1) { page--; render(); } });
      const next = button('Próxima', 'secondary compact', () => { if (page < pages) { page++; render(); } });
      prev.disabled = page <= 1;
      next.disabled = page >= pages;
      controls.append(prev, next);
      footer.append(controls);
    }

    [search, status, kind, provider, period].forEach(x => x.addEventListener(x.tagName === 'INPUT' ? 'input' : 'change', () => { page = 1; render(); }));
    render();

    const stack = node('div', undefined, 'stack');
    stack.append(toolbar, body, footer);
    setContent(sectionIntro('Histórico de transações', 'Filtre, investigue e reconcilie operações sem perder o contexto financeiro.'), overview, panel('Transações', stack));
  }

  async function enhancedCustomers() {
    const [d, tx] = await Promise.all([api('/console/api/customers'), api('/console/api/transactions')]);
    const rows = d.data || [];
    const txs = tx.data || [];
    state.customers = rows;
    const customerStats = rows.map(c => {
      const related = txs.filter(t => t.customer_id === c.id);
      return {
        ...c,
        tx_count: related.length,
        volume: sum(related, t => t.status === 'succeeded'),
        last_tx: related.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]?.created_at,
      };
    });

    const metrics = node('div', undefined, 'mini-summary-grid');
    metrics.append(
      statCard('Clientes', String(rows.length), 'Cadastrados na organização'),
      statCard('Com atividade', String(customerStats.filter(c => c.tx_count > 0).length), 'Ao menos uma transação'),
      statCard('Volume concluído', money(customerStats.reduce((s, c) => s + c.volume, 0)), 'Histórico carregado'),
      statCard('Novos · 30 dias', String(rows.filter(c => inLastDays(c.created_at, 30)).length), 'Cadastros recentes')
    );

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
      try {
        await api('/console/api/customers', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(f))) });
        flash('Cliente criado.');
        enhancedCustomers();
      } catch (err) { flash(err.message, true); }
    };

    const search = input('search', { placeholder: 'Buscar nome, e-mail, documento ou ID' });
    const body = node('div');
    function render() {
      const q = search.value.trim().toLowerCase();
      const filtered = customerStats.filter(r => !q || [r.name, r.email, r.document, r.external_id, r.id].filter(Boolean).join(' ').toLowerCase().includes(q));
      body.replaceChildren(table(filtered, [
        { label: 'Cliente', render: r => { const x = node('div', undefined, 'person-cell'); const a = node('div', (r.name || r.email || 'C').slice(0, 1).toUpperCase(), 'avatar'); const t = node('div'); t.append(node('strong', r.name || 'Sem nome'), node('span', r.email || 'Sem e-mail')); x.append(a, t); return x; } },
        { label: 'Documento', key: 'document' },
        { label: 'Transações', render: r => String(r.tx_count) },
        { label: 'Volume', render: r => money(r.volume), className: 'amount' },
        { label: 'Última atividade', render: r => r.last_tx ? shortDate(r.last_tx) : '—' },
      ], { onRowClick: r => drawer('Cliente', customerDetail(r, txs)), empty: 'Nenhum cliente corresponde à busca.' }));
    }
    search.addEventListener('input', render);
    render();

    const searchWrap = node('div', undefined, 'stack');
    const tb = node('div', undefined, 'toolbar');
    tb.append(search);
    searchWrap.append(tb, body);
    const layout = node('div', undefined, 'two-col customer-layout');
    layout.append(panel('Novo cliente', f), panel('Sobre clientes', (() => {
      const c = node('div', undefined, 'callout-list');
      c.append(
        keyValue('Uso principal', 'Pagadores do PIX IN'),
        keyValue('Documento', 'CPF ou CNPJ'),
        keyValue('ID externo', 'Opcional, definido pelo merchant')
      );
      return c;
    })()));
    setContent(sectionIntro('Base de clientes', 'Cadastre pagadores e acompanhe a relação deles com as transações.'), metrics, layout, panel('Clientes', searchWrap));
  }

  async function enhancedIntegrations() {
    const [conns, keys] = await Promise.all([api('/console/api/provider-connections'), api('/console/api/api-keys')]);
    const connections = conns.data || [];
    const apiKeys = keys.data || [];
    state.connections = connections;
    state.apiKeys = apiKeys;

    const metrics = node('div', undefined, 'mini-summary-grid');
    metrics.append(
      statCard('Providers', String(connections.length), `${connections.filter(c => c.status === 'active').length} ativa(s)`),
      statCard('API keys', String(apiKeys.length), `${apiKeys.filter(k => !k.revoked_at).length} válida(s)`),
      statCard('Pixhub', connections.some(c => c.provider_code === 'pixhub' && c.status === 'active') ? 'Conectada' : 'Não conectada', 'Provider de produção'),
      statCard('Segurança', 'AES-256-GCM', 'Credenciais criptografadas')
    );

    const providerGrid = node('div', undefined, 'integration-grid');
    if (!connections.length) providerGrid.append(emptyState('Nenhum provider conectado.'));
    connections.forEach(c => providerGrid.append(providerCard(c)));

    const providerForm = document.createElement('form');
    providerForm.className = 'form-grid form-cardless';
    const providerSel = select('provider', state.me.installed_providers.map(p => ({ value: p, label: p === 'pixhub' ? 'Pixhub' : p })));
    const labelInput = input('label', { value: 'Principal', required: true });
    const clientId = input('client_id', { placeholder: 'Client ID' });
    const clientSecret = input('client_secret', { type: 'password', placeholder: 'Client Secret' });
    const idField = field('Client ID', clientId);
    const secretField = field('Client Secret', clientSecret);
    const sync = () => {
      const pixhub = providerSel.value === 'pixhub';
      idField.classList.toggle('hidden', !pixhub);
      secretField.classList.toggle('hidden', !pixhub);
      clientId.required = pixhub;
      clientSecret.required = pixhub;
    };
    providerSel.onchange = sync;
    providerForm.append(field('Provider', providerSel), field('Nome da conexão', labelInput), idField, secretField);
    const providerHint = node('div', 'As credenciais são criptografadas antes de serem persistidas e nunca são retornadas pela API.', 'form-hint wide');
    const pa = node('div', undefined, 'form-actions wide');
    const pb = button('Conectar provider', 'primary-action'); pb.type = 'submit'; pa.append(pb); providerForm.append(providerHint, pa); sync();
    providerForm.onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(providerForm);
      const code = String(fd.get('provider'));
      const credentials = code === 'pixhub' ? { client_id: String(fd.get('client_id') || ''), client_secret: String(fd.get('client_secret') || '') } : {};
      try {
        await api('/console/api/provider-connections', { method: 'POST', body: JSON.stringify({ provider: code, label: String(fd.get('label') || 'Principal'), credentials, config: {} }) });
        flash('Provider conectado.');
        enhancedIntegrations();
      } catch (err) { flash(err.message, true); }
    };

    const keyForm = document.createElement('form');
    keyForm.className = 'form-grid form-cardless';
    const keyName = input('name', { value: 'Integração principal', required: true });
    keyForm.append(field('Nome da API key', keyName));
    const scopesBox = node('div', undefined, 'scope-grid wide');
    const scopes = ['pix:read', 'pix:write', 'balance:read', 'customers:read', 'customers:write', 'webhooks:write'];
    scopes.forEach(scope => {
      const l = node('label', undefined, 'check-row');
      const c = input('scope', { type: 'checkbox', value: scope }); c.checked = true;
      l.append(c, node('span', scope, 'mono')); scopesBox.append(l);
    });
    keyForm.append(node('div', 'Scopes', 'field-label wide'), scopesBox);
    const created = node('div', undefined, 'wide');
    const ka = node('div', undefined, 'form-actions wide');
    const kb = button('Criar API key', 'primary-action'); kb.type = 'submit'; ka.append(kb); keyForm.append(created, ka);
    keyForm.onsubmit = async e => {
      e.preventDefault();
      const selected = $$('input[name="scope"]', keyForm).filter(x => x.checked).map(x => x.value);
      try {
        const out = await api('/console/api/api-keys', { method: 'POST', body: JSON.stringify({ name: keyName.value, scopes: selected }) });
        created.className = 'secret-callout wide';
        created.replaceChildren(node('strong', 'Copie agora — esta chave não será exibida novamente.'), node('code', out.secret));
        flash('API key criada.');
      } catch (err) { flash(err.message, true); }
    };

    const keyTable = table(apiKeys, [
      { label: 'Nome', key: 'name' },
      { label: 'Prefixo', render: r => node('span', r.prefix, 'mono') },
      { label: 'Scopes', render: r => { const w = node('div', undefined, 'tag-list'); (r.scopes || []).slice(0, 4).forEach(s => w.append(tag(s))); if ((r.scopes || []).length > 4) w.append(tag(`+${r.scopes.length - 4}`)); return w; } },
      { label: 'Último uso', render: r => date(r.last_used_at) },
      { label: 'Status', render: r => badge(r.revoked_at ? 'revoked' : 'active') },
    ], { empty: 'Nenhuma API key criada.' });

    const forms = node('div', undefined, 'two-col');
    forms.append(panel('Conectar provider', providerForm), panel('Criar API key', keyForm));
    setContent(sectionIntro('Integrações e acesso à API', 'Conecte providers, valide saúde e entregue credenciais com escopo mínimo.'), metrics, panel('Providers conectados', providerGrid), forms, panel('API keys', keyTable));
  }

  async function enhancedWebhooks() {
    const d = await api('/console/api/webhook-endpoints');
    const rows = d.data || [];
    const allEvents = [...new Set(rows.flatMap(r => r.events || []))];
    const metrics = node('div', undefined, 'mini-summary-grid');
    metrics.append(
      statCard('Endpoints', String(rows.length), `${rows.filter(r => r.status === 'active').length} ativo(s)`),
      statCard('Eventos', String(allEvents.length), 'Assinaturas configuradas'),
      statCard('Entrega', 'HMAC', 'Assinatura de payload'),
      statCard('Retry', 'Automático', 'Fila persistente')
    );

    const f = document.createElement('form');
    f.className = 'form-grid form-cardless';
    const url = input('url', { type: 'url', placeholder: 'https://seu-sistema.com/webhooks/flashpag', required: true });
    const description = input('description', { placeholder: 'Produção, ERP, automação…' });
    f.append(field('URL HTTPS', url), field('Descrição', description));
    const events = node('div', undefined, 'scope-grid wide');
    ['transaction.*', 'transaction.succeeded', 'transaction.failed', 'transaction.pending'].forEach((eventName, idx) => {
      const l = node('label', undefined, 'check-row'); const c = input('event', { type: 'checkbox', value: eventName }); c.checked = idx === 0; l.append(c, node('span', eventName, 'mono')); events.append(l);
    });
    f.append(node('div', 'Eventos', 'field-label wide'), events);
    const secretBox = node('div', undefined, 'wide');
    const actions = node('div', undefined, 'form-actions wide'); const submit = button('Adicionar endpoint', 'primary-action'); submit.type = 'submit'; actions.append(submit); f.append(secretBox, actions);
    f.onsubmit = async e => {
      e.preventDefault();
      const selected = $$('input[name="event"]', f).filter(x => x.checked).map(x => x.value);
      try {
        const out = await api('/console/api/webhook-endpoints', { method: 'POST', body: JSON.stringify({ url: url.value, description: description.value, events: selected }) });
        secretBox.className = 'secret-callout wide';
        secretBox.replaceChildren(node('strong', 'Secret de assinatura — copie agora.'), node('code', out.secret));
        flash('Webhook criado.');
        enhancedWebhooks();
      } catch (err) { flash(err.message, true); }
    };

    const endpointGrid = node('div', undefined, 'endpoint-grid');
    if (!rows.length) endpointGrid.append(emptyState('Nenhum endpoint cadastrado.'));
    rows.forEach(r => {
      const card = node('div', undefined, 'endpoint-card');
      const head = node('div', undefined, 'endpoint-head');
      const copy = node('div'); copy.append(node('strong', r.description || 'Webhook'), node('span', r.url));
      head.append(copy, badge(r.status));
      const eventList = node('div', undefined, 'tag-list'); (r.events || []).forEach(e => eventList.append(tag(e)));
      card.append(head, eventList, node('small', `Criado em ${shortDate(r.created_at)}`));
      endpointGrid.append(card);
    });

    const explainer = node('div', undefined, 'steps');
    [['1', 'Evento', 'A transação muda de estado.'], ['2', 'Fila', 'A entrega é persistida e recebe retries.'], ['3', 'Assinatura', 'Seu sistema valida o HMAC antes de processar.']].forEach(([n, t, dsc]) => {
      const s = node('div', undefined, 'step'); const x = node('div'); x.append(node('strong', t), node('small', dsc)); s.append(node('span', n, 'step-number'), x); explainer.append(s);
    });
    const top = node('div', undefined, 'two-col'); top.append(panel('Novo webhook', f), panel('Como a entrega funciona', explainer));
    setContent(sectionIntro('Webhooks', 'Envie eventos assinados para ERPs, automações e serviços externos.'), metrics, top, panel('Endpoints', endpointGrid));
  }

  async function enhancedAccounts() {
    const [d, summary, conns] = await Promise.all([api('/console/api/accounts'), api(orgQuery('/console/api/summary')), api('/console/api/provider-connections')]);
    const rows = d.data || [];
    const metrics = node('div', undefined, 'metrics-grid');
    metrics.append(
      statCard('Disponível', money(summary.balance.available_minor), summary.account.name),
      statCard('Reservado', money(summary.balance.reserved_minor), 'Operações em andamento'),
      statCard('Total interno', money(summary.balance.total_minor), 'Ledger da Flash Pag'),
      statCard('Moeda', summary.account.currency || 'BRL', 'Conta principal')
    );

    const cards = node('div', undefined, 'account-grid');
    rows.forEach(a => {
      const c = node('div', undefined, 'account-card');
      const top = node('div', undefined, 'account-card-head');
      const name = node('div'); name.append(node('span', a.is_default ? 'Conta principal' : 'Conta'), node('strong', a.name)); top.append(name, badge(a.status)); c.append(top);
      const available = summary.account.id === a.id ? money(summary.balance.available_minor) : '—';
      c.append(node('div', available, 'account-balance'), node('div', `${a.currency} · ${a.is_default ? 'Padrão' : 'Secundária'}`, 'account-meta'));
      cards.append(c);
    });

    const providerBalance = node('div', undefined, 'provider-balance-list');
    const active = (conns.data || []).filter(c => c.status === 'active');
    if (!active.length) providerBalance.append(emptyState('Nenhum provider ativo.'));
    active.forEach(c => {
      const row = node('div', undefined, 'provider-balance-row');
      const copy = node('div'); copy.append(node('strong', c.label), node('span', c.provider_code));
      const value = node('span', 'Consultar', 'provider-balance-value');
      const b = button('Atualizar saldo', 'secondary compact', async () => {
        b.disabled = true;
        try {
          const h = await api(`/console/api/provider-connections/${c.id}/test`, { method: 'POST' });
          value.textContent = h.healthy ? money(h.available_minor) : 'Indisponível';
        } catch (err) { value.textContent = 'Erro'; flash(err.message, true); }
        finally { b.disabled = false; }
      });
      row.append(copy, value, b); providerBalance.append(row);
    });

    const info = node('div', undefined, 'callout');
    info.append(node('strong', 'Saldo interno ≠ saldo do provider'), node('span', 'O ledger da Flash Pag é a fonte contábil do merchant. O saldo externo serve como informação operacional e não é copiado automaticamente.'));
    const lower = node('div', undefined, 'two-col'); lower.append(panel('Contas', cards), panel('Saldos externos', providerBalance));
    setContent(sectionIntro('Contas e saldos', 'Acompanhe o ledger interno e consulte providers sem misturar as duas fontes.'), metrics, lower, info);
  }

  async function enhancedOrganizations() {
    const rows = state.me.organizations || [];
    const merchants = new Map((state.me.merchants || []).map(m => [m.id, m]));
    const metrics = node('div', undefined, 'mini-summary-grid');
    metrics.append(
      statCard('Organizações', String(rows.length), 'Disponíveis para seu usuário'),
      statCard('Ativas', String(rows.filter(o => o.status === 'active').length), 'Operacionais'),
      statCard('Merchants', String(new Set(rows.map(o => o.merchant_id)).size), 'Estruturas relacionadas'),
      statCard('Selecionada', currentOrg()?.name || '—', currentOrg()?.slug || '')
    );
    const grid = node('div', undefined, 'org-grid');
    rows.forEach(o => {
      const c = node('div', undefined, `org-card ${o.id === state.orgId ? 'selected' : ''}`);
      const top = node('div', undefined, 'org-card-head'); top.append(node('strong', o.name), badge(o.status));
      c.append(top, node('span', o.slug, 'mono'), node('small', merchants.get(o.merchant_id)?.name || shortId(o.merchant_id)));
      const details = node('div', undefined, 'org-detail-list'); details.append(keyValue('ID', shortId(o.id), true), keyValue('Criada', shortDate(o.created_at))); c.append(details);
      const actions = node('div', undefined, 'org-actions'); const choose = button(o.id === state.orgId ? 'Selecionada' : 'Usar organização', 'secondary compact', () => {
        state.orgId = o.id; localStorage.setItem('flashpag_org', o.id); $('#org-select').value = o.id; enhancedOrganizations();
      }); choose.disabled = o.id === state.orgId; actions.append(choose); c.append(actions); grid.append(c);
    });
    setContent(sectionIntro('Organizações', 'Troque o contexto da operação sem misturar dados entre tenants.'), metrics, panel('Organizações disponíveis', grid));
  }

  async function enhancedAdmin() {
    if (!state.me.user.platform_admin) {
      setContent(panel('Acesso negado', emptyState('Seu usuário não possui permissão de platform admin.')));
      return;
    }
    const merchants = state.me.merchants || [];
    const orgs = state.me.organizations || [];
    const metrics = node('div', undefined, 'metrics-grid admin-metrics');
    metrics.append(
      statCard('Merchants', String(merchants.length), 'Tenants comerciais'),
      statCard('Organizações', String(orgs.length), 'Ambientes operacionais'),
      statCard('Organizações ativas', String(orgs.filter(o => o.status === 'active').length), 'Status active'),
      statCard('Administrador', state.me.user.email, 'Sessão atual')
    );

    const merchantForm = document.createElement('form'); merchantForm.className = 'form-grid form-cardless';
    merchantForm.append(field('Nome do merchant', input('name', { placeholder: 'Empresa ou operação', required: true })), field('Owner user UUID', input('owner_user_id', { placeholder: 'Opcional' })));
    const ma = node('div', undefined, 'form-actions wide'); const mb = button('Criar merchant', 'primary-action'); mb.type = 'submit'; ma.append(mb); merchantForm.append(ma);
    merchantForm.onsubmit = async e => { e.preventDefault(); try { await api('/console/api/admin/merchants', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(merchantForm))) }); flash('Merchant criado.'); await refreshMe(false); enhancedAdmin(); } catch (err) { flash(err.message, true); } };

    const orgForm = document.createElement('form'); orgForm.className = 'form-grid form-cardless';
    orgForm.append(field('Merchant', select('merchant_id', merchants.map(m => ({ value: m.id, label: m.name })))), field('Nome', input('name', { required: true, placeholder: 'Operação Brasil' })), field('Slug', input('slug', { required: true, placeholder: 'operacao-brasil' })));
    const oa = node('div', undefined, 'form-actions wide'); const ob = button('Criar organização + conta', 'primary-action'); ob.type = 'submit'; oa.append(ob); orgForm.append(oa);
    orgForm.onsubmit = async e => { e.preventDefault(); try { await api('/console/api/admin/organizations', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(orgForm))) }); flash('Organização criada.'); await refreshMe(false); enhancedAdmin(); } catch (err) { flash(err.message, true); } };

    const memberForm = document.createElement('form'); memberForm.className = 'form-grid form-cardless';
    memberForm.append(field('Merchant', select('merchant_id', merchants.map(m => ({ value: m.id, label: m.name })))), field('User UUID', input('user_id', { required: true, placeholder: 'UUID do usuário Auth' })), field('Permissão', select('role', [{ value: 'owner', label: 'Owner' }, { value: 'admin', label: 'Admin' }, { value: 'member', label: 'Member' }, { value: 'viewer', label: 'Viewer' }], 'member')));
    const ua = node('div', undefined, 'form-actions wide'); const ub = button('Adicionar membro', 'primary-action'); ub.type = 'submit'; ua.append(ub); memberForm.append(ua);
    memberForm.onsubmit = async e => { e.preventDefault(); try { await api('/console/api/admin/members', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(memberForm))) }); flash('Membro adicionado ou atualizado.'); } catch (err) { flash(err.message, true); } };

    const provision = node('div', undefined, 'admin-form-grid'); provision.append(panel('Novo merchant', merchantForm), panel('Nova organização', orgForm), panel('Membro e RBAC', memberForm));
    const merchantTable = table(merchants, [
      { label: 'Merchant', key: 'name' },
      { label: 'ID', render: r => node('span', r.id, 'mono') },
      { label: 'Status', render: r => badge(r.status) },
      { label: 'Criado', render: r => shortDate(r.created_at) },
      { label: 'Organizações', render: r => String(orgs.filter(o => o.merchant_id === r.id).length) },
    ], { empty: 'Nenhum merchant cadastrado.' });
    const orgTable = table(orgs, [
      { label: 'Organização', key: 'name' },
      { label: 'Slug', render: r => node('span', r.slug, 'mono') },
      { label: 'Merchant', render: r => merchants.find(m => m.id === r.merchant_id)?.name || shortId(r.merchant_id) },
      { label: 'Status', render: r => badge(r.status) },
      { label: 'Criado', render: r => shortDate(r.created_at) },
    ], { empty: 'Nenhuma organização cadastrada.' });

    const model = node('div', undefined, 'platform-model');
    [['Merchant', 'Entidade comercial que possui usuários e organizações.'], ['Organização', 'Unidade operacional com contas, clientes, providers e API keys.'], ['Conta', 'Ledger financeiro isolado dentro da organização.']].forEach(([t, c]) => {
      const item = node('div', undefined, 'platform-model-item'); item.append(node('strong', t), node('span', c)); model.append(item);
    });

    setContent(sectionIntro('Administração da plataforma', 'Provisionamento multi-merchant e governança do beta.'), metrics, panel('Modelo de tenancy', model), provision, panel('Merchants', merchantTable), panel('Organizações', orgTable));
  }

  dashboard = enhancedDashboard;
  transactions = enhancedTransactions;
  customers = enhancedCustomers;
  integrations = enhancedIntegrations;
  webhooks = enhancedWebhooks;
  accounts = enhancedAccounts;
  organizations = enhancedOrganizations;
  admin = enhancedAdmin;
})();
