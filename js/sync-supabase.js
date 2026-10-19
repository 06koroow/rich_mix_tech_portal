// sync-supabase.js - simplified optimistic sync
window.RMTP = window.RMTP || {};
RMTP.syncSb = (function () {
  const store = RMTP.store, sb = RMTP.supabase;
  const COLLS = ['advancing', 'reports', 'venues', 'users', 'signoffs', 'inventory', 'maintenance', 'procedures', 'patch_presets', 'patch_sheets', 'dmx_personalities', 'dmx_patches', 'availability', 'bookings'];
  
  let unsupportedCols = {};
  try {
    const saved = localStorage.getItem('rmtp_unsupported_cols');
    if (saved) unsupportedCols = JSON.parse(saved);
  } catch (e) {}
  if (!unsupportedCols.advancing) unsupportedCols.advancing = {};
  if (unsupportedCols.advancing.artifaxHistory === undefined) {
    unsupportedCols.advancing.artifaxHistory = true;
  }

  let unsupportedTables = {};
  try {
    const savedT = localStorage.getItem('rmtp_unsupported_tables');
    if (savedT) unsupportedTables = JSON.parse(savedT);
  } catch (e) {}
  
  function tables() {
    return {
      advancing: 'advancing', reports: 'reports', venues: 'venues',
      users: 'users', signoffs: 'signoffs', inventory: 'inventory',
      maintenance: 'maintenance', procedures: 'procedures',
      patch_presets: 'patch_presets', patch_sheets: 'patch_sheets',
      dmx_personalities: 'dmx_personalities', dmx_patches: 'dmx_patches',
      availability: 'availability', bookings: 'bookings'
    };
  }

  function isTableMissingError(err) {
    if (!err) return false;
    const code = err.code || (err.error && err.error.code);
    const msg = String(err.message || (err.error && err.error.message) || err.details || err.hint || '');
    let fullStr = '';
    try { fullStr = typeof err === 'object' ? JSON.stringify(err) : String(err); } catch (e) { fullStr = msg; }
    if (code === '42P01' || code === 'PGRST205' || code === 'PGRST200') return true;
    if (/Could not find the table/i.test(msg) || /relation .* does not exist/i.test(msg) || /in the schema cache/i.test(msg)) return true;
    if (/Could not find the table/i.test(fullStr) || /schema cache/i.test(fullStr) || /PGRST205/i.test(fullStr) || /42P01/i.test(fullStr)) return true;
    return false;
  }
  function isTableUnsupported(table) { return !!unsupportedTables[table]; }
  function markTableUnsupported(table) {
    unsupportedTables[table] = true;
    try {
      localStorage.setItem('rmtp_unsupported_tables', JSON.stringify(unsupportedTables));
    } catch (e) {}
  }
  function clearTableUnsupported(table) {
    if (unsupportedTables[table]) {
      delete unsupportedTables[table];
      try {
        localStorage.setItem('rmtp_unsupported_tables', JSON.stringify(unsupportedTables));
      } catch (e) {}
    }
  }
  
  function markColumnUnsupported(table, col) {
    if (!unsupportedCols[table]) unsupportedCols[table] = {};
    unsupportedCols[table][col] = true;
    try {
      localStorage.setItem('rmtp_unsupported_cols', JSON.stringify(unsupportedCols));
    } catch (e) {}
  }
  
  function isColumnUnsupported(table, col) { return unsupportedCols[table] && unsupportedCols[table][col]; }
  
  function extractMissingColumn(err) {
    if (!err || !err.message) return null;
    const msg = err.message;
    const m = msg.match(/column "([^"]+)" of relation "[^"]+" does not exist/);
    if (m && m[1]) return m[1];
    const m2 = msg.match(/Could not find the public.([^.]+) or/);
    if (m2 && m2[1]) return m2[1];
    const m3 = msg.match(/Could not find the '([^']+)' column of/);
    if (m3 && m3[1]) return m3[1];
    return null;
  }

  async function pullCollection(coll) {
    const table = tables()[coll]; if (!table) return;
    if (isTableUnsupported(table)) return;
    let rows = [];
    try {
      if (coll === 'advancing') {
        const dFrom = new Date();
        dFrom.setDate(dFrom.getDate() - 14);
        const fromDate = dFrom.toISOString().slice(0, 10);
        
        const dTo = new Date();
        dTo.setDate(dTo.getDate() + 120);
        const toDate = dTo.toISOString().slice(0, 10);

        const fetchAdv = async () => {
          const { data, error } = await sb.getClient().from(table)
            .select('*')
            .gte('date', fromDate)
            .lte('date', toDate);
          if (error) {
            if (sb.isClockSkewError && sb.isClockSkewError(error)) throw error;
            throw error;
          }
          return data || [];
        };

        rows = sb.withRetry ? await sb.withRetry(fetchAdv) : await fetchAdv();
      } else {
        rows = await sb.selectAll(table);
      }
      clearTableUnsupported(table);
    } catch (err) {
      if (sb.isClockSkewError && sb.isClockSkewError(err)) {
        console.warn(`[syncSb] Clock skew on ${coll}, retaining local data until next sync.`);
        return;
      }
      if (isTableMissingError(err)) {
        markTableUnsupported(table);
        console.warn('[syncSb] Table missing in Supabase: ' + table + '. Using local mock data.');
        return;
      }
      console.error('[syncSb] pull failed for', coll, err);
      return; 
    }
    
    rows.forEach(r => {
      if (coll === 'advancing') {
        const existing = store.find ? store.find(coll, r.id) : (store.get ? store.get(coll, r.id) : null);
        if (!r.artifaxHistory || !r.artifaxHistory.length) {
          if (r.production_package && Array.isArray(r.production_package.artifaxHistory) && r.production_package.artifaxHistory.length) {
            r.artifaxHistory = r.production_package.artifaxHistory;
          } else if (existing && Array.isArray(existing.artifaxHistory) && existing.artifaxHistory.length) {
            r.artifaxHistory = existing.artifaxHistory;
          }
        }
      }
      store.write(coll, store.all(coll).filter(existing => existing.id !== r.id).concat(r));
    });
  }

  async function pull() {
    if (!sb || !sb.isConfigured()) return;
    try {
      for (const c of COLLS) {
        await pullCollection(c);
      }
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
           const payload = { ...record };

           // For advancing, safely mirror artifaxHistory inside production_package JSONB
           // so that history is persisted to PostgreSQL even if the column is absent from schema
           if (name === 'advancing' && record.artifaxHistory && Array.isArray(record.artifaxHistory)) {
             payload.production_package = (payload.production_package && typeof payload.production_package === 'object' && !Array.isArray(payload.production_package))
               ? { ...payload.production_package }
               : {};
             payload.production_package.artifaxHistory = record.artifaxHistory;
           }

           // Auto-promote any pending local PDF tech specs to Supabase Storage
           if (name === 'advancing' && RMTP.files && RMTP.files.toRemote) {
             if (record.techSpec && record.techSpec.id && !record.techSpec.url) {
               RMTP.files.toRemote(record.techSpec).then(remote => {
                 if (remote && remote.url) {
                   const fresh = store.find('advancing', record.id);
                   if (fresh && (!fresh.techSpec || !fresh.techSpec.url)) {
                     fresh.techSpec = remote;
                     store.upsert('advancing', fresh);
                   }
                 }
               }).catch(e => console.warn('[syncSb] Background PDF promotion failed:', e));
             }
           }

           if (unsupportedCols[table]) {
             Object.keys(unsupportedCols[table]).forEach(col => {
               if (unsupportedCols[table][col]) delete payload[col];
             });
           }
           
           sb.upsertRow(table, payload).then(result => {
              if (result && !result.ok) {
                 if (result.error && isTableMissingError(result.error)) {
                    markTableUnsupported(table);
                    console.warn('[syncSb] Table missing in Supabase: ' + table + '. Using local cache.');
                    return;
                 } else if (result.error && (result.error.code === 'PGRST204' || result.error.code === '42703')) {
                    const missingCol = extractMissingColumn(result.error);
                    if (missingCol) {
                       markColumnUnsupported(table, missingCol);
                       const retryPayload = { ...payload };
                       delete retryPayload[missingCol];
                       sb.upsertRow(table, retryPayload).then(retryRes => {
                          if (retryRes && !retryRes.ok) {
                             if (retryRes.error && isTableMissingError(retryRes.error)) {
                                markTableUnsupported(table);
                             } else {
                                console.warn('[syncSb] Retry failed after stripping ' + missingCol + ' for ' + name, retryRes.message || retryRes.error);
                             }
                          }
                       }).catch(e => console.error(e));
                       return;
                    }
                 }
                 console.warn('[syncSb] Optimistic sync skipped for ' + name, result.message || result.error);
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
              if (result && !result.ok) {
                 if (result.error && isTableMissingError(result.error)) {
                    markTableUnsupported(table);
                    console.warn('[syncSb] Table missing in Supabase: ' + table + '. Using local cache.');
                 } else {
                    console.warn('[syncSb] Optimistic delete skipped for ' + name, result.message);
                 }
              }
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
