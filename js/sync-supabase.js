// sync-supabase.js - simplified optimistic sync
window.RMTP = window.RMTP || {};
RMTP.syncSb = (function () {
  const store = RMTP.store, sb = RMTP.supabase;
  const COLLS = ['advancing', 'reports', 'venues', 'users', 'signoffs', 'inventory', 'maintenance', 'procedures', 'patch_presets', 'patch_sheets', 'dmx_personalities', 'dmx_patches', 'availability', 'bookings', 'dcps', 'tasks'];
  
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
    // Heal previously poisoned core tables that were falsely marked missing due to PGRST204 column cache errors
    let healed = false;
    ['bookings', 'availability', 'advancing', 'tasks', 'dcps'].forEach((t) => {
      if (unsupportedTables[t]) {
        delete unsupportedTables[t];
        healed = true;
      }
    });
    if (healed) {
      localStorage.setItem('rmtp_unsupported_tables', JSON.stringify(unsupportedTables));
    }
  } catch (e) {}
  
  function tables() {
    return {
      advancing: 'advancing', reports: 'reports', venues: 'venues',
      users: 'users', signoffs: 'signoffs', inventory: 'inventory',
      maintenance: 'maintenance', procedures: 'procedures',
      patch_presets: 'patch_presets', patch_sheets: 'patch_sheets',
      dmx_personalities: 'dmx_personalities', dmx_patches: 'dmx_patches',
      availability: 'availability', bookings: 'bookings',
      dcps: 'dcps', tasks: 'tasks'
    };
  }

  function isTableMissingError(err) {
    if (!err) return false;
    const code = err.code || (err.error && err.error.code);
    const msg = String(err.message || (err.error && err.error.message) || err.details || err.hint || '');
    let fullStr = '';
    try { fullStr = typeof err === 'object' ? JSON.stringify(err) : String(err); } catch (e) { fullStr = msg; }
    // Never confuse a missing-column error (PGRST204 / 42703) with a missing table
    if (code === 'PGRST204' || code === '42703') return false;
    if (/Could not find the '[^']+' column of/i.test(msg) || /column "[^"]+" of relation/i.test(msg)) return false;
    if (code === '42P01' || code === 'PGRST205' || code === 'PGRST200') return true;
    if (/Could not find the table/i.test(msg) || /relation .* does not exist/i.test(msg)) return true;
    if (/Could not find the table/i.test(fullStr) || /PGRST205/i.test(fullStr) || /42P01/i.test(fullStr)) return true;
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
    
    const currentList = store.all(coll) || [];
    const byId = new Map();
    const order = [];
    currentList.forEach((curr) => {
      if (curr && curr.id != null) {
        byId.set(curr.id, curr);
        order.push(curr.id);
      }
    });

    let mutated = false;
    rows.forEach((r) => {
      if (!r || r.id == null) return;
      // 1. If this record was explicitly deleted by the user, DO NOT restore it on refresh!
      if (store.isDeleted && store.isDeleted(coll, r.id)) {
        if (sb && sb.deleteRow) {
          sb.deleteRow(table, r.id).catch(() => {});
        }
        return;
      }

      // 2. If this is a placeholder seed in tasks, purge it permanently and skip
      if (coll === 'tasks' && isPlaceholderTask(r)) {
        if (store.markDeleted) store.markDeleted('tasks', r.id);
        if (sb && sb.deleteRow) {
          sb.deleteRow(table, r.id).catch(() => {});
        }
        return;
      }

      const existing = byId.get(r.id) || null;

      if (coll === 'advancing' && existing) {
        // Field-level merge protection: safeguard technician-enriched data from being wiped by Artifax sync
        const enrichedKeys = [
          'techRequirements', 'tech_requirements',
          'scheduleItems', 'schedule_items',
          'allocatedKit', 'allocated_kit',
          'linked_task_ids', 'linked_maintenance_ids',
          'dcp_notes', 'qc_status', 'dcp_qc_status',
          'further_action', 'furtherAction',
          'techSpec', 'tech_spec',
          'channel_list', 'dcp_tester_user_id', 'dcp_test_datetime'
        ];
        enrichedKeys.forEach(k => {
          if (existing[k] !== undefined && existing[k] !== null) {
            if (r[k] === undefined || r[k] === null || (Array.isArray(r[k]) && !r[k].length && existing[k].length)) {
              r[k] = existing[k];
            }
          }
        });

        if (!r.artifaxHistory || !r.artifaxHistory.length) {
          if (r.production_package && Array.isArray(r.production_package.artifaxHistory) && r.production_package.artifaxHistory.length) {
            r.artifaxHistory = r.production_package.artifaxHistory;
          } else if (Array.isArray(existing.artifaxHistory) && existing.artifaxHistory.length) {
            r.artifaxHistory = existing.artifaxHistory;
          }
        }
        if (existing.production_package && existing.production_package.hiresThreads && Object.keys(existing.production_package.hiresThreads).length > 0) {
          r.production_package = (r.production_package && typeof r.production_package === 'object' && !Array.isArray(r.production_package))
            ? Object.assign({}, r.production_package)
            : {};
          r.production_package.hiresThreads = Object.assign({}, existing.production_package.hiresThreads, r.production_package.hiresThreads || {});
        }
      } else if (coll === 'tasks' && existing) {
        // If local task was completed or updated more recently, keep local state
        const localTime = existing.updatedAt || existing.createdAt || 0;
        const remoteTime = r.updatedAt || r.createdAt || 0;
        if (localTime > remoteTime && existing.status === 'Completed' && r.status !== 'Completed') {
          r.status = existing.status;
          r.completedAt = existing.completedAt;
          r.completedBy = existing.completedBy;
        }
        if (existing.hiresMeta && !r.hiresMeta) {
          r.hiresMeta = existing.hiresMeta;
        }
      } else if (coll === 'dcps' && existing) {
        // If local pre-screening check has testing completed, retain local outcomes
        if (existing.tested && !r.tested) {
          r.tested = existing.tested;
          r.outcome = existing.outcome || r.outcome;
          r.kdmCplReceived = existing.kdmCplReceived !== undefined ? existing.kdmCplReceived : r.kdmCplReceived;
          r.playlistMade = existing.playlistMade !== undefined ? existing.playlistMade : r.playlistMade;
          r.subsAudioSync = existing.subsAudioSync !== undefined ? existing.subsAudioSync : r.subsAudioSync;
          r.holdingSlidesReady = existing.holdingSlidesReady !== undefined ? existing.holdingSlidesReady : r.holdingSlidesReady;
          r.issuesNoted = existing.issuesNoted || r.issuesNoted;
          r.furtherAction = existing.furtherAction || r.furtherAction;
        }
      }

      if (!byId.has(r.id)) order.push(r.id);
      byId.set(r.id, r);
      mutated = true;
    });

    if (mutated) {
      store.write(coll, order.map((id) => byId.get(id)));
    }
    if ((coll === 'tasks' || coll === 'advancing') && RMTP.hires && typeof RMTP.hires.hydrateAll === 'function') {
      RMTP.hires.hydrateAll();
    }
    if (coll === 'patch_presets' && RMTP.auth && typeof RMTP.auth.applyRemoteRoleViews === 'function') {
      const rvId = RMTP.auth.ROLE_VIEWS_RECORD_ID || '__rmtp_role_views__';
      const rvRow = rows.find((r) => r && r.id === rvId);
      if (rvRow && rvRow.channels && typeof rvRow.channels === 'object' && !Array.isArray(rvRow.channels)) {
        const merged = Object.assign({}, rvRow.channels, {
          updatedAt: Math.max(Number(rvRow.channels.updatedAt || 0), Number(rvRow.updatedAt || 0))
        });
        RMTP.auth.applyRemoteRoleViews(merged);
      }
    }
  }

  let pullInFlight = null;
  async function pull() {
    if (!sb || !sb.isConfigured()) return;
    if (pullInFlight) return pullInFlight;
    pullInFlight = (async () => {
      try {
        await Promise.allSettled(COLLS.map((c) => pullCollection(c)));
      } catch (err) {
        console.error('[syncSb] pull error', err);
      } finally {
        pullInFlight = null;
      }
    })();
    return pullInFlight;
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
           
           const attemptUpsert = async (currentPayload, attempt) => {
             const result = await sb.upsertRow(table, currentPayload);
             if (!result || result.ok) return;
             if (result.error && (result.error.code === 'PGRST204' || result.error.code === '42703')) {
               const missingCol = extractMissingColumn(result.error);
               if (missingCol && attempt < 15 && Object.prototype.hasOwnProperty.call(currentPayload, missingCol)) {
                 markColumnUnsupported(table, missingCol);
                 const nextPayload = { ...currentPayload };
                 delete nextPayload[missingCol];
                 return attemptUpsert(nextPayload, attempt + 1);
               }
             }
             if (result.error && isTableMissingError(result.error)) {
               markTableUnsupported(table);
               console.warn('[syncSb] Table missing in Supabase: ' + table + '. Using local cache.');
               return;
             }
             console.warn('[syncSb] Optimistic sync skipped for ' + name, result.message || result.error);
           };

           attemptUpsert(payload, 0).catch(e => console.error(e));
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

  let roleViewsPulling = false;
  let lastRoleViewsPullAt = 0;
  let roleViewsLiveStarted = false;
  let roleViewsChannel = null;

  async function pullRoleViews(opts) {
    if (!sb || !sb.isConfigured()) return false;
    const table = tables().patch_presets || 'patch_presets';
    if (isTableUnsupported(table)) return false;
    const now = Date.now();
    const minGap = (opts && typeof opts.minGapMs === 'number') ? opts.minGapMs : 3000;
    if (roleViewsPulling || (!(opts && opts.force) && (now - lastRoleViewsPullAt) < minGap)) return false;
    roleViewsPulling = true;
    lastRoleViewsPullAt = now;
    try {
      const client = sb.getClient && sb.getClient();
      if (!client) return false;
      const rvId = (RMTP.auth && RMTP.auth.ROLE_VIEWS_RECORD_ID) || '__rmtp_role_views__';
      const { data, error } = await client.from(table).select('*').eq('id', rvId).maybeSingle();
      if (error || !data) return false;
      if (data.channels && typeof data.channels === 'object' && !Array.isArray(data.channels)) {
        const merged = Object.assign({}, data.channels, {
          updatedAt: Math.max(Number(data.channels.updatedAt || 0), Number(data.updatedAt || 0))
        });
        const existing = store.all('patch_presets').filter((curr) => curr.id !== data.id);
        store.write('patch_presets', existing.concat(data));
        if (RMTP.auth && typeof RMTP.auth.applyRemoteRoleViews === 'function') {
          return RMTP.auth.applyRemoteRoleViews(merged);
        }
      }
      return false;
    } catch (e) {
      return false;
    } finally {
      roleViewsPulling = false;
    }
  }

  function startRoleViewsLiveSync() {
    if (roleViewsLiveStarted || !sb || !sb.isConfigured()) return;
    roleViewsLiveStarted = true;
    const table = tables().patch_presets || 'patch_presets';
    const rvId = (RMTP.auth && RMTP.auth.ROLE_VIEWS_RECORD_ID) || '__rmtp_role_views__';

    try {
      const client = sb.getClient && sb.getClient();
      if (client && typeof client.channel === 'function') {
        roleViewsChannel = client
          .channel('rmtp-role-views-live')
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: table,
            filter: 'id=eq.' + rvId,
          }, (payload) => {
            const row = payload && (payload.new || payload.record);
            if (row && row.channels && typeof row.channels === 'object' && !Array.isArray(row.channels)) {
              const merged = Object.assign({}, row.channels, {
                updatedAt: Math.max(Number(row.channels.updatedAt || 0), Number(row.updatedAt || 0))
              });
              const existing = store.all('patch_presets').filter((curr) => curr.id !== row.id);
              store.write('patch_presets', existing.concat(row));
              if (RMTP.auth && typeof RMTP.auth.applyRemoteRoleViews === 'function') {
                RMTP.auth.applyRemoteRoleViews(merged);
              }
            }
          })
          .subscribe();
      }
    } catch (e) {
      console.warn('[syncSb] Realtime role views channel unavailable, using polling fallback');
    }

    // Lightweight single-row fallback poll + focus/visibility refresh so updates propagate
    // promptly even if Supabase Realtime replication is disabled on patch_presets.
    setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      pullRoleViews({ minGapMs: 12000 }).catch(() => {});
    }, 15000);

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', () => {
        pullRoleViews({ minGapMs: 4000 }).catch(() => {});
      });
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          pullRoleViews({ minGapMs: 4000 }).catch(() => {});
        }
      });
    }
  }

  return {
    pull, pullAll: pull, pullCollection, wire, verifySync,
    pullRoleViews, startRoleViewsLiveSync,
    drain: async () => {},
    deleteProcedureRow: (id) => RMTP.supabase.deleteRow("procedures", id)
  };
})();
