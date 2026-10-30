/* ============================================================
   views/tasks.js — full page view of all assignable jobs & tasks
   ------------------------------------------------------------
   Centralized queue for all operational venue tasks, including:
   - Cinema & DCP Pre-Screening follow-up actions
   - Space & stage prep jobs
   - Equipment & booth maintenance actions
   - Shift & operational to-dos
   ============================================================ */
RMTP.views.tasks = (function () {
  const store = RMTP.store;
  const ui = RMTP.ui;
  const auth = RMTP.auth;

  // View state
  let currentViewMode = 'board'; // 'board' (kanban) | 'list' (tabular)
  let activeCategoryFilter = 'all';
  let activeStatusFilter = 'all'; // 'all', 'open', 'Pending', 'In Progress', 'Blocked', 'Completed'
  let activePriorityFilter = 'all';
  let activeSpaceFilter = 'all';
  let activeAssigneeFilter = 'all'; // 'all', 'me', 'unassigned', or userId
  let searchQuery = '';

  const CATEGORIES = ['Cinema & DCP', 'Sound', 'Lighting', 'AV', 'Stage', 'General', 'Maintenance'];
  const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'];
  const STATUSES = ['Pending', 'In Progress', 'Blocked', 'Completed'];

  /* ---- Initial Seeds (If store is empty) ---- */
  function ensureInitialSeeds() {
    let tasks = store.all('tasks') || [];
    if (tasks.length === 0) {
      // Migrate any existing follow-up tasks from maintenance that originated from DCP screenings
      const existingMaint = store.all('maintenance') || [];
      const migrated = [];

      existingMaint.forEach((m) => {
        if (m.linkedScreeningId || (m.equipment && m.equipment.includes('Pre-Screening'))) {
          migrated.push({
            id: 'task-' + m.id.replace('fault-', ''),
            title: m.equipment || 'Cinema Pre-Screening Follow-up',
            description: m.description || '',
            category: 'Cinema & DCP',
            space: m.space || 'Screen One',
            priority: m.priority || 'Medium',
            status: m.status === 'Resolved' ? 'Completed' : (m.status === 'In Progress' ? 'In Progress' : 'Pending'),
            assignedTechId: m.assignedTechId || '',
            assignedTechName: m.assignedTechName || '',
            reportedBy: m.reportedBy || 'Cinema Tech',
            source: 'dcp_test',
            linkedScreeningId: m.linkedScreeningId || '',
            linkedEventId: m.linkedEventId || '',
            dueDate: new Date().toISOString().slice(0, 10),
            createdAt: m.createdAt || Date.now(),
            updatedAt: Date.now()
          });
        }
      });

      // Sample production-grade venue jobs
      const defaultSeeds = [
        {
          id: 'task-seed-01',
          title: 'Past Lives: Verify 5.1 Center Channel Dialogue Anchor',
          description: 'Center speaker level reported slightly low during initial DCP preview on Screen 1. Re-check CP750 fader reference and run pink noise test.',
          category: 'Cinema & DCP',
          space: 'Screen One',
          priority: 'High',
          status: 'In Progress',
          assignedTechId: 'user-3',
          assignedTechName: 'Sam Okafor',
          reportedBy: 'Sam Okafor',
          source: 'dcp_test',
          linkedScreeningId: 'dcp-seed-01',
          filmTitle: 'Past Lives',
          screen: 'Screen One',
          dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
          dueTime: '17:00',
          mediaType: 'DCP',
          createdAt: Date.now() - 7200000,
          updatedAt: Date.now() - 3600000
        },
        {
          id: 'task-seed-02',
          title: 'Anatomy of a Fall: Ingest Updated CPL & Supplemental Subtitle Pack',
          description: 'Distributor sent revised OV/VF package with burned-in captions for Q&A screening. Ingest from Aspera drive into Doremi server.',
          category: 'Cinema & DCP',
          space: 'Screen Two',
          priority: 'Urgent',
          status: 'Pending',
          assignedTechId: '',
          assignedTechName: '',
          reportedBy: 'Elena Rostova',
          source: 'dcp_test',
          linkedScreeningId: 'dcp-seed-02',
          filmTitle: 'Anatomy of a Fall',
          screen: 'Screen Two',
          dueDate: new Date().toISOString().slice(0, 10),
          dueTime: '18:00',
          mediaType: 'DCP',
          createdAt: Date.now() - 14400000,
          updatedAt: Date.now() - 14400000
        },
        {
          id: 'task-seed-03',
          title: 'Screen 1: Projector Optical Glass & Intake Filter Clean',
          description: 'Scheduled monthly maintenance for Christie CP2220 lamp house and optical port glass cleaning with optical wipes.',
          category: 'Cinema & DCP',
          space: 'Screen One',
          priority: 'Medium',
          status: 'Pending',
          assignedTechId: 'user-1',
          assignedTechName: 'Alex Mercer',
          reportedBy: 'Alex Mercer',
          source: 'venue_prep',
          dueDate: new Date(Date.now() + 172800000).toISOString().slice(0, 10),
          dueTime: '14:00',
          createdAt: Date.now() - 86400000,
          updatedAt: Date.now() - 86400000
        },
        {
          id: 'task-seed-04',
          title: 'The Stage: Radio Mic Frequency Scan & Battery Stock Replenish',
          description: 'Perform RF scan on Shure Axient rack for evening live performance. Ensure 8x rechargeable AA packs are seated in dock.',
          category: 'Sound',
          space: 'The Stage',
          priority: 'High',
          status: 'Pending',
          assignedTechId: '',
          assignedTechName: '',
          reportedBy: 'Maya Lin',
          source: 'shift_prep',
          dueDate: new Date().toISOString().slice(0, 10),
          dueTime: '16:00',
          createdAt: Date.now() - 18000000,
          updatedAt: Date.now() - 18000000
        },
        {
          id: 'task-seed-05',
          title: 'Screen 3: Reset Side Masking Limits for Flat (1.85:1) Aspect',
          description: 'Masking motor limit switch was sticking slightly on stage left. Calibrate preset #2 on control panel.',
          category: 'Cinema & DCP',
          space: 'Screen Three',
          priority: 'Medium',
          status: 'Completed',
          assignedTechId: 'user-3',
          assignedTechName: 'Sam Okafor',
          reportedBy: 'Sam Okafor',
          source: 'dcp_test',
          completedBy: 'Sam Okafor',
          completedAt: new Date(Date.now() - 4000000).toISOString(),
          dueDate: new Date().toISOString().slice(0, 10),
          createdAt: Date.now() - 28000000,
          updatedAt: Date.now() - 4000000
        }
      ];

      const initialList = migrated.length > 0 ? [...migrated, ...defaultSeeds] : defaultSeeds;
      initialList.forEach((t) => store.upsert('tasks', t));
    }
  }

  /* ---- Priority UI Styling ---- */
  function getPriorityBadge(priority) {
    const p = String(priority || 'Medium').toLowerCase();
    if (p === 'urgent') {
      return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">' +
        ui.icon('alert', 'w-3 h-3 text-rose-400') + '<span>Urgent</span></span>';
    }
    if (p === 'high') {
      return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">' +
        ui.icon('alert', 'w-3 h-3 text-amber-400') + '<span>High</span></span>';
    }
    if (p === 'low') {
      return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-panel2 text-muted border border-line">' +
        '<span>Low</span></span>';
    }
    return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/15 text-sky-300 border border-sky-500/30">' +
      '<span>Medium</span></span>';
  }

  /* ---- Status UI Styling ---- */
  function getStatusBadge(status) {
    const s = String(status || 'Pending').toLowerCase();
    if (s === 'completed') {
      return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">' +
        ui.icon('check', 'w-3 h-3 text-emerald-400') + '<span>Completed</span></span>';
    }
    if (s === 'in progress' || s === 'in_progress') {
      return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-accent/20 text-accent border border-accent/40">' +
        ui.icon('clock', 'w-3 h-3 text-accent') + '<span>In Progress</span></span>';
    }
    if (s === 'blocked') {
      return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">' +
        ui.icon('x', 'w-3 h-3 text-rose-400') + '<span>Blocked</span></span>';
    }
    return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-panel2 text-muted border border-line">' +
      '<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span><span>To Do</span></span>';
  }

  /* ---- Category UI Badge ---- */
  function getCategoryBadge(cat) {
    const c = String(cat || 'General').toLowerCase();
    let cls = 'bg-panel2 text-muted border-line';
    let iconName = 'list';
    if (c.includes('cinema') || c.includes('dcp')) {
      cls = 'bg-accent/15 text-accent border-accent/30 font-semibold';
      iconName = 'film';
    } else if (c.includes('sound')) {
      cls = 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      iconName = 'volume';
    } else if (c.includes('light')) {
      cls = 'bg-purple-500/15 text-purple-300 border-purple-500/30';
      iconName = 'bulb';
    } else if (c.includes('stage')) {
      cls = 'bg-rose-500/15 text-rose-300 border-rose-500/30';
      iconName = 'tool';
    }
    return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border ' + cls + '">' +
      ui.icon(iconName, 'w-3 h-3') + '<span>' + ui.esc(cat || 'General') + '</span></span>';
  }

  /* ---- Main View Function ---- */
  return function (el) {
    if (!el) return;
    ensureInitialSeeds();

    function renderTasksPage() {
      const me = auth.current();
      const allTasks = store.all('tasks') || [];
      const allUsers = store.all('users') || [];
      const todayIso = new Date().toISOString().slice(0, 10);

      // Filter tasks
      let filtered = allTasks.slice();

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        filtered = filtered.filter((t) =>
          (t.title && t.title.toLowerCase().includes(q)) ||
          (t.description && t.description.toLowerCase().includes(q)) ||
          (t.space && t.space.toLowerCase().includes(q)) ||
          (t.category && t.category.toLowerCase().includes(q)) ||
          (t.assignedTechName && t.assignedTechName.toLowerCase().includes(q)) ||
          (t.filmTitle && t.filmTitle.toLowerCase().includes(q))
        );
      }

      // Category
      if (activeCategoryFilter !== 'all') {
        filtered = filtered.filter((t) => t.category === activeCategoryFilter);
      }

      // Priority
      if (activePriorityFilter !== 'all') {
        filtered = filtered.filter((t) => t.priority === activePriorityFilter);
      }

      // Space
      if (activeSpaceFilter !== 'all') {
        filtered = filtered.filter((t) => t.space === activeSpaceFilter);
      }

      // Assignee
      if (activeAssigneeFilter === 'me') {
        filtered = filtered.filter((t) => me && t.assignedTechId === me.id);
      } else if (activeAssigneeFilter === 'unassigned') {
        filtered = filtered.filter((t) => !t.assignedTechId);
      } else if (activeAssigneeFilter !== 'all') {
        filtered = filtered.filter((t) => t.assignedTechId === activeAssigneeFilter);
      }

      // Status
      if (activeStatusFilter === 'open') {
        filtered = filtered.filter((t) => t.status !== 'Completed');
      } else if (activeStatusFilter !== 'all') {
        filtered = filtered.filter((t) => t.status === activeStatusFilter);
      }

      // Sort: Urgent & High first, then upcoming due dates
      filtered.sort((a, b) => {
        const pOrder = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
        const pa = pOrder[a.priority] !== undefined ? pOrder[a.priority] : 2;
        const pb = pOrder[b.priority] !== undefined ? pOrder[b.priority] : 2;
        if (pa !== pb) return pa - pb;
        const da = a.dueDate || '9999-99-99';
        const db = b.dueDate || '9999-99-99';
        return da.localeCompare(db);
      });

      // KPI counts
      const totalCount = allTasks.length;
      const pendingCount = allTasks.filter((t) => t.status === 'Pending').length;
      const inProgressCount = allTasks.filter((t) => t.status === 'In Progress').length;
      const completedCount = allTasks.filter((t) => t.status === 'Completed').length;
      const cinemaDcpCount = allTasks.filter((t) => t.category === 'Cinema & DCP').length;
      const myCount = me ? allTasks.filter((t) => t.assignedTechId === me.id && t.status !== 'Completed').length : 0;

      let html = `
        <div class="space-y-5 w-full max-w-full pb-16 animate-fadeIn">
          <!-- Top Header Bar -->
          <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-line">
            <div>
              <div class="flex items-center gap-2.5">
                <span class="p-2.5 rounded-xl bg-accent/15 text-accent border border-accent/25 shrink-0">
                  ${ui.icon('list', 'w-6 h-6')}
                </span>
                <div>
                  <h1 class="text-xl sm:text-2xl font-bold font-display text-ink tracking-tight flex items-center gap-2">
                    Jobs &amp; Assignable Tasks
                  </h1>
                  <p class="text-xs text-muted mt-0.5">
                    Centralized venue queue for Cinema &amp; DCP follow-up actions, booth maintenance, and stage prep tasks.
                  </p>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2.5 flex-wrap">
              <!-- View Switcher -->
              <div class="inline-flex rounded-lg bg-panel border border-line p-1">
                <button id="view-mode-board" class="px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition ${currentViewMode === 'board' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink'}" title="Kanban Board View">
                  ${ui.icon('grid', 'w-3.5 h-3.5')}
                  <span>Board</span>
                </button>
                <button id="view-mode-list" class="px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition ${currentViewMode === 'list' ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink'}" title="Table List View">
                  ${ui.icon('list', 'w-3.5 h-3.5')}
                  <span>Registry</span>
                </button>
              </div>

              <!-- Action: New Task -->
              <button id="btn-create-task" class="btn btn-primary text-xs font-semibold flex items-center gap-1.5 shadow-2xs">
                ${ui.icon('plus', 'w-4 h-4')}
                <span>+ New Job / Task</span>
              </button>
            </div>
          </div>

          <!-- KPI Metrics Row -->
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div class="p-3.5 rounded-xl bg-panel border border-line">
              <div class="text-[10.5px] font-mono uppercase tracking-wider text-muted">Total Jobs</div>
              <div class="text-2xl font-bold font-mono text-ink mt-1 tabular-nums">${totalCount}</div>
              <div class="text-[11px] text-muted mt-0.5">${completedCount} completed</div>
            </div>

            <div class="p-3.5 rounded-xl bg-panel border border-line">
              <div class="text-[10.5px] font-mono uppercase tracking-wider text-muted">To Do / Pending</div>
              <div class="text-2xl font-bold font-mono text-amber-400 mt-1 tabular-nums">${pendingCount}</div>
              <div class="text-[11px] text-muted mt-0.5">Awaiting assignment / start</div>
            </div>

            <div class="p-3.5 rounded-xl bg-panel border border-line">
              <div class="text-[10.5px] font-mono uppercase tracking-wider text-accent">In Progress</div>
              <div class="text-2xl font-bold font-mono text-accent mt-1 tabular-nums">${inProgressCount}</div>
              <div class="text-[11px] text-muted mt-0.5">Active work underway</div>
            </div>

            <div class="p-3.5 rounded-xl bg-panel border border-line">
              <div class="text-[10.5px] font-mono uppercase tracking-wider text-accent">Cinema &amp; DCP Actions</div>
              <div class="text-2xl font-bold font-mono text-ink mt-1 tabular-nums">${cinemaDcpCount}</div>
              <div class="text-[11px] text-muted mt-0.5">From Pre-Screening Tracker</div>
            </div>

            <div class="p-3.5 rounded-xl bg-panel border border-line col-span-2 sm:col-span-1">
              <div class="text-[10.5px] font-mono uppercase tracking-wider text-emerald-400">Assigned to You</div>
              <div class="text-2xl font-bold font-mono text-emerald-400 mt-1 tabular-nums">${myCount}</div>
              <div class="text-[11px] text-muted mt-0.5">${me ? auth.displayName(me) : 'Active technician'}</div>
            </div>
          </div>

          <!-- Quick Filters Strip -->
          <div class="p-3.5 rounded-xl bg-panel border border-line space-y-3">
            <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <!-- Search Input -->
              <div class="relative flex-1 max-w-md">
                <span class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted">
                  ${ui.icon('search', 'w-4 h-4')}
                </span>
                <input
                  id="task-search-input"
                  type="text"
                  class="field !pl-9 text-xs"
                  placeholder="Search jobs, film titles, spaces, or assignees…"
                  value="${ui.esc(searchQuery)}"
                />
                ${searchQuery ? `
                  <button id="task-search-clear" class="absolute inset-y-0 right-0 pr-3 flex items-center text-muted hover:text-ink">
                    ${ui.icon('x', 'w-3.5 h-3.5')}
                  </button>
                ` : ''}
              </div>

              <!-- Quick Filter Chips -->
              <div class="flex items-center gap-1.5 flex-wrap text-xs">
                <button data-quick-filter="all" class="px-2.5 py-1 rounded-md font-semibold transition ${activeAssigneeFilter === 'all' && activeCategoryFilter === 'all' && activeStatusFilter === 'all' ? 'bg-accent text-accent-ink' : 'bg-panel2 text-muted hover:text-ink'}">
                  All (${totalCount})
                </button>
                <button data-quick-filter="me" class="px-2.5 py-1 rounded-md font-semibold transition ${activeAssigneeFilter === 'me' ? 'bg-accent text-accent-ink' : 'bg-panel2 text-muted hover:text-ink'}">
                  Assigned to Me (${myCount})
                </button>
                <button data-quick-filter="dcp" class="px-2.5 py-1 rounded-md font-semibold transition ${activeCategoryFilter === 'Cinema & DCP' ? 'bg-accent text-accent-ink' : 'bg-panel2 text-muted hover:text-ink'}">
                  🎬 Cinema &amp; DCP (${cinemaDcpCount})
                </button>
                <button data-quick-filter="open" class="px-2.5 py-1 rounded-md font-semibold transition ${activeStatusFilter === 'open' ? 'bg-accent text-accent-ink' : 'bg-panel2 text-muted hover:text-ink'}">
                  Open Tasks (${pendingCount + inProgressCount})
                </button>
              </div>
            </div>

            <!-- Dropdown Filter Toolbar -->
            <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2 pt-2 border-t border-line/60 text-xs">
              <!-- Category Filter -->
              <div>
                <label class="block text-[10px] uppercase font-bold text-muted mb-0.5">Category</label>
                <select id="flt-cat" class="field !py-1 text-xs">
                  <option value="all">All Categories</option>
                  ${CATEGORIES.map((c) => `<option value="${c}" ${activeCategoryFilter === c ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
              </div>

              <!-- Status Filter -->
              <div>
                <label class="block text-[10px] uppercase font-bold text-muted mb-0.5">Status</label>
                <select id="flt-status" class="field !py-1 text-xs">
                  <option value="all" ${activeStatusFilter === 'all' ? 'selected' : ''}>All Statuses</option>
                  <option value="open" ${activeStatusFilter === 'open' ? 'selected' : ''}>Open (To Do &amp; In Progress)</option>
                  <option value="Pending" ${activeStatusFilter === 'Pending' ? 'selected' : ''}>Pending / To Do</option>
                  <option value="In Progress" ${activeStatusFilter === 'In Progress' ? 'selected' : ''}>In Progress</option>
                  <option value="Blocked" ${activeStatusFilter === 'Blocked' ? 'selected' : ''}>Blocked</option>
                  <option value="Completed" ${activeStatusFilter === 'Completed' ? 'selected' : ''}>Completed</option>
                </select>
              </div>

              <!-- Space Filter -->
              <div>
                <label class="block text-[10px] uppercase font-bold text-muted mb-0.5">Space</label>
                <select id="flt-space" class="field !py-1 text-xs">
                  <option value="all">All Spaces</option>
                  ${RMTP.SPACES.map((s) => `<option value="${s}" ${activeSpaceFilter === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
              </div>

              <!-- Priority Filter -->
              <div>
                <label class="block text-[10px] uppercase font-bold text-muted mb-0.5">Priority</label>
                <select id="flt-prio" class="field !py-1 text-xs">
                  <option value="all">All Priorities</option>
                  ${PRIORITIES.map((p) => `<option value="${p}" ${activePriorityFilter === p ? 'selected' : ''}>${p}</option>`).join('')}
                </select>
              </div>

              <!-- Assignee Filter -->
              <div class="col-span-2 sm:col-span-1">
                <label class="block text-[10px] uppercase font-bold text-muted mb-0.5">Assignee</label>
                <select id="flt-user" class="field !py-1 text-xs">
                  <option value="all" ${activeAssigneeFilter === 'all' ? 'selected' : ''}>All Technicians</option>
                  <option value="unassigned" ${activeAssigneeFilter === 'unassigned' ? 'selected' : ''}>— Unassigned —</option>
                  ${allUsers.map((u) => `<option value="${u.id}" ${activeAssigneeFilter === u.id ? 'selected' : ''}>${ui.esc(auth.displayName(u))}</option>`).join('')}
                </select>
              </div>
            </div>
          </div>

          <!-- Main View Output: Board or List -->
          <div id="tasks-main-content">
            ${currentViewMode === 'board' ? renderBoardView(filtered) : renderListView(filtered)}
          </div>
        </div>
      `;

      el.innerHTML = html;
      attachEvents();
    }

    /* ---- Render Kanban Board View ---- */
    function renderBoardView(tasks) {
      const columns = [
        { id: 'Pending', label: 'To Do / Pending', color: 'border-t-amber-400', badge: 'bg-amber-400/20 text-amber-400' },
        { id: 'In Progress', label: 'In Progress', color: 'border-t-accent', badge: 'bg-accent/20 text-accent' },
        { id: 'Blocked', label: 'Blocked / On Hold', color: 'border-t-rose-400', badge: 'bg-rose-400/20 text-rose-400' },
        { id: 'Completed', label: 'Completed', color: 'border-t-emerald-400', badge: 'bg-emerald-400/20 text-emerald-400' },
      ];

      return `
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
          ${columns.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col.id);
            return `
              <div class="p-3 rounded-xl bg-panel border border-line ${col.color} border-t-4 flex flex-col min-h-[500px]">
                <!-- Column Header -->
                <div class="flex items-center justify-between pb-2.5 mb-2.5 border-b border-line/60">
                  <span class="text-xs font-bold text-ink">${col.label}</span>
                  <span class="px-2 py-0.2 rounded-full text-[10px] font-mono font-bold ${col.badge}">
                    ${colTasks.length}
                  </span>
                </div>

                <!-- Column Cards -->
                <div class="space-y-2.5 flex-1 overflow-y-auto max-h-[700px] pr-0.5">
                  ${colTasks.length === 0 ? `
                    <div class="p-6 text-center text-xs text-muted italic rounded-lg border border-dashed border-line/60">
                      No jobs in ${col.label.toLowerCase()}
                    </div>
                  ` : colTasks.map((t) => renderCardHtml(t)).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    /* ---- Render Single Task Card ---- */
    function renderCardHtml(t) {
      const me = auth.current();
      const isMine = me && t.assignedTechId === me.id;
      const isComplete = t.status === 'Completed';

      return `
        <div data-task-card="${t.id}" class="p-3.5 rounded-xl border bg-panel2/60 hover:bg-panel2 transition shadow-2xs hover:border-accent cursor-pointer space-y-2.5 group relative select-none">
          <!-- Top Row: Category + Priority -->
          <div class="flex items-center justify-between gap-1 flex-wrap">
            ${getCategoryBadge(t.category)}
            ${getPriorityBadge(t.priority)}
          </div>

          <!-- Title -->
          <div>
            <h4 class="text-xs font-bold text-ink leading-snug group-hover:text-accent transition-colors line-clamp-2">
              ${ui.esc(t.title)}
            </h4>
            ${t.description ? `
              <p class="text-[11px] text-muted line-clamp-2 mt-1 leading-relaxed">
                ${ui.esc(t.description)}
              </p>
            ` : ''}
          </div>

          <!-- Space & Due Details -->
          <div class="flex items-center justify-between gap-2 text-[10px] font-mono text-muted pt-1 border-t border-line/40 flex-wrap">
            <span class="text-ink font-semibold flex items-center gap-1">
              ${ui.icon('mapPin', 'w-3 h-3 text-accent shrink-0')}
              <span class="truncate">${ui.esc(t.space || 'Venue')}</span>
            </span>
            ${t.dueDate ? `
              <span class="flex items-center gap-1 ${t.dueDate < new Date().toISOString().slice(0, 10) && !isComplete ? 'text-rose-400 font-bold' : ''}">
                ${ui.icon('calendar', 'w-3 h-3 shrink-0')}
                <span>${t.dueDate} ${t.dueTime ? t.dueTime : ''}</span>
              </span>
            ` : ''}
          </div>

          <!-- Linked Screening Badge (if created from Pre-Screening Tracker) -->
          ${t.linkedScreeningId ? `
            <div class="p-1.5 rounded bg-accent/10 border border-accent/20 text-[10.5px] text-accent flex items-center justify-between gap-1">
              <span class="flex items-center gap-1 truncate">
                ${ui.icon('film', 'w-3 h-3 shrink-0')}
                <span class="truncate font-semibold">${ui.esc(t.filmTitle || 'Cinema Screening')}</span>
              </span>
              <a href="#/dcp" class="text-[9.5px] underline hover:text-ink shrink-0 font-semibold" title="Jump to Pre-Screening Tracker">View Booth →</a>
            </div>
          ` : ''}

          <!-- Assignee & Quick Actions -->
          <div class="flex items-center justify-between gap-1 pt-1.5 border-t border-line/40 text-[11px]">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="w-5 h-5 rounded-full bg-accent/20 text-accent font-bold text-[9px] flex items-center justify-center shrink-0">
                ${t.assignedTechName ? t.assignedTechName[0].toUpperCase() : '?'}
              </span>
              <span class="text-ink font-medium truncate text-[11px]">
                ${t.assignedTechName ? ui.esc(t.assignedTechName) : '<span class="text-muted italic">Unassigned</span>'}
              </span>
            </div>

            <!-- Quick Action Buttons -->
            <div class="flex items-center gap-1 shrink-0">
              ${!t.assignedTechId && me ? `
                <button type="button" data-claim-task="${t.id}" class="px-2 py-0.5 rounded text-[10px] font-semibold bg-panel border border-line text-accent hover:border-accent transition" title="Assign this task to yourself">
                  Claim
                </button>
              ` : ''}
              ${!isComplete ? `
                <button type="button" data-complete-task="${t.id}" class="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 transition flex items-center gap-1" title="Mark this job complete">
                  ${ui.icon('check', 'w-3 h-3 text-emerald-400')}
                  <span>Done</span>
                </button>
              ` : `
                <span class="text-[10px] text-emerald-400 font-bold">✓ Finished</span>
              `}
            </div>
          </div>
        </div>
      `;
    }

    /* ---- Render Registry Table / List View ---- */
    function renderListView(tasks) {
      if (tasks.length === 0) {
        return `
          <div class="p-12 text-center rounded-xl bg-panel border border-line space-y-3">
            <div class="w-12 h-12 rounded-full bg-panel2 mx-auto flex items-center justify-center text-muted">
              ${ui.icon('list', 'w-6 h-6')}
            </div>
            <div class="text-sm font-semibold text-ink">No assignable jobs match your active filters</div>
            <p class="text-xs text-muted max-w-md mx-auto">
              Try adjusting your category, priority, or assignee filters, or click "+ New Job / Task" to log a new assignable task.
            </p>
          </div>
        `;
      }

      return `
        <div class="overflow-x-auto border border-line rounded-xl bg-panel">
          <table class="w-full text-xs text-left border-collapse">
            <thead>
              <tr class="bg-panel2/60 border-b border-line text-[11px] font-semibold text-muted">
                <th class="p-3 w-10 text-center">Status</th>
                <th class="p-3">Job / Task Title</th>
                <th class="p-3">Category</th>
                <th class="p-3">Space / Room</th>
                <th class="p-3">Priority</th>
                <th class="p-3">Assignee</th>
                <th class="p-3">Due Date</th>
                <th class="p-3">Linked Context</th>
                <th class="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line/60">
              ${tasks.map((t) => {
                const me = auth.current();
                const isComplete = t.status === 'Completed';
                return `
                  <tr class="hover:bg-panel2/40 transition group cursor-pointer" data-task-row="${t.id}">
                    <td class="p-3 text-center" onclick="event.stopPropagation()">
                      <button type="button" data-toggle-complete="${t.id}" class="w-5 h-5 rounded border ${isComplete ? 'bg-emerald-500 border-emerald-500 text-black' : 'border-line hover:border-accent text-transparent'} flex items-center justify-center transition" title="${isComplete ? 'Completed (Click to re-open)' : 'Mark completed'}">
                        ${ui.icon('check', 'w-3.5 h-3.5')}
                      </button>
                    </td>

                    <td class="p-3 font-semibold text-ink">
                      <div class="flex items-center gap-1.5">
                        <span class="group-hover:text-accent transition-colors">${ui.esc(t.title)}</span>
                      </div>
                      ${t.description ? `<div class="text-[11px] text-muted line-clamp-1 font-normal mt-0.5">${ui.esc(t.description)}</div>` : ''}
                    </td>

                    <td class="p-3 whitespace-nowrap">${getCategoryBadge(t.category)}</td>

                    <td class="p-3 font-mono text-accent font-semibold whitespace-nowrap">${ui.esc(t.space || '—')}</td>

                    <td class="p-3 whitespace-nowrap">${getPriorityBadge(t.priority)}</td>

                    <td class="p-3 whitespace-nowrap">
                      ${t.assignedTechName ? `
                        <div class="flex items-center gap-1.5">
                          <span class="w-5 h-5 rounded-full bg-accent/20 text-accent font-bold text-[9px] flex items-center justify-center">
                            ${t.assignedTechName[0].toUpperCase()}
                          </span>
                          <span class="font-medium text-ink">${ui.esc(t.assignedTechName)}</span>
                        </div>
                      ` : `
                        <span class="text-muted italic text-[11px]">Unassigned</span>
                      `}
                    </td>

                    <td class="p-3 font-mono whitespace-nowrap">
                      ${t.dueDate ? `
                        <span class="${t.dueDate < new Date().toISOString().slice(0, 10) && !isComplete ? 'text-rose-400 font-bold' : 'text-muted'}">
                          ${t.dueDate} ${t.dueTime || ''}
                        </span>
                      ` : '—'}
                    </td>

                    <td class="p-3 whitespace-nowrap text-[11px]">
                      ${t.linkedScreeningId ? `
                        <a href="#/dcp" class="inline-flex items-center gap-1 text-accent hover:underline font-semibold" onclick="event.stopPropagation()">
                          ${ui.icon('film', 'w-3 h-3')}
                          <span>${ui.esc(t.filmTitle || 'Screening')}</span>
                        </a>
                      ` : (t.linkedEventId ? '<span class="text-muted font-mono">Adv Event</span>' : '<span class="text-muted">—</span>')}
                    </td>

                    <td class="p-3 text-right whitespace-nowrap" onclick="event.stopPropagation()">
                      <div class="flex items-center justify-end gap-1.5">
                        ${!t.assignedTechId && me ? `
                          <button type="button" data-claim-task="${t.id}" class="px-2 py-0.5 rounded text-[10px] font-semibold bg-panel border border-line text-accent hover:border-accent">
                            Claim
                          </button>
                        ` : ''}
                        <button type="button" data-edit-task="${t.id}" class="btn btn-ghost !p-1 text-xs" title="Edit Job">
                          ${ui.icon('pen', 'w-3.5 h-3.5')}
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    /* ---- Event Listeners & Modals ---- */
    function attachEvents() {
      // View Switcher
      el.querySelector('#view-mode-board')?.addEventListener('click', () => {
        currentViewMode = 'board';
        renderTasksPage();
      });
      el.querySelector('#view-mode-list')?.addEventListener('click', () => {
        currentViewMode = 'list';
        renderTasksPage();
      });

      // Quick Filters
      el.querySelectorAll('[data-quick-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const type = btn.getAttribute('data-quick-filter');
          if (type === 'all') {
            activeCategoryFilter = 'all';
            activeStatusFilter = 'all';
            activeAssigneeFilter = 'all';
            activePriorityFilter = 'all';
          } else if (type === 'me') {
            activeAssigneeFilter = 'me';
          } else if (type === 'dcp') {
            activeCategoryFilter = 'Cinema & DCP';
          } else if (type === 'open') {
            activeStatusFilter = 'open';
          }
          renderTasksPage();
        });
      });

      // Dropdown Filters
      el.querySelector('#flt-cat')?.addEventListener('change', (e) => {
        activeCategoryFilter = e.target.value;
        renderTasksPage();
      });
      el.querySelector('#flt-status')?.addEventListener('change', (e) => {
        activeStatusFilter = e.target.value;
        renderTasksPage();
      });
      el.querySelector('#flt-space')?.addEventListener('change', (e) => {
        activeSpaceFilter = e.target.value;
        renderTasksPage();
      });
      el.querySelector('#flt-prio')?.addEventListener('change', (e) => {
        activePriorityFilter = e.target.value;
        renderTasksPage();
      });
      el.querySelector('#flt-user')?.addEventListener('change', (e) => {
        activeAssigneeFilter = e.target.value;
        renderTasksPage();
      });

      // Search with debounce
      const searchInput = el.querySelector('#task-search-input');
      searchInput?.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        clearTimeout(RMTP._taskSearchTimeout);
        RMTP._taskSearchTimeout = setTimeout(() => renderTasksPage(), 200);
      });
      el.querySelector('#task-search-clear')?.addEventListener('click', () => {
        searchQuery = '';
        renderTasksPage();
      });

      // Create Task Button
      el.querySelector('#btn-create-task')?.addEventListener('click', () => {
        openTaskModal();
      });

      // Claim Task
      el.querySelectorAll('[data-claim-task]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const tid = btn.getAttribute('data-claim-task');
          const task = store.find('tasks', tid);
          const me = auth.current();
          if (task && me) {
            task.assignedTechId = me.id;
            task.assignedTechName = auth.displayName(me);
            task.status = task.status === 'Pending' ? 'In Progress' : task.status;
            task.updatedAt = Date.now();
            store.upsert('tasks', task);
            if (RMTP.syncSb && RMTP.syncSb.drain) RMTP.syncSb.drain();
            ui.toast(`Job claimed! Assigned to ${auth.displayName(me)}`, 'ok');
            renderTasksPage();
          }
        });
      });

      // Mark Complete Quick Action
      el.querySelectorAll('[data-complete-task], [data-toggle-complete]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const tid = btn.getAttribute('data-complete-task') || btn.getAttribute('data-toggle-complete');
          const task = store.find('tasks', tid);
          const me = auth.current();
          if (task) {
            const nextStatus = task.status === 'Completed' ? 'Pending' : 'Completed';
            task.status = nextStatus;
            if (nextStatus === 'Completed') {
              task.completedBy = me ? auth.displayName(me) : 'Staff Tech';
              task.completedAt = new Date().toISOString();
            } else {
              delete task.completedBy;
              delete task.completedAt;
            }
            task.updatedAt = Date.now();
            store.upsert('tasks', task);
            if (RMTP.syncSb && RMTP.syncSb.drain) RMTP.syncSb.drain();
            ui.toast(`Job marked as ${nextStatus}`, 'ok');
            renderTasksPage();
          }
        });
      });

      // Edit / View Card or Row Click
      el.querySelectorAll('[data-task-card], [data-task-row], [data-edit-task]').forEach((itemEl) => {
        itemEl.addEventListener('click', () => {
          const tid = itemEl.getAttribute('data-task-card') || itemEl.getAttribute('data-task-row') || itemEl.getAttribute('data-edit-task');
          const task = store.find('tasks', tid);
          if (task) openTaskModal(task);
        });
      });
    }

    /* ---- Open Task Edit / Creation Modal ---- */
    function openTaskModal(existingTask = null) {
      const isNew = !existingTask;
      const allUsers = store.all('users') || [];
      const allDcps = store.all('dcps') || [];
      const allAdv = (store.all('advancing') || []).filter((e) => !e.deleted);
      const me = auth.current();

      const task = existingTask || {
        id: store.uid('task'),
        title: '',
        category: 'Cinema & DCP',
        space: 'Screen One',
        priority: 'Medium',
        status: 'Pending',
        assignedTechId: me ? me.id : '',
        assignedTechName: me ? auth.displayName(me) : '',
        reportedBy: me ? auth.displayName(me) : 'Staff Tech',
        description: '',
        dueDate: new Date().toISOString().slice(0, 10),
        dueTime: '17:00',
        linkedScreeningId: '',
        linkedEventId: '',
        source: 'manual',
      };

      const m = ui.modal({
        title: isNew ? 'Create New Assignable Job / Task' : 'Edit Job Details · ' + ui.esc(task.title),
        size: 'md:max-w-2xl',
        body: `
          <div class="space-y-4 text-xs">
            <!-- Job Title -->
            <div>
              <label class="block font-semibold text-muted mb-1">Job / Task Title *</label>
              <input id="tk-title" class="field font-semibold text-sm" value="${ui.esc(task.title)}" placeholder="e.g. Screen 1: Align Left Masking &amp; Ingest KDM" />
            </div>

            <!-- Category & Space -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold text-muted mb-1">Category</label>
                <select id="tk-cat" class="field">
                  ${CATEGORIES.map((c) => `<option value="${c}" ${task.category === c ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
              </div>
              <div>
                <label class="block font-semibold text-muted mb-1">Venue Space / Room</label>
                <select id="tk-space" class="field font-semibold">
                  ${RMTP.SPACES.map((s) => `<option value="${s}" ${task.space === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
              </div>
            </div>

            <!-- Priority & Status -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold text-muted mb-1">Priority</label>
                <select id="tk-prio" class="field font-semibold">
                  ${PRIORITIES.map((p) => `<option value="${p}" ${task.priority === p ? 'selected' : ''}>${p}</option>`).join('')}
                </select>
              </div>
              <div>
                <label class="block font-semibold text-muted mb-1">Workflow Status</label>
                <select id="tk-status" class="field font-semibold">
                  ${STATUSES.map((s) => `<option value="${s}" ${task.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
              </div>
            </div>

            <!-- Assignee Picker -->
            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="font-semibold text-muted">Assigned Technician</label>
                ${me ? `
                  <button type="button" id="tk-assign-me" class="text-accent text-[11px] font-semibold hover:underline">
                    Assign to Me (${ui.esc(auth.displayName(me))})
                  </button>
                ` : ''}
              </div>
              <select id="tk-user" class="field font-medium">
                <option value="">— Unassigned (Anyone can claim) —</option>
                ${allUsers.map((u) => `
                  <option value="${u.id}" ${task.assignedTechId === u.id ? 'selected' : ''}>
                    ${ui.esc(auth.displayName(u))} (${ui.esc(u.position || 'Tech')})
                  </option>
                `).join('')}
              </select>
            </div>

            <!-- Due Date & Time -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold text-muted mb-1">Due Date</label>
                <input type="date" id="tk-date" class="field font-mono" value="${task.dueDate || ''}" />
              </div>
              <div>
                <label class="block font-semibold text-muted mb-1">Due Time (Target)</label>
                <input type="time" id="tk-time" class="field font-mono" value="${task.dueTime || '17:00'}" />
              </div>
            </div>

            <!-- Linked Pre-Screening or Event (Optional) -->
            <div>
              <label class="block font-semibold text-muted mb-1">Link to Pre-Screening or Event (Optional)</label>
              <select id="tk-screening" class="field">
                <option value="">— Standalone Task / Not Linked —</option>
                <optgroup label="Cinema Screenings (Pre-Screening Tracker)">
                  ${allDcps.map((d) => `
                    <option value="dcp|${d.id}" ${task.linkedScreeningId === d.id ? 'selected' : ''}>
                      🎬 ${ui.esc(d.filmTitle || d.eventName)} · ${ui.esc(d.screen)} (${d.eventDate || 'No date'})
                    </option>
                  `).join('')}
                </optgroup>
                <optgroup label="Venue Events (Advancing)">
                  ${allAdv.slice(0, 15).map((e) => `
                    <option value="adv|${e.id}" ${task.linkedEventId === e.id ? 'selected' : ''}>
                      📋 ${ui.esc(e.name)} · ${ui.esc(e.space)} (${e.date})
                    </option>
                  `).join('')}
                </optgroup>
              </select>
            </div>

            <!-- Description & Steps -->
            <div>
              <label class="block font-semibold text-muted mb-1">Task Brief &amp; Required Action</label>
              <textarea id="tk-desc" class="field" rows="3" placeholder="Provide step-by-step instructions or notes for the technician…">${ui.esc(task.description || '')}</textarea>
            </div>

            ${task.status === 'Completed' ? `
              <div class="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-300">
                Completed by <strong>${ui.esc(task.completedBy || 'Staff Tech')}</strong> on ${task.completedAt ? new Date(task.completedAt).toLocaleString('en-GB') : 'recently'}.
              </div>
            ` : ''}
          </div>
        `,
        footer: [
          ...(!isNew ? ['<button type="button" id="tk-delete" class="btn btn-danger mr-auto">Delete Task</button>'] : []),
          '<button type="button" class="btn btn-ghost" data-close>Cancel</button>',
          '<button type="button" id="tk-save" class="btn btn-primary" data-primary>Save Job</button>',
        ].join(''),
        actions: [
          ...(!isNew ? ['<button type="button" id="tk-delete" class="btn btn-danger mr-auto">Delete Task</button>'] : []),
          '<button type="button" class="btn btn-ghost" data-close>Cancel</button>',
          '<button type="button" id="tk-save" class="btn btn-primary" data-primary>Save Job</button>',
        ]
      });

      // Quick Assign to Me button
      m.root.querySelector('#tk-assign-me')?.addEventListener('click', () => {
        if (me) {
          const userSel = m.root.querySelector('#tk-user');
          if (userSel) userSel.value = me.id;
        }
      });

      // Save handler
      m.root.querySelector('#tk-save')?.addEventListener('click', () => {
        const titleVal = m.root.querySelector('#tk-title').value.trim();
        if (!titleVal) {
          ui.toast('Job title is required', 'danger');
          m.root.querySelector('#tk-title').focus();
          return;
        }

        const userSel = m.root.querySelector('#tk-user');
        const assignedId = userSel.value;
        const assignedObj = assignedId ? store.find('users', assignedId) : null;

        const linkVal = m.root.querySelector('#tk-screening').value;
        let linkedScreeningId = '';
        let linkedEventId = '';
        let filmTitle = '';

        if (linkVal) {
          const [prefix, id] = linkVal.split('|');
          if (prefix === 'dcp') {
            linkedScreeningId = id;
            const d = store.find('dcps', id);
            if (d) filmTitle = d.filmTitle || d.eventName;
          } else if (prefix === 'adv') {
            linkedEventId = id;
            const ev = store.find('advancing', id);
            if (ev) filmTitle = ev.name;
          }
        }

        const newStatus = m.root.querySelector('#tk-status').value;

        task.title = titleVal;
        task.category = m.root.querySelector('#tk-cat').value;
        task.space = m.root.querySelector('#tk-space').value;
        task.priority = m.root.querySelector('#tk-prio').value;
        task.status = newStatus;
        task.assignedTechId = assignedId;
        task.assignedTechName = assignedObj ? auth.displayName(assignedObj) : '';
        task.dueDate = m.root.querySelector('#tk-date').value;
        task.dueTime = m.root.querySelector('#tk-time').value;
        task.description = m.root.querySelector('#tk-desc').value.trim();
        task.linkedScreeningId = linkedScreeningId;
        task.linkedEventId = linkedEventId;
        if (filmTitle) task.filmTitle = filmTitle;

        if (newStatus === 'Completed' && !task.completedAt) {
          task.completedBy = me ? auth.displayName(me) : 'Staff Tech';
          task.completedAt = new Date().toISOString();
        } else if (newStatus !== 'Completed') {
          delete task.completedBy;
          delete task.completedAt;
        }

        task.updatedAt = Date.now();
        store.upsert('tasks', task);

        // If linked to a screening, update screening record as well
        if (linkedScreeningId) {
          const sc = store.find('dcps', linkedScreeningId);
          if (sc) {
            sc.linkedTaskId = task.id;
            sc.hasFurtherAction = true;
            sc.furtherAction = task.description || task.title;
            store.upsert('dcps', sc);
          }
        }

        if (RMTP.syncSb && RMTP.syncSb.drain) RMTP.syncSb.drain();
        ui.toast(isNew ? 'New task created successfully' : 'Task details updated', 'ok');
        m.close();
        renderTasksPage();
      });

      // Delete handler
      const delBtn = m.root.querySelector('#tk-delete');
      if (delBtn) {
        delBtn.addEventListener('click', () => {
          store.remove('tasks', task.id);
          if (RMTP.syncSb && RMTP.syncSb.drain) RMTP.syncSb.drain();
          ui.toast('Task deleted', 'info');
          m.close();
          renderTasksPage();
        });
      }
    }

    renderTasksPage();
  };
})();
