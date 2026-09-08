(() => {
  const currentOrg = () => (state.me?.organizations || []).find(o => o.id === state.orgId);
  const sum = (rows, predicate = () => true) => rows.filter(predicate).reduce((acc, row) => acc + Number(row.amount_minor || 0), 0);

  function viewClass(name) {
    const content = $('#content');
    if (!content) return;
    ['design-customers', 'design-integrations', 'design-developer', 'design-webhooks'].forEach(cls => content.classList.remove(cls));
    if (name) content.classList.add(name);
  }

  function actionIntro(title, copy, label, onClick) {
    const actions = node('div', undefined, 'workspace-intro-actions');
    if (label && onClick) actions.append(button(label, 'primary-action', onClick));
    return sectionIntro(title, copy, actions);
  }

  function identityCell(customer) {
    const wrap = node('div', undefined, 'workspace-person');
    const avatar = node('div', (customer.name || customer.email || 'C').slice(0, 1).toUpperCase(), 'workspace-avatar');
    const copy = node('div');
    copy.append(node('strong', customer.name || 'Cliente sem nome'), node('span', customer.email || customer.external_id || shortId(customer.id)));
    wrap.append(avatar, copy);
    return wrap;
  }

  function customerCreateDrawer(refresh) {
    const form = document.createElement('form');
    form.className = 'workspace-drawer-form';
    form.append(
      field('Nome', input('name', { placeholder: 'Nome do pagador' })),
      field('E-mail', input('email', { type: 'email', placeholder: 'cliente@empresa.com' })),
      field('Documento', input('document', { placeholder: 'CPF ou CNPJ' })),
      field('ID externo', input('external_id', { placeholder: 'Identificador no seu sistema' }))
    );

    const note = node('div', undefined, 'workspace-note');
    note.append(node('strong', 'Dados do pagador'), node('span', 'Para cobranças Pix, use CPF/CNPJ válido. O ID externo é opcional e pertence ao merchant.'));
    form.append(note);

    const actions = node('div', undefined, 'workspace-drawer-actions');
    const cancel = button('Cancelar', 'secondary', closeDrawer);
    const submit = button('Criar cliente', 'primary-action');
    submit.type = 'submit';
    actions.append(cancel, submit);
    form.append(actions);

    form.onsubmit = async event => {
      event.preventDefault();
      submit.disabled = true;
      try {
        const data = Object.fromEntries(new FormData(form));
        await api('/console/api/customers', { method: 'POST', body: JSON.stringify(data) });
        flash('Cliente criado.');
        closeDrawer();
        await refresh();
      } catch (err) {
        flash(err.message, true);
      } finally {
        submit.disabled = false;
      }
    };

    drawer('Novo cliente', form);
  }

  async function workspaceCustomers() {
    const [customersData, txData] = await Promise.all([
      api('/console/api/customers'),
      api('/console/api/transactions'),
    ]);
    const customers = customersData.data || [];
    const transactions = txData.data || [];
    state.customers = customers;
    state.transactions = transactions;

    const rows = customers.map(customer => {
      const related = transactions.filter(tx => tx.customer_id === customer.id);
      const succeeded = related.filter(tx => tx.status === 'succeeded');
      return {
        ...customer,
        tx_count: related.length,
        succeeded_count: succeeded.length,
        volume_minor: sum(succeeded),
        last_activity: [...related].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]?.created_at || null,
      };
    });
    const active = rows.filter(row => row.tx_count > 0);
    const totalVolume = rows.reduce((acc, row) => acc + row.volume_minor, 0);
    const average = active.length ? Math.round(totalVolume / active.length) : 0;

    const metrics = node('div', undefined, 'metrics-grid workspace-metrics');
    metrics.append(
      statCard('Clientes', String(rows.length), 'Cadastrados nesta organização'),
      statCard('Com atividade', String(active.length), 'Ao menos uma transação'),
      statCard('Volume concluído', money(totalVolume), 'Somente operações succeeded'),
      statCard('Volume médio', money(average), 'Por cliente com atividade')
    );

    const search = input('search', { placeholder: 'Buscar nome, documento, e-mail ou ID' });
    const activity = select('activity', [
      { value: '', label: 'Todos os clientes' },
      { value: 'active', label: 'Com atividade' },
      { value: 'inactive', label: 'Sem atividade' },
    ]);
    const toolbar = node('div', undefined, 'toolbar workspace-toolbar');
    toolbar.append(search, activity);
    const body = node('div');

    const render = () => {
      const q = search.value.trim().toLowerCase();
      const filtered = rows.filter(row => {
        const hay = [row.name, row.email, row.document, row.external_id, row.id].filter(Boolean).join(' ').toLowerCase();
        const activityOk = !activity.value || (activity.value === 'active' ? row.tx_count > 0 : row.tx_count === 0);
        return (!q || hay.includes(q)) && activityOk;
      });
      body.replaceChildren(table(filtered, [
        { label: 'Cliente', render: identityCell },
        { label: 'Documento', render: r => r.document || '—' },
        { label: 'Transações', render: r => String(r.tx_count) },
        { label: 'Concluídas', render: r => String(r.succeeded_count) },
        { label: 'Volume', render: r => money(r.volume_minor), className: 'amount' },
        { label: 'Última atividade', render: r => r.last_activity ? date(r.last_activity) : '—' },
      ], {
        onRowClick: row => drawer('Cliente', customerDetail(row, transactions)),
        empty: 'Nenhum cliente corresponde aos filtros atuais.',
      }));
    };
    search.addEventListener('input', render);
    activity.addEventListener('change', render);
    render();

    const tableStack = node('div', undefined, 'stack');
    tableStack.append(toolbar, body);

    const context = node('div', undefined, 'workspace-context-grid');
    const org = currentOrg();
    [
      ['Tenant', org?.name || '—'],
      ['Uso', 'Pagadores do PIX IN'],
      ['Documento', 'CPF ou CNPJ'],
      ['IDs externos', 'Definidos pelo merchant'],
    ].forEach(([label, value]) => {
      const item = node('div', undefined, 'workspace-context-item');
      item.append(node('span', label), node('strong', value));
      context.append(item);
    });

    setContent(
      actionIntro('Clientes', 'Pagadores, atividade e volume financeiro em uma única base.', 'Novo cliente', () => customerCreateDrawer(workspaceCustomers)),
      metrics,
      panel('Contexto da base', context),
      panel('Todos os clientes', tableStack)
    );
    viewClass('design-customers');
  }

  function providerConnectDrawer(refresh) {
    const form = document.createElement('form');
    form.className = 'workspace-drawer-form';
    const provider = select('provider', (state.me?.installed_providers || []).map(code => ({ value: code, label: code === 'pixhub' ? 'Pixhub' : code })));
    const label = input('label', { value: 'Principal', required: true });
    const clientId = input('client_id', { placeholder: 'Client ID' });
    const clientSecret = input('client_secret', { type: 'password', placeholder: 'Client Secret' });
    const idField = field('Client ID', clientId);
    const secretField = field('Client Secret', clientSecret);
    form.append(field('Provider', provider), field('Nome da conexão', label), idField, secretField);

    const sync = () => {
      const isPixhub = provider.value === 'pixhub';
      idField.classList.toggle('hidden', !isPixhub);
      secretField.classList.toggle('hidden', !isPixhub);
      clientId.required = isPixhub;
      clientSecret.required = isPixhub;
    };
    provider.addEventListener('change', sync);
    sync();

    const note = node('div', undefined, 'workspace-note');
    note.append(node('strong', 'Credenciais protegidas'), node('span', 'Secrets são enviados ao backend, criptografados e não devem ser exibidos novamente depois da criação.'));
    form.append(note);

    const actions = node('div', undefined, 'workspace-drawer-actions');
    const cancel = button('Cancelar', 'secondary', closeDrawer);
    const submit = button('Conectar provider', 'primary-action');
    submit.type = 'submit';
    actions.append(cancel, submit);
    form.append(actions);

    form.onsubmit = async event => {
      event.preventDefault();
      submit.disabled = true;
      const fd = new FormData(form);
      const code = String(fd.get('provider') || '');
      const credentials = code === 'pixhub' ? {
        client_id: String(fd.get('client_id') || ''),
        client_secret: String(fd.get('client_secret') || ''),
      } : {};
      try {
        await api('/console/api/provider-connections', {
          method: 'POST',
          body: JSON.stringify({ provider: code, label: String(fd.get('label') || 'Principal'), credentials, config: {} }),
        });
        flash('Provider conectado.');
        closeDrawer();
        await refresh();
      } catch (err) {
        flash(err.message, true);
      } finally {
        submit.disabled = false;
      }
    };

    drawer('Conectar provider', form);
  }

  function apiKeyDrawer(refresh) {
    const form = document.createElement('form');
    form.className = 'workspace-drawer-form';
    const name = input('name', { value: 'Integração principal', required: true });
    form.append(field('Nome da API key', name));

    const scopeGrid = node('div', undefined, 'workspace-scope-grid');
    const scopes = [
      ['pix:read', 'Consultar Pix e transações'],
      ['pix:write', 'Criar cobranças e saídas'],
      ['balance:read', 'Consultar saldo'],
      ['customers:read', 'Listar clientes'],
      ['customers:write', 'Criar clientes'],
      ['webhooks:write', 'Gerenciar webhooks'],
    ];
    scopes.forEach(([scope, copy]) => {
      const item = node('label', undefined, 'workspace-scope-option');
      const check = input('scope', { type: 'checkbox', value: scope });
      check.checked = true;
      const text = node('div');
      text.append(node('code', scope), node('span', copy));
      item.append(check, text);
      scopeGrid.append(item);
    });
    form.append(scopeGrid);

    const created = node('div', undefined, 'workspace-secret-result hidden');
    form.append(created);

    const actions = node('div', undefined, 'workspace-drawer-actions');
    const cancel = button('Cancelar', 'secondary', closeDrawer);
    const submit = button('Criar API key', 'primary-action');
    submit.type = 'submit';
    actions.append(cancel, submit);
    form.append(actions);

    form.onsubmit = async event => {
      event.preventDefault();
      submit.disabled = true;
      const selected = $$('input[name="scope"]', form).filter(control => control.checked).map(control => control.value);
      try {
        const result = await api('/console/api/api-keys', {
          method: 'POST',
          body: JSON.stringify({ name: name.value, scopes: selected }),
        });
        created.classList.remove('hidden');
        created.replaceChildren(node('strong', 'Copie agora. Esta chave não será exibida novamente.'), node('code', result.secret));
        cancel.textContent = 'Fechar';
        submit.disabled = true;
        flash('API key criada.');
        await refresh(false);
      } catch (err) {
        flash(err.message, true);
        submit.disabled = false;
      }
    };

    drawer('Nova API key', form);
  }

  function integrationProviderCard(connection) {
    const card = node('article', undefined, 'workspace-provider-card');
    const head = node('div', undefined, 'workspace-provider-head');
    const icon = node('div', (connection.provider_code || 'P').slice(0, 1).toUpperCase(), 'workspace-provider-icon');
    const copy = node('div');
    copy.append(node('strong', connection.label || connection.provider_code), node('span', connection.provider_code || 'provider'));
    head.append(icon, copy, badge(connection.status));

    const details = node('div', undefined, 'workspace-provider-details');
    details.append(
      keyValue('Connection ID', connection.id, true),
      keyValue('Criada', shortDate(connection.created_at)),
      keyValue('Status', labelStatus(connection.status))
    );

    const health = node('div', undefined, 'workspace-provider-health');
    const healthCopy = node('div');
    healthCopy.append(node('span', 'Health check'), node('strong', 'Não consultado'));
    const test = button('Testar conexão', 'secondary compact', async () => {
      test.disabled = true;
      health.classList.add('checking');
      healthCopy.querySelector('strong').textContent = 'Consultando…';
      try {
        const result = await api(`/console/api/provider-connections/${connection.id}/test`, { method: 'POST' });
        healthCopy.querySelector('strong').textContent = result.healthy ? `Saudável · ${money(result.available_minor)} externo` : 'Indisponível';
        health.classList.toggle('healthy', Boolean(result.healthy));
        health.classList.toggle('unhealthy', !result.healthy);
      } catch (err) {
        healthCopy.querySelector('strong').textContent = 'Erro no health check';
        health.classList.add('unhealthy');
        flash(err.message, true);
      } finally {
        health.classList.remove('checking');
        test.disabled = false;
      }
    });
    health.append(healthCopy, test);
    card.append(head, details, health);
    return card;
  }

  async function workspaceIntegrations(refreshOnly = false) {
    const [connectionsData, keysData] = await Promise.all([
      api('/console/api/provider-connections'),
      api('/console/api/api-keys'),
    ]);
    const connections = connectionsData.data || [];
    const keys = keysData.data || [];
    state.connections = connections;
    state.apiKeys = keys;
    if (refreshOnly) return;

    const activeConnections = connections.filter(c => c.status === 'active');
    const activeKeys = keys.filter(k => !k.revoked_at);
    const usedKeys = activeKeys.filter(k => k.last_used_at);
    const metrics = node('div', undefined, 'metrics-grid workspace-metrics');
    metrics.append(
      statCard('Providers ativos', String(activeConnections.length), `${connections.length} conexão(ões) cadastrada(s)`),
      statCard('API keys válidas', String(activeKeys.length), `${keys.length} chave(s) no total`),
      statCard('Keys utilizadas', String(usedKeys.length), 'Com registro de último uso'),
      statCard('Credenciais', 'Criptografadas', 'Secrets protegidos no backend')
    );

    const providerGrid = node('div', undefined, 'workspace-provider-grid');
    if (!connections.length) providerGrid.append(emptyState('Conecte o primeiro PSP para começar a processar operações.'));
    connections.forEach(connection => providerGrid.append(integrationProviderCard(connection)));

    const providerActions = node('div', undefined, 'workspace-panel-actions');
    providerActions.append(button('Conectar provider', 'secondary compact', () => providerConnectDrawer(() => workspaceIntegrations())));

    const keyActions = node('div', undefined, 'workspace-panel-actions');
    keyActions.append(button('Nova API key', 'secondary compact', () => apiKeyDrawer(async shouldRender => {
      if (shouldRender === false) return workspaceIntegrations(true);
      return workspaceIntegrations();
    })));

    const keyTable = table(keys, [
      { label: 'Nome', render: r => { const c = node('div', undefined, 'workspace-key-name'); c.append(node('strong', r.name || 'API key'), node('code', r.prefix || '—')); return c; } },
      { label: 'Scopes', render: r => { const list = node('div', undefined, 'workspace-scope-tags'); (r.scopes || []).slice(0, 3).forEach(scope => list.append(node('code', scope))); if ((r.scopes || []).length > 3) list.append(node('span', `+${r.scopes.length - 3}`)); return list; } },
      { label: 'Último uso', render: r => r.last_used_at ? date(r.last_used_at) : 'Nunca usada' },
      { label: 'Status', render: r => badge(r.revoked_at ? 'revoked' : 'active') },
    ], { empty: 'Nenhuma API key criada.' });

    const security = node('div', undefined, 'workspace-security-strip');
    security.append(
      node('div', '01', 'workspace-security-index'),
      (() => { const c = node('div'); c.append(node('strong', 'Princípio de menor privilégio'), node('span', 'Crie uma chave por integração e conceda somente os scopes necessários.')); return c; })(),
      button('Abrir API & Docs', 'secondary compact', () => navigate('developer'))
    );

    setContent(
      actionIntro('Integrações', 'Providers, credenciais e acesso programático à organização.', 'Conectar provider', () => providerConnectDrawer(() => workspaceIntegrations())),
      metrics,
      panel('Providers', providerGrid, providerActions),
      security,
      panel('API keys', keyTable, keyActions)
    );
    viewClass('design-integrations');
  }

  function methodBadge(method) {
    return node('span', method, `workspace-method ${String(method).toLowerCase()}`);
  }

  function developerWorkspace() {
    const base = `${window.location.origin}/v1`;
    const docs = `${window.location.origin}/docs`;
    const openapi = `${window.location.origin}/openapi.yaml`;

    const hero = node('section', undefined, 'workspace-api-hero');
    const copy = node('div');
    copy.append(
      node('span', 'REST API', 'eyebrow'),
      node('h2', 'Integre Pix sem checkout, catálogo ou camada desnecessária.'),
      node('p', 'Use API keys com scopes mínimos, Idempotency-Key nas operações financeiras e webhooks HMAC para receber mudanças de estado.')
    );
    const endpoint = node('div', undefined, 'workspace-api-endpoint');
    endpoint.append(node('span', 'Base URL'), node('code', base));
    const copyBase = button('Copiar', 'secondary compact', async () => {
      try { await navigator.clipboard.writeText(base); flash('Base URL copiada.'); } catch { flash('Não foi possível copiar automaticamente.', true); }
    });
    endpoint.append(copyBase);
    hero.append(copy, endpoint);

    const steps = node('div', undefined, 'workspace-api-steps');
    [
      ['1', 'Autentique', 'Envie X-API-Key em cada requisição.'],
      ['2', 'Proteja retries', 'Use Idempotency-Key em POSTs financeiros.'],
      ['3', 'Receba eventos', 'Valide HMAC antes de processar webhooks.'],
    ].forEach(([n, title, text]) => {
      const step = node('div', undefined, 'workspace-api-step');
      step.append(node('span', n), (() => { const c = node('div'); c.append(node('strong', title), node('p', text)); return c; })());
      steps.append(step);
    });

    const example = node('div', undefined, 'workspace-code-card');
    const exampleHead = node('div', undefined, 'workspace-code-head');
    exampleHead.append(node('div', undefined, 'workspace-code-dots'), node('strong', 'Criar cobrança Pix'));
    const code = `curl -X POST '${base}/pix/charges' \\\n  -H 'Content-Type: application/json' \\\n  -H 'X-API-Key: fp_live_...' \\\n  -H 'Idempotency-Key: charge-2026-0001' \\\n  -d '{\n    "amount_minor": 500,\n    "currency": "BRL",\n    "customer_id": "..."\n  }'`;
    const pre = node('pre');
    pre.textContent = code;
    const exampleActions = node('div', undefined, 'workspace-code-actions');
    exampleActions.append(button('Copiar exemplo', 'secondary compact', async () => {
      try { await navigator.clipboard.writeText(code); flash('Exemplo copiado.'); } catch { flash('Não foi possível copiar automaticamente.', true); }
    }));
    example.append(exampleHead, pre, exampleActions);

    const endpoints = [
      ['GET', '/balance', 'Consultar saldo interno', 'balance:read'],
      ['POST', '/pix/charges', 'Criar cobrança Pix', 'pix:write'],
      ['GET', '/pix/charges/{id}', 'Consultar cobrança', 'pix:read'],
      ['GET', '/transactions', 'Listar transações', 'pix:read'],
      ['POST', '/transfers', 'Enviar Pix', 'pix:write'],
      ['POST', '/withdrawals', 'Solicitar saque', 'pix:write'],
      ['GET', '/customers', 'Listar clientes', 'customers:read'],
      ['POST', '/customers', 'Criar cliente', 'customers:write'],
      ['GET', '/webhooks', 'Listar webhooks', 'webhooks:write'],
      ['POST', '/webhooks', 'Criar webhook', 'webhooks:write'],
    ].map(([method, path, purpose, scope]) => ({ method, path, purpose, scope }));

    const endpointTable = table(endpoints, [
      { label: 'Método', render: r => methodBadge(r.method) },
      { label: 'Endpoint', render: r => node('code', r.path, 'mono') },
      { label: 'Uso', key: 'purpose' },
      { label: 'Scope', render: r => node('code', r.scope, 'mono') },
    ]);

    const resources = node('div', undefined, 'workspace-resource-grid');
    [
      ['Documentação', docs, 'Abrir docs', () => window.open(docs, '_blank', 'noopener')],
      ['OpenAPI', openapi, 'Abrir spec', () => window.open(openapi, '_blank', 'noopener')],
      ['API keys', 'Gerencie chaves e scopes por organização.', 'Gerenciar keys', () => navigate('integrations')],
      ['Webhooks', 'Eventos assinados com HMAC e retry persistente.', 'Gerenciar webhooks', () => navigate('webhooks')],
    ].forEach(([title, text, action, handler]) => {
      const card = node('div', undefined, 'workspace-resource-card');
      card.append(node('strong', title), node('span', text), button(action, 'secondary compact', handler));
      resources.append(card);
    });

    const apiNotice = node('div', undefined, 'workspace-api-notice');
    apiNotice.append(node('strong', 'Valores monetários são inteiros em centavos.'), node('span', 'R$ 5,00 = 500. Mínimos e limites podem variar por provider; consulte a documentação operacional do PSP conectado.'));

    setContent(
      hero,
      steps,
      panel('Exemplo rápido', example),
      panel('Referência de endpoints', endpointTable),
      panel('Recursos', resources),
      apiNotice
    );
    viewClass('design-developer');
  }

  function webhookCreateDrawer(refresh) {
    const form = document.createElement('form');
    form.className = 'workspace-drawer-form';
    const url = input('url', { type: 'url', placeholder: 'https://seu-sistema.com/webhooks/flashpag', required: true });
    const description = input('description', { placeholder: 'Produção, ERP, automação…' });
    form.append(field('URL HTTPS', url), field('Descrição', description));

    const events = node('div', undefined, 'workspace-scope-grid');
    ['transaction.*', 'transaction.succeeded', 'transaction.failed', 'transaction.pending'].forEach((eventName, index) => {
      const item = node('label', undefined, 'workspace-scope-option');
      const check = input('event', { type: 'checkbox', value: eventName });
      check.checked = index === 0;
      const copy = node('div');
      copy.append(node('code', eventName), node('span', index === 0 ? 'Receba todas as mudanças de transação.' : 'Assine somente este estado.'));
      item.append(check, copy);
      events.append(item);
    });
    form.append(events);

    const note = node('div', undefined, 'workspace-note');
    note.append(node('strong', 'Endpoint público e assinatura HMAC'), node('span', 'O destino precisa ser alcançável pela internet em produção e deve validar a assinatura antes de processar o evento.'));
    form.append(note);

    const secret = node('div', undefined, 'workspace-secret-result hidden');
    form.append(secret);

    const actions = node('div', undefined, 'workspace-drawer-actions');
    const cancel = button('Cancelar', 'secondary', closeDrawer);
    const submit = button('Criar webhook', 'primary-action');
    submit.type = 'submit';
    actions.append(cancel, submit);
    form.append(actions);

    form.onsubmit = async event => {
      event.preventDefault();
      submit.disabled = true;
      const selected = $$('input[name="event"]', form).filter(control => control.checked).map(control => control.value);
      try {
        const result = await api('/console/api/webhook-endpoints', {
          method: 'POST',
          body: JSON.stringify({ url: url.value, description: description.value, events: selected }),
        });
        secret.classList.remove('hidden');
        secret.replaceChildren(node('strong', 'Secret de assinatura — copie agora.'), node('code', result.secret));
        cancel.textContent = 'Fechar';
        submit.disabled = true;
        flash('Webhook criado.');
        await refresh(false);
      } catch (err) {
        flash(err.message, true);
        submit.disabled = false;
      }
    };

    drawer('Novo webhook', form);
  }

  async function workspaceWebhooks(refreshOnly = false) {
    const data = await api('/console/api/webhook-endpoints');
    const rows = data.data || [];
    if (refreshOnly) return;
    const active = rows.filter(row => row.status === 'active');
    const eventCount = new Set(rows.flatMap(row => row.events || [])).size;

    const metrics = node('div', undefined, 'metrics-grid workspace-metrics');
    metrics.append(
      statCard('Endpoints', String(rows.length), `${active.length} ativo(s)`),
      statCard('Eventos assinados', String(eventCount), 'Tipos únicos configurados'),
      statCard('Assinatura', 'HMAC', 'Validação do payload'),
      statCard('Entrega', 'Persistente', 'Retry controlado pelo backend')
    );

    const endpointList = node('div', undefined, 'workspace-webhook-list');
    if (!rows.length) endpointList.append(emptyState('Adicione um endpoint para começar a receber eventos.'));
    rows.forEach(row => {
      const item = node('article', undefined, 'workspace-webhook-row');
      const main = node('div', undefined, 'workspace-webhook-main');
      const icon = node('div', '↗', 'workspace-webhook-icon');
      const copy = node('div');
      copy.append(node('strong', row.description || 'Webhook'), node('span', row.url));
      main.append(icon, copy);
      const events = node('div', undefined, 'workspace-scope-tags');
      (row.events || []).forEach(eventName => events.append(node('code', eventName)));
      const meta = node('div', undefined, 'workspace-webhook-meta');
      meta.append(badge(row.status), node('span', `Criado ${shortDate(row.created_at)}`));
      item.append(main, events, meta);
      endpointList.append(item);
    });

    const delivery = node('div', undefined, 'workspace-delivery-grid');
    [
      ['01', 'Persistência', 'O evento é colocado em fila antes da tentativa de entrega.'],
      ['02', 'Assinatura', 'O payload é assinado para validação HMAC pelo merchant.'],
      ['03', 'Retry', 'Falhas transitórias recebem novas tentativas controladas.'],
    ].forEach(([number, title, copy]) => {
      const item = node('div', undefined, 'workspace-delivery-step');
      item.append(node('span', number), node('strong', title), node('p', copy));
      delivery.append(item);
    });

    const observability = node('div', undefined, 'workspace-observability');
    const obsCopy = node('div');
    obsCopy.append(node('strong', 'Logs de entrega'), node('span', 'A fila e os retries já existem. A UI de tentativas entra quando o console expuser webhook_deliveries.'));
    observability.append(node('span', 'Próxima camada', 'badge pending'), obsCopy);

    setContent(
      actionIntro('Webhooks', 'Eventos assinados para ERPs, automações e integrações externas.', 'Novo webhook', () => webhookCreateDrawer(() => workspaceWebhooks())),
      metrics,
      panel('Endpoints', endpointList),
      panel('Modelo de entrega', delivery),
      observability
    );
    viewClass('design-webhooks');
  }

  const baseLoadView = loadView;
  loadView = async function() {
    viewClass('');
    if (state.view === 'developer') {
      closeDrawer();
      $('#page-title').textContent = 'API & Docs';
      $('#page-subtitle').textContent = 'Referência para integrar merchants e sistemas externos';
      developerWorkspace();
      return;
    }
    return baseLoadView();
  };

  customers = workspaceCustomers;
  integrations = workspaceIntegrations;
  webhooks = workspaceWebhooks;
})();
