/* ============================================================
   views/hires.js — Hires Desk (Hires Team <-> Technical Team Q&A)
   ------------------------------------------------------------
   Event-linked questions, quote checks, technical tasks, and
   change requests submitted by the Rich Mix Hires Team and
   answered/actioned by Technical staff.

   Storage & Sync:
   - Stored natively in `tasks` (`source: 'hires'`, `category: 'Hires'`)
     so requests sync immediately to Supabase `public.tasks` and
     appear in Jobs & Tasks.
   - Structured hires metadata & threaded replies (`hiresMeta`) are
     mirrored inside the linked advancing event's JSONB
     `production_package.hiresThreads[taskId]` for instant multi-device
     persistence without requiring a schema migration, plus cached
     locally in `hires_meta_cache` for general (non-event) queries.
   ============================================================ */
window.RMTP = window.RMTP || {};

(function () {
  const store = RMTP.store;
  const ui = RMTP.ui;
  const auth = RMTP.auth;

  const REQUEST_TYPES = ['Question', 'Quote check', 'Tech task', 'Change'];
  const URGENCIES = ['Urgent', 'High', 'Medium', 'Low'];
  const STATUSES = ['Open', 'Awaiting Tech', 'Awaiting Hires', 'Answered'];
  const META_CACHE_KEY = 'hires_meta_cache';

  const URGENCY_WEIGHT = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
  const STATUS_WEIGHT = { 'Open': 0, 'Awaiting Tech': 1, 'Awaiting Hires': 2, 'Answered': 3 };

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function normDate(v) {
    return RMTP.normalizeDateStr ? RMTP.normalizeDateStr(v) : String(v || '').slice(0, 10);
  }

  function formatSpace(sp) {
    if (Array.isArray(sp)) return sp.filter(Boolean).join(', ');
    return String(sp || '').trim();
  }

  function statusToTaskStatus(hiresStatus) {
    switch (hiresStatus) {
      case 'Answered':       return 'Completed';
      case 'Awaiting Hires': return 'Blocked';
      case 'Awaiting Tech':  return 'In Progress';
      case 'Open':
      default:               return 'Pending';
    }
  }

  function taskStatusToHiresStatus(taskStatus, existingStatus) {
    if (taskStatus === 'Completed') return 'Answered';
    if (taskStatus === 'Blocked') return 'Awaiting Hires';
    if (taskStatus === 'In Progress') {
      return existingStatus === 'Open' ? 'Open' : 'Awaiting Tech';
    }
    if (existingStatus === 'Awaiting Tech' || existingStatus === 'Awaiting Hires') return existingStatus;
    return 'Open';
  }

  function isHiresTask(t) {
    if (!t) return false;
    return t.source === 'hires' || String(t.category || '').toLowerCase() === 'hires';
  }

  function readMetaCache() {
    const raw = store.read(META_CACHE_KEY, {});
    return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  }

  function writeMetaCache(taskId, meta) {
    if (!taskId) return;
    const cache = readMetaCache();
    if (meta) {
      cache[taskId] = meta;
    } else {
      delete cache[taskId];
    }
    store.write(META_CACHE_KEY, cache);
  }

  function getAdvancingThreadMeta(taskId, linkedEventId) {
    if (!taskId) return null;
    if (linkedEventId) {
      const ev = store.find('advancing', linkedEventId);
      const threads = ev && ev.production_package && ev.production_package.hiresThreads;
      if (threads && threads[taskId]) return threads[taskId];
    }
    const allAdv = store.all('advancing') || [];
    for (let i = 0; i < allAdv.length; i++) {
      const ev = allAdv[i];
      const threads = ev && ev.production_package && ev.production_package.hiresThreads;
      if (threads && threads[taskId]) return threads[taskId];
    }
    return null;
  }

  function isTaskCompletedStatus(status) {
    return String(status || '').trim().toLowerCase() === 'completed';
  }

  function isCompletedOrAnswered(task, meta) {
    if (task && isTaskCompletedStatus(task.status)) return true;
    const m = meta || (task ? getMeta(task) : null);
    return !!(m && m.hiresStatus === 'Answered');
  }

  function normalizeMeta(rawMeta, task) {
    const m = (rawMeta && typeof rawMeta === 'object') ? rawMeta : {};
    const requestType = REQUEST_TYPES.includes(m.requestType) ? m.requestType : 'Question';
    const taskDone = !!(task && isTaskCompletedStatus(task.status));
    const rawStatus = STATUSES.includes(m.hiresStatus)
      ? m.hiresStatus
      : taskStatusToHiresStatus(task && task.status, null);
    const hiresStatus = taskDone ? 'Answered' : (rawStatus === 'Answered' && task && !taskDone ? 'Awaiting Tech' : rawStatus);
    const replies = Array.isArray(m.replies)
      ? m.replies
          .filter((r) => r && (r.body || '').trim())
          .map((r) => ({
            id: r.id || store.uid('hrep'),
            authorId: r.authorId || '',
            authorName: r.authorName || 'Team Member',
            authorRole: r.authorRole || '',
            isHires: !!r.isHires,
            body: String(r.body || ''),
            createdAt: r.createdAt || new Date().toISOString()
          }))
      : [];

    return {
      requestType: requestType,
      hiresStatus: hiresStatus,
      hireRef: String(m.hireRef || '').trim(),
      clientNotes: String(m.clientNotes || '').trim(),
      reportedById: m.reportedById || '',
      replies: replies,
      updatedAt: m.updatedAt || (task && task.updatedAt) || Date.now()
    };
  }

  function getMeta(task) {
    if (!task) return normalizeMeta({}, null);
    const evMeta = getAdvancingThreadMeta(task.id, task.linkedEventId);
    const cacheMeta = readMetaCache()[task.id];
    const directMeta = (task.hiresMeta && typeof task.hiresMeta === 'object') ? task.hiresMeta : null;

    // Pick the freshest source (highest reply count or most recent updatedAt)
    const candidates = [directMeta, evMeta, cacheMeta].filter(Boolean);
    let chosen = null;
    candidates.forEach((c) => {
      if (!chosen) {
        chosen = c;
        return;
      }
      const cReplies = Array.isArray(c.replies) ? c.replies.length : 0;
      const chReplies = Array.isArray(chosen.replies) ? chosen.replies.length : 0;
      const cTime = Number(c.updatedAt || 0);
      const chTime = Number(chosen.updatedAt || 0);
      if (cTime > chTime || (cTime === chTime && cReplies > chReplies)) {
        chosen = c;
      }
    });
    return normalizeMeta(chosen || {}, task);
  }

  function mirrorToAdvancing(task, prevLinkedEventId) {
    if (!task || !task.id) return;
    const meta = normalizeMeta(task.hiresMeta || getMeta(task), task);
    writeMetaCache(task.id, meta);

    // If event link changed, remove old mirror
    if (prevLinkedEventId && prevLinkedEventId !== task.linkedEventId) {
      const oldEv = store.find('advancing', prevLinkedEventId);
      if (oldEv && oldEv.production_package && oldEv.production_package.hiresThreads && oldEv.production_package.hiresThreads[task.id]) {
        const nextPkg = Object.assign({}, oldEv.production_package);
        const nextThreads = Object.assign({}, nextPkg.hiresThreads);
        delete nextThreads[task.id];
        nextPkg.hiresThreads = nextThreads;
        store.upsert('advancing', Object.assign({}, oldEv, { production_package: nextPkg }));
      }
    }

    if (task.linkedEventId) {
      const ev = store.find('advancing', task.linkedEventId);
      if (ev) {
        const pkg = (ev.production_package && typeof ev.production_package === 'object' && !Array.isArray(ev.production_package))
          ? Object.assign({}, ev.production_package)
          : {};
        const threads = (pkg.hiresThreads && typeof pkg.hiresThreads === 'object' && !Array.isArray(pkg.hiresThreads))
          ? Object.assign({}, pkg.hiresThreads)
          : {};
        threads[task.id] = meta;
        pkg.hiresThreads = threads;

        const linkedIds = Array.isArray(ev.linked_task_ids) ? ev.linked_task_ids.slice() : [];
        if (!linkedIds.includes(task.id)) linkedIds.push(task.id);

        store.upsert('advancing', Object.assign({}, ev, {
          production_package: pkg,
          linked_task_ids: linkedIds
        }));
      }
    }
  }

  function hydrateAll() {
    const allTasks = store.all('tasks') || [];
    let changed = false;
    const nextTasks = allTasks.map((t) => {
      if (!isHiresTask(t)) return t;
      const resolved = getMeta(t);
      const currentJson = t.hiresMeta ? JSON.stringify(t.hiresMeta) : '';
      const nextJson = JSON.stringify(resolved);
      if (currentJson !== nextJson) {
        changed = true;
        return Object.assign({}, t, { hiresMeta: resolved });
      }
      return t;
    });
    if (changed) {
      store.write('tasks', nextTasks);
    }
  }

  function all() {
    hydrateAll();
    return (store.all('tasks') || [])
      .filter((t) => isHiresTask(t) && !(store.isDeleted && store.isDeleted('tasks', t.id)))
      .map((t) => Object.assign({}, t, { hiresMeta: getMeta(t) }));
  }

  function forEvent(eventId) {
    if (!eventId) return [];
    return all().filter((t) => t.linkedEventId === eventId);
  }

  function forEvents(eventIds) {
    if (!Array.isArray(eventIds) || !eventIds.length) return [];
    const set = new Set(eventIds.filter(Boolean));
    return all().filter((t) => t.linkedEventId && set.has(t.linkedEventId));
  }

  function openCount(user) {
    const u = user || (auth && auth.current ? auth.current() : null);
    const items = all().filter((t) => !isCompletedOrAnswered(t));
    if (u && auth && auth.isHiresTeam && auth.isHiresTeam(u)) {
      const awaitingHires = items.filter((t) => getMeta(t).hiresStatus === 'Awaiting Hires').length;
      return awaitingHires > 0 ? awaitingHires : items.length;
    }
    return items.filter((t) => {
      const st = getMeta(t).hiresStatus;
      return st === 'Open' || st === 'Awaiting Tech';
    }).length;
  }

  function totalOpenCount() {
    return all().filter((t) => !isCompletedOrAnswered(t)).length;
  }

  function extractArtifaxRef(ev) {
    if (!ev) return '';
    return String(
      ev.artifaxRef || ev.artifax_ref || ev.artifaxId || ev.artifax_id ||
      ev.bookingRef || ev.booking_ref || ev.reference || ev.eventRef || ''
    ).trim();
  }

  function getSuggestedTechForEvent(ev) {
    if (!ev) return null;
    const users = (store.all('users') || []).filter((u) => u && u.status !== 'pending' && !(auth.isHiresTeam && auth.isHiresTeam(u)));
    const byId = (id) => users.find((u) => u.id === id) || null;

    const leadId = RMTP.getAdvancingLeadId ? RMTP.getAdvancingLeadId(ev) : '';
    if (leadId) {
      const lead = byId(leadId);
      if (lead) return { user: lead, reason: 'Advancing Lead' };
    }

    const bookings = (store.all('bookings') || []).filter((b) =>
      b && b.eventId === ev.id && b.userId && !b.isNoTech && b.status !== 'cancelled' && b.status !== 'declined'
    );
    for (let i = 0; i < bookings.length; i++) {
      const u = byId(bookings[i].userId);
      if (u) return { user: u, reason: 'Booked ' + (bookings[i].role || 'Tech') };
    }

    const techs = RMTP.eventTechnicians ? RMTP.eventTechnicians(ev) : [];
    for (let i = 0; i < techs.length; i++) {
      if (techs[i] && techs[i].userId) {
        const u = byId(techs[i].userId);
        if (u) return { user: u, reason: 'Assigned ' + (techs[i].role || 'Tech') };
      }
    }
    return null;
  }

  function getTechUsers() {
    return (store.all('users') || [])
      .filter((u) => u && u.status !== 'pending' && !(auth.isHiresTeam && auth.isHiresTeam(u)))
      .sort((a, b) => auth.displayName(a).localeCompare(auth.displayName(b)));
  }

  function saveRequest(existingTask, data) {
    const me = auth.current();
    const isEdit = !!(existingTask && existingTask.id);
    const prevLinkedEventId = isEdit ? (existingTask.linkedEventId || '') : '';
    const existingMeta = isEdit ? getMeta(existingTask) : null;

    const linkedEv = data.linkedEventId ? store.find('advancing', data.linkedEventId) : null;
    const evSpace = linkedEv ? formatSpace(linkedEv.space) : '';
    const space = data.space || evSpace || 'Venue';
    const eventName = linkedEv ? (linkedEv.name || 'Event') : '';

    const assignedUser = data.assignedTechId ? store.find('users', data.assignedTechId) : null;
    const assignedTechId = assignedUser ? assignedUser.id : (data.assignedTechId || '');
    const assignedTechName = assignedUser ? auth.displayName(assignedUser) : (data.assignedTechName || '');

    const defaultHiresStatus = isEdit
      ? (data.hiresStatus || existingMeta.hiresStatus || 'Open')
      : (data.hiresStatus || 'Open');

    const now = Date.now();
    const nextMeta = normalizeMeta({
      requestType: data.requestType || (existingMeta ? existingMeta.requestType : 'Question'),
      hiresStatus: defaultHiresStatus,
      hireRef: data.hireRef !== undefined ? data.hireRef : (existingMeta ? existingMeta.hireRef : ''),
      clientNotes: data.clientNotes !== undefined ? data.clientNotes : (existingMeta ? existingMeta.clientNotes : ''),
      reportedById: (existingMeta && existingMeta.reportedById) || (me ? me.id : ''),
      replies: existingMeta ? existingMeta.replies : [],
      updatedAt: now
    }, { status: statusToTaskStatus(defaultHiresStatus) });

    const taskStatus = statusToTaskStatus(nextMeta.hiresStatus);
    const record = Object.assign({}, existingTask || {}, {
      id: isEdit ? existingTask.id : store.uid('hires'),
      title: String(data.title || '').trim(),
      description: String(data.description || '').trim(),
      category: 'Hires',
      source: 'hires',
      space: space,
      priority: URGENCIES.includes(data.priority) ? data.priority : 'Medium',
      status: taskStatus,
      assignedTechId: assignedTechId,
      assignedTechName: assignedTechName,
      linkedEventId: linkedEv ? linkedEv.id : (data.linkedEventId || ''),
      filmTitle: eventName || (data.customEventName ? String(data.customEventName).trim() : (data.linkedEventId ? (existingTask && existingTask.filmTitle) || '' : '')),
      dueDate: data.dueDate || '',
      dueTime: '',
      reportedBy: (isEdit && existingTask.reportedBy) ? existingTask.reportedBy : (me ? auth.displayName(me) : 'Hires Team'),
      createdAt: (isEdit && existingTask.createdAt) ? existingTask.createdAt : now,
      updatedAt: now,
      hiresMeta: nextMeta
    });

    if (taskStatus === 'Completed') {
      record.completedBy = record.completedBy || (me ? auth.displayName(me) : 'Tech');
      record.completedAt = record.completedAt || new Date().toISOString();
    } else {
      delete record.completedBy;
      delete record.completedAt;
    }

    store.upsert('tasks', record);
    mirrorToAdvancing(record, prevLinkedEventId);
    if (RMTP.shell && RMTP.shell.renderNavigation) RMTP.shell.renderNavigation();
    if (RMTP.syncSb && RMTP.syncSb.drain) RMTP.syncSb.drain();
    return record;
  }

  function addReply(taskId, bodyText, nextHiresStatus) {
    const body = String(bodyText || '').trim();
    if (!taskId || !body) return null;
    const task = store.find('tasks', taskId);
    if (!task) return null;

    const me = auth.current();
    const isHiresUser = !!(auth.isHiresTeam && auth.isHiresTeam(me));
    const meta = getMeta(task);
    const nowIso = new Date().toISOString();
    const nowTs = Date.now();

    const reply = {
      id: store.uid('hrep'),
      authorId: me ? me.id : '',
      authorName: me ? auth.displayName(me) : 'Team Member',
      authorRole: me ? (me.position || (isHiresUser ? 'Hires Team' : 'Tech')) : '',
      isHires: isHiresUser,
      body: body,
      createdAt: nowIso
    };

    const resolvedStatus = STATUSES.includes(nextHiresStatus)
      ? nextHiresStatus
      : (isHiresUser ? 'Awaiting Tech' : 'Awaiting Hires');

    const nextMeta = Object.assign({}, meta, {
      hiresStatus: resolvedStatus,
      replies: (meta.replies || []).concat(reply),
      updatedAt: nowTs
    });

    const nextTaskStatus = statusToTaskStatus(resolvedStatus);
    const updated = Object.assign({}, task, {
      status: nextTaskStatus,
      updatedAt: nowTs,
      hiresMeta: nextMeta
    });

    // If a tech replies on an unassigned request, claim it automatically if they are tech staff
    if (!isHiresUser && me && !updated.assignedTechId) {
      updated.assignedTechId = me.id;
      updated.assignedTechName = auth.displayName(me);
    }

    if (nextTaskStatus === 'Completed') {
      updated.completedBy = me ? auth.displayName(me) : 'Tech';
      updated.completedAt = nowIso;
    } else {
      delete updated.completedBy;
      delete updated.completedAt;
    }

    store.upsert('tasks', updated);
    mirrorToAdvancing(updated, null);
    if (RMTP.shell && RMTP.shell.renderNavigation) RMTP.shell.renderNavigation();
    if (RMTP.syncSb && RMTP.syncSb.drain) RMTP.syncSb.drain();
    return updated;
  }

  function updateStatus(taskId, nextHiresStatus) {
    if (!taskId || !STATUSES.includes(nextHiresStatus)) return null;
    const task = store.find('tasks', taskId);
    if (!task) return null;

    const me = auth.current();
    const meta = getMeta(task);
    const nowTs = Date.now();
    const nextMeta = Object.assign({}, meta, {
      hiresStatus: nextHiresStatus,
      updatedAt: nowTs
    });
    const nextTaskStatus = statusToTaskStatus(nextHiresStatus);
    const updated = Object.assign({}, task, {
      status: nextTaskStatus,
      updatedAt: nowTs,
      hiresMeta: nextMeta
    });

    if (nextTaskStatus === 'Completed') {
      updated.completedBy = me ? auth.displayName(me) : 'Tech';
      updated.completedAt = new Date().toISOString();
    } else {
      delete updated.completedBy;
      delete updated.completedAt;
    }

    store.upsert('tasks', updated);
    mirrorToAdvancing(updated, null);
    if (RMTP.shell && RMTP.shell.renderNavigation) RMTP.shell.renderNavigation();
    if (RMTP.syncSb && RMTP.syncSb.drain) RMTP.syncSb.drain();
    return updated;
  }

  function assignTech(taskId, userId) {
    if (!taskId) return null;
    const task = store.find('tasks', taskId);
    if (!task) return null;
    const u = userId ? store.find('users', userId) : null;
    const meta = getMeta(task);
    const nowTs = Date.now();
    const nextHiresStatus = (u && meta.hiresStatus === 'Open') ? 'Awaiting Tech' : meta.hiresStatus;
    const nextMeta = Object.assign({}, meta, {
      hiresStatus: nextHiresStatus,
      updatedAt: nowTs
    });
    const updated = Object.assign({}, task, {
      assignedTechId: u ? u.id : '',
      assignedTechName: u ? auth.displayName(u) : '',
      status: statusToTaskStatus(nextHiresStatus),
      updatedAt: nowTs,
      hiresMeta: nextMeta
    });
    store.upsert('tasks', updated);
    mirrorToAdvancing(updated, null);
    if (RMTP.shell && RMTP.shell.renderNavigation) RMTP.shell.renderNavigation();
    if (RMTP.syncSb && RMTP.syncSb.drain) RMTP.syncSb.drain();
    return updated;
  }

  function syncFromTaskStatus(task) {
    if (!task || !isHiresTask(task)) return;
    const meta = getMeta(task);
    const targetHiresStatus = taskStatusToHiresStatus(task.status, meta.hiresStatus);
    const storedStatus = task.hiresMeta && task.hiresMeta.hiresStatus;
    if (storedStatus !== targetHiresStatus || meta.hiresStatus !== targetHiresStatus) {
      const nextMeta = Object.assign({}, meta, {
        hiresStatus: targetHiresStatus,
        updatedAt: Date.now()
      });
      const updated = Object.assign({}, task, { hiresMeta: nextMeta });
      store.upsert('tasks', updated);
      mirrorToAdvancing(updated, null);
    } else {
      mirrorToAdvancing(Object.assign({}, task, { hiresMeta: meta }), null);
    }
    if (RMTP.shell && RMTP.shell.renderNavigation) RMTP.shell.renderNavigation();
  }

  function deleteRequest(taskId) {
    if (!taskId) return;
    const task = store.find('tasks', taskId);
    const evId = task ? task.linkedEventId : '';
    writeMetaCache(taskId, null);

    if (evId) {
      const ev = store.find('advancing', evId);
      if (ev && ev.production_package && ev.production_package.hiresThreads && ev.production_package.hiresThreads[taskId]) {
        const nextPkg = Object.assign({}, ev.production_package);
        const nextThreads = Object.assign({}, nextPkg.hiresThreads);
        delete nextThreads[taskId];
        nextPkg.hiresThreads = nextThreads;
        const nextLinked = Array.isArray(ev.linked_task_ids) ? ev.linked_task_ids.filter((id) => id !== taskId) : [];
        store.upsert('advancing', Object.assign({}, ev, {
          production_package: nextPkg,
          linked_task_ids: nextLinked
        }));
      }
    }

    if (store.markDeleted) store.markDeleted('tasks', taskId);
    store.remove('tasks', taskId);
    if (RMTP.supabase && RMTP.supabase.deleteRow) {
      RMTP.supabase.deleteRow('tasks', taskId).catch(() => {});
    }
    if (RMTP.shell && RMTP.shell.renderNavigation) RMTP.shell.renderNavigation();
    if (RMTP.syncSb && RMTP.syncSb.drain) RMTP.syncSb.drain();
  }

  /* ---- Formatting & Visual Helpers (Zero-Pill Unboxed Discipline) ---- */
  function statusTextClass(hiresStatus) {
    switch (hiresStatus) {
      case 'Answered':       return 'text-ok';
      case 'Awaiting Hires': return 'text-info';
      case 'Awaiting Tech':  return 'text-amber-400';
      case 'Open':
      default:               return 'text-accent';
    }
  }

  function urgencyTextClass(priority) {
    switch (priority) {
      case 'Urgent': return 'text-danger font-semibold';
      case 'High':   return 'text-amber-400 font-semibold';
      case 'Low':    return 'text-muted';
      default:       return 'text-ink/80';
    }
  }

  function replyByInfo(dueDate, isAnswered) {
    if (!dueDate) return { label: 'No reply-by set', cls: 'text-muted', isOverdue: false, isDueToday: false };
    const norm = normDate(dueDate);
    const today = todayIso();
    const formatted = ui.formatDate ? ui.formatDate(norm) : norm;
    if (isAnswered) return { label: 'Reply-by ' + formatted, cls: 'text-muted', isOverdue: false, isDueToday: false };
    if (norm < today) return { label: 'Overdue · ' + formatted, cls: 'text-danger font-semibold', isOverdue: true, isDueToday: false };
    if (norm === today) return { label: 'Due today · ' + formatted, cls: 'text-amber-400 font-semibold', isOverdue: false, isDueToday: true };
    return { label: 'Reply by ' + formatted, cls: 'text-muted', isOverdue: false, isDueToday: false };
  }

  function formatTimestamp(isoOrTs) {
    if (!isoOrTs) return '';
    const d = new Date(isoOrTs);
    if (isNaN(d.getTime())) return '';
    const now = Date.now();
    const diffMs = now - d.getTime();
    if (diffMs >= 0 && diffMs < 3600 * 1000 * 12 && ui.timeAgo) {
      return ui.timeAgo(d.getTime());
    }
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function sortRequests(list) {
    const today = todayIso();
    return list.slice().sort((a, b) => {
      const ma = getMeta(a);
      const mb = getMeta(b);
      const aDone = ma.hiresStatus === 'Answered' ? 1 : 0;
      const bDone = mb.hiresStatus === 'Answered' ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;

      // Overdue open requests float to the top
      if (!aDone) {
        const aOverdue = a.dueDate && normDate(a.dueDate) < today ? 0 : 1;
        const bOverdue = b.dueDate && normDate(b.dueDate) < today ? 0 : 1;
        if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      }

      const ua = URGENCY_WEIGHT[a.priority] !== undefined ? URGENCY_WEIGHT[a.priority] : 2;
      const ub = URGENCY_WEIGHT[b.priority] !== undefined ? URGENCY_WEIGHT[b.priority] : 2;
      if (ua !== ub) return ua - ub;

      const da = a.dueDate ? normDate(a.dueDate) : '9999-99-99';
      const db = b.dueDate ? normDate(b.dueDate) : '9999-99-99';
      if (da !== db) return da.localeCompare(db);

      const sa = STATUS_WEIGHT[ma.hiresStatus] !== undefined ? STATUS_WEIGHT[ma.hiresStatus] : 9;
      const sb = STATUS_WEIGHT[mb.hiresStatus] !== undefined ? STATUS_WEIGHT[mb.hiresStatus] : 9;
      if (sa !== sb) return sa - sb;

      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });
  }

  function canEditRequest(task, user) {
    if (!user || !task) return false;
    if (auth.isTechManagerOrAdmin && auth.isTechManagerOrAdmin(user)) return true;
    const isHires = !!(auth.isHiresTeam && auth.isHiresTeam(user));
    if (!isHires) return true; // Staff techs can edit details
    const meta = getMeta(task);
    if (meta.hiresStatus === 'Answered') return false;
    const meName = auth.displayName(user).toLowerCase();
    return (meta.reportedById && meta.reportedById === user.id) ||
           String(task.reportedBy || '').toLowerCase() === meName;
  }

  function canDeleteRequest(task, user) {
    if (!user || !task) return false;
    if (auth.isTechManagerOrAdmin && auth.isTechManagerOrAdmin(user)) return true;
    const isHires = !!(auth.isHiresTeam && auth.isHiresTeam(user));
    if (!isHires) return false;
    const meta = getMeta(task);
    const hasReplies = meta.replies && meta.replies.length > 0;
    const isOwner = (meta.reportedById && meta.reportedById === user.id) ||
      String(task.reportedBy || '').toLowerCase() === auth.displayName(user).toLowerCase();
    return isOwner && !hasReplies && meta.hiresStatus !== 'Answered';
  }

  /* ---- New / Edit Hires Request Modal ---- */
  function openRequestModal(existingTask, prefill, onSaved) {
    const isEdit = !!(existingTask && existingTask.id);
    const existingMeta = isEdit ? getMeta(existingTask) : null;
    const pre = prefill || {};
    const me = auth.current();
    const isHires = !!(auth.isHiresTeam && auth.isHiresTeam(me));

    const initialEventId = isEdit ? (existingTask.linkedEventId || '') : (pre.linkedEventId || '');
    const events = RMTP.getUpcomingActiveEvents ? RMTP.getUpcomingActiveEvents(initialEventId || null) : [];
    const initialEv = initialEventId ? (events.find((e) => e.id === initialEventId) || store.find('advancing', initialEventId)) : null;

    const initialType = isEdit ? existingMeta.requestType : (pre.requestType || 'Question');
    const initialUrgency = isEdit ? (existingTask.priority || 'Medium') : (pre.priority || 'Medium');
    const initialDue = isEdit ? (existingTask.dueDate || '') : (pre.dueDate || '');
    const initialTitle = isEdit ? (existingTask.title || '') : (pre.title || '');
    const initialDesc = isEdit ? (existingTask.description || '') : (pre.description || '');
    const initialHireRef = isEdit ? existingMeta.hireRef : (pre.hireRef || extractArtifaxRef(initialEv));
    const initialClientNotes = isEdit ? existingMeta.clientNotes : (pre.clientNotes || '');
    const initialAssignee = isEdit ? (existingTask.assignedTechId || '') : (pre.assignedTechId || '');
    const techUsers = getTechUsers();

    const formatEventLabel = (ev) => {
      if (!ev) return '';
      const sp = formatSpace(ev.space);
      const dt = ev.date ? (ui.formatDate ? ui.formatDate(normDate(ev.date)) : normDate(ev.date)) : 'Date TBC';
      return (ev.name || 'Untitled Event') + ' \u00b7 ' + dt + (sp ? ' \u00b7 ' + sp : '');
    };
    const initialCustomEventName = (!initialEventId && isEdit && existingTask.filmTitle) ? String(existingTask.filmTitle).trim() : '';
    const initialEventInputText = initialEv ? formatEventLabel(initialEv) : initialCustomEventName;

    const m = ui.modal({
      title: isEdit ? 'Edit Hires Request' : 'New Hires Request',
      size: 'md:max-w-2xl',
      body:
        '<form id="hires-req-form" class="grid gap-4 text-xs">' +
          // Linked Event (searchable type-to-fill combobox)
          '<div id="hr-event-combo" class="relative">' +
            '<label for="hr-event-input" class="block text-[11px] font-semibold uppercase tracking-wider text-muted mb-1.5">Linked Event</label>' +
            '<input type="hidden" id="hr-event" value="' + ui.esc(initialEventId) + '" />' +
            '<div class="relative">' +
              '<input id="hr-event-input" type="text" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="hr-event-dropdown" class="field text-xs !pr-14" placeholder="Type to search upcoming events, or enter an unlisted event name\u2026" value="' + ui.esc(initialEventInputText) + '" />' +
              '<div class="absolute inset-y-0 right-1.5 flex items-center gap-0.5">' +
                '<button type="button" id="hr-event-clear" class="p-1 rounded text-muted hover:text-ink transition-colors ' + (initialEventInputText ? '' : 'hidden') + '" title="Clear event selection" aria-label="Clear event selection">' +
                  ui.icon('x', 'w-3.5 h-3.5') +
                '</button>' +
                '<button type="button" id="hr-event-toggle" class="p-1 rounded text-muted hover:text-ink transition-colors" title="Browse upcoming events" aria-label="Toggle events list">' +
                  ui.icon('chevD', 'w-3.5 h-3.5') +
                '</button>' +
              '</div>' +
            '</div>' +
            '<div id="hr-event-dropdown" role="listbox" class="hidden absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border border-line bg-panel shadow-xl max-h-60 overflow-y-auto divide-y divide-line/50"></div>' +
            '<div id="hr-event-context" class="mt-1.5 text-[11px] text-muted font-mono tabular-nums"></div>' +
          '</div>' +

          // Type + Urgency + Reply-by Date
          '<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">' +
            '<div>' +
              '<label for="hr-type" class="block text-[11px] font-semibold uppercase tracking-wider text-muted mb-1.5">Request Type</label>' +
              '<select id="hr-type" class="field text-xs">' +
                REQUEST_TYPES.map((rt) => '<option value="' + ui.esc(rt) + '" ' + (initialType === rt ? 'selected' : '') + '>' + ui.esc(rt) + '</option>').join('') +
              '</select>' +
            '</div>' +
            '<div>' +
              '<label for="hr-urgency" class="block text-[11px] font-semibold uppercase tracking-wider text-muted mb-1.5">Urgency</label>' +
              '<select id="hr-urgency" class="field text-xs">' +
                URGENCIES.map((u) => '<option value="' + ui.esc(u) + '" ' + (initialUrgency === u ? 'selected' : '') + '>' + ui.esc(u) + '</option>').join('') +
              '</select>' +
            '</div>' +
            '<div>' +
              '<label for="hr-due" class="block text-[11px] font-semibold uppercase tracking-wider text-muted mb-1.5">Reply-By Date</label>' +
              '<input id="hr-due" type="date" class="field text-xs font-mono tabular-nums" value="' + ui.esc(initialDue) + '" />' +
            '</div>' +
          '</div>' +

          // Subject / Title
          '<div>' +
            '<label for="hr-title" class="block text-[11px] font-semibold uppercase tracking-wider text-muted mb-1.5">Subject / Summary <span class="text-danger">*</span></label>' +
            '<input id="hr-title" type="text" class="field text-xs" placeholder="e.g. Confirm extra radio mics &amp; technician hours for client quote" value="' + ui.esc(initialTitle) + '" required />' +
          '</div>' +

          // Question / Task Details
          '<div>' +
            '<label for="hr-desc" class="block text-[11px] font-semibold uppercase tracking-wider text-muted mb-1.5">Question or Technical Task Details <span class="text-danger">*</span></label>' +
            '<textarea id="hr-desc" rows="4" class="field text-xs leading-relaxed" placeholder="Share what you need checked, quoted, or changed by the technical team\u2026" required>' + ui.esc(initialDesc) + '</textarea>' +
          '</div>' +

          // Artifax Ref + Tech Owner (for Tech staff)
          '<div class="grid grid-cols-1 ' + (!isHires ? 'sm:grid-cols-2' : '') + ' gap-3">' +
            '<div>' +
              '<label for="hr-ref" class="block text-[11px] font-semibold uppercase tracking-wider text-muted mb-1.5">Artifax Hire Reference</label>' +
              '<input id="hr-ref" type="text" class="field text-xs font-mono" placeholder="e.g. AFX-4821 / Hire #1094" value="' + ui.esc(initialHireRef) + '" />' +
            '</div>' +
            (!isHires ? (
              '<div>' +
                '<label for="hr-assignee" class="block text-[11px] font-semibold uppercase tracking-wider text-muted mb-1.5">Assign Tech Owner</label>' +
                '<select id="hr-assignee" class="field text-xs">' +
                  '<option value="">Unassigned (Tech Queue)</option>' +
                  techUsers.map((u) => '<option value="' + ui.esc(u.id) + '" ' + (initialAssignee === u.id ? 'selected' : '') + '>' + ui.esc(auth.displayName(u)) + ' (' + ui.esc(u.position || 'Tech') + ')</option>').join('') +
                '</select>' +
              '</div>'
            ) : '') +
          '</div>' +

          // Client Notes
          '<div>' +
            '<label for="hr-client-notes" class="block text-[11px] font-semibold uppercase tracking-wider text-muted mb-1.5">Client Notes / Booking Context</label>' +
            '<textarea id="hr-client-notes" rows="2" class="field text-xs leading-relaxed" placeholder="Optional client deadlines, budget constraints, or Artifax notes\u2026">' + ui.esc(initialClientNotes) + '</textarea>' +
          '</div>' +
        '</form>',
      footer:
        '<button type="button" data-close class="btn btn-ghost text-xs">Cancel</button>' +
        '<button type="button" id="hr-save-btn" class="btn btn-primary text-xs font-semibold">' +
          ui.icon('check', 'w-3.5 h-3.5') + '<span>' + (isEdit ? 'Save Changes' : 'Submit Request') + '</span>' +
        '</button>'
    });

    const comboRoot = m.root.querySelector('#hr-event-combo');
    const eventHidden = m.root.querySelector('#hr-event');
    const eventInput = m.root.querySelector('#hr-event-input');
    const eventClearBtn = m.root.querySelector('#hr-event-clear');
    const eventToggleBtn = m.root.querySelector('#hr-event-toggle');
    const eventDropdown = m.root.querySelector('#hr-event-dropdown');
    const contextEl = m.root.querySelector('#hr-event-context');
    const refInput = m.root.querySelector('#hr-ref');
    const assigneeSel = m.root.querySelector('#hr-assignee');

    const eventEntries = events.map((ev) => {
      const sp = formatSpace(ev.space);
      const isoDate = ev.date ? normDate(ev.date) : '';
      const niceDate = isoDate ? (ui.formatDate ? ui.formatDate(isoDate) : isoDate) : 'Date TBC';
      const afxRef = extractArtifaxRef(ev);
      return {
        ev: ev,
        id: ev.id,
        name: ev.name || 'Untitled Event',
        space: sp,
        isoDate: isoDate,
        niceDate: niceDate,
        afxRef: afxRef,
        label: formatEventLabel(ev),
        searchStr: [ev.name, sp, isoDate, niceDate, afxRef].filter(Boolean).join(' ').toLowerCase()
      };
    });

    let dropdownOpen = false;
    let showAllMode = false;
    let activeIdx = -1;
    let visibleOptions = [];

    function syncClearBtn() {
      if (!eventClearBtn) return;
      if (eventInput.value.trim() || eventHidden.value) {
        eventClearBtn.classList.remove('hidden');
      } else {
        eventClearBtn.classList.add('hidden');
      }
    }

    function updateEventPreview(autoFillRef) {
      const eid = eventHidden.value;
      const typed = eventInput.value.trim();
      syncClearBtn();

      if (!eid) {
        if (typed) {
          contextEl.innerHTML = 'Unlisted / provisional event \u2014 will be logged under <strong class="text-ink font-sans">' + ui.esc(typed) + '</strong>.';
        } else {
          contextEl.innerHTML = 'Not tied to a single advancing date \u2014 tracked as a General Hires query.';
        }
        return;
      }
      const ev = store.find('advancing', eid);
      if (!ev) {
        contextEl.innerHTML = '';
        return;
      }
      const sp = formatSpace(ev.space) || 'Space TBC';
      const dt = ev.date ? (ui.formatDate ? ui.formatDate(normDate(ev.date)) : normDate(ev.date)) : 'Date TBC';
      const times = [ev.startTime, ev.finishTime].filter(Boolean).join('\u2013');
      const suggested = getSuggestedTechForEvent(ev);
      contextEl.innerHTML =
        '<span>' + ui.esc(sp) + '</span> \u00b7 <span>' + ui.esc(dt) + (times ? ' (' + ui.esc(times) + ')' : '') + '</span>' +
        (suggested ? ' \u00b7 Suggested tech: <strong class="text-ink font-sans">' + ui.esc(auth.displayName(suggested.user)) + '</strong> (' + ui.esc(suggested.reason) + ')' : '');

      if (autoFillRef && !refInput.value.trim()) {
        const ref = extractArtifaxRef(ev);
        if (ref) refInput.value = ref;
      }
      if (!isEdit && assigneeSel && !assigneeSel.value && suggested) {
        assigneeSel.value = suggested.user.id;
      }
    }

    function closeDropdown() {
      dropdownOpen = false;
      activeIdx = -1;
      eventDropdown.classList.add('hidden');
      eventInput.setAttribute('aria-expanded', 'false');
    }

    function selectOption(opt) {
      if (!opt) return;
      if (opt.kind === 'general') {
        eventHidden.value = '';
        eventInput.value = '';
        updateEventPreview(false);
      } else if (opt.kind === 'event') {
        eventHidden.value = opt.id;
        eventInput.value = opt.label;
        updateEventPreview(true);
      } else if (opt.kind === 'custom') {
        eventHidden.value = '';
        eventInput.value = opt.text;
        updateEventPreview(false);
      }
      closeDropdown();
    }

    function renderDropdown(forceShowAll) {
      if (typeof forceShowAll === 'boolean') showAllMode = forceShowAll;
      const rawQuery = showAllMode ? '' : eventInput.value.trim();
      const q = rawQuery.toLowerCase();
      const opts = [];

      if (!q || 'general non-event hires query'.includes(q)) {
        opts.push({ kind: 'general', id: '', label: 'General / Non-Event Hires Query' });
      }

      const matches = q
        ? eventEntries.filter((entry) => entry.searchStr.includes(q))
        : eventEntries;

      matches.forEach((entry) => {
        opts.push({
          kind: 'event',
          id: entry.id,
          name: entry.name,
          space: entry.space,
          niceDate: entry.niceDate,
          afxRef: entry.afxRef,
          label: entry.label
        });
      });

      const exactMatch = matches.some((entry) =>
        entry.name.toLowerCase() === q || entry.label.toLowerCase() === q
      );
      if (rawQuery && !exactMatch) {
        opts.push({ kind: 'custom', text: rawQuery });
      }

      visibleOptions = opts;
      if (activeIdx >= visibleOptions.length) activeIdx = visibleOptions.length - 1;

      eventDropdown.innerHTML = visibleOptions.map((opt, idx) => {
        const isHighlighted = idx === activeIdx;
        const isSelected = (opt.kind === 'event' && eventHidden.value === opt.id) ||
                           (opt.kind === 'general' && !eventHidden.value && !eventInput.value.trim());
        const rowCls = 'w-full text-left px-3 py-2 text-xs transition-colors flex flex-col gap-0.5 ' +
          (isHighlighted ? 'bg-panel2 text-ink' : (isSelected ? 'bg-panel2/60 text-ink' : 'text-ink/90 hover:bg-panel2/70'));

        if (opt.kind === 'general') {
          return (
            '<button type="button" role="option" data-ev-opt-idx="' + idx + '" class="' + rowCls + '">' +
              '<span class="font-medium text-ink">General / Non-Event Hires Query</span>' +
              '<span class="text-[11px] text-muted">Not tied to a specific event in Advancing</span>' +
            '</button>'
          );
        }
        if (opt.kind === 'custom') {
          return (
            '<button type="button" role="option" data-ev-opt-idx="' + idx + '" class="' + rowCls + '">' +
              '<span class="font-medium text-accent">Use \u201c' + ui.esc(opt.text) + '\u201d</span>' +
              '<span class="text-[11px] text-muted">Log against an unlisted or provisional event</span>' +
            '</button>'
          );
        }
        return (
          '<button type="button" role="option" data-ev-opt-idx="' + idx + '" class="' + rowCls + '">' +
            '<span class="font-medium text-ink truncate">' + ui.esc(opt.name) + '</span>' +
            '<span class="text-[11px] text-muted font-mono tabular-nums truncate">' +
              ui.esc(opt.niceDate) +
              (opt.space ? ' \u00b7 ' + ui.esc(opt.space) : '') +
              (opt.afxRef ? ' \u00b7 ' + ui.esc(opt.afxRef) : '') +
            '</span>' +
          '</button>'
        );
      }).join('');

      eventDropdown.querySelectorAll('[data-ev-opt-idx]').forEach((btn) => {
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const idx = parseInt(btn.getAttribute('data-ev-opt-idx'), 10);
          selectOption(visibleOptions[idx]);
        });
      });

      dropdownOpen = true;
      eventDropdown.classList.remove('hidden');
      eventInput.setAttribute('aria-expanded', 'true');
    }

    eventInput.addEventListener('focus', () => {
      // If an event is already selected, show full list on initial focus so user can easily browse or start typing
      renderDropdown(!!eventHidden.value);
    });

    eventInput.addEventListener('click', () => {
      if (!dropdownOpen) renderDropdown(!!eventHidden.value);
    });

    eventInput.addEventListener('input', () => {
      const val = eventInput.value.trim().toLowerCase();
      // Check if typed value matches the currently linked event label; if not, clear linked ID so search & custom text work cleanly
      const currentEntry = eventHidden.value ? eventEntries.find((e) => e.id === eventHidden.value) : null;
      if (!currentEntry || (currentEntry.label.toLowerCase() !== val && currentEntry.name.toLowerCase() !== val)) {
        eventHidden.value = '';
      }
      activeIdx = 0;
      renderDropdown(false);
      updateEventPreview(false);
    });

    eventInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!dropdownOpen) {
          activeIdx = 0;
          renderDropdown(!!eventHidden.value);
        } else if (visibleOptions.length) {
          activeIdx = (activeIdx + 1) % visibleOptions.length;
          renderDropdown();
        }
        const activeBtn = eventDropdown.querySelector('[data-ev-opt-idx="' + activeIdx + '"]');
        if (activeBtn && activeBtn.scrollIntoView) activeBtn.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (dropdownOpen && visibleOptions.length) {
          activeIdx = activeIdx <= 0 ? visibleOptions.length - 1 : activeIdx - 1;
          renderDropdown();
          const activeBtn = eventDropdown.querySelector('[data-ev-opt-idx="' + activeIdx + '"]');
          if (activeBtn && activeBtn.scrollIntoView) activeBtn.scrollIntoView({ block: 'nearest' });
        }
      } else if (e.key === 'Enter' && dropdownOpen) {
        e.preventDefault();
        if (activeIdx >= 0 && visibleOptions[activeIdx]) {
          selectOption(visibleOptions[activeIdx]);
        } else if (visibleOptions.length === 1) {
          selectOption(visibleOptions[0]);
        } else {
          closeDropdown();
        }
      } else if (e.key === 'Escape' && dropdownOpen) {
        e.preventDefault();
        e.stopPropagation();
        closeDropdown();
      }
    });

    eventToggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (dropdownOpen) {
        closeDropdown();
      } else {
        eventInput.focus();
        renderDropdown(true);
      }
    });

    eventClearBtn.addEventListener('click', (e) => {
      e.preventDefault();
      eventHidden.value = '';
      eventInput.value = '';
      updateEventPreview(false);
      eventInput.focus();
      renderDropdown(true);
    });

    m.root.addEventListener('mousedown', (e) => {
      if (dropdownOpen && comboRoot && !comboRoot.contains(e.target)) {
        closeDropdown();
      }
    });

    updateEventPreview(false);

    m.root.querySelector('#hr-save-btn').addEventListener('click', () => {
      const title = m.root.querySelector('#hr-title').value.trim();
      const desc = m.root.querySelector('#hr-desc').value.trim();
      if (!title) {
        ui.toast('Please enter a short subject for this request.', 'danger');
        m.root.querySelector('#hr-title').focus();
        return;
      }
      if (!desc) {
        ui.toast('Please include the question or technical details.', 'danger');
        m.root.querySelector('#hr-desc').focus();
        return;
      }

      let linkedEventId = eventHidden.value;
      const typedEventText = eventInput.value.trim();
      if (!linkedEventId && typedEventText) {
        const matched = eventEntries.find((entry) =>
          entry.label.toLowerCase() === typedEventText.toLowerCase() ||
          entry.name.toLowerCase() === typedEventText.toLowerCase()
        );
        if (matched) linkedEventId = matched.id;
      }
      const linkedEv = linkedEventId ? store.find('advancing', linkedEventId) : null;
      const saved = saveRequest(existingTask, {
        linkedEventId: linkedEventId,
        customEventName: !linkedEv ? typedEventText : '',
        space: linkedEv ? formatSpace(linkedEv.space) : 'Venue',
        requestType: m.root.querySelector('#hr-type').value,
        priority: m.root.querySelector('#hr-urgency').value,
        dueDate: m.root.querySelector('#hr-due').value,
        title: title,
        description: desc,
        hireRef: refInput.value.trim(),
        clientNotes: m.root.querySelector('#hr-client-notes').value.trim(),
        assignedTechId: assigneeSel ? assigneeSel.value : (isEdit ? existingTask.assignedTechId : '')
      });

      m.close();
      ui.toast(isEdit ? 'Hires request updated.' : 'Hires request submitted to Tech Team.', 'ok');
      if (typeof onSaved === 'function') onSaved(saved);
    });
  }

  /* ---- Embedded Event Modal Panel (used by advancing.js) ---- */
  function renderEventHiresPanel(container, ev, group, onChanged) {
    if (!container || !ev) return;
    const me = auth.current();
    const isHires = !!(auth.isHiresTeam && auth.isHiresTeam(me));
    const eventIds = (group && Array.isArray(group.events) && group.events.length)
      ? group.events.map((e) => e.id)
      : [ev.id];

    function paint() {
      const requests = sortRequests(forEvents(eventIds));
      const openReqs = requests.filter((r) => getMeta(r).hiresStatus !== 'Answered');

      container.innerHTML =
        '<div class="space-y-3">' +
          '<div class="flex items-center justify-between gap-3 flex-wrap pb-2.5 border-b border-line">' +
            '<div>' +
              '<div class="eyebrow text-ink font-semibold flex items-center gap-1.5">' +
                ui.icon('chat', 'w-3.5 h-3.5 text-accent') +
                '<span>Hires Questions &amp; Tasks</span>' +
                '<span class="font-mono tabular-nums text-muted">(' + openReqs.length + ' open / ' + requests.length + ' total)</span>' +
              '</div>' +
              '<p class="text-[11px] text-muted mt-0.5">' +
                (group && group.events.length > 1
                  ? 'Showing all Hires Desk threads across this consolidated multi-day/multi-room run.'
                  : 'Synced live with the Hires Desk and technical Jobs &amp; Tasks.') +
              '</p>' +
            '</div>' +
            '<div class="flex items-center gap-2">' +
              '<a href="#/hires?event=' + encodeURIComponent(ev.id) + '" class="btn btn-ghost !py-1 !px-2.5 text-xs">Open Hires Desk \u2192</a>' +
              '<button type="button" id="ev-hires-add-btn" class="btn btn-primary !py-1 !px-2.5 text-xs font-semibold flex items-center gap-1">' +
                ui.icon('plus', 'w-3.5 h-3.5') + '<span>Add Hires Request</span>' +
              '</button>' +
            '</div>' +
          '</div>' +

          (requests.length === 0 ? (
            '<div class="py-8 px-4 text-center rounded-lg border border-dashed border-line bg-panel2/30">' +
              '<p class="text-xs font-medium text-ink">No hires questions or tasks for this event yet.</p>' +
              '<p class="text-[11px] text-muted mt-1">Log a question, quote check, tech task, or booking change to start a tracked thread.</p>' +
            '</div>'
          ) : (
            '<div class="divide-y divide-line border border-line rounded-lg bg-panel2/25">' +
              requests.map((t) => {
                const meta = getMeta(t);
                const isAnswered = meta.hiresStatus === 'Answered';
                const due = replyByInfo(t.dueDate, isAnswered);
                const lastReply = meta.replies.length ? meta.replies[meta.replies.length - 1] : null;
                return (
                  '<div class="p-3 space-y-2" data-ev-hires-item="' + ui.esc(t.id) + '">' +
                    '<div class="flex items-start justify-between gap-3">' +
                      '<div class="min-w-0 flex-1">' +
                        '<div class="flex items-center gap-2 flex-wrap">' +
                          '<span class="font-semibold text-xs text-ink">' + ui.esc(t.title) + '</span>' +
                          '<span class="text-[11px] font-semibold ' + statusTextClass(meta.hiresStatus) + '">' + ui.esc(meta.hiresStatus) + '</span>' +
                        '</div>' +
                        '<div class="text-[11px] text-muted mt-0.5 flex items-center gap-1.5 flex-wrap">' +
                          '<span>' + ui.esc(meta.requestType) + '</span>' +
                          '<span aria-hidden="true">\u00b7</span>' +
                          '<span class="' + urgencyTextClass(t.priority) + '">' + ui.esc(t.priority || 'Medium') + '</span>' +
                          (t.dueDate ? '<span aria-hidden="true">\u00b7</span><span class="font-mono tabular-nums ' + due.cls + '">' + ui.esc(due.label) + '</span>' : '') +
                          (meta.hireRef ? '<span aria-hidden="true">\u00b7</span><span class="font-mono text-ink/80">Ref ' + ui.esc(meta.hireRef) + '</span>' : '') +
                          (t.assignedTechName ? '<span aria-hidden="true">\u00b7</span><span>Owner: <strong class="text-ink font-medium">' + ui.esc(t.assignedTechName) + '</strong></span>' : '') +
                        '</div>' +
                      '</div>' +
                      '<a href="#/hires?id=' + encodeURIComponent(t.id) + '" class="text-[11px] text-accent hover:underline font-medium shrink-0">Full thread \u2192</a>' +
                    '</div>' +

                    (t.description ? '<p class="text-xs text-ink/85 whitespace-pre-wrap leading-relaxed">' + ui.esc(t.description) + '</p>' : '') +
                    (meta.clientNotes ? '<p class="text-[11px] text-muted"><strong class="text-ink/80">Client notes:</strong> ' + ui.esc(meta.clientNotes) + '</p>' : '') +

                    (lastReply ? (
                      '<div class="pl-3 border-l border-line text-[11px] text-ink/85 space-y-0.5">' +
                        '<div class="text-muted">' +
                          '<strong class="text-ink">' + ui.esc(lastReply.authorName) + '</strong>' +
                          ' (' + (lastReply.isHires ? 'Hires Team' : (lastReply.authorRole || 'Tech')) + ')' +
                          ' \u00b7 <span class="font-mono">' + ui.esc(formatTimestamp(lastReply.createdAt)) + '</span>' +
                          (meta.replies.length > 1 ? ' \u00b7 ' + meta.replies.length + ' replies' : '') +
                        '</div>' +
                        '<div class="whitespace-pre-wrap">' + ui.esc(lastReply.body) + '</div>' +
                      '</div>'
                    ) : '') +

                    // Quick inline reply bar
                    '<div class="flex items-center gap-2 pt-1">' +
                      '<input type="text" data-ev-quick-reply-input="' + ui.esc(t.id) + '" class="field !py-1.5 text-xs flex-1" placeholder="' + (isHires ? 'Add a follow-up reply to Tech\u2026' : 'Write a quick technical reply\u2026') + '" />' +
                      '<button type="button" data-ev-quick-reply-send="' + ui.esc(t.id) + '" class="btn btn-ghost !py-1.5 !px-2.5 text-xs border border-line shrink-0">Reply</button>' +
                      (!isHires && !isAnswered ? (
                        '<button type="button" data-ev-quick-answer="' + ui.esc(t.id) + '" class="btn btn-ghost !py-1.5 !px-2.5 text-xs text-ok border border-line shrink-0" title="Mark as Answered">Answer</button>'
                      ) : '') +
                    '</div>' +
                  '</div>'
                );
              }).join('') +
            '</div>'
          )) +
        '</div>';

      const addBtn = container.querySelector('#ev-hires-add-btn');
      if (addBtn) {
        addBtn.addEventListener('click', () => {
          openRequestModal(null, { linkedEventId: ev.id }, () => {
            paint();
            if (typeof onChanged === 'function') onChanged();
          });
        });
      }

      container.querySelectorAll('[data-ev-quick-reply-send]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const tid = btn.getAttribute('data-ev-quick-reply-send');
          const inp = container.querySelector('[data-ev-quick-reply-input="' + tid + '"]');
          const txt = inp ? inp.value.trim() : '';
          if (!txt) {
            ui.toast('Enter a reply first.', 'info');
            if (inp) inp.focus();
            return;
          }
          addReply(tid, txt, isHires ? 'Awaiting Tech' : 'Awaiting Hires');
          ui.toast('Reply posted to Hires Desk.', 'ok');
          paint();
          if (typeof onChanged === 'function') onChanged();
        });
      });

      container.querySelectorAll('[data-ev-quick-reply-input]').forEach((inp) => {
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const tid = inp.getAttribute('data-ev-quick-reply-input');
            const btn = container.querySelector('[data-ev-quick-reply-send="' + tid + '"]');
            if (btn) btn.click();
          }
        });
      });

      container.querySelectorAll('[data-ev-quick-answer]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const tid = btn.getAttribute('data-ev-quick-answer');
          const inp = container.querySelector('[data-ev-quick-reply-input="' + tid + '"]');
          const txt = inp ? inp.value.trim() : '';
          if (txt) {
            addReply(tid, txt, 'Answered');
          } else {
            updateStatus(tid, 'Answered');
          }
          ui.toast('Marked as Answered.', 'ok');
          paint();
          if (typeof onChanged === 'function') onChanged();
        });
      });
    }

    paint();
  }

  /* ---- Main Hires Desk View (#/hires) ---- */
  RMTP.views.hires = function (el, params, query) {
    hydrateAll();
    const me = auth.current();
    const isHires = !!(auth.isHiresTeam && auth.isHiresTeam(me));

    const state = (RMTP._hiresState = RMTP._hiresState || {
      statusTab: 'open',       // 'open' | 'Awaiting Tech' | 'Awaiting Hires' | 'Answered' | 'overdue'
      typeFilter: 'all',
      urgencyFilter: 'all',
      eventFilter: 'all',
      search: '',
      selectedId: null,
      mobileDetailOpen: false
    });

    // Apply deep-link query parameters
    if (query && query.id) {
      state.selectedId = query.id;
      const target = store.find('tasks', query.id);
      if (target && isCompletedOrAnswered(target)) {
        state.statusTab = 'Answered';
      } else {
        state.statusTab = 'open';
      }
      state.typeFilter = 'all';
      state.urgencyFilter = 'all';
      state.eventFilter = 'all';
      state.search = '';
      state.mobileDetailOpen = true;
    } else if (query && query.event) {
      state.eventFilter = query.event;
      state.statusTab = 'open';
    }

    const shouldAutoCreate = !!(query && query.new === '1');

    function getFilteredList(allReqs) {
      const today = todayIso();
      let list = allReqs.slice();

      if (state.statusTab === 'open') {
        list = list.filter((t) => !isCompletedOrAnswered(t));
      } else if (state.statusTab === 'overdue') {
        list = list.filter((t) => !isCompletedOrAnswered(t) && t.dueDate && normDate(t.dueDate) <= today);
      } else if (state.statusTab === 'Awaiting Tech') {
        list = list.filter((t) => {
          if (isCompletedOrAnswered(t)) return false;
          const st = getMeta(t).hiresStatus;
          return st === 'Open' || st === 'Awaiting Tech';
        });
      } else if (state.statusTab === 'Awaiting Hires') {
        list = list.filter((t) => !isCompletedOrAnswered(t) && getMeta(t).hiresStatus === 'Awaiting Hires');
      } else if (state.statusTab === 'Answered') {
        list = list.filter((t) => isCompletedOrAnswered(t));
      }

      if (state.typeFilter !== 'all') {
        list = list.filter((t) => getMeta(t).requestType === state.typeFilter);
      }
      if (state.urgencyFilter !== 'all') {
        list = list.filter((t) => (t.priority || 'Medium') === state.urgencyFilter);
      }
      if (state.eventFilter === 'general') {
        list = list.filter((t) => !t.linkedEventId);
      } else if (state.eventFilter !== 'all') {
        list = list.filter((t) => t.linkedEventId === state.eventFilter);
      }

      const q = (state.search || '').trim().toLowerCase();
      if (q) {
        list = list.filter((t) => {
          const meta = getMeta(t);
          const ev = t.linkedEventId ? store.find('advancing', t.linkedEventId) : null;
          const replyText = (meta.replies || []).map((r) => r.body + ' ' + r.authorName).join(' ');
          const haystack = [
            t.title, t.description, t.space, t.filmTitle, t.reportedBy, t.assignedTechName,
            ev ? ev.name : '', meta.requestType, meta.hireRef, meta.clientNotes, replyText
          ].join(' ').toLowerCase();
          return haystack.includes(q);
        });
      }

      return sortRequests(list);
    }

    function renderDetailPane(selected, answeredCount) {
      if (!selected) {
        const showAnsweredShortcut = state.statusTab !== 'Answered' && answeredCount > 0;
        return (
          '<div class="panel p-8 lg:p-12 flex flex-col items-center justify-center text-center min-h-[420px]">' +
            '<div class="w-11 h-11 rounded-lg border border-line bg-panel2 flex items-center justify-center text-muted mb-3">' +
              ui.icon(showAnsweredShortcut ? 'check' : 'chat', 'w-5 h-5') +
            '</div>' +
            '<h2 class="font-display text-base font-semibold text-ink">' +
              (showAnsweredShortcut ? 'No open requests in this view' : 'Select a Hires request') +
            '</h2>' +
            '<p class="text-xs text-muted mt-1 max-w-sm leading-relaxed">' +
              (showAnsweredShortcut
                ? 'Completed requests are archived under Answered unless a follow-up reply is added.'
                : 'Pick a thread from the queue to review event context, Artifax references, and replies \u2014 or submit a new request for an upcoming hire.') +
            '</p>' +
            (showAnsweredShortcut
              ? '<button type="button" id="hires-jump-answered" class="btn btn-ghost text-xs mt-4 border border-line">View Answered (' + answeredCount + ')</button>'
              : '') +
          '</div>'
        );
      }

      const meta = getMeta(selected);
      const isAnswered = meta.hiresStatus === 'Answered';
      const due = replyByInfo(selected.dueDate, isAnswered);
      const ev = selected.linkedEventId ? store.find('advancing', selected.linkedEventId) : null;
      const evSpace = ev ? formatSpace(ev.space) : (selected.space || 'General Venue');
      const evDate = ev && ev.date ? (ui.formatDate ? ui.formatDate(normDate(ev.date)) : normDate(ev.date)) : '';
      const evTimes = ev ? [ev.startTime, ev.finishTime].filter(Boolean).join('\u2013') : '';
      const suggestedTech = (!isHires && ev && !selected.assignedTechId) ? getSuggestedTechForEvent(ev) : null;
      const techUsers = !isHires ? getTechUsers() : [];
      const allowEdit = canEditRequest(selected, me);
      const allowDelete = canDeleteRequest(selected, me);

      return (
        '<div class="panel flex flex-col min-h-[520px] lg:min-h-[620px] overflow-hidden">' +
          // Mobile back bar
          '<div class="lg:hidden px-4 py-2.5 border-b border-line flex items-center justify-between bg-panel2/40">' +
            '<button type="button" id="hires-mobile-back" class="text-xs font-medium text-muted hover:text-ink flex items-center gap-1.5">' +
              ui.icon('arrowL', 'w-3.5 h-3.5') + '<span>Back to Queue</span>' +
            '</button>' +
            '<span class="text-[11px] font-semibold ' + statusTextClass(meta.hiresStatus) + '">' + ui.esc(meta.hiresStatus) + '</span>' +
          '</div>' +

          // Event Context Strip
          '<div class="px-5 py-3 border-b border-line bg-panel2/35 flex items-center justify-between gap-3 flex-wrap text-xs">' +
            '<div class="min-w-0 flex items-center gap-2 flex-wrap">' +
              '<span class="text-muted">' + ui.icon(ev ? 'calendar' : 'chat', 'w-3.5 h-3.5') + '</span>' +
              (ev ? (
                '<span class="font-semibold text-ink truncate">' + ui.esc(ev.name || 'Linked Event') + '</span>' +
                '<span class="text-muted" aria-hidden="true">\u00b7</span>' +
                '<span class="font-mono tabular-nums text-muted">' + ui.esc(evDate || 'Date TBC') + (evTimes ? ' ' + ui.esc(evTimes) : '') + '</span>' +
                (evSpace ? '<span class="text-muted" aria-hidden="true">\u00b7</span><span class="text-muted">' + ui.esc(evSpace) + '</span>' : '') +
                (ev.status ? '<span class="text-muted" aria-hidden="true">\u00b7</span><span class="text-muted">' + ui.esc(ev.status) + '</span>' : '')
              ) : (selected.filmTitle ? (
                '<span class="font-semibold text-ink truncate">' + ui.esc(selected.filmTitle) + '</span>' +
                '<span class="text-muted" aria-hidden="true">\u00b7</span>' +
                '<span class="text-muted">Provisional / Unlisted Event</span>'
              ) : (
                '<span class="font-medium text-ink">General / Non-Event Hires Query</span>'
              ))) +
            '</div>' +
            (ev ? (
              '<a href="#/advancing/' + encodeURIComponent(ev.id) + '" class="text-xs text-accent hover:underline font-medium shrink-0">Open Event in Advancing \u2192</a>'
            ) : '') +
          '</div>' +

          // Request Header & Inline Controls
          '<div class="px-5 py-4 border-b border-line space-y-3">' +
            '<div class="flex items-start justify-between gap-3">' +
              '<div class="min-w-0 flex-1">' +
                '<div class="flex items-center gap-2 flex-wrap text-[11px] text-muted mb-1">' +
                  '<span class="font-semibold uppercase tracking-wider ' + statusTextClass(meta.hiresStatus) + '">' + ui.esc(meta.hiresStatus) + '</span>' +
                  '<span aria-hidden="true">\u00b7</span>' +
                  '<span class="text-ink/80 font-medium">' + ui.esc(meta.requestType) + '</span>' +
                  '<span aria-hidden="true">\u00b7</span>' +
                  '<span class="' + urgencyTextClass(selected.priority) + '">' + ui.esc(selected.priority || 'Medium') + ' priority</span>' +
                  '<span aria-hidden="true">\u00b7</span>' +
                  '<span class="font-mono tabular-nums ' + due.cls + '">' + ui.esc(due.label) + '</span>' +
                '</div>' +
                '<h2 class="font-display text-lg font-semibold text-ink leading-snug">' + ui.esc(selected.title) + '</h2>' +
                '<div class="text-[11px] text-muted mt-1 flex items-center gap-2 flex-wrap">' +
                  '<span>Raised by <strong class="text-ink font-medium">' + ui.esc(selected.reportedBy || 'Hires Team') + '</strong></span>' +
                  '<span aria-hidden="true">\u00b7</span>' +
                  '<span class="font-mono tabular-nums">' + ui.esc(formatTimestamp(selected.createdAt)) + '</span>' +
                  (meta.hireRef ? '<span aria-hidden="true">\u00b7</span><span class="font-mono text-ink">Artifax Ref: ' + ui.esc(meta.hireRef) + '</span>' : '') +
                '</div>' +
              '</div>' +
              '<div class="flex items-center gap-1 shrink-0">' +
                (allowEdit ? '<button type="button" id="hires-edit-btn" class="btn btn-ghost !py-1 !px-2 text-xs" title="Edit request">' + ui.icon('pen', 'w-3.5 h-3.5') + '</button>' : '') +
                (allowDelete ? '<button type="button" id="hires-delete-btn" class="btn btn-ghost !py-1 !px-2 text-xs text-muted hover:text-danger" title="Delete request">' + ui.icon('trash', 'w-3.5 h-3.5') + '</button>' : '') +
              '</div>' +
            '</div>' +

            // Tech Owner & Status Management Row
            '<div class="flex flex-wrap items-center justify-between gap-3 pt-2.5 border-t border-line/60 text-xs">' +
              '<div class="flex items-center gap-2 flex-wrap">' +
                '<span class="text-[11px] text-muted">Tech Owner:</span>' +
                (!isHires ? (
                  '<select id="hires-owner-select" class="field !py-1 !px-2 text-xs !w-auto min-w-[170px]" aria-label="Assign Tech Owner">' +
                    '<option value="">Unassigned</option>' +
                    techUsers.map((u) => '<option value="' + ui.esc(u.id) + '" ' + (selected.assignedTechId === u.id ? 'selected' : '') + '>' + ui.esc(auth.displayName(u)) + '</option>').join('') +
                  '</select>' +
                  (suggestedTech ? (
                    '<button type="button" id="hires-assign-suggested" data-uid="' + ui.esc(suggestedTech.user.id) + '" class="text-[11px] text-accent hover:underline font-medium">' +
                      'Assign ' + ui.esc(auth.displayName(suggestedTech.user)) + ' (' + ui.esc(suggestedTech.reason) + ')' +
                    '</button>'
                  ) : '')
                ) : (
                  '<span class="font-medium text-ink">' + (selected.assignedTechName ? ui.esc(selected.assignedTechName) : '<span class="text-muted">Awaiting tech assignment</span>') + '</span>'
                )) +
              '</div>' +

              '<div class="flex items-center gap-2">' +
                (!isHires ? (
                  '<label for="hires-status-select" class="text-[11px] text-muted">Status:</label>' +
                  '<select id="hires-status-select" class="field !py-1 !px-2 text-xs !w-auto">' +
                    STATUSES.map((st) => '<option value="' + ui.esc(st) + '" ' + (meta.hiresStatus === st ? 'selected' : '') + '>' + ui.esc(st) + '</option>').join('') +
                  '</select>'
                ) : (
                  isAnswered ? (
                    '<button type="button" id="hires-reopen-btn" class="btn btn-ghost !py-1 !px-2.5 text-xs border border-line">Reopen Request</button>'
                  ) : ''
                )) +
              '</div>' +
            '</div>' +
          '</div>' +

          // Scrollable Body: Original Request + Client Notes + Replies
          '<div class="flex-1 overflow-y-auto px-5 py-4 space-y-5">' +
            // Original Brief
            '<div class="space-y-3">' +
              '<div class="text-sm text-ink leading-relaxed whitespace-pre-wrap">' + ui.esc(selected.description || 'No description provided.') + '</div>' +
              ((meta.clientNotes || meta.hireRef) ? (
                '<div class="p-3.5 rounded-lg bg-panel2/50 border border-line text-xs space-y-1.5">' +
                  '<div class="flex items-center justify-between gap-2 text-[11px] uppercase tracking-wider font-semibold text-muted">' +
                    '<span>Client Notes &amp; Booking Reference</span>' +
                    (meta.hireRef ? '<span class="font-mono text-ink normal-case">' + ui.esc(meta.hireRef) + '</span>' : '') +
                  '</div>' +
                  (meta.clientNotes
                    ? '<p class="text-ink/85 whitespace-pre-wrap leading-relaxed">' + ui.esc(meta.clientNotes) + '</p>'
                    : '<p class="text-muted">Artifax hire reference logged above.</p>') +
                '</div>'
              ) : '') +
            '</div>' +

            // Conversation Thread
            '<div class="space-y-3 pt-3 border-t border-line">' +
              '<div class="flex items-center justify-between">' +
                '<span class="eyebrow">Conversation Thread</span>' +
                '<span class="text-[11px] font-mono tabular-nums text-muted">' + meta.replies.length + (meta.replies.length === 1 ? ' reply' : ' replies') + '</span>' +
              '</div>' +

              (meta.replies.length === 0 ? (
                '<p class="text-xs text-muted py-3">No replies yet. Use the composer below to respond or ask a clarifying question.</p>'
              ) : (
                '<div class="space-y-2.5">' +
                  meta.replies.map((r) => {
                    const roleTag = r.isHires ? 'Hires Team' : (r.authorRole || 'Technical Team');
                    return (
                      '<div class="p-3.5 rounded-lg border ' + (r.isHires ? 'bg-panel2/30 border-line' : 'bg-panel2/75 border-line') + '">' +
                        '<div class="flex items-center justify-between gap-2 text-[11px] mb-1.5">' +
                          '<div class="flex items-center gap-1.5 min-w-0">' +
                            '<span class="font-semibold text-ink truncate">' + ui.esc(r.authorName) + '</span>' +
                            '<span class="text-muted" aria-hidden="true">\u00b7</span>' +
                            '<span class="' + (r.isHires ? 'text-info font-medium' : 'text-ok font-medium') + '">' + ui.esc(roleTag) + '</span>' +
                          '</div>' +
                          '<span class="font-mono tabular-nums text-muted shrink-0">' + ui.esc(formatTimestamp(r.createdAt)) + '</span>' +
                        '</div>' +
                        '<div class="text-xs text-ink/90 whitespace-pre-wrap leading-relaxed">' + ui.esc(r.body) + '</div>' +
                      '</div>'
                    );
                  }).join('') +
                '</div>'
              )) +
            '</div>' +
          '</div>' +

          // Sticky Reply Composer
          '<div class="px-5 py-3.5 border-t border-line bg-panel2/40 space-y-2.5">' +
            '<textarea id="hires-reply-input" rows="2" class="field text-xs leading-relaxed" placeholder="' +
              (isHires
                ? 'Reply with extra client details or follow-up questions\u2026'
                : 'Write your technical answer, quote check, or follow-up question for Hires\u2026') +
            '"></textarea>' +
            '<div class="flex items-center justify-between gap-2 flex-wrap">' +
              '<span class="text-[11px] text-muted">' +
                (isHires
                  ? 'Posting a reply notifies the technical team and sets status to Awaiting Tech.'
                  : 'Ctrl/Cmd + Enter to send quickly.') +
              '</span>' +
              '<div class="flex items-center gap-2">' +
                (!isHires ? (
                  '<button type="button" id="hires-reply-await-hires" class="btn btn-ghost !py-1.5 !px-3 text-xs border border-line">' +
                    'Send &amp; Request Info' +
                  '</button>' +
                  '<button type="button" id="hires-reply-answer" class="btn btn-primary !py-1.5 !px-3 text-xs font-semibold flex items-center gap-1.5">' +
                    ui.icon('check', 'w-3.5 h-3.5') + '<span>Reply &amp; Mark Answered</span>' +
                  '</button>'
                ) : (
                  '<button type="button" id="hires-reply-send" class="btn btn-primary !py-1.5 !px-3 text-xs font-semibold flex items-center gap-1.5">' +
                    ui.icon('send', 'w-3.5 h-3.5') + '<span>Send Reply</span>' +
                  '</button>'
                )) +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }

    function render() {
      const allReqs = all();
      const today = todayIso();
      const openReqs = allReqs.filter((t) => !isCompletedOrAnswered(t));
      const awaitingTechCount = openReqs.filter((t) => {
        const st = getMeta(t).hiresStatus;
        return st === 'Open' || st === 'Awaiting Tech';
      }).length;
      const awaitingHiresCount = openReqs.filter((t) => getMeta(t).hiresStatus === 'Awaiting Hires').length;
      const overdueCount = openReqs.filter((t) => t.dueDate && normDate(t.dueDate) <= today).length;
      const answeredCount = allReqs.length - openReqs.length;

      const filtered = getFilteredList(allReqs);

      // Keep selection strictly scoped to the active view's filtered queue
      // so completed/answered requests never linger in All Open.
      let selected = state.selectedId ? filtered.find((t) => t.id === state.selectedId) : null;
      if (!selected) {
        if (filtered.length > 0) {
          selected = filtered[0];
          state.selectedId = selected.id;
        } else {
          selected = null;
          state.selectedId = null;
          state.mobileDetailOpen = false;
        }
      }

      // Build event filter options from upcoming events + any events currently referenced by hires requests
      const upcomingEvs = RMTP.getUpcomingActiveEvents ? RMTP.getUpcomingActiveEvents() : [];
      const eventMap = new Map();
      upcomingEvs.forEach((e) => eventMap.set(e.id, e));
      allReqs.forEach((t) => {
        if (t.linkedEventId && !eventMap.has(t.linkedEventId)) {
          const ev = store.find('advancing', t.linkedEventId);
          if (ev) eventMap.set(ev.id, ev);
        }
      });
      const eventOptions = Array.from(eventMap.values()).sort((a, b) => (normDate(a.date) || '9999').localeCompare(normDate(b.date) || '9999'));

      const hasFilters = state.typeFilter !== 'all' || state.urgencyFilter !== 'all' || state.eventFilter !== 'all' || !!(state.search || '').trim();

      const statusTabs = [
        { id: 'open',           label: 'All Open',       count: openReqs.length },
        { id: 'Awaiting Tech',  label: 'Awaiting Tech',  count: awaitingTechCount },
        { id: 'Awaiting Hires', label: 'Awaiting Hires', count: awaitingHiresCount },
        { id: 'Answered',       label: 'Answered',       count: answeredCount },
      ];

      el.innerHTML =
        '<div class="view-enter space-y-4">' +
          // Header
          '<div class="flex flex-col sm:flex-row sm:items-end justify-between gap-3">' +
            '<div>' +
              '<p class="eyebrow">Hires &amp; Technical Liaison</p>' +
              '<h1 class="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-ink">Hires Desk</h1>' +
              '<p class="text-xs sm:text-sm text-muted mt-0.5">' +
                (isHires
                  ? 'Log event questions, quote checks, technical tasks, and booking changes directly with the technical team.'
                  : 'Review and answer hires team enquiries, quote checks, and technical requests synced with Advancing &amp; Jobs.') +
              '</p>' +
            '</div>' +
            '<div class="flex items-center gap-2 shrink-0">' +
              '<button type="button" id="hires-new-btn" class="btn btn-primary text-xs font-semibold flex items-center gap-1.5">' +
                ui.icon('plus', 'w-4 h-4') + '<span>New Hires Request</span>' +
              '</button>' +
            '</div>' +
          '</div>' +

          // Flat Hairline Summary Strip (interactive KPI filters)
          '<div class="grid grid-cols-2 lg:grid-cols-4 border border-line rounded-xl bg-panel divide-y lg:divide-y-0 lg:divide-x divide-line overflow-hidden">' +
            '<button type="button" data-kpi-tab="Awaiting Tech" class="p-3.5 text-left hover:bg-panel2/50 transition-colors ' + (state.statusTab === 'Awaiting Tech' ? 'bg-panel2/70' : '') + '">' +
              '<span class="block text-[11px] uppercase tracking-wider font-medium text-muted">Needs Tech Reply</span>' +
              '<span class="block font-mono tabular-nums text-2xl font-semibold mt-1 ' + (awaitingTechCount > 0 ? 'text-amber-400' : 'text-ink') + '">' + awaitingTechCount + '</span>' +
            '</button>' +
            '<button type="button" data-kpi-tab="Awaiting Hires" class="p-3.5 text-left hover:bg-panel2/50 transition-colors ' + (state.statusTab === 'Awaiting Hires' ? 'bg-panel2/70' : '') + '">' +
              '<span class="block text-[11px] uppercase tracking-wider font-medium text-muted">Waiting on Hires</span>' +
              '<span class="block font-mono tabular-nums text-2xl font-semibold mt-1 ' + (awaitingHiresCount > 0 ? 'text-info' : 'text-ink') + '">' + awaitingHiresCount + '</span>' +
            '</button>' +
            '<button type="button" data-kpi-tab="overdue" class="p-3.5 text-left hover:bg-panel2/50 transition-colors ' + (state.statusTab === 'overdue' ? 'bg-panel2/70' : '') + '">' +
              '<span class="block text-[11px] uppercase tracking-wider font-medium text-muted">Overdue / Due Today</span>' +
              '<span class="block font-mono tabular-nums text-2xl font-semibold mt-1 ' + (overdueCount > 0 ? 'text-danger' : 'text-ink') + '">' + overdueCount + '</span>' +
            '</button>' +
            '<button type="button" data-kpi-tab="Answered" class="p-3.5 text-left hover:bg-panel2/50 transition-colors ' + (state.statusTab === 'Answered' ? 'bg-panel2/70' : '') + '">' +
              '<span class="block text-[11px] uppercase tracking-wider font-medium text-muted">Answered</span>' +
              '<span class="block font-mono tabular-nums text-2xl font-semibold mt-1 text-ok">' + answeredCount + '</span>' +
            '</button>' +
          '</div>' +

          // Filter & Search Bar
          '<div class="panel p-3.5 space-y-3">' +
            '<div class="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">' +
              // Segmented status tabs
              '<div class="flex items-center gap-1 overflow-x-auto hide-scrollbar">' +
                statusTabs.map((tab) => {
                  const active = state.statusTab === tab.id;
                  return (
                    '<button type="button" data-status-tab="' + tab.id + '" class="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ' +
                      (active ? 'bg-accent text-accent-ink font-semibold' : 'text-muted hover:text-ink hover:bg-panel2') + '">' +
                      '<span>' + tab.label + '</span>' +
                      '<span class="font-mono tabular-nums text-[11px] ' + (active ? 'text-accent-ink/85' : 'text-muted') + '">' + tab.count + '</span>' +
                    '</button>'
                  );
                }).join('') +
              '</div>' +

              // Search
              '<div class="relative flex-1 lg:max-w-sm">' +
                '<span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">' + ui.icon('search', 'w-3.5 h-3.5') + '</span>' +
                '<input id="hires-search" type="search" class="field !pl-8 !py-1.5 text-xs" placeholder="Search subject, event, Artifax ref, notes\u2026" value="' + ui.esc(state.search) + '" />' +
              '</div>' +
            '</div>' +

            '<div class="flex flex-wrap items-center gap-2 pt-2.5 border-t border-line/60 text-xs">' +
              '<select id="hires-filter-type" class="field !py-1 !px-2 text-xs !w-auto" aria-label="Filter by request type">' +
                '<option value="all">All Types</option>' +
                REQUEST_TYPES.map((rt) => '<option value="' + ui.esc(rt) + '" ' + (state.typeFilter === rt ? 'selected' : '') + '>' + ui.esc(rt) + '</option>').join('') +
              '</select>' +
              '<select id="hires-filter-urgency" class="field !py-1 !px-2 text-xs !w-auto" aria-label="Filter by urgency">' +
                '<option value="all">All Urgencies</option>' +
                URGENCIES.map((u) => '<option value="' + ui.esc(u) + '" ' + (state.urgencyFilter === u ? 'selected' : '') + '>' + ui.esc(u) + '</option>').join('') +
              '</select>' +
              '<select id="hires-filter-event" class="field !py-1 !px-2 text-xs !w-auto max-w-[260px]" aria-label="Filter by event">' +
                '<option value="all">All Events</option>' +
                '<option value="general" ' + (state.eventFilter === 'general' ? 'selected' : '') + '>General / Non-Event Queries</option>' +
                eventOptions.map((ev) => {
                  const dt = ev.date ? normDate(ev.date) : '';
                  return '<option value="' + ui.esc(ev.id) + '" ' + (state.eventFilter === ev.id ? 'selected' : '') + '>' +
                    ui.esc((ev.name || 'Event') + (dt ? ' (' + dt + ')' : '')) +
                  '</option>';
                }).join('') +
              '</select>' +
              (hasFilters ? (
                '<button type="button" id="hires-reset-filters" class="text-xs text-muted hover:text-ink underline ml-auto">Reset filters</button>'
              ) : '') +
            '</div>' +
          '</div>' +

          // Master-Detail Split Workspace
          '<div class="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">' +
            // Left Queue (5 cols on desktop)
            '<div class="lg:col-span-5 ' + (state.mobileDetailOpen && selected ? 'hidden lg:block' : 'block') + '">' +
              '<div class="panel overflow-hidden">' +
                '<div class="px-4 py-2.5 border-b border-line flex items-center justify-between text-[11px] text-muted">' +
                  '<span class="font-medium uppercase tracking-wider">Request Queue</span>' +
                  '<span class="font-mono tabular-nums">' + filtered.length + (filtered.length === 1 ? ' item' : ' items') + '</span>' +
                '</div>' +
                (filtered.length === 0 ? (
                  '<div class="p-8 text-center space-y-2">' +
                    '<p class="text-sm font-medium text-ink">' + (allReqs.length === 0 ? 'No hires requests yet' : 'No matching requests') + '</p>' +
                    '<p class="text-xs text-muted max-w-xs mx-auto leading-relaxed">' +
                      (allReqs.length === 0
                        ? 'Submit your first event question, quote check, or technical task to collaborate with the Rich Mix technical team.'
                        : 'Try clearing one of the active status or event filters.') +
                    '</p>' +
                    (allReqs.length === 0 ? (
                      '<button type="button" id="hires-empty-new" class="btn btn-primary text-xs mt-2">+ New Hires Request</button>'
                    ) : '') +
                  '</div>'
                ) : (
                  '<div class="divide-y divide-line max-h-[640px] overflow-y-auto">' +
                    filtered.map((t) => {
                      const meta = getMeta(t);
                      const isSel = selected && selected.id === t.id;
                      const isDone = meta.hiresStatus === 'Answered';
                      const due = replyByInfo(t.dueDate, isDone);
                      const ev = t.linkedEventId ? store.find('advancing', t.linkedEventId) : null;
                      const evTitle = ev ? ev.name : (t.filmTitle || 'General Hires');
                      const evDateShort = ev && ev.date ? (ui.formatDate ? ui.formatDate(normDate(ev.date)) : normDate(ev.date)) : '';

                      return (
                        '<button type="button" data-select-hires="' + ui.esc(t.id) + '" class="w-full text-left px-4 py-3 transition-colors block ' +
                          (isSel ? 'bg-panel2' : 'hover:bg-panel2/50') + '">' +
                          '<div class="flex items-start justify-between gap-2">' +
                            '<span class="font-medium text-sm leading-snug ' + (isSel ? 'text-ink' : 'text-ink/90') + ' line-clamp-2">' + ui.esc(t.title) + '</span>' +
                            '<span class="text-[11px] font-semibold shrink-0 ' + statusTextClass(meta.hiresStatus) + '">' + ui.esc(meta.hiresStatus) + '</span>' +
                          '</div>' +

                          '<div class="text-xs text-muted mt-1 truncate">' +
                            '<span class="text-ink/80">' + ui.esc(evTitle) + '</span>' +
                            (evDateShort ? ' \u00b7 <span class="font-mono tabular-nums">' + ui.esc(evDateShort) + '</span>' : '') +
                            (meta.hireRef ? ' \u00b7 <span class="font-mono">' + ui.esc(meta.hireRef) + '</span>' : '') +
                          '</div>' +

                          '<div class="flex items-center justify-between gap-2 mt-1.5 text-[11px] text-muted">' +
                            '<div class="flex items-center gap-1.5 min-w-0 truncate">' +
                              '<span>' + ui.esc(meta.requestType) + '</span>' +
                              '<span aria-hidden="true">\u00b7</span>' +
                              '<span class="' + urgencyTextClass(t.priority) + '">' + ui.esc(t.priority || 'Medium') + '</span>' +
                              (t.dueDate ? '<span aria-hidden="true">\u00b7</span><span class="font-mono tabular-nums ' + due.cls + '">' + ui.esc(due.label) + '</span>' : '') +
                            '</div>' +
                            '<div class="flex items-center gap-2 shrink-0 font-mono tabular-nums">' +
                              (t.assignedTechName ? '<span class="font-sans text-muted truncate max-w-[90px]">' + ui.esc(t.assignedTechName.split(' ')[0]) + '</span>' : '') +
                              (meta.replies.length ? '<span class="text-muted">' + meta.replies.length + ' rep</span>' : '') +
                            '</div>' +
                          '</div>' +
                        '</button>'
                      );
                    }).join('') +
                  '</div>'
                )) +
              '</div>' +
            '</div>' +

            // Right Thread Detail (7 cols on desktop)
            '<div class="lg:col-span-7 ' + (!state.mobileDetailOpen && selected ? 'hidden lg:block' : 'block') + '">' +
              renderDetailPane(selected, answeredCount) +
            '</div>' +
          '</div>' +
        '</div>';

      // Wire top-level actions
      const newBtn = el.querySelector('#hires-new-btn');
      if (newBtn) {
        newBtn.addEventListener('click', () => {
          const prefill = state.eventFilter !== 'all' && state.eventFilter !== 'general' ? { linkedEventId: state.eventFilter } : null;
          openRequestModal(null, prefill, (saved) => {
            state.selectedId = saved.id;
            state.statusTab = 'open';
            state.mobileDetailOpen = true;
            render();
          });
        });
      }
      const emptyNewBtn = el.querySelector('#hires-empty-new');
      if (emptyNewBtn) {
        emptyNewBtn.addEventListener('click', () => {
          openRequestModal(null, null, (saved) => {
            state.selectedId = saved.id;
            state.statusTab = 'open';
            state.mobileDetailOpen = true;
            render();
          });
        });
      }

      // Wire KPI & status tabs
      el.querySelectorAll('[data-kpi-tab], [data-status-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.statusTab = btn.getAttribute('data-kpi-tab') || btn.getAttribute('data-status-tab');
          state.mobileDetailOpen = false;
          render();
        });
      });

      // Wire search (preserve caret without full page flash)
      const searchEl = el.querySelector('#hires-search');
      if (searchEl) {
        searchEl.addEventListener('input', (e) => {
          state.search = e.target.value;
          const pos = e.target.selectionStart;
          render();
          const nextInput = el.querySelector('#hires-search');
          if (nextInput) {
            nextInput.focus();
            if (typeof pos === 'number') nextInput.setSelectionRange(pos, pos);
          }
        });
      }

      const typeSel = el.querySelector('#hires-filter-type');
      if (typeSel) typeSel.addEventListener('change', (e) => { state.typeFilter = e.target.value; render(); });

      const urgSel = el.querySelector('#hires-filter-urgency');
      if (urgSel) urgSel.addEventListener('change', (e) => { state.urgencyFilter = e.target.value; render(); });

      const evSel = el.querySelector('#hires-filter-event');
      if (evSel) evSel.addEventListener('change', (e) => { state.eventFilter = e.target.value; render(); });

      const resetBtn = el.querySelector('#hires-reset-filters');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          state.typeFilter = 'all';
          state.urgencyFilter = 'all';
          state.eventFilter = 'all';
          state.search = '';
          render();
        });
      }

      // Wire queue selection
      el.querySelectorAll('[data-select-hires]').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.selectedId = btn.getAttribute('data-select-hires');
          state.mobileDetailOpen = true;
          render();
        });
      });

      // Wire mobile back
      const mobileBack = el.querySelector('#hires-mobile-back');
      if (mobileBack) {
        mobileBack.addEventListener('click', () => {
          state.mobileDetailOpen = false;
          render();
        });
      }

      const jumpAnsweredBtn = el.querySelector('#hires-jump-answered');
      if (jumpAnsweredBtn) {
        jumpAnsweredBtn.addEventListener('click', () => {
          state.statusTab = 'Answered';
          state.selectedId = null;
          state.mobileDetailOpen = false;
          render();
        });
      }

      // Wire detail pane actions
      if (selected) {
        const editBtn = el.querySelector('#hires-edit-btn');
        if (editBtn) {
          editBtn.addEventListener('click', () => {
            openRequestModal(selected, null, () => render());
          });
        }

        const delBtn = el.querySelector('#hires-delete-btn');
        if (delBtn) {
          delBtn.addEventListener('click', async () => {
            const ok = await ui.confirm('Delete "' + selected.title + '"? This removes the request and its reply thread.', {
              title: 'Delete Hires Request',
              danger: true,
              confirmLabel: 'Delete'
            });
            if (ok) {
              deleteRequest(selected.id);
              state.selectedId = null;
              state.mobileDetailOpen = false;
              ui.toast('Hires request deleted.', 'info');
              render();
            }
          });
        }

        const ownerSel = el.querySelector('#hires-owner-select');
        if (ownerSel) {
          ownerSel.addEventListener('change', (e) => {
            assignTech(selected.id, e.target.value);
            ui.toast(e.target.value ? 'Tech owner assigned.' : 'Tech owner cleared.', 'ok');
            render();
          });
        }

        const suggestedBtn = el.querySelector('#hires-assign-suggested');
        if (suggestedBtn) {
          suggestedBtn.addEventListener('click', () => {
            assignTech(selected.id, suggestedBtn.getAttribute('data-uid'));
            ui.toast('Assigned event technician as owner.', 'ok');
            render();
          });
        }

        const statusSel = el.querySelector('#hires-status-select');
        if (statusSel) {
          statusSel.addEventListener('change', (e) => {
            const nextStatus = e.target.value;
            const wasAnswered = isCompletedOrAnswered(selected);
            updateStatus(selected.id, nextStatus);
            if (nextStatus === 'Answered' && state.statusTab !== 'Answered') {
              state.selectedId = null;
              state.mobileDetailOpen = false;
              ui.toast('Marked as Answered \u2014 moved to Answered.', 'ok');
            } else if (wasAnswered && nextStatus !== 'Answered' && state.statusTab === 'Answered') {
              state.statusTab = 'open';
              state.selectedId = selected.id;
              ui.toast('Request reopened \u2014 moved back to All Open.', 'ok');
            } else {
              ui.toast('Status updated to ' + nextStatus + '.', 'ok');
            }
            render();
          });
        }

        const reopenBtn = el.querySelector('#hires-reopen-btn');
        if (reopenBtn) {
          reopenBtn.addEventListener('click', () => {
            updateStatus(selected.id, 'Awaiting Tech');
            state.statusTab = 'open';
            state.selectedId = selected.id;
            ui.toast('Request reopened \u2014 moved back to All Open.', 'ok');
            render();
          });
        }

        const replyInput = el.querySelector('#hires-reply-input');
        function submitReply(targetStatus) {
          const text = replyInput ? replyInput.value.trim() : '';
          const wasAnswered = isCompletedOrAnswered(selected);
          if (!text) {
            if (targetStatus === 'Answered') {
              updateStatus(selected.id, 'Answered');
              if (state.statusTab !== 'Answered') {
                state.selectedId = null;
                state.mobileDetailOpen = false;
                ui.toast('Marked as Answered \u2014 moved to Answered.', 'ok');
              } else {
                ui.toast('Request marked as Answered.', 'ok');
              }
              render();
              return;
            }
            ui.toast('Write a reply message before sending.', 'info');
            if (replyInput) replyInput.focus();
            return;
          }
          addReply(selected.id, text, targetStatus);
          if (targetStatus === 'Answered' && state.statusTab !== 'Answered') {
            state.selectedId = null;
            state.mobileDetailOpen = false;
            ui.toast('Reply posted & moved to Answered.', 'ok');
          } else if (wasAnswered && targetStatus !== 'Answered') {
            state.statusTab = 'open';
            state.selectedId = selected.id;
            ui.toast('Follow-up added \u2014 moved back to All Open.', 'ok');
          } else {
            ui.toast(targetStatus === 'Answered' ? 'Reply posted & marked Answered.' : 'Reply posted.', 'ok');
          }
          render();
        }

        const sendBtn = el.querySelector('#hires-reply-send');
        if (sendBtn) sendBtn.addEventListener('click', () => submitReply('Awaiting Tech'));

        const awaitHiresBtn = el.querySelector('#hires-reply-await-hires');
        if (awaitHiresBtn) awaitHiresBtn.addEventListener('click', () => submitReply('Awaiting Hires'));

        const answerBtn = el.querySelector('#hires-reply-answer');
        if (answerBtn) answerBtn.addEventListener('click', () => submitReply('Answered'));

        if (replyInput) {
          replyInput.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              submitReply(isHires ? 'Awaiting Tech' : 'Awaiting Hires');
            }
          });
        }
      }
    }

    render();

    if (shouldAutoCreate) {
      const prefill = query && query.event ? { linkedEventId: query.event } : null;
      openRequestModal(null, prefill, (saved) => {
        state.selectedId = saved.id;
        state.statusTab = 'open';
        state.mobileDetailOpen = true;
        render();
      });
    }
  };

  /* ---- Public RMTP.hires API ---- */
  RMTP.hires = {
    REQUEST_TYPES,
    URGENCIES,
    STATUSES,
    isHiresTask,
    all,
    forEvent,
    forEvents,
    openCount,
    totalOpenCount,
    getMeta,
    hydrateAll,
    mirrorToAdvancing,
    syncFromTaskStatus,
    saveRequest,
    addReply,
    updateStatus,
    assignTech,
    deleteRequest,
    getSuggestedTechForEvent,
    openRequestModal,
    renderEventHiresPanel,
  };
})();
