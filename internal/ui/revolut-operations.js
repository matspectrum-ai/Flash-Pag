(() => {
  const opMoney = value => money(Number(value || 0));
  const opDirection = row => row.direction === 'in' ? 'Entrada' : 'Saída';
  const opStatus = row => row.status || 'pending';
  const opKind = row => labelKind(row.kind);

  function metric(label, value, meta) {
    return statCard(label, value, meta || '');
  }

  function operationCell(row) {
    const wrap = node('div', undefined, 'operation-cell');
    const icon = node('span', row.direction === 'in' ? '↓' : '↑', `operation-icon ${row.direction === 'in' ? 'incoming' : 'outgoing'}`);
    const copy = node('div');
    copy.append(
      node('strong', opKind(row)),
      node('span', shortId(row.id), 'mono')
    );
    wrap.append(icon, copy);
    return wrap;
  }

  function counterpartyCell(row) {
    const wrap = node('div', undefined, 'counterparty-cell');
    const primary = row.pix_key || row.customer_id || 'Sem contraparte';
    const secondary = row.description || opDirection(row);
    wrap.append(node('strong', shortId(primary)), node('span', secondary));
    return wrap;
  }

  function amountCell(row) {
    const wrap = node('div', undefined, `operation-amount ${row.direction === 'in' ? 'incoming' : 'outgoing'}`);
    wrap.append(
      node('strong', `${row.direction === 'in' ? '+' : '−'} ${opMoney(row.amount_minor)}`),
      node('span', row.currency || 'BRL')
    );
    return wrap;
  }

  function transactionAttention(rows) {
    const pending = rows.filter(row => ['pending', 'ambiguous'].includes(row.status));
    if (!pending.length) return null;

    const card = node('div', undefined, 'attention-card');
    const left = node('div', undefined, 'attention-copy');
    left.append(
      node('span', 'Atenção operacional', 'eyebrow'),
      node('strong', `${pending.length} transação(ões) precisam de acompanhamento`),
      node('p', 'Pendências e estados ambíguos devem ser reconciliados antes de qualquer nova tentativa financeira.')
    );
    const actions = node('div', undefined, 'attention-actions');
    const openFirst = button('Abrir primeira', 'secondary compact', () => {
      const tx = pending[0];
      if (tx) drawer('Detalhes da transação', transactionDetail(tx));
    });
    actions.append(openFirst);
    card.append(left, actions);
    return card;
  }

  async function operationsTransactions() {
    const data = await api('/console/api/transactions');
    const rows = data.data || [];
    state.transactions = rows;
    let page = 1;
    const pageSize = 18;

    $('#content')?.classList.add('design-transactions');

    const completed = rows.filter(row => row.status === 'succeeded');
    const pending = rows.filter(row => ['pending', 'ambiguous'].includes(row.status));
    const failed = rows.filter(row => row.status === 'failed');
    const inbound = completed.filter(row => row.direction === 'in').reduce((sum, row) => sum + Number(row.amount_minor || 0), 0);
    const outbound = completed.filter(row => row.direction === 'out').reduce((sum, row) => sum + Number(row.amount_minor || 0), 0);

    const introActions = node('div', undefined, 'operations-intro-actions');
    introActions.append(button('Nova transferência', 'primary-action', () => navigate('transfers')));
    const intro = sectionIntro('Movimentação financeira', 'Investigue entradas e saídas, acompanhe estados e reconcilie operações quando necessário.', introActions);

    const metrics = node('div', undefined, 'operations-metrics');
    metrics.append(
      metric('Entradas concluídas', opMoney(inbound), `${completed.filter(row => row.direction === 'in').length} operação(ões)`),
      metric('Saídas concluídas', opMoney(outbound), `${completed.filter(row => row.direction === 'out').length} operação(ões)`),
      metric('Em acompanhamento', String(pending.length), 'Pending + ambiguous'),
      metric('Falhas', String(failed.length), rows.length ? `${Math.round((failed.length / rows.length) * 100)}% do histórico` : 'Sem histórico')
    );

    const toolbar = node('div', undefined, 'operations-toolbar');
    const search = input('search', { placeholder: 'Buscar ID, provider, chave Pix ou cliente' });
    search.classList.add('operations-search');
    const status = select('status', [
      { value: '', label: 'Todos os status' },
      { value: 'succeeded', label: 'Concluídas' },
      { value: 'pending', label: 'Pendentes' },
      { value: 'ambiguous', label: 'Ambíguas' },
      { value: 'failed', label: 'Falhas' },
    ]);
    const direction = select('direction', [
      { value: '', label: 'Entrada + saída' },
      { value: 'in', label: 'Entradas' },
      { value: 'out', label: 'Saídas' },
    ]);
    const kind = select('kind', [
      { value: '', label: 'Todos os tipos' },
      { value: 'pix_in', label: 'Pix recebido' },
      { value: 'transfer', label: 'Transferência' },
      { value: 'withdrawal', label: 'Saque' },
    ]);
    const providers = [...new Set(rows.map(row => row.provider_code).filter(Boolean))];
    const provider = select('provider', [{ value: '', label: 'Todos os providers' }, ...providers.map(value => ({ value, label: value }))]);
    const period = select('period', [
      { value: '', label: 'Todo o período' },
      { value: '7', label: '7 dias' },
      { value: '30', label: '30 dias' },
      { value: '90', label: '90 dias' },
    ]);
    const reset = button('Limpar', 'secondary compact');
    toolbar.append(search, status, direction, kind, provider, period, reset);

    const tableSlot = node('div', undefined, 'operations-table-slot');
    const footer = node('div', undefined, 'operations-pagination');

    function filteredRows() {
      const query = search.value.trim().toLowerCase();
      const days = Number(period.value || 0);
      const cutoff = days ? Date.now() - days * 86400000 : 0;
      return rows.filter(row => {
        const haystack = [row.id, row.provider_external_id, row.provider_code, row.pix_key, row.customer_id, row.description].filter(Boolean).join(' ').toLowerCase();
        const created = new Date(row.created_at).getTime();
        return (!query || haystack.includes(query)) &&
          (!status.value || row.status === status.value) &&
          (!direction.value || row.direction === direction.value) &&
          (!kind.value || row.kind === kind.value) &&
          (!provider.value || row.provider_code === provider.value) &&
          (!cutoff || created >= cutoff);
      });
    }

    function renderRows() {
      const filtered = filteredRows();
      const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
      if (page > totalPages) page = totalPages;
      const start = (page - 1) * pageSize;
      const shown = filtered.slice(start, start + pageSize);

      tableSlot.replaceChildren(table(shown, [
        { label: 'Transação', render: operationCell },
        { label: 'Contraparte', render: counterpartyCell },
        { label: 'Provider', render: row => { const wrap = node('div', undefined, 'provider-cell'); wrap.append(node('strong', row.provider_code || '—'), node('span', shortId(row.provider_external_id || ''))); return wrap; } },
        { label: 'Status', render: row => badge(opStatus(row)) },
        { label: 'Criada', render: row => { const wrap = node('div', undefined, 'date-cell'); wrap.append(node('strong', shortDate(row.created_at)), node('span', new Date(row.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))); return wrap; } },
        { label: 'Valor', render: amountCell, className: 'amount' },
      ], {
        onRowClick: row => drawer('Detalhes da transação', transactionDetail(row)),
        empty: 'Nenhuma transação corresponde aos filtros atuais.'
      }));

      footer.replaceChildren();
      footer.append(node('span', `${filtered.length} resultado(s)`));
      const nav = node('div');
      const prev = button('Anterior', 'secondary compact', () => { if (page > 1) { page--; renderRows(); } });
      const pageLabel = node('span', `${page} / ${totalPages}`, 'page-indicator');
      const next = button('Próxima', 'secondary compact', () => { if (page < totalPages) { page++; renderRows(); } });
      prev.disabled = page <= 1;
      next.disabled = page >= totalPages;
      nav.append(prev, pageLabel, next);
      footer.append(nav);
    }

    [search, status, direction, kind, provider, period].forEach(control => control.addEventListener(control.tagName === 'INPUT' ? 'input' : 'change', () => { page = 1; renderRows(); }));
    reset.onclick = () => {
      search.value = '';
      [status, direction, kind, provider, period].forEach(control => control.selectedIndex = 0);
      page = 1;
      renderRows();
      search.focus();
    };

    renderRows();
    const attention = transactionAttention(rows);
    const historyPanel = panel('Histórico', (() => {
      const stack = node('div', undefined, 'operations-history-stack');
      stack.append(toolbar, tableSlot, footer);
      return stack;
    })());

    const content = [intro, metrics];
    if (attention) content.push(attention);
    content.push(historyPanel);
    setContent(...content);
  }

  function reviewTransferPayload(payload, kindValue, connectionLabel, submitAction) {
    const wrap = node('div', undefined, 'transfer-review');
    const amount = node('div', undefined, 'review-amount');
    amount.append(node('span', kindValue === 'withdrawal' ? 'Saque' : 'Transferência Pix'), node('strong', opMoney(payload.amount_minor)));
    wrap.append(amount);

    const rows = node('div', undefined, 'review-details');
    rows.append(
      keyValue('Chave Pix', payload.pix_key, true),
      keyValue('Provider', payload.provider || 'Automático'),
      keyValue('Conexão', connectionLabel || 'Automática'),
      keyValue('Descrição', payload.description || '—')
    );
    wrap.append(rows);

    const warning = node('div', undefined, 'review-warning');
    warning.append(node('strong', 'Confirme antes de enviar'), node('span', 'A Flash Pag reservará saldo antes da chamada ao provider. Não repita a operação após timeout sem verificar o estado anterior.'));
    wrap.append(warning);

    const actions = node('div', undefined, 'review-actions');
    const cancel = button('Cancelar', 'secondary', closeDrawer);
    const confirm = button('Confirmar e enviar', 'primary-action', async () => {
      confirm.disabled = true;
      cancel.disabled = true;
      const previous = confirm.textContent;
      confirm.textContent = 'Enviando…';
      try {
        await submitAction();
        closeDrawer();
      } catch (err) {
        flash(err.message, true);
        confirm.disabled = false;
        cancel.disabled = false;
        confirm.textContent = previous;
      }
    });
    actions.append(cancel, confirm);
    wrap.append(actions);
    return wrap;
  }

  async function operationsTransfers() {
    const [summary, txData, connData] = await Promise.all([
      api(orgQuery('/console/api/summary')),
      api('/console/api/transactions'),
      api('/console/api/provider-connections'),
    ]);
    const rows = (txData.data || []).filter(row => ['transfer', 'withdrawal'].includes(row.kind));
    const connections = (connData.data || []).filter(connection => connection.status === 'active');
    const completed = rows.filter(row => row.status === 'succeeded');
    const open = rows.filter(row => ['pending', 'ambiguous'].includes(row.status));
    const totalSent = completed.reduce((sum, row) => sum + Number(row.amount_minor || 0), 0);

    $('#content')?.classList.add('design-transfers');

    const intro = sectionIntro('Enviar dinheiro', 'Crie transferências e saques com revisão antes do envio e reserva de saldo controlada pelo ledger.');

    const balanceHero = node('section', undefined, 'transfer-balance-hero');
    const balanceCopy = node('div', undefined, 'transfer-balance-copy');
    balanceCopy.append(node('span', 'Saldo disponível', 'eyebrow'), node('strong', opMoney(summary.balance.available_minor)), node('small', `Conta ${summary.account.name}`));
    const balanceMeta = node('div', undefined, 'transfer-balance-meta');
    const reserved = node('div'); reserved.append(node('span', 'Reservado'), node('strong', opMoney(summary.balance.reserved_minor)));
    const sent = node('div'); sent.append(node('span', 'Saídas concluídas'), node('strong', opMoney(totalSent)));
    const tracking = node('div'); tracking.append(node('span', 'Em acompanhamento'), node('strong', String(open.length)));
    balanceMeta.append(reserved, sent, tracking);
    balanceHero.append(balanceCopy, balanceMeta);

    const form = document.createElement('form');
    form.className = 'transfer-compose-form';
    const kindSelect = select('kind', [
      { value: 'transfer', label: 'Transferência Pix' },
      { value: 'withdrawal', label: 'Saque' },
    ]);
    const amountInput = input('amount_reais', { type: 'number', min: '0.01', step: '0.01', placeholder: '0,00', required: true });
    const pixKeyInput = input('pix_key', { placeholder: 'CPF, CNPJ, e-mail, telefone ou EVP', required: true });
    const providerSelect = select('provider', (state.me.installed_providers || []).map(provider => ({ value: provider, label: provider })));
    const connectionSelect = select('provider_connection_id', [
      { value: '', label: 'Selecionar automaticamente' },
      ...connections.map(connection => ({ value: connection.id, label: `${connection.label} · ${connection.provider_code}` })),
    ]);
    const descriptionInput = input('description', { placeholder: 'Descrição opcional' });

    const amountField = field('Valor', amountInput);
    amountField.classList.add('transfer-amount-field');
    form.append(
      field('Operação', kindSelect),
      amountField,
      field('Chave Pix', pixKeyInput),
      field('Provider', providerSelect),
      field('Conexão', connectionSelect),
      field('Descrição', descriptionInput)
    );

    const safety = node('div', undefined, 'transfer-safety');
    safety.append(node('strong', 'Proteção contra duplicidade'), node('span', 'A operação financeira usa idempotência no backend. Estados ambíguos permanecem reservados até reconciliação.'));
    form.append(safety);

    const submitRow = node('div', undefined, 'transfer-submit-row');
    const submit = button('Revisar transferência', 'primary-action');
    submit.type = 'submit';
    submitRow.append(submit);
    form.append(submitRow);

    form.onsubmit = event => {
      event.preventDefault();
      const reais = Number(amountInput.value);
      if (!Number.isFinite(reais) || reais <= 0) {
        flash('Informe um valor válido.', true);
        amountInput.focus();
        return;
      }
      if (!pixKeyInput.value.trim()) {
        flash('Informe a chave Pix.', true);
        pixKeyInput.focus();
        return;
      }

      const payload = {
        amount_minor: Math.round(reais * 100),
        currency: 'BRL',
        pix_key: pixKeyInput.value.trim(),
        description: descriptionInput.value.trim(),
        provider: providerSelect.value,
      };
      if (connectionSelect.value) payload.provider_connection_id = connectionSelect.value;
      const kindValue = kindSelect.value;
      const selectedConnection = connections.find(connection => connection.id === connectionSelect.value);

      const doSubmit = async () => {
        const endpoint = kindValue === 'withdrawal' ? '/console/api/withdrawals' : '/console/api/transfers';
        await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
        flash(kindValue === 'withdrawal' ? 'Saque solicitado.' : 'Transferência criada.');
        await operationsTransfers();
      };

      drawer('Revisar saída Pix', reviewTransferPayload(payload, kindValue, selectedConnection ? `${selectedConnection.label} · ${selectedConnection.provider_code}` : '', doSubmit));
    };

    const composePanel = panel('Nova saída Pix', form);
    composePanel.classList.add('transfer-compose-panel');

    const guide = node('div', undefined, 'transfer-guide');
    [
      ['1', 'Revise', 'Confira valor, chave e provider antes do envio.'],
      ['2', 'Reserve', 'O ledger protege o valor antes da chamada externa.'],
      ['3', 'Acompanhe', 'Pending ou ambiguous devem ser reconciliados antes de repetir.'],
    ].forEach(([number, title, copy]) => {
      const item = node('div', undefined, 'transfer-guide-item');
      item.append(node('span', number), (() => { const text = node('div'); text.append(node('strong', title), node('small', copy)); return text; })());
      guide.append(item);
    });
    const guidePanel = panel('Fluxo seguro', guide);
    guidePanel.classList.add('transfer-guide-panel');

    const composeGrid = node('div', undefined, 'transfer-compose-grid');
    composeGrid.append(composePanel, guidePanel);

    const history = table(rows.slice(0, 30), [
      { label: 'Operação', render: operationCell },
      { label: 'Chave Pix', render: row => node('span', shortId(row.pix_key || '—'), 'mono') },
      { label: 'Provider', render: row => row.provider_code || '—' },
      { label: 'Status', render: row => badge(row.status) },
      { label: 'Data', render: row => date(row.created_at) },
      { label: 'Valor', render: amountCell, className: 'amount' },
    ], { onRowClick: row => drawer('Detalhes da saída', transactionDetail(row)), empty: 'Nenhuma saída Pix criada ainda.' });

    setContent(intro, balanceHero, composeGrid, panel('Histórico de saídas', history));
  }

  const previousLoadView = loadView;
  loadView = async function() {
    $('#content')?.classList.remove('design-transactions', 'design-transfers');
    return previousLoadView();
  };

  transactions = operationsTransactions;
  transfers = operationsTransfers;
})();
