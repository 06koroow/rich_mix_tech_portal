/* ============================================================
   views/dashboard.js — landing / at-a-glance
   ============================================================ */
RMTP.views.dashboard = function (el) {
  const ui = RMTP.ui, store = RMTP.store;

  const cards = [
    { id: 'advancing',   desc: 'Gather show info, assign techs and file shift reports.',
      stat: () => store.all('advancing').length, unit: 'events' },
    { id: 'inventory',   desc: 'Scan kit in and out; track where everything lives.',
      stat: () => store.all('inventory').filter((r) => r.status === 'out').length, unit: 'signed out' },
    { id: 'maintenance', desc: 'Log faults and track repairs across the venue.',
      stat: () => store.all('maintenance').filter((r) => r.status === 'Open').length, unit: 'open' },
    { id: 'procedures',  desc: 'Operating procedures & SOPs for the building.',
      stat: () => store.all('procedures').reduce((n, c) => n + c.items.length, 0), unit: 'documents' },
    { id: 'users',       desc: 'Manage the team, roles and training sign-off.',
      stat: () => store.all('users').length, unit: 'users' },
  ].sort((a, b) => {
    const navA = RMTP.nav.find((n) => n.id === a.id);
    const navB = RMTP.nav.find((n) => n.id === b.id);
    return (navA ? navA.label : a.id).localeCompare(navB ? navB.label : b.id);
  });

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
    const allInv = store.all('inventory');
    const flagged = allInv.filter((it) => RMTP.isPoorCondition(it.condition) || openFaultIds.has(it.id)).length;
    const displaced = allInv.filter((it) => !it.static && it.homeLocation && it.location && it.location !== it.homeLocation).length;
    if (!moves.length && !flagged && !displaced) return '';
    return '<div class="panel p-5 mt-4 md:mt-8">' +
      '<div class="flex items-center justify-between mb-3 flex-wrap gap-2">' +
        '<div class="flex items-center gap-2">' +
          '<p class="eyebrow">Recent kit movements</p>' +
          (displaced ? '<a href="#/inventory?filter=moved" class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 transition-colors">' + displaced + ' relocated</a>' : '') +
        '</div>' +
        '<div class="flex items-center gap-3">' +
          (displaced ? '<a href="#/inventory?filter=moved" class="text-xs text-accent hover:underline flex items-center gap-1">' + ui.icon('pin', 'w-3.5 h-3.5') + 'Moved Kit \u2192</a>' : '') +
          (flagged ? '<a href="#/maintenance" class="text-xs" style="color:var(--danger)">' + ui.icon('alert', 'w-3.5 h-3.5 inline') + ' ' + flagged + ' flagged</a>' : '') +
        '</div>' +
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
    const today = new Date().toISOString().slice(0, 10);
    const myAdvances = store.all('advancing')
      .filter((e) => RMTP.eventAssignedTo(e, me.id) && e.status !== 'Complete' && e.category !== 'DCP Test' && e.category !== 'Maintenance')
      .filter((e) => !e.date || String(e.date).slice(0, 10) >= today)
      .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));

    // DCP Tests: both dedicated 'DCP Test' shifts and screenings with scheduled DCP test
    const allAdv = store.all('advancing');
    const myDcpTests = allAdv
      .filter((e) => {
        const isTester = (e.dcp_tester_user_id === me.id || e.dcpTesterUserId === me.id || RMTP.eventAssignedTo(e, me.id));
        const isDcpCategory = e.category === 'DCP Test';
        const hasTime = !!(e.dcp_test_datetime || e.dcpTestDatetime || (isDcpCategory && e.date));
        const isChecked = (e.checks_completed !== undefined ? !!e.checks_completed : !!e.checksCompleted);
        const matchesUser = me.admin ? true : isTester;
        const notPast = !e.date || String(e.date).slice(0, 10) >= today;
        return (isDcpCategory || (hasTime && isTester)) && !isChecked && e.status !== 'Complete' && matchesUser && notPast;
      })
      .sort((a, b) => {
        const timeA = a.dcp_test_datetime || a.dcpTestDatetime || a.date || '';
        const timeB = b.dcp_test_datetime || b.dcpTestDatetime || b.date || '';
        return timeA.localeCompare(timeB);
      });

    // Scheduled Maintenance Shifts
    const myMaintenanceShifts = allAdv
      .filter((e) => {
        const isMaint = e.category === 'Maintenance' || (Array.isArray(e.linked_maintenance_ids) && e.linked_maintenance_ids.length > 0);
        const matchesUser = me.admin ? true : RMTP.eventAssignedTo(e, me.id);
        const notPast = !e.date || String(e.date).slice(0, 10) >= today;
        return isMaint && matchesUser && e.status !== 'Complete' && notPast;
      })
      .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));

    // High priority / open maintenance faults
    const openFaults = store.all('maintenance')
      .filter((f) => f.status === 'Open' && (f.priority === 'Urgent' || f.priority === 'High'))
      .slice(0, 4);

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

    if (myDcpTests.length) {
      const nowIso = new Date().toISOString();
      sections.push('<div>' +
        '<div class="flex items-center justify-between gap-2 mb-2.5">' +
          '<div class="flex items-center gap-2">' +
            ui.icon('film', 'w-4 h-4 text-accent') +
            '<p class="eyebrow text-ink font-semibold">Scheduled DCP Tests \u00b7 ' + myDcpTests.length + '</p>' +
          '</div>' +
          '<span class="text-[11px] text-accent font-medium">Screening QA</span>' +
        '</div>' +
        '<div class="grid gap-2">' + myDcpTests.map((e) => {
          const testTime = e.dcp_test_datetime || e.dcpTestDatetime || (e.date ? e.date + (e.startTime ? 'T' + e.startTime : '') : '');
          const isOverdue = testTime && testTime < nowIso.slice(0, 16);
          const formattedTime = testTime ? (testTime.includes('T') ? new Date(testTime).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : ui.formatDate(testTime)) : 'TBC';
          const media = e.media_type || e.mediaType || 'DCP';
          const dcpRcvd = e.dcp_received !== undefined ? !!e.dcp_received : !!e.dcpReceived;

          return (
            '<div class="p-3 rounded-xl bg-panel2/60 border border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-accent/40 transition-colors">' +
              '<div class="min-w-0 flex-1">' +
                '<div class="flex items-center gap-2 flex-wrap mb-1">' +
                  '<span class="font-semibold text-sm text-ink">' + ui.esc(e.name) + '</span>' +
                  ui.pill(e.space || 'Cinema', 'var(--accent)') +
                  ui.pill('DCP Test', 'var(--info)') +
                  (dcpRcvd ? '<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-ok/15 text-ok border border-ok/30">DCP Received</span>'
                           : '<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-warning/15 text-warning border border-warning/30">DCP Pending</span>') +
                '</div>' +
                '<div class="flex items-center gap-2.5 text-xs text-muted flex-wrap">' +
                  '<span class="flex items-center gap-1 ' + (isOverdue ? 'text-danger font-semibold' : 'text-ink') + '">' +
                    ui.icon('clock', 'w-3.5 h-3.5 ' + (isOverdue ? 'text-danger' : 'text-accent')) +
                    'Test scheduled: ' + ui.esc(formattedTime) + (isOverdue ? ' (Overdue)' : '') +
                  '</span>' +
                  (e.date ? '<span class="w-1 h-1 rounded-full bg-line"></span><span>Date: ' + ui.formatDate(e.date) + '</span>' : '') +
                '</div>' +
              '</div>' +
              '<div class="flex items-center gap-2 shrink-0 self-end sm:self-center">' +
                '<a href="#/advancing/' + encodeURIComponent(e.id) + '" class="btn btn-ghost !py-1.5 !px-2.5 text-xs">View Advance</a>' +
                '<button data-complete-dcp="' + e.id + '" class="btn btn-primary !py-1.5 !px-3 text-xs flex items-center gap-1.5">' +
                  ui.icon('check', 'w-3.5 h-3.5') + '<span>Complete Test</span>' +
                '</button>' +
              '</div>' +
            '</div>'
          );
        }).join('') + '</div></div>');
    }

    if (myMaintenanceShifts.length) {
      sections.push('<div>' +
        '<div class="flex items-center justify-between gap-2 mb-2.5">' +
          '<div class="flex items-center gap-2">' +
            ui.icon('wrench', 'w-4 h-4 text-warning') +
            '<p class="eyebrow text-ink font-semibold">Scheduled Maintenance Shifts \u00b7 ' + myMaintenanceShifts.length + '</p>' +
          '</div>' +
          '<a href="#/maintenance" class="text-[11px] text-accent hover:underline">Maintenance Board \u2192</a>' +
        '</div>' +
        '<div class="grid gap-2">' + myMaintenanceShifts.map((e) => {
          const linkedTasks = Array.isArray(e.linked_maintenance_ids) ? e.linked_maintenance_ids : (Array.isArray(e.linkedMaintenanceIds) ? e.linkedMaintenanceIds : []);
          const times = [e.startTime, e.finishTime].filter(Boolean).join(' \u2013 ');
          return (
            '<div class="p-3 rounded-xl bg-panel2/60 border border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-accent/40 transition-colors">' +
              '<div class="min-w-0 flex-1">' +
                '<div class="flex items-center gap-2 flex-wrap mb-1">' +
                  '<span class="font-semibold text-sm text-ink">' + ui.esc(e.name) + '</span>' +
                  ui.pill('Maintenance Shift', 'var(--warning)') +
                  (e.space ? ui.pill(e.space, 'var(--muted)') : '') +
                  (linkedTasks.length ? '<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-accent/15 text-accent border border-accent/30">' + linkedTasks.length + ' task' + (linkedTasks.length === 1 ? '' : 's') + ' linked</span>' : '') +
                '</div>' +
                '<div class="flex items-center gap-2.5 text-xs text-muted flex-wrap">' +
                  '<span class="flex items-center gap-1 text-ink font-medium">' +
                    ui.icon('clock', 'w-3.5 h-3.5 text-accent') +
                    (e.date ? ui.formatDate(e.date) : 'Date TBC') + (times ? ' (' + times + ')' : '') +
                  '</span>' +
                  (e.techInfo ? '<span class="w-1 h-1 rounded-full bg-line"></span><span class="truncate max-w-xs">' + ui.esc(e.techInfo) + '</span>' : '') +
                '</div>' +
              '</div>' +
              '<div class="flex items-center gap-2 shrink-0 self-end sm:self-center">' +
                '<a href="#/advancing/' + encodeURIComponent(e.id) + '" class="btn btn-ghost !py-1.5 !px-2.5 text-xs">View Shift</a>' +
                '<a href="#/maintenance" class="btn btn-primary !py-1.5 !px-3 text-xs flex items-center gap-1.5">' +
                  ui.icon('wrench', 'w-3.5 h-3.5') + '<span>Open Tasks</span>' +
                '</a>' +
              '</div>' +
            '</div>'
          );
        }).join('') + '</div></div>');
    }

    if (openFaults.length) {
      sections.push('<div>' +
        '<div class="flex items-center justify-between gap-2 mb-2">' +
          '<div class="flex items-center gap-2">' +
            ui.icon('alert', 'w-4 h-4 text-danger') +
            '<p class="eyebrow text-danger font-semibold">Priority Faults Needing Attention \u00b7 ' + openFaults.length + '</p>' +
          '</div>' +
          '<a href="#/maintenance" class="text-[11px] text-accent hover:underline">All Faults \u2192</a>' +
        '</div>' +
        '<div class="grid gap-1.5">' + openFaults.map((f) => (
          '<a href="#/maintenance" class="flex items-center justify-between gap-3 text-sm p-2 rounded-lg bg-panel2/40 border border-line hover:border-accent transition-colors">' +
            '<div class="min-w-0 truncate">' +
              '<span class="font-medium text-ink">' + ui.esc(f.equipment || 'Kit fault') + '</span>' +
              (f.space ? '<span class="text-muted text-xs"> \u00b7 ' + ui.esc(f.space) + '</span>' : '') +
            '</div>' +
            '<div class="flex items-center gap-2 shrink-0">' +
              '<span class="px-1.5 py-0.2 rounded text-[10px] font-semibold ' + (f.priority === 'Urgent' ? 'bg-danger/20 text-danger border border-danger/40' : 'bg-warning/20 text-warning border border-warning/40') + '">' + ui.esc(f.priority) + '</span>' +
              '<span class="text-xs text-accent font-medium flex items-center gap-1">' + ui.icon('arrowR', 'w-3.5 h-3.5') + '</span>' +
            '</div>' +
          '</a>'
        )).join('') + '</div></div>');
    }

    if (myAdvances.length) {
      sections.push('<div>' +
        '<div class="flex items-center gap-2 mb-2">' + ui.icon('clip', 'w-4 h-4 text-accent') +
          '<p class="eyebrow">Your advances \u00b7 ' + myAdvances.length + '</p></div>' +
        '<div class="grid gap-1.5">' + myAdvances.slice(0, 5).map((e) =>
          '<a href="#/advancing/' + encodeURIComponent(e.id) + '" class="flex items-center justify-between gap-3 text-sm p-2 rounded-lg bg-panel2/40 border border-line hover:border-accent hover:bg-panel2 transition-all group">' +
            '<div class="min-w-0 truncate flex items-center gap-2">' +
              '<span class="font-medium text-ink group-hover:text-accent transition-colors">' + ui.esc(e.name) + '</span>' +
              (e.space ? '<span class="text-muted text-xs"> \u00b7 ' + ui.esc(e.space) + '</span>' : '') +
            '</div>' +
            '<div class="flex items-center gap-2 shrink-0">' +
              '<span class="text-xs text-muted font-medium">' + (e.date ? ui.formatDate(e.date) : ui.esc(e.status)) + '</span>' +
              '<span class="text-muted group-hover:text-accent group-hover:translate-x-0.5 transition-all">' + ui.icon('arrowR', 'w-3.5 h-3.5') + '</span>' +
            '</div>' +
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
    if (me && !me.admin) list = list.filter((e) => RMTP.eventAssignedTo(e, me.id));
    return list.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  }
  function todayInner(list) {
    if (!list.length) return '<p class="text-sm text-muted">No shifts scheduled today.</p>';
    return '<div class="grid gap-1.5">' + list.map((e) => {
      const times = [e.startTime, e.finishTime].filter(Boolean).join(' \u2013 ');
      let who = '';
      if (me && me.admin) {
        const techs = RMTP.eventTechnicians(e);
        if (techs.length) {
          who = techs.map((t) => { const u = store.find('users', t.userId); return u ? RMTP.auth.displayName(u) : 'Unknown'; }).join(', ');
        }
      }
      return '<a href="#/advancing/' + encodeURIComponent(e.id) + '" class="flex items-center justify-between gap-3 text-sm p-2 rounded-lg bg-panel2/40 border border-line hover:border-accent hover:bg-panel2 transition-all group">' +
        '<div class="min-w-0 truncate flex items-center gap-2">' +
          '<span class="font-medium text-ink group-hover:text-accent transition-colors">' + ui.esc(e.name) + '</span>' +
          (e.space ? '<span class="text-muted text-xs"> \u00b7 ' + ui.esc(e.space) + '</span>' : '') +
          (who ? '<span class="text-muted text-xs"> \u00b7 ' + ui.esc(who) + '</span>' : '') +
        '</div>' +
        '<div class="flex items-center gap-2 shrink-0">' +
          '<span class="text-xs text-muted font-medium">' + ui.esc(times || e.status || '') + '</span>' +
          '<span class="text-muted group-hover:text-accent group-hover:translate-x-0.5 transition-all">' + ui.icon('arrowR', 'w-3.5 h-3.5') + '</span>' +
        '</div>' +
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
    return '<div class="panel p-5 mb-4 md:mb-8" style="border-color:color-mix(in srgb,var(--accent) 30%,var(--line))">' +
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
      ui.pageHeader('Rich Mix · ' + RMTP.meta.product, 'Good evening' + greetName) +
      '<p class="text-muted -mt-2 mb-6 md:mb-8 max-w-2xl text-sm md:text-base">Quick access to the building\u2019s technical operations. ' +
        'Pick a section to get started.</p>' +

      topPanel() +

      '<div class="hidden md:grid gap-4 sm:grid-cols-2 lg:grid-cols-3">' + cardHtml + '</div>' +

      movementsPanel() +
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

  (RMTP.auth.pendingUsers ? RMTP.auth.pendingUsers() : []).forEach((u) => {
    const ap = el.querySelector('[data-approve="' + u.id + '"]'); if (ap) ap.addEventListener('click', () => { RMTP.auth.approveUser(u.id); ui.toast(RMTP.auth.displayName(u) + ' approved', 'ok'); RMTP.router.render(); });
    const rj = el.querySelector('[data-reject="' + u.id + '"]'); if (rj) rj.addEventListener('click', async () => {
      const ok = await ui.confirm('Reject and delete ' + RMTP.auth.displayName(u) + '\u2019s request?', { title: 'Reject request', confirmLabel: 'Reject', danger: true });
      if (ok) { RMTP.auth.rejectUser(u.id); ui.toast('Request rejected', 'ok'); RMTP.router.render(); }
    });
  });

  // Complete DCP test quick action
  el.querySelectorAll('[data-complete-dcp]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const evId = btn.getAttribute('data-complete-dcp');
      const ev = store.find('advancing', evId);
      if (!ev) return;
      const ok = await ui.confirm('Mark DCP checks and testing as completed for \u201c' + ev.name + '\u201d?', {
        title: 'Complete DCP Test',
        confirmLabel: 'Mark Completed',
      });
      if (ok) {
        const updated = Object.assign({}, ev, {
          checks_completed: true,
          checksCompleted: true,
          dcp_received: true,
          dcpReceived: true
        });
        store.upsert('advancing', updated);
        ui.toast('DCP test marked as completed', 'ok');
        RMTP.router.render();
      }
    });
  });
};
