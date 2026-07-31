/* ============================================================
   views/dashboard.js — landing / at-a-glance
   ============================================================ */
RMTP.views.dashboard = function (el) {
  const ui = RMTP.ui, store = RMTP.store;

  const cards = [
    { id: 'procedures',  desc: 'Operating procedures & SOPs for the building.',
      stat: () => store.all('procedures').reduce((n, c) => n + c.items.length, 0), unit: 'documents' },
    { id: 'maintenance', desc: 'Log faults and track repairs across the venue.',
      stat: () => store.all('maintenance').filter((r) => r.status === 'Open').length, unit: 'open' },
    { id: 'inventory',   desc: 'Scan kit in and out; track where everything lives.',
      stat: () => store.all('inventory').filter((r) => r.status === 'out').length, unit: 'signed out' },
    { id: 'users',       desc: 'Manage the team, roles and training sign-off.',
      stat: () => store.all('users').length, unit: 'users' },
    { id: 'advancing',   desc: 'Gather show info, assign techs and file shift reports.',
      stat: () => store.all('advancing').length, unit: 'events' },
  ];

  const cardHtml = cards.map((c) => {
    const nav = RMTP.nav.find((n) => n.id === c.id);
    return (
      '<a href="#/' + c.id + '" class="panel p-5 group hover:border-accent transition-colors block">' +
        '<div class="flex items-center justify-between mb-4">' +
          '<div class="w-11 h-11 rounded-xl bg-panel2 border border-line flex items-center justify-center text-accent">' +
            ui.icon(nav.icon) + '</div>' +
          '<span class="text-muted group-hover:text-accent transition-colors">' + ui.icon('arrowR', 'w-5 h-5') + '</span>' +
        '</div>' +
        '<h2 class="font-display text-lg font-semibold">' + nav.label + '</h2>' +
        '<p class="text-sm text-muted mt-1 leading-relaxed">' + c.desc + '</p>' +
        '<p class="mt-4 text-sm"><span class="tabular text-ink font-semibold">' + c.stat() + '</span> ' +
          '<span class="text-muted">' + c.unit + '</span></p>' +
      '</a>'
    );
  }).join('');

  const me = RMTP.auth.current();
  const greetName = me && me.firstName ? ', ' + me.firstName : '';

  function movementsPanel() {
    const moves = RMTP.recentMovements(6);
    const openFaultIds = new Set(store.all('maintenance').filter((f) => f.status !== 'Resolved' && f.itemId).map((f) => f.itemId));
    const flagged = store.all('inventory').filter((it) => RMTP.isPoorCondition(it.condition) || openFaultIds.has(it.id)).length;
    if (!moves.length && !flagged) return '';
    return '<div class="panel p-5 mt-8">' +
      '<div class="flex items-center justify-between mb-3">' +
        '<p class="eyebrow">Recent kit movements</p>' +
        (flagged ? '<a href="#/maintenance" class="text-xs" style="color:var(--danger)">' + ui.icon('alert', 'w-3.5 h-3.5 inline') + ' ' + flagged + ' flagged</a>' : '') +
      '</div>' +
      (moves.length
        ? '<div class="divide-y divide-line">' + moves.map((mv) =>
            '<div class="py-2 text-sm flex items-center justify-between gap-3">' +
              '<span class="min-w-0 truncate"><span class="font-medium">' + ui.esc(mv.name) + '</span> ' +
                '<span class="text-muted">' + ui.esc(mv.from || '\u2014') + ' \u2192 ' + ui.esc(mv.to) + '</span></span>' +
              '<span class="text-[11px] text-muted shrink-0">' + (mv.at ? ui.timeAgo(new Date(mv.at).getTime()) : '') + (mv.by ? ' \u00b7 ' + ui.esc(mv.by) : '') + '</span>' +
            '</div>').join('') + '</div>'
        : '<p class="text-sm text-muted">No movements logged yet.</p>') +
    '</div>';
  }

  function inTray() {
    if (!me) return '';
    const myAdvances = store.all('advancing')
      .filter((e) => e.techUserId === me.id && e.status !== 'Complete')
      .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
    const compTotal = RMTP.TRAINING.reduce((n, c) => n + c.items.length, 0);
    const mySigned = store.all('signoffs').filter((s) => s.userId === me.id).length;
    const outstanding = Math.max(0, compTotal - mySigned);
    const pending = me.admin ? RMTP.auth.pendingUsers() : [];
    const sections = [];

    if (pending.length) {
      sections.push('<div>' +
        '<div class="flex items-center gap-2 mb-2">' + ui.icon('users', 'w-4 h-4 text-accent') +
          '<p class="eyebrow">Access requests \u00b7 ' + pending.length + '</p></div>' +
        '<div class="grid gap-2">' + pending.map((u) =>
          '<div class="flex items-center justify-between gap-3 flex-wrap">' +
            '<div class="min-w-0"><span class="font-medium">' + ui.esc(RMTP.auth.displayName(u)) + '</span> ' +
              '<span class="text-xs text-muted">' + ui.esc(u.email) + '</span></div>' +
            '<div class="flex gap-2 shrink-0">' +
              '<button data-approve="' + u.id + '" class="btn btn-primary !py-1.5 text-xs">Approve</button>' +
              '<button data-reject="' + u.id + '" class="btn btn-ghost !py-1.5 text-xs">Reject</button>' +
            '</div></div>').join('') + '</div></div>');
    }
    if (myAdvances.length) {
      sections.push('<div>' +
        '<div class="flex items-center gap-2 mb-2">' + ui.icon('clip', 'w-4 h-4 text-accent') +
          '<p class="eyebrow">Your advances \u00b7 ' + myAdvances.length + '</p></div>' +
        '<div class="grid gap-1.5">' + myAdvances.slice(0, 5).map((e) =>
          '<a href="#/advancing" class="flex items-center justify-between gap-3 text-sm hover:text-accent transition-colors">' +
            '<span class="min-w-0 truncate"><span class="font-medium">' + ui.esc(e.name) + '</span>' +
              (e.space ? ' <span class="text-muted">\u00b7 ' + ui.esc(e.space) + '</span>' : '') + '</span>' +
            '<span class="text-xs text-muted shrink-0">' + (e.date ? ui.formatDate(e.date) : ui.esc(e.status)) + '</span>' +
          '</a>').join('') + '</div></div>');
    }
    if (outstanding > 0) {
      sections.push('<a href="#/users" class="flex items-center justify-between gap-3 group">' +
        '<div class="flex items-center gap-2">' + ui.icon('award', 'w-4 h-4 text-accent') +
          '<span class="eyebrow">Training outstanding</span></div>' +
        '<span class="text-sm text-muted group-hover:text-accent transition-colors">' + outstanding + ' to sign off ' + ui.icon('arrowR', 'w-4 h-4 inline') + '</span></a>');
    }

    const inner = sections.length
      ? sections.join('<div class="h-px bg-line my-4"></div>')
      : '<p class="text-sm text-muted">You\u2019re all caught up \u2014 nothing needs your attention right now.</p>';
    return inner;
  }

  function todaysShifts() {
    const today = new Date().toISOString().slice(0, 10);
    let list = store.all('advancing').filter((e) => e.date === today);
    if (me && !me.admin) list = list.filter((e) => e.techUserId === me.id);
    return list.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  }
  function todayInner(list) {
    if (!list.length) return '<p class="text-sm text-muted">No shifts scheduled today.</p>';
    return '<div class="grid gap-1.5">' + list.map((e) => {
      const times = [e.startTime, e.finishTime].filter(Boolean).join(' \u2013 ');
      let who = '';
      if (me && me.admin && e.techUserId) { const u = store.find('users', e.techUserId); who = u ? RMTP.auth.displayName(u) : 'Unassigned'; }
      return '<a href="#/advancing" class="flex items-center justify-between gap-3 text-sm hover:text-accent transition-colors">' +
        '<span class="min-w-0 truncate"><span class="font-medium">' + ui.esc(e.name) + '</span>' +
          (e.space ? ' <span class="text-muted">\u00b7 ' + ui.esc(e.space) + '</span>' : '') +
          (who ? ' <span class="text-muted">\u00b7 ' + ui.esc(who) + '</span>' : '') + '</span>' +
        '<span class="text-xs text-muted shrink-0">' + ui.esc(times || e.status || '') + '</span>' +
      '</a>';
    }).join('') + '</div>';
  }
  function topPanel() {
    if (!me) return '';
    const today = todaysShifts();
    const tabBtn = (id, label, badge, active) =>
      '<button data-tab="' + id + '" class="px-3 py-1.5 rounded-lg text-sm font-medium border ' +
        (active ? 'bg-panel2 text-ink border-accent' : 'text-muted hover:text-ink border-transparent') + '">' +
        label + (badge ? ' <span class="tabular text-xs opacity-70">' + badge + '</span>' : '') + '</button>';
    return '<div class="panel p-5 mb-8" style="border-color:color-mix(in srgb,var(--accent) 30%,var(--line))">' +
      '<div class="flex items-center gap-2 mb-4">' +
        tabBtn('tray', 'In tray', '', true) +
        tabBtn('today', 'Today\u2019s shifts', today.length || '', false) +
      '</div>' +
      '<div data-tabpanel="tray">' + inTray() + '</div>' +
      '<div data-tabpanel="today" class="hidden">' + todayInner(today) + '</div>' +
    '</div>';
  }

  el.innerHTML =
    '<div class="view-enter">' +
      ui.pageHeader('Rich Mix · ' + RMTP.meta.product, 'Good evening' + greetName,
        RMTP.auth.can('data.reset')
          ? '<button id="reset-demo" class="btn btn-ghost no-print">' + ui.icon('reset', 'w-4 h-4') + 'Reset demo data</button>'
          : '') +
      '<p class="text-muted -mt-2 mb-8 max-w-2xl">Quick access to the building\u2019s technical operations. ' +
        'Pick a section to get started \u2014 everything is editable and saves to this device.</p>' +

      topPanel() +

      '<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">' + cardHtml + '</div>' +

      movementsPanel() +

      '<div class="panel p-5 mt-8">' +
        '<p class="eyebrow mb-2">Build note</p>' +
        '<p class="text-sm text-muted leading-relaxed">Proof of concept. <span class="text-ink">Sign-in, ' +
        'passwords and approvals</span> are a prototype stand-in (not secure) \u2014 real auth is a backend job. ' +
        'Permissions hide controls but aren\u2019t enforced yet. <span class="text-ink">Inventory</span> supports ' +
        'quantity splits and QR sign-out; <span class="text-ink">Procedures</span> ship as blank holding pages. ' +
        '<span class="text-ink">Camera scanning needs https or localhost</span> \u2014 see ' +
        '<span class="tabular text-ink">README.md</span> and <span class="tabular text-ink">docs/BACKEND.md</span>.</p>' +
      '</div>' +
    '</div>';

  el.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.getAttribute('data-tab');
    el.querySelectorAll('[data-tabpanel]').forEach((p) => p.classList.toggle('hidden', p.getAttribute('data-tabpanel') !== id));
    el.querySelectorAll('[data-tab]').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('bg-panel2', active); b.classList.toggle('text-ink', active); b.classList.toggle('border-accent', active);
      b.classList.toggle('text-muted', !active); b.classList.toggle('border-transparent', !active);
    });
  }));

  const resetBtn = el.querySelector('#reset-demo');
  if (resetBtn) resetBtn.addEventListener('click', async () => {
    const ok = await ui.confirm('This clears everything on this device and restores the starter data. Continue?',
      { title: 'Reset demo data', confirmLabel: 'Reset', danger: true });
    if (ok) { store.reset(); RMTP.auth.ensureSession(); RMTP.auth.refreshShell(); ui.toast('Demo data reset', 'ok'); RMTP.router.render(); }
  });

  (RMTP.auth.pendingUsers ? RMTP.auth.pendingUsers() : []).forEach((u) => {
    const ap = el.querySelector('[data-approve="' + u.id + '"]'); if (ap) ap.addEventListener('click', () => { RMTP.auth.approveUser(u.id); ui.toast(RMTP.auth.displayName(u) + ' approved', 'ok'); RMTP.router.render(); });
    const rj = el.querySelector('[data-reject="' + u.id + '"]'); if (rj) rj.addEventListener('click', async () => {
      const ok = await ui.confirm('Reject and delete ' + RMTP.auth.displayName(u) + '\u2019s request?', { title: 'Reject request', confirmLabel: 'Reject', danger: true });
      if (ok) { RMTP.auth.rejectUser(u.id); ui.toast('Request rejected', 'ok'); RMTP.router.render(); }
    });
  });
};
