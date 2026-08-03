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
      if (coll === 'advancing') { r.checklist = r.checklist || {}; }
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
    if (coll === 'advancing') { const row = Object.assign({}, r); row.techSpec = await files.toRemote(r.techSpec); return row; }
    return r;
  }

  /* ---- push queue (persisted, retrying) ---- */
  let queue = [], draining = false;
  function loadQueue() { try { queue = JSON.parse(store.readRaw('sbqueue', '[]')); } catch (e) { queue = []; } }
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

  return { pullAll, wire, pullCollection };
})();
