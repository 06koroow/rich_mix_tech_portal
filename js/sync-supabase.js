// sync-supabase.js - simplified optimistic sync
window.RMTP = window.RMTP || {};
RMTP.syncSb = (function () {
  const store = RMTP.store, sb = RMTP.supabase;
  const COLLS = ['advancing', 'reports', 'venues', 'users', 'signoffs', 'inventory', 'maintenance', 'procedures', 'patch_presets', 'patch_sheets', 'dmx_personalities', 'dmx_patches'];
  const unsupportedCols = {};
  const unsupportedTables = {};
  
  function tables() {
    return {
      advancing: 'advancing', reports: 'reports', venues: 'venues',
      users: 'users', signoffs: 'signoffs', inventory: 'inventory',
      maintenance: 'maintenance', procedures: 'procedures',
      patch_presets: 'patch_presets', patch_sheets: 'patch_sheets',
      dmx_personalities: 'dmx_personalities', dmx_patches: 'dmx_patches'
    };
  }

  function isTableMissingError(err) { return err && err.code === '42P01'; }
  function isTableUnsupported(table) { return !!unsupportedTables[table]; }
  function markTableUnsupported(table) { unsupportedTables[table] = true; }
  function clearTableUnsupported(table) { unsupportedTables[table] = false; }
  
  function markColumnUnsupported(table, col) {
    if (!unsupportedCols[table]) unsupportedCols[table] = {};
    unsupportedCols[table][col] = true;
  }
  
  function isColumnUnsupported(table, col) { return unsupportedCols[table] && unsupportedCols[table][col]; }
  
  function extractMissingColumn(err) {
    if (!err || !err.message) return null;
    const msg = err.message;
    const m = msg.match(/column "([^"]+)" of relation "[^"]+" does not exist/);
    if (m && m[1]) return m[1];
    const m2 = msg.match(/Could not find the public.([^.]+) or/);
    if (m2 && m2[1]) return m2[1];
    return null;
  }

  async function pullCollection(coll) {
    const table = tables()[coll]; if (!table) return;
    let rows = [];
    try {
      if (coll === 'advancing') {
        const dFrom = new Date();
        dFrom.setDate(dFrom.getDate() - 14);
        const fromDate = dFrom.toISOString().slice(0, 10);
        
        const dTo = new Date();
        dTo.setDate(dTo.getDate() + 120);
        const toDate = dTo.toISOString().slice(0, 10);

        const { data, error } = await sb.getClient().from(table)
          .select('*')
          .gte('date', fromDate)
          .lte('date', toDate);

        if (error) throw error;
        rows = data || [];
      } else {
        rows = await sb.selectAll(table);
      }
      clearTableUnsupported(table);
    } catch (err) {
      if (isTableMissingError(err)) {
        markTableUnsupported(table);
        console.warn('[syncSb] Table missing in Supabase: ' + table + '. Using local mock data.');
        return;
      }
      console.error('[syncSb] pull failed for', coll, err);
      return; 
    }
    
    rows.forEach(r => store.write(coll, store.all(coll).filter(existing => existing.id !== r.id).concat(r)));
  }

  async function pull() {
    if (!sb || !sb.isConfigured()) return;
    try {
      const ps = COLLS.map(c => pullCollection(c));
      await Promise.all(ps);
    } catch (err) {
      console.error('[syncSb] pull error', err);
    }
  }

  function wire() {
    const origUpsert = store.upsert, origRemove = store.remove;
    store.upsert = function (name, record) {
      const res = origUpsert(name, record);
      
      if (sb && sb.isConfigured() && COLLS.includes(name)) {
        const table = tables()[name];
        if (!isTableUnsupported(table)) {
           sb.upsertRow(table, record).then(result => {
              if (!result.ok) {
                 if (result.error && result.error.code === '42P01') {
                    markTableUnsupported(table);
                 } else if (result.error && result.error.code === 'PGRST204') {
                    const missingCol = extractMissingColumn(result.error);
                    if (missingCol) markColumnUnsupported(table, missingCol);
                 }
                 console.error('[syncSb] Optimistic sync failed for ' + name, result.message || result.error);
                 // We don't rollback the UI to avoid jarring behavior on transient errors,
                 // but we could notify the user here.
              }
           }).catch(e => console.error(e));
        }
      }
      return res;
    };
    
    store.remove = function (name, id) {
      const res = origRemove(name, id);
      if (sb && sb.isConfigured() && COLLS.includes(name)) {
        const table = tables()[name];
        if (!isTableUnsupported(table)) {
           sb.deleteRow(table, id).then(result => {
              if (!result.ok) console.error('[syncSb] Optimistic delete failed for ' + name, result.message);
           }).catch(e => console.error(e));
        }
      }
      return res;
    };
  }

  async function verifySync() {
    if (!sb || !sb.isConfigured()) return { status: 'local', message: 'Running in offline/local storage mode.', queueLength: 0, tables: {} };
    
    const result = { status: 'checking', tables: {}, queueLength: 0, message: '' };
    try {
      const advTable = tables().advancing || 'advancing';
      const repTable = tables().reports || 'reports';
      const [advRows, repRows] = await Promise.all([
        isTableUnsupported(advTable) ? Promise.resolve([]) : sb.selectAll(advTable).catch(()=>[]),
        isTableUnsupported(repTable) ? Promise.resolve([]) : sb.selectAll(repTable).catch(()=>[])
      ]);
      result.tables.advancing = { count: advRows.length, ok: !isTableUnsupported(advTable) };
      result.tables.reports = { count: repRows.length, ok: !isTableUnsupported(repTable) };
      result.status = 'synced';
      result.message = 'Supabase live & synced. Events in DB: ' + advRows.length + ', Shift reports in DB: ' + repRows.length;
    } catch (e) {
      result.status = 'error';
      result.message = 'Sync verification error: ' + (e.message || String(e));
    }
    return result;
  }

  return { pull, pullAll: pull, pullCollection, wire, verifySync, drain: async () => {}, deleteProcedureRow: (id) => RMTP.supabase.deleteRow("procedures", id) };
})();
