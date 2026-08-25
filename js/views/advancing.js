/* ============================================================
   views/advancing.js — event advancing, checklists & shift reports
   ------------------------------------------------------------
   Events carry: category, space, times, assigned technicians,
   live schedule / set pieces (for live spaces), screening checks &
   DCP testing info (for cinema spaces), tech-info note, tech-spec PDF,
   and guest-engineer flag. End-of-shift reports live in `reports`
   collection keyed by eventId.
   ============================================================ */
RMTP.views.advancing = function (el) {
  const ui = RMTP.ui, store = RMTP.store, auth = RMTP.auth, files = RMTP.files;

  const me = auth.current();
  const isAdmin = !!(me && me.admin);
  const canManageEvents = auth.can('advancing.manage');
  const canReport = auth.can('report.edit');
  const filters = (RMTP._advFilters = RMTP._advFilters || { space: '', date: '', tab: 'upcoming' });
  let mobileFiltersOpen = (RMTP._advMobileFiltersOpen !== undefined ? RMTP._advMobileFiltersOpen : false);
  const expandedEvents = (RMTP._expandedAdvEvents = RMTP._expandedAdvEvents || new Set());

  // Advancing view mode state ('list' | 'calendar')
  let advViewMode = (RMTP._advViewMode = RMTP._advViewMode || 'list');
  let calDate = (RMTP._advCalDate = RMTP._advCalDate || new Date());

  // Technician filter state: array of user IDs/emails, or 'all'
  // Default to currently signed-in user on initial session load
  if (RMTP._advTechFilter === undefined) {
    RMTP._advTechFilter = (me && (me.id || me.email)) ? [(me.id || me.email)] : [];
  }
  let selectedTechs = RMTP._advTechFilter; // Array of ids/emails, or empty array = all
  let includeUnassigned = (RMTP._advIncludeUnassigned !== undefined ? RMTP._advIncludeUnassigned : true);

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

  /* ---- Shift Reports Email Automation & Recipients Config ---- */
  const DEFAULT_RECIPIENT_RULES = [
    { email: 'tech@richmix.org.uk', category: 'All' },
    { email: 'dutymanager@richmix.org.uk', category: 'All' },
    { email: 'production@richmix.org.uk', category: 'Programme' },
    { email: 'cinema@richmix.org.uk', category: 'Cinema' },
    { email: 'events@richmix.org.uk', category: 'Private Hires' }
  ];

  // Helper to normalize recipient entry: { email: string, category: 'All'|'Programme'|'Cinema'|'Private Hires' }
  function normalizeRecipientEntry(r) {
    if (!r) return null;
    if (typeof r === 'string') {
      const email = r.trim().toLowerCase();
      return email && email.indexOf('@') !== -1 ? { email, category: 'All' } : null;
    }
    if (typeof r === 'object' && r.email) {
      const email = String(r.email).trim().toLowerCase();
      const cat = (r.category && ['All', 'Programme', 'Cinema', 'Private Hires'].includes(r.category)) ? r.category : 'All';
      return email && email.indexOf('@') !== -1 ? { email, category: cat } : null;
    }
    return null;
  }

  function getReportRecipientRules() {
    try {
      const raw = store.readRaw('report_recipients', '');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) {
          const list = parsed.map(normalizeRecipientEntry).filter(Boolean);
          if (list.length) return list;
        }
      }
    } catch (e) {}
    return DEFAULT_RECIPIENT_RULES.map((r) => Object.assign({}, r));
  }

  function getReportRecipients(ev) {
    if (ev) {
      // 1. Direct per-event overrides if configured
      const perEv = ev.email_recipients || ev.emailRecipients;
      if (Array.isArray(perEv) && perEv.length) {
        return perEv.map((x) => (typeof x === 'string' ? x : (x.email || ''))).filter(Boolean);
      }
      if (typeof perEv === 'string' && perEv.trim()) {
        const split = perEv.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.indexOf('@') !== -1);
        if (split.length) return split;
      }
    }

    const rules = getReportRecipientRules();
    if (!ev) {
      // Return all unique emails when no event context provided (e.g. badge counters)
      return Array.from(new Set(rules.map((r) => r.email)));
    }

    // Determine event category
    let evCat = ev.category || '';
    if (!evCat) {
      if (isScreenSpace(ev.space)) evCat = 'Cinema';
      else evCat = 'Programme';
    }

    // Match rules: 'All' or specific category match
    const matched = rules.filter((r) => {
      if (!r.category || r.category === 'All') return true;
      if (r.category.toLowerCase() === evCat.toLowerCase()) return true;
      // Also match Cinema spaces automatically if category is Cinema
      if (r.category === 'Cinema' && isScreenSpace(ev.space)) return true;
      return false;
    }).map((r) => r.email);

    return Array.from(new Set(matched));
  }

  function saveReportRecipients(list) {
    const normalized = list.map(normalizeRecipientEntry).filter(Boolean);
    store.writeRaw('report_recipients', JSON.stringify(normalized));
  }

  function userName(id) {
    if (!id) return '';
    const u = store.find('users', id);
    if (u) return auth.displayName(u);
    if (typeof id === 'string' && id.indexOf('@') !== -1) return id.split('@')[0];
    return id || 'Unknown';
  }

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

  // Unified filter bar open/closed state (persisted across render)
  let filtersPanelOpen = (RMTP._advFiltersPanelOpen !== undefined ? RMTP._advFiltersPanelOpen : false);

  // Pool of all events in system
  const allEvents = store.all('advancing') || [];

  // Filter events based on active technician filter & space/tab
  function matchesTechFilter(e) {
    if (!selectedTechs || selectedTechs.length === 0) return true; // all technicians
    const evTechs = RMTP.eventTechnicians(e);
    if (!evTechs.length) return includeUnassigned;
    return evTechs.some((tid) => {
      if (selectedTechs.indexOf(tid) !== -1) return true;
      const u = store.find('users', tid);
      if (u && (selectedTechs.indexOf(u.id) !== -1 || selectedTechs.indexOf(u.email) !== -1)) return true;
      return false;
    });
  }

  const base = allEvents.filter(matchesTechFilter);

  const upcomingCount = base.filter((e) => !isPastEvent(e.date)).length;
  const pastCount = base.filter((e) => isPastEvent(e.date)).length;

  const currentTab = filters.tab || 'upcoming';

  const shown = base
    .filter((e) => (currentTab === 'past' ? isPastEvent(e.date) : !isPastEvent(e.date)))
    .filter((e) => (!filters.space || e.space === filters.space) && (!filters.date || e.date === filters.date))
    .sort((a, b) => (currentTab === 'past' ? (b.date || '').localeCompare(a.date || '') : (a.date || '9999').localeCompare(b.date || '9999')));

  const emptyMsg = !base.length
    ? (!allEvents.length ? ['clip', 'No events yet', 'Add an event to start advancing it.']
                         : ['user', 'No shifts found for selected technician(s)', 'Try selecting "All Team Shifts" or a different technician filter.'])
    : (currentTab === 'past'
      ? ['clip', 'No past events found', 'Past events will appear here once their date has passed.']
      : ['clip', 'Nothing matches these filters', 'Try a different space, tab, or clear the date.']);

  // Active filter count summary badge
  let activeFilterCount = 0;
  if (filters.space) activeFilterCount++;
  if (filters.date) activeFilterCount++;
  if (selectedTechs && selectedTechs.length > 0) activeFilterCount++;
  if (!includeUnassigned) activeFilterCount++;

  el.innerHTML =
    '<div class="view-enter">' +
      ui.pageHeader('Advancing', isAdmin ? 'Events & Production Schedules' : 'Your shifts & Production Advancing',
        '<div class="inline-flex rounded-lg border border-line p-0.5 bg-panel mr-1">' +
          '<button id="adv-mode-list" class="px-2.5 py-1 text-xs rounded font-medium transition flex items-center gap-1.5 ' + (advViewMode === 'list' ? 'bg-accent text-accent-ink font-semibold shadow-xs' : 'text-muted hover:text-ink') + '">' +
            ui.icon('list', 'w-3.5 h-3.5') + '<span class="hidden sm:inline">List</span>' +
          '</button>' +
          '<button id="adv-mode-cal" class="px-2.5 py-1 text-xs rounded font-medium transition flex items-center gap-1.5 ' + (advViewMode === 'calendar' ? 'bg-accent text-accent-ink font-semibold shadow-xs' : 'text-muted hover:text-ink') + '">' +
            ui.icon('calendar', 'w-3.5 h-3.5') + '<span class="hidden sm:inline">Calendar</span>' +
          '</button>' +
        '</div>' +
        (isAdmin ? '<button id="verify-sync-btn" class="btn btn-ghost text-xs" title="Check Supabase database sync status">' + ui.icon('shield', 'w-3.5 h-3.5') + '<span class="hidden sm:inline">Verify Sync</span></button>' : '') +
        '<button id="email-recipients-btn" class="btn btn-ghost text-xs" title="Configure shift report email recipients">' + ui.icon('mail', 'w-3.5 h-3.5') + '<span class="hidden sm:inline">Recipients</span>' +
          '<span class="ml-1 px-1.5 py-0.5 rounded text-[11px] bg-panel border border-line font-mono text-accent font-semibold">' + getReportRecipients().length + '</span>' +
        '</button>' +
        (isAdmin && canManageEvents && RMTP.supabase && RMTP.supabase.isConfigured()
          ? '<button id="artifax-sync" class="btn btn-ghost text-xs" title="Pull events from Artifax">' + ui.icon('reset', 'w-3.5 h-3.5') + '<span class="hidden sm:inline">Sync Artifax</span></button>' : '')
      ) +

      // Top Control Bar: Collapsible Filter Menu Trigger (Left) + Add Event Button (Right)
      '<div class="flex items-center justify-between gap-3 mb-4">' +
        '<button id="adv-filter-toggle-btn" class="btn btn-ghost text-xs flex items-center gap-2 border border-line bg-panel2 hover:bg-panel font-medium py-2 px-3 rounded-lg transition">' +
          ui.icon('filter', 'w-3.5 h-3.5 text-accent') +
          '<span>Filters & Crew</span>' +
          (activeFilterCount > 0 ? '<span class="px-1.5 py-0.2 rounded-full text-[10px] bg-accent text-accent-ink font-bold">' + activeFilterCount + '</span>' : '') +
          '<span class="text-muted transition-transform ' + (filtersPanelOpen ? 'rotate-180 text-accent' : '') + '">' + ui.icon('arrowD', 'w-3.5 h-3.5') + '</span>' +
        '</button>' +
        (canManageEvents ? '<button id="add-event" class="btn btn-primary text-xs py-2 px-3 flex items-center gap-1.5">' + ui.icon('plus', 'w-4 h-4') + 'Add event</button>' : '') +
      '</div>' +

      // Unified Collapsible Filter Drawer
      renderUnifiedFilterDrawer() +

      (advViewMode === 'calendar'
        ? renderCalendarView()
        : (tabBar() +
           (shown.length ? '<div class="grid gap-3.5">' + shown.map(renderEventCard).join('') + '</div>'
                         : ui.empty(emptyMsg[0], emptyMsg[1], emptyMsg[2]))
          )
      ) +
    '</div>';

  /* ---- Unified Collapsible Filter Drawer Component ---- */
  function renderUnifiedFilterDrawer() {
    const isOnlyMe = me && selectedTechs.length === 1 && (selectedTechs[0] === me.id || selectedTechs[0] === me.email);
    const isAll = !selectedTechs || selectedTechs.length === 0;

    let crewPillText = '';
    if (isAll) {
      crewPillText = 'All Team';
    } else if (isOnlyMe) {
      crewPillText = 'Only Me (' + (me ? auth.displayName(me) : 'You') + ')';
    } else {
      crewPillText = selectedTechs.length + ' crew selected';
    }

    const tabPool = base.filter((e) => (currentTab === 'past' ? isPastEvent(e.date) : !isPastEvent(e.date)));
    const chip = (id, label, n, active) =>
      '<button data-space="' + ui.esc(id) + '" class="px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ' +
        (active ? 'bg-accent text-accent-ink border-accent font-semibold shadow-2xs' : 'bg-panel border-line text-muted hover:text-ink hover:border-line/80') + '">' +
        ui.esc(label) + ' <span class="tabular text-[10px] opacity-70">(' + n + ')</span></button>';

    const spaceChips = [chip('', 'All Spaces', tabPool.length, !filters.space)]
      .concat(RMTP.SPACES.map((s) => chip(s, s, tabPool.filter((e) => e.space === s).length, filters.space === s))).join('');

    return (
      '<div id="adv-filters-drawer" class="' + (filtersPanelOpen ? 'block' : 'hidden') + ' panel p-4 mb-4 border border-line bg-panel2/60 animate-fadeIn space-y-3.5 shadow-sm">' +
        '<!-- Row 1: Crew & Technician Filtering -->' +
        '<div class="flex flex-col md:flex-row md:items-center justify-between gap-2.5 pb-3 border-b border-line/60">' +
          '<div class="flex items-center gap-2 flex-wrap">' +
            '<span class="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">' +
              ui.icon('user', 'w-3.5 h-3.5 text-accent') + '<span>Crew:</span>' +
            '</span>' +
            '<button id="tf-only-me" class="px-2.5 py-1 text-xs rounded-lg border transition font-medium ' +
              (isOnlyMe ? 'bg-accent text-accent-ink border-accent font-semibold shadow-xs' : 'bg-panel border-line text-ink hover:border-accent') + '">' +
              'Only My Shifts' +
            '</button>' +
            '<button id="tf-all-team" class="px-2.5 py-1 text-xs rounded-lg border transition font-medium ' +
              (isAll ? 'bg-accent text-accent-ink border-accent font-semibold shadow-xs' : 'bg-panel border-line text-ink hover:border-accent') + '">' +
              'All Team' +
            '</button>' +
            '<button id="tf-custom-modal" class="px-2.5 py-1 text-xs rounded-lg border bg-panel border-line text-ink hover:border-accent transition flex items-center gap-1 font-medium">' +
              ui.icon('filter', 'w-3 h-3') + '<span>' + ui.esc(crewPillText) + '</span>' +
            '</button>' +
          '</div>' +
          '<label class="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">' +
            '<input type="checkbox" id="tf-unassigned-cb" class="w-3.5 h-3.5 rounded accent-[var(--accent)]" ' + (includeUnassigned ? 'checked' : '') + ' />' +
            '<span>Include unassigned shifts</span>' +
          '</label>' +
        '</div>' +

        '<!-- Row 2: Space Filters -->' +
        '<div>' +
          '<div class="text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5 flex items-center gap-1">' +
            ui.icon('search', 'w-3 h-3 text-accent') + '<span>Venue Space:</span>' +
          '</div>' +
          '<div class="flex flex-wrap items-center gap-1.5">' +
            spaceChips +
          '</div>' +
        '</div>' +

        '<!-- Row 3: Date & Reset Controls -->' +
        '<div class="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-line/60">' +
          '<div class="flex items-center gap-2 flex-wrap">' +
            '<span class="text-[11px] font-semibold text-muted uppercase tracking-wider">Date:</span>' +
            '<input id="adv-date" type="date" class="field !w-auto !py-1 text-xs" value="' + ui.esc(filters.date || '') + '" />' +
            '<button id="adv-today" class="btn btn-ghost !py-1 text-xs">Today</button>' +
          '</div>' +
          '<div>' +
            (activeFilterCount > 0
              ? '<button id="adv-clear" class="btn btn-ghost !py-1 text-xs text-danger hover:border-danger flex items-center gap-1">' + ui.icon('x', 'w-3 h-3') + 'Reset all filters</button>'
              : '<span class="text-xs text-muted">Showing all matching records</span>'
            ) +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  /* ---- Calendar View Generation ---- */
  function renderCalendarView() {
    const year = calDate.getFullYear();
    const month = calDate.getMonth();
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const monthName = monthNames[month];

    // Filter base events by space if space filter active
    const calEvents = base.filter((e) => !filters.space || e.space === filters.space);

    // Map events by YYYY-MM-DD
    const eventsByDate = {};
    calEvents.forEach((ev) => {
      if (!ev.date) return;
      const d = ev.date.slice(0, 10);
      if (!eventsByDate[d]) eventsByDate[d] = [];
      eventsByDate[d].push(ev);
    });

    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    const numDays = lastDayOfMonth.getDate();

    // 0 = Sunday, 1 = Monday ... 6 = Saturday -> convert to Monday=0, Sunday=6
    let startOffset = firstDayOfMonth.getDay() - 1;
    if (startOffset === -1) startOffset = 6;

    const todayStr = getTodayString();

    let daysHtml = '';
    for (let i = 0; i < startOffset; i++) {
      daysHtml += '<div class="min-h-[110px] p-2 bg-panel/30 border border-line/30 rounded-lg opacity-40"></div>';
    }

    for (let day = 1; day <= numDays; day++) {
      const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      const isToday = dateStr === todayStr;
      const evs = eventsByDate[dateStr] || [];
      evs.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

      daysHtml +=
        '<div class="min-h-[105px] sm:min-h-[120px] p-1.5 sm:p-2 bg-panel border ' + (isToday ? 'border-accent shadow-sm' : 'border-line') + ' rounded-lg flex flex-col justify-between transition hover:border-line/80 group overflow-hidden">' +
          '<div class="min-w-0">' +
            '<div class="flex items-center justify-between mb-1">' +
              '<span class="text-xs font-semibold ' + (isToday ? 'px-1.5 py-0.5 rounded bg-accent text-accent-ink font-mono' : 'text-ink') + '">' + day + '</span>' +
              (evs.length > 0 ? '<span class="text-[10px] font-mono text-muted">' + evs.length + ' shift' + (evs.length === 1 ? '' : 's') + '</span>' : '') +
            '</div>' +
            '<div class="grid gap-1 min-w-0">' +
              evs.map((ev) => {
                const isCinema = isScreenSpace(ev.space);
                const techNames = RMTP.eventTechnicians(ev).map(techLabel).filter(Boolean);
                const spaceBadge = isCinema ? 'bg-sky-500/15 text-sky-400 border-sky-500/30' : 'bg-amber-500/15 text-amber-400 border-amber-500/30';
                const stColour = statusColour[ev.status] || 'var(--accent)';
                return (
                  '<div data-open-cal-event="' + ui.esc(ev.id) + '" class="p-1 sm:p-1.5 rounded bg-panel2 hover:bg-panel border border-line cursor-pointer text-left transition hover:border-accent shadow-2xs min-w-0 overflow-hidden">' +
                    '<div class="flex items-center justify-between gap-1 mb-0.5 min-w-0">' +
                      '<span class="text-[9px] sm:text-[10px] font-mono font-medium text-muted truncate">' + ui.esc(ev.startTime || 'TBD') + (ev.finishTime ? ' \u2013 ' + ui.esc(ev.finishTime) : '') + '</span>' +
                      '<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:' + stColour + '"></span>' +
                    '</div>' +
                    '<div class="text-[11px] sm:text-xs font-semibold text-ink truncate hover:text-accent leading-snug">' + ui.esc(ev.name || 'Untitled') + '</div>' +
                    '<div class="flex items-center gap-1 mt-1 flex-wrap min-w-0">' +
                      '<span class="px-1 py-0.2 rounded text-[8px] sm:text-[9px] border font-medium truncate ' + spaceBadge + '">' + ui.esc(ev.space || 'Venue') + '</span>' +
                      (techNames.length ? '<span class="text-[9px] sm:text-[10px] text-muted truncate max-w-[70px] sm:max-w-[85px]">' + ui.esc(techNames[0]) + (techNames.length > 1 ? ' +' + (techNames.length - 1) : '') + '</span>' : '<span class="text-[9px] sm:text-[10px] text-danger font-medium">Unassigned</span>') +
                    '</div>' +
                  '</div>'
                );
              }).join('') +
            '</div>' +
          '</div>' +
          (canManageEvents ? '<button data-cal-add-date="' + dateStr + '" class="w-full mt-1 py-0.5 text-[10px] text-muted hover:text-accent hover:bg-panel2 rounded transition text-center opacity-0 group-hover:opacity-100">+ Add</button>' : '') +
        '</div>';
    }

    return (
      '<div class="grid gap-4 mb-8">' +
        '<div class="panel p-3.5 flex items-center justify-between flex-wrap gap-2">' +
          '<div class="flex items-center gap-2.5">' +
            '<h3 class="text-base font-semibold text-ink">' + monthName + ' ' + year + '</h3>' +
            '<span class="text-xs text-muted font-mono">(' + calEvents.length + ' shifts in view)</span>' +
          '</div>' +
          '<div class="flex items-center gap-1.5">' +
            '<button id="cal-btn-prev" class="btn btn-ghost text-xs px-3 py-1.5">' + ui.icon('chevron-left', 'w-3.5 h-3.5') + ' Prev</button>' +
            '<button id="cal-btn-today" class="btn btn-ghost text-xs px-3 py-1.5 font-medium">Today</button>' +
            '<button id="cal-btn-next" class="btn btn-ghost text-xs px-3 py-1.5">Next ' + ui.icon('chevron-right', 'w-3.5 h-3.5') + '</button>' +
          '</div>' +
        '</div>' +

        '<!-- Responsive Calendar Container with Horizontal Scroll fallback on compact screens -->' +
        '<div class="w-full overflow-x-auto pb-2">' +
          '<div class="min-w-[680px] lg:min-w-0">' +
            '<div class="grid grid-cols-7 gap-1.5 sm:gap-2 text-center text-xs font-semibold text-muted uppercase tracking-wider mb-2">' +
              '<div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div><div>Sun</div>' +
            '</div>' +
            '<div class="grid grid-cols-7 gap-1.5 sm:gap-2 auto-rows-fr">' +
              daysHtml +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  /* ---- Filter Modal for Multiple Technicians ---- */
  function openTechMultiFilterModal() {
    const allUsersList = (store.get('users') || []).slice();
    const knownTechIds = new Set();
    allEvents.forEach((ev) => {
      RMTP.eventTechnicians(ev).forEach((t) => knownTechIds.add(t));
    });
    allUsersList.forEach((u) => {
      knownTechIds.add(u.id);
      if (u.email) knownTechIds.add(u.email);
    });

    let tempSelected = selectedTechs.slice();

    const techItems = Array.from(knownTechIds).filter(Boolean).map((tid) => {
      const u = store.find('users', tid);
      const name = u ? (u.name || u.email) : userName(tid);
      const role = u ? (u.role || 'Staff') : 'Technician';
      return { id: tid, name: name, role: role };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const m = ui.modal({
      title: 'Filter Advancing by Technicians',
      body:
        '<div class="grid gap-3">' +
          '<div class="flex items-center justify-between gap-2">' +
            '<p class="text-xs text-muted">Select team members to view their shift schedule and advances:</p>' +
            '<div class="flex items-center gap-2">' +
              '<button type="button" id="m-tf-all" class="text-xs text-accent hover:underline font-medium">Select All</button>' +
              '<span class="text-muted">|</span>' +
              '<button type="button" id="m-tf-clear" class="text-xs text-muted hover:text-ink font-medium">Clear (All)</button>' +
              '<span class="text-muted">|</span>' +
              (me ? '<button type="button" id="m-tf-me" class="text-xs text-accent hover:underline font-medium">Only Me</button>' : '') +
            '</div>' +
          '</div>' +
          '<div id="m-tf-list" class="max-h-64 overflow-y-auto grid gap-1.5 p-2 rounded border border-line bg-panel2/40">' +
            techItems.map((item) => {
              const isChecked = tempSelected.indexOf(item.id) !== -1;
              return (
                '<label class="flex items-center justify-between p-2 rounded hover:bg-panel cursor-pointer text-xs border border-transparent hover:border-line">' +
                  '<div class="flex items-center gap-2.5">' +
                    '<input type="checkbox" value="' + ui.esc(item.id) + '" class="w-4 h-4 rounded accent-[var(--accent)]" ' + (isChecked ? 'checked' : '') + ' />' +
                    '<span class="font-medium text-ink">' + ui.esc(item.name) + '</span>' +
                  '</div>' +
                  '<span class="text-[11px] text-muted uppercase tracking-wider">' + ui.esc(item.role) + '</span>' +
                '</label>'
              );
            }).join('') +
          '</div>' +
        '</div>',
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-save data-primary>Apply Filters</button>'
    });

    const checklist = m.root.querySelector('#m-tf-list');
    m.root.querySelector('#m-tf-all').addEventListener('click', () => {
      checklist.querySelectorAll('input[type="checkbox"]').forEach((cb) => cb.checked = true);
    });
    m.root.querySelector('#m-tf-clear').addEventListener('click', () => {
      checklist.querySelectorAll('input[type="checkbox"]').forEach((cb) => cb.checked = false);
    });
    const meBtn = m.root.querySelector('#m-tf-me');
    if (meBtn && me) {
      meBtn.addEventListener('click', () => {
        checklist.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
          cb.checked = (cb.value === me.id || cb.value === me.email);
        });
      });
    }

    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);
    m.root.querySelector('[data-save]').addEventListener('click', () => {
      const selected = [];
      checklist.querySelectorAll('input[type="checkbox"]:checked').forEach((cb) => {
        selected.push(cb.value);
      });
      RMTP._advTechFilter = selected;
      m.close();
      RMTP.router.render();
    });
  }

  // Header button wiring
  const syncBtn = el.querySelector('#verify-sync-btn');
  if (syncBtn) syncBtn.addEventListener('click', () => {
    if (!isAdmin) { ui.toast('Admin permission required', 'danger'); return; }
    openSyncVerificationModal();
  });

  const recBtn = el.querySelector('#email-recipients-btn');
  if (recBtn) recBtn.addEventListener('click', () => {
    if (!isAdmin) { ui.toast('Admin permission required', 'danger'); return; }
    openRecipientConfigModal();
  });

  // View Mode Switcher (List vs Calendar)
  const modeListBtn = el.querySelector('#adv-mode-list');
  if (modeListBtn) modeListBtn.addEventListener('click', () => {
    RMTP._advViewMode = 'list';
    RMTP.router.render();
  });
  const modeCalBtn = el.querySelector('#adv-mode-cal');
  if (modeCalBtn) modeCalBtn.addEventListener('click', () => {
    RMTP._advViewMode = 'calendar';
    RMTP.router.render();
  });

  // Quick Technician Filter Buttons
  const onlyMeBtn = el.querySelector('#tf-only-me');
  if (onlyMeBtn) onlyMeBtn.addEventListener('click', () => {
    if (me) {
      RMTP._advTechFilter = [me.id || me.email];
      RMTP.router.render();
    } else {
      ui.toast('Sign in to filter by your shifts', 'info');
    }
  });

  const allTeamBtn = el.querySelector('#tf-all-team');
  if (allTeamBtn) allTeamBtn.addEventListener('click', () => {
    RMTP._advTechFilter = [];
    RMTP.router.render();
  });

  const customFilterModalBtn = el.querySelector('#tf-custom-modal');
  if (customFilterModalBtn) customFilterModalBtn.addEventListener('click', openTechMultiFilterModal);

  const unassignedCb = el.querySelector('#tf-unassigned-cb');
  if (unassignedCb) unassignedCb.addEventListener('change', () => {
    RMTP._advIncludeUnassigned = unassignedCb.checked;
    RMTP.router.render();
  });

  // Calendar Controls Wiring
  const calPrevBtn = el.querySelector('#cal-btn-prev');
  if (calPrevBtn) calPrevBtn.addEventListener('click', () => {
    calDate.setMonth(calDate.getMonth() - 1);
    RMTP._advCalDate = calDate;
    RMTP.router.render();
  });

  const calNextBtn = el.querySelector('#cal-btn-next');
  if (calNextBtn) calNextBtn.addEventListener('click', () => {
    calDate.setMonth(calDate.getMonth() + 1);
    RMTP._advCalDate = calDate;
    RMTP.router.render();
  });

  const calTodayBtn = el.querySelector('#cal-btn-today');
  if (calTodayBtn) calTodayBtn.addEventListener('click', () => {
    RMTP._advCalDate = new Date();
    RMTP.router.render();
  });

  el.querySelectorAll('[data-open-cal-event]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const eid = btn.getAttribute('data-open-cal-event');
      const ev = store.find('advancing', eid);
      if (ev) openEventModal(ev);
    });
  });

  el.querySelectorAll('[data-cal-add-date]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const d = btn.getAttribute('data-cal-add-date');
      openForm({ date: d });
    });
  });

  // Toggle Filter Drawer Button Wiring
  const filterToggleBtn = el.querySelector('#adv-filter-toggle-btn');
  if (filterToggleBtn) filterToggleBtn.addEventListener('click', () => {
    RMTP._advFiltersPanelOpen = !filtersPanelOpen;
    RMTP.router.render();
  });

  // Tab bar wiring
  el.querySelectorAll('[data-adv-tab]').forEach((b) => b.addEventListener('click', () => {
    filters.tab = b.getAttribute('data-adv-tab');
    RMTP.router.render();
  }));

  // Space Filter wiring inside drawer
  el.querySelectorAll('[data-space]').forEach((b) => b.addEventListener('click', () => {
    filters.space = b.getAttribute('data-space');
    RMTP.router.render();
  }));
  const dateIn = el.querySelector('#adv-date'); if (dateIn) dateIn.addEventListener('change', () => { filters.date = dateIn.value; RMTP.router.render(); });
  const todayBtn = el.querySelector('#adv-today'); if (todayBtn) todayBtn.addEventListener('click', () => { filters.date = getTodayString(); RMTP.router.render(); });
  const clearBtn = el.querySelector('#adv-clear'); if (clearBtn) clearBtn.addEventListener('click', () => {
    filters.space = '';
    filters.date = '';
    RMTP._advTechFilter = (me && (me.id || me.email)) ? [(me.id || me.email)] : [];
    RMTP._advIncludeUnassigned = true;
    RMTP.router.render();
  });

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

  // Card interactive listeners
  shown.forEach((ev) => {
    const q = (sel) => el.querySelector(sel);
    
    // Open pop-over modal on card click or view button
    const card = q('[data-event-card="' + ev.id + '"]');
    const openPop = (e) => {
      if (e.target.closest('button') && !e.target.closest('[data-open-modal]')) return;
      openEventModal(ev);
    };
    if (card) card.addEventListener('click', openPop);

    const openBtn = q('[data-open-modal="' + ev.id + '"]');
    if (openBtn) openBtn.addEventListener('click', (evt) => { evt.stopPropagation(); openEventModal(ev); });

    const e = q('[data-edit="' + ev.id + '"]'); if (e) e.addEventListener('click', (evt) => { evt.stopPropagation(); openForm(ev); });
    const d = q('[data-del="' + ev.id + '"]'); if (d) d.addEventListener('click', (evt) => { evt.stopPropagation(); del(ev); });
    const rp = q('[data-reports="' + ev.id + '"]'); if (rp) rp.addEventListener('click', (evt) => { evt.stopPropagation(); openReports(ev); });
    const sp = q('[data-spec="' + ev.id + '"]'); if (sp) sp.addEventListener('click', (evt) => { evt.stopPropagation(); files.open(ev.techSpec); });
    const pr = q('[data-print="' + ev.id + '"]'); if (pr) pr.addEventListener('click', (evt) => { evt.stopPropagation(); printAdvance(ev); });
  });

  function tabBar() {
    return (
      '<div class="flex items-center gap-2 mb-4 p-1 bg-panel2 rounded-lg border border-line w-full sm:w-fit overflow-x-auto">' +
        '<button data-adv-tab="upcoming" class="flex-1 sm:flex-initial px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 sm:gap-2 ' +
          (currentTab === 'upcoming' ? 'bg-accent text-accent-ink shadow-sm' : 'text-muted hover:text-ink') + '">' +
          ui.icon('clip', 'w-4 h-4') + '<span>Upcoming</span>' +
          '<span class="px-1.5 py-0.5 rounded text-[11px] ' + (currentTab === 'upcoming' ? 'bg-black/20 text-accent-ink' : 'bg-line text-muted') + '">' + upcomingCount + '</span>' +
        '</button>' +
        '<button data-adv-tab="past" class="flex-1 sm:flex-initial px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 sm:gap-2 ' +
          (currentTab === 'past' ? 'bg-accent text-accent-ink shadow-sm' : 'text-muted hover:text-ink') + '">' +
          ui.icon('clock', 'w-4 h-4') + '<span>Past Events</span>' +
          '<span class="px-1.5 py-0.5 rounded text-[11px] ' + (currentTab === 'past' ? 'bg-black/20 text-accent-ink' : 'bg-line text-muted') + '">' + pastCount + '</span>' +
        '</button>' +
      '</div>'
    );
  }

  /* ---- Compact Event Card in List View ---- */
  function renderEventCard(ev) {
    const reports = reportsFor(ev.id);
    const times = [ev.startTime, ev.finishTime].filter(Boolean).join(' \u2013 ');
    const techs = RMTP.eventTechnicians(ev).map(techLabel).filter(Boolean);
    const isCinema = isScreenSpace(ev.space);
    const mediaType = ev.media_type || ev.mediaType || '';
    const scheduleItems = Array.isArray(ev.schedule_items) ? ev.schedule_items : (Array.isArray(ev.scheduleItems) ? ev.scheduleItems : []);

    const leadTechStr = techs.length ? techs.join(', ') : 'Unassigned';
    const scheduleSummary = isCinema
      ? (mediaType ? 'Media: ' + mediaType : 'Cinema Screening')
      : (scheduleItems.length ? scheduleItems.length + ' set piece' + (scheduleItems.length > 1 ? 's' : '') : (ev.doors ? 'Doors ' + ev.doors : 'Live Event'));

    const checksCount = isCinema
      ? [ev.dcp_received !== undefined ? ev.dcp_received : ev.dcpReceived, ev.checks_completed !== undefined ? ev.checks_completed : ev.checksCompleted].filter(Boolean).length
      : 0;

    return (
      '<div data-event-card="' + ev.id + '" class="panel w-full p-4 sm:p-5 transition-all hover:border-accent hover:shadow-lg cursor-pointer group select-none relative flex flex-col justify-between gap-3">' +
        '<div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3 w-full">' +
          '<div class="min-w-0 flex-1 w-full">' +
            '<div class="flex items-center gap-2 flex-wrap mb-1.5">' +
              '<h3 class="font-display text-base sm:text-lg font-semibold text-ink group-hover:text-accent transition-colors break-words">' + ui.esc(ev.name) + '</h3>' +
              ui.pill(ev.status, statusColour[ev.status] || 'var(--muted)') +
              ui.pill(ev.space, isCinema ? 'var(--accent)' : 'var(--info)') +
              (ev.category ? ui.pill(ev.category, 'var(--muted)') : '') +
              (ev.guestEngineer ? ui.pill('Guest Engineer', 'var(--info)') : '') +
            '</div>' +
            '<div class="flex items-center gap-2 sm:gap-3 text-xs text-muted flex-wrap">' +
              (ev.date ? '<span class="flex items-center gap-1 font-medium text-ink">' + ui.icon('clock', 'w-3.5 h-3.5 text-accent') + ui.formatDate(ev.date) + (times ? ' (' + times + ')' : '') + '</span>' : '') +
              '<span class="w-1 h-1 rounded-full bg-line hidden sm:inline-block"></span>' +
              '<span>Techs: <strong class="text-ink font-normal">' + ui.esc(leadTechStr) + '</strong></span>' +
              '<span class="w-1 h-1 rounded-full bg-line"></span>' +
              '<span class="text-accent font-medium">' + ui.esc(scheduleSummary) + '</span>' +
              (isCinema && checksCount ? '<span class="w-1 h-1 rounded-full bg-line"></span><span class="text-ok font-semibold">' + checksCount + '/2 checks done</span>' : '') +
              (reports.length ? '<span class="w-1 h-1 rounded-full bg-line"></span><span class="text-ok font-semibold">' + reports.length + ' report' + (reports.length > 1 ? 's' : '') + '</span>' : '') +
            '</div>' +
          '</div>' +

          '<div class="flex items-center gap-1.5 shrink-0 self-end sm:self-start w-full sm:w-auto justify-end pt-2 sm:pt-0 border-t sm:border-t-0 border-line/40">' +
            '<button data-open-modal="' + ev.id + '" class="btn btn-ghost !py-1.5 !px-3 text-xs font-semibold text-accent flex items-center gap-1.5 hover:bg-accent/10 rounded-lg flex-1 sm:flex-initial justify-center">' +
              ui.icon('eye', 'w-4 h-4') + '<span>View Advance</span>' +
            '</button>' +
            '<button data-print="' + ev.id + '" class="btn btn-ghost !p-2" title="Export Advance PDF">' + ui.icon('print', 'w-4 h-4') + '</button>' +
            '<button data-reports="' + ev.id + '" class="btn btn-ghost !p-2" title="Shift Reports">' + ui.icon('clip', 'w-4 h-4') + '</button>' +
            (canManageEvents ?
              '<button data-edit="' + ev.id + '" class="btn btn-ghost !p-2" title="Edit Event">' + ui.icon('pen', 'w-4 h-4') + '</button>' +
              '<button data-del="' + ev.id + '" class="btn btn-danger !p-2" title="Delete Event">' + ui.icon('trash', 'w-4 h-4') + '</button>' : '') +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  /* ---- Pop-over Detail Modal with Darkened Backdrop ---- */
  function openEventModal(ev) {
    const reports = reportsFor(ev.id);
    const times = [ev.startTime, ev.finishTime].filter(Boolean).join(' \u2013 ');
    const techs = RMTP.eventTechnicians(ev).map(techLabel).filter(Boolean);
    const isCinema = isScreenSpace(ev.space);
    const mediaType = ev.media_type || ev.mediaType || '';
    const scheduleItems = Array.isArray(ev.schedule_items) ? ev.schedule_items : (Array.isArray(ev.scheduleItems) ? ev.scheduleItems : []);

    const dcpTesterName = (isCinema && ev.dcp_tester_user_id) ? userName(ev.dcp_tester_user_id) : '';
    const dcpTestTimeStr = (isCinema && ev.dcp_test_datetime) ? new Date(ev.dcp_test_datetime).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '';

    // Live Timings
    const liveTimingsHtml = !isCinema ? (
      '<div class="p-3.5 rounded-xl bg-panel2/40 border border-line">' +
        '<div class="eyebrow mb-2 text-accent flex items-center gap-1.5">' +
          ui.icon('clock', 'w-3.5 h-3.5') + '<span>Core Production Timings</span>' +
        '</div>' +
        '<div class="grid grid-cols-2 sm:grid-cols-6 gap-2">' +
          [
            ['Load In', ev.load_in || ev.loadIn || '—'],
            ['Soundcheck', ev.soundcheck || '—'],
            ['Doors', ev.doors || '—'],
            ['Off Stage', ev.off_stage || ev.offStage || '—'],
            ['Curfew', ev.curfew || '—'],
            ['Load Out', ev.load_out || ev.loadOut || '—'],
          ].map(([lbl, val]) => (
            '<div class="p-2 rounded-lg bg-panel border border-line/60">' +
              '<div class="text-[10px] font-semibold text-muted uppercase tracking-wider">' + ui.esc(lbl) + '</div>' +
              '<div class="text-sm font-semibold text-ink mt-0.5 font-mono">' + ui.esc(val) + '</div>' +
            '</div>'
          )).join('') +
        '</div>' +
      '</div>'
    ) : '';

    // Live Stage Schedule & Set Pieces
    const liveScheduleItemsHtml = !isCinema ? (
      '<div class="mt-3 p-3.5 rounded-xl bg-panel2/30 border border-line">' +
        '<div class="flex items-center justify-between gap-2 mb-2.5">' +
          '<div class="eyebrow text-ink font-semibold flex items-center gap-1.5">' +
            ui.icon('clip', 'w-3.5 h-3.5 text-accent') + '<span>Live Set Pieces & Stage Schedule</span>' +
          '</div>' +
          '<span class="text-xs font-mono text-muted">' + scheduleItems.length + ' item' + (scheduleItems.length === 1 ? '' : 's') + '</span>' +
        '</div>' +
        (scheduleItems.length ? (
          '<div class="grid gap-1.5">' +
            scheduleItems.map((item) => {
              const isAct = item.type === 'act';
              const isChangeover = item.type === 'changeover';
              const itemTitle = item.customName ? item.customName : (item.label || (isAct ? 'Act' : (isChangeover ? 'Changeover' : 'Item')));
              const badgeClass = isAct ? 'bg-accent/15 border-accent/40 text-accent' : (isChangeover ? 'bg-warning/15 border-warning/40 text-warning' : 'bg-info/15 border-info/40 text-info');
              return (
                '<div class="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-panel border border-line text-xs">' +
                  '<div class="flex items-center gap-2 min-w-0">' +
                    '<span class="px-2 py-0.5 rounded font-mono font-semibold text-[11px] border ' + badgeClass + '">' +
                      ui.esc(item.label || (isAct ? 'Act' : (isChangeover ? 'Changeover' : 'Other'))) +
                    '</span>' +
                    '<span class="font-medium text-ink truncate">' + ui.esc(itemTitle) + '</span>' +
                  '</div>' +
                  '<div class="flex items-center gap-3 shrink-0 font-mono text-muted">' +
                    (item.time ? '<span>Stage: <strong class="text-ink">' + ui.esc(item.time) + '</strong></span>' : '') +
                    (item.duration ? '<span>Set: <strong class="text-ink">' + ui.esc(item.duration) + '</strong></span>' : '') +
                  '</div>' +
                '</div>'
              );
            }).join('') +
          '</div>'
        ) : '<div class="text-xs text-muted italic">No set pieces or schedule items advanced yet.</div>') +
      '</div>'
    ) : '';

    // Cinema Checklist & DCP testing
    const cinemaDetailsHtml = isCinema ? (
      '<div class="grid gap-3">' +
        '<div class="p-3.5 rounded-xl bg-panel2/40 border border-line">' +
          '<div class="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2 border-b border-line/60">' +
            '<div class="flex items-center gap-1.5">' +
              ui.icon('film', 'w-4 h-4 text-accent') +
              '<span class="text-xs font-semibold text-accent">Cinema Screening Checklist & Format</span>' +
            '</div>' +
            (mediaType ? '<span class="text-xs font-semibold px-2 py-0.5 rounded bg-panel border border-accent/40 text-accent font-mono">Media: ' + ui.esc(mediaType) + '</span>' : '') +
          '</div>' +
          '<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">' +
            [
              { key: 'dcp_received', alt: 'dcpReceived', label: 'DCP Received?' },
              { key: 'checks_completed', alt: 'checksCompleted', label: 'Checks Completed' },
              { key: 'intermission', alt: 'intermission', label: 'Intermission?' },
              { key: 'qa', alt: 'qa', label: 'Q&A?' },
            ].map((c) => {
              const active = ev[c.key] !== undefined ? !!ev[c.key] : !!ev[c.alt];
              return (
                '<div class="flex items-center justify-between p-2.5 rounded-lg border ' +
                  (active ? 'bg-ok/10 border-ok/30' : 'bg-panel2/60 border-line') + '">' +
                  '<span class="text-xs text-muted font-medium">' + ui.esc(c.label) + '</span>' +
                  '<span class="text-xs font-semibold ' + (active ? 'text-ok' : 'text-danger') + '">' + (active ? 'Yes' : 'No') + '</span>' +
                '</div>'
              );
            }).join('') +
          '</div>' +
          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-line/50 text-xs">' +
            '<div class="p-2.5 rounded bg-panel border border-line/60 flex items-center justify-between">' +
              '<span class="text-muted">Testing Engineer:</span>' +
              '<span class="font-semibold text-ink">' + (dcpTesterName ? ui.esc(dcpTesterName) : '<span class="text-muted italic">Unassigned</span>') + '</span>' +
            '</div>' +
            '<div class="p-2.5 rounded bg-panel border border-line/60 flex items-center justify-between">' +
              '<span class="text-muted">Scheduled DCP Test:</span>' +
              '<span class="font-semibold text-ink font-mono">' + (dcpTestTimeStr ? ui.esc(dcpTestTimeStr) : '<span class="text-muted italic">Not scheduled</span>') + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    ) : '';

    const bodyHtml =
      '<div class="grid gap-4 text-sm">' +
        // Header summary bar
        '<div class="p-3 rounded-xl bg-panel2/50 border border-line flex flex-wrap items-center justify-between gap-2.5 text-xs">' +
          '<div class="flex items-center gap-3 flex-wrap">' +
            '<span class="flex items-center gap-1.5 font-semibold text-ink">' +
              ui.icon('clock', 'w-4 h-4 text-accent') +
              (ev.date ? ui.formatDate(ev.date) : 'TBC') + (times ? ' (' + times + ')' : '') +
            '</span>' +
            (isCinema && (ev.screening_starts_time || ev.screeningStartsTime) ?
              '<span class="px-2 py-0.5 rounded bg-panel border border-accent/30 text-accent font-semibold">Screening: ' + ui.esc(ev.screening_starts_time || ev.screeningStartsTime) + '</span>' : '') +
          '</div>' +
          '<div class="flex items-center gap-1.5 flex-wrap">' +
            ui.pill(ev.status, statusColour[ev.status] || 'var(--muted)') +
            ui.pill(ev.space, isCinema ? 'var(--accent)' : 'var(--info)') +
            (ev.category ? ui.pill(ev.category, 'var(--muted)') : '') +
            (ev.guestEngineer ? ui.pill('Guest Engineer', 'var(--info)') : '') +
          '</div>' +
        '</div>' +

        liveTimingsHtml +
        liveScheduleItemsHtml +
        cinemaDetailsHtml +

        // Technicians
        (techs.length ? (
          '<div class="p-3 rounded-xl bg-panel2/30 border border-line text-xs">' +
            '<span class="eyebrow block mb-1.5">Assigned Technicians</span>' +
            '<div class="flex items-center gap-1.5 flex-wrap">' + techs.map((t) => ui.pill(t, 'var(--info)')).join('') + '</div>' +
          '</div>'
        ) : '') +

        // Client Contact
        (ev.clientContact ? (
          '<div class="text-xs p-3 rounded-xl bg-panel2/20 border border-line flex items-center justify-between">' +
            '<span class="text-muted">Artist / Client Contact:</span>' +
            '<span class="font-medium text-ink">' + ui.esc(ev.clientContact) + '</span>' +
          '</div>'
        ) : '') +

        // Technical Notes
        (ev.techInfo ? (
          '<div class="p-3.5 rounded-xl bg-panel2/30 border border-line text-xs">' +
            '<span class="eyebrow block mb-1">Technical Notes</span>' +
            '<p class="text-ink/80 whitespace-pre-wrap leading-relaxed">' + ui.esc(ev.techInfo) + '</p>' +
          '</div>'
        ) : '') +

        // Tech Spec file
        (ev.techSpec ? (
          '<button id="modal-open-spec" class="inline-flex items-center gap-2 text-xs text-accent hover:underline self-start p-2.5 rounded-lg bg-panel border border-line">' +
            ui.icon('file', 'w-4 h-4') + '<span>Tech spec: <strong>' + ui.esc(ev.techSpec.name) + '</strong> (' + files.humanSize(ev.techSpec.size) + ')</span>' +
          '</button>'
        ) : '') +

        // Shift Reports Section
        '<div class="p-3.5 rounded-xl bg-panel2/40 border border-line">' +
          '<div class="flex items-center justify-between gap-2 mb-2.5">' +
            '<div class="eyebrow text-ink font-semibold flex items-center gap-1.5">' +
              ui.icon('clip', 'w-3.5 h-3.5 text-accent') + '<span>End-of-Shift Reports (' + reports.length + ')</span>' +
            '</div>' +
            '<button id="modal-manage-reports" class="btn btn-ghost !py-1 text-xs text-accent">' +
              (reports.length ? 'View All & Add Report' : '+ File Shift Report') +
            '</button>' +
          '</div>' +
          (reports.length ? (
            '<div class="grid gap-2 text-xs">' +
              reports.slice(0, 3).map((r) => (
                '<div class="p-2.5 rounded-lg bg-panel border border-line">' +
                  '<div class="flex items-center justify-between text-muted mb-1 text-[11px] font-semibold">' +
                    '<span>' + ui.esc(r.crew ? r.crew + ' Shift' : 'Shift Report') + ' \u00b7 ' + ui.esc(r.author || 'Technician') + '</span>' +
                    '<span class="font-mono">' + (r.submittedAt ? ui.formatDate(r.submittedAt.slice(0, 10)) : '') + '</span>' +
                  '</div>' +
                  (r.summary ? '<div class="text-ink font-medium">' + ui.esc(r.summary) + '</div>' : '') +
                  (r.issues ? '<div class="text-danger mt-1 text-[11px]"><strong>Issues:</strong> ' + ui.esc(r.issues) + '</div>' : '') +
                '</div>'
              )).join('') +
              (reports.length > 3 ? '<div class="text-[11px] text-muted text-center">+ ' + (reports.length - 3) + ' more reports</div>' : '') +
            '</div>'
          ) : '<div class="text-xs text-muted italic">No shift reports filed yet.</div>') +
        '</div>' +
      '</div>';

    const footerHtml =
      '<div class="flex items-center justify-between w-full gap-2 flex-wrap">' +
        '<div class="flex items-center gap-2">' +
          '<button id="modal-print-btn" class="btn btn-ghost text-xs flex items-center gap-1.5">' +
            ui.icon('print', 'w-4 h-4') + '<span>Print PDF</span>' +
          '</button>' +
          '<button id="modal-reports-btn" class="btn btn-ghost text-xs flex items-center gap-1.5">' +
            ui.icon('clip', 'w-4 h-4') + '<span>Reports (' + reports.length + ')</span>' +
          '</button>' +
        '</div>' +
        '<div class="flex items-center gap-2">' +
          (canManageEvents ?
            '<button id="modal-edit-btn" class="btn btn-ghost text-xs flex items-center gap-1.5">' +
              ui.icon('pen', 'w-4 h-4') + '<span>Edit</span>' +
            '</button>' +
            '<button id="modal-del-btn" class="btn btn-danger text-xs flex items-center gap-1.5">' +
              ui.icon('trash', 'w-4 h-4') + '<span>Delete</span>' +
            '</button>' : '') +
          '<button data-close class="btn btn-primary text-xs !px-4">Close</button>' +
        '</div>' +
      '</div>';

    const m = ui.modal({
      title: ev.name || 'Event Advance Details',
      body: bodyHtml,
      footer: footerHtml,
      size: 'md:max-w-3xl'
    });

    const specBtn = m.root.querySelector('#modal-open-spec');
    if (specBtn) specBtn.addEventListener('click', () => files.open(ev.techSpec));

    const printBtn = m.root.querySelector('#modal-print-btn');
    if (printBtn) printBtn.addEventListener('click', () => printAdvance(ev));

    const reportsBtn = m.root.querySelector('#modal-reports-btn');
    if (reportsBtn) reportsBtn.addEventListener('click', () => { m.close(); openReports(ev); });

    const manageReportsBtn = m.root.querySelector('#modal-manage-reports');
    if (manageReportsBtn) manageReportsBtn.addEventListener('click', () => { m.close(); openReports(ev); });

    const editBtn = m.root.querySelector('#modal-edit-btn');
    if (editBtn) editBtn.addEventListener('click', () => { m.close(); openForm(ev); });

    const delBtn = m.root.querySelector('#modal-del-btn');
    if (delBtn) delBtn.addEventListener('click', () => { m.close(); del(ev); });
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
    const scheduleItems = Array.isArray(ev.schedule_items) ? ev.schedule_items : (Array.isArray(ev.scheduleItems) ? ev.scheduleItems : []);

    const dcpTesterName = (isCinema && ev.dcp_tester_user_id) ? userName(ev.dcp_tester_user_id) : '';
    const dcpTestTimeStr = (isCinema && ev.dcp_test_datetime) ? new Date(ev.dcp_test_datetime).toLocaleString('en-GB') : '';

    const liveTimingsSection = !isCinema ? (
      '<div class="adv-print-section">' +
        '<div class="adv-print-section-title">Production Timings</div>' +
        '<div class="adv-print-grid">' +
          '<div class="adv-print-field"><div class="adv-print-label">Load In</div><div class="adv-print-val">' + ui.esc(ev.load_in || ev.loadIn || 'TBC') + '</div></div>' +
          '<div class="adv-print-field"><div class="adv-print-label">Soundcheck</div><div class="adv-print-val">' + ui.esc(ev.soundcheck || 'N/A') + '</div></div>' +
          '<div class="adv-print-field"><div class="adv-print-label">Doors</div><div class="adv-print-val">' + ui.esc(ev.doors || 'N/A') + '</div></div>' +
          '<div class="adv-print-field"><div class="adv-print-label">Off Stage</div><div class="adv-print-val">' + ui.esc(ev.off_stage || ev.offStage || 'TBC') + '</div></div>' +
          '<div class="adv-print-field"><div class="adv-print-label">Curfew</div><div class="adv-print-val">' + ui.esc(ev.curfew || 'N/A') + '</div></div>' +
          '<div class="adv-print-field"><div class="adv-print-label">Load Out</div><div class="adv-print-val">' + ui.esc(ev.load_out || ev.loadOut || 'TBC') + '</div></div>' +
        '</div>' +
      '</div>'
    ) : '';

    const liveScheduleSection = (!isCinema && scheduleItems.length) ? (
      '<div class="adv-print-section">' +
        '<div class="adv-print-section-title">Live Schedule & Set Pieces</div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:4px;">' +
          '<thead>' +
            '<tr style="border-bottom:1.5px solid #cbd5e1;text-align:left;color:#475569;font-size:11px;">' +
              '<th style="padding:4px 8px;">Type / Label</th>' +
              '<th style="padding:4px 8px;">Act / Description</th>' +
              '<th style="padding:4px 8px;">Stage Time</th>' +
              '<th style="padding:4px 8px;">Duration</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>' +
            scheduleItems.map((it) => (
              '<tr style="border-bottom:1px solid #e2e8f0;">' +
                '<td style="padding:6px 8px;font-weight:600;">' + ui.esc(it.label || it.type) + '</td>' +
                '<td style="padding:6px 8px;">' + ui.esc(it.customName || '—') + '</td>' +
                '<td style="padding:6px 8px;font-family:monospace;">' + ui.esc(it.time || '—') + '</td>' +
                '<td style="padding:6px 8px;font-family:monospace;">' + ui.esc(it.duration || '—') + '</td>' +
              '</tr>'
            )).join('') +
          '</tbody>' +
        '</table>' +
      '</div>'
    ) : '';

    const cinemaChecksHtml = isCinema ? (
      '<div class="adv-print-section">' +
        '<div class="adv-print-section-title" style="display:flex;justify-content:space-between;align-items:center;">' +
          '<span>Cinema Screening Checklist & Testing</span>' +
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
        '<div class="adv-print-grid" style="margin-top:8px;">' +
          '<div class="adv-print-field"><div class="adv-print-label">Testing Engineer</div><div class="adv-print-val">' + ui.esc(dcpTesterName || 'Unassigned') + '</div></div>' +
          '<div class="adv-print-field"><div class="adv-print-label">DCP Test Date/Time</div><div class="adv-print-val">' + ui.esc(dcpTestTimeStr || 'Not scheduled') + '</div></div>' +
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
          '</div>' +
        '</div>' +

        liveTimingsSection +
        liveScheduleSection +
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

  function formatShiftReportEmail(ev, r) {
    const dateStr = ev.date ? ui.formatDate(ev.date) : (r.shiftDate ? ui.formatDate(r.shiftDate) : ui.formatDate(new Date().toISOString().slice(0, 10)));
    const times = [ev.startTime, ev.finishTime].filter(Boolean).join(' \u2013 ');
    const techs = RMTP.eventTechnicians(ev).map(techLabel).filter(Boolean);
    const isCinema = isScreenSpace(ev.space);
    const scheduleItems = Array.isArray(ev.schedule_items) ? ev.schedule_items : (Array.isArray(ev.scheduleItems) ? ev.scheduleItems : []);

    // Subject format: Post Shift Report: [DATE] [Event Title]
    const subject = 'Post Shift Report: ' + dateStr + ' ' + (ev.name || 'Event');

    const authorUser = r.authorId ? store.find('users', r.authorId) : null;
    const authorName = r.author || (auth.current() ? auth.displayName(auth.current()) : 'Technician');
    const authorEmail = (authorUser && authorUser.email) ? authorUser.email : ((auth.current() && auth.current().email) ? auth.current().email : '');
    const authorStr = authorName + (authorEmail ? ' (' + authorEmail + ')' : '');

    const submittedDateObj = r.submittedAt ? new Date(r.submittedAt) : new Date();
    const timestampStr = submittedDateObj.toLocaleString('en-GB', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const plain = [
      'POST SHIFT REPORT \u2014 RICH MIX TECHNICAL OPERATIONS',
      '==================================================',
      'Subject: ' + subject,
      'Event Title: ' + (ev.name || 'N/A'),
      'Venue / Space: ' + (ev.space || 'N/A'),
      'Event Date: ' + dateStr,
      'Event Times: ' + (times || 'N/A'),
      'Shift / Crew: ' + (r.crew || 'General Shift'),
      'Submitting Engineer: ' + authorStr,
      'Date & Time Stamp: ' + timestampStr,
      '',
      '--------------------------------------------------',
      '1. SHIFT SUMMARY (HOW DID THE SHIFT GO?):',
      r.summary || 'No summary provided.',
      '',
      '2. ISSUES & EQUIPMENT FAULTS:',
      (r.issues || 'None reported (All systems & equipment operational).').trim(),
      '',
      '3. HANDOVER & FOLLOW-UP ACTIONS:',
      (r.followUp || 'None required.').trim(),
      '',
      '--------------------------------------------------',
      'EVENT ADVANCE OVERVIEW:',
      '- Assigned Technicians: ' + (techs.length ? techs.join(', ') : 'None assigned'),
      isCinema ? '- Cinema Screening Checks: DCP [' + ((ev.dcp_received !== undefined ? ev.dcp_received : ev.dcpReceived) ? 'YES' : 'NO') + '] | Checks Completed [' + ((ev.checks_completed !== undefined ? ev.checks_completed : ev.checksCompleted) ? 'YES' : 'NO') + '] | Intermission [' + (ev.intermission ? 'YES' : 'NO') + '] | Q&A [' + (ev.qa ? 'YES' : 'NO') + ']' : null,
      !isCinema && scheduleItems.length ? '- Live Schedule (' + scheduleItems.length + ' pieces): ' + scheduleItems.map((it) => (it.label || it.type) + (it.customName ? ' (' + it.customName + ')' : '') + (it.time ? ' @ ' + it.time : '')).join(' | ') : null,
      ev.clientContact ? '- Artist / Client Contact: ' + ev.clientContact : null,
      ev.techInfo ? '- Technical Notes: ' + ev.techInfo : null,
      '',
      '-- Automatically dispatched via Rich Mix Tech Portal --'
    ].filter((line) => line !== null).join('\n');

    return { subject, plain, dateStr, timestampStr, authorStr };
  }

  async function dispatchShiftReportEmail(ev, r, customRecipients) {
    const recipients = (customRecipients && customRecipients.length) ? customRecipients : getReportRecipients(ev);
    const { subject, plain, timestampStr, authorStr } = formatShiftReportEmail(ev, r);

    let edgeOk = false;
    if (RMTP.supabase && RMTP.supabase.isConfigured()) {
      try {
        const res = await RMTP.supabase.invokeFunction('send-shift-report', {
          to: recipients,
          subject: subject,
          body: plain,
          event: ev,
          report: Object.assign({}, r, {
            author: authorStr,
            submittedAt: r.submittedAt || new Date().toISOString()
          })
        });
        if (res && res.ok) edgeOk = true;
      } catch (e) {
        console.warn('[email] Supabase send-shift-report function unreachable, mailto fallback ready', e);
      }
    }

    const mailtoUrl = 'mailto:' + encodeURIComponent(recipients.join(',')) +
      '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(plain);

    return { recipients, subject, plain, edgeOk, mailtoUrl, timestampStr, authorStr };
  }

  const RECIPIENT_CATEGORIES = ['All', 'Programme', 'Cinema', 'Private Hires'];

  function openRecipientConfigModal() {
    let list = getReportRecipientRules(); // [{ email, category }]
    const categoryBadgeColors = {
      'All': 'bg-accent/15 text-accent border-accent/30',
      'Programme': 'bg-purple-500/15 text-purple-400 border-purple-500/30',
      'Cinema': 'bg-sky-500/15 text-sky-400 border-sky-500/30',
      'Private Hires': 'bg-amber-500/15 text-amber-400 border-amber-500/30'
    };

    const categoryOptionsHtml = (selectedVal) =>
      RECIPIENT_CATEGORIES.map((c) => '<option value="' + c + '" ' + (c === selectedVal ? 'selected' : '') + '>' + c + '</option>').join('');

    const m = ui.modal({
      title: 'Shift Report Email Recipients & Category Routing',
      size: 'md:max-w-xl',
      body:
        '<div class="grid gap-4">' +
          '<p class="text-xs text-muted leading-relaxed">Configure email recipients and the specific <strong>Event Category</strong> that will trigger reports to them. Select <strong class="text-accent">"All"</strong> to send all shift reports, or target specific streams like <strong class="text-ink">Programme</strong>, <strong class="text-ink">Cinema</strong>, or <strong class="text-ink">Private Hires</strong>.</p>' +
          '<div id="recipients-list" class="grid gap-2 max-h-72 overflow-y-auto pr-1"></div>' +
          '<div class="p-3 rounded-xl bg-panel2 border border-line grid gap-2">' +
            '<div class="text-[11px] font-semibold text-muted uppercase tracking-wider">Add New Recipient Rule</div>' +
            '<div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">' +
              '<input id="new-rec-email" type="email" class="field flex-1 text-xs" placeholder="e.g. cinema@richmix.org.uk" />' +
              '<select id="new-rec-cat" class="field !w-auto text-xs font-medium">' + categoryOptionsHtml('All') + '</select>' +
              '<button id="add-rec-btn" class="btn btn-primary shrink-0 text-xs py-2 px-3 flex items-center justify-center gap-1">' + ui.icon('plus', 'w-3.5 h-3.5') + 'Add</button>' +
            '</div>' +
          '</div>' +
        '</div>',
      footer:
        '<button class="btn btn-ghost" data-cancel>Close</button>' +
        '<button class="btn btn-primary" data-save data-primary>Save Recipient Rules</button>'
    });

    function renderList() {
      const cont = m.root.querySelector('#recipients-list');
      if (!cont) return;
      if (!list.length) {
        cont.innerHTML = '<p class="text-xs text-muted p-3 bg-panel rounded border border-line text-center">No recipients configured. Add at least one email address.</p>';
        return;
      }
      cont.innerHTML = list.map((item, idx) => {
        const badgeClass = categoryBadgeColors[item.category] || categoryBadgeColors['All'];
        return (
          '<div class="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 rounded-lg bg-panel2/60 border border-line gap-2">' +
            '<div class="flex items-center gap-2 min-w-0 flex-1">' +
              '<span class="w-1.5 h-1.5 rounded-full bg-accent shrink-0"></span>' +
              '<span class="text-xs font-mono text-ink truncate">' + ui.esc(item.email) + '</span>' +
            '</div>' +
            '<div class="flex items-center gap-2 self-end sm:self-auto shrink-0">' +
              '<select data-change-cat="' + idx + '" class="field !py-1 !px-2 text-xs font-medium !w-auto bg-panel border-line text-ink">' +
                categoryOptionsHtml(item.category) +
              '</select>' +
              '<span class="px-2 py-0.5 rounded text-[10px] font-semibold border ' + badgeClass + '">' + ui.esc(item.category || 'All') + '</span>' +
              '<button type="button" data-rm-rec="' + idx + '" class="btn btn-danger !p-1.5" title="Remove recipient">' + ui.icon('trash', 'w-3.5 h-3.5') + '</button>' +
            '</div>' +
          '</div>'
        );
      }).join('');

      cont.querySelectorAll('[data-change-cat]').forEach((sel) => sel.addEventListener('change', (e) => {
        const idx = +sel.getAttribute('data-change-cat');
        if (list[idx]) {
          list[idx].category = sel.value;
          renderList();
        }
      }));

      cont.querySelectorAll('[data-rm-rec]').forEach((b) => b.addEventListener('click', () => {
        const idx = +b.getAttribute('data-rm-rec');
        list.splice(idx, 1);
        renderList();
      }));
    }
    renderList();

    const addBtn = m.root.querySelector('#add-rec-btn');
    const input = m.root.querySelector('#new-rec-email');
    const catSelect = m.root.querySelector('#new-rec-cat');

    function addEmail() {
      const val = input.value.trim().toLowerCase();
      const cat = catSelect ? catSelect.value : 'All';
      if (!val || val.indexOf('@') === -1) {
        ui.toast('Enter a valid email address', 'danger');
        return;
      }
      const existingIdx = list.findIndex((x) => x.email === val);
      if (existingIdx !== -1) {
        list[existingIdx].category = cat;
        ui.toast('Updated category for existing recipient', 'info');
      } else {
        list.push({ email: val, category: cat });
      }
      input.value = '';
      renderList();
    }
    if (addBtn) addBtn.addEventListener('click', addEmail);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addEmail(); } });

    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);
    m.root.querySelector('[data-save]').addEventListener('click', () => {
      saveReportRecipients(list);
      ui.toast('Email recipients updated (' + list.length + ' rule' + (list.length === 1 ? '' : 's') + ')', 'ok');
      m.close();
      RMTP.router.render();
    });
  }

  /* ---- Database Sync Verification Inspector ---- */
  async function openSyncVerificationModal() {
    if (!isAdmin) {
      ui.toast('Admin permission required to verify database sync', 'danger');
      return;
    }
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
      const unsupp = res.unsupportedCols && res.unsupportedCols.advancing;

      const migrationHtml = (unsupp && unsupp.length) ? (
        '<div class="p-3 rounded-lg bg-accent/10 border border-accent/30 text-xs mt-2">' +
          '<div class="font-semibold text-accent flex items-center gap-1.5 mb-1">' +
            ui.icon('info', 'w-4 h-4') +
            '<span>Remote Schema Compatibility Active</span>' +
          '</div>' +
          '<p class="text-ink/80 mb-2">The remote database schema is missing the following column(s): <code class="font-mono font-semibold text-accent bg-panel px-1 py-0.5 rounded">' + ui.esc(unsupp.join(', ')) + '</code>. ' +
          'All fields remain safely persisted in your browser offline cache. To persist these columns in Supabase, execute this in the Supabase SQL editor:</p>' +
          '<pre class="p-2 rounded bg-panel font-mono text-[11px] select-all border border-line overflow-x-auto text-ink">' +
            unsupp.map((c) => 'alter table public.advancing add column if not exists "' + c + '" ' + (c.includes('items') || c.includes('technicians') ? "jsonb default '[]'::jsonb;" : (c.includes('received') || c.includes('completed') || c.includes('intermission') || c.includes('qa') || c.includes('guest') ? 'boolean default false;' : "text default '';"))).join('\n') +
          '</pre>' +
        '</div>'
      ) : '';

      det.innerHTML =
        '<div class="grid grid-cols-2 gap-2 mt-2">' +
          '<div class="p-3 rounded-lg bg-panel2/40 border border-line">' +
            '<div class="eyebrow">Advancing Collection</div>' +
            '<div class="text-sm font-semibold mt-1">Local: ' + advLocal + ' \u00b7 Supabase: ' + advRemote + '</div>' +
            '<div class="text-[11px] text-muted mt-0.5">' + (unsupp && unsupp.length ? unsupp.length + ' legacy remote column(s) pruned' : 'Columns verified & active') + '</div>' +
          '</div>' +
          '<div class="p-3 rounded-lg bg-panel2/40 border border-line">' +
            '<div class="eyebrow">Reports Collection</div>' +
            '<div class="text-sm font-semibold mt-1">Local: ' + repLocal + ' \u00b7 Supabase: ' + repRemote + '</div>' +
            '<div class="text-[11px] text-muted mt-0.5">Columns: summary, issues, followUp, eventId verified</div>' +
          '</div>' +
        '</div>' +
        migrationHtml +
        '<div class="p-3 rounded-lg bg-panel2/40 border border-line mt-2">' +
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
          (isAdmin ? '<button id="rep-recipients-btn" class="btn btn-ghost !py-1.5 text-xs">' + ui.icon('mail', 'w-3.5 h-3.5') + 'Email Recipients</button>' : '') +
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
        showEmailSummaryModal(ev, r, dispatch);
      });
      const dBtn = m.root.querySelector('[data-rdel="' + r.id + '"]'); if (dBtn) dBtn.addEventListener('click', async () => {
        const ok = await ui.confirm('Delete this shift report?', { title: 'Delete report', confirmLabel: 'Delete', danger: true });
        if (ok) { store.remove('reports', r.id); ui.toast('Report deleted', 'ok'); refresh(); }
      });
    });
  }

  function showEmailSummaryModal(ev, r, dispatch) {
    const gmailUrl = 'https://mail.google.com/mail/?view=cm&fs=1' +
      '&to=' + encodeURIComponent(dispatch.recipients.join(',')) +
      '&su=' + encodeURIComponent(dispatch.subject) +
      '&body=' + encodeURIComponent(dispatch.plain);

    const modal = ui.modal({
      title: 'Shift Report Email Summary',
      size: 'md:max-w-xl',
      body:
        '<div class="grid gap-3">' +
          '<div class="p-3 rounded-lg bg-panel2/60 border border-line flex items-center justify-between gap-2">' +
            '<div class="min-w-0">' +
              '<label class="eyebrow">Recipients (' + dispatch.recipients.length + ')</label>' +
              '<p class="text-xs font-mono text-ink mt-0.5 truncate">' + ui.esc(dispatch.recipients.join(', ')) + '</p>' +
            '</div>' +
            '<button id="btn-copy-recipients" class="btn btn-ghost !py-1 text-xs shrink-0">' + ui.icon('clip', 'w-3.5 h-3.5') + 'Copy list</button>' +
          '</div>' +
          '<div>' +
            '<label class="eyebrow">Subject</label>' +
            '<p class="text-xs font-medium text-ink mt-0.5 bg-panel2/40 p-2 rounded border border-line">' + ui.esc(dispatch.subject) + '</p>' +
          '</div>' +
          '<div>' +
            '<div class="flex items-center justify-between mb-1">' +
              '<label class="eyebrow">Message Body</label>' +
              '<button id="btn-copy-body" class="text-xs text-accent hover:underline flex items-center gap-1">' + ui.icon('clip', 'w-3 h-3') + 'Copy message text</button>' +
            '</div>' +
            '<pre id="email-preview-body" class="p-3 bg-panel2 rounded-lg text-xs whitespace-pre-wrap font-mono max-h-56 overflow-y-auto border border-line text-ink select-all">' + ui.esc(dispatch.plain) + '</pre>' +
          '</div>' +
        '</div>',
      footer:
        '<div class="flex flex-wrap items-center gap-2 mr-auto">' +
          '<a href="' + dispatch.mailtoUrl + '" class="btn btn-primary">' + ui.icon('mail', 'w-4 h-4') + 'Open in Email App</a>' +
          '<a href="' + gmailUrl + '" target="_blank" rel="noopener noreferrer" class="btn btn-ghost text-xs">' + ui.icon('globe', 'w-3.5 h-3.5') + 'Gmail Web</a>' +
        '</div>' +
        '<button class="btn btn-ghost" data-close-preview>Done</button>'
    });

    const cpRec = modal.root.querySelector('#btn-copy-recipients');
    if (cpRec) cpRec.addEventListener('click', () => {
      navigator.clipboard.writeText(dispatch.recipients.join(', ')).then(() => ui.toast('Recipients copied to clipboard', 'ok'));
    });

    const cpBody = modal.root.querySelector('#btn-copy-body');
    if (cpBody) cpBody.addEventListener('click', () => {
      navigator.clipboard.writeText(dispatch.plain).then(() => ui.toast('Report body copied to clipboard', 'ok'));
    });

    modal.root.querySelector('[data-close-preview]').addEventListener('click', modal.close);
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
    const defaultRecs = getReportRecipients(ev);

    const m = ui.modal({
      title: (existing ? 'Edit' : 'End-of-shift') + ' report \u2014 ' + ev.name,
      size: 'md:max-w-xl',
      body:
        '<div class="grid gap-4">' +
          '<p class="text-xs text-muted">Filed as <span class="text-ink font-medium">' + ui.esc(auth.displayName(auth.current()) || 'you') + '</span> \u00b7 for the shift on <span class="text-ink font-medium">' + ui.esc(shiftLabel) + '</span></p>' +
          fld('Crew / shift', '<input id="r-crew" class="field" value="' + ui.esc(r.crew || '') + '" placeholder="e.g. Show, Get-out, Night Shift" />') +
          fld('How did the shift go? (Summary)', '<textarea id="r-summary" class="field" rows="3" placeholder="Overview of the event / night\u2026">' + ui.esc(r.summary || '') + '</textarea>') +
          fld('Issues / equipment faults', '<textarea id="r-issues" class="field" rows="2" placeholder="Anything that broke, glitches, or equipment needing repair\u2026">' + ui.esc(r.issues || '') + '</textarea>') +
          fld('Handover / follow-up actions', '<textarea id="r-follow" class="field" rows="2" placeholder="Tasks or notes for the next shift or Technical Management\u2026">' + ui.esc(r.followUp || '') + '</textarea>') +
          '<div class="panel bg-panel2/50 p-3 rounded-lg border border-line">' +
            '<div class="flex items-center justify-between mb-2">' +
              '<label class="flex items-center gap-2 text-xs font-semibold cursor-pointer">' +
                '<input type="checkbox" id="r-auto-email" class="w-4 h-4 accent-[var(--accent)]" checked />' +
                '<span>Auto-send post shift report email</span>' +
              '</label>' +
              '<button type="button" id="r-edit-recipients" class="text-xs text-accent hover:underline flex items-center gap-1">' + ui.icon('pen', 'w-3 h-3') + 'Edit recipients</button>' +
            '</div>' +
            '<div class="text-[11px] text-muted mb-1">' +
              'Subject: <span class="font-mono text-ink font-semibold">Post Shift Report: ' + ui.esc(ev.date ? ui.formatDate(ev.date) : ui.formatDate(new Date().toISOString().slice(0, 10))) + ' ' + ui.esc(ev.name || 'Event') + '</span>' +
            '</div>' +
            '<div class="text-[11px] text-muted font-mono flex items-center gap-1.5 flex-wrap">' +
              '<span class="text-ink font-sans font-medium">To (' + defaultRecs.length + '):</span>' +
              defaultRecs.map((em) => '<span class="px-1.5 py-0.5 rounded bg-panel border border-line text-ink">' + ui.esc(em) + '</span>').join('') +
            '</div>' +
          '</div>' +
        '</div>',
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-save data-primary>' + (existing ? 'Save changes' : 'File and send report') + '</button>',
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
      const shouldEmail = m.root.querySelector('#r-auto-email') ? m.root.querySelector('#r-auto-email').checked : true;

      if (!summary && !issues && !followUp) { ui.toast('Add at least a summary', 'danger'); return; }
      const meNow = auth.current();
      const now = new Date().toISOString();
      const base = {
        id: r.id || store.uid('rep'),
        eventId: ev.id,
        crew: m.root.querySelector('#r-crew').value.trim(),
        shiftDate: ev.date || '',
        summary,
        issues,
        followUp
      };
      const record = existing
        ? Object.assign({}, r, base, { updatedAt: now, updatedBy: auth.displayName(meNow) })
        : Object.assign(base, { authorId: meNow ? meNow.id : null, author: auth.displayName(meNow) || 'Technician', submittedAt: now, updatedAt: now });
      store.upsert('reports', record);

      m.close();
      RMTP.router.render();
      const f = store.find('advancing', ev.id);
      if (f) openReports(f);

      if (shouldEmail) {
        const dispatch = await dispatchShiftReportEmail(ev, record);
        if (dispatch.edgeOk) {
          ui.toast('Shift report filed & emailed to ' + dispatch.recipients.length + ' recipient' + (dispatch.recipients.length === 1 ? '' : 's'), 'ok');
        } else {
          showEmailSummaryModal(ev, record, dispatch);
          ui.toast('Shift report filed \u2014 email ready for dispatch', 'ok');
        }
      } else {
        ui.toast(existing ? 'Report updated' : 'Report filed', 'ok');
      }
    });
  }

  /* ---- Event form (Live vs Cinema Space Routing) ---- */
  function openForm(existing) {
    const ev = existing || {};
    const opt = (arr, val) => arr.map((v) => '<option ' + (v === val ? 'selected' : '') + '>' + v + '</option>').join('');
    const blankOpt = (arr, val, blank) => '<option value="" ' + (!val ? 'selected' : '') + '>' + blank + '</option>' +
      arr.map((v) => '<option ' + (v === val ? 'selected' : '') + '>' + v + '</option>').join('');

    let techs = RMTP.eventTechnicians(ev).map((t) => ({ userId: t.userId, role: t.role || '' }));

    // Dynamic schedule items for Live spaces: [{ type, label, customName, time, duration }]
    let scheduleItems = Array.isArray(ev.schedule_items) ? JSON.parse(JSON.stringify(ev.schedule_items))
      : (Array.isArray(ev.scheduleItems) ? JSON.parse(JSON.stringify(ev.scheduleItems)) : []);

    const originalSpec = ev.techSpec || null;
    let specMeta = originalSpec;
    let pending = null;
    let cleared = false;

    const initialSpace = ev.space || RMTP.SPACES[0] || 'The Stage';
    const isScreenInitial = isScreenSpace(initialSpace);

    const allUsers = store.all('users');
    const userOptionsHtml = (selectedId) =>
      '<option value="">Select engineer\u2026</option>' +
      allUsers.map((u) => '<option value="' + u.id + '" ' + (u.id === selectedId ? 'selected' : '') + '>' + ui.esc(auth.displayName(u)) + '</option>').join('');

    const m = ui.modal({
      title: existing ? 'Edit Technical Advance' : 'Create Technical Advance',
      size: 'md:max-w-3xl',
      body:
        '<div class="grid gap-4">' +
          '<div class="grid sm:grid-cols-[1fr_150px] gap-4">' +
            fld('Event title', '<input id="e-name" class="field font-medium" value="' + ui.esc(ev.name || '') + '" placeholder="Artist / show name" />') +
            fld('Status', '<select id="e-status" class="field">' + opt(STATUSES, ev.status || 'Advancing') + '</select>') +
          '</div>' +

          '<div class="grid grid-cols-2 sm:grid-cols-3 gap-4">' +
            fld('Category', '<select id="e-category" class="field">' + blankOpt(RMTP.EVENT_CATEGORIES, ev.category, '\u2014') + '</select>') +
            fld('Space / Room', '<select id="e-space" class="field font-semibold text-accent">' + blankOpt(RMTP.SPACES, ev.space, 'Select Space\u2026') + '</select>') +
            fld('Event Date', '<input id="e-date" type="date" class="field" value="' + ui.esc(ev.date || '') + '" />') +
          '</div>' +

          // Running times row (common to both)
          '<div class="grid grid-cols-2 gap-4">' +
            fld('Overall Start Time', '<input id="e-start" type="time" class="field font-mono" value="' + ui.esc(ev.startTime || '') + '" />') +
            fld('Overall Finish Time', '<input id="e-finish" type="time" class="field font-mono" value="' + ui.esc(ev.finishTime || '') + '" />') +
          '</div>' +

          /* ================= LIVE EVENTS SECTION ================= */
          '<div id="section-live-advancing" class="' + (isScreenInitial ? 'hidden' : '') + ' p-4 rounded-xl bg-panel2/40 border border-line grid gap-4">' +
            '<div class="flex items-center justify-between pb-2 border-b border-line/60">' +
              '<div class="flex items-center gap-1.5">' +
                ui.icon('clock', 'w-4 h-4 text-accent') +
                '<span class="text-xs font-semibold text-accent">Live Event Standard Core Timings</span>' +
              '</div>' +
              '<span class="text-[11px] text-muted font-mono">24-hour format (HH:MM)</span>' +
            '</div>' +

            '<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">' +
              fld('Load In', '<input id="e-load-in" type="time" class="field font-mono" value="' + ui.esc(ev.load_in || ev.loadIn || '') + '" />') +
              fld('Soundcheck', '<input id="e-sc" type="time" class="field font-mono" value="' + ui.esc(ev.soundcheck || '') + '" />') +
              fld('Doors', '<input id="e-doors" type="time" class="field font-mono" value="' + ui.esc(ev.doors || '') + '" />') +
              fld('Off Stage', '<input id="e-off-stage" type="time" class="field font-mono" value="' + ui.esc(ev.off_stage || ev.offStage || '') + '" />') +
              fld('Curfew', '<input id="e-curfew" type="time" class="field font-mono" value="' + ui.esc(ev.curfew || '') + '" />') +
              fld('Load Out', '<input id="e-load-out" type="time" class="field font-mono" value="' + ui.esc(ev.load_out || ev.loadOut || '') + '" />') +
            '</div>' +

            '<div class="pt-2 border-t border-line/60">' +
              '<div class="flex items-center justify-between mb-3">' +
                '<div>' +
                  '<label class="block text-sm font-semibold text-ink">Schedule & Set Pieces Builder</label>' +
                  '<p class="text-xs text-muted">Sequence acts, changeovers, speeches, and other scheduled set pieces.</p>' +
                '</div>' +
                '<div class="flex items-center gap-1.5">' +
                  '<div class="relative inline-block text-left" id="add-schedule-menu-wrap">' +
                    '<button type="button" id="btn-add-schedule-menu" class="btn btn-ghost !py-1.5 text-xs text-accent font-semibold flex items-center gap-1">' +
                      ui.icon('plus', 'w-3.5 h-3.5') + '<span>+ Add Schedule Item</span>' + ui.icon('arrowD', 'w-3 h-3') +
                    '</button>' +
                    '<div id="schedule-dropdown" class="hidden absolute right-0 mt-1 w-44 rounded-lg bg-panel border border-line shadow-xl z-20 py-1 text-xs">' +
                      '<button type="button" data-add-type="act" class="w-full text-left px-3 py-2 hover:bg-panel2 flex items-center gap-2">' +
                        ui.icon('plus', 'w-3.5 h-3.5 text-accent') + '<span>Act (Auto-numbered)</span>' +
                      '</button>' +
                      '<button type="button" data-add-type="changeover" class="w-full text-left px-3 py-2 hover:bg-panel2 flex items-center gap-2">' +
                        ui.icon('reset', 'w-3.5 h-3.5 text-warning') + '<span>Changeover</span>' +
                      '</button>' +
                      '<button type="button" data-add-type="other" class="w-full text-left px-3 py-2 hover:bg-panel2 flex items-center gap-2">' +
                        ui.icon('clip', 'w-3.5 h-3.5 text-info') + '<span>Other Piece</span>' +
                      '</button>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div id="schedule-items-container" class="grid gap-2.5"></div>' +
            '</div>' +
          '</div>' +

          /* ================= CINEMA SCREENINGS SECTION ================= */
          '<div id="section-cinema-advancing" class="' + (isScreenInitial ? '' : 'hidden') + ' p-4 rounded-xl bg-panel2/40 border border-line grid gap-4">' +
            '<div class="flex items-center justify-between pb-2 border-b border-line/60">' +
              '<div class="flex items-center gap-1.5">' +
                ui.icon('film', 'w-4 h-4 text-accent') +
                '<span class="text-xs font-semibold text-accent">Cinema Screening Checklist & DCP Details</span>' +
              '</div>' +
              '<span class="text-[11px] text-muted">Auditorium Screen Advance</span>' +
            '</div>' +

            '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">' +
              fld('Screening Starts Time', '<input id="e-screening-starts" type="time" class="field font-mono" value="' + ui.esc(ev.screening_starts_time || ev.screeningStartsTime || '') + '" />') +
              fld('Media Type', '<select id="e-media-type" class="field">' + blankOpt(RMTP.MEDIA_TYPES, ev.media_type || ev.mediaType, 'Select Media\u2026') + '</select>') +
            '</div>' +

            '<div>' +
              '<label class="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Screening Checklist</label>' +
              '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">' +
                '<label class="flex items-center gap-2 text-xs font-medium cursor-pointer p-2 rounded-lg bg-panel border border-line">' +
                  '<input type="checkbox" id="e-dcp" class="w-4 h-4 accent-[var(--ok)]" ' + ((ev.dcp_received !== undefined ? ev.dcp_received : ev.dcpReceived) ? 'checked' : '') + ' />' +
                  '<span>DCP Received</span>' +
                '</label>' +
                '<label class="flex items-center gap-2 text-xs font-medium cursor-pointer p-2 rounded-lg bg-panel border border-line">' +
                  '<input type="checkbox" id="e-checks" class="w-4 h-4 accent-[var(--ok)]" ' + ((ev.checks_completed !== undefined ? ev.checks_completed : ev.checksCompleted) ? 'checked' : '') + ' />' +
                  '<span>Checks Completed</span>' +
                '</label>' +
                '<label class="flex items-center gap-2 text-xs font-medium cursor-pointer p-2 rounded-lg bg-panel border border-line">' +
                  '<input type="checkbox" id="e-intermission" class="w-4 h-4 accent-[var(--ok)]" ' + (ev.intermission ? 'checked' : '') + ' />' +
                  '<span>Intermission?</span>' +
                '</label>' +
                '<label class="flex items-center gap-2 text-xs font-medium cursor-pointer p-2 rounded-lg bg-panel border border-line">' +
                  '<input type="checkbox" id="e-qa" class="w-4 h-4 accent-[var(--ok)]" ' + (ev.qa ? 'checked' : '') + ' />' +
                  '<span>Q&A?</span>' +
                '</label>' +
              '</div>' +
            '</div>' +

            '<div class="pt-2 border-t border-line/60 grid grid-cols-1 sm:grid-cols-2 gap-4">' +
              fld('Testing Engineer', '<select id="e-dcp-tester" class="field">' + userOptionsHtml(ev.dcp_tester_user_id || ev.dcpTesterUserId || '') + '</select>') +
              fld('Testing Date & Time', '<input id="e-dcp-test-datetime" type="datetime-local" class="field font-mono" value="' + ui.esc(ev.dcp_test_datetime || ev.dcpTestDatetime || '') + '" />') +
            '</div>' +
          '</div>' +

          /* ================= CREW & DETAILS SECTION ================= */
          fld('Assigned Technicians', '<div id="e-tech-area"></div>') +
          fld('Artist / Client contact', '<input id="e-contact" class="field" value="' + ui.esc(ev.clientContact || '') + '" placeholder="Tour manager / client name & contact" />') +
          fld('Technical notes & requirements', '<textarea id="e-info" class="field" rows="3" placeholder="Power requirements, split boxes, staging notes, audio input list\u2026">' + ui.esc(ev.techInfo || '') + '</textarea>') +
          fld('Event Shift Report Email Recipients (Optional Override)', '<input id="e-email-recipients" class="field font-mono text-xs" value="' + ui.esc(Array.isArray(ev.email_recipients || ev.emailRecipients) ? (ev.email_recipients || ev.emailRecipients).join(', ') : (ev.email_recipients || ev.emailRecipients || '')) + '" placeholder="Leave blank to use Advancing page recipients (' + getReportRecipients().join(', ') + ')" />') +
          '<div>' +
            '<div class="flex items-center gap-3 mb-2">' +
              '<label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="e-guest" class="w-4 h-4 accent-[var(--accent)]" ' + (ev.guestEngineer ? 'checked' : '') + ' /><span class="text-sm font-medium">Visiting / Guest Sound or Lighting Engineer</span></label>' +
            '</div>' +
          '</div>' +
          '<div><label class="block text-sm font-medium mb-2">Tech Spec (PDF)</label><div id="e-spec-area"></div></div>' +
        '</div>',
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-save data-primary>' + (existing ? 'Save changes' : 'Add event') + '</button>',
    });

    // Space Selection dynamic routing
    const spaceSelect = m.root.querySelector('#e-space');
    const liveSection = m.root.querySelector('#section-live-advancing');
    const cinemaSection = m.root.querySelector('#section-cinema-advancing');

    function updateSpaceWorkflow() {
      const isScreen = isScreenSpace(spaceSelect.value);
      if (liveSection) liveSection.classList.toggle('hidden', isScreen);
      if (cinemaSection) cinemaSection.classList.toggle('hidden', !isScreen);
    }
    if (spaceSelect) spaceSelect.addEventListener('change', updateSpaceWorkflow);

    /* ---- Live Schedule Builder UI Wiring ---- */
    const menuBtn = m.root.querySelector('#btn-add-schedule-menu');
    const dropdown = m.root.querySelector('#schedule-dropdown');

    if (menuBtn && dropdown) {
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('hidden');
      });
      document.addEventListener('click', () => dropdown.classList.add('hidden'));
    }

    m.root.querySelectorAll('[data-add-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = btn.getAttribute('data-add-type');
        dropdown.classList.add('hidden');
        if (type === 'act') {
          const actCount = scheduleItems.filter((it) => it.type === 'act').length + 1;
          scheduleItems.push({
            type: 'act',
            label: 'Act ' + actCount,
            customName: '',
            time: '',
            duration: '00:30'
          });
        } else if (type === 'changeover') {
          scheduleItems.push({
            type: 'changeover',
            label: 'Changeover',
            customName: '',
            time: '',
            duration: '00:15'
          });
        } else {
          scheduleItems.push({
            type: 'other',
            label: 'Other',
            customName: '',
            time: '',
            duration: '00:30'
          });
        }
        renderScheduleBuilder();
      });
    });

    function renderScheduleBuilder() {
      const container = m.root.querySelector('#schedule-items-container');
      if (!container) return;

      if (!scheduleItems.length) {
        container.innerHTML = '<div class="text-xs text-muted italic p-3 rounded-lg bg-panel border border-dashed border-line text-center">No schedule set pieces added yet. Click "+ Add Schedule Item" to add acts, changeovers, or speeches.</div>';
        return;
      }

      container.innerHTML = scheduleItems.map((item, idx) => {
        const isAct = item.type === 'act';
        const isChangeover = item.type === 'changeover';
        const isOther = item.type === 'other';

        return (
          '<div class="p-3 rounded-lg bg-panel border border-line flex flex-col gap-2 relative group">' +
            '<div class="flex items-center justify-between gap-2">' +
              '<div class="flex items-center gap-2">' +
                (isAct ? (
                  '<span class="px-2 py-0.5 rounded font-mono font-semibold text-xs bg-accent/15 border border-accent/40 text-accent">' + ui.esc(item.label || 'Act') + '</span>'
                ) : isChangeover ? (
                  '<span class="px-2 py-0.5 rounded font-mono font-semibold text-xs bg-warning/15 border border-warning/40 text-warning">Changeover</span>'
                ) : (
                  '<input data-sch-label="' + idx + '" class="field !py-1 !px-2 !w-28 text-xs font-semibold" value="' + ui.esc(item.label || 'Other') + '" placeholder="e.g. DJ, Speeches" />'
                )) +
                '<span class="text-xs text-muted font-mono">#' + (idx + 1) + '</span>' +
              '</div>' +

              '<div class="flex items-center gap-1 shrink-0">' +
                '<button type="button" data-sch-up="' + idx + '" class="btn btn-ghost !p-1.5" title="Move Up" ' + (idx === 0 ? 'disabled' : '') + '>' + ui.icon('arrowU', 'w-3.5 h-3.5') + '</button>' +
                '<button type="button" data-sch-down="' + idx + '" class="btn btn-ghost !p-1.5" title="Move Down" ' + (idx === scheduleItems.length - 1 ? 'disabled' : '') + '>' + ui.icon('arrowD', 'w-3.5 h-3.5') + '</button>' +
                '<button type="button" data-sch-del="' + idx + '" class="btn btn-danger !p-1.5" title="Remove Item">' + ui.icon('trash', 'w-3.5 h-3.5') + '</button>' +
              '</div>' +
            '</div>' +

            '<div class="grid grid-cols-1 sm:grid-cols-[1fr_130px_130px] gap-2 pt-1">' +
              '<div>' +
                '<input data-sch-name="' + idx + '" class="field !py-1 !px-2 text-xs" value="' + ui.esc(item.customName || '') + '" ' +
                  'placeholder="' + (isAct ? 'Artist / Act Name (e.g. Main Band)' : (isChangeover ? 'Notes (optional)' : 'Item Name / Detail')) + '" />' +
              '</div>' +
              (!isChangeover ? (
                '<div class="flex items-center gap-1.5">' +
                  '<span class="text-[11px] text-muted whitespace-nowrap shrink-0">Stage:</span>' +
                  '<input data-sch-time="' + idx + '" type="time" class="field !py-1 !px-2 font-mono text-xs flex-1" value="' + ui.esc(item.time || '') + '" />' +
                '</div>'
              ) : '<div class="text-xs text-muted flex items-center italic">— No stage time —</div>') +
              '<div class="flex items-center gap-1.5">' +
                '<span class="text-[11px] text-muted whitespace-nowrap shrink-0">Duration:</span>' +
                '<input data-sch-dur="' + idx + '" type="text" pattern="[0-9]{2}:[0-9]{2}" class="field !py-1 !px-2 font-mono text-xs flex-1" value="' + ui.esc(item.duration || '') + '" placeholder="00:30" title="Format: HH:MM (e.g. 00:30 for 30 mins)" />' +
              '</div>' +
            '</div>' +
          '</div>'
        );
      }).join('');

      // Wire schedule events
      container.querySelectorAll('[data-sch-label]').forEach((inp) => {
        inp.addEventListener('input', () => { scheduleItems[+inp.getAttribute('data-sch-label')].label = inp.value; });
      });
      container.querySelectorAll('[data-sch-name]').forEach((inp) => {
        inp.addEventListener('input', () => { scheduleItems[+inp.getAttribute('data-sch-name')].customName = inp.value; });
      });
      container.querySelectorAll('[data-sch-time]').forEach((inp) => {
        inp.addEventListener('change', () => { scheduleItems[+inp.getAttribute('data-sch-time')].time = inp.value; });
      });
      container.querySelectorAll('[data-sch-dur]').forEach((inp) => {
        inp.addEventListener('input', () => { scheduleItems[+inp.getAttribute('data-sch-dur')].duration = inp.value; });
      });
      container.querySelectorAll('[data-sch-up]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = +btn.getAttribute('data-sch-up');
          if (idx > 0) {
            const temp = scheduleItems[idx];
            scheduleItems[idx] = scheduleItems[idx - 1];
            scheduleItems[idx - 1] = temp;
            renderScheduleBuilder();
          }
        });
      });
      container.querySelectorAll('[data-sch-down]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = +btn.getAttribute('data-sch-down');
          if (idx < scheduleItems.length - 1) {
            const temp = scheduleItems[idx];
            scheduleItems[idx] = scheduleItems[idx + 1];
            scheduleItems[idx + 1] = temp;
            renderScheduleBuilder();
          }
        });
      });
      container.querySelectorAll('[data-sch-del]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = +btn.getAttribute('data-sch-del');
          scheduleItems.splice(idx, 1);
          renderScheduleBuilder();
        });
      });
    }
    renderScheduleBuilder();

    // Tech crew builder
    function techAreaHtml() {
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

    // PDF upload handler
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

        // Live space timings
        load_in: !isScreen && m.root.querySelector('#e-load-in') ? m.root.querySelector('#e-load-in').value : (ev.load_in || ev.loadIn || ''),
        soundcheck: !isScreen && m.root.querySelector('#e-sc') ? m.root.querySelector('#e-sc').value : (ev.soundcheck || ''),
        doors: !isScreen && m.root.querySelector('#e-doors') ? m.root.querySelector('#e-doors').value : (ev.doors || ''),
        off_stage: !isScreen && m.root.querySelector('#e-off-stage') ? m.root.querySelector('#e-off-stage').value : (ev.off_stage || ev.offStage || ''),
        curfew: !isScreen && m.root.querySelector('#e-curfew') ? m.root.querySelector('#e-curfew').value : (ev.curfew || ''),
        load_out: !isScreen && m.root.querySelector('#e-load-out') ? m.root.querySelector('#e-load-out').value : (ev.load_out || ev.loadOut || ''),
        schedule_items: !isScreen ? scheduleItems : (ev.schedule_items || ev.scheduleItems || []),

        // Cinema space timings & checks
        screening_starts_time: isScreen && m.root.querySelector('#e-screening-starts') ? m.root.querySelector('#e-screening-starts').value : (ev.screening_starts_time || ev.screeningStartsTime || ''),
        media_type: isScreen && m.root.querySelector('#e-media-type') ? m.root.querySelector('#e-media-type').value : (ev.media_type || ev.mediaType || ''),
        dcp_received: isScreen && m.root.querySelector('#e-dcp') ? m.root.querySelector('#e-dcp').checked : (ev.dcp_received !== undefined ? !!ev.dcp_received : !!ev.dcpReceived),
        checks_completed: isScreen && m.root.querySelector('#e-checks') ? m.root.querySelector('#e-checks').checked : (ev.checks_completed !== undefined ? !!ev.checks_completed : !!ev.checksCompleted),
        intermission: isScreen && m.root.querySelector('#e-intermission') ? m.root.querySelector('#e-intermission').checked : !!ev.intermission,
        qa: isScreen && m.root.querySelector('#e-qa') ? m.root.querySelector('#e-qa').checked : !!ev.qa,
        dcp_tester_user_id: isScreen && m.root.querySelector('#e-dcp-tester') ? m.root.querySelector('#e-dcp-tester').value : (ev.dcp_tester_user_id || ev.dcpTesterUserId || ''),
        dcp_test_datetime: isScreen && m.root.querySelector('#e-dcp-test-datetime') ? m.root.querySelector('#e-dcp-test-datetime').value : (ev.dcp_test_datetime || ev.dcpTestDatetime || ''),

        technicians: finalTechs,
        clientContact: m.root.querySelector('#e-contact').value.trim(),
        guestEngineer: m.root.querySelector('#e-guest').checked,
        techInfo: m.root.querySelector('#e-info').value.trim(),
        email_recipients: m.root.querySelector('#e-email-recipients') ? m.root.querySelector('#e-email-recipients').value.trim() : (ev.email_recipients || ev.emailRecipients || ''),
        techSpec: finalSpec,
        checklist: ev.checklist || { techSpecSent: false, inputListReceived: false, stagePlot: false, schedule: false, backline: false, hospitality: false, parkingAccess: false },
      });

      store.upsert('advancing', record);
      m.close();
      ui.toast(existing ? 'Event advance updated' : 'Event advance created', 'ok');
      RMTP.router.render();
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
