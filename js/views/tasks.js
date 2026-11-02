/* ============================================================
   views/tasks.js — full page view of all assignable jobs & tasks
   ------------------------------------------------------------
   Centralized queue for all operational venue tasks, including:
   - Cinema & DCP Pre-Screening follow-up actions
   - Advancing event preparation & technician duties
   - Maintenance & repair actions
   - Space & stage prep jobs
   - Tagged technician assignments & freelancer to-dos
   ============================================================ */
window.RMTP = window.RMTP || {};

(function () {
  const store = RMTP.store;
  const ui = RMTP.ui;
  const auth = RMTP.auth;

  const CATEGORIES = ['Cinema & DCP', 'Sound', 'Lighting', 'AV', 'Stage', 'General', 'Maintenance'];
  const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'];
  const STATUSES = ['Pending', 'In Progress', 'Blocked', 'Completed'];

  const SEED_TITLES = [
    'Past Lives: Verify 5.1 Center Channel Dialogue Anchor',
    'Anatomy of a Fall: Ingest Updated CPL & Supplemental Subtitle Pack',
    'Screen 1: Projector Optical Glass & Intake Filter Clean',
    'The Stage: Radio Mic Frequency Scan & Battery Stock Replenish',
    'Screen 3: Reset Side Masking Limits for Flat (1.85:1) Aspect',
    'Screen One — Pre-Screening Follow-up',
    'Screen Two — Pre-Screening Follow-up',
    'Screen Three — Pre-Screening Follow-up',
    'Past Lives — Pre-Screening Follow-up',
    'Anatomy of a Fall — Pre-Screening Follow-up'
  ];

  function isPlaceholderTask(t) {
    if (!t) return false;
    const id = String(t.id || '');
    if (id.startsWith('task-seed-') || id.startsWith('seed-') || id.startsWith('task-demo-')) return true;
    if (t.isSeed === true || t.isPlaceholder === true) return true;
    const title = (t.title || '').trim();
    if (SEED_TITLES.some(st => title.toLowerCase() === st.toLowerCase())) return true;
    if (/verify 5\.1 center channel|ingest updated cpl|optical glass & intake filter|frequency scan & battery stock|side masking limits/i.test(title)) return true;
    return false;
  }

  /* ---- Cleanup Any Old Placeholder Seed Items ---- */
  function purgePlaceholderSeeds() {
    const tasks = store.all('tasks') || [];
    let purged = false;
    tasks.forEach((t) => {
      if (isPlaceholderTask(t) || (store.isDeleted && store.isDeleted('tasks', t.id))) {
        if (store.markDeleted) store.markDeleted('tasks', t.id);
        store.remove('tasks', t.id);
        if (RMTP.supabase && RMTP.supabase.deleteRow) {
          RMTP.supabase.deleteRow('tasks', t.id).catch(() => {});
        }
        purged = true;
      }
    });

    if (purged && RMTP.syncSb && RMTP.syncSb.drain) {
      RMTP.syncSb.drain();
    }
  }

  // Scrub immediately on file execution
  try { purgePlaceholderSeeds(); } catch (e) {}

  /* ---- Helper: Check if a user is assigned or tagged in a task ---- */
  function isUserAssignedOrTagged(task, user) {
    if (!task || !user) return false;
    const uid = user.id;
    const uEmail = user.email || '';
    const uFirst = (user.firstName || '').toLowerCase();
    const uFull = auth.displayName(user).toLowerCase();

    // 1. Direct assignee
    if (task.assignedTechId === uid || (task.assignedTechName && task.assignedTechName.toLowerCase() === uFull)) {
      return true;
    }

    // 2. Tagged users array
    if (Array.isArray(task.taggedUserIds) && task.taggedUserIds.includes(uid)) {
      return true;
    }
    if (Array.isArray(task.taggedUserNames) && task.taggedUserNames.some(name => name.toLowerCase() === uFull)) {
      return true;
    }

    // 3. Mentions in description or title e.g. @Alex or @Sam
    if (uFirst && (task.description || task.title)) {
      const text = ((task.title || '') + ' ' + (task.description || '')).toLowerCase();
      if (text.includes('@' + uFirst)) return true;
    }

    // 4. Linked advancing event crew
    if (task.linkedEventId) {
      const ev = store.find('advancing', task.linkedEventId);
      if (ev) {
        if (ev.techUserId === uid) return true;
        const techs = Array.isArray(ev.technicians) ? ev.technicians : [];
        if (techs.some(t => t.id === uid || t.email === uEmail || (t.name && t.name.toLowerCase() === uFull))) {
          return true;
        }
      }
    }

    return false;
  }

  /* ---- Bi-directional Sync: Sync Task to Other Sections ---- */
  function syncTaskToOtherSections(task) {
    if (!task) return;

    // 1. If linked to an Advancing Event
    if (task.linkedEventId) {
      const ev = store.find('advancing', task.linkedEventId);
      if (ev) {
        let changed = false;
        let taskIds = Array.isArray(ev.linked_task_ids) ? ev.linked_task_ids.slice() : [];
        if (!taskIds.includes(task.id)) {
          taskIds.push(task.id);
          ev.linked_task_ids = taskIds;
          changed = true;
        }
        if (changed) {
          store.upsert('advancing', ev);
        }
      }
    }

    // 2. If linked to a Cinema Pre-Screening Tracker entry
    if (task.linkedScreeningId) {
      const screening = store.find('dcps', task.linkedScreeningId);
      if (screening) {
        let changed = false;
        if (screening.linkedTaskId !== task.id) {
          screening.linkedTaskId = task.id;
          changed = true;
        }
        if (task.status === 'Completed') {
          // If the task was completed, clear further action flag or mark handled
          if (screening.hasFurtherAction) {
            screening.hasFurtherAction = false;
            changed = true;
          }
        } else {
          if (!screening.hasFurtherAction) {
            screening.hasFurtherAction = true;
            screening.furtherAction = task.description || task.title;
            changed = true;
          }
        }
        if (changed) {
          store.upsert('dcps', screening);
          if (RMTP.syncDcpToAdvance) RMTP.syncDcpToAdvance(screening);
        }
      }
    }

    // 3. If linked to a Maintenance Fault ticket
    if (task.linkedFaultId) {
      const fault = store.find('maintenance', task.linkedFaultId);
      if (fault) {
        let changed = false;
        if (task.status === 'Completed' && fault.status !== 'Resolved') {
          fault.status = 'Resolved';
          fault.resolvedAt = new Date().toISOString();
          fault.resolvedBy = task.completedBy || auth.displayName(auth.current()) || 'Staff Tech';
          fault.resolution = 'Resolved via Jobs List: ' + (task.description || task.title);
          changed = true;

          // Bi-directional restoration: Restore linked inventory item from Damaged to Good
          if (fault.itemId) {
            const item = store.find('inventory', fault.itemId);
            if (item) {
              const now = new Date().toISOString();
              const returnLoc = fault.previousLocation || item.previousLocation || item.originLocation || item.location || 'Store A';
              const targetLoc = returnLoc === 'SERVICE' ? 'Store A' : returnLoc;
              const movements = (item.movements || []).concat({
                from: item.location || 'SERVICE',
                to: targetLoc,
                at: now,
                by: fault.resolvedBy,
                note: 'Fault repaired via Jobs List (' + task.id + '): ' + (task.description || task.title)
              });
              store.upsert('inventory', Object.assign({}, item, {
                condition: 'Good',
                status: 'in',
                location: targetLoc,
                heldBy: '',
                outAt: '',
                movements: movements
              }));
            }
          }
        } else if (task.status !== 'Completed' && fault.status === 'Resolved') {
          fault.status = 'In Progress';
          changed = true;
        }
        if (changed) {
          store.upsert('maintenance', fault);
        }
      }
    }

    if (RMTP.syncSb && RMTP.syncSb.drain) {
      RMTP.syncSb.drain();
    }
  }

  /* ---- Public RMTP.tasks API for other sections to query & invoke ---- */
  RMTP.tasks = {
    all: function () {
      purgePlaceholderSeeds();
      return (store.all('tasks') || []).filter(t => !isPlaceholderTask(t) && !(store.isDeleted && store.isDeleted('tasks', t.id)));
    },
    delete: function (taskId, onDeleted) {
      if (!taskId) return;
      if (store.markDeleted) store.markDeleted('tasks', taskId);
      store.remove('tasks', taskId);
      if (RMTP.supabase && RMTP.supabase.deleteRow) {
        RMTP.supabase.deleteRow('tasks', taskId).catch(() => {});
      }
      if (RMTP.syncSb && RMTP.syncSb.drain) RMTP.syncSb.drain();
      if (RMTP.shell && RMTP.shell.renderNavigation) RMTP.shell.renderNavigation();
      if (typeof onDeleted === 'function') onDeleted();
    },
    forEvent: function (eventId) {
      if (!eventId) return [];
      return (store.all('tasks') || []).filter(t => t.linkedEventId === eventId);
    },
    forScreening: function (screeningId) {
      if (!screeningId) return [];
      return (store.all('tasks') || []).filter(t => t.linkedScreeningId === screeningId);
    },
    forMaintenance: function (faultId) {
      if (!faultId) return [];
      return (store.all('tasks') || []).filter(t => t.linkedFaultId === faultId);
    },
    forSpace: function (spaceName) {
      if (!spaceName) return [];
      return (store.all('tasks') || []).filter(t => t.space === spaceName);
    },
    forUser: function (user) {
      if (!user) return [];
      return (store.all('tasks') || []).filter(t => isUserAssignedOrTagged(t, user));
    },
    openModal: function (existingTask, defaults, onSaved) {
      openTaskModal(existingTask, defaults, onSaved);
    },
    toggleCompleted: function (taskId, onComplete) {
      const task = store.find('tasks', taskId);
      if (!task) return;
      const me = auth.current();
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
      syncTaskToOtherSections(task);
      if (RMTP.shell && RMTP.shell.renderNavigation) RMTP.shell.renderNavigation();
      if (typeof onComplete === 'function') onComplete(task);
    }
  };

  /* ---- Priority UI Styling ---- */
  function getPriorityBadge(priority) {
    const p = String(priority || 'Medium').toLowerCase();
    if (p === 'urgent') {
      return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">' +
        ui.icon('alert', 'w-3 h-3 text-rose-400') + '<span>Urgent</span></span>';
    }
    if (p === 'high') {
      return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">' +
        '<span>High</span></span>';
    }
    if (p === 'low') {
      return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-panel border border-line text-muted">' +
        '<span>Low</span></span>';
    }
    return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/30">' +
      '<span>Medium</span></span>';
  }

  function getCategoryBadge(cat) {
    const c = String(cat || 'General');
    let colorClass = 'bg-accent/10 text-accent border-accent/25';
    let iconKey = 'clip';
    if (c.includes('Cinema') || c.includes('DCP')) {
      colorClass = 'bg-purple-500/15 text-purple-300 border-purple-500/30';
      iconKey = 'film';
    } else if (c.includes('Sound')) {
      colorClass = 'bg-sky-500/15 text-sky-300 border-sky-500/30';
      iconKey = 'volume';
    } else if (c.includes('Lighting')) {
      colorClass = 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      iconKey = 'bulb';
    } else if (c.includes('AV')) {
      colorClass = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
      iconKey = 'screen';
    } else if (c.includes('Maintenance')) {
      colorClass = 'bg-rose-500/15 text-rose-300 border-rose-500/30';
      iconKey = 'wrench';
    }
    return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ' + colorClass + '">' +
      ui.icon(iconKey, 'w-3 h-3') + '<span>' + ui.esc(c) + '</span></span>';
  }

  /* ---- Main View Controller ---- */
  RMTP.views.tasks = function (el, params, query) {
    purgePlaceholderSeeds();

    // View state
    let currentViewMode = 'board'; // 'board' (kanban) | 'list' (tabular)
    let activeCategoryFilter = 'all';
    let activeStatusFilter = 'all';
    let activePriorityFilter = 'all';
    let activeSpaceFilter = 'all';
    let activeAssigneeFilter = 'all'; // 'all', 'me', 'unassigned', or specific userId
    let searchQuery = '';

    // If query has specific filter e.g. #/tasks?assignee=me or #/tasks?event=xyz
    if (query && query.assignee === 'me') {
      activeAssigneeFilter = 'me';
    }
    if (query && query.space) {
      activeSpaceFilter = query.space;
    }
    if (query && query.event) {
      searchQuery = query.event;
    }

    function renderTasksPage() {
      purgePlaceholderSeeds();
      const allTasks = (store.all('tasks') || []).filter(t => !isPlaceholderTask(t) && !(store.isDeleted && store.isDeleted('tasks', t.id)));
      const me = auth.current();

      // Filter tasks
      let filtered = allTasks.slice();

      if (activeCategoryFilter !== 'all') {
        filtered = filtered.filter(t => t.category === activeCategoryFilter);
      }
      if (activeSpaceFilter !== 'all') {
        filtered = filtered.filter(t => t.space === activeSpaceFilter);
      }
      if (activePriorityFilter !== 'all') {
        filtered = filtered.filter(t => t.priority === activePriorityFilter);
      }
      if (activeStatusFilter !== 'all') {
        filtered = filtered.filter(t => t.status === activeStatusFilter);
      }

      // Assignee / Tagged Filter
      if (activeAssigneeFilter === 'me') {
        if (me) {
          filtered = filtered.filter(t => isUserAssignedOrTagged(t, me));
        }
      } else if (activeAssigneeFilter === 'unassigned') {
        filtered = filtered.filter(t => !t.assignedTechId);
      } else if (activeAssigneeFilter !== 'all') {
        filtered = filtered.filter(t => t.assignedTechId === activeAssigneeFilter || (Array.isArray(t.taggedUserIds) && t.taggedUserIds.includes(activeAssigneeFilter)));
      }

      // Search Query Filter
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        filtered = filtered.filter(t =>
          (t.title && t.title.toLowerCase().includes(q)) ||
          (t.description && t.description.toLowerCase().includes(q)) ||
          (t.space && t.space.toLowerCase().includes(q)) ||
          (t.filmTitle && t.filmTitle.toLowerCase().includes(q)) ||
          (t.linkedEventName && t.linkedEventName.toLowerCase().includes(q)) ||
          (t.assignedTechName && t.assignedTechName.toLowerCase().includes(q)) ||
          (Array.isArray(t.taggedUserNames) && t.taggedUserNames.some(name => name.toLowerCase().includes(q)))
        );
      }

      // Chronological sort
      filtered.sort((a, b) => {
        if (a.status === 'Completed' && b.status !== 'Completed') return 1;
        if (b.status === 'Completed' && a.status !== 'Completed') return -1;
        const da = (a.dueDate || '9999-99-99') + ' ' + (a.dueTime || '99:99');
        const db = (b.dueDate || '9999-99-99') + ' ' + (b.dueTime || '99:99');
        return da.localeCompare(db);
      });

      // KPI stats
      const totalCount = allTasks.length;
      const openCount = allTasks.filter(t => t.status !== 'Completed').length;
      const myCount = me ? allTasks.filter(t => t.status !== 'Completed' && isUserAssignedOrTagged(t, me)).length : 0;
      const urgentCount = allTasks.filter(t => t.status !== 'Completed' && (t.priority === 'Urgent' || t.priority === 'High')).length;
      const completedCount = allTasks.filter(t => t.status === 'Completed').length;

      const allUsers = store.all('users') || [];

      el.innerHTML =
        '<div class="space-y-6 w-full max-w-full pb-16">' +
          // Header
          '<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-line">' +
            '<div>' +
              '<div class="flex items-center gap-2.5">' +
                '<h1 class="text-2xl font-bold font-display text-ink tracking-tight flex items-center gap-2">' +
                  ui.icon('list', 'w-6 h-6 text-accent') +
                  '<span>Jobs &amp; Tasks</span>' +
                '</h1>' +
                '<span class="px-2 py-0.5 rounded text-xs font-mono font-semibold bg-accent/15 text-accent border border-accent/30">Venue Registry</span>' +
                (myCount > 0 ? ('<span class="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">' + myCount + ' assigned/tagged to you</span>') : '') +
              '</div>' +
              '<p class="text-xs text-muted mt-1">' +
                'Full page view of assignable jobs and technical follow-ups across Screenings, Advancing Events, Maintenance, and Stage Prep.' +
              '</p>' +
            '</div>' +

            '<div class="flex items-center gap-2 shrink-0 flex-wrap">' +
              // View switcher (Kanban / Table)
              '<div class="flex items-center p-1 bg-panel2 rounded-lg border border-line text-xs">' +
                '<button type="button" id="btn-view-board" class="px-2.5 py-1 rounded font-semibold transition flex items-center gap-1.5 ' +
                  (currentViewMode === 'board' ? 'bg-accent text-accent-ink shadow-2xs' : 'text-muted hover:text-ink') + '">' +
                  ui.icon('grid', 'w-3.5 h-3.5') + '<span>Board</span>' +
                '</button>' +
                '<button type="button" id="btn-view-list" class="px-2.5 py-1 rounded font-semibold transition flex items-center gap-1.5 ' +
                  (currentViewMode === 'list' ? 'bg-accent text-accent-ink shadow-2xs' : 'text-muted hover:text-ink') + '">' +
                  ui.icon('list', 'w-3.5 h-3.5') + '<span>List</span>' +
                '</button>' +
              '</div>' +
              '<button type="button" id="btn-create-task" class="btn btn-primary text-xs flex items-center gap-1.5 font-semibold shadow-2xs">' +
                ui.icon('plus', 'w-4 h-4') + '<span>New Job / Task</span>' +
              '</button>' +
            '</div>' +
          '</div>' +

          // KPI Strip
          '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">' +
            '<div class="p-3.5 rounded-xl bg-panel border border-line cursor-pointer hover:border-accent transition" id="card-stat-open">' +
              '<div class="text-[11px] font-mono uppercase tracking-wider text-muted">Open Venue Jobs</div>' +
              '<div class="text-2xl font-bold font-mono text-ink mt-1 tabular-nums">' + openCount + '</div>' +
              '<div class="text-[11px] text-muted mt-1">' + totalCount + ' total logged \u00b7 ' + completedCount + ' completed</div>' +
            '</div>' +

            '<div class="p-3.5 rounded-xl bg-panel border ' + (myCount > 0 ? 'border-accent/40 bg-accent/5' : 'border-line') + ' cursor-pointer hover:border-accent transition" id="card-stat-mine">' +
              '<div class="text-[11px] font-mono uppercase tracking-wider ' + (myCount > 0 ? 'text-accent font-bold' : 'text-muted') + '">Assigned / Tagged to Me</div>' +
              '<div class="text-2xl font-bold font-mono ' + (myCount > 0 ? 'text-accent' : 'text-ink') + ' mt-1 tabular-nums">' + myCount + '</div>' +
              '<div class="text-[11px] text-muted mt-1">' + (me ? auth.displayName(me) : 'Sign in to check') + '</div>' +
            '</div>' +

            '<div class="p-3.5 rounded-xl bg-panel border ' + (urgentCount > 0 ? 'border-rose-500/40 bg-rose-500/5' : 'border-line') + ' cursor-pointer hover:border-rose-500 transition" id="card-stat-urgent">' +
              '<div class="text-[11px] font-mono uppercase tracking-wider ' + (urgentCount > 0 ? 'text-rose-400 font-bold' : 'text-muted') + '">Urgent &amp; High Priority</div>' +
              '<div class="text-2xl font-bold font-mono ' + (urgentCount > 0 ? 'text-rose-400' : 'text-ink') + ' mt-1 tabular-nums">' + urgentCount + '</div>' +
              '<div class="text-[11px] text-muted mt-1">Require immediate attention</div>' +
            '</div>' +

            '<div class="p-3.5 rounded-xl bg-panel border border-line cursor-pointer hover:border-emerald-500 transition" id="card-stat-done">' +
              '<div class="text-[11px] font-mono uppercase tracking-wider text-emerald-400">Completed &amp; Signed Off</div>' +
              '<div class="text-2xl font-bold font-mono text-emerald-400 mt-1 tabular-nums">' + completedCount + '</div>' +
              '<div class="text-[11px] text-muted mt-1">Archived in registry</div>' +
            '</div>' +
          '</div>' +

          // Filter Controls Strip
          '<div class="p-4 rounded-xl bg-panel border border-line space-y-3">' +
            '<div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3">' +
              // Search Bar
              '<div class="relative flex-1">' +
                '<span class="absolute left-3 top-2.5 text-muted pointer-events-none">' +
                  ui.icon('search', 'w-4 h-4') +
                '</span>' +
                '<input id="task-search-input" class="field pl-9 text-xs" placeholder="Search tasks by title, space, film, description, or tagged technician\u2026" value="' + ui.esc(searchQuery) + '" />' +
              '</div>' +

              // Quick "Assigned / Tagged to Me" button
              '<div class="flex items-center gap-2 shrink-0">' +
                '<button type="button" id="btn-quick-mine" class="btn text-xs font-semibold flex items-center gap-1.5 ' +
                  (activeAssigneeFilter === 'me' ? 'btn-primary' : 'btn-ghost border border-line') + '">' +
                  ui.icon('user', 'w-3.5 h-3.5') +
                  '<span>Assigned &amp; Tagged to Me</span>' +
                  (myCount > 0 ? ('<span class="px-1.5 py-0.2 rounded-full text-[10px] bg-white/20 font-mono font-bold">' + myCount + '</span>') : '') +
                '</button>' +
                (activeCategoryFilter !== 'all' || activeSpaceFilter !== 'all' || activePriorityFilter !== 'all' || activeStatusFilter !== 'all' || activeAssigneeFilter !== 'all' || searchQuery ? (
                  '<button type="button" id="btn-reset-filters" class="text-xs text-muted hover:text-ink underline flex items-center gap-1">' +
                    ui.icon('reset', 'w-3 h-3') + 'Reset' +
                  '</button>'
                ) : '') +
              '</div>' +
            '</div>' +

            // Second row of dropdown filters
            '<div class="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-2 border-t border-line/60 text-xs">' +
              '<div>' +
                '<label class="block text-[10px] font-mono text-muted uppercase mb-1">Category</label>' +
                '<select id="filter-cat" class="field text-xs !py-1">' +
                  '<option value="all">All Categories</option>' +
                  CATEGORIES.map(c => '<option value="' + c + '" ' + (activeCategoryFilter === c ? 'selected' : '') + '>' + c + '</option>').join('') +
                '</select>' +
              '</div>' +

              '<div>' +
                '<label class="block text-[10px] font-mono text-muted uppercase mb-1">Space</label>' +
                '<select id="filter-space" class="field text-xs !py-1">' +
                  '<option value="all">All Spaces</option>' +
                  RMTP.SPACES.map(s => '<option value="' + s + '" ' + (activeSpaceFilter === s ? 'selected' : '') + '>' + s + '</option>').join('') +
                '</select>' +
              '</div>' +

              '<div>' +
                '<label class="block text-[10px] font-mono text-muted uppercase mb-1">Priority</label>' +
                '<select id="filter-priority" class="field text-xs !py-1">' +
                  '<option value="all">All Priorities</option>' +
                  PRIORITIES.map(p => '<option value="' + p + '" ' + (activePriorityFilter === p ? 'selected' : '') + '>' + p + '</option>').join('') +
                '</select>' +
              '</div>' +

              '<div>' +
                '<label class="block text-[10px] font-mono text-muted uppercase mb-1">Status</label>' +
                '<select id="filter-status" class="field text-xs !py-1">' +
                  '<option value="all">All Statuses</option>' +
                  STATUSES.map(s => '<option value="' + s + '" ' + (activeStatusFilter === s ? 'selected' : '') + '>' + s + '</option>').join('') +
                '</select>' +
              '</div>' +

              '<div>' +
                '<label class="block text-[10px] font-mono text-muted uppercase mb-1">Technician</label>' +
                '<select id="filter-assignee" class="field text-xs !py-1">' +
                  '<option value="all">All Technicians</option>' +
                  '<option value="me" ' + (activeAssigneeFilter === 'me' ? 'selected' : '') + '>★ Assigned &amp; Tagged to Me</option>' +
                  '<option value="unassigned" ' + (activeAssigneeFilter === 'unassigned' ? 'selected' : '') + '>Unassigned (Open to Claim)</option>' +
                  allUsers.map(u => '<option value="' + u.id + '" ' + (activeAssigneeFilter === u.id ? 'selected' : '') + '>' + ui.esc(auth.displayName(u)) + '</option>').join('') +
                '</select>' +
              '</div>' +
            '</div>' +
          '</div>' +

          // Main View Content Container (Kanban Board or Table List)
          '<div id="tasks-content-area">' +
            (currentViewMode === 'board' ? renderBoardView(filtered) : renderListView(filtered)) +
          '</div>' +
        '</div>';

      wirePageEvents(filtered);
    }

    /* ---- Render Kanban Board View ---- */
    function renderBoardView(tasks) {
      if (tasks.length === 0) {
        return renderEmptyState();
      }

      const columns = [
        { id: 'Pending', label: 'Pending', color: 'border-amber-500/30 text-amber-300' },
        { id: 'In Progress', label: 'In Progress', color: 'border-blue-500/30 text-blue-300' },
        { id: 'Blocked', label: 'Blocked', color: 'border-rose-500/30 text-rose-300' },
        { id: 'Completed', label: 'Completed', color: 'border-emerald-500/30 text-emerald-300' }
      ];

      return (
        '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start">' +
          columns.map((col) => {
            const colTasks = tasks.filter(t => (t.status || 'Pending') === col.id);
            return (
              '<div class="rounded-xl border border-line bg-panel p-3.5 space-y-3 flex flex-col min-h-[400px]">' +
                '<div class="flex items-center justify-between pb-2 border-b border-line">' +
                  '<div class="flex items-center gap-2">' +
                    '<span class="text-xs font-bold text-ink uppercase tracking-wider">' + col.label + '</span>' +
                    '<span class="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold border ' + col.color + '">' +
                      colTasks.length +
                    '</span>' +
                  '</div>' +
                  (col.id === 'Pending' ? (
                    '<button type="button" data-quick-add-col="' + col.id + '" class="text-muted hover:text-accent p-1" title="Add task in this column">' +
                      ui.icon('plus', 'w-3.5 h-3.5') +
                    '</button>'
                  ) : '') +
                '</div>' +

                '<div class="space-y-2.5 flex-1 overflow-y-auto max-h-[700px] pr-0.5">' +
                  (colTasks.length === 0 ? (
                    '<div class="p-6 text-center text-xs text-muted italic rounded-lg border border-dashed border-line/60">' +
                      'No jobs in ' + col.label.toLowerCase() +
                    '</div>'
                  ) : colTasks.map(t => renderCardHtml(t)).join('')) +
                '</div>' +
              '</div>'
            );
          }).join('') +
        '</div>'
      );
    }

    /* ---- Render Single Task Card ---- */
    function renderCardHtml(t) {
      const me = auth.current();
      const isMine = me && isUserAssignedOrTagged(t, me);
      const isComplete = t.status === 'Completed';

      // Build Tagged Users Badges
      let taggedBadgesHtml = '';
      if (Array.isArray(t.taggedUserNames) && t.taggedUserNames.length > 0) {
        taggedBadgesHtml = '<div class="flex items-center gap-1 flex-wrap text-[10px] text-muted">' +
          '<span class="text-muted/70 font-semibold">Tagged:</span>' +
          t.taggedUserNames.map(name => '<span class="px-1.5 py-0.2 rounded bg-accent/10 text-accent font-medium">@' + ui.esc(name) + '</span>').join('') +
          '</div>';
      }

      return (
        '<div data-task-card="' + t.id + '" class="p-3.5 rounded-xl border bg-panel2/60 hover:bg-panel2 transition shadow-2xs hover:border-accent cursor-pointer space-y-2.5 group relative select-none ' + (isMine ? 'ring-1 ring-accent/30' : '') + '">' +
          // Top Row: Category + Priority
          '<div class="flex items-center justify-between gap-1 flex-wrap">' +
            getCategoryBadge(t.category) +
            getPriorityBadge(t.priority) +
          '</div>' +

          // Title & Description
          '<div>' +
            '<h4 class="text-xs font-bold text-ink leading-snug group-hover:text-accent transition-colors line-clamp-2">' +
              ui.esc(t.title) +
            '</h4>' +
            (t.description ? (
              '<p class="text-[11px] text-muted line-clamp-2 mt-1 leading-relaxed">' +
                ui.esc(t.description) +
              '</p>'
            ) : '') +
          '</div>' +

          // Tagged Users (if any)
          taggedBadgesHtml +

          // Space & Due Details
          '<div class="flex items-center justify-between gap-2 text-[10px] font-mono text-muted pt-1 border-t border-line/40 flex-wrap">' +
            '<span class="text-ink font-semibold flex items-center gap-1">' +
              ui.icon('mapPin', 'w-3 h-3 text-accent shrink-0') +
              '<span class="truncate">' + ui.esc(t.space || 'Venue') + '</span>' +
            '</span>' +
            (t.dueDate ? (
              '<span class="flex items-center gap-1 ' + (t.dueDate < new Date().toISOString().slice(0, 10) && !isComplete ? 'text-rose-400 font-bold' : '') + '">' +
                ui.icon('calendar', 'w-3 h-3 shrink-0') +
                '<span>' + t.dueDate + (t.dueTime ? (' ' + t.dueTime) : '') + '</span>' +
              '</span>'
            ) : '') +
          '</div>' +

          // Cross-Section Bi-directional Badges
          // 1. Linked Cinema Screening
          (t.linkedScreeningId ? (
            '<div class="p-1.5 rounded bg-purple-500/10 border border-purple-500/20 text-[10.5px] text-purple-300 flex items-center justify-between gap-1">' +
              '<span class="flex items-center gap-1 truncate">' +
                ui.icon('film', 'w-3 h-3 text-purple-400 shrink-0') +
                '<span class="truncate font-semibold">' + ui.esc(t.filmTitle || 'Cinema Screening') + '</span>' +
              '</span>' +
              '<a href="#/dcp?id=' + encodeURIComponent(t.linkedScreeningId) + '" class="text-[9.5px] underline hover:text-ink shrink-0 font-semibold" title="Jump to Pre-Screening Tracker">View Booth \u2192</a>' +
            '</div>'
          ) : '') +

          // 2. Linked Advancing Event
          (t.linkedEventId ? (
            '<div class="p-1.5 rounded bg-accent/10 border border-accent/20 text-[10.5px] text-accent flex items-center justify-between gap-1">' +
              '<span class="flex items-center gap-1 truncate">' +
                ui.icon('clip', 'w-3 h-3 shrink-0') +
                '<span class="truncate font-semibold">' + ui.esc(t.filmTitle || t.linkedEventName || 'Advancing Event') + '</span>' +
              '</span>' +
              '<a href="#/advancing?id=' + encodeURIComponent(t.linkedEventId) + '" class="text-[9.5px] underline hover:text-ink shrink-0 font-semibold" title="Jump to Advancing Event">View Event \u2192</a>' +
            '</div>'
          ) : '') +

          // 3. Linked Maintenance Fault
          (t.linkedFaultId ? (
            '<div class="p-1.5 rounded bg-rose-500/10 border border-rose-500/20 text-[10.5px] text-rose-300 flex items-center justify-between gap-1">' +
              '<span class="flex items-center gap-1 truncate">' +
                ui.icon('wrench', 'w-3 h-3 text-rose-400 shrink-0') +
                '<span class="truncate font-semibold">' + ui.esc(t.filmTitle || 'Equipment Fault') + '</span>' +
              '</span>' +
              '<a href="#/maintenance" class="text-[9.5px] underline hover:text-ink shrink-0 font-semibold" title="Jump to Maintenance">Fault \u2192</a>' +
            '</div>'
          ) : '') +

          // Assignee & Action Buttons
          '<div class="flex items-center justify-between gap-1 pt-1.5 border-t border-line/40 text-[11px]">' +
            '<div class="flex items-center gap-1.5 min-w-0">' +
              '<span class="w-5 h-5 rounded-full bg-accent/20 text-accent font-bold text-[9px] flex items-center justify-center shrink-0">' +
                (t.assignedTechName ? t.assignedTechName[0].toUpperCase() : '?') +
              '</span>' +
              '<span class="text-ink font-medium truncate text-[11px]">' +
                (t.assignedTechName ? ui.esc(t.assignedTechName) : '<span class="text-muted italic">Unassigned</span>') +
              '</span>' +
            '</div>' +

            '<div class="flex items-center gap-1 shrink-0" onclick="event.stopPropagation()">' +
              (!t.assignedTechId && me ? (
                '<button type="button" data-claim-task="' + t.id + '" class="px-2 py-0.5 rounded text-[10px] font-semibold bg-panel border border-line text-accent hover:border-accent transition" title="Assign this task to yourself">' +
                  'Claim' +
                '</button>'
              ) : '') +
              (!isComplete ? (
                '<button type="button" data-complete-task="' + t.id + '" class="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 transition flex items-center gap-1" title="Mark this job complete">' +
                  ui.icon('check', 'w-3 h-3 text-emerald-400') +
                  '<span>Done</span>' +
                '</button>'
              ) : (
                '<button type="button" data-complete-task="' + t.id + '" class="text-[10px] text-emerald-400 font-bold hover:underline" title="Re-open task">' +
                  '\u2713 Finished' +
                '</button>'
              )) +
              '<button type="button" data-delete-task="' + t.id + '" class="p-1 rounded text-muted hover:text-danger hover:bg-danger/10 transition" title="Delete job">' +
                ui.icon('trash', 'w-3.5 h-3.5') +
              '</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }

    /* ---- Render Registry Table / List View ---- */
    function renderListView(tasks) {
      if (tasks.length === 0) {
        return renderEmptyState();
      }

      return (
        '<div class="rounded-xl border border-line bg-panel overflow-hidden">' +
          '<div class="overflow-x-auto">' +
            '<table class="w-full text-left text-xs border-collapse">' +
              '<thead>' +
                '<tr class="border-b border-line bg-panel2/60 text-[10px] font-mono text-muted uppercase tracking-wider">' +
                  '<th class="p-3 w-8 text-center">Status</th>' +
                  '<th class="p-3">Job / Task Title</th>' +
                  '<th class="p-3">Category</th>' +
                  '<th class="p-3">Space</th>' +
                  '<th class="p-3">Priority</th>' +
                  '<th class="p-3">Assignee / Tagged</th>' +
                  '<th class="p-3">Due Target</th>' +
                  '<th class="p-3">Linked Context</th>' +
                  '<th class="p-3 text-right">Actions</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody class="divide-y divide-line/60">' +
                tasks.map(t => {
                  const isDone = t.status === 'Completed';

                  // Tagged text
                  let taggedDisplay = '';
                  if (Array.isArray(t.taggedUserNames) && t.taggedUserNames.length > 0) {
                    taggedDisplay = '<div class="text-[10px] text-muted mt-0.5">Tagged: ' +
                      t.taggedUserNames.map(n => '@' + ui.esc(n)).join(', ') + '</div>';
                  }

                  // Linked Badge
                  let linkedBadge = '<span class="text-muted">\u2014</span>';
                  if (t.linkedScreeningId) {
                    linkedBadge = '<a href="#/dcp?id=' + encodeURIComponent(t.linkedScreeningId) + '" class="text-purple-300 font-semibold hover:underline flex items-center gap-1">' +
                      ui.icon('film', 'w-3 h-3 text-purple-400') + '<span>' + ui.esc(t.filmTitle || 'Screening') + '</span></a>';
                  } else if (t.linkedEventId) {
                    linkedBadge = '<a href="#/advancing?id=' + encodeURIComponent(t.linkedEventId) + '" class="text-accent font-semibold hover:underline flex items-center gap-1">' +
                      ui.icon('clip', 'w-3 h-3') + '<span>' + ui.esc(t.filmTitle || t.linkedEventName || 'Event') + '</span></a>';
                  } else if (t.linkedFaultId) {
                    linkedBadge = '<a href="#/maintenance" class="text-rose-300 font-semibold hover:underline flex items-center gap-1">' +
                      ui.icon('wrench', 'w-3 h-3 text-rose-400') + '<span>' + ui.esc(t.filmTitle || 'Fault') + '</span></a>';
                  }

                  return (
                    '<tr data-task-row="' + t.id + '" class="hover:bg-panel2/40 transition cursor-pointer ' + (isDone ? 'opacity-70 bg-panel2/20' : '') + '">' +
                      '<td class="p-3 text-center" onclick="event.stopPropagation()">' +
                        '<input type="checkbox" data-toggle-complete="' + t.id + '" class="w-4 h-4 rounded accent-emerald-500 cursor-pointer" ' + (isDone ? 'checked' : '') + ' />' +
                      '</td>' +

                      '<td class="p-3">' +
                        '<div class="font-bold text-ink ' + (isDone ? 'line-through text-muted' : '') + '">' +
                          ui.esc(t.title) +
                        '</div>' +
                        (t.description ? ('<div class="text-[11px] text-muted line-clamp-1 mt-0.5">' + ui.esc(t.description) + '</div>') : '') +
                      '</td>' +

                      '<td class="p-3">' + getCategoryBadge(t.category) + '</td>' +

                      '<td class="p-3 font-semibold text-ink">' + ui.esc(t.space || 'Venue') + '</td>' +

                      '<td class="p-3">' + getPriorityBadge(t.priority) + '</td>' +

                      '<td class="p-3">' +
                        '<span class="font-medium text-ink">' + (t.assignedTechName ? ui.esc(t.assignedTechName) : '<span class="text-muted italic">Unassigned</span>') + '</span>' +
                        taggedDisplay +
                      '</td>' +

                      '<td class="p-3 font-mono text-[11px] ' + (t.dueDate < new Date().toISOString().slice(0, 10) && !isDone ? 'text-rose-400 font-bold' : 'text-muted') + '">' +
                        (t.dueDate ? (t.dueDate + (t.dueTime ? (' ' + t.dueTime) : '')) : '\u2014') +
                      '</td>' +

                      '<td class="p-3 text-[11px]">' + linkedBadge + '</td>' +

                      '<td class="p-3 text-right" onclick="event.stopPropagation()">' +
                        '<div class="flex items-center justify-end gap-1">' +
                          '<button type="button" data-edit-task="' + t.id + '" class="btn btn-ghost text-xs !py-1 !px-2 text-accent" title="Edit details">' +
                            ui.icon('edit', 'w-3.5 h-3.5') +
                          '</button>' +
                          '<button type="button" data-delete-task="' + t.id + '" class="btn btn-ghost text-xs !py-1 !px-2 text-muted hover:text-danger hover:bg-danger/10" title="Delete job">' +
                            ui.icon('trash', 'w-3.5 h-3.5') +
                          '</button>' +
                        '</div>' +
                      '</td>' +
                    '</tr>'
                  );
                }).join('') +
              '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>'
      );
    }

    /* ---- Render Zero / Empty State ---- */
    function renderEmptyState() {
      return (
        '<div class="p-12 text-center rounded-xl border border-dashed border-line bg-panel space-y-3">' +
          '<div class="w-12 h-12 rounded-full bg-accent/10 text-accent mx-auto flex items-center justify-center">' +
            ui.icon('list', 'w-6 h-6') +
          '</div>' +
          '<h3 class="text-sm font-bold text-ink">No jobs or tasks found</h3>' +
          '<p class="text-xs text-muted max-w-md mx-auto">' +
            'There are no tasks matching the selected filters. Use the button below to assign a job, or generate follow-up tasks from the Pre-Screening Tracker, Advancing, or Maintenance.' +
          '</p>' +
          '<div class="pt-2">' +
            '<button type="button" id="btn-empty-add" class="btn btn-primary text-xs font-semibold">' +
              ui.icon('plus', 'w-3.5 h-3.5') + '<span>Create a Job / Task</span>' +
            '</button>' +
          '</div>' +
        '</div>'
      );
    }

    /* ---- Event Listeners Wire-up ---- */
    function wirePageEvents(tasks) {
      // View switchers
      el.querySelector('#btn-view-board')?.addEventListener('click', () => {
        currentViewMode = 'board';
        renderTasksPage();
      });
      el.querySelector('#btn-view-list')?.addEventListener('click', () => {
        currentViewMode = 'list';
        renderTasksPage();
      });

      // Quick filter cards
      el.querySelector('#card-stat-open')?.addEventListener('click', () => {
        activeStatusFilter = 'Pending';
        renderTasksPage();
      });
      el.querySelector('#card-stat-mine')?.addEventListener('click', () => {
        activeAssigneeFilter = activeAssigneeFilter === 'me' ? 'all' : 'me';
        renderTasksPage();
      });
      el.querySelector('#card-stat-urgent')?.addEventListener('click', () => {
        activePriorityFilter = activePriorityFilter === 'Urgent' ? 'all' : 'Urgent';
        renderTasksPage();
      });
      el.querySelector('#card-stat-done')?.addEventListener('click', () => {
        activeStatusFilter = activeStatusFilter === 'Completed' ? 'all' : 'Completed';
        renderTasksPage();
      });

      // Quick "Assigned to Me" button
      el.querySelector('#btn-quick-mine')?.addEventListener('click', () => {
        activeAssigneeFilter = activeAssigneeFilter === 'me' ? 'all' : 'me';
        renderTasksPage();
      });

      // Reset filters button
      el.querySelector('#btn-reset-filters')?.addEventListener('click', () => {
        activeCategoryFilter = 'all';
        activeSpaceFilter = 'all';
        activePriorityFilter = 'all';
        activeStatusFilter = 'all';
        activeAssigneeFilter = 'all';
        searchQuery = '';
        renderTasksPage();
      });

      // Search input
      el.querySelector('#task-search-input')?.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        const filteredArea = el.querySelector('#tasks-content-area');
        if (filteredArea) {
          // Re-render only content area for speed
          const allTasks = store.all('tasks') || [];
          let filteredNow = allTasks.filter(t => !t.id.startsWith('task-seed-'));
          if (activeCategoryFilter !== 'all') filteredNow = filteredNow.filter(t => t.category === activeCategoryFilter);
          if (activeSpaceFilter !== 'all') filteredNow = filteredNow.filter(t => t.space === activeSpaceFilter);
          if (activePriorityFilter !== 'all') filteredNow = filteredNow.filter(t => t.priority === activePriorityFilter);
          if (activeStatusFilter !== 'all') filteredNow = filteredNow.filter(t => t.status === activeStatusFilter);
          if (activeAssigneeFilter === 'me') {
            const me = auth.current();
            if (me) filteredNow = filteredNow.filter(t => isUserAssignedOrTagged(t, me));
          } else if (activeAssigneeFilter === 'unassigned') {
            filteredNow = filteredNow.filter(t => !t.assignedTechId);
          } else if (activeAssigneeFilter !== 'all') {
            filteredNow = filteredNow.filter(t => t.assignedTechId === activeAssigneeFilter || (Array.isArray(t.taggedUserIds) && t.taggedUserIds.includes(activeAssigneeFilter)));
          }
          if (searchQuery.trim()) {
            const q = searchQuery.trim().toLowerCase();
            filteredNow = filteredNow.filter(t =>
              (t.title && t.title.toLowerCase().includes(q)) ||
              (t.description && t.description.toLowerCase().includes(q)) ||
              (t.space && t.space.toLowerCase().includes(q)) ||
              (t.filmTitle && t.filmTitle.toLowerCase().includes(q)) ||
              (t.assignedTechName && t.assignedTechName.toLowerCase().includes(q))
            );
          }
          filteredArea.innerHTML = currentViewMode === 'board' ? renderBoardView(filteredNow) : renderListView(filteredNow);
          wireDynamicItemClicks();
        }
      });

      // Dropdown filters
      el.querySelector('#filter-cat')?.addEventListener('change', (e) => { activeCategoryFilter = e.target.value; renderTasksPage(); });
      el.querySelector('#filter-space')?.addEventListener('change', (e) => { activeSpaceFilter = e.target.value; renderTasksPage(); });
      el.querySelector('#filter-priority')?.addEventListener('change', (e) => { activePriorityFilter = e.target.value; renderTasksPage(); });
      el.querySelector('#filter-status')?.addEventListener('change', (e) => { activeStatusFilter = e.target.value; renderTasksPage(); });
      el.querySelector('#filter-assignee')?.addEventListener('change', (e) => { activeAssigneeFilter = e.target.value; renderTasksPage(); });

      // Create new task button
      el.querySelector('#btn-create-task')?.addEventListener('click', () => {
        openTaskModal(null, null, renderTasksPage);
      });
      el.querySelector('#btn-empty-add')?.addEventListener('click', () => {
        openTaskModal(null, null, renderTasksPage);
      });

      // Quick add in column
      el.querySelectorAll('[data-quick-add-col]').forEach(btn => {
        btn.addEventListener('click', () => {
          const colStatus = btn.getAttribute('data-quick-add-col');
          openTaskModal(null, { status: colStatus }, renderTasksPage);
        });
      });

      wireDynamicItemClicks();
    }

    function wireDynamicItemClicks() {
      // Claim task buttons
      el.querySelectorAll('[data-claim-task]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const tid = btn.getAttribute('data-claim-task');
          const task = store.find('tasks', tid);
          const me = auth.current();
          if (task && me) {
            task.assignedTechId = me.id;
            task.assignedTechName = auth.displayName(me);
            task.updatedAt = Date.now();
            store.upsert('tasks', task);
            syncTaskToOtherSections(task);
            if (RMTP.shell && RMTP.shell.renderNavigation) RMTP.shell.renderNavigation();
            ui.toast('You claimed task: ' + task.title, 'ok');
            renderTasksPage();
          }
        });
      });

      // Complete task toggles (cards & table checkboxes)
      el.querySelectorAll('[data-complete-task], [data-toggle-complete]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const tid = btn.getAttribute('data-complete-task') || btn.getAttribute('data-toggle-complete');
          RMTP.tasks.toggleCompleted(tid, () => {
            renderTasksPage();
          });
        });
      });

      // Delete task buttons (direct from card or list row)
      el.querySelectorAll('[data-delete-task]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const tid = btn.getAttribute('data-delete-task');
          const task = store.find('tasks', tid);
          const taskTitle = task ? (task.title || 'this job') : 'this job';
          const ok = await ui.confirm('Are you sure you want to delete "' + taskTitle + '"?', {
            title: 'Delete Job',
            danger: true,
            confirmLabel: 'Delete'
          });
          if (ok) {
            RMTP.tasks.delete(tid, () => {
              ui.toast('Job deleted', 'info');
              renderTasksPage();
            });
          }
        });
      });

      // Edit / View Card or Row Click
      el.querySelectorAll('[data-task-card], [data-task-row], [data-edit-task]').forEach((itemEl) => {
        itemEl.addEventListener('click', () => {
          const tid = itemEl.getAttribute('data-task-card') || itemEl.getAttribute('data-task-row') || itemEl.getAttribute('data-edit-task');
          const task = store.find('tasks', tid);
          if (task) openTaskModal(task, null, renderTasksPage);
        });
      });
    }

    // Initial render
    renderTasksPage();

    // Auto-open specific task modal if passed in hash query: #/tasks?id=xyz
    if (query && query.id) {
      const target = store.find('tasks', query.id);
      if (target) {
        setTimeout(() => openTaskModal(target, null, renderTasksPage), 100);
      }
    }
  };

  /* ---- Open Task Edit / Creation Modal (Globally Accessible) ---- */
  function openTaskModal(existingTask = null, defaults = null, onSaved = null) {
    const isNew = !existingTask;
    const allUsers = store.all('users') || [];
    const allDcps = store.all('dcps') || [];
    const allAdv = (store.all('advancing') || []).filter((e) => !e.deleted);
    const allMaint = (store.all('maintenance') || []).filter((m) => m.status !== 'Resolved');
    const me = auth.current();

    const task = existingTask ? Object.assign({}, existingTask) : Object.assign({
      id: store.uid('task'),
      title: '',
      category: 'General',
      space: 'Screen One',
      priority: 'Medium',
      status: 'Pending',
      assignedTechId: me ? me.id : '',
      assignedTechName: me ? auth.displayName(me) : '',
      taggedUserIds: [],
      taggedUserNames: [],
      reportedBy: me ? auth.displayName(me) : 'Staff Tech',
      description: '',
      dueDate: new Date().toISOString().slice(0, 10),
      dueTime: '17:00',
      linkedScreeningId: '',
      linkedEventId: '',
      linkedFaultId: '',
      source: 'manual',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }, defaults || {});

    // Ensure tagged arrays exist
    if (!Array.isArray(task.taggedUserIds)) task.taggedUserIds = [];
    if (!Array.isArray(task.taggedUserNames)) task.taggedUserNames = [];

    const m = ui.modal({
      title: isNew ? 'Create New Assignable Job / Task' : 'Edit Job Details · ' + ui.esc(task.title),
      size: 'md:max-w-2xl',
      body:
        '<div class="space-y-4 text-xs">' +
          // Job Title
          '<div>' +
            '<label class="block font-semibold text-muted mb-1">Job / Task Title *</label>' +
            '<input id="tk-title" class="field font-semibold text-sm" value="' + ui.esc(task.title) + '" placeholder="e.g. Screen 1: Align Left Masking &amp; Ingest KDM" />' +
          '</div>' +

          // Category & Space
          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
            '<div>' +
              '<label class="block font-semibold text-muted mb-1">Category</label>' +
              '<select id="tk-cat" class="field">' +
                CATEGORIES.map((c) => '<option value="' + c + '" ' + (task.category === c ? 'selected' : '') + '>' + c + '</option>').join('') +
              '</select>' +
            '</div>' +
            '<div>' +
              '<label class="block font-semibold text-muted mb-1">Venue Space / Room</label>' +
              '<select id="tk-space" class="field font-semibold">' +
                RMTP.SPACES.map((s) => '<option value="' + s + '" ' + (task.space === s ? 'selected' : '') + '>' + s + '</option>').join('') +
              '</select>' +
            '</div>' +
          '</div>' +

          // Priority & Status
          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
            '<div>' +
              '<label class="block font-semibold text-muted mb-1">Priority</label>' +
              '<select id="tk-prio" class="field font-semibold">' +
                PRIORITIES.map((p) => '<option value="' + p + '" ' + (task.priority === p ? 'selected' : '') + '>' + p + '</option>').join('') +
              '</select>' +
            '</div>' +
            '<div>' +
              '<label class="block font-semibold text-muted mb-1">Workflow Status</label>' +
              '<select id="tk-status" class="field font-semibold">' +
                STATUSES.map((s) => '<option value="' + s + '" ' + (task.status === s ? 'selected' : '') + '>' + s + '</option>').join('') +
              '</select>' +
            '</div>' +
          '</div>' +

          // Lead Assignee Picker
          '<div>' +
            '<div class="flex items-center justify-between mb-1">' +
              '<label class="font-semibold text-muted">Primary Assigned Technician</label>' +
              (me ? (
                '<button type="button" id="tk-assign-me" class="text-accent text-[11px] font-semibold hover:underline">' +
                  'Assign to Me (' + ui.esc(auth.displayName(me)) + ')' +
                '</button>'
              ) : '') +
            '</div>' +
            '<select id="tk-user" class="field font-medium">' +
              '<option value="">\u2014 Unassigned (Anyone can claim) \u2014</option>' +
              allUsers.map((u) => (
                '<option value="' + u.id + '" ' + (task.assignedTechId === u.id ? 'selected' : '') + '>' +
                  ui.esc(auth.displayName(u)) + ' (' + ui.esc(u.position || 'Tech') + ')' +
                '</option>'
              )).join('') +
            '</select>' +
          '</div>' +

          // Tag Additional Team Members (Multi-select pills)
          '<div class="p-3 bg-panel2/50 rounded-xl border border-line">' +
            '<label class="block font-semibold text-muted mb-1.5">' +
              'Tag Additional Team Members (They will see this on their Jobs list)' +
            '</label>' +
            '<div class="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-36 overflow-y-auto pr-1" id="tk-tag-members-container">' +
              allUsers.map(u => {
                const isTagged = task.taggedUserIds.includes(u.id);
                return (
                  '<label class="flex items-center gap-2 p-1.5 rounded-lg bg-panel border border-line hover:border-accent cursor-pointer transition select-none">' +
                    '<input type="checkbox" name="tk-tag-member" value="' + u.id + '" class="w-3.5 h-3.5 accent-[var(--accent)]" ' + (isTagged ? 'checked' : '') + ' />' +
                    '<span class="truncate text-[11px] font-medium text-ink">' + ui.esc(auth.displayName(u)) + '</span>' +
                  '</label>'
                );
              }).join('') +
            '</div>' +
          '</div>' +

          // Due Date & Time
          '<div class="grid grid-cols-2 gap-3">' +
            '<div>' +
              '<label class="block font-semibold text-muted mb-1">Due Date</label>' +
              '<input type="date" id="tk-date" class="field font-mono" value="' + (task.dueDate || '') + '" />' +
            '</div>' +
            '<div>' +
              '<label class="block font-semibold text-muted mb-1">Due Time (Target)</label>' +
              '<input type="time" id="tk-time" class="field font-mono" value="' + (task.dueTime || '17:00') + '" />' +
            '</div>' +
          '</div>' +

          // Linked Context (Cinema Screening, Advancing Event, or Maintenance Ticket)
          '<div>' +
            '<label class="block font-semibold text-muted mb-1">Link to Event, Screening, or Maintenance (Bi-directional)</label>' +
            '<select id="tk-link-select" class="field font-medium">' +
              '<option value="">\u2014 Standalone Venue Task / Not Linked \u2014</option>' +
              '<optgroup label="Venue Events (Advancing)">' +
                allAdv.slice(0, 20).map((e) => (
                  '<option value="adv|' + e.id + '" ' + (task.linkedEventId === e.id ? 'selected' : '') + '>' +
                    '\uD83D\uDCCB ' + ui.esc(e.name) + ' \u00b7 ' + ui.esc(e.space) + ' (' + (e.date || 'TBC') + ')' +
                  '</option>'
                )).join('') +
              '</optgroup>' +
              '<optgroup label="Cinema Screenings (Pre-Screening Tracker)">' +
                allDcps.map((d) => (
                  '<option value="dcp|' + d.id + '" ' + (task.linkedScreeningId === d.id ? 'selected' : '') + '>' +
                    '\uD83C\uDFAC ' + ui.esc(d.filmTitle || d.eventName) + ' \u00b7 ' + ui.esc(d.screen) + ' (' + (d.eventDate || 'No date') + ')' +
                  '</option>'
                )).join('') +
              '</optgroup>' +
              (allMaint.length > 0 ? (
                '<optgroup label="Maintenance Fault Tickets">' +
                  allMaint.slice(0, 15).map((m) => (
                    '<option value="fault|' + m.id + '" ' + (task.linkedFaultId === m.id ? 'selected' : '') + '>' +
                      '\uD83D\uDD27 ' + ui.esc(m.equipment || m.description) + ' \u00b7 ' + ui.esc(m.space || 'Venue') + ' (' + m.status + ')' +
                    '</option>'
                  )).join('') +
                '</optgroup>'
              ) : '') +
            '</select>' +
          '</div>' +

          // Description & Steps
          '<div>' +
            '<label class="block font-semibold text-muted mb-1">Task Brief &amp; Required Action</label>' +
            '<textarea id="tk-desc" class="field" rows="3" placeholder="Provide step-by-step instructions or notes for the technician (tip: use @Name to mention team members)…">' + ui.esc(task.description || '') + '</textarea>' +
          '</div>' +

          (task.status === 'Completed' ? (
            '<div class="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-300">' +
              'Completed by <strong>' + ui.esc(task.completedBy || 'Staff Tech') + '</strong> on ' + (task.completedAt ? new Date(task.completedAt).toLocaleString('en-GB') : 'recently') + '.' +
            '</div>'
          ) : '') +
        '</div>',
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

    // Auto-fill Space when a linked event or screening is selected
    m.root.querySelector('#tk-link-select')?.addEventListener('change', (e) => {
      const val = e.target.value;
      if (!val) return;
      const [type, id] = val.split('|');
      const spaceSel = m.root.querySelector('#tk-space');
      const dateInp = m.root.querySelector('#tk-date');
      const titleInp = m.root.querySelector('#tk-title');
      if (type === 'adv') {
        const ev = store.find('advancing', id);
        if (ev) {
          if (spaceSel && ev.space) spaceSel.value = Array.isArray(ev.space) ? ev.space[0] : ev.space;
          if (dateInp && ev.date) dateInp.value = ev.date;
          if (titleInp && !titleInp.value.trim()) titleInp.value = 'Prep for ' + ev.name;
        }
      } else if (type === 'dcp') {
        const sc = store.find('dcps', id);
        if (sc) {
          if (spaceSel && sc.screen) spaceSel.value = sc.screen;
          if (dateInp && sc.eventDate) dateInp.value = sc.eventDate;
          if (titleInp && !titleInp.value.trim()) titleInp.value = (sc.filmTitle || sc.eventName) + ' Pre-Screening Follow-up';
        }
      } else if (type === 'fault') {
        const flt = store.find('maintenance', id);
        if (flt) {
          if (spaceSel && flt.space) spaceSel.value = flt.space;
          if (titleInp && !titleInp.value.trim()) titleInp.value = 'Repair: ' + (flt.equipment || flt.description);
        }
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

      // Tagged users
      const taggedIds = [];
      const taggedNames = [];
      m.root.querySelectorAll('input[name="tk-tag-member"]:checked').forEach(cb => {
        taggedIds.push(cb.value);
        const u = store.find('users', cb.value);
        if (u) taggedNames.push(auth.displayName(u));
      });

      const linkVal = m.root.querySelector('#tk-link-select').value;
      let linkedScreeningId = '';
      let linkedEventId = '';
      let linkedFaultId = '';
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
        } else if (prefix === 'fault') {
          linkedFaultId = id;
          const flt = store.find('maintenance', id);
          if (flt) filmTitle = flt.equipment || flt.description;
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
      task.taggedUserIds = taggedIds;
      task.taggedUserNames = taggedNames;
      task.dueDate = m.root.querySelector('#tk-date').value;
      task.dueTime = m.root.querySelector('#tk-time').value;
      task.description = m.root.querySelector('#tk-desc').value.trim();
      task.linkedScreeningId = linkedScreeningId;
      task.linkedEventId = linkedEventId;
      task.linkedFaultId = linkedFaultId;
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
      syncTaskToOtherSections(task);

      if (RMTP.shell && RMTP.shell.renderNavigation) {
        RMTP.shell.renderNavigation();
      }

      ui.toast(isNew ? 'New task created successfully' : 'Task details updated', 'ok');
      m.close();
      if (typeof onSaved === 'function') onSaved(task);
    });

    // Delete handler
    const delBtn = m.root.querySelector('#tk-delete');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        const ok = await ui.confirm('Are you sure you want to delete this job?', {
          title: 'Delete Task',
          danger: true,
          confirmLabel: 'Delete'
        });
        if (ok) {
          RMTP.tasks.delete(task.id, () => {
            ui.toast('Job deleted', 'info');
            m.close();
            if (typeof onSaved === 'function') onSaved(null);
          });
        }
      });
    }
  }

  RMTP.openTaskModal = openTaskModal;
})();
