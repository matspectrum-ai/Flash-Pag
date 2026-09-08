(() => {
  const iconPaths = {
    dashboard: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-6h5v6"/>',
    transactions: '<path d="M7 7h11"/><path d="m15 4 3 3-3 3"/><path d="M17 17H6"/><path d="m9 14-3 3 3 3"/>',
    transfers: '<path d="M5 12h14"/><path d="m14 7 5 5-5 5"/>',
    customers: '<circle cx="12" cy="8" r="3"/><path d="M5 21c.6-4 3-6 7-6s6.4 2 7 6"/>',
    integrations: '<path d="M9 12a3 3 0 0 0 6 0"/><path d="M8 7V4M16 7V4"/><path d="M7 7h10v3a5 5 0 0 1-10 0V7Z"/><path d="M12 15v5"/>',
    developer: '<path d="m8 9-3 3 3 3"/><path d="m16 9 3 3-3 3"/><path d="m14 5-4 14"/>',
    webhooks: '<path d="M8.5 15.5 5 19a2.8 2.8 0 0 1-4-4l3.5-3.5" transform="translate(4 0)"/><path d="M15.5 8.5 19 5a2.8 2.8 0 1 0-4-4l-3.5 3.5" transform="translate(0 4)"/><path d="m9 15 6-6"/>',
    accounts: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 15h2"/>',
    organizations: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
    admin: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3V9.6h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.18.39.4.73.6 1 .28.35.65.57 1.1.6h.1v4h-.1c-.45.03-.82.25-1.1.6-.2.27-.42.61-.6 1Z"/>',
  };

  function iconSvg(paths) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`;
  }

  function normalizeNavIcons() {
    $$('[data-view]').forEach(buttonEl => {
      const view = buttonEl.dataset.view;
      const icon = buttonEl.querySelector('.nav-icon');
      if (!icon || !iconPaths[view] || icon.dataset.polished === '1') return;
      icon.innerHTML = iconSvg(iconPaths[view]);
      icon.dataset.polished = '1';
    });
  }

  function normalizeUserIdentity() {
    const email = state.me?.user?.email || $('#user-email')?.textContent || '';
    const avatar = $('.sidebar .avatar');
    if (avatar && email) avatar.textContent = email.trim().slice(0, 1).toUpperCase();
  }

  function annotateTables() {
    $$('.table-wrap').forEach(wrap => {
      if (wrap.dataset.polished === '1') return;
      wrap.dataset.polished = '1';
      wrap.setAttribute('role', 'region');
      wrap.setAttribute('aria-label', 'Tabela de dados');
    });
  }

  function annotateExternalButtons() {
    $$('button').forEach(btn => {
      const label = (btn.textContent || '').trim().toLowerCase();
      if ((label.includes('abrir documentação') || label.includes('abrir docs') || label.includes('abrir spec')) && !btn.title) {
        btn.title = 'Abre em uma nova aba';
      }
    });
  }

  function polishRenderedView() {
    normalizeNavIcons();
    normalizeUserIdentity();
    annotateTables();
    annotateExternalButtons();
  }

  const priorLoadView = loadView;
  loadView = async function() {
    await priorLoadView();
    polishRenderedView();
  };

  const priorShowApp = showApp;
  showApp = function() {
    priorShowApp();
    requestAnimationFrame(polishRenderedView);
  };

  const observerTarget = $('#content');
  if (observerTarget) {
    const observer = new MutationObserver(() => requestAnimationFrame(polishRenderedView));
    observer.observe(observerTarget, { childList: true, subtree: true });
  }

  polishRenderedView();
})();
