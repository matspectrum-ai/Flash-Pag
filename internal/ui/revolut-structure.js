(() => {
  const orgById = id => (state.me?.organizations || []).find(org => org.id === id);
  const merchantById = id => (state.me?.merchants || []).find(merchant => merchant.id === id);

  function structuralClass(name) {
    const content = $('#content');
    if (!content) return;
    ['design-accounts', 'design-organizations', 'design-admin'].forEach(cls => content.classList.remove(cls));
    if (name) content.classList.add(name);
  }

  function topActions(items) {
    const wrap = node('div', undefined, 'structure-top-actions');
    items.forEach(([label, cls, action]) => wrap.append(button(label, cls, action)));
    return wrap;
  }

  function ledgerHero(summary) {
    const hero = node('section', undefined, 'structure-ledger-hero');
    const main = node('div', undefined, 'structure-ledger-main');
    main.append(
      node('span', 'Saldo disponível', 'eyebrow'),
      node('strong', money(summary.balance.available_minor)),
      node('small', `${summary.account.name} · ${summary.account.currency || 'BRL'}`)
    );
    const buckets = node('div', undefined, 'structure-ledger-buckets');
    [
      ['Disponível', money(summary.balance.available_minor), 'Livre para novas operações'],
      ['Reservado', money(summary.balance.reserved_minor), 'Protegido por operações em andamento'],
      ['Total interno', money(summary.balance.total_minor), 'Ledger da Flash Pag'],
    ].forEach(([label, value, copy]) => {
      const bucket = node('div', undefined, 'structure-ledger-bucket');
      bucket.append(node('span', label), node('strong', value), node('small', copy));
      buckets.append(bucket);
    });
    hero.append(main, buckets);
    return hero;
  }

  async function structureAccounts() {
    const [accountsData, summary, connectionsData] = await Promise.all([
      api('/console/api/accounts'),
      api(orgQuery('/console/api/summary')),
      api('/console/api/provider-connections'),
    ]);
    const accounts = accountsData.data || [];
    const connections = (connectionsData.data || []).filter(connection => connection.status === 'active');

    const accountCards = node('div', undefined, 'structure-account-grid');
    if (!accounts.length) accountCards.append(emptyState('Nenhuma conta disponível nesta organização.'));
    accounts.forEach(account => {
      const card = node('article', undefined, `structure-account-card ${account.is_default ? 'primary' : ''}`);
      const head = node('div', undefined, 'structure-account-head');
      const icon = node('div', account.is_default ? 'P' : 'A', 'structure-account-icon');
      const copy = node('div');
      copy.append(node('strong', account.name), node('span', account.is_default ? 'Conta principal' : 'Conta secundária'));
      head.append(icon, copy, badge(account.status));

      const id = node('div', undefined, 'structure-account-id');
      id.append(node('span', 'Account ID'), node('code', shortId(account.id)));
      const footer = node('div', undefined, 'structure-account-footer');
      footer.append(node('span', account.currency || 'BRL'), node('span', account.is_default ? 'Padrão' : 'Secundária'));
      card.append(head, id, footer);
      accountCards.append(card);
    });

    const providerBalances = node('div', undefined, 'structure-provider-list');
    if (!connections.length) providerBalances.append(emptyState('Nenhum provider ativo para consulta externa.'));
    connections.forEach(connection => {
      const row = node('div', undefined, 'structure-provider-row');
      const identity = node('div', undefined, 'structure-provider-identity');
      const icon = node('div', (connection.provider_code || 'P').slice(0, 1).toUpperCase(), 'structure-provider-icon');
      const copy = node('div');
      copy.append(node('strong', connection.label || connection.provider_code), node('span', connection.provider_code));
      identity.append(icon, copy);
      const balance = node('strong', 'Não consultado', 'structure-provider-balance');
      const refresh = button('Consultar saldo', 'secondary compact', async () => {
        refresh.disabled = true;
        balance.textContent = 'Consultando…';
        try {
          const result = await api(`/console/api/provider-connections/${connection.id}/test`, { method: 'POST' });
          balance.textContent = result.healthy ? money(result.available_minor) : 'Indisponível';
          balance.classList.toggle('healthy', Boolean(result.healthy));
          balance.classList.toggle('unhealthy', !result.healthy);
        } catch (err) {
          balance.textContent = 'Erro';
          balance.classList.add('unhealthy');
          flash(err.message, true);
        } finally {
          refresh.disabled = false;
        }
      });
      row.append(identity, balance, refresh);
      providerBalances.append(row);
    });

    const separation = node('div', undefined, 'structure-separation');
    const left = node('div');
    left.append(node('strong', 'Ledger interno'), node('span', 'Fonte contábil da Flash Pag para disponível, reservado e total.'));
    const arrow = node('span', '≠', 'structure-separation-mark');
    const right = node('div');
    right.append(node('strong', 'Saldo do provider'), node('span', 'Referência externa consultada no PSP; não substitui o ledger.'));
    separation.append(left, arrow, right);

    const lower = node('div', undefined, 'structure-account-columns');
    lower.append(panel('Contas da organização', accountCards), panel('Saldos externos', providerBalances));

    setContent(
      sectionIntro('Contas e saldos', 'Separe a posição contábil da Flash Pag da disponibilidade informada pelos providers.'),
      ledgerHero(summary),
      separation,
      lower
    );
    structuralClass('design-accounts');
  }

  function organizationCard(org, refresh) {
    const merchant = merchantById(org.merchant_id);
    const selected = org.id === state.orgId;
    const card = node('article', undefined, `structure-org-card ${selected ? 'selected' : ''}`);
    const top = node('div', undefined, 'structure-org-head');
    const copy = node('div');
    copy.append(node('span', selected ? 'Organização atual' : 'Organização'), node('strong', org.name));
    top.append(copy, badge(org.status));

    const slug = node('div', undefined, 'structure-org-slug');
    slug.append(node('span', 'Slug'), node('code', org.slug || '—'));
    const info = node('div', undefined, 'structure-org-info');
    info.append(
      keyValue('Merchant', merchant?.name || shortId(org.merchant_id)),
      keyValue('Organization ID', org.id, true),
      keyValue('Criada', shortDate(org.created_at))
    );
    const actions = node('div', undefined, 'structure-org-actions');
    const choose = button(selected ? 'Organização selecionada' : 'Usar organização', selected ? 'secondary compact' : 'primary-action', async () => {
      state.orgId = org.id;
      localStorage.setItem('flashpag_org', org.id);
      $('#org-select').value = org.id;
      await refresh();
    });
    choose.disabled = selected;
    actions.append(choose);
    card.append(top, slug, info, actions);
    return card;
  }

  async function structureOrganizations() {
    const organizations = state.me?.organizations || [];
    const merchants = state.me?.merchants || [];
    const selected = orgById(state.orgId);
    const active = organizations.filter(org => org.status === 'active');
    const merchantCount = new Set(organizations.map(org => org.merchant_id)).size;

    const metrics = node('div', undefined, 'metrics-grid structure-metrics');
    metrics.append(
      statCard('Organizações', String(organizations.length), 'Disponíveis para este usuário'),
      statCard('Ativas', String(active.length), 'Status operacional'),
      statCard('Merchants', String(merchantCount), `${merchants.length} merchant(s) visível(is)`),
      statCard('Tenant atual', selected?.name || '—', selected?.slug || 'Nenhum selecionado')
    );

    const tenantNotice = node('div', undefined, 'structure-tenant-notice');
    const mark = node('div', 'T', 'structure-tenant-mark');
    const copy = node('div');
    copy.append(node('strong', 'Isolamento por organização'), node('span', 'Ao trocar o tenant, clientes, transações, contas, providers, API keys e webhooks passam a usar o novo contexto.'));
    tenantNotice.append(mark, copy);

    const grid = node('div', undefined, 'structure-org-grid');
    if (!organizations.length) grid.append(emptyState('Nenhuma organização disponível para seu usuário.'));
    organizations.forEach(org => grid.append(organizationCard(org, structureOrganizations)));

    setContent(
      sectionIntro('Organizações', 'Troque o contexto operacional sem misturar dados entre tenants.'),
      metrics,
      tenantNotice,
      panel('Tenants disponíveis', grid)
    );
    structuralClass('design-organizations');
  }

  function merchantDrawer(refresh) {
    const form = document.createElement('form');
    form.className = 'workspace-drawer-form';
    form.append(
      field('Nome do merchant', input('name', { placeholder: 'Empresa ou operação', required: true })),
      field('Owner user UUID', input('owner_user_id', { placeholder: 'Opcional' }))
    );
    const note = node('div', undefined, 'workspace-note');
    note.append(node('strong', 'Merchant'), node('span', 'Entidade comercial que agrupa usuários e organizações. O owner pode ser associado no provisionamento.'));
    form.append(note);
    const actions = node('div', undefined, 'workspace-drawer-actions');
    const cancel = button('Cancelar', 'secondary', closeDrawer);
    const submit = button('Criar merchant', 'primary-action'); submit.type = 'submit';
    actions.append(cancel, submit); form.append(actions);
    form.onsubmit = async event => {
      event.preventDefault(); submit.disabled = true;
      try {
        await api('/console/api/admin/merchants', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
        flash('Merchant criado.'); closeDrawer(); await refreshMe(false); await refresh();
      } catch (err) { flash(err.message, true); }
      finally { submit.disabled = false; }
    };
    drawer('Novo merchant', form);
  }

  function organizationDrawer(refresh) {
    const merchants = state.me?.merchants || [];
    const form = document.createElement('form');
    form.className = 'workspace-drawer-form';
    form.append(
      field('Merchant', select('merchant_id', merchants.map(merchant => ({ value: merchant.id, label: merchant.name })))),
      field('Nome da organização', input('name', { placeholder: 'Operação Brasil', required: true })),
      field('Slug', input('slug', { placeholder: 'operacao-brasil', required: true }))
    );
    const note = node('div', undefined, 'workspace-note');
    note.append(node('strong', 'Organização + conta'), node('span', 'O provisionamento cria a unidade operacional e sua conta padrão conforme o fluxo atual do backend.'));
    form.append(note);
    const actions = node('div', undefined, 'workspace-drawer-actions');
    const cancel = button('Cancelar', 'secondary', closeDrawer);
    const submit = button('Criar organização', 'primary-action'); submit.type = 'submit';
    actions.append(cancel, submit); form.append(actions);
    form.onsubmit = async event => {
      event.preventDefault(); submit.disabled = true;
      try {
        await api('/console/api/admin/organizations', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
        flash('Organização criada.'); closeDrawer(); await refreshMe(false); await refresh();
      } catch (err) { flash(err.message, true); }
      finally { submit.disabled = false; }
    };
    drawer('Nova organização', form);
  }

  function memberDrawer(refresh) {
    const merchants = state.me?.merchants || [];
    const form = document.createElement('form');
    form.className = 'workspace-drawer-form';
    form.append(
      field('Merchant', select('merchant_id', merchants.map(merchant => ({ value: merchant.id, label: merchant.name })))),
      field('User UUID', input('user_id', { placeholder: 'UUID do Supabase Auth', required: true })),
      field('Permissão', select('role', [
        { value: 'owner', label: 'Owner' },
        { value: 'admin', label: 'Admin' },
        { value: 'member', label: 'Member' },
        { value: 'viewer', label: 'Viewer' },
      ], 'member'))
    );
    const note = node('div', undefined, 'workspace-note');
    note.append(node('strong', 'RBAC do merchant'), node('span', 'A permissão controla o que o usuário pode executar no contexto do merchant. O backend continua sendo a autoridade final.'));
    form.append(note);
    const actions = node('div', undefined, 'workspace-drawer-actions');
    const cancel = button('Cancelar', 'secondary', closeDrawer);
    const submit = button('Salvar membro', 'primary-action'); submit.type = 'submit';
    actions.append(cancel, submit); form.append(actions);
    form.onsubmit = async event => {
      event.preventDefault(); submit.disabled = true;
      try {
        await api('/console/api/admin/members', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
        flash('Membro adicionado ou atualizado.'); closeDrawer(); await refresh();
      } catch (err) { flash(err.message, true); }
      finally { submit.disabled = false; }
    };
    drawer('Membro e permissão', form);
  }

  function tenancyModel() {
    const model = node('div', undefined, 'structure-tenancy-flow');
    [
      ['01', 'Merchant', 'Entidade comercial', 'Usuários e organizações pertencem a este escopo.'],
      ['02', 'Organização', 'Tenant operacional', 'Clientes, providers, API keys e webhooks são isolados aqui.'],
      ['03', 'Conta', 'Ledger financeiro', 'Disponível, reservado e lançamentos permanecem segregados.'],
    ].forEach(([number, title, subtitle, copy]) => {
      const item = node('div', undefined, 'structure-tenancy-node');
      item.append(node('span', number), node('strong', title), node('small', subtitle), node('p', copy));
      model.append(item);
    });
    return model;
  }

  function roleGrid() {
    const grid = node('div', undefined, 'structure-role-grid');
    [
      ['Viewer', 'Leitura', 'Consulta dados sem executar operações privilegiadas.'],
      ['Member', 'Clientes', 'Leitura e operações de clientes previstas pelo RBAC atual.'],
      ['Admin', 'Operação', 'Saídas, providers, API keys e webhooks.'],
      ['Owner', 'Controle', 'Escopo privilegiado do merchant.'],
      ['Platform admin', 'Plataforma', 'Provisionamento de merchants, organizações e membros.'],
    ].forEach(([role, scope, copy]) => {
      const item = node('div', undefined, 'structure-role-card');
      item.append(node('strong', role), node('span', scope), node('p', copy));
      grid.append(item);
    });
    return grid;
  }

  async function structureAdmin() {
    if (!state.me?.user?.platform_admin) {
      setContent(panel('Acesso negado', emptyState('Seu usuário não possui permissão de platform admin.')));
      return;
    }
    const merchants = state.me?.merchants || [];
    const organizations = state.me?.organizations || [];

    const metrics = node('div', undefined, 'metrics-grid structure-metrics');
    metrics.append(
      statCard('Merchants', String(merchants.length), 'Entidades comerciais'),
      statCard('Organizações', String(organizations.length), 'Tenants operacionais'),
      statCard('Ativas', String(organizations.filter(org => org.status === 'active').length), 'Organizações em operação'),
      statCard('Sessão', 'Platform admin', state.me.user.email)
    );

    const merchantTable = table(merchants, [
      { label: 'Merchant', render: row => { const c = node('div', undefined, 'structure-entity-cell'); c.append(node('strong', row.name), node('code', shortId(row.id))); return c; } },
      { label: 'Organizações', render: row => String(organizations.filter(org => org.merchant_id === row.id).length) },
      { label: 'Status', render: row => badge(row.status) },
      { label: 'Criado', render: row => shortDate(row.created_at) },
    ], { empty: 'Nenhum merchant cadastrado.' });

    const orgTable = table(organizations, [
      { label: 'Organização', render: row => { const c = node('div', undefined, 'structure-entity-cell'); c.append(node('strong', row.name), node('code', row.slug || shortId(row.id))); return c; } },
      { label: 'Merchant', render: row => merchantById(row.merchant_id)?.name || shortId(row.merchant_id) },
      { label: 'Status', render: row => badge(row.status) },
      { label: 'Criado', render: row => shortDate(row.created_at) },
    ], { empty: 'Nenhuma organização cadastrada.' });

    const actions = topActions([
      ['Novo merchant', 'secondary compact', () => merchantDrawer(structureAdmin)],
      ['Nova organização', 'secondary compact', () => organizationDrawer(structureAdmin)],
      ['Adicionar membro', 'primary-action', () => memberDrawer(structureAdmin)],
    ]);

    const dataGrid = node('div', undefined, 'structure-admin-grid');
    dataGrid.append(panel('Merchants', merchantTable), panel('Organizações', orgTable));

    const governance = node('div', undefined, 'structure-governance');
    governance.append(panel('Modelo de tenancy', tenancyModel()), panel('Permissões', roleGrid()));

    setContent(
      sectionIntro('Administração da plataforma', 'Provisionamento multi-merchant e governança sem misturar o plano de controle com o financeiro.', actions),
      metrics,
      governance,
      dataGrid
    );
    structuralClass('design-admin');
  }

  const baseLoadView = loadView;
  loadView = async function() {
    structuralClass('');
    return baseLoadView();
  };

  accounts = structureAccounts;
  organizations = structureOrganizations;
  admin = structureAdmin;
})();
