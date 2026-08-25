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
    const existing = store.all(coll);
    const existingMap = new Map(existing.map((x) => [x.id, x]));

    rows.forEach((r) => {
      const prev = existingMap.get(r.id) || {};
      if (coll === 'inventory') {
        r.movements = r.movements || prev.movements || [];
        r.outAt = r.outAt || prev.outAt || '';
      }
      if (coll === 'advancing') {
        r.checklist = r.checklist || prev.checklist || {};
        r.technicians = Array.isArray(r.technicians) ? r.technicians : (Array.isArray(prev.technicians) ? prev.technicians : (r.techUserId ? [{ userId: r.techUserId, role: '' }] : []));
        r.startTime = r.startTime || r.starttime || prev.startTime || '';
        r.finishTime = r.finishTime || r.finishtime || prev.finishTime || '';
        r.load_in = r.load_in || r.loadIn || r.loadin || prev.load_in || prev.loadIn || '';
        r.soundcheck = r.soundcheck || prev.soundcheck || '';
        r.doors = r.doors || prev.doors || '';
        r.off_stage = r.off_stage || r.offStage || r.offstage || prev.off_stage || prev.offStage || '';
        r.curfew = r.curfew || prev.curfew || '';
        r.load_out = r.load_out || r.loadOut || r.loadout || prev.load_out || prev.loadOut || '';
        r.schedule_items = Array.isArray(r.schedule_items) ? r.schedule_items : (Array.isArray(r.scheduleItems) ? r.scheduleItems : (Array.isArray(prev.schedule_items) ? prev.schedule_items : (Array.isArray(prev.scheduleItems) ? prev.scheduleItems : [])));
        r.screening_starts_time = r.screening_starts_time || r.screeningStartsTime || r.screeningstartstime || prev.screening_starts_time || prev.screeningStartsTime || '';
        r.film_duration = r.film_duration || r.filmDuration || r.filmduration || prev.film_duration || prev.filmDuration || '';
        r.media_type = r.media_type || r.mediaType || r.mediatype || prev.media_type || prev.mediaType || '';
        r.dcp_received = r.dcp_received !== undefined ? r.dcp_received : (r.dcpReceived !== undefined ? r.dcpReceived : (prev.dcp_received !== undefined ? prev.dcp_received : (prev.dcpReceived !== undefined ? prev.dcpReceived : false)));
        r.checks_completed = r.checks_completed !== undefined ? r.checks_completed : (r.checksCompleted !== undefined ? r.checksCompleted : (prev.checks_completed !== undefined ? prev.checks_completed : (prev.checksCompleted !== undefined ? prev.checksCompleted : false)));
        r.intermission = r.intermission !== undefined ? !!r.intermission : (prev.intermission !== undefined ? !!prev.intermission : false);
        r.qa = r.qa !== undefined ? !!r.qa : (prev.qa !== undefined ? !!prev.qa : false);
        r.dcp_tester_user_id = r.dcp_tester_user_id || r.dcpTesterUserId || r.dcptesteruserid || prev.dcp_tester_user_id || prev.dcpTesterUserId || '';
        r.dcp_test_datetime = r.dcp_test_datetime || r.dcpTestDatetime || r.dcptestdatetime || prev.dcp_test_datetime || prev.dcpTestDatetime || '';
        r.parent_event_id = r.parent_event_id || r.parentEventId || prev.parent_event_id || prev.parentEventId || null;
        r.dcp_test_event_id = r.dcp_test_event_id || r.dcpTestEventId || prev.dcp_test_event_id || prev.dcpTestEventId || null;
        r.linked_maintenance_ids = Array.isArray(r.linked_maintenance_ids) ? r.linked_maintenance_ids : (Array.isArray(r.linkedMaintenanceIds) ? r.linkedMaintenanceIds : (Array.isArray(prev.linked_maintenance_ids) ? prev.linked_maintenance_ids : []));
        r.clientContact = r.clientContact || r.clientcontact || prev.clientContact || '';
        r.guestEngineer = r.guestEngineer !== undefined ? r.guestEngineer : (prev.guestEngineer !== undefined ? prev.guestEngineer : false);
        r.techInfo = r.techInfo || r.techinfo || prev.techInfo || '';
        r.email_recipients = r.email_recipients || r.emailRecipients || prev.email_recipients || prev.emailRecipients || '';
        r.tech_requirements = r.tech_requirements || r.techRequirements || prev.tech_requirements || prev.techRequirements || {};
        r.techSpec = r.techSpec || r.techspec || prev.techSpec || null;
      }
      if (coll === 'reports') {
        r.eventId = r.eventId || r.eventid || prev.eventId || '';
        r.shiftDate = r.shiftDate || r.shiftdate || prev.shiftDate || '';
        r.crew = r.crew || prev.crew || '';
        r.summary = r.summary || prev.summary || '';
        r.issues = r.issues || prev.issues || '';
        r.followUp = r.followUp || r.followup || prev.followUp || '';
        r.author = r.author || prev.author || '';
        r.authorId = r.authorId || r.authorid || prev.authorId || '';
        r.submittedAt = r.submittedAt || r.submittedat || prev.submittedAt || '';
        r.updatedAt = r.updatedAt || r.updatedat || prev.updatedAt || '';
        r.updatedBy = r.updatedBy || r.updatedby || prev.updatedBy || '';
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
        load_in: r.load_in || r.loadIn || '',
        soundcheck: r.soundcheck || '',
        doors: r.doors || '',
        off_stage: r.off_stage || r.offStage || '',
        curfew: r.curfew || '',
        load_out: r.load_out || r.loadOut || '',
        schedule_items: Array.isArray(r.schedule_items) ? r.schedule_items : (Array.isArray(r.scheduleItems) ? r.scheduleItems : []),
        screening_starts_time: r.screening_starts_time || r.screeningStartsTime || '',
        film_duration: r.film_duration || r.filmDuration || '',
        media_type: r.media_type || r.mediaType || '',
        dcp_received: r.dcp_received !== undefined ? !!r.dcp_received : (r.dcpReceived !== undefined ? !!r.dcpReceived : false),
        checks_completed: r.checks_completed !== undefined ? !!r.checks_completed : (r.checksCompleted !== undefined ? !!r.checksCompleted : false),
        intermission: !!r.intermission,
        qa: !!r.qa,
        dcp_tester_user_id: r.dcp_tester_user_id || r.dcpTesterUserId || '',
        dcp_test_datetime: r.dcp_test_datetime || r.dcpTestDatetime || '',
        parent_event_id: r.parent_event_id || r.parentEventId || null,
        dcp_test_event_id: r.dcp_test_event_id || r.dcpTestEventId || null,
        linked_maintenance_ids: Array.isArray(r.linked_maintenance_ids) ? r.linked_maintenance_ids : (Array.isArray(r.linkedMaintenanceIds) ? r.linkedMaintenanceIds : []),
        technicians: Array.isArray(r.technicians) ? r.technicians : [],
        clientContact: r.clientContact || '',
        guestEngineer: !!r.guestEngineer,
        techInfo: r.techInfo || '',
        email_recipients: r.email_recipients || r.emailRecipients || '',
        tech_requirements: r.tech_requirements || r.techRequirements || {},
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

  /* ---- dynamic column compatibility cache & sanitizer ---- */
  let unsupportedCols = {};
  function loadUnsupportedCols() {
    try {
      unsupportedCols = JSON.parse(store.readRaw('sb_unsupported_cols', '{}')) || {};
    } catch (e) { unsupportedCols = {}; }
  }
  loadUnsupportedCols();

  function markColumnUnsupported(table, col) {
    if (!table || !col) return;
    unsupportedCols[table] = unsupportedCols[table] || [];
    if (!unsupportedCols[table].includes(col)) {
      unsupportedCols[table].push(col);
      store.writeRaw('sb_unsupported_cols', JSON.stringify(unsupportedCols));
    }
  }

  function sanitizeRow(table, row) {
    if (!row || typeof row !== 'object') return row;
    const missing = unsupportedCols[table];
    if (!missing || !missing.length) return Object.assign({}, row);
    const cleaned = Object.assign({}, row);
    missing.forEach((col) => {
      delete cleaned[col];
    });
    return cleaned;
  }

  function extractMissingColumn(err) {
    if (!err) return null;
    const msg = (err.message || '') + ' ' + (err.details || '') + ' ' + (err.hint || '') + ' ' + (typeof err === 'string' ? err : '');
    if (!msg.trim()) return null;
    let match = msg.match(/Could not find the '([^']+)' column/i);
    if (match) return match[1];
    match = msg.match(/column "?([a-zA-Z0-9_]+)"? of relation/i);
    if (match) return match[1];
    match = msg.match(/column "?([a-zA-Z0-9_]+)"? does not exist/i);
    if (match) return match[1];
    return null;
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
            if (op.record.load_in === undefined && op.record.loadIn !== undefined) {
              op.record.load_in = op.record.loadIn;
            }
            if (op.record.off_stage === undefined && op.record.offStage !== undefined) {
              op.record.off_stage = op.record.offStage;
            }
            if (op.record.load_out === undefined && op.record.loadOut !== undefined) {
              op.record.load_out = op.record.loadOut;
            }
            if (op.record.schedule_items === undefined && op.record.scheduleItems !== undefined) {
              op.record.schedule_items = op.record.scheduleItems;
            }
            if (op.record.dcp_tester_user_id === undefined && op.record.dcpTesterUserId !== undefined) {
              op.record.dcp_tester_user_id = op.record.dcpTesterUserId;
            }
            if (op.record.dcp_test_datetime === undefined && op.record.dcpTestDatetime !== undefined) {
              op.record.dcp_test_datetime = op.record.dcpTestDatetime;
            }
            delete op.record.dcpReceived;
            delete op.record.checksCompleted;
            delete op.record.screeningStartsTime;
            delete op.record.mediaType;
            delete op.record.loadIn;
            delete op.record.offStage;
            delete op.record.loadOut;
            delete op.record.scheduleItems;
            delete op.record.dcpTesterUserId;
            delete op.record.dcpTestDatetime;
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
    
    let baseRow = op.coll === 'procedures' ? Object.assign({}, op.row) : await toRow(op.coll, op.record);
    
    let attempts = 0;
    while (attempts < 20) {
      attempts++;
      const rowToSend = sanitizeRow(table, baseRow);
      try {
        await sb.upsertRow(table, rowToSend);
        return;
      } catch (err) {
        const missingCol = extractMissingColumn(err);
        if (missingCol && (baseRow[missingCol] !== undefined || rowToSend[missingCol] !== undefined)) {
          markColumnUnsupported(table, missingCol);
          console.warn('[syncSb] Table "' + table + '" missing column "' + missingCol + '" in remote schema cache (PGRST204). Pruning for Supabase upsert.');
          delete baseRow[missingCol];
          continue;
        }
        throw err;
      }
    }
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
  function getUnsupportedCols() { return Object.assign({}, unsupportedCols); }

  async function verifySync() {
    if (!sb || !sb.isConfigured()) {
      return {
        configured: false,
        status: 'local',
        message: 'Running in offline/local storage mode.',
        queueLength: 0,
        unsupportedCols: getUnsupportedCols(),
        tables: {}
      };
    }
    const result = {
      configured: true,
      status: 'checking',
      tables: {},
      queueLength: queue.length,
      unsupportedCols: getUnsupportedCols(),
      lastError: null,
      message: ''
    };
    try {
      if (queue.length) {
        await drain();
      }
      result.queueLength = queue.length;
      result.unsupportedCols = getUnsupportedCols();
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

  return { pullAll, wire, pullCollection, deleteProcedureRow, drain, getQueueLength, getUnsupportedCols, verifySync };
})();
