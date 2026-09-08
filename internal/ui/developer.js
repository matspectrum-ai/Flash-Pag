(() => {
  const baseLoadView = loadView;

  function developerEndpoint(method, path, purpose, scope = '—') {
    return { method, path, purpose, scope };
  }

  function methodBadge(method) {
    return node('span', method, `method-badge ${method.toLowerCase()}`);
  }

  function apiWorkspace() {
    const baseUrl = `${window.location.origin}/v1`;
    const docsUrl = `${window.location.origin}/docs`;
    const openapiUrl = `${window.location.origin}/openapi.yaml`;

    const introActions = node('div', undefined, 'developer-top-actions');
    introActions.append(
      button('Gerenciar API keys', 'secondary compact', () => navigate('integrations')),
      button('Abrir documentação', 'primary-action', () => window.open(docsUrl, '_blank', 'noopener'))
    );

    const intro = node('div', undefined, 'section-intro');
    const introCopy = node('div');
    introCopy.append(node('h2', 'API & Docs'), node('p', 'Tudo que um merchant precisa para integrar a Flash Pag sem checkout ou catálogo.'));
    intro.append(introCopy, introActions);

    const metrics = node('div', undefined, 'mini-summary-grid');
    metrics.append(
      statCard('Base URL', '/v1', window.location.host),
      statCard('Formato', 'REST + JSON', 'BRL em centavos inteiros'),
      statCard('Autenticação', 'X-API-Key', 'Bearer também aceito'),
      statCard('Financeiro', 'Idempotente', 'Idempotency-Key obrigatório')
    );

    const credentials = node('div', undefined, 'developer-credential-grid');
    [
      ['Base URL', baseUrl, 'Copiar Base URL'],
      ['Documentação', docsUrl, 'Copiar URL'],
      ['OpenAPI', openapiUrl, 'Copiar URL'],
    ].forEach(([label, value, action]) => {
      const card = node('div', undefined, 'credential-card');
      card.append(node('span', label), node('code', value));
      const b = button(action, 'secondary compact', async () => {
        try {
          await navigator.clipboard.writeText(value);
          flash('Copiado para a área de transferência.');
        } catch {
          flash('Não foi possível copiar automaticamente.', true);
        }
      });
      card.append(b);
      credentials.append(card);
    });

    const scopes = [
      ['pix:read', 'Consultar cobranças e transações Pix'],
      ['pix:write', 'Criar cobranças, transferências e saques'],
      ['balance:read', 'Consultar saldo interno'],
      ['customers:read', 'Listar clientes'],
      ['customers:write', 'Criar clientes'],
      ['webhooks:write', 'Gerenciar endpoints de webhook'],
    ];
    const scopeGrid = node('div', undefined, 'api-scope-grid');
    scopes.forEach(([name, copy]) => {
      const item = node('div', undefined, 'api-scope-card');
      item.append(node('code', name), node('span', copy));
      scopeGrid.append(item);
    });

    const endpoints = [
      developerEndpoint('GET', '/v1/balance', 'Saldo disponível e reservado', 'balance:read'),
      developerEndpoint('POST', '/v1/pix/charges', 'Gerar cobrança Pix', 'pix:write'),
      developerEndpoint('GET', '/v1/pix/charges/{id}', 'Consultar cobrança Pix', 'pix:read'),
      developerEndpoint('GET', '/v1/transactions', 'Listar transações', 'pix:read'),
      developerEndpoint('POST', '/v1/transfers', 'Enviar Pix', 'pix:write'),
      developerEndpoint('POST', '/v1/withdrawals', 'Solicitar saque', 'pix:write'),
      developerEndpoint('GET', '/v1/customers', 'Listar clientes', 'customers:read'),
      developerEndpoint('POST', '/v1/customers', 'Criar cliente', 'customers:write'),
      developerEndpoint('GET', '/v1/integrations', 'Listar integrações', 'pix:read'),
      developerEndpoint('GET', '/v1/webhooks', 'Listar webhooks', 'webhooks:write'),
      developerEndpoint('POST', '/v1/webhooks', 'Criar webhook', 'webhooks:write'),
    ];

    const endpointTable = table(endpoints, [
      { label: 'Método', render: r => methodBadge(r.method) },
      { label: 'Endpoint', render: r => node('code', r.path, 'mono api-path') },
      { label: 'Uso', key: 'purpose' },
      { label: 'Scope', render: r => node('code', r.scope, 'mono') },
    ], { empty: 'Nenhum endpoint documentado.' });

    const rules = node('div', undefined, 'developer-rules');
    [
      ['Valores monetários', 'Envie valores em centavos inteiros. R$ 5,00 = 500.'],
      ['Idempotência', 'POSTs financeiros exigem Idempotency-Key. Nunca gere outra operação cegamente após timeout.'],
      ['Webhooks', 'Valide a assinatura HMAC antes de processar eventos e trate callbacks como idempotentes.'],
      ['Segurança', 'API keys e secrets devem permanecer apenas no backend da integração do merchant.'],
    ].forEach(([title, copy]) => {
      const item = node('div');
      item.append(node('strong', title), node('p', copy));
      rules.append(item);
    });

    return [
      intro,
      metrics,
      panel('Endpoints de integração', credentials),
      panel('Scopes', scopeGrid),
      panel('Referência rápida', endpointTable),
      panel('Regras de integração', rules),
    ];
  }

  async function developerView() {
    $('#page-title').textContent = 'API & Docs';
    $('#page-subtitle').textContent = 'Referência para integrar merchants e sistemas externos';
    closeDrawer();
    if (!state.orgId) {
      setContent(panel('Sem organização', emptyState('Selecione uma organização antes de trabalhar com credenciais e scopes.')));
      return;
    }
    $('#content').replaceChildren(...apiWorkspace());
  }

  loadView = async function() {
    if (state.view === 'developer') {
      try {
        await developerView();
      } catch (err) {
        setContent(panel('Não foi possível carregar', node('div', err.message, 'error-block')));
      }
      return;
    }
    return baseLoadView();
  };
})();
