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
    const isTMOrAdmin = (isTechManager || isAdmin);

    // View state
    RMTP._rotaState = RMTP._rotaState || {
      tab: 'board', // 'board' | 'my_avail' | 'swaps' | 'team_matrix' | 'list'
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
      roleFilter: '',
      statusFilter: '',
      techFilter: '',
      searchQuery: '',
      swapFilter: 'all',
      availMonth: new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'),
      selectedUserForAvail: me ? me.id : 'user-3',
    };
    const state = RMTP._rotaState;
    if (state.density === undefined) state.density = 'compact';
    if (!state.boardView || state.boardView === 'timeline') state.boardView = 'month';
    if (!state.rotaMonth) state.rotaMonth = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
    if (!state.collapsedSpaces) state.collapsedSpaces = new Set();
    if (!state.selectedDay) state.selectedDay = formatDate(new Date());
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

    function parseDate(str) {
      if (!str) return new Date();
      const parts = str.split('-');
      return new Date(parts[0], parts[1] - 1, parts[2]);
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

    function getAllBookings() {
      return store.all('bookings') || [];
    }

    function ensureSampleSwap() {
      const allB = getAllBookings();
      const hasSwap = allB.some((b) => b.swapRequested && b.status !== 'cancelled');
      if (!hasSwap && allB.length > 0) {
        const candidate = allB.find((b) => b.userId !== (me ? me.id : '')) || allB[0];
        if (candidate) {
          candidate.swapRequested = true;
          candidate.swapOfferedBy = candidate.userId;
          candidate.swapOfferedByName = candidate.userName || 'Maya Lin';
          candidate.swapOfferedAt = new Date().toISOString();
          candidate.swapReason = candidate.swapReason || 'Double-booked with rehearsals, looking for cover on this shift.';
          store.upsert('bookings', candidate);
        }
      }
    }
    ensureSampleSwap();

    function getAllUsers() {
      return store.all('users') || [];
    }
    const allUsers = getAllUsers();

    function getAllEvents() {
      return (store.all('advancing') || []).filter((e) => !e.deleted);
    }

    function getUserAvailability(userId, dateStr) {
      const all = getAllAvailability();
      return all.find((a) => a.userId === userId && a.date === dateStr);
    }

    function getUserBookingsOnDate(userId, dateStr) {
      const all = getAllBookings();
      return all.filter((b) => b.userId === userId && b.date === dateStr && b.status !== 'cancelled' && b.status !== 'declined');
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
        let partLabel = 'All Day';
        if (avail.dayPart === 'morning') partLabel = 'Morning (08:00-13:00)';
        else if (avail.dayPart === 'afternoon') partLabel = 'Afternoon (13:00-18:00)';
        else if (avail.dayPart === 'evening') partLabel = 'Evening (18:00-23:30)';
        else if (avail.dayPart === 'custom') partLabel = `${avail.startTime || ''}–${avail.finishTime || ''}`;

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

    // Unified helper: builds all shifts & advancing events for any date dynamically,
    // consolidating multi-room takeovers into a single card with crew needed vs assigned.
    function getDaySchedule(dateStr) {
      const allB = getAllBookings().filter((b) => b.date === dateStr);
      const allEv = getAllEvents().filter((e) => e.date === dateStr);
      const allUsers = getAllUsers();

      const items = [];
      const handledEventIds = new Set();
      const handledBookingIds = new Set();

      // --- STEP 1: DETECT AND CLUSTER MULTI-ROOM TAKEOVERS ---
      // A takeover is an event that:
      // - Has ev.isTakeover === true, OR
      // - Has multiple spaces in ev.space (array) or ev.spaces (array), OR
      // - Multiple events on this date share the same groupId or same name (case-insensitive) across spaces
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
        const nameMatches = allEv.filter((other) => other.id !== ev.id && other.name && ev.name && other.name.trim().toLowerCase() === ev.name.trim().toLowerCase() && other.date === dateStr);

        if (isExplicitMulti || groupEvents || nameMatches.length > 0) {
          const clusterEvents = groupEvents ? groupEvents : (nameMatches.length > 0 ? [ev, ...nameMatches] : [ev]);
          clusterEvents.forEach((e) => usedEventIdsForTakeover.add(e.id));

          // Collect spaces
          const spacesSet = new Set();
          clusterEvents.forEach((e) => {
            if (Array.isArray(e.spaces)) e.spaces.forEach((s) => spacesSet.add(s));
            if (Array.isArray(e.space)) e.space.forEach((s) => spacesSet.add(s));
            else if (e.space) spacesSet.add(e.space);
          });

          takeoverClusters.push({
            primaryEvent: ev,
            events: clusterEvents,
            spaces: Array.from(spacesSet),
            name: ev.name,
            date: dateStr,
            groupId: ev.groupId || ('takeover-' + ev.id),
          });
        }
      });

      // --- BUILD CONSOLIDATED TAKEOVER ITEMS ---
      takeoverClusters.forEach((cl) => {
        cl.events.forEach((e) => handledEventIds.add(e.id));

        const spaces = cl.spaces.length > 0 ? cl.spaces : ['The Stage', 'The Studio'];
        const totalCrewNeeded = spaces.reduce((sum, sp) => sum + getSpaceBasicCrew(sp), 0);

        // Find all bookings for this takeover
        const takeoverBookings = allB.filter((b) => {
          if (cl.events.some((e) => e.id === b.eventId)) return true;
          if (b.groupId && b.groupId === cl.groupId) return true;
          if (spaces.includes(b.space) && b.eventName && b.eventName.trim().toLowerCase() === cl.name.trim().toLowerCase()) return true;
          return false;
        });
        takeoverBookings.forEach((b) => handledBookingIds.add(b.id));

        // Find all event technicians for this takeover
        const allEvTechs = [];
        cl.events.forEach((e) => {
          const techs = RMTP.eventTechnicians ? RMTP.eventTechnicians(e) : [];
          techs.forEach((t) => allEvTechs.push({ ...t, eventSpace: Array.isArray(e.space) ? e.space[0] : e.space }));
        });

        // Compute space breakdown with discipline fulfillment
        const spaceBreakdown = spaces.map((sp) => {
          const specs = RMTP.getSpaceCrewSpecs ? RMTP.getSpaceCrewSpecs(sp) : { total: getSpaceBasicCrew(sp), disciplines: [{ role: 'Sound', count: 1 }], summary: '1x Sound' };
          const basic = specs.total;
          const spBookings = takeoverBookings.filter((b) => b.space === sp && b.status !== 'cancelled');
          const spTechs = allEvTechs.filter((t) => (t.space === sp || t.eventSpace === sp) && (t.bookingStatus || 'confirmed') !== 'cancelled');

          const assignedTechs = [];
          spBookings.forEach((b) => {
            const u = allUsers.find((u) => u.id === b.userId);
            assignedTechs.push({
              id: b.userId || b.id,
              name: b.userName || (u ? auth.displayName(u) : 'Technician'),
              role: b.role || 'Tech',
              status: b.status || 'pencil',
              bookingId: b.id,
            });
          });
          spTechs.forEach((t) => {
            const u = allUsers.find((u) => u.id === t.userId);
            if (!assignedTechs.some((at) => at.id === t.userId)) {
              assignedTechs.push({
                id: t.userId || 'tech',
                name: t.freelancerName || (u ? auth.displayName(u) : 'Technician'),
                role: t.role || 'Tech',
                status: t.bookingStatus || 'confirmed',
              });
            }
          });

          // Discipline fulfillment status for this space
          const disciplineStatus = (specs.disciplines || []).map((cd) => {
            const reqCount = cd.count || 1;
            const assignedCount = assignedTechs.filter((t) => {
              const tr = (t.role || '').toLowerCase();
              const cr = (cd.role || '').toLowerCase();
              return tr === cr || (cr.includes('sound') && tr.includes('sound')) || (cr.includes('light') && tr.includes('light')) || (cr.includes('cinema') && tr.includes('cinema'));
            }).length;
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
          const gap = Math.max(0, basic - assignedCount);
          return {
            space: sp,
            basicCrew: basic,
            specsSummary: specs.summary,
            specsDisciplines: specs.disciplines,
            disciplineStatus: disciplineStatus,
            missingDisciplines: missingDisciplines,
            assignedCount: assignedCount,
            assignedTechs: assignedTechs,
            gap: gap,
            isFilled: assignedCount >= basic,
          };
        });

        const totalCrewAssigned = spaceBreakdown.reduce((sum, sb) => sum + sb.assignedCount, 0);
        const unfilledSpaces = spaceBreakdown.filter((sb) => !sb.isFilled).map((sb) => sb.space);
        const isFullyStaffed = unfilledSpaces.length === 0 && totalCrewAssigned >= totalCrewNeeded;

        // Apply filters
        if (state.spaceFilter && !spaces.includes(state.spaceFilter)) return;
        if (state.unfilledOnly && isFullyStaffed) return;
        if (state.eventsFilter === 'staffed' && !isFullyStaffed && totalCrewAssigned === 0) return;
        if (state.statusFilter) {
          const matchesStatus = (state.statusFilter === 'confirmed' && isFullyStaffed) ||
                                (state.statusFilter === 'pencil' && !isFullyStaffed && totalCrewAssigned > 0) ||
                                (state.statusFilter === 'unfilled' && !isFullyStaffed);
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
        const item = {
          key: 'takeover_' + (cl.groupId || primary.id),
          type: 'takeover',
          eventId: primary.id,
          groupId: cl.groupId,
          advEvent: primary,
          eventName: cl.name,
          space: spaces.join(', '),
          spaces: spaces,
          date: dateStr,
          startTime: primary.startTime || '17:00',
          finishTime: primary.finishTime || '23:30',
          totalCrewNeeded: totalCrewNeeded,
          totalCrewAssigned: totalCrewAssigned,
          spaceBreakdown: spaceBreakdown,
          unfilledSpaces: unfilledSpaces,
          isFullyStaffed: isFullyStaffed,
          isUnfilled: unfilledSpaces.length > 0,
          status: isFullyStaffed ? 'confirmed' : (totalCrewAssigned > 0 ? 'pencil' : 'unfilled'),
          notes: primary.notes || primary.techInfo || '',
        };
        items.push(item);
        allScheduleItemsMap.set(item.key, item);
      });

      // --- STEP 2: REMAINING REGULAR BOOKINGS ---
      allB.forEach((b) => {
        if (handledBookingIds.has(b.id)) return;
        if (state.spaceFilter && b.space !== state.spaceFilter) return;
        if (state.roleFilter && b.role !== state.roleFilter) return;
        if (state.statusFilter && b.status !== state.statusFilter) return;
        if (state.techFilter && b.userId !== state.techFilter) return;
        if (state.unfilledOnly) return;
        if (state.searchQuery) {
          const q = state.searchQuery.toLowerCase();
          const match = (b.eventName && b.eventName.toLowerCase().includes(q)) ||
                        (b.space && b.space.toLowerCase().includes(q)) ||
                        (b.userName && b.userName.toLowerCase().includes(q)) ||
                        (b.role && b.role.toLowerCase().includes(q));
          if (!match) return;
        }

        if (b.eventId) handledEventIds.add(b.eventId);
        const techObj = allUsers.find((u) => u.id === b.userId);
        const isBookingNoTech = !!b.isNoTech || b.role === 'None';
        const item = {
          key: 'b_' + b.id,
          type: 'booking',
          id: b.id,
          booking: b,
          eventId: b.eventId,
          eventName: b.eventName || 'Venue Shift',
          space: b.space || 'Venue',
          date: b.date,
          startTime: b.startTime || '17:00',
          finishTime: b.finishTime || '23:30',
          userId: isBookingNoTech ? '' : b.userId,
          userName: isBookingNoTech ? 'No Tech Required' : (b.userName || (techObj ? auth.displayName(techObj) : 'Unassigned Tech')),
          role: isBookingNoTech ? 'None' : (b.role || 'Tech'),
          status: isBookingNoTech ? 'confirmed' : (b.status || 'pencil'),
          rate: b.rate,
          notes: b.notes,
          splitFromId: b.splitFromId || '',
          legIndex: b.legIndex || '',
          isUnfilled: false,
          isNoTech: isBookingNoTech,
        };
        items.push(item);
        allScheduleItemsMap.set(item.key, item);
      });

      // --- STEP 3: REMAINING ADVANCING EVENTS (SINGLE ROOM) ---
      allEv.forEach((ev) => {
        if (handledEventIds.has(ev.id)) return;
        const spaceVal = Array.isArray(ev.space) ? ev.space[0] : (ev.space || 'Venue');
        if (state.spaceFilter && spaceVal !== state.spaceFilter) return;

        if (state.searchQuery) {
          const q = state.searchQuery.toLowerCase();
          const match = (ev.name && ev.name.toLowerCase().includes(q)) ||
                        (spaceVal && spaceVal.toLowerCase().includes(q)) ||
                        ((ev.notes || ev.techInfo || '') && (ev.notes || ev.techInfo || '').toLowerCase().includes(q));
          if (!match) return;
        }

        const isEventNoTech = !!ev.noTechNeeded;

        const evTechs = RMTP.eventTechnicians ? RMTP.eventTechnicians(ev) : [];
        if (evTechs && evTechs.length > 0) {
          if (state.unfilledOnly) return;
          evTechs.forEach((t, idx) => {
            if (state.techFilter && t.userId !== state.techFilter) return;
            if (state.roleFilter && t.role !== state.roleFilter) return;
            if (state.statusFilter && (t.bookingStatus || 'confirmed') !== state.statusFilter) return;

            const techObj = allUsers.find((u) => u.id === t.userId);
            const isNoTech = isEventNoTech || !!t.isNoTech || t.role === 'None';
            const hasAssigned = !!(t.userId || (t.freelancerName && t.freelancerName.trim()));
            const isSlotUnfilled = !isNoTech && !hasAssigned;
            if (state.eventsFilter === 'staffed' && isSlotUnfilled) return;
            const tName = isNoTech ? 'No Tech Required' : (t.freelancerName || (techObj ? auth.displayName(techObj) : (t.userId ? 'Tech' : 'Unassigned')));

            const item = {
              key: 'evtech_' + ev.id + '_' + idx,
              type: 'adv_tech',
              eventId: ev.id,
              advEvent: ev,
              eventName: ev.name,
              space: spaceVal,
              date: ev.date,
              startTime: t.startTime || ev.startTime || '18:00',
              finishTime: t.finishTime || ev.finishTime || '23:00',
              userId: isNoTech ? '' : t.userId,
              userName: tName,
              role: isNoTech ? 'None' : (t.role || 'Tech'),
              status: isSlotUnfilled ? 'unfilled' : (t.bookingStatus || 'confirmed'),
              splitFromId: t.splitFromId || '',
              legIndex: t.legIndex || '',
              notes: ev.notes || ev.techInfo || (ev.artifaxHistory && ev.artifaxHistory.length ? ev.artifaxHistory[ev.artifaxHistory.length - 1].notes : '') || ev.artifaxNotes || '',
              isUnfilled: isSlotUnfilled,
              isNoTech: isNoTech,
            };
            items.push(item);
            allScheduleItemsMap.set(item.key, item);
          });
        } else if (isEventNoTech) {
          // Self-Service advancing event with zero crew needed
          if (state.unfilledOnly) return;
          const item = {
            key: 'notech_' + ev.id,
            type: 'notech',
            eventId: ev.id,
            advEvent: ev,
            eventName: ev.name,
            space: spaceVal,
            date: ev.date,
            startTime: ev.startTime || '18:00',
            finishTime: ev.finishTime || '23:00',
            userId: '',
            userName: 'No Tech Required',
            role: 'None',
            status: 'confirmed',
            notes: ev.notes || ev.techInfo || (ev.artifaxHistory && ev.artifaxHistory.length ? ev.artifaxHistory[ev.artifaxHistory.length - 1].notes : '') || ev.artifaxNotes || '',
            isUnfilled: false,
            isNoTech: true,
          };
          items.push(item);
          allScheduleItemsMap.set(item.key, item);
        } else {
          // Unfilled advancing event (Gap!)
          // If specifically set to 'staffed' only, skip unfilled gaps
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
            date: ev.date,
            startTime: ev.startTime || '18:00',
            finishTime: ev.finishTime || '23:00',
            userId: '',
            userName: 'Unassigned',
            role: defaultRole,
            status: 'unfilled',
            notes: ev.notes || ev.techInfo || (ev.artifaxHistory && ev.artifaxHistory.length ? ev.artifaxHistory[ev.artifaxHistory.length - 1].notes : '') || ev.artifaxNotes || '',
            isUnfilled: true,
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
                <span class="px-1.5 py-0.2 rounded text-[9.5px] font-bold border ${roomBreakdown.isFilled ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'} shrink-0">
                  ${roomBreakdown.isFilled ? 'Staffed' : 'Unfilled'}
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
                  <span class="font-mono font-bold text-[11px] ${roomBreakdown.isFilled ? 'text-emerald-400' : 'text-amber-400'}">
                    ${roomBreakdown.assignedCount}/${roomBreakdown.basicCrew} Assigned
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
                    <button type="button" data-assign-space-crew="${item.key}|${ui.esc(sb.space)}|${ui.esc(sb.missingDisciplines ? sb.missingDisciplines[0] || '' : '')}" class="px-2 py-0.5 rounded text-[9.5px] font-semibold border transition flex items-center gap-1 ${sb.isFilled ? 'bg-panel border-line text-ink' : 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20'}" title="${ui.esc(sb.space)}: ${sb.assignedCount}/${sb.basicCrew} crew (${ui.esc(sb.specsSummary || '')}) - click to assign">
                      <span class="w-1.5 h-1.5 rounded-full ${sb.isFilled ? 'bg-emerald-400' : 'bg-amber-400'} shrink-0"></span>
                      <span class="truncate max-w-[120px]">${ui.esc(sb.space)}</span>
                      <span class="font-mono text-[9px] opacity-80">(${sb.assignedCount}/${sb.basicCrew})</span>
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

      const totalWeekBookings = allB.filter((b) => b.date >= wStart && b.date <= wEnd && b.status !== 'cancelled');
      const confirmedCount = totalWeekBookings.filter((b) => b.status === 'confirmed').length;
      const pencilCount = totalWeekBookings.filter((b) => b.status === 'pencil').length;
      const activeFreelancers = new Set(totalWeekBookings.map((b) => b.userId).filter(Boolean)).size;

      const weekEvents = allEv.filter((e) => e.date >= wStart && e.date <= wEnd);
      const unfilledWeekEvents = weekEvents.filter((e) => {
        if (e.noTechNeeded) return false;
        const assigned = allB.filter((b) => b.eventId === e.id && b.status !== 'cancelled');
        const evTechs = RMTP.eventTechnicians ? RMTP.eventTechnicians(e) : [];
        return assigned.length === 0 && evTechs.length === 0;
      });

      // Update badge on tabs
      const openSwaps = allB.filter((b) => b.swapRequested && b.status !== 'cancelled');
      const myShifts = allB.filter((b) => me && b.userId === me.id && b.status !== 'cancelled');
      const swapsBadge = el.querySelector('#rota-swaps-count');
      if (swapsBadge) {
        swapsBadge.textContent = openSwaps.length > 0 ? String(openSwaps.length) : '0';
        swapsBadge.style.display = openSwaps.length > 0 ? 'inline-block' : 'none';
      }

      if (!stripEl) return;

      const now = new Date();
      const currentMonthActive = (state.rotaMonth || formatDate(now).slice(0, 7));
      const monthBookings = allB.filter((b) => b.date.startsWith(currentMonthActive) && b.status !== 'cancelled');
      const monthShiftsCount = monthBookings.length;

      // Calculate all advancing events for active month to detect gaps
      const monthEvents = allEv.filter((e) => e.date.startsWith(currentMonthActive));
      const monthUnfilledEvents = monthEvents.filter((e) => {
        if (e.noTechNeeded) return false;
        const assigned = allB.filter((b) => b.eventId === e.id && b.status !== 'cancelled');
        const evTechs = RMTP.eventTechnicians ? RMTP.eventTechnicians(e) : [];
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
              <span>+ Add Availability (Next Month)</span>
            </button>
            <button id="btn-quick-swap" class="btn btn-ghost text-xs flex-1 sm:flex-initial justify-center">
              ${ui.icon('refresh', 'w-4 h-4')}
              <span>Shift Swaps</span>
            </button>
            ${(isTechManager || isAdmin) ? `
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
          ${(isTechManager || isAdmin) ? `
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

    function renderActiveTab() {
      updateTopMetrics();
      if (state.tab === 'board') renderBoardTab();
      else if (state.tab === 'my_avail') renderMyAvailTab();
      else if (state.tab === 'swaps') renderSwapsTab();
      else if (state.tab === 'team_matrix') renderTeamMatrixTab();
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

                <!-- Space Filter Dropdown -->
                <select id="flt-space" class="field !py-1 text-xs max-w-[135px]">
                  <option value="">All Spaces</option>
                  ${RMTP.SPACES.map((s) => `<option value="${ui.esc(s)}" ${state.spaceFilter === s ? 'selected' : ''}>${ui.esc(s)}</option>`).join('')}
                </select>

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
          const swapShifts = dayItems.filter((i) => i.booking && i.booking.swapRequested);
          const unfilledGaps = dayItems.filter((i) => i.isUnfilled && !i.isNoTech);
          const otherStaffed = dayItems.filter((i) => !i.isUnfilled && !i.isNoTech && (!me || i.userId !== me.id) && (!i.booking || !i.booking.swapRequested));
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
              <div data-click-booking="${b.id || (b.booking && b.booking.id) || ''}" class="p-1 rounded bg-accent/20 border border-accent/40 text-accent font-semibold text-[10px] leading-tight truncate flex items-center justify-between gap-1 shadow-2xs hover:bg-accent/30 transition" title="${ui.esc(b.eventName)} · ${ui.esc(b.space)}">
                <span class="truncate">⭐ ${ui.esc(b.role || 'Tech')} · ${ui.esc(b.space)}</span>
                <span class="font-mono text-[9px] opacity-80 shrink-0">${b.startTime}</span>
              </div>
            `;
          });

          // 2. Swap shifts (that are not mine)
          swapShifts.filter((b) => !me || b.userId !== me.id).forEach((b) => {
            out += `
              <div data-click-booking="${b.id || (b.booking && b.booking.id) || ''}" class="p-1 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 font-semibold text-[10px] leading-tight truncate flex items-center justify-between gap-1 hover:bg-amber-500/30 transition" title="Swap Offered: ${ui.esc(b.eventName)}">
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

        // Spaces list
        const activeSpaces = Array.from(new Set([...RMTP.SPACES, ...daySchedule.map((i) => i.space)])).filter(Boolean);
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

        // Gather all venue spaces to show as columns
        const activeSpaces = Array.from(new Set([...RMTP.SPACES, ...daySchedule.map(i => i.space)])).filter(Boolean);

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
          const bid = chip.getAttribute('data-click-booking');
          const b = getAllBookings().find((x) => x.id === bid);
          if (b) openShiftDetailModal(b);
        });
      });
      tabContainer.querySelectorAll('[data-click-unfilled]').forEach((chip) => {
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          const key = chip.getAttribute('data-click-unfilled');
          const item = allScheduleItemsMap.get(key);
          if (item) {
            openBookingModal({
              eventId: item.eventId,
              eventName: item.eventName,
              space: item.space,
              date: item.date,
              startTime: item.startTime,
              finishTime: item.finishTime,
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
        RMTP.SPACES.forEach((s) => state.collapsedSpaces.add(s));
        renderBoardTab();
      });

      // 1-Click Sync Advancing Shifts for current selected day
      tabContainer.querySelector('#btn-sync-advancing-rota')?.addEventListener('click', () => {
        const targetDay = state.selectedDay || formatDate(new Date());
        const dayEvents = (store.all('advancing') || []).filter((e) => e.date === targetDay && !e.deleted);
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
        state.eventsFilter = isTMOrAdmin ? 'all' : 'all';
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
            store.upsert('bookings', b);
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
            openBookingModal({
              eventId: item.eventId,
              eventName: item.eventName,
              space: item.space,
              date: item.date,
              startTime: item.startTime,
              finishTime: item.finishTime,
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
            const targetSpace = spaceName || (item.spaces ? item.spaces[0] : 'The Stage');
            const specs = RMTP.getSpaceCrewSpecs ? RMTP.getSpaceCrewSpecs(targetSpace) : null;
            const targetRole = roleHint || (specs && specs.rolesList && specs.rolesList.length ? specs.rolesList[0] : 'Sound');
            openBookingModal({
              eventId: item.eventId,
              eventName: item.eventName,
              space: targetSpace,
              date: item.date,
              startTime: item.startTime,
              finishTime: item.finishTime,
              role: targetRole,
              status: 'pencil',
            });
          }
        });
      });

      // Card Click Handler: Opens booking/shift modal for instant view, edit or assign
      tabContainer.querySelectorAll('[data-schedule-item]').forEach((card) => {
        card.addEventListener('click', (e) => {
          // If clicked a button inside card, don't trigger modal
          if (e.target.closest('button')) return;
          const key = card.getAttribute('data-schedule-item');
          const item = allScheduleItemsMap.get(key);
          if (!item) return;

          if (item.type === 'takeover') {
            const targetSpace = (item.unfilledSpaces && item.unfilledSpaces.length > 0) ? item.unfilledSpaces[0] : (item.spaces ? item.spaces[0] : 'The Stage');
            openBookingModal({
              eventId: item.eventId,
              eventName: item.eventName,
              space: targetSpace,
              date: item.date,
              startTime: item.startTime,
              finishTime: item.finishTime,
              role: 'Sound',
              status: 'pencil',
            });
          } else if (item.type === 'booking') {
            openBookingModal(item.booking);
          } else if (item.type === 'unfilled') {
            openBookingModal({
              eventId: item.eventId,
              eventName: item.eventName,
              space: item.space,
              date: item.date,
              startTime: item.startTime,
              finishTime: item.finishTime,
              role: 'Sound',
              status: 'pencil',
            });
          } else if (item.type === 'adv_tech') {
            openBookingModal({
              eventId: item.eventId,
              eventName: item.eventName,
              space: item.space,
              date: item.date,
              startTime: item.startTime,
              finishTime: item.finishTime,
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
      const userBookings = getAllBookings().filter((b) => b.userId === selectedUserId && b.status !== 'cancelled');

      const monthName = firstDay.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      const now = new Date();
      const nextMonthFirst = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const nextMonthName = nextMonthFirst.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      const nextMonthKey = `${nextMonthFirst.getFullYear()}-${String(nextMonthFirst.getMonth() + 1).padStart(2, '0')}`;

      let out = `
        <div class="space-y-4">
          <!-- Next Month Availability Priority Banner -->
          <div class="p-3.5 rounded-xl bg-accent/10 border border-accent/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
            <div class="flex items-center gap-3">
              <span class="w-9 h-9 rounded-xl bg-accent/20 text-accent font-bold flex items-center justify-center shrink-0">
                ${ui.icon('calendar', 'w-5 h-5')}
              </span>
              <div>
                <div class="text-xs font-bold text-ink flex items-center gap-2">
                  <span>Next Month Availability · ${nextMonthName}</span>
                  <span class="px-2 py-0.2 rounded-full text-[10px] font-bold bg-accent/20 text-accent border border-accent/30">Priority</span>
                </div>
                <div class="text-[11px] text-muted mt-0.5">
                  Managers are scheduling shifts for next month. Set your availability in 1 click so you can be booked.
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button id="btn-avail-add-next-month" class="btn btn-primary text-xs font-semibold shadow-xs flex items-center gap-1.5 whitespace-nowrap">
                ${ui.icon('plus', 'w-3.5 h-3.5')}
                <span>+ Add Availability (${nextMonthName})</span>
              </button>
              <button id="btn-jump-next-month" class="btn btn-ghost text-xs whitespace-nowrap">
                View ${nextMonthName} Calendar →
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
                <div class="text-xs font-bold text-ink flex items-center gap-2">
                  <span>${ui.esc(targetName)}</span>
                  ${targetUser && targetUser.position ? `<span class="px-2 py-0.2 rounded bg-panel2 text-[10px] text-muted border border-line">${ui.esc(targetUser.position)}</span>` : ''}
                </div>
                <div class="text-[11px] text-muted mt-0.5">
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
                  <span>Interactive Availability Calendar</span>
                  <span class="text-[11px] text-muted hidden sm:inline">(Click any date to set or update)</span>
                </div>
                <div class="flex items-center gap-2.5 text-[11px] flex-wrap">
                  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-emerald-400"></span> Available</span>
                  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-rose-400"></span> Unavailable</span>
                  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-amber-400"></span> Booked</span>
                </div>
              </div>

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
            out += `<div class="p-1 sm:p-2 min-h-[52px] sm:min-h-[72px] rounded-lg bg-panel2/20 border border-transparent opacity-30"></div>`;
          }

          // Actual month days
          const todayStr = formatDate(new Date());
          for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
            const avail = userAvails.find((a) => a.date === dateStr);
            const dayBookings = userBookings.filter((b) => b.date === dateStr);
            const isToday = dateStr === todayStr;

            let statusBorder = 'border-line';
            let statusBg = 'bg-panel2/40';

            if (dayBookings.length > 0) {
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
              <div data-cell-date="${dateStr}" class="p-1 sm:p-1.5 min-h-[54px] sm:min-h-[76px] rounded-lg border ${statusBorder} ${statusBg} ${isToday ? 'ring-1 ring-accent' : ''} hover:border-accent cursor-pointer transition flex flex-col justify-between">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-mono font-bold ${isToday ? 'text-accent' : 'text-ink'}">${dayNum}</span>
              ${avail ? `
                <span class="w-1.5 h-1.5 rounded-full ${avail.type === 'available' ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
              ` : ''}
            </div>

            <!-- Avail Tag -->
            <div class="space-y-1">
              ${avail ? `
                <div class="text-[10px] leading-tight px-1 py-0.5 rounded font-medium truncate ${avail.type === 'available' ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'}">
                  ${avail.type === 'available' ? (avail.dayPart === 'custom' ? `${avail.startTime || ''}-${avail.finishTime || ''}` : (avail.dayPart || 'All Day')) : 'Unavailable'}
                </div>
              ` : ''}

              <!-- Bookings Tag -->
              ${dayBookings.map((b) => `
                <div class="text-[9px] leading-tight px-1 py-0.5 rounded font-semibold truncate bg-amber-500/15 text-amber-400 border border-amber-500/30">
                  ${ui.esc(b.space || 'Shift')}: ${b.status}
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      out += `
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
                  ${b.swapRequested ? `
                    <span class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">Cover Offered</span>
                    <button data-cancel-my-swap="${b.id}" class="text-[10px] text-danger font-semibold hover:underline cursor-pointer">Cancel</button>
                  ` : `
                    <button data-offer-my-swap="${b.id}" class="px-2 py-0.5 rounded text-[10px] font-semibold bg-panel border border-line text-muted hover:text-amber-400 hover:border-amber-500/40 transition cursor-pointer flex items-center gap-1">
                      ${ui.icon('refresh', 'w-3 h-3')}
                      <span>Offer Swap</span>
                    </button>
                  `}
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
      wireMyAvailEvents(nextMonthKey);
    }

    function wireMyAvailEvents(nextMonthKey) {
      // Banner buttons
      tabContainer.querySelector('#btn-avail-add-next-month')?.addEventListener('click', () => {
        openBulkPeriodModal();
      });
      tabContainer.querySelector('#btn-jump-next-month')?.addEventListener('click', () => {
        if (nextMonthKey) {
          state.availMonth = nextMonthKey;
          renderMyAvailTab();
        }
      });

      tabContainer.querySelector('#avail-user-select')?.addEventListener('change', (e) => {
        state.selectedUserForAvail = e.target.value;
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

      tabContainer.querySelectorAll('[data-cell-date]').forEach((cell) => {
        cell.addEventListener('click', () => {
          const d = cell.getAttribute('data-cell-date');
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
            store.upsert('bookings', b);
            ui.toast('Shift accepted and confirmed', 'ok');
            renderMyAvailTab();
          }
        });
      });

      tabContainer.querySelectorAll('[data-tech-decline]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-tech-decline');
          const b = store.find('bookings', id);
          if (b) {
            b.status = 'declined';
            store.upsert('bookings', b);
            ui.toast('Shift declined', 'info');
            renderMyAvailTab();
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

      const allUsers = getAllUsers();

      let out = `
        <div class="space-y-4">
          <div class="flex items-center justify-between pb-2 border-b border-line flex-wrap gap-2">
            <div>
              <h2 class="text-sm font-bold text-ink">Two-Week Team Availability & Rota Matrix</h2>
              <p class="text-xs text-muted">Bird's eye view of freelancer and core duty technician availability across Rich Mix</p>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <button id="matrix-week-prev" class="btn btn-ghost !p-1.5" title="Previous Week">
                ${ui.icon('chevL', 'w-4 h-4')}
              </button>
              <button id="matrix-week-today" class="btn btn-ghost text-xs ${state.weekOffset === 0 ? 'bg-panel2 font-bold text-accent' : ''}">This Week</button>
              <button id="matrix-week-next" class="btn btn-ghost !p-1.5" title="Next Week">
                ${ui.icon('chevR', 'w-4 h-4')}
              </button>
              <span class="text-xs font-mono font-bold text-ink px-1.5 whitespace-nowrap">
                ${days[0].dayNum} ${days[0].monthName} – ${days[13].dayNum} ${days[13].monthName}
              </span>
            </div>
          </div>

          <div class="overflow-x-auto border border-line rounded-xl bg-panel shadow-sm">
            <table class="w-full text-xs text-left border-collapse">
              <thead>
                <tr class="bg-panel2/60 border-b border-line text-[11px] font-semibold text-muted">
                  <th class="p-3 sticky left-0 bg-panel2 z-10 w-48 min-w-[180px]">Technician</th>
                  ${days.map((d) => `
                    <th class="p-2 text-center min-w-[70px] border-l border-line/50 ${d.isToday ? 'bg-accent/10 text-accent font-bold' : ''}">
                      <div class="uppercase tracking-wider text-[10px]">${d.dayName}</div>
                      <div class="font-mono text-ink ${d.isToday ? 'text-accent' : ''}">${d.dayNum} ${d.monthName}</div>
                    </th>
                  `).join('')}
                </tr>
              </thead>
              <tbody class="divide-y divide-line/60">
      `;

      allUsers.forEach((u) => {
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

          let cellContent = '<span class="text-muted/40 text-[10px]">—</span>';
          let cellCls = '';

          if (bookings.length > 0) {
            const b = bookings[0];
            cellContent = `
              <div class="px-1 py-0.5 rounded text-[10px] font-semibold truncate bg-amber-500/15 text-amber-400 border border-amber-500/30" title="Booked: ${ui.esc(b.eventName || b.space)} (${b.status})">
                ${ui.esc(b.space || 'Shift')}
              </div>
            `;
            cellCls = 'bg-amber-400/5';
          } else if (avail) {
            if (avail.type === 'available') {
              const label = avail.dayPart === 'custom' ? `${avail.startTime || ''}` : (avail.dayPart || 'All');
              cellContent = `
                <div class="px-1 py-0.5 rounded text-[10px] font-medium truncate bg-emerald-500/15 text-emerald-400 border border-emerald-500/25" title="Available: ${avail.dayPart} (${avail.notes || ''})">
                  ${label}
                </div>
              `;
              cellCls = 'bg-emerald-500/5';
            } else {
              cellContent = `
                <div class="px-1 py-0.5 rounded text-[10px] font-medium truncate bg-rose-500/15 text-rose-400 border border-rose-500/25" title="Unavailable: ${avail.notes || ''}">
                  No
                </div>
              `;
              cellCls = 'bg-rose-500/5';
            }
          }

          out += `
            <td data-matrix-cell="${u.id}_${d.date}" class="p-1.5 text-center border-l border-line/40 cursor-pointer hover:bg-panel2 ${cellCls}">
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

      tabContainer.querySelectorAll('[data-matrix-cell]').forEach((td) => {
        td.addEventListener('click', () => {
          const [userId, dateStr] = td.getAttribute('data-matrix-cell').split('_');
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
    // TAB 4: ALL SHIFT BOOKINGS LIST
    // ------------------------------------------------------------------------
    function renderListTab() {
      const allUsers = getAllUsers();
      let bookings = getAllBookings().slice().sort((a, b) => (a.date < b.date ? 1 : -1));

      if (state.spaceFilter) bookings = bookings.filter((b) => b.space === state.spaceFilter);
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
                <option value="">All Spaces</option>
                ${RMTP.SPACES.map((s) => `<option value="${ui.esc(s)}" ${state.spaceFilter === s ? 'selected' : ''}>${ui.esc(s)}</option>`).join('')}
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
      const openSwaps = allB.filter((b) => b.swapRequested && b.status !== 'cancelled');
      const myId = me ? me.id : '';

      state.swapFilter = state.swapFilter || 'all'; // 'all' | 'available' | 'my'

      let filteredSwaps = openSwaps;
      if (state.swapFilter === 'available') {
        filteredSwaps = openSwaps.filter((b) => b.userId !== myId && b.swapOfferedBy !== myId);
      } else if (state.swapFilter === 'my') {
        filteredSwaps = openSwaps.filter((b) => b.userId === myId || b.swapOfferedBy === myId);
      }

      // Sort by date ascending
      filteredSwaps.sort((a, b) => (a.date > b.date ? 1 : -1));

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
                Available to Pick Up (${openSwaps.filter((b) => b.userId !== myId).length})
              </button>
              <button data-swap-flt="my" class="px-2.5 py-1 font-semibold rounded-md transition ${state.swapFilter === 'my' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink'}">
                My Swap Offers (${openSwaps.filter((b) => b.userId === myId).length})
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
        const myShifts = getAllBookings().filter((b) => b.userId === (me ? me.id : 'user-3') && b.status !== 'cancelled' && !b.swapRequested);
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
      const events = getAllEvents();
      const allUsers = getAllUsers();

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
                    ${ui.esc(e.name)} · ${ui.esc(e.space)} (${e.date})
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
                  ${RMTP.SPACES.map((s) => `
                    <option value="${ui.esc(s)}" ${s === initialData.space ? 'selected' : ''}>${ui.esc(s)}</option>
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
                <input type="date" id="b-date" class="field" value="${initialData.date || formatDate(new Date())}" />
              </div>
              <div>
                <label class="block font-semibold text-muted mb-1">Start Time</label>
                <input type="time" id="b-start" class="field font-mono" value="${initialData.startTime || '17:00'}" />
              </div>
              <div>
                <label class="block font-semibold text-muted mb-1">Finish Time</label>
                <input type="time" id="b-end" class="field font-mono" value="${initialData.finishTime || '23:30'}" />
              </div>
            </div>

            <!-- Shift Duration & Split Shift Actions -->
            <div class="flex items-center justify-between p-2.5 rounded-lg bg-panel2/70 border border-line flex-wrap gap-2 shadow-2xs">
              <div class="flex items-center gap-2">
                <span class="text-xs text-muted font-medium">Shift Duration:</span>
                <span id="b-shift-duration-badge" class="font-mono font-bold text-accent px-2 py-0.5 rounded bg-panel border border-line text-xs">
                  ${RMTP.getShiftDurationHours ? RMTP.getShiftDurationHours(initialData.startTime || '17:00', initialData.finishTime || '23:30') : 6.5}h
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

            <!-- Technician Picker with LIVE AVAILABILITY STATUS -->
            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="font-semibold text-muted">Technician / Freelancer</label>
                <span id="b-avail-status-tag" class="text-[11px] font-semibold px-2 py-0.5 rounded border">Live Availability</span>
              </div>
              <select id="b-user" class="field font-medium">
                <option value="">Select a technician / freelancer…</option>
                <optgroup label="Registered Technicians &amp; Freelancers">
                  ${allUsers.map((u) => `
                    <option value="${u.id}" ${u.id === initialData.userId ? 'selected' : ''}>
                      ${ui.esc(auth.displayName(u))} (${ui.esc(u.position || 'Tech')})
                    </option>
                  `).join('')}
                <option value="__custom__" ${(!initialData.userId && initialData.userName && initialData.userName !== 'Unassigned' && !initialData.isNoTech) ? 'selected' : ''}>+ Other / External Freelancer (Type Name)</option>
                <option value="__notech__" ${initialData.isNoTech ? 'selected' : ''}>No Tech Needed (Self-Service)</option>
              </select>
              <label class="flex items-center gap-2 cursor-pointer mt-2 text-xs text-muted hover:text-ink">
                <input type="checkbox" id="b-is-notech" class="rounded border-line" ${initialData.isNoTech ? 'checked' : ''} />
                <span>Mark as Self-Service (No Tech Needed)</span>
              </label>
              <div id="b-custom-wrap" class="${(!initialData.userId && initialData.userName && initialData.userName !== 'Unassigned' && !initialData.isNoTech) ? 'block' : 'hidden'} mt-2">
                <label class="block font-semibold text-muted mb-1">Freelancer Full Name</label>
                <input id="b-custom-name" class="field" value="${ui.esc(initialData.userName && initialData.userName !== 'Unassigned' && !initialData.isNoTech ? initialData.userName : '')}" placeholder="e.g. Alex Morgan (Freelance Sound)" />
              </div>
              <p id="b-avail-details-text" class="text-[11px] text-muted mt-1 italic"></p>
            </div>

            <!-- Role & Booking Status -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold text-muted mb-1">Shift Role</label>
                <select id="b-role" class="field">
                  ${RMTP.SHIFT_ROLES.map((r) => `
                    <option value="${r}" ${r === initialData.role ? 'selected' : ''}>${r}</option>
                  `).join('')}
                </select>
              </div>
              <div>
                <label class="block font-semibold text-muted mb-1">Booking Lifecycle Status</label>
                <select id="b-status" class="field font-semibold">
                  <option value="pencil" ${initialData.status === 'pencil' ? 'selected' : ''}>Pencil (Provisional Hold)</option>
                  <option value="confirmed" ${initialData.status === 'confirmed' ? 'selected' : ''}>Confirmed (Firm Booking)</option>
                  <option value="declined" ${initialData.status === 'declined' ? 'selected' : ''}>Declined (Tech Unavailable)</option>
                  ${isTechManager ? `<option value="cancelled" ${initialData.status === 'cancelled' ? 'selected' : ''}>Cancelled (Venue)</option>` : ''}
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
      const customWrap = m.root.querySelector('#b-custom-wrap');
      const customNameInp = m.root.querySelector('#b-custom-name');

      function updateAvailabilityCheck() {
        const uid = userSel.value;
        const dStr = dateInp.value;
        const noTechCheck = m.root.querySelector('#b-is-notech');
        const isNoTechActive = (noTechCheck && noTechCheck.checked) || uid === '__notech__';

        if (isNoTechActive) {
          if (customWrap) customWrap.classList.add('hidden');
          tagEl.className = 'text-[11px] font-semibold px-2 py-0.5 rounded bg-panel2 border border-line text-emerald-400';
          tagEl.textContent = 'Self-Service · No Tech';
          detailsEl.textContent = 'No technical crew required. Crew shortfall alerts will be suppressed.';
          detailsEl.className = 'text-[11px] text-muted mt-1 italic';
          const roleSel = m.root.querySelector('#b-role');
          if (roleSel) {
            let opt = Array.from(roleSel.options).find(o => o.value === 'None');
            if (!opt) {
              opt = document.createElement('option');
              opt.value = 'None';
              opt.textContent = 'None';
              roleSel.appendChild(opt);
            }
            roleSel.value = 'None';
          }
          return;
        }

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
      dateInp.addEventListener('change', updateAvailabilityCheck);

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
            const roleSel = m.root.querySelector('#b-role');
            if (roleSel) {
              let opt = Array.from(roleSel.options).find(o => o.value.toLowerCase() === r.toLowerCase());
              if (!opt) {
                const newOpt = document.createElement('option');
                newOpt.value = r;
                newOpt.textContent = r;
                roleSel.appendChild(newOpt);
                opt = newOpt;
              }
              roleSel.value = opt.value;
              ui.toast(`Selected discipline: ${r}`, 'info');
            }
          });
        });
      }

      spaceSel.addEventListener('change', () => {
        updateSpaceSpecsBanner();
        const specs = RMTP.getSpaceCrewSpecs ? RMTP.getSpaceCrewSpecs(spaceSel.value) : null;
        if (specs && specs.rolesList && specs.rolesList.length) {
          const roleSel = m.root.querySelector('#b-role');
          if (roleSel && (!initialData.role || !specs.rolesList.includes(roleSel.value))) {
            roleSel.value = specs.rolesList[0];
          }
        }
      });
      updateSpaceSpecsBanner();

      // If linking advancing event, auto-fill event name, space, date
      eventSel.addEventListener('change', () => {
        const evId = eventSel.value;
        if (evId) {
          const ev = store.find('advancing', evId);
          if (ev) {
            eventNameInp.value = ev.name;
            spaceSel.value = Array.isArray(ev.space) ? ev.space[0] : ev.space;
            dateInp.value = ev.date;
            if (ev.startTime) m.root.querySelector('#b-start').value = ev.startTime;
            if (ev.finishTime) m.root.querySelector('#b-end').value = ev.finishTime;
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
        const bookingDate = dateInp.value;
        const noTechCheck = m.root.querySelector('#b-is-notech');
        const isNoTechChecked = (noTechCheck && noTechCheck.checked) || userId === '__notech__';

        if (!bookingDate) {
          ui.toast('Date is required', 'danger');
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
          finalUserName = techObj ? auth.displayName(techObj) : '';
          isFreelancerFlag = techObj ? (techObj.position === 'Freelancer') : false;
        } else {
          finalUserId = '';
          finalUserName = initialData.userName || 'Unassigned';
          isFreelancerFlag = false;
        }

        const record = {
          id: initialData.id || store.uid('book'),
          eventId: eventSel.value || '',
          eventName: eventNameInp.value.trim() || 'Venue Shift',
          space: spaceSel.value,
          date: bookingDate,
          startTime: m.root.querySelector('#b-start').value || '17:00',
          finishTime: m.root.querySelector('#b-end').value || '23:30',
          userId: isNoTechChecked ? '' : finalUserId,
          userName: isNoTechChecked ? 'No Tech Required' : finalUserName,
          isFreelancer: isFreelancerFlag,
          isNoTech: isNoTechChecked,
          role: isNoTechChecked ? 'None' : (m.root.querySelector('#b-role').value || 'Sound'),
          status: isNoTechChecked ? 'confirmed' : (m.root.querySelector('#b-status').value || 'pencil'),
          rate: m.root.querySelector('#b-rate').value.trim(),
          notes: m.root.querySelector('#b-notes').value.trim(),
          updatedAt: new Date().toISOString(),
        };

        if (record.status === 'confirmed' && !record.confirmedAt) {
          record.confirmedAt = new Date().toISOString();
        } else if (record.status === 'pencil' && !record.penciledAt) {
          record.penciledAt = new Date().toISOString();
        }

        store.upsert('bookings', record);

        // If linked to advancing event, ensure advancing record's technicians array is also updated!
        if (record.eventId) {
          const advEv = store.find('advancing', record.eventId);
          if (advEv) {
            if (isNoTechChecked) {
              advEv.noTechNeeded = true;
            }
            advEv.technicians = advEv.technicians || [];
            if (record.userId) {
              const existingTech = advEv.technicians.find((t) => t.userId === record.userId);
              if (existingTech) {
                existingTech.role = record.role;
                existingTech.startTime = record.startTime;
                existingTech.finishTime = record.finishTime;
                existingTech.bookingStatus = record.status;
                existingTech.isFreelancer = record.isFreelancer;
              } else {
                advEv.technicians.push({
                  userId: record.userId,
                  role: record.role,
                  startTime: record.startTime,
                  finishTime: record.finishTime,
                  bookingStatus: record.status,
                  isFreelancer: record.isFreelancer,
                });
              }
            } else if (record.userName && record.userName !== 'Unassigned') {
              const existingTech = advEv.technicians.find((t) => t.isFreelancer && t.freelancerName === record.userName);
              if (existingTech) {
                existingTech.role = record.role;
                existingTech.startTime = record.startTime;
                existingTech.finishTime = record.finishTime;
                existingTech.bookingStatus = record.status;
              } else {
                advEv.technicians.push({
                  isFreelancer: true,
                  freelancerName: record.userName,
                  role: record.role,
                  startTime: record.startTime,
                  finishTime: record.finishTime,
                  bookingStatus: record.status,
                });
              }
            }
            store.upsert('advancing', advEv);
          }
        }

        ui.toast('Shift booking saved', 'ok');
        m.close();
        renderActiveTab();
      });

      // Delete
      const delBtn = m.root.querySelector('#b-delete');
      if (delBtn) {
        delBtn.addEventListener('click', () => {
          if (confirm('Delete this shift booking record?')) {
            store.remove('bookings', initialData.id);
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
      const space = initialShift.space || (linkedEvent && linkedEvent.space ? (Array.isArray(linkedEvent.space) ? linkedEvent.space[0] : linkedEvent.space) : 'The Stage');
      const eventName = initialShift.eventName || (linkedEvent ? linkedEvent.name : 'Shift');
      const date = initialShift.date || (linkedEvent ? linkedEvent.date : (state.selectedDay || formatDate(new Date())));
      const origStart = initialShift.startTime || (linkedEvent ? linkedEvent.startTime : '10:00') || '10:00';
      const origEnd = initialShift.finishTime || (linkedEvent ? linkedEvent.finishTime : '22:00') || '22:00';
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

        // Keep linked advancing event updated in store
        if (initialShift.eventId) {
          const advEv = store.find('advancing', initialShift.eventId);
          if (advEv) {
            advEv.technicians = advEv.technicians || [];
            const leg1Tech = {
              userId: u1Id,
              freelancerName: isFreelancer1 ? u1Name : '',
              isFreelancer: isFreelancer1,
              role: leg1Role,
              startTime: leg1Start,
              finishTime: leg1End,
              bookingStatus: leg1Status,
              splitFromId: splitGroupId,
              legIndex: 1,
              notes: leg1Notes,
            };
            const leg2Tech = {
              userId: u2Id,
              freelancerName: isFreelancer2 ? u2Name : '',
              isFreelancer: isFreelancer2,
              role: leg2Role,
              startTime: leg2Start,
              finishTime: leg2End,
              bookingStatus: leg2Status,
              splitFromId: splitGroupId,
              legIndex: 2,
              notes: leg2Notes,
            };

            const matchIdx = advEv.technicians.findIndex((t) => (t.userId && t.userId === initialShift.userId) || (t.role === role));
            if (matchIdx > -1) {
              advEv.technicians.splice(matchIdx, 1, leg1Tech, leg2Tech);
            } else {
              advEv.technicians.push(leg1Tech, leg2Tech);
            }
            store.upsert('advancing', advEv);
          }
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
        const prevName = booking.swapOfferedByName || booking.userName || 'Colleague';
        const myName = me ? auth.displayName(me) : 'You';
        booking.userId = me ? me.id : 'user-3';
        booking.userName = myName;
        booking.swapRequested = false;
        booking.swapClaimedBy = me ? me.id : 'user-3';
        booking.swapClaimedByName = myName;
        booking.swapClaimedAt = new Date().toISOString();
        booking.status = 'confirmed';
        booking.notes = (booking.notes ? booking.notes + ' | ' : '') + `Cover taken over by ${myName} (swapped from ${prevName})`;
        store.upsert('bookings', booking);
        ui.toast('Shift claimed successfully! It is now on your personal schedule.', 'ok');
        m.close();
        renderActiveTab();
      });
    }

    function openShiftDetailModal(booking) {
      if (!booking) return;
      const isMine = me && booking.userId === me.id;
      const isSwap = !!booking.swapRequested;
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
              ${isMine && !isSwap ? `
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
      const dObj = parseDate(dateStr);
      const formattedDate = dObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const dayItems = getDaySchedule(dateStr);
      const allB = getAllBookings().filter((b) => b.date === dateStr && b.status !== 'cancelled');
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
                  const isSwap = !!b.swapRequested;
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
                          ${isMine && !isSwap ? `
                            <button type="button" class="btn btn-ghost text-[10px] text-accent !py-0.5 !px-2 font-semibold" data-day-swap="${b.id}">Offer Swap</button>
                          ` : ''}
                          ${isMine && isSwap ? `
                            <button type="button" class="btn btn-ghost text-[10px] text-danger !py-0.5 !px-2 font-semibold" data-day-cancel-swap="${b.id}">Cancel Swap</button>
                          ` : ''}
                          ${!isMine && isSwap ? `
                            <button type="button" class="btn btn-primary text-[10px] !py-0.5 !px-2 font-semibold" data-day-claim="${b.id}">Claim Cover</button>
                          ` : ''}
                          ${(isTechManager || isAdmin) && b.id ? `
                            <button type="button" class="btn btn-ghost text-[10px] !py-0.5 !px-2" data-day-edit="${b.id}">Edit</button>
                          ` : ''}
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
            openBookingModal({
              eventId: item.eventId,
              eventName: item.eventName,
              space: item.space,
              date: item.date,
              startTime: item.startTime,
              finishTime: item.finishTime,
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
          openBookingModal(b);
        });
      });
      m.root.querySelector('#day-add-shift-btn')?.addEventListener('click', () => {
        m.close();
        openBookingModal({ date: dateStr, startTime: '17:00', finishTime: '23:30', status: 'pencil' });
      });
    }

    // 2. Technician Availability Modal (Single Date)
    function openAvailabilityModal(data = {}) {
      const allUsers = getAllUsers();
      const isNew = !data.id;
      const targetUserId = data.userId || (me ? me.id : 'user-3');
      const targetUser = allUsers.find((u) => u.id === targetUserId);
      const targetName = targetUser ? auth.displayName(targetUser) : 'Technician';

      let currentDayPart = data.dayPart || 'all_day';
      let currentType = data.type || 'available';

      const m = ui.modal({
        title: `Set Availability · ${ui.esc(targetName)}`,
        body: `
          <div class="space-y-4 text-xs">
            <div>
              <label class="block font-semibold text-muted mb-1">Date</label>
              <input type="date" id="av-date" class="field font-mono" value="${data.date || formatDate(new Date())}" />
            </div>

            <!-- Status Choice: Available vs Unavailable -->
            <div>
              <label class="block font-semibold text-muted mb-1.5">Availability Status</label>
              <div class="grid grid-cols-2 gap-2">
                <button type="button" id="av-btn-avail" class="p-2.5 rounded-lg border font-semibold flex items-center justify-center gap-1.5 transition ${currentType === 'available' ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400' : 'bg-panel border-line text-muted'}">
                  ${ui.icon('check', 'w-4 h-4')}
                  <span>Available for Work</span>
                </button>
                <button type="button" id="av-btn-unavail" class="p-2.5 rounded-lg border font-semibold flex items-center justify-center gap-1.5 transition ${currentType === 'unavailable' ? 'bg-rose-500/15 border-rose-500/40 text-rose-400' : 'bg-panel border-line text-muted'}">
                  ${ui.icon('x', 'w-4 h-4')}
                  <span>Unavailable</span>
                </button>
              </div>
            </div>

            <!-- Day-Part Blocks (visible when available) -->
            <div id="av-daypart-area" class="${currentType === 'available' ? 'block' : 'hidden'} space-y-2">
              <label class="block font-semibold text-muted mb-1">Day-Part Block</label>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                ${RMTP.DAY_PARTS.map((dp) => `
                  <button type="button" data-dp="${dp.id}" class="p-2 rounded-lg border text-center transition font-medium ${currentDayPart === dp.id ? 'bg-accent text-accent-ink border-accent font-semibold' : 'bg-panel border-line text-ink hover:border-line/80'}">
                    <div class="text-xs">${dp.label}</div>
                    ${dp.start ? `<div class="text-[10px] opacity-70 font-mono">${dp.start}–${dp.end}</div>` : ''}
                  </button>
                `).join('')}
              </div>

              <!-- Custom Hours Expandable -->
              <div id="av-custom-hours" class="${currentDayPart === 'custom' ? 'block' : 'hidden'} p-3 rounded-lg bg-panel2/60 border border-line space-y-2 mt-2">
                <div class="font-semibold text-ink text-[11px]">Exact From / Till Timing</div>
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="block text-[10px] text-muted mb-1">From (Start)</label>
                    <input type="time" id="av-start" class="field font-mono" value="${data.startTime || '16:30'}" />
                  </div>
                  <div>
                    <label class="block text-[10px] text-muted mb-1">Till (Finish)</label>
                    <input type="time" id="av-end" class="field font-mono" value="${data.finishTime || '23:30'}" />
                  </div>
                </div>
              </div>
            </div>

            <!-- Notes -->
            <div>
              <label class="block font-semibold text-muted mb-1">Optional Notes</label>
              <input id="av-notes" class="field" value="${ui.esc(data.notes || '')}" placeholder="e.g. Free for sound or lighting, has car, traveling after 23:00" />
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

      const daypartArea = m.root.querySelector('#av-daypart-area');
      const customHours = m.root.querySelector('#av-custom-hours');

      m.root.querySelector('#av-btn-avail').addEventListener('click', () => {
        currentType = 'available';
        m.root.querySelector('#av-btn-avail').className = 'p-2.5 rounded-lg border font-semibold flex items-center justify-center gap-1.5 transition bg-emerald-500/15 border-emerald-500/40 text-emerald-400';
        m.root.querySelector('#av-btn-unavail').className = 'p-2.5 rounded-lg border font-semibold flex items-center justify-center gap-1.5 transition bg-panel border-line text-muted';
        daypartArea.classList.remove('hidden');
      });

      m.root.querySelector('#av-btn-unavail').addEventListener('click', () => {
        currentType = 'unavailable';
        m.root.querySelector('#av-btn-avail').className = 'p-2.5 rounded-lg border font-semibold flex items-center justify-center gap-1.5 transition bg-panel border-line text-muted';
        m.root.querySelector('#av-btn-unavail').className = 'p-2.5 rounded-lg border font-semibold flex items-center justify-center gap-1.5 transition bg-rose-500/15 border-rose-500/40 text-rose-400';
        daypartArea.classList.add('hidden');
      });

      m.root.querySelectorAll('[data-dp]').forEach((btn) => {
        btn.addEventListener('click', () => {
          currentDayPart = btn.getAttribute('data-dp');
          m.root.querySelectorAll('[data-dp]').forEach((b) => {
            b.className = 'p-2 rounded-lg border text-center transition font-medium bg-panel border-line text-ink hover:border-line/80';
          });
          btn.className = 'p-2 rounded-lg border text-center transition font-medium bg-accent text-accent-ink border-accent font-semibold';
          if (currentDayPart === 'custom') {
            customHours.classList.remove('hidden');
          } else {
            customHours.classList.add('hidden');
          }
        });
      });

      // Save
      m.root.querySelector('#av-save').addEventListener('click', () => {
        const dStr = m.root.querySelector('#av-date').value;
        if (!dStr) { ui.toast('Date is required', 'danger'); return; }

        let startTime = '08:00';
        let finishTime = '23:30';

        if (currentDayPart === 'morning') { startTime = '08:00'; finishTime = '13:00'; }
        else if (currentDayPart === 'afternoon') { startTime = '13:00'; finishTime = '18:00'; }
        else if (currentDayPart === 'evening') { startTime = '18:00'; finishTime = '23:30'; }
        else if (currentDayPart === 'custom') {
          startTime = m.root.querySelector('#av-start').value || '16:30';
          finishTime = m.root.querySelector('#av-end').value || '23:30';
        }

        const record = {
          id: data.id || store.uid('avail'),
          userId: targetUserId,
          userName: targetName,
          date: dStr,
          type: currentType,
          dayPart: currentType === 'available' ? currentDayPart : 'all_day',
          startTime: currentType === 'available' ? startTime : '',
          finishTime: currentType === 'available' ? finishTime : '',
          notes: m.root.querySelector('#av-notes').value.trim(),
          updatedAt: new Date().toISOString(),
        };

        store.upsert('availability', record);
        ui.toast('Availability updated', 'ok');
        m.close();
        renderActiveTab();
      });

      // Delete
      const delBtn = m.root.querySelector('#av-delete');
      if (delBtn) {
        delBtn.addEventListener('click', () => {
          store.remove('availability', data.id);
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
                  <option value="all_day">All Day (08:00 - 23:30)</option>
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
        let count = 0;
        const allAvail = getAllAvailability();

        while (cur <= eDate) {
          const dow = cur.getDay(); // 0 = Sun
          if (checkedDows.has(dow)) {
            const dateStr = formatDate(cur);
            const existing = allAvail.find((a) => a.userId === targetUserId && a.date === dateStr);
            const rec = {
              id: existing ? existing.id : store.uid('avail'),
              userId: targetUserId,
              userName: targetName,
              date: dateStr,
              type: type,
              dayPart: type === 'available' ? dayPart : 'all_day',
              startTime: type === 'available' ? sTime : '',
              finishTime: type === 'available' ? fTime : '',
              notes: notes,
              updatedAt: new Date().toISOString(),
            };
            store.upsert('availability', rec);
            count++;
          }
          cur.setDate(cur.getDate() + 1);
        }

        ui.toast(`Applied availability to ${count} dates`, 'ok');
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
        booking.cancellationReason = reason;
        store.upsert('bookings', booking);

        ui.toast('Shift cancelled', 'ok');
        m.close();
        renderActiveTab();
      });
    }

    // Wire Top Buttons
    el.querySelector('#btn-submit-avail')?.addEventListener('click', () => {
      openAvailabilityModal();
    });

    el.querySelector('#btn-bulk-avail')?.addEventListener('click', () => {
      openBulkPeriodModal();
    });

    el.querySelector('#btn-quick-swap')?.addEventListener('click', () => {
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

    el.querySelector('#btn-add-booking')?.addEventListener('click', () => {
      openBookingModal();
    });

    // Wire Main Navigation Tabs
    el.querySelectorAll('[data-tab]').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        state.tab = tabBtn.getAttribute('data-tab');
        el.querySelectorAll('[data-tab]').forEach((b) => {
          b.className = 'px-3.5 py-2 font-semibold rounded-lg transition-colors flex items-center gap-1.5 text-muted hover:text-ink hover:bg-panel2';
        });
        tabBtn.className = 'px-3.5 py-2 font-semibold rounded-lg transition-colors flex items-center gap-1.5 bg-accent text-accent-ink shadow-xs';
        renderActiveTab();
      });
    });

    // Listen for live venue crew specification updates from Venues and spaces
    const onVenuesUpdated = () => {
      renderActiveTab();
    };
    window.addEventListener('rmtp:venues-updated', onVenuesUpdated);

    // Initial render
    renderActiveTab();
  };
})();
