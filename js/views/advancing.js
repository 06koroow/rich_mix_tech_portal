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
  const filters = (RMTP._advFilters = RMTP._advFilters || { space: '', date: '' });
  const todayISO = new Date().toISOString().slice(0, 10);

  const STATUSES = ['Advancing', 'Confirmed', 'Complete'];
  const statusColour = { 'Advancing': 'var(--info)', 'Confirmed': 'var(--accent)', 'Complete': 'var(--ok)' };

  function userName(id) { const u = id && store.find('users', id); return u ? auth.displayName(u) : ''; }
  function reportsFor(eventId) {
    return store.all('reports').filter((r) => r.eventId === eventId)
      .sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
  }
  function canDeleteReport(r) { const u = auth.current(); return !!u && (u.admin || r.authorId === u.id); }

  // Admins see every event; everyone else sees only shifts assigned to them.
  const base = store.all('advancing').filter((e) => isAdmin || (me && e.techUserId === me.id));
  const shown = base
    .filter((e) => (!filters.space || e.space === filters.space) && (!filters.date || e.date === filters.date))
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));

  const emptyMsg = !base.length
    ? (isAdmin ? ['clip', 'No events yet', 'Add an event to start advancing it.']
               : ['clip', 'No shifts assigned to you', 'You\u2019ll see events here once an admin assigns you.'])
    : ['clip', 'Nothing matches these filters', 'Try a different space or clear the date.'];

  el.innerHTML =
    '<div class="view-enter">' +
      ui.pageHeader('Advancing', isAdmin ? 'Events' : 'Your shifts',
        (canManageEvents && RMTP.supabase && RMTP.supabase.isConfigured()
          ? '<button id="artifax-sync" class="btn btn-ghost" title="Pull events from Artifax">' + ui.icon('reset', 'w-4 h-4') + '<span class="hidden sm:inline">Refresh from Artifax</span></button>' : '') +
        (canManageEvents ? '<button id="add-event" class="btn btn-primary">' + ui.icon('plus', 'w-4 h-4') + 'Add event</button>' : '')) +
      filterBar() +
      (shown.length ? '<div class="grid gap-4 lg:grid-cols-2">' + shown.map(renderEvent).join('') + '</div>'
                    : ui.empty(emptyMsg[0], emptyMsg[1], emptyMsg[2])) +
    '</div>';

  // Filter bar wiring
  el.querySelectorAll('[data-space]').forEach((b) => b.addEventListener('click', () => { filters.space = b.getAttribute('data-space'); RMTP.router.render(); }));
  const dateIn = el.querySelector('#adv-date'); if (dateIn) dateIn.addEventListener('change', () => { filters.date = dateIn.value; RMTP.router.render(); });
  const todayBtn = el.querySelector('#adv-today'); if (todayBtn) todayBtn.addEventListener('click', () => { filters.date = todayISO; RMTP.router.render(); });
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
      await RMTP.syncSb.pullCollection('advancing');
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
  });

  function filterBar() {
    const chip = (id, label, n, active) =>
      '<button data-space="' + ui.esc(id) + '" class="px-3 py-1.5 rounded-lg text-sm font-medium border ' +
        (active ? 'bg-panel2 border-accent text-ink' : 'border-line text-muted hover:text-ink') + '">' +
        ui.esc(label) + ' <span class="tabular text-xs opacity-70">' + n + '</span></button>';
    const chips = [chip('', 'All', base.length, !filters.space)]
      .concat(RMTP.SPACES.map((s) => chip(s, s, base.filter((e) => e.space === s).length, filters.space === s))).join('');
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

    const info = [
      ev.date ? ['Date', ui.formatDate(ev.date)] : null,
      times ? ['Running', times] : null,
      ev.soundcheck ? ['Soundcheck', ev.soundcheck] : null,
      ev.doors ? ['Doors', ev.doors] : null,
      ev.curfew ? ['Curfew', ev.curfew] : null,
      ev.techUserId ? ['Tech', userName(ev.techUserId) || 'Unassigned'] : null,
      ev.clientContact ? ['Client', ev.clientContact] : null,
    ].filter(Boolean).map(([k, v]) =>
      '<div><dt class="eyebrow">' + ui.esc(k) + '</dt><dd class="text-sm mt-0.5">' + ui.esc(v) + '</dd></div>'
    ).join('');

    const meta = [ev.category, ev.space].filter(Boolean).map((t) => ui.pill(t, 'var(--muted)')).join('');

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
        (ev.techInfo ? '<p class="text-sm text-ink/80 mt-4 whitespace-pre-wrap">' + ui.esc(ev.techInfo) + '</p>' : '') +
        (ev.techSpec ?
          '<button data-spec="' + ev.id + '" class="mt-4 inline-flex items-center gap-2 text-sm text-accent hover:underline self-start">' +
            ui.icon('file', 'w-4 h-4') + 'Tech spec: ' + ui.esc(ev.techSpec.name) + ' <span class="text-muted">(' + files.humanSize(ev.techSpec.size) + ')</span></button>' : '') +

        '<div class="mt-5 pt-4 border-t border-line flex items-center justify-between gap-3 mt-auto">' +
          '<div class="min-w-0">' +
            '<p class="eyebrow">End-of-shift</p>' +
            '<p class="text-sm mt-0.5 ' + (reports.length ? '' : 'text-muted') + '">' +
              (reports.length ? reports.length + ' report' + (reports.length > 1 ? 's' : '') + ' \u00b7 latest by ' + ui.esc(reports[0].author || 'Unknown') : 'No report filed yet') +
            '</p>' +
          '</div>' +
          '<button data-reports="' + ev.id + '" class="btn btn-ghost shrink-0">' + ui.icon('clip', 'w-4 h-4') +
            'Reports' + (reports.length ? ' (' + reports.length + ')' : '') + '</button>' +
        '</div>' +
      '</div>'
    );
  }

  /* ---- Shift reports ---- */
  function openReports(ev) {
    const reports = reportsFor(ev.id);
    const list = reports.length ? reports.map(reportCard).join('')
      : ui.empty('clip', 'No shift reports yet', canReport ? 'File the first end-of-shift report below.' : 'Nothing filed for this event.');
    const m = ui.modal({
      title: 'Shift reports \u2014 ' + ev.name,
      size: 'md:max-w-xl',
      body: '<div class="grid gap-3">' + list + '</div>',
      footer:
        (canReport ? '<button class="btn btn-primary mr-auto" data-add data-primary>' + ui.icon('plus', 'w-4 h-4') + 'Add report</button>' : '') +
        '<button class="btn btn-ghost" data-done>Done</button>',
    });
    function refresh() { m.close(); RMTP.router.render(); const f = store.find('advancing', ev.id); if (f) openReports(f); }
    const addBtn = m.root.querySelector('[data-add]');
    if (addBtn) addBtn.addEventListener('click', () => { m.close(); openReportForm(ev); });
    m.root.querySelector('[data-done]').addEventListener('click', () => { m.close(); RMTP.router.render(); });
    reports.forEach((r) => {
      const eBtn = m.root.querySelector('[data-redit="' + r.id + '"]'); if (eBtn) eBtn.addEventListener('click', () => { m.close(); openReportForm(ev, r); });
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
        '</div>',
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-save data-primary>' + (existing ? 'Save changes' : 'File report') + '</button>',
    });
    m.root.querySelector('[data-cancel]').addEventListener('click', () => { m.close(); openReports(ev); });
    m.root.querySelector('[data-save]').addEventListener('click', () => {
      const summary = m.root.querySelector('#r-summary').value.trim();
      const issues = m.root.querySelector('#r-issues').value.trim();
      const followUp = m.root.querySelector('#r-follow').value.trim();
      if (!summary && !issues && !followUp) { ui.toast('Add at least a summary', 'danger'); return; }
      const meNow = auth.current();
      const now = new Date().toISOString();
      // Shift date always corresponds to the event it's attached to.
      const base = { id: r.id || store.uid('rep'), eventId: ev.id, crew: m.root.querySelector('#r-crew').value.trim(), shiftDate: ev.date || '', summary, issues, followUp };
      const record = existing
        ? Object.assign({}, r, base, { updatedAt: now, updatedBy: auth.displayName(meNow) })
        : Object.assign(base, { authorId: meNow ? meNow.id : null, author: auth.displayName(meNow) || 'Unknown', submittedAt: now, updatedAt: now });
      store.upsert('reports', record);
      m.close(); ui.toast(existing ? 'Report updated' : 'Report filed', 'ok');
      RMTP.router.render(); const f = store.find('advancing', ev.id); if (f) openReports(f);
    });
  }

  /* ---- Event form ---- */
  function openForm(existing) {
    const ev = existing || {};
    const opt = (arr, val) => arr.map((v) => '<option ' + (v === val ? 'selected' : '') + '>' + v + '</option>').join('');
    const blankOpt = (arr, val, blank) => '<option value="" ' + (!val ? 'selected' : '') + '>' + blank + '</option>' +
      arr.map((v) => '<option ' + (v === val ? 'selected' : '') + '>' + v + '</option>').join('');
    const userOpts = '<option value="">Unassigned</option>' + store.all('users').map((u) =>
      '<option value="' + u.id + '" ' + (u.id === ev.techUserId ? 'selected' : '') + '>' + ui.esc(auth.displayName(u)) + '</option>').join('');

    // Tech-spec state (only written to storage on save).
    const originalSpec = ev.techSpec || null;
    let specMeta = originalSpec;   // currently-attached saved meta
    let pending = null;            // newly chosen file, in memory
    let cleared = false;           // user removed the existing spec

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
          '<div class="grid grid-cols-2 sm:grid-cols-5 gap-4">' +
            fld('Start', '<input id="e-start" type="time" class="field" value="' + ui.esc(ev.startTime || '') + '" />') +
            fld('Finish', '<input id="e-finish" type="time" class="field" value="' + ui.esc(ev.finishTime || '') + '" />') +
            fld('Soundcheck', '<input id="e-sc" type="time" class="field" value="' + ui.esc(ev.soundcheck || '') + '" />') +
            fld('Doors', '<input id="e-doors" type="time" class="field" value="' + ui.esc(ev.doors || '') + '" />') +
            fld('Curfew', '<input id="e-curfew" type="time" class="field" value="' + ui.esc(ev.curfew || '') + '" />') +
          '</div>' +
          '<div class="grid sm:grid-cols-2 gap-4">' +
            fld('Tech assigned', '<select id="e-tech" class="field">' + userOpts + '</select>') +
            fld('Artist / client contact', '<input id="e-contact" class="field" value="' + ui.esc(ev.clientContact || '') + '" placeholder="Tour manager / client" />') +
          '</div>' +
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

      // Resolve tech-spec: persist a pending upload; drop the old blob if replaced/removed.
      let finalSpec = cleared ? null : specMeta;
      if (pending) {
        try { finalSpec = files.persist(pending); }
        catch (e) { ui.toast('Couldn\u2019t store file — storage may be full', 'danger'); return; }
        if (originalSpec) files.remove(originalSpec);
      } else if (cleared && originalSpec) {
        files.remove(originalSpec);
      }

      const record = Object.assign({}, ev, {
        id: ev.id || store.uid('evt'),
        name: name,
        category: m.root.querySelector('#e-category').value,
        space: m.root.querySelector('#e-space').value,
        date: m.root.querySelector('#e-date').value,
        status: m.root.querySelector('#e-status').value,
        startTime: m.root.querySelector('#e-start').value,
        finishTime: m.root.querySelector('#e-finish').value,
        soundcheck: m.root.querySelector('#e-sc').value,
        doors: m.root.querySelector('#e-doors').value,
        curfew: m.root.querySelector('#e-curfew').value,
        techUserId: m.root.querySelector('#e-tech').value,
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
