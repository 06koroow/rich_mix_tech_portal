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
      availMonth: new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'),
      spaceFilter: '',
      roleFilter: '',
      statusFilter: '',
      techFilter: '',
      selectedUserForAvail: me ? me.id : 'user-3',
    };
    const state = RMTP._rotaState;
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

    // --- Main Layout ---
    const allUsers = getAllUsers();
    const allBookings = getAllBookings();
    const weekDays = getWeekDays(state.weekOffset);
    const startWeekStr = weekDays[0].date;
    const endWeekStr = weekDays[6].date;

    // Filtered bookings for week
    const weekBookings = allBookings.filter((b) => {
      if (b.date < startWeekStr || b.date > endWeekStr) return false;
      if (state.spaceFilter && b.space !== state.spaceFilter) return false;
      if (state.roleFilter && b.role !== state.roleFilter) return false;
      if (state.statusFilter && b.status !== state.statusFilter) return false;
      if (state.techFilter && b.userId !== state.techFilter) return false;
      return true;
    });

    // Counts for metrics banner
    const totalWeekBookings = allBookings.filter((b) => b.date >= startWeekStr && b.date <= endWeekStr);
    const confirmedCount = totalWeekBookings.filter((b) => b.status === 'confirmed').length;
    const pencilCount = totalWeekBookings.filter((b) => b.status === 'pencil').length;
    const cancelledCount = totalWeekBookings.filter((b) => b.status === 'cancelled').length;
    const activeFreelancers = new Set(totalWeekBookings.filter((b) => b.status !== 'cancelled').map((b) => b.userId)).size;

    // Check advancing events in this week to detect unfilled tech shifts
    const weekEvents = getAllEvents().filter((e) => e.date >= startWeekStr && e.date <= endWeekStr);
    const unfilledEvents = weekEvents.filter((e) => {
      const assigned = allBookings.filter((b) => b.eventId === e.id && b.status !== 'cancelled');
      const evTechs = RMTP.eventTechnicians(e);
      return assigned.length === 0 && evTechs.length === 0;
    });

    let html = `
      <div class="space-y-5 animate-fadeIn">
        <!-- Page Header -->
        <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-line">
          <div>
            <div class="flex items-center gap-2.5">
              <span class="p-2 rounded-xl bg-accent/15 text-accent border border-accent/20">
                ${ui.icon('calendar', 'w-5 h-5')}
              </span>
              <div>
                <h1 class="text-xl font-bold tracking-tight text-ink flex items-center gap-2">
                  Freelancer Rota & Scheduling
                </h1>
                <p class="text-xs text-muted mt-0.5">
                  Live availability, shift bookings, pencils and master venue rotas across Rich Mix
                </p>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <button id="btn-submit-avail" class="btn btn-ghost text-xs">
              ${ui.icon('clock', 'w-4 h-4')}
              <span>Log Availability</span>
            </button>
            <button id="btn-bulk-avail" class="btn btn-ghost text-xs">
              ${ui.icon('calendar', 'w-4 h-4')}
              <span>Bulk Period</span>
            </button>
            <button id="btn-add-booking" class="btn btn-primary text-xs">
              ${ui.icon('plus', 'w-4 h-4')}
              <span>+ Book Shift / Freelancer</span>
            </button>
          </div>
        </div>

        <!-- Metrics Banner -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="p-3 rounded-xl bg-panel border border-line flex items-center justify-between">
            <div>
              <div class="text-[11px] font-semibold uppercase tracking-wider text-muted">Weekly Shifts</div>
              <div class="text-lg font-bold font-mono text-ink mt-0.5">${totalWeekBookings.length}</div>
            </div>
            <div class="p-2 rounded-lg bg-panel2 border border-line text-muted">
              ${ui.icon('calendar', 'w-4 h-4')}
            </div>
          </div>
          <div class="p-3 rounded-xl bg-panel border border-line flex items-center justify-between">
            <div>
              <div class="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">Confirmed</div>
              <div class="text-lg font-bold font-mono text-emerald-400 mt-0.5">${confirmedCount}</div>
            </div>
            <div class="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              ${ui.icon('check', 'w-4 h-4')}
            </div>
          </div>
          <div class="p-3 rounded-xl bg-panel border border-line flex items-center justify-between">
            <div>
              <div class="text-[11px] font-semibold uppercase tracking-wider text-amber-400">Penciled Holds</div>
              <div class="text-lg font-bold font-mono text-amber-400 mt-0.5">${pencilCount}</div>
            </div>
            <div class="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
              ${ui.icon('pen', 'w-4 h-4')}
            </div>
          </div>
          <div class="p-3 rounded-xl bg-panel border border-line flex items-center justify-between">
            <div>
              <div class="text-[11px] font-semibold uppercase tracking-wider text-ink/80">Active Technicians</div>
              <div class="text-lg font-bold font-mono text-ink mt-0.5">${activeFreelancers}</div>
            </div>
            <div class="p-2 rounded-lg bg-panel2 border border-line text-muted">
              ${ui.icon('users', 'w-4 h-4')}
            </div>
          </div>
        </div>

        <!-- Navigation Tabs -->
        <div class="flex items-center gap-1.5 border-b border-line pb-1 overflow-x-auto text-xs">
          <button data-tab="board" class="px-3.5 py-2 font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${state.tab === 'board' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink hover:bg-panel2'}">
            ${ui.icon('grid', 'w-3.5 h-3.5')}
            <span>Master Rota Board</span>
          </button>
          <button data-tab="my_avail" class="px-3.5 py-2 font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${state.tab === 'my_avail' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink hover:bg-panel2'}">
            ${ui.icon('user', 'w-3.5 h-3.5')}
            <span>My Availability & Shifts</span>
          </button>
          <button data-tab="team_matrix" class="px-3.5 py-2 font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${state.tab === 'team_matrix' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink hover:bg-panel2'}">
            ${ui.icon('users', 'w-3.5 h-3.5')}
            <span>Team Availability Matrix</span>
          </button>
          <button data-tab="list" class="px-3.5 py-2 font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${state.tab === 'list' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink hover:bg-panel2'}">
            ${ui.icon('list', 'w-3.5 h-3.5')}
            <span>All Shift Bookings (${allBookings.length})</span>
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
      if (state.tab === 'board') renderBoardTab();
      else if (state.tab === 'my_avail') renderMyAvailTab();
      else if (state.tab === 'team_matrix') renderTeamMatrixTab();
      else if (state.tab === 'list') renderListTab();
    }

    // ------------------------------------------------------------------------
    // TAB 1: MASTER ROTA BOARD
    // ------------------------------------------------------------------------
    function renderBoardTab() {
      const startD = parseDate(startWeekStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const endD = parseDate(endWeekStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

      let out = `
        <div class="space-y-4">
          <!-- Week Navigator & Filter Bar -->
          <div class="p-3 rounded-xl bg-panel border border-line flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <!-- Week Jumpers -->
            <div class="flex items-center gap-2">
              <button id="week-prev" class="btn btn-ghost !p-2" title="Previous Week">
                ${ui.icon('chevL', 'w-4 h-4')}
              </button>
              <button id="week-today" class="btn btn-ghost text-xs ${state.weekOffset === 0 ? 'bg-panel2 border border-line font-bold' : ''}">
                This Week
              </button>
              <button id="week-next" class="btn btn-ghost !p-2" title="Next Week">
                ${ui.icon('chevR', 'w-4 h-4')}
              </button>
              <span class="text-xs font-semibold text-ink px-2 font-mono tabular-nums">
                ${startD} – ${endD}
              </span>
            </div>

            <!-- Filter Controls -->
            <div class="flex items-center gap-2 flex-wrap">
              <select id="flt-space" class="field !py-1 text-xs">
                <option value="">All Spaces</option>
                ${RMTP.SPACES.map((s) => `<option value="${ui.esc(s)}" ${state.spaceFilter === s ? 'selected' : ''}>${ui.esc(s)}</option>`).join('')}
              </select>

              <select id="flt-role" class="field !py-1 text-xs">
                <option value="">All Roles</option>
                ${RMTP.SHIFT_ROLES.map((r) => `<option value="${r}" ${state.roleFilter === r ? 'selected' : ''}>${r}</option>`).join('')}
              </select>

              <select id="flt-status" class="field !py-1 text-xs">
                <option value="">All Statuses</option>
                <option value="confirmed" ${state.statusFilter === 'confirmed' ? 'selected' : ''}>Confirmed</option>
                <option value="pencil" ${state.statusFilter === 'pencil' ? 'selected' : ''}>Pencil</option>
                <option value="declined" ${state.statusFilter === 'declined' ? 'selected' : ''}>Declined</option>
                <option value="cancelled" ${state.statusFilter === 'cancelled' ? 'selected' : ''}>Cancelled</option>
              </select>

              <select id="flt-tech" class="field !py-1 text-xs">
                <option value="">All Technicians</option>
                ${allUsers.map((u) => `<option value="${u.id}" ${state.techFilter === u.id ? 'selected' : ''}>${ui.esc(auth.displayName(u))}</option>`).join('')}
              </select>

              ${(state.spaceFilter || state.roleFilter || state.statusFilter || state.techFilter) ? `
                <button id="flt-clear" class="btn btn-ghost text-xs !py-1 text-danger">Clear</button>
              ` : ''}
            </div>
          </div>

          <!-- Unfilled Coverage Gaps Alert (if any) -->
          ${unfilledEvents.length > 0 ? `
            <div class="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-3 text-xs">
              <div class="flex items-center gap-2 text-amber-400">
                ${ui.icon('alert', 'w-4 h-4 shrink-0')}
                <span><strong>Coverage Gap:</strong> ${unfilledEvents.length} advancing event(s) this week have no technicians assigned yet.</span>
              </div>
              <div class="flex items-center gap-2">
                ${unfilledEvents.map((e) => `
                  <button data-quick-fill="${e.id}" class="px-2 py-0.5 rounded bg-panel border border-amber-500/40 text-[11px] text-ink hover:text-amber-400">
                    + Fill: ${ui.esc(e.name)}
                  </button>
                `).slice(0, 2).join('')}
              </div>
            </div>
          ` : ''}

          <!-- 7-Day Matrix Columns -->
          <div class="grid grid-cols-1 md:grid-cols-7 gap-2.5 items-start">
      `;

      weekDays.forEach((day) => {
        const dayBookings = weekBookings.filter((b) => b.date === day.date);
        const dayAdvEvents = weekEvents.filter((e) => e.date === day.date);

        out += `
          <div class="rounded-xl border ${day.isToday ? 'border-accent/50 bg-panel2/40' : 'border-line bg-panel'} p-2.5 flex flex-col gap-2 min-h-[360px]">
            <!-- Day Column Header -->
            <div class="flex items-center justify-between pb-2 border-b border-line/60">
              <div>
                <span class="text-xs font-bold uppercase tracking-wider ${day.isToday ? 'text-accent' : 'text-muted'}">${day.dayName}</span>
                <span class="text-xs font-mono font-semibold text-ink ml-1">${day.dayNum} ${day.monthName}</span>
              </div>
              <button data-quick-add-date="${day.date}" class="p-1 rounded text-muted hover:text-accent hover:bg-panel2 transition" title="Add shift on ${day.date}">
                ${ui.icon('plus', 'w-3.5 h-3.5')}
              </button>
            </div>

            <!-- Shifts List for Day -->
            <div class="space-y-2 flex-1">
        `;

        if (dayBookings.length === 0 && dayAdvEvents.length === 0) {
          out += `
            <div class="p-4 text-center text-[11px] text-muted italic">
              No shifts scheduled
            </div>
          `;
        } else {
          // Render Bookings
          dayBookings.forEach((b) => {
            const techObj = allUsers.find((u) => u.id === b.userId);
            const techName = b.userName || (techObj ? auth.displayName(techObj) : 'Unknown Tech');
            const conflictStatus = getTechLiveStatus(b.userId, b.date);

            out += `
              <div class="p-2.5 rounded-lg border bg-panel2/80 hover:border-line/90 transition shadow-2xs space-y-2 ${b.status === 'confirmed' ? 'border-emerald-500/20' : (b.status === 'pencil' ? 'border-amber-500/30' : 'border-line')}">
                <!-- Card Header -->
                <div class="flex items-start justify-between gap-1.5">
                  <div class="min-w-0">
                    <span class="text-[10px] font-semibold text-accent uppercase tracking-wider block truncate">${ui.esc(b.space || 'Venue')}</span>
                    <span class="text-xs font-bold text-ink leading-tight block truncate" title="${ui.esc(b.eventName || 'Shift')}">${ui.esc(b.eventName || 'Shift')}</span>
                  </div>
                  <div class="shrink-0">
                    ${renderStatusPill(b.status, b.cancellationReason)}
                  </div>
                </div>

                <!-- Shift Meta -->
                <div class="flex items-center justify-between text-[11px] text-muted pt-1 border-t border-line/40">
                  <span class="font-mono tabular-nums text-ink">${b.startTime || '17:00'} – ${b.finishTime || '23:30'}</span>
                  <span class="px-1.5 py-0.2 rounded bg-panel text-[10px] font-semibold border border-line text-ink">${ui.esc(b.role || 'Tech')}</span>
                </div>

                <!-- Assigned Technician -->
                <div class="flex items-center justify-between gap-2 text-xs pt-1">
                  <div class="flex items-center gap-1.5 min-w-0">
                    <span class="w-5 h-5 rounded-full bg-accent/20 text-accent text-[10px] font-bold flex items-center justify-center shrink-0">
                      ${(techName[0] || 'T').toUpperCase()}
                    </span>
                    <span class="text-xs font-medium text-ink truncate">${ui.esc(techName)}</span>
                  </div>
                  ${b.rate ? `<span class="text-[10px] font-mono text-muted tabular-nums">${ui.esc(b.rate)}</span>` : ''}
                </div>

                ${b.status === 'cancelled' && b.cancellationReason ? `
                  <div class="text-[10px] text-muted italic bg-panel p-1 rounded border border-line">
                    Reason: ${ui.esc(b.cancellationReason)}
                  </div>
                ` : ''}

                <!-- Actions on Card -->
                <div class="flex items-center justify-end gap-1.5 pt-1.5 border-t border-line/50">
                  ${b.status === 'pencil' ? `
                    <button data-quick-confirm="${b.id}" class="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30 transition">
                      Confirm
                    </button>
                  ` : ''}
                  ${b.status === 'confirmed' ? `
                    <button data-quick-pencil="${b.id}" class="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/30 transition">
                      Pencil
                    </button>
                  ` : ''}
                  <button data-edit-booking="${b.id}" class="p-1 rounded text-muted hover:text-ink hover:bg-panel" title="Edit Shift">
                    ${ui.icon('pen', 'w-3 h-3')}
                  </button>
                  ${isTechManager && b.status !== 'cancelled' ? `
                    <button data-cancel-booking="${b.id}" class="p-1 rounded text-muted hover:text-danger hover:bg-panel" title="Cancel Shift (Venue Manager)">
                      ${ui.icon('x', 'w-3 h-3')}
                    </button>
                  ` : ''}
                </div>
              </div>
            `;
          });

          // Unassigned advancing events in this day that need crew
          dayAdvEvents.forEach((ev) => {
            const hasBooking = dayBookings.some((b) => b.eventId === ev.id);
            if (!hasBooking) {
              out += `
                <div class="p-2.5 rounded-lg border border-dashed border-line bg-panel2/30 space-y-1.5">
                  <div class="flex items-center justify-between gap-1">
                    <span class="text-[10px] font-semibold text-muted uppercase tracking-wider">${ui.esc(ev.space)}</span>
                    <span class="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 font-semibold">Unfilled</span>
                  </div>
                  <div class="text-xs font-semibold text-ink truncate">${ui.esc(ev.name)}</div>
                  <div class="text-[11px] font-mono text-muted tabular-nums">${ev.startTime || '18:00'} – ${ev.finishTime || '23:00'}</div>
                  <button data-assign-event="${ev.id}" class="btn btn-ghost !py-0.5 !px-1.5 text-[10px] w-full justify-center text-accent">
                    + Assign Freelancer
                  </button>
                </div>
              `;
            }
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

      tabContainer.innerHTML = out;
      wireBoardEvents();
    }

    function wireBoardEvents() {
      // Week Navigator
      tabContainer.querySelector('#week-prev')?.addEventListener('click', () => {
        state.weekOffset -= 1;
        renderBoardTab();
      });
      tabContainer.querySelector('#week-next')?.addEventListener('click', () => {
        state.weekOffset += 1;
        renderBoardTab();
      });
      tabContainer.querySelector('#week-today')?.addEventListener('click', () => {
        state.weekOffset = 0;
        renderBoardTab();
      });

      // Filters
      tabContainer.querySelector('#flt-space')?.addEventListener('change', (e) => {
        state.spaceFilter = e.target.value;
        renderBoardTab();
      });
      tabContainer.querySelector('#flt-role')?.addEventListener('change', (e) => {
        state.roleFilter = e.target.value;
        renderBoardTab();
      });
      tabContainer.querySelector('#flt-status')?.addEventListener('change', (e) => {
        state.statusFilter = e.target.value;
        renderBoardTab();
      });
      tabContainer.querySelector('#flt-tech')?.addEventListener('change', (e) => {
        state.techFilter = e.target.value;
        renderBoardTab();
      });
      tabContainer.querySelector('#flt-clear')?.addEventListener('click', () => {
        state.spaceFilter = ''; state.roleFilter = ''; state.statusFilter = ''; state.techFilter = '';
        renderBoardTab();
      });

      // Quick Actions on Cards
      tabContainer.querySelectorAll('[data-quick-confirm]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-quick-confirm');
          const b = store.find('bookings', id);
          if (b) {
            b.status = 'confirmed';
            b.confirmedAt = new Date().toISOString();
            store.upsert('bookings', b);
            ui.toast(`Shift confirmed for ${b.userName || 'technician'}`, 'ok');
            renderActiveTab();
          }
        });
      });

      tabContainer.querySelectorAll('[data-quick-pencil]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-quick-pencil');
          const b = store.find('bookings', id);
          if (b) {
            b.status = 'pencil';
            b.penciledAt = new Date().toISOString();
            store.upsert('bookings', b);
            ui.toast(`Shift status updated to Pencil hold`, 'info');
            renderActiveTab();
          }
        });
      });

      tabContainer.querySelectorAll('[data-cancel-booking]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-cancel-booking');
          const b = store.find('bookings', id);
          if (b) openCancelShiftModal(b);
        });
      });

      tabContainer.querySelectorAll('[data-edit-booking]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-edit-booking');
          const b = store.find('bookings', id);
          if (b) openBookingModal(b);
        });
      });

      tabContainer.querySelectorAll('[data-quick-add-date]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const d = btn.getAttribute('data-quick-add-date');
          openBookingModal({ date: d, startTime: '17:00', finishTime: '23:30', status: 'pencil' });
        });
      });

      tabContainer.querySelectorAll('[data-assign-event]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const evId = btn.getAttribute('data-assign-event');
          const ev = store.find('advancing', evId);
          if (ev) {
            openBookingModal({
              eventId: ev.id,
              eventName: ev.name,
              space: Array.isArray(ev.space) ? ev.space[0] : ev.space,
              date: ev.date,
              startTime: ev.startTime || '17:00',
              finishTime: ev.finishTime || '23:30',
              role: 'Sound',
              status: 'pencil',
            });
          }
        });
      });

      tabContainer.querySelectorAll('[data-quick-fill]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const evId = btn.getAttribute('data-quick-fill');
          const ev = store.find('advancing', evId);
          if (ev) {
            openBookingModal({
              eventId: ev.id,
              eventName: ev.name,
              space: Array.isArray(ev.space) ? ev.space[0] : ev.space,
              date: ev.date,
              startTime: ev.startTime || '17:00',
              finishTime: ev.finishTime || '23:30',
              role: 'Sound',
              status: 'pencil',
            });
          }
        });
      });
    }

    // ------------------------------------------------------------------------
    // TAB 2: MY AVAILABILITY & SHIFTS
    // ------------------------------------------------------------------------
    function renderMyAvailTab() {
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
              <div class="flex items-center justify-between pb-2 border-b border-line/60">
                <div class="text-xs font-semibold text-ink flex items-center gap-2">
                  <span>Interactive Availability Calendar</span>
                  <span class="text-[11px] text-muted">(Click any date to set or update)</span>
                </div>
                <div class="flex items-center gap-3 text-[11px]">
                  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-emerald-400"></span> Available</span>
                  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-rose-400"></span> Unavailable</span>
                  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-amber-400"></span> Shift Booked</span>
                </div>
              </div>

              <!-- Day headers -->
              <div class="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-muted uppercase tracking-wider py-1">
                <div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div><div>Sun</div>
              </div>

              <!-- Days -->
              <div class="grid grid-cols-7 gap-1.5">
      `;

      // Blank padding days
      for (let i = 0; i < startingDayOfWeek; i++) {
        out += `<div class="p-2 min-h-[72px] rounded-lg bg-panel2/20 border border-transparent opacity-30"></div>`;
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
          <div data-cell-date="${dateStr}" class="p-1.5 min-h-[76px] rounded-lg border ${statusBorder} ${statusBg} ${isToday ? 'ring-1 ring-accent' : ''} hover:border-accent cursor-pointer transition flex flex-col justify-between">
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
      const monday = parseDate(startWeekStr);
      for (let i = 0; i < 14; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        days.push({
          date: formatDate(d),
          dayName: d.toLocaleDateString('en-GB', { weekday: 'narrow' }),
          dayNum: d.getDate(),
          monthName: d.toLocaleDateString('en-GB', { month: 'short' }),
          isToday: formatDate(d) === formatDate(new Date()),
        });
      }

      let out = `
        <div class="space-y-4">
          <div class="flex items-center justify-between pb-2 border-b border-line">
            <div>
              <h2 class="text-sm font-bold text-ink">Two-Week Team Availability & Rota Matrix</h2>
              <p class="text-xs text-muted">Bird's eye view of freelancer and core duty technician availability across Rich Mix</p>
            </div>
            <div class="flex items-center gap-2">
              <button id="matrix-week-prev" class="btn btn-ghost !p-1.5" title="Previous Week">
                ${ui.icon('chevL', 'w-4 h-4')}
              </button>
              <button id="matrix-week-today" class="btn btn-ghost text-xs">Today</button>
              <button id="matrix-week-next" class="btn btn-ghost !p-1.5" title="Next Week">
                ${ui.icon('chevR', 'w-4 h-4')}
              </button>
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
      });
      tabContainer.querySelector('#matrix-week-next')?.addEventListener('click', () => {
        state.weekOffset += 1;
        renderTeamMatrixTab();
      });
      tabContainer.querySelector('#matrix-week-today')?.addEventListener('click', () => {
        state.weekOffset = 0;
        renderTeamMatrixTab();
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
      let bookings = allBookings.slice().sort((a, b) => (a.date < b.date ? 1 : -1));

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
                <option value="">Select a technician…</option>
                ${allUsers.map((u) => `
                  <option value="${u.id}" ${u.id === initialData.userId ? 'selected' : ''}>
                    ${ui.esc(auth.displayName(u))} (${ui.esc(u.position || 'Tech')})
                  </option>
                `).join('')}
              </select>
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
        actions: [
          ...(!isNew ? [
            '<button type="button" id="b-delete" class="btn btn-danger mr-auto">Delete Shift</button>'
          ] : []),
          '<button type="button" class="btn btn-ghost" data-close>Cancel</button>',
          '<button type="button" id="b-save" class="btn btn-primary" data-primary>Save Booking</button>',
        ]
      });

      const userSel = m.root.querySelector('#b-user');
      const dateInp = m.root.querySelector('#b-date');
      const eventSel = m.root.querySelector('#b-event');
      const eventNameInp = m.root.querySelector('#b-event-name');
      const spaceSel = m.root.querySelector('#b-space');
      const tagEl = m.root.querySelector('#b-avail-status-tag');
      const detailsEl = m.root.querySelector('#b-avail-details-text');

      function updateAvailabilityCheck() {
        const uid = userSel.value;
        const dStr = dateInp.value;
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
        const techObj = allUsers.find((u) => u.id === userId);
        const bookingDate = dateInp.value;

        if (!bookingDate) {
          ui.toast('Date is required', 'danger');
          return;
        }

        const record = {
          id: initialData.id || store.uid('book'),
          eventId: eventSel.value || '',
          eventName: eventNameInp.value.trim() || 'Venue Shift',
          space: spaceSel.value,
          date: bookingDate,
          startTime: m.root.querySelector('#b-start').value || '17:00',
          finishTime: m.root.querySelector('#b-end').value || '23:30',
          userId: userId,
          userName: techObj ? auth.displayName(techObj) : (initialData.userName || ''),
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
        if (record.eventId && record.userId) {
          const advEv = store.find('advancing', record.eventId);
          if (advEv) {
            advEv.technicians = advEv.technicians || [];
            const exists = advEv.technicians.some((t) => t.userId === record.userId);
            if (!exists) {
              advEv.technicians.push({
                userId: record.userId,
                role: record.role,
                startTime: record.startTime,
                finishTime: record.finishTime,
                bookingStatus: record.status,
              });
              store.upsert('advancing', advEv);
            }
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
