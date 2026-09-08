(() => {
  const baseDashboard = dashboard;

  async function decorateDashboardBalance() {
    const content = $('#content');
    if (!content) return;
    content.classList.add('design-dashboard');

    const metrics = content.querySelector(':scope > .metrics-grid');
    const hero = metrics?.querySelector('.metric-card:first-child');
    if (!hero || hero.dataset.foundationReady === '1') return;
    hero.dataset.foundationReady = '1';

    let summary = null;
    try {
      summary = await api(orgQuery('/console/api/summary'));
    } catch {
      return;
    }

    const details = node('div', undefined, 'balance-hero-details');
    const reserved = node('span', undefined, 'balance-hero-pill');
    reserved.append(node('span', 'Reservado'), node('strong', money(summary.balance?.reserved_minor || 0)));

    const account = node('span', undefined, 'balance-hero-pill');
    account.append(node('span', 'Conta'), node('strong', summary.account?.name || 'Principal'));

    const actions = node('div', undefined, 'balance-hero-actions');
    const transfer = button('Transferir', 'primary', () => navigate('transfers'));
    const accountsBtn = button('Ver conta', '', () => navigate('accounts'));
    actions.append(transfer, accountsBtn);

    details.append(reserved, account, actions);
    hero.append(details);
  }

  dashboard = async function() {
    await baseDashboard();
    await decorateDashboardBalance();
  };

  const baseLoadView = loadView;
  loadView = async function() {
    $('#content')?.classList.remove('design-dashboard');
    await baseLoadView();
  };
})();
