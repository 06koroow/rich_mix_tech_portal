/* ============================================================
   sync-supabase.js — keeps the local cache and Supabase in step
   ------------------------------------------------------------
   Same "shape B" strategy as the SharePoint sync.js: localStorage
   stays the thing the views read (synchronous, offline-friendly),
   and this module (a) pulls every table into the cache on startup,
   and (b) pushes local writes back through a retrying queue. It
   wraps store.upsert / store.remove, so NO view changes are needed.

   Simpler than the SharePoint version because the app's own `id`
   is the table primary key — upsert(onConflict:'id') is
   insert-or-update, so there's no id-map to maintain. Table columns
   match the app's record fields (see docs/supabase-setup.sql), so
   most collections are a near-passthrough.
   ============================================================ */
RMTP.syncSb = (function () {
  const store = RMTP.store, sb = RMTP.supabase, files = RMTP.files;
  const tables = () => (RMTP.supabaseConfig || {}).tables || {};
  const COLLS = ['users', 'inventory', 'maintenance', 'advancing', 'reports', 'signoffs', 'procedures'];

  /* ---- pull ---- */
  async function pullCollection(coll) {
    const table = tables()[coll]; if (!table) return;
    const rows = await sb.selectAll(table);
    if (coll === 'procedures') return regroupProcedures(rows);
    rows.forEach((r) => {
      if (coll === 'inventory') { r.movements = r.movements || []; r.outAt = r.outAt || ''; }
      if (coll === 'advancing') {
        r.checklist = r.checklist || {};
        r.technicians = Array.isArray(r.technicians) ? r.technicians : (r.techUserId ? [{ userId: r.techUserId, role: '' }] : []);
        r.startTime = r.startTime || r.starttime || '';
        r.finishTime = r.finishTime || r.finishtime || '';
        r.screening_starts_time = r.screening_starts_time || r.screeningStartsTime || r.screeningstartstime || '';
        r.media_type = r.media_type || r.mediaType || r.mediatype || '';
        r.dcp_received = r.dcp_received !== undefined ? r.dcp_received : (r.dcpReceived !== undefined ? r.dcpReceived : (r.dcpreceived !== undefined ? r.dcpreceived : false));
        r.checks_completed = r.checks_completed !== undefined ? r.checks_completed : (r.checksCompleted !== undefined ? r.checksCompleted : (r.checkscompleted !== undefined ? r.checkscompleted : false));
        r.intermission = !!r.intermission;
        r.qa = !!r.qa;
        r.clientContact = r.clientContact || r.clientcontact || '';
        r.guestEngineer = r.guestEngineer !== undefined ? r.guestEngineer : (r.guestengineer !== undefined ? r.guestengineer : false);
        r.techInfo = r.techInfo || r.techinfo || '';
        r.techSpec = r.techSpec || r.techspec || null;
      }
      if (coll === 'reports') {
        r.eventId = r.eventId || r.eventid || '';
        r.shiftDate = r.shiftDate || r.shiftdate || '';
        r.crew = r.crew || '';
        r.summary = r.summary || '';
        r.issues = r.issues || '';
        r.followUp = r.followUp || r.followup || '';
        r.author = r.author || '';
        r.authorId = r.authorId || r.authorid || '';
        r.submittedAt = r.submittedAt || r.submittedat || '';
        r.updatedAt = r.updatedAt || r.updatedat || '';
        r.updatedBy = r.updatedBy || r.updatedby || '';
      }
    });
    store.write(coll, rows);
  }
  function regroupProcedures(rows) {
    const groups = {};
    rows.forEach((f) => {
      const key = f.category || 'Other';
      const g = groups[key] || (groups[key] = { id: RMTP.slug(key), name: key, icon: f.icon || 'book', items: [] });
      g.items.push({ id: f.id, title: f.title, body: f.body || '', updated: '' });
    });
    store.write('procedures', Object.keys(groups).map((k) => groups[k]));
  }
  async function pullAll() {
    for (let i = 0; i < COLLS.length; i++) { if (tables()[COLLS[i]]) await pullCollection(COLLS[i]); }
  }

  /* ---- record -> table row (mostly passthrough) ---- */
  async function toRow(coll, r) {
    if (coll === 'users') { const row = Object.assign({}, r); delete row.password; return row; }   // password lives in Supabase Auth, not the table
    if (coll === 'maintenance') { const row = Object.assign({}, r); row.image = await files.toRemote(r.image); return row; }
    if (coll === 'advancing') {
      const row = {
        id: r.id,
        name: r.name || '',
        category: r.category || '',
        space: r.space || '',
        date: r.date || '',
        status: r.status || 'Advancing',
        startTime: r.startTime || '',
        finishTime: r.finishTime || '',
        screening_starts_time: r.screening_starts_time || r.screeningStartsTime || '',
        media_type: r.media_type || r.mediaType || '',
        soundcheck: r.soundcheck || '',
        doors: r.doors || '',
        curfew: r.curfew || '',
        dcp_received: r.dcp_received !== undefined ? !!r.dcp_received : (r.dcpReceived !== undefined ? !!r.dcpReceived : false),
        checks_completed: r.checks_completed !== undefined ? !!r.checks_completed : (r.checksCompleted !== undefined ? !!r.checksCompleted : false),
        intermission: !!r.intermission,
        qa: !!r.qa,
        technicians: Array.isArray(r.technicians) ? r.technicians : [],
        clientContact: r.clientContact || '',
        guestEngineer: !!r.guestEngineer,
        techInfo: r.techInfo || '',
        techSpec: await files.toRemote(r.techSpec),
        checklist: r.checklist || {},
        artifaxId: r.artifaxId || null,
      };
      return row;
    }
    if (coll === 'reports') {
      const row = {
        id: r.id,
        eventId: r.eventId || '',
        crew: r.crew || '',
        shiftDate: r.shiftDate || '',
        summary: r.summary || '',
        issues: r.issues || '',
        followUp: r.followUp || '',
        author: r.author || '',
        authorId: r.authorId || null,
        submittedAt: r.submittedAt || '',
        updatedAt: r.updatedAt || '',
        updatedBy: r.updatedBy || '',
      };
      return row;
    }
    return r;
  }

  /* ---- push queue (persisted, retrying) ---- */
  let queue = [], draining = false;
  function loadQueue() {
    try {
      queue = JSON.parse(store.readRaw('sbqueue', '[]'));
      if (Array.isArray(queue)) {
        queue.forEach((op) => {
          if (op && op.coll === 'advancing' && op.record) {
            if (op.record.dcp_received === undefined && op.record.dcpReceived !== undefined) {
              op.record.dcp_received = !!op.record.dcpReceived;
            }
            if (op.record.checks_completed === undefined && op.record.checksCompleted !== undefined) {
              op.record.checks_completed = !!op.record.checksCompleted;
            }
            if (op.record.screening_starts_time === undefined && op.record.screeningStartsTime !== undefined) {
              op.record.screening_starts_time = op.record.screeningStartsTime;
            }
            if (op.record.media_type === undefined && op.record.mediaType !== undefined) {
              op.record.media_type = op.record.mediaType;
            }
            delete op.record.dcpReceived;
            delete op.record.checksCompleted;
            delete op.record.screeningStartsTime;
            delete op.record.mediaType;
          }
        });
        saveQueue();
      }
    } catch (e) { queue = []; }
  }
  function saveQueue() { store.writeRaw('sbqueue', JSON.stringify(queue)); }
  function enqueue(op) { queue.push(op); saveQueue(); drain(); }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function run(op) {
    const table = tables()[op.coll]; if (!table) return;
    if (op.type === 'delete') { await sb.deleteRow(table, op.id); return; }
    if (op.coll === 'procedures') { await sb.upsertRow(table, op.row); return; }
    await sb.upsertRow(table, await toRow(op.coll, op.record));
  }
  async function drain() {
    if (draining || !queue.length) return;
    draining = true; let fails = 0;
    while (queue.length) {
      try { await run(queue[0]); queue.shift(); saveQueue(); fails = 0; }
      catch (e) { console.error('[syncSb] push failed — will retry on next change/reload', e); fails += 1; if (fails >= 3) break; await sleep(1500); }
    }
    draining = false;
  }

  // procedures: one row per SOP, upserted by its own id
  function pushProcedures() {
    store.all('procedures').forEach((g) => (g.items || []).forEach((item) =>
      enqueue({ type: 'upsert', coll: 'procedures', id: item.id, row: { id: item.id, category: g.name || '', title: item.title || '', body: item.body || '', icon: g.icon || '' } })));
  }

  /* ---- wire: intercept writes so views push transparently ---- */
  function wire() {
    loadQueue(); if (queue.length) drain();
    const origUpsert = store.upsert, origRemove = store.remove;
    store.upsert = function (name, record) {
      const res = origUpsert(name, record);
      if (name === 'procedures') { pushProcedures(); return res; }
      if (COLLS.indexOf(name) > -1) enqueue({ type: 'upsert', coll: name, id: record.id, record: record });
      return res;
    };
    store.remove = function (name, id) {
      const res = origRemove(name, id);
      if (COLLS.indexOf(name) > -1) enqueue({ type: 'delete', coll: name, id: id });
      return res;
    };
  }

  // Explicitly delete one procedure page from Supabase (item deletes don't
  // flow through pushProcedures, which only re-upserts what still exists).
  function deleteProcedureRow(id) { enqueue({ type: 'delete', coll: 'procedures', id: id }); }

  function getQueueLength() { return queue.length; }

  async function verifySync() {
    if (!sb || !sb.isConfigured()) {
      return {
        configured: false,
        status: 'local',
        message: 'Running in offline/local storage mode.',
        queueLength: 0,
        tables: {}
      };
    }
    const result = {
      configured: true,
      status: 'checking',
      tables: {},
      queueLength: queue.length,
      lastError: null,
      message: ''
    };
    try {
      if (queue.length) {
        await drain();
      }
      result.queueLength = queue.length;
      const advTable = tables().advancing || 'advancing';
      const repTable = tables().reports || 'reports';
      const [advRows, repRows] = await Promise.all([
        sb.selectAll(advTable),
        sb.selectAll(repTable)
      ]);
      result.tables.advancing = { count: advRows.length, ok: true };
      result.tables.reports = { count: repRows.length, ok: true };
      result.status = result.queueLength === 0 ? 'synced' : 'pending';
      result.message = 'Supabase live & synced. Events in DB: ' + advRows.length + ', Shift reports in DB: ' + repRows.length + (result.queueLength ? ' (' + result.queueLength + ' queued)' : ' (0 pending in queue).');
    } catch (e) {
      result.status = 'error';
      result.lastError = e && e.message ? e.message : String(e);
      result.message = 'Sync verification error: ' + result.lastError;
    }
    return result;
  }

  return { pullAll, wire, pullCollection, deleteProcedureRow, drain, getQueueLength, verifySync };
})();
