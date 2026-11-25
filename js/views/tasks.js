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

  const CATEGORIES = ['Cinema & DCP', 'Sound', 'Lighting', 'AV', 'Stage', 'General', 'Maintenance', 'Hires'];
  const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'];
  const STATUSES = ['Pending', 'In Progress', 'Blocked', 'Completed'];

  function parseSpaceList(raw) {
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : String(raw).split(/[,;]+/);
    const seen = new Set();
    const out = [];
    arr.forEach((s) => {
      const clean = String(s || '').trim();
      if (!clean) return;
      const norm = RMTP.normalizeSpaceName ? RMTP.normalizeSpaceName(clean) : clean;
      const key = norm.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(norm);
    });
    return out;
  }

  function getTaskSpaces(task) {
    if (!task) return [];
    if (Array.isArray(task.spaces) && task.spaces.length) {
      return parseSpaceList(task.spaces);
    }
    return parseSpaceList(task.space);
  }

  function formatTaskSpaces(task) {
    const list = getTaskSpaces(task);
    return list.length ? list.join(', ') : 'Venue-wide';
  }

  function taskMatchesSpace(task, targetSpace) {
    if (!targetSpace || targetSpace === 'all') return true;
    const targetNorm = (RMTP.normalizeSpaceName ? RMTP.normalizeSpaceName(targetSpace) : String(targetSpace).trim()).toLowerCase();
    if (!targetNorm) return true;
    return getTaskSpaces(task).some((sp) => sp.toLowerCase() === targetNorm);
  }

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
        const normTaskSubs = RMTP.subtasks ? RMTP.subtasks.normalize(task.subtasks) : (Array.isArray(task.subtasks) ? task.subtasks : []);
        const normFaultSubs = RMTP.subtasks ? RMTP.subtasks.normalize(fault.subtasks) : (Array.isArray(fault.subtasks) ? fault.subtasks : []);
        if (JSON.stringify(normTaskSubs) !== JSON.stringify(normFaultSubs)) {
          fault.subtasks = normTaskSubs;
          changed = true;
        }
        if (task.status === 'Completed' && fault.status !== 'Resolved') {
          fault.status = 'Resolved';
          fault.resolvedAt = Date.now();
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
        } else if (task.status === 'In Progress' && (fault.status === 'Open' || fault.status === 'Resolved')) {
          fault.status = 'In progress';
          fault.resolvedAt = null;
          changed = true;
        } else if (task.status !== 'Completed' && fault.status === 'Resolved') {
          fault.status = 'In progress';
          fault.resolvedAt = null;
          changed = true;
        }
        if (changed) {
          fault.updatedAt = Date.now();
          store.upsert('maintenance', fault);
        }
      }
    }

    // 4. If linked to a Hires Desk request, keep hiresStatus & advancing mirror in sync
    if ((task.source === 'hires' || task.category === 'Hires') && RMTP.hires && typeof RMTP.hires.syncFromTaskStatus === 'function') {
      RMTP.hires.syncFromTaskStatus(task);
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
    getSpaces: getTaskSpaces,
    formatSpaces: formatTaskSpaces,
    forSpace: function (spaceName) {
      if (!spaceName) return [];
      return (store.all('tasks') || []).filter(t => taskMatchesSpace(t, spaceName));
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
      const actorName = me ? auth.displayName(me) : 'Staff Tech';
      const nowIso = new Date().toISOString();
      const nextStatus = task.status === 'Completed' ? 'Pending' : 'Completed';
      task.status = nextStatus;
      const subs = RMTP.subtasks ? RMTP.subtasks.normalize(task.subtasks) : [];
      if (nextStatus === 'Completed') {
        task.completedBy = actorName;
        task.completedAt = nowIso;
        if (subs.length) {
          task.subtasks = subs.map((s) => Object.assign({}, s, {
            completed: true,
            completedAt: s.completedAt || nowIso,
            completedBy: s.completedBy || actorName,
          }));
        }
      } else {
        delete task.completedBy;
        delete task.completedAt;
        if (subs.length && subs.every((s) => s.completed)) {
          task.subtasks = subs.map((s) => Object.assign({}, s, {
            completed: false,
            completedAt: '',
            completedBy: '',
          }));
        }
      }
      task.updatedAt = Date.now();
      store.upsert('tasks', task);
      syncTaskToOtherSections(task);
      if (RMTP.shell && RMTP.shell.renderNavigation) RMTP.shell.renderNavigation();
      if (typeof onComplete === 'function') onComplete(task);
    },
    addSubtask: function (taskId, subData, onUpdated) {
      const task = store.find('tasks', taskId);
      if (!task || !RMTP.subtasks) return null;
      const sub = RMTP.subtasks.normalizeOne(subData);
      if (!sub) return null;
      const me = auth.current();
      const actorName = me ? auth.displayName(me) : 'Staff Tech';
      task.subtasks = RMTP.subtasks.normalize(task.subtasks).concat(sub);
      RMTP.subtasks.syncMainStatus(task, 'task', actorName);
      task.updatedAt = Date.now();
      store.upsert('tasks', task);
      syncTaskToOtherSections(task);
      if (RMTP.shell && RMTP.shell.renderNavigation) RMTP.shell.renderNavigation();
      if (typeof onUpdated === 'function') onUpdated(task, sub);
      return sub;
    },
    toggleSubtask: function (taskId, subId, onUpdated) {
      const task = store.find('tasks', taskId);
      if (!task || !RMTP.subtasks) return null;
      const me = auth.current();
      const actorName = me ? auth.displayName(me) : 'Staff Tech';
      const nowIso = new Date().toISOString();
      const list = RMTP.subtasks.normalize(task.subtasks);
      let toggled = null;
      task.subtasks = list.map((s) => {
        if (s.id !== subId) return s;
        const nextDone = !s.completed;
        toggled = Object.assign({}, s, {
          completed: nextDone,
          completedAt: nextDone ? nowIso : '',
          completedBy: nextDone ? actorName : '',
        });
        return toggled;
      });
      if (!toggled) return null;
      RMTP.subtasks.syncMainStatus(task, 'task', actorName);
      task.updatedAt = Date.now();
      store.upsert('tasks', task);
      syncTaskToOtherSections(task);
      if (RMTP.shell && RMTP.shell.renderNavigation) RMTP.shell.renderNavigation();
      if (typeof onUpdated === 'function') onUpdated(task, toggled);
      return toggled;
    },
    updateSubtask: function (taskId, subId, patch, onUpdated) {
      const task = store.find('tasks', taskId);
      if (!task || !RMTP.subtasks) return null;
      const list = RMTP.subtasks.normalize(task.subtasks);
      let updatedSub = null;
      task.subtasks = list.map((s) => {
        if (s.id !== subId) return s;
        const merged = RMTP.subtasks.normalizeOne(Object.assign({}, s, patch || {}, { id: s.id }));
        updatedSub = merged || s;
        return updatedSub;
      });
      if (!updatedSub) return null;
      task.updatedAt = Date.now();
      store.upsert('tasks', task);
      syncTaskToOtherSections(task);
      if (typeof onUpdated === 'function') onUpdated(task, updatedSub);
      return updatedSub;
    },
    deleteSubtask: function (taskId, subId, onUpdated) {
      const task = store.find('tasks', taskId);
      if (!task || !RMTP.subtasks) return false;
      const me = auth.current();
      const actorName = me ? auth.displayName(me) : 'Staff Tech';
      const before = RMTP.subtasks.normalize(task.subtasks);
      const after = before.filter((s) => s.id !== subId);
      if (after.length === before.length) return false;
      task.subtasks = after;
      if (after.length > 0) {
        RMTP.subtasks.syncMainStatus(task, 'task', actorName);
      }
      task.updatedAt = Date.now();
      store.upsert('tasks', task);
      syncTaskToOtherSections(task);
      if (RMTP.shell && RMTP.shell.renderNavigation) RMTP.shell.renderNavigation();
      if (typeof onUpdated === 'function') onUpdated(task);
      return true;
    }
  };

  /* ---- Priority UI Styling (clean text + semantic colour, no decorative pulse) ---- */
  function getPriorityBadge(priority) {
    const p = String(priority || 'Medium').toLowerCase();
    if (p === 'urgent') {
      return '<span class="inline-flex items-center gap-1 text-[11px] font-bold text-danger">' +
        ui.icon('alert', 'w-3 h-3 text-danger') + '<span>Urgent</span></span>';
    }
    if (p === 'high') {
      return '<span class="inline-flex items-center text-[11px] font-semibold text-accent">High</span>';
    }
    if (p === 'low') {
      return '<span class="inline-flex items-center text-[11px] font-medium text-muted">Low</span>';
    }
    return '<span class="inline-flex items-center text-[11px] font-semibold text-info">Medium</span>';
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
    } else if (c.includes('Hires')) {
      colorClass = 'bg-sky-500/15 text-sky-300 border-sky-500/30';
      iconKey = 'chat';
    }
    return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ' + colorClass + '">' +
      ui.icon(iconKey, 'w-3 h-3') + '<span>' + ui.esc(c) + '</span></span>';
  }

  /* ---- Main View Controller ---- */
  RMTP.views.tasks = function (el, params, query) {
    purgePlaceholderSeeds();

    // View state — default to hierarchical Task List so main tasks, linked subtasks & progress bars are front and center
    let currentViewMode = 'list'; // 'list' (hierarchical task list) | 'board' (kanban)
    let activeCategoryFilter = 'all';
    let activeStatusFilter = 'all';
    let activePriorityFilter = 'all';
    let activeSpaceFilter = 'all';
    let activeAssigneeFilter = 'all'; // 'all', 'me', 'unassigned', or specific userId
    let searchQuery = '';
    const expandedTaskIds = new Set();
    const collapsedTaskIds = new Set();
    let pendingSubtaskFocusId = null;

    function isTaskExpanded(t) {
      if (expandedTaskIds.has(t.id)) return true;
      if (collapsedTaskIds.has(t.id)) return false;
      const subs = RMTP.subtasks ? RMTP.subtasks.normalize(t.subtasks) : [];
      return subs.length > 0;
    }

    function todayLocal() {
      return RMTP.localDateStr ? RMTP.localDateStr() : new Date().toISOString().slice(0, 10);
    }

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

    function getFilteredTasks() {
      const allTasks = RMTP.tasks.all();
      const me = auth.current();
      let filtered = allTasks.slice();

      if (activeCategoryFilter !== 'all') {
        filtered = filtered.filter(t => t.category === activeCategoryFilter);
      }
      if (activeSpaceFilter !== 'all') {
        filtered = filtered.filter(t => taskMatchesSpace(t, activeSpaceFilter));
      }
      if (activePriorityFilter !== 'all') {
        filtered = filtered.filter(t => {
          if (t.priority === activePriorityFilter) return true;
          const subs = RMTP.subtasks ? RMTP.subtasks.normalize(t.subtasks) : [];
          return subs.some(s => !s.completed && s.priority === activePriorityFilter);
        });
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

      // Search Query Filter (matches main task + linked subtasks)
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        filtered = filtered.filter(t => {
          const subs = RMTP.subtasks ? RMTP.subtasks.normalize(t.subtasks) : [];
          const subMatch = subs.some(s => s.title.toLowerCase().includes(q));
          const spaceText = formatTaskSpaces(t).toLowerCase();
          return subMatch ||
            (t.title && t.title.toLowerCase().includes(q)) ||
            (t.description && t.description.toLowerCase().includes(q)) ||
            spaceText.includes(q) ||
            (t.filmTitle && t.filmTitle.toLowerCase().includes(q)) ||
            (t.linkedEventName && t.linkedEventName.toLowerCase().includes(q)) ||
            (t.assignedTechName && t.assignedTechName.toLowerCase().includes(q)) ||
            (Array.isArray(t.taggedUserNames) && t.taggedUserNames.some(name => name.toLowerCase().includes(q)));
        });
      }

      // Chronological sort (open first, earliest due date first)
      filtered.sort((a, b) => {
        if (a.status === 'Completed' && b.status !== 'Completed') return 1;
        if (b.status === 'Completed' && a.status !== 'Completed') return -1;
        const da = (a.dueDate || '9999-99-99') + ' ' + (a.dueTime || '99:99');
        const db = (b.dueDate || '9999-99-99') + ' ' + (b.dueTime || '99:99');
        return da.localeCompare(db);
      });

      return { allTasks, filtered };
    }

    function renderTasksPage() {
      const { allTasks, filtered } = getFilteredTasks();
      const me = auth.current();

      // KPI stats
      const totalCount = allTasks.length;
      const openCount = allTasks.filter(t => t.status !== 'Completed').length;
      const myCount = me ? allTasks.filter(t => t.status !== 'Completed' && isUserAssignedOrTagged(t, me)).length : 0;
      const urgentCount = allTasks.filter(t => {
        if (t.status === 'Completed') return false;
        if (t.priority === 'Urgent' || t.priority === 'High') return true;
        const subs = RMTP.subtasks ? RMTP.subtasks.normalize(t.subtasks) : [];
        return subs.some(s => !s.completed && (s.priority === 'Urgent' || s.priority === 'High'));
      }).length;
      const completedCount = allTasks.filter(t => t.status === 'Completed').length;
      let totalSubtasks = 0;
      let doneSubtasks = 0;
      allTasks.forEach(t => {
        const subs = RMTP.subtasks ? RMTP.subtasks.normalize(t.subtasks) : [];
        totalSubtasks += subs.length;
        doneSubtasks += subs.filter(s => s.completed).length;
      });

      const allUsers = store.all('users') || [];

      el.innerHTML =
        '<div class="space-y-6 w-full max-w-full pb-16">' +
          // Header
          '<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-line">' +
            '<div>' +
              '<div class="flex items-center gap-2.5 flex-wrap">' +
                '<h1 class="text-2xl font-bold font-display text-ink tracking-tight flex items-center gap-2">' +
                  ui.icon('list', 'w-6 h-6 text-accent') +
                  '<span>Jobs &amp; Tasks</span>' +
                '</h1>' +
                '<span class="text-xs font-mono text-muted">' +
                  openCount + ' open' +
                  (totalSubtasks > 0 ? (' \u00b7 ' + doneSubtasks + '/' + totalSubtasks + ' subtasks done') : '') +
                  (myCount > 0 ? (' \u00b7 <span class="text-accent font-semibold">' + myCount + ' assigned to you</span>') : '') +
                '</span>' +
              '</div>' +
              '<p class="text-xs text-muted mt-1">' +
                'Track main jobs, break work into linked subtasks with independent priorities and deadlines, and monitor live completion progress.' +
              '</p>' +
            '</div>' +

            '<div class="flex items-center gap-2 shrink-0 flex-wrap">' +
              // View switcher (Task List / Board)
              '<div class="flex items-center p-1 bg-panel2 rounded-lg border border-line text-xs">' +
                '<button type="button" id="btn-view-list" class="px-2.5 py-1 rounded font-semibold transition flex items-center gap-1.5 ' +
                  (currentViewMode === 'list' ? 'bg-accent text-accent-ink shadow-2xs' : 'text-muted hover:text-ink') + '">' +
                  ui.icon('list', 'w-3.5 h-3.5') + '<span>Task List</span>' +
                '</button>' +
                '<button type="button" id="btn-view-board" class="px-2.5 py-1 rounded font-semibold transition flex items-center gap-1.5 ' +
                  (currentViewMode === 'board' ? 'bg-accent text-accent-ink shadow-2xs' : 'text-muted hover:text-ink') + '">' +
                  ui.icon('grid', 'w-3.5 h-3.5') + '<span>Board</span>' +
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
              '<div class="text-[11px] text-muted mt-1 font-mono tabular-nums">' + totalCount + ' total \u00b7 ' + completedCount + ' completed</div>' +
            '</div>' +

            '<div class="p-3.5 rounded-xl bg-panel border ' + (myCount > 0 ? 'border-accent/40 bg-accent/5' : 'border-line') + ' cursor-pointer hover:border-accent transition" id="card-stat-mine">' +
              '<div class="text-[11px] font-mono uppercase tracking-wider ' + (myCount > 0 ? 'text-accent font-bold' : 'text-muted') + '">Assigned / Tagged to Me</div>' +
              '<div class="text-2xl font-bold font-mono ' + (myCount > 0 ? 'text-accent' : 'text-ink') + ' mt-1 tabular-nums">' + myCount + '</div>' +
              '<div class="text-[11px] text-muted mt-1">' + (me ? ui.esc(auth.displayName(me)) : 'Sign in to check') + '</div>' +
            '</div>' +

            '<div class="p-3.5 rounded-xl bg-panel border ' + (urgentCount > 0 ? 'border-danger/40 bg-danger/5' : 'border-line') + ' cursor-pointer hover:border-danger transition" id="card-stat-urgent">' +
              '<div class="text-[11px] font-mono uppercase tracking-wider ' + (urgentCount > 0 ? 'text-danger font-bold' : 'text-muted') + '">Urgent &amp; High Priority</div>' +
              '<div class="text-2xl font-bold font-mono ' + (urgentCount > 0 ? 'text-danger' : 'text-ink') + ' mt-1 tabular-nums">' + urgentCount + '</div>' +
              '<div class="text-[11px] text-muted mt-1">Main jobs &amp; linked subtasks</div>' +
            '</div>' +

            '<div class="p-3.5 rounded-xl bg-panel border border-line cursor-pointer hover:border-ok transition" id="card-stat-done">' +
              '<div class="text-[11px] font-mono uppercase tracking-wider text-ok">Completed &amp; Subtask Progress</div>' +
              '<div class="text-2xl font-bold font-mono text-ok mt-1 tabular-nums">' + completedCount + '</div>' +
              '<div class="text-[11px] text-muted mt-1 font-mono tabular-nums">' +
                (totalSubtasks > 0 ? (doneSubtasks + '/' + totalSubtasks + ' subtasks (' + Math.round((doneSubtasks / totalSubtasks) * 100) + '%)') : 'Archived in registry') +
              '</div>' +
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
                '<input id="task-search-input" class="field pl-9 text-xs" placeholder="Search main tasks, subtasks, spaces, films, or technicians\u2026" value="' + ui.esc(searchQuery) + '" />' +
              '</div>' +

              // Quick "Assigned / Tagged to Me" button
              '<div class="flex items-center gap-2 shrink-0">' +
                '<button type="button" id="btn-quick-mine" class="btn text-xs font-semibold flex items-center gap-1.5 ' +
                  (activeAssigneeFilter === 'me' ? 'btn-primary' : 'btn-ghost border border-line') + '">' +
                  ui.icon('user', 'w-3.5 h-3.5') +
                  '<span>Assigned &amp; Tagged to Me</span>' +
                  (myCount > 0 ? ('<span class="font-mono tabular-nums text-[11px]">(' + myCount + ')</span>') : '') +
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
                  '<option value="me" ' + (activeAssigneeFilter === 'me' ? 'selected' : '') + '>\u2605 Assigned &amp; Tagged to Me</option>' +
                  '<option value="unassigned" ' + (activeAssigneeFilter === 'unassigned' ? 'selected' : '') + '>Unassigned (Open to Claim)</option>' +
                  allUsers.map(u => '<option value="' + u.id + '" ' + (activeAssigneeFilter === u.id ? 'selected' : '') + '>' + ui.esc(auth.displayName(u)) + '</option>').join('') +
                '</select>' +
              '</div>' +
            '</div>' +
          '</div>' +

          // Main View Content Container (Task List or Kanban Board)
          '<div id="tasks-content-area">' +
            (currentViewMode === 'board' ? renderBoardView(filtered) : renderListView(filtered)) +
          '</div>' +
        '</div>';

      wirePageEvents(filtered);

      if (pendingSubtaskFocusId) {
        const focusEl = el.querySelector('[data-quick-sub-title="' + pendingSubtaskFocusId + '"]');
        pendingSubtaskFocusId = null;
        if (focusEl) focusEl.focus();
      }
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
                    '<span class="font-mono tabular-nums text-[11px] font-semibold text-muted">' +
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

    /* ---- Render Single Task Card (Kanban Board) ---- */
    function renderCardHtml(t) {
      const me = auth.current();
      const isMine = me && isUserAssignedOrTagged(t, me);
      const isComplete = t.status === 'Completed';
      const today = todayLocal();
      const progress = RMTP.subtasks ? RMTP.subtasks.computeProgress(t) : { list: [], total: 0, completed: 0, percent: isComplete ? 100 : 0, hasSubtasks: false, overdueCount: 0 };
      const isOverdue = !!(t.dueDate && t.dueDate < today && !isComplete);

      let taggedBadgesHtml = '';
      if (Array.isArray(t.taggedUserNames) && t.taggedUserNames.length > 0) {
        taggedBadgesHtml = '<div class="text-[10.5px] text-muted truncate">' +
          'Tagged: ' + t.taggedUserNames.map(name => '<span class="text-accent font-medium">@' + ui.esc(name) + '</span>').join(', ') +
          '</div>';
      }

      // Compact interactive subtask checklist on board card
      let boardSubtasksHtml = '';
      if (progress.hasSubtasks) {
        const previewSubs = progress.list.slice(0, 4);
        const hiddenCount = progress.list.length - previewSubs.length;
        boardSubtasksHtml =
          '<div class="pt-2 border-t border-line/50 space-y-1.5" onclick="event.stopPropagation()">' +
            previewSubs.map((s) => {
              const subOverdue = RMTP.subtasks.isSubtaskOverdue(s, today);
              return (
                '<div class="flex items-start gap-1.5 text-[11px]">' +
                  '<input type="checkbox" data-sub-toggle="' + t.id + '|' + s.id + '" class="w-3.5 h-3.5 mt-0.5 rounded accent-[var(--ok)] cursor-pointer shrink-0" ' + (s.completed ? 'checked' : '') + ' />' +
                  '<div class="min-w-0 flex-1 leading-tight">' +
                    '<div class="' + (s.completed ? 'line-through text-muted' : 'text-ink') + ' truncate">' + ui.esc(s.title) + '</div>' +
                    '<div class="flex items-center gap-1.5 text-[10px] text-muted mt-0.5">' +
                      '<span class="' + RMTP.subtasks.priorityTextClass(s.priority) + '">' + ui.esc(s.priority) + '</span>' +
                      (s.dueDate ? (
                        '<span class="text-line">\u00b7</span>' +
                        '<span class="font-mono tabular-nums ' + (subOverdue ? 'text-danger font-semibold' : '') + '">' +
                          ui.esc(s.dueDate) + (subOverdue ? ' Overdue' : '') +
                        '</span>'
                      ) : '') +
                    '</div>' +
                  '</div>' +
                '</div>'
              );
            }).join('') +
            (hiddenCount > 0 ? '<div class="text-[10px] text-muted pl-5 font-mono">+' + hiddenCount + ' more subtasks</div>' : '') +
          '</div>';
      }

      return (
        '<div data-task-card="' + t.id + '" class="p-3.5 rounded-xl border bg-panel2/50 hover:bg-panel2 transition hover:border-accent cursor-pointer space-y-2.5 group relative select-none ' + (isMine ? 'border-accent/40' : 'border-line') + '">' +
          // Top Row: Category + Priority
          '<div class="flex items-center justify-between gap-2 flex-wrap">' +
            '<span class="text-[11px] font-medium text-muted">' + ui.esc(t.category || 'General') + '</span>' +
            getPriorityBadge(t.priority) +
          '</div>' +

          // Title & Description
          '<div>' +
            '<h4 class="text-xs font-bold text-ink leading-snug group-hover:text-accent transition-colors line-clamp-2 ' + (isComplete ? 'line-through text-muted' : '') + '">' +
              ui.esc(t.title) +
            '</h4>' +
            (t.description ? (
              '<p class="text-[11px] text-muted line-clamp-2 mt-1 leading-relaxed">' +
                ui.esc(t.description) +
              '</p>'
            ) : '') +
          '</div>' +

          // Main Task Progress Bar (% completed)
          '<div>' +
            (RMTP.subtasks ? RMTP.subtasks.renderProgressBar(progress, { compact: true, statusLabel: t.status || 'Pending' }) : '') +
          '</div>' +

          // Interactive Subtasks Preview
          boardSubtasksHtml +

          // Tagged Users (if any)
          taggedBadgesHtml +

          // Space & Due Details
          '<div class="flex items-center justify-between gap-2 text-[10.5px] font-mono text-muted pt-1.5 border-t border-line/40 flex-wrap">' +
            '<span class="text-ink font-medium flex items-center gap-1 min-w-0 max-w-full" title="' + ui.esc(formatTaskSpaces(t)) + '">' +
              ui.icon('mapPin', 'w-3 h-3 text-accent shrink-0') +
              '<span class="truncate">' + ui.esc(formatTaskSpaces(t)) + '</span>' +
            '</span>' +
            (t.dueDate ? (
              '<span class="flex items-center gap-1 tabular-nums ' + (isOverdue ? 'text-danger font-bold' : '') + '">' +
                ui.icon('calendar', 'w-3 h-3 shrink-0') +
                '<span>' + ui.esc(t.dueDate) + (t.dueTime ? (' ' + ui.esc(t.dueTime)) : '') + (isOverdue ? ' \u00b7 Overdue' : '') + '</span>' +
              '</span>'
            ) : '') +
          '</div>' +

          // Cross-Section Bi-directional Links
          (t.linkedScreeningId ? (
            '<div class="text-[10.5px] text-muted flex items-center justify-between gap-1 pt-1" onclick="event.stopPropagation()">' +
              '<span class="truncate">Screening: ' + ui.esc(t.filmTitle || 'Cinema Screening') + '</span>' +
              '<a href="#/dcp?id=' + encodeURIComponent(t.linkedScreeningId) + '" class="text-accent hover:underline shrink-0 font-semibold">View Booth \u2192</a>' +
            '</div>'
          ) : '') +
          (t.linkedEventId ? (
            '<div class="text-[10.5px] text-muted flex items-center justify-between gap-1 pt-1" onclick="event.stopPropagation()">' +
              '<span class="truncate">Event: ' + ui.esc(t.filmTitle || t.linkedEventName || 'Advancing Event') + '</span>' +
              '<a href="#/advancing?id=' + encodeURIComponent(t.linkedEventId) + '" class="text-accent hover:underline shrink-0 font-semibold">View Event \u2192</a>' +
            '</div>'
          ) : '') +
          (t.linkedFaultId ? (
            '<div class="text-[10.5px] text-muted flex items-center justify-between gap-1 pt-1" onclick="event.stopPropagation()">' +
              '<span class="truncate">Fault: ' + ui.esc(t.filmTitle || 'Equipment Fault') + '</span>' +
              '<a href="#/maintenance" class="text-danger hover:underline shrink-0 font-semibold">Maintenance \u2192</a>' +
            '</div>'
          ) : '') +
          ((t.source === 'hires' || t.category === 'Hires') ? (
            '<div class="text-[10.5px] text-muted flex items-center justify-between gap-1 pt-1" onclick="event.stopPropagation()">' +
              '<span class="truncate">' + ui.esc((t.hiresMeta && t.hiresMeta.requestType) ? ('Hires \u00b7 ' + t.hiresMeta.requestType) : 'Hires Desk Request') + '</span>' +
              '<a href="#/hires?id=' + encodeURIComponent(t.id) + '" class="text-info hover:underline shrink-0 font-semibold">Hires Desk \u2192</a>' +
            '</div>'
          ) : '') +

          // Assignee & Action Buttons
          '<div class="flex items-center justify-between gap-1 pt-1.5 border-t border-line/40 text-[11px]">' +
            '<div class="flex items-center gap-1.5 min-w-0">' +
              '<span class="w-5 h-5 rounded-full bg-accent/15 text-accent font-bold text-[9px] flex items-center justify-center shrink-0">' +
                (t.assignedTechName ? ui.esc(t.assignedTechName[0].toUpperCase()) : '?') +
              '</span>' +
              '<span class="text-ink font-medium truncate text-[11px]">' +
                (t.assignedTechName ? ui.esc(t.assignedTechName) : '<span class="text-muted italic">Unassigned</span>') +
              '</span>' +
            '</div>' +

            '<div class="flex items-center gap-1 shrink-0" onclick="event.stopPropagation()">' +
              (!t.assignedTechId && me && !((t.source === 'hires' || t.category === 'Hires') && !isEligibleHiresTech(me)) ? (
                '<button type="button" data-claim-task="' + t.id + '" class="px-2 py-0.5 rounded text-[10px] font-semibold bg-panel border border-line text-accent hover:border-accent transition" title="Assign this task to yourself">Claim</button>'
              ) : '') +
              (!isComplete ? (
                '<button type="button" data-complete-task="' + t.id + '" class="px-2 py-0.5 rounded text-[10px] font-semibold bg-ok/15 text-ok border border-ok/30 hover:bg-ok/25 transition flex items-center gap-1" title="Mark this job complete">' +
                  ui.icon('check', 'w-3 h-3') + '<span>Done</span>' +
                '</button>'
              ) : (
                '<button type="button" data-complete-task="' + t.id + '" class="text-[10px] text-ok font-semibold hover:underline" title="Re-open task">\u2713 Finished</button>'
              )) +
              '<button type="button" data-delete-task="' + t.id + '" class="p-1 rounded text-muted hover:text-danger hover:bg-danger/10 transition" title="Delete job">' +
                ui.icon('trash', 'w-3.5 h-3.5') +
              '</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }

    /* ---- Render Hierarchical Task List View (Main Item + Progress Bar + Linked Subtasks) ---- */
    function renderListView(tasks) {
      if (tasks.length === 0) {
        return renderEmptyState();
      }

      const today = todayLocal();
      const me = auth.current();

      return (
        '<div class="rounded-xl border border-line bg-panel divide-y divide-line overflow-hidden">' +
          tasks.map((t) => {
            const isDone = t.status === 'Completed';
            const isExpanded = isTaskExpanded(t);
            const progress = RMTP.subtasks ? RMTP.subtasks.computeProgress(t) : { list: [], total: 0, completed: 0, percent: isDone ? 100 : 0, hasSubtasks: false, overdueCount: 0 };
            const isOverdue = !!(t.dueDate && t.dueDate < today && !isDone);
            const statusTextClass = isDone
              ? 'text-ok font-semibold'
              : (t.status === 'In Progress' ? 'text-info font-semibold' : (t.status === 'Blocked' ? 'text-danger font-semibold' : 'text-muted'));

            let linkedLink = '';
            if (t.source === 'hires' || t.category === 'Hires') {
              linkedLink = '<a href="#/hires?id=' + encodeURIComponent(t.id) + '" onclick="event.stopPropagation()" class="text-info font-medium hover:underline">Hires: ' + ui.esc(t.filmTitle || 'Thread') + '</a>';
            } else if (t.linkedScreeningId) {
              linkedLink = '<a href="#/dcp?id=' + encodeURIComponent(t.linkedScreeningId) + '" onclick="event.stopPropagation()" class="text-accent font-medium hover:underline">Screening: ' + ui.esc(t.filmTitle || 'Booth') + '</a>';
            } else if (t.linkedEventId) {
              linkedLink = '<a href="#/advancing?id=' + encodeURIComponent(t.linkedEventId) + '" onclick="event.stopPropagation()" class="text-accent font-medium hover:underline">Event: ' + ui.esc(t.filmTitle || t.linkedEventName || 'Advancing') + '</a>';
            } else if (t.linkedFaultId) {
              linkedLink = '<a href="#/maintenance" onclick="event.stopPropagation()" class="text-danger font-medium hover:underline">Maintenance: ' + ui.esc(t.filmTitle || 'Fault') + '</a>';
            }

            const metaParts = [
              getPriorityBadge(t.priority),
              '<span class="' + statusTextClass + '">' + ui.esc(t.status || 'Pending') + '</span>',
              '<span>' + ui.esc(t.category || 'General') + '</span>',
              '<span class="text-ink font-medium">' + ui.esc(formatTaskSpaces(t)) + '</span>',
              '<span>' + (t.assignedTechName ? ui.esc(t.assignedTechName) : '<span class="italic">Unassigned</span>') +
                (Array.isArray(t.taggedUserNames) && t.taggedUserNames.length ? (' (+' + t.taggedUserNames.length + ' tagged)') : '') +
              '</span>'
            ];
            if (t.dueDate) {
              metaParts.push(
                '<span class="font-mono tabular-nums ' + (isOverdue ? 'text-danger font-semibold' : '') + '">' +
                  'Due ' + ui.esc(t.dueDate) + (t.dueTime ? (' ' + ui.esc(t.dueTime)) : '') +
                  (isOverdue ? ' \u00b7 Overdue' : '') +
                '</span>'
              );
            }
            if (linkedLink) metaParts.push(linkedLink);

            // Linked Subtasks Rows
            const subtasksDrawerHtml = isExpanded ? (
              '<div class="border-t border-line/60 bg-panel2/30 px-4 sm:pl-12 sm:pr-5 py-3 space-y-2" onclick="event.stopPropagation()">' +
                '<div class="flex items-center justify-between gap-2 text-[10.5px] font-mono uppercase tracking-wider text-muted">' +
                  '<span>Linked Subtasks (' + progress.completed + '/' + progress.total + ')</span>' +
                  '<span class="hidden sm:inline">Independent Priority &amp; Deadline</span>' +
                '</div>' +

                (progress.list.length > 0 ? (
                  '<div class="divide-y divide-line/50">' +
                    progress.list.map((s) => {
                      const subOverdue = RMTP.subtasks.isSubtaskOverdue(s, today);
                      const subDueToday = !s.completed && s.dueDate && s.dueDate === today;
                      return (
                        '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2 group/sub">' +
                          '<div class="flex items-start gap-2.5 min-w-0 flex-1">' +
                            '<input type="checkbox" data-sub-toggle="' + t.id + '|' + s.id + '" class="w-4 h-4 mt-0.5 rounded accent-[var(--ok)] cursor-pointer shrink-0" ' + (s.completed ? 'checked' : '') + ' />' +
                            '<div class="min-w-0 flex-1">' +
                              '<div class="text-xs font-medium leading-snug ' + (s.completed ? 'line-through text-muted' : 'text-ink') + '">' +
                                ui.esc(s.title) +
                              '</div>' +
                              (subOverdue ? (
                                '<div class="text-[10.5px] text-danger font-semibold mt-0.5">Overdue deadline</div>'
                              ) : (subDueToday ? (
                                '<div class="text-[10.5px] text-accent font-semibold mt-0.5">Due today</div>'
                              ) : '')) +
                            '</div>' +
                          '</div>' +

                          '<div class="flex items-center gap-2 pl-6 sm:pl-0 shrink-0 flex-wrap">' +
                            '<select data-sub-prio="' + t.id + '|' + s.id + '" aria-label="Subtask priority" class="bg-panel border border-line rounded px-2 py-1 text-[11px] cursor-pointer focus:border-accent outline-none ' + RMTP.subtasks.priorityTextClass(s.priority) + '">' +
                              PRIORITIES.map((p) => '<option value="' + p + '" ' + (s.priority === p ? 'selected' : '') + '>' + p + '</option>').join('') +
                            '</select>' +
                            '<input type="date" data-sub-date="' + t.id + '|' + s.id + '" aria-label="Subtask deadline" value="' + ui.esc(s.dueDate || '') + '" class="bg-panel border ' + (subOverdue ? 'border-danger/60 text-danger' : 'border-line text-muted') + ' rounded px-2 py-0.5 text-[11px] font-mono tabular-nums focus:border-accent outline-none" />' +
                            '<button type="button" data-sub-delete="' + t.id + '|' + s.id + '" class="p-1 rounded text-muted hover:text-danger hover:bg-danger/10 transition" title="Remove subtask">' +
                              ui.icon('trash', 'w-3.5 h-3.5') +
                            '</button>' +
                          '</div>' +
                        '</div>'
                      );
                    }).join('') +
                  '</div>'
                ) : (
                  '<div class="text-xs text-muted py-1">No subtasks linked yet. Add one below to track step-by-step progress.</div>'
                )) +

                // Inline Quick-Add Subtask Row
                '<form data-quick-sub-form="' + t.id + '" class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2 border-t border-line/50">' +
                  '<input type="text" data-quick-sub-title="' + t.id + '" class="field !py-1.5 text-xs flex-1" placeholder="Add linked subtask (e.g. Check cabling, Test mic channels)\u2026" />' +
                  '<div class="flex items-center gap-2 shrink-0">' +
                    '<select data-quick-sub-prio="' + t.id + '" aria-label="New subtask priority" class="field !py-1.5 !w-auto text-xs">' +
                      PRIORITIES.map((p) => '<option value="' + p + '" ' + (p === 'Medium' ? 'selected' : '') + '>' + p + '</option>').join('') +
                    '</select>' +
                    '<input type="date" data-quick-sub-date="' + t.id + '" aria-label="New subtask deadline" value="' + ui.esc(t.dueDate || '') + '" class="field !py-1.5 !w-auto text-xs font-mono tabular-nums" />' +
                    '<button type="submit" class="btn btn-secondary !py-1.5 !px-3 text-xs font-semibold shrink-0 flex items-center gap-1">' +
                      ui.icon('plus', 'w-3.5 h-3.5') + '<span>Add</span>' +
                    '</button>' +
                  '</div>' +
                '</form>' +
              '</div>'
            ) : '';

            return (
              '<div data-task-item="' + t.id + '" class="transition ' + (isDone ? 'bg-panel2/20' : '') + '">' +
                // Main Task Row
                '<div class="px-4 py-3.5 hover:bg-panel2/30 transition">' +
                  '<div class="flex items-start gap-2.5">' +
                    // Expand / Collapse Subtasks Toggle
                    '<button type="button" data-toggle-expand="' + t.id + '" class="mt-0.5 p-1 -ml-1 rounded text-muted hover:text-ink hover:bg-panel2 transition shrink-0" title="' + (isExpanded ? 'Hide subtasks' : 'Show subtasks') + '" aria-expanded="' + (isExpanded ? 'true' : 'false') + '">' +
                      '<svg class="w-3.5 h-3.5 transition-transform duration-150 ' + (isExpanded ? 'rotate-90' : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' +
                    '</button>' +

                    // Main Task Completion Checkbox
                    '<input type="checkbox" data-toggle-complete="' + t.id + '" class="w-4 h-4 mt-1 rounded accent-[var(--ok)] cursor-pointer shrink-0" ' + (isDone ? 'checked' : '') + ' title="Mark main job complete" />' +

                    // Main Content Column
                    '<div class="min-w-0 flex-1 space-y-2">' +
                      '<div class="flex flex-col lg:flex-row lg:items-start justify-between gap-2">' +
                        '<div class="min-w-0 flex-1">' +
                          '<button type="button" data-edit-task="' + t.id + '" class="text-left text-sm font-bold text-ink hover:text-accent transition leading-snug ' + (isDone ? 'line-through text-muted' : '') + '">' +
                            ui.esc(t.title) +
                          '</button>' +
                          (t.description ? (
                            '<p class="text-xs text-muted line-clamp-1 mt-0.5">' + ui.esc(t.description) + '</p>'
                          ) : '') +
                          '<div class="flex items-center flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted mt-1.5">' +
                            metaParts.join('<span class="text-line">\u00b7</span>') +
                          '</div>' +
                        '</div>' +

                        // Action Controls
                        '<div class="flex items-center gap-1.5 shrink-0">' +
                          '<button type="button" data-add-sub-trigger="' + t.id + '" class="btn btn-ghost !py-1 !px-2 text-[11px] font-semibold text-ink hover:text-accent border border-line/80 flex items-center gap-1" title="Add linked subtask">' +
                            ui.icon('plus', 'w-3 h-3') + '<span>Subtask</span>' +
                          '</button>' +
                          (!t.assignedTechId && me && !((t.source === 'hires' || t.category === 'Hires') && !isEligibleHiresTech(me)) ? (
                            '<button type="button" data-claim-task="' + t.id + '" class="btn btn-ghost !py-1 !px-2 text-[11px] font-semibold text-accent border border-line/80" title="Assign to me">Claim</button>'
                          ) : '') +
                          '<button type="button" data-edit-task="' + t.id + '" class="btn btn-ghost !py-1 !px-2 text-xs text-muted hover:text-accent" title="Edit main job">' +
                            ui.icon('edit', 'w-3.5 h-3.5') +
                          '</button>' +
                          '<button type="button" data-delete-task="' + t.id + '" class="btn btn-ghost !py-1 !px-2 text-xs text-muted hover:text-danger hover:bg-danger/10" title="Delete main job">' +
                            ui.icon('trash', 'w-3.5 h-3.5') +
                          '</button>' +
                        '</div>' +
                      '</div>' +

                      // Main Task Progress Bar (% completed built off the main task + subtasks)
                      '<div class="pt-0.5 max-w-2xl">' +
                        (RMTP.subtasks ? RMTP.subtasks.renderProgressBar(progress, { statusLabel: t.status || 'Pending' }) : '') +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                '</div>' +

                // Linked Subtasks Drawer
                subtasksDrawerHtml +
              '</div>'
            );
          }).join('') +
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
            'There are no tasks matching the selected filters. Create a main job below and break it down into linked subtasks with their own priorities and deadlines.' +
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
    function wirePageEvents() {
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
        activeStatusFilter = activeStatusFilter === 'Pending' ? 'all' : 'Pending';
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

      // Search input (reuses exact getFilteredTasks logic including subtask title search)
      el.querySelector('#task-search-input')?.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        const filteredArea = el.querySelector('#tasks-content-area');
        if (filteredArea) {
          const { filtered: filteredNow } = getFilteredTasks();
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

      wireDynamicItemClicks();
    }

    function wireDynamicItemClicks() {
      // Empty state add button (may be inside dynamic content area)
      el.querySelector('#btn-empty-add')?.addEventListener('click', () => {
        openTaskModal(null, null, renderTasksPage);
      });

      // Quick add in board column
      el.querySelectorAll('[data-quick-add-col]').forEach(btn => {
        btn.addEventListener('click', () => {
          const colStatus = btn.getAttribute('data-quick-add-col');
          openTaskModal(null, { status: colStatus }, renderTasksPage);
        });
      });

      // Expand / Collapse subtasks drawer
      el.querySelectorAll('[data-toggle-expand]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const tid = btn.getAttribute('data-toggle-expand');
          const task = store.find('tasks', tid);
          if (!task) return;
          if (isTaskExpanded(task)) {
            expandedTaskIds.delete(tid);
            collapsedTaskIds.add(tid);
          } else {
            collapsedTaskIds.delete(tid);
            expandedTaskIds.add(tid);
          }
          renderTasksPage();
        });
      });

      // "+ Subtask" button on main task row (expands and focuses quick-add input)
      el.querySelectorAll('[data-add-sub-trigger]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const tid = btn.getAttribute('data-add-sub-trigger');
          collapsedTaskIds.delete(tid);
          expandedTaskIds.add(tid);
          pendingSubtaskFocusId = tid;
          renderTasksPage();
        });
      });

      // Inline Quick-Add Subtask Form submit
      el.querySelectorAll('[data-quick-sub-form]').forEach((form) => {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const tid = form.getAttribute('data-quick-sub-form');
          const titleInp = form.querySelector('[data-quick-sub-title]');
          const prioSel = form.querySelector('[data-quick-sub-prio]');
          const dateInp = form.querySelector('[data-quick-sub-date]');
          const titleVal = titleInp ? titleInp.value.trim() : '';
          if (!titleVal) {
            if (titleInp) titleInp.focus();
            return;
          }
          RMTP.tasks.addSubtask(tid, {
            title: titleVal,
            priority: prioSel ? prioSel.value : 'Medium',
            dueDate: dateInp ? dateInp.value : '',
            completed: false,
          }, () => {
            collapsedTaskIds.delete(tid);
            expandedTaskIds.add(tid);
            pendingSubtaskFocusId = tid;
            renderTasksPage();
          });
        });
      });

      // Subtask completion toggle (List & Board)
      el.querySelectorAll('[data-sub-toggle]').forEach((cb) => {
        cb.addEventListener('change', (e) => {
          e.stopPropagation();
          const [tid, sid] = String(cb.getAttribute('data-sub-toggle') || '').split('|');
          if (!tid || !sid) return;
          RMTP.tasks.toggleSubtask(tid, sid, () => {
            renderTasksPage();
          });
        });
      });

      // Subtask inline priority change
      el.querySelectorAll('[data-sub-prio]').forEach((sel) => {
        sel.addEventListener('change', (e) => {
          e.stopPropagation();
          const [tid, sid] = String(sel.getAttribute('data-sub-prio') || '').split('|');
          if (!tid || !sid) return;
          RMTP.tasks.updateSubtask(tid, sid, { priority: sel.value }, () => {
            renderTasksPage();
          });
        });
      });

      // Subtask inline deadline change
      el.querySelectorAll('[data-sub-date]').forEach((inp) => {
        inp.addEventListener('change', (e) => {
          e.stopPropagation();
          const [tid, sid] = String(inp.getAttribute('data-sub-date') || '').split('|');
          if (!tid || !sid) return;
          RMTP.tasks.updateSubtask(tid, sid, { dueDate: inp.value }, () => {
            renderTasksPage();
          });
        });
      });

      // Subtask delete button
      el.querySelectorAll('[data-sub-delete]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const [tid, sid] = String(btn.getAttribute('data-sub-delete') || '').split('|');
          if (!tid || !sid) return;
          RMTP.tasks.deleteSubtask(tid, sid, () => {
            renderTasksPage();
          });
        });
      });

      // Claim task buttons
      el.querySelectorAll('[data-claim-task]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const tid = btn.getAttribute('data-claim-task');
          const task = store.find('tasks', tid);
          const me = auth.current();
          if (task && me) {
            if ((task.source === 'hires' || task.category === 'Hires') && !isEligibleHiresTech(me)) {
              ui.toast('Hires tasks can only be claimed by Technical Managers, Senior Techs, or Duty Techs.', 'info');
              return;
            }
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

      // Complete task toggles (cards & list checkboxes)
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

      // Edit / View Card or Edit Trigger Click
      el.querySelectorAll('[data-task-card], [data-edit-task]').forEach((itemEl) => {
        itemEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const tid = itemEl.getAttribute('data-task-card') || itemEl.getAttribute('data-edit-task');
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

  function isEligibleHiresTech(u) {
    if (RMTP.hires && typeof RMTP.hires.isEligibleHiresTech === 'function') {
      return RMTP.hires.isEligibleHiresTech(u);
    }
    if (!u || u.status === 'pending') return false;
    if (auth.isHiresTeam && auth.isHiresTeam(u)) return false;
    if (auth.isFreelancer && auth.isFreelancer(u)) return false;
    const roleKey = (auth.resolveUserRoleKey && auth.resolveUserRoleKey(u)) || '';
    if (roleKey) {
      return roleKey === 'Technical Manager' || roleKey === 'Senior Tech' || roleKey === 'Duty Tech';
    }
    const pos = String(u.position || u.role || '').trim().toLowerCase();
    return (
      pos === 'technical manager' || pos === 'tech manager' ||
      pos.includes('technical manager') || pos.includes('tech manager') ||
      pos === 'senior tech' || pos.includes('senior tech') ||
      pos === 'duty tech' || pos.includes('duty tech')
    );
  }

  /* ---- Open Task Edit / Creation Modal (Globally Accessible) ---- */
  function openTaskModal(existingTask = null, defaults = null, onSaved = null) {
    const isNew = !existingTask;
    const allUsers = (store.all('users') || []).filter((u) => u && u.status !== 'pending');
    const allDcps = (RMTP.getUpcomingActiveScreenings ? RMTP.getUpcomingActiveScreenings(existingTask ? existingTask.linkedScreeningId : null) : (store.all('dcps') || []));
    const allAdv = (RMTP.getUpcomingActiveEvents ? RMTP.getUpcomingActiveEvents(existingTask ? existingTask.linkedEventId : null) : (store.all('advancing') || []));
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
      dueDate: RMTP.localDateStr ? RMTP.localDateStr() : new Date().toISOString().slice(0, 10),
      dueTime: '17:00',
      subtasks: [],
      linkedScreeningId: '',
      linkedEventId: '',
      linkedFaultId: '',
      source: 'manual',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }, defaults || {});

    // Ensure tagged, spaces & subtasks arrays exist
    if (!Array.isArray(task.taggedUserIds)) task.taggedUserIds = [];
    if (!Array.isArray(task.taggedUserNames)) task.taggedUserNames = [];
    let selectedSpaces = getTaskSpaces(task);
    let draftSubtasks = RMTP.subtasks ? RMTP.subtasks.normalize(task.subtasks) : [];

    const allSpaceChoices = (() => {
      const base = Array.isArray(RMTP.SPACES) ? RMTP.SPACES.slice() : [];
      const seen = new Set(base.map((s) => s.toLowerCase()));
      selectedSpaces.forEach((s) => {
        if (!seen.has(s.toLowerCase())) {
          seen.add(s.toLowerCase());
          base.push(s);
        }
      });
      return base;
    })();

    const renderSpaceCheckboxes = (activeList) => {
      const activeSet = new Set((activeList || []).map((s) => s.toLowerCase()));
      return allSpaceChoices.map((s) => {
        const checked = activeSet.has(s.toLowerCase());
        return (
          '<label class="flex items-center gap-2 p-1.5 rounded-lg border cursor-pointer transition select-none ' +
            (checked ? 'bg-accent/10 border-accent/60 text-ink' : 'bg-panel border-line hover:border-accent/50 text-muted') + '">' +
            '<input type="checkbox" name="tk-space-item" value="' + ui.esc(s) + '" class="w-3.5 h-3.5 accent-[var(--accent)] shrink-0" ' + (checked ? 'checked' : '') + ' />' +
            '<span class="truncate text-[11px] font-medium ' + (checked ? 'text-ink' : '') + '">' + ui.esc(s) + '</span>' +
          '</label>'
        );
      }).join('');
    };

    const isHiresTaskMode = (catVal) => task.source === 'hires' || catVal === 'Hires';
    const getEligibleUsersForCategory = (catVal) => {
      if (isHiresTaskMode(catVal)) {
        return allUsers.filter(isEligibleHiresTech).sort((a, b) => auth.displayName(a).localeCompare(auth.displayName(b)));
      }
      return allUsers.slice().sort((a, b) => auth.displayName(a).localeCompare(auth.displayName(b)));
    };
    const initialHiresMode = isHiresTaskMode(task.category);
    if (isNew && initialHiresMode && task.assignedTechId) {
      const defAssigned = store.find('users', task.assignedTechId);
      if (defAssigned && !isEligibleHiresTech(defAssigned)) {
        task.assignedTechId = '';
        task.assignedTechName = '';
      }
    }
    const initialUsers = getEligibleUsersForCategory(task.category);
    const renderAssigneeOptions = (usersList, selectedId) => (
      '<option value="">\u2014 Unassigned (Anyone can claim) \u2014</option>' +
      usersList.map((u) => (
        '<option value="' + u.id + '" ' + (selectedId === u.id ? 'selected' : '') + '>' +
          ui.esc(auth.displayName(u)) + ' (' + ui.esc(u.position || 'Tech') + ')' +
        '</option>'
      )).join('')
    );
    const renderTaggedCheckboxes = (usersList, selectedIds) => {
      const selSet = new Set(selectedIds || []);
      if (!usersList.length) {
        return '<div class="col-span-full text-[11px] text-muted py-1">No eligible technicians found.</div>';
      }
      return usersList.map((u) => {
        const isTagged = selSet.has(u.id);
        return (
          '<label class="flex items-center gap-2 p-1.5 rounded-lg bg-panel border border-line hover:border-accent cursor-pointer transition select-none">' +
            '<input type="checkbox" name="tk-tag-member" value="' + u.id + '" class="w-3.5 h-3.5 accent-[var(--accent)]" ' + (isTagged ? 'checked' : '') + ' />' +
            '<span class="truncate text-[11px] font-medium text-ink">' + ui.esc(auth.displayName(u)) + '</span>' +
          '</label>'
        );
      }).join('');
    };

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

          // Category, Priority & Status
          '<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">' +
            '<div>' +
              '<label class="block font-semibold text-muted mb-1">Category</label>' +
              '<select id="tk-cat" class="field">' +
                CATEGORIES.map((c) => '<option value="' + c + '" ' + (task.category === c ? 'selected' : '') + '>' + c + '</option>').join('') +
              '</select>' +
            '</div>' +
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

          // Multi-Space Picker
          '<div class="p-3 bg-panel2/50 rounded-xl border border-line">' +
            '<div class="flex items-center justify-between gap-2 flex-wrap mb-2">' +
              '<label class="font-semibold text-muted flex items-center gap-1.5">' +
                ui.icon('mapPin', 'w-3.5 h-3.5 text-accent') +
                '<span>Venue Spaces / Rooms</span>' +
                '<span id="tk-spaces-summary" class="font-mono tabular-nums text-[11px] font-semibold text-accent">' +
                  (selectedSpaces.length ? ('(' + selectedSpaces.length + ' selected)') : '(Venue-wide)') +
                '</span>' +
              '</label>' +
              '<div class="flex items-center gap-2 text-[11px]">' +
                '<button type="button" id="tk-spaces-all" class="text-accent hover:underline font-medium">Select all</button>' +
                '<span class="text-line">\u00b7</span>' +
                '<button type="button" id="tk-spaces-clear" class="text-muted hover:text-ink hover:underline">Clear</button>' +
              '</div>' +
            '</div>' +
            '<div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5" id="tk-spaces-container">' +
              renderSpaceCheckboxes(selectedSpaces) +
            '</div>' +
          '</div>' +

          // Lead Assignee Picker
          '<div>' +
            '<div class="flex items-center justify-between mb-1">' +
              '<label class="font-semibold text-muted">Primary Assigned Technician</label>' +
              (me ? (
                '<button type="button" id="tk-assign-me" class="text-accent text-[11px] font-semibold hover:underline ' + (initialHiresMode && !isEligibleHiresTech(me) ? 'hidden' : '') + '">' +
                  'Assign to Me (' + ui.esc(auth.displayName(me)) + ')' +
                '</button>'
              ) : '') +
            '</div>' +
            '<select id="tk-user" class="field font-medium">' +
              renderAssigneeOptions(initialUsers, task.assignedTechId) +
            '</select>' +
          '</div>' +

          // Tag Additional Team Members (Multi-select pills)
          '<div class="p-3 bg-panel2/50 rounded-xl border border-line">' +
            '<div class="flex items-center justify-between gap-2 flex-wrap mb-1.5">' +
              '<label class="block font-semibold text-muted">' +
                'Tag Additional Team Members (They will see this on their Jobs list)' +
              '</label>' +
              '<span id="tk-hires-tech-note" class="text-[10.5px] font-medium text-muted ' + (initialHiresMode ? '' : 'hidden') + '">Tech Manager, Senior Tech &amp; Duty Tech only</span>' +
            '</div>' +
            '<div class="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-36 overflow-y-auto pr-1" id="tk-tag-members-container">' +
              renderTaggedCheckboxes(initialUsers, task.taggedUserIds) +
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
                allAdv.map((e) => (
                  '<option value="adv|' + e.id + '" ' + (task.linkedEventId === e.id ? 'selected' : '') + '>' +
                    '\uD83D\uDCCB ' + (e.date ? ui.formatDate(e.date) : 'TBC') + ' \u2014 ' + ui.esc(e.name) + ' (' + ui.esc(Array.isArray(e.space) ? e.space.join(', ') : e.space) + ')' +
                  '</option>'
                )).join('') +
              '</optgroup>' +
              '<optgroup label="Cinema Screenings (Pre-Screening Tracker)">' +
                allDcps.map((d) => (
                  '<option value="dcp|' + d.id + '" ' + (task.linkedScreeningId === d.id ? 'selected' : '') + '>' +
                    '\uD83C\uDFAC ' + (d.eventDate ? ui.formatDate(d.eventDate) : 'TBC') + ' \u2014 ' + ui.esc(d.filmTitle || d.eventName) + ' (' + ui.esc(d.screen) + ')' +
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
            '<textarea id="tk-desc" class="field" rows="3" placeholder="Provide step-by-step instructions or notes for the technician (tip: use @Name to mention team members)\u2026">' + ui.esc(task.description || '') + '</textarea>' +
          '</div>' +

          // Linked Subtasks & Progress Builder
          '<div class="p-3.5 rounded-xl bg-panel2/40 border border-line space-y-3">' +
            '<div class="flex items-center justify-between gap-2 flex-wrap">' +
              '<label class="font-semibold text-ink">Linked Subtasks &amp; Completion Progress</label>' +
              '<span class="text-[11px] text-muted">Each subtask has its own priority &amp; deadline</span>' +
            '</div>' +
            '<div id="tk-subtasks-progress"></div>' +
            '<div id="tk-subtasks-list" class="divide-y divide-line/50"></div>' +
            '<div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2 border-t border-line/60">' +
              '<input type="text" id="tk-new-sub-title" class="field !py-1.5 text-xs flex-1" placeholder="Add subtask title\u2026" />' +
              '<select id="tk-new-sub-prio" class="field !py-1.5 !w-auto text-xs">' +
                PRIORITIES.map((p) => '<option value="' + p + '" ' + (p === 'Medium' ? 'selected' : '') + '>' + p + '</option>').join('') +
              '</select>' +
              '<input type="date" id="tk-new-sub-date" class="field !py-1.5 !w-auto text-xs font-mono tabular-nums" value="' + ui.esc(task.dueDate || '') + '" />' +
              '<button type="button" id="tk-add-sub-btn" class="btn btn-secondary !py-1.5 !px-3 text-xs font-semibold shrink-0 flex items-center gap-1">' +
                ui.icon('plus', 'w-3.5 h-3.5') + '<span>Add</span>' +
              '</button>' +
            '</div>' +
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

    // Refresh eligible assignee & tagged tech options when category toggles Hires
    const catSelEl = m.root.querySelector('#tk-cat');
    if (catSelEl) {
      catSelEl.addEventListener('change', () => {
        const curCat = catSelEl.value;
        const hiresRestricted = isHiresTaskMode(curCat);
        const nextUsers = getEligibleUsersForCategory(curCat);
        const eligibleIds = new Set(nextUsers.map((u) => u.id));
        const userSel = m.root.querySelector('#tk-user');
        if (userSel) {
          const prevVal = userSel.value;
          const nextVal = eligibleIds.has(prevVal) ? prevVal : '';
          userSel.innerHTML = renderAssigneeOptions(nextUsers, nextVal);
          userSel.value = nextVal;
        }
        const tagBox = m.root.querySelector('#tk-tag-members-container');
        if (tagBox) {
          const checkedIds = Array.from(m.root.querySelectorAll('input[name="tk-tag-member"]:checked'))
            .map((cb) => cb.value)
            .filter((id) => eligibleIds.has(id));
          tagBox.innerHTML = renderTaggedCheckboxes(nextUsers, checkedIds);
        }
        const assignMeBtn = m.root.querySelector('#tk-assign-me');
        if (assignMeBtn && me) {
          assignMeBtn.classList.toggle('hidden', hiresRestricted && !isEligibleHiresTech(me));
        }
        const hiresNote = m.root.querySelector('#tk-hires-tech-note');
        if (hiresNote) hiresNote.classList.toggle('hidden', !hiresRestricted);
      });
    }

    // Quick Assign to Me button
    m.root.querySelector('#tk-assign-me')?.addEventListener('click', () => {
      const curCat = m.root.querySelector('#tk-cat')?.value || task.category;
      if (me && (!isHiresTaskMode(curCat) || isEligibleHiresTech(me))) {
        const userSel = m.root.querySelector('#tk-user');
        if (userSel) userSel.value = me.id;
      }
    });

    // Multi-space selection state helpers
    function syncSpacesUI() {
      const box = m.root.querySelector('#tk-spaces-container');
      const summary = m.root.querySelector('#tk-spaces-summary');
      if (box) {
        box.innerHTML = renderSpaceCheckboxes(selectedSpaces);
        box.querySelectorAll('input[name="tk-space-item"]').forEach((cb) => {
          cb.addEventListener('change', () => {
            selectedSpaces = Array.from(box.querySelectorAll('input[name="tk-space-item"]:checked')).map((el) => el.value);
            syncSpacesUI();
          });
        });
      }
      if (summary) {
        summary.textContent = selectedSpaces.length
          ? ('(' + selectedSpaces.length + ' selected)')
          : '(Venue-wide)';
      }
    }
    syncSpacesUI();

    m.root.querySelector('#tk-spaces-all')?.addEventListener('click', () => {
      selectedSpaces = allSpaceChoices.slice();
      syncSpacesUI();
    });
    m.root.querySelector('#tk-spaces-clear')?.addEventListener('click', () => {
      selectedSpaces = [];
      syncSpacesUI();
    });

    // Auto-fill Spaces when a linked event, screening, or maintenance fault is selected
    m.root.querySelector('#tk-link-select')?.addEventListener('change', (e) => {
      const val = e.target.value;
      if (!val) return;
      const [type, id] = val.split('|');
      const dateInp = m.root.querySelector('#tk-date');
      const titleInp = m.root.querySelector('#tk-title');
      if (type === 'adv') {
        const ev = store.find('advancing', id);
        if (ev) {
          const evSpaces = parseSpaceList(ev.spaces && ev.spaces.length ? ev.spaces : ev.space);
          if (evSpaces.length) {
            selectedSpaces = evSpaces;
            syncSpacesUI();
          }
          if (dateInp && ev.date) dateInp.value = ev.date;
          if (titleInp && !titleInp.value.trim()) titleInp.value = 'Prep for ' + ev.name;
        }
      } else if (type === 'dcp') {
        const sc = store.find('dcps', id);
        if (sc) {
          const scSpaces = parseSpaceList(sc.screen);
          if (scSpaces.length) {
            selectedSpaces = scSpaces;
            syncSpacesUI();
          }
          if (dateInp && sc.eventDate) dateInp.value = sc.eventDate;
          if (titleInp && !titleInp.value.trim()) titleInp.value = (sc.filmTitle || sc.eventName) + ' Pre-Screening Follow-up';
        }
      } else if (type === 'fault') {
        const flt = store.find('maintenance', id);
        if (flt) {
          const fltSpaces = parseSpaceList(flt.space);
          if (fltSpaces.length) {
            selectedSpaces = fltSpaces;
            syncSpacesUI();
          }
          if (titleInp && !titleInp.value.trim()) titleInp.value = 'Repair: ' + (flt.equipment || flt.description);
        }
      }
    });

    // Modal Linked Subtasks Builder & Live Progress Bar
    function renderModalSubtasks() {
      const progHost = m.root.querySelector('#tk-subtasks-progress');
      const listHost = m.root.querySelector('#tk-subtasks-list');
      const curStatus = m.root.querySelector('#tk-status')?.value || task.status || 'Pending';
      if (progHost && RMTP.subtasks) {
        const prog = RMTP.subtasks.computeProgress({ status: curStatus, subtasks: draftSubtasks });
        progHost.innerHTML = RMTP.subtasks.renderProgressBar(prog, { statusLabel: curStatus });
      }
      if (!listHost) return;
      if (!draftSubtasks.length) {
        listHost.innerHTML = '<div class="text-[11px] text-muted py-1.5">No subtasks added yet.</div>';
        return;
      }
      listHost.innerHTML = draftSubtasks.map((s, idx) => (
        '<div class="flex flex-col sm:flex-row sm:items-center gap-2 py-2" data-modal-sub-idx="' + idx + '">' +
          '<div class="flex items-center gap-2 flex-1 min-w-0">' +
            '<input type="checkbox" data-msub-done="' + idx + '" class="w-4 h-4 rounded accent-[var(--ok)] cursor-pointer shrink-0" ' + (s.completed ? 'checked' : '') + ' />' +
            '<input type="text" data-msub-title="' + idx + '" value="' + ui.esc(s.title) + '" class="field !py-1 text-xs flex-1 ' + (s.completed ? 'line-through text-muted' : '') + '" />' +
          '</div>' +
          '<div class="flex items-center gap-1.5 pl-6 sm:pl-0 shrink-0">' +
            '<select data-msub-prio="' + idx + '" class="field !py-1 !w-auto text-[11px] ' + (RMTP.subtasks ? RMTP.subtasks.priorityTextClass(s.priority) : '') + '">' +
              PRIORITIES.map((p) => '<option value="' + p + '" ' + (s.priority === p ? 'selected' : '') + '>' + p + '</option>').join('') +
            '</select>' +
            '<input type="date" data-msub-date="' + idx + '" value="' + ui.esc(s.dueDate || '') + '" class="field !py-1 !w-auto text-[11px] font-mono tabular-nums" />' +
            '<button type="button" data-msub-del="' + idx + '" class="p-1 rounded text-muted hover:text-danger hover:bg-danger/10 transition" title="Remove subtask">' +
              ui.icon('trash', 'w-3.5 h-3.5') +
            '</button>' +
          '</div>' +
        '</div>'
      )).join('');

      listHost.querySelectorAll('[data-msub-done]').forEach((cb) => {
        cb.addEventListener('change', () => {
          const i = Number(cb.getAttribute('data-msub-done'));
          if (!draftSubtasks[i]) return;
          draftSubtasks[i].completed = cb.checked;
          draftSubtasks[i].completedAt = cb.checked ? new Date().toISOString() : '';
          draftSubtasks[i].completedBy = cb.checked ? (me ? auth.displayName(me) : 'Staff Tech') : '';
          const statusSel = m.root.querySelector('#tk-status');
          if (statusSel && draftSubtasks.length) {
            const doneCount = draftSubtasks.filter((x) => x.completed).length;
            if (doneCount === draftSubtasks.length) statusSel.value = 'Completed';
            else if (doneCount > 0 && (statusSel.value === 'Pending' || statusSel.value === 'Completed')) statusSel.value = 'In Progress';
            else if (doneCount === 0 && statusSel.value === 'Completed') statusSel.value = 'Pending';
          }
          renderModalSubtasks();
        });
      });
      listHost.querySelectorAll('[data-msub-title]').forEach((inp) => {
        inp.addEventListener('input', () => {
          const i = Number(inp.getAttribute('data-msub-title'));
          if (draftSubtasks[i]) draftSubtasks[i].title = inp.value;
        });
      });
      listHost.querySelectorAll('[data-msub-prio]').forEach((sel) => {
        sel.addEventListener('change', () => {
          const i = Number(sel.getAttribute('data-msub-prio'));
          if (draftSubtasks[i]) {
            draftSubtasks[i].priority = sel.value;
            renderModalSubtasks();
          }
        });
      });
      listHost.querySelectorAll('[data-msub-date]').forEach((inp) => {
        inp.addEventListener('change', () => {
          const i = Number(inp.getAttribute('data-msub-date'));
          if (draftSubtasks[i]) {
            draftSubtasks[i].dueDate = inp.value;
            renderModalSubtasks();
          }
        });
      });
      listHost.querySelectorAll('[data-msub-del]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const i = Number(btn.getAttribute('data-msub-del'));
          draftSubtasks.splice(i, 1);
          renderModalSubtasks();
        });
      });
    }

    function addDraftSubtaskFromInputs() {
      const tInp = m.root.querySelector('#tk-new-sub-title');
      const pSel = m.root.querySelector('#tk-new-sub-prio');
      const dInp = m.root.querySelector('#tk-new-sub-date');
      const val = tInp ? tInp.value.trim() : '';
      if (!val) {
        if (tInp) tInp.focus();
        return;
      }
      const nextSub = RMTP.subtasks ? RMTP.subtasks.normalizeOne({
        title: val,
        priority: pSel ? pSel.value : 'Medium',
        dueDate: dInp ? dInp.value : '',
        completed: false,
      }) : null;
      if (nextSub) {
        draftSubtasks.push(nextSub);
        if (tInp) { tInp.value = ''; tInp.focus(); }
        renderModalSubtasks();
      }
    }

    m.root.querySelector('#tk-add-sub-btn')?.addEventListener('click', addDraftSubtaskFromInputs);
    m.root.querySelector('#tk-new-sub-title')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addDraftSubtaskFromInputs();
      }
    });
    m.root.querySelector('#tk-status')?.addEventListener('change', renderModalSubtasks);
    renderModalSubtasks();

    // Save handler
    m.root.querySelector('#tk-save')?.addEventListener('click', () => {
      const titleVal = m.root.querySelector('#tk-title').value.trim();
      if (!titleVal) {
        ui.toast('Job title is required', 'danger');
        m.root.querySelector('#tk-title').focus();
        return;
      }

      // If user typed a subtask title in the quick-add input without clicking Add, include it cleanly
      const pendingSubTitle = m.root.querySelector('#tk-new-sub-title')?.value.trim();
      if (pendingSubTitle) {
        addDraftSubtaskFromInputs();
      }

      const selectedCat = m.root.querySelector('#tk-cat').value;
      const enforceHiresTechs = isHiresTaskMode(selectedCat);
      const userSel = m.root.querySelector('#tk-user');
      let assignedId = userSel.value;
      let assignedObj = assignedId ? store.find('users', assignedId) : null;
      if (enforceHiresTechs && assignedObj && !isEligibleHiresTech(assignedObj)) {
        assignedId = '';
        assignedObj = null;
      }

      // Tagged users
      const taggedIds = [];
      const taggedNames = [];
      m.root.querySelectorAll('input[name="tk-tag-member"]:checked').forEach(cb => {
        const u = store.find('users', cb.value);
        if (enforceHiresTechs && (!u || !isEligibleHiresTech(u))) return;
        taggedIds.push(cb.value);
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
      const actorName = me ? auth.displayName(me) : 'Staff Tech';
      const nowIso = new Date().toISOString();
      let cleanSubtasks = RMTP.subtasks ? RMTP.subtasks.normalize(draftSubtasks) : [];
      if (newStatus === 'Completed' && cleanSubtasks.length) {
        cleanSubtasks = cleanSubtasks.map((s) => Object.assign({}, s, {
          completed: true,
          completedAt: s.completedAt || nowIso,
          completedBy: s.completedBy || actorName,
        }));
      }

      const checkedSpaces = Array.from(m.root.querySelectorAll('input[name="tk-space-item"]:checked')).map((cb) => cb.value);
      const finalSpaces = parseSpaceList(checkedSpaces);

      task.title = titleVal;
      task.category = m.root.querySelector('#tk-cat').value;
      task.spaces = finalSpaces;
      task.space = finalSpaces.join(', ');
      task.priority = m.root.querySelector('#tk-prio').value;
      task.status = newStatus;
      task.assignedTechId = assignedId;
      task.assignedTechName = assignedObj ? auth.displayName(assignedObj) : '';
      task.taggedUserIds = taggedIds;
      task.taggedUserNames = taggedNames;
      task.dueDate = m.root.querySelector('#tk-date').value;
      task.dueTime = m.root.querySelector('#tk-time').value;
      task.description = m.root.querySelector('#tk-desc').value.trim();
      task.subtasks = cleanSubtasks;
      task.linkedScreeningId = linkedScreeningId;
      task.linkedEventId = linkedEventId;
      task.linkedFaultId = linkedFaultId;
      if (filmTitle) task.filmTitle = filmTitle;

      if (newStatus === 'Completed' && !task.completedAt) {
        task.completedBy = actorName;
        task.completedAt = nowIso;
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
