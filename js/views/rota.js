/* ============================================================
   views/rota.js — Master Rota, Shift Bookings & Freelancer Availability
   ------------------------------------------------------------
   Provides venue-wide scheduling and booking for Rich Mix:
   - Master Rota Board (week swimlanes across spaces & days)
   - Live availability checks across day-parts & custom hours
   - Shift booking lifecycle: Pencil, Confirmed, Declined, Cancelled
   - Technician self-service availability submission & roster
   - Team availability matrix for technical management
   ============================================================ */
window.RMTP = window.RMTP || {};
RMTP.views = RMTP.views || {};

RMTP.views.rota = (function () {
  return function () {
    const el = document.getElementById('content');
    if (!el) return;

    const store = RMTP.store;
    const auth = RMTP.auth;
    const ui = RMTP.ui;
    const me = auth.current();
    const isAdmin = !!(me && (me.admin || (auth.isAdmin && auth.isAdmin(me))));
    const isTechManager = auth.isTechManager ? auth.isTechManager(me) : isAdmin;
    const isSeniorTech = !!(me && String(me.position || '').trim().toLowerCase().includes('senior tech'));
    const isTMOrAdmin = (isTechManager || isAdmin);
    const isManagerOrSenior = !!(isTechManager || isSeniorTech || isAdmin);
    const isFreelance = auth.isFreelancer ? auth.isFreelancer(me) : false;

    // View state
    RMTP._rotaState = RMTP._rotaState || {
      tab: isFreelance ? 'my_avail' : 'board', // Freelancers land directly on My Availability calendar
      _hasUserSwitchedTab: false,
      weekOffset: 0, // 0 = current week, +1 next week, etc.
      boardView: 'month', // 'month' | 'week' | 'timeline' | 'day' | 'agenda'
      rotaMonth: new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'),
      collapsedSpaces: new Set(),
      density: 'compact', // 'compact' | 'detailed'
      selectedDay: '',
      mobileDayFilter: 'all',
      unfilledOnly: false,
      eventsFilter: isTMOrAdmin ? 'all' : 'all', // 'all' (all events inc gaps) | 'staffed' (staffed only)
      spaceFilter: '',
      showNonCoreSpaces: false,
      roleFilter: '',
      statusFilter: '',
      techFilter: '',
      searchQuery: '',
      swapFilter: 'all',
      availMonth: new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'),
      selectedUserForAvail: me ? me.id : 'user-3',
    };
    const state = RMTP._rotaState;
    if (isFreelance && !state._hasUserSwitchedTab && state.tab === 'board') {
      state.tab = 'my_avail';
    }
    if (state.density === undefined) state.density = 'compact';
    if (!state.boardView) state.boardView = 'month';
    if (state.showNonCoreSpaces === undefined) state.showNonCoreSpaces = false;
    if (!state.rotaMonth) state.rotaMonth = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
    if (!state.collapsedSpaces) state.collapsedSpaces = new Set();
    if (!state.selectedDay) state.selectedDay = formatDate(new Date());
    if (!state.dayPlannerAvailFilter) state.dayPlannerAvailFilter = 'all';
    if (state.dayPlannerTechSearch === undefined) state.dayPlannerTechSearch = '';
    if (!Array.isArray(state.dayPlannerTagFilters)) state.dayPlannerTagFilters = [];
    if (state.availMultiSelectMode === undefined) state.availMultiSelectMode = false;
    if (!Array.isArray(state.selectedAvailDates)) state.selectedAvailDates = [];
    if (state.lastSelectedAvailDate === undefined) state.lastSelectedAvailDate = '';
    if (!state.availBatchDayPart) state.availBatchDayPart = 'all_day';
    if (!state.availBatchStart) state.availBatchStart = '09:00';
    if (!state.availBatchEnd) state.availBatchEnd = '18:00';
    if (state.availBatchNotes === undefined) state.availBatchNotes = '';
    if (state.mobileDayFilter === undefined) state.mobileDayFilter = 'all';
    // Ensure Technical Managers and Admins default to 'all' events (including gaps)
    if (state.eventsFilter === undefined || (isTMOrAdmin && state.eventsFilter !== 'staffed')) {
      state.eventsFilter = 'all';
    }
    if (me && !state.selectedUserForAvail) state.selectedUserForAvail = me.id;

    // Helpers
    function formatDate(d) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    function normalizeDate(raw) {
      if (!raw) return '';
      if (RMTP.normalizeDateStr) return RMTP.normalizeDateStr(raw);
      return String(raw).trim().slice(0, 10);
    }

    function normalizeTime(raw, fallback) {
      const s = String(raw || '').trim();
      const m = s.match(/^(\d{1,2}):(\d{2})/);
      if (m) return m[1].padStart(2, '0') + ':' + m[2];
      return fallback || '17:00';
    }

    function normalizeSpace(raw) {
      const first = Array.isArray(raw) ? (raw[0] || '') : String(raw || '').split(',')[0].trim();
      if (!first) return '';
      return RMTP.normalizeSpaceName ? RMTP.normalizeSpaceName(first) : first;
    }

    function isSpaceAllowed(space) {
      if (state.showNonCoreSpaces) return true;
      if (!space) return true;
      return !(RMTP.isAuxiliarySpace && RMTP.isAuxiliarySpace(space));
    }

    function getVisibleSpacesList() {
      if (state.showNonCoreSpaces) return RMTP.SPACES.slice();
      return (RMTP.CORE_SPACE_OPTIONS || ['The Stage', 'The Studio', 'The Mix', 'Screen One', 'Screen Two', 'Screen Three']).slice();
    }

    function parseDate(str) {
      if (!str) return new Date();
      const norm = normalizeDate(str);
      const parts = norm.split('-');
      if (parts.length === 3) {
        return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0);
      }
      return new Date();
    }

    function formatDisplayDate(dateStr) {
      if (!dateStr) return '';
      const d = parseDate(dateStr);
      return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    }

    function getWeekDays(offset = 0) {
      const now = new Date();
      // Monday of the target week
      const currentDay = now.getDay();
      const distanceToMon = (currentDay + 6) % 7; // Monday = 0
      const monday = new Date(now);
      monday.setDate(now.getDate() - distanceToMon + (offset * 7));
      monday.setHours(0, 0, 0, 0);

      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        days.push({
          date: formatDate(d),
          dObj: d,
          dayName: d.toLocaleDateString('en-GB', { weekday: 'short' }),
          dayNum: d.getDate(),
          monthName: d.toLocaleDateString('en-GB', { month: 'short' }),
          isToday: formatDate(d) === formatDate(now),
        });
      }
      return days;
    }

    // Availability & Bookings Query Helpers
    function getAllAvailability() {
      return store.all('availability') || [];
    }

    function getAllBookingsRaw() {
      return store.all('bookings') || [];
    }

    function getAllBookings(includeNonCore = false) {
      const list = getAllBookingsRaw();
      if (includeNonCore || state.showNonCoreSpaces) return list;
      return list.filter((b) => isSpaceAllowed(b.space));
    }

    function isUpcomingShiftDate(dateStr) {
      const d = normalizeDate(dateStr);
      if (!d) return false;
      return d >= formatDate(new Date());
    }

    function isBookingEventCancelled(b) {
      if (!b || !b.eventId) return false;
      const ev = store.find('advancing', b.eventId);
      if (!ev) return false;
      if (ev.deleted) return true;
      const st = String(ev.status || '').trim().toLowerCase();
      return st === 'cancelled' || st === 'canceled';
    }

    function isActiveOpenSwap(b) {
      if (!b || !b.swapRequested || b.isNoTech) return false;
      if (b.status === 'cancelled' || b.status === 'declined') return false;
      if (!isUpcomingShiftDate(b.date)) return false;
      if (isBookingEventCancelled(b)) return false;
      return true;
    }

    function getAllUsers() {
      return store.all('users') || [];
    }
    const allUsers = getAllUsers();

    function getTechTags(userOrId) {
      return (auth.getUserTechTags && userOrId) ? auth.getUserTechTags(userOrId) : [];
    }

    function isBookingNoTechRecord(b) {
      if (!b) return false;
      return !!(b.isNoTech || b.role === 'None' || /^no tech/i.test(String(b.userName || '').trim()));
    }

    function isAllDayAvailability(avail) {
      if (!avail || avail.type === 'unavailable') return false;
      if (avail.dayPart === 'all_day') return true;
      const s = String(avail.startTime || '').trim();
      const f = String(avail.finishTime || '').trim();
      if (avail.dayPart === 'custom') {
        return (!s && !f) || (s === '08:00' && f === '23:30');
      }
      if (!avail.dayPart) {
        return (!s && !f) || (s === '08:00' && f === '23:30');
      }
      return false;
    }

    function formatAvailabilityWindowLabel(avail) {
      if (!avail) return '';
      if (avail.type === 'unavailable') return 'Unavailable';
      if (isAllDayAvailability(avail)) return 'All Day';
      if (avail.dayPart === 'morning') return 'Morning (08:00–13:00)';
      if (avail.dayPart === 'afternoon') return 'Afternoon (13:00–18:00)';
      if (avail.dayPart === 'evening') return 'Evening (18:00–23:30)';
      const s = String(avail.startTime || '').trim();
      const f = String(avail.finishTime || '').trim();
      if (s && f) return `${s}–${f}`;
      return s || f || 'All Day';
    }

    function parseShiftRoles(roleStr) {
      if (RMTP.parseShiftRoles) return RMTP.parseShiftRoles(roleStr);
      return String(roleStr || '').split(/\s*(?:&|\+|\/|,)\s*/).map((s) => s.trim()).filter((s) => s && !/^none$/i.test(s));
    }

    function mergeShiftRoles() {
      if (RMTP.mergeShiftRoles) return RMTP.mergeShiftRoles.apply(null, arguments);
      const set = new Set();
      for (let i = 0; i < arguments.length; i++) {
        parseShiftRoles(arguments[i]).forEach((r) => set.add(r));
      }
      return Array.from(set).join(' & ') || 'Tech';
    }

    function roleCoversDiscipline(techRoleStr, requiredDiscipline) {
      if (RMTP.roleCoversDiscipline) return RMTP.roleCoversDiscipline(techRoleStr, requiredDiscipline);
      const cr = String(requiredDiscipline || '').trim().toLowerCase();
      return parseShiftRoles(techRoleStr).some((r) => r.toLowerCase() === cr);
    }

    function isSameTechKey(aUserId, aUserName, bUserId, bUserName) {
      if (aUserId && bUserId) return aUserId === bUserId;
      if (!aUserId && !bUserId) {
        const na = String(aUserName || '').trim().toLowerCase();
        const nb = String(bUserName || '').trim().toLowerCase();
        return !!(na && nb && na === nb && !/^unassigned(\s+tech)?$/i.test(na));
      }
      return false;
    }

    function isSameEventAndSpace(a, b) {
      if (!a || !b) return false;
      if (normalizeDate(a.date) !== normalizeDate(b.date)) return false;
      const sa = normalizeSpace(a.space).toLowerCase();
      const sb = normalizeSpace(b.space).toLowerCase();
      if (sa !== sb) return false;
      if (a.eventId && b.eventId) return a.eventId === b.eventId;
      const na = String(a.eventName || '').trim().toLowerCase();
      const nb = String(b.eventName || '').trim().toLowerCase();
      return !!(na && nb && na === nb);
    }

    function isDistinctHandoverLeg(a, b) {
      if (!a || !b) return false;
      if (a.splitFromId && b.splitFromId && a.splitFromId === b.splitFromId && a.legIndex && b.legIndex && String(a.legIndex) !== String(b.legIndex)) {
        return true;
      }
      if (a.legIndex && b.legIndex && String(a.legIndex) !== String(b.legIndex)) return true;
      return false;
    }

    function isPlaceholderBooking(b, usersList) {
      if (!b) return true;
      if (isBookingNoTechRecord(b)) return false;
      const uid = String(b.userId || '').trim();
      const name = String(b.userName || '').trim();
      const pool = usersList || getAllUsers();
      if (uid && pool.some((u) => u && u.id === uid)) return false;
      if (!name || /^unassigned(\s+tech)?$/i.test(name)) return true;
      return false;
    }

    function getAllEvents(includeNonCore = false) {
      return (store.all('advancing') || []).filter((e) => {
        if (!e || e.deleted) return false;
        const st = String(e.status || '').trim().toLowerCase();
        if (st === 'cancelled' || st === 'canceled') return false;
        if (!includeNonCore && !state.showNonCoreSpaces && !isSpaceAllowed(e.space)) return false;
        return true;
      });
    }

    function getUserAvailability(userId, dateStr) {
      const all = getAllAvailability();
      const target = normalizeDate(dateStr);
      return all.find((a) => a.userId === userId && normalizeDate(a.date) === target);
    }

    function getUserBookingsOnDate(userId, dateStr) {
      const all = getAllBookingsRaw();
      const target = normalizeDate(dateStr);
      return all.filter((b) => b.userId === userId && normalizeDate(b.date) === target && b.status !== 'cancelled' && b.status !== 'declined');
    }

    function getTechLiveStatus(userId, dateStr, currentShiftTimes) {
      if (!userId) return { text: 'Unassigned', statusClass: 'text-muted' };
      const avail = getUserAvailability(userId, dateStr);
      const bookings = getUserBookingsOnDate(userId, dateStr);

      if (bookings.length > 0) {
        const spaces = bookings.map((b) => b.space || 'Shift').join(', ');
        return {
          available: false,
          booked: true,
          label: `Booked on ${spaces}`,
          statusClass: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
          badge: 'Booked',
        };
      }

      if (avail) {
        if (avail.type === 'unavailable') {
          return {
            available: false,
            booked: false,
            label: `Unavailable${avail.notes ? ' (' + avail.notes + ')' : ''}`,
            statusClass: 'text-rose-400 bg-rose-400/10 border-rose-400/20',
            badge: 'Unavailable',
          };
        }
        const partLabel = formatAvailabilityWindowLabel(avail);

        return {
          available: true,
          booked: false,
          label: `Available (${partLabel})`,
          statusClass: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
          badge: 'Available',
          details: partLabel,
        };
      }

      return {
        available: null,
        booked: false,
        label: 'No availability logged',
        statusClass: 'text-muted bg-panel border-line',
        badge: 'No Data',
      };
    }

    // Space Color Styling & Identifiers
    function getSpaceColor(spaceName) {
      const s = String(spaceName || '').toLowerCase();
      if (s.includes('stage')) {
        return {
          bar: 'border-l-amber-500',
          tag: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
          dot: 'bg-amber-400',
          short: 'Stage',
        };
      }
      if (s.includes('studio')) {
        return {
          bar: 'border-l-sky-500',
          tag: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
          dot: 'bg-sky-400',
          short: 'Studio',
        };
      }
      if (s.includes('mix')) {
        return {
          bar: 'border-l-purple-500',
          tag: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
          dot: 'bg-purple-400',
          short: 'The Mix',
        };
      }
      if (s.includes('screen one') || s.includes('screen 1')) {
        return {
          bar: 'border-l-emerald-500',
          tag: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
          dot: 'bg-emerald-400',
          short: 'Screen 1',
        };
      }
      if (s.includes('screen two') || s.includes('screen 2')) {
        return {
          bar: 'border-l-teal-500',
          tag: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
          dot: 'bg-teal-400',
          short: 'Screen 2',
        };
      }
      if (s.includes('screen three') || s.includes('screen 3')) {
        return {
          bar: 'border-l-cyan-500',
          tag: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
          dot: 'bg-cyan-400',
          short: 'Screen 3',
        };
      }
      if (s.includes('street')) {
        return {
          bar: 'border-l-rose-500',
          tag: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
          dot: 'bg-rose-400',
          short: 'Streetside',
        };
      }
      return {
        bar: 'border-l-zinc-500',
        tag: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
        dot: 'bg-zinc-400',
        short: spaceName || 'Venue',
      };
    }

    // Status UI Badge
    function renderStatusPill(status, note) {
      const s = String(status || 'pencil').toLowerCase();
      let iconName = 'pen';
      let cls = 'text-amber-400 bg-amber-500/10 border-amber-500/30 border-dashed';
      let label = 'Pencil';

      if (s === 'confirmed') {
        iconName = 'check';
        cls = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
        label = 'Confirmed';
      } else if (s === 'declined') {
        iconName = 'alert';
        cls = 'text-rose-400 bg-rose-500/10 border-rose-500/20';
        label = 'Declined';
      } else if (s === 'cancelled') {
        iconName = 'x';
        cls = 'text-muted bg-panel border-line line-through opacity-75';
        label = 'Cancelled';
      }

      return (
        '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold tracking-wide border ' + cls + '" ' +
          (note ? 'title="' + ui.esc(note) + '"' : '') + '>' +
          ui.icon(iconName, 'w-3 h-3') +
          '<span>' + label + '</span>' +
        '</span>'
      );
    }

    function getStatusMeta(status, isUnfilled) {
      if (isUnfilled) {
        return {
          label: 'Unfilled Gap',
          dot: 'bg-rose-400 animate-pulse',
          textCls: 'text-rose-400 font-semibold',
          borderCls: 'border-rose-500/40 bg-rose-500/5',
          icon: 'alert',
        };
      }
      const s = String(status || 'pencil').toLowerCase();
      if (s === 'confirmed') {
        return {
          label: 'Confirmed',
          dot: 'bg-emerald-400',
          textCls: 'text-emerald-400 font-medium',
          borderCls: 'border-line hover:border-emerald-500/50',
          icon: 'check',
        };
      }
      if (s === 'pencil') {
        return {
          label: 'Pencil Hold',
          dot: 'bg-amber-400',
          textCls: 'text-amber-400 font-medium',
          borderCls: 'border-amber-500/30 hover:border-amber-500/60',
          icon: 'pen',
        };
      }
      if (s === 'declined') {
        return {
          label: 'Declined',
          dot: 'bg-rose-400',
          textCls: 'text-rose-400 font-medium',
          borderCls: 'border-rose-500/30',
          icon: 'alert',
        };
      }
      if (s === 'cancelled') {
        return {
          label: 'Cancelled',
          dot: 'bg-muted',
          textCls: 'text-muted line-through',
          borderCls: 'border-line opacity-60',
          icon: 'x',
        };
      }
      return {
        label: s,
        dot: 'bg-muted',
        textCls: 'text-muted',
        borderCls: 'border-line',
        icon: 'clock',
      };
    }

    // --- Dynamic Navigation & Date Synchronization Helpers ---
    function getWeekOffsetForDate(dateStr) {
      if (!dateStr) return 0;
      const target = parseDate(dateStr);
      const now = new Date();
      const currentDay = now.getDay();
      const distanceToMon = (currentDay + 6) % 7;
      const currentMon = new Date(now);
      currentMon.setDate(now.getDate() - distanceToMon);
      currentMon.setHours(0, 0, 0, 0);

      const targetDay = target.getDay();
      const targetDistToMon = (targetDay + 6) % 7;
      const targetMon = new Date(target);
      targetMon.setDate(target.getDate() - targetDistToMon);
      targetMon.setHours(0, 0, 0, 0);

      const diffMs = targetMon.getTime() - currentMon.getTime();
      return Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
    }

    function getCurrentWeekDays() {
      return getWeekDays(state.weekOffset);
    }

    // Helper: reads Basic Crew requirement for a space (from venue specs or Rich Mix defaults)
    function getSpaceBasicCrew(spaceName) {
      if (!spaceName) return 1;
      if (RMTP.getSpaceCrewSpecs) {
        return RMTP.getSpaceCrewSpecs(spaceName).total;
      }
      const v = store.find('venues', spaceName);
      if (v && v.basicCrew !== undefined && v.basicCrew !== null && !isNaN(Number(v.basicCrew))) {
        return Math.max(0, parseInt(v.basicCrew, 10));
      }
      const s = String(spaceName).toLowerCase();
      if (s.includes('stage') || s.includes('studio')) return 2;
      return 1;
    }

    // Map storing active schedule items for fast click routing
    const allScheduleItemsMap = new Map();

    function resolveTakeoverEventId(item, targetSpace) {
      if (!item) return '';
      const normTarget = normalizeSpace(targetSpace).toLowerCase();
      if (Array.isArray(item.clusterEvents) && normTarget) {
        const matched = item.clusterEvents.find((e) => {
          const spList = Array.isArray(e.space) ? e.space : [e.space];
          return spList.some((s) => normalizeSpace(s).toLowerCase() === normTarget);
        });
        if (matched) return matched.id;
      }
      return item.eventId || '';
    }

    // Unified helper: builds all shifts & advancing events for any date dynamically,
    // consolidating multi-room takeovers into a single card with crew needed vs assigned.
    function getDaySchedule(dateStr) {
      const normDay = normalizeDate(dateStr);
      const allB = getAllBookings().filter((b) => normalizeDate(b.date) === normDay);
      const allEv = getAllEvents().filter((e) => normalizeDate(e.date) === normDay);
      const allUsers = getAllUsers();

      const items = [];
      const handledEventIds = new Set();
      const takeoverEventIds = new Set();
      const handledBookingIds = new Set();
      const bookedTechKeysByEvent = new Map(); // eventId -> Set of userId or lowercase userName
      const seenNoTechKeys = new Set();

      function noTechDedupKey(eventId, eventName, spaceName) {
        const sp = normalizeSpace(spaceName || 'Venue').toLowerCase();
        if (eventId) return 'ev:' + String(eventId) + '|' + sp;
        return 'nm:' + String(eventName || '').trim().toLowerCase() + '|' + sp;
      }

      // --- STEP 1: DETECT AND CLUSTER MULTI-ROOM TAKEOVERS ---
      const takeoverClusters = [];
      const usedEventIdsForTakeover = new Set();

      const byGroupId = {};
      allEv.forEach((ev) => {
        if (ev.groupId && !String(ev.groupId).startsWith('implicit-')) {
          if (!byGroupId[ev.groupId]) byGroupId[ev.groupId] = [];
          byGroupId[ev.groupId].push(ev);
        }
      });

      allEv.forEach((ev) => {
        if (usedEventIdsForTakeover.has(ev.id)) return;

        const isExplicitMulti = (Array.isArray(ev.space) && ev.space.length > 1) || (Array.isArray(ev.spaces) && ev.spaces.length > 1) || ev.isTakeover;
        const groupEvents = (ev.groupId && byGroupId[ev.groupId] && byGroupId[ev.groupId].length > 1) ? byGroupId[ev.groupId] : null;

        // Check matching name on same date across different spaces (e.g. Artifax multi-room arrangement)
        const nameMatches = allEv.filter((other) => other.id !== ev.id && other.name && ev.name && other.name.trim().toLowerCase() === ev.name.trim().toLowerCase() && normalizeDate(other.date) === normDay);

        if (isExplicitMulti || groupEvents || nameMatches.length > 0) {
          const clusterEvents = groupEvents ? groupEvents : (nameMatches.length > 0 ? [ev, ...nameMatches] : [ev]);
          clusterEvents.forEach((e) => usedEventIdsForTakeover.add(e.id));

          // Collect spaces (normalized & respecting Core Spaces filter)
          const spacesSet = new Set();
          clusterEvents.forEach((e) => {
            if (Array.isArray(e.spaces)) e.spaces.forEach((s) => { const ns = normalizeSpace(s); if (ns && isSpaceAllowed(ns)) spacesSet.add(ns); });
            if (Array.isArray(e.space)) e.space.forEach((s) => { const ns = normalizeSpace(s); if (ns && isSpaceAllowed(ns)) spacesSet.add(ns); });
            else if (e.space) { const ns = normalizeSpace(e.space); if (ns && isSpaceAllowed(ns)) spacesSet.add(ns); }
          });

          if (spacesSet.size === 0) return;

          takeoverClusters.push({
            primaryEvent: ev,
            events: clusterEvents,
            spaces: Array.from(spacesSet),
            name: ev.name,
            date: normDay,
            groupId: ev.groupId || ('takeover-' + ev.id),
          });
        }
      });

      // --- BUILD CONSOLIDATED TAKEOVER ITEMS ---
      takeoverClusters.forEach((cl) => {
        cl.events.forEach((e) => {
          handledEventIds.add(e.id);
          takeoverEventIds.add(e.id);
        });

        const spaces = cl.spaces.length > 0 ? cl.spaces : ['The Stage', 'The Studio'];

        // Find all bookings for this takeover
        const takeoverBookings = allB.filter((b) => {
          if (cl.events.some((e) => e.id === b.eventId)) return true;
          if (b.groupId && b.groupId === cl.groupId) return true;
          if (spaces.includes(normalizeSpace(b.space)) && b.eventName && cl.name && b.eventName.trim().toLowerCase() === cl.name.trim().toLowerCase()) return true;
          return false;
        });
        takeoverBookings.forEach((b) => handledBookingIds.add(b.id));

        // Find all event technicians for this takeover
        const allEvTechs = [];
        cl.events.forEach((e) => {
          const techs = RMTP.eventTechnicians ? RMTP.eventTechnicians(e) : [];
          techs.forEach((t) => allEvTechs.push({ ...t, eventSpace: Array.isArray(e.space) ? e.space[0] : e.space }));
        });

        // Compute space breakdown with real-crew counting, per-room No Tech Needed, and dual-role collapsing
        const spaceBreakdown = spaces.map((sp) => {
          const specs = RMTP.getSpaceCrewSpecs ? RMTP.getSpaceCrewSpecs(sp) : { total: getSpaceBasicCrew(sp), disciplines: [{ role: 'Sound', count: 1 }], summary: '1x Sound' };
          const basic = specs.total;
          const spBookings = takeoverBookings.filter((b) => normalizeSpace(b.space) === sp && b.status !== 'cancelled' && b.status !== 'declined');
          const spEvents = cl.events.filter((e) => {
            const spList = Array.isArray(e.spaces) && e.spaces.length ? e.spaces : (Array.isArray(e.space) ? e.space : [e.space]);
            return spList.some((s) => normalizeSpace(s) === sp);
          });
          const spTechs = allEvTechs.filter((t) => (normalizeSpace(t.space) === sp || normalizeSpace(t.eventSpace) === sp) && (t.bookingStatus || 'confirmed') !== 'cancelled' && (t.bookingStatus || 'confirmed') !== 'declined');

          const noTechBooking = spBookings.find((b) => isBookingNoTechRecord(b)) || null;
          const spAllEventsNoTech = spEvents.length > 0 && spEvents.every((e) => !!e.noTechNeeded);

          const assignedTechs = [];
          const placeholderBookings = [];
          const assignedByTechKey = new Map();

          spBookings.forEach((b) => {
            if (isBookingNoTechRecord(b)) return;
            if (isPlaceholderBooking(b, allUsers)) {
              placeholderBookings.push({
                bookingId: b.id,
                role: b.role || 'Tech',
                status: b.status || 'pencil',
              });
              return;
            }
            const u = allUsers.find((u) => u.id === b.userId);
            const resolvedName = b.userName || (u ? auth.displayName(u) : 'Technician');
            const isSplitLeg = !!(b.splitFromId || b.legIndex);
            const baseTechKey = b.userId ? ('u:' + b.userId) : ('n:' + resolvedName.trim().toLowerCase());
            const collapseKey = isSplitLeg ? (baseTechKey + '|leg:' + (b.legIndex || b.id)) : baseTechKey;

            const prev = assignedByTechKey.get(collapseKey);
            if (prev) {
              prev.role = mergeShiftRoles(prev.role, b.role);
              if (String(b.status || '').toLowerCase() === 'confirmed') prev.status = 'confirmed';
              if (!prev.bookingIds) prev.bookingIds = [prev.bookingId];
              prev.bookingIds.push(b.id);
              return;
            }

            const entry = {
              id: b.userId || b.id,
              userId: b.userId || '',
              name: resolvedName,
              role: b.role || 'Tech',
              status: b.status || 'pencil',
              bookingId: b.id,
              bookingIds: [b.id],
            };
            assignedByTechKey.set(collapseKey, entry);
            assignedTechs.push(entry);
          });

          spTechs.forEach((t) => {
            if (t.isNoTech || t.role === 'None') return;
            const u = allUsers.find((u) => u.id === t.userId);
            const hasReal = !!(u || (t.freelancerName && t.freelancerName.trim() && !/^unassigned(\s+tech)?$/i.test(t.freelancerName.trim())));
            if (!hasReal) return;
            const resolvedName = t.freelancerName || (u ? auth.displayName(u) : 'Technician');
            const techKey = t.userId ? ('u:' + t.userId) : ('n:' + resolvedName.trim().toLowerCase());
            const prev = assignedByTechKey.get(techKey);
            if (prev) {
              if (t.role) prev.role = mergeShiftRoles(prev.role, t.role);
              return;
            }
            const entry = {
              id: t.userId || techKey,
              userId: t.userId || '',
              name: resolvedName,
              role: t.role || 'Tech',
              status: t.bookingStatus || 'confirmed',
            };
            assignedByTechKey.set(techKey, entry);
            assignedTechs.push(entry);
          });

          // Per-room No Tech Needed (Self-Service)
          if ((noTechBooking || spAllEventsNoTech) && assignedTechs.length === 0) {
            return {
              space: sp,
              basicCrew: 0,
              specsSummary: 'Self-Service (No Tech)',
              specsDisciplines: [],
              disciplineStatus: [],
              missingDisciplines: [],
              assignedCount: 0,
              coveredSlots: 0,
              assignedTechs: [],
              placeholderBookings: [],
              gap: 0,
              isFilled: true,
              isNoTech: true,
              isDualRoleCover: false,
              noTechBookingId: noTechBooking ? noTechBooking.id : '',
            };
          }

          // Discipline fulfillment status for this space (supports dual-role techs e.g. "Sound & Lighting")
          const disciplineStatus = (specs.disciplines || []).map((cd) => {
            const reqCount = cd.count || 1;
            const assignedCount = assignedTechs.filter((t) => roleCoversDiscipline(t.role, cd.role)).length;
            return {
              role: cd.role,
              required: reqCount,
              assigned: assignedCount,
              isFilled: assignedCount >= reqCount,
              gap: Math.max(0, reqCount - assignedCount),
            };
          });

          const missingDisciplines = [];
          disciplineStatus.forEach((ds) => {
            for (let i = 0; i < ds.gap; i++) missingDisciplines.push(ds.role);
          });

          const assignedCount = assignedTechs.length;
          const coveredSlots = disciplineStatus.length > 0
            ? disciplineStatus.reduce((sum, ds) => sum + Math.min(ds.assigned, ds.required), 0)
            : assignedCount;
          const allDisciplinesCovered = disciplineStatus.length > 0 && missingDisciplines.length === 0;
          const isFilled = allDisciplinesCovered || (assignedCount >= basic && missingDisciplines.length === 0);
          const isDualRoleCover = isFilled && assignedCount > 0 && assignedCount < basic;
          const gap = isFilled ? 0 : Math.max(missingDisciplines.length, basic - Math.max(assignedCount, coveredSlots));

          return {
            space: sp,
            basicCrew: basic,
            specsSummary: specs.summary,
            specsDisciplines: specs.disciplines,
            disciplineStatus: disciplineStatus,
            missingDisciplines: missingDisciplines,
            assignedCount: assignedCount,
            coveredSlots: coveredSlots,
            assignedTechs: assignedTechs,
            placeholderBookings: placeholderBookings,
            gap: gap,
            isFilled: isFilled,
            isNoTech: false,
            isDualRoleCover: isDualRoleCover,
            noTechBookingId: '',
          };
        });

        const totalCrewNeeded = spaceBreakdown.reduce((sum, sb) => sum + (sb.isNoTech ? 0 : sb.basicCrew), 0);
        const totalCrewAssigned = spaceBreakdown.reduce((sum, sb) => sum + sb.assignedCount, 0);
        const allAssignedTechs = spaceBreakdown.flatMap((sb) => sb.assignedTechs || []);
        const allConfirmed = allAssignedTechs.length > 0 && allAssignedTechs.every((t) => String(t.status || '').toLowerCase() === 'confirmed');
        const unfilledSpaces = spaceBreakdown.filter((sb) => !sb.isFilled).map((sb) => sb.space);
        const isAllNoTech = spaceBreakdown.length > 0 && spaceBreakdown.every((sb) => sb.isNoTech);
        const hasDualRoleCover = spaceBreakdown.some((sb) => sb.isDualRoleCover);
        const needsCovering = !isAllNoTech && unfilledSpaces.length > 0;
        const isFullyStaffed = !needsCovering;

        // Apply filters
        if (state.spaceFilter && !spaces.includes(state.spaceFilter)) return;
        if (state.unfilledOnly && !needsCovering) return;
        if (state.eventsFilter === 'staffed' && needsCovering && totalCrewAssigned === 0) return;
        if (state.statusFilter) {
          const derivedStatus = isAllNoTech ? 'confirmed' : (needsCovering ? 'unfilled' : (allConfirmed ? 'confirmed' : 'pencil'));
          const matchesStatus = (state.statusFilter === derivedStatus) ||
                                (state.statusFilter === 'pencil' && needsCovering && totalCrewAssigned > 0);
          if (!matchesStatus) return;
        }
        if (state.techFilter) {
          const hasTech = spaceBreakdown.some((sb) => sb.assignedTechs.some((t) => t.id === state.techFilter));
          if (!hasTech) return;
        }
        if (state.searchQuery) {
          const q = state.searchQuery.toLowerCase();
          const match = (cl.name && cl.name.toLowerCase().includes(q)) ||
                        spaces.some((s) => s.toLowerCase().includes(q)) ||
                        spaceBreakdown.some((sb) => sb.assignedTechs.some((t) => (t.name || '').toLowerCase().includes(q) || (t.role || '').toLowerCase().includes(q)));
          if (!match) return;
        }

        const primary = cl.primaryEvent;
        const itemStatus = isAllNoTech ? 'confirmed' : (needsCovering ? 'unfilled' : (allConfirmed ? 'confirmed' : 'pencil'));
        const item = {
          key: 'takeover_' + (cl.groupId || primary.id),
          type: 'takeover',
          eventId: primary.id,
          clusterEvents: cl.events,
          groupId: cl.groupId,
          advEvent: primary,
          eventName: cl.name,
          space: spaces.join(', '),
          spaces: spaces,
          date: normDay,
          startTime: primary.startTime || '17:00',
          finishTime: primary.finishTime || '23:30',
          totalCrewNeeded: totalCrewNeeded,
          totalCrewAssigned: totalCrewAssigned,
          spaceBreakdown: spaceBreakdown,
          unfilledSpaces: unfilledSpaces,
          isFullyStaffed: isFullyStaffed,
          isUnfilled: needsCovering,
          needsCovering: needsCovering,
          isNoTech: isAllNoTech,
          hasDualRoleCover: hasDualRoleCover,
          status: itemStatus,
          notes: primary.notes || primary.techInfo || '',
        };
        items.push(item);
        allScheduleItemsMap.set(item.key, item);
      });

      // --- STEP 2: REMAINING REGULAR BOOKINGS (with No-Tech cleanup & Dual-Role collapse) ---
      const remainingBookings = allB.filter((b) => {
        if (handledBookingIds.has(b.id)) return false;
        if (b.eventId && takeoverEventIds.has(b.eventId)) return false;
        if (b.status === 'cancelled' || b.status === 'declined') return false;
        return true;
      });

      // Pre-scan which (event/space) combos are No-Tech or have covered roles so stale placeholders are suppressed
      const noTechEventSpaceKeys = new Set();
      const coveredRolesByEventSpace = new Map();
      remainingBookings.forEach((b) => {
        const bSpace = normalizeSpace(b.space) || 'Venue';
        const esKey = noTechDedupKey(b.eventId, b.eventName, bSpace);
        if (isBookingNoTechRecord(b)) {
          noTechEventSpaceKeys.add(esKey);
          return;
        }
        if (!isPlaceholderBooking(b, allUsers)) {
          if (!coveredRolesByEventSpace.has(esKey)) coveredRolesByEventSpace.set(esKey, []);
          coveredRolesByEventSpace.get(esKey).push(b.role || 'Tech');
        }
      });

      const regularCollapsedByKey = new Map();

      remainingBookings.forEach((b) => {
        const bSpace = normalizeSpace(b.space) || 'Venue';
        const isBookingNoTech = isBookingNoTechRecord(b);
        const isPlaceholderTech = isPlaceholderBooking(b, allUsers);
        const linkedAdv = b.eventId ? allEv.find((e) => e.id === b.eventId) : null;
        const esKey = noTechDedupKey(b.eventId, b.eventName, bSpace);

        // Suppress stale unassigned placeholder if this event/space is marked No Tech Needed
        // OR if assigned crew (e.g. a dual-role Sound & Lighting tech) already covers its discipline
        if (isPlaceholderTech) {
          if ((linkedAdv && linkedAdv.noTechNeeded) || noTechEventSpaceKeys.has(esKey)) return;
          const coveredRoles = coveredRolesByEventSpace.get(esKey) || [];
          if (coveredRoles.length > 0 && b.role && coveredRoles.some((r) => roleCoversDiscipline(r, b.role))) {
            return;
          }
        }

        const isBookingUnfilled = !isBookingNoTech && isPlaceholderTech;

        // Deduplicate duplicate No-Tech bookings for the same event & space
        if (isBookingNoTech) {
          const ntKey = noTechDedupKey(b.eventId, b.eventName, bSpace);
          const nmKey = noTechDedupKey('', b.eventName, bSpace);
          if (seenNoTechKeys.has(ntKey) || (b.eventName && seenNoTechKeys.has(nmKey))) return;
          seenNoTechKeys.add(ntKey);
          if (b.eventName) seenNoTechKeys.add(nmKey);
        }

        // Collapse multiple non-split bookings for the same technician on the same event/space/date
        // (e.g. Oscar Lockey Sound + Oscar Lockey Lighting -> Oscar Lockey, Sound & Lighting)
        const techObj = allUsers.find((u) => u.id === b.userId);
        const resolvedName = isBookingNoTech
          ? 'No Tech Required'
          : (isBookingUnfilled ? 'Unassigned' : (b.userName || (techObj ? auth.displayName(techObj) : 'Technician')));

        if (!isBookingNoTech && !isBookingUnfilled) {
          const isSplitLeg = !!(b.splitFromId || b.legIndex);
          const personKey = b.userId ? ('u:' + b.userId) : ('n:' + resolvedName.trim().toLowerCase());
          const collapseKey = isSplitLeg
            ? (esKey + '|' + personKey + '|leg:' + (b.legIndex || b.id))
            : (esKey + '|' + personKey);
          const existingItem = regularCollapsedByKey.get(collapseKey);
          if (existingItem) {
            existingItem.role = mergeShiftRoles(existingItem.role, b.role);
            if (b.status === 'confirmed') existingItem.status = 'confirmed';
            if (!existingItem.collapsedBookingIds) existingItem.collapsedBookingIds = [existingItem.id];
            existingItem.collapsedBookingIds.push(b.id);
            existingItem.isDualRole = parseShiftRoles(existingItem.role).length > 1;
            return;
          }
        }

        if (state.spaceFilter && bSpace !== state.spaceFilter) return;
        if (state.roleFilter && !roleCoversDiscipline(b.role, state.roleFilter) && b.role !== state.roleFilter) return;
        if (state.statusFilter) {
          if (state.statusFilter === 'unfilled' && !isBookingUnfilled) return;
          if (state.statusFilter !== 'unfilled' && (isBookingUnfilled || b.status !== state.statusFilter)) return;
        }
        if (state.techFilter && b.userId !== state.techFilter) return;
        if (state.unfilledOnly && !isBookingUnfilled) return;
        if (state.eventsFilter === 'staffed' && isBookingUnfilled) return;
        if (state.searchQuery) {
          const q = state.searchQuery.toLowerCase();
          const match = (b.eventName && b.eventName.toLowerCase().includes(q)) ||
                        (bSpace && bSpace.toLowerCase().includes(q)) ||
                        (b.userName && b.userName.toLowerCase().includes(q)) ||
                        (b.role && b.role.toLowerCase().includes(q));
          if (!match) return;
        }

        if (b.eventId) {
          handledEventIds.add(b.eventId);
          if (!bookedTechKeysByEvent.has(b.eventId)) bookedTechKeysByEvent.set(b.eventId, new Set());
          if (b.userId) bookedTechKeysByEvent.get(b.eventId).add('u:' + b.userId);
          else if (b.userName && !isPlaceholderTech) bookedTechKeysByEvent.get(b.eventId).add('n:' + String(b.userName).trim().toLowerCase());
        }

        const effectiveRole = isBookingNoTech ? 'None' : (b.role || 'Tech');
        const item = {
          key: 'b_' + b.id,
          type: 'booking',
          id: b.id,
          booking: b,
          collapsedBookingIds: [b.id],
          eventId: b.eventId,
          eventName: b.eventName || 'Venue Shift',
          space: bSpace,
          date: normDay,
          startTime: b.startTime || '17:00',
          finishTime: b.finishTime || '23:30',
          userId: isBookingNoTech || isBookingUnfilled ? '' : b.userId,
          userName: resolvedName,
          role: effectiveRole,
          isDualRole: !isBookingNoTech && parseShiftRoles(effectiveRole).length > 1,
          status: isBookingNoTech ? 'confirmed' : (isBookingUnfilled ? 'unfilled' : (b.status || 'pencil')),
          rate: b.rate,
          notes: b.notes,
          splitFromId: b.splitFromId || '',
          legIndex: b.legIndex || '',
          isUnfilled: isBookingUnfilled,
          needsCovering: isBookingUnfilled,
          isNoTech: isBookingNoTech,
        };
        if (!isBookingNoTech && !isBookingUnfilled) {
          const isSplitLeg = !!(b.splitFromId || b.legIndex);
          const personKey = b.userId ? ('u:' + b.userId) : ('n:' + resolvedName.trim().toLowerCase());
          const collapseKey = isSplitLeg
            ? (esKey + '|' + personKey + '|leg:' + (b.legIndex || b.id))
            : (esKey + '|' + personKey);
          regularCollapsedByKey.set(collapseKey, item);
        }
        items.push(item);
        allScheduleItemsMap.set(item.key, item);
      });

      // --- STEP 3: REMAINING ADVANCING EVENTS (SINGLE ROOM) ---
      allEv.forEach((ev) => {
        // Unconditionally skip events already consolidated into a Multi-Room Takeover in Step 1
        if (takeoverEventIds.has(ev.id)) return;

        const spaceVal = normalizeSpace(Array.isArray(ev.space) ? ev.space[0] : (ev.space || 'Venue')) || 'Venue';
        if (state.spaceFilter && spaceVal !== state.spaceFilter) return;

        if (state.searchQuery) {
          const q = state.searchQuery.toLowerCase();
          const match = (ev.name && ev.name.toLowerCase().includes(q)) ||
                        (spaceVal && spaceVal.toLowerCase().includes(q)) ||
                        ((ev.notes || ev.techInfo || '') && (ev.notes || ev.techInfo || '').toLowerCase().includes(q));
          if (!match) return;
        }

        const isEventNoTech = !!ev.noTechNeeded;
        const alreadyHasBookings = handledEventIds.has(ev.id);
        const bookedSet = bookedTechKeysByEvent.get(ev.id) || new Set();

        const evTechs = RMTP.eventTechnicians ? RMTP.eventTechnicians(ev) : [];
        if (evTechs && evTechs.length > 0) {
          const seenEvTechs = new Set();
          evTechs.forEach((t, idx) => {
            if ((t.bookingStatus || 'confirmed') === 'cancelled' || (t.bookingStatus || 'confirmed') === 'declined') return;
            // Skip any tech already rendered via a booking record in Step 2
            if (alreadyHasBookings) {
              if (t.userId && bookedSet.has('u:' + t.userId)) return;
              if (!t.userId && t.freelancerName && bookedSet.has('n:' + String(t.freelancerName).trim().toLowerCase())) return;
              if (t.isNoTech || t.role === 'None') return;
              if (!t.userId && !(t.freelancerName && t.freelancerName.trim())) return;
            }
            const techObj = allUsers.find((u) => u.id === t.userId);
            const isNoTech = isEventNoTech || !!t.isNoTech || t.role === 'None';
            if (isNoTech) {
              const ntKey = noTechDedupKey(ev.id, ev.name, spaceVal);
              const nmKey = noTechDedupKey('', ev.name, spaceVal);
              if (seenNoTechKeys.has(ntKey) || (ev.name && seenNoTechKeys.has(nmKey))) return;
              seenNoTechKeys.add(ntKey);
              if (ev.name) seenNoTechKeys.add(nmKey);
            }

            const hasAssigned = !!(techObj || (t.freelancerName && t.freelancerName.trim() && !/^unassigned(\s+tech)?$/i.test(t.freelancerName.trim())));
            const isSlotUnfilled = !isNoTech && !hasAssigned;

            const dedupKey = isNoTech
              ? 'notech'
              : ((t.userId ? ('u:' + t.userId) : ('n:' + String(t.freelancerName || 'unassigned').trim().toLowerCase())) + '|' + String(t.role || 'Tech').toLowerCase());
            if (seenEvTechs.has(dedupKey)) return;
            seenEvTechs.add(dedupKey);

            if (state.techFilter && t.userId !== state.techFilter) return;
            if (state.roleFilter && t.role !== state.roleFilter) return;
            if (state.statusFilter) {
              const effSt = isSlotUnfilled ? 'unfilled' : (t.bookingStatus || 'confirmed');
              if (effSt !== state.statusFilter) return;
            }
            if (state.unfilledOnly && !isSlotUnfilled) return;
            if (state.eventsFilter === 'staffed' && isSlotUnfilled) return;
            const tName = isNoTech ? 'No Tech Required' : (t.freelancerName || (techObj ? auth.displayName(techObj) : 'Unassigned'));

            const item = {
              key: 'evtech_' + ev.id + '_' + idx,
              type: 'adv_tech',
              eventId: ev.id,
              advEvent: ev,
              eventName: ev.name,
              space: spaceVal,
              date: normDay,
              startTime: t.startTime || ev.startTime || '18:00',
              finishTime: t.finishTime || ev.finishTime || '23:00',
              userId: isNoTech || isSlotUnfilled ? '' : t.userId,
              userName: tName,
              role: isNoTech ? 'None' : (t.role || 'Tech'),
              status: isSlotUnfilled ? 'unfilled' : (t.bookingStatus || 'confirmed'),
              splitFromId: t.splitFromId || '',
              legIndex: t.legIndex || '',
              notes: ev.notes || ev.techInfo || (ev.artifaxHistory && ev.artifaxHistory.length ? ev.artifaxHistory[ev.artifaxHistory.length - 1].notes : '') || ev.artifaxNotes || '',
              isUnfilled: isSlotUnfilled,
              needsCovering: isSlotUnfilled,
              isNoTech: isNoTech,
            };
            items.push(item);
            allScheduleItemsMap.set(item.key, item);
          });
          if (alreadyHasBookings) return;
        } else if (alreadyHasBookings) {
          return;
        } else if (isEventNoTech) {
          // Self-Service advancing event with zero crew needed
          if (state.unfilledOnly) return;
          const ntKey = noTechDedupKey(ev.id, ev.name, spaceVal);
          const nmKey = noTechDedupKey('', ev.name, spaceVal);
          if (seenNoTechKeys.has(ntKey) || (ev.name && seenNoTechKeys.has(nmKey))) return;
          seenNoTechKeys.add(ntKey);
          if (ev.name) seenNoTechKeys.add(nmKey);
          const item = {
            key: 'notech_' + ev.id,
            type: 'notech',
            eventId: ev.id,
            advEvent: ev,
            eventName: ev.name,
            space: spaceVal,
            date: normDay,
            startTime: ev.startTime || '18:00',
            finishTime: ev.finishTime || '23:00',
            userId: '',
            userName: 'No Tech Required',
            role: 'None',
            status: 'confirmed',
            notes: ev.notes || ev.techInfo || (ev.artifaxHistory && ev.artifaxHistory.length ? ev.artifaxHistory[ev.artifaxHistory.length - 1].notes : '') || ev.artifaxNotes || '',
            isUnfilled: false,
            needsCovering: false,
            isNoTech: true,
          };
          items.push(item);
          allScheduleItemsMap.set(item.key, item);
        } else {
          // Unfilled advancing event (Gap!)
          if (state.eventsFilter === 'staffed') return;
          if (state.roleFilter) return;
          if (state.techFilter) return;
          if (state.statusFilter && state.statusFilter !== 'unfilled') return;

          const specs = RMTP.getSpaceCrewSpecs ? RMTP.getSpaceCrewSpecs(spaceVal) : { total: getSpaceBasicCrew(spaceVal), disciplines: [{ role: 'Sound', count: 1 }], summary: '1x Sound' };
          const defaultRole = (specs.disciplines && specs.disciplines.length > 0) ? specs.disciplines[0].role : 'Tech';

          const item = {
            key: 'unfilled_' + ev.id,
            type: 'unfilled',
            eventId: ev.id,
            advEvent: ev,
            eventName: ev.name,
            space: spaceVal,
            date: normDay,
            startTime: ev.startTime || '18:00',
            finishTime: ev.finishTime || '23:00',
            userId: '',
            userName: 'Unassigned',
            role: defaultRole,
            status: 'unfilled',
            notes: ev.notes || ev.techInfo || (ev.artifaxHistory && ev.artifaxHistory.length ? ev.artifaxHistory[ev.artifaxHistory.length - 1].notes : '') || ev.artifaxNotes || '',
            isUnfilled: true,
            needsCovering: true,
            isNoTech: false,
          };
          items.push(item);
          allScheduleItemsMap.set(item.key, item);
        }
      });

      items.sort((a, b) => (a.startTime || '00:00').localeCompare(b.startTime || '00:00'));
      return items;
    }

    // Card Renderer: Glanceable, Compact, Clean & Free of UI Clutter
    // Supports Multi-Room Takeover consolidation, Basic Crew progress, and Dynamic Density scaling.
    function renderCardHtml(item, contextSpace) {
      const spaceCls = getSpaceColor(item.space);
      const statusMeta = getStatusMeta(item.status, item.isUnfilled);
      const isCompact = state.density === 'compact';
      const timeStr = `${item.startTime || '17:00'} – ${item.finishTime || '23:30'}`;

      // ----------------------------------------------------------------------
      // MULTI-ROOM TAKEOVER CONSOLIDATED CARD
      // ----------------------------------------------------------------------
      if (item.type === 'takeover') {
        const isFull = item.isFullyStaffed;
        const totalNeeded = item.totalCrewNeeded;
        const totalAssigned = item.totalCrewAssigned;
        const gapsCount = item.unfilledSpaces.length;

        // If rendering in context of a specific room (Day View swimlane):
        if (contextSpace && item.spaces.includes(contextSpace)) {
          const roomBreakdown = item.spaceBreakdown.find((s) => s.space === contextSpace) || {
            basicCrew: getSpaceBasicCrew(contextSpace),
            assignedCount: 0,
            assignedTechs: [],
            gap: getSpaceBasicCrew(contextSpace),
            isFilled: false,
          };

          return `
            <div data-schedule-item="${item.key}" class="p-3 rounded-xl border border-l-[4px] border-l-amber-500 ${roomBreakdown.isFilled ? 'border-line bg-panel2/80' : 'border-amber-500/40 bg-amber-500/5'} transition shadow-2xs hover:border-accent cursor-pointer group select-none flex flex-col gap-2 text-left relative">
              <div class="flex items-center justify-between gap-1 text-[10px]">
                <span class="font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider text-[9px] bg-amber-500/15 text-amber-300 border-amber-500/30 flex items-center gap-1 shrink-0">
                  ${ui.icon('grid', 'w-2.5 h-2.5 text-amber-300')}
                  <span>Takeover Room</span>
                </span>
                <span class="px-1.5 py-0.2 rounded text-[9.5px] font-bold border ${roomBreakdown.isNoTech ? 'bg-panel2 text-muted border-line' : (roomBreakdown.isFilled ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/30')} shrink-0">
                  ${roomBreakdown.isNoTech ? 'No Tech' : (roomBreakdown.isFilled ? 'Staffed' : 'Unfilled')}
                </span>
              </div>

              <div>
                <div class="text-xs font-bold text-ink leading-snug break-words group-hover:text-accent transition-colors" title="${ui.esc(item.eventName)}">
                  ${ui.esc(item.eventName)}
                </div>
                <div class="text-[10px] text-muted mt-0.5 truncate" title="${item.spaces.join(', ')}">
                  Across <span class="font-medium text-ink">${item.spaces.join(', ')}</span>
                </div>
              </div>

              <!-- Dedicated Non-Clipping Time Badge -->
              <div class="flex items-center">
                <div class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-panel border border-line/80 font-mono text-[10.5px] font-semibold text-ink tabular-nums shadow-2xs">
                  ${ui.icon('clock', 'w-3 h-3 text-amber-400 shrink-0')}
                  <span class="whitespace-nowrap">${timeStr}</span>
                </div>
              </div>

              <!-- Room Crew Requirement & Assigned Techs -->
              <div class="p-2 rounded-lg bg-panel/85 border border-line/60 space-y-1.5 mt-0.5">
                <div class="flex items-center justify-between text-[11px]">
                  <span class="text-muted text-[10px] font-semibold uppercase">Room Staffing</span>
                  <span class="font-mono font-bold text-[11px] ${roomBreakdown.isNoTech ? 'text-muted' : (roomBreakdown.isFilled ? 'text-emerald-400' : 'text-amber-400')}">
                    ${roomBreakdown.isNoTech ? 'No Tech Needed' : `${roomBreakdown.assignedCount}/${roomBreakdown.basicCrew} Assigned`}
                  </span>
                </div>

                <!-- Disciplines fulfillment pills -->
                ${roomBreakdown.disciplineStatus && roomBreakdown.disciplineStatus.length > 0 ? `
                  <div class="flex flex-wrap gap-1 pt-1 border-t border-line/40">
                    ${roomBreakdown.disciplineStatus.map((ds) => `
                      <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-semibold border ${ds.isFilled ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'}">
                        <span>${ui.esc(ds.role)}: ${ds.assigned}/${ds.required}</span>
                        ${ds.isFilled ? '✓' : ''}
                      </span>
                    `).join('')}
                  </div>
                ` : ''}

                ${roomBreakdown.assignedTechs.length > 0 ? `
                  <div class="space-y-1 pt-1 border-t border-line/40">
                    ${roomBreakdown.assignedTechs.map((t) => `
                      <div class="flex items-center justify-between text-[10px] py-0.5 px-1.5 rounded bg-panel2/60 border border-line/50">
                        <span class="font-medium text-ink truncate">${ui.esc(t.name)}</span>
                        <span class="text-[9px] font-mono text-muted uppercase shrink-0">${ui.esc(t.role)}</span>
                      </div>
                    `).join('')}
                  </div>
                ` : ''}

                ${!roomBreakdown.isFilled ? `
                  <button type="button" data-assign-space-crew="${item.key}|${ui.esc(contextSpace)}|${ui.esc(roomBreakdown.missingDisciplines ? roomBreakdown.missingDisciplines[0] || '' : '')}" class="w-full mt-1 py-1.5 px-2 rounded text-[10px] font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 flex items-center justify-center gap-1 transition shadow-2xs" title="Assign crew to ${ui.esc(contextSpace)}">
                    ${ui.icon('plus', 'w-3 h-3 text-amber-300')}
                    <span>+ Assign ${roomBreakdown.missingDisciplines && roomBreakdown.missingDisciplines[0] ? roomBreakdown.missingDisciplines[0] : 'Crew'} (${roomBreakdown.gap} needed)</span>
                  </button>
                ` : ''}
              </div>
            </div>
          `;
        }

        // Standard Consolidated Card (Week Board & Agenda)
        if (isCompact) {
          // GLANCEABLE COMPACT TAKEOVER CARD
          return `
            <div data-schedule-item="${item.key}" class="p-3 rounded-xl border border-l-[4px] border-l-amber-500 ${isFull ? 'border-line bg-panel2/80 hover:border-line/90' : 'border-amber-500/40 bg-amber-500/5 hover:border-amber-400'} transition shadow-2xs hover:shadow-md cursor-pointer group select-none flex flex-col gap-2 text-left relative">
              <!-- Tier 1: Takeover Header & Staffing badge -->
              <div class="flex items-center justify-between gap-1 text-[10px]">
                <span class="px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1 shrink-0">
                  ${ui.icon('grid', 'w-2.5 h-2.5 text-amber-300')}
                  <span>Takeover · ${item.spaces.length} Rooms</span>
                </span>
                <span class="text-[10px] font-bold ${isFull ? 'text-emerald-400' : 'text-amber-400'} shrink-0">
                  ${isFull ? '✓ Staffed' : `${gapsCount} gap${gapsCount > 1 ? 's' : ''}`}
                </span>
              </div>

              <!-- Tier 2: Event Name -->
              <div>
                <div class="text-xs font-bold text-ink leading-snug break-words group-hover:text-accent transition-colors" title="${ui.esc(item.eventName)}">
                  ${ui.esc(item.eventName)}
                </div>
              </div>

              <!-- Tier 3: Dedicated Time Badge (Zero Clipping) -->
              <div class="flex items-center">
                <div class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-panel border border-amber-500/30 font-mono text-[10.5px] font-semibold text-amber-300 tabular-nums shadow-2xs">
                  ${ui.icon('clock', 'w-3 h-3 text-amber-400 shrink-0')}
                  <span class="whitespace-nowrap">${timeStr}</span>
                </div>
              </div>

              <!-- Tier 4: Compact Space Badges & Quick Action -->
              <div class="pt-1.5 border-t border-line/50 space-y-1.5">
                <div class="flex items-center justify-between text-[10px]">
                  <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold border ${isFull ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'}">
                    <span class="w-1.5 h-1.5 rounded-full ${isFull ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}"></span>
                    <span>${totalAssigned}/${totalNeeded} Crew</span>
                  </span>
                </div>

                <!-- Clean Room Pills (Click any room to assign) -->
                <div class="flex flex-wrap gap-1">
                  ${item.spaceBreakdown.map((sb) => `
                    <button type="button" data-assign-space-crew="${item.key}|${ui.esc(sb.space)}|${ui.esc(sb.missingDisciplines ? sb.missingDisciplines[0] || '' : '')}" class="px-2 py-0.5 rounded text-[9.5px] font-semibold border transition flex items-center gap-1 ${sb.isNoTech ? 'bg-panel border-line text-muted' : (sb.isFilled ? 'bg-panel border-line text-ink' : 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20')}" title="${ui.esc(sb.space)}: ${sb.isNoTech ? 'No Tech Needed' : `${sb.assignedCount}/${sb.basicCrew} crew (${ui.esc(sb.specsSummary || '')})`} - click to edit">
                      <span class="w-1.5 h-1.5 rounded-full ${sb.isNoTech ? 'bg-muted/60' : (sb.isFilled ? 'bg-emerald-400' : 'bg-amber-400')} shrink-0"></span>
                      <span class="truncate max-w-[120px]">${ui.esc(sb.space)}</span>
                      <span class="font-mono text-[9px] opacity-80">${sb.isNoTech ? '(No Tech)' : `(${sb.assignedCount}/${sb.basicCrew})`}</span>
                    </button>
                  `).join('')}
                </div>

                <!-- 1-Click Action Button -->
                ${!isFull ? `
                  <button type="button" data-assign-space-crew="${item.key}|${ui.esc(item.unfilledSpaces[0] || item.spaces[0])}" class="w-full mt-1 py-1.5 px-2 rounded text-[10px] font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 flex items-center justify-center gap-1 transition shadow-2xs">
                    ${ui.icon('plus', 'w-3 h-3 text-amber-300')}
                    <span>+ Assign Crew (${totalNeeded - totalAssigned} needed)</span>
                  </button>
                ` : ''}
              </div>
            </div>
          `;
        }

        // DETAILED MODE (Fully Stacked Space Breakdown)
        return `
          <div data-schedule-item="${item.key}" class="p-3 rounded-xl border border-l-[4px] border-l-amber-500 ${isFull ? 'border-line bg-panel2/80 hover:border-line/90' : 'border-amber-500/40 bg-amber-500/5 hover:border-amber-400'} transition shadow-2xs hover:shadow-md cursor-pointer group select-none flex flex-col gap-2.5 text-left relative">
            <!-- Tier 1: Takeover Header & Status -->
            <div class="flex items-center justify-between gap-1 text-[10px]">
              <span class="px-2 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1 shrink-0">
                ${ui.icon('grid', 'w-2.5 h-2.5 text-amber-300')}
                <span>Takeover · ${item.spaces.length} Rooms</span>
              </span>
              <span class="text-[9.5px] font-bold ${isFull ? 'text-emerald-400' : 'text-amber-400'} shrink-0">
                ${isFull ? '✓ Complete' : `(${gapsCount} room gap${gapsCount > 1 ? 's' : ''})`}
              </span>
            </div>

            <!-- Tier 2: Event Name -->
            <div>
              <div class="text-xs font-bold text-ink leading-snug break-words group-hover:text-accent transition-colors" title="${ui.esc(item.eventName)}">
                ${ui.esc(item.eventName)}
              </div>
            </div>

            <!-- Tier 3: Dedicated Time Badge (Zero Clipping) -->
            <div class="flex items-center">
              <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-panel border border-amber-500/30 font-mono text-[11px] font-bold text-amber-300 tabular-nums shadow-2xs">
                ${ui.icon('clock', 'w-3.5 h-3.5 text-amber-400 shrink-0')}
                <span class="whitespace-nowrap">${timeStr}</span>
              </div>
            </div>

            <!-- Tier 4: Crew Overview Strip -->
            <div class="px-2.5 py-1.5 rounded-lg bg-panel/90 border border-line/70 flex items-center justify-between text-[10px]">
              <div class="flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 rounded-full ${isFull ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'} shrink-0"></span>
                <span class="text-muted font-semibold uppercase tracking-wider text-[9px]">Crewing</span>
              </div>
              <span class="font-mono font-bold text-[10px] tabular-nums ${isFull ? 'text-emerald-400' : 'text-amber-400'}">
                ${totalAssigned}/${totalNeeded} Assigned
              </span>
            </div>

            <!-- Space-by-Space detailed row breakdown -->
            <div class="space-y-1.5 pt-1 border-t border-line/40 text-[10px]">
              ${item.spaceBreakdown.map((sb) => `
                <div class="p-2 rounded-lg bg-panel border border-line/70 flex items-center justify-between gap-1.5">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                      <span class="w-1.5 h-1.5 rounded-full ${sb.isFilled ? 'bg-emerald-400' : 'bg-amber-400'} shrink-0"></span>
                      <span class="font-bold text-ink text-[11px] truncate block" title="${ui.esc(sb.space)}">${ui.esc(sb.space)}</span>
                    </div>
                    ${sb.isFilled ? `
                      <div class="text-[9.5px] text-muted truncate mt-0.5 pl-3" title="${ui.esc(sb.assignedTechs.map((t) => t.name).join(', '))}">
                        👤 ${ui.esc(sb.assignedTechs.map((t) => t.name).join(', '))}
                      </div>
                    ` : `
                      <div class="text-[9.5px] text-amber-400 font-mono font-medium mt-0.5 pl-3">
                        ${sb.assignedCount}/${sb.basicCrew} crew (${sb.gap} gap)
                      </div>
                    `}
                    ${sb.disciplineStatus && sb.disciplineStatus.length > 0 ? `
                      <div class="flex flex-wrap gap-1 mt-1 pl-3">
                        ${sb.disciplineStatus.map((ds) => `
                          <span class="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-semibold border ${ds.isFilled ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25' : 'bg-amber-500/10 text-amber-400 border-amber-500/25'}">
                            <span>${ui.esc(ds.role)}: ${ds.assigned}/${ds.required}</span>
                            ${ds.isFilled ? '✓' : ''}
                          </span>
                        `).join('')}
                      </div>
                    ` : ''}
                  </div>
                  <div class="shrink-0">
                    ${sb.isFilled ? `
                      <span class="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border bg-emerald-500/10 text-emerald-300 border-emerald-500/20">
                        ✓ Filled
                      </span>
                    ` : `
                      <button type="button" data-assign-space-crew="${item.key}|${ui.esc(sb.space)}|${ui.esc(sb.missingDisciplines ? sb.missingDisciplines[0] || '' : '')}" class="py-1 px-2 rounded text-[10px] font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 flex items-center gap-1 transition shadow-2xs whitespace-nowrap" title="Assign crew to ${ui.esc(sb.space)}">
                        ${ui.icon('plus', 'w-2.5 h-2.5 text-amber-300')}
                        <span>Assign ${sb.missingDisciplines && sb.missingDisciplines[0] ? sb.missingDisciplines[0] : ''}</span>
                      </button>
                    `}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      // ----------------------------------------------------------------------
      // STANDARD SINGLE-ROOM SHIFTS & EVENTS
      // ----------------------------------------------------------------------
      if (isCompact) {
        return `
          <div data-schedule-item="${item.key}" class="p-3 rounded-xl border border-l-[3.5px] ${spaceCls.bar} ${item.isUnfilled ? 'border-amber-500/40 bg-amber-500/5 hover:border-amber-400' : 'border-line bg-panel2/80 hover:bg-panel2 hover:border-line/90'} transition shadow-2xs cursor-pointer group select-none flex flex-col gap-2 text-left relative">
            <!-- Line 1: Space short tag, Leg indicator & Status -->
            <div class="flex items-center justify-between gap-1.5 text-[10px]">
              <div class="flex items-center gap-1 min-w-0">
                <span class="font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider text-[9px] ${spaceCls.tag} truncate max-w-[100px]" title="${ui.esc(item.space)}">
                  ${ui.esc(spaceCls.short || item.space)}
                </span>
                ${(item.splitFromId || item.legIndex) ? `
                  <span class="px-1.5 py-0.2 rounded text-[8.5px] font-mono font-bold bg-accent/20 text-accent border border-accent/40 shrink-0" title="Split Handover Shift">
                    Leg ${item.legIndex || 1}
                  </span>
                ` : ''}
              </div>
              <div class="flex items-center gap-1 shrink-0">
                ${!item.isNoTech ? `
                  <button type="button" data-split-shift="${item.key}" class="p-1 rounded text-muted hover:text-accent hover:bg-panel transition" title="Split shift into 2 handover shifts (e.g. 6h + 6h)">
                    ${ui.icon('split', 'w-3 h-3 text-accent')}
                  </button>
                ` : ''}
                <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-semibold border ${item.isUnfilled ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : 'border-line bg-panel text-muted'} shrink-0">
                  <span class="w-1.5 h-1.5 rounded-full ${statusMeta.dot}"></span>
                  <span>${statusMeta.label}</span>
                </span>
              </div>
            </div>

            <!-- Line 2: Event Name -->
            <div class="text-xs font-bold text-ink leading-snug break-words group-hover:text-accent transition-colors" title="${ui.esc(item.eventName)}">
              ${ui.esc(item.eventName)}
            </div>

            <!-- Line 3: Dedicated Time Badge (Zero Clipping Guarantee) -->
            <div class="flex items-center justify-between gap-1 text-[10.5px]">
              <div class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-panel border border-line/75 font-mono font-semibold text-ink/90 tabular-nums shadow-2xs">
                ${ui.icon('clock', 'w-3 h-3 text-muted shrink-0')}
                <span class="whitespace-nowrap">${timeStr}</span>
              </div>
            </div>

            <!-- Line 4: Tech & Role or Unfilled Call to Action -->
            ${item.isNoTech ? `
              <div class="flex items-center justify-between text-[10px] pt-1.5 border-t border-line/40 text-muted">
                <span class="italic text-muted/80">No Tech Required</span>
                <span class="text-[9px] px-1.5 py-0.2 rounded bg-panel border border-line text-muted font-medium">Self-Managed</span>
              </div>
            ` : (item.isUnfilled ? `
              <div class="pt-1 border-t border-line/40">
                <button type="button" data-assign-shift="${item.key}" class="w-full px-2.5 py-1.5 rounded-lg text-[10.5px] font-bold bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30 flex items-center justify-center gap-1.5 transition shadow-2xs">
                  ${ui.icon('plus', 'w-3 h-3 text-amber-300')}
                  <span>+ Assign Freelancer</span>
                </button>
              </div>
            ` : `
              <div class="flex items-center justify-between text-[11px] pt-1.5 border-t border-line/40 gap-1.5">
                <span class="truncate font-medium text-ink flex items-center gap-1.5 min-w-0" title="${ui.esc(item.userName)}">
                  <span class="w-4 h-4 rounded-full bg-accent/20 text-accent text-[9px] font-bold flex items-center justify-center shrink-0">
                    ${((item.userName || 'T')[0] || 'T').toUpperCase()}
                  </span>
                  <span class="truncate">${ui.esc(item.userName)}</span>
                </span>
                ${item.role ? `<span class="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-panel border border-line text-muted shrink-0">${ui.esc(item.role)}</span>` : ''}
              </div>
            `)}
          </div>
        `;
      }

      // Detailed Mode
      const initialLetter = ((item.userName || 'Tech')[0] || 'T').toUpperCase();
      const durationHrs = RMTP.getShiftDurationHours ? RMTP.getShiftDurationHours(item.startTime, item.finishTime) : 0;
      return `
        <div data-schedule-item="${item.key}" class="p-3 rounded-xl border border-l-[4px] ${spaceCls.bar} ${item.isUnfilled ? 'border-amber-500/40 bg-amber-500/5 hover:border-amber-400' : 'border-line bg-panel2/80 hover:bg-panel2 hover:border-line/90'} transition shadow-2xs cursor-pointer group select-none flex flex-col gap-2 text-left relative">
          <!-- Line 1: Space, Leg badge & Actions -->
          <div class="flex items-center justify-between gap-1.5">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider text-[9px] ${spaceCls.tag} truncate max-w-[120px]">${ui.esc(item.space)}</span>
              ${(item.splitFromId || item.legIndex) ? `
                <span class="px-2 py-0.5 rounded text-[9px] font-mono font-bold bg-accent/15 text-accent border border-accent/30 shrink-0">
                  Handover Leg ${item.legIndex || 1}
                </span>
              ` : ''}
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              ${!item.isNoTech ? `
                <button type="button" data-split-shift="${item.key}" class="px-2 py-0.5 rounded text-[10px] font-bold border border-accent/40 text-accent hover:bg-accent/10 transition flex items-center gap-1 shadow-2xs" title="Split shift into 2 handover shifts (e.g. 6h + 6h)">
                  ${ui.icon('split', 'w-3 h-3 text-accent')}
                  <span>Split</span>
                </button>
              ` : ''}
              <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-semibold border ${item.isUnfilled ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : 'border-line bg-panel text-ink'} shrink-0">
                <span class="w-1.5 h-1.5 rounded-full ${statusMeta.dot}"></span>
                <span>${statusMeta.label}</span>
              </span>
            </div>
          </div>

          <!-- Line 2: Event Name -->
          <div class="text-xs font-bold text-ink leading-snug break-words group-hover:text-accent transition-colors" title="${ui.esc(item.eventName)}">
            ${ui.esc(item.eventName)}
          </div>

          <!-- Line 3: Dedicated Time Badge (Zero Clipping Guarantee) -->
          <div class="flex items-center gap-2 flex-wrap">
            <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-panel border border-line/80 font-mono text-xs font-bold text-ink tabular-nums shadow-2xs">
              ${ui.icon('clock', 'w-3.5 h-3.5 text-accent shrink-0')}
              <span class="whitespace-nowrap">${timeStr}</span>
            </div>
            ${durationHrs > 0 ? `<span class="font-mono text-[10px] text-muted px-1.5 py-0.5 rounded bg-panel border border-line">${durationHrs}h</span>` : ''}
          </div>

          <!-- Line 4: Technician Profile & Assignment or Self-Service -->
          ${item.isNoTech ? `
            <div class="flex items-center justify-between gap-2 pt-1.5 border-t border-line/40 text-xs text-muted">
              <span class="italic text-muted/90 flex items-center gap-1.5">
                ${ui.icon('slash', 'w-3.5 h-3.5 text-muted')}
                <span>No Tech Required (Self-Service)</span>
              </span>
              <span class="text-[9.5px] px-2 py-0.5 rounded bg-panel border border-line text-muted font-medium">Dark / Automated</span>
            </div>
          ` : `
          <div class="flex items-center justify-between gap-2 pt-1.5 border-t border-line/40 text-xs">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="w-5 h-5 rounded-full bg-accent/20 text-accent text-[10px] font-bold flex items-center justify-center shrink-0">
                ${initialLetter}
              </span>
              <div class="min-w-0">
                <span class="text-xs font-semibold text-ink truncate block ${item.isUnfilled ? 'text-amber-400' : ''}">
                  ${item.isUnfilled ? 'Unassigned' : ui.esc(item.userName)}
                </span>
                ${item.role ? `<span class="text-[10px] text-muted block truncate font-mono">${ui.esc(item.role)}</span>` : ''}
              </div>
            </div>
            ${item.rate ? `<span class="text-[10px] font-mono text-muted tabular-nums shrink-0 px-1.5 py-0.5 rounded bg-panel border border-line">${ui.esc(item.rate)}</span>` : ''}
          </div>
          `}

          ${item.notes ? `
            <div class="text-[10px] text-muted italic bg-panel px-2 py-1 rounded border border-line/60 break-words">
              ${ui.esc(item.notes)}
            </div>
          ` : ''}

          ${(item.isUnfilled && !item.isNoTech) ? `
            <div class="pt-0.5">
              <button type="button" data-assign-shift="${item.key}" class="w-full py-1.5 px-2.5 rounded-lg text-xs font-bold bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30 flex items-center justify-center gap-1 transition shadow-2xs">
                ${ui.icon('plus', 'w-3.5 h-3.5 text-amber-300')}
                <span>+ Assign Freelancer</span>
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }

    // Top Metrics & Status Filter Strip updater
    function updateTopMetrics() {
      const stripEl = el.querySelector('#rota-metrics-strip');
      const allB = getAllBookings();
      const allEv = getAllEvents();
      const wDays = getCurrentWeekDays();
      const wStart = wDays[0].date;
      const wEnd = wDays[6].date;

      const totalWeekBookings = allB.filter((b) => { const d = normalizeDate(b.date); return d >= wStart && d <= wEnd && b.status !== 'cancelled' && b.status !== 'declined'; });
      const confirmedCount = totalWeekBookings.filter((b) => b.status === 'confirmed').length;
      const pencilCount = totalWeekBookings.filter((b) => b.status === 'pencil').length;
      const activeFreelancers = new Set(totalWeekBookings.map((b) => b.userId).filter(Boolean)).size;

      const weekEvents = allEv.filter((e) => { const d = normalizeDate(e.date); return d >= wStart && d <= wEnd; });
      const unfilledWeekEvents = weekEvents.filter((e) => {
        if (e.noTechNeeded) return false;
        const assigned = allB.filter((b) => b.eventId === e.id && b.status !== 'cancelled' && b.status !== 'declined' && (b.userId || (b.userName && !/^unassigned(\s+tech)?$/i.test(String(b.userName).trim()))));
        const evTechs = RMTP.eventTechnicians ? RMTP.eventTechnicians(e).filter((t) => t.userId || (t.freelancerName && t.freelancerName.trim()) || t.isNoTech) : [];
        return assigned.length === 0 && evTechs.length === 0;
      });

      // Update badge on tabs (only active upcoming shift swaps)
      const openSwaps = getAllBookings().filter((b) => isActiveOpenSwap(b));
      const myShifts = getAllBookingsRaw().filter((b) => me && b.userId === me.id && b.status !== 'cancelled' && b.status !== 'declined');
      const swapsBadge = el.querySelector('#rota-swaps-count');
      if (swapsBadge) {
        swapsBadge.textContent = openSwaps.length > 0 ? String(openSwaps.length) : '0';
        swapsBadge.style.display = openSwaps.length > 0 ? 'inline-block' : 'none';
      }

      if (!stripEl) return;

      const now = new Date();
      const currentMonthActive = (state.rotaMonth || formatDate(now).slice(0, 7));
      const monthBookings = allB.filter((b) => normalizeDate(b.date).startsWith(currentMonthActive) && b.status !== 'cancelled' && b.status !== 'declined');
      const monthShiftsCount = monthBookings.length;

      // Calculate all advancing events for active month to detect gaps
      const monthEvents = allEv.filter((e) => normalizeDate(e.date).startsWith(currentMonthActive));
      const monthUnfilledEvents = monthEvents.filter((e) => {
        if (e.noTechNeeded) return false;
        const assigned = allB.filter((b) => b.eventId === e.id && b.status !== 'cancelled' && b.status !== 'declined' && (b.userId || (b.userName && !/^unassigned(\s+tech)?$/i.test(String(b.userName).trim()))));
        const evTechs = RMTP.eventTechnicians ? RMTP.eventTechnicians(e).filter((t) => t.userId || (t.freelancerName && t.freelancerName.trim()) || t.isNoTech) : [];
        return assigned.length === 0 && evTechs.length === 0;
      });
      const activeGapsCount = state.boardView === 'month' ? monthUnfilledEvents.length : unfilledWeekEvents.length;

      stripEl.innerHTML = `
        <div class="flex items-center gap-2.5 flex-wrap">
          <span class="font-semibold text-ink flex items-center gap-1.5">
            ${ui.icon('calendar', 'w-4 h-4 text-accent')}
            <span>${state.boardView === 'month' ? 'This Month:' : 'This Week:'}</span>
            <span class="font-mono font-bold text-accent">${monthShiftsCount} venue shifts</span>
          </span>
          <span class="text-line hidden sm:inline">|</span>
          <span class="text-xs font-semibold ${myShifts.length > 0 ? 'text-accent' : 'text-muted'} flex items-center gap-1">
            <span>⭐</span>
            <span>${myShifts.length} shift${myShifts.length === 1 ? '' : 's'} assigned to you</span>
          </span>
          ${activeGapsCount > 0 ? `
            <span class="text-line hidden sm:inline">|</span>
            <button id="strip-unfilled-btn" class="flex items-center gap-1.5 px-2.5 py-0.5 rounded transition cursor-pointer ${state.unfilledOnly ? 'bg-rose-500/30 text-rose-300 font-bold border border-rose-500 shadow-2xs' : 'bg-rose-500/15 text-rose-300 font-semibold border border-rose-500/30 hover:bg-rose-500/25'}" title="Click to filter to staffing gaps">
              <span class="w-2 h-2 rounded-full bg-rose-400 animate-pulse"></span>
              <span>${activeGapsCount} Staffing Gap${activeGapsCount > 1 ? 's' : ''} (Unfilled)</span>
            </button>
          ` : ''}
          ${openSwaps.length > 0 ? `
            <span class="text-line hidden sm:inline">|</span>
            <button id="strip-swaps-btn" class="flex items-center gap-1.5 px-2.5 py-0.5 rounded transition cursor-pointer bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40 hover:bg-amber-500/30">
              <span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
              <span>${openSwaps.length} Shift Swap${openSwaps.length > 1 ? 's' : ''} Available</span>
            </button>
          ` : ''}
          <span class="text-line hidden sm:inline">|</span>
          <button id="strip-confirmed" class="flex items-center gap-1.5 px-2 py-0.5 rounded transition cursor-pointer ${state.statusFilter === 'confirmed' ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40' : 'text-muted hover:text-emerald-400'}">
            <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>${confirmedCount} Confirmed</span>
          </button>
          <button id="strip-pencil" class="flex items-center gap-1.5 px-2 py-0.5 rounded transition cursor-pointer ${state.statusFilter === 'pencil' ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40' : 'text-muted hover:text-amber-400'}">
            <span class="w-2 h-2 rounded-full bg-amber-400"></span>
            <span>${pencilCount} Pencil</span>
          </button>
        </div>
        <div class="text-[11px] text-muted font-mono hidden md:block">
          ${isTMOrAdmin ? 'Tech Manager View: all events & gaps visible by default' : 'Month View: click any date or shift to view schedule'}
        </div>
      `;

      // Wire strip buttons
      stripEl.querySelector('#strip-swaps-btn')?.addEventListener('click', () => {
        state.tab = 'swaps';
        el.querySelectorAll('[data-tab]').forEach((b) => {
          b.className = 'shrink-0 px-3.5 py-2 font-semibold rounded-lg transition-colors flex items-center gap-1.5 text-muted hover:text-ink hover:bg-panel2';
        });
        const swapTabBtn = el.querySelector('[data-tab="swaps"]');
        if (swapTabBtn) {
          swapTabBtn.className = 'shrink-0 px-3.5 py-2 font-semibold rounded-lg transition-colors flex items-center gap-1.5 bg-accent text-accent-ink shadow-xs';
        }
        renderActiveTab();
      });
      stripEl.querySelector('#strip-unfilled-btn')?.addEventListener('click', () => {
        state.unfilledOnly = !state.unfilledOnly;
        state.statusFilter = '';
        renderActiveTab();
      });
      stripEl.querySelector('#strip-confirmed')?.addEventListener('click', () => {
        state.statusFilter = state.statusFilter === 'confirmed' ? '' : 'confirmed';
        state.unfilledOnly = false;
        renderActiveTab();
      });
      stripEl.querySelector('#strip-pencil')?.addEventListener('click', () => {
        state.statusFilter = state.statusFilter === 'pencil' ? '' : 'pencil';
        state.unfilledOnly = false;
        renderActiveTab();
      });
    }

    let html = `
      <div class="space-y-3.5 animate-fadeIn">
        <!-- Page Header -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2.5 border-b border-line">
          <div>
            <div class="flex items-center gap-2.5">
              <span class="p-2 rounded-xl bg-accent/15 text-accent border border-accent/20 shrink-0">
                ${ui.icon('calendar', 'w-5 h-5')}
              </span>
              <div>
                <h1 class="text-lg sm:text-xl font-bold tracking-tight text-ink flex items-center gap-2">
                  Rota & Crew Availability
                </h1>
                <p class="text-xs text-muted">
                  Streamlined venue calendar, next-month availability & shift swap market
                </p>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2 flex-wrap w-full sm:w-auto">
            <button id="btn-bulk-avail" class="btn btn-primary text-xs flex-1 sm:flex-initial justify-center shadow-xs font-semibold">
              ${ui.icon('calendar', 'w-4 h-4')}
              <span>+ Add Availability</span>
            </button>
            <button id="btn-quick-swap" class="btn btn-ghost text-xs flex-1 sm:flex-initial justify-center">
              ${ui.icon('refresh', 'w-4 h-4')}
              <span>Shift Swaps</span>
            </button>
            ${isManagerOrSenior ? `
              <button id="btn-pdf-rota" class="btn btn-ghost text-xs flex-1 sm:flex-initial justify-center border border-line hover:border-accent">
                ${ui.icon('mail', 'w-4 h-4')}
                <span>Send PDF Rota</span>
              </button>
              <button id="btn-add-booking" class="btn btn-ghost text-xs flex-1 sm:flex-initial justify-center">
                ${ui.icon('plus', 'w-4 h-4')}
                <span>+ Book Shift</span>
              </button>
            ` : ''}
          </div>
        </div>

        <!-- Sleek Metrics & Quick Filter Strip -->
        <div id="rota-metrics-strip" class="px-3.5 py-2 rounded-xl bg-panel border border-line flex flex-wrap items-center justify-between gap-2.5 text-xs"></div>

        <!-- Navigation Tabs -->
        <div class="flex items-center gap-1.5 border-b border-line pb-1 overflow-x-auto text-xs scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
          <button data-tab="board" class="shrink-0 px-3.5 py-2 font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${state.tab === 'board' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink hover:bg-panel2'}">
            ${ui.icon('calendar', 'w-3.5 h-3.5')}
            <span>Venue Rota</span>
          </button>
          <button data-tab="my_avail" class="shrink-0 px-3.5 py-2 font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${state.tab === 'my_avail' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink hover:bg-panel2'}">
            ${ui.icon('user', 'w-3.5 h-3.5')}
            <span>My Availability</span>
          </button>
          <button data-tab="swaps" class="shrink-0 px-3.5 py-2 font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${state.tab === 'swaps' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink hover:bg-panel2'}">
            ${ui.icon('refresh', 'w-3.5 h-3.5')}
            <span>Shift Swaps</span>
            <span id="rota-swaps-count" class="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30"></span>
          </button>
          ${isManagerOrSenior ? `
            <button data-tab="day_planner" class="shrink-0 px-3.5 py-2 font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${state.tab === 'day_planner' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink hover:bg-panel2'}">
              ${ui.icon('sliders', 'w-3.5 h-3.5')}
              <span>Day Crew &amp; Shifts</span>
            </button>
            <button data-tab="team_matrix" class="shrink-0 px-3.5 py-2 font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${state.tab === 'team_matrix' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink hover:bg-panel2'}">
              ${ui.icon('users', 'w-3.5 h-3.5')}
              <span>Team Matrix & Shifts</span>
            </button>
          ` : ''}
        </div>

        <!-- TAB CONTENT CONTAINER -->
        <div id="rota-tab-view"></div>
      </div>
    `;

    el.innerHTML = html;

    // --- TAB RENDERING LOGIC ---
    const tabContainer = el.querySelector('#rota-tab-view');

    function syncTabButtons() {
      el.querySelectorAll('[data-tab]').forEach((b) => {
        const isAct = b.getAttribute('data-tab') === state.tab;
        b.className = 'shrink-0 px-3.5 py-2 font-semibold rounded-lg transition-colors flex items-center gap-1.5 ' +
          (isAct ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink hover:bg-panel2');
      });
    }

    function renderActiveTab() {
      updateTopMetrics();
      if (state.tab === 'board') renderBoardTab();
      else if (state.tab === 'my_avail') renderMyAvailTab();
      else if (state.tab === 'swaps') renderSwapsTab();
      else if (state.tab === 'day_planner') {
        if (isManagerOrSenior) renderDayPlannerTab();
        else { state.tab = 'board'; syncTabButtons(); renderBoardTab(); }
      }
      else if (state.tab === 'team_matrix') {
        if (isManagerOrSenior) renderTeamMatrixTab();
        else { state.tab = 'board'; syncTabButtons(); renderBoardTab(); }
      }
      else if (state.tab === 'list') renderListTab();
      else renderBoardTab();
    }

    // ------------------------------------------------------------------------
    // TAB 1: MASTER ROTA BOARD
    // ------------------------------------------------------------------------
    function renderBoardTab() {
      allScheduleItemsMap.clear();

      const allUsers = getAllUsers();
      const weekDays = getCurrentWeekDays();
      const startWeekStr = weekDays[0].date;
      const endWeekStr = weekDays[6].date;
      const startD = parseDate(startWeekStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const endD = parseDate(endWeekStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

      // Gather schedule for each day
      const daysData = weekDays.map((d) => ({
        ...d,
        items: getDaySchedule(d.date),
      }));

      const hasActiveFilters = !!(state.spaceFilter || state.roleFilter || state.statusFilter || state.techFilter || state.unfilledOnly);

      const [curYStr, curMStr] = (state.rotaMonth || state.availMonth || formatDate(new Date()).slice(0, 7)).split('-');
      const monthDateObj = new Date(parseInt(curYStr, 10), parseInt(curMStr, 10) - 1, 1);
      const curMonthDisplay = monthDateObj.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

      let out = `
        <div class="space-y-3">
          <!-- Unified Master Rota Toolbar -->
          <div class="p-3 rounded-xl bg-panel border border-line space-y-2.5">
            <!-- Tier 1: Month/Week Navigator + View Mode Switcher -->
            <div class="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5">
              ${state.boardView === 'month' ? `
                <!-- Month Jumpers -->
                <div class="flex items-center gap-1.5 flex-wrap">
                  <div class="flex items-center gap-1">
                    <button id="month-board-prev" class="btn btn-ghost !p-1.5" title="Previous Month">
                      ${ui.icon('chevL', 'w-4 h-4')}
                    </button>
                    <span class="text-xs font-bold text-ink px-2 font-mono tabular-nums whitespace-nowrap">
                      ${curMonthDisplay}
                    </span>
                    <button id="month-board-next" class="btn btn-ghost !p-1.5" title="Next Month">
                      ${ui.icon('chevR', 'w-4 h-4')}
                    </button>
                  </div>
                  <div class="flex items-center gap-1 pl-1 border-l border-line/60">
                    <button id="month-board-today" class="btn btn-ghost text-xs !py-1 !px-2">
                      This Month
                    </button>
                    <button id="month-board-next-month" class="btn btn-ghost text-xs !py-1 !px-2 text-accent font-semibold">
                      Next Month →
                    </button>
                  </div>
                </div>
              ` : `
                <!-- Week Jumpers -->
                <div class="flex items-center gap-1.5 flex-wrap">
                  <div class="flex items-center gap-1">
                    <button id="week-prev" class="btn btn-ghost !p-1.5" title="Previous Week">
                      ${ui.icon('chevL', 'w-4 h-4')}
                    </button>
                    <button id="week-today" class="btn btn-ghost text-xs ${state.weekOffset === 0 ? 'bg-panel2 border border-line font-bold text-accent' : ''}">
                      This Week
                    </button>
                    <button id="week-next" class="btn btn-ghost !p-1.5" title="Next Week">
                      ${ui.icon('chevR', 'w-4 h-4')}
                    </button>
                  </div>
                  <span class="text-xs font-bold text-ink px-1.5 font-mono tabular-nums whitespace-nowrap">
                    ${startD} – ${endD}
                  </span>
                </div>
              `}

              <!-- Middle: View Switcher (Month View vs Week Grid vs Room Timeline) -->
              <div class="flex items-center gap-1 p-1 bg-panel2/80 rounded-lg border border-line self-start md:self-auto flex-wrap sm:flex-nowrap">
                <button id="view-mode-month" class="px-2.5 py-1 text-xs font-semibold rounded-md transition ${state.boardView === 'month' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink'}" title="Full monthly rota calendar with personal shifts and open swap highlights">
                  Month View
                </button>
                <button id="view-mode-week" class="px-2.5 py-1 text-xs font-semibold rounded-md transition ${state.boardView === 'week' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink'}" title="7-day week swimlanes">
                  Week Grid (7D)
                </button>
                <button id="view-mode-timeline" class="px-2.5 py-1 text-xs font-semibold rounded-md transition ${state.boardView === 'timeline' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink'}" title="Multi-room grid by space">
                  Room Grid
                </button>
              </div>

              <!-- Search Bar -->
              <div class="relative">
                <input id="flt-search" class="field !py-1 !pl-7 text-xs max-w-[200px]" placeholder="Search event, room, tech..." value="${ui.esc(state.searchQuery || '')}" />
                <span class="absolute left-2 top-1.5 text-muted pointer-events-none">
                  ${ui.icon('search', 'w-3.5 h-3.5')}
                </span>
              </div>
            </div>

            <!-- Tier 2: Filter Strip (Dropdowns, Event Scope & Quick Status Chips) -->
            <div class="pt-2 border-t border-line/60 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div class="flex items-center gap-2 flex-wrap">
                <!-- Events Scope Toggle: All Events (inc. Gaps) vs Staffed Only -->
                <div class="flex items-center gap-1 p-0.5 bg-panel2/80 rounded-lg border border-line">
                  <button id="flt-events-all" class="px-2.5 py-1 text-xs font-semibold rounded-md transition flex items-center gap-1.5 ${state.eventsFilter !== 'staffed' ? 'bg-accent text-accent-ink shadow-2xs font-bold' : 'text-muted hover:text-ink'}" title="Show all advancing events, including unstaffed shifts to spot gaps">
                    <span>All Events (inc. Gaps)</span>
                    ${isTMOrAdmin ? `<span class="px-1 py-0.2 rounded text-[9px] font-mono ${state.eventsFilter !== 'staffed' ? 'bg-black/20 text-accent-ink' : 'bg-panel text-muted'}">Default</span>` : ''}
                  </button>
                  <button id="flt-events-staffed" class="px-2.5 py-1 text-xs font-semibold rounded-md transition flex items-center gap-1.5 ${state.eventsFilter === 'staffed' ? 'bg-accent text-accent-ink shadow-2xs font-bold' : 'text-muted hover:text-ink'}" title="Show only events with booked or assigned technicians">
                    <span>Staffed Only</span>
                  </button>
                </div>

                <!-- Space Filter Dropdown (Core Spaces by default) -->
                <select id="flt-space" class="field !py-1 text-xs max-w-[140px]">
                  <option value="">${state.showNonCoreSpaces ? 'All Spaces' : 'Core Spaces'}</option>
                  ${getVisibleSpacesList().map((s) => `<option value="${ui.esc(s)}" ${state.spaceFilter === s ? 'selected' : ''}>${ui.esc(s)}</option>`).join('')}
                </select>

                <!-- Non-Core Spaces Toggle -->
                <button type="button" id="flt-toggle-noncore" class="px-2 py-1 text-[11px] font-semibold rounded-md border transition flex items-center gap-1 ${state.showNonCoreSpaces ? 'bg-accent/15 text-accent border-accent/40' : 'bg-panel border-line text-muted hover:text-ink'}" title="Non-core spaces (Streetside, Cinema Bar, The Lab, etc.) are hidden by default. Click to include them.">
                  <span>${state.showNonCoreSpaces ? 'Showing All Spaces' : 'Core Spaces Only'}</span>
                </button>

                <!-- Role Filter Dropdown -->
                <select id="flt-role" class="field !py-1 text-xs max-w-[115px]">
                  <option value="">All Roles</option>
                  ${RMTP.SHIFT_ROLES.map((r) => `<option value="${r}" ${state.roleFilter === r ? 'selected' : ''}>${r}</option>`).join('')}
                </select>

                <!-- Technician Filter Dropdown -->
                <select id="flt-tech" class="field !py-1 text-xs max-w-[140px]">
                  <option value="">All Technicians</option>
                  ${allUsers.map((u) => `<option value="${u.id}" ${state.techFilter === u.id ? 'selected' : ''}>${ui.esc(auth.displayName(u))}</option>`).join('')}
                </select>

                <!-- Quick Status Chips -->
                <div class="hidden sm:flex items-center gap-1 pl-1 border-l border-line/60">
                  <button data-quick-filter="" class="px-2 py-0.5 text-[11px] font-semibold rounded border transition ${!state.statusFilter && !state.unfilledOnly ? 'bg-accent/15 text-accent border-accent/40 font-bold' : 'bg-panel border-line text-muted hover:text-ink'}">
                    All
                  </button>
                  <button data-quick-filter="unfilled" class="px-2 py-0.5 text-[11px] font-semibold rounded border transition flex items-center gap-1 ${state.unfilledOnly ? 'bg-rose-500/20 text-rose-300 border-rose-500/50 font-bold' : 'bg-panel border-line text-muted hover:text-rose-400'}">
                    <span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                    <span>Unfilled</span>
                  </button>
                  <button data-quick-filter="confirmed" class="px-2 py-0.5 text-[11px] font-semibold rounded border transition flex items-center gap-1 ${state.statusFilter === 'confirmed' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 font-bold' : 'bg-panel border-line text-muted hover:text-emerald-400'}">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    <span>Confirmed</span>
                  </button>
                  <button data-quick-filter="pencil" class="px-2 py-0.5 text-[11px] font-semibold rounded border transition flex items-center gap-1 ${state.statusFilter === 'pencil' ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 font-bold' : 'bg-panel border-line text-muted hover:text-amber-400'}">
                    <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                    <span>Pencil</span>
                  </button>
                </div>
              </div>

              ${hasActiveFilters ? `
                <button id="flt-clear" class="btn btn-ghost text-xs !py-0.5 !px-2 text-danger font-semibold flex items-center gap-1">
                  ${ui.icon('x', 'w-3 h-3')}
                  <span>Clear Filters</span>
                </button>
              ` : ''}
            </div>
          </div>
      `;

      // ----------------------------------------------------------------------
      // SUB-VIEW 0: MONTH VIEW CALENDAR (DEFAULT)
      // ----------------------------------------------------------------------
      if (state.boardView === 'month') {
        const [yStr, mStr] = (state.rotaMonth || state.availMonth || formatDate(new Date()).slice(0, 7)).split('-');
        const year = parseInt(yStr, 10);
        const month = parseInt(mStr, 10) - 1; // 0-indexed
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();
        const startDow = (firstDay.getDay() + 6) % 7; // Monday = 0
        const monthTitle = firstDay.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
        const todayStr = formatDate(new Date());

        out += `
          <div class="p-3 sm:p-4 rounded-xl bg-panel border border-line space-y-3 shadow-2xs">
            <div class="flex items-center justify-between pb-2 border-b border-line/60 flex-wrap gap-2">
              <div class="flex items-center gap-2">
                <span class="text-xs font-bold text-ink flex items-center gap-1.5">
                  ${ui.icon('calendar', 'w-4 h-4 text-accent')}
                  <span>Venue Schedule · ${monthTitle}</span>
                </span>
                <span class="text-[11px] text-muted hidden sm:inline">(Click any date or shift to view details & cover options)</span>
              </div>
              <div class="flex items-center gap-3 text-[11px] flex-wrap">
                <span class="flex items-center gap-1.5 font-medium"><span class="w-2.5 h-2.5 rounded bg-accent/40 border border-accent"></span> ⭐ My Shifts</span>
                <span class="flex items-center gap-1.5 font-medium"><span class="w-2.5 h-2.5 rounded bg-amber-500/40 border border-amber-500"></span> 🔄 Cover Offered</span>
                <span class="flex items-center gap-1.5 font-medium"><span class="w-2.5 h-2.5 rounded bg-rose-500/40 border border-rose-500"></span> ⚠️ Unstaffed Gaps</span>
                <span class="flex items-center gap-1.5 font-medium"><span class="w-2.5 h-2.5 rounded bg-emerald-500/40 border border-emerald-500"></span> Confirmed</span>
              </div>
            </div>

            <!-- Calendar Grid with scroll safety -->
            <div class="overflow-x-auto scrollbar-hide">
              <div class="min-w-[720px]">
                <!-- Day Headers -->
                <div class="grid grid-cols-7 gap-1.5 text-center text-[11px] font-bold text-muted uppercase tracking-wider py-1.5 border-b border-line/40">
                  <div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div><div>Sun</div>
                </div>

                <!-- Days Grid -->
                <div class="grid grid-cols-7 gap-1.5 pt-1.5">
        `;

        // Blank padding days
        for (let i = 0; i < startDow; i++) {
          out += `<div class="p-1 min-h-[100px] rounded-lg bg-panel2/20 border border-transparent opacity-25"></div>`;
        }

        for (let dNum = 1; dNum <= daysInMonth; dNum++) {
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`;
          const dayItems = getDaySchedule(dateStr);

          const isToday = dateStr === todayStr;
          const myShifts = dayItems.filter((i) => me && i.userId === me.id);
          const swapShifts = dayItems.filter((i) => i.booking && isActiveOpenSwap(i.booking));
          const unfilledGaps = dayItems.filter((i) => i.isUnfilled && !i.isNoTech);
          const otherStaffed = dayItems.filter((i) => !i.isUnfilled && !i.isNoTech && (!me || i.userId !== me.id) && (!i.booking || !isActiveOpenSwap(i.booking)));
          const selfService = dayItems.filter((i) => i.isNoTech);

          let cellBorder = 'border-line';
          let cellBg = 'bg-panel2/40';

          if (isToday) {
            cellBorder = 'border-accent ring-1 ring-accent';
            cellBg = 'bg-accent/5';
          } else if (unfilledGaps.length > 0) {
            cellBorder = 'border-rose-500/40 ring-1 ring-rose-500/20';
            cellBg = 'bg-rose-500/5';
          } else if (myShifts.length > 0) {
            cellBorder = 'border-accent/40';
            cellBg = 'bg-accent/5';
          } else if (swapShifts.length > 0) {
            cellBorder = 'border-amber-500/40';
            cellBg = 'bg-amber-500/5';
          }

          out += `
            <div data-cell-day="${dateStr}" class="p-1.5 min-h-[105px] rounded-lg border ${cellBorder} ${cellBg} hover:border-accent hover:shadow-xs transition flex flex-col justify-between cursor-pointer group">
              <div>
                <div class="flex items-center justify-between pb-1 mb-1 border-b border-line/30">
                  <span class="text-xs font-mono font-bold ${isToday ? 'text-accent bg-accent/20 px-1.5 py-0.2 rounded' : 'text-ink'}">${dNum}</span>
                  <div class="flex items-center gap-1">
                    ${isToday ? '<span class="text-[9px] font-bold uppercase tracking-wider text-accent hidden sm:inline">Today</span>' : ''}
                    ${unfilledGaps.length > 0 ? `<span class="text-[9px] font-mono font-bold text-rose-300 bg-rose-500/20 border border-rose-500/30 px-1 py-0.2 rounded" title="${unfilledGaps.length} staffing gap(s)">⚠️ ${unfilledGaps.length}</span>` : ''}
                    ${dayItems.length > 0 ? `<span class="text-[10px] font-mono text-muted tabular-nums" title="${dayItems.length} total events / shifts">${dayItems.length}</span>` : ''}
                  </div>
                </div>

                <!-- Shift Chips -->
                <div class="space-y-1">
          `;

          // 1. My shifts first
          myShifts.forEach((b) => {
            out += `
              <div data-click-booking="${b.id || (b.booking && b.booking.id) || ''}" data-schedule-item="${b.key}" class="p-1 rounded bg-accent/20 border border-accent/40 text-accent font-semibold text-[10px] leading-tight truncate flex items-center justify-between gap-1 shadow-2xs hover:bg-accent/30 transition" title="${ui.esc(b.eventName)} · ${ui.esc(b.space)}">
                <span class="truncate">⭐ ${ui.esc(b.role || 'Tech')} · ${ui.esc(b.space)}</span>
                <span class="font-mono text-[9px] opacity-80 shrink-0">${b.startTime}</span>
              </div>
            `;
          });

          // 2. Swap shifts (that are not mine)
          swapShifts.filter((b) => !me || b.userId !== me.id).forEach((b) => {
            out += `
              <div data-click-booking="${b.id || (b.booking && b.booking.id) || ''}" data-schedule-item="${b.key}" class="p-1 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 font-semibold text-[10px] leading-tight truncate flex items-center justify-between gap-1 hover:bg-amber-500/30 transition" title="Swap Offered: ${ui.esc(b.eventName)}">
                <span class="truncate">🔄 Cover: ${ui.esc(b.role || 'Tech')}</span>
                <span class="text-[9px] underline font-bold shrink-0">Claim</span>
              </div>
            `;
          });

          // 3. Unfilled Gaps (High visibility for Tech Managers!)
          unfilledGaps.forEach((b) => {
            out += `
              <div data-click-unfilled="${b.key}" class="p-1 rounded bg-rose-500/20 border border-rose-500/40 text-rose-300 font-bold text-[10px] leading-tight truncate flex items-center justify-between gap-1 hover:bg-rose-500/30 transition shadow-2xs cursor-pointer" title="UNSTAFFED GAP: ${ui.esc(b.eventName)} (${ui.esc(b.space)} - ${ui.esc(b.role || 'Tech')}) · Click to assign tech">
                <span class="truncate flex items-center gap-1">
                  <span class="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse shrink-0"></span>
                  <span class="truncate">⚠️ ${ui.esc(b.space)}: ${ui.esc(b.role || 'Tech')}</span>
                </span>
                <span class="font-mono text-[9px] underline shrink-0">+ Cover</span>
              </div>
            `;
          });

          // 4. Other staffed shifts (limit to remaining slots)
          const priorityCount = myShifts.length + swapShifts.filter((b) => !me || b.userId !== me.id).length + unfilledGaps.length;
          const remainingSlots = Math.max(0, 4 - priorityCount);
          otherStaffed.slice(0, remainingSlots).forEach((b) => {
            out += `
              <div data-click-booking="${b.id || (b.booking && b.booking.id) || ''}" data-schedule-item="${b.key}" class="p-1 rounded bg-panel border border-line text-[10px] leading-tight truncate flex items-center justify-between gap-1 hover:border-ink/30 transition text-muted hover:text-ink cursor-pointer" title="${ui.esc(b.eventName)} (${ui.esc(b.space)})">
                <span class="truncate font-medium">${ui.esc(b.space)}: ${ui.esc(b.role || 'Tech')}</span>
                <span class="font-mono text-[9px] truncate max-w-[50px] shrink-0">${ui.esc(b.userName ? b.userName.split(' ')[0] : 'Staffed')}</span>
              </div>
            `;
          });

          // 5. Self-service events (if slots open)
          if (remainingSlots > otherStaffed.length) {
            const selfSlots = remainingSlots - otherStaffed.length;
            selfService.slice(0, selfSlots).forEach((b) => {
              out += `
                <div data-schedule-item="${b.key}" class="p-1 rounded bg-panel2/60 border border-line/60 text-[9.5px] leading-tight truncate text-muted" title="${ui.esc(b.eventName)} · Self-Service">
                  <span class="truncate italic">${ui.esc(b.space)}: Self-Service</span>
                </div>
              `;
            });
          }

          const totalShown = priorityCount + Math.min(otherStaffed.length, remainingSlots) + Math.min(selfService.length, Math.max(0, remainingSlots - otherStaffed.length));
          if (dayItems.length > totalShown) {
            out += `
              <div class="text-[9px] text-muted font-mono text-center pt-0.5">
                +${dayItems.length - totalShown} more
              </div>
            `;
          }

          if (dayItems.length === 0) {
            out += `<div class="text-[10px] text-muted/30 text-center py-2 font-mono select-none">-</div>`;
          }

          out += `
                </div>
              </div>
              <div class="text-[9px] text-muted/0 group-hover:text-muted/70 text-right font-mono transition">View Day →</div>
            </div>
          `;
        }

        out += `
                </div>
              </div>
            </div>
          </div>
        `;
      }
      else if (state.boardView === 'timeline') {
        const selDayStr = state.selectedDay || weekDays[0].date;
        const selDayObj = parseDate(selDayStr);
        const selDayFormatted = selDayObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const daySchedule = getDaySchedule(selDayStr);

        // Previous and Next day calculations
        const prevDayObj = new Date(selDayObj);
        prevDayObj.setDate(prevDayObj.getDate() - 1);
        const prevDayStr = formatDate(prevDayObj);
        const nextDayObj = new Date(selDayObj);
        nextDayObj.setDate(nextDayObj.getDate() + 1);
        const nextDayStr = formatDate(nextDayObj);

        // Spaces list (Core Spaces by default unless Non-Core toggled on)
        const activeSpaces = Array.from(new Set([...getVisibleSpacesList(), ...daySchedule.flatMap((i) => i.spaces || [i.space])])).filter((sp) => sp && isSpaceAllowed(sp));
        state.collapsedSpaces = state.collapsedSpaces || new Set();

        // Calculate Venue-wide Metrics for today
        const totalShiftsToday = daySchedule.length;
        const noTechCount = daySchedule.filter((i) => i.isNoTech).length;
        const unfilledCount = daySchedule.filter((i) => i.isUnfilled && !i.isNoTech).length;
        const filledTechCount = daySchedule.filter((i) => !i.isUnfilled && !i.isNoTech).length;

        out += `
          <!-- Unified Master Date & Actions Strip -->
          <div class="p-3 rounded-xl bg-panel border border-line flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 shadow-2xs">
            <!-- Day Jumpers & Quick Title -->
            <div class="flex items-center gap-2 flex-wrap">
              <div class="flex items-center gap-1">
                <button data-set-day="${prevDayStr}" class="btn btn-ghost !p-2" title="Previous Day">
                  ${ui.icon('chevL', 'w-4 h-4')}
                </button>
                <button data-set-day="${formatDate(new Date())}" class="btn btn-ghost text-xs ${selDayStr === formatDate(new Date()) ? 'bg-panel2 border border-line font-bold text-accent' : ''}">
                  Today
                </button>
                <button data-set-day="${nextDayStr}" class="btn btn-ghost !p-2" title="Next Day">
                  ${ui.icon('chevR', 'w-4 h-4')}
                </button>
              </div>
              <span class="text-sm font-bold text-ink px-1 whitespace-nowrap">
                ${selDayFormatted}
              </span>
              <!-- Metric summary badges -->
              <div class="flex items-center gap-2 text-xs font-mono flex-wrap">
                <span class="px-2 py-0.5 rounded bg-panel2 border border-line text-ink">${totalShiftsToday} Shifts Scheduled</span>
                ${filledTechCount > 0 ? `<span class="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold">${filledTechCount} Staffed</span>` : ''}
                ${noTechCount > 0 ? `<span class="px-2 py-0.5 rounded bg-panel2 border border-line text-muted">${noTechCount} Self-Service</span>` : ''}
                ${unfilledCount > 0 ? `<span class="px-2 py-0.5 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300 font-bold">⚠️ ${unfilledCount} Unfilled</span>` : ''}
                ${(() => {
                  const dayTasks = (store.all('tasks') || []).filter(t => t.dueDate === selDayStr && t.status !== 'Completed');
                  return dayTasks.length > 0 ? `<a href="#/tasks" class="px-2 py-0.5 rounded bg-accent/15 border border-accent/30 text-accent font-semibold hover:bg-accent/25 flex items-center gap-1">${ui.icon('list', 'w-3 h-3')} ${dayTasks.length} Venue Task${dayTasks.length > 1 ? 's' : ''}</a>` : '';
                })()}
              </div>
            </div>

            <!-- Workflow Tools: Sync from Advancing & Expand/Collapse All -->
            <div class="flex items-center gap-2 flex-wrap justify-end">
              <!-- Week Days Quick Jump Strip -->
              <div class="flex items-center gap-1 overflow-x-auto scrollbar-hide">
                ${weekDays.map((d) => {
                  const dayCount = getDaySchedule(d.date).length;
                  return `
                    <button data-set-day="${d.date}" class="px-2 py-1 text-[11px] font-semibold rounded-lg border transition flex items-center gap-1 shrink-0 ${d.date === selDayStr ? 'bg-accent text-accent-ink border-accent font-bold' : (d.isToday ? 'bg-panel2 text-accent border-accent/40' : 'bg-panel border-line text-muted hover:text-ink')}">
                      <span>${d.dayName} ${d.dayNum}</span>
                      ${dayCount > 0 ? `<span class="px-1 py-0.2 rounded text-[9px] font-mono bg-panel2/80">${dayCount}</span>` : ''}
                    </button>
                  `;
                }).join('')}
              </div>

              <!-- Streamline Action: Auto-Sync Advancing Shifts -->
              <button id="btn-sync-advancing-rota" class="btn btn-ghost text-xs !py-1.5 !px-2.5 border border-line hover:border-accent text-accent font-semibold flex items-center gap-1.5 shadow-2xs" title="Auto-populate draft shifts for all events advanced on ${selDayFormatted}">
                ${ui.icon('refresh', 'w-3.5 h-3.5 text-accent')}
                <span>Sync Advancing Shifts</span>
              </button>

              <!-- Expand/Collapse Controls -->
              <div class="flex items-center gap-1 p-0.5 rounded-lg border border-line bg-panel2/60">
                <button id="btn-expand-all-spaces" class="px-2 py-1 text-[11px] font-semibold rounded hover:bg-panel text-muted hover:text-ink transition" title="Expand all venue space rows">
                  Expand All
                </button>
                <button id="btn-collapse-all-spaces" class="px-2 py-1 text-[11px] font-semibold rounded hover:bg-panel text-muted hover:text-ink transition" title="Collapse all venue space rows">
                  Collapse All
                </button>
              </div>
            </div>
          </div>

          <!-- Pinned Timeline Hours Header Bar -->
          <div class="rounded-xl border border-line bg-panel p-2 hidden sm:flex items-center text-[11px] font-mono text-muted select-none">
            <div class="w-72 shrink-0 font-bold uppercase tracking-wider text-ink/80 pl-2">
              Venue Space &amp; Staffing Requirements
            </div>
            <div class="flex-1 grid grid-cols-8 text-center border-l border-line/60">
              <span>08:00</span>
              <span>10:00</span>
              <span>12:00</span>
              <span>14:00</span>
              <span>16:00</span>
              <span>18:00</span>
              <span>20:00</span>
              <span>22:00</span>
            </div>
          </div>

          <!-- Space-by-Space Collapsible Rows -->
          <div class="space-y-3">
        `;

        activeSpaces.forEach((spaceName) => {
          const spaceColor = getSpaceColor(spaceName);
          const spaceItems = daySchedule.filter((i) => i.space === spaceName || (i.spaces && i.spaces.includes(spaceName)));
          const specs = RMTP.getSpaceCrewSpecs ? RMTP.getSpaceCrewSpecs(spaceName) : { total: 1, disciplines: [{ role: 'Sound', count: 1 }], summary: '1x Sound' };
          const isCollapsed = state.collapsedSpaces.has(spaceName);

          const hasNoTechOnly = spaceItems.length > 0 && spaceItems.every((i) => i.isNoTech);
          const unfilledItems = spaceItems.filter((i) => i.isUnfilled && !i.isNoTech);
          const isRoomUnfilled = unfilledItems.length > 0;
          const isRoomFilled = spaceItems.length > 0 && unfilledItems.length === 0;

          // Determine missing disciplines for this space
          const missingDiscs = [];
          if (specs.disciplines && specs.disciplines.length) {
            specs.disciplines.forEach((cd) => {
              const req = cd.count || 1;
              const assigned = spaceItems.filter((it) => {
                const r = (it.role || '').toLowerCase();
                return r === cd.role.toLowerCase() || (cd.role.toLowerCase().includes('sound') && r.includes('sound'));
              }).length;
              if (assigned < req) {
                missingDiscs.push(cd.role);
              }
            });
          }

          out += `
            <div class="rounded-xl border ${isRoomUnfilled ? 'border-amber-500/40 bg-panel shadow-2xs' : 'border-line bg-panel shadow-2xs'} overflow-hidden transition">
              <!-- Space Header Bar (Accordion Trigger) -->
              <div class="p-3 bg-panel2/60 hover:bg-panel2/90 border-b border-line/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition">
                <button type="button" data-toggle-space="${ui.esc(spaceName)}" class="flex items-center gap-2.5 min-w-0 text-left group cursor-pointer flex-1">
                  <span class="p-1 rounded text-muted group-hover:text-ink transition shrink-0">
                    ${ui.icon(isCollapsed ? 'chevR' : 'chevDown', 'w-4 h-4')}
                  </span>
                  <span class="w-3 h-3 rounded-full ${spaceColor.dot} shrink-0"></span>
                  <span class="font-bold text-sm text-ink group-hover:text-accent transition truncate" title="${ui.esc(spaceName)}">
                    ${ui.esc(spaceName)}
                  </span>
                  <!-- Baseline Crew Specification tag -->
                  <span class="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-panel border border-line text-muted shrink-0" title="Baseline Minimum Staffing Spec for ${ui.esc(spaceName)}">
                    Min: ${specs.total} (${specs.summary})
                  </span>
                </button>

                <!-- Status Indicators & Actions on Space Row -->
                <div class="flex items-center gap-2 flex-wrap shrink-0 justify-end">
                  ${hasNoTechOnly ? `
                    <span class="text-[11px] font-medium text-muted bg-panel px-2.5 py-0.5 rounded border border-line flex items-center gap-1.5">
                      ${ui.icon('slash', 'w-3 h-3 text-muted')}
                      <span>Self-Service (No Tech Needed)</span>
                    </span>
                  ` : (isRoomUnfilled ? `
                    <span class="text-[11px] font-bold text-rose-300 bg-rose-500/15 border border-rose-500/30 px-2.5 py-0.5 rounded flex items-center gap-1">
                      <span>⚠️ ${unfilledItems.length} Unfilled</span>
                    </span>
                    ${missingDiscs.length > 0 ? `
                      <button type="button" data-add-space-shift-role="${ui.esc(spaceName)}|${ui.esc(missingDiscs[0])}" class="py-1 px-2.5 rounded text-xs font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 flex items-center gap-1 transition shadow-2xs whitespace-nowrap">
                        ${ui.icon('plus', 'w-3 h-3 text-amber-300')}
                        <span>Assign ${missingDiscs[0]}</span>
                      </button>
                    ` : ''}
                  ` : (isRoomFilled ? `
                    <span class="text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 rounded flex items-center gap-1">
                      ${ui.icon('check', 'w-3 h-3 text-emerald-400')}
                      <span>Fully Staffed (${spaceItems.length} shifts)</span>
                    </span>
                  ` : `
                    <span class="text-[11px] text-muted italic">Room Dark</span>
                  `))}

                  <button type="button" data-add-space-shift="${ui.esc(spaceName)}" class="btn btn-ghost text-xs !py-1 !px-2.5 border border-line hover:border-accent hover:text-accent font-semibold flex items-center gap-1 transition shadow-2xs" title="Add shift in ${ui.esc(spaceName)}">
                    ${ui.icon('plus', 'w-3.5 h-3.5')}
                    <span>Add Shift</span>
                  </button>
                  <button type="button" data-add-extra-staff="${ui.esc(spaceName)}" class="btn btn-ghost text-xs !py-1 !px-2.5 border border-accent/40 text-accent font-semibold flex items-center gap-1 hover:bg-accent/10 transition shadow-2xs" title="Add additional staff / extra crew member to ${ui.esc(spaceName)}">
                    ${ui.icon('users', 'w-3.5 h-3.5 text-accent')}
                    <span>+ Additional Tech</span>
                  </button>
                </div>
              </div>

              <!-- Collapsible Content -->
              ${!isCollapsed ? `
                <div class="p-3 space-y-3">
                  <!-- Visual Horizontal Time Span Preview (Desktop) -->
                  ${spaceItems.length > 0 ? `
                    <div class="hidden sm:block p-2 rounded-lg bg-panel2/40 border border-line/60">
                      <div class="relative h-10 w-full rounded bg-panel/80 border border-line/40 overflow-hidden">
                        ${spaceItems.map((it) => {
                          const parseHour = (tStr) => {
                            if (!tStr) return 18;
                            const [hh, mm] = tStr.split(':').map(Number);
                            return (hh || 0) + (mm || 0) / 60;
                          };
                          const startH = parseHour(it.startTime || '17:00');
                          const endH = parseHour(it.finishTime || '23:30');
                          const spanStart = Math.max(8, Math.min(24, startH));
                          const spanEnd = Math.max(spanStart + 0.5, Math.min(24, endH <= startH ? endH + 24 : endH));
                          const leftPct = Math.max(0, Math.min(100, ((spanStart - 8) / 16) * 100));
                          const widthPct = Math.max(4, Math.min(100 - leftPct, ((spanEnd - spanStart) / 16) * 100));

                          let blockBg = it.isNoTech 
                            ? 'bg-slate-700/60 border-slate-600 text-slate-300' 
                            : (it.isUnfilled ? 'bg-amber-500/25 border-amber-500/60 text-amber-300' : 'bg-accent/20 border-accent/60 text-ink');

                          return `
                            <div style="left: ${leftPct}%; width: ${widthPct}%;" data-schedule-item="${it.key}" class="absolute top-1 bottom-1 rounded border px-2 flex items-center justify-between text-[10px] font-medium truncate cursor-pointer hover:brightness-125 transition ${blockBg}" title="${ui.esc(it.eventName)} (${it.startTime} - ${it.finishTime}) · ${ui.esc(it.userName)}">
                              <span class="truncate font-bold">${ui.esc(it.eventName)}</span>
                              <span class="font-mono text-[9px] shrink-0 opacity-80">${it.startTime}–${it.finishTime}</span>
                            </div>
                          `;
                        }).join('')}
                      </div>
                    </div>
                  ` : ''}

                  <!-- Shift Cards in this space -->
                  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    ${spaceItems.length === 0 ? `
                      <div class="col-span-full py-6 text-center text-xs text-muted/60 italic rounded-lg border border-dashed border-line/40 flex flex-col items-center justify-center gap-1.5">
                        <span>No shifts or events scheduled in ${ui.esc(spaceName)} on this date</span>
                        <div class="flex items-center gap-2">
                          <button type="button" data-add-space-shift="${ui.esc(spaceName)}" class="text-xs font-semibold text-accent hover:underline">
                            + Schedule Shift
                          </button>
                          <span>·</span>
                          <button type="button" data-add-extra-staff="${ui.esc(spaceName)}" class="text-xs font-semibold text-accent hover:underline">
                            + Add Tech
                          </button>
                        </div>
                      </div>
                    ` : (spaceItems.map((item) => renderCardHtml(item, spaceName)).join('') + `
                      <div class="rounded-xl border border-dashed border-line/70 hover:border-accent/60 bg-panel/30 hover:bg-panel2/50 p-4 flex flex-col items-center justify-center gap-1.5 cursor-pointer transition text-muted hover:text-ink min-h-[110px] text-center group" data-add-extra-staff="${ui.esc(spaceName)}" title="Add extra staff or additional crew member to ${ui.esc(spaceName)}">
                        <div class="w-6 h-6 rounded-full bg-accent/10 text-accent group-hover:bg-accent/20 flex items-center justify-center transition">
                          ${ui.icon('plus', 'w-3.5 h-3.5')}
                        </div>
                        <span class="text-xs font-semibold text-ink group-hover:text-accent transition">+ Add Staff to ${ui.esc(spaceName)}</span>
                        <span class="text-[10px] text-muted">Additional tech, stagehand or split handover</span>
                      </div>
                    `)}
                  </div>
                </div>
              ` : `
                <!-- Compact Collapsed Summary -->
                <div class="p-2.5 px-4 bg-panel text-xs text-muted flex items-center justify-between cursor-pointer hover:bg-panel2/40 transition" data-toggle-space="${ui.esc(spaceName)}">
                  <div class="flex items-center gap-2">
                    <span class="italic">${spaceItems.length} shift${spaceItems.length === 1 ? '' : 's'} scheduled</span>
                    ${spaceItems.length > 0 ? `
                      <span>·</span>
                      <span class="text-ink font-medium truncate max-w-md">${spaceItems.map(i => i.isNoTech ? 'Self-Service' : (i.userName + (i.role ? ' (' + i.role + ')' : ''))).join(', ')}</span>
                    ` : ''}
                  </div>
                  <span class="text-accent text-[11px] font-semibold hover:underline">Click to expand row</span>
                </div>
              `}
            </div>
          `;
        });

        out += `
          </div>
        `;
      }

      // ----------------------------------------------------------------------
      // SUB-VIEW 1: WEEK GRID (7 DAYS SIDE-BY-SIDE)
      // ----------------------------------------------------------------------
      else if (state.boardView === 'week') {
        // Day Switcher Bar (Mobile & Tablet: filters view; Desktop: scroll/jump indicator)
        out += `
          <div class="flex items-center justify-between gap-2 overflow-x-auto pb-1 scrollbar-hide -mx-2 px-2 sm:mx-0 sm:px-0">
            <div class="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
              <button data-mob-day="all" class="shrink-0 px-3 py-1 text-xs font-semibold rounded-lg border transition ${state.mobileDayFilter === 'all' ? 'bg-accent text-accent-ink border-accent shadow-xs' : 'bg-panel border-line text-muted hover:text-ink'}">
                All 7 Days
              </button>
              ${daysData.map((d) => `
                <button data-mob-day="${d.date}" class="shrink-0 px-2.5 py-1 text-xs font-semibold rounded-lg border transition flex items-center gap-1.5 ${state.mobileDayFilter === d.date ? 'bg-accent text-accent-ink border-accent shadow-xs' : (d.isToday ? 'bg-accent/10 border-accent/40 text-accent font-bold' : 'bg-panel border-line text-muted hover:text-ink')}">
                  <span>${d.dayName} ${d.dayNum}</span>
                  <span class="px-1 py-0.2 rounded text-[10px] font-mono ${d.items.some(i => i.isUnfilled) ? 'bg-rose-500/20 text-rose-300 font-bold' : 'bg-panel2/80 text-muted'}">${d.items.length}</span>
                </button>
              `).join('')}
            </div>

            <!-- Scroll helper cue on medium/desktop viewports -->
            <div class="hidden lg:flex items-center gap-1 text-[11px] text-muted shrink-0 pl-2">
              <span>Scroll horizontally to view all days</span>
              ${ui.icon('chevR', 'w-3.5 h-3.5 opacity-60')}
            </div>
          </div>
        `;

        out += `
          <!-- 7-Day Matrix Columns with Desktop Horizontal Safety & Scroll Containment -->
          <div class="w-full overflow-x-auto pb-6 scrollbar-thin rounded-xl">
            <div class="grid grid-cols-1 md:grid-cols-7 gap-3.5 items-start min-w-full md:min-w-[1720px]">
        `;

        daysData.forEach((day) => {
          // If on mobile and a specific day is selected, hide other days
          const isHiddenOnMobile = state.mobileDayFilter !== 'all' && state.mobileDayFilter !== day.date;
          const unfilledCount = day.items.filter((i) => i.isUnfilled).length;

          out += `
            <div id="day-col-${day.date}" class="rounded-xl border ${day.isToday ? 'border-accent/60 bg-panel2/40 ring-1 ring-accent/30' : 'border-line bg-panel'} p-3 flex flex-col gap-2.5 min-w-[240px] min-h-[140px] md:min-h-[480px] ${isHiddenOnMobile ? 'hidden md:flex' : ''} shadow-2xs">
              <!-- Day Column Header (Pinned for Glanceability) -->
              <div class="sticky top-0 ${day.isToday ? 'bg-panel2/95' : 'bg-panel/95'} backdrop-blur-xs z-10 flex items-center justify-between pb-2 border-b border-line/60">
                <button data-jump-day="${day.date}" class="text-left group cursor-pointer min-w-0" title="Zoom into Day Room Swimlanes">
                  <div class="flex items-center gap-1.5">
                    <span class="text-xs font-bold uppercase tracking-wider ${day.isToday ? 'text-accent' : 'text-ink group-hover:text-accent transition'}">${day.dayName}</span>
                    <span class="text-xs font-mono font-semibold ${day.isToday ? 'text-accent font-bold' : 'text-muted'}">${day.dayNum} ${day.monthName}</span>
                  </div>
                  <div class="text-[10px] text-muted flex items-center gap-1 mt-0.5">
                    <span class="px-1.5 py-0.2 rounded bg-panel2 border border-line/70 font-mono font-semibold text-ink">${day.items.length} shift${day.items.length === 1 ? '' : 's'}</span>
                    ${unfilledCount > 0 ? `<span class="text-rose-400 font-bold">· ${unfilledCount} unfilled</span>` : ''}
                  </div>
                </button>
                <div class="flex items-center gap-1 shrink-0">
                  <button data-jump-day="${day.date}" class="p-1 rounded text-muted hover:text-accent hover:bg-panel2 transition" title="View Day Swimlanes">
                    ${ui.icon('grid', 'w-3 h-3')}
                  </button>
                  <button data-quick-add-date="${day.date}" class="p-1 rounded text-muted hover:text-accent hover:bg-panel2 transition" title="Add shift on ${day.date}">
                    ${ui.icon('plus', 'w-3.5 h-3.5')}
                  </button>
                </div>
              </div>

              <!-- Shifts List for Day (Glanceable and unclipped so all events render completely) -->
              <div class="space-y-2 flex-1 min-h-[300px]">
          `;

          if (day.items.length === 0) {
            out += `
              <div class="py-12 px-2 text-center text-[11px] text-muted/60 italic rounded-lg border border-dashed border-line/40 flex flex-col items-center justify-center gap-1.5">
                <span>No shifts scheduled</span>
                <button data-quick-add-date="${day.date}" class="text-[10px] font-semibold text-accent hover:underline">
                  + Add Shift
                </button>
              </div>
            `;
          } else {
            day.items.forEach((item) => {
              out += renderCardHtml(item);
            });
          }

          out += `
              </div>
            </div>
          `;
        });

        out += `
            </div>
          </div>
        `;
      }

      // ----------------------------------------------------------------------
      // SUB-VIEW 2: DAY VIEW (ROOM-BY-ROOM SWIMLANES ACROSS SPACES)
      // ----------------------------------------------------------------------
      else if (state.boardView === 'day') {
        const selDayStr = state.selectedDay || weekDays[0].date;
        const selDayObj = parseDate(selDayStr);
        const selDayFormatted = selDayObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const daySchedule = getDaySchedule(selDayStr);

        // Calculate previous and next day
        const prevDayObj = new Date(selDayObj);
        prevDayObj.setDate(prevDayObj.getDate() - 1);
        const prevDayStr = formatDate(prevDayObj);

        const nextDayObj = new Date(selDayObj);
        nextDayObj.setDate(nextDayObj.getDate() + 1);
        const nextDayStr = formatDate(nextDayObj);

        // Gather visible venue spaces to show as columns (Core Spaces by default)
        const activeSpaces = Array.from(new Set([...getVisibleSpacesList(), ...daySchedule.flatMap((i) => i.spaces || [i.space])])).filter((sp) => sp && isSpaceAllowed(sp));

        out += `
          <!-- Day Navigator Bar -->
          <div class="p-3 rounded-xl bg-panel border border-line flex flex-col sm:flex-row items-center justify-between gap-3">
            <div class="flex items-center gap-2 flex-wrap">
              <button data-set-day="${prevDayStr}" class="btn btn-ghost !p-2" title="Previous Day">
                ${ui.icon('chevL', 'w-4 h-4')}
              </button>
              <button data-set-day="${formatDate(new Date())}" class="btn btn-ghost text-xs">
                Today
              </button>
              <button data-set-day="${nextDayStr}" class="btn btn-ghost !p-2" title="Next Day">
                ${ui.icon('chevR', 'w-4 h-4')}
              </button>
              <span class="text-sm font-bold text-ink px-2">
                ${selDayFormatted}
              </span>
              <span class="text-xs text-muted font-mono font-semibold px-2 py-0.5 rounded bg-panel2 border border-line">${daySchedule.length} total shifts across venue</span>
            </div>

            <!-- Week Day Quick Selector Strip -->
            <div class="flex items-center gap-1 overflow-x-auto scrollbar-hide pb-0.5">
              ${weekDays.map((d) => {
                const dayCount = getDaySchedule(d.date).length;
                return `
                  <button data-set-day="${d.date}" class="px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition flex items-center gap-1.5 ${d.date === selDayStr ? 'bg-accent text-accent-ink border-accent font-bold' : (d.isToday ? 'bg-panel2 text-accent border-accent/40' : 'bg-panel border-line text-muted hover:text-ink')}">
                    <span>${d.dayName} ${d.dayNum}</span>
                    ${dayCount > 0 ? `<span class="px-1 py-0.2 rounded text-[9px] font-mono bg-panel2/80">${dayCount}</span>` : ''}
                  </button>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Room-by-Room Swimlanes across All Spaces -->
          <div class="overflow-x-auto scrollbar-thin pb-4 rounded-xl">
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7 gap-3.5 items-start min-w-full md:min-w-[1680px]">
        `;

        activeSpaces.forEach((spaceName) => {
          const spaceColor = getSpaceColor(spaceName);
          const spaceItems = daySchedule.filter((i) => i.space === spaceName || (i.spaces && i.spaces.includes(spaceName)));
          const specs = RMTP.getSpaceCrewSpecs ? RMTP.getSpaceCrewSpecs(spaceName) : { total: getSpaceBasicCrew(spaceName), disciplines: [], summary: '' };

          out += `
            <div class="rounded-xl border border-line bg-panel p-3 flex flex-col gap-2.5 min-w-[240px] min-h-[320px] shadow-2xs">
              <!-- Room Header with Minimum Crew & Disciplines -->
              <div class="flex flex-col gap-1.5 pb-2 border-b border-line/60">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="w-2.5 h-2.5 rounded-full ${spaceColor.dot} shrink-0"></span>
                    <span class="font-bold text-xs text-ink truncate" title="${ui.esc(spaceName)}">${ui.esc(spaceName)}</span>
                  </div>
                  <button data-add-space-shift="${ui.esc(spaceName)}" class="p-1 rounded text-muted hover:text-accent hover:bg-panel2 transition" title="Add shift in ${ui.esc(spaceName)}">
                    ${ui.icon('plus', 'w-3.5 h-3.5')}
                  </button>
                </div>
                <div class="flex items-center justify-between gap-1 text-[10px]">
                  <span class="text-muted font-mono font-semibold">${spaceItems.length} shift${spaceItems.length === 1 ? '' : 's'}</span>
                  <span class="font-bold px-1.5 py-0.2 rounded bg-panel2 border border-line text-accent font-mono text-[9.5px]" title="${ui.esc(spaceName)} staffing requirement: ${ui.esc(specs.summary)}">
                    Min: ${specs.total} (${specs.disciplines.map(d => d.role).join(', ')})
                  </span>
                </div>
              </div>

              <!-- Shifts in this Room -->
              <div class="space-y-2 flex-1 min-h-[280px] pr-0.5">
          `;

          if (spaceItems.length === 0) {
            out += `
              <div class="py-12 px-2 text-center text-xs text-muted/50 italic rounded-lg border border-dashed border-line/30 flex flex-col items-center justify-center gap-1.5">
                <span>Room Dark / No shifts</span>
                <button data-add-space-shift="${ui.esc(spaceName)}" class="text-[10px] font-semibold text-accent hover:underline">
                  + Schedule Shift
                </button>
              </div>
            `;
          } else {
            spaceItems.forEach((item) => {
              out += renderCardHtml(item, spaceName);
            });
          }

          out += `
              </div>
            </div>
          `;
        });

        out += `
            </div>
          </div>
        `;
      }

      // ----------------------------------------------------------------------
      // SUB-VIEW 3: TIMELINE AGENDA VIEW
      // ----------------------------------------------------------------------
      else if (state.boardView === 'agenda') {
        const totalItemsCount = daysData.reduce((acc, d) => acc + d.items.length, 0);

        out += `
          <div class="border border-line rounded-xl bg-panel overflow-hidden">
            <div class="p-3 bg-panel2/60 border-b border-line text-xs font-semibold text-ink flex items-center justify-between">
              <span>Chronological Run of Shifts (${startD} – ${endD})</span>
              <span class="text-muted font-mono">${totalItemsCount} Total Shifts</span>
            </div>
            <div class="divide-y divide-line/60">
        `;

        if (totalItemsCount === 0) {
          out += `
            <div class="p-8 text-center text-xs text-muted italic">
              No shifts match the current view and filter selection.
            </div>
          `;
        }

        daysData.forEach((day) => {
          if (day.items.length === 0) return;

          out += `
            <div class="p-3.5 ${day.isToday ? 'bg-accent/5' : ''}">
              <div class="flex items-center gap-2 mb-2">
                <span class="text-xs font-bold uppercase tracking-wider ${day.isToday ? 'text-accent' : 'text-ink'}">${day.dayName} ${day.dayNum} ${day.monthName}</span>
                <span class="text-[10px] text-muted font-mono font-semibold px-2 py-0.2 rounded bg-panel2 border border-line">${day.items.length} shift${day.items.length === 1 ? '' : 's'}</span>
              </div>
              <div class="space-y-1.5">
          `;

          day.items.forEach((item) => {
            const spaceCls = getSpaceColor(item.space);
            const statusMeta = getStatusMeta(item.status, item.isUnfilled);

            out += `
              <div data-schedule-item="${item.key}" class="p-2.5 rounded-lg border border-l-[3.5px] ${spaceCls.bar} border-line bg-panel hover:bg-panel2 transition flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer group">
                <div class="flex items-center gap-3 min-w-0">
                  <span class="font-mono text-xs font-semibold text-ink shrink-0 whitespace-nowrap tabular-nums px-2 py-0.5 rounded bg-panel2 border border-line/60">${item.startTime} – ${item.finishTime}</span>
                  <span class="font-bold px-2 py-0.5 rounded border uppercase tracking-wider text-[10px] ${spaceCls.tag} shrink-0">${ui.esc(item.space)}</span>
                  <span class="text-xs font-bold text-ink truncate group-hover:text-accent transition">${ui.esc(item.eventName)}</span>
                </div>
                <div class="flex items-center gap-3 shrink-0 text-xs">
                  <span class="font-medium ${item.isUnfilled ? 'text-amber-400 font-semibold' : 'text-ink'}">${item.isUnfilled ? '+ Assign Freelancer' : ui.esc(item.userName)}</span>
                  ${item.role ? `<span class="text-[10px] text-muted px-1.5 py-0.2 rounded bg-panel2 border border-line font-mono">${ui.esc(item.role)}</span>` : ''}
                  <span class="flex items-center gap-1.5 text-[11px] font-semibold ${statusMeta.textCls}">
                    <span class="w-1.5 h-1.5 rounded-full ${statusMeta.dot}"></span>
                    <span>${statusMeta.label}</span>
                  </span>
                </div>
              </div>
            `;
          });

          out += `
              </div>
            </div>
          `;
        });

        out += `
            </div>
          </div>
        `;
      }

      out += `</div>`; // end space-y-3

      tabContainer.innerHTML = out;
      wireBoardEvents();
    }

    function wireBoardEvents() {
      // Week Navigator
      tabContainer.querySelector('#week-prev')?.addEventListener('click', () => {
        state.weekOffset -= 1;
        if (state.selectedDay) {
          const d = parseDate(state.selectedDay);
          d.setDate(d.getDate() - 7);
          state.selectedDay = formatDate(d);
        }
        renderBoardTab();
        updateTopMetrics();
      });
      tabContainer.querySelector('#week-next')?.addEventListener('click', () => {
        state.weekOffset += 1;
        if (state.selectedDay) {
          const d = parseDate(state.selectedDay);
          d.setDate(d.getDate() + 7);
          state.selectedDay = formatDate(d);
        }
        renderBoardTab();
        updateTopMetrics();
      });
      tabContainer.querySelector('#week-today')?.addEventListener('click', () => {
        state.weekOffset = 0;
        state.selectedDay = formatDate(new Date());
        renderBoardTab();
        updateTopMetrics();
      });

      // Month View Navigator
      tabContainer.querySelector('#month-board-prev')?.addEventListener('click', () => {
        const [y, m] = (state.rotaMonth || state.availMonth || formatDate(new Date()).slice(0, 7)).split('-').map(Number);
        const prevDate = new Date(y, m - 2, 1);
        state.rotaMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
        renderBoardTab();
        updateTopMetrics();
      });
      tabContainer.querySelector('#month-board-next')?.addEventListener('click', () => {
        const [y, m] = (state.rotaMonth || state.availMonth || formatDate(new Date()).slice(0, 7)).split('-').map(Number);
        const nextDate = new Date(y, m, 1);
        state.rotaMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
        renderBoardTab();
        updateTopMetrics();
      });
      tabContainer.querySelector('#month-board-today')?.addEventListener('click', () => {
        const now = new Date();
        state.rotaMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        renderBoardTab();
        updateTopMetrics();
      });
      tabContainer.querySelector('#month-board-next-month')?.addEventListener('click', () => {
        const now = new Date();
        const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        state.rotaMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
        renderBoardTab();
        updateTopMetrics();
      });

      // View Mode Switcher
      tabContainer.querySelector('#view-mode-month')?.addEventListener('click', () => {
        state.boardView = 'month';
        renderBoardTab();
      });
      tabContainer.querySelector('#view-mode-timeline')?.addEventListener('click', () => {
        state.boardView = 'timeline';
        renderBoardTab();
      });
      tabContainer.querySelector('#view-mode-week')?.addEventListener('click', () => {
        state.boardView = 'week';
        renderBoardTab();
      });
      tabContainer.querySelector('#view-mode-day')?.addEventListener('click', () => {
        state.boardView = 'day';
        renderBoardTab();
      });
      tabContainer.querySelector('#view-mode-agenda')?.addEventListener('click', () => {
        state.boardView = 'agenda';
        renderBoardTab();
      });

      // Search Bar in Board View
      tabContainer.querySelector('#flt-search')?.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        renderBoardTab();
      });

      // Month View Calendar Cells & Chips
      tabContainer.querySelectorAll('[data-cell-day]').forEach((cell) => {
        cell.addEventListener('click', () => {
          const dStr = cell.getAttribute('data-cell-day');
          openDayScheduleModal(dStr);
        });
      });
      tabContainer.querySelectorAll('[data-click-booking]').forEach((chip) => {
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          e.stopImmediatePropagation();
          const bid = chip.getAttribute('data-click-booking');
          const b = bid ? getAllBookingsRaw().find((x) => x.id === bid) : null;
          if (b) {
            openShiftDetailModal(b);
            return;
          }
          const key = chip.getAttribute('data-schedule-item');
          const item = key ? allScheduleItemsMap.get(key) : null;
          if (!item) return;
          if (item.type === 'booking' && item.booking) {
            openShiftDetailModal(item.booking);
          } else if (isTechManager || isAdmin) {
            const targetSpace = item.type === 'takeover'
              ? normalizeSpace((item.unfilledSpaces && item.unfilledSpaces[0]) || (item.spaces && item.spaces[0]) || 'The Stage')
              : normalizeSpace(item.space || 'The Stage');
            openBookingModal({
              eventId: item.type === 'takeover' ? resolveTakeoverEventId(item, targetSpace) : item.eventId,
              eventName: item.eventName,
              space: targetSpace,
              date: normalizeDate(item.date),
              startTime: normalizeTime(item.startTime, '17:00'),
              finishTime: normalizeTime(item.finishTime, '23:30'),
              userId: item.userId || '',
              userName: item.userName || '',
              role: item.role || 'Sound',
              status: item.status || 'pencil',
            });
          } else {
            openShiftDetailModal(item);
          }
        });
      });
      tabContainer.querySelectorAll('[data-click-unfilled]').forEach((chip) => {
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          const key = chip.getAttribute('data-click-unfilled');
          const item = allScheduleItemsMap.get(key);
          if (item) {
            const targetSpace = item.type === 'takeover'
              ? normalizeSpace((item.unfilledSpaces && item.unfilledSpaces[0]) || (item.spaces && item.spaces[0]) || 'The Stage')
              : normalizeSpace(item.space || 'The Stage');
            openBookingModal({
              id: (item.type === 'booking' && item.booking && item.booking.id) ? item.booking.id : undefined,
              eventId: item.type === 'takeover' ? resolveTakeoverEventId(item, targetSpace) : item.eventId,
              eventName: item.eventName,
              space: targetSpace,
              date: normalizeDate(item.date),
              startTime: normalizeTime(item.startTime, '17:00'),
              finishTime: normalizeTime(item.finishTime, '23:30'),
              role: item.role || 'Sound',
              status: 'pencil',
            });
          }
        });
      });

      // Density Switcher
      tabContainer.querySelector('#density-compact')?.addEventListener('click', () => {
        state.density = 'compact';
        renderBoardTab();
      });
      tabContainer.querySelector('#density-detailed')?.addEventListener('click', () => {
        state.density = 'detailed';
        renderBoardTab();
      });

      // Day Switcher (Syncs weekOffset with target date)
      tabContainer.querySelectorAll('[data-set-day]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const targetDayStr = btn.getAttribute('data-set-day');
          state.selectedDay = targetDayStr;
          state.weekOffset = getWeekOffsetForDate(targetDayStr);
          if (state.boardView !== 'timeline') {
            state.boardView = 'day';
          }
          renderBoardTab();
          updateTopMetrics();
        });
      });

      // Timeline View: Toggle Collapsible Space Row
      tabContainer.querySelectorAll('[data-toggle-space]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const sp = btn.getAttribute('data-toggle-space');
          if (state.collapsedSpaces.has(sp)) {
            state.collapsedSpaces.delete(sp);
          } else {
            state.collapsedSpaces.add(sp);
          }
          renderBoardTab();
        });
      });

      // Expand All / Collapse All Spaces
      tabContainer.querySelector('#btn-expand-all-spaces')?.addEventListener('click', () => {
        state.collapsedSpaces.clear();
        renderBoardTab();
      });
      tabContainer.querySelector('#btn-collapse-all-spaces')?.addEventListener('click', () => {
        getVisibleSpacesList().forEach((s) => state.collapsedSpaces.add(s));
        renderBoardTab();
      });

      // 1-Click Sync Advancing Shifts for current selected day
      tabContainer.querySelector('#btn-sync-advancing-rota')?.addEventListener('click', () => {
        const targetDay = normalizeDate(state.selectedDay) || formatDate(new Date());
        const dayEvents = (store.all('advancing') || []).filter((e) => {
          if (e.deleted || normalizeDate(e.date) !== targetDay) return false;
          const st = String(e.status || '').trim().toLowerCase();
          if (st === 'cancelled' || st === 'canceled') return false;
          if (!state.showNonCoreSpaces && !isSpaceAllowed(e.space)) return false;
          return true;
        });
        let count = 0;
        dayEvents.forEach((ev) => {
          const created = RMTP.syncAdvancingToRota ? RMTP.syncAdvancingToRota(ev) : [];
          count += created.length;
        });
        ui.toast(`Synced ${count} shift slot(s) for ${dayEvents.length} event(s) on ${targetDay}!`, 'ok');
        renderBoardTab();
        updateTopMetrics();
      });

      // Quick add shift in space with preselected role
      tabContainer.querySelectorAll('[data-add-space-shift-role]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const raw = btn.getAttribute('data-add-space-shift-role');
          const [sp, role] = raw.split('|');
          openBookingModal({ space: sp, role: role || 'Sound', date: state.selectedDay || formatDate(new Date()), startTime: '17:00', finishTime: '23:30', status: 'pencil' });
        });
      });

      // Jump to Day View by clicking Day Header in Week Grid
      tabContainer.querySelectorAll('[data-jump-day]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const targetDayStr = btn.getAttribute('data-jump-day');
          state.selectedDay = targetDayStr;
          state.weekOffset = getWeekOffsetForDate(targetDayStr);
          state.boardView = 'day';
          renderBoardTab();
          updateTopMetrics();
        });
      });

      // Mobile Day Filter
      tabContainer.querySelectorAll('[data-mob-day]').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.mobileDayFilter = btn.getAttribute('data-mob-day');
          renderBoardTab();
        });
      });

      // Quick Status Chips
      tabContainer.querySelectorAll('[data-quick-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const val = btn.getAttribute('data-quick-filter');
          if (val === 'unfilled') {
            state.unfilledOnly = true;
            state.statusFilter = '';
          } else {
            state.unfilledOnly = false;
            state.statusFilter = val;
          }
          renderBoardTab();
          updateTopMetrics();
        });
      });

      // Dropdown Filters
      tabContainer.querySelector('#flt-space')?.addEventListener('change', (e) => {
        state.spaceFilter = e.target.value;
        renderBoardTab();
        updateTopMetrics();
      });
      tabContainer.querySelector('#flt-role')?.addEventListener('change', (e) => {
        state.roleFilter = e.target.value;
        renderBoardTab();
        updateTopMetrics();
      });
      tabContainer.querySelector('#flt-tech')?.addEventListener('change', (e) => {
        state.techFilter = e.target.value;
        renderBoardTab();
        updateTopMetrics();
      });
      // Non-Core Spaces Toggle (Core Spaces Only by default)
      tabContainer.querySelector('#flt-toggle-noncore')?.addEventListener('click', () => {
        state.showNonCoreSpaces = !state.showNonCoreSpaces;
        if (!state.showNonCoreSpaces && state.spaceFilter && !isSpaceAllowed(state.spaceFilter)) {
          state.spaceFilter = '';
        }
        renderBoardTab();
        updateTopMetrics();
      });
      // Event Scope Toggles
      tabContainer.querySelector('#flt-events-all')?.addEventListener('click', () => {
        state.eventsFilter = 'all';
        renderBoardTab();
      });
      tabContainer.querySelector('#flt-events-staffed')?.addEventListener('click', () => {
        state.eventsFilter = 'staffed';
        renderBoardTab();
      });
      tabContainer.querySelector('#flt-clear')?.addEventListener('click', () => {
        state.spaceFilter = '';
        state.roleFilter = '';
        state.statusFilter = '';
        state.techFilter = '';
        state.unfilledOnly = false;
        state.showNonCoreSpaces = false;
        state.eventsFilter = 'all';
        state.searchQuery = '';
        renderBoardTab();
        updateTopMetrics();
      });

      // Quick add shift in date
      tabContainer.querySelectorAll('[data-quick-add-date]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const d = btn.getAttribute('data-quick-add-date');
          openBookingModal({ date: d, startTime: '17:00', finishTime: '23:30', status: 'pencil' });
        });
      });

      // Quick add shift in space (from Day View)
      tabContainer.querySelectorAll('[data-add-space-shift]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const sp = btn.getAttribute('data-add-space-shift');
          const specs = RMTP.getSpaceCrewSpecs ? RMTP.getSpaceCrewSpecs(sp) : null;
          const defaultRole = (specs && specs.rolesList && specs.rolesList.length) ? specs.rolesList[0] : 'Sound';
          openBookingModal({ space: sp, role: defaultRole, date: state.selectedDay || formatDate(new Date()), startTime: '17:00', finishTime: '23:30', status: 'pencil' });
        });
      });

      // 1-Click Status Toggle on Shift Cards
      tabContainer.querySelectorAll('[data-quick-toggle-status]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-quick-toggle-status');
          const b = store.find('bookings', id);
          if (b) {
            const nextStatus = b.status === 'confirmed' ? 'pencil' : 'confirmed';
            b.status = nextStatus;
            if (nextStatus === 'confirmed') b.confirmedAt = new Date().toISOString();
            b.updatedAt = new Date().toISOString();
            store.upsert('bookings', b);
            if (b.eventId && RMTP.syncRotaToAdvancing) {
              RMTP.syncRotaToAdvancing(b.eventId);
            }
            ui.toast(`Shift status updated to ${nextStatus === 'confirmed' ? 'Confirmed' : 'Pencil Hold'}`, 'ok');
            renderActiveTab();
          }
        });
      });

      // 1-Click Assign Freelancer button on Unfilled Shifts
      tabContainer.querySelectorAll('[data-assign-shift]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const key = btn.getAttribute('data-assign-shift');
          const item = allScheduleItemsMap.get(key);
          if (item) {
            const targetSpace = item.type === 'takeover'
              ? normalizeSpace((item.unfilledSpaces && item.unfilledSpaces[0]) || (item.spaces && item.spaces[0]) || 'The Stage')
              : normalizeSpace(item.space || 'The Stage');
            openBookingModal({
              id: (item.type === 'booking' && item.booking && item.booking.id) ? item.booking.id : undefined,
              eventId: item.type === 'takeover' ? resolveTakeoverEventId(item, targetSpace) : item.eventId,
              eventName: item.eventName,
              space: targetSpace,
              date: normalizeDate(item.date),
              startTime: normalizeTime(item.startTime, '17:00'),
              finishTime: normalizeTime(item.finishTime, '23:30'),
              role: item.role || 'Sound',
              status: 'pencil',
            });
          }
        });
      });

      // 1-Click Assign Crew directly to specific room in a Multi-Room Takeover
      tabContainer.querySelectorAll('[data-assign-space-crew]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const raw = btn.getAttribute('data-assign-space-crew');
          const [key, spaceName, roleHint] = raw.split('|');
          const item = allScheduleItemsMap.get(key);
          if (item) {
            const targetSpace = normalizeSpace(spaceName || (item.spaces ? item.spaces[0] : 'The Stage'));
            const specs = RMTP.getSpaceCrewSpecs ? RMTP.getSpaceCrewSpecs(targetSpace) : null;
            const targetRole = roleHint || (specs && specs.rolesList && specs.rolesList.length ? specs.rolesList[0] : 'Sound');
            openBookingModal({
              eventId: resolveTakeoverEventId(item, targetSpace),
              eventName: item.eventName,
              space: targetSpace,
              date: normalizeDate(item.date),
              startTime: normalizeTime(item.startTime, '17:00'),
              finishTime: normalizeTime(item.finishTime, '23:30'),
              role: targetRole,
              status: 'pencil',
            });
          }
        });
      });

      // Card Click Handler: Opens booking/shift modal for instant view, edit or assign
      tabContainer.querySelectorAll('[data-schedule-item]').forEach((card) => {
        if (card.hasAttribute('data-click-booking')) return;
        card.addEventListener('click', (e) => {
          // If clicked a button inside card, don't trigger modal
          if (e.target.closest('button')) return;
          const key = card.getAttribute('data-schedule-item');
          const item = allScheduleItemsMap.get(key);
          if (!item) return;

          if (item.type === 'takeover') {
            const targetSpace = normalizeSpace((item.unfilledSpaces && item.unfilledSpaces.length > 0) ? item.unfilledSpaces[0] : (item.spaces ? item.spaces[0] : 'The Stage'));
            openBookingModal({
              eventId: resolveTakeoverEventId(item, targetSpace),
              eventName: item.eventName,
              space: targetSpace,
              date: normalizeDate(item.date),
              startTime: normalizeTime(item.startTime, '17:00'),
              finishTime: normalizeTime(item.finishTime, '23:30'),
              role: 'Sound',
              status: 'pencil',
            });
          } else if (item.type === 'booking') {
            openBookingModal(item.booking);
          } else if (item.type === 'unfilled') {
            openBookingModal({
              eventId: item.eventId,
              eventName: item.eventName,
              space: normalizeSpace(item.space || 'The Stage'),
              date: normalizeDate(item.date),
              startTime: normalizeTime(item.startTime, '17:00'),
              finishTime: normalizeTime(item.finishTime, '23:30'),
              role: item.role || 'Sound',
              status: 'pencil',
            });
          } else if (item.type === 'adv_tech') {
            openBookingModal({
              eventId: item.eventId,
              eventName: item.eventName,
              space: normalizeSpace(item.space || 'The Stage'),
              date: normalizeDate(item.date),
              startTime: normalizeTime(item.startTime, '17:00'),
              finishTime: normalizeTime(item.finishTime, '23:30'),
              userId: item.userId,
              userName: item.userName,
              role: item.role,
              status: item.status,
            });
          }
        });
      });

      // Split Shift Action (Direct 1-Click trigger from Card)
      tabContainer.querySelectorAll('[data-split-shift]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const key = btn.getAttribute('data-split-shift');
          const item = allScheduleItemsMap.get(key);
          if (item) {
            openSplitShiftModal(item.booking || item);
          }
        });
      });

      // Quick Add Extra Staff / Additional Tech to Space
      tabContainer.querySelectorAll('[data-add-extra-staff]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const sp = btn.getAttribute('data-add-extra-staff');
          const specs = RMTP.getSpaceCrewSpecs ? RMTP.getSpaceCrewSpecs(sp) : null;
          const defaultRole = (specs && specs.rolesList && specs.rolesList.length) ? specs.rolesList[0] : 'Sound';
          openBookingModal({
            space: sp,
            role: defaultRole,
            date: state.selectedDay || formatDate(new Date()),
            startTime: '17:00',
            finishTime: '23:30',
            status: 'pencil',
            notes: 'Additional Staff',
          });
        });
      });
    }

    // ------------------------------------------------------------------------
    // TAB 2: MY AVAILABILITY & SHIFTS
    // ------------------------------------------------------------------------
    function renderMyAvailTab() {
      const allUsers = getAllUsers();
      const selectedUserId = state.selectedUserForAvail || (me ? me.id : 'user-3');
      const targetUser = allUsers.find((u) => u.id === selectedUserId) || me;
      const targetName = targetUser ? auth.displayName(targetUser) : 'Technician';
      const targetTags = targetUser ? getTechTags(targetUser) : [];

      // Month calculation
      const [yStr, mStr] = state.availMonth.split('-');
      const year = parseInt(yStr, 10);
      const month = parseInt(mStr, 10) - 1; // 0-indexed
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const daysInMonth = lastDay.getDate();
      const startingDayOfWeek = (firstDay.getDay() + 6) % 7; // Monday = 0

      // Month availability and bookings for this user
      const userAvails = getAllAvailability().filter((a) => a.userId === selectedUserId);
      const userBookings = getAllBookingsRaw().filter((b) => b.userId === selectedUserId && b.status !== 'cancelled' && b.status !== 'declined');

      const monthName = firstDay.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      const now = new Date();
      const nextMonthFirst = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const nextMonthName = nextMonthFirst.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      const nextMonthKey = `${nextMonthFirst.getFullYear()}-${String(nextMonthFirst.getMonth() + 1).padStart(2, '0')}`;

      const multiMode = !!state.availMultiSelectMode;
      const selectedSet = new Set(Array.isArray(state.selectedAvailDates) ? state.selectedAvailDates : []);
      const selectedCount = selectedSet.size;
      const batchDayPart = state.availBatchDayPart || 'all_day';

      let out = `
        <div class="space-y-4">
          <!-- Calendar Availability Guidance Banner -->
          <div class="p-3.5 rounded-xl bg-accent/10 border border-accent/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <span class="w-9 h-9 rounded-xl bg-accent/20 text-accent font-bold flex items-center justify-center shrink-0">
                ${ui.icon('calendar', 'w-5 h-5')}
              </span>
              <div>
                <div class="text-xs font-bold text-ink flex items-center gap-2 flex-wrap">
                  <span>Freelancer Availability Calendar · ${monthName}</span>
                </div>
                <div class="text-[11px] text-muted mt-0.5">
                  ${multiMode
                    ? 'Multi-select active: click dates (or Shift-click a range), then mark all selected dates Available, Unavailable, or Clear below.'
                    : 'Click any day to set availability, or toggle <strong class="text-ink">Select Multiple Dates</strong> (or Shift-click) to update several dates at once.'}
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <button type="button" id="btn-toggle-multi-avail" class="btn ${multiMode ? 'btn-primary' : 'btn-ghost border border-accent/40 text-accent hover:bg-accent/10'} text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap">
                ${ui.icon('check', 'w-3.5 h-3.5')}
                <span>${multiMode ? 'Done Multi-Select' : 'Select Multiple Dates'}</span>
              </button>
              <button type="button" id="btn-avail-add-today" class="btn btn-ghost border border-line text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap">
                ${ui.icon('plus', 'w-3.5 h-3.5')}
                <span>Today</span>
              </button>
              <button type="button" id="btn-jump-next-month" class="btn btn-ghost text-xs whitespace-nowrap">
                ${nextMonthName} →
              </button>
            </div>
          </div>

          <!-- User Switcher & Month Navigation -->
          <div class="p-3.5 rounded-xl bg-panel border border-line flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <span class="w-9 h-9 rounded-xl bg-accent/20 text-accent font-bold flex items-center justify-center shrink-0">
                ${(targetName[0] || 'T').toUpperCase()}
              </span>
              <div>
                <div class="text-xs font-bold text-ink flex items-center gap-2 flex-wrap">
                  <span>${ui.esc(targetName)}</span>
                  ${targetUser && targetUser.position ? `<span class="text-[11px] font-normal text-muted">${ui.esc(targetUser.position)}</span>` : ''}
                  ${targetTags.length ? `<span class="text-[11px] font-mono text-accent/90 font-normal">${targetTags.map(ui.esc).join(' · ')}</span>` : ''}
                </div>
                <div class="text-[11px] text-muted mt-0.5 font-mono tabular-nums">
                  ${userAvails.length} availability date(s) logged · ${userBookings.length} upcoming venue shift(s)
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2 flex-wrap">
              ${isTechManager ? `
                <div class="flex items-center gap-1.5 text-xs">
                  <span class="text-muted">Tech:</span>
                  <select id="avail-user-select" class="field !py-1 text-xs">
                    ${allUsers.map((u) => `<option value="${u.id}" ${u.id === selectedUserId ? 'selected' : ''}>${ui.esc(auth.displayName(u))} (${ui.esc(u.position || 'Tech')})</option>`).join('')}
                  </select>
                </div>
              ` : ''}

              <!-- Month Jump -->
              <div class="flex items-center gap-1 border-l border-line pl-2">
                <button id="month-prev" class="btn btn-ghost !p-1.5" title="Previous Month">
                  ${ui.icon('chevL', 'w-4 h-4')}
                </button>
                <span class="text-xs font-bold text-ink px-2 font-mono">${monthName}</span>
                <button id="month-next" class="btn btn-ghost !p-1.5" title="Next Month">
                  ${ui.icon('chevR', 'w-4 h-4')}
                </button>
              </div>
            </div>
          </div>

          <!-- Calendar Grid & Upcoming Shifts Split -->
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <!-- 2-cols: Month Calendar Grid -->
            <div class="lg:col-span-2 p-4 rounded-xl bg-panel border border-line space-y-3">
              <div class="flex items-center justify-between pb-2 border-b border-line/60 flex-wrap gap-2">
                <div class="text-xs font-semibold text-ink flex items-center gap-2">
                  <span>Availability Calendar</span>
                  <span class="text-[11px] text-muted hidden sm:inline">
                    ${multiMode ? '(Click dates to toggle · Shift-click for range)' : '(Click any date or toggle Select Multiple Dates)'}
                  </span>
                </div>
                <div class="flex items-center gap-2.5 text-[11px] flex-wrap">
                  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-emerald-400"></span> Available</span>
                  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-rose-400"></span> Unavailable</span>
                  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-amber-400"></span> Booked Shift</span>
                </div>
              </div>

              ${multiMode ? `
                <!-- Multi-Select Batch Action Bar -->
                <div class="p-3 rounded-lg bg-panel2/70 border border-accent/40 space-y-2.5">
                  <div class="flex items-center justify-between gap-2 flex-wrap">
                    <div class="flex items-center gap-2 text-xs">
                      <span class="font-mono tabular-nums font-bold text-accent">${selectedCount} ${selectedCount === 1 ? 'date' : 'dates'} selected</span>
                      <span class="text-line" aria-hidden="true">|</span>
                      <button type="button" id="batch-select-empty" class="text-[11px] text-muted hover:text-ink underline cursor-pointer">Select Empty in Month</button>
                      <button type="button" id="batch-select-weekends" class="text-[11px] text-muted hover:text-ink underline cursor-pointer">Weekends</button>
                      ${selectedCount > 0 ? `<button type="button" id="batch-clear-sel" class="text-[11px] text-muted hover:text-danger underline cursor-pointer">Clear Selection</button>` : ''}
                    </div>
                    <button type="button" id="batch-cancel-mode" class="text-[11px] text-muted hover:text-ink font-medium cursor-pointer">Cancel</button>
                  </div>

                  <div class="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                    <div class="sm:col-span-4">
                      <label class="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">Availability Window</label>
                      <select id="batch-avail-daypart" class="field !py-1.5 text-xs">
                        <option value="all_day" ${batchDayPart === 'all_day' ? 'selected' : ''}>All Day</option>
                        <option value="morning" ${batchDayPart === 'morning' ? 'selected' : ''}>Morning (08:00–13:00)</option>
                        <option value="afternoon" ${batchDayPart === 'afternoon' ? 'selected' : ''}>Afternoon (13:00–18:00)</option>
                        <option value="evening" ${batchDayPart === 'evening' ? 'selected' : ''}>Evening (18:00–23:30)</option>
                        <option value="custom" ${batchDayPart === 'custom' ? 'selected' : ''}>Custom Hours</option>
                      </select>
                    </div>
                    ${batchDayPart === 'custom' ? `
                      <div class="sm:col-span-2">
                        <label class="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">Start</label>
                        <input type="time" id="batch-avail-start" class="field !py-1.5 text-xs font-mono" value="${ui.esc(state.availBatchStart || '09:00')}" />
                      </div>
                      <div class="sm:col-span-2">
                        <label class="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">Finish</label>
                        <input type="time" id="batch-avail-end" class="field !py-1.5 text-xs font-mono" value="${ui.esc(state.availBatchEnd || '18:00')}" />
                      </div>
                      <div class="sm:col-span-4">
                        <label class="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">Notes (Optional)</label>
                        <input type="text" id="batch-avail-notes" class="field !py-1.5 text-xs" placeholder="e.g. Free after 2pm" value="${ui.esc(state.availBatchNotes || '')}" />
                      </div>
                    ` : `
                      <div class="sm:col-span-8">
                        <label class="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">Notes (Optional)</label>
                        <input type="text" id="batch-avail-notes" class="field !py-1.5 text-xs" placeholder="e.g. Holiday, preferred late shift..." value="${ui.esc(state.availBatchNotes || '')}" />
                      </div>
                    `}
                  </div>

                  <div class="flex items-center gap-2 flex-wrap pt-1 border-t border-line/50">
                    <button type="button" id="batch-apply-avail" class="btn btn-primary !py-1.5 !px-3 text-xs font-semibold flex items-center gap-1.5" ${selectedCount === 0 ? 'disabled' : ''}>
                      ${ui.icon('check', 'w-3.5 h-3.5')}
                      <span>Mark Available (${selectedCount})</span>
                    </button>
                    <button type="button" id="batch-apply-unavail" class="btn btn-ghost !py-1.5 !px-3 text-xs font-semibold border border-danger/40 text-danger hover:bg-danger/10 flex items-center gap-1.5" ${selectedCount === 0 ? 'disabled' : ''}>
                      ${ui.icon('x', 'w-3.5 h-3.5')}
                      <span>Mark Unavailable (${selectedCount})</span>
                    </button>
                    <button type="button" id="batch-apply-clear" class="btn btn-ghost !py-1.5 !px-3 text-xs border border-line text-muted hover:text-ink" ${selectedCount === 0 ? 'disabled' : ''}>
                      Clear Dates
                    </button>
                  </div>
                </div>
              ` : ''}

              <!-- Calendar Grid with Mobile Scroll Safety -->
              <div class="overflow-x-auto scrollbar-hide">
                <div class="min-w-[280px]">
                  <!-- Day headers -->
                  <div class="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-muted uppercase tracking-wider py-1">
                    <div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div><div>Sun</div>
                  </div>

                  <!-- Days -->
                  <div class="grid grid-cols-7 gap-1 sm:gap-1.5">
          `;

          // Blank padding days
          for (let i = 0; i < startingDayOfWeek; i++) {
            out += `<div class="p-1 sm:p-2 min-h-[58px] sm:min-h-[80px] rounded-lg bg-panel2/20 border border-transparent opacity-30"></div>`;
          }

          // Actual month days
          const todayStr = formatDate(new Date());
          for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
            const avail = userAvails.find((a) => normalizeDate(a.date) === dateStr);
            const dayBookings = userBookings.filter((b) => normalizeDate(b.date) === dateStr);
            const isToday = dateStr === todayStr;
            const isSelected = selectedSet.has(dateStr);

            let statusBorder = 'border-line';
            let statusBg = 'bg-panel2/40';

            if (isSelected) {
              statusBorder = 'border-accent ring-2 ring-accent/80';
              statusBg = 'bg-accent/15';
            } else if (dayBookings.length > 0) {
              statusBorder = 'border-amber-400/40';
              statusBg = 'bg-amber-400/5';
            } else if (avail) {
              if (avail.type === 'available') {
                statusBorder = 'border-emerald-500/40';
                statusBg = 'bg-emerald-500/5';
              } else {
                statusBorder = 'border-rose-500/40';
                statusBg = 'bg-rose-500/5';
              }
            }

            out += `
              <div data-cell-date="${dateStr}" class="p-1 sm:p-1.5 min-h-[62px] sm:min-h-[82px] rounded-lg border ${statusBorder} ${statusBg} ${isToday && !isSelected ? 'ring-1 ring-accent' : ''} hover:border-accent cursor-pointer transition flex flex-col justify-between group select-none">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-mono tabular-nums font-bold ${isToday || isSelected ? 'text-accent' : 'text-ink'}">${dayNum}</span>
                  ${multiMode ? `
                    <span class="w-4 h-4 rounded border flex items-center justify-center text-[10px] font-bold transition ${isSelected ? 'bg-accent border-accent text-accent-ink' : 'border-line bg-panel text-transparent'}">
                      ✓
                    </span>
                  ` : (isToday ? `<span class="px-1 py-0.2 rounded text-[8.5px] font-bold bg-accent text-accent-ink uppercase tracking-wider leading-none">Today</span>` : (avail ? `
                    <span class="w-1.5 h-1.5 rounded-full ${avail.type === 'available' ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
                  ` : ''))}
                </div>

                <!-- Availability Control -->
                <div class="my-1">
                  ${avail ? `
                    ${avail.type === 'available' ? `
                      <button type="button" data-edit-avail-date="${dateStr}" class="w-full inline-flex items-center justify-between gap-1 py-1 px-2 rounded-md text-[10.5px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/35 hover:bg-emerald-500/25 transition cursor-pointer" title="Available ${ui.esc(formatAvailabilityWindowLabel(avail))}">
                        <span class="truncate font-medium">${ui.esc(isAllDayAvailability(avail) ? 'All Day' : (avail.dayPart === 'custom' ? `${avail.startTime || '17:00'}–${avail.finishTime || '23:30'}` : (avail.dayPart ? avail.dayPart.charAt(0).toUpperCase() + avail.dayPart.slice(1) : 'All Day')))}</span>
                      </button>
                    ` : `
                      <button type="button" data-edit-avail-date="${dateStr}" class="w-full inline-flex items-center justify-between gap-1 py-1 px-2 rounded-md text-[10.5px] font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/35 hover:bg-rose-500/25 transition cursor-pointer" title="Unavailable">
                        <span class="truncate font-medium">Unavailable</span>
                      </button>
                    `}
                  ` : (multiMode ? `
                    <div class="text-[10px] text-center py-1 font-mono ${isSelected ? 'text-accent font-semibold' : 'text-muted/70'}">
                      ${isSelected ? 'Selected' : '—'}
                    </div>
                  ` : `
                    <button type="button" data-add-avail-date="${dateStr}" class="w-full inline-flex items-center justify-center gap-1 py-1 px-2 rounded-md text-[10.5px] font-semibold bg-panel/90 hover:bg-accent hover:text-accent-ink text-muted hover:border-accent border border-dashed border-line transition cursor-pointer" title="Add availability for ${formatDisplayDate(dateStr)}">
                      <span>+ Add</span>
                    </button>
                  `)}
                </div>

                <!-- Bookings Tag -->
                <div class="space-y-1">
                  ${dayBookings.map((b) => `
                    <div class="text-[9px] leading-tight px-1 py-0.5 rounded font-semibold truncate bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center justify-between gap-1" title="${ui.esc(b.space || 'Shift')}: ${b.startTime}–${b.finishTime}">
                      <span class="truncate">${ui.esc(b.space || 'Shift')}</span>
                      <span class="font-mono tabular-nums text-[8px] opacity-75 shrink-0">${b.startTime}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            `;
          }

          out += `
                  </div>
                </div>
              </div>
            </div>

            <!-- 1-col: Personal Assigned Shifts Log -->
            <div class="p-4 rounded-xl bg-panel border border-line space-y-3">
              <div class="flex items-center justify-between pb-2 border-b border-line/60">
                <span class="text-xs font-semibold text-ink flex items-center gap-1.5">
                  ${ui.icon('clip', 'w-3.5 h-3.5 text-accent')}
                  <span>Upcoming Venue Shifts</span>
                </span>
                <span class="text-[11px] font-mono text-muted tabular-nums">${userBookings.length} assigned</span>
              </div>

              <div class="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
          `;

          if (userBookings.length === 0) {
            out += `
              <div class="p-6 text-center text-xs text-muted italic">
                No upcoming shifts booked for this technician.
              </div>
            `;
          } else {
            userBookings.sort((a, b) => (a.date > b.date ? 1 : -1)).forEach((b) => {
              out += `
                <div class="p-3 rounded-lg border bg-panel2/60 space-y-2 ${b.status === 'confirmed' ? 'border-emerald-500/30' : 'border-amber-500/30'}">
                  <div class="flex items-start justify-between gap-1.5">
                    <div>
                      <span class="text-[10px] font-semibold text-accent uppercase tracking-wider block">${ui.esc(b.space)}</span>
                      <span class="text-xs font-bold text-ink block">${ui.esc(b.eventName || 'Shift')}</span>
                    </div>
                    ${renderStatusPill(b.status)}
                  </div>

                  <div class="flex items-center justify-between text-xs text-muted pt-1 border-t border-line/40">
                    <span class="font-mono text-ink">${formatDisplayDate(b.date)}</span>
                    <span class="font-mono tabular-nums">${b.startTime} – ${b.finishTime}</span>
                  </div>

                  <div class="flex items-center justify-between text-[11px] pt-1 flex-wrap gap-1">
                    <span class="px-1.5 py-0.2 rounded bg-panel border border-line text-ink font-semibold">${ui.esc(b.role || 'Tech')}</span>
                    <div class="flex items-center gap-1.5 flex-wrap">
                      ${isActiveOpenSwap(b) ? `
                        <span class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">Cover Offered</span>
                        <button data-cancel-my-swap="${b.id}" class="text-[10px] text-danger font-semibold hover:underline cursor-pointer">Cancel</button>
                      ` : (isUpcomingShiftDate(b.date) ? `
                        <button data-offer-my-swap="${b.id}" class="px-2 py-0.5 rounded text-[10px] font-semibold bg-panel border border-line text-muted hover:text-amber-400 hover:border-amber-500/40 transition cursor-pointer flex items-center gap-1">
                          ${ui.icon('refresh', 'w-3 h-3')}
                          <span>Offer Swap</span>
                        </button>
                      ` : '')}
                      ${b.status === 'pencil' ? `
                        <button data-tech-accept="${b.id}" class="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20">
                          Accept
                        </button>
                        <button data-tech-decline="${b.id}" class="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20">
                          Decline
                        </button>
                      ` : ''}
                    </div>
                  </div>
                </div>
              `;
            });
          }

          out += `
              </div>
            </div>
          </div>
        </div>
      `;

      tabContainer.innerHTML = out;
      wireMyAvailEvents(nextMonthKey, year, month, daysInMonth);
    }

    function wireMyAvailEvents(nextMonthKey, year, month, daysInMonth) {
      function toggleDateSelection(dateStr, shiftKey) {
        const set = new Set(Array.isArray(state.selectedAvailDates) ? state.selectedAvailDates : []);
        if (shiftKey && state.lastSelectedAvailDate) {
          const a = parseDate(state.lastSelectedAvailDate);
          const b = parseDate(dateStr);
          const start = a <= b ? a : b;
          const end = a <= b ? b : a;
          const cur = new Date(start);
          while (cur <= end) {
            set.add(formatDate(cur));
            cur.setDate(cur.getDate() + 1);
          }
        } else {
          if (set.has(dateStr)) set.delete(dateStr);
          else set.add(dateStr);
        }
        state.lastSelectedAvailDate = dateStr;
        state.selectedAvailDates = Array.from(set).sort();
        renderMyAvailTab();
      }

      async function applyBatchAvailability(mode) {
        const dates = Array.isArray(state.selectedAvailDates) ? state.selectedAvailDates.slice().sort() : [];
        if (!dates.length) {
          ui.toast('Select at least one date on the calendar first.', 'info');
          return;
        }
        const userId = state.selectedUserForAvail || (me ? me.id : 'user-3');
        const userObj = getAllUsers().find((u) => u.id === userId) || me;
        const userName = userObj ? auth.displayName(userObj) : 'Technician';
        const existingUserAvails = getAllAvailability().filter((a) => a.userId === userId);
        const existingByDate = new Map(existingUserAvails.map((a) => [normalizeDate(a.date), a]));

        if (mode === 'clear') {
          const idsToDelete = dates
            .map((d) => existingByDate.get(d))
            .filter((rec) => rec && rec.id)
            .map((rec) => rec.id);
          if (!idsToDelete.length) {
            ui.toast('No saved availability entries on the selected dates.', 'info');
            return;
          }
          if (RMTP.syncSb && typeof RMTP.syncSb.deleteAvailabilityBatch === 'function') {
            await RMTP.syncSb.deleteAvailabilityBatch(idsToDelete);
          } else {
            idsToDelete.forEach((id) => store.remove('availability', id));
          }
          state.selectedAvailDates = [];
          state.lastSelectedAvailDate = '';
          ui.toast(`Cleared availability for ${idsToDelete.length} date${idsToDelete.length === 1 ? '' : 's'}`, 'ok');
          renderMyAvailTab();
          return;
        }

        const dayPart = mode === 'unavailable' ? 'all_day' : (state.availBatchDayPart || 'all_day');
        const startTime = dayPart === 'custom' ? (state.availBatchStart || '09:00') : '';
        const finishTime = dayPart === 'custom' ? (state.availBatchEnd || '18:00') : '';
        if (mode === 'available' && dayPart === 'custom' && (!startTime || !finishTime)) {
          ui.toast('Please specify both start and finish times for Custom Hours.', 'danger');
          return;
        }
        const notes = String(state.availBatchNotes || '').trim();
        const nowIso = new Date().toISOString();

        const records = dates.map((d) => {
          const prev = existingByDate.get(d);
          return {
            id: (prev && prev.id) ? prev.id : `avail_${userId}_${d}`,
            userId: userId,
            userName: userName,
            date: d,
            type: mode === 'unavailable' ? 'unavailable' : 'available',
            dayPart: dayPart,
            startTime: startTime,
            finishTime: finishTime,
            notes: notes,
            updatedAt: nowIso,
          };
        });

        if (RMTP.syncSb && typeof RMTP.syncSb.upsertAvailabilityBatch === 'function') {
          const res = await RMTP.syncSb.upsertAvailabilityBatch(records);
          if (res && res.queued) {
            ui.toast(`Saved ${records.length} dates locally (sync queued)`, 'info');
          } else {
            ui.toast(`Marked ${records.length} date${records.length === 1 ? '' : 's'} as ${mode === 'unavailable' ? 'Unavailable' : 'Available'}`, 'ok');
          }
        } else {
          records.forEach((r) => store.upsert('availability', r));
          ui.toast(`Marked ${records.length} date${records.length === 1 ? '' : 's'} as ${mode === 'unavailable' ? 'Unavailable' : 'Available'}`, 'ok');
        }

        state.selectedAvailDates = [];
        state.lastSelectedAvailDate = '';
        renderMyAvailTab();
      }

      tabContainer.querySelector('#btn-toggle-multi-avail')?.addEventListener('click', () => {
        state.availMultiSelectMode = !state.availMultiSelectMode;
        if (!state.availMultiSelectMode) {
          state.selectedAvailDates = [];
          state.lastSelectedAvailDate = '';
        }
        renderMyAvailTab();
      });

      tabContainer.querySelector('#batch-cancel-mode')?.addEventListener('click', () => {
        state.availMultiSelectMode = false;
        state.selectedAvailDates = [];
        state.lastSelectedAvailDate = '';
        renderMyAvailTab();
      });

      tabContainer.querySelector('#batch-clear-sel')?.addEventListener('click', () => {
        state.selectedAvailDates = [];
        state.lastSelectedAvailDate = '';
        renderMyAvailTab();
      });

      tabContainer.querySelector('#batch-select-empty')?.addEventListener('click', () => {
        const userId = state.selectedUserForAvail || (me ? me.id : 'user-3');
        const existingSet = new Set(getAllAvailability().filter((a) => a.userId === userId).map((a) => normalizeDate(a.date)));
        const sel = new Set(Array.isArray(state.selectedAvailDates) ? state.selectedAvailDates : []);
        for (let dNum = 1; dNum <= daysInMonth; dNum++) {
          const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`;
          if (!existingSet.has(ds)) sel.add(ds);
        }
        state.selectedAvailDates = Array.from(sel).sort();
        renderMyAvailTab();
      });

      tabContainer.querySelector('#batch-select-weekends')?.addEventListener('click', () => {
        const sel = new Set(Array.isArray(state.selectedAvailDates) ? state.selectedAvailDates : []);
        for (let dNum = 1; dNum <= daysInMonth; dNum++) {
          const dObj = new Date(year, month, dNum, 12, 0, 0);
          const dow = dObj.getDay();
          if (dow === 0 || dow === 6) {
            sel.add(`${year}-${String(month + 1).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`);
          }
        }
        state.selectedAvailDates = Array.from(sel).sort();
        renderMyAvailTab();
      });

      tabContainer.querySelector('#batch-avail-daypart')?.addEventListener('change', (e) => {
        state.availBatchDayPart = e.target.value;
        renderMyAvailTab();
      });
      tabContainer.querySelector('#batch-avail-start')?.addEventListener('change', (e) => {
        state.availBatchStart = e.target.value;
      });
      tabContainer.querySelector('#batch-avail-end')?.addEventListener('change', (e) => {
        state.availBatchEnd = e.target.value;
      });
      tabContainer.querySelector('#batch-avail-notes')?.addEventListener('input', (e) => {
        state.availBatchNotes = e.target.value;
      });

      tabContainer.querySelector('#batch-apply-avail')?.addEventListener('click', () => applyBatchAvailability('available'));
      tabContainer.querySelector('#batch-apply-unavail')?.addEventListener('click', () => applyBatchAvailability('unavailable'));
      tabContainer.querySelector('#batch-apply-clear')?.addEventListener('click', () => applyBatchAvailability('clear'));

      // Banner buttons
      tabContainer.querySelector('#btn-avail-add-today')?.addEventListener('click', () => {
        const todayStr = formatDate(new Date());
        const userId = state.selectedUserForAvail || (me ? me.id : 'user-3');
        const existing = getUserAvailability(userId, todayStr);
        openAvailabilityModal({
          date: todayStr,
          userId: userId,
          ...(existing || {})
        });
      });
      tabContainer.querySelector('#btn-jump-next-month')?.addEventListener('click', () => {
        if (nextMonthKey) {
          state.availMonth = nextMonthKey;
          renderMyAvailTab();
        }
      });

      tabContainer.querySelector('#avail-user-select')?.addEventListener('change', (e) => {
        state.selectedUserForAvail = e.target.value;
        state.selectedAvailDates = [];
        state.lastSelectedAvailDate = '';
        renderMyAvailTab();
      });

      tabContainer.querySelector('#month-prev')?.addEventListener('click', () => {
        const [yStr, mStr] = state.availMonth.split('-');
        let y = parseInt(yStr, 10);
        let m = parseInt(mStr, 10) - 1;
        if (m < 1) { m = 12; y -= 1; }
        state.availMonth = `${y}-${String(m).padStart(2, '0')}`;
        renderMyAvailTab();
      });

      tabContainer.querySelector('#month-next')?.addEventListener('click', () => {
        const [yStr, mStr] = state.availMonth.split('-');
        let y = parseInt(yStr, 10);
        let m = parseInt(mStr, 10) + 1;
        if (m > 12) { m = 1; y += 1; }
        state.availMonth = `${y}-${String(m).padStart(2, '0')}`;
        renderMyAvailTab();
      });

      // Click pill with + sign to add availability (or toggle if multi-select/Shift)
      tabContainer.querySelectorAll('[data-add-avail-date]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const d = btn.getAttribute('data-add-avail-date');
          if (state.availMultiSelectMode || e.shiftKey) {
            state.availMultiSelectMode = true;
            toggleDateSelection(d, e.shiftKey);
            return;
          }
          const userId = state.selectedUserForAvail || (me ? me.id : 'user-3');
          openAvailabilityModal({
            date: d,
            userId: userId,
          });
        });
      });

      // Click existing pill to edit availability (or toggle if multi-select/Shift)
      tabContainer.querySelectorAll('[data-edit-avail-date]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const d = btn.getAttribute('data-edit-avail-date');
          if (state.availMultiSelectMode || e.shiftKey) {
            state.availMultiSelectMode = true;
            toggleDateSelection(d, e.shiftKey);
            return;
          }
          const userId = state.selectedUserForAvail || (me ? me.id : 'user-3');
          const existing = getUserAvailability(userId, d);
          openAvailabilityModal({
            date: d,
            userId: userId,
            ...(existing || {})
          });
        });
      });

      // Click cell anywhere
      tabContainer.querySelectorAll('[data-cell-date]').forEach((cell) => {
        cell.addEventListener('click', (e) => {
          const d = cell.getAttribute('data-cell-date');
          if (state.availMultiSelectMode || e.shiftKey) {
            state.availMultiSelectMode = true;
            toggleDateSelection(d, e.shiftKey);
            return;
          }
          if (e.target.closest('button')) return;
          const userId = state.selectedUserForAvail || (me ? me.id : 'user-3');
          const existing = getUserAvailability(userId, d);
          openAvailabilityModal({
            date: d,
            userId: userId,
            ...(existing || {})
          });
        });
      });

      tabContainer.querySelectorAll('[data-offer-my-swap]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-offer-my-swap');
          const b = store.find('bookings', id);
          if (b) openOfferSwapModal(b);
        });
      });

      tabContainer.querySelectorAll('[data-cancel-my-swap]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-cancel-my-swap');
          const b = store.find('bookings', id);
          if (b) {
            b.swapRequested = false;
            store.upsert('bookings', b);
            ui.toast('Shift swap request cancelled', 'ok');
            renderMyAvailTab();
            updateTopMetrics();
          }
        });
      });

      tabContainer.querySelectorAll('[data-tech-accept]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-tech-accept');
          const b = store.find('bookings', id);
          if (b) {
            b.status = 'confirmed';
            b.confirmedAt = new Date().toISOString();
            b.updatedAt = new Date().toISOString();
            store.upsert('bookings', b);
            if (b.eventId && RMTP.syncRotaToAdvancing) {
              RMTP.syncRotaToAdvancing(b.eventId);
            }
            ui.toast('Shift accepted and confirmed', 'ok');
            renderMyAvailTab();
            updateTopMetrics();
          }
        });
      });

      tabContainer.querySelectorAll('[data-tech-decline]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-tech-decline');
          const b = store.find('bookings', id);
          if (b) {
            b.status = 'declined';
            b.updatedAt = new Date().toISOString();
            store.upsert('bookings', b);
            if (b.eventId && RMTP.syncRotaToAdvancing) {
              RMTP.syncRotaToAdvancing(b.eventId, { prevBookingId: b.id, prevUserId: b.userId, prevUserName: b.userName });
            }
            ui.toast('Shift declined', 'info');
            renderMyAvailTab();
            updateTopMetrics();
          }
        });
      });
    }

    // ------------------------------------------------------------------------
    // TAB 3: TEAM AVAILABILITY MATRIX
    // ------------------------------------------------------------------------
    function renderTeamMatrixTab() {
      // 14-day rolling window starting from Monday of target week
      const days = [];
      const matrixWeekDays = getCurrentWeekDays();
      const monday = parseDate(matrixWeekDays[0].date);
      for (let i = 0; i < 14; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        days.push({
          date: formatDate(d),
          dObj: d,
          dayName: d.toLocaleDateString('en-GB', { weekday: 'narrow' }),
          dayNum: d.getDate(),
          monthName: d.toLocaleDateString('en-GB', { month: 'short' }),
          isToday: formatDate(d) === formatDate(new Date()),
        });
      }

      const matrixUsers = getAllUsers()
        .filter((u) => u && u.status !== 'pending' && !(auth.isHiresTeam && auth.isHiresTeam(u)))
        .sort((a, b) => auth.displayName(a).localeCompare(auth.displayName(b)));

      function describeAvailabilityForMatrix(avail) {
        if (!avail) {
          return {
            status: 'none',
            flagText: 'No data',
            timeText: '',
            tooltip: 'No availability logged',
          };
        }
        if (avail.type === 'unavailable') {
          return {
            status: 'unavailable',
            flagText: 'Unavail',
            timeText: '',
            tooltip: 'Unavailable' + (avail.notes ? ' — ' + avail.notes : ''),
          };
        }
        if (isAllDayAvailability(avail)) {
          return {
            status: 'available',
            flagText: 'Avail',
            timeText: 'All Day',
            tooltip: 'Available (All Day)' + (avail.notes ? ' — ' + avail.notes : ''),
          };
        }
        let sTime = avail.startTime || '';
        let fTime = avail.finishTime || '';
        let partText = '';
        if (avail.dayPart === 'morning') {
          sTime = sTime || '08:00';
          fTime = fTime || '13:00';
          partText = 'Morning';
        } else if (avail.dayPart === 'afternoon') {
          sTime = sTime || '13:00';
          fTime = fTime || '18:00';
          partText = 'Afternoon';
        } else if (avail.dayPart === 'evening') {
          sTime = sTime || '18:00';
          fTime = fTime || '23:30';
          partText = 'Evening';
        } else {
          partText = 'Custom';
        }
        const timeRange = (sTime && fTime)
          ? (sTime + '\u2013' + fTime)
          : (sTime || fTime || 'All Day');
        return {
          status: 'available',
          flagText: 'Avail',
          timeText: timeRange,
          tooltip: 'Available (' + partText + ': ' + timeRange + ')' + (avail.notes ? ' — ' + avail.notes : ''),
        };
      }

      let out = `
        <div class="space-y-4">
          <div class="flex items-center justify-between pb-2 border-b border-line flex-wrap gap-2">
            <div>
              <h2 class="text-sm font-bold text-ink">Two-Week Team Availability &amp; Rota Matrix</h2>
              <p class="text-xs text-muted">Each cell shows booked shifts alongside a live availability flag and listed hours · Click any date header for Day Crew &amp; Shifts</p>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <button id="matrix-week-prev" class="btn btn-ghost !p-1.5" title="Previous Week">
                ${ui.icon('chevL', 'w-4 h-4')}
              </button>
              <button id="matrix-week-today" class="btn btn-ghost text-xs ${state.weekOffset === 0 ? 'bg-panel2 font-bold text-accent' : ''}">This Week</button>
              <button id="matrix-week-next" class="btn btn-ghost !p-1.5" title="Next Week">
                ${ui.icon('chevR', 'w-4 h-4')}
              </button>
              <span class="text-xs font-mono tabular-nums font-bold text-ink px-1.5 whitespace-nowrap">
                ${days[0].dayNum} ${days[0].monthName} – ${days[13].dayNum} ${days[13].monthName}
              </span>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted px-1">
            <span class="inline-flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              <span class="text-emerald-400 font-semibold">Avail</span>
              <span>+ listed hours</span>
            </span>
            <span class="inline-flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
              <span class="text-rose-400 font-semibold">Unavail</span>
              <span>marked unavailable</span>
            </span>
            <span class="inline-flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
              <span class="text-amber-400 font-semibold">Shift</span>
              <span>booked on venue rota</span>
            </span>
            <span class="inline-flex items-center gap-1.5">
              <span class="text-muted/60 font-mono">—</span>
              <span>no availability submitted</span>
            </span>
          </div>

          <div class="overflow-x-auto border border-line rounded-xl bg-panel shadow-sm">
            <table class="w-full text-xs text-left border-collapse">
              <thead>
                <tr class="bg-panel2/60 border-b border-line text-[11px] font-semibold text-muted">
                  <th class="p-3 sticky left-0 bg-panel2 z-10 w-48 min-w-[180px]">Technician</th>
                  ${days.map((d) => `
                    <th data-matrix-open-day="${d.date}" title="Open Day Crew &amp; Shifts for ${formatDisplayDate(d.date)}" class="p-2 text-center min-w-[98px] border-l border-line/50 cursor-pointer hover:bg-accent/10 transition ${d.isToday ? 'bg-accent/10 text-accent font-bold' : ''}">
                      <div class="uppercase tracking-wider text-[10px]">${d.dayName}</div>
                      <div class="font-mono tabular-nums text-ink ${d.isToday ? 'text-accent' : ''}">${d.dayNum} ${d.monthName}</div>
                    </th>
                  `).join('')}
                </tr>
              </thead>
              <tbody class="divide-y divide-line/60">
      `;

      matrixUsers.forEach((u) => {
        const uName = auth.displayName(u);
        out += `
          <tr class="hover:bg-panel2/30 transition">
            <td class="p-3 sticky left-0 bg-panel z-10 border-r border-line/60">
              <div class="flex items-center gap-2">
                <span class="w-6 h-6 rounded-full bg-accent/20 text-accent text-xs font-bold flex items-center justify-center shrink-0">
                  ${(uName[0] || 'U').toUpperCase()}
                </span>
                <div class="min-w-0">
                  <div class="font-semibold text-ink truncate">${ui.esc(uName)}</div>
                  <div class="text-[10px] text-muted truncate">${ui.esc(u.position || 'Tech')} · ${ui.esc(u.discipline || 'All')}</div>
                </div>
              </div>
            </td>
        `;

        days.forEach((d) => {
          const avail = getUserAvailability(u.id, d.date);
          const bookings = getUserBookingsOnDate(u.id, d.date);
          const avInfo = describeAvailabilityForMatrix(avail);

          let cellCls = '';
          if (bookings.length > 0) {
            cellCls = avInfo.status === 'unavailable' ? 'bg-rose-500/[0.07]' : 'bg-amber-400/[0.06]';
          } else if (avInfo.status === 'available') {
            cellCls = 'bg-emerald-500/[0.06]';
          } else if (avInfo.status === 'unavailable') {
            cellCls = 'bg-rose-500/[0.05]';
          }

          let bookingHtml = '';
          const tooltipParts = [];
          if (bookings.length > 0) {
            const b = bookings[0];
            const bTimes = [b.startTime, b.finishTime].filter(Boolean).join('\u2013');
            const extraCount = bookings.length > 1 ? (' +' + (bookings.length - 1)) : '';
            tooltipParts.push('Booked: ' + (b.eventName || b.space || 'Shift') + (bTimes ? ' (' + bTimes + ')' : '') + ' [' + (b.status || 'pencil') + ']');
            bookingHtml = `
              <div class="px-1.5 py-0.5 rounded text-[10px] font-semibold truncate bg-amber-500/15 text-amber-300 border border-amber-500/30 leading-tight">
                ${ui.esc(b.space || 'Shift')}${extraCount}
              </div>
            `;
          }
          tooltipParts.push(avInfo.tooltip);

          let availFlagHtml = '';
          if (avInfo.status === 'available') {
            availFlagHtml = `
              <div data-matrix-avail-flag="available" class="flex flex-col items-center gap-0.5 leading-tight">
                <span class="inline-flex items-center gap-1 text-[9.5px] font-semibold text-emerald-400">
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" aria-hidden="true"></span>
                  <span>Avail</span>
                </span>
                <span data-matrix-avail-times class="font-mono tabular-nums text-[9.5px] text-ink/85 whitespace-nowrap">${ui.esc(avInfo.timeText)}</span>
              </div>
            `;
          } else if (avInfo.status === 'unavailable') {
            availFlagHtml = `
              <div data-matrix-avail-flag="unavailable" class="inline-flex items-center justify-center gap-1 text-[9.5px] font-semibold text-rose-400 leading-tight">
                <span class="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" aria-hidden="true"></span>
                <span>${bookings.length > 0 ? 'Unavail!' : 'Unavail'}</span>
              </div>
            `;
          } else if (bookings.length > 0) {
            availFlagHtml = `
              <div data-matrix-avail-flag="none" class="text-[9px] text-muted/70 leading-tight">No avail</div>
            `;
          } else {
            availFlagHtml = `
              <div data-matrix-avail-flag="none" class="text-muted/40 text-[10px]">—</div>
            `;
          }

          const cellContent = `
            <div class="flex flex-col items-stretch justify-center gap-1 min-h-[34px]">
              ${bookingHtml}
              ${availFlagHtml}
            </div>
          `;

          out += `
            <td data-matrix-cell data-matrix-user="${ui.esc(u.id)}" data-matrix-date="${d.date}" title="${ui.esc(tooltipParts.join(' · '))}" class="p-1.5 text-center align-middle border-l border-line/40 cursor-pointer hover:bg-panel2 transition ${cellCls}">
              ${cellContent}
            </td>
          `;
        });

        out += `</tr>`;
      });

      out += `
              </tbody>
            </table>
          </div>
        </div>
      `;

      tabContainer.innerHTML = out;

      // Matrix wiring
      tabContainer.querySelector('#matrix-week-prev')?.addEventListener('click', () => {
        state.weekOffset -= 1;
        renderTeamMatrixTab();
        updateTopMetrics();
      });
      tabContainer.querySelector('#matrix-week-next')?.addEventListener('click', () => {
        state.weekOffset += 1;
        renderTeamMatrixTab();
        updateTopMetrics();
      });
      tabContainer.querySelector('#matrix-week-today')?.addEventListener('click', () => {
        state.weekOffset = 0;
        renderTeamMatrixTab();
        updateTopMetrics();
      });

      tabContainer.querySelectorAll('[data-matrix-open-day]').forEach((th) => {
        th.addEventListener('click', () => {
          const dStr = th.getAttribute('data-matrix-open-day');
          if (!dStr) return;
          state.selectedDay = dStr;
          state._hasUserSwitchedTab = true;
          state.tab = 'day_planner';
          syncTabButtons();
          renderActiveTab();
        });
      });

      tabContainer.querySelectorAll('[data-matrix-cell]').forEach((td) => {
        td.addEventListener('click', () => {
          const userId = td.getAttribute('data-matrix-user');
          const dateStr = td.getAttribute('data-matrix-date');
          if (!userId || !dateStr) return;
          const existingBooking = getUserBookingsOnDate(userId, dateStr);
          const existingAvail = getUserAvailability(userId, dateStr);

          // If tech already booked, edit that booking; otherwise open booking creator for that tech and date!
          if (existingBooking.length > 0) {
            openBookingModal(existingBooking[0]);
          } else {
            openBookingModal({
              userId: userId,
              date: dateStr,
              startTime: existingAvail && existingAvail.startTime ? existingAvail.startTime : '17:00',
              finishTime: existingAvail && existingAvail.finishTime ? existingAvail.finishTime : '23:30',
              status: 'pencil',
            });
          }
        });
      });
    }

    // ------------------------------------------------------------------------
    // TAB 4: DAY CREW & SHIFTS (COMBINED DAILY PLANNER FOR TM & SENIOR TECHS)
    // ------------------------------------------------------------------------
    function getFullDayScheduleSnapshot(dateStr) {
      const saved = {
        spaceFilter: state.spaceFilter,
        roleFilter: state.roleFilter,
        statusFilter: state.statusFilter,
        techFilter: state.techFilter,
        unfilledOnly: state.unfilledOnly,
        eventsFilter: state.eventsFilter,
        searchQuery: state.searchQuery,
      };
      state.spaceFilter = '';
      state.roleFilter = '';
      state.statusFilter = '';
      state.techFilter = '';
      state.unfilledOnly = false;
      state.eventsFilter = 'all';
      state.searchQuery = '';
      let list = [];
      try {
        list = getDaySchedule(dateStr);
      } finally {
        Object.assign(state, saved);
      }
      return list;
    }

    function renderDayPlannerTab() {
      const targetDate = normalizeDate(state.selectedDay) || formatDate(new Date());
      state.selectedDay = targetDate;
      const targetDateObj = parseDate(targetDate);
      const todayStr = formatDate(new Date());

      // Build Mon-Sun week strip containing targetDate
      const dow = (targetDateObj.getDay() + 6) % 7;
      const stripMonday = new Date(targetDateObj);
      stripMonday.setDate(targetDateObj.getDate() - dow);
      stripMonday.setHours(0, 0, 0, 0);

      const techUsers = getAllUsers()
        .filter((u) => u && u.status !== 'pending' && !(auth.isHiresTeam && auth.isHiresTeam(u)))
        .sort((a, b) => auth.displayName(a).localeCompare(auth.displayName(b)));

      const weekStripDays = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(stripMonday);
        d.setDate(stripMonday.getDate() + i);
        const ds = formatDate(d);
        const dayItems = getFullDayScheduleSnapshot(ds);
        let availCount = 0;
        techUsers.forEach((u) => {
          const live = getTechLiveStatus(u.id, ds);
          if (live.available === true && !live.booked) availCount++;
        });
        const unfilledDayCount = dayItems.filter((it) => it.needsCovering || it.isUnfilled).length;
        weekStripDays.push({
          date: ds,
          dayShort: d.toLocaleDateString('en-GB', { weekday: 'short' }),
          dayNum: d.getDate(),
          monthShort: d.toLocaleDateString('en-GB', { month: 'short' }),
          isToday: ds === todayStr,
          isSelected: ds === targetDate,
          shiftCount: dayItems.length,
          unfilledCount: unfilledDayCount,
          availCount: availCount,
        });
      }

      // Compute full venue shifts for selected day — cleanly split into Needs Covering vs Covered & Booked
      const dayItems = getFullDayScheduleSnapshot(targetDate);
      const needsCoveringItems = dayItems.filter((it) => it.needsCovering || it.isUnfilled);
      const coveredItems = dayItems.filter((it) => !(it.needsCovering || it.isUnfilled));
      const confirmedShifts = coveredItems.filter((it) => !it.isNoTech && it.status === 'confirmed');
      const pencilShifts = coveredItems.filter((it) => !it.isNoTech && it.status === 'pencil');
      const selfServiceShifts = coveredItems.filter((it) => it.isNoTech);

      // Compute technician availability & Tech Tags for selected day
      const venueTags = auth.getAllVenueTechTags ? auth.getAllVenueTechTags() : [];
      const activeTagFilters = Array.isArray(state.dayPlannerTagFilters) ? state.dayPlannerTagFilters : [];
      const activeTagSet = new Set(activeTagFilters.map((t) => t.toLowerCase()));

      const techEntries = techUsers.map((u) => {
        const live = getTechLiveStatus(u.id, targetDate);
        const avail = getUserAvailability(u.id, targetDate);
        const bookings = getUserBookingsOnDate(u.id, targetDate);
        const tags = getTechTags(u);
        let bucket = 'nodata';
        if (live.booked) bucket = 'booked';
        else if (live.available === true) bucket = 'available';
        else if (live.available === false) bucket = 'unavailable';
        return { user: u, name: auth.displayName(u), tags, live, avail, bookings, bucket };
      });

      const availCount = techEntries.filter((t) => t.bucket === 'available').length;
      const bookedCount = techEntries.filter((t) => t.bucket === 'booked').length;
      const unavailCount = techEntries.filter((t) => t.bucket === 'unavailable').length;
      const noDataCount = techEntries.filter((t) => t.bucket === 'nodata').length;

      const techSearch = String(state.dayPlannerTechSearch || '').trim().toLowerCase();
      const availFilter = state.dayPlannerAvailFilter || 'all';
      const filteredTechs = techEntries.filter((t) => {
        if (availFilter !== 'all' && t.bucket !== availFilter) return false;
        if (activeTagFilters.length > 0) {
          const uTagLower = new Set(t.tags.map((x) => x.toLowerCase()));
          for (const reqTag of activeTagSet) {
            if (!uTagLower.has(reqTag)) return false;
          }
        }
        if (techSearch) {
          const hay = [
            t.name, t.user.position, t.user.discipline,
            t.tags.join(' '), t.live.label, t.avail && t.avail.notes
          ].filter(Boolean).join(' ').toLowerCase();
          if (!hay.includes(techSearch)) return false;
        }
        return true;
      });

      const groupOrder = [
        { key: 'available', title: 'Available to Book', tone: 'text-ok', icon: 'check' },
        { key: 'booked', title: 'Booked on Venue Shifts', tone: 'text-warning', icon: 'calendar' },
        { key: 'unavailable', title: 'Unavailable', tone: 'text-danger', icon: 'x' },
        { key: 'nodata', title: 'No Availability Logged', tone: 'text-muted', icon: 'clock' },
      ];

      const displayHeadingDate = targetDateObj.toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });

      function renderDayShiftRow(item) {
        const timesStr = (item.startTime || 'TBC') + (item.finishTime ? (' \u2013 ' + item.finishTime) : '');
        const isTakeover = item.type === 'takeover';
        const isBooking = item.type === 'booking';
        const isGap = !!(item.needsCovering || item.isUnfilled);
        const statusMeta = item.isNoTech
          ? { label: 'No Tech Required', cls: 'text-muted', icon: 'slash' }
          : (isGap
            ? { label: (isTakeover && item.totalCrewAssigned > 0 ? 'Needs Covering' : 'Unfilled Gap'), cls: 'text-danger font-semibold', icon: 'alert' }
            : (item.status === 'confirmed'
              ? { label: 'Confirmed', cls: 'text-ok font-semibold', icon: 'check' }
              : { label: 'Pencil', cls: 'text-warning font-semibold', icon: 'clock' }));

        if (isTakeover) {
          const crewRatioLabel = item.isNoTech
            ? 'No Tech Required'
            : `${statusMeta.label} (${item.totalCrewAssigned}/${item.totalCrewNeeded} crew${item.hasDualRoleCover ? ' · dual role' : ''})`;
          return `
            <div class="p-3.5 ${isGap ? 'bg-danger/[0.025]' : ''} space-y-2.5">
              <div class="flex items-start justify-between gap-2 flex-wrap">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 flex-wrap text-[11px] text-muted mb-0.5">
                    <span class="font-mono tabular-nums font-semibold text-ink">${ui.esc(timesStr)}</span>
                    <span aria-hidden="true">\u00b7</span>
                    <span class="font-semibold text-warning">Multi-Room Takeover</span>
                    <span aria-hidden="true">\u00b7</span>
                    <span class="inline-flex items-center gap-1 ${statusMeta.cls}">${ui.icon(statusMeta.icon, 'w-3 h-3')}<span class="font-mono tabular-nums">${ui.esc(crewRatioLabel)}</span></span>
                  </div>
                  <div class="font-display text-sm font-semibold text-ink">${ui.esc(item.eventName)}</div>
                </div>
                ${item.eventId ? `<a href="#/advancing/${encodeURIComponent(item.eventId)}" class="text-[11px] font-semibold text-accent hover:underline shrink-0">Advancing \u2192</a>` : ''}
              </div>
              <div class="divide-y divide-line/50 border-t border-line/60">
                ${(item.spaceBreakdown || []).map((sb) => {
                  const placeholderId = (sb.placeholderBookings && sb.placeholderBookings.length) ? sb.placeholderBookings[0].bookingId : '';
                  const roomEvId = resolveTakeoverEventId(item, sb.space) || item.eventId || '';
                  return `
                    <div class="py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2 flex-wrap">
                          <span class="font-semibold text-ink">${ui.esc(sb.space)}</span>
                          ${sb.isNoTech ? `
                            <span class="text-[11px] text-muted font-medium">No Tech Required</span>
                          ` : `
                            <span class="text-muted text-[11px] font-mono tabular-nums">${sb.assignedCount}/${sb.basicCrew}</span>
                            ${!sb.isFilled ? `
                              <span class="text-[11px] font-semibold text-danger">Needs: ${ui.esc((sb.missingDisciplines && sb.missingDisciplines.length) ? sb.missingDisciplines.join(', ') : (sb.gap + ' crew'))}</span>
                            ` : (sb.isDualRoleCover ? `
                              <span class="text-[11px] text-ok font-medium">Covered (Single Tech · Dual Role)</span>
                            ` : '<span class="text-[11px] text-ok font-medium">Covered</span>')}
                          `}
                        </div>
                        ${sb.isNoTech ? `
                          <div class="text-[11px] text-muted mt-0.5">Self-service / no technician required</div>
                        ` : (sb.assignedTechs && sb.assignedTechs.length ? `
                          <div class="text-[11px] text-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            ${sb.assignedTechs.map((t) => {
                              const tTags = t.userId ? getTechTags(t.userId) : [];
                              const tagSuffix = tTags.length ? ` <span class="font-mono text-[10px] text-accent/80">${tTags.slice(0, 3).map(ui.esc).join(' ')}</span>` : '';
                              return t.bookingId
                                ? `<button type="button" data-dp-edit-booking="${ui.esc(t.bookingId)}" class="text-ink hover:text-accent hover:underline cursor-pointer">${ui.esc(t.name)} (${ui.esc(t.role)} · ${ui.esc(t.status)})${tagSuffix}</button>`
                                : `<span>${ui.esc(t.name)} (${ui.esc(t.role)})${tagSuffix}</span>`;
                            }).join('<span aria-hidden="true">\u00b7</span>')}
                          </div>
                        ` : `
                          <div class="text-[11px] text-danger/85 mt-0.5">Unassigned</div>
                        `)}
                      </div>
                      ${sb.isNoTech && sb.noTechBookingId ? `
                        <button type="button" data-dp-edit-booking="${ui.esc(sb.noTechBookingId)}" class="btn btn-ghost !py-1 !px-2 text-[11px] font-medium border border-line shrink-0">Edit</button>
                      ` : `
                        <button type="button" data-dp-assign-shift data-ev-id="${ui.esc(roomEvId)}" data-ev-name="${ui.esc(item.eventName || '')}" data-space="${ui.esc(sb.space)}" data-start="${ui.esc(item.startTime || '17:00')}" data-end="${ui.esc(item.finishTime || '23:30')}" data-role="${ui.esc((sb.missingDisciplines && sb.missingDisciplines[0]) || 'Sound')}" ${placeholderId ? `data-existing-booking-id="${ui.esc(placeholderId)}"` : ''} class="btn ${!sb.isFilled ? 'btn-primary' : 'btn-ghost text-accent border border-accent/30 hover:bg-accent/10'} !py-1 !px-2.5 text-[11px] font-semibold shrink-0">
                          ${sb.isNoTech ? 'Edit' : '+ Assign'}
                        </button>
                      `}
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        }

        const assignedTags = (!isGap && !item.isNoTech && item.userId) ? getTechTags(item.userId) : [];

        return `
          <div class="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${isGap ? 'bg-danger/[0.025]' : ''}">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap text-[11px] text-muted mb-0.5">
                <span class="font-mono tabular-nums font-semibold text-ink">${ui.esc(timesStr)}</span>
                <span aria-hidden="true">\u00b7</span>
                <span class="font-medium text-ink/90">${ui.esc(item.space || 'Venue')}</span>
                <span aria-hidden="true">\u00b7</span>
                <span class="inline-flex items-center gap-1 ${statusMeta.cls}">${ui.icon(statusMeta.icon, 'w-3 h-3')}<span>${ui.esc(statusMeta.label)}</span></span>
              </div>
              <div class="font-display text-sm font-semibold text-ink truncate">${ui.esc(item.eventName || 'Venue Shift')}</div>
              <div class="text-xs text-muted mt-0.5 flex items-center gap-2 flex-wrap">
                ${isGap ? `
                  <span class="text-danger font-medium">Unassigned · Role needed: ${ui.esc(item.role || 'Tech')}</span>
                ` : (item.isNoTech ? `
                  <span>Self-service / no technician required</span>
                ` : `
                  <span>Crew: <strong class="text-ink font-medium">${ui.esc(item.userName || 'Technician')}</strong></span>
                  <span aria-hidden="true">\u00b7</span>
                  <span class="${item.isDualRole ? 'text-accent font-semibold' : ''}">${ui.esc(item.role || 'Tech')}</span>
                  ${assignedTags.length ? `<span aria-hidden="true">\u00b7</span><span class="font-mono text-[11px] text-accent/90">${assignedTags.map(ui.esc).join(' · ')}</span>` : ''}
                `)}
              </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0 flex-wrap">
              ${isGap ? `
                <button type="button" data-dp-assign-shift data-ev-id="${ui.esc(item.eventId || '')}" data-ev-name="${ui.esc(item.eventName || '')}" data-space="${ui.esc(item.space || 'The Stage')}" data-start="${ui.esc(item.startTime || '17:00')}" data-end="${ui.esc(item.finishTime || '23:30')}" data-role="${ui.esc(item.role || 'Sound')}" ${isBooking && item.id ? `data-existing-booking-id="${ui.esc(item.id)}"` : ''} class="btn btn-primary !py-1 !px-2.5 text-[11px] font-semibold">
                  + Assign Tech
                </button>
              ` : (isBooking && item.id ? `
                ${!item.isNoTech && item.status === 'pencil' ? `
                  <button type="button" data-dp-confirm-booking="${ui.esc(item.id)}" class="btn btn-ghost !py-1 !px-2 text-[11px] font-semibold text-ok border border-ok/30 hover:bg-ok/10">Confirm</button>
                ` : ''}
                <button type="button" data-dp-edit-booking="${ui.esc(item.id)}" class="btn btn-ghost !py-1 !px-2 text-[11px] font-medium border border-line">Edit</button>
              ` : (item.isNoTech ? `
                <button type="button" data-dp-assign-shift data-ev-id="${ui.esc(item.eventId || '')}" data-ev-name="${ui.esc(item.eventName || '')}" data-space="${ui.esc(item.space || 'The Stage')}" data-start="${ui.esc(item.startTime || '17:00')}" data-end="${ui.esc(item.finishTime || '23:30')}" data-role="None" data-is-notech="true" class="btn btn-ghost !py-1 !px-2 text-[11px] font-medium border border-line">Edit</button>
              ` : `
                <button type="button" data-dp-assign-shift data-ev-id="${ui.esc(item.eventId || '')}" data-ev-name="${ui.esc(item.eventName || '')}" data-space="${ui.esc(item.space || 'The Stage')}" data-start="${ui.esc(item.startTime || '17:00')}" data-end="${ui.esc(item.finishTime || '23:30')}" data-role="${ui.esc(item.role || 'Sound')}" class="btn btn-ghost !py-1 !px-2 text-[11px] font-medium border border-line">+ Add Crew</button>
              `))}
              ${item.eventId ? `<a href="#/advancing/${encodeURIComponent(item.eventId)}" class="text-[11px] font-medium text-accent hover:underline px-1">Event \u2192</a>` : ''}
            </div>
          </div>
        `;
      }

      function renderTechAvailRow(entry) {
        const u = entry.user;
        const availStart = (entry.avail && entry.avail.startTime) ? entry.avail.startTime
          : (entry.avail && entry.avail.dayPart === 'morning' ? '08:00'
            : (entry.avail && entry.avail.dayPart === 'afternoon' ? '13:00'
              : (entry.avail && entry.avail.dayPart === 'evening' ? '18:00' : '17:00')));
        const availEnd = (entry.avail && entry.avail.finishTime) ? entry.avail.finishTime
          : (entry.avail && entry.avail.dayPart === 'morning' ? '13:00'
            : (entry.avail && entry.avail.dayPart === 'afternoon' ? '18:00' : '23:30'));

        return `
          <div class="px-3.5 py-2.5 flex items-start justify-between gap-2.5">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-semibold text-xs text-ink">${ui.esc(entry.name)}</span>
                <span class="text-[11px] text-muted">${ui.esc(u.position || 'Tech')}${u.discipline ? (' · ' + ui.esc(u.discipline)) : ''}</span>
              </div>
              ${entry.tags && entry.tags.length ? `
                <div class="text-[11px] font-mono text-accent/90 mt-0.5 truncate" title="${ui.esc(entry.tags.join(' '))}">
                  ${entry.tags.map(ui.esc).join(' · ')}
                </div>
              ` : ''}
              ${entry.bucket === 'booked' ? `
                <div class="mt-1 space-y-1">
                  ${entry.bookings.map((b) => `
                    <div class="text-[11px] text-warning flex items-center gap-1.5 flex-wrap">
                      <span class="font-mono tabular-nums">${ui.esc(b.startTime || 'TBC')}\u2013${ui.esc(b.finishTime || 'TBC')}</span>
                      <span aria-hidden="true">\u00b7</span>
                      <span class="font-medium text-ink">${ui.esc(b.space || 'Shift')}</span>
                      ${b.eventName ? `<span aria-hidden="true">\u00b7</span><span class="text-muted truncate max-w-[180px]">${ui.esc(b.eventName)}</span>` : ''}
                      <span class="text-[10px] uppercase tracking-wider text-muted">(${ui.esc(b.status || 'pencil')})</span>
                    </div>
                  `).join('')}
                </div>
              ` : (entry.bucket === 'available' ? `
                <div class="text-[11px] text-ok mt-0.5 font-medium">
                  ${ui.esc(entry.live.details || 'All Day')}${entry.avail && entry.avail.notes ? (' · <span class="text-muted font-normal">' + ui.esc(entry.avail.notes) + '</span>') : ''}
                </div>
              ` : (entry.bucket === 'unavailable' ? `
                <div class="text-[11px] text-danger/90 mt-0.5">
                  Unavailable${entry.avail && entry.avail.notes ? (' · ' + ui.esc(entry.avail.notes)) : ''}
                </div>
              ` : `
                <div class="text-[11px] text-muted mt-0.5">No availability submitted for this date</div>
              `))}
            </div>
            <div class="shrink-0 flex items-center gap-1">
              ${entry.bucket === 'booked' && entry.bookings[0] ? `
                <button type="button" data-dp-edit-booking="${ui.esc(entry.bookings[0].id)}" class="btn btn-ghost !py-1 !px-2 text-[11px] border border-line">Edit Shift</button>
              ` : (entry.bucket !== 'unavailable' ? `
                <button type="button" data-dp-book-tech="${ui.esc(u.id)}" data-start="${ui.esc(availStart)}" data-end="${ui.esc(availEnd)}" class="btn ${entry.bucket === 'available' ? 'btn-primary' : 'btn-ghost border border-line'} !py-1 !px-2.5 text-[11px] font-semibold">
                  + Book
                </button>
              ` : '')}
            </div>
          </div>
        `;
      }

      tabContainer.innerHTML = `
        <div id="rota-day-planner" class="space-y-4">
          <!-- Top Day Picker & Operational Summary -->
          <div class="panel p-4 border border-line space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 class="font-display text-base font-semibold text-ink">${ui.esc(displayHeadingDate)}</h2>
                <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted mt-0.5">
                  <span class="font-mono tabular-nums font-semibold text-ink">${dayItems.length} venue ${dayItems.length === 1 ? 'shift' : 'shifts'}</span>
                  ${needsCoveringItems.length > 0 ? `
                    <span aria-hidden="true">\u00b7</span>
                    <span class="inline-flex items-center gap-1 font-semibold text-danger">${ui.icon('alert', 'w-3.5 h-3.5')}<span class="font-mono tabular-nums">${needsCoveringItems.length}</span> needs covering</span>
                  ` : (dayItems.length > 0 ? `
                    <span aria-hidden="true">\u00b7</span>
                    <span class="inline-flex items-center gap-1 font-semibold text-ok">${ui.icon('check', 'w-3.5 h-3.5')}All shifts covered</span>
                  ` : '')}
                  <span aria-hidden="true">\u00b7</span>
                  <span class="text-ok font-semibold font-mono tabular-nums">${availCount} available</span>
                  <span aria-hidden="true">\u00b7</span>
                  <span class="text-warning font-medium font-mono tabular-nums">${bookedCount} booked</span>
                  <span aria-hidden="true">\u00b7</span>
                  <span class="text-danger/90 font-mono tabular-nums">${unavailCount} unavailable</span>
                  <span aria-hidden="true">\u00b7</span>
                  <span class="font-mono tabular-nums">${noDataCount} no data</span>
                </div>
              </div>
              <div class="flex items-center gap-1.5 flex-wrap">
                <button type="button" id="dp-prev-day" class="btn btn-ghost !p-1.5 border border-line" title="Previous day">${ui.icon('chevL', 'w-4 h-4')}</button>
                <button type="button" id="dp-today-btn" class="btn btn-ghost !py-1.5 !px-2.5 text-xs border border-line ${targetDate === todayStr ? 'text-accent font-semibold bg-accent/10 border-accent/30' : ''}">Today</button>
                <input type="date" id="dp-date-picker" class="field !py-1 !px-2 text-xs font-mono tabular-nums !w-auto" value="${ui.esc(targetDate)}" aria-label="Select planning date" />
                <button type="button" id="dp-next-day" class="btn btn-ghost !p-1.5 border border-line" title="Next day">${ui.icon('chevR', 'w-4 h-4')}</button>
                <label class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line text-xs text-muted hover:text-ink cursor-pointer select-none ml-1">
                  <input type="checkbox" id="dp-noncore-toggle" class="w-3.5 h-3.5 accent-[var(--accent)]" ${state.showNonCoreSpaces ? 'checked' : ''} />
                  <span>All Spaces</span>
                </label>
                <button type="button" id="dp-new-shift-btn" class="btn btn-primary !py-1.5 !px-3 text-xs font-semibold">
                  ${ui.icon('plus', 'w-3.5 h-3.5')}<span>Book Shift</span>
                </button>
              </div>
            </div>

            <!-- 7-Day Quick Switcher Strip -->
            <div class="grid grid-cols-7 gap-1.5 pt-2.5 border-t border-line/60">
              ${weekStripDays.map((d) => `
                <button type="button" data-dp-pick-date="${d.date}" class="px-2 py-1.5 rounded-lg border text-left transition cursor-pointer ${d.isSelected ? 'border-accent bg-accent/10 text-ink' : 'border-line/70 bg-panel2/40 hover:bg-panel2 text-muted hover:text-ink'}">
                  <div class="flex items-center justify-between gap-1 text-[10px] uppercase tracking-wider">
                    <span class="${d.isToday ? 'text-accent font-bold' : ''}">${d.dayShort}</span>
                    <span class="font-mono tabular-nums font-semibold ${d.isSelected ? 'text-accent' : 'text-ink'}">${d.dayNum}</span>
                  </div>
                  <div class="mt-1 flex items-center justify-between gap-1 text-[10px] font-mono tabular-nums">
                    <span class="${d.unfilledCount > 0 ? 'text-danger font-bold' : 'text-muted'}" title="${d.shiftCount} shifts (${d.unfilledCount} needs covering)">${d.shiftCount} sh</span>
                    <span class="text-ok" title="${d.availCount} technicians available">${d.availCount} av</span>
                  </div>
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Split View: Two-Section Venue Shifts (Left) & Technician Availability (Right) -->
          <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            <!-- Left Column: Two Clearly Delineated Sections -->
            <div class="lg:col-span-7 space-y-4">
              ${dayItems.length === 0 ? `
                <div class="panel border border-line p-8 text-center text-muted space-y-2">
                  <div class="text-sm font-semibold text-ink">No venue shifts or events scheduled</div>
                  <p class="text-xs">There are no active bookings or advancing events in ${state.showNonCoreSpaces ? 'any space' : 'core spaces'} on ${ui.esc(formatDisplayDate(targetDate))}.</p>
                  <button type="button" id="dp-empty-book-btn" class="btn btn-primary !py-1.5 !px-3 text-xs font-semibold mt-1">+ Book Shift on This Day</button>
                </div>
              ` : `
                <!-- SECTION 1: NEEDS COVERING -->
                <section class="panel border ${needsCoveringItems.length ? 'border-danger/40' : 'border-line'} overflow-hidden" aria-label="Shifts needing cover">
                  <div class="px-4 py-3 border-b ${needsCoveringItems.length ? 'border-danger/25 bg-danger/[0.06]' : 'border-line bg-panel2/40'} flex items-center justify-between gap-2 flex-wrap">
                    <div class="flex items-center gap-2">
                      <span class="${needsCoveringItems.length ? 'text-danger' : 'text-ok'} shrink-0">
                        ${ui.icon(needsCoveringItems.length ? 'alert' : 'check', 'w-4 h-4')}
                      </span>
                      <div>
                        <h3 class="font-display text-sm font-semibold text-ink">Needs Covering</h3>
                        <p class="text-[11px] text-muted">
                          ${needsCoveringItems.length
                            ? 'Unassigned shifts and multi-room spaces still missing crew'
                            : 'No staffing gaps remaining on ' + ui.esc(formatDisplayDate(targetDate))}
                        </p>
                      </div>
                    </div>
                    <span class="text-xs font-mono tabular-nums font-semibold ${needsCoveringItems.length ? 'text-danger' : 'text-ok'}">
                      ${needsCoveringItems.length ? (needsCoveringItems.length + ' ' + (needsCoveringItems.length === 1 ? 'shift' : 'shifts')) : 'All Covered'}
                    </span>
                  </div>
                  ${needsCoveringItems.length ? `
                    <div class="divide-y divide-line/60">
                      ${needsCoveringItems.map(renderDayShiftRow).join('')}
                    </div>
                  ` : `
                    <div class="px-4 py-3.5 text-xs text-muted flex items-center justify-between gap-2">
                      <span>Every event on this date has crew assigned or requires no technical staff.</span>
                      <span class="font-mono tabular-nums text-[11px] text-ok font-semibold">0 gaps</span>
                    </div>
                  `}
                </section>

                <!-- SECTION 2: COVERED & BOOKED SHIFTS -->
                <section class="panel border border-line overflow-hidden" aria-label="Covered and booked shifts">
                  <div class="px-4 py-3 border-b border-line bg-panel2/50 flex items-center justify-between gap-2 flex-wrap">
                    <div class="flex items-center gap-2">
                      <span class="text-ok shrink-0">${ui.icon('check', 'w-4 h-4')}</span>
                      <div>
                        <h3 class="font-display text-sm font-semibold text-ink">Covered &amp; Booked Shifts</h3>
                        <p class="text-[11px] text-muted font-mono tabular-nums">
                          ${confirmedShifts.length} confirmed · ${pencilShifts.length} pencil${selfServiceShifts.length ? (' · ' + selfServiceShifts.length + ' self-service') : ''}
                        </p>
                      </div>
                    </div>
                    <span class="text-xs font-mono tabular-nums font-semibold text-muted">
                      ${coveredItems.length} ${coveredItems.length === 1 ? 'shift' : 'shifts'}
                    </span>
                  </div>
                  ${coveredItems.length ? `
                    <div class="divide-y divide-line/60">
                      ${coveredItems.map(renderDayShiftRow).join('')}
                    </div>
                  ` : `
                    <div class="px-4 py-5 text-center text-xs text-muted">
                      No covered shifts booked yet on ${ui.esc(formatDisplayDate(targetDate))}.
                    </div>
                  `}
                </section>
              `}
            </div>

            <!-- Right Column: Technician Availability That Day -->
            <div class="lg:col-span-5 panel border border-line overflow-hidden">
              <div class="px-4 py-3 border-b border-line bg-panel2/40 space-y-2.5">
                <div class="flex items-center justify-between gap-2">
                  <h3 class="font-display text-sm font-semibold text-ink">Technician Availability</h3>
                  <span class="text-[11px] font-mono tabular-nums text-muted">${filteredTechs.length} of ${techEntries.length} crew</span>
                </div>
                <div class="flex items-center gap-1 flex-wrap text-[11px]">
                  ${[
                    { id: 'all', label: 'All (' + techEntries.length + ')' },
                    { id: 'available', label: 'Available (' + availCount + ')' },
                    { id: 'booked', label: 'Booked (' + bookedCount + ')' },
                    { id: 'unavailable', label: 'Unavailable (' + unavailCount + ')' },
                    { id: 'nodata', label: 'No Data (' + noDataCount + ')' },
                  ].map((f) => `
                    <button type="button" data-dp-avail-filter="${f.id}" class="px-2 py-1 rounded-md border font-medium transition cursor-pointer ${availFilter === f.id ? 'bg-accent text-accent-ink border-accent font-semibold' : 'bg-panel border-line text-muted hover:text-ink'}">
                      ${f.label}
                    </button>
                  `).join('')}
                </div>
                ${venueTags.length ? `
                  <div class="pt-2 border-t border-line/50 space-y-1.5">
                    <div class="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted font-semibold">
                      <span>Filter by Tech Tag</span>
                      ${activeTagFilters.length ? `<button type="button" id="dp-clear-tag-filters" class="text-accent hover:underline normal-case font-medium cursor-pointer">Reset (${activeTagFilters.length})</button>` : ''}
                    </div>
                    <div class="flex items-center gap-1 flex-wrap">
                      ${venueTags.map((vt) => {
                        const isOn = activeTagSet.has(vt.tag.toLowerCase());
                        return `<button type="button" data-dp-tag-filter="${ui.esc(vt.tag)}" class="px-2 py-0.5 rounded border text-[11px] font-mono transition cursor-pointer ${isOn ? 'bg-accent text-accent-ink border-accent font-semibold' : 'bg-panel border-line text-muted hover:text-ink hover:border-accent/50'}">${ui.esc(vt.tag)}</button>`;
                      }).join('')}
                    </div>
                  </div>
                ` : ''}
                <input type="text" id="dp-tech-search" class="field !py-1.5 text-xs w-full" placeholder="Filter techs by name, role, or #tag\u2026" value="${ui.esc(state.dayPlannerTechSearch || '')}" />
              </div>

              ${filteredTechs.length ? `
                <div class="divide-y divide-line/60 max-h-[640px] overflow-y-auto">
                  ${groupOrder.map((grp) => {
                    const members = filteredTechs.filter((t) => t.bucket === grp.key);
                    if (!members.length) return '';
                    return `
                      <div>
                        <div class="px-3.5 py-1.5 bg-panel2/60 border-b border-line/50 flex items-center justify-between text-[11px]">
                          <span class="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider ${grp.tone}">
                            ${ui.icon(grp.icon, 'w-3 h-3')}
                            <span>${grp.title}</span>
                          </span>
                          <span class="font-mono tabular-nums text-muted">${members.length}</span>
                        </div>
                        <div class="divide-y divide-line/40">
                          ${members.map(renderTechAvailRow).join('')}
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              ` : `
                <div class="p-6 text-center text-xs text-muted">
                  No technicians match the active availability or Tech Tag filter.
                </div>
              `}
            </div>
          </div>
        </div>
      `;

      // Wire Day Planner controls
      function shiftSelectedDay(deltaDays) {
        const d = parseDate(state.selectedDay);
        d.setDate(d.getDate() + deltaDays);
        state.selectedDay = formatDate(d);
        renderDayPlannerTab();
      }
      tabContainer.querySelector('#dp-prev-day')?.addEventListener('click', () => shiftSelectedDay(-1));
      tabContainer.querySelector('#dp-next-day')?.addEventListener('click', () => shiftSelectedDay(1));
      tabContainer.querySelector('#dp-today-btn')?.addEventListener('click', () => {
        state.selectedDay = formatDate(new Date());
        renderDayPlannerTab();
      });
      tabContainer.querySelector('#dp-date-picker')?.addEventListener('change', (e) => {
        if (e.target.value) {
          state.selectedDay = normalizeDate(e.target.value);
          renderDayPlannerTab();
        }
      });
      tabContainer.querySelectorAll('[data-dp-pick-date]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const d = btn.getAttribute('data-dp-pick-date');
          if (d) {
            state.selectedDay = d;
            renderDayPlannerTab();
          }
        });
      });
      tabContainer.querySelector('#dp-noncore-toggle')?.addEventListener('change', (e) => {
        state.showNonCoreSpaces = e.target.checked;
        renderDayPlannerTab();
      });
      tabContainer.querySelector('#dp-new-shift-btn')?.addEventListener('click', () => {
        openBookingModal({ date: targetDate, status: 'pencil' });
      });
      tabContainer.querySelector('#dp-empty-book-btn')?.addEventListener('click', () => {
        openBookingModal({ date: targetDate, status: 'pencil' });
      });
      tabContainer.querySelectorAll('[data-dp-avail-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.dayPlannerAvailFilter = btn.getAttribute('data-dp-avail-filter') || 'all';
          renderDayPlannerTab();
        });
      });
      tabContainer.querySelectorAll('[data-dp-tag-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const tag = btn.getAttribute('data-dp-tag-filter');
          if (!tag) return;
          const cur = Array.isArray(state.dayPlannerTagFilters) ? state.dayPlannerTagFilters.slice() : [];
          const idx = cur.findIndex((t) => t.toLowerCase() === tag.toLowerCase());
          if (idx > -1) cur.splice(idx, 1);
          else cur.push(tag);
          state.dayPlannerTagFilters = cur;
          renderDayPlannerTab();
        });
      });
      tabContainer.querySelector('#dp-clear-tag-filters')?.addEventListener('click', () => {
        state.dayPlannerTagFilters = [];
        renderDayPlannerTab();
      });
      const techSearchInp = tabContainer.querySelector('#dp-tech-search');
      if (techSearchInp) {
        techSearchInp.addEventListener('input', (e) => {
          state.dayPlannerTechSearch = e.target.value;
          const pos = e.target.selectionStart;
          renderDayPlannerTab();
          const reInp = tabContainer.querySelector('#dp-tech-search');
          if (reInp) {
            reInp.focus();
            if (typeof pos === 'number') reInp.setSelectionRange(pos, pos);
          }
        });
      }
      tabContainer.querySelectorAll('[data-dp-book-tech]').forEach((btn) => {
        btn.addEventListener('click', () => {
          openBookingModal({
            userId: btn.getAttribute('data-dp-book-tech'),
            date: targetDate,
            startTime: btn.getAttribute('data-start') || '17:00',
            finishTime: btn.getAttribute('data-end') || '23:30',
            status: 'pencil',
          });
        });
      });
      tabContainer.querySelectorAll('[data-dp-assign-shift]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const existingId = btn.getAttribute('data-existing-booking-id');
          if (existingId) {
            const existingB = store.find('bookings', existingId);
            if (existingB) { openBookingModal(existingB); return; }
          }
          openBookingModal({
            eventId: btn.getAttribute('data-ev-id') || '',
            eventName: btn.getAttribute('data-ev-name') || '',
            space: btn.getAttribute('data-space') || 'The Stage',
            date: targetDate,
            startTime: btn.getAttribute('data-start') || '17:00',
            finishTime: btn.getAttribute('data-end') || '23:30',
            role: btn.getAttribute('data-role') || 'Sound',
            isNoTech: btn.getAttribute('data-is-notech') === 'true',
            status: 'pencil',
          });
        });
      });
      tabContainer.querySelectorAll('[data-dp-edit-booking]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-dp-edit-booking');
          const b = id ? store.find('bookings', id) : null;
          if (b) openBookingModal(b);
        });
      });
      tabContainer.querySelectorAll('[data-dp-confirm-booking]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-dp-confirm-booking');
          const b = id ? store.find('bookings', id) : null;
          if (b) {
            b.status = 'confirmed';
            b.updatedAt = Date.now();
            store.upsert('bookings', b);
            ui.toast('Shift confirmed', 'ok');
            renderActiveTab();
          }
        });
      });
    }

    // ------------------------------------------------------------------------
    // TAB 4: ALL SHIFT BOOKINGS LIST
    // ------------------------------------------------------------------------
    function renderListTab() {
      const allUsers = getAllUsers();
      let bookings = getAllBookings().slice().sort((a, b) => (a.date < b.date ? 1 : -1));

      if (state.spaceFilter) bookings = bookings.filter((b) => normalizeSpace(b.space) === normalizeSpace(state.spaceFilter));
      if (state.roleFilter) bookings = bookings.filter((b) => b.role === state.roleFilter);
      if (state.statusFilter) bookings = bookings.filter((b) => b.status === state.statusFilter);
      if (state.techFilter) bookings = bookings.filter((b) => b.userId === state.techFilter);

      let out = `
        <div class="space-y-4">
          <div class="p-3 rounded-xl bg-panel border border-line flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div class="text-xs font-semibold text-ink">
              Master Shift Bookings Registry (${bookings.length} records)
            </div>

            <!-- Filters -->
            <div class="flex items-center gap-2 flex-wrap">
              <select id="list-flt-space" class="field !py-1 text-xs">
                <option value="">${state.showNonCoreSpaces ? 'All Spaces' : 'Core Spaces'}</option>
                ${getVisibleSpacesList().map((s) => `<option value="${ui.esc(s)}" ${state.spaceFilter === s ? 'selected' : ''}>${ui.esc(s)}</option>`).join('')}
              </select>

              <select id="list-flt-status" class="field !py-1 text-xs">
                <option value="">All Statuses</option>
                <option value="confirmed" ${state.statusFilter === 'confirmed' ? 'selected' : ''}>Confirmed</option>
                <option value="pencil" ${state.statusFilter === 'pencil' ? 'selected' : ''}>Pencil</option>
                <option value="declined" ${state.statusFilter === 'declined' ? 'selected' : ''}>Declined</option>
                <option value="cancelled" ${state.statusFilter === 'cancelled' ? 'selected' : ''}>Cancelled</option>
              </select>

              <select id="list-flt-tech" class="field !py-1 text-xs">
                <option value="">All Technicians</option>
                ${allUsers.map((u) => `<option value="${u.id}" ${state.techFilter === u.id ? 'selected' : ''}>${ui.esc(auth.displayName(u))}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="overflow-x-auto border border-line rounded-xl bg-panel">
            <table class="w-full text-xs text-left border-collapse">
              <thead>
                <tr class="bg-panel2/60 border-b border-line text-[11px] font-semibold text-muted">
                  <th class="p-3">Date</th>
                  <th class="p-3">Space</th>
                  <th class="p-3">Event Title</th>
                  <th class="p-3">Hours</th>
                  <th class="p-3">Technician</th>
                  <th class="p-3">Role</th>
                  <th class="p-3">Rate</th>
                  <th class="p-3">Status</th>
                  <th class="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line/60">
      `;

      if (bookings.length === 0) {
        out += `
          <tr>
            <td colspan="9" class="p-8 text-center text-muted italic">
              No shift bookings match the active filter criteria.
            </td>
          </tr>
        `;
      } else {
        bookings.forEach((b) => {
          const techObj = allUsers.find((u) => u.id === b.userId);
          const techName = b.userName || (techObj ? auth.displayName(techObj) : 'Unknown');

          out += `
            <tr class="hover:bg-panel2/40 transition">
              <td class="p-3 font-mono font-bold text-ink whitespace-nowrap">${formatDisplayDate(b.date)}</td>
              <td class="p-3 text-accent font-semibold whitespace-nowrap">${ui.esc(b.space || '—')}</td>
              <td class="p-3 font-semibold text-ink">${ui.esc(b.eventName || 'Shift')}</td>
              <td class="p-3 font-mono tabular-nums text-muted whitespace-nowrap">${b.startTime} – ${b.finishTime}</td>
              <td class="p-3 whitespace-nowrap">
                <div class="font-medium text-ink">${ui.esc(techName)}</div>
                ${techObj && techObj.position ? `<div class="text-[10px] text-muted">${ui.esc(techObj.position)}</div>` : ''}
              </td>
              <td class="p-3">
                <span class="px-2 py-0.5 rounded bg-panel2 border border-line text-[11px] font-semibold text-ink">${ui.esc(b.role || 'Tech')}</span>
              </td>
              <td class="p-3 font-mono text-muted text-[11px]">${ui.esc(b.rate || '—')}</td>
              <td class="p-3">${renderStatusPill(b.status, b.cancellationReason)}</td>
              <td class="p-3 text-right whitespace-nowrap">
                <div class="flex items-center justify-end gap-1.5">
                  <button data-edit-booking="${b.id}" class="btn btn-ghost !py-1 !px-2 text-xs">Edit</button>
                  ${isTechManager && b.status !== 'cancelled' ? `
                    <button data-cancel-booking="${b.id}" class="btn btn-ghost !py-1 !px-2 text-xs text-danger">Cancel</button>
                  ` : ''}
                </div>
              </td>
            </tr>
          `;
        });
      }

      out += `
              </tbody>
            </table>
          </div>
        </div>
      `;

      tabContainer.innerHTML = out;

      // Filter wiring
      tabContainer.querySelector('#list-flt-space')?.addEventListener('change', (e) => {
        state.spaceFilter = e.target.value;
        renderListTab();
      });
      tabContainer.querySelector('#list-flt-status')?.addEventListener('change', (e) => {
        state.statusFilter = e.target.value;
        renderListTab();
      });
      tabContainer.querySelector('#list-flt-tech')?.addEventListener('change', (e) => {
        state.techFilter = e.target.value;
        renderListTab();
      });

      tabContainer.querySelectorAll('[data-edit-booking]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-edit-booking');
          const b = store.find('bookings', id);
          if (b) openBookingModal(b);
        });
      });

      tabContainer.querySelectorAll('[data-cancel-booking]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-cancel-booking');
          const b = store.find('bookings', id);
          if (b) openCancelShiftModal(b);
        });
      });
    }

    // ------------------------------------------------------------------------
    // TAB 3: SHIFT SWAPS & COVER MARKET
    // ------------------------------------------------------------------------
    function renderSwapsTab() {
      const allB = getAllBookings();
      const openSwaps = allB.filter((b) => isActiveOpenSwap(b));
      const myId = me ? me.id : '';

      state.swapFilter = state.swapFilter || 'all'; // 'all' | 'available' | 'my'

      let filteredSwaps = openSwaps;
      if (state.swapFilter === 'available') {
        filteredSwaps = openSwaps.filter((b) => b.userId !== myId && b.swapOfferedBy !== myId);
      } else if (state.swapFilter === 'my') {
        filteredSwaps = openSwaps.filter((b) => b.userId === myId || b.swapOfferedBy === myId);
      }

      // Sort by soonest date first
      filteredSwaps.sort((a, b) => normalizeDate(a.date).localeCompare(normalizeDate(b.date)));

      let out = `
        <div class="space-y-4">
          <!-- Banner & Action Strip -->
          <div class="p-4 rounded-xl bg-panel border border-line flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 shadow-2xs">
            <div class="flex items-center gap-3">
              <span class="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-400 font-bold flex items-center justify-center shrink-0 border border-amber-500/30">
                ${ui.icon('refresh', 'w-5 h-5')}
              </span>
              <div>
                <h2 class="text-sm font-bold text-ink flex items-center gap-2">
                  <span>Shift Swaps & Cover Market</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">
                    ${openSwaps.length} Open Request${openSwaps.length === 1 ? '' : 's'}
                  </span>
                </h2>
                <p class="text-xs text-muted mt-0.5">
                  Pick up extra venue shifts offered by colleagues, or offer one of your shifts for cover.
                </p>
              </div>
            </div>

            <div class="flex items-center gap-2 flex-wrap">
              <button id="btn-post-new-swap" class="btn btn-primary text-xs flex items-center gap-1.5 shadow-xs font-semibold">
                ${ui.icon('plus', 'w-4 h-4')}
                <span>+ Offer a Shift for Swap</span>
              </button>
            </div>
          </div>

          <!-- Filter Strip -->
          <div class="flex items-center justify-between gap-2 flex-wrap text-xs">
            <div class="flex items-center gap-1.5 p-1 rounded-lg bg-panel border border-line">
              <button data-swap-flt="all" class="px-2.5 py-1 font-semibold rounded-md transition ${state.swapFilter === 'all' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink'}">
                All Open Swaps (${openSwaps.length})
              </button>
              <button data-swap-flt="available" class="px-2.5 py-1 font-semibold rounded-md transition ${state.swapFilter === 'available' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink'}">
                Available to Pick Up (${openSwaps.filter((b) => b.userId !== myId && b.swapOfferedBy !== myId).length})
              </button>
              <button data-swap-flt="my" class="px-2.5 py-1 font-semibold rounded-md transition ${state.swapFilter === 'my' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink'}">
                My Swap Offers (${openSwaps.filter((b) => b.userId === myId || b.swapOfferedBy === myId).length})
              </button>
            </div>
          </div>

          <!-- Swaps Cards Grid -->
          <div class="space-y-3">
      `;

      if (filteredSwaps.length === 0) {
        out += `
          <div class="p-12 text-center rounded-xl bg-panel border border-line space-y-3">
            <div class="w-12 h-12 rounded-full bg-panel2 mx-auto flex items-center justify-center text-muted">
              ${ui.icon('refresh', 'w-6 h-6')}
            </div>
            <div class="text-sm font-semibold text-ink">No shift swaps currently being offered</div>
            <p class="text-xs text-muted max-w-md mx-auto">
              ${state.swapFilter === 'my' 
                ? 'You have not offered any of your shifts for cover. You can offer any upcoming shift from your schedule.' 
                : 'All scheduled shifts are currently covered. If you need someone to cover your shift, click "+ Offer a Shift for Swap" above.'}
            </p>
            <div class="pt-2">
              <button id="btn-post-new-swap-empty" class="btn btn-ghost text-xs">
                ${ui.icon('plus', 'w-3.5 h-3.5')}
                <span>Offer One of My Upcoming Shifts</span>
              </button>
            </div>
          </div>
        `;
      } else {
        out += `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">`;
        filteredSwaps.forEach((b) => {
          const isMine = me && (b.userId === me.id || b.swapOfferedBy === me.id);
          const dObj = parseDate(b.date);
          const dateFormatted = dObj.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

          out += `
            <div class="p-4 rounded-xl border bg-panel space-y-3 shadow-2xs hover:border-accent/40 transition flex flex-col justify-between ${isMine ? 'border-amber-500/40 bg-amber-500/5' : 'border-line'}">
              <div class="space-y-2">
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-accent/15 text-accent border border-accent/30 uppercase tracking-wider">${ui.esc(b.space)}</span>
                    <h3 class="text-sm font-bold text-ink mt-1.5">${ui.esc(b.eventName || 'Shift')}</h3>
                  </div>
                  ${isMine ? `
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                      Offered by You
                    </span>
                  ` : `
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      Available to Pick Up
                    </span>
                  `}
                </div>

                <div class="flex items-center gap-2 text-xs text-muted font-mono pt-1 border-t border-line/40 flex-wrap">
                  <span class="text-ink font-semibold">📅 ${dateFormatted}</span>
                  <span>·</span>
                  <span>⏰ ${b.startTime} – ${b.finishTime}</span>
                </div>

                <div class="p-2 rounded-lg bg-panel2 border border-line text-xs space-y-1">
                  <div class="flex items-center justify-between text-muted">
                    <span>Discipline / Role:</span>
                    <strong class="text-ink">${ui.esc(b.role || 'Tech')}</strong>
                  </div>
                  <div class="flex items-center justify-between text-muted">
                    <span>Currently Assigned:</span>
                    <span class="font-medium text-ink">${ui.esc(b.swapOfferedByName || b.userName || 'Tech')}</span>
                  </div>
                </div>

                ${b.swapReason ? `
                  <div class="p-2.5 rounded-lg bg-panel2/60 border border-line/60 text-xs text-muted">
                    <span class="font-semibold text-ink">Note from ${ui.esc(b.swapOfferedByName || b.userName || 'colleague')}:</span>
                    <div class="italic mt-0.5 text-[11px]">“${ui.esc(b.swapReason)}”</div>
                  </div>
                ` : ''}
              </div>

              <div class="pt-2 border-t border-line/50 flex items-center justify-between gap-2">
                ${isMine ? `
                  <span class="text-[11px] text-amber-400 font-medium">Waiting for colleague</span>
                  <button class="btn btn-ghost text-xs text-danger hover:bg-danger/10" data-cancel-swap-btn="${b.id}">
                    Cancel Request
                  </button>
                ` : `
                  <span class="text-[11px] text-muted font-mono">${b.startTime}–${b.finishTime}</span>
                  <button class="btn btn-primary text-xs flex items-center gap-1.5 shadow-2xs font-semibold" data-claim-swap-btn="${b.id}">
                    ${ui.icon('check', 'w-3.5 h-3.5')}
                    <span>Claim Shift / Cover</span>
                  </button>
                `}
              </div>
            </div>
          `;
        });
        out += `</div>`;
      }

      out += `
        </div>
      `;

      tabContainer.innerHTML = out;

      // Event listeners for swaps tab
      tabContainer.querySelectorAll('[data-swap-flt]').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.swapFilter = btn.getAttribute('data-swap-flt');
          renderSwapsTab();
        });
      });

      const onPostNewSwap = () => {
        const myShifts = getAllBookingsRaw()
          .filter((b) => b.userId === (me ? me.id : 'user-3') && b.status !== 'cancelled' && b.status !== 'declined' && !b.isNoTech && !b.swapRequested && isUpcomingShiftDate(b.date) && !isBookingEventCancelled(b))
          .sort((a, b) => normalizeDate(a.date).localeCompare(normalizeDate(b.date)));
        if (myShifts.length === 0) {
          ui.toast('You have no upcoming assigned shifts to offer for swap.', 'info');
          return;
        }
        const m = ui.modal({
          title: 'Offer a Shift for Swap',
          body: `
            <div class="space-y-3.5 text-xs">
              <p class="text-muted">Select which of your upcoming shifts you would like colleagues to cover:</p>
              <div>
                <label class="block font-semibold text-muted mb-1">Choose Shift</label>
                <select id="sel-swap-shift" class="field">
                  ${myShifts.map((b) => `
                    <option value="${b.id}">
                      ${formatDisplayDate(b.date)} (${b.startTime}–${b.finishTime}) · ${ui.esc(b.space)} · ${ui.esc(b.eventName || 'Shift')} (${ui.esc(b.role || 'Tech')})
                    </option>
                  `).join('')}
                </select>
              </div>
              <div>
                <label class="block font-semibold text-muted mb-1">Reason / Note for Colleagues</label>
                <textarea id="swap-offer-reason" class="field" rows="3" placeholder="e.g. Clashing recording session, family event, happy to swap for Sunday..."></textarea>
              </div>
            </div>
          `,
          footer: [
            '<button type="button" class="btn btn-ghost" data-close>Cancel</button>',
            '<button type="button" id="confirm-post-swap" class="btn btn-primary" data-primary>Post Swap Offer</button>',
          ].join(''),
          actions: [
            '<button type="button" class="btn btn-ghost" data-close>Cancel</button>',
            '<button type="button" id="confirm-post-swap" class="btn btn-primary" data-primary>Post Swap Offer</button>',
          ]
        });

        m.root.querySelector('#confirm-post-swap')?.addEventListener('click', () => {
          const shiftId = m.root.querySelector('#sel-swap-shift')?.value;
          const targetB = myShifts.find((b) => b.id === shiftId);
          if (!targetB) return;
          const reason = m.root.querySelector('#swap-offer-reason')?.value.trim();
          targetB.swapRequested = true;
          targetB.swapOfferedBy = me ? me.id : 'user-3';
          targetB.swapOfferedByName = me ? auth.displayName(me) : (targetB.userName || 'Technician');
          targetB.swapOfferedAt = new Date().toISOString();
          targetB.swapReason = reason || 'Shift cover requested';
          store.upsert('bookings', targetB);
          ui.toast('Shift posted to the Shift Swaps board!', 'ok');
          m.close();
          renderActiveTab();
        });
      };

      tabContainer.querySelector('#btn-post-new-swap')?.addEventListener('click', onPostNewSwap);
      tabContainer.querySelector('#btn-post-new-swap-empty')?.addEventListener('click', onPostNewSwap);

      tabContainer.querySelectorAll('[data-claim-swap-btn]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const bid = btn.getAttribute('data-claim-swap-btn');
          const targetB = allB.find((b) => b.id === bid);
          if (targetB) openClaimSwapModal(targetB);
        });
      });

      tabContainer.querySelectorAll('[data-cancel-swap-btn]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const bid = btn.getAttribute('data-cancel-swap-btn');
          const targetB = allB.find((b) => b.id === bid);
          if (targetB) {
            targetB.swapRequested = false;
            store.upsert('bookings', targetB);
            ui.toast('Shift swap request cancelled.', 'ok');
            renderActiveTab();
          }
        });
      });
    }

    // ------------------------------------------------------------------------
    // MODALS: BOOKING, AVAILABILITY, BULK & CANCELLATION
    // ------------------------------------------------------------------------

    // 1. Shift Booking Modal
    function openBookingModal(initialData = {}) {
      const isNew = !initialData.id;
      const initialIsNoTech = isBookingNoTechRecord(initialData);
      const rawEvents = (RMTP.getUpcomingActiveEvents ? RMTP.getUpcomingActiveEvents(initialData.eventId) : getAllEvents());
      const events = rawEvents.filter((e) => (initialData.eventId && e.id === initialData.eventId) || isSpaceAllowed(e.space));
      if (initialData.eventId && !events.some((e) => e.id === initialData.eventId)) {
        const directEv = store.find('advancing', initialData.eventId);
        if (directEv && !directEv.deleted) events.unshift(directEv);
      }
      const allUsers = getAllUsers();
      const initialDate = normalizeDate(initialData.date) || formatDate(new Date());
      const initialStart = normalizeTime(initialData.startTime, '17:00');
      const initialEnd = normalizeTime(initialData.finishTime, '23:30');
      const initialSpace = normalizeSpace(Array.isArray(initialData.space) ? initialData.space[0] : initialData.space) || 'The Stage';
      const initialRolesList = initialIsNoTech ? [] : parseShiftRoles(initialData.role || 'Sound');
      const initialRoleValue = initialIsNoTech ? 'None' : (initialData.role || 'Sound');
      const modalRoleOptions = RMTP.SHIFT_ROLES.slice();
      if (initialRoleValue && initialRoleValue !== 'None' && !modalRoleOptions.includes(initialRoleValue)) {
        modalRoleOptions.push(initialRoleValue);
      }
      const spaceOptions = getVisibleSpacesList();
      if (initialSpace && !spaceOptions.includes(initialSpace)) {
        spaceOptions.push(initialSpace);
      }

      const modalVenueTags = auth.getAllVenueTechTags ? auth.getAllVenueTechTags() : [];
      const selectedModalTags = new Set();

      function formatTechTagSuffix(u) {
        const tags = getTechTags(u);
        return tags.length ? (' [' + tags.join(' ') + ']') : '';
      }

      function getUserOptionsHtml(selectedUserId, targetDate) {
        const dStr = normalizeDate(targetDate) || formatDate(new Date());
        const available = [];
        const booked = [];
        const unavailable = [];
        const general = [];

        allUsers.forEach((u) => {
          if (!u || u.status === 'pending') return;
          if (selectedModalTags.size > 0 && u.id !== selectedUserId) {
            const uTags = new Set(getTechTags(u).map((t) => t.toLowerCase()));
            for (const reqTag of selectedModalTags) {
              if (!uTags.has(reqTag)) return;
            }
          }
          const live = getTechLiveStatus(u.id, dStr);
          if (live.booked) {
            booked.push({ u, live });
          } else if (live.available === true) {
            available.push({ u, live });
          } else if (live.available === false) {
            unavailable.push({ u, live });
          } else {
            general.push({ u, live });
          }
        });

        let html = '<option value="">Select a technician / freelancer…</option>';

        if (available.length) {
          html += '<optgroup label="✓ Available on this Date (' + available.length + ')">';
          available.forEach(({ u, live }) => {
            html += `<option value="${u.id}" ${u.id === selectedUserId ? 'selected' : ''}>` +
              `✓ ${ui.esc(auth.displayName(u))} — ${ui.esc(live.details || 'Available')} (${ui.esc(u.position || 'Tech')})${ui.esc(formatTechTagSuffix(u))}` +
            `</option>`;
          });
          html += '</optgroup>';
        }

        if (general.length) {
          html += '<optgroup label="Other Registered Technicians (' + general.length + ')">';
          general.forEach(({ u }) => {
            html += `<option value="${u.id}" ${u.id === selectedUserId ? 'selected' : ''}>` +
              `${ui.esc(auth.displayName(u))} (${ui.esc(u.position || 'Tech')})${ui.esc(formatTechTagSuffix(u))}` +
            `</option>`;
          });
          html += '</optgroup>';
        }

        if (booked.length) {
          html += '<optgroup label="⚠️ Already Booked on Another Shift (' + booked.length + ')">';
          booked.forEach(({ u, live }) => {
            html += `<option value="${u.id}" ${u.id === selectedUserId ? 'selected' : ''}>` +
              `⚠️ ${ui.esc(auth.displayName(u))} — ${ui.esc(live.label)}${ui.esc(formatTechTagSuffix(u))}` +
            `</option>`;
          });
          html += '</optgroup>';
        }

        if (unavailable.length) {
          html += '<optgroup label="✕ Marked Unavailable (' + unavailable.length + ')">';
          unavailable.forEach(({ u, live }) => {
            html += `<option value="${u.id}" ${u.id === selectedUserId ? 'selected' : ''}>` +
              `✕ ${ui.esc(auth.displayName(u))} — ${ui.esc(live.label)}${ui.esc(formatTechTagSuffix(u))}` +
            `</option>`;
          });
          html += '</optgroup>';
        }

        html += '<optgroup label="Custom / Other">';
        html += `<option value="__custom__" ${(!selectedUserId && initialData.userName && initialData.userName !== 'Unassigned' && !initialIsNoTech) ? 'selected' : ''}>+ Other / External Freelancer (Type Name)</option>`;
        html += `<option value="__notech__" ${initialIsNoTech ? 'selected' : ''}>No Tech Needed (Self-Service)</option>`;
        html += '</optgroup>';

        return html;
      }

      const m = ui.modal({
        title: isNew ? 'Book Shift / Freelancer' : 'Edit Shift Booking',
        body: `
          <div class="space-y-4 text-xs">
            <!-- Event Linkage -->
            <div>
              <label class="block font-semibold text-muted mb-1">Advancing Event (Optional Link)</label>
              <select id="b-event" class="field">
                <option value="">Standalone Shift / Dark Day / Maintenance</option>
                ${events.map((e) => `
                  <option value="${e.id}" ${e.id === initialData.eventId ? 'selected' : ''}>
                    ${ui.esc(e.date ? ui.formatDate(e.date) : 'TBC')} — ${ui.esc(e.name)} (${ui.esc(Array.isArray(e.space) ? e.space.join(', ') : e.space)})
                  </option>
                `).join('')}
              </select>
            </div>

            <!-- Custom Event Title & Space -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold text-muted mb-1">Shift / Event Title</label>
                <input id="b-event-name" class="field" value="${ui.esc(initialData.eventName || '')}" placeholder="e.g. Kokoroko Live, Film Premiere" />
              </div>
              <div>
                <label class="block font-semibold text-muted mb-1">Venue Space</label>
                <select id="b-space" class="field">
                  ${spaceOptions.map((s) => `
                    <option value="${ui.esc(s)}" ${s === initialSpace ? 'selected' : ''}>${ui.esc(s)}</option>
                  `).join('')}
                </select>
              </div>
            </div>

            <!-- Space Crew Specification & Required Disciplines Banner -->
            <div id="b-space-crew-specs-box" class="p-2.5 rounded-lg bg-panel2/70 border border-line flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs shadow-2xs">
            </div>

            <!-- Date & Hours -->
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label class="block font-semibold text-muted mb-1">Date</label>
                <input type="date" id="b-date" class="field" value="${initialDate}" />
              </div>
              <div>
                <label class="block font-semibold text-muted mb-1">Start Time</label>
                <input type="time" id="b-start" class="field font-mono" value="${initialStart}" />
              </div>
              <div>
                <label class="block font-semibold text-muted mb-1">Finish Time</label>
                <input type="time" id="b-end" class="field font-mono" value="${initialEnd}" />
              </div>
            </div>

            <!-- Shift Duration & Split Shift Actions -->
            <div class="flex items-center justify-between p-2.5 rounded-lg bg-panel2/70 border border-line flex-wrap gap-2 shadow-2xs">
              <div class="flex items-center gap-2">
                <span class="text-xs text-muted font-medium">Shift Duration:</span>
                <span id="b-shift-duration-badge" class="font-mono font-bold text-accent px-2 py-0.5 rounded bg-panel border border-line text-xs">
                  ${RMTP.getShiftDurationHours ? RMTP.getShiftDurationHours(initialStart, initialEnd) : 6.5}h
                </span>
                ${(initialData.splitFromId || initialData.legIndex) ? `
                  <span class="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-accent/15 text-accent border border-accent/30">
                    Handover Leg ${initialData.legIndex || 1}
                  </span>
                ` : ''}
              </div>
              <button type="button" id="b-btn-split-this-shift" class="px-2.5 py-1 rounded text-xs font-semibold border border-accent/50 text-accent hover:bg-accent/10 transition flex items-center gap-1.5 shadow-2xs cursor-pointer" title="Split this shift into 2 handover shifts (e.g. 6h + 6h with individual start/finish times)">
                ${ui.icon('split', 'w-3.5 h-3.5')}
                <span>Split Shift into Handover Legs</span>
              </button>
            </div>

            <!-- Technician Picker with LIVE AVAILABILITY STATUS & TECH TAG FILTER -->
            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="font-semibold text-muted">Technician / Freelancer</label>
                <span id="b-avail-status-tag" class="text-[11px] font-semibold px-2 py-0.5 rounded border">Live Availability</span>
              </div>
              ${modalVenueTags.length ? `
                <div id="b-tech-tag-bar" class="mb-2 flex items-center gap-1 flex-wrap">
                  <span class="text-[10px] font-semibold uppercase tracking-wider text-muted mr-1">Filter Tag:</span>
                  <button type="button" data-b-tag-filter="" class="px-2 py-0.5 rounded border text-[11px] font-medium bg-accent text-accent-ink border-accent cursor-pointer">All</button>
                  ${modalVenueTags.map((vt) => `
                    <button type="button" data-b-tag-filter="${ui.esc(vt.tag)}" class="px-2 py-0.5 rounded border text-[11px] font-mono bg-panel border-line text-muted hover:text-ink hover:border-accent/50 transition cursor-pointer">${ui.esc(vt.tag)}</button>
                  `).join('')}
                </div>
              ` : ''}
              <select id="b-user" class="field font-medium">
                ${getUserOptionsHtml(initialData.userId, initialDate)}
              </select>
              <label class="flex items-center gap-2 cursor-pointer mt-2 text-xs text-muted hover:text-ink">
                <input type="checkbox" id="b-is-notech" class="rounded border-line" ${initialIsNoTech ? 'checked' : ''} />
                <span>Mark as Self-Service (No Tech Needed)</span>
              </label>
              <div id="b-custom-wrap" class="${(!initialData.userId && initialData.userName && initialData.userName !== 'Unassigned' && !initialIsNoTech) ? 'block' : 'hidden'} mt-2">
                <label class="block font-semibold text-muted mb-1">Freelancer Full Name</label>
                <input id="b-custom-name" class="field" value="${ui.esc(initialData.userName && initialData.userName !== 'Unassigned' && !initialIsNoTech ? initialData.userName : '')}" placeholder="e.g. Alex Morgan (Freelance Sound)" />
              </div>
              <p id="b-selected-tech-tags" class="text-[11px] font-mono text-accent/90 mt-1 hidden"></p>
              <p id="b-avail-details-text" class="text-[11px] text-muted mt-1 italic"></p>
            </div>

            <!-- Role & Booking Status -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold text-muted mb-1">Shift Role</label>
                <select id="b-role" class="field">
                  ${modalRoleOptions.map((r) => `
                    <option value="${ui.esc(r)}" ${r === initialRoleValue ? 'selected' : ''}>${ui.esc(r)}</option>
                  `).join('')}
                </select>
                <!-- Selective Understaffing / Dual-Role Cover -->
                <div id="b-dual-role-wrap" class="mt-2 space-y-1">
                  <div class="text-[10px] font-semibold uppercase tracking-wider text-muted">Cover Multiple Roles (Single-Tech / Understaff)</div>
                  <div class="flex flex-wrap gap-1" id="b-dual-role-chips">
                    ${(RMTP.DISCIPLINES || ['Sound', 'Lighting', 'Cinema', 'AV', 'Stage', 'Support']).map((disc) => {
                      const active = initialRolesList.some((r) => r.toLowerCase() === disc.toLowerCase());
                      return `<button type="button" data-b-multi-role="${ui.esc(disc)}" class="px-2 py-0.5 rounded border text-[10.5px] font-medium transition cursor-pointer ${active ? 'bg-accent text-accent-ink border-accent font-semibold' : 'bg-panel border-line text-muted hover:text-ink hover:border-accent/50'}">${ui.esc(disc)}</button>`;
                    }).join('')}
                  </div>
                </div>
              </div>
              <div>
                <label class="block font-semibold text-muted mb-1">Booking Lifecycle Status</label>
                <select id="b-status" class="field font-semibold">
                  <option value="pencil" ${initialData.status === 'pencil' ? 'selected' : ''}>Pencil (Provisional Hold)</option>
                  <option value="confirmed" ${initialData.status === 'confirmed' ? 'selected' : ''}>Confirmed (Firm Booking)</option>
                  <option value="declined" ${initialData.status === 'declined' ? 'selected' : ''}>Declined (Tech Unavailable)</option>
                  ${(isTechManager || isAdmin) ? `<option value="cancelled" ${initialData.status === 'cancelled' ? 'selected' : ''}>Cancelled (Venue)</option>` : ''}
                </select>
              </div>
            </div>

            <!-- Rate & Notes -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold text-muted mb-1">Agreed Rate (Optional)</label>
                <input id="b-rate" class="field font-mono" value="${ui.esc(initialData.rate || '')}" placeholder="e.g. £240 / shift" />
              </div>
              <div>
                <label class="block font-semibold text-muted mb-1">Shift Notes / Brief</label>
                <input id="b-notes" class="field" value="${ui.esc(initialData.notes || '')}" placeholder="e.g. FOH sound check, radio mic setup" />
              </div>
            </div>
          </div>
        `,
        footer: [
          ...(!isNew ? [
            '<button type="button" id="b-delete" class="btn btn-danger mr-auto flex items-center gap-1.5">' + ui.icon('trash', 'w-4 h-4') + '<span>Delete</span></button>'
          ] : []),
          '<button type="button" id="b-modal-split-btn" class="btn btn-ghost border border-accent/40 text-accent hover:bg-accent/10 flex items-center gap-1.5">' + ui.icon('split', 'w-4 h-4') + '<span>Split Shift</span></button>',
          '<button type="button" class="btn btn-ghost" data-close>Cancel</button>',
          '<button type="button" id="b-save" class="btn btn-primary font-semibold flex items-center gap-1.5 shadow-sm" data-primary>' + ui.icon('check', 'w-4 h-4') + '<span>Save Booking</span></button>',
        ].join(''),
        actions: [
          ...(!isNew ? [
            '<button type="button" id="b-delete" class="btn btn-danger mr-auto flex items-center gap-1.5">' + ui.icon('trash', 'w-4 h-4') + '<span>Delete</span></button>'
          ] : []),
          '<button type="button" id="b-modal-split-btn" class="btn btn-ghost border border-accent/40 text-accent hover:bg-accent/10 flex items-center gap-1.5">' + ui.icon('split', 'w-4 h-4') + '<span>Split Shift</span></button>',
          '<button type="button" class="btn btn-ghost" data-close>Cancel</button>',
          '<button type="button" id="b-save" class="btn btn-primary font-semibold flex items-center gap-1.5 shadow-sm" data-primary>' + ui.icon('check', 'w-4 h-4') + '<span>Save Booking</span></button>',
        ]
      });

      const userSel = m.root.querySelector('#b-user');
      const dateInp = m.root.querySelector('#b-date');
      const eventSel = m.root.querySelector('#b-event');
      const eventNameInp = m.root.querySelector('#b-event-name');
      const spaceSel = m.root.querySelector('#b-space');
      const tagEl = m.root.querySelector('#b-avail-status-tag');
      const detailsEl = m.root.querySelector('#b-avail-details-text');
      const techTagsLine = m.root.querySelector('#b-selected-tech-tags');
      const customWrap = m.root.querySelector('#b-custom-wrap');
      const customNameInp = m.root.querySelector('#b-custom-name');

      // Wire Tech Tag filter buttons inside Booking Modal
      function syncModalTagFilterButtons() {
        m.root.querySelectorAll('[data-b-tag-filter]').forEach((btn) => {
          const val = btn.getAttribute('data-b-tag-filter') || '';
          const active = val === '' ? selectedModalTags.size === 0 : selectedModalTags.has(val.toLowerCase());
          btn.className = 'px-2 py-0.5 rounded border text-[11px] ' + (val ? 'font-mono ' : 'font-medium ') +
            (active ? 'bg-accent text-accent-ink border-accent font-semibold cursor-pointer' : 'bg-panel border-line text-muted hover:text-ink hover:border-accent/50 transition cursor-pointer');
        });
      }
      m.root.querySelectorAll('[data-b-tag-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const val = btn.getAttribute('data-b-tag-filter') || '';
          if (!val) {
            selectedModalTags.clear();
          } else {
            const key = val.toLowerCase();
            if (selectedModalTags.has(key)) selectedModalTags.delete(key);
            else selectedModalTags.add(key);
          }
          const curVal = userSel.value;
          userSel.innerHTML = getUserOptionsHtml(curVal, dateInp.value);
          if (curVal && Array.from(userSel.options).some((o) => o.value === curVal)) {
            userSel.value = curVal;
          }
          syncModalTagFilterButtons();
          updateAvailabilityCheck();
        });
      });

      const roleSel = m.root.querySelector('#b-role');
      const statusSel = m.root.querySelector('#b-status');
      const rateInp = m.root.querySelector('#b-rate');
      const dualRoleWrap = m.root.querySelector('#b-dual-role-wrap');
      const saveBtnLabel = m.root.querySelector('#b-save span');

      function setRoleValueOnSelect(val) {
        if (!roleSel || !val) return;
        let opt = Array.from(roleSel.options).find((o) => o.value.toLowerCase() === String(val).toLowerCase());
        if (!opt) {
          opt = document.createElement('option');
          opt.value = val;
          opt.textContent = val;
          roleSel.appendChild(opt);
        }
        roleSel.value = opt.value;
        syncDualRoleChipsFromSelect();
      }

      function syncDualRoleChipsFromSelect() {
        const curRoles = new Set(parseShiftRoles(roleSel ? roleSel.value : '').map((r) => r.toLowerCase()));
        m.root.querySelectorAll('[data-b-multi-role]').forEach((chip) => {
          const disc = chip.getAttribute('data-b-multi-role') || '';
          const active = curRoles.has(disc.toLowerCase());
          chip.className = 'px-2 py-0.5 rounded border text-[10.5px] font-medium transition cursor-pointer ' +
            (active ? 'bg-accent text-accent-ink border-accent font-semibold' : 'bg-panel border-line text-muted hover:text-ink hover:border-accent/50');
        });
      }

      m.root.querySelectorAll('[data-b-multi-role]').forEach((chip) => {
        chip.addEventListener('click', () => {
          const disc = chip.getAttribute('data-b-multi-role');
          if (!disc || !roleSel) return;
          const cur = parseShiftRoles(roleSel.value);
          const idx = cur.findIndex((r) => r.toLowerCase() === disc.toLowerCase());
          if (idx > -1) {
            if (cur.length > 1) cur.splice(idx, 1);
          } else {
            cur.push(disc);
          }
          setRoleValueOnSelect(mergeShiftRoles(cur));
          updateAvailabilityCheck();
        });
      });

      if (roleSel) {
        roleSel.addEventListener('change', () => {
          syncDualRoleChipsFromSelect();
          updateAvailabilityCheck();
        });
      }

      function findCollapsibleBooking(targetUserId, targetUserName, targetDate, targetSpace, targetEventId, targetEventName) {
        const allB = getAllBookingsRaw();
        return allB.find((b) => {
          if (!b || b.id === initialData.id) return false;
          if (b.status === 'cancelled' || b.status === 'declined') return false;
          if (isBookingNoTechRecord(b) || isPlaceholderBooking(b, allUsers)) return false;
          if (!isSameTechKey(b.userId, b.userName, targetUserId, targetUserName)) return false;
          if (!isSameEventAndSpace(b, { date: targetDate, space: targetSpace, eventId: targetEventId, eventName: targetEventName })) return false;
          if (isDistinctHandoverLeg(b, initialData)) return false;
          return true;
        }) || null;
      }

      function updateAvailabilityCheck() {
        const uid = userSel.value;
        const dStr = dateInp.value;
        const noTechCheck = m.root.querySelector('#b-is-notech');
        const isNoTechActive = (noTechCheck && noTechCheck.checked) || uid === '__notech__';

        if (techTagsLine) {
          const tList = (uid && uid !== '__custom__' && uid !== '__notech__') ? getTechTags(uid) : [];
          if (tList.length) {
            techTagsLine.textContent = 'Tech Tags: ' + tList.join(' · ');
            techTagsLine.classList.remove('hidden');
          } else {
            techTagsLine.textContent = '';
            techTagsLine.classList.add('hidden');
          }
        }

        if (isNoTechActive) {
          if (customWrap) customWrap.classList.add('hidden');
          tagEl.className = 'text-[11px] font-semibold px-2 py-0.5 rounded bg-panel2 border border-line text-emerald-400';
          tagEl.textContent = 'Self-Service · No Tech';
          detailsEl.textContent = 'No technical crew required. Unassigned crew slots for this room will be cleared and moved out of Needs Covering.';
          detailsEl.className = 'text-[11px] text-emerald-400/90 mt-1';
          if (roleSel) {
            let opt = Array.from(roleSel.options).find((o) => o.value === 'None');
            if (!opt) {
              opt = document.createElement('option');
              opt.value = 'None';
              opt.textContent = 'None';
              roleSel.appendChild(opt);
            }
            roleSel.value = 'None';
            roleSel.disabled = true;
          }
          if (statusSel) {
            statusSel.value = 'confirmed';
            statusSel.disabled = true;
          }
          if (rateInp) rateInp.disabled = true;
          if (dualRoleWrap) dualRoleWrap.classList.add('hidden');
          if (saveBtnLabel) saveBtnLabel.textContent = 'Save (No Tech Needed)';
          return;
        }

        // Re-enable fields when switching off No Tech Needed
        if (roleSel) {
          roleSel.disabled = false;
          if (roleSel.value === 'None') {
            const specs = RMTP.getSpaceCrewSpecs ? RMTP.getSpaceCrewSpecs(spaceSel.value) : null;
            setRoleValueOnSelect((specs && specs.rolesList && specs.rolesList[0]) || 'Sound');
          }
        }
        if (statusSel) statusSel.disabled = false;
        if (rateInp) rateInp.disabled = false;
        if (dualRoleWrap) dualRoleWrap.classList.remove('hidden');
        if (saveBtnLabel) saveBtnLabel.textContent = 'Save Booking';

        if (uid === '__custom__') {
          if (customWrap) customWrap.classList.remove('hidden');
          tagEl.className = 'text-[11px] font-semibold px-2 py-0.5 rounded bg-panel2 border border-line text-ink';
          tagEl.textContent = 'External Freelancer';
          detailsEl.textContent = 'External contractor booking. Specify name above.';
          detailsEl.className = 'text-[11px] text-muted mt-1 italic';
          return;
        }

        if (customWrap) customWrap.classList.add('hidden');

        if (!uid || !dStr) {
          tagEl.className = 'text-[11px] font-semibold px-2 py-0.5 rounded bg-panel border border-line text-muted';
          tagEl.textContent = 'Select technician & date';
          detailsEl.textContent = '';
          return;
        }

        // Check if this technician is already booked on THIS SAME event & space -> dual-role collapse preview!
        const curEvId = eventSel.value || initialData.eventId || '';
        const curEvName = eventNameInp.value.trim() || initialData.eventName || '';
        const curSpace = normalizeSpace(spaceSel.value) || 'The Stage';
        const techObj = allUsers.find((u) => u.id === uid);
        const techDispName = techObj ? auth.displayName(techObj) : '';
        const collapsible = findCollapsibleBooking(uid, techDispName, dStr, curSpace, curEvId, curEvName);
        if (collapsible) {
          const combinedRole = mergeShiftRoles(collapsible.role, roleSel ? roleSel.value : 'Sound');
          tagEl.className = 'text-[11px] font-semibold px-2 py-0.5 rounded border text-accent bg-accent/10 border-accent/30';
          tagEl.textContent = 'Dual-Role Merge';
          detailsEl.textContent = `Already booked as ${collapsible.role || 'Tech'} on this shift — saving will collapse into a single entry (${techDispName}, ${combinedRole}).`;
          detailsEl.className = 'text-[11px] text-accent mt-1 font-semibold';
          return;
        }

        const live = getTechLiveStatus(uid, dStr);
        tagEl.className = `text-[11px] font-semibold px-2 py-0.5 rounded border ${live.statusClass}`;
        tagEl.textContent = live.label;

        if (live.booked) {
          detailsEl.textContent = '⚠️ Attention: This technician already has another shift scheduled on this date.';
          detailsEl.className = 'text-[11px] text-amber-400 mt-1 font-semibold';
        } else if (live.available === false) {
          detailsEl.textContent = '⚠️ Note: Technician marked themselves as Unavailable on this date.';
          detailsEl.className = 'text-[11px] text-rose-400 mt-1 font-semibold';
        } else if (live.available === true) {
          detailsEl.textContent = '✓ Verified: Technician is logged as Available for this session.';
          detailsEl.className = 'text-[11px] text-emerald-400 mt-1 font-semibold';
        } else {
          detailsEl.textContent = 'No availability record logged yet by this technician.';
          detailsEl.className = 'text-[11px] text-muted mt-1 italic';
        }
      }

      userSel.addEventListener('change', () => {
        const noTechCheck = m.root.querySelector('#b-is-notech');
        if (noTechCheck) {
          noTechCheck.checked = (userSel.value === '__notech__');
        }
        updateAvailabilityCheck();
      });
      dateInp.addEventListener('change', () => {
        const curVal = userSel.value;
        userSel.innerHTML = getUserOptionsHtml(curVal, dateInp.value);
        updateAvailabilityCheck();
      });

      const noTechCheck = m.root.querySelector('#b-is-notech');
      if (noTechCheck) {
        noTechCheck.addEventListener('change', () => {
          if (noTechCheck.checked) {
            userSel.value = '__notech__';
          } else if (userSel.value === '__notech__') {
            userSel.value = '';
          }
          updateAvailabilityCheck();
        });
      }

      updateAvailabilityCheck();

      // Space Crew Specs Dynamic Display & Quick Discipline Selection
      function updateSpaceSpecsBanner() {
        const curSpace = spaceSel.value;
        const specsBox = m.root.querySelector('#b-space-crew-specs-box');
        if (!specsBox) return;
        const specs = RMTP.getSpaceCrewSpecs ? RMTP.getSpaceCrewSpecs(curSpace) : { total: 1, disciplines: [{ role: 'Sound', count: 1 }], summary: '1x Sound' };

        const pillsHtml = (specs.disciplines || []).map((d) => {
          return `<button type="button" data-pick-spec-role="${ui.esc(d.role)}" class="px-2 py-0.5 rounded text-[10.5px] font-semibold border transition hover:opacity-85 flex items-center gap-1 bg-panel border-line text-ink hover:border-accent" title="Set shift role to ${ui.esc(d.role)}">
            <span>${d.count}x ${ui.esc(d.role)}</span>
          </button>`;
        }).join('');

        specsBox.innerHTML = `
          <div class="flex items-center gap-2 flex-wrap min-w-0">
            <span class="font-bold text-ink flex items-center gap-1 shrink-0">
              ${ui.icon('users', 'w-3.5 h-3.5 text-accent')}
              <span>${ui.esc(curSpace)} Specs:</span>
            </span>
            <span class="font-mono font-bold text-accent">${specs.total} Minimum Crew</span>
            <span class="text-muted text-[11px]">(${ui.esc(specs.summary)})</span>
          </div>
          <div class="flex items-center gap-1.5 flex-wrap shrink-0">
            <span class="text-[10px] text-muted uppercase font-bold tracking-wider mr-0.5">Required Disciplines:</span>
            ${pillsHtml}
          </div>
        `;

        specsBox.querySelectorAll('[data-pick-spec-role]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const r = btn.getAttribute('data-pick-spec-role');
            if (roleSel && r && !roleSel.disabled) {
              setRoleValueOnSelect(r);
              updateAvailabilityCheck();
              ui.toast(`Selected discipline: ${r}`, 'info');
            }
          });
        });
      }

      spaceSel.addEventListener('change', () => {
        updateSpaceSpecsBanner();
        const specs = RMTP.getSpaceCrewSpecs ? RMTP.getSpaceCrewSpecs(spaceSel.value) : null;
        if (specs && specs.rolesList && specs.rolesList.length && roleSel && !roleSel.disabled) {
          const curRoles = parseShiftRoles(roleSel.value);
          if (!initialData.role || (curRoles.length <= 1 && !specs.rolesList.includes(roleSel.value))) {
            setRoleValueOnSelect(specs.rolesList[0]);
          }
        }
        updateAvailabilityCheck();
      });
      updateSpaceSpecsBanner();

      // If linking advancing event, auto-fill event name, space, date & refresh live availability
      eventSel.addEventListener('change', () => {
        const evId = eventSel.value;
        if (evId) {
          const ev = store.find('advancing', evId);
          if (ev) {
            eventNameInp.value = ev.name || '';
            const evSpace = normalizeSpace(Array.isArray(ev.space) ? ev.space[0] : ev.space) || 'The Stage';
            if (!Array.from(spaceSel.options).some((o) => o.value === evSpace)) {
              const opt = document.createElement('option');
              opt.value = evSpace;
              opt.textContent = evSpace;
              spaceSel.appendChild(opt);
            }
            spaceSel.value = evSpace;
            const normDate = normalizeDate(ev.date);
            if (normDate) {
              dateInp.value = normDate;
              const curUser = userSel.value;
              userSel.innerHTML = getUserOptionsHtml(curUser, normDate);
              if (curUser) userSel.value = curUser;
            }
            if (ev.startTime) m.root.querySelector('#b-start').value = normalizeTime(ev.startTime, '17:00');
            if (ev.finishTime) m.root.querySelector('#b-end').value = normalizeTime(ev.finishTime, '23:30');
            updateDurationBadge();
            updateAvailabilityCheck();
            updateSpaceSpecsBanner();
          }
        }
      });

      function updateDurationBadge() {
        const sTime = m.root.querySelector('#b-start')?.value || '17:00';
        const eTime = m.root.querySelector('#b-end')?.value || '23:30';
        const dur = RMTP.getShiftDurationHours ? RMTP.getShiftDurationHours(sTime, eTime) : 0;
        const durBadge = m.root.querySelector('#b-shift-duration-badge');
        if (durBadge) durBadge.textContent = dur + 'h';
      }
      m.root.querySelector('#b-start')?.addEventListener('change', updateDurationBadge);
      m.root.querySelector('#b-end')?.addEventListener('change', updateDurationBadge);

      function triggerSplitFromBooking() {
        const currentFormShift = {
          id: initialData.id,
          eventId: eventSel.value || initialData.eventId,
          eventName: eventNameInp.value.trim() || initialData.eventName || 'Venue Shift',
          space: spaceSel.value,
          date: dateInp.value,
          startTime: m.root.querySelector('#b-start')?.value || initialData.startTime || '10:00',
          finishTime: m.root.querySelector('#b-end')?.value || initialData.finishTime || '22:00',
          userId: userSel.value && userSel.value !== '__custom__' && userSel.value !== '__notech__' ? userSel.value : '',
          userName: userSel.value === '__custom__' ? (customNameInp?.value || '') : (userSel.value ? '' : initialData.userName),
          role: m.root.querySelector('#b-role')?.value || initialData.role || 'Sound',
          status: m.root.querySelector('#b-status')?.value || initialData.status || 'pencil',
          rate: m.root.querySelector('#b-rate')?.value || '',
          notes: m.root.querySelector('#b-notes')?.value || '',
          splitFromId: initialData.splitFromId || '',
          legIndex: initialData.legIndex || '',
        };
        m.close();
        openSplitShiftModal(currentFormShift);
      }

      m.root.querySelectorAll('#b-btn-split-this-shift, #b-modal-split-btn').forEach((btn) => {
        btn.addEventListener('click', triggerSplitFromBooking);
      });

      // Save
      m.root.querySelector('#b-save').addEventListener('click', () => {
        const userId = userSel.value;
        const bookingDate = normalizeDate(dateInp.value);
        const noTechCheck = m.root.querySelector('#b-is-notech');
        const isNoTechChecked = (noTechCheck && noTechCheck.checked) || userId === '__notech__';

        if (!bookingDate) {
          ui.toast('Date is required', 'danger');
          dateInp.focus();
          return;
        }

        let finalUserId = '';
        let finalUserName = '';
        let isFreelancerFlag = false;

        if (isNoTechChecked) {
          finalUserId = '';
          finalUserName = 'No Tech Required';
          isFreelancerFlag = false;
        } else if (userId === '__custom__') {
          const cName = (customNameInp ? customNameInp.value : '').trim();
          if (!cName) {
            ui.toast('Please enter the freelancer\'s name', 'danger');
            if (customNameInp) customNameInp.focus();
            return;
          }
          finalUserId = '';
          finalUserName = cName;
          isFreelancerFlag = true;
        } else if (userId) {
          const techObj = allUsers.find((u) => u.id === userId);
          finalUserId = userId;
          finalUserName = techObj ? auth.displayName(techObj) : (initialData.userName || 'Technician');
          isFreelancerFlag = techObj ? (techObj.position === 'Freelancer') : false;
        } else {
          ui.toast('Please select a technician / freelancer (or mark No Tech Needed)', 'danger');
          userSel.focus();
          return;
        }

        const bookedSpace = normalizeSpace(spaceSel.value) || 'The Stage';
        const bookedTitle = eventNameInp.value.trim() || 'Venue Shift';

        // Auto-link to an existing active Advancing event when none explicitly selected but exact date + space + name match
        let resolvedEventId = eventSel.value || initialData.eventId || '';
        if (!resolvedEventId && bookedTitle !== 'Venue Shift') {
          const titleLower = bookedTitle.toLowerCase();
          const matchedAdv = (store.all('advancing') || []).find((ev) => {
            if (!ev || ev.deleted) return false;
            const st = String(ev.status || '').trim().toLowerCase();
            if (st === 'cancelled' || st === 'canceled') return false;
            if (normalizeDate(ev.date) !== bookingDate) return false;
            if (String(ev.name || '').trim().toLowerCase() !== titleLower) return false;
            const spList = Array.isArray(ev.space)
              ? ev.space.map((s) => normalizeSpace(s))
              : String(ev.space || '').split(',').map((s) => normalizeSpace(s)).filter(Boolean);
            return spList.includes(bookedSpace);
          });
          if (matchedAdv) resolvedEventId = matchedAdv.id;
        }

        const nowIso = new Date().toISOString();
        const selectedRole = isNoTechChecked ? 'None' : (m.root.querySelector('#b-role').value || 'Sound');
        const selectedStatus = isNoTechChecked ? 'confirmed' : (m.root.querySelector('#b-status').value || 'pencil');
        const selectedRate = m.root.querySelector('#b-rate').value.trim();
        const selectedNotes = m.root.querySelector('#b-notes').value.trim();
        const selectedStart = normalizeTime(m.root.querySelector('#b-start').value, '17:00');
        const selectedEnd = normalizeTime(m.root.querySelector('#b-end').value, '23:30');

        let record = null;
        let collapsedDualRole = false;

        if (isNoTechChecked) {
          // Clear all OTHER active bookings (including unassigned placeholders & previous crew) for this same event/space
          const existingSameRoom = getAllBookingsRaw().filter((b) => {
            if (!b || b.id === initialData.id) return false;
            if (b.status === 'cancelled' || b.status === 'declined') return false;
            return isSameEventAndSpace(b, { date: bookingDate, space: bookedSpace, eventId: resolvedEventId, eventName: bookedTitle });
          });
          existingSameRoom.forEach((b) => store.remove('bookings', b.id));

          record = {
            id: initialData.id || store.uid('book'),
            eventId: resolvedEventId,
            eventName: bookedTitle,
            space: bookedSpace,
            date: bookingDate,
            startTime: selectedStart,
            finishTime: selectedEnd,
            userId: '',
            userName: 'No Tech Required',
            isFreelancer: false,
            isNoTech: true,
            role: 'None',
            status: 'confirmed',
            rate: '',
            notes: selectedNotes,
            createdAt: initialData.createdAt || nowIso,
            confirmedAt: initialData.confirmedAt || nowIso,
            updatedAt: nowIso,
          };
          store.upsert('bookings', record);
        } else {
          // Check if the same technician is already booked on this same event, space & date (non-split) -> collapse into one entry!
          const collapsible = findCollapsibleBooking(finalUserId, finalUserName, bookingDate, bookedSpace, resolvedEventId, bookedTitle);
          if (collapsible) {
            const mergedRole = mergeShiftRoles(collapsible.role, selectedRole);
            const mergedNotes = [collapsible.notes, selectedNotes]
              .map((s) => String(s || '').trim())
              .filter((s, idx, arr) => s && arr.indexOf(s) === idx)
              .join(' · ');
            const mergedStatus = (collapsible.status === 'confirmed' || selectedStatus === 'confirmed') ? 'confirmed' : selectedStatus;
            record = Object.assign({}, collapsible, {
              eventId: resolvedEventId || collapsible.eventId || '',
              eventName: bookedTitle || collapsible.eventName,
              space: bookedSpace,
              date: bookingDate,
              startTime: selectedStart || collapsible.startTime,
              finishTime: selectedEnd || collapsible.finishTime,
              userId: finalUserId,
              userName: finalUserName,
              isFreelancer: isFreelancerFlag,
              isNoTech: false,
              role: mergedRole,
              status: mergedStatus,
              rate: selectedRate || collapsible.rate || '',
              notes: mergedNotes,
              updatedAt: nowIso,
            });
            if (record.status === 'confirmed' && !record.confirmedAt) record.confirmedAt = nowIso;
            store.upsert('bookings', record);
            // If we were editing a second/placeholder booking, remove that redundant row now that roles are merged
            if (initialData.id && initialData.id !== collapsible.id) {
              store.remove('bookings', initialData.id);
            }
            collapsedDualRole = true;
          } else {
            record = {
              id: initialData.id || store.uid('book'),
              eventId: resolvedEventId,
              eventName: bookedTitle,
              space: bookedSpace,
              date: bookingDate,
              startTime: selectedStart,
              finishTime: selectedEnd,
              userId: finalUserId,
              userName: finalUserName,
              isFreelancer: isFreelancerFlag,
              isNoTech: false,
              role: selectedRole,
              status: selectedStatus,
              rate: selectedRate,
              notes: selectedNotes,
              createdAt: initialData.createdAt || nowIso,
              updatedAt: nowIso,
            };

            // Preserve handover & swap metadata when editing an existing shift
            if (initialData.penciledAt) record.penciledAt = initialData.penciledAt;
            if (initialData.confirmedAt) record.confirmedAt = initialData.confirmedAt;
            if (initialData.splitFromId) record.splitFromId = initialData.splitFromId;
            if (initialData.legIndex) record.legIndex = initialData.legIndex;
            if (initialData.swapRequested) {
              record.swapRequested = initialData.swapRequested;
              if (initialData.swapOfferedBy) record.swapOfferedBy = initialData.swapOfferedBy;
              if (initialData.swapOfferedByName) record.swapOfferedByName = initialData.swapOfferedByName;
              if (initialData.swapOfferedAt) record.swapOfferedAt = initialData.swapOfferedAt;
              if (initialData.swapReason) record.swapReason = initialData.swapReason;
            }

            if (record.status === 'confirmed' && !record.confirmedAt) {
              record.confirmedAt = nowIso;
            } else if (record.status === 'pencil' && !record.penciledAt) {
              record.penciledAt = nowIso;
            }

            store.upsert('bookings', record);
          }

          // Clean up any leftover unassigned placeholder or obsolete No-Tech booking on this room covered by this tech's role(s)
          const coveredRoles = parseShiftRoles(record.role);
          getAllBookingsRaw().forEach((other) => {
            if (!other || other.id === record.id) return;
            if (other.status === 'cancelled' || other.status === 'declined') return;
            if (!isSameEventAndSpace(other, record)) return;
            if (isBookingNoTechRecord(other)) {
              store.remove('bookings', other.id);
              return;
            }
            if (isPlaceholderBooking(other, allUsers) && coveredRoles.length > 0) {
              if (!other.role || roleCoversDiscipline(record.role, other.role)) {
                store.remove('bookings', other.id);
              }
            }
          });
        }

        // Synchronize booking changes cleanly back into Advancing (handles staff, freelancers, reassignments, noTechNeeded, dual-role)
        if (RMTP.syncRotaToAdvancing) {
          if (record.eventId) {
            RMTP.syncRotaToAdvancing(record.eventId, {
              prevBookingId: initialData.id,
              prevUserId: initialData.userId,
              prevUserName: initialData.userName,
              clearNoTech: !isNoTechChecked,
              forceNoTech: isNoTechChecked,
              keepBookingId: record.id,
              space: bookedSpace,
            });
          }
          if (initialData.eventId && initialData.eventId !== record.eventId) {
            RMTP.syncRotaToAdvancing(initialData.eventId, {
              prevBookingId: initialData.id,
              prevUserId: initialData.userId,
              prevUserName: initialData.userName,
            });
          }
        }

        if (RMTP.syncSb && typeof RMTP.syncSb.drain === 'function') {
          try { RMTP.syncSb.drain(); } catch (e) {}
        }

        // Keep the booked date visible on the active Rota Board view
        if (state.tab === 'board') {
          if (state.boardView === 'month' && bookingDate.slice(0, 7) !== state.rotaMonth) {
            state.rotaMonth = bookingDate.slice(0, 7);
          } else if (state.boardView === 'day' || state.boardView === 'timeline') {
            state.selectedDay = bookingDate;
            state.weekOffset = getWeekOffsetForDate(bookingDate);
          } else if (state.boardView === 'week' || state.boardView === 'agenda') {
            const weekDates = getCurrentWeekDays().map((d) => d.date);
            if (!weekDates.includes(bookingDate)) {
              state.weekOffset = getWeekOffsetForDate(bookingDate);
            }
          }
        }

        const toastSummary = isNoTechChecked
          ? `Marked Self-Service (No Tech Needed) · ${record.eventName} on ${formatDisplayDate(bookingDate)}`
          : (collapsedDualRole
            ? `Combined into single shift: ${finalUserName} (${record.role}) · ${record.eventName}`
            : `Booked ${finalUserName} (${record.role}) · ${record.eventName} on ${formatDisplayDate(bookingDate)}`);
        ui.toast(toastSummary, 'ok');
        m.close();
        renderActiveTab();
      });

      // Delete
      const delBtn = m.root.querySelector('#b-delete');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          const ok = await ui.confirm('Delete this shift booking record? This will also update the linked event crew list.', {
            title: 'Delete Shift Booking',
            confirmLabel: 'Delete',
            danger: true,
          });
          if (ok) {
            store.remove('bookings', initialData.id);
            if (initialData.eventId && RMTP.syncRotaToAdvancing) {
              RMTP.syncRotaToAdvancing(initialData.eventId, {
                prevBookingId: initialData.id,
                prevUserId: initialData.userId,
                prevUserName: initialData.userName,
              });
            }
            if (RMTP.syncSb && typeof RMTP.syncSb.drain === 'function') {
              try { RMTP.syncSb.drain(); } catch (e) {}
            }
            ui.toast('Shift booking removed', 'ok');
            m.close();
            renderActiveTab();
          }
        });
      }
    }

    // ------------------------------------------------------------------------
    // SPLIT SHIFT MODAL (Individual Start/Finish Times & Handover Management)
    // ------------------------------------------------------------------------
    function openSplitShiftModal(initialShift = {}) {
      const allUsers = getAllUsers();
      const events = getAllEvents();
      const linkedEvent = initialShift.eventId ? store.find('advancing', initialShift.eventId) : null;
      const space = normalizeSpace(initialShift.space || (linkedEvent && linkedEvent.space ? (Array.isArray(linkedEvent.space) ? linkedEvent.space[0] : linkedEvent.space) : 'The Stage')) || 'The Stage';
      const eventName = initialShift.eventName || (linkedEvent ? linkedEvent.name : 'Shift');
      const date = normalizeDate(initialShift.date || (linkedEvent ? linkedEvent.date : (state.selectedDay || formatDate(new Date())))) || formatDate(new Date());
      const origStart = normalizeTime(initialShift.startTime || (linkedEvent ? linkedEvent.startTime : '10:00'), '10:00');
      const origEnd = normalizeTime(initialShift.finishTime || (linkedEvent ? linkedEvent.finishTime : '22:00'), '22:00');
      const role = initialShift.role || 'Sound';
      const originalDur = RMTP.getShiftDurationHours ? RMTP.getShiftDurationHours(origStart, origEnd) : 12;

      // Calculate initial 50/50 split
      const initCalc = RMTP.calculateSplitTimes ? RMTP.calculateSplitTimes(origStart, origEnd, 0.5, 0) : {
        leg1Start: origStart,
        leg1End: '16:00',
        leg2Start: '16:00',
        leg2End: origEnd,
        leg1Hours: 6,
        leg2Hours: 6,
        totalHours: originalDur,
        handoverTime: '16:00',
      };

      const m = ui.modal({
        title: `Split Shift · ${ui.esc(space)} (${ui.esc(role)})`,
        body: `
          <div class="space-y-4 text-xs">
            <!-- Shift Header & Context Banner -->
            <div class="p-3 rounded-xl bg-panel2/80 border border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
              <div class="space-y-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-bold text-ink text-sm truncate">${ui.esc(eventName)}</span>
                  <span class="font-bold px-2 py-0.5 rounded text-[10px] bg-accent/15 text-accent border border-accent/30">${ui.esc(space)}</span>
                  <span class="px-2 py-0.5 rounded text-[10px] bg-panel border border-line text-ink font-semibold">${ui.esc(role)}</span>
                </div>
                <div class="flex items-center gap-3 text-muted text-[11px] font-mono flex-wrap">
                  <span>📅 ${formatDisplayDate(date)}</span>
                  <span>⏰ Window: ${origStart} – ${origEnd}</span>
                  <span class="font-bold text-accent">(${originalDur}h Total)</span>
                  ${initialShift.userName && initialShift.userName !== 'Unassigned' && initialShift.userName !== 'No Tech Required' ? `<span class="text-ink font-sans">👤 Assigned: <b>${ui.esc(initialShift.userName)}</b></span>` : '<span class="text-amber-400 font-sans italic">Unassigned slot</span>'}
                </div>
              </div>
              <div class="shrink-0 flex items-center gap-1.5">
                <span class="text-[11px] px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/25 font-semibold flex items-center gap-1">
                  ${ui.icon('split', 'w-3.5 h-3.5 text-accent')}
                  <span>Long Shift Handover</span>
                </span>
              </div>
            </div>

            <!-- Split Presets & Overlap Buffer -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-panel border border-line/60">
              <div>
                <label class="block font-semibold text-muted mb-1.5">Quick Split Preset</label>
                <div class="grid grid-cols-3 gap-1.5" id="split-preset-btns">
                  <button type="button" data-split-preset="50-50" class="btn btn-ghost !p-1.5 text-center text-[11px] border border-accent/50 bg-accent/10 text-accent font-bold rounded">
                    50 / 50<br><span class="text-[9.5px] font-normal opacity-80">Equal Half</span>
                  </button>
                  <button type="button" data-split-preset="60-40" class="btn btn-ghost !p-1.5 text-center text-[11px] border border-line hover:border-accent text-ink font-bold rounded">
                    60 / 40<br><span class="text-[9.5px] font-normal opacity-80">Early Heavy</span>
                  </button>
                  <button type="button" data-split-preset="40-60" class="btn btn-ghost !p-1.5 text-center text-[11px] border border-line hover:border-accent text-ink font-bold rounded">
                    40 / 60<br><span class="text-[9.5px] font-normal opacity-80">Late Heavy</span>
                  </button>
                </div>
              </div>
              <div>
                <label class="block font-semibold text-muted mb-1.5">Handover Overlap Briefing</label>
                <select id="split-overlap" class="field text-xs font-semibold">
                  <option value="0" selected>0 min (Direct Handover at split point)</option>
                  <option value="15">15 min Overlap (Briefing debrief)</option>
                  <option value="30">30 min Overlap (Rehearsal &amp; audio handover)</option>
                  <option value="60">60 min Overlap (Full joint changeover)</option>
                </select>
                <p class="text-[10.5px] text-muted mt-1">Leg 1 finishes after handover briefing so both techs overlap on site.</p>
              </div>
            </div>

            <!-- Two Handover Legs side-by-side or stacked -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <!-- LEG 1 CARD -->
              <div class="p-3.5 rounded-xl border-2 border-emerald-500/30 bg-emerald-500/[0.03] space-y-3 relative shadow-2xs">
                <div class="flex items-center justify-between border-b border-line/50 pb-2">
                  <div class="flex items-center gap-1.5">
                    <span class="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                    <span class="font-bold text-ink text-xs uppercase tracking-wide">Leg 1 · Opening Shift</span>
                  </div>
                  <span id="split-leg1-dur-badge" class="font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded text-[11px] border border-emerald-500/30">
                    ${initCalc.leg1Hours}h
                  </span>
                </div>

                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="block font-semibold text-muted mb-1 text-[11px]">Start Time</label>
                    <input type="time" id="split-leg1-start" class="field font-mono text-xs" value="${initCalc.leg1Start}" />
                  </div>
                  <div>
                    <label class="block font-semibold text-muted mb-1 text-[11px]">Finish Time</label>
                    <input type="time" id="split-leg1-end" class="field font-mono text-xs" value="${initCalc.leg1End}" />
                  </div>
                </div>

                <div>
                  <label class="block font-semibold text-muted mb-1 text-[11px]">Technician / Freelancer</label>
                  <select id="split-leg1-user" class="field font-medium text-xs">
                    <option value="">Select Technician for Leg 1…</option>
                    <optgroup label="Available Technicians">
                      ${allUsers.map((u) => `
                        <option value="${u.id}" ${u.id === initialShift.userId ? 'selected' : ''}>
                          ${ui.esc(auth.displayName(u))} (${ui.esc(u.position || 'Tech')})
                        </option>
                      `).join('')}
                    </optgroup>
                    <option value="__custom__" ${(!initialShift.userId && initialShift.userName && initialShift.userName !== 'Unassigned Tech' && !initialShift.isNoTech) ? 'selected' : ''}>+ Other / External Freelancer</option>
                  </select>
                  <div id="split-leg1-custom-wrap" class="${(!initialShift.userId && initialShift.userName && initialShift.userName !== 'Unassigned Tech' && !initialShift.isNoTech) ? 'block' : 'hidden'} mt-1.5">
                    <input id="split-leg1-custom-name" class="field text-xs" value="${ui.esc(initialShift.userName && initialShift.userName !== 'Unassigned Tech' ? initialShift.userName : '')}" placeholder="Freelancer Name for Leg 1" />
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="block font-semibold text-muted mb-1 text-[11px]">Discipline Role</label>
                    <select id="split-leg1-role" class="field text-xs">
                      ${RMTP.SHIFT_ROLES.map((r) => `
                        <option value="${r}" ${r === role ? 'selected' : ''}>${r}</option>
                      `).join('')}
                    </select>
                  </div>
                  <div>
                    <label class="block font-semibold text-muted mb-1 text-[11px]">Status</label>
                    <select id="split-leg1-status" class="field text-xs font-semibold">
                      <option value="confirmed" ${initialShift.status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
                      <option value="pencil" ${initialShift.status === 'pencil' ? 'selected' : ''}>Pencil Hold</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label class="block font-semibold text-muted mb-1 text-[11px]">Shift Note / Responsibilities</label>
                  <input id="split-leg1-notes" class="field text-xs" value="Leg 1: Get-in, rig, sound checks &amp; rehearsal" placeholder="e.g. Get-in, soundcheck" />
                </div>
              </div>

              <!-- LEG 2 CARD -->
              <div class="p-3.5 rounded-xl border-2 border-sky-500/30 bg-sky-500/[0.03] space-y-3 relative shadow-2xs">
                <div class="flex items-center justify-between border-b border-line/50 pb-2">
                  <div class="flex items-center gap-1.5">
                    <span class="w-2.5 h-2.5 rounded-full bg-sky-400"></span>
                    <span class="font-bold text-ink text-xs uppercase tracking-wide">Leg 2 · Closing Shift</span>
                  </div>
                  <span id="split-leg2-dur-badge" class="font-mono font-bold text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded text-[11px] border border-sky-500/30">
                    ${initCalc.leg2Hours}h
                  </span>
                </div>

                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="block font-semibold text-muted mb-1 text-[11px]">Start Time</label>
                    <input type="time" id="split-leg2-start" class="field font-mono text-xs" value="${initCalc.leg2Start}" />
                  </div>
                  <div>
                    <label class="block font-semibold text-muted mb-1 text-[11px]">Finish Time</label>
                    <input type="time" id="split-leg2-end" class="field font-mono text-xs" value="${initCalc.leg2End}" />
                  </div>
                </div>

                <div>
                  <label class="block font-semibold text-muted mb-1 text-[11px]">Technician / Freelancer</label>
                  <select id="split-leg2-user" class="field font-medium text-xs">
                    <option value="">Select Handover Tech for Leg 2…</option>
                    <optgroup label="Available Technicians">
                      ${allUsers.map((u) => `
                        <option value="${u.id}">
                          ${ui.esc(auth.displayName(u))} (${ui.esc(u.position || 'Tech')})
                        </option>
                      `).join('')}
                    </optgroup>
                    <option value="__custom__">+ Other / External Freelancer</option>
                  </select>
                  <div id="split-leg2-custom-wrap" class="hidden mt-1.5">
                    <input id="split-leg2-custom-name" class="field text-xs" placeholder="Freelancer Name for Leg 2" />
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="block font-semibold text-muted mb-1 text-[11px]">Discipline Role</label>
                    <select id="split-leg2-role" class="field text-xs">
                      ${RMTP.SHIFT_ROLES.map((r) => `
                        <option value="${r}" ${r === role ? 'selected' : ''}>${r}</option>
                      `).join('')}
                    </select>
                  </div>
                  <div>
                    <label class="block font-semibold text-muted mb-1 text-[11px]">Status</label>
                    <select id="split-leg2-status" class="field text-xs font-semibold">
                      <option value="confirmed">Confirmed</option>
                      <option value="pencil" selected>Pencil Hold</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label class="block font-semibold text-muted mb-1 text-[11px]">Shift Note / Responsibilities</label>
                  <input id="split-leg2-notes" class="field text-xs" value="Leg 2: Show operation, changeovers &amp; packdown" placeholder="e.g. Show running, packdown" />
                </div>
              </div>
            </div>

            <!-- Total Coverage & Additional Tech Option -->
            <div class="p-3 rounded-lg bg-panel2 border border-line flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div id="split-coverage-summary" class="flex items-center gap-2 flex-wrap">
                <span class="text-muted">Total Scheduled Coverage:</span>
                <span id="split-total-dur-text" class="font-mono font-bold text-accent">${initCalc.totalHours}h total</span>
                <span class="text-muted">· Handover at: <b id="split-handover-text" class="text-ink font-mono">${initCalc.handoverTime}</b></span>
              </div>
              <button type="button" id="split-btn-add-extra-tech" class="btn btn-ghost text-xs !py-1 !px-2.5 border border-accent/40 text-accent hover:bg-accent/10 font-semibold flex items-center gap-1.5 shadow-2xs">
                ${ui.icon('plus', 'w-3.5 h-3.5')}
                <span>+ Add Extra Tech to ${ui.esc(space)}</span>
              </button>
            </div>
          </div>
        `,
        footer: [
          '<button type="button" class="btn btn-ghost" data-close>Cancel</button>',
          '<button type="button" id="split-confirm-btn" class="btn btn-primary font-semibold flex items-center gap-1.5 shadow-sm" data-primary>' +
            ui.icon('split', 'w-4 h-4') +
            '<span>Confirm Split into 2 Shifts</span>' +
          '</button>',
        ].join(''),
        actions: [
          '<button type="button" class="btn btn-ghost" data-close>Cancel</button>',
          '<button type="button" id="split-confirm-btn" class="btn btn-primary font-semibold flex items-center gap-1.5 shadow-sm" data-primary>' +
            ui.icon('split', 'w-4 h-4') +
            '<span>Confirm Split into 2 Shifts</span>' +
          '</button>',
        ]
      });

      // Recalculation logic
      const leg1StartInp = m.root.querySelector('#split-leg1-start');
      const leg1EndInp = m.root.querySelector('#split-leg1-end');
      const leg2StartInp = m.root.querySelector('#split-leg2-start');
      const leg2EndInp = m.root.querySelector('#split-leg2-end');
      const overlapSel = m.root.querySelector('#split-overlap');

      function updateLegBadges() {
        const d1 = RMTP.getShiftDurationHours ? RMTP.getShiftDurationHours(leg1StartInp.value, leg1EndInp.value) : 0;
        const d2 = RMTP.getShiftDurationHours ? RMTP.getShiftDurationHours(leg2StartInp.value, leg2EndInp.value) : 0;
        const badge1 = m.root.querySelector('#split-leg1-dur-badge');
        const badge2 = m.root.querySelector('#split-leg2-dur-badge');
        const totalText = m.root.querySelector('#split-total-dur-text');
        const handoverText = m.root.querySelector('#split-handover-text');
        if (badge1) badge1.textContent = d1 + 'h';
        if (badge2) badge2.textContent = d2 + 'h';
        if (totalText) totalText.textContent = Math.round((d1 + d2) * 10) / 10 + 'h combined';
        if (handoverText) handoverText.textContent = leg2StartInp.value;
      }

      [leg1StartInp, leg1EndInp, leg2StartInp, leg2EndInp].forEach((inp) => {
        inp?.addEventListener('change', updateLegBadges);
      });

      // Preset click handler
      m.root.querySelectorAll('[data-split-preset]').forEach((btn) => {
        btn.addEventListener('click', () => {
          m.root.querySelectorAll('[data-split-preset]').forEach((b) => {
            b.className = 'btn btn-ghost !p-1.5 text-center text-[11px] border border-line hover:border-accent text-ink font-bold rounded';
          });
          btn.className = 'btn btn-ghost !p-1.5 text-center text-[11px] border border-accent/50 bg-accent/10 text-accent font-bold rounded';

          const preset = btn.getAttribute('data-split-preset');
          const ratio = preset === '60-40' ? 0.6 : (preset === '40-60' ? 0.4 : 0.5);
          const overlap = parseInt(overlapSel.value, 10) || 0;
          const calc = RMTP.calculateSplitTimes ? RMTP.calculateSplitTimes(origStart, origEnd, ratio, overlap) : initCalc;

          leg1StartInp.value = calc.leg1Start;
          leg1EndInp.value = calc.leg1End;
          leg2StartInp.value = calc.leg2Start;
          leg2EndInp.value = calc.leg2End;
          updateLegBadges();
        });
      });

      overlapSel.addEventListener('change', () => {
        const activePresetBtn = m.root.querySelector('[data-split-preset].text-accent');
        const preset = activePresetBtn ? activePresetBtn.getAttribute('data-split-preset') : '50-50';
        const ratio = preset === '60-40' ? 0.6 : (preset === '40-60' ? 0.4 : 0.5);
        const overlap = parseInt(overlapSel.value, 10) || 0;
        const calc = RMTP.calculateSplitTimes ? RMTP.calculateSplitTimes(origStart, origEnd, ratio, overlap) : initCalc;

        leg1EndInp.value = calc.leg1End;
        leg2StartInp.value = calc.leg2Start;
        updateLegBadges();
      });

      // Custom freelancer toggles
      const leg1UserSel = m.root.querySelector('#split-leg1-user');
      const leg1CustomWrap = m.root.querySelector('#split-leg1-custom-wrap');
      leg1UserSel.addEventListener('change', () => {
        leg1CustomWrap.classList.toggle('hidden', leg1UserSel.value !== '__custom__');
      });

      const leg2UserSel = m.root.querySelector('#split-leg2-user');
      const leg2CustomWrap = m.root.querySelector('#split-leg2-custom-wrap');
      leg2UserSel.addEventListener('change', () => {
        leg2CustomWrap.classList.toggle('hidden', leg2UserSel.value !== '__custom__');
      });

      // Quick Add Extra Tech to this event/space
      m.root.querySelector('#split-btn-add-extra-tech')?.addEventListener('click', () => {
        m.close();
        openBookingModal({
          space: space,
          date: date,
          startTime: origStart,
          finishTime: origEnd,
          role: role === 'Sound' ? 'Lighting' : 'Sound',
          eventId: initialShift.eventId || '',
          eventName: eventName,
          status: 'pencil',
          notes: 'Additional Crew Tech',
        });
      });

      // Confirm Split and Create Both Shifts
      m.root.querySelector('#split-confirm-btn').addEventListener('click', () => {
        const leg1Start = leg1StartInp.value || origStart;
        const leg1End = leg1EndInp.value || '16:00';
        const leg2Start = leg2StartInp.value || '16:00';
        const leg2End = leg2EndInp.value || origEnd;

        // Resolve Leg 1 user
        let u1Id = leg1UserSel.value;
        let u1Name = 'Unassigned Tech';
        let isFreelancer1 = false;
        if (u1Id === '__custom__') {
          u1Name = (m.root.querySelector('#split-leg1-custom-name')?.value || '').trim() || 'Freelancer';
          u1Id = '';
          isFreelancer1 = true;
        } else if (u1Id) {
          const uObj = allUsers.find((u) => u.id === u1Id);
          u1Name = uObj ? auth.displayName(uObj) : 'Tech';
          isFreelancer1 = uObj ? (uObj.position === 'Freelancer') : false;
        } else if (initialShift.userName && initialShift.userName !== 'Unassigned' && initialShift.userName !== 'Unassigned Tech') {
          u1Name = initialShift.userName;
          u1Id = initialShift.userId || '';
          isFreelancer1 = initialShift.isFreelancer || false;
        }

        // Resolve Leg 2 user
        let u2Id = leg2UserSel.value;
        let u2Name = 'Unassigned Tech';
        let isFreelancer2 = false;
        if (u2Id === '__custom__') {
          u2Name = (m.root.querySelector('#split-leg2-custom-name')?.value || '').trim() || 'Freelancer';
          u2Id = '';
          isFreelancer2 = true;
        } else if (u2Id) {
          const uObj = allUsers.find((u) => u.id === u2Id);
          u2Name = uObj ? auth.displayName(uObj) : 'Tech';
          isFreelancer2 = uObj ? (uObj.position === 'Freelancer') : false;
        }

        const splitGroupId = initialShift.splitFromId || ('split_' + Date.now());
        const leg1Role = m.root.querySelector('#split-leg1-role')?.value || role;
        const leg2Role = m.root.querySelector('#split-leg2-role')?.value || role;
        const leg1Status = m.root.querySelector('#split-leg1-status')?.value || 'confirmed';
        const leg2Status = m.root.querySelector('#split-leg2-status')?.value || 'pencil';
        const leg1Notes = m.root.querySelector('#split-leg1-notes')?.value || '';
        const leg2Notes = m.root.querySelector('#split-leg2-notes')?.value || '';

        // Save Leg 1 Booking
        const leg1BookingId = initialShift.id || store.uid('book');
        const bookingLeg1 = {
          id: leg1BookingId,
          eventId: initialShift.eventId || '',
          eventName: eventName,
          space: space,
          date: date,
          startTime: leg1Start,
          finishTime: leg1End,
          userId: u1Id,
          userName: u1Name,
          role: leg1Role,
          status: leg1Status,
          splitFromId: splitGroupId,
          legIndex: 1,
          isFreelancer: isFreelancer1,
          isNoTech: false,
          notes: leg1Notes,
          rate: initialShift.rate || '',
          updatedAt: new Date().toISOString(),
        };
        store.upsert('bookings', bookingLeg1);

        // Save Leg 2 Booking
        const leg2BookingId = store.uid('book');
        const bookingLeg2 = {
          id: leg2BookingId,
          eventId: initialShift.eventId || '',
          eventName: eventName,
          space: space,
          date: date,
          startTime: leg2Start,
          finishTime: leg2End,
          userId: u2Id,
          userName: u2Name,
          role: leg2Role,
          status: leg2Status,
          splitFromId: splitGroupId,
          legIndex: 2,
          isFreelancer: isFreelancer2,
          isNoTech: false,
          notes: leg2Notes,
          rate: initialShift.rate || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        store.upsert('bookings', bookingLeg2);

        // Keep linked advancing event cleanly synchronized from all active bookings
        if (initialShift.eventId && RMTP.syncRotaToAdvancing) {
          RMTP.syncRotaToAdvancing(initialShift.eventId, {
            prevBookingId: initialShift.id,
            prevUserId: initialShift.userId,
            prevUserName: initialShift.userName,
            clearNoTech: true,
          });
        }
        if (RMTP.syncSb && typeof RMTP.syncSb.drain === 'function') {
          try { RMTP.syncSb.drain(); } catch (e) {}
        }

        ui.toast(`Split ${role} into 2 shifts: ${leg1Start}–${leg1End} and ${leg2Start}–${leg2End}`, 'ok');
        m.close();
        renderActiveTab();
      });
    }

    // Shift Swap & Cover Helpers
    function openOfferSwapModal(booking) {
      if (!booking) return;
      const m = ui.modal({
        title: 'Offer Shift for Swap / Cover',
        body: `
          <div class="space-y-3.5 text-xs">
            <div class="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300">
              <div class="font-bold flex items-center gap-1.5 mb-1">
                ${ui.icon('refresh', 'w-4 h-4')}
                <span>Offer Shift to Colleagues</span>
              </div>
              <p class="text-[11px] opacity-90">
                This shift will appear on the venue Shift Swaps board. Any colleague can claim it and take over the cover.
              </p>
            </div>

            <div class="p-3 rounded-lg bg-panel2 border border-line space-y-1.5">
              <div class="font-bold text-ink text-sm">${ui.esc(booking.eventName || 'Shift')}</div>
              <div class="flex items-center gap-2 text-muted font-mono flex-wrap text-xs">
                <span class="px-2 py-0.5 rounded bg-panel border border-line text-ink font-semibold">${ui.esc(booking.space)}</span>
                <span>📅 ${formatDisplayDate(booking.date)}</span>
                <span>·</span>
                <span>⏰ ${booking.startTime} – ${booking.finishTime}</span>
                <span>·</span>
                <span class="text-accent font-semibold">${ui.esc(booking.role || 'Tech')}</span>
              </div>
            </div>

            <div>
              <label class="block font-semibold text-muted mb-1">Reason / Note for Colleagues</label>
              <textarea id="swap-reason-input" class="field" rows="3" placeholder="e.g. Double booked with recording session, family event, happy to swap for Friday..."></textarea>
            </div>
          </div>
        `,
        footer: [
          '<button type="button" class="btn btn-ghost" data-close>Cancel</button>',
          '<button type="button" id="swap-confirm-btn" class="btn btn-primary" data-primary>Post Shift Swap Offer</button>',
        ].join(''),
        actions: [
          '<button type="button" class="btn btn-ghost" data-close>Cancel</button>',
          '<button type="button" id="swap-confirm-btn" class="btn btn-primary" data-primary>Post Shift Swap Offer</button>',
        ]
      });

      m.root.querySelector('#swap-confirm-btn')?.addEventListener('click', () => {
        const reason = m.root.querySelector('#swap-reason-input')?.value.trim();
        booking.swapRequested = true;
        booking.swapOfferedBy = me ? me.id : (booking.userId || 'user-3');
        booking.swapOfferedByName = me ? auth.displayName(me) : (booking.userName || 'Technician');
        booking.swapOfferedAt = new Date().toISOString();
        booking.swapReason = reason || 'Shift cover requested';
        store.upsert('bookings', booking);
        ui.toast('Shift posted to the Shift Swaps board! Colleagues can now claim it.', 'ok');
        m.close();
        renderActiveTab();
      });
    }

    function openClaimSwapModal(booking) {
      if (!booking) return;
      const m = ui.modal({
        title: 'Claim Shift / Accept Cover',
        body: `
          <div class="space-y-3.5 text-xs">
            <div class="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
              <div class="font-bold flex items-center gap-1.5 mb-1">
                ${ui.icon('check', 'w-4 h-4')}
                <span>Take Over This Shift</span>
              </div>
              <p class="text-[11px] opacity-90">
                You are claiming this shift cover. It will be assigned to you and added to your schedule.
              </p>
            </div>

            <div class="p-3 rounded-lg bg-panel2 border border-line space-y-1.5">
              <div class="font-bold text-ink text-sm">${ui.esc(booking.eventName || 'Shift')}</div>
              <div class="flex items-center gap-2 text-muted font-mono flex-wrap text-xs">
                <span class="px-2 py-0.5 rounded bg-panel border border-line text-ink font-semibold">${ui.esc(booking.space)}</span>
                <span>📅 ${formatDisplayDate(booking.date)}</span>
                <span>·</span>
                <span>⏰ ${booking.startTime} – ${booking.finishTime}</span>
                <span>·</span>
                <span class="text-accent font-semibold">${ui.esc(booking.role || 'Tech')}</span>
              </div>
              <div class="text-[11px] text-muted pt-1 border-t border-line/40">
                Offered by: <strong class="text-ink">${ui.esc(booking.swapOfferedByName || booking.userName || 'Colleague')}</strong>
                ${booking.swapReason ? `<div class="italic text-muted mt-0.5">“${ui.esc(booking.swapReason)}”</div>` : ''}
              </div>
            </div>
          </div>
        `,
        footer: [
          '<button type="button" class="btn btn-ghost" data-close>Cancel</button>',
          '<button type="button" id="claim-confirm-btn" class="btn btn-primary" data-primary>Confirm & Claim Shift</button>',
        ].join(''),
        actions: [
          '<button type="button" class="btn btn-ghost" data-close>Cancel</button>',
          '<button type="button" id="claim-confirm-btn" class="btn btn-primary" data-primary>Confirm & Claim Shift</button>',
        ]
      });

      m.root.querySelector('#claim-confirm-btn')?.addEventListener('click', () => {
        const prevUserId = booking.userId || '';
        const prevName = booking.swapOfferedByName || booking.userName || 'Colleague';
        const myName = me ? auth.displayName(me) : 'You';
        booking.userId = me ? me.id : 'user-3';
        booking.userName = myName;
        booking.swapRequested = false;
        booking.swapClaimedBy = me ? me.id : 'user-3';
        booking.swapClaimedByName = myName;
        booking.swapClaimedAt = new Date().toISOString();
        booking.status = 'confirmed';
        booking.updatedAt = new Date().toISOString();
        booking.notes = (booking.notes ? booking.notes + ' | ' : '') + `Cover taken over by ${myName} (swapped from ${prevName})`;
        store.upsert('bookings', booking);
        if (booking.eventId && RMTP.syncRotaToAdvancing) {
          RMTP.syncRotaToAdvancing(booking.eventId, { prevUserId, prevUserName: prevName, clearNoTech: true });
        }
        ui.toast('Shift claimed successfully! It is now on your personal schedule.', 'ok');
        m.close();
        renderActiveTab();
      });
    }

    function openShiftDetailModal(booking) {
      if (!booking) return;
      const isMine = me && booking.userId === me.id;
      const isUpcoming = isUpcomingShiftDate(booking.date);
      const isSwap = isActiveOpenSwap(booking);
      const m = ui.modal({
        title: `Shift Details · ${ui.esc(booking.space || 'Venue')}`,
        body: `
          <div class="space-y-3.5 text-xs">
            <div class="p-3.5 rounded-xl bg-panel2 border border-line space-y-2">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <div class="text-[10px] uppercase font-bold tracking-wider text-accent">${ui.esc(booking.space)}</div>
                  <div class="text-sm font-bold text-ink">${ui.esc(booking.eventName || 'Shift')}</div>
                </div>
                ${renderStatusPill(booking.status)}
              </div>
              <div class="flex items-center gap-2 text-muted font-mono flex-wrap text-xs pt-1 border-t border-line/40">
                <span>📅 ${formatDisplayDate(booking.date)}</span>
                <span>·</span>
                <span>⏰ ${booking.startTime} – ${booking.finishTime}</span>
                <span>·</span>
                <span class="text-accent font-semibold">${ui.esc(booking.role || 'Tech')}</span>
              </div>
              <div class="text-xs pt-1 border-t border-line/40 flex items-center justify-between">
                <span class="text-muted">Assigned Tech:</span>
                <span class="font-bold text-ink">${isMine ? '⭐ You (' + ui.esc(auth.displayName(me)) + ')' : ui.esc(booking.userName || 'Unassigned')}</span>
              </div>
              ${booking.notes ? `
                <div class="text-[11px] text-muted bg-panel p-2 rounded border border-line">
                  <strong>Notes:</strong> ${ui.esc(booking.notes)}
                </div>
              ` : ''}
            </div>

            ${isSwap ? `
              <div class="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">
                <div class="font-semibold flex items-center gap-1.5">
                  ${ui.icon('refresh', 'w-4 h-4')}
                  <span>Shift Swap Offered</span>
                </div>
                <div class="text-[11px] mt-1 opacity-90">
                  Offered by <strong>${ui.esc(booking.swapOfferedByName || booking.userName)}</strong>
                  ${booking.swapReason ? ` — “${ui.esc(booking.swapReason)}”` : ''}
                </div>
              </div>
            ` : ''}
          </div>
        `,
        footer: `
          <div class="flex items-center justify-between gap-2 w-full flex-wrap">
            <div>
              ${(isTechManager || isAdmin) ? `
                <button type="button" id="sd-edit-btn" class="btn btn-ghost text-xs">Edit / Reassign</button>
              ` : ''}
            </div>
            <div class="flex items-center gap-2">
              <button type="button" class="btn btn-ghost" data-close>Close</button>
              ${isMine && !isSwap && isUpcoming ? `
                <button type="button" id="sd-swap-btn" class="btn btn-primary text-xs flex items-center gap-1.5">
                  ${ui.icon('refresh', 'w-3.5 h-3.5')}
                  <span>Offer for Swap</span>
                </button>
              ` : ''}
              ${isMine && isSwap ? `
                <button type="button" id="sd-cancel-swap-btn" class="btn btn-danger text-xs">
                  Cancel Swap Offer
                </button>
              ` : ''}
              ${!isMine && isSwap ? `
                <button type="button" id="sd-claim-btn" class="btn btn-primary text-xs flex items-center gap-1.5">
                  ${ui.icon('check', 'w-3.5 h-3.5')}
                  <span>Claim Shift Cover</span>
                </button>
              ` : ''}
            </div>
          </div>
        `
      });

      m.root.querySelector('#sd-edit-btn')?.addEventListener('click', () => {
        m.close();
        openBookingModal(booking);
      });
      m.root.querySelector('#sd-swap-btn')?.addEventListener('click', () => {
        m.close();
        openOfferSwapModal(booking);
      });
      m.root.querySelector('#sd-cancel-swap-btn')?.addEventListener('click', () => {
        booking.swapRequested = false;
        store.upsert('bookings', booking);
        ui.toast('Swap offer cancelled. You remain assigned to this shift.', 'ok');
        m.close();
        renderActiveTab();
      });
      m.root.querySelector('#sd-claim-btn')?.addEventListener('click', () => {
        m.close();
        openClaimSwapModal(booking);
      });
    }

    function openDayScheduleModal(dateStr) {
      const normDate = normalizeDate(dateStr) || formatDate(new Date());
      const dObj = parseDate(normDate);
      const formattedDate = dObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const dayItems = getDaySchedule(normDate);
      const allB = getAllBookings().filter((b) => normalizeDate(b.date) === normDate && b.status !== 'cancelled');
      const gaps = dayItems.filter((i) => i.isUnfilled && !i.isNoTech);

      const m = ui.modal({
        title: `Venue Schedule · ${formattedDate}`,
        body: `
          <div class="space-y-3 text-xs">
            ${gaps.length > 0 ? `
              <div class="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <span class="w-2.5 h-2.5 rounded-full bg-rose-400 animate-pulse"></span>
                  <span class="font-bold text-rose-300 text-xs">${gaps.length} Staffing Gap${gaps.length > 1 ? 's' : ''} on this Date</span>
                </div>
                <span class="text-[11px] text-muted font-mono hidden sm:inline">Click "+ Assign Freelancer" on any gap below</span>
              </div>
            ` : ''}

            ${dayItems.length === 0 ? `
              <div class="p-8 text-center text-muted italic bg-panel2 rounded-xl border border-line">
                No events or technician shifts scheduled on this date.
              </div>
            ` : `
              <div class="space-y-2 max-h-[440px] overflow-y-auto pr-1">
                ${dayItems.map((item) => {
                  if (item.isUnfilled && !item.isNoTech) {
                    return `
                      <div class="p-3 rounded-xl border border-rose-500/40 bg-rose-500/5 space-y-2 shadow-2xs">
                        <div class="flex items-start justify-between gap-2">
                          <div>
                            <div class="flex items-center gap-1.5 flex-wrap">
                              <span class="px-2 py-0.2 rounded bg-panel border border-line text-[10px] font-bold text-accent uppercase tracking-wider">${ui.esc(item.space)}</span>
                              <span class="px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 font-bold text-[10px] border border-rose-500/30 flex items-center gap-1">
                                <span class="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse"></span>
                                <span>⚠️ Unstaffed Gap</span>
                              </span>
                            </div>
                            <div class="font-bold text-ink text-sm mt-0.5">${ui.esc(item.eventName)}</div>
                          </div>
                          <span class="text-rose-400 font-bold text-xs bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">Needs ${ui.esc(item.role || 'Tech')}</span>
                        </div>
                        <div class="flex items-center justify-between text-muted font-mono text-[11px] pt-1 border-t border-line/40">
                          <span>Required Discipline: <strong class="text-ink">${ui.esc(item.role || 'Tech')}</strong></span>
                          <span>⏰ ${item.startTime} – ${item.finishTime}</span>
                        </div>
                        <div class="flex items-center justify-between text-xs pt-1 border-t border-line/40">
                          <span class="text-rose-300 text-xs italic">No technician assigned yet</span>
                          ${(isTechManager || isAdmin) ? `
                            <button type="button" class="btn btn-primary text-xs !py-1 !px-2.5 font-semibold flex items-center gap-1 shadow-xs" data-day-assign-gap="${item.key}">
                              ${ui.icon('plus', 'w-3.5 h-3.5')}
                              <span>+ Assign Freelancer</span>
                            </button>
                          ` : ''}
                        </div>
                      </div>
                    `;
                  }

                  if (item.isNoTech) {
                    return `
                      <div class="p-3 rounded-xl border border-line bg-panel2 space-y-1.5 opacity-80">
                        <div class="flex items-start justify-between gap-2">
                          <div>
                            <span class="px-2 py-0.2 rounded bg-panel border border-line text-[10px] font-bold text-muted uppercase tracking-wider">${ui.esc(item.space)}</span>
                            <div class="font-bold text-ink text-sm mt-0.5">${ui.esc(item.eventName)}</div>
                          </div>
                          <span class="text-muted font-medium text-xs bg-panel px-2 py-0.5 rounded border border-line">Self-Service</span>
                        </div>
                        <div class="flex items-center justify-between text-muted font-mono text-[11px] pt-1 border-t border-line/40">
                          <span>Status: <strong class="text-ink">No Tech Required</strong></span>
                          <span>⏰ ${item.startTime} – ${item.finishTime}</span>
                        </div>
                      </div>
                    `;
                  }

                  if (item.type === 'takeover') {
                    return `
                      <div class="p-3 rounded-xl border border-amber-500/40 bg-amber-500/5 space-y-2">
                        <div class="flex items-start justify-between gap-2">
                          <div>
                            <span class="px-2 py-0.2 rounded bg-panel border border-line text-[10px] font-bold text-amber-300 uppercase tracking-wider">Multi-Room Takeover</span>
                            <div class="font-bold text-ink text-sm mt-0.5">${ui.esc(item.eventName)}</div>
                            <div class="text-[11px] text-muted mt-0.5">Spaces: ${item.spaces.join(', ')}</div>
                          </div>
                          <span class="text-xs font-bold font-mono px-2 py-0.5 rounded ${item.isFullyStaffed ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}">
                            ${item.totalCrewAssigned}/${item.totalCrewNeeded} Crew Assigned
                          </span>
                        </div>
                        <div class="flex items-center justify-between text-xs pt-1 border-t border-line/40">
                          <span class="text-muted font-mono text-[11px]">⏰ ${item.startTime} – ${item.finishTime}</span>
                          ${(isTechManager || isAdmin) ? `
                            <button type="button" class="btn btn-ghost text-xs !py-1 !px-2 text-accent font-semibold" data-day-assign-gap="${item.key}">
                              ${ui.icon('plus', 'w-3.5 h-3.5')}
                              <span>+ Book Takeover Shift</span>
                            </button>
                          ` : ''}
                        </div>
                      </div>
                    `;
                  }

                  // Regular booking or adv_tech
                  const b = item.booking || allB.find((x) => x.id === item.id) || item;
                  const isMine = me && b.userId === me.id;
                  const isUpcoming = isUpcomingShiftDate(b.date);
                  const isSwap = isActiveOpenSwap(b);
                  return `
                    <div class="p-3 rounded-xl border bg-panel2 space-y-2 ${isMine ? 'border-accent/50 bg-accent/5 shadow-2xs' : (isSwap ? 'border-amber-500/50 bg-amber-500/5 shadow-2xs' : 'border-line')}">
                      <div class="flex items-start justify-between gap-2">
                        <div>
                          <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="px-2 py-0.2 rounded bg-panel border border-line text-[10px] font-bold text-accent uppercase tracking-wider">${ui.esc(b.space)}</span>
                            ${isMine ? '<span class="px-1.5 py-0.2 rounded bg-accent text-accent-ink font-bold text-[10px]">⭐ My Shift</span>' : ''}
                            ${isSwap ? '<span class="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-400 font-bold text-[10px] border border-amber-500/30">🔄 Cover Needed</span>' : ''}
                          </div>
                          <div class="font-bold text-ink text-sm mt-0.5">${ui.esc(b.eventName || 'Shift')}</div>
                        </div>
                        ${renderStatusPill(b.status)}
                      </div>
                      <div class="flex items-center justify-between text-muted font-mono text-[11px] pt-1 border-t border-line/40">
                        <span>Role: <strong class="text-ink">${ui.esc(b.role || 'Tech')}</strong></span>
                        <span>⏰ ${b.startTime} – ${b.finishTime}</span>
                      </div>
                      <div class="flex items-center justify-between text-xs pt-1 border-t border-line/40">
                        <span class="text-muted">Tech: <strong class="text-ink">${isMine ? '⭐ You (' + ui.esc(auth.displayName(me)) + ')' : ui.esc(b.userName || 'Unassigned')}</strong></span>
                        <div class="flex items-center gap-1.5">
                          ${isMine && !isSwap && isUpcoming && b.id ? `
                            <button type="button" class="btn btn-ghost text-[10px] text-accent !py-0.5 !px-2 font-semibold" data-day-swap="${b.id}">Offer Swap</button>
                          ` : ''}
                          ${isMine && isSwap && b.id ? `
                            <button type="button" class="btn btn-ghost text-[10px] text-danger !py-0.5 !px-2 font-semibold" data-day-cancel-swap="${b.id}">Cancel Swap</button>
                          ` : ''}
                          ${!isMine && isSwap && b.id ? `
                            <button type="button" class="btn btn-primary text-[10px] !py-0.5 !px-2 font-semibold" data-day-claim="${b.id}">Claim Cover</button>
                          ` : ''}
                          ${(isTechManager || isAdmin) && b.id ? `
                            <button type="button" class="btn btn-ghost text-[10px] !py-0.5 !px-2" data-day-edit="${b.id}">Edit</button>
                          ` : ((isTechManager || isAdmin) && item.key ? `
                            <button type="button" class="btn btn-ghost text-[10px] !py-0.5 !px-2" data-day-edit-item="${item.key}">Book / Edit</button>
                          ` : '')}
                        </div>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>
        `,
        footer: `
          <div class="flex items-center justify-between w-full">
            ${(isTechManager || isAdmin) ? `
              <button type="button" id="day-add-shift-btn" class="btn btn-primary text-xs flex items-center gap-1.5">
                ${ui.icon('plus', 'w-3.5 h-3.5')}
                <span>+ Add Shift on this Date</span>
              </button>
            ` : '<div></div>'}
            <button type="button" class="btn btn-ghost" data-close>Close</button>
          </div>
        `
      });

      m.root.querySelectorAll('[data-day-assign-gap]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = btn.getAttribute('data-day-assign-gap');
          const item = allScheduleItemsMap.get(key);
          m.close();
          if (item) {
            const targetSpace = item.type === 'takeover'
              ? normalizeSpace((item.unfilledSpaces && item.unfilledSpaces[0]) || (item.spaces && item.spaces[0]) || 'The Stage')
              : normalizeSpace(item.space || 'The Stage');
            openBookingModal({
              id: (item.type === 'booking' && item.booking && item.booking.id) ? item.booking.id : undefined,
              eventId: item.type === 'takeover' ? resolveTakeoverEventId(item, targetSpace) : item.eventId,
              eventName: item.eventName,
              space: targetSpace,
              date: normalizeDate(item.date) || normDate,
              startTime: normalizeTime(item.startTime, '17:00'),
              finishTime: normalizeTime(item.finishTime, '23:30'),
              role: item.role || 'Sound',
              status: 'pencil',
            });
          }
        });
      });

      m.root.querySelectorAll('[data-day-swap]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const bid = btn.getAttribute('data-day-swap');
          const b = allB.find((x) => x.id === bid);
          m.close();
          openOfferSwapModal(b);
        });
      });
      m.root.querySelectorAll('[data-day-cancel-swap]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const bid = btn.getAttribute('data-day-cancel-swap');
          const b = allB.find((x) => x.id === bid);
          if (b) {
            b.swapRequested = false;
            store.upsert('bookings', b);
            ui.toast('Swap offer cancelled.', 'ok');
            m.close();
            renderActiveTab();
          }
        });
      });
      m.root.querySelectorAll('[data-day-claim]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const bid = btn.getAttribute('data-day-claim');
          const b = allB.find((x) => x.id === bid);
          m.close();
          openClaimSwapModal(b);
        });
      });
      m.root.querySelectorAll('[data-day-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const bid = btn.getAttribute('data-day-edit');
          const b = allB.find((x) => x.id === bid);
          m.close();
          if (b) openBookingModal(b);
        });
      });
      m.root.querySelectorAll('[data-day-edit-item]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = btn.getAttribute('data-day-edit-item');
          const item = allScheduleItemsMap.get(key);
          m.close();
          if (item) {
            openBookingModal({
              eventId: item.eventId,
              eventName: item.eventName,
              space: normalizeSpace(item.space || 'The Stage'),
              date: normalizeDate(item.date) || normDate,
              startTime: normalizeTime(item.startTime, '17:00'),
              finishTime: normalizeTime(item.finishTime, '23:30'),
              userId: item.userId || '',
              userName: item.userName || '',
              role: item.role || 'Sound',
              status: item.status || 'pencil',
            });
          }
        });
      });
      m.root.querySelector('#day-add-shift-btn')?.addEventListener('click', () => {
        m.close();
        openBookingModal({ date: normDate, startTime: '17:00', finishTime: '23:30', status: 'pencil' });
      });
    }

    // 2. Technician Availability Modal (Single Date: All Day vs Specific Time Range)
    function openAvailabilityModal(data = {}) {
      const allUsers = getAllUsers();
      const isNew = !data.id;
      const targetUserId = data.userId || (me ? me.id : 'user-3');
      const targetUser = allUsers.find((u) => u.id === targetUserId);
      const targetName = targetUser ? auth.displayName(targetUser) : 'Technician';

      // Determine initial mode: 'all_day' | 'custom' | 'unavailable'
      let currentMode = 'all_day';
      if (data.type === 'unavailable') {
        currentMode = 'unavailable';
      } else if (data.dayPart === 'custom' || (data.startTime && (data.startTime !== '08:00' || data.finishTime !== '23:30'))) {
        currentMode = 'custom';
      } else if (data.dayPart === 'morning' || data.dayPart === 'afternoon' || data.dayPart === 'evening') {
        currentMode = 'custom';
      } else {
        currentMode = 'all_day';
      }

      let currentStart = data.startTime || (data.dayPart === 'morning' ? '08:00' : (data.dayPart === 'afternoon' ? '13:00' : '17:00'));
      let currentEnd = data.finishTime || (data.dayPart === 'morning' ? '13:00' : (data.dayPart === 'afternoon' ? '18:00' : '23:30'));
      const initialDate = data.date || formatDate(new Date());

      function computeHours(start, end) {
        if (!start || !end) return 0;
        const [sh, sm] = start.split(':').map(Number);
        const [eh, em] = end.split(':').map(Number);
        let diff = (eh * 60 + em) - (sh * 60 + sm);
        if (diff < 0) diff += 24 * 60;
        return Math.round((diff / 60) * 10) / 10;
      }

      const m = ui.modal({
        title: `Set Availability · ${ui.esc(targetName)}`,
        body: `
          <div class="space-y-4 text-xs">
            <!-- Date Banner -->
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-panel2/70 border border-line">
              <div class="flex-1">
                <label class="block text-[11px] font-semibold text-muted mb-1">Calendar Date</label>
                <input type="date" id="av-date" class="field font-mono text-xs py-1.5" value="${initialDate}" />
              </div>
              <div id="av-date-display" class="text-xs font-bold text-accent sm:text-right pt-1 sm:pt-0 sm:pl-3">
                ${formatDisplayDate(initialDate)}
              </div>
            </div>

            <!-- Primary Availability Mode Choice -->
            <div>
              <label class="block font-semibold text-muted mb-1.5">Availability Option</label>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <!-- Option 1: All Day -->
                <button type="button" id="av-mode-allday" class="p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${currentMode === 'all_day' ? 'bg-emerald-500/15 border-emerald-500 text-ink shadow-xs ring-1 ring-emerald-500/50' : 'bg-panel border-line text-muted hover:border-line/90 hover:text-ink'}">
                  <div>
                    <div class="flex items-center justify-between gap-1 mb-1.5">
                      <span class="text-lg">☀️</span>
                      <span class="av-check ${currentMode === 'all_day' ? 'inline-flex' : 'hidden'} px-1.5 py-0.2 rounded-full text-[9.5px] font-bold bg-emerald-500/25 text-emerald-400 border border-emerald-500/40">Active</span>
                    </div>
                    <div class="font-bold text-xs text-ink">All Day</div>
                    <div class="text-[10.5px] text-muted mt-0.5 leading-snug">Full day coverage</div>
                  </div>
                </button>

                <!-- Option 2: Specific Time Range -->
                <button type="button" id="av-mode-custom" class="p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${currentMode === 'custom' ? 'bg-accent/15 border-accent text-ink shadow-xs ring-1 ring-accent/50' : 'bg-panel border-line text-muted hover:border-line/90 hover:text-ink'}">
                  <div>
                    <div class="flex items-center justify-between gap-1 mb-1.5">
                      <span class="text-lg">⏱️</span>
                      <span class="av-check ${currentMode === 'custom' ? 'inline-flex' : 'hidden'} px-1.5 py-0.2 rounded-full text-[9.5px] font-bold bg-accent/25 text-accent border border-accent/40">Active</span>
                    </div>
                    <div class="font-bold text-xs text-ink">Specific Time Range</div>
                    <div class="text-[10.5px] text-muted mt-0.5 leading-snug">Choose exact From / Till hours</div>
                  </div>
                </button>

                <!-- Option 3: Unavailable -->
                <button type="button" id="av-mode-unavail" class="p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${currentMode === 'unavailable' ? 'bg-rose-500/15 border-rose-500 text-ink shadow-xs ring-1 ring-rose-500/50' : 'bg-panel border-line text-muted hover:border-line/90 hover:text-ink'}">
                  <div>
                    <div class="flex items-center justify-between gap-1 mb-1.5">
                      <span class="text-lg">✕</span>
                      <span class="av-check ${currentMode === 'unavailable' ? 'inline-flex' : 'hidden'} px-1.5 py-0.2 rounded-full text-[9.5px] font-bold bg-rose-500/25 text-rose-400 border border-rose-500/40">Active</span>
                    </div>
                    <div class="font-bold text-xs text-ink">Unavailable</div>
                    <div class="text-[10.5px] text-muted mt-0.5 leading-snug">Off duty / not accepting shifts</div>
                  </div>
                </button>
              </div>
            </div>

            <!-- All Day Details Banner -->
            <div id="av-allday-info" class="${currentMode === 'all_day' ? 'block' : 'hidden'} p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-3 text-xs text-emerald-300">
              <span class="text-2xl shrink-0">☀️</span>
              <div>
                <div class="font-bold text-ink">All Day</div>
                <div class="text-[11px] text-muted mt-0.5">You are available for any morning, afternoon, or evening shifts on this day.</div>
              </div>
            </div>

            <!-- Specific Time Range Settings -->
            <div id="av-timerange-area" class="${currentMode === 'custom' ? 'block' : 'hidden'} space-y-3 p-3.5 rounded-xl bg-panel2/60 border border-line">
              <div class="flex items-center justify-between">
                <span class="font-semibold text-ink text-xs flex items-center gap-1.5">
                  ${ui.icon('clock', 'w-3.5 h-3.5 text-accent')}
                  <span>Shift Availability Timing</span>
                </span>
                <span id="av-duration-badge" class="font-mono text-xs font-bold px-2 py-0.5 rounded bg-panel border border-line text-accent">
                  ${computeHours(currentStart, currentEnd)}h total
                </span>
              </div>

              <!-- From & Till inputs -->
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-[11px] font-semibold text-muted mb-1">From (Start Time)</label>
                  <input type="time" id="av-start" class="field font-mono text-xs" value="${currentStart}" />
                </div>
                <div>
                  <label class="block text-[11px] font-semibold text-muted mb-1">Till (Finish Time)</label>
                  <input type="time" id="av-end" class="field font-mono text-xs" value="${currentEnd}" />
                </div>
              </div>

              <!-- Quick Presets -->
              <div>
                <div class="text-[10.5px] text-muted font-semibold mb-1.5">Quick Presets:</div>
                <div class="flex flex-wrap gap-1.5">
                  <button type="button" data-preset="17:00|23:30" class="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-panel border border-line hover:border-accent hover:text-accent transition cursor-pointer">
                    🌆 Evening (17:00 – 23:30)
                  </button>
                  <button type="button" data-preset="08:00|16:30" class="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-panel border border-line hover:border-accent hover:text-accent transition cursor-pointer">
                    ☀️ Daytime (08:00 – 16:30)
                  </button>
                  <button type="button" data-preset="13:00|21:00" class="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-panel border border-line hover:border-accent hover:text-accent transition cursor-pointer">
                    🎬 Afternoon (13:00 – 21:00)
                  </button>
                  <button type="button" data-preset="18:00|00:00" class="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-panel border border-line hover:border-accent hover:text-accent transition cursor-pointer">
                    🌙 Late Show (18:00 – 00:00)
                  </button>
                </div>
              </div>
            </div>

            <!-- Unavailable Info Banner -->
            <div id="av-unavail-info" class="${currentMode === 'unavailable' ? 'block' : 'hidden'} p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center gap-3 text-xs text-rose-300">
              <span class="text-2xl shrink-0">✕</span>
              <div>
                <div class="font-bold text-ink">Marked as Unavailable</div>
                <div class="text-[11px] text-muted mt-0.5">Managers will see that you are unavailable for shifts on this day.</div>
              </div>
            </div>

            <!-- Optional Notes -->
            <div>
              <label class="block font-semibold text-muted mb-1">Optional Notes</label>
              <input id="av-notes" class="field text-xs" value="${ui.esc(data.notes || '')}" placeholder="e.g. Cinema / sound preferred, traveling by train, available earlier if needed" />
            </div>
          </div>
        `,
        footer: [
          ...(!isNew ? [
            '<button type="button" id="av-delete" class="btn btn-danger mr-auto">Clear Date</button>'
          ] : []),
          '<button type="button" class="btn btn-ghost" data-close>Cancel</button>',
          '<button type="button" id="av-save" class="btn btn-primary" data-primary>Save Availability</button>',
        ].join(''),
        actions: [
          ...(!isNew ? [
            '<button type="button" id="av-delete" class="btn btn-danger mr-auto">Clear Date</button>'
          ] : []),
          '<button type="button" class="btn btn-ghost" data-close>Cancel</button>',
          '<button type="button" id="av-save" class="btn btn-primary" data-primary>Save Availability</button>',
        ]
      });

      const btnAllDay = m.root.querySelector('#av-mode-allday');
      const btnCustom = m.root.querySelector('#av-mode-custom');
      const btnUnavail = m.root.querySelector('#av-mode-unavail');

      const allDayInfo = m.root.querySelector('#av-allday-info');
      const timeRangeArea = m.root.querySelector('#av-timerange-area');
      const unavailInfo = m.root.querySelector('#av-unavail-info');

      const avStart = m.root.querySelector('#av-start');
      const avEnd = m.root.querySelector('#av-end');
      const durationBadge = m.root.querySelector('#av-duration-badge');

      function updateDurationBadge() {
        if (durationBadge && avStart && avEnd) {
          const hrs = computeHours(avStart.value, avEnd.value);
          durationBadge.textContent = `${hrs}h total`;
        }
      }

      function switchMode(newMode) {
        currentMode = newMode;
        // Mode buttons styling
        btnAllDay.className = `p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${currentMode === 'all_day' ? 'bg-emerald-500/15 border-emerald-500 text-ink shadow-xs ring-1 ring-emerald-500/50' : 'bg-panel border-line text-muted hover:border-line/90 hover:text-ink'}`;
        btnCustom.className = `p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${currentMode === 'custom' ? 'bg-accent/15 border-accent text-ink shadow-xs ring-1 ring-accent/50' : 'bg-panel border-line text-muted hover:border-line/90 hover:text-ink'}`;
        btnUnavail.className = `p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${currentMode === 'unavailable' ? 'bg-rose-500/15 border-rose-500 text-ink shadow-xs ring-1 ring-rose-500/50' : 'bg-panel border-line text-muted hover:border-line/90 hover:text-ink'}`;

        btnAllDay.querySelector('.av-check').className = `av-check ${currentMode === 'all_day' ? 'inline-flex' : 'hidden'} px-1.5 py-0.2 rounded-full text-[9.5px] font-bold bg-emerald-500/25 text-emerald-400 border border-emerald-500/40`;
        btnCustom.querySelector('.av-check').className = `av-check ${currentMode === 'custom' ? 'inline-flex' : 'hidden'} px-1.5 py-0.2 rounded-full text-[9.5px] font-bold bg-accent/25 text-accent border border-accent/40`;
        btnUnavail.querySelector('.av-check').className = `av-check ${currentMode === 'unavailable' ? 'inline-flex' : 'hidden'} px-1.5 py-0.2 rounded-full text-[9.5px] font-bold bg-rose-500/25 text-rose-400 border border-rose-500/40`;

        // Content panels
        if (currentMode === 'all_day') {
          allDayInfo.classList.remove('hidden');
          timeRangeArea.classList.add('hidden');
          unavailInfo.classList.add('hidden');
        } else if (currentMode === 'custom') {
          allDayInfo.classList.add('hidden');
          timeRangeArea.classList.remove('hidden');
          unavailInfo.classList.add('hidden');
          updateDurationBadge();
        } else {
          allDayInfo.classList.add('hidden');
          timeRangeArea.classList.add('hidden');
          unavailInfo.classList.remove('hidden');
        }
      }

      btnAllDay.addEventListener('click', () => switchMode('all_day'));
      btnCustom.addEventListener('click', () => switchMode('custom'));
      btnUnavail.addEventListener('click', () => switchMode('unavailable'));

      avStart?.addEventListener('input', updateDurationBadge);
      avEnd?.addEventListener('input', updateDurationBadge);

      // Presets
      m.root.querySelectorAll('[data-preset]').forEach((presetBtn) => {
        presetBtn.addEventListener('click', () => {
          const [s, e] = presetBtn.getAttribute('data-preset').split('|');
          if (avStart) avStart.value = s;
          if (avEnd) avEnd.value = e;
          updateDurationBadge();
        });
      });

      // Date change
      m.root.querySelector('#av-date')?.addEventListener('change', (e) => {
        const val = e.target.value;
        const disp = m.root.querySelector('#av-date-display');
        if (disp && val) disp.textContent = formatDisplayDate(val);
      });

      // Save
      m.root.querySelector('#av-save').addEventListener('click', () => {
        const dStr = normalizeDate(m.root.querySelector('#av-date').value);
        if (!dStr) { ui.toast('Date is required', 'danger'); return; }

        let type = 'available';
        let dayPart = 'all_day';
        let startTime = '08:00';
        let finishTime = '23:30';

        if (currentMode === 'all_day') {
          type = 'available';
          dayPart = 'all_day';
          startTime = '08:00';
          finishTime = '23:30';
        } else if (currentMode === 'custom') {
          type = 'available';
          dayPart = 'custom';
          startTime = (avStart && avStart.value) || '17:00';
          finishTime = (avEnd && avEnd.value) || '23:30';
        } else if (currentMode === 'unavailable') {
          type = 'unavailable';
          dayPart = 'all_day';
          startTime = '';
          finishTime = '';
        }

        // Prevent duplicate records for the same (userId, date)
        const existingOnDate = getUserAvailability(targetUserId, dStr);
        let recordId = data.id || (existingOnDate ? existingOnDate.id : store.uid('avail'));
        if (existingOnDate && data.id && existingOnDate.id !== data.id) {
          store.remove('availability', existingOnDate.id);
        }

        const record = {
          id: recordId,
          userId: targetUserId,
          userName: targetName,
          date: dStr,
          type: type,
          dayPart: dayPart,
          startTime: startTime,
          finishTime: finishTime,
          notes: m.root.querySelector('#av-notes').value.trim(),
          updatedAt: new Date().toISOString(),
        };

        store.upsert('availability', record);
        ui.toast(`Availability saved for ${formatDisplayDate(dStr)}`, 'ok');
        m.close();
        renderActiveTab();
      });

      // Delete
      const delBtn = m.root.querySelector('#av-delete');
      if (delBtn) {
        delBtn.addEventListener('click', () => {
          store.remove('availability', data.id);
          if (RMTP.syncSb && typeof RMTP.syncSb.drain === 'function') {
            try { RMTP.syncSb.drain(); } catch (e) {}
          }
          ui.toast('Availability entry cleared', 'info');
          m.close();
          renderActiveTab();
        });
      }
    }

    // 3. Bulk Multi-Day Period Availability Modal
    function openBulkPeriodModal() {
      const allUsers = getAllUsers();
      const targetUserId = state.selectedUserForAvail || (me ? me.id : 'user-3');
      const targetUser = allUsers.find((u) => u.id === targetUserId);
      const targetName = targetUser ? auth.displayName(targetUser) : 'Technician';

      const now = new Date();
      // Next Month (Default):
      const nextMonthFirst = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const nextMonthLast = new Date(now.getFullYear(), now.getMonth() + 2, 0);
      const nextMonthStartStr = formatDate(nextMonthFirst);
      const nextMonthEndStr = formatDate(nextMonthLast);
      const nextMonthName = nextMonthFirst.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

      // Current Month preset:
      const curMonthFirst = new Date(now.getFullYear(), now.getMonth(), 1);
      const curMonthLast = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const curMonthStartStr = formatDate(curMonthFirst);
      const curMonthEndStr = formatDate(curMonthLast);
      const curMonthName = curMonthFirst.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

      const m = ui.modal({
        title: `Bulk Availability Period · ${ui.esc(targetName)}`,
        body: `
          <div class="space-y-3.5 text-xs">
            <!-- Quick Month Selector Bar -->
            <div class="p-2.5 rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-between gap-2 flex-wrap">
              <span class="text-[11px] font-bold text-accent">Defaulting to Next Month:</span>
              <div class="flex items-center gap-1.5 flex-wrap">
                <button type="button" id="blk-btn-next-month" class="px-2.5 py-1 rounded-lg text-xs font-bold bg-accent text-accent-ink shadow-xs transition">
                  ★ Next Month (${nextMonthName})
                </button>
                <button type="button" id="blk-btn-cur-month" class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-panel border border-line text-muted hover:text-ink transition">
                  This Month (${curMonthName})
                </button>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold text-muted mb-1">Start Date</label>
                <input type="date" id="blk-start-date" class="field font-mono" value="${nextMonthStartStr}" />
              </div>
              <div>
                <label class="block font-semibold text-muted mb-1">End Date</label>
                <input type="date" id="blk-end-date" class="field font-mono" value="${nextMonthEndStr}" />
              </div>
            </div>

            <!-- Days of Week Filter -->
            <div>
              <div class="flex items-center justify-between gap-2 mb-1.5">
                <label class="block font-semibold text-muted">Apply to Days of Week</label>
                <div class="flex items-center gap-1.5 text-[11px]">
                  <button type="button" id="blk-dow-all" class="text-accent font-semibold hover:underline">All 7 Days</button>
                  <span class="text-muted">·</span>
                  <button type="button" id="blk-dow-weekdays" class="text-muted hover:text-ink">Weekdays</button>
                  <span class="text-muted">·</span>
                  <button type="button" id="blk-dow-weekends" class="text-muted hover:text-ink">Weekends</button>
                </div>
              </div>
              <div class="grid grid-cols-7 gap-1 text-center">
                ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => `
                  <label class="p-2 rounded border border-line bg-panel2/60 cursor-pointer text-center select-none hover:border-accent/40 transition">
                    <input type="checkbox" data-dow="${(i + 1) % 7}" class="w-3.5 h-3.5 accent-[var(--accent)] mx-auto block mb-1" checked />
                    <span class="text-[10px] font-bold text-ink">${d}</span>
                  </label>
                `).join('')}
              </div>
            </div>

            <!-- Availability Type & Day-Part -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold text-muted mb-1">Status</label>
                <select id="blk-type" class="field font-semibold">
                  <option value="available">Available for Work</option>
                  <option value="unavailable">Unavailable (Off)</option>
                </select>
              </div>
              <div>
                <label class="block font-semibold text-muted mb-1">Day-Part</label>
                <select id="blk-daypart" class="field font-medium">
                  <option value="all_day">All Day</option>
                  <option value="evening">Evening (18:00 - 23:30)</option>
                  <option value="afternoon">Afternoon (13:00 - 18:00)</option>
                  <option value="morning">Morning (08:00 - 13:00)</option>
                  <option value="custom">Custom Timing</option>
                </select>
              </div>
            </div>

            <div id="blk-custom-hours" class="hidden grid grid-cols-2 gap-3 p-2.5 rounded bg-panel2/50 border border-line">
              <div>
                <label class="block text-[10px] text-muted mb-1">From</label>
                <input type="time" id="blk-from" class="field font-mono" value="16:30" />
              </div>
              <div>
                <label class="block text-[10px] text-muted mb-1">Till</label>
                <input type="time" id="blk-till" class="field font-mono" value="23:30" />
              </div>
            </div>

            <div>
              <label class="block font-semibold text-muted mb-1">Notes (Optional)</label>
              <input id="blk-notes" class="field" placeholder="e.g. Free for Sound, Lighting or AV calls" />
            </div>
          </div>
        `,
        footer: [
          '<button type="button" class="btn btn-ghost" data-close>Cancel</button>',
          `<button type="button" id="blk-submit" class="btn btn-primary" data-primary>Save Availability for ${nextMonthName}</button>`,
        ].join(''),
        actions: [
          '<button type="button" class="btn btn-ghost" data-close>Cancel</button>',
          `<button type="button" id="blk-submit" class="btn btn-primary" data-primary>Save Availability for ${nextMonthName}</button>`,
        ]
      });

      const btnNextM = m.root.querySelector('#blk-btn-next-month');
      const btnCurM = m.root.querySelector('#blk-btn-cur-month');
      const sInput = m.root.querySelector('#blk-start-date');
      const eInput = m.root.querySelector('#blk-end-date');
      const submitBtn = m.root.querySelector('#blk-submit');

      btnNextM?.addEventListener('click', () => {
        sInput.value = nextMonthStartStr;
        eInput.value = nextMonthEndStr;
        btnNextM.className = 'px-2.5 py-1 rounded-lg text-xs font-bold bg-accent text-accent-ink shadow-xs transition';
        btnCurM.className = 'px-2.5 py-1 rounded-lg text-xs font-semibold bg-panel border border-line text-muted hover:text-ink transition';
        if (submitBtn) submitBtn.textContent = `Save Availability for ${nextMonthName}`;
      });

      btnCurM?.addEventListener('click', () => {
        sInput.value = curMonthStartStr;
        eInput.value = curMonthEndStr;
        btnCurM.className = 'px-2.5 py-1 rounded-lg text-xs font-bold bg-accent text-accent-ink shadow-xs transition';
        btnNextM.className = 'px-2.5 py-1 rounded-lg text-xs font-semibold bg-panel border border-line text-muted hover:text-ink transition';
        if (submitBtn) submitBtn.textContent = `Save Availability for ${curMonthName}`;
      });

      m.root.querySelector('#blk-dow-all')?.addEventListener('click', () => {
        m.root.querySelectorAll('[data-dow]').forEach((cb) => { cb.checked = true; });
      });
      m.root.querySelector('#blk-dow-weekdays')?.addEventListener('click', () => {
        m.root.querySelectorAll('[data-dow]').forEach((cb) => {
          const val = parseInt(cb.getAttribute('data-dow'), 10);
          cb.checked = val >= 1 && val <= 5; // Mon-Fri
        });
      });
      m.root.querySelector('#blk-dow-weekends')?.addEventListener('click', () => {
        m.root.querySelectorAll('[data-dow]').forEach((cb) => {
          const val = parseInt(cb.getAttribute('data-dow'), 10);
          cb.checked = val === 6 || val === 0; // Sat, Sun
        });
      });

      const dpSel = m.root.querySelector('#blk-daypart');
      const customArea = m.root.querySelector('#blk-custom-hours');
      dpSel.addEventListener('change', () => {
        if (dpSel.value === 'custom') customArea.classList.remove('hidden');
        else customArea.classList.add('hidden');
      });

      m.root.querySelector('#blk-submit').addEventListener('click', () => {
        const sDate = parseDate(m.root.querySelector('#blk-start-date').value);
        const eDate = parseDate(m.root.querySelector('#blk-end-date').value);
        if (sDate > eDate) {
          ui.toast('End date must be after start date', 'danger');
          return;
        }

        const checkedDows = new Set();
        m.root.querySelectorAll('[data-dow]:checked').forEach((cb) => {
          checkedDows.add(parseInt(cb.getAttribute('data-dow'), 10));
        });

        if (checkedDows.size === 0) {
          ui.toast('Select at least one day of the week', 'danger');
          return;
        }

        const type = m.root.querySelector('#blk-type').value;
        const dayPart = m.root.querySelector('#blk-daypart').value;
        const notes = m.root.querySelector('#blk-notes').value.trim();

        let sTime = '08:00', fTime = '23:30';
        if (dayPart === 'morning') { sTime = '08:00'; fTime = '13:00'; }
        else if (dayPart === 'afternoon') { sTime = '13:00'; fTime = '18:00'; }
        else if (dayPart === 'evening') { sTime = '18:00'; fTime = '23:30'; }
        else if (dayPart === 'custom') {
          sTime = m.root.querySelector('#blk-from').value || '16:30';
          fTime = m.root.querySelector('#blk-till').value || '23:30';
        }

        let cur = new Date(sDate);
        const allAvail = getAllAvailability();
        const existingByDate = new Map();
        allAvail.forEach((a) => {
          if (a && a.userId === targetUserId && a.date) {
            existingByDate.set(normalizeDate(a.date), a);
          }
        });
        const batchRecords = [];
        const savedAt = new Date().toISOString();

        while (cur <= eDate) {
          const dow = cur.getDay(); // 0 = Sun
          if (checkedDows.has(dow)) {
            const dateStr = formatDate(cur);
            const existing = existingByDate.get(dateStr);
            batchRecords.push({
              id: existing ? existing.id : store.uid('avail'),
              userId: targetUserId,
              userName: targetName,
              date: dateStr,
              type: type,
              dayPart: type === 'available' ? dayPart : 'all_day',
              startTime: type === 'available' ? sTime : '',
              finishTime: type === 'available' ? fTime : '',
              notes: notes,
              updatedAt: savedAt,
            });
          }
          cur.setDate(cur.getDate() + 1);
        }

        if (RMTP.syncSb && typeof RMTP.syncSb.upsertAvailabilityBatch === 'function') {
          RMTP.syncSb.upsertAvailabilityBatch(batchRecords).catch(() => {});
        } else {
          batchRecords.forEach((rec) => store.upsert('availability', rec));
        }

        ui.toast(`Saved availability for ${batchRecords.length} date${batchRecords.length === 1 ? '' : 's'}`, 'ok');
        m.close();
        renderActiveTab();
      });
    }

    // 4. Cancel Shift Modal (Venue-side cancellation with audit note)
    function openCancelShiftModal(booking) {
      const m = ui.modal({
        title: 'Cancel Shift Booking (Venue)',
        body: `
          <div class="space-y-3 text-xs">
            <div class="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400">
              <strong>Venue Cancellation Notice:</strong> Only Technical Managers and Senior Techs can cancel booked shifts. The shift will be marked as Cancelled with the reason stored for audit.
            </div>
            <div>
              <div class="font-semibold text-ink">${ui.esc(booking.eventName)} · ${ui.esc(booking.space)}</div>
              <div class="text-muted font-mono">${formatDisplayDate(booking.date)} (${booking.startTime}–${booking.finishTime}) · ${ui.esc(booking.userName || 'Tech')}</div>
            </div>
            <div>
              <label class="block font-semibold text-muted mb-1">Reason for Cancellation</label>
              <textarea id="c-reason" class="field" rows="3" placeholder="e.g. Event cancelled by promoter, rescheduled show, client requested fewer techs..."></textarea>
            </div>
          </div>
        `,
        footer: [
          '<button type="button" class="btn btn-ghost" data-close>Keep Shift</button>',
          '<button type="button" id="c-confirm" class="btn btn-danger" data-primary>Confirm Cancellation</button>',
        ].join(''),
        actions: [
          '<button type="button" class="btn btn-ghost" data-close>Keep Shift</button>',
          '<button type="button" id="c-confirm" class="btn btn-danger" data-primary>Confirm Cancellation</button>',
        ]
      });

      m.root.querySelector('#c-confirm').addEventListener('click', () => {
        const reason = m.root.querySelector('#c-reason').value.trim();
        if (!reason) {
          ui.toast('Please provide a cancellation reason', 'danger');
          return;
        }

        booking.status = 'cancelled';
        booking.cancelledAt = new Date().toISOString();
        booking.updatedAt = new Date().toISOString();
        booking.cancellationReason = reason;
        store.upsert('bookings', booking);
        if (booking.eventId && RMTP.syncRotaToAdvancing) {
          RMTP.syncRotaToAdvancing(booking.eventId, {
            prevBookingId: booking.id,
            prevUserId: booking.userId,
            prevUserName: booking.userName,
          });
        }

        ui.toast('Shift cancelled', 'ok');
        m.close();
        renderActiveTab();
      });
    }

    // ------------------------------------------------------------------------
    // SEND PDF ROTA MODAL (7-Column A4 Landscape PDF + Pre-Filled Email Draft)
    // ------------------------------------------------------------------------
    function openPdfRotaModal() {
      const wDays = getCurrentWeekDays();
      const weekStart = wDays[0].date;
      const weekEnd = wDays[6].date;

      const [rmY, rmM] = (state.rotaMonth || formatDate(new Date()).slice(0, 7)).split('-');
      const monthStartDate = `${rmY}-${rmM}-01`;
      const monthLastNum = new Date(parseInt(rmY, 10), parseInt(rmM, 10), 0).getDate();
      const monthEndDate = `${rmY}-${rmM}-${String(monthLastNum).padStart(2, '0')}`;

      let preset = 'week'; // 'week' | 'month' | 'custom'
      let startDate = weekStart;
      let endDate = weekEnd;
      let statusScope = 'all_booked'; // 'all_booked' (Confirmed + Pencil) | 'confirmed_only'
      let recipientScope = 'all_techs'; // 'all_techs' | 'booked_only'
      let includeNonCore = !!state.showNonCoreSpaces;

      function formatPdfDate(isoStr) {
        const d = parseDate(isoStr);
        return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
      }

      function collectRotaRows() {
        const usersList = getAllUsers();
        const usersById = new Map(usersList.map((u) => [u.id, u]));
        const rows = [];
        const rowsByKey = new Map();

        function upsertRotaRow(dedupKey, rowObj) {
          const existing = rowsByKey.get(dedupKey);
          if (existing) {
            existing.discipline = mergeShiftRoles(existing.discipline, rowObj.discipline);
            if (rowObj.status === 'confirmed') existing.status = 'confirmed';
            return;
          }
          rowsByKey.set(dedupKey, rowObj);
          rows.push(rowObj);
        }

        // 1. Pull booked shifts from bookings table
        const bookings = getAllBookings(includeNonCore);
        bookings.forEach((b) => {
          if (!b || isBookingNoTechRecord(b)) return;
          const st = String(b.status || 'pencil').toLowerCase();
          if (st === 'cancelled' || st === 'declined') return;
          if (statusScope === 'confirmed_only' && st !== 'confirmed') return;
          if (isPlaceholderBooking(b, usersList)) return;

          const d = normalizeDate(b.date);
          if (!d || d < startDate || d > endDate) return;

          const u = b.userId ? usersById.get(b.userId) : null;
          const techName = b.userName || (u ? auth.displayName(u) : 'Technician');
          const spaceName = normalizeSpace(b.space) || 'Venue';
          const startTime = normalizeTime(b.startTime, 'TBC');
          const endTime = normalizeTime(b.finishTime, 'TBC');
          const discipline = b.role || (u && u.discipline) || 'Tech';

          const dedupKey = `${d}|${String(b.eventId || b.eventName || '').toLowerCase()}|${spaceName.toLowerCase()}|${(b.userId || techName).toLowerCase()}|${startTime}|${endTime}`;
          upsertRotaRow(dedupKey, {
            date: d,
            dateDisplay: formatPdfDate(d),
            eventTitle: b.eventName || 'Venue Shift',
            space: spaceName,
            techBooked: techName,
            techUserId: b.userId || '',
            techEmail: (u && u.email) ? String(u.email).trim() : '',
            discipline: discipline,
            startTime: startTime,
            endTime: endTime,
            status: st,
          });
        });

        // 2. Include any technicians assigned directly on advancing events without a matching booking row
        const events = getAllEvents(includeNonCore);
        events.forEach((ev) => {
          const d = normalizeDate(ev.date);
          if (!d || d < startDate || d > endDate) return;
          if (ev.noTechNeeded) return;
          const evTechs = RMTP.eventTechnicians ? RMTP.eventTechnicians(ev) : [];
          evTechs.forEach((t) => {
            if (!t || t.isNoTech || t.role === 'None') return;
            const st = String(t.bookingStatus || 'confirmed').toLowerCase();
            if (st === 'cancelled' || st === 'declined') return;
            if (statusScope === 'confirmed_only' && st !== 'confirmed') return;

            const u = t.userId ? usersById.get(t.userId) : null;
            const hasReal = !!(u || (t.freelancerName && t.freelancerName.trim() && !/^unassigned(\s+tech)?$/i.test(t.freelancerName.trim())));
            if (!hasReal) return;

            const techName = t.freelancerName || (u ? auth.displayName(u) : 'Technician');
            const spaceName = normalizeSpace(t.space || (Array.isArray(ev.space) ? ev.space[0] : ev.space)) || 'Venue';
            if (!includeNonCore && !isSpaceAllowed(spaceName)) return;
            const startTime = normalizeTime(t.startTime || ev.startTime, 'TBC');
            const endTime = normalizeTime(t.finishTime || ev.finishTime, 'TBC');
            const discipline = t.role || (u && u.discipline) || 'Tech';

            const dedupKey = `${d}|${String(ev.id || ev.name || '').toLowerCase()}|${spaceName.toLowerCase()}|${(t.userId || techName).toLowerCase()}|${startTime}|${endTime}`;
            upsertRotaRow(dedupKey, {
              date: d,
              dateDisplay: formatPdfDate(d),
              eventTitle: ev.name || 'Venue Event',
              space: spaceName,
              techBooked: techName,
              techUserId: t.userId || '',
              techEmail: (u && u.email) ? String(u.email).trim() : '',
              discipline: discipline,
              startTime: startTime,
              endTime: endTime,
              status: st,
            });
          });
        });

        rows.sort((a, b) =>
          a.date.localeCompare(b.date) ||
          a.startTime.localeCompare(b.startTime) ||
          a.space.localeCompare(b.space) ||
          a.techBooked.localeCompare(b.techBooked)
        );
        return rows;
      }

      function collectRecipientEmails(rows) {
        const usersList = getAllUsers().filter((u) => u && u.status !== 'pending' && u.email && !(auth.isHiresTeam && auth.isHiresTeam(u)));
        const emails = new Set();
        if (recipientScope === 'all_techs') {
          usersList.forEach((u) => {
            const em = String(u.email || '').trim();
            if (em && em.includes('@')) emails.add(em);
          });
        } else {
          rows.forEach((r) => {
            if (r.techEmail && r.techEmail.includes('@')) emails.add(r.techEmail);
          });
        }
        return Array.from(emails).sort((a, b) => a.localeCompare(b));
      }

      function buildPrintableDom(rows) {
        const rangeLabel = `${formatPdfDate(startDate)} – ${formatPdfDate(endDate)}`;
        const generatedAt = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const wrap = document.createElement('div');
        wrap.style.cssText = 'width: 1040px; padding: 20px 24px; background: #ffffff; color: #111827; font-family: "IBM Plex Sans", system-ui, -apple-system, sans-serif; box-sizing: border-box;';

        wrap.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid #111827; padding-bottom:10px; margin-bottom:14px;">
            <div>
              <div style="font-size:11px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#6b7280;">Rich Mix Technical Department</div>
              <div style="font-size:20px; font-weight:700; color:#111827; margin-top:2px;">Technical Shift Rota</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:13px; font-weight:700; color:#111827;">${ui.esc(rangeLabel)}</div>
              <div style="font-size:10px; color:#6b7280; margin-top:2px;">${rows.length} booked ${rows.length === 1 ? 'shift' : 'shifts'} · Generated ${ui.esc(generatedAt)} (UK)</div>
            </div>
          </div>
          <table style="width:100%; border-collapse:collapse; font-size:11px; line-height:1.35;">
            <thead>
              <tr style="background:#f3f4f6; border-bottom:1.5px solid #111827; text-align:left;">
                <th style="padding:7px 8px; font-weight:700; color:#111827; white-space:nowrap;">Date</th>
                <th style="padding:7px 8px; font-weight:700; color:#111827;">Event Title</th>
                <th style="padding:7px 8px; font-weight:700; color:#111827; white-space:nowrap;">Space</th>
                <th style="padding:7px 8px; font-weight:700; color:#111827; white-space:nowrap;">Tech Booked</th>
                <th style="padding:7px 8px; font-weight:700; color:#111827; white-space:nowrap;">Tech Discipline</th>
                <th style="padding:7px 8px; font-weight:700; color:#111827; white-space:nowrap; text-align:center;">Start Time</th>
                <th style="padding:7px 8px; font-weight:700; color:#111827; white-space:nowrap; text-align:center;">End Time</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((r, idx) => `
                <tr style="border-bottom:1px solid #e5e7eb; background:${idx % 2 === 1 ? '#f9fafb' : '#ffffff'}; page-break-inside:avoid;">
                  <td style="padding:6px 8px; font-family:'IBM Plex Mono', monospace; white-space:nowrap; color:#111827;">${ui.esc(r.dateDisplay)}</td>
                  <td style="padding:6px 8px; font-weight:600; color:#111827;">${ui.esc(r.eventTitle)}</td>
                  <td style="padding:6px 8px; white-space:nowrap; color:#374151;">${ui.esc(r.space)}</td>
                  <td style="padding:6px 8px; white-space:nowrap; font-weight:600; color:#111827;">${ui.esc(r.techBooked)}${r.status === 'pencil' ? ' <span style="font-weight:500;color:#b45309;font-size:10px;">(Pencil)</span>' : ''}</td>
                  <td style="padding:6px 8px; white-space:nowrap; color:#374151;">${ui.esc(r.discipline)}</td>
                  <td style="padding:6px 8px; font-family:'IBM Plex Mono', monospace; white-space:nowrap; text-align:center; color:#111827;">${ui.esc(r.startTime)}</td>
                  <td style="padding:6px 8px; font-family:'IBM Plex Mono', monospace; white-space:nowrap; text-align:center; color:#111827;">${ui.esc(r.endTime)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
        return wrap;
      }

      async function generatePdfFile(rows) {
        if (!window.html2pdf) {
          ui.toast('PDF generator library is still loading — please try again in a moment.', 'danger');
          return null;
        }
        const filename = `Rich-Mix-Rota-${startDate}-to-${endDate}.pdf`;
        const printNode = buildPrintableDom(rows);
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed; left:-10000px; top:0; z-index:-1; pointer-events:none;';
        host.appendChild(printNode);
        document.body.appendChild(host);
        try {
          await window.html2pdf().set({
            margin: [8, 8, 10, 8],
            filename: filename,
            image: { type: 'jpeg', quality: 0.96 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
            pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
          }).from(printNode).save();
          return filename;
        } finally {
          document.body.removeChild(host);
        }
      }

      function launchEmailDraft(emails, filename, rows) {
        const rangeLabel = `${formatPdfDate(startDate)} – ${formatPdfDate(endDate)}`;
        const subject = `Rich Mix Technical Rota (${rangeLabel})`;
        const body = [
          'Hi all,',
          '',
          `Please find attached the latest Rich Mix Technical Rota for ${rangeLabel} (${rows.length} booked ${rows.length === 1 ? 'shift' : 'shifts'}).`,
          '',
          `Attached file: ${filename}`,
          '',
          'Please double-check your shift timings and reply if you spot any discrepancies or need a swap.',
          '',
          'Thanks,',
          (me ? auth.displayName(me) : 'Rich Mix Technical Team'),
        ].join('\n');

        const bccStr = emails.join(',');
        const mailtoUrl = `mailto:?bcc=${encodeURIComponent(bccStr)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

        if (mailtoUrl.length > 1900) {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(emails.join(', ')).catch(() => {});
          }
          const shortMailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
          const a = document.createElement('a');
          a.href = shortMailto;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          ui.toast(`PDF downloaded & email draft opened. ${emails.length} tech emails copied to clipboard for BCC.`, 'ok');
          return;
        }

        const a = document.createElement('a');
        a.href = mailtoUrl;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }

      const m = ui.modal({
        title: 'Send PDF Rota to Technicians',
        size: 'md:max-w-5xl',
        body: '<div id="pdf-rota-body" class="space-y-4 text-xs"></div>',
        footer:
          '<button type="button" id="pdf-rota-copy-emails" class="btn btn-ghost border border-line text-xs mr-auto flex items-center gap-1.5">' + ui.icon('copy', 'w-3.5 h-3.5') + '<span>Copy Emails</span></button>' +
          '<button type="button" class="btn btn-ghost text-xs" data-close>Close</button>' +
          '<button type="button" id="pdf-rota-download-only" class="btn btn-ghost border border-line text-xs font-semibold flex items-center gap-1.5">' + ui.icon('download', 'w-3.5 h-3.5') + '<span>Download PDF Only</span></button>' +
          '<button type="button" id="pdf-rota-send" class="btn btn-primary text-xs font-semibold flex items-center gap-1.5" data-primary>' + ui.icon('mail', 'w-3.5 h-3.5') + '<span>Download PDF &amp; Draft Email</span></button>',
      });

      function renderPdfModalBody() {
        const bodyEl = m.root.querySelector('#pdf-rota-body');
        if (!bodyEl) return;
        const invalidRange = startDate > endDate;
        const rows = invalidRange ? [] : collectRotaRows();
        const emails = collectRecipientEmails(rows);
        const uniqueTechs = new Set(rows.map((r) => r.techBooked)).size;

        bodyEl.innerHTML = `
          <!-- Controls Bar -->
          <div class="p-3.5 rounded-lg bg-panel2/50 border border-line space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2.5">
              <div class="inline-flex items-center gap-1 p-1 rounded-lg bg-panel border border-line">
                <button type="button" data-pdf-preset="week" class="px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${preset === 'week' ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink'}">Current Week</button>
                <button type="button" data-pdf-preset="month" class="px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${preset === 'month' ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink'}">Current Month</button>
                <button type="button" data-pdf-preset="custom" class="px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${preset === 'custom' ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink'}">Custom Range</button>
              </div>
              <div class="flex items-center gap-2 flex-wrap">
                <label class="flex items-center gap-1.5 text-muted">
                  <span>From</span>
                  <input type="date" id="pdf-start-date" class="field !py-1 !px-2 text-xs font-mono tabular-nums !w-auto" value="${ui.esc(startDate)}" />
                </label>
                <label class="flex items-center gap-1.5 text-muted">
                  <span>To</span>
                  <input type="date" id="pdf-end-date" class="field !py-1 !px-2 text-xs font-mono tabular-nums !w-auto" value="${ui.esc(endDate)}" />
                </label>
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-line/60">
              <div class="flex items-center gap-3 flex-wrap">
                <label class="flex items-center gap-1.5 text-muted">
                  <span>Shifts:</span>
                  <select id="pdf-status-scope" class="field !py-1 !px-2 text-xs !w-auto">
                    <option value="all_booked" ${statusScope === 'all_booked' ? 'selected' : ''}>Confirmed + Pencil</option>
                    <option value="confirmed_only" ${statusScope === 'confirmed_only' ? 'selected' : ''}>Confirmed Only</option>
                  </select>
                </label>
                <label class="flex items-center gap-1.5 text-muted">
                  <span>Recipients:</span>
                  <select id="pdf-recipient-scope" class="field !py-1 !px-2 text-xs !w-auto">
                    <option value="all_techs" ${recipientScope === 'all_techs' ? 'selected' : ''}>All Active Technicians</option>
                    <option value="booked_only" ${recipientScope === 'booked_only' ? 'selected' : ''}>Booked in Range Only</option>
                  </select>
                </label>
                <label class="inline-flex items-center gap-1.5 text-muted cursor-pointer select-none">
                  <input type="checkbox" id="pdf-include-noncore" class="w-3.5 h-3.5 accent-[var(--accent)]" ${includeNonCore ? 'checked' : ''} />
                  <span>Include Non-Core Spaces</span>
                </label>
              </div>
              <div class="font-mono tabular-nums text-[11px] text-muted">
                <strong class="text-ink">${rows.length}</strong> ${rows.length === 1 ? 'shift' : 'shifts'} · <strong class="text-ink">${uniqueTechs}</strong> crew · <strong class="text-accent">${emails.length}</strong> ${emails.length === 1 ? 'recipient' : 'recipients'}
              </div>
            </div>
          </div>

          ${invalidRange ? `
            <div class="p-4 rounded-lg border border-danger/40 bg-danger/10 text-danger text-xs font-medium">
              Start date must be on or before the end date.
            </div>
          ` : (rows.length === 0 ? `
            <div class="p-8 rounded-lg border border-line bg-panel text-center text-muted space-y-1">
              <div class="text-sm font-semibold text-ink">No booked technician shifts in this date range</div>
              <p class="text-xs">Adjust the date range or switch the shift filter to include pencil holds.</p>
            </div>
          ` : `
            <!-- Live 7-Column Table Preview -->
            <div class="border border-line rounded-lg overflow-hidden bg-panel">
              <div class="max-h-[380px] overflow-auto">
                <table class="w-full text-left border-collapse text-xs">
                  <thead class="bg-panel2/70 border-b border-line sticky top-0 z-10 text-[11px] text-muted">
                    <tr>
                      <th class="px-3 py-2 font-semibold whitespace-nowrap">Date</th>
                      <th class="px-3 py-2 font-semibold">Event Title</th>
                      <th class="px-3 py-2 font-semibold whitespace-nowrap">Space</th>
                      <th class="px-3 py-2 font-semibold whitespace-nowrap">Tech Booked</th>
                      <th class="px-3 py-2 font-semibold whitespace-nowrap">Tech Discipline</th>
                      <th class="px-3 py-2 font-semibold whitespace-nowrap text-center">Start Time</th>
                      <th class="px-3 py-2 font-semibold whitespace-nowrap text-center">End Time</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-line/60">
                    ${rows.map((r) => `
                      <tr class="hover:bg-panel2/30">
                        <td class="px-3 py-2 font-mono tabular-nums whitespace-nowrap text-ink">${ui.esc(r.dateDisplay)}</td>
                        <td class="px-3 py-2 font-medium text-ink">${ui.esc(r.eventTitle)}</td>
                        <td class="px-3 py-2 whitespace-nowrap text-muted">${ui.esc(r.space)}</td>
                        <td class="px-3 py-2 whitespace-nowrap font-medium text-ink">
                          ${ui.esc(r.techBooked)}
                          ${r.status === 'pencil' ? '<span class="text-[10px] text-warning ml-1">(Pencil)</span>' : ''}
                        </td>
                        <td class="px-3 py-2 whitespace-nowrap text-muted">${ui.esc(r.discipline)}</td>
                        <td class="px-3 py-2 font-mono tabular-nums whitespace-nowrap text-center text-ink">${ui.esc(r.startTime)}</td>
                        <td class="px-3 py-2 font-mono tabular-nums whitespace-nowrap text-center text-ink">${ui.esc(r.endTime)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
            <p class="text-[11px] text-muted">
              Clicking <strong class="text-ink">Download PDF &amp; Draft Email</strong> saves the A4 landscape PDF to your device and opens a pre-addressed BCC email draft to ${emails.length} technician${emails.length === 1 ? '' : 's'} so you can attach the PDF and hit send.
            </p>
          `)}
        `;

        const sendBtn = m.root.querySelector('#pdf-rota-send');
        const dlBtn = m.root.querySelector('#pdf-rota-download-only');
        const copyBtn = m.root.querySelector('#pdf-rota-copy-emails');
        if (sendBtn) sendBtn.disabled = invalidRange || rows.length === 0;
        if (dlBtn) dlBtn.disabled = invalidRange || rows.length === 0;
        if (copyBtn) copyBtn.disabled = emails.length === 0;

        bodyEl.querySelectorAll('[data-pdf-preset]').forEach((btn) => {
          btn.addEventListener('click', () => {
            preset = btn.getAttribute('data-pdf-preset') || 'week';
            if (preset === 'week') {
              startDate = weekStart;
              endDate = weekEnd;
            } else if (preset === 'month') {
              startDate = monthStartDate;
              endDate = monthEndDate;
            }
            renderPdfModalBody();
          });
        });

        bodyEl.querySelector('#pdf-start-date')?.addEventListener('change', (e) => {
          if (e.target.value) {
            startDate = normalizeDate(e.target.value);
            preset = 'custom';
            renderPdfModalBody();
          }
        });
        bodyEl.querySelector('#pdf-end-date')?.addEventListener('change', (e) => {
          if (e.target.value) {
            endDate = normalizeDate(e.target.value);
            preset = 'custom';
            renderPdfModalBody();
          }
        });
        bodyEl.querySelector('#pdf-status-scope')?.addEventListener('change', (e) => {
          statusScope = e.target.value;
          renderPdfModalBody();
        });
        bodyEl.querySelector('#pdf-recipient-scope')?.addEventListener('change', (e) => {
          recipientScope = e.target.value;
          renderPdfModalBody();
        });
        bodyEl.querySelector('#pdf-include-noncore')?.addEventListener('change', (e) => {
          includeNonCore = e.target.checked;
          renderPdfModalBody();
        });
      }

      renderPdfModalBody();

      m.root.querySelector('#pdf-rota-copy-emails')?.addEventListener('click', () => {
        const rows = collectRotaRows();
        const emails = collectRecipientEmails(rows);
        if (!emails.length) { ui.toast('No technician email addresses found.', 'info'); return; }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(emails.join(', ')).then(() => {
            ui.toast(`Copied ${emails.length} technician email${emails.length === 1 ? '' : 's'} to clipboard`, 'ok');
          }).catch(() => {
            ui.toast('Could not access clipboard — use Draft Email instead.', 'info');
          });
        }
      });

      m.root.querySelector('#pdf-rota-download-only')?.addEventListener('click', async () => {
        const rows = collectRotaRows();
        if (!rows.length) return;
        const btn = m.root.querySelector('#pdf-rota-download-only');
        if (btn) btn.disabled = true;
        try {
          const filename = await generatePdfFile(rows);
          if (filename) ui.toast(`Downloaded ${filename}`, 'ok');
        } catch (err) {
          console.error('[rota] PDF export error', err);
          ui.toast('Could not generate PDF rota. Please try again.', 'danger');
        } finally {
          if (btn) btn.disabled = false;
        }
      });

      m.root.querySelector('#pdf-rota-send')?.addEventListener('click', async () => {
        const rows = collectRotaRows();
        if (!rows.length) return;
        const emails = collectRecipientEmails(rows);
        const btn = m.root.querySelector('#pdf-rota-send');
        if (btn) btn.disabled = true;
        try {
          const filename = await generatePdfFile(rows);
          if (!filename) return;
          if (emails.length) {
            launchEmailDraft(emails, filename, rows);
            ui.toast(`Downloaded ${filename} & opened email draft for ${emails.length} tech${emails.length === 1 ? '' : 's'}`, 'ok');
          } else {
            ui.toast(`Downloaded ${filename} (no technician emails on file to draft)`, 'info');
          }
        } catch (err) {
          console.error('[rota] PDF export error', err);
          ui.toast('Could not generate PDF rota. Please try again.', 'danger');
        } finally {
          if (btn) btn.disabled = false;
        }
      });
    }

    // Wire Top Buttons
    el.querySelector('#btn-submit-avail')?.addEventListener('click', () => {
      openAvailabilityModal();
    });

    el.querySelector('#btn-bulk-avail')?.addEventListener('click', () => {
      const todayStr = formatDate(new Date());
      const userId = state.selectedUserForAvail || (me ? me.id : 'user-3');
      const existing = getUserAvailability(userId, todayStr);
      openAvailabilityModal({
        date: todayStr,
        userId: userId,
        ...(existing || {})
      });
    });

    el.querySelector('#btn-quick-swap')?.addEventListener('click', () => {
      state._hasUserSwitchedTab = true;
      state.tab = 'swaps';
      el.querySelectorAll('[data-tab]').forEach((b) => {
        b.className = 'shrink-0 px-3.5 py-2 font-semibold rounded-lg transition-colors flex items-center gap-1.5 text-muted hover:text-ink hover:bg-panel2';
      });
      const swapTab = el.querySelector('[data-tab="swaps"]');
      if (swapTab) {
        swapTab.className = 'shrink-0 px-3.5 py-2 font-semibold rounded-lg transition-colors flex items-center gap-1.5 bg-accent text-accent-ink shadow-xs';
      }
      renderActiveTab();
    });

    el.querySelector('#btn-pdf-rota')?.addEventListener('click', () => {
      openPdfRotaModal();
    });

    el.querySelector('#btn-add-booking')?.addEventListener('click', () => {
      openBookingModal();
    });

    // Wire Main Navigation Tabs
    function refreshAvailabilityFromCloud(force) {
      if (!RMTP.syncSb || typeof RMTP.syncSb.pullCollection !== 'function') return;
      if (RMTP.supabase && RMTP.supabase.isConfigured && !RMTP.supabase.isConfigured()) return;
      const now = Date.now();
      if (!force && RMTP._lastRotaAvailPullAt && (now - RMTP._lastRotaAvailPullAt) < 8000) return;
      RMTP._lastRotaAvailPullAt = now;
      RMTP.syncSb.pullCollection('availability').catch(() => {});
      if (auth.pullTechTags) auth.pullTechTags().catch(() => {});
    }

    el.querySelectorAll('[data-tab]').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        state._hasUserSwitchedTab = true;
        state.tab = tabBtn.getAttribute('data-tab');
        el.querySelectorAll('[data-tab]').forEach((b) => {
          b.className = 'shrink-0 px-3.5 py-2 font-semibold rounded-lg transition-colors flex items-center gap-1.5 text-muted hover:text-ink hover:bg-panel2';
        });
        tabBtn.className = 'shrink-0 px-3.5 py-2 font-semibold rounded-lg transition-colors flex items-center gap-1.5 bg-accent text-accent-ink shadow-xs';
        renderActiveTab();
        if (state.tab === 'my_avail' || state.tab === 'day_planner' || state.tab === 'team_matrix') {
          refreshAvailabilityFromCloud(false);
        }
      });
    });

    // Clean up prior Rota mount listeners before registering new ones
    if (typeof RMTP._rotaCleanup === 'function') {
      try { RMTP._rotaCleanup(); } catch (e) {}
    }

    // Listen for live venue crew specification updates, Tech Tag updates, and cloud availability refreshes
    let isRenderingFromStore = false;
    const myRenderToken = RMTP._renderToken;
    const isRotaStillActive = () => {
      if (RMTP._currentView && RMTP._currentView !== 'rota') return false;
      if (myRenderToken != null && RMTP._renderToken !== myRenderToken) return false;
      return el.isConnected;
    };

    const onVenuesUpdated = () => {
      if (!isRotaStillActive()) return;
      renderActiveTab();
    };
    const onTechTagsUpdated = () => {
      if (!isRotaStillActive()) return;
      renderActiveTab();
    };
    window.addEventListener('rmtp:venues-updated', onVenuesUpdated);
    window.addEventListener('rmtp:tech-tags-updated', onTechTagsUpdated);

    const unsubStore = store.onChange((collName) => {
      if (collName !== 'availability' && collName !== 'bookings') return;
      if (!isRotaStillActive() || isRenderingFromStore) return;
      isRenderingFromStore = true;
      try { renderActiveTab(); } finally { isRenderingFromStore = false; }
    });

    const teardownRota = () => {
      window.removeEventListener('rmtp:venues-updated', onVenuesUpdated);
      window.removeEventListener('rmtp:tech-tags-updated', onTechTagsUpdated);
      if (typeof unsubStore === 'function') unsubStore();
      if (RMTP._rotaCleanup === teardownRota) RMTP._rotaCleanup = null;
    };
    RMTP._rotaCleanup = teardownRota;
    if (RMTP.router && typeof RMTP.router.onUnmount === 'function') {
      RMTP.router.onUnmount(teardownRota);
    }

    // Initial render + background cloud availability sync
    renderActiveTab();
    refreshAvailabilityFromCloud(true);
  };
})();
