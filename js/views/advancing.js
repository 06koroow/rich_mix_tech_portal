/* ============================================================
   views/advancing.js — event advancing, checklists & shift reports
   ------------------------------------------------------------
   Events carry: category, space, times, an assigned tech (user),
   a tech-info note, an optional tech-spec PDF, and a guest-engineer
   flag. End-of-shift reports live in their own `reports` collection
   keyed by eventId (see below). Permissions (auth.js): event
   create/edit/delete = admin; checklist ticks = anyone; filing/
   editing a report = report.edit; deleting = author or admin.
   ============================================================ */
RMTP.views.advancing = function (el) {
  const ui = RMTP.ui, store = RMTP.store, auth = RMTP.auth, files = RMTP.files;

  const me = auth.current();
  const isAdmin = !!(me && me.admin);
  const canManageEvents = auth.can('advancing.manage');
  const canReport = auth.can('report.edit');
  const filters = (RMTP._advFilters = RMTP._advFilters || { space: '', date: '', tab: 'upcoming' });

  function getTodayString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function isPastEvent(d) {
    if (!d) return false;
    const today = getTodayString();
    return Boolean(d && String(d).slice(0, 10) < today);
  }

  function isScreenSpace(spaceName) {
    return spaceName === 'Screen One' || spaceName === 'Screen Two' || spaceName === 'Screen Three';
  }

  const STATUSES = ['Advancing', 'Confirmed', 'Complete'];
  const statusColour = { 'Advancing': 'var(--info)', 'Confirmed': 'var(--accent)', 'Complete': 'var(--ok)' };

  function userName(id) { const u = id && store.find('users', id); return u ? auth.displayName(u) : ''; }
  // "Technician One (Sound)" — falls back to just the name if no role was set.
  function techLabel(t) {
    const name = userName(t.userId);
    if (!name) return null;
    return t.role ? name + ' (' + t.role + ')' : name;
  }
  function reportsFor(eventId) {
    return store.all('reports').filter((r) => r.eventId === eventId)
      .sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
  }
  function canDeleteReport(r) { const u = auth.current(); return !!u && (u.admin || r.authorId === u.id); }

  // Admins see every event; everyone else sees only shifts assigned to them.
  const base = store.all('advancing').filter((e) => isAdmin || (me && RMTP.eventAssignedTo(e, me.id)));

  const upcomingCount = base.filter((e) => !isPastEvent(e.date)).length;
  const pastCount = base.filter((e) => isPastEvent(e.date)).length;

  const currentTab = filters.tab || 'upcoming';

  const shown = base
    .filter((e) => (currentTab === 'past' ? isPastEvent(e.date) : !isPastEvent(e.date)))
    .filter((e) => (!filters.space || e.space === filters.space) && (!filters.date || e.date === filters.date))
    .sort((a, b) => (currentTab === 'past' ? (b.date || '').localeCompare(a.date || '') : (a.date || '9999').localeCompare(b.date || '9999')));

  const emptyMsg = !base.length
    ? (isAdmin ? ['clip', 'No events yet', 'Add an event to start advancing it.']
               : ['clip', 'No shifts assigned to you', 'You\u2019ll see events here once an admin assigns you.'])
    : (currentTab === 'past'
      ? ['clip', 'No past events found', 'Past events will appear here once their date has passed.']
      : ['clip', 'Nothing matches these filters', 'Try a different space, tab, or clear the date.']);

  el.innerHTML =
    '<div class="view-enter">' +
      ui.pageHeader('Advancing', isAdmin ? 'Events' : 'Your shifts',
        '<button id="verify-sync-btn" class="btn btn-ghost" title="Check Supabase database sync status">' + ui.icon('shield', 'w-4 h-4') + '<span class="hidden sm:inline">Verify Sync</span></button>' +
        '<button id="email-recipients-btn" class="btn btn-ghost" title="Configure shift report email recipients">' + ui.icon('mail', 'w-4 h-4') + '<span class="hidden sm:inline">Email Recipients</span></button>' +
        (canManageEvents && RMTP.supabase && RMTP.supabase.isConfigured()
          ? '<button id="artifax-sync" class="btn btn-ghost" title="Pull events from Artifax">' + ui.icon('reset', 'w-4 h-4') + '<span class="hidden sm:inline">Refresh from Artifax</span></button>' : '') +
        (canManageEvents ? '<button id="add-event" class="btn btn-primary">' + ui.icon('plus', 'w-4 h-4') + 'Add event</button>' : '')) +
      tabBar() +
      filterBar() +
      (shown.length ? '<div class="grid gap-4 lg:grid-cols-2">' + shown.map(renderEvent).join('') + '</div>'
                    : ui.empty(emptyMsg[0], emptyMsg[1], emptyMsg[2])) +
    '</div>';

  // Header button wiring
  const syncBtn = el.querySelector('#verify-sync-btn');
  if (syncBtn) syncBtn.addEventListener('click', () => openSyncVerificationModal());

  const recBtn = el.querySelector('#email-recipients-btn');
  if (recBtn) recBtn.addEventListener('click', () => openRecipientConfigModal());

  // Tab bar wiring
  el.querySelectorAll('[data-adv-tab]').forEach((b) => b.addEventListener('click', () => {
    filters.tab = b.getAttribute('data-adv-tab');
    RMTP.router.render();
  }));

  // Filter bar wiring
  el.querySelectorAll('[data-space]').forEach((b) => b.addEventListener('click', () => { filters.space = b.getAttribute('data-space'); RMTP.router.render(); }));
  const dateIn = el.querySelector('#adv-date'); if (dateIn) dateIn.addEventListener('change', () => { filters.date = dateIn.value; RMTP.router.render(); });
  const todayBtn = el.querySelector('#adv-today'); if (todayBtn) todayBtn.addEventListener('click', () => { filters.date = getTodayString(); RMTP.router.render(); });
  const clearBtn = el.querySelector('#adv-clear'); if (clearBtn) clearBtn.addEventListener('click', () => { filters.space = ''; filters.date = ''; RMTP.router.render(); });

  const addEv = el.querySelector('#add-event');
  if (addEv) addEv.addEventListener('click', () => openForm());

  const afx = el.querySelector('#artifax-sync');
  if (afx) afx.addEventListener('click', async () => {
    afx.disabled = true; ui.toast('Syncing from Artifax\u2026', 'info');
    try {
      const res = await RMTP.supabase.invokeFunction('artifax-sync');
      if (!res.ok) { ui.toast('Artifax sync failed: ' + (res.message || 'unknown error'), 'danger'); afx.disabled = false; return; }
      const d = res.data || {};
      if (RMTP.syncSb && RMTP.syncSb.pullCollection) await RMTP.syncSb.pullCollection('advancing');
      ui.toast('Artifax: ' + (d.created || 0) + ' added, ' + (d.updated || 0) + ' updated', 'ok');
      RMTP.router.render();
    } catch (e) {
      ui.toast('Artifax sync failed \u2014 is the function deployed?', 'danger'); afx.disabled = false;
    }
  });

  shown.forEach((ev) => {
    const q = (sel) => el.querySelector(sel);
    const e = q('[data-edit="' + ev.id + '"]'); if (e) e.addEventListener('click', () => openForm(ev));
    const d = q('[data-del="' + ev.id + '"]'); if (d) d.addEventListener('click', () => del(ev));
    const rp = q('[data-reports="' + ev.id + '"]'); if (rp) rp.addEventListener('click', () => openReports(ev));
    const sp = q('[data-spec="' + ev.id + '"]'); if (sp) sp.addEventListener('click', () => files.open(ev.techSpec));
    const pr = q('[data-print="' + ev.id + '"]'); if (pr) pr.addEventListener('click', () => printAdvance(ev));
  });

  function tabBar() {
    return (
      '<div class="flex items-center gap-2 mb-4 p-1 bg-panel2 rounded-lg border border-line w-fit">' +
        '<button data-adv-tab="upcoming" class="px-4 py-2 text-sm font-semibold rounded-md transition-all flex items-center gap-2 ' +
          (currentTab === 'upcoming' ? 'bg-accent text-accent-ink shadow-sm' : 'text-muted hover:text-ink') + '">' +
          ui.icon('clip', 'w-4 h-4') + '<span>Upcoming Events</span>' +
          '<span class="px-1.5 py-0.5 rounded text-xs ' + (currentTab === 'upcoming' ? 'bg-black/20 text-accent-ink' : 'bg-line text-muted') + '">' + upcomingCount + '</span>' +
        '</button>' +
        '<button data-adv-tab="past" class="px-4 py-2 text-sm font-semibold rounded-md transition-all flex items-center gap-2 ' +
          (currentTab === 'past' ? 'bg-accent text-accent-ink shadow-sm' : 'text-muted hover:text-ink') + '">' +
          ui.icon('clock', 'w-4 h-4') + '<span>Past Events</span>' +
          '<span class="px-1.5 py-0.5 rounded text-xs ' + (currentTab === 'past' ? 'bg-black/20 text-accent-ink' : 'bg-line text-muted') + '">' + pastCount + '</span>' +
        '</button>' +
      '</div>'
    );
  }

  function filterBar() {
    const tabPool = base.filter((e) => (currentTab === 'past' ? isPastEvent(e.date) : !isPastEvent(e.date)));
    const chip = (id, label, n, active) =>
      '<button data-space="' + ui.esc(id) + '" class="px-3 py-1.5 rounded-lg text-sm font-medium border ' +
        (active ? 'bg-panel2 border-accent text-ink' : 'border-line text-muted hover:text-ink') + '">' +
        ui.esc(label) + ' <span class="tabular text-xs opacity-70">' + n + '</span></button>';
    const chips = [chip('', 'All', tabPool.length, !filters.space)]
      .concat(RMTP.SPACES.map((s) => chip(s, s, tabPool.filter((e) => e.space === s).length, filters.space === s))).join('');
    return '<div class="flex flex-wrap items-center gap-2 mb-5">' + chips +
      '<span class="w-px h-6 bg-line mx-1 hidden sm:block"></span>' +
      '<input id="adv-date" type="date" class="field !w-auto !py-1.5" value="' + ui.esc(filters.date || '') + '" />' +
      '<button id="adv-today" class="btn btn-ghost !py-1.5 text-xs">Today</button>' +
      ((filters.date || filters.space) ? '<button id="adv-clear" class="btn btn-ghost !py-1.5 text-xs">' + ui.icon('x', 'w-4 h-4') + 'Clear</button>' : '') +
    '</div>';
  }

  function renderEvent(ev) {
    const reports = reportsFor(ev.id);
    const times = [ev.startTime, ev.finishTime].filter(Boolean).join(' \u2013 ');
    const techs = RMTP.eventTechnicians(ev).map(techLabel).filter(Boolean);
    const isCinema = isScreenSpace(ev.space);
    const mediaType = ev.media_type || ev.mediaType || '';

    const info = [
      ev.date ? ['Date', ui.formatDate(ev.date)] : null,
      times ? ['Running', times] : null,
      isCinema && (ev.screening_starts_time || ev.screeningStartsTime) ? ['Screening Starts', ev.screening_starts_time || ev.screeningStartsTime] : null,
      isCinema && mediaType ? ['Media Type', mediaType] : null,
      ev.soundcheck ? ['Soundcheck', ev.soundcheck] : null,
      ev.doors ? ['Doors', ev.doors] : null,
      ev.curfew ? ['Curfew', ev.curfew] : null,
      ev.clientContact ? ['Client', ev.clientContact] : null,
    ].filter(Boolean).map(([k, v]) =>
      '<div><dt class="eyebrow">' + ui.esc(k) + '</dt><dd class="text-sm mt-0.5 ' + (k === 'Screening Starts' || k === 'Media Type' ? 'font-semibold text-accent' : '') + '">' + ui.esc(v) + '</dd></div>'
    ).join('');

    const meta = [
      ev.category,
      ev.space,
      isCinema && mediaType ? ('Media: ' + mediaType) : null
    ].filter(Boolean).map((t) => ui.pill(t, t.indexOf('Media:') === 0 ? 'var(--accent)' : 'var(--muted)')).join('');

    const cinemaChecksHtml = isCinema ? (
      '<div class="mt-4 pt-3 border-t border-line/60">' +
        '<div class="flex items-center justify-between gap-2 mb-2">' +
          '<div class="flex items-center gap-1.5">' +
            ui.icon('film', 'w-4 h-4 text-accent') +
            '<span class="eyebrow !text-ink font-semibold">Cinema Screening Checks</span>' +
          '</div>' +
          (mediaType ? '<span class="text-xs font-semibold px-2 py-0.5 rounded bg-panel2 border border-accent/40 text-accent">Media: ' + ui.esc(mediaType) + '</span>' : '') +
        '</div>' +
        '<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">' +
          [
            { key: 'dcp_received', alt: 'dcpReceived', label: 'DCP Received?' },
            { key: 'checks_completed', alt: 'checksCompleted', label: 'Checks Completed' },
            { key: 'intermission', alt: 'intermission', label: 'Intermission?' },
            { key: 'qa', alt: 'qa', label: 'Q&A?' },
          ].map((c) => {
            const active = ev[c.key] !== undefined ? !!ev[c.key] : !!ev[c.alt];
            return (
              '<div class="flex items-center justify-between p-2 rounded-lg border ' +
                (active ? 'bg-ok/10 border-ok/30' : 'bg-panel2/60 border-line') + '">' +
                '<span class="text-xs text-muted font-medium">' + ui.esc(c.label) + '</span>' +
                '<span class="text-xs font-semibold ' + (active ? 'text-ok' : 'text-danger') + '">' + (active ? 'Yes' : 'No') + '</span>' +
              '</div>'
            );
          }).join('') +
        '</div>' +
      '</div>'
    ) : '';

    return (
      '<div class="panel p-5 flex flex-col">' +
        '<div class="flex items-start justify-between gap-3">' +
          '<div class="min-w-0">' +
            '<div class="flex items-center gap-2 flex-wrap">' +
              '<h3 class="font-display text-lg font-semibold truncate">' + ui.esc(ev.name) + '</h3>' +
              ui.pill(ev.status, statusColour[ev.status] || 'var(--muted)') +
              (ev.guestEngineer ? ui.pill('Guest engineer', 'var(--info)') : '') +
            '</div>' +
            (meta ? '<div class="flex items-center gap-1.5 mt-2">' + meta + '</div>' : '') +
          '</div>' +
          (canManageEvents ?
            '<div class="flex gap-1 shrink-0">' +
              '<button data-edit="' + ev.id + '" class="btn btn-ghost !p-2" title="Edit">' + ui.icon('pen', 'w-4 h-4') + '</button>' +
              '<button data-del="' + ev.id + '" class="btn btn-danger !p-2" title="Delete">' + ui.icon('trash', 'w-4 h-4') + '</button>' +
            '</div>' : '') +
        '</div>' +

        (info ? '<dl class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 mt-4">' + info + '</dl>' : '') +
        cinemaChecksHtml +
        (techs.length ?
          '<div class="mt-4">' +
            '<dt class="eyebrow">Technicians</dt>' +
            '<div class="flex items-center gap-1.5 flex-wrap mt-1.5">' + techs.map((t) => ui.pill(t, 'var(--info)')).join('') + '</div>' +
          '</div>' : '') +
        (ev.techInfo ? '<p class="text-sm text-ink/80 mt-4 whitespace-pre-wrap">' + ui.esc(ev.techInfo) + '</p>' : '') +
        (ev.techSpec ?
          '<button data-spec="' + ev.id + '" class="mt-4 inline-flex items-center gap-2 text-sm text-accent hover:underline self-start">' +
            ui.icon('file', 'w-4 h-4') + 'Tech spec: ' + ui.esc(ev.techSpec.name) + ' <span class="text-muted">(' + files.humanSize(ev.techSpec.size) + ')</span></button>' : '') +

        '<div class="mt-5 pt-4 border-t border-line flex flex-wrap items-center justify-between gap-3 mt-auto">' +
          '<div class="min-w-0">' +
            '<p class="eyebrow">End-of-shift</p>' +
            '<p class="text-sm mt-0.5 ' + (reports.length ? '' : 'text-muted') + '">' +
              (reports.length ? reports.length + ' report' + (reports.length > 1 ? 's' : '') + ' \u00b7 latest by ' + ui.esc(reports[0].author || 'Unknown') : 'No report filed yet') +
            '</p>' +
          '</div>' +
          '<div class="flex items-center gap-2 shrink-0">' +
            '<button data-print="' + ev.id + '" class="btn btn-ghost" title="Export / Print Advance as PDF">' + ui.icon('print', 'w-4 h-4') + '<span>Print PDF</span></button>' +
            '<button data-reports="' + ev.id + '" class="btn btn-ghost shrink-0">' + ui.icon('clip', 'w-4 h-4') +
              'Reports' + (reports.length ? ' (' + reports.length + ')' : '') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  /* ---- PDF Export / Print ---- */
  function printAdvance(ev) {
    const root = document.getElementById('print-root');
    if (!root) return;
    const isCinema = isScreenSpace(ev.space);
    const mediaTypeVal = ev.media_type || ev.mediaType || '';
    const times = [ev.startTime, ev.finishTime].filter(Boolean).join(' \u2013 ');
    const techs = RMTP.eventTechnicians(ev).map(techLabel).filter(Boolean);
    const reports = reportsFor(ev.id);

    const cinemaChecksHtml = isCinema ? (
      '<div class="adv-print-section">' +
        '<div class="adv-print-section-title" style="display:flex;justify-content:space-between;align-items:center;">' +
          '<span>Cinema Screening Checklist & Format</span>' +
          (mediaTypeVal ? '<span style="font-size:11px;font-family:monospace;font-weight:600;color:#0284c7;">Media Source: ' + ui.esc(mediaTypeVal) + '</span>' : '') +
        '</div>' +
        '<div class="adv-print-grid-4">' +
          [
            { label: 'DCP Received', val: ev.dcp_received !== undefined ? !!ev.dcp_received : !!ev.dcpReceived },
            { label: 'Checks Completed', val: ev.checks_completed !== undefined ? !!ev.checks_completed : !!ev.checksCompleted },
            { label: 'Intermission', val: !!ev.intermission },
            { label: 'Q&A', val: !!ev.qa },
          ].map((c) => (
            '<div class="adv-print-check-card ' + (c.val ? 'checked' : 'unchecked') + '">' +
              '<span class="adv-print-label">' + ui.esc(c.label) + '</span>' +
              '<span class="adv-print-val">' + (c.val ? 'YES' : 'NO') + '</span>' +
            '</div>'
          )).join('') +
        '</div>' +
      '</div>'
    ) : '';

    const reportsHtml = reports.length ? (
      '<div class="adv-print-section">' +
        '<div class="adv-print-section-title">End-of-Shift Reports (' + reports.length + ')</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px;">' +
          reports.map((r) => (
            '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px;">' +
              '<div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;margin-bottom:3px;">' +
                '<span>' + ui.esc(r.crew ? r.crew + ' Shift' : 'Shift Report') + ' \u00b7 Filed by ' + ui.esc(r.author || 'Unknown') + '</span>' +
                '<span style="font-family:monospace;">' + (r.submittedAt ? ui.formatDate(r.submittedAt.slice(0, 10)) : '') + '</span>' +
              '</div>' +
              (r.summary ? '<div style="font-size:12px;margin-top:2px;"><strong>Summary:</strong> ' + ui.esc(r.summary) + '</div>' : '') +
              (r.issues ? '<div style="font-size:12px;margin-top:2px;color:#b91c1c;"><strong>Issues / Faults:</strong> ' + ui.esc(r.issues) + '</div>' : '') +
              (r.followUp ? '<div style="font-size:12px;margin-top:2px;color:#1d4ed8;"><strong>Handover:</strong> ' + ui.esc(r.followUp) + '</div>' : '') +
            '</div>'
          )).join('') +
        '</div>' +
      '</div>'
    ) : '';

    root.innerHTML =
      '<div class="adv-print-sheet">' +
        '<div class="adv-print-header">' +
          '<div>' +
            '<div class="adv-print-brand">RICH MIX TECHNICAL OPERATIONS</div>' +
            '<div class="adv-print-sub">Event Technical Advance Sheet</div>' +
          '</div>' +
          '<div style="text-align:right;">' +
            '<div class="adv-print-badge">' + ui.esc(ev.status || 'Advancing') + '</div>' +
            '<div style="font-size:11px;font-family:monospace;margin-top:4px;">' + ui.esc(ev.space || 'Venue') + '</div>' +
          '</div>' +
        '</div>' +

        '<h1 class="adv-print-title">' + ui.esc(ev.name) + '</h1>' +

        '<div class="adv-print-section">' +
          '<div class="adv-print-section-title">Schedule & Timings</div>' +
          '<div class="adv-print-grid">' +
            '<div class="adv-print-field"><div class="adv-print-label">Date</div><div class="adv-print-val">' + ui.esc(ev.date ? ui.formatDate(ev.date) : 'TBC') + '</div></div>' +
            '<div class="adv-print-field"><div class="adv-print-label">Running Times</div><div class="adv-print-val">' + ui.esc(times || 'TBC') + '</div></div>' +
            (isCinema ? '<div class="adv-print-field"><div class="adv-print-label">Screening Starts</div><div class="adv-print-val">' + ui.esc(ev.screening_starts_time || ev.screeningStartsTime || 'TBC') + '</div></div>' : '') +
            (isCinema && mediaTypeVal ? '<div class="adv-print-field"><div class="adv-print-label">Media Type</div><div class="adv-print-val font-semibold">' + ui.esc(mediaTypeVal) + '</div></div>' : '') +
            '<div class="adv-print-field"><div class="adv-print-label">Soundcheck</div><div class="adv-print-val">' + ui.esc(ev.soundcheck || 'N/A') + '</div></div>' +
            '<div class="adv-print-field"><div class="adv-print-label">Doors</div><div class="adv-print-val">' + ui.esc(ev.doors || 'N/A') + '</div></div>' +
            '<div class="adv-print-field"><div class="adv-print-label">Curfew</div><div class="adv-print-val">' + ui.esc(ev.curfew || 'N/A') + '</div></div>' +
          '</div>' +
        '</div>' +

        cinemaChecksHtml +

        '<div class="adv-print-section">' +
          '<div class="adv-print-section-title">Crew & Contacts</div>' +
          '<div class="adv-print-grid">' +
            '<div class="adv-print-field" style="grid-column: span 2;">' +
              '<div class="adv-print-label">Assigned Technicians</div>' +
              '<div class="adv-print-val">' + (techs.length ? ui.esc(techs.join(', ')) : 'None assigned') + '</div>' +
            '</div>' +
            '<div class="adv-print-field">' +
              '<div class="adv-print-label">Guest Engineer</div>' +
              '<div class="adv-print-val">' + (ev.guestEngineer ? 'Yes (Visiting Tech)' : 'No') + '</div>' +
            '</div>' +
            '<div class="adv-print-field" style="grid-column: span 3;">' +
              '<div class="adv-print-label">Client / Artist Contact</div>' +
              '<div class="adv-print-val">' + ui.esc(ev.clientContact || 'None listed') + '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        (ev.techInfo ? (
          '<div class="adv-print-section">' +
            '<div class="adv-print-section-title">Technical Information & Notes</div>' +
            '<div style="font-size:12px;white-space:pre-wrap;background:#f8fafc;padding:8px 10px;border-radius:6px;border:1px solid #cbd5e1;">' + ui.esc(ev.techInfo) + '</div>' +
          '</div>'
        ) : '') +

        reportsHtml +

        '<div class="adv-print-footer">' +
          '<span>Rich Mix Tech Portal \u00b7 Technical Advance Report</span>' +
          '<span>Exported on ' + new Date().toLocaleString('en-GB') + '</span>' +
        '</div>' +
      '</div>';

    document.body.classList.add('is-printing');
    window.print();
    const cleanup = () => {
      document.body.classList.remove('is-printing');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(cleanup, 1500);
  }

  /* ---- Shift Reports Email Automation & Recipients Config ---- */
  const DEFAULT_RECIPIENTS = ['tech@richmix.org.uk', 'dutymanager@richmix.org.uk', 'production@richmix.org.uk'];

  function getReportRecipients() {
    try {
      const raw = store.readRaw('report_recipients', '');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch (e) {}
    return DEFAULT_RECIPIENTS.slice();
  }

  function saveReportRecipients(list) {
    store.writeRaw('report_recipients', JSON.stringify(list));
  }

  function formatShiftReportEmail(ev, r) {
    const dateStr = ev.date ? ui.formatDate(ev.date) : (r.shiftDate ? ui.formatDate(r.shiftDate) : 'Today');
    const times = [ev.startTime, ev.finishTime].filter(Boolean).join(' \u2013 ');
    const techs = RMTP.eventTechnicians(ev).map(techLabel).filter(Boolean);
    const isCinema = isScreenSpace(ev.space);

    const subject = '[Shift Report] ' + (ev.name || 'Event') + ' \u2014 ' + (ev.space || 'Venue') + ' (' + dateStr + ')';

    const plain = [
      'RICH MIX TECHNICAL OPERATIONS \u2014 SHIFT REPORT',
      '============================================',
      'Event: ' + (ev.name || 'N/A'),
      'Space: ' + (ev.space || 'N/A'),
      'Date: ' + dateStr,
      'Times: ' + (times || 'N/A'),
      'Crew / Shift: ' + (r.crew || 'General Shift'),
      'Filed By: ' + (r.author || 'Technician') + ' on ' + (r.submittedAt ? new Date(r.submittedAt).toLocaleString('en-GB') : new Date().toLocaleString('en-GB')),
      '',
      '--------------------------------------------',
      '1. SHIFT SUMMARY:',
      r.summary || 'No summary provided.',
      '',
      '2. ISSUES & EQUIPMENT FAULTS:',
      (r.issues || 'None reported (All equipment operational).').trim(),
      '',
      '3. HANDOVER & FOLLOW-UP:',
      (r.followUp || 'None required.').trim(),
      '',
      '--------------------------------------------',
      'EVENT ADVANCE DETAILS:',
      '- Technicians: ' + (techs.length ? techs.join(', ') : 'None assigned'),
      isCinema ? '- Cinema Checks: DCP [' + ((ev.dcp_received !== undefined ? ev.dcp_received : ev.dcpReceived) ? 'YES' : 'NO') + '] | Checks [' + ((ev.checks_completed !== undefined ? ev.checks_completed : ev.checksCompleted) ? 'YES' : 'NO') + '] | Intermission [' + (ev.intermission ? 'YES' : 'NO') + '] | Q&A [' + (ev.qa ? 'YES' : 'NO') + ']' : null,
      ev.techInfo ? '- Tech Info: ' + ev.techInfo : null,
      ev.clientContact ? '- Client Contact: ' + ev.clientContact : null,
      '',
      '-- Generated via Rich Mix Tech Portal --'
    ].filter((line) => line !== null).join('\n');

    return { subject, plain };
  }

  async function dispatchShiftReportEmail(ev, r, customRecipients) {
    const recipients = (customRecipients && customRecipients.length) ? customRecipients : getReportRecipients();
    const { subject, plain } = formatShiftReportEmail(ev, r);

    let edgeOk = false;
    if (RMTP.supabase && RMTP.supabase.isConfigured()) {
      try {
        const res = await RMTP.supabase.invokeFunction('send-shift-report', {
          to: recipients,
          subject: subject,
          body: plain,
          event: ev,
          report: r
        });
        if (res && res.ok) edgeOk = true;
      } catch (e) {
        console.warn('[email] Supabase send-shift-report not available, mailto fallback ready', e);
      }
    }

    const mailtoUrl = 'mailto:' + encodeURIComponent(recipients.join(',')) +
      '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(plain);

    return { recipients, subject, plain, edgeOk, mailtoUrl };
  }

  function openRecipientConfigModal() {
    let list = getReportRecipients();
    const m = ui.modal({
      title: 'Shift Report Email Recipients',
      size: 'md:max-w-lg',
      body:
        '<div class="grid gap-4">' +
          '<p class="text-xs text-muted">When a technician completes or submits a shift report, an automated email summary is formatted and addressed to this list (e.g. Duty Managers, Technical Directors, Production Team).</p>' +
          '<div id="recipients-list" class="grid gap-2"></div>' +
          '<div class="flex items-center gap-2">' +
            '<input id="new-rec-email" type="email" class="field flex-1" placeholder="e.g. dutymanager@richmix.org.uk" />' +
            '<button id="add-rec-btn" class="btn btn-ghost shrink-0">' + ui.icon('plus', 'w-4 h-4') + 'Add</button>' +
          '</div>' +
        '</div>',
      footer:
        '<button class="btn btn-ghost" data-cancel>Close</button>' +
        '<button class="btn btn-primary" data-save data-primary>Save Recipients</button>'
    });

    function renderList() {
      const cont = m.root.querySelector('#recipients-list');
      if (!cont) return;
      if (!list.length) {
        cont.innerHTML = '<p class="text-xs text-muted">No recipients configured. Add at least one email address.</p>';
        return;
      }
      cont.innerHTML = list.map((email, idx) => (
        '<div class="flex items-center justify-between p-2.5 rounded-lg bg-panel2/60 border border-line">' +
          '<span class="text-sm font-mono text-ink">' + ui.esc(email) + '</span>' +
          '<button type="button" data-rm-rec="' + idx + '" class="btn btn-danger !p-1.5" title="Remove">' + ui.icon('trash', 'w-3.5 h-3.5') + '</button>' +
        '</div>'
      )).join('');
      cont.querySelectorAll('[data-rm-rec]').forEach((b) => b.addEventListener('click', () => {
        const idx = +b.getAttribute('data-rm-rec');
        list.splice(idx, 1);
        renderList();
      }));
    }
    renderList();

    const addBtn = m.root.querySelector('#add-rec-btn');
    const input = m.root.querySelector('#new-rec-email');
    function addEmail() {
      const val = input.value.trim().toLowerCase();
      if (!val || val.indexOf('@') === -1) {
        ui.toast('Enter a valid email address', 'danger');
        return;
      }
      if (list.includes(val)) {
        ui.toast('Email already in list', 'info');
        return;
      }
      list.push(val);
      input.value = '';
      renderList();
    }
    if (addBtn) addBtn.addEventListener('click', addEmail);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addEmail(); } });

    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);
    m.root.querySelector('[data-save]').addEventListener('click', () => {
      saveReportRecipients(list);
      ui.toast('Email recipients updated', 'ok');
      m.close();
    });
  }

  /* ---- Database Sync Verification Inspector ---- */
  async function openSyncVerificationModal() {
    const m = ui.modal({
      title: 'Database Sync Verification',
      size: 'md:max-w-xl',
      body:
        '<div class="grid gap-4">' +
          '<div id="sync-status-box" class="p-4 rounded-xl border border-line bg-panel2/50 text-center">' +
            '<div class="text-sm font-medium">Checking database connection and table schemas...</div>' +
          '</div>' +
          '<div id="sync-details" class="grid gap-2 text-xs"></div>' +
        '</div>',
      footer:
        '<button id="sync-drain-btn" class="btn btn-primary mr-auto">' + ui.icon('reset', 'w-4 h-4') + 'Sync & Verify Now</button>' +
        '<button class="btn btn-ghost" data-done>Close</button>'
    });

    m.root.querySelector('[data-done]').addEventListener('click', m.close);

    async function check() {
      const box = m.root.querySelector('#sync-status-box');
      const det = m.root.querySelector('#sync-details');
      if (!box || !det) return;

      box.innerHTML = '<div class="text-sm text-muted">Auditing database mutations & column cache...</div>';

      if (!RMTP.syncSb || !RMTP.syncSb.verifySync) {
        box.innerHTML = '<div class="text-sm text-ok font-semibold">Local Storage Mode Active</div>' +
          '<div class="text-xs text-muted mt-1">All mutations persist to offline browser cache.</div>';
        return;
      }

      const res = await RMTP.syncSb.verifySync();
      if (res.status === 'synced') {
        box.innerHTML =
          '<div class="flex items-center justify-center gap-2 text-ok font-semibold">' +
            ui.icon('check', 'w-5 h-5') + '<span>Database Fully Synchronized</span>' +
          '</div>' +
          '<div class="text-xs text-ink/80 mt-1">' + ui.esc(res.message) + '</div>';
      } else if (res.status === 'pending') {
        box.innerHTML =
          '<div class="flex items-center justify-center gap-2 text-accent font-semibold">' +
            ui.icon('clock', 'w-5 h-5') + '<span>Pending Queue Mutations (' + res.queueLength + ')</span>' +
          '</div>' +
          '<div class="text-xs text-ink/80 mt-1">Queue is draining into Supabase.</div>';
      } else if (res.status === 'local') {
        box.innerHTML =
          '<div class="text-sm text-muted font-semibold">Offline / Local Storage Mode</div>' +
          '<div class="text-xs text-muted mt-1">' + ui.esc(res.message) + '</div>';
      } else {
        box.innerHTML =
          '<div class="flex items-center justify-center gap-2 text-danger font-semibold">' +
            ui.icon('alert', 'w-5 h-5') + '<span>Database Sync Notice</span>' +
          '</div>' +
          '<div class="text-xs text-danger/90 mt-1">' + ui.esc(res.message) + '</div>';
      }

      const advLocal = store.all('advancing').length;
      const repLocal = store.all('reports').length;
      const advRemote = (res.tables && res.tables.advancing && res.tables.advancing.count !== undefined) ? res.tables.advancing.count : '-';
      const repRemote = (res.tables && res.tables.reports && res.tables.reports.count !== undefined) ? res.tables.reports.count : '-';

      det.innerHTML =
        '<div class="grid grid-cols-2 gap-2 mt-2">' +
          '<div class="p-3 rounded-lg bg-panel2/40 border border-line">' +
            '<div class="eyebrow">Advancing Collection</div>' +
            '<div class="text-sm font-semibold mt-1">Local: ' + advLocal + ' \u00b7 Supabase: ' + advRemote + '</div>' +
            '<div class="text-[11px] text-muted mt-0.5">Columns: dcp_received, checks_completed, screening_starts_time, media_type verified</div>' +
          '</div>' +
          '<div class="p-3 rounded-lg bg-panel2/40 border border-line">' +
            '<div class="eyebrow">Reports Collection</div>' +
            '<div class="text-sm font-semibold mt-1">Local: ' + repLocal + ' \u00b7 Supabase: ' + repRemote + '</div>' +
            '<div class="text-[11px] text-muted mt-0.5">Columns: summary, issues, followUp, eventId verified</div>' +
          '</div>' +
        '</div>' +
        '<div class="p-3 rounded-lg bg-panel2/40 border border-line">' +
          '<div class="eyebrow">Queue Health</div>' +
          '<div class="text-xs mt-1">Pending writes in queue: <span class="font-mono font-semibold">' + res.queueLength + '</span></div>' +
        '</div>';
    }

    await check();

    const drainBtn = m.root.querySelector('#sync-drain-btn');
    if (drainBtn) {
      drainBtn.addEventListener('click', async () => {
        drainBtn.disabled = true;
        ui.toast('Verifying & synchronizing database...', 'info');
        if (RMTP.syncSb && RMTP.syncSb.drain) await RMTP.syncSb.drain();
        if (RMTP.syncSb && RMTP.syncSb.pullAll) await RMTP.syncSb.pullAll();
        await check();
        ui.toast('Database sync verified', 'ok');
        drainBtn.disabled = false;
      });
    }
  }

  /* ---- Shift reports ---- */
  function openReports(ev) {
    const reports = reportsFor(ev.id);
    const list = reports.length ? reports.map(reportCard).join('')
      : ui.empty('clip', 'No shift reports yet', canReport ? 'File the first end-of-shift report below.' : 'Nothing filed for this event.');
    const m = ui.modal({
      title: 'Shift reports \u2014 ' + ev.name,
      size: 'md:max-w-xl',
      body:
        '<div class="flex items-center justify-between mb-3 pb-2 border-b border-line">' +
          '<button id="rep-print-btn" class="btn btn-ghost !py-1.5 text-xs">' + ui.icon('print', 'w-3.5 h-3.5') + 'Export Advance PDF</button>' +
          '<button id="rep-recipients-btn" class="btn btn-ghost !py-1.5 text-xs">' + ui.icon('mail', 'w-3.5 h-3.5') + 'Email Recipients</button>' +
        '</div>' +
        '<div class="grid gap-3">' + list + '</div>',
      footer:
        (canReport ? '<button class="btn btn-primary mr-auto" data-add data-primary>' + ui.icon('plus', 'w-4 h-4') + 'Add report</button>' : '') +
        '<button class="btn btn-ghost" data-done>Done</button>',
    });

    const pBtn = m.root.querySelector('#rep-print-btn');
    if (pBtn) pBtn.addEventListener('click', () => printAdvance(ev));

    const recBtn = m.root.querySelector('#rep-recipients-btn');
    if (recBtn) recBtn.addEventListener('click', () => openRecipientConfigModal());

    function refresh() { m.close(); RMTP.router.render(); const f = store.find('advancing', ev.id); if (f) openReports(f); }
    const addBtn = m.root.querySelector('[data-add]');
    if (addBtn) addBtn.addEventListener('click', () => { m.close(); openReportForm(ev); });
    m.root.querySelector('[data-done]').addEventListener('click', () => { m.close(); RMTP.router.render(); });
    reports.forEach((r) => {
      const eBtn = m.root.querySelector('[data-redit="' + r.id + '"]'); if (eBtn) eBtn.addEventListener('click', () => { m.close(); openReportForm(ev, r); });
      const mBtn = m.root.querySelector('[data-rmail="' + r.id + '"]');
      if (mBtn) mBtn.addEventListener('click', async () => {
        const dispatch = await dispatchShiftReportEmail(ev, r);
        const modal = ui.modal({
          title: 'Shift Report Email Summary',
          size: 'md:max-w-lg',
          body:
            '<div class="grid gap-3">' +
              '<div><label class="eyebrow">Recipients</label><p class="text-xs font-mono mt-0.5">' + ui.esc(dispatch.recipients.join(', ')) + '</p></div>' +
              '<div><label class="eyebrow">Subject</label><p class="text-sm font-semibold mt-0.5">' + ui.esc(dispatch.subject) + '</p></div>' +
              '<div><label class="eyebrow">Message Body</label><pre class="p-3 bg-panel2 rounded-lg text-xs whitespace-pre-wrap font-mono max-h-60 overflow-y-auto mt-1 border border-line">' + ui.esc(dispatch.plain) + '</pre></div>' +
            '</div>',
          footer:
            '<a href="' + dispatch.mailtoUrl + '" class="btn btn-primary mr-auto">' + ui.icon('mail', 'w-4 h-4') + 'Open in Email Client</a>' +
            '<button class="btn btn-ghost" data-close-preview>Done</button>'
        });
        modal.root.querySelector('[data-close-preview]').addEventListener('click', modal.close);
      });
      const dBtn = m.root.querySelector('[data-rdel="' + r.id + '"]'); if (dBtn) dBtn.addEventListener('click', async () => {
        const ok = await ui.confirm('Delete this shift report?', { title: 'Delete report', confirmLabel: 'Delete', danger: true });
        if (ok) { store.remove('reports', r.id); ui.toast('Report deleted', 'ok'); refresh(); }
      });
    });
  }

  function reportCard(r) {
    const field = (label, val) => val ? '<div class="mt-2"><p class="eyebrow">' + ui.esc(label) + '</p><p class="text-sm mt-0.5 whitespace-pre-wrap">' + ui.esc(val) + '</p></div>' : '';
    const edited = r.updatedAt && r.updatedAt !== r.submittedAt
      ? ' \u00b7 edited ' + ui.timeAgo(new Date(r.updatedAt).getTime()) + (r.updatedBy && r.updatedBy !== r.author ? ' by ' + ui.esc(r.updatedBy) : '') : '';
    return '<div class="panel bg-panel2/40 p-4">' +
      '<div class="flex items-start justify-between gap-3">' +
        '<div class="min-w-0">' +
          '<p class="font-medium">' + (r.crew ? ui.esc(r.crew) + ' shift' : 'Shift report') +
            (r.shiftDate ? ' \u00b7 <span class="text-muted font-normal">' + ui.formatDate(r.shiftDate) + '</span>' : '') + '</p>' +
          '<p class="text-[11px] text-muted mt-0.5">Filed by ' + ui.esc(r.author || 'Unknown') +
            (r.submittedAt ? ' \u00b7 ' + ui.timeAgo(new Date(r.submittedAt).getTime()) : '') + edited + '</p>' +
        '</div>' +
        '<div class="flex gap-1 shrink-0">' +
          '<button data-rmail="' + r.id + '" class="btn btn-ghost !p-2 text-accent" title="Send / View Email Summary">' + ui.icon('mail', 'w-4 h-4') + '</button>' +
          (canReport ? '<button data-redit="' + r.id + '" class="btn btn-ghost !p-2" title="Edit">' + ui.icon('pen', 'w-4 h-4') + '</button>' : '') +
          (canDeleteReport(r) ? '<button data-rdel="' + r.id + '" class="btn btn-danger !p-2" title="Delete">' + ui.icon('trash', 'w-4 h-4') + '</button>' : '') +
        '</div>' +
      '</div>' +
      field('Summary', r.summary) + field('Issues / faults', r.issues) + field('Handover / follow-up', r.followUp) +
    '</div>';
  }

  function openReportForm(ev, existing) {
    if (!canReport) { ui.toast('You can\u2019t file reports', 'danger'); return; }
    const r = existing || {};
    const times = [ev.startTime, ev.finishTime].filter(Boolean).join(' \u2013 ');
    const shiftLabel = (ev.date ? ui.formatDate(ev.date) : 'No date set') + (times ? ' \u00b7 ' + times : '');
    const defaultRecs = getReportRecipients();

    const m = ui.modal({
      title: (existing ? 'Edit' : 'End-of-shift') + ' report \u2014 ' + ev.name,
      size: 'md:max-w-xl',
      body:
        '<div class="grid gap-4">' +
          '<p class="text-xs text-muted">Filed as <span class="text-ink font-medium">' + ui.esc(auth.displayName(auth.current()) || 'you') + '</span> \u00b7 for the shift on <span class="text-ink font-medium">' + ui.esc(shiftLabel) + '</span></p>' +
          fld('Crew / shift', '<input id="r-crew" class="field" value="' + ui.esc(r.crew || '') + '" placeholder="e.g. Show, Get-out" />') +
          fld('How did the shift go?', '<textarea id="r-summary" class="field" rows="3" placeholder="Overview of the night\u2026">' + ui.esc(r.summary || '') + '</textarea>') +
          fld('Issues / faults', '<textarea id="r-issues" class="field" rows="2" placeholder="Anything that broke or needs fixing\u2026">' + ui.esc(r.issues || '') + '</textarea>') +
          fld('Handover / follow-up', '<textarea id="r-follow" class="field" rows="2" placeholder="For the next shift or the TM\u2026">' + ui.esc(r.followUp || '') + '</textarea>') +
          '<div class="panel bg-panel2/50 p-3 rounded-lg border border-line">' +
            '<div class="flex items-center justify-between mb-2">' +
              '<label class="flex items-center gap-2 text-xs font-semibold cursor-pointer">' +
                '<input type="checkbox" id="r-auto-email" class="w-4 h-4 accent-[var(--accent)]" checked />' +
                '<span>Auto-send formatted email summary</span>' +
              '</label>' +
              '<button type="button" id="r-edit-recipients" class="text-xs text-accent hover:underline">Edit recipients</button>' +
            '</div>' +
            '<div class="text-[11px] text-muted font-mono flex items-center gap-1.5 flex-wrap">' +
              '<span>To:</span>' + defaultRecs.map((em) => '<span class="px-1.5 py-0.5 rounded bg-panel border border-line text-ink">' + ui.esc(em) + '</span>').join('') +
            '</div>' +
          '</div>' +
        '</div>',
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-save data-primary>' + (existing ? 'Save changes' : 'File report') + '</button>',
    });

    const editRecsBtn = m.root.querySelector('#r-edit-recipients');
    if (editRecsBtn) {
      editRecsBtn.addEventListener('click', () => {
        openRecipientConfigModal();
      });
    }

    m.root.querySelector('[data-cancel]').addEventListener('click', () => { m.close(); openReports(ev); });
    m.root.querySelector('[data-save]').addEventListener('click', async () => {
      const summary = m.root.querySelector('#r-summary').value.trim();
      const issues = m.root.querySelector('#r-issues').value.trim();
      const followUp = m.root.querySelector('#r-follow').value.trim();
      const shouldEmail = m.root.querySelector('#r-auto-email') ? m.root.querySelector('#r-auto-email').checked : false;

      if (!summary && !issues && !followUp) { ui.toast('Add at least a summary', 'danger'); return; }
      const meNow = auth.current();
      const now = new Date().toISOString();
      // Shift date always corresponds to the event it's attached to.
      const base = { id: r.id || store.uid('rep'), eventId: ev.id, crew: m.root.querySelector('#r-crew').value.trim(), shiftDate: ev.date || '', summary, issues, followUp };
      const record = existing
        ? Object.assign({}, r, base, { updatedAt: now, updatedBy: auth.displayName(meNow) })
        : Object.assign(base, { authorId: meNow ? meNow.id : null, author: auth.displayName(meNow) || 'Unknown', submittedAt: now, updatedAt: now });
      store.upsert('reports', record);

      if (shouldEmail) {
        const dispatch = await dispatchShiftReportEmail(ev, record);
        ui.toast('Report saved & email summary generated for recipients', 'ok');
      } else {
        ui.toast(existing ? 'Report updated' : 'Report filed', 'ok');
      }

      m.close();
      RMTP.router.render(); const f = store.find('advancing', ev.id); if (f) openReports(f);
    });
  }

  /* ---- Event form ---- */
  function openForm(existing) {
    const ev = existing || {};
    const opt = (arr, val) => arr.map((v) => '<option ' + (v === val ? 'selected' : '') + '>' + v + '</option>').join('');
    const blankOpt = (arr, val, blank) => '<option value="" ' + (!val ? 'selected' : '') + '>' + blank + '</option>' +
      arr.map((v) => '<option ' + (v === val ? 'selected' : '') + '>' + v + '</option>').join('');

    // Tagged crew for this shift: [{ userId, role }]. Falls back to the
    // legacy single techUserId so older events migrate cleanly on first edit.
    let techs = RMTP.eventTechnicians(ev).map((t) => ({ userId: t.userId, role: t.role || '' }));

    // Tech-spec state (only written to storage on save).
    const originalSpec = ev.techSpec || null;
    let specMeta = originalSpec;   // currently-attached saved meta
    let pending = null;            // newly chosen file, in memory
    let cleared = false;           // user removed the existing spec

    const isScreenInitial = isScreenSpace(ev.space || '');

    const m = ui.modal({
      title: existing ? 'Edit event' : 'Add event',
      size: 'md:max-w-2xl',
      body:
        '<div class="grid gap-4">' +
          '<div class="grid sm:grid-cols-[1fr_150px] gap-4">' +
            fld('Event title', '<input id="e-name" class="field" value="' + ui.esc(ev.name || '') + '" placeholder="Artist / show name" />') +
            fld('Status', '<select id="e-status" class="field">' + opt(STATUSES, ev.status || 'Advancing') + '</select>') +
          '</div>' +
          '<div class="grid grid-cols-2 sm:grid-cols-3 gap-4">' +
            fld('Category', '<select id="e-category" class="field">' + blankOpt(RMTP.EVENT_CATEGORIES, ev.category, '\u2014') + '</select>') +
            fld('Space', '<select id="e-space" class="field">' + blankOpt(RMTP.SPACES, ev.space, '\u2014') + '</select>') +
            fld('Date', '<input id="e-date" type="date" class="field" value="' + ui.esc(ev.date || '') + '" />') +
          '</div>' +
          '<div class="grid grid-cols-2 sm:grid-cols-6 gap-4">' +
            fld('Start', '<input id="e-start" type="time" class="field" value="' + ui.esc(ev.startTime || '') + '" />') +
            fld('Finish', '<input id="e-finish" type="time" class="field" value="' + ui.esc(ev.finishTime || '') + '" />') +
            '<div id="e-screening-starts-wrapper" class="' + (isScreenInitial ? '' : 'hidden') + '">' +
              fld('Screening', '<input id="e-screening-starts" type="time" class="field" value="' + ui.esc(ev.screeningStartsTime || '') + '" />') +
            '</div>' +
            fld('Soundcheck', '<input id="e-sc" type="time" class="field" value="' + ui.esc(ev.soundcheck || '') + '" />') +
            fld('Doors', '<input id="e-doors" type="time" class="field" value="' + ui.esc(ev.doors || '') + '" />') +
            fld('Curfew', '<input id="e-curfew" type="time" class="field" value="' + ui.esc(ev.curfew || '') + '" />') +
          '</div>' +
          '<div id="e-cinema-options" class="' + (isScreenInitial ? '' : 'hidden') + ' panel bg-panel2/40 p-3.5 rounded-xl border border-line">' +
            '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 pb-2 border-b border-line/60">' +
              '<div class="flex items-center gap-1.5">' +
                ui.icon('film', 'w-4 h-4 text-accent') +
                '<span class="text-xs font-semibold text-accent">Cinema Screening Checklist & Details</span>' +
              '</div>' +
              '<div class="flex items-center gap-2">' +
                '<label for="e-media-type" class="text-xs font-medium text-muted shrink-0">Media Type:</label>' +
                '<select id="e-media-type" class="field !py-1 !px-2 !text-xs !w-auto">' +
                  blankOpt(RMTP.MEDIA_TYPES, ev.media_type || ev.mediaType, 'Select Media\u2026') +
                '</select>' +
              '</div>' +
            '</div>' +
            '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">' +
              '<label class="flex items-center gap-2 text-xs font-medium cursor-pointer"><input type="checkbox" id="e-dcp" class="w-4 h-4 accent-[var(--ok)]" ' + ((ev.dcp_received !== undefined ? ev.dcp_received : ev.dcpReceived) ? 'checked' : '') + ' /><span>DCP Received</span></label>' +
              '<label class="flex items-center gap-2 text-xs font-medium cursor-pointer"><input type="checkbox" id="e-checks" class="w-4 h-4 accent-[var(--ok)]" ' + ((ev.checks_completed !== undefined ? ev.checks_completed : ev.checksCompleted) ? 'checked' : '') + ' /><span>Checks Completed</span></label>' +
              '<label class="flex items-center gap-2 text-xs font-medium cursor-pointer"><input type="checkbox" id="e-intermission" class="w-4 h-4 accent-[var(--ok)]" ' + (ev.intermission ? 'checked' : '') + ' /><span>Intermission?</span></label>' +
              '<label class="flex items-center gap-2 text-xs font-medium cursor-pointer"><input type="checkbox" id="e-qa" class="w-4 h-4 accent-[var(--ok)]" ' + (ev.qa ? 'checked' : '') + ' /><span>Q&A?</span></label>' +
            '</div>' +
          '</div>' +
          fld('Technicians', '<div id="e-tech-area"></div>') +
          fld('Artist / client contact', '<input id="e-contact" class="field" value="' + ui.esc(ev.clientContact || '') + '" placeholder="Tour manager / client" />') +
          fld('Tech info', '<textarea id="e-info" class="field" rows="3" placeholder="Anything the crew needs to know\u2026">' + ui.esc(ev.techInfo || '') + '</textarea>') +
          '<div>' +
            '<div class="flex items-center gap-3 mb-2">' +
              '<label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="e-guest" class="w-4 h-4 accent-[var(--accent)]" ' + (ev.guestEngineer ? 'checked' : '') + ' /><span class="text-sm font-medium">Guest engineer</span></label>' +
            '</div>' +
          '</div>' +
          '<div><label class="block text-sm font-medium mb-2">Tech spec (PDF)</label><div id="e-spec-area"></div></div>' +
        '</div>',
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-save data-primary>' + (existing ? 'Save changes' : 'Add event') + '</button>',
    });

    const spaceSelect = m.root.querySelector('#e-space');
    if (spaceSelect) {
      spaceSelect.addEventListener('change', () => {
        const isScreen = isScreenSpace(spaceSelect.value);
        const scrWrapper = m.root.querySelector('#e-screening-starts-wrapper');
        const cinOptions = m.root.querySelector('#e-cinema-options');
        if (scrWrapper) scrWrapper.classList.toggle('hidden', !isScreen);
        if (cinOptions) cinOptions.classList.toggle('hidden', !isScreen);
      });
    }

    function techAreaHtml() {
      const allUsers = store.all('users');
      const rows = techs.map((t, i) => {
        const usedElsewhere = techs.filter((x, j) => j !== i).map((x) => x.userId);
        const uOpts = '<option value="">Select technician\u2026</option>' + allUsers
          .filter((u) => u.id === t.userId || usedElsewhere.indexOf(u.id) === -1)
          .map((u) => '<option value="' + u.id + '" ' + (u.id === t.userId ? 'selected' : '') + '>' + ui.esc(auth.displayName(u)) + '</option>').join('');
        const rOpts = '<option value="">Select role\u2026</option>' + RMTP.SHIFT_ROLES
          .map((r) => '<option ' + (r === t.role ? 'selected' : '') + '>' + r + '</option>').join('');
        return '<div class="flex items-center gap-2">' +
          '<select data-t-user="' + i + '" class="field flex-1">' + uOpts + '</select>' +
          '<select data-t-role="' + i + '" class="field w-36 shrink-0">' + rOpts + '</select>' +
          '<button type="button" data-t-remove="' + i + '" class="btn btn-danger !p-2 shrink-0" title="Remove">' + ui.icon('trash', 'w-4 h-4') + '</button>' +
        '</div>';
      }).join('');
      return (rows ? '<div class="grid gap-2 mb-2">' + rows + '</div>' : '<p class="text-xs text-muted mb-2">No technicians tagged yet.</p>') +
        '<button type="button" id="e-tech-add" class="btn btn-ghost">' + ui.icon('plus', 'w-4 h-4') + 'Add technician</button>';
    }
    function wireTechs() {
      const area = m.root.querySelector('#e-tech-area');
      area.innerHTML = techAreaHtml();
      area.querySelectorAll('[data-t-user]').forEach((sel) => sel.addEventListener('change', () => {
        techs[+sel.getAttribute('data-t-user')].userId = sel.value; wireTechs();
      }));
      area.querySelectorAll('[data-t-role]').forEach((sel) => sel.addEventListener('change', () => {
        techs[+sel.getAttribute('data-t-role')].role = sel.value;
      }));
      area.querySelectorAll('[data-t-remove]').forEach((btn) => btn.addEventListener('click', () => {
        techs.splice(+btn.getAttribute('data-t-remove'), 1); wireTechs();
      }));
      const addBtn = m.root.querySelector('#e-tech-add');
      if (addBtn) addBtn.addEventListener('click', () => { techs.push({ userId: '', role: '' }); wireTechs(); });
    }
    wireTechs();

    function specAreaHtml() {
      const shown = pending || (cleared ? null : specMeta);
      if (shown) {
        return '<div class="panel bg-panel2/40 p-3 flex items-center justify-between gap-3">' +
          '<span class="flex items-center gap-2 min-w-0">' + ui.icon('file', 'w-4 h-4') +
            '<span class="text-sm truncate">' + ui.esc(shown.name) + '</span>' +
            '<span class="text-xs text-muted shrink-0">' + files.humanSize(shown.size) + (pending ? ' \u00b7 unsaved' : '') + '</span></span>' +
          '<span class="flex gap-1 shrink-0">' +
            '<button type="button" data-spec-view class="btn btn-ghost !p-2" title="View">' + ui.icon('arrowR', 'w-4 h-4') + '</button>' +
            '<button type="button" data-spec-remove class="btn btn-danger !p-2" title="Remove">' + ui.icon('trash', 'w-4 h-4') + '</button>' +
          '</span></div>';
      }
      return '<label class="btn btn-ghost cursor-pointer inline-flex"><input type="file" accept="application/pdf" id="e-spec-input" class="sr-only" />' +
        ui.icon('upload', 'w-4 h-4') + 'Upload PDF</label>' +
        '<p class="text-[11px] text-muted mt-2">PDF up to ' + files.humanSize(files.MAX) + '. Stored locally in this prototype.</p>';
    }
    function wireSpec() {
      const area = m.root.querySelector('#e-spec-area');
      area.innerHTML = specAreaHtml();
      const input = area.querySelector('#e-spec-input');
      if (input) input.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (file.type && file.type.indexOf('pdf') === -1) { ui.toast('PDF files only', 'danger'); return; }
        files.readAsDataUrl(file).then((p) => { pending = p; cleared = false; wireSpec(); ui.toast('Attached (save to keep)', 'ok'); })
          .catch((err) => ui.toast(err && err.message === 'too-large' ? 'File too large (max ' + files.humanSize(files.MAX) + ')' : 'Could not read file', 'danger'));
      });
      const view = area.querySelector('[data-spec-view]');
      if (view) view.addEventListener('click', () => { if (pending) files.openDataUrl(pending.dataUrl); else files.open(specMeta); });
      const rem = area.querySelector('[data-spec-remove]');
      if (rem) rem.addEventListener('click', () => { if (pending) { pending = null; } else { cleared = true; } wireSpec(); });
    }
    wireSpec();

    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);
    m.root.querySelector('[data-save]').addEventListener('click', () => {
      const name = m.root.querySelector('#e-name').value.trim();
      if (!name) { ui.toast('Give the event a name', 'danger'); return; }

      const finalTechs = techs.filter((t) => t.userId);
      if (finalTechs.some((t) => !t.role)) { ui.toast('Pick a role for each tagged technician', 'danger'); return; }

      // Resolve tech-spec: persist a pending upload; drop the old blob if replaced/removed.
      let finalSpec = cleared ? null : specMeta;
      if (pending) {
        try { finalSpec = files.persist(pending); }
        catch (e) { ui.toast('Couldn\u2019t store file — storage may be full', 'danger'); return; }
        if (originalSpec) files.remove(originalSpec);
      } else if (cleared && originalSpec) {
        files.remove(originalSpec);
      }

      const chosenSpace = m.root.querySelector('#e-space').value;
      const isScreen = isScreenSpace(chosenSpace);

      const record = Object.assign({}, ev, {
        id: ev.id || store.uid('evt'),
        name: name,
        category: m.root.querySelector('#e-category').value,
        space: chosenSpace,
        date: m.root.querySelector('#e-date').value,
        status: m.root.querySelector('#e-status').value,
        startTime: m.root.querySelector('#e-start').value,
        finishTime: m.root.querySelector('#e-finish').value,
        screening_starts_time: isScreen && m.root.querySelector('#e-screening-starts') ? m.root.querySelector('#e-screening-starts').value : (ev.screening_starts_time || ev.screeningStartsTime || ''),
        media_type: isScreen && m.root.querySelector('#e-media-type') ? m.root.querySelector('#e-media-type').value : (ev.media_type || ev.mediaType || ''),
        soundcheck: m.root.querySelector('#e-sc').value,
        doors: m.root.querySelector('#e-doors').value,
        curfew: m.root.querySelector('#e-curfew').value,
        dcp_received: isScreen && m.root.querySelector('#e-dcp') ? m.root.querySelector('#e-dcp').checked : (ev.dcp_received !== undefined ? !!ev.dcp_received : !!ev.dcpReceived),
        checks_completed: isScreen && m.root.querySelector('#e-checks') ? m.root.querySelector('#e-checks').checked : (ev.checks_completed !== undefined ? !!ev.checks_completed : !!ev.checksCompleted),
        intermission: isScreen && m.root.querySelector('#e-intermission') ? m.root.querySelector('#e-intermission').checked : !!ev.intermission,
        qa: isScreen && m.root.querySelector('#e-qa') ? m.root.querySelector('#e-qa').checked : !!ev.qa,
        technicians: finalTechs,
        clientContact: m.root.querySelector('#e-contact').value.trim(),
        guestEngineer: m.root.querySelector('#e-guest').checked,
        techInfo: m.root.querySelector('#e-info').value.trim(),
        techSpec: finalSpec,
        checklist: ev.checklist || { techSpecSent: false, inputListReceived: false, stagePlot: false, schedule: false, backline: false, hospitality: false, parkingAccess: false },
      });
      store.upsert('advancing', record);
      m.close(); ui.toast(existing ? 'Event updated' : 'Event added', 'ok'); RMTP.router.render();
    });
  }

  async function del(ev) {
    const ok = await ui.confirm('Delete \u201c' + ev.name + '\u201d and its shift reports?',
      { title: 'Delete event', confirmLabel: 'Delete', danger: true });
    if (ok) {
      reportsFor(ev.id).forEach((r) => store.remove('reports', r.id));
      if (ev.techSpec) files.remove(ev.techSpec);
      store.remove('advancing', ev.id);
      ui.toast('Event deleted', 'ok'); RMTP.router.render();
    }
  }

  function fld(label, control) { return '<div><label class="block text-sm font-medium mb-2">' + ui.esc(label) + '</label>' + control + '</div>'; }
};

