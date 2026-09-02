/* ============================================================
   views/advancing.js — event advancing, checklists & shift reports
   ------------------------------------------------------------
   Events carry: category, space, times, assigned technicians,
   live schedule / set pieces (for live spaces), screening checks &
   DCP testing info (for cinema spaces), tech-info note, tech-spec PDF,
   and guest-engineer flag. End-of-shift reports live in `reports`
   collection keyed by eventId.
   ============================================================ */
RMTP.views.advancing = function (el, params, query) {
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

  // Handle direct event target from routing params or query
  const targetEventId = (params && params[0]) || (query && (query.id || query.event || query.eventId));
  if (targetEventId) {
    const targetEv = store.find('advancing', targetEventId);
    if (targetEv) {
      if (isPastEvent(targetEv.date)) {
        filters.tab = 'past';
      }
      if (filters.space && filters.space !== targetEv.space) {
        filters.space = '';
      }
      if (filters.date && filters.date !== targetEv.date) {
        filters.date = '';
      }
    }
  }

  function isScreenSpace(spaceName) {
    return spaceName === 'Screen One' || spaceName === 'Screen Two' || spaceName === 'Screen Three';
  }

  /* ---- Production Package Helpers ---- */
  function getProductionPackage(ev) {
    if (!ev) return { lighting_notes: '', floor_package: '', floor_tags: [], specials: {}, special_notes: '' };
    const pkg = ev.production_package || {};
    return {
      lighting_notes: pkg.lighting_notes || ev.lighting_notes || '',
      floor_package: pkg.floor_package || ev.floor_package || '',
      floor_tags: Array.isArray(pkg.floor_tags) ? pkg.floor_tags : (Array.isArray(ev.floor_tags) ? ev.floor_tags : []),
      specials: pkg.specials || ev.specials || {},
      special_notes: pkg.special_notes || ev.special_notes || '',
    };
  }

  function renderProductionBadges(ev, compact) {
    const prod = getProductionPackage(ev);
    const badges = [];
    const s = prod.specials || {};

    if (s.hazer) {
      badges.push(
        '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30' + (compact ? ' !px-1.5 !text-[10px]' : '') + '" title="Hazer / Smoke machine active (Smoke detector isolation required)">' +
          ui.icon('wind', 'w-3 h-3') + '<span>Hazer / Smoke</span></span>'
      );
    }
    if (s.lasers) {
      badges.push(
        '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30' + (compact ? ' !px-1.5 !text-[10px]' : '') + '" title="Class 3B/4 Lasers in production">' +
          ui.icon('zap', 'w-3 h-3') + '<span>Lasers</span></span>'
      );
    }
    if (s.heavy_power || (prod.floor_tags && prod.floor_tags.some((t) => t.indexOf('3-Phase') > -1 || t.indexOf('32A') > -1 || t.indexOf('63A') > -1))) {
      badges.push(
        '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-orange-500/15 text-orange-400 border border-orange-500/30' + (compact ? ' !px-1.5 !text-[10px]' : '') + '" title="Heavy power drops required (16A/32A/63A / 3-Phase)">' +
          ui.icon('zap', 'w-3 h-3') + '<span>Heavy Power</span></span>'
      );
    }
    if (s.video) {
      badges.push(
        '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/30' + (compact ? ' !px-1.5 !text-[10px]' : '') + '" title="Video / Projection in production">' +
          ui.icon('screen', 'w-3 h-3') + '<span>Video / Projection</span></span>'
      );
    }
    if (s.pyro) {
      badges.push(
        '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/30' + (compact ? ' !px-1.5 !text-[10px]' : '') + '" title="Pyrotechnics / Confetti in production">' +
          ui.icon('sparkles', 'w-3 h-3') + '<span>Pyro / Confetti</span></span>'
      );
    }
    if ((prod.floor_package && prod.floor_package.trim()) || (prod.floor_tags && prod.floor_tags.length)) {
      badges.push(
        '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30' + (compact ? ' !px-1.5 !text-[10px]' : '') + '" title="Incoming Touring Floor Package">' +
          ui.icon('box', 'w-3 h-3') + '<span>Floor Package</span></span>'
      );
    }
    if (prod.lighting_notes && prod.lighting_notes.trim()) {
      badges.push(
        '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-yellow-500/15 text-yellow-400 border border-yellow-500/30' + (compact ? ' !px-1.5 !text-[10px]' : '') + '" title="Lighting Rig Plan on file">' +
          ui.icon('bulb', 'w-3 h-3') + '<span>LX Rig Plan</span></span>'
      );
    }

    return badges.join(' ');
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
    const evTechs = RMTP.eventTechnicians(e).map((t) => t.userId);
    const leadId = RMTP.getAdvancingLeadId(e);
    if (leadId) evTechs.push(leadId);
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
      if (e.target.closest('select') || e.target.closest('input') || e.target.closest('label')) return;
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

  // Quick status change selector for admins
  el.querySelectorAll('[data-quick-status]').forEach((sel) => {
    sel.addEventListener('click', (e) => e.stopPropagation());
    sel.addEventListener('change', (e) => {
      e.stopPropagation();
      const id = sel.getAttribute('data-quick-status');
      const targetEv = store.find('advancing', id);
      if (targetEv) {
        const newStatus = sel.value;
        const updated = Object.assign({}, targetEv, { status: newStatus });
        store.upsert('advancing', updated);
        ui.toast('Advance status updated to ' + newStatus, 'ok');
        RMTP.router.render();
      }
    });
  });

  // Automatically open target event modal or maintenance form if directed
  if (targetEventId) {
    const targetEv = store.find('advancing', targetEventId);
    if (targetEv) {
      setTimeout(() => {
        openEventModal(targetEv);
        const card = el.querySelector('[data-event-card="' + targetEv.id + '"]');
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
    }
  }
  if (query && query.action === 'schedule-maintenance') {
    setTimeout(() => {
      const faultId = query.faultId;
      const fault = faultId ? store.find('maintenance', faultId) : null;
      openForm({
        name: fault ? 'Maintenance: ' + (fault.equipment || fault.space || 'Repair') : 'Maintenance Shift',
        category: 'Maintenance',
        space: fault ? fault.space : 'Screen One',
        date: getTodayString(),
        linked_maintenance_ids: faultId ? [faultId] : []
      });
    }, 50);
  }

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

    const leadUserId = RMTP.getAdvancingLeadId(ev);
    const leadUser = leadUserId ? store.find('users', leadUserId) : null;
    const leadName = leadUser ? auth.displayName(leadUser) : '';

    const leadTechStr = techs.length ? techs.join(', ') : 'Unassigned';
    const scheduleSummary = isCinema
      ? (mediaType ? 'Media: ' + mediaType : 'Cinema Screening')
      : (scheduleItems.length ? scheduleItems.length + ' set piece' + (scheduleItems.length > 1 ? 's' : '') : (ev.doors ? 'Doors ' + ev.doors : 'Live Event'));

    const checksCount = isCinema
      ? [ev.dcp_received !== undefined ? ev.dcp_received : ev.dcpReceived, ev.checks_completed !== undefined ? ev.checks_completed : ev.checksCompleted].filter(Boolean).length
      : 0;

    const prodBadges = renderProductionBadges(ev, false);

    const statusControl = canManageEvents
      ? '<div class="inline-flex items-center gap-1" onclick="event.stopPropagation()">' +
          '<select data-quick-status="' + ev.id + '" class="field !py-1 !pl-2.5 !pr-7 text-xs font-semibold rounded-md border cursor-pointer hover:border-accent shadow-2xs" style="color:' + (statusColour[ev.status] || 'var(--ink)') + ';background-position:right 8px center;" title="Change Advancing Status">' +
            STATUSES.map((st) => '<option value="' + st + '" ' + (st === ev.status ? 'selected' : '') + '>' + st + '</option>').join('') +
          '</select>' +
        '</div>'
      : ui.pill(ev.status, statusColour[ev.status] || 'var(--muted)');

    return (
      '<div data-event-card="' + ev.id + '" class="panel w-full p-4 sm:p-5 transition-all hover:border-accent hover:shadow-lg cursor-pointer group select-none relative flex flex-col justify-between gap-3">' +
        '<div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3 w-full">' +
          '<div class="min-w-0 flex-1 w-full">' +
            '<div class="flex items-center gap-2 flex-wrap mb-1.5">' +
              '<h3 class="font-display text-base sm:text-lg font-semibold text-ink group-hover:text-accent transition-colors break-words">' + ui.esc(ev.name) + '</h3>' +
              statusControl +
              ui.pill(ev.space, isCinema ? 'var(--accent)' : 'var(--info)') +
              (leadName ? ui.pill('Lead: ' + leadName, 'var(--accent)') : '') +
              (ev.category ? ui.pill(ev.category, 'var(--muted)') : '') +
              (ev.guestEngineer ? ui.pill('Guest Engineer', 'var(--info)') : '') +
            '</div>' +
            '<div class="flex items-center gap-2 sm:gap-3 text-xs text-muted flex-wrap">' +
              (ev.date ? '<span class="flex items-center gap-1 font-medium text-ink">' + ui.icon('clock', 'w-3.5 h-3.5 text-accent') + ui.formatDate(ev.date) + (times ? ' (' + times + ')' : '') + '</span>' : '') +
              (leadName ? '<span class="w-1 h-1 rounded-full bg-line hidden sm:inline-block"></span><span class="hidden sm:inline-block">Advancing Lead: <strong class="text-accent font-medium">' + ui.esc(leadName) + '</strong></span>' : '') +
              '<span class="w-1 h-1 rounded-full bg-line hidden sm:inline-block"></span>' +
              '<span>Techs: <strong class="text-ink font-normal">' + ui.esc(leadTechStr) + '</strong></span>' +
              '<span class="w-1 h-1 rounded-full bg-line"></span>' +
              '<span class="text-accent font-medium">' + ui.esc(scheduleSummary) + '</span>' +
              (isCinema && checksCount ? '<span class="w-1 h-1 rounded-full bg-line"></span><span class="text-ok font-semibold">' + checksCount + '/2 checks done</span>' : '') +
              (reports.length ? '<span class="w-1 h-1 rounded-full bg-line"></span><span class="text-ok font-semibold">' + reports.length + ' report' + (reports.length > 1 ? 's' : '') + '</span>' : '') +
            '</div>' +
            (prodBadges ? '<div class="flex items-center gap-1.5 flex-wrap mt-2.5 pt-2 border-t border-line/50">' + prodBadges + '</div>' : '') +
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
    const leadUserId = RMTP.getAdvancingLeadId(ev);
    const leadUser = leadUserId ? store.find('users', leadUserId) : null;
    const isCinema = isScreenSpace(ev.space);
    const mediaType = ev.media_type || ev.mediaType || '';
    const filmDuration = ev.film_duration || ev.filmDuration || '';
    const scheduleItems = Array.isArray(ev.schedule_items) ? ev.schedule_items : (Array.isArray(ev.scheduleItems) ? ev.scheduleItems : []);

    const dcpTesterName = (isCinema && ev.dcp_tester_user_id) ? userName(ev.dcp_tester_user_id) : '';
    const dcpTestTimeStr = (isCinema && ev.dcp_test_datetime) ? new Date(ev.dcp_test_datetime).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '';
    const dcpTestEvent = ev.dcp_test_event_id ? store.find('advancing', ev.dcp_test_event_id) : null;
    const dcpParentEvent = ev.dcp_parent_event_id ? store.find('advancing', ev.dcp_parent_event_id) : null;

    const techReqs = ev.tech_requirements || ev.techRequirements || {};
    const channelInputs = (techReqs.channel_list && Array.isArray(techReqs.channel_list.inputs)) ? techReqs.channel_list.inputs : [];
    const channelOutputs = (techReqs.channel_list && Array.isArray(techReqs.channel_list.outputs)) ? techReqs.channel_list.outputs : [];

    const linkedMaintIds = Array.isArray(ev.linked_maintenance_ids || ev.linkedMaintenanceIds) ? (ev.linked_maintenance_ids || ev.linkedMaintenanceIds) : [];
    const linkedFaults = store.all('maintenance').filter((f) => linkedMaintIds.indexOf(f.id) !== -1);

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
          '<div class="grid gap-2">' +
            scheduleItems.map((item, idx) => {
              const isAct = item.type === 'act';
              const isChangeover = item.type === 'changeover';
              const itemTitle = item.customName ? item.customName : (item.label || (isAct ? 'Act' : (isChangeover ? 'Changeover' : 'Item')));
              const badgeClass = isAct ? 'bg-accent/15 border-accent/40 text-accent' : (isChangeover ? 'bg-warning/15 border-warning/40 text-warning' : 'bg-info/15 border-info/40 text-info');

              const hasNotes = !!(item.techNotes && item.techNotes.trim());
              const hasFile = !!item.techFile;
              const hasInputs = !!(Array.isArray(item.channelInputs) && item.channelInputs.length);
              const hasOutputs = !!(Array.isArray(item.channelOutputs) && item.channelOutputs.length);
              const hasChannels = hasInputs || hasOutputs;

              let badgeParts = [];
              if (hasNotes) badgeParts.push('<span class="text-[10px] px-1.5 py-0.5 rounded bg-panel border border-accent/40 text-accent font-semibold">Rich Text</span>');
              if (hasFile) badgeParts.push('<span class="text-[10px] px-1.5 py-0.5 rounded bg-panel border border-info/40 text-info font-semibold">PDF Rider</span>');
              if (hasChannels) {
                const inCount = item.channelInputs ? item.channelInputs.length : 0;
                const outCount = item.channelOutputs ? item.channelOutputs.length : 0;
                badgeParts.push('<span class="text-[10px] px-1.5 py-0.5 rounded bg-panel border border-ok/40 text-ok font-semibold font-mono">' +
                  (inCount ? inCount + ' In' : '') + (inCount && outCount ? ' · ' : '') + (outCount ? outCount + ' Out' : (!inCount ? '0 Patch' : '')) +
                '</span>');
              }
              let techReqBadge = badgeParts.join(' ');

              return (
                '<div class="p-2.5 rounded-lg bg-panel border border-line flex flex-col gap-2 text-xs">' +
                  '<div class="flex flex-wrap items-center justify-between gap-2">' +
                    '<div class="flex items-center gap-2 min-w-0">' +
                      '<span class="px-2 py-0.5 rounded font-mono font-semibold text-[11px] border ' + badgeClass + '">' +
                        ui.esc(item.label || (isAct ? 'Act' : (isChangeover ? 'Changeover' : 'Other'))) +
                      '</span>' +
                      '<span class="font-medium text-ink truncate">' + ui.esc(itemTitle) + '</span>' +
                      techReqBadge +
                    '</div>' +
                    '<div class="flex items-center gap-3 shrink-0 font-mono text-muted">' +
                      (item.time ? '<span>Stage: <strong class="text-ink">' + ui.esc(item.time) + '</strong></span>' : '') +
                      (item.duration ? '<span>Set: <strong class="text-ink">' + ui.esc(item.duration) + '</strong></span>' : '') +
                    '</div>' +
                  '</div>' +

                  // Technical Requirements detail for this act
                  (hasNotes ? (
                    '<div class="p-2 rounded bg-panel2/50 border border-line text-[11px] text-ink/90 whitespace-pre-wrap font-mono">' +
                      '<div class="text-[10px] font-sans font-bold text-accent uppercase tracking-wider mb-1 flex items-center gap-1">' +
                        ui.icon('clip', 'w-3 h-3') + '<span>Technical Notes & Requirements:</span>' +
                      '</div>' +
                      ui.esc(item.techNotes) +
                    '</div>'
                  ) : '') +

                  (hasFile ? (
                    '<div class="flex items-center gap-2 pt-1">' +
                      '<button type="button" data-act-file-idx="' + idx + '" class="btn btn-ghost !py-1 !px-2.5 text-xs flex items-center gap-1.5 border border-line bg-panel2/60 hover:bg-panel2 text-accent">' +
                        ui.icon('file', 'w-3.5 h-3.5') +
                        '<span>Tech Rider: <strong>' + ui.esc(item.techFile.name) + '</strong></span>' +
                        '<span class="text-[10px] text-muted">(' + files.humanSize(item.techFile.size) + ')</span>' +
                      '</button>' +
                    '</div>'
                  ) : '') +

                  (hasInputs ? (
                    '<div class="p-2 rounded bg-panel2/40 border border-line text-[11px]">' +
                      '<div class="text-[10px] font-sans font-bold text-accent uppercase tracking-wider mb-1.5 flex items-center justify-between">' +
                        '<span>Act Inputs (' + item.channelInputs.length + ' Ch)</span>' +
                      '</div>' +
                      '<div class="grid gap-1">' +
                        item.channelInputs.map((ch, chI) => (
                          '<div class="flex items-center justify-between p-1 px-2 rounded bg-panel border border-line/60 font-mono text-[11px]">' +
                            '<div class="flex items-center gap-2">' +
                              '<span class="font-bold text-accent">Ch ' + (ch.channel || (chI + 1)) + '</span>' +
                              '<span class="text-ink font-sans font-medium">' + ui.esc(ch.instrument || 'Input') + '</span>' +
                              (ch.mic ? '<span class="text-muted text-[10px]">(' + ui.esc(ch.mic) + ')</span>' : '') +
                            '</div>' +
                            '<div class="flex items-center gap-2 text-muted text-[10px]">' +
                              (ch.stand ? '<span>' + ui.esc(ch.stand) + '</span>' : '') +
                              (ch.pos ? '<span>\u00b7 ' + ui.esc(ch.pos) + '</span>' : '') +
                              (ch.phantom ? '<span class="text-danger font-bold">+48V</span>' : '') +
                            '</div>' +
                          '</div>'
                        )).join('') +
                      '</div>' +
                    '</div>'
                  ) : '') +

                  (hasOutputs ? (
                    '<div class="p-2 rounded bg-panel2/40 border border-line text-[11px]">' +
                      '<div class="text-[10px] font-sans font-bold text-info uppercase tracking-wider mb-1.5 flex items-center justify-between">' +
                        '<span>Act Outputs & Monitors (' + item.channelOutputs.length + ' Out)</span>' +
                      '</div>' +
                      '<div class="grid gap-1">' +
                        item.channelOutputs.map((out, outI) => (
                          '<div class="flex items-center justify-between p-1 px-2 rounded bg-panel border border-line/60 font-mono text-[11px]">' +
                            '<div class="flex items-center gap-2">' +
                              '<span class="font-bold text-info">Out ' + (out.num || (outI + 1)) + (out.stereo ? ' (St)' : '') + '</span>' +
                              '<span class="text-ink font-sans font-medium">' + ui.esc(out.name || out.dest || 'Mix') + '</span>' +
                              (out.type ? '<span class="text-muted text-[10px]">[' + ui.esc(out.type) + ']</span>' : '') +
                            '</div>' +
                            '<div class="text-muted text-[10px]">' +
                              (out.dest ? '<span>' + ui.esc(out.dest) + '</span>' : '') +
                            '</div>' +
                          '</div>'
                        )).join('') +
                      '</div>' +
                    '</div>'
                  ) : '') +
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
            '<div class="flex items-center gap-2">' +
              (filmDuration ? '<span class="text-xs font-semibold px-2 py-0.5 rounded bg-panel border border-line text-ink font-mono">Duration: ' + ui.esc(filmDuration) + '</span>' : '') +
              (mediaType ? '<span class="text-xs font-semibold px-2 py-0.5 rounded bg-panel border border-accent/40 text-accent font-mono">Media: ' + ui.esc(mediaType) + '</span>' : '') +
            '</div>' +
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
          (dcpTestEvent ? (
            '<div class="mt-2 p-2 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-between text-xs">' +
              '<span class="text-accent font-medium flex items-center gap-1.5">' + ui.icon('calendar', 'w-3.5 h-3.5') + 'Linked Calendar DCP Test Shift</span>' +
              '<button type="button" id="btn-open-linked-dcp" class="btn btn-primary !py-1 !px-2 text-xs">View DCP Shift</button>' +
            '</div>'
          ) : '') +
          (dcpParentEvent ? (
            '<div class="mt-2 p-2 rounded-lg bg-info/10 border border-info/30 flex items-center justify-between text-xs">' +
              '<span class="text-info font-medium flex items-center gap-1.5">' + ui.icon('film', 'w-3.5 h-3.5') + 'DCP Test for: ' + ui.esc(dcpParentEvent.name) + '</span>' +
              '<button type="button" id="btn-open-parent-event" class="btn btn-ghost !py-1 !px-2 text-xs text-info">View Main Event</button>' +
            '</div>'
          ) : '') +
        '</div>' +
      '</div>'
    ) : '';

    // Channel list (Inputs & Outputs)
    const channelListHtml = (channelInputs.length || channelOutputs.length) ? (
      '<div class="p-3.5 rounded-xl bg-panel2/30 border border-line text-xs">' +
        '<div class="flex items-center justify-between pb-2 mb-2 border-b border-line/60">' +
          '<div class="eyebrow text-ink font-semibold flex items-center gap-1.5">' +
            ui.icon('sliders', 'w-3.5 h-3.5 text-accent') + '<span>Global / Festival Patch List (Custom List)</span>' +
          '</div>' +
          '<span class="text-muted font-mono">' + channelInputs.length + ' inputs \u00b7 ' + channelOutputs.length + ' outputs</span>' +
        '</div>' +
        (channelInputs.length ? (
          '<div class="mb-3">' +
            '<div class="text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">Input Patch</div>' +
            '<div class="overflow-x-auto rounded-lg border border-line">' +
              '<table class="w-full text-left text-xs border-collapse">' +
                '<thead><tr class="bg-panel2 border-b border-line text-muted text-[11px] font-medium">' +
                  '<th class="p-2">Ch</th><th class="p-2">Patch</th><th class="p-2">Instrument</th><th class="p-2">Mic / DI</th><th class="p-2">Stand</th><th class="p-2">Position</th><th class="p-2">+48V</th>' +
                '</tr></thead>' +
                '<tbody class="divide-y divide-line">' +
                  channelInputs.map((ch, i) => (
                    '<tr class="hover:bg-panel2/40">' +
                      '<td class="p-2 font-mono font-semibold text-accent">Ch ' + (ch.channel || (i + 1)) + '</td>' +
                      '<td class="p-2 font-mono text-muted text-[10px]">' + ui.esc(ch.patch || '—') + '</td>' +
                      '<td class="p-2 font-medium text-ink">' + ui.esc(ch.instrument || '—') + '</td>' +
                      '<td class="p-2 text-muted">' + ui.esc(ch.mic || '—') + '</td>' +
                      '<td class="p-2 text-muted">' + ui.esc(ch.stand || '—') + '</td>' +
                      '<td class="p-2 text-muted">' + ui.esc(ch.pos || '—') + '</td>' +
                      '<td class="p-2 font-mono ' + (ch.phantom ? 'text-danger font-bold' : 'text-muted') + '">' + (ch.phantom ? '+48V' : '—') + '</td>' +
                    '</tr>'
                  )).join('') +
                '</tbody>' +
              '</table>' +
            '</div>' +
          '</div>'
        ) : '') +
        (channelOutputs.length ? (
          '<div>' +
            '<div class="text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">Outputs & Monitors</div>' +
            '<div class="overflow-x-auto rounded-lg border border-line">' +
              '<table class="w-full text-left text-xs border-collapse">' +
                '<thead><tr class="bg-panel2 border-b border-line text-muted text-[11px] font-medium">' +
                  '<th class="p-2">Out</th><th class="p-2">Label</th><th class="p-2">Type</th><th class="p-2">Destination / Mix</th>' +
                '</tr></thead>' +
                '<tbody class="divide-y divide-line">' +
                  channelOutputs.map((out, i) => (
                    '<tr class="hover:bg-panel2/40">' +
                      '<td class="p-2 font-mono font-semibold text-info">Out ' + (out.num || (i + 1)) + (out.stereo ? ' (St)' : '') + '</td>' +
                      '<td class="p-2 font-medium text-ink">' + ui.esc(out.name || '—') + '</td>' +
                      '<td class="p-2 text-muted">' + ui.esc(out.type || '—') + '</td>' +
                      '<td class="p-2 text-muted">' + ui.esc(out.dest || '—') + '</td>' +
                    '</tr>'
                  )).join('') +
                '</tbody>' +
              '</table>' +
            '</div>' +
          '</div>'
        ) : '') +
      '</div>'
    ) : '';

    // Linked Maintenance Tasks
    const linkedMaintenanceHtml = linkedFaults.length ? (
      '<div class="p-3.5 rounded-xl bg-panel2/40 border border-warning/30 text-xs">' +
        '<div class="flex items-center justify-between pb-2 mb-2 border-b border-line/60">' +
          '<div class="eyebrow text-warning font-semibold flex items-center gap-1.5">' +
            ui.icon('tool', 'w-3.5 h-3.5 text-warning') + '<span>Linked Maintenance Tasks (' + linkedFaults.length + ')</span>' +
          '</div>' +
          '<a href="#/maintenance" class="text-xs text-accent hover:underline">Open Maintenance Log &rarr;</a>' +
        '</div>' +
        '<div class="grid gap-2">' +
          linkedFaults.map((f) => (
            '<div class="p-2.5 rounded-lg bg-panel border border-line flex items-center justify-between gap-3">' +
              '<div class="min-w-0 flex-1">' +
                '<div class="font-medium text-ink truncate">' + ui.esc(f.title || f.equipment || 'Fault') + '</div>' +
                '<div class="text-[11px] text-muted">' + ui.esc(f.space || f.location || 'Venue') + (f.description ? ' \u00b7 ' + ui.esc(f.description) : '') + '</div>' +
              '</div>' +
              ui.pill(f.status || 'Reported', f.status === 'Resolved' ? 'var(--ok)' : (f.status === 'In Progress' ? 'var(--info)' : 'var(--warning)')) +
            '</div>'
          )).join('') +
        '</div>' +
      '</div>'
    ) : '';

    // Lighting & Production Package
    const prod = getProductionPackage(ev);
    const hasLighting = !!(prod.lighting_notes && prod.lighting_notes.trim());
    const hasFloor = !!((prod.floor_package && prod.floor_package.trim()) || (prod.floor_tags && prod.floor_tags.length));
    const s = prod.specials || {};
    const hasSpecials = !!(s.hazer || s.lasers || s.heavy_power || s.video || s.pyro || (prod.special_notes && prod.special_notes.trim()));
    const hasAnyProduction = hasLighting || hasFloor || hasSpecials;

    const lightingProductionHtml = hasAnyProduction ? (
      '<div class="p-3.5 rounded-xl bg-panel2/40 border border-line text-xs grid gap-3">' +
        '<div class="flex items-center justify-between pb-2 border-b border-line/60 flex-wrap gap-2">' +
          '<div class="eyebrow text-ink font-semibold flex items-center gap-1.5">' +
            ui.icon('bulb', 'w-4 h-4 text-warning') + '<span>Lighting & Production Package</span>' +
          '</div>' +
          '<div class="flex items-center gap-1.5 flex-wrap">' +
            renderProductionBadges(ev, true) +
          '</div>' +
        '</div>' +

        (hasLighting ? (
          '<div class="p-3 rounded-lg bg-panel border border-line/70">' +
            '<div class="text-[11px] font-semibold text-warning uppercase tracking-wider mb-1 flex items-center gap-1.5">' +
              ui.icon('bulb', 'w-3.5 h-3.5') + '<span>Lighting Notes & Rig Plan</span>' +
            '</div>' +
            '<p class="text-ink/90 whitespace-pre-wrap leading-relaxed font-sans text-xs">' + ui.esc(prod.lighting_notes) + '</p>' +
          '</div>'
        ) : '') +

        (hasFloor ? (
          '<div class="p-3 rounded-lg bg-panel border border-line/70">' +
            '<div class="text-[11px] font-semibold text-indigo-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">' +
              ui.icon('box', 'w-3.5 h-3.5') + '<span>Incoming Touring Floor Package</span>' +
            '</div>' +
            (prod.floor_package ? '<p class="text-ink/90 whitespace-pre-wrap leading-relaxed font-sans text-xs mb-2">' + ui.esc(prod.floor_package) + '</p>' : '') +
            (prod.floor_tags && prod.floor_tags.length ? (
              '<div class="flex items-center gap-1.5 flex-wrap">' +
                prod.floor_tags.map((t) => '<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">' + ui.esc(t) + '</span>').join('') +
              '</div>'
            ) : '') +
          '</div>'
        ) : '') +

        (hasSpecials ? (
          '<div class="p-3 rounded-lg bg-panel border border-line/70">' +
            '<div class="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2 flex items-center gap-1.5">' +
              ui.icon('zap', 'w-3.5 h-3.5') + '<span>Production Specials & Isolation Requirements</span>' +
            '</div>' +
            '<div class="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-2">' +
              [
                { key: 'hazer', label: 'Hazer / Fogger', icon: 'wind', active: !!s.hazer, color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
                { key: 'lasers', label: 'Lasers', icon: 'zap', active: !!s.lasers, color: 'text-rose-400 bg-rose-500/10 border-rose-500/30' },
                { key: 'heavy_power', label: 'Heavy Power', icon: 'zap', active: !!s.heavy_power, color: 'text-orange-400 bg-orange-500/10 border-orange-500/30' },
                { key: 'video', label: 'Video / Projection', icon: 'screen', active: !!s.video, color: 'text-sky-400 bg-sky-500/10 border-sky-500/30' },
                { key: 'pyro', label: 'Pyro / Confetti', icon: 'sparkles', active: !!s.pyro, color: 'text-purple-400 bg-purple-500/10 border-purple-500/30' },
              ].map((sp) => (
                '<div class="p-2 rounded-lg border flex flex-col items-center justify-center text-center gap-1 ' +
                  (sp.active ? sp.color : 'bg-panel2/40 border-line/40 text-muted opacity-50') + '">' +
                  ui.icon(sp.icon, 'w-3.5 h-3.5') +
                  '<span class="text-[10px] font-medium leading-tight">' + ui.esc(sp.label) + '</span>' +
                  '<span class="text-[9px] font-bold uppercase ' + (sp.active ? 'text-ink' : 'text-muted') + '">' + (sp.active ? 'Active' : 'No') + '</span>' +
                '</div>'
              )).join('') +
            '</div>' +
            (prod.special_notes ? (
              '<div class="p-2 rounded bg-panel2 border border-line text-[11px] text-ink/90 flex items-start gap-1.5">' +
                '<span class="text-warning shrink-0 mt-0.5">' + ui.icon('alert', 'w-3.5 h-3.5') + '</span>' +
                '<span><strong>Safety / Permit Notes:</strong> ' + ui.esc(prod.special_notes) + '</span>' +
              '</div>'
            ) : '') +
          '</div>'
        ) : '') +
      '</div>'
    ) : '';

    const dmxList = (techReqs && (techReqs.dmx_fixtures || techReqs.dmxFixtures)) || (ev.dmx_fixtures || ev.dmxFixtures) || [];

    const dmxFixturesHtml = (Array.isArray(dmxList) && dmxList.length) ? (
      '<div class="p-3.5 rounded-xl bg-panel2/40 border border-line text-xs grid gap-2">' +
        '<div class="flex items-center justify-between pb-2 border-b border-line/60">' +
          '<div class="eyebrow text-ink font-semibold flex items-center gap-1.5">' +
            ui.icon('bulb', 'w-3.5 h-3.5 text-warning') + '<span>Patched DMX Lighting Fixtures (' + dmxList.length + ')</span>' +
          '</div>' +
          '<button id="modal-dmx-csv-btn" class="btn btn-ghost !py-0.5 !px-2 text-[11px] text-accent flex items-center gap-1 border border-line">' +
            ui.icon('download', 'w-3 h-3') + '<span>Export DMX CSV</span>' +
          '</button>' +
        '</div>' +
        '<div class="overflow-x-auto rounded-lg border border-line">' +
          '<table class="w-full text-left text-xs border-collapse">' +
            '<thead><tr class="bg-panel2 border-b border-line text-muted text-[11px]">' +
              '<th class="p-1.5 w-12 text-center">Unit</th><th class="p-1.5">Fixture / Personality</th><th class="p-1.5">Location</th><th class="p-1.5 text-center">Univ</th><th class="p-1.5 text-center">Start</th><th class="p-1.5 text-center">End</th><th class="p-1.5 text-center">Ch</th>' +
            '</tr></thead>' +
            '<tbody class="divide-y divide-line font-mono text-[11px]">' +
              dmxList.map((f, i) => {
                const addr = parseInt(f.address, 10) || 1;
                const ch = Math.max(1, parseInt(f.channels, 10) || 1);
                const end = addr + ch - 1;
                return (
                  '<tr class="hover:bg-panel2/40">' +
                    '<td class="p-1.5 text-center font-bold text-ink">#' + (f.unit !== undefined ? f.unit : (i + 1)) + '</td>' +
                    '<td class="p-1.5 font-sans font-medium text-ink">' + ui.esc(f.name || f.model || 'Fixture') + '<div class="text-[10px] text-muted font-mono">' + ui.esc(f.mode || '') + '</div></td>' +
                    '<td class="p-1.5 font-sans text-muted">' + ui.esc(f.location || 'LX1') + '</td>' +
                    '<td class="p-1.5 text-center">' + (f.universe || 1) + '</td>' +
                    '<td class="p-1.5 text-center font-bold text-accent">' + addr + '</td>' +
                    '<td class="p-1.5 text-center">' + end + '</td>' +
                    '<td class="p-1.5 text-center text-muted">' + ch + '</td>' +
                  '</tr>'
                );
              }).join('') +
            '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>'
    ) : '';

    const bodyHtml =
      '<div class="grid gap-4">' +
        // Top summary metadata
        '<div class="p-3.5 rounded-xl bg-panel2/50 border border-line text-xs grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">' +
          '<div><div class="text-[10px] font-semibold text-muted uppercase">Venue / Space</div><div class="font-bold text-ink mt-0.5 text-sm">' + ui.esc(ev.space || '—') + '</div></div>' +
          '<div><div class="text-[10px] font-semibold text-muted uppercase">Date & Timings</div><div class="font-medium text-ink mt-0.5">' + ui.esc(ui.formatDate(ev.date) + (times ? ' \u00b7 ' + times : '')) + '</div></div>' +
          '<div><div class="text-[10px] font-semibold text-muted uppercase">Lead Technician</div><div class="font-medium text-ink mt-0.5">' + (leadUser ? ui.esc(leadUser.name) : '<span class="text-muted italic">Unassigned</span>') + '</div></div>' +
          '<div>' +
            '<div class="text-[10px] font-semibold text-muted uppercase mb-0.5">Advance Status</div>' +
            (canManageEvents ? (
              '<select id="modal-status-selector" class="field !py-1 !px-2 text-xs font-semibold w-full bg-panel">' +
                ['Confirmed', 'Tentative', 'Hold', 'Cancelled'].map((st) => '<option value="' + st + '" ' + (ev.status === st ? 'selected' : '') + '>' + st + '</option>').join('') +
              '</select>'
            ) : ui.pill(ev.status || 'Confirmed', ev.status === 'Confirmed' ? 'var(--ok)' : (ev.status === 'Cancelled' ? 'var(--danger)' : 'var(--warning)'))) +
          '</div>' +
        '</div>' +
        liveTimingsHtml +
        liveScheduleItemsHtml +
        cinemaDetailsHtml +
        lightingProductionHtml +
        dmxFixturesHtml +
        channelListHtml +
        linkedMaintenanceHtml +

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

    m.root.querySelectorAll('[data-act-file-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = +btn.getAttribute('data-act-file-idx');
        const it = scheduleItems[idx];
        if (it && it.techFile) files.open(it.techFile);
      });
    });

    const printBtn = m.root.querySelector('#modal-print-btn');
    if (printBtn) printBtn.addEventListener('click', () => printAdvance(ev));

    const dmxCsvBtn = m.root.querySelector('#modal-dmx-csv-btn');
    if (dmxCsvBtn) {
      dmxCsvBtn.addEventListener('click', () => {
        if (RMTP.dmx) {
          RMTP.dmx.exportCsv(dmxList, ev.name || 'Event', ev.space || 'Venue');
        }
      });
    }

    const modalStatusSel = m.root.querySelector('#modal-status-selector');
    if (modalStatusSel) {
      modalStatusSel.addEventListener('change', () => {
        const newStatus = modalStatusSel.value;
        const updated = Object.assign({}, ev, { status: newStatus });
        store.upsert('advancing', updated);
        ui.toast('Advance status updated to ' + newStatus, 'ok');
        m.close();
        openEventModal(updated);
        RMTP.router.render();
      });
    }

    const reportsBtn = m.root.querySelector('#modal-reports-btn');
    if (reportsBtn) reportsBtn.addEventListener('click', () => { m.close(); openReports(ev); });

    const manageReportsBtn = m.root.querySelector('#modal-manage-reports');
    if (manageReportsBtn) manageReportsBtn.addEventListener('click', () => { m.close(); openReports(ev); });

    const editBtn = m.root.querySelector('#modal-edit-btn');
    if (editBtn) editBtn.addEventListener('click', () => { m.close(); openForm(ev); });

    const delBtn = m.root.querySelector('#modal-del-btn');
    if (delBtn) delBtn.addEventListener('click', () => { m.close(); del(ev); });

    const linkedDcpBtn = m.root.querySelector('#btn-open-linked-dcp');
    if (linkedDcpBtn && dcpTestEvent) {
      linkedDcpBtn.addEventListener('click', () => { m.close(); openEventModal(dcpTestEvent); });
    }
    const parentEvBtn = m.root.querySelector('#btn-open-parent-event');
    if (parentEvBtn && dcpParentEvent) {
      parentEvBtn.addEventListener('click', () => { m.close(); openEventModal(dcpParentEvent); });
    }
  }

  /* ---- PDF Export / Print ---- */
  function printAdvance(ev) {
    const root = document.getElementById('print-root');
    if (!root) return;
    const isCinema = isScreenSpace(ev.space);
    const mediaTypeVal = ev.media_type || ev.mediaType || '';
    const filmDurationVal = ev.film_duration || ev.filmDuration || '';
    const times = [ev.startTime, ev.finishTime].filter(Boolean).join(' \u2013 ');
    const techs = RMTP.eventTechnicians(ev).map(techLabel).filter(Boolean);
    const leadUserId = RMTP.getAdvancingLeadId(ev);
    const leadUser = leadUserId ? store.find('users', leadUserId) : null;
    const leadLabel = leadUser ? auth.displayName(leadUser) + (leadUser.position ? ' (' + leadUser.position + ')' : '') : 'Unassigned';
    const reports = reportsFor(ev.id);
    const scheduleItems = Array.isArray(ev.schedule_items) ? ev.schedule_items : (Array.isArray(ev.scheduleItems) ? ev.scheduleItems : []);

    const dcpTesterName = (isCinema && ev.dcp_tester_user_id) ? userName(ev.dcp_tester_user_id) : '';
    const dcpTestTimeStr = (isCinema && ev.dcp_test_datetime) ? new Date(ev.dcp_test_datetime).toLocaleString('en-GB') : '';

    const techReqs = ev.tech_requirements || ev.techRequirements || {};
    const channelInputs = (techReqs.channel_list && Array.isArray(techReqs.channel_list.inputs)) ? techReqs.channel_list.inputs : [];
    const channelOutputs = (techReqs.channel_list && Array.isArray(techReqs.channel_list.outputs)) ? techReqs.channel_list.outputs : [];

    const linkedMaintIds = Array.isArray(ev.linked_maintenance_ids || ev.linkedMaintenanceIds) ? (ev.linked_maintenance_ids || ev.linkedMaintenanceIds) : [];
    const linkedFaults = store.all('maintenance').filter((f) => linkedMaintIds.indexOf(f.id) !== -1);

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
              '<th style="padding:4px 8px;">Tech Requirements</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>' +
            scheduleItems.map((it) => {
              let techReqParts = [];
              if (it.techNotes && it.techNotes.trim()) {
                techReqParts.push('<span style="font-size:11px;color:#1e293b;display:block;"><strong>Notes:</strong> ' + ui.esc(it.techNotes) + '</span>');
              }
              if (it.techFile) {
                techReqParts.push('<span style="font-size:11px;color:#0284c7;display:block;"><strong>Rider:</strong> ' + ui.esc(it.techFile.name) + ' (' + files.humanSize(it.techFile.size) + ')</span>');
              }
              if ((Array.isArray(it.channelInputs) && it.channelInputs.length) || (Array.isArray(it.channelOutputs) && it.channelOutputs.length)) {
                const inList = Array.isArray(it.channelInputs) ? it.channelInputs : [];
                const outList = Array.isArray(it.channelOutputs) ? it.channelOutputs : [];
                let parts = [];
                if (inList.length) parts.push('<strong style="color:#059669;">' + inList.length + ' In:</strong> ' + ui.esc(inList.map((c) => (c.channel || '') + ':' + (c.instrument || 'In')).join(', ')));
                if (outList.length) parts.push('<strong style="color:#0284c7;">' + outList.length + ' Out:</strong> ' + ui.esc(outList.map((o) => (o.num || '') + ':' + (o.name || o.dest || 'Mix')).join(', ')));
                techReqParts.push('<div style="font-size:11px;display:flex;flex-direction:column;gap:2px;">' + parts.join('') + '</div>');
              }
              let techReqDesc = techReqParts.length ? techReqParts.join('<div style="height:4px;"></div>') : '—';
              return (
                '<tr style="border-bottom:1px solid #e2e8f0;">' +
                  '<td style="padding:6px 8px;font-weight:600;">' + ui.esc(it.label || it.type) + '</td>' +
                  '<td style="padding:6px 8px;font-weight:500;">' + ui.esc(it.customName || '—') + '</td>' +
                  '<td style="padding:6px 8px;font-family:monospace;">' + ui.esc(it.time || '—') + '</td>' +
                  '<td style="padding:6px 8px;font-family:monospace;">' + ui.esc(it.duration || '—') + '</td>' +
                  '<td style="padding:6px 8px;">' + techReqDesc + '</td>' +
                '</tr>'
              );
            }).join('') +
          '</tbody>' +
        '</table>' +
      '</div>'
    ) : '';

    const cinemaChecksHtml = isCinema ? (
      '<div class="adv-print-section">' +
        '<div class="adv-print-section-title" style="display:flex;justify-content:space-between;align-items:center;">' +
          '<span>Cinema Screening Checklist & Testing</span>' +
          '<div style="display:flex;gap:8px;font-size:11px;font-family:monospace;font-weight:600;">' +
            (filmDurationVal ? '<span style="color:#334155;">Film: ' + ui.esc(filmDurationVal) + '</span>' : '') +
            (mediaTypeVal ? '<span style="color:#0284c7;">Media: ' + ui.esc(mediaTypeVal) + '</span>' : '') +
          '</div>' +
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

    const channelListPrintSection = (channelInputs.length || channelOutputs.length) ? (
      '<div class="adv-print-section">' +
        '<div class="adv-print-section-title">Global / Festival Patch List (Custom List)</div>' +
        (channelInputs.length ? (
          '<div style="margin-bottom:8px;">' +
            '<div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:4px;">Inputs (' + channelInputs.length + ')</div>' +
            '<table style="width:100%;border-collapse:collapse;font-size:11px;">' +
              '<thead><tr style="border-bottom:1px solid #cbd5e1;text-align:left;color:#475569;"><th style="padding:3px 6px;">Ch</th><th style="padding:3px 6px;">Patch</th><th style="padding:3px 6px;">Instrument</th><th style="padding:3px 6px;">Mic / DI</th><th style="padding:3px 6px;">Stand</th><th style="padding:3px 6px;">Pos</th><th style="padding:3px 6px;">+48V</th></tr></thead>' +
              '<tbody>' +
                channelInputs.map((ch, i) => (
                  '<tr style="border-bottom:1px solid #f1f5f9;">' +
                    '<td style="padding:3px 6px;font-weight:600;font-family:monospace;">Ch ' + (ch.channel || (i + 1)) + '</td>' +
                    '<td style="padding:3px 6px;font-family:monospace;color:#64748b;font-size:10px;">' + ui.esc(ch.patch || '—') + '</td>' +
                    '<td style="padding:3px 6px;font-weight:500;">' + ui.esc(ch.instrument || '—') + '</td>' +
                    '<td style="padding:3px 6px;color:#64748b;">' + ui.esc(ch.mic || '—') + '</td>' +
                    '<td style="padding:3px 6px;color:#64748b;">' + ui.esc(ch.stand || '—') + '</td>' +
                    '<td style="padding:3px 6px;color:#64748b;">' + ui.esc(ch.pos || '—') + '</td>' +
                    '<td style="padding:3px 6px;font-family:monospace;' + (ch.phantom ? 'color:#dc2626;font-weight:700;' : 'color:#94a3b8;') + '">' + (ch.phantom ? '+48V' : '—') + '</td>' +
                  '</tr>'
                )).join('') +
              '</tbody>' +
            '</table>' +
          '</div>'
        ) : '') +
        (channelOutputs.length ? (
          '<div>' +
            '<div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:4px;">Outputs / Monitors (' + channelOutputs.length + ')</div>' +
            '<table style="width:100%;border-collapse:collapse;font-size:11px;">' +
              '<thead><tr style="border-bottom:1px solid #cbd5e1;text-align:left;color:#475569;"><th style="padding:3px 6px;">Out</th><th style="padding:3px 6px;">Name</th><th style="padding:3px 6px;">Type</th><th style="padding:3px 6px;">Destination</th></tr></thead>' +
              '<tbody>' +
                channelOutputs.map((out, i) => (
                  '<tr style="border-bottom:1px solid #f1f5f9;">' +
                    '<td style="padding:3px 6px;font-weight:600;font-family:monospace;">Out ' + (out.num || (i + 1)) + (out.stereo ? ' (St)' : '') + '</td>' +
                    '<td style="padding:3px 6px;font-weight:500;">' + ui.esc(out.name || '—') + '</td>' +
                    '<td style="padding:3px 6px;color:#64748b;">' + ui.esc(out.type || '—') + '</td>' +
                    '<td style="padding:3px 6px;color:#64748b;">' + ui.esc(out.dest || '—') + '</td>' +
                  '</tr>'
                )).join('') +
              '</tbody>' +
            '</table>' +
          '</div>'
        ) : '') +
      '</div>'
    ) : '';

    const linkedMaintSection = linkedFaults.length ? (
      '<div class="adv-print-section">' +
        '<div class="adv-print-section-title">Linked Maintenance Tasks (' + linkedFaults.length + ')</div>' +
        '<div style="display:flex;flex-direction:column;gap:4px;">' +
          linkedFaults.map((f) => (
            '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:4px;padding:6px 8px;font-size:11px;display:flex;justify-content:space-between;">' +
              '<span><strong>' + ui.esc(f.title || f.equipment || 'Task') + '</strong> \u00b7 ' + ui.esc(f.space || f.location || 'Venue') + '</span>' +
              '<span style="font-weight:600;color:#b45309;">' + ui.esc(f.status || 'Reported') + '</span>' +
            '</div>'
          )).join('') +
        '</div>' +
      '</div>'
    ) : '';

    // Lighting & Production Package in Print Sheet
    const prod = getProductionPackage(ev);
    const hasLighting = !!(prod.lighting_notes && prod.lighting_notes.trim());
    const hasFloor = !!((prod.floor_package && prod.floor_package.trim()) || (prod.floor_tags && prod.floor_tags.length));
    const s = prod.specials || {};
    const hasSpecials = !!(s.hazer || s.lasers || s.heavy_power || s.video || s.pyro || (prod.special_notes && prod.special_notes.trim()));
    const hasAnyProduction = hasLighting || hasFloor || hasSpecials;

    const lightingProductionPrintSection = hasAnyProduction ? (
      '<div class="adv-print-section">' +
        '<div class="adv-print-section-title">Lighting & Production Package</div>' +
        '<div class="adv-print-grid" style="margin-bottom:8px;">' +
          (hasLighting ? (
            '<div class="adv-print-field" style="grid-column: span 3;">' +
              '<div class="adv-print-label">Lighting Notes & Rig Plan</div>' +
              '<div class="adv-print-val" style="white-space:pre-wrap;font-weight:400;margin-top:2px;">' + ui.esc(prod.lighting_notes) + '</div>' +
            '</div>'
          ) : '') +
          (hasFloor ? (
            '<div class="adv-print-field" style="grid-column: span 3;">' +
              '<div class="adv-print-label">Incoming Touring Floor Package & Power</div>' +
              (prod.floor_package ? '<div class="adv-print-val" style="white-space:pre-wrap;font-weight:400;margin-top:2px;">' + ui.esc(prod.floor_package) + '</div>' : '') +
              (prod.floor_tags && prod.floor_tags.length ? (
                '<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px;">' +
                  prod.floor_tags.map((t) => '<span style="font-size:10px;font-weight:600;background:#e0e7ff;color:#3730a3;padding:2px 6px;border-radius:4px;">' + ui.esc(t) + '</span>').join('') +
                '</div>'
              ) : '') +
            '</div>'
          ) : '') +
        '</div>' +
        (hasSpecials ? (
          '<div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px;margin-top:6px;">' +
            '<div style="font-size:11px;font-weight:700;color:#334155;margin-bottom:6px;">Production Specials & Safety Provisions</div>' +
            '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;">' +
              [
                { label: 'Hazer / Fogger', active: s.hazer },
                { label: 'Lasers', active: s.lasers },
                { label: 'Heavy Power Drops', active: s.heavy_power },
                { label: 'Video / Projection', active: s.video },
                { label: 'Pyrotechnics / Confetti', active: s.pyro },
              ].map((item) => (
                '<span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;' +
                  (item.active ? 'background:#fee2e2;color:#991b1b;border:1px solid #f87171;' : 'background:#f1f5f9;color:#94a3b8;border:1px solid #e2e8f0;') + '">' +
                  ui.esc(item.label) + ': ' + (item.active ? 'YES' : 'NO') +
                '</span>'
              )).join('') +
            '</div>' +
            (prod.special_notes ? '<div style="font-size:11px;color:#0f172a;"><strong>Special Notes / Isolation:</strong> ' + ui.esc(prod.special_notes) + '</div>' : '') +
          '</div>'
        ) : '') +
      '</div>'
    ) : '';

    const reportsHtml = reports.length ? (
      '<div class="adv-print-section">' +
        '<div class="adv-print-section-title">Shift Reports & Handover Notes</div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;">' +
          reports.map((r) => (
            '<div style="background:#f8fafc;padding:8px;border:1px solid #cbd5e1;border-radius:4px;font-size:11px;">' +
              '<div style="font-weight:700;margin-bottom:4px;color:#0f172a;">' + ui.esc(r.user_name || r.userName || 'Tech') + ' (' + ui.esc(r.shift_role || r.shiftRole || 'Report') + ')</div>' +
              '<div style="white-space:pre-wrap;color:#334155;">' + ui.esc(r.notes || '') + '</div>' +
            '</div>'
          )).join('') +
        '</div>' +
      '</div>'
    ) : '';

    root.innerHTML =
      '<div class="adv-print-sheet">' +
        '<div class="adv-print-header">' +
          '<div>' +
            '<div class="adv-print-brand">Rich Mix</div>' +
            '<div class="adv-print-sub">Tech Portal / ' + ui.esc(ev.category || 'Event Advance') + '</div>' +
          '</div>' +
          '<div><span class="adv-print-badge">' + ui.esc(ev.status || 'Draft') + '</span></div>' +
        '</div>' +
        '<div class="adv-print-title">' + ui.esc(ev.name) + '</div>' +
        '<div style="font-size:13px;font-weight:600;color:#334155;margin-bottom:16px;">' +
          ui.esc(ev.date ? ui.formatDate(ev.date) : 'TBC') + (times ? ' • ' + ui.esc(times) : '') + ' — ' + ui.esc(ev.space || 'No Space') +
        '</div>' +
        liveTimingsSection +
        liveScheduleSection +
        cinemaChecksHtml +
        lightingProductionPrintSection +
        channelListPrintSection +
        linkedMaintSection +

        '<div class="adv-print-section">' +
          '<div class="adv-print-section-title">Crew & Contacts</div>' +
          '<div class="adv-print-grid">' +
            '<div class="adv-print-field" style="grid-column: span 2;">' +
              '<div class="adv-print-label">Responsible for Advancing</div>' +
              '<div class="adv-print-val" style="color:#0284c7;font-weight:700;">' + ui.esc(leadLabel) + '</div>' +
            '</div>' +
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
          '<div class="mt-2 text-right">' +
            '<button type="button" id="sync-retry-schema-btn" class="btn border border-line !py-1 text-xs bg-panel hover:bg-panel2 font-semibold">I have run this, reload schema cache</button>' +
          '</div>' +
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

    const retrySchemaBtn = m.root.querySelector('#sync-retry-schema-btn');
    if (retrySchemaBtn) {
      retrySchemaBtn.addEventListener('click', () => {
        try {
          if (window.localStorage) {
            localStorage.removeItem('sb_unsupported_cols');
            localStorage.removeItem('sb_unsupported_tables');
          }
        } catch(e) {}
        ui.toast('Schema cache cleared, reloading...', 'info');
        setTimeout(() => window.location.reload(), 500);
      });
    }

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

    // Dynamic schedule items for Live spaces: [{ type, label, customName, time, duration, techReqType, techNotes, techFile, channelInputs, channelOutputs }]
    let scheduleItems = (Array.isArray(ev.schedule_items) ? ev.schedule_items : (Array.isArray(ev.scheduleItems) ? ev.scheduleItems : []))
      .map((it) => {
        const item = Object.assign({}, it);
        if (!item.techReqType) {
          if (item.channelInputs && item.channelInputs.length) item.techReqType = 'channels';
          else if (item.techFile) item.techReqType = 'file';
          else if (item.techNotes && item.techNotes.trim()) item.techReqType = 'text';
          else item.techReqType = 'none';
        }
        if (!Array.isArray(item.channelInputs)) item.channelInputs = [];
        if (!Array.isArray(item.channelOutputs)) item.channelOutputs = [];
        if (typeof item.techNotes !== 'string') item.techNotes = '';
        return item;
      });

    const originalSpec = ev.techSpec || null;
    let specMeta = originalSpec;
    let pending = null;
    let cleared = false;

    const initialSpace = ev.space || '';
    const hasSpaceInitial = Boolean(initialSpace);
    const isScreenInitial = hasSpaceInitial && isScreenSpace(initialSpace);
    const isLiveInitial = hasSpaceInitial && !isScreenInitial;

    // Channel list & tech requirements presets
    const INPUT_INSTRUMENT_PRESETS = [
      'Kick In', 'Kick Out', 'Snare Top', 'Snare Bottom', 'Hi-Hat', 'Tom 1', 'Tom 2', 'Floor Tom',
      'Overhead L', 'Overhead R', 'Bass DI', 'Bass Mic', 'Gtr 1', 'Gtr 2', 'Acoustic Gtr', 'Keys L', 'Keys R',
      'Lead Vox', 'BV 1', 'BV 2', 'Host Mic', 'DJ L', 'DJ R', 'Playback L', 'Playback R', 'Talkback'
    ];
    function getInventoryMicSuggestions() {
      const all = RMTP.store.all('inventory') || [];
      const mics = all.filter(r => r.category === 'Sound - Microphones' || r.category === 'Sound - DI/Stands');
      const names = new Set(mics.map(m => m.name.trim()).filter(Boolean));
      const sorted = Array.from(names).sort((a, b) => a.localeCompare(b));
      return sorted.length ? sorted : [
        'Shure Beta 52', 'Shure SM57', 'Shure SM58', 'Shure Beta 58', 'Shure Beta 91A', 'Sennheiser e604', 'Sennheiser e906',
        'AKG C414', 'AKG D112', 'Radial ProDI', 'Radial ProD2', 'BSS AR-133', 'DPA 4099', 'Neumann KM184', 'Wireless Handheld'
      ];
    }
    const INPUT_MIC_PRESETS = getInventoryMicSuggestions();
    const INPUT_STAND_PRESETS = ['Tall Boom', 'Short Boom', 'Straight Stand', 'Claw / Clip', 'N/A'];
    const INPUT_POSITIONS = ['Upstage Left', 'Upstage Centre', 'Upstage Right', 'Centre Stage', 'Downstage Left', 'Downstage Centre', 'Downstage Right'];
    const OUTPUT_TYPE_PRESETS = ['IEM', 'Wedge', 'Record Matrix', 'Stream Feed', 'Lobby / Foyer', 'Delay', 'Other'];

    let techReqs = ev.tech_requirements || ev.techRequirements || {};
    let channelInputs = (techReqs.channel_list && Array.isArray(techReqs.channel_list.inputs))
      ? JSON.parse(JSON.stringify(techReqs.channel_list.inputs))
      : [];
    let channelOutputs = (techReqs.channel_list && Array.isArray(techReqs.channel_list.outputs))
      ? JSON.parse(JSON.stringify(techReqs.channel_list.outputs))
      : [];
    let linkedMaintIds = Array.isArray(ev.linked_maintenance_ids || ev.linkedMaintenanceIds)
      ? (ev.linked_maintenance_ids || ev.linkedMaintenanceIds).slice()
      : (ev._preselectedFaultId ? [ev._preselectedFaultId] : []);

    let patchOptions = [];
    const venue = store.all('venues').find(vv => vv.name === ev.space);
    if (venue && venue.audio) {
      if (venue.audio.localInputChannels) {
        for(let i=1; i<=venue.audio.localInputChannels; i++) patchOptions.push('Local ' + i);
      }
      if (venue.audio.stageboxes) {
        venue.audio.stageboxes.forEach(sb => {
          let limit = sb.analogIn || 0;
          for(let i=1; i<=limit; i++) patchOptions.push((sb.letter || sb.name || 'SB') + i);
        });
      }
    }

    const allUsers = store.all('users');
    const leadCandidates = allUsers.filter((u) => {
      const pos = (u.position || '').trim();
      return pos === 'Technical Manager' || pos === 'Senior Tech' || (auth.AUTO_ADMIN_POSITIONS && auth.AUTO_ADMIN_POSITIONS.includes(pos)) || u.admin;
    });
    const eligibleLeads = leadCandidates.length ? leadCandidates : allUsers;
    const currentLeadId = RMTP.getAdvancingLeadId(ev) || '';

    const leadOptionsHtml = (selectedId) =>
      '<option value="">Select responsible lead\u2026</option>' +
      eligibleLeads.map((u) => '<option value="' + u.id + '" ' + (u.id === (selectedId || currentLeadId) ? 'selected' : '') + '>' + ui.esc(auth.displayName(u)) + (u.position ? ' (' + ui.esc(u.position) + ')' : '') + '</option>').join('');

    const userOptionsHtml = (selectedId) =>
      '<option value="">Select engineer\u2026</option>' +
      allUsers.map((u) => '<option value="' + u.id + '" ' + (u.id === selectedId ? 'selected' : '') + '>' + ui.esc(auth.displayName(u)) + '</option>').join('');

    const allMaintenance = store.all('maintenance');
    const openFaults = allMaintenance.filter((f) => f.status !== 'Resolved' || linkedMaintIds.indexOf(f.id) !== -1);

    const prodInitial = getProductionPackage(ev);
    let floorTags = prodInitial.floor_tags ? prodInitial.floor_tags.slice() : [];

    const m = ui.modal({
      title: existing ? 'Edit Technical Advance' : 'Create Technical Advance',
      size: 'md:max-w-3xl',
      body:
        '<div class="grid gap-4">' +
          /* ================= CORE EVENT INFO (ALWAYS VISIBLE AT TOP) ================= */
          '<div class="panel p-4 bg-panel border border-line rounded-xl grid gap-4 shadow-xs">' +
            '<div class="flex items-center justify-between pb-2 border-b border-line/60">' +
              '<div class="flex items-center gap-2">' +
                '<span class="p-1 rounded-md bg-accent/15 text-accent">' + ui.icon('calendar', 'w-3.5 h-3.5') + '</span>' +
                '<div>' +
                  '<div class="text-xs font-bold text-ink uppercase tracking-wider">Core Event Info</div>' +
                  '<div class="text-[11px] text-muted">Title, status, space & overall event timing</div>' +
                '</div>' +
              '</div>' +
              '<span class="text-[10px] font-bold text-accent uppercase tracking-wider px-2 py-0.5 rounded bg-accent/10 border border-accent/25">Required</span>' +
            '</div>' +

            '<div class="grid sm:grid-cols-[1fr_150px] gap-4">' +
              fld('Event title', '<input id="e-name" class="field font-medium" value="' + ui.esc(ev.name || '') + '" placeholder="Artist / show name" />') +
              fld('Status', '<select id="e-status" class="field font-medium">' + opt(STATUSES, ev.status || 'Advancing') + '</select>') +
            '</div>' +

            '<div class="grid sm:grid-cols-2 gap-4">' +
              fld('Responsible for Advancing',
                '<select id="e-responsible-lead" class="field font-semibold text-accent cursor-pointer">' +
                  leadOptionsHtml(currentLeadId) +
                '</select>' +
                '<span class="text-[11px] text-muted block mt-1">Technical Manager or Senior Tech tagged as lead.</span>'
              ) +
              fld('Category', '<select id="e-category" class="field">' + blankOpt(RMTP.EVENT_CATEGORIES, ev.category, '\u2014') + '</select>') +
            '</div>' +

            '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">' +
              '<div id="event-form-space-selection" class="grid gap-1.5">' +
                '<label class="text-xs font-semibold text-ink flex items-center justify-between">' +
                  '<span>Space / Room</span>' +
                  '<span id="space-select-badge" class="' + (hasSpaceInitial ? 'hidden' : '') + ' text-[10px] font-bold text-accent px-1.5 py-0.2 rounded bg-accent/10 border border-accent/20 flex items-center gap-1 animate-pulse">' +
                    ui.icon('pin', 'w-2.5 h-2.5') + 'Required' +
                  '</span>' +
                '</label>' +
                '<div class="relative flex items-center">' +
                  '<span id="space-input-icon" class="absolute left-2.5 pointer-events-none transition-colors ' + (hasSpaceInitial ? 'text-accent' : 'text-accent/60') + '">' +
                    ui.icon('pin', 'w-4 h-4') +
                  '</span>' +
                  '<select id="e-space" class="field font-semibold text-accent pl-8.5 cursor-pointer ' + (!hasSpaceInitial ? 'border-accent/40 bg-accent/5 ring-2 ring-accent/10' : '') + '">' +
                    blankOpt(RMTP.SPACES, ev.space, '\u25cb Choose a Space / Room\u2026') +
                  '</select>' +
                '</div>' +
                '<div id="space-select-hint" class="' + (hasSpaceInitial ? 'hidden' : '') + ' text-[11px] text-accent/80 font-medium flex items-center gap-1">' +
                  ui.icon('arrowR', 'w-3 h-3') + 'Select room to begin advancing' +
                '</div>' +
              '</div>' +
              fld('Event Date', '<input id="e-date" type="date" class="field" value="' + ui.esc(ev.date || '') + '" />') +
            '</div>' +

            '<div class="grid grid-cols-2 gap-4">' +
              fld('Overall Start Time', '<input id="e-start" type="time" class="field font-mono" value="' + ui.esc(ev.startTime || '') + '" />') +
              fld('Overall Finish Time', '<input id="e-finish" type="time" class="field font-mono" value="' + ui.esc(ev.finishTime || '') + '" />') +
            '</div>' +
          '</div>' +

          /* ================= UNSELECTED SPACE HELPER PROMPT ================= */
          '<div id="space-unselected-prompt" class="' + (hasSpaceInitial ? 'hidden' : '') + ' p-6 rounded-xl bg-panel border border-dashed border-line text-center grid gap-2 shadow-xs">' +
            '<div class="w-9 h-9 rounded-full bg-accent/10 text-accent mx-auto flex items-center justify-center">' + ui.icon('mapPin', 'w-4 h-4') + '</div>' +
            '<div class="text-xs font-semibold text-ink">Select a Space / Room above to configure technical advance details</div>' +
            '<div class="text-[11px] text-muted max-w-sm mx-auto">Choosing a space unlocks either the Live Event or Cinema technical workflow.</div>' +
          '</div>' +

          /* ================= CINEMA / SCREENING WORKFLOW (ORIGINAL UN-NESTED LAYOUT) ================= */
          '<div id="workflow-cinema-container" class="' + (isScreenInitial ? '' : 'hidden') + ' grid gap-4">' +
            /* Cinema Screening Checklist */
            '<div class="p-4 rounded-xl bg-panel border border-line grid gap-4 shadow-xs">' +
              '<div class="flex items-center justify-between pb-2 border-b border-line/60">' +
                '<div class="flex items-center gap-1.5">' +
                  ui.icon('film', 'w-4 h-4 text-accent') +
                  '<span class="text-xs font-semibold text-accent">Cinema Screening Checklist, Film Duration & DCP Details</span>' +
                '</div>' +
                '<span class="text-[11px] text-muted">Auditorium Screen Advance</span>' +
              '</div>' +

              '<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">' +
                fld('Screening Starts Time', '<input id="e-screening-starts" type="time" class="field font-mono" value="' + ui.esc(ev.screening_starts_time || ev.screeningStartsTime || '') + '" />') +
                fld('Film Duration', '<input id="e-film-duration" class="field font-mono" value="' + ui.esc(ev.film_duration || ev.filmDuration || '') + '" placeholder="e.g. 118 mins, 1h 45m" />') +
                fld('Media Type', '<select id="e-media-type" class="field">' + blankOpt(RMTP.MEDIA_TYPES, ev.media_type || ev.mediaType, 'Select Media\u2026') + '</select>') +
              '</div>' +

              '<div>' +
                '<label class="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Screening Checklist</label>' +
                '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">' +
                  '<label class="flex items-center gap-2 text-xs font-medium cursor-pointer p-2 rounded-lg bg-panel2/40 border border-line">' +
                    '<input type="checkbox" id="e-dcp" class="w-4 h-4 accent-[var(--ok)]" ' + ((ev.dcp_received !== undefined ? ev.dcp_received : ev.dcpReceived) ? 'checked' : '') + ' />' +
                    '<span>DCP Received</span>' +
                  '</label>' +
                  '<label class="flex items-center gap-2 text-xs font-medium cursor-pointer p-2 rounded-lg bg-panel2/40 border border-line">' +
                    '<input type="checkbox" id="e-checks" class="w-4 h-4 accent-[var(--ok)]" ' + ((ev.checks_completed !== undefined ? ev.checks_completed : ev.checksCompleted) ? 'checked' : '') + ' />' +
                    '<span>Checks Completed</span>' +
                  '</label>' +
                  '<label class="flex items-center gap-2 text-xs font-medium cursor-pointer p-2 rounded-lg bg-panel2/40 border border-line">' +
                    '<input type="checkbox" id="e-intermission" class="w-4 h-4 accent-[var(--ok)]" ' + (ev.intermission ? 'checked' : '') + ' />' +
                    '<span>Intermission?</span>' +
                  '</label>' +
                  '<label class="flex items-center gap-2 text-xs font-medium cursor-pointer p-2 rounded-lg bg-panel2/40 border border-line">' +
                    '<input type="checkbox" id="e-qa" class="w-4 h-4 accent-[var(--ok)]" ' + (ev.qa ? 'checked' : '') + ' />' +
                    '<span>Q&A?</span>' +
                  '</label>' +
                '</div>' +
              '</div>' +

              '<div class="pt-2 border-t border-line/60 grid grid-cols-1 sm:grid-cols-2 gap-4">' +
                fld('Testing Engineer', '<select id="e-dcp-tester" class="field">' + userOptionsHtml(ev.dcp_tester_user_id || ev.dcpTesterUserId || '') + '</select>') +
                fld('Testing Date & Time', '<input id="e-dcp-test-datetime" type="datetime-local" class="field font-mono" value="' + ui.esc(ev.dcp_test_datetime || ev.dcpTestDatetime || '') + '" />') +
              '</div>' +
              '<label class="flex items-center gap-2 text-xs font-semibold cursor-pointer text-accent pt-1">' +
                '<input type="checkbox" id="e-gen-dcp-shift" class="w-4 h-4 accent-[var(--accent)]" ' + (ev.dcp_test_event_id || (!existing && (ev.category === 'Cinema' || isScreenInitial)) ? 'checked' : 'checked') + ' />' +
                '<span>Generate / Update Linked DCP Test Shift in Calendar</span>' +
              '</label>' +
            '</div>' +

            /* Cinema Linked Maintenance Tasks */
            '<div id="section-cinema-maintenance" class="' + (ev.category === 'Maintenance' || linkedMaintIds.length ? '' : 'hidden') + ' p-4 rounded-xl bg-panel border border-warning/30 grid gap-3 shadow-xs">' +
              '<div class="flex items-center justify-between pb-2 border-b border-line/60">' +
                '<div class="flex items-center gap-1.5">' +
                  ui.icon('tool', 'w-4 h-4 text-warning') +
                  '<span class="text-xs font-semibold text-warning">Link Maintenance Tasks & Faults</span>' +
                '</div>' +
                '<span class="text-[11px] text-muted">Assigned tasks will be tracked against this shift</span>' +
              '</div>' +
              '<div id="cinema-maintenance-picker" class="grid gap-2 max-h-52 overflow-y-auto pr-1"></div>' +
            '</div>' +

            /* Cinema Crew, Details, Tech Spec */
            '<div class="p-4 rounded-xl bg-panel border border-line grid gap-4 shadow-xs">' +
              '<div class="flex items-center justify-between pb-2 border-b border-line/60">' +
                '<div class="flex items-center gap-1.5">' +
                  ui.icon('users', 'w-4 h-4 text-accent') +
                  '<span class="text-xs font-semibold text-accent">Crew & Screening Requirements</span>' +
                '</div>' +
              '</div>' +
              fld('Assigned Technicians', '<div id="e-cinema-tech-area"></div>') +
              fld('Artist / Client contact', '<input id="e-cinema-contact" class="field" value="' + ui.esc(ev.clientContact || '') + '" placeholder="Tour manager / client name & contact" />') +
              fld('Technical notes & requirements', '<textarea id="e-cinema-info" class="field" rows="3" placeholder="Audio formatting, subtitles, projection notes, presentation mics\u2026">' + ui.esc(ev.techInfo || '') + '</textarea>') +
              fld('Event Shift Report Email Recipients (Optional Override)', '<input id="e-cinema-email-recipients" class="field font-mono text-xs" value="' + ui.esc(Array.isArray(ev.email_recipients || ev.emailRecipients) ? (ev.email_recipients || ev.emailRecipients).join(', ') : (ev.email_recipients || ev.emailRecipients || '')) + '" placeholder="Leave blank to use Advancing page recipients (' + getReportRecipients().join(', ') + ')" />') +
              '<div>' +
                '<label class="flex items-center gap-2 cursor-pointer p-2.5 rounded-lg bg-panel2/40 border border-line hover:border-accent/40 transition-colors">' +
                  '<input type="checkbox" id="e-cinema-guest" class="w-4 h-4 accent-[var(--accent)]" ' + (ev.guestEngineer ? 'checked' : '') + ' />' +
                  '<span class="text-xs font-medium text-ink">Visiting / Guest Sound or Lighting Engineer on site</span>' +
                '</label>' +
              '</div>' +
              '<div>' +
                '<label class="block text-xs font-semibold text-ink uppercase tracking-wider mb-2">Tech Spec (PDF)</label>' +
                '<div id="e-cinema-spec-area"></div>' +
              '</div>' +
            '</div>' +
          '</div>' +

          /* ================= LIVE EVENT WORKFLOW (FOUR COLLAPSIBLE SECTIONS) ================= */
          '<div id="workflow-live-container" class="' + (isLiveInitial ? '' : 'hidden') + ' grid gap-4">' +
            /* ================= SECTION CONTROLS BAR ================= */
            '<div class="flex items-center justify-between pt-1 px-1">' +
              '<span class="text-[11px] font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">' +
                ui.icon('layers', 'w-3.5 h-3.5 text-accent') + '<span>Advance Configuration Sections</span>' +
              '</span>' +
              '<button type="button" id="btn-toggle-all-sections" class="text-xs text-accent hover:underline font-semibold flex items-center gap-1 cursor-pointer">' +
                '<span>Expand All</span>' +
              '</button>' +
            '</div>' +

            /* ================= SECTION ONE: GENERAL EVENT INFO, CREW & TECH SPEC ================= */
            '<div class="rounded-xl border border-line bg-panel overflow-hidden shadow-xs">' +
              '<button type="button" data-section-toggle="sec-1-content" class="w-full p-3.5 bg-panel hover:bg-panel2/60 transition-colors flex items-center justify-between text-left gap-3 select-none cursor-pointer">' +
                '<div class="flex items-center gap-3 min-w-0">' +
                  '<span class="px-2 py-1 rounded-md bg-accent/15 text-accent text-xs font-bold font-mono">01</span>' +
                  '<div class="min-w-0">' +
                    '<div class="text-xs font-bold text-ink uppercase tracking-wider">Section 1: General Info, Crew & Tech Spec</div>' +
                    '<div class="text-[11px] text-muted truncate">Assigned Technicians, Client Contact, Tech Notes, Guest Engineer & PDF Spec</div>' +
                  '</div>' +
                '</div>' +
                '<div class="flex items-center gap-2 shrink-0">' +
                  '<span id="sec-1-pill" class="text-[11px] font-semibold px-2 py-0.5 rounded bg-panel2 border border-line text-muted hidden sm:inline-block"></span>' +
                  '<span data-section-chevron="sec-1-content" class="transition-transform duration-200 text-muted">' + ui.icon('arrowD', 'w-4 h-4') + '</span>' +
                '</div>' +
              '</button>' +

              '<div id="sec-1-content" class="hidden p-4 pt-3 border-t border-line/60 bg-panel2/30 grid gap-4">' +
                fld('Assigned Technicians', '<div id="e-tech-area"></div>') +
                fld('Artist / Client contact', '<input id="e-contact" class="field" value="' + ui.esc(ev.clientContact || '') + '" placeholder="Tour manager / client name & contact" />') +
                fld('Technical notes & requirements', '<textarea id="e-info" class="field" rows="3" placeholder="Power requirements, split boxes, staging notes, audio input list\u2026">' + ui.esc(ev.techInfo || '') + '</textarea>') +
                '<div>' +
                  '<label class="flex items-center gap-2 cursor-pointer p-2.5 rounded-lg bg-panel border border-line hover:border-accent/40 transition-colors">' +
                    '<input type="checkbox" id="e-guest" class="w-4 h-4 accent-[var(--accent)]" ' + (ev.guestEngineer ? 'checked' : '') + ' />' +
                    '<span class="text-xs font-medium text-ink">Visiting / Guest Sound or Lighting Engineer on site</span>' +
                  '</label>' +
                '</div>' +
                '<div>' +
                  '<label class="block text-xs font-semibold text-ink uppercase tracking-wider mb-2">Tech Spec (PDF)</label>' +
                  '<div id="e-spec-area"></div>' +
                '</div>' +
              '</div>' +
            '</div>' +

            /* ================= SECTION TWO: SCHEDULE BUILDER ================= */
            '<div class="rounded-xl border border-line bg-panel overflow-hidden shadow-xs">' +
              '<button type="button" data-section-toggle="sec-2-content" class="w-full p-3.5 bg-panel hover:bg-panel2/60 transition-colors flex items-center justify-between text-left gap-3 select-none cursor-pointer">' +
                '<div class="flex items-center gap-3 min-w-0">' +
                  '<span class="px-2 py-1 rounded-md bg-accent/15 text-accent text-xs font-bold font-mono">02</span>' +
                  '<div class="min-w-0">' +
                    '<div class="text-xs font-bold text-ink uppercase tracking-wider">Section 2: Schedule Builder</div>' +
                    '<div class="text-[11px] text-muted truncate">Standard Core Timings (Load In, Soundcheck, Doors, Curfew) & Running Set Pieces</div>' +
                  '</div>' +
                '</div>' +
                '<div class="flex items-center gap-2 shrink-0">' +
                  '<span id="sec-2-pill" class="text-[11px] font-semibold px-2 py-0.5 rounded bg-panel2 border border-line text-muted hidden sm:inline-block"></span>' +
                  '<span data-section-chevron="sec-2-content" class="transition-transform duration-200 text-muted">' + ui.icon('arrowD', 'w-4 h-4') + '</span>' +
                '</div>' +
              '</button>' +

              '<div id="sec-2-content" class="hidden p-4 pt-3 border-t border-line/60 bg-panel2/30 grid gap-4">' +
                '<div class="p-3.5 rounded-xl bg-panel border border-line grid gap-3">' +
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
                '</div>' +

                '<div class="p-3.5 rounded-xl bg-panel border border-line">' +
                  '<div class="flex items-center justify-between mb-3">' +
                    '<div>' +
                      '<label class="block text-xs font-bold text-ink uppercase tracking-wider">Schedule & Set Pieces Builder</label>' +
                      '<p class="text-xs text-muted">Sequence acts, changeovers, speeches, and other scheduled set pieces.</p>' +
                    '</div>' +
                    '<div class="flex items-center gap-1.5">' +
                      '<div class="relative inline-block text-left" id="add-schedule-menu-wrap">' +
                        '<button type="button" id="btn-add-schedule-menu" class="btn btn-ghost !py-1.5 text-xs text-accent font-semibold flex items-center gap-1">' +
                          ui.icon('plus', 'w-3.5 h-3.5') + '<span>Add Schedule Item</span>' + ui.icon('arrowD', 'w-3 h-3') +
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
            '</div>' +

            /* ================= SECTION THREE: GLOBAL PATCH LIST & LIGHTING PRODUCTION PACKAGE ================= */
            '<div class="rounded-xl border border-line bg-panel overflow-hidden shadow-xs">' +
              '<button type="button" data-section-toggle="sec-3-content" class="w-full p-3.5 bg-panel hover:bg-panel2/60 transition-colors flex items-center justify-between text-left gap-3 select-none cursor-pointer">' +
                '<div class="flex items-center gap-3 min-w-0">' +
                  '<span class="px-2 py-1 rounded-md bg-accent/15 text-accent text-xs font-bold font-mono">03</span>' +
                  '<div class="min-w-0">' +
                    '<div class="text-xs font-bold text-ink uppercase tracking-wider">Section 3: Patch List & Production Package</div>' +
                    '<div class="text-[11px] text-muted truncate">Master I/O Patch List, Lighting Rig Notes, Floor Package & Specials</div>' +
                  '</div>' +
                '</div>' +
                '<div class="flex items-center gap-2 shrink-0">' +
                  '<span id="sec-3-pill" class="text-[11px] font-semibold px-2 py-0.5 rounded bg-panel2 border border-line text-muted hidden sm:inline-block"></span>' +
                  '<span data-section-chevron="sec-3-content" class="transition-transform duration-200 text-muted">' + ui.icon('arrowD', 'w-4 h-4') + '</span>' +
                '</div>' +
              '</button>' +

              '<div id="sec-3-content" class="hidden p-4 pt-3 border-t border-line/60 bg-panel2/30 grid gap-4">' +
                /* Global Patch List */
                '<div class="p-4 rounded-xl bg-panel border border-line grid gap-4 shadow-2xs">' +
                  '<div class="flex flex-wrap items-center justify-between pb-2 border-b border-line/60 gap-2">' +
                    '<div class="flex items-center gap-2">' +
                      '<span class="p-1 rounded-md bg-panel border border-line text-accent">' + ui.icon('sliders', 'w-3.5 h-3.5') + '</span>' +
                      '<div>' +
                        '<div class="text-xs font-bold text-ink uppercase tracking-wider">Global / Festival Patch List</div>' +
                        '<div class="text-[11px] text-muted">Master audio input & output patch routing</div>' +
                      '</div>' +
                    '</div>' +
                    '<div class="flex items-center gap-2">' +
                      '<button type="button" id="btn-open-patch-sheet-builder" class="btn btn-primary !py-1 !px-2 text-xs font-semibold flex items-center gap-1" title="Open Stagebox & Repatch Sheet Builder">' +
                        ui.icon('box', 'w-3.5 h-3.5') + '<span>Stagebox Patch Sheet</span>' +
                      '</button>' +
                      '<button type="button" id="btn-global-manage-presets" class="btn btn-ghost !py-1 !px-2 text-xs text-accent flex items-center gap-1 font-semibold" title="Manage Presets Library">' +
                        ui.icon('sliders', 'w-3.5 h-3.5') + '<span>Presets ⚙</span>' +
                      '</button>' +
                      '<span class="text-[11px] font-mono text-accent font-semibold px-2 py-0.5 rounded bg-panel border border-line">' +
                        channelInputs.length + ' In \u00b7 ' + channelOutputs.length + ' Out' +
                      '</span>' +
                    '</div>' +
                  '</div>' +

                  // Input Channel List Builder
                  '<div>' +
                    '<div class="flex flex-wrap items-center justify-between gap-2 mb-2">' +
                      '<label class="text-xs font-semibold text-ink uppercase tracking-wider">Master Input Channels (' + channelInputs.length + ')</label>' +
                      '<div class="flex items-center gap-1.5 flex-wrap">' +
                        '<select id="sel-global-inp-preset" class="field !py-0.5 !px-1.5 text-xs font-medium !w-auto bg-panel text-accent cursor-pointer">' +
                          '<option value="">⚡ Load Input Preset\u2026</option>' +
                          RMTP.presets.getInputs().map((p) => '<option value="' + p.id + '">' + ui.esc(p.name) + ' (' + (p.channels ? p.channels.length : 0) + ' Ch)</option>').join('') +
                        '</select>' +
                        '<button type="button" id="btn-global-save-inp-preset" class="btn btn-ghost !py-0.5 !px-2 text-[10px] text-accent" title="Save current inputs as reusable preset">💾 Save Preset</button>' +
                        '<button type="button" id="btn-add-input-chan" class="btn btn-primary !py-0.5 !px-2 text-[10px] flex items-center gap-1 font-semibold">' +
                          ui.icon('plus', 'w-3 h-3') + '<span>Add Channel</span>' +
                        '</button>' +
                        (channelInputs.length ? '<button type="button" id="btn-auto-patch-inputs" class="btn btn-secondary !py-0.5 !px-1.5 text-[10px]" title="Overlay and allocate to House Patch">Auto-Patch</button><button type="button" id="btn-clear-input-chan" class="btn btn-danger !py-0.5 !px-1.5 text-[10px]" title="Clear Inputs">Clear</button>' : '') +
                      '</div>' +
                    '</div>' +
                    '<div id="channel-inputs-container" class="grid gap-2 max-h-64 overflow-y-auto pr-1"></div>' +
                  '</div>' +

                  // Output Channel List Builder
                  '<div class="pt-3 border-t border-line/60">' +
                    '<div class="flex flex-wrap items-center justify-between gap-2 mb-2">' +
                      '<label class="text-xs font-semibold text-ink uppercase tracking-wider">Master Outputs & Monitors (' + channelOutputs.length + ')</label>' +
                      '<div class="flex items-center gap-1.5 flex-wrap">' +
                        '<select id="sel-global-out-preset" class="field !py-0.5 !px-1.5 text-xs font-medium !w-auto bg-panel text-info cursor-pointer">' +
                          '<option value="">⚡ Load Output Preset\u2026</option>' +
                          RMTP.presets.getOutputs().map((p) => '<option value="' + p.id + '">' + ui.esc(p.name) + ' (' + (p.channels ? p.channels.length : 0) + ' Out)</option>').join('') +
                        '</select>' +
                        '<button type="button" id="btn-global-save-out-preset" class="btn btn-ghost !py-0.5 !px-2 text-[10px] text-info" title="Save current outputs as reusable preset">💾 Save Preset</button>' +
                        '<button type="button" id="btn-add-output-chan" class="btn btn-primary !py-0.5 !px-2 text-[10px] flex items-center gap-1 font-semibold">' +
                          ui.icon('plus', 'w-3 h-3') + '<span>Add Output</span>' +
                        '</button>' +
                        (channelOutputs.length ? '<button type="button" id="btn-clear-output-chan" class="btn btn-danger !py-0.5 !px-1.5 text-[10px]" title="Clear Outputs">Clear</button>' : '') +
                      '</div>' +
                    '</div>' +
                    '<div id="channel-outputs-container" class="grid gap-2 max-h-52 overflow-y-auto pr-1"></div>' +
                  '</div>' +
                '</div>' +

                /* Lighting & Production Package */
                '<div id="section-lighting-production" class="p-4 rounded-xl bg-panel border border-line grid gap-4 shadow-2xs">' +
                  '<div class="flex flex-wrap items-center justify-between pb-2 border-b border-line/60 gap-2">' +
                    '<div class="flex items-center gap-2">' +
                      '<span class="p-1 rounded-md bg-panel border border-warning/40 text-warning">' + ui.icon('bulb', 'w-3.5 h-3.5') + '</span>' +
                      '<div>' +
                        '<div class="text-xs font-bold text-ink uppercase tracking-wider">Lighting & Production Package</div>' +
                        '<div class="text-[11px] text-muted">Lighting rig notes, touring floor package, and production specials</div>' +
                      '</div>' +
                    '</div>' +
                    '<div id="production-specials-indicator" class="flex items-center gap-1.5 flex-wrap"></div>' +
                  '</div>' +

                  // Lighting Notes / Rig Plan
                  '<div>' +
                    '<label class="block text-xs font-semibold text-ink uppercase tracking-wider mb-1">Lighting Notes & House Rig Plan</label>' +
                    '<p class="text-xs text-muted mb-2">Desk preferences (e.g. Avolites / GrandMA / ChamSys), cues, house rig modifications, dimmer patching requirements.</p>' +
                    '<textarea id="e-lighting-notes" class="field" rows="3" placeholder="Desk preferences, lighting cues, house rig modifications, dimmer patching requirements\u2026">' + ui.esc(prodInitial.lighting_notes || '') + '</textarea>' +
                  '</div>' +

                  // Incoming Touring Floor Package & Power
                  '<div>' +
                    '<label class="block text-xs font-semibold text-ink uppercase tracking-wider mb-1">Incoming Touring Floor Package & Power Drops</label>' +
                    '<p class="text-xs text-muted mb-2">Touring fixtures (moving heads, strobes, LED bars), floor bases, risers, and stage power drops (16A/32A/63A single/3-phase).</p>' +
                    '<textarea id="e-floor-package" class="field mb-2" rows="2" placeholder="Touring package details, fixture counts, DMX universe runs to stage, risers, stage floor placement\u2026">' + ui.esc(prodInitial.floor_package || '') + '</textarea>' +
                    '<div class="text-[11px] font-semibold text-muted mb-1.5">Floor Kit & Power Presets (Click to toggle tag):</div>' +
                    '<div id="floor-tags-container" class="flex items-center gap-1.5 flex-wrap"></div>' +
                  '</div>' +

                  // Additional Production Elements & Specials
                  '<div class="pt-3 border-t border-line/60">' +
                    '<label class="block text-xs font-semibold text-ink uppercase tracking-wider mb-1">Additional Production Elements & Specials</label>' +
                    '<p class="text-xs text-muted mb-2.5">Tick active specials to trigger isolation workflows, heavy power allocation, and safety notices.</p>' +
                    '<div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-3">' +
                      '<label class="flex items-center gap-2 text-xs font-medium cursor-pointer p-2.5 rounded-lg bg-panel2/40 border border-line hover:border-amber-500/50 transition-colors">' +
                        '<input type="checkbox" id="e-spec-hazer" class="w-4 h-4 accent-amber-500" ' + (prodInitial.specials.hazer ? 'checked' : '') + ' />' +
                        '<span class="flex items-center gap-1.5">' + ui.icon('wind', 'w-3.5 h-3.5 text-amber-400') + '<span>Hazer / Fogger</span></span>' +
                      '</label>' +
                      '<label class="flex items-center gap-2 text-xs font-medium cursor-pointer p-2.5 rounded-lg bg-panel2/40 border border-line hover:border-rose-500/50 transition-colors">' +
                        '<input type="checkbox" id="e-spec-lasers" class="w-4 h-4 accent-rose-500" ' + (prodInitial.specials.lasers ? 'checked' : '') + ' />' +
                        '<span class="flex items-center gap-1.5">' + ui.icon('zap', 'w-3.5 h-3.5 text-rose-400') + '<span>Lasers (Class 3B/4)</span></span>' +
                      '</label>' +
                      '<label class="flex items-center gap-2 text-xs font-medium cursor-pointer p-2.5 rounded-lg bg-panel2/40 border border-line hover:border-orange-500/50 transition-colors">' +
                        '<input type="checkbox" id="e-spec-power" class="w-4 h-4 accent-orange-500" ' + (prodInitial.specials.heavy_power ? 'checked' : '') + ' />' +
                        '<span class="flex items-center gap-1.5">' + ui.icon('zap', 'w-3.5 h-3.5 text-orange-400') + '<span>Heavy Power (3-Ph)</span></span>' +
                      '</label>' +
                      '<label class="flex items-center gap-2 text-xs font-medium cursor-pointer p-2.5 rounded-lg bg-panel2/40 border border-line hover:border-sky-500/50 transition-colors">' +
                        '<input type="checkbox" id="e-spec-video" class="w-4 h-4 accent-sky-500" ' + (prodInitial.specials.video ? 'checked' : '') + ' />' +
                        '<span class="flex items-center gap-1.5">' + ui.icon('screen', 'w-3.5 h-3.5 text-sky-400') + '<span>Video / Projection</span></span>' +
                      '</label>' +
                      '<label class="flex items-center gap-2 text-xs font-medium cursor-pointer p-2.5 rounded-lg bg-panel2/40 border border-line hover:border-purple-500/50 transition-colors">' +
                        '<input type="checkbox" id="e-spec-pyro" class="w-4 h-4 accent-purple-500" ' + (prodInitial.specials.pyro ? 'checked' : '') + ' />' +
                        '<span class="flex items-center gap-1.5">' + ui.icon('sparkles', 'w-3.5 h-3.5 text-purple-400') + '<span>Pyro / Confetti</span></span>' +
                      '</label>' +
                    '</div>' +
                    fld('Special Notes & Safety / Isolation Details', '<input id="e-special-notes" class="field" value="' + ui.esc(prodInitial.special_notes || '') + '" placeholder="e.g. Smoke detector isolation timing, Laser Safety Officer, clearance radius, power distribution box location\u2026" />') +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>' +

            /* ================= SECTION FOUR: EVERYTHING ELSE ================= */
            '<div class="rounded-xl border border-line bg-panel overflow-hidden shadow-xs">' +
              '<button type="button" data-section-toggle="sec-4-content" class="w-full p-3.5 bg-panel hover:bg-panel2/60 transition-colors flex items-center justify-between text-left gap-3 select-none cursor-pointer">' +
                '<div class="flex items-center gap-3 min-w-0">' +
                  '<span class="px-2 py-1 rounded-md bg-accent/15 text-accent text-xs font-bold font-mono">04</span>' +
                  '<div class="min-w-0">' +
                    '<div class="text-xs font-bold text-ink uppercase tracking-wider">Section 4: Everything Else</div>' +
                    '<div class="text-[11px] text-muted truncate">Linked Maintenance Tasks & Event Shift Report Email Overrides</div>' +
                  '</div>' +
                '</div>' +
                '<div class="flex items-center gap-2 shrink-0">' +
                  '<span id="sec-4-pill" class="text-[11px] font-semibold px-2 py-0.5 rounded bg-panel2 border border-line text-muted hidden sm:inline-block"></span>' +
                  '<span data-section-chevron="sec-4-content" class="transition-transform duration-200 text-muted">' + ui.icon('arrowD', 'w-4 h-4') + '</span>' +
                '</div>' +
              '</button>' +

              '<div id="sec-4-content" class="hidden p-4 pt-3 border-t border-line/60 bg-panel2/30 grid gap-4">' +
                /* Linked Maintenance Tasks */
                '<div id="section-maintenance-advancing" class="' + (ev.category === 'Maintenance' || linkedMaintIds.length ? '' : 'hidden') + ' p-4 rounded-xl bg-panel border border-warning/30 grid gap-3 shadow-xs">' +
                  '<div class="flex items-center justify-between pb-2 border-b border-line/60">' +
                    '<div class="flex items-center gap-1.5">' +
                      ui.icon('tool', 'w-4 h-4 text-warning') +
                      '<span class="text-xs font-semibold text-warning">Link Maintenance Tasks & Faults</span>' +
                    '</div>' +
                    '<span class="text-[11px] text-muted">Assigned tasks will be tracked against this shift</span>' +
                  '</div>' +
                  '<div id="maintenance-tasks-picker" class="grid gap-2 max-h-52 overflow-y-auto pr-1"></div>' +
                '</div>' +

                /* Shift Report Email Recipients Override */
                '<div class="p-4 rounded-xl bg-panel border border-line grid gap-2">' +
                  fld('Event Shift Report Email Recipients (Optional Override)', '<input id="e-email-recipients" class="field font-mono text-xs" value="' + ui.esc(Array.isArray(ev.email_recipients || ev.emailRecipients) ? (ev.email_recipients || ev.emailRecipients).join(', ') : (ev.email_recipients || ev.emailRecipients || '')) + '" placeholder="Leave blank to use Advancing page recipients (' + getReportRecipients().join(', ') + ')" />') +
                  '<p class="text-[11px] text-muted">Comma-separated email addresses to receive the final technical shift report for this specific show.</p>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>',
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-save data-primary>' + (existing ? 'Save changes' : 'Add event') + '</button>',
    });

    // Section Banners & Accordion Controls
    function updateSectionBannerPills() {
      // Sec 1 Pill
      const sec1Pill = m.root.querySelector('#sec-1-pill');
      if (sec1Pill) {
        const assignedTechCount = techs.filter((t) => t.userId).length;
        const hasSpec = pending || (cleared ? false : !!specMeta);
        const parts = [];
        if (assignedTechCount) parts.push(assignedTechCount + ' Tech' + (assignedTechCount === 1 ? '' : 's'));
        if (hasSpec) parts.push('PDF Spec');
        sec1Pill.textContent = parts.length ? parts.join(' \u00b7 ') : 'Not Configured';
        sec1Pill.className = 'text-[11px] font-semibold px-2 py-0.5 rounded border hidden sm:inline-block ' +
          (parts.length ? 'bg-accent/10 border-accent/30 text-accent font-medium' : 'bg-panel2 border-line text-muted');
      }

      // Sec 2 Pill
      const sec2Pill = m.root.querySelector('#sec-2-pill');
      if (sec2Pill) {
        const timings = [
          m.root.querySelector('#e-load-in')?.value,
          m.root.querySelector('#e-sc')?.value,
          m.root.querySelector('#e-doors')?.value,
          m.root.querySelector('#e-curfew')?.value
        ].filter(Boolean).length;
        const parts = [];
        if (timings) parts.push(timings + ' Timings');
        if (scheduleItems.length) parts.push(scheduleItems.length + ' Set Piece' + (scheduleItems.length === 1 ? '' : 's'));
        sec2Pill.textContent = parts.length ? parts.join(' \u00b7 ') : 'Standard Timings';
        sec2Pill.className = 'text-[11px] font-semibold px-2 py-0.5 rounded border hidden sm:inline-block ' +
          (parts.length ? 'bg-accent/10 border-accent/30 text-accent font-medium' : 'bg-panel2 border-line text-muted');
      }

      // Sec 3 Pill
      const sec3Pill = m.root.querySelector('#sec-3-pill');
      if (sec3Pill) {
        const parts = [];
        if (channelInputs.length || channelOutputs.length) {
          parts.push(channelInputs.length + ' In / ' + channelOutputs.length + ' Out');
        }
        if (floorTags.length) parts.push(floorTags.length + ' Floor Tags');
        sec3Pill.textContent = parts.length ? parts.join(' \u00b7 ') : 'Default Rig';
        sec3Pill.className = 'text-[11px] font-semibold px-2 py-0.5 rounded border hidden sm:inline-block ' +
          (parts.length ? 'bg-accent/10 border-accent/30 text-accent font-medium' : 'bg-panel2 border-line text-muted');
      }

      // Sec 4 Pill
      const sec4Pill = m.root.querySelector('#sec-4-pill');
      if (sec4Pill) {
        const parts = [];
        if (linkedMaintIds.length) parts.push(linkedMaintIds.length + ' Fault' + (linkedMaintIds.length === 1 ? '' : 's'));
        const emailVal = m.root.querySelector('#e-email-recipients')?.value.trim();
        if (emailVal) parts.push('Email Override');
        sec4Pill.textContent = parts.length ? parts.join(' \u00b7 ') : 'Default Settings';
        sec4Pill.className = 'text-[11px] font-semibold px-2 py-0.5 rounded border hidden sm:inline-block ' +
          (parts.length ? 'bg-accent/10 border-accent/30 text-accent font-medium' : 'bg-panel2 border-line text-muted');
      }
    }

    function initSectionBanners() {
      const sectionToggles = m.root.querySelectorAll('[data-section-toggle]');
      sectionToggles.forEach((btn) => {
        btn.addEventListener('click', () => {
          const targetId = btn.getAttribute('data-section-toggle');
          const body = m.root.querySelector('#' + targetId);
          const chevron = btn.querySelector('[data-section-chevron]');
          if (!body) return;
          const isCurrentlyHidden = body.classList.contains('hidden');
          body.classList.toggle('hidden', !isCurrentlyHidden);
          if (chevron) {
            chevron.style.transform = isCurrentlyHidden ? 'rotate(180deg)' : 'rotate(0deg)';
          }
          btn.setAttribute('aria-expanded', isCurrentlyHidden ? 'true' : 'false');
          updateToggleAllButtonText();
        });
      });

      const toggleAllBtn = m.root.querySelector('#btn-toggle-all-sections');
      if (toggleAllBtn) {
        toggleAllBtn.addEventListener('click', () => {
          const bodies = [
            m.root.querySelector('#sec-1-content'),
            m.root.querySelector('#sec-2-content'),
            m.root.querySelector('#sec-3-content'),
            m.root.querySelector('#sec-4-content'),
          ].filter(Boolean);

          const anyHidden = bodies.some((b) => b.classList.contains('hidden'));
          bodies.forEach((b) => {
            b.classList.toggle('hidden', !anyHidden);
            const btn = m.root.querySelector('[data-section-toggle="' + b.id + '"]');
            const chevron = btn ? btn.querySelector('[data-section-chevron]') : null;
            if (chevron) {
              chevron.style.transform = anyHidden ? 'rotate(180deg)' : 'rotate(0deg)';
            }
            if (btn) btn.setAttribute('aria-expanded', anyHidden ? 'true' : 'false');
          });
          updateToggleAllButtonText();
        });
      }
    }

    function updateToggleAllButtonText() {
      const toggleAllBtn = m.root.querySelector('#btn-toggle-all-sections');
      if (!toggleAllBtn) return;
      const bodies = [
        m.root.querySelector('#sec-1-content'),
        m.root.querySelector('#sec-2-content'),
        m.root.querySelector('#sec-3-content'),
        m.root.querySelector('#sec-4-content'),
      ].filter(Boolean);
      const anyHidden = bodies.some((b) => b.classList.contains('hidden'));
      toggleAllBtn.innerHTML = anyHidden ? '<span>Expand All</span>' : '<span>Collapse All</span>';
    }

    initSectionBanners();
    updateSectionBannerPills();

    // Space Selection dynamic routing
    const spaceSelect = m.root.querySelector('#e-space');
    const categorySelect = m.root.querySelector('#e-category');
    const liveWorkflow = m.root.querySelector('#workflow-live-container');
    const cinemaWorkflow = m.root.querySelector('#workflow-cinema-container');
    const maintSection = m.root.querySelector('#section-maintenance-advancing');
    const cinemaMaintSection = m.root.querySelector('#section-cinema-maintenance');

    function updateSpaceWorkflow() {
      const currentSpace = (spaceSelect && spaceSelect.value) ? spaceSelect.value.trim() : '';
      const hasSpace = Boolean(currentSpace);
      const isScreen = hasSpace && isScreenSpace(currentSpace);
      const isLive = hasSpace && !isScreen;

      const spaceBadge = m.root.querySelector('#space-select-badge');
      if (spaceBadge) spaceBadge.classList.toggle('hidden', hasSpace);

      const spaceHint = m.root.querySelector('#space-select-hint');
      if (spaceHint) spaceHint.classList.toggle('hidden', hasSpace);

      const spaceIcon = m.root.querySelector('#space-input-icon');
      if (spaceIcon) {
        spaceIcon.className = 'absolute left-2.5 pointer-events-none transition-colors ' + (hasSpace ? 'text-accent' : 'text-accent/60');
      }

      if (spaceSelect) {
        spaceSelect.classList.toggle('border-accent/40', !hasSpace);
        spaceSelect.classList.toggle('bg-accent/5', !hasSpace);
        spaceSelect.classList.toggle('ring-2', !hasSpace);
        spaceSelect.classList.toggle('ring-accent/10', !hasSpace);
      }

      const unselectedPrompt = m.root.querySelector('#space-unselected-prompt');
      if (unselectedPrompt) unselectedPrompt.classList.toggle('hidden', hasSpace);

      if (liveWorkflow) liveWorkflow.classList.toggle('hidden', !isLive);
      if (cinemaWorkflow) cinemaWorkflow.classList.toggle('hidden', !isScreen);

      // Sync inputs if user toggles between workflows
      const cContact = m.root.querySelector('#e-cinema-contact');
      const lContact = m.root.querySelector('#e-contact');
      if (isScreen && cContact && lContact && !cContact.value) cContact.value = lContact.value;
      if (!isScreen && cContact && lContact && !lContact.value) lContact.value = cContact.value;

      const cInfo = m.root.querySelector('#e-cinema-info');
      const lInfo = m.root.querySelector('#e-info');
      if (isScreen && cInfo && lInfo && !cInfo.value) cInfo.value = lInfo.value;
      if (!isScreen && cInfo && lInfo && !lInfo.value) lInfo.value = cInfo.value;

      const cGuest = m.root.querySelector('#e-cinema-guest');
      const lGuest = m.root.querySelector('#e-guest');
      if (isScreen && cGuest && lGuest) cGuest.checked = lGuest.checked;
      if (!isScreen && cGuest && lGuest) lGuest.checked = cGuest.checked;

      const cEmail = m.root.querySelector('#e-cinema-email-recipients');
      const lEmail = m.root.querySelector('#e-email-recipients');
      if (isScreen && cEmail && lEmail && !cEmail.value) cEmail.value = lEmail.value;
      if (!isScreen && cEmail && lEmail && !lEmail.value) lEmail.value = cEmail.value;

      updateSectionBannerPills();
    }
    if (spaceSelect) spaceSelect.addEventListener('change', updateSpaceWorkflow);

    if (categorySelect) {
      categorySelect.addEventListener('change', () => {
        const isMaint = categorySelect.value === 'Maintenance';
        if (maintSection) maintSection.classList.toggle('hidden', !isMaint && !linkedMaintIds.length);
        if (cinemaMaintSection) cinemaMaintSection.classList.toggle('hidden', !isMaint && !linkedMaintIds.length);
        if (categorySelect.value === 'Cinema' && !spaceSelect.value) {
          spaceSelect.value = 'Cinema 1';
          updateSpaceWorkflow();
        }
      });
    }

    // Maintenance tasks picker
    function renderMaintenancePicker() {
      ['#maintenance-tasks-picker', '#cinema-maintenance-picker'].forEach((sel) => {
        const picker = m.root.querySelector(sel);
        if (!picker) return;
        if (!openFaults.length) {
          picker.innerHTML = '<div class="text-xs text-muted italic p-2 rounded bg-panel border border-line">No open maintenance tasks or faults found.</div>';
          return;
        }
        picker.innerHTML = openFaults.map((f) => {
          const isChecked = linkedMaintIds.indexOf(f.id) !== -1;
          return (
            '<label class="flex items-start gap-2.5 p-2.5 rounded-lg bg-panel border border-line cursor-pointer hover:border-accent/50 text-xs">' +
              '<input type="checkbox" data-maint-id="' + f.id + '" class="w-4 h-4 mt-0.5 rounded border-line accent-[var(--accent)] shrink-0 cursor-pointer" ' + (isChecked ? 'checked' : '') + ' />' +
              '<div class="min-w-0 flex-1">' +
                '<div class="flex items-center justify-between gap-2">' +
                  '<span class="font-medium text-ink">' + ui.esc(f.title || f.equipment || 'Fault') + '</span>' +
                  ui.pill(f.status || 'Reported', f.status === 'Resolved' ? 'var(--ok)' : (f.status === 'In Progress' ? 'var(--info)' : 'var(--warning)')) +
                '</div>' +
                '<div class="text-muted text-[11px] mt-0.5">' + ui.esc(f.space || f.location || 'Venue') + (f.description ? ' \u00b7 ' + ui.esc(f.description) : '') + '</div>' +
              '</div>' +
            '</label>'
          );
        }).join('');

        picker.querySelectorAll('[data-maint-id]').forEach((cb) => {
          cb.addEventListener('change', (e) => {
            const fid = cb.getAttribute('data-maint-id');
            if (e.target.checked) {
              if (linkedMaintIds.indexOf(fid) === -1) linkedMaintIds.push(fid);
            } else {
              linkedMaintIds = linkedMaintIds.filter((x) => x !== fid);
            }
            m.root.querySelectorAll('[data-maint-id="' + fid + '"]').forEach((otherCb) => {
              otherCb.checked = e.target.checked;
            });
            updateSectionBannerPills();
          });
        });
      });
    }
    renderMaintenancePicker();

    // Channel List Builder: Inputs
    function renderChannelInputs() {
      const container = m.root.querySelector('#channel-inputs-container');
      if (!container) return;
      updateSectionBannerPills();
      if (!channelInputs.length) {
        container.innerHTML = '<div class="text-xs text-muted italic p-2.5 rounded bg-panel border border-line text-center">No input channels added. Click "+ Add Input Channel" to build patch list.</div>';
        return;
      }
      container.innerHTML = channelInputs.map((ch, idx) => (
        '<div class="p-2 rounded-lg bg-panel border border-line flex flex-col gap-1.5 text-xs">' +
          '<div class="flex items-center justify-between gap-2">' +
            '<div class="flex items-center gap-1.5 font-mono font-semibold text-accent">' +
              '<span>Ch ' + (ch.channel || (idx + 1)) + '</span>' +
            '</div>' +
            '<div class="flex items-center gap-1">' +
              '<label class="flex items-center gap-1 text-[11px] text-muted mr-2 cursor-pointer">' +
                '<input type="checkbox" data-inp-48v="' + idx + '" class="w-3.5 h-3.5 accent-[var(--danger)]" ' + (ch.phantom ? 'checked' : '') + ' />' +
                '<span class="' + (ch.phantom ? 'text-danger font-bold' : '') + '">+48V</span>' +
              '</label>' +
              '<button type="button" data-inp-up="' + idx + '" class="btn btn-ghost !p-1" title="Move Up" ' + (idx === 0 ? 'disabled' : '') + '>' + ui.icon('arrowU', 'w-3 h-3') + '</button>' +
              '<button type="button" data-inp-down="' + idx + '" class="btn btn-ghost !p-1" title="Move Down" ' + (idx === channelInputs.length - 1 ? 'disabled' : '') + '>' + ui.icon('arrowD', 'w-3 h-3') + '</button>' +
              '<button type="button" data-inp-del="' + idx + '" class="btn btn-danger !p-1" title="Remove">' + ui.icon('trash', 'w-3 h-3') + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="grid grid-cols-2 sm:grid-cols-5 gap-2">' +
            '<div>' +
              '<input list="inp-patch-presets" data-inp-patch="' + idx + '" class="field !py-1 !px-2 text-xs" value="' + ui.esc(ch.patch || '') + '" placeholder="Patch (e.g. A1)" />' +
            '</div>' +
            '<div>' +
              '<input list="inp-inst-presets" data-inp-inst="' + idx + '" class="field !py-1 !px-2 text-xs" value="' + ui.esc(ch.instrument || '') + '" placeholder="Instrument (e.g. Kick)" />' +
            '</div>' +
            '<div>' +
              '<input list="inp-mic-presets" data-inp-mic="' + idx + '" class="field !py-1 !px-2 text-xs" value="' + ui.esc(ch.mic || '') + '" placeholder="Mic/DI (e.g. SM58)" />' +
            '</div>' +
            '<div>' +
              '<select data-inp-stand="' + idx + '" class="field !py-1 !px-2 text-xs">' +
                '<option value="">Stand\u2026</option>' +
                INPUT_STAND_PRESETS.map((s) => '<option ' + (s === ch.stand ? 'selected' : '') + '>' + s + '</option>').join('') +
              '</select>' +
            '</div>' +
            '<div>' +
              '<select data-inp-pos="' + idx + '" class="field !py-1 !px-2 text-xs">' +
                '<option value="">Position\u2026</option>' +
                INPUT_POSITIONS.map((p) => '<option ' + (p === ch.pos ? 'selected' : '') + '>' + p + '</option>').join('') +
              '</select>' +
            '</div>' +
          '</div>' +
        '</div>'
      )).join('') +
      '<datalist id="inp-inst-presets">' + INPUT_INSTRUMENT_PRESETS.map((p) => '<option value="' + p + '"></option>').join('') + '</datalist>' +
      '<datalist id="inp-mic-presets">' + INPUT_MIC_PRESETS.map((p) => '<option value="' + p + '"></option>').join('') + '</datalist>' +
      '<datalist id="inp-patch-presets">' + patchOptions.map((p) => '<option value="' + p + '"></option>').join('') + '</datalist>';

      container.querySelectorAll('[data-inp-patch]').forEach((inp) => {
        inp.addEventListener('input', () => { channelInputs[+inp.getAttribute('data-inp-patch')].patch = inp.value; });
      });
      container.querySelectorAll('[data-inp-inst]').forEach((inp) => {
        inp.addEventListener('input', () => { channelInputs[+inp.getAttribute('data-inp-inst')].instrument = inp.value; });
      });
      container.querySelectorAll('[data-inp-mic]').forEach((inp) => {
        inp.addEventListener('input', () => { channelInputs[+inp.getAttribute('data-inp-mic')].mic = inp.value; });
      });
      container.querySelectorAll('[data-inp-stand]').forEach((sel) => {
        sel.addEventListener('change', () => { channelInputs[+sel.getAttribute('data-inp-stand')].stand = sel.value; });
      });
      container.querySelectorAll('[data-inp-pos]').forEach((sel) => {
        sel.addEventListener('change', () => { channelInputs[+sel.getAttribute('data-inp-pos')].pos = sel.value; });
      });
      container.querySelectorAll('[data-inp-48v]').forEach((chk) => {
        chk.addEventListener('change', () => { channelInputs[+chk.getAttribute('data-inp-48v')].phantom = chk.checked; });
      });
      container.querySelectorAll('[data-inp-up]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = +btn.getAttribute('data-inp-up');
          if (idx > 0) {
            const t = channelInputs[idx]; channelInputs[idx] = channelInputs[idx - 1]; channelInputs[idx - 1] = t;
            renumberInputs(); renderChannelInputs();
          }
        });
      });
      container.querySelectorAll('[data-inp-down]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = +btn.getAttribute('data-inp-down');
          if (idx < channelInputs.length - 1) {
            const t = channelInputs[idx]; channelInputs[idx] = channelInputs[idx + 1]; channelInputs[idx + 1] = t;
            renumberInputs(); renderChannelInputs();
          }
        });
      });
      container.querySelectorAll('[data-inp-del]').forEach((btn) => {
        btn.addEventListener('click', () => {
          channelInputs.splice(+btn.getAttribute('data-inp-del'), 1);
          renumberInputs(); renderChannelInputs();
        });
      });
    }

    function renumberInputs() {
      channelInputs.forEach((ch, i) => { ch.channel = i + 1; });
    }

    const addInputBtn = m.root.querySelector('#btn-add-input-chan');
    if (addInputBtn) {
      addInputBtn.addEventListener('click', () => {
        channelInputs.push({
          channel: channelInputs.length + 1,
          instrument: '',
          mic: '',
          stand: 'Tall Boom',
          pos: 'Centre Stage',
          phantom: false
        });
        renderChannelInputs();
      });
    }

    const autoPatchBtn = m.root.querySelector('#btn-auto-patch-inputs');
    if (autoPatchBtn) {
      autoPatchBtn.addEventListener('click', () => {
        let patchIndex = 0;
        channelInputs.forEach((ch, idx) => {
          if (!ch.patch && patchIndex < patchOptions.length) {
            ch.patch = patchOptions[patchIndex];
            patchIndex++;
          }
        });
        renderChannelInputs();
        ui.toast('Auto-allocated channels to house patch', 'ok');
      });
    }

    const clearInputBtn = m.root.querySelector('#btn-clear-input-chan');
    if (clearInputBtn) {
      clearInputBtn.addEventListener('click', () => {
        if (confirm('Clear all master input channels?')) {
          channelInputs = [];
          renderChannelInputs();
        }
      });
    }

    // Global Festival Input Presets
    const GLOBAL_PRESETS = {
      band: [
        { instrument: 'Kick In', mic: 'Shure Beta 91A', stand: 'N/A', pos: 'Upstage Centre', phantom: true },
        { instrument: 'Kick Out', mic: 'Shure Beta 52', stand: 'Short Boom', pos: 'Upstage Centre', phantom: false },
        { instrument: 'Snare Top', mic: 'Shure SM57', stand: 'Short Boom', pos: 'Upstage Centre', phantom: false },
        { instrument: 'Snare Bottom', mic: 'Shure SM57', stand: 'Claw / Clip', pos: 'Upstage Centre', phantom: false },
        { instrument: 'Hi-Hat', mic: 'AKG C414', stand: 'Tall Boom', pos: 'Upstage Centre', phantom: true },
        { instrument: 'Rack Tom', mic: 'Sennheiser e604', stand: 'Claw / Clip', pos: 'Upstage Centre', phantom: false },
        { instrument: 'Floor Tom', mic: 'Sennheiser e604', stand: 'Claw / Clip', pos: 'Upstage Centre', phantom: false },
        { instrument: 'OH Left', mic: 'AKG C414', stand: 'Tall Boom', pos: 'Upstage Left', phantom: true },
        { instrument: 'OH Right', mic: 'AKG C414', stand: 'Tall Boom', pos: 'Upstage Right', phantom: true },
        { instrument: 'Bass DI', mic: 'Radial ProDI', stand: 'N/A', pos: 'Stage Right', phantom: false },
        { instrument: 'Bass Mic', mic: 'Sennheiser e906', stand: 'Short Boom', pos: 'Stage Right', phantom: false },
        { instrument: 'Gtr SL', mic: 'Shure SM57', stand: 'Short Boom', pos: 'Stage Left', phantom: false },
        { instrument: 'Gtr SR', mic: 'Sennheiser e906', stand: 'Short Boom', pos: 'Stage Right', phantom: false },
        { instrument: 'Keys L', mic: 'Radial ProD2', stand: 'N/A', pos: 'Stage Left', phantom: false },
        { instrument: 'Keys R', mic: 'Radial ProD2', stand: 'N/A', pos: 'Stage Left', phantom: false },
        { instrument: 'Lead Vox', mic: 'Shure Beta 58', stand: 'Tall Boom', pos: 'Centre Stage', phantom: false },
        { instrument: 'Backing Vox SL', mic: 'Shure SM58', stand: 'Tall Boom', pos: 'Stage Left', phantom: false },
        { instrument: 'Backing Vox SR', mic: 'Shure SM58', stand: 'Tall Boom', pos: 'Stage Right', phantom: false },
      ],
      acoustic: [
        { instrument: 'Acoustic Gtr L', mic: 'Radial ProDI', stand: 'N/A', pos: 'Centre Stage', phantom: false },
        { instrument: 'Acoustic Gtr R', mic: 'Radial ProDI', stand: 'N/A', pos: 'Stage Right', phantom: false },
        { instrument: 'Vocal 1 (Lead)', mic: 'Shure Beta 58', stand: 'Tall Boom', pos: 'Centre Stage', phantom: false },
        { instrument: 'Vocal 2', mic: 'Shure SM58', stand: 'Tall Boom', pos: 'Stage Right', phantom: false },
        { instrument: 'Percussion / Cajon', mic: 'Shure Beta 91A', stand: 'N/A', pos: 'Upstage Centre', phantom: true },
      ],
      dj: [
        { instrument: 'DJ Master L', mic: 'Radial ProD2', stand: 'N/A', pos: 'Centre Stage', phantom: false },
        { instrument: 'DJ Master R', mic: 'Radial ProD2', stand: 'N/A', pos: 'Centre Stage', phantom: false },
        { instrument: 'DJ Booth L', mic: 'Line In', stand: 'N/A', pos: 'Centre Stage', phantom: false },
        { instrument: 'DJ Booth R', mic: 'Line In', stand: 'N/A', pos: 'Centre Stage', phantom: false },
        { instrument: 'Host / MC Mic', mic: 'Wireless Handheld', stand: 'Tall Boom', pos: 'Downstage Centre', phantom: false },
      ],
      fest: [
        { instrument: 'Kick', mic: 'Shure Beta 52', stand: 'Short Boom', pos: 'Upstage Centre', phantom: false },
        { instrument: 'Snare', mic: 'Shure SM57', stand: 'Short Boom', pos: 'Upstage Centre', phantom: false },
        { instrument: 'Hi-Hat', mic: 'AKG C414', stand: 'Tall Boom', pos: 'Upstage Centre', phantom: true },
        { instrument: 'Tom 1', mic: 'Sennheiser e604', stand: 'Claw / Clip', pos: 'Upstage Centre', phantom: false },
        { instrument: 'Tom 2', mic: 'Sennheiser e604', stand: 'Claw / Clip', pos: 'Upstage Centre', phantom: false },
        { instrument: 'Tom 3', mic: 'Sennheiser e604', stand: 'Claw / Clip', pos: 'Upstage Centre', phantom: false },
        { instrument: 'OH L', mic: 'AKG C414', stand: 'Tall Boom', pos: 'Upstage Left', phantom: true },
        { instrument: 'OH R', mic: 'AKG C414', stand: 'Tall Boom', pos: 'Upstage Right', phantom: true },
        { instrument: 'Bass DI', mic: 'Radial ProDI', stand: 'N/A', pos: 'Stage Right', phantom: false },
        { instrument: 'Gtr 1', mic: 'Shure SM57', stand: 'Short Boom', pos: 'Stage Left', phantom: false },
        { instrument: 'Gtr 2', mic: 'Sennheiser e906', stand: 'Short Boom', pos: 'Stage Right', phantom: false },
        { instrument: 'Keys L', mic: 'Radial ProD2', stand: 'N/A', pos: 'Stage Left', phantom: false },
        { instrument: 'Keys R', mic: 'Radial ProD2', stand: 'N/A', pos: 'Stage Left', phantom: false },
        { instrument: 'Vox 1', mic: 'Shure Beta 58', stand: 'Tall Boom', pos: 'Downstage Left', phantom: false },
        { instrument: 'Vox 2 (Main)', mic: 'Shure Beta 58', stand: 'Tall Boom', pos: 'Downstage Centre', phantom: false },
        { instrument: 'Vox 3', mic: 'Shure Beta 58', stand: 'Tall Boom', pos: 'Downstage Right', phantom: false },
      ]
    };

    // Global input preset selector
    const selGlobalInpPreset = m.root.querySelector('#sel-global-inp-preset');
    if (selGlobalInpPreset) {
      selGlobalInpPreset.addEventListener('change', () => {
        const pid = selGlobalInpPreset.value;
        if (!pid) return;
        const allPresets = RMTP.presets.getInputs();
        const p = allPresets.find((x) => x.id === pid);
        if (p && Array.isArray(p.channels)) {
          p.channels.forEach((item) => {
            channelInputs.push(Object.assign({ channel: channelInputs.length + 1 }, item));
          });
          renderChannelInputs();
          ui.toast('Loaded preset: ' + p.name, 'ok');
        }
        selGlobalInpPreset.value = '';
      });
    }

    // Global save input preset
    const btnGlobalSaveInp = m.root.querySelector('#btn-global-save-inp-preset');
    if (btnGlobalSaveInp) {
      btnGlobalSaveInp.addEventListener('click', () => {
        if (!channelInputs.length) {
          ui.toast('No input channels to save as a preset', 'warning');
          return;
        }
        RMTP.presets.openSaveAsModal('input', channelInputs, (newP) => {
          // Re-populate dropdown
          if (selGlobalInpPreset) {
            selGlobalInpPreset.innerHTML = '<option value="">⚡ Load Input Preset\u2026</option>' +
              RMTP.presets.getInputs().map((p) => '<option value="' + p.id + '">' + ui.esc(p.name) + ' (' + (p.channels ? p.channels.length : 0) + ' Ch)</option>').join('');
          }
        });
      });
    }

    // Global Manage Presets button
    const btnGlobalManage = m.root.querySelector('#btn-global-manage-presets');
    if (btnGlobalManage) {
      btnGlobalManage.addEventListener('click', () => {
        RMTP.presets.openEditorModal(null, 'input', () => {
          // Re-populate dropdowns
          if (selGlobalInpPreset) {
            selGlobalInpPreset.innerHTML = '<option value="">⚡ Load Input Preset\u2026</option>' +
              RMTP.presets.getInputs().map((p) => '<option value="' + p.id + '">' + ui.esc(p.name) + ' (' + (p.channels ? p.channels.length : 0) + ' Ch)</option>').join('');
          }
          if (selGlobalOutPreset) {
            selGlobalOutPreset.innerHTML = '<option value="">⚡ Load Output Preset\u2026</option>' +
              RMTP.presets.getOutputs().map((p) => '<option value="' + p.id + '">' + ui.esc(p.name) + ' (' + (p.channels ? p.channels.length : 0) + ' Out)</option>').join('');
          }
        });
      });
    }

    // Stagebox Patch Sheet button
    const btnOpenPatchSheet = m.root.querySelector('#btn-open-patch-sheet-builder');
    if (btnOpenPatchSheet) {
      btnOpenPatchSheet.addEventListener('click', () => {
        // Auto-save the event to ensure patch sheet builder pulls the latest channel list
        const saveBtn = m.root.querySelector('[data-save]');
        if (saveBtn) {
          saveBtn.click(); // Triggers the save function which updates the DB
        }

        setTimeout(() => {
          const allSheets = RMTP.presets.getAllPatchSheets();
          const existingForEvent = (ev && ev.id) ? allSheets.find((s) => s.eventId === ev.id) : null;
          if (existingForEvent) {
            RMTP.presets.openPatchSheetModal(existingForEvent);
          } else {
            RMTP.presets.openPatchSheetModal({
              id: null,
              name: (ev && ev.name ? ev.name + ' — Stagebox Patch Plan' : 'Event Patch Sheet'),
              eventId: (ev && ev.id) || null,
              eventName: (ev && ev.name) || '',
              space: (ev && (ev.space || (spaceSelect && spaceSelect.value))) || 'The Stage',
              date: (ev && ev.date) || new Date().toISOString().slice(0, 10),
              notes: (ev && ev.techInfo) || ''
            });
          }
        }, 200);
      });
    }

    renderChannelInputs();

    // Channel List Builder: Outputs
    function renderChannelOutputs() {
      const container = m.root.querySelector('#channel-outputs-container');
      if (!container) return;
      updateSectionBannerPills();
      if (!channelOutputs.length) {
        container.innerHTML = '<div class="text-xs text-muted italic p-2.5 rounded bg-panel border border-line text-center">No master outputs added. Click "+ Add Output" or use preset buttons.</div>';
        return;
      }
      container.innerHTML = channelOutputs.map((out, idx) => (
        '<div class="p-2 rounded-lg bg-panel border border-line flex flex-col gap-1.5 text-xs">' +
          '<div class="flex items-center justify-between gap-2">' +
            '<div class="flex items-center gap-1.5 font-mono font-semibold text-info">' +
              '<span>Out ' + (out.num || (idx + 1)) + '</span>' +
              (out.stereo ? '<span class="px-1 py-0.2 rounded bg-info/20 text-[10px]">Stereo</span>' : '') +
            '</div>' +
            '<div class="flex items-center gap-1">' +
              '<label class="flex items-center gap-1 text-[11px] text-muted mr-2 cursor-pointer">' +
                '<input type="checkbox" data-out-stereo="' + idx + '" class="w-3.5 h-3.5 accent-[var(--info)]" ' + (out.stereo ? 'checked' : '') + ' />' +
                '<span>Stereo</span>' +
              '</label>' +
              '<button type="button" data-out-up="' + idx + '" class="btn btn-ghost !p-1" title="Move Up" ' + (idx === 0 ? 'disabled' : '') + '>' + ui.icon('arrowU', 'w-3 h-3') + '</button>' +
              '<button type="button" data-out-down="' + idx + '" class="btn btn-ghost !p-1" title="Move Down" ' + (idx === channelOutputs.length - 1 ? 'disabled' : '') + '>' + ui.icon('arrowD', 'w-3 h-3') + '</button>' +
              '<button type="button" data-out-del="' + idx + '" class="btn btn-danger !p-1" title="Remove">' + ui.icon('trash', 'w-3 h-3') + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="grid grid-cols-1 sm:grid-cols-3 gap-2">' +
            '<div>' +
              '<input data-out-name="' + idx + '" class="field !py-1 !px-2 text-xs" value="' + ui.esc(out.name || '') + '" placeholder="Label (e.g. Mix 1 Lead Wedge)" />' +
            '</div>' +
            '<div>' +
              '<select data-out-type="' + idx + '" class="field !py-1 !px-2 text-xs">' +
                OUTPUT_TYPE_PRESETS.map((t) => '<option ' + (t === out.type ? 'selected' : '') + '>' + t + '</option>').join('') +
              '</select>' +
            '</div>' +
            '<div>' +
              '<input data-out-dest="' + idx + '" class="field !py-1 !px-2 text-xs" value="' + ui.esc(out.dest || '') + '" placeholder="Stage Destination / Mix" />' +
            '</div>' +
          '</div>' +
        '</div>'
      )).join('');

      container.querySelectorAll('[data-out-name]').forEach((inp) => {
        inp.addEventListener('input', () => { channelOutputs[+inp.getAttribute('data-out-name')].name = inp.value; });
      });
      container.querySelectorAll('[data-out-type]').forEach((sel) => {
        sel.addEventListener('change', () => { channelOutputs[+sel.getAttribute('data-out-type')].type = sel.value; });
      });
      container.querySelectorAll('[data-out-dest]').forEach((inp) => {
        inp.addEventListener('input', () => { channelOutputs[+inp.getAttribute('data-out-dest')].dest = inp.value; });
      });
      container.querySelectorAll('[data-out-stereo]').forEach((chk) => {
        chk.addEventListener('change', () => { channelOutputs[+chk.getAttribute('data-out-stereo')].stereo = chk.checked; renderChannelOutputs(); });
      });
      container.querySelectorAll('[data-out-up]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = +btn.getAttribute('data-out-up');
          if (idx > 0) {
            const t = channelOutputs[idx]; channelOutputs[idx] = channelOutputs[idx - 1]; channelOutputs[idx - 1] = t;
            renumberOutputs(); renderChannelOutputs();
          }
        });
      });
      container.querySelectorAll('[data-out-down]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = +btn.getAttribute('data-out-down');
          if (idx < channelOutputs.length - 1) {
            const t = channelOutputs[idx]; channelOutputs[idx] = channelOutputs[idx + 1]; channelOutputs[idx + 1] = t;
            renumberOutputs(); renderChannelOutputs();
          }
        });
      });
      container.querySelectorAll('[data-out-del]').forEach((btn) => {
        btn.addEventListener('click', () => {
          channelOutputs.splice(+btn.getAttribute('data-out-del'), 1);
          renumberOutputs(); renderChannelOutputs();
        });
      });
    }

    function renumberOutputs() {
      channelOutputs.forEach((out, i) => { out.num = i + 1; });
    }

    const addOutputBtn = m.root.querySelector('#btn-add-output-chan');
    if (addOutputBtn) {
      addOutputBtn.addEventListener('click', () => {
        channelOutputs.push({
          num: channelOutputs.length + 1,
          name: '',
          type: 'Wedge',
          dest: 'Stage Left',
          stereo: false
        });
        renderChannelOutputs();
      });
    }

    const clearOutputBtn = m.root.querySelector('#btn-clear-output-chan');
    if (clearOutputBtn) {
      clearOutputBtn.addEventListener('click', () => {
        if (confirm('Clear all master outputs?')) {
          channelOutputs = [];
          renderChannelOutputs();
        }
      });
    }

    // Global output preset selector
    const selGlobalOutPreset = m.root.querySelector('#sel-global-out-preset');
    if (selGlobalOutPreset) {
      selGlobalOutPreset.addEventListener('change', () => {
        const pid = selGlobalOutPreset.value;
        if (!pid) return;
        const allPresets = RMTP.presets.getOutputs();
        const p = allPresets.find((x) => x.id === pid);
        if (p && Array.isArray(p.channels)) {
          p.channels.forEach((item) => {
            channelOutputs.push(Object.assign({ num: channelOutputs.length + 1 }, item));
          });
          renderChannelOutputs();
          ui.toast('Loaded preset: ' + p.name, 'ok');
        }
        selGlobalOutPreset.value = '';
      });
    }

    // Global save output preset
    const btnGlobalSaveOut = m.root.querySelector('#btn-global-save-out-preset');
    if (btnGlobalSaveOut) {
      btnGlobalSaveOut.addEventListener('click', () => {
        if (!channelOutputs.length) {
          ui.toast('No output channels to save as a preset', 'warning');
          return;
        }
        RMTP.presets.openSaveAsModal('output', channelOutputs, (newP) => {
          // Re-populate dropdown
          if (selGlobalOutPreset) {
            selGlobalOutPreset.innerHTML = '<option value="">⚡ Load Output Preset\u2026</option>' +
              RMTP.presets.getOutputs().map((p) => '<option value="' + p.id + '">' + ui.esc(p.name) + ' (' + (p.channels ? p.channels.length : 0) + ' Out)</option>').join('');
          }
        });
      });
    }

    renderChannelOutputs();

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
            duration: '00:30',
            techReqType: 'none',
            techNotes: '',
            techFile: null,
            channelInputs: [],
            channelOutputs: []
          });
        } else if (type === 'changeover') {
          scheduleItems.push({
            type: 'changeover',
            label: 'Changeover',
            customName: '',
            time: '',
            duration: '00:15',
            techReqType: 'none'
          });
        } else {
          scheduleItems.push({
            type: 'other',
            label: 'Other',
            customName: '',
            time: '',
            duration: '00:30',
            techReqType: 'none',
            techNotes: '',
            techFile: null,
            channelInputs: [],
            channelOutputs: []
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

        const reqType = item.techReqType || 'none';
        const itemFile = item.pendingFile || (item.clearedFile ? null : item.techFile);
        const inList = Array.isArray(item.channelInputs) ? item.channelInputs : [];
        const outList = Array.isArray(item.channelOutputs) ? item.channelOutputs : [];
        const inCount = inList.length;
        const outCount = outList.length;
        const actTab = item._actTab || 'inputs';

        return (
          '<div class="p-3 rounded-lg bg-panel border border-line flex flex-col gap-2.5 relative group shadow-sm">' +
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

            // Technical Requirements linking per act
            (!isChangeover ? (
              '<div class="mt-2 pt-2 border-t border-line/60 flex flex-col gap-2">' +
                '<div class="flex flex-wrap items-center justify-between gap-2">' +
                  '<div class="flex items-center gap-1.5 text-xs font-semibold text-ink">' +
                    '<span class="text-accent">' + ui.icon('gear', 'w-3.5 h-3.5') + '</span>' +
                    '<span>Tech Requirements:</span>' +
                  '</div>' +
                  '<div class="flex items-center gap-1 flex-wrap">' +
                    '<button type="button" data-act-mode="none" data-act-idx="' + idx + '" class="px-2 py-0.5 rounded text-[11px] font-medium border ' + (reqType === 'none' ? 'bg-panel2 border-accent text-accent font-semibold' : 'border-line text-muted hover:text-ink') + '">None</button>' +
                    '<button type="button" data-act-mode="text" data-act-idx="' + idx + '" class="px-2 py-0.5 rounded text-[11px] font-medium border ' + (reqType === 'text' ? 'bg-panel2 border-accent text-accent font-semibold' : 'border-line text-muted hover:text-ink') + '">Rich Text</button>' +
                    '<button type="button" data-act-mode="file" data-act-idx="' + idx + '" class="px-2 py-0.5 rounded text-[11px] font-medium border ' + (reqType === 'file' ? 'bg-panel2 border-accent text-accent font-semibold' : 'border-line text-muted hover:text-ink') + '">File Upload' + (itemFile ? ' (1)' : '') + '</button>' +
                    '<button type="button" data-act-mode="channels" data-act-idx="' + idx + '" class="px-2 py-0.5 rounded text-[11px] font-medium border ' + (reqType === 'channels' ? 'bg-panel2 border-accent text-accent font-semibold' : 'border-line text-muted hover:text-ink') + '">Custom List (' + inCount + ' In \u00b7 ' + outCount + ' Out)</button>' +
                  '</div>' +
                '</div>' +

                // 1. Rich Text View
                (reqType === 'text' ? (
                  '<div class="mt-1">' +
                    '<textarea data-act-notes="' + idx + '" class="field text-xs leading-relaxed" rows="3" placeholder="Stage requirements, artist rider notes, vocal mics, DI requirements, backline notes, monitor mixes...">' + ui.esc(item.techNotes || '') + '</textarea>' +
                  '</div>'
                ) : '') +

                // 2. File Upload View
                (reqType === 'file' ? (
                  '<div class="mt-1">' +
                    (itemFile ? (
                      '<div class="p-2.5 rounded bg-panel2/60 border border-line flex items-center justify-between gap-2 text-xs">' +
                        '<div class="flex items-center gap-2 min-w-0">' +
                          '<span class="text-accent">' + ui.icon('file', 'w-4 h-4') + '</span>' +
                          '<span class="font-medium truncate text-ink">' + ui.esc(itemFile.name) + '</span>' +
                          '<span class="text-[10px] text-muted shrink-0">' + files.humanSize(itemFile.size) + (item.pendingFile ? ' \u00b7 unsaved' : '') + '</span>' +
                        '</div>' +
                        '<div class="flex items-center gap-1 shrink-0">' +
                          '<button type="button" data-act-file-view="' + idx + '" class="btn btn-ghost !p-1.5" title="View Rider">' + ui.icon('arrowR', 'w-3.5 h-3.5') + '</button>' +
                          '<button type="button" data-act-file-remove="' + idx + '" class="btn btn-danger !p-1.5" title="Remove PDF">' + ui.icon('trash', 'w-3.5 h-3.5') + '</button>' +
                        '</div>' +
                      '</div>'
                    ) : (
                      '<label class="btn btn-ghost !py-2 !px-3 text-xs cursor-pointer border border-dashed border-line hover:border-accent inline-flex items-center gap-2 text-accent">' +
                        '<input type="file" accept="application/pdf,.pdf" data-act-file-inp="' + idx + '" class="sr-only" />' +
                        ui.icon('upload', 'w-3.5 h-3.5') +
                        '<span>Upload Act Tech Spec / Rider (PDF up to ' + files.humanSize(files.MAX) + ')</span>' +
                      '</label>'
                    )) +
                  '</div>'
                ) : '') +

                // 3. Custom List View (Inputs & Outputs)
                (reqType === 'channels' ? (
                  '<div class="mt-1 flex flex-col gap-2 p-2.5 rounded-lg bg-panel2/40 border border-line">' +
                    // Sub-tabs: Inputs vs Outputs
                    '<div class="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-line/60">' +
                      '<div class="flex items-center gap-1.5">' +
                        '<button type="button" data-act-subtab="inputs" data-act-idx="' + idx + '" class="px-2.5 py-1 rounded text-xs font-semibold ' + (actTab === 'inputs' ? 'bg-accent text-white shadow-xs' : 'bg-panel text-muted hover:text-ink border border-line') + '">Act Inputs (' + inCount + ')</button>' +
                        '<button type="button" data-act-subtab="outputs" data-act-idx="' + idx + '" class="px-2.5 py-1 rounded text-xs font-semibold ' + (actTab === 'outputs' ? 'bg-info text-white shadow-xs' : 'bg-panel text-muted hover:text-ink border border-line') + '">Act Outputs & Monitors (' + outCount + ')</button>' +
                      '</div>' +
                      '<div class="flex items-center gap-1.5 flex-wrap">' +
                        (actTab === 'inputs' ? (
                          '<select data-act-inp-preset-sel="' + idx + '" class="field !py-0.5 !px-1.5 text-[11px] font-medium !w-auto bg-panel text-accent cursor-pointer">' +
                            '<option value="">⚡ Load Input Preset\u2026</option>' +
                            RMTP.presets.getInputs().map((p) => '<option value="' + p.id + '">' + ui.esc(p.name) + ' (' + (p.channels ? p.channels.length : 0) + ' Ch)</option>').join('') +
                          '</select>' +
                          '<button type="button" data-act-save-inp-preset="' + idx + '" class="btn btn-ghost !py-0.5 !px-2 text-[10px] text-accent" title="Save this act\'s inputs as a preset">💾 Save Preset</button>' +
                          '<button type="button" data-act-add-input="' + idx + '" class="btn btn-primary !py-0.5 !px-2 text-[10px] flex items-center gap-1 font-semibold">' +
                            ui.icon('plus', 'w-3 h-3') + '<span>Add Channel</span>' +
                          '</button>' +
                          (inCount ? '<button type="button" data-act-autopatch="' + idx + '" class="btn btn-secondary !py-0.5 !px-1.5 text-[10px]" title="Auto-Patch to House">Auto-Patch</button><button type="button" data-act-clear-input="' + idx + '" class="btn btn-danger !py-0.5 !px-1.5 text-[10px]" title="Clear Inputs">Clear</button>' : '')
                        ) : (
                          '<select data-act-out-preset-sel="' + idx + '" class="field !py-0.5 !px-1.5 text-[11px] font-medium !w-auto bg-panel text-info cursor-pointer">' +
                            '<option value="">⚡ Load Output Preset\u2026</option>' +
                            RMTP.presets.getOutputs().map((p) => '<option value="' + p.id + '">' + ui.esc(p.name) + ' (' + (p.channels ? p.channels.length : 0) + ' Out)</option>').join('') +
                          '</select>' +
                          '<button type="button" data-act-save-out-preset="' + idx + '" class="btn btn-ghost !py-0.5 !px-2 text-[10px] text-info" title="Save this act\'s outputs as a preset">💾 Save Preset</button>' +
                          '<button type="button" data-act-add-output="' + idx + '" class="btn btn-primary !py-0.5 !px-2 text-[10px] flex items-center gap-1 font-semibold">' +
                            ui.icon('plus', 'w-3 h-3') + '<span>Add Output</span>' +
                          '</button>' +
                          (outCount ? '<button type="button" data-act-clear-output="' + idx + '" class="btn btn-danger !py-0.5 !px-1.5 text-[10px]" title="Clear Outputs">Clear</button>' : '')
                        )) +
                      '</div>' +
                    '</div>' +

                    // Tab Body: Inputs
                    (actTab === 'inputs' ? (
                      !inCount ? (
                        '<div class="text-[11px] text-muted italic text-center py-2.5">No input channels for this act yet. Click "+ Add Channel" or choose an input preset above.</div>'
                      ) : (
                        '<div class="grid gap-1.5 max-h-60 overflow-y-auto pr-1">' +
                          inList.map((ch, chIdx) => (
                            '<div class="p-1.5 rounded bg-panel border border-line flex flex-col gap-1 text-xs">' +
                              '<div class="flex items-center justify-between gap-2">' +
                                '<span class="font-mono font-bold text-accent text-[11px]">Ch ' + (ch.channel || (chIdx + 1)) + '</span>' +
                                '<div class="flex items-center gap-1">' +
                                  '<label class="flex items-center gap-1 text-[11px] text-muted mr-1.5 cursor-pointer">' +
                                    '<input type="checkbox" data-act-ch-48v="' + idx + '-' + chIdx + '" class="w-3.5 h-3.5 accent-[var(--danger)]" ' + (ch.phantom ? 'checked' : '') + ' />' +
                                    '<span class="' + (ch.phantom ? 'text-danger font-bold' : '') + '">+48V</span>' +
                                  '</label>' +
                                  '<button type="button" data-act-ch-up="' + idx + '-' + chIdx + '" class="btn btn-ghost !p-1" title="Move Up" ' + (chIdx === 0 ? 'disabled' : '') + '>' + ui.icon('arrowU', 'w-3 h-3') + '</button>' +
                                  '<button type="button" data-act-ch-down="' + idx + '-' + chIdx + '" class="btn btn-ghost !p-1" title="Move Down" ' + (chIdx === inCount - 1 ? 'disabled' : '') + '>' + ui.icon('arrowD', 'w-3 h-3') + '</button>' +
                                  '<button type="button" data-act-ch-del="' + idx + '-' + chIdx + '" class="btn btn-danger !p-1" title="Delete Channel">' + ui.icon('trash', 'w-3 h-3') + '</button>' +
                                '</div>' +
                              '</div>' +
                              '<div class="grid grid-cols-2 sm:grid-cols-5 gap-1.5">' +
                                '<input list="inp-patch-presets" data-act-ch-patch="' + idx + '-' + chIdx + '" class="field !py-0.5 !px-1.5 text-xs" value="' + ui.esc(ch.patch || '') + '" placeholder="Patch (e.g. A1)" />' +
                                '<input list="inp-inst-presets" data-act-ch-inst="' + idx + '-' + chIdx + '" class="field !py-0.5 !px-1.5 text-xs" value="' + ui.esc(ch.instrument || '') + '" placeholder="Instrument (e.g. Kick)" />' +
                                '<input list="inp-mic-presets" data-act-ch-mic="' + idx + '-' + chIdx + '" class="field !py-0.5 !px-1.5 text-xs" value="' + ui.esc(ch.mic || '') + '" placeholder="Mic/DI (e.g. SM58)" />' +
                                '<select data-act-ch-stand="' + idx + '-' + chIdx + '" class="field !py-0.5 !px-1 text-xs">' +
                                  '<option value="">Stand\u2026</option>' +
                                  INPUT_STAND_PRESETS.map((s) => '<option ' + (s === ch.stand ? 'selected' : '') + '>' + s + '</option>').join('') +
                                '</select>' +
                                '<select data-act-ch-pos="' + idx + '-' + chIdx + '" class="field !py-0.5 !px-1 text-xs">' +
                                  '<option value="">Pos\u2026</option>' +
                                  INPUT_POSITIONS.map((p) => '<option ' + (p === ch.pos ? 'selected' : '') + '>' + p + '</option>').join('') +
                                '</select>' +
                              '</div>' +
                            '</div>'
                          )).join('') +
                        '</div>'
                      )
                    ) : (
                      // Tab Body: Outputs
                      !outCount ? (
                        '<div class="text-[11px] text-muted italic text-center py-2.5">No output mixes configured for this act yet. Click "+ Add Output" or choose an output preset above.</div>'
                      ) : (
                        '<div class="grid gap-1.5 max-h-60 overflow-y-auto pr-1">' +
                          outList.map((out, outIdx) => (
                            '<div class="p-1.5 rounded bg-panel border border-line flex flex-col gap-1 text-xs">' +
                              '<div class="flex items-center justify-between gap-2">' +
                                '<div class="flex items-center gap-1.5 font-mono font-semibold text-info text-[11px]">' +
                                  '<span>Out ' + (out.num || (outIdx + 1)) + '</span>' +
                                  (out.stereo ? '<span class="px-1 py-0.2 rounded bg-info/20 text-[9px]">Stereo</span>' : '') +
                                '</div>' +
                                '<div class="flex items-center gap-1">' +
                                  '<label class="flex items-center gap-1 text-[11px] text-muted mr-1.5 cursor-pointer">' +
                                    '<input type="checkbox" data-act-out-stereo="' + idx + '-' + outIdx + '" class="w-3.5 h-3.5 accent-[var(--info)]" ' + (out.stereo ? 'checked' : '') + ' />' +
                                    '<span>Stereo</span>' +
                                  '</label>' +
                                  '<button type="button" data-act-out-up="' + idx + '-' + outIdx + '" class="btn btn-ghost !p-1" title="Move Up" ' + (outIdx === 0 ? 'disabled' : '') + '>' + ui.icon('arrowU', 'w-3 h-3') + '</button>' +
                                  '<button type="button" data-act-out-down="' + idx + '-' + outIdx + '" class="btn btn-ghost !p-1" title="Move Down" ' + (outIdx === outCount - 1 ? 'disabled' : '') + '>' + ui.icon('arrowD', 'w-3 h-3') + '</button>' +
                                  '<button type="button" data-act-out-del="' + idx + '-' + outIdx + '" class="btn btn-danger !p-1" title="Delete Output">' + ui.icon('trash', 'w-3 h-3') + '</button>' +
                                '</div>' +
                              '</div>' +
                              '<div class="grid grid-cols-1 sm:grid-cols-3 gap-1.5">' +
                                '<input data-act-out-name="' + idx + '-' + outIdx + '" class="field !py-0.5 !px-1.5 text-xs" value="' + ui.esc(out.name || '') + '" placeholder="Label (e.g. Lead Wedge)" />' +
                                '<select data-act-out-type="' + idx + '-' + outIdx + '" class="field !py-0.5 !px-1 text-xs">' +
                                  OUTPUT_TYPE_PRESETS.map((t) => '<option ' + (t === out.type ? 'selected' : '') + '>' + t + '</option>').join('') +
                                '</select>' +
                                '<input data-act-out-dest="' + idx + '-' + outIdx + '" class="field !py-0.5 !px-1.5 text-xs" value="' + ui.esc(out.dest || '') + '" placeholder="Stage Destination / Mix" />' +
                              '</div>' +
                            '</div>'
                          )).join('') +
                        '</div>'
                      )
                    )) +
                  '</div>'
                ) : '') +
              '</div>'
            ) : '') +
          '</div>'
        );
      }).join('');

      // Wire schedule base events
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

      // Wire per-act mode switcher
      container.querySelectorAll('[data-act-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const mode = btn.getAttribute('data-act-mode');
          const idx = +btn.getAttribute('data-act-idx');
          if (scheduleItems[idx]) {
            scheduleItems[idx].techReqType = mode;
            renderScheduleBuilder();
          }
        });
      });

      // Wire per-act subtab switcher (Inputs vs Outputs)
      container.querySelectorAll('[data-act-subtab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const subtab = btn.getAttribute('data-act-subtab');
          const idx = +btn.getAttribute('data-act-idx');
          if (scheduleItems[idx]) {
            scheduleItems[idx]._actTab = subtab;
            renderScheduleBuilder();
          }
        });
      });

      // Wire per-act rich text notes
      container.querySelectorAll('[data-act-notes]').forEach((ta) => {
        ta.addEventListener('input', () => {
          const idx = +ta.getAttribute('data-act-notes');
          if (scheduleItems[idx]) scheduleItems[idx].techNotes = ta.value;
        });
      });

      // Wire per-act file upload
      container.querySelectorAll('[data-act-file-inp]').forEach((inp) => {
        inp.addEventListener('change', (e) => {
          const idx = +inp.getAttribute('data-act-file-inp');
          const file = e.target.files && e.target.files[0];
          if (!file || !scheduleItems[idx]) return;
          if (file.type && file.type.indexOf('pdf') === -1) { ui.toast('PDF files only', 'danger'); return; }
          files.readAsDataUrl(file).then((p) => {
            scheduleItems[idx].pendingFile = p;
            scheduleItems[idx].clearedFile = false;
            renderScheduleBuilder();
            ui.toast('Attached rider for ' + (scheduleItems[idx].customName || scheduleItems[idx].label), 'ok');
          }).catch((err) => {
            ui.toast(err && err.message === 'too-large' ? 'File too large (max ' + files.humanSize(files.MAX) + ')' : 'Could not read file', 'danger');
          });
        });
      });

      // Wire per-act file view
      container.querySelectorAll('[data-act-file-view]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = +btn.getAttribute('data-act-file-view');
          const it = scheduleItems[idx];
          if (!it) return;
          if (it.pendingFile) files.openDataUrl(it.pendingFile.dataUrl);
          else if (it.techFile) files.open(it.techFile);
        });
      });

      // Wire per-act file remove
      container.querySelectorAll('[data-act-file-remove]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = +btn.getAttribute('data-act-file-remove');
          const it = scheduleItems[idx];
          if (!it) return;
          if (it.pendingFile) {
            it.pendingFile = null;
          } else {
            it.clearedFile = true;
            it.originalTechFile = it.techFile;
            it.techFile = null;
          }
          renderScheduleBuilder();
        });
      });

      // Wire per-act add input channel
      container.querySelectorAll('[data-act-add-input]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = +btn.getAttribute('data-act-add-input');
          const it = scheduleItems[idx];
          if (!it) return;
          if (!Array.isArray(it.channelInputs)) it.channelInputs = [];
          it.channelInputs.push({
            channel: it.channelInputs.length + 1,
            instrument: '',
            mic: '',
            stand: 'Tall Boom',
            pos: 'Centre Stage',
            phantom: false
          });
          renderScheduleBuilder();
        });
      });

      // Wire per-act clear inputs
      container.querySelectorAll('[data-act-clear-input]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = +btn.getAttribute('data-act-clear-input');
          const it = scheduleItems[idx];
          if (!it) return;
          if (confirm('Clear all inputs for this act?')) {
            it.channelInputs = [];
            renderScheduleBuilder();
          }
        });
      });

      // Wire per-act add output
      container.querySelectorAll('[data-act-add-output]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = +btn.getAttribute('data-act-add-output');
          const it = scheduleItems[idx];
          if (!it) return;
          if (!Array.isArray(it.channelOutputs)) it.channelOutputs = [];
          it.channelOutputs.push({
            num: it.channelOutputs.length + 1,
            name: '',
            type: 'Wedge',
            dest: 'Stage Left',
            stereo: false
          });
          renderScheduleBuilder();
        });
      });

      // Wire per-act clear outputs
      container.querySelectorAll('[data-act-clear-output]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = +btn.getAttribute('data-act-clear-output');
          const it = scheduleItems[idx];
          if (!it) return;
          if (confirm('Clear all outputs for this act?')) {
            it.channelOutputs = [];
            renderScheduleBuilder();
          }
        });
      });

      // Wire per-act input preset dropdown loader
      container.querySelectorAll('[data-act-inp-preset-sel]').forEach((sel) => {
        sel.addEventListener('change', () => {
          const pid = sel.value;
          const idx = +sel.getAttribute('data-act-inp-preset-sel');
          const it = scheduleItems[idx];
          if (!pid || !it) return;
          const p = RMTP.presets.getInputs().find((x) => x.id === pid);
          if (p && Array.isArray(p.channels)) {
            if (!Array.isArray(it.channelInputs)) it.channelInputs = [];
            p.channels.forEach((itemCh) => {
              it.channelInputs.push(Object.assign({ channel: it.channelInputs.length + 1 }, itemCh));
            });
            renderScheduleBuilder();
            ui.toast('Loaded input preset: ' + p.name, 'ok');
          }
        });
      });

      // Wire per-act save input preset
      container.querySelectorAll('[data-act-save-inp-preset]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = +btn.getAttribute('data-act-save-inp-preset');
          const it = scheduleItems[idx];
          if (!it || !Array.isArray(it.channelInputs) || !it.channelInputs.length) {
            ui.toast('No input channels to save as a preset', 'warning');
            return;
          }
          RMTP.presets.openSaveAsModal('input', it.channelInputs, (newP) => {
            renderScheduleBuilder();
          });
        });
      });

      // Wire per-act output preset dropdown loader
      container.querySelectorAll('[data-act-out-preset-sel]').forEach((sel) => {
        sel.addEventListener('change', () => {
          const pid = sel.value;
          const idx = +sel.getAttribute('data-act-out-preset-sel');
          const it = scheduleItems[idx];
          if (!pid || !it) return;
          const p = RMTP.presets.getOutputs().find((x) => x.id === pid);
          if (p && Array.isArray(p.channels)) {
            if (!Array.isArray(it.channelOutputs)) it.channelOutputs = [];
            p.channels.forEach((itemCh) => {
              it.channelOutputs.push(Object.assign({ num: it.channelOutputs.length + 1 }, itemCh));
            });
            renderScheduleBuilder();
            ui.toast('Loaded output preset: ' + p.name, 'ok');
          }
        });
      });

      // Wire per-act save output preset
      container.querySelectorAll('[data-act-save-out-preset]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = +btn.getAttribute('data-act-save-out-preset');
          const it = scheduleItems[idx];
          if (!it || !Array.isArray(it.channelOutputs) || !it.channelOutputs.length) {
            ui.toast('No output channels to save as a preset', 'warning');
            return;
          }
          RMTP.presets.openSaveAsModal('output', it.channelOutputs, (newP) => {
            renderScheduleBuilder();
          });
        });
      });

      // Act channel auto patch
      container.querySelectorAll('[data-act-autopatch]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const sIdx = +btn.getAttribute('data-act-autopatch');
          const it = scheduleItems[sIdx];
          if (it && it.channelInputs) {
            let pIdx = 0;
            it.channelInputs.forEach(ch => {
              if (!ch.patch && pIdx < patchOptions.length) {
                ch.patch = patchOptions[pIdx++];
              }
            });
            renderScheduleBuilder();
            ui.toast('Auto-allocated to house patch', 'ok');
          }
        });
      });

      // Input row fields wiring
      container.querySelectorAll('[data-act-ch-patch]').forEach((inp) => {
        inp.addEventListener('input', () => {
          const [sIdx, cIdx] = inp.getAttribute('data-act-ch-patch').split('-').map(Number);
          if (scheduleItems[sIdx] && scheduleItems[sIdx].channelInputs[cIdx]) {
            scheduleItems[sIdx].channelInputs[cIdx].patch = inp.value;
          }
        });
      });
      container.querySelectorAll('[data-act-ch-inst]').forEach((inp) => {
        inp.addEventListener('input', () => {
          const [sIdx, cIdx] = inp.getAttribute('data-act-ch-inst').split('-').map(Number);
          if (scheduleItems[sIdx] && scheduleItems[sIdx].channelInputs[cIdx]) {
            scheduleItems[sIdx].channelInputs[cIdx].instrument = inp.value;
          }
        });
      });
      container.querySelectorAll('[data-act-ch-mic]').forEach((inp) => {
        inp.addEventListener('input', () => {
          const [sIdx, cIdx] = inp.getAttribute('data-act-ch-mic').split('-').map(Number);
          if (scheduleItems[sIdx] && scheduleItems[sIdx].channelInputs[cIdx]) {
            scheduleItems[sIdx].channelInputs[cIdx].mic = inp.value;
          }
        });
      });
      container.querySelectorAll('[data-act-ch-stand]').forEach((sel) => {
        sel.addEventListener('change', () => {
          const [sIdx, cIdx] = sel.getAttribute('data-act-ch-stand').split('-').map(Number);
          if (scheduleItems[sIdx] && scheduleItems[sIdx].channelInputs[cIdx]) {
            scheduleItems[sIdx].channelInputs[cIdx].stand = sel.value;
          }
        });
      });
      container.querySelectorAll('[data-act-ch-pos]').forEach((sel) => {
        sel.addEventListener('change', () => {
          const [sIdx, cIdx] = sel.getAttribute('data-act-ch-pos').split('-').map(Number);
          if (scheduleItems[sIdx] && scheduleItems[sIdx].channelInputs[cIdx]) {
            scheduleItems[sIdx].channelInputs[cIdx].pos = sel.value;
          }
        });
      });
      container.querySelectorAll('[data-act-ch-48v]').forEach((chk) => {
        chk.addEventListener('change', () => {
          const [sIdx, cIdx] = chk.getAttribute('data-act-ch-48v').split('-').map(Number);
          if (scheduleItems[sIdx] && scheduleItems[sIdx].channelInputs[cIdx]) {
            scheduleItems[sIdx].channelInputs[cIdx].phantom = chk.checked;
          }
        });
      });
      container.querySelectorAll('[data-act-ch-up]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const [sIdx, cIdx] = btn.getAttribute('data-act-ch-up').split('-').map(Number);
          const it = scheduleItems[sIdx];
          if (it && it.channelInputs && cIdx > 0) {
            const temp = it.channelInputs[cIdx];
            it.channelInputs[cIdx] = it.channelInputs[cIdx - 1];
            it.channelInputs[cIdx - 1] = temp;
            it.channelInputs.forEach((c, i) => { c.channel = i + 1; });
            renderScheduleBuilder();
          }
        });
      });
      container.querySelectorAll('[data-act-ch-down]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const [sIdx, cIdx] = btn.getAttribute('data-act-ch-down').split('-').map(Number);
          const it = scheduleItems[sIdx];
          if (it && it.channelInputs && cIdx < it.channelInputs.length - 1) {
            const temp = it.channelInputs[cIdx];
            it.channelInputs[cIdx] = it.channelInputs[cIdx + 1];
            it.channelInputs[cIdx + 1] = temp;
            it.channelInputs.forEach((c, i) => { c.channel = i + 1; });
            renderScheduleBuilder();
          }
        });
      });
      container.querySelectorAll('[data-act-ch-del]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const [sIdx, cIdx] = btn.getAttribute('data-act-ch-del').split('-').map(Number);
          const it = scheduleItems[sIdx];
          if (it && it.channelInputs) {
            it.channelInputs.splice(cIdx, 1);
            it.channelInputs.forEach((c, i) => { c.channel = i + 1; });
            renderScheduleBuilder();
          }
        });
      });

      // Output row fields wiring
      container.querySelectorAll('[data-act-out-name]').forEach((inp) => {
        inp.addEventListener('input', () => {
          const [sIdx, oIdx] = inp.getAttribute('data-act-out-name').split('-').map(Number);
          if (scheduleItems[sIdx] && scheduleItems[sIdx].channelOutputs[oIdx]) {
            scheduleItems[sIdx].channelOutputs[oIdx].name = inp.value;
          }
        });
      });
      container.querySelectorAll('[data-act-out-type]').forEach((sel) => {
        sel.addEventListener('change', () => {
          const [sIdx, oIdx] = sel.getAttribute('data-act-out-type').split('-').map(Number);
          if (scheduleItems[sIdx] && scheduleItems[sIdx].channelOutputs[oIdx]) {
            scheduleItems[sIdx].channelOutputs[oIdx].type = sel.value;
          }
        });
      });
      container.querySelectorAll('[data-act-out-dest]').forEach((inp) => {
        inp.addEventListener('input', () => {
          const [sIdx, oIdx] = inp.getAttribute('data-act-out-dest').split('-').map(Number);
          if (scheduleItems[sIdx] && scheduleItems[sIdx].channelOutputs[oIdx]) {
            scheduleItems[sIdx].channelOutputs[oIdx].dest = inp.value;
          }
        });
      });
      container.querySelectorAll('[data-act-out-stereo]').forEach((chk) => {
        chk.addEventListener('change', () => {
          const [sIdx, oIdx] = chk.getAttribute('data-act-out-stereo').split('-').map(Number);
          if (scheduleItems[sIdx] && scheduleItems[sIdx].channelOutputs[oIdx]) {
            scheduleItems[sIdx].channelOutputs[oIdx].stereo = chk.checked;
            renderScheduleBuilder();
          }
        });
      });
      container.querySelectorAll('[data-act-out-up]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const [sIdx, oIdx] = btn.getAttribute('data-act-out-up').split('-').map(Number);
          const it = scheduleItems[sIdx];
          if (it && it.channelOutputs && oIdx > 0) {
            const temp = it.channelOutputs[oIdx];
            it.channelOutputs[oIdx] = it.channelOutputs[oIdx - 1];
            it.channelOutputs[oIdx - 1] = temp;
            it.channelOutputs.forEach((o, i) => { o.num = i + 1; });
            renderScheduleBuilder();
          }
        });
      });
      container.querySelectorAll('[data-act-out-down]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const [sIdx, oIdx] = btn.getAttribute('data-act-out-down').split('-').map(Number);
          const it = scheduleItems[sIdx];
          if (it && it.channelOutputs && oIdx < it.channelOutputs.length - 1) {
            const temp = it.channelOutputs[oIdx];
            it.channelOutputs[oIdx] = it.channelOutputs[oIdx + 1];
            it.channelOutputs[oIdx + 1] = temp;
            it.channelOutputs.forEach((o, i) => { o.num = i + 1; });
            renderScheduleBuilder();
          }
        });
      });
      container.querySelectorAll('[data-act-out-del]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const [sIdx, oIdx] = btn.getAttribute('data-act-out-del').split('-').map(Number);
          const it = scheduleItems[sIdx];
          if (it && it.channelOutputs) {
            it.channelOutputs.splice(oIdx, 1);
            it.channelOutputs.forEach((o, i) => { o.num = i + 1; });
            renderScheduleBuilder();
          }
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
        '<button type="button" data-t-add class="btn btn-ghost">' + ui.icon('plus', 'w-4 h-4') + 'Add technician</button>';
    }
    function wireTechs() {
      ['#e-tech-area', '#e-cinema-tech-area'].forEach((sel) => {
        const area = m.root.querySelector(sel);
        if (!area) return;
        area.innerHTML = techAreaHtml();
        area.querySelectorAll('[data-t-user]').forEach((s) => s.addEventListener('change', () => {
          techs[+s.getAttribute('data-t-user')].userId = s.value; wireTechs();
        }));
        area.querySelectorAll('[data-t-role]').forEach((s) => s.addEventListener('change', () => {
          techs[+s.getAttribute('data-t-role')].role = s.value;
        }));
        area.querySelectorAll('[data-t-remove]').forEach((btn) => btn.addEventListener('click', () => {
          techs.splice(+btn.getAttribute('data-t-remove'), 1); wireTechs();
        }));
        const addBtn = area.querySelector('[data-t-add]');
        if (addBtn) addBtn.addEventListener('click', () => { techs.push({ userId: '', role: '' }); wireTechs(); });
      });
      updateSectionBannerPills();
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
      return '<label class="btn btn-ghost cursor-pointer inline-flex"><input type="file" accept="application/pdf" class="spec-file-input sr-only" />' +
        ui.icon('upload', 'w-4 h-4') + 'Upload PDF</label>' +
        '<p class="text-[11px] text-muted mt-2">PDF up to ' + files.humanSize(files.MAX) + '. Stored locally in this prototype.</p>';
    }
    function wireSpec() {
      ['#e-spec-area', '#e-cinema-spec-area'].forEach((sel) => {
        const area = m.root.querySelector(sel);
        if (!area) return;
        area.innerHTML = specAreaHtml();
        const input = area.querySelector('.spec-file-input');
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
      });
      updateSectionBannerPills();
    }
    wireSpec();

    // Floor tags & production specials wiring
    const AVAILABLE_FLOOR_TAGS = [
      'Moving Heads',
      'Strobes / Blinders',
      'LED Battens / Bars',
      'Touring Dimmer Rack',
      'DMX Run to Stage',
      '16A Single Phase',
      '32A Single Phase',
      '32A 3-Phase',
      '63A 3-Phase',
      'Floor Risers',
      'Custom Truss'
    ];

    function updateProductionSpecialsIndicator() {
      const ind = m.root.querySelector('#production-specials-indicator');
      if (!ind) return;
      const hazer = m.root.querySelector('#e-spec-hazer') ? m.root.querySelector('#e-spec-hazer').checked : false;
      const lasers = m.root.querySelector('#e-spec-lasers') ? m.root.querySelector('#e-spec-lasers').checked : false;
      const power = m.root.querySelector('#e-spec-power') ? m.root.querySelector('#e-spec-power').checked : false;
      const video = m.root.querySelector('#e-spec-video') ? m.root.querySelector('#e-spec-video').checked : false;
      const pyro = m.root.querySelector('#e-spec-pyro') ? m.root.querySelector('#e-spec-pyro').checked : false;

      const pills = [];
      if (hazer) pills.push('<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/40">Hazer</span>');
      if (lasers) pills.push('<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-500/20 text-rose-400 border border-rose-500/40">Lasers</span>');
      if (power || floorTags.some((t) => t.indexOf('3-Phase') > -1 || t.indexOf('32A') > -1 || t.indexOf('63A') > -1)) pills.push('<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-500/20 text-orange-400 border border-orange-500/40">Power</span>');
      if (video) pills.push('<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-500/20 text-sky-400 border border-sky-500/40">Video</span>');
      if (pyro) pills.push('<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-500/20 text-purple-400 border border-purple-500/40">Pyro</span>');
      if (floorTags.length) pills.push('<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">' + floorTags.length + ' Tags</span>');

      ind.innerHTML = pills.join(' ');
      updateSectionBannerPills();
    }

    function wireFloorTags() {
      const container = m.root.querySelector('#floor-tags-container');
      if (!container) return;
      container.innerHTML = AVAILABLE_FLOOR_TAGS.map((tag) => {
        const active = floorTags.indexOf(tag) > -1;
        return (
          '<button type="button" data-floor-tag="' + ui.esc(tag) + '" class="px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ' +
            (active ? 'bg-indigo-500/25 text-indigo-300 border-indigo-500/60 font-semibold shadow-2xs' : 'bg-panel border-line text-muted hover:text-ink hover:border-line/80') + '">' +
            (active ? '✓ ' : '+ ') + ui.esc(tag) +
          '</button>'
        );
      }).join('');

      container.querySelectorAll('[data-floor-tag]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const t = btn.getAttribute('data-floor-tag');
          const idx = floorTags.indexOf(t);
          if (idx > -1) {
            floorTags.splice(idx, 1);
          } else {
            floorTags.push(t);
            if (t.indexOf('3-Phase') > -1 || t.indexOf('32A') > -1 || t.indexOf('63A') > -1) {
              const pCb = m.root.querySelector('#e-spec-power');
              if (pCb) pCb.checked = true;
            }
          }
          wireFloorTags();
          updateProductionSpecialsIndicator();
        });
      });
    }

    wireFloorTags();
    updateProductionSpecialsIndicator();

    ['#e-spec-hazer', '#e-spec-lasers', '#e-spec-power', '#e-spec-video', '#e-spec-pyro'].forEach((sel) => {
      const cb = m.root.querySelector(sel);
      if (cb) cb.addEventListener('change', updateProductionSpecialsIndicator);
    });

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

      // Persist any pending per-act rider files
      const processedScheduleItems = scheduleItems.map((it) => {
        const itemCopy = Object.assign({}, it);
        if (itemCopy.pendingFile) {
          try {
            itemCopy.techFile = files.persist(itemCopy.pendingFile);
          } catch (e) {
            ui.toast('Couldn\u2019t store rider file for ' + (itemCopy.customName || itemCopy.label), 'danger');
          }
          delete itemCopy.pendingFile;
        } else if (itemCopy.clearedFile && itemCopy.originalTechFile) {
          files.remove(itemCopy.originalTechFile);
          itemCopy.techFile = null;
          delete itemCopy.clearedFile;
          delete itemCopy.originalTechFile;
        }
        return itemCopy;
      });

      const chosenSpace = m.root.querySelector('#e-space').value;
      const isScreen = isScreenSpace(chosenSpace);
      const responsibleLead = m.root.querySelector('#e-responsible-lead') ? m.root.querySelector('#e-responsible-lead').value.trim() : (ev.responsible_for_advancing || ev.responsible_for_advancing_user_id || '');
      const dcpTesterId = isScreen && m.root.querySelector('#e-dcp-tester') ? m.root.querySelector('#e-dcp-tester').value : (ev.dcp_tester_user_id || ev.dcpTesterUserId || '');
      const dcpTestDatetime = isScreen && m.root.querySelector('#e-dcp-test-datetime') ? m.root.querySelector('#e-dcp-test-datetime').value : (ev.dcp_test_datetime || ev.dcpTestDatetime || '');

      const lightingNotes = m.root.querySelector('#e-lighting-notes') ? m.root.querySelector('#e-lighting-notes').value.trim() : (prodInitial.lighting_notes || '');
      const floorPackage = m.root.querySelector('#e-floor-package') ? m.root.querySelector('#e-floor-package').value.trim() : (prodInitial.floor_package || '');
      const specialNotes = m.root.querySelector('#e-special-notes') ? m.root.querySelector('#e-special-notes').value.trim() : (prodInitial.special_notes || '');
      const specialsObj = {
        hazer: m.root.querySelector('#e-spec-hazer') ? m.root.querySelector('#e-spec-hazer').checked : (prodInitial.specials.hazer || false),
        lasers: m.root.querySelector('#e-spec-lasers') ? m.root.querySelector('#e-spec-lasers').checked : (prodInitial.specials.lasers || false),
        heavy_power: m.root.querySelector('#e-spec-power') ? m.root.querySelector('#e-spec-power').checked : (prodInitial.specials.heavy_power || false),
        video: m.root.querySelector('#e-spec-video') ? m.root.querySelector('#e-spec-video').checked : (prodInitial.specials.video || false),
        pyro: m.root.querySelector('#e-spec-pyro') ? m.root.querySelector('#e-spec-pyro').checked : (prodInitial.specials.pyro || false),
      };

      const record = Object.assign({}, ev, {
        id: ev.id || store.uid('evt'),
        name: name,
        category: m.root.querySelector('#e-category').value,
        space: chosenSpace,
        date: m.root.querySelector('#e-date').value,
        status: m.root.querySelector('#e-status').value,
        responsible_for_advancing: responsibleLead,
        responsible_for_advancing_user_id: responsibleLead,
        startTime: m.root.querySelector('#e-start').value,
        finishTime: m.root.querySelector('#e-finish').value,

        // Live space timings
        load_in: !isScreen && m.root.querySelector('#e-load-in') ? m.root.querySelector('#e-load-in').value : (ev.load_in || ev.loadIn || ''),
        soundcheck: !isScreen && m.root.querySelector('#e-sc') ? m.root.querySelector('#e-sc').value : (ev.soundcheck || ''),
        doors: !isScreen && m.root.querySelector('#e-doors') ? m.root.querySelector('#e-doors').value : (ev.doors || ''),
        off_stage: !isScreen && m.root.querySelector('#e-off-stage') ? m.root.querySelector('#e-off-stage').value : (ev.off_stage || ev.offStage || ''),
        curfew: !isScreen && m.root.querySelector('#e-curfew') ? m.root.querySelector('#e-curfew').value : (ev.curfew || ''),
        load_out: !isScreen && m.root.querySelector('#e-load-out') ? m.root.querySelector('#e-load-out').value : (ev.load_out || ev.loadOut || ''),
        schedule_items: !isScreen ? processedScheduleItems : (ev.schedule_items || ev.scheduleItems || []),

        // Cinema space timings & checks
        screening_starts_time: isScreen && m.root.querySelector('#e-screening-starts') ? m.root.querySelector('#e-screening-starts').value : (ev.screening_starts_time || ev.screeningStartsTime || ''),
        film_duration: isScreen && m.root.querySelector('#e-film-duration') ? m.root.querySelector('#e-film-duration').value.trim() : (ev.film_duration || ev.filmDuration || ''),
        media_type: isScreen && m.root.querySelector('#e-media-type') ? m.root.querySelector('#e-media-type').value : (ev.media_type || ev.mediaType || ''),
        dcp_received: isScreen && m.root.querySelector('#e-dcp') ? m.root.querySelector('#e-dcp').checked : (ev.dcp_received !== undefined ? !!ev.dcp_received : !!ev.dcpReceived),
        checks_completed: isScreen && m.root.querySelector('#e-checks') ? m.root.querySelector('#e-checks').checked : (ev.checks_completed !== undefined ? !!ev.checks_completed : !!ev.checksCompleted),
        intermission: isScreen && m.root.querySelector('#e-intermission') ? m.root.querySelector('#e-intermission').checked : !!ev.intermission,
        qa: isScreen && m.root.querySelector('#e-qa') ? m.root.querySelector('#e-qa').checked : !!ev.qa,
        dcp_tester_user_id: dcpTesterId,
        dcp_test_datetime: dcpTestDatetime,

        // Lighting & Production Package
        production_package: {
          lighting_notes: lightingNotes,
          floor_package: floorPackage,
          floor_tags: floorTags,
          specials: specialsObj,
          special_notes: specialNotes,
        },

        tech_requirements: {
          channel_list: {
            inputs: channelInputs,
            outputs: channelOutputs
          }
        },
        linked_maintenance_ids: linkedMaintIds,

        technicians: finalTechs,
        clientContact: (isScreen && m.root.querySelector('#e-cinema-contact')
          ? m.root.querySelector('#e-cinema-contact').value
          : (m.root.querySelector('#e-contact') ? m.root.querySelector('#e-contact').value : (ev.clientContact || ''))
        ).trim(),
        guestEngineer: isScreen && m.root.querySelector('#e-cinema-guest')
          ? m.root.querySelector('#e-cinema-guest').checked
          : (m.root.querySelector('#e-guest') ? m.root.querySelector('#e-guest').checked : (ev.guestEngineer || false)),
        techInfo: (isScreen && m.root.querySelector('#e-cinema-info')
          ? m.root.querySelector('#e-cinema-info').value
          : (m.root.querySelector('#e-info') ? m.root.querySelector('#e-info').value : (ev.techInfo || ''))
        ).trim(),
        email_recipients: (isScreen && m.root.querySelector('#e-cinema-email-recipients')
          ? m.root.querySelector('#e-cinema-email-recipients').value
          : (m.root.querySelector('#e-email-recipients') ? m.root.querySelector('#e-email-recipients').value : (ev.email_recipients || ev.emailRecipients || ''))
        ).trim(),
        techSpec: finalSpec,
        checklist: ev.checklist || { techSpecSent: false, inputListReceived: false, stagePlot: false, schedule: false, backline: false, hospitality: false, parkingAccess: false },
      });

      // Automated DCP Test Shift generation
      const genDcpCheck = m.root.querySelector('#e-gen-dcp-shift');
      const shouldGenDcp = isScreen && genDcpCheck && genDcpCheck.checked && (dcpTestDatetime || record.date);

      let linkedDcpId = ev.dcp_test_event_id || null;
      if (shouldGenDcp) {
        const dcpDate = dcpTestDatetime ? dcpTestDatetime.slice(0, 10) : record.date;
        const dcpTime = (dcpTestDatetime && dcpTestDatetime.length >= 16) ? dcpTestDatetime.slice(11, 16) : '10:00';
        let finishTime = '11:00';
        if (dcpTime && dcpTime.indexOf(':') > -1) {
          const [hh, mm] = dcpTime.split(':').map(Number);
          const endH = ((hh || 0) + 1) % 24;
          finishTime = (endH < 10 ? '0' : '') + endH + ':' + ((mm || 0) < 10 ? '0' : '') + (mm || 0);
        }

        const dcpShift = {
          id: linkedDcpId || store.uid('evt'),
          name: 'DCP Test: ' + name,
          category: 'Cinema',
          space: chosenSpace,
          date: dcpDate,
          startTime: dcpTime,
          finishTime: finishTime,
          status: 'Confirmed',
          technicians: dcpTesterId ? [{ userId: dcpTesterId, role: 'Cinema' }] : [],
          dcp_parent_event_id: record.id,
          techInfo: 'Automated DCP Test Shift for screening: ' + name + (dcpTestDatetime ? ' scheduled at ' + dcpTestDatetime : ''),
          checklist: { techSpecSent: false, inputListReceived: false, stagePlot: false, schedule: false, backline: false, hospitality: false, parkingAccess: false },
          dcp_received: true,
          checks_completed: false
        };
        store.upsert('advancing', dcpShift);
        linkedDcpId = dcpShift.id;
      }
      record.dcp_test_event_id = linkedDcpId;

      store.upsert('advancing', record);

      // Bi-directional Sync: Keep linked Patch Sheet updated with Advancing schedule artists
      if (RMTP.presets && typeof RMTP.presets.getAllPatchSheets === 'function' && typeof RMTP.presets.savePatchSheet === 'function') {
        try {
          const allSheets = RMTP.presets.getAllPatchSheets();
          const linkedSheet = allSheets.find((s) => s.eventId === record.id || s.id === record.patch_sheet_id);
          if (linkedSheet && Array.isArray(processedScheduleItems)) {
            const actItems = processedScheduleItems.filter((it) => it && (it.type === 'act' || (it.customName && it.customName.trim())));
            if (actItems.length > 0) {
              if (!Array.isArray(linkedSheet.acts)) linkedSheet.acts = [];
              const houseAct = linkedSheet.acts.find((a) => a.id === 'act-house') || { id: 'act-house', name: 'House / Venue Core', color: 'slate' };
              const updatedActs = [houseAct];
              const actColors = ['blue', 'purple', 'emerald', 'amber', 'rose', 'cyan', 'indigo', 'orange'];

              actItems.forEach((it, idx) => {
                const actName = (it.customName && it.customName.trim()) ? it.customName.trim() : (it.label || ('Act ' + (idx + 1)));
                const existingAct = linkedSheet.acts.find((a) => a.name && a.name.toLowerCase().trim() === actName.toLowerCase().trim()) || linkedSheet.acts[idx + 1];
                const col = existingAct ? existingAct.color : (actColors[idx % actColors.length]);
                updatedActs.push({
                  id: (existingAct && existingAct.id) || ('act-' + (idx + 1) + '-' + Date.now().toString(36)),
                  name: actName,
                  color: col,
                  stageTime: it.time || '',
                  duration: it.duration || ''
                });
              });

              linkedSheet.acts = updatedActs;
              linkedSheet.eventName = record.name || linkedSheet.eventName;
              linkedSheet.space = record.space || linkedSheet.space;
              linkedSheet.date = record.date || linkedSheet.date;
              RMTP.presets.savePatchSheet(linkedSheet);
            }
          }
        } catch (e) {
          console.warn('Error syncing schedule acts to patch sheet:', e);
        }
      }

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
