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

    // View state
    RMTP._rotaState = RMTP._rotaState || {
      tab: 'board', // 'board' | 'my_avail' | 'team_matrix' | 'list'
      weekOffset: 0, // 0 = current week, +1 next week, etc.
      boardView: 'week', // 'week' | 'day' | 'agenda'
      density: 'compact', // 'compact' | 'detailed'
      selectedDay: '',
      mobileDayFilter: 'all',
      unfilledOnly: false,
      spaceFilter: '',
      roleFilter: '',
      statusFilter: '',
      techFilter: '',
      availMonth: new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'),
      selectedUserForAvail: me ? me.id : 'user-3',
    };
    const state = RMTP._rotaState;
    if (state.density === undefined) state.density = 'compact';
    if (state.boardView === undefined) state.boardView = 'week';
    if (!state.selectedDay) state.selectedDay = formatDate(new Date());
    if (state.mobileDayFilter === undefined) state.mobileDayFilter = 'all';
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

        // Compute space breakdown
        const spaceBreakdown = spaces.map((sp) => {
          const basic = getSpaceBasicCrew(sp);
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

          const assignedCount = assignedTechs.length;
          const gap = Math.max(0, basic - assignedCount);
          return {
            space: sp,
            basicCrew: basic,
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

        if (b.eventId) handledEventIds.add(b.eventId);
        const techObj = allUsers.find((u) => u.id === b.userId);
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
          userId: b.userId,
          userName: b.userName || (techObj ? auth.displayName(techObj) : 'Unassigned Tech'),
          role: b.role || 'Tech',
          status: b.status || 'pencil',
          rate: b.rate,
          notes: b.notes,
          isUnfilled: false,
        };
        items.push(item);
        allScheduleItemsMap.set(item.key, item);
      });

      // --- STEP 3: REMAINING ADVANCING EVENTS (SINGLE ROOM) ---
      allEv.forEach((ev) => {
        if (handledEventIds.has(ev.id)) return;
        const spaceVal = Array.isArray(ev.space) ? ev.space[0] : (ev.space || 'Venue');
        if (state.spaceFilter && spaceVal !== state.spaceFilter) return;

        const evTechs = RMTP.eventTechnicians ? RMTP.eventTechnicians(ev) : [];
        if (evTechs && evTechs.length > 0) {
          if (state.unfilledOnly) return;
          evTechs.forEach((t, idx) => {
            if (state.techFilter && t.userId !== state.techFilter) return;
            if (state.roleFilter && t.role !== state.roleFilter) return;
            if (state.statusFilter && (t.bookingStatus || 'confirmed') !== state.statusFilter) return;

            const techObj = allUsers.find((u) => u.id === t.userId);
            const tName = t.freelancerName || (techObj ? auth.displayName(techObj) : (t.userId ? 'Tech' : 'Unassigned'));

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
              userId: t.userId,
              userName: tName,
              role: t.role || 'Tech',
              status: t.bookingStatus || 'confirmed',
              notes: ev.notes || ev.techInfo || (ev.artifaxHistory && ev.artifaxHistory.length ? ev.artifaxHistory[ev.artifaxHistory.length - 1].notes : '') || ev.artifaxNotes || '',
              isUnfilled: false,
            };
            items.push(item);
            allScheduleItemsMap.set(item.key, item);
          });
        } else {
          // Unfilled advancing event
          if (state.roleFilter) return;
          if (state.techFilter) return;
          if (state.statusFilter && state.statusFilter !== 'unfilled') return;

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
            role: 'Tech',
            status: 'unfilled',
            notes: ev.notes || ev.techInfo || (ev.artifaxHistory && ev.artifaxHistory.length ? ev.artifaxHistory[ev.artifaxHistory.length - 1].notes : '') || ev.artifaxNotes || '',
            isUnfilled: true,
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
          const rColor = getSpaceColor(contextSpace);

          return `
            <div data-schedule-item="${item.key}" class="p-2.5 rounded-xl border border-l-[4px] border-l-amber-500 ${roomBreakdown.isFilled ? 'border-line bg-panel2/80' : 'border-amber-500/40 bg-amber-500/5'} transition shadow-2xs hover:border-accent cursor-pointer group select-none flex flex-col justify-between gap-1.5 text-left relative">
              <div class="flex items-center justify-between gap-1 text-[10px]">
                <span class="font-bold px-1.5 py-0.2 rounded border uppercase tracking-wider text-[9px] bg-amber-500/15 text-amber-300 border-amber-500/30">
                  Takeover Room
                </span>
                <span class="font-mono tabular-nums text-muted font-semibold">${item.startTime}–${item.finishTime}</span>
              </div>

              <div>
                <div class="text-xs font-bold text-ink leading-snug break-words group-hover:text-accent transition-colors" title="${ui.esc(item.eventName)}">
                  ${ui.esc(item.eventName)}
                </div>
                <div class="text-[10px] text-muted mt-0.5">
                  Part of multi-room takeover across <span class="font-medium text-ink">${item.spaces.join(', ')}</span>
                </div>
              </div>

              <!-- Room Crew Requirement & Assigned Techs -->
              <div class="pt-1 border-t border-line/40 text-[11px] flex items-center justify-between gap-1">
                <span class="text-muted text-[10px]">Room Crew:</span>
                <span class="font-mono font-bold ${roomBreakdown.isFilled ? 'text-emerald-400' : 'text-amber-400'}">
                  ${roomBreakdown.assignedCount}/${roomBreakdown.basicCrew} Assigned
                </span>
              </div>

              ${roomBreakdown.assignedTechs.length > 0 ? `
                <div class="space-y-1">
                  ${roomBreakdown.assignedTechs.map((t) => `
                    <div class="flex items-center justify-between text-[10px] py-0.5 px-1.5 rounded bg-panel border border-line/60">
                      <span class="font-medium text-ink truncate">${ui.esc(t.name)}</span>
                      <span class="text-[9px] font-mono text-muted uppercase">${ui.esc(t.role)}</span>
                    </div>
                  `).join('')}
                </div>
              ` : ''}

              ${!roomBreakdown.isFilled ? `
                <button type="button" data-assign-space-crew="${item.key}|${ui.esc(contextSpace)}" class="w-full mt-1 px-2 py-1 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border border-amber-500/30 flex items-center justify-center gap-1 transition">
                  ${ui.icon('plus', 'w-3 h-3 text-amber-400')}
                  <span>+ Assign Crew to ${ui.esc(contextSpace)} (${roomBreakdown.gap} gap)</span>
                </button>
              ` : ''}
            </div>
          `;
        }

        // Standard Consolidated Card (Week Board & Agenda)
        return `
          <div data-schedule-item="${item.key}" class="p-2.5 rounded-xl border-2 ${isFull ? 'border-emerald-500/40 bg-panel2/90 hover:border-emerald-400' : 'border-amber-500/50 bg-amber-500/5 hover:border-amber-400'} transition shadow-2xs hover:shadow-md cursor-pointer group select-none flex flex-col justify-between gap-2 text-left relative">
            <!-- Tier 1: Takeover Header & Time -->
            <div class="flex items-center justify-between gap-1 flex-wrap text-[10px]">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="px-2 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1">
                  ${ui.icon('grid', 'w-2.5 h-2.5 text-amber-300')}
                  <span>Takeover · ${item.spaces.length} Spaces</span>
                </span>
                <span class="font-mono tabular-nums text-muted font-semibold">${item.startTime}–${item.finishTime}</span>
              </div>
              <span class="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-semibold border ${isFull ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'}">
                <span class="w-1.5 h-1.5 rounded-full ${isFull ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}"></span>
                <span>${totalAssigned}/${totalNeeded} Crew</span>
              </span>
            </div>

            <!-- Tier 2: Event Name -->
            <div>
              <div class="text-xs font-bold text-ink leading-snug break-words group-hover:text-accent transition-colors" title="${ui.esc(item.eventName)}">
                ${ui.esc(item.eventName)}
              </div>
            </div>

            <!-- Tier 3: Crew Needed vs Assigned Progress Bar / Alert -->
            <div class="p-1.5 rounded-lg bg-panel/85 border border-line/60 space-y-1.5">
              <div class="flex items-center justify-between text-[10px] font-medium">
                <span class="text-muted">Staffing Status:</span>
                ${isFull ? `
                  <span class="text-emerald-400 font-bold flex items-center gap-1">✓ Fully Staffed (${totalAssigned}/${totalNeeded})</span>
                ` : `
                  <span class="text-amber-400 font-bold flex items-center gap-1">
                    <span>${totalAssigned}/${totalNeeded} Assigned</span>
                    <span class="text-rose-400 font-bold">· ${gapsCount} space${gapsCount > 1 ? 's' : ''} need crew</span>
                  </span>
                `}
              </div>

              <!-- Space-by-Space breakdown chips with 1-click crew assignment -->
              <div class="space-y-1 pt-1 border-t border-line/40 text-[10px]">
                ${item.spaceBreakdown.map((sb) => {
                  const spColor = getSpaceColor(sb.space);
                  return `
                    <div class="flex items-center justify-between gap-1 py-0.5 px-1.5 rounded bg-panel2/50 border border-line/40">
                      <div class="flex items-center gap-1.5 min-w-0">
                        <span class="w-1.5 h-1.5 rounded-full ${sb.isFilled ? 'bg-emerald-400' : 'bg-amber-400'} shrink-0"></span>
                        <span class="font-bold text-ink truncate">${ui.esc(sb.space)}</span>
                        <span class="text-[9px] font-mono text-muted font-semibold shrink-0">[${sb.assignedCount}/${sb.basicCrew}]</span>
                      </div>
                      ${sb.isFilled ? `
                        <span class="text-muted text-[10px] truncate max-w-[110px]" title="${ui.esc(sb.assignedTechs.map((t) => t.name).join(', '))}">
                          ${ui.esc(sb.assignedTechs.map((t) => t.name).join(', '))}
                        </span>
                      ` : `
                        <button type="button" data-assign-space-crew="${item.key}|${ui.esc(sb.space)}" class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 flex items-center gap-1 transition shrink-0" title="Assign crew to ${ui.esc(sb.space)}">
                          ${ui.icon('plus', 'w-2.5 h-2.5 text-amber-300')}
                          <span>+ Crew (${sb.gap})</span>
                        </button>
                      `}
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          </div>
        `;
      }

      // ----------------------------------------------------------------------
      // STANDARD SINGLE-ROOM SHIFTS & EVENTS
      // ----------------------------------------------------------------------
      if (isCompact) {
        return `
          <div data-schedule-item="${item.key}" class="p-2 rounded-lg border border-l-[3.5px] ${spaceCls.bar} ${item.isUnfilled ? 'border-amber-500/40 bg-amber-500/5 hover:border-amber-400' : 'border-line bg-panel2/80 hover:bg-panel2 hover:border-line/90'} transition shadow-2xs cursor-pointer group select-none flex flex-col justify-between gap-1 text-left relative">
            <!-- Line 1: Space short tag, Time & Status -->
            <div class="flex items-center justify-between gap-1 text-[10px]">
              <span class="font-bold px-1.5 py-0.2 rounded border uppercase tracking-wider text-[9px] ${spaceCls.tag} shrink-0" title="${ui.esc(item.space)}">
                ${ui.esc(spaceCls.short)}
              </span>
              <div class="flex items-center gap-1.5 shrink-0 ml-auto">
                <span class="font-mono tabular-nums text-muted font-semibold text-[10px]">${item.startTime}–${item.finishTime}</span>
                <span class="w-1.5 h-1.5 rounded-full ${statusMeta.dot} shrink-0" title="${statusMeta.label}"></span>
              </div>
            </div>

            <!-- Line 2: Event Name (unclipped, clean wrapping) -->
            <div class="text-xs font-bold text-ink leading-snug break-words group-hover:text-accent transition-colors" title="${ui.esc(item.eventName)}">
              ${ui.esc(item.eventName)}
            </div>

            <!-- Line 3: Tech & Role or Unfilled Call to Action -->
            ${item.isUnfilled ? `
              <div class="pt-1 border-t border-line/40">
                <button type="button" data-assign-shift="${item.key}" class="w-full px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border border-amber-500/30 flex items-center justify-center gap-1 transition">
                  ${ui.icon('plus', 'w-3 h-3 text-amber-400')}
                  <span>Assign Freelancer</span>
                </button>
              </div>
            ` : `
              <div class="flex items-center justify-between text-[11px] pt-1 border-t border-line/40 gap-1">
                <span class="truncate font-medium text-ink/90 flex items-center gap-1" title="${ui.esc(item.userName)}">
                  <span class="truncate">${ui.esc(item.userName)}</span>
                </span>
                <div class="flex items-center gap-1 shrink-0">
                  ${item.role ? `<span class="text-[9px] font-mono font-semibold px-1 py-0.2 rounded bg-panel border border-line text-muted">${ui.esc(item.role)}</span>` : ''}
                  ${item.type === 'booking' ? `
                    <button type="button" data-quick-toggle-status="${item.id}" class="p-0.5 rounded text-muted hover:text-ink hover:bg-panel transition opacity-0 group-hover:opacity-100" title="Click to toggle Confirmed / Pencil">
                      ${ui.icon(item.status === 'confirmed' ? 'check' : 'pen', 'w-2.5 h-2.5')}
                    </button>
                  ` : ''}
                </div>
              </div>
            `}
          </div>
        `;
      }

      // Detailed Mode
      const initialLetter = ((item.userName || 'Tech')[0] || 'T').toUpperCase();
      return `
        <div data-schedule-item="${item.key}" class="p-2.5 rounded-xl border border-l-[4px] ${spaceCls.bar} ${item.isUnfilled ? 'border-amber-500/40 bg-amber-500/5 hover:border-amber-400' : 'border-line bg-panel2/80 hover:bg-panel2 hover:border-line/90'} transition shadow-2xs cursor-pointer group select-none space-y-2 text-left relative">
          <div class="flex items-start justify-between gap-1.5">
            <div class="min-w-0">
              <span class="font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider text-[9px] ${spaceCls.tag} inline-block mb-1">${ui.esc(item.space)}</span>
              <div class="text-xs font-bold text-ink leading-snug break-words group-hover:text-accent transition-colors" title="${ui.esc(item.eventName)}">${ui.esc(item.eventName)}</div>
            </div>
            <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${item.isUnfilled ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : 'border-line bg-panel text-ink'} shrink-0">
              <span class="w-1.5 h-1.5 rounded-full ${statusMeta.dot}"></span>
              <span>${statusMeta.label}</span>
            </span>
          </div>

          <div class="flex items-center justify-between text-[11px] text-muted pt-1 border-t border-line/40">
            <span class="font-mono tabular-nums text-ink font-semibold">${item.startTime} – ${item.finishTime}</span>
            ${item.role ? `<span class="px-1.5 py-0.2 rounded bg-panel text-[10px] font-semibold border border-line text-ink">${ui.esc(item.role)}</span>` : ''}
          </div>

          <div class="flex items-center justify-between gap-2 text-xs pt-1">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="w-5 h-5 rounded-full bg-accent/20 text-accent text-[10px] font-bold flex items-center justify-center shrink-0">
                ${initialLetter}
              </span>
              <span class="text-xs font-medium text-ink truncate ${item.isUnfilled ? 'text-amber-400 font-semibold' : ''}">
                ${item.isUnfilled ? '+ Assign Freelancer' : ui.esc(item.userName)}
              </span>
            </div>
            ${item.rate ? `<span class="text-[10px] font-mono text-muted tabular-nums">${ui.esc(item.rate)}</span>` : ''}
          </div>

          ${item.notes ? `
            <div class="text-[10px] text-muted italic bg-panel px-2 py-1 rounded border border-line/60 break-words">
              ${ui.esc(item.notes)}
            </div>
          ` : ''}

          ${item.isUnfilled ? `
            <div class="pt-1">
              <button type="button" data-assign-shift="${item.key}" class="w-full py-1 px-2 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border border-amber-500/30 flex items-center justify-center gap-1 transition">
                ${ui.icon('plus', 'w-3.5 h-3.5')}
                <span>Assign Freelancer to Shift</span>
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
      const unfilledEvents = weekEvents.filter((e) => {
        const assigned = allB.filter((b) => b.eventId === e.id && b.status !== 'cancelled');
        const evTechs = RMTP.eventTechnicians ? RMTP.eventTechnicians(e) : [];
        return assigned.length === 0 && evTechs.length === 0;
      });

      // Update badge on Master Rota Board tab button
      const boardCountBadge = el.querySelector('#rota-board-count');
      if (boardCountBadge) {
        boardCountBadge.textContent = `(${totalWeekBookings.length})`;
      }
      const listCountBadge = el.querySelector('#rota-list-count');
      if (listCountBadge) {
        listCountBadge.textContent = `(${allB.length})`;
      }

      if (!stripEl) return;

      const startDStr = parseDate(wStart).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const endDStr = parseDate(wEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

      stripEl.innerHTML = `
        <div class="flex items-center gap-2.5 flex-wrap">
          <span class="font-semibold text-ink flex items-center gap-1.5">
            ${ui.icon('calendar', 'w-4 h-4 text-accent')}
            <span>Week Total (${startDStr}–${endDStr}):</span>
            <span class="font-mono font-bold text-accent">${totalWeekBookings.length} shifts</span>
          </span>
          <span class="text-line hidden sm:inline">|</span>
          <button id="strip-confirmed" class="flex items-center gap-1.5 px-2 py-0.5 rounded transition cursor-pointer ${state.statusFilter === 'confirmed' ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40' : 'text-muted hover:text-emerald-400'}">
            <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>${confirmedCount} Confirmed</span>
          </button>
          <button id="strip-pencil" class="flex items-center gap-1.5 px-2 py-0.5 rounded transition cursor-pointer ${state.statusFilter === 'pencil' ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40' : 'text-muted hover:text-amber-400'}">
            <span class="w-2 h-2 rounded-full bg-amber-400"></span>
            <span>${pencilCount} Pencil Hold</span>
          </button>
          ${unfilledEvents.length > 0 ? `
            <button id="strip-unfilled" class="flex items-center gap-1.5 px-2 py-0.5 rounded border transition cursor-pointer ${state.unfilledOnly ? 'bg-rose-500/20 text-rose-300 border-rose-500/50 font-bold' : 'bg-rose-500/10 text-rose-400 border-rose-500/30'}">
              <span class="w-2 h-2 rounded-full bg-rose-400 animate-pulse"></span>
              <span>${unfilledEvents.length} Unfilled Gap${unfilledEvents.length > 1 ? 's' : ''}</span>
            </button>
          ` : ''}
          <span class="text-line hidden sm:inline">|</span>
          <span class="text-muted flex items-center gap-1">
            ${ui.icon('users', 'w-3.5 h-3.5')}
            <span>${activeFreelancers} Active Techs</span>
          </span>
        </div>
        <div class="text-[11px] text-muted font-mono hidden md:block">
          Click any shift to edit · Click + to schedule on that date
        </div>
      `;

      // Wire strip buttons
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
      stripEl.querySelector('#strip-unfilled')?.addEventListener('click', () => {
        state.unfilledOnly = !state.unfilledOnly;
        state.statusFilter = '';
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
                  Freelancer Rota & Shift Scheduling
                </h1>
                <p class="text-xs text-muted">
                  Live availability, shift bookings, pencils and master room rotas across Rich Mix
                </p>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2 flex-wrap w-full sm:w-auto">
            <button id="btn-submit-avail" class="btn btn-ghost text-xs flex-1 sm:flex-initial justify-center">
              ${ui.icon('clock', 'w-4 h-4')}
              <span>Log Availability</span>
            </button>
            <button id="btn-bulk-avail" class="btn btn-ghost text-xs flex-1 sm:flex-initial justify-center">
              ${ui.icon('calendar', 'w-4 h-4')}
              <span>Bulk Period</span>
            </button>
            <button id="btn-add-booking" class="btn btn-primary text-xs flex-1 sm:flex-initial justify-center shadow-sm font-semibold">
              ${ui.icon('plus', 'w-4 h-4')}
              <span>+ Book Shift</span>
            </button>
          </div>
        </div>

        <!-- Sleek Metrics & Quick Filter Strip -->
        <div id="rota-metrics-strip" class="px-3.5 py-2 rounded-xl bg-panel border border-line flex flex-wrap items-center justify-between gap-2.5 text-xs"></div>

        <!-- Navigation Tabs -->
        <div class="flex items-center gap-1.5 border-b border-line pb-1 overflow-x-auto text-xs scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
          <button data-tab="board" class="shrink-0 px-3.5 py-2 font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${state.tab === 'board' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink hover:bg-panel2'}">
            ${ui.icon('grid', 'w-3.5 h-3.5')}
            <span>Master Rota Board</span>
            <span id="rota-board-count" class="text-[10px] opacity-75 font-mono"></span>
          </button>
          <button data-tab="my_avail" class="shrink-0 px-3.5 py-2 font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${state.tab === 'my_avail' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink hover:bg-panel2'}">
            ${ui.icon('user', 'w-3.5 h-3.5')}
            <span>My Availability & Shifts</span>
          </button>
          <button data-tab="team_matrix" class="shrink-0 px-3.5 py-2 font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${state.tab === 'team_matrix' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink hover:bg-panel2'}">
            ${ui.icon('users', 'w-3.5 h-3.5')}
            <span>Team Matrix</span>
          </button>
          <button data-tab="list" class="shrink-0 px-3.5 py-2 font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${state.tab === 'list' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink hover:bg-panel2'}">
            ${ui.icon('list', 'w-3.5 h-3.5')}
            <span>Shift Bookings</span>
            <span id="rota-list-count" class="text-[10px] opacity-75 font-mono"></span>
          </button>
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
      else if (state.tab === 'team_matrix') renderTeamMatrixTab();
      else if (state.tab === 'list') renderListTab();
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

      let out = `
        <div class="space-y-3">
          <!-- Unified Master Rota Toolbar -->
          <div class="p-3 rounded-xl bg-panel border border-line space-y-2.5">
            <!-- Tier 1: Week Navigator + View Modes + Density Toggle -->
            <div class="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5">
              <!-- Left: Week Jumpers -->
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

              <!-- Middle: Board View Switcher (Week 7D vs Day Swimlanes vs Agenda) -->
              <div class="flex items-center gap-1 p-1 bg-panel2/80 rounded-lg border border-line self-start md:self-auto">
                <button id="view-mode-week" class="px-2.5 py-1 text-xs font-semibold rounded-md transition ${state.boardView === 'week' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink'}">
                  Week Grid (7D)
                </button>
                <button id="view-mode-day" class="px-2.5 py-1 text-xs font-semibold rounded-md transition ${state.boardView === 'day' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink'}">
                  Day by Room
                </button>
                <button id="view-mode-agenda" class="px-2.5 py-1 text-xs font-semibold rounded-md transition ${state.boardView === 'agenda' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink'}">
                  Timeline Agenda
                </button>
              </div>

              <!-- Right: Density Switcher -->
              <div class="flex items-center gap-1 p-1 bg-panel2/60 rounded-lg border border-line self-start md:self-auto">
                <button id="density-compact" class="px-2 py-0.5 text-[11px] font-semibold rounded transition ${state.density === 'compact' ? 'bg-panel text-ink shadow-2xs' : 'text-muted hover:text-ink'}" title="Glanceable high-density view">
                  Glanceable
                </button>
                <button id="density-detailed" class="px-2 py-0.5 text-[11px] font-semibold rounded transition ${state.density === 'detailed' ? 'bg-panel text-ink shadow-2xs' : 'text-muted hover:text-ink'}" title="Detailed expanded view with notes">
                  Detailed
                </button>
              </div>
            </div>

            <!-- Tier 2: Filter Strip (Dropdowns & Quick Status Chips) -->
            <div class="pt-2 border-t border-line/60 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div class="flex items-center gap-2 flex-wrap">
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
      // SUB-VIEW 1: WEEK GRID (7 DAYS SIDE-BY-SIDE)
      // ----------------------------------------------------------------------
      if (state.boardView === 'week') {
        // Mobile Day Switcher Bar (phone/small screens only)
        out += `
          <div class="flex items-center gap-1.5 overflow-x-auto pb-1 md:hidden scrollbar-hide -mx-4 px-4">
            <button data-mob-day="all" class="shrink-0 px-2.5 py-1 text-xs font-semibold rounded-lg border transition ${state.mobileDayFilter === 'all' ? 'bg-accent text-accent-ink border-accent' : 'bg-panel border-line text-muted'}">
              All 7 Days
            </button>
            ${daysData.map((d) => `
              <button data-mob-day="${d.date}" class="shrink-0 px-2.5 py-1 text-xs font-semibold rounded-lg border transition flex items-center gap-1.5 ${state.mobileDayFilter === d.date ? 'bg-accent text-accent-ink border-accent' : (d.isToday ? 'bg-accent/10 border-accent/40 text-accent font-bold' : 'bg-panel border-line text-muted')}">
                <span>${d.dayName} ${d.dayNum}</span>
                ${d.items.length > 0 ? `<span class="w-1.5 h-1.5 rounded-full ${d.items.some(i => i.isUnfilled) ? 'bg-rose-400' : 'bg-accent'}"></span>` : ''}
              </button>
            `).join('')}
          </div>
        `;

        out += `
          <!-- 7-Day Matrix Columns with Desktop Horizontal Safety & Scroll Containment -->
          <div class="overflow-x-auto scrollbar-hide pb-2">
            <div class="grid grid-cols-1 md:grid-cols-7 gap-2.5 items-start min-w-full md:min-w-[1050px]">
        `;

        daysData.forEach((day) => {
          // If on mobile and a specific day is selected, hide other days
          const isHiddenOnMobile = state.mobileDayFilter !== 'all' && state.mobileDayFilter !== day.date;
          const unfilledCount = day.items.filter((i) => i.isUnfilled).length;

          out += `
            <div class="rounded-xl border ${day.isToday ? 'border-accent/60 bg-panel2/40 ring-1 ring-accent/30' : 'border-line bg-panel'} p-2.5 flex flex-col gap-2 min-h-[140px] md:min-h-[460px] ${isHiddenOnMobile ? 'hidden md:flex' : ''}">
              <!-- Day Column Header (Pinned for Glanceability) -->
              <div class="sticky top-0 bg-panel z-10 flex items-center justify-between pb-2 border-b border-line/60">
                <button data-jump-day="${day.date}" class="text-left group cursor-pointer" title="Zoom into Day Room Swimlanes">
                  <div class="flex items-center gap-1.5">
                    <span class="text-xs font-bold uppercase tracking-wider ${day.isToday ? 'text-accent' : 'text-ink group-hover:text-accent transition'}">${day.dayName}</span>
                    <span class="text-xs font-mono font-semibold ${day.isToday ? 'text-accent font-bold' : 'text-muted'}">${day.dayNum} ${day.monthName}</span>
                  </div>
                  <div class="text-[10px] text-muted flex items-center gap-1 mt-0.5">
                    <span class="px-1.5 py-0.2 rounded bg-panel2 border border-line/70 font-mono font-semibold text-ink">${day.items.length} shift${day.items.length === 1 ? '' : 's'}</span>
                    ${unfilledCount > 0 ? `<span class="text-rose-400 font-bold">· ${unfilledCount} unfilled</span>` : ''}
                  </div>
                </button>
                <div class="flex items-center gap-1">
                  <button data-jump-day="${day.date}" class="p-1 rounded text-muted hover:text-accent hover:bg-panel2 transition" title="View Day Swimlanes">
                    ${ui.icon('grid', 'w-3 h-3')}
                  </button>
                  <button data-quick-add-date="${day.date}" class="p-1 rounded text-muted hover:text-accent hover:bg-panel2 transition" title="Add shift on ${day.date}">
                    ${ui.icon('plus', 'w-3.5 h-3.5')}
                  </button>
                </div>
              </div>

              <!-- Shifts List for Day (Glanceable and unclipped so all events render completely) -->
              <div class="space-y-1.5 flex-1 min-h-[300px] pr-0.5">
          `;

          if (day.items.length === 0) {
            out += `
              <div class="py-10 px-2 text-center text-[11px] text-muted/60 italic rounded-lg border border-dashed border-line/40 flex flex-col items-center justify-center gap-1.5">
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
          <div class="overflow-x-auto scrollbar-hide pb-2">
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7 gap-3 items-start min-w-full md:min-w-[1100px]">
        `;

        activeSpaces.forEach((spaceName) => {
          const spaceColor = getSpaceColor(spaceName);
          const spaceItems = daySchedule.filter((i) => i.space === spaceName || (i.spaces && i.spaces.includes(spaceName)));

          out += `
            <div class="rounded-xl border border-line bg-panel p-3 flex flex-col gap-2.5 min-h-[320px]">
              <!-- Room Header -->
              <div class="flex items-center justify-between pb-2 border-b border-line/60">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="w-2.5 h-2.5 rounded-full ${spaceColor.dot} shrink-0"></span>
                  <div class="min-w-0">
                    <span class="font-bold text-xs text-ink block truncate" title="${ui.esc(spaceName)}">${ui.esc(spaceName)}</span>
                    <span class="text-[10px] text-muted font-mono font-semibold">${spaceItems.length} shift${spaceItems.length === 1 ? '' : 's'} · Basic Crew: ${getSpaceBasicCrew(spaceName)}</span>
                  </div>
                </div>
                <button data-add-space-shift="${ui.esc(spaceName)}" class="p-1 rounded text-muted hover:text-accent hover:bg-panel2 transition" title="Add shift in ${ui.esc(spaceName)}">
                  ${ui.icon('plus', 'w-3.5 h-3.5')}
                </button>
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
                  <span class="font-mono text-xs font-semibold text-ink shrink-0 w-24 tabular-nums">${item.startTime} – ${item.finishTime}</span>
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

      // View Mode Switcher
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

      // Density Switcher
      tabContainer.querySelector('#density-compact')?.addEventListener('click', () => {
        state.density = 'compact';
        renderBoardTab();
      });
      tabContainer.querySelector('#density-detailed')?.addEventListener('click', () => {
        state.density = 'detailed';
        renderBoardTab();
      });

      // Day View Day Switcher (Syncs weekOffset with target date)
      tabContainer.querySelectorAll('[data-set-day]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const targetDayStr = btn.getAttribute('data-set-day');
          state.selectedDay = targetDayStr;
          state.weekOffset = getWeekOffsetForDate(targetDayStr);
          state.boardView = 'day';
          renderBoardTab();
          updateTopMetrics();
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
      tabContainer.querySelector('#flt-clear')?.addEventListener('click', () => {
        state.spaceFilter = '';
        state.roleFilter = '';
        state.statusFilter = '';
        state.techFilter = '';
        state.unfilledOnly = false;
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
          openBookingModal({ space: sp, date: state.selectedDay || formatDate(new Date()), startTime: '17:00', finishTime: '23:30', status: 'pencil' });
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
          const [key, spaceName] = raw.split('|');
          const item = allScheduleItemsMap.get(key);
          if (item) {
            openBookingModal({
              eventId: item.eventId,
              eventName: item.eventName,
              space: spaceName || item.spaces[0],
              date: item.date,
              startTime: item.startTime,
              finishTime: item.finishTime,
              role: 'Sound',
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

      let out = `
        <div class="space-y-4">
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

              <div class="flex items-center justify-between text-[11px] pt-1">
                <span class="px-1.5 py-0.2 rounded bg-panel border border-line text-ink font-semibold">${ui.esc(b.role || 'Tech')}</span>
                ${b.status === 'pencil' ? `
                  <div class="flex items-center gap-1">
                    <button data-tech-accept="${b.id}" class="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20">
                      Accept
                    </button>
                    <button data-tech-decline="${b.id}" class="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20">
                      Decline
                    </button>
                  </div>
                ` : ''}
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
      wireMyAvailEvents();
    }

    function wireMyAvailEvents() {
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
                </optgroup>
                <option value="__custom__" ${(!initialData.userId && initialData.userName && initialData.userName !== 'Unassigned') ? 'selected' : ''}>+ Other / External Freelancer (Type Name)</option>
              </select>
              <div id="b-custom-wrap" class="${(!initialData.userId && initialData.userName && initialData.userName !== 'Unassigned') ? 'block' : 'hidden'} mt-2">
                <label class="block font-semibold text-muted mb-1">Freelancer Full Name</label>
                <input id="b-custom-name" class="field" value="${ui.esc(initialData.userName && initialData.userName !== 'Unassigned' ? initialData.userName : '')}" placeholder="e.g. Alex Morgan (Freelance Sound)" />
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
            '<button type="button" id="b-delete" class="btn btn-danger mr-auto flex items-center gap-1.5">' + ui.icon('trash', 'w-4 h-4') + '<span>Delete Shift</span></button>'
          ] : []),
          '<button type="button" class="btn btn-ghost" data-close>Cancel</button>',
          '<button type="button" id="b-save" class="btn btn-primary font-semibold flex items-center gap-1.5 shadow-sm" data-primary>' + ui.icon('check', 'w-4 h-4') + '<span>Save Booking</span></button>',
        ].join(''),
        actions: [
          ...(!isNew ? [
            '<button type="button" id="b-delete" class="btn btn-danger mr-auto flex items-center gap-1.5">' + ui.icon('trash', 'w-4 h-4') + '<span>Delete Shift</span></button>'
          ] : []),
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

      userSel.addEventListener('change', updateAvailabilityCheck);
      dateInp.addEventListener('change', updateAvailabilityCheck);
      updateAvailabilityCheck();

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
            updateAvailabilityCheck();
          }
        }
      });

      // Save
      m.root.querySelector('#b-save').addEventListener('click', () => {
        const userId = userSel.value;
        const bookingDate = dateInp.value;

        if (!bookingDate) {
          ui.toast('Date is required', 'danger');
          return;
        }

        let finalUserId = '';
        let finalUserName = '';
        let isFreelancerFlag = false;

        if (userId === '__custom__') {
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
          userId: finalUserId,
          userName: finalUserName,
          isFreelancer: isFreelancerFlag,
          role: m.root.querySelector('#b-role').value || 'Sound',
          status: m.root.querySelector('#b-status').value || 'pencil',
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

      const todayStr = formatDate(new Date());
      const nextMonthObj = new Date();
      nextMonthObj.setDate(nextMonthObj.getDate() + 28);
      const defaultEndStr = formatDate(nextMonthObj);

      const m = ui.modal({
        title: `Bulk Availability Period · ${ui.esc(targetName)}`,
        body: `
          <div class="space-y-4 text-xs">
            <p class="text-muted">Quickly mark multiple upcoming dates across a range (e.g. all weekends or weekdays next month).</p>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold text-muted mb-1">Start Date</label>
                <input type="date" id="blk-start-date" class="field font-mono" value="${todayStr}" />
              </div>
              <div>
                <label class="block font-semibold text-muted mb-1">End Date</label>
                <input type="date" id="blk-end-date" class="field font-mono" value="${defaultEndStr}" />
              </div>
            </div>

            <!-- Days of Week Filter -->
            <div>
              <label class="block font-semibold text-muted mb-1.5">Apply to Days of Week</label>
              <div class="grid grid-cols-7 gap-1 text-center">
                ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => `
                  <label class="p-2 rounded border border-line bg-panel2/60 cursor-pointer text-center select-none">
                    <input type="checkbox" data-dow="${(i + 1) % 7}" class="w-3.5 h-3.5 accent-[var(--accent)] mx-auto block mb-1" ${i >= 4 ? 'checked' : ''} />
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
                  <option value="available">Available</option>
                  <option value="unavailable">Unavailable</option>
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
              <label class="block font-semibold text-muted mb-1">Notes</label>
              <input id="blk-notes" class="field" placeholder="e.g. Available for sound or lighting shifts" />
            </div>
          </div>
        `,
        footer: [
          '<button type="button" class="btn btn-ghost" data-close>Cancel</button>',
          '<button type="button" id="blk-submit" class="btn btn-primary" data-primary>Apply Period Availability</button>',
        ].join(''),
        actions: [
          '<button type="button" class="btn btn-ghost" data-close>Cancel</button>',
          '<button type="button" id="blk-submit" class="btn btn-primary" data-primary>Apply Period Availability</button>',
        ]
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

    // Initial render
    renderActiveTab();
  };
})();
